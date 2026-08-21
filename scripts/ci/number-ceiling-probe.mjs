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
 *
 * EXIT CODES — the caller must be able to tell these apart
 *   0  the ceiling holds on this engine: a bare 1234567 is read as words
 *   1  the ceiling is WRONG on this engine: it reads the digits one at a time
 *   2  no synthesizer COMMAND on this machine (P25). Nothing was measured.
 *   3  the probe itself is broken — the control did not differ, so it can tell nothing apart
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

    /* ---- 3. The verdict on 1234567. Classified by proximity, not by equality: engines word
     * large numbers differently (espeak-ng adds British "and" and a phrase break), and demanding
     * OUR wording would redden a perfectly good engine. What matters to the listener is only
     * whether it is a NUMBER or a DIGIT STRING, and those two are far apart in length. */
    const dWords = Math.abs(r.digits.bytes - r.words.bytes)
    const dSpelled = Math.abs(r.digits.bytes - r.oneAtATime.bytes)
    const readsAsWords = dWords < dSpelled
    console.log(`\n  "1234567" is ${r.digits.bytes} B; spelled-out words are ${r.words.bytes} B `
      + `(Δ${dWords}); one-digit-at-a-time is ${r.oneAtATime.bytes} B (Δ${dSpelled}).`)

    if (engine.phonemes) {
      console.log(`\n  phonemes("1234567")  ${await engine.phonemes(DIGITS)}`)
      console.log(`  phonemes(words)      ${await engine.phonemes(WORDS)}`)
    }

    console.log('')
    if (readsAsWords && millionSpoken) {
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
