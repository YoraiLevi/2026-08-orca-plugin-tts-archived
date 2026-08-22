/**
 * SEAM CONTRACTS — the executable half of `docs/design/006-fma.md` section 22.
 *
 * WHY THIS FILE EXISTS, stated so it is not mistaken for more unit tests.
 *
 * `006` sections 1-14 are organised one per COMPONENT, and section 15's cascades are all about
 * TIMING — the same data arriving in the wrong order. Between them they enumerate 130 failure
 * modes and missed three live defects, every one of which lived at a SEAM: two modules each owning
 * a predicate for the same concept, each predicate correct for its own module's job, and nothing
 * anywhere comparing the two (`docs/design/017-review-round8.md` section 1).
 *
 * A per-component test suite cannot catch that class, because both sides pass their own tests.
 * These tests therefore never assert what one function returns. Each one takes the REAL OUTPUT of
 * the upstream component and asserts a property the DOWNSTREAM component requires.
 *
 * TWO RULES THIS FILE FOLLOWS, both learned the hard way in this repo:
 *
 *  1. **The downstream requirement is RESTATED here, never imported** (P36, P33). A seam test that
 *     imported the provider's own guard would compare that guard against itself and could not
 *     fail. `SPEAKABLE` and `providerWouldSpeak` below are independent
 *     claims about what the far side needs, written from its documented behaviour and, where the
 *     behaviour was measured, from the measurement.
 *
 *  2. **A contract that is currently VIOLATED is marked `it.fails`, not deleted or softened.** Such
 *     a row is green today *because* the contract is broken, and turns RED the moment someone fixes
 *     it — at which point the marker comes off. That keeps a known-open seam defect visible in
 *     every suite run instead of living only in a document. Each one names its finding id.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { normalize } from '../normalizer/index.ts'
import { Chunker, type Chunk } from '../chunker/index.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, '../../../../fixtures')

/* ---------------------------------------------------------------- the corpus
 *
 * Real committed files plus hostile strings. The fixtures matter because every defect round 8
 * found came from pointing the pipeline at files that were already in the repo; the hostile
 * strings matter because a fixture corpus only contains inputs somebody thought of.
 */

function fixtureCorpus (): Array<[string, string]> {
  return readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.md'))
    .toSorted()
    .map((f) => [`fixtures/${f}`, readFileSync(join(FIXTURES, f), 'utf8')] as [string, string])
}

/** Inputs chosen to attack a SEAM rather than a stage. Each names what it is aimed at. */
const HOSTILE: Array<[string, string]> = [
  ['html comment', '<!-- hidden note -->\n\nReal answer here.'],
  ['shebang', '#!/usr/bin/env node\n\nRun it.'],
  ['markdown image', '![alt text](https://example.com/i.png)\n\nAfter.'],
  ['punctuation only', '...!!!???'],
  ['emoji only', '\u{1f389}\u{1f389}'],
  ['single verdict glyph', '✅'],
  ['whitespace only', '   \n\t  '],
  ['horizontal rule first', '---\n\n# Heading\n\nBody text here.'],
  ['horizontal rule mid', 'Before the rule.\n\n---\n\nAfter the rule.'],
  ['setext heading', 'Title\n=====\n\nBody.'],
  ['negative measurement', 'The delta was -42 ms on that run.'],
  ['bare em dash clause', 'One. — an aside. Two.'],
  ['nested fence', '````\n```\ncode\n```\n````\n\nAfter.'],
  ['unclosed fence', 'Before.\n\n```\ncode that never closes'],
  ['table only', '| a | b |\n| - | - |\n| 1 | 2 |'],
  ['long unbroken run', 'x'.repeat(300)],
  ['blockquote only', '> quoted line\n> more'],
  ['task list', '- [ ] not done\n- [x] done'],
  ['raw html', '<div class="x">text</div>'],
  ['html entities', 'a &amp; b &lt;c&gt; done.'],
  ['empty', ''],
  ['one space', ' ']
]

function corpus (): Array<[string, string]> {
  return [...fixtureCorpus(), ...HOSTILE]
}

function chunksOf (spoken: string): Chunk[] {
  const c = new Chunker({})
  return [...c.addText(spoken), ...c.finish()]
}

/* ------------------------------------------------- the downstream requirements, RESTATED
 *
 * Everything below is an independent claim about what the far side of a seam needs. None of it
 * imports the far side. If one of these drifts from reality the seam test is wrong — which is a
 * visible, arguable kind of wrong, unlike a test that quietly agrees with the code it checks.
 */

/**
 * A glyph a synthesizer can turn into sound. Letters and digits, in any script.
 *
 * Restated rather than imported because THREE components hold a different version of this idea and
 * none of them holds this one: `normalize()` ends with a LENGTH test (`s.length <= 1`),
 * `OsSynthProvider.generate()` opens with a WHITESPACE test (`text.trim().length === 0`), and the
 * `Chunker` never asks at all. Measured consequence of the disagreement: `say -o out.wav "<!"`
 * exits 0 and writes 4,332 bytes -- 97 ms of near-silence -- for p50 747 ms of provider time
 * `[measured-here]`, n=6, `docs/design/017-review-round8.md` R8-09.
 */
const SPEAKABLE = /[\p{L}\p{N}]/u

/** Would a synthesizer produce anything a listener could hear from this string? */
function providerWouldSpeak (text: string): boolean {
  return SPEAKABLE.test(text)
}


/* ================================================================== SC-1
 * seam: normalize() -> Chunker
 */
describe('SC-1 — normalize() emits either nothing, or something with a speakable glyph in it', () => {
  /**
   * CLOSED by J26. It used to be that `normalize("...!!!???")` returned ".!!!???" -- length 7, so
   * the `s.length <= 1` guard passed it -- and `SpeechService` checks `spoken.length === 0`, so
   * the `'empty'` outcome never fired, so the `unspeakable` loss sentence was never spoken. The
   * listener was told nothing and heard nothing.
   *
   * The length test is now a speakability test. `providerWouldSpeak` above is still an INDEPENDENT
   * restatement and is deliberately not imported from `packages/core/src/speakable.ts`, which is
   * where the shipping predicate now lives -- importing it would compare the guard against itself
   * (P36) and this test could never fail again.
   *
   * [CLOSED: 017 R8-07 -- seen red before the marker came off]
   */
  it('holds for every corpus input [was OPEN: R8-07]', () => {
    for (const [name, src] of corpus()) {
      const spoken = normalize(src, {})
      if (spoken.length === 0) continue
      expect(providerWouldSpeak(spoken), `${name}: ${JSON.stringify(spoken.slice(0, 40))}`).toBe(true)
    }
  })

  it('holds for the six committed fixtures', () => {
    for (const [name, src] of fixtureCorpus()) {
      const spoken = normalize(src, {})
      expect(spoken.length, name).toBeGreaterThan(0)
      expect(providerWouldSpeak(spoken), name).toBe(true)
    }
  })
})

/* ================================================================== SC-2
 * seam: Chunker -> TtsProvider.generate()
 */
describe('SC-2 — every chunk the Chunker mints carries a speakable glyph', () => {
  /**
   * CLOSED by J26. `#isSentenceEnd` returned true unconditionally for '!' and '?'
   * ("'!' and '?' are never abbreviations"), which is true as written and wrong as a sentence
   * rule: '.' gets six context tests and '!' got none. So `#!/usr/bin/env node` yielded a first
   * chunk of "#!" and `![alt](url)` yielded "!". Both cost a full synthesis round trip and return
   * near-silence, and both land on chunk 0 -- the one `isolateFirstSentence` exists to make fast.
   *
   * The fix is a property of the CHUNK, not of the punctuation mark: a cut that would mint a
   * chunk with no speakable glyph is not taken, so the fragment travels with the text after it.
   *
   * KNOWN RESIDUE, named rather than hidden: the `scalar` fallback, which fires only when a single
   * token overruns `maxUnits` with no boundary anywhere, is exempt -- it guarantees forward
   * progress and refusing it would hang the chunker. A 200-character wall of '!' still reaches the
   * provider. No corpus input produces one; `OsSynthEmptyOutputError` (006 site 43) is where that
   * case is named.
   *
   * [CLOSED: 017 R8-08 -- seen red before the marker came off]
   */
  it('holds for every corpus input [was OPEN: R8-08]', () => {
    for (const [name, src] of corpus()) {
      const spoken = normalize(src, {})
      if (spoken.length === 0) continue
      for (const [i, chunk] of chunksOf(spoken).entries()) {
        expect(providerWouldSpeak(chunk.text), `${name} chunk ${i}: ${JSON.stringify(chunk.text.slice(0, 40))}`).toBe(true)
      }
    }
  })

  it('holds for the six committed fixtures', () => {
    for (const [name, src] of fixtureCorpus()) {
      for (const [i, chunk] of chunksOf(normalize(src, {})).entries()) {
        expect(providerWouldSpeak(chunk.text), `${name} chunk ${i}`).toBe(true)
      }
    }
  })
})

/* ================================================================== SC-3
 *
 * MOVED AND REWRITTEN in round 10 -> `packages/providers/src/seams/argv-seam.test.ts`.
 *
 * The row that stood here asserted `argvIsSafeForBareExec(chunk.text)` -- a property of the CHUNK --
 * and it was wrong. Chunk text will never be safe for a bare exec: an agent reply may legitimately
 * open with a markdown horizontal rule and `normalize()` is right to keep it, so NOTHING THE CHUNKER
 * COULD EVER DO would make that assertion pass. Once J24 fixed the real defect with the POSIX `--`
 * separator, the row sat `it.fails`-green forever: an indicator that cannot go red for the thing it
 * was built to detect, which is P32's shape inside the instrument rather than inside the code.
 *
 * The contract belongs to the ARGUMENT VECTOR THE PROVIDER BUILDS, not to the text it was handed,
 * and it lives with the builders. See `019-review-round10.md` R10-07.
 */

/* ================================================================== SC-4
 * seam: normalize() -> Chunker, token conservation ACROSS the seam
 */
describe('SC-4 — the chunker conserves normalize() output exactly', () => {
  /**
   * The chunker's own header states `chunks.join('') === input`, and `chunker.test.ts` checks it
   * against hand-written strings. This checks it against what the normalizer ACTUALLY produces --
   * text containing the placeholder sentences, the "in folder" phrases and the expanded numerals
   * that no hand-written chunker test contains.
   *
   * GREEN today, and proved able to fail: see `docs/design/018-review-round9.md` mutation M1.
   */
  it('joins back to the exact string it was given', () => {
    for (const [name, src] of corpus()) {
      const spoken = normalize(src, {})
      expect(chunksOf(spoken).map((c) => c.text).join(''), name).toBe(spoken)
    }
  })

  it('marks exactly one chunk as first, whenever there is any chunk at all', () => {
    for (const [name, src] of corpus()) {
      const spoken = normalize(src, {})
      const chunks = chunksOf(spoken)
      if (chunks.length === 0) continue
      expect(chunks.filter((c) => c.isFirst).length, name).toBe(1)
      expect(chunks[0]?.isFirst, name).toBe(true)
    }
  })
})

/* ================================================================== SC-5
 * seam: normalize() -> Chunker, incremental vs batch
 */
describe('SC-5 — streaming and batch agree on real normalizer output', () => {
  /**
   * Huddle mode feeds the chunker as the agent types; the hotkey feeds it all at once. The chunker
   * documents that these must produce identical results (T035), and its own tests check it on
   * hand-written strings. This checks it across the seam, one character at a time, on the text the
   * normalizer really emits -- which is where the placeholder sentences and expanded numerals live.
   *
   * GREEN today, and proved able to fail: see `018` mutation M2.
   */
  it('one character at a time equals all at once', () => {
    for (const [name, src] of corpus()) {
      const spoken = normalize(src, {})
      if (spoken.length === 0) continue
      const batch = chunksOf(spoken).map((c) => c.text)
      const stream = new Chunker({})
      const incremental: string[] = []
      for (const ch of spoken) incremental.push(...stream.addText(ch).map((c) => c.text))
      incremental.push(...stream.finish().map((c) => c.text))
      expect(incremental, name).toEqual(batch)
    }
  })
})

/* ================================================================== SC-6
 * seam: normalize() -> Chunker -> the listener, for MEASURED NUMBERS
 */
describe('SC-6 — a number written in this repo survives to the listener as the same number', () => {
  /**
   * Not a stage test. The question is what a listener HEARS for the numbers this project writes
   * down, after every stage has had its turn -- and `expandUnits` then `expandNumbers` run as a
   * pair, so a defect in either only shows up at the far end.
   *
   * The expectations are restated independently (P36): each row says what the sentence must
   * contain, not what any table maps it to.
   *
   * GREEN today for the thousands separator -- J21 fixed it during round 8 -- and the OPEN rows
   * below are marked as such.
   */
  const MUST_CONTAIN: Array<[string, string]> = [
    ['It took 1,112 ms.', 'one thousand one hundred twelve milliseconds'],
    ['It took 52 ms.', 'fifty two milliseconds'],
    ['Up 50% today.', 'fifty percent'],
    ['Cost 2,017 units.', 'two thousand seventeen'],
    ['At 09:30 sharp.', 'nine thirty']
  ]

  it('speaks each measured number as its own words', () => {
    for (const [src, expected] of MUST_CONTAIN) {
      expect(normalize(src, {}), src).toContain(expected)
    }
  })

  /**
   * CLOSED by J26. `Number("007")` is 7, so the leading zeros used to be dropped with no
   * announcement: the listener heard a DIFFERENT number than was written, and had no way to know.
   * This is the property `token-conservation.test.ts` exists to defend, in a form it does not test.
   *
   * A leading zero now means "identifier, not quantity" and the digits are spoken one by one.
   *
   * [CLOSED: 017 R8-20 -- seen red before the marker came off]
   */
  it('preserves leading zeros [was OPEN: R8-20]', () => {
    expect(normalize('Call 007 now.', {})).toContain('zero zero seven')
    // The clock is NOT an identifier and must not have been swept up: 09:30 is a time.
    expect(normalize('At 09:30 sharp.', {}), '09:30 is a clock, not a padded code')
      .toContain('nine thirty')
    // CONTROL: a number with no leading zero still becomes one word, not seven digits.
    expect(normalize('It saw 1234 rows.', {})).toContain('one thousand two hundred thirty four')
  })

  /**
   * CLOSED by J26. The minus sign used to reach the engine as a bare hyphen, which is rendered as
   * nothing or as a pause -- so a regression of -42 ms and an improvement of 42 ms became the same
   * sentence, in a project whose entire subject is measured deltas.
   *
   * [CLOSED: 017 R8-21 -- seen red before the marker came off]
   */
  it('speaks the sign of a negative measurement [was OPEN: R8-21]', () => {
    expect(normalize('The delta was -42 ms.', {})).toContain('minus forty two')
  })

  /**
   * The other half of the sign fix, and the half that could quietly make things WORSE: a hyphen
   * that is not a minus must not be spoken as one. Restated as the strings this repo really
   * writes, because a rule that says "minus" in the middle of `sherpa-onnx-node` or `UTF-8` would
   * be a new defect wearing the fix's uniform.
   */
  it('does not hear a minus in a hyphen that is not one', () => {
    for (const [src, forbidden] of [
      ['We support UTF-8 here.', 'minus'],
      ['It ran 10-20 times.', 'minus'],
      ['The p50-p99 spread.', 'minus'],
      ['Use sherpa-onnx-node 1.9.', 'minus']
    ] as Array<[string, string]>) {
      expect(normalize(src, {}), src).not.toContain(forbidden)
    }
  })
})

/* ================================================================== SC-10
 * seam: normalize() -> the ENGINE'S OWN number reader
 *
 * Added after the round-9 build, on evidence from the team lead: the million ceiling is not a
 * normalizer decision, it is a SEAM decision, and it is this section's exact shape -- an upstream
 * component emitting something whose acceptability depends on a downstream it cannot see.
 *
 * `expandNumbers` expands 0..999,999 to words and, at or above 1,000,000, hands the raw numeral to
 * the engine on the belief that "the engine handles them better". Below the ceiling WE decide what
 * the listener hears. At or above it, THE ENGINE decides -- and which engine that is depends on the
 * platform, which core cannot know.
 *
 * WHAT IS AND IS NOT CHECKABLE FROM HERE, stated so the split is not mistaken for a gap:
 *
 *   - **Core half (this file).** That the ceiling is where it is claimed to be, that it is the ONLY
 *     discontinuity, and that a numeral above it crosses the seam BYTE-FOR-BYTE -- because if the
 *     normalizer mangles it on the way past, the engine never gets the chance to read it well.
 *   - **Platform half (not this file).** Whether an engine reads `1234567` as a quantity or spells
 *     seven digits. That needs the engine, so it belongs in CI on each OS:
 *     `scripts/ci/number-ceiling-probe.mjs`, which renders to files only (P31) and carries a
 *     control that must differ so it cannot pass vacuously.
 *
 * **THE PLATFORM HALF WAS ANSWERED, 2026-08-22, AND IT MOVED THE CEILING.** This row named the
 * split and pointed at CI to settle it; CI settled it. `say` reads `1234567` as a number and so
 * does espeak-ng — but **SAPI spells the digits**: 139,800 B, Δ76,716 from the spelled-out
 * reference, run 32552614490 `[measured-here]` with the probe's own controls green.
 *
 * So "the engine handles them better" was true of two engines out of three, and the belief this
 * ceiling rested on is retired. **The ceiling is now 1,000,000,000**, above which handing over is
 * a judgement about LISTENABILITY — "nine hundred eighty seven billion, six hundred…" is worse
 * than digits — rather than a claim about engines. The boundaries below moved with it.
 */
describe('SC-10 — the million ceiling is a seam decision, and the numeral must cross it intact', () => {
  const CEILING = 1_000_000_000

  it('expands every value below the ceiling, and hands the engine the numeral at or above it', () => {
    // Restated boundaries, not derived from the constant in the code under test (P36).
    expect(normalize('It saw 999999 rows.', {})).toContain('nine hundred ninety nine thousand')
    // Was asserted to stay raw. SAPI proved that unsafe, so these are spoken now.
    expect(normalize('It saw 1000000 rows.', {})).toContain('one million')
    expect(normalize('It saw 1234567 rows.', {})).toContain('one million two hundred thirty four')
    // The new discontinuity, and it is still the ONLY one.
    expect(normalize('It saw 1000000000 rows.', {})).toContain('1000000000')
  })

  /**
   * TOKEN CONSERVATION ACROSS THE SEAM. Above the ceiling the whole argument for handing the
   * numeral over is that the engine is the better reader -- which is only true if the numeral
   * arrives as it was written. A digit dropped, a separator left in, or a stray space inserted on
   * the way past turns "let the engine read it" into "let the engine read something else".
   */
  it('passes an above-ceiling numeral to the engine byte for byte', () => {
    // Values above the NEW ceiling. `1000000` and `1234567` used to belong here and are now
    // spoken, which is the point of raising it — the conservation claim only applies to numerals
    // we still hand over.
    for (const digits of ['1000000000', '1234567890', '9007199254740991', '1000000001']) {
      const spoken = normalize(`The count was ${digits} exactly.`, {})
      expect(spoken, digits).toContain(`was ${digits} exactly`)
    }
  })

  it('has exactly one discontinuity, so nothing below the ceiling escapes as digits', () => {
    for (const n of [0, 1, 19, 20, 99, 100, 999, 1000, 12345, 99999, CEILING - 1]) {
      const spoken = normalize(`n is ${n}.`, {})
      expect(spoken, `${n} should have become words`).not.toContain(`is ${n}.`)
    }
  })

  /**
   * CLOSED 2026-08-22 (017 R8-22). Two numbers in ONE sentence, one either side of the old
   * ceiling, were read in two different systems in the same breath — one spelled out by us, one
   * handed over as digits. The audible inconsistency inside a single sentence is what a listener
   * actually notices, and nothing announced it.
   *
   * It closed as a SIDE EFFECT of raising the ceiling for SAPI, not by being worked on: with the
   * boundary at a billion, both numbers in the motivating sentence are now spoken. The `.fails`
   * marker went red the moment that landed, which is exactly what the convention is for — an open
   * contract that is green because it is broken, and turns red when someone fixes it.
   *
   * The row stays, without the marker: the inconsistency is still POSSIBLE either side of the new
   * boundary, and this is what would catch it.
   */
  it('reads two numbers in one sentence in one system', () => {
    const spoken = normalize('We processed 1234567 rows and 999999 more.', {})
    const spelledOut = /nine hundred ninety nine thousand/.test(spoken)
    const handedOver = /1234567/.test(spoken)
    expect(spelledOut && handedOver, `both systems in one sentence: ${JSON.stringify(spoken)}`).toBe(false)
  })
})
