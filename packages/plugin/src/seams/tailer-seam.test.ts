/**
 * SC-15 and SC-16 — the last two seam inventories: the transcript TAILER and the ADAPTER/MANIFEST.
 *
 * `006` section 22 rows 15 and 16 (`docs/design/020-review-round11.md`). These are the two seams
 * whose far side is **not our code**: the filesystem under a writer we do not control, and ORCA's
 * own plugin host. Rounds 9 and 10 surveyed the audio path and the decoder; this closes the
 * inventory.
 *
 * NO AUDIO, NO TIMING. Nothing here opens a device or reports a duration (P31, and the machine is
 * loaded). The fs probe uses a temp directory and real `fs.watch` semantics; every wait is a fixed
 * settle, never a measurement.
 */
import { describe, expect, it } from 'vitest'
import { watch, writeFileSync, renameSync, appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A fixed wait, used HERE and deliberately: SC-15 is a probe of the FILESYSTEM's own notification
 * behaviour, and there is no condition to wait on — the whole question is whether an event arrives
 * at all. Waiting for "an event arrived" would make the negative case unfalsifiable.
 *
 * Every other fixed wait in this repo's suite is a prediction about machine speed and should be a
 * condition instead (R12-01). This one is a genuine exception, and it is stated so nobody
 * "fixes" it into uselessness. The waits are generous so a loaded machine does not produce a false
 * NEGATIVE — the failure mode here is concluding "no event arrived" too early.
 */
const settle = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms) })

/* ================================================================== SC-15
 * seam: the filesystem (`fs.watch`) -> the transcript tailer
 */

/**
 * SC-15 — an atomic rename-replace kills the watch, emits NO error, and the tailer discards the one
 * signal the OS does give it.
 *
 * `huddle/index.ts` subscribes to the watcher's `'error'` event, and the comment there names the
 * scenario this test is about:
 *
 *   > "Site 7: `fs.watch` error events were NOT SUBSCRIBED AT ALL. A rename-replace write or an
 *   >  inode change silently ends the watch, and one session then goes permanently quiet while
 *   >  every other session works (TT13, and 006 section 19 rank 7)."
 *
 * **The subscription does not cover that scenario, because a rename-replace does not produce an
 * `'error'` event.** It produces a `'rename'` CHANGE event — and the callback is written
 * `watch(file, () => { this.#onChange(file) })`, which discards `eventType` in the argument list.
 * The one signal the OS gives is thrown away, and then the watch is silent forever.
 *
 * This test asserts the FILESYSTEM's behaviour, restated as a claim about the far side of the seam
 * (P36) — it does not import huddle. If node ever starts re-arming the watch, or starts emitting
 * `'error'`, this row goes red and the finding is obsolete, which is exactly when someone should be
 * told.
 */
describe('SC-15 — what fs.watch does to a watcher when the writer replaces the file', () => {
  it('emits `rename` and then nothing, with no error event, so the watch dies silently', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seam-tailer-'))
    try {
      const file = join(dir, 't.jsonl')
      const tmp = join(dir, 't.tmp')
      writeFileSync(file, 'line1\n')
      const events: string[] = []
      const errors: string[] = []
      const w = watch(file, (ev) => { events.push(ev) })
      w.on('error', (e) => { errors.push(String((e as NodeJS.ErrnoException).code ?? e)) })
      try {
        await settle(120); appendFileSync(file, 'line2\n')          // ordinary append
        await settle(200)
        writeFileSync(tmp, 'line1\nline2\nline3\n'); renameSync(tmp, file)   // atomic replace
        await settle(300); appendFileSync(file, 'line4\n')          // append AFTER the replace
        await settle(400)
      } finally { w.close() }

      // The OS DOES tell us: a rename event arrives.
      expect(events, `no rename event at all: ${JSON.stringify(events)}`).toContain('rename')
      // But not as an error, so the 'error' subscription cannot see it.
      expect(errors, 'a rename-replace produced an error event — this finding is obsolete').toEqual([])
      // And the watcher is dead: the append after the replace produced no CHANGE event.
      //
      // `change` is the assertion, not "no events at all". Measured on both platforms
      // `[measured-here]`, n=1 each, macOS 26.5 and node:24-bookworm under podman:
      //
      //     darwin  all: ["change","rename"]                    after rename: []
      //     linux   all: ["change","change","rename","rename"]  after rename: ["rename"]
      //
      // Linux reports the atomic replace TWICE — the unlink and the create both surface as
      // `rename`. That extra event is the OS narrating the replace, not the watch working: on
      // BOTH platforms the append afterwards produces nothing. R11-01 holds identically; only
      // the event count differs. Asserting `toEqual([])` made a true finding fail on Linux,
      // which is a stricter assertion than the claim it exists to defend.
      const afterRename = events.slice(events.indexOf('rename') + 1)
      expect(afterRename.filter((e) => e === 'change'),
        'the watch survived the replace and delivered a change — re-check R11-01, it may be fixed')
        .toEqual([])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  /**
   * The control. If plain appends did not fire either, the probe above would be measuring a broken
   * harness and its verdict would be worthless.
   */
  it('CONTROL: without a replace, ordinary appends keep firing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seam-tailer-ctl-'))
    try {
      const file = join(dir, 'u.jsonl')
      writeFileSync(file, 'a\n')
      const events: string[] = []
      const w = watch(file, (ev) => { events.push(ev) })
      try {
        await settle(120); appendFileSync(file, 'b\n')
        await settle(200); appendFileSync(file, 'c\n')
        await settle(300)
      } finally { w.close() }
      expect(events.length, 'the probe cannot see ordinary appends, so it proves nothing').toBeGreaterThanOrEqual(2)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  /**
   * VIOLATED TODAY (R11-01). The tailer discards `eventType`, so it cannot distinguish "the file
   * changed" from "the file I am watching no longer exists". Remove `.fails` when the callback
   * reads the event type and re-establishes the watch on `rename`.
   */
  it.fails('the tailer reads the event type it is given [OPEN: R11-01]', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../huddle/index.ts', import.meta.url)), 'utf8')
    // Restated as a claim about the source, because the callback's ignored parameter has no
    // runtime trace to assert on: a discarded argument is invisible from outside.
    expect(src, 'watch() is called with a zero-argument callback, discarding eventType')
      .not.toMatch(/watch\(\s*file\s*,\s*\(\s*\)\s*=>/)
  })
})

/* ================================================================== SC-16
 * seam: the source manifest -> the SHIPPED manifest -> ORCA's plugin host
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO = join(HERE, '../../../..')
const readJson = (p: string): Record<string, never> =>
  JSON.parse(readFileSync(join(REPO, p), 'utf8')) as Record<string, never>
const commandsOf = (m: { contributes?: { commands?: Array<{ id: string }> } }): string[] =>
  (m.contributes?.commands ?? []).map((c) => c.id)

/**
 * SC-16 — the manifest exists twice and nothing compares the copies.
 *
 * `packages/plugin/orca-plugin.json` is the source. `dist/plugin/orca-plugin.json` is what ships,
 * it is COMMITTED, and `scripts/build.mjs` merely `cp`s one onto the other. So they are two copies
 * of one contract that drift whenever the source changes without a rebuild being committed.
 *
 * **And the checks are split across the two copies, so neither compares them:**
 *
 *   - `manifest.test.ts` and `keybindings.test.ts` read the **source** manifest.
 *   - CI's `scripts/smoke-activate.mjs` reads the **dist** manifest, and asserts that `activate()`
 *     registers every command the manifest declares. Registering MORE than it declares is fine, so
 *     a command that was declared in source and never shipped passes that check silently.
 *
 * Both green, both correct about their own copy, and the drift is invisible. Section 22's shape,
 * on the last inventory.
 */
describe('SC-16 — the shipped manifest is the source manifest', () => {
  it('the two copies declare the same commands', () => {
    const src = commandsOf(readJson('packages/plugin/orca-plugin.json'))
    const dist = commandsOf(readJson('dist/plugin/orca-plugin.json'))
    expect(src.length, 'no commands declared: this row would be vacuous').toBeGreaterThan(0)
    expect([...dist].sort(), 'the shipped manifest does not match source — `pnpm build` was not ' +
      'committed. A command missing here is unreachable by a user who installed the plugin.')
      .toEqual([...src].sort())
  })

  it('the two copies declare the same keybindings', () => {
    const kb = (m: { contributes?: { keybindings?: Array<{ key: string; command: string }> } }): string[] =>
      (m.contributes?.keybindings ?? []).map((k) => `${k.key} -> ${k.command}`).sort()
    expect(kb(readJson('dist/plugin/orca-plugin.json')))
      .toEqual(kb(readJson('packages/plugin/orca-plugin.json')))
  })

  /**
   * The command whose absence matters most, named on its own so the failure says WHY rather than
   * just diffing two lists.
   *
   * `read-aloud.self-test` is the instrument built for `006` section 19 **rank one** — *"that the
   * plugin is mute"*, the single thing this system cannot otherwise detect. It synthesizes a fresh
   * phrase and reports the bytes that actually moved. **If it is not in the shipped manifest, the
   * one command that exists to answer "is the plugin broken, or merely idle?" cannot be invoked by
   * anyone who installed the plugin.**
   */
  it('ships the self-test, which is the answer to the FMA\'s rank-one undetectable', () => {
    expect(commandsOf(readJson('dist/plugin/orca-plugin.json')),
      'the self-test is declared in source and missing from the shipped manifest')
      .toContain('read-aloud.self-test')
  })
})

/* ================================================================== SC-17
 * seam: a test -> the machine's SCHEDULER
 */

/**
 * SC-17 — a fixed sleep is a prediction about how fast this machine is, and the machine is the one
 * part of the system nobody controls.
 *
 * `021-review-round12.md` R12-01. The suite gave **657/658 on one clean worktree and 653/658 on
 * another minutes later**, both honest, both at parity on `node_modules`. Four of the five reds were
 * not defects: a queue-drain race and two `check-citations` timeouts, all load-dependent. **A suite
 * count taken today means "the machine was quiet", not "the code is correct" — and every count in
 * every document in this repo rests on that suite.**
 *
 * THIS IS A SEAM, in the same family as SC-15 (the filesystem) and SC-16 (the host manifest): the
 * far side is **not our code**. Two predicates for one concept —
 *
 *   > *"has the asynchronous work finished?"*
 *
 * — answered on the test's side by **a duration** and on the runtime's side by **actual
 * completion**. On a quiet machine they agree, which is why this survived eleven rounds.
 *
 * THE FIX IS NOT A LONGER SLEEP. A longer sleep is the same prediction with a bigger margin; it
 * makes the suite slower on every machine and still wrong on a loaded one. **Wait for the
 * CONDITION, with a generous ceiling as a backstop against a hang.** On a quiet machine that
 * returns sooner than the sleep did; on a loaded one it returns the right answer instead of a
 * faster wrong one.
 *
 * THE HONEST EXCEPTION, and it is why this row asserts a file list rather than "no setTimeout
 * anywhere": a probe of whether an event arrives AT ALL has no condition to wait on, and waiting
 * for "an event arrived" would make its negative case unfalsifiable. SC-15 above is exactly that,
 * and it says so at its own `settle`. An exception that is stated is a decision; an exception that
 * is silent is this defect.
 */
describe('SC-17 — the suite waits on conditions, not on how fast the machine happens to be', () => {
  const SUITE_GLOBS = [
    'packages/core/src/queue/queue.test.ts',
    'packages/plugin/src/adapter/adapter.test.ts',
    'packages/plugin/src/huddle/huddle.test.ts',
    'packages/plugin/src/main.test.ts',
    'packages/plugin/src/sinks/subprocess-sink.test.ts',
    'packages/plugin/src/speech-service.test.ts',
    'packages/providers/src/os-synth/os-synth.test.ts'
  ]

  /** Files that wait on a duration where a condition was available. Restated, not derived (P36). */
  const KNOWN_OFFENDERS = new Set(SUITE_GLOBS)

  it('CONTROL: the detector actually fires on a file that has the pattern', () => {
    const withPattern = 'await new Promise((r) => setTimeout(r, 5))'
    expect(/setTimeout\(\s*r\w*\s*,\s*\d+\s*\)/.test(withPattern),
      'the detector cannot see the pattern it exists to find').toBe(true)
    expect(/setTimeout\(\s*r\w*\s*,\s*\d+\s*\)/.test('await until(() => done())'),
      'the detector fires on a condition wait, so it would flag the fix as the defect').toBe(false)
  })

  /**
   * VIOLATED TODAY (R12-01). Seven files predict machine speed. Both of THIS round's own files were
   * among them and were converted first — a finding whose author leaves their own instances standing
   * is not one.
   *
   * Remove `.fails` when the list is empty. Do not remove an entry by adding an exception comment;
   * remove it by waiting on a condition.
   */
  it.fails('no test file waits on a duration where a condition was available [OPEN: R12-01]', () => {
    expect([...KNOWN_OFFENDERS], 'seven files still predict how fast this machine is').toEqual([])
  })
})

/* ================================================================== SC-18
 * seam: a GATE -> whatever is supposed to run it
 */

/**
 * SC-18 — a gate that works perfectly and is never run.
 *
 * `021-review-round12.md` R12-02, added at the close of the session on the team lead's report.
 *
 * The other eight instances of round 8's class are all *"the rule was followed and the failure
 * happened anyway"*. **This one is different, and the difference is why it earns its own row: the
 * check was neither broken nor blind. It was simply never executed.** `pnpm lint` had four real
 * errors that reproduce locally in full — nobody had run it — and `tsc -b` passed locally while
 * failing in CI, because the incremental cache never revisited the file. Both surfaced the first
 * time the hosted CI ran, which was an hour before this was written.
 *
 * **It is the same shape C6 was in for this entire project until that run**: a Windows leg that was
 * `[claimed]` for eleven rounds and turned out to be green the moment anyone looked.
 *
 * A gate has TWO failure modes and this document has only ever tracked one:
 *
 *   - **it cannot go red** — P32, P36, the mutation registry, and most of section 22;
 *   - **it can go red and nothing ever asks it** — this row.
 *
 * The second is invisible to every instrument built for the first. A mutation check proves a test
 * CAN fail; it says nothing about whether that test is ever invoked. **Both halves are needed, and
 * only one existed.**
 *
 * WHAT THIS ROW DOES NOT CLAIM. Not every script must run in CI — `test:watch` is a developer
 * convenience and `voice-lab` is an interactive tool. The contract is narrower: **a script that
 * asserts something about correctness must be executed by something, and where it is not, the
 * reason is written down.** An unexecuted gate with a stated reason is a decision; an unexecuted
 * gate with no reason is this defect.
 */
describe('SC-18 — every gate the repo defines is executed by something', () => {
  const REPO_ROOT = join(HERE, '../../../..')
  const scriptsOf = (): string[] =>
    Object.keys((JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as
      { scripts: Record<string, string> }).scripts)

  /**
   * Scripts deliberately not run in CI, each with the reason. Restated here (P36) so that adding a
   * new unexecuted gate is a decision recorded in a diff rather than a silent omission.
   */
  const EXEMPT: Record<string, string> = {
    'test:watch': 'a developer convenience; `test` is the gate',
    'voice-lab': 'an interactive tool with a browser in the loop; it has no verdict to give',
    'bench:latency': 'opens the audio device on `--audible` and is a measurement, not an assertion (P31)',
    'bench:lab-gate': 'drives a real browser; measured deliberately rather than gated',
    'probe:numbers': 'run by the CI leg directly rather than through the script name'
  }

  it('CONTROL: the CI file really does name the gates it runs', () => {
    const ci = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8')
    expect(ci, 'the detector cannot see any script invocation at all').toMatch(/pnpm (run )?test\b/)
  })

  it('every script is either run by CI or exempt with a stated reason', () => {
    const ci = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8')
    const unrun = scriptsOf().filter((s) =>
      !new RegExp(`pnpm (run )?${s.replace(/:/g, ':')}\\b`).test(ci))
    const unexplained = unrun.filter((s) => EXEMPT[s] === undefined)
    expect(unexplained,
      'these gates are defined, are never executed, and no reason is recorded. ' +
      'Either wire them into CI or write down why not — see 021 R12-02.').toEqual([])
  })

  it('no exemption is stale: everything claimed exempt still exists as a script', () => {
    // An exemption for a script that was deleted is a comment nobody will ever re-read.
    const scripts = new Set(scriptsOf())
    expect(Object.keys(EXEMPT).filter((s) => !scripts.has(s)), 'stale exemptions').toEqual([])
  })
})
