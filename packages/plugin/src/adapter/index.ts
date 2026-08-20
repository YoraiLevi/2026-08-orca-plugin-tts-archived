/**
 * ORCA API quarantine.
 *
 * EVERY call into ORCA's plugin host happens here and nowhere else (constitution R020). The host
 * API is EXPERIMENTAL with an explicit no-compatibility promise, so when it breaks, it breaks in
 * one file.
 *
 * Shapes verified against `examples/plugins/hello-orca/main.mjs` and
 * `src/shared/plugins/plugin-host-api.ts` at commit 0f26ff4a — NOT guessed. An earlier version of
 * this file invented `registerCommand` / `onEvent` / `notify`; every one of them silently no-oped,
 * so no command was ever registered and ORCA reported "Could not run the plugin command"
 * (PITFALLS P18).
 */

/** The four-field projection ORCA emits. Verified: plugin-events.ts:28-33. */
export interface AgentStatusChanged {
  readonly worktreeId: string | null
  readonly paneKey: string
  readonly state: string
  readonly receivedAt: number
  /** Present only once stablyai/orca#15640 lands. */
  readonly sessionId?: string | null
}

/** The object ORCA passes to `activate(orca)`. */
export interface OrcaApi {
  commands: { register(id: string, handler: (args?: unknown) => unknown): void }
  events: { on(name: string, handler: (payload: unknown) => void): void }
  host: { call(action: string, params?: Record<string, unknown>): Promise<unknown> }
  log(message: string): void
}

export interface Host {
  log(message: string): void
  /** Desktop notification. Falls back to the log if the capability is denied. */
  notify(title: string, body?: string): void
  storageGet(key: string): Promise<unknown>
  storageSet(key: string, value: unknown): Promise<void>
  onEvent(name: string, handler: (payload: unknown) => void): void
  registerCommand(id: string, handler: () => void | Promise<void>): void
}

/**
 * Adapts the real `orca` object to our internal `Host`.
 *
 * Defensive on purpose: a missing method degrades to a logged no-op rather than taking the plugin
 * down (R024). But note the lesson from P18 — defensiveness HIDES a wrong method name. The
 * `registeredCommands` counter exists so activate() can assert it actually wired something up.
 */
export function makeHost(orca: OrcaApi): Host & { registeredCommands: () => number } {
  let registered = 0
  const log = (m: string): void => {
    try { orca.log(m) } catch { /* the host log is best-effort */ }
  }

  return {
    log,
    registeredCommands: () => registered,

    notify(title: string, body?: string): void {
      const params: Record<string, unknown> = { title: title.slice(0, 120) }
      if (body !== undefined) params['body'] = body.slice(0, 1000)
      void Promise.resolve(orca.host.call('notifications.show', params)).catch(() => {
        log(`notification suppressed: ${title}`)
      })
    },

    async storageGet(key: string): Promise<unknown> {
      try {
        const r = await orca.host.call('storage.get', { key })
        return (r as { value?: unknown } | undefined)?.value
      } catch { return undefined }
    },

    async storageSet(key: string, value: unknown): Promise<void> {
      try { await orca.host.call('storage.set', { key, value }) } catch { /* non-fatal */ }
    },

    onEvent(name: string, handler: (payload: unknown) => void): void {
      try {
        orca.events.on(name, handler)
      } catch (err) {
        log(`could not subscribe to ${name}: ${String(err)}`)
      }
    },

    registerCommand(id: string, handler: () => void | Promise<void>): void {
      try {
        orca.commands.register(id, async () => {
          try {
            await handler()
            return { ok: true }
          } catch (err) {
            log(`command ${id} failed: ${String(err)}`)
            return { ok: false, error: String(err) }
          }
        })
        registered++
      } catch (err) {
        log(`could not register command ${id}: ${String(err)}`)
      }
    }
  }
}

/** Narrows an untyped event payload to the projection, or null. Never throws. */
export function asAgentStatus(payload: unknown): AgentStatusChanged | null {
  if (typeof payload !== 'object' || payload === null) return null
  const p = payload as Record<string, unknown>
  if (typeof p['paneKey'] !== 'string' || typeof p['state'] !== 'string') return null
  const out: AgentStatusChanged = {
    worktreeId: typeof p['worktreeId'] === 'string' ? p['worktreeId'] : null,
    paneKey: p['paneKey'],
    state: p['state'],
    receivedAt: typeof p['receivedAt'] === 'number' ? p['receivedAt'] : 0
  }
  return typeof p['sessionId'] === 'string' ? { ...out, sessionId: p['sessionId'] } : out
}

/**
 * `worktreeId` is `<repoId>::<absolute path>` (measured, E3). It is the ONLY correlation handle a
 * plugin gets today — `paneKey` is `<tabId>:<layoutLeaf>` and carries no session id.
 */
export function worktreePathFrom(worktreeId: string | null): string | null {
  if (worktreeId === null) return null
  const sep = worktreeId.indexOf('::')
  const path = sep === -1 ? worktreeId : worktreeId.slice(sep + 2)
  return path.length > 0 ? path : null
}
