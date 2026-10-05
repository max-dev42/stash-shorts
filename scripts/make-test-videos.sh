#!/bin/sh
# Generates the test videos for the demo and for a test library: colour gradients with a big number, the
# running time and a quiet test tone. 15 portrait (1080x1920) and 5 landscape (1920x1080), 10 to 24 s,
# plus a screenshot per video. No real footage. Needs ffmpeg with drawtext (libfreetype) and a TTF font.
#
#   sh scripts/make-test-videos.sh [out dir]      default: demo/videos
#   FFMPEG=/path/to/ffmpeg FONT=/path/to/font.ttf sh scripts/make-test-videos.sh
set -e
cd "$(dirname "$0")/.."
OUT=${1:-demo/videos}
FFMPEG=${FFMPEG:-ffmpeg}
FONT=${FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf}
COLORS="0xe0559a 0x3d8fe0 0xa565dc 0x2fb3a3 0xe3a32b 0x8fa83a 0xd9653b 0x5c6bc0 0x26a69a 0xc0ca33"
mkdir -p "$OUT"

make() { # number width height seconds kind
  n=$1; w=$2; h=$3; d=$4; kind=$5
  c1=$(echo $COLORS | cut -d' ' -f$(( (n % 10) + 1 )))
  c2=$(echo $COLORS | cut -d' ' -f$(( ((n + 4) % 10) + 1 )))
  f="$OUT/$(printf '%s-%02d' "$kind" "$n")"
  fs=$(( (w < h ? w : h) / 2 ))
  if [ ! -s "$f.mp4" ]; then
    "$FFMPEG" -hide_banner -loglevel error -y \
      -f lavfi -i "gradients=s=${w}x${h}:c0=${c1}:c1=${c2}:x0=0:y0=0:x1=${w}:y1=${h}:speed=0.02:r=30:d=${d}" \
      -f lavfi -i "sine=frequency=$(( 220 + n * 40 )):sample_rate=44100:duration=${d}" \
      -vf "drawtext=fontfile=${FONT}:text='${n}':fontsize=${fs}:fontcolor=white:borderw=8:bordercolor=black@0.5:x=(w-tw)/2:y=(h-th)/2,drawtext=fontfile=${FONT}:text='%{pts\:hms}':fontsize=$(( fs / 6 )):fontcolor=white:x=(w-tw)/2:y=h-th-$(( h / 8 ))" \
      -af "volume=0.15" -c:v libx264 -preset veryfast -crf 30 -pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart -shortest \
      "$f.mp4"
  fi
  [ -s "$f.jpg" ] || "$FFMPEG" -hide_banner -loglevel error -y -ss 1 -i "$f.mp4" -frames:v 1 -vf "scale=-2:640" -q:v 4 "$f.jpg"
}

for n in $(seq 1 15); do make "$n" 1080 1920 $(( 10 + (n * 7) % 21 )) portrait; done
for n in $(seq 16 20); do make "$n" 1920 1080 $(( 10 + (n * 7) % 21 )) landscape; done
ls "$OUT"
