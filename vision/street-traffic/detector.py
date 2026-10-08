"""YOLOX-S 2022nov, OpenCV Zoo ONNX. Only COCO class 2 (car).

Preprocessing follows the model's RGB, 0..255, top-left letterbox contract.
No training and no manual labels. License/source recorded in MODEL.md.
"""
import cv2
import numpy as np


class CarDetector:
    def __init__(self, model, confidence=0.15, nms=0.45):
        self.net = cv2.dnn.readNetFromONNX(str(model))
        self.confidence, self.nms = confidence, nms
        grids, strides = [], []
        for stride in (8, 16, 32):
            yy, xx = np.mgrid[:640 // stride, :640 // stride]
            grids.append(np.stack((xx, yy), axis=-1).reshape(-1, 2))
            strides.append(np.full((xx.size, 1), stride))
        self.grid = np.concatenate(grids)
        self.strides = np.concatenate(strides)

    def detect(self, frame):
        height, width = frame.shape[:2]
        ratio = min(640 / width, 640 / height)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        resized = cv2.resize(rgb, (int(width * ratio), int(height * ratio)))
        padded = np.full((640, 640, 3), 114, dtype=np.float32)
        padded[:resized.shape[0], :resized.shape[1]] = resized
        self.net.setInput(padded.transpose(2, 0, 1)[None])
        pred = self.net.forward()[0]
        scores = pred[:, 4] * pred[:, 7]
        keep = (pred[:, 5:].argmax(axis=1) == 2) & (scores >= self.confidence)
        xy = (pred[keep, :2] + self.grid[keep]) * self.strides[keep]
        wh = np.exp(pred[keep, 2:4]) * self.strides[keep]
        boxes = np.column_stack((xy - wh / 2, wh)) / ratio
        scores = scores[keep]
        selected = cv2.dnn.NMSBoxes(boxes.tolist(), scores.tolist(), self.confidence, self.nms)
        result = []
        for i in np.asarray(selected).reshape(-1):
            x, y, w, h = boxes[i]
            x1, y1 = max(0., x), max(0., y)
            x2, y2 = min(float(width), x + w), min(float(height), y + h)
            if x2 > x1 and y2 > y1:
                result.append(([x1, y1, x2, y2], float(scores[i])))
        return result
