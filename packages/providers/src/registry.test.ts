import { describe, expect, it } from 'vitest'
import { ProviderRegistry } from './registry.ts'
import type { AudioChunk, ProviderCapabilities, TtsProvider } from '@orca-tts/core'

const caps = (over: Partial<ProviderCapabilities> = {}): ProviderCapabilities => ({
  streaming: false, offline: true, needsApiKey: false, needsModelDownload: 0,
  licence: 'test', cloning: false, sampleRate: 22050, ...over
})

class FakeProvider implements TtsProvider {
  #warm = false
  constructor(
    readonly id: string,
    readonly displayName: string,
    private readonly failPrepare = false,
    readonly capabilities = caps()
  ) {}
  get isWarm(): boolean { return this.#warm }
  async prepare(): Promise<void> {
    if (this.failPrepare) throw new Error('cold')
    this.#warm = true
  }
  cancel(): void {}
  async listVoices(): Promise<readonly string[]> { return ['v1'] }
  async *generate(): AsyncIterable<AudioChunk> {
    yield { data: new Uint8Array([1, 2, 3]), format: 'wav', sampleRate: 22050, channels: 1 }
  }
}

describe('T043 registry resolution and the degradation ladder', () => {
  it('uses the preferred provider when it prepares', async () => {
    const r = new ProviderRegistry()
    r.register(new FakeProvider('good', 'Good'), { preferred: true })
    const res = await r.resolve()
    expect(res?.status.rung).toBe('preferred')
    expect(res?.status.reason).toBeUndefined()
  })

  it('falls back when the preferred provider cannot prepare, and SAYS WHY', async () => {
    const r = new ProviderRegistry()
    r.register(new FakeProvider('neural', 'Neural', true), { preferred: true })
    r.register(new FakeProvider('os', 'System voice'))
    const res = await r.resolve()
    expect(res?.provider.id).toBe('os')
    expect(res?.status.rung).toBe('fallback')
    // R015: degrade loudly. A reason the UI can show is mandatory, not optional.
    expect(res?.status.reason).toBeTruthy()
    expect(res?.status.reason).toContain('System voice')
  })

  it('returns null when nothing at all is usable', async () => {
    const r = new ProviderRegistry()
    r.register(new FakeProvider('a', 'A', true), { preferred: true })
    expect(await r.resolve()).toBeNull()
  })
})

/**
 * 006 sites 45 and 46: `null` meant six different things and `lastFailure` was `null` for most of
 * them. buzz names its rejection reasons so "why did it not speak" is always answerable; these
 * assert the same property here. Outcome chosen: **make it distinguishable** — none of these three
 * causes is something a listener can act on differently in the moment, so a named value the host
 * can log and report beats three spoken sentences.
 */
describe('006 sites 45/46 — a refusal to resolve names its cause', () => {
  it('distinguishes "nothing registered" from "everything threw" from "unknown id"', async () => {
    const empty = new ProviderRegistry()
    expect(await empty.resolve()).toBeNull()
    expect(empty.lastFailureDetail?.kind, 'an empty registry is OUR wiring bug, not the machine')
      .toBe('none-registered')
    expect(empty.lastFailure, 'null was the whole report before this').toBeTruthy()

    const stale = new ProviderRegistry()
    stale.register(new FakeProvider('os', 'System voice'))
    // A settings file naming an engine this build no longer ships. It resolved to the offline
    // provider before, so this asks for one that is genuinely absent AND has no offline fallback.
    const staleOnly = new ProviderRegistry()
    staleOnly.register(new FakeProvider('os', 'System voice', false, caps({ offline: false })))
    expect(await staleOnly.resolve('piper-removed')).toBeNull()
    expect(staleOnly.lastFailureDetail?.kind).toBe('unknown-id')
    expect(staleOnly.lastFailureDetail?.unknown).toContain('piper-removed')
    expect(String(staleOnly.lastFailure)).toContain('piper-removed')

    const broken = new ProviderRegistry()
    broken.register(new FakeProvider('a', 'A', true), { preferred: true })
    expect(await broken.resolve()).toBeNull()
    expect(broken.lastFailureDetail?.kind).toBe('prepare-failed')
    expect(broken.lastFailureDetail?.tried, 'which engine failed is the actionable half').toContain('a')
    expect(String(broken.lastFailure), 'the thrown message must survive').toContain('cold')
  })

  it('CONTROL: a successful resolve leaves no failure detail behind', async () => {
    const r = new ProviderRegistry()
    r.register(new FakeProvider('a', 'A', true), { preferred: true })
    r.register(new FakeProvider('b', 'B'))
    expect(await r.resolve()).not.toBeNull()
    // Proves the assertions above fail for the right reason: the field is not simply always set.
    expect(r.lastFailureDetail, 'a resolved engine must not look like a failed one').toBeNull()
  })
})
