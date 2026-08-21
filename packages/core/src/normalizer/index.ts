/**
 * Speech text normalizer.
 *
 * Turns an agent's markdown reply into text that sounds right when spoken.
 * Pure, synchronous, and DEPENDENCY-FREE — this module imports nothing, not even `node:`
 * builtins, so it runs identically in a plugin worker, a panel, a service, and a test.
 *
 * Stage order is load-bearing. Block constructs (fences, headings, lists, tables) are handled
 * while line structure still exists; whitespace is collapsed last.
 *
 * Ported from block/buzz `preprocess_for_tts` (docs/.research/prior-art-buzz.md), plus the four
 * constructs buzz does not handle: headings, lists, tables, file paths.
 */

export type CodeBlockPolicy = 'announce' | 'drop'
export type PathStyle = 'spoken' | 'terse' | 'verbatim'
/** Where the file kind lands, or whether it is spoken at all. */
export type ExtensionStyle = 'word-last' | 'word-first' | 'raw-last' | 'omit'
/** What happens to the "1." in an ordered list. */
export type OrderedListStyle = 'numeral' | 'word' | 'drop'

export interface NormalizeOptions {
  /** Fenced code: announce as "code block omitted", or drop silently. Default 'announce'. */
  codeBlocks?: CodeBlockPolicy
  /**
   * How file paths are spoken. Default 'spoken':
   *   "file named session handler, python, in folder src core"
   * 'terse'    -> "session handler, in folder src core"   (no file kind)
   * 'verbatim' -> the raw path, untouched
   */
  pathStyle?: PathStyle
  /**
   * Where the file kind goes. Default 'word-last' — heard as a trailing detail rather than a
   * prefix, because a kind spoken first is noise before you know what is being named.
   */
  extensionStyle?: ExtensionStyle
  /** Expand integers and clock times to words. Default true. */
  expandNumbers?: boolean
  /**
   * Ordered-list ordinals. Default 'numeral' — CHANGED from v1, which dropped them.
   *
   * `"1. alpha"` becomes:
   *   'numeral' -> "1, alpha."       (heard as "one, alpha", since expandNumbers runs after)
   *   'word'    -> "first, alpha."
   *   'drop'    -> "alpha."          (v1 behaviour; a numbered procedure loses its numbers and
   *                                   becomes indistinguishable from a bullet list)
   *
   * A comma, not a full stop: "1." as its own sentence would be split off by the chunker and
   * spoken as a lone utterance. Unordered markers are still dropped — there is nothing to keep.
   */
  orderedLists?: OrderedListStyle
}

/** Extensions worth naming aloud. A listener wants "the python file", not "dot p y". */
const EXTENSION_WORDS: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'javascript', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
  swift: 'swift', c: 'C', h: 'header', cpp: 'C plus plus', cs: 'C sharp', sh: 'shell',
  bash: 'shell', zsh: 'shell', md: 'markdown', json: 'JSON', jsonl: 'JSON lines',
  yml: 'YAML', yaml: 'YAML', toml: 'TOML', html: 'HTML', css: 'CSS', sql: 'SQL',
  txt: 'text', csv: 'CSV', xml: 'XML', lock: 'lock'
}

/** Units, so "52 ms" is heard rather than decoded. */
const UNIT_WORDS: Record<string, [string, string]> = {
  ms: ['millisecond', 'milliseconds'],
  s: ['second', 'seconds'],
  m: ['minute', 'minutes'],
  h: ['hour', 'hours'],
  kb: ['kilobyte', 'kilobytes'],
  mb: ['megabyte', 'megabytes'],
  gb: ['gigabyte', 'gigabytes'],
  tb: ['terabyte', 'terabytes'],
  hz: ['hertz', 'hertz'],
  khz: ['kilohertz', 'kilohertz'],
  px: ['pixel', 'pixels']
}

/** Keyboard glyphs go to the engine as garbage otherwise. */
const KEY_GLYPHS: Record<string, string> = {
  '\u2318': 'command', '\u21e7': 'shift', '\u2325': 'option', '\u2303': 'control',
  '\u23ce': 'enter', '\u232b': 'delete', '\u21e5': 'tab', '\u2423': 'space',
  '\u2191': 'up', '\u2193': 'down', '\u2190': 'left', '\u2192': 'right',
  /**
   * 006 site 50: `stripEmoji` deleted emoji, dingbats AND CHECK MARKS with no announcement, so
   * "\u2705 done" and "\u274C done" reached the listener as the same word — the verdict removed and
   * only the subject left. These carry MEANING in an agent reply; a party popper does not, and
   * still does not get one. Spoken as words, not announced as omissions: "yes" is the content, and
   * "an emoji was omitted" would be narration.
   */
  '\u2713': 'yes', '\u2714': 'yes', '\u2705': 'yes',
  '\u2717': 'no', '\u2718': 'no', '\u274c': 'no', '\u274e': 'no',
  '\u26a0': 'warning', '\u2757': 'important', '\u2755': 'important'
}

// A lead-in, not a bare label: a listener needs a beat of warning before the content vanishes.
// Its own sentence, so the engine pauses either side of it.
const CODE_PLACEHOLDER = ' . Here, a code block is omitted. '
/**
 * 006 site 48. An unclosed fence swallows EVERYTHING after it to the end of the reply, and
 * `stripFencedCode` recorded that fact in a local called `announced` and then wrote `void
 * announced`. The listener heard "a code block is omitted" and had no way to know the rest of the
 * answer went with it — which is materially different from a normal, closed code block where the
 * prose after it is still read.
 */
const UNCLOSED_CODE_PLACEHOLDER =
  ' . Here, a code block is omitted, and the reply ends inside it, so anything after it was not read. '


export function normalize(md: string, opts: NormalizeOptions = {}): string {
  const codeBlocks = opts.codeBlocks ?? 'announce'
  const pathStyle = opts.pathStyle ?? 'spoken'
  const doNumbers = opts.expandNumbers ?? true

  let s = stripFencedCode(md, codeBlocks)
  s = stripInlineCode(s)
  s = expandMarkdownLinks(s)
  s = stripUrls(s)
  s = headingsToPauses(s)
  s = listItemsToSentences(s, opts.orderedLists ?? 'numeral')
  s = tablesToRows(s)
  if (pathStyle !== 'verbatim') s = speakFilePaths(s, pathStyle, opts.extensionStyle ?? 'word-last')
  s = stripMarkdownMarkers(s)
  s = speakKeyGlyphs(s)
  s = stripEmoji(s)
  if (doNumbers) { s = expandUnits(s); s = expandNumbers(s) }
  s = collapseWhitespace(s)
  s = tidyPunctuation(s)

  // "." or "," alone would be spoken as "period" / "comma". Say nothing instead.
  return s.length <= 1 ? '' : s
}

/* ---------------------------------------------------------------- stage 1 */

function isFence(line: string): boolean {
  const t = line.trimStart()
  return t.startsWith('```') || t.startsWith('~~~')
}

function stripFencedCode(src: string, policy: CodeBlockPolicy): string {
  const out: string[] = []
  const lines = src.split('\n')
  let inFence = false
  let announced = false

  for (const line of lines) {
    if (isFence(line)) {
      if (!inFence) {
        inFence = true
        announced = false
        if (policy === 'announce') { out.push(CODE_PLACEHOLDER); announced = true }
      } else {
        inFence = false
      }
      continue
    }
    if (!inFence) out.push(line)
  }
  // Site 48: `void announced` — the fact was computed and discarded. An unclosed fence means the
  // rest of the reply is gone too, so say the honest sentence instead of the ordinary one.
  if (inFence && announced) {
    const at = out.lastIndexOf(CODE_PLACEHOLDER)
    if (at !== -1) out[at] = UNCLOSED_CODE_PLACEHOLDER
  } else if (inFence && policy !== 'announce') {
    // Nothing was announced at all, and the remainder of the reply has still vanished.
    out.push(UNCLOSED_CODE_PLACEHOLDER)
  }
  return out.join('\n')
}

/* ---------------------------------------------------------------- stage 2 */

function stripInlineCode(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '`') {
      const close = src.indexOf('`', i + 1)
      if (close === -1) { out += src.slice(i + 1); break }   // unclosed: emit remainder as-is
      out += src.slice(i + 1, close)
      i = close + 1
      continue
    }
    out += ch
    i++
  }
  return out
}

/* ---------------------------------------------------------------- stage 3 */

/**
 * `[label](url)` -> `label`, plus the destination when the label does not already give it away.
 *
 * 006 site 51: the destination was dropped SILENTLY, while a bare URL in the same reply is
 * announced ("a link to github dot com"). The asymmetry is the defect — the listener's own
 * recorded feedback on this project is that URLs vanishing without warning was a problem, and a
 * markdown link is the form agents actually emit.
 *
 * The judgement, stated: reading every destination would be narration, which is its own harm. So
 * the host is spoken only when the label does not already contain it. `[github.com](https://github.com)`
 * says it once; `[click here](https://evil.example)` — the case where the loss actually matters —
 * says both. Runs before bare-URL stripping so the label survives.
 */
function expandMarkdownLinks(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    if (src[i] === '[') {
      const close = src.indexOf('](', i)
      if (close !== -1) {
        const end = src.indexOf(')', close + 2)
        if (end !== -1) {
          const label = src.slice(i + 1, close)
          const url = src.slice(close + 2, end)
          out += label + linkSuffix(label, url)
          i = end + 1
          continue
        }
      }
    }
    out += src[i]
    i++
  }
  return out
}

/** '' when the label already names the destination, otherwise ", a link to example dot com". */
function linkSuffix(label: string, url: string): string {
  const host = (url.replace(/^https?:\/\//, '').split('/')[0] ?? '').replace(/^www\./, '')
  if (host.length === 0 || !host.includes('.')) return ''        // relative link, anchor, mailto
  if (label.toLowerCase().includes(host.toLowerCase())) return ''
  return `, ${linkPhrase(url)},`
}

/** "a link to github dot com" beats "link omitted": the destination is usually the point. */
function linkPhrase(url: string): string {
  const afterScheme = url.replace(/^https?:\/\//, '')
  const host = (afterScheme.split('/')[0] ?? '').replace(/^www\./, '')
  if (host.length === 0) return 'a link'
  return `a link to ${host.split('.').join(' dot ')}`
}

const URL_TERMINATORS = new Set([')', ']', '"', "'", '<', '>'])
const TRAILING_PUNCT = new Set(['.', ',', '!', '?', ';', ':'])

function stripUrls(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    if (rest.startsWith('http://') || rest.startsWith('https://')) {
      let j = i
      while (j < src.length) {
        const c = src[j] as string
        if (c === ' ' || c === '\n' || c === '\t' || URL_TERMINATORS.has(c)) break
        j++
      }
      // Give back trailing sentence punctuation — it belongs to the sentence, not the URL,
      // and downstream sentence splitting depends on it.
      let end = j
      while (end > i && TRAILING_PUNCT.has(src[end - 1] as string)) end--
      out += linkPhrase(src.slice(i, end))
      i = end
      continue
    }
    out += src[i]
    i++
  }
  return out
}

/* ---------------------------------------------------------------- stages 4-6 */

const TERMINAL = new Set(['.', '!', '?'])

function endWithStop(text: string): string {
  const t = text.trimEnd()
  if (t.length === 0) return ''
  return TERMINAL.has(t[t.length - 1] as string) ? t : `${t}.`
}

function headingsToPauses(src: string): string {
  return src.split('\n').map((line) => {
    const t = line.trimStart()
    if (!t.startsWith('#')) return line
    let k = 0
    while (k < t.length && t[k] === '#') k++
    if (k > 6 || t[k] !== ' ') return line          // `#tag` / `C#` are not headings
    return endWithStop(t.slice(k + 1))
  }).join('\n')
}

/** Ordinals worth a word. Past this, the numeral is clearer than "twenty-seventh". */
const ORDINAL_WORDS = [
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
  'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth',
  'eighteenth', 'nineteenth', 'twentieth'
]

function ordinalWord(n: number): string {
  return ORDINAL_WORDS[n - 1] ?? `number ${n}`
}

interface ListMarker {
  /** Characters to strip from the front of the trimmed line. 0 means "not a list item". */
  readonly length: number
  /** The ordinal, when the marker was `12. `. `null` for bullets. */
  readonly ordinal: number | null
}

function listMarker(t: string): ListMarker {
  if (t.startsWith('- ') || t.startsWith('* ') || t.startsWith('+ ')) return { length: 2, ordinal: null }
  let k = 0
  while (k < t.length && t[k]! >= '0' && t[k]! <= '9') k++
  if (k > 0 && t[k] === '.' && t[k + 1] === ' ') {
    return { length: k + 2, ordinal: Number.parseInt(t.slice(0, k), 10) }
  }
  return { length: 0, ordinal: null }
}

function listItemsToSentences(src: string, ordered: OrderedListStyle): string {
  return src.split('\n').map((line) => {
    const t = line.trimStart()
    const { length, ordinal } = listMarker(t)
    if (length === 0) return line
    const body = t.slice(length)
    if (ordinal === null || ordered === 'drop') return endWithStop(body)
    const lead = ordered === 'word' ? ordinalWord(ordinal) : String(ordinal)
    return endWithStop(`${lead}, ${body}`)
  }).join('\n')
}

function isTableSeparator(cells: string[]): boolean {
  return cells.every((c) => c.length > 0 && /^[:\-\s]+$/.test(c))
}

/**
 * Tables are announced by row, and every value is PAIRED WITH ITS HEADER.
 * Reading bare cells is unusable aloud: by row three the listener has lost which column is which.
 */
function tablesToRows(src: string): string {
  const out: string[] = []
  let headers: string[] | null = null
  let inTable = false

  for (const line of src.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('|')) {
      headers = null
      inTable = false
      out.push(line)
      continue
    }
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    if (isTableSeparator(cells)) continue          // `| --- | --- |` is layout, not content

    if (!inTable) {
      inTable = true
      headers = cells
      out.push(endWithStop(`Table. ${cells.filter((c) => c.length > 0).join(', ')}`))
      continue
    }

    const first = cells[0] ?? ''
    const rest: string[] = []
    for (let i = 1; i < cells.length; i++) {
      const value = cells[i] ?? ''
      if (value.length === 0) continue
      const header = headers?.[i]
      rest.push(header !== undefined && header.length > 0 ? `${header}, ${value}` : value)
    }
    out.push(endWithStop(rest.length === 0 ? first : `${first}. ${rest.join('. ')}`))
  }
  return out.join('\n')
}

/* ---------------------------------------------------------------- stage 7 */

const WORD_BREAK = new Set([' ', '\n', '\t'])

/** `session_handler` -> `session handler`. Identifiers read as words, not as spelling. */
function humanise(text: string): string {
  return text.split('_').join(' ').split('-').join(' ')
}

/**
 * `src/core/session_handler.py` -> `file named session handler, python, in folder src core`.
 *
 * Three rules, all from listening:
 *  - **Announce that a file name is coming.** "the python file X" was reported as "not heads up
 *    enough" — the listener is already mid-name before realising it is a name.
 *  - **Kind goes last.** Leading with it was "garbled noise": it means nothing until you know what
 *    is being named. Configurable via `extensionStyle`.
 *  - **Announce the directory too.** Bare "in src core" was "hard to understand where the files
 *    are"; "in folder" gives the same beat of warning the name gets.
 */
function speakFilePaths(src: string, style: PathStyle, extStyle: ExtensionStyle): string {
  const tokens: string[] = []
  let cur = ''
  for (const ch of src) {
    if (WORD_BREAK.has(ch)) { tokens.push(cur, ch); cur = '' } else cur += ch
  }
  tokens.push(cur)

  return tokens.map((raw) => {
    if (raw.length === 0 || WORD_BREAK.has(raw)) return raw

    // Sentence punctuation clings to the token: "index.ts," and "handler.py." would otherwise be
    // parsed as extensions "ts," and "py.", producing "dot ts," and swallowing the full stop that
    // ends the sentence. Split it off and put it back afterwards.
    let tok = raw
    let trailing = ''
    while (tok.length > 0 && TRAILING_PUNCT.has(tok[tok.length - 1] as string)) {
      trailing = (tok[tok.length - 1] as string) + trailing
      tok = tok.slice(0, -1)
    }
    if (tok.length === 0) return raw
    if (!tok.includes('/')) return raw

    const slash = tok.lastIndexOf('/')
    const base = tok.slice(slash + 1)
    const dir = tok.slice(0, slash)
    if (base.length === 0 || dir.length === 0) return raw
    const dot = base.lastIndexOf('.')
    if (dot <= 0 || dot === base.length - 1) return raw   // not a file reference
    const stem = humanise(base.slice(0, dot))
    const ext = base.slice(dot + 1).toLowerCase()
    if (!/^[a-z0-9]+$/.test(ext)) return raw
    const kindWord = EXTENSION_WORDS[ext] ?? `dot ${ext}`
    const folder = `in folder ${humanise(dir.split('/').join(' '))}`

    // Only add our own comma when the source did not already end the clause for us.
    const tail = trailing.length > 0 ? trailing : ','

    if (style === 'terse') return `${stem}, ${folder}${tail}`

    switch (extStyle) {
      case 'omit':
        return `file named ${stem}, ${folder}${tail}`
      case 'word-first':
        return `${kindWord} file named ${stem}, ${folder}${tail}`
      case 'raw-last':
        return `file named ${stem}, dot ${ext}, ${folder}${tail}`
      default:
        return `file named ${stem}, ${kindWord}, ${folder}${tail}`
    }
  }).join('')
}

/* ---------------------------------------------------------------- stage 8 */

function isBoundaryBefore(prev: string | undefined): boolean {
  return prev === undefined || WORD_BREAK.has(prev) || prev === '(' || prev === '"'
}

function isBoundaryAfter(next: string | undefined): boolean {
  return next === undefined || WORD_BREAK.has(next) || TRAILING_PUNCT.has(next) || next === ')' || next === '"'
}

/**
 * `**bold**` and `~~strike~~` markers are deleted outright.
 *
 * Single `*` / `_` are deleted only as a MATCHED PAIR that wraps a word, so `snake_case`,
 * `a_b_c` and — critically — a leading-underscore identifier like `_flush_buffer` all survive.
 *
 * Pairing is the whole point. An earlier version stripped any underscore that merely *looked*
 * like an opener, which silently turned `_private_method` into `private_method`: a lone opener
 * with no partner. Python privates are everywhere in agent replies, so this mattered.
 *
 * DELIBERATE DEVIATION from buzz: `__dunder__` is PRESERVED. buzz strips `__x__` as bold, but it
 * is lexically indistinguishable from a dunder, and mangling `__init__` is worse than reading two
 * underscores in the rarer `__bold__`.
 */
function stripMarkdownMarkers(src: string): string {
  let s = src.split('**').join('')
  s = s.split('~~').join('')

  const chars = [...s]
  const drop = new Set<number>()

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] as string
    if (ch !== '*' && ch !== '_') continue
    if (drop.has(i)) continue
    if (ch === '_' && (chars[i + 1] === '_' || chars[i - 1] === '_')) continue   // dunder
    const opens = isBoundaryBefore(chars[i - 1]) && !isBoundaryAfter(chars[i + 1])
    if (!opens) continue

    // Only strip if a matching closer exists before the next line break.
    for (let j = i + 1; j < chars.length; j++) {
      const c = chars[j] as string
      if (c === '\n') break
      if (c !== ch) continue
      if (ch === '_' && (chars[j + 1] === '_' || chars[j - 1] === '_')) continue
      const closes = !isBoundaryBefore(chars[j - 1]) && isBoundaryAfter(chars[j + 1])
      if (closes) { drop.add(i); drop.add(j); break }
    }
  }

  return chars.filter((_, i) => !drop.has(i)).join('')
}

/* ---------------------------------------------------------------- stage 9 */

function isEmoji(cp: number): boolean {
  return (
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x1f000 && cp <= 0x1f0ff) ||
    cp === 0x200d ||                       // ZWJ
    (cp >= 0xfe00 && cp <= 0xfe0f) ||      // variation selectors
    cp === 0x20e3                          // keycap
  )
}

function stripEmoji(src: string): string {
  let out = ''
  for (const ch of src) {
    const cp = ch.codePointAt(0)
    if (cp !== undefined && isEmoji(cp)) continue
    out += ch
  }
  return out
}

/* ---------------------------------------------------------------- stage 10 */

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function under100(n: number): string {
  if (n < 20) return ONES[n] as string
  const t = TENS[Math.floor(n / 10)] as string
  const r = n % 10
  return r === 0 ? t : `${t} ${ONES[r] as string}`
}

function under1000(n: number): string {
  if (n < 100) return under100(n)
  const h = `${ONES[Math.floor(n / 100)] as string} hundred`
  const r = n % 100
  return r === 0 ? h : `${h} ${under100(r)}`
}

/** 0..999999 to words. Larger numbers are left for the engine, which handles them better. */
export function numberToWords(n: number): string {
  if (n < 1000) return under1000(n)
  const th = Math.floor(n / 1000)
  const r = n % 1000
  const head = `${under1000(th)} thousand`
  return r === 0 ? head : `${head} ${under1000(r)}`
}

function spokenTime(h: number, m: number): string {
  const hh = under100(h)
  if (m === 0) return hh
  if (m < 10) return `${hh} oh ${ONES[m] as string}`
  return `${hh} ${under100(m)}`
}

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9'
}

function expandNumbers(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    if (!isDigit(src[i])) { out += src[i]; i++; continue }

    let j = i
    while (isDigit(src[j])) j++
    const digits = src.slice(i, j)

    // HH:MM
    if (src[j] === ':' && isDigit(src[j + 1])) {
      let k = j + 1
      while (isDigit(src[k])) k++
      const mins = src.slice(j + 1, k)
      const h = Number(digits)
      const m = Number(mins)
      if (mins.length === 2 && h < 24 && m < 60) { out += spokenTime(h, m); i = k; continue }
    }

    // Decimals go to the engine untouched — and the WHOLE decimal must be consumed here,
    // or the fractional part gets re-scanned and expanded ("3.14" -> "3.fourteen").
    if (src[j] === '.' && isDigit(src[j + 1])) {
      let k = j + 1
      while (isDigit(src[k])) k++
      out += src.slice(i, k)
      i = k
      continue
    }

    // "#42" is a reference, not a quantity. Speak the numerals.
    if (src[i - 1] === '#') { out += digits; i = j; continue }

    const value = Number(digits)
    if (value >= 1_000_000 || digits.length > 6) { out += digits; i = j; continue }

    out += numberToWords(value)
    i = j
  }
  return out
}

/** "52 ms" -> "52 milliseconds", before numbers become words. Only after a number. */
function expandUnits(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    if (!isDigit(src[i])) { out += src[i]; i++; continue }
    let j = i
    while (isDigit(src[j]) || src[j] === '.') j++
    const numeral = src.slice(i, j)

    let k = j
    if (src[k] === ' ') k++
    let u = k
    while (u < src.length && /[A-Za-z%°]/.test(src[u] as string)) u++
    const unitRaw = src.slice(k, u)
    const unit = unitRaw.toLowerCase()
    const boundaryOk = u >= src.length || !/[A-Za-z0-9]/.test(src[u] as string)

    if (boundaryOk && (unit === '%' || unitRaw === '%')) {
      out += `${numeral} percent`; i = u; continue
    }
    const words = UNIT_WORDS[unit]
    if (boundaryOk && words !== undefined) {
      const plural = Number(numeral) === 1 ? words[0] : words[1]
      out += `${numeral} ${plural}`; i = u; continue
    }
    out += numeral
    i = j
  }
  return out
}

/** `⌘⇧S` -> `command shift S`. Otherwise the glyphs reach the engine as garbage. */
function speakKeyGlyphs(src: string): string {
  let out = ''
  for (const ch of src) {
    const word = KEY_GLYPHS[ch]
    out += word === undefined ? ch : `${word} `
  }
  return out
}

/**
 * The lead-in placeholders start with a sentence break so the engine pauses before them. When the
 * surrounding text already ended in punctuation that produces "Fix it: . Here," — a stutter.
 * Collapse any doubled terminator down to the stronger one.
 */
function tidyPunctuation(src: string): string {
  // Runs AFTER whitespace collapse, so spacing is single and these rewrites are deterministic.
  let out = src.split(' .').join('.')                 // a space before a full stop is never wanted
  for (const lead of [':', ',', ';', '.', '!', '?']) {
    out = out.split(`${lead}.`).join(lead)            // ":." -> ":" etc
  }
  if (out.startsWith('. ')) out = out.slice(2)        // a leading break has nothing to separate
  if (out.startsWith('.')) out = out.slice(1)
  return out.trim()
}

/* ---------------------------------------------------------------- stage 11 */

function collapseWhitespace(src: string): string {
  let out = ''
  let pendingSpace = false
  for (const ch of src) {
    if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') { pendingSpace = out.length > 0; continue }
    if (pendingSpace) { out += ' '; pendingSpace = false }
    out += ch
  }
  return out
}
