# TTS engine landscape for the ORCA TTS plugin

**Scout:** TTS-engine research track · **Date:** 2026-08-20 · **Phase:** 0 (research)
**Target:** **macOS, Linux and Windows at parity — a hard requirement, not a stretch goal.**
Six platform+arch combos: darwin-arm64 · darwin-x64 · linux-x64 · linux-arm64 · win32-x64 · win32-arm64.
Node/TypeScript host process. Public repo with CI on all three OS runners.
**Driving features:** (1) hotkey speaks selected text, (2) "huddle" mode speaks streaming agent replies.

Every latency number below is labelled `[measured-here]` (run on this machine today),
`[measured-third-party]` (someone else's run, cited), or `[claimed]` (vendor). Where a fact was
not established, the word is **unknown**, not a guess.

**Companion files (deeper detail, same research pass):**
[`_track-b-local-tts.md`](./_track-b-local-tts.md) — 20-engine local landscape with per-engine licence
archaeology · [`_track-b-cloud-stt-audio.md`](./_track-b-cloud-stt-audio.md) — 11 cloud vendors, 13 STT
engines · [`_track-c-cross-platform.md`](./_track-c-cross-platform.md) — the six-target playback
matrix, the Windows/Linux OS-voice evidence, and CI runner findings. Sibling tracks that changed
conclusions here: [`orca-plugin-api.md`](./orca-plugin-api.md) (plugin format, size caps, panel CSP)
and [`prior-art-buzz.md`](./prior-art-buzz.md) (what `block/buzz` actually ships). This file is the
decision-facing synthesis of all of them.

**Test rig for every `[measured-here]` number:** Apple Silicon Mac, macOS 26.5 (build 25F71),
Node v26.7.0, `sherpa-onnx-node` 1.13.6 with the prebuilt `sherpa-onnx-darwin-arm64` binary,
`numThreads: 2`, `provider: 'cpu'`, warm process. Test sentence: *"It was a bright cold day in
April."* → ≈2.0 s of audio. 3–5 repetitions each, spread reported.

---

## Recommendation

**The headline call, now that parity is a hard requirement: use ONE portable neural engine on all
three OSes, not a trio of OS-native synths.** Reasoning in [Cross-platform strategy](#cross-platform-strategy);
the short version is that the OS-native trio is not a trio — macOS has decent voices, Windows fences
its modern voices off from third-party apps, and a stock Linux box has robotic formant synthesis or
nothing at all. Shipping that as "the default" means the default sounds completely different on each
of the three machines, which is exactly what the requirement forbids.

- **Default engine: Piper (VITS) running inside `sherpa-onnx-node`, on every platform.** It
  synthesised a full sentence in **52–65 ms** `[measured-here]` — RTF 0.025, ~40× real time — and
  `npm install sherpa-onnx-node` took **3 seconds / 32 MB / zero node-gyp** `[measured-here]`. It
  clears the user's own `<500 ms` first-audio bar (`R4.2`) by an order of magnitude, and it is the
  same engine, same voice, same latency profile on all three OSes — which is the requirement.
- **⭐ ORCA already ships `sherpa-onnx` — for its own speech stack.** The ORCA-API track found
  `src/main/speech/stt-service.ts:556-577` resolving native addons as
  `sherpa-onnx-${process.platform}-${process.arch}`, with Windows pinned x64-only, plus a whole
  model download/cache subsystem (`model-manager.ts`, `model-catalog.ts`, `model-cache-path.ts`)
  and a Windows non-ASCII-path workaround with its own regression test. **The recommendation here
  and the host application converged independently on the same runtime.** That is the strongest
  evidence available that this is the right choice for this codebase: the platform matrix, the
  caching, and the Windows landmines have already been solved once in-tree, and we can mirror
  proven code instead of inventing it.
- **The install story is portable because there is no compile step anywhere.**
  `sherpa-onnx-node`'s `package.json` has **no `gypfile`, no `binary` field and no install script**
  `[measured-here]`; it is pure `optionalDependencies` onto prebuilt platform packages. Verified
  present on npm at 1.13.6: `darwin-arm64` (33 MB), `darwin-x64` (37 MB), `linux-x64` (33 MB),
  `linux-arm64` (40 MB), `win-x64` (23 MB), `win-ia32` (20 MB) `[measured-here]`.
- **✅ All six targets are covered — the Windows-ARM gap is an npm packaging gap, not a build gap.**
  `sherpa-onnx-win-arm64` is absent from npm `[measured-here]`, which is what ORCA's own STT stack
  ran into (`stt-service.ts:556-577`, "Windows is x64-only"). But upstream **does build it**: the
  GitHub release `v1.13.6` carries `sherpa-onnx-v1.13.6-win-arm64-shared-MD-Release.tar.bz2`
  `[measured-here]`. Since the ORCA plugin format forces us to fetch binaries ourselves anyway (no
  `npm install` at install time), **we should source from GitHub releases, not npm — and then all
  six combos are covered.** This also fixes the gap for ORCA's own speech stack if they adopt it.
- **✅ Standalone CLI executables exist, which makes the sidecar plan concrete.** The same release
  tarballs ship `bin/sherpa-onnx-offline-tts` (**2.1 MB**) and `bin/sherpa-onnx-offline-tts-play`
  `[measured-here]` — real executables, not `.node` addons. Spawning one keeps unsigned native code
  **out of** the signed Electron worker entirely (see the sidecar section). Measured cold:
  **470 ms wall clock of which only 129 ms is synthesis** (RTF 0.05) — the rest is process start and
  model load `[measured-here]`, which is exactly why the sidecar must be resident, not per-press.
- **OS-native synths are the per-OS fallback chain, never the default.** They are the honest answer
  to `R5.4` ("degrades usefully… never a silent failure") and the right bridge while the model
  downloads on first run. But macOS `say` with an **empty string** — zero synthesis — costs
  **414 ms median over 5 runs** `[measured-here]`, 8× Piper's entire synthesis, and it cannot stream
  into a pipe at all.
- **⭐ `block/buzz` — the reference implementation named in our own HANDOFF — chose Kyutai Pocket
  TTS**, ONNX via `ort`, INT8 Flow-LM, 24 kHz mono f32 PCM, models SHA-256-pinned and downloaded on
  first launch, **zero cloud providers** (verified by absence across its whole tree). Two
  independent research tracks converged on the same two engines, from opposite directions. Read the
  buzz track before designing huddle mode — it has already solved chunk seams (8 ms fade-out, no
  fade-in, 20 ms lead-in only after an idle player) and in-flight cancellation.
- **Upgrade 1 — Kyutai Pocket TTS**, also via `sherpa-onnx-node`: **210–278 ms per sentence**
  `[measured-here]`, 96 MB int8, far more natural than Piper, with voice cloning from a reference
  clip. **Licence landmine:** the ONNX export sherpa ships is marked *"It is for non-commercial"*
  ([sherpa model README](https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models)) even
  though upstream `kyutai-labs/pocket-tts` is MIT. Ship it as an opt-in download, not bundled.
- **Upgrade 2 — a cloud provider behind the same interface** (ElevenLabs / OpenAI / Azure) for
  users who want the best voice and accept that text leaves the machine. Never default, and the
  UI must say plainly that text leaves the machine (the user's own `R3.5`).
- **Kokoro is the trap.** Reputation says it is the quality-per-byte winner; measurement says it
  is 16–25× slower than Piper on this hardware — **838–865 ms** FP32 (360 MB) and **1306–1358 ms**
  int8 (112 MB) per sentence `[measured-here]`. This independently reproduces the "INT8 ~1100 ms
  (wrong codepath?)" report in [hexgrad/kokoro#291](https://github.com/hexgrad/kokoro/issues/291).
  This settles open question 4 in the user's own requirements issue, which asked for exactly this
  comparison "on measurement, not reputation": **Piper, by 16×.**
- **Model files are platform-neutral, so first-run download is one artifact for six platforms.**
  The ONNX weights plus the shared `espeak-ng-data` phonemiser tables (**18 MB, 355 files**
  `[measured-here]`) are plain data. One 67 MB voice download serves every OS and arch.
- **One dependency covers TTS *and* the whole future STT/barge-in story.** `sherpa-onnx-node`
  exports `OfflineTts`, `OnlineRecognizer` (streaming ASR), `OfflineRecognizer`, `Vad`,
  `KeywordSpotter` and `CircularBuffer` from the same prebuilt binary `[measured-here]`. Choosing
  it for TTS today buys voice input and barge-in later at zero new install cost.

---

## Cross-platform strategy

Parity is a hard requirement, so this section is the decision, not an appendix. Six targets:
`darwin-arm64` · `darwin-x64` · `linux-x64` · `linux-arm64` · `win32-x64` · `win32-arm64`.

### The decisive call: one portable engine, not three OS-native ones

**Verdict: the OS-native trio is too uneven to be a default. Ship one portable ONNX engine.**

The tempting design is "use what the OS already has" — zero download, zero licence questions. It
fails on the second platform. Evidence, from the user's own 1,553-entry catalogue where each claim
was read at source `[measured-third-party]`:

| OS | What a third-party app can actually reach | Quality of that |
|---|---|---|
| **macOS** | `say` / `AVSpeechSynthesizer`, 184 voices on this machine `[measured-here]` | Decent — but **0 of the 184 matched "premium"/"enhanced"** `[measured-here]`; the good voices are an opt-in System Settings download, so out of the box you get the low tier |
| **Windows** | Three speech systems coexist. A third-party app reaches **SAPI 5** (`*Desktop` voices) and **OneCore** — but Microsoft's own WinRT docs state *"Only Microsoft-signed voices installed on the system can be used to generate speech"* `[measured-third-party]`. *"A voice visible in Settings is not necessarily visible to a SAPI 5 application"* `[measured-third-party]` | **The good neural voices are cryptographically fenced off.** The maintainer of the 911★ project built specifically to break that fence says so himself: *"This engine uses some encryption keys extracted from system files… it's more like a hack than a proper solution… Microsoft hasn't yet allowed third-party apps to use the Narrator/Edge voices, and this can stop working at any time"* `[measured-third-party]`. Out of the box Windows gives us **its worst tier** — Zira/David |
| **Linux** | `speech-dispatcher` + `espeak-ng` — both pulled in by the `ubuntu-desktop` metapackage on 24.04 `[measured-third-party]`; `speech-dispatcher`'s default backend is espeak-ng. RHVoice/Festival/Pico are opt-in `apt install`, preinstalled nowhere | **espeak-ng is rule-based formant synthesis with no weights at all** `[measured-third-party]` — robotic by construction. And on a headless box it is **absent entirely**: `actions/runner-images` has **zero** references to `speech`, `espeak`, `festival`, `alsa` or `pulseaudio` anywhere `[measured-third-party]` |

Three consequences that settle it:

1. **The default would sound like three different products — and two of the three would be the
   worst tier that platform has.** macOS reaches decent Apple voices; Windows is fenced to Zira/David
   while its good voices sit behind an encryption boundary; Linux gets formant synthesis or nothing.
   Apple's Samantha, Microsoft's Zira, and espeak-ng's robot are not "comparable quality" by any
   reading. The requirement says
   same features, same install story, and *"no macOS gets the good voice, Linux gets espeak"* — the
   OS-native path *is* that failure mode, by construction.
2. **The licence story fragments too.** espeak-ng is **GPL-3.0-or-later**; RHVoice is GPL; Mimic 3
   is AGPL-3.0; Festival is BSD-like `[measured-third-party]`. Three OSes, four licences, versus one
   Apache-2.0 runtime.
3. **It is not even reliably present.** A headless Linux box or CI runner has no synth at all
   `[measured-third-party]`, and we could not confirm SAPI 5 voices exist on a `windows-latest`
   runner either — so the "zero-install default" has platforms where it installs nothing and does
   nothing. **Do not assume; enumerate voices in a CI smoke test and assert the list is non-empty.**

Note the framing trap, which the cross-platform pass named well: *"Do not let 'but macOS `say` is
actually pretty good' argue for a native-first default; the same argument fails identically on
Windows and Linux, and parity requires the three to be identical, not each individually
acceptable."*

Against that, one portable engine gives an identical voice, an identical latency profile, one
licence conversation, and — measured — a **3-second, zero-compile npm install** `[measured-here]`.
The cost is a one-time ~67 MB model download. That is the right trade.

### Run the engine in a spawned sidecar, not in-process — and this is not a preference

The ORCA-API track surfaced a constraint that would otherwise sink the design on exactly one
platform, which under a parity requirement means it sinks it everywhere:

> The plugin worker is a **forked Electron binary** inheriting ORCA's signature and entitlements,
> and `com.apple.security.cs.disable-library-validation` is **absent** from
> `resources/build/entitlements.mac.plist`. So `dlopen`-ing an unsigned, downloaded `.node`
> **in-process is expected to fail on a notarized release build**, while spawning it as a separate
> child process is fine. Marked INFERRED — *a dev build will not reproduce it*, which makes it
> exactly the kind of thing that ships broken.

Everything I measured above ran in-process in a plain `node` REPL, which is precisely the case that
does **not** reproduce the problem. So: **treat the 52–65 ms figure as the engine's speed, and the
delivery mechanism as an open question with one strongly-favoured answer.**

**And it is concretely available.** The npm platform package contains only `libsherpa-onnx-c-api.dylib`,
`libsherpa-onnx-cxx-api.dylib`, `libonnxruntime.dylib` and `sherpa-onnx.node` — **no executable**
`[measured-here]`. But the GitHub release tarballs do: `bin/sherpa-onnx-offline-tts` (2.1 MB) plus
~20 sibling tools, in a 63 MB extracted tree `[measured-here]`. Downloaded binaries get no
`com.apple.quarantine` xattr (that is applied by LaunchServices and browsers, not raw sockets), so
Gatekeeper will not block executing them — we only have to `chmod +x` them ourselves at download
time, which is fine because it is our own code doing it.

That answer is a **spawned sidecar**, and three independent lines of reasoning land on it:

1. **It sidesteps macOS library validation** — a child process is not `dlopen`ed into the signed
   worker. Preferably spawn sherpa's own prebuilt CLI executable rather than a Node process that
   loads the addon, so nothing unsigned enters an Electron-signed process at all.
2. **It is already the user's own architecture.** `TTS-Hotkey` issue #1: *"Two processes, not one…
   a hotkey must not pay [model load] per press, so the service is resident and the client is
   thin"*, with `R5.1` specifying an OpenAI-shaped `POST /v1/audio/speech`. Our measurements agree:
   model load is 282–441 ms versus 52 ms of synthesis `[measured-here]`.
3. **It buys the remote-service property for free** (`R5.2`): the same client can point at
   `localhost` or at a GPU box on the LAN, changing only a URL.

**Cost to record honestly:** a sidecar adds an IPC hop and a process to supervise, and the
per-utterance figures above do not include it. Localhost IPC for ~100 KB of PCM is small relative to
a 52 ms synthesis, but it is **unmeasured**. Measure it before quoting an end-to-end number.

### Recommended stack

| Layer | Choice | Why |
|---|---|---|
| **Default engine** | Piper (VITS) on sherpa-onnx, identical on all 6 targets | 52–65 ms/sentence `[measured-here]`; no compile anywhere; same voice everywhere |
| **How it runs** | **A spawned, resident sidecar process** — not an in-process addon | Sidesteps macOS library validation; matches the user's own two-process rule; keeps the model warm; allows a remote service. Cold per-invocation is **470 ms**, resident synthesis is **129 ms** `[measured-here]` — the whole argument in two numbers |
| **Binary source** | **GitHub releases, not npm** | npm lacks `win-arm64`; the releases have it, plus standalone executables `[measured-here]`. And no `npm install` runs at plugin install time anyway |
| **Fallback chain** | macOS → `say` · Windows → SAPI 5 via PowerShell `System.Speech.Synthesis` · Linux → `spd-say` then `espeak-ng`, and if neither exists, a clear error | Only for "the model isn't ready yet" or "the engine failed". Never silent. Per `R5.4`, and per `R9.3`: where a platform genuinely cannot do something, **document it**, don't degrade quietly |
| **Optional upgrades** | Kyutai Pocket TTS (same runtime, 210–278 ms `[measured-here]`) · a cloud provider | Both behind the same provider interface |
| **Playback** | **If the worker can load native addons:** `node-web-audio-api` (all 6 targets incl. win-arm64, zero compile, sample-accurate stop, CI no-sink mode). **If it cannot:** a subprocess — start with `sherpa-onnx-offline-tts-play` (ships in the tarball we already fetch, streams while synthesising, all six targets, no gyp `[measured-here]`); bundle `ffplay`/`mpv` only if huddle mode needs incremental input or decoupled playback | Forced: the ORCA plugin panel **cannot play or fetch audio** (VERIFIED). Every in-renderer option is eliminated |

### What ships where

| Artifact | Size | Bundled in the package? | Notes |
|---|---:|---|---|
| sherpa runtime for the host platform | 20–40 MB npm / 63 MB extracted from the release tarball `[measured-here]` | ❌ — fetch at runtime (no `npm install` at plugin install) | No compile step on any OS `[measured-here]`. Prefer the release tarball: it has `win-arm64` and standalone executables |
| `espeak-ng-data` (phonemiser tables) | **18 MB, 355 files** `[measured-here]` | Either bundle once or fetch once — **platform-neutral**, shared by every Piper *and* Kokoro voice | Do not download it per voice |
| Default voice `.onnx` + `.onnx.json` | 61–63 MB (amy-low / lessac-medium) `[measured-here]` | ❌ download on first run | Platform-neutral. Keeps the npm package small and keeps GPL-licensed weights out of our tarball |
| Extra voices / Pocket TTS / Kokoro | 96–360 MB `[measured-here]` | ❌ user-initiated download | Show size and licence before starting |

**Correction — the ORCA plugin format forces a different delivery than plain npm.** The ORCA-API
track established three constraints that override the naive plan above:

- **`MAX_PLUGIN_FILES = 2_000`, `MAX_PLUGIN_TOTAL_BYTES = 50 MB`, hard**
  (`plugin-content-hash.ts:15-16`).
- **A plugin is never built at install time** — install is `git clone --depth 1` plus a recursive
  copy. **No `npm install`, ever** (`plugin-git-repository.ts:33-41`). So
  **`optionalDependencies` never resolve**, and the prebuilt platform binary does not arrive by
  itself. The plugin must be committed as a bundled `main.mjs`.
- **The worker env has no `APPDATA`, no `LOCALAPPDATA`, no `XDG_*`**
  (`plugin-worker-env.ts:8-27`), so `env-paths` and every convention that reads those variables
  **does not work here**. The cache dir must be derived from `HOME`/`USERPROFILE`, or by navigating
  up from `pluginRoot`. Both are fragile — flag as a design question, not a solved problem.

**Revised distribution plan.** Three tiers instead of two:

| Tier | Contents | Size | Mechanism |
|---|---|---:|---|
| **In the plugin repo** | bundled `main.mjs` (TS + JS deps via esbuild/rollup), manifest, assets | ≪ 50 MB | committed, content-hash verified, immutable |
| **Downloaded on first run** | the `sherpa-onnx-<platform>-<arch>` native binary **and** `espeak-ng-data` **and** the default voice | 20–40 + 18 + 61 MB | our own fetch into a cache **outside** the immutable install tree, mirroring `src/main/speech/model-manager.ts` |
| **User-initiated** | extra voices, Pocket TTS, Kokoro, cloud API keys | 96–360 MB | shown with size and licence first |

Nothing about the *engine* choice changes — sherpa is still the only zero-compile option on
(nearly) all six targets. What changes is that we fetch its binary ourselves rather than letting
npm do it, which is precisely what ORCA's own speech stack already does.

⚠ **Windows non-ASCII path bug.** `model-cache-path.ts:46-66` documents that
*"sherpa-onnx 1.12.x cannot load model files from non-ASCII Windows paths"* — a user named `Björn`
breaks model loading. ORCA works around it by hashing the path and relocating under an ASCII shared
root (`%PROGRAMDATA%\Orca\speech-models\<sha256-prefix-16>`) with a `.partial` + atomic-rename
migration. **We inherit this bug verbatim and must mirror that logic**; there is an existing test to
model ours on, `src/main/speech/model-manager-windows-path.test.ts`.

### Two packaging traps found by testing, not by reading

1. **You cannot use the bare Piper voices from Hugging Face.** `rhasspy/piper-voices` serves
   `.onnx` and `.onnx.json` directly over HTTP 200 `[measured-here]`, which looks like the clean
   archive-free path — but feeding one to sherpa fails with
   `'sample_rate' does not exist in the metadata` `[measured-here]`. sherpa's release tarballs
   embed extra ONNX metadata and a `tokens.txt` that the HF files do not carry. **Use sherpa's
   `tts-models` release assets**, or convert and mirror the models ourselves.
2. **Those assets are `.tar.bz2`, and Node cannot decompress bzip2.** Node 26's `zlib` exposes
   gzip, brotli and zstd — **no bzip2** `[measured-here]`. On macOS/Linux you could shell out to
   `tar xj`; on Windows there is no such guarantee. Verified fix: the pure-JS `unbzip2-stream`
   (1.4.3, `gypfile: false`, deps `buffer` + `through`) piped into `tar-stream` decoded the full
   397-entry, 81 MB archive in **4.7 s** with no native build `[measured-here]`. Acceptable as a
   one-time first-run cost. The alternative is to re-host the models as `.tar.gz`.

### CI

The plugin will be public with CI on `ubuntu-latest` / `macos-latest` / `windows-latest`. The
property that makes this stack CI-friendly is that **synthesis is separable from playback**:

- **In-process**, `generate()` returns a `Float32Array` plus a `sampleRate` `[measured-here]` — no
  device touched.
- **Via the CLI**, `sherpa-onnx-offline-tts --output-filename=out.wav` writes a file and prints its
  own `Elapsed seconds` and RTF `[measured-here]` — also no device, and it gives CI a free
  **latency regression check** on every platform.

So the tests that matter run headlessly everywhere: assert sample count, sample rate, non-silence,
and that RTF stays under a threshold. **This is also how open question 9 gets answered** — my
numbers are Apple-Silicon-only, and CI is the cheapest way to get the same measurement on Linux and
Windows before the default is locked.

**Runner audio devices — do not assume.** `actions/runner-images` contains **zero** references to
`alsa` or `pulseaudio` anywhere `[measured-third-party]`. The one actively-maintained precedent
found, `node-web-audio-api`, runs its real (non-offline) test suite **only on `macos-latest`**, with
the maintainer's literal comment `# run on macos-latest which seems to have a soundcard available`,
and deliberately does **not** exercise real audio on `windows-latest` or `ubuntu-latest`
`[measured-third-party]`. Copy that split exactly:

| Job | Runners | Asserts |
|---|---|---|
| **Synthesis** | all three, unconditionally | sample count, sample rate, non-silence/RMS, RTF under threshold |
| **Packaging** | one | tree < 2,000 files and < 50 MB; `main.mjs` is valid ESM; the pinned sherpa release has all six platform assets |
| **Playback + barge-in** | only where a device is *confirmed* — macOS today | audible output, stop latency |

Whether `ubuntu-latest`/`windows-latest` have any audio device at all is **unknown** — settle it
with a one-line device-enumeration smoke test rather than more searching. The `snd-dummy` /
`pulseaudio --start` pattern still cited around the web traces mostly to **abandoned `.travis.yml`
files**, not current practice `[measured-third-party]`; treat it as unverified.

A CI matrix should also assert the two ORCA packaging constraints on every push: the built tree is
**under 2,000 files and 50 MB**, and the bundle is a single valid ESM `main.mjs`.

---

## The user's own prior art

The single most important finding in this whole report: **the user has already specified this
project, surveyed its prior art at source level, and published a 1,553-entry catalogue of the
domain — eleven days ago.** The ORCA plugin should be read as a *host* for that design, not as an
independent design exercise.

### The load-bearing artifacts

| Kind | Name | Why it matters |
|---|---|---|
| **Own repo** | [`YoraiLevi/TTS-Hotkey-AI-Read-Clipboard-CLI`](https://github.com/YoraiLevi/TTS-Hotkey-AI-Read-Clipboard-CLI) | *"Press a key, hear your selection. Local modern-AI TTS with pluggable backends, uniform across macOS/Windows/Linux."* **This is feature 1 of our plugin, already specified.** README + [issue #1](https://github.com/YoraiLevi/TTS-Hotkey-AI-Read-Clipboard-CLI/issues/1) only — requirements phase, no code. |
| **Own gist (10 files, 586 KB)** | [Reading the Screen Aloud](https://gist.github.com/YoraiLevi/cfc6320766905504d23e7100d01e4c7d) | 1,553 catalogued screen/selection TTS tools, data-dated 2026-08-09, banded CORE/ADJACENT/ENGINE-only/OUT-OF-BAND, with an evidence tier per row (885 `[measured]`). Includes a model-supply table with on-disk weights measured from the HF API, and 1,016 first-hand community reports. |
| **Own gist** | [Engineer↔Agent Workflow Infrastructure for a Dyslexic, Voice-First Operator](https://gist.github.com/YoraiLevi/893a2e5f0725457685e4cd0664ed9cc6) | **The *why*.** The user is dyslexic and voice-first; TTS here is assistive technology, not a novelty. Cites [Wood et al. 2018](https://pubmed.ncbi.nlm.nih.gov/28112580/) (d=0.35 TTS comprehension effect, 22 studies) and a [Frontiers 2022 study](https://pmc.ncbi.nlm.nih.gov/articles/PMC9125151/) finding dyslexic adults match controls on *listening* comprehension while lagging on reading. |
| **Own repo** | [`YoraiLevi/ai-voice-reminders-bridge`](https://github.com/YoraiLevi/ai-voice-reminders-bridge) (`voice-bridge`) | Voice spoke into a file-mailbox agent system — dictate to agents from a phone via Reminders/CalDAV. Python. **Contains no TTS engine**; STT is Apple's on-device dictation on the phone. Relevant as evidence of the voice-first workflow, not as an engine signal. |
| **Own fork** | [`YoraiLevi/pocket-tts`](https://github.com/YoraiLevi/pocket-tts) (fork of `kyutai-labs/pocket-tts`) | Forked *and* starred. Strongest single signal of engine preference. |
| **Own fork** | [`YoraiLevi/voicebox`](https://github.com/YoraiLevi/voicebox) (fork of `jamiepine/voicebox`) | 50.9k★ MIT TypeScript "full voice I/O stack, running locally" — clone/dictate/agent voices, ships an API. |
| **Own fork** | [`YoraiLevi/happy`](https://github.com/YoraiLevi/happy) (fork of `slopus/happy`) | 23.4k★ mobile/web client for Claude Code & Codex "with realtime voice". Directly adjacent to huddle mode. |

### Starred repositories that hit the keyword sweep

Screened all 281 starred repos, 119 own repos and 87 gists for `tts|stt|speech|voice|audio|whisper|
piper|kokoro|coqui|xtts|bark|espeak|say|elevenlabs|azure|openai-audio|vad|silero|wake|porcupine|
sherpa|onnx` and related terms. Signal-bearing hits:

| Repo | ★ | One line | Why it matters here |
|---|---:|---|---|
| [`kyutai-labs/pocket-tts`](https://github.com/kyutai-labs/pocket-tts) | 8.8k | "A TTS that fits in your CPU (and pocket)". MIT, 100M params, CPU-only, streaming, 6 languages, voice cloning | **Starred and forked.** Vendor claims ~200 ms first chunk, ~6× RT on MacBook Air M4 `[claimed]`. Reachable from Node three ways — see deep dive. |
| [`babybirdprd/pocket-tts`](https://github.com/babybirdprd/pocket-tts) | 124 | Candle (Rust) port of Pocket TTS with WASM + PyO3 bindings | Also starred — the user tracked the *ports*, not just the model. Signals interest in a non-Python runtime. |
| [`Picovoice/orca`](https://github.com/Picovoice/orca) | 145 | On-device **streaming** TTS engine "designed for use with LLMs… as the LLM produces tokens, Orca generates speech in parallel" | Exactly huddle mode's shape, ships [`@picovoice/orca-node`](https://www.npmjs.com/package/@picovoice/orca-node). **Disqualified as default:** its README states you need an AccessKey and *"You will need internet connectivity to validate your AccessKey… even though the engine is running 100% offline."* That breaks `R3.4` (no account, no key, no network). Name collision with ORCA-the-agent is coincidental. |
| [`jamiepine/voicebox`](https://github.com/jamiepine/voicebox) | 50.9k | MIT TypeScript local voice studio: clone, dictate, agent voices, HTTP API | Forked. A candidate *provider* to point at rather than an engine to embed. |
| [`FrigadeHQ/yap`](https://github.com/FrigadeHQ/yap) | 366 | MIT Swift; macOS dictation on Apple's on-device Speech framework, "no cloud/no API keys/no account", macOS 26+ | The reference implementation for the STT half if we ever add voice input on macOS. |
| [`slopus/happy`](https://github.com/slopus/happy) | 23.4k | Mobile/web client for Claude Code & Codex with realtime voice + encryption | Forked. Prior art for "agent replies, spoken, on a device". |
| [`ybouhjira/claude-code-tts`](https://github.com/ybouhjira/claude-code-tts) | 21 | **The closest existing thing to *this* plugin**: TTS MCP plugin for Claude Code, Go, OpenAI TTS | Read in full — see below. |
| [`screenpipe/screenpipe`](https://github.com/screenpipe/screenpipe) | 21.1k | Continuous local screen+audio recording as agent context | Local-first STT pipeline at scale; adjacent, not an engine. |
| [`afkar-zoldyck/tts-gratis`](https://github.com/afkar-zoldyck/tts-gratis) | 6 | "Text To Speech 100% Gratis" | Low signal; keyword hit recorded for completeness. |
| [`YoraiLevi/pysubsync`](https://github.com/YoraiLevi/pysubsync) | 2 | Own repo — subtitle sync utility for anime | Audio-adjacent only; recorded for completeness. |

Everything else in the 281 stars that matched the sweep matched on unrelated senses of the words
(`audio-recording` topics on `screenpipe`, "speech-language models" in an MTP paper list,
Azure/OpenAI PowerShell tooling, ISP/DSP image-processing guides). No further TTS/STT signal.

### The `TTS-Hotkey` requirements — read in full, and they bind us

[Issue #1](https://github.com/YoraiLevi/TTS-Hotkey-AI-Read-Clipboard-CLI/issues/1) is a complete
functional spec (R1–R9) plus two long comments of reasoning and a source-level prior-art survey of
sixteen projects. The parts that constrain our engine choice:

- **`R3.4` — the default configuration must require no account, no API key, no network.** This
  alone disqualifies Picovoice Orca (AccessKey validation needs internet), ElevenLabs, OpenAI, and
  `edge-tts` (undocumented Microsoft endpoint, no third-party grant, and the survey documents
  repeated 403 waves against it in 2024–2025).
- **`R4.1` — sentence streaming is required.** *"A `POST` → wait for whole paragraph → play design
  fails this requirement."* Applies directly to huddle mode.
- **`R4.2` — target first audio under ~500 ms** on the default local backend.
- **`R3.1`/`R3.2` — the backend is configuration, not code**, behind a documented interface.
- **`R2.5` — speech must be interruptible** by a second chord. That is barge-in, already required.
- **The two-process rule.** *"Neural models take seconds to load. A hotkey must not pay that cost
  per press."* Resident warm service + thin client. Our measurement backs this: model load is
  282–441 ms even for these small models, versus 52 ms of actual synthesis.
- **Playback belongs to the client, not the synthesis service** — so one service can serve several
  machines and degrade to `localhost` when off-network.

The survey's own verdict on the field: *"No. Nothing on this list does the whole job. Nothing
comes close on all three platforms."* Twelve full-stack candidates were graded against R1–R9;
**zero** satisfied `R9` (cross-platform parity) and **zero** satisfied `R3` (a real pluggable
backend selected by configuration). Those two gaps are the contribution.

Techniques the survey extracted that we should lift rather than re-derive:

- **[`speak-selection.py` `chunk_text_for_streaming`](https://github.com/HyperCactus/speak-selection/blob/f206cf8e4499c5e96a3808b0e1b23fe17ad6e7f0/speak-selection.py#L990-L1045)** — a
  three-level cascade, sentence → clause → word-packing against a 220-char cap. Dependency-free.
- **[`Kokoro-Clipboard-TTS/src/utils/speechPlanner.ts`](https://github.com/seanbud/Kokoro-Clipboard-TTS/blob/98c96b8e9bc7b9f79856215accce92bd1afb797c/src/utils/speechPlanner.ts)** —
  called *"the single most valuable file in the survey"*: 623 lines of markdown-aware segmentation,
  code-fence and blockquote handling, spoken-form normalisation, source-position mapping, and
  replay-from-segment. **It is already TypeScript.** Huddle mode needs exactly this, because agent
  replies are markdown.
- **[`wyoming-piper/handler.py`](https://github.com/OHF-Voice/wyoming-piper/blob/fd78db7f40f59c17207840402f7df70808ff8dd3/wyoming_piper/handler.py#L99-L172)** —
  a `SentenceBoundaryDetector` fed incrementally with `add_chunk()` / `finish()`. That is the
  correct primitive for starting synthesis on sentence 1 while the agent is still generating.
- **[`MLXRead/Speech/SpeechEngine.swift`](https://github.com/rogu3bear/mlxread/blob/ad3286998f70a3cfd8aa16581f45f441a47dc496/MLXRead/Speech/SpeechEngine.swift#L8-L23)** —
  *"the only clean engine protocol found anywhere"*: `identifier` / `displayName` / `sampleRate` /
  `prepare()` / `generate(text:) -> AsyncThrowingStream<SpeechAudioChunk>` / `cancel()`.
  Copy the shape (see Provider interface implications).
- **[`speak11` persistent player over FIFOs](https://github.com/smcantab/speak11/blob/475c5fa842c8ab91802298c06667603d0ba02b47/CHANGELOG.md#L7)** —
  its changelog measures a persistent player cutting the inter-sentence gap from **~970 ms to
  ~30 ms** versus one `afplay` per sentence `[measured-third-party]`. Direct confirmation of the
  playback finding below.
- **[`chatterbox-tts-api` WAV-header trick](https://github.com/travisvn/chatterbox-tts-api/blob/a5f466128e4baa8e4cceb3bba9b7ca9de6f7ec6b/app/api/endpoints/speech.py#L470)** —
  emit a WAV header with a `0xFFFFFFFF` placeholder data size, then raw PCM per chunk, so any
  dumb audio player can consume an open-ended stream over plain HTTP with no custom protocol.

### `ybouhjira/claude-code-tts` — the nearest existing plugin, read in full

A Go MCP server + hooks bundle that speaks Claude Code's replies. Architecture: an MCP server
exposing `speak(text, voice)` and `tts_status()`, a **worker pool** with a non-blocking queue, a
**mutex around playback** so utterances never overlap, a `Stop` hook (`hooks/auto-speak.sh`) that
fires on every completed reply, and a standalone `speak-text` CLI. Playback is per-platform
subprocess: `afplay` on macOS, `mpv`/`ffplay`/`mpg123` on Linux, PowerShell on Windows.

What to take: the Stop-hook trigger, the single-flight playback mutex, the queue that never blocks
the agent, and the separate CLI for scripting. What to reject: it is **OpenAI-TTS-only and requires
`OPENAI_API_KEY`**, so it has no zero-setup path at all; and file-at-a-time `afplay` playback gives
the ~970 ms inter-sentence gap the `speak11` changelog measured. Its own gist-catalogue counterpart
is the reason our default must be local.

---

## TTS engine comparison

Latency column convention: **per-sentence synthesis time** for ≈2 s of speech, warm process. For a
sentence-streamed design this *is* time-to-first-audio, because sentence 1 plays while sentence 2
renders.

| Engine | Install burden | Offline | Streams? | Per-sentence latency | Quality | Languages | Licence | GPU? | Model size | macOS | Invoke from Node/TS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Piper (VITS) via `sherpa-onnx-node`** | `npm i sherpa-onnx-node` — **3 s, 32 MB, no gyp** `[measured-here]` + model d/l | ✅ | Sentence-level; per-sentence cost so low it is moot | **52–65 ms** `[measured-here]` (RTF 0.025) | Good, clearly synthetic | 30+ voice packs | Engine Apache-2.0; **Piper voices GPL-3.0** upstream ([`piper1-gpl`](https://github.com/OHF-Voice/piper1-gpl)); the archived MIT [`rhasspy/piper`](https://github.com/rhasspy/piper) is the old one | ❌ | 63 MB (amy-low) `[measured-here]` | ✅ prebuilt arm64 | Native addon, sync `generate()` + `generateAsync()` |
| **macOS `say`** | **Zero — preinstalled** | ✅ | ❌ into a pipe | **414 ms spawn floor** `[measured-here]`; 1.86 s to render 9.4 s of audio | OS voices; 184 listed on this machine `[measured-here]` | Many | Apple OS component | ❌ | 0 | ✅ native | `child_process.spawn('say', …)` |
| **AVSpeechSynthesizer** | Zero, but needs a Swift/ObjC helper binary | ✅ | ✅ true buffer callbacks | **unknown** (not measured here) | Same voice pool as `say`, plus Personal Voice | Many | Apple OS component | ❌ | 0 | ✅ | Ship a tiny signed Swift sidecar; talk over stdio/pipe |
| **Kyutai Pocket TTS (int8) via sherpa** | Same npm install + 96 MB model `[measured-here]` | ✅ | ✅ (upstream advertises ~200 ms first chunk `[claimed]`) | **210–278 ms** `[measured-here]` | Notably natural; voice cloning from a reference clip | en, fr, de, pt, it, es | Upstream **MIT**; **the ONNX export sherpa ships is marked non-commercial** ⚠ | ❌ (2 cores) | 96 MB int8 `[measured-here]` | ✅ | Same `OfflineTts` API, `model.pocket`, needs `referenceAudio` |
| **Kokoro-82M FP32 via sherpa** | npm + 360 MB model `[measured-here]` | ✅ | Sentence-level | **838–865 ms** `[measured-here]` | Best-in-class for the size | multi-lang builds exist | Apache-2.0 (uses espeak-ng GPL for G2P) | ❌ | 360 MB `[measured-here]` | ✅ | `model.kokoro` |
| **Kokoro-82M int8 via sherpa** | npm + 112 MB `[measured-here]` | ✅ | Sentence-level | **1306–1358 ms** `[measured-here]` — *slower than FP32* | Same | " | Apache-2.0 | ❌ | 112 MB `[measured-here]` | ✅ | `model.kokoro` |
| **Kokoro via Python (`kokoro`/`kokoro-onnx`)** | pip + PyTorch | ✅ | Sentence-level | ~500 ms FP32 ONNX CPU, ~1100 ms int8 `[measured-third-party]`, [kokoro#291](https://github.com/hexgrad/kokoro/issues/291); RTF ~0.162 on AMD EPYC `[measured-third-party]`, [leaseweb](https://blog.leaseweb.com/2026/04/05/amd-epyc-llm-inference-benchmark-cpu-vs-gpu/) | Same | " | Apache-2.0 | optional | 327 MB `.pth` `[measured-third-party]` | ✅ | Subprocess/HTTP sidecar; **drags Python + torch** |
| **KittenTTS via sherpa** | npm + model | ✅ | Sentence-level | not measured here; **~315 ms** initial `[measured-third-party]` ([HN 44812882](https://news.ycombinator.com/item?id=44812882)) | Reported "tin can" by one user | en | Apache-2.0 | ❌ | 27.6 MB int8 `[measured-third-party]` | ✅ | `model.kitten` |
| **Supertonic 3** ⚠ *being discontinued* | ONNX; Core ML on Apple Silicon; lists a Node SDK | ✅ | ✅ | **TTFA ~0.05 s**, 55× RT CPU `[measured-third-party, contested]` ([HN 46733066](https://news.ycombinator.com/item?id=46733066)); but ~2000 ms on a Pixel 9 `[measured-third-party]` | Contested: MOS 1.55 at 2 steps vs 4.37 at 5 steps `[measured-third-party]` | **31** | MIT (weights stay usable) | ❌ | ~260 MB `[measured-third-party]` | ✅ Core ML + Swift SDK | Repo carries a CAUTION banner added **2026-07-23**; Voice Builder service ends **2026-08-31**. `sherpa-onnx` mirrors a converted int8 copy, so the weights survive upstream — but do not depend on ongoing support. |
| **Picovoice Orca** | `npm i @picovoice/orca-node` | Engine yes, **licence check no** | ✅ input *and* output streaming, LLM-token-shaped | **unknown** | unknown | see repo | Apache-2.0 code, **AccessKey required, needs internet to validate** | ❌ | unknown | ✅ arm64 | First-class Node SDK — the best *shaped* API found, blocked on `R3.4` |
| **espeak-ng** | `brew install espeak-ng` (**not present on this machine** `[measured-here]`) | ✅ | ✅ | **5–10 ms** `[measured-third-party]`, quoted in [kokoro#291](https://github.com/hexgrad/kokoro/issues/291) | Robotic formant | 100+ | **GPL-3.0-or-later** | ❌ | ~0 (rule-based) | brew | Subprocess |
| **Coqui / XTTS** | pip + PyTorch | ✅ | partial | **unknown** | High, cloning | many | MPL-2.0; **company shut down**, maintained fork is [`idiap/coqui-ai-TTS`](https://github.com/idiap/coqui-ai-TTS) | recommended | large | ✅ | Python sidecar |
| **Chatterbox** | pip + PyTorch | ✅ | ✅ | ~1× RT on a 3090 `[measured-third-party]`; 16 s audio in 13 s on a 4060 mobile | High | en | MIT (model repo 13.9 GB across variants `[measured-third-party]`) | **~5–6.5 GB VRAM** | GB-class | poor | Python sidecar — disqualified for a plugin |
| **Bark / StyleTTS2 / F5-TTS / GPT-SoVITS / VibeVoice** | pip + PyTorch | ✅ | ✗–partial | seconds; VibeVoice-7B needs 23.7 GB VRAM `[measured-third-party]` | High | varies | MIT-ish, per-checkpoint terms differ | yes | GB-class | poor | Out of scope for a zero-setup plugin |
| **Cloud (ElevenLabs / OpenAI / Azure / Google / Polly / Deepgram / Cartesia / Rime / PlayHT / Hume / Groq)** | API key only | ❌ | ✅ WebSocket or chunked HTTP | 40–200 ms TTFB `[claimed]` — see below | Best available | many | Commercial ToS | n/a | 0 | ✅ | `fetch` / vendor npm SDK |

### Platform + distribution matrix — the parity view

The column that now decides everything. "Native build?" means: does installing this require
compiling C/C++ on the *user's* machine (node-gyp)? Under a parity requirement that is close to
disqualifying, because a toolchain-less Windows box is the common case.

| Engine | darwin-arm64 | darwin-x64 | linux-x64 | linux-arm64 | win32-x64 | win32-arm64 | Native build? | What must be downloaded |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|---|
| **Piper / Kokoro / Pocket / Kitten on sherpa-onnx, from GitHub releases** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ `win-arm64-shared-MD-Release` `[measured-here]` | **None** — standalone executables + shared libs; the npm route also has no `gypfile`, `binary` field or install script `[measured-here]` | 18 MB `espeak-ng-data` (shared) + 61–360 MB model, both platform-neutral `[measured-here]` |
| **OS-native (`say` / SAPI 5 / `spd-say`)** | ✅ | ✅ | ⚠ may be absent entirely | ⚠ same | ✅ SAPI 5 only | ✅ SAPI 5 only | None | Nothing — but see the quality verdict above |
| **Picovoice Orca** | ✅ | ✅ | ✅ | ✅ (incl. Pi) | ✅ | ✅ per README | Prebuilt native addon | Model + **an AccessKey validated over the internet** |
| **espeak-ng** | brew | brew | apt (often present) | apt | **manual install** | manual | None (subprocess) | Nothing (rule-based, no weights) |
| **Anything Python/PyTorch** (Kokoro-py, XTTS, Chatterbox, Bark, F5, StyleTTS2, Orpheus, Dia, VibeVoice) | ⚠ | ⚠ | ⚠ | ⚠ | ⚠ | ⚠ | Requires a **Python runtime we do not control**, plus multi-GB wheels — documented at 6–7.1 GB for a 27 MB model `[measured-third-party]` | GB-class |
| **`speaker` / `naudiodon` (playback)** | ⚠ | ⚠ | ⚠ | ⚠ | ⚠ | ⚠ | **Yes, node-gyp** — needs a compiler on the user's machine | n/a |

> **npm caveat:** the npm packages cover only 5 of 6 — `darwin-arm64` 33 MB, `darwin-x64` 37 MB,
> `linux-x64` 33 MB, `linux-arm64` 40 MB, `win-x64` 23 MB, `win-ia32` 20 MB, and **no `win-arm64`**
> `[measured-here]`. Note the naming is `win-x64`, not `win32-x64`. Sourcing from GitHub releases
> avoids this entirely.

**Read as:** exactly one row installs with no compiler, no Python and no account on **all six**
targets. That is the whole cross-platform argument in one table.

### Cloud providers — the streaming shape is what matters

Detail and sources in [`_track-b-cloud-stt-audio.md`](./_track-b-cloud-stt-audio.md). The field has
converged on **two shapes**, and only one fits huddle mode:

- **(a) Persistent WebSocket accepting incremental text, emitting incremental audio** — the right fit.
  **ElevenLabs** and **Rime** both document this *explicitly for LLM output*: Rime's docs say the WS mode
  is recommended so *"you can feed text in as your LLM generates it"* ([docs.rime.ai](https://docs.rime.ai/docs/streaming)),
  and **PlayHT** ships a first-class "Input Streaming with LLMs" guide. **Deepgram**'s Voice Agent API pipes
  STT→LLM→TTS over one persistent WS session. OpenAI's Realtime API is implicitly in this class.
- **(b) Request/response streaming** (Amazon Polly, Groq TTS, Google's non-Realtime Chirp) — a poor fit,
  because you must accumulate a whole sentence before the request even goes out.

Latency claims worth recording, all **`[claimed]`** unless noted: Deepgram Aura-2 *"sub-200 ms TTFB"*
(vendor launch post); Rime Mist v3 *"sub-200 ms end-to-end"* with a stated methodology (single H100 SXM);
Cartesia Sonic *"40 ms"* — widely repeated in secondary reviews but **not stated on Cartesia's own page**,
so treat it as unconfirmed. Pricing that was read from a live page `[measured-third-party]`: Amazon Polly
Standard $4 / Neural $16 / Generative $30 / Long-Form $100 per 1M chars. Google, PlayHT, Rime, Hume and
Deepgram-Aura per-character pricing were **not verified** and are recorded as unknown.

⚠ **The one number that changes a decision:** Piper is **16× faster than Kokoro FP32 and 25×
faster than Kokoro int8** on this machine. Both Kokoro variants are also *slower* than the macOS
`say` spawn floor. Anyone reasoning from Kokoro's reputation will pick the wrong default.

---

## Deep dive: top 3

### 1. Piper (VITS) on sherpa-onnx — the recommended default, on all six targets

**Install.** `npm install sherpa-onnx-node` resolved in **3 seconds** and added **2 packages /
32 MB** `[measured-here]`: the JS wrapper plus a platform package (`sherpa-onnx-darwin-arm64`)
carrying a **prebuilt** native binary. There is no `node-gyp` step, no Xcode requirement, no
Python. For a plugin that must install on a stranger's machine, that is the difference between
shipping and not shipping. Voices come from the sherpa
[`tts-models` release](https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models) as
`.tar.bz2`; `vits-piper-en_US-amy-low` is a 67 MB download / 63 MB `.onnx` `[measured-here]`, and
bundles its own `espeak-ng-data` for phonemisation.

**Invocation.** Construct `new sherpa.OfflineTts({model:{vits:{model, tokens, dataDir}, numThreads,
provider}})` once and keep it resident — construction cost was **406 ms** `[measured-here]`, which
is exactly the per-press cost the user's two-process rule exists to avoid. Then `tts.generate({text,
sid, speed})` returns `{samples: Float32Array, sampleRate}` synchronously, and `generateAsync()`
returns a Promise without blocking the event loop (**68 ms**, verified not to stall a 1 ms
`setInterval` `[measured-here]`). Sample rate for this voice is 16 kHz `[measured-here]`.

**Streaming behaviour.** There is a `callback` option on `generate` intended for chunked delivery;
in my run the callback never fired and the call simply returned the complete buffer
`[measured-here]` — treat intra-utterance streaming here as **unknown/unverified**. It barely
matters: at **52–65 ms per sentence** the correct design is sentence-level streaming — segment
incoming text, synthesise sentence *n+1* while sentence *n* plays. A full 3-sentence paragraph
(≈8 s of audio) rendered in **183–220 ms** `[measured-here]`, i.e. the whole paragraph finishes
faster than `say` can start. The user's `R4.2` <500 ms bar is met with ~8× headroom.

### 2. Kyutai Pocket TTS — the quality upgrade that stays local

**Install.** Three distinct routes exist, and choosing the right one is the whole story. The
official package is `pip install pocket-tts` and it **requires PyTorch 2.5+** — the user's own
catalogue documents this class of install ballooning to 6–7.1 GB of dependencies for a 27 MB model
`[measured-third-party]`, with the maintainer of a comparable project conceding *"we may have
forgotten to remove the redundant dependencies"*. Do not take that route from a Node plugin. The
upstream README lists community ports including
[`PocketTTS.cpp`](https://github.com/VolgaGerm/PocketTTS.cpp) (single-file C++ ONNX runtime with
CLI, HTTP server and a C FFI), a [Rust/Candle port with WASM](https://github.com/babybirdprd/pocket-tts)
— which the user separately starred — an [MLX port for Apple Silicon](https://github.com/jishnuvenugopal/pocket-tts-mlx),
and **[`sherpa-onnx`](https://github.com/k2-fsa/sherpa-onnx), which is already our TTS dependency**.
The sherpa route means Pocket TTS costs one 96 MB download and zero new dependencies
`[measured-here]`.

**Invocation.** Same `OfflineTts` object, `model.pocket` with seven ONNX/JSON paths (`lmFlow`,
`lmMain`, `encoder`, `decoder`, `textConditioner`, `vocabJson`, `tokenScoresJson`). It is a
**cloning** model, so it needs a voice prompt: calling `generate()` without one fails with
`reference_sample_rate 0 is invalid` `[measured-here]`. Supply
`generationConfig: {referenceAudio, referenceSampleRate}` from a reference WAV — `sherpa.readWave()`
loads one, and the model bundle ships three. With that, **210–278 ms per sentence, model load
282 ms** `[measured-here]`. Upstream claims ~200 ms to first chunk and ~6× real time on a MacBook
Air M4 `[claimed]`; my end-to-end per-sentence figure is consistent with that.

**Streaming.** Upstream lists "Audio streaming" and "can handle infinitely long text inputs" as
headline features `[claimed]`. Through the sherpa binding I only exercised whole-sentence calls,
so intra-sentence streaming via that path is **unknown**. At 210–278 ms per sentence, sentence-level
pipelining is again sufficient.

**Independent corroboration.** `block/buzz` — the project our HANDOFF names as the UI-affordance
reference for huddle mode — runs Pocket TTS in production, `english_2026-04`, INT8 Flow LM via
`ort` 2.0.0-rc.12, 24 kHz mono f32 PCM, 12 bundled reference-WAV voices plus user-imported
2–30 s clips, models downloaded on first launch from HuggingFace **SHA-256-pinned per artifact**
(`huddle/models.rs:1-60`). It carries a **hard 50-token-per-chunk SentencePiece input limit**
(`pocket.rs:196`) — a real constraint our segmenter must respect, and one I did not hit through the
sherpa binding. It also runs **1 ONNX intra-op thread by default**, versus the 2 I used, so my
210–278 ms is not directly comparable to theirs. Its experimental `BUZZ_TTS_STREAMING=1` path emits
PCM deltas every 12 Flow-LM frames (80 ms each) and documents the honest cost: smaller deltas reach
first audio sooner but **diverge from the batch path at ~23 dB SNR** due to decoder intra-chunk
lookahead. That is the clearest statement anywhere of what intra-utterance streaming actually costs.

**Blocker.** The sherpa model card says plainly: *"Before you use it, please read its LICENSE… **It
is for non-commercial**"*, pointing at
[`KevinAHM/pocket-tts-onnx`](https://huggingface.co/KevinAHM/pocket-tts-onnx). Upstream
`kyutai-labs/pocket-tts` is MIT with a "Prohibited use" policy covering impersonation and
deception. **The divergence is in the ONNX export, not the model**, so a commercially-safe Pocket
TTS path probably exists via a different export — but that is unverified. Until someone checks,
ship Pocket TTS as an **opt-in user-initiated download** with the licence shown, never bundled.

### 3. The OS-native trio — the per-OS fallback floor, not the default

Under parity these three are one row in the design, so they are covered together. **They are the
fallback chain — used when the model has not downloaded yet, or the sidecar failed — never the
default.** Their whole value is that they need nothing; their whole problem is that they are three
different products (see the verdict in Cross-platform strategy).

| OS | Command | Reachable quality | Streams? |
|---|---|---|---|
| macOS | `say` | Apple voices; the good ones are an opt-in download | ❌ into a pipe |
| Windows | PowerShell `System.Speech.Synthesis.SpeechSynthesizer` (SAPI 5) | David/Zira — the modern natural voices are *"not sanctioned for third-party use"* `[measured-third-party]` | unknown |
| Linux | `spd-say` → `espeak-ng` | Rule-based formant synthesis, or **nothing installed at all** `[measured-third-party]` | ✅ (espeak-ng is effectively instant) |

The macOS leg is the one I could measure, and it sets expectations for the others.

**Install.** None. `/usr/bin/say` and `/usr/bin/afplay` are present on a stock macOS 26.5
`[measured-here]`, and `say -v '?'` lists 184 voices `[measured-here]`. This is the only engine
that works on first run with nothing downloaded, which makes it the correct **fallback**, the
correct **first-run bridge while the default model downloads**, and the correct answer to `R5.4`
("degrades usefully… never a silent failure").

**Invocation and its cost.** `spawn('say', [text])` speaks to the default output device and
`kill()` stops it — barge-in works. The trap is startup: `say ""` — no text, no synthesis —
measured **414 ms min / 418 ms median over 5 runs** `[measured-here]`. `say -o out.aiff "Hi"`
measured 848 ms min. So a per-utterance `say` subprocess is a ~0.4 s tax before a single sample
exists, which is 8× the entire Piper synthesis. Rendering to a file, first bytes appeared at
**414–432 ms** and the full 9.38 s of audio was written in **1.86–1.88 s** `[measured-here]` —
i.e. `say` renders at roughly 5× real time once started, and the startup dominates.

**Two more macOS traps, found by the companion research pass.** (a) **Personal Voice is unreachable from
the CLI.** Terminal lacks the entitlement, so `say -v <PersonalVoice>` does not work — confirmed by the
maintainer of [`limneos/SavePersonalVoiceAudio`](https://github.com/limneos/SavePersonalVoiceAudio), who
built a workaround precisely because of it. Do not promise Personal Voice from a `say` wrapper.
(b) **`AVSpeechSynthesizer` silently ignores a second `speak()` while one is playing** — it neither queues
nor errors ([itnext.io](https://itnext.io/swift-avfoundation-framework-text-to-speech-tool-f3e3bfc7ecf7)).
A huddle-mode sidecar must manage its own queue and call `stopSpeaking(at:)` before re-speaking.
Note also this machine reported **0 voices matching "premium"/"enhanced"** out of 184 `[measured-here]` —
the good OS voices are an opt-in System Settings download, so quality out of the box is the low tier.

**Streaming.** `say -o /dev/stdout` produced **no bytes at all** `[measured-here]` — the CAF/WAVE
writers want a seekable file. So `say` cannot be piped as a stream; you get a file or you get
speakers. For low latency the only real fix on this platform is
**AVSpeechSynthesizer**, whose `write(_:toBufferCallback:)` hands back `AVAudioPCMBuffer`s
incrementally, and which keeps the synthesiser resident instead of respawning. That requires a
small Swift sidecar binary talking over a pipe — the same shape `yapper` and `speak11` use. Its
latency was **not measured** and is **unknown**.

---

## STT options

Forward-looking, for barge-in and voice input. Not needed for either headline feature today.

| Engine | Streaming | Offline | macOS | Latency | Licence | Call from Node |
|---|---|---|---|---|---|---|
| **`sherpa-onnx-node` `OnlineRecognizer`** | ✅ true streaming | ✅ | ✅ prebuilt arm64 `[measured-here]` | unknown | Apache-2.0 | **Already installed** if we use it for TTS — `OnlineRecognizer`, `OfflineRecognizer`, `KeywordSpotter`, `CircularBuffer` all exported `[measured-here]` |
| **`sherpa-onnx-node` `Vad`** | ✅ | ✅ | ✅ | unknown | Apache-2.0 | Exported from the same binary `[measured-here]`. This is the barge-in primitive. |
| **Apple Speech framework (`SFSpeechRecognizer` / macOS 26 API)** | ✅ | ✅ on-device | ✅ native | unknown | OS component | Swift sidecar. Reference implementation: [`FrigadeHQ/yap`](https://github.com/FrigadeHQ/yap) (MIT, macOS 26+, "no cloud/no API keys/no account") — the user starred it |
| **whisper.cpp** | chunked, not truly streaming | ✅ | ✅ Metal | unknown | MIT | Subprocess, or a community Node binding |
| **faster-whisper** | chunked | ✅ | via Python | unknown | MIT | Python sidecar — same dependency-weight objection |
| **Vosk** | ✅ | ✅ | ✅ | unknown | Apache-2.0 | `vosk` npm package (native) |
| **Silero VAD** | ✅ | ✅ | ✅ | unknown | MIT | ONNX; or use sherpa's bundled `Vad` |
| **WhisperKit** (Apple Silicon) | chunked | ✅ | ✅ CoreML-optimised | unknown | MIT | Swift sidecar |
| **Moonshine** | ✅ designed for streaming/edge | ✅ | ✅ | unknown | MIT | ONNX |
| **Parakeet / NVIDIA NeMo** | ✅ | ✅ | GPU-oriented | unknown | see repo | Python — heavy |
| **Deepgram / AssemblyAI streaming** | ✅ | ❌ | ✅ | unknown | Commercial | WebSocket |
| **WebRTC VAD** | ✅ | ✅ | ✅ | unknown | BSD | Well-worn, low quality vs Silero |
| **`ten-vad`** | — | — | — | — | — | **Not researched. Named in the brief, never actually searched — recorded as a gap, not a negative result.** |

`sherpa-onnx` is the **only local STT engine found with an official Node package**
`[measured-third-party]`; everything else needs a Python or Swift sidecar.
[`FrigadeHQ/yap`](https://github.com/FrigadeHQ/yap) is the working precedent for the
Swift-helper-around-Apple's-Speech-framework pattern, and the user starred it.

**Read as:** if we pick `sherpa-onnx-node` for TTS, the STT and VAD story is already paid for. That
is the strongest architectural argument in this report after the raw latency numbers.

---

## Audio playback — cross-platform, from Node

### The finding that may make most of this moot: sherpa ships its own streaming player

`bin/sherpa-onnx-offline-tts-play` (2.1 MB, in the same release tarball as the engine, for all six
platform+arch targets) **synthesises and plays concurrently**. Measured: 11.28 s of audio, synthesis
took **0.540 s** (RTF 0.048), wall clock **12.08 s** — i.e. it printed *"Start the playback thread"*
and streamed audio out while still generating, rather than rendering first `[measured-here]`. It
uses PortAudio internally, so it is one binary, no node-gyp, on every target.

**What that buys:** feature 1 ("hotkey speaks the selection") has a complete, cross-platform,
zero-extra-dependency answer today.

**What it does not solve, and why the table below still matters:**
- It takes text on **argv**, not a stream, so incremental text feeding for huddle mode is
  **unknown**.
- Stop control beyond killing the process is **undocumented** — the tool's own message says
  *"You can safely press ctrl + C to stop the playback."* Process kill measured instant elsewhere
  (0.9–1.5 ms), so this is probably fine, but mid-utterance pause/resume is not offered.
- It **couples synthesis and playback in one process**, which breaks the user's `R5.2` rule that
  playback belongs to the client so the synthesis service can be remote.

So: excellent default for the simple path, insufficient alone for huddle mode. The options below
remain the design space for streaming + barge-in.

### The general options

Everything in this table was tested on this machine today unless marked otherwise. This is the
detail that sinks designs, so the columns are behavioural, not aspirational. **The parity column is
new and now decisive:** an option that only exists on one OS cannot be the mechanism, only a
fallback. Detail and independent measurements are in
[`_track-c-cross-platform.md`](./_track-c-cross-platform.md).

| Option | Works on all 3 OSes without a native build | Present on stock macOS | Accepts raw PCM on **stdin** | Stops instantly | Gapless chunk concatenation | Needs node-gyp | Notes |
|---|---|---|---|---|---|---|---|
| **`afplay`** | ❌ **macOS only** | ✅ `/usr/bin/afplay` `[measured-here]` | ❌ — `afplay -` → *"unknown argument: -"*, and feeding a file on stdin → `AudioFileOpen failed ('typ?')`; independently reproduced twice `[measured-here]` | ✅ `kill()` returned in **0.9 ms** `[measured-here]` | ❌ — one process per file; [`speak11`'s changelog measures ~970 ms inter-sentence gap this way](https://github.com/smcantab/speak11/blob/475c5fa842c8ab91802298c06667603d0ba02b47/CHANGELOG.md#L7) `[measured-third-party]` | ❌ | File-only. Fine for "speak this one selection", wrong for huddle mode. |
| **`ffplay`** | ⚠ only if we build and bundle it ourselves: `ffplay-static` npm is **dead (last push 2017)** and `ffmpeg-static` **ships no `ffplay` at all** and has an open, maintainer-acknowledged **no-win-arm64** gap `[measured-third-party]` | ❌ (present here via Homebrew: `/opt/homebrew/bin/ffplay` `[measured-here]`) | ✅ — fed 8 KB PCM chunks to `-f s16le -ar 22050 -ch_layout mono -i pipe:0` and it played continuously `[measured-here]` | ✅ `kill()` returned in **1.5 ms** `[measured-here]` | ✅ — and holding a **FIFO** open keeps one `ffplay` alive across many synthesised chunks, so sentences concatenate gaplessly `[measured-third-party]` | ❌ | **The pragmatic streaming answer**, but ffmpeg is not preinstalled, so it cannot be the default path. |
| **`mpv`** | ✅ if bundled, ❌ if assumed present | ❌ (**not installed here** `[measured-here]`) | ✅ | ✅ | ✅ — `--idle=yes` + `loadfile … append` over its JSON IPC socket makes mpv own the gapless queue; the survey calls this *"the cheapest correct answer to streaming"* `[measured-third-party]` | ❌ | Best ergonomics, extra install. |
| **`sox` / `play`** | ✅ if bundled, ❌ if assumed present | ❌ (**not installed here** `[measured-here]`) | ✅ | ✅ | ✅ | ❌ | Same objection as ffplay, smaller. |
| **`speaker` (npm)** | ❌ — needs node-gyp on every platform | n/a | ✅ — it *is* a writable PCM stream | ⚠ **No — this is the disqualifier.** Its own issue tracker documents `speaker.end()` **hanging for seconds** plus post-`end()` CoreAudio buffer-underflow spam `[measured-third-party]` | ✅ | ⚠ **yes** — `0.5.5`, `MIT AND LGPL-2.1-only` `[measured-here]`; **does** build on Node 26.7 / arm64 via a manual `node-gyp rebuild` `[measured-third-party]`, but that is a build step on the user's machine | Cleanest API, but a player that cannot stop promptly cannot do barge-in. Also check the LGPL component before bundling. |
| **`naudiodon` / PortAudio bindings** | ❌ — node-gyp, and abandoned | n/a | ✅ | ✅ | ✅ | ⚠ yes | **Effectively abandoned** — last push 2024-03, with an open *"Is this package abandoned?"* issue and no confirmed Apple Silicon support `[measured-third-party]`. Do not build on it. |
| **Web Audio in an Electron renderer** | ✅ **fully portable — it is the same Chromium everywhere** | n/a (if ORCA is Electron) | ✅ via `AudioWorklet` / `AudioBufferSourceNode` | ✅ instant — `stop()` / disconnect | ✅ with scheduled buffer sources | ❌ | **Probably the best answer if ORCA has a renderer process.** No subprocess, sample-accurate scheduling, instant stop. Depends entirely on ORCA's plugin surface — see the ORCA-API research track. |
| **`node-web-audio-api`** (napi-rs → `web-audio-api-rs`) | ✅ **the only library verified to cover all 6, incl. `win32-arm64`** — the tarball bundles `.node` binaries for 7 targets, **no optional-dep split, no postinstall fetch, no compile** `[measured-third-party, tarball inspected]` | n/a | ✅ full Web Audio: `AudioContext`, `AudioBufferSourceNode`, `AudioWorkletNode` | ✅ `stop()` is spec'd sample-accurate; no stop-latency issues found on its tracker | ✅ native — `start(time)`/`stop(time)` against `currentTime` | ❌ **none** | **Best API by a distance**, actively maintained (pushed 2026-08-09). Costs: ~20 MB install (42 MB unpacked, all platforms shipped to everyone); Linux prebuilds use the `jack` feature so some distros need `pipewire-jack`; ALSA needs `latencyHint:'playback'` to avoid crackle. **But it is a `.node` loaded in-process** — see the macOS library-validation caveat below |
| **`audify`** (RtAudio) | ❌ — **zero `win32-arm64` prebuild assets** in its releases `[measured-third-party]` | n/a | ✅ | ✅ | ✅ | ❌ for 26+ published targets | Real streaming, but fails parity on win-arm64 and is ~a year stale |
| **`naudiodon2`** | ❌ — `gypfile: true`, `install: node-gyp rebuild`, **every install compiles, no prebuild path at all** `[measured-third-party]` | n/a | ✅ | unknown | ✅ | ⚠ **always** | The fork of abandoned `naudiodon` did not fix the thing it forked to fix |
| **`sherpa-onnx-offline-tts-play`** | ✅ **yes — one 2.1 MB binary per target, all six, no gyp** `[measured-here]` | ships in the engine tarball we already fetch | ✅ streams *while synthesising* `[measured-here]` | kill only (undocumented); process kill measured instant elsewhere | ✅ inherently — it is one continuous stream | ❌ | Couples synthesis to playback; argv input only. Best answer for feature 1, insufficient for huddle mode |
| **Swift sidecar (`AVAudioEngine` / `AudioQueue`)** | ❌ **macOS only** — would need a separate WASAPI helper for Windows and an ALSA/PipeWire one for Linux, i.e. three codebases | ✅ toolchain-free at runtime | ✅ over a pipe | ✅ | ✅ | ❌ (but needs a Swift build + signing) | What `speak11` and `yapper` do. Also the only route to AVSpeechSynthesizer's streaming buffers. |

**What `block/buzz` does, and why we cannot copy it.** buzz is Rust/Tauri, so its output stack is
a persistent `rodio` `Player` → `Mixer` → `cpal` (`tts_playback.rs:12-25`), with `cpal` used only
for output-device enumeration. Cancellation **swaps in a brand-new `Player`** and drops the old one
*after* releasing the coordinator lock, so a stop never blocks on the audio thread. **The pattern
transfers; the crates do not** — there is no Node equivalent of rodio, which is exactly why the
playback question below is still open for us while it was solved for them. buzz also uses
**sherpa-onnx (Parakeet)** for its STT leg — a third independent convergence on the same runtime.

### The ranking, and the one question it hangs on

Combining my measurements with the cross-platform pass, in order:

1. **`node-web-audio-api`** — the only Node audio library verified to cover **all six targets
   including `win32-arm64`** with zero compilation, plus spec-accurate scheduling, sample-accurate
   `stop()`, and a documented `sinkId: {type:'none'}` mode for headless CI `[measured-third-party]`.
   **Caveat that decides everything: it is a `.node` addon loaded in-process.** If ORCA's notarized
   macOS build refuses to `dlopen` an unsigned downloaded addon (see the sidecar section), this
   option dies on exactly one platform — which under parity means it dies.
2. **`sherpa-onnx-offline-tts-play`** — a **subprocess**, so it sidesteps that risk entirely, ships
   in the tarball we already fetch, covers all six targets, and was measured streaming audio while
   synthesising `[measured-here]`. Costs: it couples synthesis to playback and takes text on argv.
3. **Bundled `ffplay`/`mpv`/`sox`** — proven streaming and fast kill, but the npm wrapper ecosystem
   is broken (`ffplay-static` dead since 2017; `ffmpeg-static` ships no `ffplay` and has no
   win-arm64) `[measured-third-party]`, so this means building and shipping our own binaries per
   target — real release engineering, not off-the-shelf.
4. **Per-OS shell-out trio** — rejected. Not one interface with three binaries but three
   incompatible capability sets: `afplay` refuses raw PCM, PowerShell `SoundPlayer` is WAV-file-only
   with fire-and-forget playback, and the Linux trio is not guaranteed present at all
   `[measured-third-party]`.
5. **`audify`, `speaker`, `naudiodon2`** — rejected on parity or compilation.
6. **Web Audio in a renderer** — eliminated outright, see below.

**So the pivotal question is not "which player" — it is "can the ORCA plugin worker load a native
addon at all".** Both of the top two options are viable; which one wins is decided by that single
unanswered fact. Recommend answering it first, on a real notarized build.

**Conclusions — and the design space is now small.**

**0. Audio must come from a subprocess spawned by the plugin worker.** Not from a panel: the ORCA
track VERIFIED that the plugin panel iframe cannot play *or* fetch audio. The panel is good only for
controls (play/pause/voice picker) that message the worker. That single fact eliminates the option I
had ranked first, and it eliminates every in-renderer approach at once. Combined with "no node-gyp"
and "must work on six targets", the survivors are: **bundle a cross-platform player binary**, or
**use `sherpa-onnx-offline-tts-play`, which we are already downloading**. The latter needs no new
dependency at all and was measured streaming audio while synthesising `[measured-here]`. Start
there; reach for a bundled `ffplay`/`mpv` only when huddle mode needs incremental text input,
mid-utterance pause, or a decoupled remote synthesis service.

1. `afplay` cannot stream and cannot concatenate gaplessly. Any design that pipes each synthesised
   sentence to a fresh `afplay` inherits a ~1 s stutter between sentences `[measured-third-party]`.
2. Killing a playback subprocess **is** instant — 0.9–1.5 ms `[measured-here]`. Barge-in via
   process kill is viable; the hard part is not stopping, it is having a resident player to stop.
3. **Barge-in is not "kill the player".** Reading
   [`pipecat`'s `frames.py`](https://github.com/pipecat-ai/pipecat) shows its `InterruptionFrame` is a
   *control signal* that both **cancels in-flight TTS generation** and **flushes already-buffered local
   playback** `[measured-third-party]`. Killing only the player leaves the synthesiser churning out audio
   for text the user already interrupted. Our provider interface must carry the same two-sided cancel.
4. There is **no preinstalled binary on any of the three OSes** that we can rely on for streaming
   PCM `[measured-here]` — on macOS `afplay` refuses stdin and `sox`/`mpv` are absent; on Windows and
   Linux the situation is different but no better (detail in the cross-platform companion). Under a
   parity requirement, "assume it's installed" is not a strategy on any platform. Bundle or use the
   engine's own player.
   That is the sharpest constraint in this document. The three ways out are: a bundled Swift audio
   sidecar, Web Audio in an ORCA renderer, or accepting a Homebrew dependency (`ffplay`/`mpv`).
5. `npm speaker` — the one option with a native PCM-stream API — is disqualified by its documented slow
   `end()`, and `naudiodon` is abandoned `[measured-third-party]`. **There is no maintained, instant-stop,
   gyp-free Node audio-output package.** Plan around a sidecar or a renderer, not around an npm package.

---

## Provider interface implications

To accommodate everything above — a preinstalled CLI, an in-process native addon, a Python HTTP
sidecar, and a cloud WebSocket — the abstraction must carry:

1. **A pull-based async chunk stream, not a buffer.** `generate(text) -> AsyncIterable<AudioChunk>`,
   after [`MLXRead`'s `SpeechEngine`](https://github.com/rogu3bear/mlxread/blob/ad3286998f70a3cfd8aa16581f45f441a47dc496/MLXRead/Speech/SpeechEngine.swift#L8-L23):
   `id` / `displayName` / `sampleRate` / `prepare()` / `generate()` / `cancel()`. An engine that
   can only return a whole buffer satisfies it by yielding once.
2. **`cancel()` as a first-class method, not `kill(pid)`.** Barge-in (`R2.5`) means every provider
   must be interruptible, whether that is a process kill, an abort signal on a fetch, or a flag
   read by an ONNX callback.
3. **`sampleRate` and format declared per provider, per utterance.** Measured spread already:
   Piper 16 kHz, Kokoro 24 kHz, Pocket TTS 24 kHz `[measured-here]`, `say` whatever you ask for,
   cloud engines mp3/opus/PCM. The playback layer needs a resampler or a per-utterance re-open.
   `sherpa-onnx-node` exports a `LinearResampler` `[measured-here]`.
4. **A `prepare()`/warm-up separate from construction.** Model load measured 282–441 ms
   `[measured-here]`; `speak11` documents a one-character warm-up generation saving a further
   ~400 ms of phonemiser init `[measured-third-party]`. The provider must be able to say "I am
   warm" so the UI can show it (`R7.3`).
5. **A capability descriptor.** `{ streaming: bool, offline: bool, needsApiKey: bool,
   needsModelDownload: bytes, licence: string, cloning: bool }`. The UI needs this to warn that
   text leaves the machine (`R3.5`), to show a download size before starting one, and to surface a
   non-commercial licence before use.
6. **Text segmentation belongs *above* the provider, not inside it.** Agent replies are markdown;
   [`speechPlanner.ts`](https://github.com/seanbud/Kokoro-Clipboard-TTS/blob/98c96b8e9bc7b9f79856215accce92bd1afb797c/src/utils/speechPlanner.ts)
   already solves fences, blockquotes, initialisms and source-position mapping in TypeScript. One
   segmenter feeding every provider keeps engines swappable and voices consistent.
7. **Incremental text input for huddle mode.** The interface must accept `addText(chunk)` /
   `finish()` while the agent is still generating, not only a complete string — the
   `SentenceBoundaryDetector` shape from
   [`wyoming-piper`](https://github.com/OHF-Voice/wyoming-piper/blob/fd78db7f40f59c17207840402f7df70808ff8dd3/wyoming_piper/handler.py#L99-L172).
   Only Picovoice Orca offers this natively; for everyone else we implement it above the provider.
8. **A single-flight playback lock and a session token.** Both `claude-code-tts` (playback mutex)
   and [`Kokoro-Clipboard-TTS`'s `playback_session.py`](https://github.com/seanbud/Kokoro-Clipboard-TTS/blob/98c96b8e9bc7b9f79856215accce92bd1afb797c/sidecar/playback_session.py)
   (request-token session controller returning `409 stale_session`) arrived at this independently.
   Without it, a second hotkey press overlaps the first.
9. **The provider must not own playback.** The user's `R5.2`/architecture note: if the synthesiser
   plays audio, it must live on the machine with the speakers, and one GPU box can no longer serve
   several machines. Providers emit PCM; a separate sink plays it.

---

## Newer than you'd expect — 2026 entrants worth re-checking

Surfaced by the companion local-engine pass; none measured here, all recorded so a later decision doc
does not have to rediscover them.

| Engine | Shipped | Licence | Claim | Why watch it |
|---|---|---|---|---|
| [Kyutai Pocket TTS](https://github.com/kyutai-labs/pocket-tts) | Jan 2026 | MIT (⚠ ONNX export non-commercial; **voices are not uniformly MIT** — check [`kyutai/tts-voices`](https://huggingface.co/kyutai/tts-voices) per voice) | ~200 ms first chunk, ~6× RT on M4 `[claimed]` | Already our recommended upgrade — measured 210–278 ms/sentence `[measured-here]` |
| [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) | 2026 | Apache-2.0 | **~97 ms** `[claimed, unverified community thread]` | If the number holds and it runs on CPU, it beats everything here. Unverified. |
| [Microsoft VibeVoice-Realtime-0.5B](https://github.com/microsoft/VibeVoice) | 2026 | MIT | ~300 ms `[claimed, secondary source]` | The 0.5B realtime variant is the interesting one; the 7B needs 23.7 GB VRAM `[measured-third-party]` |
| [Chatterbox-Nano](https://github.com/resemble-ai/chatterbox) | 2026 | MIT | 110M params, "3× realtime on 8 CPU cores" `[claimed]` | CPU-first sibling of the GPU-bound Chatterbox |
| [Supertonic 3](https://github.com/supertone-inc/supertonic) | 2026 | MIT | TTFA ~0.05 s `[measured-third-party, contested]` | Best-fitting spec found; undercut by discontinuation |

---

## Risks

| Risk | Detail | Mitigation |
|---|---|---|
| **Kokoro's reputation vs its measured speed** | Kokoro is the obvious pick by star count and voice count; it measured **16–25× slower than Piper** and slower than `say`'s spawn floor on this machine `[measured-here]`. int8 is *slower than FP32*, reproducing [kokoro#291](https://github.com/hexgrad/kokoro/issues/291). | Default to Piper. Offer Kokoro as a quality option with its latency shown in the UI. Re-measure on Intel Macs before generalising. |
| **`sherpa-onnx` appears to embed espeak-ng (GPL) inside an Apache-2.0 runtime** | My Piper synthesis worked with **no `espeak-ng` binary installed on this machine** (`which espeak-ng` → MISSING) `[measured-here]` — sherpa only needed the `espeak-ng-data` directory. That means the phonemiser is compiled **into** the sherpa binary. espeak-ng is GPL-3.0-or-later; sherpa-onnx declares Apache-2.0. | Not our licence to resolve, but it is upstream of our whole stack and of ORCA's existing STT. **Get this checked before the repo picks a licence.** Note we redistribute nothing — the binary is fetched at runtime — which is the weakest coupling available. |
| **Piper voices are GPL-3.0** | The maintained [`piper1-gpl`](https://github.com/OHF-Voice/piper1-gpl) is GPL-3.0 and *"embeds espeak-ng for phonemization"*; espeak-ng is **GPL-3.0-or-later** and sits under Kokoro, KittenTTS and StyleTTS2 too. The old MIT [`rhasspy/piper`](https://github.com/rhasspy/piper) is archived. The user's own issue names this as unresolved: *"whether that reaches a derivative as distributed is an unresolved legal question, not a technical one."* | We invoke a separately-downloaded ONNX model through an Apache-2.0 runtime rather than linking GPL code, which is the weakest coupling available. Still needs a decision before the plugin picks a licence. **Do not bundle model weights in the npm package.** |
| **Pocket TTS ONNX export is non-commercial** | The sherpa model card says *"It is for non-commercial"* while upstream is MIT `[measured-here]`. | Opt-in download only, licence shown at the prompt. Investigate a permissively-licensed export before promoting it. |
| **Model download size and first-run experience** | Piper amy-low is a 67 MB download; Kokoro FP32 is 360 MB `[measured-here]`. A hotkey that does nothing for 60 s on first press is a broken hotkey. | Ship with `say` active from install; download the default model in the background; switch over when warm and say so in the UI. |
| **Python/PyTorch dependency creep** | The user's catalogue documents a 27 MB model pulling **6 GB and 7.1 GB** of Python dependencies in two independent first-hand reports `[measured-third-party]`. | Hard rule: **no Python in the default path.** ONNX-runtime engines only (Piper, Kokoro, Pocket, Kitten, sherpa). |
| **npm's sherpa packages omit `win-arm64`** | Five of six on npm at 1.13.6 `[measured-here]`; ORCA's own STT hardcoded Windows to x64 because of it (`stt-service.ts:556-577`). | **Resolved:** source binaries from the GitHub release, which does ship `win-arm64-shared-MD-Release` `[measured-here]`. Residual risk is only that a future release drops it — pin and verify per version in CI. |
| **Native-addon distribution** | `npm speaker` and `naudiodon` need node-gyp; a failed compile on a user's machine is an uninstallable plugin, and a Windows box with no toolchain is the common case. `sherpa-onnx-node` avoids this entirely — no `gypfile`, no install script `[measured-here]`. | Hard rule: **no package that compiles on the user's machine.** Applies to playback as much as to synthesis. |
| **OS-native fallbacks are three different products** | macOS gets Apple voices, Windows realistically gets SAPI 5 David/Zira because the modern natural voices are *"not sanctioned for third-party use"*, Linux gets espeak-ng formant synthesis or nothing `[measured-third-party]`. | Never the default. Label the fallback in the UI as a fallback, with its per-OS name, so the user knows why it suddenly sounds different. |
| **sherpa release assets are `.tar.bz2` and Node has no bzip2** | Node 26 `zlib` offers gzip/brotli/zstd only `[measured-here]`. Bare HF Piper `.onnx` files are not a workaround — sherpa rejects them with `'sample_rate' does not exist in the metadata` `[measured-here]`. | Ship the pure-JS `unbzip2-stream` + `tar-stream` path (verified: 397 entries / 81 MB in 4.7 s, no native build `[measured-here]`), or re-host the models as `.tar.gz`. |
| **macOS library validation may block an in-process native addon** | The plugin worker is a forked Electron binary inheriting ORCA's signature; `com.apple.security.cs.disable-library-validation` is absent from the entitlements, so `dlopen` of an unsigned downloaded `.node` is expected to fail on a **notarized release build** — and **a dev build will not reproduce it**. INFERRED, not yet verified. | Run the engine as a **spawned sidecar**, ideally sherpa's own prebuilt CLI executable. Then verify empirically on a real notarized build before locking the design. This is the single highest-consequence unknown in the report. |
| **A 50 MB / 2,000-file plugin cap, and no `npm install` at install time** | `MAX_PLUGIN_FILES = 2_000`, `MAX_PLUGIN_TOTAL_BYTES = 50 MB` (`plugin-content-hash.ts:15-16`); install is a clone + copy with no build step (`plugin-git-repository.ts:33-41`). One decent voice is already ≥ the whole budget, and `optionalDependencies` never resolve. | Bundle to a single `main.mjs`. Fetch the sherpa platform binary, `espeak-ng-data` and the voice at runtime into a cache outside the install tree, mirroring `src/main/speech/model-manager.ts`. |
| **`sherpa-onnx` cannot load models from non-ASCII Windows paths** | Documented in ORCA's own tree (`model-cache-path.ts:46-66`) for sherpa 1.12.x — a username like `Björn` breaks model loading. We use the same runtime, so we inherit it. Parity is a hard requirement, so this is not an edge case. | Mirror ORCA's workaround: hash the path, relocate under an ASCII shared root, migrate with `.partial` + atomic rename. Port `model-manager-windows-path.test.ts`. **Re-check whether 1.13.6 still has the bug.** |
| **The plugin worker env has no `APPDATA`/`LOCALAPPDATA`/`XDG_*`** | `plugin-worker-env.ts:8-27`. Every standard Node cache-dir library (`env-paths` and friends) reads exactly those variables, so none of them work inside an ORCA plugin worker. | Derive from `HOME`/`USERPROFILE`, or from `pluginRoot`. Both fragile — treat as an open design question and write it up in `docs/.discussion/`. |
| **Model cache location** | Writing models under `node_modules` means a reinstall re-downloads 60 MB, and on Windows deep paths risk the 260-char limit. | Use per-OS conventions (`env-paths` shape). Verify long-path behaviour on Windows before shipping. |
| **No preinstalled streaming audio sink on macOS** | `afplay` refuses stdin; `sox`/`mpv` absent; `ffplay` only via Homebrew `[measured-here]`. | Decide with the ORCA-API track: Web Audio in a renderer if ORCA is Electron, otherwise a bundled Swift sidecar. Do not assume Homebrew. |
| **API keys and data egress** | Cloud providers break `R3.4` outright and require disclosure — OpenAI's guide requires telling users the voice is AI-generated; ElevenLabs' free plan is personal-use-only with attribution `[measured-third-party]`. | Cloud is opt-in, never default; store keys in the OS keychain; show "text leaves this machine" in the UI. |
| **`edge-tts` looks free and is not safe** | Undocumented Microsoft endpoint with no third-party grant, and a documented history of mass-403 waves and endpoint migrations in 2024–2025 `[measured-third-party]`. | Do not ship it. |
| **Supertonic is being discontinued** | CAUTION banner added 2026-07-23; Voice Builder service ends 2026-08-31 `[measured-third-party]`. It otherwise fits our spec best of anything found (MIT, 31 languages, Core ML, claimed 0.05 s TTFA). | Do not adopt as default. If wanted, use the `sherpa-onnx` mirrored int8 conversion so the weights survive upstream. |
| **XTTS / StyleTTS2 / F5-TTS weight licences diverge from their code licences** | XTTS-v2 code is MPL-2.0 but weights are under the restrictive non-standard **CPML**; StyleTTS2 pretrained models carry a **voice-consent usage obligation**; F5-TTS's Emilia training-data terms bleeding into the checkpoint are **unverified** `[measured-third-party]`. | None of these are candidates for us. Recorded so nobody adds them later without reading the weight licence separately from the repo licence. |
| **`Picovoice/orca` name collision** | An on-device streaming TTS engine literally named Orca, which the user starred, in a repo about an agent named ORCA. | Always disambiguate in docs. Also note it is disqualified as a default by its AccessKey internet check. |
| **Duplicating the user's own project** | `TTS-Hotkey-AI-Read-Clipboard-CLI` specifies feature 1 in full and is in requirements phase. | Treat this plugin as a *host* for that design. Reuse R1–R9 as our acceptance criteria; feed measurements back to that issue. |

---

## Open questions for the team

> **Answer number 5 first.** *Can the ORCA plugin worker load a native addon on a notarized macOS
> build?* It is the only question that changes an architectural choice rather than a parameter: it
> decides between `node-web-audio-api` (better API, all six targets) and a spawned-subprocess player.
> Everything else can be settled later or in CI.

1. ~~Does ORCA have a renderer we can play audio in?~~ **Answered: no.** The plugin panel iframe's
   CSP and sandbox forbid both playing and fetching audio (VERIFIED by the ORCA track). Audio comes
   from a worker subprocess. Remaining question: can `sherpa-onnx-offline-tts-play` be driven
   incrementally enough for huddle mode, or do we need a separate bundled player?
2. **Is there a permissively-licensed Pocket TTS ONNX export?** Upstream is MIT; the export sherpa
   ships is not. Unverified either way.
3. ~~Does sherpa prebuild for all targets?~~ **Answered: yes, all six** — via GitHub releases.
   npm covers only five `[measured-here]`.
4. **Does `OfflineTts`'s `callback` option ever fire?** It did not in my run `[measured-here]`.
   If intra-utterance streaming works, per-sentence latency drops further.
5. **Does `dlopen` of a downloaded `.node` actually fail in a notarized ORCA build?** Everything I
   measured ran in-process in a plain `node`, the case that does not reproduce it. Needs a human on
   a real release build. *Partly de-risked:* standalone executables exist, so the sidecar route does
   not depend on the answer `[measured-here]`. The question only decides whether the faster
   in-process option is also available.
6. **What does the sidecar IPC hop cost end-to-end?** Unmeasured. My figures are synthesis only.
7. **Does sherpa-onnx 1.13.6 still have the non-ASCII Windows path bug?** ORCA's workaround cites
   1.12.x. If fixed, we can drop a chunk of mirrored complexity.
8. **AVSpeechSynthesizer's real time-to-first-buffer on macOS 26.** Unknown; would decide whether
   the zero-download path can also be the low-latency path. Same question unanswered for Windows
   SAPI 5 and Linux `spd-say`.
9. **Do `ubuntu-latest` and `windows-latest` runners have any audio device?** Unknown. Settle with a
   device-enumeration smoke test, not more searching.
10. **Does `windows-latest` even have SAPI 5 voices installed?** Unknown — assert
    `GetInstalledVoices()` is non-empty in CI before relying on the Windows fallback.
11. **Do these numbers hold on Intel Macs, Linux and Windows?** Every measurement here is Apple
   Silicon. Under a parity requirement the same benchmark must be re-run on all three OSes — in CI,
   since synthesis needs no audio device — before the default is locked.
12. **Is Qwen3-TTS's claimed 97 ms real, and does it run on CPU?** If yes it reorders this whole table.
   The claim traces to an unverified community thread.
13. **`ten-vad` was never researched.** Named in the research brief, missed in execution. Gap, not a
   negative finding.
