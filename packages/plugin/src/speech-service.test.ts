import { describe, expect, it, vi } from 'vitest'
import { SpeechService } from './speech-service.js'
import type { AudioChunk, PlaybackSink, ProviderCapabilities, TtsProvider } from '@orca-tts/core'

class RecordingProvider implements TtsProvider {
  id = 'fake'; displayName = 'Fake'
  synthesized: string[] = []
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
  async *generate(text: string): AsyncIterable<AudioChunk> {
    this.synthesized.push(text)
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
    await s.speak('# Title\nThis is **one**. This is two.').done
    // Markdown is gone before the engine ever sees the text.
    expect(provider.synthesized.join('')).not.toMatch(/[*#]/)
    expect(provider.synthesized.join('')).toContain('Title.')
    expect(sink.chunks).toBeGreaterThan(0)
  })

  it('speaks nothing when the text normalizes to empty, and says so', async () => {
    const provider = new RecordingProvider()
    const log = vi.fn()
    const s = new SpeechService({ provider, sink: new FakeSink(), log })
    await s.speak('.').done
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
    await expect(s.speak('Hello there.').done).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('engine died'))
  })
})
