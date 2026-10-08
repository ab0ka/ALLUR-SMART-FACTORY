import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate import validate


def fixture():
    return dict(schemaVersion=1,
        source=dict(id='test',fileName='video.mp4',title='Test fixture',url='https://example.org',license='test',synthetic=False,durationSec=10,width=100,height=100),
        analysis=dict(mode='model',model='test',sampleFps=5,processingSec=1),
        zones=[dict(id='z',name='Zone',polygon=[[0,0],[1,0],[1,1]],thresholdSec=3,thresholdSource='demo_assumption')],
        frames=[dict(t=0,objects=[dict(trackId='car-1',className='car',confidence=.9,bbox=[.1,.1,.2,.2],zoneId='z')])],
        visits=[dict(id='v',trackId='car-1',zoneId='z',startSec=0,endSec=None,observedSec=0,status='open_at_end')])


class ValidationTests(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(validate(fixture()),dict(frames=1,tracks=1,visits=1))

    def test_private_local_video_can_have_empty_url(self):
        data=fixture()
        data['source']['url']=''
        self.assertEqual(validate(data)['frames'],1)

    def test_loss_cannot_claim_exit(self):
        data=fixture()
        data['visits'][0].update(status='lost',endSec=1)
        with self.assertRaises(ValueError): validate(data)

    def test_bbox_must_be_inside_source(self):
        data=fixture()
        data['frames'][0]['objects'][0]['bbox']=[.9,.1,.2,.2]
        with self.assertRaises(ValueError): validate(data)

    def test_duplicate_timestamp_rejected(self):
        data=fixture()
        data['frames'].append(copy.deepcopy(data['frames'][0]))
        with self.assertRaises(ValueError): validate(data)

    def test_nonfinite_value_rejected(self):
        data=fixture()
        data['zones'][0]['thresholdSec']=float('nan')
        with self.assertRaises(ValueError): validate(data)

    def test_dwell_cannot_exceed_interval(self):
        data=fixture()
        data['visits'][0].update(status='completed',endSec=1,observedSec=2)
        with self.assertRaises(ValueError): validate(data)


if __name__ == '__main__': unittest.main()
