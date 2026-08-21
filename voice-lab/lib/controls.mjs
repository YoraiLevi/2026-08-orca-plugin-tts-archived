// The control inventory — 46 controls, six panels, from docs/design/004-voice-lab.md section 6.
//
// Counted against 004: Panel A 7 (rows 1-7) · B 7 (8-14) · C 9 (15-23) · D 4 (24-27) ·
// E 9 (28-35, 44) · F 10 (36-43, 45, 46) = 46. The wireframe's footer says "46 controls".
//
// `settingsId` is the dotted id this control becomes in the settings file
// (docs/design/011-settings.md section 3.1, `<owner>.<name>`). `wire` is the exact property the
// value becomes on the object the consumer receives, or null for DESIGNED BUT NOT WIRED
// (011 section 3.1) — nine controls are wired today and the rest are countable gaps, not lies.
//
// This module is inlined verbatim into index.html; voice-lab/lib/inline.test.mjs fails if the
// two copies drift.

export const STAGES = [
  'stripFencedCode', 'stripHtmlComments', 'stripInlineCode', 'expandMarkdownLinks', 'stripUrls',
  'headingsToPauses', 'listItemsToSentences', 'tablesToRows', 'speakFilePaths',
  'stripMarkdownMarkers', 'speakKeyGlyphs', 'stripEmoji', 'expandUnits', 'expandNumbers',
  'collapseWhitespace', 'tidyPunctuation'
]

// Stages nothing in the control surface governs. 004 section 6 "What is deliberately absent":
// the listener sees these in the ladder marked "fixed by design", so a decision that was MADE
// is never mistaken for one that was overlooked.
//
// 004 disagrees with itself about stage 9, and this list resolves it. Section 4's ladder wireframe
// uses `stripMarkdownMarkers` as the canonical "fixed by design" example, while rows 22 and 23 of
// section 6 both name "stages 2 + 9" (now 3 + 10) in their Feeds column — and section 6 goes on to say WHY:
// "stage 9" (now 10) "keeps [underscores] intact so that [ident.style] can" decide what one sounds like.
// A stage that two controls feed is not a stage with no control, so 10 is not on this list. The
// ladder still renders "no change" for it on any fixture it did not touch, which is what the
// wireframe was actually showing.
export const FIXED_BY_DESIGN_STAGES = [2, 4, 11, 15, 16]
// J21 added stage 2, `stripHtmlComments`, and it joins this list: no control governs it,
// because whether an HTML comment is spoken is not taste. The other four are the old
// 3/10/14/15 renumbered by that insert.

export const PANELS = [
  { id: 'A', key: 'omit', title: 'What gets left out', short: 'WHAT GETS LEFT OUT' },
  { id: 'B', key: 'struct', title: 'How structure is spoken', short: 'STRUCTURE' },
  { id: 'C', key: 'path', title: 'Names, paths and identifiers', short: 'NAMES & PATHS' },
  { id: 'D', key: 'num', title: 'Numbers and units', short: 'NUMBERS' },
  { id: 'E', key: 'voice', title: 'Voice and pacing', short: 'VOICE & PACING' },
  { id: 'F', key: 'runtime', title: 'What interrupts what, and what gets announced', short: 'INTERRUPTIONS' }
]

const sel = (values) => ({ kind: 'enum', values })

export const CONTROLS = [
  // ── Panel A — what gets left out, and how you are told ────────────────────────────────
  { row: 1, id: 'omit.codeBlocks', panel: 'A', tier: 'common', tag: 'EI', stages: [1],
    label: 'How a code block is handled', help: 'Whether an omitted code block is announced or dropped in silence.',
    ...sel(['announce', 'drop']), words: { announce: 'announced', drop: 'dropped in silence' },
    default: 'announce', owner: 'normalize', settingsId: 'normalize.codeBlocks', wire: 'NormalizeOptions.codeBlocks' },
  { row: 2, id: 'omit.codeBlockPhrase', panel: 'A', tier: 'common', tag: 'EI', stages: [1],
    label: 'What a code block is called', help: 'The sentence spoken in place of a code block. {lang} and {lines} are filled in.',
    kind: 'template', maxLength: 120, default: ' . Here, a code block is omitted. ',
    owner: 'announce', settingsId: 'announce.codeBlockPhrase', wire: null },
  { row: 3, id: 'omit.codeBlockDetail', panel: 'A', tier: 'more', tag: 'EI', stages: [1],
    label: 'What a code block tells you', help: 'Whether the language and the line count are named in the announcement.',
    kind: 'multi', values: ['language', 'lineCount'], words: { language: 'the language', lineCount: 'the line count' },
    default: [], owner: 'normalize', settingsId: 'normalize.codeBlockDetail', wire: null },
  { row: 4, id: 'omit.inlineCode', panel: 'A', tier: 'more', tag: 'EI', stages: [3],
    label: 'How inline code is said', help: 'Backticked code inside a sentence: stripped to its text, read verbatim, or announced.',
    ...sel(['strip', 'verbatim', 'announce']), words: { strip: 'stripped', verbatim: 'read as written', announce: 'announced' },
    default: 'strip', owner: 'normalize', settingsId: 'normalize.inlineCode', wire: null },
  { row: 5, id: 'omit.urls', panel: 'A', tier: 'common', tag: 'EI', stages: [5],
    label: 'How a link is said', help: 'What you hear where a URL was. A link that vanishes with no signal is the loss this control exists for.',
    ...sel(['host-phrase', 'host-and-path', 'label-only', 'drop-silent']),
    words: { 'host-phrase': 'the host, in a phrase', 'host-and-path': 'the host and the path', 'label-only': 'the link text only', 'drop-silent': 'dropped in silence' },
    default: 'host-phrase', owner: 'normalize', settingsId: 'normalize.urls', wire: null },
  { row: 6, id: 'omit.urlPhrase', panel: 'A', tier: 'more', tag: 'EI', stages: [5],
    label: 'What a link is called', help: 'The phrase spoken for a link. {host} and {path} are filled in.',
    kind: 'template', maxLength: 120, default: 'a link to {host}',
    owner: 'announce', settingsId: 'announce.urlPhrase', wire: null },
  { row: 7, id: 'omit.emoji', panel: 'A', tier: 'common', tag: 'EI', stages: [12],
    label: 'How an emoji is handled', help: 'Emoji vanish with no signal today, while code blocks and links get one. Same loss, opposite treatment.',
    ...sel(['silent', 'announce-count', 'name']),
    words: { silent: 'dropped in silence', 'announce-count': 'counted aloud', name: 'named' },
    default: 'silent', owner: 'normalize', settingsId: 'normalize.emoji', wire: null },

  // ── Panel B — how structure is spoken ─────────────────────────────────────────────────
  { row: 8, id: 'struct.headingCue', panel: 'B', tier: 'common', tag: 'EI', stages: [6],
    label: 'How a heading is marked', help: 'All six heading levels collapse to nothing today.',
    ...sel(['none', 'level-word', 'prefix-word', 'pause-only']),
    words: { none: 'not marked', 'level-word': 'named by level', 'prefix-word': 'given a prefix word', 'pause-only': 'a pause only' },
    default: 'none', owner: 'normalize', settingsId: 'normalize.headingCue', wire: null },
  { row: 9, id: 'struct.headingPauseMs', panel: 'B', tier: 'more', tag: 'EP', stages: [6],
    label: 'How long a heading pauses', help: 'Milliseconds, never "comma versus full stop" — a number survives the arrival of SSML; a punctuation mark does not.',
    kind: 'int', range: { min: 0, max: 1500, step: 50 }, unit: 'ms', default: 0,
    owner: 'unassigned', settingsId: 'normalize.headingPauseMs', wire: null },
  { row: 10, id: 'struct.orderedLists', panel: 'B', tier: 'common', tag: 'EI', stages: [7],
    label: 'How a numbered list is said', help: 'A numbered item can keep its numeral, become an ordinal word, or lose its number.',
    ...sel(['numeral', 'word', 'drop']),
    words: { numeral: 'by numeral, one, alpha', word: 'by word, first, alpha', drop: 'without the number' },
    default: 'numeral', owner: 'normalize', settingsId: 'normalize.orderedLists', wire: 'NormalizeOptions.orderedLists' },
  { row: 11, id: 'struct.bulletMarker', panel: 'B', tier: 'more', tag: 'EI', stages: [7],
    label: 'How a bullet is said', help: 'Whether a bullet marker is dropped or spoken as "item".',
    ...sel(['drop', 'say-item']), words: { drop: 'dropped', 'say-item': 'spoken as item' },
    default: 'drop', owner: 'normalize', settingsId: 'normalize.bulletMarker', wire: null },
  { row: 12, id: 'struct.tableLeadIn', panel: 'B', tier: 'more', tag: 'EI', stages: [8],
    label: 'What a table is called', help: 'The lead-in sentence spoken before a table.',
    kind: 'template', maxLength: 60, default: 'Table.',
    owner: 'announce', settingsId: 'announce.tableLeadIn', wire: null },
  { row: 13, id: 'struct.tableHeaderRepeat', panel: 'B', tier: 'common', tag: 'EI', stages: [8],
    label: 'How often a table header repeats', help: 'Table rows were "too quick, not obvious what I am hearing" until every value carried its header.',
    ...sel(['every-cell', 'row-start', 'first-row-only', 'never']),
    words: { 'every-cell': 'with every value', 'row-start': 'once a row', 'first-row-only': 'in the first row only', never: 'never' },
    default: 'every-cell', owner: 'normalize', settingsId: 'normalize.tableHeaderRepeat', wire: null },
  { row: 14, id: 'struct.tableFirstCellHeader', panel: 'B', tier: 'more', tag: 'EI', stages: [8],
    label: 'Whether the first cell is a header', help: 'Treat the leading cell of each row as that row\'s name rather than a bare value.',
    kind: 'bool', default: false, words: { true: 'treated as a header', false: 'spoken bare' },
    owner: 'normalize', settingsId: 'normalize.tableFirstCellHeader', wire: null },

  // ── Panel C — names, paths and identifiers ────────────────────────────────────────────
  { row: 15, id: 'path.style', panel: 'C', tier: 'common', tag: 'EI', stages: [9],
    label: 'How a path is said', help: 'Paths "made no sense whatsoever" read raw. This is the shape of the repair.',
    ...sel(['spoken', 'terse', 'verbatim']),
    words: { spoken: 'spoken in full', terse: 'terse', verbatim: 'read as written' },
    default: 'spoken', owner: 'normalize', settingsId: 'normalize.pathStyle', wire: 'NormalizeOptions.pathStyle' },
  { row: 16, id: 'path.extensionStyle', panel: 'C', tier: 'common', tag: 'EI', stages: [9],
    label: 'Where the file kind goes', help: 'The file kind was "garbled noise" in front of the name, and wanted to come last.',
    ...sel(['word-last', 'word-first', 'raw-last', 'omit']),
    words: { 'word-last': 'kind last, as a word', 'word-first': 'kind first, as a word', 'raw-last': 'kind last, as written', omit: 'not said at all' },
    default: 'word-last', owner: 'normalize', settingsId: 'normalize.extensionStyle', wire: 'NormalizeOptions.extensionStyle' },
  { row: 17, id: 'path.namePhrase', panel: 'C', tier: 'more', tag: 'EI', stages: [9],
    label: 'What a file is called', help: 'The phrase that introduces a file name. {name} is filled in.',
    kind: 'template', maxLength: 60, default: 'file named {name}',
    owner: 'announce', settingsId: 'announce.pathNamePhrase', wire: null },
  { row: 18, id: 'path.folderPhrase', panel: 'C', tier: 'more', tag: 'EI', stages: [9],
    label: 'What a folder is called', help: 'The phrase that introduces the folders. {folders} is filled in.',
    kind: 'template', maxLength: 60, default: 'in folder {folders}',
    owner: 'announce', settingsId: 'announce.pathFolderPhrase', wire: null },
  { row: 19, id: 'path.depthPolicy', panel: 'C', tier: 'common', tag: 'EI', stages: [9],
    label: 'How much of the folder', help: 'Four folders of flat word list, and by the third you have lost the first. This is Q41\'s option space; which one is the default is yours.',
    ...sel(['full', 'last-n', 'first-n', 'filename-only', 'filename-then-location', 'elide-middle']),
    words: { full: 'the whole path', 'last-n': 'the last folders', 'first-n': 'the first folders', 'filename-only': 'the file name only', 'filename-then-location': 'the name, then where it is', 'elide-middle': 'the ends, with the middle elided' },
    default: 'full', owner: 'normalize', settingsId: 'normalize.pathDepthPolicy', wire: null },
  { row: 20, id: 'path.depthN', panel: 'C', tier: 'common', tag: 'EI', stages: [9],
    label: 'How many folders', help: 'How many folders the policy above keeps.',
    kind: 'int', range: { min: 1, max: 8, step: 1 }, unit: 'folders', default: 2,
    owner: 'normalize', settingsId: 'normalize.pathDepthN', wire: null },
  { row: 21, id: 'path.extensionWords', panel: 'C', tier: 'more', tag: 'EI', stages: [9],
    label: 'What each file kind is called', help: 'The suffix-to-word table. An unknown suffix is spelled out.',
    kind: 'map', default: {}, owner: 'normalize', settingsId: 'normalize.extensionWords', wire: null },
  { row: 22, id: 'ident.style', panel: 'C', tier: 'common', tag: 'EI', stages: [3, 10],
    label: 'How an identifier is said', help: 'Underscore flush underscore buffer is spoken raw today. This is Q39\'s option space; the default is yours.',
    ...sel(['verbatim', 'underscore-pause', 'split-words', 'split-and-announce', 'spell-leading-underscore']),
    words: { verbatim: 'as written', 'underscore-pause': 'with a pause at each underscore', 'split-words': 'as separate words', 'split-and-announce': 'as words, announced as a function', 'spell-leading-underscore': 'with the leading underscore spoken' },
    default: 'verbatim', owner: 'normalize', settingsId: 'normalize.identStyle', wire: null },
  { row: 23, id: 'ident.parens', panel: 'C', tier: 'more', tag: 'EI', stages: [3, 10],
    label: 'How a call\'s brackets are said', help: 'What happens to the parentheses after a function name.',
    ...sel(['keep', 'drop', 'say-call']), words: { keep: 'kept', drop: 'dropped', 'say-call': 'spoken as a call to' },
    default: 'keep', owner: 'normalize', settingsId: 'normalize.identParens', wire: null },

  // ── Panel D — numbers and units ──────────────────────────────────────────────────────
  { row: 24, id: 'num.expandIntegers', panel: 'D', tier: 'common', tag: 'EI', stages: [14],
    label: 'Whether numbers become words', help: 'One flag gates both this and units today, so "fifty two milliseconds" with numeral-shaped counts is unreachable. Split here.',
    kind: 'bool', default: true, words: { true: 'spoken as words', false: 'left as numerals' },
    owner: 'normalize', settingsId: 'normalize.expandIntegers', wire: 'NormalizeOptions.expandNumbers' },
  { row: 25, id: 'num.expandUnits', panel: 'D', tier: 'common', tag: 'EI', stages: [13],
    label: 'Whether units become words', help: '"52 ms was odd to hear" — units are expanded before the number.',
    kind: 'bool', default: true, words: { true: 'spoken as words', false: 'left as symbols' },
    owner: 'normalize', settingsId: 'normalize.expandUnits', wire: null },
  { row: 26, id: 'num.unitWords', panel: 'D', tier: 'more', tag: 'EI', stages: [13],
    label: 'What each unit is called', help: 'The symbol-to-word table for units.',
    kind: 'map', default: {}, owner: 'normalize', settingsId: 'normalize.unitWords', wire: null },
  { row: 27, id: 'num.decimals', panel: 'D', tier: 'more', tag: 'EP', stages: [14],
    label: 'How a decimal is said', help: 'Hand three point one four to the engine, or say it in words.',
    ...sel(['engine', 'words']), words: { engine: 'left to the engine', words: 'spoken as words' },
    default: 'engine', owner: 'normalize', settingsId: 'normalize.decimals', wire: null },

  // ── Panel E — voice and pacing ───────────────────────────────────────────────────────
  { row: 28, id: 'voice.id', panel: 'E', tier: 'common', tag: 'EP', stages: [],
    label: 'Which voice', help: 'Filled in from the machine\'s own voice list. Never free text: an unknown name exits zero and silently substitutes the default.',
    kind: 'voice', default: null, owner: 'synthesize', settingsId: 'synthesize.voiceIndex', wire: 'SynthesizeOptions.voice' },
  { row: 29, id: 'voice.rate', panel: 'E', tier: 'common', tag: 'EP', stages: [],
    label: 'How fast', help: 'Speaking rate, as a multiple of the voice\'s own.',
    kind: 'float', range: { min: 0.5, max: 2.0, step: 0.05 }, unit: 'times', default: 1.0,
    owner: 'synthesize', settingsId: 'synthesize.rate', wire: 'SynthesizeOptions.rate' },
  { row: 30, id: 'voice.pitch', panel: 'E', tier: 'more', tag: 'EP', stages: [],
    label: 'How high', help: 'No field exists yet — this control renders and the schema carries it, so the gap stays countable.',
    kind: 'int', range: { min: -50, max: 50, step: 5 }, unit: 'steps', default: 0,
    owner: 'synthesize', settingsId: 'synthesize.pitch', wire: null },
  { row: 31, id: 'voice.volume', panel: 'E', tier: 'more', tag: 'EP', stages: [],
    label: 'How loud', help: 'No field exists yet — designed, not wired.',
    kind: 'int', range: { min: 0, max: 100, step: 5 }, unit: 'percent', default: 100,
    owner: 'synthesize', settingsId: 'synthesize.volume', wire: null },
  { row: 32, id: 'pace.chunkMaxUnits', panel: 'E', tier: 'common', tag: 'PP', stages: [],
    label: 'How long a chunk', help: 'How much text is synthesized at once. Judged today against a floor that changes.',
    kind: 'int', range: { min: 40, max: 600, step: 20 }, unit: 'characters', default: 200,
    owner: 'chunk', settingsId: 'chunk.maxUnits', wire: 'ChunkerOptions.maxUnits' },
  { row: 33, id: 'pace.isolateFirstSentence', panel: 'E', tier: 'more', tag: 'PP', stages: [],
    label: 'Whether the first sentence goes alone', help: 'Send sentence one on its own so the first audio arrives sooner.',
    kind: 'bool', default: true, words: { true: 'sent on its own', false: 'sent with the rest' },
    owner: 'chunk', settingsId: 'chunk.isolateFirstSentence', wire: 'ChunkerOptions.isolateFirstSentence' },
  { row: 34, id: 'pace.simulateChunkGapMs', panel: 'E', tier: 'common', tag: 'PP', stages: [],
    label: 'The gap between chunks', help: 'The lab has no gap; the shipped plugin has about nine hundred and fifty milliseconds of one. Hear either world.',
    kind: 'int', range: { min: 0, max: 1500, step: 50 }, unit: 'ms', default: 0,
    presets: [{ value: 0, label: 'no gap — where we are going' }, { value: 950, label: 'nine hundred and fifty — version one on this machine' }],
    owner: 'lab', settingsId: 'lab.simulateChunkGapMs', wire: null },
  { row: 35, id: 'pace.sentencePauseMs', panel: 'E', tier: 'more', tag: 'EP', stages: [],
    label: 'How long a sentence pauses', help: 'Milliseconds between sentences. In milliseconds so the number survives when SSML lands.',
    kind: 'int', range: { min: 0, max: 800, step: 25 }, unit: 'ms', default: 0,
    owner: 'unassigned', settingsId: 'normalize.sentencePauseMs', wire: null },
  { row: 44, id: 'pace.pauseBackend', panel: 'E', tier: 'common', tag: 'EP', stages: [],
    label: 'How a pause is written', help: 'Punctuation is the only one implemented; the others are here so the cost of SSML can be heard before it is paid.',
    ...sel(['punctuation', 'ssml', 'in-band']),
    words: { punctuation: 'as punctuation', ssml: 'as markup', 'in-band': 'as an in-band command' },
    default: 'punctuation', owner: 'unassigned', settingsId: 'synthesize.pauseBackend', wire: null },

  // ── Panel F — what interrupts what, and what gets announced ───────────────────────────
  { row: 36, id: 'queue.maxQueued', panel: 'F', tier: 'common', tag: 'EI', stages: [],
    label: 'How many replies wait', help: 'Twenty queued replies is roughly three minutes of unrequested speech. Eight is what you have been living with.',
    kind: 'int', range: { min: 1, max: 20, step: 1 }, unit: 'replies', default: 8,
    owner: 'queue', settingsId: 'queue.maxQueued', wire: null },
  { row: 37, id: 'queue.overflowPolicy', panel: 'F', tier: 'more', tag: 'EI', stages: [],
    label: 'Which reply is dropped when full', help: 'Dropping the oldest silently was the third fault behind the session that hijacked your audio.',
    ...sel(['drop-oldest', 'drop-newest']), words: { 'drop-oldest': 'the oldest', 'drop-newest': 'the newest' },
    default: 'drop-oldest', owner: 'queue', settingsId: 'queue.overflowPolicy', wire: null },
  { row: 38, id: 'announce.mode', panel: 'F', tier: 'common', tag: 'EI', stages: [],
    label: 'Whether an announcement interrupts', help: 'Replace cuts off a reply in progress; queue waits for it.',
    ...sel(['replace', 'queue']), words: { replace: 'it interrupts', queue: 'it waits its turn' },
    default: 'replace', owner: 'queue', settingsId: 'queue.announceMode', wire: null },
  { row: 39, id: 'announce.sessionLabel', panel: 'F', tier: 'common', tag: 'EI', stages: [],
    label: 'How a session is named', help: 'Hex is not on this list, and that is deliberate: two designs call eight hex characters a non-answer to who is speaking.',
    ...sel(['call-sign', 'call-sign-plus-name', 'registry-name', 'branch', 'displayName']),
    words: { 'call-sign': 'by call sign', 'call-sign-plus-name': 'by call sign and name', 'registry-name': 'by its registry name', branch: 'by branch', displayName: 'by display name' },
    default: 'call-sign', owner: 'announce', settingsId: 'announce.sessionLabel', wire: null },
  { row: 40, id: 'announce.sessionLabelHashChars', panel: 'F', tier: 'more', tag: 'EI', stages: [],
    label: 'How many hex characters', help: 'Zero. The control exists only so you can say "none" and see that it was decided, not overlooked. Above zero, the lab warns you aloud, once.',
    kind: 'int', range: { min: 0, max: 8, step: 1 }, unit: 'characters', default: 0,
    warnAbove: 0, warning: 'Hex read aloud is close to the worst case this project has. Two designs call it a non-answer to who is speaking.',
    owner: 'lab', settingsId: 'lab.sessionLabelHashChars', wire: null },
  { row: 41, id: 'announce.switchPhrase', panel: 'F', tier: 'more', tag: 'EI', stages: [],
    label: 'What a session switch says', help: 'Spoken when the audio moves to another session. {label} is filled in.',
    kind: 'template', maxLength: 80, default: 'Now reading from {label}.',
    owner: 'announce', settingsId: 'announce.switchPhrase', wire: null },
  { row: 42, id: 'announce.statusTemplate', panel: 'F', tier: 'more', tag: 'EI', stages: [],
    label: 'What status says', help: 'The wording and order of the spoken status report.',
    kind: 'template', maxLength: 160, default: '{state}. {queued} waiting. Following {label}.',
    owner: 'announce', settingsId: 'announce.statusTemplate', wire: null },
  { row: 43, id: 'input.clipboardCap', panel: 'F', tier: 'more', tag: 'EI', stages: [],
    label: 'How much clipboard is read', help: 'Above this, the clipboard read is truncated and the truncation is announced.',
    kind: 'int', range: { min: 2000, max: 50000, step: 1000 }, unit: 'characters', default: 20000,
    owner: 'input', settingsId: 'input.clipboardCap', wire: null },
  { row: 46, id: 'input.huddleReplyCap', panel: 'F', tier: 'common', tag: 'EI', stages: [],
    label: 'How much of a reply is read', help: 'No cap exists at all today, and the reply queue counts replies, so one forty-thousand-character reply is thirty-three minutes and nothing can drop it.',
    kind: 'int', range: { min: 2000, max: 50000, step: 1000 }, unit: 'characters', default: 8000,
    owner: 'session', settingsId: 'session.huddleReplyCap', wire: null },
  { row: 45, id: 'interrupt.granularity', panel: 'F', tier: 'common', tag: 'EP', stages: [],
    label: 'How a stop lands', help: 'Cut now, finish the word first, or pause and keep the position.',
    ...sel(['immediate', 'at-word', 'pause-keeps-position']),
    words: { immediate: 'immediately', 'at-word': 'at the end of the word', 'pause-keeps-position': 'as a pause, keeping the place' },
    default: 'immediate', owner: 'unassigned', settingsId: 'synthesize.interruptGranularity', wire: null }
]

/** Which controls govern a given normalizer stage — the diff's "which knob do I turn" answer. */
export function controlsForStage (stageNumber) {
  return CONTROLS.filter((c) => c.stages.includes(stageNumber))
}

export function controlById (id) {
  return CONTROLS.find((c) => c.id === id) ?? null
}

export function defaultValues () {
  const out = {}
  for (const c of CONTROLS) out[c.id] = Array.isArray(c.default) ? c.default.slice() : c.default
  return out
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** Numbers as words. 004 section 8 rule 4: a value is a word, never a number alone. */
export function numberWords (n) {
  if (!Number.isFinite(n)) return String(n)
  if (n < 0) return 'minus ' + numberWords(-n)
  if (!Number.isInteger(n)) {
    const [w, f] = String(n).split('.')
    return numberWords(Number(w)) + ' point ' + f.split('').map((d) => ONES[Number(d)]).join(' ')
  }
  if (n <= 20) return ONES[n]
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '')
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numberWords(n % 100) : '')
  if (n < 1000000) {
    return numberWords(Math.floor(n / 1000)) + ' thousand' + (n % 1000 ? ' ' + numberWords(n % 1000) : '')
  }
  return String(n)
}

/**
 * What the page SAYS a value is. Never a bare number: `path.depthN` at 2 reads
 * "last two folders", not "2" (004 section 8 rule 4).
 */
export function speakValue (control, value) {
  if (control == null) return ''
  switch (control.kind) {
    case 'bool':
      return control.words?.[String(Boolean(value))] ?? (value ? 'on' : 'off')
    case 'enum':
      return control.words?.[value] ?? String(value)
    case 'multi': {
      const list = Array.isArray(value) ? value : []
      if (list.length === 0) return 'nothing'
      return list.map((v) => control.words?.[v] ?? v).join(' and ')
    }
    case 'int':
    case 'float': {
      const preset = control.presets?.find((p) => p.value === value)
      if (preset) return preset.label
      const n = numberWords(value)
      return control.unit ? `${n} ${control.unit}` : n
    }
    case 'template':
      return value === '' ? 'empty' : String(value).trim()
    case 'map':
      return `${numberWords(Object.keys(value ?? {}).length)} entries`
    case 'voice':
      return value == null ? 'the system default' : String(value.name ?? value)
    default:
      return String(value)
  }
}

/** "How much of the folder, the last folders" — control name, then value, nothing else. */
export function changeSentence (control, value) {
  return `${control.label}, ${speakValue(control, value)}.`
}

/** Step a control's value by one notch. Returns the new value, or the old one at the end. */
export function stepValue (control, value, direction) {
  switch (control.kind) {
    case 'bool':
      return direction > 0 ? true : false
    case 'enum': {
      const i = control.values.indexOf(value)
      const next = Math.min(control.values.length - 1, Math.max(0, i + direction))
      return control.values[next]
    }
    case 'multi': {
      const list = Array.isArray(value) ? value.slice() : []
      // One step cycles through the subsets in a stable order: none -> first -> both -> ...
      const all = control.values
      const idx = all.length === 0 ? 0 : list.length
      const next = Math.min(all.length, Math.max(0, idx + direction))
      return all.slice(0, next)
    }
    case 'int':
    case 'float': {
      const { min, max, step } = control.range
      const raw = Number(value) + direction * step
      const clamped = Math.min(max, Math.max(min, raw))
      // Float steps of 0.05 accumulate error; round to the step grid.
      const decimals = (String(step).split('.')[1] ?? '').length
      return Number(clamped.toFixed(decimals))
    }
    default:
      return value
  }
}
