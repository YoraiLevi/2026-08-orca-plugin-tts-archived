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
import { decodeClaudeLine, type DecodedReply } from './decoders.js'

/** Minimal port, so huddle can be tested without a synthesizer. */
export interface SpeechPort {
  speak(text: string, mode?: 'replace' | 'queue'): void
  stop(): Promise<void>
}

export interface HuddleStore {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}

export const HUDDLE_STATE_KEY = 'huddle.enabled'
export const HUDDLE_SPOKEN_KEY = 'huddle.spokenIds'
/** Bounded so plugin storage (256 KB per value) can never be blown by a long session. */
export const MAX_REMEMBERED_IDS = 300
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

export class HuddleController {
  readonly #deps: HuddleDeps
  #enabled = false
  #spoken = new Set<string>()
  #lastReply: string | null = null
  #warnedAmbiguous = false
  #watcher: FSWatcher | null = null
  #watching: string | null = null
  #stopTimer: NodeJS.Timeout | null = null
  #debounce: NodeJS.Timeout | null = null
  #primed = false

  constructor(deps: HuddleDeps) { this.#deps = deps }

  get enabled(): boolean { return this.#enabled }

  async restore(): Promise<boolean> {
    this.#enabled = (await this.#deps.store?.get(HUDDLE_STATE_KEY)) === true
    const ids = await this.#deps.store?.get(HUDDLE_SPOKEN_KEY)
    if (Array.isArray(ids)) this.#spoken = new Set(ids.filter((x): x is string => typeof x === 'string'))
    return this.#enabled
  }

  toggle(): boolean {
    this.#enabled = !this.#enabled
    void this.#deps.store?.set(HUDDLE_STATE_KEY, this.#enabled)
    if (this.#enabled) {
      // Everything already on disk is history, not news: never dump the backlog on the user.
      this.#primed = false
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
    if (!this.#enabled) return
    void this.#ensureWatching(worktreePath)
  }

  dispose(): void { this.#stopWatching() }

  async #ensureWatching(worktreePath: string | null): Promise<void> {
    const file = await this.#newestTranscript(worktreePath)
    if (file === null) return

    if (this.#watching !== file) {
      this.#stopWatching()
      this.#watching = file
      // Mark everything currently on disk as seen, so enabling mid-session speaks only what
      // arrives NEXT rather than replaying the backlog.
      if (!this.#primed) {
        for (const r of await this.#readReplies(file)) this.#spoken.add(r.id)
        this.#primed = true
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
    const replies = await this.#readReplies(file)
    const fresh = replies.filter((r) => !this.#spoken.has(r.id))
    if (fresh.length === 0) return
    for (const r of fresh) {
      this.#spoken.add(r.id)
      this.#lastReply = r.text
      // 'queue', not 'replace': a reply arriving mid-utterance must not cut the previous one off.
      this.#deps.speech.speak(r.text, 'queue')
    }
    this.#deps.log(`read-aloud: spoke ${fresh.length} new repl${fresh.length === 1 ? 'y' : 'ies'}`)
    await this.#persistSpoken()
  }

  async #persistSpoken(): Promise<void> {
    const ids = [...this.#spoken].slice(-MAX_REMEMBERED_IDS)
    this.#spoken = new Set(ids)
    await this.#deps.store?.set(HUDDLE_SPOKEN_KEY, ids)
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
    let raw: string
    try { raw = await readFile(file, 'utf8') } catch { return [] }
    const out: DecodedReply[] = []
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0) continue
      const decoded = decodeClaudeLine(line)
      if (decoded !== null) out.push(decoded)
    }
    return out
  }
}
