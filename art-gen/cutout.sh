#!/bin/zsh
# usage: ./cutout.sh <in.png> <out.png> <fuzz%>
set -e
in=$1; out=$2; fz=${3:-12}
read w h <<< "$(magick identify -format '%w %h' "$in")"
magick "$in" -alpha set -fuzz "$fz%" -fill none \
  -draw "alpha 2,2 floodfill" -draw "alpha $((w-3)),2 floodfill" \
  -draw "alpha 2,$((h-3)) floodfill" -draw "alpha $((w-3)),$((h-3)) floodfill" \
  -trim +repage -resize "700x700>" "$out"
