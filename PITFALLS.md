# PITFALLS

> Things that bit us, or that we know will bite. Append; newest at top. Each entry:
> **symptom → cause → what to do instead.**
>
> **Numbering:** highest number = newest. Before adding an entry, `grep '^## P' PITFALLS.md` and
> take the next free number — concurrent agents have collided here before (see P12).

## P12 — Two agents appending to PITFALLS.md at once produce duplicate numbers
**Symptom:** the file contains two `## P4`, two `## P5`, two `## P6`, and cross-references become
ambiguous.
**Cause:** parallel subagents each read the file, each took "the next number", and each wrote.
Last-writer-wins on content, but numbers silently collide.
**Instead:** grep for existing numbers immediately before writing, and prefer having the
orchestrator merge subagent findings rather than letting subagents append to shared memory files
directly. Renumbering after the fact is cheap only while the entries are still uncited.

## P11 — Kokoro is 16–25× slower than Piper on Apple Silicon, despite its reputation
**Symptom:** you pick the engine with the best voices-per-megabyte reputation and huddle mode stutters.
**Cause:** measured on this machine (macOS 26.5, Node 26.7, `sherpa-onnx-node` 1.13.6, 2 threads,
one sentence → ~2 s of audio): Piper amy-low **52–65 ms**, Pocket TTS int8 **210–278 ms**, Kokoro
FP32 **838–865 ms**, Kokoro int8 **1306–1358 ms**. Kokoro int8 is *slower* than FP32, reproducing
[hexgrad/kokoro#291](https://github.com/hexgrad/kokoro/issues/291).
**Instead:** default to Piper. Offer Kokoro as a quality option with its latency shown. Full table:
`docs/.research/tts-engine-landscape.md`.

## P10 — macOS `say` costs ~414 ms of process spawn before it makes a sound, and cannot be piped
**Symptom:** the "zero-install fallback" is the slowest path in the system.
**Cause:** `say ""` — empty string, zero synthesis — measured min 414 ms / median 418 ms over 5 runs.
That is 8× the entire Piper synthesis time. Separately, `say -o /dev/stdout` emits **no bytes**: the
CAF/WAVE writers need a seekable file.
**Instead:** use `say` as the never-fails fallback and the first-run bridge while a model downloads,
never as the low-latency path. For streaming on macOS you need `AVSpeechSynthesizer` in a sidecar.

## P9 — No preinstalled macOS binary accepts streaming PCM on stdin
**Symptom:** the design assumes "pipe PCM to the system player" and there isn't one.
**Cause:** `afplay -` → *"unknown argument: -"*; piping a file in → `AudioFileOpen failed ('typ?')`.
`sox`/`play`/`mpv` are absent on a stock system. `ffplay` works (verified: streams raw PCM on
`pipe:0`; `kill()` returns in 1.5 ms) but arrives via Homebrew. On the npm side, `speaker` needs a
node-gyp build *and* has a documented multi-second `end()` hang; `naudiodon` is abandoned (last push
2024-03).
**Instead:** plan for a bundled Swift audio sidecar or Web Audio in an ORCA renderer. Do not plan
around an npm audio-output package.

## P8 — `sherpa-onnx` cannot load models from non-ASCII Windows paths
**Symptom:** TTS works everywhere, then fails for a user named `Björn` or any non-Latin username.
**Cause:** sherpa-onnx 1.12.x cannot open model files under a non-ASCII Windows path. ORCA already
hit this for STT and wrote a workaround: `src/main/speech/model-cache-path.ts:46-66` relocates the
cache under an ASCII shared root (`%PROGRAMDATA%` etc.) as `<root>\Orca\speech-models\<sha256-16>`,
migrating existing files with `.partial` + atomic rename.
**Instead:** if we use sherpa-onnx or onnxruntime, **mirror that logic and its regression test**
(`src/main/speech/model-manager-windows-path.test.ts`). Cross-platform parity is R1; this is the
exact bug that quietly breaks it.

## P7 — `sherpa-onnx-win-x64` is the only Windows build: **no Windows arm64**
**Symptom:** the default engine has no binary on Windows-on-ARM.
**Cause:** ORCA resolves `sherpa-onnx-${process.platform}-${process.arch}` but Windows is x64-only
(`src/main/speech/stt-service.ts:556-577`).
**Instead:** this is a real R1 parity gap, not a theoretical one. Windows arm64 must fall back to
the OS synthesizer (SAPI) and the UI must say why. Decide this in the spec; do not discover it in CI.

## P6 — Editing worker code does NOT hot-reload; the running worker keeps the old code
**Symptom:** you edit `main.mjs`, the watcher fires, nothing changes, and you debug a stale build
for an hour.
**Cause:** `pluginWorkerSpawnSpecsEqual` compares `pluginKey`/`rootDir`/`mainEntry`/
`manifestRevision`/capabilities — where `manifestRevision` is `JSON.stringify(manifest)`
(`plugin-worker-spawn-spec.ts:18,23-41`). **Nothing hashes the worker file.** Both restart paths
skip when specs match (`plugin-worker-manager.ts:89-91`, `plugin-worker-controller.ts:119-131`).
**Instead:** make the dev build script **bump the manifest `version` on every build**, so
`manifestRevision` changes and the worker is re-forked. Alternatives: toggle the plugin off/on, or
wait out the 5-minute idle reap. A TTS plugin is almost entirely worker code, so this is our
single biggest inner-loop risk.

## P5 — A plugin is a directory that is NEVER built at install time
**Symptom:** plugin installs, then fails at runtime on a missing import.
**Cause:** install is `git clone --depth 1` then a recursive copy filtering only `.git`
(`plugin-git-repository.ts:33-41`, `plugin-install-staging.ts:165-174`). **No `npm install`, no
compile, ever.** There is no plugin SDK, no scaffolding CLI, no published types package, and the
`orca` CLI has no plugin subcommand.
**Instead:** commit runnable ESM on the published ref. Bundle TypeScript + all deps into a single
`main.mjs` (esbuild/rollup). Must default-export the activate function.

## P4 — Hard caps: 2,000 files and 50 MB per plugin
**Symptom:** plugin refuses to install after you commit `node_modules`.
**Cause:** `MAX_PLUGIN_FILES = 2_000`, `MAX_PLUGIN_TOTAL_BYTES = 50 * 1024 * 1024`
(`plugin-content-hash.ts:15-16`). A typical `node_modules` blows the file count instantly.
**Instead:** bundle to one file. And **a neural voice model cannot ship inside the plugin** — 50 MB
is at or below one decent voice. Models download at runtime into a cache **outside** the immutable,
content-hash-verified install tree, mirroring `src/main/speech/model-manager.ts`.

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
**Instead:** **we hand-maintain `.specify/memory/constitution.md` and never run that command.**
A banner at the top of the file says so. If you want it regenerated, copy the file aside first —
v1.0.0 encodes the user's R1-R9 requirements and nine principles that took a full research phase
to derive. Keep the *reasons* behind principles in `docs/.discussion/`, not only in the constitution.

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
