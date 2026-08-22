#!/usr/bin/env bash
set -euo pipefail

PI_DIR="$HOME/.pi/agent"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$PI_DIR"

# Symlink config into the repo so live edits and repo stay one file.
# pi writes settings.json in place (writeFileSync), which follows symlinks,
# so runtime changes (e.g. /settings, lastChangelogVersion bumps) land in the
# repo working tree and just need a commit — no more copy drift.
link() {
    local src="$1" dst="$2"
    if [[ -e "$dst" && ! -L "$dst" ]]; then
        mv "$dst" "$dst.bak"
        echo "Backed up $dst -> $dst.bak"
    fi
    ln -sfn "$src" "$dst"
    echo "Linked $(basename "$dst")"
}

for f in settings.json AGENTS.md; do
    link "$REPO_DIR/$f" "$PI_DIR/$f"
done

# Subagents (discovered from ~/.pi/agent/agents/, not via packages)
mkdir -p "$PI_DIR/agents"
for f in "$REPO_DIR/agents/"*.md; do
    link "$f" "$PI_DIR/agents/$(basename "$f")"
done

# models.json is machine-specific (kiro gateway baseUrl, key placeholders) and
# this repo is public — never symlink it back into git. Seed once, edit live.
if [[ ! -f "$PI_DIR/models.json" ]]; then
    cp "$REPO_DIR/models.json" "$PI_DIR/models.json"
    echo "Seeded models.json — edit $PI_DIR/models.json (kiro baseUrl, API keys)"
else
    echo "models.json exists; left untouched (machine-specific)"
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

echo "Done. Config linked into $PI_DIR"
echo "Remaining manual steps on a new machine:"
echo "  - ~/.pi/agent/auth.json (credentials are never in this repo)"
echo "  - ~/.pi/agent/models.json endpoints (kiro gateway baseUrl)"
