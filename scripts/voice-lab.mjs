#!/usr/bin/env node
/**
 * Voice Lab server — M11 / T111 (`docs/design/004-voice-lab.md`, section 2 is the contract).
 *
 * The instrument PITFALLS P23 exists for: change a control, HEAR the difference in under two
 * seconds, without touching ORCA. It serves the page, the fixtures and the settings inbox, and it
 * runs `normalize -> Chunker -> provider.generate()` on demand.
 *
 * THREE THINGS THIS FILE IS NOT ALLOWED TO DO, each with the entry that says so:
 *
 * 1. **It never spawns a player.** No `afplay`, no `ffplay`, no `aplay`, no `say` for playback.
 *    004 section 2: the BROWSER plays. Server-side replay re-pays 414 ms of spawn (P10) plus a
 *    p50 1,054-1,163 ms `generate()` (`docs/.research/latency-measurements.md` 1.3) and one
 *    ~950 ms audio-device open per chunk (P32) on every press — it cannot meet the two-second gate
 *    at all. The one exception is the `spoke-elsewhere` rung, where speech-dispatcher owns
 *    playback by design (P25) — and even there it is behind an explicit `allowElsewhere` flag,
 *    never a default, because P31 was written when a benchmark surprised the author with sound.
 *    **Starting this server makes no sound.**
 *
 * 2. **It never imports `packages/*\/dist/`.** PITFALLS P17's neighbourhood: a committed, stale
 *    `dist/` and a plain `.mjs` server importing the built JS would have the listener tune a
 *    normalizer that is not the one that ships. Same input, two module paths, different speech.
 *    We import the TypeScript source, and `assertSourceModule()` + `assertLoadedModuleIsOnDiskSource()`
 *    below make that a CHECK rather than a comment — see "The source-not-dist guard".
 *
 * 3. **It never binds anything but 127.0.0.1.** This serves the author's own machine.
 */

import { createServer } from 'node:http'
import { readFile, writeFile, rename, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, resolve, extname } from 'node:path'
import { homedir } from 'node:os'

/* ================================================================= source imports
 * Relative `.ts` specifiers, run through Node's own type stripping. The workspace alias
 * `@orca-tts/core` resolves through a node_modules symlink to the same files, but a relative
 * path is the one specifier that cannot be redirected by a package manifest, an export map or a
 * build step — so it is what this file uses.
 */
export const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

const NORMALIZER_SRC = join(REPO_ROOT, 'packages/core/src/normalizer/index.ts')
const CHUNKER_SRC = join(REPO_ROOT, 'packages/core/src/chunker/index.ts')
const PROVIDER_SRC = join(REPO_ROOT, 'packages/providers/src/os-synth/index.ts')

const { normalize } = await import(pathToFileURL(NORMALIZER_SRC).href)
const { Chunker } = await import(pathToFileURL(CHUNKER_SRC).href)
const { OsSynthProvider, LINUX_WAV_BACKENDS, LINUX_INSTALL_HINT } =
  await import(pathToFileURL(PROVIDER_SRC).href)

/* ================================================================= the source-not-dist guard
 *
 * A comment saying "we import source" is not a check. Two of them, and both can fail:
 *
 *   assertSourceModule(url)              — structural. Rejects anything under a `dist/` directory
 *                                          or not ending in `.ts` under `packages/<pkg>/src/`.
 *                                          Its negative half is a test that hands it a dist URL.
 *   assertLoadedModuleIsOnDiskSource()   — BY EFFECT. The stage ladder below is compiled from the
 *                                          BYTES ON DISK at packages/core/src/normalizer/index.ts;
 *                                          `spoken` comes from the module we IMPORTED. If the two
 *                                          are ever different code — a stale dist, an export map
 *                                          pointing elsewhere, a drifted stage list — they produce
 *                                          different text for the six committed fixtures and the
 *                                          server refuses to start, loudly, naming the fixture.
 *                                          Delete a stage from the ladder and it goes red.
 */
export function assertSourceModule (moduleUrl, label = 'module') {
  const path = moduleUrl.startsWith('file:') ? fileURLToPath(moduleUrl) : moduleUrl
  const unix = path.replaceAll('\\', '/')
  if (/\/dist\//.test(unix)) {
    throw new Error(
      `${label} resolved to a BUILT artifact (${path}). The Voice Lab must tune the normalizer ` +
      'that ships, not a stale build of it (PITFALLS P17). Import packages/*/src/**.ts.'
    )
  }
  if (!/\/packages\/[^/]+\/src\/.+\.ts$/.test(unix)) {
    throw new Error(
      `${label} resolved to ${path}, which is not TypeScript source under packages/<pkg>/src/.`
    )
  }
  return path
}

/* ================================================================= the 15 stages
 *
 * `normalize()` composes 15 transforms (`packages/core/src/normalizer/index.ts:96-109`). 004
 * section 4 corrects three documents that disagreed; the count below was taken from the source,
 * and `assertLoadedModuleIsOnDiskSource()` keeps it that way.
 *
 * The stage functions are module-private, so they are not re-implemented here — the file's own
 * bytes are type-stripped and re-exported through a data: URL, which means every row of the
 * ladder is produced by the SAME function body `normalize()` calls. What this file owns is only
 * the ORDER and the conditionals, and the equality check catches any drift in those.
 *
 * `controlIds` is 004 section 6's "Feeds" column. An empty list is a stage no control governs —
 * 004 section 4: 'spans from unconfigurable stages say so ("fixed by design")'.
 */
export const STAGES = [
  { n: 1, name: 'stripFencedCode', controlIds: ['omit.codeBlocks', 'omit.codeBlockPhrase', 'omit.codeBlockDetail'] },
  { n: 2, name: 'stripInlineCode', controlIds: ['omit.inlineCode', 'ident.style', 'ident.parens'] },
  { n: 3, name: 'expandMarkdownLinks', controlIds: [] },
  { n: 4, name: 'stripUrls', controlIds: ['omit.urls', 'omit.urlPhrase'] },
  { n: 5, name: 'headingsToPauses', controlIds: ['struct.headingCue', 'struct.headingPauseMs'] },
  { n: 6, name: 'listItemsToSentences', controlIds: ['struct.orderedLists', 'struct.bulletMarker'] },
  { n: 7, name: 'tablesToRows', controlIds: ['struct.tableLeadIn', 'struct.tableHeaderRepeat', 'struct.tableFirstCellHeader'] },
  { n: 8, name: 'speakFilePaths', controlIds: ['path.style', 'path.extensionStyle', 'path.namePhrase', 'path.folderPhrase', 'path.depthPolicy', 'path.depthN', 'path.extensionWords'] },
  { n: 9, name: 'stripMarkdownMarkers', controlIds: ['ident.style', 'ident.parens'] },
  { n: 10, name: 'speakKeyGlyphs', controlIds: [] },
  { n: 11, name: 'stripEmoji', controlIds: ['omit.emoji'] },
  { n: 12, name: 'expandUnits', controlIds: ['num.expandUnits', 'num.unitWords'] },
  { n: 13, name: 'expandNumbers', controlIds: ['num.expandIntegers', 'num.decimals'] },
  { n: 14, name: 'collapseWhitespace', controlIds: [] },
  { n: 15, name: 'tidyPunctuation', controlIds: [] }
]

const STAGE_EXPORT = `
export const STAGE_FNS = { ${STAGES.map((s) => s.name).join(', ')} }
`

let stageFnsPromise = null
/** Compile the on-disk normalizer source into a module that also exports its private stages. */
export async function stageFns () {
  if (stageFnsPromise === null) {
    stageFnsPromise = (async () => {
      const ts = await readFile(NORMALIZER_SRC, 'utf8')
      const js = stripTypeScriptTypes(ts, { mode: 'strip' })
      const url = 'data:text/javascript;base64,' +
        Buffer.from(js + STAGE_EXPORT, 'utf8').toString('base64')
      const mod = await import(url)
      return mod.STAGE_FNS
    })()
  }
  return stageFnsPromise
}

/**
 * Run the 15 transforms incrementally and record what each one produced.
 *
 * A stage the options switch off is still a row — it reports `applied: false` and unchanged text,
 * because a ladder that silently shortens is a ladder whose numbers stop meaning anything.
 */
export async function computeStages (md, opts = {}) {
  const fn = await stageFns()
  const codeBlocks = opts.codeBlocks ?? 'announce'
  const pathStyle = opts.pathStyle ?? 'spoken'
  const extensionStyle = opts.extensionStyle ?? 'word-last'
  const orderedLists = opts.orderedLists ?? 'numeral'
  const doNumbers = opts.expandNumbers ?? true

  // The ONE piece of duplicated knowledge in this file: the call order of `normalize()`.
  // `assertLoadedModuleIsOnDiskSource()` is what stops it from drifting silently.
  const apply = [
    (s) => fn.stripFencedCode(s, codeBlocks),
    (s) => fn.stripInlineCode(s),
    (s) => fn.expandMarkdownLinks(s),
    (s) => fn.stripUrls(s),
    (s) => fn.headingsToPauses(s),
    (s) => fn.listItemsToSentences(s, orderedLists),
    (s) => fn.tablesToRows(s),
    pathStyle === 'verbatim' ? null : (s) => fn.speakFilePaths(s, pathStyle, extensionStyle),
    (s) => fn.stripMarkdownMarkers(s),
    (s) => fn.speakKeyGlyphs(s),
    (s) => fn.stripEmoji(s),
    doNumbers ? (s) => fn.expandUnits(s) : null,
    doNumbers ? (s) => fn.expandNumbers(s) : null,
    (s) => fn.collapseWhitespace(s),
    (s) => fn.tidyPunctuation(s)
  ]

  let text = md
  const stages = []
  for (let i = 0; i < STAGES.length; i++) {
    const step = apply[i]
    const before = text
    if (step !== null) text = step(text)
    stages.push({
      ...STAGES[i],
      applied: step !== null,
      changed: text !== before,
      text
    })
  }
  // `normalize()`'s own tail: "." or "," alone would be spoken as "period" / "comma".
  const ladderSpoken = text.length <= 1 ? '' : text
  return { spoken: normalize(md, opts), ladderSpoken, stages }
}

/**
 * Verify by effect that the module we IMPORTED and the source on DISK are the same code.
 *
 * Runs the six committed fixtures through both paths and demands byte equality. This is the
 * check that would have caught the trap: point the import at `packages/core/dist/` and any drift
 * between the build and the source shows up here as a named, refused start.
 */
export async function assertLoadedModuleIsOnDiskSource (fixtureDir = join(REPO_ROOT, 'fixtures')) {
  assertSourceModule(pathToFileURL(NORMALIZER_SRC).href, 'normalizer')
  assertSourceModule(pathToFileURL(CHUNKER_SRC).href, 'chunker')
  assertSourceModule(pathToFileURL(PROVIDER_SRC).href, 'os-synth provider')

  const names = existsSync(fixtureDir)
    ? (await readdir(fixtureDir)).filter((f) => f.endsWith('.md')).toSorted()
    : []
  const probes = [['(inline probe)', '# Heading\n\n1. `x` at packages/core/src/normalizer/index.ts, 52 ms\n']]
  for (const name of names) probes.push([name, await readFile(join(fixtureDir, name), 'utf8')])
  if (probes.length < 2) {
    throw new Error(`no fixtures found under ${fixtureDir}; the source-vs-import check has nothing to run`)
  }

  for (const [name, text] of probes) {
    const { spoken, ladderSpoken } = await computeStages(text)
    if (spoken !== ladderSpoken) {
      throw new Error(
        `SOURCE/IMPORT MISMATCH on fixture ${name}. The 15-stage ladder (compiled from ` +
        `${NORMALIZER_SRC}) and the imported normalize() disagree. Either the import is resolving ` +
        'to a BUILT copy (PITFALLS P17) or the stage list in scripts/voice-lab.mjs has drifted ' +
        'from normalize(). Refusing to start: the listener would be tuning a normalizer that is ' +
        'not the one that ships.'
      )
    }
  }
  return { fixtures: probes.length, source: NORMALIZER_SRC }
}

/* ================================================================= the three provider outcomes
 *
 * 004 section 2: "there are THREE provider outcomes, not two".
 */
export const SPOKE_ELSEWHERE_DISABLED = ['compare', 'replay', 'stage-play', 'timing']

/**
 * normalize -> chunk -> synthesize, returning base64 WAV chunks. No player, ever.
 *
 * @param provider  anything with `prepare()`, `generate()`, `linuxBackend`. Injected so the
 *                  spoke-elsewhere branch is testable without a Linux desktop.
 * @param allowElsewhere  opt-in. On the `spd-say` rung `generate()` makes the DAEMON speak; that
 *                  is the one sanctioned exception (P25) and it is never the default (P31).
 */
export async function speak (provider, text, opts = {}, { allowElsewhere = false, signal } = {}) {
  const t0 = performance.now()
  const spoken = normalize(text, opts.normalize ?? {})
  const tNorm = performance.now()

  const chunker = new Chunker(opts.chunk ?? {})
  const chunks = [...chunker.addText(spoken), ...chunker.finish()]
  const tChunk = performance.now()

  try {
    await provider.prepare()
  } catch (err) {
    return providerError(err)
  }

  const backend = provider.linuxBackend ?? null
  const elsewhere = backend !== null && !LINUX_WAV_BACKENDS.includes(backend)

  if (elsewhere && !allowElsewhere) {
    // Named outcome, returned BEFORE synthesizing (004 section 2). Nothing is spoken: making the
    // daemon talk is an explicit act, not something a page load does.
    return {
      status: 200,
      body: {
        played: 'elsewhere',
        backend,
        spoken,
        chunks: [],
        disabled: SPOKE_ELSEWHERE_DISABLED,
        reason:
          `This machine's speech service (${backend}) plays the audio itself, so the lab never ` +
          'receives any bytes. It cannot replay, compare or scrub what you just heard.',
        installHint: LINUX_INSTALL_HINT,
        announcement:
          `This machine's speech service played that. The lab cannot replay, compare or scrub ` +
          `it. ${LINUX_INSTALL_HINT}`,
        timings: { normalizeMs: tNorm - t0, chunkMs: tChunk - tNorm, synthMs: 0, totalMs: performance.now() - t0 }
      }
    }
  }

  const out = []
  const tSynth0 = performance.now()
  try {
    for (const chunk of chunks) {
      if (signal?.aborted === true) break
      for await (const audio of provider.generate(chunk.text, { ...opts.synthesize, signal })) {
        out.push({
          i: out.length,
          text: chunk.text,
          boundary: chunk.boundary,
          isFirst: chunk.isFirst,
          format: audio.format,          // 004 section 2: branch on format, never assume WAV.
          sampleRate: audio.sampleRate,
          channels: audio.channels,
          bytes: audio.data.byteLength,
          base64: Buffer.from(audio.data).toString('base64')
        })
      }
    }
  } catch (err) {
    return providerError(err)
  }
  const tSynth = performance.now()

  return {
    status: 200,
    body: {
      played: elsewhere ? 'elsewhere-forced' : 'browser',
      backend,
      spoken,
      chunkCount: chunks.length,
      chunks: out,
      timings: {
        normalizeMs: tNorm - t0,
        chunkMs: tChunk - tNorm,
        synthMs: tSynth - tSynth0,
        totalMs: performance.now() - t0
      }
    }
  }
}

/**
 * 503, with the PROVIDER'S OWN words. On a stock Ubuntu desktop with no synthesizer this is the
 * expected path, and `LinuxSpeechUnavailableError`'s message already carries the install remedy
 * (`os-synth/index.ts:148,157-165`). A generic "synthesis failed" here would be P18 exactly.
 */
export function providerError (err) {
  const message = err instanceof Error ? err.message : String(err)
  return {
    status: 503,
    body: {
      played: 'nothing',
      error: 'provider_error',
      name: err?.constructor?.name ?? 'Error',
      message,
      installHint: message.includes(LINUX_INSTALL_HINT) ? null : LINUX_INSTALL_HINT
    }
  }
}

/* ================================================================= the settings inbox
 * `docs/design/011-settings.md` sections 1.2 and 2. Our namespace, never ORCA's.
 */
export function settingsPathFor (platform = process.platform, env = process.env) {
  const override = env.ORCA_TTS_CONFIG_DIR
  if (typeof override === 'string' && override.length > 0) return join(override, 'settings.jsonc')
  const home = env.HOME ?? env.USERPROFILE ?? homedir()
  if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'orca-tts', 'settings.jsonc')
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'orca-tts', 'settings.jsonc')
  return join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'orca-tts', 'settings.jsonc')
}

/**
 * JSONC, because a listener hand-edits this file and 011 says the worker never strips a comment.
 * String-aware, so a `//` inside a phrase template survives.
 */
export function stripJsonComments (src) {
  let out = ''
  let i = 0
  let inStr = false
  while (i < src.length) {
    const c = src[i]
    if (inStr) {
      out += c
      if (c === '\\') { out += src[i + 1] ?? ''; i += 2; continue }
      if (c === '"') inStr = false
      i++
      continue
    }
    if (c === '"') { inStr = true; out += c; i++; continue }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue }
    out += c
    i++
  }
  return out
}

export async function readSettings (path = settingsPathFor()) {
  if (!existsSync(path)) return { path, exists: false, file: null, revision: 0, parseError: null }
  const raw = await readFile(path, 'utf8')
  try {
    const file = JSON.parse(stripJsonComments(raw))
    const revision = Number.isInteger(file?.revision) && file.revision >= 0 ? file.revision : 0
    return { path, exists: true, file, revision, parseError: null }
  } catch (err) {
    // Unreadable is not the same as absent, and it must never look like revision 0 — that would
    // let a stale write win over a file we simply could not parse.
    return { path, exists: true, file: null, revision: null, parseError: String(err.message ?? err), raw }
  }
}

/**
 * 011 section 2.2: a write whose `revision` is not GREATER than the one already promoted is
 * refused with the named code `stale_revision`. Equal is refused too — that is a duplicate
 * promotion, not a newer one.
 */
export function checkRevision (currentRevision, incomingRevision) {
  if (!Number.isInteger(incomingRevision) || incomingRevision < 0) {
    return { ok: false, code: 'bad_revision', why: 'revision must be a non-negative integer' }
  }
  if (currentRevision === null) {
    return { ok: false, code: 'unreadable_current', why: 'the inbox exists but could not be parsed; refusing to overwrite a file we cannot read' }
  }
  if (incomingRevision <= currentRevision) {
    return { ok: false, code: 'stale_revision', why: `revision ${incomingRevision} is not greater than the promoted revision ${currentRevision}`, currentRevision }
  }
  return { ok: true, currentRevision }
}

export async function writeSettings (file, path = settingsPathFor()) {
  // Re-read before every Save (011 section 1.2): the lab refuses to Save over a revision it did
  // not last see, so a listener editing in vim while the lab is open is told which one won.
  const current = await readSettings(path)
  const verdict = checkRevision(current.revision, file?.revision)
  if (!verdict.ok) return { status: 409, body: { error: verdict.code, why: verdict.why, currentRevision: current.revision, path } }
  if (file?.kind !== 'orca-tts-settings') {
    return { status: 400, body: { error: 'wrong_kind', why: `kind must be "orca-tts-settings", got ${JSON.stringify(file?.kind)}` } }
  }
  const body = JSON.stringify({ ...file, writtenAt: new Date().toISOString() }, null, 2) + '\n'
  await mkdir(resolve(path, '..'), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, body, 'utf8')
  await rename(tmp, path)                      // atomic: never a half-written inbox
  return { status: 200, body: { ok: true, path, revision: file.revision, previousRevision: current.revision } }
}

/* ================================================================= static files */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml'
}

/** Confine a URL path to one root. No traversal, no symlink escape (P17's lesson, applied here). */
export function safeJoin (root, urlPath) {
  const decoded = decodeURIComponent(urlPath).replace(/^\/+/, '')
  if (decoded.includes('\0')) return null
  const full = resolve(root, decoded)
  const rootAbs = resolve(root)
  if (full !== rootAbs && !full.startsWith(rootAbs + (process.platform === 'win32' ? '\\' : '/'))) return null
  return full
}

/* ================================================================= the server */
const HOST = '127.0.0.1'     // never 0.0.0.0. This serves one machine: the author's.

function json (res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(payload)
}

async function readBody (req, limit = 8 * 1024 * 1024) {
  const parts = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > limit) throw new Error(`request body over ${limit} bytes`)
    parts.push(c)
  }
  if (parts.length === 0) return {}
  return JSON.parse(Buffer.concat(parts).toString('utf8'))
}

export function createLabServer ({ provider, fixtureDir, pageDir, settingsPath } = {}) {
  const prov = provider ?? new OsSynthProvider()
  const fixtures = fixtureDir ?? join(REPO_ROOT, 'fixtures')
  const page = pageDir ?? join(REPO_ROOT, 'voice-lab')
  const inbox = settingsPath ?? settingsPathFor()
  let inflight = null
  let voiceCache = null

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${HOST}`)
    const path = url.pathname
    try {
      if (req.method === 'POST' && path === '/normalize') {
        const { text = '', options = {} } = await readBody(req)
        const { spoken, ladderSpoken, stages } = await computeStages(text, options)
        if (spoken !== ladderSpoken) {
          return json(res, 500, { error: 'stage_ladder_drift', why: 'the incremental ladder no longer reproduces normalize(); the lab would be showing a pipeline it is not running' })
        }
        return json(res, 200, { spoken, stages })
      }

      if (req.method === 'POST' && path === '/speak') {
        const { text = '', options = {}, allowElsewhere = false } = await readBody(req)
        inflight?.abort()
        const ac = new AbortController()
        inflight = ac
        const { status, body } = await speak(prov, text, options, { allowElsewhere, signal: ac.signal })
        if (inflight === ac) inflight = null
        return json(res, status, body)
      }

      if (req.method === 'POST' && path === '/stop') {
        inflight?.abort()
        inflight = null
        prov.cancel?.()
        return json(res, 200, { stopped: true })
      }

      if (req.method === 'GET' && path === '/voices') {
        if (voiceCache === null) voiceCache = await prov.listVoices()   // ~487 ms on macOS; cached (P28)
        return json(res, 200, { voices: voiceCache })
      }

      if (path === '/settings') {
        if (req.method === 'GET') return json(res, 200, await readSettings(inbox))
        if (req.method === 'POST') {
          const { status, body } = await writeSettings(await readBody(req), inbox)
          return json(res, status, body)
        }
      }

      if (req.method === 'GET' && path === '/fixtures') {
        const names = (await readdir(fixtures)).filter((f) => f.endsWith('.md')).toSorted()
        return json(res, 200, { fixtures: names })
      }

      if (req.method === 'GET' && path.startsWith('/fixtures/')) {
        const file = safeJoin(fixtures, path.slice('/fixtures/'.length))
        if (file === null || !existsSync(file)) return json(res, 404, { error: 'no_such_fixture', path })
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
        return res.end(await readFile(file))
      }

      if (req.method === 'GET') {
        const rel = path === '/' ? 'index.html' : path
        const file = safeJoin(page, rel)
        if (file === null) return json(res, 400, { error: 'bad_path' })
        if (!existsSync(file)) {
          return json(res, 404, {
            error: 'no_page',
            why: `${file} does not exist. The page is Job J13 (voice-lab/index.html); the server ` +
                 'is J12. Endpoints work without it: POST /normalize, POST /speak, POST /stop, ' +
                 'GET /voices, GET|POST /settings, GET /fixtures.'
          })
        }
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
        return res.end(await readFile(file))
      }

      return json(res, 405, { error: 'method_not_allowed', method: req.method, path })
    } catch (err) {
      // Never fail silently, and never a generic message (P18, P30).
      return json(res, 500, { error: 'lab_server_error', message: err instanceof Error ? err.message : String(err) })
    }
  })
}

/* ================================================================= entry point */
export async function main (argv = process.argv.slice(2)) {
  const portArg = argv.find((a) => a.startsWith('--port='))
  const port = portArg ? Number(portArg.slice('--port='.length)) : 7311

  const proof = await assertLoadedModuleIsOnDiskSource()
  const server = createLabServer()
  await new Promise((ok) => server.listen(port, HOST, ok))

  const inbox = settingsPathFor()
  process.stdout.write(
    `Voice Lab  http://${HOST}:${server.address().port}\n` +
    `  normalizer  ${proof.source} (source, not dist — checked against ${proof.fixtures} probes)\n` +
    `  stages      ${STAGES.length}\n` +
    `  fixtures    ${join(REPO_ROOT, 'fixtures')}\n` +
    `  settings    ${inbox}${existsSync(inbox) ? '' : '  (not created yet)'}\n` +
    `  page        ${existsSync(join(REPO_ROOT, 'voice-lab/index.html')) ? 'voice-lab/index.html' : 'voice-lab/index.html  (J13, not landed yet)'}\n` +
    '  audio       the BROWSER plays. This process spawns no player and makes no sound.\n'
  )
  return server
}

if (import.meta.main) {
  await main().catch((err) => { process.stderr.write(`voice-lab: ${err.message}\n`); process.exit(1) })
}
