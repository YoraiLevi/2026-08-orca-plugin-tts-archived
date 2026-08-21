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
| Q23 | D | Does the lab show the **16-transform pipeline** intermediates, or only written-vs-spoken? Stage-by-stage explains *why* a line sounds wrong; it also complicates the page. | open |
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

## The Q43–Q52 collision — read this before citing any of those numbers

**Recorded 2026-08-21 during the round-3 reconciliation. Flagged as X5 in `docs/design/006-fma.md`
§15b and not acted on until now.**

Four documents — `002`, `003`, `004`, `005` — each opened new questions starting at **Q43**, none of
them consulting this file, which is the arbiter. So **Q43 through Q52 each name two to four
different questions**, and a bare `Q45` is ambiguous: it is *"does an HTML comment survive into the
JSONL"* in `002`, *"is `orca-tts control` viable as a foreground TUI"* in `003`, *"what is the
escaping contract for phrase templates"* in `004`, and *"espeak-ng `-p` → semitones"* in `005`.

This is PITFALLS **P12**'s collision in the one file a fresh agent trusts without checking, and R032
exists to prevent it. **Until the ledger renumbers them, cite them as `002 Q45`, `003 Q45`, and so
on — never bare.** This reconciliation deliberately did **not** renumber them, because those
documents are cited by `006`, `007` and `008`, which are the record of what was found and must not
be rewritten. Renumbering is cheap only while entries are uncited, and these are past that point;
the fix is a mapping table in the ledger, not an edit to four documents.

**New questions therefore start at Q60**, leaving the whole Q53–Q59 range free for the ledger's
mapping.

---

## Q60–Q61 · opened by the round-3 reconciliation (`docs/design/009-reconciliation.md`)

| # | Kind | Question | Note |
|---|---|---|---|
| Q60 | E | **Does a raw-mode stdin reader in an ORCA terminal pane actually receive `terminal.sendText` bytes when `enter: false`?** `003` §2D.1's whole target-resolution handshake depends on it, and `003` §2D.3 forbids `enter: true` on every control path — so if the bytes only arrive on submit, the handshake needs a different carrier and the safety property is lost. Probe: run a two-line Node script in an ORCA pane with `setRawMode(true)`, call `terminal.sendText` from a panel with `enter: false`, and print what arrives, with byte offsets. **Nothing may be built on 2D.1 until this is run (P0).** | Cheapest reversible answer if it comes back negative: fall back to `enter: true` **for the probe only**, sending a string that is inert in every shell and in an agent composer (a lone `#` comment), and keep `enter: false` for real envelopes. |
| Q61 | D | **Who arbitrates the audio stream, and what is the utterance-preamble budget?** `008` X-05 stacked what three designs each prepend *"regardless of the setting"* — `005`'s earcon and mandatory call-sign, `003` §6's identity after ~30 s of silence, `002`'s omission announcements — at **~2.7 s in front of a 1.0 s reply** on the guaranteed floor. Three "regardless" rules, individually reasonable, collectively unlistenable, and no module owns the sum. Design: a budget in milliseconds or as a percentage of the estimated spoken length, enforced by whichever module assembles the utterance, dropping elements in a stated priority order — and the drop is **counted, not spoken**, or it defeats the point. The percentage is taste and belongs to Voice Lab. | Recorded rather than resolved by the round-3 reconciliation: it is a *needs-a-decision*, not a *blocks-implementation*, and picking a priority order without hearing the stack is exactly the P23 mistake. |

---

## Resolution log

Append here as questions close. Format: `Qn — resolved <date> — <evidence>`.

- **Q28 — resolved 2026-08-21** — `003` §6, as amended: the **display-name chain** is registry
  `name` → branch → displayName → call-sign alone, never hex. The **call-sign itself** is `005`
  §11.2's, one word, `WORDS[fnv1a32(sessionId) mod 64]`, probed not appended (X-04 / 007 C4).
- **Q34 — still the listener's**, but its option space is now fixed at `005` §13's A–F, and `004`
  carries the obligation to play all six back to back.
- **Q50 (`005`) — answered 2026-08-21** — `005` §15.1: the single-session lock is a **precondition**,
  not an open question. **M15 is scheduled after M16**, or gate M15 cannot be run (007 C5).
- **Q47 (`003`) / row 40 (`004`) — hex is closed, 2026-08-21** — `announce.sessionLabelHashChars`
  keeps the value 0 and loses the default of 8; `path-tail-3-plus-hash` is removed from row 39's
  option space entirely. Hex was shipped as taste and is correctness (007 C7).

---

## Q62–Q64 · opened by J21 (the normalizer number/comment pass, `packages/core/src/normalizer/index.ts`)

| # | Kind | Question | Note |
|---|---|---|---|
| Q62 | D | **Should a numeric range be spoken as a range?** `1,112-2,017` now reads as two correct numbers with a hyphen between them — *"one thousand one hundred twelve, two thousand seventeen"* — which parses by ear but never says the word "to". The obvious fix, rewriting `N-M` to `N to M`, is **rejected as written**: it destroys ISO dates, and `2026-08-21` is a shape this repo emits constantly. Any rule needs a discriminator that separates a range from a date from a hyphenated identifier, and the discriminator is the whole question. | Left deliberately unfixed by J21 rather than shipped with a date-shaped hole in it. The range case is audible-but-survivable; the date case would be a regression. |
| Q63 | D | **How should an ISO date be spoken?** Pre-existing and independent of Q62: `2026-08-21` reads today as *"two thousand twenty six-eight-twenty one"*. Nothing in the pipeline recognises a date. Options: leave it to the engine (which handles a bare `2026-08-21` better than the expanded form), recognise `YYYY-MM-DD` and speak it as a date, or recognise it only to suppress expansion. | Found while fixing thousands separators, out of that brief's scope. It is a *needs-a-decision*, not a bug report — what a date should sound like is partly taste (P23). |
| Q64 | E | **Does espeak-ng read a bare `1234567` as words, or digit by digit?** `expandNumbers` stops at 999,999 and hands anything larger to the engine. On macOS that is now **measured** and correct: `say` renders `1234567`, `1,234,567` and the spelled-out words to the same utterance, and `1000000` to byte-identical audio with the literal `"one million"` (`normalizer/index.ts`, the `numberToWords` doc comment) `[measured-here]`. **espeak-ng and Windows SAPI are `[claimed]`** — espeak-ng is not installed on the machine that measured this. If espeak-ng spells it digit by digit, the ceiling is a **Linux-only defect hiding behind a macOS-only probe**. | The probe is the same one already used: render to a file (never the device, P31) and compare against a spelled-out reference and a digit-by-digit reference. Cheapest home is the Linux CI leg. |
