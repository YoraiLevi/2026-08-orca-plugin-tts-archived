# HANDOFF — orca-plugin-tts

## What this project is
A Text-To-Speech plugin for **ORCA** (https://github.com/stablyai/orca), giving the agent a voice.

Two headline features (not the full list):
1. **Speak selection** — hotkey reads highlighted text aloud.
2. **Huddle / conversational mode** — agent replies are spoken automatically as they stream, in
   digestible chunks, with UI affordances borrowed from `block/buzz`.

## Hard requirements (from the user, non-negotiable)

| # | Requirement | Implication |
|---|---|---|
| R1 | **Cross-platform parity.** macOS, Linux, Windows — identical features, out of the box. | No macOS-only default engine. No `afplay`. Native deps must have prebuilts for all platform+arch combos or be disqualified. |
| R2 | **Local buildable + live-debuggable.** A developer can build the plugin from source and load it into a running ORCA to debug. | Need ORCA's dev-load / hot-reload story documented before design freezes. |
| R3 | **Installable by third parties.** | Must conform to ORCA's real distribution mechanism (registry / manifest / URL — TBD by research). |
| R4 | **Tests + CI/CD + docs before publishing.** CI must run on all three OSes. | Engines that can't be exercised headlessly in GitHub Actions are a flagged risk. |
| R5 | **Publish to a public GitHub repo** — only once R4 is genuinely satisfied. | Not "tests exist" — tests pass, verified by effect. |

## THE MOST IMPORTANT THING TO KNOW

**This is assistive technology, not a novelty.** The user is dyslexic and voice-first. Evidence:
their own gist *"Engineer↔Agent Workflow Infrastructure for a Dyslexic, Voice-First Operator"*,
which cites Wood et al. 2018 (d=0.35 TTS comprehension effect across 22 studies) and a Frontiers
2022 finding that dyslexic adults match controls on *listening* comprehension while lagging on
reading. Latency, reliability and "never fail silently" are accessibility properties here. Treat
them as such.

**The user has already specified this project.** `YoraiLevi/TTS-Hotkey-AI-Read-Clipboard-CLI`
issue #1 is a complete functional spec (R1–R9) plus a source-level survey of 16 projects, and the
gist *"Reading the Screen Aloud"* catalogues 1,553 tools with per-row evidence tiers. **Read both
before designing anything.** Our ORCA plugin is a *host* for that design, not a fresh design.

### The user's binding requirements (from TTS-Hotkey issue #1)

| Req | Constraint | Consequence |
|---|---|---|
| R3.4 | Default needs **no account, no API key, no network** | Disqualifies Picovoice Orca, ElevenLabs, OpenAI, edge-tts |
| R3.1/R3.2 | Backend is **configuration, not code**, behind a documented interface | Provider seam exists before the first engine |
| R4.1 | **Sentence streaming required** — "POST → wait for whole paragraph → play" fails | Huddle mode must synthesize sentence 1 while the agent still types |
| R4.2 | First audio **< ~500 ms** on the default local backend | |
| R2.5 | Speech **interruptible** by a second chord | Two-sided cancel: stop the player AND the synthesizer |
| — | **Two-process rule**: neural model load is seconds; a hotkey must not pay it per press | Resident warm service + thin client |
| R5.2 | **Playback belongs to the client, not the synthesis service** | Providers emit PCM; a separate sink plays it |
| R9 | Cross-platform parity | Of 12 candidates surveyed, **zero** satisfied R9 and **zero** satisfied R3. That gap is our contribution. |

## Current phase
**Phase 0 — Research. 4 of 5 agents done.** Nothing implemented.

| Agent | Status | Output |
|---|---|---|
| orca-api-scout | done | `docs/.research/orca-plugin-api.md` |
| buzz-scout | done | `docs/.research/prior-art-buzz.md` |
| tts-engine-scout | done | `docs/.research/tts-engine-landscape.md` (+ 3 `_track-*` companions) |
| speckit-scout | done | `docs/.research/speckit-workflow.md` |
| orca-empiricist | **running** | `docs/.research/orca-empirical-findings.md` — E1/E2 decide the architecture |

## Settled findings

- **ORCA's plugin API cannot deliver agent reply text, selection, or audio-in-panel.** Verified,
  not merely undiscovered. See `orca-plugin-api.md` "Verdict". Plugin system is off by default.
- **ORCA already ships first-party STT** (`src/main/speech/`, sherpa-onnx model catalog +
  downloader + cloud client + key store + Voice settings pane) and **zero TTS**. That is both the
  precedent to mirror and evidence that ORCA builds voice in the main process, not as a plugin.
- **Default engine: Piper (VITS) via `sherpa-onnx-node`** — 52–65 ms/sentence measured, no
  node-gyp, prebuilt binaries. `say` is the never-fails fallback only (its *empty-string spawn*
  costs 414 ms). **Kokoro is a trap**: measured 16–25× slower than Piper, int8 slower than FP32.
- **One dependency, `sherpa-onnx-node`, covers TTS + future STT + VAD + keyword spotting.**
- **No preinstalled macOS binary accepts streaming PCM on stdin.** `afplay` refuses it and gives a
  ~970 ms inter-sentence gap. The ways out are Web Audio in a renderer, a bundled sidecar, or a
  Homebrew dependency we cannot assume. **This is the sharpest constraint in the project.**
- **Barge-in is not "kill the player"** — it must cancel in-flight synthesis *and* flush buffered
  audio, or the synthesizer keeps producing speech for text the user already interrupted.
- **Port buzz's `preprocess_for_tts`** (7 stages, no deps, fully tested) and **add the four rows
  they lack**: headings, lists, tables, file paths. Their own issue #4403 states the target —
  "headings become pauses, list items become sentences, tables are announced by row".
- **Thinking blocks are flattened into text blocks** in ORCA's decoder. Filter at the raw JSONL
  level or huddle mode speaks the model's chain-of-thought aloud.

## Open decisions
- **D001** `docs/.discussion/001-integration-path.md` — plugin+worker-fs vs upstream-into-ORCA vs
  hybrid. Recommendation: hybrid, **conditional on E1/E2**.
- Licensing: Piper voices are GPL-3.0 and espeak-ng is GPL-3.0-or-later. Do not bundle weights.
- Pocket TTS ONNX export is marked non-commercial though upstream is MIT. Opt-in download only.

## Standing rules

`RULES.md` at the repo root. Read it on spawn, with this file and `PITFALLS.md`.

## Where things live
- `docs/.research/` — raw research artifacts (hot). Promote to `docs/` when settled.
- `docs/.discussion/` — open questions with Question + Options + Recommendation + Engineer-prompt bodies.
- `specs/` — speckit-style specs (layout pending speckit-scout's recommendation).

## Next agent picks up from
Read the four research files above, then `docs/.discussion/`.
