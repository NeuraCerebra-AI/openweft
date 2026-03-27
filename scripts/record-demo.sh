#!/bin/bash
set -euo pipefail

# README Wizard Animation Recording
#
# Produces docs/wizard-dark.svg and docs/wizard-light.svg from a real
# terminal session. The animation shows the onboarding wizard followed
# by the dashboard in ready state.
#
# Prerequisites (recording-time only, not shipped):
#   brew install asciinema          # terminal recorder
#   npm install -g svg-term-cli     # .cast → SVG converter
#   expect is pre-installed on macOS
#
# Usage:
#   npm run demo:record

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$PROJECT_ROOT/docs"
RAW_CAST_PATH="$OUTPUT_DIR/wizard.raw.cast"
CAST_PATH="$OUTPUT_DIR/wizard.cast"

# ── Preflight ──

for cmd in asciinema svg-term expect; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: $cmd is not installed. See script header for install instructions." >&2
    exit 1
  fi
done

# ── Build project ──

echo "Building project..."
cd "$PROJECT_ROOT"
npm run build

# ── Set up temp recording environment ──

DEMO_DIR=$(mktemp -d)
STUB_DIR="$DEMO_DIR/.bin"
mkdir -p "$STUB_DIR"

cleanup() {
  echo "Cleaning up..."
  rm -rf "$DEMO_DIR"
  rm -f "$CAST_PATH" "$RAW_CAST_PATH"
}
trap cleanup EXIT

echo "Setting up recording environment in $DEMO_DIR..."

# Initialize a git repo with one commit
cd "$DEMO_DIR"
git init -q
git config user.name "demo"
git config user.email "demo@example.com"
git commit --allow-empty -m "initial commit" -q

# Stub codex CLI (auth check only)
cat > "$STUB_DIR/codex" << 'STUB'
#!/bin/bash
if [[ "${1:-} ${2:-}" == "login status" ]]; then
  echo "Logged in as demo@example.com"
  exit 0
fi
exit 1
STUB
chmod +x "$STUB_DIR/codex"

# Stub claude CLI (auth check only)
cat > "$STUB_DIR/claude" << 'STUB'
#!/bin/bash
if [[ "${1:-} ${2:-}" == "auth status" ]]; then
  echo "Authenticated"
  exit 0
fi
if [[ "${1:-}" == "-p" ]]; then
  # Keep the first visible execution turn alive long enough to record the
  # dashboard after pressing "s". The README capture ends before this reply
  # matters semantically, but the response is still valid JSON so the process
  # can unwind cleanly if it continues briefly after recording stops.
  sleep 6
  cat <<'JSON'
{"session_id":"demo-session","result":"Demo prompt placeholder","modelUsage":{"claude-sonnet-4-6":{"input_tokens":1,"output_tokens":1}},"usage":{"input_tokens":1,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"total_cost_usd":0}
JSON
  exit 0
fi
exit 1
STUB
chmod +x "$STUB_DIR/claude"

# Create openweft wrapper pointing to built dist
cat > "$STUB_DIR/openweft" << WRAPPER
#!/bin/bash
exec node "$PROJECT_ROOT/dist/bin/openweft.js" "\$@"
WRAPPER
chmod +x "$STUB_DIR/openweft"

# ── Record ──

export PATH="$STUB_DIR:$PATH"
export TERM="xterm-256color"
export PS1='$ '
export BASH_SILENCE_DEPRECATION_WARNING=1
export OPENWEFT_DEMO_MODE="1"

echo "Recording wizard session..."
cd "$DEMO_DIR"
asciinema rec \
  --output-format asciicast-v2 \
  --cols 100 \
  --rows 24 \
  --idle-time-limit 2 \
  --command "expect $PROJECT_ROOT/scripts/wizard-input.exp" \
  "$RAW_CAST_PATH" \
  --overwrite

if [[ ! -s "$RAW_CAST_PATH" ]]; then
  echo "Error: Recording produced an empty .cast file" >&2
  exit 1
fi

echo "Normalizing recording frames..."
npx tsx "$PROJECT_ROOT/scripts/normalize-cast.ts" "$RAW_CAST_PATH" "$CAST_PATH"

if [[ ! -s "$CAST_PATH" ]]; then
  echo "Error: Cast normalization produced an empty .cast file" >&2
  exit 1
fi

# ── Convert to SVG ──

echo "Generating dark theme SVG..."
svg-term \
  --in "$CAST_PATH" \
  --out "$OUTPUT_DIR/wizard-dark.svg" \
  --window \
  --width 100 \
  --height 24 \
  --no-cursor

echo "Generating light theme SVG..."
# Light variant uses the same recording. Terminal apps render dark by default.
# A future enhancement could use --term/--profile with a light terminal theme file.
cp "$OUTPUT_DIR/wizard-dark.svg" "$OUTPUT_DIR/wizard-light.svg"

echo ""
echo "Done! Generated:"
echo "  $OUTPUT_DIR/wizard-dark.svg"
echo "  $OUTPUT_DIR/wizard-light.svg"
echo ""
echo "Review the SVGs in a browser before committing."
