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
 *   ABSENT arm  — the SAME artifact, model dir empty. Must fall back to the OS floor AND NAME
 *                 the substitution. Needs no model. Failures are ALWAYS exit 1 (R18-02).
 *                 If both arms produce the same answer, this probe measured nothing about
 *                 Pocket (R16-05's costume).
 *   PRESENT arm — `modelStatus(modelDir())` is `ready` (the same predicate the plugin uses).
 *                 The chunk's sampleRate must be 24000 (Pocket), not 22050 (macOS `say`),
 *                 and the PCM must be signal, not silence. This script does not look in
 *                 `~/.buzz` and does not stage a marker, then describe that as the product
 *                 (R17-07). Reuse weights with `node scripts/stage-pocket-model.mjs`.
 *                 If the cache is not `ready`, PRESENT does not run. `absent` is exit 2
 *                 (INCONCLUSIVE — only this arm). `incomplete` / `stale` is exit 1: a
 *                 broken cache is a defect, not a skip.
 *
 * Exit codes:
 *   0  PRESENT spoke at 24 kHz; ABSENT named the OS substitution
 *   1  a real defect (ABSENT failed, cache broken, PRESENT failed)
 *   2  ONLY "the PRESENT arm could not run" (no ready model). ABSENT already passed.
 *   3  harness (missing bundle, dirty machine, child wrote no JSON)
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
 * P31 is asserted, not hoped for (R18-03). `pgrep -x say` is P42 (an orphan still running);
 * it cannot tell `say -o` from bare `say`, and a completed bare `say` is already gone. Each
 * `--child` re-execs under `scripts/ci/no-audio-recorder.mjs`, which records argv at the
 * spawn call, and `p31Rows` demands leftover count 0 AND no `say` without `-o`. `--prove-p31`
 * shows that check going RED on a PATH-stubbed bare `say` (the real binary is never reached)
 * and staying GREEN on `say -o`.
 *
 * Usage:
 *   pnpm probe:artifact                 # both arms against dist/plugin/main.mjs
 *   node scripts/artifact-e2e.mjs --keep
 *   node scripts/artifact-e2e.mjs --prove-p31
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import {
  mkdtemp, mkdir, rm, readFile, writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { judge, OS_RATE, POCKET_RATE } from './artifact-score.mjs'
import { spawnBase, tokenize, unwrapSpawn } from './ci/spawn-argv.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = join(ROOT, 'dist/plugin/main.mjs')
const SELF = fileURLToPath(import.meta.url)
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

/**
 * P42 dirty-machine check: ANY leftover `say`, including a healthy `say -o` still
 * writing. Used at the START of the parent. Not a P31 leftover check (R19-06).
 */
export function leakedSayRaw () {
  if (process.platform !== 'darwin') return 0
  const r = spawnSync('pgrep', ['-x', 'say'], { encoding: 'utf8' })
  if (r.status !== 0) return 0
  return r.stdout.trim() === '' ? 0 : r.stdout.trim().split('\n').length
}

/**
 * A leftover `say` whose argv writes a file (`-o`) or lists voices (`-v ?`) is
 * the path P31 requires, not an orphan. Round 19: two consecutive healthy ABSENT
 * runs reported leakedSayAfter=1 because `pgrep -x say` is red for an in-flight
 * `say -o`. Classify leftover argv the same way as a spawn.
 *
 * @param {string} psArgsLine  `ps -o args=` for one PID
 */
export function leftoverSayIsOrphan (psArgsLine) {
  const tokens = tokenize(psArgsLine)
  if (tokens.length === 0) return false
  if (spawnBase(tokens[0]) !== 'say') return false
  return classifySayArgs(tokens.slice(1)) !== null
}

/** P31 leftover count: leftover BARE `say` only. `say -o` still writing is not this. */
export function leakedSayOrphans () {
  if (process.platform !== 'darwin') return 0
  const r = spawnSync('pgrep', ['-x', 'say'], { encoding: 'utf8' })
  if (r.status !== 0) return 0
  const pids = r.stdout.trim() === '' ? [] : r.stdout.trim().split('\n')
  let orphans = 0
  for (const pid of pids) {
    const ps = spawnSync('ps', ['-o', 'args=', '-p', pid], { encoding: 'utf8' })
    if (leftoverSayIsOrphan((ps.stdout ?? '').trim())) orphans++
  }
  return orphans
}

/** @deprecated use leakedSayOrphans (P31) or leakedSayRaw (P42 start-of-run) */
export function leakedSay () {
  return leakedSayOrphans()
}

/**
 * P31: `say -o <file>` writes a WAV and never opens the device. Bare `say "text"` speaks.
 * `say -v '?'` lists voices to stdout. Restated from voice-lab-ci.mjs `classifySpawn`'s
 * `say` branch — that module starts the Lab on import, so we cannot import the judge.
 */
export function classifySayArgs (args) {
  const argv = (args ?? []).map(String)
  const writesFile = argv.includes('-o')
  const listsVoices = argv[argv.indexOf('-v') + 1] === '?'
  if (!writesFile && !listsVoices) {
    return { violation: 'aloud', why: 'macOS `say` with no -o <file> speaks through the audio device' }
  }
  return null
}

export function readSpawnLog (logPath) {
  if (typeof logPath !== 'string' || logPath.length === 0 || !existsSync(logPath)) return []
  return readFileSync(logPath, 'utf8').split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l))
}

export function auditSaySpawns (entries) {
  const says = []
  const violations = []
  for (const e of entries ?? []) {
    if (e.api === 'recorder') continue
    const decoded = unwrapSpawn(e.cmd, e.args ?? [])
    if (spawnBase(decoded.cmd) !== 'say') continue
    const rec = { cmd: decoded.cmd, args: decoded.args, api: e.api }
    says.push(rec)
    const v = classifySayArgs(rec.args)
    if (v !== null) violations.push({ ...v, cmd: rec.cmd, args: rec.args })
  }
  return { sayCount: says.length, says, violations }
}

export function recorderLoadedFrom (entries) {
  return (entries ?? []).some((e) => e.api === 'recorder' && e.cmd === 'loaded')
}

export function spawnLogPath (arm, wavDir) {
  return join(wavDir, `${arm}-spawns.ndjson`)
}

export function spawnFields (logPath) {
  const entries = readSpawnLog(logPath)
  const audit = auditSaySpawns(entries)
  return {
    spawnLog: logPath ?? null,
    saySpawns: audit.says,
    spawnViolations: audit.violations,
    recorderLoaded: recorderLoadedFrom(entries),
  }
}

/**
 * P31 argv (no bare `say`) AND a leftover BARE `say` (R19-06: `say -o` still
 * writing is not this). `pgrep -x say` is P42 at parent START (exit 3); it cannot
 * be the P31 leftover check, because a healthy in-flight `say -o` is red for it.
 *
 * R19-05: if the recorder silently failed to load, these rows must NOT be able
 * to report green. `recorderLoaded` is the load-proof; it does not depend on
 * darwin OS-rate audio.
 */
export function p31Rows (label, r, platform = process.platform) {
  const rows = []
  if (r == null) return rows
  if (r.recorderLoaded !== true) {
    rows.push(
      `${label} P31 recorder did not load (recorderLoaded=${JSON.stringify(r.recorderLoaded)}). ` +
      'An empty --import module that patches nothing cannot report green (R19-05).',
    )
  }
  if (typeof r.leakedSayAfter !== 'number') {
    rows.push(`${label} omitted leakedSayAfter — the leftover-say detector is absent`)
  } else if (r.leakedSayAfter !== 0) {
    rows.push(
      `${label} leakedSayAfter=${r.leakedSayAfter} (want 0). ` +
      'A leftover BARE `say` (not `say -o`) serialises synthesis and speaks (P31/P42).',
    )
  }
  if (!Array.isArray(r.spawnViolations)) {
    rows.push(`${label} omitted spawnViolations — the P31 argv recorder is absent`)
  } else {
    for (const v of r.spawnViolations) {
      rows.push(`${label} P31: spawned ${v.cmd} ${JSON.stringify(v.args)} — ${v.why}`)
    }
  }
  if (platform === 'darwin' && r.chunkSampleRate === OS_RATE && (r.bytes ?? 0) > 0) {
    const n = (r.saySpawns ?? []).length
    if (n === 0) {
      rows.push(
        `${label} produced OS-rate audio (${r.bytes} bytes) but recorded zero say spawns — ` +
        'the P31 recorder is blind (a check that cannot fail)',
      )
    }
  }
  return rows
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
    ...spawnFields(process.env.VOICE_LAB_SPAWN_LOG),
  }
}

/* ------------------------------------------------------------------------- child entry */

function reexecUnderRecorderIfNeeded () {
  if (typeof process.env.VOICE_LAB_SPAWN_LOG === 'string' && process.env.VOICE_LAB_SPAWN_LOG.length > 0) {
    return
  }
  const arm = arg('--arm', 'unknown')
  const out = arg('--out')
  const wavDir = arg('--wav-dir', dirname(out ?? tmpdir()))
  const spawnLog = spawnLogPath(arm, wavDir)
  const recorder = pathToFileURL(join(ROOT, 'scripts/ci/no-audio-recorder.mjs')).href
  const r = spawnSync(process.execPath, ['--import', recorder, SELF, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, VOICE_LAB_SPAWN_LOG: spawnLog },
  })
  process.exit(r.status ?? 1)
}

async function runChild () {
  reexecUnderRecorderIfNeeded()
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
    const fail = {
      arm, error: String(err), engineReady: null, chunkSampleRate: null,
      leakedSayAfter: leakedSay(),
      ...spawnFields(process.env.VOICE_LAB_SPAWN_LOG),
    }
    await writeFile(out, JSON.stringify(fail, null, 2)).catch(() => {})
    console.error(err)
    process.exit(3)
  }
}

/* ------------------------------------------------------------------------- parent: two arms + verdict */

function spawnArm (args) {
  const armIdx = args.indexOf('--arm')
  const wavIdx = args.indexOf('--wav-dir')
  const arm = armIdx >= 0 ? (args[armIdx + 1] ?? 'unknown') : 'unknown'
  const wavDir = wavIdx >= 0 ? (args[wavIdx + 1] ?? tmpdir()) : tmpdir()
  const spawnLog = spawnLogPath(arm, wavDir)
  const recorder = pathToFileURL(join(ROOT, 'scripts/ci/no-audio-recorder.mjs')).href
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', recorder, SELF, '--child', ...args], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, VOICE_LAB_SPAWN_LOG: spawnLog },
    })
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })
}

function attachSpawnAudit (r, logPath) {
  const fields = spawnFields(logPath)
  r.spawnLog = fields.spawnLog
  r.saySpawns = fields.saySpawns
  r.spawnViolations = fields.spawnViolations
  return r
}

export function applyP31 (decision, arms, platform = process.platform) {
  const extra = []
  for (const { label, r } of arms) extra.push(...p31Rows(label, r, platform))
  if (platform === 'darwin') {
    const leftover = leakedSayOrphans()
    if (leftover > 0) {
      extra.push(`parent re-pgrep: ${leftover} bare say process(es) still running (P31 orphan, not say -o)`)
    }
  }
  if (extra.length === 0) return decision
  return {
    exit: 1,
    rows: [...extra, ...decision.rows],
    summary: `FAIL: ${extra[0]}`,
  }
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
  console.log(`leakedSayAfter: ${r.leakedSayAfter}`)
  console.log(`recorderLoaded: ${r.recorderLoaded}`)
  console.log(`say spawns:   ${(r.saySpawns ?? []).length}`)
  for (const s of r.saySpawns ?? []) console.log(`  say ${JSON.stringify(s.args)}`)
  if ((r.spawnViolations ?? []).length > 0) {
    console.log(`P31 VIOLATIONS: ${r.spawnViolations.length}`)
    for (const v of r.spawnViolations) console.log(`  ${v.why}: ${v.cmd} ${JSON.stringify(v.args)}`)
  }
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

  const sayBefore = leakedSayRaw()
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
    if (product.status.kind === 'ready') {
      presentDir = product.status.dir
      console.log(`product cache ready at ${presentDir} (modelStatus.kind=ready)`)
    } else if (product.status.kind === 'absent') {
      console.log(`Pocket product cache is absent: ${product.detail}`)
      console.log('PRESENT arm cannot run. Reuse an existing download with: node scripts/stage-pocket-model.mjs')
    } else {
      // incomplete / stale: a cache that cannot speak. Scored as exit 1 after ABSENT.
      console.log(`Pocket product cache is ${product.status.kind}: ${product.detail}`)
      console.log('PRESENT will not run against a broken cache. This is a defect, not a skip.')
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
    const absent = attachSpawnAudit(
      JSON.parse(await readFile(absentOut, 'utf8')),
      spawnLogPath('absent', runDir),
    )
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
      present = attachSpawnAudit(
        JSON.parse(await readFile(presentOut, 'utf8')),
        spawnLogPath('present', runDir),
      )
      printArm('PRESENT (production, model staged)', present)
    }

    // R18-02: score ABSENT first, always. Exit 2 is ONLY "PRESENT could not run".
    // Swallowing nameSubstitution used to print `substitution: (none named)` and
    // still EXIT 2 because this used to `process.exit(2)` before failRows().
    const decision = applyP31(
      judge({
        productKind: product.status.kind,
        productDetail: product.detail,
        present,
        absent,
      }),
      [
        { label: 'ABSENT', r: absent },
        { label: 'PRESENT', r: present },
      ],
    )
    const productionPass = decision.exit === 0

    if (decision.exit === 1 && present !== null && present.chunkSampleRate !== POCKET_RATE && presentDir !== null) {
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
    console.log(decision.summary)
    if (productionPass) {
      console.log(`PRESENT rms=${Number(present.rms).toFixed(4)} peak=${Number(present.peak).toFixed(4)}`)
      console.log(`ABSENT  substitution: ${absent.substitution}`)
    }
    for (const row of decision.rows) console.log(`  - ${row}`)
    await cleanup()
    process.exit(decision.exit)
  } catch (err) {
    console.error(err)
    await cleanup()
    process.exit(3)
  }
}

/**
 * Negative control for R18-03. A PATH stub named `say` exits 0 and never reaches
 * `/usr/bin/say`, so this does not open the audio device (P31). The recorder still
 * sees argv, which is the property under test.
 */
export async function proveP31 () {
  const dir = await mkdtemp(join(tmpdir(), 'artifact-e2e-p31-'))
  const recorder = pathToFileURL(join(ROOT, 'scripts/ci/no-audio-recorder.mjs')).href
  const stub = join(dir, process.platform === 'win32' ? 'say.cmd' : 'say')
  await writeFile(stub, process.platform === 'win32' ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const pathWithStub = `${dir}${delimiter}${process.env.PATH ?? ''}`

  const recordScript = async (body, name) => {
    const log = join(dir, `${name}.ndjson`)
    const decoy = join(dir, `${name}.mjs`)
    await writeFile(decoy, body)
    spawnSync(process.execPath, ['--import', recorder, decoy], {
      env: { ...process.env, VOICE_LAB_SPAWN_LOG: log, PATH: pathWithStub },
      encoding: 'utf8',
      timeout: 8_000,
      killSignal: 'SIGKILL',
    })
    return readSpawnLog(log)
  }
  const record = async (args, name) => recordScript(
    `import { spawnSync } from 'node:child_process'\nspawnSync('say', ${JSON.stringify(args)}, { stdio: 'ignore' })\n`,
    name,
  )

  const cases = []
  const bareLog = await record(['hello there'], 'bare')
  const bareAudit = auditSaySpawns(bareLog)
  cases.push({
    name: 'RED: recorded bare `say` (PATH stub, device never opened)',
    ok: bareAudit.violations.length > 0,
    detail: bareAudit,
  })

  const fileLog = await record(['-o', join(dir, 'out.wav'), '--data-format=LEI16@22050', '--', 'hello'], 'file')
  const fileAudit = auditSaySpawns(fileLog)
  cases.push({
    name: 'GREEN: recorded `say -o` is not a P31 violation',
    ok: fileAudit.violations.length === 0 && fileAudit.sayCount > 0,
    detail: fileAudit,
  })

  const execLog = await recordScript(
    `import { execSync } from 'node:child_process'\nexecSync('say hello there')\n`,
    'exec',
  )
  const execAudit = auditSaySpawns(execLog)
  cases.push({
    name: 'RED: exec(\'say hello there\') is classified as bare say (R19-05)',
    ok: execAudit.sayCount === 1 && execAudit.violations.length === 1,
    detail: execAudit,
  })

  const mixedLog = await recordScript(
    `import { spawnSync, execSync } from 'node:child_process'\n` +
    `spawnSync('say', ['-o', ${JSON.stringify(join(dir, 'mixed.wav'))}, '--', 'hello'], { stdio: 'ignore' })\n` +
    `execSync('say hello there')\n`,
    'mixed',
  )
  const mixedAudit = auditSaySpawns(mixedLog)
  cases.push({
    name: 'RED: mixed spawn(-o) + exec(bare) still flags the exec (R19-05)',
    ok: mixedAudit.sayCount === 2 && mixedAudit.violations.length === 1,
    detail: mixedAudit,
  })

  const shLog = await recordScript(
    `import { spawnSync } from 'node:child_process'\n` +
    `spawnSync('sh', ['-c', 'say hello there'], { stdio: 'ignore' })\n`,
    'shc',
  )
  const shAudit = auditSaySpawns(shLog)
  cases.push({
    name: 'RED: sh -c \'say hello\' is classified as bare say (R19-05)',
    ok: shAudit.sayCount === 1 && shAudit.violations.length === 1,
    detail: shAudit,
  })

  const grand = join(dir, 'grand-child.mjs')
  await writeFile(
    grand,
    `import { spawnSync } from 'node:child_process'\n` +
    `spawnSync('say', ['hello from grandchild'], { stdio: 'ignore' })\n`,
  )
  const grandLog = await recordScript(
    `import { spawnSync } from 'node:child_process'\n` +
    `spawnSync(process.execPath, [${JSON.stringify(grand)}], { stdio: 'ignore', timeout: 5000, killSignal: 'SIGKILL' })\n`,
    'grand-parent',
  )
  const grandAudit = auditSaySpawns(grandLog)
  cases.push({
    name: 'RED: grandchild spawn(say) is visible (R19-05 --import inject on node spawn)',
    ok: grandAudit.sayCount >= 1 && grandAudit.violations.length >= 1,
    detail: grandAudit,
  })

  const emptyMod = join(dir, 'empty-import.mjs')
  await writeFile(emptyMod, 'void 0\n')
  const emptyLog = join(dir, 'empty.ndjson')
  const emptyDecoy = join(dir, 'empty-decoy.mjs')
  await writeFile(emptyDecoy, 'void 0\n')
  spawnSync(process.execPath, ['--import', pathToFileURL(emptyMod).href, emptyDecoy], {
    env: { ...process.env, VOICE_LAB_SPAWN_LOG: emptyLog, PATH: pathWithStub },
    encoding: 'utf8',
  })
  const emptyEntries = readSpawnLog(emptyLog)
  const emptyLoaded = recorderLoadedFrom(emptyEntries)
  const emptyRows = p31Rows('ABSENT', {
    leakedSayAfter: 0,
    spawnViolations: [],
    saySpawns: [],
    recorderLoaded: emptyLoaded,
    chunkSampleRate: OS_RATE,
    bytes: 1000,
  }, 'linux')
  const emptyDecision = applyP31(
    { exit: 2, rows: [], summary: 'INCONCLUSIVE' },
    [{ label: 'ABSENT', r: {
      leakedSayAfter: 0, spawnViolations: [], saySpawns: [], recorderLoaded: emptyLoaded,
    } }],
    'linux',
  )
  cases.push({
    name: 'RED: empty --import cannot report P31 green on linux (R19-05)',
    ok: emptyLoaded === false && emptyRows.length > 0 && emptyDecision.exit === 1,
    detail: { emptyLoaded, emptyRows, exit: emptyDecision.exit },
  })

  const leakRows = p31Rows('ABSENT', {
    leakedSayAfter: 99,
    spawnViolations: [],
    saySpawns: [{ cmd: 'say', args: ['-o', '/tmp/x.wav'] }],
    recorderLoaded: true,
  })
  cases.push({
    name: 'RED: leakedSayAfter=99 is now read (the R18-03 mutant)',
    ok: leakRows.some((row) => row.includes('leakedSayAfter=99')),
    detail: leakRows,
  })

  const cleanRows = p31Rows('ABSENT', {
    leakedSayAfter: 0,
    spawnViolations: [],
    saySpawns: [{ cmd: 'say', args: ['-o', '/tmp/x.wav', '--', 'hello'] }],
    recorderLoaded: true,
    chunkSampleRate: OS_RATE,
    bytes: 1000,
  }, 'darwin')
  cases.push({
    name: 'GREEN: leftover 0 + say -o + recorder loaded produces no P31 rows',
    ok: cleanRows.length === 0,
    detail: cleanRows,
  })

  cases.push({
    name: 'GREEN: leftover say -o argv is not an orphan (R19-06)',
    ok: leftoverSayIsOrphan('say -o /tmp/x.wav -- hello') === false,
    detail: leftoverSayIsOrphan('say -o /tmp/x.wav -- hello'),
  })
  cases.push({
    name: 'RED: leftover bare say argv is an orphan (R19-06)',
    ok: leftoverSayIsOrphan('say hello there') === true,
    detail: leftoverSayIsOrphan('say hello there'),
  })

  const leakDecision = applyP31(
    { exit: 2, rows: [], summary: 'INCONCLUSIVE' },
    [{ label: 'ABSENT', r: { leakedSayAfter: 99, spawnViolations: [], saySpawns: [], recorderLoaded: true } }],
    'linux',
  )
  cases.push({
    name: 'RED: applyP31 turns exit 2 into exit 1 when leakedSayAfter is 99',
    ok: leakDecision.exit === 1 && leakDecision.rows.some((row) => row.includes('leakedSayAfter=99')),
    detail: leakDecision,
  })

  const loadedOnLinux = p31Rows('ABSENT', {
    leakedSayAfter: 0,
    spawnViolations: [],
    saySpawns: [{ cmd: 'say', args: ['-v', '?'] }],
    recorderLoaded: true,
  }, 'linux')
  cases.push({
    name: 'GREEN: recorderLoaded + say -v ? is enough on linux (no darwin OS-rate)',
    ok: loadedOnLinux.length === 0,
    detail: loadedOnLinux,
  })

  console.log('\n=== R18-03 P31 prove ===\n')
  let allOk = true
  for (const c of cases) {
    console.log(`  ${c.ok ? 'ok' : 'FAILED'}  — ${c.name}`)
    if (!c.ok) {
      allOk = false
      console.log(`     detail: ${JSON.stringify(c.detail)}`)
    }
  }
  await rm(dir, { recursive: true, force: true })
  if (!allOk) {
    console.error('\nP31 guard could not be shown to fail in both directions.')
    return 1
  }
  console.log('\nP31: bare `say` goes RED, `say -o` stays GREEN, leakedSayAfter=99 is read.\n')
  return 0
}

if (import.meta.main) {
  if (flag('--child')) await runChild()
  else if (flag('--prove-p31')) process.exit(await proveP31())
  else await main()
}
