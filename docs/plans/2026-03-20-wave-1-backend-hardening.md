# Wave 1 Backend Hardening Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the highest-risk backend durability gaps without changing UI behavior, weakening Prompt B, or introducing large architectural churn.

**Architecture:** This wave is a correctness-first backend hardening tranche. We keep the current Prompt-B-first orchestration model, but tighten three truth boundaries: queue vs checkpoint durability, Prompt B artifact recoverability, and ledger contract enforcement. The work should remain surgical and reversible, with no broad refactor of `realRun.ts` or scheduler behavior.

**Tech Stack:** TypeScript, Node.js, Zod, Vitest, simple-git, existing OpenWeft orchestrator/checkpoint/runtime paths

---

## Scope and Guardrails

**In scope**
- queue/checkpoint durability during planning
- Prompt B persistence/recovery durability
- minimum backend ledger enforcement for plan generation and adjustment

**Out of scope**
- UI/status changes
- dry-run/mock redesign
- `realRun.ts` decomposition
- scheduler/phasing changes
- new persistent schemas unless unavoidable
- semantic AI-based re-analysis

**Non-negotiable guardrails**
- Keep Prompt B powerful
- Keep worktree ownership with OpenWeft
- Prefer git/checkpoint truth over inferred narrative truth
- Prefer fail-closed recovery over clever silent repair
- Keep file-touch budget tight

## File Map

### Primary implementation files
- Modify: `src/orchestrator/realRun.ts`
- Modify: `src/state/checkpoint.ts`
- Modify: `src/domain/manifest.ts`
- Modify: `src/domain/queue.ts`

### Secondary implementation files
- Modify: `src/fs/paths.ts` only if Prompt B artifact discovery needs a helper path utility beyond what already exists

### Test files
- Modify: `tests/orchestrator/realRun.test.ts`
- Modify: `tests/state/checkpoint.test.ts`
- Modify: `tests/domain/manifest.test.ts`
- Modify: `tests/domain/queue.test.ts`
- Modify: `tests/e2e/cli-real-mock.test.ts`
- Modify: `tests/e2e/cli-dry-run.test.ts` only if ledger enforcement affects the dry-run contract

### Files to avoid touching unless a failing test proves it is necessary
- `src/orchestrator/dryRun.ts`
- `src/adapters/mock.ts`
- UI files under `src/ui/`
- release/CI files

---

## Chunk 1: Queue and Checkpoint Durability

### Task 1: Lock down the failing durability behavior in tests

**Files:**
- Modify: `tests/orchestrator/realRun.test.ts`
- Modify: `tests/domain/queue.test.ts`
- Modify: `tests/state/checkpoint.test.ts`

- [ ] **Step 1: Add a planning-durability regression test**

Create a focused orchestrator test that simulates:
- a pending queue item
- successful stage 1 and stage 2 planning
- queue rewrite occurring before durable checkpoint save
- interrupted run before the final snapshot

Expected behavior after the fix:
- restart must not permanently lose the request
- either the feature exists durably in checkpoint, or the queue still retains the request

- [ ] **Step 2: Add a queue/checkpoint consistency test**

Add a test around queue processing helpers or planning state that asserts:
- processed queue state and planned feature state cannot diverge silently
- the backend never ends a planning iteration with “queue consumed, feature absent”

- [ ] **Step 3: Run the new targeted tests and confirm they fail**

Run:

```bash
npx vitest run tests/orchestrator/realRun.test.ts tests/domain/queue.test.ts tests/state/checkpoint.test.ts
```

Expected:
- at least one new durability test fails on current code

### Task 2: Make planning updates durable in one safe direction

**Files:**
- Modify: `src/orchestrator/realRun.ts`
- Modify: `src/domain/queue.ts` only if helper support is needed
- Modify: `src/state/checkpoint.ts` only if save semantics need a narrow helper

- [ ] **Step 4: Identify the minimal atomicity boundary**

Before editing, confirm the smallest safe invariant:
- after each successfully planned feature, either:
  - the queue still shows it as pending, or
  - checkpoint durably records the planned feature and associated plan paths

Document this invariant in a short code comment only if the final code would otherwise be hard to follow.

- [ ] **Step 5: Implement the smallest durable sequencing change**

Adjust planning flow so queue consumption and feature checkpoint creation cannot drift.

Prefer one of these minimal shapes:
- save checkpoint snapshot before rewriting the queue file for that item
- or write both from the same updated in-memory state with failure handling that preserves recoverability

Do **not** introduce:
- a new transaction system
- temp journal files unless absolutely necessary
- broad queue format changes

- [ ] **Step 6: Re-run the targeted durability tests**

Run:

```bash
npx vitest run tests/orchestrator/realRun.test.ts tests/domain/queue.test.ts tests/state/checkpoint.test.ts
```

Expected:
- the new durability coverage passes

- [ ] **Step 7: Commit the queue/checkpoint durability slice**

```bash
git add src/orchestrator/realRun.ts src/domain/queue.ts src/state/checkpoint.ts tests/orchestrator/realRun.test.ts tests/domain/queue.test.ts tests/state/checkpoint.test.ts
git commit -m "fix: harden planning durability"
```

---

## Chunk 2: Prompt B Artifact Recovery Durability

### Task 3: Prove the Prompt B crash window first

**Files:**
- Modify: `tests/orchestrator/realRun.test.ts`
- Modify: `tests/state/checkpoint.test.ts` if helpful

- [ ] **Step 8: Add a Prompt B orphan recovery test**

Create a test for this flow:
- stage 1 generates Prompt B
- Prompt B file is durably written to the canonical artifact location
- checkpoint misses or loses `promptBFile`
- startup/restart should reconcile the artifact back to the feature when identity is provable

Expected after the fix:
- restart does not fail just because checkpoint missed `promptBFile`
- the canonical Prompt B artifact can be rediscovered and reattached

- [ ] **Step 9: Add a safety test for ambiguous Prompt B artifacts**

Create a test that proves:
- if Prompt B identity is not safely provable, OpenWeft fails clearly instead of guessing wrong

- [ ] **Step 10: Run the targeted Prompt B tests and confirm failure**

Run:

```bash
npx vitest run tests/orchestrator/realRun.test.ts tests/state/checkpoint.test.ts
```

Expected:
- new Prompt B recovery tests fail before implementation

### Task 4: Make Prompt B recovery deterministic and boring

**Files:**
- Modify: `src/orchestrator/realRun.ts`
- Modify: `src/state/checkpoint.ts` only if a narrow helper improves startup reconciliation
- Modify: `src/fs/paths.ts` only if canonical artifact lookup needs a shared helper

- [ ] **Step 11: Reuse the canonical Prompt B location as recovery truth**

Startup should be able to answer:
- does the canonical Prompt B artifact exist for this feature?
- is it the only safe candidate?
- can it be reattached to checkpoint deterministically?

Prefer recovery from:
- deterministic path
- feature id
- request-derived artifact naming already used by runtime

Avoid:
- artifact scanning heuristics across unrelated directories
- maintaining a second registry

- [ ] **Step 12: Implement fail-closed Prompt B reconciliation**

On startup for actionable features:
- if `promptBFile` is valid and exists, keep it
- if it is missing but the canonical artifact exists, repair it
- if it is stale but canonical exists, canonicalize it
- if identity is ambiguous or missing, fail clearly rather than guessing

- [ ] **Step 13: Persist repaired Prompt B pointers before normal execution resumes**

If startup repaired or canonicalized `promptBFile`, durably save that repaired checkpoint state before execution continues.

The invariant is:
- Prompt B recovery should not live only in memory
- a second crash immediately after startup should not lose the repair

- [ ] **Step 14: Re-run the Prompt B recovery tests**

Run:

```bash
npx vitest run tests/orchestrator/realRun.test.ts tests/state/checkpoint.test.ts
```

Expected:
- Prompt B durability tests pass

- [ ] **Step 15: Commit the Prompt B durability slice**

```bash
git add src/orchestrator/realRun.ts src/state/checkpoint.ts src/fs/paths.ts tests/orchestrator/realRun.test.ts tests/state/checkpoint.test.ts
git commit -m "fix: recover canonical prompt-b artifacts"
```

---

## Chunk 3: Ledger Contract Enforcement

### Task 5: Define the minimum ledger contract in tests

**Files:**
- Modify: `tests/domain/manifest.test.ts`
- Modify: `tests/orchestrator/realRun.test.ts`
- Modify: `tests/e2e/cli-real-mock.test.ts` only if runtime-level coverage is needed after unit/seam tests

- [ ] **Step 16: Write failing tests for missing ledger**

Add focused tests that prove:
- a plan missing `## Ledger` is rejected
- an adjusted plan missing `## Ledger` is rejected
- a ledger heading with no meaningful content does not count if we decide minimum section content is required

Keep the minimum contract small. Recommended minimum:
- `## Ledger`
- contains the four expected subheadings or non-empty equivalents:
  - Constraints
  - Assumptions
  - Watchpoints
  - Validation

- [ ] **Step 17: Write a passing/repair preservation test**

Add one test that proves:
- when plan adjustment preserves the ledger correctly, the backend accepts it

- [ ] **Step 18: Run the ledger-focused tests and confirm failure**

Run:

```bash
npx vitest run tests/domain/manifest.test.ts tests/orchestrator/realRun.test.ts tests/e2e/cli-real-mock.test.ts
```

Expected:
- new ledger enforcement tests fail before implementation

### Task 6: Enforce only the minimum ledger contract

**Files:**
- Modify: `src/domain/manifest.ts`
- Modify: `src/orchestrator/realRun.ts`

- [ ] **Step 19: Add a tiny ledger parser/validator**

Implement the smallest helper needed to answer:
- does this markdown contain a valid minimum ledger section?

Keep it in the same document-contract layer as manifest parsing if possible.

Do **not**:
- create a big new “plan document domain” subsystem
- persist the full ledger into checkpoint JSON
- invent semantic scoring for ledger quality

- [ ] **Step 20: Enforce ledger presence in planning and adjustment**

Use the helper so that:
- initial planning cannot succeed without a valid ledger
- plan adjustment cannot silently drop or degrade the ledger

Keep error messages explicit and reviewable.

- [ ] **Step 21: Re-run ledger-focused tests**

Run:

```bash
npx vitest run tests/domain/manifest.test.ts tests/orchestrator/realRun.test.ts tests/e2e/cli-real-mock.test.ts
```

Expected:
- ledger enforcement coverage passes

- [ ] **Step 22: Commit the ledger enforcement slice**

```bash
git add src/domain/manifest.ts src/orchestrator/realRun.ts tests/domain/manifest.test.ts tests/orchestrator/realRun.test.ts tests/e2e/cli-real-mock.test.ts
git commit -m "fix: enforce planner ledger contract"
```

---

## Chunk 4: Full Wave 1 Verification

### Task 7: Run full regression and release-confidence checks

**Files:**
- No new code files unless a failing test exposes a necessary small patch

- [ ] **Step 23: Run the high-signal targeted suite**

```bash
npx vitest run tests/orchestrator/realRun.test.ts tests/state/checkpoint.test.ts tests/domain/manifest.test.ts tests/domain/queue.test.ts tests/e2e/cli-real-mock.test.ts tests/e2e/cli-dry-run.test.ts
```

Expected:
- all targeted backend-hardening coverage passes

- [ ] **Step 24: Run typecheck**

```bash
npm run typecheck
```

Expected:
- PASS with no TypeScript errors

- [ ] **Step 25: Run the full test suite**

```bash
npm test
```

Expected:
- PASS

- [ ] **Step 26: Review blast radius before declaring success**

Confirm all of these remain true:
- no UI/status behavior changed
- Prompt B is still first-class and powerful
- worktree ownership still belongs to OpenWeft
- no new broad schema was introduced
- no big refactor was smuggled in under the “hardening” label

- [ ] **Step 27: Commit final Wave 1 integration**

```bash
git add src/orchestrator/realRun.ts src/state/checkpoint.ts src/domain/manifest.ts src/domain/queue.ts src/fs/paths.ts tests/orchestrator/realRun.test.ts tests/state/checkpoint.test.ts tests/domain/manifest.test.ts tests/domain/queue.test.ts tests/e2e/cli-real-mock.test.ts tests/e2e/cli-dry-run.test.ts
git commit -m "fix: complete wave 1 backend hardening"
```

---

## Notes for the Implementer

- If a task seems to require touching dry-run/mock, stop and prove it with a failing test first.
- If a task seems to require adding checkpoint schema, pause and justify why existing checkpoint + canonical paths are insufficient.
- If a task starts to look like a `realRun.ts` cleanup refactor, stop. That belongs to a later wave.
- Prefer one boring helper over a new abstraction tree.
- The measure of success is not “cleaner architecture vibes.” The measure is:
  - no lost queued work
  - no lost Prompt B artifact truth
  - no silent ledger degradation

## Expected Outcome

After Wave 1:

- planning cannot silently lose queued requests across a crash boundary
- Prompt B artifacts are durably recoverable from canonical runtime state
- the backend actually enforces the ledger contract it already claims to rely on
- OpenWeft is more robust without becoming more ceremonial
