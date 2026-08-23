/**
 * R18-03: `leakedSayAfter` was write-only, and `pgrep -x say` cannot tell
 * `say -o` (silent, correct) from bare `say` (audible, P31).
 *
 * These tests do not open the audio device. The RED arm spawns a PATH stub
 * named `say` that exits 0; `/usr/bin/say` is never reached.
 */
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyP31, auditSaySpawns, classifySayArgs, leftoverSayIsOrphan, p31Rows, readSpawnLog,
  recorderLoadedFrom,
} from './artifact-e2e.mjs'
import { judge, OS_RATE } from './artifact-score.mjs'
import { parseExecArgv, unwrapSpawn } from './ci/spawn-argv.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PARENT = join(ROOT, 'scripts/artifact-e2e.mjs')
const RECORDER = join(ROOT, 'scripts/ci/no-audio-recorder.mjs')

const made = []
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true })
})

const namedSub =
  'pocket was unavailable (pocket: Pocket TTS model is not ready in /tmp/empty); using System voice'

function goodAbsent (extra = {}) {
  return {
    error: null,
    chunkSampleRate: OS_RATE,
    displayName: 'System voice',
    rung: 'fallback',
    substitution: namedSub,
    signal: true,
    bytes: 110_402,
    leakedSayAfter: 0,
    spawnViolations: [],
    saySpawns: [{ cmd: 'say', args: ['-o', '/tmp/x.wav', '--data-format=LEI16@22050', '--', 'hello'] }],
    recorderLoaded: true,
    ...extra,
  }
}

async function recordSay (args) {
  const dir = await mkdtemp(join(tmpdir(), 'artifact-e2e-p31-'))
  made.push(dir)
  const stub = join(dir, process.platform === 'win32' ? 'say.cmd' : 'say')
  await writeFile(stub, process.platform === 'win32' ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const log = join(dir, 'spawns.ndjson')
  const decoy = join(dir, 'decoy.mjs')
  await writeFile(
    decoy,
    `import { spawnSync } from 'node:child_process'\n` +
    `spawnSync('say', ${JSON.stringify(args)}, { stdio: 'ignore' })\n`,
  )
  spawnSync(process.execPath, ['--import', pathToFileURL(RECORDER).href, decoy], {
    env: { ...process.env, VOICE_LAB_SPAWN_LOG: log, PATH: `${dir}${delimiter}${process.env.PATH ?? ''}` },
    encoding: 'utf8',
    timeout: 8_000,
    killSignal: 'SIGKILL',
  })
  return readSpawnLog(log)
}

describe('R18-03: classifySayArgs distinguishes -o from bare say', () => {
  it('RED: bare say is an aloud violation', () => {
    const v = classifySayArgs(['hello there'])
    expect(v, 'bare `say` must be P31').not.toBeNull()
    expect(v.violation).toBe('aloud')
  })

  it('GREEN: say -o is not a violation', () => {
    expect(classifySayArgs(['-o', '/tmp/x.wav', '--data-format=LEI16@22050', '--', 'hello'])).toBeNull()
  })

  it('GREEN: say -v ? lists voices, does not speak', () => {
    expect(classifySayArgs(['-v', '?'])).toBeNull()
  })
})

describe('R18-03: leakedSayAfter is read (the write-only mutant)', () => {
  it('RED: leakedSayAfter=99 is a failure row — the Round 18 mutant', () => {
    const rows = p31Rows('ABSENT', goodAbsent({ leakedSayAfter: 99 }))
    expect(rows.join('\n')).toMatch(/leakedSayAfter=99/)
  })

  it('RED: omitting leakedSayAfter is a failure row', () => {
    const { leakedSayAfter: _drop, ...rest } = goodAbsent()
    void _drop
    const rows = p31Rows('ABSENT', rest)
    expect(rows.join('\n')).toMatch(/omitted leakedSayAfter/)
  })

  it('CONTROL: leftover 0 + say -o is silent', () => {
    expect(p31Rows('ABSENT', goodAbsent(), 'darwin')).toEqual([])
  })
})

describe('R18-03: a recorded bare say fails, say -o does not', () => {
  it('RED: intercepting spawn of bare say reports a P31 violation', async () => {
    const entries = await recordSay(['hello there'])
    expect(entries.some((e) => (e.args ?? []).includes('hello there') && !(e.args ?? []).includes('-o')),
      'recorder must have seen the bare argv').toBe(true)
    const audit = auditSaySpawns(entries)
    expect(audit.violations.length, JSON.stringify(audit)).toBeGreaterThan(0)
    const rows = p31Rows('ABSENT', goodAbsent({
      spawnViolations: audit.violations,
      saySpawns: audit.says,
    }))
    expect(rows.join('\n')).toMatch(/P31/)
  })

  it('GREEN: intercepting spawn of say -o is not a P31 violation', async () => {
    const out = join(tmpdir(), 'artifact-e2e-p31-green.wav')
    const entries = await recordSay(['-o', out, '--data-format=LEI16@22050', '--', 'hello'])
    expect(entries.some((e) => (e.args ?? []).includes('-o')),
      'recorder must have seen -o').toBe(true)
    const audit = auditSaySpawns(entries)
    expect(audit.sayCount).toBeGreaterThan(0)
    expect(audit.violations).toEqual([])
    expect(p31Rows('ABSENT', goodAbsent({
      spawnViolations: audit.violations,
      saySpawns: audit.says,
    }), 'darwin')).toEqual([])
  })
})

describe('R18-03: applyP31 cannot hide behind exit 2', () => {
  it('turns INCONCLUSIVE into FAIL when leakedSayAfter is 99', () => {
    const inconclusive = judge({
      productKind: 'absent',
      present: null,
      absent: {
        error: null,
        chunkSampleRate: OS_RATE,
        displayName: 'System voice',
        rung: 'fallback',
        substitution: namedSub,
      },
    })
    expect(inconclusive.exit).toBe(2)
    const decision = applyP31(inconclusive, [
      { label: 'ABSENT', r: { leakedSayAfter: 99, spawnViolations: [], saySpawns: [], recorderLoaded: true } },
    ], 'linux')
    expect(decision.exit, 'the R18-03 mutant still hid behind exit 2').toBe(1)
    expect(decision.rows.join('\n')).toMatch(/leakedSayAfter=99/)
  })

  it('CONTROL: leftover 0 does not change a healthy exit 2', () => {
    const inconclusive = judge({
      productKind: 'absent',
      present: null,
      absent: {
        error: null,
        chunkSampleRate: OS_RATE,
        displayName: 'System voice',
        rung: 'fallback',
        substitution: namedSub,
      },
    })
    const decision = applyP31(inconclusive, [
      { label: 'ABSENT', r: goodAbsent() },
    ], 'linux')
    expect(decision.exit).toBe(2)
    expect(decision.rows).toEqual([])
  })
})

describe('R19-05: exec command strings and sh -c are classified as say', () => {
  it('parseExecArgv splits `say hello there` into cmd=say', () => {
    expect(parseExecArgv('say hello there')).toEqual({ cmd: 'say', args: ['hello', 'there'] })
  })

  it('unwraps sh -c \'say hello there\'', () => {
    expect(parseExecArgv("sh -c 'say hello there'")).toEqual({ cmd: 'say', args: ['hello', 'there'] })
    expect(unwrapSpawn('sh', ['-c', 'say hello there'])).toEqual({ cmd: 'say', args: ['hello', 'there'] })
  })

  it('RED: auditSaySpawns sees execSync cmd=`say hello there` args=[] as a violation', () => {
    const audit = auditSaySpawns([
      { api: 'execSync', cmd: 'say hello there', args: [] },
    ])
    expect(audit.sayCount, JSON.stringify(audit)).toBe(1)
    expect(audit.violations).toHaveLength(1)
    expect(audit.violations[0].violation).toBe('aloud')
  })

  it('RED: mixed spawn(-o) + exec(bare) does not hide the exec behind the sibling (R19-05)', () => {
    const audit = auditSaySpawns([
      { api: 'spawnSync', cmd: 'say', args: ['-o', '/tmp/r19-x.wav', '--', 'hello'] },
      { api: 'execSync', cmd: 'say hello there', args: [] },
    ])
    expect(audit.sayCount).toBe(2)
    expect(audit.violations).toHaveLength(1)
    expect(audit.violations[0].args).toEqual(['hello', 'there'])
  })

  it('RED: omitting recorderLoaded is a failure row on linux — empty --import cannot be green', () => {
    const { recorderLoaded: _drop, ...rest } = goodAbsent()
    void _drop
    const rows = p31Rows('ABSENT', rest, 'linux')
    expect(rows.join('\n')).toMatch(/recorder did not load/)
    const decision = applyP31(
      { exit: 2, rows: [], summary: 'INCONCLUSIVE' },
      [{ label: 'ABSENT', r: rest }],
      'linux',
    )
    expect(decision.exit, 'empty --import hid behind exit 2 on linux').toBe(1)
  })

  it('CONTROL: recorderLoaded true + leftover 0 is silent on linux', () => {
    expect(p31Rows('ABSENT', goodAbsent(), 'linux')).toEqual([])
  })
})

describe('R19-06: leftover say -o is not an orphan', () => {
  it('GREEN: `say -o file.wav` leftover argv is not an orphan', () => {
    expect(leftoverSayIsOrphan('say -o /tmp/x.wav --data-format=LEI16@22050 -- hello')).toBe(false)
    expect(leftoverSayIsOrphan('/usr/bin/say -o /tmp/x.wav -- hello')).toBe(false)
    expect(leftoverSayIsOrphan("say -v '?'")).toBe(false)
  })

  it('RED: leftover bare `say hello` is an orphan', () => {
    expect(leftoverSayIsOrphan('say hello there')).toBe(true)
    expect(leftoverSayIsOrphan('/usr/bin/say hello there')).toBe(true)
  })

  it('p31Rows still fails leakedSayAfter=1 (that field is now the ORPHAN count)', () => {
    const rows = p31Rows('ABSENT', goodAbsent({ leakedSayAfter: 1 }), 'darwin')
    expect(rows.join('\n')).toMatch(/leakedSayAfter=1/)
  })
})

describe('the parent actually uses applyP31 (P26)', () => {
  const src = readFileSync(PARENT, 'utf8')

  it('calls applyP31 around judge and prints leakedSayAfter', () => {
    expect(src).toContain('applyP31(')
    expect(src).toContain('judge({')
    expect(src).toContain('leakedSayAfter:')
    expect(src).toMatch(/--import/)
    expect(src).toContain('no-audio-recorder.mjs')
  })
})

describe('R18-03: --prove-p31 demonstrates both colours', () => {
  it('exits 0 and names RED then GREEN, including R19-05/06', { timeout: 20_000 }, () => {
    const r = spawnSync(process.execPath, [PARENT, '--prove-p31'], {
      encoding: 'utf8',
      cwd: ROOT,
    })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    expect(r.status, out).toBe(0)
    expect(out).toMatch(/RED: recorded bare/)
    expect(out).toMatch(/GREEN: recorded `say -o`/)
    expect(out).toMatch(/leakedSayAfter=99/)
    expect(out).toMatch(/exec\('say hello there'\)/)
    expect(out).toMatch(/empty --import cannot report P31 green/)
    expect(out).toMatch(/grandchild spawn\(say\) is visible/)
    expect(out).toMatch(/leftover say -o argv is not an orphan/)
  })
})

describe('R19-05: the recorder writes a loaded marker the judge requires', () => {
  it('a real --import records api=recorder cmd=loaded', async () => {
    const entries = await recordSay(['-v', '?'])
    expect(recorderLoadedFrom(entries), JSON.stringify(entries)).toBe(true)
  })
})
