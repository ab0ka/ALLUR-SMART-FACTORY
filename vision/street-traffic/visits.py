"""Conservative video-time visits with spatial/temporal hysteresis."""
import math


def signed_distance(point, polygon):
    """Distance to polygon border, positive inside (normalized coordinates)."""
    x, y = point
    inside = False
    distance = float('inf')
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        ax, ay = a
        bx, by = b
        dx, dy = bx - ax, by - ay
        length2 = dx * dx + dy * dy
        u = max(0., min(1., ((x - ax) * dx + (y - ay) * dy) / length2)) if length2 else 0.
        distance = min(distance, math.hypot(x - ax - u * dx, y - ay - u * dy))
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            inside = not inside
    return distance if inside else -distance


class VisitLedger:
    """One zone; update only with objects actually detected in this frame.

    Bottom-center is the zone reference point. Missing observations never add
    dwell time. Lost tracks and EOF retain null endSec. IDs are temporary.
    """

    def __init__(self, zone, enter_sec=.4, exit_sec=.4, lost_sec=1., margin=.01):
        if len(zone['polygon']) < 3:
            raise ValueError('Zone polygon requires at least three points')
        if min(enter_sec, exit_sec, margin) < 0 or lost_sec <= 0:
            raise ValueError('Invalid hysteresis settings')
        self.zone = zone
        self.enter_sec, self.exit_sec = enter_sec, exit_sec
        self.lost_sec, self.margin = lost_sec, margin
        self.visits = []
        self._states = {}
        self._last_t = None

    def _close(self, state, status, end=None):
        visit = state['visit']
        if visit is not None:
            visit['status'] = status
            visit['endSec'] = end
            visit['observedSec'] = round(visit['observedSec'], 6)
        state['visit'] = None
        state['candidate'] = None
        state['outside'] = None

    def update(self, t, objects):
        if self._last_t is not None and t < self._last_t:
            raise ValueError('Video timestamps must be nondecreasing')
        self._last_t = t
        seen = {obj['trackId'] for obj in objects}
        # Expire before processing so a reappearing stale ID starts a new visit.
        for key, state in list(self._states.items()):
            if t - state['last_seen'] > self.lost_sec:
                self._close(state, 'lost')
                del self._states[key]
            elif key not in seen:
                state['previous_inside'] = False
                state['candidate'] = None
                state['outside'] = None
        result = {}
        for obj in objects:
            key = obj['trackId']
            x, y, width, height = obj['bbox']
            distance = signed_distance((x + width / 2, y + height), self.zone['polygon'])
            state = self._states.setdefault(key, dict(last_seen=t, previous_inside=False,
                candidate=None, candidate_observed=0., outside=None, visit=None))
            dt = t - state['last_seen']
            inside = distance >= 0
            if state['visit'] is None:
                if distance >= self.margin:
                    if state['candidate'] is None:
                        state['candidate'] = t
                        state['candidate_observed'] = 0.
                    elif state['previous_inside']:
                        state['candidate_observed'] += dt
                    if t - state['candidate'] + 1e-9 >= self.enter_sec:
                        visit = dict(id=f'visit-{len(self.visits) + 1}', trackId=key,
                            zoneId=self.zone['id'], startSec=state['candidate'], endSec=None,
                            observedSec=state['candidate_observed'], status='open_at_end')
                        self.visits.append(visit)
                        state['visit'] = visit
                        state['candidate'] = None
                else:
                    state['candidate'] = None
            else:
                if inside and state['previous_inside']:
                    state['visit']['observedSec'] += dt
                if distance <= -self.margin:
                    if state['outside'] is None:
                        state['outside'] = t
                    if t - state['outside'] + 1e-9 >= self.exit_sec:
                        self._close(state, 'completed', state['outside'])
                else:
                    state['outside'] = None
            state['last_seen'] = t
            state['previous_inside'] = inside
            result[key] = self.zone['id'] if state['visit'] is not None else None
        return result

    def finish(self, t):
        """Finalize at video end, preserving whether a track was already lost."""
        if self._last_t is not None and t < self._last_t:
            raise ValueError('Video end precedes last observation')
        for state in self._states.values():
            self._close(state, 'lost' if t - state['last_seen'] > self.lost_sec else 'open_at_end')
        self._states.clear()
        return self.visits
