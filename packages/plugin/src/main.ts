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
import type { PlaybackSink, TtsProvider } from '@orca-tts/core'
import { asAgentStatus, makeHost, worktreePathFrom, type OrcaApi } from './adapter/index.js'
import { readClipboard, ClipboardUnavailableError } from './clipboard.js'
import { SpeechService } from './speech-service.js'
import { SubprocessSink } from './sinks/subprocess-sink.js'
import { HuddleController, sessionLabel } from './huddle/index.js'

/**
 * Test seam. ORCA calls `activate(orca)` and gets every real default; a test calls
 * `activate(fakeOrca, { provider, sink, projectsDir })` and can drive a command end to end without
 * spawning a synthesizer or reading the developer's own `~/.claude`.
 *
 * P26's rule, verbatim: for anything a user is meant to reach, test reachability from the
 * OUTERMOST object a caller constructs to the innermost consumer. Without this seam the outermost
 * object was untestable, which is exactly how `switchTo` shipped with no caller.
 */
export interface ActivateOptions {
  readonly provider?: TtsProvider
  readonly sink?: PlaybackSink
  readonly projectsDir?: string
  /** Overflow-announcement coalescing window; see SpeechServiceDeps.announceDelayMs. */
  readonly announceDelayMs?: number
}

/** How many commands `orca-plugin.json` declares. Pinned by main.test.ts, not by memory. */
const EXPECTED_COMMANDS = 8

export default function activate(orca: OrcaApi, options: ActivateOptions = {}): void {
  const host = makeHost(orca)
  host.log('read-aloud: activating')

  const registry = new ProviderRegistry()

  const sink = options.sink ?? new SubprocessSink({ log: host.log })
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
  registry.register(
    options.provider ?? new OsSynthProvider({ notify: (m) => { announce(m) } }),
    { preferred: true }
  )

  // Resolve the engine in the background: activate() must return promptly so command registration
  // is never delayed behind a process spawn.
  void registry.resolve().then((resolved) => {
    if (resolved === null) {
      // `lastFailureDetail` is the named form (006 sites 45/46): "nothing was registered" is a bug
      // in our own wiring, "unknown id" is a stale settings file, and "prepare failed" is a fact
      // about this machine — and all three used to arrive here as the same bare `null`, reported
      // as "no speech engine is available on this system". The listener could act on exactly none
      // of them, and neither could the next agent reading a bug report.
      const detail = registry.lastFailureDetail
      const why = detail === null
        ? registry.lastFailure ?? 'no speech engine is available on this system'
        : `no speech engine is available on this system (${detail.kind}) — ${detail.reason}`
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
      ...(options.announceDelayMs === undefined ? {} : { announceDelayMs: options.announceDelayMs }),
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
    store: { get: host.storageGet, set: host.storageSet },
    ...(options.projectsDir === undefined ? {} : { projectsDir: options.projectsDir })
  })

  // Survive the idle worker reap: without this, huddle mode silently turns itself off.
  void huddle.restore().then((on) => {
    host.log(`read-aloud: huddle mode restored to ${on ? 'on' : 'off'}`)
  })

  host.registerCommand('read-aloud.toggle-huddle', () => {
    const on = huddle.toggle()
    // 'now', not speak('replace'): the confirmation is heard immediately, and a clipboard read the
    // listener has queued behind it survives. Toggling OFF still stops speech — HuddleController
    // does that itself — because that is what OFF means.
    announce(`Huddle mode ${on ? 'on' : 'off'}.`, 'now')
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
      // C5: this command exists to answer "what is it even reading right now", and it was wired
      // to 'replace' — which cleared #pending with no onDropped call, so the answer deleted the
      // subject of the question, silently. It even says "N more waiting" while removing them.
      // 'now' interrupts the current utterance (the listener just asked, and asked now) and keeps
      // the queue the answer is describing.
      s.announce(parts.join(' '), 'now')
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
    // Announce, do not replace: replies already queued from that session are still replies the
    // listener was waiting for. Unfollow stops NEW ones arriving; Stop is the control for silence.
    announce('Stopped following that session.', 'now')
  })

  // Pick a session back up. `unfollow` shipped without a counterpart, so the only route back was to
  // wait for the next agent event to silently re-pick "whatever was touched last" — and
  // `switchTo`, which implements P22's "announce switches aloud", had no caller at all (006 TT6).
  host.registerCommand('read-aloud.follow', async () => {
    const file = await huddle.followNewest()
    if (file === null) {
      announce('No agent transcript to follow in this worktree yet.', 'now')
      return
    }
    if (!huddle.enabled) announce('Huddle mode is off, so replies will not be spoken yet.', 'next')
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
  // Guard drift: this used to read `n < 4` against a manifest declaring seven commands, so a
  // partial host-API mismatch registering 4-6 of them passed silently (006 site 28). The number is
  // pinned to the manifest by main.test.ts, which asserts every declared command id is registered.
  const n = host.registeredCommands()
  if (n < EXPECTED_COMMANDS) {
    host.log(`read-aloud: WARNING only ${n}/${EXPECTED_COMMANDS} commands registered — host API mismatch?`)
  }
  host.log(`read-aloud: ready (${n} commands)`)
}
