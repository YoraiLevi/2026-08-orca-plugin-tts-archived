# Plan: give ORCA a voice — spec through published plugin

Ratified architecture: `docs/.discussion/001-integration-path.md`. Constraints: `.specify/memory/constitution.md`.
Depth: heavy. Solo developer. Eleven milestones (M0–M10), each independently verifiable.

> **Amended 2026-08-21 — forced by R7-03 and R7-11.** *"Nine"* never matched the eleven milestones
> below. And this document stops at **M10**, while `docs/TASKS.md` schedules a **Phase 2** — M11 Voice
> Lab, M12 settings, M13 panel, M14 spoken channel, M15 per-agent voices, M16 huddle presence, M17
> voice input — designed in `docs/design/004`, `005`, `010`–`013`. **`docs/TASKS.md` is the schedule
> of record for M11–M17; this document is the schedule of record for M0–M10 and the owner of the
> Definition of Done.** `HANDOFF.md:74-77` lists **seven** roadmap items (M11–M17) while `docs/TASKS.md:465`
> numbered voice input as item **8**; see `docs/TASKS.md` Phase M17 for how that off-by-one was
> resolved (R7-11).

## 1. Objective

- Ship a cross-platform TTS plugin for ORCA that speaks agent replies aloud as they stream, and speaks
  selected/clipboard text on a hotkey. This is assistive technology for a dyslexic, voice-first operator —
  latency and never-failing-silently are accessibility properties, not polish.
- The plugin API cannot do this alone (measured). The work is therefore three artifacts: a plugin, a
  resident synthesis service, and three small upstream PRs to ORCA.

**Definition of Done**

> **Amended 2026-08-21 — forced by round-7 findings R7-02 and R7-03
> (`docs/design/014-review-round7.md` section 2).** This document had never been folded. PITFALLS
> **P32**'s propagation list (`PITFALLS.md:54-56`) named HANDOFF, STATE, the constitution,
> `architecture.md` and designs 004–007 and 010 — **it omitted `docs/PLAN.md` and `docs/TASKS.md`**,
> so six rounds of folding never opened the two documents that define *done* and *schedule the work*.
> That list has been extended; see P32. Three framings below were measured false and are corrected
> in place: the single first-audio item (unachievable on the OS-synth rung), the missing
> inter-sentence-gap item (the constitution's sharpest constraint had no Definition-of-Done
> instrument, so the project was declarable finished with it violated 19×), and the
> *"414 ms spawn leaves 86 ms"* arithmetic in the third open question.

- A third party can install the plugin from a public GitHub repo through ORCA's marketplace mechanism and
  hear an agent reply spoken, on macOS, Linux, and Windows, with no account, no API key, and no network.
- Pressing the hotkey speaks the clipboard; pressing it again stops speech within 50 ms.
- Huddle mode speaks completed agent replies, never speaks thinking blocks, never speaks tool-call noise.
- **First audio, scored per rung, because the two rungs are not the same number.** On the **neural
  rung** (Piper inside the resident service, warm): under 500 ms, measured per OS. On the **OS-synth
  rung**: under 500 ms **only when the synthesizer is resident and the device is already open** —
  which is what M9a builds. The **spawn-per-utterance `say -o` path shipped today cannot meet it and
  is not scored against it**: `OsSynthProvider.generate()` alone measures **p50 1,163 / 1,054 ms,
  min 900, n=9 ×2** `[measured-here]` (`docs/.research/latency-measurements.md` 1.3, quoted as F4 at
  `docs/design/010-provider-seam-and-resident-service.md:37`) — 2.1× the whole budget with playback
  at zero. `STATE.md:31` already scored it this way; this document did not.
- **The inter-sentence gap is under 50 ms, measured, on each OS** — the constitution's
  Latency-Budgets row four (`.specify/memory/constitution.md:119`), which until round 7 was in the
  constitution and in **no** Definition-of-Done item, task, test or CI gate. It measures **p50 950 /
  937 / 897 ms, n=18 ×3** `[measured-here]` today (`docs/.research/latency-measurements.md` 1.1,
  PITFALLS **P32**) — **19×**. Scored by the gap-to-audio ratio and the device-open count that
  Gate M9a names (`docs/TASKS.md` Phase M9a; `docs/design/015-m9-rescope.md` section 6), not by a
  spawn count: player fork/exec is **2.3 ms of the 950** `[measured-here]`, so a fix that stops
  spawning a player per chunk recovers 0.25 % and alters nothing a listener hears.
- CI is green on `macos-latest`, `ubuntu-latest`, `windows-latest`, and runs the full test suite on each.
  **The two audio items above are not CI gates and must not be written as ones** — CI runners have no
  audio device (P16), so every probe that matters would report NOT-RUN and the row would be a
  permanently-broken indicator. They are run on a real machine at a named SHA and the number is
  recorded beside it (P31).
- `README.md` documents install, configuration, engine selection, and the known limitations verbatim from
  the blocked-capability table — no limitation is implied away.
- `STATE.md`, `HANDOFF.md`, `PITFALLS.md` reconcile with the shipped system.

**Open questions — I cannot decide these alone**

- **Repo layout**: one repo containing plugin + service, or two? One repo is simpler to keep in sync and
  to CI; two matches the fact that the service is really your existing `TTS-Hotkey-AI-Read-Clipboard-CLI`
  project and is useful outside ORCA. My lean: one repo, two packages, because R5 wants one publishable
  thing and the service has no users yet.
- **Licence**: Piper voices are GPL-3.0 and espeak-ng is GPL-3.0-or-later. We invoke a separately
  downloaded ONNX model through an Apache-2.0 runtime, which is the weakest coupling available — but your
  own issue calls the derivative question "unresolved legal, not technical". Choosing MIT vs GPL-3.0 for
  our code is your call, and it gates publishing.
- **Does the service ship at v1, or does v1 ship OS-synth-only?** **Answered by default and already
  executed** — `docs/TASKS.md:18` (T001c) records *"v1 is OS-synth-only; service is M9"*, and v1
  shipped. What is left of the question is **which budgets v1 misses**, and the answer this document
  gave was wrong.
  > **Amended 2026-08-21 — forced by R7-03 and PITFALLS P32.** This item read: *"satisfies every hard
  > requirement except the 500 ms budget on macOS (**414 ms spawn leaves 86 ms**)"*. **There is no
  > 86 ms.** The arithmetic subtracted an empty-string spawn (`say ""`, 414 ms min / 418 ms median,
  > 5 runs `[measured-here]`, PITFALLS **P10**) from the budget and treated the remainder as headroom
  > for synthesis and playback. Measured, the same path costs **p50 1,163 / 1,054 ms of `generate()`
  > alone** (F4, `docs/.research/latency-measurements.md` 1.3) and **1,112–2,017 ms to first audio**
  > `[measured-here]` (1.2, a bracket — nothing in userland can see the first sample leave the DAC).
  > **OS-synth-only misses two hard requirements, not one:** R4.2 first audio, and the constitution's
  > inter-sentence gap, which it misses by **19×** (`p50 950 / 937 / 897 ms, n=18 ×3`
  > `[measured-here]`). Both are M9a's deliverable, and neither is an engine problem — a warm
  > resident `AVSpeechSynthesizer` reaches its first buffer in **p50 17.7 / 17.1 ms, n=20 ×2**
  > `[measured-here]` (`docs/.research/spike1-resident-synth.md` 1), 8.5× inside the 150 ms pass
  > condition. See `docs/design/015-m9-rescope.md`.

## 2. Approach

**Strategy: build the pure logic first and test it exhaustively off-platform, then wrap it in the thinnest
possible ORCA-specific shell, then add engines behind a seam that already exists.**

Why this shape:

- The valuable, portable code — normalizer, chunker, queue state machine — is pure string and buffer logic
  with zero ORCA and zero audio dependencies. It can be written and tested before ORCA is even installed,
  and it is the part most likely to regress silently.
- The ORCA plugin API is EXPERIMENTAL with no compatibility promise. Everything ORCA-specific must be
  quarantined behind one adapter so a breaking upstream change is a one-file fix.
- The provider seam must exist before the first engine, or we repeat `block/buzz`'s mistake — they shipped
  one hardwired engine and their users are still asking for pluggability.

Mechanics that matter:

- **Normalizer is pure and synchronous.** Port buzz's seven stages verbatim, then add the four they lack
  (headings → pause, list items → sentences, tables → announced by row, file paths → spoken sensibly).
  Table-driven tests, one named case per markdown construct.
- **Chunker uses the boundary ladder** sentence → clause → word → scalar, with an abbreviation guard so
  `e.g.` and `1.` don't fake a sentence end. First chunk is the *earliest* sentence end (minimum
  time-to-first-audio); every later chunk is the *latest* that fits (fewest synthesis calls). One boolean
  switches the policies over one splitter. `chunks.join('') === input` is an invariant, asserted in tests.
- **Thinking-block filtering happens at the raw JSONL record level**, before ORCA's decoder flattens
  thinking into text blocks. Filtering after flattening is impossible — this ordering is load-bearing.
- **`cancel()` is two-sided**: abort in-flight synthesis AND flush queued buffers. Monitored independently
  of the synthesis worker, which can block inside inference for hundreds of ms.
- **Dev loop is scripted, not manual.** After every build: read the live `consentFingerprint` via
  `plugins.list()`, call `plugins.consent()` with it, then `setEnabled` off/on to force the worker re-fork.
  Editing `main.mjs` alone silently runs stale code (PITFALLS P6), and declaring `keybindings` re-hashes
  the whole plugin directory on every byte change (P7 territory, measured in E7).
- **Bundle to a single `main.mjs`** with esbuild. Install never runs a build step and caps at 2,000 files
  and 50 MB, so `node_modules` cannot ship and voice models cannot ship.
- **Model cache is ASCII-safe on Windows**, mirroring `src/main/speech/model-cache-path.ts` — sherpa-onnx
  cannot open models under a non-ASCII Windows path, which silently breaks any user named `Björn`.

**Scope IN**

- Speech normalizer, chunker, playback queue — pure, exhaustively tested.
- Provider seam + capability descriptor + OS-synth provider (macOS `say`, Windows SAPI, Linux `spd-say`).
- ORCA plugin: manifest, worker, commands, keybindings, panel UI, settings.
- Transcript tailer with thinking-block filtering, for the five agents that have decoders.
- Clipboard-based "speak selection" and "speak last reply".
- Cross-OS CI, docs, public repo, marketplace entry.
- Three upstream PRs to ORCA, opened but not gated on.

**Scope OUT**

- Real editor-selection reading — no API exists → unblocked by upstream PR 3, tracked in the blocked table
  in `docs/architecture.md`.
- Panel-hosted playback — no worker→panel channel → upstream PR 1, `PanelSink` written but unreachable.
- Speech-to-text / voice input / hands-free barge-in — out of v1. **No longer "when it comes up":
  designed and scored in `docs/design/013-voice-input.md`**, which ships push-to-talk-plus-recap as
  **M17a** and records why full-parity voice input is not buildable today. *"ORCA already ships STT"*
  is not the reason — ORCA's thirteen host methods touch no speech, so the plugin cannot reach it.
- Agents without transcript decoders (Gemini, Cursor, Copilot, Amp, Droid, Devin) — no structured message
  path exists → documented as unsupported in README.
- Windows-on-ARM neural voice — no sherpa build → permanently OS-synth, stated in the UI.
- Cloud providers — opt-in only, and not at v1 → milestone M8+.
- SSH / relay worktrees — transcript lives on the remote host; likely broken by construction → recorded as
  a known limitation, not fixed.

**Delivery**: one repo, one branch per milestone, squash-merged to `main`. Solo.

## 3. Per-change overview

### 3.1 `packages/core/` — pure logic, zero dependencies

- `normalizer/` — 15 transforms in a fixed order (2 conditional), options object, one exported `normalize(md, opts): string`. Planned as 11; grew to 15 through M10.
- `chunker/` — `SentenceBoundaryDetector` with `addText(chunk)` / `finish()`, the boundary ladder, the
  abbreviation table, and the first-sentence-alone flag.
- `queue/` — generation-tagged playback queue; barge-in clears, voice-switch preserves.
- `types/` — `AudioChunk`, `ProviderCapabilities`, `TextSource`, `TtsProvider`, `PlaybackSink`.
  **These are v1 shapes and every one of them changes at seam v2** (`docs/design/010-…md` section 4,
  rung 1): `generate()` yields `SpeechEvent` rather than `AudioChunk`, and `AudioChunk.format` becomes
  an object. `PlaybackSink` v2 and the `SpeechEvent`→sink demultiplexer are part of the same commit —
  rung 1 is **not** a pure refactor (R7-17).
- No imports from Node, ORCA, or any audio library. Runs in `vitest` on all three OSes identically.

### 3.2 `packages/providers/` — the seam and its first implementations

- `TtsProvider` interface: `id`, `displayName`, `capabilities`, `prepare()`, `generate(text)`, `cancel()`.
- `OsSynthProvider` — per-OS command construction, WAV output (never AIFF: `decodeAudioData` rejects
  AIFF-C, measured), process kill on cancel.
- `ProviderRegistry` — selection by config, capability query, warm state.
- Contract test suite every provider must pass: yields audio, respects cancel within 50 ms, reports
  capabilities honestly, never throws on empty input.

### 3.3 `packages/plugin/` — the ORCA shell

- `orca-plugin.json` — manifest, capabilities (`events:subscribe`, `storage`, `settings:own`,
  `notifications:show`), commands, keybindings, panel.
- `main.ts` → bundled `main.mjs` — activate, command handlers, event subscription, orchestration.
- `transcript/` — session resolver (worktree-path heuristic), JSONL tailer, thinking-block filter,
  per-agent decoders vendored for claude/codex/grok/omp/openclaude.
- `panel/` — status UI, current utterance, controls, engine picker, limitation notices.
- `adapter/` — every ORCA API call lives here and nowhere else.

### 3.4 `packages/service/` — resident synthesis **and a held-open audio device** (milestone **M9**, after v1)

> **Amended 2026-08-21 — forced by R7-01 and R7-26.** The heading said *"milestone M8"*; the service
> is **M9** (`docs/TASKS.md:18`, T001c). Two mechanism corrections: the transport is a **socket
> addressed per worktree**, not loopback HTTP (P27, `docs/design/010-…md` section 11.2 as re-anchored
> by R7-19), and **the service owns the audio device, not merely playback** — that is the whole of
> its latency value (P32). *"Warm-on-start"* is contradicted by `010:783`'s lazy-start ruling; see
> `docs/TASKS.md` **T093** and `010` section 11.1, which now reconcile it.

- Command socket per worktree, `protocolVersion` in the path, `{pid, procStart}` liveness:
  `/synthesize` (streaming), `/cancel`, `/pause`, `/resume`, `/duck`, `/health`, `/engines`.
- **Holds one output graph running across an entire reply** — the state never entered on the hot path
  is `engine.stop()`.
- Piper via `sherpa-onnx-node`, model manager with ASCII-safe Windows cache — **M9b, gated on
  quality, not latency**.

### 3.5 `.github/workflows/ci.yml`

- Matrix: `[macos-latest, ubuntu-latest, windows-latest]` × Node 24.
- Steps: install → typecheck → lint → unit tests → provider contract tests → bundle → size gate
  (< 50 MB, < 2000 files) → smoke test that the OS synth produces non-empty audio.

### 3.6 Documentation

- `README.md` — install, config, engines, limitations verbatim.
- `docs/architecture.md` — already written, kept current.
- `docs/dev-loop.md` — the scripted consent/reload cycle, because the naive path silently runs stale code.

## 4. Implementer guide

### Milestone M0 — spec

- `/speckit-specify` for `001-speak-selection`, then `/speckit-clarify`.
- Name the selection limitation in the spec body, not a footnote.

Checkpoint: `specs/001-speak-selection/spec.md` exists and its checklist passes with no `[NEEDS CLARIFICATION]` left.

### Milestone M1 — repo skeleton

- pnpm workspace, TypeScript strict, vitest, esbuild, oxlint.
- Packages: `core`, `providers`, `plugin`. (`service` added at M8.)

Checkpoint: `pnpm test` runs and reports zero tests, exit 0.

### Milestone M2 — normalizer, test-first

Tests land before implementation; this is the constitution's non-negotiable and the component most prone
to silent regression.

- Write the table test from the buzz rules table plus the four additions, all failing.
- Implement the 11 stages until green.

```ts
// packages/core/src/normalizer/index.ts — stage order is load-bearing
export function normalize(md: string, opts: NormalizeOptions = {}): string {
  let s = stripFencedCode(md, opts)      // → "code block omitted"
  s = stripInlineCode(s)                 // backticks go, content stays
  s = stripUrls(s)                       // → "link omitted", keeps sentence punctuation
  s = headingsToPauses(s)                // ours: "# Foo" → "Foo. "
  s = listItemsToSentences(s)            // ours: "- a" → "a. "
  s = tablesToRows(s)                    // ours: announced by row
  s = speakFilePaths(s, opts)            // ours: src/a/b.ts → "src slash a slash b dot ts"
  s = stripMarkdownMarkers(s)            // **bold** __x__ ~~s~~; _emph_ only when wrapping a word
  s = stripEmoji(s)
  s = expandNumbers(s)                   // 42 → "forty two"; 9:05 → "nine oh five"
  s = collapseWhitespace(s)
  return s.length <= 1 ? '' : s          // never let TTS say "period"
}
```

Checkpoint: `pnpm test --filter core` green; `snake_case` and `foo_bar()` survive untouched, asserted.

### Milestone M3 — chunker, test-first

- Invariant test first: for 500 generated inputs, `chunks.join('') === input`.
- Then boundary-ladder tests, then the abbreviation guard, then first-sentence-alone.

Checkpoint: a streamed paragraph fed 5 characters at a time yields the same chunks as the whole string fed at once.

### Milestone M4 — provider seam + OS synth

- Write the contract suite first; it must fail against a null provider.
- Implement `OsSynthProvider` for all three OSes.

```ts
// macOS: WAV, never the default AIFF — decodeAudioData rejects AIFF-C (measured)
say('-o', out, '--data-format=LEI16@22050', text)
// Windows: System.Speech via powershell -NoProfile
// Linux:   spd-say, falling back to espeak-ng
```

Checkpoint: on each OS in CI, the provider produces a non-empty WAV and `cancel()` is observed within 50 ms — measured, not asserted by exit code.

### Milestone M5 — plugin skeleton + scripted dev loop

Lands before any ORCA-facing feature, because without the scripted loop every later step debugs stale code.

- Manifest, activate, one command that speaks a fixed string.
- `scripts/dev.mjs`: build → read live fingerprint → `plugins.consent` → `setEnabled` off/on.

Checkpoint: edit a string in `main.ts`, run the dev script, hear the new string — proving the re-fork actually happened.

### Milestone M6 — clipboard hotkey (feature 1)

- Command + rebindable keybinding; second press stops.
- Clipboard read by spawning the per-OS utility from the worker.

Checkpoint: hotkey speaks clipboard on all three OSes; second press silences within 50 ms, measured.

### Milestone M7 — huddle mode (feature 2)

- Subscribe `agent.status.changed`, correlate via `worktreeId` path, tail the JSONL.
- Filter thinking at the raw record level, feed normalizer → chunker → provider.

Checkpoint: a real agent turn is spoken; a turn containing thinking blocks speaks only the reply — verified against a fixture transcript that contains both.

### Milestone M8 — CI, docs, publish

- CI matrix green on three OSes, size gate enforced.
- README with the limitations table verbatim.
- Public repo, marketplace entry, tag v1.

Checkpoint: install from the public repo into a clean ORCA profile on a second machine and hear a reply.

### Milestone M9 — the resident service that holds the audio device open (post-v1)

> **Rescoped 2026-08-21 — forced by R7-01, R7-03 and PITFALLS P32.** This milestone read *"resident
> service **+ Piper**"* and its checkpoint scored an engine. Both halves are measured false.
> **The gap is the CoreAudio device, not the process spawn** — player fork/exec is **2.3 ms** of the
> **p50 950 / 937 / 897 ms, n=18 ×3** `[measured-here]`, the temp-file round trip 0.33 ms (n=20), and
> **~893 ms `[derived]` is device open / pre-roll / post-roll / teardown**
> (`docs/.research/latency-measurements.md` 1.1 and 2.5, **P32**). **And the engine is not on the
> latency path** — a warm resident `AVSpeechSynthesizer` reaches its first buffer in **p50 17.7 /
> 17.1 ms, n=20 ×2** `[measured-here]` (`docs/.research/spike1-resident-synth.md` 1), against a cold
> first buffer of ~328 ms (n=8). **M9's deliverable is holding one output device open across a whole
> reply; Piper is a quality decision on its own schedule (M9b).** Full specification:
> `docs/design/015-m9-rescope.md`; task list and gate: `docs/TASKS.md` Phase M9.

- **M9a** — resident sidecar holding a warm synthesizer *and* a running output graph: device
  lifecycle, default-device change mid-sentence, device lost to exclusive mode, two-sided cancel with
  the engine still running, ducking as a transport verb, per-worktree socket (P27), `ServiceProvider`
  against the v2 contract, degradation ladder with the rung reportable aloud.
- **M9b** — Piper via `sherpa-onnx-node`, model manager, ASCII-safe Windows cache. Gated on
  **quality**, not latency.

Checkpoint (**M9a**): the inter-sentence gap is **p50 ≤ 50 ms, p95 ≤ 100 ms**, the gap-to-audio ratio
p50 ≤ 5 %, and **exactly one device open per reply**, asserted by the test — with today's
`SubprocessSink` re-measured in the same session as the baseline (R004) and still reading
~890–950 ms. Falsifier: p50 gap above **150 ms**, or more than one device open per reply. **Not a CI
gate** — CI runners have no audio device (P16); CI gates the protocol. Killing the service
mid-utterance restarts **once** with backoff, resumes from the last completed sentence, **and says so
aloud** — *"without user-visible failure"* was the discipline **P30** forbids and is withdrawn.

Checkpoint (**M9b**): a listener prefers the Piper voice in a blind A/B on all three platforms; the
non-ASCII-path regression test is green; the licence is shown before any download; M9a's gate still
passes.

### Milestone M10 — upstream PRs

1. Host→panel `postMessage` channel.
2. `sessionId` / `transcriptPath` in the `agent.status.changed` projection.
3. `selection:read` capability.

Checkpoint: three PRs open against `stablyai/orca`, each with a test and a rationale citing this plugin as the motivating consumer.
