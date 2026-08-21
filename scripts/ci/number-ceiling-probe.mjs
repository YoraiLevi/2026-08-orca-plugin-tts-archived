#!/usr/bin/env node
/**
 * The million-ceiling probe — Job J25. Runs on macOS, Linux and Windows.
 *
 * WHAT QUESTION THIS ANSWERS
 *
 * `packages/core/src/normalizer/index.ts` expands numbers to words only below 1,000,000. At or
 * above the ceiling the numeral is handed to the engine untouched, on the belief that "the engine
 * handles them better". That belief was `[measured-here]` on macOS `say` and `[claimed]`
 * everywhere else — and if espeak-ng were to spell a bare `1234567` digit by digit, the ceiling
 * would be a **Linux-only defect hiding behind a macOS-only probe**. This script is what settles
 * it, per engine, on the machine the engine is actually installed on.
 *
 * This is assistive technology. A number read as seven separate digits mid-sentence is not
 * cosmetic for someone listening rather than reading.
 *
 * HOW IT IS SHAPED SO IT CANNOT PASS VACUOUSLY
 *
 * 1. **Everything renders to a FILE.** `say -o`, `espeak-ng -w`, SAPI `SetOutputToWaveFile`.
 *    Nothing here opens the audio device — the author may be sitting at the machine (PITFALLS
 *    **P31**), and a probe that makes noise will not get run twice.
 * 2. **A CONTROL that must differ.** `one million and one` is rendered alongside `one million`.
 *    If an engine checksums every string the same, the comparison is measuring nothing and this
 *    exits non-zero *before* reporting any verdict. A pass is only meaningful because this could
 *    have failed.
 * 3. **ABSENT is a distinct outcome from DISAGREES.** Stock Ubuntu ships `libespeak-ng1` and
 *    `espeak-ng-data` but NOT `/usr/bin/espeak-ng` — PITFALLS **P25**, which already cost this
 *    project a release where Linux made no sound at all. A probe that quietly skips on a missing
 *    binary reproduces P25 instead of catching it, so a missing COMMAND is reported by name,
 *    separately from a missing LIBRARY, and is a failure rather than a skip unless
 *    `--allow-absent` is passed.
 * 4. **The verdict is classified, not asserted.** Engines word large numbers differently — macOS
 *    `say` says "one million two hundred thirty four thousand…", espeak-ng inserts British "and"
 *    and a phrase break. Demanding a checksum match against OUR wording would go red on a
 *    perfectly good engine. So the digit form is classified by which reference render it is
 *    CLOSER to: the spelled-out words, or the same digits spoken one at a time. That distinction
 *    is the one the listener actually cares about.
 * 5. **INCONCLUSIVE is a fourth outcome, not a rounding of the other three.** Because the verdict
 *    is reached BY COMPARISON, it is only reachable if the two references are distinguishable on
 *    THAT engine and the string under test lands decisively nearer one of them. If either fails,
 *    the probe says it cannot tell — and that is a successful run reporting the truth, not a
 *    passing one. A probe that can only return pass-or-absent cannot go red for the thing it was
 *    built to detect, which is **P32**'s shape. `--prove-inconclusive[=refs|tie]` demonstrates
 *    both routes to it.
 *
 * WHAT IS MEASURED, AND WHY IT DOES NOT CARE ABOUT MACHINE LOAD
 *
 * Every comparison here is over the SIZE AND CHECKSUM OF THE RENDERED PCM — a property of the
 * engine's output. No wall-clock duration enters the verdict anywhere. A duration is a property
 * of what else the machine was doing that day (this repo has watched a two-sentence reply take
 * 71 s at load 51); a rendered byte count is not, and re-renders are re-measured each run to give
 * the margin an empirical noise floor rather than an assumed one.
 *
 * EXIT CODES — the caller must be able to tell these apart
 *   0  WORDS         the ceiling holds: a bare 1234567 is read as a number
 *   1  DIGITS        the ceiling is WRONG here: it is read one digit at a time
 *   2  ABSENT        no synthesizer COMMAND on this machine (P25). Nothing was measured.
 *   3  BROKEN        the control did not differ, so the harness can tell nothing apart
 *   4  INCONCLUSIVE  the engine is PRESENT and answered, and the harness cannot tell
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ALLOW_ABSENT = process.argv.includes('--allow-absent')
/* The gate that checks THIS gate. Substitutes an engine that renders every string to the same
 * bytes — a synthesizer that says nothing distinguishable — and requires exit 3. Without this,
 * "the control differed" is a line nobody has ever seen fail. */
const PROVE_CONTROL = process.argv.includes('--prove-control')
/* The same idea for the INCONCLUSIVE outcome, which is the one this probe is most likely to owe
 * an honest answer with. `refs` stubs an engine whose two reference renders are identical, so
 * nothing can be measured against them; `tie` stubs one whose references DO separate but which
 * puts the string under test exactly between them. Both must exit 4. */
const PROVE_INCONCLUSIVE = (process.argv.find((a) => a.startsWith('--prove-inconclusive')) ?? '')
  .split('=')[1] ?? (process.argv.includes('--prove-inconclusive') ? 'refs' : null)

/* The strings under test. `digits` is the one in question; the other two bracket it. */
const DIGITS = '1234567'
const DIGITS_SEP = '1,234,567'
const WORDS = 'one million two hundred thirty four thousand five hundred sixty seven'
const ONE_AT_A_TIME = '1 2 3 4 5 6 7'
const MILLION = '1000000'
const MILLION_SEP = '1,000,000'
const MILLION_WORDS = 'one million'
const CONTROL = 'one million and one' /* must NOT match MILLION_WORDS, or nothing here means anything */

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    let out = '', err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('error', (e) => resolve({ code: -1, out, err: String(e) }))
    p.on('close', (code) => resolve({ code, out, err }))
  })
}

/* ============================================================ engine selection
 * The binary is PROBED, never inferred from a library or a data package — that inference is
 * exactly P25. On Linux we additionally look for the library so a missing command can be
 * reported as the P25 shape rather than as a bare "not installed".
 */
async function pickEngine(dir) {
  if (PROVE_INCONCLUSIVE) {
    const { writeFile } = await import('node:fs/promises')
    /* Every stubbed size is distinct except where the outcome under demonstration requires a
     * collision, so the control, the separator checks and the million triple all still PASS —
     * the run reaches the discrimination check the way a real one would. */
    const tie = PROVE_INCONCLUSIVE === 'tie'
    const size = (text) => {
      if (text === MILLION || text === MILLION_SEP || text === MILLION_WORDS) return 1000
      if (text === CONTROL) return 2000
      if (text === WORDS) return 4000
      if (text === ONE_AT_A_TIME) return tie ? 6000 : 4000 /* `refs`: identical to WORDS */
      return tie ? 5000 : 3000 /* the digit forms; `tie` lands them exactly between */
    }
    return {
      name: `STUB — ${tie ? 'references separate but "1234567" ties between them' : 'an engine whose two references are indistinguishable'}`,
      version: 'negative control, not a real synthesizer',
      render: async (text, tag) => {
        const f = join(dir, `${tag}.wav`)
        await writeFile(f, Buffer.alloc(size(text), size(text) & 0xff))
        return f
      },
    }
  }

  if (PROVE_CONTROL) {
    const { writeFile } = await import('node:fs/promises')
    return {
      name: 'STUB — an engine that renders every string identically',
      version: 'negative control, not a real synthesizer',
      render: async (_text, tag) => {
        const f = join(dir, `${tag}.wav`)
        await writeFile(f, Buffer.alloc(1024, 7))
        return f
      },
    }
  }

  if (process.platform === 'darwin') {
    const v = await run('say', ['-v', '?'])
    if (v.code !== 0) return { name: 'say', absent: true, why: '`say` did not answer `-v ?`' }
    return {
      name: 'say (macOS AVSpeechSynthesizer)',
      version: 'bundled with the OS',
      render: async (text, tag) => {
        const f = join(dir, `${tag}.wav`)
        const r = await run('say', ['-o', f, '--data-format=LEI16@22050', text])
        if (r.code !== 0) throw new Error(`say failed: ${r.err.trim()}`)
        return f
      },
    }
  }

  if (process.platform === 'linux') {
    const v = await run('espeak-ng', ['--version'])
    if (v.code !== 0) {
      /* P25: distinguish "the LIBRARY is here, the COMMAND is not" from "nothing is here". */
      const lib = await run('sh', ['-c', 'ldconfig -p 2>/dev/null | grep -c libespeak-ng || true'])
      const libCount = Number.parseInt(lib.out.trim(), 10) || 0
      return {
        name: 'espeak-ng',
        absent: true,
        why: libCount > 0
          ? `libespeak-ng is installed (${libCount} entr${libCount === 1 ? 'y' : 'ies'} in ldconfig) but /usr/bin/espeak-ng is NOT. `
            + 'This is PITFALLS P25 exactly: a shared library is not a CLI. Install the `espeak-ng` package, '
            + 'not `libespeak-ng1`.'
          : 'no espeak-ng command and no libespeak-ng on this machine',
      }
    }
    return {
      name: 'espeak-ng',
      version: v.out.trim().split('\n')[0],
      render: async (text, tag) => {
        const f = join(dir, `${tag}.wav`)
        const r = await run('espeak-ng', ['-w', f, text])
        if (r.code !== 0) throw new Error(`espeak-ng failed: ${r.err.trim()}`)
        return f
      },
      /* espeak-ng can hand back its phoneme string, which is direct evidence rather than
       * inference from a byte count. Informational — the verdict does not depend on it. */
      phonemes: async (text) => (await run('espeak-ng', ['-q', '-x', text])).out.trim(),
    }
  }

  if (process.platform === 'win32') {
    const v = await run('powershell', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Speech; "ok"'])
    if (v.code !== 0 || !v.out.includes('ok')) {
      return { name: 'SAPI', absent: true, why: 'System.Speech did not load under powershell' }
    }
    return {
      name: 'SAPI (System.Speech.Synthesis)',
      version: 'bundled with Windows',
      render: async (text, tag) => {
        const f = join(dir, `${tag}.wav`)
        /* SetOutputToWaveFile, never SetOutputToDefaultAudioDevice — P31. */
        const ps = [
          'Add-Type -AssemblyName System.Speech',
          '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
          `$s.SetOutputToWaveFile(${JSON.stringify(f)})`,
          `$s.Speak(${JSON.stringify(text)})`,
          '$s.Dispose()',
        ].join('; ')
        /* Same invocation shape as scripts/smoke-synth.mjs, which is already green on the
         * Windows leg of `test` — so this step's failure would be about NUMBERS, not about
         * whether SAPI can write a file. `-STA` because PowerShell needs it here (`2425c70`). */
        const r = await run('powershell', ['-NoProfile', '-NonInteractive', '-STA', '-Command', ps])
        if (r.code !== 0) throw new Error(`SAPI failed: ${r.err.trim()}`)
        return f
      },
    }
  }

  return { name: process.platform, absent: true, why: `no synthesizer known for platform ${process.platform}` }
}

/* WAV headers carry no timing surprises here — every render on one engine uses one format — but
 * the checksum is taken over the whole file and the length reported separately, so a difference
 * that is only header-deep would show as "same length, different sum" rather than pass silently.
 */
async function digest(file) {
  const buf = await readFile(file)
  return { sum: createHash('sha256').update(buf).digest('hex').slice(0, 8), bytes: buf.length }
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'orca-tts-numprobe-'))
  try {
    const engine = await pickEngine(dir)
    console.log(`=== million-ceiling probe — ${process.platform} / ${engine.name} ===\n`)

    if (engine.absent) {
      console.log(`  ABSENT  ${engine.name} is not callable on this machine.`)
      console.log(`          ${engine.why}`)
      console.log('\n  NOTHING WAS MEASURED. This is not the same as "the engine agrees" and must')
      console.log('  not be recorded as one. The claim stays `[claimed]` on this platform.')
      if (ALLOW_ABSENT) { console.log('\n  --allow-absent: exiting 0 anyway, by explicit request.'); return 0 }
      return 2
    }
    console.log(`  engine  ${engine.version}\n`)

    const cases = [
      ['digits', DIGITS], ['digitsSep', DIGITS_SEP], ['words', WORDS], ['oneAtATime', ONE_AT_A_TIME],
      ['million', MILLION], ['millionSep', MILLION_SEP], ['millionWords', MILLION_WORDS],
      ['control', CONTROL],
    ]
    const r = {}
    for (const [tag, text] of cases) {
      r[tag] = { text, ...(await digest(await engine.render(text, tag))) }
      console.log(`  ${tag.padEnd(13)} ${String(r[tag].bytes).padStart(7)} B  ${r[tag].sum}  ${JSON.stringify(text)}`)
    }
    console.log('')

    /* ---- 0. THE CONTROL. Everything below is worthless if this does not hold. */
    if (r.control.sum === r.millionWords.sum) {
      console.log('  BROKEN  the control string checksums the same as "one million".')
      console.log('          This comparison cannot tell two utterances apart, so no verdict it')
      console.log('          produces means anything. Fix the probe before trusting any result.')
      return 3
    }
    console.log(`  CONTROL ok   "one million and one" (${r.control.sum}) differs from "one million" `
      + `(${r.millionWords.sum}) — the comparison can go red.`)

    /* ---- 1. Separators are invisible to the engine, which is why the normalizer keeps them. */
    const sepInvariant = r.digits.sum === r.digitsSep.sum && r.million.sum === r.millionSep.sum
    console.log(`  ${sepInvariant ? 'PASS   ' : 'DIFFERS'} separators: "1234567" vs "1,234,567" and "1000000" vs "1,000,000" `
      + `render ${sepInvariant ? 'byte-identically' : 'DIFFERENTLY — the normalizer must pick one form'}`)

    /* ---- 2. The exact million, three ways of writing it. An exact checksum match here is the
     * cleanest evidence available: the engine produced literally the same utterance. */
    const millionSpoken = r.million.sum === r.millionWords.sum
    console.log(`  ${millionSpoken ? 'PASS   ' : 'FAIL   '} "1000000" ${millionSpoken ? '===' : '!=='} "one million" `
      + `(${r.million.sum} vs ${r.millionWords.sum})`)

    /* ---- 3. THE NOISE FLOOR, MEASURED. Everything below compares byte counts of rendered
     * audio, and a margin is only meaningful against a noise figure somebody actually took. So
     * take it: render the SAME string three more times and report the spread. On a deterministic
     * engine this is 0 and the comparison is exact; if an engine ever dithers, the margin below
     * widens with it rather than silently shrinking to nothing.
     *
     * NOTE ON WHAT IS BEING MEASURED, because it is easy to mistake for a timing number. This is
     * the SIZE OF THE RENDERED PCM, not wall-clock. It is a property of the engine's output, not
     * of what else the box was doing — the same class of evidence as a checksum, and immune to
     * machine load in the way an elapsed-time reading is not. Durations appear nowhere in this
     * script's verdict.
     */
    const reps = []
    for (const i of [1, 2, 3]) reps.push(await digest(await engine.render(WORDS, `noise${i}`)))
    const lens = reps.map((x) => x.bytes)
    const noise = Math.max(...lens) - Math.min(...lens)
    /* Length stability and CONTENT stability are reported separately, because on macOS `say` they
     * have been observed to differ: a long string re-rendered at a different moment produced the
     * same 167,560 B at a DIFFERENT checksum, while the short strings stayed sum-stable across
     * every run. So on this engine the byte COUNT is the robust quantity and the checksum is not,
     * for long utterances. That is a fact about the engine worth seeing rather than averaging
     * away — and it is why the verdict below rests on lengths, using checksums only for
     * within-run identity between two strings rendered seconds apart. */
    const sumStable = new Set(reps.map((x) => x.sum)).size === 1
    console.log(`  NOISE   ${noise} B spread over 3 re-renders of one string (${lens.join(', ')}) `
      + `— the margin every comparison below must beat`)
    console.log(`  ${sumStable ? 'STABLE ' : 'DITHERS'} re-render checksums ${sumStable ? 'identical' : 'DIFFER at identical length'}`
      + ` (${reps.map((x) => x.sum).join(', ')})`)

    /* ---- 4. THE DISCRIMINATION CHECK. The verdict on `1234567` is reached BY COMPARISON against
     * two references — the spelled-out words and the same digits one at a time. That comparison is
     * only capable of answering anything if the two REFERENCES are themselves distinguishable on
     * THIS engine. If an engine's prosody lands them on top of each other, the honest answer is
     * INCONCLUSIVE, not "acceptable": a probe that can only return pass-or-absent cannot go red
     * for the thing it was built to detect, which is P32's shape.
     *
     * Two ways it can be inconclusive, and they are reported separately:
     *   (a) the references do not separate — nothing can be measured against them;
     *   (b) they separate, but `1234567` does not land decisively nearer either one.
     */
    const separation = Math.abs(r.words.bytes - r.oneAtATime.bytes)
    const referencesSeparate = r.words.sum !== r.oneAtATime.sum && separation > noise
    console.log(`  SEPARN  references are ${separation} B apart (words ${r.words.bytes} B vs `
      + `digit-by-digit ${r.oneAtATime.bytes} B), sums ${r.words.sum} vs ${r.oneAtATime.sum}`)

    const dWords = Math.abs(r.digits.bytes - r.words.bytes)
    const dSpelled = Math.abs(r.digits.bytes - r.oneAtATime.bytes)
    /* Where `1234567` sits on the axis between the two references. 0 = exactly on the spelled-out
     * words, 1 = exactly on digit-by-digit. The dead band is deliberately wide: a reading in it
     * means the engine did something this harness was not built to interpret, and inventing a
     * verdict from a near-tie is precisely the failure mode being guarded against. */
    const DEAD_BAND = [0.35, 0.65]
    const position = (dWords + dSpelled) === 0 ? 0.5 : dWords / (dWords + dSpelled)
    console.log(`  POSITN  "1234567" is ${r.digits.bytes} B — Δ${dWords} from the words, `
      + `Δ${dSpelled} from digit-by-digit; position ${position.toFixed(3)} on the axis `
      + `(dead band ${DEAD_BAND[0]}–${DEAD_BAND[1]})`)

    if (engine.phonemes) {
      console.log(`\n  phonemes("1234567")  ${await engine.phonemes(DIGITS)}`)
      console.log(`  phonemes(words)      ${await engine.phonemes(WORDS)}`)
    }

    console.log('')
    if (!referencesSeparate) {
      console.log(`  INCONCLUSIVE  ${engine.name} is PRESENT and answered every render, but its two`)
      console.log(`                reference renders are not distinguishable (${separation} B apart, `
        + `noise floor ${noise} B).`)
      console.log('                Nothing can be concluded about "1234567" by comparing against them.')
      console.log('                This is a SUCCESSFUL run of the probe reporting that it cannot tell,')
      console.log('                which is different from the engine being acceptable. The claim stays')
      console.log('                `[claimed]` on this platform until a discriminating probe exists.')
      return 4
    }
    if (position > DEAD_BAND[0] && position < DEAD_BAND[1]) {
      console.log(`  INCONCLUSIVE  ${engine.name} is PRESENT and its references DO separate, but`)
      console.log(`                "1234567" lands at ${position.toFixed(3)} — inside the dead band, so it is`)
      console.log('                not decisively nearer either reference. Reporting a verdict from a')
      console.log('                near-tie would be inventing one. The claim stays `[claimed]` here.')
      return 4
    }
    if (position <= DEAD_BAND[0] && millionSpoken) {
      console.log(`  VERDICT  ${engine.name} reads a bare "${DIGITS}" AS A NUMBER, not as seven digits.`)
      console.log('           The normalizer\'s million ceiling is SAFE on this engine: handing the')
      console.log('           numeral to the engine is the right call above 999,999.')
      return 0
    }
    console.log(`  VERDICT  ${engine.name} DOES NOT read "${DIGITS}" as a number.`)
    console.log('           The million ceiling in packages/core/src/normalizer/index.ts is a defect')
    console.log('           on this platform: numberToWords must be extended past 999,999, or the')
    console.log('           numeral rewritten before it reaches this engine.')
    return 1
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(3) })
