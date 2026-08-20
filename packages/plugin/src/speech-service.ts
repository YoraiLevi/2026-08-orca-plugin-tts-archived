/**
 * The speech pipeline: text in, audio out, cancellable.
 *
 * Owns no ORCA API and no audio device. Sources feed it text; a provider synthesizes; a sink
 * plays. That separation is what lets the whole thing be tested without ORCA and without speakers.
 */
import { Chunker, PlaybackQueue, normalize, type NormalizeOptions, type PlaybackSink } from '@orca-tts/core'
import type { TtsProvider } from '@orca-tts/core'

export interface SpeechServiceDeps {
  readonly provider: TtsProvider
  readonly sink: PlaybackSink
  readonly log?: (m: string) => void
  readonly maxUnits?: number
  readonly normalizeOptions?: NormalizeOptions
}

export interface SpeakHandle {
  readonly generation: number
  readonly done: Promise<void>
}

export class SpeechService {
  readonly #deps: SpeechServiceDeps
  readonly #queue: PlaybackQueue
  #chunker: Chunker

  constructor(deps: SpeechServiceDeps) {
    this.#deps = deps
    this.#queue = new PlaybackQueue({
      sink: deps.sink,
      cancelSynthesis: () => { deps.provider.cancel() }
    })
    this.#chunker = this.#newChunker()
  }

  #newChunker(): Chunker {
    const opts: { maxUnits?: number } = {}
    if (this.#deps.maxUnits !== undefined) opts.maxUnits = this.#deps.maxUnits
    return new Chunker(opts)
  }

  get isSpeaking(): boolean { return this.#queue.depth > 0 || this.#deps.sink.isPlaying }

  /** Speak a complete string. Returns as soon as the first chunk is queued. */
  speak(text: string): SpeakHandle {
    const generation = this.#queue.begin()
    this.#chunker = this.#newChunker()
    const done = this.#run(generation, text)
    return { generation, done }
  }

  /** Two-sided stop: cancels synthesis AND flushes queued audio (R022). */
  async stop(): Promise<void> {
    await this.#queue.bargeIn()
    this.#chunker = this.#newChunker()
  }

  async #run(generation: number, text: string): Promise<void> {
    const spoken = normalize(text, this.#deps.normalizeOptions ?? {})
    if (spoken.length === 0) {
      this.#deps.log?.('nothing speakable in that text')
      return
    }
    const chunks = [...this.#chunker.addText(spoken), ...this.#chunker.finish()]
    for (const chunk of chunks) {
      if (generation !== this.#queue.generation) return       // superseded by a newer request
      try {
        for await (const audio of this.#deps.provider.generate(chunk.text)) {
          if (!this.#queue.push(generation, audio)) return
        }
      } catch (err) {
        // R024: contain the failure. Speech stops; the host does not.
        this.#deps.log?.(`synthesis failed: ${String(err)}`)
        return
      }
    }
  }
}
