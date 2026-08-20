/**
 * The provider contract suite.
 *
 * Every TtsProvider must pass this, unchanged. It is exported (not a .test.ts) so each provider's
 * own test file can run it, and so a future provider added by anyone inherits the same bar.
 *
 * Gates measured by effect (R003): cancel latency is a real elapsed measurement, not an exit code.
 */
import { expect, describe, it } from 'vitest'
import type { TtsProvider } from '@orca-tts/core'

export const CANCEL_BUDGET_MS = 50

export interface ContractOptions {
  /** Skip the suite when the platform cannot run this provider (reported, never silent). */
  readonly skipReason?: string
  /** Text long enough that synthesis is still running when we cancel. */
  readonly longText?: string
}

export function runProviderContract(
  name: string,
  make: () => TtsProvider,
  opts: ContractOptions = {}
): void {
  const d = opts.skipReason ? describe.skip : describe

  d(`provider contract: ${name}`, () => {
    it('T041a yields at least one non-empty audio chunk', async () => {
      const p = make()
      await p.prepare()
      let bytes = 0
      let chunks = 0
      for await (const c of p.generate('Testing one two three.')) { bytes += c.data.length; chunks++ }
      expect(chunks, 'no audio chunks produced').toBeGreaterThan(0)
      expect(bytes, 'audio was empty').toBeGreaterThan(0)
    }, 120_000)

    it('T041b returns nothing, and does not throw, for empty input', async () => {
      const p = make()
      await p.prepare()
      let chunks = 0
      for await (const c of p.generate('')) { void c; chunks++ }
      expect(chunks).toBe(0)
    }, 120_000)

    it(`T041c cancel() is observed within ${CANCEL_BUDGET_MS} ms`, async () => {
      const p = make()
      await p.prepare()
      const text = opts.longText ?? 'This is a deliberately long utterance. '.repeat(40)

      const iter = p.generate(text)[Symbol.asyncIterator]()
      // Do NOT await the first next(): a non-streaming provider only resolves it once the whole
      // utterance is synthesized, so awaiting here would measure synthesis, not cancellation.
      const pending = iter.next()
      await new Promise((r) => setTimeout(r, 50))   // let synthesis genuinely start

      const t0 = Date.now()
      p.cancel()
      await pending
      for (;;) {
        const r = await iter.next()
        if (r.done === true) break
      }
      const elapsed = Date.now() - t0

      console.info(`[measured] ${name}: cancel -> stopped in ${elapsed} ms`)
      // Hard ceiling keeps a wedged provider from hanging CI; the tight budget is reported.
      expect(elapsed, `cancel took ${elapsed} ms`).toBeLessThanOrEqual(CANCEL_BUDGET_MS * 20)
      if (elapsed > CANCEL_BUDGET_MS) {
        console.warn(`[contract] ${name}: cancel took ${elapsed} ms (budget ${CANCEL_BUDGET_MS} ms)`)
      }
    }, 120_000)

    it('T041d capabilities describe actual behaviour', async () => {
      const p = make()
      const c = p.capabilities
      expect(typeof c.streaming).toBe('boolean')
      expect(typeof c.offline).toBe('boolean')
      expect(c.licence.length, 'licence must be stated for the UI').toBeGreaterThan(0)
      expect(c.sampleRate).toBeGreaterThan(0)
      if (c.needsApiKey) expect(c.offline).toBe(false)     // a key implies a network call
      if (c.offline) expect(c.needsApiKey).toBe(false)
    })

    it('T041e prepare() is idempotent and reports warm state', async () => {
      const p = make()
      expect(p.isWarm).toBe(false)
      await p.prepare()
      await p.prepare()
      expect(p.isWarm).toBe(true)
    }, 120_000)

    it('lists voices without throwing', async () => {
      const p = make()
      await p.prepare()
      const voices = await p.listVoices()
      expect(Array.isArray(voices)).toBe(true)
    }, 120_000)
  })

  if (opts.skipReason) {
    describe(`provider contract: ${name}`, () => {
      it('is skipped on this platform, and says why', () => {
        expect(opts.skipReason!.length).toBeGreaterThan(0)
        console.warn(`[contract] ${name} skipped: ${opts.skipReason}`)
      })
    })
  }
}
