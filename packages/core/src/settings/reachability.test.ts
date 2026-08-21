/**
 * T124 — every option a consumer reads must be reachable from settings.
 *
 * PITFALLS **P26** is this test's whole reason for existing. `SynthesizeOptions.voice` and `.rate`
 * were declared in core, implemented by `OsSynthProvider` on all three platforms, and covered by
 * passing provider tests — and NO CALLER COULD REACH THEM. The chunker's `isolateFirstSentence` was
 * the same: only `maxUnits` was forwarded. The two settings every user asks for first were
 * unsettable in the shipped plugin, and nothing was red.
 *
 * So this file asserts four different things, because three of them can pass while the product is
 * broken:
 *
 *   (a) the key lists are exhaustive          — enforced by `tsc`, not here (see the guards beside
 *                                                each interface); adding an option without listing
 *                                                it fails to compile
 *   (b) the NAMES line up                     — every wire points at a real property, and every
 *                                                real property is reachable or NAMED as excluded
 *   (c) the VALUE ARRIVES                     — set it on the outermost object a caller constructs,
 *                                                assert the innermost consumer behaved differently,
 *                                                WITH the control case
 *   (d) the gap is COUNTED and printed        — 9 of 47 are wired, and that number must be watchable
 *
 * (b) is the half that goes red when someone adds `NormalizeOptions.dummyOption` and no descriptor.
 * (c) is the half P26 says is the actual check: (a) and (b) prove the names line up; they cannot
 * prove a value arrives.
 */

import { describe, expect, it } from 'vitest'
import { normalize } from '../normalizer/index.js'
import { Chunker } from '../chunker/index.js'
import type { SynthesizeOptions } from '../types/index.js'
import {
  SETTINGS_SCHEMA, SCHEMA_VERSION, isFuture, isWired, isOptionWired, wireProperty, schemaDefaults, gapReport,
  formatGapReport, toNormalizeOptions, toChunkerOptions, toSynthesizeOptions
} from './schema.js'
import { OPTION_KEYS, EXCLUDED, EXCLUSION_REASONS, WIRED_OWNERS, excludedCount } from './option-surface.js'
import { parse } from './parse.js'

/** The options object a wire may name, per owner. Restated here, not imported (P36). */
const OPTIONS_TYPE: Record<string, string> = {
  normalize: 'NormalizeOptions',
  chunk: 'ChunkerOptions',
  synthesize: 'SynthesizeOptions'
}

describe('T124 (b) — schema ids and the real option surfaces name the same properties', () => {
  for (const owner of WIRED_OWNERS) {
    const wired = Object.values(SETTINGS_SCHEMA)
      .filter((f) => f.owner === owner && isOptionWired(f))
      .map((f) => ({ id: f.id, wire: f.wire!, prop: wireProperty(f)! }))

    it(`${owner}: every schema field points at a real property of ${OPTIONS_TYPE[owner]}`, () => {
      const real = new Set(OPTION_KEYS[owner])
      for (const w of wired) {
        expect(w.wire.split('.')[0], `${w.id} names the wrong options type`).toBe(OPTIONS_TYPE[owner])
        expect(real, `${w.id} wires to ${w.wire}, which is not a property of ${OPTIONS_TYPE[owner]}`)
          .toContain(w.prop)
      }
    })

    it(`${owner}: every property of ${OPTIONS_TYPE[owner]} is reachable from settings, or named as excluded`, () => {
      const reachable = new Set(wired.map((w) => w.prop))
      const unreachable = OPTION_KEYS[owner].filter((k) => !reachable.has(k))
      // THIS is the assertion that goes red when a new option is added and no descriptor reaches
      // it. The failure message names the field, because "a set is not equal to a set" is not a
      // thing anyone can act on at 2am.
      for (const k of unreachable) {
        expect(
          EXCLUDED[owner],
          `${OPTIONS_TYPE[owner]}.${k} is not reachable from any settings field, and is not in EXCLUDED. Either add a FieldDescriptor with wire: '${OPTIONS_TYPE[owner]}.${k}', or add '${k}' to EXCLUDED.${owner} with its reason — a field that cannot be walked is not a setting, it is a comment (P26).`
        ).toContain(k)
      }
      // ...and in the other direction: an exclusion that no longer names a real property is a
      // stale allow-list entry, which is how an exclusion quietly starts hiding something else.
      for (const k of EXCLUDED[owner]) {
        expect(OPTION_KEYS[owner], `EXCLUDED.${owner} names '${k}', which is not a property of ${OPTIONS_TYPE[owner]} any more`)
          .toContain(k)
        expect(Object.keys(EXCLUSION_REASONS), `the exclusion ${owner}.${k} has no stated reason`)
          .toContain(`${owner}.${k}`)
      }
    })
  }

  it('no field claims a wire it cannot have: a reserved (future) field with a wire is a contradiction', () => {
    for (const f of Object.values(SETTINGS_SCHEMA)) {
      if (isFuture(f)) {
        expect(f.wire, `${f.id} is registered at since:${f.since} > ${SCHEMA_VERSION} but claims wire ${f.wire}`).toBeNull()
      }
    }
  })

  it('only the three option-surface owners carry a wire into a typed options object', () => {
    const optionTypes = new Set(Object.values(OPTIONS_TYPE))
    for (const f of Object.values(SETTINGS_SCHEMA)) {
      if (f.wire === null) continue
      const type = f.wire.split('.')[0]!
      if (!optionTypes.has(type)) {
        // e.g. announce.reportChannel -> SettingsReport.channel. Legal, but it must not be counted
        // as an options-surface wire, and its owner must not be one of the three.
        expect(WIRED_OWNERS as readonly string[]).not.toContain(f.owner)
      }
    }
  })
})

describe('T124 (c) — the value ARRIVES at the consumer, with its control case', () => {
  const FIXTURE = [
    '# Heading',
    '',
    '```ts',
    'const x = 1',
    '```',
    '',
    '1. open packages/core/src/normalizer/index.ts',
    '2. wait 52 ms'
  ].join('\n')

  /** A settings file that differs from EVERY wired default. */
  const TUNED = {
    kind: 'orca-tts-settings',
    schemaVersion: SCHEMA_VERSION,
    revision: 17,
    settings: {
      'normalize.codeBlocks': 'drop',
      'normalize.pathStyle': 'verbatim',
      'normalize.extensionStyle': 'omit',
      'normalize.expandIntegers': false,
      'normalize.orderedLists': 'drop',
      'chunk.maxUnits': 40,
      'chunk.isolateFirstSentence': false,
      'synthesize.voiceIndex': 1,
      'synthesize.rate': 0.8
    }
  }

  const DEFAULTS_ONLY = {
    kind: 'orca-tts-settings',
    schemaVersion: SCHEMA_VERSION,
    revision: 1,
    settings: {}
  }

  it('normalize: a tuned file changes what the NORMALIZER PRODUCES, not merely what the options object holds', () => {
    const tuned = parse(TUNED)
    expect(tuned.rejected).toEqual([])

    const spokenTuned = normalize(FIXTURE, toNormalizeOptions(tuned.settings))
    const spokenDefault = normalize(FIXTURE, toNormalizeOptions(parse(DEFAULTS_ONLY).settings))

    expect(spokenTuned).not.toBe(spokenDefault)

    // Each wired field, asserted on the OUTPUT — the innermost consumer — one at a time, so a
    // failure names which wire died rather than "the strings differ".
    expect(spokenDefault, 'codeBlocks default announces the omission').toContain('code block')
    expect(spokenTuned, "codeBlocks: 'drop' did not reach normalize()").not.toContain('code block')

    expect(spokenTuned, "pathStyle: 'verbatim' did not reach normalize()")
      .toContain('packages/core/src/normalizer/index.ts')
    expect(spokenDefault, 'pathStyle default speaks the path').not.toContain('packages/core/src/normalizer/index.ts')

    expect(spokenDefault, 'expandNumbers default expands 52').toContain('fifty two')
    expect(spokenTuned, 'expandIntegers: false did not reach normalize()').not.toContain('fifty two')

    // orderedLists 'drop' removes the ordinal that the default keeps.
    const listTuned = normalize('1. alpha\n2. beta', toNormalizeOptions(tuned.settings))
    const listDefault = normalize('1. alpha\n2. beta', toNormalizeOptions(parse(DEFAULTS_ONLY).settings))
    expect(listDefault, 'orderedLists default keeps the numeral').toMatch(/1|one/)
    expect(listTuned, "orderedLists: 'drop' did not reach normalize()").not.toMatch(/\b1\b|\bone\b/)

    // extensionStyle 'omit' is exercised through pathStyle 'spoken', since 'verbatim' skips the
    // stage entirely — a wire asserted only under a setting that disables its stage is not asserted.
    const extOmit = normalize('see src/main.ts', toNormalizeOptions({
      ...tuned.settings, 'normalize.pathStyle': 'spoken'
    }))
    expect(extOmit, "extensionStyle: 'omit' did not reach normalize()").not.toContain('typescript')
    expect(normalize('see src/main.ts', toNormalizeOptions(parse(DEFAULTS_ONLY).settings)))
      .toContain('typescript')
  })

  it('chunk: a tuned file changes what the CHUNKER EMITS', () => {
    const tuned = toChunkerOptions(parse(TUNED).settings)
    const control = toChunkerOptions(parse(DEFAULTS_ONLY).settings)

    expect(tuned).toEqual({ maxUnits: 40, isolateFirstSentence: false })
    expect(control).toEqual({ maxUnits: 200, isolateFirstSentence: true })

    const text = 'One short sentence. ' + 'Then a much longer second sentence that keeps going and going and going. '
    const cut = (opts: ReturnType<typeof toChunkerOptions>) => {
      const c = new Chunker(opts)
      return [...c.addText(text), ...c.finish()].map((x) => x.text)
    }
    const tunedChunks = cut(tuned)
    const controlChunks = cut(control)

    expect(tunedChunks.join(''), 'the chunker invariant holds either way').toBe(text)
    expect(controlChunks.join('')).toBe(text)
    expect(tunedChunks.length, 'chunk.maxUnits did not reach the Chunker').toBeGreaterThan(controlChunks.length)

    // isolateFirstSentence is asserted at a chunk size big enough for the flag to be the ONLY
    // thing deciding the first boundary — at maxUnits 40 the size cap decides it either way, and a
    // test that cannot distinguish the two would pass with the flag unwired.
    const roomy = { maxUnits: 200 }
    expect(cut({ ...roomy, isolateFirstSentence: true })[0], 'isolate=true sends sentence one alone')
      .toBe('One short sentence. ')
    expect(cut({ ...roomy, isolateFirstSentence: false })[0], 'isolate=false packs the first chunk')
      .not.toBe('One short sentence. ')
    // ...and that the SETTING selects between them, not the literal above.
    expect(cut(toChunkerOptions({ ...parse(TUNED).settings, 'chunk.maxUnits': 200 }))[0],
      'chunk.isolateFirstSentence did not reach the Chunker').not.toBe('One short sentence. ')
  })

  it('synthesize: a tuned file changes what the PROVIDER IS HANDED', () => {
    // The innermost consumer, stood up as the thing that records what it received. No audio device
    // is opened and no process is spawned — P31: the author is at this machine.
    const seen: SynthesizeOptions[] = []
    const provider = { generate: (_text: string, opts?: SynthesizeOptions) => { seen.push(opts ?? {}) } }
    const voices = ['Alex', 'Samantha', 'Daniel']

    provider.generate('x', toSynthesizeOptions(parse(TUNED).settings, (i) => voices[i]))
    expect(seen[0], 'synthesize.rate / voiceIndex did not reach the provider')
      .toEqual({ voice: 'Samantha', rate: 0.8 })

    // CONTROL: nothing tuned. The voice index is null, so no voice is claimed at all — and the rate
    // the provider receives is the SCHEMA's, which is the point of T122: there is no second default
    // anywhere on this path for it to disagree with.
    provider.generate('x', toSynthesizeOptions(parse(DEFAULTS_ONLY).settings, (i) => voices[i]))
    expect(seen[1]).toEqual({ rate: 1.0 })
    expect(seen[1]).not.toHaveProperty('voice')

    // CONTROL 2: an index the host's list does not reach is OMITTED, never guessed. A guessed voice
    // name exits zero and silently substitutes the default — the P26/P18 shape.
    provider.generate('x', toSynthesizeOptions({ ...parse(TUNED).settings, 'synthesize.voiceIndex': 99 }, (i) => voices[i]))
    expect(seen[2]).toEqual({ rate: 0.8 })
  })

  it('CONTROL: a defaults-only file hands every consumer exactly the schema defaults, and nothing else', () => {
    const s = parse(DEFAULTS_ONLY).settings
    const defaults = schemaDefaults()
    expect(toNormalizeOptions(s)).toEqual({
      codeBlocks: defaults['normalize.codeBlocks'],
      pathStyle: defaults['normalize.pathStyle'],
      extensionStyle: defaults['normalize.extensionStyle'],
      expandNumbers: defaults['normalize.expandIntegers'],
      orderedLists: defaults['normalize.orderedLists']
    })
    expect(toChunkerOptions(s)).toEqual({
      maxUnits: defaults['chunk.maxUnits'],
      isolateFirstSentence: defaults['chunk.isolateFirstSentence']
    })
    expect(toSynthesizeOptions(s)).toEqual({ rate: defaults['synthesize.rate'] })
  })
})

describe('T124 (d) — the gap report', () => {
  it('counts wired, designed-not-wired, excluded and future, and prints them', () => {
    const r = gapReport(excludedCount())
    // Restated as an INDEPENDENT claim, not derived from the schema (P36): a test that imports the
    // table it is checking cannot fail — delete a descriptor and the assertion would just iterate
    // one fewer row. These numbers must be edited by hand when the schema legitimately changes,
    // and that edit is the point: it makes a change to the listener's control surface a decision
    // visible in the diff.
    expect(r.total, 'shipping fields at schemaVersion 2').toBe(47)
    expect(r.wired, 'fields some consumer reads today').toBe(10)
    expect(r.optionSurfaceWired, '011 section 3.2: 5 normalize + 2 chunk + 2 synthesize').toBe(9)
    expect(r.designedNotWired, 'rendered and recorded; nothing consumes them yet').toBe(37)
    expect(r.excluded, 'named exclusions: chunk.countUnits, synthesize.signal').toBe(2)
    expect(r.future, 'ids reserved at since:3 by 011 section 4.2a').toBe(11)
    expect(r.provisional, 'defaults nobody has settled by ear').toBe(45)

    const text = formatGapReport(r)
    expect(text).toContain('of which options .... 9')
    // CI attaches this. An indicator nobody can read is an indicator nobody watches.
    // eslint-disable-next-line no-console
    console.log('\n' + text + '\n')
  })

  it('the 9 option-surface-wired fields are exactly these, by id', () => {
    // Restated independently (P36). 002 spec FR-012's list, expressed in schema ids.
    expect(Object.values(SETTINGS_SCHEMA).filter(isOptionWired).map((f) => f.id).toSorted()).toEqual([
      'chunk.isolateFirstSentence',
      'chunk.maxUnits',
      'normalize.codeBlocks',
      'normalize.expandIntegers',
      'normalize.extensionStyle',
      'normalize.orderedLists',
      'normalize.pathStyle',
      'synthesize.rate',
      'synthesize.voiceIndex'
    ])
  })

  it('the tenth wired field is the settings report itself, and it is not an options surface', () => {
    const extra = Object.values(SETTINGS_SCHEMA).filter((f) => isWired(f) && !isOptionWired(f))
    expect(extra.map((f) => f.id)).toEqual(['announce.reportChannel'])
    expect(extra[0]!.wire).toBe('SettingsReport.channel')
  })
})
