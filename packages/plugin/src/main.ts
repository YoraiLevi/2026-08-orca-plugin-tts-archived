/**
 * ORCA plugin entry point.
 *
 * `activate(orca)` receives the host API object directly — verified against
 * examples/plugins/hello-orca/main.mjs, not guessed.
 *
 * Bundled by esbuild into the self-contained artifact at dist/plugin/, because ORCA never runs a
 * build at install time and rejects any file escaping the plugin root (PITFALLS P17).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { OsSynthProvider, ProviderRegistry } from '@orca-tts/providers'
import type { PlaybackSink, TtsProvider } from '@orca-tts/core'
import { asAgentStatus, makeHost, worktreePathFrom, type OrcaApi } from './adapter/index.ts'
import { readClipboard, ClipboardUnavailableError } from './clipboard.ts'
import { SpeechService } from './speech-service.ts'
import { SubprocessSink } from './sinks/subprocess-sink.ts'
import { HuddleController, sessionLabel } from './huddle/index.ts'
import { SettingsRuntime, loadSettings, nativeInboxPath } from './settings/index.ts'

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
  /**
   * Where the settings inbox lives, overriding the platform default.
   *
   * A test that omitted this would read the AUTHOR'S OWN tuned settings file out of their real
   * config directory — so every assertion about spoken text would depend on how they last tuned
   * the plugin by ear, and would change under them without a commit. That is P40's shape (a
   * reading that moves for reasons unrelated to the code) pointed at the one file this milestone
   * exists to read. Tests pass a temp directory; ORCA passes nothing.
   */
  readonly settingsDir?: string
}

/** How many commands `orca-plugin.json` declares. Pinned by main.test.ts, not by memory. */
const EXPECTED_COMMANDS = 9

export default function activate(orca: OrcaApi, options: ActivateOptions = {}): void {
  /**
   * Forward declaration: `makeHost` needs the hooks, and the hooks need `announce`, which needs
   * `speech`, which is created after the host exists. Declared here rather than restructured so
   * the ordering is visible instead of implied.
   */
  let announce: (message: string, urgency?: 'now' | 'next') => void = () => {}

  /**
   * The listener's tuning. Constructed BEFORE the host, at schema defaults, so that every consumer
   * below has something to read from the first millisecond — a settings load that has not finished
   * must never be a reason for the plugin to be silent or to hold a command.
   */
  const settingsPath = options.settingsDir === undefined
    ? nativeInboxPath(process.env, process.platform)
    : `${options.settingsDir}/settings.jsonc`
  const settings = new SettingsRuntime(settingsPath)

  const host = makeHost(orca, {
    // 006 section 19 rank 2: `{ delivered }` was computed by ORCA and discarded here, so a muted
    // tray, focus assist or a revoked permission silenced every announcement in this plugin while
    // it reported success. Anything that was NOT already spoken now falls back to speech.
    onUndelivered: (m) => { announce(m) },
    // Site 19/20: `undefined` was indistinguishable from "the key is not set". Storage failing is
    // why huddle comes back off after a reap, and why a re-forked worker replays a backlog.
    onStorageFailure: (f) => {
      host.log(`read-aloud: storage.${f.op}(${f.key}) failed: ${f.reason}`)
      if (f.op === 'get') {
        announce('Huddle could not read its saved settings, so it started from defaults.')
      }
    },
    // Site 22, and section 19 rank 4 — "whether a control fired". A dead chord and a handler that
    // threw are the same absence of sound. 'now', because the listener pressed a key THIS second
    // and is waiting to find out whether anything happened.
    onCommandFailed: (id, reason) => {
      announce(`That control did not work: ${id.replace('read-aloud.', '')}. ${reason}`, 'now')
    },
    // Logged, answerable by `status`, and deliberately not spoken — see the hook's own comment.
    onSettingsFailure: (f) => {
      host.log(`read-aloud: settings mirror ${f.op} failed: ${f.reason}`)
    }
  })
  host.log('read-aloud: activating')

  const registry = new ProviderRegistry()

  /**
   * 006 site 35/36 and section 19 rank 1. `#play` resolved `true` on `close` regardless of exit
   * code, so a failing player ended the ladder AND "the plugin is broken" was indistinguishable
   * from "the plugin is idle". The sink now says which; this routes that into the audio stream,
   * because a log is not a channel this listener has.
   *
   * Urgency 'next', never 'now': playback failing is something that has ALREADY happened, and if
   * the failure is total the announcement is unheard either way — so there is no case where
   * interrupting the listener's current sentence buys anything.
   */
  const sink = options.sink ?? new SubprocessSink({
    log: host.log,
    onFailure: (f) => {
      if (f.kind === 'no-player') {
        announce(`${f.reason}. Speech is being produced but nothing can play it.`)
      } else if (f.kind === 'unverified-format') {
        // SC-9 / R9-06. Not "playback failed" -- the player may well have played it. What the
        // listener is being told is that the system has no evidence either way, which is a
        // different sentence and must not be dressed up as the confident one.
        announce(`That may not have been played: ${f.reason}.`)
      } else {
        announce(`Audio playback failed: ${f.reason}.`)
      }
    }
  })
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
   * Site 24's residue. If the engine NEVER resolves, this buffer is the only thing holding every
   * announcement the plugin makes, and it grows for the life of the process — each entry pinning
   * a string that will never be spoken. Bounded, and the drop is itself reported when the voice
   * finally arrives, because a silently truncated report of silences is this document's own joke.
   */
  const MAX_DEFERRED = 20
  let deferredDropped = 0

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
  announce = (message: string, urgency: 'now' | 'next' = 'next'): void => {
    host.log(`read-aloud: ${message}`)
    // `alreadySpoken`: this message is going into the audio stream on the next line, so an
    // undelivered notification must NOT speak it a second time.
    host.notify('Read Aloud', message, { alreadySpoken: true })
    if (speech !== null) speech.announce(message, urgency)
    else if (deferredAnnouncements.length < MAX_DEFERRED) deferredAnnouncements.push(message)
    else deferredDropped++
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
      // 011 section 2.3: a GETTER, not values. The service is constructed once and lives for the
      // session; the listener's file can change at any point inside it.
      settings: () => settings.snapshot,
      resolveVoice: (i) => settings.voiceName(i),
      ...(options.announceDelayMs === undefined ? {} : { announceDelayMs: options.announceDelayMs }),
      // Supplement only. The spoken sentence naming the count comes from SpeechService itself, so
      // it cannot be lost by a notification channel that is muted, denied, or simply not looked at.
      /**
       * 006 section 19 rank 3 — "whose words are being spoken". Answered by asking the
       * filesystem, not by re-reading the string we built: a session whose transcript is gone
       * has ended, and C1's dead-agent-in-a-live-voice depends on nobody ever checking.
       */
      resolveLabel: (id) => (existsSync(id) ? sessionLabel(id) : null),
      onDropped: (n) => {
        host.notify('Read Aloud', `Skipped ${n} older repl${n === 1 ? 'y' : 'ies'} to keep up`)
      }
    })
    host.log(`read-aloud: engine ready (${resolved.provider.displayName}, rung=${resolved.status.rung})`)
    // The host's voice list, asked for ONCE. `synthesize.voiceIndex` is an index into this list
    // (P28: voice names have zero overlap across the three platforms), and with no list the index
    // resolves to nothing and the voice is OMITTED rather than guessed.
    void Promise.resolve(resolved.provider.listVoices())
      .then((voices) => { settings.setVoices(voices) })
      .catch((err: unknown) => { host.log(`read-aloud: could not list voices: ${String(err)}`) })
    // Anything that happened while the engine was still resolving now has a voice to be said in.
    for (const m of deferredAnnouncements.splice(0)) speech.announce(m, 'next')
    if (deferredDropped > 0) {
      speech.announce(
        `${deferredDropped} earlier message${deferredDropped === 1 ? '' : 's'} could not be kept ` +
        'while the voice was starting up.', 'next'
      )
      deferredDropped = 0
    }
    // R015: degrade loudly. Never let a worse engine pass unmentioned.
    if (resolved.status.reason !== undefined) announce(resolved.status.reason)
  }).catch((err: unknown) => {
    engineError = String(err)
    host.log(`read-aloud: engine resolution failed: ${engineError}`)
    host.notify('Read Aloud', `speech engine failed to start: ${engineError}`)
  })

  /**
   * 011 section 4.3a predicate 2: "a speak request has landed this session". The listener has
   * DEMONSTRATED the audio channel, so a held settings report may now be spoken into it.
   */
  let speakRequestThisSession = false

  /**
   * Speak the held settings report at the head of the first utterance the listener asks for.
   *
   * A held report that expired silently would be P30 wearing the uniform of politeness: the whole
   * reason it was held rather than spoken is that nobody had asked for audio yet, and the moment
   * they do, the answer is owed. `announce` inserts ahead of queued replies, so calling this
   * before the speak means the listener hears "Before that — ..." and then what they asked for.
   */
  const flushHeldReport = (s: SpeechService): boolean => {
    const held = settings.takeHeld()
    if (held === null) return false
    s.announce(`Before that. ${held}`, 'next')
    return true
  }

  /**
   * The mode a speak request uses once a held report has been put in front of it.
   *
   * `'replace'` barges in — and barge-in bumps the playback generation, which supersedes the
   * ANNOUNCEMENT that was already being spoken. Measured here while writing the G1 tests: the
   * listener heard `"Before that. "` and then the reply, with the entire settings sentence cut
   * mid-utterance. `#pending` protects announcements from being trimmed; nothing protected them
   * from the generation bump.
   *
   * `'queue'` is correct precisely when a report was flushed: `'replace'` exists so a SECOND press
   * cancels the first, and the flush only ever happens on the FIRST press of a session, when there
   * is nothing to replace.
   */
  const modeAfter = (flushed: boolean): 'replace' | 'queue' => (flushed ? 'queue' : 'replace')

  /** Principle I: never fail silently. Every path either speaks or says why it did not. */
  const withSpeech = async (fn: (s: SpeechService) => Promise<void> | void): Promise<void> => {
    if (speech === null) {
      host.notify('Read Aloud', engineError ?? 'still starting up, try again in a moment')
      return
    }
    await fn(speech)
  }

  host.registerCommand('read-aloud.speak-clipboard', async () => {
    speakRequestThisSession = true
    await withSpeech(async (s) => {
      if (s.isSpeaking) { await s.stop(); return }   // second press stops (single-flight)
      try {
        const { text, truncated } = await readClipboard()
        if (text.trim().length === 0) {
          // The listener pressed a key and got silence, which is precisely what a DEAD keybinding
          // gives them (006 section 19 rank 4). A tray notification does not distinguish the two;
          // a spoken sentence does. 'now', because they are waiting for an answer this second.
          announce('The clipboard is empty.', 'now')
          return
        }
        s.speak(text, modeAfter(flushHeldReport(s)))
        // Queued BEHIND the clipboard content, deliberately: said first it would delay the thing
        // the listener actually asked for, and said as an interruption it would cut into it. As a
        // trailing note it costs nothing and still answers "was that all of it?".
        if (truncated) announce('That clipboard was long, so you heard the first part of it.', 'next')
      } catch (err) {
        // Site 38: every non-ClipboardUnavailableError collapsed into one sentence, so a timeout,
        // a permission prompt and a crashed helper were the same unactionable message. Site 37 is
        // the layer under it: each helper's own reason now survives to here.
        announce(err instanceof ClipboardUnavailableError
          ? err.message
          : `Could not read the clipboard: ${String(err)}`, 'now')
      }
    })
  })

  /**
   * "Is this thing actually working?" — the one question the system could not answer.
   *
   * Every diagnostic a listener can reach reports healthy on a mute plugin: `prepare()` said warm,
   * the registry said `preferred`, the log said "engine ready", `isPlaying` said false because
   * nothing was playing. 006 section 19 ranks that number one of the things we cannot detect at
   * all. This synthesizes a phrase FRESH and reports the byte counts that came back — a named
   * value that moved, not a state that was asserted.
   */
  host.registerCommand('read-aloud.self-test', async () => {
    await withSpeech(async (s) => {
      const r = await s.selfTest()
      // Supplement, and the only channel left if the answer is "nothing reached the device".
      host.notify('Read Aloud', r.spoken)
      host.log(`read-aloud: self-test chunks=${r.chunks} bytes=${r.bytes} played=${String(r.bytesPlayed)}`)
    })
  })

  host.registerCommand('read-aloud.stop', async () => {
    await withSpeech(async (s) => { await s.stop() })
  })

  const huddle = new HuddleController({
    speech: {
      // 'queue' is the whole point for huddle: replies must not cut each other off.
      speak: (t: string, mode?: 'replace' | 'queue', label?: string, sessionId?: string) => {
        speech?.speak(t, mode ?? 'queue', label, sessionId)
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
  //
  // C4, the FMA's highest-value cascade: ORCA reaps an idle worker at five minutes, and `#locked`
  // was worker memory. On re-fork the next agent event re-picked "the most recently modified
  // transcript" — after five idle minutes, very likely a DIFFERENT session. The lock is now
  // persisted, and the session is RE-ANNOUNCED on activation, because the listener has no way of
  // knowing a worker restarted and provenance is the one thing they cannot obtain any other way.
  const huddleRestored = huddle.restore()

  /**
   * THE READ PATH. Ordered exactly as 011 section 1.2a specifies: the mirror is read FIRST, then
   * the inbox, then per-field precedence inside `parse()`.
   *
   * It is deliberately NOT awaited by `activate()`. A settings load that has not finished must
   * never be a reason for a command to be unregistered or for the plugin to be silent — every
   * consumer already has schema defaults to read, and the load replaces them when it lands.
   */
  void (async () => {
    // Huddle-on is 011 section 4.3a's first evidence predicate, and it is a fact the worker
    // already has. A rejected restore is read as OFF, which is the conservative direction: it
    // holds the report rather than speaking into a room that never asked for audio.
    const huddleOn = await huddleRestored.catch(() => false)
    const outcome = await loadSettings(
      {
        readInbox: (path) => readFile(path, 'utf8'),
        mirrorGet: () => host.settingsGet(),
        log: host.log
      },
      settingsPath,
      { huddleOn, speakRequestThisSession }
    )
    settings.adopt(outcome)
    settings.setReport(outcome.sentence)
    host.log(
      `read-aloud: settings loaded from ${outcome.source} (revision ${outcome.snapshot.revision}, ` +
      `${outcome.result.rejected.length} rejected, ${outcome.result.unknownFields.length} unknown) ` +
      `at ${outcome.path}`
    )

    // ONLY a clean read of the inbox is mirrored. Mirroring a defaults-derived snapshot would
    // overwrite last-known-good with defaults on the exact run where last-known-good was needed —
    // the failure the mirror exists to prevent, committed by the code that implements it.
    if (outcome.mirrorable) void host.settingsSet(settings.mirrorRecord())

    if (outcome.sentence === null) return   // a clean load says nothing. Silence IS the report.
    switch (outcome.destination) {
      case 'speak-now':
        // 'next', never 'now': nothing here is worth cutting into a sentence the listener is
        // already following, and at activate() there is usually nothing playing anyway.
        announce(outcome.sentence, 'next')
        break
      case 'hold-for-first-utterance':
        settings.hold()
        host.notify('Read Aloud', outcome.sentence)
        break
      case 'on-request-only':
        host.notify('Read Aloud', outcome.sentence)
        break
    }
  })()

  void huddleRestored.then((on) => {
    host.log(`read-aloud: huddle mode restored to ${on ? 'on' : 'off'}`)
    const again = huddle.restoredAnnouncement()
    // 'next', not 'now': nothing is being read yet at activation, and if something is, it is more
    // important than a status line about the thing that is reading it.
    if (again !== null) announce(again, 'next')
  }).catch((err: unknown) => {
    // Site 25: this chain had no `.catch` at all, so a storage rejection turned huddle off and
    // said nothing. TT14 — the listener's mode silently reverting is exactly the class of failure
    // they cannot debug.
    announce(`Huddle mode could not be restored: ${String(err)}. Press the huddle key to turn it on.`)
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
      // 011 section 6 / R7-32. The listener cannot see a settings pane, so `status` is the only
      // route to "did my edit land, and where does the file live". It also carries the settings
      // report unconditionally, which is what makes `on-request-only` a channel rather than a
      // silence: the report is never dropped in ANY configuration.
      parts.push(settings.statusClause(Date.now()))
      // Destination 2 of 011 section 4.3, and the reason `on-request-only` is a CHANNEL rather
      // than a silence: the report answers here whatever the channel setting says, and it answers
      // again in an hour, because it is not consumed by whoever reads it first.
      const report = settings.report
      if (report !== null) parts.push(report)
      settings.takeHeld()   // discharged: they have now heard it
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
    speakRequestThisSession = true
    await withSpeech(async (s) => {
      const text = await huddle.lastReply()
      // Same argument as the clipboard hotkey: a control that was pressed must answer in the
      // audio stream, or it is indistinguishable from a control that is not wired up.
      if (text === null) { announce('There is no agent reply to read yet.', 'now'); return }
      s.speak(text, modeAfter(flushHeldReport(s)))
    })
  })

  /**
   * Site 23: a payload that failed narrowing was dropped with no count and no warning. If ORCA
   * changes the shape of `agent.status.changed`, huddle simply stops working — and the symptom is
   * silence, which is indistinguishable from "the agent has not answered yet".
   *
   * Announced ONCE, and only after a few have gone by, because one malformed event during startup
   * is noise and a steady stream of them is the schema having moved under us.
   */
  let malformedEvents = 0
  let announcedMalformed = false
  host.onEvent('agent.status.changed', (payload) => {
    const status = asAgentStatus(payload)
    if (status === null) {
      malformedEvents++
      if (malformedEvents >= 3 && !announcedMalformed) {
        announcedMalformed = true
        announce('Huddle is not recognising this version of Orca\u2019s agent events, so replies may not be spoken.')
      }
      return
    }
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
