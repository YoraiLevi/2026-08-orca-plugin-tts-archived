/**
 * SC-7 — the stage-identity seam: does the NAME on a ladder row name the transform that row ran?
 *
 * Part of `docs/design/006-fma.md` section 22. Written for round 9 (`018-review-round9.md`), from
 * the finding in `017-review-round8.md` R8-26 and PITFALLS P37.
 *
 * THE GAP THIS CLOSES, stated precisely, because it is narrow and everything around it is already
 * well checked:
 *
 *   `scripts/voice-lab.mjs` holds TWO positional lists. `STAGES[i]` carries the NAME and the
 *   `controlIds` shown to the listener; `apply[i]` inside `computeStages()` carries the CALL.
 *   `assertLoadedModuleIsOnDiskSource()` anchors `apply[]` to behaviour, by running the fixtures
 *   through both it and `normalize()` and demanding byte equality -- a genuine effect check, and
 *   the strongest thing in that file. It says nothing at all about `STAGES[i].name`.
 *
 *   So SWAP TWO NAMES in `STAGES` and: the generated `STAGE_EXPORT` still resolves (both names are
 *   real functions), `apply[]` is untouched so the pipeline output is unchanged, the boot assertion
 *   passes, `pnpm test` is green -- and the listener who focuses a changed word in the ladder is
 *   told the wrong transform did it, and is sent to the wrong knob. In the tool whose entire
 *   purpose is settling taste by ear, that is the failure that matters.
 *
 * HOW THIS TEST AVOIDS BEING THE THING IT CHECKS (P36):
 *
 *   `EXPECTED_PIPELINE` below is authored HERE, independently, by reading `normalize()`'s own call
 *   sequence -- not imported from `STAGES` and not derived from `apply[]`. It is a second copy on
 *   purpose. Two lists that must agree is a check; one list compared with itself is not. The cost
 *   is a real edit in two places when a stage is added, and that cost IS the mechanism: it makes a
 *   change to the ladder the listener sees visible in the diff as a decision.
 *
 *   It is an EFFECT check, not a name check: each entry is a CALLABLE, and the assertion is that
 *   running it reproduces the text `computeStages()` recorded for that row. A name at the wrong
 *   ordinal produces different text, which is what goes red.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { STAGES, computeStages, stageFns } from './voice-lab.mjs'
import { CONTROLS } from '../voice-lab/lib/controls.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, '../fixtures')

/**
 * The pipeline as `normalize()` actually performs it, restated here as (name, callable) pairs in
 * call order, with the DEFAULT options -- because those are the options `computeStages()` uses
 * when none are passed.
 *
 * Read off `packages/core/src/normalizer/index.ts` `normalize()`, once, by hand. If a stage moves,
 * this list is one of the places that must move with it, and that is deliberate.
 */
function expectedPipeline (fn) {
  return [
    ['stripFencedCode', (s) => fn.stripFencedCode(s, 'announce')],
    ['stripHtmlComments', (s) => fn.stripHtmlComments(s)],
    ['stripInlineCode', (s) => fn.stripInlineCode(s)],
    ['expandMarkdownLinks', (s) => fn.expandMarkdownLinks(s)],
    ['stripUrls', (s) => fn.stripUrls(s)],
    ['headingsToPauses', (s) => fn.headingsToPauses(s)],
    ['listItemsToSentences', (s) => fn.listItemsToSentences(s, 'numeral')],
    ['tablesToRows', (s) => fn.tablesToRows(s)],
    ['speakFilePaths', (s) => fn.speakFilePaths(s, 'spoken', 'word-last')],
    ['stripMarkdownMarkers', (s) => fn.stripMarkdownMarkers(s)],
    ['speakKeyGlyphs', (s) => fn.speakKeyGlyphs(s)],
    ['stripEmoji', (s) => fn.stripEmoji(s)],
    ['expandUnits', (s) => fn.expandUnits(s)],
    ['expandNumbers', (s) => fn.expandNumbers(s)],
    ['collapseWhitespace', (s) => fn.collapseWhitespace(s)],
    ['tidyPunctuation', (s) => fn.tidyPunctuation(s)]
  ]
}

/**
 * Probes with enough variety that EVERY stage changes the text on at least one of them -- checked
 * by the "no stage is inert" test below, which is what stops this file from passing vacuously.
 */
function probes () {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.md')).toSorted()
  const out = files.map((f) => [`fixtures/${f}`, readFileSync(join(FIXTURES, f), 'utf8')])
  out.push(['(inline probe)', [
    '# Heading',
    '',
    '<!-- a comment -->',
    '',
    '1. `x` at packages/core/src/normalizer/index.ts, 52 ms, **bold**, ⌘S, ✅',
    '',
    '| a | b |',
    '| - | - |',
    '| 1 | 2 |',
    '',
    'See [the PR](https://github.com/stablyai/orca/pull/15640) and https://example.com .',
    '',
    '```',
    'code',
    '```'
  ].join('\n')])
  return out
}

describe('SC-7 — every ladder row names the transform that row actually ran', () => {
  it('reproduces each stage output from an independently-authored name-to-callable map', async () => {
    const fn = await stageFns()
    const expected = expectedPipeline(fn)
    expect(expected).toHaveLength(STAGES.length)

    for (const [label, md] of probes()) {
      const { stages } = await computeStages(md)
      let text = md
      for (let i = 0; i < expected.length; i++) {
        const [name, apply] = expected[i]
        expect(STAGES[i].name, `stage ${i + 1} name, on ${label}`).toBe(name)
        text = apply(text)
        expect(text, `stage ${i + 1} (${name}) output, on ${label}`).toBe(stages[i].text)
      }
    }
  })

  /**
   * The guard against passing vacuously. If a stage never changes any probe, then swapping its
   * name with another inert stage would NOT go red, and the row above would be decoration for it.
   * This names which stages are covered by effect and fails if the probe set stops covering one.
   */
  it('every stage actually changes at least one probe, so no row is checked vacuously', async () => {
    const moved = new Set()
    for (const [, md] of probes()) {
      const { stages } = await computeStages(md)
      let before = md
      for (const s of stages) {
        if (s.text !== before) moved.add(s.name)
        before = s.text
      }
    }
    const inert = STAGES.map((s) => s.name).filter((n) => !moved.has(n))
    expect(inert, 'stages no probe exercises').toEqual([])
  })
})

/* ================================================================== SC-8
 * seam: the Voice Lab control map -> the normalizer stage a control claims to govern
 */

/**
 * A non-default value for each control that is genuinely WIRED to a `NormalizeOptions` field.
 *
 * Restated here rather than derived from the control's own `values` array, for the P36 reason: a
 * test that asked the control what its other value is would be asking the thing under test.
 */
const ALTERNATE = {
  'NormalizeOptions.codeBlocks': 'drop',
  'NormalizeOptions.pathStyle': 'verbatim',
  'NormalizeOptions.extensionStyle': 'omit',
  'NormalizeOptions.orderedLists': 'word',
  'NormalizeOptions.expandNumbers': false
}

/** A probe that exercises every wired option at once: a fence, a path, a list and a number. */
const WIRED_PROBE = [
  '```',
  'code',
  '```',
  '',
  '1. the file packages/core/src/normalizer/index.ts took 52 ms'
].join('\n')

describe('SC-8 — a control changes the stage it says it changes, and not a different one', () => {
  const wired = CONTROLS.filter((c) => typeof c.wire === 'string' && c.wire.startsWith('NormalizeOptions.'))

  it('covers every NormalizeOptions field that any control claims', () => {
    // Guards against the suite passing because the wired set silently emptied.
    expect(wired.length).toBeGreaterThanOrEqual(5)
    for (const c of wired) expect(ALTERNATE, c.id).toHaveProperty(c.wire)
  })

  /**
   * Controls whose seam contract is VIOLATED today. Marked, not deleted: each is green here
   * BECAUSE it fails, and turns red the moment the defect is fixed -- at which point the entry
   * comes off this list. See the `it.fails` rationale in seam-contracts.test.ts.
   *
   * `num.expandIntegers` -- 006 NM12, rediscovered here as a CONTROL-MAP defect rather than an
   * option-shape one. `normalize()` gates both `expandUnits` and `expandNumbers` behind the single
   * `expandNumbers` flag (`if (doNumbers) { s = expandUnits(s); s = expandNumbers(s) }`), so a
   * listener who turns off "whether numbers become words" -- a stage-14 control by its own
   * declaration -- silently also turns off stage 13 and re-breaks "52 ms", which is the exact
   * defect they asked to have fixed. The Lab would show them a stage-13 row that changed for a
   * reason no control on screen explains.
   */
  const OPEN = new Set(['num.expandIntegers'])

  for (const c of wired) {
    /**
     * The assertion is on the FIRST stage whose text moves. Everything after it moves too, because
     * a pipeline is a pipeline -- so "the first stage that differs" is the only position that
     * carries information about WHICH transform the option reached.
     */
    const test = OPEN.has(c.id) ? it.fails : it
    test(`${c.id} first moves a stage it claims (${c.wire})${OPEN.has(c.id) ? ' [OPEN: 006 NM12]' : ''}`, async () => {
      const key = c.wire.slice('NormalizeOptions.'.length)
      const base = await computeStages(WIRED_PROBE)
      const alt = await computeStages(WIRED_PROBE, { [key]: ALTERNATE[c.wire] })
      const firstMoved = base.stages.findIndex((s, i) => s.text !== alt.stages[i].text)
      expect(firstMoved, `${c.id}: the option changed nothing at all`).toBeGreaterThanOrEqual(0)
      expect(c.stages, `${c.id} claims stages ${JSON.stringify(c.stages)}, but the option first moved stage ${firstMoved + 1} (${STAGES[firstMoved].name})`)
        .toContain(firstMoved + 1)
    })
  }
})
