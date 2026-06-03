#!/usr/bin/env bash
set -euo pipefail

PI_DIR="$HOME/.pi/agent"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$PI_DIR"

# Copy global config files that pi packages don't handle (real files, not symlinks)
for f in settings.json models.json AGENTS.md; do
    if [[ -f "$REPO_DIR/$f" ]]; then
        cp "$REPO_DIR/$f" "$PI_DIR/$f"
        echo "Copied $f"
    fi
done

# Copy custom subagents (discovered from ~/.pi/agent/agents/, not via packages)
if [[ -d "$REPO_DIR/agents" ]]; then
    mkdir -p "$PI_DIR/agents"
    cp "$REPO_DIR/agents/"*.md "$PI_DIR/agents/"
    echo "Copied agents"
fi

# Install as pi package for extensions, skills, prompts, and themes
if command -v pi >/dev/null 2>&1; then
    pi install "$REPO_DIR"
    echo "Installed as pi package"
else
    echo "Warning: pi not found. Install pi and run: pi install $REPO_DIR"
fi

echo "Done. Config copied to $PI_DIR"
