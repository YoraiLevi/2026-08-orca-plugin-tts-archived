/**
 * Generation-tagged playback queue.
 *
 * Barge-in clears the queue; a voice switch preserves it. Single-flight: a second speak request
 * never overlaps the first. Pure bookkeeping — no audio dependency, so it is fully testable.
 */
import type { AudioChunk, PlaybackSink } from '../types/index.js'

export interface QueueDeps {
  readonly sink: PlaybackSink
  /** Called on barge-in so in-flight SYNTHESIS stops too, not just playback (R022). */
  readonly cancelSynthesis: () => void
}

export class PlaybackQueue {
  #generation = 0
  #pending: Array<{ gen: number; chunk: AudioChunk }> = []
  #draining = false
  readonly #deps: QueueDeps

  constructor(deps: QueueDeps) { this.#deps = deps }

  get generation(): number { return this.#generation }
  get depth(): number { return this.#pending.length }

  /** Begin a new utterance. Returns its generation tag. */
  begin(): number {
    this.#generation++
    return this.#generation
  }

  /** Enqueue audio for `gen`. Chunks from a superseded generation are dropped. */
  push(gen: number, chunk: AudioChunk): boolean {
    if (gen !== this.#generation) return false
    this.#pending.push({ gen, chunk })
    void this.#drain()
    return true
  }

  /** Two-sided cancel: stop synthesis, stop playback, drop the queue. */
  async bargeIn(): Promise<void> {
    this.#generation++
    this.#pending = []
    this.#deps.cancelSynthesis()
    await this.#deps.sink.stop()
  }

  async #drain(): Promise<void> {
    if (this.#draining) return
    this.#draining = true
    try {
      for (;;) {
        const next = this.#pending.shift()
        if (next === undefined) break
        if (next.gen !== this.#generation) continue   // superseded while queued
        await this.#deps.sink.enqueue(next.chunk)
      }
    } finally {
      this.#draining = false
    }
  }
}
