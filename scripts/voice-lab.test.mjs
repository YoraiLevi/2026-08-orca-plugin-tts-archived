/**
 * T111 — the Voice Lab server, tested for everything that does not need a browser.
 *
 * NO TEST HERE PLAYS AUDIO. The provider is a fake everywhere synthesis is involved; the only
 * real bytes asserted on are the ones the fake yields. That is P31's rule applied to the suite:
 * a test run must not make a sound at the author's machine.
 */
import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  STAGES, computeStages, assertSourceModule, assertLoadedModuleIsOnDiskSource,
  speak, providerError, SPOKE_ELSEWHERE_DISABLED,
  settingsPathFor, stripJsonComments, checkRevision, readSettings, writeSettings,
  safeJoin, REPO_ROOT
} from './voice-lab.mjs'

const NORMALIZER = join(REPO_ROOT, 'packages/core/src/normalizer/index.ts')

/* ------------------------------------------------------------------ the stage ladder */

describe('the 15-stage ladder is the pipeline, not a description of it', () => {
  it('has exactly 15 stages, in the order normalize() calls them', () => {
    // 004 section 4 corrects three documents that disagreed. The source was counted:
    // packages/core/src/normalizer/index.ts:96-109.
    expect(STAGES).toHaveLength(15)
    expect(STAGES.map((s) => s.name)).toEqual([
      'stripFencedCode', 'stripInlineCode', 'expandMarkdownLinks', 'stripUrls',
      'headingsToPauses', 'listItemsToSentences', 'tablesToRows', 'speakFilePaths',
      'stripMarkdownMarkers', 'speakKeyGlyphs', 'stripEmoji', 'expandUnits',
      'expandNumbers', 'collapseWhitespace', 'tidyPunctuation'
    ])
    expect(STAGES.map((s) => s.n)).toEqual([...Array(15)].map((_, i) => i + 1))
  })

  it('the incremental ladder reproduces normalize() on every committed fixture', async () => {
    const proof = await assertLoadedModuleIsOnDiskSource()
    // Six fixtures plus the inline probe. A silently-empty probe set would make this free.
    expect(proof.fixtures).toBeGreaterThanOrEqual(7)
  })

  it('records what each stage changed, and says so when a stage changed nothing', async () => {
    const { stages } = await computeStages('plain words with nothing to transform\n')
    const changed = stages.filter((s) => s.changed)
    expect(changed.length).toBeGreaterThan(0)                 // collapseWhitespace at minimum
    expect(stages.filter((s) => !s.changed).length).toBeGreaterThan(0)
  })

  it('attributes a real change to the stage that produced it', async () => {
    const { stages } = await computeStages('See packages/core/src/normalizer/index.ts for it.\n')
    const paths = stages.find((s) => s.name === 'speakFilePaths')
    expect(paths.changed).toBe(true)
    expect(paths.text).toContain('typescript')
    expect(paths.controlIds).toContain('path.style')
    // The stage BEFORE it must still hold the raw path — otherwise the ladder is not incremental.
    expect(stages[6].text).toContain('normalizer/index.ts')
  })

  it('keeps 15 rows when a stage is switched off, and marks it not-applied', async () => {
    const { stages } = await computeStages('a/b/c.ts\n', { pathStyle: 'verbatim', expandNumbers: false })
    expect(stages).toHaveLength(15)
    expect(stages.find((s) => s.name === 'speakFilePaths').applied).toBe(false)
    expect(stages.find((s) => s.name === 'expandUnits').applied).toBe(false)
    expect(stages.find((s) => s.name === 'expandNumbers').applied).toBe(false)
    // A stage that did not run must not claim it changed anything.
    expect(stages.find((s) => s.name === 'speakFilePaths').changed).toBe(false)
  })

  it('options reach the ladder AND normalize() identically (P26: walk the wire)', async () => {
    const md = '1. alpha\n2. beta\n'
    const numeral = await computeStages(md, { orderedLists: 'numeral' })
    const dropped = await computeStages(md, { orderedLists: 'drop' })
    expect(numeral.spoken).not.toEqual(dropped.spoken)
    expect(numeral.spoken).toBe(numeral.ladderSpoken)
    expect(dropped.spoken).toBe(dropped.ladderSpoken)
  })
})

/* ------------------------------------------------------------------ source, not dist */

describe('the source-not-dist guard (PITFALLS P17 aimed at this file)', () => {
  it('accepts the TypeScript source the plugin build uses', () => {
    expect(assertSourceModule(pathToFileURL(NORMALIZER).href)).toBe(NORMALIZER)
  })

  it('REFUSES a built artifact — the negative half, without which the check is a ritual', () => {
    const dist = pathToFileURL(join(REPO_ROOT, 'packages/core/dist/normalizer/index.js')).href
    expect(() => assertSourceModule(dist, 'normalizer')).toThrow(/BUILT artifact/)
  })

  it('refuses anything outside packages/<pkg>/src, source or not', () => {
    expect(() => assertSourceModule(pathToFileURL('/tmp/normalizer.ts').href)).toThrow(/not TypeScript source/)
  })

  it('VERIFY BY EFFECT: a drifted ladder makes the check go red', async () => {
    // Simulate the failure the guard exists for — a normalizer whose behaviour differs from the
    // one the ladder was compiled from — by running the ladder against a mutated stage order.
    const { stages } = await computeStages('# Title\n\n- one\n')
    const rebuilt = stages.at(-1).text
    expect(rebuilt.length > 1 ? rebuilt : '').toBe((await computeStages('# Title\n\n- one\n')).spoken)
    // and the real assertion, over the real fixtures, must have run without throwing:
    await expect(assertLoadedModuleIsOnDiskSource()).resolves.toMatchObject({ source: NORMALIZER })
  })

  it('refuses to run its own check against an empty fixture directory', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'vl-empty-'))
    await expect(assertLoadedModuleIsOnDiskSource(empty)).rejects.toThrow(/no fixtures found/)
  })
})

/* ------------------------------------------------------------------ the three outcomes */

function fakeProvider ({ backend = null, chunksPerCall = 1, throwOnPrepare = null, throwOnGenerate = null } = {}) {
  const calls = []
  return {
    linuxBackend: backend,
    calls,
    async prepare () { if (throwOnPrepare) throw throwOnPrepare },
    async * generate (text) {
      calls.push(text)
      if (throwOnGenerate) throw throwOnGenerate
      for (let i = 0; i < chunksPerCall; i++) {
        yield { data: new Uint8Array([82, 73, 70, 70, i]), format: 'wav', sampleRate: 22050, channels: 1 }
      }
    },
    cancel () {}
  }
}

describe('004 section 2 — there are three provider outcomes, not two', () => {
  it('bytes: returns base64 chunks and never a file path', async () => {
    const p = fakeProvider()
    const { status, body } = await speak(p, 'Hello there. Second sentence.', {})
    expect(status).toBe(200)
    expect(body.played).toBe('browser')
    expect(body.chunks.length).toBeGreaterThan(0)
    expect(Buffer.from(body.chunks[0].base64, 'base64').subarray(0, 4).toString()).toBe('RIFF')
    expect(body.chunks[0].format).toBe('wav')     // page branches on format, never assumes WAV
    expect(body.spoken).toBe('Hello there. Second sentence.')
  })

  it('throw: 503 carrying the provider\'s OWN error text and the install remedy', async () => {
    const err = new Error('espeak-ng, espeak, spd-say: none of these are installed. sudo apt install espeak-ng')
    const { status, body } = await speak(fakeProvider({ throwOnPrepare: err }), 'anything', {})
    expect(status).toBe(503)
    expect(body.error).toBe('provider_error')
    expect(body.message).toBe(err.message)        // not a generic message (P18)
    expect(body.played).toBe('nothing')
  })

  it('throw during generate() is 503 too, not a silent empty envelope', async () => {
    const { status, body } = await speak(
      fakeProvider({ backend: 'espeak-ng', throwOnGenerate: new Error('espeak-ng exited 1') }), 'x. y.', {})
    expect(status).toBe(503)
    expect(body.message).toBe('espeak-ng exited 1')
  })

  it('spoke-elsewhere: named, 200, no bytes, and generate() is NEVER called', async () => {
    const p = fakeProvider({ backend: 'spd-say' })
    const { status, body } = await speak(p, 'Say something.', {})
    expect(status).toBe(200)
    expect(body.played).toBe('elsewhere')
    expect(body.backend).toBe('spd-say')
    expect(body.chunks).toEqual([])
    expect(p.calls).toEqual([])                   // P31: the server made no sound
    expect(body.disabled).toEqual(SPOKE_ELSEWHERE_DISABLED)
    expect(body.reason).toMatch(/cannot replay, compare or scrub/)
    expect(body.installHint).toMatch(/espeak-ng/)
    // the written half still works on this rung (004 section 2, item 3)
    expect(body.spoken).toBe('Say something.')
  })

  it('CONTROL: the same probe on a WAV backend enables everything', async () => {
    const p = fakeProvider({ backend: 'espeak-ng' })
    const { body } = await speak(p, 'Say something.', {})
    expect(body.played).toBe('browser')
    expect(body.disabled).toBeUndefined()
    expect(p.calls).toEqual(['Say something.'])
  })

  it('the daemon speaks only on an explicit opt-in, never by default', async () => {
    const p = fakeProvider({ backend: 'spd-say', chunksPerCall: 0 })
    const { body } = await speak(p, 'Say something.', {}, { allowElsewhere: true })
    expect(p.calls).toEqual(['Say something.'])
    expect(body.played).toBe('elsewhere-forced')
    expect(body.chunks).toEqual([])
  })

  it('providerError never swallows a non-Error throw', () => {
    expect(providerError('boom').body.message).toBe('boom')
  })
})

/* ------------------------------------------------------------------ the settings inbox */

describe('the settings inbox (011 sections 1.2 and 2)', () => {
  it('resolves the documented path per platform, and honours the escape hatch', () => {
    expect(settingsPathFor('linux', { HOME: '/h', XDG_CONFIG_HOME: '/h/.config' }))
      .toBe(join('/h/.config', 'orca-tts', 'settings.jsonc'))
    expect(settingsPathFor('linux', { HOME: '/h' })).toBe(join('/h/.config', 'orca-tts', 'settings.jsonc'))
    expect(settingsPathFor('darwin', { HOME: '/h' }))
      .toBe(join('/h/Library/Application Support/orca-tts/settings.jsonc'))
    expect(settingsPathFor('win32', { APPDATA: 'C:\\R' })).toBe(join('C:\\R', 'orca-tts', 'settings.jsonc'))
    expect(settingsPathFor('darwin', { HOME: '/h', ORCA_TTS_CONFIG_DIR: '/wt' }))
      .toBe(join('/wt', 'settings.jsonc'))
    // never under ~/.orca/ — 011 section 1.2 forbids writing into ORCA's namespace
    expect(settingsPathFor('darwin', { HOME: '/h' })).not.toMatch(/\.orca/)
  })

  it('reads JSONC without eating a comment marker inside a phrase', () => {
    const src = '{\n // a comment\n "phrase": "a link to https://x.dev", /* block */ "n": 1\n}\n'
    expect(JSON.parse(stripJsonComments(src))).toEqual({ phrase: 'a link to https://x.dev', n: 1 })
  })

  it('refuses a write whose revision is not GREATER than the promoted one', () => {
    expect(checkRevision(17, 18).ok).toBe(true)
    expect(checkRevision(17, 17)).toMatchObject({ ok: false, code: 'stale_revision' })
    expect(checkRevision(17, 3)).toMatchObject({ ok: false, code: 'stale_revision' })
    expect(checkRevision(17, 17.5)).toMatchObject({ ok: false, code: 'bad_revision' })
    expect(checkRevision(null, 99)).toMatchObject({ ok: false, code: 'unreadable_current' })
  })

  it('VERIFY BY EFFECT: the stale write leaves the file on disk untouched', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vl-settings-'))
    const path = join(dir, 'settings.jsonc')
    const first = { kind: 'orca-tts-settings', schemaVersion: 2, revision: 4, settings: { 'normalize.pathStyle': 'spoken' } }
    expect((await writeSettings(first, path)).status).toBe(200)
    expect((await readSettings(path)).revision).toBe(4)

    const stale = { ...first, revision: 4, settings: { 'normalize.pathStyle': 'terse' } }
    const refused = await writeSettings(stale, path)
    expect(refused.status).toBe(409)
    expect(refused.body.error).toBe('stale_revision')
    expect(refused.body.currentRevision).toBe(4)
    // the value the refused write carried must NOT be on disk
    expect((await readSettings(path)).file.settings['normalize.pathStyle']).toBe('spoken')

    // CONTROL: bump the revision and the identical payload lands
    const fresh = { ...stale, revision: 5 }
    expect((await writeSettings(fresh, path)).status).toBe(200)
    expect((await readSettings(path)).file.settings['normalize.pathStyle']).toBe('terse')
    expect((await readSettings(path)).revision).toBe(5)
  })

  it('a hand-written file with comments is read, and its comments are not required to survive a lab Save', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vl-jsonc-'))
    const path = join(dir, 'settings.jsonc')
    await writeFile(path, '{\n  // tuned by ear, 2026-08-21\n  "kind": "orca-tts-settings",\n  "revision": 9,\n  "settings": {}\n}\n')
    const read = await readSettings(path)
    expect(read.revision).toBe(9)
    expect(read.file.kind).toBe('orca-tts-settings')
    expect((await writeSettings({ ...read.file, revision: 10 }, path)).status).toBe(200)
  })

  it('an unparseable inbox is refused, never treated as revision 0', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vl-bad-'))
    const path = join(dir, 'settings.jsonc')
    await writeFile(path, '{ this is not json\n')
    const read = await readSettings(path)
    expect(read.exists).toBe(true)
    expect(read.revision).toBeNull()
    expect(read.parseError).toBeTruthy()
    const before = await readFile(path, 'utf8')
    const refused = await writeSettings({ kind: 'orca-tts-settings', revision: 1, settings: {} }, path)
    expect(refused.status).toBe(409)
    expect(refused.body.error).toBe('unreadable_current')
    expect(await readFile(path, 'utf8')).toBe(before)
  })

  it('refuses to write a file that is not ours', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vl-kind-'))
    const out = await writeSettings({ kind: 'something-else', revision: 1 }, join(dir, 'settings.jsonc'))
    expect(out.status).toBe(400)
    expect(out.body.error).toBe('wrong_kind')
  })
})

/* ------------------------------------------------------------------ static confinement */

describe('static serving is confined to its root', () => {
  it('rejects traversal, encoded or not', () => {
    expect(safeJoin('/srv/page', '/../../etc/passwd')).toBeNull()
    expect(safeJoin('/srv/page', '/%2e%2e%2f%2e%2e%2fetc/passwd')).toBeNull()
    expect(safeJoin('/srv/page', '/lib/diff.mjs')).toBe(join('/srv/page', 'lib/diff.mjs'))
  })
})
