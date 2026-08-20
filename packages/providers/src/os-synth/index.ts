/**
 * OS synthesizer provider — the floor of the degradation ladder.
 *
 * Every desktop OS ships a speech synthesizer. It is slower than a neural engine
 * (macOS `say` costs ~414 ms just to spawn, measured — PITFALLS P10) and cannot stream partial
 * audio, but it needs no download, no key, no network, and it is always there. That is what makes
 * "never fail silently" (constitution principle I) true on first run and on Windows-on-ARM, where
 * no sherpa build exists (PITFALLS P7).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AudioChunk, ProviderCapabilities, SynthesizeOptions, TtsProvider
} from '@orca-tts/core'

export type OsPlatform = 'darwin' | 'win32' | 'linux'

export interface OsSynthOptions {
  /** Override for tests. Defaults to `process.platform`. */
  readonly platform?: OsPlatform
}

const CAPABILITIES: ProviderCapabilities = {
  streaming: false,          // whole-utterance only; honest per T041d
  offline: true,
  needsApiKey: false,
  needsModelDownload: 0,
  licence: 'OS-provided',
  cloning: false,
  sampleRate: 22050
}

export class OsSynthUnavailableError extends Error {
  constructor(platform: string, tried: readonly string[]) {
    super(`No OS speech synthesizer found on ${platform}. Tried: ${tried.join(', ')}`)
    this.name = 'OsSynthUnavailableError'
  }
}

export class OsSynthProvider implements TtsProvider {
  readonly id = 'os-synth'
  readonly displayName = 'System voice'
  readonly capabilities = CAPABILITIES

  readonly #platform: OsPlatform
  #warm = false
  #child: ChildProcess | null = null
  #cancelled = false

  constructor(opts: OsSynthOptions = {}) {
    this.#platform = opts.platform ?? (process.platform as OsPlatform)
  }

  get isWarm(): boolean { return this.#warm }

  async prepare(): Promise<void> {
    if (this.#warm) return
    // Presence is not warmth; confirm the binary actually answers.
    await this.listVoices()
    this.#warm = true
  }

  cancel(): void {
    this.#cancelled = true
    const c = this.#child
    this.#child = null
    if (c !== null && c.exitCode === null) c.kill('SIGKILL')
  }

  async listVoices(): Promise<readonly string[]> {
    try {
      switch (this.#platform) {
        case 'darwin': {
          const out = await this.#capture('say', ['-v', '?'])
          return out.split('\n').map((l) => l.split(/\s{2,}/)[0]?.trim() ?? '').filter((v) => v.length > 0)
        }
        case 'win32': {
          const ps = 'Add-Type -AssemblyName System.Speech; ' +
            '(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ' +
            '%{ $_.VoiceInfo.Name }'
          const out = await this.#capture('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps])
          return out.split('\n').map((l) => l.trim()).filter((v) => v.length > 0)
        }
        case 'linux': {
          const out = await this.#capture('spd-say', ['--list-synthesis-voices']).catch(() => '')
          if (out.length > 0) return out.split('\n').map((l) => l.trim()).filter((v) => v.length > 0)
          await this.#capture('espeak-ng', ['--version'])
          return ['default']
        }
      }
    } catch {
      return []
    }
  }

  async *generate(text: string, opts: SynthesizeOptions = {}): AsyncIterable<AudioChunk> {
    this.#cancelled = false
    if (text.trim().length === 0) return              // T041b: nothing to say

    const dir = await mkdtemp(join(tmpdir(), 'orca-tts-'))
    const wav = join(dir, 'out.wav')
    try {
      await this.#synthesizeToFile(text, wav, opts)
      if (this.#cancelled || opts.signal?.aborted === true) return
      const data = await readFile(wav).catch(() => null)
      if (data === null || data.length === 0) return
      yield { data: new Uint8Array(data), format: 'wav', sampleRate: CAPABILITIES.sampleRate, channels: 1 }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  #command(text: string, outFile: string, opts: SynthesizeOptions): { cmd: string; args: string[] } {
    switch (this.#platform) {
      case 'darwin': {
        // WAV, never the default AIFF: decodeAudioData rejects AIFF-C (measured, E6e).
        const args = ['-o', outFile, '--data-format=LEI16@22050']
        if (opts.voice !== undefined) args.push('-v', opts.voice)
        if (opts.rate !== undefined) args.push('-r', String(Math.round(opts.rate * 175)))
        args.push(text)
        return { cmd: 'say', args }
      }
      case 'win32': {
        const esc = (s: string) => s.replace(/'/g, "''")
        const rate = opts.rate === undefined ? 0 : Math.max(-10, Math.min(10, Math.round((opts.rate - 1) * 10)))
        const voice = opts.voice === undefined ? '' : `$s.SelectVoice('${esc(opts.voice)}'); `
        const ps =
          'Add-Type -AssemblyName System.Speech; ' +
          '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
          voice +
          `$s.Rate = ${rate}; ` +
          `$s.SetOutputToWaveFile('${esc(outFile)}'); ` +
          `$s.Speak('${esc(text)}'); $s.Dispose()`
        return { cmd: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', ps] }
      }
      case 'linux': {
        const args = ['-w', outFile]
        if (opts.voice !== undefined) args.push('-v', opts.voice)
        args.push(text)
        return { cmd: 'espeak-ng', args }
      }
    }
  }

  async #synthesizeToFile(text: string, outFile: string, opts: SynthesizeOptions): Promise<void> {
    const { cmd, args } = this.#command(text, outFile, opts)
    await new Promise<void>((resolve, reject) => {
      let child: ChildProcess
      try {
        child = spawn(cmd, args, { stdio: 'ignore' })
      } catch (err) {
        reject(new OsSynthUnavailableError(this.#platform, [cmd]))
        void err
        return
      }
      this.#child = child
      child.on('error', () => reject(new OsSynthUnavailableError(this.#platform, [cmd])))
      child.on('close', () => { this.#child = null; resolve() })
      opts.signal?.addEventListener('abort', () => this.cancel(), { once: true })
    })
  }

  #capture(cmd: string, args: readonly string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      let child: ChildProcess
      try {
        child = spawn(cmd, [...args], { stdio: ['ignore', 'pipe', 'ignore'] })
      } catch {
        reject(new OsSynthUnavailableError(this.#platform, [cmd]))
        return
      }
      let out = ''
      child.stdout?.on('data', (d: Buffer) => { out += d.toString('utf8') })
      child.on('error', () => reject(new OsSynthUnavailableError(this.#platform, [cmd])))
      child.on('close', (code) => {
        if (code === 0) resolve(out)
        else reject(new OsSynthUnavailableError(this.#platform, [cmd]))
      })
    })
  }
}
