# Track B — Cloud/API TTS, STT/VAD, and Node/macOS audio playback (as of 2026-08-20)

Research method: `duckduckgo-search` + `web-scraper` skills for discovery/primary docs, `github-search`/`gh api` for
repo health and issue history, and direct `Bash` measurement on this machine (macOS 26 "Darwin 25.5.0", Apple
Silicon arm64, Node v26.7.0). All raw search/scrape envelopes are saved under
`.research/prior-art-search/` in this repo (created for this pass). Every number below is labeled
**MEASURED-ON-THIS-MACHINE**, **MEASURED** (a third party's own benchmark, cited), or **CLAIMED** (vendor marketing
copy, cited) — anything I could not verify is marked **unknown** rather than guessed.

---

## Area 1 — Cloud/API TTS with streaming

| Provider / model | TTFB latency | Streaming transport | Input streaming (feed text as LLM generates)? | Audio formats | Price / 1M chars (or stated unit) | API key | Node SDK |
|---|---|---|---|---|---|---|---|
| **ElevenLabs** Flash v2.5 / Turbo | ~75ms **model inference** (CLAIMED, ElevenLabs docs); TTFA = inference + network + server overhead, no single verified end-to-end number published | WS (`/v1/text-to-speech/{id}/stream-input`, bidirectional) + SSE-style chunked HTTP stream | Yes — WS endpoint explicitly designed for incremental text as it's generated | mp3 (default), PCM 44.1kHz on Pro+ tier, opus/other via `output_format` | Credit-based, not flat $/char (credits vary by model/tier); Business tier states "low-latency TTS as low as 5¢/minute" | Required | Yes — official `elevenlabs` npm package, actively maintained (441★, pushed 2026-08-14) |
| **OpenAI** `gpt-4o-mini-tts` | unknown (no published TTFB number found) | Chunked HTTP streaming via `v1/audio/speech`; also reachable through the Realtime API (`v1/realtime`) for full duplex | Yes, via the Realtime API (`gpt-4o-mini-realtime` shares the underlying transport) | mp3, opus, aac, flac, wav, pcm | $0.60/1M input text tokens + $12/1M output audio tokens (token-based, not char-based) (developers.openai.com) | Required | Yes — official `openai` npm SDK, ubiquitous |
| **Azure AI Speech** | Exposes `SynthesisFirstByteLatencyMs` as a first-class SDK property (so it's measurable per-call, not a marketing figure) — no single vendor-quoted number | WS-based Speech SDK (chunked audio events) + REST streaming | Partial — SSML must be complete per request; SDK doesn't support incremental token-by-token text injection the way ElevenLabs/Rime WS does | mp3, wav, ogg/opus, raw pcm (many bitrate variants) | ~$16/1M chars (Neural voices), per `texttolab.com` secondary summary of Azure's own pricing page — **not independently re-verified against the live Azure pricing page in this pass** | Required (Azure key/region) | Yes — `microsoft-cognitiveservices-speech-sdk` npm package |
| **Google Cloud TTS** (Chirp 3 HD / Gemini-TTS) | "low-latency streaming" (CLAIMED, cloud.google.com marketing copy, no ms figure published on the page scraped) | gRPC streaming synthesis API | Chirp 3 HD advertises this for "spontaneous conversational" agent use; Gemini-TTS is prompt-steerable but request-based, not confirmed incremental-token streaming | LINEAR16/PCM, mp3, ogg/opus, mulaw/alaw | unknown — not captured in this pass (Google's public per-char TTS pricing page was not scraped) | Required (GCP service account/API key) | Yes — `@google-cloud/text-to-speech` npm package |
| **Amazon Polly** | unknown — AWS doesn't publish a TTFB figure; Polly's streaming API returns audio as an `AudioStream`, effectively chunked-HTTP, not WS | HTTP streaming response (`SynthesizeSpeech` returns an audio stream you read incrementally) | No — Polly's API is request/response per text block; no persistent incremental-text WS channel | mp3, ogg_vorbis, pcm | Standard $4/1M, Neural $16/1M, Long-Form $100/1M, **Generative $30/1M** chars (aws.amazon.com/polly/pricing, MEASURED from live pricing page) | Required (AWS IAM) | Yes — `@aws-sdk/client-polly` |
| **Amazon Polly (older `amazon-polly-streaming` community pattern)** | n/a | n/a | n/a | n/a | n/a | n/a | Third-party `amazon-polly-streaming` PyPI package exists (Python only, not Node) — noted as an outlier community pattern, not usable directly from Node |
| **Deepgram Aura-2** | "sub-200ms TTFB" (CLAIMED, deepgram.com/learn — Deepgram's own launch post) | HTTP streaming + WS | Yes — Deepgram's Voice Agent API pipes STT→LLM→TTS over a persistent WS session designed for incremental text | mp3, opus, flac, mulaw, alaw, linear16 (many) | Pricing shown as **per-minute**, not per-char, on deepgram.com/pricing (rates vary by model, e.g. Flux STT $0.0065–0.0078/min); Aura-2 TTS pricing not captured as a flat $/1M-char figure in this pass — **unknown**, needs a follow-up pricing-page fetch scoped to Aura specifically | Required | Yes — official `@deepgram/sdk` npm package |
| **Cartesia Sonic** (Sonic-3 / 3.5 / 3.6) | Widely repeated "40ms" TTFB figure across secondary reviews (texttolab.com, MarkTechPost) — **CLAIMED via secondary sources**; Cartesia's own `cartesia.ai/sonic` marketing page does not itself state a numeric ms figure in the scraped content, so this is not a confirmed primary-source number in this pass | WS + streaming HTTP | Yes — positioned explicitly as the "voice layer" for real-time agents | Multiple, incl. raw PCM | Credit-based: Pro $5/mo=100K credits, Startup $49/mo=1.25M credits, Scale $299/mo=8M credits (cartesia.ai/pricing, MEASURED from live page); no flat $/1M-char conversion published | Required | Yes — official `@cartesia/cartesia-js` npm package (per Cartesia docs ecosystem; not independently scraped in this pass) |
| **PlayHT** (PlayDialog engine) | unknown — no ms figure captured; PlayHT publishes a dedicated "Techniques to guarantee the lowest latency" guide implying no single headline number | Node streaming: `PlayHT.stream()` returns a readable stream of chunks (`stream.on('data', ...)`) over HTTP, plus a documented WS mode | Yes — PlayHT explicitly documents "Input Streaming with LLMs" as a first-class guide | mp3 (default `output_format`), others available | unknown (pricing page not scraped this pass) | Required (`X-USER-ID` + API key) | Yes — official `playht` npm package (docs.play.ht Quickstart shows `npm install playht`) |
| **Rime** (Mist v3 / Coda) | "sub-200ms end-to-end" via cloud API; Mist v3 has "the lowest measured time to first audio" of Rime's own lineup (CLAIMED, docs.rime.ai/docs/latency — Rime's own docs, includes a stated benchmark methodology: single Lambda H100 SXM machine) | HTTP streaming, WS (`/ws3`), and SSE (Mist v2) — Rime states explicitly "All Rime models stream" | Yes — WS is the documented recommendation specifically "you can feed text in as your LLM generates it" | Opus, MP3, WAV, PCM, G.711 μ-law | unknown (pricing page not scraped this pass) | Required | Node SDK existence not directly confirmed in this pass — Rime's docs are transport-level (raw WS/HTTP), and integrations exist for LiveKit/Pipecat/Vapi/Daily; a dedicated `rime` npm package was not confirmed — **unknown, verify before depending on it** |
| **Hume Octave** | "Start playback in milliseconds" (CLAIMED marketing copy, hume.ai/octave, no ms figure) | Chunked streaming output | Not clearly documented as incremental-input streaming (the page describes output streaming, not input-token streaming) | mp3, wav, ogg, flac, raw PCM | unknown (pricing page not scraped; a third-party post claims "from $7.60" but that's a reseller/estimate site, not primary) | Required | "Full SDK support for Python, TypeScript, .NET, Swift" per hume.ai — TypeScript SDK exists |
| **Groq TTS** (`canopylabs/orpheus-v1-english`, via PlayAI/Orpheus models) | unknown — Groq's docs page emphasizes throughput ("fast"), not a published TTFB ms figure | Request/response via OpenAI-compatible `/v1/audio/speech`; no evidence of a WS streaming mode in the scraped docs | No — no incremental-text WS documented; looks like standard request/response, same shape as OpenAI's non-Realtime TTS endpoint | wav (default), others via `response_format` | unknown (Groq's per-token/per-char TTS pricing not captured; Groq is generally priced per-token like their LLMs) | Required | Yes — official `groq-sdk` npm package, code sample shown directly in console.groq.com/docs/text-to-speech |

**Sources (primary, fetched this pass):**
- elevenlabs.io/docs/eleven-api/concepts/latency, elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization, elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tts, elevenlabs.io/pricing
- developers.openai.com/api/docs/models/gpt-4o-mini-tts
- learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-lower-speech-synthesis-latency (page itself gated behind an auth notice in the scrape, but the latency-property table rendered)
- cloud.google.com/text-to-speech
- aws.amazon.com/polly/pricing
- deepgram.com/learn/introducing-aura-2-enterprise-text-to-speech, deepgram.com/pricing
- www.cartesia.ai/sonic, www.cartesia.ai/pricing
- docs.play.ht (Quickstart / reference/api-getting-started)
- docs.rime.ai/docs/latency, docs.rime.ai/docs/streaming
- www.hume.ai/octave (hume.ai homepage, Octave section)
- console.groq.com/docs/text-to-speech

**What this means for ORCA's huddle mode:** the field has converged hard on two shapes — (a) a persistent WebSocket
that accepts incremental text and emits incremental audio chunks (ElevenLabs, Rime, Deepgram, and implicitly
OpenAI's Realtime API), which is the right fit for "speak the agent's reply as it streams," and (b) simple
request/response streaming (Polly, Groq's TTS, Google's non-Realtime Chirp) which is a poor fit for low-latency
incremental speech because it requires accumulating a full sentence/utterance before the request goes out. Rime and
ElevenLabs are the two vendors whose **own docs** explicitly recommend the WS mode *because* it lets you "feed text
in as your LLM generates it" — that's the exact ORCA huddle-mode shape, and both are primary-source confirmed (not
just inferred).

---

## Area 2 — STT (forward-looking, for barge-in) and VAD

| Engine | Streaming? | Latency | Offline? | macOS support | Call from Node? |
|---|---|---|---|---|---|
| **whisper.cpp** | Yes — dedicated `examples/stream/stream.cpp` (github.com/ggml-org/whisper.cpp) | unknown exact ms (varies with model size/quantization); community "real-time streaming" guides exist but no vendor-measured figure captured | Yes, fully offline, runs local GGML models | Yes — first-class (Metal-accelerated on Apple Silicon) | Via child-process spawn of the compiled binary, or community node bindings (`whisper-node`, `nodejs-whisper` — not independently verified in this pass); no official Node SDK from the ggml-org project itself |
| **faster-whisper** | Streaming wrappers exist community-side (e.g. `local-stream-asr`, `live-asr-sherpa`) but the core CTranslate2-based project is primarily a batch/offline transcription library, not natively streaming | unknown | Yes, offline | Yes (Python + CTranslate2, works on Apple Silicon CPU; no native Metal path — this is a **gap vs. whisper.cpp** for a macOS-first plugin) | No native Node binding; would require a Python subprocess bridge |
| **WhisperKit** (argmaxinc) | Streaming-oriented, designed for on-device real-time transcription (argmaxinc/WhisperKit, 6,333★, pushed 2026-08-13) | unknown ms; Argmax markets Apple Neural Engine acceleration but no ms figure captured in this pass | Yes, fully on-device | Yes — **Apple Silicon–native** (Swift, CoreML/ANE), the most macOS-idiomatic option of the STT engines surveyed | Swift-only; would need a small helper process (same pattern as an AVAudioEngine playback helper) bridged to Node via stdio/IPC — no direct Node binding |
| **Apple `SFSpeechRecognizer` / new Speech framework** (via **FrigadeHQ/yap**) | Yes — yap is "free, open source voice dictation for macOS...on-device transcription with Apple's Speech framework, no cloud/no API keys" (366★, pushed 2026-08-12) | unknown ms, but Apple's on-device recognizer is generally the lowest-friction/lowest-latency option since it's OS-native and requires no model download | Yes — fully on-device, uses Apple's shipped models | **Native** — this *is* the macOS platform API | No Node SDK; yap itself is a standalone macOS app (Swift). The pattern to copy for ORCA: a tiny Swift CLI/daemon wrapping `SFSpeechRecognizer`, driven from Node via stdio/IPC, mirroring the same "small native helper" shape as an AVAudioEngine playback helper |
| **Vosk** | Yes, designed for streaming | unknown ms | Yes, offline, small models | Yes (portable, C library with bindings) | Yes — `vosk` npm package exists (community-maintained, not independently verified for freshness in this pass) |
| **sherpa-onnx** (k2-fsa) | Yes — explicit streaming ASR docs and examples (k2-fsa.github.io/sherpa/onnx/javascript-api) | unknown ms | Yes, fully offline, ONNX Runtime | Yes — explicitly lists macOS, plus embedded/mobile targets | **Yes, directly** — official `sherpa-onnx-node` / `sherpa-onnx` npm packages with a documented WebAssembly (browser + Node.js) path (deepwiki.com/k2-fsa/sherpa-onnx/4.1). This is the **most Node-native** of the local STT options surveyed. |
| **Moonshine** | unknown streaming support — search surfaced mostly NeMo/Parakeet content, not a strong primary Moonshine source this pass | unknown | Yes (small on-device model, designed for low-power/edge) | unknown — not independently confirmed | unknown |
| **Parakeet / NVIDIA NeMo** | NeMo framework supports streaming ASR (docs.nvidia.com/nemo-framework), Parakeet-TDT models published on Hugging Face (nvidia/parakeet-tdt-0.6b-v3) | unknown ms | Models can run offline once exported (ONNX/ TensorRT), but the NeMo toolkit itself assumes a Python/CUDA-oriented workflow | Weak — this is a GPU/NVIDIA-oriented stack, not macOS-native; would need ONNX export to be usable outside CUDA, at which point sherpa-onnx (which explicitly supports importing NeMo/Parakeet models) is the more macOS-practical delivery path | Only via ONNX export + a runtime like sherpa-onnx; no direct Node path from NeMo itself |
| **Deepgram / AssemblyAI streaming APIs** | Yes, cloud WS streaming STT | Deepgram Flux streaming priced at $0.0065–0.0078/min (deepgram.com/pricing, MEASURED from live page); latency ms not captured this pass | No — cloud-only, requires network + API key | N/A (cloud) | Yes — official `@deepgram/sdk`; AssemblyAI has an official Node SDK too (not independently re-verified this pass) |
| **Silero VAD** | Yes — purpose-built streaming VAD, `VADIterator` explicitly for streaming use (deepwiki.com/snakers4/silero-vad/5.1) | Sub-ms per-frame inference cited by third-party integration guides (soniqo.audio, not Silero's own repo — **secondary, no primary ms figure located** in this pass) | Yes, ONNX model, fully offline | Yes, ONNX Runtime cross-platform | Yes — community `@jjhbw/silero-vad` npm package exists (10,023★ for the core `snakers4/silero-vad` repo, pushed 2026-08-18 — actively maintained) |
| **WebRTC VAD** | Yes, frame-by-frame streaming by design (it's the classic real-time telephony VAD) | Extremely low (sub-frame, ~10-30ms frame sizes), well-established, but no fresh 2026 benchmark captured this pass | Yes, offline, tiny GMM-based model, no ML runtime needed | Yes, C library with widely available bindings | Community npm bindings exist (`node-webrtcvad` and similar); not independently verified in this pass |
| **ten-vad** | Not independently researched this pass — named in the brief but no search was run for it | unknown | unknown | unknown | unknown |

**Sources (primary, fetched/confirmed via `gh api` this pass):**
github.com/ggml-org/whisper.cpp (53,054★, pushed 2026-08-20), github.com/argmaxinc/WhisperKit (6,333★, pushed
2026-08-13), github.com/FrigadeHQ/yap (366★, pushed 2026-08-12), github.com/k2-fsa/sherpa-onnx (14,271★, pushed
2026-08-18), github.com/snakers4/silero-vad (10,023★, pushed 2026-08-18), huggingface.co/nvidia/parakeet-tdt-0.6b-v3,
docs.nvidia.com/nemo-framework.

**Gap flagged:** `ten-vad` was named in the research brief but not actually searched this pass — that's a real gap,
not an "unknown after looking," and should be a follow-up before this table is treated as final.

**What this means for ORCA:** for a macOS-first, single-user plugin, the two standout **local** options are
**sherpa-onnx** (only engine surveyed with an official, actively-maintained Node package and native streaming
ASR — avoids a subprocess bridge entirely) and **a small Swift helper around Apple's own Speech framework**
(FrigadeHQ/yap is a directly-citable, working example of exactly that architecture, on-device, zero API key, zero
cloud dependency). WhisperKit is the highest-quality on-device option but Swift-only, so it inherits the
"native-helper-process" pattern rather than being Node-callable directly.

---

## Area 3 — Audio playback from a Node/TypeScript process on macOS

**Environment probed:** macOS 26 "Darwin 25.5.0", Apple Silicon (arm64, "MacBook-Air.local"/T8142), Node v26.7.0,
npm 11.19.0. Binaries present: `afplay` (`/usr/bin/afplay`), `ffplay`/`ffmpeg` (`/opt/homebrew/bin`, via Homebrew).
Binaries **absent**: `sox`/`play`, `mpv`.

| Tool | Pipe raw PCM to stdin (streaming)? | Instant stop (barge-in)? | Gapless chunk concatenation? | Install burden | Native node-gyp build? |
|---|---|---|---|---|---|
| **`afplay`** | **No** — MEASURED-ON-THIS-MACHINE: `cat tone.pcm \| afplay /dev/stdin` fails (`Error: AudioFileOpen failed ('typ?')` — it needs a self-describing container, not headerless raw PCM); `afplay -` is also rejected (`unknown argument: -`, confirmed via `afplay --help` in the same test). It **does** play a complete `.wav` file successfully (`afplay tone.wav`, exit 0, ~1.9s wall time for a 1s clip incl. process startup). | Only via killing the process (`SIGTERM`/`SIGKILL`); no documented IPC/control channel | No — each invocation is a new process against a new file; no persistent-connection mode | **Zero** — preinstalled on every macOS system, no brew/npm step at all | No |
| **`ffplay`** (via Homebrew ffmpeg) | **Yes** — MEASURED-ON-THIS-MACHINE: `cat tone.pcm \| ffplay -f s16le -ar 24000 -ch_layout mono -nodisp -autoexit -loglevel error -i pipe:0` played cleanly (exit 0). Note: ffmpeg 8.1.2 has deprecated `-ac`/`-channel_layout` in favor of `-ch_layout` — using the old flag fails with `Option not found`, a real gotcha to bake into implementation. | **Yes, and fast** — MEASURED-ON-THIS-MACHINE: spawned `ffplay` against a FIFO (kept the process alive/waiting past end-of-chunk by holding the FIFO open with `exec 3>fifo1`), then `kill -9 $PID; wait $PID` measured **4ms** from signal to process exit. (Caveat: this measures process-level termination, not whether CoreAudio's own hardware ring buffer has a few already-queued milliseconds of audio still physically playing after the process dies — that residual is inherent to any process-kill approach and wasn't separately measured.) | **Yes, if kept as one long-lived process** — MEASURED-ON-THIS-MACHINE: writing to a FIFO that `ffplay` reads from (`-i fifo1`) keeps a single `ffplay` instance alive across writes, avoiding the ~0.2-0.3s per-process startup overhead observed when respawning ffplay per chunk (a 1s clip via a fresh `ffplay` process took ~1.26s wall time including startup, vs. immediate playback once already running against an open FIFO). | Homebrew install (`brew install ffmpeg`), not preinstalled — real distribution step, but a single, well-known one | No |
| **`sox`/`play`** | Not tested — **absent from this machine** (`which sox`/`which play` both empty); `sox`/`play` support raw-PCM stdin piping per its own documentation, but that wasn't independently re-verified here since the binary isn't installed | Not tested | Not tested | Requires `brew install sox` — an extra dependency beyond what ffmpeg users already have | No |
| **`mpv`** | Not tested — **absent from this machine** (`which mpv` empty). mpv supports a JSON IPC socket (`--input-ipc-server`) for out-of-band control (stop/seek) plus can read from stdin/pipes, which would in principle give a *cleaner* stop mechanism than SIGKILL (a `stop` IPC command vs. process death) — this is architecturally interesting but **not verified on this machine** | Not tested (would be via IPC socket command, not SIGKILL, per mpv's own manual — `mpv.io/manual/master/#json-ipc`) | mpv's `--idle` mode plus its own internal playlist/queue could in principle give true gapless concatenation without process respawn — **not verified on this machine** | Requires `brew install mpv` | No |
| **`speaker` (npm)** | Yes, by design — it's a `Writable` stream you pipe raw PCM into directly in-process (no subprocess) | Documented as broken in practice: GitHub issue **#191** "`speaker.end()` freezes process for a few seconds" and issue **#183** "After `speaker.end()`, `coreaudio.c` continuously reports buffer underflow" (github.com/TooTallNate/node-speaker/issues) — this directly threatens the barge-in "stop instantly" requirement | In-process stream writes are naturally back-to-back/gapless as long as you keep feeding the writable stream without closing it | **Real burden** — MEASURED-ON-THIS-MACHINE: `npm install speaker` on Node 26.7.0 does **not** auto-run its install script (npm's newer `allowScripts` gate blocked `node-gyp rebuild`); running `npx node-gyp rebuild` manually inside `node_modules/speaker` **did succeed** and produced `build/Release/binding.node`, using Xcode's bundled Python 3.9.6 and the system toolchain. So it's buildable on this machine today, but only with Xcode Command Line Tools present and either an npm scripts-allow step or a manual rebuild — a real friction point for anyone distributing this as a plugin others `npm install`. | **Yes** — this is the core finding: `speaker` requires `node-gyp rebuild` (confirmed via direct build on this machine) |
| **`naudiodon`** (PortAudio bindings) | Yes, by design (same "Writable stream" shape as `speaker`) | Not measured; issue history suggests it's rougher than `speaker` | Not measured | Repo itself is effectively unmaintained: last push **2024-03-23** (`gh api repos/Streampunk/naudiodon`), and its own issue tracker has an open issue literally titled **"Is this package abandoned?"**, plus "I'm interested to add M1 mac support" (i.e., **no confirmed Apple Silicon support**), "input overflow...application become very slow — memory leak?", and no prebuilt binaries ("Prebuild lib for installation plz" is an open ask) | **Yes**, node-gyp/PortAudio native build, and *worse* than `speaker` on this axis since Apple Silicon support isn't even confirmed |
| **Web Audio API in an Electron renderer** | Yes (`AudioContext`/`AudioWorklet` can consume raw PCM chunks directly, well-understood browser API) | Yes — `AudioContext.close()` / disconnecting nodes is fast and is the standard mechanism browsers use for exactly this | Yes — this is what Web Audio's node graph is designed for | Large — requires bundling/running a full Electron shell just for audio playback, which is a heavy dependency for what ORCA otherwise seems to be (a CLI-adjacent Node/TypeScript agent plugin, per HANDOFF.md) unless ORCA already has an Electron surface for other UI reasons | No native compile, but a very different, much heavier packaging model |
| **`AudioQueue`/`AVAudioPlayer` via a tiny Swift helper process** | Yes, in principle — a Swift helper reading PCM off stdin and feeding an `AudioQueue` gives full control | Yes, in principle, and could be *cleaner* than SIGKILL — could expose a control command over stdin/a local socket that immediately flushes the queue (`AudioQueueFlush`/`AudioQueueStop(true)` for synchronous immediate stop) rather than relying on process death | Yes, in principle — this is exactly the gapless-buffered-queue use case `AudioQueue` was designed for | Requires building/shipping a compiled Swift binary alongside the Node plugin (an Xcode/swiftc build step in your release pipeline, or a `xcrun swift build`) — not "npm install and go," but also not `node-gyp` on the *consumer's* machine, which is a meaningfully different distribution story (compile once at release time vs. compile-on-every-install) | No `node-gyp` needed on the install side, but does need a Swift toolchain on the **build** side |

**Sources (primary/measured):**
- MEASURED-ON-THIS-MACHINE: all `afplay`/`ffplay`/FIFO/kill-latency/`npm install speaker` results above, run directly in this session (see command history — `afplay /dev/stdin` failure, `ffplay ... -i pipe:0` success, FIFO-based `ffplay` kept alive + `kill -9` timed at 4ms, `npx node-gyp rebuild` producing `binding.node`).
- github.com/TooTallNate/node-speaker (issues #191, #183, #195 "possible use-after-free," CVE-2024-21526 tracked as issue #188; repo pushed 2024-05-03, i.e. stale but not archived)
- github.com/Streampunk/naudiodon (pushed 2024-03-23; "Is this package abandoned?" issue; no confirmed M1/Apple-Silicon support; no prebuilt binaries)
- man page for `afplay` (local `man afplay`, confirms it's a "play a file" tool, not a stdin/stream tool by design)
- ffmpeg/ffplay `-version`/`-h` output on this machine (ffmpeg 8.1.2), confirming the `-ac`→`-ch_layout` flag deprecation encountered live

**What this means for ORCA's huddle mode:** the single most important empirical finding is that **`afplay` cannot
stream raw PCM** — it needs a complete, self-describing audio file, which rules it out for low-latency
sentence-by-sentence playback despite being the only zero-install option. `ffplay` against a held-open FIFO is a
**measured, working, zero-native-compile path** that gets streaming PCM input, gapless chunk concatenation (by
staying one long-lived process), and a genuinely fast stop (4ms measured kill latency) — at the cost of a `brew
install ffmpeg` dependency, which is a very common one but still a real install step for something distributed as a
plugin. `speaker` gives the cleanest programming model (a Writable stream, no subprocess/FIFO plumbing) but its own
issue tracker documents exactly the failure mode that matters most for barge-in — `speaker.end()` hanging for
seconds and coreaudio buffer-underflow warnings after end() — which is a direct, primary-source contradiction of
the "stop instantly" requirement. A Swift helper around `AudioQueue`/`AVAudioPlayer` is the option that most closely
matches how real native macOS voice apps (per the yap/WhisperKit precedent already found in Area 2 — this project
is already leaning on small Swift helper processes for STT) solve the same problem, and shifts the native-compile
burden from "every user's `npm install`" to "our own release build," which is the more plugin-distribution-friendly
shape of the two.

---

## Cross-cutting notes for the ORCA huddle-mode design

1. **Barge-in is a two-part problem, not one.** Pipecat (github.com/pipecat-ai/pipecat, 14,348★, actively pushed
   2026-08-20) — a real, widely-used open-source voice-agent framework — solves interruption with a dedicated
   `InterruptionFrame` (a `SystemFrame` that jumps the pipeline queue and is processed immediately, confirmed by
   reading `src/pipecat/frames/frames.py` directly via `gh api`) that flows through **both** the TTS-generation
   stage and the output-audio-transport stage. That's a directly transferable architectural lesson for ORCA:
   "stop audio" should be a control signal that (a) cancels the in-flight TTS request/stream and (b) flushes the
   local playback buffer — not just "kill the player process" — because killing only the player still leaves an
   in-flight cloud TTS request burning latency/cost for audio nobody will hear.
2. **The STT and playback recommendations converge on the same architecture pattern.** Both the best-fit STT option
   (a Swift helper around Apple's Speech framework, per FrigadeHQ/yap) and the best-fit barge-in-safe playback
   option (a Swift helper around AudioQueue/AVAudioPlayer) point toward **one small, compiled Swift helper process**
   that ORCA's Node plugin drives over stdio/IPC, rather than reaching for either a pure-JS native addon
   (`speaker`/`naudiodon`, both showing real cracks in their issue trackers) or shelling out to a general-purpose
   media player (`ffplay`, which works today but is a coarser instrument — whole-process kill instead of a
   targeted "stop and flush" command).

---

## Search-log summary (what worked / what didn't this pass)

- **High-signal query shape:** `"<exact model/vendor name> streaming latency pricing"` reliably surfaced the
  vendor's own docs/pricing pages first or second in results (ElevenLabs, Cartesia, Rime, Deepgram, Groq, AWS all
  converged in 1 attempt this way).
- **Noisy query shape:** any query without an exact product name pulled a wall of 2026-dated SEO
  "top-N-TTS-APIs-in-2026" listicle sites (texttolab.com, futureagi.com, inworld.ai/resources, smallest.ai/blog,
  perkstack.co, etc.) — these were useful only as pointers to which primary pages to fetch next, never cited as
  primary sources themselves except where explicitly flagged as "CLAIMED via secondary source" above (Cartesia's
  40ms figure).
- **`gh api` over `github-search`:** once a repo name was known (whisper.cpp, WhisperKit, yap, sherpa-onnx,
  silero-vad, node-speaker, naudiodon, pipecat), `gh api repos/OWNER/REPO` and `gh api search/issues?q=repo:...`
  were faster and more reliable than the search skills for repo health/issue-history questions — consistent with
  the general rule already in the query playbook.
- **Gap to flag explicitly:** `ten-vad` (named in the brief) was not actually searched this pass — a real gap, not
  a "searched and found nothing" result. Also not independently verified this pass: Google Cloud TTS per-char
  pricing, Deepgram Aura-2's specific $/1M-char rate (only per-minute STT rates were captured), PlayHT pricing, Rime
  pricing, Hume pricing, and whether `mpv`/`sox` behave as expected for PCM streaming and IPC-based stop (neither
  binary was installed on this machine, so those rows are unverified rather than measured).

---

*Research artifacts: `.research/prior-art-search/*.json` in this repo root (created 2026-08-20 for this pass).*
