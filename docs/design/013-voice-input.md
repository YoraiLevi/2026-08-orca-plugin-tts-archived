# 013 — Voice input: what is buildable, what is not, and the half of it worth shipping

**Status:** design. **Written:** 2026-08-21. **Milestone:** M17 (`docs/TASKS.md` "Phase M17 — Voice
input", T170–T172).
**Author had no session context.** Claims about our own code cite `path:line` verified at `1161722`.
Every number carries **[measured-here]**, **[documented]** or **[claimed]** (constitution R006).

---

## 0. The verdict, before the reasoning

**M17 as written cannot be built to R1 parity today, and no amount of design changes that.** Four
independent findings close the four doors, and they were closed by research, not by opinion:

| Door | Finding | Status |
|---|---|---|
| Reuse ORCA's STT | `q-round1-orca-api.md` Q15 — main-process + host renderer only. A panel has no preload, no `window.api`, `connect-src 'none'`, no `allow="microphone"` | **RESOLVED NEGATIVE** |
| Ship sherpa-onnx STT | `q-round1-platform.md` Q16 — same native binary as TTS, same missing `win-arm64` on npm (P13), no OS fallback on Windows-on-ARM | **RESOLVED** |
| Ship a model in the plugin | `q-round1-platform.md` Q17 — smallest English model ORCA itself ships is **87.7 MiB**, 1.75× the whole 50 MB cap; Moonshine tiny is **119.0 MiB** extracted | **RESOLVED NEGATIVE** |
| Use a cloud API | R3.4 — the default needs no account, no API key, no network | **forbidden** |

And the door this document was asked to open — *"macOS, Windows and Linux all ship system
dictation"* — **is only two-thirds true, and the missing third is the one R1 is about**:

> **[measured-here]**, 2026-08-21: the Ubuntu 24.04.3 desktop image manifest (1,819 packages) contains
> **zero** speech-*recognition* packages. `grep -iE 'speech|dictat|voice|asr|sphinx|kaldi|onnx|deepspeech|julius|nerd-dictation'`
> returns only `espeak-ng-data`, `libespeak-ng1`, `libspeechd2`, `python3-speechd`,
> `speech-dispatcher`, `speech-dispatcher-audio-plugins`, `speech-dispatcher-espeak-ng` — every one of
> them **output**, none of them input. Reproduce:
> ```
> curl -sfL https://releases.ubuntu.com/24.04/ubuntu-24.04.3-desktop-amd64.manifest \
>   | grep -iE 'speech|dictat|voice|asr|kaldi|whisper|vosk'
> ```
> This is P25's shape exactly — *"ask what the image manifest ships, not what the distro packages"* —
> and it is the second time that question has decided a design in this project.

macOS ships on-device recognition: `/System/Library/Frameworks/Speech.framework` and five private
`*SpeechRecognition*` frameworks are present on this machine **[measured-here]**
(`CoreEmbeddedSpeechRecognition`, `LocalSpeechRecognitionBridge`, `SpeechRecognitionCommandServices`,
`SpeechRecognitionCore`, `SpeechRecognitionSharedSupport`). Windows ships Voice Typing / Voice Access
and the legacy `System.Speech` recognizer **[documented]**. **Stock Linux ships nothing.**

**So the honest answer to T170 is: none of the above, and a fifth thing.** Section 5 specifies it.

---

## 1. What voice input actually has to do here

It is worth being precise, because the milestone's name hides a split that decides everything.

| Job | Who can do it | Needs STT? |
|---|---|---|
| **A — get the user's words into the agent** | the OS, into whatever has keyboard focus, with no plugin involved | yes, but not ours |
| **B — stop the speech when the user starts talking** (barge-in, T171) | **us, and only us** | **no** |
| **C — keep the mic from hearing the speaker** (half-duplex, T172) | **us**, by being silent | **no** |
| **D — tell the user the mic is open and closed** (earcons) | us | no |

Jobs B, C and D are the ones the listener actually feels, they are the ones the gate is written
against — *"speaking interrupts playback within the barge-in budget, without echo"* — and **not one of
them requires a speech-to-text engine.** Job A is the one that cannot be built to parity, and it is
the one the OS is already willing to do on two platforms out of three.

That split is the whole design.

---

## 2. Where the model lives, if it cannot live in the plugin

Five options, evaluated against R1 (parity), R3.4 (no account/key/network), P4 (the 50 MB cap) and
P5 (a plugin is copied, never built).

### A — OS dictation, driven by the user

The user presses their platform's dictation key; the OS types into the focused window, which is the
agent's terminal. We never see the audio, never ship a model, never download anything.

- **Cost: zero.** No model, no cap pressure, no download, no first-run, no `node-gyp`, no
  notarization (`010` Q64), no non-ASCII-path workaround (P8).
- **R3.4: satisfied** on macOS (on-device recognition frameworks are present [measured-here]) and on
  Windows **[claimed]** — whether Windows Voice Typing runs fully on-device by default is
  version-dependent and is **not verified here** (Q80).
- **R1: fails on Linux**, measured above. Not "degrades" — is absent.
- **We cannot see the trigger.** macOS dictation is invoked by a system key the plugin never receives;
  Windows Voice Typing likewise. So **job B and job C cannot be hung off it** — the OS opens the mic
  and we are still talking. This is the sharpest cost and it is not obvious from "the OS does it for
  free".
- **Focus stealing / per-platform behaviour**: dictation types where focus is. If the listener's
  focus is in the control pane rather than the agent terminal, the words land in our TUI. That is a
  real foot-gun and section 4 handles it.

### B — A separate model download, our own engine in the worker

The plugin worker is a plain forked Node process and can load anything (Q15's own conclusion). Models
live in a runtime cache outside the install tree, exactly as P4 already concluded for voices, reusing
ORCA's catalog ids, hashes and the Windows ASCII-relocation workaround (P8).

- **R3.4: satisfied.** Local, no key, no network after the download.
- **R1: fails on Windows-on-ARM** — the sherpa `win-arm64` npm gap (P13, Q16), with **no OS fallback
  equivalent to SAPI on the input side**. Recoverable only via the GitHub-release path (P13), which is
  a download, an extraction (`unbzip2-stream`, P14) and a binary we would then have to sign.
- **Cost: 87.7 MiB minimum** for the smallest English model ORCA ships, 119.0 MiB for Moonshine tiny
  (Q17, MEASURED there). That is a first-run download an order of magnitude larger than the TTS voice.
- **This is the only option that gives us the audio stream**, and therefore the only one where jobs B
  and C can be done properly rather than by proxy.

### C — A sidecar the user installs

`nerd-dictation`, `whisper.cpp`, `vosk`, or a platform tool. We define a command contract — "a program
that prints recognized text on stdout" — and the user points a setting at it.

- **R3.4: satisfied** (the user's own local binary).
- **R1: satisfied *in mechanism*** — the same contract on all three — and **not in delivery**: the
  Linux user installs something, the macOS user may not have to. `010` section 9 already faces this
  shape ("R1's cost: three sidecars, not one") and `010` Q64 (macOS signing) applies the moment we
  ship a binary ourselves rather than pointing at the user's.
- **Cost to us: small.** It is a settings field, a spawn, and a parser.
- **Honest label:** this is the *bring-your-own-engine* rung and it should be named that way in the
  UI, not dressed up as support.

### D — The resident service of `010`

Put STT in the M9 service alongside TTS. Attractive because the service already owns a long-lived
process, a socket, a protocol version and a liveness contract (`010` section 11).

- **It solves the wrong problem.** The service exists because *process spawn* is 8× synthesis (`010`
  section 0). STT's problem is a 87.7 MiB model and a missing `win-arm64` binary; residency changes
  neither.
- **It is the right *home*** for option B or C once one of them is chosen — the model load is seconds,
  which is precisely the two-process rule's case — but it is not itself an answer to T170.
- **And it must not be a fifth uncoordinated extension to the seam.** `010` section 2 counts six
  extensions and its own refutation table says *"a fifth or sixth extension arriving that section 2's
  six do not cover"* would prove it wrong. **STT is a seventh, and it is a different seam**:
  `TtsProvider` synthesizes; recognition is `SttProvider`, a separate interface, in the same service.
  Coordinating with `010` means declaring that now, not widening `TtsProvider`.

### E — No engine at all: the plugin owns silence, the OS owns words

Ship jobs B, C and D. Job A is the user's dictation, or their keyboard, or nothing.

- **R1: satisfied**, because what we ship — stopping speech, an earcon, a listening window — is
  identical on all three platforms and depends on nothing the OS must provide.
- **R3.4: satisfied trivially.**
- **Cost: essentially zero**, and it is the only option that is *entirely* within reach today.

### The recommendation

**Ship E now, as M17a. Offer C behind a setting as M17b. Keep B as the funded future if the listener
wants hands-free. Reject D as an answer and adopt it as a home. Do not make A the default, and do not
make it a lie.**

The reason E comes first is not caution, it is the split in section 1: E is jobs B, C and D, which is
**everything the M17 gate actually measures**. A milestone that ships E has a runnable gate. A
milestone that ships A has an unrunnable one on Linux and an un-hookable one everywhere.

---

## 3. Push-to-talk before hands-free (T171), and how the trigger reaches us

### 3.1 The trigger problem, restated

`003` section 1 F6 is load-bearing here and is not re-argued: **a plugin keybinding does not fire
while a terminal has focus, on any policy setting** (upstream stablyai/orca#15642), and this user
lives in a terminal. `003` section 2's Stop table already enumerated the four physical routes; voice
input inherits them exactly, with the same verdicts:

| # | Route for a `talk` press | Works in terminal focus? | Latency to first silence |
|---|---|---|---|
| 1 | keypress in the control pane (`orca-tts control`) | yes — it *is* the focused terminal | ~20–60 ms **[claimed]**, inherits `003` section 2's route-1 budget |
| 2 | panel button → `terminal.sendText` → control pane → socket | yes — a mouse click has no focus problem | ~40–120 ms **[claimed]** |
| 3 | plugin chord `Mod+Shift+C` | **no** | — |
| 4 | `orca-tts talk` in any shell | yes | seconds |
| 5 | **the OS dictation key** | yes, but **we never see it** | not a route for us at all |

Row 5 is the finding this section exists for. **The trigger that starts the microphone is the one
trigger we cannot observe**, so half-duplex cannot be implemented as *"when the mic opens, stop
talking"*. It has to be implemented as *"when the listener asks for silence, be silent, and then they
dictate"* — which is why the verb below is `talk` and not `dictate`.

### 3.2 The chord, and the sentence that goes with it

- **Primary: `t` in the control pane.** Free in both tables of `003` section 4a — 4a.1 uses
  `Space p s . n R m ? Esc`, 4a.2 uses `f u ↑ ↓`, and section 6 of `012` takes `o`. `t` for *talk*.
- **Bonus chord: `Mod+Shift+C`** (mnemonic: *converse*). Drawn from the free set vendored at ORCA
  `0f26ff4a` / v1.4.185 — `C H K L P Q S U W X Y` — of which we already use `S X H U K L P`
  (P19, `003` section 4a.4). It is pinned by `packages/plugin/src/manifest/keybindings.test.ts` and
  must be re-extracted when the supported ORCA version moves.
- **The sentence that must stay in the README**, per `003` section 4a.4: *the chord is dead in
  terminal focus.* `t` in the control pane and the panel button are the routes that work. Documenting
  the chord as *the* way to talk would be P18 again — a control that silently does nothing.

### 3.3 Hold, tap, or latch — the option space, default to the listener

buzz holds: press opens the mic, release closes it, with an 880 Hz / 440 Hz earcon on each edge
(`useHuddlePttState.ts:36-54`, via `q-round1-buzz-transcript.md` item 3). Hold is right when the app
owns the mic. **We do not own the mic** in M17a, so what the press bounds is a *listening window* —
the interval during which we stay silent.

| Mode | Press means | Ends on | Fails when |
|---|---|---|---|
| **Hold** (buzz's) | silence while held | release | a terminal that swallows key-up; dictating for a minute means holding for a minute |
| **Tap / tap** | silence from tap 1 | tap 2 | a forgotten second tap leaves the listener in permanent silence — indistinguishable from a crash (`003` section 8.7 rule 4's exact concern) |
| **Tap + timeout** | silence from the tap | a new user turn appears in a followed transcript, **or** `TALK_WINDOW_MS` (default 30 s), **or** a second tap | a slow dictation, recovered by tapping again |
| **Latch after N ms** | hold for short, latch for long | release or second tap | the threshold `N` is itself taste |

**Default: tap + timeout, with a heartbeat.** It is the only mode whose failure is bounded and
audible: while the window is open the worker emits `control.heartbeat` every 30 s (`005` section
11.1b, already reserved, already required for pause by `003` section 8.7 rule 4), so *"I am waiting
for you"* never becomes *"it died"*. **Hold and latch are options**, and *how long to hold* is exactly
the taste P23 says belongs to the listener with a replay button, not to an argument in this document.
Recorded as Q77.

**The window closes on evidence, not only on a clock.** A new `type: 'user'` record appearing in a
followed transcript is the observable fact that the human's turn landed — the same file watch huddle
already runs (`packages/plugin/src/huddle/index.ts:226`), the same 250 ms debounce (`:52`), no new
mechanism. That is the cheapest, most honest close: the window ends when the thing it was waiting for
happened.

---

## 4. The half-duplex gate (T172)

**Specification: half-duplex is enforced on the speaker, not on the microphone, because we do not
have the microphone.**

```
talk pressed
  1. bump the generation and cancel synthesis + flush the sink   (the existing barge-in path)
  2. wait for the sink to drain                                  (bounded; see the budget below)
  3. play control.mic.open                                       (section 5)
  4. LISTENING WINDOW: nothing is spoken. Replies keep arriving and keep queueing,
     under the same maxQueued = 8 cap, drops announced and coalesced as usual.
  5. window closes (user turn seen, timeout, or second tap)
  6. play control.mic.close
  7. announce what waited — "resuming; two replies waiting" — then resume
```

Six rules:

1. **The gate is a level, not an edge** (`003` section 3 R4), so a second `talk` press while listening
   is a no-op or a close, never a toggle race. It does not bump the generation a second time.
2. **The earcon must not be echoed into the recognizer.** Step 3 plays *before* the window opens and
   is followed by the drain — 150 ms of tone plus drain, then silence. If the earcon played while the
   OS mic was live, our own tone would be the first thing dictation heard.
3. **Queued replies are never discarded by the gate.** The listening window is `pause` semantics, not
   `stop` semantics (`003` section 8.7's table): queue kept, position kept, generation unchanged after
   step 1's initial bump. The backlog rules of `003` section 8.7 (cap applies, 120 s moves the backlog
   to replay, resume announces before it speaks) apply unchanged and are not restated here.
4. **The gate does not mute the *agent*, only the *speaker*.** Nothing about huddle membership changes
   (`012` section 2), so nothing has to be re-followed afterwards.
5. **Where we DO own the mic (option B or C), the gate gains its mic-side half**: the recognizer is fed
   only while the sink reports not playing, and the sink's own drain gates the recognizer's start.
   Echo cancellation is explicitly **not** attempted — it is a whole discipline, and half-duplex is
   why we do not need it.
6. **On Linux's `spd-say` rung there is no sink to drain.** The provider yields no audio and the
   daemon owns playback (P25), so step 1 must also send `spd-say --cancel` — killing our client does
   not stop the daemon. Missing that makes the gate a no-op on exactly the platform with no dictation,
   which would be a quietly perfect failure.

**The budget**, inherited rather than invented: `003` section 2's Stop budget is p50 ≤ 120 ms, p99 ≤
250 ms, CI-failing above 400 ms, and its four segments already sum to 250 ms with the audio drain at
50 ms. Barge-in **is** Stop with an earcon after it, so the gate is measured on the same budget and by
the same probe: press at a known instant, assert **no samples after press + 250 ms**, not that a
message was sent.

---

## 5. Earcons — reserved band, not new tones

Cross-review **X-03** is unambiguous: `005` section 11.1 is the one earcon table, it reserves a
**control band** (1 or 3 notes, never 2; pitch set `C4 F4 A4 E6 G6`, disjoint from the identity
pentatonic; 150 ms total; gain 0.05), and no other document mints tones.

**So this document mints none. It requests two, inside the band, by its own rules**, and the
amendment lands in `005` section 11.1b — not here:

| Requested id | Shape | Why this shape |
|---|---|---|
| `control.mic.open` | three notes **ascending**: F4 A4 G6 | the one-note space is fully allocated (`control.stop` C4, `control.pause` F4, `control.heartbeat` A4, `control.play` E6, `control.compare` G6), so a new control **must** be a three-note motif to stay in the band. Ascending = opening, matching buzz's 880-on-press intuition without copying its pitches |
| `control.mic.close` | three notes **descending**: G6 A4 F4 | the exact inverse, so the pair is learnable as one gesture |

Both hold every invariant in `005` section 11.1a — note count ≠ 2, notes ⊆ the control pitch set,
150 ms, gain 0.05 — so `005` section 11.1c's pinning test covers them unchanged, including its
negative control.

**Do not copy buzz's 880 Hz / 440 Hz literally.** Those frequencies sit outside both of our reserved
sets, and adopting them would re-open X-03 from a fourth document.

**And the heartbeat is not new either**: the listening window reuses `control.heartbeat` (A4, reduced
gain), already reserved for `003` section 8.7 rule 4, with `010` section 11.5's mandatory back-off
(30 s, 60 s, 120 s, then stop and say so once) rather than an indefinite pulse.

---

## 6. Barge-in, and Q19

### 6.1 Adopt buzz's gesture

buzz makes the push-to-talk press itself the cancel — *"talking over the agent **is** the stop
gesture, with no separate control to find"* (`ptt_shortcut.rs:67-76`, via `q-round1-buzz-transcript.md`
item 9). **Adopt it, unchanged.** It is the same argument as `003` section 4a's: the fastest control
is the one you do not have to find, and P22's lesson is that a listener who cannot stop what they are
hearing feels helpless. `talk` therefore *is* `stop`-then-listen, one press, and that is why section 4
step 1 is the existing barge-in path rather than a new one.

buzz's second lesson comes with it: barge-in lives in **a separate 10 ms monitor**, not in a check
inside the synthesis worker, because the worker can block for hundreds of milliseconds inside
inference (`tts_speaker_cancellation.rs:15-94`, item 10). `003` section 2 already ruled that a Stop
implemented as "check the flag between chunks" is up to 2,000 ms — eight times the budget.

### 6.2 Q19 — the partially-spoken reply: discard, or resume?

The new evidence is real: **word-boundary callbacks were MEASURED on macOS — nine words in, nine
callbacks out, each carrying an exact `NSRange`, headless, 55,050 PCM frames, no audio device**
(`q-round1-platform.md` "Unused capabilities" item 1; `010` section 0 F2). Windows exposes
`SpeakProgress`, Linux reports index marks over the SSIP socket [documented]. So for the first time a
**precise** resume is implementable — the position is known to the word, not guessed.

**It changes the feasibility. It does not change the default.**

| Option | What it does | Argues for | Argues against |
|---|---|---|---|
| **Discard** *(default)* | the interrupted reply ends; it stays in the last-20 replay buffer, replayable with `R` | the listener interrupted **on purpose**; re-speaking what they dismissed is unrequested audio, which is the P22 harm | nothing is lost either way — the text is on disk and in the buffer |
| **Resume from the word** | continue at the boundary, mid-sentence | maximally precise; possible only now | a sentence resumed from its middle is *less* intelligible than one restarted, especially through a dyslexic listener's ear; and the interval between interrupt and resume was full of the user's own speech |
| **Resume from the sentence** | restart the sentence that was in flight | word boundaries make "which sentence was I in" **exact** rather than approximate; keeps intelligibility | still re-speaks something after the listener chose to talk |

**Recommendation: discard by default; resume-from-sentence offered; resume-from-word offered where
the engine reports boundaries and refused *by name* (`resume_unsupported`) where it does not.** The
reason discard wins is not technical — it is that barge-in is an explicit act of the listener's, and
`003` section 5 / P22 both hold that unrequested audio is the failure mode this project exists to
avoid. What the word boundaries genuinely buy is that **the offered options are now honest**: before
them, "resume" meant "restart the chunk and hope", which is `010` section 11.3's point about a service
that dies mid-utterance.

**And this is taste, so it is the listener's (P23).** Ship all three behind one setting, settle it in
Voice Lab against a recorded interrupt fixture, and default to discard. Recorded as Q78.

One rule is **not** taste: **the interrupted reply is in the replay buffer either way**, and entering
the buffer marks it seen (`003` section 7.1), so no resume policy can cause it to be re-spoken twice.

### 6.3 The sequence, from key-press to silence to transcript

```mermaid
sequenceDiagram
    autonumber
    participant U as Listener
    participant T as Control pane (orca-tts control)
    participant W as Plugin worker
    participant P as Provider / sink
    participant OS as OS dictation
    participant A as Agent + transcript

    Note over P: speaking reply 7, mid-sentence
    U->>T: press t (talk)
    T->>W: envelope {v:1, verb:"talk", gen:1734, id, at}
    W->>W: gen 1734 == current, accept (003 section 3 R2)
    W->>P: cancelSynthesis() + bargeIn() (speech-service.ts:99, :115)
    Note over W,P: on the Linux spd-say rung also send spd-say --cancel (P25)
    P-->>W: sink drained
    Note over P: SILENCE - budget p99 250 ms from the press
    W->>P: play control.mic.open (F4 A4 G6)
    P-->>W: earcon done
    W->>W: open LISTENING WINDOW, queue keeps filling, nothing is spoken
    U->>OS: press the platform dictation key (we never see this)
    OS->>A: types recognized text into the focused terminal
    U->>A: submits the turn
    A->>A: appends a type:"user" record to the transcript
    A-->>W: fs.watch fires, 250 ms debounce (huddle/index.ts:226, :52)
    W->>P: play control.mic.close (G6 A4 F4)
    W->>P: announce "resuming; two replies waiting" (003 section 8.7 rule 3)
    W->>P: resume speaking the queue
    Note over U,A: if no user record arrives, the window closes on<br/>TALK_WINDOW_MS with control.heartbeat every 30 s,<br/>backed off per 010 section 11.5
```

---

## 7. The reduced version worth shipping — M17a, and what it is honestly called

**M17a — "hold the floor".** One verb, no engine, all three platforms, no download.

| Task | Becomes |
|---|---|
| **T170** *decide ORCA's STT or our own* | **answered: neither.** Section 2's option E. `SttProvider` is declared as a separate future seam so `010`'s "the seam changes once" is not broken by a seventh extension |
| **T171** *push-to-talk before hands-free; barge-in gated behind it* | the `talk` verb: `t` in the control pane, panel button, `orca-tts talk`, `Mod+Shift+C` as a documented-as-dead bonus. Barge-in **is** the press (buzz item 9) |
| **T172** *half-duplex gate* | section 4, enforced speaker-side |
| **new T173** | mic-open / mic-close earcons, via the `005` section 11.1b amendment — no new tones |
| **new T174** | Voice Lab exposes the Q77/Q78 option spaces with a replay button (P23) |

**Gate M17a**, restated so it is runnable on all three platforms:

> *"Pressing talk produces silence within the barge-in budget, an audible mic-open, and no spoken
> audio until the window closes; when it closes the listener is told what waited."*

| Test | What would prove us wrong |
|---|---|
| Press `talk` during a 30 s utterance | any sample leaving the sink after press + 250 ms (`003` section 2's probe, reused verbatim) |
| Press `talk`, then let three replies arrive | any of them being spoken during the window; or none of them being announced at close |
| Close the window by appending a `type:"user"` record to the followed transcript | the window not closing — *negative control:* the same fixture with the user record omitted must **not** close it until the timeout |
| Leave the window open 65 s | fewer than two heartbeat earcons on the sink, asserted on the sink and not on a log line |
| Linux `spd-say` rung | audio continuing after the press, which is what happens if `--cancel` is missed |
| Earcon disjointness | `005` section 11.1c's existing test, now including the two new ids |

**What M17a does not claim.** It does not transcribe. It does not open a microphone. On Linux there
is no dictation to pair it with, and the README must say so in the same breath as the feature — that
is the *"say why"* rule from P7 and P16, and the alternative is a feature that appears to exist and
silently does not.

**M17b — "bring your own recognizer"** (section 2 option C) is the next rung: a settings field naming
a command, a spawn, a stdout contract, a named refusal when it is absent. It is small, it satisfies
R3.4, and it is the only thing that makes Linux whole without a 87.7 MiB download.

**M17c — our own engine** (option B) stays funded and unscheduled. What would change the verdict is
listed below.

---

## 8. What would change the verdict

| Claim in this document | What would refute it |
|---|---|
| No usable local STT fits the 50 MB cap | a model under ~40 MB extracted with usable English accuracy — the named probe is Q17's `curl` + `tar xjf` + `du -sb` on `sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27`, whose **extracted** size is still UNMEASURED |
| Stock Linux ships no dictation | a speech-recognition package in a future Ubuntu desktop manifest, or a distro the author actually uses that ships one. Re-run the one-line manifest grep above |
| We cannot see the OS dictation trigger | a documented API on any platform that notifies a background process when system dictation opens |
| A plugin chord cannot carry `talk` | stablyai/orca#15642 merging, which would make row 3 of section 3.1 live — and would still leave the control pane faster |
| Discard is the right default for Q19 | the listener choosing resume in Voice Lab, which is the entire point of shipping the option |
| STT belongs on a separate seam | a design that puts recognition on `TtsProvider` without breaking `010`'s "the seam changes once" |

---

## 9. New open questions

To append to `docs/.discussion/000-open-questions.md`. **Numbered from Q77**, continuing `012`'s
Q70–Q76; Q62–Q69 are ambiguous (`010` section 14 and `011` both claimed them) and must be cited
document-qualified.

| # | Kind | Question | Cheapest reversible option |
|---|---|---|---|
| **Q77** | T | **The talk gesture.** Hold, tap/tap, tap+timeout, or latch — and how long is a hold. Section 3.3 defaults to tap+timeout because its failure is bounded and audible. | ship all four behind one setting; Voice Lab settles it |
| **Q78** | T | **Q19's default.** Discard, resume-from-sentence, or resume-from-word. Section 6.2 recommends discard and says why the word boundaries do not change it. | ship all three; the replay buffer makes every choice non-destructive |
| **Q79** | D | **Does `talk` enter `003` section 4a.3's spoken control vocabulary?** If yes, "talk" is forbidden as a call-sign word (`005` section 11.2). `003` owns that list. | add it — one of 64 slots |
| **Q80** | E | **Is Windows Voice Typing on-device by default**, and is it present on a stock Windows 11 without a language-pack download? R3.4 turns on the answer. Probe: a clean Windows 11 VM, no network, `Win+H`. | if it is not, Windows joins Linux in needing M17b |
| **Q81** | E | **Does macOS on-device dictation require the user to download a language model first?** `~/Library/Assistant/SpeechModels` does **not** exist on this machine [measured-here], although the recognition frameworks do — which suggests the model is fetched on first enable. | first-run guidance, not a design change |
| **Q82** | D | **`SttProvider`'s shape**, if M17b or M17c is ever scheduled: streaming partials or final-only, and does it live in `010`'s resident service. Declaring the seam now is what keeps `010`'s "changes once" true. | declare the interface, implement nothing |
| **Q83** | E | **Does the listening window need to suppress `notifications.show` too?** A desktop notification during dictation is harmless; a notification *sound* is not, and we do not control it (`adapter/index.ts:63` already discards the `{ delivered }` result — P30). | leave as is; measure whether it is audible |
