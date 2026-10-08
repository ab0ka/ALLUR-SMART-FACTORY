"""Unit tests for the visit log (no model, no video): python -m unittest vision/test_visits.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from visits import VisitLog, point_in_polygon  # noqa: E402

ZONE = {"id": "zone-1", "name": "test", "polygon": [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]], "thresholdSec": 5, "thresholdSource": "test"}


def feed(log, tid, pattern, dt=0.2, t0=0.0):
    t = t0
    for inside in pattern:
        log.observe(tid, t, inside); t += dt
    return t


class Visits(unittest.TestCase):
    def test_polygon(self):
        self.assertTrue(point_in_polygon(0.5, 0.5, ZONE["polygon"]))
        self.assertFalse(point_in_polygon(0.9, 0.5, ZONE["polygon"]))

    def test_completed_visit_ignores_border_jitter(self):
        log = VisitLog(ZONE, enter_sec=0.4, exit_sec=0.8)
        # outside, then inside 6 s with two short dips (jitter), then outside for good
        t = feed(log, "car-1", [False] * 3 + [True] * 10 + [False] + [True] * 10 + [False, False] + [True] * 10 + [False] * 8)
        v = log.finish(t)
        self.assertEqual(len(v), 1, "jitter must not split the visit")
        self.assertEqual(v[0]["status"], "completed")
        self.assertAlmostEqual(v[0]["startSec"], 0.6, places=2)
        self.assertGreater(v[0]["observedSec"], 6)
        self.assertTrue(v[0]["overThreshold"])

    def test_short_touch_is_not_a_visit(self):
        log = VisitLog(ZONE, enter_sec=0.4)
        t = feed(log, "car-2", [False, True, False, True, False] * 3)
        self.assertEqual(log.finish(t), [])

    def test_lost_track_is_not_an_exit(self):
        log = VisitLog(ZONE)
        feed(log, "car-3", [True] * 10)
        log.track_lost("car-3")
        v = log.finish(10)
        self.assertEqual(v[0]["status"], "lost")
        self.assertIsNone(v[0]["endSec"])

    def test_open_at_end(self):
        log = VisitLog(ZONE)
        t = feed(log, "car-4", [True] * 10)
        v = log.finish(t)
        self.assertEqual(v[0]["status"], "open_at_end")
        self.assertIsNone(v[0]["endSec"])
        self.assertAlmostEqual(v[0]["observedSec"], t, places=1)
        self.assertFalse(v[0]["truncated"])
        self.assertIsNone(v[0]["truncatedAt"])

    def test_truncated_at_end_of_validity_window(self):
        # camera moves from 3.0 s: the measurement stops there; car-5 still inside, car-6 already left, car-7 leaving
        log = VisitLog(ZONE, enter_sec=0.4, exit_sec=0.8)
        feed(log, "car-5", [True] * 15)                     # 0.0..2.8 inside
        feed(log, "car-6", [True] * 5 + [False] * 10)       # 0.0..0.8 inside, then outside for good
        feed(log, "car-7", [True] * 13 + [False] * 2)       # inside until 2.4, outside 2.6..2.8 (exit not yet confirmed)
        v = {x["trackId"]: x for x in log.finish(3.0, truncated=True)}
        self.assertEqual(v["car-5"]["status"], "open_at_end")
        self.assertTrue(v["car-5"]["truncated"])
        self.assertEqual(v["car-5"]["truncatedAt"], 3.0)
        self.assertIsNone(v["car-5"]["endSec"])
        self.assertAlmostEqual(v["car-5"]["observedSec"], 3.0, places=2, msg="measured only up to the end of the window")
        self.assertAlmostEqual(v["car-7"]["observedSec"], 2.4, places=2, msg="a visit in its exit run counts to the last inside sample")
        self.assertTrue(v["car-7"]["truncated"])
        self.assertEqual(v["car-6"]["status"], "completed")
        self.assertFalse(v["car-6"]["truncated"])
        self.assertIsNone(v["car-6"]["truncatedAt"])
        self.assertEqual(v["car-6"]["endSec"], 0.8)


if __name__ == "__main__":
    unittest.main()
