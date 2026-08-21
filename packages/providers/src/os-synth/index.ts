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
  /**
   * Seed the Linux backend instead of probing for it. Override for tests ONLY — the real path is
   * `#resolveLinuxBackend`, and seeding it is how the `spd-say` floor (which has no binary on a
   * developer's machine and no audio capture anywhere) can be exercised at all.
   */
  readonly linuxBackend?: LinuxBackend
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

/**
 * Neutralize in-band synthesizer command syntax before any text reaches a spawned engine.
 *
 * `[[` opens an embedded command on BOTH engines we drive from prose:
 *  - macOS `say`: `[[volm 0.2]]` sets playback volume. VERIFIED BY EFFECT on macOS 26.5 —
 *    `say -o a.wav "hello [[volm 0.2]] world"` and `say -o c.wav "hello world"` produce
 *    byte-identical output (41258 bytes each), i.e. the bracketed run is executed, not spoken,
 *    while `"hello [ [volm 0.2]] world"` produces 129692 bytes because it IS spoken.
 *  - espeak-ng: text inside `[[ ]]` is reinterpreted as phoneme mnemonics — its own man page
 *    gives `espeak-ng -ven-us "[[h@'loU]]"` -> speaks "hello" (espeak-ng/espeak-ng
 *    `src/espeak-ng.1.ronn`, EXAMPLES). So the prose is silently replaced by whatever those
 *    letters mean as phonemes.
 *
 * This is a LIVE defect in shipped v1: an agent reply, or a repository containing that string in a
 * code comment, can set the assistive tool's volume to zero with no error and no indication. The
 * normalizer does not close it — `expandNumbers` happens to destroy integer arguments
 * (`[[pbas 46]]` -> `[[pbas forty six]]`) but decimals are handed to the engine untouched, so
 * `[[volm 0.2]]` survives verbatim. That is luck, not a defence.
 *
 * The fix is a separator, not a delete: the lexer needs the two brackets adjacent, so one space
 * between them makes the run inert while the listener still hears every character the agent wrote.
 * Deleting it would be a silent omission, which is the failure class this project exists to avoid.
 *
 * ORDER MATTERS for design 005: any control token WE generate (`[[pbas n]]`) must be prepended
 * AFTER this runs, never before — this function cannot tell our tokens from the agent's prose.
 *
 * Windows is not routed through here because it is clean: `System.Speech`'s `Speak(String)` speaks
 * plain text (SSML has its own entry point, `SpeakSsml`), and `#command` already doubles single
 * quotes, which is the only PowerShell metacharacter inside a single-quoted string. It is applied
 * on every platform anyway, because a no-op on a clean surface costs nothing and the next engine
 * we add is more likely to have the hole than not.
 */
export function neutralizeInBandCommands(text: string): string {
  return text.replace(/\[\[/g, '[ [')
}

export class OsSynthUnavailableError extends Error {
  constructor(platform: string, tried: readonly string[]) {
    super(`No OS speech synthesizer found on ${platform}. Tried: ${tried.join(', ')}`)
    this.name = 'OsSynthUnavailableError'
  }
}

/**
 * The synthesizer exited 0 and produced no usable audio. 006 site 43: an unreadable WAV and a
 * zero-byte WAV both ended in one silent `return`, indistinguishable from "there was nothing to
 * say" — a disk-full or a synthesizer that exits successfully without writing produced no sound
 * and no word.
 */
export class OsSynthEmptyOutputError extends Error {
  constructor(cmd: string, why: 'unreadable' | 'empty') {
    super(why === 'empty'
      ? `${cmd} exited successfully but wrote no audio (is the disk full?)`
      : `${cmd} exited successfully but its audio file could not be read`)
    this.name = 'OsSynthEmptyOutputError'
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
  backend: LinuxBackend, rawText: string, outFile: string, opts: SynthesizeOptions
): { cmd: string; args: string[] } {
  // Also neutralized here, not only at `#command`: this builder is exported and is what the tests
  // (and any future caller) reach, and the operation is idempotent, so belt-and-braces is free.
  const text = neutralizeInBandCommands(rawText)
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
  /**
   * Resolves once the last `spd-say --cancel` has actually exited. 006 C6 + site 39: the cancel was
   * fire-and-forget with BOTH its 'error' event and its surrounding catch swallowed, so barge-in on
   * the Linux floor could fail with no trace — and the next utterance was handed to the same daemon
   * before the cancel arrived, producing two overlapping voices.
   */
  #cancelInFlight: Promise<void> | null = null
  #lastCancelFailure: string | null = null

  constructor(opts: OsSynthOptions = {}) {
    this.#platform = opts.platform ?? (process.platform as OsPlatform)
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS
    this.#notify = opts.notify ?? (() => {})
    if (opts.linuxBackend !== undefined) this.#linuxBackend = opts.linuxBackend
  }

  get isWarm(): boolean { return this.#warm }

  /**
   * Why the last detection failed, in words a user can act on. `null` once something works.
   * Read by the host so the reason reaches a notification instead of dying in a catch block.
   */
  get unavailableReason(): string | null { return this.#unavailableReason }

  /** Which Linux binary is actually driving speech, once detected. `null` on other platforms. */
  get linuxBackend(): LinuxBackend | null { return this.#linuxBackend ?? null }

  /**
   * Confirm the synthesizer actually answers, and THROW when it does not.
   *
   * This used to be `await this.listVoices()`, which catches everything and returns `[]` without
   * throwing — so on macOS and Windows a broken `say` or a broken PowerShell set `#warm = true`,
   * the registry reported `rung: 'preferred'` with no reason, and the plugin logged "engine ready"
   * while being permanently mute. The real cause was written to `unavailableReason`, whose own doc
   * comment says it exists "so the reason reaches a notification instead of dying in a catch
   * block", and NO CALLER READ IT (006 sites 41 and 54, and the first of the FMA's three to fix
   * first). P25 and P18 fused: a probe that cannot fail, feeding a diagnostic nobody reads.
   *
   * `listVoices()` keeps its forgiving contract — it answers a settings UI's question, and "[]"
   * is a survivable answer there. `prepare()` answers "can this machine speak at all", and the
   * only honest answers to that are yes and a named no.
   */
  async prepare(): Promise<void> {
    if (this.#warm) return
    // Presence is not warmth; confirm the binary actually answers.
    if (this.#platform === 'linux') { await this.#resolveLinuxBackend(); this.#warm = true; return }
    const voices = await this.listVoices()
    if (voices.length === 0) {
      const why = this.#unavailableReason ??
        `${this.#platform === 'darwin' ? 'say' : 'powershell'} ran but listed no voices`
      this.#unavailableReason = why
      const err = new OsSynthUnavailableError(this.#platform, [this.#platform === 'darwin' ? 'say' : 'powershell'])
      err.message = `${err.message} — ${why}`
      this.#notify(`Read Aloud: ${err.message}`)
      throw err
    }
    this.#unavailableReason = null
    this.#warm = true
  }

  /** Why the last daemon cancel failed, if it did. `null` when barge-in reached the daemon. */
  get lastCancelFailure(): string | null { return this.#lastCancelFailure }

  cancel(): void | Promise<void> {
    this.#cancelled = true
    const c = this.#child
    this.#child = null
    if (c !== null && c.exitCode === null) c.kill('SIGKILL')
    // spd-say hands the text to the speech-dispatcher daemon, which owns playback: killing our
    // client does NOT stop the voice. Barge-in has to reach the daemon too (R022, two-sided).
    if (this.#linuxBackend !== 'spd-say') return
    this.#cancelInFlight = new Promise<void>((resolve) => {
      let child: ChildProcess
      try {
        child = spawn('spd-say', ['--cancel'], { stdio: 'ignore' })
      } catch (err) {
        // Was `catch { /* best effort */ }`. "Best effort" on the ONE control that must never lie
        // is not best effort, it is an unreported failure of barge-in (site 39).
        this.#noteCancelFailure(`spd-say --cancel could not be spawned: ${String(err)}`)
        resolve()
        return
      }
      const done = (why: string | null): void => {
        this.#noteCancelFailure(why)
        resolve()
      }
      // Was `.on('error', () => {})` — the second of the two swallows.
      child.on('error', (err) => { done(`spd-say --cancel could not be started: ${String(err)}`) })
      child.on('close', (code) => {
        done(code === 0 ? null : `spd-say --cancel exited ${String(code)}; the daemon may still be speaking`)
      })
    })
    return this.#cancelInFlight
  }

  #noteCancelFailure(why: string | null): void {
    this.#lastCancelFailure = why
    if (why !== null) this.#notify(`Read Aloud: stop may not have worked — ${why}`)
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
      // Site 42: `if (err instanceof OsSynthTimeoutError) return` meant a 60-second hang produced
      // no audio AND no word — the listener waited a minute for a reply that had already been
      // abandoned. It is still never a hang (the child is killed), but it is now a named failure
      // the speech service can report aloud.
      await this.#synthesizeToFile(text, wav, opts)
      if (this.#cancelled || opts.signal?.aborted === true) return
      const data = await readFile(wav).catch(() => null)
      // Site 43: these were one silent `return`, indistinguishable from "nothing to say".
      if (data === null) throw new OsSynthEmptyOutputError(this.#command(text, wav, opts).cmd, 'unreadable')
      if (data.length === 0) throw new OsSynthEmptyOutputError(this.#command(text, wav, opts).cmd, 'empty')
      yield { data: new Uint8Array(data), format: 'wav', sampleRate: CAPABILITIES.sampleRate, channels: 1 }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  #command(rawText: string, outFile: string, opts: SynthesizeOptions): { cmd: string; args: string[] } {
    // Every engine sees escaped text. Done here, at the single spawn boundary, rather than in the
    // normalizer: the normalizer is platform-agnostic and pure, and this is a property of the
    // engine we are about to hand the string to.
    const text = neutralizeInBandCommands(rawText)
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
    // C6: never hand a new utterance to the daemon while a cancel for the previous one is still in
    // flight. Without this the cancel could land on THIS message instead of the one it was meant
    // for, so pressing skip silenced the reply the listener had just skipped to.
    if (this.#cancelInFlight !== null) {
      await this.#cancelInFlight
      this.#cancelInFlight = null
      if (this.#cancelled) return
    }
    // Site 44: the same timeout swallow as site 42, on the floor. Let it out.
    await this.#synthesizeToFile(text, '', opts)
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
