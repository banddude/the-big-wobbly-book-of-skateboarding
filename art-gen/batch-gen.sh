#!/bin/zsh
# Parallel image generation, concurrency-capped. Each writes output/<name>-v1.png
cd "$(dirname "$0")"
export OPENAI_API_KEY="$(aiva secrets get OPENAI_API_KEY 2>/dev/null | tail -1)"
NAMES=(04-turtle-nose 10-kitty-board 13-knee-slide 17-three-stops 18-carving 19-clipboard 23-ride-or-rest 24-fear 28-parent-turtle 29-joy-face 30-horizon 32-first-aid)
gen_one() {
  local name=$1
  local out="output/${name}-v1.png"
  local resp="output/resp-${name}.json"
  curl -s https://api.openai.com/v1/images/edits \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -F "model=gpt-image-2" \
    -F "image[]=@reference/ref-bunny-standing.webp;type=image/webp" \
    -F "image[]=@reference/ref-bunny-rolling.webp;type=image/webp" \
    -F "image[]=@output/22-ch7-emotional-heart-v1.png;type=image/png" \
    -F "prompt=$(cat prompts/${name}.txt)" \
    -F "size=1024x1024" -F "quality=high" -o "$resp" -w "%{http_code}" > "output/code-${name}.txt"
  python3 - "$resp" "$out" "$name" << 'PY'
import json, base64, sys
resp, out, name = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    d = json.load(open(resp))
    if 'data' in d and d['data'] and 'b64_json' in d['data'][0]:
        open(out, 'wb').write(base64.b64decode(d['data'][0]['b64_json']))
        print(f"OK {name}")
    else:
        print(f"FAIL {name}: {json.dumps(d)[:180]}")
except Exception as e:
    print(f"ERR {name}: {e}")
PY
}
# concurrency cap 4
i=0
for n in $NAMES; do
  gen_one "$n" &
  i=$((i+1))
  if [ $((i % 4)) -eq 0 ]; then wait; fi
done
wait
echo "=== BATCH COMPLETE ==="
