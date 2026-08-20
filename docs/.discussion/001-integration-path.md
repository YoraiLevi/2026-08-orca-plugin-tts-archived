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
