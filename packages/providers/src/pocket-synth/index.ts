/** Pocket TTS exposed through the shared provider contract. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AudioChunk, ProviderCapabilities, SynthesizeOptions, TtsProvider,
} from '@orca-tts/core'
import { writeWav } from './audio.ts'
import {
  MODEL_TOTAL_BYTES,
  modelDir,
  modelStatus as readModelStatus,
  type ModelStatus,
} from './models.ts'
import {
  POCKET_BACKEND,
  POCKET_DEFAULT_VOICE,
  POCKET_VOICES,
  parseVoiceKey,
  type PocketVoice,
} from './voices.ts'

const ORT_MODULE = 'onnxruntime-node'
const ENGINE_MODULE = './engine.ts'

/** The provider-facing portion of the engine. Kept structural so tests never load ONNX. */
export interface PocketTtsEngine {
  readonly sampleRate: number
  voiceState(key: string, wavBuffer: Buffer): Promise<unknown>
  synthesize(
    text: string,
    voiceState: unknown,
    opts?: { temperature?: number, lsdSteps?: number, seed?: number },
  ): Promise<Float32Array>
}

export interface PocketTtsModule {
  readonly PocketTts: {
    load(dir: string, opts?: { intraOpNumThreads?: number }): Promise<PocketTtsEngine>
  }
}

export interface PocketSynthOptions {
  /** Override for tests and isolated tools. The production default is the per-user model cache. */
  readonly dir?: string
  /** Test seam for forcing the optional native import to fail without installing or removing it. */
  readonly loadOrt?: () => Promise<unknown>
  /** Test seam for stubbing the engine while another tier exercises the real five-graph loop. */
  readonly loadEngine?: () => Promise<PocketTtsModule>
  readonly modelStatus?: (dir: string) => Promise<ModelStatus>
  readonly readFile?: (path: string) => Promise<Buffer>
}

export const POCKET_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  offline: true,
  needsApiKey: false,
  needsModelDownload: MODEL_TOTAL_BYTES,
  licence: 'CC-BY-4.0',
  cloning: true,
  sampleRate: 24_000,
}

export class PocketOrtUnavailableError extends Error {
  constructor(cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause)
    super(`Pocket TTS needs the optional module "${ORT_MODULE}", but it could not be loaded: ${why}`, {
      cause,
    })
    this.name = 'PocketOrtUnavailableError'
  }
}

export class PocketModelUnavailableError extends Error {
  readonly status: Exclude<ModelStatus, { readonly kind: 'ready' }>

  constructor(status: Exclude<ModelStatus, { readonly kind: 'ready' }>) {
    const detail = status.kind === 'absent'
      ? `missing ${status.missing.join(', ')}`
      : `model manifest is stale (found ${status.found}, need ${status.want})`
    super(`Pocket TTS model is not ready in ${status.dir}: ${detail}`)
    this.name = 'PocketModelUnavailableError'
    this.status = status
  }
}

export class PocketVoiceUnavailableError extends Error {
  readonly voice: string

  constructor(voice: string) {
    super(`Pocket TTS has no voice named ${voice}`)
    this.name = 'PocketVoiceUnavailableError'
    this.voice = voice
  }
}

interface ActiveGeneration {
  cancelled: boolean
  readonly stopped: Promise<void>
  stop(): void
  dispose(): void
}

function cancellation(signal: AbortSignal | undefined): ActiveGeneration {
  let settle: (() => void) | undefined
  const token: ActiveGeneration = {
    cancelled: signal?.aborted === true,
    stopped: new Promise<void>((resolve) => { settle = resolve }),
    stop: () => {
      if (token.cancelled) return
      token.cancelled = true
      settle?.()
    },
    dispose: () => { signal?.removeEventListener('abort', token.stop) },
  }
  if (token.cancelled) settle?.()
  else signal?.addEventListener('abort', token.stop, { once: true })
  return token
}

/**
 * Neural Pocket TTS provider.
 *
 * Neither ONNX Runtime nor the engine module is imported at module evaluation time. The provider
 * barrel therefore remains usable on a machine without the optional native package, and
 * `prepare()` is the single boundary that converts its absence into a named rejection.
 */
export class PocketSynthProvider implements TtsProvider {
  readonly id = 'pocket'
  readonly displayName = 'Pocket TTS (neural)'
  readonly capabilities = POCKET_CAPABILITIES

  readonly #dir: string
  readonly #loadOrt: () => Promise<unknown>
  readonly #loadEngine: () => Promise<PocketTtsModule>
  readonly #modelStatus: (dir: string) => Promise<ModelStatus>
  readonly #readFile: (path: string) => Promise<Buffer>
  readonly #voiceStates = new Map<string, Promise<unknown>>()
  readonly #active = new Set<ActiveGeneration>()
  #engine: PocketTtsEngine | null = null
  #preparing: Promise<void> | null = null

  constructor(opts: PocketSynthOptions = {}) {
    this.#dir = opts.dir ?? modelDir()
    this.#loadOrt = opts.loadOrt ?? (async () => import(ORT_MODULE))
    this.#loadEngine = opts.loadEngine ?? (async () =>
      await import(ENGINE_MODULE) as unknown as PocketTtsModule)
    this.#modelStatus = opts.modelStatus ?? readModelStatus
    this.#readFile = opts.readFile ?? (async (path) => readFile(path))
  }

  get isWarm(): boolean { return this.#engine !== null }

  async prepare(): Promise<void> {
    if (this.#engine !== null) return
    if (this.#preparing !== null) return this.#preparing

    const preparing = this.#prepareOnce()
    this.#preparing = preparing
    try {
      await preparing
    } finally {
      if (this.#preparing === preparing) this.#preparing = null
    }
  }

  async #prepareOnce(): Promise<void> {
    const status = await this.#modelStatus(this.#dir)
    if (status.kind !== 'ready') throw new PocketModelUnavailableError(status)

    try {
      await this.#loadOrt()
    } catch (err) {
      throw new PocketOrtUnavailableError(err)
    }

    const { PocketTts } = await this.#loadEngine()
    this.#engine = await PocketTts.load(this.#dir)
  }

  async listVoices(): Promise<readonly string[]> {
    // The picker must be able to show download-required voices, so absence affects availability,
    // not discoverability. Backend-qualified keys prevent a quiet substitution by an OS voice.
    return POCKET_VOICES.map((voice) => voice.key)
  }

  async *generate(text: string, opts: SynthesizeOptions = {}): AsyncIterable<AudioChunk> {
    if (text.trim().length === 0) return

    const active = cancellation(opts.signal)
    this.#active.add(active)
    try {
      if (active.cancelled) return
      await this.prepare()
      if (active.cancelled) return

      const engine = this.#engine
      if (engine === null) throw new Error('Pocket TTS prepare completed without an engine')
      const voice = this.#resolveVoice(opts.voice ?? POCKET_DEFAULT_VOICE)
      const state = await this.#voiceState(engine, voice)
      if (active.cancelled) return

      // Attach both handlers before racing. If cancellation wins, a later engine rejection is
      // still observed rather than becoming an unhandled promise rejection.
      const rendered = engine.synthesize(text, state, {}).then(
        (samples) => ({ kind: 'audio' as const, samples }),
        (error: unknown) => ({ kind: 'error' as const, error }),
      )
      const outcome = await Promise.race([
        rendered,
        active.stopped.then(() => ({ kind: 'cancelled' as const })),
      ])
      if (outcome.kind === 'cancelled' || active.cancelled) return
      if (outcome.kind === 'error') throw outcome.error

      const wav = writeWav(outcome.samples, engine.sampleRate)
      yield {
        data: new Uint8Array(wav),
        format: 'wav',
        sampleRate: engine.sampleRate,
        channels: 1,
      }
    } finally {
      this.#active.delete(active)
      active.dispose()
    }
  }

  async cancel(): Promise<void> {
    for (const active of this.#active) active.stop()
    // Await one microtask so callers can order the next utterance after every iterator has seen
    // the cancellation notification, while keeping the method inside the provider budget.
    await Promise.resolve()
  }

  #resolveVoice(key: string): PocketVoice {
    const parsed = parseVoiceKey(key)
    if (parsed.backend !== POCKET_BACKEND) throw new PocketVoiceUnavailableError(key)
    const voice = POCKET_VOICES.find((candidate) => candidate.key === key)
    if (voice === undefined) throw new PocketVoiceUnavailableError(key)
    return voice
  }

  async #voiceState(engine: PocketTtsEngine, voice: PocketVoice): Promise<unknown> {
    const cached = this.#voiceStates.get(voice.key)
    if (cached !== undefined) return cached

    const loading = this.#readFile(join(this.#dir, voice.file))
      .then(async (wav) => engine.voiceState(voice.key, wav))
    this.#voiceStates.set(voice.key, loading)
    try {
      return await loading
    } catch (err) {
      if (this.#voiceStates.get(voice.key) === loading) this.#voiceStates.delete(voice.key)
      throw err
    }
  }
}
