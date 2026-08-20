# Q-round 1 — empirical answers from ORCA source

Research artifact. Answers Q1, Q3, Q9, Q10, Q11, Q15, Q35 of
`docs/.discussion/000-open-questions.md`. Every verdict carries a `path:line` citation into the
ORCA tree. No verdict uses "probably", "likely", or "should".

## Checkout drift — READ THIS FIRST

**The local ORCA checkout is NOT at the pinned commit.**

| | |
|---|---|
| Pinned by the brief | `0f26ff4ad83e9ca736f6ad3bae6937cd0cdab7fc` — 2026-08-20, *"Update README downloads badge"* |
| Actual `HEAD` | `87097551f8e98a21c3afa7d457f66d6fd1f94038` — 2026-08-21, *"fix(dev): give each worktree its own dev userData profile"* |
| Relationship | pinned is an **ancestor** of HEAD; HEAD is **5 commits ahead** |

Verified the drift is harmless for every citation below:

```
$ git diff --name-only 0f26ff4a..HEAD | grep -iE 'plugin|speech|settings'
src/renderer/src/components/settings/TerminalWindowSection.padding.test.tsx
src/renderer/src/components/settings/TerminalWindowSection.tsx
src/shared/terminal-padding-settings.test.ts
src/shared/terminal-padding-settings.ts
```

The four hits are terminal-padding settings UI. **Zero files under `src/shared/plugins/`,
`src/main/plugins/`, `src/preload/`, `src/main/speech/`, or `examples/plugins/` changed between the
pinned commit and HEAD.** Line numbers below are therefore valid at both commits. The five commits
touch dev tooling, terminal padding, PTY startup, Ghostty config, and the daemon protocol version.

Line numbers cited are as read at HEAD.

---

## Q1 — Can a plugin register an MCP tool the agent can call?

**Verdict: RESOLVED NEGATIVE.** No. There is no MCP surface anywhere in the plugin system, and
"tool" is not a concept the plugin API has. It is neither inside nor outside the seven-capability
model — the concept does not exist.

**Evidence 1 — the capability set is a closed enum of seven, none of which is tool- or
agent-facing.** `src/shared/plugins/plugin-capabilities.ts:15-23`:

```ts
export const PLUGIN_CAPABILITY_KINDS = [
  'workspace:read',
  'terminal:send',
  'notifications:show',
  'storage',
  'secrets',
  'events:subscribe',
  'settings:own'
] as const
```

The header comment at `:10-12` states the closure explicitly: *"v0 is a closed set of unscoped
kinds so a typo (or a capability from a newer Orca) fails manifest validation instead of silently
granting nothing."*

**Evidence 2 — `contributes` is a strict object with seven keys, none of them tools or MCP.**
`src/shared/plugins/plugin-manifest.ts:99-129` — `panels`, `commands`, `events`, `languagePacks`,
`keybindings`, `vmRecipes`, `agents`, closed with `.strict()` at `:120`. An unknown key fails
manifest validation, so a plugin cannot declare a tool contribution even speculatively.

**Evidence 3 — zero MCP references in the plugin system.**

```
$ grep -rniE 'mcp' src/shared/plugins/ src/main/plugins/ src/preload/api/plugin-host-api.ts examples/plugins/
(no output)
```

ORCA does contain MCP code, but it is **read-only diagnostics of the user's own config files**, not
a server ORCA hosts. `src/shared/mcp-config.ts:43-58` enumerates candidate paths (`.mcp.json`,
`.cursor/mcp.json`, Claude's) and `McpConfigInspection` reports `'missing' | 'valid' | 'invalid'`
per file. ORCA reads MCP config to render a settings diagnostics list
(`src/renderer/src/components/settings/McpConfigSection.tsx`). It never spawns, registers, or
proxies an MCP server.

**What it means for our design.** T140's agent-controlled spoken channel cannot be an MCP tool
contributed by the plugin. If we want an MCP tool, it must be a **separate MCP server the user
installs into their agent's own MCP config**, entirely outside ORCA's plugin system — which also
means it is outside plugin install, consent, and distribution. Design 002 must not assume a tool.

---

## Q3 — Any supported channel to inject instructions into the agent's system prompt / CLAUDE.md?

**Verdict: RESOLVED NEGATIVE.** No. ORCA never constructs a system prompt at all — it launches
agent CLIs in terminals — and the one contribution that looks like it might do this
(`contributes.agents`) is validated but wired to nothing.

**Evidence 1 — ORCA has no system-prompt surface.**

```
$ grep -rn "appendSystemPrompt\|systemPrompt\|CLAUDE.md" src/ --include='*.ts' --include='*.tsx' | grep -v test
src/renderer/src/components/terminal-link-provider-buffer-fixtures.ts:68:    ['/repo/CLAUDE.md', true],
src/shared/native-chat-slash-commands.ts:28:  { name: 'init', description: 'Initialize a CLAUDE.md' },
```

Two hits: a terminal-link test fixture, and the *label text* for the agent's own `/init` slash
command. ORCA never writes, reads, or appends to `CLAUDE.md`, and has no `systemPrompt` concept.

**Evidence 2 — `contributes.agents` is validated for existence and size, then dropped on the
floor.** The schema is real, `src/shared/plugins/plugin-content-pack-contributions.ts:48-50`:

```ts
export const pluginAgentProfileContributionSchema = z
  .object({ path: pluginRelativePathSchema })
  .strict()
```

It is checked for containment and byte cap, `src/main/plugins/plugin-artifact-validation.ts:60-65`:

```ts
    ...manifest.contributes.agents.map((agent) => ({
      label: 'agent profile',
      path: agent.path,
      kind: 'file' as const,
      maxBytes: PLUGIN_AGENT_PROFILE_MAX_BYTES
    }))
```

It is treated as consent-relevant "instructional content",
`src/shared/plugins/plugin-consent-fingerprint.ts:9-17`. And then **nothing loads it**. Compare the
registry that publishes contributions, `src/main/plugins/plugin-content-pack-registry.ts:13-27`:

```ts
export class PluginContentPackRegistry {
  readonly languagePacks: PluginLanguagePackRegistry
  readonly vmRecipes: PluginVmRecipeRegistry
  readonly commands: PluginCommandRegistry
```

No agent-profile registry. `grep -rn "agent" src/main/plugins/plugin-content-pack-registry.ts`
returns nothing. The only two references to `contributes.agents` in all of `src/main/plugins/` are
the validation line above and a test fixture. There is no consumer, no publication path, and no
agent that ever sees the file.

**Evidence 3 — the adjacent-sounding `native-chat-agent-profiles.ts` is unrelated.**
`src/shared/native-chat-agent-profiles.ts:4-8` defines `NativeChatAgentProfile` as
`{ skillPrefix: '$' | '/', groupedSlash: boolean, skillSourceOwner: AgentType }` — slash-command UI
policy for the composer. It is a hardcoded table keyed by agent type, not plugin-extensible.

**Evidence 4 — skills, the other plausible route, hard-reject.**
`src/shared/plugins/plugin-marketplace.ts:14-25` lists `'skills'` among
`UNSUPPORTED_MARKETPLACE_CATEGORIES`, with the comment *"theme/icon/skill contributions were
deferred, so `contributes` now rejects them and any plugin declaring one fails to install
wholesale."*

**What it means for our design.** The agent cannot be told our channel exists by any plugin
mechanism. Any convention the agent must follow has to be installed by the **user**, by hand, into
their own `CLAUDE.md` or agent config — which makes it a documentation-and-onboarding problem, not a
code problem. Design 002 must budget for "most agents will not cooperate" as the default case
(Q6), because there is no supported way to make them.

There is one **indirect** channel worth naming: `terminal.sendText` types text into a specific
terminal, and the agent is running in a terminal. See "Surprises" below.

---

## Q9 — Upstream state of #15643 and #15638

**Verdict: RESOLVED.** `gh` CLI is available (`/opt/homebrew/bin/gh`, v2.95.0) and authenticated.
Both are **OPEN and untouched by any human at stablyai**. Checked 2026-08-21.

| Ref | Kind | State | Last activity | Human engagement |
|---|---|---|---|---|
| [#15643](https://github.com/stablyai/orca/pull/15643) | PR — panels may call `storage.get` | **OPEN**, `mergedAt: null`, `closedAt: null` | 2026-08-20T21:51:49Z | none — 1 comment + 1 review, both `coderabbitai` (bot) |
| [#15638](https://github.com/stablyai/orca/issues/15638) | Issue — no host→panel channel | **OPEN** | 2026-08-20T21:46:56Z | 1 comment, by `YoraiLevi` (us) |
| [#15637](https://github.com/stablyai/orca/issues/15637) | Issue — no route to assistant text | **OPEN** | 2026-08-20T21:46:57Z | 1 comment, by us |
| [#15639](https://github.com/stablyai/orca/issues/15639) | Issue — no session id on the event | **OPEN** | 2026-08-20T20:05:15Z | 0 comments |
| [#15640](https://github.com/stablyai/orca/pull/15640) | PR — project `sessionId` | **OPEN** | 2026-08-20T20:11:31Z | 1 comment, `coderabbitai` (bot) |
| [#15642](https://github.com/stablyai/orca/issues/15642) | Issue — keybindings dead in terminal focus | **OPEN** | 2026-08-20T20:45:36Z | 0 comments |

The only third-party engagement on the whole set is CodeRabbit, an automated reviewer. Its verdict
on #15643 was *"Merge Risk: ⚪ Minimal"* with one style nitpick. No maintainer has commented,
reviewed, assigned, or labelled anything. Corroborating detail: the PR branch's test file
`src/shared/plugins/plugin-panel-storage-read.test.ts` does not exist on our checkout, confirming
#15643 is not in `main`.

**What it means for our design.** Every upstream unblock we filed is a **cold** open item, one day
old with zero maintainer signal. M13 and any design that assumes `storage.get` from a panel must be
designed to work without it, and to light up if it lands. Do not schedule work behind these.

---

## Q10 — Is `storage.set` callable FROM A PANEL today, independently of `get`?

**Verdict: RESOLVED NEGATIVE.** No. `storage.set` is `panel: false`. So are `storage.get`,
`storage.delete`, `storage.keys`, all three `secrets.*`, both `settings.*`, and
`events.subscribe`. **Exactly three** host methods are panel-callable.

`src/shared/plugins/plugin-host-api.ts:163-172`:

```ts
  spec({
    name: 'storage.set',
    since: '1.0',
    scope: 'plugin-private',
    capability: 'storage',
    mutation: true,
    panel: false,
    params: storageSetParams,
    result: storageSetResult
  }),
```

The field's meaning is documented at `plugin-host-api.ts:108-110`: *"Whether sandboxed panels may
call this over the postMessage bridge. Workers can call every method."* The panel action set is
derived, not hand-maintained — `plugin-host-api.ts:261-265`:

```ts
/** Actions sandboxed panels may request over the postMessage bridge. Derived
 *  from the spec table so the panel surface can never drift from the gate. */
export const PLUGIN_PANEL_ACTIONS = PLUGIN_HOST_API_V0.filter((entry) => entry.panel).map(
  (entry) => entry.name
)
```

Filtering the table by `panel: true` yields exactly:

| Panel-callable method | Capability | Mutation | Line |
|---|---|---|---|
| `workspace.readContext` | `workspace:read` | no | `:123-132` |
| `terminal.sendText` | `terminal:send` | **yes** | `:133-142` |
| `notifications.show` | `notifications:show` | **yes** | `:143-152` |

Enforcement is a hard refusal, not a silent no-op —
`src/shared/plugins/plugin-capability-gate.ts:39-45`:

```ts
  if (subject.viaPanel && !isPluginPanelAction(method)) {
    return {
      granted: false,
      code: 'panel_forbidden',
      error: `method ${method} is not available to sandboxed panels`
    }
  }
```

Pinned by a conformance test at `src/main/plugins/plugin-host-conformance.test.ts:201-207`, which
asserts `storage.get` `viaPanel: true` returns `code: 'panel_forbidden'` even when the `storage`
capability **is** granted.

**What it means for our design.** There is **no storage-flag command channel from a panel today**,
in either direction. Q12's "storage flag as command channel" is not implementable from the panel
side as specified; it works only worker→worker. But panel buttons are **not** dead — see below.

---

## Q11 — Exact panel-bridge rate limit and payload cap

**Verdict: RESOLVED — our vendored numbers are CORRECT.** 30 messages per 10 000 ms, 64 KB per
message, per plugin. `src/shared/plugins/plugin-panel-bridge.ts:21-30`:

```ts
/** Per-plugin bridge budgets, enforced host-side. */
export const PANEL_MESSAGE_MAX_BYTES = 64 * 1024
export const PANEL_MESSAGE_RATE_LIMIT = { maxMessages: 30, perMs: 10_000 }

/** Size cap for the reserved liveness lane. Deliberately size-only: any
 *  per-window count on this lane can be spent by the panel's own pongs and
 *  would drop the next genuine reply, which is the starvation this reserved
 *  lane exists to prevent. Aggregate cost stays bounded because pongs are also
 *  charged to the data budget and cost O(1) plus a walk capped here. */
export const PANEL_CONTROL_MESSAGE_MAX_BYTES = 1024
```

Four corrections/additions our vendored note does not carry:

1. **The window is sliding, not fixed.** `plugin-panel-message-budget.ts:29-38` evicts timestamps
   older than `now - perMs` before each admission.
2. **Oversized messages still spend rate budget.** Same file, `:33-42`: the rate check runs first
   and pushes a timestamp *before* the size check. Comment: *"Oversized and malformed traffic still
   spends rate budget; otherwise it can force unbounded size-estimation work for free."* A panel
   that sends 30 oversized messages is rate-limited for the rest of the window.
3. **The budget is per qualified plugin identity, shared across every panel session** —
   `plugin-panel-call-admission.ts:35-36`: *"One budget per qualified plugin identity, shared by
   every panel session using this transport boundary."* Two panels of ours share one budget.
4. **The 64 KB is a structured-clone byte estimate, not `JSON.stringify().length`** —
   `plugin-panel-message-budget.ts:77-199`. Numbers count 8 bytes, array entries cost 4 bytes of
   overhead each, object keys cost 4 + their UTF-8 length. A non-plain prototype, a function, or a
   symbol sets the total straight over the cap (`:113`, `:184`). Depth > 100 or > 10 000 nodes also
   fails (`:125-128`).

Also relevant, same file `plugin-panel-bridge.ts:35-36`: `PANEL_WATCHDOG_PING_INTERVAL_MS = 10_000`,
`PANEL_WATCHDOG_PONG_TIMEOUT_MS = 5_000` — a panel that misses a pong deadline is demoted to an
errored badge.

**What it means for our design.** 30 msg / 10 s = **one message every 333 ms sustained**. That is
the hard ceiling on any panel-side poll loop, and it is shared across all our panels. A 1 Hz poll
from two panels would consume 60 messages per 10 s and be refused. Budget one poll every ~500 ms
from a single panel, or accept refusals. Q13's Stop latency must be quoted against this ceiling.

---

## Q15 — Is ORCA's first-party STT reachable from a plugin?

**Verdict: RESOLVED NEGATIVE.** No. The STT stack is main-process code exposed over Electron IPC to
ORCA's **own** renderer only. A plugin worker cannot reach it, and a plugin panel cannot reach it.

**Evidence 1 — the stack exists and is substantial.** `src/main/speech/` contains 27 files:
`stt-service.ts`, `stt-worker.ts`, `stt-audio-resample.ts`, `stt-offline-audio-chunker.ts`,
`model-catalog.ts`, `model-manager.ts`, `openai-transcription-client.ts`,
`openai-api-key-store.ts`, `speech-runtime-service.ts`, and their tests.

**Evidence 2 — its only exposure is `contextBridge` on `window.api.speech`.**
`src/preload/index.ts:5049-5078`:

```ts
  speech: {
    getCatalog: (): Promise<SpeechModelManifest[]> => ipcRenderer.invoke('speech:getCatalog'),
    getModelStates: (): Promise<SpeechModelState[]> => ipcRenderer.invoke('speech:getModelStates'),
    ...
    ): Promise<void> => ipcRenderer.invoke('speech:startDictation', modelId, hotwords, sessionId),
    ...
      ipcRenderer.invoke('speech:stopDictation', sessionId),
```

with `speech:partial`, `speech:final`, `speech:ready`, `speech:stopped`, `speech:error`, and
`speech:downloadProgress` push events at `:5083-5118`.

**Evidence 3 — a plugin panel has no preload, so no `window.api`.**
`src/renderer/src/components/right-sidebar/PluginPanel.tsx:223-226`:

```
      // SECURITY: never add allow-same-origin — the srcdoc frame must stay an
      // ... The srcdoc itself is the host CSP shell wrapped around plugin HTML.
      sandbox="allow-scripts"
```

`sandbox="allow-scripts"` with no `allow` attribute and no preload. The CSP compounds it —
`src/shared/plugins/plugin-panel-shell.ts:20-22`:

```ts
export const PLUGIN_PANEL_CSP =
  "default-src 'none'; connect-src 'none'; script-src 'unsafe-inline'; " +
  "style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"
```

No `media-src`, no `connect-src` — so a panel cannot fetch, cannot open a socket, and cannot load
audio. It also gets no microphone: no `allow="microphone"` on the iframe.

**Evidence 4 — the host API has no speech method.** The thirteen entries of `PLUGIN_HOST_API_V0`
(`plugin-host-api.ts:122-253`) are the complete set; `settings.set` is the last before
`events.subscribe`. A binding-count assertion at `plugin-host-method-bindings.ts:173-177` fails at
module load if the two ever diverge, so the surface cannot quietly grow.

**What it means for our design.** T170 voice input cannot reuse ORCA's STT. Our options are: ship
our own STT in the plugin worker (which is a plain forked Node process and can spawn/load anything,
subject to the 50 MB / 2 000 file plugin cap of P4 — Q17), or file an upstream capability request.
Q16 and Q17 remain live and unanswered; this answer only closes the "just reuse ORCA's" door.

---

## Q35 — What does ORCA's settings capability actually RENDER?

**Verdict: RESOLVED NEGATIVE.** **Nothing.** It renders no controls and no text area. There is no
settings *contribution* in the manifest at all. `settings:own` grants a plugin a second private
key-value JSON file, readable and writable only by its own worker. There is no host-rendered
settings UI for plugin settings of any kind.

**Evidence 1 — no `settings` key in `contributes`, and the object is strict.**
`src/shared/plugins/plugin-manifest.ts:99-120` — the seven keys are `panels`, `commands`, `events`,
`languagePacks`, `keybindings`, `vmRecipes`, `agents`, then `.strict()`. A manifest declaring a
settings schema fails validation.

**Evidence 2 — the "settings" API is an untyped `Record<string, JSON>`.**
`plugin-host-api.ts:88-91`:

```ts
const settingsGetParams = z.object({}).strict().optional()
const settingsGetResult = z.object({ settings: z.record(z.string(), pluginJsonValueSchema) })
const settingsSetParams = z.object({ key: storageKeySchema, value: pluginJsonValueSchema })
const settingsSetResult = z.object({ ok: z.literal(true) })
```

No schema, no type, no label, no control hint, no default. Nothing a form could be generated from.

**Evidence 3 — the implementation is literally a second `storage`.**
`src/main/plugins/plugin-host-service-bindings.ts:79-82`:

```ts
    settings: {
      getAll: (key) => new PluginKvStore(pluginsDataDir, key, 'settings.json').getAll(),
      set: (itemKey, value) =>
        new PluginKvStore(pluginsDataDir, key, 'settings.json').set(itemKey, value)
```

Identical machinery to `storage`, differing only in the filename and the capability name. The
consent copy is honest about it, `plugin-capabilities.ts:43`:
`'settings:own': "Read and change the plugin's own settings"`.

**Evidence 4 — the renderer has no plugin-settings form.** `src/renderer/src/components/settings/`
has 28 plugin files. All of them manage the *plugin lifecycle*: `PluginConsentDialog`,
`PluginInstallDialog`, `PluginMarketplaceBrowser`, `PluginRemoveDialog`, `PluginRollbackDialog`,
`PluginSettingsRow`, `PluginSettingsOverview`. `PluginSettingsRow.tsx` (334 lines) renders a status
badge, an enable switch, and a dropdown of Review / Logs / Rollback / Remove — its props are
`onReview`, `onToggleEnabled`, `onToggleLogs`, `onRollbackRequest`, `onRemoveRequest`
(`PluginSettingsRow.tsx:31-41`). There is no per-plugin settings pane, no schema renderer, and no
"Configure" action anywhere.

Note also: **`settings.get` and `settings.set` are `panel: false`** (`plugin-host-api.ts:229`,
`:239`), so a panel cannot even read the plugin's own settings to render them itself.

**What it means for our design.** T120's settings surface must be **built entirely by us**, and it
cannot live in ORCA's settings window. The realistic homes are (a) our own plugin panel, hand-rolled
HTML+CSS under the panel CSP, with the worker owning the write path since the panel cannot call
`settings.set`; or (b) the Voice Lab (M11), which is our own surface with no host constraints at
all. **Target a form we render, not a host-rendered form and not a JSON text area.** Given that a
panel can neither read nor write settings today, (b) is the only one that works without upstream
change. Q36's "one schema shared by plugin and lab" gains force: the schema is ours alone, so
sharing it costs nothing and the lab is the natural editor.

---

## Surprises — what we appear NOT to be using

### S1 — `terminal.sendText` is panel-callable, and the agent lives in a terminal

`plugin-host-api.ts:133-142`, capability `terminal:send`, `mutation: true`, `panel: true`. Params
(`:45-51`): `{ terminalId, text (1..4096 chars), enter (default false) }`. Result:
`{ accepted: boolean }`.

The target is deliberately explicit, `plugin-host-api.ts:46-47`:

```ts
  /** Explicit target. Never "the active terminal": a focus change must not
   *  redirect a delayed plugin write into another pane (design-doc rule). */
```

and `workspace.readContext` (`panel: true`, `:123-132`) returns exactly the terminal ids needed to
address one — `terminals: [{ id }]`, up to `PLUGIN_WORKSPACE_TERMINAL_LIMIT = 50`
(`plugin-host-api.ts:21`), with `branch` and `displayName`.

**Three consequences we have not exploited.**

1. **Panel buttons already work.** Q10's framing ("this decides whether panel buttons can work at
   all") is answered yes by a different route than storage. A panel button can address a terminal
   and type into it *today*, with no upstream change.
2. **This is the closest thing to Q3's missing channel.** A worker or a panel can type a sentence
   into the terminal the agent is running in, with `enter: true`. That is a real, supported,
   consented way to say something to the agent — an out-of-band user turn. It is coarse and it is
   visible in the transcript, but it exists, and design 002 should evaluate it as an option rather
   than assume no channel exists.
3. **It is also a receive-user-input path in reverse.** The panel is the only place a plugin can
   render an input; `terminal.sendText` is the only place that input can go.

Caveat, stated plainly: text typed this way lands as a user turn in the agent's terminal, which
means it appears in the transcript and consumes agent attention. Whether that is acceptable is a
design question (Q5/Q7), not an empirical one.

### S2 — `notifications.show` is panel-callable and we can show status without a panel at all

`plugin-host-api.ts:143-152`, capability `notifications:show`, `panel: true`. Params (`:54-57`):
`{ title (1..120), body (0..1000, optional) }`, result `{ delivered: boolean }`. Consent copy:
*"Show desktop notifications labeled with the plugin name"* (`plugin-capabilities.ts:38`).

This is a status channel that needs no panel, no sidebar, and no upstream change, and it returns
`delivered` so we can tell whether it landed. For "which session am I reading" and "N replies were
skipped" — the exact P22 failures — this is available today. The example plugin uses it
(`examples/plugins/hello-orca/main.mjs:16-19`).

### S3 — A plugin command can alias 15 built-in ORCA actions, including opening its own sidebar

`src/shared/plugins/plugin-command-actions.ts:5-21`:

```ts
export const PLUGIN_COMMAND_ALIAS_ACTION_IDS = [
  'worktree.history.back',
  'worktree.history.forward',
  'sidebar.left.toggle',
  'sidebar.sleepingWorkspaces.toggle',
  'floatingWorkspace.maximize',
  'tab.rename',
  'workspace.rename',
  'workspace.openBoard',
  'view.tasks',
  'sidebar.right.toggle',
  'sidebar.explorer.toggle',
  'sidebar.search.toggle',
  'sidebar.sourceControl.toggle',
  'sidebar.checks.toggle',
  'sidebar.ports.toggle'
] as const satisfies readonly KeybindingActionId[]
```

`sidebar.right.toggle` is the right sidebar — where plugin panels live
(`PluginPanel.tsx` is under `components/right-sidebar/`). We can ship a keybinding whose command
opens the panel. Combined with S2 and S1, the "panel that shows what is happening" (M13) has more
reach than we credited it with, even before #15643 lands.

### S4 — `agent.status.changed` also carries `receivedAt`, which we may not be using

`src/shared/plugins/plugin-events.ts:28-33`:

```ts
export const agentStatusChangedPayloadSchema = z.object({
  worktreeId: z.string().min(1).max(2048).nullable(),
  paneKey: z.string().min(1).max(2048),
  state: z.string().min(1).max(256),
  receivedAt: z.number().finite().positive()
})
```

Four fields, not three. `receivedAt` is a host-side timestamp for when the status arrived. P20's
fix (watch the transcript file, keep the watch open `WATCH_WINDOW_MS` past the event) could anchor
its window on `receivedAt` rather than local `Date.now()`, which removes one source of clock skew
between the host and our worker. Also worth noting `worktreeId` is **nullable** — a status change
can arrive with no worktree, which our session-locking logic (P22) must handle.

### S5 — The panel watchdog can mark our panel errored, silently to us

`plugin-panel-bridge.ts:32-36`: the host pings every 10 s and expects a pong within 5 s; *"a panel
that misses a pong deadline is demoted to an errored badge."* A panel doing heavy synchronous work
— rendering a long transcript, decoding audio — can miss the deadline and be demoted while it is
still functioning. Our panel must yield often enough to answer pings. The pong lane has its own
1 KB size-only budget (`:30`) so pongs cannot be rate-limited away, but they **are** also charged to
the data budget of 30 per 10 s (`plugin-panel-message-budget.ts:47-52`) — meaning the watchdog's
own traffic eats roughly 1 of our 30 message slots per window.

### S6 — Nine distinct panel error codes, so failures are legible if we read them

`plugin-panel-bridge.ts:53-62`: `invalid_request`, `unknown_method`, `capability_denied`,
`consent_required`, `panel_forbidden`, `invalid_params`, `rate_limited`, `unavailable`,
`action_failed`. Every one arrives as a structured `{ ok: false, code, error }`
(`PluginPanelActionResultMessage`, `:64-72`). Directly relevant to P18: the host does **not** fail
silently — it names the reason. Any adapter we write on the panel side must surface `errorCode`
rather than collapse it to a boolean, or we recreate P18 on the panel bridge.

---

## Summary table

| Q | Verdict | One-line consequence |
|---|---|---|
| Q1 | RESOLVED NEGATIVE | No MCP, no tools, no such concept. Design 002 cannot use a tool. |
| Q3 | RESOLVED NEGATIVE | No prompt channel; `contributes.agents` is validated but unwired. `terminal.sendText` is the only indirect route. |
| Q9 | RESOLVED | All six upstream items OPEN, one day old, zero maintainer engagement. Do not schedule behind them. |
| Q10 | RESOLVED NEGATIVE | `storage.set` is `panel: false`; only three methods are panel-callable. Panel buttons work — via `terminal.sendText`, not storage. |
| Q11 | RESOLVED — vendored numbers CORRECT | 30 / 10 s, 64 KB, sliding window, per-plugin not per-panel, oversized still spends budget. |
| Q15 | RESOLVED NEGATIVE | STT is main-process + host renderer only. Panels have no preload, no mic, no `connect-src`. |
| Q35 | RESOLVED NEGATIVE | Renders nothing. No settings contribution exists; `settings:own` is a second KV file. Build our own form, in the Voice Lab. |
