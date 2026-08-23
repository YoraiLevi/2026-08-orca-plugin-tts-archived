/**
 * The downloader and the voice keys.
 *
 * `downloadModel` is exercised against an INJECTED `fetch`, never the network: the point of these
 * cases is what happens when a download is corrupt, truncated, or interrupted, and none of those
 * are reproducible against a real CDN. The manifest's digests are checked against the vendored
 * `tokenizer.model`, which is the one artifact actually in the repo — so at least one entry of the
 * pinned table is proved to pin the right bytes rather than merely to be a well-formed hex string.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {
  mkdtempSync, writeFileSync, mkdirSync, readdirSync, existsSync, renameSync,
  symlinkSync, rmSync, truncateSync,
  readFileSync as read,
} from 'node:fs'
import { rm, lstat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MODEL_ARTIFACTS, MODEL_TOTAL_BYTES, MODEL_REVISION, MANIFEST_FILE, MANIFEST_VERSION,
  LICENSE_FILE, UPSTREAM_LICENSE, UPSTREAM_LICENSE_FILE, VOICE_ARTIFACTS, VOICES_TOTAL_BYTES,
  INSTALL_TOTAL_BYTES,
  downloadModel, modelDir, modelStatus, modelStatusDetail, requiredFiles, sha256, urlFor,
  stageModelFrom, isForeignModelCache, ForeignModelCacheError, BUZZ_MANIFEST_FILE,
  type ModelArtifact,
} from './models.js'
import {
  POCKET_VOICES, POCKET_DEFAULT_VOICE, parseVoiceKey, formatVoiceKey, resolveVoiceForBackend,
  OS_BACKEND, POCKET_BACKEND, VOICES_REVISION, voiceUrl,
} from './voices.js'


/**
 * Build a cache whose files are the SIZE THE MANIFEST PINS, sparsely.
 *
 * R19-03 made `modelStatus` consult `MODEL_ARTIFACTS[].bytes`, because a one-byte
 * `mimi_encoder.onnx` against a 39,768,446-byte pin used to report `ready` — a truncated download
 * announcing a working neural voice. That is the right product behaviour and it makes a one-byte
 * fixture an INVALID cache, which it always was; the old fixtures were describing a cache that
 * could not exist. `truncate` extends the file without writing the bytes, so a valid 165 MB
 * fixture costs no disk and no time, and the filler stays at the front for content assertions.
 */
function seedRequired(dir: string, filler = 'x', skip: readonly string[] = []): void {
  const pinned = new Map<string, number>(
    [...MODEL_ARTIFACTS, ...VOICE_ARTIFACTS].map((a) => [a.file, a.bytes] as const),
  )
  for (const f of requiredFiles()) {
    if (skip.includes(f)) continue
    const path = join(dir, f)
    writeFileSync(path, filler)
    const want = pinned.get(f)
    if (want !== undefined && want > filler.length) truncateSync(path, want)
  }
}

const HERE = dirname(fileURLToPath(import.meta.url))
const MODELS_HREF = pathToFileURL(join(HERE, 'models.ts')).href
const made: string[] = []
const children: ChildProcess[] = []
const scratch = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'pocket-models-'))
  made.push(d)
  return d
}
afterEach(async () => {
  for (const c of children.splice(0)) {
    if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL')
  }
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true })
})

/** Wait for a condition. Cap is a hang detector, not a budget (P40). */
async function until(pred: () => boolean, what: string, ms = 10_000): Promise<void> {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what} — this is a HANG, not slowness`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

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

  it('R17-07: a directory with every file but the marker is INCOMPLETE, not absent', async () => {
    // The author's ~/.buzz/models/pocket-tts is this shape: every required payload file, no
    // `.orca-tts-model-manifest`. Collapsing that to kind=absent made the Lab say
    // "download 173.8 MB" for a directory one marker away from ready.
    const dir = scratch()
    seedRequired(dir, 'x', [MANIFEST_FILE])
    const s = await modelStatus(dir)
    expect(s.kind, 'a one-file-short cache must not read as the same kind as an empty directory').toBe('incomplete')
    if (s.kind === 'incomplete') {
      expect(s.missing).toEqual([MANIFEST_FILE])
      expect(s.detail).toMatch(/every required file except/i)
      expect(s.detail).toContain(MANIFEST_FILE)
      expect(s.present).toBe(requiredFiles().length - 1)
      expect(s.required).toBe(requiredFiles().length)
    }
  })

  it('R17-07 CONTROL: a genuinely empty directory is still absent', async () => {
    const dir = scratch()
    const s = await modelStatus(dir)
    expect(s.kind).toBe('absent')
    if (s.kind === 'absent') expect(s.missing).toEqual(requiredFiles())
  })

  it('reports a version mismatch as stale, with both versions', async () => {
    const dir = scratch()
    seedRequired(dir)
    writeFileSync(join(dir, MANIFEST_FILE), '0\n')
    const s = await modelStatus(dir)
    expect(s.kind).toBe('stale')
    if (s.kind === 'stale') { expect(s.found).toBe('0'); expect(s.want).toBe(String(MANIFEST_VERSION)) }
  })

  it('reports ready only when everything is there and current', async () => {
    const dir = scratch()
    seedRequired(dir)
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
    seedRequired(dir, 'previous')
    writeFileSync(join(dir, MANIFEST_FILE), `${MANIFEST_VERSION}\n`)
    expect((await modelStatus(dir)).kind).toBe('ready')

    await expect(downloadModel({ dir, fetchImpl: fakeFetch({ fail: 'mimi_encoder.onnx' }) })).rejects.toThrow()

    expect((await modelStatus(dir)).kind).toBe('ready')
    expect(read(join(dir, 'bundle.json'), 'utf8').startsWith('previous'),
  'the previous model must still be the one on disk').toBe(true)
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
        : new Response(readFileSync(join(HERE, 'model/LICENSE')))
    }
    const body = TINY_BODIES[file]
    if (body === undefined) return new Response('not found', { status: 404, statusText: 'Not Found' })
    return new Response(body, { headers: { 'content-length': String(body.length) } })
  }) as unknown as typeof fetch
}

/** Seed a directory with a recognisable, complete, current model. */
function seedReady(dir: string): void {
  mkdirSync(dir, { recursive: true })
  seedRequired(dir, 'PREVIOUS')
  writeFileSync(join(dir, MANIFEST_FILE), `${MANIFEST_VERSION}\n`)
}

const stillPrevious = (dir: string): boolean =>
  existsSync(join(dir, 'bundle.json')) && read(join(dir, 'bundle.json'), 'utf8').startsWith('PREVIOUS')

describe('R14-06 — the swap is reversible at every step', () => {
  it('reaches the success tail at all, which nothing did before', async () => {
    const dir = join(scratch(), 'model')
    await downloadModel({ dir, artifacts: TINY, fetchImpl: tinyFetch() })
    // By effect: the new bytes are live, the licences are beside them, and the manifest is current.
    expect(read(join(dir, 'bundle.json'), 'utf8')).toBe('{"bundle_name":"tiny"}')
    expect(read(join(dir, 'LICENSE'))).toEqual(readFileSync(join(HERE, 'model/LICENSE')))
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

  it('KEEPS THE OLD MODEL when staging fails BEFORE the live directory is touched', async () => {
    // R17-03's window, on the caller that already had the inner catch. A throw at afterStage
    // must not rm(dir). The runtime caller did, and its named tests could not see it.
    const dir = join(scratch(), 'model')
    seedReady(dir)
    await expect(downloadModel({
      dir, artifacts: TINY, fetchImpl: tinyFetch(),
      hooks: { afterStage: () => { throw new Error('injected: died while staging') } },
    })).rejects.toThrow(/injected: died while staging/)
    expect(existsSync(dir), 'afterStage throw deleted the live model directory').toBe(true)
    expect(stillPrevious(dir), 'afterStage throw destroyed the working model').toBe(true)
  })

  it('cleans a leftover .staging-* from a killed predecessor after a successful download', async () => {
    // R17-05. The production cleanup must do this — restating the callback here would be P36.
    const root = scratch()
    const dir = join(root, 'model')
    seedReady(dir)
    const leftover = `${dir}.staging-99999`
    mkdirSync(leftover, { recursive: true })
    writeFileSync(join(leftover, 'orphan.bin'), 'ORPHAN')
    expect(existsSync(leftover)).toBe(true)
    await downloadModel({ dir, artifacts: TINY, fetchImpl: tinyFetch() })
    expect(existsSync(leftover), 'leftover staging from a killed predecessor survived a successful download').toBe(false)
    expect(readdirSync(root).filter((n) => n.includes('.staging-'))).toEqual([])
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


/* --------------------------------------------- R17-07: one predicate, buzz is read-only */

describe('R17-07 — incomplete is not absent; ~/.buzz is not writable', () => {
  it('isForeignModelCache is true for ~/.buzz and for a dir holding buzz\'s marker', () => {
    expect(isForeignModelCache(join(homedir(), '.buzz', 'models', 'pocket-tts'))).toBe(true)
    expect(isForeignModelCache(join(homedir(), '.buzz'))).toBe(true)
    const ours = scratch()
    expect(isForeignModelCache(ours)).toBe(false)
    writeFileSync(join(ours, BUZZ_MANIFEST_FILE), 'buzz')
    expect(isForeignModelCache(ours)).toBe(true)
  })

  it('REFUSES to download into ~/.buzz, by name, before any file is created', async () => {
    const dir = join(homedir(), '.buzz', `orca-tts-r17-07-must-not-exist-${Date.now()}`)
    expect(existsSync(dir)).toBe(false)
    let fetchCalled = false
    const fetchImpl = (async () => {
      fetchCalled = true
      return new Response('nope')
    }) as unknown as typeof fetch
    await expect(downloadModel({ dir, artifacts: TINY, fetchImpl }))
      .rejects.toBeInstanceOf(ForeignModelCacheError)
    await expect(downloadModel({ dir, artifacts: TINY, fetchImpl }))
      .rejects.toThrow(/refusing to write/)
    expect(fetchCalled, 'must not fetch before the write refusal').toBe(false)
    expect(existsSync(dir), 'must not create anything under ~/.buzz').toBe(false)
  })

  it('REFUSES to download into a directory that already holds .buzz-model-manifest', async () => {
    const dir = scratch()
    writeFileSync(join(dir, BUZZ_MANIFEST_FILE), 'buzz')
    const before = readdirSync(dir)
    await expect(downloadModel({ dir, artifacts: TINY, fetchImpl: tinyFetch() }))
      .rejects.toBeInstanceOf(ForeignModelCacheError)
    expect(readdirSync(dir)).toEqual(before)
  })

  it('stages a weights-complete source into a dest we own, as symlinks plus OUR marker', async () => {
    const source = scratch()
    const dest = scratch()
    // Weights-complete means the PINNED LENGTHS are there (R19-03), not just the names — this
    // source stands in for the author's real buzz cache, which is genuinely complete.
    seedRequired(source, 'payload', [MANIFEST_FILE])
    writeFileSync(join(source, BUZZ_MANIFEST_FILE), 'buzz')
    expect((await modelStatus(source)).kind).toBe('incomplete')

    const result = await stageModelFrom(source, dest)
    expect(result.dest).toBe(dest)
    const s = await modelStatus(dest)
    expect(s.kind).toBe('ready')
    expect(existsSync(join(source, MANIFEST_FILE)), 'must not write the marker into the source').toBe(false)
    const destMarker = (await lstat(join(dest, MANIFEST_FILE))).isSymbolicLink()
    expect(destMarker, 'the marker is a real file we wrote, not a symlink into buzz').toBe(false)
    expect((await lstat(join(dest, 'tokenizer.model'))).isSymbolicLink()).toBe(true)
    expect((await lstat(join(dest, 'eve.wav'))).isSymbolicLink()).toBe(true)
  })

  it('REFUSES to stage INTO ~/.buzz', async () => {
    const source = scratch()
    for (const f of requiredFiles()) {
      if (f === MANIFEST_FILE) continue
      writeFileSync(join(source, f), 'x')
    }
    const dest = join(homedir(), '.buzz', `orca-tts-r17-07-must-not-exist-${Date.now()}`)
    expect(existsSync(dest)).toBe(false)
    await expect(stageModelFrom(source, dest)).rejects.toBeInstanceOf(ForeignModelCacheError)
    expect(existsSync(dest), 'must not create anything under ~/.buzz').toBe(false)
  })

  it('CONTROL: an empty dest of a missing source stays empty and names the miss', async () => {
    const dest = scratch()
    await expect(stageModelFrom(join(dest, 'does-not-exist'), dest))
      .rejects.toThrow(/no Pocket TTS files/)
    expect(readdirSync(dest)).toEqual([])
  })

  it('modelStatusDetail names the marker for the one-file-short case', async () => {
    const dir = scratch()
    seedRequired(dir, 'x', [MANIFEST_FILE])
    const s = await modelStatus(dir)
    expect(modelStatusDetail(s)).toContain(MANIFEST_FILE)
    expect(modelStatusDetail(s)).toMatch(/every required file except/i)
    const empty = await modelStatus(scratch())
    expect(empty.kind).toBe('absent')
    expect(modelStatusDetail(empty)).toMatch(/not installed/i)
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

  it('reports a weights-only directory as INCOMPLETE and names a missing voice', async () => {
    // This is exactly a version-1 cache: every model artifact present, no clips. It used to read
    // as ready and could not speak.
    const dir = scratch()
    for (const a of MODEL_ARTIFACTS) writeFileSync(join(dir, a.file), 'x')
    writeFileSync(join(dir, LICENSE_FILE), 'x')
    writeFileSync(join(dir, MANIFEST_FILE), `${MANIFEST_VERSION}\n`)
    const s = await modelStatus(dir)
    expect(s.kind).toBe('incomplete')
    if (s.kind === 'incomplete') {
      expect(s.missing).toContain('eve.wav')
      expect(s.detail).toMatch(/missing/i)
    }
  })

  it('treats a version-1 cache as stale rather than adopting it', async () => {
    const dir = scratch()
    seedRequired(dir)
    writeFileSync(join(dir, MANIFEST_FILE), '1\n')
    const s = await modelStatus(dir)
    expect(s.kind).toBe('stale')
    if (s.kind === 'stale') expect(s.found).toBe('1')
  })
})


/* -------------------------------- R15-09 / PV-075: LICENSE is required, independently restated */

describe('R15-09 / PV-075 — a cache with no upstream LICENSE is not ready', () => {
  it('restates both licence sidecars by name, not by reading requiredFiles into the expectation', () => {
    // P36: if requiredFiles() dropped LICENSE, seeding from it would shrink the expectation
    // with the defect. The names below are the claim.
    expect(requiredFiles()).toContain('LICENSE')
    expect(requiredFiles()).toContain('MODEL_LICENSE.txt')
  })

  it('pins the upstream LICENSE by digest AND length, independently of requiredFiles', () => {
    // Restated as a literal claim (P36). The vendored copy is the oracle that the pin is the
    // real CC-BY-4.0 text, not a well-formed hex string.
    expect(UPSTREAM_LICENSE.file).toBe('LICENSE')
    expect(UPSTREAM_LICENSE.file).toBe(UPSTREAM_LICENSE_FILE)
    expect(UPSTREAM_LICENSE.sha256).toBe('fe7b4ce83b8381cc5b216bbb4af73c570688d1b819c73bbaed8ca401f4677cd6')
    expect(UPSTREAM_LICENSE.bytes).toBe(18_655)
    const vendored = readFileSync(join(HERE, 'model/LICENSE'))
    expect(vendored.length).toBe(UPSTREAM_LICENSE.bytes)
    expect(sha256(vendored)).toBe(UPSTREAM_LICENSE.sha256)
  })

  it('REFUSES an upstream LICENSE whose digest does not match the pin', async () => {
    const dir = join(scratch(), 'model')
    const badLicence: typeof fetch = (async (input: string | URL | Request) => {
      const file = String(input).split('/').pop() ?? ''
      if (file === 'LICENSE') return new Response(Buffer.alloc(UPSTREAM_LICENSE.bytes, 1))
      const body = TINY_BODIES[file]
      if (body === undefined) return new Response('not found', { status: 404, statusText: 'Not Found' })
      return new Response(body, { headers: { 'content-length': String(body.length) } })
    }) as unknown as typeof fetch
    await expect(downloadModel({ dir, artifacts: TINY, fetchImpl: badLicence }))
      .rejects.toThrow(/LICENSE hashes to [0-9a-f]{64}, expected/)
  })

  it('delete LICENSE from a complete cache: status is no longer ready and NAMES it', async () => {
    // Independent seed — every production artifact except the upstream LICENSE. Not
    // `requiredFiles()` minus one, because that is how the R14-08 half-fix stayed green:
    // LICENSE was never in the list the test asked about.
    const dir = scratch()
    mkdirSync(dir, { recursive: true })
    for (const a of MODEL_ARTIFACTS) writeFileSync(join(dir, a.file), 'x')
    for (const a of VOICE_ARTIFACTS) writeFileSync(join(dir, a.file), 'x')
    writeFileSync(join(dir, LICENSE_FILE), 'x')
    writeFileSync(join(dir, MANIFEST_FILE), `${MANIFEST_VERSION}\n`)
    expect(existsSync(join(dir, 'LICENSE'))).toBe(false)

    const s = await modelStatus(dir)
    expect(s.kind, 'modelStatus called an attribution-incomplete cache ready').not.toBe('ready')
    expect(s.kind).toBe('incomplete')
    if (s.kind === 'incomplete') expect(s.missing).toContain('LICENSE')
  })
})


/* -------------------- R15-02 / PV-073: swap survives process death and a second writer */

const CHILD_PREAMBLE = `import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { downloadModel, sha256 } from ${JSON.stringify(MODELS_HREF)}

const TINY_BODIES = {
  'bundle.json': Buffer.from('{"bundle_name":"tiny"}'),
  'tokenizer.model': Buffer.from('tiny tokenizer bytes'),
  'mimi_encoder.onnx': Buffer.from('tiny encoder bytes'),
}
const TINY = Object.entries(TINY_BODIES).map(([file, body]) => ({
  file, bytes: body.length, sha256: sha256(body),
}))
const tinyFetch = () => (async (input) => {
  const file = String(input).split('/').pop() ?? ''
  if (file === 'LICENSE') return new Response(readFileSync(${JSON.stringify(join(HERE, 'model/LICENSE'))}))
  const body = TINY_BODIES[file]
  if (body === undefined) return new Response('not found', { status: 404, statusText: 'Not Found' })
  return new Response(body, { headers: { 'content-length': String(body.length) } })
})
`

function spawnChild(scriptPath: string, args: string[]): ChildProcess {
  const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', scriptPath, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  return child
}

function waitExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(child.exitCode)
      return
    }
    child.once('exit', (code) => resolve(code))
  })
}

describe('R15-02 / PV-073 — the swap survives process death and refuses a second writer', () => {
  it('a hard SIGKILL between the two renames leaves the live model usable', async () => {
    const root = scratch()
    const dir = join(root, 'model')
    const marker = join(root, 'at-seam')
    const script = join(root, 'kill-child.ts')
    seedReady(dir)
    writeFileSync(script, `${CHILD_PREAMBLE}
const dir = process.argv[2]
const marker = process.argv[3]
await downloadModel({
  dir, artifacts: TINY, fetchImpl: tinyFetch(),
  hooks: {
    afterBackup: async () => {
      writeFileSync(marker, 'at-seam')
      await new Promise(() => {})
    },
  },
})
`)
    const child = spawnChild(script, [dir, marker])
    await until(() => existsSync(marker), 'child to reach afterBackup')
    child.kill('SIGKILL')
    await waitExit(child)

    const s = await modelStatus(dir)
    expect(
      s.kind,
      'SIGKILL removed the only live model; recovery exists only in catch',
    ).toBe('ready')
    expect(stillPrevious(dir), 'the known-good previous bytes must still be loadable').toBe(true)
  }, 20_000)

  it('recovers a pid-suffixed leftover backup when live is missing', async () => {
    const dir = join(scratch(), 'model')
    seedReady(dir)
    const orphan = `${dir}.previous-999999`
    renameSync(dir, orphan)
    expect(existsSync(dir)).toBe(false)
    const s = await modelStatus(dir)
    expect(s.kind, 'a pid-suffixed backup is invisible to a later process').toBe('ready')
    expect(stillPrevious(dir)).toBe(true)
  })

  it('two concurrent downloads: one is refused BY NAME and the winner completes', async () => {
    const root = scratch()
    const dir = join(root, 'model')
    seedReady(dir)
    const hold = join(root, 'holding')
    const go = join(root, 'go')
    const scriptA = join(root, 'writer-a.ts')
    const scriptB = join(root, 'writer-b.ts')
    const resultB = join(root, 'b-result')
    writeFileSync(scriptA, `${CHILD_PREAMBLE}
const dir = process.argv[2]
const hold = process.argv[3]
const go = process.argv[4]
await downloadModel({
  dir, artifacts: TINY, fetchImpl: tinyFetch(),
  hooks: {
    afterStage: async () => {
      writeFileSync(hold, 'holding')
      while (!existsSync(go)) await new Promise((r) => setTimeout(r, 20))
    },
  },
})
writeFileSync(hold + '.done', 'ok')
`)
    writeFileSync(scriptB, `${CHILD_PREAMBLE}
const dir = process.argv[2]
const result = process.argv[3]
try {
  await downloadModel({ dir, artifacts: TINY, fetchImpl: tinyFetch() })
  writeFileSync(result, 'ok')
} catch (err) {
  writeFileSync(result, err instanceof Error ? err.message : String(err))
}
`)
    const childA = spawnChild(scriptA, [dir, hold, go])
    await until(() => existsSync(hold), 'writer A to hold the cache')
    const childB = spawnChild(scriptB, [dir, resultB])
    await until(() => existsSync(resultB), 'writer B to finish (refuse or complete)')
    const bMessage = read(resultB, 'utf8')
    expect(
      bMessage,
      'both processes accepted a writer for the same cache',
    ).toMatch(/already in progress|refusing a second writer/i)
    expect(bMessage, 'the refusal must name the condition, not a generic filesystem error').not.toBe('ok')

    writeFileSync(go, 'go')
    await until(() => existsSync(`${hold}.done`), 'winner A to complete the download')
    await waitExit(childA)
    await waitExit(childB)
    expect(stillPrevious(dir)).toBe(false)
    expect(read(join(dir, 'bundle.json'), 'utf8')).toBe('{"bundle_name":"tiny"}')
  }, 20_000)

  it('in-process: a second downloadModel is refused by name while the first still holds the lock', async () => {
    const dir = join(scratch(), 'model')
    seedReady(dir)
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    let holding = false
    const first = downloadModel({
      dir, artifacts: TINY, fetchImpl: tinyFetch(),
      hooks: {
        afterStage: async () => {
          holding = true
          await held
        },
      },
    })
    await until(() => holding, 'first download to acquire the writer slot')
    await expect(downloadModel({ dir, artifacts: TINY, fetchImpl: tinyFetch() }))
      .rejects.toThrow(/already in progress|refusing a second writer/i)
    release()
    await first
    expect(read(join(dir, 'bundle.json'), 'utf8')).toBe('{"bundle_name":"tiny"}')
  })
})

/**
 * R18-04 / R18-05 — round 18 on the R17-07 repair.
 *
 * Both are one mistake in two places: **a NAME is not a FILE, and a PATH is not a LOCATION.**
 *
 * R18-04: `modelStatus` built its answer from `readdir` NAMES. A symlink whose target has been
 * deleted still has a name, so a staged cache whose source went away reported `ready` while
 * `existsSync` on that same file — which follows the link — was false. That is the author's path
 * exactly: `stage-pocket-model` symlinks buzz's weights, buzz later cleans its cache, and the
 * product announces the neural voice as ready and then cannot speak.
 *
 * R18-05: `isForeignModelCache` resolved the real path only when the directory ALREADY EXISTED
 * (`existsSync(dir) ? realpathSync(dir) : target`). A destination that does not exist yet is
 * precisely what a staging command passes, so a dest whose PARENT is a symlink into `~/.buzz`
 * walked past the guard — and the write then created it inside another application's directory.
 * R061 was enforced as a string prefix rather than as the location actually written to.
 */
describe('R18-04 ready means the bytes are reachable, not that the name is present', () => {
  it('a staged cache whose source has been deleted is NOT ready', async () => {
    const source = scratch()
    const dest = scratch()
    seedRequired(source)
    for (const f of requiredFiles()) symlinkSync(join(source, f), join(dest, f))
    writeFileSync(join(dest, MANIFEST_FILE), `${MANIFEST_VERSION}\n`)

    expect((await modelStatus(dest)).kind,
      'CONTROL: a live staged cache must be ready, or this test proves nothing').toBe('ready')

    rmSync(source, { recursive: true, force: true })
    expect((await modelStatus(dest)).kind,
      'every name is still present and not one byte is reachable').not.toBe('ready')
  })
})

describe('R18-05 the foreign-cache refusal locates the write, not the string', () => {
  it('a dest that does not exist yet, under a parent symlinked into .buzz, is foreign', () => {
    const home = scratch()
    const buzzModels = join(home, '.buzz', 'models')
    mkdirSync(buzzModels, { recursive: true })
    const outside = scratch()
    const link = join(outside, 'parentlink')
    symlinkSync(buzzModels, link)
    mkdirSync(join(link, 'already-there'), { recursive: true })

    expect(isForeignModelCache(join(link, 'already-there'), home),
      'CONTROL: an EXISTING dest through the link was already caught before this fix').toBe(true)
    expect(isForeignModelCache(join(link, 'not-yet-created'), home),
      'a dest that does not exist yet is exactly what a staging command passes').toBe(true)
    expect(isForeignModelCache(join(outside, 'ours'), home),
      'CONTROL: an ordinary destination must NOT be refused, or the guard is just "always true"')
      .toBe(false)
  })
})

/**
 * R19-02 / R19-03 — round 19 on the R18-04/05 repair I made an hour earlier.
 *
 * Same lesson a third time (P50): I fixed the case I could think of, and the filesystem knows
 * more cases than I do.
 *
 * R19-02: `realWriteLocation` resolves symlinks but compares the result as a STRING. On this APFS
 * volume `~/.buzz` and `~/.BUZZ` are **inode 9541114** — the same directory — and the string
 * comparison says they are different. `stageModelFrom(source, home/.BUZZ/staged)` reported
 * `foreign: false`, threw nothing, and wrote 22 files into buzz's directory. My R18-05 test covered
 * the symlink parent, which is the case I had just been shown, and not the case-fold.
 *
 * The fix stops asking what the path SPELLS and asks the filesystem what it IS: same device plus
 * same inode is the same directory, whatever it is spelled like, through however many links.
 *
 * R19-03: `ready` meant every required NAME resolved to something that exists. It never looked at
 * the size. `MODEL_ARTIFACTS` pins `mimi_encoder.onnx` at 39,768,446 bytes; a ONE-BYTE file of the
 * same name reported `ready`. Truncated and zero-length caches — a download killed midway, a disk
 * that filled — announce a working neural voice and then cannot speak.
 */
describe('R19-02 the foreign-cache refusal asks the filesystem, not the spelling', () => {
  it('a case-variant spelling of the same directory is the same directory', () => {
    const home = scratch()
    mkdirSync(join(home, '.buzz', 'models'), { recursive: true })
    // Only meaningful where the volume is case-insensitive; where it is not, these really are
    // two different directories and `false` is the correct answer. Ask, do not assume.
    const insensitive = existsSync(join(home, '.BUZZ'))
    expect(isForeignModelCache(join(home, '.buzz', 'models', 'x'), home),
      'CONTROL: the canonical spelling must be caught, or nothing here means anything').toBe(true)
    expect(isForeignModelCache(join(home, '.BUZZ', 'models', 'r19-must-not-exist'), home),
      'same inode, different spelling').toBe(insensitive)
    expect(isForeignModelCache(join(scratch(), 'ours'), home),
      'CONTROL: an unrelated directory must NOT be refused').toBe(false)
  })
})

describe('R19-03 ready means the bytes are there, not that the name is', () => {
  it('a truncated required file is not ready, and says which', async () => {
    const dir = scratch()
    // Deliberately ONE BYTE each — this is the invalid cache, not a shortcut for a valid one.
    for (const f of requiredFiles()) writeFileSync(join(dir, f), 'x')
    writeFileSync(join(dir, MANIFEST_FILE), `${MANIFEST_VERSION}\n`)
    const status = await modelStatus(dir)
    expect(status.kind, 'a one-byte mimi_encoder.onnx against a 39,768,446-byte pin').not.toBe('ready')
    expect(modelStatusDetail(status)).toMatch(/mimi_encoder\.onnx/)
  })

  it('CONTROL: correctly-sized files still reach ready, so this is not "never ready"', async () => {
    const dir = scratch()
    const sized = new Map(MODEL_ARTIFACTS.map((a) => [a.file, a.bytes]))
    for (const v of VOICE_ARTIFACTS) sized.set(v.file, v.bytes)
    for (const f of requiredFiles()) {
      const n = sized.get(f)
      writeFileSync(join(dir, f), n === undefined ? 'x' : Buffer.alloc(n))
    }
    writeFileSync(join(dir, MANIFEST_FILE), `${MANIFEST_VERSION}\n`)
    expect((await modelStatus(dir)).kind).toBe('ready')
  })
})
