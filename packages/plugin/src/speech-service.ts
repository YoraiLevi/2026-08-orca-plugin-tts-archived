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
import type { SynthesizeOptions, TtsProvider } from '@orca-tts/core'

export type SpeakMode = 'replace' | 'queue'

export interface SpeechServiceDeps {
  readonly provider: TtsProvider
  readonly sink: PlaybackSink
  readonly log?: (m: string) => void
  readonly maxUnits?: number
  /**
   * Isolate the first sentence so audio starts sooner (R4.2, first audio < ~500 ms).
   * The chunker has defaulted this to `true` since it was written; before this was forwarded,
   * no caller could turn it off. Default stays `true` — omit to keep today's behaviour.
   */
  readonly isolateFirstSentence?: boolean
  /**
   * Engine voice. Provider-specific and NOT portable across platforms: macOS `Samantha`,
   * Windows `Microsoft Zira Desktop` and espeak-ng `en-US+f3` share no namespace and no member.
   * Undefined means "the provider's own default", which is what shipped before.
   */
  readonly voice?: string
  /** 1.0 is the provider's natural rate. Undefined leaves the engine alone. */
  readonly rate?: number
  readonly normalizeOptions?: NormalizeOptions
  /** Cap on queued utterances; beyond this the OLDEST are dropped (never the newest). */
  readonly maxQueued?: number
  /** Called when the queue overflows, so the user can be told rather than left guessing. */
  readonly onDropped?: (count: number) => void
}

const DEFAULT_MAX_QUEUED = 20

export class SpeechService {
  readonly #deps: SpeechServiceDeps
  readonly #playback: PlaybackQueue
  #pending: Array<{ text: string; label?: string }> = []
  #draining = false
  #cancelled = false
  #skip = false
  #current: string | null = null

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

  /** What is being read right now, if the caller labelled it. */
  get nowReading(): string | null { return this.#current }

  /** Abandon the current utterance and move to the next queued one. */
  async skip(): Promise<void> {
    this.#skip = true
    await this.#playback.bargeIn()
  }

  /** Speak `text`. See SpeakMode. Returns immediately; use `isSpeaking` to observe. */
  speak(text: string, mode: SpeakMode = 'replace', label?: string): void {
    if (mode === 'replace') {
      this.#pending = []
      void this.#playback.bargeIn()
    }
    this.#pending.push(label === undefined ? { text } : { text, label })
    const max = this.#deps.maxQueued ?? DEFAULT_MAX_QUEUED
    if (this.#pending.length > max) {
      const dropped = this.#pending.length - max
      this.#pending = this.#pending.slice(-max)   // keep the newest; never block the agent
      // Never silently. Losing a reply you were waiting for, with no signal, is the worst outcome.
      this.#deps.log?.(`speech queue full, dropped ${dropped} older utterance(s)`)
      this.#deps.onDropped?.(dropped)
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
        const next = this.#pending.shift()
        if (next === undefined) break
        this.#current = next.label ?? null
        this.#skip = false
        await this.#speakOne(next.text)
        this.#current = null
        if (this.#cancelled) break
      }
    } finally {
      this.#draining = false
    }
  }

  /**
   * Voice and rate are the two settings every user asks for first, and until this existed no
   * caller could reach them: `generate(chunk.text)` was called with no options at all, while
   * `SynthesizeOptions.voice`/`.rate` and the provider's implementations of both sat unused (H24).
   * Built fresh per utterance and omitting undefined fields, so "nothing passed" stays byte-for-
   * byte the request the provider received before.
   */
  #synthesizeOptions(): SynthesizeOptions {
    const opts: { voice?: string; rate?: number } = {}
    if (this.#deps.voice !== undefined) opts.voice = this.#deps.voice
    if (this.#deps.rate !== undefined) opts.rate = this.#deps.rate
    return opts
  }

  async #speakOne(text: string): Promise<void> {
    const spoken = normalize(text, this.#deps.normalizeOptions ?? {})
    if (spoken.length === 0) {
      this.#deps.log?.('nothing speakable in that text')
      return
    }
    const chunkerOpts: { maxUnits?: number; isolateFirstSentence?: boolean } = {}
    if (this.#deps.maxUnits !== undefined) chunkerOpts.maxUnits = this.#deps.maxUnits
    if (this.#deps.isolateFirstSentence !== undefined) {
      chunkerOpts.isolateFirstSentence = this.#deps.isolateFirstSentence
    }
    const chunker = new Chunker(chunkerOpts)
    const chunks = [...chunker.addText(spoken), ...chunker.finish()]

    const generation = this.#playback.begin()
    for (const chunk of chunks) {
      if (this.#cancelled || this.#skip || generation !== this.#playback.generation) return
      try {
        for await (const audio of this.#deps.provider.generate(chunk.text, this.#synthesizeOptions())) {
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
