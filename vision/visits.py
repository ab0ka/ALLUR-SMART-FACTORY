"""Zone visits from per-sample observations with hysteresis against jitter at the zone border.

A track is "inside" when the bottom-centre of its box (the contact point with the ground) is inside the zone polygon.
Entry is confirmed after `enter_sec` of continuous inside samples, exit after `exit_sec` of continuous outside samples;
the visit spans from the first inside sample of the entry run to the last inside sample before the exit run.
If the track disappears while inside, the visit is "lost" (endSec = null): losing a track is not a confirmed exit.
If the recording ends while inside, the visit is "open_at_end" (endSec = null). If the measurement is stopped at the end
of a validity window (e.g. the camera starts moving), a visit still inside is "open_at_end" with truncated = true and
truncatedAt = the end of the window. Times are seconds of the recording.
"""
from __future__ import annotations


def point_in_polygon(x: float, y: float, poly) -> bool:
    inside, n = False, len(poly)
    for i in range(n):
        x1, y1 = poly[i]; x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1:
            inside = not inside
    return inside


class VisitLog:
    def __init__(self, zone: dict, enter_sec: float = 0.4, exit_sec: float = 0.8):
        self.zone, self.enter_sec, self.exit_sec = zone, enter_sec, exit_sec
        self.state: dict[str, dict] = {}  # trackId -> {inside, run_start, last_in, out_since, visit}
        self.visits: list[dict] = []

    def observe(self, track_id: str, t: float, inside: bool):
        s = self.state.setdefault(track_id, {"inside": False, "run_start": None, "last_in": None, "out_since": None, "visit": None, "last_seen": t})
        s["last_seen"] = t
        if inside:
            s["out_since"] = None
            s["last_in"] = t
            if not s["inside"]:
                if s["run_start"] is None:
                    s["run_start"] = t
                if t - s["run_start"] >= self.enter_sec:
                    s["inside"] = True
                    s["visit"] = {"trackId": track_id, "zoneId": self.zone["id"], "startSec": round(s["run_start"], 2), "endSec": None, "status": None}
        else:
            if not s["inside"]:
                s["run_start"] = None
                return
            if s["out_since"] is None:
                s["out_since"] = t
            if t - s["out_since"] >= self.exit_sec:
                self._close(s, "completed", s["last_in"])

    def _close(self, s, status: str, end_t):
        v = s["visit"]
        v["status"] = status
        v["endSec"] = round(end_t, 2) if status == "completed" else None
        observed_until = end_t if status == "completed" else s["last_in"] if status == "lost" else end_t
        v["observedSec"] = round(observed_until - v["startSec"], 2)
        self.visits.append(v)
        s.update({"inside": False, "run_start": None, "out_since": None, "visit": None})

    def track_lost(self, track_id: str):
        s = self.state.get(track_id)
        if s and s["inside"]:
            self._close(s, "lost", s["last_in"])

    def finish(self, end_t: float, truncated: bool = False):
        """Close visits still inside at `end_t`. end_t is the end of the recording, or (truncated=True) the end of the
        validity window: the measurement stops there, so a visit inside at that moment is "open_at_end" with
        truncated = true and truncatedAt = end_t; its observedSec is a lower bound measured only up to end_t.
        A visit already in its exit run (outside for less than exit_sec) is counted up to its last inside sample."""
        for tid, s in self.state.items():
            if s["inside"]:
                if truncated:
                    s["visit"]["truncated"], s["visit"]["truncatedAt"] = True, round(end_t, 2)
                self._close(s, "open_at_end", end_t if s["out_since"] is None else s["last_in"])
        thr = self.zone.get("thresholdSec")
        self.visits.sort(key=lambda v: (v["startSec"], v["trackId"]))
        for i, v in enumerate(self.visits, 1):
            v["id"] = f"visit-{i}"
            v["overThreshold"] = thr is not None and v["observedSec"] > thr  # above a demo threshold; the cause is not determined
            v.setdefault("truncated", False); v.setdefault("truncatedAt", None)
        return [{k: v[k] for k in ("id", "trackId", "zoneId", "startSec", "endSec", "observedSec", "status", "truncated", "truncatedAt", "overThreshold")} for v in self.visits]
