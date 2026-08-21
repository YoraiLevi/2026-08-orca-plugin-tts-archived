/**
 * Playback sink that spawns the platform's audio player.
 *
 * Why a subprocess and not an npm audio package: `npm speaker`'s `end()` is documented to hang for
 * seconds, so it cannot do barge-in, and `naudiodon` is abandoned (see tts-engine-landscape.md).
 * Killing a player, by contrast, is ~3 ms kill-to-exit (`afplay`, n=10 x2; P9 - not audio-stop).
 *
 * Known limitation: ~950 ms of silence between sentences on macOS (p50 950/937/897 ms, n=18 x3,
 * latency-measurements.md 1.1). NOT process spawn (2.3 ms) - it is CoreAudio device open/teardown,
 * ~893 ms. So M9 must hold the DEVICE open across chunks; pooling processes saves 2 ms of 950.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AudioChunk, PlaybackSink } from '@orca-tts/core'

export interface Player { readonly cmd: string; readonly args: (file: string) => string[] }

const PLAYERS: Record<string, readonly Player[]> = {
  darwin: [{ cmd: 'afplay', args: (f) => [f] }],
  win32: [{
    cmd: 'powershell',
    args: (f) => ['-NoProfile', '-NonInteractive', '-Command',
      `$p = New-Object System.Media.SoundPlayer '${f.replace(/'/g, "''")}'; $p.PlaySync()`]
  }],
  linux: [
    { cmd: 'paplay', args: (f) => [f] },
    { cmd: 'aplay', args: (f) => [f] },
    { cmd: 'ffplay', args: (f) => ['-nodisp', '-autoexit', '-loglevel', 'quiet', f] }
  ]
}

/**
 * Why playback did not happen, as a value.
 *
 * `#play` used to resolve `true` on `close` REGARDLESS OF EXIT CODE (006 site 35), which had two
 * consequences that compound: a player that exits non-zero — `aplay` on a format it cannot decode,
 * `afplay` on a truncated file — ended the ladder, so the working player below it was never tried;
 * and "the plugin is broken" and "the plugin is idle" became the same observable state on all three
 * platforms. That is 006 section 19's rank ONE undetectable: audio reaching the device is never
 * asserted anywhere.
 */
export interface PlaybackFailure {
  readonly kind: 'no-player' | 'player-failed'
  readonly reason: string
  /** Players attempted, in ladder order. */
  readonly tried: readonly string[]
}

export interface SubprocessSinkOptions {
  readonly platform?: string
  readonly log?: (m: string) => void
  /**
   * Where a playback failure goes. The log is not a channel this listener has, so the host wires
   * this into the audio stream. Coalescing and urgency are the host's decision, not the sink's.
   */
  readonly onFailure?: (failure: PlaybackFailure) => void
  /**
   * Override the player ladder. Test seam ONLY, and the reason it exists is P31: exercising the
   * ladder with real audio players would play tones at whoever is sitting at this machine. A test
   * passes `sh -c 'exit 3'`, which proves exactly the property under test — a non-zero exit is not
   * success — and opens no audio device.
   */
  readonly players?: readonly Player[]
}

export class SubprocessSink implements PlaybackSink {
  readonly #platform: string
  readonly #log: (m: string) => void
  readonly #onFailure: (failure: PlaybackFailure) => void
  readonly #players: readonly Player[] | null
  #child: ChildProcess | null = null
  #playing = false
  #stopping = false
  #bytesPlayed = 0
  #lastExit: number | null = null

  constructor(opts: SubprocessSinkOptions = {}) {
    this.#platform = opts.platform ?? process.platform
    this.#log = opts.log ?? (() => {})
    this.#onFailure = opts.onFailure ?? (() => {})
    this.#players = opts.players ?? null
  }

  get isPlaying(): boolean { return this.#playing }

  /**
   * Bytes this sink has actually handed to a player that then exited 0. The self-test reads it,
   * because a byte count that MOVED is the only evidence that the audio path is alive; every other
   * indicator in this system reports healthy while mute (006 section 19 rank 1).
   */
  get bytesPlayed(): number { return this.#bytesPlayed }

  /** Exit code of the last player invocation. `null` if it was killed by barge-in or never ran. */
  get lastExitCode(): number | null { return this.#lastExit }

  async enqueue(chunk: AudioChunk): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'orca-tts-play-'))
    const file = join(dir, `chunk.${chunk.format === 'wav' ? 'wav' : 'bin'}`)
    await writeFile(file, chunk.data)
    try {
      if (await this.#play(file)) this.#bytesPlayed += chunk.data.length
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async stop(): Promise<void> {
    const c = this.#child
    this.#child = null
    // A player we killed ourselves exits non-zero. That is barge-in working, not playback failing,
    // and it must never be reported as a fault or every Stop would announce an error.
    this.#stopping = true
    this.#playing = false
    if (c !== null && c.exitCode === null) c.kill('SIGKILL')
  }

  async #play(file: string): Promise<boolean> {
    const players = this.#players ?? PLAYERS[this.#platform] ?? []
    const tried: string[] = []
    let lastReason = ''
    this.#stopping = false
    for (const p of players) {
      tried.push(p.cmd)
      const outcome = await new Promise<{ ok: boolean; why: string }>((resolve) => {
        let child: ChildProcess
        try { child = spawn(p.cmd, p.args(file), { stdio: 'ignore' }) }
        catch { resolve({ ok: false, why: `${p.cmd} could not be spawned` }); return }
        this.#child = child
        this.#playing = true
        child.on('error', () => {
          this.#playing = false
          resolve({ ok: false, why: `${p.cmd} could not be started` })
        })
        child.on('close', (code) => {
          this.#playing = false
          this.#child = null
          this.#lastExit = code
          // The whole fix: `resolve(true)` regardless of code is what made a broken player
          // indistinguishable from an idle one, AND stopped the ladder at the first rung that
          // "worked". Now a non-zero exit falls through to the next player.
          resolve(code === 0
            ? { ok: true, why: '' }
            : { ok: false, why: `${p.cmd} exited ${String(code)}` })
        })
      })
      if (outcome.ok) return true
      if (this.#stopping) return false   // barge-in, not a fault
      lastReason = outcome.why
      this.#log(`read-aloud: ${outcome.why}`)
    }
    // Never fail silently (principle I) — and never fail into a channel the listener does not have.
    const failure: PlaybackFailure = players.length === 0
      ? {
          kind: 'no-player',
          reason: `no audio player is installed on ${this.#platform}`,
          tried
        }
      : { kind: 'player-failed', reason: lastReason, tried }
    this.#log(`read-aloud: ${failure.reason}`)
    this.#onFailure(failure)
    return false
  }
}
