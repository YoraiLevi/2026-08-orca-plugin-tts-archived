import { describe, expect, it, vi } from 'vitest'
import type { AudioChunk, ProviderCapabilities, TtsProvider } from '@orca-tts/core'
import { CANCEL_BUDGET_MS } from '../contract.ts'
import { ProviderRegistry } from '../registry.ts'
import { createProviderRegistry } from '../index.ts'
import { MODEL_TOTAL_BYTES, type ModelStatus } from './models.ts'
import {
  PocketModelUnavailableError,
  PocketOrtUnavailableError,
  PocketSynthProvider,
  PocketVoiceUnavailableError,
} from './index.ts'

interface VoiceStateStub {
  readonly key: string
}

class PocketEngineStub {
  readonly sampleRate = 24_000
  readonly voiceState = vi.fn(async (key: string): Promise<VoiceStateStub> => ({ key }))
  readonly synthesize = vi.fn(async (): Promise<Float32Array> =>
    new Float32Array([0, 0.5, -0.5]))
}

function readyStatus(dir: string): Promise<ModelStatus> {
  return Promise.resolve({ kind: 'ready', dir })
}

function providerWith(
  engine: PocketEngineStub,
  overrides: Partial<ConstructorParameters<typeof PocketSynthProvider>[0]> = {},
): PocketSynthProvider {
  return new PocketSynthProvider({
    dir: '/isolated/pocket-model',
    loadOrt: async () => ({}),
    modelStatus: readyStatus,
    loadEngine: async () => ({ PocketTts: { load: async () => engine } }),
    readFile: async () => Buffer.from('reference voice'),
    ...overrides,
  })
}

describe('PV-020/PV-021 optional ONNX Runtime degrades by name', () => {
  it('keeps the native import lazy and names onnxruntime-node when prepare cannot import it', async () => {
    const loadOrt = vi.fn(async () => Promise.reject(
      new Error("Cannot find package 'onnxruntime-node' imported from pocket-synth"),
    ))
    const p = providerWith(new PocketEngineStub(), { loadOrt })

    expect(loadOrt, 'constructing/importing the provider must not load the optional native module')
      .not.toHaveBeenCalled()
    await expect(p.prepare()).rejects.toBeInstanceOf(PocketOrtUnavailableError)
    await expect(p.prepare()).rejects.toThrow(/onnxruntime-node/)
    expect(p.isWarm).toBe(false)
  })

  it('feeds the named ORT refusal into the registry as prepare-failed for pocket', async () => {
    const p = providerWith(new PocketEngineStub(), {
      loadOrt: async () => Promise.reject(new Error("Cannot find module 'onnxruntime-node'")),
    })
    const registry = new ProviderRegistry()
    registry.register(p, { preferred: true })

    expect(await registry.resolve('pocket')).toBeNull()
    expect(registry.lastFailureDetail?.kind).toBe('prepare-failed')
    expect(registry.lastFailureDetail?.tried).toEqual(['pocket'])
    expect(registry.lastFailureDetail?.reason).toMatch(/pocket.*onnxruntime-node/i)
  })

  it('preserves the ORT cause when the registry falls back to the OS provider', async () => {
    const os = new ReadyProvider('os-synth', 'System voice')
    const pocket = providerWith(new PocketEngineStub(), {
      loadOrt: async () => Promise.reject(new Error("Cannot find module 'onnxruntime-node'")),
    })
    const registry = createProviderRegistry({ os, pocket })

    const resolved = await registry.resolve('pocket')
    expect(resolved?.provider).toBe(os)
    expect(resolved?.status.rung).toBe('fallback')
    expect(resolved?.status.reason, 'fallback without its cause is a quiet backend substitution')
      .toMatch(/pocket.*onnxruntime-node.*System voice/i)
  })
})

describe('PV-022 capabilities and named availability causes', () => {
  it('derives the model download size from the pinned manifest', () => {
    const capabilities = providerWith(new PocketEngineStub()).capabilities
    expect(capabilities).toEqual({
      streaming: false,
      offline: true,
      needsApiKey: false,
      needsModelDownload: MODEL_TOTAL_BYTES,
      licence: 'CC-BY-4.0',
      cloning: true,
      sampleRate: 24_000,
    })
  })

  it('distinguishes an absent model from an unknown voice and does not import ORT for the former', async () => {
    const loadOrt = vi.fn(async () => ({}))
    const absent = providerWith(new PocketEngineStub(), {
      loadOrt,
      modelStatus: async (dir) => ({ kind: 'absent', dir, missing: ['mimi_encoder.onnx'] }),
    })
    await expect(absent.prepare()).rejects.toBeInstanceOf(PocketModelUnavailableError)
    await expect(absent.prepare()).rejects.toThrow(/mimi_encoder\.onnx/)
    expect(loadOrt, 'a missing download is a different cause from a missing native module')
      .not.toHaveBeenCalled()

    const ready = providerWith(new PocketEngineStub())
    const next = ready.generate('hello', { voice: 'pocket:not-a-voice' })[Symbol.asyncIterator]().next()
    await expect(next).rejects.toBeInstanceOf(PocketVoiceUnavailableError)
    await expect(ready.generate('hello', { voice: 'pocket:not-a-voice' })[Symbol.asyncIterator]().next())
      .rejects.toThrow(/pocket:not-a-voice/)
  })
})

describe('PV-023 emits audio and never owns playback', () => {
  it('turns the engine samples into one mono WAV AudioChunk', async () => {
    const engine = new PocketEngineStub()
    const p = providerWith(engine)
    const chunks: AudioChunk[] = []
    for await (const chunk of p.generate('hello neural voice', { voice: 'pocket:eve' })) {
      chunks.push(chunk)
    }

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ format: 'wav', sampleRate: 24_000, channels: 1 })
    expect(Buffer.from(chunks[0]?.data ?? []).subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(engine.voiceState).toHaveBeenCalledWith(
      'pocket:eve', Buffer.from('reference voice'),
    )
    expect(engine.synthesize).toHaveBeenCalledWith(
      'hello neural voice', { key: 'pocket:eve' }, expect.objectContaining({}),
    )
  })

  it('returns no chunk for empty input without preparing the engine', async () => {
    const loadOrt = vi.fn(async () => ({}))
    const p = providerWith(new PocketEngineStub(), { loadOrt })
    const chunks: AudioChunk[] = []
    for await (const chunk of p.generate('  \n ')) chunks.push(chunk)
    expect(chunks).toEqual([])
    expect(loadOrt).not.toHaveBeenCalled()
  })
})

describe('PV-024 cancellation is awaitable and stops provider output by effect', () => {
  it(`ends an in-flight iterator within ${CANCEL_BUDGET_MS} ms and yields no audio`, async () => {
    let synthesisStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => { synthesisStarted = resolve })
    const engine = new PocketEngineStub()
    engine.synthesize.mockImplementation(async () => {
      synthesisStarted?.()
      return await new Promise<Float32Array>(() => {})
    })
    const p = providerWith(engine)
    const iter = p.generate('keep synthesizing until cancelled')[Symbol.asyncIterator]()
    const pending = iter.next()
    await started

    const t0 = Date.now()
    const cancelled = p.cancel()
    expect(cancelled, 'callers must be able to order the next utterance after cancellation')
      .toBeInstanceOf(Promise)
    await cancelled
    const result = await pending
    const elapsed = Date.now() - t0

    expect(elapsed, `cancel took ${elapsed} ms, budget ${CANCEL_BUDGET_MS} ms`)
      .toBeLessThanOrEqual(CANCEL_BUDGET_MS)
    expect(result.done, 'cancel returned while the provider could still emit stale audio').toBe(true)
    expect(result.value).toBeUndefined()
  })
})

class ReadyProvider implements TtsProvider {
  readonly capabilities: ProviderCapabilities = {
    streaming: false, offline: true, needsApiKey: false, needsModelDownload: 0,
    licence: 'test', cloning: false, sampleRate: 22_050,
  }
  readonly isWarm = true
  readonly prepare = vi.fn(async () => {})
  constructor(readonly id: string, readonly displayName: string) {}
  cancel(): void {}
  async listVoices(): Promise<readonly string[]> { return ['default'] }
  async *generate(): AsyncIterable<AudioChunk> {
    yield { data: new Uint8Array([1]), format: 'wav', sampleRate: 22_050, channels: 1 }
  }
}

describe('PV-025 Pocket is registered beside the OS provider without changing the default', () => {
  it('resolves the OS provider when no explicit preference was requested', async () => {
    const os = new ReadyProvider('os-synth', 'System voice')
    const pocket = providerWith(new PocketEngineStub())
    const registry = createProviderRegistry({ os, pocket })

    expect(registry.list().map((provider) => provider.id)).toEqual(['os-synth', 'pocket'])
    expect((await registry.resolve())?.provider).toBe(os)
    expect(os.prepare).toHaveBeenCalledTimes(1)
    expect(pocket.isWarm, 'default resolution must not even prepare Pocket').toBe(false)
  })
})
