"""Contact sheets for manual annotation: frames with the zone and the time only (no model boxes).

  python presentation/tools/frames.py --from 0 --to 24 --step 1 --out sheet-overview.jpg
  python presentation/tools/frames.py --from 8 --to 10 --step 0.2 --crop 0,0.5,0.5,1 --out sheet-blue-entry.jpg
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
ap = argparse.ArgumentParser()
ap.add_argument("--config", default=str(ROOT / "vision" / "config" / "clip-01.json"))
ap.add_argument("--from", dest="t0", type=float, default=0)
ap.add_argument("--to", dest="t1", type=float, default=24)
ap.add_argument("--step", type=float, default=1)
ap.add_argument("--crop", default="0,0,1,1", help="x0,y0,x1,y1 normalised")
ap.add_argument("--cols", type=int, default=4)
ap.add_argument("--out", default="sheet.jpg")
a = ap.parse_args()
cfg = json.loads(Path(a.config).read_text(encoding="utf-8"))
cap = cv2.VideoCapture(cfg["videoPath"])
fps = cap.get(cv2.CAP_PROP_FPS)
x0, y0, x1, y1 = map(float, a.crop.split(","))
tiles = []
t = a.t0
while t <= a.t1 + 1e-6:
    cap.set(cv2.CAP_PROP_POS_FRAMES, round(t * fps))
    ok, img = cap.read()
    if not ok:
        break
    h, w = img.shape[:2]
    pts = np.array([[int(px * w), int(py * h)] for px, py in cfg["zone"]["polygon"]], np.int32)
    cv2.polylines(img, [pts], True, (60, 220, 60), 4)
    img = img[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)]
    img = cv2.resize(img, (480, int(480 * img.shape[0] / img.shape[1])))
    cv2.putText(img, f"t={t:.1f}s f={round(t * fps)}", (8, 28), cv2.FONT_HERSHEY_SIMPLEX, .8, (0, 0, 0), 4)
    cv2.putText(img, f"t={t:.1f}s f={round(t * fps)}", (8, 28), cv2.FONT_HERSHEY_SIMPLEX, .8, (255, 255, 255), 2)
    tiles.append(img)
    t += a.step
while len(tiles) % a.cols:
    tiles.append(np.zeros_like(tiles[0]))
sheet = np.vstack([np.hstack(tiles[i:i + a.cols]) for i in range(0, len(tiles), a.cols)])
out = ROOT / "presentation" / "verification" / "frames" / a.out
out.parent.mkdir(parents=True, exist_ok=True)
cv2.imwrite(str(out), sheet, [cv2.IMWRITE_JPEG_QUALITY, 82])
print(out)
