# Wave 1 Findings: planning-pipeline

## Scope
Wave 1 review of the planning pipeline path from raw request → Work Brief generation (`prompt-a`) → feature plan (`## Manifest` + `## Ledger`) → repair (`planMarkdown`) → execution planning state transitions (`realRun`).

## Files Inspected
- `/Users/warrencain/Documents/openweft/AGENTS.md`
- `/Users/warrencain/Documents/openweft/CLAUDE.md`
- `/Users/warrencain/Documents/openweft/README.md`
- `/Users/warrencain/Documents/openweft/ARCHITECTURE.md`
- `/Users/warrencain/Documents/openweft/package.json`
- `/Users/warrencain/Documents/openweft/prompts/prompt-a.md`
- `/Users/warrencain/Documents/openweft/prompts/plan-adjustment.md`
- `/Users/warrencain/Documents/openweft/src/adapters/prompts.ts`
- `/Users/warrencain/Documents/openweft/src/domain/manifest.ts`
- `/Users/warrencain/Documents/openweft/src/domain/featureIds.ts`
- `/Users/warrencain/Documents/openweft/src/domain/paths.ts`
- `/Users/warrencain/Documents/openweft/src/domain/primitives.ts`
- `/Users/warrencain/Documents/openweft/src/orchestrator/planMarkdown.ts`
- `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts`
- `/Users/warrencain/Documents/openweft/tests/domain/manifest.test.ts`
- `/Users/warrencain/Documents/openweft/tests/adapters/prompts.test.ts`
- `/Users/warrencain/Documents/openweft/tests/orchestrator/planMarkdown.test.ts`
- `/Users/warrencain/Documents/openweft/tests/orchestrator/realRun.test.ts`
- `/Users/warrencain/Documents/openweft/tests/domain/featureIds.test.ts`
- `/Users/warrencain/Documents/openweft/research-output/openweft-production-ux-review/00_research_target_matrix.md`

## Commands Run
- `ls -la`
- `rg --files`
- `sed -n ...`
- `wc -l`
- `rg -n "..."` (targeted symbol search)
- `npx vitest run tests/domain/manifest.test.ts tests/adapters/prompts.test.ts tests/orchestrator/planMarkdown.test.ts` (failed: `npx: command not found`)
- `npm --version` / `node --version` (failed: command not found)

## Findings

1) **Severity: High**
   - **Area:** Parser strictness for `## Ledger`
   - **Evidence:** `assertLedgerSection` requires at least one `## Ledger` block and all 4 subheadings (`Constraints/Assumptions/Watchpoints/Validation`) in `src/domain/manifest.ts:131-144`; split-ledger outputs are treated as missing (`collectLedgerSections` keeps sections separate at `manifest.ts:97-128`); tests explicitly expect this rejection.
   - **User impact:** Slight formatting drift in model output drops a feature from the queue (`realRun.ts` catches planning errors and marks feature skipped), even if manifest/plan logic is otherwise usable. This can feel like arbitrary failure for users when the model emits valid content under slightly different heading structure.
   - **Recommended fix:** Keep the required headings but tolerate equivalent forms in one tolerant parsing path (for example, deduplicate `## Ledger` sections before validation), and normalize heading text case/markup variants before hard-fail.
   - **Confidence:** High
   - **What would disconfirm the finding:** Production telemetry shows model outputs always pass the current ledger shape without any false negatives after normalization and queue skips are near zero.

2) **Severity: Medium**
   - **Area:** Manifest repair fallback behavior
   - **Evidence:** `parseManifestJson` falls back to `last-known-good` when JSON repair fails and `lastKnownGood` is provided (`manifest.ts:181-185`); `planMarkdown` passes prior shadow plan manifest into repair (`planMarkdown.ts:38-45`, `realRun.ts:1662-1669`, `2302-2307`).
   - **User impact:** A malformed stage-two plan can be accepted with an old manifest, so phasing and overlap scoring may continue with stale file boundaries, which undermines trust in isolation and sequencing.
   - **Recommended fix:** Record manifest validity explicitly on repair completion and fail (or pause) if the repaired plan did not explicitly include a currently parseable manifest block, instead of silently reusing stale manifest data.
   - **Confidence:** High
   - **What would disconfirm the finding:** All malformed outputs that hit recovery paths still preserve correct intended manifest intent and no stale manifest reuse is observed in checkpoints/plan histories.

3) **Severity: High**
   - **Area:** Stage-two repair loop and skip semantics
   - **Evidence:** Repair loop is fixed to 2 retries (`planMarkdown.ts:47`), then throws a final extract error; `realRun.ts` treats recoverable planning errors as skip (`realRun.ts:1699-1710`, tests expect `status: skipped` and `lastError` text at `tests/orchestrator/realRun.test.ts:1997-2006`).
   - **User impact:** One malformed plan response can drop work silently into skipped state while the rest of the queue continues. The user receives a technical error but may lose intended changes unless they inspect the checkpoint/queue artifacts.
   - **Recommended fix:** Add a non-destructive retry gate after 2 failed repairs (e.g., surface explicit “resume required” action + preserved rejected draft path) and avoid marking skipped as final until user or operator confirms.
   - **Confidence:** High
   - **What would disconfirm the finding:** Replay tests show most malformed outputs are automatically fixed by repair, and skipped states are rare and acceptable to users because they are always immediately reviewed and retried.

4) **Severity: High**
   - **Area:** Re-analysis robustness and failure blast radius
   - **Evidence:** Re-analysis requires parseable adjusted plan and full ledger via `assertLedgerSection` and `parseManifestDocument` (`realRun.ts:2198-2309`); a missing/invalid ledger in one overlapping feature is treated as `adjustment-failed` and can bubble to run abort (`tests/orchestrator/realRun.test.ts:2564-2600` and preceding flow).
   - **User impact:** A single malformed adjustment response can block the whole run after earlier merges, creating brittle trust in merge/re-analysis stage even when most features are clean.
   - **Recommended fix:** Convert adjustment parse failure to per-feature graceful degradation (keep existing plan, mark feature for manual review) and continue remaining non-overlapping work, matching the same resilience pattern used in planning skip behavior.
   - **Confidence:** Medium-High
   - **What would disconfirm the finding:** Re-analysis failures remain rare and operator-visible; run termination at this stage never causes user trust or throughput regression in real usage.

5) **Severity: Low**
   - **Area:** Prompt surface bloat and UX interpretation cost
   - **Evidence:** `prompt-a.md` is highly prescriptive and large (full protocol + schemas + long instruction blocks), while stage 2 only re-anchors via concise manifest/ledger rules (`prompts/prompt-a.md`, `src/orchestrator/realRun.ts:1631-1650`, `src/orchestrator/planMarkdown.ts:73-96`).
   - **User impact:** High-entropy instruction stacks increase chance of model drift into non-schema-compliant formatting and increase chance of reaching repair paths unnecessarily, which can present as flaky planning UX.
   - **Recommended fix:** Keep Work Brief depth where needed, but separate “hard contract” constraints into minimal, deterministic parser contract blocks and place guidance-heavy protocol text in optional sections.
   - **Confidence:** Medium
   - **What would disconfirm the finding:** Repair and skip rates do not increase with longer Work Briefs, and parser compliance remains stable across large sample runs.

## Pipeline Correctness Map
- **Input intake:** queue parsed and `prompt-a` is marker-injected with `{{USER_REQUEST}}` (`src/adapters/prompts.ts:4-14`, `realRun.ts:1543-1550`).
- **Stage 1 planning:** outputs are forced read-only and must exceed minimum length; plan-save complaints are sanitized and retried once (`realRun.ts:1564-1620`, `prompts.ts`, and read-only tests around `realRun.test.ts:1560-1698`).
- **Stage 2 planning:** stage-two prompt enforces required Ledger + Manifest sections and includes Work Brief context (`realRun.ts:1631-1656`).
- **Repair path:** `repairPlanMarkdownIfNeeded` validates Ledger + Manifest, then repairs up to 2 times with explicit context and records invalid-attempt audits (`planMarkdown.ts:52-140`, `realRun.ts:1662-1699`).
- **Artifact persistence:** on repaired success, canonical plan + shadow plan are written; on failure, checkpoint feature status becomes `skipped`, `planFile: null`, and `lastError` stores final validation reason (`realRun.ts:1770-1814`, `1699-1710`).
- **Execution prelude:** features pass scoring, manifest overlap, and phase assembly (`realRun.ts:1841-1907`), so any malformed manifest directly shapes execution safety/risk.
- **Post-merge re-analysis:** overlapping remaining features are rechecked via `plan-adjustment.md` and must return updated Ledger/Manifest; failures currently propagate at feature-level and can abort flow (`realRun.ts:2182-2345`).

## Domino / Second-Order Risks
- **Stricter manifest repair** (e.g., no `last-known-good` fallback): reduces silent drift but will likely increase hard failures and re-runs unless retry UX is improved.
- **Laxer manifest repair** (e.g., accept missing/invalid manifests): increases throughput but weakens manifest-based phasing guarantees and can execute against wrong file scopes.
- **Ledger enforcement hardening** (stricter heading requirements): improves parser determinism but amplifies model-format failures that convert real plans into skips.
- **Prompt simplification strategy:** trimming `prompt-a`/contract text lowers output-cost and drift risk, but may also remove guardrails that currently stabilize downstream behavior in complex or high-risk requests.

###COMPLETE###
