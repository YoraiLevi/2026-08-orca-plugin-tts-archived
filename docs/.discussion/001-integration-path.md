# D001 — How does the TTS system attach to ORCA?

**Status:** open, pending empirical results (E1, E2 in `docs/.research/orca-empirical-findings.md`)
**Raised:** 2026-08-20, after `docs/.research/orca-plugin-api.md` landed.
**Blocks:** the constitution, `specs/001-*`, and every class in the design.

## Question

The user asked for "a TTS system as an ORCA plugin". The source-read shows the ORCA plugin API,
as built today, **cannot deliver the two headline features**:

| Feature | Blocker | Evidence |
|---|---|---|
| Speak selection | No selection read, no clipboard capability, no global shortcut anywhere in ORCA | `plugin-host-api.ts:122-253`, `plugin-capabilities.ts:15-23` |
| Huddle / auto-speak | `agent.status.changed` is a 4-field projection that deliberately strips message content | `plugin-events.ts:28-39`, `plugin-event-bus.ts:33-41` |
| Any audio in a panel | Panel CSP is `default-src 'none'`, no `media-src`, `sandbox="allow-scripts"` with no `allow` | `plugin-panel-shell.ts:20-22`, `PluginPanel.tsx:220-232` |

Meanwhile ORCA *internally* has exactly the data model we want (`NativeChatMessage`, typed blocks,
raw markdown text, live-tailed at 40 ms) and already ships a complete first-party **speech-to-text**
stack in the main process — but zero TTS. It built voice as main-process code with a settings pane,
**not** as a plugin.

So: do we build inside the plugin sandbox and accept its limits, step outside it, or change it?

## Options

### Option A — Plugin + worker filesystem (stay inside the plugin system)
The plugin declares `main`, gets a forked plain-Node worker with `execArgv: []` and no Node
permission model, tails `~/.claude/projects/**/*.jsonl` itself, and spawns a TTS binary.

- **For:** ships today, no upstream dependency, installable by third parties through ORCA's
  existing git-based marketplace, and it is literally "an ORCA plugin" as asked.
- **Against:** filesystem and process-exec are **outside the seven-capability model**, whose header
  names `net:fetch` and `process:exec` as *future* scoped capabilities — implying the worker will
  eventually be confined and this breaks. `paneKey`→transcript correlation is a
  most-recently-modified heuristic that breaks with two agents in one worktree, which is ORCA's
  headline feature. Covers only 5 of 14 agents (those with transcript decoders). Plugin system is
  off by default. 5-minute idle worker reap. Speak-selection still impossible.

### Option B — Upstream TTS into ORCA proper (mirror `src/main/speech/`)
Contribute a first-party TTS subsystem in the main process, symmetric with the existing STT stack,
with its own Voice settings pane.

- **For:** all data is already there — `lastCompletedAssistantMessage`, `providerSession.transcriptPath`,
  the real per-pane correlation, selection reads in the renderer. No sandbox fight. Matches the
  precedent ORCA itself set for STT. Best possible UX.
- **Against:** not a plugin — contradicts the literal ask. Merge is outside our control; a large PR
  to someone else's product on an unknown review cadence. We cannot publish it as our own installable
  artifact. Slow.

### Option C — Hybrid: plugin now, upstream the three missing primitives in parallel
Build the plugin (Option A) as the shipping artifact, structured so that the moment ORCA grows the
primitives it degrades gracefully into using them. Concurrently open small, surgical upstream PRs:
1. add `providerSession`/`sessionId` to the `agent.status.changed` projection (kills the correlation
   heuristic outright, ~10 lines),
2. add an `assistantMessage` event or a `chat:read` capability,
3. add `selection:read` to the capability set,
4. add `media-src`/audio to the panel CSP, or bless `speechSynthesis`.

- **For:** delivers something now, and each merged PR retroactively upgrades the plugin. The PRs are
  small, self-justifying, and each one is independently useful to other plugin authors. We keep
  ownership of a publishable repo (R5).
- **Against:** we maintain an abstraction seam for an API that may never land; two workstreams.

## Recommendation

**Option C**, with the shipping artifact being Option A — *conditional on E1 and E2*.

Reasoning: it is the only option that satisfies the user's literal ask (a plugin), the hard
requirements (R3 third-party installable, R5 publishable public repo), and still has a path to the
UX we actually want. Option B alone forfeits R3/R5 — we would have no artifact of our own. Option A
alone bakes in a heuristic we already know is wrong for ORCA's flagship workflow.

**Two empirical results can change this:**

- If **E2 is positive** (`speechSynthesis` works in a panel), synthesis and playback move *inside*
  the sandbox with zero capabilities, most of Option A's "outside the capability model" objection
  evaporates, and the default engine question (D002) largely dissolves — the OS speech service is
  reached through Chromium, cross-platform, no binaries, no models, no downloads. This would be the
  single best outcome available and would make R1 nearly free.
- If **E1 is negative** (worker Node access is patched/restricted), Option A is dead as specified
  and we fall back to Option B or to a companion process outside ORCA entirely.

**Scope note, stated plainly:** under every option, "speak selection" cannot read a real editor
selection today. The honest fallbacks are (i) speak the clipboard, populated by the user's own copy,
(ii) speak the last assistant message on a chord, (iii) wait for an upstream `selection:read`. We
should name this in the spec rather than let it read as delivered.

## Engineer prompt

> Read `docs/.research/orca-plugin-api.md` and `docs/.research/orca-empirical-findings.md`. Confirm
> or refute the recommendation above given the measured E1/E2 results. If E2 is positive, rewrite
> this document's recommendation around a panel-hosted synthesizer and say what happens to the
> worker. If E1 is negative, produce the Option B/companion-process comparison this document does
> not currently contain. Then write the constitution and `specs/001-*` against whichever option survives.

---

# RESOLUTION — 2026-08-20, after E1/E2/E6/E7/E8

**Decision: Option C (hybrid), with a specific shape the pre-empirical draft did not anticipate.**

## What the measurements changed

| Hoped-for architecture | Measured verdict |
|---|---|
| Worker has real Node (fs, spawn, net) | ✅ **Confirmed unrestricted.** Option A's foundation is sound. |
| Panel can play raw PCM via Web Audio | ✅ **Works, beautifully.** 4 ms scheduling drift, 2 ms stop-to-silence, decodes MP3/Opus/AAC/WAV. Zero CSP violations. |
| Worker can hand the panel those samples | ❌ **No channel exists.** `commands.invoke`, `storage.get`, `events.subscribe` are all *"not a panel-callable action"*; there is no host→panel push at all. |

So the clean design is **technically sound and currently unreachable**, blocked not by an audio
problem but by one missing message channel. The panel is an excellent speaker with no wire to it.

Two further measurements constrain the rest:

- **E7:** declaring `keybindings` folds a hash of *every file in the plugin directory* into the
  consent fingerprint (`plugin-discovery.ts:126-135`). Any byte change — a `.DS_Store` — flips the
  plugin to `needsReconsent`. Bumping `version` alone does **not** work around it. PITFALLS P6's
  proposed workaround is dead; the working loop is a script that re-reads the live fingerprint and
  calls `plugins.consent` programmatically.
- **E8:** the panel→host bridge caps at 64 KB per message and 30 messages per 10 s.

## The resolved architecture

**Four parts, with the ORCA-specific surface kept deliberately thin.**

1. **ORCA plugin worker** — the orchestrator. Tails the agent transcript JSONL (it has real `fs`),
   filters thinking blocks at the raw record level, normalizes markdown for speech, chunks on
   sentence boundaries. Owns no audio.
2. **A resident local TTS service** — synthesis and playback, over loopback HTTP. This is the
   user's own two-process rule made concrete, and it is *also* their existing
   `TTS-Hotkey-AI-Read-Clipboard-CLI` project. Models stay warm; a hotkey never pays model load.
   Playback lives on the machine with the speakers (user requirement R5.2).
3. **A zero-install bridge** — before the service is installed or warm, the worker spawns the OS
   synthesizer directly (`say` / PowerShell SAPI / `spd-say`). Slower, always present, never fails.
   This is what makes Constitution principle I (never fail silently) true on first run.
4. **Panel** — UI only: status, what is speaking, controls. It becomes a *playback surface* the day
   upstream PR #1 lands, and the code is structured so that is a sink swap, not a rewrite.

**Why the service rather than putting synthesis in the worker:** the worker is reaped after 5
minutes idle, cannot host a `.node` native addon inside a bundled `main.mjs`, is capped at 50 MB
and 2,000 files, and has no maintained instant-stop audio sink available to it. The service has
none of those limits, is reusable outside ORCA, is testable in CI without Electron, and is the
artifact the user already specified.

**Upstream PRs, in value order.** Each is small, independently useful to other plugin authors, and
each retroactively upgrades the plugin:
1. A host→panel `postMessage` channel. Unlocks the measured-good panel playback path.
2. `sessionId` / `providerSession.transcriptPath` in the `agent.status.changed` projection. Kills
   the correlation heuristic outright.
3. `selection:read`. The only honest route to a real "speak selection".

## What this costs us, stated plainly

- **"Speak selection" still cannot read an editor selection.** Ships as speak-the-clipboard plus
  speak-the-last-reply until PR #3 lands. This must be named in the spec, not implied away.
- **Transcript correlation stays a heuristic** until PR #2 lands: `worktreeId` carries the absolute
  worktree path, which is the only usable handle, and it breaks with two agents in one worktree.
- **Coverage is 5 of 14 agents** — only those with transcript decoders.
- **A second installable component.** Mitigated by part 3: the plugin is useful, if slower, alone.
