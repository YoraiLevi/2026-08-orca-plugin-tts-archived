/**
 * Streaming sentence chunker.
 *
 * Turns an incrementally-arriving reply into utterances a synthesizer can speak without
 * sounding choppy. Pure, DEPENDENCY-FREE, and incremental: `addText()` may be called with
 * arbitrary fragments and must produce exactly what the whole string would have produced.
 *
 * Algorithm ported from block/buzz `pocket_april.rs` (docs/.research/prior-art-buzz.md,
 * "Streaming chunker"), with buzz's SentencePiece token counter replaced by an injected
 * unit counter so local (token-budget) and cloud (character-budget) engines share one splitter.
 *
 * Two policies over ONE splitter, switched by a single flag:
 *   - first chunk  -> the EARLIEST sentence end   (minimum time to first audio)
 *   - later chunks -> the LATEST boundary that fits (fewest synthesis calls, best prosody)
 *
 * Invariant: `chunks.join('') === input`, exactly. Trailing whitespace travels with its chunk.
 */

export type BoundaryKind = 'sentence' | 'clause' | 'word' | 'scalar' | 'end'

export interface Chunk {
  readonly text: string
  readonly boundary: BoundaryKind
  readonly isFirst: boolean
}

export interface ChunkerOptions {
  /** Maximum units per chunk. Units are whatever `countUnits` returns. */
  maxUnits?: number
  /** Engine-specific size measure. Default: characters. Local engines pass a tokenizer. */
  countUnits?: (text: string) => number
  /** Isolate the first sentence of an utterance for minimum latency. Default true. */
  isolateFirstSentence?: boolean
}

/**
 * The runtime key list for `ChunkerOptions` — T124 (011 section 3.3 (a)).
 *
 * `countUnits` is deliberately absent: it is an injected FUNCTION, not a value a settings file can
 * carry. The exclusion is a named constant (`CHUNKER_OPTION_KEYS_EXCLUDED`) rather than a silent
 * omission, so a reviewer sees the decision instead of the gap.
 */
export const CHUNKER_OPTION_KEYS = [
  'maxUnits', 'countUnits', 'isolateFirstSentence'
] as const satisfies readonly (keyof ChunkerOptions)[]

/** Keys of `ChunkerOptions` that are deliberately not settable. */
export const CHUNKER_OPTION_KEYS_EXCLUDED = ['countUnits'] as const

type _MissingChunkerKey =
  Exclude<keyof ChunkerOptions, (typeof CHUNKER_OPTION_KEYS)[number]> extends never ? true : never
const _chunkerKeysAreExhaustive: _MissingChunkerKey = true
void _chunkerKeysAreExhaustive

/**
 * "Is there a glyph here a synthesizer can turn into sound?" — a letter or a digit, any script.
 *
 * A RESTATED LOCAL COPY. There was briefly a shared `packages/core/src/speakable.ts` that both this
 * file and the normalizer imported, and it was removed after both spellings of the import were
 * seen to fail: `'../speakable.js'` typechecked but left `pnpm voice-lab` unable to boot under
 * plain node (SC-13, SC-14 / 019 R10-06), and `'../speakable.ts'` booted the Lab but broke
 * `tsc -b` with TS5097.
 *
 * **That dilemma is gone, and the reason it was believed is corrected here.** The claim that an
 * emitting build cannot have `allowImportingTsExtensions` was true before TypeScript 5.7 and is
 * false now: paired with `rewriteRelativeImportExtensions`, tsc accepts `.ts` specifiers in source
 * AND rewrites them to `.js` on emit. Both are set in `tsconfig.base.json`, the whole repo names
 * its specifiers `.ts`, and `tsc -b --force` exits 0 `[measured-here]`. A cross-directory import
 * here would resolve today.
 *
 * **The local copy stays anyway, for the reason that never depended on the resolver.** The
 * predicate is stated three times: here, in `normalize()`, and a third time in
 * `packages/core/src/seams/seam-contracts.test.ts`, which feeds this component's real output to
 * ITS copy. Two definitions that must agree is a check; one definition imported everywhere is not
 * (P36). If any of the three drifts, SC-1 or SC-2 goes red and someone has to decide which one is
 * right — which is exactly what a seam contract is for.
 */
const SPEAKABLE_GLYPH = /[\p{L}\p{N}]/u

function hasSpeakableGlyph(text: string): boolean {
  return SPEAKABLE_GLYPH.test(text)
}

/** Terminal punctuation that may end a sentence, once closing quotes/brackets are skipped. */
const SENTENCE_END = new Set(['.', '!', '?'])
const CLAUSE_END = new Set([',', ';', ':', '—', '–'])
const CLOSERS = new Set([')', ']', '}', '"', "'", '”', '’'])
const SPACE = new Set([' ', '\n', '\t', '\r'])

/**
 * Tokens whose trailing '.' is not a sentence end. Compared case-insensitively against the
 * word immediately preceding the period.
 */
const ABBREVIATIONS = new Set([
  'e.g', 'i.e', 'etc', 'vs', 'cf', 'al', 'approx', 'est',
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'fig', 'no', 'vol', 'pp', 'ed'
])

const DEFAULT_MAX_UNITS = 200

export class Chunker {
  readonly #maxUnits: number
  readonly #countUnits: (text: string) => number
  readonly #isolateFirst: boolean

  #buffer = ''
  #emittedAny = false

  constructor(opts: ChunkerOptions = {}) {
    this.#maxUnits = Math.max(1, opts.maxUnits ?? DEFAULT_MAX_UNITS)
    this.#countUnits = opts.countUnits ?? ((t) => t.length)
    this.#isolateFirst = opts.isolateFirstSentence ?? true
  }

  /** Feed more text. Returns whatever chunks are now complete. */
  addText(text: string): Chunk[] {
    this.#buffer += text
    return this.#drain(false)
  }

  /** End of utterance: flush whatever remains. */
  finish(): Chunk[] {
    const out = this.#drain(true)
    if (this.#buffer.length > 0) {
      out.push({ text: this.#buffer, boundary: 'end', isFirst: !this.#emittedAny })
      this.#emittedAny = true
      this.#buffer = ''
    }
    return out
  }

  /** Discard buffered text without emitting it (barge-in). */
  reset(): void {
    this.#buffer = ''
    this.#emittedAny = false
  }

  #drain(final: boolean): Chunk[] {
    const out: Chunk[] = []
    for (;;) {
      const cut = this.#findCut(final)
      if (cut === null) break
      const text = this.#buffer.slice(0, cut.index)
      if (text.length === 0) break
      this.#buffer = this.#buffer.slice(cut.index)
      out.push({ text, boundary: cut.kind, isFirst: !this.#emittedAny })
      this.#emittedAny = true
    }
    return out
  }

  /**
   * Scan candidate boundaries in order, remembering the best of each kind that still fits.
   * Stops at the first candidate that overflows: unit cost is monotonic in prefix length, so
   * nothing longer can fit. (buzz notes this scan was originally superlinear and the cost landed
   * BEFORE first audio — a latency bug, not a throughput bug.)
   */
  #findCut(final: boolean): { index: number; kind: BoundaryKind } | null {
    const buf = this.#buffer
    if (buf.length === 0) return null

    const wantEarliestSentence = this.#isolateFirst && !this.#emittedAny

    let firstSentence = -1
    let lastSentence = -1
    let lastClause = -1
    let lastWord = -1
    let lastFitting = -1
    let overflowed = false

    for (let i = 0; i < buf.length; i++) {
      const end = i + 1
      if (this.#countUnits(buf.slice(0, end)) > this.#maxUnits) { overflowed = true; break }
      lastFitting = end

      const ch = buf[i] as string
      if (SENTENCE_END.has(ch)) {
        const after = this.#skipClosers(i + 1)
        if (this.#isSentenceEnd(i, after)) {
          const cut = this.#absorbSpaces(after)
          if (cut <= buf.length && this.#countUnits(buf.slice(0, cut)) <= this.#maxUnits &&
              this.#carriesSpeech(cut)) {
            if (firstSentence === -1) firstSentence = cut
            lastSentence = cut
            // The earliest sentence end is all the first chunk needs; stop scanning.
            if (wantEarliestSentence && this.#complete(cut, final)) break
          }
        }
      } else if (CLAUSE_END.has(ch)) {
        const cut = this.#absorbSpaces(i + 1)
        if (this.#countUnits(buf.slice(0, cut)) <= this.#maxUnits && this.#carriesSpeech(cut)) {
          lastClause = cut
        }
      } else if (SPACE.has(ch)) {
        const cut = this.#absorbSpaces(i)
        if (cut > 0 && this.#countUnits(buf.slice(0, cut)) <= this.#maxUnits &&
            this.#carriesSpeech(cut)) {
          lastWord = cut
        }
      }
    }

    // Streaming must agree with batch exactly (T035), and that constrains WHEN we may emit.
    //
    // The first chunk wants the EARLIEST sentence end, which is knowable the moment that sentence
    // completes — batch would pick the same one. Emit immediately; this is the latency win.
    //
    // Every later chunk wants the LATEST boundary that fits. That is NOT knowable while more text
    // may still arrive: a sentence end we can see now might be beaten by another one that also
    // fits. So we wait until the buffer overflows the limit — at which point no further boundary
    // can join this chunk and our answer provably equals batch's.
    if (!final) {
      if (wantEarliestSentence && firstSentence !== -1 && this.#complete(firstSentence, final)) {
        return { index: firstSentence, kind: 'sentence' }
      }
      if (!overflowed) return null
    } else {
      const sentence = wantEarliestSentence ? firstSentence : lastSentence
      if (sentence !== -1) return { index: sentence, kind: 'sentence' }
      if (!overflowed) return null            // everything fits; finish() flushes the tail
    }

    if (lastSentence > 0) return { index: lastSentence, kind: 'sentence' }
    if (lastClause > 0) return { index: lastClause, kind: 'clause' }
    if (lastWord > 0) return { index: lastWord, kind: 'word' }
    if (lastFitting > 0) return { index: lastFitting, kind: 'scalar' }
    return { index: 1, kind: 'scalar' }
  }

  /**
   * A boundary is only safe to emit mid-stream once we can see a non-space character after it,
   * or the stream has ended. Otherwise a later fragment could extend the token (`e.g` -> `e.g.`)
   * and streaming would disagree with batch.
   */
  #complete(cut: number, final: boolean): boolean {
    if (final) return true
    return cut < this.#buffer.length
  }

  /**
   * SC-2 (006 section 22, finding R8-08). May the prefix `buf[0..cut)` be emitted as a chunk of
   * its own, or would it be an utterance with nothing in it to say?
   *
   * `#isSentenceEnd` returns true unconditionally for '!' and '?' — "'!' and '?' are never
   * abbreviations", which is true as written and wrong as a SENTENCE rule: '.' gets six context
   * tests and '!' got none. So `#!/usr/bin/env node` yielded a first chunk of `"#!"` and
   * `![alt](url)` yielded `"!"`. Each costs a full synthesis round trip and returns near-silence
   * (p50 747 ms of provider time for 97 ms of noise, `017` R8-09), and each lands on chunk 0 — the
   * one chunk `isolateFirstSentence` exists to make fast.
   *
   * Stated as a property of the CHUNK rather than of the punctuation mark, because that is the
   * form the downstream provider actually needs: it does not care which glyph ended the sentence,
   * it cares whether there is a word in the utterance. A boundary that would mint a speechless
   * chunk is simply not a boundary, so the fragment travels with the text that follows it —
   * `"#!/usr/bin/env node Run it."` becomes one chunk instead of two, and the invariant
   * `chunks.join('') === input` is untouched (it is a refusal to cut, never a rewrite).
   *
   * Safe for streaming: this reads a PREFIX of the buffer, and a prefix never changes as more text
   * arrives — so streaming still agrees with batch (SC-5, T035).
   *
   * NOT applied to the `scalar` fallback below. That path fires only when a single token overruns
   * `maxUnits` with no boundary anywhere, and it exists to guarantee forward progress; refusing it
   * would hang the chunker on a long enough run of punctuation. A 200-character wall of '!' is
   * still speech-free and still reaches the provider — recorded here as the residue rather than
   * fixed, because the provider's own empty-output guard is the right place for it and
   * `OsSynthEmptyOutputError` (006 site 43) already names that outcome.
   */
  #carriesSpeech(cut: number): boolean {
    return hasSpeakableGlyph(this.#buffer.slice(0, cut))
  }

  #skipClosers(from: number): number {
    let i = from
    while (i < this.#buffer.length && CLOSERS.has(this.#buffer[i] as string)) i++
    return i
  }

  #absorbSpaces(from: number): number {
    let i = from
    while (i < this.#buffer.length && SPACE.has(this.#buffer[i] as string)) i++
    return i
  }

  /** Is the '.' at `dot` a real sentence end, given the next non-closer is at `after`? */
  #isSentenceEnd(dot: number, after: number): boolean {
    const buf = this.#buffer
    if (buf[dot] !== '.') return true              // '!' and '?' are never abbreviations

    // A period followed immediately by a digit is a decimal or a version, not an end.
    if (isDigit(buf[after])) return false

    // Walk back over the token that owns this period.
    let start = dot
    while (start > 0 && !SPACE.has(buf[start - 1] as string)) start--
    const token = buf.slice(start, dot).toLowerCase()

    if (ABBREVIATIONS.has(token)) return false
    // "e.g." style: the token itself contains internal periods.
    if (token.includes('.')) return false
    // A bare numeral before the period is a list marker: "Step 1. Do the thing".
    if (token.length > 0 && [...token].every((c) => c >= '0' && c <= '9')) return false
    // A single capital letter is an initial: "J. Smith".
    if (token.length === 1 && token !== token.toUpperCase()) return false
    return true
  }
}

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9'
}
