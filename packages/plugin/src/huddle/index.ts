/**
 * Huddle mode: speak agent replies as they land.
 *
 * TWO BUGS drove this design, both found by using it live:
 *
 * 1. `agent.status.changed` fires on the working->done edge, but the agent CLI flushes its final
 *    message to the transcript slightly afterwards. Speaking "the newest reply" at `done` therefore
 *    read the PREVIOUS turn. So we do not speak on the edge — we WATCH the transcript and speak
 *    replies when they actually appear on disk. The event is only a hint to start watching.
 *
 * 2. Spoken-reply ids lived in worker memory. ORCA reaps an idle worker after 5 minutes and
 *    re-forks it on the next trigger, so dedup reset and old replies were spoken again. Ids are now
 *    persisted, bounded, and restored on activate.
 *
 * Correlation remains a HEURISTIC (orca#15639): the event carries no session id, so we match on the
 * worktree path and take the most recently modified transcript. When two are touched within
 * seconds we say so out loud rather than confidently speaking the wrong agent.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentStatusChanged } from '../adapter/index.ts'
import {
  countCompactBoundaries, decoderFor, detectTranscriptFormat, unreadableTranscriptMessage,
  type DecodedReply, type TranscriptFormat
} from './decoders.ts'

/**
 * Why there is no transcript to follow. 006 site 5: six causes — an unreadable projects root, an
 * unreadable project directory, a file that vanished between `readdir` and `stat`, and "no .jsonl
 * anywhere" — collapsed into one silent `return`, so the listener pressed the hotkey, heard
 * "Huddle mode on", and then nothing, ever. The plugin was indistinguishable from a plugin that
 * was never installed (TT1).
 */
export type NoTranscriptReason =
  | 'no-root'          // ~/.claude/projects does not exist: no agent has ever run here
  | 'root-unreadable'  // it exists and we cannot read it: permissions, a non-default HOME
  | 'no-transcripts'   // the root is readable and holds no .jsonl at all

/** The sentence each reason gets. Named separately so a test asserts wording, not a boolean. */
export const NO_TRANSCRIPT_SENTENCE: Record<NoTranscriptReason, string> = {
  'no-root': 'Huddle found no agent transcripts on this machine yet, so there is nothing to read.',
  'root-unreadable':
    'Huddle cannot read the folder agent transcripts live in, so replies will not be spoken. ' +
    'This is usually a permissions problem.',
  'no-transcripts': 'Huddle found no agent transcript for this worktree yet, so there is nothing to read.'
}

/** Minimal port, so huddle can be tested without a synthesizer. */
export interface SpeechPort {
  /**
   * `sessionId` is the transcript path — the stable identity behind `label`, carried so the
   * speech service can re-resolve provenance at speak time instead of trusting a display string
   * built when the reply was queued (006 section 19 rank 3, cascade C1).
   */
  speak(text: string, mode?: 'replace' | 'queue', label?: string, sessionId?: string): void
  stop(): Promise<void>
}

export interface HuddleStore {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}

export const HUDDLE_STATE_KEY = 'huddle.enabled'
export const HUDDLE_SPOKEN_KEY = 'huddle.spokenIds'
export const HUDDLE_HIGH_WATER_KEY = 'huddle.highWater'
/**
 * The session we are following, persisted.
 *
 * 006 C4, the highest-value cascade in the document: ORCA reaps an idle worker at five minutes and
 * `#locked` was worker memory, so on re-fork the next `agent.status.changed` re-picked "the most
 * recently modified transcript" — which after five idle minutes is very likely a DIFFERENT session
 * than the one the listener was following. That is P22 fault 1, reconstituted by the mechanism
 * none of P22's fixes account for.
 */
export const HUDDLE_FOLLOWING_KEY = 'huddle.following'
/** Bounded so plugin storage (256 KB per value) can never be blown by a long session. */
export const MAX_REMEMBERED_IDS = 300
/**
 * Transcripts remembered by high-water mark. One small integer per file, so this bound is about
 * storage tidiness, not correctness — unlike MAX_REMEMBERED_IDS, which used to be load-bearing.
 */
export const MAX_TRACKED_FILES = 50
/** The transcript flush lags the done event; keep watching this long after it. */
export const WATCH_WINDOW_MS = 20_000
const DEBOUNCE_MS = 250
/**
 * How many times a transcript ending mid-line is re-read before the line is called corrupt.
 * Six x 250 ms = 1.5 s, comfortably longer than an agent CLI's flush and short enough that a
 * genuinely broken record does not delay the next real reply.
 */
export const MAX_TRUNCATED_RETRIES = 6

export interface HuddleDeps {
  readonly speech: SpeechPort
  readonly store?: HuddleStore
  readonly log: (m: string) => void
  readonly notify: (m: string) => void
  /** Override for tests. */
  readonly projectsDir?: string
}

/** "orca-plugin-tts, session 111693de" — enough to know whose words you are hearing. */
export function sessionLabel(file: string): string {
  const parts = file.split(/[/\\]/)
  const name = (parts[parts.length - 1] ?? '').replace(/\.jsonl$/, '')
  const project = (parts[parts.length - 2] ?? '').replace(/^-+/, '').split('-').slice(-3).join(' ')
  return `${project}, session ${name.slice(0, 8)}`
}

export class HuddleController {
  readonly #deps: HuddleDeps
  #enabled = false
  #spoken = new Set<string>()
  #lastReply: string | null = null
  #locked: string | null = null      // the ONE session we are following
  #watcher: FSWatcher | null = null
  #watching: string | null = null
  #stopTimer: NodeJS.Timeout | null = null
  #debounce: NodeJS.Timeout | null = null
  #primed = new Set<string>()   // per FILE: a new session must be primed too, or it dumps its backlog
  /**
   * Per FILE: how many decoded replies have already been accounted for.
   *
   * This, not the id set, is what makes dedup correct. `MAX_REMEMBERED_IDS = 300` trimmed `#spoken`
   * to the last 300, so on reply 301 the oldest ids fell out of the set while their lines were
   * still on disk — and the next whole-file re-read found them "fresh" and read them out again.
   * That is P22's "it read out the whole history" with a new cause (cross-review B-01).
   *
   * An id set is the wrong data structure for a monotonic append-only log: it is unordered, so it
   * cannot express "everything before here is done", which is the only fact we actually need. A
   * high-water mark is O(1) per session, cannot be evicted into a re-speak, and shrinks the storage
   * cost from 300 uuids to one integer. The id set is kept as a secondary filter for duplicates
   * WITHIN one read; it is no longer the gate.
   */
  #highWater = new Map<string, number>()
  /** Set when huddle is switched on, so the next attach re-primes instead of trusting a stale mark. */
  #reprime = false
  /** The worktree the last agent event came from — the only correlation handle a plugin gets. */
  #lastWorktree: string | null = null
  #warnedUnreadable = new Set<string>()   // per FILE: say "cannot read this" once, not per change
  /**
   * R10-02. How many `compact_boundary` records this file had the last time we read it, THIS
   * SESSION. Not persisted, and that is the safe direction: on the first read of a file we record
   * the count without acting on it, so a restart cannot mistake a compaction that happened while
   * we were down for one happening now and clamp over replies that arrived in between. The harm
   * this closes is re-speaking during a LIVE session, which is exactly when we do have a previous
   * count to compare against.
   */
  #compactBoundaries = new Map<string, number>()
  /**
   * The last "nothing to follow" reason announced. Latched per REASON, not forever: a permissions
   * problem that is fixed and then recurs must be able to speak again, and a reason that changes
   * (root-unreadable -> no-transcripts) is new information. Cleared the moment a file is found.
   */
  #announcedNoTranscript: NoTranscriptReason | null = null
  /** Files whose watch failure has been announced, so a churning file cannot flood the audio. */
  #warnedWatch = new Set<string>()
  /**
   * The ambiguous pair we last warned about. Was a single boolean that latched TRUE for the
   * worker's lifetime (006 site 13 / TT5): the first ambiguity produced one notification and every
   * ambiguity after it produced nothing at all, forever.
   */
  #warnedAmbiguousPair: string | null = null

  constructor(deps: HuddleDeps) { this.#deps = deps }

  get enabled(): boolean { return this.#enabled }

  async restore(): Promise<boolean> {
    this.#enabled = (await this.#deps.store?.get(HUDDLE_STATE_KEY)) === true
    const ids = await this.#deps.store?.get(HUDDLE_SPOKEN_KEY)
    if (Array.isArray(ids)) this.#spoken = new Set(ids.filter((x): x is string => typeof x === 'string'))
    const marks = await this.#deps.store?.get(HUDDLE_HIGH_WATER_KEY)
    if (typeof marks === 'object' && marks !== null && !Array.isArray(marks)) {
      for (const [file, n] of Object.entries(marks as Record<string, unknown>)) {
        if (typeof n === 'number' && Number.isFinite(n) && n >= 0) this.#highWater.set(file, n)
      }
    }
    // C4: `#locked` was worker memory, so the five-minute reap dropped it and the next agent event
    // re-picked "whatever was touched last" — P22 fault 1, reconstituted by the one mechanism none
    // of P22's fixes account for. Restoring it means a re-forked worker resumes the session the
    // listener chose instead of silently changing it under them.
    const following = await this.#deps.store?.get(HUDDLE_FOLLOWING_KEY)
    if (typeof following === 'string' && following.length > 0) this.#locked = following
    return this.#enabled
  }

  /**
   * The session being followed, as a sentence, for re-announcement after a worker reap.
   *
   * C4's other half: the listener is not told that the worker restarted, so if the lock had
   * silently changed they would have had no way to know whose words they were hearing — the S1
   * failure this whole document ranks first. Returns null when there is nothing to re-announce.
   */
  restoredAnnouncement(): string | null {
    if (!this.#enabled || this.#locked === null) return null
    return `Still following ${sessionLabel(this.#locked)}.`
  }

  toggle(): boolean {
    this.#enabled = !this.#enabled
    // Site 9: `void store.set(...)` — if storage is denied, the mode silently reverts on the next
    // worker fork and the listener is never told why huddle "turned itself off".
    this.#observe(this.#deps.store?.set(HUDDLE_STATE_KEY, this.#enabled), 'save the huddle setting')
    if (this.#enabled) {
      this.#primed.clear()          // re-prime every session on enable; never dump a backlog
      this.#reprime = true
      this.#locked = null
      void this.#persistFollowing()
    } else {
      this.#stopWatching()
      // Site 10: a sink that cannot stop means huddle-off does not actually go quiet.
      this.#observe(this.#deps.speech.stop(), 'stop speaking')
    }
    return this.#enabled
  }

  async lastReply(): Promise<string | null> {
    if (this.#lastReply !== null) return this.#lastReply
    const file = await this.#newestTranscript(null)
    if (file === null) return null
    const replies = await this.#readReplies(file)
    return replies[replies.length - 1]?.text ?? null
  }

  /** The event is a hint: start (or extend) watching the transcript for this worktree. */
  onAgentStatus(status: AgentStatusChanged, worktreePath: string | null): void {
    // Recorded even when huddle is off: `followNewest()` is reachable from a command, which has no
    // event payload of its own.
    if (worktreePath !== null) this.#lastWorktree = worktreePath
    if (!this.#enabled) return
    // Site 11: the ENTIRE tailing path was launched unobserved, so any of sites 1-7 rejecting here
    // produced an unhandled rejection and no sound.
    this.#observe(this.#ensureWatching(worktreePath), 'start watching for replies')
  }

  dispose(): void { this.#stopWatching() }

  /**
   * Follow a different session, announcing the switch so the listener is never disoriented.
   *
   * This is P22's recorded remedy — "announce switches aloud" — and until `read-aloud.follow`
   * existed it had NO caller anywhere in the source tree: one grep hit, the declaration itself.
   * An unreachable implementation reads to the next agent as a shipped feature (006 TT6, P26).
   *
   * One announcement, not two. It used to `notify` AND `speak(..., 'replace')`, which both
   * duplicated the message and cleared the queue; `notify` now routes into the audio stream, so
   * the switch is heard once and queued replies survive.
   */
  switchTo(file: string): void {
    this.#locked = file
    void this.#persistFollowing()
    this.#warnedWatch.delete(file)   // an explicit re-follow re-arms the watch report
    this.#stopWatching()
    this.#deps.notify(`Now reading from ${sessionLabel(file)}.`)
    void this.#ensureWatching(this.#lastWorktree)
  }

  /**
   * Lock onto the most recently active transcript for this worktree, announcing the switch.
   *
   * The command behind this exists because `unfollow` shipped without a counterpart: the listener
   * could stop following a session and had no way to pick one back up except by waiting for the
   * next `agent.status.changed` to silently re-pick "whatever was touched last" (006 TT7).
   *
   * Returns the file now followed, or null when there is nothing to follow.
   */
  async followNewest(): Promise<string | null> {
    const file = await this.#newestTranscript(this.#lastWorktree)
    if (file === null) return null
    this.switchTo(file)
    return file
  }

  /** Stop following any session; huddle stays on but silent until you pick one. */
  unlock(): void {
    this.#locked = null
    void this.#persistFollowing()
    this.#stopWatching()
  }

  get following(): string | null { return this.#locked }

  async #ensureWatching(worktreePath: string | null): Promise<void> {
    // Once we are following a session we STAY on it. Previously every event re-picked the
    // most-recently-modified transcript, so a busy unrelated session stole the audio mid-reply.
    let file = this.#locked
    if (file === null) {
      const found = await this.#findNewest(worktreePath)
      file = found.file
      if (file === null) {
        // TT1 / site 1 / site 5. This used to be a bare `return`: the listener pressed the hotkey,
        // heard "Huddle mode on", and then nothing, ever — indistinguishable from a plugin that
        // was never installed. Announced ONCE PER REASON, not once per event: `agent.status.changed`
        // fires constantly and a tool that narrates its own polling is unusable.
        const reason = found.reason ?? 'no-transcripts'
        if (this.#announcedNoTranscript !== reason) {
          this.#announcedNoTranscript = reason
          this.#deps.notify(NO_TRANSCRIPT_SENTENCE[reason])
        }
        return
      }
    }
    this.#announcedNoTranscript = null
    if (this.#locked === null) {
      this.#locked = file
      this.#deps.log(`read-aloud: following ${file}`)
      void this.#persistFollowing()
    }

    if (this.#watching !== file) {
      this.#stopWatching()
      this.#watching = file
      // Mark everything currently on disk as seen, so enabling mid-session speaks only what
      // arrives NEXT rather than replaying the backlog.
      if (!this.#primed.has(file)) {
        const replies = await this.#readReplies(file)
        for (const r of replies) this.#spoken.add(r.id)
        // A persisted mark survives the 5-minute worker reap, so a re-fork resumes where the
        // previous worker stopped instead of marking everything now on disk as already spoken
        // (006 TT10: the reply that arrived during the reap window used to vanish silently).
        // Switching huddle ON is the one case that deliberately discards it: the listener asked to
        // start listening now, not to be read the backlog.
        const persisted = this.#highWater.get(file)
        this.#setHighWater(file, this.#reprime || persisted === undefined ? replies.length : persisted)
        this.#reprime = false
        this.#primed.add(file)
        await this.#persistSpoken()
      }
      try {
        const w = watch(file, () => { this.#onChange(file) })
        // Site 7: `fs.watch` error events were NOT SUBSCRIBED AT ALL. A rename-replace write or an
        // inode change silently ends the watch, and one session then goes permanently quiet while
        // every other session works (TT13, and 006 section 19 rank 7). An unsubscribed 'error' on
        // an EventEmitter is also a process-level throw waiting to happen.
        w.on('error', (err) => { this.#watchFailed(file, err) })
        this.#watcher = w
        this.#deps.log(`read-aloud: watching ${file}`)
      } catch (err) {
        // Site 6: log-only. Too many watchers, or the file vanished — either way the listener is
        // about to get silence they have no way to explain.
        this.#watchFailed(file, err)
      }
    }

    // Keep watching past the done edge, because the final message lands after it.
    if (this.#stopTimer !== null) clearTimeout(this.#stopTimer)
    this.#stopTimer = setTimeout(() => { this.#stopWatching() }, WATCH_WINDOW_MS)

    this.#onChange(file)   // the flush may already have happened
  }

  #onChange(file: string): void {
    if (this.#debounce !== null) clearTimeout(this.#debounce)
    // Site 12: `void this.#speakNew(file)` inside a setTimeout — a decode or persist failure
    // rejected into nothing at all, from a callback with no caller to catch it.
    this.#debounce = setTimeout(() => { this.#observe(this.#speakNew(file), 'read new replies') }, DEBOUNCE_MS)
  }

  async #speakNew(file: string): Promise<void> {
    if (!this.#enabled) return
    const { replies, format, truncated, boundaries } = await this.#read(file)
    if (truncated) {
      const spent = this.#truncatedRetries.get(file) ?? 0
      if (spent < MAX_TRUNCATED_RETRIES) {
        // The writer is mid-line. Come back on our OWN timer, not on the next `fs.watch` event —
        // the whole point of TT3 is that if no further write touches the file, that event never
        // arrives. This timer survives `#stopWatching`, deliberately, for the same reason.
        this.#truncatedRetries.set(file, spent + 1)
        this.#deps.log(`read-aloud: transcript ends mid-line, re-read ${spent + 1}`)
        setTimeout(() => { this.#observe(this.#speakNew(file), 'read new replies') }, DEBOUNCE_MS).unref?.()
        return
      }
      // Out of retries: the line really is corrupt. Fall through and treat it as absent.
      this.#deps.log('read-aloud: transcript last line is unreadable; treating it as absent')
    }
    this.#truncatedRetries.delete(file)
    if (format === 'unknown') {
      // Once per session, not per file change: an unreadable transcript is touched constantly.
      if (!this.#warnedUnreadable.has(file)) {
        this.#warnedUnreadable.add(file)
        this.#deps.notify(unreadableTranscriptMessage(file))
      }
      return
    }
    const mark = this.#highWater.get(file) ?? 0

    /**
     * R10-02. THE TRANSCRIPT SAYS SO — read the fact instead of inferring it.
     *
     * A new `compact_boundary` record since our last read of this file means ORCA rewrote it.
     * Every record uuid changed, so re-reading would speak the session again — 006 C9, and the
     * "another session's replies hijacked the audio" harm the author reported from real use.
     *
     * Checked BEFORE the length check because it is the ground truth and the length check is a
     * proxy for it; the proxy stays, because it catches rewrites that emit no boundary at all
     * (`--resume`, rotation, truncation). Neither is a superset of the other.
     */
    const seenBoundaries = this.#compactBoundaries.get(file)
    this.#compactBoundaries.set(file, boundaries)
    if (seenBoundaries !== undefined && boundaries > seenBoundaries) {
      this.#setHighWater(file, replies.length)
      this.#deps.log(`read-aloud: transcript compacted (${boundaries} boundaries), re-anchoring at ${replies.length}`)
      await this.#persistSpoken()
      return
    }

    if (replies.length < mark) {
      // The file got SHORTER: a compaction, a --resume, or a log rotation rewrote it, and every
      // record uuid changed. Re-reading it would read the whole session aloud again (006 C9).
      // Clamp forward and stay quiet; a lost reply is recoverable, a replayed session is not.
      this.#setHighWater(file, replies.length)
      this.#deps.log(`read-aloud: transcript shrank, re-anchoring at ${replies.length}`)
      await this.#persistSpoken()
      return
    }
    // The high-water mark is the gate. The id set is only a secondary filter for duplicates within
    // one read — it can be evicted, and an evicted id must never become a reason to speak again.
    const fresh = replies.slice(mark).filter((r) => !this.#spoken.has(r.id))
    this.#setHighWater(file, replies.length)
    if (fresh.length === 0) { await this.#persistSpoken(); return }
    for (const r of fresh) {
      this.#spoken.add(r.id)
      this.#lastReply = r.text
      // 'queue', not 'replace': a reply arriving mid-utterance must not cut the previous one off.
      this.#deps.speech.speak(r.text, 'queue', sessionLabel(file), file)
    }
    this.#deps.log(`read-aloud: spoke ${fresh.length} new repl${fresh.length === 1 ? 'y' : 'ies'}`)
    await this.#persistSpoken()
  }

  /** Record a mark and keep the map bounded, oldest-touched first. */
  #setHighWater(file: string, n: number): void {
    this.#highWater.delete(file)
    this.#highWater.set(file, n)
    while (this.#highWater.size > MAX_TRACKED_FILES) {
      const oldest = this.#highWater.keys().next()
      if (oldest.done === true) break
      this.#highWater.delete(oldest.value)
    }
  }

  /**
   * One sentence per file, not per event: a file that fails to watch usually keeps failing, and a
   * hundred identical reports would flood the only channel the listener has.
   */
  #watchFailed(file: string, err: unknown): void {
    this.#deps.log(`read-aloud: could not watch transcript ${file}: ${String(err)}`)
    if (this.#warnedWatch.has(file)) return
    this.#warnedWatch.add(file)
    this.#deps.notify(
      'Huddle lost track of the agent transcript, so new replies may not be spoken. ' +
      'Use follow to pick the session up again.'
    )
  }

  async #persistFollowing(): Promise<void> {
    await this.#deps.store?.set(HUDDLE_FOLLOWING_KEY, this.#locked)
  }

  async #persistSpoken(): Promise<void> {
    const ids = [...this.#spoken].slice(-MAX_REMEMBERED_IDS)
    this.#spoken = new Set(ids)
    await this.#deps.store?.set(HUDDLE_SPOKEN_KEY, ids)
    await this.#deps.store?.set(HUDDLE_HIGH_WATER_KEY, Object.fromEntries(this.#highWater))
  }

  #stopWatching(): void {
    this.#watcher?.close()
    this.#watcher = null
    this.#watching = null
    if (this.#stopTimer !== null) { clearTimeout(this.#stopTimer); this.#stopTimer = null }
    if (this.#debounce !== null) { clearTimeout(this.#debounce); this.#debounce = null }
  }

  /**
   * The one place a fire-and-forget promise is allowed, because it is not fire-and-forget any more.
   *
   * Sites 9-12 were four `void somePromise()` calls with no `.catch`. Each one is a whole subsystem
   * — persistence, playback, tailing, decoding — failing into an unhandled rejection, which for
   * this listener is exactly the same experience as the plugin not existing.
   */
  #observe(p: Promise<unknown> | undefined, what: string): void {
    void Promise.resolve(p).catch((err: unknown) => {
      this.#deps.log(`read-aloud: could not ${what}: ${String(err)}`)
      this.#deps.notify(`Huddle could not ${what}, so replies may stop being spoken.`)
    })
  }

  #projectsRoot(): string {
    return this.#deps.projectsDir ?? join(homedir(), '.claude', 'projects')
  }

  async #newestTranscript(worktreePath: string | null): Promise<string | null> {
    return (await this.#findNewest(worktreePath)).file
  }

  /**
   * Find the newest transcript, and say WHY when there is none.
   *
   * Site 5: this returned a bare `null` for six different causes, and `#ensureWatching` returned on
   * it with no log and no notify. Distinguishing them is what makes TT1 announceable at all — "no
   * agent has ever run here" and "we are not allowed to read your home directory" need completely
   * different sentences, and the listener can act on the second one.
   */
  async #findNewest(
    worktreePath: string | null
  ): Promise<{ file: string | null; reason: NoTranscriptReason | null }> {
    const root = this.#projectsRoot()
    let dirs: string[]
    try {
      dirs = await readdir(root)
    } catch (err) {
      // ENOENT is not a fault: no agent has ever run on this machine. Anything else is.
      const code = (err as NodeJS.ErrnoException).code
      this.#deps.log(`read-aloud: cannot read ${root}: ${String(code ?? err)}`)
      return { file: null, reason: code === 'ENOENT' ? 'no-root' : 'root-unreadable' }
    }

    const slug = worktreePath === null ? null : worktreePath.replace(/[/\\:]/g, '-')
    const matched = slug === null
      ? []
      : dirs.filter((d) => d === slug || d.endsWith(slug) || slug.endsWith(d))
    const search = matched.length > 0 ? matched : dirs

    const files: Array<{ path: string; mtime: number }> = []
    let skipped = 0
    for (const d of search) {
      let entries: string[]
      // Sites 2 and 3: a directory or a file we cannot stat is skipped. That stays — one
      // unreadable directory among fifty is not worth a sentence — but it is now COUNTED, so
      // "there are no transcripts" and "we could not look at any of them" are not the same answer.
      try { entries = await readdir(join(root, d)) } catch { skipped++; continue }
      for (const e of entries) {
        if (!e.endsWith('.jsonl')) continue
        const p = join(root, d, e)
        try { files.push({ path: p, mtime: (await stat(p)).mtimeMs }) } catch { skipped++; continue }
      }
    }
    if (files.length === 0) {
      return { file: null, reason: skipped > 0 ? 'root-unreadable' : 'no-transcripts' }
    }
    files.sort((a, b) => b.mtime - a.mtime)

    const [first, second] = files
    if (first !== undefined && second !== undefined && first.mtime - second.mtime < 2000) {
      // Site 13 / TT5: `#warnedAmbiguous` latched true for the worker's LIFETIME, so the first
      // ambiguity produced one report and every ambiguity after it produced nothing at all. Keyed
      // on the pair instead: a new pair of agents is new information and is said again, while the
      // same pair churning through a hundred file events still says it once.
      const pair = `${first.path}\u0000${second.path}`
      if (this.#warnedAmbiguousPair !== pair) {
        this.#warnedAmbiguousPair = pair
        this.#deps.notify(
          'two agents are active in this worktree, so huddle cannot tell which one replied. ' +
          'Speaking the most recent.'
        )
      }
    } else {
      this.#warnedAmbiguousPair = null   // unambiguous again: re-arm
    }
    return { file: first?.path ?? null, reason: null }
  }

  async #readReplies(file: string): Promise<DecodedReply[]> {
    return (await this.#read(file)).replies
  }

  /**
   * Re-reads spent on a file whose last line was mid-write. Bounded, because a genuinely corrupt
   * final line must not spin forever — after this many attempts the line really is unreadable and
   * is treated as absent, which is what it now is.
   */
  #truncatedRetries = new Map<string, number>()

  /**
   * Read a transcript with the decoder its own records call for.
   *
   * This used to call `decodeClaudeLine` unconditionally, so every non-Claude agent produced total
   * silence while the plugin reported itself healthy and the panel claimed the format was
   * supported (006 DC1). `format` is returned rather than swallowed so the caller can SAY that it
   * could not read the file — "unreadable" and "nothing new" were previously the same empty array.
   */
  async #read(
    file: string
  ): Promise<{ replies: DecodedReply[]; format: TranscriptFormat; truncated: boolean; boundaries: number }> {
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch (err) {
      // Site 4: an unreadable transcript was indistinguishable from an empty one. `'unknown'`
      // routes it to the spoken "cannot read this transcript" sentence instead of silence.
      this.#deps.log(`read-aloud: cannot read ${file}: ${String(err)}`)
      return { replies: [], format: 'unknown', truncated: false, boundaries: 0 }
    }
    let lastNonEmpty = ''
    for (const line of raw.split('\n')) if (line.trim().length > 0) lastNonEmpty = line
    // Computed BEFORE the format check, deliberately. A transcript whose very first record is
    // still mid-write parses as no known format, and returning 'unknown' here would announce
    // "huddle cannot read this agent's transcript" — a false alarm, in the one channel the
    // listener has, about a file that is perfectly readable a quarter of a second later.
    const truncated = lastNonEmpty.length > 0 && !this.#isCompleteJson(lastNonEmpty)
    const format = detectTranscriptFormat(raw)
    if (format === 'unknown') return { replies: [], format, truncated, boundaries: 0 }
    const decode = decoderFor(format === 'claude' ? 'claude' : 'codex')
    const replies: DecodedReply[] = []
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0) continue
      const decoded = decode(line)
      if (decoded !== null) replies.push(decoded)
    }
    // 006 TT3 / site 14, the race that survives P20's fix. The 250 ms debounce does not guarantee
    // the writer finished a line, and `decodeClaudeLine` returns null for a half-flushed one — at
    // which point it is indistinguishable from a user turn or tool traffic. If the LAST line of the
    // file is not valid JSON, the file is very likely mid-write; if no further write ever touches
    // it, `fs.watch` never fires again and that reply is lost permanently. Instrument exactly as
    // the FMA specifies: detect it and re-read, rather than concluding there is nothing new.
    return { replies, format, truncated, boundaries: countCompactBoundaries(raw) }
  }

  #isCompleteJson(line: string): boolean {
    try { JSON.parse(line); return true } catch { return false }
  }
}
