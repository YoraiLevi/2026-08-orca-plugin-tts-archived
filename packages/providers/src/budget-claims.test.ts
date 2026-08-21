import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CANCEL_BUDGET_MS } from './contract.ts'

/**
 * The guard for the defect this file was written after.
 *
 * `CANCEL_BUDGET_MS` was 50. Nine documents said cancel is "measured within 50 ms". The contract
 * asserted `CANCEL_BUDGET_MS * 20` = 1,000 ms. A mutation that delayed the SIGKILL by 900 ms was
 * green in every test in the suite. **The number that appeared in the documents was never the
 * number being enforced**, and nothing could have told anyone — the constant, the prose and the
 * assertion each looked right on its own. See docs/.research/test-audit.md.
 *
 * WHY THIS GUARD AND NOT ANOTHER. Three candidates were weighed:
 *
 *  - *A naming convention tying a test to the doc claim it enforces.* Free to write, and enforced
 *    by nobody. The old T041c was already named "cancel() is observed within 50 ms" while
 *    asserting 1,000; a convention would have added no signal the name did not already carry.
 *  - *A coverage gate.* Every test involved here already ran and already passed. Coverage was
 *    100% on the cancel path throughout. It measures the wrong thing for this failure class.
 *  - *This: parse the numbers out of the prose and compare them to the constant the suite
 *    actually enforces.* ~50 lines, runs in single-digit milliseconds inside `pnpm test`, and
 *    fails on the exact drift that occurred — in EITHER direction. Loosening the assertion breaks
 *    it; editing a document to quote a different number breaks it too.
 *
 * Its known limit, stated rather than implied (R016): it checks the numbers, not the semantics.
 * `scripts/mutation-check.mjs` is the companion that checks whether an assertion can fail at all;
 * this one only checks that it is measured against the number everyone is citing.
 *
 * TO ADD A CLAIM: put the constant in CLAIMS with the phrasing that introduces it. To CHANGE a
 * budget: change the constant, then this test tells you every document that still quotes the old
 * number. That is the workflow it exists to make cheap.
 */

const root = (p: string): string => fileURLToPath(new URL(`../../../${p}`, import.meta.url))

/**
 * Files that cite the provider contract's cancel budget. A deliberate list, not a glob:
 * `docs/.discussion/003-panel-and-control-channel.md` defines a DIFFERENT quantity under the same
 * word — end-to-end Stop, from input event to the last audio sample leaving the device, p50 120 /
 * p99 250 ms — of which this budget is one segment. Globbing would collapse two real numbers into
 * one false conflict. If a new document starts citing the contract, add it here.
 */
const CITING_FILES = [
  'STATE.md',
  'docs/TASKS.md',
  'docs/PLAN.md',
  'docs/design/007-user-stories.md'
]

/**
 * A bounding word is required before the number: "within 50 ms" is a claim about the gate,
 * "measured at 1 ms" is a reading from a run and is not. `at` and `p50`-style figures are
 * deliberately excluded for that reason.
 */
const BOUND = '(?:within|under|below|less than|at most|no more than|in|<=?|≤)'
const SUBJECT = '(?:cancel(?:s|led|ling)?|barge[- ]in|stops?|stopped|silenc\\w+|second press)'
const CLAIM = new RegExp(
  `${SUBJECT}[^.\\n|]{0,80}?${BOUND}\\s*(?:a\\s+)?(?:\\*\\*)?(?:measured\\s+)?(?:\\*\\*)?(\\d+)\\s*ms`,
  'gi'
)

describe('documented numbers match the number the suite enforces', () => {
  it('every cited cancel/stop budget in the docs equals CANCEL_BUDGET_MS', () => {
    const offenders: string[] = []
    let claimsSeen = 0

    for (const rel of CITING_FILES) {
      const path = root(rel)
      if (!existsSync(path)) continue          // a doc may be renamed by another workstream
      const lines = readFileSync(path, 'utf8').split('\n')
      lines.forEach((line, i) => {
        // A percentile figure is design 003's end-to-end Stop budget (p50 120 / p99 250 ms, input
        // event to last sample out), of which this budget is one segment. Two real numbers for two
        // real quantities; only the unqualified one is a claim about the provider contract.
        if (/\bp\d{2}\b/i.test(line)) return
        for (const m of line.matchAll(CLAIM)) {
          claimsSeen++
          const quoted = Number(m[1])
          if (quoted !== CANCEL_BUDGET_MS) {
            offenders.push(`${rel}:${i + 1} quotes ${quoted} ms — the suite enforces ${CANCEL_BUDGET_MS} ms\n    ${line.trim()}`)
          }
        }
      })
    }

    // The control. If the regex stops matching — a doc is renamed, the phrasing changes, the file
    // list rots — this test would pass while checking nothing at all, which is the exact failure
    // class it exists to prevent. An indicator that never changes is a broken indicator.
    expect(claimsSeen,
      'no cancel/stop budget claim was found in any cited document — this guard is checking NOTHING. ' +
      `Fix CITING_FILES or the CLAIM regex; do not delete this assertion.`).toBeGreaterThanOrEqual(9)

    expect(offenders.join('\n'),
      'a document quotes a cancel budget the suite does not enforce').toBe('')
  })

  it('the contract asserts against the constant itself, with no loosening multiplier', () => {
    // The original defect in one line: `toBeLessThanOrEqual(CANCEL_BUDGET_MS * 20)`. The constant
    // was right, the prose was right, and the arithmetic between them made the gate 20x the claim.
    const src = readFileSync(fileURLToPath(new URL('./contract.ts', import.meta.url)), 'utf8')
    const gate = /toBeLessThanOrEqual\(\s*CANCEL_BUDGET_MS([^)]*)\)/.exec(src)
    expect(gate, 'the cancel gate no longer compares against CANCEL_BUDGET_MS at all').not.toBeNull()
    expect(gate?.[1]?.trim(),
      'the cancel gate applies arithmetic to the budget, so the enforced number is not the quoted one')
      .toBe('')
  })
})
