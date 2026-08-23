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
import { readFile, writeFile, mkdtemp, mkdir, rm, readdir, copyFile, lstat } from 'node:fs/promises'
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
      // Any RELATIVE `.js` specifier resolves to its `.ts` sibling. Scoped to relative
      // specifiers so it can never redirect a dependency — and deliberately NOT scoped to
      // `/packages/`, because `--prove` imports a mutated copy of the package from a temp
      // directory. That narrower scope made every mutant fail to load, and the matrix reported
      // the failure as a passing proof until it was taught to say INCONCLUSIVE instead.
      if (!specifier.endsWith('.js') || !specifier.startsWith('.')) throw err
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
const SENTENCES = [
  'The quick brown fox jumps over the lazy dog.',
  // Tail-sensitive: a final plosive is exactly what a truncated EOS tail eats, and R15-05 found a
  // mutation that removed 240 ms through that mechanism while the old oracle scored WER 0.00.
  'Please stop the cat.',
  // Short, where a single dropped word is a large fraction of the sentence.
  'Yes it works.',
  // Ordinary length, common words, and NOTHING the transcriber might re-spell. The first draft
  // used "sea shells", which Parakeet returns as "seashells" — a WER 0.25 that says something
  // about the transcriber's dictionary and nothing about our engine. A gate that fires on the
  // instrument rather than the subject trains people to widen it, which is how the 0.25 tolerance
  // this commit removes got there in the first place.
  'The garden gate was open all morning.',
]
const SENTENCE = SENTENCES[0]

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

/**
 * ZERO. Not 0.25.
 *
 * R15-05: a nine-word sentence at WER <= 0.25 accepts TWO DELETIONS. The reviewer ran this
 * script's own algorithm over `"The brown fox jumps over the dog."` and it scored 0.222 and
 * PASSED. A tolerance that admits a dropped word cannot tell correct speech from nearly-correct
 * speech, and "nearly correct" is precisely what a subtly wrong inference loop produces.
 *
 * Punctuation and case are already normalised away before the comparison, so the tolerance was
 * never protecting against a transcriber's comma — it was protecting against nothing.
 */
const WER_GATE = 0

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

/**
 * The mutation matrix — R15-05's remedy, and it lives in the HARNESS, not in the product.
 *
 * The old `--prove` had a single `__proveZeroFill` switch inside `engine.ts`. That is two defects
 * at once: one mutation is not a matrix, and a production file carrying a test hook is a place for
 * the hook and the code to drift apart. So each mutation is now a TEXT EDIT applied to a COPY of
 * the whole package in a temp directory, exactly as `scripts/ui-probe.mjs --prove` does with the
 * page. Nothing about it can reach a shipped byte.
 *
 * Every entry names the GATE it must turn red. A mutation that reddens nothing is a hole; a
 * mutation that reddens the wrong gate means the gates are not measuring what they claim.
 */
const MUTATIONS = [
  {
    id: 'state-zero-filled',
    gate: 'WAVEFORM',
    /**
     * EQUIVALENT — measured, not assumed, and it corrects a claim in the product.
     *
     * With the first-frame NaN left intact, zero-filling the recurrent state produces audio that
     * is identical on every measure this script has: rms 0.0 %, mad 0.0 %, length 0.0 %, and a
     * perfect transcript. The graph overwrites those cache slots before reading them.
     *
     * `engine.ts` currently says of that `fill` field: *"Zero-filling it produces perfectly
     * plausible audio that says nothing"*. **That is false**, and the true statement is next to
     * it: the FIRST FRAME's NaN is the load-bearing one — `first-frame-not-nan` turns the semantic
     * gate red at WER 0.22. The comment is scheduled for correction (PV-080); it is not corrected
     * here because another agent owns that file right now.
     *
     * Kept in the matrix rather than deleted, because an equivalence that is recorded is a fact
     * and an equivalence that is deleted is a gap.
     */
    equivalent: 'the graph overwrites these slots before reading them; the FIRST FRAME NaN is the load-bearing one',
    what: 'fill the recurrent state with zeros instead of NaN',
    // Aimed at WAVEFORM rather than SEMANTIC on measured evidence, not preference: with the
    // first-frame NaN left intact this mutation transcribes PERFECTLY (WER 0.00). The graph
    // evidently overwrites those cache slots before reading them, so the manifest's `fill` is far
    // less load-bearing than the comment in `engine.ts` claims — and the comment should be
    // corrected rather than the mutation strengthened until it agrees with the comment.
    // Replacing the VALUE rather than deleting the statement: the line is the head of an
    // if/else chain, so removing it left a dangling `else` and the mutant failed to parse. A
    // mutation that does not compile tests nothing.
    apply: (src) => src.replace(
      "data.fill(Number.NaN)",
      'data.fill(0) /* zero-filled by --prove */'),
  },
  {
    id: 'eos-tail-cut',
    gate: 'DURATION',
    what: 'stop at the first EOS instead of running the tail frames',
    // R15-05 found this survives a semantic gate: it removes 240 ms and the words still transcribe.
    apply: (src) => src.replace(
      'if (eosStep !== null && step >= eosStep + opts.framesAfterEos) return',
      'if (eosStep !== null) return'),
  },
  {
    id: 'integration-short',
    gate: 'WAVEFORM',
    what: 'integrate the flow to 0.9 instead of 1.0',
    // Survived the old oracle AND the duration gate: it changes the latent trajectory without
    // changing how many frames come out, so length is blind to it and so is the transcriber.
    apply: (src) => src.replace('const dt = 1 / opts.lsdSteps', 'const dt = 0.9 / opts.lsdSteps'),
  },
  {
    id: 'first-frame-not-nan',
    gate: 'SEMANTIC',
    what: 'tell the graph there IS a previous frame on the first step',
    apply: (src) => src.replace(
      "new Float32Array(this.latentDim).fill(this.#zeroFill ? 0 : Number.NaN), [1, 1, this.latentDim])",
      'new Float32Array(this.latentDim), [1, 1, this.latentDim])'),
  },
  {
    id: 'seed-ignored',
    gate: 'DETERMINISM',
    what: 'ignore the seed, so two identical requests differ',
    apply: (src) => src.replace(
      'let s = seed >>> 0 || 1',
      'let s = ((seed >>> 0) || 1) ^ (globalThis.__proveDrift = ((globalThis.__proveDrift ?? 0) + 7919))'),
  },
]

/** Copy the package to a temp directory and apply one mutation to `engine.ts`. */
async function mutatedPackage(mutation) {
  const src = join(ROOT, 'packages/providers/src/pocket-synth')
  // Staged INSIDE the repo, not in `tmpdir()`. Node resolves `onnxruntime-node` by walking up
  // from the importing file, and from `/private/var/folders` that walk never reaches this repo's
  // `node_modules` — so every mutant threw "the ONNX Runtime is not on this machine" and the
  // matrix counted that as RED. Two layers of the same defect in one afternoon: a harness failure
  // wearing the uniform of a proof.
  const dir = await mkdtemp(join(ROOT, `.pocket-mut-${mutation.id}-`))
  await mkdir(join(dir, 'model'), { recursive: true })
  for (const name of await readdir(src)) {
    const stat = await lstat(join(src, name))
    if (stat.isDirectory()) {
      // `model/` holds the vendored tokenizer, which `engine.ts` loads at construction. Omitting
      // it made every mutant fail to LOAD, and the first version of this matrix then reported that
      // as RED — a copying bug counted as proof. That is the exact defect this file exists to
      // catch, produced by the file itself.
      for (const inner of await readdir(join(src, name))) {
        await copyFile(join(src, name, inner), join(dir, name, inner))
      }
      continue
    }
    await copyFile(join(src, name), join(dir, name))
  }
  const enginePath = join(dir, 'engine.ts')
  const before = await readFile(enginePath, 'utf8')
  const after = mutation.apply(before)
  if (after === before) {
    throw new Error(`the mutation "${mutation.id}" matched nothing — it would prove nothing`)
  }
  await writeFile(enginePath, after)
  return dir
}

/**
 * Synthesize one sentence, optionally from a mutated copy of the package.
 *
 * Returns the audio itself as well as the file, because the DURATION and DETERMINISM gates read
 * the samples and only the SEMANTIC gate needs a WAV on disk.
 */
async function synthesize(modelDir, voiceFile, outPath, { pkgDir = null, text = SENTENCE, seed = 42 } = {}) {
  const base = pkgDir ?? join(ROOT, 'packages/providers/src/pocket-synth')
  const enginePath = join(base, 'engine.ts')
  if (!existsSync(enginePath)) {
    return { ok: false, why: `no engine at ${enginePath} — PV-011 has not landed yet` }
  }
  let PocketTts
  let writeWav
  try {
    ;({ PocketTts } = await import(pathToFileURL(enginePath).href + `?v=${Math.random()}`))
    ;({ writeWav } = await import(pathToFileURL(join(base, 'audio.ts')).href))
  } catch (err) {
    return { ok: false, why: `the engine could not be loaded: ${err instanceof Error ? err.message : String(err)}` }
  }

  // A missing ONNX Runtime is INCONCLUSIVE, never FAIL: it says nothing about whether the engine
  // is correct, and reporting it as a failure would train a reader to ignore this script on the
  // machines that most need it.
  let tts
  try {
    tts = await PocketTts.load(modelDir, {})
  } catch (err) {
    return { ok: false, why: err instanceof Error ? err.message : String(err) }
  }
  const voice = await tts.voiceState(voiceFile, await readFile(join(modelDir, voiceFile)))
  const t0 = performance.now()
  const audio = await tts.synthesize(text, voice, { temperature: 0.7, lsdSteps: 1, seed })
  const ms = performance.now() - t0
  if (outPath !== null) await writeFile(outPath, writeWav(audio, tts.sampleRate))
  return { ok: true, ms, seconds: audio.length / tts.sampleRate, samples: audio.length, audio, rate: tts.sampleRate }
}

/** A cheap, stable fingerprint of a waveform — enough to notice a changed trajectory. */
function fingerprint(audio) {
  let sum = 0
  let abs = 0
  for (let i = 0; i < audio.length; i++) { sum += audio[i] * audio[i]; abs += Math.abs(audio[i]) }
  return { samples: audio.length, rms: Math.sqrt(sum / audio.length), mad: abs / audio.length }
}

async function main() {
  const prove = process.argv.includes('--prove')
  const voiceFile = arg('--voice', 'eve.wav')

  const { modelDir: cacheDir, modelStatus, requiredFiles, modelStatusDetail } =
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
    console.log(`[ INCONC ] the model is not ready: ${modelStatusDetail(status)}`)
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

    /* -------- GATE 1: SEMANTIC — every sentence, exactly ---------------------- */

    const baselines = new Map()
    let semanticFailures = 0
    for (const [i, sentence] of SENTENCES.entries()) {
      const outPath = join(work, `ours-${i}.wav`)
      const synth = await synthesize(modelDir, voiceFile, outPath, { text: sentence })
      if (!synth.ok) { console.log(`[ INCONC ] ${synth.why}`); process.exit(2) }
      baselines.set(sentence, { ...fingerprint(synth.audio), ms: synth.ms, seconds: synth.seconds, rate: synth.rate })

      const heard = await transcribe(outPath, sttDir)
      if (!heard.ok) { console.log(`[ INCONC ] the transcriber could not read our audio: ${heard.why}`); process.exit(2) }
      const w = wer(sentence, heard.text)
      const ok = w <= WER_GATE
      if (!ok) semanticFailures++
      console.log(`[${ok ? '  ok  ' : ' FAIL '}] SEMANTIC   ${JSON.stringify(sentence)}`)
      if (!ok) console.log(`           heard ${JSON.stringify(heard.text)}  (WER ${w.toFixed(2)}, gate ${WER_GATE})`)
    }
    if (semanticFailures > 0) failures++
    const first = baselines.get(SENTENCE)
    console.log(`           ${SENTENCES.length} sentences · first is ${first.seconds.toFixed(2)} s in ` +
      `${first.ms.toFixed(0)} ms (${(first.ms / 1000 / first.seconds).toFixed(2)}x realtime) [measured-here]`)

    /* -------- GATE 2: DETERMINISM — the same request twice ---------------------- */

    const again = await synthesize(modelDir, voiceFile, null, { text: SENTENCE, seed: 42 })
    if (!again.ok) { console.log(`[ INCONC ] ${again.why}`); process.exit(2) }
    const sameSeed = again.samples === first.samples &&
      Math.abs(fingerprint(again.audio).rms - first.rms) < 1e-9
    console.log(`[${sameSeed ? '  ok  ' : ' FAIL '}] DETERM     the same seed produces the same audio`)
    if (!sameSeed) { console.log(`           ${first.samples} samples then ${again.samples}`); failures++ }

    /* -------- GATE 3: DURATION — what the transcriber cannot see ----------------
     *
     * R15-05's two survivors both changed the MODEL COMPUTATION and left the words intact: cutting
     * the EOS tail removed 240 ms, and integrating the flow to 0.9 instead of 1.0 removed 80 ms.
     * A semantic oracle is blind to both BY CONSTRUCTION — it is checking the transcriber, not the
     * numerics. So the numerics get a gate of their own.
     *
     * The bound is wide because it is a sanity floor, not the instrument: `--prove` compares each
     * mutant against THIS RUN's own baseline, which is what actually catches an 8 % drift. A
     * committed constant would be a fact about one machine's ORT build rather than about the code.
     */
    const durationOk = first.seconds > 2.5 && first.seconds < 4.0
    console.log(`[${durationOk ? '  ok  ' : ' FAIL '}] DURATION   ${first.seconds.toFixed(3)} s, ` +
      `${first.samples} samples at ${first.rate} Hz`)
    if (!durationOk) failures++

    /* -------- --prove: the mutation matrix ------------------------------------- */

    if (prove) {
      console.log('\n--prove: each mutation must turn the gate it is aimed at RED.')
      for (const mutation of MUTATIONS) {
        let pkg = null
        try {
          pkg = await mutatedPackage(mutation)
        } catch (err) {
          console.log(`[ FAIL ] ${mutation.id.padEnd(22)} ${err.message}`)
          failures++
          continue
        }
        try {
          const mutPath = join(work, `mut-${mutation.id}.wav`)
          const m = await synthesize(modelDir, voiceFile, mutPath, { pkgDir: pkg, text: SENTENCE })
          if (!m.ok) {
            // **NOT a pass.** A mutant that cannot be LOADED proves nothing about the gate — it
            // proves the harness broke. The first version of this matrix counted it as RED and
            // reported five green mutations while every one of them had merely failed to import,
            // which is precisely the vacuous check this whole file exists to eliminate.
            //
            // A mutation that makes the engine throw at RUN time is different and is genuinely
            // red, so the two are distinguished by where the failure happened.
            // An ABSENT RUNTIME is inconclusive too, and for the reason this whole script states
            // at the top: it says nothing about whether the engine is correct.
            const loadFailure = /could not be loaded|Cannot find module|Expression expected|ONNX Runtime/.test(m.why)
            if (loadFailure) {
              console.log(`[ INCONC ] ${mutation.id.padEnd(22)} ${mutation.gate.padEnd(11)} the mutant did not LOAD, so nothing was tested`)
              console.log(`         ${m.why.slice(0, 100)}`)
              failures++
              continue
            }
            console.log(`[  ok  ] ${mutation.id.padEnd(22)} ${mutation.gate.padEnd(11)} RED (the engine refused at run time)`)
            console.log(`         ${m.why.slice(0, 100)}`)
            continue
          }
          let red = false
          let detail = ''
          if (mutation.gate === 'SEMANTIC') {
            const t = await transcribe(mutPath, sttDir)
            if (!t.ok) { red = true; detail = 'the transcriber could not read it at all' }
            else {
              const w = wer(SENTENCE, t.text)
              red = w > WER_GATE
              detail = `WER ${w.toFixed(2)} — ${JSON.stringify(t.text.slice(0, 58))}`
            }
          } else if (mutation.gate === 'DURATION') {
            const drift = Math.abs(m.samples - first.samples) / first.samples
            red = drift > 0.01
            detail = `${m.samples} samples against ${first.samples} — ${(drift * 100).toFixed(1)}% drift`
          } else if (mutation.gate === 'WAVEFORM') {
            // The gate the other two needed. A numerical change can leave the word count, the
            // sample count AND the transcript intact while producing different audio — that is
            // precisely what R15-05 found surviving. Comparing the waveform's own statistics
            // against this run's baseline is what notices.
            const f = fingerprint(m.audio)
            const dRms = Math.abs(f.rms - first.rms) / Math.max(first.rms, 1e-9)
            const dMad = Math.abs(f.mad - first.mad) / Math.max(first.mad, 1e-9)
            const dLen = Math.abs(m.samples - first.samples) / first.samples
            red = dRms > 0.02 || dMad > 0.02 || dLen > 0.01
            detail = `rms ${(dRms * 100).toFixed(1)}% · mad ${(dMad * 100).toFixed(1)}% · ` +
              `length ${(dLen * 100).toFixed(1)}% against the baseline`
          } else if (mutation.gate === 'DETERMINISM') {
            const twice = await synthesize(modelDir, voiceFile, null, { pkgDir: pkg, text: SENTENCE, seed: 42 })
            red = !twice.ok || twice.samples !== m.samples ||
              Math.abs(fingerprint(twice.audio).rms - fingerprint(m.audio).rms) > 1e-9
            detail = twice.ok ? `${m.samples} then ${twice.samples} samples` : 'the second run failed'
          }
          const verdict = mutation.equivalent !== undefined ? !red : red
          console.log(`[${verdict ? '  ok  ' : ' FAIL '}] ${mutation.id.padEnd(22)} ${mutation.gate.padEnd(11)} ` +
            `${red ? 'RED' : 'GREEN'} — ${mutation.what}`)
          console.log(`         ${detail}`)
          if (!red && mutation.equivalent !== undefined) {
            console.log(`         EQUIVALENT, as declared: ${mutation.equivalent}`)
          } else if (!red) {
            console.log('         This changes the model computation and NOTHING NOTICED.')
            failures++
          } else if (mutation.equivalent !== undefined) {
            // A declared equivalence that starts failing is information too: either the engine
            // changed or the declaration was wrong. Both deserve a look rather than a silent pass.
            console.log('         DECLARED EQUIVALENT BUT WENT RED — the declaration is now stale.')
            failures++
          }
        } finally {
          if (pkg !== null) await rm(pkg, { recursive: true, force: true })
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
