/**
 * ORCA API quarantine.
 *
 * EVERY call into ORCA's plugin host happens here and nowhere else (constitution R020). The host
 * API is EXPERIMENTAL with an explicit no-compatibility promise, so when it breaks, it breaks in
 * one file. Nothing below this layer knows ORCA exists.
 */

/** The four-field projection ORCA actually emits. Verified: plugin-events.ts:28-33. */
export interface AgentStatusChanged {
  readonly worktreeId: string | null
  readonly paneKey: string
  readonly state: string
  readonly receivedAt: number
}

export interface OrcaHost {
  log(message: string): void
  notify(message: string): void
  storageGet(key: string): Promise<unknown>
  storageSet(key: string, value: unknown): Promise<void>
  onEvent(name: string, handler: (payload: unknown) => void): void
  registerCommand(id: string, handler: () => void | Promise<void>): void
}

/** Shape of the object ORCA passes to `activate`. Kept minimal and defensive. */
export interface OrcaActivateContext {
  readonly orca?: Partial<OrcaHost>
}

const noop = (): void => {}

/**
 * Wraps the host with total defensiveness: a missing or renamed method degrades to a no-op and a
 * log line rather than taking the plugin down (R024 — contain failures; an engine crash stops
 * speech, not ORCA).
 */
export function makeHost(ctx: OrcaActivateContext): OrcaHost {
  const o = ctx.orca ?? {}
  const safe = <T extends unknown[], R>(
    fn: ((...args: T) => R) | undefined, fallback: R
  ) => (...args: T): R => {
    try { return fn === undefined ? fallback : fn(...args) } catch { return fallback }
  }

  return {
    log: safe(o.log?.bind(o), undefined) as (m: string) => void,
    notify: safe(o.notify?.bind(o) ?? o.log?.bind(o), undefined) as (m: string) => void,
    storageGet: safe(o.storageGet?.bind(o), Promise.resolve(undefined)) as (k: string) => Promise<unknown>,
    storageSet: safe(o.storageSet?.bind(o), Promise.resolve()) as (k: string, v: unknown) => Promise<void>,
    onEvent: safe(o.onEvent?.bind(o), undefined) as (n: string, h: (p: unknown) => void) => void,
    registerCommand: safe(o.registerCommand?.bind(o), undefined) as
      (id: string, h: () => void | Promise<void>) => void
  } satisfies OrcaHost & Record<string, unknown> as OrcaHost
}

void noop

/** Narrows an untyped event payload to the projection, or null. Never throws. */
export function asAgentStatus(payload: unknown): AgentStatusChanged | null {
  if (typeof payload !== 'object' || payload === null) return null
  const p = payload as Record<string, unknown>
  if (typeof p['paneKey'] !== 'string' || typeof p['state'] !== 'string') return null
  return {
    worktreeId: typeof p['worktreeId'] === 'string' ? p['worktreeId'] : null,
    paneKey: p['paneKey'],
    state: p['state'],
    receivedAt: typeof p['receivedAt'] === 'number' ? p['receivedAt'] : 0
  }
}

/**
 * `worktreeId` is `<repoId>::<absolute path>` (measured, E3). It is the ONLY usable correlation
 * handle a plugin gets — `paneKey` is `<tabId>:<layoutLeaf>` and carries no session id.
 */
export function worktreePathFrom(worktreeId: string | null): string | null {
  if (worktreeId === null) return null
  const sep = worktreeId.indexOf('::')
  const path = sep === -1 ? worktreeId : worktreeId.slice(sep + 2)
  return path.length > 0 ? path : null
}
