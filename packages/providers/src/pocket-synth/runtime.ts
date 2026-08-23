/**
 * Getting the native ONNX Runtime onto a machine that is not the developer's.
 *
 * `D004` in `docs/.discussion/` is the argument; this is the mechanism. The short version, because
 * a stranger reading this file deserves it without a detour:
 *
 *   - `onnxruntime-node@1.27.0` unpacks to **270,827,297 bytes** `[measured-here]`. The plugin
 *     artifact is capped at 50 MB (R023), so it can never be bundled.
 *   - ORCA never runs `npm install` for a plugin, so `pnpm add onnxruntime-node` is a developer
 *     convenience and not a distribution story. Without this file, a third party's install
 *     receives no runtime and the Pocket backend reports itself unavailable **forever** — which is
 *     R14-01, and it is what made the feature decorative for everyone but us.
 *
 * So the runtime is fetched into the same cache as the weights, by the same rules: pinned version,
 * digest verified as a **hard refusal**, staged and swapped atomically, and a status that names
 * what is missing. R022 was written about model weights (*"download at runtime into a cache
 * outside the immutable install tree"*) and the reasoning transfers exactly.
 *
 * **One difference matters and it is not decoration: this is an executable.** A substituted weight
 * file produces bad audio; a substituted `.dylib` runs as the user. That is why the digest check
 * here can never be best-effort, why the URL is pinned to an exact version, and why an unverifiable
 * download is deleted rather than kept for a retry.
 *
 * Only the CURRENT platform's files are extracted. The tarball carries five platforms; a machine
 * needs one, and the difference is 39 MB against 271 MB.
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile, readdir, chmod } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { modelDir } from './models.ts'
import {
  DownloadInProgressError, swapLiveDirectory, type SwapHooks,
} from './safe-swap.ts'

export { DownloadInProgressError }

/** The exact version this project is built and tested against. Never a range. */
export const RUNTIME_VERSION = '1.27.0'
export const RUNTIME_PACKAGE = 'onnxruntime-node'

/**
 * Bump when the version or the extracted file set changes.
 *
 * Separate from the model manifest's version on purpose: the runtime and the weights move on
 * different schedules, and coupling them would force a 173 MB re-download to pick up a runtime
 * patch.
 */
export const RUNTIME_MANIFEST_VERSION = 1
export const RUNTIME_MANIFEST_FILE = '.orca-tts-runtime-manifest'

export const RUNTIME_TARBALL =
  `https://registry.npmjs.org/${RUNTIME_PACKAGE}/-/${RUNTIME_PACKAGE}-${RUNTIME_VERSION}.tgz`

/**
 * npm's own integrity for that exact tarball, `sha512-<base64>`.
 *
 * Taken from `npm view onnxruntime-node@1.27.0 dist.integrity` and re-verified against the bytes
 * on this machine before being written down — the same rule the model manifest follows, and for a
 * better reason: this one gates an executable.
 */
export const RUNTIME_INTEGRITY =
  'sha512-QEzGwrvNBgv4uPVdnbHsOGG4G6T96mdlcFI8aAKPjMU8wOPpVocPXb6k3QGkaZagVTv2G9Bnnbo6Z3JdXr1fQw=='

/**
 * What each platform actually needs out of that tarball.
 *
 * `darwin/arm64` ships `libonnxruntime.1.27.0.dylib` and `libonnxruntime.1.dylib` with **identical
 * SHA-256** — the same 38.8 MB twice, a flattened symlink. Both names are extracted because the
 * binding resolves one of them and which one is not ours to assume, but only one copy is
 * downloaded, so the cost is the tarball's, not ours to double.
 *
 * **`darwin/x64` is deliberately absent, and that is upstream's gap rather than an oversight.**
 * Microsoft publishes no Intel-Mac binary for this version. `runtimeStatus()` returns
 * `unsupported` there, with a sentence a person can act on, and the OS synthesizer keeps working —
 * which is the whole reason the backend seam exists.
 */
export const RUNTIME_FILES: Readonly<Record<string, readonly string[]>> = {
  'darwin-arm64': ['libonnxruntime.1.27.0.dylib', 'libonnxruntime.1.dylib', 'onnxruntime_binding.node'],
  'linux-x64': ['libonnxruntime.so.1', 'onnxruntime_binding.node'],
  'linux-arm64': ['libonnxruntime.so.1', 'onnxruntime_binding.node'],
  'win32-x64': ['onnxruntime.dll', 'onnxruntime_binding.node', 'DirectML.dll', 'dxcompiler.dll', 'dxil.dll'],
  'win32-arm64': ['onnxruntime.dll', 'onnxruntime_binding.node'],
}

/** Approximate per-platform download, for telling somebody before spending their bandwidth. */
export const RUNTIME_APPROX_BYTES: Readonly<Record<string, number>> = {
  'darwin-arm64': 39_100_000,
  'linux-x64': 37_000_000,
  'linux-arm64': 19_000_000,
  'win32-x64': 61_000_000,
  'win32-arm64': 67_000_000,
}

export function platformKey(platform = process.platform, arch = process.arch): string {
  return `${platform}-${arch}`
}

/** Where the extracted runtime lives — beside the model cache, not inside it. */
export function runtimeDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ORCA_TTS_RUNTIME_DIR
  if (override !== undefined && override !== '') return override
  return join(dirname(modelDir(env)), 'onnxruntime', RUNTIME_VERSION)
}

export type RuntimeStatus =
  | { readonly kind: 'ready', readonly dir: string, readonly binding: string }
  | { readonly kind: 'absent', readonly dir: string, readonly missing: readonly string[], readonly bytes: number }
  | { readonly kind: 'stale', readonly dir: string, readonly found: string, readonly want: string }
  | { readonly kind: 'unsupported', readonly platform: string, readonly why: string }

/**
 * Is a usable runtime present?
 *
 * `unsupported` is a FIRST-CLASS state, not an error. An Intel Mac is not broken and its user has
 * done nothing wrong; telling them "download failed" would be a lie, and telling them nothing
 * would be R009's silent failure. They get a sentence naming the cause and what still works.
 */
export async function runtimeStatus(
  dir = runtimeDir(),
  key = platformKey(),
): Promise<RuntimeStatus> {
  const wanted = RUNTIME_FILES[key]
  if (wanted === undefined) {
    return {
      kind: 'unsupported',
      platform: key,
      why: key === 'darwin-x64'
        ? `${RUNTIME_PACKAGE} ${RUNTIME_VERSION} publishes no Intel-Mac binary, so the neural ` +
          'voices cannot run on this machine. Your system voices are unaffected.'
        : `${RUNTIME_PACKAGE} ${RUNTIME_VERSION} publishes no binary for ${key}. ` +
          'Your system voices are unaffected.',
    }
  }
  const bytes = RUNTIME_APPROX_BYTES[key] ?? 0
  if (!existsSync(dir)) return { kind: 'absent', dir, missing: [...wanted], bytes }

  const present = new Set(await readdir(dir))
  const missing = [...wanted, RUNTIME_MANIFEST_FILE].filter((f) => !present.has(f))
  if (missing.length > 0) return { kind: 'absent', dir, missing, bytes }

  const found = (await readFile(join(dir, RUNTIME_MANIFEST_FILE), 'utf8')).trim()
  const want = `${RUNTIME_VERSION}/${RUNTIME_MANIFEST_VERSION}`
  if (found !== want) return { kind: 'stale', dir, found, want }
  return { kind: 'ready', dir, binding: join(dir, 'onnxruntime_binding.node') }
}

/* ------------------------------------------------------------------------------ tar, minimally */

export interface TarEntry {
  readonly name: string
  readonly body: Buffer
}

/**
 * Read a POSIX/ustar archive far enough to pull five files out of it.
 *
 * Hand-rolled rather than depended upon for the same reason as the tokenizer: this runs on a
 * third party's machine and every transitive dependency is a parity risk (R026, principle II).
 * The format is 512-byte headers, a NUL-terminated name at offset 0, an octal size at 124, and
 * bodies padded to 512.
 *
 * **Long names are handled, not ignored.** npm tarballs prefix every path with `package/`, and a
 * GNU `L` entry carries names past 100 bytes; silently skipping those would drop exactly the deep
 * `bin/napi-v6/<platform>/<arch>/…` paths this function exists to find, and the failure would look
 * like an empty download rather than a parser gap.
 */
export function readTar(buf: Buffer): TarEntry[] {
  const out: TarEntry[] = []
  let pos = 0
  let longName: string | null = null
  while (pos + 512 <= buf.length) {
    const header = buf.subarray(pos, pos + 512)
    // Two consecutive zero blocks end the archive; one is enough to stop reading.
    if (header.every((b) => b === 0)) break
    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/[\0 ]/g, '')
    const size = Number.parseInt(sizeText, 8)
    if (!Number.isFinite(size) || size < 0) throw new Error(`tar: unreadable size at offset ${pos}`)
    const type = String.fromCharCode(header[156] ?? 0)
    const body = buf.subarray(pos + 512, pos + 512 + size)
    pos += 512 + Math.ceil(size / 512) * 512

    if (type === 'L') { longName = body.toString('utf8').replace(/\0.*$/, ''); continue }
    const name = longName ?? rawName
    longName = null
    if (type === '0' || type === '\0') out.push({ name, body: Buffer.from(body) })
  }
  return out
}

/* ------------------------------------------------------------------------------ the download */

export interface RuntimeDownloadProgress {
  readonly stage: 'fetching' | 'verifying' | 'extracting' | 'installing'
  readonly received?: number
  readonly total?: number
  readonly file?: string
}

export function integrityOf(buf: Uint8Array): string {
  return `sha512-${createHash('sha512').update(buf).digest('base64')}`
}

/**
 * Fetch, verify, extract this platform's files, and swap them in.
 *
 * The swap follows `downloadModel`'s corrected order for the same reason (R14-06): stage beside
 * the target so a rename cannot cross a filesystem, move any existing runtime aside, rename the
 * new one in, and only then discard the backup. A failure anywhere rolls back, so a machine that
 * had a working runtime still has one.
 */
export async function downloadRuntime(options: {
  dir?: string
  key?: string
  onProgress?: (p: RuntimeDownloadProgress) => void
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  /** Tests inject a small archive; production never passes this. */
  tarballUrl?: string
  /** Tests inject the integrity of that archive. Production never passes this. */
  integrity?: string
  /** Failure-injection points, so a test can fail AFTER each rename. Tests only. */
  hooks?: SwapHooks
} = {}): Promise<string> {
  const key = options.key ?? platformKey()
  const wanted = RUNTIME_FILES[key]
  if (wanted === undefined) {
    throw new Error(
      `${RUNTIME_PACKAGE} ${RUNTIME_VERSION} publishes no binary for ${key}, so there is nothing ` +
      'to download. The system voices are unaffected.',
    )
  }
  const dir = options.dir ?? runtimeDir()
  const doFetch = options.fetchImpl ?? fetch
  const url = options.tarballUrl ?? RUNTIME_TARBALL
  const wantIntegrity = options.integrity ?? RUNTIME_INTEGRITY

  options.onProgress?.({ stage: 'fetching', total: RUNTIME_APPROX_BYTES[key] ?? 0 })
  const init: RequestInit = options.signal === undefined ? {} : { signal: options.signal }
  const res = await doFetch(url, init)
  if (!res.ok) throw new Error(`downloading the ONNX Runtime: HTTP ${res.status} ${res.statusText}`)
  const tgz = Buffer.from(await res.arrayBuffer())

  // A HARD refusal, never best-effort. This gates an executable that will run as the user, and a
  // substituted binary is a different class of problem from a substituted weight file.
  options.onProgress?.({ stage: 'verifying', received: tgz.length })
  const got = integrityOf(tgz)
  if (got !== wantIntegrity) {
    throw new Error(
      `the ONNX Runtime download does not match its pinned integrity — REFUSING it.\n` +
      `  expected ${wantIntegrity}\n  received ${got}\n` +
      'Nothing was installed and the previous runtime, if any, is untouched.',
    )
  }

  options.onProgress?.({ stage: 'extracting' })
  const entries = readTar(gunzipSync(tgz))
  const prefix = `package/bin/napi-v6/${key.replace('-', '/')}/`
  const found = new Map<string, Buffer>()
  for (const e of entries) {
    if (!e.name.startsWith(prefix)) continue
    const base = e.name.slice(prefix.length)
    if (wanted.includes(base)) found.set(base, e.body)
  }
  const absent = wanted.filter((f) => !found.has(f))
  if (absent.length > 0) {
    // The archive changed shape under us. Say which files, rather than installing a partial
    // runtime that fails later with a linker error nobody can trace back to here.
    throw new Error(
      `the ONNX Runtime archive did not contain ${absent.join(', ')} for ${key}. ` +
      'Nothing was installed.',
    )
  }

  options.onProgress?.({ stage: 'installing' })

  /*
   * R16-03 / R17-03 / R17-05. This cache was written AFTER the model cache had been fixed
   * twice for the same defect, then "shared" into `./safe-swap.ts` without moving the swap
   * itself. The inlined catch did `rm(dir)` on a throw before the swap (a failed download
   * deleted the live runtime) and leftover `.staging-*` was never cleaned because the
   * `finally` callback swapped `(base, name)`. The two-rename sequence lives in
   * `swapLiveDirectory`. Inlining it here is how the defect comes back.
   */
  return swapLiveDirectory(dir, async (staging) => {
    for (const [name, body] of found) {
      await writeFile(join(staging, name), body)
      // The binding is loaded rather than executed, but the shared libraries must be readable and
      // the `.node` file must keep its executable bit where the platform cares.
      if (name.endsWith('.node') || name.endsWith('.dylib') || name.endsWith('.so.1')) {
        await chmod(join(staging, name), 0o755)
      }
      options.onProgress?.({ stage: 'installing', file: name })
    }
    await writeFile(join(staging, RUNTIME_MANIFEST_FILE), `${RUNTIME_VERSION}/${RUNTIME_MANIFEST_VERSION}\n`)
  }, options.hooks ?? {})
}
