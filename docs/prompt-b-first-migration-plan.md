# Prompt-B-First Migration Plan

## Purpose

This document is the concrete migration plan from OpenWeft's current runtime shape to the target architecture described in [ARCHITECTURE.md](../ARCHITECTURE.md).

The target architecture is:

- Prompt A compiles a request into Prompt B
- Prompt B is the real worker brief
- Prompt B runs inside an OpenWeft-controlled worktree and does the actual work
- OpenWeft compares actual outcomes, determines compatibility, merges safe results, and requeues or reruns the rest

This plan is deliberately structured as a sequence of small, reversible tranches.

The point is not to preserve every existing abstraction.
The point is to migrate the runtime toward the simpler, more honest architecture without losing safety, recoverability, or debugging visibility.

---

## 1. Current State

Today, OpenWeft is in a transitional state:

- Prompt A already exists as a meta prompt that generates Prompt B.
- Prompt B is behaviorally powerful, but architecturally under-modeled.
- The runtime still preserves a plan-first flow in important places.
- The system still thinks in terms of planning stages more than execution artifacts.
- Worktree ownership is correctly centralized in OpenWeft, which is a boundary we must keep.

The current shape is therefore:

- closer to the right architecture than a pure plan-first system
- but not yet honest about where the power actually lives

---

## 2. Target End State

The target end state is:

1. Prompt A runs.
2. Prompt A outputs Prompt B as a first-class Markdown artifact.
3. OpenWeft persists Prompt B as a durable artifact for that feature.
4. OpenWeft creates and owns the isolated worktree.
5. OpenWeft launches the worker using Prompt B.
6. Prompt B performs investigation, ledger maintenance, editing, and validation inside that assigned worktree.
7. OpenWeft inspects the actual result:
   - diff
   - touched files
   - result summary
   - ledger
   - validation outcome
8. OpenWeft determines compatibility using real outcomes.
9. OpenWeft merges safe results and reroutes incompatible or stale work.

At the end of the migration, OpenWeft should feel like:

- a scheduler
- a workspace allocator
- a worker launcher
- a diff comparator
- a merge referee

It should no longer feel like:

- a giant internal planning bureaucracy that secretly depends on Prompt B anyway

---

## 3. Migration Principles

These principles apply to every tranche.

### 3.1 Preserve worktree ownership

OpenWeft must continue to own:

- worktree creation
- workspace cleanup
- merge sequencing
- conflict routing

Prompt B must never own repository topology.

### 3.2 Promote Prompt B rather than flatten it

Do not simplify Prompt B out of the system.

If a migration step makes Prompt B weaker, less inspectable, or less central, that step is suspect.

### 3.3 Prefer actual results over declared intent

As the migration advances, compatibility logic should lean more on:

- real diffs
- real touched files
- real validation outcomes

and less on:

- purely speculative pre-execution declarations

### 3.4 Keep changes reversible

Each tranche should leave a clean rollback path.

### 3.5 Keep checkpoint safety intact

Crash recovery and resume are still core features.

We are changing the architecture, not giving up durability.

---

## 4. Artifact Model To Introduce

The migration should make the system explicitly artifact-driven.

### 4.1 Required Artifacts

Each feature should eventually have:

- the raw feature request
- the generated Prompt B artifact
- the worker ledger
- the worker's final execution report
- the actual git diff or touched-file summary derived by OpenWeft

### 4.2 Proposed Prompt B Persistence Location

Persist Prompt B under a durable repo-local path, for example:

- `feature_requests/briefs/001.some-feature.prompt-b.md`

This keeps Prompt B:

- inspectable
- debuggable
- tied to the feature ID
- easy to compare across reruns

The exact path can be adjusted during implementation, but the requirement is that Prompt B becomes a first-class persisted artifact.

---

## 5. Migration Tranches

## Tranche 1: Make Prompt B Explicit and Durable

### Goal

Persist Prompt B as a first-class artifact without changing the overall runtime control flow yet.

### Why this comes first

Right now the system depends on Prompt B but still treats it too much like transient glue text.
The first migration step is to stop hiding the most important artifact.

### Changes

- Persist Stage 1 output as a Prompt B Markdown artifact.
- Add a path for Prompt B artifacts to runtime paths.
- Record the Prompt B artifact path in checkpoint state.
- Surface Prompt B artifact paths in debugging and audit flows where helpful.
- Keep existing worktree ownership unchanged.

### Likely touchpoints

- `src/orchestrator/realRun.ts`
- `src/orchestrator/dryRun.ts`
- `src/fs/paths.ts`
- `src/state/checkpoint.ts`
- `tests/orchestrator/realRun.test.ts`
- `tests/e2e/cli-dry-run.test.ts`
- `tests/e2e/cli-real-mock.test.ts`

### Success criteria

- Every planned feature has a persisted Prompt B artifact.
- Resume/recovery does not lose Prompt B.
- Prompt B is inspectable after the run.

### Rollback

- Stop writing Prompt B artifacts and ignore the stored path fields.

---

## Tranche 2: Reframe the Runtime Around Prompt B Artifacts

### Goal

Make the runtime openly treat Prompt B as the worker brief instead of a disposable stage handoff.

### Changes

- Refactor planning/execution naming and comments so the system speaks in terms of:
  - Prompt A compilation
  - Prompt B artifact
  - worker execution
- Keep existing stage labels if needed for compatibility, but change the internal mental model and documentation.
- Ensure UI and audit output stop underselling Prompt B.

### Likely touchpoints

- `src/orchestrator/realRun.ts`
- `src/ui/hooks/useOrchestratorBridge.ts`
- `src/domain/costs.ts`
- `src/ui/events.ts`
- `README.md`
- `ARCHITECTURE.md`

### Success criteria

- Code comments, docs, and runtime language agree that Prompt B is first-class.
- The repo no longer narrates Prompt B as disposable glue.

### Rollback

- Revert naming and documentation changes without affecting saved artifacts.

---

## Tranche 3: Execute Prompt B Directly in OpenWeft-Controlled Worktrees

### Goal

Shift the center of gravity from "generate plan first, then execute later" to "launch Prompt-B workers in isolated worktrees."

### Changes

- OpenWeft creates the worktree before worker execution.
- Prompt B becomes the primary worker input for the execution session.
- The worker performs:
  - repo investigation
  - ledger creation and maintenance
  - code edits
  - validation
  - final reporting
- OpenWeft continues to own:
  - workspace creation
  - branch lineage
  - merge control

### Important boundary

Prompt B must still explicitly forbid:

- extra git worktrees
- extra clones
- sibling checkouts
- ad hoc branch switching unless orchestrator-directed

### Likely touchpoints

- `src/orchestrator/realRun.ts`
- `src/adapters/prompts.ts`
- `src/adapters/mock.ts`
- `src/orchestrator/dryRun.ts`
- `prompts/prompt-a.md`
- `tests/orchestrator/realRun.test.ts`
- `tests/e2e/cli-real-mock.test.ts`

### Success criteria

- A Prompt-B worker can do the actual feature work inside its assigned worktree.
- OpenWeft no longer depends on a heavy internal plan artifact as the central execution primitive.

### Rollback

- Keep persisted Prompt B artifacts but restore plan-first execution.

---

## Tranche 4: Introduce Result-First Compatibility and Merge Decisions

### Goal

Make OpenWeft compare **actual outcomes** rather than relying primarily on pre-execution manifest declarations.

### Changes

- Derive changed-file sets from the real git diff after worker completion.
- Treat worker-reported manifests as supporting signals, not stronger than the repo diff.
- Use actual touched files and real mergeability as the main compatibility basis.
- Preserve the ability to prioritize and serialize risky or overlapping work.

### Likely touchpoints

- `src/domain/phases.ts`
- `src/orchestrator/realRun.ts`
- `src/git/worktrees.ts`
- `src/domain/manifest.ts`
- `tests/domain/phases.test.ts`
- `tests/orchestrator/realRun.test.ts`

### Success criteria

- Compatibility decisions are grounded in real outcomes.
- OpenWeft can safely merge completed workers based on actual touched files.

### Rollback

- Fall back to manifest-first gating while retaining the new artifact model.

---

## Tranche 5: Replace Legacy Plan-Centric Assumptions

### Goal

Remove the remaining parts of the runtime that still assume the plan document is the primary unit of execution.

### Changes

- Reduce or eliminate plan-first bottlenecks that no longer fit the Prompt-B-first model.
- Re-evaluate whether `planAdjustment` should evolve into a worker-brief adjustment or surviving-work recontextualization step.
- Update docs, mocks, tests, and UI surfaces so they stop talking like the old runtime.

### Likely touchpoints

- `src/orchestrator/realRun.ts`
- `src/orchestrator/dryRun.ts`
- `src/cli/handlers.ts`
- `prompts/plan-adjustment.md`
- `README.md`
- `tests/*`

### Success criteria

- The runtime no longer centers the old plan-first worldview.
- The codebase, docs, and tests all describe the same architecture.

### Rollback

- Re-enable the legacy seams while preserving Prompt B artifacts and worktree ownership boundaries.

---

## 6. Cross-Cutting Work

These concerns span multiple tranches.

### 6.1 Checkpoint Evolution

Checkpoint state should gradually learn about:

- Prompt B artifact paths
- worker result status
- ledger locations if useful

But it should not try to absorb the worker ledger itself into checkpoint JSON.

The checkpoint should remain the orchestration memory, not the worker's internal notebook.

### 6.2 Dry-Run and Mock Alignment

Dry-run and mock behavior must evolve with the real runtime.

If the real runtime becomes Prompt-B-first and the mock path remains plan-first, the test harness will become dishonest.

Every major runtime shift must include:

- dry-run updates
- mock adapter updates
- e2e alignment

### 6.3 UI and Status Surfaces

As Prompt B becomes first-class, status output should eventually surface:

- that Prompt B exists
- where its artifact lives
- whether a worker finished successfully
- whether the result is mergeable or blocked

The UI should tell the truth about the architecture, not hide it.

---

## 7. Validation Strategy

Each tranche should be validated at three levels.

### 7.1 Unit-Level

Validate any new pure logic for:

- artifact path generation
- diff-derived touched-file extraction
- compatibility calculations

### 7.2 Orchestrator Integration

Validate:

- Prompt B persistence
- checkpoint safety
- restart safety
- worker launch behavior
- merge and requeue behavior

### 7.3 End-to-End

Validate:

- init scaffolding
- dry-run parity
- mock-backed real flow
- final artifact layout
- compatibility decisions after multiple workers complete

---

## 8. Risks and Mitigations

### Risk 1: Duplicate speculative work increases

If compatibility is determined later using actual outcomes, two workers may sometimes overlap.

Mitigation:

- keep concurrency controls
- keep priority ordering
- rerun or recontextualize stale workers after merges

### Risk 2: Prompt B artifact growth becomes noisy

Persisting Prompt B makes the system more honest, but also noisier.

Mitigation:

- keep Prompt B artifacts in a dedicated location
- tie them to feature IDs
- make them easy to inspect and easy to ignore

### Risk 3: Legacy plan-first code fights the new model

Mitigation:

- migrate in tranches
- keep rollback points
- update tests alongside each tranche

### Risk 4: Worker autonomy starts leaking into topology

Mitigation:

- keep the workspace boundary explicit in Prompt A
- verify it in starter prompts and tests
- never hand topology ownership to Prompt B

---

## 9. Immediate Next Tranche Recommendation

The best next implementation tranche is **Tranche 1: Make Prompt B Explicit and Durable**.

Why:

- it makes the hidden engine visible
- it does not require rewriting the whole runtime in one jump
- it creates inspectability and debuggability immediately
- it gives the next tranches a stable artifact to build around

In plain terms:

- first, save Prompt B
- then, build the rest of the system around that truth

---

## 10. Canonical Migration Summary

The migration path is:

1. persist Prompt B
2. make the runtime honest about Prompt B
3. execute Prompt-B workers directly in OpenWeft-owned worktrees
4. compare actual outcomes instead of over-trusting predeclared plans
5. remove the remaining legacy plan-first assumptions

That is the concrete path from today's runtime to the Prompt-B-first architecture.
