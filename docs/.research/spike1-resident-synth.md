# SPIKE-1 — first-buffer latency of a resident OS synthesizer

**Verdict, in one sentence:** on macOS the warm first-buffer latency of
`AVSpeechSynthesizer.write(_:toBufferCallback:)` is **p50 17.7 / 17.1 ms, n=20 per run over two
runs `[measured-here]`** — **8.5× inside** the 150 ms pass condition of
`docs/design/010-provider-seam-and-resident-service.md` section 8.2, and **20× below** its 350 ms
falsifier — so **residency alone buys the R4.2 budget on the synthesis side of macOS, and the
neural engine is not on the critical path for latency.**

**Status:** research. **Written:** 2026-08-21. **Repo at:** `83f0a5d`.
**Scope:** macOS is measured. **Windows and Linux are NOT measured** — their probes are committed and
runnable, and every number attributed to them in this document is `[claimed]`. See sections 4 and 5.

**Machine.** Apple M5, 10 cores, macOS 26.5 (build 25F71), Swift 6.3.3, Node v26.7.0. Otherwise idle.

**Probe.** `scripts/spikes/spike1-macos-firstbuffer.swift`, compiled with `swiftc -O`.
Reproduce:

```
swiftc -O scripts/spikes/spike1-macos-firstbuffer.swift -o /tmp/spike1 && /tmp/spike1 --n 20 --idle 30 --json
```

**Silence.** Every macOS figure below was taken **without opening an audio device and without
spawning a process.** `write(_:toBufferCallback:)` renders to PCM buffers in-process by
construction. The probe contains no `speakUtterance`, no `afplay`, no player of any kind, and the
source says why (PITFALLS **P31**). Nothing in this measurement pass made a sound.

**Label vocabulary** (constitution R006): `[measured-here]` — a probe in `scripts/spikes/` run on
the machine named above, with a run count. `[derived]` — arithmetic over `[measured-here]` values,
stated as arithmetic. `[claimed]` — nobody has run it.

---

## 0. The answer, against the pass condition

| | |
|---|---|
| Pass condition (010 section 8.2) | median warm first-buffer **≤ 150 ms** |
| Falsifier (010 section 8.2) | median **> 350 ms** on any platform |
| **macOS, measured** | **p50 17.7 ms (run 1) / 17.1 ms (run 2)**, n=20 each `[measured-here]` |
| **macOS verdict** | **PASS**, by a factor of 8.5 |
| Windows | `[claimed]` — probe written, never executed. No Windows machine here |
| Linux | `[claimed]` — probe written, never executed. And it cannot measure the same quantity; section 5 |

**What would have proved this wrong, and did not.** A median above 350 ms. The observed maximum
across all 40 warm samples is **21.6 ms**. The falsifier is not merely unmet; it is off by an order
of magnitude. The check could have failed and it is worth saying how we know: the **same probe, same
process, same code path** reads **307–345 ms** on the first utterance (section 2). The instrument
moves. A permanently-fast reading would be a broken indicator; this one is not.

**What this settles, and what it does not.**

- **Settles:** the synthesis half of R4.2 on macOS. Text in → first PCM buffer in hand is ~18 ms.
- **Does not settle:** the device half. Getting that buffer to the listener's ear still costs the
  ~893 ms CoreAudio device open (`latency-measurements.md` 1.1, PITFALLS **P32**) **unless the
  resident service holds the device open**. SPIKE-1 does not measure a device and cannot: there is
  no silent way to (`latency-measurements.md` 1.0). **M9's latency gate remains a device question.**
  What changed is that it is *only* a device question.

---

## 1. Warm first-buffer — the headline

Warm means: the process has already completed one synthesis. Each sample is one call to
`write(_:toBufferCallback:)`; `t0` is taken immediately before the call, `t1` at the first callback
invocation carrying a non-empty `AVAudioPCMBuffer`.

| | min | p50 | p95 | max | n | label |
|---|---|---|---|---|---|---|
| **first non-empty buffer, run 1** | 15.9 | **17.7** | 20.2 | 21.6 | 20 | `[measured-here]` |
| **first non-empty buffer, run 2** | 13.7 | **17.1** | 17.8 | 17.9 | 20 | `[measured-here]` |
| first **audible** sample, run 1 | 15.9 | **17.7** | 20.2 | 21.6 | 20 | `[measured-here]` |
| first **audible** sample, run 2 | 13.7 | **17.1** | 17.8 | 17.9 | 20 | `[measured-here]` |

### 1.1 Why there are two rows, and why they are identical

A non-empty buffer of **silence** would make the headline optimistic — the API could deliver a
lead-in of zeros and the timer would stop before any speech existed. So the probe measures both:
time to the first non-empty buffer, and time to the first buffer containing a sample above a
0.001 silence floor. They are **the same instant in all 40 samples**; the first buffer's peak
amplitude ranged 0.0031–0.1067 and never fell below the floor. AVFoundation does not pad the head
of the stream. The conservative quantity is the headline quantity, and the probe gates its verdict
on the conservative one regardless.

### 1.2 Raw data

```
run 1  17.0 17.6 17.7 21.6 18.0 16.8 19.2 17.8 15.9 17.0 18.4 17.7 18.1 17.6 17.9 17.6 17.5 20.1 17.7 17.5
run 2  17.9 17.1 17.8 17.4 16.6 17.4 17.1 17.8 13.7 16.6 16.5 16.7 17.3 16.8 17.5 17.2 17.1 16.8 17.2 16.5
```

Twenty realistic sentences, drawn from a real agent reply (the corpus is inline in the probe source,
so the length distribution is auditable rather than asserted). Sentences ranged 10–17 words;
rendered audio ranged roughly 2.6–4.2 s. **First-buffer latency does not track sentence length** —
the spread is 13.7–21.6 ms across the whole corpus, which is what "streaming" means and is the
property design 010 was hoping for.

### 1.3 The whole utterance, for context

| | run 1 | run 2 |
|---|---|---|
| `write()` → terminating empty buffer, p50 | **38.8 ms** | **37.6 ms** |
| same, min / max | 36.2 / 43.2 | 34.6 / 39.6 |
| audio rendered per call | ~2.6–4.2 s at 22,050 Hz mono | same |
| **render speed relative to real time** `[derived]` | **97×–128×** | — |

Read as: the engine renders a four-second sentence in under forty milliseconds, warm. **The entire
utterance completes in less than a tenth of the 500 ms budget.** Word-boundary callbacks arrived on
**40 of 40** utterances (10–17 ranges each), confirming F2's headless finding under load rather than
once.

### 1.4 This contradicts design 010's `[derived]` split of the `say` cost, and the contradiction matters

010 (F4, section 8, row 4) derives *"roughly 640–750 ms `[derived]` is synthesis"* by subtracting
P10's 414 ms spawn floor from the 1,054–1,163 ms measured `OsSynthProvider.generate()`. That
subtraction assumes the remainder is **synthesis compute**.

Measured here, the compact `en-US` engine renders the same class of sentence in **38 ms warm** and
**~330 ms on the first call in a fresh process**. So the remainder in `say` is not compute. It is
**per-process engine and voice initialisation, plus writing and closing a WAV file** — the cost
`say` pays once per utterance *because it is a new process every time*, and the exact cost residency
deletes.

**Consequences, stated carefully:**

1. `say` and `AVSpeechSynthesizer` are different code paths and this probe measured the second. The
   claim here is **not** "010's 1,054–1,163 ms is wrong" — that figure is measured and stands. The
   claim is that **its attribution to synthesis is unsupported**, and the same class of
   mis-attribution P32 already caught once in this repo (device blamed on spawn).
2. 010 section 8.2's withdrawn recommendation — *"residency is necessary and not sufficient…
   R4.2 is unreachable on the OS-synth rung by any amount of residency"* — **rested on that
   attribution and is now itself falsified.** Residency is sufficient on the synthesis side.
3. The suggestive arithmetic: cold in-process first-buffer **~330 ms** `[measured-here]` against
   `say ""`'s **414 ms** spawn floor `[measured-here]`, P10. Two independent probes of "what it
   costs to stand this engine up once" land within 25 % of each other. That is consistent with
   engine init being the dominant term, and is offered as consistency, not as proof.

---

## 2. Cold versus warm — exactly what residency buys

Cold is the **first** `write()` call in a freshly-started process. One sample per process, so eight
processes were run. It is never averaged into the warm arm.

| | min | p50 | max | n | label |
|---|---|---|---|---|---|
| **cold first-buffer** | **307.4** | **328.2** | **344.6** | 8 fresh processes | `[measured-here]` |
| warm first-buffer (both runs pooled) | 13.7 | 17.4 | 21.6 | 40 | `[measured-here]` |
| **cold-start penalty** | — | **~311 ms** `[derived]` | — | — | 328.2 − 17.4 |

Raw cold samples: `340.4 335.5 340.4 307.4 344.6 320.9 308.9 310.7`

**Read as: residency is worth ~311 ms per utterance, and that is the whole of its synthesis-side
value.** A cold utterance at ~330 ms is already inside the 350 ms falsifier and would fail the
150 ms pass condition on its own. **A service that is restarted per utterance is not a resident
service and does not pass.** Design 010 section 11.1 already chooses lazy start on first
`prepare()` with the subprocess provider as the bridge; this number is what that decision costs the
listener exactly once per ORCA session, and is small enough to accept.

Process footprint before any synthesis is **~5.1 MB**; the first synthesis adds **~4.2–4.5 MB**
(n=8) — the voice being loaded. That delta is the thing residency holds.

---

## 3. SSML — free

Design 010 extension 6 wants SSML in the seam because it is the only route to pitch on Windows.
The macOS route is `AVSpeechUtterance(ssmlRepresentation:)`, which is a **different constructor and
a parse step**, so its cost had to be known before the seam depends on it.

| | min | p50 | p95 | max | n | label |
|---|---|---|---|---|---|---|
| SSML first-buffer, run 1 | 16.7 | **17.4** | 18.1 | 18.3 | 20 | `[measured-here]` |
| SSML first-buffer, run 2 | 16.4 | **17.5** | 18.3 | 18.3 | 20 | `[measured-here]` |
| **SSML minus plain, p50** | — | **−0.3 ms / +0.4 ms** `[derived]` | — | — | — | — |

`AVSpeechUtterance(ssmlRepresentation:)` returned non-nil on every call, and word-boundary callbacks
were **identical in count** to the plain arm on every sentence (`[15,14,16,14,13,15,12,16,14,10,15,
14,17,14,14,15,17,12,15,13]` in both arms). The delta is smaller than the run-to-run spread of the
plain arm, i.e. **below this probe's resolution**.

**Read as: SSML costs nothing measurable on macOS.** The seam can require it without a latency
argument against it. The `<speak>` wrapper used here carries no prosody tags deliberately, so the
arm isolates the parse path rather than measuring a different utterance; a heavily-marked-up SSML
document is **not** covered by this number and remains `[claimed]`.

---

## 3.1 Idle cost — cross-review finding B-03, closed for macOS

B-03 found no idle figure anywhere in this project. Here it is: a process that has completed 41
syntheses and is now waiting, sampled over a 30-second idle window, two runs.

| | value | label |
|---|---|---|
| **CPU while idle** | **0.015 s of CPU over 30.1 s wall = 0.05 %** (both runs) | `[measured-here]` |
| **memory, in-process `phys_footprint`** | **9.4 MB** (both runs) | `[measured-here]` |
| memory, external `ps -o rss` | **35–38 MB** at 20 s and 32 s | `[measured-here]` |
| external `ps -o %cpu` | **0.0** at both samples | `[measured-here]` |
| RSS drift across the idle window | −82 KB / −66 KB — no growth | `[measured-here]` |

**The two memory numbers are different quantities and both are reported on purpose.**
`phys_footprint` is the memory the process is charged for; `ps` RSS counts mapped shared framework
pages that AVFoundation brings in and that other processes on the machine already have resident.
The honest statement for a sizing decision is: **9.4 MB of private footprint, appearing as ~36 MB
of RSS to an observer with `ps`.** Quoting only the smaller number would be the same failure this
repo has caught twice.

**What this does not include.** The measured process holds the **synthesizer** only. A shipped M9
service must also hold the **audio device** open (P32) — an `AVAudioEngine` or output unit with a
live render callback — and that is not in this figure. Its idle CPU is not zero by construction: a
render callback fires continuously. **That cost is `[claimed]` and is the obvious next probe.**

---

## 4. Windows — probe committed, number unmeasured

**`scripts/spikes/spike1-windows-firstbuffer.ps1`**

```
powershell -ExecutionPolicy Bypass -File scripts\spikes\spike1-windows-firstbuffer.ps1
```

**Every Windows number in this project's design documents remains `[claimed]`. This probe has never
been executed — there is no Windows machine here, and `pwsh` is not installed on this one, so it
has not even been parse-checked.** Say so wherever it is cited.

What it measures: a `Stream` subclass (`FirstWriteProbeStream`) is handed to
`SetOutputToAudioStream(Stream, SpeechAudioFormatInfo)` and timestamps the first `Write` with
`count > 0`. The synthesizer pushes into a stream we own, so that write **is** the same observable
event the macOS callback delivers. 010 section 8.2 phrases it as "first `Read`"; the boundary is
write-side from the synthesizer's view and this is it.

It runs the same three arms and the same corpus as the macOS probe — cold, warm ×20, SSML ×20 via
`SpeakSsml` — plus the idle sample, and prints the same `SPIKE1_*` keys so the two outputs can be
placed side by side without translation.

**It is silent by construction and must stay that way.** `SetOutputToAudioStream` never opens an
audio device. The source carries the instruction not to add `SetOutputToDefaultAudioDevice`.

**Caveat the reader must carry (010 section 9, residual U2, unrun):** whether this binds a OneCore
voice or only a SAPI 5 `*Desktop` voice depends on .NET Framework versus .NET 10. The probe prints
`SPIKE1_RUNTIME`, `SPIKE1_VOICE` and the full installed-voice list, so the number can be attributed
to a tier instead of to "Windows".

**Expected shape, and it is a guess:** `[claimed]`. The one thing that can be said without running
it is structural — 010 section 9 notes that keeping one PowerShell host alive amortizes the
`Add-Type -AssemblyName System.Speech` cost currently paid per utterance, the cost that forced
`DEFAULT_SPAWN_TIMEOUT_MS = 60_000` (`os-synth/index.ts:38`). That is the same cold/warm split
measured at ~311 ms on macOS. **Whether the warm number lands under 150 ms is unknown and must not
be assumed from the macOS result.**

---

## 5. Linux — probe committed, unmeasured, and it measures a different quantity

**`scripts/spikes/spike1-linux-firstindex.mjs`**

```
node scripts/spikes/spike1-linux-firstindex.mjs --audible
```

**Never executed. `[claimed]`.** Running it here is impossible (no Linux, no speech-dispatcher), and
it would be audible even where it is possible.

**Read this before reading any number it eventually produces.** It does **not** measure what the
macOS arm measures, and it never can. SSIP's verb list is
`set/history/stop/cancel/pause/resume/sound_icon/char/key/list/get/help/block/speak/quit`
(`speechd` `src/server/parse.c:98-110`) — no audio-retrieval verb; `SET` has no audio-output
parameter; and `src/audio/libao.c:75` calls `ao_open_live()`, so no file driver can be opened.
Design 010 section 9's conclusion holds: **the Linux resident service is a `spoke-elsewhere`
provider with pause/resume and index marks, and no bytes, permanently.**

So the probe times `t0` at the end of the `SPEAK` block against the first event the daemon returns:
`701 BEGIN`, and in the SSML arm the first `700 INDEX MARK`. That is **"the daemon told us it
started"**, not "a sample reached the listener" and not "we hold audio". It is the best-defined
boundary that exists on the platform, and the honest reading of whatever it reports is: *this is the
floor on how fast a Linux resident service can know speech began.* The probe prints that caveat in
its own output so it cannot be pasted into a document without it.

**The probe refuses to run without `--audible`** and prints the reason — speech-dispatcher speaks
through the daemon's own output and there is no silent form. That is P31 applied to a platform where
the constraint is structural rather than incidental. On a CI runner with no audio device at all
(P16) the daemon may fail to open output; the probe reports NOT-RUN with the reason rather than a
number.

**The Linux number that would actually answer R4.2 cannot be taken through speech-dispatcher at
all.** It needs the `espeak-ng` **library** path (010 section 9), which is a different rung, a
different probe, and is not written.

---

## 6. What M9's scope should now be

010 section 10 proposed splitting M9 into **M9a — resident service with the OS synthesizer**
(gated on SPIKE-1) and **M9b — Piper as an engine inside it** (gated on quality). It added: *"If
SPIKE-1 comes back above 350 ms, the two merge back into today's M9."*

**SPIKE-1 came back at 17.7 ms on macOS. The split holds, and on stronger ground than 010 expected.**

| | before SPIKE-1 | after |
|---|---|---|
| macOS synthesis on the hot path | `[claimed]` 100–400 ms, "plausibly the blocker" | **17.7 ms `[measured-here]`** — not the blocker |
| The reason to build a resident service | contested — 010 withdrew its own recommendation | **the audio device (P32), and only the device** |
| Piper's role in M9 | latency-critical; M9 could not pass without it | **a quality decision** (010 section 10's table), not a latency one |
| Cost of restarting the service | unknown | **~311 ms per cold utterance `[derived]`** — the price of lazy start, paid once |
| SSML in the seam (extension 6) | unknown cost | **free on macOS `[measured-here]`** |
| Idle cost of residency | unknown anywhere (B-03) | **0.05 % CPU, 9.4 MB private `[measured-here]`** — synthesizer only |

**Concretely, M9a's success condition should be written as a device condition, not an engine one:**
*the audio device stays open across chunks*, tested by a gap-to-audio ratio (010's amendment 1,
P32). Nothing in M9a needs a model download, a model manager, a first-run bridge, or P8's non-ASCII
Windows path — those are all M9b.

**The three things still standing between this result and a passing R4.2 on macOS,** none of which
SPIKE-1 touched, all `[claimed]`:

1. **The device open, held.** ~893 ms today, per chunk. Recovering it is the whole of M9's latency
   value and is unmeasured in a *held-open* configuration because measuring it is audible
   (`latency-measurements.md` 1.0). The rig is named there; the CoreAudio render-callback probe is
   the one that also settles design 003's 50 ms drain segment.
2. **The idle cost of holding the device**, which section 3.1 explicitly excludes.
3. **Windows and Linux.** R1 says the three ship together. macOS passing says nothing about the
   other two, and the honest position is that **two of the three platforms in this spike are
   `[claimed]`**. The probes exist; running them is one command on the right machine.

**What would still overturn the M9a/M9b split:** the Windows warm probe landing above 350 ms, which
would put a neural engine back on Windows' critical path even though it is off macOS's. That is a
live possibility and this document does not pre-judge it.
