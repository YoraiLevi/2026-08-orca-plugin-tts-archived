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
| 9 | **Build**, not review: `006` section 22 — seam contracts, one row per adjacent pair, each seen red | 1 | **7** | **no** | see `018-review-round9.md`. 10 rows, 3 seams asked-and-empty, 6 rows OPEN. Every row proved red; the mutation log is `018` section 4 |
| 10 | Close section 22.5's own list; extend section 22 to the seams **into ORCA** | 1 | **7** | **no** | see `019-review-round10.md`. Seam 10 closed; the decoder gets rows; a 32,525-record census of the real transcript format, never taken before. **Recommends continuing past 10** — see below |
| 11 | The last two inventories: the transcript **tailer** and the **adapter/manifest** — the seams whose far side is not our code | 1 | **2** | **no** | see `020-review-round11.md`. **The seam inventory is complete: five for five, every one yielding on its first look.** Thinnest round yet, bar fully met |

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

## Close of round 9 — the counter, and the first sign of a bend

Round 9 executed that instruction. `006` **section 22 exists**: nine rows, three seams asked and
recorded as empty or unclosable, two covered by tests that already existed, five rows **OPEN** and
marked `it.fails` so they turn red the moment they are fixed. Every row was **seen red** — the
mutation log is `018` section 4, and two mutations **survived** and are recorded as survivors.

**7 items clear the bar**, against round 8's 26:

| Item | Clause |
|---|---|
| **R9-01** — `006` gains a section whose subject is a seam, with the seen-red closing rule | 1 |
| **R9-02** — NM12 is a **control-map** defect with a Lab-specific listener experience, and now has a detection | 3 |
| **R9-03** — a consistently-wrong control-to-transform binding survives the whole 598-test suite and the boot assertion, **measured** | 5 |
| **R9-04** — stale citations went **91 to 130 in one afternoon** with the ratchet still at 34; the drift rate makes a hand-walked ratchet decoration | 5 |
| **R9-05** — the sink collapses every non-`wav` format to `chunk.bin`, silently | 3 |
| **R9-06** — `bytesPlayed` moves for audio nobody heard, so `selfTest()` — the instrument for the FMA's rank-one undetectable — can report success while mute | 3 |
| **R9-09** — the million ceiling is a **seam** decision, not a tuning choice: below it we decide what the listener hears, at or above it a different engine per platform does. Its two halves land in two places, and the numeral must cross byte for byte | 3 |

Two recorded results do **not** clear the bar and are named so the count can be checked: **R9-07**
(mutation M1 survived, bounding SC-4's sensitivity — a property of a test written this round) and
**R9-08** (part of R8-26's premise was wrong; the existing suite *does* catch a stage-name swap — a
correction to an item, not a new one).

**Dry counter: 0 of 3.** Round 9 was not dry.

**But the count fell four-fold, and that is the first thing in this process that looks like
convergence.** `018` section 6 argues both readings and refuses to pick between them from one round,
because they are not distinguishable from inside a single round: round 8 harvested a backlog that a
never-applied method had accumulated, and a backlog is harvested once; round 9's seven items are
mostly things its instruments found *while being built*, which is what both a converging and a
slowing process look like.

**What round 10 must do to make the counter mean something.** Section 22 was scoped to the **audio
path**. The ORCA-facing seams — transcript tailing, the decoder, the adapter (`006` sections 1, 2
and 8) — were deliberately not re-derived and are a second, untouched inventory. Round 10 extends
section 22 to them, by the same rule: a row closes only when a test feeds one component's real
output to the next and has been seen red.

- If round 10 comes back **thin**, that is a genuine dry signal, because the same method will have
  been applied twice to two different inventories.
- If it comes back **thick**, the seam method still has a backlog and the counter is not yet
  measuring convergence.

One caution the round-9 record puts on itself, and the ledger keeps: **three of round 9's seven items
were on seams nobody had looked at** — two found by one probe in ten minutes one layer below the
layer the brief named, and one (R9-09) on a decision nine rounds had read as a tuning choice. There is no evidence the layer below that has been examined either. A thin round 10
is necessary for a dry signal; on its own it is not sufficient.

## Close of round 10 — the last mandated round, and why it is not the last round

Round 10 closed the row round 9 called its own weakest, opened the first seam into ORCA, and took a
census of the transcript format that ten rounds had only ever reasoned about.

**7 items clear the bar**, against 7 and 26:

| Item | Clause |
|---|---|
| **R10-01** — an unrecognised content block and a deliberately-filtered one are one observable; the instrument for exactly this distinction exists one layer up (file-level) and not one layer down (block-level). **Latent**: 0 unknown block types in 6,022 assistant records `[measured-here]`. The fix is constrained by principle VIII | 3 |
| **R10-02** — ORCA writes `{"type":"system","subtype":"compact_boundary"}`; huddle infers the same event from *"the file got shorter"* and never reads `subtype`. A strictly weaker proxy for a fact that is in the file, guarding the *"replayed session"* harm the code itself calls unrecoverable | 3, 5 |
| **R10-03** — the huddle fixture corpus models **2 of the 18** record types the real format emits, and omits the most common one entirely, so it cannot raise the question it would need to answer | 5 |
| **R10-04** — seam 10 closed (SC-11); and a control assertion that could only recognise a report whose words it already knew, which mutation M11b walked straight through | 1 |
| **R10-05** — the normalizer's *"DEPENDENCY-FREE"* header is load-bearing infrastructure for the Voice Lab's data-URL compile, written as prose with no instrument. **Violated during this round** and the Lab stopped booting; SC-13 is now the instrument | 3 |
| **R10-06** — **three** resolvers disagree (vitest, plain node, `tsc`) and **no specifier satisfies all three**, so **21 tests are green while `pnpm voice-lab` cannot start.** The suite never loads the code the way the product loads it; SC-14 is now the instrument, and it is red as committed | 3 |
| **R10-07** — **SC-3 was mis-specified by this round's own author** into an indicator that could not go red (P32 inside the instrument). The rewrite asserts the argv rather than the chunk, closes SC-3's platform gap on one machine, and finds **R8-06's residual**: the three exported builders still disagree, now about neutralisation | 3 |

**Provenance, so the count can be read honestly:** R10-01 to R10-04 came from this round's own probing; **R10-05, R10-06 and R10-07 arrived from peers' live work** and were verified here with controls before being written down. **Excluded and named**, so the count can be checked: mutation **M9** survived and the repo already
knew why — `scripts/mutation-check.mjs` carries it as `thinking-continue-only`, marked
`equivalent: true` with a better explanation than this round reached independently. And **three
census hypotheses came back empty** (unknown block types 0 of 6,022; the 200-line prefix 0 of 60;
non-assistant prose 0 of 17 types), which is why R10-01 is filed as latent rather than live.

**Dry counter: 0 of 3.** Round 10 was not dry. **In ten rounds the counter has never started.**

### The recommendation: continue past ten

| Round | Items | Method |
|---|---|---|
| 8 | 26 | running the pipeline over real and hostile input, first time ever |
| 9 | 7 | seam instruments for the audio path |
| 10 | **7** | seam instruments for the first ORCA-facing seam |

The bend is real. It is still not a dry signal, for two reasons the record states plainly:

1. **The contract is `10 minimum AND 3 consecutive dry`.** Ten is the floor, not the finish, and the
   dry counter has not started once.
2. **Round 10 reached one of the three ORCA-facing seams.** The transcript **tailer** (`006`
   section 1 — `fs.watch`, debounce, truncation, high-water, session switching) and the **adapter**
   (section 8 — the actual ORCA host API, where the other side is a genuine third party) still have
   **no seam rows**. The decoder alone yielded two open rows and a census that invalidated a test
   corpus. Concluding convergence from one third of an inventory would be the same error section 22
   exists to correct: reasoning from a component about the space between components.

**What makes round 11 a real dry signal.** Give the tailer and the adapter seam rows by the same
rule — a row closes only when a test feeds one component's real output to the next and has been seen
red. Thin there, and the counter can start with evidence behind it: three inventories, the last one
empty. Thick there, and this round's bend was the decoder being a small seam rather than the seams
being clean.

**Does the round-8 argument still hold?** It argued that the counter could not be trusted to go dry
while *"an entire class of evidence — running the thing — remains largely ungathered."* Rounds 9 and
10 gathered a great deal of it, and the honest answer is that **the class has been sampled and not
surveyed.** Of five inventories, three are surveyed — the audio path, the transcript decoder, and
the normalizer's own build-time contract — and **two have never been opened**: the transcript tailer
(`006` section 1) and the adapter and manifest (section 8), which are the two seams whose far side
is code we do not control.

Three facts decide it, and they agree: **every inventory opened so far has yielded on its first
look**, including ones expected to be clean; **one of round 10's five items was found by accident,
in a file ten rounds had read**, which is what an under-sampled inventory looks like from the inside;
and the two unopened ones are the least controllable shape in the project.

**So the argument holds in a weakened, more specific form** — not *"a whole class is ungathered"*,
which was true at round 8 and is not true now, but *"two of five inventories have never been
opened."* The endpoint is stated in advance so it cannot be moved later: **open the tailer and the
adapter by the same rule. Thin there, and the dry counter starts meaning what it says. Thick, and
this round's bend was the decoder being a small seam rather than the seams being clean.** Two more
rounds, not an open-ended extension.

**Stated so it is not soft: the recommendation is to continue, and the reason is coverage, not
enthusiasm.**

## Close of round 11 — the survey is complete, and the decision is the author's

Round 11 opened the two inventories that had never been opened, by the same rule.

**2 items clear the bar** — the thinnest round in the protocol, and the bar was fully met: both rows
feed one component's real output to the next, and both were seen red.

| Item | Clause |
|---|---|
| **R11-01** — an atomic rename-replace kills the watch: `fs.watch` emits `rename`, **never `error`**, and the tailer discards `eventType` in its argument list. One session goes permanently quiet while every other works. `006` TT13 records this as closed; it is closed against the wrong channel | 3, 5 |
| **R11-02** — the manifest exists **twice**, the checks are split across the copies (unit tests read source, CI reads dist), and **`read-aloud.self-test`** — the instrument built for section 19's **rank-one** undetectable, *"that the plugin is mute"* — is declared in source and **absent from the shipped manifest** at `HEAD` | 3, 5 |

**Excluded and named:** the completion of the inventory is the round's **conclusion**, not an item —
it changes no decision and adds no failure mode, and counting a round's own summary is the shape the
bar exists to exclude. Section 4's four negative results are results, not items.

**Dry counter: 0 of 3.** Round 11 was not dry. **In eleven rounds the counter has never started.**

### The argument for continuing has expired, and this ledger says so

| Round | Items | Method |
|---|---|---|
| 8 | 26 | running the pipeline over real and hostile input, first time ever |
| 9 | 7 | seam instruments for the audio path |
| 10 | 7 | seam instruments for the decoder and the build-time contract |
| 11 | **2** | seam instruments for the tailer and the adapter |

Round 10's reason for continuing was *"two of five inventories have never been opened."* **That is no
longer true.** The endpoint stated in advance — *"open the tailer and the adapter by the same rule,
two more rounds, not an open-ended extension"* — **is met**, and the seam method has been applied to
every adjacent pair in the system.

**Five inventories, five yields on first look**, including the one where most questions came back
empty. That fact still argues the system is not clean. But **there is no longer a named ungathered
class**, and round 8's argument was right *because* it named one. Manufacturing a new one to keep the
process alive is exactly the enthusiasm this bar exists to exclude, and this record will not do it.

**Recommendation for rounds 12 and 13: no new inventory, no new method.** Re-run the existing bar
over the whole system and see what a round with nothing left to open produces.

- **Dry twice** → the counter reaches 2 of 3 honestly, on a surveyed system, and round 14 can close
  the protocol on the author's own terms.
- **Still yielding** → that is the strongest possible evidence for continuing, and unlike every
  previous round it would be **evidence rather than an argument**.
