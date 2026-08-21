/**
 * Loading a settings file — T123 (per-field fallback) and 011 sections 2, 4.
 *
 * Two rules govern everything here, and both were learned the hard way:
 *
 * **A bad field falls back ALONE, and it names itself.** One unparseable line must not demote the
 * other 46 controls. `PluginKvStore.read()` swallows a parse error and returns `{}`, which from the
 * plugin's side is indistinguishable from "never configured" — that is the shape this module exists
 * not to repeat.
 *
 * **The naming has to reach a channel the listener actually has.** The FMA counted 55 silent-failure
 * sites in this project and found the number reaching the AUDIO STREAM was ZERO: every path ended at
 * `host.log`, which is wrapped in `catch {}`, or at a desktop notification the author does not look
 * at. So `parse()` RETURNS its rejections rather than logging them, and `settingsReportSentence()`
 * turns them into text a provider is handed. A settings loader that only logs is a settings loader
 * that fails silently (PITFALLS **P30**).
 */

import {
  SCHEMA_VERSION, SETTINGS_SCHEMA, MIRROR_ENVELOPE_KEYS, isFuture, schemaDefaults,
  type FieldDescriptor, type Settings
} from './schema.js'
import { parseJsonc } from './jsonc.js'

export const SETTINGS_KIND = 'orca-tts-settings'

export interface Rejection {
  readonly field: string
  readonly reason: string
  readonly usedDefault: unknown
}

export interface ParseResult {
  /** Fully populated: EVERY shipping field has a value, so no consumer ever writes `?? something`. */
  readonly settings: Settings
  readonly revision: number
  readonly rejected: readonly Rejection[]
  /** Ids in the file that this build does not know — a file written by a newer plugin (011 4.1). */
  readonly unknownFields: readonly string[]
  /** Set when the file's `schemaVersion` was older and the chain ran. */
  readonly migratedFrom?: number
  /** Set when the WHOLE file was refused. Every field then comes from the mirror or the defaults. */
  readonly fileError?: { readonly message: string; readonly line: number | null }
  readonly writtenAt?: string
  readonly writtenBy?: string
}

/** The ORCA KV mirror — last-known-good, never the source of truth (011 section 1.2). */
export interface Mirror {
  readonly values: Readonly<Record<string, unknown>>
  readonly revision: number
  readonly schemaVersion: number
}

export interface ParseOptions {
  /** Read FIRST, before the filesystem (011 section 1.2a step 1). */
  readonly mirror?: Mirror | null
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Per-field validation. One function, driven by the descriptor — never a hand-written switch per
// field, because a hand-written one is where a field quietly stops being checked.
// ───────────────────────────────────────────────────────────────────────────────────────────

function validate(f: FieldDescriptor, v: unknown): { ok: true; value: unknown } | { ok: false; reason: string } {
  switch (f.kind) {
    case 'bool':
      return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false, reason: `expected true or false, got ${describe(v)}` }
    case 'enum': {
      const values = (f.values ?? []) as readonly unknown[]
      return values.includes(v)
        ? { ok: true, value: v }
        : { ok: false, reason: `expected one of ${values.map((x) => JSON.stringify(x)).join(', ')}, got ${describe(v)}` }
    }
    case 'multi': {
      const values = (f.values ?? []) as readonly unknown[]
      if (!Array.isArray(v)) return { ok: false, reason: `expected a list, got ${describe(v)}` }
      const bad = v.find((x) => !values.includes(x))
      if (bad !== undefined) return { ok: false, reason: `${JSON.stringify(bad)} is not one of ${values.map((x) => JSON.stringify(x)).join(', ')}` }
      return { ok: true, value: [...v] }
    }
    case 'int':
    case 'float': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, reason: `expected a number, got ${describe(v)}` }
      if (f.kind === 'int' && !Number.isInteger(v)) return { ok: false, reason: `expected a whole number, got ${v}` }
      const r = f.range
      if (r && (v < r.min || v > r.max)) return { ok: false, reason: `expected ${r.min} to ${r.max}, got ${v}` }
      return { ok: true, value: v }
    }
    case 'string':
    case 'template':
      return typeof v === 'string' ? { ok: true, value: v } : { ok: false, reason: `expected text, got ${describe(v)}` }
    case 'map': {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) return { ok: false, reason: `expected a table, got ${describe(v)}` }
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (typeof val !== 'string') return { ok: false, reason: `the entry for "${k}" is ${describe(val)}, not text` }
      }
      return { ok: true, value: { ...(v as Record<string, unknown>) } }
    }
    case 'voice':
      // P28: an INDEX into the host's runtime voice list, never a name. The three platforms' voice
      // namespaces have zero overlap, so a persisted name is meaningless on another machine.
      if (v === null) return { ok: true, value: null }
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return { ok: true, value: v }
      return { ok: false, reason: `expected a voice index (a whole number) or null, got ${describe(v)}` }
  }
}

function describe(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'a list'
  switch (typeof v) {
    case 'undefined': return 'nothing'
    case 'string': return JSON.stringify(v)
    case 'object': return 'a table'
    default: return String(v)
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Migration — 011 section 4.1. Older file: migrate IN MEMORY, never write the migrated result back
// to the listener's file. Newer file: load it, apply what is understood, say how many were not.
// ───────────────────────────────────────────────────────────────────────────────────────────

type Migration = (values: Record<string, unknown>, rejected: Rejection[]) => Record<string, unknown>

/**
 * `MIGRATIONS[n]` takes a record at schemaVersion `n` to schemaVersion `n + 1`.
 *
 * Version 1 is burned (011 section 4.2): 004 published `schemaVersion: 1` describing a schema that
 * was missing `orderedLists` and persisted a voice NAME.
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  1: (values, rejected) => {
    const out = { ...values }
    if ('synthesize.voice' in out) {
      const name = out['synthesize.voice']
      delete out['synthesize.voice']
      // The name is DROPPED rather than translated, and the listener is told. A voice name does not
      // port across platforms and there is zero overlap between the three namespaces (P28), so a
      // silent carry-forward would substitute the system default and look like it worked.
      out['synthesize.voiceIndex'] = null
      rejected.push({
        field: 'synthesize.voiceIndex',
        reason: `your old settings named a voice (${describe(name)}); voice names do not carry between machines, so the system default is in use until you pick one again`,
        usedDefault: null
      })
    }
    return out
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// parse()
// ───────────────────────────────────────────────────────────────────────────────────────────

/** Parse the inbox's TEXT. A whole-file syntax error is reported, never thrown. */
export function parseSettingsText(text: string, opts: ParseOptions = {}): ParseResult {
  const r = parseJsonc(text)
  if (r.error) return parse(undefined, { ...opts, fileError: r.error } as ParseOptions & { fileError: NonNullable<ParseResult['fileError']> })
  return parse(r.value, opts)
}

/**
 * Resolve one settings record from an envelope, the mirror and the schema.
 *
 * Precedence is PER FIELD, not per file (011 section 1.2a step 2): inbox field, then mirror field,
 * then schema default. One bad line costs one control.
 */
export function parse(
  input: unknown,
  opts: ParseOptions & { fileError?: ParseResult['fileError'] } = {}
): ParseResult {
  const rejected: Rejection[] = []
  const unknownFields: string[] = []
  const defaults = schemaDefaults()
  const mirror = opts.mirror ?? null

  let fileVersion: number = SCHEMA_VERSION
  let revision = 0
  let writtenAt: string | undefined
  let writtenBy: string | undefined
  let raw: Record<string, unknown> = {}
  let fileError = opts.fileError
  let migratedFrom: number | undefined

  if (fileError === undefined && input !== undefined && input !== null) {
    if (typeof input !== 'object' || Array.isArray(input)) {
      fileError = { message: 'the settings file is not a JSON object', line: null }
    } else {
      const env = input as Record<string, unknown>
      if (typeof env['kind'] === 'string' && env['kind'] !== SETTINGS_KIND) {
        fileError = { message: `this is not a settings file — its kind is ${describe(env['kind'])}`, line: null }
      } else {
        const sv = env['schemaVersion']
        if (typeof sv === 'number' && Number.isInteger(sv) && sv >= 1) fileVersion = sv
        else if (sv !== undefined) {
          rejected.push({ field: 'schemaVersion', reason: `expected a whole number, got ${describe(sv)}`, usedDefault: SCHEMA_VERSION })
        }
        const rev = env['revision']
        if (typeof rev === 'number' && Number.isInteger(rev) && rev >= 0) revision = rev
        else if (rev !== undefined) {
          rejected.push({ field: 'revision', reason: `expected a whole number, got ${describe(rev)}`, usedDefault: 0 })
        }
        if (typeof env['writtenAt'] === 'string') writtenAt = env['writtenAt']
        if (typeof env['writtenBy'] === 'string') writtenBy = env['writtenBy']
        const s = env['settings']
        if (s !== undefined && (typeof s !== 'object' || s === null || Array.isArray(s))) {
          fileError = { message: 'the "settings" block is not a JSON object', line: null }
        } else if (s) {
          raw = { ...(s as Record<string, unknown>) }
        }
      }
    }
  }

  // Migration chain, step by step, in memory only.
  if (fileError === undefined && fileVersion < SCHEMA_VERSION) {
    migratedFrom = fileVersion
    for (let v = fileVersion; v < SCHEMA_VERSION; v++) {
      const step = MIGRATIONS[v]
      if (step) raw = step(raw, rejected)
    }
  }
  if (fileError !== undefined) raw = {}

  // Per-field resolution.
  const out: Record<string, unknown> = {}
  for (const f of Object.values(SETTINGS_SCHEMA)) {
    if (isFuture(f)) continue
    const fallback = resolveFallback(f, mirror, defaults)
    if (!(f.id in raw)) { out[f.id] = fallback.value; continue }
    const v = validate(f, raw[f.id])
    if (v.ok) { out[f.id] = v.value; continue }
    out[f.id] = fallback.value
    rejected.push({ field: f.id, reason: `${v.reason} — using ${fallback.from}`, usedDefault: fallback.value })
  }

  // Ids the file carries that this build does not know. NOT an error: a newer plugin wrote them,
  // we load everything we understand and say how many we did not (011 section 4.2 — refusing the
  // file would leave a voice-first listener on default voice, default rate, default path style,
  // which is not a safe fallback, it is the failure).
  for (const id of Object.keys(raw)) {
    const f = SETTINGS_SCHEMA[id]
    if (f === undefined || isFuture(f)) unknownFields.push(id)
  }

  return {
    settings: out,
    revision,
    rejected,
    unknownFields,
    ...(migratedFrom !== undefined ? { migratedFrom } : {}),
    ...(fileError !== undefined ? { fileError } : {}),
    ...(writtenAt !== undefined ? { writtenAt } : {}),
    ...(writtenBy !== undefined ? { writtenBy } : {})
  }
}

function resolveFallback(
  f: FieldDescriptor,
  mirror: Mirror | null,
  defaults: Settings
): { value: unknown; from: 'the last settings I had' | 'the built-in default' } {
  if (mirror && f.id in mirror.values) {
    const m = validate(f, mirror.values[f.id])
    if (m.ok) return { value: m.value, from: 'the last settings I had' }
  }
  const dv = defaults[f.id]
  return { value: Array.isArray(dv) ? [...dv] : dv, from: 'the built-in default' }
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// The mirror
// ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The flat record written into ORCA's `settings:own` KV after a successful load.
 *
 * `__revision` is included ON PURPOSE (011 section 1.2, R7-27): without it the mirror cannot be
 * ordered against anything, and a starter file regenerated from it would restart at revision 1 —
 * permanently below whatever the listener's file had reached.
 */
export function toMirror(settings: Settings, revision: number, writtenAt?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [id, v] of Object.entries(settings)) out[id] = v
  out[MIRROR_ENVELOPE_KEYS.revision] = revision
  out[MIRROR_ENVELOPE_KEYS.schemaVersion] = SCHEMA_VERSION
  if (writtenAt !== undefined) out[MIRROR_ENVELOPE_KEYS.writtenAt] = writtenAt
  return out
}

/** Read a flat KV record back. Returns `null` for a genuinely first run. */
export function fromMirror(kv: Readonly<Record<string, unknown>> | null | undefined): Mirror | null {
  if (!kv) return null
  const rev = kv[MIRROR_ENVELOPE_KEYS.revision]
  if (typeof rev !== 'number' || !Number.isInteger(rev)) return null
  const sv = kv[MIRROR_ENVELOPE_KEYS.schemaVersion]
  const values: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(kv)) {
    if (k.startsWith('__')) continue
    values[k] = v
  }
  return { values, revision: rev, schemaVersion: typeof sv === 'number' ? sv : SCHEMA_VERSION }
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Promotion and the revision rule — 011 sections 1.2, 2.2
// ───────────────────────────────────────────────────────────────────────────────────────────

export interface SettingsSnapshot {
  readonly revision: number
  readonly values: Settings
}

export type PromotionOutcome =
  | { readonly promoted: true; readonly snapshot: SettingsSnapshot }
  | { readonly promoted: false; readonly code: 'stale_revision'; readonly reason: string }

/**
 * A write whose `revision` is not GREATER than the last promoted one is refused as
 * `stale_revision`. `writtenAt` is deliberately not the ordering key: clocks go backwards, files
 * get copied between machines, and a timestamp comparison would silently do the wrong thing on
 * exactly the machine that matters least often.
 *
 * At `activate()` there is no current snapshot, so the FIRST promotion of a session is never
 * refused; this governs subsequent promotions within a session only (011 section 1.2a).
 */
export function promote(current: SettingsSnapshot | null, next: SettingsSnapshot): PromotionOutcome {
  if (current !== null && next.revision <= current.revision) {
    return {
      promoted: false,
      code: 'stale_revision',
      reason: `revision ${next.revision} is not newer than the ${current.revision} already loaded`
    }
  }
  return { promoted: true, snapshot: next }
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Reporting — 011 sections 4.3 and 4.3a
// ───────────────────────────────────────────────────────────────────────────────────────────

/** The named predicate from 011 section 4.3a. Not a vibe — three facts the worker already has. */
export interface AudioEvidence {
  readonly huddleOn: boolean
  readonly speakRequestThisSession: boolean
}

export type ReportDestination = 'speak-now' | 'hold-for-first-utterance' | 'on-request-only'

/**
 * WHERE an unprompted settings report goes. The report is NEVER DROPPED in any configuration —
 * `on-request-only` and a held report both still answer `read-aloud.status`.
 */
export function reportDestination(channel: unknown, evidence: AudioEvidence): ReportDestination {
  switch (channel) {
    case 'always-spoken':
      return 'speak-now'
    case 'on-request-only':
      return 'on-request-only'
    default:
      return evidence.huddleOn || evidence.speakRequestThisSession ? 'speak-now' : 'hold-for-first-utterance'
  }
}

/**
 * The sentence a provider is handed. `null` for a clean load — a "settings loaded" chirp would
 * spend the listener's only channel on non-news.
 *
 * Names at most two fields plus a count (011 Q63, taste, `provisional`), by LABEL and never by
 * dotted id: "how a path is said" is a thing a listener can act on; `normalize.pathStyle` is not.
 */
export function settingsReportSentence(r: ParseResult): string | null {
  const parts: string[] = []

  if (r.fileError) {
    const where = r.fileError.line === null ? '' : ` on or near line ${r.fileError.line}`
    parts.push(`Your settings file could not be read${where}. I am using the last good settings.`)
  }

  if (r.rejected.length > 0) {
    const names = r.rejected.map((x) => SETTINGS_SCHEMA[x.field]?.label ?? x.field)
    const shown = names.slice(0, 2)
    const rest = names.length - shown.length
    const list = rest > 0 ? `${shown.join(', ')}, and ${rest} ${rest === 1 ? 'other' : 'others'}` : shown.join(' and ')
    const n = r.rejected.length
    parts.push(`${n === 1 ? 'One setting' : `${n} settings`} could not be read and ${n === 1 ? 'is' : 'are'} using ${n === 1 ? 'its' : 'their'} defaults: ${list}.`)
  }

  if (r.unknownFields.length > 0) {
    const n = r.unknownFields.length
    parts.push(`${n === 1 ? 'One setting' : `${n} settings`} in your file ${n === 1 ? 'is' : 'are'} newer than this version and ${n === 1 ? 'was' : 'were'} ignored.`)
  }

  if (r.migratedFrom !== undefined) {
    parts.push(`Your settings file is from an older version and was read forward. It has not been changed.`)
  }

  if (parts.length === 0) return null
  parts.push('Say status to hear the rest.')
  return parts.join(' ')
}
