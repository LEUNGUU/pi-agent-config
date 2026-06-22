#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# Script: generate-video.sh
# Description: Generate a video with Agnes (agnes-video-v2.0). Asynchronous:
#              creates a task, polls until completed, then prints the video URL.
# Usage: ./generate-video.sh --prompt "..." [options]

readonly BASE_URL="${AGNES_BASE_URL:-https://apihub.agnes-ai.com}"
readonly DEFAULT_MODEL="${AGNES_VIDEO_MODEL:-agnes-video-v2.0}"

readonly EXIT_ERROR=1
readonly EXIT_INVALID_ARGS=2

error() { echo "ERROR: $*" >&2; exit "${EXIT_ERROR}"; }

usage() {
    cat <<EOF
Usage: ${0##*/} --prompt "<text>" [options]

Generate a video with Agnes (agnes-video-v2.0). Async: creates a task, polls
until status is "completed", then prints the resulting video_url.

Required:
    -p, --prompt <text>     Text prompt describing the video.

Options:
    -m, --model <id>        Model id (default: ${DEFAULT_MODEL}).
    -f, --num-frames <n>    Frame count. Must satisfy 8n+1 and be <= 441
                            (e.g. 81, 121, 161, 241, 441). Default: 121.
    -a, --ar <ratio>        Aspect ratio: 16:9 | 9:16 | 1:1 | 3:4.
        --image <url>       Source image for image-to-video. Repeatable
                            (multi-image / keyframe).
        --poll-interval <s> Seconds between status polls (default: 10).
        --timeout <s>       Give up after this many seconds (default: 600).
    -o, --out <path>        Download the finished video to this file.
    -h, --help              Show this help.

Environment:
    AGNES_API_KEY           Required. Bearer token for Agnes.
    AGNES_BASE_URL          Override base URL (default: ${BASE_URL}).
    AGNES_VIDEO_MODEL       Override default model.

Examples:
    ${0##*/} -p "A cat walking on the beach at sunset, realistic motion"
    ${0##*/} -p "Make it move" --image https://example.com/in.png -a 16:9 -o out.mp4
EOF
    exit 0
}

PROMPT=""
MODEL="${DEFAULT_MODEL}"
NUM_FRAMES=121
AR=""
OUT=""
POLL_INTERVAL=10
TIMEOUT=600
SOURCE_IMAGES=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help) usage ;;
        -p|--prompt) PROMPT="${2:?--prompt needs a value}"; shift 2 ;;
        -m|--model) MODEL="${2:?--model needs a value}"; shift 2 ;;
        -f|--num-frames) NUM_FRAMES="${2:?--num-frames needs a value}"; shift 2 ;;
        -a|--ar) AR="${2:?--ar needs a value}"; shift 2 ;;
        --image) SOURCE_IMAGES+=("${2:?--image needs a value}"); shift 2 ;;
        --poll-interval) POLL_INTERVAL="${2:?--poll-interval needs a value}"; shift 2 ;;
        --timeout) TIMEOUT="${2:?--timeout needs a value}"; shift 2 ;;
        -o|--out) OUT="${2:?--out needs a value}"; shift 2 ;;
        -*) error "Unknown option: $1 (use --help)" ;;
        *) error "Unexpected argument: $1 (use --help)" ;;
    esac
done

AGNES_API_KEY="${AGNES_API_KEY:?AGNES_API_KEY environment variable not set}"
[[ -n "${PROMPT}" ]] || { echo "ERROR: --prompt is required." >&2; exit "${EXIT_INVALID_ARGS}"; }
command -v curl >/dev/null 2>&1 || error "curl is required."
command -v jq   >/dev/null 2>&1 || error "jq is required."

# Validate num_frames: positive integer, <= 441, and (frames - 1) % 8 == 0.
[[ "${NUM_FRAMES}" =~ ^[0-9]+$ ]] || error "Invalid --num-frames: ${NUM_FRAMES} (integer expected)"
(( NUM_FRAMES <= 441 )) || error "--num-frames must be <= 441 (got ${NUM_FRAMES})"
(( (NUM_FRAMES - 1) % 8 == 0 )) || error "--num-frames must satisfy 8n+1 (e.g. 81, 121, 161, 241, 441); got ${NUM_FRAMES}"

if [[ -n "${AR}" ]]; then
    case "${AR}" in
        16:9|9:16|1:1|3:4) ;;
        *) error "Invalid --ar: ${AR} (allowed: 16:9, 9:16, 1:1, 3:4)" ;;
    esac
fi

[[ "${POLL_INTERVAL}" =~ ^[0-9]+$ ]] || error "Invalid --poll-interval: ${POLL_INTERVAL}"
[[ "${TIMEOUT}" =~ ^[0-9]+$ ]] || error "Invalid --timeout: ${TIMEOUT}"

# --- Step 1: create the task ---
BODY=$(jq -n \
    --arg model "${MODEL}" \
    --arg prompt "${PROMPT}" \
    --argjson frames "${NUM_FRAMES}" \
    '{model: $model, prompt: $prompt, num_frames: $frames}')

[[ -n "${AR}" ]] && BODY=$(jq --arg ar "${AR}" '. + {aspect_ratio: $ar}' <<<"${BODY}")

if [[ ${#SOURCE_IMAGES[@]} -gt 0 ]]; then
    IMAGES_JSON=$(printf '%s\n' "${SOURCE_IMAGES[@]}" | jq -R . | jq -s .)
    BODY=$(jq --argjson imgs "${IMAGES_JSON}" '. + {image: $imgs}' <<<"${BODY}")
fi

echo "Creating video task..." >&2
CREATE_RESP=$(curl -fsS "${BASE_URL}/v1/videos" \
    -H "Authorization: Bearer ${AGNES_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "${BODY}") || error "Task creation failed (HTTP error). Check key/network."

VIDEO_ID=$(jq -r '.video_id // empty' <<<"${CREATE_RESP}")
TASK_ID=$(jq -r '.task_id // empty' <<<"${CREATE_RESP}")
[[ -n "${VIDEO_ID}" || -n "${TASK_ID}" ]] || error "No video_id/task_id in response: $(jq -c '.' <<<"${CREATE_RESP}")"
echo "Task created (video_id=${VIDEO_ID:-n/a}, task_id=${TASK_ID:-n/a}). Polling..." >&2

# --- Step 2: poll until completed ---
poll_status() {
    if [[ -n "${VIDEO_ID}" ]]; then
        curl -fsS "${BASE_URL}/agnesapi?video_id=${VIDEO_ID}" \
            -H "Authorization: Bearer ${AGNES_API_KEY}"
    else
        curl -fsS "${BASE_URL}/v1/videos/${TASK_ID}" \
            -H "Authorization: Bearer ${AGNES_API_KEY}"
    fi
}

ELAPSED=0
VIDEO_URL=""
while (( ELAPSED < TIMEOUT )); do
    STATUS_RESP=$(poll_status) || error "Status poll failed (HTTP error)."
    STATUS=$(jq -r '.status // empty' <<<"${STATUS_RESP}")
    case "${STATUS}" in
        completed|succeeded|success)
            # Agnes returns the mp4 URL in a field named (oddly) remixed_from_video_id.
            # Check the documented/expected fields first, then that quirk, then any
            # http(s) URL anywhere in the response as a last resort.
            VIDEO_URL=$(jq -r '
                [.video_url, .data[0].url, .remixed_from_video_id, .url, .output]
                | map(select(type == "string" and startswith("http")))
                | first // empty
            ' <<<"${STATUS_RESP}")
            if [[ -z "${VIDEO_URL}" ]]; then
                VIDEO_URL=$(jq -r '[.. | strings | select(startswith("http"))] | first // empty' <<<"${STATUS_RESP}")
            fi
            break
            ;;
        failed|error|cancelled)
            error "Task ${STATUS}: $(jq -c '.' <<<"${STATUS_RESP}")"
            ;;
        *)
            echo "  status=${STATUS:-unknown} (${ELAPSED}s elapsed)" >&2
            ;;
    esac
    sleep "${POLL_INTERVAL}"
    ELAPSED=$(( ELAPSED + POLL_INTERVAL ))
done

[[ -n "${VIDEO_URL}" ]] || error "Timed out after ${TIMEOUT}s without a completed video_url."

if [[ -n "${OUT}" ]]; then
    curl -fsSL "${VIDEO_URL}" -o "${OUT}" || error "Failed to download video to ${OUT}"
    echo "Saved video to ${OUT}"
else
    echo "${VIDEO_URL}"
fi
