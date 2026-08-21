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
import { spawnSync } from 'node:child_process'
import { stripTypeScriptTypes } from 'node:module'

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
  'NormalizeOptions.expandNumbers': false,
  'NormalizeOptions.expandUnits': false
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
    expect(wired.length).toBeGreaterThanOrEqual(6)
    for (const c of wired) expect(ALTERNATE, c.id).toHaveProperty(c.wire)
  })

  /**
   * Controls whose seam contract is VIOLATED today. Marked, not deleted: each is green here
   * BECAUSE it fails, and turns red the moment the defect is fixed -- at which point the entry
   * comes off this list. See the `it.fails` rationale in seam-contracts.test.ts.
   *
   * EMPTY since J26. What used to be here:
   *
   *   `num.expandIntegers` -- 006 NM12, rediscovered here as a CONTROL-MAP defect rather than an
   *   option-shape one. `normalize()` gated both `expandUnits` and `expandNumbers` behind the
   *   single `expandNumbers` flag (`if (doNumbers) { s = expandUnits(s); s = expandNumbers(s) }`),
   *   so a listener who turned off "whether numbers become words" -- a stage-14 control by its own
   *   declaration -- silently also turned off stage 13 and re-broke "52 ms", which is the exact
   *   defect they had asked to have fixed. The Lab would show them a stage-13 row that changed for
   *   a reason no control on screen explained.
   *
   * The fix was to SPLIT the flag, not to widen the claim: `NormalizeOptions.expandUnits` now
   * exists and `normalize.expandUnits` owns it, so each control governs exactly the stage it
   * names. Re-pointing `num.expandIntegers` at stages [13, 14] would also have turned this row
   * green and would have been the wrong answer -- it makes the control map agree with a defect
   * instead of describing a fixed one, and the listener would still have no way to keep unit words
   * while leaving numerals alone. (P37's family: the temptation is to renumber; the fix is to make
   * the thing the number names actually exist.)
   */
  const OPEN = new Set([])

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

/* ================================================================== SC-13
 * seam: the normalizer SOURCE -> `stageFns()`'s data-URL compile step
 */

/**
 * SC-13 — the normalizer's "DEPENDENCY-FREE" property is load-bearing, and nothing enforced it.
 *
 * `packages/core/src/normalizer/index.ts` opens with:
 *
 *   "Pure, synchronous, and DEPENDENCY-FREE -- this module imports nothing, not even `node:`
 *    builtins, so it runs identically in a plugin worker, a panel, a service, and a test."
 *
 * That is not documentation. `stageFns()` (`scripts/voice-lab.mjs`) compiles this file's SOURCE
 * into a `data:text/javascript;base64,...` module so it can export the private stage functions --
 * and **a relative specifier cannot be resolved from a data: URL**. Proved by effect, with a
 * control that passes:
 *
 *   import(data: + b64("import { x } from '../speakable.js'\nexport const y = 1"))
 *     -> Failed to resolve module specifier "../speakable.js"
 *   import(data: + b64("export const y = 1"))
 *     -> CONTROL OK, y = 1
 *
 * So one relative import anywhere in that file makes `assertLoadedModuleIsOnDiskSource()` throw at
 * boot and the Voice Lab REFUSE TO START on every fixture -- P37's failure mode arriving through a
 * different door, and it happened for real during round 10 (019 R10-05).
 *
 * A hard technical contract between two components, carried in a prose comment, with no
 * instrument. `006` section 22's shape exactly.
 *
 * **Deliberately NOT marked `it.fails`, unlike section 22's other open rows.** Those describe
 * defects a listener might one day hit; this one means the tuning instrument does not launch. A row
 * that should block is left able to block.
 */
describe('SC-13 — the normalizer source still compiles the way the Voice Lab compiles it', () => {
  const NORMALIZER = join(HERE, '../packages/core/src/normalizer/index.ts')

  it('carries no relative or bare import, because a data: URL cannot resolve one', () => {
    const src = readFileSync(NORMALIZER, 'utf8')
    const imports = [...src.matchAll(/^\s*import\s[^\n]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
    expect(imports, `normalize() imports ${JSON.stringify(imports)} — see 019 R10-05. ` +
      'Either inline the helper, or teach stageFns() to rewrite specifiers to absolute file:// URLs ' +
      'AND rewrite the "DEPENDENCY-FREE" sentence at the top of the file.').toEqual([])
  })

  it('VERIFY BY EFFECT: the compiled module actually loads, with a control that proves the probe works', async () => {
    const js = stripTypeScriptTypes(readFileSync(NORMALIZER, 'utf8'), { mode: 'strip' })
    const load = (code) => import('data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64'))

    // The control FIRST: if a relative import somehow resolved here, this probe would be measuring
    // nothing and its verdict on the real file would be worthless.
    await expect(load("import { x } from '../nowhere.js'\nexport const y = 1"))
      .rejects.toThrow(/resolve module specifier/)

    await expect(load(js + '\nexport const __probe = 1'), 'the Voice Lab cannot boot: ' +
      'the normalizer source no longer compiles as a standalone module (019 R10-05)').resolves.toBeTruthy()
  })
})

/* ================================================================== SC-14
 * seam: the modules the Voice Lab imports -> the RESOLVER THAT ACTUALLY SHIPS
 */

/**
 * SC-14 — SC-13's sibling. Two resolvers, one of which is the only one that ships.
 *
 * SC-13 covers the `data:` URL compile path. This covers the ordinary one: `scripts/voice-lab.mjs`
 * is run by **plain node** (`pnpm voice-lab` -> `node scripts/voice-lab.mjs`), and plain node's
 * ESM resolver **will not resolve a `.js` specifier onto a `.ts` file**. Vitest's resolver will.
 *
 * So the suite and the product disagree about whether the code loads, and the suite is the one that
 * is wrong. Measured `[measured-here]`, with a control that passes:
 *
 *   node --experimental-strip-types -e "import('packages/core/src/chunker/index.ts')"
 *      -> ERR_MODULE_NOT_FOUND: Cannot find module '.../packages/core/src/speakable.js'
 *   node --experimental-strip-types -e "import('packages/core/src/normalizer/index.ts')"
 *      -> CONTROL: loads (same directory, no such specifier)
 *   vitest run packages/core/src/chunker
 *      -> 21 passed
 *
 * **21 tests green while `pnpm voice-lab` cannot start at all.** The suite is structurally blind to
 * a total outage of the tuning instrument, because it never once loads the code the way the product
 * loads it. That is `006` section 22's thesis in its purest form: two components, two predicates for
 * "does this module resolve", each correct for its own component, never compared.
 *
 * **Deliberately NOT marked `it.fails`, for SC-13's reason.** Section 22's other open rows describe
 * defects a listener might one day hit. This one means the Voice Lab does not launch. A row that
 * should block is left able to block, and it turns green by itself the moment the specifier is
 * fixed -- `speakable.ts` already imports fine under plain node when named directly.
 */
describe('SC-14 — every module the Lab loads, loads under the resolver that ships', () => {
  const REPO = join(HERE, '..')

  /** Import a module in a FRESH plain-node process. Vitest's resolver is deliberately not used. */
  function loadsUnderPlainNode (relPath) {
    const r = spawnSync(process.execPath,
      ['--experimental-strip-types', '-e',
       `import(${JSON.stringify(join(REPO, relPath))}).then(() => process.exit(0), (e) => { process.stderr.write(String(e.message)); process.exit(1) })`],
      { cwd: REPO, encoding: 'utf8' })
    return { ok: r.status === 0, why: (r.stderr || '').split('\n')[0] }
  }

  /**
   * The control runs FIRST and must PASS. If plain node could not load any of these files, this
   * probe would be measuring its own harness and its verdict on the real ones would be worthless.
   */
  it('CONTROL: a module with no cross-directory specifier loads under plain node', () => {
    const r = loadsUnderPlainNode('packages/core/src/normalizer/index.ts')
    expect(r.ok, `the probe itself is broken, not the module: ${r.why}`).toBe(true)
  })

  it('CONTROL: the negative case is detectable — a missing module really does fail', () => {
    const r = loadsUnderPlainNode('packages/core/src/does-not-exist.ts')
    expect(r.ok, 'the probe reports success for a module that does not exist').toBe(false)
  })

  /**
   * RESTATED HERE, not imported from `voice-lab.mjs` (P36): a list read out of the file under test
   * cannot go red when that file changes. `packages/core/src/index.ts` is NOT one of the Lab's own
   * imports -- it is the workspace barrel, kept in this list because R10-06's measurement was taken
   * on it and because every consumer of `@orca-tts/core` reaches it. Widened, never narrowed.
   */
  const LAB_MODULES = [
    'packages/core/src/normalizer/index.ts',
    'packages/core/src/chunker/index.ts',
    'packages/providers/src/os-synth/index.ts',
    'packages/core/src/index.ts'
  ]

  /**
   * THE COVERAGE FLOOR. The list above is a hand-written claim about what the Lab loads, and a
   * hand-written claim goes stale the moment somebody adds a fourth `await import()` to
   * `voice-lab.mjs`. Then every row above passes and the new module is unchecked -- the row's own
   * words ("EVERY module the Lab loads") quietly stop being true, with nothing red.
   *
   * This does NOT source the expectations from `voice-lab.mjs`; it only refuses to let the
   * independent list be a SUBSET of what the Lab really imports. Same shape as
   * `budget-claims.test.ts`'s `claimsSeen >= 9` (P33): a guard that has quietly stopped matching is
   * the same failure wearing the uniform of the fix.
   *
   * It was measured, when written, that this really did catch something:
   * `packages/providers/src/os-synth/index.ts` is loaded by the Lab at boot and was absent from the
   * row as committed.
   */
  it('the restated list covers every source module scripts/voice-lab.mjs imports', () => {
    const lab = readFileSync(join(REPO, 'scripts/voice-lab.mjs'), 'utf8')
    const imported = [...lab.matchAll(/join\(REPO_ROOT,\s*'(packages\/[^']+\.ts)'\)/g)].map((m) => m[1])
    expect(imported.length, 'no source imports were found in voice-lab.mjs; this guard has ' +
      'stopped matching and can no longer detect an uncovered module').toBeGreaterThanOrEqual(3)
    const uncovered = imported.filter((m) => !LAB_MODULES.includes(m))
    expect(uncovered, 'the Lab imports these and SC-14 never loads them under the shipping ' +
      'resolver, so the row no longer means what it says').toEqual([])
  })

  for (const mod of LAB_MODULES) {
    it(`${mod} loads under plain node, which is how pnpm voice-lab runs`, () => {
      const r = loadsUnderPlainNode(mod)
      expect(r.ok, `${mod} does not load under plain node: ${r.why}\n` +
        'Vitest resolves .js -> .ts; plain node does not, and plain node is what ships. ' +
        'See 019 R10-06. Name the specifier .ts, or drop the cross-directory import.').toBe(true)
    })
  }
})
