# Open questions — Phase 2 design

**Status:** open. Opened 2026-08-21 at the author's instruction: *catalog open questions, attempt
to resolve them first, then design.*
**Governs:** every design doc numbered 002 and above.

Each question carries a **kind**, which decides who may answer it:

| Kind | Answerable by | Rule |
|---|---|---|
| **E** empirical | reading ORCA source, running a probe, checking upstream | An agent resolves it. Cite `file:line` or paste the command output. Never guess (PITFALLS P0). |
| **D** design | us, by argument, recorded with a Recommendation | An agent proposes; the design doc records Options + Recommendation. |
| **T** taste | the listener, and no one else | **Do not answer.** Design the option space; leave the default for Voice Lab (PITFALLS P23). |

A question is **resolved** only when the evidence is written next to it. "Probably" is not resolved.

---

## Q1–Q8 · T140 — the agent-controlled spoken channel

| # | Kind | Question | Resolution |
|---|---|---|---|
| Q1 | E | Can a plugin register an **MCP tool** that the agent can call? If yes, is it in the seven-capability model or outside it? | open |
| Q2 | E | Do agent transcripts preserve a fenced block with a **custom info string** (```` ```speak ````) verbatim in the raw record? | open |
| Q3 | E | Is there any supported channel by which a plugin injects instructions into the **agent's system prompt** or `CLAUDE.md`, so the agent knows the channel exists? | open |
| Q4 | E | Does `block/buzz` use a marker, a tool, or a hook for its agent-chosen speech? What exactly does its agent see? | open |
| Q5 | D | Does the spoken channel **replace** the reply or **supplement** it, and who chooses — author, agent, or per-reply? | open |
| Q6 | D | How does each option degrade when the agent does not cooperate? Assume most will not. | open |
| Q7 | D | If the agent emits a marker, does the *written* reply still show it? A visible ```` ```speak ```` block is noise for a sighted reader. | open |
| Q8 | T | When both prose and a spoken channel exist, which is heard by default? | **listener** |

## Q9–Q14 · T132a — panel controls, and the missing command channel

| # | Kind | Question | Resolution |
|---|---|---|---|
| Q9 | E | Current upstream state of `stablyai/orca#15643` (`storage.get` panel-callable) and `#15638` (host→panel push). Merged, closed, ignored? | open |
| Q10 | E | Is `storage.**set**` callable from a panel today, independently of `get`? A write-only channel is still a channel. | open |
| Q11 | E | Exact panel-bridge rate limit and payload cap, re-verified against the pinned ORCA. Vendored as 30 per 10 s / 64 KB. | open |
| Q12 | D | If a storage flag becomes the command channel, what is its schema, its idempotency rule, and its **staleness rule**? A polled flag is a homemade RPC and needs one. | open |
| Q13 | D | Worst-case control latency the author will accept for Stop, given polling. Stop is the one control where latency is a safety property. | open |
| Q14 | D | What does the panel do when the channel is unavailable — hide controls, or show them disabled with a reason? | open |

## Q15–Q19 · T170 — voice input

| # | Kind | Question | Resolution |
|---|---|---|---|
| Q15 | E | Is ORCA's first-party STT stack reachable from a plugin at all, or is it main-process-only? | open |
| Q16 | E | Does `sherpa-onnx` STT have the same platform gaps as its TTS side (P7: no Windows arm64; P13: missing npm build)? R1 parity is at stake. | open |
| Q17 | E | Model size for a usable local STT, against the **50 MB / 2,000 file** plugin cap (P4). | open |
| Q18 | D | Push-to-talk chord vs. hands-free, and the half-duplex gate that stops the mic hearing the speaker. | open |
| Q19 | D | What happens to a partially-spoken reply when the author barges in — discard, or resume? | open |

## Q20–Q26 · T112 — Voice Lab

| # | Kind | Question | Resolution |
|---|---|---|---|
| Q20 | D | Who plays the audio: the **server** (spawn the real provider on this machine) or the **browser** (Web Audio on returned PCM)? Server keeps one code path with the plugin; browser gives instant replay and scrubbing. | open |
| Q21 | D | A/B: two option sets back to back — does the listener know which is playing while it plays, or is it blind with a reveal after? Blind is the honest test; labelled is the faster one. | open |
| Q22 | E | Complete list of `NormalizeOptions` fields today, so T124's "every field is reachable" assertion has a target. Currently four: `codeBlocks`, `pathStyle`, `extensionStyle`, `expandNumbers`. | open |
| Q23 | D | Does the lab show the **15-transform pipeline** intermediates, or only written-vs-spoken? Stage-by-stage explains *why* a line sounds wrong; it also complicates the page. | open |
| Q24 | D | Diff granularity in the side-by-side: character, word, or stage-attributed. | open |
| Q25 | E | Does the lab need the resident service, or is the OS synthesizer enough to settle taste? Bears on whether M11 waits for M9. | open |
| Q26 | D | Does the lab persist a session — chosen options survive a reload — or is every visit fresh? | open |

## Q27–Q30 · T131 / T161–T163 — panel and huddle presence

| # | Kind | Question | Resolution |
|---|---|---|---|
| Q27 | E | Can the worker enumerate **live sessions** reliably, or only the transcripts it has seen? P22 says the naive answer hijacks the wrong session. | open |
| Q28 | D | What is a session's **display identity** to a listener — worktree, title, agent name, colour, or a generated call-sign? | open |
| Q29 | D | Presence semantics: does "in the huddle" mean *followed*, *has spoken recently*, or *is running*? | open |
| Q30 | D | Per-session mute — does a muted session's reply get **dropped** or **queued silently**? Dropped loses it; queued produces a backlog on unmute (the P22 failure). | open |

## Q31–Q34 · T150 / T152 — per-agent voices

| # | Kind | Question | Resolution |
|---|---|---|---|
| Q31 | E | What voice list does each platform actually expose — `say -v ?`, `GetInstalledVoices`, `espeak-ng --voices`? How many are usable, and do they overlap at all across platforms? | open |
| Q32 | D | Deterministic assignment from session id, with collision avoidance among *concurrent* sessions — a hash alone collides. | open |
| Q33 | D | When voices are scarce (a platform with two), what distinguishes a third session — rate, pitch, or an announcement? | open |
| Q34 | T | Is a spoken speaker-announcement still wanted once voices differ? | **listener** |

## Q35–Q38 · T120 — settings

| # | Kind | Question | Resolution |
|---|---|---|---|
| Q35 | E | What does ORCA's settings capability actually render? Free-form JSON, or a typed schema with real controls? | open |
| Q36 | D | One schema shared by plugin and lab — does the lab import it, or does a generator emit both? | open |
| Q37 | D | Per-field fallback (T123) must log *which* field failed. Where does that log surface where the author will see it? | open |
| Q38 | D | Are settings global, or per-session? Per-agent voices imply per-session state living somewhere. | open |

## Q39–Q42 · T180 / T181 — the two taste questions

| # | Kind | Question | Resolution |
|---|---|---|---|
| Q39 | D | Identifier speech (`_flush_buffer()`): what is the **option space**? Candidates — verbatim, underscores as pauses, camel/snake split into words, drop the parens, announce "the function". | open |
| Q40 | T | Which of those is the default. | **listener, in Voice Lab** |
| Q41 | D | Deep paths: option space — depth limit with ellipsis, leading-directories-only, filename-first-then-location, or unchanged. | open |
| Q42 | T | Which of those is the default, and at what depth. | **listener, in Voice Lab** |

---

## Round 1 resolutions — 2026-08-21

18 empirical questions were dispatched to four agents. Evidence lives in
`docs/.research/q-round1-orca-api.md`, `-buzz-transcript.md`, `-platform.md`, `-codebase.md`.
Every verdict below carries a `file:line` citation in its source report.

### Resolved NEGATIVE — these close design options permanently

| Q | Verdict | Consequence |
|---|---|---|
| Q1 | **No MCP surface exists** in ORCA's plugin system. No tools, no such concept. | M14 Option B (agent-callable `speak` tool) is dead. |
| Q3 | **No system-prompt injection channel.** ORCA never constructs a system prompt; `contributes.agents` is validated but unwired. | An agent cannot be *told* a convention exists by us. Bootstrapping is now the crux of 002. |
| Q10 | `storage.get` **and** `storage.set` are both `panel: false`. Hard `panel_forbidden` refusal, pinned by a conformance test. | Q12's storage-flag command channel is not implementable from a panel. |
| Q15 | ORCA's STT is main-process + host-renderer only. Panels have no preload, no mic, no `connect-src`. | M17 cannot reuse ORCA's STT. Own stack or nothing. |
| Q35 | The settings capability **renders nothing** — no form, no text area, no settings contribution point exists. | **The Voice Lab becomes the settings UI.** M11 and M12 merge. |

### Resolved POSITIVE — these open doors we thought were shut

| Q | Verdict | Consequence |
|---|---|---|
| Q2 | A fenced block with a custom info string survives **byte-for-byte** in the raw transcript JSONL. | A marker convention is mechanically viable. |
| Q4 | Buzz uses **neither marker nor tool**: the *destination* is the channel. Six lines of guidelines, posted as a Nostr kind-48106 event, pinned by a test. Non-cooperation degrades to **silence**, never garbage. | Copy the shape, not the transport. |
| Q9 | All six upstream ORCA items are **open, one day old, zero maintainer engagement**. | **M13 is not blocked.** Do not schedule behind upstream. |
| Q11 | Vendored numbers **correct**: 30 msgs / 10,000 ms sliding window, 64 KB/msg, per-plugin, oversized still spends budget. | Poll budget arithmetic is settled. |
| Q22 | `NormalizeOptions` has exactly **four** fields. Confirmed. | Four controls is not a lab. The 23 hidden preferences are the real surface. |
| Q25 | The lab does **not** need the neural engine. | M11 does not wait for M9. |
| Q27 | `~/.claude/sessions/<pid>.json` is a **live-session registry** carrying `sessionId`. | P22's most-recently-modified heuristic is deleted, not patched. |

### Resolved with hard constraints — these reshape a milestone

| Q | Verdict | Consequence |
|---|---|---|
| Q31 | Distinct usable voices: macOS **41** · stock Windows **2** · stock Ubuntu **0 via our path**. **Zero name overlap** across platforms. | M15 designs for N=2 and degrades upward. Identity is an index into the host's runtime list, never a persisted name. |
| Q33 | All three expose rate; pitch/volume reachable but by incomparable mechanisms. We pass voice+rate only — and no caller passes either. | Identity must be a tuple, not a voice. |
| Q16 | sherpa-onnx STT shares the TTS native binary and the npm gap. | Same disqualification as its TTS side. |
| Q17 | No usable local STT model fits the 50 MB plugin cap. | M17 needs an out-of-band model path or a different engine. |

### The finding nobody asked for

**A panel CAN act.** Exactly three host methods are panel-callable, and two of them mutate:
`workspace.readContext` (returns terminal ids, branch, displayName), `terminal.sendText`
(`{terminalId, text 1..4096, enter}`), `notifications.show` (`{title, body}` -> `{delivered}`).
Panel buttons work today by addressing a terminal, not by writing storage. This is the same
mechanism by which this session compacted itself.

**And a stock Ubuntu desktop has no `espeak-ng` binary** — only the shared library. Our Linux
floor produces no sound at all on the most common Linux desktop. Filed as a bug, not a question.

---

## Resolution log

Append here as questions close. Format: `Qn — resolved <date> — <evidence>`.
