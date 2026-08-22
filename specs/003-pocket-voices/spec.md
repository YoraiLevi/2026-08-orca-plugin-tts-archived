# Feature Specification: Pocket TTS voices

**Feature Branch**: `003-pocket-voices`

**Created**: 2026-08-22

**Status**: Draft — spec gate for the author's outstanding request

**Input**: the author, 2026-08-22 — *"the 'Which voice' shall support the tts voices just like buzz
uses instead of the bultin sapi ones"* and *"i want to have similar system to buzz"*. Primary
sources read for this spec: `~/.buzz/REPOS/buzz/crates/buzz-voice/src/pocket*.rs`,
`desktop/src-tauri/src/huddle/{models.rs,tts_voice_registry.rs,tts_settings.rs}`, and
`KevinAHM/pocket-tts-onnx`'s reference `pocket_tts_onnx.py`. Constraints from
`.specify/memory/constitution.md` R1/R3/R3.4, `PITFALLS.md` P31.

---

## 0. What this document is, and why it exists now

**The author is blocked on this to review the product.** Every other open gate in the project is
waiting on *him* — the taste defaults (C7), the D002 Q5 policy (G4). Those do not block
development; this does block him. It is therefore the critical path, and the ordering in
`plan.md` follows from that and from nothing else.

The Voice Lab currently offers the operating system's voices. On macOS that is `say`, on Windows
SAPI, on Linux espeak-ng. buzz offers twelve neural voices from a local model and the difference is
not subtle. Judging the product's speech on SAPI is judging the wrong artifact.

**What this is not.** Not a replacement for the OS synthesizer, not a change to the normalizer, not
a decision about which voice is the default. The OS backend stays and stays working; this adds a
second one beside it, and which voice to use remains the listener's.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Hear a neural voice in the Voice Lab (Priority: P1) 🎯

The listener opens the Lab, opens **Which voice**, and sees the twelve Pocket voices listed beside
the system voices. He picks *Eve*, presses Play, and hears the fixture in that voice. He picks
*Michael* and hears the same fixture in a different one.

**Why this priority**: it is the entire request. Nothing else in this feature matters if this does
not happen.

**Independent test**: with the model present, `POST /speak` with `voice: "pocket:eve"` returns audio
that differs from the same text at `voice: "pocket:michael"`, and both differ from the OS voice.

**Acceptance**:
1. **Given** the model is downloaded, **when** the voice list is fetched, **then** it contains
   twelve `pocket:*` entries and the system voices, each labelled by backend.
2. **Given** a Pocket voice is selected, **when** a fixture is played, **then** the audio is
   produced by Pocket TTS and is byte-different from the same fixture at another Pocket voice.
3. **Given** a Pocket voice is selected, **when** the same text is played twice, **then** the
   second play is served from the Lab's cache and opens no synthesizer.

---

### User Story 2 — The model arrives without leaving the page (Priority: P1)

On a machine that has never run this, the Pocket voices are visible but marked as needing a
download. The listener presses one button, sees progress, and the voices become usable. He is never
sent to a terminal, a README, or a config file.

**Why this priority**: *"don't scatter me around to edit config files locally"* was the author's
complaint about the last thing that asked him to leave the page. A feature that requires a manual
`curl` repeats it.

**Independent test**: with an empty model directory, the Lab reports `absent` and names what is
missing; after `POST /model/download`, `modelStatus` reports `ready`.

**Acceptance**:
1. **Given** no model, **when** the page loads, **then** the Pocket voices appear with an honest
   label saying they need a ~166 MB download, and the OS voices still work.
2. **Given** a download in progress, **when** the listener watches, **then** progress is reported
   per file, not as an unmoving bar.
3. **Given** a download that fails or is interrupted, **when** it is retried, **then** any
   previously working model is still intact and the failure names the file and the reason.

---

### User Story 3 — Neither backend can silently become the other (Priority: P2)

A voice the listener chose is the voice he gets. If the chosen backend cannot run — the model is
absent, `onnxruntime-node` is not installed, the platform has no binary — the system says so and
falls back **audibly and by name**, never quietly.

**Why this priority**: P18's shape, and the reason the provider registry already carries named
rejection reasons. A substitution nobody announced is indistinguishable from a bug in the voice.

**Independent test**: with `onnxruntime-node` absent, the Pocket provider's `prepare()` fails with
a named reason, the registry reports `prepare-failed` naming it, and the OS provider serves.

**Acceptance**:
1. **Given** the Pocket backend is unavailable, **when** a `pocket:*` voice is requested, **then**
   the failure names the cause and the caller can distinguish it from "that voice does not exist".
2. **Given** a settings file written before backends existed (`"voice": "Alex"`), **when** it is
   read, **then** it still resolves to the OS voice `Alex` and nothing is rewritten.
3. **Given** a preference list spanning backends, **when** one backend is running, **then** the
   first preference that backend can honour is used, and `null` — not a guess — when none can be.

---

### User Story 4 — Per-agent voices become worth having (Priority: P3)

With twelve distinct neural voices available, M15's "you can tell who is speaking without being
told" becomes achievable. This story does not implement M15; it records that this feature is what
makes M15's perceptual half plausible, and that M15 must consume the backend-qualified key.

**Independent test**: `identityFor()` assigns from the available list regardless of backend.

---

## Requirements *(mandatory)*

### Functional — the engine

- **PV-FR-001** The engine MUST run Pocket TTS's five ONNX graphs — `mimi_encoder`,
  `text_conditioner`, `flow_lm_main`, `flow_lm_flow`, `mimi_decoder` — from Node.
  *Verification*: a spike already does this; the test is the STT round-trip of PV-FR-004.
- **PV-FR-002** Text MUST be tokenized identically to the reference SentencePiece.
  *Verification*: `sentencepiece.test.ts`, id-for-id against Python vectors. **Done.**
- **PV-FR-003** A reference clip MUST be band-limited before decimation to the model's rate.
  *Verification*: `audio.test.ts` measures a 14 kHz tone and asserts no 10 kHz alias, with a
  control proving naive decimation aliases. **Done.**
- **PV-FR-004** Synthesized audio MUST say the words that were asked for.
  *Verification*: **an independent STT model transcribes the output and the expected value is the
  input text.** This is the oracle for the whole engine; nothing weaker distinguishes correct
  speech from confident nonsense.
- **PV-FR-005** Generation MUST be deterministic given a seed, so a regression is a comparison
  rather than a judgement.
  *Verification*: two runs at one seed produce identical samples; two seeds produce different ones.
- **PV-FR-006** The voice conditioning state MUST be computed once per voice and reused.
  *Verification*: the second use of a voice performs no `mimi_encoder` run `[measured-here]`.
- **PV-FR-007** Long text MUST be split at the bundle's `max_token_per_chunk` (50) on sentence
  boundaries, and the concatenation MUST be the whole text.
  *Verification*: a chunked input's decoded segments rejoin to the prepared prompt.

### Functional — distribution

- **PV-FR-010** No model weight may be part of the shipped artifact.
  *Verification*: `pnpm size-gate` stays green; the manifest lives in code, the bytes do not.
- **PV-FR-011** Every artifact MUST be pinned by revision, digest AND length.
  *Verification*: `models.test.ts` asserts a 40-hex revision, no `/main/` in any URL, and the
  vendored tokenizer's bytes against its manifest entry. **Done.**
- **PV-FR-012** A failed download MUST leave any existing model intact.
  *Verification*: `models.test.ts` starts ready, fails a download, asserts still ready. **Done.**
- **PV-FR-013** Attribution MUST travel with the bytes (CC-BY-4.0).
  *Verification*: `MODEL_LICENSE.txt` and `LICENSE` are in `requiredFiles()`. **Done.**
- **PV-FR-014** The twelve reference clips MUST be fetched too, and pinned the same way.
  *Verification*: the same length-and-digest refusal path covers them.

### Functional — the seam and the surface

- **PV-FR-020** The Pocket engine MUST be exposed as a `TtsProvider`, emitting audio and never
  owning playback (constitution R023).
- **PV-FR-021** `onnxruntime-node` MUST be optional. Its absence MUST degrade to the OS backend
  with a named reason, never a crash and never silence.
  *Verification*: a test loads the provider with the import forced to fail and asserts the named
  reason reaches the registry.
- **PV-FR-022** `capabilities` MUST report `needsModelDownload` as the real byte count, `offline`
  true, `needsApiKey` false, `cloning` true, and the CC-BY-4.0 licence string.
- **PV-FR-023** `GET /voices` MUST return backend-qualified keys with display names and the
  backend's availability, so the page can render an honest list without guessing.
- **PV-FR-024** The Lab's **Which voice** control MUST list both backends in one `<select>`,
  grouped by backend, and MUST remain a wired control under U1's definition — moving it changes
  what would be synthesized.
- **PV-FR-025** A voice that needs a download MUST be selectable and MUST say so rather than being
  hidden or silently disabled.

### Non-functional

- **PV-NFR-001 Latency.** First audio for a one-sentence utterance MUST stay inside the Voice Lab's
  existing p95 1,690 ms gate on the author's machine. *Spike measured 566 ms total for 3.04 s of
  audio, 0.19× realtime `[measured-here]`.*
- **PV-NFR-002 Silence.** No test and no page load may open an audio device (P31).
- **PV-NFR-003 Parity.** The engine MUST NOT be macOS-only. Where a platform cannot run it, that
  is reported by name, not assumed.
- **PV-NFR-004 The author's machine is not a build server.** Nothing here may write into
  `~/.buzz/`, ORCA's install, or the author's real config. `ORCA_TTS_MODEL_DIR` exists for this.

---

## Key entities

- **Backend** — `os` or `pocket`. A namespace for voice names, and the unit of availability.
- **Voice key** — `backend:voice`. A bare name is `os:` by construction, so old settings survive.
- **Reference clip** — for Pocket, a voice *is* a ~10 s WAV. Adding a voice means adding a file.
- **Voice state** — the flow-LM state after conditioning on a clip. Expensive, cacheable, and the
  reason a second utterance in the same voice is cheap.
- **Model directory** — a cache, not an install. Absent is a normal state, not an error.

---

## Out of scope

- Choosing the default voice. That is the listener's, like every other taste value (P23).
- Non-English bundles. The manifest pins `english_2026-04`; others exist and are not this feature.
- Voice cloning from the listener's own recordings. The mechanism supports it; the surface for it
  is a separate feature.
- Replacing the OS backend, on any platform, for any reason.
- M15's assignment policy. This feature makes it worth doing; it does not do it.

---

## The falsifier

If, with the model present, a Pocket voice cannot be selected and heard from the Voice Lab page
without touching a file, a terminal, or a rebuild — this feature is not done, whatever the tests
say.
