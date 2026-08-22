/**
 * The runtime delivery path (R14-01).
 *
 * Nothing here touches the network or a 100 MB tarball: a **real gzipped tar is built in the test**
 * from a handful of bytes, and its integrity is computed from those bytes. That is the only way to
 * exercise verification, extraction and the swap — the same lesson R14-06 taught, where every
 * download test derived its fixture from production hashes and therefore never reached the code
 * that mattered.
 */
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { gzipSync, gunzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  RUNTIME_VERSION, RUNTIME_FILES, RUNTIME_INTEGRITY, RUNTIME_TARBALL, RUNTIME_MANIFEST_FILE,
  RUNTIME_MANIFEST_VERSION, RUNTIME_APPROX_BYTES,
  downloadRuntime, integrityOf, platformKey, readTar, runtimeDir, runtimeStatus,
} from './runtime.ts'

const made: string[] = []
const scratch = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'ort-runtime-'))
  made.push(d)
  return d
}
afterEach(async () => { for (const d of made.splice(0)) await rm(d, { recursive: true, force: true }) })

/* ------------------------------------------------------------------------------ a real tarball */

/** A ustar header plus body, padded — the format `readTar` has to survive in the wild. */
function tarEntry(name: string, body: Buffer, type = '0'): Buffer {
  const header = Buffer.alloc(512)
  header.write(name.slice(0, 100), 0, 'utf8')
  header.write('000644 \0', 100, 'ascii')
  header.write('000000 \0', 108, 'ascii')
  header.write('000000 \0', 116, 'ascii')
  header.write(body.length.toString(8).padStart(11, '0') + ' ', 124, 'ascii')
  header.write('00000000000 ', 136, 'ascii')
  header.write(type, 156, 'ascii')
  header.write('ustar\0' + '00', 257, 'ascii')
  // The checksum field must read as spaces while the checksum is computed over it.
  header.write('        ', 148, 'ascii')
  let sum = 0
  for (const b of header) sum += b
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii')
  const pad = Buffer.alloc((512 - (body.length % 512)) % 512)
  return Buffer.concat([header, body, pad])
}

function makeTarball(key: string, files: readonly string[], opts: { longNames?: boolean } = {}): Buffer {
  const parts: Buffer[] = []
  parts.push(tarEntry('package/package.json', Buffer.from('{"name":"onnxruntime-node"}')))
  // A decoy for a platform we are not on: the extractor must not take it.
  parts.push(tarEntry('package/bin/napi-v6/aix/ppc64/onnxruntime_binding.node', Buffer.from('WRONG PLATFORM')))
  for (const f of files) {
    const name = `package/bin/napi-v6/${key.replace('-', '/')}/${f}`
    const body = Buffer.from(`bytes of ${f}`)
    if (opts.longNames === true) {
      // A GNU long-name entry, which is what a real npm tarball uses for paths past 100 bytes.
      parts.push(tarEntry('././@LongLink', Buffer.from(name + '\0'), 'L'))
      parts.push(tarEntry(name.slice(0, 100), body))
    } else {
      parts.push(tarEntry(name, body))
    }
  }
  parts.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(parts))
}

const KEY = 'linux-x64'
const FILES = RUNTIME_FILES[KEY] ?? []

function tarballFetch(tgz: Buffer, opts: { status?: number } = {}): typeof fetch {
  return (async () => {
    if (opts.status !== undefined) return new Response('nope', { status: opts.status, statusText: 'Gone' })
    return new Response(tgz)
  }) as unknown as typeof fetch
}

/* -------------------------------------------------------------------------------- the manifest */

describe('the pinned runtime', () => {
  it('pins an exact version and npm-shaped integrity, never a range', () => {
    expect(RUNTIME_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(RUNTIME_TARBALL).toContain(RUNTIME_VERSION)
    expect(RUNTIME_TARBALL).not.toContain('latest')
    expect(RUNTIME_INTEGRITY).toMatch(/^sha512-[A-Za-z0-9+/]+={0,2}$/)
  })

  it('covers five targets and NOT darwin-x64, which is upstream\'s gap', () => {
    // Measured: `onnxruntime-node@1.27.0` ships no Intel-Mac binary. Recording it as a test rather
    // than a comment means the day upstream adds one, this row is where somebody notices.
    expect(Object.keys(RUNTIME_FILES).toSorted()).toEqual(
      ['darwin-arm64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64'])
    expect(RUNTIME_FILES['darwin-x64']).toBeUndefined()
  })

  it('names a binding and a library for every supported target', () => {
    for (const [key, files] of Object.entries(RUNTIME_FILES)) {
      expect(files, key).toContain('onnxruntime_binding.node')
      expect(files.some((f) => /\.(dylib|so\.1|dll)$/.test(f)), `${key} has no shared library`).toBe(true)
      expect(RUNTIME_APPROX_BYTES[key], `${key} has no advertised size`).toBeGreaterThan(1_000_000)
    }
  })

  it('caches beside the model, not inside it', () => {
    // Separate versions: the runtime and the weights move on different schedules, and coupling
    // them would force a 173 MB re-download to pick up a runtime patch.
    expect(runtimeDir({ ORCA_TTS_RUNTIME_DIR: '/tmp/rt' } as NodeJS.ProcessEnv)).toBe('/tmp/rt')
    expect(runtimeDir({} as NodeJS.ProcessEnv)).toContain('onnxruntime')
    expect(runtimeDir({} as NodeJS.ProcessEnv)).toContain(RUNTIME_VERSION)
  })
})

/* --------------------------------------------------------------------------------------- tar */

describe('readTar', () => {
  it('finds a file at a deep path', () => {
    const names = readTar(gunzipSync(makeTarball(KEY, FILES))).map((e) => e.name)
    expect(names).toContain(`package/bin/napi-v6/linux/x64/onnxruntime_binding.node`)
  })

  it('handles GNU long names, which real npm tarballs use', () => {
    // Silently skipping these would drop exactly the deep bin/napi-v6/... paths this parser exists
    // to find, and the failure would look like an empty download rather than a parser gap.
    const raw = gunzipSync(makeTarball(KEY, FILES, { longNames: true }))
    const names = readTar(raw).map((e) => e.name)
    expect(names).toContain(`package/bin/napi-v6/linux/x64/libonnxruntime.so.1`)
  })

  it('stops at the end-of-archive blocks instead of reading padding as entries', () => {
    const raw = gunzipSync(makeTarball(KEY, FILES))
    expect(readTar(raw).every((e) => e.name.length > 0)).toBe(true)
  })

  it('REFUSES an unreadable size rather than guessing', () => {
    const raw = Buffer.from(gunzipSync(makeTarball(KEY, FILES)))
    raw.write('zzzzzzzzzzz ', 124, 'ascii')
    expect(() => readTar(raw)).toThrow(/unreadable size/)
  })
})

/* ---------------------------------------------------------------------------------- download */

describe('downloadRuntime', () => {
  it('extracts THIS platform\'s files and nothing else', async () => {
    const dir = join(scratch(), 'rt')
    const tgz = makeTarball(KEY, FILES)
    await downloadRuntime({ dir, key: KEY, fetchImpl: tarballFetch(tgz), integrity: integrityOf(tgz) })
    for (const f of FILES) expect(existsSync(join(dir, f)), f).toBe(true)
    // The decoy from another platform must not be here, and neither must package.json.
    expect(readdirSync(dir).toSorted()).toEqual([...FILES, RUNTIME_MANIFEST_FILE].toSorted())
    expect(readFileSync(join(dir, 'onnxruntime_binding.node'), 'utf8')).toBe('bytes of onnxruntime_binding.node')
  })

  it('REFUSES a tarball whose integrity does not match, and installs nothing', async () => {
    // This gates an EXECUTABLE that runs as the user. A substituted weight file makes bad audio; a
    // substituted .dylib is a different class of problem, which is why this can never be
    // best-effort.
    const dir = join(scratch(), 'rt')
    const tgz = makeTarball(KEY, FILES)
    await expect(downloadRuntime({
      dir, key: KEY, fetchImpl: tarballFetch(tgz), integrity: 'sha512-' + 'A'.repeat(86) + '==',
    })).rejects.toThrow(/REFUSING/)
    expect(existsSync(dir)).toBe(false)
  })

  it('REFUSES an archive missing a file it needs, naming the file', async () => {
    // Installing a partial runtime would fail later as a linker error nobody can trace back here.
    const dir = join(scratch(), 'rt')
    const tgz = makeTarball(KEY, FILES.slice(0, 1))
    await expect(downloadRuntime({ dir, key: KEY, fetchImpl: tarballFetch(tgz), integrity: integrityOf(tgz) }))
      .rejects.toThrow(new RegExp(FILES[1] ?? 'nothing'))
    expect(existsSync(dir)).toBe(false)
  })

  it('reports an HTTP failure as itself', async () => {
    const dir = join(scratch(), 'rt')
    await expect(downloadRuntime({
      dir, key: KEY, fetchImpl: tarballFetch(Buffer.alloc(0), { status: 410 }), integrity: 'x',
    })).rejects.toThrow(/HTTP 410/)
  })

  it('REFUSES a platform upstream does not publish, without pretending it failed', async () => {
    await expect(downloadRuntime({ dir: join(scratch(), 'rt'), key: 'darwin-x64' }))
      .rejects.toThrow(/no binary for darwin-x64|system voices are unaffected/)
  })

  it('KEEPS a working runtime when the swap fails', async () => {
    const dir = join(scratch(), 'rt')
    mkdirSync(dir, { recursive: true })
    for (const f of FILES) writeFileSync(join(dir, f), 'PREVIOUS')
    writeFileSync(join(dir, RUNTIME_MANIFEST_FILE), `${RUNTIME_VERSION}/${RUNTIME_MANIFEST_VERSION}\n`)

    const tgz = makeTarball(KEY, FILES.slice(0, 1)) // missing a file -> throws during extraction
    await expect(downloadRuntime({ dir, key: KEY, fetchImpl: tarballFetch(tgz), integrity: integrityOf(tgz) }))
      .rejects.toThrow()
    expect(readFileSync(join(dir, FILES[0] ?? ''), 'utf8')).toBe('PREVIOUS')
    expect((await runtimeStatus(dir, KEY)).kind).toBe('ready')
  })

  it('reports progress through every stage, in order', async () => {
    // R011: never make the user wait without a signal, and 39-67 MB is a real wait.
    const dir = join(scratch(), 'rt')
    const tgz = makeTarball(KEY, FILES)
    const stages: string[] = []
    await downloadRuntime({
      dir, key: KEY, fetchImpl: tarballFetch(tgz), integrity: integrityOf(tgz),
      onProgress: (p) => { if (stages.at(-1) !== p.stage) stages.push(p.stage) },
    })
    expect(stages).toEqual(['fetching', 'verifying', 'extracting', 'installing'])
  })
})

/* ------------------------------------------------------------------------------------ status */

describe('runtimeStatus', () => {
  it('names an unsupported platform without calling it a failure', async () => {
    // An Intel Mac is not broken and its user has done nothing wrong. "Download failed" would be a
    // lie; saying nothing would be R009's silent failure.
    const s = await runtimeStatus(join(scratch(), 'rt'), 'darwin-x64')
    expect(s.kind).toBe('unsupported')
    if (s.kind === 'unsupported') {
      expect(s.why).toMatch(/Intel-Mac|no Intel/i)
      expect(s.why).toMatch(/system voices are unaffected/i)
    }
  })

  it('names what is missing rather than returning a bare boolean', async () => {
    const s = await runtimeStatus(scratch(), KEY)
    expect(s.kind).toBe('absent')
    if (s.kind === 'absent') {
      expect(s.missing).toContain('onnxruntime_binding.node')
      expect(s.bytes).toBeGreaterThan(1_000_000)
    }
  })

  it('reports a version change as stale, carrying both versions', async () => {
    const dir = scratch()
    for (const f of FILES) writeFileSync(join(dir, f), 'x')
    writeFileSync(join(dir, RUNTIME_MANIFEST_FILE), '0.0.0/0\n')
    const s = await runtimeStatus(dir, KEY)
    expect(s.kind).toBe('stale')
    if (s.kind === 'stale') expect(s.want).toBe(`${RUNTIME_VERSION}/${RUNTIME_MANIFEST_VERSION}`)
  })

  it('is ready only after a real download, and points at the binding', async () => {
    const dir = join(scratch(), 'rt')
    const tgz = makeTarball(KEY, FILES)
    expect((await runtimeStatus(dir, KEY)).kind).toBe('absent')
    await downloadRuntime({ dir, key: KEY, fetchImpl: tarballFetch(tgz), integrity: integrityOf(tgz) })
    const s = await runtimeStatus(dir, KEY)
    expect(s.kind).toBe('ready')
    if (s.kind === 'ready') expect(existsSync(s.binding)).toBe(true)
  })

  it('CONTROL: platformKey reflects the machine it is asked about', () => {
    expect(platformKey('win32', 'x64')).toBe('win32-x64')
    expect(platformKey('darwin', 'arm64')).toBe('darwin-arm64')
  })
})
