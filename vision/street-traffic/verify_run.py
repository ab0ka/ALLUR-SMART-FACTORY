"""Verify JSON/source timestamp alignment and decode the complete annotated video."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import cv2
from validate import validate

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--analysis',default='vision/street-traffic/analysis.json')
p.add_argument('--video',default='vision/street-traffic/cache/street-traffic.webm')
p.add_argument('--annotated',default='vision/street-traffic/cache/annotated.mp4')
p.add_argument('--report',default='vision/street-traffic/verification.json')
p.add_argument('--preview',default='vision/street-traffic/preview.jpg')
a = p.parse_args()
data = json.loads(Path(a.analysis).read_text(encoding='utf-8'))
summary = validate(data)
cap = cv2.VideoCapture(a.video)
pts=[]
while True:
    ok,_ = cap.read()
    if not ok:
        break
    pts.append(cap.get(cv2.CAP_PROP_POS_MSEC)/1000)
cap.release()
assert pts, 'Source decode failed'
assert all(b>a for a,b in zip(pts,pts[1:])), 'Source PTS not monotonic'
for frame in data['frames']:
    assert min(abs(t-frame['t']) for t in pts)<.001, 'JSON timestamp not from a source frame'
cap = cv2.VideoCapture(a.annotated)
assert cap.isOpened(), 'Annotated video did not open'
fps = cap.get(cv2.CAP_PROP_FPS)
decoded = 0
while True:
    ok,frame = cap.read()
    if not ok:
        break
    if decoded==min(125,len(data['frames'])-1):
        cv2.imwrite(a.preview,frame)
    decoded+=1
cap.release()
assert decoded==len(data['frames']), 'Annotated frame count differs from JSON'
assert abs(fps-data['analysis']['sampleFps'])<.01, 'Annotated FPS mismatch'
report = {
    'schemaValidation':'passed', 'timestampAlignment':'all JSON timestamps match decoded source PTS',
    'sourceDecodedFrames':len(pts),'sourceFirstPts':pts[0],'sourceLastPts':pts[-1],
    'annotatedDecodedFrames':decoded,'annotatedFps':fps,'annotatedDurationSec':decoded/fps,
    'summary':summary,'statuses':dict(Counter(v['status'] for v in data['visits'])),
    'visitsOverDemoThreshold':sum(v['observedSec']>data['zones'][0]['thresholdSec'] for v in data['visits']),
    'maxObservedSec':max((v['observedSec'] for v in data['visits']),default=0),
    'processingSec':data['analysis']['processingSec'],
    'sourceSha256':hashlib.sha256(Path(a.video).read_bytes()).hexdigest(),
    'analysisSha256':hashlib.sha256(Path(a.analysis).read_bytes()).hexdigest(),
    'limitations':['No ground truth accuracy measurement','Temporary IDs may split after occlusion','Road demonstration, not Allur','No real-time claim']
}
Path(a.report).write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
