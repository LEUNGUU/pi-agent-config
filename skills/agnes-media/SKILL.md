---
name: agnes-media
description: Generate images and videos with Agnes AI generation models (agnes-image-2.1-flash, agnes-video-v2.0) via the Agnes apihub REST API. Use when the user asks to generate, create, or draw an image with Agnes, or to generate/create a video with Agnes (text-to-image, image-to-image, text-to-video, image-to-video). Generation only — these models cannot read, describe, or summarize an existing image or video.
---

# Agnes Media Generation

Generate **images** and **videos** with Agnes's dedicated generation models. These
are called as tools (shell scripts wrapping the Agnes REST API); they are separate
from the `agnes-2.0-flash` chat model configured in `models.json`.

**Scope — generation only.** `agnes-image-2.1-flash` makes images and
`agnes-video-v2.0` makes videos. Neither can *read* an image/video. To summarize a
YouTube/other video, use the `youtube-transcript` skill plus a text model; to
describe an existing image, use a vision-capable model with the `read` tool.

## Prerequisites

- `AGNES_API_KEY` set in the environment (Bearer token for `https://apihub.agnes-ai.com`).
- `curl` and `jq` available.

## Scripts

`{baseDir}` = this SKILL.md file's directory.

| Script | Purpose |
|--------|---------|
| `{baseDir}/scripts/generate-image.sh` | Text-to-image and image-to-image |
| `{baseDir}/scripts/generate-video.sh` | Text-to-video and image-to-video (async, polled) |

Both accept `--help`. Make them executable on first use if needed:
`chmod +x {baseDir}/scripts/*.sh`.

## Image generation

```bash
# Text-to-image, print the result URL
{baseDir}/scripts/generate-image.sh -p "A luminous floating city above a misty canyon at sunrise"

# Save to a file (forces base64 output internally, then decodes)
{baseDir}/scripts/generate-image.sh -p "A cat" -s 1024x768 -o cat.png

# Image-to-image (source can be a URL or a data URI; repeat --image for multiple)
{baseDir}/scripts/generate-image.sh -p "Make it blue" --image https://example.com/in.png -o out.png
```

Key options: `-p/--prompt` (required), `-s/--size WxH` (default `1024x1024`),
`-o/--out <path>`, `--image <url|datauri>` (repeatable), `--format url|b64_json`
(when not saving), `-m/--model`.

Notes:
- `response_format` is sent inside `extra_body` (Agnes requires this).
- Saving to a file requests `b64_json` and decodes it; without `-o` it prints `data[0].url`.

## Video generation (asynchronous)

The script creates a task, polls until `status` is `completed`, then prints (or
downloads) the `video_url`. This can take minutes.

```bash
# Text-to-video, print the URL when ready
{baseDir}/scripts/generate-video.sh -p "A cat walking on the beach at sunset, realistic motion"

# Image-to-video with aspect ratio, download the result
{baseDir}/scripts/generate-video.sh -p "Make it move" --image https://example.com/in.png -a 16:9 -o out.mp4
```

Key options: `-p/--prompt` (required), `-f/--num-frames` (default `121`),
`-a/--ar`, `--image <url>` (repeatable), `-o/--out <path>`, `--poll-interval`
(default `10`s), `--timeout` (default `600`s), `-m/--model`.

Constraints (validated by the script):
- `--num-frames` must satisfy **8n+1** and be **≤ 441** (e.g. `81`, `121`, `161`, `241`, `441`).
- `--ar` must be one of `16:9`, `9:16`, `1:1`, `3:4`.

API quirks (verified live, handled by the script):
- Terminal status is `completed` (progresses `queued` → `in_progress` → `completed`, with a `progress` 0–100 field).
- The finished mp4 URL is returned in a field named **`remixed_from_video_id`** (not `video_url`). The script checks the expected fields, then that quirk, then any `http` URL in the response.
- Generation of an 81-frame clip takes ~1.5–2 minutes; raise `--timeout` for longer clips.

## Environment overrides

| Variable | Default |
|----------|---------|
| `AGNES_API_KEY` | (required) |
| `AGNES_BASE_URL` | `https://apihub.agnes-ai.com` |
| `AGNES_IMAGE_MODEL` | `agnes-image-2.1-flash` |
| `AGNES_VIDEO_MODEL` | `agnes-video-v2.0` |
