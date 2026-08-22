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
 * `normalize()` composes SEVENTEEN stages, and the banner comments below number them by CALL order,
 * which is not this file's physical order — `speakKeyGlyphs` (12) and `tidyPunctuation` (17) sit
 * beside the number helpers because that is where they were written. The call list in
 * `normalize()` is the authority; `scripts/voice-lab.mjs` re-derives the ladder from these bytes
 * and refuses to start if the two disagree.
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
   * Expand unit symbols to words — "52 ms" -> "52 milliseconds". Default true.
   *
   * SEPARATE FROM `expandNumbers`, and that separation is the whole point of this field
   * (006 NM12 / section 22 SC-8). Until J26 these two stages shared one flag, so the Voice Lab
   * control `num.expandIntegers` — which declares stage 15, `expandNumbers` — also switched off
   * stage 14, `expandUnits`. A listener turning off "whether numbers become words" silently
   * re-broke "52 ms", which is the exact defect they had asked to have fixed, and the Lab showed
   * them a stage-14 row that moved for a reason no control on screen explained.
   *
   * A control that claims a stage it does not govern is a lie told to the person tuning by ear,
   * and tuning by ear is what the Voice Lab is for.
   */
  expandUnits?: boolean
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

/**
 * The runtime key list for `NormalizeOptions` — T124 (011 section 3.3 (a)).
 *
 * A TypeScript interface has no runtime representation, so a test that wants to iterate the
 * option surface needs a real array. The guard below makes that array a COMPILE-TIME obligation:
 * adding a field to `NormalizeOptions` without adding it here fails `tsc`, and T124 then fails at
 * runtime if the new key is not reachable from `SETTINGS_SCHEMA`. Both halves are needed — the
 * compile guard keeps this list honest, and the runtime test keeps the schema honest.
 */
export const NORMALIZE_OPTION_KEYS = [
  'codeBlocks', 'pathStyle', 'extensionStyle', 'expandNumbers', 'expandUnits', 'orderedLists'
] as const satisfies readonly (keyof NormalizeOptions)[]

type _MissingNormalizeKey =
  Exclude<keyof NormalizeOptions, (typeof NORMALIZE_OPTION_KEYS)[number]> extends never ? true : never
const _normalizeKeysAreExhaustive: _MissingNormalizeKey = true
void _normalizeKeysAreExhaustive

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


/**
 * "Is there a glyph here a synthesizer can turn into sound?" — a letter or a digit, any script.
 *
 * DELIBERATELY A LOCAL COPY of `packages/core/src/speakable.ts`, which is the same predicate and
 * is what the `Chunker` uses. It is copied rather than imported because this module's header
 * constraint is real and is enforced by effect: `normalize()` is loaded FROM SOURCE, as a plain
 * `.ts` file, by `scripts/voice-lab.mjs` and `scripts/ci/voice-lab-ci.mjs`, and by the data-URL
 * stage extractor the Voice Lab ladder is built from. A single `import` here fails all three with
 * `Cannot find module '.../speakable.js'` — verified, not assumed, while making this change.
 *
 * So the two copies are compared BY EFFECT instead of shared by reference: SC-1 in
 * `packages/core/src/seams/seam-contracts.test.ts` feeds real `normalize()` output to a THIRD,
 * independently restated version of this predicate. If any of the three drifts, that test goes
 * red. Two definitions that must agree is a check; one definition imported everywhere is not
 * (P36) — which is the reason this duplication is a mechanism rather than debt.
 */
const SPEAKABLE_GLYPH = /[\p{L}\p{N}]/u

function hasSpeakableGlyph(text: string): boolean {
  return SPEAKABLE_GLYPH.test(text)
}

export function normalize(md: string, opts: NormalizeOptions = {}): string {
  const codeBlocks = opts.codeBlocks ?? 'announce'
  const pathStyle = opts.pathStyle ?? 'spoken'
  const doNumbers = opts.expandNumbers ?? true
  const doUnits = opts.expandUnits ?? true

  let s = stripFencedCode(md, codeBlocks)
  s = stripHtmlComments(s)
  s = diagramsToLabels(s)
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
  // One `if` per stage, because one `if` for two stages is what SC-8 was. Stage 14 then stage 15:
  // units must be words BEFORE the numeral becomes one, or "52 ms" is "fifty two m s".
  if (doUnits) s = expandUnits(s)
  if (doNumbers) s = expandNumbers(s)
  s = collapseWhitespace(s)
  s = tidyPunctuation(s)

  /**
   * SC-1 (006 section 22, finding R8-07). This used to be `s.length <= 1 ? '' : s` — a LENGTH
   * test standing in for a SPEAKABILITY test. `normalize("...!!!???")` returns ".!!!???", length
   * 7, so the guard passed it; `SpeechService` then checks `spoken.length === 0`, so the 'empty'
   * outcome never fired, so the `unspeakable` loss sentence was never spoken. The listener was
   * told nothing and heard nothing, and a full synthesis round trip was spent producing the
   * nothing.
   *
   * Returning '' is what makes the loss AUDIBLE: it is the value `SpeechService` already reads as
   * 'empty', and 'empty' already has a sentence. The fix is one predicate, not a new channel.
   */
  return hasSpeakableGlyph(s) ? s : ''
}

/**
 * M14b — the agent-cooperating half of the spoken channel. NOT A STAGE, and deliberately not one.
 *
 * `normalize()` answers "how does this markdown SOUND". This answers "which PART of this reply did
 * the agent mean to be heard", which is a different question with a different owner: the choice
 * between the marker and the prose is a listener POLICY (D002 Q5 — `spoken-only`,
 * `spoken-then-prose`, `prose-only`, `agent-decides`) and belongs to whoever holds that setting,
 * not to a text transform. Wiring it into a stage would hard-code one of the four policies into
 * the pipeline and make the other three unreachable.
 *
 * It lives in this file rather than beside the transcript decoders for one reason: it must be pure
 * and import nothing, exactly like everything else here, so the Voice Lab can compile these bytes
 * as a standalone module (SC-13) and so the same function runs in a worker, a panel and a test.
 *
 * THE LOAD-BEARING PROPERTY, and the one to pin with a test — D002's own sentence:
 *
 *   > The extractor's absence-case must be the IDENTITY FUNCTION, and its presence-case must be
 *   > the only behaviour change.
 *
 * A reply with no marker — which is very nearly all of them, and will stay that way (D002
 * "Adoption reality") — must come out of here BYTE-IDENTICAL. `rest` is `md` itself in that case,
 * not a rebuilt copy that happens to match.
 */
export interface SpeakFence {
  /** The fence body, trimmed. `null` when the reply carries no usable `speak` fence. */
  readonly spoken: string | null
  /** The reply with that fence removed — and byte-identical to the input when there was none. */
  readonly rest: string
}

/**
 * Find the first ```speak fence and lift it out.
 *
 * FIRST, not last, and fences that are not ours are SKIPPED WHOLE rather than scanned through: a
 * reply that shows somebody how to write a `speak` block puts ` ```speak ` inside an outer fence,
 * and a scanner that did not track nesting would extract the example and speak it instead of the
 * answer. That is the "identifier carried in text" failure D002 warns about, one level down.
 *
 * An EMPTY fence is treated as absent, `rest` included: an agent that opened a marker and put
 * nothing in it has not asked for anything, and removing it would break the identity property for
 * no gain.
 */
export function extractSpeakFence(md: string): SpeakFence {
  const lines = md.split('\n')
  let open = -1
  for (let i = 0; i < lines.length; i++) {
    if (!isFence(lines[i] as string)) continue
    if (isSpeakFence(lines[i] as string)) { open = i; break }
    let j = i + 1
    while (j < lines.length && !isFence(lines[j] as string)) j++
    i = j
  }
  if (open === -1) return { spoken: null, rest: md }

  let close = open + 1
  while (close < lines.length && !isFence(lines[close] as string)) close++
  const body = lines.slice(open + 1, close).join('\n').trim()
  if (body.length === 0) return { spoken: null, rest: md }
  return {
    spoken: body,
    rest: [...lines.slice(0, open), ...lines.slice(Math.min(close + 1, lines.length))].join('\n')
  }
}

/* ---------------------------------------------------------------- stage 1 */

function isFence(line: string): boolean {
  const t = line.trimStart()
  return t.startsWith('```') || t.startsWith('~~~')
}

/** The info string of a fence line: ` ```speak also ` -> `'speak also'`. Never called on prose. */
function fenceInfo(line: string): string {
  const t = line.trimStart()
  return t.slice(3).trim().toLowerCase()
}

/**
 * M14b. A fence whose info string is `speak` is the agent SPEAKING, not the agent showing code.
 *
 * The immediate correctness fix D002 calls for, independent of the ladder above it: with the
 * default `codeBlocks: 'announce'`, an agent that cooperated with our own convention would have
 * been answered with *"Here, a code block is omitted."* — the disqualifying failure mode arriving
 * through the front door. So the info string is honoured UNCONDITIONALLY, whatever the policy: a
 * `speak` fence is never announced and its body is kept as ordinary prose.
 *
 * `speak also` / `speak replace` are accepted here too. This stage does not read the annotation —
 * choosing between the marker and the prose is the listener's policy and belongs above the
 * normalizer (D002 Q5) — but it must not mistake an annotated fence for a code block.
 */
function isSpeakFence(line: string): boolean {
  const info = fenceInfo(line)
  return info === 'speak' || info.startsWith('speak ')
}

function stripFencedCode(src: string, policy: CodeBlockPolicy): string {
  const out: string[] = []
  const lines = src.split('\n')
  let inFence = false
  let inSpeak = false
  let announced = false

  for (const line of lines) {
    if (isFence(line)) {
      if (inSpeak) { inSpeak = false; continue }
      if (!inFence) {
        // An UNCLOSED speak fence keeps everything to the end of the reply, so there is nothing
        // to announce: D002 Q6 asked for "announced as truncated, never dropped", and keeping it
        // is strictly better than either — nothing was truncated.
        if (isSpeakFence(line)) { inSpeak = true; continue }
        inFence = true
        announced = false
        if (policy === 'announce') { out.push(CODE_PLACEHOLDER); announced = true }
      } else {
        inFence = false
      }
      continue
    }
    if (inSpeak) { out.push(line); continue }
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

/**
 * `<!-- ... -->` is removed outright. It is markup the author wrote FOR A READER OF THE SOURCE,
 * and a listener is not that reader.
 *
 * Today, with no such stage, every one of the six committed fixtures opens by speaking its own
 * provenance comment — and worse than speaking it, mangling it: the chunker's first utterance is
 * the two characters `"<!"`, because `stripMarkdownMarkers` has already eaten the `--` as a
 * strikethrough-adjacent run and the sentence splitter falls into the wreckage. The listener's
 * first audio of a reply is a stray glyph.
 *
 * WHY POSITION 2 — after `stripFencedCode`, before everything else. Two constraints pin it:
 *
 *  1. **After stage 1.** A fenced code block may legitimately CONTAIN `<!--` as its subject —
 *     any reply that shows someone how to write an HTML comment does exactly that. Running here
 *     means stage 1 has already replaced that fence with its placeholder, so the `<!--` inside it
 *     no longer exists and cannot be matched. Running BEFORE stage 1 would reach into the fence
 *     and delete from inside it, and — far worse — an unterminated `<!--` inside a code sample
 *     would consume the fence's own closing ``` and merge the code block with the prose after it.
 *     Ordering does the work here that a special case would otherwise have to.
 *
 *  2. **Before `stripMarkdownMarkers` (now stage 11) and before the chunker.** `--` inside a
 *     comment must never be offered to the marker stripper, and `<!` must never reach the
 *     chunker — that pair is what produced the two-character first utterance.
 *
 *  Position 2 is then simply the EARLIEST slot that satisfies both, and earliest is what you want
 *  for a delete-everything stage: every later stage gets to assume comments are already gone.
 *
 *  ONE CLAIM DELIBERATELY NOT MADE. It is tempting to argue this must also precede
 *  `stripInlineCode` (stage 4), because `fixtures/code-heavy.md` writes backticks inside its
 *  opening comment and stage 4 pairs backticks positionally. That argument is WRONG and is
 *  recorded here so nobody re-derives it: stage 4 UNWRAPS, it never deletes — a mispaired span
 *  still emits its content, and its unclosed branch emits the remainder verbatim. Both orders were
 *  run against the six fixtures and against probes built to break them, and they produce identical
 *  text. `normalize.test.ts` keeps a labelled CONTROL for that, not a proof.
 *
 * WHAT AN UNTERMINATED `<!--` DOES — it drops the four marker characters and SPEAKS THE REST.
 * It does not swallow to end-of-document, and it is not announced.
 *
 * That is deliberately the OPPOSITE of `stripFencedCode`'s unclosed-fence rule, and the asymmetry
 * is the argument. An unclosed fence has an announcement already in flight ("a code block is
 * omitted"), and its content is code, which policy says is not spoken anyway — so the honest move
 * there is to widen the announcement. Here the content after a stray `<!--` is ORDINARY PROSE that
 * was going to be spoken, and `<!--` is a sequence that occurs in innocent prose about markup (it
 * occurs in this repository's own documentation). Losing an entire reply to one stray token is the
 * catastrophic failure for a listener who cannot see what went missing; losing a four-character
 * marker is not a loss at all. Nothing is announced because nothing was omitted — an announcement
 * on every truncated reply would be narration, and R030's "never fail silently" is about content
 * the listener LOST, not about characters that were never content.
 *
 * Removal preserves the comment's LINE COUNT — a multi-line comment becomes its own newlines, a
 * single-line comment becomes one space. Stages 7, 8 and 9 (`headingsToPauses`,
 * `listItemsToSentences`, `tablesToRows`) are line-oriented and run after this one, so collapsing
 * `text <!-- c\n--> ## Heading` to one line would silently destroy a heading. A space, not the
 * empty string, for the single-line case: `a<!--x-->b` must not become the word `ab`.
 */
function stripHtmlComments(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const open = src.indexOf('<!--', i)
    if (open === -1) { out += src.slice(i); break }
    out += src.slice(i, open)
    const close = src.indexOf('-->', open + 4)
    if (close === -1) { out += src.slice(open + 4); break }   // unterminated: keep the prose
    const newlines = src.slice(open, close + 3).split('\n').length - 1
    out += newlines > 0 ? '\n'.repeat(newlines) : ' '
    i = close + 3
  }
  return out
}

/* ---------------------------------------------------------------- stage 3 */

/**
 * A box-drawing diagram is replaced by ONE sentence that NAMES WHAT IT WAS ABOUT.
 *
 * Design 002's motivating case, and the worst listening experience this product produces. Today
 * `fixtures/hostile.md`'s pipeline diagram reaches the engine intact and the listener hears a few
 * hundred box characters where the explanation should be — measured before this stage existed:
 *
 *   "...look at: ┌──────────────┐ ┌───────────────┐ ... │ transcript │ ──▶ │ normalizer │ ..."
 *
 * DROPPING IT IS THE EASY HALF. P30 is the hard half: a loss the listener cannot see must be named
 * IN THE AUDIO, and "a diagram was skipped" is nearly useless while reading forty cells aloud is
 * the harm it was supposed to prevent. So the split this stage makes is:
 *
 *   the box characters are the diagram's GEOMETRY — unspeakable, and dropped;
 *   the text inside the boxes is its NOUNS — speakable, and kept.
 *
 * A linear audio stream cannot carry geometry at all, so nothing is lost by dropping it that could
 * have been delivered. The nouns are the only part that survives linearisation, they cost one
 * sentence, and they are what tells the listener whether the picture was worth asking about. On
 * the motivating fixture that is:
 *
 *   "Here, a diagram is omitted. It is labelled: transcript watcher, normalizer (17 stages),
 *    synthesizer (Piper), barge-in."
 *
 * Four judgements, each of which could have gone the other way:
 *
 *  1. **The frame is CODE_PLACEHOLDER's frame** — " . Here, a X is omitted. ", its own sentence so
 *     the engine pauses either side. The listener has already learned that cue for a loss; a
 *     second grammar would make this loss LESS recognisable, not more.
 *  2. **The kind is named** ("a diagram"), so the listener knows which SHAPE of information went —
 *     relationships and layout — rather than only that something did.
 *  3. **The labels are BOUNDED at six, and the cap is announced** ("and 9 more"). The listening
 *     report already records four-column table rows as punishing; six short noun phrases is about
 *     one breath. An announcement that buries the reply is the failure it exists to prevent, and
 *     one that hides its own truncation is the failure buzz's "... message truncated" fixes.
 *  4. **Labels are merged DOWN COLUMNS, not read line by line.** A box is two lines of one label;
 *     read line-wise the fixture says "transcript, normalizer, synthesizer, watcher, 17 stages,
 *     Piper", which scrambles three boxes into six fragments. Merging by overlapping column span
 *     recovers "transcript watcher" as one thing, which is what it is.
 *
 * WHY POSITION 3 — after `stripHtmlComments`, before `stripInlineCode`. Four constraints pin it:
 *
 *  1. **After stage 1.** A fenced block may legitimately CONTAIN a diagram as its subject; stage 1
 *     has already replaced that fence, so its box characters no longer exist. Running earlier
 *     would reach inside a fence and announce a diagram the listener was never going to hear.
 *  2. **After stage 2.** A diagram inside an HTML comment is not content — stage 2's whole
 *     argument — and announcing it would be narration about markup addressed to a reader of the
 *     source. Announcing beats silence only for things the listener LOST.
 *  3. **Before every line-oriented stage (6, 7, 8) and before `collapseWhitespace` (16).** This
 *     stage reads COLUMNS. Once whitespace collapses there are no columns, and once
 *     `listItemsToSentences` has run a diagram line beginning `- ` has grown a full stop.
 *  4. **Before `speakKeyGlyphs` (12).** `↑ ↓ ← →` are spoken as words there. Inside a diagram they
 *     are plumbing, not content, and turning them into words first would leave "right" scattered
 *     through the labels.
 *
 * It cannot be `tablesToRows`' job: that stage reads `|` pipe tables, this one reads none, and a
 * Voice Lab row that ran two transforms would be a control map that lies (SC-8).
 */

/**
 * Box drawing (U+2500-257F) and block elements (U+2580-259F): the marks a diagram is DRAWN with.
 * Deliberately narrow. This set decides whether a line is art at all, and every glyph in it is one
 * a human writes only to draw with.
 */
const LINE_ART = /[\u2500-\u259f]/gu

/**
 * What separates one label from the next INSIDE a run already judged to be art. Wider than
 * `LINE_ART` on purpose: geometric shapes (U+25A0-25FF — the `▶` of `──▶`) and arrows
 * (U+2190-21FF) are far too common in prose to make a line a diagram, but once a run IS one they
 * are its plumbing and never part of a label.
 */
const ART_SEPARATOR = /[\u2500-\u25ff\u2190-\u21ff]/u

/**
 * Two, not one. One box glyph is a sentence ABOUT box glyphs — "the `└` character" — and a rule
 * that ate that line would be worse than the defect. Every line of the motivating diagram, down to
 * the two lone `│` of its barge-in arm, carries at least two.
 */
const ART_LINE_MIN_GLYPHS = 2

/**
 * Six labels, then a count. Taste, and therefore the listener's (Q47) — but the EXISTENCE of a cap
 * is correctness, so the number lives here until Voice Lab gives it a control.
 */
const MAX_SPOKEN_LABELS = 6

const DIAGRAM_UNLABELLED = ' . Here, a diagram is omitted. It has no labels to read. '

function artGlyphCount(line: string): number {
  return (line.match(LINE_ART) ?? []).length
}

function wordGlyphCount(line: string): number {
  return (line.match(/[\p{L}\p{N}]/gu) ?? []).length
}

function isArtLine(line: string): boolean {
  return artGlyphCount(line) >= ART_LINE_MIN_GLYPHS
}

/** A piece of label text and the COLUMNS it occupied, which is what lets boxes be reassembled. */
interface ArtFragment { readonly text: string; readonly start: number; readonly end: number }

/** The text between the art glyphs of one line, each with its column span. */
function labelFragments(line: string): ArtFragment[] {
  const out: ArtFragment[] = []
  const push = (from: number, to: number): void => {
    const raw = line.slice(from, to)
    const text = raw.trim().replace(/\s+/g, ' ')
    if (text.length === 0) return
    out.push({
      text,
      start: from + (raw.length - raw.trimStart().length),
      end: to - (raw.length - raw.trimEnd().length)
    })
  }
  let start = 0
  for (let i = 0; i < line.length; i++) {
    if (ART_SEPARATOR.test(line[i] as string)) { push(start, i); start = i + 1 }
  }
  push(start, line.length)
  return out
}

interface LabelGroup { readonly parts: string[]; start: number; end: number }

/**
 * Fragments on consecutive lines whose column spans OVERLAP are one label. That is the whole of
 * the two-dimensional reading, and it is what turns three boxes into three names instead of six
 * fragments. The span compared is the PREVIOUS LINE's only, never the union: a group that widened
 * as it grew would eventually overlap everything and swallow the next box.
 */
function diagramLabels(run: readonly string[]): string[] {
  const groups: LabelGroup[] = []
  let openOnPrev: LabelGroup[] = []
  for (const line of run) {
    const opened: LabelGroup[] = []
    for (const f of labelFragments(line)) {
      const joined = openOnPrev.find((g) => f.start < g.end && g.start < f.end)
      if (joined === undefined) {
        const fresh: LabelGroup = { parts: [f.text], start: f.start, end: f.end }
        groups.push(fresh)
        opened.push(fresh)
        continue
      }
      joined.parts.push(f.text)
      if (opened.includes(joined)) {
        joined.start = Math.min(joined.start, f.start)
        joined.end = Math.max(joined.end, f.end)
      } else {
        joined.start = f.start
        joined.end = f.end
        opened.push(joined)
      }
    }
    openOnPrev = opened
  }
  return groups.map((g) => g.parts.join(' '))
}

function diagramPlaceholder(labels: readonly string[]): string {
  if (labels.length === 0) return DIAGRAM_UNLABELLED
  const named = labels.slice(0, MAX_SPOKEN_LABELS)
  const more = labels.length - named.length
  // The cap says so. An announcement that is itself silently partial is the defect one level up.
  const tail = more > 0 ? `, and ${more} more` : ''
  return ` . Here, a diagram is omitted. It is labelled: ${named.join(', ')}${tail}. `
}

function diagramsToLabels(src: string): string {
  const lines = src.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    if (!isArtLine(lines[i] as string)) { out.push(lines[i] as string); i++; continue }
    let j = i
    while (j < lines.length && isArtLine(lines[j] as string)) j++
    const run = lines.slice(i, j)
    i = j

    if (run.length === 1) {
      const only = run[0] as string
      // Mostly words: a sentence that MENTIONS box characters is prose, and prose is spoken.
      if (artGlyphCount(only) < wordGlyphCount(only)) { out.push(only); continue }
      // A lone unlabelled rule — `──────────` — is punctuation, and it is the one case removed in
      // silence. It carries no proposition, so "a diagram is omitted" would be narration about
      // layout: the same judgement `stripEmoji` makes for a party popper. Two or more lines with
      // no labels IS a picture, and is announced.
      if (diagramLabels(run).length === 0) continue
    }
    out.push(diagramPlaceholder(diagramLabels(run)))
  }
  return out.join('\n')
}

/* ---------------------------------------------------------------- stage 4 */

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

/* ---------------------------------------------------------------- stages 5-6 */

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

/* ---------------------------------------------------------------- stages 7-9 */

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

/* ---------------------------------------------------------------- stage 10 */

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

/* ---------------------------------------------------------------- stage 11 */

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

/* ---------------------------------------------------------------- stage 13 */

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

/* ---------------------------------------------------------------- stages 14-15 */

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

/**
 * 0..999999 to words. At or above a million the numeral is handed to the engine untouched.
 *
 * That ceiling is from M2 (`0f9335f`) and predates the thousands-separator work; it is NOT a
 * consequence of it. What it used to carry was the bare assertion "the engine handles them
 * better", which nobody had run. It has now been run, on macOS only:
 *
 *   `say -o <file>` (never the device — P31), then compare the rendered audio.
 *   `1234567` and `1,234,567` render to BYTE-IDENTICAL audio, 3.616 s `[measured-here]`, against
 *   3.707 s for the spelled-out words and 1.852 s for digit-by-digit — so `say` reads it as
 *   "one million two hundred thirty four thousand five hundred sixty seven", not as seven digits.
 *   `1000000`, `1,000,000` and the literal string `one million` render to the same checksum
 *   (`e0dc2573…`) `[measured-here]` — the same utterance, three ways of writing it.
 *   CONTROL: `one million and one` renders to a different checksum and 1.424 s, so the comparison
 *   can tell two strings apart and is not passing vacuously.
 *
 * Separators make no difference to `say` at all, which is why they are preserved on the way out
 * rather than stripped: above the ceiling the engine is the better reader either way.
 *
 * ESPEAK-NG IS NOW `[measured-here]` TOO — the paragraph above used to end by saying it was
 * `[claimed]` and that the same `-o file` comparison would settle it. It has been run, n=3,
 * byte-stable across runs, in a `node:24-bookworm` container with `espeak-ng` 1.51 installed
 * (aarch64; the CI runners are x86_64, and the probe now runs there too — `.github/workflows/ci.yml`,
 * "The million ceiling must hold on THIS platform's synthesizer"). The script is
 * `scripts/ci/number-ceiling-probe.mjs`; `pnpm probe:numbers` re-runs it.
 *
 *   `1234567` and `1,234,567` render to BYTE-IDENTICAL audio, 190,398 B `[measured-here]` (n=3),
 *   against 184,976 B for the spelled-out words and 100,974 B for digit-by-digit — so espeak-ng
 *   reads it as a NUMBER, not as seven digits. `espeak-ng -q -x` says so directly rather than by
 *   inference from a byte count:
 *     "1234567" → w'0n m'Ili@n_! t'u:h'VndrI2d@n T'3:ti f'o@ T'aUz@nd_! f'aIvh'VndrI2d@n s'Iksti s'Ev@n
 *   which is "one million, two hundred-and thirty four thousand, five hundred-and sixty seven" —
 *   the same number as ours, worded with British "and" and two phrase breaks. `1000000`,
 *   `1,000,000` and the literal `one million` all render to checksum `1488ab98` `[measured-here]`,
 *   with the control `one million and one` at `39922fc3`, so the comparison is not vacuous.
 *
 * **The ceiling is therefore NOT a Linux-only defect.** Both shipped engines read a bare numeral
 * above the ceiling as a number, and handing it over untouched is the right call on both.
 *
 * WINDOWS SAPI REMAINS `[claimed]` — no Windows machine was available to the agent that ran this,
 * and an x86_64 Windows container cannot be run on an aarch64 macOS host. The CI step above will
 * measure it on the `windows-latest` leg the first time the workflow runs; until that run exists,
 * nobody has measured SAPI and this comment must not say otherwise.
 *
 * Note on checksums, because the two macOS numbers in this comment DISAGREE. The paragraph above
 * records `e0dc2573` for `one million`; re-running it with the probe script gives `7d2c5386` at
 * `--data-format=LEI16@22050` and `f9784f29` at `say`'s default AIFF, n=3 each `[measured-here]`.
 * Neither reproduces `e0dc2573`, so the older sum was taken over something this script does not
 * reproduce — a different format, a different digest, or a different truncation; the run that
 * produced it was not recorded well enough to say which, and guessing would be worse than saying
 * so. **The VERDICT is unaffected** — it never depended on any absolute sum, only on which
 * renders match each other within one run — but treat a checksum here as meaningful only against
 * other sums from the same engine, format and digest.
 *
 * A second reason to distrust an absolute sum here, and this one is measured: **`say` DITHERS on
 * long strings.** Across pinned runs the 68-character spelled-out reference rendered to
 * 167,560 B every time, but to `00ce2944` on most runs and `ff96c9f4` on one — same length,
 * different bytes — while the short strings (`one million`, `1000000`) stayed sum-stable at
 * `7d2c5386` throughout `[measured-here]` (n=3 pinned at `47871d0`, plus n=5 ad hoc). So on
 * macOS the byte COUNT is the robust quantity for long utterances and the checksum is not. The
 * probe reports this per run as `STABLE` / `DITHERS` rather than averaging it away, and reaches
 * its verdict from lengths — using checksums only for within-run identity between two strings
 * rendered seconds apart.
 *
 * WHAT THE PROBE CAN NOW SAY, which is four things and not three: **absent** (exit 2, and a
 * missing espeak-ng COMMAND beside a present library is named as P25) · **words** (exit 0) ·
 * **digits** (exit 1) · **inconclusive** (exit 4). The last one exists because the verdict is
 * reached BY COMPARISON: if an engine's two reference renders do not separate, or if `1234567`
 * lands in the dead band between them, the honest answer is that the harness cannot tell — not
 * that the engine is acceptable. Both routes to it are demonstrated in CI against stub engines.
 * The separation is comfortable on both shipped engines: `1234567` sits at position **0.049** of
 * the way from the spelled-out reference to the digit-by-digit one on `say`, and **0.057** on
 * espeak-ng, against a dead band of 0.35–0.65 `[measured-here]` (n=3 each, noise floor 0 B).
 */
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

const LETTER = /\p{L}/u

function isLetter(c: string | undefined): boolean {
  return c !== undefined && LETTER.test(c)
}

/**
 * Is the '-' at `pos` a MINUS SIGN, or a hyphen doing some other job?
 *
 * SC-6 / 017 R8-21. A minus is only a minus when nothing word-like precedes it. That excludes the
 * three hyphens this repo actually writes: `UTF-8` and `sherpa-onnx-node` (letter before),
 * `10-20` and `p50-p99` (digit before), and a markdown horizontal rule `---` (another hyphen
 * before). What is left — start of text, after a space, after an opening bracket — is arithmetic.
 */
function isMinusSign(src: string, pos: number): boolean {
  if (src[pos] !== '-') return false
  const before = src[pos - 1]
  if (before === undefined) return true
  return before === ' ' || before === '\n' || before === '\t' || before === '(' || before === '['
}

function expandNumbers(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    if (!isDigit(src[i])) { out += src[i]; i++; continue }

    /**
     * SPEAK THE SIGN — SC-6 / 017 R8-21.
     *
     * The minus reached the engine as a bare hyphen, which macOS `say` renders as nothing or as a
     * short pause. So a regression of -42 ms and an improvement of 42 ms became the SAME sentence,
     * in a project whose entire subject is measured deltas. There is no ambiguity to warn about
     * and no way for the listener to recover it; the word has to be said.
     *
     * The '-' has already been copied to `out` by the loop above, so it is replaced rather than
     * skipped — which keeps this a rewrite of what was written, not a re-scan.
     */
    if (out.endsWith('-') && isMinusSign(src, i - 1)) {
      out = out.slice(0, -1) + 'minus '
    }

    let j = i
    while (isDigit(src[j])) j++

    /**
     * THOUSANDS SEPARATORS. `1,112` is ONE number, and reading it as two destroyed it twice over:
     * the digit scanner stopped at the comma, so the listener heard "one, one hundred twelve" —
     * and `2,017` was worse, because `Number('017')` is 17, so the group's leading zero vanished
     * and it was spoken as "two, seventeen". Neither is recoverable by ear. This is
     * `docs/.research/latency-measurements.md`'s own bracket, `p50 1,112-2,017 ms`, spoken back
     * to the author as nonsense.
     *
     * Only a WELL-FORMED group run is joined: 1-3 leading digits, then one or more groups of
     * EXACTLY three, and the run must not be followed by a further digit. That last condition is
     * what keeps the rule from mangling a comma-separated LIST of numbers — `1,1234` is not a
     * grouped number and stays two tokens, and so does `port 8080,1000` read as `8080` then
     * `1000`... which is exactly why the leading run is capped at three digits too: `8080,123`
     * must not become "eight million eighty thousand one hundred twenty three".
     */
    if (j - i <= 3) {
      let k = j
      while (
        src[k] === ',' && isDigit(src[k + 1]) && isDigit(src[k + 2]) && isDigit(src[k + 3]) &&
        !isDigit(src[k + 4])
      ) k += 4
      j = k
    }

    const raw = src.slice(i, j)
    const digits = raw.split(',').join('')

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
    if (src[i - 1] === '#') { out += raw; i = j; continue }

    /**
     * A digit run GLUED TO A LETTER is a label, not a quantity: `p50`, `T110d`, `P22`, `M9`,
     * `x86`. Expanding it fused the letter into the number word and destroyed both — `p50` was
     * spoken as "pfifty", `P22` as "Ptwenty two", `T110d` as "Tone hundred tend". The letter is
     * gone, the numeral is gone, and what is left is a plausible-sounding word that was never
     * written. 006 section 19 rank 5, found by `token-conservation.test.ts` against the committed
     * fixtures. Same judgement as the `#42` rule immediately above.
     */
    if (isLetter(src[i - 1])) { out += raw; i = j; continue }

    /**
     * A LEADING ZERO IS PART OF THE NUMBER — SC-6 / 017 R8-20.
     *
     * `Number("007")` is 7, so "Call 007 now" was spoken as "Call seven now": a DIFFERENT number
     * than was written, delivered with no announcement and no way for the listener to know. That
     * is the one failure this project ranks above not expanding at all, because an un-expanded
     * numeral is at worst awkward while a wrong numeral is undetectable by ear.
     *
     * A leading zero is never a quantity — it is an identifier, a zero-padded field, a code, a
     * flight number, a version segment. So the digits are spoken ONE BY ONE, which is both
     * faithful and how a person reads "007" aloud. `09:30` never reaches here: the HH:MM branch
     * above claims it first, and "oh nine thirty" is what a clock should sound like.
     */
    if (digits.length > 1 && digits.startsWith('0')) {
      out += [...digits].map((d) => ONES[Number(d)] as string).join(' ')
      i = j
      continue
    }

    const value = Number(digits)
    if (value >= 1_000_000 || digits.length > 6) { out += raw; i = j; continue }

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

/* ---------------------------------------------------------------- stage 12 */

/** `⌘⇧S` -> `command shift S`. Otherwise the glyphs reach the engine as garbage. */
function speakKeyGlyphs(src: string): string {
  let out = ''
  for (const ch of src) {
    const word = KEY_GLYPHS[ch]
    out += word === undefined ? ch : `${word} `
  }
  return out
}

/* ---------------------------------------------------------------- stage 17 */

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

/* ---------------------------------------------------------------- stage 16 */

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
