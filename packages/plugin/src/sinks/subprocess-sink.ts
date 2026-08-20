/**
 * Playback sink that spawns the platform's audio player.
 *
 * Why a subprocess and not an npm audio package: `npm speaker`'s `end()` is documented to hang for
 * seconds, so it cannot do barge-in, and `naudiodon` is abandoned (see tts-engine-landscape.md).
 * Killing a player process, by contrast, was measured at 0.9-1.5 ms.
 *
 * Known limitation, stated rather than hidden: one process per chunk gives a ~970 ms inter-sentence
 * gap on macOS (`afplay`). That is why M9 moves playback into the resident service, which holds one
 * player open. This sink is correct, cross-platform, and slow between sentences.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AudioChunk, PlaybackSink } from '@orca-tts/core'

interface Player { cmd: string; args: (file: string) => string[] }

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

export interface SubprocessSinkOptions {
  readonly platform?: string
  readonly log?: (m: string) => void
}

export class SubprocessSink implements PlaybackSink {
  readonly #platform: string
  readonly #log: (m: string) => void
  #child: ChildProcess | null = null
  #playing = false

  constructor(opts: SubprocessSinkOptions = {}) {
    this.#platform = opts.platform ?? process.platform
    this.#log = opts.log ?? (() => {})
  }

  get isPlaying(): boolean { return this.#playing }

  async enqueue(chunk: AudioChunk): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'orca-tts-play-'))
    const file = join(dir, `chunk.${chunk.format === 'wav' ? 'wav' : 'bin'}`)
    await writeFile(file, chunk.data)
    try {
      await this.#play(file)
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async stop(): Promise<void> {
    const c = this.#child
    this.#child = null
    this.#playing = false
    if (c !== null && c.exitCode === null) c.kill('SIGKILL')
  }

  async #play(file: string): Promise<void> {
    const players = PLAYERS[this.#platform] ?? []
    for (const p of players) {
      const ok = await new Promise<boolean>((resolve) => {
        let child: ChildProcess
        try { child = spawn(p.cmd, p.args(file), { stdio: 'ignore' }) }
        catch { resolve(false); return }
        this.#child = child
        this.#playing = true
        child.on('error', () => { this.#playing = false; resolve(false) })
        child.on('close', () => { this.#playing = false; this.#child = null; resolve(true) })
      })
      if (ok) return
    }
    // Never fail silently (principle I): if nothing can play, say so.
    this.#log(`read-aloud: no audio player found on ${this.#platform}`)
  }
}
