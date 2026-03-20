# OpenWeft Architecture

## Status

This document describes the **canonical target architecture** for OpenWeft.

It is intentionally opinionated.

It is not merely a description of whatever the code happens to do today.
It describes the architecture OpenWeft should be converging toward:

- Prompt A generates a powerful execution brief
- Prompt B is that execution brief
- Prompt B does the real work
- OpenWeft owns orchestration, isolation, comparison, reconciliation, and merge control

If the implementation and this document disagree, treat that as a design gap to resolve rather than a reason to water this document down.

---

## 1. Core Thesis

OpenWeft is **not** primarily a planner.

OpenWeft is a **wrapper and orchestrator around autonomous worker sessions**.

The real intelligence of the system lives in the generated worker brief:

- **Prompt A** compiles a rough human request into a powerful mission brief
- **Prompt B** is that mission brief
- **Prompt B** runs inside an OpenWeft-controlled worktree and performs the actual work
- **OpenWeft** compares real execution outcomes, determines compatibility, merges safe results, and updates the remaining queue

The simplest accurate sentence for OpenWeft is:

> OpenWeft launches powerful Prompt-B workers in orchestrator-owned worktrees, then compares, reconciles, and merges their actual results safely.

That is the product.

---

## 2. The Main Architectural Shift

Older mental models tend to treat Prompt B as:

- an intermediate artifact
- a planning helper
- transient glue text between two runtime stages

That is the wrong mental model.

In the target architecture, Prompt B is:

- the **worker operating system**
- the **mission packet**
- the **behavioral engine**

Prompt B should not be demoted to a small planning intermediary.
It is the mechanism that gives the worker its depth, discipline, context, and execution style.

OpenWeft should therefore be designed around **respecting and containing** Prompt B, not replacing it with internal planning bureaucracy.

---

## 3. Design Goals

The target architecture optimizes for:

1. **Preserving Prompt B power**
   - Prompt B is allowed to be dense, overbuilt, and behavior-shaping.
   - It should remain the strongest part of the system.

2. **Separating intelligence from orchestration**
   - Prompt B owns reasoning and execution behavior.
   - OpenWeft owns topology, scheduling, and reconciliation.

3. **Using real execution artifacts as truth**
   - actual git diffs
   - actual files changed
   - actual validation results
   - actual ledger state

4. **Keeping worktree control centralized**
   - workers do not invent topology
   - OpenWeft owns worktree lifecycle completely

5. **Making the system easier to understand**
   - Prompt A writes the mission brief
   - Prompt B runs the mission
   - OpenWeft coordinates the missions

---

## 4. Non-Goals

OpenWeft should **not** try to:

- become the main planner instead of Prompt B
- micromanage the worker's internal reasoning
- force all intelligence into rigid internal schemas before execution
- let workers create their own git worktrees or repository topology
- confuse "internal" with "better"

Whether an artifact is internal or external is not the important distinction.
What matters is whether the artifact is **architecturally first-class** and whether the system uses it honestly.

---

## 5. Layer Responsibilities

### 5.1 Prompt A

Prompt A is a **compiler**.

Its job is to transform:

- a human feature request

into:

- a powerful Markdown execution brief for a worker session

That output is Prompt B.

Prompt A should:

- investigate the relevant codebase context
- inject the most useful constraints and context
- tell the downstream worker how to think and work
- encode ledger discipline
- encode testing discipline
- encode validation discipline
- encode safety boundaries
- explicitly forbid the worker from owning git topology

Prompt A should **not** perform the implementation itself.

Prompt A's deliverable is **the generated worker brief**.

### 5.2 Prompt B

Prompt B is the **worker brain**.

Prompt B is not just a plan.
Prompt B is the actual operating brief that drives the worker session.

Prompt B should run inside the assigned OpenWeft workspace and:

- inspect the codebase
- decide how to approach the task
- create and maintain a ledger
- edit code
- run validation
- report what it changed
- report what it learned

Prompt B owns:

- reasoning
- planning
- execution style
- validation behavior
- ledger discipline
- reporting

Prompt B does **not** own:

- worktree creation
- branch creation by default
- merge policy
- queue state
- scheduling
- compatibility policy

### 5.3 OpenWeft

OpenWeft is the **scheduler, isolation layer, and reconciliation engine**.

OpenWeft should own:

- queue intake
- feature ID assignment
- worktree creation
- workspace lifecycle
- session launch
- checkpointing
- result comparison
- compatibility determination
- merge sequencing
- conflict handling
- requeue / rerun behavior
- post-merge updates to the remaining queue

OpenWeft should **not** try to replace the worker's reasoning with its own internal planning bureaucracy.

OpenWeft is air traffic control, not the pilot.

---

## 6. The Canonical Flow

The canonical flow is:

1. User adds one or more requests.
2. OpenWeft assigns a feature ID to each request.
3. OpenWeft creates an isolated worktree for each worker session it wants to launch.
4. Prompt A runs for that request and generates Prompt B.
5. OpenWeft persists Prompt B as a first-class artifact.
6. OpenWeft launches the worker session in the assigned worktree using Prompt B.
7. Prompt B investigates, edits, validates, and updates its ledger inside that assigned workspace.
8. Prompt B finishes by producing a final execution report.
9. OpenWeft inspects the actual result:
   - git diff
   - touched files
   - worker report
   - validation result
   - ledger state
10. OpenWeft compares completed work across active or pending features.
11. OpenWeft merges safe results in the configured order.
12. OpenWeft updates the remaining queue based on the new repository state.
13. Repeat until the queue is empty or the user stops the run.

---

## 7. Canonical Artifacts

OpenWeft should think in terms of **artifacts**, not just stages.

### 7.1 Feature Request

The raw user request.

Examples:

- add password reset flow
- refactor auth middleware for oauth2
- add audit log export

### 7.2 Prompt B Artifact

The generated worker brief.

This is the output of Prompt A.

This should be treated as first-class because it contains:

- execution discipline
- task framing
- context
- safety instructions
- ledger requirements
- validation guidance

This artifact should be inspectable, debuggable, and durable.

### 7.3 Worker Ledger

The worker-maintained execution log.

The ledger is the worker's durable memory and continuity mechanism.

It should capture:

- the selected path
- execution state
- decisions
- discoveries
- validation state
- changes to the plan of attack
- completion status

The ledger is maintained by the worker, not by OpenWeft.
OpenWeft may inspect it, but does not author it.

### 7.4 Execution Result

The worker's final result package.

This should include, at minimum:

- success or failure
- a concise edit summary
- a validation summary
- ledger path or ledger status
- a claimed manifest or touched-file summary if available

### 7.5 Actual Repository Diff

This is the real source of truth.

If a worker claims one thing but the git diff shows another, the actual diff wins.

### 7.6 Compatibility Decision

OpenWeft's decision about whether multiple completed worker results can be safely merged together.

---

## 8. Worktree Model

### 8.1 Ownership

Worktree creation is owned by OpenWeft.

Always.

Workers must not:

- create additional git worktrees
- clone the repo elsewhere
- create sibling checkouts
- relocate work into another copy of the repository
- create or switch to ad hoc branches unless explicitly instructed by OpenWeft

### 8.2 Why This Boundary Exists

This boundary is essential because git topology is orchestration infrastructure, not worker intelligence.

If workers create their own worktrees, OpenWeft loses clean ownership of:

- workspace layout
- cleanup
- merge lineage
- conflict resolution flow
- feature-to-workspace mapping

That produces architectural chaos.

### 8.3 Worker Assumption

Every Prompt B worker should operate under this assumption:

> Workspace isolation has already been solved by the orchestrator. Use the current assigned worktree as the only workspace.

---

## 9. Compatibility Model

The key simplifying move in this architecture is:

> OpenWeft should compare **real outcomes**, not try to fully substitute for the worker by planning everything itself in advance.

This means compatibility is determined primarily using:

- actual changed files
- actual diffs
- actual repository state after execution
- worker-reported manifest or file summary as a supporting signal

### 9.1 Primary Source of Truth

Use the actual repository diff as the final truth.

Worker-reported manifests are useful, but they are not more authoritative than the files that actually changed.

### 9.2 Compatibility Questions

OpenWeft should ask:

- Did these workers touch overlapping files?
- Did they change shared interfaces or contracts?
- Can these results be merged cleanly in priority order?
- If not, which one should merge first?
- Which remaining workers must be rerun or recontextualized after that merge?

### 9.3 Tradeoff

This architecture accepts more **speculative parallel execution**.

That means two workers may both spend time on overlapping areas before OpenWeft discovers the collision.

This is not inherently bad.

It is a deliberate trade:

- less internal planning bureaucracy
- more reliance on powerful workers
- more post-execution reconciliation

In exchange, the system is much easier to reason about.

---

## 10. Planning Versus Execution

The old temptation is to force OpenWeft to produce a complete machine-readable plan before any worker is allowed to do real work.

This target architecture rejects that as the center of gravity.

The real center of gravity is:

- Prompt A produces the execution brief
- Prompt B performs the real work
- OpenWeft evaluates the outcome

That does **not** mean planning disappears.

It means planning lives where it is strongest:

- inside Prompt B's worker behavior
- inside the worker ledger
- inside OpenWeft's compatibility and merge decisions

The important distinction is:

- OpenWeft does not need to out-plan the worker
- OpenWeft needs to contain and reconcile workers safely

---

## 11. The Role of the Ledger

The ledger is important, but it should be understood correctly.

The ledger is:

- the worker's durable execution memory
- the record of how the worker thought and adapted
- the continuation point after interruption

The ledger is **not** the same thing as OpenWeft's checkpoint.

### 11.1 Worker Ledger

Owned by the worker.

Captures:

- decisions
- discoveries
- validations
- evolving execution path
- current status

### 11.2 OpenWeft Checkpoint

Owned by OpenWeft.

Captures:

- queue state
- feature IDs
- worktree paths
- run status
- merge status
- resumability for orchestration

These should cooperate, but they should not be confused.

The worker ledger is cognitive continuity.
The checkpoint is orchestration continuity.

---

## 12. Failure Model

OpenWeft should assume workers may:

- fail outright
- produce partial work
- validate incompletely
- touch unexpected files
- become stale relative to newly merged work

That means failure handling should focus on:

- preserving artifacts
- preserving worktree state
- preserving ledger and result reports
- classifying failure cleanly
- deciding whether to retry, recontextualize, or discard

The system should avoid magical hidden repair.

When something fails, it should be inspectable.

---

## 13. Why This Architecture Is Simpler

This architecture is simpler because each layer has one clear job.

### Prompt A

Writes the mission brief.

### Prompt B

Does the mission.

### OpenWeft

Controls the battlefield.

That is easier to understand than a system where:

- OpenWeft half-acts like the planner
- Prompt B secretly does the real thinking
- worktree ownership is blurry
- internal runtime stages pretend the most important artifact is unimportant

This architecture makes the truth explicit.

---

## 14. Architectural Principles

The following principles should guide all future OpenWeft changes.

### 14.1 Prompt B is first-class

Do not treat Prompt B as disposable glue.

### 14.2 OpenWeft owns topology

Workers do not own git topology.

### 14.3 Real diffs beat declared intent

Actual repository changes are the final truth.

### 14.4 Separate cognition from orchestration

Prompt B thinks and works.
OpenWeft schedules and reconciles.

### 14.5 Durable artifacts matter

Persist the important things:

- Prompt B
- worker ledger
- execution result
- checkpoint

### 14.6 Simplicity is role clarity

Simplicity here does not mean fewer files or fewer moving parts at any cost.
It means fewer blurred responsibilities.

---

## 15. What OpenWeft Is

OpenWeft is:

- a queue manager
- a worktree allocator
- a worker launcher
- a result comparator
- a merge controller
- a recovery system

OpenWeft is not:

- the main planner
- the main reasoner
- the author of the worker's execution discipline

Prompt B is where the power lives.
OpenWeft's job is to make that power safe, parallelizable, and recoverable.

---

## 16. Canonical Summary

If someone asks how OpenWeft works, the shortest correct answer is:

1. OpenWeft takes queued requests.
2. Prompt A turns each request into a powerful worker brief called Prompt B.
3. OpenWeft launches Prompt-B workers inside orchestrator-owned worktrees.
4. Each worker investigates, edits, validates, and maintains its ledger.
5. OpenWeft compares the actual results, merges the compatible ones, and updates what remains.

That is the architecture.
