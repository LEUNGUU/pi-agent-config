#!/usr/bin/env bash
set -euo pipefail

PI_DIR="$HOME/.pi/agent"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$PI_DIR"

# Symlink config files that pi packages don't handle
for f in settings.json models.json presets.json AGENTS.md; do
    if [[ -f "$REPO_DIR/$f" ]]; then
        ln -sf "$REPO_DIR/$f" "$PI_DIR/$f"
        echo "Linked $f"
    fi
done

# Install as pi package for extensions, skills, prompts, and themes
if command -v pi >/dev/null 2>&1; then
    pi install "$REPO_DIR"
    echo "Installed as pi package"
else
    echo "Warning: pi not found. Install pi and run: pi install $REPO_DIR"
fi

echo "Done. Config linked to $PI_DIR"
