"""YOLOX ONNX detector (Megvii YOLOX, Apache-2.0) on onnxruntime CPU. COCO classes; we keep only cars (class 2).

Pre/post-processing follows the official YOLOX ONNXRuntime demo: letterbox to 640x640 with value 114, BGR input
without normalisation, grid decoding with strides 8/16/32, score = objectness x class probability, then NMS.
"""
from __future__ import annotations

import cv2
import numpy as np
import onnxruntime as ort

COCO_CAR = 2


class YoloxDetector:
    def __init__(self, model_path: str, input_size: int = 640, classes=(COCO_CAR,), score_thr: float = 0.1, nms_thr: float = 0.45):
        self.session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        self.size = input_size
        self.classes = tuple(classes)
        self.score_thr = score_thr
        self.nms_thr = nms_thr
        grids, strides = [], []
        for s in (8, 16, 32):
            n = input_size // s
            xv, yv = np.meshgrid(np.arange(n), np.arange(n))
            grids.append(np.stack((xv, yv), 2).reshape(-1, 2))
            strides.append(np.full((n * n, 1), s))
        self.grids = np.concatenate(grids, 0).astype(np.float32)
        self.strides = np.concatenate(strides, 0).astype(np.float32)

    def __call__(self, frame_bgr: np.ndarray):
        """Returns a list of (x1, y1, x2, y2, score, class_id) in pixels of the original frame."""
        h, w = frame_bgr.shape[:2]
        r = min(self.size / h, self.size / w)
        padded = np.full((self.size, self.size, 3), 114, dtype=np.uint8)
        resized = cv2.resize(frame_bgr, (int(w * r), int(h * r)), interpolation=cv2.INTER_LINEAR)
        padded[: resized.shape[0], : resized.shape[1]] = resized
        blob = np.ascontiguousarray(padded.transpose(2, 0, 1)[None], dtype=np.float32)
        out = self.session.run(None, {self.input_name: blob})[0][0]
        xy = (out[:, :2] + self.grids) * self.strides
        wh = np.exp(out[:, 2:4]) * self.strides
        cls = out[:, 5:].argmax(1)
        score = out[:, 4] * out[:, 5:].max(1)
        keep = (score >= self.score_thr) & np.isin(cls, self.classes)
        if not keep.any():
            return []
        xy, wh, cls, score = xy[keep], wh[keep], cls[keep], score[keep]
        boxes = np.concatenate([xy - wh / 2, xy + wh / 2], 1) / r
        idx = cv2.dnn.NMSBoxes([[float(b[0]), float(b[1]), float(b[2] - b[0]), float(b[3] - b[1])] for b in boxes], score.tolist(), self.score_thr, self.nms_thr)
        idx = np.array(idx).reshape(-1)
        res = []
        for i in idx:
            x1, y1, x2, y2 = boxes[i]
            res.append((float(max(0, x1)), float(max(0, y1)), float(min(w, x2)), float(min(h, y2)), float(score[i]), int(cls[i])))
        return res
