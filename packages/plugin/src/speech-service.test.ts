import { describe, expect, it, vi } from 'vitest'
import { SpeechService } from './speech-service.js'
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
