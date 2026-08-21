/**
 * "Is there anything here a synthesizer can turn into sound?" — ONE predicate, for the three
 * components that each used to hold a different version of it.
 *
 * WHY THIS FILE EXISTS. `docs/design/006-fma.md` section 22 (SC-1, SC-2) records the seam: the
 * same concept — *speakable* — had three incompatible definitions and nothing compared them.
 *
 *   - `normalize()` ended with a LENGTH test: `s.length <= 1 ? '' : s`. So `".!!!???"` (length 7)
 *     was returned as speech.
 *   - `OsSynthProvider.generate()` opens with a WHITESPACE test: `text.trim().length === 0`. So
 *     `".!!!???"` is not empty, and a full synthesis round trip is spent on it.
 *   - the `Chunker` never asked at all, and `#isSentenceEnd` returns true unconditionally for `!`
 *     and `?`, so `#!/usr/bin/env node` mints a first chunk of `"#!"` and `![alt](url)` mints `"!"`.
 *
 * Each of those three is correct for its own module's job. The defect is in the space between
 * them, and its cost is measured: `say -o out.wav "<!"` exits 0 and writes 4,332 bytes — 97 ms of
 * near-silence — for p50 747 ms of provider time `[measured-here]`, n=6
 * (`docs/design/017-review-round8.md` R8-09). `SpeechService` checks `spoken.length === 0`, so the
 * `'empty'` outcome never fires, so the `unspeakable` loss sentence is never spoken: the listener
 * is told nothing and hears nothing. Under P30 a loss is never silent and never merely logged.
 *
 * ONE DEFINITION, and it is deliberately narrow: a letter or a digit, in ANY script. Not "not
 * punctuation" — an allow-list of things that carry sound, rather than a deny-list of things that
 * do not, because a deny-list silently admits every glyph nobody thought of.
 *
 * NOTE FOR THE SEAM TESTS. `packages/core/src/seams/seam-contracts.test.ts` deliberately does NOT
 * import this. It restates the predicate as its own independent claim, because a seam test that
 * imported the guard it checks would compare that guard against itself and could not fail (P36).
 * The duplication between that file and this one is the mechanism, not the cost: if the two ever
 * disagree, the seam test goes red and someone has to decide which one is right.
 */

/** A glyph a synthesizer can turn into sound: a letter or a digit, in any script. */
const SPEAKABLE_GLYPH = /[\p{L}\p{N}]/u

/**
 * Does this text contain anything a listener could hear as a word or a number?
 *
 * `''`, `'   '`, `'.!!!???'`, `'#!'`, `'---'` and a lone emoji are all false. `'a'`, `'42'`,
 * `'שלום'` and `'x.'` are all true.
 */
export function hasSpeakableGlyph(text: string): boolean {
  return SPEAKABLE_GLYPH.test(text)
}
