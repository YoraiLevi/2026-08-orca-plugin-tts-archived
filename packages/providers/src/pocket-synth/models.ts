/**
 * The Pocket TTS model manifest and its downloader.
 *
 * The shape is buzz's, deliberately (`desktop/src-tauri/src/huddle/models.rs`), because it is a
 * solved problem and this project has no reason to re-solve it:
 *
 *   - **Nothing is bundled.** 166 MB does not go in a plugin artifact; it goes in a cache
 *     directory, downloaded on first use. This is also why the 50 MB `size-gate` stays green —
 *     the weights are never part of what ships.
 *   - **Everything is pinned.** A repo id, a REVISION, and a SHA-256 plus byte length for every
 *     file. "Latest" is not a thing a synthesizer may follow: the voice a listener tuned by ear
 *     must be the voice they get tomorrow.
 *   - **A version manifest sits beside the bytes.** If the on-disk version differs from the
 *     compiled-in one, the cache is stale and is refetched. Bump `MANIFEST_VERSION` when the
 *     artifacts change.
 *   - **Downloads land in a temp directory and are swapped in atomically.** A failed or
 *     interrupted download must never destroy a working model — the machine that fails to
 *     download is usually the machine that most needs the copy it already had.
 *
 * Attribution travels with the bytes: `MODEL_LICENSE.txt` is written into the cache directory, as
 * CC-BY-4.0 requires and as buzz does.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

/* ------------------------------------------------------------------------------- the manifest */

/** The upstream ONNX export. */
export const MODEL_REPO = 'KevinAHM/pocket-tts-onnx'
/** Pinned revision. Never a branch name: a branch moves and the voice changes underneath us. */
export const MODEL_REVISION = '58a6d00cf13d239b6748cb0769f35c580a8f606c'
/** The language bundle. 6-layer English; the `*_24l` bundles are much larger and slower. */
export const BUNDLE_ID = 'english_2026-04'

/** Bump when the artifact list or any hash changes; a mismatched on-disk manifest refetches. */
export const MANIFEST_VERSION = 1

export interface ModelArtifact {
  readonly file: string
  readonly sha256: string
  readonly bytes: number
}

/**
 * The eight files the INT8 runtime needs, every one pinned by digest AND by length.
 *
 * The digests came from buzz's table and were then **re-verified against the actual bytes on this
 * machine** — `shasum -a 256` over `~/.buzz/models/pocket-tts/*`, all eight matching — rather than
 * copied on trust. A hash transcribed from a document that nobody checked is a hash that pins
 * whatever the document's author happened to have.
 *
 * Total 165,232,420 bytes, which is also what buzz's own test asserts.
 */
export const MODEL_ARTIFACTS: readonly ModelArtifact[] = [
  { file: 'bundle.json', sha256: 'bab643150f437f37df080a710520ff39ed9ebd9a339f8ebdc739f7eddfc28b3f', bytes: 24_381 },
  { file: 'bos_before_voice.npy', sha256: 'f46edf4f7007b7ba4ea58831f49d003e59e167b4641c44bb3addfe9231a780b1', bytes: 4_224 },
  { file: 'tokenizer.model', sha256: 'd461765ae179566678c93091c5fa6f2984c31bbe990bf1aa62d92c64d91bc3f6', bytes: 59_339 },
  { file: 'flow_lm_main_int8.onnx', sha256: 'f9bd8106b79a0192c1c43399ab938fb24900a95c1c599870d75a884e99000116', bytes: 76_341_079 },
  { file: 'flow_lm_flow_int8.onnx', sha256: '3dd781ee5abee9e195320bf0106bebd6372a852b3b36352524ee78b40554635d', bytes: 9_962_530 },
  { file: 'mimi_decoder_int8.onnx', sha256: '3630450a3297a101792a6ac66619ebc70ab916b265e6220c2afaef8b1673f925', bytes: 22_684_077 },
  { file: 'mimi_encoder.onnx', sha256: '853e2ca623b8782d94c3745ec6133bfdff7ce33d9b11128bd29ea03f28d76e3d', bytes: 39_768_446 },
  { file: 'text_conditioner.onnx', sha256: '4ecee995fb69f85c7a7493d11f7b5ee15d9950facc7ab3f5c9c49ef1e03847bb', bytes: 16_388_344 },
]

/** What the whole bundle weighs, so a caller can warn before spending someone's data. */
export const MODEL_TOTAL_BYTES = MODEL_ARTIFACTS.reduce((n, a) => n + a.bytes, 0)

export const MANIFEST_FILE = '.orca-tts-model-manifest'
export const LICENSE_FILE = 'MODEL_LICENSE.txt'

export const LICENSE_TEXT = `Pocket TTS model files
======================

Model:       Pocket TTS, by Kyutai (https://huggingface.co/kyutai/pocket-tts)
ONNX export: ${MODEL_REPO} at ${MODEL_REVISION}, bundle ${BUNDLE_ID}
Licence:     CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/)

Reference voices are VCTK speakers from kyutai/tts-voices, ai-coustics-enhanced,
also CC-BY-4.0.

These files are downloaded unmodified and are not part of the orca-plugin-tts
distribution. Provided AS IS, without warranty of any kind.
`

/* ------------------------------------------------------------------------------- where it goes */

/**
 * The cache directory. `ORCA_TTS_MODEL_DIR` overrides it, which is what tests and the Voice Lab
 * use so that no test can ever write into the author's real model cache.
 */
export function modelDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ORCA_TTS_MODEL_DIR
  if (override !== undefined && override !== '') return override
  if (process.platform === 'win32') {
    const base = env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    return join(base, 'orca-tts', 'models', 'pocket-tts')
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'orca-tts', 'models', 'pocket-tts')
  }
  const base = env.XDG_CACHE_HOME ?? join(homedir(), '.cache')
  return join(base, 'orca-tts', 'models', 'pocket-tts')
}

/** Every file that must be present for the model to be usable. */
export function requiredFiles(): string[] {
  return [...MODEL_ARTIFACTS.map((a) => a.file), LICENSE_FILE, MANIFEST_FILE]
}

export type ModelStatus =
  | { readonly kind: 'ready', readonly dir: string }
  | { readonly kind: 'absent', readonly dir: string, readonly missing: readonly string[] }
  | { readonly kind: 'stale', readonly dir: string, readonly found: string, readonly want: string }

/**
 * Is the cache usable? Reports WHICH files are missing rather than a bare boolean, because
 * "the model is not ready" is not an actionable sentence and "mimi_encoder.onnx is missing" is.
 */
export async function modelStatus(dir = modelDir()): Promise<ModelStatus> {
  if (!existsSync(dir)) return { kind: 'absent', dir, missing: requiredFiles() }
  const present = new Set(await readdir(dir))
  const missing = requiredFiles().filter((f) => !present.has(f))
  if (missing.length > 0) return { kind: 'absent', dir, missing }
  const found = (await readFile(join(dir, MANIFEST_FILE), 'utf8')).trim()
  const want = String(MANIFEST_VERSION)
  if (found !== want) return { kind: 'stale', dir, found, want }
  return { kind: 'ready', dir }
}

/* --------------------------------------------------------------------------------- fetching */

export function urlFor(file: string): string {
  if (file === 'LICENSE') return `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/onnx/LICENSE`
  return `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/onnx/${BUNDLE_ID}/${file}`
}

export function sha256(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex')
}

export interface DownloadProgress {
  readonly file: string
  readonly received: number
  readonly total: number
  readonly fileIndex: number
  readonly fileCount: number
}

/**
 * Fetch the whole bundle into `dir`, atomically.
 *
 * Everything lands in a sibling temp directory first and the whole directory is swapped in at the
 * end. An interrupted download therefore leaves the previous model exactly as it was — the machine
 * whose network died halfway is the one that can least afford to lose the copy it had.
 */
export interface DownloadHooks {
  /** After every artifact is staged, before the live directory is touched. */
  readonly afterStage?: () => void | Promise<void>
  /** After the live directory has been moved aside, before staging is renamed into place. */
  readonly afterBackup?: () => void | Promise<void>
  /** After staging is live, before the backup is discarded. */
  readonly afterSwap?: () => void | Promise<void>
}

export interface DownloadOptions {
  dir?: string
  onProgress?: (p: DownloadProgress) => void
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  /**
   * The manifest to fetch. Defaults to the real one; a test overrides it with a handful of tiny
   * artifacts whose bytes actually hash to their declared digests, which is the ONLY way to reach
   * the success tail. Deriving a fixture from production hashes cannot: no fake body can satisfy
   * a 76 MB file's SHA-256, so every previous test died in the fetch loop and the swap was never
   * executed by anything (R14-06).
   */
  artifacts?: readonly ModelArtifact[]
  /** Failure-injection points. Tests only; production passes nothing. */
  hooks?: DownloadHooks
}

/**
 * Fetch the whole bundle into `dir`, preserving whatever was there if anything goes wrong.
 *
 * **The swap is the dangerous part and the first version of it was wrong.** It did
 * `rm(dir)` and then `rename(staging, dir)`, so a crash, a full disk or a cross-device rename in
 * between destroyed the only working model — on the machine of someone whose download had just
 * failed, which is the machine that can least afford it. Round 14 (R14-06) demonstrated it by
 * throwing in that window and watching 20/20 tests stay green: nothing reached the swap at all,
 * because no fake body can satisfy a real 76 MB digest.
 *
 * The order now is the one that survives a failure at every step:
 *
 *   1. stage BESIDE the live directory, not in `tmpdir()` — a rename across filesystems is
 *      `EXDEV`, and `tmpdir()` is a different filesystem often enough to matter;
 *   2. move the live directory aside to a backup (a rename, so it is instant and reversible);
 *   3. rename staging into place;
 *   4. and only then discard the backup.
 *
 * A failure at 2, 3 or 4 rolls the backup back. There is no instant at which the machine has no
 * usable model unless it had none to begin with.
 */
export async function downloadModel(options: DownloadOptions = {}): Promise<string> {
  const dir = options.dir ?? modelDir()
  const doFetch = options.fetchImpl ?? fetch
  const artifacts = options.artifacts ?? MODEL_ARTIFACTS
  const hooks = options.hooks ?? {}

  // Siblings, not `tmpdir()`: same filesystem, so the renames below cannot fail with EXDEV.
  const staging = `${dir}.staging-${process.pid}`
  const backup = `${dir}.previous-${process.pid}`

  await mkdir(dirname(dir), { recursive: true })
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })

  const pinned = new Map(artifacts.map((a) => [a.file, a]))
  const files = artifacts.map((a) => a.file)

  try {
    for (const [index, file] of files.entries()) {
      // `exactOptionalPropertyTypes` is on, so an explicit `undefined` is not the same as absent.
      const init: RequestInit = options.signal === undefined ? {} : { signal: options.signal }
      const res = await doFetch(urlFor(file), init)
      if (!res.ok) throw new Error(`downloading ${file}: HTTP ${res.status} ${res.statusText}`)
      const total = Number(res.headers.get('content-length') ?? 0)
      const body = Buffer.from(await res.arrayBuffer())
      options.onProgress?.({ file, received: body.length, total, fileIndex: index, fileCount: files.length })

      const want = pinned.get(file)
      if (want === undefined) throw new Error(`${file} is not in the pinned manifest`)
      // Both checks, not either. A length check alone passes for any file of the right size; a
      // digest alone gives a much worse message when a CDN hands back an HTML error page, which
      // is the common failure and the one a person has to act on.
      if (body.length !== want.bytes) {
        throw new Error(`${file} is ${body.length} bytes, expected ${want.bytes} — refusing it`)
      }
      const got = sha256(body)
      if (got !== want.sha256) {
        throw new Error(`${file} hashes to ${got}, expected ${want.sha256} — refusing it`)
      }
      await writeFile(join(staging, file), body)
    }

    // Attribution beside the bytes, as CC-BY-4.0 requires. R14-08: this is REQUIRED, not
    // best-effort — an install that silently omits the upstream licence is a licence violation
    // that nothing reports, so a failure to fetch it fails the download.
    const licenceInit: RequestInit = options.signal === undefined ? {} : { signal: options.signal }
    const licence = await doFetch(urlFor('LICENSE'), licenceInit)
    if (!licence.ok) {
      throw new Error(
        `the upstream LICENSE could not be fetched (HTTP ${licence.status} ${licence.statusText}). ` +
        'These models are CC-BY-4.0 and may not be installed without it.',
      )
    }
    await writeFile(join(staging, 'LICENSE'), Buffer.from(await licence.arrayBuffer()))
    await writeFile(join(staging, LICENSE_FILE), LICENSE_TEXT)

    // The manifest goes LAST. A directory holding every file but this one reads as `absent`,
    // which is exactly right for a download that died before it finished.
    await writeFile(join(staging, MANIFEST_FILE), `${MANIFEST_VERSION}\n`)
    await hooks.afterStage?.()
  } catch (err) {
    await rm(staging, { recursive: true, force: true })
    throw err
  }

  // ---- the swap. Everything below is reversible until the last line. ----
  const hadPrevious = existsSync(dir)
  await rm(backup, { recursive: true, force: true })
  try {
    if (hadPrevious) await rename(dir, backup)
    await hooks.afterBackup?.()
    await rename(staging, dir)
    await hooks.afterSwap?.()
  } catch (err) {
    // Put back exactly what was there. `force` on the staging cleanup because it may or may not
    // still exist depending on where this threw.
    await rm(dir, { recursive: true, force: true })
    if (hadPrevious && existsSync(backup)) await rename(backup, dir)
    await rm(staging, { recursive: true, force: true })
    throw err
  }
  await rm(backup, { recursive: true, force: true })
  return dir
}
