#!/usr/bin/env bash
set -euo pipefail
umask 077
cd -- "$(dirname -- "$0")"
command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null
python3 -c 'import sys; assert sys.version_info[:2] == (3, 12), "Use Python 3.12"'
python3 -m venv .venv
.venv/bin/python -m pip install --disable-pip-version-check -r requirements.lock.txt
mkdir -p models videos results
chmod 700 models videos results
.venv/bin/python - <<'PY'
import hashlib
from pathlib import Path
import urllib.request
model = Path('models/pose_landmarker_lite.task')
expected = '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a'
if not model.exists():
    url = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
    with urllib.request.urlopen(url, timeout=45) as response:
        data = response.read(20 * 1024**2)
    if hashlib.sha256(data).hexdigest() != expected:
        raise SystemExit('Model checksum mismatch; nothing installed')
    with model.open('xb') as output:
        output.write(data)
with model.open('rb') as file:
    if hashlib.file_digest(file, 'sha256').hexdigest() != expected:
        raise SystemExit('Existing model checksum mismatch; preserve it and investigate')
print('Official lite model checksum verified.')
PY
.venv/bin/python -m unittest discover -s tests -v
printf '%s\n' 'Setup complete. Run: source .venv/bin/activate'

