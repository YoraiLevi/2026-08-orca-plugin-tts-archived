import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CALL_SIGNS, identityFor, spokenPrefix } from './index.ts'

/**
 * M15 gate G6 — the MECHANICAL half only.
 *
 * What is certified here: two agents render the same reply to MEASURABLY DIFFERENT AUDIO.
 * What is NOT certified here, and must not be: that a listener can TELL THEM APART. That is
 * perceptual, its oracle is the author's ears, and a test claiming it would be inventing a
 * verdict — the same error the number-ceiling probe made when its two signals disagreed and it
 * quietly believed the harsher one.
 */

const RENDER = process.platform === 'darwin'

function renderSum (text: string, dir: string, tag: string): string {
  const f = join(dir, `${tag}.wav`)
  // `-o <file>`, never the device: the author is at this machine (P31).
  execFileSync('say', ['-o', f, '--data-format=LEI16@22050', '--', text])
  return createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 12)
}

describe('G6 — two agents are distinguishable BY MEASUREMENT', () => {
  it('derives a stable, hex-free call-sign from a session id', () => {
    const a = identityFor('9f3c1e77-aaaa-4bbb-8ccc-1234567890ab')
    const b = identityFor('9f3c1e77-aaaa-4bbb-8ccc-1234567890ab')
    expect(a.callSign, 'the same session got two different call-signs across calls')
      .toBe(b.callSign)
    expect(CALL_SIGNS, 'the call-sign is not from the table').toContain(a.callSign)
    // 005 forbids speaking hex. `sessionLabel()` was slicing eight characters of a UUID.
    expect(a.callSign, 'the call-sign looks like hex').not.toMatch(/^[0-9a-f]{4,}$/i)
  })

  it('reports voiceIndex as null when the host cannot distinguish voices', () => {
    // Stock Ubuntu. Null is the CORRECT answer; a caller treating it as "voice 0" would give two
    // agents the same voice while believing they differed.
    expect(identityFor('s-1', 0).voiceIndex, 'zero voices produced a voice index').toBeNull()
    expect(identityFor('s-1', 1).voiceIndex, 'one voice cannot distinguish anything').toBeNull()
    expect(identityFor('s-1', 41).voiceIndex, 'a host with voices got none').not.toBeNull()
  })

  /**
   * 60 s, and the number is a measured hang-detector rather than a race being papered over.
   * `say -o` costs 2,786 / 2,886 / 3,021 ms per render at load 6 `[measured-here]`, and this case
   * renders THREE times — the two identities plus the control — so ~9 s is the honest floor and
   * the default 5 s could never have passed. A generous ceiling over a measured worst case is the
   * legitimate half of "do not fix a race with a longer timeout"; inflating a budget until a race
   * stops losing is the other half, and this is not that.
   */
  it.runIf(RENDER)('the same reply under two identities renders to different bytes', { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'g6-'))
    try {
      const reply = 'Four files changed, and one of them is the interesting one.'
      const alpha = identityFor('session-alpha')
      const bravo = identityFor('session-bravo')
      expect(alpha.callSign, 'the two fixtures collided on one call-sign — pick other ids')
        .not.toBe(bravo.callSign)

      const aSum = renderSum(spokenPrefix(alpha) + ' ' + reply, dir, 'alpha')
      const bSum = renderSum(spokenPrefix(bravo) + ' ' + reply, dir, 'bravo')

      // THE CONTROL, and it is the whole reason this test means anything: the same identity twice
      // must render IDENTICALLY. Without it, a comparison that can never match would pass
      // vacuously — this repo has found that exact failure four times in two days.
      const aAgain = renderSum(spokenPrefix(alpha) + ' ' + reply, dir, 'alpha2')
      expect(aSum, 'CONTROL FAILED: the same input rendered differently, so this comparison '
        + 'cannot tell two utterances apart and no verdict from it means anything')
        .toBe(aAgain)

      expect(aSum, 'two identities rendered to identical audio — they are not distinguishable')
        .not.toBe(bSum)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
