#!/usr/bin/env python3
"""Generate one book illustration via Gemini image API.

Usage: GEMINI_API_KEY=... python3 generate.py <model> <output.png> <prompt-file> [ref-image ...]
Reference images are sent before the prompt so the model locks character design.
"""
import base64
import json
import mimetypes
import sys
import urllib.request

model, out_path, prompt_path = sys.argv[1], sys.argv[2], sys.argv[3]
refs = sys.argv[4:]

import os
key = os.environ["GEMINI_API_KEY"]

with open(prompt_path) as f:
    prompt = f.read()

parts = []
for ref in refs:
    mime = mimetypes.guess_type(ref)[0] or "image/png"
    with open(ref, "rb") as f:
        parts.append({"inline_data": {"mime_type": mime, "data": base64.b64encode(f.read()).decode()}})
parts.append({"text": prompt})

body = {
    "contents": [{"parts": parts}],
    "generationConfig": {
        "responseModalities": ["IMAGE"],
        "imageConfig": {"aspectRatio": "1:1"},
    },
}

req = urllib.request.Request(
    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    data=json.dumps(body).encode(),
    headers={"Content-Type": "application/json", "x-goog-api-key": key},
)
try:
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = json.loads(resp.read())
except urllib.error.HTTPError as e:
    print("HTTP", e.code)
    print(e.read().decode()[:2000])
    sys.exit(1)

saved = False
for part in data.get("candidates", [{}])[0].get("content", {}).get("parts", []):
    if "inlineData" in part:
        with open(out_path, "wb") as f:
            f.write(base64.b64decode(part["inlineData"]["data"]))
        print("saved", out_path, part["inlineData"].get("mimeType"))
        saved = True
    elif "text" in part:
        print("text:", part["text"][:500])

if not saved:
    print(json.dumps(data, indent=2)[:3000])
    sys.exit(1)
