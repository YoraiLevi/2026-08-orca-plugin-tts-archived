#!/usr/bin/env node
/**
 * bench-latency — measure the latency numbers this project makes decisions on.
 *
 * WHY THIS EXISTS. The repo's central rule is "verify by effect, not by presence". Round-3 review
 * (`docs/design/008-crossreview-round3.md`, findings E-03/E-04/E-05/C-01) found the opposite:
 * the ~970 ms inter-sentence gap that justifies M9 and design 004's playback architecture appears
 * in a code comment, in HANDOFF, and four times in one design document — and had never been
 * measured anywhere in this repository. This script measures it, along with everything else on the
 * critical path, so the numbers can be re-derived on any machine instead of quoted forever.
 *
 * RUN IT:  pnpm bench:latency        (add --json for machine-readable output)
 *
 * IT IS NOT A CI GATE, DELIBERATELY. Absolute latency varies by machine, load, audio device and OS
 * version by more than the differences we care about, so a threshold here would be a red light
 * nobody can turn green (constitution R068, and C-02 in the round-3 review). It is a manual
 * command. What CI *could* gate is a ratio between two numbers measured in the same run; that is
 * not attempted here and is not claimed.
 *
 * IT IS SILENT BY DEFAULT, AND THAT IS A HARD RULE. This is assistive-technology tooling: the
 * author is voice-first and uses this machine's audio channel to know what their own tools are
 * doing. A benchmark that beeps over that channel is a benchmark that gets run once and then
 * deleted, so the audible probes are behind `--audible` and print a warning before they make a
 * sound. Run them only on a machine nobody is listening to.
 *
 * Everything on the synthesis side stays measurable in silent mode, because `say -o <file>` /
 * `espeak-ng -w <file>` write a WAV and never open the audio device: spawn floor, per-sentence
 * synthesis, `listVoices()`, the temp-file round trip, and the player's own process-startup cost
 * (spawned on a missing file, so it exits before reaching CoreAudio).
 *
 * The device side — the inter-chunk gap, first sample out, cancel-to-silence — cannot be measured
 * without opening the default output device. macOS `afplay` has no device-selection flag and a
 * stock system has no null sink, and installing one to work around this is out of scope. So in
 * silent mode those probes report NOT-RUN with that reason, and the document treats the device
 * cost as a separately-characterized constant with its rig recorded. See
 * `docs/.research/latency-measurements.md` "The measurement is audible, and that is a finding".
 *
 * WHAT IT CANNOT MEASURE, STATED RATHER THAN SKIPPED. Nothing in userland can observe the instant
 * the first sample leaves the DAC without a loopback capture device or a CoreAudio-level probe.
 * So "first audio" is reported as a *bracket*: a measured lower bound (everything up to the player
 * process existing) and a measured upper bound (that, plus the player's own fixed pre+post-roll,
 * obtained by regressing process lifetime against known audio duration). Every probe that cannot
 * run on this platform prints a NOT-RUN line with the reason. A probe is never silently omitted:
 * the summary prints a count of expected probes and a count of reported ones, and they must match.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const JSON_OUT = process.argv.includes('--json')
/**
 * Audible probes are opt-in. Default silent — see the header. `SILENT` gates every probe that
 * opens the audio device; nothing else in this file spawns a player.
 */
const AUDIBLE = process.argv.includes('--audible')
const SILENT = !AUDIBLE
const SILENT_REASON =
  'audible probe — opens the default output device. Re-run with `--audible` on a machine nobody ' +
  'is listening to. Silent mode cannot substitute: afplay has no device-selection flag and a ' +
  'stock macOS system has no null sink.'
const SAMPLE_RATE = 22050

/* ------------------------------------------------------------------ plumbing */

/** Bundle the real source so probes exercise shipped code, not a re-implementation. */
async function loadRealCode() {
  const dir = await mkdtemp(join(tmpdir(), 'orca-tts-bench-'))
  const entry = join(dir, 'entry.ts')
  await writeFile(entry, [
    `export { SubprocessSink } from ${JSON.stringify(join(ROOT, 'packages/plugin/src/sinks/subprocess-sink.ts'))}`,
    `export { OsSynthProvider } from ${JSON.stringify(join(ROOT, 'packages/providers/src/index.ts'))}`
  ].join('\n'))
  const outfile = join(dir, 'bundle.mjs')
  await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'node',
    target: 'node24', outfile, external: ['node:*'], logLevel: 'silent'
  })
  const mod = await import(pathToFileURL(outfile).href)
  return { mod, cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => {}) }
}

const now = () => Number(process.hrtime.bigint()) / 1e6

function stats(xs) {
  const s = xs.toSorted((a, b) => a - b)
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]
  const mean = s.reduce((a, b) => a + b, 0) / s.length
  return { n: s.length, min: s[0], p50: q(0.5), p95: q(0.95), max: s[s.length - 1], mean }
}

/** Ordinary least squares; used to split a fixed overhead out of a duration-proportional cost. */
function fit(points) {
  const n = points.length
  const sx = points.reduce((a, [x]) => a + x, 0)
  const sy = points.reduce((a, [, y]) => a + y, 0)
  const sxx = points.reduce((a, [x]) => a + x * x, 0)
  const sxy = points.reduce((a, [x, y]) => a + x * y, 0)
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx)
  return { slope, intercept: (sy - slope * sx) / n }
}

const RESULTS = []
const record = (r) => { RESULTS.push(r); if (!JSON_OUT) printRow(r) }
const notRun = (id, label, reason) =>
  record({ id, label, status: 'NOT-RUN', label_kind: 'not-run', reason })

function fmt(ms) { return ms === undefined ? '—' : `${ms.toFixed(1)}` }
function printRow(r) {
  if (r.status === 'NOT-RUN') {
    console.log(`  ${r.id.padEnd(22)} NOT-RUN  — ${r.reason}`)
    return
  }
  const s = r.stats
  console.log(
    `  ${r.id.padEnd(22)} n=${String(s.n).padStart(3)}  ` +
    `p50 ${fmt(s.p50).padStart(8)}  p95 ${fmt(s.p95).padStart(8)}  max ${fmt(s.max).padStart(8)}  ` +
    `[${r.label_kind}] ${r.label}`
  )
}

/** Minimal mono LEI16 WAV of an exact duration — the same shape design 005's earcon would be. */
function sineWav(durationMs, freq = 660, gain = 0.05) {
  const frames = Math.round((durationMs / 1000) * SAMPLE_RATE)
  const data = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE) * gain * 32767), i * 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(SAMPLE_RATE, 24); h.writeUInt32LE(SAMPLE_RATE * 2, 28)
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

/**
 * Audio duration of a PCM WAV, from its own header. Returns null if it is not one.
 *
 * Walks the chunk list rather than reading fixed offsets: macOS `say -o x.wav` writes a `JUNK`
 * alignment chunk BEFORE `fmt `, so byte 24 is not the sample rate. Reading fixed offsets returned
 * 0 here and silently produced zero samples — exactly the class of quiet miscount this file exists
 * to avoid.
 */
function wavDurationMs(buf) {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF') return null
  let off = 12
  let byteRate = 0
  while (off + 8 <= buf.length) {
    const id = buf.toString('latin1', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ' && off + 8 + 16 <= buf.length) byteRate = buf.readUInt32LE(off + 8 + 8)
    if (id === 'data') {
      if (byteRate === 0) return null
      return (Math.min(size, buf.length - off - 8) / byteRate) * 1000
    }
    off += 8 + size + (size % 2)
  }
  return null
}

const chunkOf = (buf) => ({ data: buf, format: 'wav', sampleRate: SAMPLE_RATE })

/** Wall time of a bare spawn-to-exit, used for the player-lifetime regression. */
function runToExit(cmd, args) {
  return new Promise((resolve) => {
    const t0 = now()
    const c = spawn(cmd, args, { stdio: 'ignore' })
    c.on('error', () => resolve(null))
    c.on('close', () => resolve(now() - t0))
  })
}

const have = (cmd) => new Promise((r) => {
  const c = spawn('command', ['-v', cmd], { stdio: 'ignore', shell: true })
  c.on('error', () => r(false)); c.on('close', (code) => r(code === 0))
})

/* ------------------------------------------------------------------- probes */

const PROBE_IDS = [
  'spawn.floor', 'synth.say', 'listVoices', 'tempfile.roundtrip',
  'player.no-device', 'player.fixed-overhead', 'sink.chunk-overhead', 'interchunk.gap',
  'firstaudio.lower', 'firstaudio.upper', 'cancel.kill-to-exit', 'earcon.added-cost'
]

async function main() {
  const platform = process.platform
  if (!JSON_OUT) {
    console.log(`bench-latency — ${platform} ${process.arch}, node ${process.version}`)
    console.log(`labels: [measured-here] = run on this machine now · [derived] = arithmetic on measured-here values`)
    if (AUDIBLE) {
      console.log('')
      console.log('  *** --audible: the device-side probes WILL PLAY SOUND on the default output')
      console.log('  *** device — roughly 45 s of tones and short sentences. Do not run this while')
      console.log('  *** anyone is listening to this machine.')
    } else {
      console.log('silent mode (default): device-side probes are skipped, not silently omitted.')
      console.log('                       pass --audible to run them; they make noise.')
    }
    console.log('')
  }

  const { mod, cleanup } = await loadRealCode()
  const { SubprocessSink, OsSynthProvider } = mod

  /* 1. process spawn floor -------------------------------------------------- */
  if (platform === 'darwin') {
    // P10 measured bare `say ""`, which opens the audio device even though it emits nothing.
    // `-o <file>` routes to a file writer instead, so this is silent by construction. Measured
    // side by side on 2026-08-21 the two forms agree (0.42 s vs 0.41-0.43 s), but they are not
    // the same command, so the label says which one ran.
    const dir = await mkdtemp(join(tmpdir(), 'orca-tts-bench-floor-'))
    const out = join(dir, 'empty.wav')
    const xs = []
    for (let i = 0; i < 12; i++) xs.push(await runToExit('say', ['-o', out, '']))
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    record({ id: 'spawn.floor', label: '`say -o <file> ""` — spawn with zero synthesis, silent form of P10',
             label_kind: 'measured-here', stats: stats(xs.filter(Boolean)), raw: xs })
  } else {
    notRun('spawn.floor', 'process spawn floor', `no known zero-work synth spawn for ${platform}`)
  }

  /* 2. real synthesis through the shipped provider -------------------------- */
  const provider = new OsSynthProvider()
  const SENTENCES = [
    'The tests pass.',
    'I have updated the normalizer and the chunker.',
    'There is one failing case in the queue module.'
  ]
  let synthesized = []
  try {
    await provider.prepare()
    const xs = []
    for (let i = 0; i < 9; i++) {
      const text = SENTENCES[i % SENTENCES.length]
      const t0 = now()
      let first = null
      for await (const c of provider.generate(text)) { if (first === null) first = c }
      xs.push(now() - t0)
      if (first !== null && i < SENTENCES.length) synthesized.push(first)
    }
    record({ id: 'synth.say', label: 'OsSynthProvider.generate() — one sentence to a WAV buffer',
             label_kind: 'measured-here', stats: stats(xs), raw: xs })
  } catch (err) {
    notRun('synth.say', 'OS synthesis', `provider.generate threw: ${err.message}`)
  }

  /* 3. listVoices ----------------------------------------------------------- */
  try {
    const xs = []
    for (let i = 0; i < 6; i++) {
      const t0 = now(); await provider.listVoices(); xs.push(now() - t0)
    }
    record({ id: 'listVoices', label: 'provider.listVoices() — uncached, every call (P28)',
             label_kind: 'measured-here', stats: stats(xs), raw: xs })
  } catch (err) {
    notRun('listVoices', 'listVoices()', `threw: ${err.message}`)
  }

  /* 4. temp-file round trip the sink pays per chunk -------------------------- */
  {
    const payload = synthesized[0]?.data ?? sineWav(1000)
    const xs = []
    for (let i = 0; i < 20; i++) {
      const t0 = now()
      const dir = await mkdtemp(join(tmpdir(), 'orca-tts-bench-io-'))
      await writeFile(join(dir, 'chunk.wav'), payload)
      await rm(dir, { recursive: true, force: true })
      xs.push(now() - t0)
    }
    record({ id: 'tempfile.roundtrip', label: `mkdtemp + writeFile(${payload.length} B) + rm — the sink's per-chunk I/O`,
             label_kind: 'measured-here', stats: stats(xs), raw: xs })
  }

  /* 5a. what the player costs WITHOUT opening the audio device ---------------- */
  // Splits the fixed overhead into "fork/exec/dyld" and "everything CoreAudio does". It decides
  // what M9 (one resident player) can actually save: only the part that is NOT process startup.
  const playerCmd0 = { darwin: 'afplay', linux: 'paplay', win32: null }[platform]
  let playerNoDevice = null
  if (playerCmd0 !== null && await have(playerCmd0)) {
    const missing = join(tmpdir(), 'orca-tts-bench-does-not-exist.wav')
    const xs = []
    for (let i = 0; i < 12; i++) {
      const ms = await runToExit(playerCmd0, [missing])
      if (ms !== null) xs.push(ms)
    }
    if (xs.length > 0) {
      playerNoDevice = stats(xs).p50
      record({ id: 'player.no-device',
               label: `${playerCmd0} spawned on a missing file — fork/exec/dyld only, audio device never opened`,
               label_kind: 'measured-here', stats: stats(xs), raw: xs })
    } else {
      notRun('player.no-device', 'player startup without device', `${playerCmd0} produced no timing`)
    }
  } else {
    notRun('player.no-device', 'player startup without device',
           playerCmd0 === null ? `no player probe written for ${platform}` : `${playerCmd0} not on PATH`)
  }

  /* 5. the player's own fixed overhead, by regression ------------------------ */
  const playerCmd = { darwin: 'afplay', linux: 'paplay', win32: null }[platform]
  /** True only when a real player may be spawned against the real output device. */
  const canPlay = AUDIBLE && playerCmd !== null && await have(playerCmd)
  let playerFixed = null
  if (SILENT) {
    notRun('player.fixed-overhead', 'player fixed overhead', SILENT_REASON)
  } else if (canPlay) {
    const dir = await mkdtemp(join(tmpdir(), 'orca-tts-bench-play-'))
    const points = []
    const raw = []
    for (const d of [200, 500, 1000, 2000]) {
      const f = join(dir, `t${d}.wav`)
      await writeFile(f, sineWav(d))
      for (let i = 0; i < 4; i++) {
        const ms = await runToExit(playerCmd, [f])
        points.push([d, ms]); raw.push({ durationMs: d, lifetimeMs: ms })
      }
    }
    await rm(dir, { recursive: true, force: true })
    const f = fit(points)
    playerFixed = f.intercept
    const residuals = points.map(([d, ms]) => ms - d)
    record({ id: 'player.fixed-overhead',
             label: `${playerCmd} process lifetime minus audio duration; OLS intercept ${f.intercept.toFixed(1)} ms, slope ${f.slope.toFixed(3)} (1.0 = real time)`,
             label_kind: 'measured-here', stats: stats(residuals), raw, fit: f })
  } else {
    notRun('player.fixed-overhead', 'player fixed overhead',
           playerCmd === null ? `no single-file player probe written for ${platform}`
                              : `${playerCmd} not on PATH`)
  }

  /* 6/7. the sink itself, and the inter-chunk gap ---------------------------- */
  const sink = new SubprocessSink()
  let gapStats = null
  if (SILENT) {
    notRun('sink.chunk-overhead', 'sink per-chunk overhead', SILENT_REASON)
    notRun('interchunk.gap', 'inter-chunk gap', SILENT_REASON)
  } else if (canPlay) {
    // 6 — synthetic tones of known duration: isolates the sink's own per-chunk cost.
    const overhead = []
    const rawOv = []
    for (const d of [200, 500, 1000]) {
      const buf = sineWav(d)
      for (let i = 0; i < 4; i++) {
        const t0 = now()
        await sink.enqueue(chunkOf(buf))
        const wall = now() - t0
        overhead.push(wall - d); rawOv.push({ durationMs: d, wallMs: wall, overheadMs: wall - d })
      }
    }
    record({ id: 'sink.chunk-overhead',
             label: 'SubprocessSink.enqueue() wall time minus the chunk\'s own audio duration',
             label_kind: 'measured-here', stats: stats(overhead), raw: rawOv })

    // 7 — THE HEADLINE. Real sentences, real provider output, real sink, back to back.
    // The silence a listener hears between sentence N and sentence N+1 is exactly
    // (enqueue wall time) - (audio duration) summed across the boundary, because enqueue is
    // strictly sequential: chunk N+1's mkdtemp/write/spawn cannot start until chunk N's player
    // has exited. That is the definition used here, and it is the one the listener experiences.
    if (synthesized.length > 0) {
      const gaps = []
      const rawGap = []
      for (let round = 0; round < 6; round++) {
        for (const chunk of synthesized) {
          const audioMs = wavDurationMs(Buffer.from(chunk.data))
          if (audioMs === null) continue
          const t0 = now()
          await sink.enqueue(chunk)
          const wall = now() - t0
          gaps.push(wall - audioMs)
          rawGap.push({ bytes: chunk.data.length, audioMs: +audioMs.toFixed(1), wallMs: +wall.toFixed(1), gapMs: +(wall - audioMs).toFixed(1) })
        }
      }
      if (gaps.length === 0) {
        notRun('interchunk.gap', 'inter-chunk gap',
               'no chunk carried a parseable WAV duration, so the gap could not be separated from the audio')
      } else {
        gapStats = stats(gaps)
        record({ id: 'interchunk.gap',
                 label: 'INTER-CHUNK GAP — real `say` sentences through the real sink, back to back',
                 label_kind: 'measured-here', stats: gapStats, raw: rawGap })
      }
    } else {
      notRun('interchunk.gap', 'inter-chunk gap', 'no synthesized chunks available (synthesis probe did not run)')
    }
  } else {
    notRun('sink.chunk-overhead', 'sink per-chunk overhead', `${playerCmd ?? 'player'} unavailable`)
    notRun('interchunk.gap', 'inter-chunk gap', `${playerCmd ?? 'player'} unavailable`)
  }

  /* 8/9. first audio, as a measured bracket ---------------------------------- */
  if (SILENT) {
    notRun('firstaudio.lower', 'first audio lower bound', SILENT_REASON)
    notRun('firstaudio.upper', 'first audio upper bound', SILENT_REASON)
  } else if (synthesized.length > 0 && canPlay) {
    const lower = []
    const rawFa = []
    for (let i = 0; i < 10; i++) {
      const text = SENTENCES[i % SENTENCES.length]
      const t0 = now()
      let chunk = null                                     // synthesis: time to FIRST chunk,
      for await (const c of provider.generate(text)) { chunk = c; break }   // which is what a
      if (chunk === null) continue                                          // listener waits on
      const dir = await mkdtemp(join(tmpdir(), 'orca-tts-bench-fa-'))  // the sink's own steps,
      const file = join(dir, 'chunk.wav')                              // replayed in order so the
      await writeFile(file, chunk.data)                                // spawn instant is visible
      const tSpawn = await new Promise((resolve) => {
        const c = spawn(playerCmd, [file], { stdio: 'ignore' })
        c.on('spawn', () => resolve(now() - t0))
        c.on('error', () => resolve(null))
        c.on('close', () => {})
      })
      await new Promise((r) => setTimeout(r, 50))
      await rm(dir, { recursive: true, force: true }).catch(() => {})
      if (tSpawn !== null) { lower.push(tSpawn); rawFa.push({ bytes: chunk.data.length, toSpawnMs: +tSpawn.toFixed(1) }) }
    }
    record({ id: 'firstaudio.lower',
             label: 'FIRST AUDIO, lower bound — speak() to the player process existing (synthesis + temp file + spawn)',
             label_kind: 'measured-here', stats: stats(lower), raw: rawFa })
    if (playerFixed !== null) {
      const upper = lower.map((x) => x + playerFixed)
      record({ id: 'firstaudio.upper',
               label: `FIRST AUDIO, upper bound — lower bound plus the player's entire fixed overhead (${playerFixed.toFixed(1)} ms); true value lies between, unobservable without a loopback device`,
               label_kind: 'derived', stats: stats(upper), raw: upper.map((x) => +x.toFixed(1)) })
    } else {
      notRun('firstaudio.upper', 'first audio upper bound', 'player fixed overhead was not measured')
    }
  } else {
    notRun('firstaudio.lower', 'first audio lower bound', 'synthesis or player unavailable')
    notRun('firstaudio.upper', 'first audio upper bound', 'synthesis or player unavailable')
  }

  /* 10. cancel --------------------------------------------------------------- */
  if (SILENT) {
    notRun('cancel.kill-to-exit', 'cancel latency', SILENT_REASON)
  } else if (canPlay) {
    const dir = await mkdtemp(join(tmpdir(), 'orca-tts-bench-cancel-'))
    const f = join(dir, 'long.wav')
    await writeFile(f, sineWav(3000))
    const xs = []
    for (let i = 0; i < 10; i++) {
      const child = spawn(playerCmd, [f], { stdio: 'ignore' })
      await new Promise((r) => child.once('spawn', r))
      await new Promise((r) => setTimeout(r, 400))          // let it genuinely be making sound
      const t0 = now()
      const dead = new Promise((r) => child.once('close', () => r(now() - t0)))
      child.kill('SIGKILL')
      xs.push(await dead)
    }
    await rm(dir, { recursive: true, force: true })
    record({ id: 'cancel.kill-to-exit',
             label: 'cancel — SIGKILL to the player\'s process exit, mid-playback. NOTE: this is the process dying, not the DAC draining; the residual buffer is not observable from userland',
             label_kind: 'measured-here', stats: stats(xs), raw: xs })
  } else {
    notRun('cancel.kill-to-exit', 'cancel latency', 'player unavailable')
  }

  /* 11. earcon (finding E-04) ------------------------------------------------ */
  if (SILENT) {
    notRun('earcon.added-cost', 'earcon cost', SILENT_REASON)
  } else if (canPlay) {
    // Design 005 section 11.1 costs a two-note earcon at 60 + 20 + 60 = 140 ms of tone. Through the
    // shipped sink it is a SEPARATE AudioChunk, so it also buys a whole extra sink cycle before
    // the first word. Measure what prepending it actually adds.
    const earcon = Buffer.concat([sineWav(60, 784), sineWav(20, 0, 0), sineWav(60, 880)])
    const xs = []
    for (let i = 0; i < 10; i++) {
      const t0 = now()
      await sink.enqueue(chunkOf(earcon))
      xs.push(now() - t0)
    }
    const s = stats(xs)
    record({ id: 'earcon.added-cost',
             label: `earcon as its own chunk through the real sink — 140 ms of tone costs ${s.p50.toFixed(0)} ms of wall clock before the first word (design 005 section 11.1 states 140 ms; E-04)`,
             label_kind: 'measured-here', stats: s, raw: xs })
  } else {
    notRun('earcon.added-cost', 'earcon cost', 'player unavailable')
  }

  await cleanup()

  /* -------------------------------------------------------------- accounting */
  const reported = new Set(RESULTS.map((r) => r.id))
  const missing = PROBE_IDS.filter((id) => !reported.has(id))
  const ran = RESULTS.filter((r) => r.status !== 'NOT-RUN').length
  const skipped = RESULTS.length - ran

  if (JSON_OUT) {
    console.log(JSON.stringify({
      platform, arch: process.arch, node: process.version,
      expected: PROBE_IDS.length, reported: RESULTS.length, ran, skipped, missing,
      results: RESULTS
    }, null, 2))
  } else {
    console.log('')
    console.log(`  probes expected ${PROBE_IDS.length} · reported ${RESULTS.length} · ran ${ran} · not-run ${skipped}`)
    if (gapStats !== null) {
      console.log('')
      console.log(`  HEADLINE — inter-chunk gap on this machine: ` +
        `p50 ${gapStats.p50.toFixed(0)} ms · p95 ${gapStats.p95.toFixed(0)} ms · max ${gapStats.max.toFixed(0)} ms ` +
        `(n=${gapStats.n})`)
      console.log(`             the figure this repo has been quoting is ~970 ms, unmeasured.`)
      if (playerFixed !== null && playerNoDevice !== null) {
        console.log(`             of which ${playerNoDevice.toFixed(0)} ms is process startup and ` +
          `~${(playerFixed - playerNoDevice).toFixed(0)} ms is opening the audio device — ` +
          `the second part is what a resident player (M9) removes.`)
      }
    }
    if (SILENT) {
      console.log('')
      console.log('  Device-side latency (inter-chunk gap, first audio, cancel-to-silence) was NOT')
      console.log('  measured: every probe for it opens the default output device. The figures on')
      console.log('  record come from an --audible run and are in docs/.research/latency-measurements.md')
      console.log('  with their rig. Treat them as a characterized constant, not a fresh reading.')
    }
    console.log('')
    console.log('  Not a CI gate: absolute latency is machine-dependent. Run it manually and record')
    console.log('  the machine alongside the numbers, as docs/.research/latency-measurements.md does.')
  }

  // A benchmark that quietly reports fewer numbers than it claims is a green test that could not
  // fail. If any probe neither ran nor declared itself not-run, that is a bug in this script.
  if (missing.length > 0) {
    console.error(`\nBUG: ${missing.length} probe(s) neither ran nor reported NOT-RUN: ${missing.join(', ')}`)
    process.exit(1)
  }
}

await main()
