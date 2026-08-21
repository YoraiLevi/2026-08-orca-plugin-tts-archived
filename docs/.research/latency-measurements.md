# Latency measurements — the numbers this project decides on, measured

**Written:** 2026-08-21. **Author:** measurement pass for round-3 findings E-03, E-04, E-05, C-01.
**Reproduce:** `pnpm bench:latency` — **silent by default.** Add `--audible` to re-run the
device-side probes, which play sound; add `--json` for the raw arrays. Source:
`scripts/bench-latency.mjs`. Not a CI gate, deliberately — see "Why this is not a gate".

> **Do not run `--audible` on a machine anyone is listening to.** The device-side figures in this
> document were taken that way and it interrupted the author mid-session. That is section 1.0, and
> it is a finding, not an apology.

**Machine.** Apple M5, 10 cores, macOS 26.5, Node v26.7.0, repo at `bea3acf`. Two full runs,
2026-08-21, roughly ten minutes apart, on an otherwise idle machine with the built-in speaker as the
default output device. Both runs are reported; where they disagree, both numbers are given.

**Label vocabulary** (constitution R006): `[measured-here]` — a probe in `bench-latency.mjs` run on
this machine, with a run count. `[derived]` — arithmetic over `[measured-here]` values, stated as
arithmetic. `[claimed]` — nobody has run it.

---

## 1. Contradictions, first, because they are the point

**The five findings, in one place:**

| | |
|---|---|
| The ~970 ms inter-chunk gap | **Confirmed.** p50 950 / 937 ms, n=18 per run. And it was never fabricated — it is a third-party number whose label was dropped in transit and then re-invented as a stronger one (3.2) |
| The mechanism everyone attributes it to | **Wrong.** Process spawn is 2.3 ms of the 950. It is the audio device open/close (1.1) |
| STATE.md's 927 ms first audio | **Unsupported, and unreproducible.** Measured 1,112 ms lower bound / 2,017 ms upper. The script it came from does not run today (1.2, 3.3) |
| R4.2 (<500 ms) on the OS synth | **Unreachable by any playback fix.** Synthesis alone is 1,054–1,163 ms (1.3) |
| The nine "cancel measured at 50 ms" claims | **A check that could not have failed** — the assertion is `<= 1000 ms` (3.4) |
| Measuring any of the device-side numbers | **Interrupts the person using the machine, and there is no silent substitute.** Design 003's Stop budget is defined in exactly the terms we cannot measure (1.0) |

### 1.0 The measurement is audible, and that is a finding in its own right

The device-side probes in this document were obtained by spawning the real player against the real
default output device. On the author's working machine that produced audible tones and sentences over
the channel the author actually uses to know what their tools are doing. For a voice-first, dyslexic
operator that is not a cosmetic nuisance; it is the product's own channel being taken over by the
tooling that measures the product.

The constraint is permanent, not a one-off mistake in method:

- **macOS `afplay` has no device-selection flag.** There is no `-d`, no `AUDIODEV`, nothing. It
  plays to the default output device or not at all.
- **A stock macOS system ships no null or loopback sink.** BlackHole, Loopback and
  `SwitchAudioSource` are all installs, and installing an audio device to make a benchmark runnable
  is out of scope — it would also change what is being measured.
- **Therefore, on this machine, device-side latency cannot be measured without interrupting the
  person using it.** Not "is inconvenient to measure" — cannot.

`bench-latency.mjs` now defaults to silent and declares the gap rather than hiding it:

```
  interchunk.gap   NOT-RUN — audible probe — opens the default output device. Re-run with
                   `--audible` on a machine nobody is listening to. Silent mode cannot
                   substitute: afplay has no device-selection flag and a stock macOS system
                   has no null sink.
```

Five probes still run silently, because `say -o <file>` and `espeak-ng -w <file>` write a WAV and
never open the device, and `afplay` on a missing file exits before reaching CoreAudio: `spawn.floor`,
`synth.say`, `listVoices`, `tempfile.roundtrip`, `player.no-device`. Those five carry sections 1.2,
1.3, 1.6 and the whole of 1.1's decomposition, so the most consequential finding in this document —
that the gap is device open, not process spawn — is reproducible silently on any machine.

**What this costs the project, concretely.** Design 003's Stop budget is defined as *"from the input
event to the last audio sample leaving the device"*. Its 50 ms drain segment is precisely the part
that lives past the last silently-measurable boundary. So the one number 003 most needs is the one
number this repo is now structurally unable to take on the author's own machine, and the honest label
for it stays `[claimed]` until somebody builds a rig.

**The rig that would settle it,** in increasing order of cost and fidelity:

| Rig | Measures | Cost | Caveat |
|---|---|---|---|
| A second machine, headphones unplugged, run `--audible` | everything in this document, repeatably | one spare Mac | still the default device; just nobody is listening |
| A virtual loopback device (BlackHole 2ch) plus a recorder capturing the loopback while the probe runs | **true first-sample-out and true cancel-to-silence** — the two numbers we cannot get at all today | one kext-free install, and a rig script that correlates the recording's first non-zero sample against the probe's `t0` | changes the output device, so the device-open constant is BlackHole's, not the built-in speaker's; measure both and report the pair |
| A CoreAudio-level probe (an `AudioUnit` render callback timestamping its first non-silent buffer) | first sample out with sample accuracy, no capture path needed | a small Swift binary, in the same family as the compiled probe already in `docs/.research/q-round1-platform.md` | Swift toolchain; macOS only, so it settles macOS and says nothing about R1 parity |
| An external loopback: line-out to line-in on an interface, recorded | ground truth including DAC latency | audio hardware | the only rig that measures what the listener's ear actually receives |

Recommendation: **the second machine for routine re-runs, and the CoreAudio probe once, to convert
003's 50 ms drain segment from `[claimed]` to a measurement.** The loopback rigs are the only way to
get true cancel-to-silence, and that number is worth one afternoon because it is the entire premise
of the Stop budget.

Until then the device-side figures below stand as a **characterized constant with a recorded rig**,
in exactly the sense the constitution's R006 allows: they were measured, once, on a named machine, on
a named date, and reproducing them is expensive. They are not a reading anyone should expect to take
casually.

### 1.1 The ~970 ms is real — and the reason given for it everywhere in this repo is wrong

The headline: **the inter-chunk gap measures p50 950 ms / p95 990 ms (run 1, n=18) and p50 937 ms /
p95 999 ms (run 2, n=18)** through the real `SubprocessSink` with real `say` output. A third
confirmation run after the script's final edit gave p50 897 ms / p95 1,021 ms (n=18), so the p50
across three runs spans 897–950 ms. The figure the repo has been quoting without a probe —
`~970 ms` — sits inside that spread and is accurate to within about 8 % of the worst run and 2 % of
the best.

That is the good news, and it is worth saying plainly: design 004's choice of browser-side playback
and M9's resident-service plan do **not** rest on a bad number. They rest on a right number that
nobody had earned — and, as section 3.2 shows, one that came from someone else's changelog and
arrived here stripped of the label that said so.

The bad news is the mechanism. `packages/plugin/src/sinks/subprocess-sink.ts:8-10` explains the gap
as *"one process per chunk"*, and HANDOFF and design 004 repeat that framing. Measured:

| What | p50 | Share of the 950 ms gap |
|---|---|---|
| `afplay` process start to exit, **audio device never opened** (spawned on a missing file) | **2.3 ms** (run 1, n=12) / 2.9 ms (run 2) | **0.25 %** |
| `mkdtemp` + `writeFile(56 kB)` + `rm` — the sink's whole temp-file round trip | **0.33 ms** (n=20) | **0.03 %** |
| everything else — CoreAudio device open, pre-roll, post-roll, teardown | **~893 ms** `[derived]` | **~99.7 %** |

**Read as:** the gap is not process spawn and it is not the temp file. It is opening and closing the
audio device. Three consequences the repo's current framing does not support:

1. A fix that pools or pre-warms *player processes* while still opening the device per chunk saves
   **2 ms of 950**. If M9 is scoped as "don't spawn a process per chunk" it will deliver nothing.
   M9 is correct only if it holds the **audio device** open across chunks.
2. P29's temptation to drop the temp file with `--stdout` was already rejected for correctness
   reasons. It should also be rejected as a *performance* change: the round trip it removes is
   0.03 % of the cost. There is no latency argument for it in either direction.
3. Any future sink on any platform inherits this: the question to ask a candidate player is "does it
   hold the device open between buffers", not "how fast does it start".

### 1.2 R4.2 is missed by 2.2× at best and 4.0× at worst, not by the 1.85× on record

`STATE.md:23` records *"First audio < 500 ms — ❌ **927 ms** on the OS synth."* No probe in the
repository produces 927 ms. Section 3.3 traces it to an unrecorded single run of
`scripts/speak-e2e.mjs`, which measures neither end of the budget and **does not execute today**.
Measured, end to end from the call to the player process existing:

| | run 1 (n=10) | run 2 (n=10) |
|---|---|---|
| **first audio, lower bound** — synthesis + temp file + spawn | p50 **1,112 ms**, p95 1,227 ms | p50 **1,082 ms**, p95 1,146 ms |
| **first audio, upper bound** — the above plus the player's entire fixed overhead | p50 **2,017 ms**, p95 2,132 ms | p50 **1,997 ms**, p95 2,061 ms |

The true value lies between: nothing in userland can observe the instant the first sample leaves the
DAC without a loopback capture device or a CoreAudio-level probe, so the bracket is honest and the
midpoint is not claimed. **Even the lower bound is 2.2× the 500 ms budget**, and STATE.md's 927 ms
sits below the measured lower bound of every one of the twenty samples (minimum observed: 922 ms in
run 1, 936 ms in run 2).

### 1.3 R4.2 cannot be met on the OS synth by any playback change at all

`OsSynthProvider.generate()` — text in, WAV buffer in hand, before a single sample is played —
measures **p50 1,163 ms** (run 1, n=9) and **p50 1,054 ms** (run 2, n=9), minimum observed 900 ms.

That is already **2.1× the entire R4.2 budget** with playback cost set to zero. So:

- M9 is **necessary but not sufficient** for R4.2. Fixing the sink cannot get first audio under
  500 ms while the OS synth is the source.
- R4.2's own wording is *"on the default local backend"*, and the default is Piper, measured at
  52–65 ms per sentence (P11). The budget is plausibly reachable there and is **not** reachable on
  the fallback. STATE.md's row reads as though the 500 ms target applies to the OS synth path; it
  should say which backend it is scoring.

### 1.4 The earcon costs 6.2× what design 005 states (finding E-04, confirmed)

Design 005 section 11.1 costs a two-note identity earcon at 60 + 20 + 60 = **140 ms**, and section 13's options D
and E carry that number as the whole cost. Prepending exactly that buffer as its own `AudioChunk`
through the shipped sink measures **p50 874 ms** (run 1, n=10) and **p50 862 ms** (run 2, n=10) of
wall clock, inserted **before the first word**.

E-04 predicted this and estimated it at "140 ms plus ~970 ms of spawn". The measured figure is lower
than that sum (~870, not ~1,110) because the tone is short and part of the device-open cost overlaps
playback, but the finding stands: **the earcon is a ~870 ms tax on the first word, not a 140 ms one.**
On the guaranteed floor 005 designs for (N = 1 voice, everyone in overflow), that tax is mandatory
per turn.

A detail worth keeping: 2 of 10 samples in run 1 and 3 of 10 in run 2 came in at **~370 ms** instead
of ~870 ms. The fast path appears only when a previous `afplay` exited moments earlier, i.e. when the
device is still warm. It is not controllable from our side today, but it is direct evidence that a
warm device is where the ~500 ms of headroom lives.

### 1.5 `cancel()` — the measured number is real, and it is not the number design 003 needs

PITFALLS P9 records `ffplay.kill()` at 1.5 ms. Measured on the player we actually ship on macOS,
`afplay`, killed 400 ms into a 3-second tone: **p50 3.5 ms / p95 8.8 ms / max 8.8 ms** (run 1, n=10)
and **p50 2.9 ms / p95 7.3 ms** (run 2, n=10). Same order of magnitude, slightly worse, still
negligible.

But this measures **the process dying**, not audio stopping. Whatever CoreAudio has already accepted
into its buffer is not observable from userland and is not included. Design 003's Stop budget
allocates **50 ms to "audio device drain"** and cites the 1.5 ms kill as its basis; that citation
supports a different quantity. The honest statement, which E-03 asked for, is: *kill-to-exit is
~3 ms on the shipped macOS player; drain is unmeasured and needs a loopback capture or a CoreAudio
probe to measure at all.*

### 1.6 `listVoices()` is worse than P28 records

P28 says `say -v '?'` costs *"~450 ms, which is the entire first-audio budget"*. Through the real
provider: **p50 487 ms / p95 591 ms** (run 1, n=6) and **p50 472 ms / p95 547 ms** (run 2, n=6). The
conclusion is unchanged and slightly strengthened. The cache P28 demands is not optional.

Note the shape of the bug this creates: `OsSynthProvider.prepare()` calls `listVoices()` on
darwin/win32 (`packages/providers/src/os-synth/index.ts:230-233`). A cold `prepare()` therefore adds
~480 ms in front of the ~1,100 ms first-audio path unless it is warmed off the critical path.

---

## 2. The measurements

### 2.1 Summary table

All figures milliseconds. `n` is per run; two independent runs are shown as `run1 / run2`.

| Probe | What it measures | p50 | p95 | max | min | Label |
|---|---|---|---|---|---|---|
| `spawn.floor` | `say -o <file> ""` — spawn, zero synthesis; silent form of P10 (n=12) | 428 / 412 | 557 / 435 | 557 / 435 | 411 / 405 | `[measured-here]` |
| `synth.say` | `OsSynthProvider.generate()`, one sentence to a WAV buffer (n=9) | 1,163 / 1,054 | 1,244 / 1,084 | 1,244 / 1,084 | 974 / 900 | `[measured-here]` |
| `listVoices` | `provider.listVoices()`, uncached (n=6) | 487 / 472 | 591 / 547 | 591 / 547 | 405 / 418 | `[measured-here]` |
| `tempfile.roundtrip` | `mkdtemp` + `writeFile(56 kB)` + `rm` (n=20) | 0.33 / 0.42 | 0.41 / 0.79 | 0.64 / 1.0 | 0.30 / 0.30 | `[measured-here]` |
| `player.no-device` | `afplay` on a missing file — fork/exec/dyld only (n=12) | 2.3 / 2.9 | 3.0 / 4.7 | 3.0 / 4.7 | 2.2 / 2.4 | `[measured-here]` |
| `player.fixed-overhead` | `afplay` lifetime minus audio duration (n=16) | 895 / 891 | 936 / 975 | 936 / 975 | 870 / 386 | `[measured-here]` |
| `sink.chunk-overhead` | `SubprocessSink.enqueue()` minus the chunk's audio duration, synthetic tones (n=12) | 903 / 890 | 948 / 957 | 948 / 957 | 881 / 364 | `[measured-here]` |
| **`interchunk.gap`** | **the same, with real `say` sentences, back to back (n=18)** | **950 / 937** | **990 / 999** | **990 / 999** | 464 / 828 | `[measured-here]` |
| `firstaudio.lower` | call → player process exists (n=10) | 1,112 / 1,082 | 1,227 / 1,146 | 1,227 / 1,146 | 922 / 936 | `[measured-here]` |
| `firstaudio.upper` | the above + the player's whole fixed overhead (n=10) | 2,017 / 1,997 | 2,132 / 2,061 | 2,132 / 2,061 | 1,828 / 1,851 | `[derived]` |
| `cancel.kill-to-exit` | SIGKILL → player process exit, mid-playback (n=10) | 3.5 / 2.9 | 8.8 / 7.3 | 8.8 / 7.3 | 0.9 / 1.0 | `[measured-here]` |
| `earcon.added-cost` | 140 ms two-note earcon as its own chunk through the real sink (n=10) | 874 / 862 | 903 / 886 | 903 / 886 | 384 / 358 | `[measured-here]` |

**Which of these are silent.** `spawn.floor`, `synth.say`, `listVoices`, `tempfile.roundtrip` and
`player.no-device` run in the default silent mode and can be re-taken at any time. The other seven
require `--audible` and were taken once, on the machine named at the top of this document, on
2026-08-21. Section 1.0 explains why that asymmetry exists and what rig would remove it.

**One label correction.** P10 measured bare `say ""`, which opens the audio device even though it
emits nothing. The silent probe uses `say -o <file> ""`, which routes to a file writer instead.
Measured side by side on 2026-08-21 the two agree — 0.42 s for the `-o` form against P10's
0.414/0.418 s — but they are not the same command and the table says which one ran.

### 2.2 How the inter-chunk gap is defined and why this definition is the listener's

`SubprocessSink.enqueue()` is strictly sequential: chunk N+1's `mkdtemp` cannot begin until chunk N's
player process has closed (`subprocess-sink.ts:52-88`, `#play` resolves on `child.on('close')`).
So the silence a listener hears between sentence N and sentence N+1 is exactly

```
gap = (wall time of enqueue(chunk)) − (audio duration of chunk, read from its own WAV header)
```

summed across the boundary. Audio duration is taken from the file's own `fmt ` chunk, not assumed —
macOS `say -o x.wav` writes a `JUNK` alignment chunk *before* `fmt `, so reading the sample rate at
the conventional byte offset 24 returns 0. The first version of this probe did exactly that and
silently produced zero samples; the fix is in `bench-latency.mjs`'s `wavDurationMs`, with the reason
in a comment, because it is the same class of quiet miscount this document exists to catch.

### 2.3 Raw data — `interchunk.gap`, run 1

Three real sentences, six rounds, 18 samples. `audioMs` is from the WAV header; `wallMs` is
`enqueue()`; `gapMs` is the difference.

| sentence bytes | audioMs | wallMs | gapMs |
|---|---|---|---|
| 56,310 | 1,184 | 2,158.0 | **974.1** |
| 124,048 | 2,720 | 3,680.6 | **960.6** |
| 117,698 | 2,576 | 3,426.2 | **850.2** |
| 56,310 | 1,184 | 2,159.3 | **975.3** |
| 124,048 | 2,720 | 3,709.9 | **989.9** |
| 117,698 | 2,576 | 3,428.0 | **852.0** |
| 56,310 | 1,184 | 2,149.9 | **965.9** |
| 124,048 | 2,720 | 3,674.8 | **954.8** |
| 117,698 | 2,576 | 3,424.2 | **848.2** |
| 56,310 | 1,184 | 1,648.0 | **464.0** ← warm-device fast path |
| 124,048 | 2,720 | 3,670.3 | **950.3** |
| 117,698 | 2,576 | 3,426.0 | **850.0** |
| 56,310 | 1,184 | 2,154.9 | **970.9** |
| 124,048 | 2,720 | 3,670.6 | **950.6** |
| 117,698 | 2,576 | 3,416.3 | **840.2** |
| 56,310 | 1,184 | 2,155.2 | **971.2** |
| 124,048 | 2,720 | 3,659.9 | **939.9** |
| 117,698 | 2,576 | 3,416.1 | **840.1** |

The distribution is unusually tight — 840 to 990 ms for 17 of 18 samples, one fast-path outlier at
464 ms. Run 2 spans 828 to 999 ms with no outlier. This is a fixed cost, not a noisy one, which is
why a single unsourced sample happened to be right.

### 2.4 Raw data — other probes, run 1 / run 2

```
spawn.floor       run1  426.8 427.9 435.1 436.6 444.2 418.0 410.6 413.8 557.5 472.7 419.3 438.5
                  run2  404.5 411.8 409.6 408.9 408.2 406.5 416.9 417.4 434.9 415.0 423.6 411.5
synth.say         run1  1167.5 1228.6 1244.3 973.5 1162.7 1067.9 1016.6 1211.4 1110.9
                  run2  967.4 1064.6 1054.2 900.4 1060.9 1049.8 905.1 1056.6 1083.7
listVoices        run1  590.6 487.3 501.2 509.6 460.4 405.2
                  run2  547.1 454.6 418.3 530.2 533.4 471.7
player.no-device  run1  3.0 2.4 2.5 2.3 2.3 2.5 2.4 2.2 2.2 2.2 2.2 2.2
                  run2  3.0 2.4 4.0 2.7 2.5 4.4 2.7 3.3 4.7 3.2 2.9 2.5
cancel            run1  1.0 6.2 5.9 3.7 8.8 2.1 3.5 3.0 0.9 4.7
                  run2  2.9 4.1 2.0 3.4 7.3 2.0 4.8 1.0 6.7 2.0
earcon            run1  874.2 383.5 876.2 903.2 896.4 384.0 866.6 875.0 894.6 870.7
                  run2  870.7 886.0 884.8 374.6 861.9 858.2 871.9 367.2 357.6 866.3
firstaudio.lower  run1  957.5 1093.7 1166.4 1226.9 1111.7 1117.1 969.1 1178.5 1123.0 922.4
                  run2  971.8 1132.7 1121.7 935.9 1145.5 1082.2 952.8 1135.8 1131.8 995.4
```

### 2.5 The player-overhead regression

`afplay` was run on synthetic tones of 200, 500, 1,000 and 2,000 ms, four times each, and process
lifetime was regressed against audio duration:

| run | slope | intercept |
|---|---|---|
| 1 | 0.996 | **905.4 ms** |
| 2 | 0.916 | **915.2 ms** |

A slope of ~1.0 confirms the audio plays in real time and the intercept is a genuine fixed cost, not
a duration-proportional one. Run 2's 0.916 is pulled down by one fast-path sample at the 200 ms
point; its intercept is nonetheless within 1 % of run 1's. **~905–915 ms of fixed cost per `afplay`
invocation** is the single number behind everything in section 1.1.

### 2.6 What each avoidable cost would save

| Cost | Measured | Avoidable? | Saving if avoided |
|---|---|---|---|
| Audio device open/close per chunk | ~893 ms | Yes — hold one player/device open (M9) | **~890 ms per chunk boundary**; this is the entire gap |
| `say` synthesis | ~1,054–1,163 ms | Yes — use Piper (52–65 ms, P11) | **~1,000 ms off first audio**; required for R4.2 |
| `listVoices()` on `prepare()` | ~480 ms | Yes — cache it (P28) | **~480 ms off a cold first press** |
| Player process fork/exec | 2.3 ms | Yes, but | **~2 ms.** Not worth designing for |
| Temp-file round trip | 0.33 ms | Yes, but | **~0.3 ms.** Not worth the correctness risk (P29) |
| Player kill on cancel | ~3 ms | No | — |

---

## 3. Audit — every latency number in the repository

Method: `grep -rnoE '[0-9][0-9,]*(\.[0-9]+)? ?ms'` across `docs/`, `HANDOFF.md`, `PITFALLS.md`,
`STATE.md`, `packages/` and `scripts/` returned **607 occurrences across 46 files**. Every one was
read in context and classified. Rows below are one per *distinct claim*, so repeated quotations of
the same number collapse to one row with all its sites named.

Classification:

- **MEASURED** — a probe exists, in this repo or described well enough to re-run, with a run count.
- **DOCUMENTED** — a vendor or upstream source, cited.
- **ESTIMATED** — arithmetic or intuition. Arithmetic over measured inputs is still ESTIMATED,
  because the composition has not been observed.

### 3.1 Headline of the audit

| | count |
|---|---|
| ms/second occurrences swept | 607, across 46 files |
| distinct performance claims classified | 196 |
| **MEASURED** — a probe exists, in this repo or a named third-party one | 61 |
| **DOCUMENTED** — a vendor or upstream source, cited | 63 |
| **ESTIMATED** — arithmetic or intuition, no probe | **72** |
| carrying an R006 label (`[measured-here]` / `[measured-third-party]` / `[claimed]`) | **41, all but two of them in one file** |

**R006 is honoured in exactly one document.** `docs/.research/tts-engine-landscape.md` applies the
labels systematically and states its test rig (`line 22-25`: Apple Silicon, macOS 26.5, Node v26.7.0,
sherpa-onnx-node 1.13.6, 2 threads, warm process, ~2 s sentence, 3–5 repetitions). Design 010 uses
ad-hoc markers (`[UNMEASURED]`, `[ARITHMETIC]`, `[ESTIMATED]`) consistently and names its falsifiers
— not R006 vocabulary, but honest. **Every other document in the repository, including the
constitution that defines R006, states latency numbers bare.**

### 3.2 Where the ~970 ms actually came from

The round-3 review called it *"asserted in `subprocess-sink.ts:8-10`'s own header … no probe, no run
count, no date anywhere in the repo."* That is right about this repo and wrong about the number's
origin. It has one, and the origin is properly labelled:

`docs/.research/tts-engine-landscape.md:381-383` — *"[`speak11` persistent player over FIFOs] — its
changelog measures a persistent player cutting the inter-sentence gap from **~970 ms to ~30 ms**
versus one `afplay` per sentence `[measured-third-party]`"*, citing
`smcantab/speak11` `CHANGELOG.md#L7` at commit `475c5fa`.

So the chain is:

```
speak11 changelog  →  tts-engine-landscape.md:382   [measured-third-party]   ← label correct
                   →  subprocess-sink.ts:8-10       (bare prose)             ← label dropped, commit 0a28210
                   →  HANDOFF:109 · STATE:60 · constitution:119 · architecture.md:74
                      · 004 ×8 · 005 ×2 · 006 ×4 · 007 ×2 · 010 ×3 · q-round1-codebase ×4
                   →  004-voice-lab.md:108, :355    "(v1 macOS, measured)"   ← label INVERTED
```

The failure is not fabrication. It is a **label lost in transit and then re-invented as a stronger
one**: a third-party measurement of someone else's player on someone else's machine became "measured
on v1 macOS" in the document that ships it as a tunable preset. That is a distinct and more insidious
failure than an invented number, because the number is right and the provenance is wrong, so every
sanity check passes.

Measured here, on our sink: p50 950 / 937 ms. The third-party figure transfers. Nobody could have
known that until now.

### 3.3 Where STATE.md's 927 ms came from — and why it cannot be re-derived

`STATE.md:23` prints *"❌ **927 ms on the OS synth**"* in the Definition-of-Done audit table, beside
`✅ cancel measured at 1 ms` and a CI run id. `927` appears nowhere else in the repository.

The only script that prints a first-audio number is `scripts/speak-e2e.mjs:48`. It is manual,
macOS-only, single-run, and its output is recorded nowhere. Worse, the quantity it prints is not
first audio in either direction:

- its `t0` (`line 30`) starts **before** `provider.prepare()` (`line 43`), which pays `say -v '?'` — measured
  above at **~480 ms**, so the timer includes half a second of voice enumeration a warm plugin never pays;
- its "first audio" is the **first PCM chunk out of the provider** (`line 48`), i.e. before `sink.enqueue`
  spawns anything. No player has started. Nothing is audible.

And, verified by effect: **the script does not run today.**

```
$ node scripts/speak-e2e.mjs
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '/Users/m5air/source/orca-plugin-tts/packages/core/src/normalizer/index.js'
  imported from packages/core/src/index.ts
```

So the one number scoring the project's headline requirement comes from an unrecorded single run of a
script that is currently broken, measuring a quantity that is neither the budget's numerator nor its
denominator. Replacing it: `firstaudio.lower` p50 **1,112 / 1,082 ms**, from a probe that runs.

### 3.4 The Stop budget: a check that could not have failed

Nine places quote Stop or cancel as *"measured at 50 ms"* or *"cancel measured at 1 ms"* —
`STATE.md:18`, `docs/TASKS.md:103/119/152/158`, `docs/PLAN.md:215/231`,
`docs/design/007-user-stories.md:210/235/1400`. All of them rest on one assertion,
`packages/providers/src/contract.ts:69`:

```ts
expect(elapsed, `cancel took ${elapsed} ms`).toBeLessThanOrEqual(CANCEL_BUDGET_MS * 20)
```

`CANCEL_BUDGET_MS` is 50, so the gate is **1,000 ms**. Exceeding 50 ms only emits a `console.warn`
(`line 71`). The green tick next to "50 ms" is produced by a test that would still be green at 999 ms.
The constitution's own rule applies verbatim: *a check that could not have failed is not a check.*
The measurement it reports (0–1 ms) is real; the **gate** is 20× the budget it is quoted as proving.

### 3.5 The full table

Rows are one per distinct claim; repeated quotations of one number collapse into a single row that
names every site. `labelled?` = carries an R006 token.

#### Memory files, plan and constitution

| file:line | number | claim | class | basis | labelled? |
|---|---|---|---|---|---|
| `STATE.md:18` | 1 ms / <50 ms | "cancel measured at 1 ms", budget met | MEASURED value, **broken gate** | `contract.ts:47-71`; assert is `<= 50*20` = 1,000 ms | no |
| **`STATE.md:23`** | **927 ms** | first audio on the OS synth | **ESTIMATED** | unrecorded single run of `speak-e2e.mjs`, which does not run today (3.3) | no |
| `STATE.md:23` | <500 ms | R4.2 budget | requirement | user issue #1 | no |
| `STATE.md:60`, `line 70` | ~970 ms, ~1 s | inter-sentence gap | DOCUMENTED third-party, **label dropped** | speak11 changelog via the sink comment | no |
| `HANDOFF.md:42` | <~500 ms | R4.2 | requirement | TTS-Hotkey issue #1 | no |
| `HANDOFF.md:104` | 52–65 ms/sentence | Piper synthesis | MEASURED | P11 / landscape `line 39` where it *is* labelled | no (label lost in transit) |
| `HANDOFF.md:106` | 414 ms | `say ""` spawn | MEASURED, 5 runs | P10 | no |
| `HANDOFF.md:106` | 16–25× | Kokoro vs Piper | ESTIMATED (ratio over measured inputs) | P11 arithmetic | no |
| `HANDOFF.md:109` | ~970 ms | afplay inter-sentence gap | DOCUMENTED third-party, label dropped | sink comment | no |
| `HANDOFF.md:130` | p50 120 / p99 250 / CI 400 ms | Stop budget | ESTIMATED | 003 Q13; `docs/design/006-fma.md:752` states the harness "is not built" | no |
| `HANDOFF.md:131` | 345 ms | panel poll floor | ESTIMATED (arithmetic) | 10,000/30; **conflicts with `docs/design/007-user-stories.md:521`'s 333 ms** | no |
| `PITFALLS.md:95` | ~450 ms | `say -v '?'` | MEASURED, 5 runs | `q-round1-platform.md:689` | no |
| `PITFALLS.md:310` | 4.7 s | 397-entry / 81 MB bz2 decode | MEASURED | P14, 2026-08-20 | no |
| `PITFALLS.md:335-336` | 52–65 / 210–278 / 838–865 / 1306–1358 ms | Piper · Pocket int8 · Kokoro FP32 · Kokoro int8 | MEASURED, rig stated, **run count not** | this machine | no |
| `PITFALLS.md:343` | 414 min / 418 median, 5 runs | `say ""` | MEASURED — the best-documented number in the repo | this machine | no |
| `PITFALLS.md:353` | 1.5 ms | `ffplay.kill()` | MEASURED — but of *kill*, not *drain* (E-03) | P9 | no |
| **`.specify/memory/constitution.md:119`** | **~970 ms** | "`afplay`-per-file **measures** ~970 ms" | DOCUMENTED third-party, **stated as a local measurement** | sink comment. On the page that defines R006 | no |
| `.specify/memory/constitution.md:116-117` | <500 ms ×2 | first-audio budgets | requirement | R4.1 / R4.2 | no |
| `.specify/memory/constitution.md:118` | ~15 ms, 10 ms | buzz barge-in | DOCUMENTED third-party | "buzz measures" — no file:line, no URL | no |
| `docs/PLAN.md:38` | 86 ms | "414 ms spawn leaves 86 ms" | ESTIMATED (arithmetic over a measured input) | 500 − 414 | no |
| `docs/PLAN.md:18/20/121/215/231/252`, `docs/TASKS.md:103/110/119/152/158/215/217` | 50 ms, 500 ms | cancel and first-audio gates | requirements; the 50 ms gate is the broken one (3.4) | R2.5, R4.2 | no |
| `docs/architecture.md:71` | 4 ms drift, 2 ms stop | Web Audio | MEASURED | marked `MEASURED.` inline | ad-hoc |
| `docs/architecture.md:74` | ~970 ms | afplay gaps | DOCUMENTED third-party | **same five-line block as three items stamped MEASURED** | no |
| `docs/architecture.md:188/191/194` | 52–65 ms, ~414 ms ×2 | degradation ladder | MEASURED | P11, P10 | no |

#### Design documents

| file:line | number | claim | class | basis | labelled? |
|---|---|---|---|---|---|
| `docs/.discussion/003-panel-and-control-channel.md:363`, `line 1213`; `docs/design/007-user-stories.md:515`, `line 1354` | "roughly 250–300 ms" | the point at which people stop attributing an effect to their own action | **ESTIMATED, presented as an established result** | **no citation anywhere in the repo.** Sole justification for the p99 250 ms budget and the 400 ms CI gate | no |
| `docs/.discussion/003-panel-and-control-channel.md:377-381`, `line 1436-1451`; `docs/design/007-user-stories.md:1355` | 60 / 40 / 100 / 50 → 250 ms | the Stop segment budget | ESTIMATED ×4, one MEASURED cell (1.5 ms) | E-03 | no |
| `docs/.discussion/003-panel-and-control-channel.md:342-345`; `docs/design/007-user-stories.md:265-267`, `line 1217`, `line 1245` | ~20–60 / ~40–120 / ~20–50 ms / "seconds" | press→silence per Stop route | ESTIMATED | no probe; routes 1–2 depend on a control pane whose viability is 003 Q45, open. Contradicts the same set's 250 ms p99 (logged as X-11) | no |
| `docs/.discussion/003-panel-and-control-channel.md:384-386`; `docs/design/007-user-stories.md:521-522` | 333 / 345 / ~170 / ~495 ms | panel poll floor and polled-Stop worst case | ESTIMATED (arithmetic over a documented rate limit) | `plugin-panel-bridge.ts:22-23`. **Good arithmetic, shown** — but 345 and 333 are stated as the same quantity in different files | no |
| `docs/.discussion/003-panel-and-control-channel.md:593` | `engine: Piper (amy-low) · 58 ms` | live readout in the TUI wireframe | **fabricated sample value** | matches no measured Piper figure (52–65 ms) | no |
| `docs/.discussion/003-panel-and-control-channel.md:227`, `line 456`, `line 1256`, `line 1261`, `line 1493` | 750 / 5,000 / 120,000 / 30,000 ms | probe timeout, staleness guard, paused-backlog, heartbeat | design constants | chosen here | no |
| `docs/.discussion/003-panel-and-control-channel.md:911`, `line 917`; `docs/design/005-agent-identity.md:784-785`; `docs/.discussion/000-open-questions.md:181`; `docs/design/009-reconciliation.md:62` | ~30 s; ~2.7 s preamble vs a 1.0 s reply | stacked identity overhead | ESTIMATED (arithmetic over 140 + 350 + 970 + a spoken long form) | **three documents call it "measured"** | no |
| `docs/.discussion/003-panel-and-control-channel.md:370`; `prior-art-buzz.md:31` | 10 ms | buzz barge-in monitor tick | DOCUMENTED | `tts_speaker_cancellation.rs:15-94` | no |
| `docs/.discussion/003-panel-and-control-channel.md:1194`; `docs/design/004-voice-lab.md:56/93/787`; `docs/design/007-user-stories.md:227/899`; `docs/design/000-round-ledger.md:66` | 414 ms | `say ""` spawn floor | MEASURED, 5 runs | P10 | no |
| **`docs/design/004-voice-lab.md:108`, `line 355`; quoted into `docs/design/007-user-stories.md:753-754`** | **`simulateChunkGapMs` preset `970` "(v1 macOS, measured)"** | lab gap simulation | DOCUMENTED third-party, **label inverted** | 008 E-05 found the same and it is uncorrected | **no — mislabelled** |
| `docs/design/004-voice-lab.md:54/60/106/355/420/784/791`; `docs/design/005-agent-identity.md:615/766`; `docs/design/006-fma.md:115/116/249/744`; `docs/design/010-provider-seam-and-resident-service.md:523/553/891` | ~970 ms and arithmetic over it (4×970; 11×970 ≈ 10 s; 200×970 ≈ 3 min) | inter-chunk gap and its consequences | DOCUMENTED third-party; the products are ESTIMATED | speak11 → sink comment | `010` only |
| `docs/design/004-voice-lab.md:57`, `line 366`; `docs/design/005-agent-identity.md:47/479/489/491/509/512/988`; `docs/design/007-user-stories.md:176` | ~450 ms | `listVoices()` / `say -v '?'` | MEASURED, 5 runs (456/439/451/460/442) | `q-round1-platform.md:689` | 2 of 9 sites say MEASURED |
| `docs/design/004-voice-lab.md:5/61/118/149/783/789/794` | two seconds | M11 change-to-hear gate | requirement | `docs/TASKS.md:292` | no |
| `docs/design/004-voice-lab.md:81/118/770` | ~0 ms | replay from the decoded-AudioBuffer cache | ESTIMATED | reasoning about `source.start()`; no probe | no |
| `docs/design/004-voice-lab.md:763`, `line 788` | ~1 ms re-normalize; <5 ms loopback; "single-digit ms" decode | Voice Lab cold-path components | ESTIMATED | **under a heading reading "measured against numbers we already have"** | no |
| `docs/design/004-voice-lab.md:173`, `line 701`; `docs/design/005-agent-identity.md:539/561/563/583`; `docs/design/007-user-stories.md:733` | 150 ms control earcon, 300 ms compare separator | earcon durations | ESTIMATED | design constants | no |
| `docs/design/005-agent-identity.md:561/563/603/608`; `docs/design/006-fma.md:290`; `docs/design/007-user-stories.md:37` | 60 + 20 + 60 = 140 ms | identity earcon total | **ESTIMATED, and 6.2× low against the shipped sink** (1.4) | arithmetic over a chosen spec | no |
| `docs/design/005-agent-identity.md:641/740/765` | ~350 ms | spoken cost of a one-word call-sign | ESTIMATED | intuition; the per-turn cost of the design's headline mechanism, never synthesized and timed | no |
| `docs/design/005-agent-identity.md:512`; `docs/design/006-fma.md:284` | 41 × ~450 ms ≈ 18 s | voice-distinctness probe at startup | ESTIMATED (arithmetic over a measured input) | inherits "measured" from the 450 | partial |
| `docs/design/005-agent-identity.md:527`; `q-round1-buzz-transcript.md:264` | 50 ms | buzz's PTT earcon oscillator | DOCUMENTED | `useHuddlePttState.ts:36-54` | no |
| `docs/design/006-fma.md:744-745`, `line 752-753`; `docs/design/009-reconciliation.md:65/66/67` | ~970 ms; p50 120 / p99 250; 400 ms | scoping caveats | ESTIMATED, **explicitly acknowledged as unmeasured** | the honest handling | ad-hoc |
| `docs/design/010-provider-seam-and-resident-service.md:34/36/304/402/518-525/589/597-599/819/891/895/907` | 414/418, 52–65, ~450, 0.9–1.5, <5, ~1, ~2, 30–120, ≤150, ≥350, ~80 ms | the resident-service budget, segment by segment | mixed, **each cell individually marked** | `[UNMEASURED]`, `[ARITHMETIC]`, `[ESTIMATED]`, MEASURED | ad-hoc, and the best in the repo |
| `docs/design/010-provider-seam-and-resident-service.md:525`, `line 861` | "83 % of the 500 ms budget"; "120 ms instead of 500" | derived shares | ESTIMATED | arithmetic; the second rests on the unrun SPIKE-1 | no |
| `docs/.discussion/002-agent-spoken-channel.md:217`; `docs/design/007-user-stories.md:309`; `docs/design/011-settings.md:539/570`; `q-round1-codebase.md:220` | 250 ms | transcript `fs.watch` debounce | config with a real latency consequence | `huddle/index.ts:52` | no |
| `docs/.discussion/002-agent-spoken-channel.md:300-302`; `docs/design/004-voice-lab.md:420` | 40,000 chars ≈ 200 chunks ≈ ~33 min of audio; ~200 spawns ≈ ~3 min of silence | worst-case reply | ESTIMATED (multi-step arithmetic over an unmeasured input) | — | no |
| `docs/.discussion/001-integration-path.md:19` | 40 ms | ORCA transcript live-tail debounce | DOCUMENTED | `native-chat-types.ts:61-80` | no |
| `docs/.discussion/001-integration-path.md:108` | "4 ms drift, 2 ms stop-to-silence" | Web Audio verdict row | MEASURED, **range narrowed to its best case** | source says drift ≤4 ms and stop 2–5 ms | no |

#### Source and scripts

| file:line | number | claim | class | basis | labelled? |
|---|---|---|---|---|---|
| **`packages/plugin/src/sinks/subprocess-sink.ts:8-10`** | **~970 ms** | inter-sentence gap on macOS | DOCUMENTED third-party, **label dropped here** | commit `0a28210`; the origin of every bare 970 in the repo | no |
| `packages/plugin/src/sinks/subprocess-sink.ts:6` | 0.9–1.5 ms | player kill | MEASURED | P9 | no |
| `packages/providers/src/os-synth/index.ts:5` | ~414 ms | `say` spawn, "measured — PITFALLS P10" | MEASURED | cited | ad-hoc |
| `packages/providers/src/contract.ts:12`, `line 69-71` | 50 ms budget, **1,000 ms assert** | T041c cancel gate | **a check that could not fail** (3.4) | — | no |
| `packages/plugin/src/speech-service.ts:40`, `line 69`, `line 75` | <~500 ms; 500 ms | R4.2 rationale; announce coalescing | requirement; config | — | no |
| `packages/plugin/src/huddle/index.ts:51-52`, `clipboard.ts:64`, `os-synth/index.ts:38` | 20,000 / 250 / 20,000 / 60,000 ms | watch window, debounce, timeouts | config | — | no |
| `scripts/smoke-synth.mjs:39` | prints `elapsed=Nms` `[measured]` | synth wall clock | a real probe | **output recorded nowhere** | ad-hoc |
| **`scripts/speak-e2e.mjs:48`, `line 52`** | prints `time to first audio` `[measured]` | e2e first audio | a real probe that **does not run today** (3.3) | probable source of STATE.md's 927 | ad-hoc |

#### Research files

Summarised; `docs/.research/tts-engine-landscape.md` is labelled throughout and is the model the rest
of the repo should follow.

| file(s) | what is there | class | labelled? |
|---|---|---|---|
| `tts-engine-landscape.md` — ~30 distinct figures (Piper 52–65 ms, `say ""` 414/418 over 5 runs, Pocket 210–278, Kokoro 838–865 FP32 / 1306–1358 int8, `OfflineTts` construction 406 ms, `generateAsync` 68 ms, sherpa CLI 470 ms cold of which 129 ms synthesis, bz2 4.7 s, kill 0.9–1.5 ms, and the speak11 ~970→~30 ms) | mixed MEASURED / DOCUMENTED, **rig and repetition count stated at `line 22-25`** | **yes — the only file that does this** |
| `orca-empirical-findings.md` — ~14 figures from an executed browser/worker harness (Web Audio drift ≤4 ms, `stop()`→`onended` 2–5 ms over 2 runs, `decodeAudioData` 8–10 ms, `baseLatency` 5.33 ms, MessageChannel 1.5 ms, `speechSynthesis` 1,672 ms) | MEASURED, raw JSON inline | no — prose `MEASURED` |
| `q-round1-platform.md:689-693` — `say -v '?'` 456/439/451/460/442 → ~450 ms | MEASURED, 5 runs, raw values pasted | no — prose heading |
| `q-round1-codebase.md:287` — `OsSynthProvider` cancel 0 ms / 1 ms | MEASURED, printed by the suite | no. **Cited by none of the four designs, though it would have supported 003's third segment** |
| `q-round1-codebase.md:104/111/207/227` — ~970 ms ×4 | DOCUMENTED third-party, label dropped | no |
| `prior-art-buzz.md` — ~20 buzz constants (10 ms tick, 8 ms fade, 20 ms lead-in, 80 ms Flow-LM frame, 300 ms VAD flush, 200 ms PTT tail) | DOCUMENTED, each `(VERIFIED)` with file:line | no |
| `orca-plugin-api.md`, `q-round1-orca-api.md` — ORCA constants (40 ms tail debounce, 5 min reap, 10 s/30 s protocol timeouts, 30 per 10 s, 300 ms dev-watcher) | DOCUMENTED, cited | no |
| `_track-b-local-tts.md`, `_track-b-cloud-stt-audio.md` — vendor TTFB claims (Flash v2.5 ~75 ms, Aura-2 <200 ms, Sonic 40 ms, Rime <200 ms, Orpheus ~200 ms, Qwen3 ~97 ms, VibeVoice ~300 ms) | DOCUMENTED, several via secondary sources | no — prose `CLAIMED` |
| `_track-b-cloud-stt-audio.md:97` — **`ffplay` respawn-per-chunk costs ~0.2–0.3 s; a 1 s clip takes 1.26 s wall** | MEASURED here, on a different player | no — prose `MEASURED-ON-THIS-MACHINE`. **This is the closest thing to a prior measurement of our gap, and none of the four designs cites it** |
| `_track-c-cross-platform.md:22/27/75` — `afplay` kill 0.9 ms, `ffplay` kill 1.5 ms, `say` spawn ~414 ms | MEASURED | no |
| `docs/.research/fix-round1-report.md:157` and `:373` — ~970 ms restated bare | DOCUMENTED third-party, label dropped | no |
| `docs/.research/fix-round1-report.md:247` — `spd-say --cancel` stops speech in ~1 s | MEASURED, single run on a stock Linux image | no |
| `speckit-workflow.md:658-718` — SC-001 "within 1 second", SC-002 "no more than 2 seconds", SC-003 "within 200 ms in 99 % of attempts" | ESTIMATED, **under a heading reading "Measurable Outcomes"** | no |

### 3.6 Every place an estimate is dressed as a measurement

Ordered by how badly the presentation misleads. This is the list the round-3 brief actually asked for.

1. **`.specify/memory/constitution.md:119`** — *"`afplay`-per-file **measures** ~970 ms"*, in the
   Source column of the Latency Budgets table, **on the page that defines R006.** The other rows in
   that table cite a requirement or a third-party source; this one cites a code comment and uses the
   verb "measures".
2. **`docs/design/004-voice-lab.md:132` and `line 392`, quoted into `docs/design/007-user-stories.md:753-754`** — the `simulateChunkGapMs` preset `970`
   carries *"(v1 macOS, **measured**)"*. It is a third-party changelog figure. This is the only place
   in the repo where a label is not merely dropped but **upgraded**, and it ships as a slider preset a
   listener will tune against.
3. **`STATE.md:23` — `927 ms`** — three significant figures, in the Definition-of-Done table, beside
   `✅ cancel measured at 1 ms` and a green CI run id. One unrecorded manual run of a script that no
   longer executes, measuring the wrong quantity (3.3).
4. **`contract.ts:69` and the nine "measured 50 ms" claims that rest on it** — the assertion is
   `<= 1000 ms`. A permanently-green indicator (3.4).
5. **`docs/.discussion/003-panel-and-control-channel.md:383-389` — the Stop segment table.** Five rows, a column headed *"Basis"*, identical
   formatting. Four rows are intuition; one cell (1.5 ms) is real and measures a different quantity
   on a player we do not ship. The 40 ms row describes a process that does not exist. Reprinted as
   authoritative-looking mermaid annotations at
   `docs/.discussion/003-panel-and-control-channel.md:1436-1451`.
6. **`docs/.discussion/003-panel-and-control-channel.md:363` / `docs/design/007-user-stories.md:515` — "roughly 250–300 ms" perceptual threshold.** Stated twice as an
   established result, uncited anywhere, and it is the sole justification for the p99 250 ms budget
   *and* the 400 ms CI gate. The most load-bearing uncited number in the project.
7. **`docs/.discussion/003-panel-and-control-channel.md:342-344` / `docs/design/007-user-stories.md:265-267` — the four-route press-to-silence table.** A clean comparison
   table whose ranking decides the control-channel architecture. No probe; two of the four routes run
   through a component whose viability is an open question in the same document.
8. **`docs/architecture.md:71-74`** — items 1–3 end in *"MEASURED."*; item 5's *"~970 ms gaps"* sits
   in the identical five-line block with no marker, so the reader inherits the stamp.
9. **`docs/.discussion/003-panel-and-control-channel.md:917` / `docs/design/005-agent-identity.md:785` / `docs/.discussion/000-open-questions.md:181` — "~2.7 s of preamble in front of a 1.0 s reply", called
   *measured* in three documents.** It is 140 + 350 + 970 + an estimated long form: three estimates
   and one third-party figure.
10. **`docs/.discussion/003-panel-and-control-channel.md:593` — `engine: Piper (amy-low) · 58 ms`** inside an ASCII wireframe of a live readout.
    A fabricated sample value that matches no measured Piper figure, formatted exactly as the running
    system would print one.
11. **`docs/design/004-voice-lab.md:787` — the heading "Gate budget, measured against numbers we already have"**, over a
    paragraph mixing one measurement (414 ms) with three estimates (<5 ms loopback, "single-digit ms"
    decode, ~970 ms per chunk).
12. **`docs/PLAN.md:38` — "414 ms spawn leaves 86 ms"** — a subtraction from a measured value,
    presented as if the remainder were observed headroom.
13. **`docs/.discussion/001-integration-path.md:108` — "4 ms drift, 2 ms stop-to-silence"** — genuinely measured, but the source records
    ≤4 ms and 2–5 ms. The best case of each range is reprinted as a point value in a verdict table.
14. **`orca-empirical-findings.md:561/583` — headings reading `MEASURED: drift ≤ 4 ms, far inside the
    50 ms budget`.** The word MEASURED governs the heading; the 50 ms is a target from the brief.
15. **`prior-art-buzz.md:33`, `line 509`, `line 649` — `~15 ms`, `~5 s`, `~100 ms`** — bolded, immediately
    beside `(VERIFIED)` file:line citations, and all three are somebody's multiplication.
16. **`speckit-workflow.md:715-718` — "Success Criteria / **Measurable** Outcomes"**, listing
    "within 200 ms in 99 % of attempts" as SC-003. The 99 % reads as a measured distribution.
17. **`q-round1-orca-api.md:291` — bolded `333 ms`** in the emphasis style the file reserves for
    verified ORCA constants. It is `10,000 / 30`.
18. **`_track-b-local-tts.md:9` — "Sub-100 ms in practice" for macOS `say`**, in the same
    latency-to-first-audio column as vendor figures marked CLAIMED, with no marker at all — and
    contradicted by our own 414 ms.

### 3.7 Numeric contradictions found while sweeping

| | |
|---|---|
| Panel poll floor | **345 ms** (`HANDOFF.md:131`, `docs/design/000-round-ledger.md:69`) vs **333 ms** with a ≈495 ms worst case (`docs/design/007-user-stories.md:521`), from the same 30-per-10 s limit |
| Stop press-to-silence | **~40–120 ms** (`docs/design/007-user-stories.md:266`) vs **p99 250 ms / CI 400 ms** (`docs/design/007-user-stories.md:514`) — logged as X-11 in `docs/design/009-reconciliation.md:65`, still open |
| `say` first audio | **"sub-100 ms in practice"** (`_track-b-local-tts.md:9`) vs **414 ms measured** (`tts-engine-landscape.md:73`) |
| Ordered-list normalization, row 33/H24 etc. | already caught in 008 X-07; not re-audited here |


---

## 4. Why this is not a CI gate

Constitution R073 makes performance budgets gates, and round-3 finding C-02 pushed back on gating a
budget whose architecture is an open question. Both are right, and neither applies to *this* script:

- Absolute latency here is dominated by the machine's audio stack. The same code on a machine with a
  USB DAC, a Bluetooth output, or an active audio session will produce a different `afplay` device-open
  cost by more than the differences we would want to detect. A threshold would be a permanently-red or
  permanently-green light, and the constitution's own rule is that an indicator that never changes is
  a broken indicator.
- CI runners have **no audio device at all** (P16: `actions/runner-images` has zero references to
  `alsa` or `pulseaudio`). Every probe that matters would report NOT-RUN.

`pnpm bench:latency` is therefore a **manual command**. What *could* be gated later is a ratio
measured within a single run — for example "the gap must be under 10 % of the audio it separates"
after M9 — because a ratio cancels the machine. That is not attempted here and is not claimed.

## 5. What the benchmark refuses to do quietly

A benchmark that reports fewer numbers than it claims is the same failure as a green test that could
not fail. `bench-latency.mjs` therefore:

- declares its probe list up front (`PROBE_IDS`) and prints `probes expected N · reported N · ran N ·
  not-run N` at the end;
- **exits non-zero** if any probe neither ran nor printed a `NOT-RUN` line with a reason;
- prints the reason for every NOT-RUN (`paplay not on PATH`, `no player probe written for win32`,
  `provider.generate threw: …`) rather than omitting the row;
- labels every row `[measured-here]` or `[derived]` inline, so the output cannot be pasted into a
  document as an undifferentiated table — which is exactly how the ~970 ms escaped.

**Silent by default.** Seven of the twelve probes open the audio device and are behind `--audible`,
which prints a three-line warning before it makes a sound. In the default mode they print NOT-RUN
with the reason quoted in section 1.0. This is the same discipline as the NOT-RUN accounting above,
applied to a constraint about the *operator* rather than the platform: the benchmark must be runnable
while somebody is working, or it will not be run.

Platform coverage today: **darwin is complete in `--audible` mode, and five of twelve probes silently.** On linux, `spawn.floor` reports NOT-RUN (there is no
zero-work synth spawn equivalent) and the player probes require `paplay` on `PATH`. On win32 the
player probes report NOT-RUN — a `System.Media.SoundPlayer` timing probe has not been written. Those
gaps are printed, not hidden, and they are the obvious next contribution from anyone with those
machines.
