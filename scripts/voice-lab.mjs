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
import { readFile, writeFile, rename, mkdir, readdir, rm } from 'node:fs/promises'
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
const POCKET_MODELS_SRC = join(REPO_ROOT, 'packages/providers/src/pocket-synth/models.ts')
const POCKET_VOICES_SRC = join(REPO_ROOT, 'packages/providers/src/pocket-synth/voices.ts')
const POCKET_PROVIDER_SRC = join(REPO_ROOT, 'packages/providers/src/pocket-synth/index.ts')
const POCKET_RUNTIME_SRC = join(REPO_ROOT, 'packages/providers/src/pocket-synth/runtime.ts')

const { normalize } = await import(pathToFileURL(NORMALIZER_SRC).href)
const { Chunker } = await import(pathToFileURL(CHUNKER_SRC).href)
const { OsSynthProvider, LINUX_WAV_BACKENDS, LINUX_INSTALL_HINT } =
  await import(pathToFileURL(PROVIDER_SRC).href)
const pocketModels = await import(pathToFileURL(POCKET_MODELS_SRC).href)
const {
  modelStatus, modelDir: defaultModelDir, downloadModel, modelStatusDetail,
  MODEL_TOTAL_BYTES, MODEL_ARTIFACTS, MANIFEST_VERSION, MANIFEST_FILE, sha256
} = pocketModels
const { runtimeStatus, downloadRuntime } = await import(pathToFileURL(POCKET_RUNTIME_SRC).href)
const {
  POCKET_VOICES, parseVoiceKey, resolveVoiceForBackend, OS_BACKEND, POCKET_BACKEND
} = await import(pathToFileURL(POCKET_VOICES_SRC).href)
const { PocketSynthProvider } = await import(pathToFileURL(POCKET_PROVIDER_SRC).href)
// PV-050 can extend the already-landed model manager with pinned reference clips. Keep this
// surface honest in both revisions: the downloader's optional expanded manifest, when present,
// is what the progress count and advertised byte total describe.
const DOWNLOAD_ARTIFACTS = [...MODEL_ARTIFACTS, ...(pocketModels.VOICE_ARTIFACTS ?? [])]
const DOWNLOAD_TOTAL_BYTES = pocketModels.INSTALL_TOTAL_BYTES ?? MODEL_TOTAL_BYTES

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

/* ================================================================= the 17 stages
 *
 * `normalize()` composes 17 transforms — J21 added `stripHtmlComments` at 2, M14a added
 * `diagramsToLabels` at 3. 004
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
  // J21 bug 1. No control governs it: whether an HTML comment is spoken is not taste. It is
  // source markup addressed to a reader of the FILE, and the listener is not that reader.
  { n: 2, name: 'stripHtmlComments', controlIds: [] },
  // M14a. No control governs it YET: whether a box-drawing diagram is spoken as box characters is
  // not taste, it is the defect. The WORDING of its announcement -- and the six-label cap -- IS
  // taste and is D002 Q47, still owed a Panel A control beside `omit.codeBlockPhrase`.
  { n: 3, name: 'diagramsToLabels', controlIds: [] },
  { n: 4, name: 'stripInlineCode', controlIds: ['omit.inlineCode', 'ident.style', 'ident.parens'] },
  { n: 5, name: 'expandMarkdownLinks', controlIds: [] },
  { n: 6, name: 'stripUrls', controlIds: ['omit.urls', 'omit.urlPhrase'] },
  { n: 7, name: 'headingsToPauses', controlIds: ['struct.headingCue', 'struct.headingPauseMs'] },
  { n: 8, name: 'listItemsToSentences', controlIds: ['struct.orderedLists', 'struct.bulletMarker'] },
  { n: 9, name: 'tablesToRows', controlIds: ['struct.tableLeadIn', 'struct.tableHeaderRepeat', 'struct.tableFirstCellHeader'] },
  { n: 10, name: 'speakFilePaths', controlIds: ['path.style', 'path.extensionStyle', 'path.namePhrase', 'path.folderPhrase', 'path.depthPolicy', 'path.depthN', 'path.extensionWords'] },
  { n: 11, name: 'stripMarkdownMarkers', controlIds: ['ident.style', 'ident.parens'] },
  { n: 12, name: 'speakKeyGlyphs', controlIds: [] },
  { n: 13, name: 'stripEmoji', controlIds: ['omit.emoji'] },
  { n: 14, name: 'expandUnits', controlIds: ['num.expandUnits', 'num.unitWords'] },
  { n: 15, name: 'expandNumbers', controlIds: ['num.expandIntegers', 'num.decimals'] },
  { n: 16, name: 'collapseWhitespace', controlIds: [] },
  { n: 17, name: 'tidyPunctuation', controlIds: [] }
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
 * Run the 17 transforms incrementally and record what each one produced.
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
  const doUnits = opts.expandUnits ?? true

  // The ONE piece of duplicated knowledge in this file: the call order of `normalize()`.
  // `assertLoadedModuleIsOnDiskSource()` is what stops it from drifting silently.
  const apply = [
    (s) => fn.stripFencedCode(s, codeBlocks),
    (s) => fn.stripHtmlComments(s),
    (s) => fn.diagramsToLabels(s),
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
    doUnits ? (s) => fn.expandUnits(s) : null,
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
  assertSourceModule(pathToFileURL(POCKET_MODELS_SRC).href, 'Pocket model manager')
  assertSourceModule(pathToFileURL(POCKET_VOICES_SRC).href, 'Pocket voice registry')
  assertSourceModule(pathToFileURL(POCKET_PROVIDER_SRC).href, 'Pocket provider')

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
        `SOURCE/IMPORT MISMATCH on fixture ${name}. The 16-stage ladder (compiled from ` +
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

/* ================================================================= the wire format
 *
 * `POST /speak` streams **NDJSON over one chunked response**: one JSON object per line, flushed the
 * instant it exists. Chunk 1 reaches the page while chunk 2 is still in the synthesizer — FR-024,
 * and the reason Gate M11 was measured at p95 3,401 ms on a two-chunk fixture and 22,755 ms on a
 * thirteen-chunk one (`docs/.research/m11-gate.md` section 0). Serialized synthesis WAS the reading.
 *
 * WHY NDJSON-OVER-CHUNKED, and what it was chosen against:
 *
 *   SSE (`text/event-stream`).  Rejected. `EventSource` is GET-only, so the options object would
 *     have to travel in a query string or in a separate POST — a two-call handle by the back door.
 *     Driving SSE over `fetch` instead means parsing `data:` framing by hand, which is strictly
 *     more work than splitting on `\n`, and buys only auto-reconnect — a misfeature here, because
 *     a reconnect would silently re-synthesize an utterance the listener already interrupted.
 *
 *   Two-call handle + poll (`POST /speak` -> id, then `GET /speak/<id>/<i>`).  Rejected. It adds a
 *     round trip per chunk and a poll interval to a budget where one sentence already costs 1,138 ms,
 *     and it needs server-side state with a lifetime, which is a second thing to get wrong. Its one
 *     real advantage — surviving a dropped connection — is worthless for a lab on 127.0.0.1.
 *
 *   NDJSON over chunked transfer.  Taken. Abort is the transport's own: the page's `AbortController`
 *     aborts the `fetch`, the socket closes, the server sees `close` and aborts the synthesizer, so
 *     Stop stays PUSHED and never polled (HANDOFF: p50 120 ms / p99 250 ms). Backpressure is TCP's,
 *     honoured by awaiting `drain` before synthesizing the next chunk, so a slow page cannot make
 *     the server buffer a whole fixture of WAVs in memory. Error-mid-stream is a RECORD, not a
 *     status code, which is the one thing this format must do that a single envelope cannot.
 *
 * The records, in order:
 *   { kind: 'head',        played, backend, voice, degradation?, spoken,
 *                           chunkCount, timings }                            exactly one, first
 *   { kind: 'chunk',       i, text, boundary, isFirst, format, ... base64 } zero or more
 *   { kind: 'chunk-error', i, text, name, message }                        zero or more
 *   { kind: 'end',         ok, delivered, lost, announcement, timings }     exactly one, last
 *
 * THE HTTP STATUS IS STILL HONEST. The response head is held back until the first chunk actually
 * synthesizes. A provider that is genuinely unavailable — or that fails on every chunk — therefore
 * still answers a real `503` with the provider's own words, exactly as before. Once the first bytes
 * are out the status is spent, and later trouble is reported in-band. That is the whole reason the
 * head is deferred rather than written eagerly.
 *
 * `{ stream: false }` opts out and returns the old single envelope. Two callers genuinely need it:
 * FR-026's negative control (the harness must be able to run the gate with streaming DISABLED and
 * watch it exceed 2,000 ms — without this flag that control is unrunnable, finding G-4), and
 * `scripts/ci/voice-lab-ci.mjs`, which asserts one platform outcome and wants one object.
 */

/**
 * Errors that mean THE PROVIDER IS UNAVAILABLE, not that one chunk was unspeakable.
 *
 * The distinction is the whole of Fix 2. `say` exiting successfully with an unreadable audio file
 * is a fact about THAT TEXT — the next chunk is very likely fine, and 503-ing the request throws
 * away audio the listener could have heard. "There is no synthesizer on this machine" is a fact
 * about the MACHINE, and every chunk after it will fail the same way.
 *
 * Named by class rather than by message, and the list is short on purpose: anything not on it is
 * treated as chunk-level and therefore SURVIVABLE, with rule C below as the backstop.
 */
export const PROVIDER_UNAVAILABLE_ERRORS = [
  'OsSynthUnavailableError',
  'LinuxSpeechUnavailableError'
]

export function isProviderUnavailable (err) {
  const name = err?.name ?? err?.constructor?.name ?? ''
  return PROVIDER_UNAVAILABLE_ERRORS.includes(name)
}

const COUNT_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty'
]
/** Words, not numerals: this sentence goes STRAIGHT to the synthesizer and never through `normalize()`. */
export function countWord (n) { return COUNT_WORDS[n] ?? String(n) }

/**
 * What the listener HEARS when a chunk yields no audio (PITFALLS P30).
 *
 * P30 is the entry this exists for: an announcement that terminates in a log, a banner or a desktop
 * notification is an announcement a voice-first listener never receives. So the loss is spoken, in
 * the audio stream that just lost it, by the same synthesizer, in the same voice.
 *
 * P30 also sets the URGENCY: losses DEFER to the end of the current utterance and COALESCE. One
 * sentence at the end, naming the count and the total — never an interruption per loss, which
 * would make a three-chunk failure worse to listen to than silence.
 */
export function lossAnnouncement (lost, total) {
  if (lost <= 0) return null
  const parts = total === 1 ? 'part' : 'parts'   // "one of three PARTS": the noun follows the total
  const verb = lost === 1 ? 'was' : 'were'
  return `${countWord(lost)} of ${countWord(total)} ${parts} could not be spoken and ${verb} skipped.`
}

/**
 * normalize -> chunk -> synthesize, yielding records as they exist. No player, ever.
 *
 * @param provider  anything with `prepare()`, `generate()`, `linuxBackend`. Injected so the
 *                  spoke-elsewhere branch is testable without a Linux desktop.
 * @param allowElsewhere  opt-in. On the `spd-say` rung `generate()` makes the DAEMON speak; that
 *                  is the one sanctioned exception (P25) and it is never the default (P31).

 * Backpressure is the consumer's: the generator is suspended at every `yield` until the consumer
 * asks for the next record, so a consumer that awaits its socket write before iterating again
 * stops the next chunk from being synthesized. Nothing extra is needed for that.
 */
export async function * speakStream (
  provider, text, opts = {}, { allowElsewhere = false, signal } = {}
) {
  const t0 = performance.now()
  const spoken = normalize(text, opts.normalize ?? {})
  const tNorm = performance.now()

  const chunker = new Chunker(opts.chunk ?? {})
  const chunks = [...chunker.addText(spoken), ...chunker.finish()]
  const tChunk = performance.now()

  try {
    await provider.prepare()
  } catch (err) {
    // Rule A, before anything: prepare() failing is always about the machine, never about the text.
    yield ({ kind: 'fatal', ...providerError(err) })
    return
  }

  const backend = provider.linuxBackend ?? null
  const elsewhere = backend !== null && !LINUX_WAV_BACKENDS.includes(backend)

  if (elsewhere && !allowElsewhere) {
    // Named outcome, returned BEFORE synthesizing (004 section 2). Nothing is spoken: making the
    // daemon talk is an explicit act, not something a page load does.
    yield ({ kind: 'elsewhere', status: 200, body: elsewhereBody(backend, spoken, t0, tNorm, tChunk) })
    return
  }

  yield ({
    kind: 'head',
    played: elsewhere ? 'elsewhere-forced' : 'browser',
    backend,
    spoken,
    chunkCount: chunks.length,
    timings: { normalizeMs: tNorm - t0, chunkMs: tChunk - tNorm }
  })

  const tSynth0 = performance.now()
  let delivered = 0
  const losses = []
  let i = 0
  for (const chunk of chunks) {
    if (signal?.aborted === true) break
    try {
      for await (const audio of provider.generate(chunk.text, { ...opts.synthesize, signal })) {
        yield ({
          kind: 'chunk',
          i: delivered,
          chunkIndex: i,
          text: chunk.text,
          boundary: chunk.boundary,
          isFirst: chunk.isFirst,
          format: audio.format,        // 004 section 2: branch on format, never assume WAV.
          sampleRate: audio.sampleRate,
          channels: audio.channels,
          bytes: audio.data.byteLength,
          base64: Buffer.from(audio.data).toString('base64')
        })
        delivered++
      }
    } catch (err) {
      if (isProviderUnavailable(err)) {
        // Rule A: the machine, not the text. Nothing after this can succeed.
        yield ({ kind: 'fatal', ...providerError(err) })
        return
      }
      // Rule B: this chunk produced nothing. The others are fine and the listener hears them.
      losses.push({ i, text: chunk.text, err })
      yield ({
        kind: 'chunk-error',
        i,
        text: chunk.text,
        name: err?.name ?? err?.constructor?.name ?? 'Error',
        message: err instanceof Error ? err.message : String(err)
      })
    }
    i++
  }

  // Rule C: every chunk failed. In effect the provider produced no audio at all, so this is the
  // unavailable case however each individual failure was classified — and it is still a real 503,
  // because the head has not been written yet (nothing was delivered to write it for).
  if (delivered === 0 && losses.length > 0) {
    const { status, body } = providerError(losses[0].err)
    yield ({
      kind: 'fatal',
      status,
      body: {
        ...body,
        message: losses.length === 1
          ? body.message
          : `all ${losses.length} chunks failed to synthesize; the first said: ${body.message}`,
        failedChunks: losses.length
      }
    })
    return
  }

  const announcement = lossAnnouncement(losses.length, chunks.length)
  let announcementSpoken = false
  if (announcement !== null) {
    // P30: the loss is SPOKEN, in the stream that lost it. Synthesized with the same options, so it
    // is the same voice at the same rate — a loss reported in a different voice sounds like a
    // different speaker, which is the confusion P22 is about.
    try {
      for await (const audio of provider.generate(announcement, { ...opts.synthesize, signal })) {
        yield ({
          kind: 'chunk',
          i: delivered,
          chunkIndex: null,
          text: announcement,
          boundary: 'announcement',
          isFirst: false,
          announcement: true,
          format: audio.format,
          sampleRate: audio.sampleRate,
          channels: audio.channels,
          bytes: audio.data.byteLength,
          base64: Buffer.from(audio.data).toString('base64')
        })
        delivered++
        announcementSpoken = true
      }
    } catch {
      // The spoken channel failed too. `end.announcementSpoken: false` tells the page to say it
      // through the channels it has left — never to drop it. A loss is never silent (P30).
    }
  }
  yield ({
    kind: 'end',
    ok: true,
    delivered,
    lost: losses.length,
    chunkCount: chunks.length,
    announcement,
    announcementSpoken: announcement === null ? null : announcementSpoken,
    aborted: signal?.aborted === true,
    timings: {
      normalizeMs: tNorm - t0,
      chunkMs: tChunk - tNorm,
      synthMs: performance.now() - tSynth0,
      totalMs: performance.now() - t0
    }
  })
}

function elsewhereBody (backend, spoken, t0, tNorm, tChunk) {
  return {
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

/**
 * The non-streaming path: collect `speakStream()` into the single envelope this endpoint used to
 * return. It is the SAME code path — one generator, two shapes — so the negative control in FR-026
 * measures the streaming defect and nothing else.
 */
export async function speak (provider, text, opts = {}, { allowElsewhere = false, signal } = {}) {
  const chunks = []
  let head = null
  let end = null
  for await (const rec of speakStream(provider, text, opts, { allowElsewhere, signal })) {
    if (rec.kind === 'fatal') return { status: rec.status, body: rec.body }
    if (rec.kind === 'elsewhere') return { status: rec.status, body: rec.body }
    if (rec.kind === 'head') head = rec
    if (rec.kind === 'chunk') chunks.push(chunkPayload(rec))
    if (rec.kind === 'end') end = rec
  }
  return {
    status: 200,
    body: {
      played: head.played,
      backend: head.backend,
      spoken: head.spoken,
      chunkCount: head.chunkCount,
      chunks,
      lost: end?.lost ?? 0,
      announcement: end?.announcement ?? null,
      timings: end?.timings ?? head.timings
    }
  }
}

/** A `chunk` record minus its record-keeping fields — what the old envelope carried per chunk. */
function chunkPayload (rec) {
  // Destructured only to OMIT them; `_` marks that for the linter without a disable comment.
  const { kind: _kind, chunkIndex: _chunkIndex, ...rest } = rec
  return rest
}

/**
 * 503, with the PROVIDER'S OWN words. On a stock Ubuntu desktop with no synthesizer this is the
 * expected path, and `LinuxSpeechUnavailableError`'s message already carries the install remedy
 * (`os-synth/index.ts:148,157-165`). A generic "synthesis failed" here would be P18 exactly.
 *
 * THE HINT IS PLATFORM-SPECIFIC, and absent when there is no honest remedy — PITFALLS P18's own
 * shape, which this function used to have: it answered `sudo apt install espeak-ng` to a macOS
 * `say` failure (`docs/.research/m11-gate.md` G-1). Wrong package manager, wrong package, wrong
 * operating system. On macOS and Windows the synthesizer is part of the OS: there is nothing to
 * install, so nothing is offered. A remedy the reader cannot act on is worse than none, because it
 * sends them somewhere that cannot help.
 */
export function providerError (err, platform = process.platform) {
  const message = err instanceof Error ? err.message : String(err)
  return {
    status: 503,
    body: {
      played: 'nothing',
      error: 'provider_error',
      name: err?.name ?? err?.constructor?.name ?? 'Error',
      message,
      platform,
      installHint: installHintFor(platform, message)
    }
  }
}

export function installHintFor (platform, message = '') {
  // Linux is the only platform where a missing synthesizer is a missing PACKAGE.
  if (platform === 'linux') return message.includes(LINUX_INSTALL_HINT) ? null : LINUX_INSTALL_HINT
  // macOS ships `say`; Windows ships SAPI. Neither is installable and neither is uninstallable, so
  // a failure here is not a missing package and must not be dressed as one.
  return null
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

/** `{ stream: false }` — one envelope, the shape this endpoint returned before FR-024. */
async function speakOnce (res, route, text, ac, allowElsewhere = false) {
  const { status, body } = await speak(
    route.provider, text, route.options, { allowElsewhere, signal: ac.signal }
  )
  return json(res, status, routedBody(body, route))
}

/** Write one NDJSON record and RESOLVE ONLY WHEN THE SOCKET HAS TAKEN IT — that is the backpressure. */
function writeRecord (res, rec) {
  const line = JSON.stringify(rec) + '\n'
  return new Promise((resolve) => {
    if (res.write(line)) resolve()
    else res.once('drain', resolve)
  })
}

/**
 * The streaming path. The response head is DEFERRED until the first chunk exists, so a provider
 * that never produces audio still answers a real 503 with the provider's own words — see "the wire
 * format" above. Records produced before that point (a `head`, any early `chunk-error`) are held
 * and flushed together with the first chunk, in order.
 */
async function speakStreaming (res, route, text, { allowElsewhere, signal }) {
  let started = false
  const pending = []

  // BACKPRESSURE IS THE `await` IN THIS LOOP. `speakStream` is suspended at its `yield` until the
  // loop asks for the next record, and the loop does not ask until the socket has taken the bytes
  // of the last one — so a slow page cannot make the server hold a whole fixture of WAVs.
  for await (const original of speakStream(
    route.provider, text, route.options, { allowElsewhere, signal }
  )) {
    const rec = original.kind === 'head'
      ? { ...original, ...routeFields(route) }
      : original
    if (rec.kind === 'fatal' || rec.kind === 'elsewhere') {
      // By construction nothing has been written yet: `fatal` is only reached before the first
      // chunk (after one, a failure is a `chunk-error` record instead).
      if (started) { await writeRecord(res, rec); res.end(); return }
      return json(res, rec.status, routedBody(rec.body, route))
    }
    if (!started) {
      pending.push(rec)
      if (rec.kind !== 'chunk') continue
      started = true
      res.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      })
      for (const held of pending) await writeRecord(res, held)
      pending.length = 0
      continue
    }
    await writeRecord(res, rec)
  }
  if (!started) {
    // No chunks and no fatal: the utterance was empty, or Stop landed before the first chunk.
    return json(res, 200, routedBody({
      played: 'browser', chunks: [], chunkCount: 0,
      spoken: pending.find((r) => r.kind === 'head')?.spoken ?? '', empty: true
    }, route))
  }
  res.end()
}

/* ================================================================= Pocket TTS model surface
 *
 * The model manager owns hashing, staging and the atomic swap. This server only translates that
 * work into the page's control surface: honest voice availability, named status, and an NDJSON
 * progress stream. Tests inject both the downloader and its fetch implementation; no test reaches
 * the network or the author's real cache (R061 / PV-NFR-004).
 */

function pocketUnavailableReason (status) {
  if (status.kind === 'ready') return null
  return modelStatusDetail(status)
}

function voiceEntries (osVoices, pocketStatus) {
  const pocketAvailable = pocketStatus.kind === 'ready'
  const pocketReason = pocketUnavailableReason(pocketStatus)
  const os = osVoices.map((raw) => {
    const name = String(raw)
    const key = name.startsWith(`${OS_BACKEND}:`) ? name : `${OS_BACKEND}:${name}`
    const parsed = parseVoiceKey(key)
    return {
      key,
      displayName: parsed.voice,
      backend: OS_BACKEND,
      available: true,
      reason: null,
      // The page currently on disk reads `entry.name`. Keep that OS path working while PV-040
      // teaches it backend-qualified keys; removing this silently turns Alex into voice "0".
      name: parsed.voice
    }
  })
  const pocket = POCKET_VOICES.map((voice) => ({
    key: voice.key,
    displayName: voice.displayName,
    backend: parseVoiceKey(voice.key).backend,
    available: pocketAvailable,
    reason: pocketReason
  }))
  return [...os, ...pocket]
}

/** Read both the review payload (`options.voice`) and the page payload (`options.synthesize.voice`). */
function requestedVoiceKey (options) {
  const key = options?.synthesize?.voice ?? options?.voice
  return typeof key === 'string' && key.length > 0 ? key : null
}

/**
 * Replace a qualified key with the bare provider-local name, or remove voice on a loud fallback.
 * The top-level `voice` spelling is consumed here so it cannot accidentally become a second wire.
 */
function optionsForProvider (options, voice) {
  const { voice: _requestVoice, ...rest } = options ?? {}
  const { voice: _qualifiedVoice, ...synthesize } = rest.synthesize ?? {}
  return {
    ...rest,
    synthesize: voice === null ? synthesize : { ...synthesize, voice }
  }
}

function degradation (code, requested, reason) {
  return {
    code,
    requestedBackend: requested.backend,
    requestedVoice: requested.voice,
    servedBackend: OS_BACKEND,
    reason
  }
}

/**
 * Resolve the backend BEFORE the response starts. Pocket `prepare()` is the availability probe:
 * if its model/runtime cannot serve, the zero-setup OS floor speaks and the response names the
 * substitution. A qualified key is never handed to either provider.
 */
async function routeSpeak (osProvider, pocketProvider, options) {
  const key = requestedVoiceKey(options)
  if (key === null) {
    return {
      provider: osProvider, options: optionsForProvider(options, null),
      servedBackend: OS_BACKEND, voice: null, degradation: null
    }
  }

  const requested = parseVoiceKey(key)
  if (requested.backend === OS_BACKEND) {
    return {
      provider: osProvider, options: optionsForProvider(options, requested.voice),
      servedBackend: OS_BACKEND, voice: requested.voice, degradation: null
    }
  }

  if (requested.backend !== POCKET_BACKEND) {
    return {
      provider: osProvider, options: optionsForProvider(options, null),
      servedBackend: OS_BACKEND, voice: null,
      degradation: degradation(
        'backend_unavailable', requested,
        `Speech backend ${JSON.stringify(requested.backend)} is not registered; using ${OS_BACKEND} instead.`
      )
    }
  }

  let available
  try {
    available = await pocketProvider.listVoices()
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return {
      provider: osProvider, options: optionsForProvider(options, null),
      servedBackend: OS_BACKEND, voice: null,
      degradation: degradation('backend_unavailable', requested, reason)
    }
  }
  const voice = resolveVoiceForBackend([key], POCKET_BACKEND, available)
  if (voice === null) {
    return {
      provider: osProvider, options: optionsForProvider(options, null),
      servedBackend: OS_BACKEND, voice: null,
      degradation: degradation(
        'voice_unavailable', requested,
        `Pocket TTS has no voice named ${JSON.stringify(requested.voice)}; using ${OS_BACKEND} instead.`
      )
    }
  }

  try {
    await pocketProvider.prepare()
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return {
      provider: osProvider, options: optionsForProvider(options, null),
      servedBackend: OS_BACKEND, voice: null,
      degradation: degradation('backend_unavailable', requested, reason)
    }
  }
  return {
    provider: pocketProvider, options: optionsForProvider(options, voice),
    servedBackend: POCKET_BACKEND, voice, degradation: null
  }
}

function routeFields (route) {
  return {
    backend: route.servedBackend,
    voice: route.voice,
    ...(route.degradation === null ? {} : { degradation: route.degradation })
  }
}

function routedBody (body, route) {
  if (typeof body?.played === 'string' && body.played.startsWith('elsewhere')) {
    return {
      ...body,
      providerBackend: route.servedBackend,
      voice: route.voice,
      ...(route.degradation === null ? {} : { degradation: route.degradation })
    }
  }
  return { ...body, ...routeFields(route) }
}

function downloadFailureFile (err, completedFiles, artifacts = DOWNLOAD_ARTIFACTS) {
  if (typeof err?.file === 'string' && err.file.length > 0) return err.file
  const message = err instanceof Error ? err.message : String(err)
  const named = artifacts.find((artifact) => message.includes(artifact.file))
  if (named !== undefined) return named.file
  if (/\bLICENSE\b/.test(message)) return 'LICENSE'
  return artifacts[completedFiles]?.file ?? 'model'
}

function verificationError (file, message) {
  return Object.assign(new Error(message), { file })
}

/**
 * Independently verify what the page just downloaded. `modelStatus()` proves names + manifest
 * version; this proves the bytes behind every named artifact. A pre-existing ready directory is
 * deliberately not granted this receipt: R14-10's falsifier must start empty and acquire here.
 */
async function verifyModelInstall (
  dir, {
    artifacts = DOWNLOAD_ARTIFACTS,
    manifestFile = MANIFEST_FILE,
    manifestVersion = MANIFEST_VERSION
  } = {}
) {
  let found
  try {
    found = (await readFile(join(dir, manifestFile), 'utf8')).trim()
  } catch (err) {
    throw verificationError(
      manifestFile,
      `${manifestFile} could not be read after download: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  if (found !== String(manifestVersion)) {
    throw verificationError(
      manifestFile,
      `${manifestFile} says version ${JSON.stringify(found)}, expected ${manifestVersion}`
    )
  }

  let totalBytes = 0
  for (const artifact of artifacts) {
    let body
    try {
      body = await readFile(join(dir, artifact.file))
    } catch (err) {
      throw verificationError(
        artifact.file,
        `${artifact.file} could not be read after download: ${err instanceof Error ? err.message : String(err)}`
      )
    }
    if (body.length !== artifact.bytes) {
      throw verificationError(
        artifact.file,
        `${artifact.file} is ${body.length} bytes after download, expected ${artifact.bytes}`
      )
    }
    const got = sha256(body)
    if (got !== artifact.sha256) {
      throw verificationError(
        artifact.file,
        `${artifact.file} hashes to ${got} after download, expected ${artifact.sha256}`
      )
    }
    totalBytes += body.length
  }
  return {
    verified: true, manifestVersion,
    artifactCount: artifacts.length, totalBytes
  }
}

function installationStatus (status, proof, manifestVersion) {
  if (status.kind !== 'ready') {
    return { source: 'not-ready', verified: false, manifestVersion }
  }
  if (proof !== null) return { source: 'voice-lab-download', ...proof }
  return { source: 'preseeded-or-unverified', verified: false, manifestVersion }
}

async function streamModelDownload (
  res, {
    dir, signal, fetchImpl, downloadModelImpl, modelStatusImpl,
    verifyModelInstallImpl, onVerified,
    runtimeStatusImpl = runtimeStatus, downloadRuntimeImpl = downloadRuntime,
    artifacts = DOWNLOAD_ARTIFACTS, totalBytes = DOWNLOAD_TOTAL_BYTES
  }
) {
  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  await writeRecord(res, {
    kind: 'start', backend: POCKET_BACKEND,
    fileCount: artifacts.length, totalBytes
  })

  // `downloadModel` calls onProgress synchronously after each complete file. Serialize those tiny
  // writes so their wire order remains the manifest order even when the socket applies pressure.
  let writes = Promise.resolve()
  let completedFiles = 0
  const options = {
    dir,
    signal,
    onProgress: (progress) => {
      completedFiles++
      writes = writes.then(() => writeRecord(res, {
        kind: 'progress', backend: POCKET_BACKEND, ...progress
      }))
    }
  }
  if (fetchImpl !== undefined) options.fetchImpl = fetchImpl

  try {
    await downloadModelImpl(options)
    await writes

    // R16-01: the weights alone do not make a working backend. `downloadRuntime` existed, was
    // unit-tested, and had NO PRODUCTION CALLER — so a listener could press the one button, watch
    // 173.8 MB arrive, and still be told the neural voices cannot run. One button, one outcome:
    // whatever else is missing for Pocket to speak is fetched here or the failure is named.
    //
    // `unsupported` is not a failure. An Intel Mac gets a sentence and keeps its OS voices.
    // R16-01's proof, and it must be able to fail: comment this branch out and the three
    // R16-01 cases in voice-lab.test.mjs go red.
    if (runtimeStatusImpl === null) {
      // A caller that is deliberately exercising only the model path says so, and the stream
      // records it. A silently skipped step is how R16-01 happened in the first place.
      await writeRecord(res, { kind: 'runtime', backend: POCKET_BACKEND, state: 'not-requested' })
      await writes
    } else {
    const rt = await runtimeStatusImpl()
    if (rt.kind === 'unsupported') {
      await writeRecord(res, {
        kind: 'runtime', backend: POCKET_BACKEND, state: 'unsupported', why: rt.why
      })
    } else if (rt.kind !== 'ready') {
      await writeRecord(res, {
        kind: 'runtime', backend: POCKET_BACKEND, state: 'fetching', bytes: rt.kind === 'absent' ? rt.bytes : 0
      })
      const rtOptions = { onProgress: (p) => {
        writes = writes.then(() => writeRecord(res, { kind: 'runtime', backend: POCKET_BACKEND, ...p }))
      } }
      if (signal !== undefined) rtOptions.signal = signal
      if (fetchImpl !== undefined) rtOptions.fetchImpl = fetchImpl
      await downloadRuntimeImpl(rtOptions)
      await writes
      // R003 again: ask the cache, do not trust the return.
      const after = await runtimeStatusImpl()
      if (after.kind !== 'ready') {
        throw Object.assign(new Error(
          `the ONNX Runtime download returned but the cache reports ${after.kind}`),
        { file: 'onnxruntime' })
      }
      await writeRecord(res, { kind: 'runtime', backend: POCKET_BACKEND, state: 'ready' })
    }
    }

    // R003: the downloader returning is not the gate. Ask the cache whether the files it needs are
    // actually ready, so an injected or future downloader cannot earn a false terminal success.
    const status = await modelStatusImpl(dir)
    if (status.kind !== 'ready') {
      const file = (status.kind === 'absent' || status.kind === 'incomplete')
        ? (status.missing[0] ?? 'model')
        : 'model'
      throw Object.assign(new Error(
        `download returned but ${modelStatusDetail(status)}`
      ), { file })
    }

    // R14-10: `ready` can describe files a developer copied in by hand. Only an independent
    // version + digest pass over THIS request's result earns the falsifier's download receipt.
    const verification = await verifyModelInstallImpl(dir)
    if (verification?.verified !== true) {
      throw verificationError('model', 'the model verifier returned without verifying the install')
    }
    onVerified(verification)

    await writeRecord(res, {
      kind: 'complete', ok: true, backend: POCKET_BACKEND, dir,
      fileCount: artifacts.length, totalBytes, verification
    })
  } catch (err) {
    // An HTTP status cannot change after `start`; the failure therefore MUST be a terminal record.
    // Await earlier progress writes first so the terminal record can never overtake them.
    await writes
    const cause = err instanceof Error ? err.message : String(err)
    await writeRecord(res, {
      kind: 'error', ok: false, error: 'model_download_failed', backend: POCKET_BACKEND,
      file: downloadFailureFile(err, completedFiles, artifacts),
      name: err?.name ?? err?.constructor?.name ?? 'Error',
      cause,
      message: cause
    })
  }
  res.end()
}

export function createLabServer ({
  provider, pocketProvider, fixtureDir, pageDir, settingsPath,
  modelDirectory, fetchImpl, downloadModelImpl = downloadModel,
  runtimeStatusImpl = runtimeStatus, downloadRuntimeImpl = downloadRuntime,
  modelStatusImpl = modelStatus, verifyModelInstallImpl,
  verificationArtifacts = DOWNLOAD_ARTIFACTS,
  verificationManifestFile = MANIFEST_FILE,
  verificationManifestVersion = MANIFEST_VERSION
} = {}) {
  const fixtures = fixtureDir ?? join(REPO_ROOT, 'fixtures')
  const page = pageDir ?? join(REPO_ROOT, 'voice-lab')
  const inbox = settingsPath ?? settingsPathFor()
  const pocketDir = modelDirectory ?? defaultModelDir()
  const prov = provider ?? new OsSynthProvider()
  // Default constructors are load-bearing. Tests that inject both providers cannot see a
  // regression that only happens when these run — that is how R15-03 survived 3a4db83.
  const pocketProv = pocketProvider ?? new PocketSynthProvider({ dir: pocketDir })
  const verifyInstall = verifyModelInstallImpl ?? ((dir) => verifyModelInstall(dir, {
    artifacts: verificationArtifacts,
    manifestFile: verificationManifestFile,
    manifestVersion: verificationManifestVersion
  }))
  let inflight = null
  let voiceCache = null
  let modelDownloadInFlight = null
  let modelInstallProof = null

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
        const { text = '', options = {}, allowElsewhere = false, stream = true } = await readBody(req)
        inflight?.abort()
        const ac = new AbortController()
        inflight = ac
        // Abort is PUSHED by the transport: the page's own AbortController closes the socket, and
        // the synthesizer is cancelled here rather than at the next poll. `writableEnded` keeps a
        // NORMAL end (which also emits 'close') from looking like a listener pressing Stop.
        res.on('close', () => { if (!res.writableEnded) ac.abort() })
        const route = await routeSpeak(prov, pocketProv, options)
        const done = stream === false
          ? await speakOnce(res, route, text, ac, allowElsewhere)
          : await speakStreaming(res, route, text, { allowElsewhere, signal: ac.signal })
        if (inflight === ac) inflight = null
        return done
      }

      if (req.method === 'POST' && path === '/stop') {
        inflight?.abort()
        inflight = null
        prov.cancel?.()
        pocketProv.cancel?.()
        return json(res, 200, { stopped: true })
      }

      if (req.method === 'GET' && path === '/voices') {
        if (voiceCache === null) voiceCache = await prov.listVoices()   // ~487 ms on macOS; cached (P28)
        // Model status is deliberately NOT cached: a completed button press must make Pocket
        // voices available on the very next GET without restarting this server.
        const pocketStatus = await modelStatusImpl(pocketDir)
        return json(res, 200, {
          voices: voiceEntries(voiceCache, pocketStatus),
          platform: process.platform,
          provider: prov.id ?? 'os-synth',
          model: {
            kind: pocketStatus.kind,
            dir: pocketStatus.dir,
            detail: modelStatusDetail(pocketStatus),
            ...(pocketStatus.kind === 'absent' || pocketStatus.kind === 'incomplete'
              ? { missing: pocketStatus.missing }
              : {})
          }
        })
      }

      if (req.method === 'GET' && path === '/model/status') {
        const status = await modelStatusImpl(pocketDir)
        return json(res, 200, {
          ...status,
          installation: installationStatus(
            status, modelInstallProof, verificationManifestVersion
          )
        })
      }

      if (req.method === 'POST' && path === '/model/download') {
        if (modelDownloadInFlight !== null) {
          return json(res, 409, {
            error: 'model_download_in_progress',
            backend: POCKET_BACKEND,
            message: 'A Pocket TTS model download is already in progress.'
          })
        }
        const ac = new AbortController()
        const current = { controller: ac }
        modelDownloadInFlight = current
        // A disconnected page must not leave 166 MB arriving with nobody able to see progress.
        res.on('close', () => { if (!res.writableEnded) ac.abort() })
        try {
          return await streamModelDownload(res, {
            dir: pocketDir, signal: ac.signal, fetchImpl, downloadModelImpl,
            modelStatusImpl, verifyModelInstallImpl: verifyInstall,
            onVerified: (proof) => { modelInstallProof = proof },
            runtimeStatusImpl, downloadRuntimeImpl,
            artifacts: verificationArtifacts,
            totalBytes: verificationArtifacts.reduce((n, artifact) => n + artifact.bytes, 0)
          })
        } finally {
          if (modelDownloadInFlight === current) modelDownloadInFlight = null
        }
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

      /**
       * WRITE an example, from the page. New or existing, same endpoint.
       *
       * Examples were read-only, so trying a phrase meant leaving the instrument, editing a file
       * on disk, and coming back — which is exactly the "scatter me around to edit config files"
       * the author objected to. Tuning by ear means typing a sentence and hearing it, and the
       * sentences worth keeping are the ones that surprised you.
       *
       * `safeJoin` is the containment check (it resolves and refuses anything outside `fixtures`),
       * and the name is forced to end in `.md` so this cannot be used to write arbitrary files.
       */
      if (req.method === 'PUT' && path.startsWith('/fixtures/')) {
        const raw = decodeURIComponent(path.slice('/fixtures/'.length))
        const name = raw.endsWith('.md') ? raw : `${raw}.md`
        if (!/^[\w .-]+\.md$/.test(name)) {
          return json(res, 400, {
            error: 'bad_name',
            message: 'An example name may contain letters, numbers, spaces, dots, dashes and underscores.'
          })
        }
        const file = safeJoin(fixtures, name)
        if (file === null) return json(res, 400, { error: 'bad_name', message: 'That name escapes the examples folder.' })
        const body = await readBody(req)
        const text = typeof body.text === 'string' ? body.text : ''
        const existed = existsSync(file)
        await writeFile(file, text, 'utf8')
        return json(res, 200, { ok: true, name, created: !existed, bytes: Buffer.byteLength(text) })
      }

      if (req.method === 'DELETE' && path.startsWith('/fixtures/')) {
        const name = decodeURIComponent(path.slice('/fixtures/'.length))
        const file = safeJoin(fixtures, name)
        if (file === null || !existsSync(file)) return json(res, 404, { error: 'no_such_fixture', path })
        await rm(file)
        return json(res, 200, { ok: true, name, deleted: true })
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
/**
 * Argument parsing that REFUSES what it does not understand.
 *
 * `--port 7399` used to be accepted in silence and ignored: only `--port=7399` was ever read, so
 * the server bound 7311 anyway and then died `EADDRINUSE` against the lab already running there.
 * A flag that is accepted and ignored is the same class of defect as everything else this file was
 * fixed for — the caller is told they got what they asked for and they did not. Both spellings now
 * work, and anything unrecognised is a loud, named refusal rather than a default.
 */
export function parseArgs (argv) {
  let port = 7311
  let pageDir = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    // `--page <dir>` serves a DIFFERENT copy of the page. It exists for `scripts/ui-probe.mjs`,
    // which proves each of its checks can fail by running it against a deliberately broken copy —
    // a check that cannot go red is not a check. Nothing else should pass it.
    if (a.startsWith('--page=') || a === '--page') {
      const raw = a === '--page' ? (argv[++i] ?? '') : a.slice('--page='.length)
      if (!raw) throw new Error('--page wants a directory.')
      pageDir = raw
      continue
    }
    let raw = null
    if (a.startsWith('--port=')) raw = a.slice('--port='.length)
    else if (a === '--port') { raw = argv[i + 1] ?? ''; i++ }
    else throw new Error(`unrecognised argument ${JSON.stringify(a)}. The flags are --port=<n> and --page=<dir>.`)
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 0 || n > 65535) {
      throw new Error(`--port wants an integer from 0 to 65535, got ${JSON.stringify(raw)}.`)
    }
    port = n
  }
  return { port, pageDir }
}

export async function main (argv = process.argv.slice(2)) {
  const { port, pageDir } = parseArgs(argv)

  const proof = await assertLoadedModuleIsOnDiskSource()
  const server = createLabServer({ pageDir })

  /**
   * EADDRINUSE is not a harmless "already running" — it is a TRAP, and it cost the author a
   * session.
   *
   * The port was held by a Voice Lab started ten hours earlier, running code from before three
   * fixes. The new process died with a raw stack trace, the OLD one kept answering, and every
   * press produced a failure that had been repaired that morning — including an Ubuntu
   * `apt install` hint on a Mac. The stack trace said nothing about any of that.
   *
   * So: say what happened, say what is actually serving that port, and say how to take it back.
   */
  await new Promise((ok, fail) => {
    server.once('error', (err) => {
      if (err.code !== 'EADDRINUSE') { fail(err); return }
      process.stderr.write(
        `\nPort ${port} is already in use — something else is serving the Voice Lab.\n\n` +
        '  This is worth reading rather than retrying. The process holding the port may be an\n' +
        '  OLDER Voice Lab from an earlier session, still answering with code you have since\n' +
        '  fixed. It will look like the fixes did not work.\n\n' +
        `  See what it is:   lsof -i :${port}\n` +
        `  Take the port:    lsof -ti :${port} | xargs kill\n` +
        `  Or use another:   pnpm voice-lab -- --port ${port + 1}\n\n`
      )
      process.exit(1)
    })
    server.listen(port, HOST, ok)
  })

  const inbox = settingsPathFor()
  process.stdout.write(
    `Voice Lab  http://${HOST}:${server.address().port}\n` +
    `  normalizer  ${proof.source} (source, not dist — checked against ${proof.fixtures} probes)\n` +
    `  stages      ${STAGES.length}\n` +
    `  fixtures    ${join(REPO_ROOT, 'fixtures')}\n` +
    `  settings    ${inbox}${existsSync(inbox) ? '' : '  (not created yet)'}\n` +
    `  page        ${pageDir ?? join(REPO_ROOT, 'voice-lab')}${pageDir ? '   (--page: NOT the committed page)' : ''}\n` +
    '  audio       the BROWSER plays. This process spawns no player and makes no sound.\n'
  )
  return server
}

if (import.meta.main) {
  await main().catch((err) => { process.stderr.write(`voice-lab: ${err.message}\n`); process.exit(1) })
}
