/**
 * T120 — the schema's own invariants.
 *
 * Every count below is RESTATED as an independent claim rather than derived from the table it
 * checks (PITFALLS **P36**): a test that imports the table it is checking cannot fail, because
 * deleting a row makes the assertion iterate one fewer time and pass. The cost is a real edit in
 * two places when the control surface legitimately changes — and that cost is the mechanism. A
 * change to what the listener can express should be visible in the diff as a decision.
 */

import { describe, expect, it } from 'vitest'
import {
  SCHEMA_VERSION, SETTINGS_SCHEMA, OWNERS, RESERVED_KEY_PREFIX, MIRROR_ENVELOPE_KEYS,
  fieldsByOwner, isFuture, schemaDefaults, type Owner
} from './schema.js'

const ALL = Object.values(SETTINGS_SCHEMA)
const SHIPPING = ALL.filter((f) => !isFuture(f))

describe('the schema is well-formed', () => {
  it('the record key and the descriptor id are the same string', () => {
    for (const [key, f] of Object.entries(SETTINGS_SCHEMA)) expect(f.id).toBe(key)
  })

  it('every id is <owner>.<name> — ownership is the structure, the panel is only a view', () => {
    for (const f of ALL) {
      expect(f.id.split('.')[0], `${f.id} is filed under owner "${f.owner}"`).toBe(f.owner)
      expect(f.id.split('.').length, `${f.id} must be exactly two dotted parts`).toBe(2)
      expect(OWNERS).toContain(f.owner)
    }
  })

  it('no id may start with the reserved mirror prefix', () => {
    // Otherwise a settings id could shadow `__revision` in the flat KV mirror and the mirror would
    // lose its ordering primitive — 011 section 1.2.
    for (const f of ALL) expect(f.id.startsWith(RESERVED_KEY_PREFIX), `${f.id} shadows the mirror envelope`).toBe(false)
    for (const k of Object.values(MIRROR_ENVELOPE_KEYS)) {
      expect(k.startsWith(RESERVED_KEY_PREFIX)).toBe(true)
      expect(SETTINGS_SCHEMA[k]).toBeUndefined()
    }
  })

  it('a settled default carries its reason; a provisional one does not need to invent one', () => {
    // P23 made structural: `provisional: true` means "this value was chosen so the plugin would run
    // and NOBODY HAS HEARD IT AND DECIDED". `provisional: false` is a claim, and a claim needs a
    // reason a reviewer can disagree with.
    for (const f of ALL) {
      if (!f.provisional) {
        expect(f.rationale, `${f.id} is marked settled but states no reason`).toBeTruthy()
        expect((f.rationale ?? '').length).toBeGreaterThan(20)
      }
    }
  })

  it('exactly two defaults are settled, and they are these two', () => {
    // Restated independently (P36). Everything else in 004/002 is explicitly taste, and marking it
    // settled by accident would quietly turn a listener's decision into a maintainer's.
    expect(ALL.filter((f) => !f.provisional).map((f) => f.id).toSorted())
      .toEqual(['normalize.orderedLists', 'queue.maxQueued'])
  })

  it('an enum names its legal values and defaults to one of them', () => {
    for (const f of ALL) {
      if (f.kind !== 'enum') continue
      expect(f.values, `${f.id} is an enum with no values`).toBeTruthy()
      expect(f.values!.length).toBeGreaterThan(1)
      expect(f.values, `${f.id} defaults to ${JSON.stringify(f.default)}, which is not a legal value`)
        .toContain(f.default)
    }
  })

  it('a number names its range and defaults inside it', () => {
    for (const f of ALL) {
      if (f.kind !== 'int' && f.kind !== 'float') continue
      expect(f.range, `${f.id} is a number with no range`).toBeTruthy()
      const { min, max, step } = f.range!
      expect(max).toBeGreaterThan(min)
      expect(step).toBeGreaterThan(0)
      const v = f.default as number
      expect(v, `${f.id} defaults to ${v}, outside ${min}..${max}`).toBeGreaterThanOrEqual(min)
      expect(v).toBeLessThanOrEqual(max)
      if (f.kind === 'int') expect(Number.isInteger(v), `${f.id} is an int defaulting to ${v}`).toBe(true)
    }
  })

  it('a multi-toggle defaults to a subset of its own values', () => {
    for (const f of ALL) {
      if (f.kind !== 'multi') continue
      expect(Array.isArray(f.default)).toBe(true)
      for (const v of f.default as readonly unknown[]) expect(f.values).toContain(v)
    }
  })

  it('every field has a label and a one-sentence help, because both are SPOKEN', () => {
    for (const f of ALL) {
      expect(f.label.length, `${f.id} has no label`).toBeGreaterThan(3)
      expect(f.help.length, `${f.id} has no help`).toBeGreaterThan(20)
      // The help becomes the generated comment in the starter file. A listener who must
      // cross-reference a separate document to know what a value means will not edit the file.
      expect(f.help.trim().endsWith('.'), `${f.id}'s help is not a sentence`).toBe(true)
    }
  })

  it('a lab-only field is owned by the lab, and no lab field claims a plugin consumer', () => {
    // The plugin must NEVER read `lab.*`. Asserting both directions is what stops a lab-only field
    // from quietly acquiring a plugin consumer later.
    for (const f of ALL) {
      if (f.owner === 'lab') {
        expect(f.effect, `${f.id} is a lab field with effect ${f.effect}`).toBe('lab-only')
        expect(f.wire, `${f.id} is lab-only and must have no plugin consumer`).toBeNull()
      }
      if (f.effect === 'lab-only') expect(f.owner).toBe('lab')
    }
  })

  it('a reserved field is registered at a version this build has not shipped', () => {
    for (const f of ALL) {
      expect(f.since, `${f.id} has a nonsensical since`).toBeGreaterThanOrEqual(2)
      if (isFuture(f)) expect(f.since).toBe(SCHEMA_VERSION + 1)
    }
  })
})

describe('the field inventory, by owner', () => {
  // Restated independently (P36), and per owner rather than as one total, so a field that moves
  // between owners is a visible edit rather than a silent no-op on the grand total.
  const EXPECTED: Record<Owner, { shipping: number; reserved: number }> = {
    normalize: { shipping: 23, reserved: 0 },
    chunk: { shipping: 2, reserved: 0 },
    synthesize: { shipping: 6, reserved: 0 },
    queue: { shipping: 3, reserved: 1 },
    announce: { shipping: 9, reserved: 0 },
    session: { shipping: 1, reserved: 4 },
    input: { shipping: 1, reserved: 6 },
    apply: { shipping: 1, reserved: 0 },
    lab: { shipping: 1, reserved: 0 }
  }

  for (const owner of OWNERS) {
    it(`${owner}: ${EXPECTED[owner].shipping} shipping, ${EXPECTED[owner].reserved} reserved`, () => {
      const fs = fieldsByOwner(owner)
      expect(fs.filter((f) => !isFuture(f)).length).toBe(EXPECTED[owner].shipping)
      expect(fs.filter(isFuture).length).toBe(EXPECTED[owner].reserved)
    })
  }

  it('47 fields ship at schemaVersion 2 and 11 more are reserved at 3', () => {
    expect(SCHEMA_VERSION).toBe(2)
    expect(SHIPPING.length).toBe(47)
    expect(ALL.length - SHIPPING.length).toBe(11)
  })

  it('the eleven reserved ids are exactly the ones 011 section 4.2a names', () => {
    expect(ALL.filter(isFuture).map((f) => f.id).toSorted()).toEqual([
      'input.paneFallbackWatch',
      'input.recognizerCommand',
      'input.resumePolicy',
      'input.talkGesture',
      'input.talkWindowIdleMs',
      'input.talkWindowMs',
      'queue.perSessionFairness',
      'session.followMax',
      'session.registryPollMs',
      'session.showUnregistered',
      'session.unregisteredWindowMs'
    ])
  })

  it('nine fields are engine-personal — a value tuned here does not transfer to another machine', () => {
    // P28: macOS, Windows and espeak-ng voice namespaces have ZERO overlap, and the same is true of
    // anything measured against a particular engine's timing.
    expect(SHIPPING.filter((f) => f.enginePersonal).map((f) => f.id).toSorted()).toEqual([
      'normalize.decimals',
      'normalize.headingPauseMs',
      'normalize.sentencePauseMs',
      'synthesize.interruptGranularity',
      'synthesize.pauseBackend',
      'synthesize.pitch',
      'synthesize.rate',
      'synthesize.voiceIndex',
      'synthesize.volume'
    ])
  })
})

describe('defaults come from the schema and nowhere else (T122)', () => {
  it('every shipping field has a default, and no reserved field appears', () => {
    const d = schemaDefaults()
    expect(Object.keys(d).length).toBe(SHIPPING.length)
    for (const f of SHIPPING) expect(f.id in d, `${f.id} has no default`).toBe(true)
    for (const f of ALL.filter(isFuture)) expect(f.id in d, `${f.id} is reserved and must not be defaulted`).toBe(false)
  })

  it('queue.maxQueued is 8 here, and this file is the only place that number exists', () => {
    // The live T122 violation this replaces: `main.ts` said 8, `speech-service.ts` said 20. Two
    // "defaults" for one control, neither from a schema.
    expect(schemaDefaults()['queue.maxQueued']).toBe(8)
    expect(SETTINGS_SCHEMA['queue.maxQueued']!.provisional).toBe(false)
  })

  it('the defaults record is a copy: mutating it cannot reach the schema', () => {
    const a = schemaDefaults() as Record<string, unknown>
    ;(a['normalize.codeBlockDetail'] as unknown[]).push('language')
    expect(schemaDefaults()['normalize.codeBlockDetail']).toEqual([])
  })
})
