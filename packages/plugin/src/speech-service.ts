/**
 * The speech pipeline: text in, audio out, cancellable.
 *
 * Two request modes, because the two callers want opposite things:
 *  - 'replace' (hotkey): a second press interrupts the first. You asked for THIS text now.
 *  - 'queue'   (huddle): replies are spoken in order and never cut each other off. An agent
 *    finishing turn 3 while turn 2 is still being read must not truncate turn 2.
 *
 * Shipping only 'replace' meant huddle silently dropped replies mid-sentence (reported live).
 */
import { Chunker, PlaybackQueue, normalize, type NormalizeOptions, type PlaybackSink } from '@orca-tts/core'
import { toChunkerOptions, toNormalizeOptions, toSynthesizeOptions } from '@orca-tts/core'
import type { ChunkerOptions, SettingsSnapshot, SynthesizeOptions, TtsProvider } from '@orca-tts/core'

export type SpeakMode = 'replace' | 'queue'

/**
 * How urgently an announcement reaches the listener.
 *
 * An announcement that interrupts is itself a harm — the listener loses the sentence they were
 * following — so this is deliberately a choice, not a default.
 *
 *  - 'next' — spoken as soon as the current utterance ends, ahead of everything queued behind it.
 *    Nothing is lost. This is the right answer for every *loss* and *degradation* notice, because
 *    those describe something that has already happened; a second of delay costs nothing.
 *  - 'now'  — abandons the current utterance and speaks immediately, preserving the queue. Only
 *    for something the listener just asked for (status) or something that invalidates what they
 *    are hearing right now (a session switch).
 *
 * There is deliberately no 'interrupt and clear' urgency. Announcements never destroy the queue:
 * that is the fault this class of message exists to report.
 */
export type AnnounceUrgency = 'now' | 'next'

export interface SpeechServiceDeps {
  readonly provider: TtsProvider
  readonly sink: PlaybackSink
  readonly log?: (m: string) => void
  readonly maxUnits?: number
  /**
   * Isolate the first sentence so audio starts sooner (R4.2, first audio < ~500 ms).
   * The chunker has defaulted this to `true` since it was written; before this was forwarded,
   * no caller could turn it off. Default stays `true` — omit to keep today's behaviour.
   */
  readonly isolateFirstSentence?: boolean
  /**
   * Engine voice. Provider-specific and NOT portable across platforms: macOS `Samantha`,
   * Windows `Microsoft Zira Desktop` and espeak-ng `en-US+f3` share no namespace and no member.
   * Undefined means "the provider's own default", which is what shipped before.
   */
  readonly voice?: string
  /** 1.0 is the provider's natural rate. Undefined leaves the engine alone. */
  readonly rate?: number
  readonly normalizeOptions?: NormalizeOptions
  /** Cap on queued utterances; beyond this the OLDEST are dropped (never the newest). */
  readonly maxQueued?: number
  /**
   * Supplementary hook for queue overflow — a desktop notification, a log line. The PRIMARY report
   * is spoken by this class itself; this exists so a second channel can also carry it.
   *
   * It used to be the only report, and it terminated in `notifications.show`, whose delivery
   * receipt is discarded. For a listener who does not look at the notification tray that is the
   * same as no report at all (006 section 16: of 55 silent-failure sites, the number reaching the
   * audio stream was zero).
   */
  readonly onDropped?: (count: number) => void
  /**
   * How long overflow announcements are coalesced before being spoken. A burst must produce ONE
   * sentence naming the total, not a burst of sentences — announcing each drop separately would
   * itself flood the only channel the listener has. Default 500 ms; tests lower it.
   */
  readonly announceDelayMs?: number
  /**
   * Re-resolve the label for a session id, at the instant its words are about to be spoken.
   * `null` means "that session no longer exists".
   *
   * 006 section 19 RANK THREE — *whose words are being spoken*. The queue entry was `{ text,
   * label }`: a formatted display string built at enqueue time, with nothing left to re-verify
   * against. Cascade C1 is the consequence — a session ends while its reply is queued, 005's
   * authority rule reassigns voices, and the listener hears a dead agent's words in a live
   * agent's voice, immediately after being told voices were reassigned. The misattribution
   * arrives wearing an explanation.
   *
   * This is an EFFECT check by construction: the host answers it by asking the filesystem whether
   * the transcript is still there, not by consulting the string it built a minute ago.
   */
  readonly resolveLabel?: (sessionId: string) => string | null
  /**
   * The listener's tuning, as a GETTER — never as values (011 section 2.3).
   *
   * `SpeechServiceDeps` is `readonly` and captured in the constructor, so passing values would
   * mean the only way to apply a settings change is to rebuild the service: dropping the queue
   * and re-paying provider warm-up. A getter costs nothing and makes an edit reach the next
   * utterance.
   *
   * When present it SUPERSEDES `normalizeOptions`, `maxUnits`, `isolateFirstSentence`, `voice` and
   * `rate` — because a settings-derived value competing with a constructor literal is exactly the
   * two-defaults bug 011 section 5 exists to delete.
   */
  readonly settings?: () => SettingsSnapshot
  /**
   * The host's runtime voice list, index to name. `synthesize.voiceIndex` persists an INDEX
   * because voice NAMES have zero overlap across the three platforms (P28), and resolving one
   * needs a list only the host has. With no resolver, or an index the list does not reach, the
   * voice is OMITTED rather than guessed.
   */
  readonly resolveVoice?: (index: number) => string | undefined
}

const DEFAULT_MAX_QUEUED = 20
const DEFAULT_ANNOUNCE_DELAY_MS = 500

interface PendingUtterance {
  text: string
  label?: string
  /**
   * The stable identity behind `label` — the transcript path, not the display string. Carried so
   * provenance can be RE-RESOLVED at speak time rather than trusted from enqueue time (C1).
   */
  sessionId?: string
  /** Announcements are exempt from overflow trimming: the report must outlive what it reports. */
  announcement?: true
  /**
   * The settings snapshot current AT ENQUEUE TIME (011 section 2.2).
   *
   * Carried per item rather than read at speak time so that a settings promotion is never a
   * playback-queue operation: Stop and a settings write cannot race, because a settings write
   * touches neither the generation nor `#pending`. `apply.toQueued` defaults false, and this
   * field is what makes that the cheap answer rather than the expensive one.
   */
  snapshot?: SettingsSnapshot
}

/**
 * Why an utterance did not reach the listener whole. 006 site 32: cancelled, skipped and superseded
 * were three different things arriving at the same silent `return` mid-chunk-list, so "the engine
 * died halfway through your reply" and "you pressed skip" were indistinguishable — and only the
 * first of those is a loss worth telling anyone about.
 */
type SpeakOutcome = 'spoken' | 'empty' | 'cancelled' | 'skipped' | 'superseded' | 'synthesis-failed'

/**
 * Losses that are worth a sentence, and the sentence each one gets.
 *
 * Coalesced on the same timer as queue overflow, for the same reason: a burst of losses must
 * produce ONE report naming the total, not a burst of reports. Announcing each separately would
 * flood the only channel the listener has, which is the harm this class of message exists to
 * prevent, not to cause.
 */
type LossKind = 'unspeakable' | 'synthesis-failed' | 'cut-mid-word'

const LOSS_SENTENCE: Record<LossKind, (n: number) => string> = {
  // 006 site 31, "the most reachable total-silence path in the product": a reply that is only code,
  // only a diagram, only emoji, only a check mark normalizes to nothing and produced a log line.
  // For a listener, that is indistinguishable from the agent not having answered.
  unspeakable: (n) => n === 1
    ? 'One reply had nothing in it that could be read aloud.'
    : `${n} replies had nothing in them that could be read aloud.`,
  // 006 site 33: the listener hears sentence one, the rest of the reply is gone, and the NEXT
  // queued reply starts — so the loss is disguised as the conversation moving on.
  'synthesis-failed': (n) => n === 1
    ? 'A reply was cut short: the voice engine failed part way through it.'
    : `${n} replies were cut short: the voice engine failed part way through them.`,
  // 006 site 53: the chunker computes `boundary: 'scalar'` to mark a mid-word cut and the speech
  // service read only `.text`. Rare by construction — it needs 200 characters with no sentence,
  // clause or word boundary in them — which is exactly why it is worth naming when it happens.
  'cut-mid-word': (n) => n === 1
    ? 'One very long unbroken run of text was cut mid-word to be read.'
    : `${n} very long unbroken runs of text were cut mid-word to be read.`
}

/**
 * What a self-test observed, end to end. Every field is a value that MOVED, not a state that was
 * asserted: bytes the provider actually produced for a phrase synthesized fresh at that moment,
 * and whether the sink's player exited 0.
 *
 * 006 section 19 ranks "that the plugin is mute" as the number one thing this system cannot detect:
 * "audio reached the device" is asserted nowhere, so "the plugin is broken" and "the plugin is
 * idle" are the same observable state on all three platforms. This is that instrument. It
 * synthesizes a FRESH phrase deliberately — a stored WAV would pass while synthesis is dead, which
 * is the presence-not-effect trap the whole project is written against.
 */
export interface SelfTestResult {
  readonly chunks: number
  readonly bytes: number
  /** Null when the sink does not report a byte counter (a fake, or a provider that owns playback). */
  readonly bytesPlayed: number | null
  readonly error: string | null
  /** The sentence spoken to the listener. Reported so a caller can assert it without speaking. */
  readonly spoken: string
}

/** A sink that can report what it actually played. Structural, so any sink may opt in. */
interface ObservableSink { readonly bytesPlayed?: number }

export class SpeechService {
  readonly #deps: SpeechServiceDeps
  readonly #playback: PlaybackQueue
  #pending: PendingUtterance[] = []
  #draining = false
  #cancelled = false
  #skip = false
  #current: string | null = null
  #droppedPendingAnnounce = 0
  #dropTimer: ReturnType<typeof setTimeout> | null = null
  #losses = new Map<LossKind, number>()
  #lossTimer: ReturnType<typeof setTimeout> | null = null
  #reportingFailure = false
  /** Sessions whose provenance change has already been spoken. Bounded by `stop()`. */
  #reattributed = new Set<string>()

  constructor(deps: SpeechServiceDeps) {
    this.#deps = deps
    this.#playback = new PlaybackQueue({
      sink: deps.sink,
      cancelSynthesis: () => deps.provider.cancel()
    })
  }

  get isSpeaking(): boolean {
    return this.#draining || this.#pending.length > 0 || this.#deps.sink.isPlaying
  }

  get queued(): number { return this.#pending.length }

  /** What is being read right now, if the caller labelled it. */
  get nowReading(): string | null { return this.#current }

  /** Abandon the current utterance and move to the next queued one. */
  async skip(): Promise<void> {
    this.#skip = true
    await this.#playback.bargeIn()
  }

  /**
   * Say something ABOUT the speech system, in the speech system. The listener cannot read a log
   * and does not watch the notification tray, so this is the only channel a loss or a degradation
   * can honestly be reported through (buzz's rule, recorded in our own research and never adopted:
   * every omission is announced in the audio stream itself).
   *
   * Never clears the queue. See AnnounceUrgency for what each urgency costs.
   */
  announce(text: string, urgency: AnnounceUrgency = 'next'): void {
    if (text.trim().length === 0) return
    if (urgency === 'now') {
      // Abandon the current utterance only. #pending survives, deliberately: an announcement that
      // deleted the queue would be the C5 fault ("asking what is happening destroys what is
      // happening") wearing the uniform of the fix for it.
      this.#skip = true
      this.#observe(this.#playback.bargeIn(), 'stop the current sentence')
    }
    const entry: PendingUtterance = { text, announcement: true }
    const snap = this.#deps.settings?.()
    if (snap !== undefined) entry.snapshot = snap
    // Ahead of queued replies, behind any announcement already waiting, so a run of announcements
    // is heard in the order it was generated.
    let at = 0
    while (this.#pending[at]?.announcement === true) at++
    this.#pending.splice(at, 0, entry)
    this.#cancelled = false
    this.#observe(this.#drain(), 'read that text')
  }

  /**
   * Synthesize a fresh phrase end to end and report what actually happened, aloud.
   *
   * The listener-facing half of 006 section 19 rank 1. Every other diagnostic in this system
   * ("engine ready", "N commands registered", `isPlaying`) reports healthy on a mute plugin; this
   * one cannot, because it reports numbers that came from this invocation.
   *
   * Deliberately `'now'`: the listener asked for it this second, and a self-test that queued behind
   * a backlog would answer a question they had already given up on.
   */
  async selfTest(phrase = 'Read aloud self test. One two three.'): Promise<SelfTestResult> {
    const before = (this.#deps.sink as ObservableSink).bytesPlayed
    let chunks = 0
    let bytes = 0
    let error: string | null = null
    try {
      const snapshot = this.#deps.settings?.()
      const spokenText = normalize(phrase, this.#normalizeOptions(snapshot))
      const chunker = new Chunker(this.#chunkerOptions(snapshot))
      for (const chunk of [...chunker.addText(spokenText), ...chunker.finish()]) {
        for await (const audio of this.#deps.provider.generate(chunk.text, this.#synthesizeOptions(snapshot))) {
          chunks++
          bytes += audio.data.length
          await this.#deps.sink.enqueue(audio)
        }
      }
    } catch (err) {
      error = String(err)
    }
    const after = (this.#deps.sink as ObservableSink).bytesPlayed
    const bytesPlayed = typeof before === 'number' && typeof after === 'number' ? after - before : null
    const spoken = error !== null
      ? `Self test failed. The voice engine reported: ${error}.`
      : bytes === 0
        ? 'Self test failed. The voice engine produced no audio at all.'
        : bytesPlayed === 0
          ? `Self test: the engine produced ${bytes} bytes, but nothing reached the audio device.`
          : `Self test passed. ${chunks} chunk${chunks === 1 ? '' : 's'}, ${bytes} bytes of fresh audio.`
    this.announce(spoken, 'now')
    return { chunks, bytes, bytesPlayed, error, spoken }
  }

  /** Speak `text`. See SpeakMode. Returns immediately; use `isSpeaking` to observe. */
  speak(text: string, mode: SpeakMode = 'replace', label?: string, sessionId?: string): void {
    if (mode === 'replace') {
      // 'replace' means "you asked for THIS text now" — but the things it silently deleted were
      // agent replies the listener was waiting for. Report the loss before speaking over it.
      const discarded = this.#pending.filter((p) => p.announcement !== true).length
      this.#pending = this.#pending.filter((p) => p.announcement === true)
      // Site 29: `void this.#playback.bargeIn()` — a sink that cannot stop rejected into nothing,
      // so the new text was spoken OVER the old one with no signal.
      this.#observe(this.#playback.bargeIn(), 'stop the current sentence')
      if (discarded > 0) this.#noteDropped(discarded)
    }
    const entry: PendingUtterance = { text }
    if (label !== undefined) entry.label = label
    if (sessionId !== undefined) entry.sessionId = sessionId
    // 011 section 2.2: the item carries the snapshot current at ENQUEUE time. `apply.toQueued`
    // defaults false, and this is what implements it.
    const snap = this.#deps.settings?.()
    if (snap !== undefined) entry.snapshot = snap
    this.#pending.push(entry)
    const max = this.#deps.maxQueued ?? DEFAULT_MAX_QUEUED
    const replies = this.#pending.filter((p) => p.announcement !== true)
    if (replies.length > max) {
      const dropped = replies.length - max
      // Keep the newest replies; never block the agent. Announcements are never trimmed.
      const keep = new Set(replies.slice(-max))
      this.#pending = this.#pending.filter((p) => p.announcement === true || keep.has(p))
      this.#deps.log?.(`speech queue full, dropped ${dropped} older utterance(s)`)
      this.#noteDropped(dropped)
    }
    this.#cancelled = false
    void this.#drain()
  }

  /**
   * Record a loss and speak it, coalesced, in the audio stream.
   *
   * Urgency is always `'next'`, deliberately. Every one of these describes something that has
   * ALREADY happened — a reply that could not be read, an engine that died mid-sentence, a run cut
   * mid-word. Interrupting the sentence the listener is currently following to tell them about a
   * sentence they already lost is a second loss, not a fix for the first (P30).
   */
  /**
   * Sites 29 and 30: two `void somePromise()` calls with no handler. `#drain` in particular can
   * reject from `normalize()` or the `Chunker` (NM11), and an unhandled rejection is, to this
   * listener, indistinguishable from the agent never having answered.
   *
   * Reported through `announce`, not through `log`: the log is not a channel they have. Guarded
   * against recursion — if announcing the failure fails too, it stops there rather than looping.
   */
  #observe(p: Promise<unknown>, what: string): void {
    void p.catch((err: unknown) => {
      this.#deps.log?.(`could not ${what}: ${String(err)}`)
      if (this.#reportingFailure) return
      this.#reportingFailure = true
      try { this.announce(`Speech failed: could not ${what}.`, 'next') }
      finally { this.#reportingFailure = false }
    })
  }

  #noteLoss(kind: LossKind, count = 1): void {
    this.#losses.set(kind, (this.#losses.get(kind) ?? 0) + count)
    if (this.#lossTimer !== null) return   // one flush per window; do NOT restart the timer
    this.#lossTimer = setTimeout(() => {
      this.#lossTimer = null
      const entries = [...this.#losses.entries()]
      this.#losses.clear()
      for (const [k, n] of entries) if (n > 0) this.announce(LOSS_SENTENCE[k](n), 'next')
    }, this.#deps.announceDelayMs ?? DEFAULT_ANNOUNCE_DELAY_MS)
    ;(this.#lossTimer as unknown as { unref?: () => void }).unref?.()
  }

  /**
   * Coalesce a burst of drops into one spoken sentence naming the TOTAL.
   *
   * The count accumulates. The previous implementation restarted a timer holding only the latest
   * `n`, so a burst that dropped 1 + 1 + 1 announced "skipped 1" — under-reporting the loss in the
   * one message whose entire job is to size it.
   */
  #noteDropped(count: number): void {
    this.#deps.onDropped?.(count)
    this.#droppedPendingAnnounce += count
    if (this.#dropTimer !== null) clearTimeout(this.#dropTimer)
    this.#dropTimer = setTimeout(() => {
      const n = this.#droppedPendingAnnounce
      this.#droppedPendingAnnounce = 0
      this.#dropTimer = null
      if (n > 0) this.announce(`Skipped ${n} older repl${n === 1 ? 'y' : 'ies'} to keep up.`, 'next')
    }, this.#deps.announceDelayMs ?? DEFAULT_ANNOUNCE_DELAY_MS)
    if (typeof this.#dropTimer === 'object' && this.#dropTimer !== null) {
      // Never hold the worker alive just to say "I skipped something".
      (this.#dropTimer as unknown as { unref?: () => void }).unref?.()
    }
  }

  /**
   * Two-sided stop: cancels synthesis, flushes audio, and clears anything waiting (R022).
   *
   * Deliberately does NOT announce what it discarded. Stop is the listener's own explicit command
   * for silence; a control that answers "stop" with more speech is the helplessness P22 recorded,
   * not a fix for it. Every OTHER path that clears the queue does announce.
   */
  async stop(): Promise<void> {
    this.#cancelled = true
    this.#pending = []
    if (this.#dropTimer !== null) { clearTimeout(this.#dropTimer); this.#dropTimer = null }
    if (this.#lossTimer !== null) { clearTimeout(this.#lossTimer); this.#lossTimer = null }
    this.#losses.clear()
    this.#reattributed.clear()
    this.#droppedPendingAnnounce = 0
    await this.#playback.bargeIn()
  }

  async #drain(): Promise<void> {
    if (this.#draining) return
    this.#draining = true
    try {
      for (;;) {
        const next = this.#pending.shift()
        if (next === undefined) break
        const attribution = next.announcement === true ? null : this.#reattribute(next)
        this.#current = attribution?.label ?? next.label ?? null
        this.#skip = false
        const outcome = await this.#speakOne(
          attribution === null ? next.text : attribution.prefix + next.text,
          next.snapshot
        )
        this.#current = null
        // An announcement that cannot be spoken must never announce that it cannot be spoken: that
        // is an unbounded loop in the one channel the listener has.
        if (next.announcement !== true) {
          if (outcome === 'empty') this.#noteLoss('unspeakable')
          else if (outcome === 'synthesis-failed') this.#noteLoss('synthesis-failed')
        }
        if (this.#cancelled) break
      }
    } finally {
      this.#draining = false
    }
  }

  /**
   * Ask, at the moment of speaking, whose words these actually are — and say so when the answer
   * has changed since they were queued.
   *
   * 006 section 19 rank 3 / cascade C1. The queue carried a display string with no way to check
   * it. Now it carries a session id, and this re-resolves it against the live system.
   *
   * **The judgement, stated, because it departs from the FMA's own prescription.** C1 says
   * *"refuse to speak an entry whose identity generation is stale."* Refusing deletes an agent
   * reply the listener was waiting for, to prevent a label being wrong — which today, with one
   * voice for every session, is the smaller of the two harms by a wide margin. So we CORRECT the
   * attribution instead: the reply is spoken, preceded by the session it really came from. The
   * refusal becomes the right answer the moment M15 makes the VOICE carry identity, and at that
   * point it is one conditional on this same, now-existing, field. The instrument is what was
   * missing; the policy is cheap once the instrument exists.
   *
   * Spoken ONCE per session per change, not once per reply: five queued replies from a session
   * that has ended get one provenance sentence, not five. Narrating provenance on every utterance
   * is the harm on the other side of this one.
   */
  #reattribute(entry: PendingUtterance): { label: string; prefix: string } | null {
    const id = entry.sessionId
    const was = entry.label
    if (id === undefined || was === undefined || this.#deps.resolveLabel === undefined) return null
    const now = this.#deps.resolveLabel(id)
    if (now === was) { this.#reattributed.delete(id); return null }
    if (this.#reattributed.has(id)) return { label: now ?? was, prefix: '' }
    this.#reattributed.add(id)
    this.#deps.log?.(`attribution changed for ${id}: queued as "${was}", now ${now ?? 'gone'}`)
    return now === null
      ? { label: was, prefix: `From ${was}, which has since ended. ` }
      : { label: now, prefix: `From ${now}. ` }
  }

  /**
   * Voice and rate are the two settings every user asks for first, and until this existed no
   * caller could reach them: `generate(chunk.text)` was called with no options at all, while
   * `SynthesizeOptions.voice`/`.rate` and the provider's implementations of both sat unused (H24).
   * Built fresh per utterance and omitting undefined fields, so "nothing passed" stays byte-for-
   * byte the request the provider received before.
   */
  #synthesizeOptions(snapshot?: SettingsSnapshot): SynthesizeOptions {
    if (snapshot !== undefined) {
      return toSynthesizeOptions(snapshot.values, this.#deps.resolveVoice)
    }
    const opts: { voice?: string; rate?: number } = {}
    if (this.#deps.voice !== undefined) opts.voice = this.#deps.voice
    if (this.#deps.rate !== undefined) opts.rate = this.#deps.rate
    return opts
  }

  /** Normalizer options for one utterance: the item's own snapshot, else the constructor's. */
  #normalizeOptions(snapshot?: SettingsSnapshot): NormalizeOptions {
    return snapshot === undefined
      ? this.#deps.normalizeOptions ?? {}
      : toNormalizeOptions(snapshot.values)
  }

  /** Chunker options for one utterance, same rule. */
  #chunkerOptions(snapshot?: SettingsSnapshot): ChunkerOptions {
    if (snapshot !== undefined) return toChunkerOptions(snapshot.values)
    const opts: { maxUnits?: number; isolateFirstSentence?: boolean } = {}
    if (this.#deps.maxUnits !== undefined) opts.maxUnits = this.#deps.maxUnits
    if (this.#deps.isolateFirstSentence !== undefined) {
      opts.isolateFirstSentence = this.#deps.isolateFirstSentence
    }
    return opts
  }

  /**
   * Returns WHY it stopped, rather than a bare `return`. Site 32: cancelled, skipped and superseded
   * all arrived at one indistinguishable early return, so the caller could not tell a loss the
   * listener should hear about from a control the listener just pressed.
   */
  async #speakOne(text: string, snapshot?: SettingsSnapshot): Promise<SpeakOutcome> {
    const spoken = normalize(text, this.#normalizeOptions(snapshot))
    if (spoken.length === 0) {
      this.#deps.log?.('nothing speakable in that text')
      return 'empty'
    }
    const chunker = new Chunker(this.#chunkerOptions(snapshot))
    const chunks = [...chunker.addText(spoken), ...chunker.finish()]

    // Site 53: `boundary: 'scalar'` marks a cut that landed mid-word because 200 characters went by
    // with no sentence, clause or word boundary in them. The chunker computed it correctly and
    // nothing read it. Counted once per utterance, not once per chunk: a base64 blob would
    // otherwise generate a dozen identical reports about one paste.
    if (chunks.some((c) => c.boundary === 'scalar')) this.#noteLoss('cut-mid-word')

    // 011 section 2.3, the one required source change the settings design forces: this used to be
    // called INSIDE the per-chunk loop. With a live snapshot behind it, a voice change would land
    // between chunk three and chunk four of one utterance — a sentence that changes speaker
    // mid-word. Read once, into a local, at the top.
    const synthOpts = this.#synthesizeOptions(snapshot)
    const generation = this.#playback.begin()
    for (const chunk of chunks) {
      if (this.#cancelled) return 'cancelled'
      if (this.#skip) return 'skipped'
      if (generation !== this.#playback.generation) return 'superseded'
      try {
        for await (const audio of this.#deps.provider.generate(chunk.text, synthOpts)) {
          if (!this.#playback.push(generation, audio)) return 'superseded'
        }
      } catch (err) {
        // R024: contain the failure. Speech stops; the host does not — but the LISTENER is told,
        // because the alternative is hearing sentence one and then the next reply starting, with
        // the middle of their answer silently missing (site 33).
        this.#deps.log?.(`synthesis failed: ${String(err)}`)
        return 'synthesis-failed'
      }
    }
    return 'spoken'
  }
}
