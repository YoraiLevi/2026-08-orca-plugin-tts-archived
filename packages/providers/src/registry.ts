/** Selects a provider and reports which rung of the degradation ladder we are on. */
import type { EngineStatus, TtsProvider } from '@orca-tts/core'

export class ProviderRegistry {
  readonly #providers = new Map<string, TtsProvider>()
  #preferredId: string | null = null
  #lastFailure: string | null = null

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
    const seen = new Set<string>()
    let rung: 'preferred' | 'fallback' | 'floor' = 'preferred'
    for (const id of tryOrder) {
      if (seen.has(id)) continue
      seen.add(id)
      const p = this.#providers.get(id)
      if (p === undefined) { rung = 'fallback'; continue }
      try {
        await p.prepare()
      } catch (err) {
        rung = 'fallback'
        this.#lastFailure = err instanceof Error ? err.message : String(err)
        continue
      }
      const reason = rung === 'preferred'
        ? undefined
        : `${requestedId ?? this.#preferredId ?? 'preferred engine'} was unavailable; using ${p.displayName}`
      return { provider: p, status: reason === undefined ? { providerId: p.id, rung } : { providerId: p.id, rung, reason } }
    }
    return null
  }
}
