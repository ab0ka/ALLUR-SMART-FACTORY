"""Download the model and the demo recording outside Git (F:/allur-vision) and print SHA-256 for the record.

  python vision/fetch.py
"""
import hashlib
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path("F:/allur-vision") if Path("F:/").exists() else Path(__file__).resolve().parent / "_data"
FILES = [
    ("models/yolox_s.onnx", "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.onnx"),
    ("video/pexels-5675618-cars-traffic-light.mp4", "https://videos.pexels.com/video-files/5675618/5675618-hd_1920_1080_30fps.mp4"),
]
for rel, url in FILES:
    dst = ROOT / rel
    if dst.exists():
        print(f"есть: {dst}")
    else:
        dst.parent.mkdir(parents=True, exist_ok=True)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (allur-smart-factory vision demo)"})
            with urllib.request.urlopen(req, timeout=120) as r, open(dst, "wb") as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
        except Exception as e:  # e.g. Python's certificate store is outdated: use Windows curl (system certificates)
            print(f"urllib: {type(e).__name__}; пробую curl.exe")
            dst.unlink(missing_ok=True)
            subprocess.run(["curl.exe", "-sSL", "--fail", "-A", "Mozilla/5.0", "-o", str(dst), url], check=True)
    h = hashlib.sha256(dst.read_bytes()).hexdigest()
    print(f"{dst}  {dst.stat().st_size / 1e6:.1f} МБ  sha256 {h}")
