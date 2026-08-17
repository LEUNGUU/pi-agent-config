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

# Restore the customized otty-integration.ts into ~/.pi/agent/extensions/.
# Otty rewrites that file with its stock template on every app update, which
# drops our customizations (agent_settled idle, otty:awaiting badge wiring).
# Re-running setup.sh puts the customized version back.
if [[ -f "$REPO_DIR/extensions/otty-integration.ts" ]]; then
    mkdir -p "$PI_DIR/extensions"
    cp "$REPO_DIR/extensions/otty-integration.ts" "$PI_DIR/extensions/otty-integration.ts"
    echo "Restored customized otty-integration.ts"
fi

# Install as pi package for extensions, skills, prompts, and themes
if command -v pi >/dev/null 2>&1; then
    pi install "$REPO_DIR"
    echo "Installed as pi package"

    # pi-diff-review (badlogic): native diff-review window via Glimpse + Monaco.
    # It's listed in settings.json so pi would auto-install it, but its
    # package.json has a broken `prepare: husky` script that aborts the
    # `npm install --omit=dev` pi runs (husky is a devDep, not present).
    # Install it explicitly here and patch the prepare script so the install
    # (and glimpseui's native build) can complete on a fresh machine.
    DIFF_REVIEW_SRC="git:https://github.com/badlogic/pi-diff-review"
    DIFF_REVIEW_DIR="$PI_DIR/git/github.com/badlogic/pi-diff-review"
    if [[ ! -d "$DIFF_REVIEW_DIR/.git" ]]; then
        git clone "https://github.com/badlogic/pi-diff-review" "$DIFF_REVIEW_DIR"
    fi
    # Neutralize the broken husky prepare hook (safe: it's author-only tooling).
    if grep -q '"prepare": "husky"' "$DIFF_REVIEW_DIR/package.json" 2>/dev/null; then
        sed -i.bak 's/"prepare": "husky"/"prepare": "husky || true"/' "$DIFF_REVIEW_DIR/package.json"
        rm -f "$DIFF_REVIEW_DIR/package.json.bak"
    fi
    # Register with pi (adds to settings if missing) and materialize deps.
    pi install "$DIFF_REVIEW_SRC" || echo "Warning: pi-diff-review install had issues; check native build deps (macOS: Xcode CLT/swiftc; Linux: Rust + GTK4/WebKit; Windows: .NET 8 SDK)."
    echo "Installed pi-diff-review"
else
    echo "Warning: pi not found. Install pi and run: pi install $REPO_DIR"
fi

echo "Done. Config copied to $PI_DIR"
