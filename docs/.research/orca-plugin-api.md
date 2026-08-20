# ORCA plugin API — ground truth for a TTS plugin

Research artifact. Phase 0. Every non-obvious claim carries a `path:line` citation into the ORCA
source tree at the commit named under "Repo facts". Claims are labelled **VERIFIED** (read in
source) or **INFERRED** (reasoned from verified facts, not directly observed).

Paths are relative to the ORCA repo root.

## Verdict

- **Yes, ORCA has a real plugin system** — manifest-declared, out-of-process, capability-gated,
  with panels, commands, keybindings, and events. It is EXPERIMENTAL and **off by default**
  (`pluginSystemEnabled: false`, `src/shared/constants.ts:319`). VERIFIED.
- **The plugin API cannot give us agent reply text.** The event set is closed to three events and
  the `agent.status.changed` payload is a four-field projection that deliberately strips message
  content (`src/shared/plugins/plugin-events.ts:28-39`). The host API is thirteen methods, none of
  which read a terminal, a chat, or a transcript (`src/shared/plugins/plugin-host-api.ts:122-253`).
  VERIFIED.
- **But ORCA internally has exactly the model we want** — `NativeChatMessage` with typed
  `text` / `tool-call` / `tool-result` / `image-ref` blocks, assembled from on-disk JSONL
  transcripts and live-tailed with a 40 ms debounce (`src/shared/native-chat-types.ts:61-80`).
  It is renderer-facing IPC only, walled off from plugins by construction. VERIFIED.
- **The viable path is the plugin worker's filesystem access.** A plugin declaring `main` gets a
  forked plain-Node child with `execArgv: []`, no Node permission model, and `HOME` in its env
  (`src/main/plugins/plugin-host-process.ts:88-99`, `src/main/plugins/plugin-worker-env.ts:8-27`).
  It can tail `~/.claude/projects/**/*.jsonl` itself and spawn a TTS binary. This is a supported
  capability of the sandbox as built, not an exploit — but it is **outside** the capability model,
  so it is fragile against the roadmap. VERIFIED (primitives) / INFERRED (the composition).
- **Audio cannot be played from a plugin panel.** Panel CSP is `default-src 'none'` with no
  `media-src` and `connect-src 'none'` (`src/shared/plugins/plugin-panel-shell.ts:20-22`), in an
  `sandbox="allow-scripts"` iframe with no `allow` attribute
  (`src/renderer/src/components/right-sidebar/PluginPanel.tsx:220-232`). Playback must happen in
  the worker (a subprocess) or not at all. VERIFIED.

**Bottom line for the two headline features.**

- **"Speak selection" is not implementable through the plugin API.** No selection read exists, no
  clipboard read exists, and `globalShortcut` is used nowhere in ORCA — so there is no OS-level
  hotkey either. An in-app chord plus a new upstream `selection.read` host method would be required.
- **"Huddle / auto-speak streaming replies" is achievable only via the worker's filesystem access**,
  and the correlation from the plugin's `paneKey` to a transcript file is an **unsolved gap** — no
  plugin-visible payload carries a sessionId or transcript path.

**Also worth knowing up front:** ORCA already ships a complete first-party *speech-to-text* stack
(`src/main/speech/`, ~5.7k LOC, local Whisper plus OpenAI) with a dictation UI, a `Mod+E` shortcut,
and a Voice settings pane — but **zero** text-to-speech. It built voice as main-process code with a
settings pane, not as a plugin. That is the strongest available signal about where a TTS feature
naturally belongs. MCP is not an in-app alternative: ORCA neither hosts nor spawns MCP servers.

## Repo facts

| Fact | Value |
|---|---|
| Repo | `https://github.com/stablyai/orca` (public, MIT) |
| Commit read | `0f26ff4ad83e9ca736f6ad3bae6937cd0cdab7fc` (2026-08-20, "Update README downloads badge") |
| Version | `1.4.178-rc.2` (`package.json:3`) |
| Language / runtime | TypeScript on Electron; Node 24, pnpm 10.24.0 (`package.json:283-286`) |
| What it is | "Next-gen IDE for parallel agentic development" — runs Claude Code, Codex, OpenCode, Pi etc. side by side, each in its own git worktree |

Top-level source layout (`src/`):

```
src/main/       Electron main process (incl. plugins/, speech/, native-chat/, agent-hooks/)
src/renderer/   React UI
src/preload/    contextBridge IPC surface
src/shared/     Electron-free code shared by main, CLI, relay, mobile (incl. plugins/)
src/relay/      remote/SSH/headless execution path
src/cli/        the `orca` CLI
```

Build and dev (`package.json`):

- `pnpm dev` — electron-vite dev server
- `pnpm build:desktop` — typecheck, relay, CLI, electron-vite, web client
- `pnpm test` — vitest (`config/vitest.config.ts`)
- `pnpm lint` — oxlint plus a battery of custom audits and ratchets
- Packaged as an Electron desktop app for macOS / Windows / Linux, plus an `orca` CLI bin and a
  headless `orca serve` runtime.

**No plugin API documentation exists in-tree.** `docs/` contains no plugin reference; the only
authority is the source and the two example plugins. VERIFIED.

## Plugin system

### Master switch

Off by default. `src/shared/global-settings-types.ts:301-303`:

```ts
/** Master switch for the experimental plugin system. Off by default: no
 *  discovery, no panels, no plugin code paths run at all. */
pluginSystemEnabled: boolean
```

Default `false` at `src/shared/constants.ts:319`. A user must opt in via Settings → Plugins
(`src/renderer/src/components/settings/PluginsSettingsSection.tsx`).

### Manifest

`orca-plugin.json` at the plugin root (`src/shared/plugins/plugin-manifest.ts:146`). Schema at
`plugin-manifest.ts:78-133`. Required: `manifestVersion: 1`, `id`, `publisher`, `name`, `version`
(semver), `engines.orca` (only the `">=x.y.z"` grammar, `:41-44`), `pluginApi: 1`.

Canonical identity is `<publisher>.<id>` (`plugin-manifest.ts:149-151`), which is also the install
directory name.

`contributes` is a **strict** object — an unknown key fails validation. The complete set
(`plugin-manifest.ts:99-130`):

| Key | Meaning | Limit |
|---|---|---|
| `panels` | sandboxed HTML panel in the right sidebar | 64 |
| `commands` | invokable command, worker-backed or a built-in alias | 256 |
| `events` | event subscriptions | 3 (the whole event set) |
| `languagePacks` | i18n catalogs | 16 |
| `keybindings` | key chord bound to one of this plugin's commands | 256 |
| `vmRecipes` | Multipass VM lifecycle recipes | 64 |
| `agents` | agent profile files | 64 |

Themes, icons, and skills were **deferred and now hard-reject** — a manifest declaring one fails to
install (`src/shared/plugins/plugin-marketplace.ts:14-25`). VERIFIED.

### Discovery

`src/main/plugins/plugin-discovery.ts:26-36` documents the layout:

```
<userData>/plugins/<publisher>.<id>/current    ← text file naming the content hash
<userData>/plugins/<publisher>.<id>/<hash>/    ← immutable install tree
```

Installs are hash-addressed and immutable. Dev plugins load from arbitrary local directories listed
in the `devPluginPaths` setting (`src/shared/global-settings-types.ts:312-313`,
`src/main/plugins/plugin-discovery.ts:220,238`), with manifest/panel hot-reload via a Parcel watcher
(`src/main/plugins/plugin-dev-watcher.ts:30-38`). **This is how we will develop.**

Discovery reads manifests and stats only the declared artifact paths — never whole trees — so
startup cost stays bounded (`plugin-discovery.ts:33-36`).

Distribution is git-based: a marketplace index (`orca-marketplace.json`) maps a qualified key to a
`{kind:'git', url, ref}` source that must resolve to an exact commit
(`src/shared/plugins/plugin-marketplace.ts:43-54`). Three official plugins ship bundled
(`resources/plugins/launch/`). Reserved `stablyai.orca-*` identities can only come from the
stablyai org (`src/main/plugins/plugin-install-trust.ts:8-26`).

### Consent and the capability model

Capabilities are a **closed set of seven** (`src/shared/plugins/plugin-capabilities.ts:15-23`):

```ts
export const PLUGIN_CAPABILITY_KINDS = [
  'workspace:read', 'terminal:send', 'notifications:show',
  'storage', 'secrets', 'events:subscribe', 'settings:own'
] as const
```

There is **no filesystem, network, or process-exec capability.** The header says scoped kinds
(`net:fetch` hosts, `process:exec` globs) "arrive in later phases" (`:12`) — they are not
implemented. VERIFIED.

Consent is fingerprinted over the capability set **plus whether the plugin runs Node code**
(`src/shared/plugins/plugin-consent-fingerprint.ts:24-36`):

```ts
const workerIdentity = manifest.main === undefined ? '' : '\0trusted-node-worker'
```

So adding `main` to a panel-only plugin re-prompts the user even with an unchanged capability list.
A changed fingerprint moves the plugin back to pending — an update cannot silently widen a grant.

The gate itself is pure and shared by desktop, headless serve, and relay
(`src/shared/plugins/plugin-capability-gate.ts:34-63`), deny-by-default, and returns
`consent_required` indistinguishably from `capability_denied` so plugin code cannot probe its own
enablement (`:46-54`).

### Lifecycle

**There is no `activate`/`deactivate` pair in the VS Code sense at the host level.** The worker
entry's default export IS the activate function, and an optional named `deactivate` export is called
on shutdown (`src/main/plugins/plugin-host-runtime.ts:83-91`, `:194`).

```ts
const activate = module?.default
if (typeof activate !== 'function') {
  throw new Error(`plugin entry ${input.mainEntry} has no default-exported activate function`)
}
deactivate = (module.deactivate as (() => unknown) | undefined) ?? null
```

Activation is **lazy** — the worker is forked on the first command invocation or event delivery, and
**idle-reaped after 5 minutes** with no in-flight work, then re-forked on the next trigger
(`src/shared/plugins/plugin-host-protocol.ts:110-112`). At most 5 workers run concurrently by
default (`:114`).

> **Risk for a huddle-mode TTS plugin: the 5-minute idle reap.** A long-lived audio pipeline held in
> worker memory does not survive it. Any playback queue must be reconstructible from `storage.*` or
> owned by a detached subprocess. INFERRED from `PLUGIN_WORKER_IDLE_REAP_MS`.

### The worker process

`src/main/plugins/plugin-host-process.ts:88-99`:

```ts
const child: ChildProcess = fork(entryPath, [], {
  // Why: ELECTRON_RUN_AS_NODE makes the forked Electron binary behave as
  // plain Node. The env is a scrubbed allowlist — never ...process.env,
  // which can carry shell-exported secrets into third-party code.
  env: buildPluginWorkerEnv(),
  // Why: inspector/loader flags from Orca's own launch must never execute
  // inside third-party plugin workers.
  execArgv: [],
  serialization: 'advanced',
  stdio: ['ignore', 'pipe', 'pipe', 'ipc']
})
```

Env is an allowlist that includes `PATH`, `HOME`, `USERPROFILE`, `TMPDIR`
(`src/main/plugins/plugin-worker-env.ts:8-27`). `execArgv: []` means **no Node permission model** —
no `--experimental-permission`, no `--allow-fs-read`. The plugin module is loaded with a bare
dynamic `import()` (`plugin-host-runtime.ts:56`), and the capability gate only guards
`executeHostCall`. VERIFIED.

**INFERRED (high confidence):** a plugin worker can `import('node:fs')`, `import('node:child_process')`,
and use `fetch` freely. Nothing intercepts Node core module resolution.

Timeouts (`plugin-host-protocol.ts:108-114`): ready 10 s, invoke 30 s.

## API surface

### What a plugin's `activate` receives

The complete `orca` object, `src/main/plugins/plugin-host-runtime.ts:18-36`:

```ts
/** API surface handed to a plugin's `activate(orca)` export. Everything is
 *  EXPERIMENTAL until pluginApi v1 freezes. */
export type PluginWorkerOrcaApi = {
  /** Register the handler for a command declared in the manifest. */
  commands: {
    register(commandId: string, handler: (args: unknown) => unknown): void
  }
  /** Handle an event the manifest subscribed to (`contributes.events`). */
  events: {
    on(event: PluginEventName, handler: (payload: unknown) => void | Promise<void>): void
  }
  /** Call a host API method (capability-gated host-side). */
  host: {
    call(method: string, params?: unknown): Promise<unknown>
  }
  /** Consented capability kinds (informational — the host re-gates). */
  grantedCapabilities: readonly string[]
  log(message: string): void
}
```

That is the entire SDK. Four members.

### Host API v0 — the complete method table

`src/shared/plugins/plugin-host-api.ts:122-253`. Thirteen methods, no others:

| Method | Capability | Panel-callable | Returns |
|---|---|---|---|
| `workspace.readContext` | `workspace:read` | yes | `{branch, displayName, terminals:[{id}]}` or null |
| `terminal.sendText` | `terminal:send` | yes | `{accepted}` |
| `notifications.show` | `notifications:show` | yes | `{delivered}` |
| `storage.get` / `.set` / `.delete` / `.keys` | `storage` | **no** | JSON values |
| `secrets.get` / `.set` / `.delete` | `secrets` | **no** | string or null |
| `settings.get` / `.set` | `settings:own` | **no** | plugin's own settings |
| `events.subscribe` | `events:subscribe` | **no** | `{subscribed:[...]}` |

The spec type, `plugin-host-api.ts:98-113`:

```ts
export type PluginHostMethodSpec = {
  name: string
  since: string
  scope: 'active-worktree' | 'explicit-terminal' | 'plugin-private' | 'desktop' | 'host-events'
  stability: 'experimental'
  capability: PluginCapabilityKind
  mutation: boolean
  /** Whether sandboxed panels may call this over the postMessage bridge.
   *  Workers can call every method. */
  panel: boolean
  params: z.ZodTypeAny
  result: z.ZodTypeAny
}
```

`workspace.readContext` returns terminal **ids only** — there is no read method for terminal
output (`plugin-host-api.ts:26-43`, and note the comment at `:30-32`: "the API has no 'active
terminal' write target").

`terminal.sendText` requires an explicit `terminalId`; never "the active terminal", by design
(`plugin-host-api.ts:46-48`). Text is capped at 4096 chars (`:20`).

Storage caps: 256 KB per value, 5 MB total, 1024 keys (`plugin-host-api.ts:68-70`). **Too small to
cache synthesized audio.**

The raw runtime-RPC registry — which *does* contain `nativeChat.subscribe` — is explicitly never
exposed (`plugin-host-api.ts:10-12`), and this is structural, not documentary:
`getBoundPluginHostMethod` returns `null` for anything outside the thirteen-entry table
(`src/main/plugins/plugin-host-method-bindings.ts:179-180`).

### Worker IPC protocol

`src/shared/plugins/plugin-host-protocol.ts`. Parent→child: `init`, `invokeCommand`,
`deliverEvent`, `hostResult`, `shutdown` (`:47-53`). Child→parent: `ready`, `commandResult`,
`eventAck`, `hostCall`, `log`, `fatal` (`:95-102`). Zod-validated on both sides "because the child
runs third-party code — nothing it sends is trusted structurally" (`:7-8`).

### Events

The complete set (`src/shared/plugins/plugin-manifest.ts:63-69`):

```ts
/** Domain events a plugin can subscribe to in v0. Closed set: server-side
 *  filtering means plugins only ever receive what they subscribed to. */
export const PLUGIN_EVENT_NAMES = [
  'worktree.created',
  'worktree.removed',
  'agent.status.changed'
] as const
```

## Getting agent reply text

**This is the make-or-break section.**

### What the plugin API gives you: nothing usable

`src/shared/plugins/plugin-events.ts:28-33` — the entire `agent.status.changed` payload:

```ts
export const agentStatusChangedPayloadSchema = z.object({
  worktreeId: z.string().min(1).max(2048).nullable(),
  paneKey: z.string().min(1).max(2048),
  state: z.string().min(1).max(256),
  receivedAt: z.number().finite().positive()
})
```

The file header states the intent (`plugin-events.ts:5-9`): *"Payloads are bounded projections —
never raw runtime objects — so nothing sensitive … can leak through the event stream."*

The strip is enforced twice: at the emit site, which copies four fields out of a much richer
`enriched` object (`src/main/index.ts:2906-2911`), and again in `PluginEventBus.projectPayload`,
which zod-parses and returns `parsed.data` — a strip, not merely a check
(`src/main/plugins/plugin-event-bus.ts:33-41`).

So a plugin learns *that* an agent changed state, in *which* pane. Not what it said. **VERIFIED.**

`state` is one of `working | blocked | waiting | done`
(`src/shared/agent-status-types.ts:18`). Rows flagged `restoredUnconfirmed` are dropped before
emission (`src/main/index.ts:2902-2905`).

### What ORCA has internally: exactly what we want

`src/shared/native-chat-types.ts:31-80` — the structured model, IPC-serializable plain JSON:

```ts
export type NativeChatTextBlock       = { type: 'text';        text: string }
export type NativeChatToolCallBlock   = { type: 'tool-call';   name: string; input: unknown }
export type NativeChatToolResultBlock = { type: 'tool-result'; output: string; isError?: boolean }
export type NativeChatImageRefBlock   = { type: 'image-ref';   path?: string; url?: string; alt?: string }

export type NativeChatBlock =
  | NativeChatTextBlock | NativeChatToolCallBlock
  | NativeChatToolResultBlock | NativeChatImageRefBlock

export type NativeChatMessage = {
  id: string
  role: NativeChatRole            // 'user' | 'assistant' | 'tool' | 'reasoning' | 'system'
  blocks: NativeChatBlock[]
  timestamp: number | null
  source: NativeChatSource        // 'transcript' | 'hook' | 'scrape'
  turnId?: string
}
```

**Payload is raw markdown text, not rendered HTML** — `blocks[].text` is "Plain prose / markdown"
(`native-chat-types.ts:30`). Good for TTS: we get the source text and can strip markdown ourselves.

**Thinking blocks are folded into text blocks**, with the message *role* meant to carry the
distinction (`src/main/native-chat/transcript-record-blocks.ts:77-81`). Note the `'reasoning'` role
is declared but the Claude decoder never emits it — `claudeMessageRole` returns only `assistant`,
`user`, or `tool` (`src/main/native-chat/transcript-line-decoders-claude.ts:70-79`). **So separating
"thinking" from "reply" is not free: we must filter on the transcript record's own `thinking` block
type before it is flattened, or we will speak the model's reasoning aloud.** INFERRED — this is a
real design hazard for huddle mode.

Three layered sources with dedup precedence (`native-chat-types.ts:15-25`): `transcript` (3) beats
`hook` (2) beats `scrape` (1). Terminal scrollback scraping is the *degraded fallback*, not the
primary path.

### Streaming shape

Two distinct mechanisms. **Neither is token-by-token.**

**(a) Transcript live-tail — whole messages, 40 ms debounce.** Contract at
`src/main/native-chat/transcript-watch-contract.ts:8-33`:

```ts
onAppend: (messages: NativeChatMessage[], lifecycle?: NativeChatTurnLifecycle) => void
onInitialSnapshot?: (messages, hasMore, beforeOffset, error?, lifecycle?) => void
onReplace?: (messages, hasMore, beforeOffset, lifecycle?) => void
```

A chunk is `NativeChatMessage[]` — complete assistant turns, delivered when the agent CLI flushes
them to its JSONL file.

**(b) Intra-turn preview from hooks — a growing string.** `src/shared/native-chat-streaming.ts:1-5`:

> *"While an agent works, its hook preview (`lastAssistantMessage`) is shown as a synthetic assistant
> message so the user sees the reply build in real time, before the completed turn is flushed to the
> transcript."*

`deriveNativeChatStreamingText` returns the preview only while it *leads* the transcript — longer
than, and not contained in, the last assistant turn (`native-chat-streaming.ts:34-52`). This
monotonic-growth property is what a chunked speaker would want.

The preview is capped at **8000 characters**, multiline-preserving
(`src/shared/agent-status-types.ts:271-273`, applied at `:420-423`):

```ts
/** Maximum character length for the lastAssistantMessage preview.
 *  Why: 8 KB fits a multi-paragraph summary while bounding per-pane cache against a buggy/malicious agent spamming huge strings. */
export const AGENT_STATUS_ASSISTANT_MESSAGE_MAX_LENGTH = 8000
```

(Not the 200-char `AGENT_STATUS_MAX_FIELD_LENGTH` default at
`src/shared/agent-status-field-normalization.ts:13` — that governs `prompt`/`toolInput`, which use
the single-line normalizer. `lastAssistantMessage` uses `normalizeOptionalMultilineField` with the
8000 cap.)

**There is no `content_block_delta` / `message.delta` handling anywhere in the repo.** ORCA does not
consume `--output-format stream-json` for interactive sessions, and there is no ACP client.
VERIFIED.

`AgentStatusEntry` also carries `lastCompletedAssistantMessage`
(`src/shared/agent-status-types.ts:131-134`) — the newest completed turn's output, deliberately kept
across the next `working` because batched publications can fold a whole done→working transition into
one notification. **This is the single best field for "speak the reply when the agent finishes"** —
and it is not plugin-visible.

### Where the text physically lives

`src/main/native-chat/session-file-resolver.ts`:

| Agent | Transcript root |
|---|---|
| Claude | `~/.claude/projects/<slug>/<id>.jsonl` (`:27`, `:82`) |
| Codex | orca-managed home `/sessions`, else `CODEX_HOME` / `~/.codex/sessions` (`:41-42`) |
| omp | `~/.omp/agent/sessions` (`:55`) |
| Grok | `~/.grok/sessions` (`:66`) |

**Only five agents have transcript decoders** — `claude`, `openclaude`, `codex`, `grok`, `omp`
(`src/shared/native-chat-agent-support.ts:1-10`). ORCA supports far more agent targets than that
(fourteen hook targets at `src/shared/agent-hook-types.ts:6-21`). Gemini, Cursor, Copilot, Amp,
Droid, Devin and the rest have **no structured message path at all**. A TTS plugin built on
transcripts covers a subset of ORCA's agents. VERIFIED.

Per-agent decoders live in `src/main/native-chat/transcript-line-decoders-{claude,codex,grok,omp}.ts`.
The Claude decoder (`transcript-line-decoders-claude.ts:17-66`) maps one JSONL line to one
`NativeChatMessage`, keyed on `record.uuid`, skipping injected/meta turns.

### The recommended path, and its gap

**INFERRED, built only from VERIFIED primitives:**

1. Subscribe to `agent.status.changed` for the `working`→`done` edge and a `paneKey`.
2. Have the worker independently tail the JSONL transcripts with its own vendored copy of the
   decode logic. ORCA's decoders live in `src/main` and are **not** shipped to plugins — they import
   via relative paths, so we reimplement or vendor them.
3. Strip thinking blocks, strip markdown, chunk on sentence boundaries, synthesize, play via a
   spawned subprocess.

**The unsolved gap: `paneKey` → transcript file.** The plugin event carries no `sessionId` and no
transcript path, and `workspace.readContext` returns no session metadata. ORCA itself does this
correlation through `AgentStatusEntry.providerSession.transcriptPath`
(`src/shared/agent-status-types.ts:146-148`) — which is in no plugin-visible projection. A plugin
would have to guess by most-recently-modified file under the worktree's project slug. **That is a
heuristic, and it will be wrong when two agents run in one worktree — which is ORCA's headline
feature.** This is the single largest technical risk in the project.

## Selection, hotkeys, commands

### Text selection — does not exist

There is no host API method to read the current text selection, in the terminal, editor, or chat
view. The thirteen-method table (`src/shared/plugins/plugin-host-api.ts:122-253`) contains nothing
of the kind, and there is no `clipboard` capability
(`src/shared/plugins/plugin-capabilities.ts:15-23`). A panel iframe is opaque-origin with
`sandbox="allow-scripts"` and cannot reach the app DOM
(`src/renderer/src/components/right-sidebar/PluginPanel.tsx:223-226`). VERIFIED.

Selection reading exists in abundance — but only inside first-party renderer components, none of
which is reachable from a plugin:

- Terminal (xterm `getSelection()`): `src/renderer/src/components/terminal-pane/terminal-selection-copy.ts:14`,
  `keyboard-handlers.ts:549,689`, `TerminalPane.tsx:2188`, `terminal-pane-menu-copy-actions.ts:13`;
  selection geometry via `getSelectionPosition()` at `use-terminal-pane-lifecycle.ts:373`.
- DOM selection: `src/renderer/src/components/SelectedTextCopyMenu.tsx:22-23`
  (`window.getSelection()` scoped to a container); the dictation inserter uses
  `element.ownerDocument.getSelection()` at `dictation/dictation-insertion-target.ts:141`.
- Browser pane: `selectionText` from Electron context-menu events
  (`browser-pane/assemble-chrome/browser-page-context-menu.tsx:53,232-238`).
- Clipboard: `window.api.ui.writeClipboardText(...)` is **write-only** on that path, and `ui.*` is
  not in `PLUGIN_HOST_API_V0`. No `readClipboardText` is exposed to plugins.

To ship "speak selection" through the plugin system, ORCA would need a new host method (e.g.
`selection.read`) **and** a new `PLUGIN_CAPABILITY_KINDS` member **and** consent copy in
`PLUGIN_CAPABILITY_DESCRIPTIONS` (`plugin-capabilities.ts:35-44`). All three are upstream changes.

> **"Speak selection" as specified in HANDOFF.md is not implementable through the plugin API.**
> It requires either a new host method upstream, or a different integration shape entirely.

### Commands

`commandContributionSchema`, `src/shared/plugins/plugin-manifest.ts:55-61`:

```ts
const commandContributionSchema = z.object({
  id: pluginCommandIdSchema,
  title: z.string().min(1).max(256),
  context: z.enum(['global', 'worktree']).optional(),
  /** Built-in action aliases remain declarative and do not activate a worker. */
  action: pluginCommandIdSchema.optional()
})
```

Two handler kinds (`src/main/plugins/plugin-command-registry.ts:22-29`):

```ts
handler: { type: 'built-in'; action: PluginCommandAliasActionId } | { type: 'worker' }
```

A `worker` command lazily forks the worker on first invoke
(`src/shared/plugins/plugin-extension-registry.ts:28-38`). A `built-in` alias just re-points at one
of fifteen allowlisted renderer actions (`src/shared/plugins/plugin-command-actions.ts:5-21`) — a
closed list so "declarative aliases cannot target component-private shortcut implementations".

### Keybindings — in-app only

`pluginKeybindingContributionSchema`, `src/shared/plugins/plugin-content-pack-contributions.ts:25-42`:

```ts
export const pluginKeybindingContributionSchema = z.object({
  command: pluginCommandIdSchema,
  key: z.string().min(1).max(128).transform(/* normalizeKeybinding */),
  when: z.enum(['global', 'worktree']).optional()
}).strict()
```

`when: 'global'` means **app-global, not OS-global**. Keybindings become renderer keybinding actions
under the id `plugin:<pluginKey>/<commandId>`
(`src/shared/plugins/plugin-command-actions.ts:31-36`), and the registry detects chord conflicts
across plugins (`src/main/plugins/plugin-command-registry.ts:77-89`).

**There is no OS-level global hotkey, for plugins or for ORCA itself.** `grep -rn "globalShortcut" src`
returns **zero hits** across the entire tree — Electron's `globalShortcut` module is never used.
Every binding is window-scoped, matched by `src/shared/keybindings.ts` (2409 lines) with scopes
`'global'|'tabs'|'terminal'|'browser'|'editor'|'fileExplorer'|'composer'|'settings'` (`:5-14`).
"Global" here means app-global, not OS-global. VERIFIED.

Keybinding contributions are "instructional content" and are folded into the consent fingerprint
against the immutable tree hash (`src/shared/plugins/plugin-consent-fingerprint.ts:9-17, 30-34`), so
a plugin cannot silently change a user's key chords in an update.

Working example — the bundled `stablyai.orca-navigation-shortcuts`
(`resources/plugins/launch/stablyai.orca-navigation-shortcuts/orca-plugin.json`) declares three
alias commands with `Mod+Alt+{T,F,G}` chords and **zero capabilities**.

### Command palette — does not exist as a plugin surface

**ORCA has no general command palette.** The only palette is the worktree jump palette
(`src/renderer/src/components/WorktreeJumpPalette.tsx`, modal id `'worktree-palette'` at `:651`,
action `worktree.palette`), which lists worktrees, tabs, and tasks. There is no plugin contribution
point into it. VERIFIED.

Plugin commands surface in exactly two places: their declared keybinding, and the Settings →
Keybindings list under a "Plugins" group
(`src/renderer/src/lib/plugin-command-keybindings.ts:19-35`). Dispatch matches at
`findPluginCommandForKeybinding` (`:56-73`), which skips `context: 'worktree'` commands when no
worktree is active.

Commands are reconciled into an active list only for approved plugins
(`plugin-command-registry.ts:54-76`); unapproved ones stay in a `preview` map so the settings UI can
show what *would* be registered (`:46-48, 70-75`). A chord conflict **disables both plugins**
(`:98-107`).

> Relevant precedent: `voice.dictation` is already bound to `Mod+E`
> (`src/shared/keybindings.ts:340-346`). It is **not** in the fifteen-entry built-in alias allowlist
> (`src/shared/plugins/plugin-command-actions.ts:5-21`), so a plugin cannot alias or extend it.

## UI contribution points

**One mechanism: a sandboxed HTML panel in the right sidebar.** That is all. No status bar item, no
overlay, no editor decoration, no webview beyond the panel.

`panelContributionSchema`, `src/shared/plugins/plugin-manifest.ts:46-53`:

```ts
const panelContributionSchema = z.object({
  id: pluginIdSchema,
  title: z.string().min(1).max(256),
  /** Lucide icon name rendered in the right-sidebar activity bar. */
  icon: z.string().min(1).max(64).optional(),
  /** HTML entry rendered inside a sandboxed panel frame. */
  entry: pluginRelativePathSchema
})
```

The panel HTML is wrapped in a host-generated shell and mounted as an iframe `srcdoc`.
`src/renderer/src/components/right-sidebar/PluginPanel.tsx:220-232`:

```tsx
<iframe
  // SECURITY: never add allow-same-origin — the srcdoc frame must stay an
  // opaque origin so plugin UI cannot reach the app DOM, storage, or IPC.
  sandbox="allow-scripts"
  name={`${PLUGIN_PANEL_FRAME_NAME_PREFIX}${tabKey}`}
  srcDoc={panelDocument ?? ''}
  …
/>
```

Note: no `allow` attribute, so the iframe's Permissions Policy denies microphone, camera, and
autoplay by default.

### The panel CSP — decisive for audio

`src/shared/plugins/plugin-panel-shell.ts:20-22`:

```ts
export const PLUGIN_PANEL_CSP =
  "default-src 'none'; connect-src 'none'; script-src 'unsafe-inline'; " +
  "style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"
```

Read this carefully for our purposes:

- **No `media-src`** → falls back to `default-src 'none'` → `<audio>` and `<video>` load **nothing**,
  including `data:` and `blob:` URIs.
- **`connect-src 'none'`** → no fetch, no XHR, no WebSocket. A panel cannot call a cloud TTS API.
- `img-src data:` and `font-src data:` are the only resource loads permitted.

The shell also prepends navigation blocking, neuters `window.open`, and cancels link clicks and form
submits (`plugin-panel-shell.ts:60-99`). The CSP is prepended so it parses before any plugin markup
and can only be tightened, never loosened (`:5-13`).

**Conclusion: a plugin panel cannot play audio and cannot fetch audio. VERIFIED.** Audio must come
from the worker's subprocess. The panel is only good for controls (play/pause/voice picker) that
message the worker.

Panel→host bridge budget (`src/shared/plugins/plugin-panel-bridge.ts:22-23`): 64 KB per message,
**30 messages per 10 seconds**. Panels may call only the three `panel: true` methods
(`plugin-host-api.ts:263-265`). A watchdog pings every 10 s and demotes a panel that misses a pong
(`plugin-panel-bridge.ts:35-36`). Design tokens are injected as a curated 20-property allowlist so
panels can match the app theme (`plugin-panel-shell.ts:34-55`).

## Existing audio code

**No TTS exists anywhere in ORCA.** A repo-wide grep for `tts` / `text-to-speech` /
`speechSynthesis` / `AVSpeechSynthesizer` across `src/**/*.ts{,x}` returns **zero** matches.
VERIFIED.

**But a complete STT stack exists**, and it is the closest precedent we have. `src/main/speech/`:

```
stt-service.ts, stt-worker.ts, stt-worker-model-config.ts   local whisper inference
stt-audio-resample.ts, stt-offline-audio-chunker.ts         audio pipeline
model-manager.ts, model-catalog.ts, model-download-catalog.ts, model-cache-path.ts
                                                            model download / cache / deletion
openai-transcription-client.ts, openai-api-key-store.ts     cloud STT fallback
speech-runtime-service.ts                                   lazy singleton wiring
```

Renderer side: `src/renderer/src/components/dictation/microphone-devices.ts`,
`src/renderer/src/hooks/use-audio-capture.ts` (uses `AudioContext`,
`navigator.mediaDevices.getUserMedia`), settings at
`src/renderer/src/components/settings/VoicePane.tsx` and `VoiceMicrophoneSetting.tsx:89-94`.
Settings type `VoiceSettings` in `src/shared/speech-types.ts`.

### Audio playback that does exist: notification sounds only

Nine bundled MP3s (`resources/notification-sounds/{two-tone,bong,thump,blip,sonar,blop,ding,clack,beep}.mp3`)
plus a user-picked file. Catalog and MIME allowlist at
`src/main/ipc/notification-sound-selection.ts:13-31`; IPC handlers
`notifications:resolveSoundPath` / `notifications:loadSound` at
`src/main/ipc/notification-sound-ipc.ts:13-60` with a 10 MB cap (`:11`).

**Playback happens in preload, not the renderer** — `src/preload/index.ts:2333-2380` constructs
`new Audio(blobUrl)` and dedupes concurrent plays unless `force: true`. The preload API type is
`playSound: (options?: { force?: boolean; volume?: number }) => Promise<NotificationSoundResult>`
(`src/preload/api/os-permission-api.ts:28`).

**Note the signature: it takes no path and no buffer.** It plays *the user's configured notification
sound* and nothing else. There is no generic "play this audio" API anywhere in ORCA, and none in the
plugin surface. VERIFIED.

### Mobile has real PCM output — desktop does not

`mobile/packages/expo-two-way-audio/` is a native module (Swift `ios/AudioEngine.swift`, Kotlin
`android/.../AudioEngine.kt`) exposing `playPCMData(audioData: Uint8Array)`, `stopPlayback`,
`pausePlayback`, `resumePlayback`, `isPlaying` (`src/core.ts:8,48-60`). Still **not** TTS — it is a
playback engine with no synthesizer. Recorded here because it is the only arbitrary-audio-output
primitive in the whole repo, and it is on the wrong platform.

### Entitlements and Electron permissions

`resources/build/entitlements.mac.plist` — nine keys, including
`com.apple.security.device.audio-input` (`:7`), camera, bluetooth, USB, location, Apple Events,
and the JIT/unsigned-memory pair. `config/electron-builder.config.cjs:369-389` ships
`NSMicrophoneUsageDescription` (`:381`) and `NSAudioCaptureUsageDescription` (`:382`).

**There is no audio-*output* entitlement, because macOS does not require one** — playback is
unrestricted. Likewise `AVSpeechSynthesizer` would need no new entitlement. (Apple *recognition*
would need `NSSpeechRecognitionUsageDescription`, which is absent — ORCA's STT is local/OpenAI, not
SFSpeechRecognizer.)

`config/scripts/verify-macos-entitlements.mjs` is only a duplicate-key linter (`:44-45`: *"plutil
-lint accepts duplicate keys, but codesign rejects duplicate entitlements during release signing"*).
It asserts nothing about which entitlements are present, so adding a key would not trip it.

Electron runtime permission policy — `src/main/window/attach-main-window-services.ts:206-226`:

```ts
const allowedPermissions = new Set(['media', 'fullscreen', 'pointerLock'])
```

`media` is granted only after a real macOS TCC check
(`src/main/browser/browser-media-access.ts:28,51`). The dashboard popout window denies everything
(`src/main/window/dashboard-popout-window.ts:186-189`).

**Read this as:** ORCA's own voice work lives in `src/main/**` as first-party code with direct
Node/Electron access and a settings pane — *not* as a plugin. That is a strong signal about where a
TTS feature naturally belongs, and about how much the plugin sandbox was designed to withhold.

There is a model-download-and-cache subsystem (`src/main/speech/model-manager.ts`) that a local
neural TTS engine would want — and that a plugin cannot reuse, since it is main-process code behind
no plugin API.

## MCP as an alternative path

**ORCA does not run, spawn, proxy, or supervise MCP servers.** It is a config-file inspector and
creator for the agent CLIs, and that is the entire surface. VERIFIED.

`src/shared/mcp-config.ts` (208 lines) is the whole model. The candidate files it knows about
(`:44-68`):

```ts
export const MCP_CONFIG_CANDIDATES: McpConfigCandidate[] = [
  { format:'workspace', label:'Workspace',        relativePath:'.mcp.json',        serversPath:['mcpServers'] },
  { format:'cursor',    label:'Cursor',           relativePath:'.cursor/mcp.json', serversPath:['mcpServers'] },
  { format:'claude',    label:'Claude',           relativePath:'.claude.json',     serversPath:['mcpServers'] },
  { format:'claude',    label:'Claude workspace', relativePath:'.claude/mcp.json', serversPath:['mcpServers'] }
]
```

Types at `:24-42`: `McpServerTransport = 'stdio'|'http'|'unknown'`, `McpServerStatus`,
`McpServerSummary`, `McpConfigInspection`. "Creating" a config is literally writing
`MCP_STARTER_CONFIG = '{ "mcpServers": {} }'` (`:71-74`) to `.mcp.json` and opening it in ORCA's
editor (`src/renderer/src/components/settings/McpConfigSection.tsx:195-231`). Reads go through
`window.api.fs.readDir` (`mcp-config-inspection.ts:22-40`), so it works over SSH via `connectionId`.

There is **no `modelcontextprotocol` dependency, no MCP client, and no server spawn** anywhere in
`src/`. (`src/main/linear/mcp-issue-list.ts` is Linear-CLI-specific and unrelated.)

**A plugin cannot register an MCP server.** The manifest `contributes` object is `.strict()` with
seven known keys (`src/shared/plugins/plugin-manifest.ts:99-121`) — an `mcpServers` key fails
validation outright.

**Assessment (INFERRED).** A TTS *tool* delivered as an MCP server is a real integration shape —
the agent would call a `speak` tool and the server would synthesize. But it is orthogonal to ORCA:
ORCA gives it no lifecycle, no install path, and no plugin hook. The user would install it into
their own `.mcp.json` by hand. And it answers a different question than the one in HANDOFF.md —
it lets the *agent choose* to speak, rather than ORCA speaking every reply. **Not a substitute for
the plugin, but worth keeping as a complementary option**, especially because it sidesteps every
sandbox limitation documented above.

## Example plugin walkthrough

### `examples/plugins/hello-orca/` — the canonical full-featured example

```
examples/plugins/hello-orca/
├── orca-plugin.json    manifest: 1 panel + 1 command + 2 event subscriptions + 5 capabilities
├── main.mjs            worker entry: default-exported activate(orca)
└── panel.html          sandboxed panel UI, talks to the host over postMessage
```

Manifest (complete, `examples/plugins/hello-orca/orca-plugin.json`):

```json
{
  "manifestVersion": 1,
  "id": "hello-orca",
  "publisher": "orca-samples",
  "name": "Hello Orca",
  "version": "1.0.0",
  "description": "Sample plugin combining a sandboxed panel, a worker command, and event subscriptions.",
  "engines": { "orca": ">=1.4.0" },
  "pluginApi": 1,
  "main": "main.mjs",
  "contributes": {
    "panels": [{ "id": "hello", "title": "Hello Orca", "icon": "plug", "entry": "panel.html" }],
    "commands": [{ "id": "hello-ping", "title": "Hello: Ping" }],
    "events": [{ "on": "worktree.created" }, { "on": "agent.status.changed" }]
  },
  "capabilities": [
    { "kind": "workspace:read" }, { "kind": "terminal:send" },
    { "kind": "notifications:show" }, { "kind": "storage" }, { "kind": "events:subscribe" }
  ]
}
```

Worker entry (complete, `examples/plugins/hello-orca/main.mjs`):

```js
// Sample Orca plugin worker entry. Runs inside the out-of-process plugin
// worker (plain Node, no Electron), forked lazily on the first trigger. The
// default export receives the `orca` API: command registration, event
// handlers, and the capability-gated host API.
export default function activate(orca) {
  orca.commands.register('hello-ping', async (args) => {
    const stored = await orca.host.call('storage.get', { key: 'pings' })
    const count = (typeof stored?.value === 'number' ? stored.value : 0) + 1
    await orca.host.call('storage.set', { key: 'pings', value: count })
    return { pong: true, count, args: args ?? null }
  })

  orca.events.on('worktree.created', async (payload) => {
    orca.log(`worktree created: ${payload.worktreeId} at ${payload.path}`)
    await orca.host.call('notifications.show', { title: 'Worktree created', body: payload.path })
  })

  orca.events.on('agent.status.changed', (payload) => {
    orca.log(`agent status: ${payload.state} in ${payload.worktreeId ?? 'unknown worktree'}`)
  })
}
```

Note what the `agent.status.changed` handler can access: `payload.state` and `payload.worktreeId`.
That is the ceiling.

`panel.html` uses a `requestId`-correlated `postMessage` call helper and styles itself from injected
CSS custom properties (`var(--foreground)`, `var(--background)`, `var(--border)` …) with hardcoded
fallbacks. It is plain ES5-flavoured inline script — no bundler, no framework.

The end-to-end behaviour is pinned by `tests/e2e/plugin-demo.spec.ts`, whose stated invariant is
that the plugin *"stays inert before visible consent, then its panel, worker command, and event
subscription all work"* (`:1-4`), including an assertion that the panel document carries
`default-src 'none'` (`:40-43`).

### Other in-tree plugins

- `examples/plugins/hostile-panel/` — a deliberately hostile security fixture (exfiltration,
  navigation, message floods, busy loops) used by the containment tests. Zero capabilities.
  Useful as a map of what the sandbox is designed to stop.
- `resources/plugins/launch/stablyai.orca-navigation-shortcuts/` — manifest only. Commands +
  keybindings, no `main`, no capabilities.
- `resources/plugins/launch/stablyai.orca-portuguese/` — manifest + `locales/pt-BR.json`.
- `resources/plugins/launch/stablyai.orca-multipass-recipes/` — manifest + `recipes/ubuntu-lts.json`.

**Three of the four shipping plugins are pure content packs with no code at all.** Only the
`examples/` demo has a worker. The plugin system in production use today is far simpler than what a
TTS plugin needs. INFERRED from the four manifests.

## Plugin build, dev loop, and distribution

### Building a plugin: there is no build system, and that is the point

**There is no plugin SDK, no scaffolding CLI, no published types package, and no build step.**
`pnpm-workspace.yaml` declares `packages: []`; nothing in the repo publishes an `@orca/*` package.
The `orca` CLI has **no plugin subcommand** — `src/cli/specs/` contains account, agent-hooks,
artifacts, automations, browser, computer, diagnostics, emulator, environment, file, linear,
orchestration, project, serve, skills, vm. No `plugin.ts`. VERIFIED.

A plugin **is** a directory. The artifact is the folder itself — not a zip, tarball, or npm
package. Required layout, from the two working examples:

```
my-plugin/
├── orca-plugin.json     REQUIRED, exactly this filename at the root
├── main.mjs             worker entry, if `main` is declared. Native ESM.
└── panel.html           panel entry, if a panel is declared
```

The worker entry is loaded by a bare dynamic `import()` of a `file://` URL
(`src/main/plugins/plugin-host-runtime.ts:56,82`), so it must be **valid ESM that Node 24 can run
as-is**. It must default-export the activate function.

**Critical consequence: installation never runs a build.** `checkoutPluginGitSource` does a
`git clone --quiet --depth 1` (or `fetch --depth 1` + `checkout FETCH_HEAD`)
(`src/main/plugins/plugin-git-repository.ts:33-41`), and `installStagedPluginTree` then `cp`s the
tree recursively, filtering out only `.git`
(`src/main/plugins/plugin-install-staging.ts:165-174`). **No `npm install`, no dependency
resolution, no compile step, ever.** VERIFIED.

So: TypeScript must be compiled and **all npm dependencies must be bundled into the committed
output** before publishing. Our repo must contain runnable JavaScript on the published ref.

**And committing `node_modules` is not a workaround** — `src/main/plugins/plugin-content-hash.ts:15-16`:

```ts
const MAX_PLUGIN_FILES = 2_000
const MAX_PLUGIN_TOTAL_BYTES = 50 * 1024 * 1024
```

**2,000 files and 50 MB, hard.** A typical `node_modules` blows the file count immediately.

> **Design consequence for TTS.** Bundle to a single `main.mjs` with esbuild or rollup. And a local
> neural voice model cannot ship inside the plugin — 50 MB is at or below one decent voice. Models
> must be **downloaded at runtime** into a cache directory outside the immutable install tree
> (which is content-hash-verified and must not be mutated). This mirrors what ORCA's own STT does
> with `src/main/speech/model-manager.ts`. INFERRED, but forced by the two constants above.

Per-artifact size caps (`src/main/plugins/plugin-artifact-validation.ts:9-14`): worker entry 50 MB,
panel entry 10 MB, icon 2 MB, language pack 5 MB, VM recipe 256 KB, agent profile 1 MB.

### Loading a locally-built plugin — the exact dev loop

**This is the "load unpacked" path, and it is a GUI-only flow.** There is no CLI flag, no env var,
and no symlink convention.

> **Settings → Plugins → Development → paste an absolute folder path → Add**

Component: `src/renderer/src/components/settings/PluginDevelopmentSection.tsx`. Its own help text
(`:66-71`) is worth quoting because it answers three questions at once:

> *"Load plugins directly from folders on this computer while you develop them. Dev plugins still
> require permission review. Workers run on this desktop host; SSH workspace actions route through
> Orca, so paths here are desktop paths."*

Under the hood this writes the `devPluginPaths` setting
(`PluginsSettingsSection.tsx:284`, type at `src/shared/global-settings-types.ts:312-313`) and
triggers a refresh. Discovery then reads each dev path as a plugin root
(`src/main/plugins/plugin-discovery.ts:220,238`). Dev plugins have `isDev: true` and
`contentHash: null` (`plugin-discovery.ts:38-50`) — they are exempt from the hash-addressed
immutable layout, but **not** from manifest validation, artifact validation, or consent.

**Prerequisites, in order:** enable `pluginSystemEnabled` (Settings → Plugins toggle) → add the dev
path → review and accept the consent dialog. A dev plugin is inert until consented, and the e2e
test pins that invariant (`tests/e2e/plugin-demo.spec.ts:1-4`).

### Hot reload: partial, and the gap will bite us

A Parcel-based watcher subscribes to each dev path and calls `refresh()` on change, debounced
**300 ms** (`src/main/plugins/plugin-dev-watcher.ts:38-71,106-114`; wired at
`src/main/plugins/plugin-service-housekeeping.ts:23-32`).

What actually reloads:

| You edit | Result |
|---|---|
| `orca-plugin.json` | Full reload — worker is killed and re-forked. |
| `panel.html` | Reloads — panel HTML is re-read and re-wrapped per load (`plugin-panel-controller.ts:142-154`). |
| **`main.mjs` (worker code)** | **No restart. The running worker keeps the old code.** |

The reason is the spawn-spec equality check. `pluginWorkerSpawnSpecsEqual` compares
`pluginKey`, `rootDir`, `mainEntry`, `manifestRevision`, and capabilities
(`src/main/plugins/plugin-worker-spawn-spec.ts:23-41`), where `manifestRevision` is
`JSON.stringify(plugin.manifest)` (`:18`) — **the manifest, not the code**. Nothing in the spec
hashes the worker file's bytes or mtime.

This gates **both** paths that could have restarted the worker:

- `PluginWorkerManager.ensureActive` returns the existing handle when specs match
  (`src/main/plugins/plugin-worker-manager.ts:89-91`).
- `PluginWorkerController.reconcile` — which the dev watcher's refresh ultimately drives
  (`plugin-service.ts:171-174`) — skips deactivation entirely when specs match
  (`src/main/plugins/plugin-worker-controller.ts:119-131`):

```ts
const next = nextSpecs.get(pluginKey)
if (next && pluginWorkerSpawnSpecsEqual(spec, next)) {
  continue
}
```

The comment at `plugin-worker-spawn-spec.ts:16-17` confirms the intent: the manifest is included so
"hot reload cannot reuse a worker with stale *contributions*" — contributions, not code. **The file
watcher fires, the refresh runs, and the worker is deliberately left alone.**

**Workarounds for a worker-code edit (INFERRED from the mechanism):**
- Touch the manifest (bump `version`) to change `manifestRevision` and force a re-fork.
- Toggle the plugin off and on in Settings.
- Wait out the 5-minute idle reap (`PLUGIN_WORKER_IDLE_REAP_MS`,
  `src/shared/plugins/plugin-host-protocol.ts:112`), after which the next trigger re-forks with
  fresh code.

> **This is our single biggest inner-loop risk, and it lands squarely on the code we care most
> about.** A TTS plugin is almost entirely worker code. Recommend a dev script that bumps the
> manifest `version` on every build so the watcher always forces a re-fork. *A human should verify
> this empirically before we build tooling around it* — see Unknowns.

### Debugging

**You cannot attach a Node debugger to a plugin worker.** `fork` is called with `execArgv: []`
specifically so that "inspector/loader flags from Orca's own launch must never execute inside
third-party plugin workers" (`src/main/plugins/plugin-host-process.ts:88-99`), and a test pins it
(`plugin-host-process.test.ts:41-50`, *"does not inherit Orca execArgv"*). No `--inspect`, no
`--inspect-brk`. VERIFIED.

What you get instead:

- **A log viewer in Settings.** `orca.log(msg)` sends a `log` frame
  (`plugin-host-runtime.ts:115-117`), and the worker's **stdout and stderr are piped** into the same
  sink (`plugin-host-process.ts:100-101`), so plain `console.log` works.
- Storage is a **200-line in-memory ring buffer per plugin**
  (`src/main/plugins/plugin-log-buffer.ts:3-19`) — not a file, and lost on restart.
- Surfaced via `src/renderer/src/components/settings/use-plugin-logs.ts` and
  `PluginSettingsOverview.tsx`.
- Crashes: `uncaughtException` / `unhandledRejection` send a `fatal` frame with the stack before
  exiting (`src/main/plugins/plugin-host-entry.ts:22-35`). A supervisor then restarts with backoff
  `[500, 2000, 5000] ms` and gives up after `maxRestarts: 3`, marking the plugin `errored`
  (`src/main/plugins/plugin-supervisor.ts:32-33,84-91`). **Three crashes in development and the
  plugin is dead until you re-enable it** — worth knowing before you burn twenty minutes wondering
  why nothing runs.
- **Panel debugging: no dedicated DevTools.** `openDevTools` exists only for browser-pane guests
  (`src/main/browser/browser-manager.ts:1709-1720`) and the main window
  (`src/main/window/createMainWindow.ts:837`). INFERRED: since the panel is an ordinary
  same-process iframe in the renderer, main-window DevTools should be able to select its frame —
  **not verified.**
- **Mutation auditing.** Every mutating host call is written to an audit log with actor
  `plugin:<key>` (`src/main/plugins/plugin-host-methods.ts:61-70`,
  `src/main/plugins/plugin-audit-log.ts`). Useful for confirming calls actually landed.

### How a third party installs our plugin

Four install source kinds (`src/shared/plugins/plugin-install-lockfile.ts:17-59`):
`local-path`, `git`, `marketplace`, `bundled`.

**The realistic path for us is `git`.** The user opens Settings → Plugins → *Install plugin* and
enters a `URL#ref` string. The parser requires **both** parts
(`src/renderer/src/components/settings/plugin-install-source.ts:24-39`) — a bare URL is rejected
with `missing-git-ref`. So a user types something like:

```
https://github.com/<us>/orca-plugin-tts.git#v1.0.0
```

URLs are restricted to HTTPS or SSH, with no username in HTTPS URLs and no password ever
(`plugin-install-lockfile.ts:63-79`). The stated reason: *"System Git supports executable remote
helpers (`ext::`, custom `foo::` transports). P0 accepts network Git only over HTTPS or SSH so
installing a source cannot turn URL parsing into arbitrary command execution."*

**Marketplaces are self-serve — no central review.** A user can add *any* git repo containing an
`orca-marketplace.json` as a marketplace source
(`src/renderer/src/components/settings/PluginMarketplaceSourceDialog.tsx:154-155`: *"Use an HTTPS or
SSH repository URL containing orca-marketplace.json"*). We can publish our own index. The official
one is `stablyai/orca-plugins` (`src/shared/plugins/plugin-marketplace.ts:11-12`); its entries
require a resolved exact commit so a listing is reproducible (`:51-53`).

**There is no npm publish path, no `orca plugin install` command, and no central registry
submission.** Distribution is: push a git tag, tell people the `URL#ref`. VERIFIED.

### Naming, versioning, and trust requirements we must meet

- **Identity is `<publisher>.<id>`** (`plugin-manifest.ts:149-151`), also the install directory
  name. Both parts must satisfy `pluginIdSchema`.
- **We must NOT use `stablyai` as publisher, nor an `orca-` id prefix.** Those are reserved: a
  reserved identity must resolve to the stablyai org, and cannot be installed from a local path at
  all (`src/main/plugins/plugin-install-trust.ts:8-26`,
  `plugin-marketplace.ts:9-12`). Pick something like `publisher: "<our-handle>"`, `id: "tts"`.
- `version` must be **strict semver** (`plugin-manifest.ts:34-35,86`).
- `manifestVersion: 1` and `pluginApi: 1` are literals — no other value validates.
- `engines.orca` must match `>=x.y.z` exactly; no ranges, carets, or tildes
  (`plugin-manifest.ts:41-44`). We would declare `>=1.4.0`.
- `contributes` is `.strict()` — one unknown key fails the whole install.

**Signing and review:** there is **no code signing of plugins, no notarization, and no review
process.** Integrity is by SHA-256 content hash over the tree, recorded in an install lockfile
alongside the resolved commit and the consent fingerprint
(`plugin-install-lockfile.ts:4-15`). Installs are immutable and hash-addressed; a reinstall whose
bytes differ is a visible change (`plugin-install-staging.ts:150-155,202-205`).

**The user sees a consent dialog on install**, covering the capability list and — because we
declare `main` — the `trusted-node-worker` tier (`plugin-consent-fingerprint.ts:19-35`). Any change
to our capabilities, or to instructional contributions like keybindings, re-prompts on update. There
is also a remote **kill list** that can revoke a plugin
(`src/main/plugins/plugin-kill-list-service.ts`).

### ORCA's CI — what we can and cannot model

**There is no plugin-authoring CI in the repo to copy.** The one plugin hit in
`.github/workflows/pr.yml:77` is "Enforce focused code-quality plugins", which runs oxlint plugins —
unrelated. VERIFIED.

ORCA's own `pr.yml` is a large gate (static analysis on `ubuntu-latest`, typecheck, tests, e2e,
localization and entitlement verifiers, a max-lines ratchet, a root-directory guard). It is built
for a 16k-file Electron monorepo and is the wrong shape for a single-folder plugin.

**What is worth modelling is the e2e test, not the workflow.** `tests/e2e/plugin-demo.spec.ts`
drives a real ORCA against `examples/plugins/hello-orca` through Playwright: open plugin settings,
consent, open the panel, assert the CSP, create a worktree, assert the event fired. Its stated
invariant (`:1-4`) is exactly the shape our own acceptance test should take.

A realistic plugin CI (INFERRED — no in-repo precedent): bundle to `main.mjs`, assert the manifest
parses against `pluginManifestSchema`, assert the tree is under 2,000 files / 50 MB, and tag a
release. The manifest schema is importable from ORCA's source but **not published as a package**, so
we would vendor a copy or re-implement the check.

### Documentation status — a pitfall in itself

**ORCA ships no plugin documentation.** `docs/` has no plugin file; `README.md`, `AGENTS.md`, and
`CLAUDE.md` do not contain the word "plugin" at all (grep, zero hits). The public docs site
(`onorca.dev/docs`, linked throughout the README) is not in-tree and was not fetched.

There is therefore **nothing to disagree with the source** — but also no author-facing guide. The
two example plugins, the e2e spec, and the zod schemas are the entire specification. **Treat this
document as the substitute, and re-derive it against a fresh commit before implementation starts.**

## Unknowns and risks

Ordered by how badly each could sink the project.

1. **`paneKey` → transcript correlation.** No plugin-visible payload carries a sessionId or
   transcript path. Any mapping is heuristic and breaks with multiple agents per worktree — ORCA's
   headline feature. *A human must decide whether to accept the heuristic, or to upstream a
   `providerSession` field into the event projection.*

2. **"Speak selection" has no API path.** Verified absent, not merely undiscovered. *A human must
   choose: drop the feature, upstream a `selection:read` capability, or ship outside the plugin
   system.*

3. **The whole surface is EXPERIMENTAL.** `plugin-manifest.ts:30-32`: *"Everything here is
   EXPERIMENTAL: no compatibility promises until pluginApi v1 freezes."* The host API says the same
   (`plugin-host-api.ts:16-17`). We would be building against a moving target with an explicit
   no-stability notice.

4. **The filesystem path is outside the capability model.** It works today because `execArgv: []`
   and no Node permission model. The roadmap names `net:fetch` and `process:exec` as future scoped
   capabilities (`plugin-capabilities.ts:12`) — implying the worker *will* eventually be confined.
   A plugin that reads `~/.claude/projects` and spawns `say` would break the day that lands, and
   would arguably be violating the model's spirit today. *A human must weigh this.* I could not
   find a roadmap document in-tree to date it.

5. **Off by default.** `pluginSystemEnabled: false`. Every user must opt in, then consent to our
   capability set, then consent again to `trusted-node-worker`. Real adoption friction.

6. **5-minute idle worker reap.** Audio state cannot live in worker memory across it.

7. **Agent coverage is partial.** Only claude / openclaude / codex / grok / omp have transcript
   decoders. TTS would silently not work for Gemini, Cursor, Copilot, Amp, Droid, Devin.

8. **Thinking-vs-reply separation.** The `reasoning` role is declared but never emitted by the Claude
   decoder; thinking is flattened into text blocks. We must filter at the raw JSONL level or risk
   speaking chain-of-thought aloud.

9. **Not verified — worker module-loader interception.** I read `plugin-host-runtime.ts` in full and
   found a bare dynamic `import()` with no loader hooks, and `execArgv: []` in
   `plugin-host-process.ts`. I did **not** exhaustively audit for a `require` patch or a custom ESM
   loader installed elsewhere in the worker's startup path. *Before committing to the filesystem
   approach, a human should empirically verify it:* write a throwaway dev plugin whose `activate`
   does `import('node:fs').then(fs => orca.log(String(fs.existsSync(process.env.HOME))))` and read
   the plugin log. Presence of the code is not proof of the behaviour.

10. **`speechSynthesis` in a panel is the one untested loophole.** CSP governs resource loads, not
    JS APIs, so `window.speechSynthesis` is not blocked by `default-src 'none'`. But Electron
    historically ships no speech service (empty `getVoices()`), the frame is opaque-origin, and
    Chromium's autoplay policy applies. **Nobody verified this either way.** *A human should test it
    directly in a dev plugin panel before any design depends on it.* If it works, it collapses most
    of risk 4 — synthesis and playback would both happen inside the sandbox with no capability
    needed.

11. **Not investigated — `orca serve` / relay parity.** The plugin gate is explicitly shared with the
    headless and relay paths, and a conformance suite runs identical cases against both
    (`plugin-capability-gate.ts:5-9`). A worker doing filesystem reads has no such parity guarantee
    when the agent runs over SSH — the transcript would be on the *remote* host. Huddle mode over
    SSH worktrees is likely broken by construction. INFERRED; not chased down.

12. **Worker code does not hot-reload.** Only a manifest change re-forks the worker
    (`plugin-worker-spawn-spec.ts:23-41`). *A human should verify the version-bump workaround
    empirically* — edit `main.mjs` only, confirm stale behaviour; then bump `version`, confirm fresh
    behaviour. Watch a named value change, not just "it seemed to reload."

13. **50 MB / 2,000 files kills bundled voice models.** Models must be downloaded at runtime into a
    cache dir outside the content-hash-verified install tree. That is a network fetch from a worker
    with no `net:fetch` capability — see risk 4.

14. **No plugin debugger.** `execArgv: []` blocks `--inspect`. Debugging is a 200-line in-memory log
    ring. Budget for this being slow.

15. **Storage is far too small for audio.** 256 KB per value, 5 MB total
    (`plugin-host-api.ts:68-70`). Any caching of synthesized speech must go to the worker's own
    `TMPDIR` — which is, again, outside the capability model.
