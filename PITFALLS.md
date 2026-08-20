# PITFALLS

> Things that bit us, or that we know will bite. Append; newest at top. Each entry:
> **symptom → cause → what to do instead.**

## P6 — Kokoro is 16–25× slower than Piper on Apple Silicon, despite its reputation
**Symptom:** you pick the engine with the best voices-per-megabyte reputation and huddle mode stutters.
**Cause:** measured on this machine (macOS 26.5, Node 26.7, `sherpa-onnx-node` 1.13.6, 2 threads,
one sentence → ~2 s of audio): Piper amy-low **52–65 ms**, Pocket TTS int8 **210–278 ms**, Kokoro
FP32 **838–865 ms**, Kokoro int8 **1306–1358 ms**. Kokoro int8 is *slower* than FP32, reproducing
[hexgrad/kokoro#291](https://github.com/hexgrad/kokoro/issues/291).
**Instead:** default to Piper. Offer Kokoro as a quality option with its latency shown. Full table:
`docs/.research/tts-engine-landscape.md`.

## P5 — macOS `say` costs ~414 ms of process spawn before it makes a sound, and cannot be piped
**Symptom:** the "zero-install fallback" is the slowest path in the system.
**Cause:** `say ""` — empty string, zero synthesis — measured min 414 ms / median 418 ms over 5 runs.
That is 8× the entire Piper synthesis time. Separately, `say -o /dev/stdout` emits **no bytes**: the
CAF/WAVE writers need a seekable file.
**Instead:** use `say` as the never-fails fallback and the first-run bridge while a model downloads,
never as the low-latency path. For streaming on macOS you need `AVSpeechSynthesizer` in a sidecar.

## P4 — No preinstalled macOS binary accepts streaming PCM on stdin
**Symptom:** the design assumes "pipe PCM to the system player" and there isn't one.
**Cause:** `afplay -` → *"unknown argument: -"*; piping a file in → `AudioFileOpen failed ('typ?')`.
`sox`/`play`/`mpv` are absent on a stock system. `ffplay` works (verified: streams raw PCM on
`pipe:0`; `kill()` returns in 1.5 ms) but arrives via Homebrew. On the npm side, `speaker` needs a
node-gyp build *and* has a documented multi-second `end()` hang; `naudiodon` is abandoned (last push
2024-03).
**Instead:** plan for a bundled Swift audio sidecar or Web Audio in an ORCA renderer. Do not plan
around an npm audio-output package.

## P3 — Spec Kit command names are `speckit-*`, not `speckit.*`
**Symptom:** docs and the spec-kit README show `/speckit.constitution`; typing that does nothing.
**Cause:** the Claude Code integration installs them as *skills* under `.claude/skills/speckit-<name>/`,
and skill names can't contain dots.
**Instead:** use `/speckit-constitution`, `/speckit-specify`, `/speckit-clarify`, `/speckit-plan`,
`/speckit-tasks`, `/speckit-checklist`, `/speckit-analyze`, `/speckit-implement`, `/speckit-converge`,
`/speckit-taskstoissues`. Verified by `ls .claude/skills/` at v0.16.5, 2026-08-20.

## P2 — `/speckit-constitution` overwrites the constitution wholesale
**Symptom:** hand-written principles vanish after re-running the command.
**Cause:** the command regenerates `.specify/memory/constitution.md` from the template each run.
**Instead:** treat that file as generated. Commit before running it. Keep the *reasons* behind
principles in `docs/.discussion/`, not only in the constitution.

## P1 — Search skills write to a repo-root `.research/`, not `docs/.research/`
**Symptom:** untracked scrape JSON appears at the repo root and pollutes `git status`.
**Cause:** `duckduckgo-search` / `web-scraper` / `github-search` hardcode `.research/prior-art-search/`.
**Instead:** `/.research/` is gitignored. Curated research belongs in `docs/.research/` (written
by hand); the root folder is regenerable scratch and may be deleted freely.

## P0 — Do not trust a plugin-API claim that has no `file:line`
**Symptom:** a design built on an ORCA hook that doesn't exist.
**Cause:** plausible-sounding API surfaces are easy to hallucinate; ORCA is young and moves.
**Instead:** every claim about ORCA's plugin API in our specs cites `path/file.ts:123` at a
recorded commit SHA. If a scout says "inferred", it is not a foundation — verify before designing on it.
