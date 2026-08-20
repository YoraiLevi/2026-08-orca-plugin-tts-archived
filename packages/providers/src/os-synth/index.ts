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
  /**
   * Hard deadline for any spawned helper. A synthesizer that never exits must not hang the
   * plugin — Windows PowerShell can block indefinitely on a headless session, and without this
   * the worker waits forever (found by CI on windows-latest, PITFALLS P14).
   */
  readonly timeoutMs?: number
  /**
   * User-visible channel for degradation and detection failures. Principle I, "never fail
   * silently": on Linux this is the difference between "no sound, no idea why" and a sentence
   * naming the missing binary and the apt command that fixes it.
   */
  readonly notify?: (message: string) => void
}

/** PowerShell + Add-Type of System.Speech is slow to start; be generous but never unbounded. */
export const DEFAULT_SPAWN_TIMEOUT_MS = 60_000

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

export class OsSynthTimeoutError extends Error {
  constructor(cmd: string, ms: number) {
    super(`${cmd} did not finish within ${ms} ms and was killed`)
    this.name = 'OsSynthTimeoutError'
  }
}

/**
 * Linux synthesis ladder, best first.
 *
 * Why a ladder at all: a stock Ubuntu 24.04 desktop does NOT ship `/usr/bin/espeak-ng`. The image
 * manifest carries `libespeak-ng1` + `espeak-ng-data` (speech-dispatcher's module links them) and
 * `speech-dispatcher`, but the espeak-ng CLI lives in its own package that is not installed
 * (DOCUMENTED: ubuntu-24.04.3-desktop-amd64.manifest, and packages.ubuntu.com contents search puts
 * /usr/bin/espeak-ng in package `espeak-ng`, /usr/bin/spd-say in package `speech-dispatcher`).
 * Shipping only the `espeak-ng` path therefore made us SILENT on the most common Linux desktop.
 *
 * - `espeak-ng` / `espeak`: write a real WAV (`-w`). Playback stays with the client (R023).
 * - `spd-say`: CANNOT write a file. Verified against upstream `brailcom/speechd`
 *   `src/clients/say/options.c` — `-w` is `--wait`, and there is no file-output option at all;
 *   speech-dispatcher's own audio layer only opens oss/alsa/nas/libao/pulse
 *   (`src/modules/module_utils.c` `module_audio_init`), so no capture path exists either.
 *   It is kept as the FLOOR because on a stock desktop it is the only thing that makes a sound.
 *   In this mode the provider yields no audio and speech-dispatcher owns playback — a deliberate,
 *   announced exception to R023, taken because silence is worse for assistive tech.
 *
 * DO NOT "optimize" the espeak-ng rung to `--stdout` to skip the temp file. `--stdout` writes the
 * 44-byte header template verbatim — RIFF size 0x7ffff024, data size 0x7ffff000, ~2 GB — and
 * `CloseWavFile()` returns early for stdout (`espeak-ng/espeak-ng` `src/espeak-ng.c:250`), so those
 * lengths are NEVER backpatched. `-w <file>` does backpatch them (`:256-260`). We hand complete WAV
 * bytes to a sink and, later, to `decodeAudioData`; a data chunk claiming 2 GB is a decoder
 * problem, not a saved syscall. `--stdout` becomes correct only for a streaming consumer that
 * ignores the declared lengths — that is an M9 change, with its own header fixup.
 *
 * The speech-dispatcher SSIP socket was evaluated as a richer alternative to the spd-say CLI and
 * gives no audio either: the full SSIP verb list is set/history/stop/cancel/pause/resume/
 * sound_icon/char/key/list/get/help/block/speak/quit (`speechd` `src/server/parse.c:98-110`) with
 * no audio-retrieval verb, and `SET` has no audio-output parameter (`:424-680`). The one remaining
 * theoretical capture route — point the libao plugin at libao's wav driver — is closed at the
 * source: `src/audio/libao.c:75` calls `ao_open_live()`, which cannot open a file driver.
 * SSIP is still worth having for PAUSE/RESUME and index marks; it is not a way to get bytes.
 *
 * Probes that need a real Linux box (cannot be run from macOS):
 *   command -v espeak-ng espeak spd-say
 *   espeak-ng -w /tmp/a.wav -s 260 "one two three" && ls -l /tmp/a.wav
 *   spd-say --wait "one two three"            # expect audible speech, no file
 *   spd-say -w /tmp/b.wav "x"; ls /tmp/b.wav  # expect: no such file (-w is --wait)
 */
export type LinuxBackend = 'espeak-ng' | 'espeak' | 'spd-say'

export const LINUX_BACKENDS: readonly LinuxBackend[] = ['espeak-ng', 'espeak', 'spd-say']

/** Backends that produce a WAV we can hand to the sink. `spd-say` is not one of them. */
export const LINUX_WAV_BACKENDS: readonly LinuxBackend[] = ['espeak-ng', 'espeak']

export const LINUX_INSTALL_HINT =
  'Install one with:  sudo apt install espeak-ng   (or, for the speech-dispatcher floor:  ' +
  'sudo apt install speech-dispatcher speech-dispatcher-espeak-ng). ' +
  'Note: a stock Ubuntu desktop ships the espeak-ng LIBRARY but not the espeak-ng command.'

/**
 * Named and actionable, because the alternative — what shipped before — was a swallowed exception
 * and no sound. For a screen-reader-class tool, silent failure is the worst failure.
 */
export class LinuxSpeechUnavailableError extends Error {
  readonly tried: readonly string[]
  constructor(tried: readonly string[] = LINUX_BACKENDS) {
    super(`No Linux speech synthesizer found. Tried: ${tried.join(', ')}. ${LINUX_INSTALL_HINT}`)
    this.name = 'LinuxSpeechUnavailableError'
    this.tried = tried
  }
}

/** espeak-ng's own default speed is 175 wpm, the same base macOS `say` uses. Keep them comparable. */
const ESPEAK_BASE_WPM = 175
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

/**
 * Pure, so the argument vector is testable without a Linux box.
 * `rate` is honoured on every backend here — it used to be dropped on Linux only (H25, an R1
 * parity bug: rate worked on macOS and Windows and silently did nothing on Linux).
 */
export function linuxCommand(
  backend: LinuxBackend, text: string, outFile: string, opts: SynthesizeOptions
): { cmd: string; args: string[] } {
  if (backend === 'spd-say') {
    // --wait: exit only once the message has been spoken, so utterances stay in order.
    const args = ['--wait']
    if (opts.voice !== undefined) args.push('-y', opts.voice)
    if (opts.rate !== undefined) args.push('-r', String(clamp(Math.round((opts.rate - 1) * 100), -100, 100)))
    args.push('--', text)
    return { cmd: 'spd-say', args }
  }
  const args = ['-w', outFile]
  if (opts.voice !== undefined) args.push('-v', opts.voice)
  if (opts.rate !== undefined) args.push('-s', String(clamp(Math.round(opts.rate * ESPEAK_BASE_WPM), 80, 450)))
  args.push('--', text)
  return { cmd: backend, args }
}

export class OsSynthProvider implements TtsProvider {
  readonly id = 'os-synth'
  readonly displayName = 'System voice'
  readonly capabilities = CAPABILITIES

  readonly #platform: OsPlatform
  readonly #timeoutMs: number
  readonly #notify: (m: string) => void
  #warm = false
  #child: ChildProcess | null = null
  #cancelled = false
  #linuxBackend: LinuxBackend | null | undefined = undefined
  #announcedFloor = false
  #unavailableReason: string | null = null

  constructor(opts: OsSynthOptions = {}) {
    this.#platform = opts.platform ?? (process.platform as OsPlatform)
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS
    this.#notify = opts.notify ?? (() => {})
  }

  get isWarm(): boolean { return this.#warm }

  /**
   * Why the last detection failed, in words a user can act on. `null` once something works.
   * Read by the host so the reason reaches a notification instead of dying in a catch block.
   */
  get unavailableReason(): string | null { return this.#unavailableReason }

  /** Which Linux binary is actually driving speech, once detected. `null` on other platforms. */
  get linuxBackend(): LinuxBackend | null { return this.#linuxBackend ?? null }

  async prepare(): Promise<void> {
    if (this.#warm) return
    // Presence is not warmth; confirm the binary actually answers.
    if (this.#platform === 'linux') await this.#resolveLinuxBackend()   // throws, loudly, by design
    else await this.listVoices()
    this.#warm = true
  }

  cancel(): void {
    this.#cancelled = true
    const c = this.#child
    this.#child = null
    if (c !== null && c.exitCode === null) c.kill('SIGKILL')
    // spd-say hands the text to the speech-dispatcher daemon, which owns playback: killing our
    // client does NOT stop the voice. Barge-in has to reach the daemon too (R022, two-sided).
    if (this.#linuxBackend === 'spd-say') {
      try { spawn('spd-say', ['--cancel'], { stdio: 'ignore' }).on('error', () => {}) } catch { /* best effort */ }
    }
  }

  /**
   * Detect once, cache, and FAIL LOUDLY. Returns the winning backend or throws
   * `LinuxSpeechUnavailableError` naming every binary tried and the install command.
   */
  async #resolveLinuxBackend(): Promise<LinuxBackend> {
    if (this.#linuxBackend !== undefined && this.#linuxBackend !== null) return this.#linuxBackend
    const tried: string[] = []
    for (const backend of LINUX_BACKENDS) {
      tried.push(backend)
      const ok = await this.#capture(backend, ['--version']).then(() => true, () => false)
      if (!ok) continue
      this.#linuxBackend = backend
      this.#unavailableReason = null
      if (!LINUX_WAV_BACKENDS.includes(backend) && !this.#announcedFloor) {
        this.#announcedFloor = true
        // Degrade loudly (R015). The floor sounds different AND behaves differently: the daemon
        // plays the audio, so our own sink, volume and gap behaviour do not apply.
        this.#notify(
          'Read Aloud: espeak-ng is not installed, so speech is going through speech-dispatcher ' +
          `(spd-say). Quality and interruption are limited. ${LINUX_INSTALL_HINT}`
        )
      }
      return backend
    }
    this.#linuxBackend = null
    const err = new LinuxSpeechUnavailableError(tried)
    this.#unavailableReason = err.message
    this.#notify(`Read Aloud: ${err.message}`)
    throw err
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
          const out = await this.#capture('powershell', ['-NoProfile', '-NonInteractive', '-STA', '-Command', ps])
          return out.split('\n').map((l) => l.trim()).filter((v) => v.length > 0)
        }
        case 'linux': {
          const out = await this.#capture('spd-say', ['--list-synthesis-voices']).catch(() => '')
          if (out.length > 0) return out.split('\n').map((l) => l.trim()).filter((v) => v.length > 0)
          // No voice list without spd-say, but espeak-ng can still synthesize. Record the reason
          // rather than returning [] as if the question had been answered.
          await this.#resolveLinuxBackend()
          return ['default']
        }
      }
    } catch (err) {
      // An empty voice list is not evidence of "no voices" — it is evidence of a failed probe.
      // Keep the reason where the host can read it (`unavailableReason`) instead of discarding it.
      this.#unavailableReason = err instanceof Error ? err.message : String(err)
      return []
    }
  }

  async *generate(text: string, opts: SynthesizeOptions = {}): AsyncIterable<AudioChunk> {
    this.#cancelled = false
    if (text.trim().length === 0) return              // T041b: nothing to say

    if (this.#platform === 'linux') {
      // Throws LinuxSpeechUnavailableError when nothing is installed. Deliberately NOT caught:
      // the caller logs and notifies, and the user learns which binary is missing.
      const backend = await this.#resolveLinuxBackend()
      if (!LINUX_WAV_BACKENDS.includes(backend)) {
        // The floor: speech-dispatcher speaks it. No bytes come back, so nothing is yielded and
        // the sink stays idle. `--wait` keeps utterance ordering correct.
        await this.#speakDirect(text, opts)
        return
      }
    }

    const dir = await mkdtemp(join(tmpdir(), 'orca-tts-'))
    const wav = join(dir, 'out.wav')
    try {
      try {
        await this.#synthesizeToFile(text, wav, opts)
      } catch (err) {
        if (err instanceof OsSynthTimeoutError) return   // no audio, but never a hang
        throw err
      }
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
        return { cmd: 'powershell', args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', ps] }
      }
      case 'linux': {
        // Backend is resolved before generate() reaches here; default to the best rung so the
        // pure command builder stays total.
        return linuxCommand(this.#linuxBackend ?? 'espeak-ng', text, outFile, opts)
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
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
        reject(new OsSynthTimeoutError(cmd, this.#timeoutMs))
      }, this.#timeoutMs)
      const settle = (fn: () => void) => { clearTimeout(timer); fn() }
      child.on('error', () => settle(() => reject(new OsSynthUnavailableError(this.#platform, [cmd]))))
      child.on('close', () => settle(() => { this.#child = null; resolve() }))
      opts.signal?.addEventListener('abort', () => this.cancel(), { once: true })
    })
  }

  /**
   * Linux floor: hand the text to speech-dispatcher and wait for it to finish speaking.
   * We produce NO audio here — the daemon plays it. This is the one place a provider does not
   * emit PCM, and it exists only because on a stock Ubuntu desktop the alternative is silence.
   */
  async #speakDirect(text: string, opts: SynthesizeOptions): Promise<void> {
    try {
      await this.#synthesizeToFile(text, '', opts)
    } catch (err) {
      if (err instanceof OsSynthTimeoutError) return
      throw err
    }
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
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
        reject(new OsSynthTimeoutError(cmd, this.#timeoutMs))
      }, this.#timeoutMs)
      const settle = (fn: () => void) => { clearTimeout(timer); fn() }
      child.stdout?.on('data', (d: Buffer) => { out += d.toString('utf8') })
      child.on('error', () => settle(() => reject(new OsSynthUnavailableError(this.#platform, [cmd]))))
      child.on('close', (code) => settle(() => {
        if (code === 0) resolve(out)
        else reject(new OsSynthUnavailableError(this.#platform, [cmd]))
      }))
    })
  }
}
