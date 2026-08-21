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
  // The reason goes in the SUITE TITLE, so a skipped platform prints it in the reporter. It used
  // to be carried by an extra `it` asserting `skipReason.length > 0` — inside `if (opts.skipReason)`,
  // where that is unconditionally true. A test that cannot fail is not a test; a visible title is.
  const title = opts.skipReason === undefined
    ? `provider contract: ${name}`
    : `provider contract: ${name} — SKIPPED: ${opts.skipReason}`
  const d = opts.skipReason === undefined ? describe : describe.skip

  d(title, () => {
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
      // The gate IS the budget. It used to be `CANCEL_BUDGET_MS * 20` = 1,000 ms with a
      // console.warn above 50, which is why nine documents could quote "measured within 50 ms"
      // while a 904 ms cancel stayed green (verified by mutation, docs/.research/test-audit.md).
      // A wedged provider is stopped by the test TIMEOUT below, which is what a timeout is for;
      // conflating "don't hang CI" with "meet the budget" is what produced the 20x.
      expect(elapsed, `cancel took ${elapsed} ms, budget ${CANCEL_BUDGET_MS} ms`)
        .toBeLessThanOrEqual(CANCEL_BUDGET_MS)
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

    it('lists voices as strings the settings UI can render', async () => {
      const p = make()
      await p.prepare()
      const voices = await p.listVoices()
      // `Array.isArray` alone passed for any array, including one of nulls. The UI renders these.
      expect(voices).toBeInstanceOf(Array)
      for (const v of voices) {
        expect(typeof v, `a non-string voice (${String(v)}) would render as [object Object]`).toBe('string')
        expect(v.length, 'an empty voice name is unselectable').toBeGreaterThan(0)
      }
    }, 120_000)
  })
}
