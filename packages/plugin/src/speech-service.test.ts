import { describe, expect, it, vi } from 'vitest'
import { SpeechService } from './speech-service.js'
import { numberToWords } from '@orca-tts/core'
import type {
  AudioChunk, PlaybackSink, ProviderCapabilities, SynthesizeOptions, TtsProvider
} from '@orca-tts/core'

/** Let the async drain loop run to completion. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5))
}

class RecordingProvider implements TtsProvider {
  id = 'fake'; displayName = 'Fake'
  synthesized: string[] = []
  /** What each call actually asked the engine for — the thing no caller could set before. */
  options: SynthesizeOptions[] = []
  cancelled = 0
  #warm = false
  capabilities: ProviderCapabilities = {
    streaming: true, offline: true, needsApiKey: false, needsModelDownload: 0,
    licence: 'test', cloning: false, sampleRate: 22050
  }
  get isWarm(): boolean { return this.#warm }
  async prepare(): Promise<void> { this.#warm = true }
  cancel(): void { this.cancelled++ }
  async listVoices(): Promise<readonly string[]> { return [] }
  async *generate(text: string, opts: SynthesizeOptions = {}): AsyncIterable<AudioChunk> {
    this.synthesized.push(text)
    this.options.push(opts)
    yield { data: new Uint8Array([1]), format: 'wav', sampleRate: 22050, channels: 1 }
  }
}

class FakeSink implements PlaybackSink {
  chunks = 0; stops = 0; isPlaying = false
  async enqueue(): Promise<void> { this.chunks++ }
  async stop(): Promise<void> { this.stops++ }
}

describe('T066 pipeline integration', () => {
  it('normalizes, chunks, synthesizes, and plays in that order', async () => {
    const provider = new RecordingProvider()
    const sink = new FakeSink()
    const s = new SpeechService({ provider, sink })
    s.speak('# Title\nThis is **one**. This is two.')
    await settle()
    // Markdown is gone before the engine ever sees the text.
    expect(provider.synthesized.join('')).not.toMatch(/[*#]/)
    expect(provider.synthesized.join('')).toContain('Title.')
    expect(sink.chunks).toBeGreaterThan(0)
  })

  it('speaks nothing when the text normalizes to empty, and says so', async () => {
    const provider = new RecordingProvider()
    const log = vi.fn()
    const s = new SpeechService({ provider, sink: new FakeSink(), log })
    s.speak('.')
    await settle()
    expect(provider.synthesized).toEqual([])
    expect(log).toHaveBeenCalled()          // never fail silently
  })

  it('stop() is two-sided: cancels synthesis AND flushes playback', async () => {
    const provider = new RecordingProvider()
    const sink = new FakeSink()
    const s = new SpeechService({ provider, sink })
    s.speak('One. Two. Three.')
    await s.stop()
    expect(provider.cancelled).toBeGreaterThan(0)
    expect(sink.stops).toBeGreaterThan(0)
  })

  it('a synthesis failure stops speech, not the host', async () => {
    const provider = new RecordingProvider()
    provider.generate = async function* () {
      // Yield once so this is a real generator, then fail mid-utterance — the realistic case:
      // an engine that dies after producing some audio, not one that never starts.
      yield { data: new Uint8Array([1]), format: 'wav', sampleRate: 22050, channels: 1 }
      throw new Error('engine died')
    }
    const log = vi.fn()
    const s = new SpeechService({ provider, sink: new FakeSink(), log })
    s.speak('Hello there.')
    await settle()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('engine died'))
  })

  it("queue mode speaks utterances in order and never cuts one off", async () => {
    const provider = new RecordingProvider()
    const s = new SpeechService({ provider, sink: new FakeSink() })
    s.speak('First reply.', 'queue')
    s.speak('Second reply.', 'queue')
    s.speak('Third reply.', 'queue')
    await settle()
    const said = provider.synthesized.join(' ')
    expect(said).toContain('First reply.')
    expect(said).toContain('Second reply.')
    expect(said).toContain('Third reply.')
    expect(said.indexOf('First')).toBeLessThan(said.indexOf('Second'))
    expect(said.indexOf('Second')).toBeLessThan(said.indexOf('Third'))
  })

  it('replace mode interrupts, which is what a hotkey press means', async () => {
    const provider = new RecordingProvider()
    const sink = new FakeSink()
    const s = new SpeechService({ provider, sink })
    s.speak('Old text.', 'queue')
    s.speak('New text.', 'replace')
    await settle()
    expect(provider.cancelled).toBeGreaterThan(0)
    expect(sink.stops).toBeGreaterThan(0)
  })

  it('a full queue drops the OLDEST, never blocking the agent', async () => {
    const provider = new RecordingProvider()
    const log = vi.fn()
    const s = new SpeechService({ provider, sink: new FakeSink(), log, maxQueued: 2 })
    for (let i = 0; i < 6; i++) s.speak(`Reply number ${i}.`, 'queue')
    await settle()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('queue full'))
    // The log line alone could not fail for the reason this test is named for. Mutating
    // `replies.slice(-max)` to `replies.slice(0, max)` — i.e. dropping the NEWEST replies, the
    // exact opposite of the documented policy — left this test, and the whole file, green.
    // So assert WHICH end was discarded (docs/.research/test-audit.md, finding 2).
    const said = provider.synthesized.join(' ')
    expect(said, 'the newest reply was dropped — the queue discarded the wrong end')
      .toContain('Reply number five')
    expect(said, 'a middle reply survived a queue capped at two')
      .not.toContain('Reply number two')
    // ...and something WAS dropped, so "kept everything" cannot pass either.
    expect(said, 'nothing was actually dropped, so the policy was never exercised')
      .not.toContain('Reply number one')
  })
})

/**
 * H24/H20 — the settings with no wire.
 *
 * `SynthesizeOptions.voice` and `.rate` existed, and `OsSynthProvider` implemented both, but
 * `SpeechService` called `generate(chunk.text)` with no options, so the two settings every user
 * asks for first were unreachable from any caller. Same for the chunker's `isolateFirstSentence`,
 * of which only `maxUnits` was forwarded.
 *
 * This is a reachability test, not a taste test: it asserts the value ARRIVES, not what it is.
 */
describe('voice, rate and chunking are reachable from the caller', () => {
  it('forwards voice and rate to the provider', async () => {
    const provider = new RecordingProvider()
    const s = new SpeechService({ provider, sink: new FakeSink(), voice: 'Samantha', rate: 1.4 })
    s.speak('Hello there.')
    await settle()
    expect(provider.options.length).toBeGreaterThan(0)
    expect(provider.options[0]?.voice, 'voice never reached the engine').toBe('Samantha')
    expect(provider.options[0]?.rate, 'rate never reached the engine').toBe(1.4)
  })

  it('passes nothing when nothing is configured, so today’s behaviour is unchanged', async () => {
    const provider = new RecordingProvider()
    const s = new SpeechService({ provider, sink: new FakeSink() })
    s.speak('Hello there.')
    await settle()
    expect(provider.options[0]).toEqual({})
  })

  it('every chunk of a long utterance carries the same voice and rate', async () => {
    const provider = new RecordingProvider()
    const s = new SpeechService({ provider, sink: new FakeSink(), voice: 'Daniel', rate: 0.8, maxUnits: 12 })
    s.speak('One sentence here. Another sentence here. A third sentence here.')
    await settle()
    expect(provider.options.length).toBeGreaterThan(1)
    for (const o of provider.options) {
      expect(o.voice).toBe('Daniel')
      expect(o.rate).toBe(0.8)
    }
  })

  it('forwards isolateFirstSentence, which no caller could reach (H20)', async () => {
    const isolated = new RecordingProvider()
    const grouped = new RecordingProvider()
    // Default: first sentence alone, so audio starts as early as possible.
    new SpeechService({ provider: isolated, sink: new FakeSink(), maxUnits: 500 })
      .speak('One here. Two here. Three here.')
    // Turned off: the chunker is free to pack sentences together up to maxUnits.
    new SpeechService({
      provider: grouped, sink: new FakeSink(), maxUnits: 500, isolateFirstSentence: false
    }).speak('One here. Two here. Three here.')
    await settle()
    expect(isolated.synthesized[0]?.trim()).toBe('One here.')
    expect(grouped.synthesized[0], 'isolateFirstSentence:false had no effect').toContain('Two here.')
  })
})

/**
 * 006 section 20 finding 2 — the audio stream is the channel, not the notification tray.
 *
 * Every "never fail silently" path in this plugin used to terminate in `notifications.show`, whose
 * `{ delivered }` result is discarded. For a listener who is dyslexic and voice-first that is the
 * same as no report at all: of the 55 silent-failure sites the FMA found, the number reaching the
 * audio stream was ZERO.
 *
 * These tests give the service NO desktop-notification path — the assertions are on text the
 * provider was actually asked to synthesize, so the only way they pass is if it is genuinely said.
 */
describe('losses and degradations reach the audio stream', () => {
  it('a queue overflow is SPOKEN, naming the total, with the notification path disabled', async () => {
    const provider = new RecordingProvider()
    const dropped: number[] = []
    const s = new SpeechService({
      provider, sink: new FakeSink(), maxQueued: 2, announceDelayMs: 5,
      // Accounting only — this test asserts the SPOKEN sentence, not that this fired.
      onDropped: (n) => dropped.push(n)
    })
    for (let i = 0; i < 6; i++) s.speak(`reply number ${i}`, 'queue')
    await settle()

    const total = dropped.reduce((a, b) => a + b, 0)
    expect(total, 'the queue did not actually overflow, so nothing was proved').toBeGreaterThan(1)
    const spoken = provider.synthesized.join(' ')
    // Through the real pipeline: normalize() turns "3" into "three", so a match here also proves
    // the announcement was not slipped in past the normalizer.
    expect(spoken, 'the drop was never spoken').toContain(`Skipped ${numberToWords(total)} older repl`)
  })

  it('a burst names the TOTAL dropped, not just the last drop', async () => {
    const provider = new RecordingProvider()
    const dropped: number[] = []
    const s = new SpeechService({
      provider, sink: new FakeSink(), maxQueued: 2, announceDelayMs: 20,
      onDropped: (n) => dropped.push(n)
    })
    for (let i = 0; i < 8; i++) s.speak(`reply number ${i}`, 'queue')
    await settle()
    const total = dropped.reduce((a, b) => a + b, 0)
    const last = dropped[dropped.length - 1] ?? 0
    // The old coalescer restarted a timer holding only the latest `n`, so a burst of 1 + 1 + 1
    // announced "skipped 1" — under-reporting the loss in the one message whose job is to size it.
    expect(total).toBeGreaterThan(last)
    expect(provider.synthesized.join(' ')).toContain(`Skipped ${numberToWords(total)} older repl`)
  })

  it('says nothing about drops when nothing was dropped', async () => {
    // The control case. An indicator that never changes is a broken indicator: this proves the
    // assertion above can distinguish "announced" from "always announces".
    const provider = new RecordingProvider()
    const s = new SpeechService({ provider, sink: new FakeSink(), maxQueued: 8, announceDelayMs: 5 })
    s.speak('just one reply', 'queue')
    await settle()
    expect(provider.synthesized.join(' ')).not.toContain('Skipped')
  })

  it("announce('next') never interrupts, and is heard before what is queued behind it", async () => {
    const provider = new RecordingProvider()
    const s = new SpeechService({ provider, sink: new FakeSink() })
    s.speak('first reply here', 'queue')
    s.speak('second reply here', 'queue')
    s.announce('Two agents are active.')
    await settle()
    const order = provider.synthesized.join(' ')
    expect(order).toContain('first reply here')
    expect(order).toContain('second reply here')
    expect(order.indexOf('Two agents')).toBeGreaterThan(order.indexOf('first reply'))
    expect(order.indexOf('Two agents')).toBeLessThan(order.indexOf('second reply'))
  })

  it('an announcement is never trimmed away by the overflow it is reporting', async () => {
    const provider = new RecordingProvider()
    const s = new SpeechService({ provider, sink: new FakeSink(), maxQueued: 1, announceDelayMs: 1 })
    s.speak('reply alpha', 'queue')
    s.announce('Speech is degraded on this machine.')
    for (let i = 0; i < 10; i++) s.speak(`flood number ${i}`, 'queue')
    await settle()
    expect(provider.synthesized.join(' ')).toContain('Speech is degraded on this machine')
  })
})
