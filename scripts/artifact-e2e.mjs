#!/usr/bin/env node
/**
 * Prove the SHIPPED artifact speaks with the neural backend — or prove it does not.
 *
 * R16-10 found `dist/plugin/main.mjs` contained ZERO occurrences of `PocketSynthProvider` while
 * 975 tests passed and the Voice Lab spoke with neural voices. Every test reached the provider by
 * a path the plugin does not take (PITFALLS P49). The wiring was added and `scripts/build.mjs`
 * now requires the class name to SURVIVE TREE-SHAKING. That is a presence check. This script is
 * the effect check: load the bundle ORCA loads, drive it through a fake host the way
 * `packages/plugin/src/main.test.ts` does, and demand neural audio bytes.
 *
 * THE ASSERTION IS AN EFFECT, NOT A PRESENCE.
 *
 *   PRESENT arm — `modelStatus(modelDir())` is `ready` (the same predicate the plugin uses).
 *                 The chunk's sampleRate must be 24000 (Pocket), not 22050 (macOS `say`),
 *                 and the PCM must be signal, not silence. This script does not look in
 *                 `~/.buzz` and does not stage a marker, then describe that as the product
 *                 (R17-07). Reuse weights with `node scripts/stage-pocket-model.mjs`.
 *   ABSENT arm  — the SAME artifact, model dir empty. Must fall back to the OS floor AND NAME
 *                 the substitution. If both arms produce the same answer, this probe measured
 *                 nothing about Pocket (R16-05's costume).
 *
 * Production wiring is what is under test. No fake provider is injected on either required arm:
 * `activate(orca, { sink, settingsDir, ... })` with the bundle's own `OsSynthProvider` and
 * `PocketSynthProvider`. A diagnostic that forces the OS floor down runs ONLY if the present arm
 * did not speak at 24 kHz, so a "registered but never selected" finding can be told apart from
 * "the bundled class cannot generate".
 *
 * SILENT — P31. The author is at this machine. A capturing sink records buffers; nothing is
 * handed to a player. macOS `say` is invoked with `-o <file>` (never the device). The author's
 * `~/.buzz/models/pocket-tts` is READ-ONLY (R061) and is not a lookup path.
 *
 * Usage:
 *   pnpm probe:artifact                 # both arms against dist/plugin/main.mjs
 *   node scripts/artifact-e2e.mjs --keep
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import {
  mkdtemp, mkdir, rm, readFile, writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = join(ROOT, 'dist/plugin/main.mjs')
const SELF = fileURLToPath(import.meta.url)

const POCKET_RATE = 24_000
const OS_RATE = 22_050
/** Below this, the buffer is silence / a DC click, not speech. R16-08 measured Pocket rms 0.14. */
const SIGNAL_RMS = 0.01
const SIGNAL_PEAK = 0.05

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback
}
const flag = (name) => process.argv.includes(name)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------------- the one predicate (R17-07) */

async function productModelStatus () {
  const { modelStatus, modelDir, modelStatusDetail } = await import(
    pathToFileURL(join(ROOT, 'packages/providers/src/pocket-synth/models.ts')).href
  )
  const status = await modelStatus(modelDir())
  return { status, detail: modelStatusDetail(status) }
}

/* ------------------------------------------------------------------------- WAV → RMS / peak */

function parseWav (buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file')
  }
  let pos = 12
  let fmt = null
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    const body = pos + 8
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      }
    } else if (id === 'data') {
      if (fmt === null) throw new Error('WAV data chunk arrived before its fmt chunk')
      if (fmt.bits !== 16) throw new Error(`only 16-bit PCM WAV is supported, got ${fmt.bits}-bit`)
      if (fmt.channels < 1) throw new Error('WAV declares zero channels')
      const available = Math.min(size, buf.length - body)
      const frames = Math.floor(available / 2 / fmt.channels)
      const samples = new Float32Array(frames)
      for (let i = 0; i < frames; i++) {
        let acc = 0
        for (let c = 0; c < fmt.channels; c++) {
          acc += buf.readInt16LE(body + (i * fmt.channels + c) * 2)
        }
        samples[i] = acc / fmt.channels / 32768
      }
      return { samples, rate: fmt.rate, channels: fmt.channels, bits: fmt.bits }
    }
    pos = body + size + (size % 2)
  }
  throw new Error('WAV has no data chunk')
}

function signalStats (samples) {
  if (samples.length === 0) return { rms: 0, peak: 0, n: 0 }
  let sumSq = 0
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    const a = Math.abs(s)
    if (a > peak) peak = a
    sumSq += s * s
  }
  return { rms: Math.sqrt(sumSq / samples.length), peak, n: samples.length }
}

/* ------------------------------------------------------------------------- capturing sink (P31) */

class CapturingSink {
  chunks = []
  isPlaying = false
  bytesPlayed = 0
  enqueued = 0
  inflight = 0
  async enqueue (chunk) {
    this.inflight++
    try {
      this.chunks.push({
        sampleRate: chunk.sampleRate,
        format: chunk.format,
        channels: chunk.channels,
        data: Buffer.from(chunk.data),
      })
      this.bytesPlayed += chunk.data.length
      this.enqueued++
    } finally {
      this.inflight--
    }
  }
  async stop () { /* nothing is playing */ }
}

function unusableOs () {
  return {
    id: 'os-synth',
    displayName: 'System voice',
    isWarm: false,
    capabilities: {
      streaming: false, offline: true, needsApiKey: false, needsModelDownload: 0,
      licence: 'test', cloning: false, sampleRate: OS_RATE,
    },
    prepare: async () => { throw new Error('diagnostic: OS floor forced down') },
    // eslint-disable-next-line require-yield
    generate: async function * () { throw new Error('unreachable') },
    cancel () {},
    listVoices: async () => [],
  }
}

function fakeOrca (logs, notifications, commands) {
  const settings = {}
  return {
    commands: {
      register (id, fn) { commands.set(id, fn) },
    },
    events: { on () { /* huddle is not under test */ } },
    host: {
      async call (action, params) {
        if (action === 'notifications.show') {
          notifications.push(String(params?.body ?? ''))
          return { delivered: true }
        }
        if (action === 'storage.get') return { value: undefined }
        if (action === 'storage.set') return {}
        if (action === 'settings.get') return { settings }
        if (action === 'settings.set') {
          if (params?.key !== undefined) settings[params.key] = params.value
          return { ok: true }
        }
        return {}
      },
    },
    log (m) { logs.push(String(m)) },
  }
}

async function until (pred, what, capMs) {
  const started = Date.now()
  while (!pred()) {
    if (Date.now() - started > capMs) {
      throw new Error(`gave up waiting for: ${what} (${capMs} ms backstop — this is a HANG, not slowness)`)
    }
    await sleep(25)
  }
}

async function quiet (sink, quietMs, capMs) {
  const started = Date.now()
  let last = sink.enqueued
  let lastAt = Date.now()
  while (Date.now() - lastAt < quietMs) {
    if (Date.now() - started > capMs) {
      throw new Error(`sink never went quiet (${capMs} ms backstop)`)
    }
    await sleep(40)
    if (sink.enqueued !== last || sink.inflight > 0) {
      last = sink.enqueued
      lastAt = Date.now()
    }
  }
}

function parseEngineReady (logs) {
  const line = logs.findLast((l) => l.includes('read-aloud: engine ready ('))
    ?? logs.find((l) => l.includes('no speech engine is available'))
    ?? null
  if (line === null) return { line: null, displayName: null, rung: null }
  const m = /engine ready \((.+), rung=(\w+)\)/.exec(line)
  if (m === null) return { line, displayName: null, rung: null }
  return { line, displayName: m[1], rung: m[2] }
}

function substitutionFrom (logs, notifications) {
  const hay = [...logs, ...notifications]
  // Registry reason when the preferred/requested engine is unavailable:
  //   "<id> was unavailable (...); using <displayName>"
  // Also announced verbatim by activate() when `resolved.status.reason` is set.
  const named = hay.find((l) => /was unavailable/.test(l) && /using /.test(l))
  if (named !== undefined) return named
  const announced = hay.find((l) => /unavailable/.test(l) && /(System voice|os-synth|fallback)/i.test(l))
  return announced ?? null
}

function leakedSay () {
  if (process.platform !== 'darwin') return 0
  const r = spawnSync('pgrep', ['-x', 'say'], { encoding: 'utf8' })
  if (r.status !== 0) return 0
  return r.stdout.trim() === '' ? 0 : r.stdout.trim().split('\n').length
}

/* ------------------------------------------------------------------------- one arm against the bundle */

async function driveArm ({ modelDir, forceOsDown, wavDir, arm }) {
  if (!existsSync(BUNDLE)) {
    throw new Error(`${BUNDLE} is missing. Run pnpm build first — this probe loads the artifact, not the source.`)
  }
  process.env.ORCA_TTS_MODEL_DIR = modelDir

  const isolated = await mkdtemp(join(tmpdir(), `artifact-e2e-${arm}-`))
  const settingsDir = join(isolated, 'settings')
  const projectsDir = join(isolated, 'projects')
  await mkdir(settingsDir)
  await mkdir(projectsDir)

  const logs = []
  const notifications = []
  const commands = new Map()
  const sink = new CapturingSink()
  const orca = fakeOrca(logs, notifications, commands)

  const { default: activate } = await import(pathToFileURL(BUNDLE).href)
  if (typeof activate !== 'function') {
    throw new Error('dist/plugin/main.mjs must default-export activate')
  }

  const options = {
    sink,
    settingsDir,
    projectsDir,
    controlDir: false,
  }
  // Production path: do not pass `provider` or `pocket`. The bundle constructs both.
  if (forceOsDown) options.provider = unusableOs()

  activate(orca, options)

  const t0 = Date.now()
  try {
    await until(
      () => logs.some((l) => l.includes('engine ready (') || l.includes('no speech engine is available')),
      'engine ready (or a named total failure)',
      180_000,
    )
  } catch (err) {
    return summarize({
      arm, forceOsDown, sink, logs, notifications, wavDir, t0,
      error: String(err),
    })
  }

  const ready = parseEngineReady(logs)
  if (ready.displayName === null && logs.some((l) => l.includes('no speech engine is available'))) {
    return summarize({
      arm, forceOsDown, sink, logs, notifications, wavDir, t0,
      error: logs.find((l) => l.includes('no speech engine is available')) ?? 'engine unavailable',
    })
  }

  const selfTest = commands.get('read-aloud.self-test')
  if (typeof selfTest !== 'function') {
    return summarize({
      arm, forceOsDown, sink, logs, notifications, wavDir, t0,
      error: 'read-aloud.self-test was never registered',
    })
  }

  try {
    await selfTest()
    await until(
      () => logs.some((l) => l.includes('read-aloud: self-test')),
      'self-test to log its byte counts',
      180_000,
    )
    await quiet(sink, 400, 60_000)
  } catch (err) {
    return summarize({
      arm, forceOsDown, sink, logs, notifications, wavDir, t0,
      error: String(err),
    })
  }

  return summarize({ arm, forceOsDown, sink, logs, notifications, wavDir, t0, error: null })
}

async function summarize ({ arm, forceOsDown, sink, logs, notifications, wavDir, t0, error }) {
  const ready = parseEngineReady(logs)
  const sampleRates = sink.chunks.map((c) => c.sampleRate)
  const bytes = sink.chunks.reduce((n, c) => n + c.data.length, 0)

  let wavRate = null
  let rms = 0
  let peak = 0
  let samples = 0
  let wavPath = null
  let parseError = null
  const pcm = []
  for (const chunk of sink.chunks) {
    if (chunk.format !== 'wav' && chunk.format !== undefined) continue
    try {
      const parsed = parseWav(chunk.data)
      if (wavRate === null) wavRate = parsed.rate
      pcm.push(parsed.samples)
    } catch (err) {
      parseError = String(err)
    }
  }
  if (pcm.length > 0) {
    let n = 0
    for (const s of pcm) n += s.length
    const joined = new Float32Array(n)
    let o = 0
    for (const s of pcm) { joined.set(s, o); o += s.length }
    const st = signalStats(joined)
    rms = st.rms
    peak = st.peak
    samples = st.n
    wavPath = join(wavDir, `${arm}.wav`)
    await writeFile(wavPath, sink.chunks[0].data)
  }

  const relevantLogs = logs.filter((l) =>
    /engine ready|unavailable|self-test|Pocket|System voice|substitution|using /.test(l))

  return {
    arm,
    forceOsDown: Boolean(forceOsDown),
    elapsedMs: Date.now() - t0,
    engineReady: ready.line,
    displayName: ready.displayName,
    rung: ready.rung,
    sampleRates,
    chunkSampleRate: sampleRates[0] ?? null,
    wavRate,
    chunkCount: sink.chunks.length,
    bytes,
    rms,
    peak,
    samples,
    signal: rms >= SIGNAL_RMS && peak >= SIGNAL_PEAK,
    substitution: substitutionFrom(logs, notifications),
    wavPath,
    parseError,
    error,
    logs: relevantLogs,
    notifications: notifications.filter((n) => n.length > 0),
    leakedSayAfter: leakedSay(),
  }
}

/* ------------------------------------------------------------------------- child entry */

if (flag('--child')) {
  const arm = arg('--arm', 'unknown')
  const modelDir = arg('--model-dir')
  const out = arg('--out')
  const wavDir = arg('--wav-dir', dirname(out ?? tmpdir()))
  if (modelDir === null || out === null) {
    console.error('child requires --arm --model-dir --out')
    process.exit(3)
  }
  try {
    const result = await driveArm({
      modelDir,
      forceOsDown: flag('--force-os-down'),
      wavDir,
      arm,
    })
    await writeFile(out, JSON.stringify(result, null, 2))
    process.exit(0)
  } catch (err) {
    const fail = { arm, error: String(err), engineReady: null, chunkSampleRate: null }
    await writeFile(out, JSON.stringify(fail, null, 2)).catch(() => {})
    console.error(err)
    process.exit(3)
  }
}

/* ------------------------------------------------------------------------- parent: two arms + verdict */

function spawnArm (args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SELF, '--child', ...args], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: process.env,
    })
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })
}

function failRows (present, absent) {
  const rows = []
  if (present.error) rows.push(`PRESENT error: ${present.error}`)
  if (present.chunkSampleRate !== POCKET_RATE) {
    rows.push(
      `PRESENT chunk.sampleRate is ${present.chunkSampleRate}, want ${POCKET_RATE} (Pocket), ` +
      `not ${OS_RATE} (macOS OS). engine=${JSON.stringify(present.displayName)} rung=${present.rung}`,
    )
  }
  if (present.signal !== true) {
    rows.push(
      `PRESENT audio is not signal: rms=${present.rms?.toFixed?.(4) ?? present.rms} ` +
      `peak=${present.peak?.toFixed?.(4) ?? present.peak} (need rms>=${SIGNAL_RMS} peak>=${SIGNAL_PEAK})`,
    )
  }
  if (absent.error) rows.push(`ABSENT error: ${absent.error}`)
  if (absent.chunkSampleRate !== OS_RATE) {
    rows.push(
      `ABSENT chunk.sampleRate is ${absent.chunkSampleRate}, want ${OS_RATE} (OS floor)`,
    )
  }
  if (absent.substitution === null) {
    rows.push(
      'ABSENT did not NAME the substitution. Expected a log/announcement matching ' +
      '"was unavailable" + "using <floor>". engine=' +
      JSON.stringify(absent.displayName) + ' rung=' + absent.rung,
    )
  }
  if (
    present.chunkSampleRate === absent.chunkSampleRate &&
    present.displayName === absent.displayName &&
    present.rung === absent.rung
  ) {
    rows.push(
      `BOTH ARMS PRODUCED THE SAME ANSWER (sampleRate=${present.chunkSampleRate} ` +
      `engine=${JSON.stringify(present.displayName)} rung=${present.rung}). ` +
      'The probe cannot tell Pocket from the OS floor — the plugin never consulted the model dir.',
    )
  }
  return rows
}

function printArm (label, r) {
  console.log(`\n--- ${label} ---`)
  console.log(`engineReady:  ${r.engineReady ?? '(none)'}`)
  console.log(`displayName:  ${r.displayName}`)
  console.log(`rung:         ${r.rung}`)
  console.log(`chunk.rate:   ${r.chunkSampleRate}  (wav header ${r.wavRate})`)
  console.log(`chunks/bytes: ${r.chunkCount} / ${r.bytes}`)
  console.log(`rms/peak/n:   ${Number(r.rms).toFixed(4)} / ${Number(r.peak).toFixed(4)} / ${r.samples}`)
  console.log(`signal:       ${r.signal}`)
  console.log(`substitution: ${r.substitution ?? '(none named)'}`)
  console.log(`elapsedMs:    ${r.elapsedMs}`)
  if (r.wavPath) console.log(`wav:          ${r.wavPath}`)
  if (r.error) console.log(`error:        ${r.error}`)
  for (const l of r.logs ?? []) console.log(`  [log] ${l}`)
}

async function main () {
  console.log('Artifact e2e — load dist/plugin/main.mjs, speak, measure. P31 silent.\n')

  if (!existsSync(BUNDLE)) {
    console.error(`FAIL: ${BUNDLE} missing. Run pnpm build.`)
    process.exit(3)
  }

  const bundleText = readFileSync(BUNDLE, 'utf8')
  const pocketPresent = bundleText.includes('PocketSynthProvider')
  console.log(`bundle: ${BUNDLE}`)
  console.log(`PocketSynthProvider in bundle (presence, not effect): ${pocketPresent ? 'yes' : 'NO — R16-10 regress'}`)

  const sayBefore = leakedSay()
  if (sayBefore > 0) {
    console.error(`FAIL: ${sayBefore} leaked say process(es) already running (P42). Not measuring on a dirty machine.`)
    process.exit(3)
  }

  const runDir = await mkdtemp(join(tmpdir(), 'artifact-e2e-run-'))
  const keep = flag('--keep')
  const staged = []
  const cleanup = async () => {
    if (keep) {
      console.log(`--keep: leaving ${runDir}`)
      return
    }
    for (const d of staged) await rm(d, { recursive: true, force: true }).catch(() => {})
    await rm(runDir, { recursive: true, force: true }).catch(() => {})
  }

  try {
    const emptyDir = await mkdtemp(join(tmpdir(), 'artifact-e2e-empty-'))
    staged.push(emptyDir)

    const product = await productModelStatus()
    let presentDir = null
    if (product.status.kind !== 'ready') {
      console.log(`Pocket product cache is ${product.status.kind}: ${product.detail}`)
      console.log('PRESENT arm INCONCLUSIVE. Reuse an existing download with: node scripts/stage-pocket-model.mjs')
    } else {
      presentDir = product.status.dir
      console.log(`product cache ready at ${presentDir} (modelStatus.kind=ready)`)
    }

    const absentOut = join(runDir, 'absent.json')
    console.log('\nArm ABSENT — empty model dir, production wiring.')
    const absentCode = await spawnArm([
      '--arm', 'absent', '--model-dir', emptyDir, '--out', absentOut, '--wav-dir', runDir,
    ])
    if (!existsSync(absentOut)) {
      console.error(`FAIL: absent arm wrote no result (exit ${absentCode})`)
      await cleanup()
      process.exit(3)
    }
    const absent = JSON.parse(await readFile(absentOut, 'utf8'))
    printArm('ABSENT (production, no model)', absent)

    let present = null
    if (presentDir !== null) {
      const presentOut = join(runDir, 'present.json')
      console.log('\nArm PRESENT — staged Pocket model, production wiring.')
      const presentCode = await spawnArm([
        '--arm', 'present', '--model-dir', presentDir, '--out', presentOut, '--wav-dir', runDir,
      ])
      if (!existsSync(presentOut)) {
        console.error(`FAIL: present arm wrote no result (exit ${presentCode})`)
        await cleanup()
        process.exit(3)
      }
      present = JSON.parse(await readFile(presentOut, 'utf8'))
      printArm('PRESENT (production, model staged)', present)
    }

    if (present === null) {
      console.log('\nINCONCLUSIVE: no Pocket model on this machine, so the neural arm could not run.')
      console.log('The absent arm is recorded above. This is not a pass.')
      await cleanup()
      process.exit(2)
    }

    const rows = failRows(present, absent)
    const productionPass = rows.length === 0

    if (!productionPass && present.chunkSampleRate !== POCKET_RATE && presentDir !== null) {
      const diagOut = join(runDir, 'diagnostic.json')
      console.log('\nDiagnostic — OS floor forced down, so the bundled PocketSynthProvider is the only engine that can prepare.')
      await spawnArm([
        '--arm', 'diagnostic', '--model-dir', presentDir, '--out', diagOut, '--wav-dir', runDir,
        '--force-os-down',
      ])
      if (existsSync(diagOut)) {
        const diag = JSON.parse(await readFile(diagOut, 'utf8'))
        printArm('DIAGNOSTIC (OS forced down, model staged)', diag)
        if (diag.chunkSampleRate === POCKET_RATE && diag.signal === true) {
          console.log(
            '\nFINDING (selection, not generation): the bundled PocketSynthProvider CAN produce ' +
            `${POCKET_RATE} Hz signal (rms=${Number(diag.rms).toFixed(4)} peak=${Number(diag.peak).toFixed(4)}) ` +
            'when it is the engine that prepares. Production `registry.resolve()` never selects it.',
          )
        } else {
          console.log(
            '\nFINDING (generation): even with the OS floor forced down, the bundle did not produce ' +
            `${POCKET_RATE} Hz signal. chunk.sampleRate=${diag.chunkSampleRate} error=${diag.error}`,
          )
        }
      }
    }

    console.log('\n=== verdict ===')
    if (productionPass) {
      console.log(`PASS: PRESENT spoke at ${POCKET_RATE} Hz with signal; ABSENT named the OS substitution at ${OS_RATE} Hz.`)
      console.log(`PRESENT rms=${Number(present.rms).toFixed(4)} peak=${Number(present.peak).toFixed(4)}`)
      console.log(`ABSENT  substitution: ${absent.substitution}`)
      await cleanup()
      process.exit(0)
    }

    console.log('FAIL: the shipped artifact did not speak with the neural backend on the production path.')
    for (const row of rows) console.log(`  - ${row}`)
    await cleanup()
    process.exit(1)
  } catch (err) {
    console.error(err)
    await cleanup()
    process.exit(3)
  }
}

await main()
