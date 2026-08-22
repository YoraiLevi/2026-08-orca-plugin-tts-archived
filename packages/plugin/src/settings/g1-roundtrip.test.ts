/**
 * G1 — a value exported from the Voice Lab reaches the PLUGIN's ears, byte for byte.
 *
 * `.meta/goal/phase2-m12-m17/contract.md` G1:
 *
 *   > A value exported from the Voice Lab, placed in ORCA settings, produces **byte-identical**
 *   > speech to the lab's own output. Oracle: a test whose expected value comes from the lab's
 *   > captured output, compared against **the plugin's read path** — two independent paths to one
 *   > string.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `roundtrip.test.ts`. That file (core, C4) already compares
 * the lab against `normalize()` and the `Chunker` called in-process, and it is excellent at that.
 * What it cannot see is everything G1 is actually about: whether `activate()` finds the file at
 * all, whether the plugin's own resolution of the inbox path is right, whether the snapshot
 * reaches `SpeechService`, whether it survives the queue, and whether the provider is handed the
 * tuned chunks or the schema defaults. Until this file existed, all of core's settings work was
 * reachable by nobody: the plugin never read a settings file (P26 — an option nobody can pass is
 * invisible to every test you would think to write).
 *
 * ---------------------------------------------------------------------------------------------
 * THE TWO PATHS. READ THIS BEFORE "SIMPLIFYING" THIS FILE.
 * ---------------------------------------------------------------------------------------------
 *
 *   LAB PATH     lab control values (control ids: `path.style`, `pace.chunkMaxUnits`)
 *                  |  `normalizeOptions()` + `chunkOptions()` LIFTED FROM voice-lab/index.html's
 *                  |  OWN BYTES at run time — not a copy re-typed here
 *                  v
 *                NormalizeOptions / ChunkerOptions
 *                  |  HTTP POST /normalize to a real `createLabServer()` on a scratch port
 *                  v
 *                spoken text  ->  `new Chunker(labChunkOptions)`  ->  the utterances the LAB plays
 *
 *   PLUGIN PATH  the same lab control values
 *                  |  voice-lab/lib/settings.mjs `toSettingsFile()` + `serializeJsonc()`
 *                  v
 *                JSONC TEXT, written to a REAL FILE in a REAL INBOX DIRECTORY
 *                  |  `activate(orca, { settingsDir })` — the outermost object ORCA constructs
 *                  |  -> `loadSettings()` -> `parse()` -> `SettingsRuntime` -> `SpeechService`
 *                  |  -> `normalize()` -> `Chunker` -> `provider.generate(chunk.text, opts)`
 *                  v
 *                the strings a RECORDING PROVIDER was actually handed
 *
 * They share no code between the control values and the two string arrays: two id namespaces, two
 * projection functions in two languages, only one of them serialized through a file, and only one
 * of them going through a plugin activation, a command registry, a huddle transcript read and a
 * playback queue. The one thing both end at is `normalize()`/`Chunker`, which are the subject, not
 * the seam.
 *
 * NO AUDIO, EVER (P31 — the author is at this machine). The provider is a recorder that yields one
 * fake byte, the sink is a no-op, and the lab server's provider throws if anything asks it to
 * synthesize. NOTHING outside the test's own `mkdtemp` directory is read or written: `settingsDir`
 * and `projectsDir` are both temp roots, so the author's real inbox and real transcripts are never
 * touched.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { Chunker } from '@orca-tts/core'
import type {
  AudioChunk, ChunkerOptions, NormalizeOptions, PlaybackSink, ProviderCapabilities,
  SynthesizeOptions, TtsProvider
} from '@orca-tts/core'
import activate from '../main.ts'
import type { OrcaApi } from '../adapter/index.ts'

/* The lab is JavaScript with no type declarations and it is not ours to change. Specifiers are
 * computed so `tsc` treats these as untyped rather than demanding `.d.ts` for voice-lab/. */
const LAB_SETTINGS_URL = new URL('../../../../voice-lab/lib/settings.mjs', import.meta.url).href
const LAB_CONTROLS_URL = new URL('../../../../voice-lab/lib/controls.mjs', import.meta.url).href
const LAB_SERVER_URL = new URL('../../../../scripts/voice-lab.mjs', import.meta.url).href

/* eslint-disable @typescript-eslint/no-explicit-any */
const labSettings: any = await import(LAB_SETTINGS_URL)
const labControls: any = await import(LAB_CONTROLS_URL)
const labServer: any = await import(LAB_SERVER_URL)
/* eslint-enable @typescript-eslint/no-explicit-any */

const REPO_ROOT: string = labServer.REPO_ROOT
type Values = Record<string, unknown>

// ---------------------------------------------------------------------------------------------
// The lab's own projections, taken from the page's bytes — never re-typed here.
// ---------------------------------------------------------------------------------------------

function extractFunction(src: string, name: string): string {
  const start = src.indexOf(`function ${name} (`)
  if (start < 0) {
    throw new Error(
      `voice-lab/index.html no longer declares \`function ${name} (\`. This test drives the LAB's ` +
      'own projection from the page bytes; if it moved, point the extractor at the new home — do ' +
      'not substitute a local copy, that collapses the two paths into one (P36).'
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

let labNormalizeOptions: (v: Values) => NormalizeOptions
let labChunkOptions: (v: Values) => ChunkerOptions
let baseUrl: string
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let server: any
let fixtureText: string

const silentProvider = {
  prepare: async () => {},
  // eslint-disable-next-line require-yield
  generate: async function* () { throw new Error('a G1 round-trip must never synthesize (P31)') },
  listVoices: async () => [],
  cancel: () => {},
  linuxBackend: null
}

beforeAll(async () => {
  const page = await readFile(join(REPO_ROOT, 'voice-lab/index.html'), 'utf8')
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const cn = new Function('__v', `const values = () => __v\n${extractFunction(page, 'normalizeOptions')}\nreturn normalizeOptions()`)
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const cc = new Function('__v', `const values = () => __v\n${extractFunction(page, 'chunkOptions')}\nreturn chunkOptions()`)
  labNormalizeOptions = (v) => cn(v) as NormalizeOptions
  labChunkOptions = (v) => cc(v) as ChunkerOptions

  fixtureText = await readFile(join(REPO_ROOT, 'fixtures/paths.md'), 'utf8')

  server = labServer.createLabServer({ provider: silentProvider })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  if (server) await new Promise<void>((ok) => server.close(() => ok()))
})

/** LAB PATH — the utterances the lab itself would play, in order. */
async function labUtterances(values: Values, text: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/normalize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, options: labNormalizeOptions(values) })
  })
  const body = await res.json() as { spoken?: string; error?: string; why?: string }
  if (res.status !== 200) throw new Error(`lab /normalize returned ${res.status}: ${body.error} — ${body.why}`)
  const c = new Chunker(labChunkOptions(values))
  return [...c.addText(body.spoken ?? ''), ...c.finish()].map((x) => x.text)
}

// ---------------------------------------------------------------------------------------------
// PLUGIN PATH — a real activation over a real settings file on disk.
// ---------------------------------------------------------------------------------------------

class RecordingProvider implements TtsProvider {
  id = 'fake'; displayName = 'Fake'
  synthesized: string[] = []
  optionsSeen: SynthesizeOptions[] = []
  capabilities: ProviderCapabilities = {
    streaming: true, offline: true, needsApiKey: false, needsModelDownload: 0,
    licence: 'test', cloning: false, sampleRate: 22050
  }
  #warm = false
  get isWarm(): boolean { return this.#warm }
  async prepare(): Promise<void> { this.#warm = true }
  cancel(): void {}
  async listVoices(): Promise<readonly string[]> { return ['Alex', 'Samantha', 'Daniel'] }
  async *generate(text: string, opts: SynthesizeOptions = {}): AsyncIterable<AudioChunk> {
    this.synthesized.push(text)
    this.optionsSeen.push(opts)
    yield { data: new Uint8Array([1]), format: 'wav', sampleRate: 22050, channels: 1 }
  }
}

class FakeSink implements PlaybackSink {
  isPlaying = false
  async enqueue(): Promise<void> {}
  async stop(): Promise<void> {}
}

const settle = async (ticks = 60): Promise<void> => {
  for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 5))
}

/**
 * Wait for a CONDITION, never for a duration (P40). Every use below is paired with a log line the
 * system emits as an EFFECT of finishing, so the wait cannot end early and cannot be missed late.
 */
const until = async (p: () => boolean, what: string, capMs = 30_000): Promise<void> => {
  const started = Date.now()
  while (!p()) {
    if (Date.now() - started > capMs) {
      throw new Error(`gave up waiting for: ${what} (${capMs} ms backstop — this is a HANG, not slowness)`)
    }
    await new Promise((r) => setTimeout(r, 2))
  }
}

interface Harness {
  readonly provider: RecordingProvider
  readonly logs: string[]
  readonly notifications: string[]
  /** Every `settings.set` call the plugin made, as ORCA delivers them: one key per call. */
  readonly settingsSets: { key: string; value: unknown }[]
  readonly commands: Map<string, (args?: unknown) => unknown>
}

interface HarnessOptions {
  /** JSONC to write into the inbox. `null` leaves the inbox ABSENT. */
  readonly jsonc?: string | null
  /** What ORCA's `settings:own` KV answers with. `null` is a genuinely first run. */
  readonly mirror?: Record<string, unknown> | null
  /** The one assistant reply on disk, spoken by `read-aloud.speak-last-reply`. */
  readonly reply?: string
}

/** Stand the whole plugin up over a real inbox directory and wait for the read path to finish. */
async function boot(opts: HarnessOptions = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'orca-tts-g1-'))
  const settingsDir = join(root, opts.jsonc === undefined || opts.jsonc === null ? 'no-inbox-here' : 'config')
  const projectsDir = join(root, 'projects')
  await mkdir(join(projectsDir, 'proj'), { recursive: true })
  if (opts.jsonc !== undefined && opts.jsonc !== null) {
    await mkdir(settingsDir, { recursive: true })
    await writeFile(join(settingsDir, 'settings.jsonc'), opts.jsonc, 'utf8')
  }
  const reply = opts.reply ?? 'One short line.'
  await writeFile(
    join(projectsDir, 'proj', 'session.jsonl'),
    JSON.stringify({ type: 'assistant', uuid: 'g1-0', message: { content: [{ type: 'text', text: reply }] } }) + '\n'
  )

  const provider = new RecordingProvider()
  const commands = new Map<string, (args?: unknown) => unknown>()
  const logs: string[] = []
  const notifications: string[] = []
  const settingsSets: { key: string; value: unknown }[] = []
  const mirror = opts.mirror ?? null
  const orca: OrcaApi = {
    commands: { register: (id, fn) => { commands.set(id, fn) } },
    events: { on: () => {} },
    host: {
      call: async (action, params) => {
        if (action === 'notifications.show') notifications.push(String(params?.['body'] ?? ''))
        if (action === 'storage.get') return { value: undefined }
        // The mirror answers with NOTHING by default, so the only source of tuning in these tests
        // is the file on disk. A mirror holding the same values would let every equality below
        // pass without the file being read at all.
        // ORCA's real shapes, read from src/shared/plugins/plugin-host-api.ts:88-91 — NOT our
        // guess. `settings.get` answers `{ settings: {...} }`; `settings.set` takes ONE
        // `{ key, value }` per call and answers `{ ok: true }`. A fake that accepted a whole
        // record would verify this plugin against its own assumption, which is the P36 shape
        // pointed at a host API (and the assumption was in fact wrong).
        if (action === 'settings.get') return mirror === null ? null : { settings: mirror }
        if (action === 'settings.set') {
          const key = params?.['key']
          const value = params?.['value']
          if (typeof key !== 'string' || key.length === 0 || key.length > 256) {
            throw new Error(`settings.set rejected: bad key ${JSON.stringify(key)}`)
          }
          if (!('value' in (params ?? {}))) throw new Error('settings.set rejected: no value')
          settingsSets.push({ key, value })
          return { ok: true }
        }
        return {}
      }
    },
    log: (m) => { logs.push(m) }
  }
  activate(orca, { provider, sink: new FakeSink(), projectsDir, settingsDir, announceDelayMs: 5 })
  // The load is asynchronous by design (activate() must return promptly, or command registration
  // waits behind a filesystem read). Wait for its EFFECT — the line the loader emits when it has
  // adopted a snapshot — not for a duration.
  await until(() => logs.some((l) => l.startsWith('read-aloud: settings loaded from ')),
    'the settings read path to finish loading')
  return { provider, logs, notifications, settingsSets, commands }
}

/** Press a command by id, then let the queue drain. */
async function press(h: Harness, id: string): Promise<string> {
  const run = h.commands.get(id)
  if (run === undefined) throw new Error(`${id} was never registered`)
  h.provider.synthesized.length = 0
  await run()
  await settle()
  return h.provider.synthesized.join('')
}

/** Press the control, then let the queue drain. */
async function speakLastReply(h: Harness): Promise<string> {
  const run = h.commands.get('read-aloud.speak-last-reply')
  if (run === undefined) throw new Error('read-aloud.speak-last-reply was never registered')
  await run()
  await settle()
  return h.provider.synthesized.join('')
}

/** Serialize a lab settings file exactly as the lab's Save button does. */
function labJsonc(values: Values, revision = 4): string {
  return labSettings.serializeJsonc(labSettings.toSettingsFile(values, { revision })) as string
}

function valuesWith(overrides: Values): Values {
  return { ...(labControls.defaultValues() as Values), ...overrides }
}

/**
 * The settings sets. Each moves at least one wired field OFF its default in a way that is
 * OBSERVABLE on `fixtures/paths.md` — a set whose only moved field is disabled by another field
 * would be a comparison that could not fail, which is the exact hole `roundtrip.test.ts` found in
 * its own first draft (`extensionStyle` asserted only under `pathStyle: 'terse'`, which skips it).
 */
const SETS: readonly { name: string; why: string; values: Values }[] = [
  {
    name: 'verbatim paths',
    why: 'stage 9 off entirely: the raw path is spoken. The loudest audible difference the lab can produce, and the one the author actually went to the lab to settle.',
    values: valuesWith({ 'path.style': 'verbatim' })
  },
  {
    name: 'terse paths, code blocks dropped',
    why: 'two independent stages moved at once, so a projection that carries one field and drops the other cannot pass by luck.',
    values: valuesWith({ 'path.style': 'terse', 'omit.codeBlocks': 'drop' })
  },
  {
    name: 'spoken paths, extension omitted, integers left alone',
    why: "extensionStyle is observable ONLY under pathStyle 'spoken'; paired with expandIntegers so the set also moves a stage at the far end of the pipeline.",
    values: valuesWith({ 'path.extensionStyle': 'omit', 'num.expandIntegers': false })
  },
  {
    name: 'smaller chunks, first sentence not isolated',
    why: 'the CHUNKER surface, which changes what each UTTERANCE says without changing the concatenation — the quietest divergence there is, and invisible to any test that compares one joined string.',
    values: valuesWith({ 'pace.chunkMaxUnits': 60, 'pace.isolateFirstSentence': false })
  }
]

describe('G1 — a lab-exported settings file, read by the plugin, speaks the lab\'s own bytes', () => {
  it('the extractor really lifted the lab\'s projections, and they are non-trivial', () => {
    const opts = labNormalizeOptions(valuesWith({}))
    expect(Object.keys(opts).length,
      'a projection that returned {} would make every equality below pass for the wrong reason')
      .toBeGreaterThanOrEqual(5)
    expect(Object.keys(labChunkOptions(valuesWith({}))).length).toBeGreaterThanOrEqual(2)
  })

  for (const set of SETS) {
    it(`"${set.name}" — every utterance the plugin synthesizes is the lab's, byte for byte`, async () => {
      const expected = await labUtterances(set.values, fixtureText)
      const h = await boot({ jsonc: labJsonc(set.values), reply: fixtureText })
      await speakLastReply(h)

      expect(expected.length, 'the lab produced nothing to compare against').toBeGreaterThan(1)
      expect(h.provider.synthesized.length, 'the plugin synthesized nothing at all').toBeGreaterThan(0)

      // SUFFIX equality rather than whole-array equality, and the reason is a real divergence
      // rather than a convenience: the lab ships a control (`lab.sessionLabelHashChars`) that 011
      // section 3.2 forbids the schema to carry, so EVERY file the lab writes makes the plugin
      // report one unknown field — honestly, aloud, at the head of the first utterance. That
      // report is asserted on its own below. What G1 is about is the FIXTURE's utterances, and
      // those must be the lab's exactly, in order, with no field lost in transit.
      const tail = h.provider.synthesized.slice(-expected.length)
      expect(
        tail,
        `LAB and PLUGIN disagree under "${set.name}".\n` +
        `  why this set exists: ${set.why}\n` +
        `  lab normalize options: ${JSON.stringify(labNormalizeOptions(set.values))}\n` +
        `  lab chunk options:     ${JSON.stringify(labChunkOptions(set.values))}\n` +
        `  everything the plugin synthesized: ${JSON.stringify(h.provider.synthesized)}`
      ).toEqual(expected)
    })
  }

  it('the four sets are four different sounds, so the equalities above are not one assertion repeated', async () => {
    const rendered = await Promise.all(
      SETS.map(async (s) => (await labUtterances(s.values, fixtureText)).join(' '))
    )
    expect(new Set(rendered).size,
      'two settings sets produce identical lab output — one of them is dead weight and proves nothing')
      .toBe(SETS.length)
  })

  it('the lab/schema disagreement is announced ALOUD by the plugin, not absorbed', async () => {
    // `roundtrip.test.ts` asserts that `parse()` reports `lab.sessionLabelHashChars` as unknown.
    // This is the same disagreement one layer out: the listener actually HEARS about it, which is
    // what P30 requires and what a `unknownFields` array on its own does not deliver.
    const h = await boot({ jsonc: labJsonc(valuesWith({})) })
    const spoken = await speakLastReply(h)
    expect(spoken, 'a field the plugin ignored must reach the audio stream, never only an array')
      .toMatch(/newer than this version/i)
  })
})

describe('G1 — negative controls: this comparison can tell the file from the defaults', () => {
  it('WITHOUT the file, the plugin speaks something DIFFERENT — so the file is what did it', async () => {
    // The control that makes every row above evidence. If the plugin ignored the inbox entirely
    // and ran on schema defaults, the tuned rows would still be green wherever the lab's defaults
    // and the schema's defaults agree.
    const withFile = await boot({ jsonc: labJsonc(SETS[0]!.values), reply: fixtureText })
    const withoutFile = await boot({ jsonc: null, reply: fixtureText })
    const a = await speakLastReply(withFile)
    const b = await speakLastReply(withoutFile)
    expect(a).not.toBe(b)
    expect(a, "pathStyle 'verbatim' did not reach the provider through the file")
      .toContain('packages/core/src/normalizer/index.ts')
    expect(b, 'the schema default speaks the path rather than reading it out raw')
      .not.toContain('packages/core/src/normalizer/index.ts')
  })

  it('a value TAMPERED WITH in the file on disk changes what the provider is handed', async () => {
    // Proves the read path really parses the bytes on disk rather than re-deriving from anything
    // it already had. Same technique as roundtrip.test.ts, one layer further out: through
    // `activate()` and a provider, not through `parseSettingsText()` in-process.
    const honest = labJsonc(valuesWith({}))
    const tampered = honest.replace('"normalize.pathStyle": "spoken"', '"normalize.pathStyle": "verbatim"')
    expect(tampered, 'the serializer no longer writes normalize.pathStyle the way this edit expects')
      .not.toBe(honest)
    const a = await speakLastReply(await boot({ jsonc: honest, reply: fixtureText }))
    const b = await speakLastReply(await boot({ jsonc: tampered, reply: fixtureText }))
    expect(b).not.toBe(a)
  })

  it('synthesize.rate and voiceIndex reach the PROVIDER\'s options, resolved against the host\'s real voice list', async () => {
    const h = await boot({ jsonc: labJsonc(valuesWith({ 'voice.rate': 0.8, 'voice.id': 1 })) })
    await speakLastReply(h)
    const opts = h.provider.optionsSeen.at(-1)
    expect(opts, 'the provider was handed no options at all').toBeDefined()
    expect(opts, 'rate/voiceIndex did not survive lab -> file -> activate() -> SpeechService -> provider')
      .toEqual({ voice: 'Samantha', rate: 0.8 })
  })

  it('CONTROL: with nothing tuned, no voice is CLAIMED — an index the list cannot reach is omitted, never guessed', async () => {
    const h = await boot({ jsonc: labJsonc(valuesWith({})) })
    await speakLastReply(h)
    const opts = h.provider.optionsSeen.at(-1)
    expect(opts).not.toHaveProperty('voice')
  })
})

describe('G1 — the listener can ASK, because there is no settings pane to look at', () => {
  it('status speaks the revision and the path, so "did my edit land" and "where is the file" are answerable', async () => {
    // 011 section 6 / R7-32. The listener cannot see a settings pane (upstream stablyai/orca#15655
    // renders nothing), so `status` is the only route to these facts. An unchanged `revision` is
    // how they tell "the plugin never saw my write" from "I edited the wrong thing", and a file
    // they cannot find is a file they do not have.
    const h = await boot({ jsonc: labJsonc(valuesWith({}), 42) })
    const spoken = await press(h, 'read-aloud.status')
    // "forty two", not "42": the status clause goes through `normalize()` like everything else, so
    // this asserts the number reached the LISTENER, not merely the string. `41` would fail.
    expect(spoken, 'the revision the plugin actually loaded must be sayable')
      .toMatch(/revision forty two/i)
    expect(spoken, 'the path must be spoken — a file the listener cannot find is a file they do not have')
      .toMatch(/settings, dot jsonc|settings\.jsonc/)
    // `writtenBy` is `voice-lab/0.2.0`, and a slash-separated token is a PATH to the normalizer.
    // The first time this clause was ever spoken it read "by file named 0.1, dot zero, in folder
    // voice lab" — a version string recited as a directory tree.
    expect(spoken, 'writtenBy was read out as a file path instead of as a writer')
      .not.toMatch(/in folder voice lab/i)
    expect(spoken, 'the listener must be able to tell the lab from their own hand edit')
      .toMatch(/by the Voice Lab/i)
    expect(spoken, 'a count of zero is not news and must not be spoken')
      .not.toMatch(/zero fields/i)
  })

  it('status answers with the report even when the channel said "never unprompted" — the report is NEVER dropped', async () => {
    // 011 section 4.3a's correctness half. `on-request-only` and a held report are both CHANNELS,
    // not silences; destination 2 always answers. Here the file is absent WITH a mirror, so a
    // report exists, and `status` must carry it whatever the channel setting is.
    const h = await boot({
      jsonc: null,
      mirror: { 'normalize.pathStyle': 'verbatim', __revision: 3, __schemaVersion: 2 }
    })
    const first = await press(h, 'read-aloud.status')
    expect(first).toMatch(/could not find your settings file/i)
    // ASKED TWICE, deliberately. A single call cannot tell "the report is kept" from "the report
    // is consumed by whoever reads it first" — and the whole claim of 011 section 4.3a is that the
    // report is still answerable an HOUR later. Probing this with one call was a test that could
    // not have failed: swapping the non-consuming read for a consuming one left it green.
    const second = await press(h, 'read-aloud.status')
    expect(second, 'the report was consumed by the first reader, so asking again gets nothing')
      .toMatch(/could not find your settings file/i)
  })

  it('CONTROL: a clean load makes status say NOTHING about a settings problem', async () => {
    // The row that makes the two above evidence. A status clause that reported a problem on every
    // launch regardless of file health would pass both of them — and an indicator that never
    // changes is a broken indicator.
    const h = await boot({ jsonc: labJsonc(valuesWith({}), 5) })
    const spoken = await press(h, 'read-aloud.status')
    expect(spoken).not.toMatch(/could not find|could not be read|could not be opened/i)
  })
})

describe('G1 — degradation: an unusable settings file never silences the plugin, and never half-applies', () => {
  it('a file with a SYNTAX ERROR is refused WHOLE, spoken about, and the plugin still speaks', async () => {
    const honest = labJsonc(valuesWith({ 'path.style': 'verbatim' }))
    // Truncated mid-object: the classic half-saved file.
    const broken = honest.slice(0, Math.floor(honest.length * 0.6))
    const h = await boot({ jsonc: broken, reply: fixtureText })
    const spoken = await speakLastReply(h)

    expect(spoken, 'the listener is told, in the audio stream, that the file could not be read (P30)')
      .toMatch(/settings file could not be read/i)
    expect(spoken.length,
      'a broken settings file making the plugin mute IS the failure — it is not a safe fallback')
      .toBeGreaterThan(0)
    // NOT HALF A CONFIG. `path.style: 'verbatim'` sits inside the readable first 60% of the
    // truncated file; it must NOT have been applied, because the file as a whole was refused.
    expect(spoken, 'a half-parsed file leaked a value into speech — the "half a config" outcome')
      .not.toContain('packages/core/src/normalizer/index.ts')
    expect(h.logs.some((l) => l.includes('settings loaded from defaults')),
      `the loader must name which store supplied the values; it logged ${JSON.stringify(h.logs.filter((l) => l.includes('settings')))}`
    ).toBe(true)
  })

  it('a file from a NEWER schemaVersion is loaded for what we understand, and the rest is said out loud', async () => {
    const file = JSON.parse(
      labSettings.stripJsonComments(labJsonc(valuesWith({ 'path.style': 'verbatim' })))
    ) as Record<string, unknown>
    file['schemaVersion'] = 99
    ;(file['settings'] as Record<string, unknown>)['normalize.somethingFromTheFuture'] = 'ignore me'
    const spoken = await speakLastReply(await boot({ jsonc: JSON.stringify(file), reply: fixtureText }))
    expect(spoken,
      'refusing a newer file would leave a voice-first listener on default voice, rate and path style — not a fallback, the failure')
      .toContain('packages/core/src/normalizer/index.ts')
    expect(spoken, 'the ignored ids must be counted aloud, never dropped in silence')
      .toMatch(/newer than this version/i)
  })

  it('an ABSENT file on a first run says NOTHING — silence is the honest report when there is no tuning to have lost', async () => {
    const h = await boot({ jsonc: null })
    const spoken = await speakLastReply(h)
    expect(spoken, 'a "settings loaded" chirp spends the listener\'s only channel on non-news (011 4.3)')
      .not.toMatch(/settings/i)
    expect(h.notifications.join(' '), 'and it is not a notification either')
      .not.toMatch(/settings file/i)
    expect(spoken.length, 'and the plugin still spoke the thing that was asked for').toBeGreaterThan(0)
  })

  it('CONTROL: the same absent file WITH a mirror IS spoken about, and the mirrored VALUE takes effect', async () => {
    // The row that makes the previous one evidence. Without it, a loader that could never report an
    // absent inbox at all would pass "says nothing" perfectly. And the sentence alone is not
    // enough: a restore that announced itself while quietly serving defaults is the same failure
    // wearing an explanation, so the mirrored VALUE is asserted on the provider's input too.
    const h = await boot({
      jsonc: null,
      mirror: { 'normalize.pathStyle': 'verbatim', __revision: 12, __schemaVersion: 2 },
      reply: fixtureText
    })
    const spoken = await speakLastReply(h)
    expect(spoken,
      'losing a tuned inbox is an hour of the listener\'s work vanishing while the plugin still sounds fine — it must be audible')
      .toMatch(/could not find your settings file/i)
    expect(h.logs.some((l) => l.includes('settings loaded from mirror')),
      'the mirror, not the defaults, supplied the values').toBe(true)
    expect(spoken, "the mirrored pathStyle 'verbatim' did not reach normalize()")
      .toContain('packages/core/src/normalizer/index.ts')
  })

  it('a DEGRADED load never overwrites the mirror — last-known-good survives the run that needed it', async () => {
    // The invariant that is cheap to lose and expensive to notice: mirroring a defaults-derived
    // snapshot would destroy the listener's last good settings on the exact run where they were
    // the fallback. Observable only on the host call, so that is where it is asserted.
    const h = await boot({ jsonc: '{ this is not json' })
    await settle(20)
    expect(h.settingsSets, 'a refused file must never be mirrored back over last-known-good').toEqual([])
  })

  // 40 s so that `until()`'s own 30 s HANG backstop is what fires, not vitest's 5 s default. P40's
  // distinction: this is a hang-detector with margin, not a budget inflated until a race stops
  // losing — the mirror write lands in milliseconds when it works at all. Measured with the bulk
  // `settings.set` shape in place, the 5 s default produced a bare "Test timed out" and threw away
  // the one sentence that names the cause.
  it('CONTROL: a GOOD file IS mirrored, so the row above is about the refusal and not about mirroring being dead', { timeout: 40_000 }, async () => {
    const h = await boot({ jsonc: labJsonc(valuesWith({}), 9) })
    await until(() => h.settingsSets.some((w) => w.key === '__revision'), 'the mirror write')
    const written = Object.fromEntries(h.settingsSets.map((w) => [w.key, w.value]))
    expect(written['__revision'],
      'the mirror must carry the revision (011 1.2, R7-27), or a starter file rebuilt from it restarts below the listener\'s own file')
      .toBe(9)
    expect(written['normalize.pathStyle']).toBe('spoken')
    // One key per call is ORCA's schema (plugin-host-api.ts:90), so a mirror of the whole schema
    // is many calls, not one. Asserting the COUNT is what makes this test notice a regression back
    // to the bulk shape I originally guessed — a single `{ settings: … }` call would satisfy the
    // two assertions above if the fake were lenient, and satisfy nothing in the real host.
    expect(h.settingsSets.length,
      'the mirror should be one call per field plus the envelope keys, not one bulk call')
      .toBeGreaterThan(40)
  })
})
