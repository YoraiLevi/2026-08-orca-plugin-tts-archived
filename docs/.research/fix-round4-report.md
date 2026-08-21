# Fix round 4 — the audio stream becomes the channel

> Written 2026-08-21. Six fixes from `docs/design/006-fma.md` sections 16/20 and cascades C4/C5/C6,
> plus cross-review `008` findings E-06 and B-01. Suite went **161 -> 180 tests, all passing**.
> Every fix carries a test that failed before the change, with the real output recorded.

| Fix | Status | Commit |
|---|---|---|
| 4 · `[[` executed as a macOS/espeak speech command | fixed | `3be8cb1` |
| 1 · route losses and degradations into spoken audio | fixed (one stated exception) | `7387862` |
| 2 · status/toggle/unfollow must not destroy the queue | fixed | `adea9ec` |
| 3 · huddle served nothing to non-Claude agents | fixed (one stated limit) | `bd8c4cd` |
| 5 · the 301st reply could be spoken again | fixed, plus TT10 and C9 | `393248f` |
| 6 · `switchTo` was unreachable | fixed (wired, not deleted) | `9cac384` |

Also added: `PITFALLS.md` **P30** (count verified 30 -> 31, one entry, appended once — P24's rule).

---

## Fix 4 — `[[` in an agent reply is executed as a speech command

**What was wrong.** `os-synth/index.ts:312` handed normalized text straight to `say`, and none of
the fifteen normalizer stages escapes `[[`. Confirmed by effect before touching anything:

```
$ say -o a.wav --data-format=LEI16@22050 "hello [[volm 0.2]] world"
$ say -o b.wav --data-format=LEI16@22050 "hello [ [volm 0.2]] world"
$ say -o c.wav --data-format=LEI16@22050 "hello world"
a.wav 41258      <- identical to the sentence without the brackets: EXECUTED, not spoken
b.wav 129692     <- the words are synthesized
c.wav 41258
```

And through the real normalizer:

```
"x [[pbas 46]] y"          ->  "x [[pbas forty six]] y"     (defused by accident)
"say [[volm 0.2]] quietly" ->  "say [[volm 0.2]] quietly"   (survives verbatim)
```

`expandNumbers` mangles integer arguments; decimals are deliberately handed to the engine, so
`[[volm 0.2]]` reaches `say` intact. That is luck, not a defence, and an agent reply — or a repo
with that string in a code comment — could set the assistive tool's volume to 0.2 with no error.

**Other platforms, checked rather than assumed.**

- **Linux is NOT clean.** espeak-ng's own man page (`src/espeak-ng.1.ronn`, EXAMPLES) documents
  `espeak-ng -ven-us "[[h@'loU]]"` -> speaks "hello": text inside `[[ ]]` is reinterpreted as
  phoneme mnemonics, so the agent's prose is silently replaced. Same opener, same fix.
- **Windows IS clean, with evidence.** `System.Speech`'s `Speak(String)` speaks plain text; SSML has
  a separate entry point (`SpeakSsml`), which we never call. Shell injection is closed too: we spawn
  without a shell and `#command` already doubles `'`, the only metacharacter inside a PowerShell
  single-quoted string. Left untouched by intent — the escape runs on every platform anyway,
  because a no-op on a clean surface costs nothing.
- `spd-say` is passed plain text (`-x/--ssml` is never used) but reaches espeak-ng through
  speech-dispatcher's module, so it is covered by the same escape.

**What changed.** `neutralizeInBandCommands()` replaces `[[` with `[ [`. A **separator, not a
delete**: the lexer needs the brackets adjacent, so the run goes inert while the listener still
hears every character the agent wrote — deleting it would be a silent omission, the exact failure
class this project exists to close. Applied at the single spawn boundary (`#command`) and again in
the exported `linuxCommand` builder; idempotent. A comment records the ordering constraint design
005 will need: our own `[[pbas n]]` control tokens must be prepended **after** this runs.

**Before:**
```
AssertionError: espeak-ng received a phoneme-mode opener:
  expected '-w /tmp/a.wav -- hi [[h@\'loU]] there' not to contain '[['
AssertionError: the bracketed run was executed as a command, not spoken:
  expected 41258 to be greater than 61887
```

---

## Fix 1 — the audio stream is the channel, not the notification tray

**What was wrong.** The queue-overflow notice, the two-agents ambiguity notice, the Linux-floor
degradation notice and the engine-failure notice all terminated in `notifications.show`, whose
`{ delivered }` result is discarded at `adapter/index.ts:63`. The project's central safety principle
was wired to a channel this listener does not use. Of the FMA's 55 silent-failure sites, the number
reaching the audio stream was **zero**.

**The design judgement, stated.** An announcement that interrupts is itself a harm — the listener
loses the sentence they were following — so urgency is a required decision, not a default:

| Urgency | Behaviour | Used for | Reasoning |
|---|---|---|---|
| `'next'` | spoken as soon as the current utterance ends, ahead of the queue; **abandons nothing** | every loss and degradation notice: queue overflow, Linux-floor degradation, degraded rung, "cannot read this transcript", replies discarded by a `'replace'` | these describe something that has **already happened**. A second of delay costs the listener nothing; a mid-sentence interruption costs them the reply they were listening to |
| `'now'` | abandons **only the current utterance**, preserves the queue | status, huddle toggle, unfollow, session switch | the listener asked *just now*, or the news invalidates what they are hearing. Bounded loss: one utterance, never the queue |
| — | there is deliberately **no** "interrupt and clear" urgency | | destroying the queue is the fault this class of message exists to report |

**Coalescing.** Queue overflow accumulates over a 500 ms window and produces **one** sentence naming
the **total**. The previous coalescer restarted a timer holding only the latest `n`, so a burst of
1 + 1 + 1 announced *"skipped 1"* — under-reporting the loss in the one message whose entire job is
to size it. Announcements are also exempt from overflow trimming, so the report outlives what it
reports.

**What changed.**
- `SpeechService.announce(text, urgency)` — the new destination. Overflow is spoken by the service
  itself, because that is where the queue lives; `onDropped` survives as a supplement only.
- `main.ts` has one `announce()` helper: audio first, desktop notification second. The huddle
  `notify` dep and the provider `notify` option both route through it, so the two-agents ambiguity
  notice and the Linux-floor degradation notice are now spoken.
- Announcements generated **before** the engine resolves are buffered and flushed once a voice
  exists. The Linux-floor notice fires inside `prepare()`, so without that buffer the one message
  explaining why speech sounds wrong was the one message that could never be spoken.

**Deliberately left alone.** Total engine failure (`resolved === null`) still reaches only a
notification. There is no engine to speak it with. A spoken receipt there needs a second,
independent sound path — a bundled earcon played through the sink — which is a design, not a line of
code. It is marked in the source so the next reader does not read it as an oversight.

**Verify by effect** (`speech-service.test.ts`, "losses and degradations reach the audio stream"):
the service is constructed with **no `onDropped` and no `log`** — the desktop-notification path does
not exist — and the assertion is on text the provider was actually asked to synthesize. The expected
string is built with `numberToWords(total)`, so a pass also proves the sentence went through the
real normalizer rather than being injected past it. A control case asserts nothing is said when
nothing is dropped.

**Before:**
```
AssertionError: the drop was never spoken:
  expected 'reply number zero reply number four r…' to contain 'Skipped three older repl'
AssertionError: expected 'reply number zero reply number six re…' to contain 'Skipped five older repl'
AssertionError: expected -1 to be greater than 0          (announce('next') did not exist)
AssertionError: expected 'reply alpha flood number nine' to contain 'Speech is degraded on this machine'
```

---

## Fix 2 — asking what is happening must not destroy what is happening

**What was wrong.** `read-aloud.status` exists to answer P22's *"this is really confusing what it is
even reading right now"*, and it was wired to `speak(..., 'replace')`, which clears `#pending` at
`speech-service.ts:79` with **no `onDropped` call**. The answer deleted the subject of the question,
silently — while announcing *"N more waiting"* about the replies it had just removed. The huddle
toggle and `unfollow` had the same wiring.

**Decision per command:**

| Command | Interrupt? | Queue? | Why |
|---|---|---|---|
| `status` | yes | **kept** | the listener asked, and asked now. The answer describes the queue, so deleting it is self-defeating |
| `toggle-huddle` | yes | **kept** | the confirmation must be immediate; a clipboard read queued behind it is not part of the mode change. Toggling OFF still stops speech, because `HuddleController` does that itself and that is what OFF means |
| `unfollow` | yes | **kept** | unfollow stops **new** replies arriving. Replies already queued are still replies the listener was waiting for |
| `speak-clipboard` | yes | **cleared** | genuinely a replace — "you asked for THIS text now". But `speak('replace')` now **announces the count it discarded** instead of deleting it in silence |
| `stop` | yes | **cleared** | the only path that clears without announcing. Stop is the listener's explicit command for silence; a control that answers "stop" with more speech is the helplessness P22 recorded, not a fix for it |

**What changed.** `activate()` gained an optional second argument (`provider`, `sink`,
`projectsDir`, `announceDelayMs`). ORCA still calls `activate(orca)` and gets every real default.
The seam exists because P26's rule is to test reachability from the **outermost object a caller
constructs**, and until now that object could not be constructed in a test at all — which is
precisely how `switchTo` shipped with no caller.

New `packages/plugin/src/main.test.ts` drives real registered commands, the real `SpeechService`,
the real normalizer and the real `HuddleController` against a temp transcript directory. The C5
tests use a slow provider to give the queue genuine depth, **assert that depth first** (`alpha` has
started, `charlie` has not — otherwise the test proves nothing), then press the control.

**Before** (only the three command bodies reverted, seam retained):
```
AssertionError: status destroyed the queued reply "charlie reply":
  expected 'alpha reply one here bravo reply two …' to contain 'charlie reply'
AssertionError: expected 'delta reply one echo reply two Skippe…' to contain 'foxtrot reply three'
```

---

## Fix 3 — huddle silently served nothing to every non-Claude agent

**What was wrong.** `huddle/index.ts:245` called `decodeClaudeLine` unconditionally. A Codex/Grok/omp
record fails `rec['type'] !== 'assistant'`, so every line decoded to `null` and huddle was completely
mute — while `panel.html` stated *"supports Claude, Codex, Grok and omp"*. `decoderFor`,
`decodeGenericLine` and `UNSUPPORTED_AGENTS` had **zero non-test callers**: P26's shape on a new wire.

**What changed.**
- `detectTranscriptFormat(raw)` sniffs the envelope from the records themselves — the Claude shape is
  a `message` object holding a content-block array; the generic shape is a flat record with a role
  and a string body — over a bounded 200-line prefix, so a 40 MB transcript costs what a small one
  does. Sniffed from **shape, not filename**, because the filename is a uuid on every format we have
  seen.
- `#read()` returns the format alongside the replies, so *"unreadable"* and *"nothing new"* are no
  longer the same empty array (silent-failure site 8).
- Where nothing fits, huddle **says so aloud, once per session**: *"Huddle cannot read `<agent>`'s
  transcript, so its replies will not be spoken."* `UNSUPPORTED_AGENTS` gets its first real caller —
  when the transcript path names an agent we know we cannot serve, the sentence names it, so the
  listener learns **which tool** is unreadable rather than being told a format they cannot see is
  wrong.

**Deliberately left alone.** Huddle still only searches `~/.claude/projects`. A Codex user whose
transcripts live elsewhere is served by neither decoder — that is a **discovery-root** problem, not a
decoder problem, and it needs a design (which roots, how they are found, how a wrong root is
announced). Worth raising as a follow-up finding: the decoder wire is now live, but the file-finding
wire in front of it is still Claude-shaped.

**Before** (`huddle/index.ts` reverted):
```
AssertionError: a Codex reply produced silence: expected '' to contain 'the codex agent replied here'
AssertionError: huddle went silent instead of saying it could not read the file:
  expected 'Huddle mode on.' to match /cannot read/i
```

The control case asserts `decodeClaudeLine` returns `null` for that same record and
`decodeGenericLine` returns the text, so the assertion above is demonstrably capable of failing for
the right reason.

---

## Fix 5 — the 301st reply could be spoken again

**What was wrong.** `MAX_REMEMBERED_IDS = 300` trimmed `#spoken` to the last 300, so once a session
passed 300 replies the oldest ids fell out of the set **while their lines were still on disk**.
`#speakNew` re-reads the whole transcript on every change, so the next change found those evicted
replies "fresh" and read them out again. No worker reap is needed to reproduce it: one file, one
append past the bound.

**The data-structure argument, stated deliberately.** An id set is the wrong shape for a monotonic
append-only log. It is **unordered**, so it cannot express *"everything before here is done"* — which
is the only fact dedup actually needs. A per-file high-water mark is O(1), **cannot be evicted into a
re-speak**, and costs one integer where 300 uuids used to sit. The id set is kept as a secondary
filter for duplicates within a single read; it is no longer the gate. (It also incidentally covers
TT4, the uuid-less record whose `Date.now()`-based id changes on every read: the mark gates it before
the id is ever consulted.)

**Two further faults fall out of the same change:**
- **TT10, the reap hole.** A *persisted* mark means a re-forked worker **resumes** where the last one
  stopped, instead of priming and marking everything now on disk as already spoken. The reply that
  arrived during the five-minute reap window used to vanish with no signal. Switching huddle ON still
  discards the mark deliberately — the listener asked to start listening *now*, not to be read a
  backlog.
- **C9, compaction.** If the file gets **shorter**, its uuids have all changed and no id set can tell.
  We clamp the mark forward and stay quiet. A lost reply is recoverable; a session replayed aloud is
  the failure P22 is named for.

**Before** (`huddle/index.ts` reverted):
```
AssertionError: an evicted reply was read out a second time:
  expected [ 'reply 0', 'reply 1', …(4) ] to deeply equal [ 'reply 305' ]
AssertionError: the re-forked worker replayed the session:
  expected [ 'reply 10', 'reply 11', …(8) ] to deeply equal []
AssertionError: a compaction replayed the session aloud:
  expected [ 'compacted 0', 'compacted 1', …(2) ] to deeply equal []
```

The reap test also asserts that a reply landing **after** the re-fork is still spoken, so a frozen
mark cannot pass the "did not replay" assertion for the wrong reason.

---

## Fix 6 — `switchTo`, wired rather than deleted

**What was wrong.** `HuddleController#switchTo()` implements P22's recorded remedy — *"announce
switches aloud"* — and had exactly one grep hit in the source tree: its own declaration. The manifest
shipped `unfollow` with no counterpart, so once the listener stopped following a session the only
route back was to wait for the next `agent.status.changed` to silently re-pick whatever transcript
was touched last (TT7).

**Kept, not deleted,** because it is the remedy for a pitfall this project has already lived through
and the missing half was the command, not the behaviour.

**What changed.**
- `read-aloud.follow` (`Mod+Shift+P`, from the free set pinned in `keybindings.test.ts`: `C P Q W Y`
  remained) locks onto the newest transcript for the worktree and announces which session it
  switched to.
- `HuddleController#followNewest()` resolves the file; the controller records the last worktree seen
  on an agent event, because a command carries no event payload of its own.
- `switchTo` announces **once** and no longer clears the queue. It used to `notify` **and**
  `speak(..., 'replace')` — duplicate message, destroyed queue.
- The registration guard read `n < 4` against a manifest declaring seven commands, so a partial
  host-API mismatch registering 4-6 of them passed silently (site 28). It now checks the real count,
  and `main.test.ts` asserts every manifest-declared command id is registered, so the number cannot
  drift again.

**Before** (`main.ts` and the manifest reverted):
```
Error: command read-aloud.follow is not registered      (x2)
```

**Verified by effect against the built artifact**, not only the source:
`scripts/smoke-activate.mjs` reported `PASS: 7 commands` before the rebuild and `PASS: 8 commands`
after — a named value that moved.

---

## What was deliberately left alone

| | Why |
|---|---|
| Engine-failure announcement | there is no engine to speak it with. Needs a second, independent sound path (a bundled earcon); that is a design |
| Huddle's discovery root (`~/.claude/projects` only) | the decoder wire is live now, but the file-finding wire in front of it is still Claude-shaped. Needs a design, not a patch |
| `stop()` announcing what it cleared | Stop means silence. A control that answers "stop" with more speech is P22's helplessness, not a fix for it |
| FMA finding 1 (`unavailableReason` unread; `prepare()` reports warm on a broken `say`) | not in this round's brief. It is the remaining highest-severity item and should be next |
| The other ~48 silent-failure sites | this round routed the four the FMA named plus the ones the fixes crossed. The audit stands |
| `expandNumbers` mangling hex session ids | `sessionLabel('abcdef12…')` is spoken as "abcdeftwelve". Found while writing the Fix 6 test. A live audible defect, unrelated to any fix here, and it belongs to Voice Lab and to HANDOFF's standing rule *"never speak hex"* |

## Defaults picked, for Voice Lab to settle (P23)

Mechanism ships; the listener chooses the values. All cheapest-to-reverse:

- Overflow coalescing window: **500 ms** (`announceDelayMs`).
- Overflow wording: *"Skipped N older replies to keep up."*
- Unreadable-transcript wording: *"Huddle cannot read `<agent>`'s transcript, so its replies will not
  be spoken."*, once per session.
- Session-switch wording: *"Now reading from `<label>`."*
- `status` / `toggle` / `unfollow` interrupt the current utterance rather than waiting for it. The
  alternative — deferring to `'next'` — is a one-word change at each call site.
- `read-aloud.follow` bound to `Mod+Shift+P`.

## Test count

**161 -> 180**, all passing (`pnpm test`). New: 3 in `os-synth.test.ts`, 5 in
`speech-service.test.ts`, 8 in `main.test.ts` (new file), 3 in `huddle/huddle.test.ts` (new file).
