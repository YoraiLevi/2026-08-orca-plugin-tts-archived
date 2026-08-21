/**
 * C4 — the settings round trip: the lab and the plugin speak the same string.
 *
 * `.meta/goal/voice-lab-m11/contract.md` C4:
 *
 *   > Settings exported from the lab, fed to `normalize()`, reproduce the lab's spoken text
 *   > byte-for-byte. Oracle: a test whose expected value is the lab's own emitted text captured
 *   > in a fixture, compared against a fresh `normalize()` — TWO INDEPENDENT PATHS TO ONE STRING.
 *
 * WHY THIS EXISTS. The author settles speech taste by ear in the Voice Lab (P23). Every minute
 * spent there is worth nothing unless the plugin then speaks EXACTLY what the lab spoke. A drift
 * between the two is silent: both produce plausible speech, and only a side-by-side comparison
 * reveals it. That is the failure shape of P22, where `P22` was spoken as "Ptwenty two" for
 * months because nothing compared one path against another.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────
 * THE TWO PATHS, AND WHY THEY ARE INDEPENDENT — READ THIS BEFORE "SIMPLIFYING" THIS FILE
 * ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   LAB PATH      lab control values
 *                   │  voice-lab/index.html `normalizeOptions()` — extracted from the PAGE'S OWN
 *                   │  BYTES at run time, keyed by the lab's CONTROL ids (`path.style`)
 *                   ▼
 *                 NormalizeOptions
 *                   │  HTTP POST /normalize to a real `createLabServer()` on a scratch port
 *                   ▼
 *                 scripts/voice-lab.mjs `computeStages()`  →  spoken text
 *
 *   PLUGIN PATH   the same lab control values
 *                   │  voice-lab/lib/settings.mjs `toSettingsFile()` + `serializeJsonc()`
 *                   ▼
 *                 JSONC TEXT (the file the listener actually gets), keyed by SETTINGS ids
 *                   │  packages/core/src/settings/jsonc.ts + parse.ts `parseSettingsText()`
 *                   ▼
 *                 Settings record
 *                   │  packages/core/src/settings/schema.ts `toNormalizeOptions()`
 *                   ▼
 *                 NormalizeOptions  →  `normalize()` called in-process  →  spoken text
 *
 * The two paths share NO code between the control values and the two strings:
 *
 *   1. Two different id namespaces. The lab projects from control ids (`path.style`,
 *      `num.expandIntegers`); the plugin projects from settings ids (`normalize.pathStyle`,
 *      `normalize.expandIntegers`). A mapping error in either is a divergence, not a no-op.
 *   2. Two different projection functions, in two different languages, in two different
 *      packages: a hand-written object literal in `index.html`, and a schema-table-driven
 *      `project()` in `schema.ts`. Neither imports the other.
 *   3. Only the plugin path is serialized. It goes to JSONC text and back through a parser with
 *      per-field fallback; the lab path never touches a file. A field the serializer drops, a
 *      comment the reader mis-scans, or a validator that rejects a legal value shows up here.
 *   4. Two different transports: HTTP into a separate server module, versus an in-process call.
 *
 * The ONE thing both paths end at is `normalize()` itself — which is the subject under test, not
 * the seam. If a future edit makes both sides call the same projection, the same serializer, or
 * the same options object, this file stops being a check and becomes a function compared with
 * itself (P36). The negative controls at the bottom exist to make that collapse visible.
 *
 * NO AUDIO. `/normalize` is the only endpoint driven, the provider is a stub, and the server is
 * closed in `afterAll` (P31 — the author is at this machine).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { parseSettingsText } from './parse.js'
import { SETTINGS_SCHEMA, isFuture, schemaDefaults, toNormalizeOptions } from './schema.js'
import { normalize } from '../normalizer/index.js'
import type { NormalizeOptions } from '../normalizer/index.js'

/* The lab is JavaScript with no type declarations, and it is not ours to change. The specifiers
 * are computed so `tsc` treats these as untyped rather than demanding `.d.ts` for voice-lab/. */
const LAB_SETTINGS_URL = new URL('../../../../voice-lab/lib/settings.mjs', import.meta.url).href
const LAB_CONTROLS_URL = new URL('../../../../voice-lab/lib/controls.mjs', import.meta.url).href
const LAB_SERVER_URL = new URL('../../../../scripts/voice-lab.mjs', import.meta.url).href

interface LabControl {
  readonly id: string
  readonly settingsId: string
  readonly kind: string
  readonly default: unknown
  readonly values?: readonly unknown[]
  readonly range?: { min: number; max: number; step: number }
  readonly maxLength?: number
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const labSettings: any = await import(LAB_SETTINGS_URL)
const labControls: any = await import(LAB_CONTROLS_URL)
const labServer: any = await import(LAB_SERVER_URL)
/* eslint-enable @typescript-eslint/no-explicit-any */

const CONTROLS: readonly LabControl[] = labControls.CONTROLS
const REPO_ROOT: string = labServer.REPO_ROOT

// ───────────────────────────────────────────────────────────────────────────────────────────
// The lab's own projection, taken from the page's bytes.
//
// `normalizeOptions()` lives in voice-lab/index.html and nowhere else — it is not in lib/, so it
// cannot be imported. Re-typing its body here would make this test compare our copy of the lab
// against the plugin, which is not the question. So the function is lifted out of the page source
// and evaluated. Edit the page's mapping and this test sees the edit.
// ───────────────────────────────────────────────────────────────────────────────────────────

function extractFunction(src: string, name: string): string {
  const start = src.indexOf(`function ${name} (`)
  if (start < 0) {
    throw new Error(
      `voice-lab/index.html no longer declares \`function ${name} (\`. This test drives the LAB's ` +
      'own projection from the page bytes; if it was renamed or moved, point the extractor at the ' +
      'new home — do not substitute a local copy, that collapses the two paths into one.'
    )
  }
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error(`unbalanced braces reading ${name} out of voice-lab/index.html`)
}

type Values = Record<string, unknown>
let labNormalizeOptions: (values: Values) => NormalizeOptions
let pageSource: string

// ───────────────────────────────────────────────────────────────────────────────────────────
// The settings sets. Defaults are the case LEAST likely to diverge: every default is the same
// literal on both sides, so a projection that ignored its input entirely would still pass.
// Each set below moves at least one wired field OFF its default.
// ───────────────────────────────────────────────────────────────────────────────────────────

interface SettingsSet {
  readonly name: string
  readonly why: string
  readonly overrides: Values
}

const SETTINGS_SETS: readonly SettingsSet[] = [
  {
    name: 'defaults',
    why: 'the baseline. Weakest of the six, and here only so the others have something to differ from.',
    overrides: {}
  },
  {
    name: 'verbatim paths, no extension word',
    why: "pathStyle 'verbatim' skips stage 8 entirely — the case where a lab/plugin mismatch on extensionStyle would be invisible on the other sets.",
    overrides: { 'path.style': 'verbatim', 'path.extensionStyle': 'omit' }
  },
  {
    name: 'terse paths, extension first',
    why: 'stage 8 on, but every one of its three inputs off its default.',
    overrides: { 'path.style': 'terse', 'path.extensionStyle': 'word-first' }
  },
  {
    name: 'code blocks dropped, numbers left alone',
    why: 'turns two independent stages OFF (1 and 12/13); an options object that failed to arrive would leave them on.',
    overrides: { 'omit.codeBlocks': 'drop', 'num.expandIntegers': false }
  },
  {
    name: 'ordinals spoken as words',
    why: "the one default the schema calls settled rather than provisional; 'word' is the value the lab can still choose.",
    overrides: { 'struct.orderedLists': 'word' }
  },
  {
    name: 'every wired normalize field off its default',
    why: 'all five at once, so a projection that drops one field is caught even if another masks it.',
    overrides: {
      'omit.codeBlocks': 'drop',
      'path.style': 'terse',
      'path.extensionStyle': 'raw-last',
      'num.expandIntegers': false,
      'struct.orderedLists': 'drop'
    }
  },
  {
    name: 'wired at defaults, 37 designed fields perturbed',
    why: 'a designed-not-wired field must carry its VALUE and change NOTHING spoken. If one leaks into speech, this set diverges from `defaults`; if one is dropped in transit, the designed-field round trip below catches it.',
    overrides: {}          // filled in beforeAll from perturbAllDesigned()
  }
]

/** A legal value for a control that is NOT its default — the whole point of a round-trip probe. */
function perturb(c: LabControl): unknown {
  switch (c.kind) {
    case 'bool':
      return c.default !== true
    case 'enum': {
      const other = (c.values ?? []).find((v) => v !== c.default)
      if (other === undefined) throw new Error(`${c.id}: enum with no second value to perturb to`)
      return other
    }
    case 'multi': {
      const all = [...(c.values ?? [])]
      return Array.isArray(c.default) && c.default.length > 0 ? [] : all
    }
    case 'int':
    case 'float': {
      const r = c.range
      if (r === undefined) throw new Error(`${c.id}: numeric control with no range`)
      const up = (c.default as number) + r.step
      return up <= r.max ? up : (c.default as number) - r.step
    }
    case 'template':
    case 'string': {
      const probe = `${String(c.default)} round-trip probe`
      return c.maxLength !== undefined && probe.length > c.maxLength
        ? probe.slice(0, c.maxLength)
        : probe
    }
    case 'map':
      return { ...(c.default as Record<string, string>), roundTripProbe: 'probe value' }
    case 'voice':
      return 3
    default:
      throw new Error(`${c.id}: unknown control kind ${c.kind} — this test does not know how to move it`)
  }
}

/** Every DESIGNED-not-wired control off its default; the nine wired ones untouched. */
function perturbAllDesigned(): Values {
  const wiredControlIds = new Set(
    Object.values(SETTINGS_SCHEMA)
      .filter((f) => f.wire !== null && !isFuture(f))
      .map((f) => f.id)
  )
  const out: Values = {}
  for (const c of CONTROLS) {
    if (wiredControlIds.has(c.settingsId)) continue
    out[c.id] = perturb(c)
  }
  return out
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// The known lab/schema disagreement, handled as a NAMED exception rather than absorbed.
//
// J11 (`docs/.research/settings-schema-report.md` F1): voice-lab/lib/controls.mjs row 40 declares
// `settingsId: 'lab.sessionLabelHashChars'`, while docs/design/011-settings.md section 3.2 says
// the schema must NOT carry it (008 X-04 / 007 C7 removed hex as a correctness matter). The schema
// follows 011 and does not have the field.
//
// Which side should change is the AUTHOR'S decision and has not been made. Neither side is edited
// here. The consequence is stated instead: the lab writes an id the plugin does not know, and
// `parse()` reports it in `unknownFields`. This test asserts EXACTLY that, so the round trip is
// green and the disagreement stays visible — the day it is resolved, this assertion goes red and
// names itself.
// ───────────────────────────────────────────────────────────────────────────────────────────
const LAB_ONLY_IDS = ['lab.sessionLabelHashChars'] as const

/**
 * Ids the SCHEMA carries that the lab has no control for, so the lab's serializer cannot write
 * them and they must come back as schema defaults. Also J11's arithmetic: 46 lab rows − 1 lab-only
 * + 2 schema-only = 47 shipping fields.
 */
const SCHEMA_ONLY_IDS = ['announce.reportChannel', 'apply.toQueued'] as const

// ───────────────────────────────────────────────────────────────────────────────────────────

let baseUrl: string
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let server: any
let fixtures: { name: string; text: string }[] = []

/** No audio, ever. `/normalize` never reaches the provider; this is belt and braces (P31). */
const silentProvider = {
  prepare: async () => {},
  // eslint-disable-next-line require-yield
  generate: async function* () { throw new Error('a round-trip test must never synthesize (P31)') },
  listVoices: async () => [],
  cancel: () => {},
  linuxBackend: null
}

beforeAll(async () => {
  pageSource = await readFile(join(REPO_ROOT, 'voice-lab/index.html'), 'utf8')
  const src = extractFunction(pageSource, 'normalizeOptions')
  // `values` is the page's own accessor; supplied as the argument so the lifted body runs unchanged.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const compiled = new Function('__v', `const values = () => __v\n${src}\nreturn normalizeOptions()`)
  labNormalizeOptions = (v: Values) => compiled(v) as NormalizeOptions

  const dir = join(REPO_ROOT, 'fixtures')
  const names = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()
  fixtures = await Promise.all(names.map(async (n) => ({ name: n, text: await readFile(join(dir, n), 'utf8') })))

  server = labServer.createLabServer({ provider: silentProvider })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  if (server) await new Promise<void>((ok) => server.close(() => ok()))
})

/** LAB PATH — through the page's projection and the server. */
async function labSpoken(values: Values, text: string): Promise<string> {
  const options = labNormalizeOptions(values)
  const res = await fetch(`${baseUrl}/normalize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, options })
  })
  const body = await res.json() as { spoken?: string; error?: string; why?: string }
  if (res.status !== 200) throw new Error(`lab /normalize returned ${res.status}: ${body.error} — ${body.why}`)
  return body.spoken ?? ''
}

/** PLUGIN PATH — through the lab's serializer, the JSONC reader, the schema and normalize(). */
function pluginSpoken(values: Values, text: string): { spoken: string; options: NormalizeOptions } {
  const file = labSettings.toSettingsFile(values, { revision: 1 })
  const jsonc: string = labSettings.serializeJsonc(file)
  const parsed = parseSettingsText(jsonc)
  const options = toNormalizeOptions(parsed.settings)
  return { spoken: normalize(text, options), options }
}

/** Full control values for a set: the lab's defaults with the set's overrides applied. */
function valuesFor(set: SettingsSet): Values {
  return { ...(labControls.defaultValues() as Values), ...set.overrides }
}

describe('C4 — settings exported from the lab reproduce the lab\'s spoken text byte-for-byte', () => {
  it('the extractor really lifted the lab\'s own projection, and it is non-trivial', () => {
    const src = extractFunction(pageSource, 'normalizeOptions')
    expect(src).toContain('function normalizeOptions')
    const opts = labNormalizeOptions(valuesFor(SETTINGS_SETS[0]!))
    // Five wired normalize fields today (011 section 3.2). A projection that silently returned {}
    // would make every equality below pass for the wrong reason.
    expect(Object.keys(opts).length).toBeGreaterThanOrEqual(5)
  })

  it('every settings set actually moves a wired value, so none of them is the defaults twice', () => {
    const base = JSON.stringify(labNormalizeOptions(valuesFor(SETTINGS_SETS[0]!)))
    const moved = SETTINGS_SETS.slice(1, 6)
      .filter((s) => JSON.stringify(labNormalizeOptions(valuesFor(s))) !== base)
    expect(moved.map((s) => s.name)).toHaveLength(5)
  })

  for (const set of SETTINGS_SETS) {
    describe(`settings set: ${set.name}`, () => {
      for (const fixtureName of ['architecture.md', 'code-heavy.md', 'hostile.md', 'paths.md', 'short.md', 'tables.md']) {
        it(`${fixtureName} — the lab's spoken text and the plugin's are the same bytes`, async () => {
          const fixture = fixtures.find((f) => f.name === fixtureName)
          expect(fixture, `fixture ${fixtureName} is missing from fixtures/`).toBeDefined()
          const values = valuesFor(set)
          const fromLab = await labSpoken(values, fixture!.text)
          const { spoken: fromPlugin, options } = pluginSpoken(values, fixture!.text)
          expect(fromLab.length).toBeGreaterThan(0)
          expect(
            fromPlugin,
            `LAB and PLUGIN disagree on ${fixtureName} under settings set "${set.name}".\n` +
            `  why this set exists: ${set.why}\n` +
            `  the options the PLUGIN path built: ${JSON.stringify(options)}\n` +
            `  the options the LAB path built:    ${JSON.stringify(labNormalizeOptions(values))}`
          ).toBe(fromLab)
        })
      }
    })
  }
})

describe('C4 — negative controls: this comparison can tell two strings apart', () => {
  it('two settings sets that differ in a wired field produce DIFFERENT spoken text', async () => {
    // Without this, byte-equality would be satisfied by a normalizer that ignored its options
    // entirely, and every assertion above would be free (P36).
    const a = valuesFor(SETTINGS_SETS[0]!)
    const b = valuesFor(SETTINGS_SETS[5]!)
    const fixture = fixtures.find((f) => f.name === 'paths.md')!
    const spokenA = await labSpoken(a, fixture.text)
    const spokenB = await labSpoken(b, fixture.text)
    expect(spokenA).not.toBe(spokenB)
    expect(pluginSpoken(a, fixture.text).spoken).not.toBe(pluginSpoken(b, fixture.text).spoken)
  })

  it('a settings value corrupted in transit changes what the plugin path speaks', () => {
    // Proves the plugin path really reads the SERIALIZED file rather than re-deriving from the
    // control values it was handed.
    const values = valuesFor(SETTINGS_SETS[0]!)
    const file = labSettings.toSettingsFile(values, { revision: 1 })
    const honest: string = labSettings.serializeJsonc(file)
    const tampered = honest.replace('"normalize.pathStyle": "spoken"', '"normalize.pathStyle": "verbatim"')
    expect(tampered).not.toBe(honest)
    const fixture = fixtures.find((f) => f.name === 'paths.md')!
    const viaHonest = normalize(fixture.text, toNormalizeOptions(parseSettingsText(honest).settings))
    const viaTampered = normalize(fixture.text, toNormalizeOptions(parseSettingsText(tampered).settings))
    expect(viaTampered).not.toBe(viaHonest)
  })

  it('the designed-field set speaks exactly what the defaults set speaks', async () => {
    // 37 designed-not-wired fields are all off their defaults in that set. If any of them reached
    // `normalize()`, this equality would break — and that would be a real finding, not a test bug.
    const fixture = fixtures.find((f) => f.name === 'architecture.md')!
    const defaults = await labSpoken(valuesFor(SETTINGS_SETS[0]!), fixture.text)
    const designed = await labSpoken(valuesFor(SETTINGS_SETS[6]!), fixture.text)
    expect(designed).toBe(defaults)
  })
})

describe('C4 — the designed-not-wired fields round-trip their VALUES', () => {
  // A designed field must carry its value across the file even though nothing consumes it. If it
  // does not, the option space silently stops being settleable the day a consumer appears — which
  // is P26 arriving one milestone late.
  const perturbed = perturbAllDesigned()
  const values: Values = { ...(labControls.defaultValues() as Values), ...perturbed }
  const file = () => labSettings.toSettingsFile(values, { revision: 7 })
  const parsed = () => parseSettingsText(labSettings.serializeJsonc(file()))

  it('the perturbation moved every designed control, not zero of them', () => {
    expect(Object.keys(perturbed).length).toBe(37)
  })

  it('nothing legal was rejected on the way through', () => {
    const r = parsed()
    expect(
      r.rejected.map((x) => `${x.field}: ${x.reason}`),
      'a value the lab can produce was refused by the plugin\'s validator — that is a divergence'
    ).toEqual([])
  })

  for (const c of CONTROLS) {
    if ((LAB_ONLY_IDS as readonly string[]).includes(c.settingsId)) continue
    it(`${c.settingsId} survives lab → JSONC → parse() unchanged`, () => {
      const expected = perturbed[c.id] ?? (schemaDefaults() as Values)[c.settingsId]
      expect(parsed().settings[c.settingsId]).toEqual(expected)
    })
  }

  it('the envelope round-trips too: kind, schemaVersion and revision', () => {
    const r = parsed()
    expect(r.revision).toBe(7)
    expect(r.fileError).toBeUndefined()
    expect(r.migratedFrom).toBeUndefined()
  })
})

describe('C4 — the lab/schema disagreement is named, not absorbed', () => {
  it('the lab writes lab.sessionLabelHashChars and the plugin reports it as unknown', () => {
    // docs/.research/settings-schema-report.md F1. The lab ships the control (controls.mjs row 40);
    // docs/design/011-settings.md section 3.2 forbids the schema from carrying it. NEITHER SIDE IS
    // EDITED HERE — which side changes is the author's decision. This asserts the consequence:
    // the value is written, it is not silently accepted, and it is not silently dropped either.
    const values = labControls.defaultValues() as Values
    const jsonc: string = labSettings.serializeJsonc(labSettings.toSettingsFile(values, { revision: 1 }))
    expect(jsonc).toContain('"lab.sessionLabelHashChars"')
    const r = parseSettingsText(jsonc)
    expect([...r.unknownFields]).toEqual([...LAB_ONLY_IDS])
    expect(r.rejected).toEqual([])
    for (const id of LAB_ONLY_IDS) expect(SETTINGS_SCHEMA[id]).toBeUndefined()
  })

  it('the two schema-only ids have no lab control and fall back to their schema defaults', () => {
    const labIds = new Set(CONTROLS.map((c) => c.settingsId))
    for (const id of SCHEMA_ONLY_IDS) {
      expect(labIds.has(id), `${id} now HAS a lab control — the asymmetry moved`).toBe(false)
      expect(SETTINGS_SCHEMA[id], `${id} is no longer in the schema`).toBeDefined()
    }
    const jsonc: string = labSettings.serializeJsonc(
      labSettings.toSettingsFile(labControls.defaultValues() as Values, { revision: 1 })
    )
    const r = parseSettingsText(jsonc)
    const defaults = schemaDefaults() as Values
    for (const id of SCHEMA_ONLY_IDS) expect(r.settings[id]).toEqual(defaults[id])
  })

  it('the inventories differ by exactly the three ids named above and no others', () => {
    // J11's arithmetic, restated by hand rather than imported (P36/P33): 46 lab rows − 1 lab-only
    // + 2 schema-only = 47 shipping schema fields. A new control on either side lands here.
    const labIds = CONTROLS.map((c) => c.settingsId)
    const schemaIds = Object.values(SETTINGS_SCHEMA).filter((f) => !isFuture(f)).map((f) => f.id)
    expect(labIds).toHaveLength(46)
    expect(schemaIds).toHaveLength(47)
    expect(labIds.filter((i) => !schemaIds.includes(i))).toEqual([...LAB_ONLY_IDS])
    expect(schemaIds.filter((i) => !labIds.includes(i))).toEqual([...SCHEMA_ONLY_IDS])
  })
})
