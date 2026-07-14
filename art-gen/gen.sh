#!/bin/zsh
# usage: ./gen.sh <name> [extra-ref ...]  reads prompts/<name>.txt writes output/<name>-vN.png
set -e
name=$1; shift
n=1; while [ -e "output/$name-v$n.png" ]; do n=$((n+1)); done
out="output/$name-v$n.png"
args=(-F "image[]=@reference/ref-bunny-standing.webp;type=image/webp" -F "image[]=@reference/ref-bunny-rolling.webp;type=image/webp" -F "image[]=@output/22-ch7-emotional-heart-v1.png;type=image/png")
for r in "$@"; do args+=(-F "image[]=@$r;type=image/png"); done
curl -s https://api.openai.com/v1/images/edits \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F "model=gpt-image-2" "${args[@]}" \
  -F "prompt=$(cat prompts/$name.txt)" \
  -F "size=1024x1024" -F "quality=high" -o output/resp.json -w "http:%{http_code}\n"
python3 - "$out" << 'PY'
import json, base64, sys
d = json.load(open('output/resp.json'))
if 'data' in d:
    open(sys.argv[1], 'wb').write(base64.b64decode(d['data'][0]['b64_json']))
    print('saved', sys.argv[1])
else:
    print(json.dumps(d, indent=2)[:600])
PY
