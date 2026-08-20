/**
 * The speech pipeline: text in, audio out, cancellable.
 *
 * Two request modes, because the two callers want opposite things:
 *  - 'replace' (hotkey): a second press interrupts the first. You asked for THIS text now.
 *  - 'queue'   (huddle): replies are spoken in order and never cut each other off. An agent
 *    finishing turn 3 while turn 2 is still being read must not truncate turn 2.
 *
 * Shipping only 'replace' meant huddle silently dropped replies mid-sentence (reported live).
 */
import { Chunker, PlaybackQueue, normalize, type NormalizeOptions, type PlaybackSink } from '@orca-tts/core'
import type { TtsProvider } from '@orca-tts/core'

export type SpeakMode = 'replace' | 'queue'

export interface SpeechServiceDeps {
  readonly provider: TtsProvider
  readonly sink: PlaybackSink
  readonly log?: (m: string) => void
  readonly maxUnits?: number
  readonly normalizeOptions?: NormalizeOptions
  /** Cap on queued utterances; beyond this the OLDEST are dropped (never the newest). */
  readonly maxQueued?: number
}

const DEFAULT_MAX_QUEUED = 20

export class SpeechService {
  readonly #deps: SpeechServiceDeps
  readonly #playback: PlaybackQueue
  #pending: string[] = []
  #draining = false
  #cancelled = false

  constructor(deps: SpeechServiceDeps) {
    this.#deps = deps
    this.#playback = new PlaybackQueue({
      sink: deps.sink,
      cancelSynthesis: () => { deps.provider.cancel() }
    })
  }

  get isSpeaking(): boolean {
    return this.#draining || this.#pending.length > 0 || this.#deps.sink.isPlaying
  }

  get queued(): number { return this.#pending.length }

  /** Speak `text`. See SpeakMode. Returns immediately; use `isSpeaking` to observe. */
  speak(text: string, mode: SpeakMode = 'replace'): void {
    if (mode === 'replace') {
      this.#pending = []
      void this.#playback.bargeIn()
    }
    this.#pending.push(text)
    const max = this.#deps.maxQueued ?? DEFAULT_MAX_QUEUED
    if (this.#pending.length > max) {
      const dropped = this.#pending.length - max
      this.#pending = this.#pending.slice(-max)   // keep the newest; never block the agent
      this.#deps.log?.(`speech queue full, dropped ${dropped} older utterance(s)`)
    }
    this.#cancelled = false
    void this.#drain()
  }

  /** Two-sided stop: cancels synthesis, flushes audio, and clears anything waiting (R022). */
  async stop(): Promise<void> {
    this.#cancelled = true
    this.#pending = []
    await this.#playback.bargeIn()
  }

  async #drain(): Promise<void> {
    if (this.#draining) return
    this.#draining = true
    try {
      for (;;) {
        const text = this.#pending.shift()
        if (text === undefined) break
        await this.#speakOne(text)
        if (this.#cancelled) break
      }
    } finally {
      this.#draining = false
    }
  }

  async #speakOne(text: string): Promise<void> {
    const spoken = normalize(text, this.#deps.normalizeOptions ?? {})
    if (spoken.length === 0) {
      this.#deps.log?.('nothing speakable in that text')
      return
    }
    const chunkerOpts: { maxUnits?: number } = {}
    if (this.#deps.maxUnits !== undefined) chunkerOpts.maxUnits = this.#deps.maxUnits
    const chunker = new Chunker(chunkerOpts)
    const chunks = [...chunker.addText(spoken), ...chunker.finish()]

    const generation = this.#playback.begin()
    for (const chunk of chunks) {
      if (this.#cancelled || generation !== this.#playback.generation) return
      try {
        for await (const audio of this.#deps.provider.generate(chunk.text)) {
          if (!this.#playback.push(generation, audio)) return
        }
      } catch (err) {
        // R024: contain the failure. Speech stops; the host does not.
        this.#deps.log?.(`synthesis failed: ${String(err)}`)
        return
      }
    }
  }
}
