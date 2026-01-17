#!/bin/bash
set -e

PI_DIR="$HOME/.pi/agent"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$PI_DIR"

# Symlink config files
for f in settings.json models.json presets.json AGENTS.md; do
    [ -f "$REPO_DIR/$f" ] && ln -sf "$REPO_DIR/$f" "$PI_DIR/$f"
done

# Symlink directories
for d in extensions prompts themes skills; do
    [ -d "$REPO_DIR/$d" ] && ln -sfn "$REPO_DIR/$d" "$PI_DIR/$d"
done

echo "Done. Config linked to $PI_DIR"
