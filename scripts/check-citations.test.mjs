import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(REPO, 'scripts', 'check-citations.mjs')

/**
 * The checker's CONFIGURATION reporting and its cross-configuration refusal.
 *
 * WHY THIS FILE EXISTS. The checker does not measure the same population in every configuration:
 * with an ORCA checkout resolved it checks ~527 citations into ORCA's tree, and without one those
 * same paths fall to "external". Measured on one pinned tree, seven repairs moved the
 * ORCA-resolved count 92 -> 85 and the ORCA-absent count 98 -> 98. `--max-stale=34` was enforced
 * across both anyway, so a team could repair everything a local run showed and leave CI exactly as
 * red, with nothing distinguishing that from a lack of effort — a permanently-red signal, which is
 * the failure `verify by effect` names outright.
 *
 * These tests do not assert a citation COUNT. The count moves whenever anyone edits a source file,
 * and a test that pins it would be red for reasons that have nothing to do with the instrument.
 * What is pinned is that the instrument DECLARES ITS CONFIGURATION and REFUSES a threshold from
 * another one.
 */

/** Run the checker and return { code, out }. It exits non-zero by design, so never throw on that. */
function run(args = [], env = {}) {
  try {
    const out = execFileSync('node', [SCRIPT, ...args], {
      cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    })
    return { code: 0, out }
  } catch (err) {
    return { code: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

const NO_ORCA = { ORCA_SRC: '/nonexistent-orca-checkout' }

describe('the checker states which configuration produced its number', () => {
  it('prints a config line naming the ORCA-absent configuration', () => {
    const { out } = run([], NO_ORCA)
    expect(out).toMatch(/^config: +orca:absent\b/m)
  })

  it('names the resolved ORCA configuration differently from the absent one', () => {
    // The two runs must not be reported as the same measurement. Which id the resolved run
    // produces depends on whether an ORCA checkout exists on this machine, so the claim asserted
    // here is the DISTINCTION, which holds either way.
    const absent = run([], NO_ORCA).out.match(/^config: +(\S+)/m)?.[1]
    const local = run([]).out.match(/^config: +(\S+)/m)?.[1]
    expect(absent).toBe('orca:absent')
    expect(local).toBeTypeOf('string')
    if (local !== 'orca:absent') expect(local).not.toBe(absent)
  })

  it('states the working tree condition, because a dirty tree makes the count provisional', () => {
    // The VALUE is not pinned — five agents share this worktree and it changes by the minute.
    // The format is, so that a run can never report a number without saying whether uncommitted
    // work is inside it.
    const { out } = run([], NO_ORCA)
    expect(out).toMatch(/·\s+tree (clean|DIRTY, \d+ file\(s\))/)
  })
})

describe('a threshold calibrated in one configuration is refused in another', () => {
  const ratchet = JSON.parse(readFileSync(join(REPO, 'docs/.research/citation-ratchet.json'), 'utf8'))
  // Restated, not imported from the script: two sources that must agree is a check; one source
  // compared against itself is not (PITFALLS P36).
  const forAbsent = ratchet.configs['orca:absent'].maxStale

  it('refuses the superseded 34 and names this configuration\'s real ratchet', () => {
    const { code, out } = run(['--max-stale=34'], NO_ORCA)
    expect(out).toContain('REFUSED')
    expect(out).toContain('is not the ratchet for configuration orca:absent')
    expect(out).toContain(String(forAbsent))
    expect(code).not.toBe(0)
  })

  it('CONTROL: the configuration\'s own ratchet is NOT refused', () => {
    // Without this, the test above passes for a checker that refuses every number, which would be
    // a different broken instrument wearing the same green tick.
    const { out } = run([`--max-stale=${forAbsent}`], NO_ORCA)
    expect(out).not.toContain('REFUSED')
  })

  it('--ratchet reads the number for the configuration it is actually running in', () => {
    const { out } = run(['--ratchet'], NO_ORCA)
    expect(out).not.toContain('REFUSED')
    expect(out).toMatch(new RegExp(`threshold ${forAbsent} \\(from citation-ratchet\\.json`))
  })

  it('the ratchet file records why 34 was superseded, so the refusal explains itself', () => {
    expect(ratchet.superseded['34']).toBeTypeOf('string')
    expect(ratchet.superseded['34'].length).toBeGreaterThan(80)
    const { out } = run(['--max-stale=34'], NO_ORCA)
    expect(out).toContain('SUPERSEDED')
  })
})
