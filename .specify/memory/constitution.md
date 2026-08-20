# ORCA TTS Plugin Constitution

**Version:** 1.0.0 · **Ratified:** 2026-08-20 · **Last Amended:** 2026-08-20

> Durable engineering principles. Slow-changing. Gated by the plan's Constitution Check and by
> `/speckit-analyze`. Contains **no project status** — that lives in `STATE.md` / `HANDOFF.md`.
>
> ⚠️ **Hand-maintained. Do NOT run `/speckit-constitution` — it overwrites this file wholesale.**
> See PITFALLS P2.

## Core Principles

### I. Accessibility Is the Requirement (NON-NEGOTIABLE)

This is assistive technology for a dyslexic, voice-first operator, not a novelty feature. Every
latency budget, every fallback, and every error path is an accessibility property.

- **Never fail silently.** If synthesis fails, the user hears or sees *something*. A hotkey that
  does nothing is indistinguishable from a broken app.
- **Never make the user wait without a signal.** First-run model download, cold model load, and
  network stalls must all be visible.
- The degraded path (OS synthesizer) must always remain functional. We may never ship a state
  where the only working configuration requires a download that has not completed.

### II. Zero-Setup Default (NON-NEGOTIABLE)

The default configuration requires **no account, no API key, and no network**. (User requirement
R3.4.)

- Cloud providers are opt-in, never default, and the UI states plainly that text leaves the machine.
- No Python in the default path. ONNX-runtime engines only.
- No `node-gyp` compilation on the user's machine in the default path. A failed native build is an
  uninstallable plugin.

### III. Cross-Platform Parity (NON-NEGOTIABLE)

macOS, Linux, and Windows get the same features with the same install story. (User requirement R9;
project requirement R1.)

- A feature that works on one OS and degrades on another is not done.
- Platform-specific code lives behind one interface, in one directory, with one test suite run
  against all three in CI.
- CI runs on `macos-latest`, `ubuntu-latest`, and `windows-latest`. A change that cannot be
  exercised on all three is a flagged risk, declared in the PR.

### IV. The Provider Seam Exists Before the First Engine

Backends are configuration, not code. (User requirements R3.1/R3.2.)

- The engine interface is written and tested before any concrete engine is integrated.
- `block/buzz` shipped one hardwired engine and its users are still asking for pluggability
  (their issue #3720). We do not repeat that.
- Every provider declares capabilities — `{streaming, offline, needsApiKey, needsModelDownload,
  licence, cloning, sampleRate}` — so the UI can warn before a download, before text leaves the
  machine, and before a non-commercial licence is used.
- **Providers emit PCM; they never own playback.** A separate sink plays it. (User requirement R5.2.)
- **Text segmentation lives above the provider**, in one shared module, never copied per surface.

### V. Test-First (NON-NEGOTIABLE)

- Tests are written before implementation and must fail first. Red-Green-Refactor.
- The speech-text normalizer is **pure and exhaustively table-tested** — every markdown construct
  gets a named case. It is the highest-value-per-line component and the easiest to regress.
- Cross-platform behaviour is tested in CI on all three OSes, not asserted in prose.
- **Verify by effect, never by presence.** A test that could not have failed is not a test. Assert
  on a named value moving — bytes of audio produced, a cancel observed within a deadline, a
  checksum — never on a file existing or a command exiting 0.

### VI. Never Degrade the Host

The plugin must not block, slow, or destabilise the ORCA session it lives in.

- Synthesis and playback never run on a path that can stall ORCA's UI or agent loop.
- A queue that fills drops or truncates; it never applies backpressure to the agent.
- Failures are contained and logged; an engine crash stops speech, not ORCA.
- We only read from the user's transcripts and configuration. We never write to them.

### VII. Interruptibility Is Two-Sided

Barge-in means **cancel in-flight synthesis AND flush buffered audio**. (User requirement R2.5.)

- Killing only the player leaves the synthesizer producing speech for text already interrupted.
- `cancel()` is a first-class method on every provider — not `kill(pid)`.
- Cancellation is monitored independently of the synthesis worker, which may be blocked inside
  model inference for hundreds of milliseconds.
- One playback owner, acquired by every path, from the first commit.

### VIII. Never Speak What Was Not Said

- Chain-of-thought / thinking blocks are **never** spoken. ORCA's decoder flattens thinking into
  text blocks, so filtering must happen at the raw record level, before flattening.
- Tool-call noise, tool results, and system messages are not speech by default.
- When we cannot determine whether text is a reply or reasoning, we stay silent and log it.

### IX. Evidence Over Assertion

- Every claim about ORCA's API in a spec or plan cites `path/file.ts:123` at a recorded commit SHA.
- Every latency number is labelled `[measured-here]`, `[measured-third-party]`, or `[claimed]`.
- "Inferred" is not a foundation. Before a design depends on a behaviour, someone runs it.

## Latency Budgets

Standing constraints, not aspirations. A change that regresses one is a bug.

| Path | Budget | Source |
|---|---|---|
| Hotkey press → first audio (default local engine, warm) | **< 500 ms** | User requirement R4.2 |
| Agent sentence complete → first audio (huddle mode) | **< 500 ms** | R4.1/R4.2 |
| Barge-in signal → audio stops | **< 50 ms** | buzz measures ~15 ms with a 10 ms monitor thread |
| Inter-sentence gap during continuous speech | **< 50 ms** | `afplay`-per-file measures ~970 ms; that is the failure to avoid |

Model load is **not** on these paths: a resident warm service serves a thin client, because a
hotkey must not pay a multi-second model load per press. (The user's two-process rule.)

## Complexity

- Any dependency, process, or abstraction beyond what a principle requires needs written
  justification in the plan's Complexity Tracking section.
- Prefer one dependency that covers several needs. `sherpa-onnx-node` covering TTS, STT, VAD and
  keyword spotting is worth more than four narrower packages.
- We do not inherit prior art's incidental complexity. Copy the algorithm, not the plumbing.

## Governance

- This constitution supersedes convention and preference. A plan that violates a principle must
  either change or record an explicit, justified exception.
- Amendments bump the version: MAJOR for removing or reversing a principle, MINOR for adding one,
  PATCH for clarification.
- A recurring entry in `PITFALLS.md` is a candidate for promotion into a principle here.
- Principles marked NON-NEGOTIABLE are not subject to exception. They are the reason the project
  exists.
