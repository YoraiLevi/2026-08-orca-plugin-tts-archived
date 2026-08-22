import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalize, numberToWords } from './index.ts'

/**
 * TOKEN CONSERVATION — "are the words spoken the words that were written?"
 *
 * 006 section 19 rank 5 is the last S1-shaped blind spot in this project: a normalizer defect
 * that CHANGES MEANING rather than stopping the audio is invisible. Every other class of failure
 * this project has fixed announces itself eventually — silence, a cut-off reply, the wrong
 * session. A plausible wrong sentence sounds exactly like a right one, and the listener is
 * voice-first and cannot glance at the original to check.
 *
 * WHAT THIS TEST ASSERTS. For each of the six committed fixtures, every token of the source must
 * be accounted for in one of exactly four ways:
 *
 *   1. it is SPOKEN — the token appears verbatim in `normalize()`'s output; or
 *   2. it is TRANSFORMED — a declared rule maps it to text that must appear in the output, and
 *      the test checks that the mapped text is really there (a number to its words, a unit
 *      abbreviation to its word, a file extension to its kind word, a key glyph to its word); or
 *   3. it is ANNOUNCED — it is inside a construct the pipeline replaces with a spoken lead-in,
 *      and the lead-in must be present in the output; or
 *   4. it is on the REMOVED allow-list below, which carries a written reason per entry.
 *
 * Anything else fails the test by name and by fixture.
 *
 * WHAT IT DELIBERATELY CANNOT CATCH — stated here so nobody mistakes green for proof:
 *   - A token that survives but is REORDERED, RE-ATTACHED to a different subject, or negated by
 *     a lost punctuation mark. Conservation is a set property; it says nothing about sequence.
 *     "the tests do not pass" and "do the tests pass not" conserve the same tokens.
 *   - A numeral whose VALUE changes while still expanding to real words. `2,017` spoken as
 *     "two, seventeen" conserves `2` and `017`->`seventeen` and is still wrong. This class was
 *     found by reading the output, not by this test.
 *   - Anything downstream of `normalize()`: chunking, the queue, the synthesizer, the sink.
 *   - Whether the spoken form is a GOOD reading. That is taste, and P23 says do not argue it here.
 *   Closing the first two needs the source->spoken offset map, which 003 section 8.4 scopes and
 *   calls "larger than the display work it enables". It is OUT OF SCOPE here and stays open.
 */

const FIXTURE_DIR = fileURLToPath(new URL('../../../../fixtures/', import.meta.url))
const FIXTURES = [
  'architecture.md', 'code-heavy.md', 'hostile.md', 'paths.md', 'short.md', 'tables.md'
] as const

const read = (name: string): string => readFileSync(`${FIXTURE_DIR}${name}`, 'utf8')

/* ------------------------------------------------------------------ tokens */

/**
 * A token is a run of Unicode LETTERS or a run of DIGITS. Punctuation, markdown syntax and
 * separators are deliberately not tokens — see MARKDOWN SYNTAX below.
 *
 * `\p{L}` and not `[A-Za-z]`: `hostile.md` carries Hebrew, and a Hebrew content word vanishing
 * silently is the exact failure this test exists to find.
 */
const TOKEN = /\p{L}+|[0-9]+/gu

interface Occurrence { readonly text: string; readonly at: number }

function tokensOf(text: string): Occurrence[] {
  const out: Occurrence[] = []
  for (const m of text.matchAll(TOKEN)) out.push({ text: m[0].toLowerCase(), at: m.index })
  return out
}

function spokenTokens(out: string): Set<string> {
  return new Set(tokensOf(out).map((t) => t.text))
}

/* ------------------------------------------------------- context: where a token lives */

type Range = readonly [number, number]
const inAny = (at: number, ranges: readonly Range[]): boolean =>
  ranges.some(([a, b]) => at >= a && at < b)

/** Fenced code blocks, INCLUDING the fence lines, so the ```ts info string is inside too. */
function fenceRanges(raw: string): Range[] {
  const ranges: Range[] = []
  let offset = 0
  let open: number | null = null
  for (const line of raw.split('\n')) {
    const t = line.trimStart()
    if (t.startsWith('```') || t.startsWith('~~~')) {
      if (open === null) open = offset
      else { ranges.push([open, offset + line.length]); open = null }
    }
    offset += line.length + 1
  }
  if (open !== null) ranges.push([open, raw.length])
  return ranges
}

/**
 * HTML comment spans, mirroring `stripHtmlComments`' scan. Restated here rather than imported for
 * the same reason as the glyph and unit tables below: a range function imported from the code
 * under test agrees with it by construction and cannot contradict it.
 *
 * The unterminated case matches the STAGE's decision — only the four marker characters are a
 * removal; everything after a stray `<!--` is still spoken and must still be accounted for as
 * spoken. If the stage is ever changed to swallow to end-of-document, this function will disagree
 * with it and the fixtures will report the swallowed prose as unaccounted, which is the point.
 */
function commentRanges(raw: string): Range[] {
  const ranges: Range[] = []
  let i = 0
  while (i < raw.length) {
    const open = raw.indexOf('<!--', i)
    if (open === -1) break
    const close = raw.indexOf('-->', open + 4)
    if (close === -1) { ranges.push([open, open + 4]); break }
    ranges.push([open, close + 3])
    i = close + 3
  }
  return ranges
}

/** The source with every comment span replaced by spaces — offsets and line numbers preserved. */
function blankComments(raw: string): string {
  let out = raw
  for (const [a, b] of commentRanges(raw)) out = out.slice(0, a) + ' '.repeat(b - a) + out.slice(b)
  return out
}

interface Url { readonly range: Range; readonly host: string }

/** Mirrors `stripUrls`' scan, so the ranges are the ones the pipeline really consumes. */
function urls(raw: string): Url[] {
  const found: Url[] = []
  const terminators = new Set([')', ']', '"', "'", '<', '>', ' ', '\n', '\t'])
  for (const m of raw.matchAll(/https?:\/\//g)) {
    const start = m.index
    let j = start
    while (j < raw.length && !terminators.has(raw[j] as string)) j++
    const afterScheme = raw.slice(start, j).replace(/^https?:\/\//, '')
    found.push({ range: [start, j], host: (afterScheme.split('/')[0] ?? '').replace(/^www\./, '') })
  }
  return found
}

/* --------------------------------------------------------------- transform tables */

/**
 * Restated here rather than imported, on purpose. These are CLAIMS about what the pipeline does.
 * Importing the same table the code uses would make the assertion true by construction — the
 * check could not fail (P33). Written out, a change to the table on either side is a red test and
 * a decision.
 */
const UNIT_WORD: Record<string, readonly [string, string]> = {
  ms: ['millisecond', 'milliseconds'], s: ['second', 'seconds'],
  m: ['minute', 'minutes'], h: ['hour', 'hours'],
  kb: ['kilobyte', 'kilobytes'], mb: ['megabyte', 'megabytes'],
  gb: ['gigabyte', 'gigabytes'], tb: ['terabyte', 'terabytes'],
  hz: ['hertz', 'hertz'], khz: ['kilohertz', 'kilohertz'], px: ['pixel', 'pixels']
}

const EXTENSION_WORD: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'javascript', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
  swift: 'swift', c: 'c', h: 'header', cpp: 'c plus plus', cs: 'c sharp', sh: 'shell',
  bash: 'shell', zsh: 'shell', md: 'markdown', json: 'json', jsonl: 'json lines',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', html: 'html', css: 'css', sql: 'sql',
  txt: 'text', csv: 'csv', xml: 'xml', lock: 'lock'
}

/* ------------------------------------------------------------------ the allow-list */

/**
 * THE ALLOW-LIST. Every way a token is permitted to leave the pipeline, with the reason it is
 * permitted. Nothing else is permitted.
 *
 * THIS IS A REVIEWED ARTIFACT, NOT A BUCKET THAT GROWS WHENEVER THE TEST GOES RED. Appending an
 * entry — a rule id here, or a literal token in REMOVED_TOKENS below — without a reason that
 * survives being read aloud to somebody else defeats the entire purpose of this file: it converts
 * a check that CAN fail into one that cannot, permanently and silently. That is the exact failure
 * mode P33 was written about and that two rounds of this project were spent removing.
 *
 * Adding an entry is structurally a decision, not an edit. The reviewed set is frozen in
 * REVIEWED_POLICY_IDS / REVIEWED_REMOVED_TOKENS, both asserted below, and the assertion PRINTS
 * the delta when it moves. If you are here because a fixture changed, the honest first question
 * is whether the LOSS is correct, not whether the list can be made longer.
 *
 * Rules 'spoken' and 'transformed:*' are not losses at all — the content reaches the listener in
 * another form and the test checks that form is really there. Only 'announced:*', 'glyph:removed'
 * and 'allow-list' describe content the listener never hears.
 */
const POLICY: Record<string, string> = {
  spoken:
    'The token appears verbatim in the spoken output. Not a loss.',
  'transformed:number':
    'An integer is spoken as words — "950" as "nine hundred fifty". Content words are never ' +
    'deliberately removed and neither is a quantity; this rule asserts the WORDS are present, so ' +
    'a number that vanishes rather than expanding still fails.',
  'transformed:unit':
    'A unit abbreviation is spoken as its word — "ms" as "milliseconds". The listener hears the ' +
    'unit rather than decoding two letters; the information is kept, only its form changes.',
  'transformed:extension':
    'A file extension is spoken as its kind word — "index.ts" as "file named index, typescript". ' +
    'From the listening report: the raw suffix was "garbled noise". Extensions with no word fall ' +
    'back to "dot onnx" and are conserved verbatim by the "spoken" rule instead.',
  'glyph:spoken-word':
    'A key glyph or a VERDICT glyph is spoken as a word — command, shift, yes, no, warning. ' +
    '006 site 50: check marks were being DELETED, so "check done" and "cross done" reached the ' +
    'listener as the same sentence with the verdict removed. These carry meaning and the rule ' +
    'asserts the word arrives at least as often as the glyph was written.',
  'announced:code-block':
    'A fenced code block is replaced by a spoken lead-in ("Here, a code block is omitted"). Code ' +
    'read aloud character by character is unusable, and the listener is TOLD the content went, ' +
    'which is the difference between an S3 announced loss and an S2 silent one. The lead-in must ' +
    'be present in the output for this rule to apply.',
  'announced:url':
    'A URL scheme and PATH are dropped; the HOST is spoken ("a link to github dot com"). A path ' +
    'read aloud is unusable and the host is what tells the listener where the link goes. The rule ' +
    'checks the host really arrived, so a URL that vanishes entirely still fails.',
  'glyph:removed':
    'A DECORATIVE emoji is removed with no announcement — a party popper, a fire, a thumbs up. ' +
    'It carries no proposition, and announcing it ("an emoji was omitted") would be narration, ' +
    'which is its own harm for a listener whose only channel is the audio. This is the one ' +
    'deliberate silent removal in the pipeline and 006 flagged the inconsistency with code ' +
    'blocks and URLs on purpose: it is a judgement, not an oversight. A glyph that carries a ' +
    'VERDICT is not decorative and is handled by glyph:spoken-word above, which is checked FIRST.',
  'glyph:passthrough':
    'A non-ASCII mark the pipeline does not touch — an em dash, a lone box character inside a ' +
    'sentence ABOUT box characters — reaches the engine unchanged. Asserted rather than assumed. ' +
    'This rule did exactly the job it was written for: when stage 3 landed, it went red on seven ' +
    'glyphs of hostile.md and forced announced:diagram to be designed rather than defaulted.',
  'announced:diagram':
    'A box-drawing run is replaced by a spoken lead-in that NAMES ITS LABELS ("Here, a diagram ' +
    'is omitted. It is labelled: transcript watcher, ..."). The geometry cannot be linearised ' +
    'into audio at all, so nothing deliverable is lost by dropping it; the label text is the ' +
    'diagram\'s only speakable content and is CONSERVED BY THE ANNOUNCEMENT — which is why the ' +
    'word-conservation half of this file stayed green when the glyph half went red. The rule ' +
    'checks the lead-in really arrived, so a diagram that vanishes silently still fails.',
  'removed:html-comment':
    'The token is inside an HTML comment and every one of its occurrences is. A comment is markup ' +
    'the author wrote for a reader of the SOURCE, and the listener is not that reader; speaking it ' +
    'was J21 bug 1, where all six fixtures opened by reading their own provenance note aloud after ' +
    'a first utterance of the two characters "<!". Removed with no announcement, on the same ' +
    'judgement as glyph:removed: nothing propositional was withheld from the listener, and ' +
    '"a comment was omitted" on every reply would be narration.',
  'allow-list':
    'An explicit token in REMOVED_TOKENS, with its own written reason.'
}

/** Frozen. Growing this list is a review, not an edit. */
const REVIEWED_POLICY_IDS = [
  'allow-list', 'announced:code-block', 'announced:diagram', 'announced:url', 'glyph:passthrough',
  'glyph:removed', 'glyph:spoken-word', 'removed:html-comment', 'spoken', 'transformed:extension',
  'transformed:number', 'transformed:unit'
]

/**
 * Literal tokens the pipeline removes that no rule above explains. EMPTY, and that is the finding:
 * across all six fixtures every single loss is explained by a named rule. A token appearing here
 * needs a reason of its own, not a shrug.
 */
const REMOVED_TOKENS: Record<string, string> = {}
const REVIEWED_REMOVED_TOKENS: string[] = []

/* ------------------------------------------------------------ glyphs */

/**
 * Restated here rather than imported from `index.ts`, on purpose, and this is the load-bearing
 * decision in the file. Importing the same table the code uses would make the assertion true by
 * construction: delete a check mark from KEY_GLYPHS and an imported table would delete it here
 * too, and the test would stay green while the verdict stopped being spoken. Written out, the two
 * tables are independent claims and the mutation goes red. Same reasoning for UNIT_WORD and
 * EXTENSION_WORD above.
 */
const GLYPH_WORD: Record<string, string> = {
  '\u2318': 'command', '\u21e7': 'shift', '\u2325': 'option', '\u2303': 'control',
  '\u23ce': 'enter', '\u232b': 'delete', '\u21e5': 'tab', '\u2423': 'space',
  '\u2191': 'up', '\u2193': 'down', '\u2190': 'left', '\u2192': 'right',
  // Verdicts. Not decoration: "check done" and "cross done" are opposite answers.
  '\u2713': 'yes', '\u2714': 'yes', '\u2705': 'yes',
  '\u2717': 'no', '\u2718': 'no', '\u274c': 'no', '\u274e': 'no',
  '\u26a0': 'warning', '\u2757': 'important', '\u2755': 'important'
}

/**
 * The glyphs a diagram is DRAWN with, restated here rather than imported from `index.ts` for this
 * file's standing reason: a predicate imported from the code under test agrees with it by
 * construction. Wider than the stage's DETECTION set on purpose — this asks "could stage 3 have
 * eaten this?", which includes the geometric shapes and arrows it removes once a run is judged
 * art, not the narrower set it uses to judge.
 */
function isDiagramGlyph(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0
  return (cp >= 0x2500 && cp <= 0x25ff) || (cp >= 0x2190 && cp <= 0x21ff)
}

function isEmojiCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x1f000 && cp <= 0x1f0ff) || cp === 0x200d ||
    (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x20e3
  )
}

/** Non-ASCII, not a letter (letters are word tokens), not whitespace. */
function glyphsOf(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp < 0x80 || /\p{L}|\s/u.test(ch)) continue
    counts.set(ch, (counts.get(ch) ?? 0) + 1)
  }
  return counts
}

function countToken(text: string, word: string): number {
  return tokensOf(text).filter((t) => t.text === word).length
}

interface GlyphVerdict { readonly rule: string; readonly ok: boolean; readonly why?: string }

function accountGlyph(ch: string, count: number, raw: string, out: string): GlyphVerdict {
  // CHECKED FIRST, and the order is the policy: a glyph that carries a verdict is never
  // decoration, even though \u2705 sits squarely inside the emoji range.
  const word = GLYPH_WORD[ch]
  if (word !== undefined) {
    const expected = count + countToken(raw, word)
    const actual = countToken(out, word)
    return actual >= expected
      ? { rule: 'glyph:spoken-word', ok: true }
      : {
          rule: 'glyph:spoken-word', ok: false,
          why: `written ${count}x, expected "${word}" at least ${expected}x, heard ${actual}x`
        }
  }
  if (isEmojiCodePoint(ch.codePointAt(0) ?? 0)) {
    return out.includes(ch)
      ? { rule: 'glyph:passthrough', ok: true }
      : { rule: 'glyph:removed', ok: true }
  }
  if (out.includes(ch)) return { rule: 'glyph:passthrough', ok: true }
  // CHECKED LAST, and only for a glyph that is really gone. A box character inside ordinary prose
  // still passes through above, so this rule can only be reached by one that stage 3 consumed.
  if (isDiagramGlyph(ch)) {
    return out.includes('a diagram is omitted')
      ? { rule: 'announced:diagram', ok: true }
      : { rule: 'announced:diagram', ok: false, why: 'line art vanished with no lead-in spoken' }
  }
  return { rule: 'glyph:passthrough', ok: false, why: 'a mark no rule removes vanished anyway' }
}

/* ------------------------------------------------------------------ the check */

interface Verdict { readonly rule: string; readonly ok: boolean; readonly why?: string }

function account(tok: string, mentions: readonly Occurrence[], raw: string, out: string,
                 spoken: Set<string>, fences: readonly Range[], links: readonly Url[],
                 comments: readonly Range[]): Verdict {
  // 1. spoken verbatim
  if (spoken.has(tok)) return { rule: 'spoken', ok: true }

  /**
   * 1b. REMOVED — stage 2 deletes HTML comments, so occurrences inside one are gone before any
   * later stage sees them. Filter them out FIRST and then ask what happened to what is left. A
   * token can live in both places at once: `code-heavy.md` writes `speak` twice inside its
   * provenance comment and once as a fence info string, and neither "all of it was a comment" nor
   * "all of it was code" is true of it. Subtracting the comment occurrences makes the remaining
   * question the right one, and lets the fence rule answer it.
   */
  const occ = mentions.filter((o) => !inAny(o.at, comments))
  if (occ.length === 0) return { rule: 'removed:html-comment', ok: true }

  // 2a. TRANSFORMED — an integer spoken as words.
  if (/^[0-9]+$/.test(tok)) {
    const words = numberToWords(Number(tok))
    if (words.split(' ').every((w) => spoken.has(w)) && out.includes(words)) {
      return { rule: 'transformed:number', ok: true }
    }
  }
  // 2b. TRANSFORMED — a unit abbreviation spoken as its word.
  const unit = UNIT_WORD[tok]
  if (unit !== undefined && unit.some((w) => spoken.has(w))) return { rule: 'transformed:unit', ok: true }
  // 2c. TRANSFORMED — a file extension spoken as its kind word.
  const kind = EXTENSION_WORD[tok]
  if (kind !== undefined && new RegExp(`[./]${tok}\\b`).test(raw) && kind.split(' ').every((w) => spoken.has(w))) {
    return { rule: 'transformed:extension', ok: true }
  }

  // 3a. ANNOUNCED — every occurrence is inside a fenced code block, and the lead-in is spoken.
  if (occ.every((o) => inAny(o.at, fences))) {
    return out.includes('a code block is omitted')
      ? { rule: 'announced:code-block', ok: true }
      : { rule: 'announced:code-block', ok: false, why: 'inside a fence, but no lead-in was spoken' }
  }
  // 3b. ANNOUNCED — every occurrence is inside a URL, and the HOST reached the listener.
  const inUrls = occ.every((o) => links.some(({ range: [a, b] }) => o.at >= a && o.at < b))
  if (inUrls && links.length > 0) {
    const hostsSpoken = links.every((l) => tokensOf(l.host).every((h) => spoken.has(h.text)))
    return hostsSpoken
      ? { rule: 'announced:url', ok: true }
      : { rule: 'announced:url', ok: false, why: 'a URL was dropped and its host was not spoken' }
  }

  // 4. the reviewed allow-list
  if (REMOVED_TOKENS[tok] !== undefined) return { rule: 'allow-list', ok: true }

  return { rule: 'unaccounted', ok: false, why: 'lost with no rule and no allow-list entry' }
}

describe('token conservation — every written word is spoken, announced, or allow-listed', () => {
  const used = new Set<string>()

  for (const name of FIXTURES) {
    it(`${name} loses no token without a reason`, () => {
      const raw = read(name)
      const out = normalize(raw)
      const spoken = spokenTokens(out)
      const fences = fenceRanges(raw)
      const links = urls(raw)
      const comments = commentRanges(raw)

      const byToken = new Map<string, Occurrence[]>()
      for (const o of tokensOf(raw)) {
        const list = byToken.get(o.text)
        if (list === undefined) byToken.set(o.text, [o]); else list.push(o)
      }

      const unaccounted: string[] = []
      for (const [tok, occ] of byToken) {
        const v = account(tok, occ, raw, out, spoken, fences, links, comments)
        used.add(v.rule)
        if (!v.ok) unaccounted.push(`${tok} — ${v.rule}: ${v.why ?? ''}`)
      }
      expect(unaccounted, `${name}: WORDS lost with no accounting`).toEqual([])
    })

    it(`${name} loses no glyph without a reason`, () => {
      // Comments are blanked FIRST. A glyph inside a comment is not content, and neither is a
      // WORD inside one — `hostile.md`'s comment says "right-to-left text", and counting that
      // "left" as an expected spoken word would demand the arrow glyph produce it twice.
      const raw = blankComments(read(name))
      const out = normalize(read(name))
      const unaccounted: string[] = []
      for (const [ch, count] of glyphsOf(raw)) {
        const v = accountGlyph(ch, count, raw, out)
        used.add(v.rule)
        if (!v.ok) {
          const cp = (ch.codePointAt(0) ?? 0).toString(16)
          unaccounted.push(`U+${cp.toUpperCase()} ${ch} — ${v.rule}: ${v.why ?? ''}`)
        }
      }
      expect(unaccounted, `${name}: GLYPHS lost with no accounting`).toEqual([])
    })
  }

  it('every rule the corpus actually used is a reviewed rule with a written reason', () => {
    // A floor, so a classifier that quietly stops matching cannot pass vacuously (P33).
    expect(used.size).toBeGreaterThanOrEqual(7)
    expect([...used].filter((r) => POLICY[r] === undefined), 'rules used with no written reason').toEqual([])
  })
})

describe('token conservation — the allow-list is a reviewed artifact', () => {
  it('the reviewed rule set has not moved', () => {
    const now = Object.keys(POLICY).toSorted()
    const added = now.filter((r) => !REVIEWED_POLICY_IDS.includes(r))
    const dropped = REVIEWED_POLICY_IDS.filter((r) => !now.includes(r))
    expect(
      { added, dropped },
      'The allow-list changed. Adding a way for content to leave the pipeline is a DECISION: ' +
      'write the reason in POLICY, then update REVIEWED_POLICY_IDS in the same commit. ' +
      'Appending because the test went red is how this test stops being able to fail.'
    ).toEqual({ added: [], dropped: [] })
  })

  it('the literal removed-token list has not moved', () => {
    const now = Object.keys(REMOVED_TOKENS).toSorted()
    const added = now.filter((k) => !REVIEWED_REMOVED_TOKENS.includes(k))
    const dropped = REVIEWED_REMOVED_TOKENS.filter((k) => !now.includes(k))
    expect(
      { added, dropped },
      'REMOVED_TOKENS changed. Each entry silences one word for the listener forever. ' +
      'Give it a reason, then update REVIEWED_REMOVED_TOKENS in the same commit.'
    ).toEqual({ added: [], dropped: [] })
  })

  it('every entry carries a reason long enough to be an argument', () => {
    const thin = [...Object.entries(POLICY), ...Object.entries(REMOVED_TOKENS)]
      .filter(([, reason]) => reason.trim().length < 60)
      .map(([id]) => id)
    expect(thin, 'entries whose reason is too short to have been thought about').toEqual([])
  })

  it('a verdict glyph is never absorbed by the decorative-emoji rule', () => {
    // The whole file turns on this ordering: \u2705 is inside the emoji range, and if the emoji
    // rule saw it first, deleting a check mark would be silently permitted forever.
    const verdicts = ['\u2705', '\u2713', '\u274c', '\u26a0']
    for (const ch of verdicts) {
      expect(isEmojiCodePoint(ch.codePointAt(0) ?? 0), `${ch} is in the emoji range`).toBe(true)
      expect(GLYPH_WORD[ch], `${ch} must be spoken as a word, never removed`).toBeTypeOf('string')
      // A raw string containing only the glyph must produce its word.
      expect(normalize(`Build ${ch} done.`)).toContain(GLYPH_WORD[ch] as string)
    }
  })
})
