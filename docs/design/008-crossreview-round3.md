# 008 — Adversarial cross-review of D002, D003, 004 and 005

**Status:** review, round 3. **Written:** 2026-08-21.
**Reviews:** `docs/.discussion/002-agent-spoken-channel.md` · `docs/.discussion/003-panel-and-control-channel.md` ·
`docs/design/004-voice-lab.md` · `docs/design/005-agent-identity.md`.
**Reviewer had no session context and wrote none of the four.** Every finding below was checked
against source, and the checks are named so they can be re-run.

> **Stage numbers here are pre-J21 and are left as written.** This document is a dated record.
> On 2026-08-21 `stripHtmlComments` was inserted as stage **2**, making the pipeline **16**
> stages, so every stage number of 2 or higher below is one lower than the pipeline's today.
> The live numbering lives in `normalize()`'s call list and in `scripts/voice-lab.mjs` `STAGES`.

**Repo state used for verification.** `orca-plugin-tts` at `8666cc0`, with the four designs as
committed at `bb74a5f`. ORCA at `87097551f8e98a21c3afa7d457f66d6fd1f94038` — the same commit the
round-1 research pinned. Four behaviours were verified **by effect**, by running the real
`normalize()`, not by reading it; those probes are quoted where they are used.

**Summary:** 8 blocks-implementation · 11 needs-a-decision · 8 worth-noting. The single most
dangerous is **X-01**: 003's primary Stop route cannot identify its own target, and its failure mode
types a JSON control envelope into the agent's terminal as a user turn, which huddle then reads
aloud.

Two of the four are in materially better shape than the other two. **003's citations into the ORCA
tree are accurate** — I spot-checked nine of them, including the new `orca-runtime.ts` one, and all
nine say what the document says they say. **004 and 005 cite our own repo at a commit that is two to
three commits stale**, and three of the defects they are written to fix were already fixed before
they were written.

---

## Part 1 — Contradictions between documents

### X-01 · blocks-implementation · 003 §2D, 003 §5, 002 "Validating the target"

**The panel cannot tell the control pane from the agent's terminal, and 003's whole control channel
depends on being able to.**

003 recommends option D: the panel's Stop button calls `terminal.sendText` against the terminal
running `orca-tts control`. To do that it must choose one `terminalId`.

Evidence, verified at the pinned ORCA commit:

- `src/main/plugins/plugin-host-service-bindings.ts:57-59` — `workspace.readContext` maps every
  terminal to `({ id: terminal.handle })`. An opaque handle. No title, no cwd, no command, no pid.
  003 §4 states this correctly and then does not apply it to its own Stop path.
- `src/main/plugins/plugin-host-method-bindings.ts:92-109` — `terminal.sendText` re-lists the
  active worktree's terminals and **throws** `terminal is outside the active worktree` for anything
  else. So the candidate set is exactly "every terminal in this worktree", which by 003's own
  design contains at least one agent terminal *and* the control pane.

002 already wrote the rule that forbids this: *"Refuse on ambiguity. If the focused worktree has
more than one terminal and we cannot distinguish them, **do not send**"* (002, check 2). Applied to
003, the refusal fires in the only configuration 003 designs for, and route 2 — the route 003 calls
*"the one that answers the user's sentence"* — never fires at all.

If instead the panel guesses, the consequence is the exact behaviour 003 §2 rejects as option A:
`{"v":1,"id":"c-…","verb":"stop","gen":1734,"at":…}` is typed into the agent's terminal with
`enter: true`, lands as a user turn, appears in the transcript huddle is watching, and the agent's
reply to it is then **spoken aloud**. A Stop press produces speech. 003 §11 row 1 records option A
as *"Reject"* while its recommended option's failure mode is option A.

003 raises Q43 (onboarding), Q44 (worktree scope), Q45 (pane survival) and Q46 (socket lifetime),
and none of them is *"which of these ids is the control pane."*

**Proposed resolution.** Make target resolution a probe, not an assumption. On startup the panel
sends a nonce to **every** terminal in the worktree with `enter: false` — so nothing is ever
submitted as a user turn — and the control pane reports the nonce it saw back over the unix socket.
The id that answers is the control pane; it is cached for the session and re-probed whenever the
worktree changes. If no id answers, the state is `no_control_pane` and the buttons render disabled
per 003 §5. 003 must also **specify the `enter` flag**, which it never does; today `enter` is the
difference between "characters in a buffer" and "a user turn in someone's session".

### X-02 · blocks-implementation · 003 §2D

**One stdin cannot be both a raw keypress reader and a line reader, and the envelope's own letters
are the control keys.**

003 §2D gives the control pane four jobs, two of which conflict: *"(2) reads single keypresses — `s`
stop, `n` skip, `m` mute, `f` follow"* and *"(3) reads lines on stdin, which is where
`terminal.sendText` writes."*

Single-keypress reading requires `stdin.setRawMode(true)`. In raw mode there is no line discipline:
bytes arrive as they land, one at a time. `terminal.sendText` writes the payload straight to the
PTY and appends `\r` when `enter` is set —
`src/main/runtime/orca-runtime.ts:39794-39810` (`buildSendPayload`), reached via
`sendTerminal` at `:18559-18614`. So a Stop envelope does not arrive as a line; it arrives as ~70
individual keystrokes.

The envelope literally contains `s`, `t`, `o`, `p`, `n`, `m`, `f` and `p`. Sending one Stop fires
stop, skip, mute, follow and pause — in whatever order the JSON spells them.

**Proposed resolution.** Frame the two streams so they cannot be confused. The cheapest correct
option: envelopes are wrapped in a sentinel the keypress handler cannot produce (e.g. a leading
`\x1b]777;orca-tts;` OSC sequence terminated by `\x07`), and the reader is a small state machine
that swallows everything between the sentinels and treats the rest as keypresses. Whatever is
chosen, 003 must state it, because "reads keypresses and also reads lines" is not implementable.

### X-03 · blocks-implementation · 005 §11.1, 003 §3 R5 / §8.7, 004 §8 rule 5

**Three documents mint earcons from one perceptual space, and 005 allocates all of it.**

- 005 §11.1: identity earcon = **ordered pairs of distinct notes from a 6-note pentatonic set = 30**,
  and `earconId = h mod 30` uses **every one of them**. Two sine notes, 60 ms + 20 ms gap + 60 ms,
  gain 0.05.
- 003 needs at least four more: Stop confirmation (§10.2), Pause (§8.7 table), the 30-second
  paused-heartbeat (§8.7 rule 4), and *"an earcon rather than a sentence"* for refusals (§3 R5) —
  where the refusal set is six named codes, so potentially six more.
- 004 §8 rule 5 adds four again: *"Play, stop, skip and error each have a distinct **150 ms**
  earcon."* Different duration, different document, no cross-reference.

Nothing reserves a band. With 30 of 30 identity motifs allocated, every control earcon 003 and 004
need is, by construction, some live agent's identity. And a listener who has learned "rising G5-A5
is Cedar" will hear that exact motif as the confirmation of a Stop.

This is worse than a naming clash. 005 §11.1's argument is that the earcon is *"the one that
actually satisfies R1"* precisely because it is host-independent — so on the guaranteed floor
(N = 1 voice, everyone in overflow, §14.3 case A) the earcon is carrying **all** of the
differentiation, and it is exactly there that it collides with the control vocabulary.

**Proposed resolution.** One owner for the earcon table, in `@orca-tts/core`, with reserved bands
stated up front: control earcons are a different *shape* (a single note, or three notes, or a
different envelope), not a different pair from the same 30. Identity motifs shrink to whatever is
left after the reservation and 005's `earconMotifs × callSigns = 30 × 64 = 1,920` is recomputed.
The one place this must be pinned by a test is that no identity motif is byte-identical to a
control earcon.

### X-04 · needs-a-decision · 003 §6, 005 §11.2, 004 rows 39–40

**003 and 005 both propose a call-sign. They are not the same call-sign, from the same source, with
the same collision rule — and 004's option space can express neither.**

| | 003 §6 | 005 §11.2 |
|---|---|---|
| Form | **two** words — *"amber falcon"* | **one** word, 1–2 syllables — *"Cedar"* |
| Cardinality | unstated | 64 (`WORDS[h mod 64]`) |
| Hash | *"keyed by sessionId"*, unspecified | `fnv1a32(sessionId)`, specified exactly and deliberately |
| Rank | **last** — rank 4 of 5, *"used ONLY to break a collision"* | **first** — §18: *"identity is not 'a voice per agent'; it is call-sign first, voice last"* |
| Registry `name` | **rank 1**, the recommended identity | the *long* form, spoken on switch / status / request |
| Collision rule | *"broken by adding, not by falling back"* — both get the call-sign **appended**: *"orca plugin tts 13, amber falcon"* | broken by **probing to a different word** (§7.3 step 3, double hashing) |
| When spoken | on transitions only; after ~30 s silence | prefixed to a turn; **mandatory every turn** for any tier ≥ 1 or overflow |

The collision rules are opposites. Give both designs the same two colliding sessions and 003 emits
*"orca plugin tts 13, amber falcon"* while 005 emits *"Willow"* — for the same session, in the same
audio stream.

004, which is where the default is supposed to be settled, offers `announce.sessionLabel` with legal
values `path-tail-3-plus-hash · path-tail-1 · call-sign (word pair) · title` (row 39). Note
`(word pair)` — it encodes 003's shape, not 005's. And there is **no `registry-name` option at all**,
which is 003's rank-1 recommendation and 005's long form. So the listener cannot hear either
design's recommended default in the instrument built to choose defaults.

Row 40 is worse: `announce.sessionLabelHashChars`, slider 0–8, default 8. Both 003 §6
(*"never, under any circumstance, hex"*) and 005 §11.2 (*"reading `111693de` aloud to a dyslexic
listener is a non-answer"*) treat hex as a **correctness** failure, not taste. 004 ships it as a
tunable with the worst value as the default.

**Proposed resolution.** One call-sign specification, owned by 005 (it is the more precisely
specified of the two, and it is the one with a stated hash). 003 §6 becomes a *display-name* chain
that consumes it. Delete row 40 from 004 and replace row 39's option space with the resolved chain:
`registry-name · registry-name-plus-callsign · callsign · branch · displayName`. The listener still
chooses; they just cannot choose hex.

### X-05 · needs-a-decision · 002 §Q5, 003 §6, 004 Panel A/F, 005 §11–13

**Three documents write into one audio stream, nobody arbitrates, and on a short reply the
overhead is longer than the reply.**

Do the arithmetic. Take the shortest real reply in 005's own worked example — *"The tests pass."*,
about **1.0 s** of speech at 175 wpm. Now stack what the four designs each prepend, on the
guaranteed floor (Ubuntu stock or Windows with three agents — 005 §14.2/§14.3, where every session
is overflow and the call-sign is **mandatory**):

| Source | Element | Cost |
|---|---|---|
| 005 §11.1 | identity earcon, 60 + 20 + 60 ms | 140 ms |
| 005 §11.1 (unstated) | one extra sink spawn, because the earcon is *"an `AudioChunk` prepended to the utterance"* and `SubprocessSink` spawns one player per chunk (`sinks/subprocess-sink.ts:8-10`) | ~970 ms on v1 macOS |
| 005 §11.2 | call-sign, *"one word … (~350 ms)"* | 350 ms |
| 003 §6 | identity re-spoken *"after any silence longer than ~30 s"* — the normal case between agent replies — *"orca plugin tts 13"* | ~1,200 ms |
| **Preamble total** | | **~2.7 s** |
| | **the reply** | **1.0 s** |

**The overhead is 2.7× the content**, and that is before 002's Option D announcements
(*"Here, a code block is omitted."* ≈ 1.4 s each, measured against the shipped string), before
003 §9 adoption 3 (*"queue overflow, mute skips, degradation …, a refused command, and a session
switch are all spoken"*), and before 004 §8 rule 3's speak-on-change confirmations.

No document arbitrates. 003 §6 says identity is spoken *"on the first utterance of a turn"*;
005 §13 rule 1 says tier ≥ 1 is *"named every turn, regardless of the setting"*; 002 §Q5 rule 3 says
*"Whichever policy is active, **omission is announced**"*. Three "regardless" rules in three
documents, composing into a preamble nobody costed.

**Proposed resolution.** One **utterance-preamble budget**, owned by whichever module finally
assembles the utterance, expressed in milliseconds and enforced: if earcon + call-sign + identity +
omission-notices exceeds N% of the estimated spoken length of the reply itself, elements are dropped
in a stated priority order and the drop is itself countable (not spoken — that would defeat the
point). The listener sets N in Voice Lab. Without a budget, the three "regardless" rules are
individually reasonable and collectively unlistenable.

### X-06 · needs-a-decision · 004 §7, 003 §3

**004 makes the settings file the contract; 003 makes the envelope the contract; they share no
ordering primitive and no location.**

003 §3 defines `{v, id, verb, gen, arg, at}`, and says *"`gen` is the whole design"* — every control
mutation is ordered against a playback generation and refused as `stale_generation` when it loses.

004 §7 exports `{schemaVersion, provenance, normalize, chunk, synthesize, runtime, phrases,
expected}` — **no generation, no id, no timestamp, no idempotency key**. And that file is not inert
configuration: it carries `runtime.maxQueued`, `runtime.announceMode`, `synthesize.voice`,
`synthesize.rate` and row 45 `interrupt.granularity`. Writing it *is* a control-plane mutation.

So: the listener presses **Save to plugin** while an utterance is playing. The worker re-reads
settings and swaps the voice mid-queue. There is no rule that says whether that applies to the
current generation, the next one, or the queued items — and 003's R2/R4 cannot adjudicate it,
because a settings write is not one of the eight verbs. 004 §Q47 asks the adjacent question
(*"does **Save to plugin** write the file directly … This also decides whether the lab can be used
*while* huddle mode is running"*) and leaves it open; 003 does not know the question exists.

Second half: **the location.** 004 §7 picks `~/.orca/read-aloud/settings.json`. That is inside
ORCA's own configuration directory, for a file ORCA does not own. Meanwhile ORCA already ships a
per-plugin KV store the worker *can* write —
`src/main/plugins/plugin-host-service-bindings.ts:79-82` (`settings:own` →
`PluginKvStore(pluginsDataDir, key, 'settings.json')`). 004 §Q35 correctly establishes that the
capability **renders** nothing, and then discards the store along with the UI. Those are different
facts.

**Proposed resolution.** (a) Add `gen` (or a monotonic `revision`) to the settings envelope and give
"settings changed" a verb in 003's set, so it is ordered like every other mutation and can be
refused with a named code. (b) Decide the home explicitly: ORCA's `pluginsDataDir` via `settings.set`
from the worker, with the lab writing through the worker rather than around it, or a path under our
own namespace — not `~/.orca/`. (c) Answer 004 §Q47 in the same change, because "can the lab run
while huddle is speaking" is the same question as (a).

### X-07 · blocks-implementation · 004 §6 Panels B/E, 005 §2 and §16

**Both designs assert as *"Today"* three defects that were fixed before either was written, and
one of them is the entire premise of a panel.**

004 and 005 were committed together at `bb74a5f`. The two commits immediately before them —
`5cab7eb` *"keep ordered-list ordinals"* and `6b776d4` *"give voice, rate and isolateFirstSentence a
wire to the caller"* — closed exactly these:

| Claim | Where | Reality at `bb74a5f` |
|---|---|---|
| *"`SpeechService` calls `provider.generate(chunk.text)` with **no options at all**"* — 004 calls this **H24, "the single largest gap found in the audit"**, and Panel E exists *because of* it | 004 §6 Panel E preamble; 005 §2 table; 005 §16 prerequisite 1 (*"M15's first task"*, state **open**) | `packages/plugin/src/speech-service.ts:257` reads `this.#deps.provider.generate(chunk.text, this.#synthesizeOptions())`. **Closed.** PITFALLS **P26** records the fix and the reachability test that pins it |
| Row 29 `voice.rate` *"Today: unset, unreachable; **Linux drops it entirely**"* | 004 Panel E; and 004 "Bug, not a control: H25 … silently dropped on Linux … gets fixed" | `linuxCommand()` at `os-synth/index.ts:175-212` pushes `-s <wpm>` on every backend. **Closed** — and 005 §2 says so in the same commit (*"H25 … now fixed by `linuxCommand()`"*), so the two designs disagree with each other about the same line of code |
| Row 33 `pace.isolateFirstSentence` *"`true`, and **never forwarded** — `SpeechService` passes only `maxUnits`"* | 004 Panel E | `speech-service.ts:140-143` forwards both. **Closed** |
| Row 10 `struct.orderedListNumbers` *"Today: `drop`"*, and *"Row 10 is the one item in this document I would call a comprehension bug … `1. alpha / 2. beta` becomes `"alpha. beta."`"* | 004 Panel B | **Verified by effect** — `normalize("1. alpha\n2. beta")` returns `"one, alpha. two, beta."`. The default is `'numeral'`, not `'drop'`, and the legal values are `'numeral' \| 'word' \| 'drop'`, not 004's `drop · number · ordinal` |
| *"Build hazard … `packages/core/dist/` is tracked and two normalizer commits stale … Delete it from the index before T111 starts"* | 004 §1 | `git ls-files packages/core/dist` returns **0 files**. Already done |

The last one is the one that costs real work. `NormalizeOptions` now has **five** fields
(`normalizer/index.ts:22-51`), and the fifth — `orderedList` — is **absent from 004 §7's export
format**, which the same document declares *"is now also the settings format"* and *"a contract"*.
A field that exists in the type and not in the schema is precisely P26's shape: *"a field that
cannot be walked is not a setting, it is a comment."*

**Proposed resolution.** Re-derive 004's entire "Today" column and 005 §16's prerequisite table
against `HEAD` before either is implemented, and add `orderedList` to §7's `normalize` block. The
cheap durable fix is the one 004 already applies elsewhere: cite a **symbol name plus a commit SHA**,
not a bare line number.

### X-08 · needs-a-decision · 002 Q47, 004 Panel A, 004 §7

**Option D's spoken vocabulary has no home in the instrument that is supposed to choose its
defaults, and the schema freezes before it arrives.**

002 makes Option D *"the product and the deliverable"*, and Q47 assigns its wording to Voice Lab:
*"What is the **named vocabulary** of skip announcements … 'a diagram', 'a table of N rows', 'a stack
trace' … Design here, default in M11."*

004 is M11. Its Panel A ("What gets left out, and how you are told") has seven controls:
`codeBlocks`, `codeBlockPhrase`, `codeBlockDetail`, `inlineCode`, `urls`, `urlPhrase`, `emoji`.
There is no control for a diagram, a box-drawing run, a stack trace, or a wide table — Option D's
whole classifier. 004 declares itself complete at *"45 controls"* and its wireframe prints
`45 controls · 8 EP` in the status bar.

The sequencing makes this expensive rather than merely untidy. 004 §7: *"M11 and M12 fuse at the
schema"*, `"schemaVersion": 1`, and *"T124 must iterate this schema"*. M14 (Option D) lands after
M12. So Option D's announcement fields arrive against a frozen v1 schema — and **004 contains no
migration story at all**: no statement of what happens when the plugin reads a v1 file after the
schema becomes v2, or a v2 file on an older plugin. `parse(unknown): Settings` falls back *per
field* (T123), which silently swallows a version mismatch instead of naming it.

**Proposed resolution.** Either (a) 004 reserves an `omit.artifacts` group now — even as controls
that render "not yet implemented" — so the schema shape is right before it freezes, or (b) 004 §7
states an explicit version policy: unknown `schemaVersion` is refused **by name** (not per-field
fallback), and adding fields is a minor bump that older plugins report aloud once. (a) is cheaper;
(b) is needed regardless.

### X-09 · needs-a-decision · 003 §4/§8.7, 004 §8

**The two keyboard surfaces the same listener uses invert each other on four keys.**

| Key | 003, control-pane TUI | 004, Voice Lab |
|---|---|---|
| `Space` | **pause / resume** (§8.7: *"Space is the universal play/pause"*) | **Play** the fixture |
| `.` | unassigned | **Stop** |
| `s` / `S` | **stop** | **Snapshot** |
| `R` | **replay** the last-20 buffer | **Restore** a snapshot |
| `M` / `m` | **mute** this session | **More** — reveal the panel's hidden tier |
| `n` / `N` | **skip** | unassigned |

For a user who is not looking at the screen and is building muscle memory across both surfaces,
`Space` meaning *play* in one and *pause* in the other, and `R` meaning *replay audio* in one and
*restore settings* in the other, is the same class of hazard 003 §9 adoption 1 spends a CSS rule and
an E2E test to prevent — *"a control that moves must be looked at before it can be pressed."* A
control that changes meaning is worse than one that moves.

There is a third vocabulary: 005 §11.2 constrains the call-sign word list against *"our own control
vocabulary (`stop`, `skip`, `status`, `next`)"* — four words, which is neither 003's set nor 004's,
and omits `pause`, `mute`, `follow` and `replay`.

**Proposed resolution.** One key map, one spoken control vocabulary, in one file, consumed by the
TUI, the lab and the (future) voice-command path. The listener picks the bindings; the point is that
there is one table to pick from.

### X-10 · blocks-implementation · 004 §2, 005 §14.3, PITFALLS P25

**On stock Ubuntu the Voice Lab receives zero bytes, does not error, and the machine speaks anyway.**

004 §2's verdict — *"the BROWSER plays. The server synthesizes and returns bytes"* — rests on
`provider.generate()` yielding an `AudioChunk`. It states one failure mode: *"If `provider.generate()`
throws or the platform has no synthesizer … `POST /speak` returns `503` with the provider's error
text."*

The `spd-say` rung does neither. `packages/providers/src/os-synth/index.ts:274-283`:

```ts
      const backend = await this.#resolveLinuxBackend()
      if (!LINUX_WAV_BACKENDS.includes(backend)) {
        // The floor: speech-dispatcher speaks it. No bytes come back, so nothing is yielded and
        // the sink stays idle. `--wait` keeps utterance ordering correct.
        await this.#speakDirect(text, opts)
        return
      }
```

It **speaks out loud through the daemon and yields nothing**. So on the most common Linux desktop —
the exact machine PITFALLS P25 exists for — the lab's page gets an empty chunk array, no `503` ever
fires, the AudioBuffer cache has nothing to cache, and the A/B compare, the per-stage play, the
0 ms replay and the two-second gate all silently do nothing while the room fills with speech the
page cannot stop, scrub or repeat. Every one of 004's architectural advantages evaporates on that
rung, and 004 never names it.

005 knows (§5 row *"Ubuntu stock, `spd-say` floor … we do not own playback there"*, §14.3 case A).
The two documents were written against the same PITFALLS file.

**Proposed resolution.** 004 must handle three provider outcomes, not two: bytes (play in the
browser), throw (`503`, spoken), and **spoke-elsewhere** (a named state the page announces — *"this
machine's speech service played that; the lab cannot replay or compare it. Install espeak-ng to use
the lab"*). The provider already knows which rung it is on (`get linuxBackend()`), so this is a
capability read, not a guess. Until then 004's gate — *"change a control, hear the difference in
under two seconds"* — is not satisfiable on stock Ubuntu, and R013 says a feature that degrades on
one OS is not done.

### X-11 · worth-noting · 003 §2, 003 §8.7, 005 §11.1

**Stop during an earcon is undefined in all three documents, and 003's own two Stop numbers
disagree.**

The brief's question — does the earcon sit inside or outside the barge-in path — has no answer in
any document. 005 §11.1 says the earcon is *"emitted as an `AudioChunk` prepended to the utterance"*,
which puts it inside the generation and therefore inside `bargeIn()`; but 003 §10.2 emits a Stop
**confirmation** earcon *after* the generation is bumped, at the new generation, and 003 §3 R4 says
a stale Stop *"say[s] nothing aloud"*. So a nervous user's second press — which 003 R1 explicitly
anticipates (*"a nervous user presses Stop three times"*) — produces no confirmation at all, which is
the feedback vacuum that makes people press a third time.

Separately, 005 §11.1's earcon specifies *"5 ms raised-cosine fade in and out (no clicks)"*. A
`bargeIn()` 40 ms into a 140 ms earcon truncates it with no fade — a click, on the assistive-tech
path, at the exact moment the user asked for silence.

And 003 contradicts itself on the number: §2's route table gives route 2 a *"realistic
press-to-silence"* of **~40–120 ms**, while §2's segment table for the same route sums to
**250 ms** (60 + 40 + 100 + 50). Both appear on the same page.

**Proposed resolution.** State the earcon's position relative to the generation explicitly, give
`bargeIn()` a 5–10 ms fade-out so any truncation is clickless, and make the Stop confirmation fire
on *every* Stop press including stale ones (it costs nothing and it is the only feedback the
listener gets). Reconcile the two route-2 numbers.

---

## Part 2 — Claims that outrun their evidence

### E-01 · blocks-implementation · 002, 004, 005 (003 is clean)

**Every citation into our own `packages/` in 002, 004 and 005 is stale, by a uniform offset,
because all three inherited line numbers from round-1 research read at `c8b6fdc`.**

This is the P0 failure mode arriving through the front door: the *numbers* are wrong even where the
*claims* are right, so a reader who follows the citation lands on unrelated code and cannot tell a
stale pointer from a fabricated one.

Verified offsets (symbol lines read at `bb74a5f`, the commit that published 004 and 005):

<!-- citation-check: ignore-begin -->  <!-- the left column is a list of pointers that WERE wrong; correcting it would delete the finding -->
| Cited as | Actual | Symbol | Cited in |
|---|---|---|---|
| `normalizer/index.ts:73` | **88** | `CODE_PLACEHOLDER` | 002, 004 row 2 |
| `normalizer/index.ts:77,78,79,88,92` | **92, 93, 94** (and `extensionStyle`/`orderedList` are read inside the stages, not at 88/92) | `normalize()` defaults | 002, 004 rows 1, 15, 16, 24, 25 |
| `normalizer/index.ts:107-128` | **122–…** | `stripFencedCode` | 002 (three times), 004 rows 1, 3 |
| `normalizer/index.ts:81-94` | **95–109** | the stage pipeline | 004 §4 |
| `normalizer/index.ts:229-243` | **272–…** | `listItemsToSentences` | 004 rows 10, 11 |
| `normalizer/index.ts:253-284` | **292–…** | `tablesToRows` | 004 rows 12–14 |
| `normalizer/index.ts:309-360` | **348–…** | `speakFilePaths` | 004 rows 15–21 |
| `normalizer/index.ts:386` | **425** | `stripMarkdownMarkers` | 004 rows 22, 23 |
| `normalizer/index.ts:428-436` | **467–…** | `stripEmoji` | 004 row 7 |
| `normalizer/index.ts:479-519` | **518–…** | `expandNumbers` | 004 rows 24, 27 |
| `normalizer/index.ts:522-551` | **561–…** | `expandUnits` | 004 rows 25, 26 |
| `speech-service.ts:121` | **152** | `provider.generate(...)` | 004 Panel E, rows 28, 29; 005 §2, §16 |
| `speech-service.ts:112-114` | **140–143** | chunker options | 004 row 33 |
| `speech-service.ts:28` | **42** | `DEFAULT_MAX_QUEUED` | 004 rows 36, 37 |
| `speech-service.ts:81-85` | **57, 73** | `provider.cancel()` / `bargeIn()` | 003 §2 (003's only stale citations are into our own repo) |
| `speech-service.ts:111-116` | **148–153** | playback generation | 003 §3 |
| `speech-service.ts:24,73-75` | **39, 83–89** | `onDropped` | 003 §9 |
| `plugin/src/main.ts:41` | **48** | `maxQueued: 8` | 004 row 36 |
| `plugin/src/main.ts:114,127,141` | **121, 134, 148** | `'replace'` announcements | 004 rows 38, 42 |
| `os-synth/index.ts:132` | **283** | the `yield {..., format:'wav'}` | 004 §2 |
| `os-synth/index.ts:140-141` | **292–293** | the darwin `--data-format` comment | 004 §2 |
| `os-synth/index.ts:143-165` | **289–318** | voice/rate in `#command()` | 004 Panel E; 005 §2 |
| `os-synth/index.ts:161-166` | **139–160** (`linuxCommand`, and rate is now honoured) | Linux branch | 004 rows 29, "Bug, not a control" |
| `os-synth/index.ts:152-158` | **300–311** | the PowerShell `''` escaping | 004 §6a, §Q45 |
| `os-synth/index.ts:225-237` and `:227` | **299–311**; the linear rate formula is at **301** | Windows `$s.Speak` | 005 §5, §8.2, §8.5, §18 |
| `os-synth/index.ts:109` | **115** | `ESPEAK_BASE_WPM` | 005 §8.1 |
| `os-synth/index.ts:117-133` | **123–160** | `linuxCommand()` | 005 §2, §16 |
| `os-synth/index.ts:88` / `:90-93` | **94** / **96–99** | `LINUX_WAV_BACKENDS` / `LINUX_INSTALL_HINT` | 005 §10 F7, F1; §11.6 |
| `os-synth/index.ts:153-158` | **172–179** is `prepare()`; `listVoices()` is **224** | *"`prepare()` … calls `listVoices()`"* | 005 §9.1 |
| `os-synth/index.ts:174-179` | **235** and **310** | where we spawn `powershell` | 005 §2 |
| `os-synth/index.ts:181-188` | **238–244** | Linux `listVoices()` via `spd-say` | 005 §10 F7 |
<!-- citation-check: ignore-end -->

The two commits responsible are `5cab7eb` (normalizer, +15 lines above `CODE_PLACEHOLDER`) and
`6b776d4`/P25 (os-synth, +6 in the Linux block and +~60 below it, plus the `speech-service` wire).

**What is *not* stale, and deserves saying:** `chunker/index.ts:37,53,66`, `clipboard.ts:63`,
`sinks/subprocess-sink.ts:8-10,52-60,70-83`, `huddle/index.ts:40,42,43,55-60,68,118-119,179`, and
`huddle/decoders.ts:29-58,60-71` are all correct. And **003's ORCA citations are correct** — I
checked `plugin-host-api.ts:261-265`, `plugin-host-method-bindings.ts:98-107`,
`plugin-host-service-bindings.ts:57-59`, `use-global-keybindings.ts:216-236`,
`app-command-handlers.ts:67-71`, `keybindings.ts:1895,1902-1914`,
`plugin-content-pack-contributions.ts:25-41`, `plugin-command-keybindings.ts:19-35`, and the new
`orca-runtime.ts:18559-18614`. All nine say what 003 says they say, including the one 003 flags as
new. F6 in particular is exactly right, down to the comment it quotes.

**Proposed resolution.** Re-derive the three stale files' citations before implementation, and
switch to `symbol @ sha` form. A `scripts/check-citations.mjs` that greps every `path:line` out of
`docs/` and asserts the line still contains the expected token would make the next drift loud
instead of silent; it is ~40 lines and it could actually fail.

### E-02 · blocks-implementation · 002 check 3, 003 §5, 003 §10.2

**`terminal.sendText`'s `{ accepted: boolean }` can never be `false`, so both documents' "verify by
effect" check is an indicator that never changes.**

002's check 3: *"**Check the acknowledgement.** `terminal.sendText` returns `{ accepted: boolean }`
… Treating a call as fire-and-forget recreates P18 exactly … **Log the `false`, and say it.**"*
003 §5: *"the panel does know one thing by effect: `terminal.sendText` returns `{ accepted: boolean }`
… So the control-pane indicator is derived from a probe that *could* fail, not from a config
assumption. **It is a real check.**"*

It is not. Following the value to its source at the pinned commit:

- `src/main/plugins/plugin-host-service-bindings.ts:61-64` — `sendTerminalText` returns
  `{ accepted: result.accepted }` from `delegate.sendTerminal(...)`.
- `src/main/runtime/orca-runtime.ts:18559-18614` — `sendTerminal` has exactly two success returns,
  both hard-coded `accepted: true`. Every other path **throws**: `terminal_not_writable`,
  `invalid_terminal_send`, `TERMINAL_INPUT_TOO_LARGE_ERROR`.
- `src/main/plugins/plugin-host-method-bindings.ts:99-106` — the binding itself throws
  `no active worktree is available for terminal input` and `terminal is outside the active worktree`.

Every failure arrives as a **thrown error**, which the panel bridge surfaces as
`{ ok: false, code: 'action_failed' }` (`plugin-panel-bridge.ts:53-62`). `accepted: false` is never
constructed anywhere in the tree. It is a permanently-green light, and the project's own standing
rule is that *"an indicator that never changes is a broken indicator."*

**Proposed resolution.** Both documents must check the **rejection path**, not the acknowledgement:
wrap the call and branch on the thrown error / `code`, mapping `action_failed`,
`capability_denied`, `consent_required` and `rate_limited` to the three named panel states 003 §5
already defines. 003 §5's sentence *"It is a real check"* must be deleted, and 002's check 3 must be
reworded from *"log the `false`"* to *"catch and name the throw."* Note that this also strengthens
003 §5: the throw carries a **reason**, which is strictly better than the boolean it was reaching for.

### E-03 · needs-a-decision · 003 §2 Q13

**Three of the four segments in the Stop budget are unmeasured and unlabelled, the fourth is
measured for a different quantity on a player we cannot assume exists, and the sum leaves zero
headroom for a claim of headroom.**

The table, audited row by row:

| Segment | Budget | 003's stated basis | Audit |
|---|---|---|---|
| click → panel JS → bridge → gate → PTY write | 60 ms | *"local IPC; the gate is a synchronous table lookup"* | **not measured, not labelled.** The gate being a table lookup bounds the *gate*, not the postMessage hop, the capability check, the worktree re-listing (`listWorktreeTerminals`, an async call — `plugin-host-method-bindings.ts:104`), or the PTY write |
| PTY → control-pane reader → socket → worker | 40 ms | *"line read on an already-running process, kept-open socket"* | **not measured, not labelled**, and it describes a process that does not exist yet |
| worker: bump gen, clear queue, cancel synthesis | 100 ms | *"already implemented"* | **not measured, not labelled.** The suite prints two real numbers here — `OsSynthProvider: cancel -> stopped in 0 ms` and `cancel -> return: 1 ms` — which would have *supported* the claim. Neither is cited |
| audio device drain | 50 ms | *"requires a bounded sink buffer; `ffplay.kill()` measured at 1.5 ms (PITFALLS P9)"* | The 1.5 ms is real, but it is **kill latency, not drain latency** — two different quantities. And P9 says `ffplay` *"arrives via Homebrew"*, so it is not the sink on any stock platform. The one measured number in the table is measured on a player we cannot ship |
| **total** | **250 ms** | | `60 + 40 + 100 + 50 = 250` — the sum of every segment at its **maximum** equals the **p99**, so the p99 has exactly zero headroom, while the surrounding sentence claims *"achievable with headroom on route 2"* |

Constitution IX and R006 require a label on every latency number. None of these carries one.

**Proposed resolution.** Relabel every segment `[claimed]` until it is measured; cite the two real
cancel measurements the suite already prints for the third row; retire the `ffplay` basis or restate
it as *"drain is unmeasured; kill is 1.5 ms on a player we do not ship"*; and either raise the p99 to
leave headroom or state plainly that p99 is the sum-of-maxima and therefore not achievable in the
common case. See also C-02 on making this a CI gate.

### E-04 · needs-a-decision · 005 §11.1, §13

**The 140 ms earcon is arithmetic (60 + 20 + 60), it is correct as arithmetic, and it omits the
dominant term.**

005 §11.1 and §13 cost the earcon at *"~140 ms, once per speaker-turn"*, and options D and E in §13
list *"~140 ms"* as the whole cost. The earcon is specified as *"an `AudioChunk` prepended to the
utterance"* at the provider's sample rate.

`SubprocessSink` spawns **one player process per chunk**, and its own header states the cost:
*"one process per chunk gives a ~970 ms inter-sentence gap on macOS (`afplay`)"*
(`sinks/subprocess-sink.ts:8-10`). So on v1 the earcon does not cost 140 ms; it costs 140 ms of tone
plus a spawn, and it inserts that spawn **before the first word** — directly into the path R4.2
budgets at 500 ms.

There is a second-order consequence 005 also misses: the earcon is generated PCM, and
`AudioChunk.format` is provider-chosen (`core/src/types/index.ts`, and 004 §2 makes the same point).
A synthesized tone prepended to an `os-synth` `'wav'` stream is a **format-mixing** case nothing in
the sink handles today.

**Proposed resolution.** State the earcon's cost against the shipped sink, not against its own
sample count — *"140 ms of audio, plus one sink spawn (~970 ms on v1 macOS) until M9 holds a player
open"* — and say which milestone makes it affordable. If the answer is M9, then per-turn earcons are
an M9-dependent feature and §13's options D and E should say so, because on v1 they are the slowest
options in the table rather than the cheapest.

### E-05 · worth-noting · all four

**Which numbers are measured, and which are arithmetic wearing a measurement's clothes.** The brief
asked; here is the audit.

| Number | Status | Where it actually comes from |
|---|---|---|
| `say ""` ≈ 414 ms | **MEASURED** | PITFALLS P10, 5 runs, min 414 / median 418 |
| `say -v '?'` ≈ 450 ms | **MEASURED** | `q-round1-platform.md` "Cost of `listVoices()`", 5 runs: 456/439/451/460/442 |
| `ffplay.kill()` = 1.5 ms | **MEASURED** | P9. But it measures kill, not drain — see E-03 |
| `OsSynthProvider cancel` = 0–1 ms | **MEASURED** | printed by the test suite; **not cited by any of the four** |
| 55,050 PCM frames, 9/9 word boundaries | **MEASURED** | compiled Swift probe, `q-round1-platform.md` |
| 41 English voices, 24/24 distinct md5 | **MEASURED** | `q-round1-platform.md` |
| Windows = **2** voices | **DOCUMENTED, never run** | Microsoft docs + a StackOverflow answer + a `dotnet/runtime` source read. The research's own residual **U1** says the probe requires a Windows 11 box and has not been run. 005 §1's verdict table prints `6` and `2` with no label |
| Ubuntu has no `/usr/bin/espeak-ng` | **DOCUMENTED, never run** | the 24.04.3 image manifest. Residual **U4/U5** unrun |
| **~970 ms** inter-sentence gap | **UNLABELLED** | asserted in `subprocess-sink.ts:8-10`'s own header and repeated by HANDOFF; no probe, no run count, no date anywhere in the repo. 004 row 34 ships it as a preset labelled *"(v1 macOS, **measured**)"* — that label is not supported by anything I could find |
| **~140 ms** earcon | **ARITHMETIC** (60 + 20 + 60), and incomplete — E-04 |
| **~350 ms** call-sign | **ARITHMETIC / estimate**, from "one word, one or two syllables". No probe. It is the per-turn cost of the design's headline mechanism |
| **~1,200 ms** for a spoken session name | my own arithmetic in X-05, at 175 wpm. Nobody costed it |
| 003's **60 / 40 / 100 / 50** ms segments | **ASSERTED**, unlabelled — E-03 |
| 003's **250 ms** p99 | **ARITHMETIC** — the sum of the four asserted segments |
| 003's **~20–60 ms** (keypress) and **~40–120 ms** (route 2) | **ASSERTED**, and route 2 contradicts the same section's 250 ms |
| 003's **495 ms** polled worst case | **ARITHMETIC**, and it is *good* arithmetic — `10000/30 = 333`, +1 pong → ~345, +150 cancel-and-drain. Derived from `plugin-panel-bridge.ts:22-23`, which I verified. This is the model the other numbers should follow |
| 003's **26 of 29 slots** for a per-word cursor | **ARITHMETIC**, sound, and clearly shown |
| 005's **3^(1/10)** Windows rate curve | **ASSUMPTION**, and 005 says so explicitly and funds the calibration probe (§8.3). Correctly handled |
| 005's `pbas = 46 + semitones` | **DOCUMENTED**, flagged; espeak `-p` mapping flagged **ASSUMPTION**. Correctly handled |

The pattern: 005 is scrupulous about labelling its *inputs* and silent about labelling its
*outputs* (140, 350). 003 is rigorous where it derives from a cited constant (the poll ceiling, the
bandwidth arithmetic) and asserts where it derives from nothing (the four segments). The ~970 ms is
the one number the whole project leans on that nobody has ever measured — it appears in a code
comment, HANDOFF, 004 §2 four times, 004 row 34, 004 §9, and the M9 justification.

**Proposed resolution.** Measure the ~970 ms, once, and record it in PITFALLS with a run count — it
is a five-minute probe and it is load-bearing for M9, for 004's entire Q20 verdict, and for E-04.
Label the derived numbers `[claimed]`.

### E-06 · needs-a-decision · 005 §8.4, §16 prereq 4b, 004 §Q45

**The normalizer destroys the in-band commands 005 wants to emit, and lets through the one that
matters for injection. Both directions verified by effect.**

Running the real `normalize()`:

```
"x [[pbas 46]] y"           ->  "x [[pbas forty six]] y"
"say [[slnc 2000]] now"     ->  "say [[slnc two thousand]] now"
"say [[volm 0.2]] quietly"  ->  "say [[volm 0.2]] quietly"      <- survives verbatim
```

Two findings in one probe.

**Emission.** 005 §8.4 says *"`pbas = 46 + semitones`"* and §8.5 says *"prepend `[[pbas n]]`"*, and
neither says **where in the 15-stage pipeline**. Stage 13 `expandNumbers` rewrites bare integers to
words. If the pitch command is prepended before `normalize()` runs — the natural reading of "prepend"
— it arrives at `say` as `[[pbas forty six]]`, which is not a command, and the pitch is silently
lost. That is the P18 shape: an identity that reports tier 1 while sounding exactly like tier 0. And
005 §6's `D_MIN` guard is what *allows* two sessions to share a voice at ±3 semitones — so the
failure is two agents who are supposed to be distinguishable and are not.

**Injection.** 004 §Q45 says *"On macOS, `[[` in user text is interpreted as an embedded speech
command (measured …)"*. Half true, and the half that is true is the dangerous half: integer
arguments are accidentally defused by `expandNumbers`, but **decimal arguments pass through
untouched** (decimals are deliberately handed to the engine — `normalizer/index.ts:518-560` region,
H15). So `[[volm 0.2]]` in an agent reply reaches `say` intact. An agent that emits `[[volm 0]]` —
or a repository containing that string in a code comment — silences the assistive tool with no error
and no indication. That is a *current* defect in shipped v1, not a future one, and it is more
serious than either document frames it.

**Proposed resolution.** (a) The `[[` escaping stage 005 lists as prerequisite 4b is not a
prerequisite of M15 — it is a bug fix for v1, and should be sequenced accordingly. (b) 005 must
state that the pitch command is emitted by the **pause/prosody rendering stage** 004 §6a proposes
(the final, per-provider stage), *after* `expandNumbers`, and never by prepending to the input. That
also unifies it with 004's pause-token design, which is the right home for it.

### E-07 · worth-noting · 005 §1, §5

**The design's binding number — Windows = 2 — has never been observed on a Windows machine.**

005 §2's header is honest: *"All rows MEASURED or DOCUMENTED … none are recollection."* But §1's
verdict table, which is the first thing a reader sees and the thing the five-line recommendation
rests on, prints `66 / 6 / 0–2 / 1 / ≥ 30 × unbounded` with **no labels at all**, and §5's arithmetic
table likewise. A reader takes 2 for a measurement.

The chain behind it is: a Microsoft `GetInstalledVoices` doc page listing shipped-engine language
coverage, a StackOverflow answer naming the `*Desktop` pair, and a `dotnet/runtime` source read
establishing that pre-.NET-10 `System.Speech` reads only the SAPI5 registry key. That is a good
chain. It is not a reading from a machine, and `q-round1-platform.md`'s own residual **U1** says so
in as many words. **U3** — whether `SelectVoice` on an unknown name throws or falls back, the
Windows twin of the macOS silent-fallback lie — is also unrun, and 005 §10 F4 designs a read-back
check for a behaviour nobody has observed.

**Proposed resolution.** Label §1 and §5 per row. Since 005 §16 already funds a Windows-dependent
prerequisite (the `SpeakSsml` migration) and 005 §17 Q43 already specifies a Windows probe, fold
U1 and U3 into that same trip to a Windows box. The design does not change; the confidence label
does, and R006 requires it.

### E-08 · worth-noting · 004 §1

**004's "Build hazard, inherited" is already fixed.** `git ls-files packages/core/dist` returns zero
files. The instruction *"Delete `packages/core/dist/` from the index before T111 starts"* is a no-op,
and the surrounding claim (*"tracked and two normalizer commits stale"*) is no longer true. Harmless,
but it is the same staleness as X-07 and E-01 and it should go when they do.

---

## Part 3 — Constitution violations

The known self-declared one — the `spd-say` rung playing its own audio, against R021 *"Providers
emit audio and never own playback"* — is declared in the source comment (`os-synth/index.ts:78-83`),
in PITFALLS P25, and in 005 §5. That is acceptable engineering and I am not counting it. What
follows is undeclared.

### C-01 · needs-a-decision · R006, Principle IX · 003, 004, 005

**Latency numbers presented without the mandatory label.** R006: *"Label every latency number
`[measured-here]`, `[measured-third-party]`, or `[claimed]`."* Principle IX repeats it. Unlabelled:
003's 60 / 40 / 100 / 50 ms segments, its 250 ms p99, its ~20–60 ms and ~40–120 ms route figures,
its ~345 ms sustainable poll floor; 005's ~140 ms earcon, ~350 ms call-sign, and every number in
§1 and §5; 004's 300 ms compare earcon, 150 ms state earcons, and the *"(v1 macOS, measured)"* label
on 970 ms, which asserts a label the repo cannot support. See E-05 for the full audit.

### C-02 · blocks-implementation · R073, R003, Principle IX · 003 §2

**A CI gate is declared for an architecture whose feasibility is an open question in the same
document.** 003 §2: *"Above 400 ms is a defect that fails CI, not a slow day"*, and the
engineer-prompt: *"Ship with a latency test that fails above 400 ms."*

R073 makes performance budgets gates. But 003's own §12 lists **Q45** (*"Is `orca-tts control` viable
as a foreground TUI inside an ORCA pane — does it survive pane restore, daemon reconnect, and
resize?"*) and **Q46** (*"Does the plugin worker's lifetime allow a listening unix socket at all? …
**This is the single largest risk to the recommendation**"*) as unanswered. A gate on a path that may
not exist is not a gate; it is a red light nobody can turn green, and R068 will burn its three
attempts on an architecture question rather than a performance one.

**Proposed resolution.** Sequence Q45 and Q46 as probes **before** the budget becomes a gate, and
say in 003 that the number is a target until they resolve. This costs nothing and it is what
Principle IX asks for: *"Before a design depends on a behaviour, someone runs it."*

### C-03 · needs-a-decision · R013, Principle III · 003 §2/§4, 005 §7.1/§9

**Two designs are POSIX-shaped and neither declares a Windows story.**

- 003 says *"unix socket"* six times and *"kept-open unix socket"* in its engineer-prompt. Node's
  `net` module does abstract this to named pipes on Windows, but the path form, the permissions
  model and the cleanup semantics all differ, and 003 states none of it. Its Q46 — the socket's
  survival across a worker re-fork — is a different question on Windows than on macOS.
- 005 §7.1 makes liveness *"`process.kill(pid, 0)` **or** the existence of `messagingSocketPath`"*.
  `messagingSocketPath` is `/tmp/cc-socks/<pid>.sock` (`q-round1-buzz-transcript.md` Q27) — a POSIX
  path that does not exist on Windows. And `process.kill(pid, 0)` on Windows throws `EPERM` for
  processes the caller cannot open, which is a *different* signal from "alive", so the check reads
  a live session as dead or vice versa depending on elevation.

R013: *"A feature that works on one OS and degrades on another is not done."* Both designs claim R1
parity in their headline sections.

### C-04 · needs-a-decision · R024, R062, Principle VI · 004 §7

**Writing into the user's home directory, and specifically into ORCA's own config directory, with
no stated reason.** Principle VI and R024: *"We only read from the user's transcripts and
configuration. We never write to them."* R062: *"a write to anything under their home directory needs
a stated reason."*

004 §7: *"the plugin reads `~/.orca/read-aloud/settings.json`, and the lab writes exactly that path
when the listener presses **Save to plugin**."* The file is ours, so R024 is arguably not violated in
spirit — but R062's stated-reason requirement is unmet, and `~/.orca/` is ORCA's namespace, not ours.
See X-06 for the alternative that ORCA already provides.

### C-05 · needs-a-decision · Principle IV, R018 · 003 §8.7, 004 §2, 005 §4

**Three documents widen the provider seam independently, and none knows about the others.**

- 005 §4: `ProviderCapabilities += { identity: { voices, pitch, rate } }` and
  `SynthesizeOptions += { pitchSemitones? }`.
- 003 §8.7: *"the provider interface grows `pause()` / `resume()` alongside `cancel()`"*, with a
  `pause_unsupported` refusal.
- 004 §2: *"the lab's audio layer must accept any `AudioChunk` the provider contract allows … Branch
  on `chunk.format`"*, plus row 45's `interrupt.granularity` which implies a third capability.

Principle IV fixes the declared capability set at
`{streaming, offline, needsApiKey, needsModelDownload, licence, cloning, sampleRate}` and says
*"The engine interface is written and tested before any concrete engine is integrated."* Three
uncoordinated extensions to a seam whose whole purpose is to be stable is the failure the principle
exists to prevent — and X-03's earcon adds a fourth (generated PCM at the provider's sample rate,
with a format that may not match the provider's).

**Proposed resolution.** One provider-contract change, one document, one test suite, landing before
M11 — because 004 depends on `chunk.format`, M13 depends on `pause()`, and M15 depends on
`identity` and `pitchSemitones`. Doing it three times will produce three shapes.

### C-06 · blocks-implementation · R009, R015, Principle I · 002 check 3, 003 §5

**A degradation indicator that is structurally incapable of changing.** Covered as E-02; recorded
here because it is a NON-NEGOTIABLE (Principle I: *"Never fail silently"*) and because both
documents cite it as the thing that *satisfies* the principle.

### C-07 · worth-noting · R016 · 004, 005

**R016: *"Name every limitation in the body of the doc, never imply it away in a footnote."***
005's earcon cost omits the sink (E-04) — not footnoted, simply absent. 004's Q20 verdict omits the
`spd-say` rung (X-10) — the document's single biggest platform limitation, absent from the section
that decides the architecture. Both documents are otherwise unusually good at this; 004 §2's
"Consequence, stated rather than hidden" and 005 §8.5's itemised cost table are models of it.

### C-08 · worth-noting · rule numbering · 004 §2

**004 cites the wrong rule number.** *"contradicting R5.2 / constitution **R023** — providers emit
audio and never own playback."* R021 is *"Providers emit audio and never own playback."* R023 is
*"Keep the plugin under 2,000 files and 50 MB."* The same miscitation exists in the source comment at
`os-synth/index.ts:71` (*"Playback stays with the client (R023)"*) and again at `:189`
(*"(R022, two-sided)"*, where two-sided cancel is R014) — so this looks like an older numbering that
survived the constitution's 2.0.0 renumbering. Worth a sweep, because R-numbers are the project's
citation currency and R-numbers are declared **stable and never reused**.

### C-09 · worth-noting · R032, PITFALLS P12 · `PITFALLS.md`

**There are two `## P27` entries in `PITFALLS.md` right now** — *"Parallel ORCA dev builds share one
userData profile"* and *"`espeak-ng --stdout` emits a WAV that claims 2 GB"*. That is the exact
collision P12 was written about and R032 exists to prevent. Outside the four documents, but I was
asked to read the file and it is a two-minute fix before the numbers get cited anywhere.

### What is compliant, and worth saying

- **Principle V / R003 negative controls.** 004 §7 step 4 (*"the test also mutates one field and
  asserts the comparison now **fails**"*), 005 §15's last row (*"Run the same blind test with
  per-agent identity **disabled** … scoring well anyway … would mean the test measures something
  else"*), and 003's *"assert the sink produced **no samples** after `press + 250 ms`"* are all real
  checks that could fail. This is the hardest thing on the list to do and three of four documents did
  it unprompted.
- **R020.** 004 §8 rule 3 routes the speak-on-change confirmation *"through the **same** normalize →
  chunk → synthesize path as the fixture, so it is never a second speech implementation that can
  drift."* Correct, and it is the rule most designs get wrong.
- **R008.** 003 §1 F3 re-verified the panel→worker channel rather than inheriting it, and found it
  non-existent. 005 §8.3 refuses to ship `3^(1/10)` as fact and funds the calibration probe. Both are
  the principle working.

---

## Part 4 — What all four missed

The four were briefed from one research round by one person, and the shared gap is legible: **every
document designs the first ten minutes of use.** Nothing designs the tenth hour, the second machine,
or the reply that does not fit.

### B-01 · blocks-implementation · the second day, and the 301st reply

`MAX_REMEMBERED_IDS = 300` (`huddle/index.ts:40`) caps the set of already-spoken reply uuids, and
`#spoken` is trimmed to the **last 300** (`:186`). 004 lists it as *"defensible as fixed (H33)"* and
moves on; nobody asks what happens at 301.

What happens: id 1 is evicted while its transcript line is still on disk. `WATCH_WINDOW_MS` re-opens
the watch on every `agent.status.changed`, and ORCA re-forks the worker after five minutes idle
(P20/P6) — at which point `#spoken` is restored from storage with 300 entries, or rebuilt empty. A
long session on the far side of an eviction re-reads replies the listener already heard.

That is P22's third fault with a new cause: *"the whole history was read out."* P22 cost a pitfall
entry and a milestone. Nothing in 002, 003, 004 or 005 mentions it. 003 §7's mute/replay design makes
it worse, not better — a muted session's replies go to the replay buffer, and the replay buffer's
relationship to `#spoken` is undefined.

**Proposed resolution.** Bound by **time or transcript offset**, not by count: remember the byte
offset last read per transcript, which is O(1) per session and cannot be evicted into a re-speak. If
the id set stays, its eviction must be a *floor* (never speak a record older than the oldest
remembered id), which is a three-line change and turns an unbounded failure into a bounded one.

### B-02 · needs-a-decision · pid reuse, and the `procStart` field nobody used

005 §7.1 and 003 §1 F5 both make liveness *"`process.kill(pid, 0)` or the socket, **never**
`updatedAt`"*. Correct as far as it goes — and both stop one step short.

`~/.claude/sessions/<pid>.json` is keyed by **pid**, and pids are recycled. The registry file is
removed on clean exit (verified in Q27's before/after probe) but survives a **crash** — and P22, P27
and the whole "three of these terminals share one worktree" observation say crashes happen here. A
recycled pid makes `kill(pid, 0)` return alive for an unrelated process, so a dead session stays on
the roster, holds its voice slot, and blocks a live session out of tier 0 into tier 1 — where 005's
rules make the call-sign mandatory on every turn. A stale registry file degrades the *audio* of every
other agent.

The fix is already in the data. Q27's key list includes **`procStart`** — and neither design uses it.
Comparing `procStart` against the process's actual start time makes the liveness check
pid-reuse-proof.

**Proposed resolution.** Liveness = `kill(pid, 0)` **and** `procStart` matches. Add a roster reaper:
any registry entry whose pid is alive but whose `procStart` disagrees is stale, is removed from the
roster, and — because it was holding a slot — triggers a reassignment that 005 §9 already knows how
to announce.

### B-03 · needs-a-decision · what any of this costs while idle

No document contains a CPU, wakeup or battery figure. Constitution Principle VI is *"Never Degrade
the Host"*, and this is the half of it nobody costed. Adding up what the four propose to run
continuously on a laptop:

- huddle's `fs.watch` plus a 250 ms debounce, per followed transcript (`huddle/index.ts:42-43`);
- 003's control-pane TUI: a foreground Node process, rendering a live per-word cursor at 2.5–3.0
  updates/second per speaking session, over a socket, and repainting an 80×24 frame;
- 003's panel poll at *"1 Hz nominal, 2 Hz for five seconds after any user action"*;
- 003's watchdog pong every 10 s, forever;
- 003 §8.7 rule 4's paused heartbeat earcon **every 30 seconds, indefinitely** — which wakes the
  audio device, on a machine whose owner may have paused it and walked away;
- 005 §10 F3b's background distinctness probe: *"41 × ~450 ms ≈ 18 s"* of `say` spawns;
- 005 §8.3's rate calibration: a 60-word passage at **21** Windows control values, or **38** macOS
  `say -r` values — 38 more spawns;
- 004's lab server, when open.

Individually each is defensible. Together, a plugin that is *not speaking* holds a foreground TUI, a
socket, two timers, a file watch and a periodic audio-device wake. On battery, the 30-second
heartbeat alone prevents the audio hardware from ever entering its idle state.

**Proposed resolution.** One line per design: what runs when nothing is being spoken, and at what
period. Then one rule — nothing polls or wakes while the queue is empty *and* the host reports
unfocused — with the paused heartbeat backing off exponentially (30 s, 60 s, 120 s, then stop and
say so once) rather than running forever. That preserves 003's actual requirement (*paused* must not
be confused with *crashed*) at a fraction of the cost.

### B-04 · needs-a-decision · the user takes a call

Nothing in any document handles other audio. This is not a nicety for a voice-first user: a phone
call, a meeting, a dictation session, or ORCA's own first-party STT (which exists —
`src/main/speech/`) all want the channel.

It is also structural rather than an oversight to patch later. Our playback is a **spawned
subprocess** (`afplay` / `ffplay` / `aplay`) precisely because of P9. A spawned player participates
in no audio session policy: it cannot request ducking, cannot be ducked by us, and cannot be told to
yield. So "duck when a call starts" is not a feature we can add to the current sink — it is another
argument for the M9 resident service and the macOS sidecar, and it belongs in the case for them.

The near-term half is cheap and nobody wrote it: 002's Option E and 003's controls give the listener
*stop*, and 003 gives *pause* — but neither is reachable from outside ORCA, and the moment a call
starts is the moment the user is least able to find a window and click. A global mute that survives
terminal focus is exactly the F6 problem 003 solved for Stop, unsolved for the case where it matters
most.

**Proposed resolution.** Short term: 003's route 4 (`orca-tts stop` / `orca-tts mute`) is the only
route that works from outside ORCA — say so, and document it as the take-a-call answer. Medium term:
make "an exclusive audio session appeared" a first-class input to the state machine in 003 §10.1,
alongside `mute` — it is a *level*, exactly like mute, and it costs one state. Long term: it is a
requirement on M9's sink, and it should be written into M9's brief now.

### B-05 · blocks-implementation · the 40,000-character reply

There is **no length cap on the huddle path at all.** `huddle/index.ts:179` hands the whole decoded
reply to `speak(text, 'queue', label)`. The chunker splits at `DEFAULT_MAX_UNITS = 200`
(`chunker/index.ts:53`), and the queue caps at `maxQueued: 8` — **eight replies, not eight chunks**
(`main.ts:96`, `speech-service.ts:55`). So a single reply is never dropped by overflow, however long
it is.

40,000 characters ≈ 200 chunks. At 200 chars ≈ 30 words ≈ 10 s of speech, that is **~33 minutes of
audio**, plus — on v1 macOS — 200 sink spawns at ~970 ms each, **another ~3 minutes of silence
distributed through it**. Stop works (003), but the queue behind it does not shrink, and the listener
who wanted the last sentence must sit through or lose all of it. 002's Option D would announce the
artifacts it skipped and still speak every remaining word.

The comparison is damning because the project already found the answer and declined to copy it.
003 §9 adoption 3 cites `agent_tts_routing.rs:27-40` — buzz *"caps text at 8,096 chars and appends
`"... message truncated."` **aloud**"* — and adopts **only the announcement**, not the cap. The cap is
the mechanism; the announcement is what makes the cap honest. Our own clipboard path already does
both (`DEFAULT_MAX_CHARS = 20_000`, truncation announced at `main.ts:76`); the huddle path, which
takes untrusted input from a model, does neither.

**Proposed resolution.** A per-utterance character cap on the huddle path, announced aloud in the
buzz shape, with the remainder retained in 003's replay buffer so nothing is lost — *"that reply was
long; I read the first two minutes. Press R for the rest."* The number is taste and belongs in
004's Panel F next to `input.clipboardCap` (row 43), which is the same control for the other input.
The **existence** of the cap is correctness.

### B-06 · needs-a-decision · text that is not English

Absent from all four, and it is not a localisation nicety — it is a wrong-output path.

Concretely, every stage that makes speech good is English-only: `EXTENSION_WORDS` (32 English
words), `UNIT_WORDS` (11), `KEY_GLYPHS`, `ABBREVIATIONS` (30 English tokens,
`chunker/index.ts:46-51`), and `expandNumbers`, which emits English number words. 005's 64-word
call-sign list is English. 003 §6 speaks registry names *"with hyphens as word breaks"*, an English
convention.

The platform data makes the gap visible: macOS lists **184** voices of which 41 are English, and 005
designs against *"22 prose-quality"* English ones — the other 143 are invisible to the design. A
German or Hebrew paragraph in an agent reply is handed to Samantha and mispronounced end to end, with
the numbers expanded into English words inside it. For a **dyslexic** listener, that output is not
degraded, it is unusable — and it fails silently, which is the Principle I violation.

**Proposed resolution.** Not full i18n. Two things: (a) a per-utterance language **detection** hook
(the normalizer already has a stage boundary; a script-range heuristic catches the common cases
cheaply), and (b) a stated policy when the detected language is not the voice's — either announce it
once (*"the next paragraph is not in English"*) and speak it anyway, or skip it with 002's Option D
announcement machinery, which already exists for exactly this shape of omission. Either is
defensible; silence about it is not.

### B-07 · worth-noting · hearing something again from twenty minutes ago

Partial credit, honestly reported: **003 has a story and the other three do not.** §4 lists *"Last
20 — replayable"*, §3 defines a `replay` verb marked *"never stale"*, §7 routes muted replies into
the buffer, and §8.7 moves a paused backlog there.

Three limits nobody names:
1. **Twenty items is minutes, not twenty minutes.** In an active huddle, twenty replies is roughly
   the last ten to fifteen minutes; the brief's question falls just outside it.
2. **It is TUI-only.** The panel is read-blind (003 §4), so replay is reachable only from a control
   pane the user must open by hand (003 Q43) — which X-01 shows we cannot even address reliably. On a
   machine with no control pane there is no replay at all.
3. **No lifetime is stated.** Does the buffer survive the five-minute worker reap (P20)? 003 §7 rule
   5 says *mute state* survives *"by living in plugin storage"* and says nothing about the buffer.
   Twenty replies at a few KB each against `PluginKvStore`'s 256 KB per-value limit (005 §9 cites it)
   is a real constraint nobody checked.

The genuinely missing capability is **time-addressed** recall — *"what did it say around three
o'clock"* — which is trivially available, because the transcripts are on disk with timestamps and we
already glob them by `sessionId`. Nobody proposed it.

**Proposed resolution.** State the buffer's lifetime and storage cost in 003 §7. Add one CLI verb
(`orca-tts replay --since 20m`) reading the transcript directly rather than the buffer — it needs no
panel, no control pane and no new state, and it is the only replay route that works on the day none
of the surfaces exist.

---

## Part 5 — All findings

| ID | Severity | Spans | One line | Who must decide |
|---|---|---|---|---|
| **X-01** | blocks-implementation | 003, 002 | The panel cannot identify the control pane among opaque terminal ids; guessing types a control envelope into the agent's terminal as a spoken user turn | an agent — nonce handshake with `enter:false`, then 003 §2D is rewritten |
| **X-02** | blocks-implementation | 003 | One stdin cannot be a raw keypress reader and a line reader; the Stop envelope's own letters are the control keys | an agent — pick a framing sentinel |
| **X-03** | blocks-implementation | 005, 003, 004 | 005 allocates all 30 earcon motifs to identity; 003 and 004 need ~14 more from the same space | an agent for the reservation scheme; the listener for the motifs |
| **X-04** | needs-a-decision | 003, 005, 004 | Two incompatible call-signs (one word vs two, probe vs append, first vs last), and 004's option space expresses neither while defaulting to 8 hex chars | an agent picks the mechanism; the listener picks the wording |
| **X-05** | needs-a-decision | 002, 003, 004, 005 | ~2.7 s of earcon + call-sign + identity before a 1.0 s reply; three "regardless" rules, no arbiter | the listener sets the budget; an agent builds the arbiter |
| **X-06** | needs-a-decision | 004, 003 | Settings file has no generation and is a control-plane mutation; and it lands in `~/.orca/`, not ORCA's plugin data dir | an agent |
| **X-07** | blocks-implementation | 004, 005 | H24, H25 and ordered-list ordinals are asserted as current defects; all three were fixed before the docs were written; `orderedList` is missing from the settings schema | an agent |
| **X-08** | needs-a-decision | 002, 004 | Option D's skip vocabulary has no controls in M11 and no migration path past a frozen `schemaVersion: 1` | an agent for the schema; the listener for the words |
| **X-09** | needs-a-decision | 003, 004, 005 | `Space`, `R`, `M` and "stop" mean different things in the TUI and the lab; a third spoken vocabulary in 005 | the listener, from one shared table an agent writes |
| **X-10** | blocks-implementation | 004, 005 | On the Linux `spd-say` rung the provider speaks and yields no bytes; 004's browser-plays architecture and its `503` both fail silently | an agent |
| **X-11** | worth-noting | 003, 005 | Stop-during-earcon undefined; stale Stop gives no confirmation; 003's two route-2 numbers disagree (40–120 vs 250 ms) | an agent |
| **E-01** | blocks-implementation | 002, 004, 005 | ~30 citations into `packages/` are stale by 15–150 lines; 003's ORCA citations are all correct | an agent |
| **E-02** | blocks-implementation | 002, 003 | `terminal.sendText` never returns `accepted:false` — every failure throws; both docs' "real check" is a permanently-green light | an agent |
| **E-03** | needs-a-decision | 003 | 3 of 4 Stop-budget segments unmeasured and unlabelled; the measured one measures kill, not drain, on a Homebrew-only player; sum = p99 with zero headroom | an agent |
| **E-04** | needs-a-decision | 005 | The 140 ms earcon omits the ~970 ms sink spawn it inserts before the first word | an agent |
| **E-05** | worth-noting | all four | Full measured-vs-arithmetic audit; the load-bearing ~970 ms has never been measured anywhere in the repo | an agent — run the probe |
| **E-06** | needs-a-decision | 005, 004 | `expandNumbers` destroys `[[pbas 46]]` (verified) while `[[volm 0.2]]` passes through verbatim — a live silencing injection in shipped v1 | an agent |
| **E-07** | worth-noting | 005 | Windows = 2, the design's binding number, is DOCUMENTED and unrun; §1 and §5 print it unlabelled | an agent — fold U1/U3 into the Q43 Windows trip |
| **E-08** | worth-noting | 004 | The `packages/core/dist/` build hazard is already fixed; 0 tracked files | an agent |
| **C-01** | needs-a-decision | 003, 004, 005 | R006 / Principle IX: latency numbers without the mandatory label | an agent |
| **C-02** | blocks-implementation | 003 | R073: a CI gate on an architecture whose viability is 003's own Q45/Q46 | an agent — probe first, gate second |
| **C-03** | needs-a-decision | 003, 005 | R013: unix socket, `/tmp/cc-socks`, and `kill(pid,0)` all have undeclared Windows behaviour | an agent |
| **C-04** | needs-a-decision | 004 | R024 / R062: writes under the user's home, inside ORCA's namespace, with no stated reason | an agent |
| **C-05** | needs-a-decision | 003, 004, 005 | Principle IV / R018: three uncoordinated extensions to the provider seam, plus a fourth implied by the earcon | an agent — one contract change before M11 |
| **C-06** | blocks-implementation | 002, 003 | Principle I / R009: the degradation indicator cannot change (same as E-02) | an agent |
| **C-07** | worth-noting | 004, 005 | R016: 004 omits the `spd-say` rung, 005 omits the earcon's sink cost | an agent |
| **C-08** | worth-noting | 004 (+ source) | R021 miscited as R023; source comments also use R022/R023 from an older numbering | an agent — sweep |
| **C-09** | worth-noting | `PITFALLS.md` | Two `## P27` entries live right now; R032 / P12 | an agent |
| **B-01** | blocks-implementation | all four | At reply 301 an evicted id can be re-spoken — P22's "the whole history was read out" with a new cause | an agent |
| **B-02** | needs-a-decision | 003, 005 | Pid reuse defeats `kill(pid,0)`; a crashed session holds a voice slot and pushes live agents into mandatory-call-sign tiers. `procStart` is already in the registry and unused | an agent |
| **B-03** | needs-a-decision | all four | No idle CPU/battery figure anywhere; a paused plugin wakes the audio device every 30 s forever | an agent |
| **B-04** | needs-a-decision | all four | No ducking story, and a spawned player cannot duck — a structural argument for M9, plus a near-term "take a call" route | the listener on behaviour; an agent on the M9 requirement |
| **B-05** | blocks-implementation | all four | No length cap on the huddle path: a 40,000-char reply is ~33 min of audio no overflow rule can drop. buzz's 8,096-char cap is cited and not adopted | an agent for the cap; the listener for the number |
| **B-06** | needs-a-decision | all four | Non-English text is spoken by an English voice with English number expansion, silently. Every lookup table is English-only | the listener chooses announce-vs-skip; an agent builds detection |
| **B-07** | worth-noting | 003 (others silent) | Replay exists but is 20 items, TUI-only, with no stated lifetime, and there is no time-addressed recall | an agent |

**Distribution:** 8 blocks-implementation · 11 needs-a-decision · 8 worth-noting.

**The most dangerous is X-01.** It is not the hardest to fix — the nonce handshake is an afternoon.
It is the most dangerous because of what it does when it is wrong: 003's Stop, the control the whole
document exists to deliver, becomes a message typed into the agent's session, which the agent answers,
which huddle reads aloud. The listener presses Stop and the machine starts talking. That is the exact
sentence 003 was written against — *"this is really confusing, what is it even reading right now… a
way to control something and not feel helpless"* — reproduced by the fix for it, and it will not
appear in any test that mocks `workspace.readContext` with a single terminal.
