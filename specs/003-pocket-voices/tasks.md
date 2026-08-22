---
description: "Executable task breakdown for Pocket TTS voices"
---

# Tasks: Pocket TTS voices

**Input**: `specs/003-pocket-voices/spec.md`, `specs/003-pocket-voices/plan.md`

**Prerequisites**: `.specify/memory/constitution.md`, `PITFALLS.md` (P18, P23, P31, P40, P41, P43).

**Tests**: required. Constitution principle V is NON-NEGOTIABLE — tests are written before
implementation and must fail first.

**Task ids**: `PV-nnn`, so they never collide with `T1nn` in `docs/TASKS.md` or `VL-nnn` in
`specs/002-voice-lab/tasks.md`.

## Format: `[ID] [P?] [Story] Description`

- **[P]** — may run in parallel (different files, no dependency)
- **[Story]** — US1 · US2 · US3 · US4, or `FOUND`
- Every task carries a **Verify** line. **A task whose verify line could not fail is not done**
  (R003, P33, P47).

---

## Phase 0: Foundations — DONE

Landed 2026-08-22 at `b7b2e3e`, `cc8c647`, `dc710e0`. Listed so the breakdown is complete, not
because there is work here.

- [x] **PV-001** [FOUND] SentencePiece unigram encoder → `pocket-synth/sentencepiece.ts`.
      **Verify**: 24 vectors from Python `sentencepiece`, id-for-id. Found two real defects.
- [x] **PV-002** [FOUND] `.npy`, WAV read/write, windowed-sinc resampler → `pocket-synth/audio.ts`.
      **Verify**: a 14 kHz tone produces no 10 kHz alias, with a control proving naive decimation
      does. A 1 kHz tone survives at full amplitude.
- [x] **PV-003** [FOUND] Pinned manifest, `modelStatus`, atomic `downloadModel` →
      `pocket-synth/models.ts`.
      **Verify**: a failed download leaves a ready cache ready; the vendored tokenizer's bytes
      match its manifest digest.
- [x] **PV-004** [FOUND] Backend-qualified voice keys and the twelve presets →
      `pocket-synth/voices.ts`.
      **Verify**: a bare `"Alex"` resolves as `os:Alex`; unresolvable returns `null`, never a guess.

**Checkpoint 0**: 860 tests green, nothing user-visible, no model needed to run any of it.

---

## Phase 1: The engine (Blocking — US1 cannot start without it)

**Purpose**: text and a voice in, correct audio out, in this repo, with an oracle.

- [x] **PV-010** [US1] Write the end-to-end oracle FIRST → `scripts/pocket-e2e.mjs`. It synthesizes
      a known sentence and transcribes the result with an independent STT model, asserting the
      transcript against the INPUT TEXT.
      **Verify**: run it against a deliberately corrupted engine (e.g. skip the flow integration
      step) and confirm the transcript no longer matches. **Write this before PV-011 and watch it
      fail for the right reason.**
      *Note: proven viable — the spike's output transcribed exactly, with a control showing the
      reference clip transcribes to different words.*

- [x] **PV-011** [US1] Port the engine → `pocket-synth/engine.ts`: state init from the bundle
      manifests, voice conditioning, text conditioning, the per-frame flow loop with the EOS
      logit rule, and batched Mimi decoding.
      **Verify**: PV-010 passes. Then break the NaN state fill to zeros and confirm PV-010 fails —
      the `fill` field is load-bearing and a zero-filled cache produces plausible wrong audio.

- [x] **PV-012** [P] [US1] Seeded RNG for the latent sampling.
      **Verify**: same seed twice → identical samples; two seeds → different. Without this every
      later regression is a judgement call.

- [x] **PV-013** [P] [US1] Chunk splitting at `max_token_per_chunk`.
      **Verify**: a 300-token input splits, and the decoded segments rejoin to the prepared prompt
      exactly. Feed a single 60-token sentence with no boundary and confirm it does not silently
      truncate.

- [x] **PV-014** [US1] Voice-state cache.
      **Verify**: instrument `mimi_encoder` calls; the second use of a voice makes zero
      `[measured-here]`. Spike showed 746 ms → 7 ms.

- [x] **PV-015** [P] [US1] Engine tests gated behind `POCKET_MODEL_DIR`, skipped by default with a
      printed reason.
      **Verify**: `pnpm test` on a machine with no model stays green and SAYS the tier was skipped.
      A silent skip is P42's shape.

**Checkpoint 1 — PASSED** 2026-08-22 at `96db064` / `5a3dd6c`.

```
[  ok  ] CONTROL B  silence transcribes to ""
[  ok  ] CONTROL A  the reference clip says something else (WER 3.78)
  synthesized 3.04 s in 758 ms (0.25x realtime) [measured-here]
[  ok  ] PV-010     our audio says what we asked (WER 0.00, gate 0.25)
[  ok  ] PV-010     went RED when the recurrent state is zero-filled (WER 0.67)
                    heard "The quick brown fox jumps over the qu brown fox jumps over the lazy dog."
```

The broken arm is the important line: plausible speech, stuttering, saying the wrong thing — the
exact failure this oracle exists for, demonstrated rather than asserted. Still nothing the author
can hear; that is Phase 4.

---

## Phase 2: The provider seam

**Purpose**: make it a `TtsProvider`, and make its absence a sentence rather than a crash.

- [ ] **PV-020** [US3] Write the degradation test FIRST: load the provider with the ORT import
      forced to fail, assert `prepare()` rejects with a named reason and the registry reports
      `prepare-failed` naming `pocket`.
      **Verify**: it fails before PV-021 exists, and the message names the missing module rather
      than saying "provider unavailable".

- [ ] **PV-021** [US3] `PocketSynthProvider` → `pocket-synth/index.ts`, with a LAZY dynamic import
      of `onnxruntime-node` so the module can be imported on a machine that lacks it.
      **Verify**: PV-020 passes; and `import('./pocket-synth/index.js')` succeeds with ORT absent.

- [ ] **PV-022** [P] [US3] `capabilities`: `needsModelDownload` = the real byte total, `offline`
      true, `needsApiKey` false, `cloning` true, licence CC-BY-4.0.
      **Verify**: a test asserts `needsModelDownload` equals `MODEL_TOTAL_BYTES` rather than a
      literal — a hand-typed number drifts from the manifest silently.

- [ ] **PV-023** [US3] `generate()` yields `AudioChunk`s and opens no player (R023).
      **Verify**: the no-audio recorder (`scripts/ci/no-audio-recorder.mjs`) stays green across a
      full synthesis, and goes red if a player is spawned.

- [ ] **PV-024** [P] [US3] `cancel()` is two-sided and awaited (R022 / 006 C6).
      **Verify**: cancel mid-utterance; assert the frame loop stopped, by effect, within the
      existing cancel budget. Add it to `scripts/mutation-check.mjs` as a declared mutant.

- [ ] **PV-025** [US3] Register beside the OS provider; OS stays preferred.
      **Verify**: with both registered and no explicit preference, the OS provider serves — this
      feature must not change what anybody hears by default.

**Checkpoint 2**: `pnpm test` green with and without ORT installed. Mutation count grows by the
declared mutants and by nothing else (P24's shape, applied to the registry).

---

## Phase 3: The server

**Purpose**: the page needs to know what exists and be able to ask for the download.

- [ ] **PV-030** [US1] `GET /voices` returns backend-qualified entries: `key`, `displayName`,
      `backend`, and the backend's availability with its reason when absent.
      **Verify**: the OS shape is unchanged for OS voices (the Lab's existing voice control must
      not regress), and a `pocket` entry appears with `available: false` when no model is present.

- [ ] **PV-031** [P] [US2] `GET /model/status` → `modelStatus()`, naming missing files.
      **Verify**: an empty directory reports `absent` and lists `mimi_encoder.onnx` by name.

- [ ] **PV-032** [US2] `POST /model/download` streams NDJSON progress, one record per file.
      **Verify**: a fixture-backed fetch produces one progress record per artifact in order, and
      an induced failure yields a terminal record naming the file and the cause — never a stream
      that just stops.

- [ ] **PV-033** [P] [US2] Refuse to start a second concurrent download.
      **Verify**: two overlapping requests; the second is refused by name, and the first still
      completes. Two writers racing an atomic swap is how a half-model gets published.

**Checkpoint 3**: every endpoint answerable by `curl`, with no page yet.

---

## Phase 4: The picker — THE FALSIFIER 🎯

**Purpose**: the author opens the page and hears a neural voice. Until this lands, phases 0–3 are
worth nothing to him.

- [ ] **PV-040** [US1] **Which voice** becomes one `<select>` with two `<optgroup>`s — *This
      machine's voices* and *Pocket TTS (neural)* — carrying backend-qualified values.
      **Verify**: `scripts/ui-probe.mjs` U1 must still pass, i.e. moving this control must still
      change what would be synthesized. Extend the probe's breakage list with "drop the optgroup
      wiring" and confirm U1 goes red.

- [ ] **PV-041** [US2] When the model is absent, the Pocket group renders selectable options
      labelled with the download size, and a **Download the neural voices (166 MB)** button
      appears beside the control.
      **Verify**: with an empty `ORCA_TTS_MODEL_DIR`, the probe finds the button and the honest
      label; with a model present, neither appears.

- [ ] **PV-042** [US2] The button streams progress into the page and enables the voices on
      completion, without a reload.
      **Verify**: drive it in the probe against a stubbed server; assert the voice list gains
      twelve entries with no navigation.

- [ ] **PV-043** [P] [US1] Selecting a Pocket voice invalidates the audio cache keyed by
      `keyFor(text, synth)` (FR-023's rule), so no stale audio is replayed.
      **Verify**: play, switch backend, play the same text; assert a `/speak` request was made.
      This is the exact bug FR-023 already caught once — 41 ms and confidently wrong.

- [ ] **PV-044** [US1] The footer's provenance line names the backend and voice actually used.
      **Verify**: the rendered text changes with the backend. `provenance.tunedWith` in the
      exported settings must follow it, or a settings file records a voice that never spoke.

**Checkpoint 4 — the falsifier**: with the model present, the author selects *Eve*, presses Play,
and hears it. No file, no terminal, no rebuild. **If this is not true, this feature is not done.**

---

## Phase 4b: Round 14's criticals — UNPLANNED, and the plan was wrong to omit them

Round 14 found ten defects in Phase 0-3, three critical. They are recorded as tasks rather than as
commit messages because two of them changed what the phases *mean*: PV-050 turned out to be
load-bearing for Phase 4 rather than an edge, and the delivery of the runtime was missing from the
plan entirely.

- [x] **PV-060** R14-06 — the swap deleted the live model before the fallible rename, and no test
      reached that window (a `throw` there left 20/20 green).
      **Verified**: stage beside the target, back up by rename, swap, discard last. Re-injecting the
      old order turns exactly the two preservation cases red. `db5377e`.
- [x] **PV-061** R14-08 — the upstream CC-BY-4.0 `LICENSE` was fetched best-effort.
      **Verified**: a failed licence fetch now fails the install, with the previous model intact.
- [x] **PV-062** R14-02 — `POCKET_VOICES` named twelve clips and `requiredFiles()` listed none, so
      `modelStatus()` said **ready** over a directory where no voice could load its clip.
      **Verified** by re-running the review's own mutant (rename Eve's file): two cases go red where
      20/20 had stayed green. Manifest bumped 1 → 2. `1c2337f`.
- [x] **PV-063** R14-01 — **no delivery path for the native runtime at all.** `pnpm add` is a
      developer convenience; ORCA never runs `npm install` for a plugin, so every third-party
      install fell back forever. D004 argues it; `runtime.ts` implements it.
      **Verified**: a wrong digest installs nothing; a decoy platform is not extracted; a failed
      replacement keeps a working runtime; `darwin-x64` is `unsupported`, not an error. `aa649af`.
- [x] **PV-064** R14-04 — the tokenizer disagrees with upstream on repeated-letter ties.
      **Confirmed, measured, left OPEN as `it.fails`**: 11,327/11,344 exact, all 17 disagreements
      are runs of one letter, 180/180 on realistic text. Both proposed causes tested and rejected.
      `69bdbba`.
- [ ] **PV-065** R14-04's remedy — port SentencePiece's lattice faithfully (nodes carry their own
      best predecessor; ties resolve by `end_nodes_` insertion order).
      **Verify**: the two `it.fails` rows go GREEN, and the 11,344-input differential corpus reaches
      zero disagreements. **Do not attempt a third guess at a comparison operator** — `>` and `>=`
      have both been measured and neither is it.
- [ ] **PV-066** R14-09 — the resampler suite admits pass-band deletion and edge-normalisation
      removal, and the filter emits a boundary transient.
      **Verify**: each mutation goes red; each new check has a control.
- [ ] **PV-067** R14-03 / R14-10 — the backend key reaches no dispatch, and the falsifier could pass
      from a developer-preseeded cache.
      **Verify**: `POST /speak` with `pocket:eve` is routed by backend and the bare name reaches the
      provider; a preseeded cache is distinguishable from an installed one.

---

## Phase 5: Finish the edges

- [x] **PV-050** [US1] Pin the twelve reference clips by digest and length (PV-FR-014); they come
      from `kyutai/tts-voices`, a different repo from the model.
      **Done as PV-062** — and the plan was wrong to file it here. It is not an edge: without it
      `ready` is a lie and Phase 4 cannot be hearable. R14-02 said so and was right.

- [ ] **PV-051** [US1] Measure the gate with Pocket selected, in a clean detached worktree, load
      average recorded (P41, P43).
      **Verify**: report cold p95, warm p95 and the load average. A number without a load average
      is not a measurement in this project.

- [ ] **PV-052** [P] Decide and record whether ORT installs on Windows and Linux CI, and what the
      job does when it does not.
      **Verify**: a real hosted run, not a local claim (P36 — local green was wrong seven times in
      two hours on 2026-08-21).

- [ ] **PV-053** [P] `docs/design/021-pocket-voices.md`: what buzz does, what we copied, what we
      did differently and why.
      **Verify**: every claim about buzz carries a `file:line` into `~/.buzz/REPOS/buzz` (P0's
      rule, applied to a second codebase).

---

## Dependency graph

```
Phase 0 ✅
   │
   ├─ PV-010 (oracle first) ─→ PV-011 ─┬─ PV-012 [P]
   │                                   ├─ PV-013 [P]
   │                                   ├─ PV-014
   │                                   └─ PV-015 [P]
   │                                        │
   │                          PV-020 (test first) ─→ PV-021 ─┬─ PV-022 [P]
   │                                                          ├─ PV-023
   │                                                          ├─ PV-024 [P]
   │                                                          └─ PV-025
   │                                                               │
   │                                        PV-030 ─┬─ PV-031 [P] ─┴─ PV-032 ─ PV-033 [P]
   │                                                │
   └────────────────────────────────────────────────┴─→ PV-040 ─┬─ PV-041 ─ PV-042
                                                                 ├─ PV-043 [P]
                                                                 └─ PV-044
                                                                      │
                                                        PV-050 · PV-051 · PV-052 [P] · PV-053 [P]
```

**Critical path**: PV-010 → PV-011 → PV-021 → PV-030 → PV-040. Everything else is parallel or
after the falsifier.

---

## What this feature does NOT wait for

Recorded because the author had to correct it once: **the open gates are blocked on him, not the
other way round.** None of the following blocks any task above.

| | |
|---|---|
| C7 taste defaults | his ears, whenever |
| G4 / D002 Q5 policy | his choice, whenever |
| INCONCLUSIVE-in-CI decision | a policy call, unrelated |
| G9 review protocol | rounds, unrelated |

---

## Mapping to the roadmap

| This feature | Roadmap |
|---|---|
| PV-010…PV-015 | new — no prior task covered a second engine |
| PV-020…PV-025 | **T091/T092** ("Piper via sherpa-onnx-node", "Model manager") — same shape, different engine. Those tasks should be re-pointed at Pocket or closed with a reason. |
| PV-040…PV-044 | extends M11's control surface; no new milestone |
| PV-050…PV-053 | **T097c** (quality comparison and latency regression guard) |
