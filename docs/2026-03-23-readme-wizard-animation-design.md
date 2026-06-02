# README Wizard Animation Design

Date: 2026-03-23

## Context

The README currently has two animated SVGs:
- `docs/banner-dark.svg` / `banner-light.svg` — animated weft-weaving brand banner
- `docs/hero-dark.svg` / `hero-light.svg` — terminal demo showing `openweft add` + `openweft start --bg`

Both are hand-crafted SVGs with SMIL animations. The hero animation accurately represents the CLI-only workflow (queue work, start in background, get merged results). Its one compression — showing the final `✓ 3 merged` result immediately after `start --bg` instead of via `openweft status` — is acceptable README storytelling.

**This design adds a second animation below the hero** that showcases the onboarding wizard and TUI dashboard — the actual interactive experience most users will have.

## Goal

A ~20-second animated SVG showing:
1. The onboarding wizard (first-run experience)
2. The TUI dashboard appearing with queued features

The animation should be:
- **Accurate** — records the real product, not a mockup
- **Engaging** — shows the most visually compelling wizard steps
- **Maintainable** — re-runnable via `npm run demo:record` when the product changes
- **README-suitable** — SVG output, dark/light theme variants, no external hosting

## Approach: CI-Reproducible VHS Recording Pipeline

### Why VHS

[VHS](https://github.com/charmbracelet/vhs) is a declarative terminal recording tool. You write a `.tape` file describing what to type and when to wait, and VHS runs it in a real terminal emulator and exports the result.

- **Declarative** — `.tape` files are readable and diffable
- **Accurate** — records the actual Ink-based TUI, not a simulation
- **Reproducible** — same tape produces same output on any machine
- **Maintainable** — when the wizard changes, update the tape and re-run

### SVG Output Pipeline

VHS natively outputs GIF/MP4/WebM. For SVG output, we chain:

```
VHS (.tape) → asciinema (.cast) → svg-term-cli → animated SVG
```

1. VHS runs the tape and records to `.cast` format via asciinema integration
2. `svg-term-cli` converts the `.cast` file to an animated SVG
3. We generate dark and light variants via svg-term's `--profile` flag

## Animation Content (~20 seconds)

### Scene 1: Welcome (0-3s)

The wizard opens. Progress bar shows `● ○ ○ ○ ○ ○  1/6`. Environment checks run:

```
✓ Git repository detected
✓ Node.js v24.x.x
```

User presses Enter to continue.

### Scene 2: Feature Input (3-7s)

Progress bar advances. Header shows "What should OpenWeft build?" in sky blue.

User types into the green-bordered input box:

```
╭─────────────────────────────────────────────╮
│ ›  add dark mode with system preference █    │
╰─────────────────────────────────────────────╯
```

Presses Enter. Queued as `#001`.

### Scene 3: Add More (7-11s)

Shows queued items:

```
#001 add dark mode with system preference detection
```

User selects "Add another request", types a second feature:

```
╭─────────────────────────────────────────────╮
│ ›  refactor auth middleware for oauth2 █      │
╰─────────────────────────────────────────────╯
```

Selects "Continue to launch".

### Scene 4: Launch (11-14s)

"Ready to start" header in lavender. Pipeline summary visible. User selects:

```
› Start now — 2 requests queued
```

### Scene 5: Dashboard Reveal (14-20s)

The fullscreen TUI appears:

```
◆ openweft  │ idle  │ pending 2

╭──────────────────────────────────────────────╮
│ ◌  add dark mode with system preference...   │
╰──────────────────────────────────────────────╯
╭──────────────────────────────────────────────╮
│ ◌  refactor auth middleware for oauth2...     │
╰──────────────────────────────────────────────╯

                                    s start  a add  d remove  ? help
```

The queued features appear as agent cards with `◌` (queued) status icons. Recording ends here, before the orchestrator attempts backend calls.

## File Structure

```
docs/demo.tape                 — VHS tape file (declarative recording script)
scripts/record-demo.sh         — environment setup + VHS + svg-term + cleanup
docs/wizard-dark.svg           — output: dark theme wizard animation
docs/wizard-light.svg          — output: light theme wizard animation
```

## Environment Stubs

The recording script creates minimal shell stubs for backend detection:

```bash
#!/bin/bash
STUB_DIR=$(mktemp -d)

# Stub codex
cat > "$STUB_DIR/codex" << 'STUB'
#!/bin/bash
[[ "$1 $2" == "login status" ]] && echo "Logged in" && exit 0
STUB
chmod +x "$STUB_DIR/codex"

# Stub claude
cat > "$STUB_DIR/claude" << 'STUB'
#!/bin/bash
[[ "$1 $2" == "auth status" ]] && echo "Authenticated" && exit 0
STUB
chmod +x "$STUB_DIR/claude"

export PATH="$STUB_DIR:$PATH"
```

The wizard sees both backends as authenticated. The stubs don't handle execution — recording ends before orchestration calls the backends.

## README Integration

Placed below the existing hero animation, above the pitch copy:

```html
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/wizard-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="./docs/wizard-light.svg">
    <img alt="OpenWeft setup wizard" src="./docs/wizard-dark.svg" width="100%">
  </picture>
</p>
```

## npm Script

```json
"demo:record": "bash scripts/record-demo.sh"
```

## Recording Dependencies

Dev-time only, not shipped:
- `vhs` — `brew install vhs` or `go install github.com/charmbracelet/vhs@latest`
- `svg-term-cli` — `npm install -g svg-term-cli`

Documented in `scripts/record-demo.sh` header comments.

## Dark/Light Theme Handling

- Dark variant: recorded with Catppuccin Mocha terminal colors (the wizard's native palette)
- Light variant: generated from the same recording with `svg-term-cli --profile` remapping to a light terminal theme
- Both embedded via `<picture>` with `prefers-color-scheme` media queries (same pattern as existing assets)

## Launch Readiness Test Update

The test at `tests/release/launchReadiness.test.ts` validates SVG references in the README. It needs to be updated to also check for `wizard-dark.svg` and `wizard-light.svg`.

## Skipped Wizard Steps

Steps 2 (Backends) and 3 (Init) are navigated through but given minimal screen time:
- Step 2: backend auto-detected, press Enter to continue (~1s)
- Step 3: init runs automatically, brief flash of success output (~1s)

The animation focuses on the user-facing steps: what you see, what you type, and what happens next.

## Existing Animation Assessment

The current hero animation (`hero-dark.svg`) is **accurate enough to keep as-is**:

| Element | Accurate? |
|---------|-----------|
| `openweft add "..."` syntax | Yes |
| Three sequential adds | Yes |
| `openweft start --bg` | Yes |
| `✓ 3 merged, 0 conflicts` appearing immediately | Compressed — `--bg` actually prints a PID message; results come later via `openweft status` |

The compression is standard README storytelling. The animation communicates the right idea (queue work, start, get clean merges) and all commands shown are real. No changes recommended.

## Final README Animation Strategy

1. **Banner** (existing) — animated weft-weaving brand identity
2. **Hero** (existing) — CLI-only workflow: `add`, `add`, `add`, `start --bg`, merged results
3. **Wizard** (new) — interactive experience: onboarding wizard → TUI dashboard reveal

Three animations, three layers of the story:
- Banner: what OpenWeft is (identity)
- Hero: what you type (CLI commands)
- Wizard: what you experience (interactive TUI)
