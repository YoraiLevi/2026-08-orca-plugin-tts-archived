/** Pocket TTS exposed through the shared provider contract. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AudioChunk, ProviderCapabilities, SynthesizeOptions, TtsProvider,
} from '@orca-tts/core'
import { resample, writeWav } from './audio.ts'
import {
  INSTALL_TOTAL_BYTES,
  modelDir,
  modelStatus as readModelStatus,
  modelStatusDetail,
  type ModelStatus,
} from './models.ts'
import {
  POCKET_BACKEND,
  POCKET_DEFAULT_VOICE,
  POCKET_VOICES,
  formatVoiceKey,
  parseVoiceKey,
  type PocketVoice,
} from './voices.ts'

const ORT_MODULE = 'onnxruntime-node'

/** Options the provider forwards into `PocketTts.synthesize`. */
export interface PocketSynthesizeOpts {
  readonly temperature?: number
  readonly lsdSteps?: number
  readonly seed?: number
  /** Aborted by `cancel()`. The frame loop must stop observing this. */
  readonly signal?: AbortSignal
}

/** Options the provider forwards into `PocketTts.framesFor`. */
export interface PocketFramesForOpts {
  readonly temperature: number
  readonly lsdSteps: number
  readonly maxFrames: number | null
  readonly framesAfterEos: number
  readonly rng: (std: number) => number
  readonly signal?: AbortSignal
}

/** The provider-facing portion of the engine. Kept structural so tests never load ONNX. */
export interface PocketTtsEngine {
  readonly sampleRate: number
  voiceState(key: string, wavBuffer: Buffer): Promise<unknown>
  synthesize(
    text: string,
    voiceState: unknown,
    opts?: PocketSynthesizeOpts,
  ): Promise<Float32Array>
  /**
   * When present, the provider drives this generator so `cancel()` can land *between frames*
   * (Principle VII / R014). `synthesize()` is a Promise that otherwise runs the loop to completion.
   */
  framesFor?(
    voiceState: unknown,
    tokenIds: readonly number[],
    opts: PocketFramesForOpts,
  ): AsyncIterable<Float32Array>
  decodeFrames?(frames: readonly Float32Array[]): Promise<Float32Array>
  splitIntoChunks?(text: string): string[]
  preparePrompt?(text: string): { readonly framesAfterEos: number }
  readonly tokenizer?: { encode(text: string): readonly number[] }
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
  needsModelDownload: INSTALL_TOTAL_BYTES,
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
      : modelStatusDetail(status)
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
  iterator: AsyncIterator<unknown> | null
  readonly signal: AbortSignal
  readonly stopped: Promise<void>
  readonly finished: Promise<void>
  stop(): void
  finish(): void
  dispose(): void
}

function cancellation(external: AbortSignal | undefined): ActiveGeneration {
  const controller = new AbortController()
  let settleStopped: (() => void) | undefined
  let settleFinished: (() => void) | undefined
  const token: ActiveGeneration = {
    cancelled: external?.aborted === true,
    iterator: null,
    signal: controller.signal,
    stopped: new Promise<void>((resolve) => { settleStopped = resolve }),
    finished: new Promise<void>((resolve) => { settleFinished = resolve }),
    stop: () => {
      if (token.cancelled) return
      token.cancelled = true
      controller.abort()
      // Closing the generator is what actually stops `framesFor` mid-await — a cancelled
      // flag the loop has not yet reached leaves the ONNX call running (R15-01).
      void token.iterator?.return?.()?.then(() => undefined, () => undefined)
      settleStopped?.()
    },
    finish: () => { settleFinished?.() },
    dispose: () => {
      external?.removeEventListener('abort', token.stop)
      settleFinished?.()
    },
  }
  if (token.cancelled) {
    controller.abort()
    settleStopped?.()
  } else {
    external?.addEventListener('abort', token.stop, { once: true })
  }
  return token
}

function hasFrameLoop(engine: PocketTtsEngine): engine is PocketTtsEngine & {
  framesFor: NonNullable<PocketTtsEngine['framesFor']>
  decodeFrames: NonNullable<PocketTtsEngine['decodeFrames']>
  tokenizer: NonNullable<PocketTtsEngine['tokenizer']>
} {
  return typeof engine.framesFor === 'function'
    && typeof engine.decodeFrames === 'function'
    && engine.tokenizer !== undefined
}

/**
 * Pocket has no native speaking-rate control. Map `SynthesizeOptions.rate` (1.0 = natural)
 * onto duration by resampling, then write the result at the engine's sample rate.
 *
 * `rate > 1` is faster (fewer samples); `rate < 1` is slower (more samples). This also
 * shifts pitch — the same trade-off as speeding a tape. Pitch-preserving time-stretch is
 * not in this package, and refusing the control would recreate P47 (a visible knob that
 * does nothing). Duration is the listener-audible effect.
 */
function applySpeechRate(
  samples: Float32Array, sampleRate: number, rate: number | undefined,
): Float32Array {
  if (rate === undefined || rate === 1) return samples
  if (!(rate > 0) || !Number.isFinite(rate)) {
    throw new RangeError(`Pocket TTS speaking rate must be a positive finite number, got ${String(rate)}`)
  }
  return resample(samples, sampleRate, sampleRate / rate)
}

/** Seedable Box-Muller, kept in lockstep with `engine.ts` `makeRng` (that file is owned elsewhere). */
function pocketRng(seed = 1): (std: number) => number {
  let s = seed >>> 0 || 1
  const next = (): number => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 0x1_0000_0000
  }
  let spare: number | null = null
  return (std: number): number => {
    if (spare !== null) { const v = spare; spare = null; return v * std }
    let u = 0
    let v = 0
    let r = 0
    do {
      u = next() * 2 - 1
      v = next() * 2 - 1
      r = u * u + v * v
    } while (r === 0 || r >= 1)
    const mag = Math.sqrt((-2 * Math.log(r)) / r)
    spare = v * mag
    return u * mag * std
  }
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
    // R16-01: this used to be `import(ORT_MODULE)` DIRECTLY, which bypassed the engine's cache
    // fallback entirely. `engine.ts`'s `loadOrt()` tries node_modules first and then the
    // downloaded runtime cache — the whole point of R14-01's delivery path — and the provider,
    // the only production caller that matters, was routing around it. A delivery path nothing
    // calls is not a delivery path.
    this.#loadOrt = opts.loadOrt ?? (async () => {
      const { loadOrt } = await import('./engine.ts')
      return loadOrt()
    })
    // R17-01/R17-04: this WAS `import(ENGINE_MODULE)`, a variable, and that one indirection broke
    // the shipped plugin. esbuild cannot follow a variable specifier, so it left a literal runtime
    // `import()` in `dist/plugin/main.mjs` pointing at `dist/plugin/engine.ts` -- a sibling the
    // artifact does not contain. The engine was inlined in the bundle the whole time, reached by
    // the LITERAL import three lines above; production took the other door and found a wall.
    //
    // SC-14's graph walk missed it for the same reason: it followed the literal and could not
    // follow the variable. One specifier, three instruments, three costumes.
    this.#loadEngine = opts.loadEngine ?? (async () =>
      await import('./engine.ts') as unknown as PocketTtsModule)
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

      const samples = hasFrameLoop(engine)
        ? await this.#renderFrames(engine, state, text, active)
        : await this.#renderSynthesize(engine, state, text, active)
      if (samples === null || active.cancelled) return

      const timed = applySpeechRate(samples, engine.sampleRate, opts.rate)
      const wav = writeWav(timed, engine.sampleRate)
      yield {
        data: new Uint8Array(wav),
        format: 'wav',
        sampleRate: engine.sampleRate,
        channels: 1,
      }
    } finally {
      this.#active.delete(active)
      active.finish()
      active.dispose()
    }
  }

  async cancel(): Promise<void> {
    const pending = [...this.#active]
    for (const active of pending) active.stop()
    // Resolve only after every in-flight generate() has seen the abort — otherwise a second
    // utterance can start while the abandoned frame loop is still on the CPU (R15-01).
    await Promise.all(pending.map((active) => active.finished))
  }

  /**
   * Drive `framesFor` so cancel can close the generator between ONNX frames.
   * The real engine exposes this loop; tests that only stub `synthesize` take the other path.
   */
  async #renderFrames(
    engine: PocketTtsEngine & {
      framesFor: NonNullable<PocketTtsEngine['framesFor']>
      decodeFrames: NonNullable<PocketTtsEngine['decodeFrames']>
      tokenizer: NonNullable<PocketTtsEngine['tokenizer']>
    },
    state: unknown,
    text: string,
    active: ActiveGeneration,
  ): Promise<Float32Array | null> {
    const chunks = engine.splitIntoChunks?.(text) ?? [text]
    const frames: Float32Array[] = []
    const rng = pocketRng(1)
    for (const chunk of chunks) {
      if (active.cancelled) return null
      const ids = [...engine.tokenizer.encode(chunk)]
      const framesAfterEos = (engine.preparePrompt?.(chunk).framesAfterEos ?? 1) + 2
      const iterator = engine.framesFor(state, ids, {
        temperature: 0.7,
        lsdSteps: 1,
        maxFrames: null,
        framesAfterEos,
        rng,
        signal: active.signal,
      })[Symbol.asyncIterator]()
      active.iterator = iterator
      try {
        for (;;) {
          const next = await iterator.next()
          if (next.done === true || active.cancelled) break
          frames.push(next.value)
        }
      } finally {
        if (active.iterator === iterator) active.iterator = null
      }
      if (active.cancelled) return null
    }
    if (active.cancelled) return null
    return engine.decodeFrames(frames)
  }

  async #renderSynthesize(
    engine: PocketTtsEngine,
    state: unknown,
    text: string,
    active: ActiveGeneration,
  ): Promise<Float32Array | null> {
    // Attach both handlers before racing. If cancellation wins, a later engine rejection is
    // still observed rather than becoming an unhandled promise rejection.
    const rendered = engine.synthesize(text, state, { signal: active.signal }).then(
      (samples) => ({ kind: 'audio' as const, samples }),
      (error: unknown) => ({ kind: 'error' as const, error }),
    )
    const outcome = await Promise.race([
      rendered,
      active.stopped.then(() => ({ kind: 'cancelled' as const })),
    ])
    if (outcome.kind === 'cancelled' || active.cancelled) return null
    if (outcome.kind === 'error') throw outcome.error
    return outcome.samples
  }

  /**
   * R16-08: accept BOTH spellings, because the seam produces both and neither half was wrong.
   *
   * `listVoices()` advertises qualified keys (`pocket:anna`) so the picker cannot confuse a Pocket
   * voice with an OS one. But `scripts/voice-lab.mjs` strips the qualifier before dispatch, on
   * purpose -- "a qualified key is never handed to either provider" -- so what actually arrives
   * here is the bare `anna`. This used to run it through `parseVoiceKey`, whose documented rule is
   * that an unqualified name means `os:`, and throw. Every advertised voice 503'd.
   *
   * A bare name is therefore provider-local and means THIS backend. A qualified one must name this
   * backend or be refused. What is never allowed is falling back to a default: a listener who
   * asked for Anna and silently got Mary has been lied to about who is speaking (principle VIII),
   * so an unknown name is still an error in both spellings.
   */
  #resolveVoice(key: string): PocketVoice {
    const qualified = key.includes(':')
    if (qualified && parseVoiceKey(key).backend !== POCKET_BACKEND) {
      throw new PocketVoiceUnavailableError(key)
    }
    const wanted = qualified ? key : formatVoiceKey(POCKET_BACKEND, key)
    const voice = POCKET_VOICES.find((candidate) => candidate.key === wanted)
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
