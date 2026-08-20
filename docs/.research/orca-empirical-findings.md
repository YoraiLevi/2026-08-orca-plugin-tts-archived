# ORCA plugin system — empirical findings

Measurement artifact. Phase 0. Companion to `orca-plugin-api.md` (source-read at the same commit).
Every result below is labelled **MEASURED** (a probe plugin ran inside a real ORCA build and this is
its output) or **NOT-TESTED** (with the reason). Nothing here is inferred; where a source line is
cited it is cited as corroboration of a measurement, never as a substitute for one.

Raw JSON for every probe is under
`/private/tmp/claude-501/-Users-m5air-source-orca-plugin-tts/111693de-38da-4de8-a288-506104eb7c9c/scratchpad/probe-out/`
(scratch — regenerable, not durable).

## Bottom line

1. **The plugin worker has completely unrestricted Node.** MEASURED: it read `/etc/hosts`, listed
   the *real* user's `~/.claude/projects` (234 entries) and read a transcript JSONL line, spawned
   `/usr/bin/say` and got a 68,776-byte AIFF back, wrote and re-read a temp file, bound a loopback
   HTTP server, and fetched `https://example.com` (200). `process.permission` is `undefined`,
   `execArgv` is `[]`, and `module.createRequire` works unpatched. There is no require-patch and no
   custom ESM loader. **The filesystem+subprocess architecture is viable today.**
2. **`window.speechSynthesis` works inside a plugin panel — fully.** MEASURED: 180 voices after
   `voiceschanged`, and `speak()` fired `start` → 4× `boundary` → `end` over 1,672 ms for
   "testing one two three". **Zero CSP violations for speech.** `AudioContext` constructs in state
   `running` with no user gesture. **Synthesis can live inside the sandbox with zero capabilities.**
3. **But `<audio>` in a panel is genuinely dead.** MEASURED: setting `audio.src` to *either* a
   `data:` URI or a `blob:` URL raises `securitypolicyviolation` with `effectiveDirective:
   "media-src"` and `MediaError.code = 4`. So a panel can *synthesize* but cannot *play supplied
   bytes* — cloud-TTS-audio-in-the-panel is impossible; OS-voice-in-the-panel is easy.
4. **The `paneKey` → transcript gap is real and worse than "heuristic".** MEASURED: the plugin
   receives exactly four fields; a `last_assistant_message` we injected through ORCA's own hook
   endpoint never appeared. `paneKey` is `<tabId UUID>:<layoutLeaf UUID>` — no session id, no agent
   id. `worktreeId` *does* carry the absolute worktree path (`<repoId>::<abs path>`), which is the
   one usable correlation handle. ORCA itself correlates via `providerSession.transcriptPath` /
   `sessionId`, neither of which is plugin-visible.
5. **The dev loop is worse than advertised, in two distinct ways.** MEASURED: (a) editing a
   worker's `main.mjs` does **not** hot-reload — a running worker keeps executing the old code
   until it is force-restarted; (b) if the manifest declares `keybindings` (which a TTS plugin
   wants), **every single file edit changes the consent fingerprint, flips the plugin to `pending` /
   `needsReconsent: true`, and disables it** until the user re-approves. Hot reload is really hot
   re-consent. Also MEASURED: plugin logs are an in-memory 200-line ring buffer — **there is no log
   file on disk at all**.

6. **A plugin panel cannot talk to its own plugin worker.** MEASURED: the panel bridge accepts
   exactly three actions. `commands.invoke`, `plugin.invokeCommand`, `storage.get`, and
   `events.subscribe` all come back `invalid_request` / `"action: not a panel-callable action"`.
   There is no host→panel push either — the bridge has four message types and the only host→panel
   frames are a watchdog ping and the result of a panel-initiated call. **So finding 2 and finding 1
   cannot be composed as stated: the worker can get the text but has no way to hand it to the panel
   that can speak it.** This is the sharpest open design problem the measurements produced.

## Environment

| Item | Value |
|---|---|
| ORCA commit | `0f26ff4ad83e9ca736f6ad3bae6937cd0cdab7fc` (clean; only my probe spec files added) |
| ORCA version | `1.4.178-rc.2` (`package.json:3`) |
| Electron | `43.1.0`; worker `process.versions.node` = `24.18.0` |
| Host Node | `v26.7.0` (repo asks for 24; `pnpm install` and the build both succeeded anyway) |
| pnpm | `10.24.0`, run via `npx pnpm@10.24.0` (no corepack on this machine) |
| OS | macOS 26.5 (build 25F71), arm64 |
| Harness | ORCA's own Playwright + `_electron.launch()` E2E fixture (`tests/e2e/helpers/orca-app.ts`) |

**Isolation.** I did not touch the user's real ORCA install. The E2E fixture creates a fresh
`mkdtemp` userData dir *and* a fresh isolated `HOME` per test, and refuses to launch if the isolated
home resolves to the developer home (`tests/e2e/helpers/electron-home-isolation.ts:78-81`). The
probe therefore never wrote to `~/Library/Application Support/orca` or `~/Library/Application
Support/orca-dev`. The single deliberate exception is **read-only**: probe E1b opens
`/Users/m5air/.claude/projects` by absolute path (`readdirSync` + one `readFileSync`) to prove real
transcript access. Nothing under `/Users/m5air/source/orca-plugin-tts` was modified except this file.

**Probe plugin.** `orca-tts-probe.tts-probe`, in the scratchpad at `scratchpad/probe-plugin/`
(manifest + `main.mjs` + `panel.html`), shaped after `examples/plugins/hello-orca/`. Loaded via the
`devPluginPaths` setting. Specs: `tests/e2e/tts-probe{,2,3,4,5}.spec.ts` in the ORCA clone.

## E1 Worker Node access — **MEASURED, unrestricted**

Command: `plugins.invokeCommand({ commandId: 'probe-node' })` from inside the app, handler running
in the forked plugin worker. Expectation going in: probably works, but the scout had not audited for
a require-patch or ESM loader hook. Result: every probe passed.

Verbatim (`probe-out/e1-worker-node.json`, abbreviated only by dropping repeated boilerplate):

```json
{ "probe": "a.fs.import+existsSync(HOME)+readFile", "ok": true, "value": {
    "HOME": "/private/var/folders/.../orca-e2e-userdata-RUols7/home",
    "existsSync_HOME": true, "readTarget": "/etc/hosts",
    "readFirst80": "##\n# Host Database\n#\n# localhost is used to configure the loopback interface\n# w" } }

{ "probe": "b.fs.readdir(~/.claude/projects)", "ok": true, "value": {
    "env.HOME": { "ok": false, "error": "ENOENT: ... orca-e2e-userdata-RUols7/home/.claude/projects" },
    "literal /Users/m5air": { "dir": "/Users/m5air/.claude/projects", "ok": true,
      "count": 234, "first3": ["-", "-Users-m5air", "-Users-m5air--"] },
    "jsonlRead": { "file": "-/4e090119-3254-4c27-9233-cc2eb00dfe35.jsonl",
      "firstLineLength": 3496,
      "firstLine200": "{\"type\":\"queue-operation\",\"operation\":\"enqueue\",\"timestamp\":\"2026-07-14T04:17:14.588Z\",\"sessionId\":\"4e090119-...\",\"content\":\"..." } } }

{ "probe": "c.child_process.execFile(node -e)", "ok": true, "value": { "stdout": "1", "stderr": "" } }
{ "probe": "c2.child_process.spawn(/bin/echo)", "ok": true, "value": { "stdout": "spawned-ok" } }
{ "probe": "c3.macos.say-to-aiff",            "ok": true, "value": { "aiffBytes": 68776 } }

{ "probe": "d.os.tmpdir+write+readback", "ok": true, "value": {
    "tmpdir": "/var/folders/4y/.../T", "wrote": "probe-payload-95781",
    "readBack": "probe-payload-95781", "roundTripOk": true } }

{ "probe": "e1.fetch(loopback-listener)", "ok": true, "value": {
    "boundPort": 60828, "fetchStatus": 200, "body": "pong-from-worker-server", "netModuleLoaded": true } }
{ "probe": "e2.fetch(public-internet)", "ok": true, "value": { "status": 200, "bytes": 559 } }

{ "probe": "f.process-introspection", "ok": true, "value": {
    "execPath": ".../Electron Helper.app/Contents/MacOS/Electron Helper",
    "execArgv": [],
    "argv": [".../Electron Helper", ".../out/main/plugin-host-entry.js"],
    "version": "v24.18.0", "versions_electron": "43.1.0", "versions_node": "24.18.0",
    "permission_defined": "undefined", "permission_has": null,
    "envKeys": ["ELECTRON_RUN_AS_NODE","HOME","LANG","PATH","TMPDIR","USERPROFILE","__CF_USER_TEXT_ENCODING"],
    "cwd": "<orca repo root>", "platform": "darwin",
    "grantedCapabilities": ["workspace:read","terminal:send","notifications:show","storage","events:subscribe"] } }

{ "probe": "g.loader-integrity", "ok": true, "value": {
    "createRequireWorks": true, "requireCacheKeys": 4, "moduleRegisterExists": true,
    "importMetaUrl": "file://<scratchpad>/probe-plugin/main.mjs" } }
```

Reading of this:

- **a–d MEASURED.** Arbitrary filesystem read anywhere the OS user can read; arbitrary process
  spawn; writable `TMPDIR`. `/usr/bin/say` produced real audio bytes, so a macOS TTS subprocess
  works from the worker today.
- **b MEASURED, with a nuance the team must not miss.** `process.env.HOME` in the worker is
  whatever the *host process* resolved — under the E2E fixture that is the isolated home, so the
  `~`-relative lookup failed while the absolute path succeeded. In a normal ORCA run `HOME` is the
  real home. The point is that access is **not path-restricted**; only the `HOME` value differed.
- **e MEASURED.** Full network. Loopback listen + fetch, and outbound TLS to the public internet.
  Cloud TTS from the worker is unblocked.
- **f MEASURED.** `process.permission === undefined` (no Node permission model), `execArgv: []`,
  and the env is the 7-key allowlist. `grantedCapabilities` is informational only — none of the
  above required any of them.
- **g MEASURED.** `createRequire` resolves `node:fs` normally, the require cache holds only 4
  entries, and the plugin module loads from its dev directory by plain `file://` URL. **No
  require-patch, no ESM loader hook.** This closes open question 9 in `orca-plugin-api.md`.

**Where the logs land: nowhere on disk. MEASURED + source.** `orca.log()` and the worker's piped
stdout/stderr both append to `PluginLogBuffer`, a `Map` of 200-line ring buffers held in main-process
memory (`src/main/plugins/plugin-log-buffer.ts:3-20`; stdout piped at
`src/main/plugins/plugin-host-process.ts:101`). The only reader is the `plugins:getLogs` IPC handler
(`src/main/ipc/plugins.ts:243-245`) → `window.api.plugins.getLogs({ pluginKey })` → the Settings →
Plugins log pane (`src/renderer/src/components/settings/use-plugin-logs.ts:60`). It is **not** in
`PLUGIN_METHODS`, so headless `orca serve` cannot read plugin logs at all. Verbatim retrieval:

```json
[ { "ts": 1787240688005, "level": "info", "line": "probe worker activated; pid=95781" },
  { "ts": 1787240701711, "level": "info", "line": "EVENT worktree.created {\"worktreeId\":\"...\"}" } ]
```

**Consequence for us:** debugging is via the Settings UI or a `getLogs` call, and it truncates at
200 lines. A TTS plugin that wants durable logs must write its own file from the worker (which it
can — see E1d).

## E2 Panel `speechSynthesis` and audio — **MEASURED, speech works, media loading does not**

The probe panel ran inside the real sandboxed iframe mounted by `PluginPanel.tsx`. Verbatim
(`probe-out/e2-panel-report*.json`, one run's fields merged for readability):

```json
{
  "origin": "null",
  "href": "about:srcdoc",
  "userAgentHasElectron": true,
  "cspMeta": "default-src 'none'; connect-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'",

  "speechSynthesisDefined": "object",
  "SpeechSynthesisUtteranceDefined": "function",
  "voicesSync": { "length": 0, "first5": [] },
  "voiceschangedFired": true,
  "voicesAfterEvent": { "length": 180, "first5": [
      { "name": "Samantha", "lang": "en-US", "localService": true, "default": true },
      { "name": "Albert",   "lang": "en-US", "localService": true, "default": false },
      { "name": "Alice",    "lang": "it-IT", "localService": true, "default": false },
      { "name": "Alva",     "lang": "sv-SE", "localService": true, "default": false },
      { "name": "Amélie",   "lang": "fr-CA", "localService": true, "default": false } ] },
  "voicesAfter1s": { "length": 180 },

  "speakCalledAt": 1787240929578,
  "utteranceEvents": [ { "ev": "start", "t": 1787240929586 },
                       { "ev": "boundary" }, { "ev": "boundary" },
                       { "ev": "boundary" }, { "ev": "boundary" },
                       { "ev": "end", "t": 1787240931208 } ],
  "pendingAfterSpeak": false, "speakingAfterSpeak": true,
  "speakingAt500ms": true,   "pendingAt500ms": false,
  "speakingAt4s":  false,    "pendingAt4s":  false,

  "audioCtor": { "ok": true, "canPlayWav": "maybe", "canPlayMpeg": "probably" },
  "AudioContextDefined": "function",
  "audioContext": { "constructed": true, "stateAtConstruct": "running", "sampleRate": 48000 },
  "gestureResult": { "stateAfterResume": "running",
                     "currentTimeStart": 6.997333333333334,
                     "currentTimeLater": 7.6, "clockAdvanced": true },

  "mediaLoad": { "dataUri": "error/blocked: 4",
                 "blobUri": "error/blocked: 4",
                 "blobUrlCreated": "blob:null/d0c6d6ba-2" },
  "cspViolations": [ { "directive": "media-src", "blockedURI": "data" },
                     { "directive": "media-src", "blockedURI": "blob" } ]
}
```

Answering the brief point by point:

- **(a) MEASURED.** `window.speechSynthesis` is defined (`typeof === "object"`), and
  `SpeechSynthesisUtterance` is a constructor.
- **(b) MEASURED.** `getVoices()` is **0 synchronously** and **180 after `voiceschanged`**. Any
  implementation that calls `getVoices()` once at startup will see an empty list and conclude
  wrongly. Voices are the real macOS system voices (Samantha/Albert/Alice/Alva/Amélie, all
  `localService: true`) across many locales.
- **(c) MEASURED.** `speak()` fired `onstart` at +8 ms, four `onboundary` events, and `onend` at
  +1,630 ms. **`onerror` never fired.** `speechSynthesis.speaking` was `true` immediately and at
  500 ms, `false` at 4 s.
- **(d) Audible playback: NOT-TESTED.** This ran headless on a CI-style harness with no audio
  capture; I cannot claim I heard it. What I *can* claim, and do: the synthesizer engine ran. A
  no-op stub does not emit four word-boundary events, does not hold `speaking === true` for over a
  second, and does not take 1,672 ms — a plausible real-time duration for "testing one two three".
  **Someone should still confirm audibly on a desktop run before this is load-bearing.**
- **(e) MEASURED, and better than expected.** `AudioContext` constructs with
  `state === "running"` *with no user gesture at all*. After a real click + `resume()`, it stayed
  `running` and `currentTime` advanced 6.997 → 7.600 s, i.e. the audio graph clock is actually
  ticking, not suspended. `new Audio()` constructs and reports `canPlayType('audio/mpeg') ===
  "probably"`.
- **(f) MEASURED.** `document.location.origin === "null"` (opaque origin), `href` is
  `about:srcdoc`, and the injected CSP is exactly `PLUGIN_PANEL_CSP`. The CSP violation console
  **does** show up — but only for media loads, never for `speechSynthesis`.
- **Extra, and decisive for the cloud-TTS option: MEASURED.** Assigning `audio.src` to a
  `data:audio/wav;base64,…` URI *and* to a `URL.createObjectURL(blob)` both raise
  `securitypolicyviolation` with `effectiveDirective: "media-src"`, and `MediaError.code` is `4`
  (`MEDIA_ERR_SRC_NOT_SUPPORTED`). The panel can create a blob URL (`blob:null/d0c6d6ba-2`) but
  cannot load it.

**Architectural consequence.** CSP governs resource *loads*, not JS APIs — confirmed by
measurement, in both directions in the same document. A panel that calls `speechSynthesis.speak()`
needs **zero capabilities, zero Node access, and no subprocess**, and is immune to the future
`net:fetch` / `process:exec` confinement named in `plugin-capabilities.ts:12`. A panel that wants to
play *bytes* — from any cloud TTS, or any local neural engine — cannot, by construction.

## E3 `paneKey` → transcript correlation — **MEASURED payload, gap CONFIRMED**

**(a) MEASURED — the payload shape, exactly four fields.** I drove ORCA's own agent-hook endpoint
(`POST http://127.0.0.1:<port>/hook/codex`, both posts returned `204`) so the event travelled the
real emit path, then dumped what the worker received:

```json
{ "event": "agent.status.changed", "receivedAtWorker": 1787240802596,
  "payloadKeys": ["worktreeId","paneKey","state","receivedAt"],
  "payload": {
    "worktreeId": "60b2abf6-5f25-4395-abd0-c86d2a5b8b67::/private/var/folders/.../orca-e2e-repo-eVR7EC",
    "paneKey": "f8bd2bc7-da92-40d3-8b25-f08d3a55aae8:11111111-2222-4333-8444-555555555555",
    "state": "working", "receivedAt": 1787240802593 } }

{ "event": "agent.status.changed", "receivedAtWorker": 1787240805601,
  "payloadKeys": ["worktreeId","paneKey","state","receivedAt"],
  "payload": { "worktreeId": "60b2abf6-...::/private/var/.../orca-e2e-repo-eVR7EC",
    "paneKey": "f8bd2bc7-...:11111111-2222-4333-8444-555555555555",
    "state": "done", "receivedAt": 1787240805600 } }
```

No extra fields. Critically: the `done` post carried
`last_assistant_message: "PROBE-SECRET-REPLY-TEXT: the reply we want to speak."` and **that string
appears nowhere in what the plugin received**. The strip is real, not just declared.

For comparison, `worktree.created` (also MEASURED) carries three fields:

```json
{ "event": "worktree.created", "payloadKeys": ["worktreeId","path","branch"],
  "payload": { "worktreeId": "99cae00b-...::/private/var/.../tts-probe-1787240701503",
    "path": "/private/var/.../orca-e2e-repo-xfzZcd/tts-probe-1787240701503",
    "branch": "refs/heads/tts-probe-1787240701503" } }
```

**(b) MEASURED — `paneKey` is structured, but not usefully so.** It is
`<tabId>:<layoutLeafId>`, both UUIDs (`makePaneKey`, `src/shared/stable-pane-id.ts:22-30`; real
values above). It encodes **no** worktree id, **no** provider session id, **no** agent id, and **no**
transcript path. The tabId half is an ORCA tab UUID; the leaf half is a layout-leaf UUID.

**`worktreeId` is the actually-useful field, and it is richer than the name suggests.** MEASURED:
its value is `<repoId>::<absolute worktree path>`. That absolute path is a real, deterministic
handle a worker can use — it maps onto a Claude project slug (the real home listing showed slugs of
exactly that shape: `-Users-m5air`, i.e. the path with separators replaced).

**(c) MEASURED — no deterministic pane-level mapping exists. It is a heuristic, and I will say so
plainly.** Three measurements bound the answer:

- The event gives `worktreeId` (→ absolute path → project slug) and `paneKey` (→ nothing on disk).
- `workspace.readContext` from the worker returns `{branch, displayName, terminals:[{id}]}` — and
  its terminal `id`s are *not* paneKeys. MEASURED verbatim from `probe-host`:

  ```json
  { "workspace.readContext": { "ok": true, "value": null },
    "storage.keys":          { "ok": true, "value": { "keys": [] } },
    "settings.get":          { "ok": false, "error": "plugin does not have the \"settings:own\" capability" },
    "events.subscribe":      { "ok": true, "value": { "subscribed": ["agent.status.changed"] } },
    "nativeChat.subscribe":  { "ok": false, "error": "unknown host method: nativeChat.subscribe" },
    "selection.read":        { "ok": false, "error": "unknown host method: selection.read" },
    "clipboard.read":        { "ok": false, "error": "unknown host method: clipboard.read" },
    "terminal.readOutput":   { "ok": false, "error": "unknown host method: terminal.readOutput" } }
  ```

  (`readContext` returned `null` because no worktree was focused at that instant — the call itself
  succeeded. The four `unknown host method` lines are the decisive part: they confirm by
  measurement that `nativeChat.subscribe`, `selection.read`, `clipboard.read`, and
  `terminal.readOutput` do not exist on the plugin host surface.)
- ORCA's own resolver prefers the hook-reported `providerSession.transcriptPath` and otherwise globs
  `~/.claude/projects/*/<sessionId>.jsonl` (`src/main/native-chat/session-file-resolver.ts:76-95`).
  **Both inputs — `transcriptPath` and `sessionId` — are exactly the fields the projection strips.**

So: **worktree → project slug is deterministic; slug → *which* session is not.** A worker's only
discriminator is most-recently-modified `.jsonl` under the slug. That is a heuristic, full stop.

**(d) Two agents in one worktree: NOT-TESTED.** I could not run two live agent CLIs — the E2E
fixture uses an isolated `HOME` with no agent credentials, so no real `claude`/`codex` session could
start. What is MEASURED and bears on it: both panes would emit the *same* `worktreeId` (it is
derived from the worktree, not the pane), so both map to the same project slug, and the only
distinguishing field — `paneKey` — has no on-disk counterpart. The most-recently-modified heuristic
has nothing left to discriminate on. I am not calling that a measured break; a human should treat it
as untested and, if it matters, test it with two real agents.

## E4 Hotkeys and commands — **MEASURED: registers and fires, but not in a terminal**

**Registration MEASURED.** The manifest declared
`{"command": "probe-hotkey", "key": "Mod+Alt+Shift+P", "when": "global"}`. `plugins.list()` after
consent:

```json
{ "id": "probe-hotkey", "title": "Probe: Hotkey fired", "context": "global",
  "handler": { "type": "worker" },
  "keybindings": [ { "key": "Mod+Alt+Shift+P", "when": "global" } ] }
```

`status: "running"`, `hasWorker: true`.

**Firing MEASURED — and the result is a hard constraint.** I pressed the same physical chord twice
in the same session, differing only in focus:

```json
// focus on the app shell (document.activeElement.className === "")
{ "preCount": 2, "postCount": 3, "firedFromAppFocus": 1 }

// focus moved into a terminal (document.activeElement.className === "xterm-helper-textarea")
{ "beforeTerm": 3, "afterTerm": 3, "firedFromTerminalFocus": 0 }
```

and the worker's own log line for the successful case:

```
probe-hotkey command fired: {"firedAt":1787240809626,"args":null}
```

**What the user must press:** `Cmd+Option+Shift+P` on macOS (`Mod` → `Cmd` on darwin,
`Ctrl` elsewhere) — **and focus must be in the app chrome, not in a terminal pane.**

This is exactly what the dispatch code says: plugin chords are only consulted when
`getKeybindingContext(event.target) === 'app'`, and that helper returns `'terminal'` for anything
with the `xterm-helper-textarea` class
(`src/renderer/src/app-shell/use-global-keybindings.ts:219-232`,
`src/renderer/src/app-shell/app-command-handlers.ts:67-71`). The comment there is explicit:
*"Plugin chords … win over built-in defaults only in app focus; terminal/editor/browser handlers
retain their own shortcut authority."*

**Global (app-unfocused) shortcuts: MEASURED as impossible.** `grep -rn "globalShortcut" src`
returns zero hits across the whole tree — Electron's `globalShortcut` module is never imported, so
there is no OS-level hotkey for plugins *or* for ORCA itself. `when: "global"` means app-global.

**Consequence for "speak selection".** An ORCA user spends their time with focus inside a terminal
pane. A plugin hotkey is dead there. Combined with `selection.read` returning
`unknown host method` (E3c), **"speak selection" is not reachable through the plugin API by two
independent measured barriers**, not one.

**Bonus MEASURED gotcha:** a command handler registered in `main.mjs` but not declared in
`contributes.commands` is rejected at invoke time —
`Error: plugin orca-tts-probe.tts-probe does not contribute command probe-host`. Manifest and code
must agree.

## E5 Dev loop runbook — **MEASURED**

### The runbook that actually worked

```bash
# 0. prerequisites: git, Node (24 per package.json; 26.7.0 also worked), pnpm 10.24.0
#    No corepack on this machine, so: alias pnpm to `npx pnpm@10.24.0`, or install it globally.
#    The E2E global-setup shells out to a bare `pnpm`, so pnpm MUST be on PATH by that name.

# 1. clone at a pinned commit
git clone https://github.com/stablyai/orca
cd orca && git checkout 0f26ff4ad83e9ca736f6ad3bae6937cd0cdab7fc

# 2. install (~3 min here; postinstall downloads the Electron binary)
pnpm install

# 3. author the plugin anywhere on disk
#    <probe>/orca-plugin.json  +  main.mjs  +  panel.html   (copy examples/plugins/hello-orca/)

# 4a. GUI path
pnpm dev                       # electron-vite; userData = ~/Library/Application Support/orca-dev
#    Settings → Plugins → enable the plugin system, add the dev path, Review & enable.

# 4b. scripted path (what I used — isolated, repeatable, no GUI clicking)
pnpm exec playwright test tests/e2e/<your>.spec.ts \
  --config tests/playwright.config.ts --project electron-headless --workers=1
#    SKIP_BUILD=1 skips the rebuild on repeat runs.
#    ORCA_E2E_FORCE_HEADFUL=1 shows the window if you want to watch.
```

Inside the spec, the whole enable → consent → invoke cycle is three IPC calls, no UI:

```ts
await window.api.settings.set({ pluginSystemEnabled: true, devPluginPaths: [PROBE_PATH] })
const entry = (await window.api.plugins.refresh()).find(e => e.pluginKey === PLUGIN_KEY)
await window.api.plugins.consent({
  pluginKey: PLUGIN_KEY, reviewedFingerprint: entry.consentFingerprint, decision: 'approve'
})
await window.api.plugins.invokeCommand({ pluginKey: PLUGIN_KEY, commandId: 'probe-node' })
const logs = await window.api.plugins.getLogs({ pluginKey: PLUGIN_KEY })
```

### The headless path: **tried, and it does not close the loop**

`orca serve` exposes `plugins.list`, `plugins.consent`, `plugins.setEnabled`, `plugins.panelAction`,
`plugins.readPanelEntry`, `plugins.invokeCommand` over runtime RPC
(`src/main/runtime/rpc/methods/plugins.ts:80-153`), and the comment at `src/main/index.ts:2857-2859`
confirms consent parity with the desktop dialog. **But `plugins.getLogs` is not in that list**, so
a headless run cannot read plugin logs, and a panel is never rendered headlessly — `readPanelEntry`
returns HTML, it does not execute it. So E2 was impossible headlessly and E1 debugging would have
been blind. I used the Electron E2E harness instead: it is headless in the sense that matters (no
visible window, `ORCA_E2E_HEADLESS=1`, fully isolated profile) while still being a real renderer.

### What I measured about reload — read this part carefully

`probe-out/e5-hot-reload-timeline.json`, plugin **with** a `keybindings` contribution:

```json
[ { "step": "discovered",        "status": "pending", "needsReconsent": false,
    "consentFingerprint": "sha256-vaQ0VIKm1TBQ7T70saKkCIFLKxCiU5yP5yRX2W6HqyE=" },
  { "step": "after-consent",     "status": "idle",    "needsReconsent": false,
    "consentFingerprint": "sha256-vaQ0VIKm1TBQ7T70saKkCIFLKxCiU5yP5yRX2W6HqyE=" },
  { "step": "invoke-1",          "buildMarker": "MARKER_V1" },
  { "step": "after-panel-edit",  "status": "pending", "needsReconsent": true,
    "consentFingerprint": "sha256-YJOkez39fa2zhUCd5Gy8LDB9pOU7QNOTKvVL9XJXV1o=" },
  { "step": "after-worker-edit", "status": "pending", "needsReconsent": true,
    "consentFingerprint": "sha256-DJfvjkM2y2obbgn5RM6G4UrfDV9GX3FxJCS4amEOmsU=" },
  { "step": "after-reconsent",   "status": "idle",    "needsReconsent": false,
    "consentFingerprint": "sha256-DJfvjkM2y2obbgn5RM6G4UrfDV9GX3FxJCS4amEOmsU=" },
  { "step": "invoke-2",          "buildMarker": "MARKER_V2", "invokeError": null } ]
```

Editing `panel.html` — one string, no manifest change — **disabled the plugin**. Its mounted panel
iframe disappeared (`locator('#hdr')` timed out after 30 s where it had resolved seconds earlier),
`readPanelEntry` began returning `null`, and a command invoke failed with
`Error: plugin orca-tts-probe.tts-probe is not enabled`.

`probe-out/e5-hot-reload-nokb.json`, the same plugin with `contributes.keybindings` **removed**:

```json
[ { "step": "discovered",        "status": "pending", "consentFingerprint": "sha256-ZuKTaf3IpJyW2E7uCIl3PP7TyYvPg6zZF8gPVQC64XA=" },
  { "step": "invoke-1",          "buildMarker": "MARKER_V1", "status": "running",
    "consentFingerprint": "sha256-ZuKTaf3IpJyW2E7uCIl3PP7TyYvPg6zZF8gPVQC64XA=" },
  { "step": "after-worker-edit", "status": "running", "needsReconsent": false,
    "consentFingerprint": "sha256-ZuKTaf3IpJyW2E7uCIl3PP7TyYvPg6zZF8gPVQC64XA=" },
  { "step": "invoke-2",          "buildMarker": "MARKER_V1", "invokeError": null },
  { "step": "invoke-3-after-disable-enable", "buildMarker": "MARKER_V3" } ]
```

(`invoke-2` was captured before the toggle; `invoke-3` after.) Two separate facts fall out:

1. **The fingerprint only churns when the manifest declares instructional contributions.** With no
   `keybindings`, the fingerprint was byte-identical across edits and the plugin stayed `running`.
   The mechanism is visible in `src/shared/plugins/plugin-consent-fingerprint.ts:29-33`: the tree
   content identity is folded in **only** when `contributes.keybindings | vmRecipes | agents` is
   non-empty. **A TTS plugin wants a keybinding, so it opts into the churn.**
2. **There is no worker hot-reload at all.** With a stable fingerprint, `main.mjs` was edited and
   the running worker kept returning `MARKER_V1` — old code — indefinitely. It only picked up
   `MARKER_V3` after `setEnabled(false)` → `setEnabled(true)` forced a re-fork. The Parcel dev
   watcher (`src/main/plugins/plugin-dev-watcher.ts:30-38`) re-runs *discovery* on a 300 ms debounce;
   discovery re-reads the manifest and panel artifacts, it does not restart a live worker.

**So the honest dev loop for worker code is: edit → force a worker restart → invoke.** Either
disable/enable the plugin, or re-consent (if your manifest churns), or restart the app. Panel edits
propagate to `readPanelEntry` on their own, but if your manifest declares keybindings the plugin is
disabled at that moment anyway.

### Per-OS paths (macOS MEASURED; the others read from source, NOT-TESTED)

| | userData root |
|---|---|
| macOS packaged | `~/Library/Application Support/orca` |
| macOS `pnpm dev` | `~/Library/Application Support/orca-dev` |
| Windows packaged | `%APPDATA%\orca` |
| Linux packaged | `$XDG_CONFIG_HOME/orca`, else `~/.config/orca` |

Source: `getDefaultUserDataPath` (`src/cli/runtime/metadata.ts:41-70`) and
`configureDevUserDataPath` (`src/main/startup/configure-process.ts:153-185`, which does
`app.setPath('userData', join(app.getPath('appData'), 'orca-dev'))` in dev, *"without a dev-only
path, pnpm dev overwrites the packaged app's runtime pointer"*). Overrides:
`ORCA_USER_DATA_PATH` (CLI), `ORCA_DEV_USER_DATA_PATH` (dev main), `ORCA_E2E_USER_DATA_DIR` (E2E).

Settings — including `pluginSystemEnabled` and `devPluginPaths` — persist to
`<userData>/orca-data.json` (`src/main/persistence/loading-store/user-data-path.ts:16`). Installed
plugins live at `<userData>/plugins/<publisher>.<id>/{current,<hash>/}`
(`src/main/plugins/plugin-discovery.ts:26-36`). I set the settings through the IPC API rather than
by hand-editing that file, so **hand-editing `orca-data.json` while ORCA is running is
NOT-TESTED** — and given the app holds the store in memory and rewrites it, I would not assume it
works.

## E6 Panel ↔ worker bridge — **MEASURED: no channel exists**

Not in the original brief, but finding 2 made it load-bearing: if synthesis lives in the panel and
text acquisition lives in the worker, something has to carry text from one to the other. I had the
panel `postMessage` six candidate actions over the bridge and recorded every reply verbatim
(`probe-out/e2-panel-report-after-gesture.json`, field `bridge`):

```json
{
  "workspace.readContext": { "ok": true, "value": {
      "branch": "refs/heads/main", "displayName": "main",
      "terminals": [ { "id": "term_095940c5-3dce-486e-afab-906d5099b1dd" } ] } },
  "notifications.show":    { "ok": true, "value": { "delivered": true } },

  "storage.get":           { "ok": false, "errorCode": "invalid_request", "error": "action: not a panel-callable action" },
  "events.subscribe":      { "ok": false, "errorCode": "invalid_request", "error": "action: not a panel-callable action" },
  "commands.invoke":       { "ok": false, "errorCode": "invalid_request", "error": "action: not a panel-callable action" },
  "plugin.invokeCommand":  { "ok": false, "errorCode": "invalid_request", "error": "action: not a panel-callable action" }
}
```

- **MEASURED: the panel can call exactly three host methods** — `workspace.readContext`,
  `notifications.show`, and (untested here but in the same `panel: true` set) `terminal.sendText`.
  The allowlist is derived from the spec table so it cannot drift
  (`src/shared/plugins/plugin-host-api.ts:262-269`).
- **MEASURED: the panel cannot invoke its own plugin's commands.** Both spellings I tried were
  rejected as non-panel actions. There is no worker-facing verb on the bridge at all.
- **MEASURED: `storage` is not a shared mailbox.** `storage.get` is worker-only, so the obvious
  "worker writes, panel polls" workaround is closed.
- **Source corroboration for the reverse direction:** the bridge defines four message types —
  `orca-panel-action`, `orca-panel-action-result`, `orca-panel-ping`, `orca-panel-pong`
  (`src/shared/plugins/plugin-panel-bridge.ts:15-18`). The only host→panel frames are the watchdog
  ping and the result of a call the panel itself started. Nothing pushes.
- **Bonus, and it settles E3c:** `workspace.readContext().terminals[].id` is
  `term_095940c5-3dce-486e-afab-906d5099b1dd` — an ORCA terminal handle, **not** a `paneKey` and not
  a session id. There is no bridge from the event's `paneKey` to anything the host API will name.

**Consequence.** The three architectures the measurements leave standing are:
(1) **panel-only** — panel does synthesis, but has no source of agent text (`connect-src 'none'`,
no filesystem, no worker channel); (2) **worker-only** — worker gets the text and spawns an OS TTS
binary, which works today but is outside the capability model; (3) **upstream a channel** — a
`panel.postMessage`-equivalent host method, which is a change to ORCA. Nothing measured lets a
plugin do (1) and (2) together as one plugin today.

## Corrections to `orca-plugin-api.md`

The source-read holds up unusually well. Everything I could check that it labelled VERIFIED, was.
Corrections and sharpenings, bluntest first:

1. **"Audio cannot be played from a plugin panel" is wrong as stated, and it is the most
   consequential error in the document.** *Loading* audio is blocked — I measured the `media-src`
   violations, so that half is right. But `speechSynthesis.speak()` is not a resource load, and it
   works completely: 180 real system voices, full event lifecycle, no violation. The document's own
   open question 10 anticipated this; the verdict bullet at the top does not, and a reader who only
   reads the verdict will build the wrong architecture. **"Playback must happen in the worker (a
   subprocess) or not at all" should read "playback of *supplied audio bytes* must happen in the
   worker; OS speech synthesis works in the panel with zero capabilities."**
2. **"The recommended path is the worker's filesystem access" is now premature.** It was the right
   recommendation given what was known. With E2 measured, the panel-`speechSynthesis` path is
   strictly less fragile — it needs no capability, no subprocess, no `~/.claude` read, and survives
   the future `net:fetch`/`process:exec` confinement the document rightly flags as risk 4. The
   worker is still needed to *get the text*; it is no longer needed to *make the sound*.
3. **Open question 9 (worker module-loader interception) is settled: there is none.** MEASURED —
   `createRequire` works, the require cache is 4 entries deep, no loader hook. The document's
   INFERRED "high confidence" was correct. Delete the risk.
4. **The document says nothing about the dev-loop de-consent trap, and it is a serious omission for
   requirement R2.** MEASURED: with a `keybindings` contribution, *every file edit* disables the
   plugin pending re-consent. And there is no worker hot-reload at all, with or without keybindings.
   "manifest/panel hot-reload via a Parcel watcher … **This is how we will develop**" oversells what
   that watcher does — it re-runs discovery, it does not reload worker code.
5. **`agent.status.changed`'s `worktreeId` is more useful than the document implies.** It is not an
   opaque id: MEASURED, its value is `<repoId>::<absolute worktree path>`. The document treats the
   correlation problem as total; in fact worktree→project-slug is deterministic and only the
   session-within-slug step is a heuristic. That is a meaningfully smaller gap than "no plugin-visible
   payload carries anything useful".
6. **Plugin logging deserved a line and did not get one.** There is no log file. It is a 200-line
   in-memory ring, readable only through `plugins:getLogs` on the desktop IPC surface, and **absent
   from the headless RPC method table** — so `orca serve` cannot debug a plugin at all.
7. **The hotkey limitation is understated.** The document correctly says app-global ≠ OS-global. It
   does not say that plugin chords are additionally dead whenever focus is in a terminal pane —
   which, in ORCA, is most of the time. MEASURED: fires with app focus, does not fire with
   `xterm-helper-textarea` focus.
8. Minor, worth noting so nobody trips: a command handler registered in the worker but absent from
   `contributes.commands` is rejected at invoke time with `does not contribute command <id>`.

## Still unknown

- **Audible output.** E2's evidence is event-based and timing-based, not acoustic. Headless CI has
  no speaker and I captured no audio. Someone should run `pnpm dev` on a desktop and listen once.
  I would not ship the architecture on 1,672 ms of `speaking === true` alone, even though I believe it.
- **Two agents in one worktree (E3d).** Not runnable — the isolated E2E `HOME` has no agent
  credentials, so no live `claude`/`codex` session could start. Needs a real desktop session with
  two agents in one worktree.
- **A live agent CLI end to end.** Every `agent.status.changed` I measured came from a hand-driven
  POST to ORCA's own hook endpoint. That is the same code path ORCA uses for real agents (the hook
  *is* how ORCA learns status), and both posts returned `204` — but a genuine `claude` session was
  never in the loop, so any field a real hook populates that mine did not is unmeasured.
- **The 5-minute idle worker reap.** Not exercised; no probe waited that long. Its effect on a
  long-lived audio pipeline is still only a source-level claim
  (`PLUGIN_WORKER_IDLE_REAP_MS`, `plugin-host-protocol.ts:110-112`).
- **Windows and Linux.** Everything here is macOS 26.5 / arm64. `/usr/bin/say` obviously has no
  counterpart elsewhere; whether Electron's `speechSynthesis` returns a non-empty `getVoices()` on
  Windows (SAPI) and Linux (speech-dispatcher) is **unmeasured and is now the single most important
  open question**, because requirement R1 demands cross-platform parity and finding 2 is the whole
  architecture. A Linux CI box with no speech-dispatcher installed would return zero voices.
- **`orca serve` / relay parity for a worker doing filesystem reads.** I confirmed the RPC surface
  exists but never ran a headless server with a plugin loaded end to end.
- **Hand-editing `orca-data.json` to set `devPluginPaths` while ORCA runs.** I used the IPC path
  instead; the file-edit path is untested and probably races the in-memory store.
- **A worker→panel channel that does not exist yet.** E6 measured that none of the obvious ones
  work. What is *not* measured is whether some indirect path exists (e.g. the host re-rendering a
  panel's `srcdoc` when the plugin's own on-disk panel file changes, which the dev watcher does but
  a shipped immutable install cannot). Someone should decide whether to design around this or
  upstream a `panel.postMessage`-style host method — the architecture hinges on it.
