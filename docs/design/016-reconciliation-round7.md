# 016 — Round-7 reconciliation ledger

**Status:** in progress, written incrementally. **Started:** 2026-08-21.
**Work order:** `docs/design/014-review-round7.md` — 39 findings, of which 31 clear the ledger bar
(`014` section 10).

**What this document is.** One row per finding: what changed, in which document, and — where a
finding was not resolved — why. It follows `docs/design/009-reconciliation.md`'s pattern exactly:
**amend in place, with a dated note naming the finding that forced each change; keep the ledger
here; never write a document that says what another document should have said.** Nothing below is a
new design. Where this row and the amended document disagree, **the amended document is the
authority** — this is a ledger, not a seventeenth design.

**The record is untouched.** `006-fma.md`, `007-user-stories.md`, `008-crossreview-round3.md` and
`014-review-round7.md` are the record of what was found and are not edited here. That constraint has
a cost, and it is stated plainly in R7-07 and R7-08 below rather than hidden.

---

## 0. Why this ledger is written incrementally, and what happened before it

**This job died once.** The first J20 pass was killed by a five-hour session limit with 1,548
insertions uncommitted; the architect committed them rather than lose them (`2385147`). It had
written **no ledger**, so nothing recorded which findings its 1,548 lines addressed. Reconstructing
that map — commit-diff forensics, not design work — was this pass's first task, and section 1 is its
result.

**The lesson is procedural and belongs here, not only in the goal ledger:** a long pass that writes
its ledger last loses the map when it dies. Every row below was written as its finding was closed,
and this file was committed before the first amendment of this pass was made.

**Provenance of every row.** Column *"Closed by"* distinguishes:

| Value | Means |
|---|---|
| **`2385147`** | resolved by the first, killed pass — **verified here** by reading the amended document's body, not by trusting its amendment table |
| **this pass** | resolved in this pass |
| **open** | not resolved; the row says why, and who must decide |

**Verification method, stated so it could have failed.** A finding was counted resolved only when
the *body section* that owns the mechanism carries the change, not when the document's header
amendment table claims it. That check did fire: `013`'s header claims seven findings resolved and
its body carried four (section 1.3).

---

## 1. What the killed pass had already resolved

### 1.1 Fully reconciled, verified in the body

| Finding | Severity | Document | Verified at | Closed by |
|---|---|---|---|---|
| **R7-01** M9 has no task or gate for holding the device open | blocks-impl | `TASKS.md`, `PLAN.md`, P32 | `docs/TASKS.md` Phase M9 rescoped + re-gated (M9a); `docs/PLAN.md` gains the gap DoD item | `2385147` |
| **R7-02** inter-sentence budget unenforceable at every level | blocks-impl | constitution, `PLAN.md`, `TASKS.md` | constitution 2.0.1 amendment; `PLAN.md` DoD item; labels added | `2385147` |
| **R7-03** `PLAN.md` never folded; DoD holds an unachievable item | blocks-impl | `PLAN.md`, `PITFALLS.md` P32, `010` | `PLAN.md:34`, `:80-81` (the "86 ms" arithmetic withdrawn in place); **P32's propagation list corrected to name `PLAN.md` and `TASKS.md`** | `2385147` |
| **R7-11** roadmap item 7 exists nowhere | worth-noting | `PLAN.md`, `TASKS.md` | renumbered, dated note at both ends | `2385147` |
| **R7-13** gate results irreproducible under concurrent writers | worth-noting | `PITFALLS.md`, `012` | new PITFALLS entry: measurements record the SHA and the dirty state beside the number | `2385147` |
| **R7-15** section 8 vs 8.2 on whether OS-synth can meet R4.2 | blocks-impl | `010` | `010` section 8.2 verdict replaced by SPIKE-1; the categorical sentence narrowed; rung table row 4 narrowed | `2385147` |
| **R7-16** falsifier table holds a refuted claim and a fired falsifier | needs-decision | `010` section 13 | table repaired in place, both rows rewritten | `2385147` |
| **R7-17** `AudioChunk` reshaped, `PlaybackSink` never respecified | blocks-impl | `010` | **section 4.0a is new** — `PlaybackSink` v2 + the `SpeechEvent`→sink demultiplexer; rung 1 restated as not a pure refactor | `2385147` |
| **R7-18** `cancel()` redefined while `CANCEL_BUDGET_MS` stays 50 | needs-decision | `010`, constitution | section 4 states which quantity the 50 ms gates; `010:309` vs `:416` reconciled | `2385147` |
| **R7-19** socket anchored to a directory we cannot locate | needs-decision | `010` section 11.2 | re-anchored to `011`'s namespace and cited | `2385147` |
| **R7-20** Linux escape hatch needs node-gyp or a broken `--stdout` | needs-decision | `010` section 9 | clause replaced; P25/P29/R012 named and costed | `2385147` |
| **R7-21** one citation wrong at the pinned SHA; five unpinned `speechd` pointers | worth-noting | `010` | `004:102`→`004:126-127`; the blanket coverage claim corrected | `2385147` |
| **R7-22** `supports()` sync but the voice list is async and ~487 ms | needs-decision | `010` section 4 | cold behaviour specified | `2385147` |
| **R7-24** `playback: 'provider'` is a capability with no rule limiting it | worth-noting | `010` section 4 | "R021 exception, not a capability" + contract assertion | `2385147` |
| **R7-25** sentence-resume wrongly claimed to need word events | worth-noting | `010` section 11.3 | corrected in place (R020; the chunker already holds the boundaries) | `2385147` |
| **R7-26** `T093 Warm-on-start` vs the lazy-start ruling | worth-noting | `010` section 11.1, `TASKS.md` | T093 named in 11.1 and reconciled | `2385147` |
| **R7-27** `011`'s KV mirror can never fire | blocks-impl | `011` | **section 1.2a is new** — ordered load, mirror read first, starter file generated from mirrored values, `revision` seeded to `mirror.revision + 1`; `revision`'s mirroring stated for the first time | `2385147` |
| **R7-31** settings-failure report speaks unprompted at `activate()` | needs-decision | `011` | section 4.3a: `announce.reportChannel`, option space designed, **default left to the listener** (P23); Q68 opened | `2385147` |
| **R7-32** `fs.watch` rename risk with no detection | needs-decision | `011` | stat-poll fallback + watch-health; `read-aloud.status` speaks the loaded `revision`/`writtenAt` | `2385147` |
| **R7-33** `012`'s liveness rule has no Windows-executable form | needs-decision | `012` | section 4.2a: Q74 promoted to a T160 precondition; every gate-M16 row rewritten `windows-latest`-executable; the `unverified` path positively asserted with a negative control | `2385147` |
| **R7-34** `win-arm64` cost charged to STT when TTS already pays it | needs-decision | `013` | section 2 option B re-scored on **marginal** cost; verdict unchanged, reason replaced | `2385147` |
| **R7-35** VAD/keyword spotting never considered; mic capture never named | needs-decision | `013` | section 2 gains **option F**; **section 2a** names cross-platform mic capture as the real blocker; Q84 opened | `2385147` |
| **R7-36** `ceil(8/\|F\|)` admits 9 against a global cap of 8 | worth-noting | `012` | `floor(cap/\|F\|)` + remainder to the current speaker; **the total asserted** in the fairness test; wireframe corrected | `2385147` |
| **R7-37** `012:227` miscites `main.ts:96` | worth-noting | `012` | corrected to `:99`, verified with `git show 1161722:…` | `2385147` |
| **R7-38** `013`'s Ubuntu finding not produced by its own reproduce command | worth-noting | `013` | one pattern, used in both places, section 0 | `2385147` |

### 1.2 Partly reconciled

| Finding | Where it stands |
|---|---|
| **R7-06** `maxQueued` specified three incompatible ways | **`011` and `012` done** (`011` section 3.2a owns `queue.maxQueued`; `012` cites it and restates no number; `TASKS.md` T125 carries it — the "no task carries it" half is closed). **`013` was not reached** — see 1.3. |
| **R7-29** `012`/`013` invent ≥7 settings the frozen schema lacks | **`011` section 4.2a (registration protocol) and `012` section 11a done. `013` section 9a is referenced twice and does not exist** — see 1.3. |
| **R7-39** unlabelled numbers in `012`/`013` | `012`'s wireframe readout labelled. `013`'s labels verified in this pass — see section 2. |

### 1.3 Claimed in a header table but **absent from the body** — the death was mid-document

`013`'s header amendment table lists seven findings. Its body carried four (R7-30, R7-34, R7-35,
R7-38). The three below were claimed and not applied; the pass died inside `013`.

| Finding | The claim | What the body actually said |
|---|---|---|
| **R7-06** | *"Section 4's step 4 cites `011`'s `queue.maxQueued` and restates no number"* | `013:444` still read *"the same `maxQueued = 8` cap"* |
| **R7-28** | *"Section 4's budget paragraph is rewritten to keep two quantities named separately"* | `013:473-476` still read *"Barge-in **is** Stop with an earcon after it, so the gate is measured on the same budget"* — the exact collapse the finding names |
| **R7-29** | *"Section 9a is new"* | there is no section 9a; the document ends at section 9 |

**This is why a header amendment table is not evidence.** It is written first, as the plan; the body
is the work. Any future reconciliation should verify the body, as section 0 says.

---

## 2. Resolved in this pass

*(appended as each is closed)*

---

## 3. Not resolved, and why

*(appended as each is decided)*

---

## 4. Citations

*(before/after, with the false positives named)*
