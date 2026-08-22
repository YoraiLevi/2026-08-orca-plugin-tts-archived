# Read Aloud — a text-to-speech plugin for ORCA

Speaks agent replies and your clipboard aloud. Local, cross-platform, **no account, no API key, no
network**.

Built as assistive technology for a dyslexic, voice-first workflow: latency, reliability and
never-failing-silently are accessibility properties here, not polish.

> **Status: pre-release.** The plugin builds, is tested on macOS, Linux and Windows in CI, and has
> not yet been published to a marketplace. See "Known limitations" — they are real and named.

## Install

Not yet published. To run it today, build it and load it as a development plugin:

```bash
git clone <this repo> && cd orca-plugin-tts
pnpm install
pnpm build
```

Then in ORCA: **Settings → Plugins**, enable the plugin system, then **Development → Add**, and
paste the absolute path to **`dist/plugin`** — the built artifact, *not* `packages/plugin`.

`packages/plugin` contains `src/` and a workspace `node_modules` whose symlinks point outside the
folder; ORCA resolves realpaths and rejects the whole plugin as Invalid if anything escapes the
plugin root. `dist/plugin` is four self-contained files and nothing else.

## Use

| Action | Shortcut | Notes |
|---|---|---|
| Speak clipboard | `Mod+Shift+S` | press again to stop |
| Stop speaking | `Mod+Shift+X` | |
| Toggle huddle mode | `Mod+Shift+H` | speaks agent replies as they land; says "huddle mode on/off" aloud |
| Say status | `Mod+Shift+U` | says what is playing, which session, how many queued |
| Skip this reply | `Mod+Shift+K` | abandon the current reply, move to the next |
| Stop following | `Mod+Shift+L` | huddle stays on but goes quiet until a session is picked |
| Follow this session | `Mod+Shift+P` | lock onto the newest agent transcript here, announced aloud |

Shortcuts are rebindable in the manifest.

### Live dashboard and terminal-safe Stop

Open a terminal in the worktree and run:

```bash
pnpm control
```

The fixed terminal dashboard names the session being read and every queued item's session, shows
the queue depth, and keeps Stop on the same row. Press `s` (or `.`) there to stop: the command is
pushed to the plugin worker, which cancels synthesis and flushes playback before acknowledging it.
If no worker consumes the control, the TUI says so explicitly and rings the terminal bell; a dead
control is never silent.

### Huddle follows one session at a time

When huddle starts speaking it **locks onto that session** and stays there. It announces which one
("Now reading from orca-plugin-tts, session 111693de") and will not switch on its own, because
following whichever transcript was touched most recently means an unrelated busy agent hijacks your
audio mid-reply.

- `Mod+Shift+U` says which session it is following and what is queued.
- `Mod+Shift+K` skips the current reply.
- `Mod+Shift+L` stops following, so huddle goes quiet until a session speaks again.
- `Mod+Shift+P` picks a session back up, and says which one it switched to.

Enabling huddle never reads history — everything already on disk when a session is first seen is
marked as heard, so only what arrives next is spoken.

### What happens if it is already speaking

| Trigger | Behaviour |
|---|---|
| Hotkey while speaking | **interrupts** — you asked for this text *now*. A second `Mod+Shift+S` stops. |
| Agent reply while speaking (huddle) | **queues** — replies are spoken in order and never cut each other off. |
| `Mod+Shift+X` | stops everything and clears the queue. |

If replies arrive faster than they can be read, the queue keeps the newest and drops the oldest,
so a busy agent can never block or lag behind indefinitely.

### ⚠️ Shortcuts do not work while a terminal has focus

**Click somewhere outside a terminal — the sidebar, a settings pane, the tab bar — then press the
shortcut.** With focus in a terminal pane nothing happens at all.

This is ORCA's behaviour, not a bug in this plugin, and it is deliberate on their side: plugin
chords are dispatched only when focus context is `app`, so a plugin cannot steal `Ctrl+C` from your
shell. The consequence is that a plugin command is unreachable exactly where you spend your time.

The terminal dashboard above is the focus-safe route. A plugin panel can call
`terminal.sendText`, but it cannot read worker state and cannot distinguish a control pane from an
agent terminal using the opaque terminal ids ORCA exposes. The live surface therefore stays in the
terminal TUI; a panel must never guess a target and turn Stop into an agent prompt.

Tracked upstream at [stablyai/orca#15642](https://github.com/stablyai/orca/issues/15642), which
proposes an opt-in flag so a binding can ask for terminal reach.

**If you work mostly in terminals, use huddle mode** (`Mod+Shift+H` once, from the sidebar) and keep
`pnpm control` open. Agent replies arrive without another shortcut, and `s` remains reachable in
terminal focus.

## Known limitations

These are measured facts about ORCA's plugin API, not oversights. Each is tracked with the upstream
change that would remove it.

- **The hotkey speaks your clipboard, not your editor selection.** ORCA exposes no selection-read
  API and no clipboard capability to plugins. A real "speak selection" needs an upstream
  `selection:read` capability.
- **Huddle mode supports Claude, Codex, Grok and omp only.** Other agents have no transcript format
  a plugin can read. Unsupported agents are reported, not silently ignored.
- **Huddle mode picks the most recently modified transcript.** The plugin event carries no session
  id, so when two agents share one worktree the plugin cannot tell which replied — it warns and
  speaks the most recent rather than guessing silently.
- **There is a pause between sentences.** Audio plays by spawning a player per chunk, because no
  maintained Node audio package can stop fast enough for barge-in. The resident service (planned)
  holds one player open and removes the gap.
- **Windows on ARM uses the system voice only** — the neural engine has no build for that platform.
- **Shortcuts are dead while a terminal has focus** — see above. Upstream: stablyai/orca#15642.
- **The plugin panel cannot show live state.** ORCA has no worker→panel channel, so the panel is
  read-blind. The terminal dashboard shows the live session and queue without polling; press
  `Mod+Shift+U` for the same information in audio. Upstream: stablyai/orca#15638.
- **SSH/remote worktrees are not supported**: the transcript lives on the remote host.

## Engines

The default is your operating system's own synthesizer — `say` on macOS, System.Speech on Windows,
`espeak-ng` on Linux. It needs no download and always works, which is what makes the zero-setup
promise true.

A local neural engine (Piper via sherpa-onnx, measured at 52–65 ms per sentence) and optional cloud
providers sit behind the same `TtsProvider` interface. Cloud providers are never the default, and
the UI states plainly when text would leave your machine.

## Development

```bash
pnpm test        # 105 tests
pnpm typecheck
pnpm lint
pnpm build       # emits the self-contained artifact to dist/plugin/
pnpm size-gate   # ORCA caps a plugin at 2000 files / 50 MB
pnpm check:citations   # every `path:line` in the docs still points at what it claims
node scripts/dev.mjs   # the reload loop — read docs/dev-loop.md first
```

**Every claim about ORCA's plugin API in this repo cites `path/file.ts:123`** (PITFALLS P0), and
those pointers rot as fast as the code moves. `pnpm check:citations` re-derives each one from the
symbol the surrounding prose names, and fails when the pointer no longer lands on it. Set
`ORCA_SRC=/path/to/orca` to include the ~480 citations into ORCA's own tree; without it the script
says how many it could not check rather than passing them. Method and known blind spots:
`docs/.research/citation-audit.md`.

**Editing worker code does not hot-reload.** ORCA decides whether to re-fork a worker from the
manifest, not from your code, so the file watcher fires and the old code keeps running. See
`docs/dev-loop.md`; it will save you an hour.

## Layout

- `packages/core` — normalizer, chunker, queue, types. Pure, zero imports, runs anywhere.
- `packages/providers` — the `TtsProvider` seam, the OS synthesizer, the contract suite every
  provider must pass.
- `packages/plugin` — the ORCA shell. Every ORCA API call lives in `src/adapter/`.

## Licence

MIT. Voice models are downloaded separately and carry their own licences, shown before download.
