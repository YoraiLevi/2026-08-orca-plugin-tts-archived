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
import { readFile, writeFile, readdir, mkdir, rm, symlink } from 'node:fs/promises'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve as resolvePath, sep } from 'node:path'
// `.ts`, not `.js`, and the extension is load-bearing rather than a style choice. The Voice Lab
// imports this module under PLAIN NODE, whose resolver does not rewrite `.js` to `.ts` — vitest
// does, which is exactly how a suite goes green over a tree that cannot boot (P37, SC-14). The
// repo already sets `allowImportingTsExtensions`, and SC-14 proves this file still loads.
import { POCKET_VOICES, voiceUrl } from './voices.ts'

/* ------------------------------------------------------------------------------- the manifest */

/** The upstream ONNX export. */
export const MODEL_REPO = 'KevinAHM/pocket-tts-onnx'
/** Pinned revision. Never a branch name: a branch moves and the voice changes underneath us. */
export const MODEL_REVISION = '58a6d00cf13d239b6748cb0769f35c580a8f606c'
/** The language bundle. 6-layer English; the `*_24l` bundles are much larger and slower. */
export const BUNDLE_ID = 'english_2026-04'

/**
 * Bump when the artifact list or any hash changes; a mismatched on-disk manifest refetches.
 *
 * 1 -> 2: the twelve reference clips joined the required set (R14-02). A version-1 cache holds
 * weights and no voices, which is precisely the state that used to report ready and could not
 * speak, so it MUST be treated as stale rather than adopted.
 */
export const MANIFEST_VERSION = 2

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
/** Buzz's own marker. Presence means this directory belongs to another application (R061). */
export const BUZZ_MANIFEST_FILE = '.buzz-model-manifest'
export const LICENSE_FILE = 'MODEL_LICENSE.txt'
/**
 * The unmodified upstream CC-BY-4.0 text. Distinct from `LICENSE_FILE`, which is our local
 * attribution sidecar. R15-09 / PV-075: fetching this is not the same as requiring it for
 * `ready` — both must be true, and the file is pinned by digest AND length like every weight.
 *
 * Digest measured from Hugging Face at `MODEL_REVISION` (`onnx/LICENSE`) and re-checked against
 * the vendored copy at `model/LICENSE`.
 */
export const UPSTREAM_LICENSE_FILE = 'LICENSE'
export const UPSTREAM_LICENSE: ModelArtifact = {
  file: UPSTREAM_LICENSE_FILE,
  sha256: 'fe7b4ce83b8381cc5b216bbb4af73c570688d1b819c73bbaed8ca401f4677cd6',
  bytes: 18_655,
}

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
 *
 * This is the ONE lookup path (R17-07). It does not fall back to `~/.buzz`. To reuse weights
 * that already live there, run `node scripts/stage-pocket-model.mjs` — that command reads buzz
 * and writes OUR marker into a directory we own.
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

/**
 * The twelve reference clips, as manifest entries.
 *
 * R14-02: these were NOT in the manifest, so `modelStatus()` could say **ready** while not one
 * Pocket voice had a conditioning clip to load — and a mutant renaming Eve's file to
 * `does-not-exist.wav` left 20/20 tests green. `ready` has to mean "the voices work", because that
 * is what every caller uses it for.
 *
 * They come from a DIFFERENT repository than the weights (`kyutai/tts-voices`, also CC-BY-4.0), at
 * its own pinned revision, and are pinned by digest and length like everything else. All twelve
 * digests were verified against the bytes on this machine before being written down.
 */
export const VOICE_ARTIFACTS: readonly ModelArtifact[] = POCKET_VOICES.map((v) => ({
  file: v.file, sha256: v.sha256, bytes: v.bytes,
}))

/** What the reference clips weigh — 8.5 MB, small beside the weights but not nothing. */
export const VOICES_TOTAL_BYTES = VOICE_ARTIFACTS.reduce((n, a) => n + a.bytes, 0)

/** Every artifact whose exact length the manifest pins, so `ready` can mean "the bytes are here". */
const PINNED_BYTES: ReadonlyMap<string, number> = new Map(
  [...MODEL_ARTIFACTS, ...VOICE_ARTIFACTS].map((a) => [a.file, a.bytes] as const),
)

/**
 * What a complete install weighs, which is what a person must be told before it is spent.
 *
 * The UI previously advertised the model total alone. R14-02: that is not the install the feature
 * needs, and understating someone's download is its own small dishonesty.
 */
export const INSTALL_TOTAL_BYTES = MODEL_TOTAL_BYTES + VOICES_TOTAL_BYTES

/** Every file that must be present for the model to be usable — weights, voices, AND both licence sidecars. */
export function requiredFiles(): string[] {
  return [
    ...MODEL_ARTIFACTS.map((a) => a.file),
    ...VOICE_ARTIFACTS.map((a) => a.file),
    UPSTREAM_LICENSE_FILE,
    LICENSE_FILE,
    MANIFEST_FILE,
  ]
}

export type ModelStatus =
  | { readonly kind: 'ready', readonly dir: string }
  | { readonly kind: 'absent', readonly dir: string, readonly missing: readonly string[] }
  | {
      readonly kind: 'incomplete'
      readonly dir: string
      readonly missing: readonly string[]
      readonly present: number
      readonly required: number
      readonly detail: string
    }
  | { readonly kind: 'stale', readonly dir: string, readonly found: string, readonly want: string }

function incompleteDetail(missing: readonly string[], present: number, required: number): string {
  if (missing.length === 1 && missing[0] === MANIFEST_FILE) {
    return `this directory has every required file except ${MANIFEST_FILE}`
  }
  return `this directory has ${present} of ${required} required files; missing ${missing.join(', ')}`
}

/**
 * The sentence a person can act on. R17-07: `kind` alone is not that sentence — `absent` used
 * to cover both "nothing is here" and "everything is here except our marker".
 */
export function modelStatusDetail(status: ModelStatus): string {
  if (status.kind === 'ready') return `Pocket TTS is ready in ${status.dir}`
  if (status.kind === 'absent') {
    return `Pocket TTS is not installed in ${status.dir}`
  }
  if (status.kind === 'incomplete') return `${status.detail} (${status.dir})`
  return `Pocket TTS model is stale in ${status.dir}; found manifest ${status.found}, expected ${status.want}`
}

/**
 * Is the cache usable? Reports WHICH files are missing rather than a bare boolean, because
 * "the model is not ready" is not an actionable sentence and "mimi_encoder.onnx is missing" is.
 *
 * R17-07: a directory that exists and holds some of the required files is `incomplete`, not
 * `absent`. `absent` is reserved for "nothing is here" (the directory does not exist, or none
 * of the required files are in it). The author's `~/.buzz/models/pocket-tts` is the motivating
 * case: every payload file present, only `.orca-tts-model-manifest` missing — that is one
 * marker away from ready, and calling it `absent` made the Lab offer a 173.8 MB download.
 *
 * R15-02: a crash between `rename(live, backup)` and `rename(staging, live)` leaves the known-good
 * copy under a sibling name. Recover that before answering, otherwise `ready` is a property of
 * whether this process's pid matches the one that died, which is not a property of the cache.
 */
export async function modelStatus(dir = modelDir()): Promise<ModelStatus> {
  await recoverLiveFromBackup(dir)
  const required = requiredFiles()
  if (!existsSync(dir)) return { kind: 'absent', dir, missing: required }
  // R18-04: `readdir` returns NAMES. A symlink whose target was deleted still has a name, so a
  // staged cache reported `ready` while not one byte was reachable — the author's exact path, since
  // `stage-pocket-model` symlinks buzz's weights and buzz may clean its cache afterwards.
  // `existsSync` FOLLOWS the link, so it answers the question the caller is really asking:
  // can this file be read? A dangling link is missing, and says so by name.
  // R19-03: `ready` used to mean every required NAME resolved to something that exists. It never
  // looked at the size, so a ONE-BYTE `mimi_encoder.onnx` — against a 39,768,446-byte pin — was
  // `ready`. A download killed midway or a disk that filled would announce a working neural voice
  // and then fail to speak. The manifest already knows how big each artifact is; consult it.
  // (The sha256 is verified at DOWNLOAD time; hashing 165 MB on every status call would make this
  // predicate too slow to be the one everything asks, and length already catches truncation.)
  const names = new Set(await readdir(dir))
  const missing = required.filter((f) => {
    if (!names.has(f)) return true
    const path = join(dir, f)
    if (!existsSync(path)) return true          // R18-04: a dangling symlink still has a name
    const want = PINNED_BYTES.get(f)
    if (want === undefined) return false        // licences and the marker carry no pinned length
    try { return statSync(path).size !== want } catch { return true }
  })
  const present = required.length - missing.length
  if (missing.length > 0) {
    if (present === 0) return { kind: 'absent', dir, missing }
    return {
      kind: 'incomplete',
      dir,
      missing,
      present,
      required: required.length,
      detail: incompleteDetail(missing, present, required.length),
    }
  }
  const found = (await readFile(join(dir, MANIFEST_FILE), 'utf8')).trim()
  const want = String(MANIFEST_VERSION)
  if (found !== want) return { kind: 'stale', dir, found, want }
  return { kind: 'ready', dir }
}

/**
 * True when `dir` is another application's cache. We may READ it (the stage command does);
 * we must never WRITE it (R061, PV-NFR-004). Two independent signals, either is enough:
 * the path is under `~/.buzz`, or the directory already holds `.buzz-model-manifest`.
 */
/**
 * Where a write to `p` would ACTUALLY land, following symlinks as far as the filesystem can.
 *
 * R18-05: the old code only called `realpathSync` when the directory already existed. A directory
 * that does NOT exist yet is exactly what a staging command passes, so a dest whose PARENT was a
 * symlink into `~/.buzz` resolved to its own literal string, matched no prefix, and was declared
 * safe — after which the write created it inside another application's directory. R061 was being
 * enforced against a string rather than against the place the bytes would go.
 *
 * So walk up to the nearest ancestor that DOES exist, resolve that, and re-attach the rest.
 */
function realWriteLocation(p: string): string {
  const absolute = resolvePath(p)
  const trailing: string[] = []
  let cursor = absolute
  for (;;) {
    if (existsSync(cursor)) {
      try {
        return trailing.length === 0
          ? realpathSync(cursor)
          : join(realpathSync(cursor), ...trailing.reverse())
      } catch {
        return absolute
      }
    }
    const parent = dirname(cursor)
    if (parent === cursor) return absolute
    trailing.push(basename(cursor))
    cursor = parent
  }
}

/**
 * Is `candidate` the same directory as `root`, or inside it — as the FILESYSTEM sees it?
 *
 * R19-02: the previous version resolved symlinks and then compared STRINGS. On an APFS volume
 * `~/.buzz` and `~/.BUZZ` are the same directory — inode 9541114 — and a string comparison says
 * they are not. `stageModelFrom` into `~/.BUZZ/staged` reported `foreign: false`, threw nothing,
 * and wrote 22 files into buzz's directory.
 *
 * Device plus inode is what "the same directory" MEANS. It is immune to case folding, to symlinks,
 * to `..`, to hardlinked directories, and to every other spelling the filesystem treats as one
 * place — including the ones nobody has thought of yet, which is the point, because the last two
 * repairs each fixed the spelling I had just been shown.
 */
function isInsideByIdentity(candidate: string, root: string): boolean {
  let rootStat
  try { rootStat = statSync(root) } catch { return false }
  let cursor = resolvePath(candidate)
  for (;;) {
    try {
      const here = statSync(cursor)
      if (here.dev === rootStat.dev && here.ino === rootStat.ino) return true
    } catch {
      // Does not exist yet — a staging destination usually does not. Keep walking up: the
      // question is where the write LANDS, and that is decided by the nearest real ancestor.
    }
    const parent = dirname(cursor)
    if (parent === cursor) return false
    cursor = parent
  }
}

export function isForeignModelCache(dir: string, home = homedir()): boolean {
  const buzzRoot = resolvePath(join(home, '.buzz'))
  const under = (candidate: string, root: string): boolean =>
    candidate === root || candidate.startsWith(root + sep)

  // Spelling first: cheap, and the only thing available when nothing on the path exists.
  if (under(resolvePath(dir), buzzRoot)) return true
  try {
    const realBuzz = existsSync(buzzRoot) ? realpathSync(buzzRoot) : buzzRoot
    if (under(realWriteLocation(dir), realBuzz)) return true
  } catch { /* unresolvable is not evidence of safety; the checks either side still run */ }

  // Then identity, which is what actually decides where the bytes go.
  if (isInsideByIdentity(dir, buzzRoot)) return true

  // Last resort: it is buzz's if it carries buzz's own marker, wherever it lives.
  if (existsSync(join(dir, BUZZ_MANIFEST_FILE))) return true
  return false
}

export class ForeignModelCacheError extends Error {
  readonly dir: string

  constructor(dir: string) {
    super(
      `refusing to write into ${dir} — that directory belongs to another application (buzz). ` +
      'Stage a copy into a directory we own: node scripts/stage-pocket-model.mjs',
    )
    this.name = 'ForeignModelCacheError'
    this.dir = dir
  }
}

export function assertModelDirWritable(dir: string): void {
  if (isForeignModelCache(dir)) throw new ForeignModelCacheError(dir)
}

/**
 * Copy a Pocket TTS cache we do not own (typically `~/.buzz/models/pocket-tts`) into a
 * directory we do, as symlinks plus OUR marker. Never writes into `source`. Never writes
 * into a foreign dest.
 *
 * This is the author's reuse path: he already has the weights; he should not re-download
 * 173.8 MB. The product still does not look in `~/.buzz` on its own (R17-07 option A).
 */
export async function stageModelFrom(
  source: string,
  dest: string,
): Promise<{ readonly source: string, readonly dest: string, readonly files: number }> {
  assertModelDirWritable(dest)
  if (!existsSync(source)) {
    throw new Error(`no Pocket TTS files at ${source}`)
  }
  const sourceStatus = await modelStatus(source)
  const payloadMissing = sourceStatus.kind === 'ready' || sourceStatus.kind === 'stale'
    ? []
    : sourceStatus.missing.filter((f) => f !== MANIFEST_FILE)
  if (sourceStatus.kind === 'absent') {
    throw new Error(`nothing to stage from ${source}: Pocket TTS is not installed there`)
  }
  if (payloadMissing.length > 0) {
    throw new Error(`cannot stage from ${source}: still missing ${payloadMissing.join(', ')}`)
  }

  const srcResolved = resolvePath(source)
  const destResolved = resolvePath(dest)
  await mkdir(destResolved, { recursive: true })

  const names = await readdir(source)
  let linked = 0
  for (const name of names) {
    if (name === MANIFEST_FILE || name === BUZZ_MANIFEST_FILE) continue
    const from = join(srcResolved, name)
    const to = join(destResolved, name)
    if (from === to) continue
    if (existsSync(to)) await rm(to)
    await symlink(from, to)
    linked++
  }
  await writeFile(join(destResolved, MANIFEST_FILE), `${MANIFEST_VERSION}\n`)

  const after = await modelStatus(destResolved)
  if (after.kind !== 'ready') {
    throw new Error(
      `staged ${destResolved} from ${srcResolved} but modelStatus is ${modelStatusDetail(after)}`,
    )
  }
  return { source: srcResolved, dest: destResolved, files: linked }
}

/* --------------------------------------------------------------- crash-safe swap + single writer */

/**
 * Second writer is refused BY NAME, not by racing a pid-suffixed scratch path and hoping.
 * R15-02: two Voice Labs both acquired the supposed in-process slot because there was no
 * filesystem-visible lock scoped to the cache.
 */
/**
 * The swap machinery moved to `./safe-swap.ts` (R16-03).
 *
 * It was fixed here for R14-06, hardened here for R15-02, and then found MISSING ENTIRELY in
 * `runtime.ts` — a cache written after both fixes. Fixing one call site three times is how a
 * defect becomes a habit, so the answer is shared and neither cache can drift from it.
 */
export {
  DownloadInProgressError as ModelDownloadInProgressError,
} from './safe-swap.ts'
import {
  recoverLiveFromBackup, swapLiveDirectory, type SwapHooks,
} from './safe-swap.ts'

export function urlFor(file: string): string {
  if (file === 'LICENSE') return `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/onnx/LICENSE`
  // A reference clip lives in the voices repo, under its upstream name, at its own revision.
  const voice = POCKET_VOICES.find((v) => v.file === file)
  if (voice !== undefined) return voiceUrl(voice.upstream)
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
export type DownloadHooks = SwapHooks

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
 * **The swap is the dangerous part and the first two versions of it were each half-right.**
 * Version 1 did `rm(dir)` then `rename(staging, dir)` — a throw in that window destroyed the
 * only working model, and nothing reached the swap because no fake body can satisfy a 76 MB
 * digest (R14-06). Version 2 staged beside live and caught JavaScript exceptions around the two
 * renames, which is what the exception-path tests still prove. A `catch` does not run after
 * SIGKILL. Staging and backup were named with `process.pid`, which is a per-process name and
 * not a lock: a later process never scanned the orphan, and two writers both acquired the slot.
 *
 * The order now is the one that survives a failure AND a hard signal:
 *
 *   1. take a filesystem-visible exclusive lock on the cache, or refuse the second writer
 *      by name (`ModelDownloadInProgressError`);
 *   2. recover `backup → live` if live is missing — including leftover `*.previous-<pid>`
 *      names from version 2 — BEFORE deleting any backup;
 *   3. stage BESIDE the live directory under a unique name, not in `tmpdir()` (`EXDEV`);
 *   4. move live aside to a STABLE backup name (`*.previous`), journal the phase, rename
 *      staging into place, and only then discard the backup.
 *
 * A `catch` still rolls the backup back for exceptions. A later process recovers the same
 * backup after a hard signal. There is no instant at which the machine has no recoverable
 * model unless it had none to begin with.
 */
export async function downloadModel(options: DownloadOptions = {}): Promise<string> {
  const dir = options.dir ?? modelDir()
  // R17-07 / R061: ORCA_TTS_MODEL_DIR is an opt-in path, not a licence to write into buzz.
  assertModelDirWritable(dir)
  const doFetch = options.fetchImpl ?? fetch
  // Weights AND voices. Fetching one without the other produces a directory that reports ready
  // and cannot speak (R14-02).
  const artifacts = options.artifacts ?? [...MODEL_ARTIFACTS, ...VOICE_ARTIFACTS]
  const hooks = options.hooks ?? {}

  // The two-rename sequence lives in `swapLiveDirectory`. Inlining it here is how this
  // defect was fixed three times in two places (R14-06, R15-02, R16-03) and then found
  // a fourth (R17-03 / R17-05).
  return swapLiveDirectory(dir, async (staging) => {
    const pinned = new Map(artifacts.map((a) => [a.file, a]))
    const files = artifacts.map((a) => a.file)

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

    // Attribution beside the bytes, as CC-BY-4.0 requires. R14-08: fetching is REQUIRED.
    // R15-09: the bytes are also pinned — a 200 that is not the licence is still a violation.
    const licenceInit: RequestInit = options.signal === undefined ? {} : { signal: options.signal }
    const licence = await doFetch(urlFor('LICENSE'), licenceInit)
    if (!licence.ok) {
      throw new Error(
        `the upstream LICENSE could not be fetched (HTTP ${licence.status} ${licence.statusText}). ` +
        'These models are CC-BY-4.0 and may not be installed without it.',
      )
    }
    const licenceBody = Buffer.from(await licence.arrayBuffer())
    if (licenceBody.length !== UPSTREAM_LICENSE.bytes) {
      throw new Error(
        `LICENSE is ${licenceBody.length} bytes, expected ${UPSTREAM_LICENSE.bytes} — refusing it`,
      )
    }
    const licenceHash = sha256(licenceBody)
    if (licenceHash !== UPSTREAM_LICENSE.sha256) {
      throw new Error(
        `LICENSE hashes to ${licenceHash}, expected ${UPSTREAM_LICENSE.sha256} — refusing it`,
      )
    }
    await writeFile(join(staging, UPSTREAM_LICENSE_FILE), licenceBody)
    await writeFile(join(staging, LICENSE_FILE), LICENSE_TEXT)

    // The manifest goes LAST. A directory holding every file but this one reads as `absent`,
    // which is exactly right for a download that died before it finished.
    await writeFile(join(staging, MANIFEST_FILE), `${MANIFEST_VERSION}\n`)
  }, hooks)
}
