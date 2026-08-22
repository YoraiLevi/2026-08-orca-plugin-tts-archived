import { describe, expect, it } from 'vitest'
import { decodeClaudeLine } from './decoders.ts'

/**
 * Round 13 — the transcript-TAILER seam, opened for the first time.
 *
 * Round 10 called the protocol's state "sampled, not surveyed": of five seam inventories, three
 * were surveyed and two had never been opened. This is one of them. Its rows sat in `006` section
 * 1 as prose for two days, and the fix below shipped without a single test.
 *
 * SEAM: a transcript record -> `decodeClaudeLine` -> the id set huddle dedups on.
 * CONTRACT: the same bytes must yield the same id, forever. If they do not, dedup cannot match and
 * the reply is read aloud again on every file touch.
 */

describe('SC-19 — a record with no uuid still dedups (006 TT4)', () => {
  /**
   * TT4, severity S1: the fallback id was `${Date.now()}-${parts.length}`, so it CHANGED ON EVERY
   * READ. The listener heard the same paragraph again, and again, every time the file was touched
   * — "speech they did not ask for and that keeps coming back", which is P22's whole complaint
   * arriving through a side door P20 did not close.
   *
   * The fix is `stableId(text)`, a content hash. It shipped with NO TEST: `grep stableId` over the
   * huddle tests returned nothing before this file existed. A fix nobody can regress-check is a
   * fix that will be refactored away by someone who cannot see why it is there.
   *
   * This is the instrument `006` TT4 itself specified — "read an unchanged file twice and assert
   * the id set is identical" — written down as a check rather than left as a recommendation.
   */
  const uuidless = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'The build finished, and one test is still red.' }] }
  })

  it('yields the same id when the same bytes are decoded twice, ACROSS TIME', async () => {
    // The delay is the whole test. The first draft decoded twice in a row, and restoring TT4's
    // exact defect — `${Date.now()}-${parts.length}` — LEFT IT GREEN, because both calls landed in
    // the same millisecond. A test that cannot fail for the defect it names is worse than no test:
    // it certifies the fix while proving nothing about it. Caught by mutation, not by reading.
    //
    // 5 ms, not 1: `Date.now()` has millisecond resolution and a 1 ms sleep can round to the same
    // tick. The real property is "the id does not depend on WHEN it was computed", so the reads
    // must straddle a clock boundary that a time-based implementation would notice.
    const first = decodeClaudeLine(uuidless)
    await new Promise((r) => setTimeout(r, 5))
    const second = decodeClaudeLine(uuidless)
    expect(first, 'the fixture did not decode at all, so this proves nothing').not.toBeNull()
    expect(first?.id, 'the same record decoded to two different ids — dedup cannot match, so the '
      + 'listener hears this paragraph again on every file touch (006 TT4, severity S1)')
      .toBe(second?.id)
  })

  it('CONTROL: different text yields a different id', () => {
    // Without this, an implementation returning a CONSTANT id would satisfy the test above while
    // silently collapsing every uuid-less reply into one — the opposite failure, equally silent.
    const other = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'A different reply entirely.' }] }
    })
    expect(decodeClaudeLine(uuidless)?.id, 'two different replies share one id — dedup would '
      + 'swallow the second and the listener never hears it')
      .not.toBe(decodeClaudeLine(other)?.id)
  })

  it('a real uuid is preferred over the derived one', () => {
    const withUuid = JSON.stringify({
      type: 'assistant', uuid: 'real-uuid-1234',
      message: { content: [{ type: 'text', text: 'The build finished, and one test is still red.' }] }
    })
    expect(decodeClaudeLine(withUuid)?.id, 'the record carried a uuid and it was ignored')
      .toBe('real-uuid-1234')
  })
})
