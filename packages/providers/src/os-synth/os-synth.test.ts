import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { OsSynthProvider, linuxCommand, neutralizeInBandCommands } from './index.js'
import { runProviderContract } from '../contract.js'  // test-only entry, never via the barrel

// T045: the contract runs against the real OS synthesizer on whatever platform CI is on.
runProviderContract('OsSynthProvider', () => new OsSynthProvider())

describe('T042 per-platform command construction', () => {

  it('T042e reports unavailability rather than failing silently', async () => {
    // A platform whose binary does not exist must yield no voices, not throw into the caller.
    const p = new OsSynthProvider({ platform: 'linux' })
    const voices = await p.listVoices()
    expect(Array.isArray(voices)).toBe(true)
  })

  it('produces real audio bytes on this platform', async () => {
    const p = new OsSynthProvider()
    await p.prepare()
    let bytes = 0
    for await (const c of p.generate('Testing one two three.')) bytes += c.data.length
    expect(bytes, 'the OS synthesizer produced no audio').toBeGreaterThan(1000)
  }, 120_000)

  it('T042a macOS output is WAV, never AIFF — decodeAudioData rejects AIFF-C', async () => {
    if (process.platform !== 'darwin') return
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
  it('cancel stops the child process promptly', async () => {
    const p = new OsSynthProvider()
    await p.prepare()
    const iter = p.generate('This is a long sentence. '.repeat(30))[Symbol.asyncIterator]()
    const pending = iter.next()
    await new Promise((r) => setTimeout(r, 50))
    const t0 = Date.now()
    p.cancel()
    await pending
    const elapsed = Date.now() - t0
    console.info(`[measured] OsSynthProvider cancel -> return: ${elapsed} ms`)
    expect(elapsed).toBeLessThan(2000)
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

  it('detection failure is named and actionable, not a swallowed exception', async () => {
    if (!noLinuxBinaries) return
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

  it('prepare() refuses to report warm when nothing on the box can speak', async () => {
    if (!noLinuxBinaries) return
    const p = new OsSynthProvider({ platform: 'linux' })
    await expect(p.prepare()).rejects.toThrow(/No Linux speech synthesizer/)
    expect(p.isWarm, 'reported warm while unable to make a sound').toBe(false)
  })

  it('tells the user, through notify, which binary is missing', async () => {
    if (!noLinuxBinaries) return
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

  it('VERIFY BY EFFECT: bracketed text is spoken, not executed (macOS)', async () => {
    if (process.platform !== 'darwin') return
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
