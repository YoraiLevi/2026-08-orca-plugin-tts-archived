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
      // And the watcher is dead: the append after the replace produced nothing.
      const afterRename = events.slice(events.indexOf('rename') + 1)
      expect(afterRename,
        'the watch survived the replace — re-check R11-01, it may be fixed or platform-dependent')
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
