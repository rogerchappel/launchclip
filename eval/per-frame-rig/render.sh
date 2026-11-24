#!/bin/sh
# The per-frame rig side by side (docs/rd/per-frame-rig.md): today's rig
# (cast-scene) left, the per-frame rig right: the same storyboard with
# cast.rig "frame", both rendered by the real story composition.
# HEAVY: take .claude/heavy.lock before running. Output: qa/per-frame-rig/.
#   sh eval/per-frame-rig/render.sh
set -e
cd "$(dirname "$0")/../.."
OUT=qa/per-frame-rig
mkdir -p "$OUT"
REMOTION=${REMOTION:-node_modules/.bin/remotion}
node -e "const s=require('./eval/per-frame-rig/today.storyboard.json');s.title='Per-frame rig R&D: the per-frame rig (walk in, throw, idle)';s.cast.rig='frame';require('fs').writeFileSync('$OUT/per-frame.storyboard.json',JSON.stringify(s,null,2))"
for side in today per-frame; do
  src=eval/per-frame-rig/today.storyboard.json
  [ "$side" = per-frame ] && src="$OUT/per-frame.storyboard.json"
  node bin/launchclip.js story resolve "$src" --out "$OUT/$side.resolved.json" > /dev/null
  "$REMOTION" render kit/remotion/entry.tsx LaunchclipStory "$OUT/$side.mp4" --props="$OUT/$side.resolved.json" --concurrency=2 --log=error
done
ffmpeg -v error -y -i "$OUT/today.mp4" -i "$OUT/per-frame.mp4" -filter_complex "[0:v]scale=540:960[a];[1:v]scale=540:960[b];[a][b]hstack,format=yuv420p" -c:v libx264 -crf 18 "$OUT/side-by-side.mp4"
# 15 fps strips of each side, cropped to the figure's half of the frame.
for side in today per-frame; do
  ffmpeg -v error -y -i "$OUT/$side.mp4" -vf "fps=15,crop=760:1100:0:440,scale=152:-1,tile=15x8" -frames:v 1 "$OUT/$side-strip-15fps.png"
done
echo "$OUT/side-by-side.mp4"
