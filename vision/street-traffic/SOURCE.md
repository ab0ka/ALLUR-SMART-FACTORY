# Real video source for the MVP

Selected recording: **Street traffic in San Francisco**, filmed 28 May 2011, by **Editor** (https://www.youtube.com/user/Editor).

- Source page: https://commons.wikimedia.org/wiki/File:Street_traffic.webm
- Original publication: https://www.youtube.com/watch?v=_7sCYyxw4Ic
- Direct download: https://upload.wikimedia.org/wikipedia/commons/7/70/Street_traffic.webm
- License: **Creative Commons Attribution 3.0 Unported**, https://creativecommons.org/licenses/by/3.0/
- Required credit: Editor, source link, license link; indicate modifications such as analytical overlays or transcoding. No endorsement is implied.
- Downloaded local file: `vision/street-traffic/cache/street-traffic.webm` (26,490,572 bytes).
- Container/codecs reported by source: WebM, VP8/Vorbis, 1920 × 1080, approximately 35.004 seconds.
- OpenCV reports an erroneous nominal FPS of 1000 (WebM timebase). Sequential decoded timestamps show frame 150 at 5.0 s and frame 450 at 15.0 s. Use decoded source timestamps, not nominal FPS or playback speed.

This is a **road-traffic demonstration in San Francisco, not Allur factory footage**. It can demonstrate object detection, temporary tracking IDs, and measured presence in a manually configured image zone. It cannot establish factory production delays or their causes. The threshold is a demonstration assumption.

Visual checks of frames at 0, 5, and 15 seconds show a fixed camera, real cars, buses, trucks, partial occlusion, and people. Cars become more clearly visible after the opening seconds. The intended pipeline tracks only cars; it does not identify people or read plates.

The proposed Pexels factory clip (https://www.pexels.com/video/automated-car-factory-6450803/) was reviewed as an alternative: 8 seconds, 1920 × 1080, 25 fps, robotic arms and unfinished bodies. It is unsuitable evidence for production delays. Other quickly found factory footage used moving cameras or unfinished bodies. The road recording was chosen for a reproducible real-model MVP.

Source and license pages checked on 8 October 2026. No video is committed to Git.
