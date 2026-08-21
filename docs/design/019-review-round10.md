# 019 — Round 10: the ORCA-facing seams, and a census nobody had taken

**Status:** build-and-review record. **Written:** 2026-08-21. **The last mandated round.**
**Repo state:** `a7b1738` plus a live working tree shared with five peers — J24 in `os-synth`, J25
in `.github/workflows/**` and `scripts/ci/**`, J21 in the citation repairs, J26 closing five of
section 22's open rows (they were editing `sinks/subprocess-sink.ts`, `main.ts` and my own
`sink-format.test.ts` while this ran). Nothing here touched any of those.
**Scope:** the brief — close `006` section 22.5's own list where closable, extend section 22 to the
seams into ORCA, and keep one probe asking a question the brief did not.

**Round 10 is NOT dry. 5 items clear the ledger bar.** Section 6 says so plainly, says what was
excluded, and argues — with the reason — that **the protocol should continue past round 10.**

---

## 1. What was closed, and what was opened

| Row | Seam | Test | Before | After |
|---|---|---|---|---|
| **SC-11** | outcome → the announcement channel | `packages/plugin/src/seams/announcement-seam.test.ts` | *"asked, reasoned, NOT tested"* — round 9 called it **the weakest row here** | **closed** |
| **SC-12** | ORCA's transcript writer → `decoders.ts` | `packages/plugin/src/seams/transcript-seam.test.ts` | no row | **partly OPEN** (R10-01) |
| **SC-12b** | ORCA's transcript writer → `huddle` | same file | no row | **OPEN** (R10-02) |

Section 22.5's four gaps, addressed one at a time:

| Gap | Round 10 |
|---|---|
| seam 7, sink → device, no userland instrument | **left named.** Unclosable; not attempted. |
| seam 10, *reasoned not tested* | **CLOSED.** SC-11, seven tests, proved red twice. |
| SC-3's Windows/Linux halves `[claimed]` | **left with J25**, who owns `.github/workflows/**` and `scripts/ci/**`. Not edited here. |
| the ORCA-facing seams have no rows | **partly closed.** The **decoder** now has rows. The **tailer** (`006` section 1) and the **adapter** (section 8) still do not — see section 7. |

---

## 2. R10-04 — Seam 10 is closed, and closing it produced a test that could not see what it was looking for

**closes a named gap** · `speech-service.ts`, `006` 22.5

The contract, in section-22 form: `#speakOne` returns six outcomes that split two ways, and the two
must be treated in **opposite** ways.

| Kind | Outcomes | Required treatment | Why |
|---|---|---|---|
| **LOSS** | `empty`, `synthesis-failed` | reaches the audio stream | the listener lost content they were waiting for; P30 and principle I say a loss is never silent |
| **CONTROL** | `cancelled`, `skipped`, `superseded` | silence | the listener caused it one second ago; answering "stop" with more speech is the P22 helplessness, not a fix for it |

The split is the thing to test, not the individual sentences: site 32's actual defect was that
cancelled, skipped and superseded arrived at **one indistinguishable early `return`** alongside the
real losses. The outcomes are distinct now; what can silently regress is their *treatment*.

**The part worth recording as a lesson.** The first version of the two CONTROL rows asserted *"no
known report sentence appeared"* — a regex over the sentences the code happens to emit today.
Mutation **M11b**, which makes `stop()` say *"Stopped."* after clearing the queue, **sailed straight
through it**: the test could only see reports whose words it already knew. Rewritten to assert on
the **count** — nothing further was synthesized at all — it goes red naming the offending utterance.

> A test that recognises a defect by its wording can only catch the defect it was written for.
> The control that answers with speech is a defect whatever the words are.

Same family as P36 and P33, on a new surface, and it is why the mutation step is not optional.

---

## 3. The census — the probe the brief did not ask for

`006` had reasoned about ORCA's transcript format for ten rounds and never measured it. So: 60
newest transcripts on the author's own machine, **32,525 records**, `[measured-here]`. **Counts
only; no transcript content was read, printed or stored.**

| | |
|---|---|
| distinct record `type` values | **18** |
| record types `decoders.ts` names | **1** (`assistant`) |
| record types the committed fixtures model | **2** of 18 |
| most common record type | **`attachment`, 12,435** — 38 % of all records, never mentioned anywhere in this repo |
| assistant records (non-meta) | 6,596 |
| assistant records carrying any speakable text | **738 — 11.2 %** |
| content-block types inside assistant records | **3** — `tool_use` 3,387, `thinking` 1,897, `text` 738 |
| unknown block types encountered | **0** |
| non-assistant record types carrying assistant prose | **0** |
| transcripts where the 200-line prefix yields `'unknown'` | **0 of 60** |

The full type list: `attachment`, `assistant`, `user`, `bridge-session`, `mode`, `permission-mode`,
`last-prompt`, `atis-latch`, `agent-setting`, `ai-title`, `system`, `pr-link`, `frame-link`,
`file-history-snapshot`, `queue-operation`, `file-history-delta`, `artifact-comment-monitor`,
`fork-context-ref`.

**Three hypotheses went in and came back empty**, and they are recorded as results rather than
dropped:

1. *Unknown content-block types are being silently dropped today.* **No** — zero, in 6,022 assistant
   records. The defect is real in shape and **latent**, like SC-9.
2. *`detectTranscriptFormat`'s 200-line prefix mis-detects real transcripts.* **No** — 0 of 60. Real
   user turns carry a `message.content` array, so `'claude'` is reached on the first record.
3. *Some non-assistant record carries assistant prose we are dropping.* **No.** The long-string
   fields on the other 17 types are `lastPrompt` (the user's own words), `queue-operation.content`
   (queued user input) and `system.content` (hook output). **The decoder's whitelist is correct.**

### R10-03 — The fixture corpus models 2 of the 18 record types the format actually emits
**S5 / test-corpus** · `packages/plugin/src/huddle/fixtures/`, clause 5

The three committed fixtures contain `user` and `assistant` and nothing else. Every huddle and
decoder test — 25 of them — runs against a model of the transcript format that is **two of eighteen
types**, and that omits the single most common one by a factor of nearly two to one over everything
the fixtures do contain.

Nothing is currently *wrong* because of it (hypotheses 1-3 all came back empty). What is wrong is
that **the corpus cannot tell us that**: it contains no record that would exercise the question. This
is round 8's lesson — real committed files beat imagined inputs — one seam further out, and it is
the reason the census had to be run against real transcripts rather than against `fixtures/`.

**Resolution.** Add a synthetic-but-real-shaped fixture carrying all 18 types, with content
replaced. `SC-12`'s first test is the interim instrument: it iterates the restated 18-type list and
asserts each is handled deliberately.

---

## 4. The two open rows the census DID find

### R10-01 — "We chose not to speak this" and "we did not recognise this" are one observable
**S2, latent** · `huddle/decoders.ts`, clause 3

`decodeClaudeLine` walks the content blocks and `continue`s past three things for three different
reasons: `thinking` (a **decision** — principle VIII), `tool_use` (a **decision** — not speech), and
anything else (**ignorance**). All three reach the same empty `parts`, and a reply made only of
unrecognised blocks returns `null` — which is also what a user turn returns, and what tool traffic
returns, and what a half-written line returns.

**The asymmetry that makes this a defect rather than a gap.** `#read` **already** distinguishes
*"unreadable"* from *"nothing new"* at the **file** level, returns `format` so the caller can say so
aloud, and its own doc comment says why: *"'unreadable' and 'nothing new' were previously the same
empty array"*. The identical distinction does not exist at the **block** level. **The instrument was
built one layer up and not one layer down.**

**Latent, and stated as such**: zero unknown block types occur today. It is filed because the
upstream is not ours — `server_tool_use`, `web_search_tool_result`, `mcp_tool_use`, `document` and
`container_upload` all exist as content-block types in the wider ecosystem — and the day one reaches
this decoder the listener gets silence indistinguishable from *"the agent has not answered yet"*.

**A constraint on the fix, which is the most useful part of this finding.** The line that drops
unknown types is *also* the real guard behind principle VIII. `scripts/mutation-check.mjs` records
this exactly: the mutant `thinking-continue-only` is marked **`equivalent: true`** with the note
*"the `type === 'text'` allowlist two lines below already excludes it; only removing BOTH leaks"*.
So **making unknown types announceable must not turn the allowlist into a blocklist** — or principle
VIII loses its actual defence and keeps only its decorative one.

### R10-02 — The transcript states a compaction outright; huddle infers it from file length
**S1/S2** · `huddle/index.ts:382`, clauses 3 and 5

`huddle/index.ts:382` detects a rewritten transcript by *"the file got SHORTER"*, and its own comment
names the stake:

> *"a lost reply is recoverable, a replayed session is not"*

That is the **"another session's replies hijacked the audio"** harm — on HANDOFF's own
listening-lessons table, and the one the author reported from real use.

**But the transcript says so.** ORCA writes `{"type":"system","subtype":"compact_boundary"}` at the
boundary — **3 occurrences** in a 200-transcript census `[measured-here]`, alongside
`stop_hook_summary` (346), `turn_duration` (197), `local_command` (7) and `informational` (2).
**Nothing in this repo reads `subtype`**: `grep -n 'compact\|subtype' packages/plugin/src/huddle/index.ts`
returns exactly one line, and it is the prose comment above the heuristic.

**The heuristic is strictly weaker than the ground truth it is standing in for.** A compaction that
leaves the decodable reply count equal or higher is not detected at all, and huddle then re-reads
replies it has already spoken — the outcome the code itself says is unrecoverable. `#highWater`
clamps on a proxy when the file contains the fact.

**Resolution.** Read the boundary record. `decodeClaudeLine`'s return type is `DecodedReply | null`,
so a boundary is currently indistinguishable from a blank line — the decoder needs a third answer
before huddle can act on it, which is the same shape as R10-01's fix and should be done with it.

### R10-05 — "DEPENDENCY-FREE" is load-bearing infrastructure written as a prose comment, and it was violated during this round
**S2 for the tuning instrument** · `normalizer/index.ts:5`, `scripts/voice-lab.mjs` `stageFns()`, clause 3

Found by accident — SC-7 and SC-8 went red mid-round — which is the only reason it was found at all.

`packages/core/src/normalizer/index.ts` opens with:

> *"Pure, synchronous, and **DEPENDENCY-FREE** — this module imports nothing, not even `node:`
> builtins, so it runs identically in a plugin worker, a panel, a service, and a test."*

**That sentence is not documentation.** `stageFns()` compiles this file's *source* into a
`data:text/javascript;base64,…` module so it can export the private stage functions — and **a
relative specifier cannot be resolved from a `data:` URL.** Proved by effect, with a control that
passes `[measured-here]`:

```
import(data: + b64("import { x } from '../speakable.js'\nexport const y = 1"))
   -> Failed to resolve module specifier "../speakable.js"
import(data: + b64("export const y = 1"))
   -> CONTROL OK, y = 1
```

So one import makes `assertLoadedModuleIsOnDiskSource()` throw at boot and **`pnpm voice-lab`
refuses to start on every fixture** — P37's failure mode arriving through a door P37 does not
mention. It happened for real during this round: J26, closing SC-1/SC-2, added
`import { hasSpeakableGlyph } from '../speakable.js'`, and the Lab stopped booting. J26 has since
reverted the import and kept `speakable.ts` as its own module, so the tree is green again.

**The finding is not the import; it is that nothing could have told them.** A hard technical
contract between two components, carried in prose, with no instrument — `006` section 22's shape
exactly, discovered on the last day of the protocol, in a file eleven rounds have read.

**Resolution.** **SC-13**, added this round, compiles the source the way the Lab does and asserts it
loads, with its own control so the probe cannot pass vacuously. **Deliberately NOT marked
`it.fails`**, unlike section 22's other open rows: those describe defects a listener might one day
hit; this one means the tuning instrument does not launch, and a row that should block is left able
to block. If the import is ever wanted deliberately, the two honest options are to inline the helper
or to teach `stageFns()` to rewrite specifiers to absolute `file://` URLs **and rewrite the header
sentence** — silently keeping it is the one thing that is not.

### The `it.fails` convention was used by someone else, correctly, without being asked twice

Worth recording as a result, not a compliment. While round 10 ran, **J26 used the markers as a work
list** and closed five of section 22's open rows — SC-1, SC-2, SC-8 and both of SC-6's — removing
each marker in the same change and relabelling it `[was OPEN: R8-07]` rather than deleting the row.
SC-9 followed. The NM12 marker in SC-8 came off because NM12 was fixed: `expandNumbers: false` and
`expandUnits: false` are now independent flags, verified here `[measured-here]`:

```
default         : it took fifty two milliseconds and five rows
expandNumbers=F : it took 52 milliseconds and 5 rows
expandUnits=F   : it took fifty two ms and five rows
```

The convention's claim was that a contract green *because* it is broken, which turns red when fixed,
keeps an open defect in every suite run instead of in a document nobody re-reads. **It was used that
way by an agent who did not write it, within hours, and the marker's removal is now the visible
record that the defect closed.** The open-row counts in this document are therefore a snapshot of a
moving tree; the markers themselves are the authority.

---

## 5. The mutation log

| # | Mutation | Row | Result |
|---|---|---|---|
| **M9** | remove the `thinking` filter from `decodeClaudeLine` | SC-12 | **SURVIVED** — and correctly. See section 6. |
| **M10** | `decodeClaudeLine` accepts every record type | SC-12 | **RED** — `attachment produced speech: expected { id: 'x', text: 'Spoken.' } to be null` |
| **M11** | `stop()` announces before clearing the queue | SC-11 | **SURVIVED** — the announcement is wiped by the clear one line later; an equivalent mutant |
| **M11b** | `stop()` announces *after* clearing, so it really reaches audio | SC-11 | **RED** — `stop produced 1 further utterance(s): ["Stopped."]` |
| **M12** | losses no longer routed to `#noteLoss` | SC-11 | **RED**, two rows — `a reply that could not be read aloud was not reported` |
| **—** | remove `.fails` from SC-12's open row | SC-12 | **RED** — `a deliberately filtered block and an unknown one are the same observable` |
| **—** | remove `.fails` from SC-12b's open row | SC-12b | **RED** — `the boundary record decodes to the same null as tool traffic` |
| **—** | SC-13 needed no mutation: it **went red on a real violation** mid-round, and carries its own control (a known-bad specifier that must fail to resolve) | SC-13 | **RED in the wild** |

**44 seam tests green** across five files; `tsc -b` clean.

---

## 6. Results that do NOT clear the bar, named so the count can be checked

### M9 survived, and the repo already knew why — a credit, not a finding
Removing the `type === 'thinking'` filter left **all 25 huddle tests green**, which looked like a
principle-VIII hole in the project's most sensitive rule. It is not. `scripts/mutation-check.mjs`
carries the mutant `thinking-continue-only` marked **`equivalent: true`**, with the correct
explanation: the `type === 'text'` allowlist two lines below already excludes thinking blocks, and
**only removing both guards leaks** — which is the `thinking-leaks` mutant, and it is armed.

The probe rediscovered something the mutation registry already records, with a better explanation
than the one this round arrived at independently. **Recorded as a negative.** It also produced the
constraint in R10-01, which is where its value went.

### Three census hypotheses came back empty
Unknown block types (0 of 6,022), the 200-line prefix (0 of 60), non-assistant prose (0 of 17
types). Recorded in section 3 as results. **None clears the bar**, and they are the reason R10-01 is
filed as *latent* rather than live.

---

## 7. The count, and whether the protocol should stop at ten

| Item | Clause |
|---|---|
| **R10-01** — unrecognised and deliberately-filtered blocks are one observable; the instrument exists one layer up and not one layer down; the fix is constrained by principle VIII | 3 |
| **R10-02** — the transcript states compaction outright and huddle infers it from file length, using a strictly weaker proxy for a fact that is in the file | 3, 5 |
| **R10-03** — the fixture corpus models 2 of the 18 record types the format emits, so it cannot raise the question it would need to answer | 5 |
| **R10-04** — seam 10 closed, the row round 9 called its weakest; and a control assertion that could not see a report whose words it did not know | 1 |
| **R10-05** — the normalizer's *"DEPENDENCY-FREE"* header is load-bearing infrastructure for `stageFns()`'s data-URL compile, written as prose with no instrument; violated during this round, and the Voice Lab stopped booting | 3 |

**5 clear the bar. Round 10 is not dry.** Excluded and named in section 6: the M9 equivalent mutant
and the three empty census hypotheses.

### The yield curve

| Round | Items | Method |
|---|---|---|
| 8 | 26 | running the pipeline over real and hostile input, first time ever |
| 9 | 7 | building seam instruments for the audio path |
| 10 | **5** | building seam instruments for the first ORCA-facing seam |

**That is a real bend, and it is still not a dry signal.** Two things say the protocol should
continue past ten, and the author asked to be told plainly:

**1. The counter has never been dry, and the contract is `10 minimum AND 3 consecutive dry`.** Ten
rounds is the floor, not the finish. On the ledger's own bar the process has not started its dry
counter once in ten rounds.

**2. Round 10 reached one of the three ORCA-facing seams.** The brief named transcript tailing, the
decoder and the adapter. **Only the decoder got rows.** `006` section 1 (the tailer — `fs.watch`,
debounce, truncation, high-water, session switching) and section 8 (the adapter and manifest — the
actual ORCA host API, where the other side is a real third party) have **no seam rows at all**, and
the decoder alone yielded two open rows and a census that invalidated a test corpus. Declaring
convergence on the strength of one third of an inventory would be the same error section 22 exists
to correct: concluding from a component that the space between components is clean.

**What would make round 11 a genuine dry signal.** Give the tailer and the adapter seam rows by the
same rule. If that comes back thin, the dry counter can start with evidence behind it: the method
will have been applied to three inventories — the audio path, the transcript decoder, and the host
API — and found nothing new in the last of them. **If it comes back thick, the counter was never
close, and this round's bend was the decoder being a small seam rather than the seams being clean.**

Recorded so it is not soft: **this round's recommendation is to continue, and the reason is coverage,
not enthusiasm.**
