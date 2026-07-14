#!/bin/zsh
# usage: ./pastelize.sh <in.png> <out.png>  originals are never modified
magick "$1" -modulate 102,58,100 -brightness-contrast 3x-10 \( +clone -fill "#F5E9D8" -colorize 18% \) -compose over -composite "$2"
