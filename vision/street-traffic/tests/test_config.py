import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analyze import load_config


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((Path(__file__).resolve().parents[1] / 'config.json').read_text(encoding='utf-8-sig'))

    def load(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'config.json'
            path.write_text(json.dumps(self.config), encoding='utf-8')
            return load_config(path)

    def test_shipped_config_loads(self):
        self.assertEqual(self.load(), self.config)

    def test_nonfinite_threshold_rejected(self):
        for value in (float('nan'), float('inf'), -float('inf')):
            with self.subTest(value=value):
                self.config['zones'][0]['thresholdSec'] = value
                with self.assertRaises(ValueError):
                    self.load()

    def test_invalid_sample_rate_rejected(self):
        for value in (2.5, 31, 0, True):
            with self.subTest(value=value):
                self.config['sampleFps'] = value
                with self.assertRaises(ValueError):
                    self.load()

    def test_invalid_polygon_point_rejected(self):
        for point in ([1.01,.5], [-.1,.5], [.1], [.1,.2,.3], [float('nan'),.5]):
            with self.subTest(point=point):
                self.config['zones'][0]['polygon'][0] = point
                with self.assertRaises(ValueError):
                    self.load()

    def test_activation_threshold_rejected_before_new_tracks_impossible(self):
        for value in (.9, .95, 1., float('nan')):
            with self.subTest(value=value):
                self.config['trackActivationThreshold'] = value
                with self.assertRaises(ValueError):
                    self.load()


if __name__ == '__main__':
    unittest.main()
