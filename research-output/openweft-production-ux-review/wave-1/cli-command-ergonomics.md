# Wave 1 Findings: cli-command-ergonomics

## Scope
- CLI command ergonomics, help/readability, runtime mode selection, stdin handling, and handler routing for:
  - default/no-arg entry behavior
  - `start` orchestration modes (`--bg`, `--stream`, `--tmux`, `--dry-run`)
  - `status` and `stop` operational surfaces
  - command-to-handler mapping and discoverability evidence in source + tests
- Files reviewed include `AGENTS.md`, `CLAUDE.md`, `README.md`, `ARCHITECTURE.md`, `package.json`, and the CLI/test modules under `src/cli`, `src/tmux`, `tests/cli`, `tests/e2e`.

## Files Inspected
- `/Users/warrencain/Documents/openweft/AGENTS.md`
- `/Users/warrencain/Documents/openweft/CLAUDE.md`
- `/Users/warrencain/Documents/openweft/README.md`
- `/Users/warrencain/Documents/openweft/ARCHITECTURE.md`
- `/Users/warrencain/Documents/openweft/package.json`
- `/Users/warrencain/Documents/openweft/src/index.ts`
- `/Users/warrencain/Documents/openweft/src/bin/openweft.ts`
- `/Users/warrencain/Documents/openweft/src/cli/buildProgram.ts`
- `/Users/warrencain/Documents/openweft/src/cli/handlers.ts`
- `/Users/warrencain/Documents/openweft/src/tmux/index.ts`
- `/Users/warrencain/Documents/openweft/tests/cli/buildProgram.test.ts`
- `/Users/warrencain/Documents/openweft/tests/cli/handlers.test.ts`
- `/Users/warrencain/Documents/openweft/tests/cli/handlers.stream.test.ts`
- `/Users/warrencain/Documents/openweft/tests/cli/handlers.tui.test.ts`
- `/Users/warrencain/Documents/openweft/tests/cli/handlers.launch.test.ts`
- `/Users/warrencain/Documents/openweft/tests/e2e/cli-background.test.ts`
- `/Users/warrencain/Documents/openweft/tests/e2e/cli-dry-run.test.ts`
- `/Users/warrencain/Documents/openweft/tests/e2e/cli-real-mock.test.ts`
- `/Users/warrencain/Documents/openweft/research-output/openweft-production-ux-review/00_research_target_matrix.md`

## Commands Run
- `rg --files AGENTS.md CLAUDE.md README.md ARCHITECTURE.md package.json src/cli src/bin src/tmux tests/cli tests/e2e research-output/openweft-production-ux-review/00_research_target_matrix.md`
- `nl -ba` reads against all reviewed source/test files
- `rg -n "buildProgram|createCommandHandlers|readCommandInput|start\\s*:\\s*async|background|stop"` on `src/cli/handlers.ts`
- `rg -n "Cannot combine|--bg|--tmux|tmux was not found|OPENWEFT_BACKGROUND_CHILD|No feature request"` on `tests/cli` and `tests/e2e`
- `cd /Users/warrencain/Documents/openweft && command -v npm && command -v node && command -v pnpm && command -v yarn && command -v bun && command -v npx`
  → `npm: missing`, `node: missing`, `pnpm: missing`, `yarn: missing`, `bun: missing`, `npx: missing`
- `cd /Users/warrencain/Documents/openweft && openweft --help`
  → `zsh:1: command not found: openweft`
- Attempted runtime execution in this environment was blocked by missing toolchain (no Node/npm/bin runtime), so CLI help/read/e2e test execution was not possible.

## Findings

- **Severity:** Medium
  **Area:** Command discoverability (`launch` vs no-arg entry)
  **Evidence:** Command registration intentionally sets only `init/add/start/status/stop` and uses default action as launch (`buildProgram` command list at `src/cli/buildProgram.ts:49-90`, no `launch` command). Default entry behavior is implemented in `src/bin/openweft.ts:8-11` and tested as no-config command list behavior in `tests/cli/buildProgram.test.ts:6-10`.
  **User impact:** Running `openweft --help` exposes fewer mental models for onboarding/resume flow than runtime behavior. New users can run `openweft` successfully (launch path), but do not see a command-name anchor for this behavior in help output.
  **Recommended fix:** Add an explicit, non-breaking `launch` command in `buildProgram` that maps to the existing launch handler and documents “no args = launch” equivalence in command help and README.
  **Confidence:** High
  **What would disconfirm:** If Commander help output already lists/communicates launch semantics via another custom override not visible in `buildProgram`/bin inspection.

- **Severity:** Medium
  **Area:** Resume ergonomics
  **Evidence:** No explicit `resume` command exists (`buildProgram` command list `init/add/start/status/stop` only; `src/cli/buildProgram.ts:10-10`), while resume behavior is embedded in `start`/`launch` through checkpoint loading (`src/cli/handlers.ts:219-223, 2254-2327`). README maps workflow primarily to `start` without a `resume` verb.
  **User impact:** Users are forced to infer resume from implementation detail (“`openweft start` restarts actionable checkpoint work”) instead of explicit command intent, raising cognitive load for recovery workflows.
  **Recommended fix:** Add `openweft resume` as an alias of `start` with one-line docs: “resume in-progress checkpoint/features,” and include explicit recovery copy in `status` output.
  **Confidence:** Medium-High
  **What would disconfirm:** If external docs, onboarding, or tests already define and validate a first-class resume term as part of user-facing UX.

- **Severity:** Medium
  **Area:** `start` mode discoverability (`--stream`, `--tmux`, `--bg`, TTY behavior)
  **Evidence:** `start` help includes all flags (`tests/cli/buildProgram.test.ts:13-25`), but runtime behavior makes mode selection conditional: in TTY and non-stream/non-tmux/non-bg it opens the dashboard TUI (`src/cli/handlers.ts:2328-2395`), stream mode short-circuits to raw orchestrator output (`src/cli/handlers.ts:2296-2439`, `tests/cli/handlers.stream.test.ts`), `--tmux` is optional wrapper with backend compatibility checks (`src/cli/handlers.ts:2297-2325`, `src/cli/handlers.ts:2308-2320`), and `--bg` re-spawns detached and returns immediately (`src/cli/handlers.ts:2265-2293`).
  **User impact:** Same command can lead to three very different UX paths with no in-command-mode warning; TTY users may miss that `openweft start` opens an interactive UI unless they know `--stream` and that `--tmux` alters execution behavior.
  **Recommended fix:** Improve `start` help text and README with a mode table (“TTY default = dashboard, `--stream` = raw terminal output, `--bg` = detached PID+log mode, `--tmux` = wrapper + stream-like output”).
  **Confidence:** High
  **What would disconfirm:** If runtime help output clearly annotates mode branches (not just Commander option list).

- **Severity:** Medium
  **Area:** Background output and stop semantics
  **Evidence:** Background start only prints PID + status hint (`src/cli/handlers.ts:2270-2293`) and writes logs to `.openweft/output.log`; `stop` is graceful with a “wait for current phase” message and a 300-second SIGTERM wait loop (`src/cli/handlers.ts:2398-2509`, `src/cli/handlers.ts:2556-2585`), with SIGKILL only after loop (`src/cli/handlers.ts:2601-2609`). E2E verifies this wording and flow (`tests/e2e/cli-background.test.ts:52-65`).
  **User impact:** Foreground users may assume immediate stop and may not know where live output goes during background execution, creating delayed feedback loops during incident response.
  **Recommended fix:** Update background start success text to include log path, and stop success/error wording to distinguish “phase-synchronous stop” vs “forced stop.”
  **Confidence:** High
  **What would disconfirm:** If product-level docs already surface background log path + stop timeout behavior prominently at first use.

- **Severity:** Low
  **Area:** `add` stdin ergonomics
  **Evidence:** `add` reads command-line argument or stdin when no arg (`src/cli/handlers.ts:1156-1175`). If TTY and no arg, it throws immediate guidance (“Provide a feature request argument or pipe requests via stdin.”). If stdin exists but empty it errors “No feature request text was provided.” (`src/cli/handlers.ts:1161-1174`). Tests confirm multiline and manual stdin behavior (`tests/cli/handlers.test.ts:456-545`).
  **User impact:** Power users can use stdin, but discoverability depends on reading docs/tests because command-level help gives no hint at accepted stdin path.
  **Recommended fix:** Mention stdin behavior in `README` command reference and include `openweft add` usage example with pipe form (e.g., `cat file | openweft add`).
  **Confidence:** Medium
  **What would disconfirm:** If command help or `openweft help` currently renders the stdin contract from a layer not inspected here.

## Command Discoverability Map
| Command / Input            | Handler / internal flow                                                                                                                      | User-visible behavior                                                                    |
|----------------------------|---------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------|
| `openweft` (no args)       | `src/bin/openweft.ts` -> `handlers.launch()`                                                                                                 | First-run onboarding if no config; otherwise launches ready-state dashboard or status.      |
| `openweft init`            | `handlers.init`                                                                                                                             | Initializes directories, runtime files, prompts, `.gitignore`, and displays status card.    |
| `openweft add [request]`   | `handlers.add` + `readCommandInput`                                                                                                         | Queues request; accepts arg or piped stdin; errors when neither provided.                |
| `openweft start`           | `handlers.start`                                                                                                                            | Loads config, optional checkpoint queue, then chooses: bg, tmux, stream, or TTY dashboard.|
| `openweft start --bg`      | `handlers.start` -> `spawnBackground`                                                                                                        | Writes/uses PID file; waits for child readiness; returns PID hint with `openweft status`. |
| `openweft start --tmux`    | `handlers.start` -> `detectTmux`/`spawnTmuxSession`                                                                                          | Relaunches in wrapped command; removes `--tmux` from child args and forces stream behavior.|
| `openweft start --stream`  | `handlers.start` with `useStream=true`                                                                                                       | No dashboard; calls orchestration in streamed mode.                                        |
| `openweft start --dry-run`  | `handlers.start` -> `runDryRunOrchestration`                                                                                                  | Dry-run summary with planned/completed counts.                                              |
| `openweft status`          | `handlers.status` -> `renderStatusReport` for non-TTY                                                                                         | Shows checkpoint/queue/background state including runtime diagnostics.                      |
| `openweft stop`            | `handlers.stop` with SIGTERM + phase-wait loop                                                                                               | Stops after current phase if possible; escalates SIGKILL after wait timeout.               |

## Domino / Second-Order Risks
- Introducing explicit `resume` or `launch` aliases is low risk from behavior perspective but could affect scripts relying on strict command allowlists; mitigation: preserve existing command behavior and add compatibility aliases first.
- Improving background UX (exposing log path and stop semantics) reduces support churn but may expose additional operational details in automation logs; no logic risk if messaging only changes.
- Altering `stop` semantics to be immediate would risk checkpoint consistency and partial merges; current phase-wait model is safer even if less immediate.
- Adding more explicit start-mode guidance in help is low code risk but can create expectation drift if runtime defaults change later; keep wording aligned with current branching conditions.

## Recommended Follow-Up
1. Add `launch` and/or `resume` as explicit command aliases while keeping existing default-action behavior untouched.
2. Expand `start` command help and README with a concise mode matrix: “dashboard/stream/background/tmux” plus when each mode is used by default.
3. Update background-start success text to include `.openweft/output.log` and explicit phase-wait stop semantics in both TTY and non-TTY paths.
4. Add a focused CLI help/UX test that validates mode branch output phrases for `--bg`, `--stream`, `--tmux` and no-arg launch.

###COMPLETE###
