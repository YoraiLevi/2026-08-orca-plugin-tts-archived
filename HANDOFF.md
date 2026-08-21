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
| R4.2 | First audio **< ~500 ms** on the default local backend | **Rescoped 2026-08-21, `docs/design/015-m9-rescope.md`.** `OsSynthProvider.generate()` is p50 1,054–1,163 ms `[measured-here]` (n=9 ×2) — but that is per-process engine and voice init, **not synthesis compute**: warm resident `AVSpeechSynthesizer` first buffer is **p50 17.7 / 17.1 ms**, n=20 ×2 `[measured-here]` (`docs/.research/spike1-resident-synth.md` 1). **The budget is a device question on macOS, not an engine one.** Score per platform and per rung; Windows and Linux are `[claimed]`. |
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
| Tests | **337 passing, 18 files** at `745d36c` `[measured-here]`, `pnpm test` |
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

> **Amended again 2026-08-21 — SPIKE-1, `docs/.research/spike1-resident-synth.md`.** A **warm resident**
> `AVSpeechSynthesizer.write(_:toBufferCallback:)` reaches its first PCM buffer in **p50 17.7 / 17.1 ms**,
> n=20 ×2 `[measured-here]` — 8.5× inside 010's 150 ms pass condition; cold is ~328 ms (n=8), so residency is
> worth ~311 ms `[derived]` once per session; SSML is free (−0.3 / +0.4 ms); idle is 0.05 % CPU and 9.4 MB of
> private footprint, **synthesizer only, device excluded**. **Therefore M9 is rescoped
> (`docs/design/015-m9-rescope.md`): its deliverable is holding the audio DEVICE open across an utterance,
> and Piper moves to M9b as a quality decision on its own schedule.** Windows and Linux first-buffer remain
> `[claimed]` — the probes are committed and have never been executed.


> **Amended 2026-08-21 — the latency measurement pass.** `docs/.research/latency-measurements.md` is
> now the source of truth for every performance number in this project, and `pnpm bench:latency`
> re-runs it (**silent by default**; `--audible` opens the audio device and will interrupt whoever is
> at the machine). Three things it changed that are easy to get wrong again:
> **(1)** the inter-sentence gap is the **audio device**, not the process spawn — PITFALLS **P32**;
> **(2)** STATE.md's `927 ms` first audio was unsupported — the measured bracket is 1,112–2,017 ms
> on the OS synth; **(3)** every latency number in this repo now carries an R006 label
> (`[measured-here]` with a run count · `[documented]` with a citation · `[claimed]` when nobody has
> run it). An unlabelled number in a table beside labelled ones is the failure mode that produced all
> three.
>
> > **Clause (3) was false when it was written, and is corrected here 2026-08-21 — forced by round-7
> > finding R7-23.** The measurement pass swept the documents it touched; it did not sweep the repo,
> > and `010` — written in parallel, with its own **MEASURED / DOCUMENTED / ESTIMATED** vocabulary —
> > mixed both inside one six-row table, which is the exact failure the sentence claimed was gone. A
> > repo-wide claim that no probe backs is P32's shape: an indicator that cannot go red.
> >
> > **What is now true, stated so it can be checked:** `010` was swept into R006's vocabulary in the
> > round-7 reconciliation (`010`'s header note, and `docs/design/016-reconciliation-round7.md`), and
> > `011`, `012`, `013` were written in R006's vocabulary from the start. `002`–`005`, `009` and the
> > research files were swept by the measurement pass. **`006-fma.md` was not swept and is not
> > claimed** — it is exempted as *the record*, an exemption round 7 disputes in finding **R7-08** and
> > which is the author's to lift.
> >
> > **The instrument, not the sentence, is the answer.** `pnpm check:citations` cannot see a missing
> > R006 label; nothing in CI can, today. Until something can, this paragraph names which documents
> > were swept rather than asserting a property of a repo nobody re-reads.


- **ORCA's plugin API cannot deliver agent reply text, selection, or audio-in-panel.** Verified,
  not merely undiscovered. See `orca-plugin-api.md` "Verdict". Plugin system is off by default.
- **ORCA already ships first-party STT** (`src/main/speech/`, sherpa-onnx model catalog +
  downloader + cloud client + key store + Voice settings pane) and **zero TTS**. That is both the
  precedent to mirror and evidence that ORCA builds voice in the main process, not as a plugin.
- **Default engine: Piper (VITS) via `sherpa-onnx-node`** — 52–65 ms/sentence `[measured-here]`
  (P11), no node-gyp, prebuilt binaries. `say` is the never-fails fallback only: its *empty-string
  spawn* costs 414 ms `[measured-here]` (5 runs, P10) and a **whole real sentence through
  `generate()` costs p50 1,054–1,163 ms** `[measured-here]` (n=9 ×2,
  `docs/.research/latency-measurements.md` 1.3). **That cost is per-process init, not synthesis compute** —
  the same engine renders a sentence in **17.7 ms warm** in a resident process `[measured-here]`
  (`docs/.research/spike1-resident-synth.md` 1), so residency deletes it. **Piper's argument is voice
  quality, not latency** (`docs/design/015-m9-rescope.md` section 3). **Kokoro is a trap**: 16–25× slower than Piper `[derived]` from P11, int8
  slower than FP32.
- **One dependency, `sherpa-onnx-node`, covers TTS + future STT + VAD + keyword spotting.**
- **No preinstalled macOS binary accepts streaming PCM on stdin.** `afplay` refuses it and gives a
  **~950 ms inter-sentence gap** `[measured-here]` (p50 950/937/897 ms, n=18 ×3,
  `docs/.research/latency-measurements.md` 1.1). **The gap is the audio device, not the process
  spawn** — fork/exec is 2.3 ms of it and the temp file 0.33 ms; ~893 ms is CoreAudio open,
  pre-roll, post-roll and teardown (PITFALLS **P32**). So the ways out are the ones that keep a
  device open — Web Audio in a renderer, or a bundled sidecar — and *not* a faster or pooled
  player. **This is the sharpest constraint in the project.**
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
- **Stop is pushed, never polled**, at p50 120 ms / p99 250 ms `[claimed]` — a target assembled
  from four estimated segments, failing CI above 400 ms. The panel poll floor alone is 345 ms
  `[derived]` (10,000/30 plus one watchdog slot), so a polled Stop is double the budget by
  construction — **that** part is arithmetic over a documented rate limit, not an estimate. What is
  measured on the Stop path is only `kill`-to-exit, ~3 ms `[measured-here]` (n=10 ×2); **audio
  drain is unmeasured** — see `003` "Q13 — the Stop latency number".
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
