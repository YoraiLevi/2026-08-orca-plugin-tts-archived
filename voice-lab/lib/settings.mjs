// The settings serializer — docs/design/011-settings.md sections 3 and 7.
//
// The export format IS the settings format (004 section 7: Q35 resolved negative, so there is no
// host settings form and M11 and M12 fuse at the schema). Two documents describe the file and they
// do not agree: 004 section 7 shows a NESTED object at `schemaVersion: 1` with no `revision`;
// 011 sections 3.1 and 6 show one FLAT record of dotted ids at `schemaVersion: 2` with `revision`,
// and gives three reasons for flat (the KV mirror is flat, per-field fallback is a loop, T124 is a
// set comparison). 011 is the later document, it is the one the plugin worker reads, and it is the
// one that carries `revision`. This module emits 011's shape. `provenance` is kept from 004,
// because 011 section 9 Q64 depends on `provenance.platform` existing.
//
// This module is inlined verbatim into index.html; voice-lab/lib/inline.test.mjs fails if the
// two copies drift.

import { CONTROLS, PANELS, defaultValues } from './controls.mjs'

export const SCHEMA_VERSION = 2
export const KIND = 'orca-tts-settings'
export const LAB_VERSION = '0.1.0'

/** Build the settings file object from the lab's in-memory control values. */
export function toSettingsFile (values, { revision = 1, provenance = {}, writtenBy = `voice-lab/${LAB_VERSION}` } = {}) {
  const settings = {}
  for (const c of CONTROLS) {
    const v = values[c.id]
    settings[c.settingsId] = v === undefined ? c.default : v
  }
  return {
    kind: KIND,
    schemaVersion: SCHEMA_VERSION,
    revision,
    writtenBy,
    provenance: {
      tunedWith: provenance.tunedWith ?? 'os-synth',
      platform: provenance.platform ?? 'unknown',
      voiceListHash: provenance.voiceListHash ?? null,
      labVersion: LAB_VERSION,
      tunedAt: provenance.tunedAt ?? null
    },
    settings
  }
}

/**
 * Read a settings file back into control values, falling back PER FIELD (T123) and reporting what
 * it rejected. A whole-file throw would lose forty-five good values to one bad one.
 * @returns {{values: object, revision: number, rejected: {id:string, why:string}[], unknown: string[]}}
 */
export function fromSettingsFile (file) {
  const values = defaultValues()
  const rejected = []
  const unknown = []
  if (file == null || typeof file !== 'object') {
    return { values, revision: 0, rejected: [{ id: '(file)', why: 'not an object' }], unknown }
  }
  const record = file.settings && typeof file.settings === 'object' ? file.settings : {}
  const bySettingsId = new Map(CONTROLS.map((c) => [c.settingsId, c]))
  for (const [key, raw] of Object.entries(record)) {
    const control = bySettingsId.get(key)
    if (!control) { unknown.push(key); continue }
    const verdict = coerce(control, raw)
    if (verdict.ok) values[control.id] = verdict.value
    else rejected.push({ id: key, why: verdict.why })
  }
  const revision = Number.isInteger(file.revision) && file.revision >= 0 ? file.revision : 0
  return { values, revision, rejected, unknown }
}

function coerce (control, raw) {
  switch (control.kind) {
    case 'bool':
      return typeof raw === 'boolean' ? { ok: true, value: raw } : { ok: false, why: 'not a true/false value' }
    case 'enum':
      return control.values.includes(raw) ? { ok: true, value: raw } : { ok: false, why: `not one of ${control.values.join(', ')}` }
    case 'multi': {
      if (!Array.isArray(raw)) return { ok: false, why: 'not a list' }
      const bad = raw.find((v) => !control.values.includes(v))
      return bad === undefined ? { ok: true, value: raw.slice() } : { ok: false, why: `${bad} is not a legal entry` }
    }
    case 'int':
    case 'float': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return { ok: false, why: 'not a number' }
      if (control.kind === 'int' && !Number.isInteger(raw)) return { ok: false, why: 'not a whole number' }
      const { min, max } = control.range
      if (raw < min || raw > max) return { ok: false, why: `outside ${min} to ${max}` }
      return { ok: true, value: raw }
    }
    case 'template':
      if (typeof raw !== 'string') return { ok: false, why: 'not text' }
      if (control.maxLength && raw.length > control.maxLength) return { ok: false, why: `longer than ${control.maxLength} characters` }
      return { ok: true, value: raw }
    case 'map':
      return raw != null && typeof raw === 'object' && !Array.isArray(raw)
        ? { ok: true, value: { ...raw } }
        : { ok: false, why: 'not a table of entries' }
    case 'voice':
      return raw === null || typeof raw === 'number' || typeof raw === 'string'
        ? { ok: true, value: raw }
        : { ok: false, why: 'not a voice index' }
    default:
      return { ok: true, value: raw }
  }
}

/**
 * The Save guard — 011 section 7: the lab re-reads the file before every Save and refuses to save
 * over a revision it did not last see. Without this, a hand-edit made while the lab was open is
 * destroyed by the next Save with nothing said about it.
 * @param {number} lastSeen  the revision the lab read when it last loaded or saved
 * @param {number} onDisk    the revision just re-read from the file
 */
export function saveDecision (lastSeen, onDisk) {
  if (onDisk === lastSeen) return { ok: true, nextRevision: onDisk + 1 }
  return {
    ok: false,
    nextRevision: null,
    reason: `The settings file changed underneath the lab: it was revision ${lastSeen} when you loaded it and it is revision ${onDisk} now. Reload it, or overwrite it on purpose.`
  }
}

/**
 * Render the file as JSONC — 011 section 6. Comments are generated from the control inventory, so
 * a listener editing by hand reads what a control means AT THE POINT OF EDIT, and the comments
 * cannot drift from the code.
 */
export function serializeJsonc (file) {
  const lines = ['{']
  lines.push(`  "kind": ${JSON.stringify(file.kind)},`)
  lines.push(`  "schemaVersion": ${file.schemaVersion},`)
  lines.push(`  "revision": ${file.revision},`)
  lines.push(`  "writtenBy": ${JSON.stringify(file.writtenBy)},`)
  lines.push(`  "provenance": ${JSON.stringify(file.provenance)},`)
  lines.push('')
  lines.push('  "settings": {')
  const rows = []
  for (const panel of PANELS) {
    rows.push({ banner: panel.title })
    for (const c of CONTROLS.filter((x) => x.panel === panel.id)) rows.push({ control: c })
  }
  const written = []
  for (const row of rows) {
    if (row.banner) {
      written.push('')
      written.push(`    // ${'─'.repeat(3)} ${row.banner} ${'─'.repeat(Math.max(3, 64 - row.banner.length))}`)
      continue
    }
    const c = row.control
    written.push(`    // ${c.label}. ${c.help}`)
    if (c.kind === 'enum') written.push(`    //   one of: ${c.values.join(' · ')}`)
    if (c.range) written.push(`    //   ${c.range.min} to ${c.range.max}, in steps of ${c.range.step}`)
    if (c.wire === null) written.push('    //   designed, not yet wired: the plugin carries this value and does not read it yet.')
    written.push(`    ${JSON.stringify(c.settingsId)}: ${JSON.stringify(file.settings[c.settingsId])},`)
  }
  // Trailing commas are legal in JSONC, but a file a human reads should not end on one.
  const lastValue = written.map((l, i) => [l, i]).filter(([l]) => /^\s{4}"/.test(l)).pop()
  if (lastValue) written[lastValue[1]] = written[lastValue[1]].replace(/,$/, '')
  lines.push(...written)
  lines.push('  }')
  lines.push('}')
  return lines.join('\n') + '\n'
}

/** Strip `//` and block comments so JSON.parse can read a hand-edited JSONC file. */
export function stripJsonComments (text) {
  let out = ''
  let inString = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const d = text[i + 1]
    if (inLine) { if (c === '\n') { inLine = false; out += c } continue }
    if (inBlock) { if (c === '*' && d === '/') { inBlock = false; i++ } continue }
    if (inString) {
      out += c
      if (c === '\\') { out += d ?? ''; i++ } else if (c === '"') inString = false
      continue
    }
    if (c === '"') { inString = true; out += c; continue }
    if (c === '/' && d === '/') { inLine = true; i++; continue }
    if (c === '/' && d === '*') { inBlock = true; i++; continue }
    out += c
  }
  // Trailing commas, which JSONC tolerates and JSON.parse does not.
  return out.replace(/,(\s*[}\]])/g, '$1')
}
