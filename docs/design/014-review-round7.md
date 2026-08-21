# 014 — Adversarial review, round 7

**Status:** review record. **Written:** 2026-08-21. **Reviewers had no session context** and wrote
none of the documents under review.
**Repo state:** clean-`HEAD` measurements taken at `9c36dcc` in an isolated `git worktree`, because
the live tree was mutated by concurrent agents throughout this review — see **R7-13**, which is
itself a finding.
**Scope:** `009`–`013`, the amended `002`–`005`, and — because this is where the round's yield
concentrated — `docs/PLAN.md`, `docs/TASKS.md`, the constitution, the memory files, and `packages/`
wherever a document cites it.

**What this document is.** The record of what round 7 found. It edits nothing it reviews; other
agents reconcile. Every claim carries `path:line`; every latency number carries an R006 label.

**Round 7 was not dry. 31 items clear the ledger bar.** The count and its shape are in section 7,
and the shape matters more than the number.

---

## 1. Did reconciliation actually reconcile? — Yes, and it should be said first

`009` claims eight blocking findings and six cross-document conflicts were resolved by amending
`002`–`005` in place. Eight claims were sampled and opened in the amended documents:

| `009` claim | Verified at | Verdict |
|---|---|---|
| **X-01** nonce handshake, `enter: false` | `003:195`, `003:305`, `003:1539` | **landed; says what the ledger says** |
| **X-02** `\x1b]777;orca-tts;…\x07` framing, two-state reader | `003:258`, `003:274` | **landed** |
| **X-03** one earcon table, owner `packages/core/src/earcons/` | `005:562`, `005:565`, `005:586`, `005:599`; consumed at `003:530`, `004:747` | **landed, and consumers really do cite rather than mint** |
| **X-04/C4** call-sign primacy to `005`; `003` owns the display chain | `003:891` | **landed** |
| **X-07** H24/H25/ordinals were already-closed defects | `004:304`, `004:386`, `004:387`, `004:391` | **landed, all four rows** |
| **X-09/C1** one keyboard vocabulary | `003:731`, `003:754`, `003:768`, `003:786` | **landed** |
| **B-01** the 301st reply | `003:1043`; `#highWater` `huddle/index.ts:97`, key `huddle/index.ts:42` | **landed in doc and code** |
| **C3** queue cap 8 | `004:411`, `003:1306` | **landed in documents — see R7-06 for the code** |

**No sampled claim was false.** A reconciliation ledger surviving a hostile sample of eight is an
unusual result; weight it accordingly. Two small defects remain: `009`'s own citation is stale
(**R7-12**), and its stated refutation criterion is met but not against the documents it was written
about (**R7-07**).

**Consequence for rounds 8–10: do not re-read `002`–`005`.** They produced one finding between them.
The yield is elsewhere, and section 7 says where.

---

## 2. The measurement fold, and the documents nobody folded

### R7-01 — M9 has no task and no gate for the only thing P32 says it must do
**blocks-implementation** · `TASKS.md`, `HANDOFF.md`, `STATE.md`, `010`, P32

The fold corrected every **diagnosis** and never changed the **plan**.

`010:46-47` states the success condition without ambiguity:

> *"M9's success condition is **the device stays open across chunks**, and the test for it is a
> gap-to-audio ratio, not a spawn count."*

`TASKS.md:202-217` is Phase M9: T090 service skeleton, T091 Piper, T092 model manager, T093
warm-on-start, T094 `ServiceProvider`, T095 degradation ladder, T096 kill-mid-utterance, T097 latency
benchmark. **Every one is about synthesis. There is no playback or sink task in M9 at all** — a grep
for `sink|playback|player|device open|gap` across `TASKS.md` returns only shipped tasks, `T103`
`PanelSink` (dormant on upstream #15638), and unrelated senses.

**Gate M9** (`TASKS.md:217`): *"T097 reports measured first-audio under 500 ms on each OS; T096
green."* First audio is the **first** chunk; the gap is **between** chunks. **Gate M9 passes with the
~950 ms gap fully intact** `[measured-here]` (p50 950/937/897 ms, n=18 ×3, `latency-measurements.md`
1.1) — a gate that cannot fail for the thing its milestone exists to fix, which is the shape the test
audit just spent a round removing from the cancel path.

`HANDOFF.md:180` still calls M9 *"the only thing that meets the latency budget"*; `STATE.md:68` says
M9 fixes the gap *"only if it holds the device open"* — a conditional nothing satisfies or checks.

**Resolution.** Add an M9 task that holds one device open across chunks; re-gate M9 on the ratio
`010:47` names, per OS, failing above a stated bound. Until then P32's warning is live: *"that fix
would have shipped and changed nothing a listener could hear"* (`PITFALLS.md:52-53`).

### R7-02 — The inter-sentence budget is unenforceable at every level, so "finished" is declarable with it violated 19×
**blocks-implementation** · constitution, `PLAN.md`, `TASKS.md`, CI, the suite

`constitution.md:112` — *"Standing constraints, not aspirations. A change that regresses one is a
bug."* Row four (`constitution.md:119`) sets the inter-sentence gap at **< 50 ms**. Measured: ~950 ms
`[measured-here]` — **19×**. What enforces it:

| Layer | Enforces? | Evidence |
|---|---|---|
| `PLAN.md` DoD | **no** | `grep -c gap docs/PLAN.md` → **0**; seven items at `docs/PLAN.md:16-25`, none mentions it |
| `TASKS.md` | **no** | R7-01 |
| CI | **no** | `ci.yml:36-76` — typecheck, lint, test, build, citations, mutants, size-gate |
| the suite | **no** | `grep -rn "gap\|interSentence" packages --include='*.test.ts'` → **zero** |

And `constitution.md:317-319`: *"The project is done when every Definition of Done item in
`docs/PLAN.md` §1 is **observably** true."* **The project can therefore be declared finished while
the constraint `HANDOFF.md:120` calls "the sharpest constraint in the project" is violated 19×.**
R073 has no instrument here.

Two secondary defects in the same table: `~970 ms` and `~15 ms` are the only latency numbers in the
repo with **no R006 label**, in the document that mandates R006 (`constitution.md:75`); and
`afplay`**-per-file** is the P32-debunked attribution. The header still reads *"Last Amended:
2026-08-20"* — the fold never reached it.

**Resolution.** Add a gap item to `PLAN.md`'s DoD; label both numbers; correct `-per-file` to
`-per-device-open`; bump the amendment date. The gate is R7-01.

### R7-03 — `PLAN.md` was never folded, and its DoD now contains an item measurement has proven unachievable
**blocks-implementation** · `PLAN.md`, P32, `010`, `STATE.md`

`PLAN.md:20-21`, a Definition-of-Done item: *"First audio lands under 500 ms … **under 500 ms via the
OS synthesizer when the service is cold or absent**."*

`010:36` (fact F4): a real sentence through `OsSynthProvider.generate()` costs **p50 1,163 / 1,054 ms,
min 900, n=9 ×2** `[measured-here]`. Synthesis alone, playback at zero, is 2.1× the whole budget.
**That clause is not achievable and is now known not to be.** `STATE.md:33` states this correctly;
`PLAN.md` — the document the constitution defers to for *finished* — was never updated. **The
Definition of finished contains an item that can never become observably true.**

`PLAN.md:38` compounds it: *"except the 500 ms budget on macOS (**414 ms spawn leaves 86 ms**)"*.
There is no 86 ms.

**Root cause, worth recording as such.** P32's propagation list (`PITFALLS.md:54-56`) names *"HANDOFF,
STATE, the constitution, `architecture.md` and designs 004, 005, 006, 007 and 010"*. **It omits
`docs/PLAN.md` and `docs/TASKS.md`** — the documents that define done and schedule the work. Round 6
folded exactly the list it was given. **That incomplete list produced R7-01, R7-02 and R7-03
together**, and is the single highest-leverage fix in this review.

**Resolution.** Split `PLAN.md`'s first-audio item to score Piper and the OS-synth fallback
separately, as `STATE.md:33` already does; fix `docs/PLAN.md:38`; extend P32's list to name `PLAN.md` and
`TASKS.md`.

### R7-08 — `006-fma.md` was exempted from the fold as "the record", but it is a live deliverable carrying two debunked claims and a wrong severity
**needs-a-decision** · `006`, P32, `005`, `009`

`009:20-22` declines to edit `006`, `007`, `008`: *"the record of what was found… Rewriting the record
hides the work."* **Correct for `008`**, a review record. **Wrong for `006`**, a failure-mode analysis
milestones are built against, which P32 explicitly names.

1. **CK2** (`006:116`) — *"the ~970 ms per-chunk **process** gap (`plugin/src/sinks/subprocess-sink.ts:8-10`)"*
2. **VL2** (`006:249`) — same phrase, same citation

Both cite a header that, since round 6, says the **opposite**:

> `subprocess-sink.ts:8-10` — *"**NOT process spawn (2.3 ms) — it is CoreAudio device open/teardown,
> ~893 ms.** So M9 must hold the DEVICE open across chunks."*

This is the citation class `check:citations` structurally **cannot** catch: file exists, lines exist,
they say the reverse. Only a reader catches it.

3. **ID12** (`006:290`) — *"60 + 20 + 60 = **exactly 140 ms**, which is the stated cost"*, consequence
   *"eats a measurable slice of the ~500 ms budget"*, severity **S4**.

`005:622` measures the earcon through the shipped sink at **p50 874 / 862 ms** `[measured-here]`
(n=10 ×2) — **6.2× the arithmetic, 174 % of the entire budget.** ID12's severity is wrong by the
project's own measurement. `005` was amended for exactly this (`005:15-19`); `006` was not. `006:3`
also says *"145 tests green"* (actual 186).

**Resolution.** Give `006` the dated amendment note `004` and `005` got — that **adds to** the record
rather than rewriting it, which is the distinction `009`'s rule was reaching for.

### R7-07 — `pnpm check:citations` is red on `main`; the CI ratchet is breached
**blocks-implementation** · CI, `006`, `010`, `003`

Clean `HEAD` `9c36dcc`, isolated worktree: `500 verified · **38 stale** · 894 unanchored`, exit **1**.
`ci.yml:57` runs `--max-stale=34`, and `ci.yml:51-54` says: *"It must never go up: raising it is how a
checker becomes decoration."* **38 > 34: CI is red on `main` now.** R050, R067.

| File | Stale |
|---|---|
| `docs/design/006-fma.md` | **26** |
| `010` | 4 |
| `003` | 3 |
| `fix-round4-report.md` | 2 |
| `008`, `009`, `002` | 1 each |

**None in `004` or `005`** — `009`'s re-derivation held. Its refutation criterion (`009:114`) is met
in letter, not in spirit.

**Resolution.** Re-derive `006`'s 26 (R7-08 opens that file anyway), then lower the ratchet in the
same commit. Never raise it.

> **This document's own contribution, declared rather than hidden (R016, R085).** Adding `014` moves
> the clean-`HEAD` count from **38 to 44**. All six are citations that **quote a defect this review is
> reporting** — `012`'s `main.ts:96` (R7-37), `009`'s `huddle/index.ts:97` (R7-12), `010`'s
> `speech-service.ts:403-404` (R7-17) and similar. They are stale *because that is the finding*, and
> they should be re-derived only when the defect they name is fixed, not before. The baseline against
> which the ratchet should be judged is **38**, not 44.

---

## 3. `010` — provider seam v2 and the resident service

**Verdict up front: this is the strongest document in the repo.** Every number checked is correct
(F4, F5, the 874/862 ms earcon, the 1,112–2,017 ms bracket, ~3 ms kill-to-exit with its "not
audio-stop" caveat, 487/472 ms `listVoices()`, 55,050 frames / 9-of-9 word callbacks, P16's quote).
Its amendment discipline — withdrawing two load-bearing claims **in place**, naming the finding that
forced each, leaving the falsified reasoning visible (`010:636-642`) — is a model. And it **absorbs
all four queued C-05 seam extensions**, verified individually: 005's `identity` (`010:348`,
`010:248-254`), 005's `pitchSemitones` (`010:174`), 003's `pause()`/`resume()` (`010:316-317`), 004's
`chunk.format` (`010:143-155`), plus the earcon's format (`010:367-390`) — and adds word events and
SSML with platform evidence. **"The seam changes once" survives.** No `927 ms`; no misuse of the
debunked `140 ms` or `~970 ms`.

### R7-15 — Section 8 says the OS-synth rung can never meet R4.2; section 8.2 says it probably can — and M9a's ship gate depends on which
**blocks-implementation** · `010` sections 8, 8.2, 10, 12.1

- `010:572-573` — *"R4.2 … is **unreachable on the OS-synth rung by any amount of residency or playback work**."*
- `010:624` — *"**Yes on macOS, very probably**; and the claim is one probe away from being settled."*
- `010:768-769` — M9a is *"**gated on** SPIKE-1 **and on first audio under 500 ms per OS**."*

If `010:572` holds, M9a's gate is unreachable by construction and M9a cannot ship. Fifty lines apart,
never compared — the P33 shape. The categorical sentence is the over-reach: F4 measures `say -o
file.wav`, which returns only when the **whole** WAV is written, bounding total synthesis, not
first-buffer. `010:643-647` says so correctly and concludes first-buffer is `[claimed]`, plausibly
100–400 ms.

**Resolution.** Narrow `010:572` to *"unreachable on the spawn-per-utterance `say -o` path; unknown on a
resident streaming OS-synth, pending SPIKE-1"*; downgrade `010:624` to "unknown"; restate `010:974` as
*"the only rung on which the gate is currently known to be meetable"*.

### R7-17 — `AudioChunk` changes shape, `PlaybackSink` is never respecified, and rung 1 is called a pure refactor
**blocks-implementation** · `010` sections 4, 12; `packages/core`, `packages/plugin`

v2's `AudioChunk` (`010:149-155`) is `{ data, format: AudioFormat, sequence }` — `format` becomes an
**object**, and top-level `sampleRate`/`channels` are gone. `generate()` yields `SpeechEvent`, not
`AudioChunk` (`010:306`). Consumers that break, none mentioned:

- `packages/plugin/src/sinks/subprocess-sink.ts:100` — `` join(dir, `chunk.${chunk.format === 'wav' ? 'wav' : 'bin'}`) ``. Against an object this is permanently `false`: **every WAV is written as `.bin`.** Silent, and in the audio path.
- `packages/plugin/src/speech-service.ts:403-404` — `for await (const audio of …generate(…)) { if (!this.#playback.push(generation, audio)) … }`. Under v2 this pushes `SpeechEvent`s, including `degraded` and `end`, into the playback queue.
- `packages/core/src/types/index.ts:3-10` (v1 `AudioChunk`, `format: string`) and `packages/core/src/queue/index.ts:7-10` — both typed on v1.

`010:910-911` calls rung 1 *"a pure-refactor commit with no latency change, so if anything regresses,
the cause is unambiguous."* It is a breaking change to the sink contract that `010` never writes down.

**Resolution.** Add `PlaybackSink` v2 and the `SpeechEvent`→sink demultiplexer to the section-4
contract; restate rung 1 as *"the seam and its consumers change; no latency change"*.

### R7-16 — The falsifier table holds one claim its own evidence refuted and one falsifier that has already fired
**needs-a-decision** · `010` section 13 vs sections 0, 8; P32, P33

- `010:986` — *"The budget is missed by spawn, not synthesis | refuted by … real synthesis costing more than ~80 ms."* The document measured segment 4 at **640–750 ms** (`010:550`) and amended the section-8 heading for it (`010:535-538`). **The refutation condition is met and the claim is still listed live.**
- `010:990` — *"Rung 2 collapses the inter-chunk gap | refuted by SPIKE-2 measuring a before-gap **not dominated by the sink spawn**."* SPIKE-2 ran (`010:668`): 2.3 ms spawn, ~893 ms device. By the row as written rung 2 is refuted; by P32's mechanism it is not, because rung 2 holds the **device**. **A spawn-shaped falsifier that survived round 6** — P32's own "indicator that never changes".

**Resolution.** Delete row 2 (settled, not open); rewrite row 6 as *"a resident sink holding one device
open still measuring a gap-to-audio ratio above X"*.

### R7-18 — `cancel()` is redefined from "SIGKILL issued" to "sound has stopped" while `CANCEL_BUDGET_MS` stays 50 over a quantity `010` labels `[claimed]`
**needs-a-decision** · `010` sections 4, 5.2, 7; P33; `packages/providers/src/contract.ts`

v2 (`010:308-309`): *"R014, two-sided. **Resolves once nothing is still producing sound** that we can
reach."* `010:526`: *"`CANCEL_BUDGET_MS` stays 50."* `010:426`: *"Kill-to-exit is not audio-stop:
device drain is `[claimed]`."*

The promise now resolves on *audio stopped*; the 50 ms was measured against *process exit* (~3 ms).
Keeping the constant while changing what it measures re-creates P33 inverted — the prose stricter
than anything observable (`latency-measurements.md` 1.5: drain *"needs a loopback capture or a
CoreAudio probe to measure at all"*). The suite would assert an unobservable.

Smaller defect alongside: `010:416` announces *"v2's `cancel(): Promise<{ reached: boolean }>` is the
fix"*, but the section-4 contract declares `cancel(): Promise<void>` (`010:309`); `reached` exists only
on the `spoke-elsewhere` event (`010:280`). `010:26` says the TypeScript *"is contract, and is expected
to be copied"* — so the copied version lacks it.

**Resolution.** State which quantity the 50 ms gates under v2 (recommend: keep it on kill-to-exit, and
name drain as ungated and unmeasurable today); reconcile `010:309` with `010:416`.

### R7-19 — The service's socket is anchored to a directory nothing on our side can locate, and `011` already chose a different namespace
**needs-a-decision** · `010` section 11.2, `011` section 1, `packages/plugin/src/adapter/index.ts`

`010:800-801` derives the socket path from *"the **plugin data directory in use**"*. Three facts
against it: our host surface is `notifications.show`, `storage.get/set`, events and commands
(`adapter/index.ts:56-95`) — **no API returns a data-directory path**, and `grep -rn
"dataDir\|userData"` over `packages/*/src` returns nothing; `getPluginsDataDir()` is an ORCA
main-process function (`orca-plugin-api.md:934`). `011:39-56` shows the directory is a worker-only KV
**deleted on uninstall**. And the service is a separate process — by `011:46-50`'s own argument about
the lab server, it has no route either.

`011:86-92` already picked the answer: `${XDG_CONFIG_HOME}/orca-tts/`, `~/Library/Application
Support/orca-tts/`, `%APPDATA%\orca-tts\`, with `$ORCA_TTS_CONFIG_DIR` as the per-worktree escape
hatch — which satisfies P27 better and survives uninstall.

**Resolution.** Re-anchor `010:800-801` to `011`'s namespace and cite it. This is `009` X-06 arriving
in a second document.

### R7-20 — Section 9's Linux escape hatch proposes a route P25, P29 and R012 each close
**needs-a-decision** · `010` section 9; P25, P29; constitution II / R012

`010:720-721`: *"unless `espeak-ng` is installed, in which case Linux gets a real streaming path **via
the library**."* P25's whole lesson is that **the library is present on stock Ubuntu while the binary
is not**. So "via the library" is either FFI into `libespeak-ng1` — a native binding, therefore
`node-gyp` in the default path, **Principle II / R012, non-negotiable** — or `espeak-ng --stdout`,
which P29 records as emitting a WAV header claiming 2 GB. The clause names neither and costs neither,
in the section whose job is costing R1.

**Resolution.** Replace with *"unless the espeak-ng **binary** is present, in which case Linux keeps
today's `-w` file rung — library streaming is out of scope (node-gyp, R012) and `--stdout` is broken
(P29)"*.

### R7-22 — `supports()` is synchronous, but the only voice list costs ~487 ms and is async
**needs-a-decision** · `010` section 4; `latency-measurements.md` 1.6

`010:324`: `supports(req): SupportReport` — sync. `010:321`: `listVoices(): Promise<…>`, with
`010:319-320` noting `say -v '?'` is **p50 487/472 ms** `[measured-here]` and *"Cache it"*. A request
with `voice: { by: 'index', index: n }` (`010:182`) cannot be answered without the list; called cold, a
sync `supports()` must lie or throw. The lie is expensive: `010:491` routes an unverifiable voice to a
**spoken** sentence — *"This system cannot confirm which voice it used…"* — so a cold `supports()`
produces a spurious spoken degradation. Rule A ("ask, do not discover") defeated by its own signature.

**Resolution.** Make `supports()` async, or define it only after `prepare()` and have T041j assert the
cold behaviour with a negative control.

### R7-21 — One wrong citation the checker cannot see, and four external citations pinned to nothing
**worth-noting** · `010` sections 2, 5.1, 9, 13, 15

`010:104` cites *"`004` section 2 (`004:102`)"* for the `chunk.format` branch. At `010`'s own pinned SHA
the sentence *"Branch on `chunk.format`, do not assume WAV"* is at **`004:91`**; `004:102` at
`32b929a` is a different subject. Wrong at the pinned commit, invisible to the checker.

The four checker flags, characterised so nobody "fixes" the wrong ones:

- **`010:103` — false positive.** `003` section 8.7 does start at `003:1280`; the tool inherited the preceding path. Leave it.
- **`010:513` — false positive, stale line numbers.** All six `contract.ts` pointers are exact at `32b929a` and ~6 lines low at HEAD, because `22269aa` (the P33 fix) added comments. Will keep failing until re-pinned.
- **`010:717` and `010:989` — real, same defect.** Both cite `brailcom/speechd` (`parse.c:98-110`, `parse.c:424-680`, `libao.c:75`, `options.c`, `module_utils.c`) with **no commit or version**. R001 requires a recorded SHA. The load-bearing claim *"`spoke-elsewhere` is the permanent Linux floor"* rests entirely on these five unpinned pointers, and there is no vendored copy — **unverifiable as written**. `010:1008`'s blanket *"Every `path:line` here was read at `32b929a`"* does not cover them and reads as though it does.

### R7-23 — `010` runs two label vocabularies and mixes them inside one table — and `HANDOFF.md` now claims otherwise
**worth-noting** · `010` sections 0, 8; `HANDOFF.md`; R006

`010:7-8` declares **MEASURED / DOCUMENTED / ESTIMATED** *"(finding E-05; constitution R006)"*. Those
are not R006's labels. Inside one six-row table: `010:547` `< 5 ms` **ESTIMATED**, no bracket; `010:548`
`~1 ms` same; `010:549` `414 ms` **MEASURED**, no bracket; `010:551` `~2 ms` ESTIMATED `[claimed]`; `010:550`
`[derived]`; `010:552` `[measured-here]`. Also unbracketed: `010:34`, `010:597/599/601/610`, `010:612`
(`UNMEASURED`, not an R006 label), `010:685`, `010:758`.

That `010` mixes vocabularies is already recorded (`latency-measurements.md:355-357`, judged *"not
R006 vocabulary, but honest"*). **What is new:** `HANDOFF.md:104-108` now asserts *"every latency
number in this repo now carries an R006 label … An unlabelled number in a table beside labelled ones
is the failure mode that produced all three."* **That claim is false, and `010:545-552` is the exact
table it describes.**

**Resolution.** Sweep `010` into R006 vocabulary, or correct HANDOFF to name which documents were
swept.

### R7-24 — `playback: 'provider'` turns a declared one-off R021 exception into a general capability with no rule limiting its use
**worth-noting** · `010` section 4; constitution IV / R021

`010:217-223` defines `playback: 'client' | 'provider'`, where `'provider'` means *"the provider
speaks through something we do not own, and yields NO bytes"*. Nothing in the type, prose, or contract
tests restricts it to the `spd-say` floor. T041h (`010:520`) asserts the **shape** is consistent
(`formats` empty, one `spoke-elsewhere`, zero `audio`) — nothing about **permission**. A cloud
provider playing through its own SDK would be fully conformant while defeating R021, losing
everything `010:423-429` lists: earcon, ducking, measurable barge-in, Voice Lab.

**Resolution.** One sentence in section 4 plus a contract assertion: `playback: 'provider'` is legal
only on the declared floor rung; any other provider declaring it fails the suite.

### R7-25 — "Without word events the only options are discard and restart the whole reply" is false; the chunker already holds the boundaries
**worth-noting** · `010` section 11.3; R020; `packages/plugin/src/speech-service.ts`

`010:822-824` claims sentence-granular resume needs word-boundary events. Segmentation lives **above**
the provider (R020) and the code proves it: `speech-service.ts:227` and `speech-service.ts:403` iterate an array the
client built. The client already knows which sentence it was on. Word events buy **sub-sentence**
precision — a smaller claim. This matters because `010:973` makes the word cursor rung-3, macOS-first,
so restart-resume *looks* gated on rung 3 and is not.

**Resolution.** Restate as *"sentence-granular resume needs nothing from the provider (R020); word
events buy sub-sentence precision"* — which also makes T096 implementable at rung 1.

### R7-26 — `T093 Warm-on-start` is silently contradicted by section 11.1's lazy-start ruling
**worth-noting** · `010` section 11.1; `TASKS.md:211`

`010:783`: *"**Lazily, on the first `prepare()`, not at plugin activation.**"* `TASKS.md:211`: *"**T093**
Warm-on-start + one-character warm-up generation."* `010` explicitly reconciles T096 (`010:812`) and
`TASKS.md:202` (`010:576`), so the omission reads as oversight. Compounding it,
`latency-measurements.md:198-201` records that `prepare()` calls `listVoices()` on darwin/win32
(`os-synth/index.ts:230-233`), adding ~480 ms **in front of** first audio — so "lazy on first
`prepare()`" puts ~480 ms plus service start on the first hotkey after every ORCA launch.

**Resolution.** Name T093 in section 11.1 and say what it becomes.

---

## 4. `011`, `012`, `013` — first hostile read

**Three negative results first, because they retire questions.**

**A. The contradiction the brief expected — a fight over where settings live — is not there.** `012`
and `013` make no claim about `settings.set`, `pluginsDataDir`, or any store. `012:123-124` puts `F`
in plugin storage beside `HUDDLE_HIGH_WATER_KEY`, which is exactly what `011:114` sanctions under its
tuning-versus-state split (`011:126-133`). Consistent. The real gap is R7-29 — coverage, not conflict.

**B. `011` genuinely resolves X-06; it does not restate it.** X-06 (`009:63`) asked where settings live
and whether the lab writes through the worker. `011:70-133` answers both — our own namespace with an
ORCA-KV mirror, and the lab writes the file directly (`011:111`, `011:580-582`) — and the ordering half
is answered by `revision` plus an immutable `SettingsSnapshot` (`011:141-190`). Its supersession of
`004` is correctly scoped: `004:646`, `004:587` and `004:14` are exactly the three sentences `011:6-9` claims
to supersede.

**C. Neither `012` nor `013` adds a fifth or sixth extension to `010`'s seam.** Each candidate was
checked against `010:98-111` and `010:200-320`: `013`'s sink drain and `spd-say --cancel` are
extension 4; the mic earcons are extension 3; resume-from-word is extension 5 read-side and needs no
new input. `012` adds none — its changes are `SpeechService`/`HuddleController` level. `013:130-134`
declares STT a **seventh extension on a separate seam** (`SttProvider`) rather than widening
`TtsProvider`. **`010`'s "the seam changes once" survives both.**

### R7-27 — `011`'s KV mirror can never fire, because the create-once starter file always shadows it
**blocks-implementation** · `011`

`011` gives the ORCA KV exactly one job and then specifies a rule making that job unreachable.

- `011:100-104` — the mirror exists *"when the inbox is missing, unreadable, or newly-invalid … so a listener whose config file got deleted still hears the voice they tuned."*
- `011:123` — *"**Precedence at load**, per field, highest first: **inbox** → **KV mirror** → **schema default**. Per field, not per file."*
- `011:508-512` — *"On `activate()`, if the inbox does not exist, the worker writes it: **every field in the schema, at its default** … Then the worker never writes that file again."*

Delete the inbox and restart: the worker writes a complete default-valued inbox, so **every field has
an inbox value**, so per-field precedence never reaches the mirror. **The one scenario the mirror
exists for is the one scenario in which it is shadowed** — and the listener silently gets defaults
where the document promises their tuned voice.

The second branch is worse: the starter file carries `"revision": 1` (`011:518`) while `011:181-183`
refuses any promotion with `revision <= currentSnapshot.revision` as `stale_revision`. If `revision`
is itself mirrored, the plugin permanently refuses its own starter file *and* every subsequent hand
edit, while disk and audio silently disagree. `011` never says whether `revision` is mirrored.

**Resolution.** On a missing inbox, load the mirror **first**, generate the starter file *from the
mirrored values*, and seed `revision` to `mirror.revision + 1`. Verify by effect: tune a field, delete
the inbox, restart, assert **the provider receives the tuned value**, with the no-mirror control.

### R7-30 — `013`'s listening window's primary close signal is dead in the configuration `012` makes the default
**blocks-implementation** · `012` + `013`

- `013:212-216` — *"The window closes on evidence, not only on a clock. A new `type: 'user'` record appearing in a **followed** transcript is the observable fact that the human's turn landed."*
- `013:397` (gate M17a) — close it *"by appending a `type:"user"` record to **the followed transcript**."*
- `012:87-88` (R1) — *"**Membership is explicit. A new session joins nothing.** … never auto-followed."*
- `012:152` — *"Session appears while `F` is empty and huddle is on → **still not followed**."*

On a fresh worker with `F = ∅` — which `012` guarantees after every reap, restart and first run — the
evidence-based close **cannot fire**. The window then ends only on `TALK_WINDOW_MS` (30 s) or a second
tap: **up to 30 seconds of dead air after the user finished speaking, on the accessibility path.**
`013` never states the dependency, and gate M17a test 3 is runnable only in a followed configuration.

**Resolution.** `013` states the precondition and specifies the `F = ∅` behaviour — either shorten the
window when nothing is followed, or watch the control pane's own cwd transcript regardless of
membership (read-only, R024-clean) — and says aloud at press time which close condition is armed.

### R7-06 — Three documents specify `maxQueued` three incompatible ways; the code has a fourth
**needs-a-decision** · `009`, `004`, `011`, `012`, `013`, `packages/plugin`

| Source | Says |
|---|---|
| `009` section 2 (C3) | *"`DEFAULT_MAX_QUEUED` must change from 20 to 8 so one constant exists"* |
| `004:411`, `003:1306` | *"**the one value is 8**"* |
| `011:462-463` (T122) | **Delete** `maxQueued: 8` **and** `DEFAULT_MAX_QUEUED`; `011:460` — *"the code that consumes a setting has no fallback literal at all"* |
| `012:227-228` | *"**the constant must be changed to 8**"*, **and** *"with `\|F\| > 1` the cap becomes **per session**, `ceil(8 / \|F\|)`"* |
| `013:231` | assumes a flat *"`maxQueued = 8`"* |
| `speech-service.ts:74` | `const DEFAULT_MAX_QUEUED = 20` |

So M12 deletes the constant, M16 sets it to 8 **and** makes it a derived function of `|F|`, M17
assumes a flat 8, and the code still has 20. `011`'s schema (`011:312`) types it as a plain `int` with
effect `immediate` and no `|F|` dependence — `011`'s own fallback-literal lint (`011:465-467`) would go
red against `012`'s instruction. And **no task carries any of it**: `grep -n
"DEFAULT_MAX_QUEUED\|maxQueued" docs/TASKS.md` returns nothing, though the same reconciliation added
T145 and T146.

**Resolution.** `011` owns the control. Amend `012` to cite `queue.maxQueued` rather than restate C3,
and register per-session fairness as a **second** schema field (`queue.perSessionFairness`, `since: 3`).
Amend `013:231` to cite. Add the task.

### R7-28 — `013` redefines barge-in onto the 250 ms end-to-end budget — the exact conflation the repo has a test to prevent
**needs-a-decision** · `013`, `003`, constitution, `packages/providers`

`013:259-263`: *"**Barge-in is Stop with an earcon after it**, so the gate is measured on the same
budget … assert **no samples after press + 250 ms**."* Gate at `013:395` asserts 250 ms.

- Constitution Latency Budgets: `| Barge-in signal → audio stops | **< 50 ms** |`, under *"A change that regresses one is a bug."*
- `packages/providers/src/contract.ts:12` — `CANCEL_BUDGET_MS = 50`
- `packages/providers/src/budget-claims.test.ts:38-44`, verbatim: *"`003` … defines a **DIFFERENT quantity under the same word** — end-to-end Stop … of which this budget is one segment. Globbing would collapse two real numbers into one false conflict."*

**`013` performs precisely that collapse**, and its gate is 5× the constitutional number — P33's shape,
in a document written after P33 was recorded.

**Resolution.** Keep the two quantities named separately: press→last-sample is 250 ms; the
**provider-cancel** segment inside it stays at `CANCEL_BUDGET_MS = 50`, and M17a asserts both. Moving
barge-in to 250 ms is a constitution amendment plus a constant change, not a design-doc sentence.

### R7-29 — `012` and `013` invent at least seven settings `011`'s frozen schema does not carry
**needs-a-decision** · `011` + `012` + `013`

`011` freezes `SCHEMA_VERSION = 2` over an enumerated 46-control set (`011:243`, `011:305`, `011:320`) and
makes T124 assert schema-vs-type coverage with a named `EXCLUDED` list (`011:350-367`). Neither later
document cites `011` at all — `grep -n "011" docs/design/012*.md docs/design/013*.md` returns only the
Q-numbering-collision note.

| Setting | Evidence |
|---|---|
| `FOLLOW_MAX` (1..7 + `all`) | `012:95`, `012:104-106` |
| registry poll interval | `012:454` — *"a setting with a floor of 1 000 ms"* |
| `UNREGISTERED_WINDOW` | `012:211` — *"default 10 min"* |
| unregistered-row visibility (Q76) | `012:554` |
| `TALK_WINDOW_MS` + talk gesture (Q77) | `013:202`, `013:437` |
| Q19 resume policy (Q78) | `013:334` — *"Ship all three behind one setting"* |
| M17b recognizer command path | `013:407` |

`011:402-407` provides the mechanism (*"M14 adds `omit.artifacts.*` ids at `since: 3`"*), so this is
coverage, not architecture — but M16/M17 as written land ids the schema, the starter-file generator
and T124's gap report do not know about.

**Resolution.** Add a "Settings this milestone adds" table to `012` and `013`, each row an `011`
`FieldDescriptor` at `since: 3`; count them in T124's gap report.

### R7-31 — `011`'s settings-failure report speaks unprompted at `activate()`; a second user's first experience is unrequested speech
**needs-a-decision** · `011`

`011:437-442` sends the report to *"**Spoken** … `SpeechService.announce(text, 'next')` … urgency
`next`, so it is heard **after** whatever is playing and never interrupts."* `speech-service.ts:126`
confirms the signature — but with an empty queue, `next` **is** now.

`next` protects a listener already hearing something. It does nothing for a listener hearing nothing.
For the author — voice-first, huddle on — correct. For a second user who installed this for
hotkey-only selection reading, ORCA launch with one stale field produces a voice announcing a settings
problem into a room where nobody asked for audio. Every default in `011` is honestly marked
`provisional` (`011:469-477`) — but the **delivery channel** is not one of the marked-taste axes.

**Resolution.** Gate the spoken report on evidence the audio channel is in use (huddle on, or a speak
request this session); otherwise `notify` plus a settings-health clause in `read-aloud.status`
(`011:443`). Add `announce.reportChannel` to the schema as `provisional`.

### R7-32 — `011` names the `fs.watch` risk and specifies no detection for it
**needs-a-decision** · `011`

`011:539-541` — the worker watches the inbox, *"so an edit takes effect on the next utterance with no
restart."* `011:622` (Q66) — *"`fs.watch` reliability … under an editor that writes via rename (`vim`'s
default) — a rename-write can leave the watch attached to the old inode. **This is the one mechanism
in this document with no citation behind it.**"*

If Q66 comes back negative the failure is exactly Principle I: the listener edits, hears no change,
edits again, and nothing distinguishes *"the watch died"* from *"I set the wrong field"*. `011`
specifies a probe but no runtime detection and no fallback.

**Resolution.** Have `read-aloud.status` **speak the loaded `revision` and `writtenAt`** (it already
speaks the path, `011:535-537`), so a stuck watch is one question away from visible; specify a
stat-poll fallback at the same 250 ms shape when the watch reports no event across a write the loader
can see.

### R7-33 — `012`'s liveness rule and gate M16 have no Windows-executable form, on a three-OS project
**needs-a-decision** · `012`; Principle III / R013

`012:286-288` — macOS is `[measured-here]`; Linux and Windows are `[claimed]`, Windows landing inside
`010` section 11.2's open C-03. `012:290-292` — where start time cannot be derived, the entry is
`liveness: unverified`, *"followable but never auto-anything."* `012:250-252` — *"a dead session holds
a voice slot … **A stale file degrades the audio of every other agent**."*

If `(Get-Process -Id).StartTime` does not resolve (Q74, `012:552`), **every** Windows row is
`unverified`, the reaper (`012:298-309`) can never remove a crashed session, and the degradation `012`
itself names is permanent on that platform. Gate M16's tests (`012:517-518`) are written as `kill -9`,
`ps`, `TZ=` — none runnable on `windows-latest`. R013: a feature that degrades on one OS is not done.

**Resolution.** Promote Q74 to a T160 precondition; write each gate-M16 row in a form the Windows job
can execute, or declare the `unverified` path explicitly and assert **that**, with a negative control.

### R7-34 — `013` treats the `win-arm64` gap as an STT blocker when its own cited source says the fix is already required for the default TTS engine
**needs-a-decision** · `013`

`013:18` marks the `win-arm64` question RESOLVED; `013:98-100` scores option B as *"**fails on
Windows-on-ARM** … Recoverable only via the GitHub-release path (P13), which is a download, an
extraction … and a binary we would then have to sign."*

Its own cited source says the opposite about cost — `q-round1-platform.md:518-521`: *"There is
**nothing to decide separately for STT**: the `win-arm64` fetch-from-GitHub-releases plan **already
required for TTS (P13)** covers voice input too."* And `q-round1-platform.md:462-468` records upstream shipping
`sherpa-onnx-v1.13.6-win-arm64-shared-MD-MinSizeRel-**no-tts**.tar.bz2` at **15.4 MB** — an ASR-only
build `013` never mentions.

Since Piper-via-`sherpa-onnx-node` is the default TTS engine, the plugin **already** pays the
GitHub-release path, the extraction (P14) and the signing question (`010` Q64) on Windows-on-ARM.
Charging them again to STT double-counts — and it is one of two legs holding up the M17c verdict.

**Resolution.** Amend `013:98-100` to state the marginal cost (zero binary cost on top of TTS; the
model download is the whole delta) and re-score option B. The verdict may not change; the **reason**
M17c stays unscheduled does.

### R7-35 — `013` never considers VAD or keyword spotting, and never names the real blocker: microphone capture
**needs-a-decision** · `013`; constitution "Complexity"

`grep -in "vad\|keyword\|microphone capture\|audio capture" docs/design/013-voice-input.md` returns
**nothing** for VAD or keyword spotting.

- `constitution.md:128-129` — *"`sherpa-onnx-node` covering TTS, **STT, VAD and keyword spotting** is worth more than four narrower packages."*
- `q-round1-platform.md:456-460` lists the shipped JS layer: `vad.js`, `keyword-spotter.js`, `streaming-asr.js`, `non-streaming-tts.js` — *"There is exactly **one** `sherpa-onnx.node`."*

`013:54` defines job B as *"**stop the speech when the user starts talking** (barge-in) | us, and only
us | **no** [STT needed]"* — then implements it as a keypress, because `013:174-177` correctly finds
the OS dictation trigger unobservable. **A VAD is precisely the mechanism that detects "the user
started talking" without STT**: ~1–2 MB model rather than 87.7 MiB, offline, key-free (R3.4), already
in the dependency. Keyword spotting is likewise this project's only route to a hands-free `stop` in
terminal focus, where #15642 kills every chord.

Conversely the blocker `013` **should** have named is absent: option B is scored as *"the only option
that gives us the audio stream"* (`013:103`) with no account of **where the audio stream comes from**.
Node has no cross-platform microphone capture without a native dependency (`node-gyp` — Principle II)
or an external binary (`sox`/`ffmpeg` — a setup step). No Q-round question has ever asked it.

**Is `013`'s "not buildable" verdict honest or defeatist? — The conclusion is honest; the argument is
not.** Shipping E as M17a is the right call and should stand. But two of the four "doors" are
overstated (this finding and R7-34), one open route is unexamined, and the blocker that would actually
decide it is unnamed. A verdict resting on overstated obstacles is fragile even when correct.

**Resolution.** Add a sixth option, *"VAD-only, no recognition"*, scored against the same four
constraints; open an E-question on cross-platform mic capture in a forked Node worker — that answer,
not the model size, gates M17c.

### R7-36 — `012`'s per-session fairness arithmetic exceeds the global cap it derives from
**worth-noting** · `012`

`012:228` — *"the cap becomes per session, `ceil(8 / |F|)`"*. At the argued default `FOLLOW_MAX = 3`
(`012:95`) that is `ceil(8/3) = 3` per session, `3 × 3 = 9` admissible against a global cap of 8.
`012:399`'s own wireframe renders it as `per-session cap 3 of 8`, showing the inconsistency on screen.

**Resolution.** `floor(8 / |F|)` with the remainder to the current speaker, or state that 8 is
per-session and the global bound is `8 × |F|` — and assert the total in the fairness test (`012:522`).

### R7-37 — `012` miscites `main.ts`, the one citation defect in ~14 checked
**worth-noting** · `012`

`012:227` — *"`main.ts:96` passes `8`"*. At `1161722`, the commit `012:5-6` pins, `maxQueued: 8` is at
`main.ts:99` — which is what `011:216` and `011:607` say. (At the moving HEAD of this review it is
`main.ts:124`; see R7-13.) E-01 class.

**Resolution.** One-character fix; more usefully, run `scripts/check-citations.mjs` over `011`–`013`
before any is implemented — none has been checked.

### R7-38 — `013`'s Ubuntu-manifest finding is not reproduced by its own reproduce command
**worth-noting** · `013`; P33 shape

`013:26` states the search that produced the result:
`grep -iE 'speech|dictat|voice|asr|sphinx|kaldi|onnx|deepspeech|julius|nerd-dictation'`.
`013:32`, under *"Reproduce:"*, runs a **different** pattern:
`grep -iE 'speech|dictat|voice|asr|kaldi|whisper|vosk'`.

Five terms in the stated search are absent from the reproduce command; two appear only in it. The
claim is therefore not the output of the command offered to check it. Neither could be run from this
session (no network), so **the conclusion is unverified here** — but the mismatch is verifiable on the
page, and `013:421` asks a future reader to re-run exactly this.

**Resolution.** One pattern, used in both places, with the exact output pasted.

### R7-39 — Unlabelled numbers in `012` and `013`, against each document's own R006 promise
**worth-noting** · `012`, `013`; R006

Both open with *"Every number carries `[measured-here]`, `[documented]` or `[claimed]`"* (`012:6-7`,
`013:6`). Unlabelled: `012:388` (`Piper (amy-low) · 58 ms`, rendered as a live readout); `013:19`
(`87.7 MiB` / `119.0 MiB`, labelled at `013:102` but not here); `013:193`, `013:285` (buzz's 880/440 Hz
earcon, third-party); `013:305` (buzz's 10 ms monitor); `013:308` (*"up to 2,000 ms"*, inherited from
`003`).

**No debunked numbers appear** in any of the three — `grep -n "927\|140 ms\|870\|one process per
chunk"` returns nothing. `013:125-126` does restate `010`'s pre-amendment framing (*"process spawn is
8× synthesis"*), which is still true as F1-vs-F3 (`010:40`) but sits next to the amendment withdrawing
that attribution for the **gap**. Correct as cited; worth a pointer so it is not re-inherited bare.

---

## 5. Cross-cutting: the second user, and what happens on uninstall

These two are here rather than under a document because neither belongs to one, which is why six
rounds did not find them.

### R7-04 — Huddle fails silently and permanently for any user without `~/.claude/projects`
**blocks-implementation** · violates a NON-NEGOTIABLE principle · `packages/plugin`, `012`, `006`

The transcript root defaults to `~/.claude/projects` (`huddle/index.ts:308`). Every failure to read it
is swallowed:

```
huddle/index.ts:315    try { dirs = await readdir(root) } catch { return null }
huddle/index.ts:326    try { entries = await readdir(join(root, d)) } catch { continue }
huddle/index.ts:331    try { files.push({ path: p, mtime: (await stat(p)).mtimeMs }) } catch { continue }
huddle/index.ts:332    if (files.length === 0) return null
```

The toggle announces success unconditionally (`main.ts:181-185`): `announce(\`Huddle mode ${on ? 'on'
: 'off'}.\`, 'now')`. And the diagnostic cannot tell the states apart (`main.ts:191-197`): with no
transcripts it says *"Huddle mode is on. Nothing is being read."* — true, and useless. **It never says
why.**

**The user-visible flow, which no user story covers.** A second user — one of the nine of fourteen
agents without a Claude-format decoder (`decoders.ts:14`: gemini, cursor, copilot, amp, droid, devin,
aider, continue, cline) — presses `Mod+Shift+H`, hears *"Huddle mode on"*, and then hears nothing,
ever. Status confirms it is on. There is no signal, at any point, that the feature cannot work on
their machine. For a voice-first user with no visual panel, the only route to the truth is reading our
source.

Constitution **I (NON-NEGOTIABLE)**: *"Never fail silently … **A hotkey that does nothing is
indistinguishable from a broken app**"* — and R009. This is that sentence, literally.

**The silence is asymmetric, therefore unintentional.** The same function **does** notify when it finds
*two* candidate transcripts (`huddle/index.ts:337`). Ambiguity is announced; total absence is not.
Nobody chose that — the author has `~/.claude/projects`, so the empty branch was never walked. `012`
does not cover it: `012:152` handles *"session appears while `F` is empty"*, a different state.

**Resolution.** On enabling huddle, resolve the root and, on `null`, say which of three states holds —
root missing, root empty, no decodable transcript — naming the path. Same in `read-aloud.status`. Add
an FMA row to `006`: distinct cause, distinct detection, distinct degradation.

### R7-05 — Nothing runs on disable or uninstall; post-M9 the orphan holds the audio device
**needs-a-decision** · `packages/plugin`, `010`, `011`, `013`, `006`

`packages/plugin/src/index.ts:1` is the whole public surface:
`export { default as activate } from "./main.js"`. **There is no `deactivate` — and the capability
exists and our own research documents it**: `orca-plugin-api.md:193-202`, *"an optional named
`deactivate` export is called…"*. `HuddleWatcher.dispose()` (`huddle/index.ts:152`) has exactly one
caller in the repository: `huddle.test.ts:86`. A method reachable only from its own test is the P26
dead-wire shape.

Escalating consequences:

- **Today:** disabling the plugin leaves an `fs.watch` on the transcript tree running.
- **After M9:** the resident service is orphaned. `grep -n "deactivate|shutdown|lifetime|orphan|idle timeout"` over `010` returns **zero hits** — the document introducing a long-lived daemon specifies no lifetime for it. By R7-01's resolution that daemon's defining behaviour is **holding the audio device open**. An orphaned process owning the audio device on a voice-first user's machine is not a tidiness problem.
- **On uninstall:** `grep -rn "uninstall" docs/ PITFALLS.md .specify/` hits **only `011`**, and every hit is about ORCA deleting *its* directory (`011:35`, `011:51`, `011:95`, `011:127`, `011:577`, `011:633`). Nothing covers removing **what we own**: the inbox, placed outside ORCA's tree precisely so it survives (`011:51-55`); the model cache, which R022 requires be outside the install tree (`architecture.md:212`) and which `013:101` sizes at **87.7 MiB minimum**; and a resident sidecar whose only exit condition is `IDLE_EXIT_MS`.

So uninstall leaves a config file, up to hundreds of MiB of cache, and transiently a process, with no
user-visible route to reclaim any of it — and a reinstall silently inherits the old file's `revision`,
which R7-27 shows is load-bearing.

**Resolution.** Export `deactivate`; have it call `dispose()` and, from M9, shut the service down and
release the device. Add an `orca-tts purge` verb and a README line naming all three locations. Gate:
uninstall → purge → assert the named directories are gone and a fresh install produces `revision 1`.
Deleting user-downloaded data is a decision, not a default — which is why this is needs-a-decision.

---

## 6. Record and method defects

### R7-09 — The memory files disagree with each other, and with the suite, on how many tests exist
**worth-noting** · `HANDOFF.md`, `STATE.md`, `006`

`HANDOFF.md:57` *"Tests | 145"* · `STATE.md:16` *"106 tests"* · `006:3` *"145 tests green"* ·
`pnpm test` at `9c36dcc` **186 passed (14 files)**. Three wrong numbers. R029 requires memory updates
in the same commit; `a59f109` added six tests and moved none of these.

### R7-10 — `STATE.md`'s DoD table asserts a fixed defect, citing a line that no longer says it
**worth-noting** · `STATE.md`, `packages/providers`, `test-audit.md`

`STATE.md:26`, present tense: *"the contract gate asserts `<= 1000 ms`, not 50
(`packages/providers/src/contract.ts:69`) — a check that could not have failed."* At `9c36dcc`,
`contract.ts:69` is `await pending`; the gate is `:79-80`, `.toBeLessThanOrEqual(CANCEL_BUDGET_MS)`
with `CANCEL_BUDGET_MS = 50` (`:12`) and **no multiplier** — fixed in `22269aa`, documented in
`test-audit.md` 2.1.

**Worth recording for the next reviewer:** `budget-claims.test.ts` — the guard written for precisely
this drift — cannot catch it. Its `CLAIM` regex (`:60-63`) requires the number to follow a cancel/stop
subject with no intervening `.`, and this sentence has one. That is a real limit of a genuinely good
guard, and R016 says limits get stated in the body. It belongs in that file's header note.

### R7-11 — Roadmap item 7 exists nowhere; `TASKS.md` numbers voice input as item 8
**worth-noting** · `TASKS.md`, `HANDOFF.md`

`HANDOFF.md:190` lists seven roadmap items ending *"huddle presence · voice input"*. `TASKS.md` maps
M11→1 … M16→6, then `TASKS.md:412` reads *"Phase M17 — Voice input (**roadmap item 8**, later)"*.
Either an item was dropped without a tracker (R083) or the numbering is off by one. A stranger cannot
tell which.

### R7-12 — `009`'s own citation is stale and internally inconsistent within one sentence
**worth-noting** · `009`

`009:36` cites `#highWater` as *"`huddle/index.ts:97`, persisted under `HUDDLE_HIGH_WATER_KEY`
(`:42`)"*. `:42` is right for the key; `:97` is `#highWater` itself, so the sentence cites one symbol
at another symbol's line. Cosmetic, but one of the 38 in R7-07.

### R7-13 — Gate results taken in this worktree are irreproducible, because concurrent agents hold uncommitted edits
**worth-noting** · method · P31

`pnpm check:citations` run twice minutes apart in the live tree returned **38 stale**, then **75
stale**, with no document edited between them — concurrent agents held uncommitted changes to
`packages/plugin/src/main.ts`, `packages/providers/src/os-synth/index.ts` and `registry.ts`, and the
checker resolves symbols against the working tree. `maxQueued: 8` moved from `main.ts:99` to `:124`
mid-review (R7-37). Every number in this document was therefore re-taken at clean `HEAD` in an
isolated worktree.

This is P31's shape reaching the **verification tooling** rather than the plugin. R004 requires the
same probe before and after; that is unsatisfiable in a tree with other writers.

**Resolution.** One line in P31: gates are run in a detached worktree at a named SHA, never in the
shared tree, and the SHA is recorded beside the number.

### R7-14 — `001:3` reads "Status: open" ninety-seven lines above its own RESOLUTION
**worth-noting** · `001`

`docs/.discussion/001-integration-path.md:3` — *"**Status:** open, pending empirical results (E1, E2)"*
— while `:100` carries *"RESOLUTION — 2026-08-20, after E1/E2/E6/E7/E8"*. A stranger reading top-down
sees the project's foundational decision as open.

---

## 7. The blind spot of this round's method — two negative results

Reported because a probe returning negative is a result, and the author is counting rounds.

**Is the plugin still the right vehicle? — Asked and answered; not a finding.**
`001-integration-path.md` poses exactly this (A: plugin / B: upstream / C: hybrid), makes it
conditional on E1 and E2, and **discharges the conditional** at `001:100` against measured results. The
reasoning survives contact: the panel is a measured-excellent speaker (`speechSynthesis` 180 voices;
`AudioBufferSourceNode` 4 ms drift, 2 ms stop) with **no host→panel wire**, which is upstream #15638.
`010` section 9 then argues the three-sidecar consequence explicitly rather than drifting into it. The
only defect is cosmetic and is R7-14.

**What does a fresh contributor read first, and does it exist? — It exists; not a finding.**
`README.md` opens with what the plugin is, states *"Status: pre-release"* plainly, gives a
build-and-dev-load path with the `dist/plugin` vs `packages/plugin` trap named, and tables every
shortcut. `STATE.md:80` names an explicit reading order. There is no `CONTRIBUTING.md`, but for a
single-author pre-release repo whose `HANDOFF.md` onboards better than most, that is an absence rather
than a defect.

**The two probes that did land are R7-04 (the second user) and R7-05 (uninstall)** — both found by
asking a question the previous six rounds had no reason to ask. That is the argument for the section
existing, and rounds 8–10 should keep one.

---

## 8. Parking lot

Ideas raised and rejected against the ledger bar, recorded so they are not re-proposed.

| Idea | Why parked |
|---|---|
| Surviving spawn *framing* in `010` headings/cells (`010:595`, `010:886`, `010:971`) | Each is factually true and corrected by adjacent text; P32's known copy-propagation, not a new mechanism error. A tidy, not a finding |
| `types/index.ts:36` cites **R023** for "never own playback" and `:50` cites **R022** for two-sided cancel; correct rules are **R021** and **R014**. Same at `os-synth/index.ts:110-117` | Already logged as `008` C-08; a sweep, not a new item |
| `013:288-289` requests `control.heartbeat` at *"reduced gain"* while `:281-282` asserts `005`'s pinned `gain 0.05` | Internal inconsistency; `005` owns the resolution |
| `013:254-257` puts `spd-say --cancel` in a gate step list, which `010`'s `spoke-elsewhere.cancel()` exists to hide | Layering, not behaviour |
| `013:17` dismisses reusing ORCA's STT on panel grounds when the relevant consumer is the worker (`013:93`) | Conclusion right, stated reason wrong — the real reason is that ORCA's 13 host methods touch no speech |
| `012:234` (*"following two"*) vs `012:404`/`:95` (`FOLLOW_MAX = 3`) | Cosmetic |
| `IDLE_EXIT_MS` *"5 min on battery"* (`010:859`) needs a cross-platform battery probe, neither named nor costed | Flag when M9a is planned |
| Two documents disagree on earcon sample rate (`005:621` vs `010:374-376`) | `010`'s is strictly more permissive; nothing breaks |
| `§` appears in eight documents against the author's standing notation rule | Taste; `011`/`013` already dropped it, `010`/`012` down to one each — self-correcting |
| Nine of fourteen agents fall back to `decodeGenericLine` | Known and named at `STATE.md:70`; its *silent* failure is new and is R7-04 |
| Two mutants report `SURVIVED` in `check:mutants` | Both declared-equivalent with stated reasons; script exits 0 at 18/18 as designed. Working as intended |

---

## 9. Findings table

| # | Severity | Finding | Documents | Who must decide |
|---|---|---|---|---|
| **R7-01** | blocks-impl | M9 has no task and no gate for holding the device open; Gate M9 passes with the ~950 ms gap intact | `TASKS`, `HANDOFF`, `STATE`, `010`, P32 | an agent — scope already decided at `010:46` |
| **R7-02** | blocks-impl | Inter-sentence budget is in the constitution and in no DoD item, task, test or CI gate; "finished" declarable with it violated 19× | constitution, `PLAN`, `TASKS`, CI | **author** — adding a DoD item changes what done means |
| **R7-03** | blocks-impl | `PLAN.md` DoD holds an item F4 proves unachievable, still reasons "414 ms leaves 86 ms"; P32's list omits `PLAN` and `TASKS` | `PLAN`, P32, `010`, `STATE` | **author** for the DoD split; agent for the rest |
| **R7-04** | blocks-impl | Huddle fails silently and permanently without `~/.claude/projects`; NON-NEGOTIABLE I / R009 | `packages/plugin`, `012`, `006` | an agent — the principle decides it |
| **R7-05** | needs-decision | No `deactivate`; `dispose()` is a dead wire; post-M9 the orphan holds the audio device; inbox + 87.7 MiB cache survive uninstall unnamed | `packages/plugin`, `010`, `011`, `013` | **author** for the cache; agent for `deactivate` |
| **R7-06** | needs-decision | `maxQueued` specified three incompatible ways across `011`/`012`/`013`; code has a fourth; no task carries it | `009`, `004`, `011`, `012`, `013`, code | **author** — `012` changes the control's shape |
| **R7-07** | blocks-impl | `check:citations` red on `main`: 38 stale vs a ratchet of 34 | CI, `006`, `010`, `003` | an agent |
| **R7-08** | needs-decision | `006` exempted from the fold but is a live deliverable: two claims citing a header that now says the opposite; ID12's severity wrong by 6.2× | `006`, P32, `005`, `009` | **author** — reverses `009`'s stated exemption |
| **R7-15** | blocks-impl | `010` section 8 says the OS-synth rung can never meet R4.2; 8.2 says it probably can; M9a's ship gate depends on which | `010` | **author** — it gates M9a |
| **R7-16** | needs-decision | `010`'s falsifier table holds a refuted claim and a spawn-shaped falsifier that already fired | `010`, P32, P33 | an agent |
| **R7-17** | blocks-impl | `AudioChunk` changes shape; `PlaybackSink` never respecified; rung 1 mislabelled a pure refactor; every WAV would be written `.bin` | `010`, `packages/core`, `packages/plugin` | an agent |
| **R7-18** | needs-decision | `cancel()` redefined to "sound stopped" while `CANCEL_BUDGET_MS` stays 50 over a `[claimed]` quantity; `010:309` vs `010:416` disagree | `010`, `packages/providers` | **author** — it redefines a constitutional budget |
| **R7-19** | needs-decision | `010`'s socket path anchors to a directory we cannot locate; `011` already chose the namespace | `010`, `011` | an agent |
| **R7-20** | needs-decision | `010` section 9's Linux escape hatch needs node-gyp (R012) or `--stdout` (P29); neither named nor costed | `010`, P25, P29 | an agent |
| **R7-22** | needs-decision | `supports()` is sync but needs an async ~487 ms voice list; cold calls produce a spurious spoken degradation | `010` | an agent |
| **R7-27** | blocks-impl | `011`'s KV mirror can never fire — the create-once starter file shadows it in the only scenario it exists for | `011` | an agent |
| **R7-28** | needs-decision | `013` redefines barge-in onto the 250 ms budget; 5× the constitutional 50 ms and the exact conflation `budget-claims.test.ts` exists to prevent | `013`, `003`, constitution | **author** — moving it is a constitution amendment |
| **R7-29** | needs-decision | `012`/`013` invent ≥7 settings `011`'s frozen schema does not carry and never cite `011` | `011`, `012`, `013` | an agent |
| **R7-30** | blocks-impl | `013`'s window-close signal is dead when `F = ∅`, which `012` guarantees after every restart — up to 30 s of dead air | `012`, `013` | an agent |
| **R7-31** | needs-decision | `011`'s settings-failure report speaks unprompted at `activate()`; a second user's first experience is unrequested speech | `011` | **author** — it is a default about their own machine |
| **R7-32** | needs-decision | `011` names the `fs.watch` rename risk (Q66, its one uncited mechanism) and specifies no detection or fallback | `011` | an agent |
| **R7-33** | needs-decision | `012`'s liveness rule and gate M16 have no Windows-executable form; R013 | `012` | an agent |
| **R7-34** | needs-decision | `013` charges the `win-arm64` binary cost to STT when its own source says TTS already pays it | `013` | an agent |
| **R7-35** | needs-decision | `013` never considers VAD or keyword spotting — same vendored addon — and never names mic capture, the real blocker | `013`, constitution | **author** — it reopens M17's option set |
| **R7-09** | worth-noting | Test count is 145 / 106 / 145 across three documents; actual 186 | `HANDOFF`, `STATE`, `006` | an agent |
| **R7-10** | worth-noting | `STATE.md:26` asserts a fixed defect at a line that no longer says it; `budget-claims.test.ts` cannot catch it | `STATE`, `packages/providers` | an agent |
| **R7-11** | worth-noting | Roadmap item 7 exists nowhere; `TASKS.md:412` numbers voice input as item 8 | `TASKS`, `HANDOFF` | an agent |
| **R7-12** | worth-noting | `009:36` cites one symbol at another symbol's line | `009` | an agent |
| **R7-13** | worth-noting | Gate results irreproducible under concurrent writers (38 → 75 stale, no edit between) | P31, method | an agent |
| **R7-14** | worth-noting | `001:3` reads "Status: open" 97 lines above its own RESOLUTION | `001` | an agent |
| **R7-21** | worth-noting | `010:104` wrong at its own pinned SHA; five `speechd` citations pinned to no commit, and a blanket claim that reads as covering them | `010` | an agent |
| **R7-23** | worth-noting | `010` mixes two label vocabularies in one table — and `HANDOFF.md` now asserts repo-wide R006 coverage that is false | `010`, `HANDOFF` | an agent |
| **R7-24** | worth-noting | `playback: 'provider'` is a general capability with no rule limiting it to the floor rung; a cloud provider could defeat R021 conformantly | `010` | an agent |
| **R7-25** | worth-noting | `010:822` claims sentence-resume needs word events; R020 and the chunker already provide it, so T096 looks gated on rung 3 and is not | `010` | an agent |
| **R7-26** | worth-noting | `T093 Warm-on-start` contradicted by `010:783`'s lazy-start ruling; lazy puts ~480 ms on the first hotkey after every launch | `010`, `TASKS` | an agent |
| **R7-36** | worth-noting | `012`'s `ceil(8/\|F\|)` admits 9 against a global cap of 8; its own wireframe shows it | `012` | an agent |
| **R7-37** | worth-noting | `012:227` miscites `main.ts:96`; the value is at `:99` at the SHA `012` pins | `012` | an agent |
| **R7-38** | worth-noting | `013`'s Ubuntu finding is not produced by the command `013` offers to reproduce it | `013` | an agent |
| **R7-39** | worth-noting | Unlabelled numbers in `012`/`013` against their own R006 promise | `012`, `013` | an agent |

**Totals:** 8 blocks-implementation · 14 needs-a-decision · 17 worth-noting · **39 findings**, of
which **31 clear the ledger bar** (section 10).

---

## 10. Was this round dry?

**No. Round 7 was decisively not dry. The honest count is 31 new items.**

Counted against `000-round-ledger.md:19-38`:

| Bar clause | Items |
|---|---|
| Changes a recorded decision | R7-01, R7-02, R7-03, R7-06, R7-08, R7-15, R7-16, R7-18, R7-19, R7-20, R7-25, R7-26, R7-28, R7-34 |
| Changes a user-visible flow | R7-04, R7-05, R7-30, R7-31 |
| Adds a failure mode with a distinct cause or detection | R7-04, R7-05, R7-13, R7-17, R7-22, R7-27, R7-32, R7-33, R7-36 |
| Opens or resolves a question | R7-29, R7-35, and the retirement of three questions in section 4 (A, B, C) |
| Invalidates a decision with evidence | R7-03, R7-07, R7-08, R7-21, R7-23, R7-24, R7-38 |

**Counted out** as record hygiene rather than new items: R7-09, R7-10, R7-11, R7-12, R7-14, R7-37,
R7-39 — plus eleven parking-lot entries. **31 clear the bar. The dry counter resets to zero.**

**The shape matters more than the number, and it is the actual result of this round.**

1. **The four documents everyone has been reviewing produced one finding between them** (R7-06's code half). `009`'s reconciliation of `002`–`005` survived a hostile sample of eight claims intact, and none of the 38 stale citations is in `004` or `005`. **That set has converged.**
2. **Eighteen findings came from documents nobody had read** — `010` (12), `011`/`012`/`013` (11, less overlap). This was their first hostile read and two of `010`'s are blocks-implementation, in the strongest document in the repo. **A document's quality does not substitute for a second reader.**
3. **Six came from two places nobody was looking:** the documents that define *done* and *schedule the work* (`PLAN.md`, `TASKS.md`), and the experience of a user who is not the author. **P32's propagation list omitted `PLAN.md` and `TASKS.md`, so six rounds of folding never opened them.** Fixing that one list is the highest-leverage action in this review.

**Recommendation for rounds 8–10.** Do not re-read `002`–`005`. Read `PLAN.md`, `TASKS.md`, the
constitution's budget table, and `006`. Run `check-citations` over `011`–`013`, which has never been
done. And keep one probe per round that asks a question the brief did not — the two that landed here
(R7-04, R7-05) were both found that way.

---

## 11. Blocking note on the ledger itself

`000-round-ledger.md:40-46` — the Rounds table — ends at **round 3, marked "in flight"**. Rounds 4, 5
and 6 demonstrably ran: `eb850bf` (round-3 artifacts and round-4 reconciliation), `1fc2633`
(fix-round-4), `8cfb30a` + `9d9797c` + `1a318c3` (the measurement pass and its fold), `a59f109` (the
test audit and P33). None is recorded. Commit `9c36dcc` says *"record wave 0 in the ledger"*, but this
ledger is unchanged at 71 lines.

**The instrument the stop condition is measured with is four rounds out of date.** The author's
condition is *"a minimum of ten rounds, and until three consecutive rounds produce no new items"* —
and right now neither clause can be evaluated from the ledger, which shows three rounds when seven
have run.

Whoever reconciles this round should backfill rounds 4–6 and add round 7 before anything else. **A
dry-round counter that is not being kept cannot end the process it exists to end** — and on this
round's evidence, the process is not close to ending.
