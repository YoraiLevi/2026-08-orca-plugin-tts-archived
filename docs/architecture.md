# Architecture — ORCA TTS plugin

**Status:** design, ratified by D001 on 2026-08-20. **No code exists yet.**
Every constraint below is MEASURED — see `docs/.research/orca-empirical-findings.md`.

---

## 1. Component relationships (runtime)

```mermaid
graph TB
    subgraph ORCA["ORCA (Electron)"]
        direction TB
        MAIN["Main process<br/><i>plugin host</i>"]
        subgraph WORKER["Plugin worker — forked Node 24"]
            ORCH["Orchestrator"]
            TAIL["TranscriptTailer"]
            NORM["SpeechNormalizer"]
            CHUNK["Chunker"]
            SINKSEL["SinkSelector"]
        end
        PANEL["Plugin panel — iframe<br/>CSP default-src 'none'"]
    end

    subgraph SERVICE["orca-tts-service — resident, our own binary"]
        HTTPAPI["loopback HTTP / IPC"]
        ENGINE["EngineRegistry"]
        PIPER["Piper / sherpa-onnx"]
        CLOUD["Cloud provider (opt-in)"]
        PLAYER["PlaybackSink — owns the device"]
    end

    OS["OS synthesizer<br/>say · SAPI · spd-say"]
    JSONL[("~/.claude/projects/**.jsonl<br/>agent transcripts")]

    MAIN -- "agent.status.changed<br/>(4 fields only)" --> ORCH
    MAIN -- "commands · keybindings" --> ORCH
    JSONL -. "fs.watch + read" .-> TAIL
    TAIL --> NORM --> CHUNK --> SINKSEL
    SINKSEL -- "primary" --> HTTPAPI
    SINKSEL -- "fallback: spawn" --> OS
    HTTPAPI --> ENGINE
    ENGINE --> PIPER
    ENGINE --> CLOUD
    PIPER -- PCM --> PLAYER
    CLOUD -- "MP3/Opus" --> PLAYER
    ORCH -- "status (64 KB / 30 per 10s)" --> PANEL
    PANEL -. "BLOCKED: no host->panel channel" .-> ORCH

    classDef blocked stroke-dasharray: 5 5
    class PANEL blocked
```

**Read as:** the plugin worker is the *brain* and owns no audio. The service is the *voice*. The OS
synthesizer is the *floor* that guarantees we never fail silently. The panel is currently a
display only — the dashed edge is the one missing upstream primitive.

---

## 2. Why the audio does not live where you would expect

```
                 can synthesize?   can play PCM?   can reach text?   verdict
                 ---------------   -------------   ---------------   -------
 Plugin panel         YES (1)        YES (2)            NO (3)       excellent speaker,
                                                                     no wire to it
 Plugin worker        NO  (4)        NO  (5)            YES          brain, not voice
 Resident service     YES            YES                via worker   where audio belongs

 (1) speechSynthesis: 180 voices, start->boundary->end fires. MEASURED.
 (2) AudioBufferSourceNode: 4 ms drift, 2 ms stop, decodes MP3/Opus/AAC/WAV. MEASURED.
 (3) no host->panel push; connect-src 'none'; bridge is panel->host only. MEASURED.
 (4) cannot load a .node addon from a bundled main.mjs; 50 MB / 2000-file cap.
 (5) no maintained instant-stop Node audio sink; afplay refuses stdin (~970 ms gaps).
```

---

## 3. Data flow — huddle mode (agent reply spoken aloud)

```mermaid
sequenceDiagram
    participant A as Agent CLI
    participant J as transcript.jsonl
    participant T as TranscriptTailer
    participant N as Normalizer
    participant C as Chunker
    participant S as TTS service
    participant P as PlaybackSink

    A->>J: append assistant turn
    J-->>T: fs change (debounced)
    T->>T: decode records, DROP thinking blocks
    T->>N: raw markdown text
    N->>N: 15 transforms in a fixed order:<br/>fences, inline code, links, URLs, headings,<br/>lists, tables, paths, markers, key glyphs,<br/>emoji, units, numbers, whitespace, punctuation<br/>(paths and units+numbers are conditional)
    N->>C: speakable plain text
    C->>C: first sentence ALONE (min latency)<br/>then greedy pack to engine limit
    loop per chunk
        C->>S: synthesize(chunk, voice)
        S-->>P: PCM / encoded audio
        P->>P: schedule at explicit offset
    end
    Note over P: user presses stop / starts typing
    P-->>S: cancel()  (two-sided)
    S->>S: abort in-flight synthesis
    P->>P: flush queued buffers
```

**The two-sided cancel is the point.** Killing only the player leaves the synthesizer producing
speech for text the user already interrupted.

---

## 4. Class design (worker side)

```mermaid
classDiagram
    class SpeechPipeline {
        +speak(source: TextSource) SpeechSession
        +cancelAll() void
    }
    class TextSource {
        <<interface>>
        +addText(chunk: string) void
        +finish() void
    }
    class TranscriptSource
    class ClipboardSource
    class SpeechNormalizer {
        <<pure>>
        +normalize(md: string, opts) string
    }
    class Chunker {
        +push(text: string) Chunk[]
        +flush() Chunk[]
        -isolateFirstSentence: boolean
    }
    class TtsProvider {
        <<interface>>
        +id: string
        +capabilities: ProviderCapabilities
        +prepare() Promise
        +generate(text) AsyncIterable~AudioChunk~
        +cancel() void
    }
    class ServiceProvider
    class OsSynthProvider
    class CloudProvider
    class PlaybackSink {
        <<interface>>
        +enqueue(chunk: AudioChunk) void
        +stop() void
    }
    class ServiceSink
    class PanelSink
    class ProviderCapabilities {
        +streaming: boolean
        +offline: boolean
        +needsApiKey: boolean
        +needsModelDownload: number
        +licence: string
        +sampleRate: number
    }

    SpeechPipeline --> TextSource
    SpeechPipeline --> SpeechNormalizer
    SpeechPipeline --> Chunker
    SpeechPipeline --> TtsProvider
    SpeechPipeline --> PlaybackSink
    TextSource <|.. TranscriptSource
    TextSource <|.. ClipboardSource
    TtsProvider <|.. ServiceProvider
    TtsProvider <|.. OsSynthProvider
    TtsProvider <|.. CloudProvider
    TtsProvider --> ProviderCapabilities
    PlaybackSink <|.. ServiceSink
    PlaybackSink <|.. PanelSink
```

`PanelSink` is written but unreachable until upstream PR #1. That is deliberate: the day the
channel lands, it is a sink swap, not a rewrite.

---

## 5. Degradation ladder — how "never fail silently" is actually true

```
  service warm + model ready ──▶ Piper via service        52-65 ms/sentence   BEST
            │ service cold
            ▼
  service warm-up in progress ─▶ OS synthesizer            ~414 ms spawn      GOOD
            │ service absent / not installed
            ▼
  no service at all ───────────▶ OS synthesizer            ~414 ms spawn      OK
            │ OS synth missing (rare Linux)
            ▼
  nothing available ───────────▶ visible error + log       silent = bug       FLOOR
```

Windows arm64 has no sherpa build (PITFALLS P7), so it lives permanently on rung 2 and the UI
must say why.

---

## 6. Install topology

```mermaid
graph LR
    GH["GitHub repo<br/>bundled main.mjs committed"]
    MKT["orca-marketplace.json<br/>{kind:git, url, ref}"]
    INST["ORCA install<br/>clone --depth 1 + copy<br/>NO build, NO npm install"]
    CACHE[("model cache<br/>outside install tree<br/>ASCII-safe on Windows")]
    SVC["orca-tts-service<br/>separate install, optional"]

    GH --> MKT --> INST
    INST -. "downloads at runtime" .-> CACHE
    INST -. "talks to if present" .-> SVC
```

Hard caps: **2,000 files, 50 MB.** A neural voice does not fit — models download at runtime into a
cache outside the content-hash-verified install tree, mirroring ORCA's own STT model manager.

---

## 7. What is blocked, and on what

| Capability | Blocked by | Unblocked by | Interim |
|---|---|---|---|
| Panel plays audio | no host→panel channel | upstream PR #1 | service owns playback |
| Reliable session correlation | `paneKey` has no session id | upstream PR #2 | `worktreeId` path heuristic |
| Speak real editor selection | no `selection:read` | upstream PR #3 | clipboard + last-reply |
| Agents beyond claude/codex/grok/omp | no transcript decoders | upstream | unsupported, stated in docs |
| Windows arm64 neural voice | no sherpa build | upstream sherpa | OS synthesizer |
