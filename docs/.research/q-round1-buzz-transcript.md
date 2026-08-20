# Q-round 1 — transcript markers, buzz's agent channel, live-session enumeration

> **Scope:** `docs/.discussion/000-open-questions.md` **Q2**, **Q4**, **Q27**, plus an unprompted
> UX section. Every verdict below is either RESOLVED with a `file:line` citation and quoted
> evidence, RESOLVED NEGATIVE with proof of absence, or UNRESOLVABLE with the exact probe.
>
> **Sources.** `block/buzz` cloned at `2a236e413723f207c2f6c1e8921fab4f071d0445`
> (`refactor(prompt): simplify Buzz agent guidance (#6340)`) under
> `/private/tmp/claude-501/.../scratchpad/buzz`; paths below are relative to that clone root.
> Transcript evidence read **read-only** from `~/.claude/projects/**/*.jsonl` and
> `~/.claude/sessions/*.json`. No user file was modified. The `.key` files in `~/.claude/sessions/`
> are credentials and were **never opened** — only the sibling `.json` metadata was read.
> Probes run 2026-08-21 on macOS 26.5, Claude Code `2.1.238`, ORCA CLI on `PATH`.

---

## Q2 — Does a fenced block with a custom info string survive verbatim in the raw JSONL?

**Verdict: RESOLVED — YES, byte-for-byte.** The assistant's text is stored as a plain JSON string
in `message.content[].text`. Nothing parses, re-renders, or normalizes markdown on the way to disk,
so ```` ```speak ```` arrives exactly as the model emitted it.

**Citation (constructed probe, reproducible).** No assistant-authored ```` ```speak ```` block
existed anywhere in the 4,192 transcripts on this machine, so I made one:

```
$ cd <scratchpad>/q2probe
$ claude -p 'Reply with exactly this and nothing else: a fenced code block whose info string
  is the word speak, containing the single line: Hello from the spoken channel.
  Then one plain sentence after it.' --model haiku
```

`~/.claude/projects/-private-tmp-claude-501--Users-m5air-source-orca-plugin-tts-111693de-38da-4de8-a288-506104eb7c9c-scratchpad-q2probe/67e26ea8-d6bb-4b4c-a057-c4ef207b2f88.jsonl:12`

Raw bytes on disk:

```
"content":[{"type":"text","text":"```speak\nHello from the spoken channel.\n```\n\nThis is a test of the spoken output channel."}],"stop_reason"...
```

Decoded `message.content[0].text`:

```
'```speak\nHello from the spoken channel.\n```\n\nThis is a test of the spoken output channel.'
```

The only transformation applied is JSON string escaping of the newline. The info string `speak`,
both fences, and the surrounding prose are all present and unaltered.

**Corroborating real-world example** — a non-language info string that occurred naturally in the
user's own history, proving this is not an artifact of my probe:
`~/.claude/projects/-Users-m5air-source-project-proposals/abda0b54-9834-43db-b13b-d158c23257be.jsonl:560`,
an assistant record carrying ```` ```sync ```` verbatim. Across all 4,192 transcripts, assistant
text blocks contain **22 distinct info strings**, including `sync`, `hujson`, `gitattributes`,
`jsonc` and `powershell` — i.e. the field is a passthrough, not a whitelist.

**Record shape** (same line): keys are
`cwd, entrypoint, gitBranch, isSidechain, message, parentUuid, requestId, sessionId, timestamp,
type, userType, uuid, version` — so a marker block is addressable by `uuid` for dedup, exactly as
`packages/plugin/src/huddle/decoders.ts:54` already does.

**Design consequence.** A marker convention is mechanically viable today with **zero upstream ORCA
dependency**: `decodeClaudeLine` already returns the raw text, so a ```` ```speak ```` extractor is
a pure function added to `decoders.ts` — no new API, no new capability, no PR to `stablyai/orca`.

---

## Q4 — What does `block/buzz` actually use, and what does its agent see?

**Verdict: RESOLVED — a *routing* convention, not a marker and not a tool.** Buzz makes the
**destination** the speech channel. The agent speaks by sending an ordinary chat message to the
ephemeral huddle channel using the CLI tool it already has (`buzz messages send`). Everything else
it produces is silent. The convention is delivered as a Nostr event of kind **48106** posted into
the channel at huddle start, which the agent loads into its channel session system prompt.

**RESOLVED NEGATIVE on the other two mechanisms:**

| Mechanism | Proof of absence |
|---|---|
| **Marker in the reply text** | No marker parsing exists on the TTS path. `desktop/src/features/huddle/lib/ttsLiveMessages.ts:53-75` classifies eligibility purely by event *kind*, `h` tag, author, and emptiness — it never inspects for a fence, sigil, or prefix (the one string test is a `"[System]"` prefix reject). |
| **A dedicated MCP/ACP `speak` tool** | The agent-facing MCP server exposes exactly five tools — `shell`, `read_file`, `view_image`, `str_replace`, `todo` (`crates/buzz-dev-mcp/src/lib.rs:41,53,64,75,86`). A repo-wide grep for a tool named `speak`/`say`/`tts`/`audio`/`voice` across `crates/` and `desktop/src-tauri/src` returns zero tool definitions. |
| **A hook** | No hook mechanism exists on this path; the guidelines are content posted to a relay, not a callback. |

**Citation — the exact text the agent sees.** `desktop/src-tauri/src/huddle/agents.rs:32-47`:

```rust
/// Voice-mode instructions posted as kind:48106 to the ephemeral channel at
/// huddle start. Agents load this event into the channel session system prompt.
///
/// Keep this deliberately short: the invariant that matters is that a directly
/// addressed user receives an immediate spoken response before any other work.
pub fn voice_mode_guidelines(parent_channel_id: &str) -> String {
    format!(
        "\
You are in a live voice huddle attached to channel {parent_channel_id}.
Only messages sent with `buzz messages send` to this huddle channel are spoken aloud, in the order sent; everything else you produce is silent.
When a user addresses you, your FIRST tool call must send a brief spoken reply to this channel, before any file read, search, or other tool call. The usual rule against bare acknowledgments does not apply here; the pickup is the feedback that you heard them.
Then work, sending each useful sentence as its own message the moment it is ready—a few sentences per answer, not a monologue.
Speak plainly without markdown; post code or long detail to the attached channel instead.
If you are not addressed, stay silent."
    )
}
```

Six lines. That is the entire agent-facing contract.

**How it is delivered.** Kind constant at `crates/buzz-core/src/kind.rs:598`
(`pub const KIND_HUDDLE_GUIDELINES: u32 = 48106;`); event built at
`desktop/src-tauri/src/events.rs:505-517`; posted at `desktop/src-tauri/src/huddle/mod.rs:256-265`
with the comment *"Post voice-mode guidelines as kind:48106 **BEFORE** adding agents."* — ordering
matters, because an agent that joins first would never see them. On agent re-add,
`desktop/src-tauri/src/huddle/commands.rs:207`: *"No guidelines re-post needed — the agent sees the
original kind:48106."*

**It is pinned by a test**, i.e. the wording is treated as load-bearing behaviour, not copy —
`desktop/src-tauri/src/huddle/agents.rs:303-311`:

```rust
fn voice_mode_guidelines_pin_spoken_reply_as_first_tool_call() {
    let guidelines = voice_mode_guidelines("parent-channel");
    assert_eq!(guidelines.lines().count(), 6);
    assert!(guidelines.contains("Only messages sent with `buzz messages send`"));
    assert!(guidelines.contains("your FIRST tool call must send a brief spoken reply"));
    assert!(guidelines.contains("before any file read, search, or other tool call"));
    assert!(guidelines.contains("rule against bare acknowledgments does not apply here"));
```

**It is not in the base prompt.** `grep -ci "speak|text-to-speech|tts|aloud|voice"
crates/buzz-acp/src/base_prompt.md` → **0**. Voice guidance is injected only when a huddle exists;
outside a huddle the agent has no notion of speech at all.

**The graceful-degradation property, which is the real insight.** Because the channel is a
*destination*, an uncooperative agent does not emit garbage — it emits **silence**. There is no
half-parsed marker, no leaked sigil in the written reply, no fallback ambiguity. The failure mode
of non-cooperation is "nothing is spoken", which is the safest possible failure for assistive tech
(PITFALLS P22: *"reading something you didn't ask for and can't stop is worse than silence"*).

**And the known cost of prompt-carried routing** — `docs/.research/prior-art-buzz.md` records buzz
issue **#6298**: the huddle instructions once handed the agent the **parent** channel id instead of
the huddle's, so *"every spoken reply is silently posted to the wrong channel"*. A whole feature,
broken by one interpolated identifier, with no error anywhere.

**Design consequence.** Buzz's answer maps onto ORCA as *"the marker is a destination, not a
syntax"* — but ORCA has no second channel to send to, so the ```` ```speak ```` fence is our
substitute for one. We should copy the **shape** (opt-in, silent-on-non-cooperation, six lines of
instruction, pinned by a test) rather than the transport, and per #6298 **validate the target
explicitly** instead of trusting the prompt to have carried it correctly.

---

## Q27 — Can a worker enumerate LIVE sessions, or only transcripts it has seen?

**Verdict: RESOLVED — YES. `~/.claude/sessions/<pid>.json` is a live-session registry, and it
carries the `sessionId` that names the transcript file.** P22's naive "most-recently-modified
transcript" heuristic can be replaced outright.

### The registry

`ls ~/.claude/sessions/` holds, per running session, a `<pid>.json` (world-readable metadata) and a
`<pid>.<sha256>.key` (mode `0600` credential — **not read**). The `.json` keys are:

```
bridgeSessionId, cwd, entrypoint, kind, messagingSocketPath, name, nameSince, nameSource,
peerFeatures, peerProtocol, pid, procStart, sessionId, startedAt, status, statusUpdatedAt,
updatedAt, version
```

Live snapshot, cross-checked against `os.kill(pid, 0)`:

```
2052.json    pid=2052   ALIVE  status=busy  kind=interactive  name='orca-plugin-tts-13'  cwd=/Users/m5air/source/orca-plugin-tts
35563.json   pid=35563  ALIVE  status=busy  kind=interactive  name='orca-5c'             cwd=/Users/m5air/source/orca
35942.json   pid=35942  ALIVE  status=idle  kind=interactive  name='split-the-windows-…' cwd=/Users/m5air/orca/workspaces/…
84153.json   pid=84153  ALIVE  status=idle  kind=interactive  name='math-study-f8'       cwd=/Users/m5air/…/Math Study
84575.json   pid=84575  ALIVE  status=idle  kind=interactive  name='math-study-a3'       cwd=/Users/m5air/…/Math Study
```

### Verified by effect, four ways

**1. Registration and de-registration are real, not incidental.** Baseline before, probe, reading
after — a named value moved and moved back:

```
before:  5 json files
t=1..3:  6 json files   (26831.json appears while `claude -p 'say ok'` runs)
t=4..8:  5 json files   (26831.json is REMOVED on exit)
```

A file that only ever appeared would prove nothing; the removal is what makes this a liveness
signal rather than a history of sessions that once existed.

**2. `sessionId` resolves to exactly one transcript, for all five sessions.** Globbing
`~/.claude/projects/*/<sessionId>.jsonl` returned exactly one hit each — including the two whose
`cwd` contains spaces and an `@`, where a hand-rolled path-mangling rule gets it wrong. **Glob by
`sessionId`; never re-derive the project directory name from `cwd`.**

**3. A live unix socket exists per session.** `messagingSocketPath` = `/tmp/cc-socks/<pid>.sock`,
and `os.path.exists()` returned `True` for all five. A second, independent liveness probe.

**4. `status` moves.** Sampled 20 s apart: `35563.json` went `busy → idle`, with
`statusUpdatedAt` advancing `1787265418495 → 1787265562456`, while the four others held. So
`status` is a genuine per-turn indicator — *and* an indicator that does change, which is what
makes it trustworthy.

### The one caveat, stated honestly

**`updatedAt` is edge-written, not a heartbeat.** In the same 20 s window, four of five records did
not move at all, and `2052.json` (this very session, actively working) held a timestamp from
minutes earlier. A crashed session would therefore leave a stale `status: "busy"` behind.
**Liveness must be decided by `process.kill(pid, 0)` or by the socket's existence — never by the
age of `updatedAt`.**

### The ORCA-side alternative, also confirmed

`orca terminal list --json` works and returns live terminals with `worktreePath`, `branch`,
`title`, `connected`, `orphaned`, `lastOutputAt`, and a `preview`. Confirmed present in
`orca --help` under **Terminals** (`terminal list  List live Orca-managed terminals`). It is
strictly *more* than we need and costs a subprocess — but it is the only source for the human-facing
tab **title** (e.g. `"✳ ORCA TTS plugin integration"`, `"◐ general-purpose"`), which is a far better
spoken identity than a UUID prefix. A plugin worker can shell out: we already do
(`packages/plugin/src/clipboard.ts:8`, `packages/plugin/src/sinks/subprocess-sink.ts:12`).

Note it does **not** carry the agent `sessionId`, so it cannot be joined to a transcript directly —
only via `worktreePath` ↔ `cwd`, which is the same ambiguity that caused P22 when two sessions share
a worktree (three of the listed terminals share `/Users/m5air/source/orca-plugin-tts`). Use
`~/.claude/sessions/` for identity and liveness; use `orca terminal list` only to enrich a display
name.

### UNRESOLVED sub-question

Whether `~/.claude/sessions/` is written by every agent CLI ORCA supports, or only by Claude Code,
is **not** settled here — all five live sessions on this machine are `kind: interactive` Claude
Code. **Exact probe:** start a Codex / Grok / omp session through ORCA and re-run
`ls ~/.claude/sessions/*.json`; if the count does not increase, the registry is Claude-only and
`decoders.ts`'s `UNSUPPORTED_AGENTS` list must be mirrored by a session-enumeration fallback.

**Design consequence.** The P22 fix can move from "lock onto one file and hope" to a real roster:
enumerate `~/.claude/sessions/*.json`, filter to `kill(pid,0)` survivors, prefer the one whose `cwd`
matches the event's worktree, and speak `name` (`"orca-plugin-tts-13"`) as the session identity
instead of `sessionLabel()`'s UUID slice at `packages/plugin/src/huddle/index.ts:55-60`. This also
answers the harder half of Q28 for free.

---

## What buzz does that we do not

Things outside our current roadmap that are worth adopting or arguing about. All verified in the
clone at `2a236e4`.

**1. "The pickup is the feedback that you heard them."** Buzz's single hardest rule is that the
agent's *first tool call* must be a short spoken acknowledgment, before any file read
(`agents.rs:40-41`, pinned by a test). It deliberately overrides its own global ban on bare
acknowledgments. For a voice-first user, the round-trip silence between "I asked" and "it answered"
is the worst part of the experience, and buzz spends a whole tool call to kill it. **We have no
equivalent.** Our huddle speaks only completed replies (`WATCH_WINDOW_MS`, `#readReplies`), so the
user hears nothing for the entire working phase.

**2. Agent speech drives the *same* level ring as human speech.** Remote Opus levels and the
synthesized RMS envelope are `Math.max`-merged into one indicator
(`useHuddleSpeakerActivity.ts:16-38,55-75`, producer `tts_activity.rs:17-44`). A synthetic voice
looks identical to a person's — presence is about *who is talking*, not *what kind of thing* is
talking.

**3. Push-to-talk earcons.** A 50 ms oscillator, **880 Hz on press / 440 Hz on release**, gain
0.05, via Web Audio (`useHuddlePttState.ts:36-54`). Non-visual confirmation that the mic opened.
Cheap, and directly on the critical path for a voice-first user. Relevant to M17.

**4. A model-readiness ticker.** A pulsing `aria-live` `<output>` reading
`Voice models: STT ready, TTS 42%`, polled every 10 s and **only while the document is visible**
(`HuddleBar.tsx:280-291,595-610`). It answers "why is nothing speaking yet" during a cold start —
which is exactly our first-run Piper model download (P14/P15). We currently answer that with
silence.

**5. Truncate with a spoken suffix, never drop.** `agent_tts_routing.rs:27-40` caps text at 8,096
chars and appends `"... message truncated."` **aloud**. Contrast our queue-overflow behaviour: P22
records that we dropped the oldest utterance *silently*. Buzz's rule generalizes — every omission
is announced in the audio stream itself, because the listener cannot see a log.

**6. A structural eligibility filter, evaluated per event.**
`ttsLiveMessages.ts:53-75` rejects on six named grounds — `unsupported_kind`, `h_tag_mismatch`,
`author_not_agent`, `self_authored`, `empty_or_system` — and strips markdown image/attachment lines
first (`textWithoutAttachments`, `:30-52`). Each rejection is a *named reason*, not a boolean, so
"why did it not speak" is always answerable. Our decoder returns `null` for six different reasons
with no distinction.

**7. Per-agent voices auto-assigned on join, overridable, with the voice menu on the agent's own
avatar** (`AgentVoiceMenu.tsx:88-145`; auto-assignment asserted at
`huddle-transcription.spec.ts:784-812`). Speaker separation with zero configuration, and settings
placed where the agent is rather than in a settings pane. Turning per-agent TTS off **removes** the
voice picker rather than graying it. Directly relevant to M15.

**8. The Stop button occupies a pre-reserved fixed-height slot**, replacing the name in place, with
an E2E test asserting *byte-identical bounding boxes* idle vs speaking
(`ParticipantList.tsx:328-349`; `huddle-transcription.spec.ts:717-745`). The interrupt control
never moves, so it can be hit without looking. This is the detail we would otherwise get wrong.

**9. Push-to-talk press cancels in-flight TTS** (`ptt_shortcut.rs:67-76`) — talking over the agent
*is* the stop gesture, with no separate control to find. Bears on Q19.

**10. Interruption model: barge-in is a separate 10 ms monitor thread**, not a check inside the
synthesis worker (`tts_speaker_cancellation.rs:15-94`), because the worker can be blocked for
hundreds of ms inside model inference. Already recorded in `prior-art-buzz.md`, repeated here
because it is the piece most likely to be lost in translation.

**11. Multiple concurrent agents: generation counters, not locks.** Each speaker carries a
`speaker_generation` (`tts.rs:604-610`, `tts_pipeline_controls.rs:37-59`), advanced on Stop, so a
stale Stop click cannot silence a *later* utterance. If ORCA ever follows more than one session at
once, this is the correct primitive — and it is precisely the failure class P22 lived in.

**12. What buzz deliberately does NOT have**, worth knowing before we build it: no waveform, no
scrubber, no progress bar, no per-message play button, no rate/pitch/speed control, no
user-configurable shortcuts, and no cloud TTS provider of any kind. Its own issue **#4403** rejects
auto-play outright — *"Unsolicited audio in a chat client is hostile. On request only."* Our huddle
mode is exactly the thing buzz's own issue tracker calls hostile; the difference is that our user
asked for it, which makes the skip/stop controls the thing that earns it.
