#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# Script: generate-image.sh
# Description: Generate an image with Agnes (agnes-image-2.1-flash) via the
#              OpenAI-compatible /v1/images/generations endpoint.
# Usage: ./generate-image.sh --prompt "..." [options]

readonly BASE_URL="${AGNES_BASE_URL:-https://apihub.agnes-ai.com}"
readonly DEFAULT_MODEL="${AGNES_IMAGE_MODEL:-agnes-image-2.1-flash}"

readonly EXIT_ERROR=1
readonly EXIT_INVALID_ARGS=2

error() { echo "ERROR: $*" >&2; exit "${EXIT_ERROR}"; }

usage() {
    cat <<EOF
Usage: ${0##*/} --prompt "<text>" [options]

Generate an image with Agnes (agnes-image-2.1-flash).

Required:
    -p, --prompt <text>     Text prompt describing the image.

Options:
    -s, --size <WxH>        Image size (default: 1024x1024). e.g. 1024x768.
    -m, --model <id>        Model id (default: ${DEFAULT_MODEL}).
    -o, --out <path>        Save the result to this file. If omitted, prints the URL.
                            (Forces base64 output so the file can be written.)
        --image <url|datauri>  Source image for image-to-image. Repeatable.
        --format url|b64_json  Response format when not saving (default: url).
    -h, --help              Show this help.

Environment:
    AGNES_API_KEY           Required. Bearer token for Agnes.
    AGNES_BASE_URL          Override base URL (default: ${BASE_URL}).
    AGNES_IMAGE_MODEL       Override default model.

Examples:
    ${0##*/} -p "A luminous floating city above a misty canyon at sunrise"
    ${0##*/} -p "Make it blue" --image https://example.com/in.png -o out.png
    ${0##*/} -p "A cat" -s 1024x768 -o cat.png
EOF
    exit 0
}

PROMPT=""
SIZE="1024x1024"
MODEL="${DEFAULT_MODEL}"
OUT=""
FORMAT="url"
SOURCE_IMAGES=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help) usage ;;
        -p|--prompt) PROMPT="${2:?--prompt needs a value}"; shift 2 ;;
        -s|--size) SIZE="${2:?--size needs a value}"; shift 2 ;;
        -m|--model) MODEL="${2:?--model needs a value}"; shift 2 ;;
        -o|--out) OUT="${2:?--out needs a value}"; shift 2 ;;
        --image) SOURCE_IMAGES+=("${2:?--image needs a value}"); shift 2 ;;
        --format) FORMAT="${2:?--format needs a value}"; shift 2 ;;
        -*) error "Unknown option: $1 (use --help)" ;;
        *) error "Unexpected argument: $1 (use --help)" ;;
    esac
done

AGNES_API_KEY="${AGNES_API_KEY:?AGNES_API_KEY environment variable not set}"
[[ -n "${PROMPT}" ]] || { echo "ERROR: --prompt is required." >&2; exit "${EXIT_INVALID_ARGS}"; }
[[ "${SIZE}" =~ ^[0-9]+x[0-9]+$ ]] || error "Invalid --size: ${SIZE} (expected WxH, e.g. 1024x768)"
command -v curl >/dev/null 2>&1 || error "curl is required."
command -v jq   >/dev/null 2>&1 || error "jq is required."

# When saving to a file we need base64 back; otherwise honor --format.
if [[ -n "${OUT}" ]]; then
    RESPONSE_FORMAT="b64_json"
else
    case "${FORMAT}" in
        url|b64_json) RESPONSE_FORMAT="${FORMAT}" ;;
        *) error "Invalid --format: ${FORMAT} (url|b64_json)" ;;
    esac
fi

# Build request body with jq so prompt/size are safely escaped.
# response_format must live inside extra_body (Agnes quirk).
BODY=$(jq -n \
    --arg model "${MODEL}" \
    --arg prompt "${PROMPT}" \
    --arg size "${SIZE}" \
    --arg rf "${RESPONSE_FORMAT}" \
    '{model: $model, prompt: $prompt, size: $size, extra_body: {response_format: $rf}}')

if [[ "${RESPONSE_FORMAT}" == "b64_json" ]]; then
    BODY=$(jq '. + {return_base64: true}' <<<"${BODY}")
fi

if [[ ${#SOURCE_IMAGES[@]} -gt 0 ]]; then
    IMAGES_JSON=$(printf '%s\n' "${SOURCE_IMAGES[@]}" | jq -R . | jq -s .)
    BODY=$(jq --argjson imgs "${IMAGES_JSON}" '. + {image: $imgs}' <<<"${BODY}")
fi

RESP=$(curl -fsS "${BASE_URL}/v1/images/generations" \
    -H "Authorization: Bearer ${AGNES_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "${BODY}") || error "Request failed (HTTP error). Check key/network."

if [[ -n "${OUT}" ]]; then
    B64=$(jq -r '.data[0].b64_json // empty' <<<"${RESP}")
    [[ -n "${B64}" ]] || error "No base64 image in response: $(jq -c '.' <<<"${RESP}")"
    printf '%s' "${B64}" | base64 --decode > "${OUT}" || error "Failed to decode/write ${OUT}"
    echo "Saved image to ${OUT}"
else
    URL=$(jq -r '.data[0].url // empty' <<<"${RESP}")
    if [[ -n "${URL}" ]]; then
        echo "${URL}"
    else
        # Fall back to printing whatever data came back.
        jq -r '.data[0].b64_json // .' <<<"${RESP}"
    fi
fi
