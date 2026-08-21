/**
 * T123 — per-field fallback, the revision rule, migration, and the report that has to be HEARD.
 *
 * The failure this file guards is not "the parser throws". It is the one the FMA found: of 55
 * silent-failure sites in this project, **the number reaching the audio stream was zero**. Every
 * report ended at `host.log` (wrapped in `catch {}`) or a desktop notification the author does not
 * look at. So the assertions below are on the SENTENCE a provider would be handed — never on a
 * callback firing — and every one of them has a control case, because a report that fires on every
 * launch regardless of file health passes the positive assertion just as well (P30, P33).
 */

import { describe, expect, it } from 'vitest'
import {
  parse, parseSettingsText, promote, toMirror, fromMirror, settingsReport, settingsReportSentence,
  reportDestination, SETTINGS_KIND, type SettingsSnapshot
} from './parse.ts'
import { parseJsonc, stripJsonComments } from './jsonc.ts'
import { SCHEMA_VERSION, SETTINGS_SCHEMA, schemaDefaults, MIRROR_ENVELOPE_KEYS } from './schema.ts'

const envelope = (settings: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  kind: SETTINGS_KIND, schemaVersion: SCHEMA_VERSION, revision: 5, settings, ...over
})

describe('T123 — one bad field falls back ALONE, and it names itself', () => {
  it('an invalid value costs exactly one control, not the other forty-six', () => {
    const r = parse(envelope({
      'normalize.pathStyle': 'sideways',        // not a legal value
      'normalize.extensionStyle': 'omit',       // fine
      'chunk.maxUnits': 40                      // fine
    }))
    expect(r.rejected.map((x) => x.field)).toEqual(['normalize.pathStyle'])
    expect(r.settings['normalize.pathStyle'], 'the bad field fell back').toBe('spoken')
    expect(r.settings['normalize.extensionStyle'], 'its neighbour survived').toBe('omit')
    expect(r.settings['chunk.maxUnits']).toBe(40)
    // CONTROL: the same file with the value corrected rejects NOTHING, so the rejection above is
    // shown to be caused by the value and not by the act of parsing.
    expect(parse(envelope({ 'normalize.pathStyle': 'terse' })).rejected).toEqual([])
  })

  it('each rejection names the field, why, and what is being used instead', () => {
    const r = parse(envelope({ 'chunk.maxUnits': 9_000, 'synthesize.rate': 'fast' }))
    expect(r.rejected).toHaveLength(2)
    const byField = Object.fromEntries(r.rejected.map((x) => [x.field, x]))
    expect(byField['chunk.maxUnits']!.reason).toContain('40 to 600')
    expect(byField['chunk.maxUnits']!.usedDefault).toBe(200)
    expect(byField['synthesize.rate']!.reason).toContain('expected a number')
  })

  it('a wholly unparseable file demotes the whole file — and says WHERE', () => {
    const text = '{\n  "kind": "orca-tts-settings",\n  "settings": {\n    "chunk.maxUnits": 40 "chunk.isolateFirstSentence": false\n  }\n}'
    const r = parseSettingsText(text)
    expect(r.fileError).toBeTruthy()
    expect(r.fileError!.line, 'the listener is told a line number they can go to').toBe(4)
    expect(r.settings['chunk.maxUnits']).toBe(200)
  })

  it('the mirror supplies the values a broken file cannot — this is the whole reason it exists', () => {
    const mirror = fromMirror({
      'synthesize.rate': 0.8, 'normalize.pathStyle': 'terse',
      [MIRROR_ENVELOPE_KEYS.revision]: 17, [MIRROR_ENVELOPE_KEYS.schemaVersion]: SCHEMA_VERSION
    })!
    const broken = parseSettingsText('{ not json', { mirror })
    expect(broken.settings['synthesize.rate'], 'fell back to the last good settings, not to bare defaults').toBe(0.8)
    expect(broken.settings['normalize.pathStyle']).toBe('terse')

    // CONTROL: with NO mirror, the same broken file yields the schema defaults. Without this row a
    // test asserting "the rate is 0.8" would pass just as well if 0.8 were the schema default.
    const noMirror = parseSettingsText('{ not json')
    expect(noMirror.settings['synthesize.rate']).toBe(1.0)
    expect(noMirror.settings['normalize.pathStyle']).toBe('spoken')
  })

  it('precedence is per field: inbox, then mirror, then schema default', () => {
    const mirror = fromMirror({
      'synthesize.rate': 0.8, 'chunk.maxUnits': 120,
      [MIRROR_ENVELOPE_KEYS.revision]: 17
    })!
    const r = parse(envelope({ 'synthesize.rate': 1.5 }), { mirror })
    expect(r.settings['synthesize.rate'], 'inbox wins').toBe(1.5)
    expect(r.settings['chunk.maxUnits'], 'mirror fills the gap').toBe(120)
    expect(r.settings['normalize.pathStyle'], 'schema default fills the rest').toBe('spoken')
  })

  it('a mirror value that is itself invalid does not poison the field', () => {
    const mirror = fromMirror({ 'synthesize.rate': 'quick', [MIRROR_ENVELOPE_KEYS.revision]: 3 })!
    expect(parse(envelope({}), { mirror }).settings['synthesize.rate']).toBe(1.0)
  })
})

describe('the report reaches a channel the listener actually has', () => {
  it('names at most two fields plus a count, by LABEL and never by dotted id', () => {
    const r = parse(envelope({
      'normalize.pathStyle': 'sideways',
      'chunk.maxUnits': 9_000,
      'synthesize.rate': 'fast',
      'queue.overflowPolicy': 'drop-middle'
    }))
    const s = settingsReportSentence(r)!
    expect(s).toContain('4 settings could not be read')
    expect(s).toContain(SETTINGS_SCHEMA['normalize.pathStyle']!.label)
    expect(s).toContain('and 2 others')
    expect(s, 'a dotted id is not a thing a listener can act on').not.toContain('normalize.pathStyle')
    expect(s).toContain('Say status')
  })

  it('CONTROL: a clean load says NOTHING — a "settings loaded" chirp spends the only channel on non-news', () => {
    expect(settingsReportSentence(parse(envelope({ 'chunk.maxUnits': 40 })))).toBeNull()
  })

  it('one bad field is spoken in the singular, because a sentence that says "1 settings" is a bug you can hear', () => {
    const s = settingsReportSentence(parse(envelope({ 'normalize.pathStyle': 'sideways' })))!
    expect(s).toContain('One setting could not be read and is using its default')
  })

  it('a newer file is loaded and the ignored count is said — refusing it would BE the failure', () => {
    const r = parse(envelope({ 'normalize.pathStyle': 'terse', 'omit.artifacts.something': true }, { schemaVersion: 9 }))
    expect(r.settings['normalize.pathStyle'], '45 working controls survive').toBe('terse')
    expect(r.unknownFields).toEqual(['omit.artifacts.something'])
    expect(settingsReportSentence(r)).toContain('One setting in your file is newer than this version')
  })

  it('a reserved id in the file is reported as newer, not silently applied', () => {
    const r = parse(envelope({ 'input.talkWindowMs': 4000 }))
    expect(r.unknownFields).toEqual(['input.talkWindowMs'])
    expect(r.settings['input.talkWindowMs']).toBeUndefined()
  })
})

describe('announce.reportChannel gates the UNPROMPTED channel, and never drops the report', () => {
  const bad = parse(envelope({ 'normalize.pathStyle': 'sideways' }))

  it('when-audio-in-use with no evidence HOLDS the report rather than speaking into an empty room', () => {
    const s = { ...schemaDefaults() }
    const rep = settingsReport(bad, s, { huddleOn: false, speakRequestThisSession: false })
    expect(rep.destination).toBe('hold-for-first-utterance')
    expect(rep.sentence, 'held, NOT discarded — a held report that expires silently is P30 in a polite uniform')
      .toBeTruthy()
  })

  it('CONTROL 1: huddle on is a standing request for audio, so the same file speaks now', () => {
    const rep = settingsReport(bad, schemaDefaults(), { huddleOn: true, speakRequestThisSession: false })
    expect(rep.destination).toBe('speak-now')
  })

  it('CONTROL 2: a clean file produces no sentence in ANY channel, so the report above is caused by the bad field and not by startup', () => {
    const clean = parse(envelope({}))
    for (const channel of ['always-spoken', 'when-audio-in-use', 'on-request-only']) {
      const rep = settingsReport(clean, { ...schemaDefaults(), 'announce.reportChannel': channel },
        { huddleOn: true, speakRequestThisSession: true })
      expect(rep.sentence).toBeNull()
    }
  })

  it('all three values behave differently — an option whose values are indistinguishable is not an option', () => {
    const none = { huddleOn: false, speakRequestThisSession: false }
    expect(reportDestination('always-spoken', none)).toBe('speak-now')
    expect(reportDestination('when-audio-in-use', none)).toBe('hold-for-first-utterance')
    expect(reportDestination('on-request-only', none)).toBe('on-request-only')
    expect(reportDestination('on-request-only', { huddleOn: true, speakRequestThisSession: true }))
      .toBe('on-request-only')
  })
})

describe('the revision rule', () => {
  const snap = (revision: number): SettingsSnapshot => ({ revision, values: {} })

  it('a write whose revision is not GREATER than the promoted one is refused as stale_revision', () => {
    const current = snap(17)
    expect(promote(current, snap(18)).promoted).toBe(true)
    const equal = promote(current, snap(17))
    expect(equal.promoted).toBe(false)
    expect(equal.promoted === false && equal.code).toBe('stale_revision')
    expect(promote(current, snap(3)).promoted).toBe(false)
  })

  it('the FIRST promotion of a session is never refused, because activate() has no snapshot yet', () => {
    expect(promote(null, snap(1)).promoted).toBe(true)
    expect(promote(null, snap(0)).promoted).toBe(true)
  })

  it('writtenAt is NOT the ordering key — clocks go backwards and files get copied between machines', () => {
    const older = parse(envelope({}, { revision: 20, writtenAt: '2000-01-01T00:00:00Z' }))
    const newer = parse(envelope({}, { revision: 19, writtenAt: '2030-01-01T00:00:00Z' }))
    expect(promote({ revision: older.revision, values: older.settings },
      { revision: newer.revision, values: newer.settings }).promoted)
      .toBe(false)
  })
})

describe('the mirror carries its own envelope', () => {
  it('__revision round-trips, so a regenerated starter file cannot restart below the listener\'s file', () => {
    const kv = toMirror({ 'synthesize.rate': 0.8 }, 17, '2026-08-21T14:02:11Z')
    expect(kv[MIRROR_ENVELOPE_KEYS.revision]).toBe(17)
    expect(kv[MIRROR_ENVELOPE_KEYS.schemaVersion]).toBe(SCHEMA_VERSION)
    const back = fromMirror(kv)!
    expect(back.revision).toBe(17)
    expect(back.values['synthesize.rate']).toBe(0.8)
    expect(Object.keys(back.values).some((k) => k.startsWith('__')), 'envelope keys are never settings')
      .toBe(false)
  })

  it('a mirror with no __revision is not a mirror — that is a genuinely first run', () => {
    expect(fromMirror({ 'synthesize.rate': 0.8 })).toBeNull()
    expect(fromMirror(null)).toBeNull()
    expect(fromMirror(undefined)).toBeNull()
  })
})

describe('migration from the burned version 1', () => {
  it('a v1 voice NAME is dropped and the listener is told, rather than silently substituted', () => {
    const r = parse({ kind: SETTINGS_KIND, schemaVersion: 1, revision: 2, settings: { 'synthesize.voice': 'Samantha' } })
    expect(r.migratedFrom).toBe(1)
    expect(r.settings['synthesize.voiceIndex']).toBeNull()
    expect(r.rejected.map((x) => x.field)).toContain('synthesize.voiceIndex')
    expect(settingsReportSentence(r)).toContain('older version')
    // CONTROL: a v2 file with the same shape migrates nothing and says nothing.
    const v2 = parse(envelope({ 'synthesize.voiceIndex': 1 }))
    expect(v2.migratedFrom).toBeUndefined()
    expect(settingsReportSentence(v2)).toBeNull()
  })

  it('a field version 1 never had simply takes its schema default', () => {
    const r = parse({ kind: SETTINGS_KIND, schemaVersion: 1, revision: 2, settings: {} })
    expect(r.settings['normalize.orderedLists']).toBe('numeral')
  })

  it('the migrated result is returned, never written back — the listener\'s file is theirs', () => {
    // Structural: `parse()` returns a value and has no writer. Asserted so a future refactor that
    // adds one has to delete this test deliberately.
    const before = { kind: SETTINGS_KIND, schemaVersion: 1, revision: 2, settings: { 'synthesize.voice': 'Alex' } }
    const copy = JSON.parse(JSON.stringify(before))
    parse(before)
    expect(before).toEqual(copy)
  })
})

describe('the JSONC reader', () => {
  it('keeps a // that lives inside a string, and drops the one that does not', () => {
    const text = `{
      // this line is a comment
      "announce.urlPhrase": "a link to //host", /* and this */
      "chunk.maxUnits": 40,
    }`
    const v = parseJsonc(text).value as Record<string, unknown>
    expect(v['announce.urlPhrase']).toBe('a link to //host')
    expect(v['chunk.maxUnits']).toBe(40)
  })

  it('replaces comment bytes with spaces, so a parse error still reports the right LINE', () => {
    const text = '{\n// comment\n"a": 1\n}'
    expect(stripJsonComments(text).split('\n').length).toBe(text.split('\n').length)
  })

  it('never throws — a syntax error is a reportable condition, not a crash', () => {
    expect(() => parseJsonc('{{{')).not.toThrow()
    expect(parseJsonc('{{{').error).toBeTruthy()
  })
})
