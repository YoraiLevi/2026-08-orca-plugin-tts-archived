import { describe, expect, it, vi } from 'vitest'
import type { AudioChunk, ProviderCapabilities, TtsProvider } from '@orca-tts/core'
import { CANCEL_BUDGET_MS } from '../contract.ts'
import { ProviderRegistry } from '../registry.ts'
import { createProviderRegistry } from '../index.ts'
import { parseVoiceKey } from './voices.ts'
import {
  INSTALL_TOTAL_BYTES, MODEL_ARTIFACTS, MODEL_TOTAL_BYTES, VOICE_ARTIFACTS,
  type ModelStatus,
} from './models.ts'
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
  readonly synthesize = vi.fn(async (
    _text?: string, _state?: unknown, _opts?: { signal?: AbortSignal },
  ): Promise<Float32Array> =>
    new Float32Array([0, 0.5, -0.5]))
}

/**
 * A fake whose frame loop runs until the provider stops iterating it.
 *
 * Finite on purpose: a mutant that never cancels must make the assertion go red, not hang the
 * suite. 10_000 frames is plenty for the 20-turn post-cancel check to see continued counting.
 */
class FrameCountingEngine {
  readonly sampleRate = 24_000
  frames = 0
  readonly tokenizer = { encode: (text: string): number[] => [...text].map((_, i) => i) }
  readonly voiceState = vi.fn(async (key: string): Promise<VoiceStateStub> => ({ key }))
  readonly synthesize = vi.fn(async (): Promise<Float32Array> => {
    throw new Error('PV-072: provider must drive framesFor so cancel can land between frames')
  })
  splitIntoChunks(text: string): string[] { return [text] }
  decodeFrames(frames: readonly Float32Array[]): Promise<Float32Array> {
    return Promise.resolve(new Float32Array(frames.length))
  }
  async *framesFor(): AsyncGenerator<Float32Array> {
    for (let i = 0; i < 10_000; i++) {
      this.frames++
      yield new Float32Array(8)
      await Promise.resolve()
    }
  }
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 1_000; i++) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error(`hang, not slowness: ${what}`)
}

function readyStatus(dir: string): Promise<ModelStatus> {
  return Promise.resolve({ kind: 'ready', dir })
}

function providerWith(
  engine: PocketEngineStub | FrameCountingEngine,
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
    // Restated from the artifacts modelStatus requires, not from the capability constant
    // (P36: importing the number the implementation chose cannot fail).
    const readySetBytes = [...MODEL_ARTIFACTS, ...VOICE_ARTIFACTS]
      .reduce((n, artifact) => n + artifact.bytes, 0)
    expect(VOICE_ARTIFACTS, 'the advertised download omitted the twelve voice clips').toHaveLength(12)
    expect(readySetBytes).toBe(INSTALL_TOTAL_BYTES)
    expect(capabilities).toEqual({
      streaming: false,
      offline: true,
      needsApiKey: false,
      needsModelDownload: readySetBytes,
      licence: 'CC-BY-4.0',
      cloning: true,
      sampleRate: 24_000,
    })
    expect(capabilities.needsModelDownload, 'the twelve required voice clips were omitted from the advertised download')
      .toBeGreaterThan(MODEL_TOTAL_BYTES)
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

  it('R17-07: omitted dir uses ORCA_TTS_MODEL_DIR, the same env the Lab honours', async () => {
    const prev = process.env.ORCA_TTS_MODEL_DIR
    const dir = '/tmp/orca-tts-r17-07-plugin-env'
    process.env.ORCA_TTS_MODEL_DIR = dir
    const seen: string[] = []
    try {
      const p = new PocketSynthProvider({
        loadOrt: async () => ({}),
        loadEngine: async () => ({ PocketTts: { load: async () => new PocketEngineStub() } }),
        modelStatus: async (d) => {
          seen.push(d)
          return { kind: 'absent', dir: d, missing: ['mimi_encoder.onnx'] }
        },
      })
      await expect(p.prepare()).rejects.toBeInstanceOf(PocketModelUnavailableError)
      expect(seen, 'the plugin did not honour ORCA_TTS_MODEL_DIR').toEqual([dir])
    } finally {
      if (prev === undefined) delete process.env.ORCA_TTS_MODEL_DIR
      else process.env.ORCA_TTS_MODEL_DIR = prev
    }
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

describe('PV-076 SynthesizeOptions.rate must change Pocket audio by effect', () => {
  it('two rates produce measurably different audio, not identical bytes', async () => {
    const engine = new PocketEngineStub()
    engine.synthesize.mockImplementation(async () => new Float32Array(2_400).fill(0.25))
    const p = providerWith(engine)
    const bytesAt = async (rate: number): Promise<Buffer> => {
      const parts: Buffer[] = []
      for await (const chunk of p.generate('hello neural voice', { voice: 'pocket:eve', rate })) {
        parts.push(Buffer.from(chunk.data))
      }
      return Buffer.concat(parts)
    }

    const slow = await bytesAt(0.7)
    const fast = await bytesAt(1.4)
    expect(
      slow.equals(fast),
      'PocketSynthProvider discarded SynthesizeOptions.rate',
    ).toBe(false)
    expect(slow.length, 'slower speech must last longer than faster speech').toBeGreaterThan(fast.length)
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

  it('PV-072 cancel reaches the engine frame loop, not only the output iterator', async () => {
    let captured: { signal?: AbortSignal } | undefined
    const engine = new PocketEngineStub()
    engine.synthesize.mockImplementation(async (
      _text?: string, _state?: unknown, opts?: { signal?: AbortSignal },
    ) => {
      captured = opts ?? {}
      return await new Promise<Float32Array>(() => {})
    })
    const p = providerWith(engine)
    const pending = p.generate('keep synthesizing until cancelled')[Symbol.asyncIterator]().next()
    await vi.waitFor(() => { expect(engine.synthesize).toHaveBeenCalled() })

    await p.cancel()
    await pending

    expect(captured?.signal, 'no abort signal reached PocketTts.synthesize')
      .toBeInstanceOf(AbortSignal)
    expect(captured?.signal?.aborted, 'cancel() resolved without aborting the engine signal')
      .toBe(true)
  })
})

describe('PV-072 cancel stops the ONNX frame loop by effect', () => {
  it('produces no further frames after cancel — a count, not a timer', async () => {
    const engine = new FrameCountingEngine()
    const p = providerWith(engine)
    const iter = p.generate('a sentence long enough to loop')[Symbol.asyncIterator]()
    const pending = iter.next()
    await until(() => engine.frames >= 3, 'the frame loop never started')

    const atCancel = engine.frames
    await p.cancel()
    const result = await pending
    // Several turns for a loop that was not actually cancelled to keep counting.
    for (let i = 0; i < 20; i++) await Promise.resolve()

    expect(result.done, 'cancel returned while the provider could still emit stale audio').toBe(true)
    expect(
      engine.frames,
      `frame loop kept running after cancel: ${engine.frames} frames, ${atCancel} at cancel`,
    ).toBeLessThanOrEqual(atCancel + 1)
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

/**
 * R16-08 — the picker offers twelve voices and every one of them 503s.
 *
 * Measured against the author's real model, staged read-only:
 *
 *   GET  /voices              -> {"key":"pocket:anna","available":true,"reason":null}  (x12)
 *   POST /speak pocket:anna   -> 503 PocketVoiceUnavailableError: no voice named "anna"
 *
 * The seam disagrees with itself. `scripts/voice-lab.mjs` strips the qualifier ON PURPOSE --
 * "a qualified key is never handed to either provider", so that an OS voice can never be reached
 * by a Pocket key -- and hands the provider the bare `anna`. `#resolveVoice` then ran
 * `parseVoiceKey('anna')`, which by its own documented rule reads an unqualified name as
 * `os:anna`, and threw. Both halves are individually defensible; nothing compared them.
 *
 * This is the defect PV-074's worker named in its report and no one actioned: "a peer still needs
 * PocketSynthProvider.#resolveVoice to accept that bare name or a ready model will throw." It sat
 * in the mailbox while `pnpm test` stayed green, because every provider test passed the qualified
 * key that the product never sends.
 */
describe('R16-08 the provider accepts the bare voice name the Lab actually sends', () => {
  it('CONTROL: the qualified key every existing test uses still works', async () => {
    const p = providerWith(new PocketEngineStub())
    const chunks = []
    for await (const c of p.generate('Anna speaks.', { voice: 'pocket:anna' })) chunks.push(c)
    expect(chunks.length).toBeGreaterThan(0)
  })

  it('the BARE name the Lab sends is accepted, and reaches the same voice', async () => {
    const engine = new PocketEngineStub()
    const p = providerWith(engine)
    const chunks = []
    for await (const c of p.generate('Anna speaks.', { voice: 'anna' })) chunks.push(c)
    expect(chunks.length, 'a ready model threw on the only spelling the product sends')
      .toBeGreaterThan(0)
    expect(engine.voiceState.mock.calls.map((c) => c[0]),
      'the bare name must resolve to the SAME voice as the qualified key, not to a default')
      .toContain('pocket:anna')
  })

  it('every key GET /voices advertises can actually be spoken', async () => {
    // The exact list the picker is built from, in both spellings the seam produces.
    const p = providerWith(new PocketEngineStub())
    const advertised = await p.listVoices()
    expect(advertised.length).toBe(12)
    for (const key of advertised) {
      for (const spelling of [key, parseVoiceKey(key).voice]) {
        const chunks = []
        for await (const c of p.generate('x', { voice: spelling })) chunks.push(c)
        expect(chunks.length, `advertised ${key} but ${JSON.stringify(spelling)} produced nothing`)
          .toBeGreaterThan(0)
      }
    }
  })

  it('a name that belongs to another backend is still refused, by name', async () => {
    const p = providerWith(new PocketEngineStub())
    await expect(async () => {
      for await (const _ of p.generate('x', { voice: 'os:Albert' })) { /* drain */ }
    }).rejects.toBeInstanceOf(PocketVoiceUnavailableError)
  })

  it('an unknown bare name is refused rather than silently defaulted', async () => {
    const p = providerWith(new PocketEngineStub())
    await expect(async () => {
      for await (const _ of p.generate('x', { voice: 'nobody' })) { /* drain */ }
    }).rejects.toBeInstanceOf(PocketVoiceUnavailableError)
  })
})
