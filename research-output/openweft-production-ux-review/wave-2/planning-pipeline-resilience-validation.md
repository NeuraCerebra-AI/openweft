# Wave 2 Validation: Planning Pipeline Resilience

## Scope

Validated Wave 1 planning-pipeline claims against the current OpenWeft tree, with focus on:

- raw request -> Work Brief -> feature plan -> `## Ledger` + `## Manifest` contracts;
- manifest repair and `last-known-good` fallback behavior;
- ledger strictness, repair loops, skip semantics, and re-analysis abort semantics;
- prompt surface area and drift pressure across `prompt-a`, inline Stage 2 prompting, plan adjustment, and repo-local work protocol material;
- real-run versus dry-run planning contract parity.

This pass did not edit source code. The only intended write is this report.

## Files Inspected

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `ARCHITECTURE.md`
- `package.json`
- `research-output/openweft-production-ux-review/wave-1-intelligence-summary.md`
- `research-output/openweft-production-ux-review/wave-1/planning-pipeline.md`
- `research-output/openweft-production-ux-review/wave-1/orchestrator-correctness.md`
- `research-output/openweft-production-ux-review/wave-1/adapters-codex-claude-mock.md`
- `research-output/openweft-production-ux-review/wave-1/config-schema-env-handling.md`
- `research-output/openweft-production-ux-review/wave-1/diagnostics-failure-messaging.md`
- `prompts/prompt-a.md`
- `prompts/plan-adjustment.md`
- `prompts/prompt-b.md` - checked and confirmed absent
- `skills/openweft-work-protocol/SKILL.md`
- `skills/openweft-work-protocol/references/canonical-openweft-work-protocol.md`
- `src/adapters/prompts.ts`
- `src/cli/handlers.ts`
- `src/domain/manifest.ts`
- `src/orchestrator/planMarkdown.ts`
- `src/orchestrator/realRun.ts`
- `src/orchestrator/dryRun.ts`
- `tests/domain/manifest.test.ts`
- `tests/orchestrator/planMarkdown.test.ts`
- `tests/orchestrator/realRun.test.ts`
- `tests/e2e/cli-dry-run.test.ts`
- `tests/adapters/prompts.test.ts`
- `tests/adapters/mock.test.ts`
- `tests/cli/handlers.test.ts`

## Commands Run

- `wc -l AGENTS.md CLAUDE.md README.md ARCHITECTURE.md package.json research-output/openweft-production-ux-review/wave-1-intelligence-summary.md research-output/openweft-production-ux-review/wave-1/planning-pipeline.md`
- `rg --files research-output/openweft-production-ux-review src tests prompts feature_requests tests/fixtures | sort`
- `git status --short`
- `sed -n ...` / `nl -ba ...` targeted reads over the files listed above
- `test -f prompts/prompt-b.md && nl -ba prompts/prompt-b.md || printf 'prompts/prompt-b.md: MISSING\n'`
  - Result: `prompts/prompt-b.md: MISSING`
- `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npx vitest run tests/domain/manifest.test.ts tests/orchestrator/planMarkdown.test.ts`
  - Result: 2 files passed, 15 tests passed
- `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npx vitest run tests/orchestrator/realRun.test.ts -t "(records invalid planning repair attempts|fails planning when the agent never returns the required ledger section|fails adjustment when the agent drops the required ledger section|persists pending merge summaries|replays pending merge summaries|batches merged summaries|recomputes future phases after re-analysis changes a remaining manifest)"`
  - Result: 1 file passed, 7 tests passed, 69 skipped
- `PATH=/opt/homebrew/bin:$PATH ./node_modules/.bin/tsx --eval ...`
  - First attempt failed because zsh interpreted Markdown fence backticks.
- Re-run of parser probe with literal quoting:
  - Result: `{"method":"last-known-good","manifest":{"create":["src/old-boundary.ts"],"modify":[],"delete":[]},"normalizedContainsOldBoundary":true}`
  - Result: `lowercase: Ledger section must include the subheadings: Constraints.`
  - Result: `split: Ledger section must include the subheadings: Watchpoints, Validation.`
- `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npx vitest run tests/e2e/cli-dry-run.test.ts`
  - Result: 1 file passed, 1 test passed
- `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npx vitest run tests/adapters/prompts.test.ts tests/adapters/mock.test.ts`
  - Result: 2 files passed, 8 tests passed
- `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npx vitest run tests/cli/handlers.test.ts -t "default prompt templates|prompt|legacy Work Brief|No protocol-only failure"`
  - Result: 1 file passed, 2 tests passed, 32 skipped

## Validation Result Per Claim

### Claim: Two-stage planning is durable and contract-driven.

Result: Confirmed.

Evidence: Docs describe Stage 1 Work Brief persistence and Stage 2 feature plan validation (`README.md:131-150`, `ARCHITECTURE.md:154-163`). Runtime builds Stage 1 with `{{USER_REQUEST}}`, writes the Work Brief artifact, then sends the Work Brief into Stage 2 (`src/orchestrator/realRun.ts:1543-1656`). The final plan and shadow plan are written only after successful repair/validation (`src/orchestrator/realRun.ts:1770-1801`).

Sharpening: There is no standalone `prompts/prompt-b.md`; "Prompt B" is historical naming around the generated Work Brief artifact. Stage 2's hard prompt is inline in `realRun.ts`, while durable Work Brief content is saved under `feature_requests/briefs/*.work-brief.md`.

### Claim: Strict `## Ledger` validation protects inspectability but can become a UX failure point.

Result: Confirmed and sharpened.

Evidence: `assertLedgerSection()` requires a `## Ledger` h2 and exact h3 subheadings `Constraints`, `Assumptions`, `Watchpoints`, and `Validation` in a single richest ledger section (`src/domain/manifest.ts:36`, `src/domain/manifest.ts:87-145`). Tests intentionally reject split-ledger outputs and bullet-only pseudo-ledgers (`tests/domain/manifest.test.ts:155-199`). Probe confirmed lowercase `### constraints` fails.

Sharpening: This is not merely "strictness"; it is a contract mismatch. Prompt/work protocol language says not to fail, skip, or abandon a feature solely because ledger/dossier/protocol formatting is imperfect if the manifest and implementation remain actionable (`prompts/prompt-a.md:301-307`, `src/cli/handlers.ts:746-767`). Runtime still treats missing exact ledger anchors as a hard planning skip after repair exhaustion and as a re-analysis abort for adjustment responses (`src/orchestrator/realRun.ts:1699-1763`, `src/orchestrator/realRun.ts:2301-2334`).

### Claim: `last-known-good` manifest fallback may reuse stale file boundaries.

Result: Confirmed.

Evidence: `parseManifestJson()` returns `method: 'last-known-good'` with normalized prior manifest when all parser attempts fail and a prior manifest exists (`src/domain/manifest.ts:147-188`). `repairPlanMarkdownIfNeeded()` extracts `lastKnownGood` from the shadow plan and then discards the recovery method in its return shape (`src/orchestrator/planMarkdown.ts:38-45`, `src/orchestrator/planMarkdown.ts:52-59`, `src/orchestrator/planMarkdown.ts:112-119`). Re-analysis does the same by passing the current shadow plan as `lastKnownGood`, then persisting the normalized adjusted plan with the recovered manifest (`src/orchestrator/realRun.ts:2300-2318`).

Probe evidence: An adjusted plan with a valid ledger but manifest body `]` was accepted with `method: "last-known-good"` and normalized back to `src/old-boundary.ts`.

Boundary condition: The fallback does not hide all manifest problems. If JSON parses to an object but fails Zod/path validation, the code throws instead of falling back (`src/domain/manifest.ts:168-177`; covered by `tests/domain/manifest.test.ts:80-88`). The stale-boundary risk is specifically malformed/non-object current manifest text when a shadow manifest exists.

### Claim: Stage 2 repair loop skip semantics can drop useful work.

Result: Confirmed, with a narrow correction.

Evidence: Stage 2 repair is fixed at two repair turns after the initial invalid plan (`src/orchestrator/planMarkdown.ts:47`, `src/orchestrator/planMarkdown.ts:72-140`). Recoverable planning failures are converted into `status: 'skipped'`, `planFile: null`, `manifest: null`, `rerunEligible: false`, and the queue line is marked processed (`src/orchestrator/realRun.ts:1699-1763`). Tests expect malformed Stage 2 planning to keep the rest of the queue moving and to leave the bad feature skipped (`tests/orchestrator/realRun.test.ts:1855-1923`, `tests/orchestrator/realRun.test.ts:1925-2039`, `tests/orchestrator/realRun.test.ts:2541-2562`).

Sharpening: "Drop useful work" does not mean artifacts vanish. Invalid attempts are preserved in the shadow plan and audit entries (`tests/orchestrator/realRun.test.ts:2008-2038`). The UX problem is that the queue item becomes processed/skipped and non-rerunnable, so the default operator path is not "retry this request" even when the model response contained enough useful plan content to repair manually.

### Claim: Re-analysis parse failure has a large blast radius.

Result: Confirmed, but bounded.

Evidence: Re-analysis only runs for remaining features whose manifests overlap merged paths (`src/orchestrator/realRun.ts:2181-2214`). Adapter failure or approval cancellation is handled as an `adjustment-failed` per-feature decision and continues in some branches (`src/orchestrator/realRun.ts:2226-2282`). But a successful adjustment turn whose returned markdown fails `assertLedgerSection()` or manifest parse throws from inside the parse block (`src/orchestrator/realRun.ts:2298-2334`), causing `runRealOrchestration()` to mark the run failed in the catch path (`src/orchestrator/realRun.ts:3769-3787`). Tests expect missing adjustment ledger to reject the whole orchestration call (`tests/orchestrator/realRun.test.ts:2564-2639`).

Sharpening: The blast radius is not loss of merged work. Successful merge summaries are stored in `pendingMergeSummaries` as features merge (`src/orchestrator/realRun.ts:3424-3432`, `src/orchestrator/realRun.ts:3493-3501`), and tests confirm they persist and replay after an adjustment abort (`tests/orchestrator/realRun.test.ts:2641-2829`). The real blast radius is user-facing run failure and potential repeated abort loops on the same malformed adjustment output.

### Claim: Prompts create clutter/drift pressure.

Result: Partially confirmed as a design risk; not proven by production-output telemetry.

Evidence: `prompt-a.md` is a 343-line meta-prompt requiring a full Work Brief, five roles/passes, full Living Plan Ledger requirements, debugging protocol, downstream impact review, risk-scaled guardrails, workspace ownership rules, and Stage 2 output contract (`prompts/prompt-a.md:19-41`, `prompts/prompt-a.md:59-83`, `prompts/prompt-a.md:85-150`, `prompts/prompt-a.md:200-245`, `prompts/prompt-a.md:247-294`, `prompts/prompt-a.md:296-337`). It also points to a repo-local 302-line skill and 379-line canonical reference. Stage 2 then repeats the hard manifest/ledger instruction before and after the Work Brief (`src/orchestrator/realRun.ts:1631-1650`). Plan adjustment has a separate but related contract (`prompts/plan-adjustment.md:1-31`, `src/orchestrator/realRun.ts:755-779`).

Sharpening: The current prompt set is not random clutter. Much of it is intentional risk control and tests assert the default template includes the scaled guardrails (`tests/cli/handlers.test.ts:280-315`). The risk is contract drift across surfaces: prompt language differentiates "protocol completeness" from hard parser gates, while runtime mostly has a binary parser outcome.

### Claim: Dry-run validates the same planning resilience as real runs.

Result: Disconfirmed for repair semantics.

Evidence: `dryRun.ts` runs Stage 1 and Stage 2, writes the Work Brief, then immediately `assertLedgerSection()` and `parseManifestDocument()` on Stage 2 output (`src/orchestrator/dryRun.ts:174-217`). It does not call `repairPlanMarkdownIfNeeded()` and does not use shadow-plan `last-known-good` fallback. The existing e2e dry-run test covers the happy path only (`tests/e2e/cli-dry-run.test.ts:47-107`).

User-facing interpretation: `openweft start --dry-run` is useful for happy-path scaffolding and mock execution, but it is not currently a resilience preflight for malformed real-provider planning output.

## Findings

### Finding 1

- Severity: High
- Area: Manifest fallback / scheduling boundaries
- Evidence: `parseManifestJson()` can return `last-known-good` after parse failure (`src/domain/manifest.ts:181-185`); repair and re-analysis pass shadow-plan manifests into this path (`src/orchestrator/planMarkdown.ts:38-45`, `src/orchestrator/realRun.ts:2300-2308`); normalized output can rewrite the stale boundary into the current plan (`src/orchestrator/realRun.ts:2309-2318`). Probe confirmed malformed current manifest reused `src/old-boundary.ts`.
- User impact: A plan whose current manifest is malformed can continue with previous file boundaries. That weakens the core "manifest overlap prevents unsafe parallelism" promise because the scheduler may reason from stale declared intent.
- Recommended fix: Treat `last-known-good` as a recovery signal, not final scheduling truth. Preserve `recoveryMethod` through `repairPlanMarkdownIfNeeded()` and re-analysis, audit it, and mark plans accepted via fallback as `manifestConfidence: stale` or `needs-review`. For execution scheduling, require a current parseable manifest after repair unless an explicit operator policy says to continue with stale boundaries.
- Confidence: High.
- What would disconfirm: Telemetry or large-sample replay showing every `last-known-good` fallback occurs only when the current plan text is otherwise unchanged and the stale manifest matches actual intended boundaries.

### Finding 2

- Severity: High
- Area: Ledger strictness / protocol contract mismatch
- Evidence: Parser demands exact case-sensitive h3 headings in one `## Ledger` section (`src/domain/manifest.ts:87-145`). Prompt/work protocol says protocol-format imperfections should not cause abandonment if manifest, task, implementation path, and validation are actionable (`prompts/prompt-a.md:301-307`, `src/cli/handlers.ts:746-767`). Tests intentionally prove exact-heading failures skip planning or abort adjustment (`tests/domain/manifest.test.ts:155-199`, `tests/orchestrator/realRun.test.ts:2541-2639`).
- User impact: Users see a model/content-format failure where OpenWeft could potentially repair the inspectability record. The product says "repair or summarize and continue," but runtime often says "skip or abort."
- Recommended fix: Split validation into two layers: (1) hard machine contract: current parseable manifest, safe paths, plan file exists; (2) ledger quality contract: exact anchors can be synthesized or normalized when enough semantic content exists. Normalize heading case and common forms, merge repeated `## Ledger` sections before checking anchors, and only hard-fail when the ledger cannot be reconstructed safely.
- Confidence: High.
- What would disconfirm: A product decision that exact parser-compatible ledger anchors are intentionally a non-negotiable hard gate even when all other plan content is actionable, plus docs/prompt changes that remove the "no protocol-only failure" instruction.

### Finding 3

- Severity: Medium-high
- Area: Stage 2 repair exhaustion / skipped queue semantics
- Evidence: Planning gets initial output plus two repair attempts (`src/orchestrator/planMarkdown.ts:47-140`). On recoverable planning errors, the feature is marked `skipped`, non-rerunnable, and the queue line is rewritten as processed (`src/orchestrator/realRun.ts:1699-1763`). Tests verify the rest of the queue proceeds and skipped feature remains skipped (`tests/orchestrator/realRun.test.ts:1855-1923`, `tests/orchestrator/realRun.test.ts:1925-2039`).
- User impact: A single malformed planning response can remove a user request from the active pipeline. The artifacts are preserved, but the default run has effectively consumed the queue item without landing work.
- Recommended fix: Replace terminal `skipped` for repair exhaustion with a distinct status such as `planning-needs-review` or `blocked-planning-contract`. Keep the original queue item retryable or create a first-class `openweft retry <featureId>` path. Surface the rejected shadow plan and exact next action in status.
- Confidence: High.
- What would disconfirm: User research or telemetry showing skipped planning features are always immediately understood and re-queued by operators without confusion or lost intent.

### Finding 4

- Severity: Medium-high
- Area: Re-analysis parse failure / run abort asymmetry
- Evidence: Adapter-level adjustment failures are logged and the loop can continue (`src/orchestrator/realRun.ts:2226-2282`), but content parse failures after `adjustment.ok` throw and fail the run (`src/orchestrator/realRun.ts:2298-2334`, `src/orchestrator/realRun.ts:3769-3787`). Tests cover missing adjustment ledger as a rejected orchestration call (`tests/orchestrator/realRun.test.ts:2564-2639`).
- User impact: One bad adjusted plan response can stop the whole run after earlier merges. The checkpoint can replay deferred re-analysis, but if the provider repeats the same malformed shape the user can hit the same abort again.
- Recommended fix: Make adjustment content-parse failures per-feature durable decisions instead of thrown whole-run errors. Keep the existing plan and manifest, set the feature to `planning-needs-review` or `adjustment-needs-review`, preserve pending merge summaries, and continue features whose manifests are provably non-overlapping with the merged paths.
- Confidence: High for current behavior; medium on best product policy because stricter stop-on-uncertain-overlap is defensible.
- What would disconfirm: A deliberate safety policy that any overlapping-feature adjustment parse failure must stop all later work, plus status UX that clearly explains that safety stop.

### Finding 5

- Severity: Medium
- Area: Prompt contract drift / hard-contract duplication
- Evidence: The hard `## Ledger`/`## Manifest` contract appears in `prompt-a.md`, inline Stage 2 runtime prompt, `plan-adjustment.md`, default templates in `src/cli/handlers.ts`, and the repo-local work protocol (`prompts/prompt-a.md:324-337`, `src/orchestrator/realRun.ts:1631-1650`, `prompts/plan-adjustment.md:24-31`, `src/cli/handlers.ts:418-431`, `skills/openweft-work-protocol/SKILL.md:99-120`). Current tests assert many of these strings but do not create one canonical contract object.
- User impact: Small wording drift can change what models emit, while the parser remains stricter than some prompt language implies. Operators may see brittle planning without a single place to understand the true contract.
- Recommended fix: Centralize the parser-facing contract into one minimal block generated from code constants: exact accepted heading names, accepted manifest fence languages, accepted schema, and what happens on repair exhaustion. Let the long Work Brief/protocol text remain guidance, but keep the machine contract short and identical across Stage 2, repair, adjustment, docs, and tests.
- Confidence: Medium-high.
- What would disconfirm: A central contract generator already exists elsewhere and all prompt files are mechanically derived from it; I found direct duplicated text instead.

### Finding 6

- Severity: Medium
- Area: Dry-run parity / resilience validation gap
- Evidence: Dry-run directly asserts ledger and parses manifest after Stage 2 (`src/orchestrator/dryRun.ts:215-217`), while real-run invokes the repair loop (`src/orchestrator/realRun.ts:1662-1698`). The dry-run e2e test only covers valid mock output (`tests/e2e/cli-dry-run.test.ts:47-107`).
- User impact: A green dry-run does not prove planning resilience, repair UX, stale-manifest safeguards, or real-provider contract drift. It can still be a useful demo/preflight, but not a production planning-resilience signal.
- Recommended fix: Add targeted dry-run negative tests or a mock mode that can emit malformed Stage 2 and adjustment outputs. Either align dry-run with real repair behavior or document dry-run as happy-path simulation only.
- Confidence: High.
- What would disconfirm: A separate release gate or documented validation mode that already exercises malformed planning outputs through the real repair path.

## Recommended UX/Backend Contract Adjustments

1. Define a three-tier planning contract:
   - Hard gate: Work Brief exists, feature plan exists, current manifest parses safely, paths are repository-relative, source-write planning restrictions are not copied into execution scope.
   - Repairable gate: ledger anchor casing, split ledger sections, missing protocol details, incomplete dossier sections.
   - Review-required gate: malformed current manifest with only stale fallback available, conflicting current manifest intent, missing plan file, missing Work Brief for actionable feature.

2. Preserve manifest provenance:
   - Carry `recoveryMethod` from `parseManifestDocument()` into repair/re-analysis return values, checkpoint metadata, and audit events.
   - Never silently schedule with `last-known-good`. Require either current parse success or explicit review/override.

3. Replace final `skipped` for planning repair exhaustion:
   - Use `planning-needs-review` or equivalent.
   - Keep the request retryable.
   - Show: rejected shadow plan path, last validation error, and the command/action to retry.

4. Make re-analysis parse failures resumable and localized:
   - Preserve current plan as authoritative until a valid adjusted plan is returned.
   - Stop only the affected overlapping feature group, not unrelated non-overlapping future work.
   - Persist partial successful re-analysis updates after each feature to avoid memory-only progress loss.

5. Canonicalize the hard prompt contract:
   - Generate or import one text block for Stage 2, repair, adjustment, docs, and tests.
   - Include exact accepted forms: `## Ledger`, `### Constraints`, `### Assumptions`, `### Watchpoints`, `### Validation`, `## Manifest`, fenced `json` or `json manifest`, and schema `{ "create": [], "modify": [], "delete": [] }`.
   - Keep long Work Brief diligence guidance out of the minimal parser contract.

6. Add targeted regression coverage:
   - Re-analysis malformed manifest with shadow manifest should not silently reuse stale boundaries without an audit/review marker.
   - Ledger normalization should accept case/spacing variants if product chooses tolerant mode.
   - Dry-run should either exercise repair behavior or explicitly fail with a documented "dry-run does not repair planning output" message.

## Domino Risks

- If `last-known-good` fallback stays silent, a stale manifest can let two features run in a phase that would have been separated if the current manifest had parsed. That undermines OpenWeft's core safety story.
- If fallback is removed without a better UX state, malformed manifests will hard-fail more often and users may experience lower throughput, even though safety improves.
- If ledger validation is loosened too broadly, plans may become less inspectable and re-analysis can lose the canonical execution record that makes recovery trustworthy.
- If ledger validation remains exact but prompts keep saying protocol formatting should not stop work, users and agents receive contradictory contracts. That drives repeated repair loops and hard-to-explain skips.
- If re-analysis parse failures keep aborting the whole run, one bad adjustment response can create a retry loop after a successful merge phase. Pending merge replay helps, but the user still sees an unstable post-merge pipeline.
- If dry-run remains happy-path only, it can accidentally become a false confidence signal for production planning resilience.

###COMPLETE###
