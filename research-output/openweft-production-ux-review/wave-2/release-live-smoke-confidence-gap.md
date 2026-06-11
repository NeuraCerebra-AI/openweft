# OpenWeft Wave 2: Release / Live Smoke Confidence Gap

## Scope

This pass classifies the release-readiness tension identified by Wave 1: the automated local release path is green, including typecheck, tests, build, packaged CLI smoke, and npm dry-run, but real Codex/Claude provider behavior is not proven unless a live smoke is intentionally run with available provider access.

I did not change source code. I did not run `npm run smoke:live:codex`, `npm run smoke:live:codex:resume`, or `npm run smoke:live:claude` because this task did not explicitly authorize live provider access for the current pass.

Decision boundary used here:

- `release:check` can be treated as a repo/package release gate.
- Live provider smoke must be treated as a separate pre-publish or pre-announcement gate when the release claim includes real Codex/Claude execution.
- Historical live smoke success is useful context, not current proof.

## Files Inspected

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `ARCHITECTURE.md`
- `package.json`
- `.github/workflows/ci.yml`
- `scripts/live-smoke.mjs`
- `scripts/live-smoke-helpers.mjs`
- `scripts/packaged-cli-smoke.mjs`
- `tests/release/liveSmokeScript.test.ts`
- `tests/release/launchReadiness.test.ts`
- `tests/release/runtimeVersion.test.ts`
- `research-output/openweft-production-ux-review/wave-1-intelligence-summary.md`
- `research-output/openweft-production-ux-review/wave-1/tests-release-readiness.md`
- Prior-memory context for the earlier successful Codex resume smoke, used only as stale/historical context:
  - `/Users/warrencain/.codex/memories/MEMORY.md`
  - `/Users/warrencain/.codex/memories/rollout_summaries/2026-06-03T01-48-18-gC9H-openweft_live_resume_smoke_fix_verification.md`

## Commands Run

- `sed -n ...` reads for required docs, Wave 1 outputs, release scripts, release tests, and architecture sections.
- `nl -ba ...` reads for line-anchored evidence.
- `rg --files ...` inventory of release/smoke scripts, tests, CI, and existing Wave 2 outputs.
- `rg -n ...` search across README, architecture, package scripts, CI, scripts, tests, and Wave 1 release evidence.
- `cmp -s <(tail -n +2 AGENTS.md) <(tail -n +2 CLAUDE.md)` returned `0`, confirming the instruction files match after the allowed header-line difference.
- `node --version` returned `v24.9.0`.
- `npm --version` returned `11.6.0`.
- `npm run release:check` passed.
  - First test leg: `74 passed (74)` test files and `824 passed (824)` tests.
  - `npm run build` passed.
  - `npm run release:smoke:packaged-cli` passed.
  - `npm publish --dry-run` triggered `prepublishOnly`, reran typecheck and the same `74` files / `824` tests, reran `prepare` build, then produced npm dry-run publish output for `openweft@0.1.0`.
- `git status --short` after validation showed the pre-existing untracked groups still present: `.ultra_work/`, `.ultra_work_first_draft_openweft_safety.md`, `bin/`, `research-output/`, and `skills/`.

Not run:

- `npm run smoke:live:codex`
- `npm run smoke:live:codex:resume`
- `npm run smoke:live:claude`

Reason: no explicit live credential/provider authorization was given for this Wave 2 pass.

## Validation Result Per Claim

| Claim | Result | Evidence |
|---|---|---|
| `AGENTS.md` and `CLAUDE.md` are synced except for the header line | Validated | `cmp` after skipping line 1 returned `0`. |
| Local typecheck is green | Validated | `npm run release:check` completed its typecheck leg successfully. |
| Local tests are green | Validated | `npm run release:check` ran Vitest twice; both runs reported `74` test files and `824` tests passed. |
| Build is green | Validated | `npm run release:check` ran `npm run build`; npm dry-run also ran `prepare` and built again. |
| Packaged CLI smoke is green | Validated | `npm run release:check` ran `npm run release:smoke:packaged-cli`; that script packages, installs, runs `--help`, runs `init`, and verifies the OpenWeft Work Protocol skill scaffold. |
| npm dry-run is green | Validated | `npm publish --dry-run` completed and reported `+ openweft@0.1.0`. It warned login is required for real publish, but dry-run still succeeded. |
| CI runs the documented release gate | Validated from source | `.github/workflows/ci.yml` runs `npm run release:check`; `tests/release/launchReadiness.test.ts` asserts the same. |
| CI/live release gate includes live Codex/Claude smoke | Disconfirmed | `package.json` defines live smoke scripts separately, but `release:check` does not call them; CI calls only `release:check`. |
| Live smoke harness is meaningful when intentionally run | Validated from source, not run | `scripts/live-smoke.mjs` checks provider CLI auth, initializes a temp repo, runs the built CLI, verifies checkpoint status, and for `resume` verifies phase content plus resumed-adjustment audit behavior. |
| Current live Codex behavior is green | Not validated in this pass | Live Codex smoke was intentionally skipped. Historical memory says a Codex resume smoke passed earlier, but that is not current evidence. |
| Current live Claude behavior is green | Not validated in this pass | Live Claude smoke was intentionally skipped, and no current live Claude result was found in this pass. |
| Release confidence is production-complete solely from local gates | Disconfirmed | Wave 1 already flagged real provider behavior as a blind spot; current inspection confirms live scripts are outside `release:check`. |

## Findings

### Finding 1: Green `release:check` proves package/repo readiness, not live-provider readiness

- **Severity:** High confidence gap; not a source-level blocker by itself.
- **Area:** Release policy / provider validation.
- **Evidence:** `package.json` defines `release:check` as `typecheck && test && build && release:smoke:packaged-cli && npm publish --dry-run`, while the live smoke scripts are separate commands. CI runs `npm run release:check`, not any `smoke:live:*` command. README says real use requires one or both of `codex` / `claude` already logged in, so provider access is part of real product operation, but not part of the automated release gate.
- **User impact:** A release can be valid as a packaged npm artifact while still failing the first real Codex or Claude run because of CLI auth drift, provider output drift, session/resume behavior, rate-limit behavior, or subscription environment differences.
- **Recommended fix:** Keep `release:check` as the automated package gate, but add a mandatory release checklist item: run and record at least one current live provider smoke before publishing or announcing a release as real-provider-ready. For a release that claims both backends, require both `smoke:live:codex:resume` and `smoke:live:claude`.
- **Confidence:** High.
- **What would disconfirm:** A release SOP outside this tree that already requires and records current live smoke results before publish.

### Finding 2: Resume live smoke should be the minimum Codex live gate

- **Severity:** Medium-High.
- **Area:** Release policy / live smoke depth.
- **Evidence:** The single live smoke creates one file and verifies checkpoint completion. The resume scenario creates three serial requests, verifies all three content markers, checks for an adjustment turn on feature `002`, checks that feature `003` adjustment resumed with a `resume` command, and checks that feature `003` execution starts fresh after repo-scoped adjustments.
- **User impact:** A single-file smoke can pass while missing regressions in session reuse, re-analysis adjustment, multi-phase sequencing, or content preservation. Those are central to OpenWeft's promise of durable batch orchestration.
- **Recommended fix:** Treat `npm run smoke:live:codex:resume` as the minimum Codex live release gate. The single Codex smoke is acceptable only for a quick credential check after the stronger resume smoke has passed recently.
- **Confidence:** High.
- **What would disconfirm:** A cheaper single-smoke variant that is updated to assert comparable resume/session/audit behavior.

### Finding 3: Claude live smoke remains a separate backend confidence gap

- **Severity:** Medium.
- **Area:** Backend parity / provider-specific release confidence.
- **Evidence:** `package.json` exposes `smoke:live:claude`, and `scripts/live-smoke.mjs` supports `claude auth status`, but `release:check` and CI never run it. Current Wave 1 evidence explicitly marks real Codex/Claude provider behavior as unverified. The historical memory context I found is for Codex resume smoke, not current Claude smoke.
- **User impact:** If the release is described as supporting Claude Code, local tests and Codex-only smoke do not prove Claude CLI auth, output schema, permission mode behavior, or runtime command behavior.
- **Recommended fix:** For any release note that claims Claude readiness, run `npm run smoke:live:claude` intentionally and record the command, timestamp, backend, scenario, output, and temp-repo disposition. If Claude resume semantics become first-class, add a `smoke:live:claude:resume` script mirroring Codex.
- **Confidence:** Medium-High.
- **What would disconfirm:** A current, recorded Claude live smoke result from this release window.

### Finding 4: Packaged CLI smoke is strong but intentionally shallow

- **Severity:** Medium.
- **Area:** Package installability / installed CLI workflow coverage.
- **Evidence:** `scripts/packaged-cli-smoke.mjs` runs `npm pack --json`, installs the tarball into a temp project, runs installed CLI `--help`, initializes a git repo, runs installed CLI `init`, and verifies the scaffolded `skills/openweft-work-protocol/SKILL.md` contains `OpenWeft Work Protocol`. It does not run installed CLI `add`, `start --dry-run`, `start`, or live provider execution.
- **User impact:** The package can install and initialize correctly while a post-install run workflow remains broken.
- **Recommended fix:** Keep the current packaged smoke because it is fast and valuable. Add a second optional `release:smoke:packaged-dry-run` that uses the installed package to run `init`, `add`, and `start --dry-run` in the temp project. Do not put live provider execution inside this packaged smoke unless the release policy intentionally supplies credentials.
- **Confidence:** High.
- **What would disconfirm:** A separate packaged installed-CLI workflow test that already runs `add` and `start --dry-run` from the tarball.

### Finding 5: npm version reproducibility is currently locally satisfied but not CI-enforced

- **Severity:** Medium.
- **Area:** Release reproducibility.
- **Evidence:** `package.json` declares `packageManager: "npm@11.6.0"` and `engines.node: ">=24.0.0"`. Local validation used Node `v24.9.0` and npm `11.6.0`. CI sets up Node 24 and runs `npm ci`, but does not assert or activate npm `11.6.0`.
- **User impact:** The current local release evidence is good, but future CI or publisher machines can drift on npm behavior even while honoring Node 24.
- **Recommended fix:** In CI and release docs, assert `npm --version` equals `11.6.0` or activate it with Corepack before install/publish. This is a reproducibility hardening item, not a live-provider readiness blocker.
- **Confidence:** Medium-High.
- **What would disconfirm:** Existing external release infrastructure that pins npm `11.6.0` before running this repo's release commands.

## Release Policy Recommendation

Minimum policy:

1. **Package/repo release candidate:** require `npm run release:check` to pass on a clean-enough working tree. This proves type safety, tests, build output, packaged install/help/init, and npm dry-run.
2. **Codex-ready release claim:** require `OPENWEFT_LIVE_SMOKE_TIMEOUT_MS=<explicit timeout> npm run smoke:live:codex:resume` with intentional provider access. Record the command, backend, scenario, created file content, checkpoint status, and whether the temp repo was preserved.
3. **Claude-ready release claim:** require `npm run smoke:live:claude` with intentional provider access. If OpenWeft expects Claude session/resume parity, add and require a Claude resume smoke.
4. **Both-backend release claim:** require both Codex resume smoke and Claude smoke in the same release window.
5. **No credentials available:** do not block source/package readiness, but label the release as package-validated and provider-smoke-not-current. Do not call it live-provider-ready.

Severity classification:

- Current state after this pass: **Release candidate for repo/package quality: green.**
- Current state after this pass: **Live-provider readiness: unverified-current confidence gap.**
- Blocker status: **Not a code blocker unless the release is about to be published or advertised as real Codex/Claude ready without a current live smoke.**

Recommended release checklist:

- Confirm `git status --short` and separate intentional release artifacts from unrelated worktree drift.
- Confirm `AGENTS.md` and `CLAUDE.md` remain synced except for the first line.
- Run `node --version`; require Node `>=24`.
- Run `npm --version`; prefer/require `11.6.0` until CI enforces it.
- Run `npm run release:check`.
- Record the `npm run release:check` result, including test count and npm dry-run result.
- If publishing a Codex-ready release, run `npm run smoke:live:codex:resume` intentionally.
- If publishing a Claude-ready release, run `npm run smoke:live:claude` intentionally.
- If live smoke is skipped, state exactly why and mark provider behavior as not current-validated.
- Store live-smoke evidence with release notes or a release ledger: command, date/time, backend, scenario, timeout, checkpoint status, created content, and temp repo cleanup/preservation.

## Domino Risks

- **False confidence cascade:** A green `release:check` can become shorthand for "production-ready," and that phrase can hide the provider gap. The next person may skip live smoke because the package gate sounds comprehensive.
- **Provider drift:** Codex or Claude CLI auth/status/output/session behavior can change independently of OpenWeft source. Local mocks and adapter fixtures will not catch that drift until a live command runs.
- **Resume-path blind spot:** If the team accepts the single live smoke as enough, regressions in re-analysis, session resume, or multi-feature sequencing can escape because the single scenario only proves one simple file creation.
- **Backend asymmetry:** A Codex live pass can incorrectly imply Claude readiness. The two adapters share orchestration surfaces, but auth commands, output shape, permission behavior, and CLI failure modes differ.
- **Publishing-window ambiguity:** Historical memory says Codex resume smoke passed earlier, but using that as current release evidence creates stale-proof risk. Live smoke evidence should be tied to the release window.
- **Packaged artifact blind spot:** The packaged CLI smoke proves install/help/init, not installed-package execution. A tarball can look healthy while `add`/`start --dry-run` has a packaging-only failure.
- **Reproducibility drift:** Local npm is currently `11.6.0`, matching `packageManager`, but CI does not enforce it. A future publisher machine with a different npm can produce subtly different pack/publish behavior.

###COMPLETE###
