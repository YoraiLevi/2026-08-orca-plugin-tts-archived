import { describe, expect, it } from 'vitest'
import { ProviderRegistry } from './registry.js'
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
