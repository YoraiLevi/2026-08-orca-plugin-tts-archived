// Voice Lab — everything testable without a browser.
//
// NO TEST HERE PLAYS AUDIO. There is no AudioContext, no provider, no spawn. What is tested is the
// diff, the cache key, the settings serializer, the control inventory, the keyboard vocabulary and
// the earcon table — the parts that decide whether the instrument is correct, all of which are pure.
//
// Several of these carry a negative control on purpose. A round-trip that cannot fail is a check
// that both sides read the same file (P33, 004 section 7 step 4).

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { CONTROLS, PANELS, STAGES, FIXED_BY_DESIGN_STAGES, controlsForStage, controlById, defaultValues, speakValue, changeSentence, stepValue, numberWords } from './controls.mjs'
import { tokenize, lcsPairs, wordDiff, attribute } from './diff.mjs'
import { hash, keyFor, makeCache, KEYED_FIELDS } from './cache-key.mjs'
import { toSettingsFile, fromSettingsFile, saveDecision, serializeJsonc, stripJsonComments, SCHEMA_VERSION } from './settings.mjs'
import { BINDINGS, TRANSPORT, LAB_KEYS, verbFor, collisions } from './keys.mjs'
import { EARCONS, CONTROL_PITCHES, IDENTITY_PITCHES, schedule } from './earcons.mjs'
import { INLINED, inlineForm, extract } from '../build-inline.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const LAB = join(HERE, '..')
const REPO = join(LAB, '..')

describe('the control inventory, counted against 004 section 6', () => {
  it('is 46 controls in six panels', () => {
    expect(CONTROLS.length).toBe(46)
    expect(PANELS.length).toBe(6)
  })

  // 004 section 6: "omissions 7 · structure 7 · names and paths 9 · numbers 4 ·
  // voice and pacing 9 · interruptions and announcements 10".
  it('splits into the panel sizes the document states', () => {
    const per = Object.fromEntries(PANELS.map((p) => [p.id, CONTROLS.filter((c) => c.panel === p.id).length]))
    expect(per).toEqual({ A: 7, B: 7, C: 9, D: 4, E: 9, F: 10 })
  })

  it('carries 004\'s row numbers 1 to 46, each exactly once', () => {
    const rows = CONTROLS.map((c) => c.row).sort((a, b) => a - b)
    expect(rows).toEqual(Array.from({ length: 46 }, (_, i) => i + 1))
  })

  it('has unique ids and unique settings ids', () => {
    expect(new Set(CONTROLS.map((c) => c.id)).size).toBe(46)
    expect(new Set(CONTROLS.map((c) => c.settingsId)).size).toBe(46)
  })

  // 011 section 3.2: "46 controls, and the number that reach a typed options object today is 9
  // (5 normalize + 2 chunk + 2 synthesize)". A wire that quietly grew or shrank would mean the lab
  // is claiming a value lands somewhere it does not.
  it('claims exactly the ten wired controls 011 counts, and no more', () => {
    // TEN since J26 closed SC-8 (006 NM12): `num.expandUnits` was designed-not-wired and was in
    // fact governed by `num.expandIntegers`, a control claiming a stage it did not own. Splitting
    // `NormalizeOptions.expandUnits` out gave it its own wire. Hand-edited on purpose (P36).
    const wired = CONTROLS.filter((c) => c.wire !== null)
    expect(wired.length).toBe(10)
    const byPrefix = wired.reduce((acc, c) => {
      const k = c.wire.split('.')[0]
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {})
    expect(byPrefix).toEqual({ NormalizeOptions: 6, ChunkerOptions: 2, SynthesizeOptions: 2 })
  })

  it('never offers hex as a session label, and defaults the hex slider to zero', () => {
    // 003 section 6: "never, under any circumstance, hex". 007 C7 made this correctness, not taste.
    const label = controlById('announce.sessionLabel')
    expect(label.values).not.toContain('path-tail-3-plus-hash')
    expect(label.values.some((v) => /hex/i.test(v))).toBe(false)
    const hex = controlById('announce.sessionLabelHashChars')
    expect(hex.default).toBe(0)
    expect(hex.tier).toBe('more')
    expect(hex.warning).toBeTruthy()
  })

  it('speaks a value as a word, never as a bare number', () => {
    const depth = controlById('path.depthN')
    expect(speakValue(depth, 2)).toBe('two folders')
    expect(changeSentence(depth, 2)).toBe('How many folders, two folders.')
    expect(speakValue(controlById('voice.rate'), 1.5)).toBe('one point five times')
    // The gap slider's presets read as sentences, not as numerals.
    expect(speakValue(controlById('pace.simulateChunkGapMs'), 950)).toMatch(/nine hundred and fifty/)
  })

  it('steps a value by one notch and stops at the end rather than wrapping', () => {
    const style = controlById('path.style')  // spoken · terse · verbatim
    expect(stepValue(style, 'spoken', 1)).toBe('terse')
    expect(stepValue(style, 'spoken', -1)).toBe('spoken')
    expect(stepValue(style, 'verbatim', 1)).toBe('verbatim')
    const rate = controlById('voice.rate')
    expect(stepValue(rate, 1.0, 1)).toBe(1.05)   // no 1.0500000000000003
    expect(stepValue(rate, 2.0, 1)).toBe(2.0)
  })

  it('renders numbers as words up to the ranges the controls actually use', () => {
    expect(numberWords(0)).toBe('zero')
    expect(numberWords(2)).toBe('two')
    expect(numberWords(52)).toBe('fifty two')
    expect(numberWords(950)).toBe('nine hundred and fifty'.replace(' and', ''))
    expect(numberWords(20000)).toBe('twenty thousand')
  })
})

describe('the stage ladder agrees with the normalizer source', () => {
  // 004 section 4: "There are 15 transforms in normalize(), not 12. Three different counts exist in
  // the repo." J21 made it SIXTEEN by adding `stripHtmlComments` at stage 2.
  // the repo." Counting them here, from the source, is the only version of this check that can fail.
  it('lists the same sixteen transforms normalize() actually calls, in order', async () => {
    const src = await readFile(join(REPO, 'packages/core/src/normalizer/index.ts'), 'utf8')
    const body = src.slice(src.indexOf('export function normalize'))
    const called = [...body.slice(0, body.indexOf('\n}')).matchAll(/\bs = ([a-zA-Z]+)\(/g)]
      .map((m) => m[1])
    const unique = called.filter((n, i) => called.indexOf(n) === i)
    expect(unique).toEqual(STAGES)
    expect(STAGES.length).toBe(16)
  })

  it('marks the stages with no control as fixed by design, and no others', () => {
    const withoutControls = STAGES.map((_, i) => i + 1).filter((n) => controlsForStage(n).length === 0)
    expect(withoutControls).toEqual(FIXED_BY_DESIGN_STAGES)
  })

  it('gives every stage that has a control at least one that governs it', () => {
    for (let n = 1; n <= 16; n++) {
      if (FIXED_BY_DESIGN_STAGES.includes(n)) continue
      expect(controlsForStage(n).length).toBeGreaterThan(0)
    }
  })
})

describe('the page and the server agree about which control governs which stage', () => {
  // Two agents wrote these independently — the page's inventory (J13) and the server's ladder
  // (J12). If they disagree, a listener focuses a changed word and is sent to the wrong knob, and
  // nothing anywhere goes red. So the two are compared directly.
  it('matches scripts/voice-lab.mjs STAGES controlIds, stage for stage', async () => {
    const { STAGES: SERVER_STAGES } = await import(join(REPO, 'scripts/voice-lab.mjs'))
    expect(SERVER_STAGES).toHaveLength(16)
    for (const stage of SERVER_STAGES) {
      expect(STAGES[stage.n - 1], `stage ${stage.n} name`).toBe(stage.name)
      const mine = controlsForStage(stage.n).map((c) => c.id).sort()
      expect(mine, `stage ${stage.n} controls`).toEqual([...stage.controlIds].sort())
    }
  })

  it('resolves every control id the server names to a real control', async () => {
    const { STAGES: SERVER_STAGES } = await import(join(REPO, 'scripts/voice-lab.mjs'))
    for (const stage of SERVER_STAGES) {
      for (const id of stage.controlIds) expect(controlById(id), id).not.toBe(null)
    }
  })
})

describe('the word diff', () => {
  it('keeps offsets into the source string on every token', () => {
    const toks = tokenize('see index.ts now')
    expect(toks.map((t) => t.text)).toEqual(['see', 'index.ts', 'now'])
    expect(toks[1]).toMatchObject({ start: 4, end: 12 })
    expect('see index.ts now'.slice(toks[1].start, toks[1].end)).toBe('index.ts')
  })

  it('aligns on whole words, not characters', () => {
    // 004 Q24: `session_handler.py` -> `session handler, python` must NOT diff into a dozen
    // character fragments. Every op below is a whole token.
    const ops = wordDiff('see session_handler.py now', 'see session handler, python now')
    expect(ops.every((o) => !/\s/.test(o.text))).toBe(true)
    expect(ops.filter((o) => o.type === 'same').map((o) => o.text)).toEqual(['see', 'now'])
    expect(ops.filter((o) => o.type === 'del').map((o) => o.text)).toEqual(['session_handler.py'])
    expect(ops.filter((o) => o.type === 'add').map((o) => o.text)).toEqual(['session', 'handler,', 'python'])
  })

  it('finds the longest common subsequence, not merely a common prefix', () => {
    expect(lcsPairs(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd'])).toEqual([[0, 0], [2, 2], [3, 3]])
  })

  it('attributes each spoken word to the stage that produced it', () => {
    const source = 'see packages/core/index.ts now'
    const stages = [
      { n: 1, name: 'stripFencedCode', text: source },
      { n: 8, name: 'speakFilePaths', text: 'see file named index, typescript, in folder packages core now' },
      { n: 16, name: 'tidyPunctuation', text: 'see file named index, typescript, in folder packages core now' }
    ]
    const { spoken, removed } = attribute(source, stages)
    const byWord = Object.fromEntries(spoken.map((t) => [t.text, t.stage]))
    // Words that came through untouched are stage 0 — "you wrote this".
    expect(byWord.see).toBe(0)
    expect(byWord.now).toBe(0)
    // Words the path stage invented name that stage, so the page can name its control.
    expect(byWord.file).toBe(8)
    expect(byWord['typescript,']).toBe(8)
    expect(spoken.find((t) => t.text === 'file').stageName).toBe('speakFilePaths')
    // The raw path was dropped, by that same stage.
    expect(removed.map((t) => t.text)).toEqual(['packages/core/index.ts'])
    expect(removed[0].stage).toBe(8)
  })

  it('NEGATIVE CONTROL: a pipeline that changes nothing attributes nothing', () => {
    // Without this, the assertions above could pass on an attribute() that returned stage numbers
    // for every token unconditionally.
    const source = 'see index now'
    const { spoken, removed } = attribute(source, [
      { n: 1, name: 'stripFencedCode', text: source },
      { n: 16, name: 'tidyPunctuation', text: source }
    ])
    expect(spoken.every((t) => t.stage === 0)).toBe(true)
    expect(removed).toEqual([])
  })

  it('keeps character offsets into the SPOKEN string, which is what a word cursor will need later', () => {
    const source = 'a b'
    const spokenText = 'a b c'
    const { spoken } = attribute(source, [{ n: 13, name: 'expandNumbers', text: spokenText }])
    for (const t of spoken) expect(spokenText.slice(t.start, t.end)).toBe(t.text)
  })
})

describe('the AudioBuffer cache key', () => {
  it('is stable for identical inputs', () => {
    expect(keyFor('one two', { voice: 3, rate: 1 })).toBe(keyFor('one two', { voice: 3, rate: 1 }))
  })

  it('changes when the text changes', () => {
    expect(keyFor('one two', { voice: 3, rate: 1 })).not.toBe(keyFor('one three', { voice: 3, rate: 1 }))
  })

  it('changes when ANY keyed synthesize field changes', () => {
    // The whole two-second gate rests on a replay being a cache hit. A key that misses a field
    // serves yesterday's audio for today's voice, silently — which is the worse failure of the two.
    const base = { voice: 3, rate: 1, pitch: 0, volume: 100 }
    const baseKey = keyFor('one two', base)
    for (const field of KEYED_FIELDS) {
      const changed = { ...base, [field]: typeof base[field] === 'number' ? base[field] + 1 : 'x' }
      expect(keyFor('one two', changed), `${field} must move the key`).not.toBe(baseKey)
    }
  })

  it('does not depend on the order the caller wrote its object literal', () => {
    expect(keyFor('t', { rate: 1, voice: 3 })).toBe(keyFor('t', { voice: 3, rate: 1 }))
  })

  it('distinguishes an unset field from a falsy one', () => {
    expect(keyFor('t', {})).not.toBe(keyFor('t', { voice: 0, rate: 0 }))
  })

  it('hashes without collisions across a realistic body of chunk text', () => {
    const keys = new Set()
    for (let i = 0; i < 5000; i++) keys.add(keyFor(`sentence number ${i} of the fixture.`, { voice: 1, rate: 1 }))
    expect(keys.size).toBe(5000)
    expect(hash('')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('evicts least-recently-used, so a replay of what you just changed is still warm', () => {
    const cache = makeCache(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.get('a')            // touch a
    cache.set('c', 3)         // evicts b, not a
    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
    expect(cache.size).toBe(2)
  })
})

describe('the settings serializer', () => {
  it('emits 011\'s shape: flat dotted ids, schemaVersion 2, a revision', () => {
    const file = toSettingsFile(defaultValues(), { revision: 4 })
    expect(file.kind).toBe('orca-tts-settings')
    expect(file.schemaVersion).toBe(SCHEMA_VERSION)
    expect(SCHEMA_VERSION).toBe(2)
    expect(file.revision).toBe(4)
    expect(Object.keys(file.settings)).toHaveLength(46)
    expect(Object.keys(file.settings).every((k) => k.includes('.'))).toBe(true)
    expect(file.settings['normalize.pathStyle']).toBe('spoken')
    expect(file.provenance.platform).toBeDefined()
  })

  it('round-trips every control value', () => {
    const v = defaultValues()
    v['path.depthPolicy'] = 'last-n'
    v['path.depthN'] = 2
    v['ident.style'] = 'split-words'
    v['voice.rate'] = 1.25
    const back = fromSettingsFile(toSettingsFile(v, { revision: 1 }))
    expect(back.rejected).toEqual([])
    expect(back.unknown).toEqual([])
    expect(back.values).toEqual(v)
  })

  it('NEGATIVE CONTROL: mutating one field makes the round-trip comparison fail', () => {
    // 004 section 7 step 4. Without this the test above proves only that both sides read one file.
    const v = defaultValues()
    const file = toSettingsFile(v, { revision: 1 })
    file.settings['normalize.pathDepthN'] = 5
    expect(fromSettingsFile(file).values).not.toEqual(v)
  })

  it('falls back PER FIELD and reports what it rejected', () => {
    const file = toSettingsFile(defaultValues(), { revision: 1 })
    file.settings['normalize.pathStyle'] = 'shouted'      // not a legal value
    file.settings['normalize.pathDepthN'] = 99            // outside the range
    file.settings['chunk.maxUnits'] = 300                 // fine, and must survive the two above
    file.settings['normalize.somethingElse'] = true       // not in the schema at all
    const back = fromSettingsFile(file)
    expect(back.values['normalize.pathStyle'] ?? back.values['path.style']).toBe('spoken')
    expect(back.values['path.depthN']).toBe(2)
    expect(back.values['pace.chunkMaxUnits']).toBe(300)
    expect(back.rejected.map((r) => r.id).sort())
      .toEqual(['normalize.pathDepthN', 'normalize.pathStyle'])
    expect(back.unknown).toEqual(['normalize.somethingElse'])
  })

  it('refuses to save over a revision it did not last see', () => {
    expect(saveDecision(3, 3)).toEqual({ ok: true, nextRevision: 4 })
    const stale = saveDecision(3, 5)
    expect(stale.ok).toBe(false)
    expect(stale.nextRevision).toBe(null)
    expect(stale.reason).toMatch(/revision 3.*revision 5/)
  })

  it('writes JSONC a human can edit and a machine can still parse', () => {
    const file = toSettingsFile(defaultValues(), { revision: 2 })
    const text = serializeJsonc(file)
    expect(text).toMatch(/\/\/ How a path is said/)          // help at the point of edit
    expect(text).toMatch(/one of: spoken · terse · verbatim/) // legal values at the point of edit
    expect(text).toMatch(/designed, not yet wired/)           // the gap is stated, not hidden
    const parsed = JSON.parse(stripJsonComments(text))
    expect(parsed.settings['normalize.pathStyle']).toBe('spoken')
    expect(parsed.revision).toBe(2)
    expect(Object.keys(parsed.settings)).toHaveLength(46)
  })

  it('strips comments without eating a comment-like string value', () => {
    const text = '{ "a": "http://x//y", /* c */ "b": 1, } // end'
    expect(JSON.parse(stripJsonComments(text))).toEqual({ a: 'http://x//y', b: 1 })
  })
})

describe('the keyboard vocabulary, from 003 section 4a', () => {
  it('binds the four keys the design pins by name', () => {
    expect(verbFor({ key: ' ' })).toBe('play-pause')
    expect(verbFor({ key: 's' })).toBe('stop')
    expect(verbFor({ key: 'R' })).toBe('replay')
    expect(verbFor({ key: 'm' })).toBe('mute')
  })

  it('no key means two things on this surface', () => {
    expect(collisions()).toEqual([])
  })

  it('does not re-use the keys 4a moved, for what they used to mean', () => {
    // R is replay, not restore. m is mute, not more. S is not snapshot. `.` is a stop alias.
    expect(verbFor({ key: 'S' })).toBe(null)
    expect(verbFor({ key: 'M' })).toBe(null)
    expect(verbFor({ key: 'V' })).toBe(null)
    expect(verbFor({ key: ',' })).toBe(null)
    expect(verbFor({ key: '.' })).toBe('stop')
    expect(verbFor({ key: 'K' })).toBe('snapshot')
    expect(verbFor({ key: 'L' })).toBe('restore')
    expect(verbFor({ key: '+' })).toBe('more')
  })

  it('invents nothing: every binding appears in 003 section 4a', async () => {
    const src = await readFile(join(REPO, 'docs/.discussion/003-panel-and-control-channel.md'), 'utf8')
    const section = src.slice(src.indexOf('## 4a.'), src.indexOf('## 5.'))
    for (const b of [...TRANSPORT, ...LAB_KEYS]) {
      const token = b.key === ' ' ? 'Space' : b.key === 'Escape' ? 'Esc' : b.display
      expect(section.includes('`' + token + '`'), `${token} must be in 4a`).toBe(true)
    }
  })

  it('claims every key 4a assigns to the lab', () => {
    const bound = new Set(BINDINGS.map((b) => b.display))
    for (const expected of ['Space', 'p', 's', '.', 'R', 'm', '?', 'Esc', '↑', '↓', '←', '→', 'Tab', '+', '-', 'C', 'E', 'K', 'L', '1', '2']) {
      expect(bound.has(expected), `${expected} must be bound`).toBe(true)
    }
  })
})

describe('the earcons come from the reserved control band', () => {
  it('never uses an identity pitch', () => {
    const identity = new Set(Object.values(IDENTITY_PITCHES))
    for (const freq of Object.values(CONTROL_PITCHES)) expect(identity.has(freq)).toBe(false)
  })

  it('is never two notes, which is the identity band\'s shape', () => {
    for (const [id, spec] of Object.entries(EARCONS)) {
      expect(spec.notes.length, id).not.toBe(2)
      expect([1, 3]).toContain(spec.notes.length)
    }
  })

  it('gives the compare separator its 300 ms exception and everything else 150', () => {
    expect(EARCONS['control.compare'].totalMs).toBe(300)
    for (const [id, spec] of Object.entries(EARCONS)) {
      if (id !== 'control.compare') expect(spec.totalMs, id).toBe(150)
    }
  })

  it('schedules three-note earcons as three separate notes', () => {
    expect(schedule('control.play')).toHaveLength(1)
    expect(schedule('control.skip')).toHaveLength(3)
    expect(schedule('control.skip').map((n) => n.freq))
      .toEqual([CONTROL_PITCHES.C4, CONTROL_PITCHES.A4, CONTROL_PITCHES.E6])
    expect(schedule('nonexistent')).toEqual([])
  })
})

describe('the page itself', () => {
  it('inlines the lib modules verbatim — no drift between the source and the page', async () => {
    const html = await readFile(join(LAB, 'index.html'), 'utf8')
    for (const name of INLINED) {
      const source = await readFile(join(LAB, name), 'utf8')
      expect(extract(html, name), `${name} is not inlined`).toBe(inlineForm(source))
    }
  })

  it('fetches nothing off this machine', async () => {
    const html = await readFile(join(LAB, 'index.html'), 'utf8')
    // No CDN, no external stylesheet, no remote font, no remote script.
    expect(html).not.toMatch(/https?:\/\/(?!x\b)[^\s"')]+/g.source && /(src|href)\s*=\s*["']https?:/i)
    expect(html).not.toMatch(/<script[^>]+src=/i)
    expect(html).not.toMatch(/@import\s+url\(/i)
    // Every fetch target is a same-origin path.
    for (const m of html.matchAll(/\bapi\(\s*'([^']+)'/g)) expect(m[1].startsWith('/')).toBe(true)
  })

  it('makes no sound on load — P31, stated as a check that can fail', async () => {
    const html = await readFile(join(LAB, 'index.html'), 'utf8')
    const start = html.slice(html.indexOf('async function start ()'), html.indexOf('void start()'))
    expect(start).not.toMatch(/\bearcon\(/)
    expect(start).not.toMatch(/\bspeak\(/)
    expect(start).not.toMatch(/speakConfirmation\(/)
    // And the AudioContext is not constructed at module scope either.
    expect(html).not.toMatch(/^\s*(const|let)\s+ctx\s*=\s*new\s/m)
  })

  it('disables, rather than hides, the four affordances that need the bytes', async () => {
    const html = await readFile(join(LAB, 'index.html'), 'utf8')
    const fn = html.slice(html.indexOf('function enterSpokeElsewhere'), html.indexOf('function refuse'))
    expect(fn).toMatch(/disabled = true/)
    expect(fn).toMatch(/el\.title =/)                      // the reason is attached
    expect(fn).not.toMatch(/hidden = true/)                // 003 section 5: never hide
    expect(fn).toMatch(/NOT\s*'?\s*\+?\s*\n?\s*'?satisfiable/) // the gate statement is on screen
  })
})
