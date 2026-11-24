#!/bin/sh
# The per-frame rig side by side (docs/rd/per-frame-rig.md): today's rig
# (cast-scene) left, the per-frame rig prototype right, on the same set.
# HEAVY: take .claude/heavy.lock before running. Output: qa/per-frame-rig/.
#   sh eval/per-frame-rig/render.sh
set -e
cd "$(dirname "$0")/../.."
OUT=qa/per-frame-rig
mkdir -p "$OUT"
REMOTION=${REMOTION:-node_modules/.bin/remotion}
node bin/launchclip.js story resolve eval/per-frame-rig/today.storyboard.json --out "$OUT/today.resolved.json" > /dev/null
"$REMOTION" render kit/remotion/entry.tsx LaunchclipStory "$OUT/today.mp4" --props="$OUT/today.resolved.json" --concurrency=2 --log=error
"$REMOTION" render kit/remotion/experimental/PerFrameRig.tsx ExperimentalPerFrameRig "$OUT/per-frame.mov" \
  --codec=prores --prores-profile=4444 --pixel-format=yuva444p10le --image-format=png --concurrency=2 --log=error
# The set without today's figure: the left of the first frame (he starts right of it), the right of the last.
ffmpeg -v error -y -ss 0 -i "$OUT/today.mp4" -frames:v 1 "$OUT/f0.png"
ffmpeg -v error -y -sseof -0.1 -i "$OUT/today.mp4" -frames:v 1 "$OUT/fl.png"
ffmpeg -v error -y -i "$OUT/f0.png" -i "$OUT/fl.png" -filter_complex "[1:v]crop=630:1920:450:0[r];[0:v][r]overlay=450:0" "$OUT/plate.png"
ffmpeg -v error -y -loop 1 -i "$OUT/plate.png" -i "$OUT/per-frame.mov" -filter_complex "[0:v][1:v]overlay=shortest=1,format=yuv420p" -c:v libx264 -crf 18 -r 30 "$OUT/per-frame.mp4"
ffmpeg -v error -y -i "$OUT/today.mp4" -i "$OUT/per-frame.mp4" -filter_complex "[0:v]scale=540:960[a];[1:v]scale=540:960[b];[a][b]hstack,format=yuv420p" -c:v libx264 -crf 18 "$OUT/side-by-side.mp4"
# 15 fps strips of each side, cropped to the figure's half of the frame.
for side in today per-frame; do
  ffmpeg -v error -y -i "$OUT/$side.mp4" -vf "fps=15,crop=760:1100:0:440,scale=152:-1,tile=15x8" -frames:v 1 "$OUT/$side-strip-15fps.png"
done
rm -f "$OUT/f0.png" "$OUT/fl.png" "$OUT/per-frame.mov"
echo "$OUT/side-by-side.mp4"
