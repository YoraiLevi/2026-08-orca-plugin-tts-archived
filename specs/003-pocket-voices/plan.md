# Implementation Plan: Pocket TTS voices

**Branch**: `003-pocket-voices` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

---

## Summary

Add a second speech backend — Kyutai's Pocket TTS, run as ONNX from Node — beside the OS
synthesizer, so the listener can judge the product on the voices it will actually ship with rather
than on SAPI. Twelve neural voices, downloaded on first use, selectable from the Voice Lab.

**Primary requirement**: PV-FR-004 — the audio says the words. Everything else is plumbing around
that, and it is the only requirement whose failure mode is silent.

**Approach**: mirror buzz's structure, because it is a solved problem and the author asked for
buzz's system by name. Pinned manifest, cache directory, atomic download, backend-qualified voice
keys, per-backend fallback. The inference loop is ported from the reference Python and verified by
transcribing its output with an unrelated model.

---

## Ordering, and why it is what it is

**The author is blocked on this to review the product; the other open gates are blocked on him.**
That inverts the usual ordering. It is not "finish the milestone list, then let him look" — it is
*get him to a state where he can judge speech, then finish the milestone list*. Concretely:

1. **PV Phase 1–4** (this feature, to a hearable state) — because he cannot review without it.
2. **M16 presence**, then **M15 voices** — M15 is worth far more with twelve distinct voices than
   with the OS list, so this feature ordering also improves that one.
3. **The gates waiting on him** (C7 taste, G4 policy) — whenever he answers, in parallel with
   anything.
4. **G9/G10** — the mutation survivor, the INCONCLUSIVE question, a green hosted run.

Nothing in 2–4 blocks 1, and 1 blocks him. So 1 is first and is not interleaved.

---

## Technical Context

**Language/Version**: TypeScript, same as the rest of `packages/`. The engine is pure TS over
typed arrays; the only native surface is ONNX Runtime.

**Primary dependency**: `onnxruntime-node` 1.27.0, **optional**. It ships prebuilt binaries per
platform and arch. Making it optional is what keeps R1 (cross-platform parity) and R3
(third-party installable) honest: a machine without it loses a backend, not the plugin.

**Model**: `KevinAHM/pocket-tts-onnx` at `58a6d00c…`, bundle `english_2026-04`, 165,232,420 bytes
across eight files, INT8 for the two flow-LM graphs and the Mimi decoder. CC-BY-4.0.

**Storage**: a cache directory per platform, overridable by `ORCA_TTS_MODEL_DIR`. Never the
plugin artifact — `size-gate` must stay green without special-casing.

**Testing**: vitest, as everywhere. Three tiers, deliberately separated:
- **pure** — tokenizer, formats, resampler, manifest. No model, no ONNX. Runs in CI on all three.
- **engine** — needs the model on disk. Skipped by default, run by an explicit env var.
- **surface** — `scripts/ui-probe.mjs`, drives the real page.

**Performance target**: PV-NFR-001, the existing p95 1,690 ms Lab gate. The spike measured
566 ms for 3.04 s of audio `[measured-here]`, so the budget is not the risk; contention is.

---

## Constitution check

| Principle | How this complies |
|---|---|
| R1 cross-platform parity | ORT ships all three; where it cannot, the backend reports absent by name rather than the plugin failing. |
| R3 third-party installable | Nothing added to the artifact. The model is a cache the user's machine fetches. |
| R3.4 no account, no key, no network at speech time | Download once; synthesis is fully local and offline thereafter. |
| R023 providers never own playback | `generate()` yields `AudioChunk`; the browser and the plugin play. |
| Principle V tests first | Every phase below has its verify line before its build line. |
| P31 no audio without opt-in | Tests write files; nothing opens a device. |
| P23 the listener settles taste | This ships the option space and no default preference. |

**No violations.** The one judgement call is making ORT optional rather than required, and it is
recorded in the spec as PV-FR-021 with its own test.

---

## Risks, in the order they are likely to bite

1. **The loop is subtly wrong and the audio sounds fine.** The whole reason PV-FR-004's oracle is
   an unrelated STT model rather than a byte comparison. *Mitigation: transcribe, with a control.*
2. **Contention, not budget, misses the gate.** A neural model on a loaded machine is P40/P43
   territory. *Mitigation: every latency number carries its load average, as the project already
   requires.*
3. **`onnxruntime-node` on Windows/Linux CI.** Unverified there. *Mitigation: the optional path is
   tested first, so an ORT that will not load is a named degradation rather than a red suite.*
4. **The download is 166 MB of someone else's bandwidth.** *Mitigation: never automatic, always a
   pressed button, always with the size stated first.*
5. **Twelve reference clips are not in the pinned manifest yet.** They are fetched from a different
   repo than the model. *Mitigation: PV-FR-014 — pin them the same way before shipping the picker.*

---

## Phases

| Phase | Delivers | Hearable? |
|---|---|---|
| 0 | ✅ tokenizer, formats, resampler, manifest, voice keys | no |
| 1 | the engine in-repo, with the STT oracle | no |
| 2 | `PocketSynthProvider`, optional ORT, named degradation | no |
| 3 | `/voices` and `/model/*` on the Lab server | no |
| 4 | **the picker in the page — the author can hear it** | **yes** |
| 5 | reference-clip pinning, latency measurement, CI decision | yes |

Phase 4 is the falsifier. Phases 0–3 are worth nothing to the author until it lands, which is why
none of them may be allowed to expand.

---

## Structure

```
packages/providers/src/pocket-synth/
  sentencepiece.ts      ✅  unigram encoder, oracle-checked
  audio.ts              ✅  npy · wav · resample
  models.ts             ✅  manifest · status · atomic download
  voices.ts             ✅  backend keys · twelve presets · resolution
  engine.ts             ⬜  the five graphs and the frame loop
  index.ts              ⬜  PocketSynthProvider
  model/                ✅  vendored tokenizer + licence + attribution
scripts/
  voice-lab.mjs         ⬜  /voices gains backends; /model/{status,download}
  pocket-e2e.mjs        ⬜  the STT oracle, run on demand
voice-lab/
  index.html            ⬜  the voice picker, grouped, with the download button
```
