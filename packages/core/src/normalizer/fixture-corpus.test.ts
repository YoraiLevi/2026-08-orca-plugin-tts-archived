import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalize } from './index.ts'

/**
 * T110 — the Voice Lab fixture corpus.
 *
 * These tests assert that every fixture SURVIVES the pipeline and that the corpus as a whole
 * still exercises all 17 normalizer stages. They deliberately assert NOTHING about *what* the
 * spoken text says: that is taste, it belongs to the listener, and arguing it here is exactly
 * the loop PITFALLS P23 says does not converge.
 *
 * Every coverage case is written as an EFFECT, not a presence check (P33): either an option
 * toggle that must change the output, or a construct that is present in the markdown and gone
 * from the speech. Deleting a stage from `normalize()` must turn one of these red.
 */

const FIXTURE_DIR = fileURLToPath(new URL('../../../../fixtures/', import.meta.url))
const SOURCE = fileURLToPath(new URL('./index.ts', import.meta.url))

const FIXTURES = [
  'code-heavy.md', 'tables.md', 'paths.md', 'architecture.md', 'short.md', 'hostile.md'
] as const

const read = (name: string): string => readFileSync(`${FIXTURE_DIR}${name}`, 'utf8')

const hasEmoji = (s: string): boolean => {
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    if ((cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf)) return true
  }
  return false
}

/**
 * One entry per stage called from `normalize()`. `check` receives the raw markdown and the
 * default spoken output and must prove the stage did something to THIS fixture.
 */
interface Coverage {
  readonly stage: string
  readonly fixture: (typeof FIXTURES)[number]
  readonly check: (raw: string, out: string) => void
}

const COVERAGE: Coverage[] = [
  {
    stage: 'stripFencedCode',
    fixture: 'code-heavy.md',
    check: (raw, out) => {
      expect(raw).toMatch(/^```/m)
      expect(out).not.toContain('```')
      // The policy is reachable and observable on this fixture.
      expect(normalize(raw, { codeBlocks: 'announce' })).not.toBe(normalize(raw, { codeBlocks: 'drop' }))
    }
  },
  {
    /**
     * J21 bug 1. Every fixture in this corpus opens with a provenance comment, and before stage 2
     * existed the listener's FIRST audio from each was the chunk `"<!"`, followed by the comment
     * read aloud as though it were the answer. The phrases below are restated here rather than
     * derived from the fixture, so that editing the fixture cannot quietly make this vacuous (P36).
     */
    stage: 'stripHtmlComments',
    fixture: 'short.md',
    check: (raw, out) => {
      expect(raw).toContain('<!--')
      expect(raw).toContain('a two-sentence answer')
      expect(out).not.toContain('<!')
      expect(out).not.toContain('-->')
      expect(out).not.toContain('a two-sentence answer')
      expect(out).not.toContain('T110e')
      // And the prose the comment was hiding IS still spoken — an over-eager strip would be
      // just as wrong, and a "does not contain" assertion alone cannot tell the two apart.
      expect(out).toContain('the first sentence is synthesized')
    }
  },
  {
    /**
     * M14a / gate G3. `hostile.md`'s provenance comment states the requirement in its own words:
     * "The ASCII diagram is design 002's motivating case: it must never be spoken as box
     * characters." Before this stage existed the listener heard, verbatim, a few hundred box
     * characters `[measured-here]`.
     *
     * Both halves are asserted, because the first alone is trivially satisfiable by deleting the
     * block and the second is the deliverable: the geometry is GONE, and the diagram's own labels
     * ARE spoken. The label phrases are restated here rather than read off the fixture, so editing
     * the fixture cannot make this vacuous (P36).
     */
    stage: 'diagramsToLabels',
    fixture: 'hostile.md',
    check: (raw, out) => {
      expect(raw).toMatch(/[\u2500-\u259f]/u)
      expect(out, 'the listener still hears box-drawing characters').not.toMatch(/[\u2500-\u259f]/u)
      expect(out, 'the loss reached no channel the listener has (P30)').toContain('a diagram is omitted')
      expect(out).toContain('transcript watcher')
      expect(out).toContain('barge-in')
      // The prose either side of the diagram is untouched — an over-eager classifier that ate the
      // paragraph would satisfy every "does not contain" assertion above.
      expect(out).toContain('Here is the shape of the pipeline')
      expect(out).toContain('That diagram carries the whole design')
    }
  },
  {
    stage: 'stripInlineCode',
    fixture: 'code-heavy.md',
    check: (raw, out) => {
      expect(raw).toMatch(/`[^`\n]+`/)
      expect(out).not.toContain('`')
    }
  },
  {
    stage: 'expandMarkdownLinks',
    fixture: 'hostile.md',
    check: (raw, out) => {
      expect(raw).toMatch(/\[[^\]\n]+\]\([^)\n]+\)/)
      expect(out).not.toContain('](')
      expect(out).toContain('the pull request that projects sessionId')
    }
  },
  {
    stage: 'stripUrls',
    fixture: 'hostile.md',
    check: (raw, out) => {
      expect(raw).toMatch(/(?<!\()https?:\/\//)
      expect(out).not.toContain('http')
    }
  },
  {
    stage: 'headingsToPauses',
    fixture: 'architecture.md',
    check: (raw, out) => {
      expect(raw).toMatch(/^#{1,6} \S/m)
      expect(out).not.toMatch(/(^|\s)#{1,6}\s/)
    }
  },
  {
    stage: 'listItemsToSentences',
    fixture: 'architecture.md',
    check: (raw, out) => {
      expect(raw).toMatch(/^\d+\. \S/m)
      expect(raw).toMatch(/^- \S/m)
      expect(out).not.toMatch(/(^|\s)- \S/)
      // The ordinal policy is reachable and audible on this fixture.
      expect(normalize(raw, { orderedLists: 'word' })).not.toBe(normalize(raw, { orderedLists: 'drop' }))
    }
  },
  {
    stage: 'tablesToRows',
    fixture: 'tables.md',
    check: (raw, out) => {
      expect(raw).toMatch(/^\|/m)
      expect(out).not.toContain('|')
    }
  },
  {
    stage: 'speakFilePaths',
    fixture: 'paths.md',
    check: (raw, out) => {
      expect(raw).toContain('packages/core/src/normalizer/index.ts')
      expect(out).not.toContain('packages/core/src/normalizer/index.ts')
      // Every path-shaping option is reachable and changes what is heard.
      expect(normalize(raw, { pathStyle: 'verbatim' })).not.toBe(normalize(raw, { pathStyle: 'spoken' }))
      expect(normalize(raw, { pathStyle: 'terse' })).not.toBe(normalize(raw, { pathStyle: 'spoken' }))
      expect(normalize(raw, { extensionStyle: 'word-first' })).not.toBe(normalize(raw, { extensionStyle: 'word-last' }))
      expect(normalize(raw, { extensionStyle: 'omit' })).not.toBe(normalize(raw, { extensionStyle: 'raw-last' }))
    }
  },
  {
    stage: 'stripMarkdownMarkers',
    fixture: 'code-heavy.md',
    check: (raw, out) => {
      expect(raw).toContain('**')
      expect(out).not.toContain('**')
      // P15: a lone leading underscore is NOT emphasis, and a dunder is not bold.
      expect(out).toContain('_flush_buffer()')
      expect(out).toContain('__init__')
      expect(out).toContain('__dunder__')
    }
  },
  {
    stage: 'speakKeyGlyphs',
    fixture: 'hostile.md',
    check: (raw, out) => {
      expect(raw).toContain('⌘⇧U')
      expect(out).not.toMatch(/[⌘⇧⌥⌃⏎⌫⇥↑↓←→]/)
    }
  },
  {
    stage: 'stripEmoji',
    fixture: 'hostile.md',
    check: (raw, out) => {
      expect(hasEmoji(raw)).toBe(true)
      expect(hasEmoji(out)).toBe(false)
    }
  },
  {
    stage: 'expandUnits',
    fixture: 'short.md',
    check: (raw, out) => {
      expect(raw).toMatch(/\d ms\b/)
      expect(out).not.toMatch(/\bms\b/)
    }
  },
  {
    stage: 'expandNumbers',
    fixture: 'short.md',
    check: (raw, out) => {
      expect(raw).toContain('112')
      expect(out).not.toContain('112')
      expect(normalize(raw, { expandNumbers: false })).not.toBe(normalize(raw, { expandNumbers: true }))
    }
  },
  {
    stage: 'collapseWhitespace',
    fixture: 'short.md',
    check: (raw, out) => {
      // A wrapped clause: only whitespace collapse can rejoin it into one spoken sentence.
      expect(raw).toContain('so\nyou do not wait')
      expect(out).toContain('so you do not wait')
      expect(out).not.toMatch(/[\n\t\r]| {2}/)
    }
  },
  {
    stage: 'tidyPunctuation',
    fixture: 'code-heavy.md',
    check: (raw, out) => {
      // A clause ending in ':' immediately before a fence is what produces the ": ." stutter.
      expect(raw).toMatch(/:\s*\n\s*```/)
      expect(out).not.toContain(' .')
      expect(out).not.toContain(':.')
    }
  }
]

describe('T110 fixture corpus — every fixture survives the pipeline', () => {
  for (const name of FIXTURES) {
    it(`${name} parses and produces non-empty spoken output`, () => {
      const raw = read(name)
      expect(raw.trim().length).toBeGreaterThan(0)
      const out = normalize(raw)
      expect(out.trim().length).toBeGreaterThan(0)
      // Nothing here asserts WHAT is said. Only that something is.
    })
  }
})

describe('T110 fixture corpus — the coverage claim', () => {
  it('names every stage the pipeline actually runs', () => {
    const src = readFileSync(SOURCE, 'utf8')
    const start = src.indexOf('export function normalize(')
    expect(start).toBeGreaterThan(-1)
    const body = src.slice(start, src.indexOf('\n}', start))
    const stages = [...body.matchAll(/\bs = (\w+)\(/g)].map((m) => m[1] as string)
    // A floor, so a guard that quietly stops matching goes red instead of passing vacuously (P33).
    expect(stages.length).toBeGreaterThanOrEqual(17)
    expect([...new Set(stages)].toSorted()).toEqual([...new Set(COVERAGE.map((c) => c.stage))].toSorted())
  })

  for (const c of COVERAGE) {
    it(`${c.stage} is exercised by ${c.fixture}`, () => {
      const raw = read(c.fixture)
      c.check(raw, normalize(raw))
    })
  }
})
