/**
 * The downloader and the voice keys.
 *
 * `downloadModel` is exercised against an INJECTED `fetch`, never the network: the point of these
 * cases is what happens when a download is corrupt, truncated, or interrupted, and none of those
 * are reproducible against a real CDN. The manifest's digests are checked against the vendored
 * `tokenizer.model`, which is the one artifact actually in the repo — so at least one entry of the
 * pinned table is proved to pin the right bytes rather than merely to be a well-formed hex string.
 */
import { readFileSync } from 'node:fs'
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, existsSync, readFileSync as read } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MODEL_ARTIFACTS, MODEL_TOTAL_BYTES, MODEL_REVISION, MANIFEST_FILE, MANIFEST_VERSION,
  LICENSE_FILE, VOICE_ARTIFACTS, VOICES_TOTAL_BYTES, INSTALL_TOTAL_BYTES,
  downloadModel, modelDir, modelStatus, requiredFiles, sha256, urlFor,
  type ModelArtifact,
} from './models.js'
import {
  POCKET_VOICES, POCKET_DEFAULT_VOICE, parseVoiceKey, formatVoiceKey, resolveVoiceForBackend,
  OS_BACKEND, POCKET_BACKEND, VOICES_REVISION, voiceUrl,
} from './voices.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const made: string[] = []
const scratch = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'pocket-models-'))
  made.push(d)
  return d
}
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true })
})

/* --------------------------------------------------------------------------------- manifest */

describe('the pinned manifest', () => {
  it('pins all eight files, by digest AND by length', () => {
    expect(MODEL_ARTIFACTS).toHaveLength(8)
    for (const a of MODEL_ARTIFACTS) {
      expect(a.sha256, a.file).toMatch(/^[0-9a-f]{64}$/)
      expect(a.bytes, a.file).toBeGreaterThan(0)
    }
    // buzz's own test asserts this total for the same revision. Two projects, one number.
    expect(MODEL_TOTAL_BYTES).toBe(165_232_420)
  })

  it("the vendored tokenizer's bytes match the digest the manifest pins", () => {
    // The one artifact that is actually in this repo. Without this, every hash in the table is
    // just a well-formed hex string that nothing has ever compared against anything.
    const vendored = readFileSync(join(HERE, 'model/tokenizer.model'))
    const entry = MODEL_ARTIFACTS.find((a) => a.file === 'tokenizer.model')
    expect(entry).toBeDefined()
    expect(vendored.length).toBe(entry?.bytes)
    expect(sha256(vendored)).toBe(entry?.sha256)
  })

  it('pins a revision, never a branch', () => {
    // A branch moves and the voice changes underneath a listener who tuned it by ear.
    expect(MODEL_REVISION).toMatch(/^[0-9a-f]{40}$/)
    expect(urlFor('bundle.json')).toContain(MODEL_REVISION)
    expect(urlFor('bundle.json')).not.toContain('/main/')
  })
})

/* ------------------------------------------------------------------------------------ status */

describe('modelStatus', () => {
  it('names the missing files rather than returning a bare boolean', async () => {
    const dir = scratch()
    const s = await modelStatus(dir)
    expect(s.kind).toBe('absent')
    // "the model is not ready" is not actionable; "mimi_encoder.onnx is missing" is.
    if (s.kind === 'absent') expect(s.missing).toContain('mimi_encoder.onnx')
  })

  it('reports a directory with every file but the manifest as ABSENT', async () => {
    // This is precisely a download that died before its last write, and treating it as ready
    // would load a half-written graph.
    const dir = scratch()
    for (const f of requiredFiles()) if (f !== MANIFEST_FILE) writeFileSync(join(dir, f), 'x')
    const s = await modelStatus(dir)
    expect(s.kind).toBe('absent')
    if (s.kind === 'absent') expect(s.missing).toEqual([MANIFEST_FILE])
  })

  it('reports a version mismatch as stale, with both versions', async () => {
    const dir = scratch()
    for (const f of requiredFiles()) writeFileSync(join(dir, f), 'x')
    writeFileSync(join(dir, MANIFEST_FILE), '0\n')
    const s = await modelStatus(dir)
    expect(s.kind).toBe('stale')
    if (s.kind === 'stale') { expect(s.found).toBe('0'); expect(s.want).toBe(String(MANIFEST_VERSION)) }
  })

  it('reports ready only when everything is there and current', async () => {
    const dir = scratch()
    for (const f of requiredFiles()) writeFileSync(join(dir, f), 'x')
    writeFileSync(join(dir, MANIFEST_FILE), `${MANIFEST_VERSION}\n`)
    expect((await modelStatus(dir)).kind).toBe('ready')
  })

  it('never resolves into the author\'s real cache when overridden', () => {
    // P31's neighbourhood: no test may write into the machine the author actually uses.
    expect(modelDir({ ORCA_TTS_MODEL_DIR: '/tmp/elsewhere' } as NodeJS.ProcessEnv)).toBe('/tmp/elsewhere')
    expect(modelDir({} as NodeJS.ProcessEnv)).toContain('orca-tts')
  })
})

/* ---------------------------------------------------------------------------------- download */

/** A `fetch` that serves the pinned bytes, with one file optionally corrupted. */
function fakeFetch(opts: { corrupt?: string, truncate?: string, fail?: string } = {}): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    const file = url.split('/').pop() ?? ''
    if (opts.fail === file) return new Response('nope', { status: 503, statusText: 'Service Unavailable' })
    if (file === 'LICENSE') return new Response('licence text')
    const entry = MODEL_ARTIFACTS.find((a) => a.file === file)
    if (entry === undefined) return new Response('not found', { status: 404, statusText: 'Not Found' })
    let body = Buffer.alloc(entry.bytes, 0)
    // Make the bytes hash to what the manifest wants, by serving the real vendored file where we
    // have it and otherwise patching the manifest expectation is impossible — so these tests use
    // a manifest-shaped stub and assert the REFUSAL paths, which is where the value is.
    if (opts.corrupt === file) body = Buffer.alloc(entry.bytes, 1)
    if (opts.truncate === file) body = Buffer.alloc(Math.max(0, entry.bytes - 1), 0)
    return new Response(body, { headers: { 'content-length': String(body.length) } })
  }) as unknown as typeof fetch
}

describe('downloadModel refuses bad bytes and never damages a working cache', () => {
  it('REFUSES a file whose length is wrong, naming the file', async () => {
    const dir = scratch()
    await expect(downloadModel({ dir, fetchImpl: fakeFetch({ truncate: 'bundle.json' }) }))
      .rejects.toThrow(/bundle\.json is \d+ bytes, expected 24381/)
  })

  it('REFUSES a file whose digest is wrong, naming the file', async () => {
    const dir = scratch()
    await expect(downloadModel({ dir, fetchImpl: fakeFetch() }))
      .rejects.toThrow(/hashes to [0-9a-f]{64}, expected/)
  })

  it('reports an HTTP failure with its status rather than as a hash mismatch', async () => {
    const dir = scratch()
    await expect(downloadModel({ dir, fetchImpl: fakeFetch({ fail: 'bundle.json' }) }))
      .rejects.toThrow(/HTTP 503/)
  })

  it('LEAVES AN EXISTING MODEL INTACT when the download fails', async () => {
    // The machine whose network dies halfway is the one that can least afford to lose the copy it
    // already had. Staging plus an atomic swap is what makes that true; this is the check.
    const dir = scratch()
    mkdirSync(dir, { recursive: true })
    for (const f of requiredFiles()) writeFileSync(join(dir, f), 'previous')
    writeFileSync(join(dir, MANIFEST_FILE), `${MANIFEST_VERSION}\n`)
    expect((await modelStatus(dir)).kind).toBe('ready')

    await expect(downloadModel({ dir, fetchImpl: fakeFetch({ fail: 'mimi_encoder.onnx' }) })).rejects.toThrow()

    expect((await modelStatus(dir)).kind).toBe('ready')
    expect(read(join(dir, 'bundle.json'), 'utf8')).toBe('previous')
  })

  it('leaves no staging directory behind after a failure', async () => {
    // A failed download that keeps its half-written temp directory turns every retry into another
    // ~166 MB of dead files on a disk nobody is watching.
    const stagingOf = (): string[] =>
      readdirSync(tmpdir()).filter((n) => n.startsWith('orca-tts-pocket-'))
    const before = stagingOf()
    const dir = scratch()
    await expect(downloadModel({ dir, fetchImpl: fakeFetch({ fail: 'bundle.json' }) })).rejects.toThrow()
    expect(stagingOf()).toEqual(before)
  })
})

/* ------------------------------------------------------------------------------------ voices */

describe('voice keys', () => {
  it('lists the twelve presets buzz lists, by the same names', () => {
    expect(POCKET_VOICES).toHaveLength(12)
    expect(POCKET_VOICES.map((v) => v.displayName)).toEqual([
      'Anna', 'Vera', 'Fantine', 'Charles', 'Paul', 'Eponine',
      'Azelma', 'George', 'Mary', 'Jane', 'Michael', 'Eve',
    ])
    for (const v of POCKET_VOICES) expect(v.key).toBe(`pocket:${v.displayName.toLowerCase()}`)
  })

  it('treats a bare name as an OS voice, so old settings keep working', () => {
    // Every settings file written before backends existed says `"Alex"`. It must keep meaning
    // `os:Alex` rather than becoming unresolvable — migration by construction.
    expect(parseVoiceKey('Alex')).toEqual({ backend: OS_BACKEND, voice: 'Alex' })
    expect(parseVoiceKey('pocket:eve')).toEqual({ backend: POCKET_BACKEND, voice: 'eve' })
    expect(parseVoiceKey('os:Microsoft Zira')).toEqual({ backend: OS_BACKEND, voice: 'Microsoft Zira' })
  })

  it('keeps a colon inside a voice name intact', () => {
    expect(parseVoiceKey('os:en-gb:f3')).toEqual({ backend: OS_BACKEND, voice: 'en-gb:f3' })
    expect(formatVoiceKey('pocket', 'eve')).toBe('pocket:eve')
  })

  it('resolves the first preference the running backend can honour', () => {
    const prefs = ['siri:aaron', 'pocket:eve', 'pocket:mary', 'os:Alex']
    expect(resolveVoiceForBackend(prefs, POCKET_BACKEND, ['mary', 'eve'])).toBe('eve')
    expect(resolveVoiceForBackend(prefs, OS_BACKEND, ['Alex', 'Samantha'])).toBe('Alex')
  })

  it('skips a preference whose voice the backend does not have', () => {
    expect(resolveVoiceForBackend(['pocket:nobody', 'pocket:mary'], POCKET_BACKEND, ['mary'])).toBe('mary')
  })

  it('RETURNS NULL rather than guessing when nothing matches', () => {
    // Substituting silently is how a listener ends up hearing a voice they never chose and cannot
    // trace: the setting says one thing, the machine has another engine, and something in the
    // middle picks for them.
    expect(resolveVoiceForBackend(['siri:aaron'], POCKET_BACKEND, ['mary'])).toBeNull()
    expect(resolveVoiceForBackend([], OS_BACKEND, ['Alex'])).toBeNull()
  })

  it('has a default that is one of the presets', () => {
    expect(POCKET_VOICES.map((v) => v.key)).toContain(POCKET_DEFAULT_VOICE)
  })
})


/* ------------------------------------------------------- R14-06: the swap, actually exercised */

/**
 * A manifest of THREE TINY FILES whose bytes really do hash to their declared digests.
 *
 * This is the whole point of R14-06's remedy. Every earlier download test derived its fixture from
 * the production hashes, and no fake body can satisfy a 76 MB file's SHA-256 — so every one of them
 * died inside the fetch loop, the swap was executed by NOTHING, and a `throw` placed immediately
 * after the live directory was deleted left 20/20 green. The tests were thorough about refusal and
 * blind to the one window where the user's data can be destroyed.
 */
const TINY_BODIES: Record<string, Buffer> = {
  'bundle.json': Buffer.from('{"bundle_name":"tiny"}'),
  'tokenizer.model': Buffer.from('tiny tokenizer bytes'),
  'mimi_encoder.onnx': Buffer.from('tiny encoder bytes'),
}
const TINY: readonly ModelArtifact[] = Object.entries(TINY_BODIES).map(([file, body]) => ({
  file, bytes: body.length, sha256: sha256(body),
}))

function tinyFetch(opts: { failLicence?: boolean } = {}): typeof fetch {
  return (async (input: string | URL | Request) => {
    const file = String(input).split('/').pop() ?? ''
    if (file === 'LICENSE') {
      return opts.failLicence === true
        ? new Response('nope', { status: 503, statusText: 'Service Unavailable' })
        : new Response('upstream licence text')
    }
    const body = TINY_BODIES[file]
    if (body === undefined) return new Response('not found', { status: 404, statusText: 'Not Found' })
    return new Response(body, { headers: { 'content-length': String(body.length) } })
  }) as unknown as typeof fetch
}

/** Seed a directory with a recognisable, complete, current model. */
function seedReady(dir: string): void {
  mkdirSync(dir, { recursive: true })
  for (const f of requiredFiles()) writeFileSync(join(dir, f), 'PREVIOUS')
  writeFileSync(join(dir, MANIFEST_FILE), `${MANIFEST_VERSION}\n`)
}

const stillPrevious = (dir: string): boolean =>
  existsSync(join(dir, 'bundle.json')) && read(join(dir, 'bundle.json'), 'utf8') === 'PREVIOUS'

describe('R14-06 — the swap is reversible at every step', () => {
  it('reaches the success tail at all, which nothing did before', async () => {
    const dir = join(scratch(), 'model')
    await downloadModel({ dir, artifacts: TINY, fetchImpl: tinyFetch() })
    // By effect: the new bytes are live, the licences are beside them, and the manifest is current.
    expect(read(join(dir, 'bundle.json'), 'utf8')).toBe('{"bundle_name":"tiny"}')
    expect(read(join(dir, 'LICENSE'), 'utf8')).toBe('upstream licence text')
    expect(existsSync(join(dir, LICENSE_FILE))).toBe(true)
    expect(read(join(dir, MANIFEST_FILE), 'utf8').trim()).toBe(String(MANIFEST_VERSION))
  })

  it('replaces a previous model with the new one', async () => {
    const dir = join(scratch(), 'model')
    seedReady(dir)
    expect(stillPrevious(dir)).toBe(true)
    await downloadModel({ dir, artifacts: TINY, fetchImpl: tinyFetch() })
    expect(stillPrevious(dir)).toBe(false)
    expect(read(join(dir, 'bundle.json'), 'utf8')).toBe('{"bundle_name":"tiny"}')
  })

  it('KEEPS THE OLD MODEL when the swap fails after the live directory moved aside', async () => {
    // R14-06's exact window. Before the fix this destroyed the only working cache; before the fix
    // NO TEST REACHED IT, which is the more important half.
    const dir = join(scratch(), 'model')
    seedReady(dir)
    await expect(downloadModel({
      dir, artifacts: TINY, fetchImpl: tinyFetch(),
      hooks: { afterBackup: () => { throw new Error('injected: the swap died mid-rename') } },
    })).rejects.toThrow(/injected/)
    expect(stillPrevious(dir), 'the previous model was destroyed by a failed swap').toBe(true)
    expect((await modelStatus(dir)).kind).toBe('ready')
  })

  it('KEEPS THE OLD MODEL when activation fails after the rename', async () => {
    const dir = join(scratch(), 'model')
    seedReady(dir)
    await expect(downloadModel({
      dir, artifacts: TINY, fetchImpl: tinyFetch(),
      hooks: { afterSwap: () => { throw new Error('injected: activation failed') } },
    })).rejects.toThrow(/injected/)
    expect(stillPrevious(dir)).toBe(true)
  })

  it('CONTROL: with no hook injected, the same run replaces the model', async () => {
    // Without this, the two cases above would also pass if `downloadModel` never did anything.
    const dir = join(scratch(), 'model')
    seedReady(dir)
    await downloadModel({ dir, artifacts: TINY, fetchImpl: tinyFetch() })
    expect(stillPrevious(dir)).toBe(false)
  })

  it('leaves no staging or backup directory behind, on success or on failure', async () => {
    const root = scratch()
    const dir = join(root, 'model')
    seedReady(dir)
    await expect(downloadModel({
      dir, artifacts: TINY, fetchImpl: tinyFetch(),
      hooks: { afterBackup: () => { throw new Error('injected') } },
    })).rejects.toThrow()
    await downloadModel({ dir, artifacts: TINY, fetchImpl: tinyFetch() })
    // A failed download that keeps its debris turns every retry into another 166 MB on a disk
    // nobody is watching.
    expect(readdirSync(root).filter((n) => n !== 'model')).toEqual([])
  })

  it('stages BESIDE the target, not in the system temp directory', async () => {
    // `tmpdir()` is a different filesystem often enough to matter, and a cross-device rename is
    // EXDEV — a failure mode that would only ever appear on someone else's machine.
    const root = scratch()
    const dir = join(root, 'model')
    let sawStagingBeside = false
    await downloadModel({
      dir, artifacts: TINY, fetchImpl: tinyFetch(),
      hooks: { afterStage: () => { sawStagingBeside = readdirSync(root).some((n) => n.includes('.staging-')) } },
    })
    expect(sawStagingBeside).toBe(true)
  })

  it('R14-08: REFUSES to install when the upstream licence cannot be fetched', async () => {
    // These models are CC-BY-4.0. An install that silently omits the licence is a violation that
    // nothing reports; it was previously best-effort behind `if (licence.ok)`.
    const dir = join(scratch(), 'model')
    seedReady(dir)
    await expect(downloadModel({ dir, artifacts: TINY, fetchImpl: tinyFetch({ failLicence: true }) }))
      .rejects.toThrow(/CC-BY-4\.0|LICENSE could not be fetched/)
    expect(stillPrevious(dir)).toBe(true)
  })
})


/* --------------------------------------------- R14-02: ready must mean the voices actually work */

describe('R14-02 — a reference clip is an artifact, not an assumption', () => {
  it('every voice in the registry is a file the install requires', () => {
    // THE MUTANT THAT EXPOSED THIS: renaming Eve's file to `does-not-exist.wav` left 20/20 green,
    // because nothing connected the registry to the manifest. `modelStatus()` could say READY
    // while not one voice had a conditioning clip to load, and `ready` is what every caller uses
    // to decide whether it can speak.
    const required = new Set(requiredFiles())
    for (const v of POCKET_VOICES) {
      expect(required.has(v.file), `${v.key} needs ${v.file}, which nothing requires`).toBe(true)
    }
  })

  it('pins all twelve clips by digest and length', () => {
    expect(VOICE_ARTIFACTS).toHaveLength(12)
    for (const a of VOICE_ARTIFACTS) {
      expect(a.sha256, a.file).toMatch(/^[0-9a-f]{64}$/)
      expect(a.bytes, a.file).toBeGreaterThan(100_000)
    }
    // Measured from the twelve files on disk, not estimated.
    expect(VOICES_TOTAL_BYTES).toBe(8_531_662)
  })

  it('advertises the WHOLE install, not just the weights', () => {
    // Understating someone's download is its own small dishonesty, and the UI reads this number
    // before it spends their bandwidth.
    expect(INSTALL_TOTAL_BYTES).toBe(MODEL_TOTAL_BYTES + VOICES_TOTAL_BYTES)
    expect(INSTALL_TOTAL_BYTES).toBeGreaterThan(MODEL_TOTAL_BYTES)
  })

  it('fetches each clip from the voices repo at its own pinned revision', () => {
    // Different repository from the weights, so a single revision constant would have been wrong.
    expect(VOICES_REVISION).toMatch(/^[0-9a-f]{40}$/)
    const url = urlFor('eve.wav')
    expect(url).toContain('kyutai/tts-voices')
    expect(url).toContain(VOICES_REVISION)
    // Renamed on disk, so the engine's filename stays stable if upstream renames the speaker file.
    expect(url).toContain('p361_023_enhanced.wav')
    expect(url).not.toContain('/main/')
    expect(voiceUrl('p228_023_enhanced.wav')).toContain(VOICES_REVISION)
  })

  it('still routes model artifacts to the model repo', () => {
    // A control: the voice branch above must not have swallowed everything.
    expect(urlFor('bundle.json')).toContain('pocket-tts-onnx')
    expect(urlFor('bundle.json')).toContain(MODEL_REVISION)
  })

  it('reports a weights-only directory as ABSENT and names a missing voice', async () => {
    // This is exactly a version-1 cache: every model artifact present, no clips. It used to read
    // as ready and could not speak.
    const dir = scratch()
    for (const a of MODEL_ARTIFACTS) writeFileSync(join(dir, a.file), 'x')
    writeFileSync(join(dir, LICENSE_FILE), 'x')
    writeFileSync(join(dir, MANIFEST_FILE), `${MANIFEST_VERSION}\n`)
    const s = await modelStatus(dir)
    expect(s.kind).toBe('absent')
    if (s.kind === 'absent') expect(s.missing).toContain('eve.wav')
  })

  it('treats a version-1 cache as stale rather than adopting it', async () => {
    const dir = scratch()
    for (const f of requiredFiles()) writeFileSync(join(dir, f), 'x')
    writeFileSync(join(dir, MANIFEST_FILE), '1\n')
    const s = await modelStatus(dir)
    expect(s.kind).toBe('stale')
    if (s.kind === 'stale') expect(s.found).toBe('1')
  })
})
