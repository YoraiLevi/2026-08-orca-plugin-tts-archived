#!/usr/bin/env node
/**
 * Voice Lab CI harness — Job J15. Runs on macOS, Linux and Windows.
 *
 * WHAT THIS PROVES, AND WHY EACH ASSERTION IS SHAPED THE WAY IT IS
 *
 * 1. `/normalize` agrees with the LIBRARY. The expected value is `normalize()` imported here,
 *    in this process, from `packages/core/src/normalizer/index.ts`. It is never the server's own
 *    output: a server compared against itself always agrees, which is a check that cannot fail
 *    (PITFALLS **P33**, constitution principle V).
 * 2. The stage ladder is DERIVED from the normalizer source, not hardcoded. `15` in a test stops
 *    checking anything the moment someone adds a sixteenth transform; the derived list also
 *    catches a REORDER, which a count cannot.
 * 3. The server loaded SOURCE, not `dist/` — asserted from its own startup banner, plus a
 *    negative control that hands `assertSourceModule()` a `dist/` URL and demands a throw.
 *    (P17's neighbourhood: a stale build makes the listener tune a normalizer that is not the
 *    one that ships.)
 * 4. The server binds 127.0.0.1 and NOT 0.0.0.0 — proved by connecting from this machine's own
 *    non-loopback address and requiring the connection to be refused. Loopback must still answer,
 *    or the probe is passing because the server is down.
 * 5. **No audio device was opened and no player was spawned.** Observed by wrapping
 *    `child_process` from outside the process under test (`no-audio-recorder.mjs`), never by
 *    grepping a log the server itself wrote. `--prove-guard` shows the guard going red.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * - It does not install a synthesizer on Linux. A stock runner has none (PITFALLS **P25**), so
 *   `/speak` there returns 503 or the `spoke-elsewhere` rung, and this asserts the CORRECT
 *   FAILURE — the provider's own error text and its install remedy. Installing espeak-ng would
 *   test a machine no user has and would hide the rung most Linux users actually land on.
 * - It does not gate the two-second latency budget. Spec **FR-108**: CI runners have no audio
 *   device, so a latency threshold here would be a permanently-green light. It is reported as
 *   not-run WITH ITS REASON (**FR-107**) and measured manually with `pnpm bench:latency`.
 */
import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { readFileSync, existsSync } from 'node:fs'
import { networkInterfaces, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const NORMALIZER_SRC = join(REPO_ROOT, 'packages/core/src/normalizer/index.ts')
const RECORDER = join(REPO_ROOT, 'scripts/ci/no-audio-recorder.mjs')
const SERVER = join(REPO_ROOT, 'scripts/voice-lab.mjs')
const FIXTURES = join(REPO_ROOT, 'fixtures')

/* ============================================================ the report (spec FR-107)
 * Every probe is either RAN or NOT-RUN WITH A REASON. A probe that is neither is a silent
 * omission, and this exits non-zero on it — "we didn't check that" must never look like green.
 */
const probes = []
const ran = (id, detail) => { probes.push({ id, ran: true, detail }); console.log(`  PASS  ${id}  ${detail}`) }
const notRun = (id, reason) => { probes.push({ id, ran: false, reason }); console.log(`  SKIP  ${id}  not run: ${reason}`) }
const failures = []
const fail = (id, why) => { failures.push({ id, why }); probes.push({ id, ran: true, detail: 'FAILED' }); console.log(`  FAIL  ${id}  ${why}`) }

/* ============================================================ the no-audio verdict
 *
 * Kept separate from the recorder on purpose: the code that records and the code that judges are
 * not the same function, so `--prove-guard` can exercise the judgement against known-bad input.
 *
 * Two classes of violation, because "no player" alone is not enough on this project:
 *   PLAYER   — a process whose whole job is to open the audio device.
 *   ALOUD    — a SYNTHESIZER told to speak instead of to write a file. `say "x"` and
 *              `espeak-ng "x"` open the device just as surely as `afplay` does. The provider
 *              always passes `-o <file>` / `-w <file>` / `SetOutputToWaveFile`; anything that
 *              does not is speech at whoever is sitting at the machine (**P31**).
 */
const PLAYER_BINARIES = [
  'afplay', 'ffplay', 'aplay', 'paplay', 'pw-play', 'mpv', 'mpg123', 'play', 'sox', 'cvlc', 'vlc', 'omxplayer'
]

export function classifySpawn (entry) {
  const cmd = String(entry.cmd ?? '')
  const base = cmd.replaceAll('\\', '/').split('/').pop().toLowerCase().replace(/\.exe$/, '')
  const args = (entry.args ?? []).map(String)
  const all = `${cmd} ${args.join(' ')}`

  if (PLAYER_BINARIES.includes(base)) return { violation: 'player', why: `${base} exists to open the audio device` }

  // `say -o <file>` writes a WAV. `say -v '?'` prints the voice list to stdout. `say "text"`
  // SPEAKS. This distinction is not theory: the first run of this harness went red on the
  // provider's own `say -v '?'` probe, which is how we know the classifier reads real argv.
  if (base === 'say') {
    const writesFile = args.includes('-o')
    const listsVoices = args[args.indexOf('-v') + 1] === '?'
    if (!writesFile && !listsVoices) return { violation: 'aloud', why: 'macOS `say` with no -o <file> speaks through the audio device' }
  }

  // `espeak-ng -w <file>` writes a WAV. Without it, espeak plays.
  if ((base === 'espeak-ng' || base === 'espeak') && !args.includes('-w') && !args.includes('--version') && !args.includes('--voices')) {
    return { violation: 'aloud', why: `${base} with no -w <file> plays through the audio device` }
  }

  // spd-say ALWAYS hands text to a daemon that speaks it. Its metadata flags do not.
  if (base === 'spd-say') {
    const metadataOnly = args.every((a) => ['--version', '--cancel', '--list-synthesis-voices', '--list-output-modules', '-v', '-C', '-L'].includes(a))
    if (!metadataOnly) return { violation: 'aloud', why: 'spd-say hands text to speech-dispatcher, which plays it (P25)' }
  }

  // PowerShell: SetOutputToWaveFile makes Speak() write a file; without it, it speaks.
  if (base === 'powershell' || base === 'pwsh') {
    if (/SoundPlayer/i.test(all)) return { violation: 'player', why: 'System.Media.SoundPlayer opens the audio device' }
    if (/\.Speak(Async)?\s*\(/i.test(all) && !/SetOutputToWaveFile/i.test(all)) {
      return { violation: 'aloud', why: 'SpeechSynthesizer.Speak() with no SetOutputToWaveFile speaks through the audio device' }
    }
  }
  return null
}

export function auditSpawns (entries) {
  const violations = []
  for (const e of entries) {
    const v = classifySpawn(e)
    if (v !== null) violations.push({ ...v, cmd: e.cmd, args: e.args })
  }
  return { total: entries.length, violations }
}

function readSpawnLog (path) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l))
}

/* ============================================================ derive the stage list from source
 * `normalize()`'s body is the only authority. A hardcoded 15 stops checking the moment a
 * sixteenth transform lands; a derived, ORDERED list also catches a reorder.
 */
export function deriveStagesFromSource (rawSrc) {
  // CRLF, because a Windows checkout may hand us \r\n and the body-end sentinel below is '\n}'.
  // Without this the slice runs to the end of the file and the regex matches transforms that are
  // not in normalize() at all — green for the wrong reason, on one platform only.
  const src = rawSrc.replaceAll('\r\n', '\n')
  const start = src.indexOf('export function normalize(')
  if (start < 0) throw new Error('could not find `export function normalize(` in the normalizer source')
  const end = src.indexOf('\n}', start)
  const body = src.slice(start, end)
  const names = [...body.matchAll(/\bs = ([A-Za-z_$][\w$]*)\(/g)].map((m) => m[1])
  // Floor assertion (P33): a derivation that quietly stops matching is the same failure wearing
  // the uniform of the fix. Five is far below any plausible pipeline and far above zero.
  if (names.length < 5) {
    throw new Error(`derived only ${names.length} transforms from normalize(); the derivation has ` +
      'stopped matching the source and would pass anything. Fix the derivation, do not lower this floor.')
  }
  return names
}

/* ============================================================ helpers */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function post (port, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000)
  })
  return { status: res.status, body: await res.json() }
}

function connectRefused (host, port, timeoutMs = 4000) {
  return new Promise((resolveOuter) => {
    const sock = createConnection({ host, port })
    const done = (verdict) => { sock.destroy(); resolveOuter(verdict) }
    sock.setTimeout(timeoutMs, () => done({ refused: true, why: 'timed out (no listener answered)' }))
    sock.on('connect', () => done({ refused: false, why: 'CONNECTED — the server is reachable off loopback' }))
    sock.on('error', (err) => done({ refused: true, why: err.code ?? String(err.message) }))
  })
}

function nonLoopbackIPv4 () {
  const out = []
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address)
    }
  }
  return out
}

/* ============================================================ the negative control
 *
 * "A guard nobody has seen fail is a guard nobody can trust." This runs the real recorder over a
 * decoy that really does spawn a player, then runs the real `auditSpawns()` over the result and
 * demands a VIOLATION. It also runs the clean control, because a guard that reddens on everything
 * is broken in the other direction and would be just as useless.
 *
 * THE DECOY MAKES NO SOUND, BY CONSTRUCTION. Every spawn names a file that does not exist, so the
 * player exits before it reaches the audio device — the same trick `pnpm bench:latency` uses to
 * measure a player spawn with the device never opened (PITFALLS **P32**). And the recorder records
 * at CALL time, so even a player binary that is not installed on this runner still trips the guard.
 */
const DECOY = `
import { spawn } from 'node:child_process'
const missing = '/nonexistent-voice-lab-guard-probe.wav'
const cmd = process.platform === 'darwin'
  ? ['afplay', [missing]]
  : process.platform === 'win32'
    ? ['powershell', ['-NoProfile', '-Command', "(New-Object System.Media.SoundPlayer '" + missing + "').PlaySync()"]]
    : ['aplay', [missing]]
spawn(cmd[0], cmd[1], { stdio: 'ignore' }).on('error', () => {})
`

async function proveGuardCanFail () {
  console.log('\n=== NEGATIVE CONTROL: the no-audio guard must be able to go red ===\n')
  const dir = await mkdtemp(join(tmpdir(), 'voice-lab-guard-'))
  const decoy = join(dir, 'decoy-player.mjs')
  const log = join(dir, 'spawns.ndjson')
  await writeFile(decoy, DECOY, 'utf8')

  await new Promise((done) => {
    const child = spawn(process.execPath, ['--import', pathToFileURL(RECORDER).href, decoy], {
      env: { ...process.env, VOICE_LAB_SPAWN_LOG: log }, stdio: 'inherit'
    })
    child.on('exit', done)
  })
  await sleep(200)

  const recorded = readSpawnLog(log)
  console.log(`recorded ${recorded.length} spawn(s) from the decoy:`)
  for (const e of recorded) console.log(`   ${e.api} ${e.cmd} ${JSON.stringify(e.args)}`)

  const bad = auditSpawns(recorded)
  const cases = []
  cases.push(['a real spawned player, recorded end to end', bad.violations.length > 0, bad.violations])

  // Synthetic entries for the rungs we must NOT actually run: these three really would make a
  // sound. The judgement is exercised; the device is not.
  const aloud = [
    { api: 'spawn', cmd: 'say', args: ['hello there'] },
    { api: 'spawn', cmd: 'espeak-ng', args: ['hello there'] },
    { api: 'spawn', cmd: 'spd-say', args: ['--wait', 'hello there'] },
    { api: 'spawn', cmd: 'powershell', args: ['-Command', 'Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak(\'hi\')'] }
  ]
  for (const e of aloud) {
    const v = classifySpawn(e)
    cases.push([`a synthesizer told to speak aloud: ${e.cmd} ${e.args.join(' ')}`.slice(0, 96), v !== null, v])
  }

  // The clean control: exactly what the provider really spawns. This MUST stay green.
  const clean = [
    { api: 'spawn', cmd: 'say', args: ['-o', '/tmp/x.wav', '--data-format=LEI16@22050', 'hello'] },
    { api: 'spawn', cmd: 'espeak-ng', args: ['-w', '/tmp/x.wav', '-s', '175', 'hello'] },
    { api: 'spawn', cmd: 'say', args: ['-v', '?'] },
    { api: 'spawn', cmd: 'spd-say', args: ['--version'] },
    { api: 'spawn', cmd: 'powershell', args: ['-Command', "$s.SetOutputToWaveFile('C:\\x.wav'); $s.Speak('hi')"] }
  ]
  const cleanVerdict = auditSpawns(clean)
  cases.push(['the control case: the real provider spawns must stay GREEN', cleanVerdict.violations.length === 0, cleanVerdict.violations])

  let allOk = true
  console.log('')
  for (const [name, ok, detail] of cases) {
    console.log(`  ${ok ? 'guard went red as required' : 'GUARD DID NOT FIRE'}  — ${name}`)
    if (!ok) { allOk = false; console.log(`     detail: ${JSON.stringify(detail)}`) }
  }
  await rm(dir, { recursive: true, force: true })

  if (!allOk) {
    console.error('\nThe no-audio guard could not be shown to fail. A guard nobody has seen fail is a\n' +
      'guard nobody can trust — this is a harder failure than a red audio assertion.')
    return 1
  }
  console.log('\nThe no-audio guard fires on a real spawned player, on all four aloud rungs, and stays\n' +
    'silent on the five spawns the provider legitimately makes. It can fail.\n')
  return 0
}

/* ============================================================ the main run */
async function main () {
  if (process.argv.includes('--prove-guard')) return proveGuardCanFail()

  console.log(`\n=== Voice Lab CI — ${process.platform} / node ${process.version} ===\n`)

  const dir = await mkdtemp(join(tmpdir(), 'voice-lab-ci-'))
  const spawnLog = join(dir, 'spawns.ndjson')

  /* ---- 1. start the server under the recorder, on an OS-chosen free port */
  const server = spawn(process.execPath, ['--import', pathToFileURL(RECORDER).href, SERVER, '--port=0'], {
    cwd: REPO_ROOT, env: { ...process.env, VOICE_LAB_SPAWN_LOG: spawnLog }, stdio: ['ignore', 'pipe', 'pipe']
  })
  let banner = ''
  let stderr = ''
  server.stdout.on('data', (b) => { banner += b.toString(); process.stdout.write(`  [server] ${b}`) })
  server.stderr.on('data', (b) => { stderr += b.toString(); process.stderr.write(`  [server:err] ${b}`) })

  const deadline = Date.now() + 90_000
  let port = null
  while (Date.now() < deadline && port === null) {
    const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(banner)
    if (m !== null) port = Number(m[1])
    else if (server.exitCode !== null) break
    else await sleep(200)
  }
  if (port === null) {
    console.error(`the Voice Lab server never announced a port.\nstdout:\n${banner}\nstderr:\n${stderr}`)
    server.kill('SIGKILL')
    return 1
  }

  try {
    /* ---- 2. the server loaded SOURCE, not dist */
    const srcLine = /^\s*normalizer\s+(.+?)\s+\(source, not dist — checked against (\d+) probes\)\s*$/m.exec(banner)
    if (srcLine === null) {
      fail('source.not.dist', 'the startup banner carries no source-not-dist proof line at all. The ' +
        'check is ABSENT, which is indistinguishable from a check that failed open.')
    } else {
      const path = srcLine[1].replaceAll('\\', '/')
      const probeCount = Number(srcLine[2])
      if (/\/dist\//.test(path)) fail('source.not.dist', `the server loaded a BUILT artifact: ${path}`)
      else if (!/\/packages\/[^/]+\/src\/.+\.ts$/.test(path)) fail('source.not.dist', `the loaded path is not TypeScript source under packages/<pkg>/src/: ${path}`)
      else if (probeCount < 2) fail('source.not.dist', `the source-vs-import check ran against ${probeCount} probe(s); with fewer than 2 it is not checking the fixtures`)
      else ran('source.not.dist', `${path}, verified against ${probeCount} probes`)
    }

    /* ---- 3. negative control for that check: a dist URL must be REFUSED */
    const { assertSourceModule } = await import(pathToFileURL(SERVER).href)
    let threw = false
    try { assertSourceModule(pathToFileURL(join(REPO_ROOT, 'packages/core/dist/normalizer/index.js')).href, 'probe') } catch { threw = true }
    if (threw) ran('source.not.dist.negative', 'assertSourceModule() refuses a dist/ URL')
    else fail('source.not.dist.negative', 'assertSourceModule() ACCEPTED a dist/ URL — the source guard cannot fail')

    /* ---- 4. bind 127.0.0.1, not 0.0.0.0 */
    const loop = await fetch(`http://127.0.0.1:${port}/fixtures`, { signal: AbortSignal.timeout(20_000) })
    if (loop.status === 200) ran('bind.loopback', `127.0.0.1:${port} answers 200`)
    else fail('bind.loopback', `loopback returned ${loop.status}; every other bind assertion below would pass for the wrong reason`)

    const externals = nonLoopbackIPv4()
    if (externals.length === 0) {
      notRun('bind.not.wildcard', 'this runner has no non-loopback IPv4 address, so there is no address ' +
        'from which a 0.0.0.0 bind could be observed. Not asserted rather than assumed.')
    } else {
      const results = []
      for (const addr of externals) results.push([addr, await connectRefused(addr, port)])
      const reachable = results.filter(([, r]) => !r.refused)
      if (reachable.length > 0) fail('bind.not.wildcard', `the server answered on ${reachable.map(([a]) => a).join(', ')} — it is not bound to loopback only`)
      else ran('bind.not.wildcard', `refused on ${results.map(([a, r]) => `${a} (${r.why})`).join(', ')}`)
    }

    /* ---- 5. /normalize equals normalize() called from the library */
    const { normalize } = await import(pathToFileURL(NORMALIZER_SRC).href)
    const derived = deriveStagesFromSource(await readFile(NORMALIZER_SRC, 'utf8'))
    const fixtures = (await readdir(FIXTURES)).filter((f) => f.endsWith('.md')).toSorted()
    if (fixtures.length === 0) {
      fail('normalize.parity', `no fixtures under ${FIXTURES}; the parity check has nothing to run and would pass empty`)
    } else {
      const mismatches = []
      const stageProblems = []
      for (const name of fixtures) {
        const text = await readFile(join(FIXTURES, name), 'utf8')
        const { status, body } = await post(port, '/normalize', { text })
        if (status !== 200) { mismatches.push(`${name}: HTTP ${status} ${JSON.stringify(body).slice(0, 200)}`); continue }
        // The expected value comes from the LIBRARY, never from the server. A server compared
        // against its own output agrees by construction.
        const expected = normalize(text)
        if (body.spoken !== expected) {
          mismatches.push(`${name}: server and library disagree.\n    server:  ${JSON.stringify(body.spoken).slice(0, 240)}\n    library: ${JSON.stringify(expected).slice(0, 240)}`)
        }
        const names = (body.stages ?? []).map((s) => s.name)
        if (names.length !== derived.length || names.some((n, i) => n !== derived[i])) {
          stageProblems.push(`${name}: server reported ${names.length} stages ${JSON.stringify(names)}; ` +
            `normalize() in source calls ${derived.length}: ${JSON.stringify(derived)}`)
        }
      }
      if (mismatches.length > 0) fail('normalize.parity', `${mismatches.length}/${fixtures.length} fixtures disagree:\n    ${mismatches.join('\n    ')}`)
      else ran('normalize.parity', `${fixtures.length} fixtures: server /normalize === normalize() from packages/core/src`)

      if (stageProblems.length > 0) fail('normalize.stages', stageProblems.join('\n    '))
      else ran('normalize.stages', `${derived.length} stages, derived from normalize() in source, in order: ${derived.join(' → ')}`)
    }

    /* ---- 6. /speak: the correct outcome for THIS platform, named
     *
     * On a stock Linux runner there is no synthesizer (P25), so the honest result is a 503 or the
     * `spoke-elsewhere` rung — not a green tick bought by `apt install espeak-ng`, which would
     * test a machine no user has. Each of the three outcomes is shape-asserted; a fourth shape,
     * or a generic error message, is red.
     */
    const speakText = 'The Voice Lab is checking that this machine can speak.'
    // `stream: false` on purpose: this check asserts ONE platform outcome and wants one object.
    // The streaming path (FR-024, NDJSON) is exercised by scripts/voice-lab.test.mjs and by
    // bench-lab-gate.mjs; `res.json()` here would choke on a multi-record stream.
    const { status, body } = await post(port, '/speak', { text: speakText, stream: false })
    const outcome = `${status} played=${JSON.stringify(body?.played)}`
    if (status === 503) {
      const msg = String(body?.message ?? '')
      const named = body?.error === 'provider_error' && typeof body?.name === 'string' && body.name !== 'Error'
      const hasRemedy = /apt install|espeak-ng|speech-dispatcher/i.test(`${msg} ${body?.installHint ?? ''}`)
      const notGeneric = msg.length > 30 && !/^synthesis failed\.?$/i.test(msg)
      if (named && hasRemedy && notGeneric && body.played === 'nothing') {
        ran('speak.outcome', `503 carrying the provider's own words — ${body.name}: ${msg.slice(0, 160)}`)
      } else {
        fail('speak.outcome', `503 without the provider's real error text or its install remedy ` +
          `(named=${named} remedy=${hasRemedy} specific=${notGeneric}): ${JSON.stringify(body).slice(0, 400)}`)
      }
    } else if (status === 200 && body?.played === 'elsewhere') {
      const ok = typeof body.backend === 'string' && Array.isArray(body.disabled) && body.disabled.length === 4 &&
        typeof body.reason === 'string' && typeof body.installHint === 'string' && Array.isArray(body.chunks) && body.chunks.length === 0
      if (ok) ran('speak.outcome', `the spoke-elsewhere rung, reported as a NAMED outcome via ${body.backend}; ` +
        `${body.disabled.length} affordances disabled with the reason attached; nothing was spoken (allowElsewhere defaults false)`)
      else fail('speak.outcome', `spoke-elsewhere reported without its full shape (backend/disabled×4/reason/installHint/no chunks): ${JSON.stringify(body).slice(0, 400)}`)
    } else if (status === 200 && body?.played === 'browser') {
      const chunks = body.chunks ?? []
      const ok = chunks.length > 0 && chunks.every((c) => typeof c.format === 'string' && typeof c.base64 === 'string' && c.bytes > 0)
      if (ok) ran('speak.outcome', `bytes back to the caller: ${chunks.length} ${chunks[0].format} chunk(s), ${chunks.reduce((n, c) => n + c.bytes, 0)} bytes, played by nobody`)
      else fail('speak.outcome', `200 played=browser but the chunks carry no bytes: ${JSON.stringify(body).slice(0, 400)}`)
    } else {
      fail('speak.outcome', `unnamed fourth outcome — neither bytes, nor 503, nor spoke-elsewhere: ${outcome} ${JSON.stringify(body).slice(0, 400)}`)
    }

    /* ---- 7. the whole run opened no audio device */
    server.kill('SIGTERM')
    await sleep(500)
    const recorded = readSpawnLog(spawnLog)
    const verdict = auditSpawns(recorded)
    console.log(`\n  spawns observed in the server process: ${verdict.total}`)
    for (const e of recorded) console.log(`    ${e.api} ${e.cmd} ${JSON.stringify(e.args).slice(0, 160)}`)

    // The control case (spec FR-006): the synthesizer spawn must still appear. Zero spawns means
    // the recorder never hooked, and a guard that observes nothing reports green forever.
    if (verdict.total === 0) {
      fail('no.audio.control', 'the recorder observed ZERO spawns. `prepare()` probes a synthesizer on ' +
        'every platform, so zero means the wrapper is not installed and the no-audio verdict below ' +
        'is measuring nothing.')
    } else {
      ran('no.audio.control', `${verdict.total} spawn(s) observed, so the recorder is live`)
    }
    if (verdict.violations.length > 0) {
      fail('no.audio', `the run spawned a player or spoke aloud:\n    ` +
        verdict.violations.map((v) => `${v.cmd} ${JSON.stringify(v.args)} — ${v.why} [${v.violation}]`).join('\n    '))
    } else {
      ran('no.audio', 'no player spawned, no synthesizer told to speak aloud, no audio device opened')
    }

    /* ---- 8. what CI cannot cover (spec FR-107, FR-108) */
    notRun('gate.two.seconds', 'the change→hear gate needs a real audio device and a browser AudioContext. ' +
      'CI runners have neither, so a threshold here would be a permanently-green light (spec FR-108). ' +
      'Measured manually on the author\'s machine: `pnpm bench:latency`.')
    notRun('browser.playback', 'decodeAudioData, the single-session AudioContext (FR-007) and the ' +
      'format branch (FR-008) live in the page. No headless browser is driven here.')
    notRun('audible.output', 'nothing in CI may listen. That a WAV contains intelligible speech is ' +
      'settled by the listener, which is the entire premise of M11 (PITFALLS P23).')
  } finally {
    server.kill('SIGKILL')
    await rm(dir, { recursive: true, force: true })
  }

  /* ---- the reconciliation (spec FR-107) */
  const ranCount = probes.filter((p) => p.ran).length
  const notRunCount = probes.filter((p) => !p.ran).length
  const unexplained = probes.filter((p) => !p.ran && (p.reason ?? '').length === 0)
  console.log(`\n=== report: ${probes.length} probes = ${ranCount} ran + ${notRunCount} not-run ===`)
  if (probes.length !== ranCount + notRunCount) {
    console.error('the probe counts do not reconcile'); return 1
  }
  if (unexplained.length > 0) {
    console.error(`${unexplained.length} probe(s) neither ran nor declared a reason: ${unexplained.map((p) => p.id).join(', ')}`)
    return 1
  }
  await writeStepSummary()
  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILED:\n` + failures.map((f) => `  ${f.id}: ${f.why}`).join('\n'))
    return 1
  }
  console.log('Voice Lab CI: green, and silent.\n')
  return 0
}

/**
 * Put the not-run list where someone reading a GREEN BADGE will see it.
 *
 * A green CI that silently omits the milestone's own gate is a lie of omission (spec FR-107), and
 * the person most likely to be misled by it is the author six weeks from now.
 */
async function writeStepSummary () {
  const path = process.env.GITHUB_STEP_SUMMARY
  if (typeof path !== 'string' || path.length === 0) return
  const rows = probes.map((p) => p.ran
    ? `| ${p.id} | ran | ${String(p.detail).replaceAll('|', '\\|').slice(0, 220)} |`
    : `| ${p.id} | **NOT RUN** | ${String(p.reason).replaceAll('|', '\\|')} |`)
  const body = [
    `### Voice Lab — ${process.platform}`,
    '',
    `${probes.length} probes = ${probes.filter((p) => p.ran).length} ran + ${probes.filter((p) => !p.ran).length} not-run.`,
    '',
    '| probe | state | detail |',
    '|---|---|---|',
    ...rows,
    '',
    '**What a green tick here does NOT mean.** No audio was played and nothing listened. The ',
    'two-second change→hear gate needs a real audio device and a browser, so it is a MANUAL ',
    'measurement (`pnpm bench:latency` on the author\'s machine), never a CI threshold — a latency ',
    'threshold on a runner with no audio device is a permanently-green light (spec FR-108).',
    ''
  ].join('\n')
  await writeFile(path, body, { flag: 'a' })
}

process.exitCode = await main()
