"""Offline car detection, ByteTrack IDs, conservative zone visits and JSON export."""
import argparse
import hashlib
import json
import math
import time
from pathlib import Path

import cv2
import numpy as np
import supervision as sv
from detector import CarDetector
from visits import VisitLedger
from validate import validate


def load_config(path):
    config = json.loads(Path(path).read_text(encoding='utf-8-sig'))
    fps = config['sampleFps']
    if type(fps) is not int or not 1 <= fps <= 30:
        raise ValueError('sampleFps must be an integer 1..30')
    if len(config['zones']) != 1:
        raise ValueError('MVP supports exactly one zone')
    zone = config['zones'][0]
    polygon = zone['polygon']
    if len(polygon) < 3 or any(len(p) != 2 or any(not isinstance(v,(int,float)) or not math.isfinite(v) or not 0 <= v <= 1 for v in p) for p in polygon):
        raise ValueError('Polygon must have at least 3 normalized points')
    area = abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(polygon,polygon[1:]+polygon[:1])))/2
    if area < 1e-8:
        raise ValueError('Polygon must have nonzero area')
    for name,default in [('enterSec',.4),('exitSec',.4),('lostSec',1.),('boundaryMargin',.01)]:
        value = config.get(name,default)
        if not isinstance(value,(int,float)) or not math.isfinite(value) or value < 0 or (name=='lostSec' and value==0):
            raise ValueError(f'{name} must be finite and nonnegative; lostSec must be positive')
    if not isinstance(zone['thresholdSec'],(int,float)) or not math.isfinite(zone['thresholdSec']) or zone['thresholdSec'] <= 0 or zone['thresholdSource'] != 'demo_assumption':
        raise ValueError('Use positive demo threshold and thresholdSource=demo_assumption')
    if config['source']['synthetic'] is not False:
        raise ValueError('This model pipeline expects a real video: synthetic=false')
    if not 0 < config.get('confidence',.15) <= config.get('trackActivationThreshold',.35) < .9:
        raise ValueError('Invalid confidence thresholds')
    return config


def analyze(args):
    start = time.perf_counter()
    config = load_config(args.config)
    video, model, output = Path(args.video), Path(args.model), Path(args.output)
    if output.exists() and not args.overwrite:
        raise ValueError(f'Output exists: {output}; choose a new path or --overwrite')
    output.parent.mkdir(parents=True, exist_ok=True)
    cv2.setNumThreads(4)
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise ValueError(f'Cannot decode local file: {video}')
    width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    metadata_fps = cap.get(cv2.CAP_PROP_FPS)
    metadata_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    metadata_duration = metadata_count/metadata_fps if metadata_fps > 0 else 0
    sample_fps = config['sampleFps']
    detector = CarDetector(model, config.get('confidence', .15))
    tracker = sv.ByteTrack(track_activation_threshold=config.get('trackActivationThreshold', .35),
                           lost_track_buffer=max(1, round(config.get('lostSec',1)*30)),
                           frame_rate=round(sample_fps), minimum_consecutive_frames=1)
    zone = config['zones'][0]
    ledger = VisitLedger(zone, enter_sec=config.get('enterSec',.4), exit_sec=config.get('exitSec',.4),
                         lost_sec=config.get('lostSec',1), margin=config.get('boundaryMargin',.01))
    writer = None
    if args.annotated:
        annotated = Path(args.annotated)
        if annotated.exists() and not args.overwrite:
            raise ValueError('Annotated output exists; choose a new path or --overwrite')
        annotated.parent.mkdir(parents=True, exist_ok=True)
        writer = cv2.VideoWriter(str(annotated), cv2.VideoWriter_fourcc(*'mp4v'), sample_fps, (width,height))
        if not writer.isOpened():
            raise ValueError('Cannot create annotated MP4')
    frames = []
    previous_t, last_t, next_sample = None, 0., 0.
    intervals = []
    decoded = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            # Decoder presentation timestamp: never use frame index / metadata FPS.
            t = cap.get(cv2.CAP_PROP_POS_MSEC)/1000
            if not math.isfinite(t) or t < 0 or (previous_t is not None and t <= previous_t):
                raise ValueError('Video has missing/nonmonotonic timestamps; transcode with FFmpeg preserving timeline first')
            if previous_t is not None:
                if t-previous_t > 1/sample_fps + .005:
                    raise ValueError('Source timestamp gap exceeds sample interval; lower sampleFps in config')
                intervals.append(t-previous_t)
            previous_t, last_t = t, t
            decoded += 1
            if args.max_seconds is not None and t >= args.max_seconds:
                break
            if t + 1e-6 < next_sample:
                continue
            next_sample = (math.floor(t*sample_fps + 1e-6)+1)/sample_fps
            found = detector.detect(frame)
            detections = sv.Detections(xyxy=np.asarray([v[0] for v in found],dtype=np.float32).reshape(-1,4),
                                      confidence=np.asarray([v[1] for v in found],dtype=np.float32),
                                      class_id=np.full(len(found),2,dtype=int))
            tracked = tracker.update_with_detections(detections)
            objects = []
            for box, confidence, track_id in zip(tracked.xyxy, tracked.confidence, tracked.tracker_id):
                x1,y1,x2,y2 = map(float,box)
                objects.append({'trackId':f'car-{int(track_id)}','className':'car','confidence':round(float(confidence),5),
                                'bbox':[round(x1/width,6),round(y1/height,6),round((x2-x1)/width,6),round((y2-y1)/height,6)],'zoneId':None})
            membership = ledger.update(t,objects)
            for obj in objects:
                obj['zoneId'] = membership.get(obj['trackId'])
            frames.append({'t':round(t,6),'objects':objects})
            if writer:
                pts = (np.array(zone['polygon'])*[width,height]).astype(np.int32)
                cv2.polylines(frame,[pts],True,(255,200,0),3)
                active = {v['trackId']:v for v in ledger.visits if v['status']=='open_at_end'}
                for obj in objects:
                    x,y,w,h = obj['bbox']
                    x1,y1,x2,y2 = int(x*width),int(y*height),int((x+w)*width),int((y+h)*height)
                    visit = active.get(obj['trackId'])
                    dwell = visit['observedSec'] if visit else 0
                    possible = dwell > zone['thresholdSec']
                    color = (0,100,255) if possible else (0,255,80)
                    cv2.rectangle(frame,(x1,y1),(x2,y2),color,2)
                    label = f"{obj['trackId']} {obj['confidence']:.2f} {dwell:.1f}s"
                    if possible:
                        label += ' POSSIBLE DELAY'
                    cv2.putText(frame,label,(x1,max(70,y1-8)),cv2.FONT_HERSHEY_SIMPLEX,.65,color,2)
                cv2.rectangle(frame,(0,0),(width,60),(20,20,20),-1)
                cv2.putText(frame,f'REAL ROAD VIDEO / NOT ALLUR | MODEL YOLOX-S + ByteTrack | t={t:.2f}s',(12,25),cv2.FONT_HERSHEY_SIMPLEX,.6,(255,255,255),1)
                cv2.putText(frame,f'Demo zone threshold {zone["thresholdSec"]}s | IDs temporary | Editor / CC BY 3.0',(12,50),cv2.FONT_HERSHEY_SIMPLEX,.6,(255,255,255),1)
                writer.write(frame)
            if len(frames)%25 == 0:
                print(f'{t:.2f}s source; {len(frames)} analyzed frames; {len(ledger.visits)} visits',flush=True)
    finally:
        cap.release()
        if writer:
            writer.release()
    if not frames:
        raise ValueError('No frames analyzed')
    duration = last_t + (float(np.median(intervals)) if intervals else 0)
    if metadata_duration > 0 and (args.max_seconds is not None or abs(metadata_duration-duration) < .2):
        duration = metadata_duration
    analysis_end = min(duration,args.max_seconds) if args.max_seconds is not None else duration
    visits = ledger.finish(analysis_end)
    source = dict(config['source'],fileName=video.name,durationSec=round(duration,6),width=width,height=height)
    result = {'schemaVersion':1,'source':source,
              'analysis':{'mode':'model','model':'YOLOX-S OpenCV Zoo 2022nov ONNX + ByteTrack supervision 0.25.1',
                          'sampleFps':sample_fps,'processingSec':round(time.perf_counter()-start,3),
                          'analyzedUntilSec':round(analysis_end,6),'timestampSource':'decoder CAP_PROP_POS_MSEC',
                          'modelSha256':hashlib.sha256(model.read_bytes()).hexdigest()},
              'zones':config['zones'],'frames':frames,'visits':visits}
    validate(result)
    output.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
    print(f'Saved {output}: {len(frames)} frames, {len(visits)} visits; model mode',flush=True)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video',required=True)
    parser.add_argument('--model',required=True)
    parser.add_argument('--config',default='vision/street-traffic/config.json')
    parser.add_argument('--output',default='vision/street-traffic/analysis.json')
    parser.add_argument('--annotated',help='Optional MP4 preview; canonical timing is in JSON')
    parser.add_argument('--max-seconds',type=float,help='Analyze prefix for an early integration export')
    parser.add_argument('--overwrite',action='store_true')
    analyze(parser.parse_args())
