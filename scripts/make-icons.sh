#!/bin/sh
# Renders plugin/app/icon.svg to the PNG icons of the home screen app (manifest and apple-touch-icon)
# with headless Chromium, so the PNGs look exactly like the SVG. Run after changing icon.svg.
set -e
cd "$(dirname "$0")/../plugin/app"
CHROME=${CHROME:-chromium}
tmp=$(mktemp -d)
for s in 192:icon-192.png 512:icon-512.png 180:apple-touch-icon.png; do
  size=${s%%:*} out=${s#*:}
  printf '<!doctype html><style>html,body{margin:0;background:#000}img{display:block;width:%spx;height:%spx}</style><img src="%s">' \
    "$size" "$size" "$PWD/icon.svg" > "$tmp/icon.html"
  "$CHROME" --headless --no-sandbox --hide-scrollbars --force-device-scale-factor=1 --window-size="$size,$size" \
    --user-data-dir="$tmp/profile" --screenshot="$PWD/$out" "file://$tmp/icon.html" >/dev/null 2>&1
done
rm -rf "$tmp"
