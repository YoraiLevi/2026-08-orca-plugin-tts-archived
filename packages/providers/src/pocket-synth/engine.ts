/**
 * Pocket TTS — the inference loop, in Node.
 *
 * Ported from `KevinAHM/pocket-tts-onnx`'s reference `pocket_tts_onnx.py` and cross-read against
 * buzz's Rust (`crates/buzz-voice/src/pocket{,_april}.rs`), which is the same model driven by the
 * same graphs through a different runtime.
 *
 * Five graphs, and the shape of the thing is:
 *
 *   mimi_encoder      a reference WAV      -> voice embeddings        once per voice, cacheable
 *   flow_lm_main      those embeddings     -> a conditioned state     once per voice, cacheable
 *   text_conditioner  token ids            -> text embeddings         once per chunk
 *   flow_lm_main      the previous latent  -> conditioning + eos      ONCE PER FRAME, 12.5/s
 *   flow_lm_flow      conditioning + noise -> a flow direction        lsdSteps per frame
 *   mimi_decoder      latents              -> 1920 samples per frame  batched
 *
 * The per-frame loop is the entire cost; everything else amortises. That is why the voice state is
 * cached (746 ms -> 7 ms `[measured-here]`) and why the decoder runs in batches.
 *
 * **This file is only trustworthy because of `scripts/pocket-e2e.mjs`.** A hand-ported neural loop
 * does not fail loudly: get the recurrent state fill wrong, or carry an output back to the wrong
 * input slot, and you get audio of the right length, the right level and the right prosody, saying
 * nothing at all. The oracle transcribes the output with an unrelated speech-to-text model and
 * compares against the INPUT TEXT. Nothing weaker distinguishes correct speech from confident
 * nonsense — see R003, and `PITFALLS` P47.
 *
 * `onnxruntime-node` is imported LAZILY and is an optional dependency (R026's neighbourhood, and
 * principle III): a machine without it loses this backend, not the plugin.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SentencePieceUnigram } from './sentencepiece.js'
import { readNpy, readWav, resample, type Npy } from './audio.js'
import { runtimeStatus } from './runtime.ts'

/* --------------------------------------------------------------------------- the ONNX surface */

/**
 * The slice of `onnxruntime-node` this file uses.
 *
 * Declared structurally rather than imported as a type, so this module compiles and loads on a
 * machine where the package is absent. The absence has to be a runtime sentence (PV-FR-021), and
 * a type-level import would make it a build failure instead.
 */
interface OrtTensor {
  readonly type: string
  readonly data: Float32Array | BigInt64Array | Uint8Array
  readonly dims: readonly number[]
}
interface OrtSession {
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>
}
interface Ort {
  Tensor: new (type: string, data: Float32Array | BigInt64Array | Uint8Array, dims: readonly number[]) => OrtTensor
  InferenceSession: {
    create(path: string, options?: Record<string, unknown>): Promise<OrtSession>
  }
}

export class OnnxRuntimeMissingError extends Error {
  readonly code = 'onnxruntime_missing'
  /** `absent` — it can be downloaded. `unsupported` — it cannot, on this machine, ever. */
  readonly reason: 'absent' | 'unsupported'
  constructor(message: string, reason: 'absent' | 'unsupported' = 'absent') {
    super(message)
    this.name = 'OnnxRuntimeMissingError'
    this.reason = reason
  }
}

/**
 * Load ORT, once, and turn its absence into a NAMED failure.
 *
 * A bare `ERR_MODULE_NOT_FOUND` reaching a listener as "speech failed" is R015's exact defect:
 * degrading quietly. This says which module, what still works, and how to fix it.
 */
let ortPromise: Promise<Ort> | null = null
export async function loadOrt(): Promise<Ort> {
  ortPromise ??= (async () => {
    try {
      // A developer's `node_modules` copy wins locally; this is also the path CI uses.
      const mod = (await import('onnxruntime-node')) as unknown as { default?: Ort } & Ort
      return mod.default ?? mod
    } catch (bundled) {
      // Then the cache, which is how a third party gets one at all. ORCA never runs `npm install`
      // for a plugin, so without this branch R14-01 stands: the backend reports itself unavailable
      // forever on every machine but ours.
      const status = await runtimeStatus()
      if (status.kind === 'unsupported') {
        ortPromise = null
        throw new OnnxRuntimeMissingError(status.why, 'unsupported')
      }
      if (status.kind === 'ready') {
        try {
          const mod = (await import(status.dir + '/onnxruntime_binding.node')) as unknown as { default?: Ort } & Ort
          return mod.default ?? mod
        } catch (cached) {
          ortPromise = null
          throw new OnnxRuntimeMissingError(
            `an ONNX Runtime is cached at ${status.dir} but could not be loaded: ` +
            `${cached instanceof Error ? cached.message : String(cached)}. ` +
            'The operating system voices are unaffected.',
          )
        }
      }
      ortPromise = null // so a later download is picked up without a restart
      const size = status.kind === 'absent' ? Math.round(status.bytes / 1_000_000) : 0
      throw new OnnxRuntimeMissingError(
        'The neural voices need the ONNX Runtime, which is not on this machine yet ' +
        `(about ${size} MB). The operating system voices are unaffected, and the Voice Lab can ` +
        `fetch it. (${bundled instanceof Error ? bundled.message : String(bundled)})`,
      )
    }
  })()
  return ortPromise
}

/* ------------------------------------------------------------------------------- the manifest */

/** One recurrent tensor, as `bundle.json` describes it. */
interface StateEntry {
  readonly input_name: string
  readonly output_name: string
  readonly shape: number[]
  readonly dtype: 'float32' | 'float16' | 'int64' | 'bool'
  readonly fill: 'nan' | 'zeros' | 'ones' | 'empty'
  readonly index: number
}

interface Bundle {
  readonly bundle_name: string
  readonly sample_rate: number
  readonly frame_rate: number
  readonly samples_per_frame: number
  readonly latent_dim: number
  readonly conditioning_dim: number
  readonly max_token_per_chunk?: number
  readonly tokenizer_file: string
  readonly bos_before_voice_file?: string
  readonly insert_bos_before_voice?: boolean
  readonly remove_semicolons?: boolean
  readonly pad_with_spaces_for_short_inputs?: boolean
  readonly model_recommended_frames_after_eos?: number | null
  readonly flow_lm_state_manifest: StateEntry[]
  readonly mimi_state_manifest: StateEntry[]
}

export type VoiceState = Record<string, OrtTensor>

export interface SynthesizeParams {
  readonly temperature?: number
  readonly lsdSteps?: number
  readonly seed?: number
  readonly maxFrames?: number | null
}

export interface LoadOptions {
  /** ORT intra-op threads. buzz ships 1; the model card measures ~2x at min(cpu, 4). */
  readonly intraOpNumThreads?: number
  /**
   * Zero-fill the recurrent state instead of honouring the manifest's `fill`.
   *
   * ONLY for `scripts/pocket-e2e.mjs --prove`, which needs to break the engine somewhere
   * load-bearing and show the oracle going red. A check that could not have failed is not a
   * check, and this is the switch that demonstrates this one can.
   */
  readonly __proveZeroFill?: boolean
}

/* ------------------------------------------------------------------- deterministic Gaussians */

/**
 * Seedable normal noise.
 *
 * Seedable on purpose: at `temperature > 0` the model samples, so two runs of the same sentence
 * differ and every regression becomes a judgement call. A fixed seed turns "does this still sound
 * right" into a comparison. Box-Muller over a 32-bit xorshift — the distribution only has to be
 * normal; it does not have to match NumPy's Mersenne Twister, and pretending otherwise would be a
 * claim this file cannot support.
 */
export function makeRng(seed = 1): (std: number) => number {
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
    const f = Math.sqrt((-2 * Math.log(r)) / r)
    spare = v * f
    return u * f * std
  }
}

/* -------------------------------------------------------------------------------- the engine */

export class PocketTts {
  readonly sampleRate: number
  readonly latentDim: number
  readonly conditioningDim: number
  readonly frameRate: number
  readonly maxTokenPerChunk: number
  readonly tokenizer: SentencePieceUnigram

  readonly #ort: Ort
  readonly #meta: Bundle
  readonly #bos: Npy | null
  readonly #zeroFill: boolean
  readonly #mimiEncoder: OrtSession
  readonly #textConditioner: OrtSession
  readonly #flowMain: OrtSession
  readonly #flowNet: OrtSession
  readonly #mimiDecoder: OrtSession
  readonly #voiceStates = new Map<string, VoiceState>()

  private constructor(parts: {
    ort: Ort, meta: Bundle, bos: Npy | null, zeroFill: boolean, tokenizer: SentencePieceUnigram,
    mimiEncoder: OrtSession, textConditioner: OrtSession, flowMain: OrtSession,
    flowNet: OrtSession, mimiDecoder: OrtSession,
  }) {
    this.#ort = parts.ort
    this.#meta = parts.meta
    this.#bos = parts.bos
    this.#zeroFill = parts.zeroFill
    this.tokenizer = parts.tokenizer
    this.#mimiEncoder = parts.mimiEncoder
    this.#textConditioner = parts.textConditioner
    this.#flowMain = parts.flowMain
    this.#flowNet = parts.flowNet
    this.#mimiDecoder = parts.mimiDecoder
    this.sampleRate = parts.meta.sample_rate
    this.latentDim = parts.meta.latent_dim
    this.conditioningDim = parts.meta.conditioning_dim
    this.frameRate = parts.meta.frame_rate
    this.maxTokenPerChunk = parts.meta.max_token_per_chunk ?? 50
  }

  static async load(dir: string, options: LoadOptions = {}): Promise<PocketTts> {
    const ort = await loadOrt()
    const meta = JSON.parse(await readFile(join(dir, 'bundle.json'), 'utf8')) as Bundle

    const sessionOptions = {
      // The model card's number, and it is not a micro-optimisation: the autoregressive loop is a
      // chain of small matmuls and letting ORT use every core makes them fight for cache. buzz
      // ships 1; the card measures ~2x at min(cpu, 4). Both are defensible and it is measurable.
      intraOpNumThreads: options.intraOpNumThreads ?? 4,
      interOpNumThreads: 1,
      executionMode: 'sequential',
      graphOptimizationLevel: 'all',
    }
    const open = (file: string): Promise<OrtSession> =>
      ort.InferenceSession.create(join(dir, file), sessionOptions)

    const [mimiEncoder, textConditioner, flowMain, flowNet, mimiDecoder] = await Promise.all([
      open('mimi_encoder.onnx'),
      open('text_conditioner.onnx'),
      open('flow_lm_main_int8.onnx'),
      open('flow_lm_flow_int8.onnx'),
      open('mimi_decoder_int8.onnx'),
    ])

    const tokenizer = SentencePieceUnigram.fromBuffer(await readFile(join(dir, meta.tokenizer_file)))
    const bos = meta.bos_before_voice_file === undefined
      ? null
      : readNpy(await readFile(join(dir, meta.bos_before_voice_file)))

    return new PocketTts({
      ort, meta, bos, tokenizer,
      zeroFill: options.__proveZeroFill === true,
      mimiEncoder, textConditioner, flowMain, flowNet, mimiDecoder,
    })
  }

  /* ---- recurrent state, from the bundle's own manifest ---------------------- */

  /**
   * Build the initial state for one graph.
   *
   * **`fill` is load-bearing and this is the most dangerous line in the file.** The flow LM's
   * attention cache is filled with NaN so that unwritten positions poison anything that reads
   * them — that is how the graph knows a slot is empty. Zero-filling it produces perfectly
   * plausible audio that says nothing, which is exactly why `--prove` breaks it here.
   */
  #initState(manifest: readonly StateEntry[]): Record<string, OrtTensor> {
    const state: Record<string, OrtTensor> = {}
    for (const entry of manifest) {
      const size = entry.shape.reduce((a, b) => a * b, 1)
      let data: Float32Array | BigInt64Array | Uint8Array
      if (entry.dtype === 'int64') data = new BigInt64Array(size)
      else if (entry.dtype === 'bool') data = new Uint8Array(size)
      else if (entry.dtype === 'float32') data = new Float32Array(size)
      else throw new Error(`unsupported state dtype ${entry.dtype} for ${entry.input_name}`)

      if (!this.#zeroFill) {
        if (entry.fill === 'nan' && data instanceof Float32Array) data.fill(Number.NaN)
        else if (entry.fill === 'ones') {
          if (data instanceof BigInt64Array) data.fill(1n)
          else (data as Float32Array | Uint8Array).fill(1)
        }
      }
      state[entry.input_name] = new this.#ort.Tensor(entry.dtype, data, entry.shape)
    }
    return state
  }

  /**
   * Carry each `out_state_N` back to its `state_N`.
   *
   * BY NAME, not by output position. The reference indexes a positional list with an offset, which
   * is correct there and would be one silent renumber away from wrong here — the same species as
   * `FIXED_BY_DESIGN_STAGES` denoting different transforms after an insert (P37).
   */
  #advance(state: Record<string, OrtTensor>, result: Record<string, OrtTensor>, manifest: readonly StateEntry[]): void {
    for (const entry of manifest) {
      const next = result[entry.output_name]
      if (next === undefined) throw new Error(`the graph produced no ${entry.output_name}`)
      state[entry.input_name] = next
    }
  }

  #clone(state: VoiceState): VoiceState {
    const out: VoiceState = {}
    for (const [k, t] of Object.entries(state)) {
      out[k] = new this.#ort.Tensor(t.type, t.data.slice() as Float32Array, t.dims)
    }
    return out
  }

  /* ---- voices --------------------------------------------------------------- */

  /** Encode a reference clip into voice embeddings. ~1 s for a 10 s clip, hence the cache above. */
  async encodeVoice(wavBuffer: Buffer): Promise<OrtTensor> {
    const { samples, rate } = readWav(wavBuffer)
    const audio = resample(samples, rate, this.sampleRate)
    const out = await this.#mimiEncoder.run({
      audio: new this.#ort.Tensor('float32', audio, [1, 1, audio.length]),
    })
    const name = this.#mimiEncoder.outputNames[0]
    const tensor = name === undefined ? undefined : out[name]
    if (tensor === undefined) throw new Error('the Mimi encoder produced no output')
    return tensor
  }

  /**
   * The state every utterance in a voice starts from.
   *
   * Expensive and dependent on nothing else, so it is computed once and cloned per utterance —
   * 746 ms then 7 ms `[measured-here]`. `wavBuffer` may be null once the voice is cached, which is
   * what lets a caller avoid reading 600 KB it will not use.
   */
  async voiceState(key: string, wavBuffer: Buffer | null): Promise<VoiceState> {
    const cached = this.#voiceStates.get(key)
    if (cached !== undefined) return this.#clone(cached)
    if (wavBuffer === null) throw new Error(`voice ${key} is not cached and no audio was given`)

    const emb = await this.encodeVoice(wavBuffer)
    let dims = [...emb.dims]
    let data = emb.data as Float32Array
    if (dims.length > 3) dims = dims.slice(dims.length - 3)
    if (dims.length < 3) dims = [1, dims[0] ?? 0, this.conditioningDim]

    if (this.#meta.insert_bos_before_voice === true && this.#bos !== null) {
      const bosFrames = this.#bos.shape[this.#bos.shape.length - 2] ?? 0
      const merged = new Float32Array(this.#bos.data.length + data.length)
      merged.set(this.#bos.data, 0)
      merged.set(data, this.#bos.data.length)
      data = merged
      dims = [1, bosFrames + (dims[1] ?? 0), dims[2] ?? this.conditioningDim]
    }

    const state = this.#initState(this.#meta.flow_lm_state_manifest)
    const result = await this.#flowMain.run({
      sequence: new this.#ort.Tensor('float32', new Float32Array(0), [1, 0, this.latentDim]),
      text_embeddings: new this.#ort.Tensor('float32', data, dims),
      ...state,
    })
    this.#advance(state, result, this.#meta.flow_lm_state_manifest)
    this.#voiceStates.set(key, this.#clone(state))
    return state
  }

  /** Whether a voice's state is already built, so a caller can report a cold first utterance. */
  hasVoice(key: string): boolean { return this.#voiceStates.has(key) }

  /* ---- text ----------------------------------------------------------------- */

  /**
   * The reference's prompt hygiene, kept verbatim.
   *
   * It changes the tokens, so it changes the audio: capitalising the first letter and adding a
   * final full stop are not cosmetic, they are what the model was trained to receive.
   */
  preparePrompt(text: string): { text: string, framesAfterEos: number } {
    let t = text.trim()
    if (t === '') throw new Error('cannot synthesize empty text')
    t = t.replaceAll('\n', ' ').replaceAll('\r', ' ').replaceAll('  ', ' ')
    if (this.#meta.remove_semicolons === true) t = t.replaceAll(';', ',')
    const words = t.split(/\s+/).length
    const framesAfterEos = words <= 4 ? 3 : 1
    const first = t[0] ?? ''
    if (first !== first.toUpperCase()) t = first.toUpperCase() + t.slice(1)
    const last = t[t.length - 1] ?? ''
    if (/[\p{L}\p{N}]/u.test(last)) t += '.'
    if (this.#meta.pad_with_spaces_for_short_inputs === true && t.split(/\s+/).length < 5) {
      t = ' '.repeat(8) + t
    }
    return { text: t, framesAfterEos }
  }

  /**
   * Split at the bundle's token cap, on sentence boundaries.
   *
   * The cap is the model's, not ours: `max_token_per_chunk` is 50 for this bundle, and a longer
   * prompt does not error — it degrades. Splitting on sentence ends rather than mid-clause is what
   * keeps the prosody from breaking in the middle of a phrase.
   */
  splitIntoChunks(text: string): string[] {
    const { text: prepared } = this.preparePrompt(text)
    const ids = this.tokenizer.encode(prepared)
    if (ids.length <= this.maxTokenPerChunk) return [prepared]

    const enders = new Set(['.', '!', '?', '。'])
    const boundaryIds = new Set<number>()
    for (const [i, piece] of this.tokenizer.byId.entries()) {
      if (piece !== '' && [...piece].every((ch) => enders.has(ch))) boundaryIds.add(i)
    }

    const bounds = [0]
    let prevWasBoundary = false
    for (const [i, id] of ids.entries()) {
      if (boundaryIds.has(id)) { prevWasBoundary = true; continue }
      if (prevWasBoundary) bounds.push(i)
      prevWasBoundary = false
    }
    bounds.push(ids.length)

    const chunks: string[] = []
    let current = ''
    let count = 0
    for (let i = 0; i < bounds.length - 1; i++) {
      const from = bounds[i] ?? 0
      const to = bounds[i + 1] ?? ids.length
      const segLen = to - from
      const segText = this.tokenizer.decode(ids.slice(from, to))
      if (count + segLen > this.maxTokenPerChunk && current !== '') {
        chunks.push(current.trim())
        current = segText
        count = segLen
      } else {
        current = current === '' ? segText : `${current} ${segText}`
        count += segLen
      }
    }
    if (current.trim() !== '') chunks.push(current.trim())
    return chunks
  }

  /* ---- generation ----------------------------------------------------------- */

  /**
   * One chunk of text into latent frames. This loop is the entire cost of speaking.
   *
   * **EOS is a logit, not a token.** The graph reports `eos_logit > -4.0`, and the reference then
   * runs `framesAfterEos` MORE frames before stopping — cutting on the first EOS clips the tail of
   * the last word, which is the kind of defect a listener hears as a swallowed consonant and
   * cannot name.
   */
  async *framesFor(
    baseState: VoiceState,
    tokenIds: readonly number[],
    opts: { temperature: number, lsdSteps: number, maxFrames: number | null, framesAfterEos: number, rng: (std: number) => number },
  ): AsyncGenerator<Float32Array> {
    const state = this.#clone(baseState)
    const ids = BigInt64Array.from(tokenIds.map((n) => BigInt(n)))

    const conditioned = await this.#textConditioner.run({
      token_ids: new this.#ort.Tensor('int64', ids, [1, ids.length]),
    })
    const teName = this.#textConditioner.outputNames[0]
    const te = teName === undefined ? undefined : conditioned[teName]
    if (te === undefined) throw new Error('the text conditioner produced no output')
    const teDims = te.dims.length === 2 ? [1, ...te.dims] : [...te.dims]

    const primed = await this.#flowMain.run({
      sequence: new this.#ort.Tensor('float32', new Float32Array(0), [1, 0, this.latentDim]),
      text_embeddings: new this.#ort.Tensor('float32', te.data as Float32Array, teDims),
      ...state,
    })
    this.#advance(state, primed, this.#meta.flow_lm_state_manifest)

    // The first step is fed NaN: that is how the graph is told there is no previous frame.
    let curr = new this.#ort.Tensor(
      'float32', new Float32Array(this.latentDim).fill(this.#zeroFill ? 0 : Number.NaN), [1, 1, this.latentDim])
    const emptyText = new this.#ort.Tensor('float32', new Float32Array(0), [1, 0, this.conditioningDim])

    const limit = opts.maxFrames ?? Math.ceil((tokenIds.length / 3 + 2) * this.frameRate)
    const dt = 1 / opts.lsdSteps
    const std = opts.temperature > 0 ? Math.sqrt(opts.temperature) : 0
    let eosStep: number | null = null

    for (let step = 0; step < limit; step++) {
      const out = await this.#flowMain.run({ sequence: curr, text_embeddings: emptyText, ...state })
      const conditioning = out.conditioning
      const eos = out.eos_logit
      if (conditioning === undefined || eos === undefined) {
        throw new Error('the flow LM produced no conditioning or no eos_logit')
      }
      this.#advance(state, out, this.#meta.flow_lm_state_manifest)

      const eosValue = (eos.data as Float32Array)[0] ?? Number.NEGATIVE_INFINITY
      if (eosValue > -4 && eosStep === null) eosStep = step
      if (eosStep !== null && step >= eosStep + opts.framesAfterEos) return

      const x = new Float32Array(this.latentDim)
      if (std > 0) for (let i = 0; i < x.length; i++) x[i] = opts.rng(std)

      // Euler integration along the flow field, `lsdSteps` steps from 0 to 1.
      for (let j = 0; j < opts.lsdSteps; j++) {
        const s = j / opts.lsdSteps
        const flow = await this.#flowNet.run({
          c: conditioning,
          s: new this.#ort.Tensor('float32', Float32Array.of(s), [1, 1]),
          t: new this.#ort.Tensor('float32', Float32Array.of(s + dt), [1, 1]),
          x: new this.#ort.Tensor('float32', x, [1, this.latentDim]),
        })
        const dirName = this.#flowNet.outputNames[0]
        const dir = dirName === undefined ? undefined : flow[dirName]
        if (dir === undefined) throw new Error('the flow network produced no direction')
        const d = dir.data as Float32Array
        for (let i = 0; i < x.length; i++) x[i] = (x[i] ?? 0) + (d[i] ?? 0) * dt
      }

      curr = new this.#ort.Tensor('float32', x.slice(), [1, 1, this.latentDim])
      yield x.slice()
    }
  }

  /** Latent frames into audio, in batches, carrying the decoder's own recurrent state. */
  async decodeFrames(frames: readonly Float32Array[], chunkSize = 15): Promise<Float32Array> {
    const state = this.#initState(this.#meta.mimi_state_manifest)
    const pieces: Float32Array[] = []
    for (let i = 0; i < frames.length; i += chunkSize) {
      const batch = frames.slice(i, i + chunkSize)
      const flat = new Float32Array(batch.length * this.latentDim)
      for (const [b, frame] of batch.entries()) flat.set(frame, b * this.latentDim)
      const out = await this.#mimiDecoder.run({
        latent: new this.#ort.Tensor('float32', flat, [1, batch.length, this.latentDim]),
        ...state,
      })
      const audio = out.audio_frame
      if (audio === undefined) throw new Error('the Mimi decoder produced no audio_frame')
      pieces.push(audio.data as Float32Array)
      this.#advance(state, out, this.#meta.mimi_state_manifest)
    }
    const total = pieces.reduce((n, p) => n + p.length, 0)
    const merged = new Float32Array(total)
    let at = 0
    for (const p of pieces) { merged.set(p, at); at += p.length }
    return merged
  }

  /** Text plus a voice into 24 kHz mono float32. */
  async synthesize(text: string, voice: VoiceState, params: SynthesizeParams = {}): Promise<Float32Array> {
    const temperature = params.temperature ?? 0.7
    const lsdSteps = params.lsdSteps ?? 1
    const rng = makeRng(params.seed ?? 1)
    const frames: Float32Array[] = []
    for (const chunk of this.splitIntoChunks(text)) {
      const { framesAfterEos } = this.preparePrompt(chunk)
      const effective = this.#meta.model_recommended_frames_after_eos ?? framesAfterEos + 2
      for await (const frame of this.framesFor(voice, this.tokenizer.encode(chunk), {
        temperature, lsdSteps, maxFrames: params.maxFrames ?? null, framesAfterEos: effective, rng,
      })) frames.push(frame)
    }
    return this.decodeFrames(frames)
  }
}
