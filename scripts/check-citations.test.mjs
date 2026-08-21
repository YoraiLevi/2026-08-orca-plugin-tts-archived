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

/**
 * QUOTE-GONE — the signal for a citation that is stale because the code it quotes was REMEDIED.
 *
 * These run against a SYNTHETIC repository built in a temp directory, not against this one. Three
 * reasons, and the third is the important one:
 *   - the real repo's counts move whenever any of five agents edits a file;
 *   - `006-fma.md` is being edited by another agent as this is written;
 *   - a fixture lets the NEGATIVE cases be stated. A rule that only ever fires is not a rule, and
 *     the two exclusions below (elided quotes, non-statement braces) are where this signal would
 *     otherwise become a check that could only go one way.
 */
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'

function fixture(docBody, sourceBody) {
  const root = mkdtempSync(join(tmpdir(), 'cit-'))
  mkdirSync(join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, 'docs'), { recursive: true })
  mkdirSync(join(root, 'packages/core/src'), { recursive: true })
  cpSync(SCRIPT, join(root, 'scripts', 'check-citations.mjs'))
  writeFileSync(join(root, 'packages/core/src/thing.ts'), sourceBody)
  writeFileSync(join(root, 'docs', 'note.md'), docBody)
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['add', '-A'], { cwd: root })   // the fixture's OWN repo, never ours
  const run = () => {
    try {
      execFileSync('node', [join(root, 'scripts', 'check-citations.mjs')],
        { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ORCA_SRC: '/nonexistent-orca' } })
      return ''
    } catch (err) { return `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
  return run()
}

/**
 * `readRoot` is camelCase ON PURPOSE: the checker only lets STRONG anchors decide a verdict, and a
 * lowercase word like `marker` is deliberately discarded as possibly-ordinary-English. A fixture
 * anchored on one produces "unanchored", not "stale", and every assertion below goes vacuous.
 *
 * The anchor also sits far below the cited line ON PURPOSE. The checker's slack is 10 lines plus the
 * block the anchor opens, so a fixture with the symbol near the citation verifies as OK and every
 * assertion below would be vacuous. The first version of this file made exactly that mistake and
 * all four tests passed against an empty string.
 */
const SOURCE_REMEDIED = [
  ...Array.from({ length: 40 }, (_, i) => `// filler ${i}`),
  'export function readRoot (root) {',
  '  try { return read(root) } catch (err) { return { reason: err.code } }',
  '}', '', '',
].join('\n')

describe('QUOTE-GONE separates a remedied claim from a drifted pointer', () => {
  it('flags a citation whose quoted code is no longer in the file', () => {
    const out = fixture(
      'The bare catch at `packages/core/src/thing.ts:2` — `try { return read(root) } catch { return null }`' +
      ' in `readRoot` swallows the cause.\n',
      SOURCE_REMEDIED,
    )
    // The COUNT, not the word: the summary line names every bucket including the empty ones, so
    // `toContain('QUOTE-GONE')` would be true no matter what the checker decided.
    expect(out).toMatch(/· 1 QUOTE-GONE/)
    expect(out).toMatch(/^QUOTE-GONE \(1\)/m)
    expect(out).toContain('docs/note.md:1')
  })

  it('CONTROL: a citation whose quoted code SURVIVES is ordinary drift, not QUOTE-GONE', () => {
    // Same shape, same staleness — only the quote differs. Without this, the rule above would
    // pass for an implementation that flagged every stale citation.
    const out = fixture(
      'The catch at `packages/core/src/thing.ts:2` — `catch (err) { return { reason: err.code } }`' +
      ' in `readRoot` names the cause.\n',
      SOURCE_REMEDIED,
    )
    expect(out).toContain('STALE CITATIONS')
    expect(out).toMatch(/· 0 QUOTE-GONE/)
    expect(out).not.toMatch(/^QUOTE-GONE \(/m)
  })

  it('an ELIDED quote is never evidence, because it could never have matched', () => {
    const out = fixture(
      'The call at `packages/core/src/thing.ts:2` — `try { return read(…) } catch { … }` in `readRoot`.\n',
      SOURCE_REMEDIED,
    )
    expect(out).toContain('STALE CITATIONS')
    expect(out).toMatch(/· 0 QUOTE-GONE/)
    expect(out).not.toMatch(/^QUOTE-GONE \(/m)
  })

  it('a braced shape that is not a statement is not treated as quoted source', () => {
    // An invented response shape, not code that was ever in the file.
    const out = fixture(
      'It answers `packages/core/src/thing.ts:2` with `200 { played: \'elsewhere\' }` from `readRoot`.\n',
      SOURCE_REMEDIED,
    )
    expect(out).toContain('STALE CITATIONS')
    expect(out).toMatch(/· 0 QUOTE-GONE/)
    expect(out).not.toMatch(/^QUOTE-GONE \(/m)
  })
})

/**
 * UNREAD ANNOTATIONS — P35, caught by the tool instead of by a person a week later.
 *
 * Two shapes, both of which really happened here: a `citation-check: ignore` marker written with
 * its reason INSIDE, which the matcher does not accept and which therefore suppressed nothing
 * while looking like it did; and `[live tree]`, a stamp one document uses to say "this pointer may
 * have moved" that this tool has never read.
 */
describe('an annotation the parser does not read is named, not silently ignored', () => {
  it('names a `[live tree]`-style prose stamp sitting on a citation', () => {
    const out = fixture(
      'See `packages/core/src/thing.ts:2` `[live tree]` in `readRoot`.\n', SOURCE_REMEDIED,
    )
    expect(out).toMatch(/^UNREAD ANNOTATIONS \(1\)/m)
    expect(out).toContain('prose stamp')
  })

  it('CONTROL: an R006 evidence label is NOT an unread suppression', () => {
    // `[measured-here]` qualifies a NUMBER and claims nothing about a citation. Without this
    // exclusion the check reported 58 hits in this repo, 58 of them noise — which would bury the
    // real ones exactly as a weak anchor buries real drift.
    const out = fixture(
      'See `packages/core/src/thing.ts:2` `[measured-here]` in `readRoot`.\n', SOURCE_REMEDIED,
    )
    expect(out).not.toMatch(/^UNREAD ANNOTATIONS/m)
  })

  it('names a citation-check marker written with its reason inside, which suppresses nothing', () => {
    const out = fixture(
      'See `packages/core/src/thing.ts:2` in `readRoot`. <!-- citation-check: ignore — verified by hand -->\n',
      SOURCE_REMEDIED,
    )
    expect(out).toMatch(/^UNREAD ANNOTATIONS \(1\)/m)
    expect(out).toContain('malformed marker')
    // And the proof that it suppressed nothing: the citation is still counted.
    expect(out).toContain('STALE CITATIONS')
  })

  it('CONTROL: the well-formed marker is not named, and really does suppress', () => {
    const out = fixture(
      'See `packages/core/src/thing.ts:2` in `readRoot`. <!-- citation-check: ignore --><!-- why: checked -->\n',
      SOURCE_REMEDIED,
    )
    expect(out).not.toMatch(/^UNREAD ANNOTATIONS/m)
    expect(out).not.toContain('STALE CITATIONS')
  })
})
