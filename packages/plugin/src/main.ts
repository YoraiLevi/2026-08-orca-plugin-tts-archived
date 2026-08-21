/**
 * ORCA plugin entry point.
 *
 * `activate(orca)` receives the host API object directly — verified against
 * examples/plugins/hello-orca/main.mjs, not guessed.
 *
 * Bundled by esbuild into the self-contained artifact at dist/plugin/, because ORCA never runs a
 * build at install time and rejects any file escaping the plugin root (PITFALLS P17).
 */
import { OsSynthProvider, ProviderRegistry } from '@orca-tts/providers'
import { asAgentStatus, makeHost, worktreePathFrom, type OrcaApi } from './adapter/index.js'
import { readClipboard, ClipboardUnavailableError } from './clipboard.js'
import { SpeechService } from './speech-service.js'
import { SubprocessSink } from './sinks/subprocess-sink.js'
import { HuddleController, sessionLabel } from './huddle/index.js'

export default function activate(orca: OrcaApi): void {
  const host = makeHost(orca)
  host.log('read-aloud: activating')

  const registry = new ProviderRegistry()

  const sink = new SubprocessSink({ log: host.log })
  let speech: SpeechService | null = null
  let engineError: string | null = null
  /**
   * Announcements generated before the engine finishes resolving. The Linux-floor degradation
   * notice fires from inside `prepare()`, which is BEFORE `speech` exists — so without this buffer
   * the one message that explains why the voice sounds wrong is the one message that can never be
   * spoken.
   */
  const deferredAnnouncements: string[] = []

  /**
   * The single user-facing channel. Ordered deliberately: the AUDIO STREAM is the destination and
   * the desktop notification is a supplement, not the other way round.
   *
   * Before this, every "never fail silently" path in the plugin — queue overflow, the two-agents
   * ambiguity, the Linux-floor degradation, engine failure — terminated in `notifications.show`,
   * whose `{ delivered }` result is discarded (`adapter/index.ts:63`). This user is dyslexic and
   * voice-first and does not read the notification tray, so the project's central safety principle
   * was wired to a channel they do not have (006 section 16: 55 silent-failure sites, zero of them
   * reaching audio).
   */
  const announce = (message: string, urgency: 'now' | 'next' = 'next'): void => {
    host.log(`read-aloud: ${message}`)
    host.notify('Read Aloud', message)
    if (speech !== null) speech.announce(message, urgency)
    else deferredAnnouncements.push(message)
  }

  // The provider talks to the user directly for detection failures and degraded rungs: on Linux
  // the interesting failure ("espeak-ng is not installed") happens inside prepare(), far from any
  // command the user pressed.
  registry.register(new OsSynthProvider({ notify: (m) => { announce(m) } }), { preferred: true })

  // Resolve the engine in the background: activate() must return promptly so command registration
  // is never delayed behind a process spawn.
  void registry.resolve().then((resolved) => {
    if (resolved === null) {
      const why = registry.lastFailure ?? 'no speech engine is available on this system'
      engineError = why
      host.log(`read-aloud: ${why}`)
      // The ONE announcement that genuinely cannot be spoken: there is no engine to speak it with.
      // Stated here so the next reader does not mistake it for an oversight. A spoken engine-failure
      // notice needs a second, independent sound path (an earcon from a bundled asset) and that is
      // a design, not a line of code.
      host.notify('Read Aloud', why)
      return
    }
    speech = new SpeechService({
      provider: resolved.provider,
      sink,
      log: host.log,
      maxQueued: 8,
      // Supplement only. The spoken sentence naming the count comes from SpeechService itself, so
      // it cannot be lost by a notification channel that is muted, denied, or simply not looked at.
      onDropped: (n) => {
        host.notify('Read Aloud', `Skipped ${n} older repl${n === 1 ? 'y' : 'ies'} to keep up`)
      }
    })
    host.log(`read-aloud: engine ready (${resolved.provider.displayName}, rung=${resolved.status.rung})`)
    // Anything that happened while the engine was still resolving now has a voice to be said in.
    for (const m of deferredAnnouncements.splice(0)) speech.announce(m, 'next')
    // R015: degrade loudly. Never let a worse engine pass unmentioned.
    if (resolved.status.reason !== undefined) announce(resolved.status.reason)
  }).catch((err: unknown) => {
    engineError = String(err)
    host.log(`read-aloud: engine resolution failed: ${engineError}`)
    host.notify('Read Aloud', `speech engine failed to start: ${engineError}`)
  })

  /** Principle I: never fail silently. Every path either speaks or says why it did not. */
  const withSpeech = async (fn: (s: SpeechService) => Promise<void> | void): Promise<void> => {
    if (speech === null) {
      host.notify('Read Aloud', engineError ?? 'still starting up, try again in a moment')
      return
    }
    await fn(speech)
  }

  host.registerCommand('read-aloud.speak-clipboard', async () => {
    await withSpeech(async (s) => {
      if (s.isSpeaking) { await s.stop(); return }   // second press stops (single-flight)
      try {
        const { text, truncated } = await readClipboard()
        if (text.trim().length === 0) {
          host.notify('Read Aloud', 'the clipboard is empty')
          return
        }
        if (truncated) host.notify('Read Aloud', 'clipboard was long; reading the first part')
        s.speak(text)
      } catch (err) {
        host.notify('Read Aloud', err instanceof ClipboardUnavailableError
          ? err.message
          : 'could not read the clipboard')
      }
    })
  })

  host.registerCommand('read-aloud.stop', async () => {
    await withSpeech(async (s) => { await s.stop() })
  })

  const huddle = new HuddleController({
    speech: {
      // 'queue' is the whole point for huddle: replies must not cut each other off.
      speak: (t: string, mode?: 'replace' | 'queue', label?: string) => {
        speech?.speak(t, mode ?? 'queue', label)
      },
      stop: async () => { await speech?.stop() }
    },
    log: host.log,
    // The two-agents ambiguity notice and the session-switch notice both come through here. Both
    // are about WHOSE WORDS the listener is hearing — provenance, the thing 006 ranks S1 — so both
    // belong in the audio stream, not the notification tray.
    notify: (m: string) => { announce(m) },
    store: { get: host.storageGet, set: host.storageSet }
  })

  // Survive the idle worker reap: without this, huddle mode silently turns itself off.
  void huddle.restore().then((on) => {
    host.log(`read-aloud: huddle mode restored to ${on ? 'on' : 'off'}`)
  })

  host.registerCommand('read-aloud.toggle-huddle', () => {
    const on = huddle.toggle()
    host.notify('Read Aloud', `Huddle mode ${on ? 'ON' : 'OFF'}`)
    // Say it out loud. This is a text-to-speech plugin talking to a voice-first user: speech is
    // the one status channel that always works. The panel cannot be updated (no host->panel
    // channel, orca#15638) and a desktop notification is transient and easy to miss.
    if (speech !== null) speech.speak(on ? 'Huddle mode on.' : 'Huddle mode off.', 'replace')
  })

  host.registerCommand('read-aloud.status', async () => {
    await withSpeech((s) => {
      const parts: string[] = []
      parts.push(huddle.enabled ? 'Huddle mode is on.' : 'Huddle mode is off.')
      const following = huddle.following
      if (following !== null) parts.push(`Following ${sessionLabel(following)}.`)
      const now = s.nowReading
      if (now !== null) parts.push(`Now reading ${now}.`)
      if (s.queued > 0) parts.push(`${s.queued} more waiting.`)
      else if (now === null) parts.push('Nothing is being read.')
      s.speak(parts.join(' '), 'replace')
    })
  })

  // Abandon this reply, move to the next. The single most important control when the wrong thing
  // is being read at you.
  host.registerCommand('read-aloud.skip', async () => {
    await withSpeech(async (s) => { await s.skip() })
  })

  // Stop following the current session. Huddle stays on but goes quiet until a session is picked.
  host.registerCommand('read-aloud.unfollow', () => {
    huddle.unlock()
    host.notify('Read Aloud', 'No longer following any session')
    speech?.speak('Stopped following that session.', 'replace')
  })

  host.registerCommand('read-aloud.speak-last-reply', async () => {
    await withSpeech(async (s) => {
      const text = await huddle.lastReply()
      if (text === null) { host.notify('Read Aloud', 'no agent reply to read yet'); return }
      s.speak(text)
    })
  })

  host.onEvent('agent.status.changed', (payload) => {
    const status = asAgentStatus(payload)
    if (status === null) return
    huddle.onAgentStatus(status, worktreePathFrom(status.worktreeId))
  })

  // Verify by effect: if the host API shape changed under us, every registration silently no-ops
  // and the only symptom is "Could not run the plugin command" (PITFALLS P18). Say so loudly.
  const n = host.registeredCommands()
  if (n < 4) host.log(`read-aloud: WARNING only ${n}/4 commands registered — host API mismatch?`)
  host.log(`read-aloud: ready (${n} commands)`)
}
