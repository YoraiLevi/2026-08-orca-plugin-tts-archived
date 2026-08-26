# Compaction — orca-plugin-tts, 2026-08-21

Paste this to resume with no prior context.

## What this is

**Read Aloud**, a text-to-speech plugin for ORCA. Public, shipped, working:
https://github.com/YoraiLevi/2026-08-orca-plugin-tts-archived · CI green on macOS/Linux/Windows · 145 tests.

**It is assistive technology.** The user is dyslexic and voice-first. Latency, reliability and
never-failing-silently are accessibility properties, not polish. They had already specified this
project themselves — `YoraiLevi/TTS-Hotkey-AI-Read-Clipboard-CLI` issue #1 (R1–R9) and a 1,553-tool
survey gist. **Read those before designing anything.**

## Read these, in order, before acting

1. `HANDOFF.md` — hard requirements, the user's binding R1–R9, current phase
2. `PITFALLS.md` — **P0–P24**. Nearly every one cost real time. P13–P22 are ORCA-specific traps
3. `.specify/memory/constitution.md` — 9 principles, 86 numbered rules (R001–R086), and **Part III:
   the autonomous operating protocol, its five STOP conditions, and the resumption contract**
4. `STATE.md` — phase board
5. `docs/TASKS.md` — M0–M10 done, **M11–M17 is the live roadmap**
6. `docs/architecture.md` — diagrams

## Where things stand

| | |
|---|---|
| v1 | shipped, in daily use by the author |
| Verified by a human | huddle mode spoke live agent replies, 2026-08-21 |
| Honest status | **usable but not refined** — the author's own words |
| Next, and nothing before it | **M11 Voice Lab** |

## The one instruction that matters most

**Do not tune speech defaults by ear over chat.** Six rounds of "does this sound better?" did not
converge (PITFALLS P23). Every remaining quality question is *taste*, settleable only by the
listener hearing the same sample repeatedly. Build M11 Voice Lab — a local page running the real
normalizer and real engine, with fixtures, live controls and a replay button — then let them choose.
Ship the mechanism; the listener picks the values.

## What listening taught us that no test could

All from a human hearing real output:

- omissions felt abrupt → lead-in sentence, engine pauses either side
- URLs vanished → say the destination, "a link to github dot com"
- "52 ms" was odd → expand units before numbers
- table rows too quick → pair every value with its header
- paths "made no sense whatsoever" → announce the name, kind **last**, announce the folder
- another session hijacked the audio mid-reply → lock to one session, announce switches
- "confusing what it is even reading… feel helpless" → skip/stop/status controls; real panel is M13

## Architecture in five lines

- `packages/core` — normalizer, chunker, queue, types. **Pure, zero imports.** The valuable part.
- `packages/providers` — `TtsProvider` seam, contract suite, OS synthesizer (macOS/Windows/Linux)
- `packages/plugin` — the ORCA shell. **Every ORCA call lives in `src/adapter/` and nowhere else.**
- `dist/plugin/` — the shipped artifact: three files, committed, no symlinks (P17)
- M9 (resident Piper service) is post-v1 and is what closes the 500 ms latency budget

## ORCA traps that will bite you again

The host holds lists a plugin cannot query. **Vendor them and test against them** — four separate
outages came from this: manifest schema (P16), file containment (P17), host API names (P18),
keybindings (P19).

- Editing worker code does **not** hot-reload. Use `node scripts/dev.mjs`; read `docs/dev-loop.md`
- Plugin logs are a 200-line in-memory ring buffer. **No log file exists**
- Shortcuts are dead while a terminal has focus (orca#15642). Click the sidebar first
- Plugin caps: 2,000 files / 50 MB. Voice models can never ship inside the plugin
- `agent.status.changed` fires *before* the transcript flush — watch the file, don't trust the edge (P20)

## Upstream, open

| | |
|---|---|
| [#15637](https://github.com/stablyai/orca/issues/15637) | no plugin route to assistant text |
| [#15638](https://github.com/stablyai/orca/issues/15638) | no host→panel channel |
| [#15639](https://github.com/stablyai/orca/issues/15639) | no session id on the event |
| [#15640](https://github.com/stablyai/orca/pull/15640) | **PR** — projects `sessionId` |
| [#15642](https://github.com/stablyai/orca/issues/15642) | keybindings dead in terminal focus |
| [#15643](https://github.com/stablyai/orca/pull/15643) | **PR** — `storage.get` panel-callable, **unblocks M13** |

## Still requiring the user's approval (constitution R056–R059)

Publishing, pushing to a public remote, opening PRs on other projects, anything outward-facing.
Approval for one does **not** carry to the next.

## Attitude

The user watches but does not interfere, and expects the work finished rather than narrated. Report
honestly: if it is not done, say so, and say what was left out. They gave sharp, specific listening
feedback all day — take it literally, it has been right every time. The bugs that mattered were
never found by the test suite; they were found by running the real artifact and listening.

## Next action

**M11, task T110** — build the fixture corpus. Then T111, the local server. `docs/TASKS.md` has all
37 Phase-2 tasks with gates.
