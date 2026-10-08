import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from visits import VisitLedger, signed_distance

ZONE = dict(id='zone-1', polygon=[[.2,.2],[.8,.2],[.8,.8],[.2,.8]])


def car(x=.5):
    return dict(trackId='car-1', bbox=[x-.05, .4, .1, .1])


class VisitTests(unittest.TestCase):
    def active(self):
        ledger = VisitLedger(ZONE)
        ledger.update(0, [car()])
        ledger.update(.2, [car()])
        ledger.update(.4, [car()])
        return ledger

    def test_polygon(self):
        self.assertAlmostEqual(signed_distance((.5,.5), ZONE['polygon']), .3)
        self.assertLess(signed_distance((.9,.5), ZONE['polygon']), 0)

    def test_boundary_jitter_does_not_close_visit(self):
        ledger = self.active()
        for t, x in [(0.6,.799),(.8,.801),(1.,.799),(1.2,.801),(1.4,.5)]:
            self.assertEqual(ledger.update(t,[car(x)])['car-1'], 'zone-1')
        ledger.finish(1.4)
        self.assertEqual(len(ledger.visits),1)
        self.assertEqual(ledger.visits[0]['status'],'open_at_end')

    def test_confirmed_exit_backdates_to_first_outside(self):
        ledger = self.active()
        ledger.update(.6,[car()])
        ledger.update(.8,[car(.9)])
        ledger.update(1.,[car(.9)])
        self.assertIsNone(ledger.update(1.2,[car(.9)])['car-1'])
        visit = ledger.visits[0]
        self.assertEqual(visit['status'],'completed')
        self.assertEqual(visit['startSec'],0)
        self.assertEqual(visit['endSec'],.8)
        self.assertAlmostEqual(visit['observedSec'],.6)

    def test_loss_has_no_exit_and_no_gap_dwell(self):
        ledger = self.active()
        ledger.update(.6,[])
        ledger.update(.8,[car()])
        ledger.update(1.,[car()])
        ledger.update(2.1,[])
        visit = ledger.visits[0]
        self.assertEqual(visit['status'],'lost')
        self.assertIsNone(visit['endSec'])
        self.assertAlmostEqual(visit['observedSec'],.6)

    def test_eof_and_reentry(self):
        ledger = self.active()
        ledger.update(.6,[car(.9)])
        ledger.update(1.,[car(.9)])
        ledger.update(1.2,[car()])
        ledger.update(1.6,[car()])
        ledger.finish(1.6)
        self.assertEqual([v['status'] for v in ledger.visits],['completed','open_at_end'])
        self.assertIsNone(ledger.visits[-1]['endSec'])
        self.assertEqual(ledger.visits[-1]['startSec'],1.2)

    def test_unconfirmed_entry_is_not_visit(self):
        ledger = VisitLedger(ZONE)
        ledger.update(0,[car()])
        ledger.update(.2,[car(.9)])
        self.assertEqual(ledger.finish(.2),[])

    def test_missing_observation_breaks_exit_confirmation(self):
        ledger = self.active()
        ledger.update(.6,[car(.9)])
        ledger.update(.8,[])
        ledger.update(1.,[car(.9)])
        ledger.finish(1.)
        self.assertEqual(ledger.visits[0]['status'],'open_at_end')

    def test_reappearing_stale_id_starts_new_visit(self):
        ledger = self.active()
        ledger.update(2.,[car()])
        ledger.update(2.4,[car()])
        ledger.finish(2.4)
        self.assertEqual([v['status'] for v in ledger.visits],['lost','open_at_end'])


if __name__ == '__main__':
    unittest.main()
