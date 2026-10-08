"""Analyse a recorded video: detect cars (YOLOX ONNX), track them (ByteTrack-style), measure time in a zone,
export analysis.json (schemaVersion 1). This is analysis of a recording, not live video.
Only the validity window from the config (validFromSec..validUntilSec, while the camera stands still) is measured.

  python vision/analyze.py --config vision/config/clip-01.json --out vision/out/analysis.json
  python vision/analyze.py --config vision/config/clip-01.json --check 6     # detections on 6 frames -> contact sheet
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import cv2
import numpy as np

from detector import YoloxDetector
from tracker import ByteTrackLite
from visits import VisitLog, point_in_polygon

HERE = Path(__file__).resolve().parent


def load_config(path: str) -> dict:
    cfg = json.loads(Path(path).read_text(encoding="utf-8"))
    for k in ("videoPath", "modelPath"):
        if not Path(cfg[k]).is_absolute():
            cfg[k] = str((Path(path).parent / cfg[k]).resolve())
    return cfg


def open_video(path: str):
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise SystemExit(f"Не открыть видео: {path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    return cap, fps, n, w, h


def check(cfg: dict, frames: int, out: Path):
    """Run the detector on a few evenly spaced frames and save a contact sheet with boxes, before any tracking."""
    det = YoloxDetector(cfg["modelPath"], score_thr=cfg.get("scoreThr", 0.1))
    cap, fps, n, w, h = open_video(cfg["videoPath"])
    tiles, counts = [], []
    for i in range(frames):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int((i + 0.5) * n / frames))
        ok, img = cap.read()
        if not ok:
            continue
        boxes = [b for b in det(img) if b[4] >= cfg.get("highThr", 0.5)]
        counts.append(len(boxes))
        draw_zone(img, cfg["zone"]["polygon"], w, h)
        for x1, y1, x2, y2, s, _ in boxes:
            cv2.rectangle(img, (int(x1), int(y1)), (int(x2), int(y2)), (0, 200, 255), 3)
            cv2.putText(img, f"car {s:.2f}", (int(x1), int(y1) - 8), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 200, 255), 2)
        cv2.putText(img, f"t={(i + 0.5) * n / frames / fps:.1f}s  cars={len(boxes)}", (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (255, 255, 255), 3)
        tiles.append(cv2.resize(img, (640, int(640 * h / w))))
    while len(tiles) % 2:
        tiles.append(np.zeros_like(tiles[0]))
    sheet = np.vstack([np.hstack(tiles[i:i + 2]) for i in range(0, len(tiles), 2)])
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), sheet)
    print(f"Проверка распознавания: {len(counts)} кадров, машин (score ≥ {cfg.get('highThr', 0.5)}): {counts} -> {out}")


def draw_zone(img, poly, w, h):
    pts = np.array([[int(x * w), int(y * h)] for x, y in poly], np.int32)
    cv2.polylines(img, [pts], True, (60, 220, 60), 3)


def analyse(cfg: dict) -> dict:
    t0 = time.perf_counter()
    det = YoloxDetector(cfg["modelPath"], score_thr=cfg.get("lowThr", 0.1))
    trk = ByteTrackLite(high=cfg.get("highThr", 0.5), low=cfg.get("lowThr", 0.1), max_lost_sec=cfg.get("maxLostSec", 1.5))
    zone = cfg["zone"]
    log = VisitLog(zone, enter_sec=cfg.get("enterSec", 0.4), exit_sec=cfg.get("exitSec", 0.8))
    cap, fps, n, w, h = open_video(cfg["videoPath"])
    duration = n / fps
    step = max(1, round(fps / cfg.get("sampleFps", 5)))
    # Validity window: the zone is a fixed place on the road only while the camera stands still. Outside the window
    # frames are not analysed at all and are not written to `frames`, so they contribute no zone membership.
    valid_from = float(cfg.get("validFromSec", 0) or 0)
    valid_until = cfg.get("validUntilSec")
    truncated = valid_until is not None and float(valid_until) < duration
    valid_until = float(valid_until) if truncated else duration
    frames, i = [], 0
    while True:
        t = i / fps  # time in the recording, independent of playback speed
        if truncated and t > valid_until + 1e-6:
            break
        ok = cap.grab()
        if not ok:
            break
        if i % step == 0 and t >= valid_from - 1e-6:
            ok, img = cap.retrieve()
            if not ok:
                break
            tracks = trk.step(det(img), t)
            objs = []
            for tr in tracks:
                x1, y1, x2, y2 = tr.box
                cx, cy = (x1 + x2) / 2 / w, min(y2 / h, 0.999)  # bottom-centre: where the car touches the ground
                inside = point_in_polygon(cx, cy, zone["polygon"])
                log.observe(tr.id, t, inside)
                objs.append({"trackId": tr.id, "className": "car", "confidence": round(tr.score, 3),
                             "bbox": [round(x1 / w, 4), round(y1 / h, 4), round((x2 - x1) / w, 4), round((y2 - y1) / h, 4)],
                             "zoneId": zone["id"] if inside else None})
            for tr in trk.removed:
                log.track_lost(tr.id)
            trk.removed.clear()
            frames.append({"t": round(t, 2), "objects": objs})
        i += 1
    cap.release()
    # Tracks still alive at the end are not "lost": their visits stay open. With a validity window that ends before the
    # recording, the measurement stops at valid_until and visits inside at that moment are marked truncated.
    end_t = valid_until if truncated else ((i - 1) / fps if i else 0.0)
    visits = log.finish(end_t, truncated=truncated)
    src = cfg["source"]
    return {
        "schemaVersion": 1,
        "source": {**src, "fileName": Path(cfg["videoPath"]).name, "durationSec": round(duration, 2), "width": w, "height": h},
        "analysis": {"mode": "model", "model": cfg.get("modelName", "YOLOX-S ONNX"), "tracker": "ByteTrack-style IoU tracker (vision/tracker.py)",
                     "sampleFps": round(fps / step, 2), "processingSec": round(time.perf_counter() - t0, 1),
                     "zonePoint": "bottom-centre of the box", "hysteresisSec": {"enter": log.enter_sec, "exit": log.exit_sec}, "maxLostSec": trk.max_lost_sec,
                     "validInterval": {"fromSec": round(valid_from, 2), "untilSec": round(valid_until, 2),
                                       "reason": cfg.get("validReason") or "вся запись", "note": cfg.get("validNote"),
                                       "outside": "кадры вне окна не анализируются и не входят в frames; посещения, не завершённые к концу окна, обрезаны (truncated)"}},
        "zones": [{k: zone[k] for k in ("id", "name", "polygon", "thresholdSec", "thresholdSource")}],
        "frames": frames,
        "visits": visits,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=str(HERE / "config" / "clip-01.json"))
    ap.add_argument("--out", default=str(HERE / "out" / "analysis.json"))
    ap.add_argument("--check", type=int, default=0, help="only run detections on N frames and save a contact sheet")
    a = ap.parse_args()
    cfg = load_config(a.config)
    if a.check:
        return check(cfg, a.check, HERE / "out" / "check-frames.jpg")
    res = analyse(cfg)
    out = Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")  # LF, as in .gitattributes
    v, win = res["visits"], res["analysis"]["validInterval"]
    print(f"Готово за {res['analysis']['processingSec']} с: окно измерения {win['fromSec']}–{win['untilSec']} с, {len(res['frames'])} кадров по {res['analysis']['sampleFps']} к/с, треков {len({o['trackId'] for f in res['frames'] for o in f['objects']})}, посещений зоны {len(v)} -> {out}")
    for x in v:
        print(f"  {x['id']} {x['trackId']} {x['startSec']}–{x['endSec']} ({x['observedSec']} с, {x['status']}{', обрезано на ' + str(x['truncatedAt']) + ' с' if x['truncated'] else ''}){' — превышен демонстрационный порог' if x['overThreshold'] else ''}")


if __name__ == "__main__":
    main()
