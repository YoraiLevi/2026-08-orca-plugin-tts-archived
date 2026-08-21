/** Selects a provider and reports which rung of the degradation ladder we are on. */
import type { EngineStatus, TtsProvider } from '@orca-tts/core'

/**
 * Why `resolve()` could not return a provider, as a value rather than as prose.
 *
 * `null` used to mean six different things — nothing was ever registered, the requested id names
 * an engine that no longer exists, every engine's `prepare()` threw, or any mixture — and every
 * one of them arrived at the caller as the same `null` with `lastFailure === null` (006 sites 45
 * and 46). buzz names its rejection reasons so that "why did it not speak" is always answerable;
 * this is that, for the engine seam. A named reason is worth more than a spoken sentence for a
 * cause the listener cannot act on, and it is what makes a spoken sentence possible for one they
 * can.
 */
export type ResolveFailureKind =
  | 'none-registered'      // register() was never called: a wiring fault, not an environment one
  | 'unknown-id'           // every id we were asked to try names a provider that is not registered
  | 'prepare-failed'       // a provider exists and its prepare() threw — `lastFailure` says how

export interface ResolveFailure {
  readonly kind: ResolveFailureKind
  /** The human sentence. Never empty: `null` used to be the whole report. */
  readonly reason: string
  /** Provider ids whose `prepare()` was attempted and threw, in order. */
  readonly tried: readonly string[]
  /** Ids asked for that are not registered at all. */
  readonly unknown: readonly string[]
}

export class ProviderRegistry {
  readonly #providers = new Map<string, TtsProvider>()
  #preferredId: string | null = null
  #lastFailure: string | null = null
  #lastFailureDetail: ResolveFailure | null = null

  register(p: TtsProvider, opts: { preferred?: boolean } = {}): void {
    this.#providers.set(p.id, p)
    if (opts.preferred === true) this.#preferredId = p.id
  }

  get(id: string): TtsProvider | undefined { return this.#providers.get(id) }

  /**
   * Why the last `resolve()` could not use a provider. Kept because discarding it is how a
   * missing Linux binary turned into "no speech engine is available" with no way to act on it.
   */
  get lastFailure(): string | null { return this.#lastFailure }

  /**
   * The named form of the same failure. Read this, not `lastFailure`, when the caller has to
   * DECIDE something — "nothing was registered" is a bug in our own wiring and "prepare threw" is
   * a fact about the user's machine, and they were previously the same `null`.
   */
  get lastFailureDetail(): ResolveFailure | null { return this.#lastFailureDetail }
  list(): readonly TtsProvider[] { return [...this.#providers.values()] }

  /**
   * Resolve the best usable provider, preferring `requestedId`, then the preferred engine, then
   * anything offline. Never returns silently-degraded: the status carries the reason (R015).
   */
  async resolve(requestedId?: string): Promise<{ provider: TtsProvider; status: EngineStatus } | null> {
    const tryOrder = [
      requestedId,
      this.#preferredId ?? undefined,
      ...this.list().filter((p) => p.capabilities.offline).map((p) => p.id)
    ].filter((x): x is string => typeof x === 'string')

    this.#lastFailure = null
    this.#lastFailureDetail = null
    const seen = new Set<string>()
    const unknown: string[] = []
    const tried: string[] = []
    const failures: string[] = []
    let rung: 'preferred' | 'fallback' | 'floor' = 'preferred'
    for (const id of tryOrder) {
      if (seen.has(id)) continue
      seen.add(id)
      const p = this.#providers.get(id)
      if (p === undefined) {
        // Was: `rung = 'fallback'; continue` — the rung was demoted and the reason discarded, so a
        // stale settings file naming a removed provider degraded the engine with no record (site 45).
        rung = 'fallback'
        unknown.push(id)
        continue
      }
      try {
        await p.prepare()
      } catch (err) {
        rung = 'fallback'
        tried.push(id)
        const why = err instanceof Error ? err.message : String(err)
        failures.push(`${id}: ${why}`)
        this.#lastFailure = why
        continue
      }
      const reason = rung === 'preferred'
        ? undefined
        : `${requestedId ?? this.#preferredId ?? 'preferred engine'} was unavailable; using ${p.displayName}`
      return { provider: p, status: reason === undefined ? { providerId: p.id, rung } : { providerId: p.id, rung, reason } }
    }
    this.#lastFailureDetail = this.#describeFailure(tried, unknown, failures)
    this.#lastFailure = this.#lastFailureDetail.reason
    return null
  }

  #describeFailure(
    tried: readonly string[], unknown: readonly string[], failures: readonly string[]
  ): ResolveFailure {
    if (this.#providers.size === 0) {
      return {
        kind: 'none-registered',
        reason: 'no speech engine is registered — the plugin did not finish wiring itself up',
        tried, unknown
      }
    }
    if (tried.length === 0) {
      return {
        kind: 'unknown-id',
        reason: unknown.length === 0
          ? 'no speech engine could be selected'
          : `no speech engine named ${unknown.join(', ')} is installed in this build`,
        tried, unknown
      }
    }
    return { kind: 'prepare-failed', reason: failures.join('; '), tried, unknown }
  }
}
