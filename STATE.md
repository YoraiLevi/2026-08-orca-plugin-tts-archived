# STATE — orca-plugin-tts

**Updated:** 2026-08-20 · **Phase:** 0 (research) → closing · **Branch:** `main` · **Nothing implemented yet.**

## One-paragraph status

A TTS plugin for ORCA, for a dyslexic voice-first operator. Five research agents have finished or
are finishing; the ORCA plugin API has been both source-read and **empirically probed inside a real
running ORCA build**. The architecture is nearly decided and waits on one measurement (E6: can a
plugin panel play raw PCM through Web Audio?). The constitution is written and ratified at v1.0.0.
No specs, no code, no tests, no CI yet.

## Phase status

| Phase | State | Artifact |
|---|---|---|
| 0. Research | **complete except E6/E7** | `docs/.research/*.md` (6 files) |
| 0.5 Constitution | **complete, v1.0.0** | `.specify/memory/constitution.md` |
| 1. Spec (`001-speak-selection`) | not started | blocked on D001 |
| 2. Plan / class design | not started | blocked on spec |
| 3. FMA | not started | |
| 4. Tests | not started | |
| 5. Implementation | not started | |
| 6. CI (3 OSes) | not started | R4 |
| 7. Publish public repo | not started | R5, gated on green CI |

## Decisions locked

- **Spec Kit adopted, partially.** Artifacts and templates yes; extensions, presets, issue-sync and
  branch hooks no. Installed at v0.16.5. Commands are `/speckit-*` (hyphen).
- **Constitution is hand-maintained.** Never run `/speckit-constitution`. (PITFALLS P2.)
- **Default engine: Piper via `sherpa-onnx-node`** (52–65 ms/sentence measured). `say` is the
  never-fails fallback. Kokoro rejected on measurement (16–25× slower). Cloud is opt-in only.
- **One dependency (`sherpa-onnx-node`) covers TTS + future STT + VAD + keyword spotting.**
- **Provider seam before the first engine.** Providers emit PCM and never own playback.
- **Models download at runtime**, never bundled — the plugin has a hard 50 MB / 2,000-file cap.

## Decisions open

- **D001 — integration path.** `docs/.discussion/001-integration-path.md`. Recommendation: hybrid
  (ship a plugin, upstream the missing primitives). **Resolvable as soon as E6 lands.**
- Licensing: Piper voices are GPL-3.0, espeak-ng GPL-3.0-or-later. Do not bundle weights. Plugin
  licence undecided.
- Whether "speak selection" ships as speak-the-clipboard, speak-the-last-reply, or waits on an
  upstream `selection:read`. **No option reads a real editor selection today.**
- Windows arm64 has no sherpa build (PITFALLS P7) — parity gap needs an explicit spec decision.

## What is measured, not assumed

- Plugin worker Node access: **unrestricted** (fs, child_process, net, fetch; no permission model).
- `speechSynthesis` in a panel: **works**, 180 voices, zero CSP violations.
- `<audio>` in a panel: **blocked** by `media-src` for both `data:` and `blob:`.
- `paneKey` carries no session id; `worktreeId` carries the absolute worktree path.
- Worker code does not hot-reload; keybindings in the manifest force re-consent on every edit.
- Plugin logs: 200-line in-memory ring buffer, **no file on disk**.

## Next action

1. Read E6/E7 in `docs/.research/orca-empirical-findings.md`.
2. Resolve D001 and record the resolution in that file.
3. Write `specs/001-*/spec.md` from the Spec Kit template, then plan → FMA → tests.

## Reading order for a new agent

`HANDOFF.md` → `PITFALLS.md` → `.specify/memory/constitution.md` →
`docs/.research/orca-empirical-findings.md` → `docs/.research/orca-plugin-api.md` →
`docs/.discussion/001-integration-path.md`. The other research files are reference, read on demand.
