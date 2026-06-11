# OpenWeft Wave 1: Tests Release Readiness

Date: 2026-06-10

**Verdict**
The automated release gate is strong for repo-internal quality and packaged CLI installability. The two things that keep this from being fully release-ready are: live-provider smoke is still an operator-only policy, not a release gate, and npm is named in `package.json` but not version-pinned in CI.

## Scope
This pass focused on `package.json` scripts, the `tests/` coverage map, `scripts/live-smoke*.mjs`, `scripts/packaged-cli-smoke.mjs`, release tests, CI release wiring, and the docs/runtime assumptions around Node and npm.

Coordinator-provided evidence treated as confirmed:
- `typecheck` passed
- `npm test` passed with 74 files / 824 tests
- `build` passed
- `release:check` passed through packaged CLI smoke and `npm publish --dry-run`
- targeted surface sweep passed with 64 files / 756 tests

I did not rerun the full suite in this pass; I used the passed results above as the verification baseline and cross-checked them against the current tree.

## Files Inspected
- `/Users/warrencain/Documents/openweft/AGENTS.md`
- `/Users/warrencain/Documents/openweft/CLAUDE.md`
- `/Users/warrencain/Documents/openweft/README.md`
- `/Users/warrencain/Documents/openweft/ARCHITECTURE.md`
- `/Users/warrencain/Documents/openweft/package.json`
- `/Users/warrencain/Documents/openweft/.github/workflows/ci.yml`
- `/Users/warrencain/Documents/openweft/research-output/openweft-production-ux-review/00_research_target_matrix.md`
- `/Users/warrencain/Documents/openweft/scripts/live-smoke.mjs`
- `/Users/warrencain/Documents/openweft/scripts/live-smoke-helpers.mjs`
- `/Users/warrencain/Documents/openweft/scripts/packaged-cli-smoke.mjs`
- `/Users/warrencain/Documents/openweft/scripts/normalize-cast.ts`
- `/Users/warrencain/Documents/openweft/tests/release/launchReadiness.test.ts`
- `/Users/warrencain/Documents/openweft/tests/release/liveSmokeScript.test.ts`
- `/Users/warrencain/Documents/openweft/tests/release/runtimeVersion.test.ts`
- `/Users/warrencain/Documents/openweft/tests/release/normalizeCast.test.ts`
- `/Users/warrencain/Documents/openweft/tests/release/wizardRecording.test.ts`

## Commands Run
- `sed -n` reads of `AGENTS.md`, `CLAUDE.md`, `README.md`, `ARCHITECTURE.md`, `package.json`, and the release script/test files
- `nl -ba` reads of the same files for line-accurate references
- `rg --files tests/release` and `rg --files scripts` for inventory
- `find tests -type f ... | awk ...` to build the top-level coverage map
- `find tests -type f ... | wc -l` to confirm the test-file total
- `rg -n` across `README.md`, `ARCHITECTURE.md`, `package.json`, `scripts/`, `.github/`, and the target matrix for release/smoke/npm assumptions
- `git status --short` to verify the working tree context
- `nl -ba /Users/warrencain/.codex/memories/MEMORY.md ...` for older live-smoke context that was relevant to this repo

## Findings

### 1. [High] Live smoke is not part of the release gate
- **Area:** Release policy / live-provider validation
- **Evidence:** `package.json:38-46` defines `release:check` as `typecheck && test && build && release:smoke:packaged-cli && npm publish --dry-run`, but it does not invoke `smoke:live:codex`, `smoke:live:codex:resume`, or `smoke:live:claude`. CI mirrors that by running only `release:check` in `.github/workflows/ci.yml:18-29`. The live smoke itself requires external auth checks (`scripts/live-smoke.mjs:101-114`) and only proves completion / checkpoint state after the run (`scripts/live-smoke.mjs:182-193`). The release test file `tests/release/liveSmokeScript.test.ts:33-65` unit-tests helper behavior and prompt wording, but it does not execute the real backend smoke in CI.
- **User impact:** A release can be green on build/test/package checks and still be broken for real Codex/Claude logins, backend auth drift, or provider-side behavior changes.
- **Recommended fix:** Make live smoke an explicit release policy, not just a script. The cleanest version is a protected pre-release step that runs at least one backend smoke (`smoke:live:codex` or `smoke:live:claude`, ideally both when credentials are available). If CI auth is impractical, document a mandatory manual preflight and store the result next to the publish decision.
- **Confidence:** High
- **What would disconfirm:** A separate release workflow or documented SOP outside this tree that already requires and records a successful live-provider smoke before publish.

### 2. [Medium] npm is named, but not pinned or enforced
- **Area:** Node/npm reproducibility
- **Evidence:** `package.json:15-33` declares `packageManager: "npm@11.6.0"` and `engines.node: ">=24.0.0"`, but `.github/workflows/ci.yml:18-24` only sets up Node 24 and runs `npm ci`. There is no `corepack` activation, no `npm --version` check, and no docs text in `README.md:83` that states the required npm version.
- **User impact:** Pack/publish behavior can drift across environments even when the repo passes CI, especially on machines where the bundled npm differs from 11.6.0.
- **Recommended fix:** Pin or assert npm in CI and in the release instructions. A simple `corepack prepare npm@11.6.0 --activate` or explicit version check before install is enough to make the release path deterministic.
- **Confidence:** Medium-High
- **What would disconfirm:** A bootstrap path or hidden workflow that already guarantees npm 11.6.0 everywhere this repo is released from.

## Validation Coverage Map
The test tree is broad: 74 test files total, with coverage spread across 13 major areas. The release-specific surface is only 5 files, so it is useful but intentionally narrow.

| Area | Files | What it covers | Release-readiness note |
|---|---:|---|---|
| `tests/release` | 5 | Launch readiness, live-smoke helper parsing and diagnostics, version wiring, asciicast normalization, wizard recording pipeline | Good coverage of release plumbing, but it does not execute live-provider smoke end-to-end |
| `tests/e2e` | 3 | CLI dry-run, real-mock, and background flows | Useful for user workflows, still offline |
| `tests/cli` | 5 | Commander wiring, launch, stream, TUI, handler behavior | Good command-surface coverage |
| `tests/ui` | 33 | Onboarding, status, help, menus, cards, hooks, store, and text editing | Strong UX coverage, not release-gate specific |
| `tests/domain` | 10 | Manifest, phases, scoring, queue, IDs, errors, slugs, costs | Strong core logic coverage |
| `tests/adapters` | 6 | Codex, Claude, mock, runner, prompts, Codex home | Good backend normalization coverage |
| `tests/orchestrator` | 3 | Approval, plan markdown, real run sequencing | Important for release trust |
| `tests/git` | 2 | Worktree lifecycle and autostash | Good for merge safety |
| `tests/config` | 2 | Config options and loading | Good setup coverage |
| `tests/state` | 1 | Checkpoint persistence | Core recovery surface |
| `tests/status` | 1 | Status rendering | User-facing diagnostics |
| `tests/fs` | 1 | File helpers | Supporting utilities |
| `tests/notifications` | 1 | Notification behavior | Adjacent runtime surface |
| `tests/tmux` | 1 | tmux integration | Optional runtime path |

Overall shape: the repo is well covered for internal logic, CLI wiring, UI behavior, and packaging. The thin spot is the live external-provider path, which is intentionally outside CI today.

## Domino / Second-Order Risks
- The simplest live smoke (`single`) only proves completion and file creation; the stronger content/audit assertions live in the resume path. That means a content-fidelity regression can still hide behind a green single smoke.
- `scripts/packaged-cli-smoke.mjs` proves the tarball installs, `--help` works, and `init` scaffolds the skill, but it does not exercise a post-install `start` or `add` workflow from the installed package.
- Because the repo pins Node 24 but not npm itself, publish behavior can vary subtly between developer machines and CI runners.
- The release gate being green does not automatically mean the product is ready for a real Codex/Claude session; it means the repo is ready to ship its packaged artifact and internal logic, not that the external providers are healthy.

## Recommended Follow-Up
1. Add a release checklist or protected workflow step for live smoke, so the real backend path is covered before publish.
2. Pin npm in CI or via Corepack so the release gate uses the same npm version everywhere.
3. Decide whether the single live smoke should assert file content, or whether the resume smoke should be the minimum live-provider release check.
4. Keep `release:check` as the main automated gate, but document clearly that it is not a substitute for live-provider validation.

###COMPLETE###
