/**
 * The plugin's SETTINGS READ PATH — the half of 011 that makes the Voice Lab worth using.
 *
 * Until this existed, `packages/core/src/settings/` was a schema, a parser and a set of
 * projections with **no consumer in the plugin at all**: the listener could tune by ear for an
 * hour, the lab wrote a perfectly good file, and `main.ts` kept speaking schema-free literals.
 * P26 in its purest form — an option nobody can pass is invisible to every test you would think
 * to write.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────
 * THE DEGRADATION POLICY, STATED, BECAUSE IT IS MOST OF THIS MODULE
 * ───────────────────────────────────────────────────────────────────────────────────────────
 *
 * Three failures are possible and each one has a decided answer. The two answers that were
 * REJECTED are recorded with them, because a policy whose alternatives are not written down gets
 * re-litigated by the next reader.
 *
 * | Failure | What happens | Why not the alternative |
 * |---|---|---|
 * | inbox absent | mirror, else schema defaults. **Silent on a genuinely first run**; spoken once when the mirror had to supply the values. | *Refuse to start* is silence, and silence is the failure this project exists to prevent (P30). *Announce every launch* spends the listener's only channel on non-news (011 4.3). Absence AFTER tuning is an hour of the listener's work vanishing while the plugin still sounds fine — that one must be audible. |
 * | inbox unreadable (permissions, a directory, a device) | mirror, else defaults, **and always spoken** even with no mirror. | Unlike absence, a file that is THERE and cannot be read is never the normal first run, so there is no case where saying so is noise. |
 * | inbox present but wholly unparseable | the file is refused **atomically** — every field comes from the mirror or the default — and the line is named aloud. | *Apply the fields that did parse* is the "half a config" outcome: a state the listener cannot reason about, cannot reproduce, and cannot hear the shape of. Atomic refusal is the only fallback whose result the listener can predict. |
 * | one bad VALUE in an otherwise good file | that field alone falls back, named by its label. | The other 46 controls did nothing wrong. `parse()` already implements this; the plugin must not coarsen it back to a whole-file refusal. |
 * | file from a NEWER schemaVersion | load every id we know, ignore the rest, say how many. | Refusing would leave a voice-first listener on default voice, default rate and default path style — that is not a safe fallback, it IS the failure. |
 * | file from an OLDER schemaVersion | migrate in memory; **never write the migration back**. | The listener's file is the listener's. |
 *
 * And one invariant that is easy to miss and expensive to lose:
 *
 * **A degraded load NEVER writes the mirror.** The mirror is last-known-good; mirroring a
 * defaults-derived snapshot would destroy the very thing the mirror exists to preserve, on the
 * one run where it was needed. Only a clean read of the inbox is mirrored.
 *
 * NOTHING HERE WRITES THE INBOX. 011 section 6's create-once starter file is a WRITE path and is
 * deliberately not in this module — see the report accompanying this commit.
 */
import {
  fromMirror, parse, parseSettingsText, promote, reportDestination, schemaDefaults,
  settingsReportSentence, toChunkerOptions, toMirror, toNormalizeOptions, toSynthesizeOptions,
  type AudioEvidence, type ChunkerOptions, type NormalizeOptions, type ParseResult,
  type ReportDestination, type Settings, type SettingsSnapshot, type SynthesizeOptions
} from '@orca-tts/core'

/** The file the listener edits, and the only file this plugin reads for tuning. */
export const INBOX_FILENAME = 'settings.jsonc'

/** The directory named for THIS plugin. Nothing outside it is ever read or written (011 1.2). */
export const INBOX_DIRNAME = 'orca-tts'

export interface Env { readonly [k: string]: string | undefined }

/**
 * Where the inbox lives, per platform (011 section 1.2).
 *
 * `ORCA_TTS_CONFIG_DIR` comes first on every platform: it is P27's shape applied to us — parallel
 * dev builds share one userData profile, so a worktree that wants isolated tuning needs an escape
 * hatch that does not involve moving the listener's real file.
 */
export function inboxDir(env: Env, platform: string): string {
  const override = env['ORCA_TTS_CONFIG_DIR']
  if (override !== undefined && override.length > 0) return override
  const home = env['HOME'] ?? env['USERPROFILE'] ?? '.'
  if (platform === 'win32') {
    const appData = env['APPDATA']
    return join(appData !== undefined && appData.length > 0 ? appData : join(home, 'AppData', 'Roaming'), INBOX_DIRNAME)
  }
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', INBOX_DIRNAME)
  const xdg = env['XDG_CONFIG_HOME']
  return join(xdg !== undefined && xdg.length > 0 ? xdg : join(home, '.config'), INBOX_DIRNAME)
}

export function inboxPath(env: Env, platform: string): string {
  return join(inboxDir(env, platform), INBOX_FILENAME)
}

/**
 * Path join without `node:path`, and the separator follows the PLATFORM ARGUMENT rather than the
 * host running the code. A test asserting the Windows path on macOS is the only way the Windows
 * branch is ever exercised at all — R1 says the three platforms are equals, and a path builder
 * that can only be checked on the platform it targets is a branch nobody ever runs (P25's shape).
 */
function join(...parts: string[]): string {
  return parts.join('/')
}

/** Windows wants backslashes; `join` above is separator-agnostic for comparison purposes. */
export function nativeInboxPath(env: Env, platform: string): string {
  const p = inboxPath(env, platform)
  return platform === 'win32' ? p.replaceAll('/', '\\') : p
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Loading
// ───────────────────────────────────────────────────────────────────────────────────────────

/** Which store actually supplied the values. Spoken by `status`, asserted by the tests. */
export type LoadSource = 'inbox' | 'mirror' | 'defaults'

/** How the inbox itself failed, `null` when it did not. Kept separate from `ParseResult`. */
export type InboxFailure =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly reason: string }

export interface LoadOutcome {
  readonly snapshot: SettingsSnapshot
  readonly result: ParseResult
  readonly source: LoadSource
  readonly path: string
  readonly inboxFailure: InboxFailure | null
  /** What the listener is told, or `null` when there is genuinely nothing to say. */
  readonly sentence: string | null
  readonly destination: ReportDestination
  /** True only for a clean read of the inbox — the one case that may write the mirror. */
  readonly mirrorable: boolean
}

export interface SettingsIo {
  /** Must REJECT when the file is absent; an ENOENT-shaped error is read as absence. */
  readonly readInbox: (path: string) => Promise<string>
  readonly mirrorGet: () => Promise<Readonly<Record<string, unknown>> | null>
  readonly mirrorSet?: (values: Record<string, unknown>) => Promise<void>
  readonly log?: (m: string) => void
}

function isAbsent(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * The ordered load of 011 section 1.2a: **the mirror is read FIRST**, always, before the
 * filesystem — because per-field precedence alone was unreachable in the one scenario the mirror
 * exists for (R7-27).
 */
export async function loadSettings(
  io: SettingsIo, path: string, evidence: AudioEvidence
): Promise<LoadOutcome> {
  let mirror = null as ReturnType<typeof fromMirror>
  try {
    mirror = fromMirror(await io.mirrorGet())
  } catch (err) {
    // A dead mirror is a degradation of the FALLBACK, not of the load. It is logged, and it shows
    // up where it matters: as `defaults` rather than `mirror` in the sentence below.
    io.log?.(`read-aloud: settings mirror unreadable: ${String(err)}`)
  }

  let text: string | null = null
  let inboxFailure: InboxFailure | null = null
  try {
    text = await io.readInbox(path)
  } catch (err) {
    inboxFailure = isAbsent(err) ? { kind: 'absent' } : { kind: 'unreadable', reason: String(err) }
  }

  const result = text === null
    ? parse(undefined, { mirror })
    : parseSettingsText(text, { mirror })

  const wholeFileRefused = inboxFailure !== null || result.fileError !== undefined
  const source: LoadSource = !wholeFileRefused ? 'inbox' : mirror !== null ? 'mirror' : 'defaults'

  return {
    snapshot: { revision: result.revision, values: result.settings },
    result,
    source,
    path,
    inboxFailure,
    sentence: sentenceFor(result, inboxFailure, source, path),
    destination: reportDestination(result.settings['announce.reportChannel'], evidence),
    mirrorable: !wholeFileRefused
  }
}

/**
 * What the listener hears about the load, or `null` for "nothing worth a sentence".
 *
 * Composed rather than delegated: `settingsReportSentence()` in core reports what the PARSER
 * found, and knows nothing about a file that was never opened. The absence cases are this layer's
 * to speak, and they are the ones with the sharpest honesty requirement.
 */
export function sentenceFor(
  result: ParseResult, failure: InboxFailure | null, source: LoadSource, path: string
): string | null {
  const parts: string[] = []
  if (failure?.kind === 'absent') {
    // A FIRST RUN IS NOT NEWS. There is no tuning to have lost, so announcing it would train the
    // listener to ignore this sentence — and this sentence is the one that has to survive being
    // heard rarely (011 4.3: "a clean load says nothing").
    if (source === 'mirror') {
      parts.push(
        `I could not find your settings file at ${path}, so I am using the last settings I had. ` +
        'Save from the Voice Lab to write it again.'
      )
    }
  } else if (failure?.kind === 'unreadable') {
    // The file IS there. That is never the normal first run, so it is always said.
    parts.push(
      `Your settings file at ${path} could not be opened: ${failure.reason}. ` +
      `I am using ${source === 'mirror' ? 'the last settings I had' : 'the built-in defaults'}.`
    )
  }
  const fromParser = settingsReportSentence(result)
  if (fromParser !== null) parts.push(fromParser)
  return parts.length === 0 ? null : parts.join(' ')
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// The live snapshot the consumers read through
// ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Holds the current snapshot and projects it onto the three real option surfaces.
 *
 * 011 section 2.3: **settings are injected as a GETTER, not as values.** `SpeechServiceDeps` is
 * `readonly` and captured in the constructor, so values-at-construction would mean the only way to
 * apply a settings change is to rebuild the service — dropping the queue and re-paying provider
 * warm-up, which is a worse outcome than not applying it.
 */
export class SettingsRuntime {
  #snapshot: SettingsSnapshot
  #source: LoadSource = 'defaults'
  #path: string
  #rejected = 0
  #unknown = 0
  #writtenAt: string | null = null
  #writtenBy: string | null = null
  /** The host's runtime voice list. Empty until the provider answers; never guessed (P28). */
  #voices: readonly string[] = []
  /**
   * The load's report sentence, kept for the LIFE of the session.
   *
   * 011 section 4.3a's correctness half: *the report is never dropped*, in any configuration.
   * `on-request-only` is a channel, not a silence — so `status` must still be able to answer with
   * the same sentence an hour later, which means it cannot be consumed by whoever reads it first.
   */
  #report: string | null = null
  /** ...and whether it is ALSO owed to the first utterance the listener asks for (4.3a). */
  #owedToFirstUtterance = false

  constructor(path: string) {
    this.#path = path
    this.#snapshot = { revision: 0, values: schemaDefaults() }
  }

  get snapshot(): SettingsSnapshot { return this.#snapshot }
  get values(): Settings { return this.#snapshot.values }
  get source(): LoadSource { return this.#source }
  get path(): string { return this.#path }
  get rejectedCount(): number { return this.#rejected }

  /**
   * Adopt a load, if it is newer. Refused as `stale_revision` by the same rule the write path uses
   * — and the FIRST promotion of a session is never refused, because there is nothing to be stale
   * against (011 1.2a).
   */
  adopt(outcome: LoadOutcome, first = true): boolean {
    const r = promote(first ? null : this.#snapshot, outcome.snapshot)
    if (!r.promoted) return false
    this.#snapshot = r.snapshot
    this.#source = outcome.source
    this.#path = outcome.path
    this.#rejected = outcome.result.rejected.length
    this.#unknown = outcome.result.unknownFields.length
    this.#writtenAt = outcome.result.writtenAt ?? null
    this.#writtenBy = outcome.result.writtenBy ?? null
    return true
  }

  setVoices(voices: readonly string[]): void { this.#voices = voices }
  voiceName(index: number): string | undefined { return this.#voices[index] }

  normalizeOptions(): NormalizeOptions { return toNormalizeOptions(this.values) }
  chunkerOptions(): ChunkerOptions { return toChunkerOptions(this.values) }
  synthesizeOptions(): SynthesizeOptions {
    return toSynthesizeOptions(this.values, (i) => this.voiceName(i))
  }

  /** The flat record written to ORCA's KV. Callers must only do this for a mirrorable load. */
  mirrorRecord(): Record<string, unknown> {
    return toMirror(this.values, this.#snapshot.revision, this.#writtenAt ?? undefined)
  }

  /** Record the report. Kept whether or not anything speaks it unprompted. */
  setReport(sentence: string | null): void { this.#report = sentence }
  get report(): string | null { return this.#report }

  /** Also owe it to the first requested utterance — the `when-audio-in-use` hold (011 4.3a). */
  hold(): void { if (this.#report !== null) this.#owedToFirstUtterance = true }

  /**
   * Take the report if it is owed to an utterance, ONCE. Returns `null` when nothing is owed —
   * including when a report exists but its channel said "not unprompted", which is the whole
   * distinction `on-request-only` buys.
   */
  takeHeld(): string | null {
    if (!this.#owedToFirstUtterance) return null
    this.#owedToFirstUtterance = false
    return this.#report
  }
  get hasHeld(): boolean { return this.#owedToFirstUtterance }

  /**
   * R7-32's status clause. Four values, each chosen because it separates a specific confusion the
   * listener has no other way to resolve: an unchanged `revision` means the plugin never saw their
   * edit; a relative age separates "my edit landed" from "I am hearing last week's file";
   * `writtenBy` separates "the lab overwrote my hand edit" from "my hand edit won"; the rejected
   * count is the settings-health answer.
   *
   * Relative, never absolute: an absolute timestamp read aloud is a sentence nobody can parse.
   */
  statusClause(now: number): string {
    if (this.#source !== 'inbox') {
      const why = this.#source === 'mirror'
        ? 'I am using the last settings I had'
        : 'I am using the built-in defaults'
      return `No settings file was read from ${this.#path}, so ${why}.`
    }
    const age = this.#writtenAt === null ? null : relativeAge(this.#writtenAt, now)
    const by = this.#writtenBy === null ? '' : `, by ${writerPhrase(this.#writtenBy)}`
    const when = age === null ? '' : `, written ${age}`
    // Only non-zero counts are spoken. "Zero fields using defaults" is a sentence that costs the
    // listener a second and tells them nothing; silence on a clean load is the report (011 4.3).
    const counts: string[] = []
    if (this.#rejected > 0) {
      counts.push(`${this.#rejected} field${this.#rejected === 1 ? ' is' : 's are'} using defaults`)
    }
    if (this.#unknown > 0) {
      counts.push(`${this.#unknown} ${this.#unknown === 1 ? 'is' : 'are'} newer than this version`)
    }
    const health = counts.length === 0 ? '' : ` ${counts.join(' and ')}.`
    return `Settings revision ${this.#snapshot.revision}${when}${by}, from ${this.#path}.${health}`
  }
}

/**
 * `writtenBy` as something a listener can HEAR.
 *
 * The raw value is `voice-lab/0.2.0`, `hand`, or `read-aloud/0.4.1 (restored)` — and the raw form
 * is a slash-separated token, which the normalizer's path stage reads as a FILE PATH: `voice-lab/0.2.0`
 * came out as *"file named 0.1, dot zero, in folder voice lab"*. Measured here, in the status
 * clause, the first time it was ever spoken. What this field exists to answer is one question —
 * *did the lab overwrite my hand edit, or did my hand edit win* — so the answer is three words,
 * not a version string read out as a directory tree.
 */
export function writerPhrase(writtenBy: string): string {
  const who = (writtenBy.split('/')[0] ?? writtenBy).trim()
  if (who === 'hand') return 'hand'
  if (who === 'voice-lab') return 'the Voice Lab'
  if (who === 'read-aloud') return writtenBy.includes('(restored)') ? 'Read Aloud, rebuilt from the last good settings' : 'Read Aloud'
  // Unknown writer: say the name, never the version, and never with a slash in it.
  return who.replaceAll('/', ' ')
}

/** "12 minutes ago". Coarse on purpose — precision here is noise in a spoken sentence. */
export function relativeAge(writtenAt: string, now: number): string | null {
  const then = Date.parse(writtenAt)
  if (Number.isNaN(then)) return null
  const secs = Math.max(0, Math.round((now - then) / 1000))
  if (secs < 90) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 90) return `${mins} minutes ago`
  const hours = Math.round(mins / 60)
  if (hours < 36) return `${hours} hours ago`
  return `${Math.round(hours / 24)} days ago`
}
