#!/usr/bin/env sh
set -eu

# Stage a clean plugin directory (excluding .git/, test/, scripts/) and install
# it into Antigravity CLI via `agy plugin install`.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

STAGE_BASE=$(mktemp -d)
trap 'rm -rf "$STAGE_BASE"' EXIT INT TERM
STAGE="$STAGE_BASE/agy-cli-statusline"

mkdir -p "$STAGE/hooks" "$STAGE/dist" "$STAGE/docs"

for f in plugin.json config.example.json README.md README.en.md LICENSE THIRD_PARTY_NOTICES.md SECURITY.md CHANGELOG.md; do
  [ -f "$REPO_ROOT/$f" ] && cp "$REPO_ROOT/$f" "$STAGE/$f"
done

cp "$REPO_ROOT/hooks/status-line.sh" "$STAGE/hooks/status-line.sh"
chmod +x "$STAGE/hooks/status-line.sh"
cp "$REPO_ROOT/dist/agy-hud.js" "$STAGE/dist/agy-hud.js"
[ -f "$REPO_ROOT/docs/hud-preview.png" ] && cp "$REPO_ROOT/docs/hud-preview.png" "$STAGE/docs/hud-preview.png"

agy plugin validate "$STAGE"
agy plugin install "$STAGE"

cat <<'EOF'

Installed plugin `agy-cli-statusline`.
To activate it in Antigravity CLI, run inside `agy`:

  /statusline ~/.gemini/config/plugins/agy-cli-statusline/hooks/status-line.sh

Optional: copy `config.example.json` to `~/.config/agy-cli-statusline/config.json` to customize options.
EOF
