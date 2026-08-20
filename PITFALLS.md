# PITFALLS

> Things that bit us, or that we know will bite. Append; newest at top. Each entry:
> **symptom → cause → what to do instead.**
>
> **Numbering:** highest number = newest. Before adding an entry, `grep '^## P' PITFALLS.md` and
> take the next free number — concurrent agents have collided here before (see P12).

## P16 — "Use the OS's built-in voice" is a two-tier trap, not a zero-install win
**Symptom:** macOS sounds fine in the demo, then Windows and Linux users hear something from 2005.
**Cause:** the three OS-native synths are not one tier. macOS `say` reaches decent Apple voices.
Windows third-party apps are fenced to SAPI 5 `*Desktop` (Zira/David) — Microsoft's own WinRT docs
say *"Only Microsoft-signed voices installed on the system can be used"*, and the maintainer of the
911★ project built to break that fence calls his own work *"more like a hack… can stop working at
any time"*. Linux out of the box is `espeak-ng` formant synthesis, and on a headless box or a GitHub
Actions runner there is **no speech stack at all** (`actions/runner-images` has zero references to
`espeak`, `speech`, `alsa` or `pulseaudio`).
**Instead:** one portable neural engine as the default on all platforms; OS-native only as a
labelled fallback. And do not let "but macOS `say` is pretty good" argue for native-first — the same
argument fails identically on the other two. Verified 2026-08-20.

## P16 — An invalid manifest fails SILENTLY: no plugin, no consent prompt, no error
**Symptom:** added the dev plugin path in Settings, the "Installed" count went up, but no card
appeared, no consent prompt fired, and nothing said why.
**Cause:** our `orca-plugin.json` did not satisfy `pluginManifestSchema`. Three faults:
- `capabilities` were bare strings; the schema is `z.object({ kind: ... }).strict()`
- `engines: { orca: ">=x.y.z" }` missing — **required**, not optional
- `pluginApi: 1` missing — **required**
Also missing `contributes.events`, without which `agent.status.changed` never arrives even with the
`events:subscribe` capability granted.
**Instead:** validate the manifest against the host's own parser before trusting it:
```
npx tsx validate-manifest.mts /path/to/orca-plugin.json   # imports pluginManifestSchema from the orca clone
```
`packages/plugin/src/manifest/manifest.test.ts` now pins the shape in CI so this cannot regress.
**Worth remembering:** I wrote that manifest from research notes and never parsed it. Reading the
schema is not the same as running it — the canonical example at `examples/plugins/hello-orca/` was
sitting right there and would have shown every one of these in ten seconds.

## P15 — Bare Piper `.onnx` files from Hugging Face do not work with sherpa-onnx
**Symptom:** `'sample_rate' does not exist in the metadata` at model load.
**Cause:** `rhasspy/piper-voices` serves `.onnx`/`.onnx.json` directly over HTTP 200, which looks
like a clean archive-free download path. But sherpa's own `tts-models` release tarballs embed extra
ONNX metadata *and* a `tokens.txt` the HF files do not carry.
**Instead:** download sherpa's release assets, or convert and re-host the models yourself. Verified
2026-08-20.

## P16 — An invalid manifest fails SILENTLY: no plugin, no consent prompt, no error
**Symptom:** added the dev plugin path in Settings, the "Installed" count went up, but no card
appeared, no consent prompt fired, and nothing said why.
**Cause:** our `orca-plugin.json` did not satisfy `pluginManifestSchema`. Three faults:
- `capabilities` were bare strings; the schema is `z.object({ kind: ... }).strict()`
- `engines: { orca: ">=x.y.z" }` missing — **required**, not optional
- `pluginApi: 1` missing — **required**
Also missing `contributes.events`, without which `agent.status.changed` never arrives even with the
`events:subscribe` capability granted.
**Instead:** validate the manifest against the host's own parser before trusting it:
```
npx tsx validate-manifest.mts /path/to/orca-plugin.json   # imports pluginManifestSchema from the orca clone
```
`packages/plugin/src/manifest/manifest.test.ts` now pins the shape in CI so this cannot regress.
**Worth remembering:** I wrote that manifest from research notes and never parsed it. Reading the
schema is not the same as running it — the canonical example at `examples/plugins/hello-orca/` was
sitting right there and would have shown every one of these in ten seconds.

## P15 — An unmatched emphasis marker was stripped, mangling `_private` identifiers
**Symptom:** running the pipeline for real, `_flush_buffer()` was spoken as "flush_buffer()".
Not caught by 106 passing tests, because every test case used *matched* markers.
**Cause:** the marker stripper decided "is this an opener?" and "is this a closer?" independently,
so a lone leading `_` looked like an opener and was dropped with no partner. Python privates are
everywhere in agent replies.
**Instead:** markers are now stripped only as a MATCHED PAIR within one line. Five regression cases
cover leading, trailing, and unmatched markers.
**Worth remembering:** the test suite was table-driven and thorough, and still only tested the
shapes I thought of. Running the actual thing and listening found it in one pass. Exercise the real
pipeline, not only its units.

## P14 — Node cannot decompress bzip2, and sherpa ships models as `.tar.bz2`
**Symptom:** first-run model download works on macOS/Linux (shell out to `tar xj`) and dies on Windows.
**Cause:** Node 26's `zlib` exposes gzip, brotli and zstd — **no bzip2**. `tar` with bz2 support is
not guaranteed on Windows.
**Instead:** pure-JS `unbzip2-stream` (1.4.3, `gypfile: false`) piped into `tar-stream`. Verified:
397 entries / 81 MB decoded in 4.7 s with no native build. Or re-host the models as `.tar.gz`.

## P16 — An invalid manifest fails SILENTLY: no plugin, no consent prompt, no error
**Symptom:** added the dev plugin path in Settings, the "Installed" count went up, but no card
appeared, no consent prompt fired, and nothing said why.
**Cause:** our `orca-plugin.json` did not satisfy `pluginManifestSchema`. Three faults:
- `capabilities` were bare strings; the schema is `z.object({ kind: ... }).strict()`
- `engines: { orca: ">=x.y.z" }` missing — **required**, not optional
- `pluginApi: 1` missing — **required**
Also missing `contributes.events`, without which `agent.status.changed` never arrives even with the
`events:subscribe` capability granted.
**Instead:** validate the manifest against the host's own parser before trusting it:
```
npx tsx validate-manifest.mts /path/to/orca-plugin.json   # imports pluginManifestSchema from the orca clone
```
`packages/plugin/src/manifest/manifest.test.ts` now pins the shape in CI so this cannot regress.
**Worth remembering:** I wrote that manifest from research notes and never parsed it. Reading the
schema is not the same as running it — the canonical example at `examples/plugins/hello-orca/` was
sitting right there and would have shown every one of these in ten seconds.

## P15 — An unmatched emphasis marker was stripped, mangling `_private` identifiers
**Symptom:** running the pipeline for real, `_flush_buffer()` was spoken as "flush_buffer()".
Not caught by 106 passing tests, because every test case used *matched* markers.
**Cause:** the marker stripper decided "is this an opener?" and "is this a closer?" independently,
so a lone leading `_` looked like an opener and was dropped with no partner. Python privates are
everywhere in agent replies.
**Instead:** markers are now stripped only as a MATCHED PAIR within one line. Five regression cases
cover leading, trailing, and unmatched markers.
**Worth remembering:** the test suite was table-driven and thorough, and still only tested the
shapes I thought of. Running the actual thing and listening found it in one pass. Exercise the real
pipeline, not only its units.

## P14 — Windows PowerShell helpers hang instead of failing, and nothing had a deadline
**Symptom:** CI green on macOS and Ubuntu, `windows-latest` times out on both the clipboard read and
the OS-synth contract. Locally everything passed — the Windows path had never executed anywhere.
**Cause:** two compounding faults.
1. `Get-Clipboard` drives the Windows clipboard COM API, which **requires single-threaded apartment
   mode**. Without `-STA`, PowerShell 5.1 can block indefinitely rather than erroring.
2. More seriously: **not one spawned process in the codebase had a timeout.** A helper that never
   exits would have hung the plugin worker forever on a real user's machine, with no error and no
   audio — the exact "fails silently" failure principle I forbids.
**Instead:** every `spawn` now carries a hard deadline that kills the child and rejects
(`DEFAULT_SPAWN_TIMEOUT_MS`, `DEFAULT_CLIPBOARD_TIMEOUT_MS`), and all PowerShell invocations pass
`-STA -NoProfile -NonInteractive`. A test with a 1 ms deadline exercises the timeout path on every
platform, so this cannot regress unnoticed.
**Worth remembering:** this is the value of CI on all three OSes. A hang-forever bug in the default
path was invisible to 105 passing local tests, because the platform that triggers it was never run.

## P13 — `sherpa-onnx-win-arm64` is missing from **npm**, but upstream does build it
**Symptom:** you conclude Windows-on-ARM is unsupported and design a fallback you don't need.
**Cause:** npm at 1.13.6 ships `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win-x64`
and `win-ia32` — nothing for win-arm64. (Note the naming: `win-x64`, **not** `win32-x64`.) ORCA's
own STT hit this and hardcoded Windows to x64 (`stt-service.ts:556-577`, and see P7).
**Instead:** the GitHub release **does** carry
`sherpa-onnx-v1.13.6-win-arm64-shared-MD-Release.tar.bz2`. Since an ORCA plugin gets no
`npm install` anyway (P5) and must fetch binaries itself, **source from GitHub releases, not npm** —
then all six platform+arch combos are covered. Those tarballs also contain standalone executables
(`bin/sherpa-onnx-offline-tts`, 2.1 MB), which the npm packages do not. Verified 2026-08-20.

## P16 — An invalid manifest fails SILENTLY: no plugin, no consent prompt, no error
**Symptom:** added the dev plugin path in Settings, the "Installed" count went up, but no card
appeared, no consent prompt fired, and nothing said why.
**Cause:** our `orca-plugin.json` did not satisfy `pluginManifestSchema`. Three faults:
- `capabilities` were bare strings; the schema is `z.object({ kind: ... }).strict()`
- `engines: { orca: ">=x.y.z" }` missing — **required**, not optional
- `pluginApi: 1` missing — **required**
Also missing `contributes.events`, without which `agent.status.changed` never arrives even with the
`events:subscribe` capability granted.
**Instead:** validate the manifest against the host's own parser before trusting it:
```
npx tsx validate-manifest.mts /path/to/orca-plugin.json   # imports pluginManifestSchema from the orca clone
```
`packages/plugin/src/manifest/manifest.test.ts` now pins the shape in CI so this cannot regress.
**Worth remembering:** I wrote that manifest from research notes and never parsed it. Reading the
schema is not the same as running it — the canonical example at `examples/plugins/hello-orca/` was
sitting right there and would have shown every one of these in ten seconds.

## P15 — An unmatched emphasis marker was stripped, mangling `_private` identifiers
**Symptom:** running the pipeline for real, `_flush_buffer()` was spoken as "flush_buffer()".
Not caught by 106 passing tests, because every test case used *matched* markers.
**Cause:** the marker stripper decided "is this an opener?" and "is this a closer?" independently,
so a lone leading `_` looked like an opener and was dropped with no partner. Python privates are
everywhere in agent replies.
**Instead:** markers are now stripped only as a MATCHED PAIR within one line. Five regression cases
cover leading, trailing, and unmatched markers.
**Worth remembering:** the test suite was table-driven and thorough, and still only tested the
shapes I thought of. Running the actual thing and listening found it in one pass. Exercise the real
pipeline, not only its units.

## P14 — Windows PowerShell helpers hang instead of failing, and nothing had a deadline
**Symptom:** CI green on macOS and Ubuntu, `windows-latest` times out on both the clipboard read and
the OS-synth contract. Locally everything passed — the Windows path had never executed anywhere.
**Cause:** two compounding faults.
1. `Get-Clipboard` drives the Windows clipboard COM API, which **requires single-threaded apartment
   mode**. Without `-STA`, PowerShell 5.1 can block indefinitely rather than erroring.
2. More seriously: **not one spawned process in the codebase had a timeout.** A helper that never
   exits would have hung the plugin worker forever on a real user's machine, with no error and no
   audio — the exact "fails silently" failure principle I forbids.
**Instead:** every `spawn` now carries a hard deadline that kills the child and rejects
(`DEFAULT_SPAWN_TIMEOUT_MS`, `DEFAULT_CLIPBOARD_TIMEOUT_MS`), and all PowerShell invocations pass
`-STA -NoProfile -NonInteractive`. A test with a 1 ms deadline exercises the timeout path on every
platform, so this cannot regress unnoticed.
**Worth remembering:** this is the value of CI on all three OSes. A hang-forever bug in the default
path was invisible to 105 passing local tests, because the platform that triggers it was never run.

## P13 — Subagent spawn can fail on the host runtime, not on your prompt
**Symptom:** `Agent` returns *"Failed to create teammate pane: Timed out waiting for the Orca runtime
to respond"* or *"tmux: Timed out waiting for split pane handle"*. Nothing about the brief is wrong.
**Cause:** the teammate pane is created through the host runtime / tmux; when that is busy or wedged,
spawning fails regardless of the task.
**Instead:** this is an environment failure, not a code failure (R072) — do not rewrite the brief.
Retry once, then route around by doing the work in-session (R070) and record it here. Parallelism is
an optimization; the tasks and gates are the contract, and they do not care who ran them.

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
