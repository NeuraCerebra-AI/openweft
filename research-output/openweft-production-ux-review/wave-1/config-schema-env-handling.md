# Config Schema / Env Handling Review

## Scope
Reviewed the config schema, config loader, config options, CLI config/env preflight, model-save path, and the README/ARCHITECTURE config sections for strictness, error quality, API-key handling, defaults, config hash behavior, and docs alignment.

## Files Inspected
- `/Users/warrencain/Documents/openweft/src/config/schema.ts` - schema shape, strictness, defaults, allowed auth/env values.
- `/Users/warrencain/Documents/openweft/src/config/loadConfig.ts` - config loading, default merging, path resolution, and hash generation.
- `/Users/warrencain/Documents/openweft/src/config/options.ts` - model/effort option sets and defaults.
- `/Users/warrencain/Documents/openweft/src/cli/handlers.ts` - startup auth preflight, config editing gates, init behavior, and runtime hash refresh.
- `/Users/warrencain/Documents/openweft/src/fs/paths.ts` - how config-relative paths become runtime paths.
- `/Users/warrencain/Documents/openweft/src/adapters/shared.ts` - API-key env injection behavior.
- `/Users/warrencain/Documents/openweft/README.md` - user-facing config and runtime docs.
- `/Users/warrencain/Documents/openweft/ARCHITECTURE.md` - schema and runtime contract docs.
- `/Users/warrencain/Documents/openweft/tests/config/loadConfig.test.ts` - defaults, strictness, path resolution, hash stability, and error formatting coverage.
- `/Users/warrencain/Documents/openweft/tests/config/options.test.ts` - model option defaults and fallback list.
- `/Users/warrencain/Documents/openweft/tests/cli/handlers.test.ts` - init/config preservation, API-key preflight, and package.json config discovery.
- `/Users/warrencain/Documents/openweft/tests/cli/handlers.tui.test.ts` - model selection display/edit behavior and config-hash refresh after saves.

## Commands Run
- `PATH=/opt/homebrew/bin:$PATH ./node_modules/.bin/vitest run tests/config/loadConfig.test.ts tests/config/options.test.ts`
- `PATH=/opt/homebrew/bin:$PATH ./node_modules/.bin/vitest run tests/cli/handlers.test.ts tests/cli/handlers.tui.test.ts -t "fails api_key auth mode before tmux launch when the required env var is missing|fails start before orchestration when the configured backend CLI is missing|respects existing config discovered via package.json during init|marks package.json-backed config as non-editable in the ready-state dashboard|seeds the direct start dashboard with the active backend, model, and effort|applies direct start model and effort overrides to the runtime config|persists pre-start model changes and starts with refreshed config and hash|keeps the ready-state dashboard open and shows an error when the configured backend is not ready"`
- `PATH=/opt/homebrew/bin:$PATH ./node_modules/.bin/tsx --eval ...` - malformed JSON config probe; confirmed the loader returns a pathful `JSON Error in ...` message.
- `PATH=/opt/homebrew/bin:$PATH ./node_modules/.bin/tsx --eval ...` - `createConfigHash()` probe; confirmed `auth.codex.envVar` changes the hash.

## Findings

### 1. [Low] README overstates what `openweft init` does when a config already exists
- **Area:** Docs / init bootstrap
- **Evidence:** `/Users/warrencain/Documents/openweft/src/cli/handlers.ts:1820-1837` only writes `.openweftrc.json` when `loadOpenWeftConfig()` reports no config; the same file is used to keep existing config sources intact. `/Users/warrencain/Documents/openweft/tests/cli/handlers.test.ts:958-1009` explicitly expects a `package.json`-backed config to be preserved. `/Users/warrencain/Documents/openweft/README.md:307-323` says `openweft init` writes `.openweftrc.json` without calling out the existing-config branch.
- **User impact:** A user can read the README and expect a local JSON config file to appear even when the repo already has config in `package.json` or another supported source. In practice, OpenWeft keeps the existing config source and does not create the new JSON file.
- **Recommended fix:** Clarify the README/ARCHITECTURE text to say `init` writes `.openweftrc.json` only when no config already exists, and otherwise preserves the discovered config source.
- **Confidence:** High.
- **What would disconfirm:** If the product intent is to always create a repo-local JSON file, then the existing `init` code and the package.json-backed test need to change; current behavior is intentionally preservation-first.

### 2. [Low] API-key env-var handling is correct in code but under-documented for users
- **Area:** Docs / API-key setup
- **Evidence:** `/Users/warrencain/Documents/openweft/src/config/schema.ts:12-17` allows `auth.*.envVar`, and `/Users/warrencain/Documents/openweft/src/cli/handlers.ts:1311-1342` uses a backend-specific default env var when `envVar` is omitted and emits a targeted missing-env error. `/Users/warrencain/Documents/openweft/tests/cli/handlers.test.ts:840-912` verifies the custom-env-var failure path. The README config table at `/Users/warrencain/Documents/openweft/README.md:309-321` mentions `auth.*.method` but does not name the override knob or the default env vars. The architecture doc shows the shape at `/Users/warrencain/Documents/openweft/ARCHITECTURE.md:693-717`, but still does not spell out the default env names.
- **User impact:** API-key users have to infer the default env var names from errors or source, which makes setup feel more mysterious than it needs to be.
- **Recommended fix:** Add a short API-key example in the README that names `CODEX_API_KEY` / `ANTHROPIC_API_KEY` and shows how to override them with `auth.*.envVar`.
- **Confidence:** Medium-high.
- **What would disconfirm:** If there is another user-facing doc or onboarding step that already explains the env-var defaults and override path, I did not find it in the inspected README/ARCHITECTURE surfaces.

### 3. [Low] Non-JSON config files are read-only in the model/effort dashboard path
- **Area:** UI / config editing
- **Evidence:** `/Users/warrencain/Documents/openweft/src/cli/handlers.ts:1529-1545` and `/Users/warrencain/Documents/openweft/src/cli/handlers.ts:2033-2045` gate config edits to dedicated `.json` files and show an info notice otherwise. `/Users/warrencain/Documents/openweft/tests/cli/handlers.tui.test.ts:1491-1558` verifies that `package.json`-backed config is marked non-editable. The docs at `/Users/warrencain/Documents/openweft/README.md:307-323` and `/Users/warrencain/Documents/openweft/ARCHITECTURE.md:689-722` describe the config surface and dashboard flow, but do not call out the read-only branch.
- **User impact:** People using `package.json`, YAML, or JS config sources can start OpenWeft normally, but they cannot persist model/effort changes from the dashboard. That can look like a save failure if they miss the notice.
- **Recommended fix:** Document the limitation in the README or add a short inline dashboard hint that persistent model edits require a dedicated JSON config file.
- **Confidence:** High.
- **What would disconfirm:** If the non-JSON restriction is intentionally permanent and already documented elsewhere, then this is only a discoverability gap, not a behavioral problem.

## Config Trust Map
| Area | Trust level | Why |
|---|---|---|
| Schema strictness | High | `OpenWeftConfigSchema` and all nested schemas are `.strict()`, and the tests reject unsupported fields like `audio`. |
| Defaults | High | `DEFAULT_OPENWEFT_CONFIG` matches the documented defaults and the loader test checks the expected values. |
| Error messages | High | Loader errors are wrapped with the config path and field path details, and malformed JSON produces a pathful parse error. |
| API-key handling | High for runtime, medium for discoverability | The preflight path and adapter env injection agree on custom env vars and backend defaults, but the README under-explains the setup. |
| Config hash | High | The hash covers backend, auth, prompts, paths, models, effort, approval, concurrency, rate limits, status, runtime, and budget; a direct probe confirmed `auth.envVar` changes the hash. |
| Dashboard config editing | Medium | The code is deliberate and tested, but it is JSON-only and easy to miss unless you hit the notice. |

## Domino / Second-Order Risks
- If the README keeps implying that `init` always writes a fresh `.openweftrc.json`, onboarding can feel inconsistent whenever OpenWeft preserves an existing config source instead.
- API-key users may churn through a few failed starts before discovering the env-var naming rule, especially if they rely on defaults instead of setting `auth.*.envVar` explicitly.
- Package.json/YAML/JS config users may assume the dashboard can persist model changes; without a docs note, the read-only save path looks like a silent save failure.
- The good news: the hash and error-path behavior are solid enough that config reloads and invalid-file diagnostics look trustworthy from the inspected code and tests.

## Recommended Follow-Up
- Update the README config section to state the exact `init` behavior when config already exists, and add the package.json preservation caveat.
- Add a short API-key example showing `auth.*.method: api_key`, the default env vars, and the `envVar` override.
- Add one dashboard/config note that persistent model edits are limited to dedicated JSON config files.
- Consider adding a direct unit test for `createConfigHash()` changing when `auth.codex.envVar` changes, since the runtime probe confirmed it but the current test file does not.

###COMPLETE###
