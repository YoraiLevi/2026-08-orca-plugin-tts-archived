# 016 — Round-7 reconciliation ledger

**Status:** complete for the findings this job could reach; section 3 names what it could not and why.
**Started and finished:** 2026-08-21, written incrementally as each finding closed.
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

| Finding | Severity | What changed, and where |
|---|---|---|
| **R7-06** (`013`'s half) | needs-decision | `013` section 4 step 4 read *"under the same `maxQueued = 8` cap"*. It now **cites `011`'s `queue.maxQueued` and names no value**, with a dated note saying why. `011` and `012` were already done; this closes the finding across all three documents, and `TASKS.md` T125 carries the code half. |
| **R7-28** | needs-decision | `013` section 4's budget paragraph is **replaced by a two-row table**: press → last sample is `003`'s p99 ≤ 250 ms end-to-end; the **provider-cancel segment inside it stays `CANCEL_BUDGET_MS = 50`**, which is the constitution's row. Gate M17a gains a row asserting `cancel()` alone — *"a 200 ms cancel inside a 240 ms end-to-end pass leaves the old row green while regressing the constitution 4×"*. **No constitutional number was moved**; the note says plainly that moving it is a constitution amendment plus a constant change, not a design-doc sentence. Also cites `010`'s R7-18 resolution so the two budgets are not read as covering the unmeasurable drain. |
| **R7-29** (`013`'s half) | needs-decision | **`013` section 9a is new** — it was referenced twice by a section that did not exist. Six rows, each an `011` `FieldDescriptor` at `since: 3`: the four `011`'s register already reserved, plus **`input.talkWindowIdleMs`** and **`input.paneFallbackWatch`**, which section 3.3a needs and which did not exist when that register was written. Both are added to `011` section 4.2a's register in the same change (nine → eleven), per its rule 3. It also says what is deliberately **not** a setting: the spoken clauses (`011`'s `announce.*`), the earcon ids (`005` section 11.1b) and the two budgets (R7-28). |
| **R7-30** (gate half) | blocks-impl | `013` section 3.3a was complete; **gate M17a was not** — every close-condition row assumed `\|F\| ≥ 1`, the configuration section 3.3a shows is the unusual one. Two rows added: `F = ∅` with a control pane (closing on the pane's own cwd record, **negative control:** watch disabled must fall through to `input.talkWindowIdleMs` and not `input.talkWindowMs`), and `F = ∅` with nothing readable. |
| **id drift** | — | `013` section 3.3a named the clock `session.talkWindowMs`; `011`'s register reserves **`input.talkWindowMs`**. Eight references renamed to `011`'s id. Two documents naming one control two ways is the shape R7-06 was. |
| **R7-23** | worth-noting | **`010` swept into R006's vocabulary.** It declared **MEASURED / DOCUMENTED / ESTIMATED** and attributed them to R006, which uses none of those words, then mixed both vocabularies inside one six-row table. The mapping is one-to-one and is declared in `010`'s header: MEASURED → `[measured-here]` (every one was this project's own probe), DOCUMENTED → `[documented]`, ESTIMATED and `UNMEASURED` → `[claimed]`. **No claim was upgraded by the rename.** `HANDOFF.md`'s clause (3) — *"every latency number in this repo now carries an R006 label"* — **was false when written**, and is corrected to name what was swept (`010`–`013`, `002`–`005`, `009`, research) and what was not (`006`, exempt as the record — R7-08). A repo-wide claim no probe backs is P32's shape. |
| **R7-12** | worth-noting | `009:36` cited `#highWater` at `HUDDLE_HIGH_WATER_KEY`'s line. Re-derived by symbol: `#highWater` `huddle/index.ts:138`, `HUDDLE_HIGH_WATER_KEY` `:68`, the gate `:380`. `009:33`'s `provider.linuxBackend` re-anchored to the getter at `os-synth/index.ts:256`, and `LINUX_INSTALL_HINT` given its **own** citation instead of stealing the row's anchor. | <!-- citation-check: ignore --><!-- why: this ledger QUOTES citations as examples of the four shapes in section 4.3 - a wrong number here IS the illustration. Re-anchoring it would delete the example. Same class as 014's declared self-citations. -->
| **R7-09** | worth-noting | Three documents carried three wrong test counts (145 / 106 / 145; actual then 186). `HANDOFF.md:57` and `STATE.md:16` now read **337 passing, 18 files**, **recorded with the SHA they were measured at** (`745d36c`) — per R7-13, because a bare count goes stale the next time anyone adds a test. `006:3`'s count is untouched: `006` is the record. |
| **R7-10** | worth-noting | `STATE.md`'s DoD row asserted, in the present tense, that *"the contract gate asserts `<= 1000 ms`, not 50"* — fixed in `22269aa` long before. Corrected to the gate as it is: `.toBeLessThanOrEqual(CANCEL_BUDGET_MS)` at `contract.ts:80` against `CANCEL_BUDGET_MS = 50` at `:12`, no multiplier. **The half that is still true is kept**: kill-to-exit is not audio-stop, and drain is `[claimed]`. |
| **R7-14** | worth-noting | `001:3` read *"Status: open"* ninety-seven lines above its own RESOLUTION. The status line now states the outcome, with a dated note saying why the defect happens: **a status line is the first thing read and the last thing updated.** |
| **R7-07** | blocks-impl | See section 4. **190 → 80 stale**, and every one of the 80 is in a document this job may not edit. |
| **new: P35** | — | `PITFALLS.md` gains one entry (34 → 35 entries, `grep -c '^## P[0-9]'` 35 → 36 including the header rule): **a suppression marker the tool does not parse is a suppression that never happened.** It was earned here — see section 4. |

---

## 3. Not resolved, and why

Listed so that round 8 does not have to rediscover which were skipped **on purpose**, and who is
blocked on what. `009` section 3 is the pattern.

| # | Severity | Why not resolved here | Who must act |
|---|---|---|---|
| **R7-04** | blocks-impl · **violates a NON-NEGOTIABLE principle** | Huddle fails silently and permanently for any user without `~/.claude/projects`. **The fix is in `packages/plugin`, which another agent owns and was actively committing into during this pass** (`7d4b8a8` landed mid-job). A documentation pass cannot close a silent-failure defect; naming it in a design doc while the code stays silent is exactly the failure R7-04 reports. **Nothing here changes it, and it is still live.** | an agent with `packages/` — the principle (I / R009) already decides the behaviour |
| **R7-05** | needs-decision | No `deactivate`; `dispose()` is a dead wire; post-M9 the orphan holds the audio device; the inbox and an 87.7 MiB cache survive uninstall unnamed. `010` names it in place (*"which is itself unfinished business, see finding R7-05"*), which is the honest doc-side state. The `deactivate` half is `packages/`; **the cache half is the author's** — it is a decision about what to leave on their machine. | **author** for the cache; an agent with `packages/` for `deactivate` |
| **R7-08** | needs-decision | `006-fma.md` carries two claims citing a header that now says the opposite, and ID12's severity is wrong by 6.2×. The resolution `014` proposes — give `006` the dated amendment note `004` and `005` got — **reverses `009`'s stated exemption of the record**, and this job is instructed not to edit `006`. So it is correctly *not* an agent's call. **It is also the single largest cost in the repo right now**: 63 of the 80 remaining stale citations are in `006`, and `check:citations` cannot come back under its ratchet of 34 while that file is exempt. | **author** — it reverses a rule they set |
| **R7-07** | blocks-impl | **Partly resolved** (section 4). The residue is structural, not neglect: 80 stale, 80 of them in `006`/`014`/`008`. It cannot go below 34 without R7-08. | gated on **R7-08** |
| **R7-13** | worth-noting | Resolved *as a rule* by the killed pass (`PITFALLS`: record the SHA and the dirty state beside every measured number) and **re-earned as a fact during this one** — see section 4's decomposition. The rule now exists; the condition it describes has not gone away. | nobody; it is a standing hazard |
| round 7's **eleven parking-lot entries** | — | Out of scope by instruction. They are recorded in `014` section 8 as rejected-against-the-bar, and re-proposing them is what that section exists to prevent. | nobody |
| re-reading **`002`–`005`** | — | Out of scope by instruction, and `014` section 10 argues why: that set produced one finding across five rounds and has converged. **Their citations were still re-anchored here** — a mechanical repair against a moved tree is not a re-read, and leaving them stale would have been leaving a known-red instrument red. | nobody |

**One thing this job could not do and did not fake.** `014`'s recommendation for rounds 8–10 is to
read `PLAN.md`, `TASKS.md`, the constitution's budget table and `006`. The first three were reached
by the killed pass and verified here (section 5). **`006` was not, and cannot be, while it is
exempt.**

---

## 4. Citations — R7-07

### 4.1 The numbers

| Reading | Verified | **Stale** | Unanchored | Where taken |
|---|---|---|---|---|
| Clean `HEAD` `9c36dcc`, round 7's own measurement | 500 | **38** | 894 | `014` R7-07 |
| Before this pass (after the killed pass landed) | 363 | **190** | 1,055 | `pnpm check:citations`, this session |
| Peak, after this pass's own new material | 347 | **206** | 1,062 | mid-pass |
| **After** | **482** | **80** | 1,076 | `pnpm check:citations`, this session, at `ceeda54` |

> **The "after" row moved twice while it was being written**, because two other agents committed into
> `packages/` during this pass (`7d4b8a8`, `4ec04a6`, and J03's round-7 fixes). The stale count went
> 475/80 → 484/86 → 482/80 with **no document edited between the first and second reading**. That is
> R7-13 with a number on it. **Take this row as a shape, not a constant:** *every stale citation is in
> a document this job may not edit, and none is in one it may.* That statement survives the tree
> moving; the integer does not.

**All 80 are in documents this job may not edit**: `006` (63), `014` (13), `008` (4). **Zero remain in
any document it may.** The CI ratchet is `--max-stale=34` (`ci.yml:57`), so **CI is still red on
`main`** — and it cannot go green without R7-08, because 63 of the 80 are in `006`. That is stated
rather than worked around: the ratchet must never go up (`ci.yml:51-54`), and raising it is how a
checker becomes decoration.

### 4.2 Why 33 became 190 — and it is mostly not what the commit message said

The killed pass's own commit message blames itself: *"the new material added citations faster than
they were verified."* **That is a third of the answer, and the smaller third.** Decomposed by measuring
stale counts **per document** and separating documents the killed pass touched from documents it did
not:

| Cause | Evidence | Share |
|---|---|---|
| **Code moved under every document at once.** J03's four `packages/` commits (`ee8c1cf`, `ff7924b`, `e80f0d3`, `2772a01`) inserted lines throughout `huddle/index.ts`, `speech-service.ts`, `main.ts` and `os-synth/index.ts`. Every line-pinned citation in the repo drifted together | at the before-reading, **143 of the 190 were in documents the killed pass never opened** — `006`, `005`, `004`, `003`, `008`, `002`, `009` and the research files | **~75 %** |
| New material in `010`–`013` citing a tree that had already moved | 47 stale across `010` (18), `012` (30 — up from a verified 0), `013` (1) | ~25 % |

**This is R7-13 arriving as a fact rather than a warning**, and it happened again *during* this pass:
`7d4b8a8` landed in `packages/` between two of this job's own commits, and the same anchor moved from
`main.ts:152` to `:162` between two readings with no document edited in between. **A stale count taken
while another agent is writing to `packages/` is not a property of the documents.** The durable answer
is not a number — it is the **symbol**: `004` Panel E's *"cite a symbol plus the line"*, and a
re-derivation that is one command:

```
CITATION_LOCKED='docs/design/006-fma.md,docs/design/007-user-stories.md,docs/design/008-crossreview-round3.md,docs/design/014-review-round7.md' \
  node scripts/check-citations.mjs --fix
```

`CITATION_LOCKED` keeps `--fix` off the record. **Run it when the tree is quiet, and re-read the diff:**
`--fix` handles only unique anchors, and its refusal on multi-occurrence anchors is a feature — see 4.4.

### 4.3 The false positives, and how each was distinguished from a real one

**A real one moves the reader to the wrong place. A false one moves nothing.** The test applied to
every flag was: *open the cited file at the cited line and read it.* Four shapes came out.

| Shape | Example | Treatment |
|---|---|---|
| **Genuine drift** — the symbol is real, the line moved | `os-synth/index.ts:240` for `SIGKILL`, now `:298` | re-anchor on the **declaration**, not the first use | <!-- citation-check: ignore --><!-- why: this ledger QUOTES citations as examples of the four shapes in section 4.3 - a wrong number here IS the illustration. Re-anchoring it would delete the example. Same class as 014's declared self-citations. -->
| **Path inheritance** — a bare `:NN` inherits the *preceding* path, so it is checked against a file the prose never names | `003` section 8.7's `:1283-1296` checked against a research file; `speechd`'s `parse.c:424-680` checked against `os-synth` | `citation-check: ignore`, with the reason in a second comment | <!-- citation-check: ignore --><!-- why: illustrative quotation, section 4.3 -->
| **Anchor mis-pairing** — the line carries several symbols and one anchor per citation, so the tool pairs them wrongly and calls a correct row stale | `010`'s six `contract.ts` pointers all read as citations of `CANCEL_BUDGET_MS`; `009`'s two rows | **restructure the prose** — one claim per line, each carrying its own symbol — and only where that is impossible, `ignore` with the hand-verified mapping written into the marker |
| **Deliberate quotation** — the document quotes a stale citation *as the finding* | `010`'s R7-21 block quoting `005`/`006`'s wrong `:366`; `014`'s six declared self-citations | `ignore`. Re-anchoring it would delete the defect it reports | <!-- citation-check: ignore --><!-- why: this ledger QUOTES citations as examples of the four shapes in section 4.3 - a wrong number here IS the illustration. Re-anchoring it would delete the example. Same class as 014's declared self-citations. -->

**Two named-in-advance false positives were protected**, and the protection failed the first time —
see 4.4: `plugin-host-api.ts:261-265` and `orca-runtime.ts:39794-39810`, which `009` E-01 records as
correct at the pinned ORCA commit with the instruction *"Do not 'fix' them."* Both now carry a working
marker **on the citation itself**, so the decision no longer lives only in another document's prose. A
false positive that must be re-litigated every round is a broken indicator.

### 4.4 What went wrong in this pass, recorded because it is the useful part

**The first set of `ignore` markers did nothing, and one of them let real damage through.** They were
written with the reason inside the comment; the tool matches
`/<!--\s*citation-check:\s*ignore\s*-->/` and nothing may sit between `ignore` and `-->`. So the
markers parsed as prose, `--fix` ran, and it rewrote `plugin-host-api.ts:261-265` → `:144-148` — the
one citation the repo had explicitly written down as *do not touch*. Reverted; markers repaired;
**`PITFALLS` P35** records it.

The lesson is not about this tool. **A suppression you added and did not re-measure is a comment
addressed to a human, and the machine never read it.** The marker was present; the effect was absent.

`--fix`'s refusal to guess between multiple occurrences also earned its keep. Four citations were
re-anchored **by hand against the tool's own suggestion**, because the tool's anchor and the prose's
subject were different symbols: `prepare()` is `os-synth/index.ts:273`, not the `listVoices()` call
inside it at `:277`; `#command()` is `:428`, not the `$s.Speak` line; and `009`'s `#highWater` is
`:138`, not `HUDDLE_HIGH_WATER_KEY`'s `:68` — which is finding R7-12 itself. **A citation that passes
while pointing somewhere else is worse than one that fails**, and one nearly shipped: a bare `:NN` in
`012` was inheriting `speech-service.ts` while the prose discussed `huddle/index.ts`, and a naive
re-anchor would have turned it green against the wrong file. It is now written out in full.

---

## 5. `PLAN.md` and `TASKS.md` — verified, not assumed

The killed pass reached both and left no record, so each debunked claim was re-checked by grep.

| Must no longer say | Probe | Result |
|---|---|---|
| the inter-chunk gap is process spawn | `grep -n spawn docs/PLAN.md docs/TASKS.md` | **clean.** Every surviving mention is inside a dated correction: `TASKS.md:219` *"not the process spawn — spawn is 2.3 ms of it, the temp file 0.33 ms, ~893 ms is the device"*; `PLAN.md:54-55` *"a fix that stops spawning a player per chunk recovers 0.25 % and alters nothing a listener hears"* |
| M9 justified by neural-engine latency | `grep -n neural` | **clean.** `TASKS.md:217` quotes the old sentence *inside* the amendment that withdraws it; `PLAN.md:40` scores the two rungs separately, which is R7-03's resolution |
| the unsupported `927 ms` first-audio figure | `grep -n 927` | **zero hits in both files** |
| the `140 ms` earcon | `grep -n '140 ms'` | **zero hits in both files** |
| the *"414 ms spawn leaves 86 ms"* arithmetic | `grep -n '86 ms'` | **present, and correctly so** — `PLAN.md:80-81` quotes it as the withdrawn claim and says *"There is no 86 ms"*, which is `010`'s amendment discipline: leave the falsified reasoning visible (R016) |

**Both files are fixed.** The distinction that matters and that a bare grep would get wrong: a
debunked number appearing inside a note that withdraws it is the *record of the correction*, not the
error surviving. Deleting those quotes would hide the work, which is the rule `009` opens with.

