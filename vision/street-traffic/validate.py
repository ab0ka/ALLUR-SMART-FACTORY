"""Validate the exported handoff JSON without third-party dependencies."""
import argparse
import json
import math
from pathlib import Path


def validate(data):
    def require(condition, message):
        if not condition:
            raise ValueError(message)

    def number(value, name, low=0, high=float('inf')):
        require(isinstance(value, (int, float)) and not isinstance(value, bool)
                and math.isfinite(value) and low <= value <= high, f'Invalid {name}: {value}')

    require(data['schemaVersion'] == 1, 'Expected schemaVersion 1')
    source, analysis = data['source'], data['analysis']
    for key in ('id', 'fileName', 'title', 'license'):
        require(isinstance(source[key], str) and bool(source[key]), f'Missing source.{key}')
    require(isinstance(source['url'], str), 'source.url must be a string (empty for local private video)')
    require(isinstance(source['synthetic'], bool), 'source.synthetic must be boolean')
    number(source['durationSec'], 'durationSec', low=1e-9)
    for key in ('width', 'height'):
        require(isinstance(source[key], int) and source[key] > 0, f'Invalid {key}')
    require(analysis['mode'] in ('model', 'manual', 'synthetic'), 'Invalid analysis.mode')
    require(analysis['mode'] != 'synthetic' or source['synthetic'], 'Synthetic mode must identify synthetic source')
    require(isinstance(analysis['model'], str), 'analysis.model must be string')
    number(analysis['sampleFps'], 'sampleFps', low=1e-9)
    number(analysis['processingSec'], 'processingSec')
    end = analysis.get('analyzedUntilSec', source['durationSec'])
    number(end, 'analyzedUntilSec', high=source['durationSec'] + 1e-6)
    zones = set()
    for zone in data['zones']:
        require(zone['id'] not in zones, 'Duplicate zone ID')
        zones.add(zone['id'])
        require(isinstance(zone['name'], str), 'Invalid zone name')
        require(len(zone['polygon']) >= 3, 'Invalid zone polygon')
        for point in zone['polygon']:
            require(len(point) == 2, 'Zone point must be xy')
            for value in point:
                number(value, 'polygon coordinate', high=1)
        number(zone['thresholdSec'], 'thresholdSec', low=1e-9)
        require(isinstance(zone['thresholdSource'], str) and bool(zone['thresholdSource']), 'Missing thresholdSource')
    require(bool(zones), 'No zones')
    previous, observed_tracks = -1., set()
    for frame in data['frames']:
        number(frame['t'], 'frame.t', high=end + 1e-6)
        require(frame['t'] > previous, 'Frame timestamps must be strictly increasing')
        previous = frame['t']
        frame_ids = set()
        for obj in frame['objects']:
            track = obj['trackId']
            require(isinstance(track, str) and bool(track) and track not in frame_ids, 'Invalid/duplicate frame track ID')
            frame_ids.add(track)
            observed_tracks.add(track)
            require(isinstance(obj['className'], str) and bool(obj['className']), 'Missing className')
            number(obj['confidence'], 'confidence', high=1)
            require(len(obj['bbox']) == 4, 'bbox must be xywh')
            x, y, width, height = obj['bbox']
            for value in (x,y,width,height):
                number(value, 'bbox coordinate', high=1)
            require(width > 0 and height > 0 and x + width <= 1.000002 and y + height <= 1.000002, 'bbox outside source')
            require(obj['zoneId'] is None or obj['zoneId'] in zones, 'Unknown object zone')
    require(bool(data['frames']), 'No analyzed frames')
    visit_ids = set()
    for visit in data['visits']:
        require(visit['id'] not in visit_ids, 'Duplicate visit ID')
        visit_ids.add(visit['id'])
        require(visit['trackId'] in observed_tracks, 'Visit references unseen track')
        require(visit['zoneId'] in zones, 'Unknown visit zone')
        number(visit['startSec'], 'startSec', high=end + 1e-6)
        require(visit['status'] in ('completed','lost','open_at_end'), 'Invalid visit status')
        if visit['status'] == 'completed':
            number(visit['endSec'], 'endSec', low=visit['startSec'], high=end + 1e-6)
            visit_end = visit['endSec']
        else:
            require(visit['endSec'] is None, 'Unconfirmed exit must have endSec=null')
            visit_end = end
        number(visit['observedSec'], 'observedSec', high=visit_end - visit['startSec'] + 2e-6)
    return dict(frames=len(data['frames']), tracks=len(observed_tracks), visits=len(data['visits']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path')
    args = parser.parse_args()
    result = validate(json.loads(Path(args.path).read_text(encoding='utf-8-sig')))
    print('VALID:', result)
