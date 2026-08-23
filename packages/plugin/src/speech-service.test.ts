import { describe, expect, it, vi } from 'vitest'
import { SpeechService } from './speech-service.ts'
import { numberToWords } from '@orca-tts/core'
import type {
  AudioChunk, PlaybackSink, ProviderCapabilities, SynthesizeOptions, TtsProvider
} from '@orca-tts/core'

/** Let the async drain loop run to completion. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5))
}

/**
 * A promise the test resolves by hand.
 *
 * Exists so a test can ARRANGE the moment it needs rather than out-run the system to reach it —
 * P40's failure mode, and the reason the site-32 test below could not fail.
 */
const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
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

  it('the provider selectEngine returns is who generate() is called on', async () => {
    const constructed = new RecordingProvider()
    constructed.id = 'constructed'
    const selected = new RecordingProvider()
    selected.id = 'selected'
    const s = new SpeechService({
      provider: constructed, sink: new FakeSink(),
      settings: () => ({ revision: 1, values: { 'synthesize.engine': 'os' } }),
      selectEngine: async () => selected
    })
    s.speak('Hello there.')
    await settle()
    expect(selected.synthesized.length, 'selectEngine returned a provider that never generated')
      .toBeGreaterThan(0)
    expect(constructed.synthesized, 'the constructor provider still generated after a swap')
      .toEqual([])
  })

  it('selectEngine is handed synthesize.engine once per utterance, not per chunk', async () => {
    const provider = new RecordingProvider()
    const seen: unknown[] = []
    const s = new SpeechService({
      provider, sink: new FakeSink(), maxUnits: 12,
      settings: () => ({ revision: 1, values: { 'synthesize.engine': 'pocket' } }),
      selectEngine: async (engine) => { seen.push(engine); return provider }
    })
    s.speak('One sentence here. Another sentence here. A third sentence here.')
    await settle()
    expect(provider.options.length, 'the utterance did not chunk, so once-per-utterance is untested')
      .toBeGreaterThan(1)
    expect(seen, 'engine was re-read per chunk, or never read').toEqual(['pocket'])
  })

  it('CONTROL: without selectEngine the constructor provider is who generates', async () => {
    const provider = new RecordingProvider()
    const s = new SpeechService({
      provider, sink: new FakeSink(),
      settings: () => ({ revision: 1, values: { 'synthesize.engine': 'pocket' } })
    })
    s.speak('Hello there.')
    await settle()
    expect(provider.synthesized.length).toBeGreaterThan(0)
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

/**
 * 006 sites 31, 32, 33 and 53 — the losses that happen INSIDE a reply.
 *
 * All four ended in `this.#deps.log?.(...)` or a bare `return`. The listener hears sentence one,
 * then the next reply starts, and the middle of their answer is gone with nothing to distinguish
 * it from the agent having finished. Site 31 is the FMA's "most reachable total-silence path in the
 * product": a reply that is only code, only a diagram, only emoji, only a check mark.
 *
 * Every service here is built with **no `log` and no `onDropped`** — the developer-facing channels
 * do not exist — so an assertion can only pass on text the provider was actually handed to speak.
 * Urgency is `'next'` throughout: these all describe something that already happened, and
 * interrupting the sentence being followed to report a sentence already lost is a second loss.
 */
describe('006 sites 31/32/33/53 — a loss inside a reply is spoken, not logged', () => {
  it('site 31: a reply with nothing speakable in it is announced, not silently skipped', async () => {
    const provider = new RecordingProvider()
    const s = new SpeechService({ provider, sink: new FakeSink(), announceDelayMs: 5 })
    // Emoji-only. A code fence would NOT do: it normalizes to "Here, a code block is omitted."
    // — a fixture that cannot express the failure makes the assertion green for free (P33).
    s.speak('\u{1F389}\u{1F389}', 'queue')
    await settle()
    expect(provider.synthesized.join(' '), 'total silence, indistinguishable from no answer')
      .toMatch(/nothing in it that could be read aloud/i)
  })

  it('CONTROL: a reply with real prose in it is never announced as unspeakable', async () => {
    const provider = new RecordingProvider()
    const s = new SpeechService({ provider, sink: new FakeSink(), announceDelayMs: 5 })
    s.speak('Here is a real answer.', 'queue')
    await settle()
    const said = provider.synthesized.join(' ')
    expect(said).toContain('Here is a real answer')
    expect(said, 'a working reply must not be reported as a loss').not.toMatch(/could be read aloud/i)
  })

  it('site 33: synthesis failing mid-reply is spoken, not swallowed into a log', async () => {
    class DiesAfterFirstChunk extends RecordingProvider {
      calls = 0
      override async *generate(text: string, opts: SynthesizeOptions = {}): AsyncIterable<AudioChunk> {
        this.calls++
        if (this.calls === 2) throw new Error('engine died')
        yield* super.generate(text, opts)
      }
    }
    const provider = new DiesAfterFirstChunk()
    const s = new SpeechService({
      provider, sink: new FakeSink(), announceDelayMs: 5, maxUnits: 24
    })
    s.speak('First sentence here. Second sentence here. Third sentence here.', 'queue')
    await settle()
    expect(provider.synthesized.join(' '), 'the listener was never told their reply was truncated')
      .toMatch(/cut short/i)
  })

  it('site 32: pressing skip is NOT reported as a failure', async () => {
    // The reason site 32 had to be fixed before site 33 could be: with all six causes collapsed
    // into one silent return, announcing the loss would announce every skip as an engine failure.
    //
    // WHY THIS TEST IS BUILT THIS WAY. The previous version pressed skip after `setTimeout(2)`
    // against a provider that returns instantly. The utterance had always finished by then, so
    // `#speakOne` never reached its skip check at all and the assertion below was green for free:
    // the `skip-reported-as-failure` mutant survived it. The precondition is now ARRANGED — the
    // provider holds the utterance open BETWEEN chunks, so skip is pressed at exactly the instant
    // the invariant is about (P40: a precondition reached by out-running the system is not a
    // precondition). Holding it *after* chunk one's audio was pushed matters: the generation is
    // still current, so `#skip` is the only thing that can end the loop, and the outcome the
    // service reports is the one under test rather than `superseded`.
    const chunkOneDone = deferred()
    const release = deferred()
    class HoldsBetweenChunks extends RecordingProvider {
      calls = 0
      override async *generate(text: string, opts: SynthesizeOptions = {}): AsyncIterable<AudioChunk> {
        this.calls++
        yield* super.generate(text, opts)
        if (this.calls === 1) { chunkOneDone.resolve(); await release.promise }
      }
    }
    const provider = new HoldsBetweenChunks()
    const s = new SpeechService({ provider, sink: new FakeSink(), announceDelayMs: 5, maxUnits: 20 })
    s.speak('Alpha sentence one. Bravo sentence two. Charlie sentence three.', 'queue')
    s.speak('Delta the next reply.', 'queue')
    await chunkOneDone.promise
    const skipping = s.skip()   // sets #skip synchronously, before the drain loop can resume
    release.resolve()
    await skipping
    await settle()

    const said = provider.synthesized.join(' ')
    // Two controls, so the assertion that matters cannot be green because nothing happened.
    expect(said, 'the utterance never started; the assertion below would prove nothing')
      .toContain('Alpha')
    expect(said, 'skip must land mid-utterance, or the skip check is never reached')
      .not.toContain('Charlie')
    // The behaviour, not just the report: skip ABANDONS this utterance and moves to the next one.
    // Without this the service could satisfy every assertion above by going permanently silent.
    expect(said, 'skip must move to the next reply, not end speech').toContain('Delta')
    expect(said, 'a control the listener pressed became an error report')
      .not.toMatch(/cut short|failed/i)
  })

  it('site 53: a mid-word cut is named, once, instead of being computed and discarded', async () => {
    const provider = new RecordingProvider()
    const s = new SpeechService({
      provider, sink: new FakeSink(), announceDelayMs: 5, maxUnits: 12
    })
    // No sentence, clause or word boundary inside the limit, so the chunker must cut mid-word and
    // marks it `boundary: 'scalar'` — which speech-service.ts read only `.text` from.
    s.speak('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'queue')
    await settle()
    // The announcement is itself chunked at maxUnits, so re-join it the way a listener hears it.
    const said = provider.synthesized.join('').replace(/\s+/g, ' ')
    expect(said, 'the mid-word cut was computed correctly and told to nobody')
      .toMatch(/cut mid-word/i)
    expect(said.match(/cut mid-word/gi)?.length, 'one paste must not produce a dozen reports').toBe(1)
  })
})

/**
 * 006 section 19 RANK THREE — "whose words are being spoken", and cascade C1.
 *
 * The queue entry was `{ text, label }`: a display string formatted at enqueue time, with nothing
 * left to re-verify against. So a session that ends while its reply is queued has its words spoken
 * under a label — and, once M15 lands, in a VOICE — that now belongs to a different, live agent.
 * The listener is told whose words they are, confidently, and it is not true.
 *
 * Every assertion here is on SPOKEN TEXT. No audio device is opened: the provider is a fake that
 * records strings (P31).
 */
describe('006 rank 3 — provenance is re-resolved at speak time, not trusted from enqueue time', () => {
  it('a session that ended while queued is named, not silently spoken as somebody else', async () => {
    const provider = new RecordingProvider()
    // Alive at enqueue, gone by the time the drain reaches it — C1's whole sequence in one seam.
    let alive = true
    const s = new SpeechService({
      provider,
      sink: new FakeSink(),
      resolveLabel: (id) => (alive ? `orca-plugin-tts, session ${id}` : null)
    })
    // The drain runs synchronously up to its first await, so an entry queued BEHIND something
    // else is the only one whose provenance is resolved after the world has moved — which is C1's
    // sequence exactly: the reply is waiting in the queue when the session exits.
    s.speak('an earlier reply.', 'queue')
    s.speak('the reply the dead agent wrote', 'queue', 'orca-plugin-tts, session aaaa1111', 'aaaa1111')
    alive = false
    await settle()
    const spoken = provider.synthesized.join(' ')
    expect(spoken, 'the reply itself must still be spoken — refusing it costs the listener the words')
      .toContain('the reply the dead agent wrote')
    expect(spoken, 'the listener must be told the session it came from has ended')
      .toMatch(/has since ended/)
  })

  it('a label that changed under the queue is corrected aloud', async () => {
    const provider = new RecordingProvider()
    let current = 'project one, session aaaa1111'
    const s = new SpeechService({
      provider, sink: new FakeSink(), resolveLabel: () => current
    })
    s.speak('an earlier reply.', 'queue')
    s.speak('a reply', 'queue', 'project one, session aaaa1111', 'aaaa1111')
    current = 'project two, session aaaa1111'
    await settle()
    // The prefix goes through the normalizer with the reply, so the digits are read as words —
    // the same treatment the label already gets everywhere else. Assert on the part that carries
    // the meaning: WHICH project the words came from.
    expect(provider.synthesized.join(' ')).toContain('From project two, session')
  })

  /**
   * The harm on the other side. Narrating provenance on every utterance is exactly the
   * self-narrating tool this audit exists to avoid, so the correction is spoken ONCE per session
   * per change — and never at all while the answer has not changed.
   */
  it('says nothing when provenance still holds, and says it once when it does not', async () => {
    const provider = new RecordingProvider()
    let alive = true
    const s = new SpeechService({
      provider, sink: new FakeSink(),
      resolveLabel: (id) => (alive ? `p, session ${id}` : null)
    })
    s.speak('an earlier reply.', 'queue')
    s.speak('one', 'queue', 'p, session s1', 's1')
    s.speak('two', 'queue', 'p, session s1', 's1')
    await settle()
    expect(provider.synthesized.join(' '), 'a live session must not be narrated')
      .not.toMatch(/From p, session/)

    alive = false
    s.speak('another earlier reply.', 'queue')
    s.speak('three', 'queue', 'p, session s1', 's1')
    s.speak('four', 'queue', 'p, session s1', 's1')
    await settle()
    const said = provider.synthesized.join(' ')
    expect(said.match(/has since ended/g) ?? [], 'once per session per change, not once per reply')
      .toHaveLength(1)
    expect(said).toContain('four')
  })
})
