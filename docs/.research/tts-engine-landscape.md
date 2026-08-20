# TTS engine landscape for the ORCA TTS plugin

**Scout:** TTS-engine research track · **Date:** 2026-08-20 · **Phase:** 0 (research)
**Target:** macOS (darwin) primary, Linux/Windows stretch. Node/TypeScript host process.
**Driving features:** (1) hotkey speaks selected text, (2) "huddle" mode speaks streaming agent replies.

Every latency number below is labelled `[measured-here]` (run on this machine today),
`[measured-third-party]` (someone else's run, cited), or `[claimed]` (vendor). Where a fact was
not established, the word is **unknown**, not a guess.

**Companion files (deeper detail, same research pass):**
[`_track-b-local-tts.md`](./_track-b-local-tts.md) — 20-engine local landscape with per-engine licence
archaeology · [`_track-b-cloud-stt-audio.md`](./_track-b-cloud-stt-audio.md) — 11 cloud vendors, 13 STT
engines, and independent playback measurements. This file is the decision-facing synthesis of both.

**Test rig for every `[measured-here]` number:** Apple Silicon Mac, macOS 26.5 (build 25F71),
Node v26.7.0, `sherpa-onnx-node` 1.13.6 with the prebuilt `sherpa-onnx-darwin-arm64` binary,
`numThreads: 2`, `provider: 'cpu'`, warm process. Test sentence: *"It was a bright cold day in
April."* → ≈2.0 s of audio. 3–5 repetitions each, spread reported.

---

## Recommendation

- **Default engine: Piper (VITS) running inside `sherpa-onnx-node`.** It synthesised a full
  sentence in **52–65 ms** `[measured-here]` — RTF 0.025, roughly 40× real time — from a plain
  `npm install` that took **3 seconds and 32 MB with no node-gyp compile** `[measured-here]`. That
  is 8× faster than the macOS `say` binary can even *start* (see next bullet), and it clears the
  user's own stated `<500 ms` first-audio bar (`R4.2`) by an order of magnitude.
- **Do not make macOS `say` the default; keep it only as the never-fails fallback.** `say` with an
  empty string — pure process spawn, zero synthesis — costs **414 ms median over 5 runs**
  `[measured-here]`. Every hotkey press pays that. It is the right *degraded* path (`R5.4`: never
  fail silently) and the right zero-download first-run bridge, but it is the slowest option
  measured here, not the fastest, and it cannot stream partial audio into a pipe.
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
- **One dependency covers TTS *and* the whole future STT/barge-in story.** `sherpa-onnx-node`
  exports `OfflineTts`, `OnlineRecognizer` (streaming ASR), `OfflineRecognizer`, `Vad`,
  `KeywordSpotter` and `CircularBuffer` from the same prebuilt binary `[measured-here]`. Choosing
  it for TTS today buys voice input and barge-in later at zero new install cost.

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

### 1. Piper (VITS) inside `sherpa-onnx-node` — the recommended default

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

**Blocker.** The sherpa model card says plainly: *"Before you use it, please read its LICENSE… **It
is for non-commercial**"*, pointing at
[`KevinAHM/pocket-tts-onnx`](https://huggingface.co/KevinAHM/pocket-tts-onnx). Upstream
`kyutai-labs/pocket-tts` is MIT with a "Prohibited use" policy covering impersonation and
deception. **The divergence is in the ONNX export, not the model**, so a commercially-safe Pocket
TTS path probably exists via a different export — but that is unverified. Until someone checks,
ship Pocket TTS as an **opt-in user-initiated download** with the licence shown, never bundled.

### 3. macOS `say` / AVSpeechSynthesizer — the zero-install floor

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

## Audio playback on macOS from Node

Everything in this table was tested on this machine today unless marked otherwise. This is the
detail that sinks designs, so the columns are behavioural, not aspirational.

| Option | Present on stock macOS | Accepts raw PCM on **stdin** | Stops instantly | Gapless chunk concatenation | Needs node-gyp | Notes |
|---|---|---|---|---|---|---|
| **`afplay`** | ✅ `/usr/bin/afplay` `[measured-here]` | ❌ — `afplay -` → *"unknown argument: -"*, and feeding a file on stdin → `AudioFileOpen failed ('typ?')`; independently reproduced twice `[measured-here]` | ✅ `kill()` returned in **0.9 ms** `[measured-here]` | ❌ — one process per file; [`speak11`'s changelog measures ~970 ms inter-sentence gap this way](https://github.com/smcantab/speak11/blob/475c5fa842c8ab91802298c06667603d0ba02b47/CHANGELOG.md#L7) `[measured-third-party]` | ❌ | File-only. Fine for "speak this one selection", wrong for huddle mode. |
| **`ffplay`** | ❌ (present here via Homebrew: `/opt/homebrew/bin/ffplay` `[measured-here]`) | ✅ — fed 8 KB PCM chunks to `-f s16le -ar 22050 -ch_layout mono -i pipe:0` and it played continuously `[measured-here]` | ✅ `kill()` returned in **1.5 ms** `[measured-here]` | ✅ — and holding a **FIFO** open keeps one `ffplay` alive across many synthesised chunks, so sentences concatenate gaplessly `[measured-third-party]` | ❌ | **The pragmatic streaming answer**, but ffmpeg is not preinstalled, so it cannot be the default path. |
| **`mpv`** | ❌ (**not installed here** `[measured-here]`) | ✅ | ✅ | ✅ — `--idle=yes` + `loadfile … append` over its JSON IPC socket makes mpv own the gapless queue; the survey calls this *"the cheapest correct answer to streaming"* `[measured-third-party]` | ❌ | Best ergonomics, extra install. |
| **`sox` / `play`** | ❌ (**not installed here** `[measured-here]`) | ✅ | ✅ | ✅ | ❌ | Same objection as ffplay, smaller. |
| **`speaker` (npm)** | n/a | ✅ — it *is* a writable PCM stream | ⚠ **No — this is the disqualifier.** Its own issue tracker documents `speaker.end()` **hanging for seconds** plus post-`end()` CoreAudio buffer-underflow spam `[measured-third-party]` | ✅ | ⚠ **yes** — `0.5.5`, `MIT AND LGPL-2.1-only` `[measured-here]`; **does** build on Node 26.7 / arm64 via a manual `node-gyp rebuild` `[measured-third-party]`, but that is a build step on the user's machine | Cleanest API, but a player that cannot stop promptly cannot do barge-in. Also check the LGPL component before bundling. |
| **`naudiodon` / PortAudio bindings** | n/a | ✅ | ✅ | ✅ | ⚠ yes | **Effectively abandoned** — last push 2024-03, with an open *"Is this package abandoned?"* issue and no confirmed Apple Silicon support `[measured-third-party]`. Do not build on it. |
| **Web Audio in an Electron renderer** | n/a (if ORCA is Electron) | ✅ via `AudioWorklet` / `AudioBufferSourceNode` | ✅ instant — `stop()` / disconnect | ✅ with scheduled buffer sources | ❌ | **Probably the best answer if ORCA has a renderer process.** No subprocess, sample-accurate scheduling, instant stop. Depends entirely on ORCA's plugin surface — see the ORCA-API research track. |
| **Swift sidecar (`AVAudioEngine` / `AudioQueue`)** | ✅ toolchain-free at runtime | ✅ over a pipe | ✅ | ✅ | ❌ (but needs a Swift build + signing) | What `speak11` and `yapper` do. Also the only route to AVSpeechSynthesizer's streaming buffers. |

**Conclusions.**
1. `afplay` cannot stream and cannot concatenate gaplessly. Any design that pipes each synthesised
   sentence to a fresh `afplay` inherits a ~1 s stutter between sentences `[measured-third-party]`.
2. Killing a playback subprocess **is** instant — 0.9–1.5 ms `[measured-here]`. Barge-in via
   process kill is viable; the hard part is not stopping, it is having a resident player to stop.
3. **Barge-in is not "kill the player".** Reading
   [`pipecat`'s `frames.py`](https://github.com/pipecat-ai/pipecat) shows its `InterruptionFrame` is a
   *control signal* that both **cancels in-flight TTS generation** and **flushes already-buffered local
   playback** `[measured-third-party]`. Killing only the player leaves the synthesiser churning out audio
   for text the user already interrupted. Our provider interface must carry the same two-sided cancel.
4. There is **no preinstalled macOS binary that accepts streaming PCM on stdin** `[measured-here]`.
   That is the sharpest constraint in this document. The three ways out are: a bundled Swift audio
   sidecar, Web Audio in an ORCA renderer, or accepting a Homebrew dependency (`ffplay`/`mpv`).
   **Which one is right depends on ORCA's plugin architecture and must be decided with that track.**
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
| **Piper voices are GPL-3.0** | The maintained [`piper1-gpl`](https://github.com/OHF-Voice/piper1-gpl) is GPL-3.0 and *"embeds espeak-ng for phonemization"*; espeak-ng is **GPL-3.0-or-later** and sits under Kokoro, KittenTTS and StyleTTS2 too. The old MIT [`rhasspy/piper`](https://github.com/rhasspy/piper) is archived. The user's own issue names this as unresolved: *"whether that reaches a derivative as distributed is an unresolved legal question, not a technical one."* | We invoke a separately-downloaded ONNX model through an Apache-2.0 runtime rather than linking GPL code, which is the weakest coupling available. Still needs a decision before the plugin picks a licence. **Do not bundle model weights in the npm package.** |
| **Pocket TTS ONNX export is non-commercial** | The sherpa model card says *"It is for non-commercial"* while upstream is MIT `[measured-here]`. | Opt-in download only, licence shown at the prompt. Investigate a permissively-licensed export before promoting it. |
| **Model download size and first-run experience** | Piper amy-low is a 67 MB download; Kokoro FP32 is 360 MB `[measured-here]`. A hotkey that does nothing for 60 s on first press is a broken hotkey. | Ship with `say` active from install; download the default model in the background; switch over when warm and say so in the UI. |
| **Python/PyTorch dependency creep** | The user's catalogue documents a 27 MB model pulling **6 GB and 7.1 GB** of Python dependencies in two independent first-hand reports `[measured-third-party]`. | Hard rule: **no Python in the default path.** ONNX-runtime engines only (Piper, Kokoro, Pocket, Kitten, sherpa). |
| **Native-addon distribution** | `npm speaker` and `naudiodon` need node-gyp; a failed compile on a user's machine is an uninstallable plugin. `sherpa-onnx-node` avoids this with prebuilt platform packages `[measured-here]` — but only for platforms it prebuilds. | Verify prebuilt coverage for darwin-x64, linux-x64, win32-x64 before committing. Keep the `say`/`afplay` path working with zero native code. |
| **No preinstalled streaming audio sink on macOS** | `afplay` refuses stdin; `sox`/`mpv` absent; `ffplay` only via Homebrew `[measured-here]`. | Decide with the ORCA-API track: Web Audio in a renderer if ORCA is Electron, otherwise a bundled Swift sidecar. Do not assume Homebrew. |
| **API keys and data egress** | Cloud providers break `R3.4` outright and require disclosure — OpenAI's guide requires telling users the voice is AI-generated; ElevenLabs' free plan is personal-use-only with attribution `[measured-third-party]`. | Cloud is opt-in, never default; store keys in the OS keychain; show "text leaves this machine" in the UI. |
| **`edge-tts` looks free and is not safe** | Undocumented Microsoft endpoint with no third-party grant, and a documented history of mass-403 waves and endpoint migrations in 2024–2025 `[measured-third-party]`. | Do not ship it. |
| **Supertonic is being discontinued** | CAUTION banner added 2026-07-23; Voice Builder service ends 2026-08-31 `[measured-third-party]`. It otherwise fits our spec best of anything found (MIT, 31 languages, Core ML, claimed 0.05 s TTFA). | Do not adopt as default. If wanted, use the `sherpa-onnx` mirrored int8 conversion so the weights survive upstream. |
| **XTTS / StyleTTS2 / F5-TTS weight licences diverge from their code licences** | XTTS-v2 code is MPL-2.0 but weights are under the restrictive non-standard **CPML**; StyleTTS2 pretrained models carry a **voice-consent usage obligation**; F5-TTS's Emilia training-data terms bleeding into the checkpoint are **unverified** `[measured-third-party]`. | None of these are candidates for us. Recorded so nobody adds them later without reading the weight licence separately from the repo licence. |
| **`Picovoice/orca` name collision** | An on-device streaming TTS engine literally named Orca, which the user starred, in a repo about an agent named ORCA. | Always disambiguate in docs. Also note it is disqualified as a default by its AccessKey internet check. |
| **Duplicating the user's own project** | `TTS-Hotkey-AI-Read-Clipboard-CLI` specifies feature 1 in full and is in requirements phase. | Treat this plugin as a *host* for that design. Reuse R1–R9 as our acceptance criteria; feed measurements back to that issue. |

---

## Open questions for the team

1. **Does ORCA have a renderer process we can play audio in?** This single fact decides the
   playback architecture. Needs the ORCA plugin-API track.
2. **Is there a permissively-licensed Pocket TTS ONNX export?** Upstream is MIT; the export sherpa
   ships is not. Unverified either way.
3. **Does `sherpa-onnx-node` prebuild for linux-x64 and win32-x64?** Verified only for
   `darwin-arm64` here.
4. **Does `OfflineTts`'s `callback` option ever fire?** It did not in my run `[measured-here]`.
   If intra-utterance streaming works, per-sentence latency drops further.
5. **AVSpeechSynthesizer's real time-to-first-buffer on macOS 26.** Unknown; would decide whether
   the zero-download path can also be the low-latency path.
6. **Do these numbers hold on Intel Macs?** Everything here is Apple Silicon.
7. **Is Qwen3-TTS's claimed 97 ms real, and does it run on CPU?** If yes it reorders this whole table.
   The claim traces to an unverified community thread.
8. **`ten-vad` was never researched.** Named in the research brief, missed in execution. Gap, not a
   negative finding.
