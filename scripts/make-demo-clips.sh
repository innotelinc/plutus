#!/usr/bin/env bash
# ─── Generate self-hosted demo clips ───────────────────────────────────────────
#
# Renders three 10-second branded clips (animated gradients + title text) into
# public/demo/, plus a poster PNG per clip. seedMockData points at these files
# (/demo/*.mp4), so demo playback never depends on an external video host —
# the same "no external video APIs" rule the pipeline follows.
#
# The files are checked into the repo; re-run this script only to regenerate
# them (e.g. after changing the look). Requires ffmpeg + a DejaVu font.
#
# Usage:
#   ./scripts/make-demo-clips.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/public/demo"
mkdir -p "$OUT_DIR"

command -v ffmpeg >/dev/null 2>&1 || { echo "✗ ffmpeg not found on PATH"; exit 1; }

FONT="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
if [ ! -f "$FONT" ]; then
  FONT=$(fc-list 2>/dev/null | grep -im1 'dejavu.*bold' | cut -d: -f1 || true)
fi
[ -n "$FONT" ] && [ -f "$FONT" ] || { echo "✗ no DejaVu Bold font found"; exit 1; }

# gen <index> <top-line> <bottom-line> <color-a> <color-b>
gen() {
  local idx="$1" top="$2" bottom="$3" ca="$4" cb="$5"
  local out="$OUT_DIR/demo-${idx}.mp4"
  local poster="$OUT_DIR/demo-${idx}.png"

  ffmpeg -y -loglevel error \
    -f lavfi -i "gradients=size=1280x720:speed=0.015:c0=0x${ca}:c1=0x${cb}:duration=12" \
    -f lavfi -i "anullsrc=r=44100:cl=stereo" \
    -t 10 \
    -vf "drawtext=fontfile=${FONT}:text='${top}':fontcolor=white:fontsize=110:x=(w-text_w)/2:y=(h-text_h)/2-70,drawtext=fontfile=${FONT}:text='${bottom}':fontcolor=white@0.85:fontsize=54:x=(w-text_w)/2:y=(h-text_h)/2+70,format=yuv420p" \
    -c:v libx264 -preset veryfast -crf 28 \
    -c:a aac -b:a 96k -shortest \
    "$out"

  ffmpeg -y -loglevel error -ss 5 -i "$out" -frames:v 1 -update 1 "$poster"

  echo "  ✓ demo-${idx}.mp4 ($(du -h "$out" | cut -f1)) + poster ($(du -h "$poster" | cut -f1))"
}

echo "→ Generating demo clips into public/demo/ ..."
gen 1 "PLUTUS" "THE AI SHOPPING CHANNEL" 3b0764 ec4899
gen 2 "STUDIO LIGHTS" "GENERATED ON YOUR HOST" 134e4a 22d3ee
gen 3 "ZERO CLOUD" "SELF-HOSTED VIDEO" 7c2d12 f97316
echo "→ Done. Rebuild the static export (or copy public/demo into out/) and reseed."
