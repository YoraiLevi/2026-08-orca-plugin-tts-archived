# Prior art — `block/buzz` voice huddle (TTS + STT)

> **Source**: https://github.com/block/buzz @ `2a236e413723f207c2f6c1e8921fab4f071d0445`
> (2026-08-20, `refactor(prompt): simplify Buzz agent guidance (#6340)`)
> Cloned shallow (`--depth 50`) to scratchpad. All `path:line` citations below are against that SHA.
>
> **Label key** — `VERIFIED` = I read the code and quoted it. `INFERRED` = reasoned from
> surrounding code, comments, or tests without a direct statement.
>
> Buzz is a Nostr-relay team workspace (Rust + Tauri desktop + React). The voice feature is called
> a **huddle**: an ephemeral audio channel where humans and agents share one room. All voice code
> lives under `desktop/src-tauri/src/huddle/` (~16k lines) plus the reusable `crates/buzz-voice`.
> This is a real, shipped, heavily-tested implementation — not a demo.

---

## Verdict

**Copy these five:**

1. **`preprocess_for_tts` — a 7-stage, dependency-free markdown→speech normalizer** with a test
   suite that encodes every rule. It is ~400 lines of plain Rust, no regex. We can port it almost
   verbatim to TypeScript. `desktop/src-tauri/src/huddle/preprocessing.rs:28-43` (VERIFIED)
2. **The "isolate first sentence, then pack the rest" chunking rule.** First utterance is split
   alone for minimum time-to-first-audio; every subsequent chunk greedily packs as many sentences
   as fit the engine limit. One boolean flag switches the two policies over the same splitter.
   `crates/buzz-voice/src/pocket_april.rs:983-1090` (VERIFIED)
3. **The boundary-preference ladder: sentence → clause → word → scalar**, with an abbreviation
   guard so `e.g.` and `1.` don't fake a sentence end.
   `crates/buzz-voice/src/pocket_april.rs:1097-1133` (VERIFIED)
4. **Barge-in enforcement as a separate 10 ms monitor thread, not a check inside the worker.**
   The worker can be blocked for hundreds of ms inside model inference; a dedicated poller kills
   audio in ~15 ms regardless. Pair it with their generation-tagged queue, where *barge-in clears
   the queue but a voice switch preserves it*. `desktop/src-tauri/src/huddle/tts.rs:86-90`,
   `tts_speaker_cancellation.rs:15-94`, `tts_voice_transition.rs:484-493` (VERIFIED)
5. **Push chunking upstream into the agent's system prompt.** Buzz literally instructs the agent
   to *"send each useful sentence as its own message the moment it is ready"* and *"speak plainly
   without markdown"*. Free latency and free sanitization.
   `desktop/src-tauri/src/huddle/agents.rs:36-47` (VERIFIED)

**Do not copy these two:**

1. **The bundled-local-model-only stance.** Buzz hardwires one TTS engine (Pocket TTS, ONNX) and
   one STT engine with *no provider trait at all* — `PocketTts` is a concrete struct used directly
   by the worker. Their own issue #3720 is a user begging for pluggable backends. Build the seam
   on day one; Buzz is paying for not having it.
2. **Their barge-in *trigger* set — and the "just wear headphones" echo answer.** Local mic
   speech never interrupts TTS in Buzz; only a PTT keypress, a remote human, or a Stop click does
   (`stt.rs:64-68`). And there is no AEC of their own — they lean entirely on the WebView's
   `getUserMedia` echo cancellation. For a single-user desktop coding agent, "remote participant"
   doesn't exist, so we'd inherit *no* hands-free barge-in at all.

**Cross-platform note:** every one of the five "copy" items above is pure logic with **zero**
`cfg(target_os)` branches — verified by grep across `huddle/`. The parity risk in this project sits
entirely in mic capture and AEC, not in anything we want to steal. See
[Cross-platform reality check](#cross-platform-reality-check).

*(Minor third: skip the rodio persistent-`Player` + mixer plumbing — lead-in cushions sized around
a specific rodio 0.22.2 bootstrap quirk, `tts.rs:106-125`. Rust-audio-stack yak shaving with no
analogue in an Electron/Web Audio host.)*

---

## Architecture

**Where audio lives:** in-process, in the **Tauri Rust backend** (`desktop/src-tauri`), on
dedicated OS threads — *not* a separate process, *not* a Node worker, *not* the webview.
The React frontend only issues `#[tauri::command]` calls and receives events. (VERIFIED —
`huddle/mod.rs:1-51` module map; every entry point is a `#[tauri::command]`.)

Two independent pipelines, each owning a worker thread, connected by shared atomics:

```
                        ┌──────────────────────────── React / webview (desktop/src) ───────────┐
                        │  AppHuddleBar · HuddleContext · settings panes                       │
                        │    ↑ tauri events                        ↓ #[tauri::command]         │
                        └────┼───────────────────────────────────────┼─────────────────────────┘
   "huddle-tts-speaker-level"│                                       │ speak / interrupt / set_voice
                             │                                       │
  ══════════════════════════ Rust backend (desktop/src-tauri) ═══════╪═════════════════════════
                             │                                       │
  TEXT → SOUND               │                                       ▼
                             │                    ┌──────────────────────────────┐
   agent posts Nostr msg ───────────────────────► │ TtsPipeline::speak(text)     │  tts_pipeline_controls.rs:8
   (kind:9 to huddle chan)   │                    │  bounded sync_channel, N=8   │  tts.rs:83
                             │                    └───────────────┬──────────────┘
                             │                                    ▼
                             │        ┌────────────────── tts_worker thread ──────────────────┐
                             │        │ 1. preprocess_for_tts()        preprocessing.rs:28    │
                             │        │ 2. split_text_for_playback()   pocket.rs:120          │
                             │        │      → [sentence1] [packed rest…]                     │
                             │        │ 3. split_text_into_chunks()    pocket.rs:103          │
                             │        │      → model units ≤ 50 tokens                        │
                             │        │ 4. synth_chunk() → Vec<f32> @24 kHz  pocket_april.rs   │
                             │        │ 5. clamp + 8 ms fade-out       tts_audio.rs:40-69     │
                             │        │ 6. append to persistent rodio Player (gapless)        │
                             │        │ 7. LOOKAHEAD: only block on the channel when the      │
                             │        │    player is empty → synth(N+1) overlaps play(N)      │
                             │        └──────────┬──────────────────────────────┬─────────────┘
                             │                   │ PlaybackCoordinator (Mutex)  │
                             │                   │  tts_playback.rs:12          │
                             │                   ▼                              │
                             │            rodio Player → Mixer → cpal → 🔊      │
                             │                   ▲                              │
                             │   ┌───────────────┴────────────┐                 │
                             └───┤ tts-barge-in-monitor thread│◄────────────────┘
                                 │ 10 ms tick; on cancel flag │  tts_speaker_cancellation.rs:15
                                 │ swaps in a FRESH Player,   │
                                 │ drops the old one          │
                                 │ also emits 50 ms RMS       │  tts_activity.rs:17
                                 │ envelope frames to the UI  │
                                 └────────────────────────────┘
                                            ▲
                                            │ cancel: Arc<AtomicBool>
  MIC → TEXT                                │ tts_active: Arc<AtomicBool>  ← shared with STT
                                            │
   🎤 → cpal capture → resample 48k→16k → VAD → utterance → sherpa-onnx Parakeet
        → transcript → posted to the relay as a channel message → agent reads it
        (see "STT / mic handling" below)
```

**Key structural decision (VERIFIED, `tts.rs:26-31`):** lookahead pipelining spans *items*, not
just sentences within one item. The worker blocks on the text channel **only when the player is
empty** (`tts.rs:619`, `tts.rs:561-583`). The doc comment explains why:

> "With sentence-per-message delivery (each agent message ≈ one sentence), a per-item drain
> barrier would insert a full synth latency of dead air between every pair of sentences — the
> cross-item overlap is what keeps multi-message replies gapless."

**Round-trip is measured, not guessed.** `huddle/latency_bench.rs:1-24` drives the real STT →
fake-LLM → real TTS path off a WAV fed in real-time 100 ms batches, timestamping
`t_speech_end → t_transcript → t_speak → t_first_audio`. (VERIFIED)

---

## TTS provider abstraction

**There isn't one.** This is the single biggest gap, and it is worth stating plainly.

`PocketTts` is a concrete struct, not a trait. The worker calls it directly:

`crates/buzz-voice/src/pocket.rs:77-98` (VERIFIED)

```rust
/// Resident April INT8 Pocket TTS engine.
pub struct PocketTts {
    inner: Mutex<AprilPocketTts>,
}

/// Load Buzz Desktop's pinned April INT8 model.
pub fn load_text_to_speech(model_dir: &str) -> Result<PocketTts, String> { … }
```

The closest thing to an interface is the inherent `impl PocketTts` surface — this is the shape a
real provider trait *would* take, and it is a good shape to steal:

`crates/buzz-voice/src/pocket.rs:100-186` (VERIFIED)

```rust
impl PocketTts {
    /// Split text into model-safe synthesis units that satisfy the bundle's
    /// exact 50-token input limit, packing sentences whenever they fit.
    pub fn split_text_into_chunks(&self, text: &str) -> Result<Vec<String>, String>;

    /// Split text into ordered playback units, keeping the first sentence
    /// separate so it reaches synthesis before the remainder is packed.
    pub fn split_text_for_playback(&self, text: &str) -> Result<Vec<String>, String>;

    /// Synthesize text with the supplied reference voice.
    pub fn synth_chunk(&self, text: &str, _lang: &str, style: &VoiceStyle, _steps: usize)
        -> Result<Vec<f32>, String>;

    /// EXPERIMENTAL (latency): streaming synthesis. Invokes `on_audio` with
    /// PCM deltas as soon as roughly `emit_frames` Flow LM frames (80 ms of
    /// audio each) have been generated and decoded.
    pub fn synth_chunk_streaming(&self, text: &str, style: &VoiceStyle, emit_frames: usize,
        on_audio: &mut dyn FnMut(Vec<f32>) -> bool) -> Result<bool, String>;
}
```

Note the callback-returns-`bool`-to-cancel convention on the streaming path — cheap, no async
machinery, and it makes barge-in reach *inside* an in-flight synthesis. Worth copying.

**Engine facts** (VERIFIED):

| Property | Value | Evidence |
|---|---|---|
| Engine | Kyutai **Pocket TTS**, `english_2026-04` bundle, ONNX via `ort` 2.0.0-rc.12 | `pocket.rs:1-14`, `buzz-voice/Cargo.toml:13` |
| Graphs | Mimi encoder, text conditioner, Flow LM main + flow (INT8), Mimi decoder (INT8) | `pocket_april.rs:25-30` |
| Output | 24 kHz mono f32 PCM | `pocket.rs:32-33` |
| Hard input limit | **50 tokens per chunk** (SentencePiece), asserted in tests | `pocket_april.rs:335`, `pocket.rs:196` |
| Threads | 1 ONNX intra-op thread by default (`BUZZ_TTS_THREADS` override) | `pocket.rs:41-51` |
| Voices | reference-WAV style transfer; 12 bundled "pocket voices" shipped as `.wav` | `desktop/src-tauri/resources/pocket-voices/*.wav` |
| Custom voices | user can import a 2–30 s, 8–96 kHz audio file; decoded by symphonia, canonicalized to 32 kHz, SHA-256 content-addressed into a registry | `crates/buzz-voice/src/imported.rs:17-40` |
| Model delivery | downloaded on first launch from HuggingFace to `~/.buzz/models/`, **SHA-256 pinned per artifact** | `huddle/models.rs:1-60` |
| Cloud providers | **none** — grepped for elevenlabs / azure / polly / cartesia / deepgram / playht / speechSynthesis / AVSpeech across `desktop crates web mobile`: zero hits | (VERIFIED by absence) |

**Rate / pitch / speed control: absent.** Grepped `playback_speed|speaking_rate|pitch|fn pause|
resume\(|skip_utterance` across `huddle/` — only false positives (`sample_rate`). `TtsSettings`
carries exactly three fields (`tts_settings.rs`): `version`, `agent_text_to_speech` (bool),
`voice_preferences`. (VERIFIED by absence)

**Safety cap:** text is truncated at 8096 chars with a spoken suffix rather than dropped —
`agent_tts_routing.rs:27-40` (VERIFIED):

```rust
pub(super) const MAX_TTS_TEXT_LEN: usize = 8_096;

pub(super) fn normalize_agent_tts_text(text: String) -> String {
    if text.chars().count() > MAX_TTS_TEXT_LEN {
        let mut truncated: String = text.chars().take(MAX_TTS_TEXT_LEN).collect();
        truncated.push_str("... message truncated.");
        truncated
    } else { text }
}
```

---

## Streaming chunker

This is the piece most worth stealing. It runs at **three nested levels**.

### Level 0 — the prompt (free chunking)

Buzz does not try to chunk a firehose of tokens. It changes the *producer*. At huddle start it
posts voice-mode guidelines the agent loads into its system prompt —
`desktop/src-tauri/src/huddle/agents.rs:36-47` (VERIFIED):

> "When a user addresses you, your **FIRST tool call must send a brief spoken reply** to this
> channel, before any file read, search, or other tool call. The usual rule against bare
> acknowledgments does not apply here; **the pickup is the feedback that you heard them.**
> Then work, **sending each useful sentence as its own message the moment it is ready** — a few
> sentences per answer, not a monologue. **Speak plainly without markdown**; post code or long
> detail to the attached channel instead. If you are not addressed, stay silent."

So each inbound TTS item is *already* roughly one sentence. The plumbing below handles the rest.

### Level 1 — playback split (latency-shaped)

`crates/buzz-voice/src/pocket.rs:113-128` (VERIFIED):

```rust
/// Split text into ordered playback units, keeping the first sentence
/// separate so it reaches synthesis before the remainder is packed.
///
/// Units are contiguous substrings of the prepared model prompt and may
/// retain boundary whitespace. Concatenating them with `chunks.concat()`
/// reconstructs that prompt exactly, and each unit's prepared token count
/// is at most 50.
pub fn split_text_for_playback(&self, text: &str) -> Result<Vec<String>, String>
```

Called at `desktop/src-tauri/src/huddle/tts.rs:691-695`:

```rust
// Let Pocket's tokenizer-aware splitter isolate the first sentence for
// minimum time-to-first-audio, then pack later sentences into the
// largest natural units within the model's exact 50-token limit. Once
// each unit is appended, generation of the next proceeds while rodio
// plays the already-queued audio.
let chunks = engine.split_text_for_playback(&text)?;
```

### Level 2 — model split (throughput-shaped)

Each playback unit is re-split greedily to fill the engine's 50-token window
(`tts.rs:766`, `pocket.rs:101-111`). Same function, `isolate_first_sentence = false`.

### The algorithm itself

`crates/buzz-voice/src/pocket_april.rs:961-1090` (VERIFIED). Both entry points are one-line
wrappers over one function differing only by a boolean:

```rust
fn split_model_at_natural_boundaries<F>(text, max_tokens, token_count) -> …
{ split_at_natural_boundaries(text, max_tokens, false, token_count) }

fn split_playback_at_natural_boundaries<F>(text, max_tokens, token_count) -> …
{ split_at_natural_boundaries(text, max_tokens, true,  token_count) }
```

The core scan (abridged — full body at `pocket_april.rs:983-1090`):

```rust
let mut first_sentence_end = None;
let mut sentence_end = None;
let mut clause_end = None;
let mut word_end = None;
for (offset, ch) in text[start..].char_indices() {
    let end = start + offset + ch.len_utf8();
    let at_word_end =
        end == text.len() || text[end..].chars().next().is_some_and(char::is_whitespace);
    let at_clause_end = matches!(ch, '—' | '–')
        && !text[end..].chars().next().is_some_and(is_closing_punctuation);
    if !at_word_end && !at_clause_end { continue; }
    // Prepared token counts are monotonic in prefix length, so once a
    // candidate overflows the limit no longer candidate can fit. Stop
    // scanning instead of tokenizing every remaining boundary: that
    // kept this loop superlinear in prompt length, and the cost landed
    // before the first chunk reached synthesis.
    if token_count(&text[start..end])? > max_tokens { break; }

    word_end = Some(end);
    match natural_boundary(&text[start..end], end == text.len()) {
        TextBoundary::Sentence => { first_sentence_end.get_or_insert(end); sentence_end = Some(end); }
        TextBoundary::Clause   => clause_end = Some(end),
        TextBoundary::Word     => {}
    }
}

let preferred_end = if isolate_first_sentence && chunks.is_empty() {
    first_sentence_end.or(clause_end).or(word_end)      // ← EARLIEST sentence
} else {
    sentence_end.or(clause_end).or(word_end)            // ← LATEST sentence that fits
};
```

And the boundary classifier — `pocket_april.rs:1097-1133`:

```rust
fn natural_boundary(candidate: &str, is_end_of_text: bool) -> TextBoundary {
    if is_end_of_text { return TextBoundary::Sentence; }
    let mut chars = candidate.chars().rev();
    let mut last = chars.next();
    while last.is_some_and(is_closing_punctuation) { last = chars.next(); }
    match last {
        Some('.' | '!' | '?') if !looks_like_abbreviation(candidate) => TextBoundary::Sentence,
        Some(',' | ';' | ':' | '—' | '–') => TextBoundary::Clause,
        _ => TextBoundary::Word,
    }
}

fn is_closing_punctuation(ch: char) -> bool {
    matches!(ch, '"' | '\'' | '”' | '’' | ')' | ']' | '}')
}

fn looks_like_abbreviation(candidate: &str) -> bool {
    const ABBREVIATIONS: &[&str] = &[
        "Dr.", "Mr.", "Mrs.", "Ms.", "Prof.", "Sr.", "Jr.", "St.", "Ave.", "Rd.", "Blvd.", "Dept.",
        "Inc.", "Ltd.", "Co.", "Corp.", "etc.", "vs.", "i.e.", "e.g.", "Ph.D.",
    ];
    …
    ABBREVIATIONS.contains(&last_word)
        || (last_word.ends_with('.')                       // "1." "2." — a numbered
            && last_word[..last_word.len()-1]              //   list marker, not a
                .chars().all(|ch| ch.is_ascii_digit()))    //   sentence end
}
```

### Plain English

1. Walk forward from the current cursor, one candidate boundary at a time. A candidate is any
   position at end-of-word, or an em/en-dash not followed by a closing bracket/quote.
2. At each candidate, ask the **tokenizer** how many tokens the prefix costs. This is the crucial
   bit: the budget is measured in *model tokens*, not characters or words.
3. **Stop scanning as soon as a candidate overflows.** Token counts are monotonic in prefix
   length, so nothing longer can fit. (They note this was originally superlinear and the cost
   landed *before first audio* — a latency bug, not a throughput bug.)
4. Remember the last-seen sentence end, clause end, and word end that fit — plus the *first*
   sentence end.
5. Pick the cut:
   - **First chunk of a playback split** → the **earliest** sentence end. Smallest possible unit
     → fastest first audio.
   - **Everything else** → the **latest** sentence end that fits. Biggest possible unit → fewest
     synthesis calls, most natural prosody.
   - Fall back sentence → clause → word → (last resort) individual scalar, so a single
     50-token-busting word still cannot deadlock.
6. Trailing whitespace goes with the chunk, so `chunks.concat() == input` exactly — asserted:
   `debug_assert_eq!(chunks.concat(), text);` (`pocket_april.rs:1087`).

**Boundary rule summary:** sentence-terminal `.!?` (after skipping closing quotes/brackets, and
excluding a known abbreviation or a numbered-list marker) → sentence; `,;:—–` → clause;
whitespace → word. **No minimum-length rule** — the 50-token *maximum* and the sentence
preference do the work.

**Latency tradeoff, explicit in the code:** first-chunk-alone buys time-to-first-audio at the cost
of more synthesis invocations and slightly worse prosody across the seam. They only pay it once
per utterance. Later chunks pack greedily.

### Gapless seams

- **8 ms linear fade-out** at the end of each playback chunk only, **no fade-in** —
  `tts.rs:101-105`, `tts_audio.rs:63-69`. The comment is explicit that preserving the leading
  waveform matters (a fade-in "swallowed the consonant onset of every sentence" —
  `tts_tests.rs:751`).
- **No silence is injected between chunks.** A 20 ms zero lead-in is prepended *only* when the
  player was idle — i.e. at a true utterance onset or after an underrun —
  `tts_audio.rs:71-84`, test at `tts_audio.rs:117-134`. Continuously queued chunks get nothing.
- Samples hard-clamped to ±1.0 before append (`tts_audio.rs:58-60`).

### Experimental sub-chunk streaming

`BUZZ_TTS_STREAMING=1` emits PCM deltas mid-synthesis, every `BUZZ_TTS_EMIT_FRAMES` Flow-LM frames
(80 ms each, default 12). `tts_streaming.rs:1-9` (VERIFIED) records the honest tradeoff:

> "Default 12 = the Mimi decoder's native chunk, which keeps streamed audio bit-identical to the
> batch path; smaller deltas are faster to first audio but **diverge (~23 dB SNR vs batch —
> decoder intra-chunk lookahead)**."

Not enabled in production. (VERIFIED — `streaming_emit_frames()` returns `None` unless the env var is set.)

---

## Speech text normalization

Single entry point, `desktop/src-tauri/src/huddle/preprocessing.rs:28-43` (VERIFIED). Seven
stages, fixed order, **zero dependencies** (no regex — hand-rolled scanners):

```rust
pub fn preprocess_for_tts(text: &str) -> String {
    let s = strip_fenced_code_blocks(text);
    let s = strip_inline_code(&s);
    let s = strip_urls(&s);
    let s = strip_markdown_markers(&s);
    let s = strip_emoji(&s);
    let s = expand_numbers(&s);
    let s = collapse_whitespace(&s);
    // Filter trivially short results — ".", "," would be spoken as
    // "period", "comma" by TTS.
    if s.len() <= 1 { return String::new(); }
    s
}
```

| Markdown / text construct | Spoken treatment | Evidence | Note |
|---|---|---|---|
| ` ```fenced``` ` and `~~~fenced~~~` | replaced by the literal words **"code block omitted"** | `preprocessing.rs:47-92` | language tag skipped; **unclosed fence ⇒ rest of message omitted** |
| `` `inline code` `` | backticks stripped, **content kept** (`` `foo()` `` → "foo()") | `preprocessing.rs:94-124` | unclosed backtick emits remainder as-is |
| `http(s)://…` URL | replaced by **"link omitted"** | `preprocessing.rs:126-178` | URL consumed until whitespace or `)` `]` `"` `'` |
| URL followed by `.` `!` `?` at a sentence boundary | punctuation **preserved** → "See link omitted." | `preprocessing.rs:158-176` | deliberate: protects downstream sentence splitting & prosody |
| `**bold**`, `*italic*`, `__x__`, `~~strike~~` | markers deleted, text kept | `preprocessing.rs:180-191` | multi-char markers stripped before single-char |
| `_emphasis_` | markers deleted **only when they wrap a word** | `preprocessing.rs:193-233` | opening `_` must follow whitespace/start; closing `_` must follow non-space and precede whitespace/punct |
| `snake_case`, `foo_bar()` | **underscores preserved** | `preprocessing.rs:472-477` (test) | explicit anti-goal: don't mangle identifiers |
| Emoji (U+1F300–1FAFF, U+2600–27BF, VS, ZWJ, keycaps, cards, tiles) | **deleted** | `preprocessing.rs:235-254` | ASCII emoticons like `:)` deliberately left alone |
| Integer 0–999 999 | expanded to English words ("42" → "forty two") | `preprocessing.rs:328-387` | |
| `HH:MM` time | "11:30" → "eleven thirty"; "9:00" → "nine"; "9:05" → "nine **oh** five" | `preprocessing.rs:292-313` | validated `hh<24 && mm<60` |
| Decimals (`3.14`), ≥ 1 000 000 | **left as-is** — engine handles them | `preprocessing.rs:324-325` | |
| Runs of whitespace / newlines | collapsed to one space, trimmed | `preprocessing.rs:389-410` | |
| Result of length ≤ 1 (`"."`, `","`) | **suppressed entirely** (empty string ⇒ nothing spoken) | `preprocessing.rs:36-41` | stops TTS saying "period" |
| **Headings (`#`)** | ⚠️ **NOT handled** — `#` survives to the engine | absence; confirmed by issue #6179 | see Known problems |
| **Lists (`-`, `1.`)** | ⚠️ **NOT handled** | absence; issue #6179 | |
| **Tables (`\|`)** | ⚠️ **NOT handled** — pipes are spoken/garbled | absence; issue #6179 | |
| **File paths (`src/foo/bar.rs`)** | ⚠️ **NOT handled** — no path-specific rule exists | absence (grepped for path handling; none) | slashes go straight to the engine |
| **Link syntax `[text](url)`** | brackets survive; only the bare URL inside becomes "link omitted" | `preprocessing.rs:133-178` (INFERRED — the URL scanner stops at `)`, but nothing removes `[`/`]`) | |

Their own maintainers state the gap — issue **#6179** (VERIFIED, quoted from the issue body):

> "Desktop keeps the first sentence of every utterance alone (a huddle latency choice), expands
> numbers to words, and **does not strip headings, lists, or tables.**"

And issue **#4403** states the target behaviour we should aim for:

> "Renders Markdown *for the ear*: **headings become pauses, list items become sentences, tables
> are announced by row**, and `**bold**` does not become 'asterisk asterisk'."

**Takeaway for ORCA:** port Buzz's seven stages verbatim, then add the four rows they're missing
(headings/lists/tables/paths) — plus a rule for tool-call noise, which Buzz avoids structurally
(only explicit `buzz messages send` calls are ever spoken) rather than by filtering.

---

## STT / mic handling

**Engine:** sherpa-onnx + NVIDIA **Parakeet TDT-CTC 110M (English, INT8)**, **offline/batch**, one
decode per VAD-delimited utterance — not a streaming recognizer.
`desktop/src-tauri/src/huddle/stt.rs:247-275`, `stt.rs:521-530` (VERIFIED)

```rust
fn decode_speech(recognizer: &sherpa_onnx::OfflineRecognizer, speech_buf: &[f32]) -> String {
    let stream = recognizer.create_stream();
    stream.accept_waveform(16_000, speech_buf);
    recognizer.decode(&stream);
    stream.get_result().map(|r| r.text.trim().to_string()).unwrap_or_default()
}
```

Downloaded from the sherpa-onnx GitHub release, SHA-256 pinned, to
`~/.buzz/models/parakeet-tdt-ctc-110m-en/` (`models.rs:119-134`, `models.rs:47`). v1 was Moonshine
Tiny; they migrated because CTC blank-token decoding "eliminates the silence/cut-audio
hallucination class" (`models.rs:113-118`).

**Provider abstraction: none, again.** No trait, no enum, no `dyn`. `OfflineRecognizer` is used as
a concrete type. The whole config surface is the constructor (`stt.rs:83-87`, VERIFIED):

```rust
pub fn new(
    model_dir: PathBuf,
    ptt_active: Option<Arc<AtomicBool>>,
    manual_mic_unmuted: Option<Arc<AtomicBool>>,
) -> Result<(Self, tokio_mpsc::Receiver<String>), String>
```

**Mic capture happens in the WebView, not in Rust.** `getUserMedia` → `AudioWorklet` → raw-binary
Tauri IPC → Rust. This is the single most important architectural fact for ORCA, because it is why
Buzz needs no AEC of its own. `desktop/src/features/huddle/HuddleContext.tsx:569-579` (VERIFIED):

```ts
const audioConstraints: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  sampleRate: 48000,
};
```

- Frame: **960 samples = 20 ms @ 48 kHz** (one Opus frame), zero-copy transfer on both hops
  (`desktop/public/worklet.js:19-31`, `:52`).
- Resample **48 k → 16 k mono** with `rubato::Fft` inside the STT worker (`stt.rs:225-234`).
- Ingress is bounded and **lossy by design** — `try_send` into a 50-slot queue (~5 s backlog);
  "Drop audio if the pipeline can't keep up — better than blocking the UI" (`stt.rs:132-142`).
- `cpal` is used only for *output* device enumeration (`audio_output.rs:16-25`).

**VAD: `earshot` (Rust WebRTC-GMM VAD), not Silero.** `stt.rs:236-238`. Every constant, verbatim
(`stt.rs:160-183`, VERIFIED) — these are the numbers to copy:

```rust
/// How many 16 kHz samples of silence before we flush to STT.
/// 300 ms × 16 000 Hz / 256 samples-per-frame ≈ 19 frames.
/// Previous value (28 frames / 450 ms) felt sluggish in conversation.
///
/// This window is a turn-taking quality knob, not a latency lever: an earlier
/// env override (`BUZZ_STT_FLUSH_MS`) let it be lowered to 150 ms, which split
/// natural mid-sentence pauses into separate messages and confused the
/// listening agents. Reverted — the window is fixed at the production value.
const SILENCE_FLUSH_FRAMES: usize = 19;

/// earshot requires exactly 256 samples per frame at 16 kHz.
const VAD_FRAME_SAMPLES: usize = 256;          // = 16 ms

/// VAD probability threshold — above this is considered speech.
const VAD_THRESHOLD: f32 = 0.5;

/// Minimum voiced audio needed before an utterance may be decoded.
/// One earshot false-positive frame is only 16 ms; requiring 192 ms prevents
/// silence/room-noise blips from reaching Parakeet and becoming hallucinated
/// transcript text while still preserving short replies such as "yes".
const MIN_VOICED_FRAMES: usize = 12;
```

Plus a 30 s hard cap that force-flushes (`stt.rs:42`). Note both tuning attempts are recorded as
*failures* in the comment — that is the honest kind of prior art we want.

**Push-to-talk is the default**, not open mic (`state.rs:26-32`, VERIFIED):

```rust
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum VoiceInputMode {
    #[default]
    PushToTalk,
    VoiceActivity,
}
```

The gate is **two atomics OR'd** — a held shortcut *or* a manually-unmuted mic button
(`state.rs:132-143`, `stt.rs:436-448`). The rule worth stealing outright — *a held key means
"I'm not done", so silence must never end the utterance while held* (`stt.rs:551-553`):

```rust
fn vad_flush_allowed(ptt_mode: bool, manually_open: bool, ptt_held: bool) -> bool {
    !ptt_mode || (manually_open && !ptt_held)
}
```

Release is instead an **edge** that flushes (`stt.rs:313-326`). The shortcut is `Ctrl+Space`,
registered with the OS **only while a huddle is live in PTT mode** to avoid stealing the chord from
the user's IDE (`ptt_shortcut.rs:119-135`), and release carries a **200 ms tail delay guarded by a
press-generation counter** so a fast press→release→press can't have the first release clobber the
second press (`ptt_shortcut.rs:86-109`). The worklet gates locally too, so muted audio never
crosses the IPC boundary at all (`worklet.js:40-43`).

**Wake word: none.** (VERIFIED by absence — no wake-word engine anywhere in the tree.)

---

## Playback queue and barge-in

### Queue model

A **bounded `sync_channel` of `QueuedText`, depth 8**, drained by one worker
(`tts.rs:83`, `tts_pipeline_controls.rs:8-22`, VERIFIED):

```rust
pub fn speak(&self, text: String) -> Result<(), String> {
    self.text_tx
        .try_send(QueuedText {
            generation: self.voice_generation.load(Ordering::Acquire),
            route_id: 0,
            speaker_pubkey: None,
            speaker_generation: 0,
            voice_reference: None,
            text,
        })
        .map_err(|e| { eprintln!("buzz-desktop: TTS queue saturated, dropping message: {e}"); … })
}
```

Overflow **drops with a log**, never blocks. Downstream of the channel there is a second,
in-worker `VecDeque` (`deferred_text`, `tts.rs:444`) used to re-queue an item whose speaker isn't
the current audio owner (`tts.rs:619-633`).

**Every queue item carries three generation tags**, and this is the real design insight:

| Tag | Invalidates | Evidence |
|---|---|---|
| `generation` (voice) | items queued before a voice switch | `tts.rs:611-618` |
| `speaker_generation` | items for an agent that was removed / Stopped | `tts.rs:604-610`, `tts_pipeline_controls.rs:37-59` |
| `route_id` | log correlation across stages | throughout |

A stale Stop click cannot silence a later utterance, because the speaker generation is advanced
*while ownership is locked* (`tts_pipeline_controls.rs:46-59`).

The playback device itself is guarded by a `PlaybackCoordinator` — a `Mutex<PlaybackState>` that
serializes every rodio `Player` operation (`tts_playback.rs:12-25`, VERIFIED). Cancellation
**swaps in a brand-new `Player`** and drops the old one *after* releasing the lock, so rodio
teardown can't extend the critical section (`tts_playback.rs:140-159`):

```rust
pub(super) fn cancel_if_live(&self, authorize: impl FnOnce() -> bool, commit: impl FnOnce()) -> bool {
    let old_player = {
        let mut state = self.lock();
        if (state.player.empty() && !state.synthesis_in_flight) || !authorize() { return false; }
        state.first_append = true;
        state.synthesis_in_flight = false;
        state.synthesis_generation = state.synthesis_generation.wrapping_add(1);
        let old_player = std::mem::replace(&mut state.player, Player::connect_new(&self.mixer));
        commit();
        old_player
    };
    drop(old_player);
    true
}
```

### Barge-in — and the surprise

**Local mic speech does NOT interrupt TTS in Buzz.** Only three things set `tts_cancel`:

1. **The PTT key going down** — with a stale-flag guard (`ptt_shortcut.rs:67-76`, VERIFIED):
   ```rust
   hs.ptt_active.store(true, Ordering::Release);
   // Only cancel TTS if it's actually playing — avoids
   // a stale cancel flag that drops the next queued message.
   if hs.tts_active.load(Ordering::Acquire) {
       hs.tts_cancel.store(true, Ordering::Release);
   }
   ```
2. **A remote human speaking**, detected by counting non-DTX Opus packets per peer in a 500 ms
   window (`playout.rs:350-363`, `relay_api.rs:25-26`): threshold 5 frames ≈ **~100 ms of
   sustained remote speech kills local TTS**. Counters reset on the `tts_active` rising edge so
   pre-TTS chatter doesn't count.
3. The explicit per-agent **Stop** command, `interrupt_huddle_speech` (`commands.rs:29-46`).

Stated deliberately at `stt.rs:64-68` (VERIFIED):

> "Mic input is transcribed even while agent TTS is playing: the huddle UI already tells users to
> wear headphones, so speaker bleed is accepted in exchange for never dropping human speech that
> overlaps agent audio. **Local mic frames still never cancel TTS** — push-to-talk and remote
> participant speech remain the explicit barge-in paths."

### Enforcement — the part worth copying verbatim

A dedicated **10 ms monitor thread**, not a check inside the worker, because the worker can be
blocked for hundreds of ms inside ONNX inference (`tts.rs:87-91`, VERIFIED):

```rust
/// Poll interval of the barge-in monitor thread. Bounds flag-to-silence
/// latency: a cancel is noticed within one tick, and rodio's internal
/// `periodic_access` wrapper stops the in-flight source within a further
/// ~5 ms — so playing audio dies ~15 ms after the flag is set, even while
/// the worker is blocked inside `synth_chunk`.
const MONITOR_TICK: Duration = Duration::from_millis(10);
```

The flag is consumed **exactly once at a serialization point**, and the *reason* decides whether
the queue survives (`tts_voice_transition.rs:484-493`, VERIFIED):

```rust
// Consume at the serialization point. A later barge-in remains true
let barge_in = cancel.swap(false, Ordering::AcqRel);
```

**Barge-in clears the whole queue; a voice switch preserves it.** That distinction is exactly the
kind of thing we'd get wrong on a first pass.

### Transport controls: what exists and what doesn't

| Control | Present? | Evidence |
|---|---|---|
| Stop / interrupt (per agent) | ✅ | `commands.rs:29-46` |
| Cancel-all on barge-in | ✅ | `ptt_shortcut.rs:67-76`, `playout.rs:350-363` |
| Voice switch (cancels current, keeps queue) | ✅ | `tts_pipeline_controls.rs:66-78` |
| Global enable/disable TTS | ✅ | `tts_settings.rs:521` `set_tts_enabled` |
| **Pause / resume** | ❌ | absence — grepped `fn pause|resume\(` |
| **Skip to next utterance** | ❌ | absence |
| **Playback speed / rate / pitch** | ❌ | absence — `TtsSettings` has 3 fields, none of them rate |
| **Replay / scrub** | ❌ | absence |

---

## Full-duplex concerns

Three findings, all VERIFIED, and the third is a trap to avoid.

**1. Acoustic echo cancellation: none of their own.** Grepped `webrtc-audio-processing`,
`speexdsp`, `rnnoise`, `nnnoiseless`, `aec3` across `Cargo.toml`/`Cargo.lock` — zero. No echo
reference signal is plumbed anywhere; the TTS output path (rodio → `MixerDeviceSink`,
`audio_output.rs:68-98`) shares nothing with the capture path. **The entire AEC strategy is the two
`getUserMedia` booleans** — `echoCancellation: true, noiseSuppression: true`
(`HuddleContext.tsx:571-572`) — i.e. whatever the WebView's WebRTC stack provides.

**2. Half-duplex gating: designed, documented, race-proofed — then not shipped.** The doc comments
still promise it (`state.rs:22-25`: *"While local TTS is playing, mic frames are discarded because
VAD has no echo reference"*; `state.rs:101`: *"Shared with the STT pipeline for … echo gating"*).
**Both are false of the shipped code** — `SttPipeline::new` takes no `tts_active` parameter and
`grep tts_active stt.rs` returns nothing. Yet the invariant is defended hard, and the stated reason
is mic gating (`tts_playback.rs:371-377`):

> "…a `false` landing outside the replacement would **ungate the mic for audio that is actually
> playing, and VAD would hear our own TTS and barge in on it.**"

There is even a race test named
`a_targeted_cancel_racing_an_append_leaves_the_mic_gate_released`
(`tts_speaker_cancellation.rs:207`) asserting `tts_active == !playback.empty()`.

Read that as: **they built the contract for half-duplex gating, proved it race-free, and then chose
not to gate** — trading echo risk for never losing human speech that overlaps agent audio. The
product-level fallback is `stt.rs:65`: *"the huddle UI already tells users to wear headphones."*

**3. Ducking: none.** `grep -i duck` over `desktop/src-tauri/src` and `crates/buzz-voice` → zero.
The only gain control is a user-set *mic input* gain (`audioWorklet.ts:142-144`) and a
clock-drift `set_speed(1.02)` on the remote playout path (`playout.rs:151-155`).

> ⚠️ **Doc-comment trap.** `state.rs:16-25` labels *both* `VoiceInputMode` variants "(default)"
> and claims mic frames are discarded during TTS. Neither matches the code. Do not mine that
> comment.

---

## UI affordance inventory

Every visible voice affordance in Buzz Desktop. All paths relative to repo root at `2a236e4`.
V = VERIFIED (read in source), I = INFERRED (established from absence or from class names).

### Speaking / level indication

| Element | Purpose | When shown | Evidence | Copy? |
|---|---|---|---|---|
| **Speaking ring on avatar** — 2 px green (`hsl(142 71% 45%)`) `::after` ring; opacity `0.45 + level*0.55`, scale `1.02 + level*0.14`, 80/90 ms transitions | Who is talking + how loud | `speakerLevel > 0.04` | `ParticipantList.tsx:436-451`; `components.css:182-200` (V) | ✅ **Yes** |
| Same ring, reduced-motion variant — fixed `scale(1.04)`, `transition:none` | a11y | `prefers-reduced-motion` | `components.css:239-247` (V) | ✅ Yes |
| **Agent TTS drives the *same* ring as human speech** — remote Opus levels and the `huddle-tts-speaker-level` RMS envelope are `Math.max`-merged | A synthesized voice looks identical to a person's | Always | `useHuddleSpeakerActivity.ts:16-38,55-75` (V); producer `tts_activity.rs:17-44` | ✅ **Yes — the single best UX idea here** |
| Per-row status text: `"Speaking"` / `"Agent"` / `"In huddle"` | Non-color speaking state | Always | `ParticipantList.tsx:268-270` (V) | ✅ Yes (a11y) |
| **Mic level meter** — 3-bar equalizer, center tallest, heights `0.25 + level*{0.5,0.875,0.625}` rem | Your own live mic level | `micConnected && !muted && !compact` | `MicControls.tsx:200-218`, `:50-74` (V) | ⚠️ Only if we do mic |
| Meter → chevron hover swap (`group-hover:hidden`) | The meter *is* the settings button | On hover/focus | `MicControls.tsx:205,219` (V) | ✅ Yes — elegant |
| Mic level algorithm — 512-pt FFT, RMS @30 Hz, **hysteretic gate** (on 0.018 / off 0.012), adaptive noise floor, emits exactly `0` when gated | Meter fully rests instead of twitching | Continuous | `useMicLevelAnalyser.ts:3-11,47-89` (V) | ✅ Yes |
| **No waveform, no scrubber, no progress bar anywhere** | — | — | absence across `features/huddle/` (I) | — |

### Mic / push-to-talk

| Element | Purpose | When shown | Evidence | Copy? |
|---|---|---|---|---|
| Mic **split button** — big toggle + narrow chevron | Slack-style one control, two jobs | Always | `MicControls.tsx:142-178` (V) | ✅ Yes |
| Mic aria-labels, 3 states: `"Microphone unavailable"` / `"Unmute microphone"` / `"Mute microphone"`; `aria-disabled` not `disabled` so it stays focusable+tooltippable | a11y | Always | `MicControls.tsx:119-123,152-154` (V) | ✅ Yes |
| **PTT tooltip with `<kbd>` chip** — `"Click to unmute or hold"` + `⌃Space` / `Ctrl+Space` | **The only place the hold key is surfaced** | PTT mode, muted, mic available | `MicControls.tsx:181-187` (V) | ✅ Yes |
| Huddles **start muted** in PTT mode | No hot mic on join | Always | `huddle-transcription.spec.ts:1286-1294` (V) | ✅ Yes |
| PTT toggle row + `aria-live="polite"` announcement (`"Push to Talk is enabled."`) | Mode switch | In audio popover | `MicControls.tsx:234-259` (V) | ✅ Yes |
| **PTT audio earcons** — 50 ms oscillator, **880 Hz press / 440 Hz release**, gain 0.05, Web Audio | Non-visual confirmation the mic opened | Every `ptt-state` event in PTT mode | `useHuddlePttState.ts:36-54` (V) | ✅ **Yes — cheap, high value** |
| Mic-unavailable recovery card + **"Open Settings"** deep link to `x-apple.systempreferences:…Privacy_Microphone` | Permission recovery | `!micConnected` (+ macOS) | `MicControls.tsx:293-319` (V) | ✅ Yes |

### Agent speech output

| Element | Purpose | When shown | Evidence | Copy? |
|---|---|---|---|---|
| **Global agent-speech mute** — `Volume2`↔`VolumeX` split button; calls the *same* `set_tts_enabled` as the Settings toggle | One shared global state, two surfaces | Always in huddle | `MicControls.tsx:396-412`; `HuddleBar.tsx:677-683` (V) | ✅ Yes |
| **"Stop \<name\> speaking"** button — `bg-destructive/15`, label `Stop`, calls `interrupt_huddle_speech` | Per-agent barge-in | Agent is currently speaking | `ParticipantList.tsx:332-344` (V) | ✅ Yes |
| **Stop occupies a pre-reserved fixed-height slot** replacing the name — E2E asserts *byte-identical bounding boxes* idle vs speaking | Zero layout shift | Always | `ParticipantList.tsx:328-349`; `huddle-transcription.spec.ts:717-745` (V) | ✅ **Yes — the detail we'd otherwise get wrong** |
| PTT press also cancels active TTS | Talk over the agent to stop it | PTT press during speech | `ptt_shortcut.rs:67-76` (V) | ⚠️ Concept only |
| Output-device picker + `"Change takes effect on next huddle"` hint | Sets the expectation that it isn't live | Chevron | `MicControls.tsx:424-502` (V) | ❌ (that hint is the #6044 bug wearing a disclaimer) |
| **Headphones/echo nudge popover** — `"Headphones help prevent echo"` … `"If people are nearby, speakers can feed back into your mic."`; auto-opens without stealing focus; dismissal persisted to `localStorage["buzz.huddle.headphones-hint-seen"]` | Their entire AEC "solution", as UI | `aecMissing && !dismissed` | `MicControls.tsx:351-395`; `HuddleBar.tsx:72-76,668-676` (V) | ⚠️ Only as fallback |
| **Per-agent voice menu** — the agent's *avatar itself* is the trigger (kebab in room mode) | Voice settings where the agent is | Agents only | `ParticipantList.tsx:308-326,373-382`; `AgentVoiceMenu.tsx:88-107` (V) | ✅ Yes (pattern) |
| Per-agent TTS switch + per-agent voice picker; **turning TTS off *removes* the voice selector** rather than graying it | Progressive disclosure | In menu | `AgentVoiceMenu.tsx:108-145` (V) | ✅ Yes |
| **Auto-assigned distinct voices per agent** on join, overridable | Speaker separation with zero configuration | On join with TTS on | `huddle-transcription.spec.ts:784-812` (V) | ✅ Yes (if ORCA ever has >1 agent) |
| TTS eligibility filter — speaks only agent-authored stream messages with a matching `h` tag, non-empty, not self-authored, **not starting `"[System]"`**; strips markdown image/attachment lines first | Never reads URLs, system noise, or your own text aloud | Per event | `ttsLiveMessages.ts:31-76` (V) | ✅ **Yes** |
| Single bounded ordered TTS queue | No overlapping voices | Always | `ttsLiveMessages.ts:98-110` (V) | ✅ Yes |
| **No per-message play button** | — | — | absence (I) | — (we *are* building this — see issue #4403) |

### Transcript / captions

| Element | Purpose | When shown | Evidence | Copy? |
|---|---|---|---|---|
| **Captions toggle** — lucide `Captions` icon, `aria-pressed`, label flips `"Start transcript"`↔`"Stop transcript"` | Start/stop live STT | Always in drawer | `HuddleBar.tsx:777-796` (V) | ✅ Yes |
| Transcript intro/empty-state card — `"Huddle chat"` / `"…The transcript appears here too."` | Orientation + empty state in one | Pinned at top | `HuddleTranscriptIntro.tsx:6-20` (V) | ✅ Yes |
| **Transcript is deliberately flat** — day dividers hidden, identity re-shown on *every* row (no consecutive grouping), thread panel never opens | "Live conversation, not channel history" | Transcript surface only | `MessageTimeline.tsx:74-78`; `TimelineMessageList.tsx:105-109` (V) | ✅ Yes |
| Transcript failure chip — `Transcript failed: {msg}` | Inline error | `transcriptError` | `HuddleBar.tsx:624-628` (V) | ✅ Yes |

### Settings pane (`Settings → Voice`)

| Element | Purpose | When shown | Evidence | Copy? |
|---|---|---|---|---|
| Nav entry `Voice` + `Volume2` icon; header copy *"Choose whether Buzz reads new agent responses aloud during an active huddle."* | Frames TTS as huddle-scoped | Always | `SettingsPanels.tsx:169-173`; `VoiceSettingsCard.tsx:188-192` (V) | ✅ Yes |
| **Master TTS toggle**, default **on** | Master on/off | Always | `VoiceSettingsCard.tsx:198-219` (V) | ✅ Yes |
| **Dimmed dependent region** — `pointer-events-none opacity-45`, `aria-disabled`; **retains its selection** when disabled | Controls deactivate without losing state | Toggle off | `VoiceSettingsCard.tsx:223-230` (V) | ✅ Yes |
| Voice picker — 12 bundled voices, default `Mary`, `max-h-80` scroll | Pick voice | Always | `VoiceSettingsCard.tsx:244-278` (V) | ✅ Yes |
| Duplicate-name disambiguation → `"{name} · {last-8-of-key}"` | Imported voices can collide with bundled names | On collision | `voiceSettingsLogic.ts:45-57` (V) | ✅ Yes |
| **Preview button** — `Play` icon swaps to `Volume2 animate-pulse` while playing | Audition before committing | Always | `VoiceSettingsCard.tsx:280-309` (V) | ✅ **Yes** |
| Add voice (import) / Delete voice — delete shown **only** for `pocket:imported:*` keys; confirm dialog names the fallback (*"Mary will be selected instead."*) | Custom voices, safely | Imported voices only | `VoiceSettingsCard.tsx:310-378` (V) | ⚠️ Later |
| Single `role="alert"` error banner covering all five failure paths | One error surface | `error !== null` | `VoiceSettingsCard.tsx:337-345` (V) | ✅ Yes |
| **Optimistic-state reconciliation** — on save failure re-reads `get_huddle_state` and syncs rather than trusting the optimistic value | The toggle never lies | On failure | `VoiceSettingsCard.tsx:92-105` (V) | ✅ Yes |
| Internal model name never leaks — E2E asserts the card must **not** contain `"April INT8"` | User-facing names only | Always | `voice-settings.spec.ts:83-84` (V) | ✅ Yes |
| **No speed/rate, pitch, volume, model, or provider control** | — | — | schema is `{version, agentTextToSpeech, voicePreferences[]}`; backend hard-coded `POCKET_BACKEND_ID` (I) | ❌ We need these |

### Connection / readiness / errors

| Element | Purpose | When shown | Evidence | Copy? |
|---|---|---|---|---|
| **Model readiness ticker** — pulsing `<output>` reading `Voice models: STT ready, TTS 42%` / `pending` / `error`; polled every 10 s **only while connected and the document is visible** | Says *why* nothing is speaking yet | Any model not ready | `HuddleBar.tsx:280-291,595-610,271-320` (V) | ✅ **Yes — local TTS has a cold start** |
| **Screen-reader status line** — one `aria-live="polite"` `<output>` concatenating mic state + input mode + the `Ctrl+Space` hint + model state | The single a11y summary | Always | `HuddleBar.tsx:871-884` (V) | ✅ Yes |
| Inline error chips (dismissible, `role="alert"`) **inside** the drawer; `toast.error` only for failures **before** the drawer exists | Errors appear where the user is looking | Respective failures | `HuddleBar.tsx:577-593,612-628`; `HuddleIndicator.tsx:236,317` (V) | ✅ Yes |
| Capability error copy — `"Huddle audio isn't available on this server. Ask an administrator to turn it on."` | Actionable, not a raw error code | Join/start failure | `huddleError.ts:3-36` (V) | ✅ Yes |
| **Silent audio auto-reconnect** — backoff `[0,100,250,500,1000,2000,2000] ms`, force-leaves only after all seven fail | Survives a draining relay without bothering the user | Transport drop | `HuddleContext.tsx:827-860` (V) | ✅ Yes (pattern) |
| Starting cover — `role="status"`, animated bee, `sr-only "Starting huddle"` | No white flash during native spin-up | Connecting | `HuddleStartingView.tsx:5-17` (V) | ✅ Yes |
| **No visible "connecting/reconnecting" text** | — | — | absence (I) | ❌ We should have one |

### Shell / entry points

| Element | Purpose | When shown | Evidence | Copy? |
|---|---|---|---|---|
| **Bottom drawer** — forced dark palette; the app above lifts `bottom:5rem` with corners → 24 px over 260 ms | Slack-style persistent voice tray | While in a huddle | `HuddleBar.tsx:566-575`; `components.css:17-126` (V) | ⚠️ Style-dependent |
| Participant strip + `+N` overflow chip (max 9 visible) → roster popover | Presence at a glance | `participants > 0` | `ParticipantList.tsx:292-300,397-413` (V) | ❌ Multi-party only |
| **Sidebar "In a huddle" mini-card** — green `Headphones`, channel name, embedded *compact* MicControls + `Leave` | Mute stays reachable from anywhere once the huddle is popped out | Connected and drawer not showing | `HuddleProfileControl.tsx:118-170` (V) | ✅ **Yes — persistent-control pattern** |
| Pop-out / return-to-drawer buttons | Move the huddle to its own OS window | Per mode | `HuddleBar.tsx:818-855` (V) | ⚠️ Nice-to-have |
| Leave button — destructive, `PhoneOff`, `aria-busy` while leaving | Hang up | Always | `HuddleBar.tsx:857-868` (V) | ✅ Yes |
| Channel-header **pulsing ring + participant-count badge** on the huddle button | "A huddle is live here — join" | Active huddle | `HuddleIndicator.tsx:277-360` (V) | ❌ Multi-party only |
| Timeline huddle card — `Huddle · In progress` / `Huddle · Ended`, `Join` → `Joining` | Huddles leave a durable, joinable artifact in history | On huddle-start messages | `HuddleAttachment.tsx:235-307` (V) | ⚠️ Interesting |

### Keyboard shortcuts

Canonical registry at `desktop/src/shared/lib/keyboard-shortcuts.ts:24-242`.
**None are user-configurable** — the settings card says so verbatim: *"All available keyboard
shortcuts. Shortcuts are read-only."* (`KeyboardShortcutsCard.tsx:42`). For ORCA that is a
mistake to avoid; a hotkey plugin must be rebindable.

| Keys | Action | Scope | Evidence |
|---|---|---|---|
| `Ctrl+Space` | **Push to talk** — "Hold to unmute in a huddle" | **Global (OS-wide), conditionally registered** | `keyboard-shortcuts.ts:191-198`; `ptt_shortcut.rs:132` (V) |
| `Ctrl+Shift+Space` | Start / join / leave huddle | In-app, bound on `window` with `capture:true` so it beats a focused composer | `keyboard-shortcuts.ts:182-190`; `useAppShellKeyboardShortcuts.ts:39-54` (V) |

Three mechanics worth copying for a hotkey-driven ORCA plugin:

1. **Conditional OS reservation.** `should_register()` is true only when
   `voice_input_mode == PushToTalk` **and** the phase is `Connected|Active`; otherwise the combo is
   unregistered so it does not steal `Ctrl+Space` from the user's IDE. Registration failure logs
   and degrades to VAD mode rather than breaking the feature. `ptt_shortcut.rs:1-6,117-146` (V)
2. **Native emits, UI sounds.** Rust does `app.emit("ptt-state", …)`; the earcon is played in the
   renderer via Web Audio. The comment records that a native-audio implementation was considered
   and **rejected for lifecycle complexity**. `ptt_shortcut.rs:77-84` (V)
3. **`capture: true` on the in-app binding** so a focused text composer cannot swallow the chord.

### Screenshots

`docs/assets/screenshots/` contains exactly four files — `channel-agents.png`,
`channel-thread.png`, `create-channel.png`, `media-comments.png` — and **none is voice-, huddle-,
or TTS-related** (VERIFIED). The README mentions huddles three times in passing and lists
"Huddle lifecycle events" under **🚧 Being wired up**, not ✅ Works today (`README.md:41,51,104`).
There is no README screenshot, marketing copy, or `docs/*.md` page describing text-to-speech,
voice selection, push-to-talk, or the hotkeys. **Buzz's voice UX is documented only in code and
E2E tests** — the inventory above is the whole of it, and the E2E specs
(`desktop/tests/e2e/voice-settings.spec.ts`, `huddle-transcription.spec.ts`) are the best
"spec document" that exists.

### Cross-cutting conventions worth adopting

- **A precise destructive-tint convention, enforced by tests.** `bg-destructive/15` = a
  user-toggleable muted state (mute mic, Stop-speaking); `bg-destructive/35` = an
  unavailable/hard-blocked state (mic unavailable, agent speech muted). Adjacent settings buttons
  are explicitly asserted *not* to carry either.
  `huddle-transcription.spec.ts:216-218,694-704,1300-1302` (VERIFIED)
- **Every audio control is a split button** — big toggle plus narrow settings chevron.
- **Model readiness is a first-class UI state**, not a spinner.
- **Errors inline where the user is looking; toasts only before the surface exists.**

---

## Cross-platform reality check

**Headline: the voice stack is OS-agnostic by construction; the *shell around it* is not, and
Linux/Windows are demonstrably second-class in practice.**

The single most useful measurement: `grep -rn 'cfg(target_os' desktop/src-tauri/src/` returns **87
hits across the desktop backend — and exactly zero of them are in `huddle/`.** The only conditional
compilation anywhere in the voice code is two `#[cfg(unix)]` blocks in
`crates/buzz-voice/src/imported.rs:275,288`, and both are about *file permissions* (`0o700` on the
voice storage dir, `0o600` on written files), not audio. (VERIFIED)

The OS-specific code lives in `lib.rs` (16), `managed_agents/runtime/sweep.rs` (7),
`tray_menu.rs` (6), `prevent_sleep.rs` (6), `secret_store.rs` (5), `initial_window.rs`,
`app_menu.rs`, `commands/notifications.rs`, `commands/window_chrome.rs` — i.e. tray, menus,
windowing, notifications, secrets, process management. **Never audio.**

### Which OSes does it actually run on?

**All three, genuinely — this is not a macOS app with a Linux port bolted on.** `release.yml`
builds **four** platform jobs that all upload into one release, and the assembly step hard-fails if
fewer than three succeed (`release.yml:907`: `[ "${#TRIPLES[@]}" -ge 3 ] || { echo "::error::too
few platforms"; exit 1; }`) (VERIFIED):

| Job | Runner | Target | Evidence |
|---|---|---|---|
| macOS Apple Silicon | `macos-latest` | `aarch64-apple-darwin` | `release.yml:55`, artifact `Buzz_${VERSION}_aarch64.app.tar.gz` `:240` |
| macOS Intel | `macos-latest` | `x86_64-apple-darwin` | `release.yml:268-279` |
| Linux | `ubuntu-latest` | x86_64, AppImage + deb | `release.yml:429` |
| Windows | `windows-latest` | NSIS/MSI | `release.yml:657` |

There are also four dedicated per-OS canary workflows kept green on `main` —
`windows-canary.yml`, `linux-canary.yml`, `macos-intel-canary.yml`, `signed-macos-canary.yml`.
`tauri.conf.json:54` sets `"targets": "all"`. So the *build* parity is real and enforced.

**But the day-to-day parity is not.** The issue tracker is where this shows (VERIFIED via
`gh issue list`), and the pattern is one-sided:

| Issue | OS | What breaks |
|---|---|---|
| **6044** | **Windows 11** | *"Huddle: speaker (audio output) selector is inert — cannot enable the speaker or change output device"* — an **audio-output** bug, Windows-only |
| **4358** | Linux | WebKitWebProcess **segfaults in PipeWire's `module-metadata`** on startup — *device enumeration alone*, no huddle join needed |
| **2560** | Linux | Mixed GStreamer deps → *"unreliable audio on Ubuntu 26.04"* |
| **2562** | Linux | Notification sounds never play — WebKitGTK can't load media from Tauri's custom URI scheme |
| **3494** | Linux | Bundled `libsoup-3.0`/`libnghttp2` shadow system libs, breaking system GStreamer WebRTC |
| **2811 / 2604 / 3109** | Linux | AppImage display failures, dynamic-linking crashes, Hyprland/Wayland protocol error |
| **3495** (closed) | Linux | Huddles failed with `NotAllowedError` — WebKitGTK user-media permission unhandled |

**Read as:** macOS is the reference platform. Windows has at least one live *audio-output* defect.
Linux has a whole cluster of audio/media-stack defects, most of them rooted in **WebKitGTK and the
Linux media stack**, not in Buzz's own audio code.

### Audio OUT, portably

One library, three backends, **no conditional code in Buzz at all**:

```
Buzz  →  rodio 0.22  →  cpal  →  ┬─ CoreAudio   (macOS)
                                 ├─ WASAPI      (Windows)
                                 └─ ALSA        (Linux)
```

`rodio = "0.22"` at `desktop/src-tauri/Cargo.toml:143`; Buzz touches `rodio::cpal` only for output
*device enumeration* (`huddle/audio_output.rs:16-25`), using the generic `HostTrait` /
`DeviceTrait` API with zero platform branches. The single platform-visible build requirement is
**`libasound2-dev` on Linux** (`linux-canary.yml:65`), i.e. ALSA headers for cpal. (VERIFIED)

Grepped for OS-specific shelling-out — `afplay`, `say`, `powershell`, `paplay`, `pactl`,
`coreaudio`, `wasapi`, `alsa`, `pulseaudio`, `pipewire` — across `huddle/` and `buzz-voice/`:
**zero hits.** Nothing invokes a system TTS or a platform audio CLI. (VERIFIED by absence)

### Audio IN (mic), portably

**Capture is not in Rust at all** — it is `navigator.mediaDevices.getUserMedia` +
`AudioWorklet` in the WebView (`HuddleContext.tsx:569-579`, `audioWorklet.ts:56-76`), with PCM
shipped to Rust over Tauri's raw-binary IPC.

That choice **buys portability and costs consistency**:

- ✅ One code path for mic capture, device enumeration, and permissions on all three OSes.
- ✅ Free platform AEC/NS via the `echoCancellation: true, noiseSuppression: true` constraints.
- ❌ **The webview is not the same engine on each OS.** macOS/iOS get WKWebView, Windows gets
  WebView2 (Chromium), Linux gets **WebKitGTK** — and WebKitGTK is exactly where issues #4358,
  #3495, #2562, and #3118 land. The `getUserMedia` contract is nominally identical; the
  implementation quality is not.
- ❌ `cpal` is *not* used for input, so there is no in-process fallback when the webview's media
  stack fails.

### Native binaries and models per platform+arch

**Models are platform-independent; native code is vendored by the crates.** (VERIFIED)

| Artifact | Per-platform? | How fetched / cached |
|---|---|---|
| **Pocket TTS ONNX graphs** (Mimi encoder/decoder, text conditioner, Flow LM ×2) | ❌ No — plain `.onnx`, one build for all OSes | HuggingFace, revision-pinned URL `models.rs:50-51`, **SHA-256 pinned per artifact**, cached to `~/.buzz/models/pocket-tts/` |
| **Parakeet STT** | ❌ No — `.tar.bz2` of `model.int8.onnx` + `tokens.txt` | sherpa-onnx GitHub release `models.rs:120`, `STT_ARCHIVE_SHA256` pinned `models.rs:47`, extracted to `~/.buzz/models/parakeet-tdt-ctc-110m-en/` |
| **Reference voice WAVs** (12 bundled + Kyutai p333) | ❌ No | `desktop/src-tauri/resources/pocket-voices/*.wav`, shipped in the bundle |
| **ONNX Runtime native lib** | ✅ Yes, but **not Buzz's problem** | `sherpa-onnx 1.12` vendors it; `ort-sys` is pinned with `features = ["disable-linking"]` (`buzz-voice/Cargo.toml:14`) so `ort` does **not** link its own copy — one runtime, supplied by sherpa, per platform |

A version manifest (`.buzz-model-manifest`) triggers re-download on mismatch (`models.rs:1-19`).
Cache root is `dirs::home_dir()?.join(".buzz").join("models")` (`models.rs:608`) — portable, though
on Windows that means a dotfile directory in the user profile rather than `%LOCALAPPDATA%`.

**The clean consequence for us: a downloaded ONNX model is one artifact for all platforms+arches.**
Only the inference runtime is per-platform, and a crate/npm package supplies it.

### Is the echo-cancellation / barge-in mechanism OS-specific?

**AEC: yes, entirely — and it is not theirs.** Buzz ships **no** AEC code (grepped
`webrtc-audio-processing`, `speexdsp`, `rnnoise`, `nnnoiseless`, `aec3` across `Cargo.toml`/`.lock`
→ zero). The whole strategy is two `getUserMedia` booleans, so the *actual* echo canceller is
**WKWebView's on macOS, WebView2/Chromium's on Windows, WebKitGTK's on Linux** — three different
implementations of differing quality, none under their control. Their UI even concedes this with
an `aecMissing` code path that pops the *"Headphones help prevent echo"* nudge
(`MicControls.tsx:351-395`). ⚠️ **This does not port cleanly to a non-webview capture path.**

**Barge-in: no, portable.** The trigger paths are a Tauri global shortcut, an Opus packet counter,
and a UI command; enforcement is an `AtomicBool` polled by a `std::thread` at 10 ms that swaps a
rodio `Player`. Zero platform branches (`tts_speaker_cancellation.rs`, `tts_playback.rs`,
`playout.rs:350-363`). ✅ **Ports as-is.**

### OS-specific bits in the UI / shell layer

| Thing | Portable? | Detail |
|---|---|---|
| **Global hotkey registration** | ⚠️ Mostly | `tauri-plugin-global-shortcut` v2 abstracts all three OSes, and `Ctrl+Space` is used unmodified everywhere. **But** the plugin is `#[cfg(test)]`-stubbed out entirely because *"linking the plugin into the lib-test binary makes it fail to load on **Windows** (`STATUS_ENTRYPOINT_NOT_FOUND`) before any test runs"* (`ptt_shortcut.rs:14-21`). A Windows-specific linking landmine, and it means **the PTT hotkey path is never exercised by the unit-test suite on any platform.** |
| Hotkey **label** | ✅ | `isMacPlatform() ? "⌃Space" : "Ctrl+Space"` (`MicControls.tsx:111`); registry carries `keys` + `keysWindows` (`keyboard-shortcuts.ts:265-277`) |
| **Mic-permission deep link** | ❌ **macOS only** | `x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone`, rendered behind `{isMac && …}` (`MicControls.tsx:300-319`). **Windows and Linux users get the "Microphone unavailable" card with no recovery button.** A real parity gap in the exact failure state where help matters most. |
| Platform detection | ⚠️ | `isMacPlatform()` / `isLinuxPlatform()` sniff **`navigator.platform`** — deprecated and unreliable — rather than Tauri's `os` plugin (`shared/lib/platform.ts:7-24`). Notably there is **no `isWindowsPlatform()`**: Windows is the else-branch. |
| **Prevent-sleep during a session** | ❌ **macOS only, silently** | `prevent_sleep.rs` links IOKit (`IOPMAssertionCreateWithName`) under `#[cfg(target_os = "macos")]`; the `#[cfg(not(target_os = "macos"))]` arm is a **no-op stub** that just sets `assertion_id = None` (`prevent_sleep.rs:91-96,187-191`). Windows and Linux machines can idle-sleep mid-session. |
| Tray menu / app menu / notifications / window chrome | ❌ Per-OS | `tray_menu.rs` (6 `cfg`s), `app_menu.rs` (4), `commands/notifications.rs` (3), `commands/window_chrome.rs` (3), `initial_window.rs` (4) |
| **Huddle companion window** | ✅ | `huddle/window.rs` uses Tauri's `WebviewWindowBuilder` with no platform branches |
| Reduced-motion / a11y CSS | ✅ | Standard media queries |

---

## Known problems

From their open issues (VERIFIED — read via `gh issue view` on `block/buzz`) and from in-code
admissions. Ranked by how much each should change *our* plan.

### Design gaps their own maintainers name

| # | Issue | What it tells us |
|---|---|---|
| **6179** | *standalone TTS CLI, and where markdown-for-speech preprocessing should live* | **The most useful issue in the repo.** Confirms `preprocess_for_tts` "**does not strip headings, lists, or tables**", and that there are now **three callers of similar logic already drifting** (huddle, a proposed CLI, and draft PR #3240). Lesson: put the normalizer in a shared, host-agnostic module from commit one, with the latency-specific choices (first-sentence-alone, number expansion) as **options, not defaults**. |
| **3720** | *pluggable STT/TTS backends* | A self-hosting user with a Malay/Mandarin/English code-switching team: "there is no way to point huddles at it: no config, no env var, no endpoint override. **The models are compiled into the pipeline.**" Proposes OpenAI-compatible `POST /v1/audio/transcriptions` and `/v1/audio/speech` as the seam. This is the shape our provider interface should take. |
| **4403** | *play a message aloud, with a TL;DR audio mode* | Exactly our "speak selection" feature, still unbuilt. Carries **two hard-won warnings from someone who shipped it elsewhere**, quoted below. Also defines the markdown-for-the-ear target: "headings become pauses, list items become sentences, tables are announced by row." Explicitly rejects auto-play: *"Unsolicited audio in a chat client is hostile. On request only."* |
| **6346** | *RFC: End a hands-free turn by asking "did they finish?", not by timing silence* | Argues the 300 ms silence timer is structurally wrong — a pause is not a finished sentence (SHIFT vs HOLD; cites LiveKit's end-of-turn work and Ekstedt & Skantze, [arXiv:2205.09812](https://arxiv.org/abs/2205.09812)). Notes Buzz already **failed at tuning in both directions** (450 ms sluggish, 150 ms split sentences). Proposes a small local turn-detection model gated behind the existing timer. |
| **5194 / 2478** | English-only transcription *and* speech | Both models are English-only; Korean produces garbled transcripts. Direct consequence of #3720. |

Two warnings from #4403 worth transcribing in full, because they are cheap now and expensive later:

> **1. Concurrent playback needs a single owner.** "Two things speaking at once isn't a degraded
> experience, it's an unusable one — and it happens immediately once more than one surface can
> trigger speech. I ended up needing **one mutual-exclusion primitive that *every* playback path
> acquires** before it may open the output device. Retrofitting that across paths each written
> assuming it was alone was the bulk of the work."
>
> **2. Audio output devices disappear.** "A monitor going to sleep takes its HDMI audio device with
> it. Most audio stacks **enumerate devices once at initialisation**, so every subsequent call
> fails against a stale handle — and if that exception escapes the playback thread, speech dies
> silently mid-sentence and reads to the user as 'the feature is broken' rather than 'the device
> went away.' Playback needs to **re-initialise and retry, and to fail loudly** when it truly can't."

Warning 1 is precisely what Buzz's `PlaybackCoordinator` (`tts_playback.rs:12`) already is — so
they did get that right internally. Warning 2 they have **not** solved: see #6044 below.

**PR #3240 is our feature, half-built.** *"feat(desktop): add message read-aloud playback"*, still
open. Its file list is effectively a blueprint for the "speak selection" half of our plugin
(VERIFIED via `gh pr view 3240 --json files`):

```
desktop/src-tauri/src/message_tts.rs                       ← new backend module
desktop/src-tauri/src/message_tts_tests.rs
desktop/src/features/message-tts/lib/playbackReducer.mjs   ← playback state as a REDUCER
desktop/src/features/message-tts/lib/playbackReducer.test.mjs
desktop/src/features/message-tts/ui/MessageTtsProvider.tsx ← single owner, app-wide
desktop/src/features/messages/ui/MessageActionBar.tsx      ← the per-message entry point
desktop/src/app/AppShell.tsx                                ← provider mounted at the root
```

Two shapes to steal from that layout: **playback state modeled as a pure reducer** with its own
unit tests (testable without any audio device), and **a single provider mounted at the app shell**
— i.e. #4403's "one mutual-exclusion primitive that every playback path acquires", expressed as
React context. Note it reuses `huddle::preprocessing::preprocess_for_tts` directly, which is the
duplication #6179 is complaining about.

### Live bugs

| # | Issue | Relevance |
|---|---|---|
| **6298** | Huddle instructions give the agent the **parent** channel id, not the huddle's — *"every spoken reply is silently posted to the wrong channel"* | A whole-feature-breaking bug in the exact prompt we're praising above. Prompt-injected routing is fragile; validate the target explicitly. |
| **3071** | *Agents never respond in voice huddles*: transcripts arrive but every utterance hits `ExpectedRunIdMissing` and cancels the in-flight run | The agent-integration seam is the flakiest part of the whole system — not the audio. Budget accordingly. |
| **6044** | Speaker (audio output) **selector is inert** — cannot change output device (Windows 11) | Exactly warning 2 from #4403, unfixed. Consistent with `audio_output.rs:37-40`: *"Takes effect on the next huddle start/join (does not change a live stream)."* |
| **2868** | Idle desktop app burns ~4% CPU and **pins the audio device awake** | Cost of holding a persistent player/mixer open. Tear the output down when idle. |
| **3118** | Huddle `mediaDevices` access **crashes the whole app** when `navigator.mediaDevices` is undefined | Guard the capability check. |
| **4358 / 3494 / 2560 / 2562** | A cluster of Linux audio-stack failures (PipeWire segfault, bundled libsoup/GStreamer shadowing, notification sounds never play) | Desktop audio portability is a real, recurring tax. |

### In-code admissions

- **Sub-chunk streaming diverges from batch.** `tts_streaming.rs:1-9`: smaller deltas are faster to
  first audio but "diverge (~23 dB SNR vs batch — decoder intra-chunk lookahead)". Left disabled.
- **The chunker was once superlinear** and the cost landed *before first audio*
  (`pocket_april.rs:1030-1034`) — a latency bug hiding in a throughput-shaped loop.
- **A fade-in "swallowed the consonant onset of every sentence"** (`tts_tests.rs:751`) — hence
  fade-out only.
- **Both VAD tuning directions failed** (`stt.rs:160-171`).
- **Stale doc comments** in `state.rs:16-25` and `state.rs:101` describe a half-duplex mic gate
  that is not in the shipped code.
- **No TODO/FIXME markers anywhere** in `huddle/` or `buzz-voice/` (grepped). The known problems
  live in the issue tracker and in prose comments, not in code markers.

---

## Applicability to ORCA

### What ORCA already has (repo check)

Cloned `stablyai/orca` @ `0f26ff4a`. **ORCA has a substantial speech-input stack and zero speech
output.** `src/main/speech/` holds a full local STT service — `stt-service.ts`, `stt-worker.ts`,
`stt-audio-resample.ts`, `stt-offline-audio-chunker.ts`, a downloading `model-manager.ts` with
resume/progress/cleanup tests, and `model-catalog.ts` listing sherpa-onnx models (Parakeet TDT
v2/v3 INT8, Zipformer bilingual + streaming EN/ZH/KO, Paraformer, SenseVoice, Whisper Tiny,
Parakeet JA) — **the same sherpa-onnx family Buzz uses, but already multilingual and already
selectable**, plus a cloud path via `openai-transcription-client.ts` with its own API-key store.
It surfaces in Settings as a Voice pane (`VoicePane.tsx`, `VoiceDictationSettingsSection.tsx`,
`VoiceSpeechModelSection.tsx`, `VoiceMicrophoneSetting.tsx`, `OpenAiTranscriptionSettingsRow.tsx`),
is exposed over RPC at `src/main/runtime/rpc/methods/speech.ts`, and has an E2E test for device
selection (`tests/e2e/voice-microphone-selection.spec.ts`). Mobile additionally vendors
`@orca/expo-two-way-audio`, a native Expo module whose README promises "**clean (applying Acoustic
Echo Cancelling) microphone samples**" at 16 kHz mono PCM with input/output volume levels — and
whose iOS `AudioEngine.swift:187-189` already contains the "AEC needs time to adapt to the
playback audio" workaround. **Grepping `src/` for `tts`, `speechSynthesis`, `textToSpeech`, or
`/audio/speech` returns only false positives.** So: input is solved and multi-model; output is
greenfield; and there is precedent in-repo for both a downloadable-model catalog and a
cloud-provider-with-key-store, which is exactly the TTS provider shape we need.

### Transfer matrix

| Buzz mechanism | Transfers? | Why |
|---|---|---|
| `preprocess_for_tts` 7-stage normalizer | ✅ **Directly** — port to TS | Pure string→string, no deps, no regex, fully tested. Highest value-per-line in the repo. |
| Sentence → clause → word → scalar boundary ladder + abbreviation guard | ✅ **Directly** | Pure logic. Swap their SentencePiece `token_count` for our engine's limit (or a character/word estimate for a cloud engine). |
| "Isolate first sentence, then pack the rest" | ✅ **Directly** | The single best latency trick here, and it is one boolean. Applies to any streaming reply. |
| Fade-out-only, no fade-in; lead-in silence only on idle onset | ✅ **Concept** | Implement over Web Audio `AudioBufferSourceNode` scheduling rather than rodio buffers. |
| Voice-mode system-prompt guidelines | ✅ **Directly, adapted** | ORCA controls the agent. Ask for short spoken sentences and no markdown — but see #6298: **do not trust the prompt for routing**, validate the target. |
| 10 ms barge-in monitor decoupled from the synth worker | ✅ **Concept** | In Node/Electron the "worker blocked in inference" case still exists for a local engine; for a cloud engine it's a blocked fetch. Same fix. |
| Generation-tagged queue; barge-in clears, voice-switch preserves | ✅ **Directly** | Pure bookkeeping, no audio-stack dependency. |
| Single mutual-exclusion owner for the output device (`PlaybackCoordinator`) | ✅ **Directly** — and #4403 says build it first | Both "speak selection" and "huddle mode" are playback paths from day one. This is the retrofit we get to skip. |
| PTT: `vad_flush_allowed`, transmit-edge flush, 200 ms release tail + press generation | ✅ **Concept** | Only if we do mic input. ORCA's dictation already covers some of this. |
| earshot VAD constants (16 ms / 0.5 / 304 ms / 192 ms floor / 30 s cap) | ⚠️ **As starting values only** | Their own #6346 argues the silence-timer model is structurally wrong, and both tuning directions failed. Take the numbers, expect to replace the model. |
| Bundled-model-only, no provider trait | ❌ **Invert it** | ORCA already has a model catalog + cloud client for STT. Mirror that shape for TTS: local engine + OpenAI-compatible `/v1/audio/speech` endpoint, selectable. |
| "Wear headphones" as the AEC answer | ❌ | Works for Buzz because capture is in a WebView with browser AEC. ORCA mobile already has a real AEC module; desktop should lean on `getUserMedia`'s `echoCancellation` if capture stays in the renderer. |
| Barge-in triggered by remote Opus packet counting | ❌ **Doesn't exist for us** | ORCA has no remote participants. If we want hands-free barge-in we must build the mic-driven path Buzz deliberately declined — meaning we *do* need the half-duplex gate they specced (`state.rs:22-25`) and abandoned. |
| rodio / cpal / mixer plumbing, 512-sample bootstrap cushions | ❌ | Rust-audio-stack specific. |
| Nostr relay, ephemeral channels, kind:9000 membership, per-agent pubkeys | ❌ | Buzz's multi-agent-multi-human room model. ORCA is one user, one agent. Drop `speaker_pubkey`, `speaker_generations`, `active_speaker` ownership arbitration entirely — that's a large share of `tts.rs`'s complexity we don't inherit. |

### Portability split — what transfers to all three OSes vs. what is macOS-shaped

Cross-platform parity is a **hard requirement** for our plugin, so the transfer matrix above needs
a second axis. The good news is concrete, not assumed: **`grep -rn 'cfg(target_os' huddle/` returns
zero hits** — the entire chunking, normalization, queueing, and cancellation stack is written
without a single platform branch, and its tests are pure-logic unit tests that run on the
`ubuntu-latest` CI job like any other. That is evidence of portability, not an assumption.

**Tier 1 — pure logic. Ports everywhere, at zero platform cost. Copy first.**

| Mechanism | Why it's portable | Evidence |
|---|---|---|
| `preprocess_for_tts` — the 7-stage markdown→speech normalizer | `&str → String`. No I/O, no deps, no `cfg`. | `preprocessing.rs` (whole file); tests `preprocessing.rs:414-543` run on the Linux CI job |
| The natural-boundary splitter + abbreviation guard | Pure function over `&str` + a `token_count` closure | `pocket_april.rs:961-1133`; tests `pocket_april.rs:1440-1518` |
| "Isolate first sentence, then pack the rest" | One boolean into the same pure function | `pocket_april.rs:1046-1050` |
| Generation-tagged queue; barge-in-clears vs voice-switch-preserves | Integer comparisons and a `swap` | `tts.rs:604-618`; `tts_voice_transition.rs:484-493` |
| Playback state as a reducer (PR #3240) | Testable with no audio device at all | `features/message-tts/lib/playbackReducer.test.mjs` |
| TTS eligibility filter (skip `[System]`, self-authored, attachment lines) | String predicates | `ttsLiveMessages.ts:31-76` |
| Fade-out-only + lead-in-on-idle-onset policy | Arithmetic over a sample buffer | `tts_audio.rs:40-84` |
| VAD constants as *values* (16 ms / 0.5 / 304 ms / 192 ms / 30 s) | Numbers | `stt.rs:160-183` |

These are **the highest-value things in the whole repo for us**, and they happen to be the ones
with no portability risk. That alignment is the main takeaway of this section.

**Tier 2 — portable via a cross-platform library, but the library is the dependency decision.**

| Mechanism | Portable how | Watch out for |
|---|---|---|
| Audio output | `rodio` → `cpal` → CoreAudio / WASAPI / ALSA, no branches in Buzz | Linux needs `libasound2-dev` at build time (`linux-canary.yml:65`); Windows output-device selection is *already broken* in Buzz (#6044) |
| Local ONNX inference | `sherpa-onnx` vendors ONNX Runtime per platform; `ort-sys` pinned `disable-linking` so only one runtime links | The native runtime is the only per-platform artifact; get the packaging right once |
| Model download + cache | Models are **plain `.onnx`/`.wav`, identical on every OS+arch**; SHA-256 pinned | Buzz caches to `~/.buzz/` even on Windows — prefer the platform app-data dir |
| Global hotkey | `tauri-plugin-global-shortcut` v2 covers all three | Buzz `#[cfg(test)]`-stubs the plugin out because it fails to load in the **Windows** test binary (`STATUS_ENTRYPOINT_NOT_FOUND`, `ptt_shortcut.rs:14-21`) — so their hotkey path is untested everywhere. Don't inherit that hole. |
| Barge-in enforcement (10 ms monitor thread + atomic) | No platform branches | — |
| Companion window | Tauri `WebviewWindowBuilder`, no branches | — |
| Mic capture via `getUserMedia` + AudioWorklet | One code path on all three | ⚠️ **Three different webview engines.** WKWebView / WebView2 / WebKitGTK. Nominally the same API; issues #4358, #3495, #3118, #2562 are all WebKitGTK. |

**Tier 3 — macOS-shaped in Buzz. Needs a per-OS reimplementation, or is simply missing elsewhere.**

| Mechanism | State in Buzz | What we'd have to build |
|---|---|---|
| **Acoustic echo cancellation** | Not theirs at all — two `getUserMedia` booleans, so the real canceller is WKWebView's / Chromium's / WebKitGTK's, three different implementations of differing quality. Plus a `aecMissing` → *"Headphones help prevent echo"* nudge (`MicControls.tsx:351-395`). | If we capture outside a webview, **AEC is entirely unsolved and must be sourced per platform**. If we capture in the renderer, we inherit browser AEC — and ORCA mobile already vendors a real AEC module (`@orca/expo-two-way-audio`) whose iOS engine even handles the "AEC needs time to adapt to playback" warm-up (`AudioEngine.swift:187-189`). Desktop has no equivalent. |
| **Mic-permission recovery deep link** | macOS only: `x-apple.systempreferences:…Privacy_Microphone`, behind `{isMac && …}` (`MicControls.tsx:300-319`). Windows/Linux get a dead-end card. | Per-OS: `ms-settings:privacy-microphone` on Windows; on Linux there is no single target — surface instructions instead. **A three-line parity fix Buzz never made.** |
| **Prevent idle sleep during a session** | macOS only via IOKit; the non-macOS arm is a **silent no-op stub** (`prevent_sleep.rs:91-96,187-191`). | Windows `SetThreadExecutionState`, Linux systemd-inhibit / D-Bus. Relevant if huddle mode should survive an idle laptop. |
| Platform detection | Sniffs deprecated `navigator.platform`; **there is no `isWindowsPlatform()`** — Windows is the else-branch (`platform.ts:7-24`) | Use Tauri/Electron's OS API, and treat all three as first-class. |
| Tray, app menu, notifications, window chrome | Per-OS `cfg` blocks throughout | Out of scope for a TTS plugin, but note the *cost centre* is the shell, never the audio. |
| Barge-in triggered by a remote participant | Opus packet counting — portable code, but **the concept doesn't exist for a single-user agent** | Not a portability issue; a product-shape issue (see the transfer matrix above). |

### The one-line conclusion for our parity requirement

**Everything we most want from Buzz is Tier 1 or Tier 2** — the normalizer, the chunker, the queue
state machine, the barge-in enforcement, and the model-download pattern are all platform-neutral,
and the models themselves are a single artifact for every OS and arch. **The only genuinely
macOS-shaped things in Buzz are things they got wrong or skipped** (a macOS-only permission deep
link, a macOS-only sleep inhibitor with a silent stub elsewhere, and an AEC story that is really
"whatever webview you're on"). So parity is achievable — provided we (a) decide *where* mic capture
lives before writing any of it, since that decision alone determines whether AEC is free or
unsolved, and (b) test the global-hotkey path on Windows, which Buzz never does.

---

### The five decisions this research should drive

1. **Build the provider seam before the first engine.** Buzz's #3720 and #4403 both stall on its
   absence; ORCA's own STT stack already demonstrates the pattern (catalog + downloader + cloud
   client + key store). Mirror it.
2. **Put the speech normalizer in one shared module with options, not a copy per surface.** #6179
   is Buzz watching this rot in real time across three callers. "Speak selection" and "huddle mode"
   are our two callers on day one, and they want *different* chunking (greedy vs
   first-sentence-alone) over the *same* normalization.
3. **Make the hotkey rebindable.** Buzz's shortcuts are hard-coded and the settings card says so
   verbatim: *"Shortcuts are read-only"* (`KeyboardShortcutsCard.tsx:42`). A plugin whose headline
   feature *is* a hotkey cannot ship an unrebindable one — and Buzz's own conditional-OS-reservation
   pattern (`ptt_shortcut.rs:117-146`: register the global combo **only while the feature is
   actually live**, so it never steals the chord from the user's editor) is the right default.
4. **One playback owner, acquired by every path, from the first commit** — plus device-loss
   re-initialisation. #4403's author paid for both lessons; Buzz has the first and still lacks the
   second (#6044, #2868).
5. **Decide where microphone capture lives before writing any of it — it is the parity fork.**
   In the renderer (`getUserMedia`) we get one code path and free AEC on all three OSes, but we
   inherit three different webview engines and the WebKitGTK defect cluster (#4358, #3495, #3118).
   In the main process (native/cpal) we get consistent behaviour but **AEC becomes ours to solve
   per platform**, and Buzz offers no prior art for that — their entire answer is browser AEC plus
   a "wear headphones" nudge. Nothing else in the plan depends on this choice; everything about
   echo, barge-in triggers, and Linux risk does.

---
