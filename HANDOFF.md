# HANDOFF — orca-plugin-tts

## What this project is
A Text-To-Speech plugin for **ORCA** (https://github.com/stablyai/orca), giving the agent a voice.

Two headline features (not the full list):
1. **Speak selection** — hotkey reads highlighted text aloud.
2. **Huddle / conversational mode** — agent replies are spoken automatically as they stream, in
   digestible chunks, with UI affordances borrowed from `block/buzz`.

## Hard requirements (from the user, non-negotiable)

| # | Requirement | Implication |
|---|---|---|
| R1 | **Cross-platform parity.** macOS, Linux, Windows — identical features, out of the box. | No macOS-only default engine. No `afplay`. Native deps must have prebuilts for all platform+arch combos or be disqualified. |
| R2 | **Local buildable + live-debuggable.** A developer can build the plugin from source and load it into a running ORCA to debug. | Need ORCA's dev-load / hot-reload story documented before design freezes. |
| R3 | **Installable by third parties.** | Must conform to ORCA's real distribution mechanism (registry / manifest / URL — TBD by research). |
| R4 | **Tests + CI/CD + docs before publishing.** CI must run on all three OSes. | Engines that can't be exercised headlessly in GitHub Actions are a flagged risk. |
| R5 | **Publish to a public GitHub repo** — only once R4 is genuinely satisfied. | Not "tests exist" — tests pass, verified by effect. |

## THE MOST IMPORTANT THING TO KNOW

**This is assistive technology, not a novelty.** The user is dyslexic and voice-first. Evidence:
their own gist *"Engineer↔Agent Workflow Infrastructure for a Dyslexic, Voice-First Operator"*,
which cites Wood et al. 2018 (d=0.35 TTS comprehension effect across 22 studies) and a Frontiers
2022 finding that dyslexic adults match controls on *listening* comprehension while lagging on
reading. Latency, reliability and "never fail silently" are accessibility properties here. Treat
them as such.

**The user has already specified this project.** `YoraiLevi/TTS-Hotkey-AI-Read-Clipboard-CLI`
issue #1 is a complete functional spec (R1–R9) plus a source-level survey of 16 projects, and the
gist *"Reading the Screen Aloud"* catalogues 1,553 tools with per-row evidence tiers. **Read both
before designing anything.** Our ORCA plugin is a *host* for that design, not a fresh design.

### The user's binding requirements (from TTS-Hotkey issue #1)

| Req | Constraint | Consequence |
|---|---|---|
| R3.4 | Default needs **no account, no API key, no network** | Disqualifies Picovoice Orca, ElevenLabs, OpenAI, edge-tts |
| R3.1/R3.2 | Backend is **configuration, not code**, behind a documented interface | Provider seam exists before the first engine |
| R4.1 | **Sentence streaming required** — "POST → wait for whole paragraph → play" fails | Huddle mode must synthesize sentence 1 while the agent still types |
| R4.2 | First audio **< ~500 ms** on the default local backend | |
| R2.5 | Speech **interruptible** by a second chord | Two-sided cancel: stop the player AND the synthesizer |
| — | **Two-process rule**: neural model load is seconds; a hotkey must not pay it per press | Resident warm service + thin client |
| R5.2 | **Playback belongs to the client, not the synthesis service** | Providers emit PCM; a separate sink plays it |
| R9 | Cross-platform parity | Of 12 candidates surveyed, **zero** satisfied R9 and **zero** satisfied R3. That gap is our contribution. |

## Current phase

**Phase 2 — refinement.** v1 ships, works, and is in daily use by the author. It is **usable but
not refined**, which is the author's own summary after one day of listening.

| | |
|---|---|
| Repo | https://github.com/YoraiLevi/orca-plugin-tts (public) |
| CI | green on macOS, Linux, Windows |
| Tests | 145 |
| Verified by a human | huddle mode spoke live agent replies, 2026-08-21 |
| Next | **M11 Voice Lab** — and nothing else until it exists |

### Why Voice Lab is first

Every remaining quality question — how a path is announced, whether the file kind comes last, how
much warning an omission needs — is **taste**, settleable only by the listener, only by hearing the
same sample repeatedly. Tuning it through conversation costs a refresh, a reply and a listen per
round, and the author correctly called a halt:

> *"I want to refine it myself manually through some kind of a configuration normalization UI with
> real tests I can hear over and over again."*

Do not tune defaults by ear over chat. Build M11, then let the listener choose.

### Roadmap, M11 to M17

`docs/TASKS.md` "PHASE 2". In order: Voice Lab · settings · the panel that shows what is happening
(blocked upstream) · an agent-controlled spoken channel · per-agent voices · huddle presence ·
voice input.

### Upstream, open

| | |
|---|---|
| [#15637](https://github.com/stablyai/orca/issues/15637) | no plugin route to assistant text |
| [#15638](https://github.com/stablyai/orca/issues/15638) | no host→panel channel |
| [#15639](https://github.com/stablyai/orca/issues/15639) | no session id on the event |
| [#15640](https://github.com/stablyai/orca/pull/15640) | **PR** — projects `sessionId` |
| [#15642](https://github.com/stablyai/orca/issues/15642) | keybindings dead in terminal focus |
| [#15643](https://github.com/stablyai/orca/pull/15643) | **PR** — `storage.get` panel-callable |
| [#15647](https://github.com/stablyai/orca/issues/15647) | parallel dev builds share one userData profile |
| [#15648](https://github.com/stablyai/orca/pull/15648) | **PR** — per-worktree dev profile |
| [#15655](https://github.com/stablyai/orca/issues/15655) | plugins cannot expose settings to the user |

**None of these block us.** Checked 2026-08-21: all open, one day old, zero maintainer engagement.
Design against today's API and treat any merge as a bonus. M13 was recorded as "blocked on #15643"
and that was **wrong** — see below.

## Settled findings

- **ORCA's plugin API cannot deliver agent reply text, selection, or audio-in-panel.** Verified,
  not merely undiscovered. See `orca-plugin-api.md` "Verdict". Plugin system is off by default.
- **ORCA already ships first-party STT** (`src/main/speech/`, sherpa-onnx model catalog +
  downloader + cloud client + key store + Voice settings pane) and **zero TTS**. That is both the
  precedent to mirror and evidence that ORCA builds voice in the main process, not as a plugin.
- **Default engine: Piper (VITS) via `sherpa-onnx-node`** — 52–65 ms/sentence measured, no
  node-gyp, prebuilt binaries. `say` is the never-fails fallback only (its *empty-string spawn*
  costs 414 ms). **Kokoro is a trap**: measured 16–25× slower than Piper, int8 slower than FP32.
- **One dependency, `sherpa-onnx-node`, covers TTS + future STT + VAD + keyword spotting.**
- **No preinstalled macOS binary accepts streaming PCM on stdin.** `afplay` refuses it and gives a
  ~970 ms inter-sentence gap. The ways out are Web Audio in a renderer, a bundled sidecar, or a
  Homebrew dependency we cannot assume. **This is the sharpest constraint in the project.**
- **Barge-in is not "kill the player"** — it must cancel in-flight synthesis *and* flush buffered
  audio, or the synthesizer keeps producing speech for text the user already interrupted.
- **Port buzz's `preprocess_for_tts`** (7 stages, no deps, fully tested) and **add the four rows
  they lack**: headings, lists, tables, file paths. Their own issue #4403 states the target —
  "headings become pauses, list items become sentences, tables are announced by row".
- **Thinking blocks are flattened into text blocks** in ORCA's decoder. Filter at the raw JSONL
  level or huddle mode speaks the model's chain-of-thought aloud.

## What the design rounds settled — 2026-08-21

Full argument in `docs/design/000-round-ledger.md`; each row links to its document. Do not re-open
these without new evidence.

- **The panel is write-capable and read-blind.** `workspace.readContext` returns only `branch`,
  `displayName` and opaque terminal ids; storage is refused in both directions. So the dashboard
  is a **terminal TUI** (`orca-tts control`), and the panel is an honest control strip. M13 was
  never blocked on upstream — the block was on *display*, not on *control*.
- **A panel CAN act today**, via `terminal.sendText`. Exactly three host methods are panel-callable
  and two of them mutate.
- **Stop is pushed, never polled**, at p50 120 ms / p99 250 ms, failing CI above 400 ms. The panel
  poll floor alone is 345 ms, so a polled Stop is double the budget by construction.
- **The spoken channel is a ladder**: a structural classifier that needs no agent cooperation is the
  floor and the deliverable; a `speak` fence is an enhancement on top. We never write to a user's
  `CLAUDE.md`.
- **Identity is `(callSign, earcon, voiceTuple)`, designed for N=1.** Voice-based identity
  guaranteed on all three platforms is exactly **1** (macOS 66, stock Windows 6, stock Ubuntu 0–2).
  The portable axes are the ones we generate. **Never speak hex.**
- **Voice Lab plays in the browser**, not the server, and is also the settings UI — because ORCA's
  settings capability renders nothing at all.

## Open decisions

- **Identifier speech** — `_flush_buffer()` is spoken raw today. Settle in Voice Lab, not by guess.
- **Deep path depth limit** — "in folder packages core src normalizer" may be too long to follow.
- **Who arbitrates the audio stream.** Three designs now write into it — skip announcements,
  tunable wording, and a spoken call-sign — and none of them summed the total overhead.
- **Licence** stays MIT; revisit only if we ever bundle a GPL voice (we do not, and should not).

## What listening taught us that testing could not

Recorded because it is the most transferable lesson in the project. Every one of these came from a
human hearing real output; none were catchable by reading it or by any test we would have written:

| Heard | Fix |
|---|---|
| omissions "abrupt, I didn't expect it" | lead-in sentence, engine pauses either side |
| URLs vanished without warning | say the destination: "a link to github dot com" |
| "52 ms was odd to hear" | expand units before numbers |
| table rows "too quick… not obvious what I am hearing" | pair every value with its header |
| paths "made no sense whatsoever" | announce the name, kind last, announce the folder |
| another session's replies hijacked the audio | lock to one session, announce switches |
| "confusing what it is even reading… feel helpless" | skip/stop/status controls; panel is M13 |

## Standing rules

All 86 standing rules are `.specify/memory/constitution.md` **Part II**, numbered `R001`-`R086`.
Part III is the autonomous operating protocol: the work loop, the five STOP conditions, and the
resumption contract. Read it on spawn, with this file and `PITFALLS.md`.

## Where things live
- `docs/.research/` — raw research artifacts (hot). Promote to `docs/` when settled.
- `docs/.discussion/` — open questions with Question + Options + Recommendation + Engineer-prompt bodies.
- `specs/` — speckit-style specs (layout pending speckit-scout's recommendation).

## Next agent picks up from
Read the four research files above, then `docs/.discussion/`.
