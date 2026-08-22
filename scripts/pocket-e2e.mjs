#!/usr/bin/env node
/**
 * PV-010 — the oracle for the Pocket TTS engine, and the only check that can catch the failure it
 * actually has.
 *
 * A hand-ported neural inference loop does not fail loudly. Get the recurrent state fill wrong, or
 * carry an output back to the wrong input slot, or integrate the flow with the wrong step, and you
 * get audio: the right length, the right level, the right prosody, saying nothing. Byte
 * comparisons cannot catch it (there is no reference to compare against on this machine), and
 * `every(Number.isFinite)` passes for noise.
 *
 * **So the expected value comes from the INPUT TEXT, and the measurement comes from a model that
 * knows nothing about our code.** Synthesize a known sentence, transcribe the result with an
 * independent speech-to-text system, and require the transcript to match what we asked for.
 *
 * Two controls, because a transcriber that says what you want to hear is worth nothing:
 *
 *   CONTROL A — the same STT run over the REFERENCE VOICE CLIP, which is a recording of entirely
 *               different words. If it comes back as our sentence, the STT is echoing us.
 *   CONTROL B — the STT run over silence. If it finds words in silence, it hallucinates and no
 *               verdict from it means anything.
 *
 * And a FOURTH outcome, which the architect's earlier probe brief was missing and an agent caught:
 * **inconclusive**. If the STT is absent or cannot run, this script says so and exits non-zero with
 * that named reason — it never reports PASS because it could not tell.
 *
 * SILENT — P31. Nothing here opens an audio device. Audio is written to a file and read back.
 *
 *   node scripts/pocket-e2e.mjs                    # the model from ORCA_TTS_MODEL_DIR or the cache
 *   node scripts/pocket-e2e.mjs --voice michael.wav
 *   node scripts/pocket-e2e.mjs --prove            # ALSO prove the check can fail (see below)
 *
 * `--prove` re-runs the oracle against a deliberately broken engine — the recurrent state
 * zero-filled instead of NaN-filled — and REQUIRES the transcript to stop matching. A check that
 * could not have failed is not a check (R003, P33, P47), and this project has shipped nine of them.
 */

import { registerHooks } from 'node:module'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Resolve `./foo.js` to `./foo.ts` inside `packages/`.
 *
 * PITFALLS **P37**: TypeScript source must import with `.js` specifiers, vitest resolves those to
 * `.ts`, and **plain node — the only resolver that actually ships — does not.** That mismatch has
 * already produced one green suite over a tree that could not boot. This script runs the shipping
 * source under plain node deliberately, so it has to do the resolution vitest was doing invisibly,
 * and it does it HERE rather than by weakening the imports in the source.
 *
 * Scoped to this repo's `packages/` so it can never redirect a dependency.
 */
registerHooks({
  resolve (specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (!specifier.endsWith('.js')) throw err
      const parent = context.parentURL ?? ''
      if (!parent.includes('/packages/')) throw err
      return nextResolve(specifier.slice(0, -3) + '.ts', context)
    }
  }
})
const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback
}

/* ------------------------------------------------------------------------- what we ask it to say */

/**
 * Chosen so a wrong answer is obvious rather than arguable: common words, no proper nouns, no
 * numbers (the normalizer's business, not the engine's), and enough syllables that a garbled
 * rendering cannot coincidentally transcribe correctly.
 */
const SENTENCE = 'The quick brown fox jumps over the lazy dog.'

/** Normalise for comparison: case and punctuation are the transcriber's taste, not our defect. */
const flatten = (s) => s.toLowerCase().replaceAll(/[^a-z ]/g, '').replaceAll(/\s+/g, ' ').trim()

/**
 * Word error rate, so a near-miss is a number rather than a boolean.
 *
 * A strict equality gate would make this script fail on a transcriber's comma. A WER threshold
 * makes it fail on OUR defect: garbled audio does not land at 0.2, it lands near 1.0.
 */
function wer(reference, hypothesis) {
  const a = flatten(reference).split(' ')
  const b = flatten(hypothesis).split(' ')
  const d = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0))
  for (let i = 0; i <= a.length; i++) d[i][0] = i
  for (let j = 0; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = a[i - 1] === b[j - 1]
        ? d[i - 1][j - 1]
        : 1 + Math.min(d[i - 1][j - 1], d[i - 1][j], d[i][j - 1])
    }
  }
  return d[a.length][b.length] / Math.max(1, a.length)
}

/** Above this, the audio is not saying what we asked. Well clear of punctuation noise. */
const WER_GATE = 0.25

/* ----------------------------------------------------------------------------- the transcriber */

/**
 * An independent STT, run out of process.
 *
 * `sherpa-onnx` with NVIDIA's Parakeet TDT-CTC, via `uv`, so it shares nothing with our engine —
 * not the runtime, not the ONNX session options, not a line of our code. That independence is the
 * whole value: a transcriber built on our own inference path could be wrong in the same direction.
 *
 * Returns `{ ok, text }` or `{ ok: false, why }` — never a guess. An absent transcriber is
 * INCONCLUSIVE, not PASS.
 */
function transcribe(wavPath, sttDir) {
  const py = `
import sherpa_onnx, wave, numpy as np, sys
rec = sherpa_onnx.OfflineRecognizer.from_nemo_ctc(
    model=r"${sttDir}/model.int8.onnx", tokens=r"${sttDir}/tokens.txt", num_threads=4)
w = wave.open(r"${wavPath}")
a = np.frombuffer(w.readframes(-1), dtype=np.int16).astype(np.float32) / 32768
s = rec.create_stream(); s.accept_waveform(w.getframerate(), a); rec.decode_stream(s)
print("TRANSCRIPT:" + s.result.text)
`
  return new Promise((resolve) => {
    const child = spawn('uv', ['run', '--with', 'sherpa-onnx', '--with', 'numpy', 'python3', '-c', py],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (b) => { out += b })
    child.stderr.on('data', (b) => { err += b })
    child.on('error', (e) => resolve({ ok: false, why: `could not run uv: ${e.message}` }))
    child.on('close', (code) => {
      const m = /^TRANSCRIPT:(.*)$/m.exec(out)
      if (m) return resolve({ ok: true, text: m[1].trim() })
      resolve({ ok: false, why: `transcriber exited ${code}: ${(err || out).trim().split('\n').slice(-3).join(' / ')}` })
    })
  })
}

/** Where the STT model lives. buzz downloads the same one; we reuse it rather than fetch 100 MB. */
function findSttDir() {
  const candidates = [
    process.env.ORCA_TTS_STT_DIR,
    join(process.env.HOME ?? '', '.buzz/models/parakeet-tdt-ctc-110m-en'),
  ].filter(Boolean)
  return candidates.find((d) => existsSync(join(d, 'model.int8.onnx'))) ?? null
}

/* --------------------------------------------------------------------------------- the run */

async function synthesize(modelDir, voiceFile, outPath, { breakState = false } = {}) {
  const enginePath = join(ROOT, 'packages/providers/src/pocket-synth/engine.ts')
  if (!existsSync(enginePath)) {
    return { ok: false, why: `no engine at ${enginePath} — PV-011 has not landed yet` }
  }
  let PocketTts
  try {
    ;({ PocketTts } = await import(pathToFileURL(enginePath).href))
  } catch (err) {
    return { ok: false, why: `the engine could not be loaded: ${err instanceof Error ? err.message : String(err)}` }
  }
  const { writeWav } = await import(pathToFileURL(join(ROOT, 'packages/providers/src/pocket-synth/audio.ts')).href)

  // A missing ONNX Runtime is INCONCLUSIVE, never FAIL: it says nothing about whether the engine
  // is correct, and reporting it as a failure would train a reader to ignore this script on the
  // machines that most need it.
  let tts
  try {
    tts = await PocketTts.load(modelDir, breakState ? { __proveZeroFill: true } : {})
  } catch (err) {
    return { ok: false, why: err instanceof Error ? err.message : String(err) }
  }
  const voice = await tts.voiceState(voiceFile, await readFile(join(modelDir, voiceFile)))
  const t0 = performance.now()
  const audio = await tts.synthesize(SENTENCE, voice, { temperature: 0.7, lsdSteps: 1, seed: 42 })
  const ms = performance.now() - t0
  await writeFile(outPath, writeWav(audio, tts.sampleRate))
  return { ok: true, ms, seconds: audio.length / tts.sampleRate }
}

async function main() {
  const prove = process.argv.includes('--prove')
  const voiceFile = arg('--voice', 'eve.wav')

  const { modelDir: cacheDir, modelStatus, requiredFiles } =
    await import(pathToFileURL(join(ROOT, 'packages/providers/src/pocket-synth/models.ts')).href)
  const modelDir = process.env.POCKET_MODEL_DIR ?? process.env.ORCA_TTS_MODEL_DIR ?? cacheDir()

  console.log('Pocket TTS end-to-end oracle — the transcript is the expected value.\n')
  console.log(`  model   ${modelDir}`)
  console.log(`  voice   ${voiceFile}`)
  console.log(`  text    ${JSON.stringify(SENTENCE)}\n`)

  // `--bundle` says "these ARE the model files, do not check my manifest". It exists because a
  // developer's model may have been fetched by something else -- buzz downloads the same eight
  // artifacts -- and refusing to run against them would mean re-downloading 166 MB to prove a
  // point about a version file. It announces itself, because a skipped check that stays quiet is
  // the thing this whole script is built to avoid.
  const bundleMode = process.argv.includes('--bundle')
  const status = bundleMode ? { kind: 'ready' } : await modelStatus(modelDir)
  if (bundleMode) {
    const present = requiredFiles().filter((f) => !f.startsWith('.') && f !== 'MODEL_LICENSE.txt')
    const missing = present.filter((f) => !existsSync(join(modelDir, f)))
    if (missing.length > 0) {
      console.log(`[ INCONC ] --bundle was given but ${missing.join(', ')} is not in ${modelDir}`)
      process.exit(2)
    }
    console.log('  NOTE    --bundle: the manifest version check was SKIPPED. These files are')
    console.log('          whatever is on disk; nothing here verified their provenance.\n')
  }
  if (status.kind !== 'ready') {
    const detail = status.kind === 'absent'
      ? `missing ${status.missing.slice(0, 3).join(', ')}${status.missing.length > 3 ? ` and ${status.missing.length - 3} more` : ''}`
      : `on-disk manifest ${status.found}, want ${status.want}`
    console.log(`[ INCONC ] the model is not ready: ${detail}`)
    console.log('           This is not a PASS and not a FAIL. Fetch the model, then re-run.')
    process.exit(2)
  }

  const sttDir = findSttDir()
  if (sttDir === null) {
    console.log('[ INCONC ] no speech-to-text model found, so nothing can check what was said.')
    console.log('           Set ORCA_TTS_STT_DIR, or install buzz, which downloads the same one.')
    process.exit(2)
  }
  console.log(`  stt     ${sttDir}\n`)

  const work = await mkdtemp(join(tmpdir(), 'pocket-e2e-'))
  let failures = 0
  try {
    /* -------- CONTROL B: does the transcriber invent words? ------------------- */
    const { writeWav } = await import(pathToFileURL(join(ROOT, 'packages/providers/src/pocket-synth/audio.ts')).href)
    const silencePath = join(work, 'silence.wav')
    await writeFile(silencePath, writeWav(new Float32Array(24_000), 24_000))
    const silence = await transcribe(silencePath, sttDir)
    if (!silence.ok) {
      console.log(`[ INCONC ] the transcriber could not run: ${silence.why}`)
      process.exit(2)
    }
    const inventedFromSilence = flatten(silence.text).length > 0
    console.log(`[${inventedFromSilence ? ' FAIL ' : '  ok  '}] CONTROL B  silence transcribes to ${JSON.stringify(silence.text)}`)
    if (inventedFromSilence) {
      console.log('           A transcriber that finds words in silence cannot be believed about ours.')
      failures++
    }

    /* -------- CONTROL A: is the transcriber echoing us? ---------------------- */
    const refPath = join(modelDir, voiceFile)
    const reference = await transcribe(refPath, sttDir)
    if (!reference.ok) {
      console.log(`[ INCONC ] the transcriber could not read the reference clip: ${reference.why}`)
      process.exit(2)
    }
    const refWer = wer(SENTENCE, reference.text)
    const echoes = refWer < WER_GATE
    console.log(`[${echoes ? ' FAIL ' : '  ok  '}] CONTROL A  the reference clip says something else (WER ${refWer.toFixed(2)})`)
    console.log(`           ${JSON.stringify(reference.text.slice(0, 90))}${reference.text.length > 90 ? '…' : ''}`)
    if (echoes) {
      console.log('           The reference clip transcribed as OUR sentence. The oracle is compromised.')
      failures++
    }

    /* -------- the check itself ------------------------------------------------ */
    const outPath = join(work, 'ours.wav')
    const synth = await synthesize(modelDir, voiceFile, outPath)
    if (!synth.ok) {
      console.log(`[ INCONC ] ${synth.why}`)
      process.exit(2)
    }
    console.log(`\n  synthesized ${synth.seconds.toFixed(2)} s in ${synth.ms.toFixed(0)} ms ` +
      `(${(synth.ms / 1000 / synth.seconds).toFixed(2)}x realtime) [measured-here]`)

    const ours = await transcribe(outPath, sttDir)
    if (!ours.ok) {
      console.log(`[ INCONC ] the transcriber could not read our audio: ${ours.why}`)
      process.exit(2)
    }
    const ourWer = wer(SENTENCE, ours.text)
    const said = ourWer <= WER_GATE
    console.log(`[${said ? '  ok  ' : ' FAIL '}] PV-010     our audio says what we asked (WER ${ourWer.toFixed(2)}, gate ${WER_GATE})`)
    console.log(`           asked ${JSON.stringify(SENTENCE)}`)
    console.log(`           heard ${JSON.stringify(ours.text)}`)
    if (!said) failures++

    /* -------- --prove: can this check go red? -------------------------------- */
    if (prove) {
      console.log('\n--prove: the same oracle against an engine broken where it matters.')
      const brokenPath = join(work, 'broken.wav')
      const broken = await synthesize(modelDir, voiceFile, brokenPath, { breakState: true })
      if (!broken.ok) {
        console.log(`[ INCONC ] the broken arm could not run: ${broken.why}`)
        console.log('           The engine must honour `__proveZeroFill` for this proof to exist.')
        process.exit(2)
      }
      const brokenText = await transcribe(brokenPath, sttDir)
      if (!brokenText.ok) {
        // A transcriber that refuses garbled audio is still evidence the audio changed.
        console.log(`[  ok  ] PV-010     went RED: the transcriber could not read the broken audio at all`)
      } else {
        const brokenWer = wer(SENTENCE, brokenText.text)
        const wentRed = brokenWer > WER_GATE
        console.log(`[${wentRed ? '  ok  ' : ' FAIL '}] PV-010     went ${wentRed ? 'RED' : 'GREEN'} when the recurrent state is zero-filled instead of NaN-filled (WER ${brokenWer.toFixed(2)})`)
        console.log(`           heard ${JSON.stringify(brokenText.text.slice(0, 90))}`)
        if (!wentRed) {
          console.log('           The state fill is supposed to be load-bearing. If breaking it changes')
          console.log('           nothing, either this oracle is blind or the engine ignores the manifest.')
          failures++
        }
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true })
  }

  console.log(failures === 0 ? '\nThe engine says what it was asked to say.' : `\n${failures} check(s) did not.`)
  process.exit(failures === 0 ? 0 : 1)
}

await main()
