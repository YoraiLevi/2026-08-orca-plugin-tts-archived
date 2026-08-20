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
| 2 | Design: spoken channel · panel+control · Voice Lab · agent identity. Plus a fix agent on the three bugs. | 5 | **4 designs, 3 fixes, 8 new questions** | no | M13 reframed; identity inverted to earcon+call-sign; Linux floor fixed |
| 3 | FMA · user stories and flows · adversarial cross-review of all four designs | 3 | — | — | in flight |

## Parking lot

Ideas that did not clear the bar, kept so they are not re-proposed every round.

| Idea | Round | Why parked |
|---|---|---|
| Option C — summarize the finished reply with a second model | 2 | Rejected on R4.1 (cannot stream), R4.2 (cannot meet 500 ms), R3.4 (needs a model). Its failure mode is unverifiable: a wrong summary is indistinguishable from a right one to a listener who never sees the original. |
| Storage-flag command channel from the panel | 2 | Not implementable. `storage.get` and `storage.set` are both `panel: false`, enforced by a hard refusal pinned by a conformance test. |
| Waiting for upstream ORCA PRs before M13 | 2 | All six upstream items open, one day old, zero maintainer engagement. Control works today via `terminal.sendText`. |

## Round 2 — what the designs actually decided

Recorded here so a later round does not re-open them without cause. Each links to the argument.

| Decision | Where | The reason in one line |
|---|---|---|
| The spoken channel is a **ladder**, not a choice: structural classifier as the floor, `speak` fence as an enhancement | 002 | The floor works with zero agent cooperation, and cooperation is the thing we cannot rely on |
| We **never write to a user's `CLAUDE.md`** | 002 | It is user-owned config; we document the six lines and let the user paste them |
| Voice Lab plays audio in the **browser**, not the server | 004 | Server replay re-pays a 414 ms spawn every press and cannot meet the two-second gate at all |
| A/B is **blind while playing, revealed on stop**, naming the single differing control | 004 | Removes the expectation effect that made the chat loop fail, at zero extra clicks |
| The dashboard is a **terminal TUI**, not the plugin panel | 003 | The panel is write-capable and read-blind; the TUI has no bridge budget, no watchdog, no poll latency |
| Stop is **pushed, never polled**; p50 120 ms, p99 250 ms, >400 ms fails CI | 003 | The poll floor alone is 345 ms, so a polled Stop is double the budget by construction |
| Spoken identity is a **call-sign, never hex** | 003, 005 | Eight hex characters read aloud to a dyslexic listener is close to worst-case |
| Identity is `(callSign, earcon, voiceTuple)`, designed for **N=1** | 005 | Voice-based identity guaranteed on all three platforms is exactly 1; the portable axes are the ones we generate |
