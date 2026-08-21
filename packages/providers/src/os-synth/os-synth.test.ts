import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { OsSynthProvider, linuxCommand, neutralizeInBandCommands } from './index.js'
import { runProviderContract, CANCEL_BUDGET_MS } from '../contract.js'  // test-only entry, never via the barrel

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
    const iter = p.generate('This is a long sentence. '.repeat(30))[Symbol.asyncIterator]()
    const pending = iter.next()
    await new Promise((r) => setTimeout(r, 50))
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
    if (process.platform === 'linux') return   // the Linux ladder already throws; covered above
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
