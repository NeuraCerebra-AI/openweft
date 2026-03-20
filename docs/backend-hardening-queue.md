# Backend Hardening Queue

This is the backend-focused queue to get OpenWeft to a more robust public-beta state without overengineering it.

The ordering is intentionally **OpenWeft-style**, not just “largest percentage first.”

That means we prioritize:

1. issues that can lose work or break recovery
2. issues that can make backend decisions untrustworthy
3. issues that weaken release confidence
4. only then the large structural simplifications

Why: a giant refactor can have a higher theoretical blast radius than a recovery bug, but that does **not** mean we should do it first. We should fix correctness and durability before we take on large cleanup.

## Ranking Method

- **Blast Radius %**: rough estimate of how much of the backend can be affected if the issue misbehaves
- **Priority Order**: the order that makes sense to fix, balancing correctness, safety, simplicity, and reviewability
- **Bias**: prefer the smallest safe fix first; defer broad refactors unless they unlock multiple smaller problems cleanly

## Guardrails

These should stay true while working this queue:

- Keep Prompt B powerful
- Keep worktree ownership with OpenWeft
- Keep UI/status surfaces unchanged unless a backend issue truly forces a UI contract change
- Prefer git-truth and checkpoint-truth over agent-narrative truth
- Avoid big rewrites when a surgical patch solves the actual risk
- Treat dry-run and mock as support systems, not the source of truth

## Ordered Queue

### 1. Fix queue/checkpoint durability during planning

- **Priority**: P0
- **Blast Radius**: **60%**
- **Why it ranks first**: this is the most direct “user work can disappear” risk still visible in the backend

**Problem**

Planning currently rewrites `queue.txt` before the checkpoint snapshot is durably saved. If the process dies in that gap, restart can see the queue as already consumed while planned features were never durably recorded in checkpoint state.

That creates the worst kind of backend bug:

- the user asked for work
- OpenWeft started processing it
- then recovery can lose the request entirely

**Files**

- `src/orchestrator/realRun.ts`
- `src/domain/queue.ts`
- `src/state/checkpoint.ts`

**Smallest safe fix**

- make planning updates checkpoint-first or transactionally durable
- ensure queue consumption and feature creation cannot get out of sync
- fail closed if one side is written and the other is not

**Why this is not overengineering**

This is not a redesign. It is basic durability hygiene.

---

### 2. Close the Prompt B persistence/recovery crash gap

- **Priority**: P0
- **Blast Radius**: **40%**
- **Why it ranks second**: Prompt B is now a first-class backend artifact, so losing track of it undermines restart reliability

**Problem**

Prompt B is persisted to disk before the checkpoint fully records it, and later execution depends on the checkpoint’s `promptBFile` field. A crash in the wrong window can leave a real Prompt B artifact on disk with no durable recovery path back to the feature.

That means restart can become less trustworthy exactly where Prompt B was supposed to improve trust.

**Files**

- `src/orchestrator/realRun.ts`
- `src/state/checkpoint.ts`
- `src/fs/paths.ts`

**Smallest safe fix**

- make Prompt B artifact discovery idempotent and recoverable from canonical location
- reconcile durable Prompt B artifacts back into checkpoint state during startup
- ensure “artifact exists but checkpoint missed it” is recoverable instead of fatal when identity is provable

**Why this is not overengineering**

We are not inventing a new artifact system. We are making the existing one durable.

---

### 3. Enforce the Ledger contract in the backend

- **Priority**: P1
- **Blast Radius**: **35%**
- **Why it ranks here**: the code and prompts now expect a ledger, but the backend still mostly treats it as text instead of a contract

**Problem**

`## Manifest` is parsed, repaired, and enforced. `## Ledger` is mostly just expected to appear in Markdown. That means the system currently acts like the ledger matters while still allowing it to degrade silently.

This is a trust-boundary problem:

- Prompt B and plan prompts say the ledger is important
- OpenWeft does not enforce that importance consistently

**Files**

- `src/domain/manifest.ts`
- `src/orchestrator/realRun.ts`
- `src/cli/handlers.ts`
- relevant tests under `tests/domain/` and `tests/e2e/`

**Smallest safe fix**

- define the minimum ledger shape the backend actually requires
- validate presence and minimum structure during planning and adjustment
- fail clearly instead of silently carrying forward degraded ledger output

**Why this is not overengineering**

This is contract honesty. It prevents us from pretending a backend guarantee exists when it does not.

---

### 4. Make dry-run and mock semantically track the real runtime

- **Priority**: P1
- **Blast Radius**: **30%**
- **Why it ranks here**: harness truth is the next layer after correctness truth; if the fake worlds lie, they hide regressions

**Problem**

Dry-run and mock still validate shape more than semantics. They prove that artifacts and headings exist, but not always that the real Prompt A -> Prompt B -> execution contract is mirrored faithfully.

This creates a subtle risk:

- tests pass
- dry-run looks healthy
- production semantics can still drift

**Files**

- `src/orchestrator/dryRun.ts`
- `src/adapters/mock.ts`
- `tests/e2e/cli-dry-run.test.ts`
- `tests/e2e/cli-real-mock.test.ts`

**Smallest safe fix**

- reduce duplicate workflow logic where possible
- tighten tests around stage semantics, Prompt B usage, and execution boundaries
- make the harnesses validate meaning, not just headings and file existence

**Why this is not overengineering**

This is about making support systems tell the truth, not adding more machinery.

---

### 5. Tighten merge-time re-analysis to account for renames and semantic overlap

- **Priority**: P1
- **Blast Radius**: **30%**
- **Why it ranks here**: stale remaining plans after a merge can quietly poison later execution

**Problem**

Re-analysis primarily checks path overlap, but merged edit summaries can include rename metadata and richer change context. If we only compare exact current paths, some remaining plans can miss needed adjustment after meaningful changes.

**Files**

- `src/orchestrator/realRun.ts`
- `src/domain/editSummary.ts`
- `src/domain/manifest.ts`

**Smallest safe fix**

- use `old_path` and other already-available edit summary data consistently
- keep the re-analysis rule narrow and deterministic
- do not invent semantic AI re-analysis when git/edit-summary truth already exists

**Why this is not overengineering**

The data already exists. This is just using it consistently.

---

### 6. Harden stale worktree and branch cleanup paths

- **Priority**: P2
- **Blast Radius**: **25%**
- **Why it ranks here**: restart is much better now, but stale git registrations can still create avoidable failures

**Problem**

If a worktree directory disappears but Git still believes the branch is checked out there, branch deletion and recreation can fail in edge cases. There are also still a couple of git probes outside the most defensive recovery wrapper.

**Files**

- `src/orchestrator/realRun.ts`
- `src/git/worktrees.ts`

**Smallest safe fix**

- make stale registration cleanup more forceful and idempotent
- make all restart probes fail closed to safe rerun
- prefer “clean restart” over “clever probe” when git state is ambiguous

**Why this is not overengineering**

It makes recovery more boring, which is exactly what we want.

---

### 7. Add end-to-end restart coverage for mid-planning and mid-execution interruption

- **Priority**: P2
- **Blast Radius**: **20%**
- **Why it ranks here**: the backend logic has improved faster than the end-to-end recovery tests

**Problem**

We have good primitive and seam coverage, but not enough “kill it at the ugly moment and restart” coverage across planning, Prompt B persistence, checkpoint reload, and resumed execution.

**Files**

- `tests/orchestrator/realRun.test.ts`
- possibly `tests/e2e/`

**Smallest safe fix**

- add one or two very high-value interruption/restart flows
- keep them deterministic and focused
- avoid trying to simulate every crash permutation

**Why this is not overengineering**

This is exactly the kind of coverage that prevents public-beta embarrassment.

---

### 8. Add orchestrator-level merge-conflict resolution coverage

- **Priority**: P2
- **Blast Radius**: **15%**
- **Why it ranks here**: the git helpers are tested better than the full orchestration path that actually uses them

**Problem**

The low-level merge primitives are in decent shape, but the full conflict-resolution branch inside the orchestrator loop still needs better end-to-end proof.

**Files**

- `src/orchestrator/realRun.ts`
- `tests/orchestrator/realRun.test.ts`
- `tests/git/worktrees.test.ts`

**Smallest safe fix**

- add one focused orchestrator test that exercises:
  - merge conflict
  - merge into worktree
  - downstream resolution
  - retry merge

**Why this is not overengineering**

This is targeted proof for one of the highest-stress backend paths.

---

### 9. Add a packaged CLI smoke test to the release gate

- **Priority**: P3
- **Blast Radius**: **20%**
- **Why it ranks here**: this matters for public publication, but it is less urgent than durability and recovery correctness

**Problem**

The release gate is strong, but it still stops short of installing or executing the actual packed artifact as a published consumer would.

That leaves room for:

- tarball issues
- dist/bin issues
- Node floor mismatches
- packaging regressions that only appear after publish

**Files**

- `package.json`
- `.github/workflows/ci.yml`
- `tests/release/`

**Smallest safe fix**

- pack the tarball in CI
- run the built CLI from the packed artifact
- assert `--help` or a tiny smoke command works under the supported Node version

**Why this is not overengineering**

This is a public-release confidence check, not a new subsystem.

---

### 10. Split `realRun.ts` only after correctness gaps above are closed

- **Priority**: P4
- **Blast Radius**: **80%**
- **Why it ranks late despite the huge percentage**: this is the biggest structural maintainability issue, but it is also the easiest place to accidentally overengineer the backend

**Problem**

`src/orchestrator/realRun.ts` is still the backend god file. It mixes:

- startup recovery
- planning
- manifest repair
- scoring and phasing
- worktree setup
- execution
- merge handling
- re-analysis
- stop/pause transitions
- audit writing

That makes the file hard to reason about and raises regression risk for every future change.

**Files**

- `src/orchestrator/realRun.ts`
- likely a few new orchestrator helper modules

**Smallest safe fix**

Do **not** do a giant “clean architecture” rewrite.

Instead:

- extract one lifecycle slice at a time
- start with the least ambiguous seam:
  - planning/document-repair
  - or merge/re-analysis
- preserve the existing orchestration loop shape while shrinking the file

**Why this can easily become overengineering**

Because it is tempting to refactor for beauty instead of risk reduction. This item should stay late on purpose.

---

### 11. Reduce duplicated orchestration logic in dry-run and mock

- **Priority**: P4
- **Blast Radius**: **55%**
- **Why it ranks last**: it matters, but it should follow correctness fixes and likely piggyback on future `realRun.ts` seam extraction

**Problem**

Dry-run and mock currently carry too much parallel orchestration knowledge. That creates long-term drift risk and makes the backend harder to simplify honestly.

**Files**

- `src/orchestrator/dryRun.ts`
- `src/adapters/mock.ts`
- shared helpers if extracted later

**Smallest safe fix**

- wait until the real runtime has cleaner seams
- then move duplicated contract logic into narrow shared helpers
- do not force artificial abstraction before the real seams are obvious

**Why this can easily become overengineering**

If we abstract too early, we can freeze the wrong contract in place.

## What Not To Do

These are the easiest ways to make the backend worse while trying to improve it:

- Do not redesign the UI just because backend artifacts became first-class
- Do not make Prompt B smaller or weaker in the name of “cleanliness”
- Do not replace git-truth with ledger-truth for recovery decisions
- Do not add new persistent schemas unless a plain git/checkpoint answer is insufficient
- Do not split `realRun.ts` just to make the file count go up
- Do not chase perfect simulation in dry-run/mock; chase truthful semantics instead

## Suggested Execution Waves

### Wave 1: Must-fix correctness and durability

1. queue/checkpoint durability during planning
2. Prompt B persistence/recovery crash gap
3. ledger enforcement

### Wave 2: Trust the backend’s own decisions more

4. dry-run/mock semantic parity
5. merge-time re-analysis tightening
6. stale worktree/branch cleanup hardening

### Wave 3: Public-beta hardening

7. restart/interruption end-to-end tests
8. orchestrator-level conflict-resolution tests
9. packaged CLI smoke test

### Wave 4: Simplify without overengineering

10. split `realRun.ts` gradually
11. reduce duplicated orchestration logic in dry-run/mock

## Bottom Line

OpenWeft is already in strong public-beta territory, but the backend still has a few places where correctness, recovery, and harness truth should beat cleanup or elegance work.

If we stay disciplined, the right path is:

- fix durability first
- enforce contracts second
- tighten harness truth third
- simplify last

That keeps the backend robust **without** turning the repo into a ceremony machine.
