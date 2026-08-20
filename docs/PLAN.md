# Plan: give ORCA a voice — spec through published plugin

Ratified architecture: `docs/.discussion/001-integration-path.md`. Constraints: `.specify/memory/constitution.md`.
Depth: heavy. Solo developer. Nine milestones, each independently verifiable.

## 1. Objective

- Ship a cross-platform TTS plugin for ORCA that speaks agent replies aloud as they stream, and speaks
  selected/clipboard text on a hotkey. This is assistive technology for a dyslexic, voice-first operator —
  latency and never-failing-silently are accessibility properties, not polish.
- The plugin API cannot do this alone (measured). The work is therefore three artifacts: a plugin, a
  resident synthesis service, and three small upstream PRs to ORCA.

**Definition of Done**

- A third party can install the plugin from a public GitHub repo through ORCA's marketplace mechanism and
  hear an agent reply spoken, on macOS, Linux, and Windows, with no account, no API key, and no network.
- Pressing the hotkey speaks the clipboard; pressing it again stops speech within 50 ms.
- Huddle mode speaks completed agent replies, never speaks thinking blocks, never speaks tool-call noise.
- First audio lands under 500 ms on the default local engine when warm; under 500 ms via the OS
  synthesizer when the service is cold or absent.
- CI is green on `macos-latest`, `ubuntu-latest`, `windows-latest`, and runs the full test suite on each.
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
- **Does the service ship at v1, or does v1 ship OS-synth-only?** OS-synth-only halves the work and still
  satisfies every hard requirement except the 500 ms budget on macOS (414 ms spawn leaves 86 ms). My lean:
  v1 ships OS-synth-only, v1.1 adds the service — it gets a working plugin in your hands far sooner.

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
- Speech-to-text / voice input / hands-free barge-in — ORCA already ships STT; out until TTS is solid →
  `docs/.discussion/` when it comes up.
- Agents without transcript decoders (Gemini, Cursor, Copilot, Amp, Droid, Devin) — no structured message
  path exists → documented as unsupported in README.
- Windows-on-ARM neural voice — no sherpa build → permanently OS-synth, stated in the UI.
- Cloud providers — opt-in only, and not at v1 → milestone M8+.
- SSH / relay worktrees — transcript lives on the remote host; likely broken by construction → recorded as
  a known limitation, not fixed.

**Delivery**: one repo, one branch per milestone, squash-merged to `main`. Solo.

## 3. Per-change overview

### 3.1 `packages/core/` — pure logic, zero dependencies

- `normalizer/` — 11 stages, options object, one exported `normalize(md, opts): string`.
- `chunker/` — `SentenceBoundaryDetector` with `addText(chunk)` / `finish()`, the boundary ladder, the
  abbreviation table, and the first-sentence-alone flag.
- `queue/` — generation-tagged playback queue; barge-in clears, voice-switch preserves.
- `types/` — `AudioChunk`, `ProviderCapabilities`, `TextSource`, `TtsProvider`, `PlaybackSink`.
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

### 3.4 `packages/service/` — resident synthesis (milestone M8, after v1)

- Loopback HTTP: `POST /synthesize` (streaming response), `POST /cancel`, `GET /health`, `GET /engines`.
- Piper via `sherpa-onnx-node`, model manager with ASCII-safe Windows cache, warm-on-start.
- Owns playback on the machine with the speakers.

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

### Milestone M9 — resident service + Piper (post-v1)

- Service, model manager, ASCII-safe Windows cache, `ServiceProvider`, degradation ladder.

Checkpoint: first audio under 500 ms warm, measured on each OS; killing the service mid-utterance degrades to OS synth without user-visible failure.

### Milestone M10 — upstream PRs

1. Host→panel `postMessage` channel.
2. `sessionId` / `transcriptPath` in the `agent.status.changed` projection.
3. `selection:read` capability.

Checkpoint: three PRs open against `stablyai/orca`, each with a test and a rationale citing this plugin as the motivating consumer.
