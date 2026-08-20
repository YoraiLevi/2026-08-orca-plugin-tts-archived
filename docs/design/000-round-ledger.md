# Design round ledger

**Opened** 2026-08-21. **Protocol agreed with the author** in this session.

## The contract

> Work on the designs and documents, catalog open questions (and attempt to resolve them first),
> and only then, when fully done reviewing — **10 rounds minimum, until 3 consecutive rounds return
> no new items** — present FMA and UI/UX user stories and flows.

Author's three scoping answers, locked:

| Decision | Answer |
|---|---|
| Order of work | **Design → code, speckit method.** No parallel implementation. |
| Output form | **Repo markdown only.** No published web page. |
| Sweep width | **Everything, including revisiting shipped v1 decisions.** |

## What counts as a "new item"

A round is **dry** when it produces no item clearing this bar. Ideas that do not clear it go to the
parking lot; they do **not** reset the dry counter.

An item is new if, and only if, it does at least one of:

1. **Changes a decision** already recorded in a design doc, `docs/`, or the constitution.
2. **Adds or changes a flow** — a user-visible sequence of steps in `user-stories.md`.
3. **Adds a failure mode** to `fma.md` that has a distinct cause, detection, or degradation from
   every mode already listed. A new *symptom* of a listed cause is not new.
4. **Opens or resolves a question** in `.discussion/000-open-questions.md`.
5. **Invalidates a v1 decision** with evidence — a citation, a measurement, or a listening report.

Explicitly **not** new: a restatement in different words · a feature idea with no flow and no
failure analysis · a preference the constitution already assigns to the listener (kind **T**) ·
polish on wording that changes no behaviour.

Rationale: a design agent can always invent one more idea, so a pure novelty test never goes dry.
The bar makes the counter measure convergence rather than enthusiasm.

## Rounds

| # | Focus | Agents | New items | Dry? | Notes |
|---|---|---|---|---|---|
| 1 | Resolve empirical questions (kind **E**) | 4 | **18 resolved, 5 new** | no | 5 design options closed permanently; M13 unblocked; a shipping bug found |
| 2 | Design: spoken channel · panel+control · Voice Lab · agent identity. Plus a fix agent on the three bugs. | 5 | — | — | in flight |

## Parking lot

Ideas that did not clear the bar, kept so they are not re-proposed every round.

| Idea | Round | Why parked |
|---|---|---|
| — | — | — |
