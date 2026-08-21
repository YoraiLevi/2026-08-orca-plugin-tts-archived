/**
 * SC-11 — seam 10: `SpeechService` outcome → the announcement channel.
 *
 * Round 9 left this row **reasoned, not tested**, and labelled it "the weakest row here" because it
 * was judged by reading — the method `006` section 22 exists to distrust. Round 10 closes it.
 *
 * THE CONTRACT, in the section-22 form. `#speakOne` returns one of six outcomes and they split into
 * two kinds that must be treated in OPPOSITE ways:
 *
 *   LOSS    — 'empty', 'synthesis-failed'   → the listener LOST content they were waiting for, and
 *                                             P30 / principle I say a loss is never silent.
 *   CONTROL — 'cancelled', 'skipped',       → the listener CAUSED this, one second ago, by pressing
 *             'superseded'                    something. Announcing it is the helplessness P22
 *                                             recorded, not a fix for it. Stop answering "stop"
 *                                             with more speech.
 *
 * `'spoken'` is neither and must produce nothing.
 *
 * WHY THE SPLIT IS THE THING TO TEST rather than the individual sentences: the defect this seam
 * actually had (006 site 32) was that cancelled, skipped and superseded all arrived at ONE
 * indistinguishable early `return` alongside the real losses, so "the engine died halfway through
 * your reply" and "you pressed skip" were the same observable. The outcomes are distinct now. This
 * asserts that their TREATMENT stayed distinct, which is the part that can silently regress.
 *
 * P36: the outcome list and its two-way split are RESTATED here, not imported. `SpeakOutcome` is a
 * non-exported type alias with no runtime form, so there is nothing to import even if we wanted to
 * — which is itself why this seam had no test.
 */
import { describe, expect, it } from 'vitest'
import { SpeechService } from '../speech-service.ts'
import type {
  AudioChunk, PlaybackSink, ProviderCapabilities, SynthesizeOptions, TtsProvider
} from '@orca-tts/core'

/**
 * Wait for a CONDITION, never for a duration.
 *
 * A fixed sleep is a prediction about how fast this machine is, and the machine is the one part of
 * the system nobody controls. Under load the prediction is wrong and the test goes red for a reason
 * that has nothing to do with the code — which is `019`/`021` R12-01, and this file was one of the
 * nine that had it. The ceiling is generous because it is a BACKSTOP against a hang, not a
 * measurement: on a quiet machine this returns almost immediately, and on a loaded one it still
 * returns the right answer instead of a faster wrong one.
 */
const until = async (done: () => boolean, ceilingTicks = 600): Promise<void> => {
  for (let i = 0; i < ceilingTicks; i++) {
    if (done()) return
    await new Promise((r) => setTimeout(r, 5))
  }
}

/** Only for the rows that assert something did NOT happen; there is no condition to wait on. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 5))
}

/** Records every string the engine was asked to say, in order. */
class SpyProvider implements TtsProvider {
  id = 'spy'; displayName = 'Spy'
  said: string[] = []
  /** Set to make `generate` throw, reproducing a mid-utterance engine death. */
  failOn: string | null = null
  capabilities: ProviderCapabilities = {
    streaming: true, offline: true, needsApiKey: false, needsModelDownload: 0,
    licence: 'test', cloning: false, sampleRate: 22050
  }
  get isWarm(): boolean { return true }
  async prepare(): Promise<void> { /* always warm */ }
  cancel(): void { /* nothing to cancel in a fake */ }
  async listVoices(): Promise<readonly string[]> { return [] }
  async *generate(text: string, _opts: SynthesizeOptions = {}): AsyncIterable<AudioChunk> {
    if (this.failOn !== null && text.toLowerCase().includes(this.failOn)) throw new Error('engine died')
    this.said.push(text)
    yield { data: new Uint8Array([1]), format: 'wav', sampleRate: 22050, channels: 1 }
  }
}

class FakeSink implements PlaybackSink {
  isPlaying = false
  async enqueue(): Promise<void> { /* nothing to play in a fake */ }
  async stop(): Promise<void> { /* nothing to stop in a fake */ }
}

function service (provider: SpyProvider): SpeechService {
  // 1 ms so the coalescing window closes inside `settle()` rather than after the test ends.
  return new SpeechService({ provider, sink: new FakeSink(), announceDelayMs: 1 })
}

/** Did anything in the audio stream sound like a report ABOUT the speech system? */
function reports (said: string[]): string[] {
  return said.filter((s) => /nothing in (it|them) that could be read|cut short|Skipped|Speech failed|read aloud/i.test(s))
}

describe('SC-11 — a LOSS reaches the audio stream, and a CONTROL does not', () => {
  it('outcome `empty`: an unspeakable reply is reported aloud', async () => {
    const p = new SpyProvider()
    const s = service(p)
    s.speak('\u{1f389}\u{1f389}\u{1f389}')          // emoji only: normalizes to nothing
    await until(() => reports(p.said).length > 0)
    expect(reports(p.said), 'a reply that could not be read aloud was not reported').toHaveLength(1)
    expect(p.said.join(' ')).toContain('nothing in it that could be read aloud')
  })

  it('outcome `synthesis-failed`: an engine that dies mid-reply is reported aloud', async () => {
    const p = new SpyProvider()
    p.failOn = 'alpha'
    const s = service(p)
    s.speak('Alpha one. Beta two.')
    await until(() => p.said.some((t) => t.includes('cut short')))
    expect(p.said.join(' ')).toContain('cut short')
  })

  it('outcome `spoken`: a reply that worked produces no report at all', async () => {
    const p = new SpyProvider()
    const s = service(p)
    s.speak('This one is fine. Nothing to report.')
    await settle()
    expect(reports(p.said), `unexpected report: ${JSON.stringify(reports(p.said))}`).toHaveLength(0)
  })

  /**
   * Asserted as "nothing further was synthesized AT ALL", not as "no known report sentence
   * appeared". The first version of this test used a regex over the sentences the code happens to
   * emit today, and a mutation that made `stop()` say "Stopped." sailed straight through it -- the
   * test could only see reports it already knew the words of. A control that answers with speech is
   * a defect whatever the words are, so the assertion is on the COUNT.
   */
  it('outcome `cancelled`: stop is answered with silence, never with a sentence', async () => {
    const p = new SpyProvider()
    const s = service(p)
    s.speak('One. Two. Three.')
    await s.stop()
    const afterStop = p.said.length
    await settle()
    expect(p.said.length, `stop produced ${p.said.length - afterStop} further utterance(s): ` +
      `${JSON.stringify(p.said.slice(afterStop))} -- the P22 helplessness shape`).toBe(afterStop)
  })

  it('outcome `skipped`: skip is answered with silence too', async () => {
    const p = new SpyProvider()
    const s = service(p)
    s.speak('One. Two. Three.')
    await s.skip()
    await settle()
    expect(reports(p.said), 'skip announced itself').toHaveLength(0)
  })

  it('a LOSS is coalesced into one sentence naming the total, not a burst of sentences', async () => {
    const p = new SpyProvider()
    const s = service(p)
    s.speak('\u{1f389}', 'queue')
    s.speak('\u{1f38a}', 'queue')
    s.speak('\u{1f386}', 'queue')
    await until(() => reports(p.said).length > 0)
    const r = reports(p.said)
    expect(r, `expected one coalesced report, got ${JSON.stringify(r)}`).toHaveLength(1)
    // "three", not "3": the report is itself spoken, so it goes through `normalize()` like any
    // other text and `expandNumbers` turns the count into a word. Asserted in the form the
    // LISTENER receives, which is the only form that matters at this seam.
    expect(r[0]).toContain('three replies')
  })

  /**
   * The recursion guard, and the reason it is a seam row rather than a unit test: the announcement
   * channel is BOTH the reporter and a consumer of the same pipeline. An announcement that cannot
   * itself be spoken must not announce that it could not be spoken.
   */
  it('an announcement that fails does not announce its own failure forever', async () => {
    const p = new SpyProvider()
    p.failOn = 'z'
    const s = service(p)
    s.announce('zzz')
    await until(() => p.said.length >= 10)   // the runaway this row exists to detect
    expect(p.said.length, 'the announcement channel fed itself').toBeLessThan(10)
  })
})
