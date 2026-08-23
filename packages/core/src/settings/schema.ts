/**
 * The settings schema — T120, `docs/design/011-settings.md` section 3.
 *
 * ORCA renders no settings UI for plugins at all (011 section 1, Q35, upstream stablyai/orca#15655),
 * so THIS FILE IS THE SETTINGS SYSTEM and the Voice Lab is its editor. Every quality decision in
 * this project is a listener preference, and a preference that cannot be expressed is a preference
 * that does not exist.
 *
 * Three rules this module exists to enforce, each of which has already bitten:
 *
 * 1. **A default is a data field here and nowhere else** (T122). `main.ts:152` said `maxQueued: 8`
 *    while `speech-service.ts` said `20`; two "defaults" for one control, neither from a schema.
 * 2. **Taste is marked, never hidden** (`provisional`, PITFALLS **P23**). When the listener settles
 *    a value by ear in Voice Lab, the change must be a one-line data edit here — not a code change,
 *    not a test rewrite.
 * 3. **`wire: null` means DESIGNED, NOT WIRED** (PITFALLS **P26**). A field that a consumer reads
 *    today has a `wire`. The rest record their value and must be able to SAY that nothing consumes
 *    them yet. Modelling that once, here, is what stops the lab and the plugin from disagreeing
 *    about which is which.
 *
 * DEPENDENCY-FREE, like the normalizer beside it: this module imports nothing but its own sibling
 * types, so it runs identically in a plugin worker, a browser page, a local server and a test.
 */

import type { NormalizeOptions } from '../normalizer/index.ts'
import type { ChunkerOptions } from '../chunker/index.ts'
import type { SynthesizeOptions } from '../types/index.ts'

/**
 * 011 section 4.2: starts at 2, not 1. Version 1 is BURNED — 004 published `schemaVersion: 1`
 * describing a schema missing `orderedLists` and persisting a voice *name* (P28). Two incompatible
 * files both claiming version 1 is the one thing a version number exists to prevent.
 */
export const SCHEMA_VERSION = 2 as const

/**
 * Ownership, not presentation. The Voice Lab's six panels are a VIEW; this is the structure.
 * Every field id is `<owner>.<name>` and the schema asserts it.
 */
export type Owner =
  | 'normalize'   // -> NormalizeOptions   (packages/core/src/normalizer/index.ts)
  | 'chunk'       // -> ChunkerOptions     (packages/core/src/chunker/index.ts)
  | 'synthesize'  // -> SynthesizeOptions  (packages/core/src/types/index.ts)
  | 'queue'       // -> SpeechService queue
  | 'announce'    // -> spoken wording: phrases, labels, status, the settings report itself
  | 'session'     // -> HuddleController
  | 'input'       // -> clipboard / hotkey / talk path
  | 'apply'       // -> 011 section 2.4: how a settings change lands
  | 'lab'         // -> the Voice Lab only. The plugin NEVER reads these.

/** When a change to this field is observable. 011 section 2.3. */
export type Effect = 'utterance' | 'immediate' | 'session' | 'lab-only'

/**
 * Control kinds.
 *
 * 011 section 3.1 lists six (`enum` `bool` `int` `float` `string` `template`). The Voice Lab's
 * shipped inventory (`voice-lab/lib/controls.mjs`) additionally renders `multi`, `map` and `voice`,
 * and the lab is the consumer, so the union carries all of them. Recorded as a schema/design
 * disagreement in `docs/.research/settings-schema-report.md`.
 */
export type FieldKind =
  | 'enum' | 'bool' | 'int' | 'float' | 'string' | 'template'
  | 'multi' | 'map' | 'voice'

export interface FieldRange {
  readonly min: number
  readonly max: number
  readonly step: number
}

export interface FieldDescriptor<T = unknown> {
  /** Dotted, unique, stable FOREVER. Renaming is forbidden (011 section 4.2): a new meaning is a new id. */
  readonly id: string
  readonly owner: Owner
  /** Which Voice Lab panel renders it — presentation, not ownership. 'A'..'F' per the lab. */
  readonly panel: string
  /** Spoken and written. One short noun phrase. */
  readonly label: string
  /** One sentence. Becomes the generated comment in the starter file (011 section 6). */
  readonly help: string
  readonly kind: FieldKind
  /** Legal values, for `enum` and `multi`. */
  readonly values?: readonly T[]
  readonly range?: FieldRange
  /** For `int`/`float`: what the number counts, spoken. 004 section 8 rule 4. */
  readonly unit?: string
  readonly default: T
  /**
   * TASTE. `true` means: this value was chosen so the plugin would run, and NOBODY HAS HEARD IT
   * AND DECIDED (P23). Changing it is then a data edit, not a design decision.
   */
  readonly provisional: boolean
  /** Why this default. REQUIRED when `provisional` is false — a settled default has a reason. */
  readonly rationale?: string
  readonly effect: Effect
  /** 004's `EP`: engine-dependent, does not transfer across platform or provider (P28). */
  readonly enginePersonal: boolean
  /**
   * The exact property this value becomes, on the exact object the consumer receives.
   *
   * `null` means DESIGNED BUT NOT WIRED — the control renders, the schema carries the value, the
   * file persists it, and T124 excludes it from the reachability assertion while COUNTING it in
   * the gap report. A `wire: null` descriptor is how the gap stays countable instead of invisible.
   */
  readonly wire: string | null
  /** The `schemaVersion` in which this id first appeared. `> SCHEMA_VERSION` means reserved. */
  readonly since: number
  readonly deprecated?: { readonly since: number; readonly replacedBy?: string; readonly note: string }
}

/**
 * Reserved envelope keys in the ORCA KV mirror (011 section 1.2). No field id may start with this,
 * and `schema.test.ts` asserts it — otherwise a settings id could shadow `__revision` and the
 * mirror would lose its ordering primitive.
 */
export const RESERVED_KEY_PREFIX = '__'

export const MIRROR_ENVELOPE_KEYS = {
  revision: '__revision',
  schemaVersion: '__schemaVersion',
  writtenAt: '__writtenAt'
} as const

/** 011 section 6, R7-32: the stat-poll interval beside `fs.watch`. A constant, not a setting. */
export const SETTINGS_POLL_MS = 2_000

const d = (x: FieldDescriptor<unknown>): FieldDescriptor => x

/**
 * The schema. 48 fields at `SCHEMA_VERSION = 2`, plus 11 reserved at `since: 3` (011 section 4.2a).
 *
 * Grouped by OWNER, in owner order, because ownership is the structure. The starter-file generator
 * emits banner comments in this order, which is where the grouping becomes visible to a human.
 */
export const SETTINGS_SCHEMA: Readonly<Record<string, FieldDescriptor>> = {

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // normalize — NormalizeOptions. 23 fields, 5 wired. Read at speech-service.ts's normalize().
  // ─────────────────────────────────────────────────────────────────────────────────────────

  'normalize.codeBlocks': d({
    id: 'normalize.codeBlocks', owner: 'normalize', panel: 'A',
    label: 'How a code block is handled',
    help: 'Whether an omitted code block is announced or dropped in silence.',
    kind: 'enum', values: ['announce', 'drop'], default: 'announce',
    provisional: true, effect: 'utterance', enginePersonal: false,
    wire: 'NormalizeOptions.codeBlocks', since: 2
  }),
  'normalize.codeBlockDetail': d({
    id: 'normalize.codeBlockDetail', owner: 'normalize', panel: 'A',
    label: 'What a code block tells you',
    help: 'Whether the language and the line count are named in the announcement.',
    kind: 'multi', values: ['language', 'lineCount'], default: [],
    provisional: true, effect: 'utterance', enginePersonal: false, wire: null, since: 2
  }),
  'normalize.inlineCode': d({
    id: 'normalize.inlineCode', owner: 'normalize', panel: 'A',
    label: 'How inline code is said',
    help: 'Backticked code inside a sentence: stripped to its text, read verbatim, or announced.',
    kind: 'enum', values: ['strip', 'verbatim', 'announce'], default: 'strip',
    provisional: true, effect: 'utterance', enginePersonal: false, wire: null, since: 2
  }),
  'normalize.urls': d({
    id: 'normalize.urls', owner: 'normalize', panel: 'A',
    label: 'How a link is said',
    help: 'What you hear where a URL was. A link that vanishes with no signal is the loss this control exists for.',
    kind: 'enum', values: ['host-phrase', 'host-and-path', 'label-only', 'drop-silent'],
    default: 'host-phrase',
    provisional: true, effect: 'utterance', enginePersonal: false, wire: null, since: 2
  }),
  'normalize.emoji': d({
    id: 'normalize.emoji', owner: 'normalize', panel: 'A',
    label: 'How an emoji is handled',
    help: 'Emoji vanish with no signal today, while code blocks and links get one. Same loss, opposite treatment.',
    kind: 'enum', values: ['silent', 'announce-count', 'name'], default: 'silent',
    provisional: true, effect: 'utterance', enginePersonal: false, wire: null, since: 2
  }),
  'normalize.headingCue': d({
    id: 'normalize.headingCue', owner: 'normalize', panel: 'B',
    label: 'How a heading is marked',
    help: 'All six heading levels collapse to nothing today.',
    kind: 'enum', values: ['none', 'level-word', 'prefix-word', 'pause-only'], default: 'none',
    provisional: true, effect: 'utterance', enginePersonal: false, wire: null, since: 2
  }),
  'normalize.headingPauseMs': d({
    id: 'normalize.headingPauseMs', owner: 'normalize', panel: 'B',
    label: 'How long a heading pauses',
    help: 'Milliseconds, never "comma versus full stop" — a number survives the arrival of SSML; a punctuation mark does not.',
    kind: 'int', range: { min: 0, max: 1500, step: 50 }, unit: 'ms', default: 0,
    provisional: true,
    // 011 section 3.2 "unassigned": blocked behind the single provider-seam change C-05, so a
    // change here cannot land mid-session even once a consumer exists.
    effect: 'session', enginePersonal: true, wire: null, since: 2
  }),
  'normalize.orderedLists': d({
    id: 'normalize.orderedLists', owner: 'normalize', panel: 'B',
    label: 'How a numbered list is said',
    help: 'A numbered item can keep its numeral, become an ordinal word, or lose its number.',
    kind: 'enum', values: ['numeral', 'word', 'drop'], default: 'numeral',
    provisional: false,
    rationale: 'Settled, not taste: dropping the ordinal (v1 behaviour) makes a numbered procedure indistinguishable from a bullet list. 002 spec row 10, "shipped, not provisional".',
    effect: 'utterance', enginePersonal: false,
    wire: 'NormalizeOptions.orderedLists', since: 2
  }),
  'normalize.bulletMarker': d({
    id: 'normalize.bulletMarker', owner: 'normalize', panel: 'B',
    label: 'How a bullet is said',
    help: 'Whether a bullet marker is dropped or spoken as "item".',
    kind: 'enum', values: ['drop', 'say-item'], default: 'drop',
    provisional: true, effect: 'utterance', enginePersonal: false, wire: null, since: 2
  }),
  'normalize.tableHeaderRepeat': d({
    id: 'normalize.tableHeaderRepeat', owner: 'normalize', panel: 'B',
    label: 'How often a table header repeats',
    help: 'Table rows were "too quick, not obvious what I am hearing" until every value carried its header.',
    kind: 'enum', values: ['every-cell', 'row-start', 'first-row-only', 'never'], default: 'every-cell',
    provisional: true, effect: 'utterance', enginePersonal: false, wire: null, since: 2
  }),
  'normalize.tableFirstCellHeader': d({
    id: 'normalize.tableFirstCellHeader', owner: 'normalize', panel: 'B',
    label: 'Whether the first cell is a header',
    help: "Treat the leading cell of each row as that row's name rather than a bare value.",
    kind: 'bool', default: false,
    provisional: true, effect: 'utterance', enginePersonal: false, wire: null, since: 2
  }),
  'normalize.pathStyle': d({
    id: 'normalize.pathStyle', owner: 'normalize', panel: 'C',
    label: 'How a path is said',
    help: 'Paths "made no sense whatsoever" read raw. This is the shape of the repair.',
    kind: 'enum', values: ['spoken', 'terse', 'verbatim'], default: 'spoken',
    provisional: true, effect: 'utterance', enginePersonal: false,
    wire: 'NormalizeOptions.pathStyle', since: 2
  }),
  'normalize.extensionStyle': d({
    id: 'normalize.extensionStyle', owner: 'normalize', panel: 'C',
    label: 'Where the file kind goes',
    help: 'The file kind was "garbled noise" in front of the name, and wanted to come last.',
    kind: 'enum', values: ['word-last', 'word-first', 'raw-last', 'omit'], default: 'word-last',
    provisional: true, effect: 'utterance', enginePersonal: false,
    wire: 'NormalizeOptions.extensionStyle', since: 2
  }),
  'normalize.pathDepthPolicy': d({
    id: 'normalize.pathDepthPolicy', owner: 'normalize', panel: 'C',
    label: 'How much of the folder',
    help: "Four folders of flat word list, and by the third you have lost the first. This is Q41's option space; which one is the default is yours.",
    kind: 'enum',
    values: ['full', 'last-n', 'first-n', 'filename-only', 'filename-then-location', 'elide-middle'],
    default: 'full',
    provisional: true, effect: 'utterance', enginePersonal: false, wire: null, since: 2
  }),
  'normalize.pathDepthN': d({
    id: 'normalize.pathDepthN', owner: 'normalize', panel: 'C',
    label: 'How many folders',
    help: 'How many folders the policy above keeps.',
    kind: 'int', range: { min: 1, max: 8, step: 1 }, unit: 'folders', default: 2,
    provisional: true, effect: 'utterance', enginePersonal: false, wire: null, since: 2
  }),
  'normalize.extensionWords': d({
    id: 'normalize.extensionWords', owner: 'normalize', panel: 'C',
    label: 'What each file kind is called',
    help: 'The suffix-to-word table. An unknown suffix is spelled out.',
    kind: 'map', default: {} as Readonly<Record<string, string>>,
    provisional: true, effect: 'utterance', enginePersonal: false, wire: null, since: 2
  }),
  'normalize.identStyle': d({
    id: 'normalize.identStyle', owner: 'normalize', panel: 'C',
    label: 'How an identifier is said',
    help: "Underscore flush underscore buffer is spoken raw today. This is Q39's option space; the default is yours.",
    kind: 'enum',
    values: ['verbatim', 'underscore-pause', 'split-words', 'split-and-announce', 'spell-leading-underscore'],
    default: 'verbatim',
    provisional: true, effect: 'utterance', enginePersonal: false, wire: null, since: 2
  }),
  'normalize.identParens': d({
    id: 'normalize.identParens', owner: 'normalize', panel: 'C',
    label: "How a call's brackets are said",
    help: 'What happens to the parentheses after a function name.',
    kind: 'enum', values: ['keep', 'drop', 'say-call'], default: 'keep',
    provisional: true, effect: 'utterance', enginePersonal: false, wire: null, since: 2
  }),
  'normalize.expandIntegers': d({
    id: 'normalize.expandIntegers', owner: 'normalize', panel: 'D',
    label: 'Whether numbers become words',
    help: 'Whether a numeral becomes words. Units are a separate switch — turning this off leaves "52 milliseconds".',
    kind: 'bool', default: true,
    provisional: true, effect: 'utterance', enginePersonal: false,
    // FR-017 used to read: "this and `normalize.expandUnits` are two controls over ONE field
    // today. This id owns the wire; the other is `wire: null`." That WAS the SC-8 defect (006
    // NM12): this control declares stage 14 and also governed stage 13. J26 split the normalizer
    // flag, so each id now owns its own wire and its own stage.
    wire: 'NormalizeOptions.expandNumbers', since: 2
  }),
  'normalize.expandUnits': d({
    id: 'normalize.expandUnits', owner: 'normalize', panel: 'D',
    label: 'Whether units become words',
    help: '"52 ms was odd to hear" — units are expanded before the number.',
    kind: 'bool', default: true,
    // Wired by J26 closing SC-8. Before that this was `wire: null` and the field was governed by
    // `normalize.expandIntegers` — a control claiming a stage it did not own.
    provisional: true, effect: 'utterance', enginePersonal: false,
    wire: 'NormalizeOptions.expandUnits', since: 2
  }),
  'normalize.unitWords': d({
    id: 'normalize.unitWords', owner: 'normalize', panel: 'D',
    label: 'What each unit is called',
    help: 'The symbol-to-word table for units.',
    kind: 'map', default: {} as Readonly<Record<string, string>>,
    provisional: true, effect: 'utterance', enginePersonal: false, wire: null, since: 2
  }),
  'normalize.decimals': d({
    id: 'normalize.decimals', owner: 'normalize', panel: 'D',
    label: 'How a decimal is said',
    help: 'Hand three point one four to the engine, or say it in words.',
    kind: 'enum', values: ['engine', 'words'], default: 'engine',
    provisional: true, effect: 'utterance', enginePersonal: true, wire: null, since: 2
  }),
  'normalize.sentencePauseMs': d({
    id: 'normalize.sentencePauseMs', owner: 'normalize', panel: 'E',
    label: 'How long a sentence pauses',
    help: 'Milliseconds between sentences. In milliseconds so the number survives when SSML lands.',
    kind: 'int', range: { min: 0, max: 800, step: 25 }, unit: 'ms', default: 0,
    provisional: true, effect: 'session', enginePersonal: true, wire: null, since: 2
  }),

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // chunk — ChunkerOptions. 2 fields, both wired. `countUnits` is a FUNCTION and not settable.
  // ─────────────────────────────────────────────────────────────────────────────────────────

  'chunk.maxUnits': d({
    id: 'chunk.maxUnits', owner: 'chunk', panel: 'E',
    label: 'How long a chunk',
    help: 'How much text is synthesized at once. Judged today against a floor that changes.',
    kind: 'int', range: { min: 40, max: 600, step: 20 }, unit: 'characters', default: 200,
    provisional: true, effect: 'utterance', enginePersonal: false,
    wire: 'ChunkerOptions.maxUnits', since: 2
  }),
  'chunk.isolateFirstSentence': d({
    id: 'chunk.isolateFirstSentence', owner: 'chunk', panel: 'E',
    label: 'Whether the first sentence goes alone',
    help: 'Send sentence one on its own so the first audio arrives sooner.',
    kind: 'bool', default: true,
    provisional: true, effect: 'utterance', enginePersonal: false,
    wire: 'ChunkerOptions.isolateFirstSentence', since: 2
  }),

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // synthesize — 7 fields, 3 wired. Two of those land on SynthesizeOptions (voice, rate);
  // `synthesize.engine` selects WHICH provider `registry.resolve()` tries first, so its wire
  // is `ProviderRegistry.resolve`, not a generate() option. `signal` is runtime, not settable.
  // Read ONCE PER UTTERANCE, never per chunk (011 section 2.3): a voice change between chunk
  // three and chunk four is a sentence that changes speaker mid-word. Same cadence for engine:
  // swapping the backend mid-utterance is the same failure wearing a different costume.
  // ─────────────────────────────────────────────────────────────────────────────────────────

  'synthesize.engine': d({
    id: 'synthesize.engine', owner: 'synthesize', panel: 'E',
    label: 'Which engine',
    help: 'Auto uses Pocket TTS when the neural model is installed, otherwise the system voice. OS always uses the system voice. Pocket asks for the neural voice and names the substitution out loud when it cannot.',
    kind: 'enum', values: ['auto', 'os', 'pocket'], default: 'auto',
    provisional: true, effect: 'utterance', enginePersonal: false,
    // Not SynthesizeOptions: this value chooses the provider, it is not handed to generate().
    // P28's voiceIndex stays an index into the SELECTED backend's list; do not qualify it.
    wire: 'ProviderRegistry.resolve', since: 2
  }),
  'synthesize.voiceIndex': d({
    id: 'synthesize.voiceIndex', owner: 'synthesize', panel: 'E',
    label: 'Which voice',
    help: "Filled in from the machine's own voice list. Never free text: an unknown name exits zero and silently substitutes the default.",
    kind: 'voice', default: null,
    provisional: true, effect: 'utterance', enginePersonal: true,
    // P28: an INDEX into the host's runtime voice list is persisted, never a name — the three
    // platforms' voice namespaces have zero overlap. The consumer's property is still
    // `SynthesizeOptions.voice: string`, so resolving index -> name is the loader's job (T121).
    wire: 'SynthesizeOptions.voice', since: 2
  }),
  'synthesize.rate': d({
    id: 'synthesize.rate', owner: 'synthesize', panel: 'E',
    label: 'How fast',
    help: "Speaking rate, as a multiple of the voice's own.",
    kind: 'float', range: { min: 0.5, max: 2.0, step: 0.05 }, unit: 'times', default: 1.0,
    provisional: true, effect: 'utterance', enginePersonal: true,
    wire: 'SynthesizeOptions.rate', since: 2
  }),
  'synthesize.pitch': d({
    id: 'synthesize.pitch', owner: 'synthesize', panel: 'E',
    label: 'How high',
    help: 'No field exists yet — this control renders and the schema carries it, so the gap stays countable.',
    kind: 'int', range: { min: -50, max: 50, step: 5 }, unit: 'steps', default: 0,
    provisional: true, effect: 'utterance', enginePersonal: true, wire: null, since: 2
  }),
  'synthesize.volume': d({
    id: 'synthesize.volume', owner: 'synthesize', panel: 'E',
    label: 'How loud',
    help: 'No field exists yet — designed, not wired.',
    kind: 'int', range: { min: 0, max: 100, step: 5 }, unit: 'percent', default: 100,
    provisional: true, effect: 'utterance', enginePersonal: true, wire: null, since: 2
  }),
  'synthesize.pauseBackend': d({
    id: 'synthesize.pauseBackend', owner: 'synthesize', panel: 'E',
    label: 'How a pause is written',
    help: 'Punctuation is the only one implemented; the others are here so the cost of SSML can be heard before it is paid.',
    kind: 'enum', values: ['punctuation', 'ssml', 'in-band'], default: 'punctuation',
    provisional: true, effect: 'session', enginePersonal: true, wire: null, since: 2
  }),
  'synthesize.interruptGranularity': d({
    id: 'synthesize.interruptGranularity', owner: 'synthesize', panel: 'F',
    label: 'How a stop lands',
    help: 'Cut now, finish the word first, or pause and keep the position.',
    kind: 'enum', values: ['immediate', 'at-word', 'pause-keeps-position'], default: 'immediate',
    provisional: true, effect: 'session', enginePersonal: true, wire: null, since: 2
  }),

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // queue — SpeechService's queue. 011 section 3.2a: `queue.maxQueued` IS OWNED HERE and its
  // number exists in this file and nowhere else.
  // ─────────────────────────────────────────────────────────────────────────────────────────

  'queue.maxQueued': d({
    id: 'queue.maxQueued', owner: 'queue', panel: 'F',
    label: 'How many replies wait',
    help: 'Twenty queued replies is roughly three minutes of unrequested speech. Eight is what you have been living with.',
    kind: 'int', range: { min: 1, max: 20, step: 1 }, unit: 'replies', default: 8,
    provisional: false,
    rationale: 'What the listener has been living with; twenty queued replies is ~3 minutes of unrequested speech (009 section 2, C3). Settled, not taste.',
    effect: 'immediate', enginePersonal: false,
    // `wire: null` TODAY, and this disagrees with 011 section 3.2a's descriptor, which writes
    // `wire: 'SpeechServiceDeps.maxQueued'`. The settings value does not reach the consumer yet:
    // `main.ts` still passes a literal 8. 011 section 3.2's own count ("9 wired = 5 normalize +
    // 2 chunk + 2 synthesize"), 002 spec FR-012 and row 36 (class D), and the lab inventory all
    // say null. T122 is the task that makes it non-null; claiming the wire before then would be
    // exactly the P26 defect this field is documented against. See the report.
    wire: null, since: 2
  }),
  'queue.overflowPolicy': d({
    id: 'queue.overflowPolicy', owner: 'queue', panel: 'F',
    label: 'Which reply is dropped when full',
    help: 'Dropping the oldest silently was the third fault behind the session that hijacked your audio.',
    kind: 'enum', values: ['drop-oldest', 'drop-newest'], default: 'drop-oldest',
    provisional: true, effect: 'immediate', enginePersonal: false, wire: null, since: 2
  }),
  'queue.announceMode': d({
    id: 'queue.announceMode', owner: 'queue', panel: 'F',
    label: 'Whether an announcement interrupts',
    help: 'Replace cuts off a reply in progress; queue waits for it.',
    kind: 'enum', values: ['replace', 'queue'], default: 'replace',
    provisional: true, effect: 'immediate', enginePersonal: false, wire: null, since: 2
  }),

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // announce — the WORDING. 9 fields, none wired.
  // ─────────────────────────────────────────────────────────────────────────────────────────

  'announce.codeBlockPhrase': d({
    id: 'announce.codeBlockPhrase', owner: 'announce', panel: 'A',
    label: 'What a code block is called',
    help: 'The sentence spoken in place of a code block. {lang} and {lines} are filled in.',
    kind: 'template', default: ' . Here, a code block is omitted. ',
    provisional: true, effect: 'utterance', enginePersonal: false, wire: null, since: 2
  }),
  'announce.urlPhrase': d({
    id: 'announce.urlPhrase', owner: 'announce', panel: 'A',
    label: 'What a link is called',
    help: 'The phrase spoken for a link. {host} and {path} are filled in.',
    kind: 'template', default: 'a link to {host}',
    provisional: true, effect: 'utterance', enginePersonal: false, wire: null, since: 2
  }),
  'announce.tableLeadIn': d({
    id: 'announce.tableLeadIn', owner: 'announce', panel: 'B',
    label: 'What a table is called',
    help: 'The lead-in sentence spoken before a table.',
    kind: 'template', default: 'Table.',
    provisional: true, effect: 'utterance', enginePersonal: false, wire: null, since: 2
  }),
  'announce.pathNamePhrase': d({
    id: 'announce.pathNamePhrase', owner: 'announce', panel: 'C',
    label: 'What a file is called',
    help: 'The phrase that introduces a file name. {name} is filled in.',
    kind: 'template', default: 'file named {name}',
    provisional: true, effect: 'utterance', enginePersonal: false, wire: null, since: 2
  }),
  'announce.pathFolderPhrase': d({
    id: 'announce.pathFolderPhrase', owner: 'announce', panel: 'C',
    label: 'What a folder is called',
    help: 'The phrase that introduces the folders. {folders} is filled in.',
    kind: 'template', default: 'in folder {folders}',
    provisional: true, effect: 'utterance', enginePersonal: false, wire: null, since: 2
  }),
  'announce.sessionLabel': d({
    id: 'announce.sessionLabel', owner: 'announce', panel: 'F',
    label: 'How a session is named',
    help: 'Hex is not on this list, and that is deliberate: two designs call eight hex characters a non-answer to who is speaking.',
    kind: 'enum',
    values: ['call-sign', 'call-sign-plus-name', 'registry-name', 'branch', 'displayName'],
    default: 'call-sign',
    provisional: true, effect: 'immediate', enginePersonal: false, wire: null, since: 2
  }),
  'announce.switchPhrase': d({
    id: 'announce.switchPhrase', owner: 'announce', panel: 'F',
    label: 'What a session switch says',
    help: 'Spoken when the audio moves to another session. {label} is filled in.',
    kind: 'template', default: 'Now reading from {label}.',
    provisional: true, effect: 'immediate', enginePersonal: false, wire: null, since: 2
  }),
  'announce.statusTemplate': d({
    id: 'announce.statusTemplate', owner: 'announce', panel: 'F',
    label: 'What status says',
    help: 'The wording and order of the spoken status report.',
    kind: 'template', default: '{state}. {queued} waiting. Following {label}.',
    provisional: true, effect: 'immediate', enginePersonal: false, wire: null, since: 2
  }),
  'announce.reportChannel': d({
    id: 'announce.reportChannel', owner: 'announce', panel: 'F',
    label: 'How settings problems are reported',
    help: 'Whether a settings problem is spoken as soon as it is found, spoken only when you are already using audio, or kept for when you ask.',
    kind: 'enum', values: ['always-spoken', 'when-audio-in-use', 'on-request-only'],
    default: 'when-audio-in-use',
    // TASTE. 011 Q68 — nobody has heard all three. `when-audio-in-use` is in the code as the
    // REVERSIBLE MIDDLE, not as an answer: a failure must reach a channel the listener has (P30)
    // and an unrequested interruption is itself a harm (P22/P30), and only a listener can settle
    // which of those wins on a machine we have not met.
    provisional: true,
    effect: 'session', enginePersonal: false,
    wire: 'SettingsReport.channel', since: 2
  }),

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // session · input · apply · lab
  // ─────────────────────────────────────────────────────────────────────────────────────────

  'session.huddleReplyCap': d({
    id: 'session.huddleReplyCap', owner: 'session', panel: 'F',
    label: 'How much of a reply is read',
    help: 'No cap exists at all today, and the reply queue counts replies, so one forty-thousand-character reply is thirty-three minutes and nothing can drop it.',
    kind: 'int', range: { min: 2000, max: 50000, step: 1000 }, unit: 'characters', default: 8000,
    // B-05: the EXISTENCE of a cap is correctness; the NUMBER is taste.
    provisional: true, effect: 'immediate', enginePersonal: false, wire: null, since: 2
  }),
  'input.clipboardCap': d({
    id: 'input.clipboardCap', owner: 'input', panel: 'F',
    label: 'How much clipboard is read',
    help: 'Above this, the clipboard read is truncated and the truncation is announced.',
    kind: 'int', range: { min: 2000, max: 50000, step: 1000 }, unit: 'characters', default: 20000,
    provisional: true, effect: 'immediate', enginePersonal: false, wire: null, since: 2
  }),
  'apply.toQueued': d({
    id: 'apply.toQueued', owner: 'apply', panel: 'F',
    label: 'Whether a change reaches replies already waiting',
    help: 'A settings change never interrupts what is playing. This decides whether it also reaches the replies already queued behind it.',
    kind: 'bool', default: false,
    // TASTE. 011 Q62 — genuinely undecidable from a desk. A listener who has just heard a path
    // mangled wants the fix to reach the four queued replies; a listener mid-way through a long
    // answer wants consistency. `false` because it is the conservative, reversible one.
    provisional: true, effect: 'immediate', enginePersonal: false, wire: null, since: 2
  }),
  'lab.simulateChunkGapMs': d({
    id: 'lab.simulateChunkGapMs', owner: 'lab', panel: 'E',
    label: 'The gap between chunks',
    help: 'The lab has no gap; the shipped plugin has about nine hundred and fifty milliseconds of one. Hear either world.',
    kind: 'int', range: { min: 0, max: 1500, step: 50 }, unit: 'ms', default: 0,
    provisional: true,
    // 'lab-only': THE PLUGIN MUST NEVER READ THIS, and `schema.test.ts` asserts owner and effect
    // agree so a lab-only field cannot quietly acquire a plugin consumer.
    effect: 'lab-only', enginePersonal: false, wire: null, since: 2
  }),

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // RESERVED — `since: 3`, 011 section 4.2a. These are ids a LATER milestone registered against a
  // schema this build has not bumped to. They are counted in the `future` bucket, rendered by the
  // lab as disabled rows, written into the starter file as commented-out lines, and excluded from
  // the reachability assertion (they have no consumer yet, by definition). The mechanism exists so
  // that M16 and M17 ADD AN ID rather than invent a constant in their own prose (P26).
  // ─────────────────────────────────────────────────────────────────────────────────────────

  'session.followMax': d({
    id: 'session.followMax', owner: 'session', panel: 'F',
    label: 'How many sessions are followed',
    help: 'How many agent sessions the audio follows at once, or all of them.',
    kind: 'enum', values: [1, 2, 3, 4, 5, 6, 7, 'all'] as readonly (number | string)[], default: 1,
    provisional: true, effect: 'immediate', enginePersonal: false, wire: null, since: 3
  }),
  'session.registryPollMs': d({
    id: 'session.registryPollMs', owner: 'session', panel: 'F',
    label: 'How often the session registry is re-read',
    help: 'Milliseconds between re-reads of the session registry.',
    kind: 'int', range: { min: 1000, max: 60000, step: 500 }, unit: 'ms', default: 1000,
    provisional: true, effect: 'session', enginePersonal: false, wire: null, since: 3
  }),
  'session.unregisteredWindowMs': d({
    id: 'session.unregisteredWindowMs', owner: 'session', panel: 'F',
    label: 'How long an unregistered session stays interesting',
    help: 'How long a session that never registered is still treated as live.',
    kind: 'int', range: { min: 60000, max: 3600000, step: 60000 }, unit: 'ms', default: 600000,
    provisional: true, effect: 'session', enginePersonal: false, wire: null, since: 3
  }),
  'session.showUnregistered': d({
    id: 'session.showUnregistered', owner: 'session', panel: 'F',
    label: 'Whether unregistered sessions are offered',
    help: 'Whether sessions that never registered appear in the follow list at all.',
    kind: 'bool', default: false,
    provisional: true, effect: 'immediate', enginePersonal: false, wire: null, since: 3
  }),
  'queue.perSessionFairness': d({
    id: 'queue.perSessionFairness', owner: 'queue', panel: 'F',
    label: 'Share the queue between followed sessions',
    help: 'When more than one session is followed, cap each one at its share of the queue instead of letting the fastest agent fill it.',
    kind: 'bool', default: false,
    // TASTE. Fairness trades "the agent you are listening to keeps its place" against "the fastest
    // agent cannot monopolise the queue", and which is correct is learned by hearing a two-agent
    // fan-out (P23). Ships off because off is today's behaviour and therefore the reversible one.
    // The per-session cap is DERIVED FROM `queue.maxQueued`, never replacing it — one id, one
    // meaning (011 section 4.2). The arithmetic belongs to 012.
    provisional: true, effect: 'immediate', enginePersonal: false, wire: null, since: 3
  }),
  'input.talkWindowMs': d({
    id: 'input.talkWindowMs', owner: 'input', panel: 'F',
    label: 'How long the talk window stays open',
    help: 'How long the plugin keeps listening after the talk gesture.',
    kind: 'int', range: { min: 1000, max: 120000, step: 1000 }, unit: 'ms', default: 15000,
    provisional: true, effect: 'immediate', enginePersonal: false, wire: null, since: 3
  }),
  'input.talkGesture': d({
    id: 'input.talkGesture', owner: 'input', panel: 'F',
    label: 'What opens the talk window',
    help: 'Which gesture opens the talk window.',
    kind: 'enum', values: ['hold', 'toggle', 'double-tap'], default: 'hold',
    provisional: true, effect: 'session', enginePersonal: false, wire: null, since: 3
  }),
  'input.resumePolicy': d({
    id: 'input.resumePolicy', owner: 'input', panel: 'F',
    label: 'What happens to speech when the talk window closes',
    help: 'Whether speech resumes where it stopped, starts the reply again, or stays stopped.',
    kind: 'enum', values: ['resume', 'restart', 'stay-stopped'], default: 'resume',
    provisional: true, effect: 'immediate', enginePersonal: false, wire: null, since: 3
  }),
  'input.recognizerCommand': d({
    id: 'input.recognizerCommand', owner: 'input', panel: 'F',
    label: 'Which recognizer command is run',
    help: 'The command that turns your speech into text. A path on this machine.',
    kind: 'string', default: '',
    // A command path does not transfer between machines — 011 section 4.2a, same shape as P28.
    provisional: true, effect: 'session', enginePersonal: true, wire: null, since: 3
  }),
  'input.talkWindowIdleMs': d({
    id: 'input.talkWindowIdleMs', owner: 'input', panel: 'F',
    label: 'How long the talk window waits when nothing is followed',
    help: "The window's clock when there is no session to close it on evidence.",
    kind: 'int', range: { min: 1000, max: 120000, step: 1000 }, unit: 'ms', default: 15000,
    provisional: true, effect: 'immediate', enginePersonal: false, wire: null, since: 3
  }),
  'input.paneFallbackWatch': d({
    id: 'input.paneFallbackWatch', owner: 'input', panel: 'F',
    label: "Whether an empty follow set watches the pane's own transcript",
    help: "With nothing followed, may the talk window read the control pane's own working-directory transcript, read-only, for the window's duration.",
    kind: 'bool', default: false,
    provisional: true, effect: 'immediate', enginePersonal: false, wire: null, since: 3
  })
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Derived views. Everything below is COMPUTED from the table above — never a second list.
// ───────────────────────────────────────────────────────────────────────────────────────────

export type Settings = Readonly<Record<string, unknown>>

export const OWNERS: readonly Owner[] = [
  'normalize', 'chunk', 'synthesize', 'queue', 'announce', 'session', 'input', 'apply', 'lab'
]

/** Every id in the schema, in declaration order. */
export function fieldIds(): readonly string[] {
  return Object.keys(SETTINGS_SCHEMA)
}

export function descriptor(id: string): FieldDescriptor | undefined {
  return SETTINGS_SCHEMA[id]
}

export function fieldsByOwner(owner: Owner): readonly FieldDescriptor[] {
  return Object.values(SETTINGS_SCHEMA).filter((f) => f.owner === owner)
}

/** `since > SCHEMA_VERSION`: registered by a later milestone, no consumer yet, not in this file's shape. */
export function isFuture(f: FieldDescriptor): boolean {
  return f.since > SCHEMA_VERSION
}

/** The value reaches SOME consumer today. Twelve fields. */
export function isWired(f: FieldDescriptor): boolean {
  return f.wire !== null && !isFuture(f)
}

/** The three typed OPTIONS surfaces a chunk of text passes through on its way to audio. */
export const OPTION_SURFACE_TYPES: readonly string[] = [
  'NormalizeOptions', 'ChunkerOptions', 'SynthesizeOptions'
]

/**
 * The value reaches a typed OPTIONS object — 011 section 3.2's count of 9 (5 normalize + 2 chunk +
 * 2 synthesize). This is the narrower of the two, and it is the one T124's reachability assertion
 * walks, because those three types are the ones with a compile-time key list to walk against.
 */
export function isOptionWired(f: FieldDescriptor): boolean {
  return isWired(f) && OPTION_SURFACE_TYPES.includes(f.wire!.split('.')[0]!)
}

/**
 * The ONLY source of defaults (T122). A consumer never writes `?? something`, because `parse()`
 * always hands back a fully populated record.
 */
export function schemaDefaults(): Settings {
  const out: Record<string, unknown> = {}
  for (const f of Object.values(SETTINGS_SCHEMA)) {
    if (isFuture(f)) continue
    out[f.id] = Array.isArray(f.default) ? [...(f.default as readonly unknown[])] : f.default
  }
  return out
}

export interface GapReport {
  /** `wire !== null` and shipping in this schema version — some consumer reads it today. */
  readonly wired: number
  /**
   * The subset whose wire names one of the three typed options surfaces. 011 section 3.2 counts
   * THIS one and calls it 9; `wired` is 12 because `announce.reportChannel` reaches
   * `SettingsReport.channel` and `synthesize.engine` reaches `ProviderRegistry.resolve`.
   */
  readonly optionSurfaceWired: number
  /** `wire === null` and shipping. The lab renders these; nothing consumes them. */
  readonly designedNotWired: number
  /** Entries in `EXCLUDED` — an exclusion must be a reviewable line, never a silent omission. */
  readonly excluded: number
  /** `since > SCHEMA_VERSION` — R7-29. Ids a later milestone registered. */
  readonly future: number
  /** Defaults nobody has settled by ear (P23). */
  readonly provisional: number
  readonly total: number
  readonly byOwner: Readonly<Record<string, { wired: number; designed: number; future: number }>>
}

/**
 * 011 section 3.3 (d). T124 does not only assert — it PRINTS this, and each count is a number
 * someone can watch move. An indicator that never changes is a broken indicator.
 */
export function gapReport(excludedCount: number): GapReport {
  const all = Object.values(SETTINGS_SCHEMA)
  const byOwner: Record<string, { wired: number; designed: number; future: number }> = {}
  for (const o of OWNERS) byOwner[o] = { wired: 0, designed: 0, future: 0 }
  for (const f of all) {
    const b = byOwner[f.owner]!
    if (isFuture(f)) b.future++
    else if (f.wire !== null) b.wired++
    else b.designed++
  }
  return {
    wired: all.filter(isWired).length,
    optionSurfaceWired: all.filter(isOptionWired).length,
    designedNotWired: all.filter((f) => !isFuture(f) && f.wire === null).length,
    excluded: excludedCount,
    future: all.filter(isFuture).length,
    provisional: all.filter((f) => !isFuture(f) && f.provisional).length,
    total: all.filter((f) => !isFuture(f)).length,
    byOwner
  }
}

export function formatGapReport(r: GapReport): string {
  const lines = [
    `settings schema v${SCHEMA_VERSION} — ${r.total} fields shipping, ${r.future} reserved at a later version`,
    `  wired ................. ${r.wired}   (some consumer reads the value today)`,
    `    of which options .... ${r.optionSurfaceWired}   (NormalizeOptions / ChunkerOptions / SynthesizeOptions)`,
    `  designed-not-wired .... ${r.designedNotWired}   (rendered and recorded; nothing consumes it yet)`,
    `  excluded .............. ${r.excluded}   (named, reviewable exclusions from the option surfaces)`,
    `  future ................ ${r.future}   (since > ${SCHEMA_VERSION}; no consumer by definition)`,
    `  provisional ........... ${r.provisional}   (defaults nobody has settled by ear)`,
    '  by owner:'
  ]
  for (const o of OWNERS) {
    const b = r.byOwner[o]!
    lines.push(`    ${o.padEnd(11)} ${String(b.wired + b.designed).padStart(3)} shipping  (${b.wired} wired, ${b.designed} designed)  +${b.future} reserved`)
  }
  return lines.join('\n')
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Projections — the settings record onto the three real option surfaces. This is the ONLY place
// a schema id becomes a consumer property, so "which id feeds what" is one readable function per
// owner instead of a guess spread across call sites (P26).
// ───────────────────────────────────────────────────────────────────────────────────────────

/** Which property of which options object each `wire` names, split once. */
export function wireProperty(f: FieldDescriptor): string | null {
  return f.wire === null ? null : (f.wire.split('.')[1] ?? null)
}

function project(s: Settings, owner: Owner): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of Object.values(SETTINGS_SCHEMA)) {
    // Option-surface wires only. `synthesize.engine` is wired to the registry, not to
    // SynthesizeOptions, and must not appear as a generate() property.
    if (f.owner !== owner || !isOptionWired(f)) continue
    const prop = wireProperty(f)
    if (prop === null) continue
    const v = s[f.id]
    if (v === undefined || v === null) continue
    out[prop] = v
  }
  return out
}

export function toNormalizeOptions(s: Settings): NormalizeOptions {
  return project(s, 'normalize') as NormalizeOptions
}

export function toChunkerOptions(s: Settings): ChunkerOptions {
  return project(s, 'chunk') as ChunkerOptions
}

/**
 * `synthesize.voiceIndex` persists an INDEX into the host's runtime voice list (P28: the three
 * platforms' voice namespaces have zero overlap, so a persisted NAME is meaningless on another
 * machine), while the consumer's property is `SynthesizeOptions.voice: string`. Resolving one to
 * the other needs the host's list, which core does not have — so the caller supplies it.
 *
 * With no resolver, or an index the list does not reach, `voice` is OMITTED rather than guessed.
 * A guessed voice name exits zero and silently substitutes the default, which is the failure shape
 * this whole module exists to refuse.
 */
export function toSynthesizeOptions(
  s: Settings,
  resolveVoice?: (index: number) => string | undefined
): SynthesizeOptions {
  const out = project(s, 'synthesize') as Record<string, unknown>
  const idx = out['voice']
  if (typeof idx === 'number') {
    const name = resolveVoice?.(idx)
    if (typeof name === 'string' && name.length > 0) out['voice'] = name
    else delete out['voice']
  }
  return out as SynthesizeOptions
}

/** Legal values of `synthesize.engine`. The setting is the listener's; these ids are ours. */
export const SYNTHESIZE_ENGINE_VALUES = ['auto', 'os', 'pocket'] as const
export type SynthesizeEngine = (typeof SYNTHESIZE_ENGINE_VALUES)[number]

/**
 * Which id `ProviderRegistry.resolve()` should try first, given the listener's engine setting.
 *
 *   auto   — Pocket when it is registered, so the model dir is actually consulted; otherwise
 *            the OS floor (no substitution to name: Pocket was never a candidate).
 *   os     — always the system voice
 *   pocket — Pocket, and the registry names the substitution out loud when it cannot
 *            (principle VIII / R015: a listener who asked for the neural voice and got the
 *            system one must be told, in the registry's own words).
 *
 * `voiceIndex` is deliberately not consulted here. P28 chose a per-backend index; qualifying
 * it would reopen that decision.
 */
export function requestedEngineId(
  engine: unknown,
  pocketRegistered: boolean
): string | undefined {
  if (engine === 'os') return 'os-synth'
  if (engine === 'pocket') return 'pocket'
  return pocketRegistered ? 'pocket' : undefined
}
