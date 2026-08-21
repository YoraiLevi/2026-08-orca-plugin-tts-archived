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
import type { AgentStatusChanged } from '../adapter/index.js'
import {
  decoderFor, detectTranscriptFormat, unreadableTranscriptMessage,
  type DecodedReply, type TranscriptFormat
} from './decoders.js'

/** Minimal port, so huddle can be tested without a synthesizer. */
export interface SpeechPort {
  speak(text: string, mode?: 'replace' | 'queue', label?: string): void
  stop(): Promise<void>
}

export interface HuddleStore {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}

export const HUDDLE_STATE_KEY = 'huddle.enabled'
export const HUDDLE_SPOKEN_KEY = 'huddle.spokenIds'
export const HUDDLE_HIGH_WATER_KEY = 'huddle.highWater'
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
  #warnedAmbiguous = false
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
    return this.#enabled
  }

  toggle(): boolean {
    this.#enabled = !this.#enabled
    void this.#deps.store?.set(HUDDLE_STATE_KEY, this.#enabled)
    if (this.#enabled) {
      this.#primed.clear()          // re-prime every session on enable; never dump a backlog
      this.#reprime = true
      this.#locked = null
    } else {
      this.#stopWatching()
      void this.#deps.speech.stop()
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
    void this.#ensureWatching(worktreePath)
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
    this.#stopWatching()
  }

  get following(): string | null { return this.#locked }

  async #ensureWatching(worktreePath: string | null): Promise<void> {
    // Once we are following a session we STAY on it. Previously every event re-picked the
    // most-recently-modified transcript, so a busy unrelated session stole the audio mid-reply.
    const file = this.#locked ?? await this.#newestTranscript(worktreePath)
    if (file === null) return
    if (this.#locked === null) {
      this.#locked = file
      this.#deps.log(`read-aloud: following ${file}`)
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
        this.#watcher = watch(file, () => { this.#onChange(file) })
        this.#deps.log(`read-aloud: watching ${file}`)
      } catch (err) {
        this.#deps.log(`read-aloud: could not watch transcript: ${String(err)}`)
      }
    }

    // Keep watching past the done edge, because the final message lands after it.
    if (this.#stopTimer !== null) clearTimeout(this.#stopTimer)
    this.#stopTimer = setTimeout(() => { this.#stopWatching() }, WATCH_WINDOW_MS)

    this.#onChange(file)   // the flush may already have happened
  }

  #onChange(file: string): void {
    if (this.#debounce !== null) clearTimeout(this.#debounce)
    this.#debounce = setTimeout(() => { void this.#speakNew(file) }, DEBOUNCE_MS)
  }

  async #speakNew(file: string): Promise<void> {
    if (!this.#enabled) return
    const { replies, format } = await this.#read(file)
    if (format === 'unknown') {
      // Once per session, not per file change: an unreadable transcript is touched constantly.
      if (!this.#warnedUnreadable.has(file)) {
        this.#warnedUnreadable.add(file)
        this.#deps.notify(unreadableTranscriptMessage(file))
      }
      return
    }
    const mark = this.#highWater.get(file) ?? 0
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
      this.#deps.speech.speak(r.text, 'queue', sessionLabel(file))
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

  #projectsRoot(): string {
    return this.#deps.projectsDir ?? join(homedir(), '.claude', 'projects')
  }

  async #newestTranscript(worktreePath: string | null): Promise<string | null> {
    const root = this.#projectsRoot()
    let dirs: string[]
    try { dirs = await readdir(root) } catch { return null }

    const slug = worktreePath === null ? null : worktreePath.replace(/[/\\:]/g, '-')
    const matched = slug === null
      ? []
      : dirs.filter((d) => d === slug || d.endsWith(slug) || slug.endsWith(d))
    const search = matched.length > 0 ? matched : dirs

    const files: Array<{ path: string; mtime: number }> = []
    for (const d of search) {
      let entries: string[]
      try { entries = await readdir(join(root, d)) } catch { continue }
      for (const e of entries) {
        if (!e.endsWith('.jsonl')) continue
        const p = join(root, d, e)
        try { files.push({ path: p, mtime: (await stat(p)).mtimeMs }) } catch { continue }
      }
    }
    if (files.length === 0) return null
    files.sort((a, b) => b.mtime - a.mtime)

    const [first, second] = files
    if (first !== undefined && second !== undefined && first.mtime - second.mtime < 2000 &&
        !this.#warnedAmbiguous) {
      this.#warnedAmbiguous = true
      this.#deps.notify(
        'two agents are active in this worktree, so huddle cannot tell which one replied. ' +
        'Speaking the most recent.'
      )
    }
    return first?.path ?? null
  }

  async #readReplies(file: string): Promise<DecodedReply[]> {
    return (await this.#read(file)).replies
  }

  /**
   * Read a transcript with the decoder its own records call for.
   *
   * This used to call `decodeClaudeLine` unconditionally, so every non-Claude agent produced total
   * silence while the plugin reported itself healthy and the panel claimed the format was
   * supported (006 DC1). `format` is returned rather than swallowed so the caller can SAY that it
   * could not read the file — "unreadable" and "nothing new" were previously the same empty array.
   */
  async #read(file: string): Promise<{ replies: DecodedReply[]; format: TranscriptFormat }> {
    let raw: string
    try { raw = await readFile(file, 'utf8') } catch { return { replies: [], format: 'unknown' } }
    const format = detectTranscriptFormat(raw)
    if (format === 'unknown') return { replies: [], format }
    const decode = decoderFor(format === 'claude' ? 'claude' : 'codex')
    const replies: DecodedReply[] = []
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0) continue
      const decoded = decode(line)
      if (decoded !== null) replies.push(decoded)
    }
    return { replies, format }
  }
}
