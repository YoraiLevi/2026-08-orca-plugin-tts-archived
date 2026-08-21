# What a green CI badge on this repo means — and what it does not

This repo speaks. Two things follow from that, and both are easy to forget while reading a green
tick.

## 1. CI never makes a sound, and that is asserted, not assumed

No job here opens an audio device or spawns a player. It is a hard constraint for two separate
reasons:

- **On the author's machine** (PITFALLS **P31**): a probe that plays audio interrupts the person
  this product is for. A benchmark whose default behaviour interrupts the user is a benchmark that
  gets deleted.
- **On a runner** (spec **FR-106**): a Linux runner has no audio device. A test that plays sound
  there either fails, or — much worse — silently no-ops and reports green. *A test that cannot fail
  is not a test.*

How it is enforced, in the `voice-lab` job:

| | |
|---|---|
| **Observed** | `scripts/ci/no-audio-recorder.mjs` wraps `child_process` from **outside** the process under test, via `node --import`, and records every spawn attempt at call time. Not a grep over a log the server wrote about itself — that proves only that the server agrees with itself. |
| **Judged** | `auditSpawns()` in `scripts/ci/voice-lab-ci.mjs`, a different function from the one that records. It flags players (`afplay`, `aplay`, `ffplay`, `SoundPlayer`, …) **and** synthesizers told to speak instead of to write a file (`say` with no `-o`, `espeak-ng` with no `-w`, `spd-say` with text, `Speak()` with no `SetOutputToWaveFile`). |
| **Proved able to fail** | `node scripts/ci/voice-lab-ci.mjs --prove-guard` — its own CI step, on all three platforms. It spawns a real player (always naming a file that does not exist, so the process exits before reaching the device — PITFALLS **P32**), and requires the audit to go **red**; then requires it to stay **green** on the five spawns the provider legitimately makes. |
| **Proved to be measuring something** | the run fails if **zero** spawns were observed. `prepare()` probes a synthesizer on every platform, so zero means the wrapper never installed and the verdict is measuring nothing (spec **FR-006**'s control case). |

The classifier earned its keep on its first run: it went red on the provider's own `say -v '?'`
voice-list probe. That is now an explicit exemption, and it is the reason we know the audit reads
real argv rather than agreeing with a comment.

## 2. The Voice Lab's own gate is NOT in CI

The milestone's gate is *change a control, hear the difference in under two seconds*. It needs a
real audio device and a browser `AudioContext`. CI has neither, so:

> **The two-second gate is a manual measurement — `pnpm bench:latency` on the author's machine —
> and never a CI threshold.** A latency threshold on a runner with no audio device is a
> permanently-green light (spec **FR-108**).

Three capabilities are reported as **not-run with their reason** in every job summary rather than
omitted (spec **FR-107**), and the job exits non-zero if any probe neither ran nor declared one:

- `gate.two.seconds` — needs a device and a browser.
- `browser.playback` — `decodeAudioData`, the one-per-session `AudioContext` (FR-007) and the
  format branch (FR-008) live in the page; no headless browser is driven.
- `audible.output` — that a WAV contains intelligible speech is settled by the listener. That is
  the entire premise of M11 (PITFALLS **P23**).

## 3. Linux is asserted as it really ships

The `voice-lab` job installs **no** synthesizer on Linux, unlike the `test` job above it. PITFALLS
**P25**: a stock Ubuntu desktop ships `libespeak-ng1` but not `/usr/bin/espeak-ng`, so `/speak`
there returns a `503` or the `spoke-elsewhere` rung. CI asserts the **correct failure** — that the
503 carries the provider's own error text and its install remedy, and that `spoke-elsewhere` is a
named outcome with its four disabled affordances, never reported as success or as a generic error.
`apt install espeak-ng` here would buy a green tick on a machine no user has.
