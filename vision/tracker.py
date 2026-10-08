"""A small ByteTrack-style tracker: two-stage IoU association (high-score detections first, then low-score ones
for tracks left unmatched), constant-velocity prediction, tentative -> confirmed after `min_hits`, and a lost
track is kept for `max_lost_sec` before it is removed. IDs are temporary (car-1, car-2, ...) and anonymous.
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import linear_sum_assignment


def iou_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)))
    x1 = np.maximum(a[:, None, 0], b[None, :, 0]); y1 = np.maximum(a[:, None, 1], b[None, :, 1])
    x2 = np.minimum(a[:, None, 2], b[None, :, 2]); y2 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area = lambda r: (r[:, 2] - r[:, 0]) * (r[:, 3] - r[:, 1])
    return inter / (area(a)[:, None] + area(b)[None, :] - inter + 1e-9)


class Track:
    def __init__(self, tid: int, box, score: float, t: float):
        self.id = f"car-{tid}"
        self.box = np.array(box[:4], dtype=float)
        self.vel = np.zeros(4)
        self.score = score
        self.hits = 1
        self.first_t = t
        self.last_t = t
        self.confirmed = False

    def predict(self, dt: float) -> np.ndarray:
        return self.box + self.vel * dt

    def update(self, box, score: float, t: float):
        dt = max(1e-6, t - self.last_t)
        new = np.array(box[:4], dtype=float)
        self.vel = 0.6 * self.vel + 0.4 * (new - self.box) / dt
        self.box, self.score, self.last_t = new, score, t
        self.hits += 1


class ByteTrackLite:
    def __init__(self, high: float = 0.5, low: float = 0.1, match_iou: float = 0.3, min_hits: int = 2, max_lost_sec: float = 1.5):
        self.high, self.low, self.match_iou, self.min_hits, self.max_lost_sec = high, low, match_iou, min_hits, max_lost_sec
        self.tracks: list[Track] = []
        self.next_id = 1
        self.removed: list[Track] = []

    def _match(self, tracks, dets, t):
        if not tracks or not dets:
            return [], list(range(len(tracks))), list(range(len(dets)))
        pred = np.array([tr.predict(t - tr.last_t) for tr in tracks])
        iou = iou_matrix(pred, np.array([d[:4] for d in dets]))
        rows, cols = linear_sum_assignment(-iou)
        pairs = [(r, c) for r, c in zip(rows, cols) if iou[r, c] >= self.match_iou]
        mr, mc = {r for r, _ in pairs}, {c for _, c in pairs}
        return pairs, [i for i in range(len(tracks)) if i not in mr], [j for j in range(len(dets)) if j not in mc]

    def step(self, dets, t: float):
        """dets: list of (x1, y1, x2, y2, score, cls). Returns confirmed tracks seen at time t."""
        high = [d for d in dets if d[4] >= self.high]
        low = [d for d in dets if self.low <= d[4] < self.high]
        pairs, um_t, um_d = self._match(self.tracks, high, t)
        for r, c in pairs:
            self.tracks[r].update(high[c], high[c][4], t)
        rest = [self.tracks[i] for i in um_t]
        pairs2, um_t2, _ = self._match(rest, low, t)
        for r, c in pairs2:
            rest[r].update(low[c], low[c][4], t)
        for j in um_d:  # only confident detections start new tracks
            self.tracks.append(Track(self.next_id, high[j], high[j][4], t)); self.next_id += 1
        seen = []
        for tr in list(self.tracks):
            if tr.last_t == t:
                if tr.hits >= self.min_hits:
                    tr.confirmed = True
                if tr.confirmed:
                    seen.append(tr)
            elif t - tr.last_t > self.max_lost_sec:
                self.tracks.remove(tr)
                if tr.confirmed:
                    self.removed.append(tr)
        return seen
