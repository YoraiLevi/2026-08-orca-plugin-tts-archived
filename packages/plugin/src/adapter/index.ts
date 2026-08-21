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

/** Options for a single notification. */
export interface NotifyOptions {
  /**
   * True when the caller has ALREADY put this message in the audio stream. Suppresses the
   * spoken fallback below, so a message is never heard twice.
   */
  readonly alreadySpoken?: boolean
}

/**
 * Why a storage call failed, instead of `undefined`.
 *
 * 006 site 19: `storage.get` catches everything and returns `undefined`, which is
 * INDISTINGUISHABLE FROM "the key is not set" — and six-plus ORCA error codes (consent refused,
 * capability missing, rate limit, host error) all arrive that way. That is how huddle mode comes
 * back OFF after a worker reap with nothing said (TT14, cascade C4 step 1).
 */
export interface StorageFailure {
  readonly op: 'get' | 'set'
  readonly key: string
  readonly reason: string
}

export interface HostHooks {
  /**
   * A desktop notification that ORCA reported as NOT delivered.
   *
   * 006 section 19 ranks this number TWO of the things we cannot detect: `notifications.show`
   * returns `{ delivered }` and `adapter/index.ts:63` discarded it, so every "never fail silently"
   * path in the plugin terminated in a call whose failure was invisible. The plugin believed it
   * spoke. The cost of fixing it is one conditional; the cost of not fixing it is every
   * announcement in the FMA being delivered to nobody.
   */
  readonly onUndelivered?: (message: string) => void
  readonly onStorageFailure?: (failure: StorageFailure) => void
  /**
   * A registered command's handler threw. Site 22: `{ ok: false }` went back to the host and
   * nowhere audible, so the listener pressed a key and got exactly the same nothing a dead
   * keybinding gives them (006 section 19 rank 4 — "whether a control fired").
   */
  readonly onCommandFailed?: (id: string, reason: string) => void
}

export interface Host {
  log(message: string): void
  /** Desktop notification. Falls back to the log if the capability is denied. */
  notify(title: string, body?: string, opts?: NotifyOptions): void
  storageGet(key: string): Promise<unknown>
  storageSet(key: string, value: unknown): Promise<void>
  onEvent(name: string, handler: (payload: unknown) => void): void
  registerCommand(id: string, handler: () => void | Promise<void>): void
  /**
   * How many `orca.log` calls threw. Site 17: the log call is itself wrapped in `catch {}`, so
   * every log-only report in the plugin can degrade to nothing at all with no trace. Nothing can
   * report a dead log THROUGH the log, so it is reported as a number a caller can read.
   */
  logFailures(): number
}

/**
 * Adapts the real `orca` object to our internal `Host`.
 *
 * Defensive on purpose: a missing method degrades to a logged no-op rather than taking the plugin
 * down (R024). But note the lesson from P18 — defensiveness HIDES a wrong method name. The
 * `registeredCommands` counter exists so activate() can assert it actually wired something up.
 */
export function makeHost(
  orca: OrcaApi, hooks: HostHooks = {}
): Host & { registeredCommands: () => number } {
  let registered = 0
  let logFailures = 0
  const log = (m: string): void => {
    // Still swallowed — a plugin must not die because its host log threw — but COUNTED. Site 17:
    // this is the drain every log-only report in the plugin runs into, and it was invisible.
    try { orca.log(m) } catch { logFailures++ }
  }

  return {
    log,
    logFailures: () => logFailures,
    registeredCommands: () => registered,

    notify(title: string, body?: string, opts: NotifyOptions = {}): void {
      const params: Record<string, unknown> = { title: title.slice(0, 120) }
      if (body !== undefined) params['body'] = body.slice(0, 1000)
      const message = body ?? title
      const undelivered = (why: string): void => {
        log(`notification not delivered (${why}): ${message}`)
        // Site 18 / section 19 rank 2. The receipt was computed by ORCA and thrown away here, so a
        // muted tray, focus assist or a revoked permission silenced every announcement in this
        // plugin while it reported success. If the caller has not already spoken it, speak it.
        if (opts.alreadySpoken !== true) hooks.onUndelivered?.(message)
      }
      void Promise.resolve(orca.host.call('notifications.show', params))
        .then((r) => {
          // `{ delivered: false }` is a SUCCESSFUL call reporting a failed delivery. Only reading
          // the rejection — which is what this did — cannot see it at all.
          if ((r as { delivered?: unknown } | undefined)?.delivered === false) undelivered('reported undelivered')
        })
        .catch((err: unknown) => { undelivered(String(err)) })
    },

    async storageGet(key: string): Promise<unknown> {
      try {
        const r = await orca.host.call('storage.get', { key })
        return (r as { value?: unknown } | undefined)?.value
      } catch (err) {
        // Site 19: `undefined` here is indistinguishable from "the key is not set", and that is
        // how huddle mode comes back off after a worker reap with nothing said.
        hooks.onStorageFailure?.({ op: 'get', key, reason: String(err) })
        return undefined
      }
    },

    async storageSet(key: string, value: unknown): Promise<void> {
      try {
        await orca.host.call('storage.set', { key, value })
      } catch (err) {
        // Site 20. A failed `set` means the NEXT worker starts from stale state — a re-spoken
        // backlog, or a lock that reverts to whichever session was touched last.
        hooks.onStorageFailure?.({ op: 'set', key, reason: String(err) })
      }
    },

    onEvent(name: string, handler: (payload: unknown) => void): void {
      try {
        orca.events.on(name, handler)
      } catch (err) {
        // Site 21: no events, ever, means huddle never starts watching anything. It stays a log
        // line here because the host wires the audible half — this is the quarantine boundary
        // (R020), and it has no opinion about how the plugin talks to its user.
        log(`could not subscribe to ${name}: ${String(err)}`)
        hooks.onUndelivered?.(`Huddle could not subscribe to ${name}, so agent replies will not be spoken.`)
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
            hooks.onCommandFailed?.(id, String(err))
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
