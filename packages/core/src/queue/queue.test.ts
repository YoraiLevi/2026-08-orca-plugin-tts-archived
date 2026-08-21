import { describe, expect, it, vi } from 'vitest'
import { PlaybackQueue } from './index.ts'
import type { AudioChunk, PlaybackSink } from '../types/index.ts'

const chunk = (n: number): AudioChunk =>
  ({ data: new Uint8Array([n]), format: 'wav', sampleRate: 22050, channels: 1 })

class FakeSink implements PlaybackSink {
  played: number[] = []
  stopped = 0
  isPlaying = false
  async enqueue(c: AudioChunk): Promise<void> { this.played.push(c.data[0] as number) }
  async stop(): Promise<void> { this.stopped++; this.played = [] }
}

describe('T044 playback queue', () => {
  it('T044a barge-in clears the queue and cancels SYNTHESIS too', async () => {
    const sink = new FakeSink()
    const cancelSynthesis = vi.fn()
    const q = new PlaybackQueue({ sink, cancelSynthesis })
    const gen = q.begin()
    q.push(gen, chunk(1))
    await q.bargeIn()
    // Two-sided cancel (R022): stopping the player alone would leave the synthesizer running.
    expect(cancelSynthesis).toHaveBeenCalledTimes(1)
    expect(sink.stopped).toBe(1)
  })

  it('T044b a superseded generation cannot play over the new one', async () => {
    const sink = new FakeSink()
    const q = new PlaybackQueue({ sink, cancelSynthesis: () => {} })
    const first = q.begin()
    const second = q.begin()
    expect(q.push(first, chunk(1))).toBe(false)   // stale audio is refused outright
    expect(q.push(second, chunk(2))).toBe(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(sink.played).toEqual([2])
  })

  it('T044c chunks of one generation play in order', async () => {
    const sink = new FakeSink()
    const q = new PlaybackQueue({ sink, cancelSynthesis: () => {} })
    const gen = q.begin()
    for (const n of [1, 2, 3, 4]) q.push(gen, chunk(n))
    await new Promise((r) => setTimeout(r, 0))
    expect(sink.played).toEqual([1, 2, 3, 4])
  })
})

/**
 * 006 cascade C6 — skip plus the Linux floor produced two overlapping voices.
 *
 * On the `spd-say` rung the provider yields no audio, so the generation bump has nothing to
 * invalidate, and the daemon that actually owns playback is only reachable through a SECOND
 * process (`spd-say --cancel`). `bargeIn` called `cancelSynthesis()` without awaiting it, so the
 * next utterance reached the daemon before the cancel did: the listener pressed skip and heard two
 * voices, with the stop control behaving as a start control (P25, P22's helplessness reproduced on
 * the platform P25 was written to rescue).
 */
describe('C6 — barge-in waits for the cancel to actually land', () => {
  it('does not stop the sink, or return, until cancelSynthesis has resolved', async () => {
    const order: string[] = []
    let releaseCancel = (): void => {}
    const q = new PlaybackQueue({
      sink: {
        isPlaying: false,
        async enqueue(): Promise<void> { order.push('enqueue') },
        async stop(): Promise<void> { order.push('sink.stop') }
      },
      cancelSynthesis: () => {
        order.push('cancel.start')
        return new Promise<void>((r) => { releaseCancel = () => { order.push('cancel.done'); r() } })
      }
    })
    const barge = q.bargeIn()
    await new Promise((r) => setTimeout(r, 10))
    expect(order, 'the sink was stopped before the daemon was even told').toEqual(['cancel.start'])
    releaseCancel()
    await barge
    expect(order, 'barge-in returned while the cancel was still in flight')
      .toEqual(['cancel.start', 'cancel.done', 'sink.stop'])
  })

  it('CONTROL: a synchronous cancel still works and is not made to wait', async () => {
    // Proves the assertion above is about ORDERING, not about every cancel becoming a promise.
    const order: string[] = []
    const q = new PlaybackQueue({
      sink: {
        isPlaying: false,
        async enqueue(): Promise<void> {},
        async stop(): Promise<void> { order.push('sink.stop') }
      },
      cancelSynthesis: () => { order.push('cancel') }
    })
    await q.bargeIn()
    expect(order).toEqual(['cancel', 'sink.stop'])
  })
})
