"""Inspect real detections before choosing a zone: python vision/street-traffic/probe.py ..."""
import argparse
import json
from pathlib import Path
import cv2
from detector import CarDetector

p = argparse.ArgumentParser()
p.add_argument('--video', required=True)
p.add_argument('--model', required=True)
p.add_argument('--output', default='vision/street-traffic/probe')
a = p.parse_args()
out = Path(a.output)
out.mkdir(parents=True, exist_ok=True)
cap = cv2.VideoCapture(a.video)
if not cap.isOpened():
    raise SystemExit('Cannot decode video')
fps = cap.get(cv2.CAP_PROP_FPS)
count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
report = {'fps': fps, 'frameCount': count, 'durationSec': count/fps,
          'width': cap.get(cv2.CAP_PROP_FRAME_WIDTH), 'height': cap.get(cv2.CAP_PROP_FRAME_HEIGHT), 'samples': []}
detector = CarDetector(a.model, confidence=.35)
cv2.setNumThreads(4)
targets = iter((0, 5, 10, 20, 30))
target = next(targets)
while True:
    ok, frame = cap.read()
    if not ok:
        break
    t = cap.get(cv2.CAP_PROP_POS_MSEC)/1000
    if t < target:
        continue
    detections = detector.detect(frame)
    for box, conf in detections:
        x1,y1,x2,y2 = map(int, box)
        cv2.rectangle(frame, (x1,y1), (x2,y2), (0,255,0), 2)
        cv2.putText(frame, f'car {conf:.2f}', (x1,max(20,y1-5)), cv2.FONT_HERSHEY_SIMPLEX, .7,(0,255,0),2)
    cv2.imwrite(str(out / f'frame-{target:02}.jpg'), frame)
    report['samples'].append({'t': t, 'cars': len(detections), 'detections': detections})
    print(f't={t}: {len(detections)} cars', flush=True)
    target = next(targets, None)
    if target is None:
        break
cap.release()
(out / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='samples'}))
