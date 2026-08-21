# 015 — M9 rescoped: hold the device, not the engine

**Status:** design amendment. **Written:** 2026-08-21. **Repo at:** `d404f17`.

> **This is an amendment to `docs/design/010-provider-seam-and-resident-service.md`, written as a
> separate document on purpose.** 010 is under review by another agent as this is written and must
> not be edited concurrently. When that review lands, 010 absorbs this document — sections 8, 10 and
> 12 of 010 are the ones that change. Until then, **where 010 and 015 disagree, 015 is the later
> evidence and wins**, and 010's amendment blocks already say so about their own predecessors.

**What this document decides.** M9's deliverable. For the whole life of this project M9 has read
*"resident service **+ Piper**, because only a neural engine meets the 500 ms budget"*
(`docs/TASKS.md` Phase M9; repo issue #3's title says it outright). Two measurement passes have now
falsified that sentence twice over — once on the mechanism, once on the engine — and this document
rewrites the milestone against what was measured.

**Label vocabulary** (constitution R006): `[measured-here]` — a probe in this repo, run on a named
machine, with a run count. `[derived]` — arithmetic over `[measured-here]` values, shown as
arithmetic. `[documented]` — a vendor or upstream source, cited. `[claimed]` — nobody has run it.
Every number below carries one. The reason for the discipline is P32: this project quoted an
unmeasured number for months and it reached the constitution before anybody checked.

**A note on provenance.** The figures here are read from the two committed research documents named
below, not from a briefing. Where a summary of SPIKE-1 circulating in this session quotes
*17.5 ms / 348–366 ms cold / 9.7 MB / 0.056 %*, the committed document reads **17.7 and 17.1 ms**,
**307–345 ms cold**, **9.4 MB private footprint** and **0.05 % CPU**. The differences are inside the
probe's own spread and change no conclusion, but the committed document is the citable one and is
what is quoted throughout.

---

## 0. The three measurements this document is built on

| # | Fact | Label | Source |
|---|---|---|---|
| **G1** | The inter-sentence gap is **p50 950 / 937 / 897 ms**, n=18 per run over three runs. Decomposed: player fork/exec **2.3 ms** (n=12), the sink's whole temp-file round trip **0.33 ms** (n=20), and **~893 ms — 99.7 % — is CoreAudio device open, pre-roll, post-roll and teardown**. A regression of `afplay` lifetime against audio duration gives slope ~1.0 and intercept **905–915 ms**: a fixed per-invocation cost | `[measured-here]`, the ~893 ms `[derived]` | `docs/.research/latency-measurements.md` 1.1 and 2.5; PITFALLS **P32** |
| **G2** | A **warm** resident `AVSpeechSynthesizer.write(_:toBufferCallback:)` reaches its first non-empty, non-silent PCM buffer in **p50 17.7 ms (run 1) / 17.1 ms (run 2)**, n=20 each, max observed 21.6 ms. The whole utterance renders in p50 ~38 ms | `[measured-here]` | `docs/.research/spike1-resident-synth.md` 1 |
| **G3** | The **cold** first buffer — the first `write()` in a fresh process — is **307–345 ms, p50 328 ms**, n=8 fresh processes. Residency is therefore worth **~311 ms per utterance** `[derived]`, and that is the whole of its synthesis-side value | `[measured-here]` / `[derived]` | `docs/.research/spike1-resident-synth.md` 2 |

Two supporting facts, both from `spike1-resident-synth.md`:

- **SSML is free on macOS** — the SSML arm reads p50 17.4 / 17.5 ms against the plain arm's
  17.7 / 17.1, a delta of **−0.3 / +0.4 ms**, below the probe's resolution, n=20 per arm
  `[measured-here]` (section 3). The seam can require SSML without a latency argument against it.
- **Idle residency costs 0.05 % CPU and 9.4 MB of private footprint** (appearing as 35–38 MB RSS to
  an observer with `ps`), sampled over a 30 s idle window, two runs `[measured-here]` (section 3.1).
  **That figure holds the synthesizer only and explicitly excludes the audio device**, which is the
  thing this document is about. The idle cost of a *held-open device* is `[claimed]`.

**Put G1 and G2 side by side and the milestone changes.** Synthesis on macOS is **17.7 ms** and the
device cycle is **~893 ms**. The engine is 2 % of the problem. The device is 98 % of it.

---

## 1. What M9 is now, and what it is not

**M9 is the milestone that holds one audio output device open across an entire spoken reply.** Its
deliverable is a resident process that owns both a warm synthesizer and a running output device, and
that streams PCM from the first into the second without closing either between sentences, between
chunks, or between the earcon and the first word. Everything M9 has ever been credited with —
first audio inside 500 ms, an affordable per-turn earcon, ducking for a phone call, a real two-sided
cancel, pause and resume, a word cursor — follows from that one property and from nothing else in
the milestone. The synthesizer being resident buys **~311 ms once per ORCA session** `[derived]`
(G3); the device being resident buys **~890 ms per sentence boundary, every boundary, forever** (G1).

**M9 is not an engine swap.** Piper is not on the latency critical path on macOS and this document
takes it off. Section 3 argues it back in on quality, which is a different and still-good argument.

**M9 is not "stop spawning a player process per chunk", and this is the sentence someone will
rebuild if it is not written down bluntly.** That change is easy, it is satisfying, it passes review,
it ships — and **it alters nothing a listener can hear.** Player fork/exec is 2.3 ms of a 950 ms gap
(G1). A resident sink that pools or pre-warms player *processes* and still opens the device per
chunk recovers **0.25 % of the cost**. The same arithmetic kills the latency argument for dropping
the temp file with `--stdout` (P29): the round trip is 0.33 ms, 0.03 %. Neither is a performance
change in either direction.

The question to ask any candidate playback path, on any platform, is **"does it hold the device open
between buffers"** — never "how fast does it start".

**The evidence for the fast path is already in the data, by accident.** In the earcon probe,
**2 of 10 samples in run 1 and 3 of 10 in run 2 came in at ~370 ms instead of ~870 ms**, and only
when a previous `afplay` had exited moments earlier — a device CoreAudio had not yet torn down
`[measured-here]` (`latency-measurements.md` 1.4). The `interchunk.gap` run shows the same thing
once, at 464 ms against a 840–990 ms field (`latency-measurements.md` 2.3). Nobody built that; it is
the machine handing us a preview of the warm-device path five times out of twenty. **That ~500 ms
delta is what M9 is for.**

---

## 2. What actually has to be built

A resident **speech service**: one process per ORCA plugin data directory, holding

1. a warm synthesizer handle (macOS: `AVSpeechSynthesizer`, rendering through
   `write(_:toBufferCallback:)`, which touches no device by construction), and
2. a running output graph (macOS: an `AVAudioEngine` with an `AVAudioPlayerNode` attached to
   `mainMixerNode`, started once and left running), and
3. a command socket, addressed per-worktree, never globally (010 section 11.2 and P27).

Synthesis buffers are scheduled onto the player node as they arrive. Nothing between sentences stops
the engine. **The state that must never be entered on the hot path is `engine.stop()`.**

The rest of this section specifies the four device-lifecycle behaviours 010 did not cover, because
010 was scoped as an engine document. **Every behavioural claim about the platform below is
`[claimed]` — the probes that would settle each are named inline. None of them has been run, and
this document does not get to assume them.**

### 2.1 Acquiring and releasing the device

| Event | Behaviour | Why |
|---|---|---|
| Service start (`prepare()`) | Start the process, load the voice, **do not start the engine.** Answer `/health`. | Starting a device at plugin activation makes every ORCA launch pay for speech that may never happen. 010 section 11.1 already chose lazy start; G3 prices it at ~311 ms `[derived]`, paid once. |
| First `synthesize` of a session | Start the engine, and only now open the device. Warm cost is what the M9 gate measures. | This is the one place a device open is allowed on the hot path, and it happens once per session, not once per sentence. |
| Queue drains, more speech plausible | **Engine stays running.** Player node idle, no buffers scheduled. | This is the entire milestone. A device released between sentences is a device re-opened between sentences. |
| Idle > `IDLE_RELEASE_MS` (default 60 s) | `engine.pause()` — release the device, keep the synthesizer and voice resident. | 010 section 11.5's table already committed to this row. The next utterance pays one device open (~890 ms `[claimed]` in this configuration), not one cold start. Constitution Principle VI: never degrade the host. |
| Idle > `IDLE_EXIT_MS` (15 min; 5 min on battery) | Process exits. Next `prepare()` restarts it, paying ~311 ms `[derived]`. | 010 section 11.5. |
| Never | A heartbeat, a keep-alive tone, or any timer that touches the device on a schedule. | Cross-review B-03: on battery a periodic wake alone prevents the audio hardware from entering its idle state. Anything periodic is requested by a caller, is bounded, and ends with a spoken sentence. |

**Verify by effect, and this is the check nobody in this project has run:** `powermetrics` sampled
for 60 s with the service warm and the queue empty, against the same 60 s with the plugin disabled.
Watch **wakeups/sec** and **package idle residency** move, or fail to. An after-only reading proves
nothing (R004). The number this produces is the missing half of `spike1-resident-synth.md` 3.1.

### 2.2 When another application takes the device

**The honest starting point: on macOS this is mostly not a thing, and the design must not pretend it
is.** macOS has no `AVAudioSession` — that is iOS — and CoreAudio output devices are shared between
processes by default. Another app playing audio does not evict us. The failure modes that are real
are narrower and each needs its own answer:

| Situation | What we do | Label |
|---|---|---|
| Another process takes the device in **hog mode** (`kAudioDevicePropertyHogMode`), or an exclusive-mode pro-audio app starts | The engine's render callback stops being served and the engine reports a failure. **Announce the rung change by name** — *"Audio output was taken by another application; I have stopped speaking"* — and fall back to the subprocess sink for the next utterance, which will succeed or fail loudly on its own. Never fail silently (R009, R015) | `[claimed]` — needs a probe that hogs the device and asserts the spoken sentence |
| ORCA's own first-party STT opens the input device | Nothing. Different device, different direction. | `[claimed]` — worth one check that the two coexist |
| A phone call, a meeting, a dictation session | This is **B-04**, and it is a requirement on this milestone, not a later patch. See section 7.4 | — |
| The device disappears entirely (USB interface unplugged) | Same path as a default-device change, below, with no successor device: release, announce, do not spin re-acquiring | `[claimed]` |

**On Windows the equivalent is real and different:** WASAPI exclusive mode genuinely evicts shared
clients. Whatever the Windows sidecar does must be written against that, not translated from macOS.
`[claimed]`.

### 2.3 Default-device change mid-sentence

**This is not a hypothetical for this user. Plugging in headphones while an agent reply is being
spoken is an ordinary Tuesday**, and today it is handled by nobody: `afplay` owns the stream, we own
nothing, and the listener gets whatever CoreAudio does.

The behaviour M9 must implement:

1. Register for the default-output-device change — on macOS,
   `AVAudioEngineConfigurationChangeNotification`, and/or a listener on
   `kAudioHardwarePropertyDefaultOutputDevice`. `[claimed]`.
2. On notification, the engine is already stopped and its output format may have changed (a new
   device can have a different sample rate). **Re-fetch the output format, rebuild the connection,
   restart the engine.** Do not assume 22,050 Hz survives the change — the sink's `sampleRate` is a
   provider constant today, which FMA PV11 already records as wrong.
3. **Resume from the last completed word boundary, not from the top of the reply and not from
   nowhere.** Word-boundary callbacks arrived on 40 of 40 utterances in SPIKE-1 `[measured-here]`
   (`spike1-resident-synth.md` 1.3); they are what makes a resume point exist at all. Extension 5 of
   010's seam is load-bearing here, not a nicety.
4. If more than one sentence was lost, **say so** — *"Output moved to headphones; repeating the last
   sentence."* — at `next` urgency, never `now` (P30). If nothing was lost, say nothing: an
   announcement on every headphone plug is its own harm.
5. Bound the retry. One rebuild per notification, with backoff; a device that changes five times in
   two seconds gets one rebuild, not five.

**Verify by effect:** a test that changes the default output device mid-utterance and asserts the
**spoken** sentence, with `log` and `notify` both disabled. Negative control: change nothing, assert
no such sentence. Without the negative control the test cannot fail.

### 2.4 Two-sided cancel when we own the device

Constitution R014: *cancel is two-sided — abort synthesis and flush buffers, never merely kill the
player.* Today macOS cancel is `SIGKILL` on a child that has **already written its WAV**, so the
"abort synthesis" half is vacuous and the "flush buffers" half is delegated to process death.
Measured, `kill`-to-exit on `afplay` is **p50 3.5 / 2.9 ms**, n=10 per run `[measured-here]`
(`latency-measurements.md` 1.5) — and that is *the process dying*, not audio stopping.

When we own the device the shape inverts, and it becomes better *and* newly falsifiable:

| Half | Today | Resident |
|---|---|---|
| Abort synthesis | nothing to abort; the WAV exists | `stopSpeaking(at: .immediate)` on the synthesizer; drop every buffer not yet scheduled. `[claimed]` |
| Flush audio already committed | `SIGKILL`, then whatever CoreAudio had accepted plays out, unobservable | `playerNode.stop()` flushes scheduled buffers; the device stays open and silent. **The engine does not stop.** `[claimed]` |
| Bound on what the listener still hears | the device's own buffer, unmeasured | one render-quantum plus the ramp we choose. A short fade — buzz uses an 8 ms fade `[documented]` (`prior-art-buzz.md`) — avoids the click that an instant cut produces |
| Observability | none | **the render callback is ours**, so the sidecar can timestamp the last non-silent sample it emitted. This is the first time in this project's life that "audio stopped" is a measurable instant |

That last row is the quiet win and it is worth naming: **owning the device converts design 003's
50 ms drain segment from unmeasurable to measurable.** See section 7.3.

**Cancel must remain two-sided in the degenerate case too:** if the service is dead, the client's
cancel still has to stop whatever the subprocess fallback is doing. A cancel path that only works on
the happy rung is a cancel path that fails exactly when things are already wrong.

---

## 3. Piper's place, restated honestly

**Piper stays. Its justification changes, and latency is not allowed back in as part of it.**

**What is withdrawn.** Repo issue #3's title — *"the only thing that meets the latency budget"* — and
010 section 8.2's replacement recommendation — *"residency is necessary and not sufficient… R4.2 is
unreachable on the OS-synth rung by any amount of residency"*. That recommendation rested on
attributing ~640–750 ms of the measured `say` cost to *synthesis compute* (010 section 8, row 4,
`[derived]`). SPIKE-1 renders the same class of sentence in **17.7 ms warm and ~328 ms cold**
`[measured-here]` (G2, G3), so the remainder in `say` is not compute — it is per-process engine and
voice initialisation plus a WAV file, i.e. the cost `say` pays *because it is a new process every
time*. **The 1,054–1,163 ms measurement of `OsSynthProvider.generate()` still stands** — it is
`[measured-here]` and nothing here contradicts it. What is falsified is its *attribution*, which is
precisely the failure P32 already caught once in this repo, in the other direction.

**What Piper is actually for: quality, and quality here is an accessibility property, not a
luxury.** This listener spends hours a day with this voice. The evidence:

- **All 180 installed macOS voices on this machine are `quality == .default`** — the compact tier
  `[measured-here]` (010 section 10). Enhanced and premium are optional downloads we cannot perform
  on the user's behalf.
- **The OS-native tier is not one tier.** Windows third-party apps are fenced to SAPI 5 `*Desktop`
  voices (Zira/David); Linux out of the box is espeak-ng formant synthesis, when the binary is
  present at all (P16). So "use the OS voice" means three different sounds on three platforms.
- **R1 parity is about what the listener *hears*, not about what compiles.** A milestone that ships
  three different-sounding tiers has not delivered parity of the product's only output channel.
  Piper is one good voice, identical on all three platforms.

**So Piper's argument is: one voice, everywhere, that a person can stand to listen to for six
hours.** That argument is strong enough on its own and does not need to borrow a latency claim it no
longer has. It also runs on its own schedule: Piper lands as an *engine inside a service that
already exists*, behind the seam, gated on a quality comparison rather than on a stopwatch. Its
measured 52–65 ms/sentence `[measured-here]` (P11) becomes a **regression guard** — the thing that
must not get worse — rather than the gate.

**One thing that does not change:** M9b still carries the model manager, the resumable download, the
checksum, the licence display, P8's non-ASCII Windows cache path and the `Björn` regression test, and
P4's hard 50 MB / 2,000-file plugin cap that a voice model cannot live inside. Those costs were
always Piper's, and separating the milestones is what stops them from being M9a's.

---

## 4. R1's cost, unflinching

R1 is non-negotiable: identical features on macOS, Linux and Windows, out of the box. **A resident
speech service is three programs**, and only one of them has been measured.

| Platform | Synthesis probe | Device story | Status |
|---|---|---|---|
| **macOS** | `AVSpeechSynthesizer.write(_:toBufferCallback:)` — **p50 17.7 / 17.1 ms warm**, n=20 ×2 `[measured-here]` | `AVAudioEngine` + `AVAudioPlayerNode`, held open. **Unmeasured** — the probe is audible by construction and does not exist | **synthesis measured, device `[claimed]`** |
| **Windows** | `SetOutputToAudioStream` + `SpeakProgress`. Probe committed at `scripts/spikes/spike1-windows-firstbuffer.ps1` | WASAPI shared-mode client held open; exclusive-mode eviction is real here and is not a macOS translation | **`[claimed]` — probe never executed. No Windows machine here; `pwsh` is not installed, so it has not even been parse-checked** |
| **Linux** | speech-dispatcher SSIP. Probe committed at `scripts/spikes/spike1-linux-firstindex.mjs` | **There is no device to hold.** SSIP has no audio-retrieval verb and `libao.c` opens a live device, so the daemon owns output permanently | **`[claimed]`, and it measures a different quantity — "the daemon told us it started", not "a sample reached the listener"** (`spike1-resident-synth.md` 5) |

**What it costs to be wrong on Windows.** If the Windows warm first-buffer lands **above 350 ms**,
then residency alone does not buy the synthesis budget there, and a neural engine is back on the
critical path for Windows even though it is off macOS's. That would **not** re-merge M9a and M9b —
the device work is still the dominant term and still platform-independent — but it would move Piper
from "M9b, gated on quality" to "M9b, gated on quality *and required for the Windows latency gate*",
and Windows-on-ARM has no `sherpa-onnx` npm build (P7), so that platform would be left with a rung
that cannot pass. **That is the outcome worth knowing about before T090, and it costs one command on
one machine.**

**What it costs to be wrong on Linux.** Nothing about the number, and everything about the shape.
Linux is a `spoke-elsewhere` provider **permanently** unless `espeak-ng` is used as a *library*,
which is a different rung, a different probe, and is not written. If the SSIP probe comes back slow,
the answer is not "optimise SSIP" — it is that the Linux resident service delivers pause, resume and
index marks and never delivers bytes, and every document that scores Linux must say so.

**The decision if a probe fails.** Stated in advance so it is not re-litigated under pressure:

1. **Windows above 350 ms** → M9a still ships (the device work is what it is), the Windows *latency*
   gate moves to M9b, and the milestone announces which rung each platform is on. Do not hold macOS.
2. **Linux SSIP unusable or absent** → the existing `spd-say` floor rung stands, declared by name,
   with `bytes: false` in the capability descriptor. This is already shipped behaviour (P25); M9
   models it rather than discovering it.
3. **macOS device probe fails the gate in section 6** → the fallback is design 004's browser path
   (section 7.2), which holds one `AudioContext` open and is the *other* way to keep one device open.
   That is a real alternative, not a consolation.

**Parity says they ship together, and honesty says they are unequal.** The resolution is not to
delay macOS until Windows is measured — it is that **no document may score R1 as passing on the
strength of the macOS number**, and the milestone's own report must print the label per platform.

---

## 5. The staging

Four rungs. Each ships. Each is honest about which rung it is on, and each **sounds** different from
the one before — that is the test of whether it was worth shipping.

### Rung 0 — today

Subprocess synth, subprocess sink, one device open per chunk. **Sounds like:** first audio between
**1,112 ms and 2,017 ms** `[measured-here]` (bracket, n=10 ×2), a **~950 ms** silence between
sentences `[measured-here]`, an earcon that costs **~870 ms** before the first word
`[measured-here]`, no pause, and a Stop that is fast to exit and unmeasured to silence.

### Rung 1 — the seam changes, nothing else does

Land `TtsProvider` v2 (010 Part 1) with `OsSynthProvider` as its only implementation. Every new
capability declared **absent** and refusing **by name**. **Sounds like rung 0.** That is the point:
it is a shape change with a zero-diff audio signature, and if it sounds different something is wrong.

### Rung 2 — the macOS sidecar, device held, OS voice

The resident service, macOS only, OS synthesizer, one device for the whole reply. **Sounds like:**
the same voice as today, arriving **immediately** and **without the silence between sentences**.
This is the rung a listener notices, and it is the one the section 6 gate is written against.
Windows and Linux stay on rung 1 and **the plugin says which rung it is on when asked** (R015).

### Rung 3 — Windows and Linux sidecars

Parity of transport. **Sounds like:** Windows gains rung 2's gaplessness; Linux gains pause, resume
and a word cursor, and still sounds like espeak-ng because the daemon still owns the audio. Only at
this rung may any document claim R1 parity for the resident architecture, and even then the *sound*
is not at parity — which is what rung 4 is for.

### Rung 4 — M9b, Piper inside the service

One voice on all three platforms. **Sounds like:** the same immediacy as rung 2, in a voice worth
six hours a day. Latency does not improve materially on macOS; **say so in the release note**, or the
next person will re-derive the wrong reason for this rung's existence.

---

## 6. The revised gate for M9a

010 section 8.2 got one thing exactly right and it is the shape to copy: a pass condition, and a
sentence naming what would prove it wrong. A gate without a falsifier is not a gate.

**Gate M9a — the device stays open across a reply.**

| | |
|---|---|
| **Instrument** | The `interchunk.gap` probe definition already in `scripts/bench-latency.mjs`: `gap = wall(enqueue) − audioDuration(WAV header)`, summed across each sentence boundary, audio duration read from the file's own `fmt ` chunk. Six real sentences, three rounds, n≥18 |
| **Pass — the gap** | **p50 gap ≤ 50 ms and p95 ≤ 100 ms**, and the **gap-to-audio ratio p50 ≤ 5 %** |
| **Pass — the device count** | the sidecar reports **exactly one engine start / device open for the whole reply**, asserted by the test, not inspected by a human |
| **Pass — first audio** | the **upper** bound of the first-audio bracket (`firstaudio.upper`: the call through to the end of the playback path's fixed overhead) **p50 ≤ 500 ms** warm. The conservative end, so the gate cannot be met by choosing the flattering bound |
| **Pass — idle** | with the queue empty and the device held, `powermetrics` shows **no measurable rise in wakeups/sec** against the plugin-disabled baseline, and the device is released after `IDLE_RELEASE_MS` |
| **Baseline, run in the same session (R004)** | the same probe against today's `SubprocessSink` must read **~890–950 ms**. If it does not, the instrument is broken and the after-reading means nothing |
| **FALSIFIER** | **p50 gap above 150 ms, or more than one device open per reply, or `firstaudio.upper` p50 above 500 ms.** Any one of the three means residency has not bought the device back, the resident-sink architecture is not the answer on that platform, and the milestone routes to design 004's held-`AudioContext` path instead |
| **Ratio, not absolute** | the gap threshold is stated as a ratio as well as an absolute because absolute device-open cost is a property of the machine's audio stack — a USB DAC or a Bluetooth output changes it by more than the effect we are detecting (`latency-measurements.md` 4). A ratio cancels the machine |

**Gate M9a is a manual, recorded gate — not a CI gate — and `docs/TASKS.md`'s T097 was wrong to say
"in CI".** CI runners have **no audio device at all**: `actions/runner-images` has zero references to
`alsa` or `pulseaudio` (P16). Every probe that matters would report NOT-RUN, and a permanently-NOT-RUN
row is a broken indicator. What CI *can* gate is the protocol: socket lifecycle, version refusal,
cancel semantics, restart-and-resume, and the capability descriptor.

**And the gate is audible to run.** `afplay` has no device-selection flag, stock macOS ships no null
sink, and there is no silent substitute (`latency-measurements.md` 1.0; P31). Whoever runs it must
not be listening to that machine. The second-machine rig is the cheap answer; the CoreAudio
render-callback probe is the one that also settles section 7.3.

**What SPIKE-3 must be, and it does not exist yet.** A probe that opens a device, holds it, and plays
two buffers separated by a pause, reporting the gap between them and the device-open count. It is the
one measurement standing between this document and a defensible M9a plan, and it is `[claimed]` in
every configuration today.

---

## 7. What this changes elsewhere

### 7.1 The earcon (design 005)

Design 005 costs a two-note identity earcon at 60 + 20 + 60 = **140 ms** and carries that number
through its options D and E. Measured through the shipped sink as its own `AudioChunk`, it costs
**p50 874 / 862 ms**, n=10 per run `[measured-here]` — **6.2× the design figure**, inserted *before
the first word*, on the guaranteed floor of N = 1 voice where every agent is in overflow and the tax
is mandatory per turn (`latency-measurements.md` 1.4).

**Residency is what makes the earcon affordable, and the mechanism is exact:** the earcon costs a
whole device cycle *only because it is a separate device cycle*. Scheduled onto an already-running
player node it costs its own 140 ms of audio and approximately nothing else `[claimed]`. So 005's
identity design is not over-budget — it is **blocked on M9a**, and any per-turn earcon shipped before
rung 2 should be costed at ~870 ms in the document that ships it.

### 7.2 Design 004's browser-playback choice — does it still hold?

**Yes, and for a better reason than it was originally given.** 004 chose browser playback partly
because it removes "a process spawn per chunk". That framing was wrong (P32), and 004's own
amendment already says so. The correct argument is stronger: **one `AudioContext` stays open for the
whole session, so the device is opened once rather than once per chunk** — 004 is, architecturally,
*the same fix as M9a*, reached first, on a different runtime.

Three consequences worth stating:

1. **004 does not become redundant when M9a lands.** The lab's replay-from-decoded-`AudioBuffer` path
   (`~0 ms` `[claimed]` — reasoning about `source.start()`, no probe) is a cache, not a device fix,
   and no sidecar gives it that for free.
2. **004 is M9a's live fallback**, named in section 4's decision 3. If the macOS device gate fails,
   the held-`AudioContext` path is the other way to hold one device open, and it is already designed.
3. **004's `simulateChunkGapMs` preset of `970` is now a `[measured-here]` number** — p50 950/937/897
   — where it previously shipped as *"(v1 macOS, measured)"* over a third-party changelog figure.
   The preset value survives; only its provenance changes. **After M9a it becomes a historical
   preset**, and the lab should say which era it simulates.

### 7.3 Design 003's Stop budget and its unmeasured drain segment

003 budgets Stop at 250 ms across four segments, of which **"audio device drain — 50 ms"** is
`[claimed]`: nothing has measured it, and the 1.5 ms `ffplay.kill()` cited as its basis measures a
different quantity on a player we do not ship. Measured on the player we *do* ship, `kill`-to-exit is
p50 3.5 / 2.9 ms `[measured-here]` — still the process dying, not the audio stopping.

**M9a changes this from "unmeasurable" to "measurable", and that is the most under-appreciated thing
in this rescope.** When the render callback is ours, the sidecar can timestamp the **last non-silent
sample it emitted** after a cancel. No loopback rig, no capture device, no second machine — the
number falls out of owning the device. Two follow-ons:

- **003's 50 ms drain segment should be marked "measurable at rung 2, unmeasured until then"**
  rather than left as a bare estimate, and M9a's brief should carry the one-line requirement that the
  sidecar report it.
- **The contract suite's cancel gate is still a check that could not fail**: the assertion is
  `<= CANCEL_BUDGET_MS * 20` = 1,000 ms while nine documents quote it as *"measured at 50 ms"*.
  That is independent of M9 and should be fixed independently — but M9a is what finally makes a real
  50 ms gate assertable, so the two should land together.

### 7.4 B-04 — ducking for a phone call

Cross-review B-04 calls this **structural, not an oversight to patch later**, and it is right: a
spawned player participates in no audio-session policy — it cannot request ducking, cannot be ducked
by us, and cannot be told to yield. **Ducking is therefore not a feature that can be added to the
current sink at any price. It is a property of owning the device, which means it is a property of
M9a.**

What that puts in M9a's brief, now rather than later:

- The sidecar exposes **`duck(level)` / `unduck()`** as transport verbs alongside `pause`/`resume`,
  implemented as a gain ramp on the mixer — cheap, because we own the graph.
- **"An exclusive audio session appeared" becomes a first-class input to 003's state machine**,
  alongside `mute`. B-04's own proposal: it is a *level*, exactly like mute, and it costs one state.
- The near-term half stays where B-04 put it: `orca-tts stop` / `orca-tts mute` from a terminal is
  the only route that works from outside ORCA, and it is the documented take-a-call answer until
  rung 2.
- **Do not promise automatic ducking before the sidecar exists.** Detecting "a call started" on
  macOS is `[claimed]` and unprobed; the manual verb is the honest v1 of this feature.

---

## 8. What this document is least sure of

Recorded here rather than discovered later:

1. **The entire device half is `[claimed]`.** SPIKE-1 measured synthesis in a process that opened no
   device. The proposition *"an `AVAudioEngine` held open across sentences reduces the gap from
   ~890 ms to tens of ms"* is inference from the accidental warm-device samples (~370 ms against
   ~870 ms, 5 of 20) plus the structure of the cost. It is a good inference. It is not a measurement,
   and SPIKE-3 is not written.
2. **The idle cost of a held device is unknown and is not zero by construction** — a render callback
   fires continuously. `spike1-resident-synth.md` 3.1 excludes it explicitly. If it is material on
   battery, `IDLE_RELEASE_MS` becomes a much more important number than this document treats it as.
3. **Two of three platforms are unmeasured**, and one of them (Linux) cannot measure the same
   quantity even in principle.
4. **Resume-from-word-boundary after a device change is specified here and has never been built.**
   Word-boundary events are measured; using them as a resume cursor across a device rebuild is not.

---

## 9. Collateral: `docs/TASKS.md` line drift, and the citations it stales

Rewriting Phase M9 in place lengthened `docs/TASKS.md` from 428 to 481 lines. **Every citation into
`docs/TASKS.md` at a line ≥ 219 is now short by exactly 53.** Recorded here rather than left for
`pnpm check:citations` to surprise someone, because a reader who follows a stale pointer cannot tell
it from a fabricated one (P0, and the reason `check-citations.mjs` exists).

| Citing file | Cited as | Should now read | What it points at |
|---|---|---|---|
| `docs/design/011-settings.md:328` | `docs/TASKS.md:302-303` | **`:355-356`** | T124, the `NormalizeOptions` reachability test |
| `docs/design/004-voice-lab.md:5` · `docs/.research/q-round1-codebase.md:146` · `docs/.research/latency-measurements.md:483` | `docs/TASKS.md:292` | **`:345`** | Gate M11, the two-second change-to-hear gate |
| `docs/design/014-review-round7.md:755` and `:866` | `docs/TASKS.md:412` | **`:465`** | Phase M17 |

**These were not fixed here**, because the M9 rescope was scoped to `015`, `TASKS.md`, `STATE.md` and
`HANDOFF.md` while six other agents were editing the rest of `docs/design/`. They are one-token edits
and should be applied by whoever next touches each file.

**Separately — and this is not drift but supersession:** every citation into the *old* M9 block
(`docs/TASKS.md:202-217`, `:202`, `:207-210`, `:211`, `:214`, `:217`, appearing in `010` five times,
`014-review-round7.md` five times and `q-round1-codebase.md` once) now points at a phase whose
content this document replaced. Those need re-reading, not re-numbering — in particular
**`010:579` and `014:64` cite the old Gate M9 (*"T097 reports measured first-audio under 500 ms on
each OS"*), which no longer exists**; the gate is section 6 above, it is not a CI gate, and it has a
falsifier.
