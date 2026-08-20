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
4. **Barge-in as a separate 10 ms monitor thread, not a check inside the worker.** The worker can
   be blocked for hundreds of ms inside model inference; a dedicated poller kills audio in ~15 ms
   regardless. `desktop/src-tauri/src/huddle/tts.rs:86-90`,
   `tts_speaker_cancellation.rs:15-94` (VERIFIED)
5. **Push chunking upstream into the agent's system prompt.** Buzz literally instructs the agent
   to *"send each useful sentence as its own message the moment it is ready"* and *"speak plainly
   without markdown"*. Free latency and free sanitization.
   `desktop/src-tauri/src/huddle/agents.rs:36-47` (VERIFIED)

**Do not copy these two:**

1. **The bundled-local-model-only stance.** Buzz hardwires one TTS engine (Pocket TTS, ONNX) and
   one STT engine with *no provider trait at all* — `PocketTts` is a concrete struct used directly
   by the worker. Their own issue #3720 is a user begging for pluggable backends. Build the seam
   on day one; Buzz is paying for not having it.
2. **The rodio persistent-`Player` + mixer plumbing** (lead-in cushions sized around a specific
   rodio 0.22.2 bootstrap quirk, `tts.rs:106-125`). That is Rust-audio-stack-specific yak shaving
   with no analogue in an Electron/Web Audio host like ORCA.

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
