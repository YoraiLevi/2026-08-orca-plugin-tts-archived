# 013 — Voice input: what is buildable, what is not, and the half of it worth shipping

**Status:** design. **Written:** 2026-08-21. **Milestone:** M17 (`docs/TASKS.md` "Phase M17 — Voice
input", T170–T172).
**Author had no session context.** Claims about our own code cite `path:line` verified at `1161722`.
Every number carries **[measured-here]**, **[documented]** or **[claimed]** (constitution R006).

> ### Amended 2026-08-21 — round-7 review, `docs/design/014-review-round7.md`
>
> Seven findings landed on this document. Each is resolved **in place**, in the section that owns the
> mechanism, and each carries the finding number that forced it. Two of them invalidate an argument
> this document made rather than a number it quoted, and those arguments are rewritten, not softened.
>
> | Finding | What changed here |
> |---|---|
> | **R7-30** blocks-implementation — the listening window's primary close signal is dead when the followed set is empty | **Section 3.3a is new.** The dependency on `012`'s followed set `F` is stated as a precondition; the `F = ∅` behaviour is specified rather than left to the 30 s clock; and **the press announces which close condition is armed**, so the listener is never in a silence whose end they cannot predict. Gate M17a gains the `F = ∅` row. Up to 30 s of dead air on the accessibility path was the cost of leaving this implicit. |
> | **R7-28** needs-decision — barge-in redefined onto the 250 ms end-to-end budget | Section 4's budget paragraph is rewritten to keep **two quantities named separately**: press → last sample is **250 ms**, and the **provider-cancel segment inside it stays `CANCEL_BUDGET_MS = 50`**. Gate M17a asserts **both**. The earlier text collapsed them, which is the exact conflation `packages/providers/src/budget-claims.test.ts:38-44` exists to prevent and P33's shape. **This document does not move a constitutional number**; doing so is a constitution amendment plus a constant change, not a sentence in a design doc. |
> | **R7-06** needs-decision — `maxQueued` specified three incompatible ways | Section 4's step 4 **cites `011`'s `queue.maxQueued`** and restates no number. |
> | **R7-29** needs-decision — settings invented that `011`'s frozen schema does not carry | **Section 9a is new**: "Settings this milestone adds", each row an `011` `FieldDescriptor` at `since: 3`. |
> | **R7-34** needs-decision — the `win-arm64` binary cost is charged to STT when its own source says TTS already pays it | Section 2 option B is **re-scored on marginal cost**: the binary, the extraction and the signing question are already owed by the default TTS engine, so **the delta STT actually adds is the model download and nothing else**. The verdict is unchanged; **the reason M17c stays unscheduled is not the same reason it was**. |
> | **R7-35** needs-decision — VAD and keyword spotting never considered; the real blocker never named | **Section 2 gains option F, "VAD-only, no recognition"**, scored against the same four constraints, and **section 2a names the blocker this document should have named**: cross-platform microphone capture in Node. Opened as **Q84**. The verdict — ship E as M17a — stands; **the argument for it is replaced**, because a correct conclusion resting on overstated obstacles is fragile. |
> | **R7-39** worth-noting — unlabelled numbers against this document's own R006 promise | Labels added at section 0's model sizes, section 3.3's buzz earcon, section 5's restatement of it, section 6.1's 10 ms monitor and its *"up to 2,000 ms"*. |
> | **R7-38** worth-noting — the stated search and the "Reproduce:" command are different greps | **One pattern**, used in both places, in section 0. |
>
> **Three of the seven above were applied in a second pass, 2026-08-21.** The pass that wrote this
> table was killed by a session limit inside this document. **R7-06** (section 4 step 4), **R7-28**
> (section 4's budget) and **R7-29** (section 9a) were claimed here and absent from the body; gate
> M17a was also missing R7-30's `F = ∅` rows. All four are now in the body, and the gap itself is
> recorded in `docs/design/016-reconciliation-round7.md` section 1.3 — **a header amendment table is
> the plan, not the evidence; verify the section that owns the mechanism.**
>
> **Citations.** `scripts/check-citations.mjs` had never been run over this document. It was run for
> this pass and reports **zero** flags against it, before and after these amendments.

---

## 0. The verdict, before the reasoning

**M17 as written cannot be built to R1 parity today, and no amount of design changes that.** Four
independent findings close the four doors, and they were closed by research, not by opinion:

| Door | Finding | Status |
|---|---|---|
| Reuse ORCA's STT | `q-round1-orca-api.md` Q15 — main-process + host renderer only. A panel has no preload, no `window.api`, `connect-src 'none'`, no `allow="microphone"` | **RESOLVED NEGATIVE** |
| Ship sherpa-onnx STT | `q-round1-platform.md` Q16 — same native binary as TTS, same missing `win-arm64` on npm (P13), no OS fallback on Windows-on-ARM | **RESOLVED** |
| Ship a model in the plugin | `q-round1-platform.md` Q17 — smallest English model ORCA itself ships is **87.7 MiB** **[documented]** (computed per-file from ORCA's pinned catalog, `src/main/speech/model-download-catalog.ts`, in `docs/.research/q-round1-platform.md` Q17), 1.75× the whole 50 MB cap; Moonshine tiny is **119.0 MiB** over 12 files **[documented]** (the Hugging Face file listing, same source). **A third artifact is genuinely unmeasured** and must not be conflated with these two: the `…-quantized-2026-02-27.tar.bz2` release asset is 29.9 MB **compressed**, extracted size **unknown** — section 8's refutation row is about that one | **RESOLVED NEGATIVE** |
| Use a cloud API | R3.4 — the default needs no account, no API key, no network | **forbidden** |

And the door this document was asked to open — *"macOS, Windows and Linux all ship system
dictation"* — **is only two-thirds true, and the missing third is the one R1 is about**:

> **[measured-here]**, 2026-08-21: the Ubuntu 24.04.3 desktop image manifest (1,819 packages) contains
> **zero** speech-*recognition* packages.
>
> **The pattern below is the one that produced the result, and it is the only one this document
> uses** — the stated search and the "Reproduce:" command were two different greps (**R7-38**), which
> made the claim something other than the output of the command offered to check it. That is P33's
> shape: three artefacts that each look right alone.
>
> ```
> curl -sfL https://releases.ubuntu.com/24.04/ubuntu-24.04.3-desktop-amd64.manifest \
>   | grep -icE 'speech|dictat|voice|asr|sphinx|kaldi|onnx|deepspeech|julius|nerd-dictation|whisper|vosk'
> ```
>
> Drop the `-c` for the seven matching lines. They are `espeak-ng-data`, `libespeak-ng1`,
> `libspeechd2`, `python3-speechd`, `speech-dispatcher`, `speech-dispatcher-audio-plugins`,
> `speech-dispatcher-espeak-ng` — **every one of them output, none of them input.** `whisper` and
> `vosk`, which appeared only in the old reproduce command, and `sphinx`, `onnx`, `deepspeech`,
> `julius` and `nerd-dictation`, which appeared only in the old stated search, are **all** in the one
> pattern above and **none** of them matches. That is a stronger result than either half claimed.
>
> **Not re-run in the session that amended this document** (no network), so the count `7` is the
> original **[measured-here]** reading and the *pattern* is what changed. Section 8's refutation row
> asks a future reader to re-run exactly this line; there is now exactly one line to re-run.
>
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
- **R1 on Windows-on-ARM: re-scored, because the earlier scoring double-counted (R7-34).** The
  previous text charged STT with *"a download, an extraction … and a binary we would then have to
  sign"*, and its own cited source says the opposite about who pays:

  > *"There is **nothing to decide separately for STT**: the `win-arm64` fetch-from-GitHub-releases
  > plan **already required for TTS (P13)** covers voice input too."*
  > — `docs/.research/q-round1-platform.md:516-518`

  **Piper via `sherpa-onnx-node` is the default TTS engine**, so on Windows-on-ARM the plugin already
  owes the GitHub-release fetch (P13), the pure-JS bz2 extraction (P14) and the signing question
  (`010` Q64) **before voice input is considered at all**. Charging them again to STT counts them
  twice, and it was one of two legs holding up the M17c verdict.

  | Windows-on-ARM cost | Who pays it | STT's marginal share |
  |---|---|---|
  | The `win-arm64` binary is absent from npm (P13) | **TTS already** — Piper is the default engine | **zero** |
  | Fetch from the GitHub release + `unbzip2-stream` extraction (P14) | **TTS already** | **zero** |
  | Signing / notarizing a fetched native binary (`010` Q64) | **TTS already** | **zero** |
  | The non-ASCII Windows path relocation (P8) | **TTS already** | **zero** |
  | **The recognition model download** | nobody yet | **87.7 MiB [documented]** — the whole delta |

  A detail the earlier text never mentioned: upstream publishes explicit **`-no-tts` variants** of the
  same release —
  `sherpa-onnx-v1.13.6-win-arm64-shared-MD-MinSizeRel-no-tts.tar.bz2` at **15.4 MB compressed**
  **[documented]** (`docs/.research/q-round1-platform.md:488-491`, `:495-497`), against 19.4 MB for
  the full build. That matters only for an STT-**only** sidecar; we would ship the full build, which
  is the one TTS already needs.

  **What remains genuinely true:** on Windows-on-ARM there is **no OS fallback equivalent to SAPI on
  the input side** (`q-round1-platform.md:516-518` says this in the same breath), so if the
  GitHub-release path is ever skipped, voice input simply does not exist there. That is a real R1
  risk. It is just not a *binary-acquisition* cost, and it is not STT's to pay first.
- **Cost: 87.7 MiB minimum** for the smallest English model ORCA ships **[documented]**, 119.0 MiB for
  Moonshine tiny over 12 files **[documented]** (`q-round1-platform.md` Q17). That is a first-run
  download an order of magnitude larger than the TTS voice, and **after R7-34 it is the *entire*
  delta rather than one item on a list of four.**
- **This is the only option that gives us the audio stream** — with the caveat section 2a now
  states: *where the audio stream comes from* was never answered here either. Option F below needs
  the same stream for a fraction of the model.

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

### F — VAD-only, no recognition — new, R7-35

**Detect that a human started talking. Never find out what they said.**

This option was missing from the five above, and its absence is the sharper half of R7-35: a grep for
`vad|keyword|microphone capture|audio capture` over the original document returned **nothing**. That
is an omission with a specific cost, because section 1 defines job B as *"stop the speech when the
user starts talking"* and then implements it as a **keypress** — while a voice-activity detector is
precisely the mechanism that detects "the user started talking" **without STT**.

- **Same dependency, no new one.** `sherpa-onnx-node`'s JS layer ships `vad.js` and
  `keyword-spotter.js` beside `non-streaming-tts.js`, over **exactly one** `sherpa-onnx.node`
  **[documented]** (`docs/.research/q-round1-platform.md:462-468`, `:438`). The constitution names
  this explicitly as the reason the dependency was chosen: *"`sherpa-onnx-node` covering TTS, **STT,
  VAD and keyword spotting** is worth more than four narrower packages"*
  (`.specify/memory/constitution.md:128-129`). **The project's own Complexity principle argued for
  this capability and no design had used it.**
- **R1: same as option B**, no better and no worse — one native binary, the `win-arm64` marginal cost
  re-scored above at **zero**.
- **R3.4: satisfied.** Offline, key-free, no network after the model lands.
- **P4 (the 50 MB cap): this is the axis where F is not close to B.** A VAD model is **~1–2 MB**
  **[claimed]** — an order-of-magnitude-and-a-half smaller than the 87.7 MiB recognizer, and the only
  candidate in this document that could plausibly live *inside* the plugin rather than in a runtime
  cache. **Nobody has measured it here**, and it is the single number that decides whether F is a
  download-free rung; the probe is one line in **Q84**'s block below and it has not been run.
- **P5: satisfied** — a model file is data, not a build step.
- **What it buys that E does not:** hands-free barge-in. The listener talks over the agent and the
  agent stops, with no key to find. That is buzz's *"talking over the agent **is** the stop gesture"*
  (section 6.1) taken literally rather than approximated by a press.
- **What it buys that B cannot, cheaply:** keyword spotting on the same addon is **this project's only
  route to a hands-free `stop` in terminal focus**, where upstream stablyai/orca#15642 kills every
  chord (`003` section 1 F6). A single wake word is a far smaller model than a recognizer.
- **What it does not buy:** job A. F transcribes nothing. It is an *enhancement to E*, not a
  replacement for B.
- **What blocks it is the same thing that blocks B**, and it is not the model — see section 2a.

### 2a. The blocker this document should have named: where the audio comes from — R7-35

Option B was scored as *"the only option that gives us the audio stream"* with **no account of where
that stream comes from**, and the same gap sits under option F. It is named here because it, and not
model size, is what actually decides M17c.

**Node has no cross-platform microphone capture.** The routes are:

| Route | Cost | Against |
|---|---|---|
| A native addon (`naudiodon`, `node-microphone`, `mic`) | `node-gyp` at install time | **Principle II** and P5 — a plugin is copied, never built. `naudiodon` is abandoned (last push 2024-03, P9) |
| An external binary (`sox`, `ffmpeg`, `arecord`, `parec`) | a setup step per platform | P25's shape exactly: the binary is *not* on the Ubuntu desktop image. This is option C's rung wearing a different hat |
| A renderer with `getUserMedia` | none — the browser does it | **the panel has no `allow="microphone"`**, `connect-src 'none'`, no preload (Q15). Closed |
| A **forked Node worker** driving the platform audio API through the vendored sherpa addon | unknown | **unknown — this is Q84.** `sherpa-onnx-node` ships microphone examples upstream; whether its addon exposes capture, or only accepts buffers a caller must already have, has never been checked |

**No Q-round question has ever asked this.** Every door in section 0 was closed on a model, a binary
or an API; the door that is *actually* load-bearing was never knocked on. **That answer, not the
model size, gates M17c** — because if no route exists, options B and F are both unbuildable
regardless of how small the model gets, and if the forked-worker route works, F becomes a ~2 MB
enhancement to a milestone that is already shipping.

Recorded as **Q84**.

### The recommendation

**Ship E now, as M17a. Offer C behind a setting as M17b. Keep B as the funded future if the listener
wants hands-free, with F ahead of it in that queue. Reject D as an answer and adopt it as a home. Do
not make A the default, and do not make it a lie.**

**The verdict is unchanged and the argument for it is not** (R7-35). The earlier version rested on
four closed doors, and two of them were overstated: option B's Windows-on-ARM cost was double-counted
(R7-34), and a sixth option that needs 2 MB instead of 87.7 MiB was never considered at all. A
verdict resting on overstated obstacles is fragile even when it is correct, so here is the argument
that actually holds:

1. **E is jobs B, C and D, which is everything the M17 gate measures** (section 1). A milestone that
   ships E has a runnable gate on all three platforms. A milestone that ships A has an unrunnable one
   on Linux and an un-hookable one everywhere. **This leg never depended on the model at all** — it is
   a fact about what the gate asserts, and it is why E ships first.
2. **Everything past E — B, C and F alike — waits on Q84**, not on a download size. That is one
   question, answerable in an afternoon, and until it is answered no amount of model shopping changes
   anything.
3. **F, not B, is the next rung if Q84 is positive.** It is ~40× smaller, it is the same addon TTS
   already loads, it delivers the one thing E approximates with a keypress, and it is the only route
   to a hands-free `stop` while #15642 is open.

**What this reordering does not do** is make M17c cheap or scheduled. It stays unscheduled — but for
a stated reason that can be falsified (Q84 comes back negative; a VAD model turns out not to be
1–2 MB) rather than for a cost that its own source says TTS already pays.

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

buzz holds: press opens the mic, release closes it, with an **880 Hz / 440 Hz [documented]** earcon on
each edge — third-party frequencies read out of buzz's source, never measured here and never adopted
(`useHuddlePttState.ts:36-54`, via `q-round1-buzz-transcript.md` item 3; see section 5 for why we do
not copy them). Hold is right when the app owns the mic. **We do not own the mic** in M17a, so what the press bounds is a *listening window* —
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

### 3.3a The precondition that sentence hides, and what happens without it — R7-30

**Stated plainly, because it was not stated at all: the evidence-based close above requires a
non-empty followed set. It has no effect when `F = ∅`.**

`012` guarantees `F = ∅` regularly, and does so on purpose:

- `012` section 2 R1 — *"**Membership is explicit. A new session joins nothing.** … never
  auto-followed."*
- `012` section 2.4 — *"Session appears while `F` is empty and huddle is on → **still not
  followed**."*
- `012` section 2 R5 — `F` is persisted, but ORCA reaps an idle worker after five minutes (P20/P6),
  and members that are gone at restore are dropped.

So **after every reap, every restart and every first run, `F` is empty.** In that state there is no
followed transcript, the `type: 'user'` record has nowhere to be observed, and the window's primary
close signal is dead. What is left is `input.talkWindowMs` — the 30 s clock — or a second tap the
listener has no reason to know is required. **Up to 30 seconds of dead air after the human finished
speaking, on the accessibility path, for a listener who is voice-first and dyslexic.** That is
`003` section 8.7 rule 4's exact concern — *a silence indistinguishable from a crash* — arriving
through the default configuration rather than through a fault.

**Three things change.**

**1. The close condition is chosen at press time, from what is actually armed, and it is *always* a
set — never a single signal.**

| At press | Armed close conditions | Bound on the silence |
|---|---|---|
| `\|F\| ≥ 1` | a `type:'user'` record in **any** member of `F` · second tap · `input.talkWindowMs` | typically one turn |
| `F = ∅`, a control pane is connected | **the control pane's own cwd transcript**, watched read-only for this window only · second tap · `input.talkWindowMs` **reduced to `input.talkWindowIdleMs`** | typically one turn |
| `F = ∅`, no control pane, no readable transcript | second tap · `input.talkWindowIdleMs` | the reduced clock |

**2. The `F = ∅` fallback is a read-only watch, and it is bounded by the window.** When nothing is
followed, the worker resolves the control pane's working directory (`003` section 2D's handshake
already yields it) and watches that worktree's most recently modified transcript **for the duration of
the listening window and no longer**. It is R024-clean — a read, never a write, never speech: **a
transcript watched this way is never spoken from, never primed, never given a high-water mark, and
never enters `F`.** It is used for exactly one bit of information: *did a user record appear.* The
watch is torn down when the window closes, on every path including the timeout.

This is the narrow, reversible half of the choice. **The alternative — auto-following the pane's
session so the normal close applies — is refused**: it is `012` R1's automatic membership with a
nicer name, which is the whole of P22 and P31.

**3. The press says which condition is armed.** One short clause appended to the mic-open
announcement, spoken before the earcon's silence begins:

| Armed | Spoken at press |
|---|---|
| followed set | *"Listening. I'll stop when your turn lands."* |
| pane fallback | *"Listening. Nothing is followed, so I'm watching this pane — tap again when you're done."* |
| clock only | *"Listening. Nothing to watch — tap again when you're done, or I'll resume in fifteen seconds."* |

The wording is `011`'s `announce.*` territory and is taste; **what is not taste is that the listener
is told which of the three they are in.** A listening window whose end the listener cannot predict is
the *"confusing what it is even reading… feel helpless"* failure (P22) inverted into silence, and
P30's lesson applies unchanged: the announcement must reach the audio stream, not a log line.

**Why a shorter clock rather than only a shorter clock.** `input.talkWindowIdleMs` exists because
the clock-only row has no evidence to wait for, so the *only* honest bound is time; its argued
starting value is **15 s** against the followed set's 30 s. It is a floor under the failure, not a
fix — the fix is row 2, and the settings are section 9a's. Both values are the listener's (**P23**).

**Verify by effect:** run the M17a window test with `F = ∅` and assert the window closes on the
pane's user record — **and** run it with the pane watch disabled and assert it closes on
`input.talkWindowIdleMs` and not on `input.talkWindowMs`. Without the second reading the test
passes on a build where the fallback never runs, which is exactly today's behaviour.

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
     under `011`'s `queue.maxQueued` (whatever it is set to), drops announced and coalesced as usual.
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

> **Step 4 restates no number — amended 2026-08-21, forced by finding R7-06.** This step read
> *"under the same `maxQueued = 8` cap"*. Four documents specified that one control three
> incompatible ways and the code held a fourth (`speech-service.ts`'s `DEFAULT_MAX_QUEUED = 20`).
> **`011` section 3.2a owns `queue.maxQueued`**; this document cites it and names no value. If the
> listener sets it to 3, step 4 queues 3.

**The budget — two quantities, named separately.**

> **Rewritten 2026-08-21, forced by finding R7-28.** This paragraph read: *"Barge-in **is** Stop with
> an earcon after it, so the gate is measured on the same budget."* That collapses two real numbers
> into one, which is precisely what `packages/providers/src/budget-claims.test.ts:38-44` exists to
> prevent — *"`003` … defines a **DIFFERENT quantity under the same word**"* — and it is P33's shape in
> a document written after P33 was recorded. **A design document does not move a constitutional
> number.** Doing so is a constitution amendment plus a change to `CANCEL_BUDGET_MS`, proposed and
> decided somewhere the constitution can see it — not a sentence here.

| Quantity | Value | Owner | Measured on |
|---|---|---|---|
| **press → last sample leaves the sink** (end to end) | p50 ≤ 120 ms, **p99 ≤ 250 ms**, CI-failing above 400 ms | `003` section 2 | the sink, by capture: *no samples after press + 250 ms* |
| **provider-cancel segment**, one of that budget's four | **`CANCEL_BUDGET_MS = 50`** (`packages/providers/src/contract.ts`) | the constitution's Latency Budgets row *"Barge-in signal → audio stops"*, under *"A change that regresses one is a bug"* | `cancel()`'s resolution, not the sink |

Both are inherited rather than invented, and **gate M17a asserts both** — the end-to-end bound on the
sink, and the segment bound on `cancel()`. Asserting only the 250 ms would let a 200 ms provider
cancel pass while regressing the constitutional number by 4×; asserting only the 50 ms would let the
drain run long with the constitution still green. Neither reading alone can fail for the other's
defect, which is the whole reason they are two rows.

Note what `010` section 4 adds under the v2 seam (finding R7-18): `cancel()` now resolves on *sound
stopped*, and device drain is `[claimed]` — unmeasurable today without a loopback capture. The 50 ms
above gates **kill-to-exit**, which is what it has always measured (~3 ms `[measured-here]`); the
drain is named as ungated. This document does not re-decide that; it cites it so the two budgets here
are not read as covering a third quantity nobody can observe.

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

> **Rows added 2026-08-21, forced by findings R7-28 and R7-30.** Two of the rows below did not exist:
> the gate asserted the end-to-end budget only, which cannot fail for a provider-cancel regression
> (R7-28); and every close-condition row assumed a non-empty followed set, which section 3.3a shows is
> the *un*usual configuration (R7-30). A gate that only tests the configuration the author happens to
> run is the shape P32 named.

| Test | What would prove us wrong |
|---|---|
| Press `talk` during a 30 s utterance | any sample leaving the sink after press + 250 ms (`003` section 2's probe, reused verbatim) |
| **Press `talk` and time `cancel()` alone** (new — R7-28) | `cancel()` resolving later than `CANCEL_BUDGET_MS = 50` (`packages/providers/src/contract.ts`). This is the constitutional row and it is **not** implied by the row above: a 200 ms cancel inside a 240 ms end-to-end pass would leave that row green while regressing the constitution 4× |
| Press `talk`, then let three replies arrive | any of them being spoken during the window; or none of them being announced at close |
| Close the window by appending a `type:"user"` record to the followed transcript | the window not closing — *negative control:* the same fixture with the user record omitted must **not** close it until the timeout |
| **`F = ∅`, control pane connected** (new — R7-30) | the window not closing when a `type:'user'` record appears in the **pane's own cwd** transcript — *negative control:* with the pane watch disabled, the same fixture must fall through to `input.talkWindowIdleMs` and **not** to `input.talkWindowMs`. Without that second reading the test passes on a build where the fallback never runs, which is today's behaviour |
| **`F = ∅`, no pane, no readable transcript** (new — R7-30) | the press announcing a close condition that is not armed, or the silence outlasting `input.talkWindowIdleMs` |
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

## 9a. Settings this milestone adds — R7-29

**`014` R7-29 found this document inventing controls `011`'s frozen schema does not carry, while
citing `011` nowhere.** Every one of them is registered below as an `011` `FieldDescriptor` at
`since: 3`, through the protocol in `011` section 4.2a. **`011` owns the schema, the defaults rule
and the migration policy; this document owns only what each field means here.** No default below is
decided by this document — every one is `provisional` and every one is the listener's (**P23**).

| Id | Kind | Effect | Argued at | What it means here |
|---|---|---|---|---|
| `input.talkWindowMs` | `int` | immediate | section 3.3, section 3.3a | The listening window's clock **when a close signal is armed**. Argued starting value 30 s. Was `TALK_WINDOW_MS`, a constant in prose. |
| `input.talkGesture` | `enum` — `hold` · `tap-tap` · `tap-timeout` · `latch` | immediate | section 3.3 | Which gesture opens the window. Section 3.3 argues `tap-timeout` because its failure is bounded and audible; **Q77 is the listener's**, and all four ship. |
| `input.resumePolicy` | `enum` — `discard` · `resume-sentence` · `resume-word` | next utterance | section 6.2 | Q19's answer. Section 6.2 recommends `discard` and says why word boundaries do not change it; **Q78 is the listener's**, and all three ship because the replay buffer makes every choice non-destructive. |
| `input.recognizerCommand` | `string` | next utterance | section 7 (M17b) | The command M17b spawns, its stdout contract in `013` section 7. `enginePersonal: true` — a path does not transfer between machines. Absent is not an error; it is a **named refusal**. |
| **`input.talkWindowIdleMs`** (new here) | `int` | immediate | section 3.3a | The clock when **no evidence-based close is armed** (`F = ∅`, no readable pane transcript). Argued starting value **15 s**, deliberately shorter than `input.talkWindowMs`, because the only honest bound on a silence with nothing to wait for is time. It is a floor under the failure, not a fix. |
| **`input.paneFallbackWatch`** (new here) | `bool` | immediate | section 3.3a rule 2 | Whether the `F = ∅` window may watch the control pane's own cwd transcript, read-only, for the duration of the window. Argued starting value **on**. Its `false` setting is the **negative control** gate M17a runs; a listener who wants zero unfollowed reads turns it off and gets the reduced clock instead. |

**Six ids, not the four `011`'s forward register listed** — `input.talkWindowIdleMs` and
`input.paneFallbackWatch` are section 3.3a's, which did not exist when that register was written.
Both are added to it in the same change, per rule 3 of `011` section 4.2a: **the design document
writes one row and cites `011` for everything else.**

**Not settings, deliberately.** The three spoken clauses in section 3.3a's press table are wording,
and wording is `011`'s `announce.*` territory — this document does not register an id for a sentence.
`control.mic.open` / `control.mic.close` are earcon ids owned by `005` section 11.1b, not settings.
And **the barge-in budgets in section 4 are not settings at all**: one is `003`'s, one is the
constitution's, and a constitutional number does not become tunable by being written down twice
(R7-28).

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
