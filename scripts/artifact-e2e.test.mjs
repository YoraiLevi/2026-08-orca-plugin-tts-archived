/**
 * R18-02: ABSENT failures are exit 1 even with no model. Exit 2 means ONLY
 * "the PRESENT arm could not run". The parent used to `process.exit(2)` before
 * `failRows()`, so swallowing `nameSubstitution` printed `(none named)` and
 * still exited 2; CI mapped 2 to green.
 *
 * These tests drive `judge` with the exact JSON shapes the parent writes. They
 * do not spawn `say` (P31) and do not load the bundle.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { judge, OS_RATE, POCKET_RATE, scoreAbsent, isNamedSubstitution } from './artifact-score.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PARENT = join(ROOT, 'scripts/artifact-e2e.mjs')

const namedSub =
  'pocket was unavailable (pocket: Pocket TTS model is not ready in /tmp/empty); using System voice'

function goodAbsent () {
  return {
    error: null,
    chunkSampleRate: OS_RATE,
    displayName: 'System voice',
    rung: 'fallback',
    substitution: namedSub,
    signal: true,
  }
}

function goodPresent () {
  return {
    error: null,
    chunkSampleRate: POCKET_RATE,
    displayName: 'Pocket TTS',
    rung: 'preferred',
    signal: true,
    rms: 0.08,
    peak: 0.2,
  }
}

describe('R18-02: ABSENT is conclusive without a model', () => {
  it('unnamed substitution is exit 1 even when PRESENT could not run', () => {
    // Round 18 mutant A: swallow nameSubstitution, no ready cache.
    const absent = { ...goodAbsent(), substitution: null }
    const decision = judge({
      productKind: 'absent',
      productDetail: 'Pocket TTS is not installed',
      present: null,
      absent,
    })
    expect(decision.exit, 'ABSENT defect hid behind exit 2').toBe(1)
    expect(decision.rows.join('\n')).toMatch(/did not NAME the substitution/)
  })

  it('CONTROL: named substitution + no model is exit 2, not 0 and not 1', () => {
    const decision = judge({
      productKind: 'absent',
      present: null,
      absent: goodAbsent(),
    })
    expect(decision.exit, 'healthy ABSENT with no model must be INCONCLUSIVE, not PASS').toBe(2)
    expect(decision.rows).toEqual([])
    expect(decision.summary).toMatch(/PRESENT arm could not run/)
  })

  it('incomplete cache is exit 1 even when ABSENT named the floor', () => {
    const decision = judge({
      productKind: 'incomplete',
      productDetail: 'this directory has 1 of 23 required files',
      present: null,
      absent: goodAbsent(),
    })
    expect(decision.exit, 'incomplete was treated as a skip').toBe(1)
    expect(decision.rows.join('\n')).toMatch(/incomplete/)
    expect(decision.rows.join('\n')).toMatch(/exit 1/)
  })

  it('stale cache is the same defect, not a skip', () => {
    const decision = judge({
      productKind: 'stale',
      productDetail: 'found manifest 1, expected 2',
      present: null,
      absent: goodAbsent(),
    })
    expect(decision.exit).toBe(1)
    expect(decision.rows.join('\n')).toMatch(/stale/)
  })

  it('ABSENT wrong sample rate is exit 1 with no model', () => {
    const decision = judge({
      productKind: 'absent',
      present: null,
      absent: { ...goodAbsent(), chunkSampleRate: POCKET_RATE },
    })
    expect(decision.exit).toBe(1)
    expect(decision.rows.join('\n')).toMatch(/chunk\.sampleRate/)
  })

  it('CONTROL: scoreAbsent is empty for a healthy OS-floor arm', () => {
    expect(scoreAbsent(goodAbsent())).toEqual([])
  })

  it('R19-04: empty-string substitution is exit 1, not exit 2 (CI maps 2 to green)', () => {
    const decision = judge({
      productKind: 'absent',
      present: null,
      absent: { ...goodAbsent(), substitution: '' },
    })
    expect(decision.exit, 'substitution:\'\' hid behind exit 2').toBe(1)
    expect(decision.rows.join('\n')).toMatch(/did not NAME the substitution/)
  })

  it('R19-04: whitespace-only substitution is the same costume', () => {
    const decision = judge({
      productKind: 'absent',
      present: null,
      absent: { ...goodAbsent(), substitution: '   ' },
    })
    expect(decision.exit).toBe(1)
  })

  it('R19-04: a constant \'ok\' is not a named substitution', () => {
    const decision = judge({
      productKind: 'absent',
      present: null,
      absent: { ...goodAbsent(), substitution: 'ok' },
    })
    expect(decision.exit, 'substitution:\'ok\' hid behind exit 2').toBe(1)
    expect(isNamedSubstitution('ok')).toBe(false)
    expect(isNamedSubstitution('')).toBe(false)
    expect(isNamedSubstitution('   ')).toBe(false)
    expect(isNamedSubstitution(null)).toBe(false)
    expect(isNamedSubstitution(namedSub)).toBe(true)
  })
})

describe('R18-02: PRESENT failures stay exit 1 when the model is ready', () => {
  it('PRESENT at OS rate is exit 1', () => {
    const decision = judge({
      productKind: 'ready',
      present: { ...goodPresent(), chunkSampleRate: OS_RATE, displayName: 'System voice', rung: 'fallback' },
      absent: goodAbsent(),
    })
    expect(decision.exit).toBe(1)
    expect(decision.rows.join('\n')).toMatch(/24000/)
  })

  it('CONTROL: both arms healthy is exit 0', () => {
    const decision = judge({
      productKind: 'ready',
      present: goodPresent(),
      absent: goodAbsent(),
    })
    expect(decision.exit).toBe(0)
    expect(decision.rows).toEqual([])
    expect(decision.summary).toMatch(/24000/)
  })
})

describe('the parent actually uses judge (P26: a dead helper is not a check)', () => {
  const src = readFileSync(PARENT, 'utf8')

  it('imports judge and exits with decision.exit', () => {
    expect(src).toMatch(/import \{[^}]*judge[^}]*\} from '\.\/artifact-score\.mjs'/)
    expect(src).toContain('process.exit(decision.exit)')
  })

  it('no longer exits 2 before scoring ABSENT — the R18-02 costume', () => {
    // The defect: `if (present === null) { ... process.exit(2) }` ran BEFORE failRows.
    expect(src).not.toMatch(/if\s*\(\s*present\s*===\s*null\s*\)\s*\{[\s\S]{0,400}?process\.exit\(2\)/)
  })
})
