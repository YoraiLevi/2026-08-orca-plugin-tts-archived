import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { OsSynthProvider, type LinuxBackend, darwinCommand, linuxCommand, neutralizeInBandCommands, win32Command } from './index.ts'
import { runProviderContract, CANCEL_BUDGET_MS } from '../contract.ts'  // test-only entry, never via the barrel

// T045: the contract runs against the real OS synthesizer on whatever platform CI is on.
runProviderContract('OsSynthProvider', () => new OsSynthProvider())

describe('T042 per-platform command construction', () => {

  it('T042e reports unavailability rather than failing silently', async () => {
    // A platform whose binary does not exist must yield no voices, not throw into the caller.
    // `Array.isArray(voices)` alone could not fail: it is true for the empty list, for a populated
    // list, and for a list produced by a completely different platform's binary. Assert the
    // CONTENT, and assert both halves of "reports": no throw, AND a named reason for the UI.
    const p = new OsSynthProvider({ platform: 'linux' })
    const voices = await p.listVoices()
    expect(voices, 'voices must be a list, never null/undefined').toBeInstanceOf(Array)
    for (const v of voices) expect(typeof v, 'a non-string voice would break the settings UI').toBe('string')
    if (voices.length === 0) {
      // The interesting case, and the one this test is named for: nothing on the box can speak.
      // Silence with no reason is the failure; a reason the UI can show is the requirement (R015).
      await p.prepare().catch(() => undefined)
      expect(p.unavailableReason, 'no voices AND no reason — this is silent failure').toBeTruthy()
      expect(String(p.unavailableReason)).toContain('espeak-ng')
    }
  })

  it('produces real audio bytes on this platform', async () => {
    const p = new OsSynthProvider()
    await p.prepare()
    let bytes = 0
    for await (const c of p.generate('Testing one two three.')) bytes += c.data.length
    expect(bytes, 'the OS synthesizer produced no audio').toBeGreaterThan(1000)
  }, 120_000)

  // `if (platform !== 'darwin') return` reported PASS on Linux and Windows for a test that did
  // nothing there. skipIf reports SKIPPED, so the reporter tells the truth about coverage on the
  // OS it is running on (constitution: an indicator that never changes is a broken indicator).
  it.skipIf(process.platform !== 'darwin')(
    'T042a macOS output is WAV, never AIFF — decodeAudioData rejects AIFF-C', async () => {
    const p = new OsSynthProvider()
    await p.prepare()
    for await (const c of p.generate('hello')) {
      expect(c.format).toBe('wav')
      const header = new TextDecoder().decode(c.data.slice(0, 4))
      expect(header, 'not a RIFF/WAV header').toBe('RIFF')
      break
    }
  }, 120_000)
})

describe('T042d cancel latency is measured, not assumed', () => {
  it(`cancel stops the child process within ${CANCEL_BUDGET_MS} ms and yields no audio`, async () => {
    const p = new OsSynthProvider()
    await p.prepare()
    // 200, and the number is bounded on BOTH sides. The interrupt must land while the engine is
    // still rendering, or the assertion below tests nothing — and the input must not be so large
    // that the provider's own 60 s timeout fires, because a rejection is not a fast render.
    // Measured `[measured-here]`, n=1 per size:
    //
    //     sentences   espeak-ng (node:24-bookworm)   say (macOS 26.5)
    //     30           24 ms                          7.4 s
    //     200         124 ms                         48.3 s
    //     400         245 ms                         60.0 s -> KILLED, "did not finish"
    //
    // At 30 the Linux render finished before the 50 ms wait elapsed. At 400 `say` blew its own
    // timeout. 200 clears the interrupt on the fast engine and stays inside the budget on the
    // slow one; cancel kills the child long before 48 s in the real run.
    const iter = p.generate('This is a long sentence. '.repeat(200))[Symbol.asyncIterator]()
    const pending = iter.next()
    // Did the engine finish BEFORE we interrupted? On `say` (~1,100 ms) it never has; espeak-ng
    // renders this in under 50 ms, so on Linux the chunk exists already and cancelling cannot
    // un-produce it. Racing the engine and asserting the outcome is the same mistake as waiting
    // out a queue drain — the precondition has to be observed, not assumed.
    // Fulfilment only. An earlier revision also flagged REJECTION, so the provider's 60 s timeout
    // firing was indistinguishable from a render that finished early — an error wearing the
    // costume of the condition being measured. A rejection here is a real failure and must reach
    // the `await` below rather than be absorbed.
    let settledBeforeCancel = false
    void pending.then(() => { settledBeforeCancel = true }, () => {})
    await new Promise((r) => setTimeout(r, 50))
    // Snapshot BEFORE the interrupt. `settledBeforeCancel` is set by a `.then` that also runs when
    // cancel resolves the promise, so reading the live flag after `await pending` is always true
    // and the guard would fire on every platform — a check that cannot pass, which is the twin of
    // the check that cannot fail.
    const renderWasStillRunning = !settledBeforeCancel
    const t0 = Date.now()
    p.cancel()
    const first = await pending
    const elapsed = Date.now() - t0
    console.info(`[measured] OsSynthProvider cancel -> return: ${elapsed} ms`)
    // Was `toBeLessThan(2000)` while the test's own name said "promptly" and nine documents said
    // 50 ms. Mutation-checked: delaying the SIGKILL by 900 ms left this green.
    expect(elapsed, `cancel took ${elapsed} ms, budget ${CANCEL_BUDGET_MS} ms`)
      .toBeLessThanOrEqual(CANCEL_BUDGET_MS)
    // Two-sided (R014): the point is not that the call returned, it is that no audio escaped for
    // text the listener has already interrupted. A fast return that still yielded a chunk would
    // satisfy a latency-only assertion and be exactly the bug.
    //
    // Guarded by the observation above rather than by the engine's speed. A chunk that was
    // already complete when the listener pressed Stop is not an escape — it is audio that existed
    // before the interrupt. Asserting `first.done` unconditionally made this fail on Linux for
    // being FAST, which is not the property under test. CI run 32506050161 `[measured-here]`.
    // The precondition is ASSERTED, never used to skip. An earlier revision made the check below
    // conditional on this flag, and on Linux the flag is always true, so the assertion never ran
    // and the mutants `cancel-late-kill` and `cancel-never-kill` both SURVIVED — a test that
    // could not fail for the property it exists to guard. If a future engine ever outruns the
    // wait, this must go red and the input must grow, not quietly stop testing.
    expect(renderWasStillRunning,
      'the engine finished before cancel() was called, so this test proves nothing about '
      + 'barge-in — grow the input until the interrupt lands mid-render').toBe(true)
    expect(first.done, 'cancel returned promptly but still produced audio').toBe(true)
  }, 120_000)
})

/**
 * T042f — the Linux floor.
 *
 * These run on any host. The command builder is pure, and the detection ladder is exercised for
 * real on a machine that has none of the three binaries (this is the stock-Ubuntu situation, which
 * is exactly the case that used to produce silence).
 */
describe('T042f Linux is never silently silent', () => {
  // The two pure command-builder cases below run everywhere. The three that follow need a box with
  // NONE of the three binaries — that is the stock-Ubuntu-desktop condition they exist to model, so
  // they are gated, and gated VISIBLY: on a Linux runner that has espeak-ng installed they report
  // SKIPPED rather than PASSED. Cross-platform parity (principle III) is not served by a green tick
  // for a body that never ran.
  const noLinuxBinaries = process.platform !== 'win32' &&
    ['espeak-ng', 'espeak', 'spd-say'].every(
      (b) => spawnSync('which', [b], { stdio: 'ignore' }).status !== 0
    )

  it('espeak-ng honours rate — it used to be dropped on Linux only (H25, R1 parity)', () => {
    const { cmd, args } = linuxCommand('espeak-ng', 'hello', '/tmp/a.wav', { rate: 1.5 })
    expect(cmd).toBe('espeak-ng')
    expect(args).toContain('-w')
    // 1.5 x espeak-ng's own 175 wpm default. macOS uses the same base, so one number means the
    // same thing on both platforms.
    expect(args.join(' '), 'rate was dropped on Linux').toContain('-s 263')
  })

  it('spd-say is driven as a speaker, not as a file writer', () => {
    // Verified upstream: brailcom/speechd src/clients/say/options.c has no file-output option,
    // and -w is --wait. Asking it for a WAV would produce silence and an empty temp file.
    const { cmd, args } = linuxCommand('spd-say', 'hello', '/tmp/a.wav', { rate: 1.5, voice: 'en' })
    expect(cmd).toBe('spd-say')
    expect(args).toContain('--wait')
    expect(args).not.toContain('/tmp/a.wav')
    expect(args.join(' ')).toContain('-r 50')     // (1.5 - 1) * 100, spd-say's -100..+100 scale
    expect(args.join(' ')).toContain('-y en')
  })

  it.skipIf(!noLinuxBinaries)(
    'detection failure is named and actionable, not a swallowed exception', async () => {
    const p = new OsSynthProvider({ platform: 'linux' })
    const err = await p.generate('hello')[Symbol.asyncIterator]().next().then(
      () => null,
      (e: unknown) => e
    )
    expect(err, 'generate() resolved with no audio and no error — silent failure').toBeInstanceOf(Error)
    const msg = String((err as Error).message)
    expect(msg).toContain('espeak-ng')
    expect(msg, 'the floor we do have was never tried').toContain('spd-say')
    expect(msg, 'the user is told nothing they can act on').toContain('apt install espeak-ng')
    expect(p.unavailableReason).toBe(msg)
  })

  it.skipIf(!noLinuxBinaries)(
    'prepare() refuses to report warm when nothing on the box can speak', async () => {
    const p = new OsSynthProvider({ platform: 'linux' })
    await expect(p.prepare()).rejects.toThrow(/No Linux speech synthesizer/)
    expect(p.isWarm, 'reported warm while unable to make a sound').toBe(false)
  })

  it.skipIf(!noLinuxBinaries)(
    'tells the user, through notify, which binary is missing', async () => {
    const said: string[] = []
    const p = new OsSynthProvider({ platform: 'linux', notify: (m) => said.push(m) })
    await p.prepare().catch(() => undefined)
    expect(said.join(' ')).toContain('apt install espeak-ng')
  })
})

/**
 * NM14 / cross-review E-06 — in-band speech commands in agent prose.
 *
 * `[[` opens an embedded command on macOS `say` (`[[volm 0.2]]` sets playback volume) and switches
 * espeak-ng into phoneme-mnemonic mode (its own man page: `espeak-ng -ven-us "[[h@'loU]]"` speaks
 * "hello"). Neither is closed by the normalizer: `expandNumbers` happens to mangle integer
 * arguments, but decimals are handed through untouched, so `[[volm 0.2]]` reached `say` verbatim in
 * shipped v1. An agent reply — or a repo containing that string in a comment — could silence the
 * assistive tool with no error and no indication.
 */
describe('E-06 in-band synthesizer commands never reach the engine', () => {
  it('neutralizes the opener without deleting a single character the agent wrote', () => {
    expect(neutralizeInBandCommands('a [[volm 0.2]] b')).toBe('a [ [volm 0.2]] b')
    // Silent omission is the failure class this project exists to avoid: every character survives.
    const before = 'x [[pbas 46]] y [[volm 0]] z'
    const after = neutralizeInBandCommands(before)
    expect(after.replace(/ /g, '')).toBe(before.replace(/ /g, ''))
    expect(after).not.toContain('[[')
    // Idempotent, because it runs at two layers.
    expect(neutralizeInBandCommands(after)).toBe(after)
  })

  it('no argument vector handed to a Linux engine can carry an opener', () => {
    for (const backend of ['espeak-ng', 'espeak', 'spd-say'] as const) {
      const { args } = linuxCommand(backend, "hi [[h@'loU]] there", '/tmp/a.wav', {})
      expect(args.join(' '), `${backend} received a phoneme-mode opener`).not.toContain('[[')
      expect(args.join(' ')).toContain('there')
    }
  })

  it.skipIf(process.platform !== 'darwin')(
    'VERIFY BY EFFECT: bracketed text is spoken, not executed (macOS)', async () => {
    const p = new OsSynthProvider()
    const bytes = async (text: string): Promise<number> => {
      let n = 0
      for await (const c of p.generate(text)) n += c.data.length
      return n
    }
    const plain = await bytes('hello world')
    const injected = await bytes('hello [[volm 0.2]] world')
    // Before the fix these were byte-identical (41258 each, measured): `say` consumed the run as a
    // command. Now the words are synthesized, so the audio is materially longer.
    expect(injected, 'the bracketed run was executed as a command, not spoken')
      .toBeGreaterThan(plain * 1.5)
  }, 30_000)
})

/**
 * 006 site 41 + 54, and the first of the FMA's "three to fix first".
 *
 * `prepare()` called `listVoices()`, which catches everything and returns `[]` WITHOUT throwing —
 * so a broken `say` or a broken PowerShell set `#warm = true`, the registry reported
 * `rung: 'preferred'` with no reason, and the plugin logged "engine ready" while being permanently
 * mute. The reason was written to `unavailableReason`, whose own doc comment says it exists so the
 * reason reaches a notification, and no caller read it.
 *
 * Verified by effect exactly as the FMA specifies — "rename `say` on the PATH, activate, and
 * assert the plugin announces the failure". Emptying PATH is that, hermetically: the child process
 * can no longer resolve `say` (or `powershell`), so `spawn` emits ENOENT.
 *
 * NOTHING HERE PLAYS AUDIO. `say -v '?'` and `Get-InstalledVoices` open no audio device, and both
 * are expected to fail to spawn at all (P31).
 */
describe('006 finding 1 — prepare() must not report warm on a synthesizer that cannot run', () => {
  it('throws, names the reason, and stays cold when the binary cannot be resolved', async () => {
    if (process.platform === 'linux') {
      // WAS a bare `return` with the comment "the Linux ladder already throws; covered above".
      // That claim was never checked, and the mutation harness said so: with the guard mutated,
      // this file reported `2 passed | 33 skipped (35)` — the invariant was not exercised at all
      // on the one configuration CI tests. Emptying PATH cannot break the Linux ladder, because
      // it probes each backend by name and espeak-ng answers.
      //
      // So the ladder is pointed at a candidate that cannot exist. Same three assertions as the
      // darwin arm below: it must throw, it must stay cold, and the reason must survive.
      const lp = new OsSynthProvider({
        timeoutMs: 5_000,
        linuxBackendCandidates: ['definitely-not-a-real-backend' as unknown as LinuxBackend]
      })
      let linuxThrew: unknown = null
      await lp.prepare().catch((e: unknown) => { linuxThrew = e })
      expect(linuxThrew, 'prepare() reported success with no resolvable backend').not.toBeNull()
      expect(lp.isWarm, 'a provider that cannot speak must never report itself warm').toBe(false)
      expect(lp.unavailableReason, 'the reason must survive where a caller can read it').toBeTruthy()
      return
    }
    const p = new OsSynthProvider({ timeoutMs: 5_000 })
    const realPath = process.env['PATH']
    let thrown: unknown = null
    try {
      process.env['PATH'] = ''
      await p.prepare().catch((e: unknown) => { thrown = e })
    } finally {
      process.env['PATH'] = realPath
    }
    expect(thrown, 'prepare() reported success on a synthesizer that cannot be spawned').not.toBeNull()
    expect(p.isWarm, 'a provider that cannot speak must never report itself warm').toBe(false)
    expect(p.unavailableReason, 'the reason must survive where a caller can read it').toBeTruthy()
    expect(String((thrown as Error).message), 'the message must name the missing binary')
      .toMatch(process.platform === 'darwin' ? /say/ : /powershell/)
  })

  it('CONTROL: with a real PATH the same provider prepares and reports warm', async () => {
    // Without this the assertions above could pass on a provider that never prepares at all.
    const p = new OsSynthProvider({ timeoutMs: 30_000 })
    await p.prepare()
    expect(p.isWarm).toBe(true)
    expect(p.unavailableReason, 'a working engine must report no reason').toBeNull()
  })
})

/**
 * 006 sites 42, 43, 44 and 39, and cascade C6.
 *
 * Four swallows in one file. A 60-second hang, an unreadable WAV, a zero-byte WAV and a failed
 * `spd-say --cancel` all produced no audio AND no word — the listener waited for a reply that had
 * already been abandoned, with every diagnostic reporting normal.
 *
 * NO AUDIO IS PLAYED HERE (P31). Every synthesizer is a two-line shell script on a temporary PATH:
 * one that exits 0 writing nothing, one that sleeps. They open no audio device, and using a real
 * engine could not produce these failures anyway.
 */
describe('006 sites 42/43/44 — a synthesizer that produces nothing says so', () => {
  const withFakeEngine = async (
    body: string, fn: (p: OsSynthProvider) => Promise<void>, timeoutMs = 30_000
  ): Promise<void> => {
    const { mkdtemp, writeFile, chmod } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'orca-tts-fakeengine-'))
    const bin = join(dir, 'espeak-ng')
    await writeFile(bin, `#!/bin/sh\n${body}\n`)
    await chmod(bin, 0o755)
    const realPath = process.env['PATH']
    try {
      process.env['PATH'] = dir
      await fn(new OsSynthProvider({ platform: 'linux', linuxBackend: 'espeak-ng', timeoutMs }))
    } finally {
      process.env['PATH'] = realPath
    }
  }

  it('site 43: exiting 0 without writing audio is a named failure, not silence', async () => {
    if (process.platform === 'win32') return   // no /bin/sh
    await withFakeEngine('exit 0', async (p) => {
      let thrown: unknown = null
      try {
        for await (const _ of p.generate('hello there')) { void _ }
      } catch (e) { thrown = e }
      expect(thrown, 'a synthesizer that wrote nothing produced no audio and no word').not.toBeNull()
      expect((thrown as Error).name).toBe('OsSynthEmptyOutputError')
      expect(String((thrown as Error).message), 'the reason must be actionable').toMatch(/no audio|could not be read/i)
    })
  })

  it('site 42: a wedged synthesizer is killed AND reported, not killed and swallowed', async () => {
    if (process.platform === 'win32') return
    // Absolute path: PATH is the fake-engine directory, so a bare `sleep` would not resolve and
    // the script would exit 127 instantly — a fixture that cannot express the failure (P33).
    await withFakeEngine('exec /bin/sleep 30', async (p) => {
      const began = Date.now()
      let thrown: unknown = null
      try {
        for await (const _ of p.generate('hello there')) { void _ }
      } catch (e) { thrown = e }
      expect(thrown, 'a 60-second hang used to produce no audio and no word').not.toBeNull()
      expect((thrown as Error).name).toBe('OsSynthTimeoutError')
      // The half that was already right and must stay right: it is a report, never a hang.
      expect(Date.now() - began, 'the child must still be killed at the deadline').toBeLessThan(5_000)
    }, 300)
  })

  it('CONTROL: an engine that DOES write audio still yields it and throws nothing', async () => {
    if (process.platform === 'win32') return
    // Proves the two assertions above can fail for the right reason: the throw is not unconditional.
    await withFakeEngine('while [ "$1" != "-w" ]; do shift; done; printf RIFFxxxx > "$2"', async (p) => {
      const out: number[] = []
      for await (const c of p.generate('hello there')) out.push(c.data.length)
      expect(out, 'a working engine must not be reported as broken').toEqual([8])
    })
  })
})

/**
 * 006 site 39 + cascade C6 — the one control that must never lie.
 *
 * `spd-say --cancel` was spawned fire-and-forget with BOTH its `'error'` event and its surrounding
 * `catch` swallowed, so barge-in on the Linux floor could fail with no trace at all. And because
 * nothing awaited it, `#drain` handed the next utterance to the same daemon before the cancel
 * arrived — the listener pressed skip and got two overlapping voices, with the stop control now
 * behaving as a start control.
 *
 * `spd-say` does not exist on this machine, so spawning it fails — which is exactly the failure
 * mode under test, and it opens no audio device.
 */
describe('006 site 39 / C6 — a daemon cancel that failed is reported, and is awaited', () => {
  it('reports a cancel that could not reach the daemon', async () => {
    const said: string[] = []
    const p = new OsSynthProvider({ platform: 'linux', linuxBackend: 'spd-say', notify: (m) => said.push(m) })
    await p.cancel()
    expect(p.lastCancelFailure, 'barge-in failed and left no trace at all').toBeTruthy()
    expect(said.join(' '), 'the listener must be told that stop may not have worked')
      .toMatch(/stop may not have worked/i)
  })

  it('C6: cancel is awaitable, so the next utterance cannot outrun it', async () => {
    // The property that makes two voices impossible: `cancel()` returns a promise on this rung,
    // and PlaybackQueue.bargeIn awaits it (queue.test.ts asserts the awaiting half).
    const p = new OsSynthProvider({ platform: 'linux', linuxBackend: 'spd-say' })
    const returned = p.cancel()
    expect(returned, 'a fire-and-forget cancel cannot be ordered against anything').toBeInstanceOf(Promise)
    await returned
  })

  it('CONTROL: on a WAV rung cancel stays synchronous — there is no daemon to tell', async () => {
    const p = new OsSynthProvider({ platform: 'linux', linuxBackend: 'espeak-ng' })
    expect(p.cancel(), 'only the spd-say floor needs a second process').toBeUndefined()
    expect(p.lastCancelFailure).toBeNull()
  })
})

/**
 * R8-04 / R8-06 — the leading-`-` argv class, checked on every platform branch over ONE corpus.
 *
 * The defect: `#command`'s darwin branch appended the chunk text to argv with no end-of-options
 * separator, so `say` parsed a leading `-` as a flag, exited 1 and wrote no file. Live trigger,
 * measured through the running Voice Lab before this fix:
 *
 *   POST /speak "First point here.\n\n---\n\nSecond point here."
 *     chunk 0  OK   "First point here."
 *     chunk 1  FAIL "--- Second point here."  -> OsSynthEmptyOutputError
 *     end: delivered 2, lost 1, "one of two parts could not be spoken and was skipped."
 *
 * A markdown horizontal rule is how agents separate sections and how YAML frontmatter is
 * delimited, so half of an ordinary reply was lost, on the author's own platform.
 *
 * WHY A CORPUS AND NOT A `---` CASE. A test for `---` would pass over a fix that special-cased
 * `---`, and a blocklist of dangerous prefixes is how this bug got here. The corpus is every shape
 * of leading `-` an agent reply actually produces, plus the strings that would do real damage if
 * they reached the option parser (`-o` would redirect the output file). None of these are HTML
 * comments: J21 removed those from the pipeline entirely, so a test built on one would be testing
 * someone else's fix.
 */
describe('R8-04/R8-06 no chunk text can be interpreted as an option, on any platform', () => {
  // Independently restated, NOT imported from the source (P36). Each row is a thing a real agent
  // reply contains.
  const HOSTILE = [
    '--- Second point here.',            // markdown horizontal rule — the live defect
    '-- a dash-led aside.',
    '- first bullet item.',
    '-5 degrees today.',                 // a negative number opening a sentence
    '--data-format=BOGUS',               // an option say really has, and really rejects
    '-o /tmp/orca-tts-should-not-exist.wav hi',  // would redirect the output file
    '-v Alex hello',
    '-f /etc/passwd',
    '--',                                // the separator itself, as content
    '\u2014 an em-dash-led aside.'
  ] as const

  it('darwin: every hostile string lands strictly after the `--` separator', () => {
    for (const text of HOSTILE) {
      const { cmd, args } = darwinCommand(text, '/tmp/a.wav', {})
      expect(cmd).toBe('say')
      const sep = args.indexOf('--')
      expect(sep, `no end-of-options separator for ${JSON.stringify(text)}`).toBeGreaterThanOrEqual(0)
      // The text must be present, and it must be AFTER the separator. Both halves matter: a fix
      // that dropped the text would satisfy "not parsed as an option" and lose the reply.
      expect(args.slice(sep + 1), `text not after the separator for ${JSON.stringify(text)}`)
        .toContain(text)
      // Nothing before the separator may be user text — that is the option-position region.
      expect(args.slice(0, sep), `user text sits in option position for ${JSON.stringify(text)}`)
        .not.toContain(text)
    }
  })

  it('linux: same property, on every rung of the ladder', () => {
    for (const backend of ['espeak-ng', 'espeak', 'spd-say'] as const) {
      for (const text of HOSTILE) {
        const { args } = linuxCommand(backend, text, '/tmp/a.wav', {})
        const sep = args.indexOf('--')
        expect(sep, `${backend} has no separator for ${JSON.stringify(text)}`).toBeGreaterThanOrEqual(0)
        expect(args.slice(sep + 1)).toContain(text)
        expect(args.slice(0, sep)).not.toContain(text)
      }
    }
  })

  it('win32: the text never occupies an argv position at all', () => {
    for (const text of HOSTILE) {
      const { cmd, args } = win32Command(text, 'C:\\a.wav', {})
      expect(cmd).toBe('powershell')
      // Windows reaches the property a different way — the text is inside a single-quoted
      // PowerShell literal in ONE `-Command` argument — so the assertion is different too.
      expect(args, `${JSON.stringify(text)} became its own argv element`).not.toContain(text)
      expect(args.filter((a) => a.startsWith('-'))).toEqual(
        ['-NoProfile', '-NonInteractive', '-STA', '-Command'])
      // Present, not dropped: the same both-halves check as darwin.
      expect(args[4]).toContain(text.replace(/'/g, "''"))
    }
  })

  it('a voice name with a leading dash cannot displace the text either', () => {
    const { args } = darwinCommand('hello', '/tmp/a.wav', { voice: '--data-format=BOGUS' })
    const sep = args.indexOf('--')
    expect(args.slice(sep + 1)).toEqual(['hello'])
    // `-v` consumes the next element as its operand, so the voice stays a voice.
    expect(args[args.indexOf('-v') + 1]).toBe('--data-format=BOGUS')
  })

  it.skipIf(process.platform !== 'darwin')(
    'VERIFY BY EFFECT: a reply opening with a horizontal rule is synthesized, not lost (macOS)',
    async () => {
      // The live defect, end to end through the real `say`. Before the fix this threw
      // OsSynthEmptyOutputError and yielded zero bytes. `say -o <file>` opens no audio device (P31).
      const p = new OsSynthProvider()
      let bytes = 0
      for await (const c of p.generate('--- Second point here.')) bytes += c.data.length
      expect(bytes, 'the chunk produced no audio — it was parsed as an option').toBeGreaterThan(10_000)
    }, 30_000)
})

/**
 * R8-05 — two causes, two messages.
 *
 * `#synthesizeToFile` ignored the child's exit code while `#capture`, twenty lines away, checked
 * it. So `say` exiting **1** with `say: unrecognized option` resolved normally, `readFile` returned
 * null, and the listener was told:
 *
 *   "say exited successfully but its audio file could not be read"
 *
 * That sentence is false about a process that exited 1, and its sibling message volunteers "is the
 * disk full?" — sending a reader chasing R8-04 to the filesystem. The engine's own stderr is the
 * real diagnosis and was being discarded by `stdio: 'ignore'`.
 */
describe('R8-05 a non-zero exit is reported as a non-zero exit, in the engine\'s own words', () => {
  const withFakeEngine = async (
    body: string, fn: (p: OsSynthProvider) => Promise<void>, timeoutMs = 30_000
  ): Promise<void> => {
    const { mkdtemp, writeFile, chmod } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'orca-tts-exitcode-'))
    const bin = join(dir, 'espeak-ng')
    await writeFile(bin, `#!/bin/sh\n${body}\n`)
    await chmod(bin, 0o755)
    const realPath = process.env['PATH']
    try {
      process.env['PATH'] = dir
      await fn(new OsSynthProvider({ platform: 'linux', linuxBackend: 'espeak-ng', timeoutMs }))
    } finally {
      process.env['PATH'] = realPath
    }
  }

  const thrownBy = async (p: OsSynthProvider, text = 'hello there'): Promise<Error | null> => {
    try {
      for await (const _ of p.generate(text)) { void _ }
      return null
    } catch (e) { return e as Error }
  }

  it('names the exit code and carries the child\'s stderr verbatim', async () => {
    if (process.platform === 'win32') return   // no /bin/sh
    await withFakeEngine(
      'echo "espeak-ng: unrecognized option \'--- Heading.\'" >&2; exit 1',
      async (p) => {
        const err = await thrownBy(p)
        expect(err, 'a synthesizer that exited 1 produced no audio and no word').not.toBeNull()
        expect(err?.name).toBe('OsSynthExitError')
        expect(err?.message).toContain('exited 1')
        // The whole point: the engine's own diagnosis reaches the listener's channel.
        expect(err?.message, 'the child\'s stderr was discarded').toContain('unrecognized option')
        // And the sentence that used to be told about this event must NOT be told about it.
        expect(err?.message).not.toContain('exited successfully')
        expect(err?.message, 'still pointing at the filesystem').not.toContain('disk full')
      })
  })

  it('CONTROL: exit 0 with no audio is still the OTHER error, with the OTHER message', async () => {
    if (process.platform === 'win32') return
    // Proves the assertions above discriminate: the two causes must not collapse back into one.
    await withFakeEngine('exit 0', async (p) => {
      const err = await thrownBy(p)
      expect(err?.name).toBe('OsSynthEmptyOutputError')
      expect(err?.message).toContain('exited successfully')
    })
  })

  it('a non-zero exit with a silent child still says something actionable', async () => {
    if (process.platform === 'win32') return
    await withFakeEngine('exit 3', async (p) => {
      const err = await thrownBy(p)
      expect(err?.name).toBe('OsSynthExitError')
      expect(err?.message).toContain('exited 3')
      expect(err?.message).toMatch(/said nothing about why/)
    })
  })

  it('barge-in is not reported as an engine fault', async () => {
    if (process.platform === 'win32') return
    // cancel() SIGKILLs the child, so `close` fires with code null. Before the exit-code check
    // existed this could not misfire; now it can, and a listener told "the engine failed" every
    // time they pressed skip is a worse regression than the bug being fixed.
    await withFakeEngine('exec /bin/sleep 5', async (p) => {
      const run = thrownBy(p)
      await new Promise((r) => setTimeout(r, 200))
      await p.cancel()
      expect(await run, 'pressing skip was reported as a synthesis failure').toBeNull()
    })
  })
})
