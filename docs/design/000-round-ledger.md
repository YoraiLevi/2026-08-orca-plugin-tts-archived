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
| 3 | FMA · user stories and flows · adversarial cross-review of all four designs | 3 | **27 + 8 + 130 modes** | no | 55 silent-failure sites, zero reaching audio; X-01 would have made Stop produce speech |
| 4 | Reconcile the 8 blockers into 002–005 · fix the silent failures · build the citation checker | 3 | **8 resolved, 6 conflicts decided, 6 fixes shipped** | no | the correction table in 008 was itself 16 lines stale |
| 5 | Provider seam v2 + M9 · settings · **measure what was never measured** | 3 | **3 new designs, 5 measurement contradictions** | no | the ~970 ms was real; the mechanism cited for it everywhere was wrong |
| 6 | Fold the measurements · audit tests that cannot fail · design M16 + M17 | 3 | **9 unfailable tests, 3 live mutants, 2 designs** | no | M17 declared not buildable to R1 parity, with evidence |
| 7 | Adversarial review of everything rounds 4–6 produced | 1 | **31** | **no** | see `014-review-round7.md` |
| 8 | Adversarial review of `PLAN.md`, `TASKS.md`, the constitution's budget table, `006` and `packages/core/src/**` — run, not read | 1 | **26** | **no** | see `017-review-round8.md`. 22 of 26 came from executing the code, 2 from a peer's implementation work re-verified here; **0** from reading a document |

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

## Backfill note — 2026-08-21

Rounds 4 through 7 were run without this table being updated, and round 7's reviewer
flagged it as a blocking defect on the process itself:

> **A dry-round counter that is not being kept cannot end the process it exists to end** —
> and on this round's evidence, the process is not close to ending.

That is correct and the fault is the architect's. The rows above are backfilled from the
commit log and the round artifacts. **Dry counter: 0 of 3.** No round has yet been dry.

**Updated at the close of round 8, 2026-08-21 — kept, not backfilled.** Round 8 produced **26 items
clearing the bar** (`017-review-round8.md` section 8). Applying the bar honestly, item by item:

| Bar clause | Items | Example |
|---|---|---|
| 3 — a failure mode with a distinct cause, detection or degradation | 22 | **R8-08**, `!` and `?` end a sentence unconditionally, so a shebang or a markdown image mints a chunk with no speakable glyph — a cause `006` section 4 does not list |
| 1 — changes a recorded decision | 2 | **R8-01** replaces the FMA's per-component organisation with a seam-contract section (**R8-26** sharpens its wording from *two disagreeing predicates* to *a contract in a form that carries no meaning of its own*); **R8-02** lifts `006`'s exemption from the R006 sweep, which `HANDOFF.md:129-131` granted and round 7 disputed in R7-08 |
| 5 — invalidates a recorded claim with evidence | 2 | **R8-03**, `HANDOFF.md:56` states CI is green; `pnpm check:citations --max-stale=34` exits **1** at clean `HEAD` `[measured-here]`, n=2. **R8-04**, the brief's own statement of G-1's cause is wrong, corrected by measurement |

Two recorded items do **not** clear the bar and are named so the honesty of the count can be
checked: **R8-25** is a restatement of `006` NM6, and the clean `check:citations` result over
`011`–`013` is a negative result. Neither is counted.

**Dry counter: 0 of 3.** Round 8 was emphatically not dry, and the *shape* of the finding set says
why the process is not near its end: seven rounds of reading these documents produced a flat yield
curve, and the first round to execute the code found 24 items in a day. The counter cannot be
trusted to go dry while an entire class of evidence — running the thing — remains largely
ungathered.

## What round 7 says to do next, and why it is not more of the same

Round 7's most useful output is not a finding, it is a **map of where findings came from**:

| Source | Findings | Reading |
|---|---|---|
| `002`–`005`, reviewed in every round since round 3 | **1** | **This set has converged.** Stop re-reading it. |
| `010`–`013`, never read by anyone but their authors | **18** | A document's quality does not substitute for a second reader. Two of `010`'s block implementation, and `010` is the strongest document in the repo. |
| `PLAN.md`, `TASKS.md`, and the non-author user's experience | **6** | **P32's propagation list omitted `PLAN.md` and `TASKS.md`, so six rounds of folding never opened them.** |

**Rounds 8–10 therefore do not re-read `002`–`005`.** They read `PLAN.md`, `TASKS.md`, the
constitution's budget table and `006`; run `check-citations` over `011`–`013`, which has
never been done; and each keeps **one probe asking a question the brief did not** — both
findings that landed that way in round 7 came from exactly that.

## What round 8 says to do next, and why it is different again

Round 8 carried out that instruction. Two results change the recipe for rounds 9 and 10.

**The assigned check came back clean.** `pnpm check:citations` over `011`, `012` and `013` — never
run before — reports **zero stale citations in all three** `[measured-here]`. That branch of the
round-7 plan is closed and yielded nothing.

**The yield moved entirely to execution.** Of round 8's 26 items, **22 came from running the code**
(one battery of 45 hostile inputs through `normalize()` → `Chunker` → `OsSynthProvider`, plus the six
committed fixtures end to end), **2 from running an existing checker nobody had run**, and **2 from a
peer's implementation work (J21, PITFALLS P37), re-verified here — which moved two of the reported
facts**. **None came from reading a document.**

The structural reading, in one sentence: **`006` is organised by component, so it can review every
rule against its own component's job and never put two components' rules side by side** — and every
defect this round found lives in that space, where two modules each own a predicate for the same
concept and the predicates disagree. Three such pairs are tabulated in `017` section 1, and a fourth witness — stage identity as a
positional integer, five copies deep, every check comparing a copy to a copy — is `017` section 6b.

**Rounds 9 and 10 therefore do not re-read anything.** They build `006` section 22 — *Seam
contracts*, one row per adjacent pair, each row stating what the upstream component may emit that
the downstream one cannot accept — and they write the tests that let each row go red, by feeding one
component's **real output** to the next. Two components that each pass their own unit tests is the
condition that produced all 24.
