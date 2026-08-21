import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HuddleController, MAX_REMEMBERED_IDS, type HuddleStore } from './index.ts'

const settle = async (ticks = 90): Promise<void> => {
  for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 5))
}

class FakeSpeech {
  spoken: string[] = []
  speak(text: string): void { this.spoken.push(text) }
  async stop(): Promise<void> {}
}

/** An in-memory stand-in for ORCA plugin storage, so a "worker reap" can be simulated. */
class MemoryStore implements HuddleStore {
  data = new Map<string, unknown>()
  async get(key: string): Promise<unknown> { return this.data.get(key) }
  async set(key: string, value: unknown): Promise<void> { this.data.set(key, value) }
}

const record = (i: number): string =>
  JSON.stringify({ type: 'assistant', uuid: `r-${i}`, message: { content: [{ type: 'text', text: `reply ${i}` }] } })

async function scaffold(): Promise<{ root: string; worktree: string; file: string }> {
  const root = await mkdtemp(join(tmpdir(), 'orca-tts-huddle-'))
  const worktree = join(root, 'wt')
  const project = worktree.replace(/[/\\:]/g, '-')
  await mkdir(join(root, project), { recursive: true })
  const file = join(root, project, 'sess.jsonl')
  await writeFile(file, '')
  return { root, worktree, file }
}

function boot(root: string, store: HuddleStore, speech: FakeSpeech): HuddleController {
  return new HuddleController({
    speech, store, projectsDir: root, log: () => {}, notify: () => {}
  })
}

/**
 * Cross-review B-01 — the 301st reply.
 *
 * `MAX_REMEMBERED_IDS = 300` trimmed `#spoken` to the last 300, so once a session passed 300
 * replies the oldest ids fell out of the set while their lines were still on disk. `#speakNew`
 * re-reads the WHOLE file on every change, so the next change found those evicted replies "fresh"
 * and read them out again — P22's "it read out the whole history" with a new cause.
 *
 * No reap needed to reproduce it: one controller, one file, one append past the bound.
 */
describe('B-01 an evicted id can never become a reason to speak again', () => {
  it('does not re-speak the start of a session that has passed the id bound', async () => {
    const { root, worktree, file } = await scaffold()
    const speech = new FakeSpeech()
    const h = boot(root, new MemoryStore(), speech)
    h.toggle()
    h.onAgentStatus({ worktreeId: `r::${worktree}`, paneKey: 'p', state: 'done', receivedAt: 0 }, worktree)
    await settle(20)

    const overflow = MAX_REMEMBERED_IDS + 5
    await appendFile(file, Array.from({ length: overflow }, (_, i) => record(i)).join('\n') + '\n')
    await settle()
    expect(speech.spoken.length, 'the burst was not spoken at all').toBe(overflow)

    // The first five ids have now been evicted from #spoken by the 300-entry bound.
    speech.spoken.length = 0
    await appendFile(file, record(overflow) + '\n')
    await settle()

    expect(speech.spoken, 'an evicted reply was read out a second time').toEqual([`reply ${overflow}`])
  })

  it('survives the worker reap: a restored controller resumes, it does not replay', async () => {
    const { root, worktree, file } = await scaffold()
    const store = new MemoryStore()
    const first = new FakeSpeech()
    const a = boot(root, store, first)
    a.toggle()
    a.onAgentStatus({ worktreeId: `r::${worktree}`, paneKey: 'p', state: 'done', receivedAt: 0 }, worktree)
    await settle(20)
    await appendFile(file, Array.from({ length: 310 }, (_, i) => record(i)).join('\n') + '\n')
    await settle()
    expect(first.spoken.length).toBe(310)
    a.dispose()

    // ORCA reaps the idle worker and re-forks it. Everything in worker memory is gone; only
    // plugin storage survives (PITFALLS P20, P6).
    const second = new FakeSpeech()
    const b = boot(root, store, second)
    await b.restore()
    b.onAgentStatus({ worktreeId: `r::${worktree}`, paneKey: 'p', state: 'done', receivedAt: 0 }, worktree)
    await settle()
    expect(second.spoken, 'the re-forked worker replayed the session').toEqual([])

    // ...and the reply that lands after the re-fork is still spoken. An "always silent" pass would
    // satisfy the assertion above for the wrong reason.
    await appendFile(file, record(999) + '\n')
    await settle()
    expect(second.spoken, 'the mark froze; nothing new can ever be spoken').toEqual(['reply 999'])
  })

  it('C9: a compacted transcript is re-anchored, not read out from the top', async () => {
    const { root, worktree, file } = await scaffold()
    const speech = new FakeSpeech()
    const h = boot(root, new MemoryStore(), speech)
    h.toggle()
    h.onAgentStatus({ worktreeId: `r::${worktree}`, paneKey: 'p', state: 'done', receivedAt: 0 }, worktree)
    await settle(20)
    await appendFile(file, Array.from({ length: 20 }, (_, i) => record(i)).join('\n') + '\n')
    await settle()
    expect(speech.spoken.length).toBe(20)

    // A compaction rewrites the file shorter, with brand-new uuids that no id set can recognise.
    speech.spoken.length = 0
    await writeFile(file, Array.from({ length: 4 }, (_, i) => JSON.stringify({
      type: 'assistant', uuid: `compacted-${i}`,
      message: { content: [{ type: 'text', text: `compacted ${i}` }] }
    })).join('\n') + '\n')
    await settle()
    expect(speech.spoken, 'a compaction replayed the session aloud').toEqual([])

    // ...and the session is not muted forever. MUTATION-CHECKED: deleting the whole re-anchor
    // branch (`if (replies.length < mark)`) left the assertion above green, because
    // `replies.slice(20)` of a 4-line file is empty either way. Silence alone therefore proved
    // nothing. Without re-anchoring the mark stays at 20, so the next SIXTEEN replies are never
    // spoken — the plugin goes quietly mute for that session, which is the failure mode this
    // project exists to prevent.
    await appendFile(file, Array.from({ length: 3 }, (_, i) => JSON.stringify({
      type: 'assistant', uuid: `after-compaction-${i}`,
      message: { content: [{ type: 'text', text: `after compaction ${i}` }] }
    })).join('\n') + '\n')
    await settle()
    expect(speech.spoken, 'the mark froze past the compaction; the session went permanently mute')
      .toEqual(['after compaction 0', 'after compaction 1', 'after compaction 2'])
  })
})

/**
 * 006 TT1 and sites 1–5, 6, 7, 13 — the failures that produce silence with no explanation, plus
 * cascade C4, which reconstitutes all three of P22's faults through the five-minute worker reap.
 *
 * TT1's sentence is the reason this section exists: "They pressed Mod+Shift+H, heard 'Huddle mode
 * on.', and then nothing, ever. The plugin is indistinguishable from a plugin that was never
 * installed."
 */
describe('006 TT1/sites 1-7 — silence always has a spoken reason', () => {
  const bootWith = (root: string, notify: string[]): { c: HuddleController; s: FakeSpeech } => {
    const s = new FakeSpeech()
    const c = new HuddleController({
      speech: s, store: new MemoryStore(), projectsDir: root,
      log: () => {}, notify: (m) => notify.push(m)
    })
    return { c, s }
  }

  it('says so when the projects root does not exist at all', async () => {
    const notify: string[] = []
    const { c } = bootWith(join(tmpdir(), 'orca-tts-does-not-exist-ever'), notify)
    c.toggle()
    c.onAgentStatus({ worktreeId: null, paneKey: 'p', state: 'done', receivedAt: 0 }, '/tmp/wt')
    await settle(10)
    expect(notify.join(' '), 'the listener got silence with no reason at all')
      .toMatch(/no agent transcripts on this machine/i)
  })

  it('distinguishes an UNREADABLE root from an empty one — different causes, different sentences', async () => {
    const { chmod } = await import('node:fs/promises')
    if (process.getuid?.() === 0) return   // root can read anything; the probe cannot fail
    const root = await mkdtemp(join(tmpdir(), 'orca-tts-noperm-'))
    await chmod(root, 0o000)
    const notify: string[] = []
    const { c } = bootWith(root, notify)
    c.toggle()
    c.onAgentStatus({ worktreeId: null, paneKey: 'p', state: 'done', receivedAt: 0 }, '/tmp/wt')
    await settle(10)
    await chmod(root, 0o755)
    expect(notify.join(' '), 'permissions and "nothing here yet" were the same silent return')
      .toMatch(/permissions/i)
  })

  it('says it once per reason, not once per agent event — a tool that narrates polling is unusable', async () => {
    const notify: string[] = []
    const { c } = bootWith(join(tmpdir(), 'orca-tts-does-not-exist-ever'), notify)
    c.toggle()
    for (let i = 0; i < 12; i++) {
      c.onAgentStatus({ worktreeId: null, paneKey: 'p', state: 'done', receivedAt: i }, '/tmp/wt')
    }
    await settle(10)
    expect(notify.length, 'twelve agent events must not produce twelve announcements').toBe(1)
  })

  it('CONTROL: when a transcript IS found, nothing is announced', async () => {
    // Proves the assertions above can fail for the right reason: this is not an unconditional say.
    const { root, worktree } = await scaffold()
    const notify: string[] = []
    const { c } = bootWith(root, notify)
    c.toggle()
    c.onAgentStatus({ worktreeId: null, paneKey: 'p', state: 'done', receivedAt: 0 }, worktree)
    await settle(10)
    expect(notify.join(' '), 'a working huddle must not report a fault').not.toMatch(/nothing to read|permissions/i)
  })
})

describe('006 site 13 — the two-agents warning is not latched for the worker lifetime', () => {
  it('warns again when a DIFFERENT pair of agents is ambiguous', async () => {
    const { root, worktree } = await scaffold()
    const project = worktree.replace(/[/\\:]/g, '-')
    const notify: string[] = []
    const c = new HuddleController({
      speech: new FakeSpeech(), store: new MemoryStore(), projectsDir: root,
      log: () => {}, notify: (m) => notify.push(m)
    })
    const write = async (name: string): Promise<void> => {
      await writeFile(join(root, project, name), record(0) + '\n')
    }
    await write('a.jsonl'); await write('b.jsonl')
    c.toggle()
    c.onAgentStatus({ worktreeId: null, paneKey: 'p', state: 'done', receivedAt: 0 }, worktree)
    await settle(10)
    const afterFirst = notify.filter((n) => /two agents/i.test(n)).length
    expect(afterFirst, 'the first ambiguity must be reported').toBe(1)

    // A new pair. `#warnedAmbiguous` latched true for the worker's LIFETIME, so this second,
    // genuinely different ambiguity produced nothing at all — forever.
    c.unlock()
    await write('c.jsonl'); await write('d.jsonl')
    c.onAgentStatus({ worktreeId: null, paneKey: 'p', state: 'done', receivedAt: 1 }, worktree)
    await settle(10)
    expect(notify.filter((n) => /two agents/i.test(n)).length,
      'every ambiguity after the first was silent, forever').toBeGreaterThan(afterFirst)
  })
})

describe('006 C4 — the five-minute reap must not silently change which session is followed', () => {
  it('restores the lock, so a re-forked worker resumes the chosen session', async () => {
    const { root, worktree } = await scaffold()
    const project = worktree.replace(/[/\\:]/g, '-')
    const store = new MemoryStore()
    const chosen = join(root, project, 'chosen.jsonl')
    await writeFile(chosen, record(0) + '\n')

    const first = boot(root, store, new FakeSpeech())
    first.toggle()
    first.onAgentStatus({ worktreeId: null, paneKey: 'p', state: 'done', receivedAt: 0 }, worktree)
    await settle(10)
    expect(first.following, 'nothing was followed, so the test proves nothing').toBe(chosen)
    first.dispose()

    // The reap. A DIFFERENT session becomes the most recently modified one — which is exactly what
    // five idle minutes produces, and exactly what P22 fault 1 is.
    await new Promise((r) => setTimeout(r, 20))
    await writeFile(join(root, project, 'someone-else.jsonl'), record(9) + '\n')

    const reforked = boot(root, store, new FakeSpeech())
    await reforked.restore()
    reforked.onAgentStatus({ worktreeId: null, paneKey: 'p', state: 'done', receivedAt: 1 }, worktree)
    await settle(10)
    expect(reforked.following, 'the reap silently moved the listener to another agent').toBe(chosen)
    reforked.dispose()
  })

  it('re-announces whose session it is, because the listener cannot know a worker restarted', async () => {
    const { root, worktree } = await scaffold()
    const store = new MemoryStore()
    const first = boot(root, store, new FakeSpeech())
    first.toggle()
    first.onAgentStatus({ worktreeId: null, paneKey: 'p', state: 'done', receivedAt: 0 }, worktree)
    await settle(10)
    first.dispose()

    const reforked = boot(root, store, new FakeSpeech())
    await reforked.restore()
    expect(reforked.restoredAnnouncement(), 'provenance is the thing the listener cannot obtain any other way')
      .toMatch(/still following/i)
  })

  it('CONTROL: with huddle off there is nothing to re-announce', async () => {
    const store = new MemoryStore()
    const { root } = await scaffold()
    const c = boot(root, store, new FakeSpeech())
    await c.restore()
    expect(c.restoredAnnouncement(), 'a silent plugin must not announce a session on every activation')
      .toBeNull()
  })
})

describe('006 TT4/site 15 — a record with no uuid gets a STABLE id', () => {
  it('decodes to the same id every time the same line is read', async () => {
    const { decodeClaudeLine, decodeGenericLine } = await import('./decoders.ts')
    // No `uuid` key at all. The id was `${Date.now()}-${parts.length}` — a NEW id on every read, so
    // the id set could never match it. Round 4's high-water mark now gates dedup, which covers the
    // plain append case, so this asserts the defect WHERE IT LIVES rather than through a path that
    // masks it: a test that went green because a different fix covered it would be exactly the
    // "could not have failed" shape the test audit was written about (P33).
    const line = JSON.stringify({
      type: 'assistant', message: { content: [{ type: 'text', text: 'no uuid here' }] }
    })
    const a = decodeClaudeLine(line)
    await new Promise((r) => setTimeout(r, 5))
    const b = decodeClaudeLine(line)
    expect(a?.id, 'the same line produced two different ids, so dedup could never match').toBe(b?.id)
    expect(String(a?.id), 'a time-based id is not derived from the record at all').not.toMatch(/^\d{13}/)

    const generic = JSON.stringify({ role: 'assistant', content: 'codex said this' })
    await new Promise((r) => setTimeout(r, 5))
    expect(decodeGenericLine(generic)?.id).toBe(decodeGenericLine(generic)?.id)
  })

  it('CONTROL: a record that HAS a uuid still uses it', async () => {
    const { decodeClaudeLine } = await import('./decoders.ts')
    const line = JSON.stringify({
      type: 'assistant', uuid: 'real-uuid-1', message: { content: [{ type: 'text', text: 'x' }] }
    })
    expect(decodeClaudeLine(line)?.id).toBe('real-uuid-1')
  })

  it('CONTROL: two different texts do not collide onto one id', async () => {
    const { decodeClaudeLine } = await import('./decoders.ts')
    const mk = (t: string): string => JSON.stringify({
      type: 'assistant', message: { content: [{ type: 'text', text: t }] }
    })
    expect(decodeClaudeLine(mk('alpha'))?.id).not.toBe(decodeClaudeLine(mk('bravo'))?.id)
  })
})

/**
 * 006 TT3 / site 14 — the race that survives P20's fix.
 *
 * The 250 ms debounce does not guarantee the writer finished a line, and `decodeClaudeLine` returns
 * null for a half-flushed one — at which point it is indistinguishable from a user turn or tool
 * traffic. If no further write ever touches the file, `fs.watch` never fires again and the FINAL
 * REPLY OF A TURN is lost permanently. That is the most common reply to lose: the one the listener
 * was actually waiting for.
 */
describe('006 TT3 — a half-written final line is re-read, not concluded on', () => {
  it('speaks the reply that arrives as a half-flushed line', async () => {
    const { root, worktree, file } = await scaffold()
    const speech = new FakeSpeech()
    const c = boot(root, new MemoryStore(), speech)
    c.toggle()
    c.onAgentStatus({ worktreeId: null, paneKey: 'p', state: 'done', receivedAt: 0 }, worktree)
    await settle(20)

    const line = JSON.stringify({
      type: 'assistant', uuid: 'half-1',
      message: { content: [{ type: 'text', text: 'the last reply of the turn' }] }
    })
    // Exactly what the agent CLI produces mid-flush: a prefix of the record, no newline.
    await appendFile(file, line.slice(0, 40))
    await settle()
    expect(speech.spoken.join(' '), 'a partial line must not be spoken as if it were complete')
      .not.toContain('the last reply')

    // THE FIXTURE THAT MAKES THIS FAIL FOR THE RIGHT REASON (P33).
    //
    // Simply appending the rest would fire `fs.watch` again, and the reply would be spoken with or
    // without this fix — a test that could not have failed. The failure TT3 describes is precisely
    // "no further write touches the file, so fs.watch never fires again and it is lost
    // permanently". So the watcher is closed FIRST: after this line, the scheduled re-read is the
    // only thing left that can find the rest of the record.
    c.dispose()
    await appendFile(file, line.slice(40) + '\n')
    await settle()
    expect(speech.spoken.join(' '), 'the final reply of the turn was lost permanently')
      .toContain('the last reply of the turn')
    c.dispose()
  })

  it('CONTROL: a complete line is spoken without waiting for a retry', async () => {
    const { root, worktree, file } = await scaffold()
    const speech = new FakeSpeech()
    const c = boot(root, new MemoryStore(), speech)
    c.toggle()
    c.onAgentStatus({ worktreeId: null, paneKey: 'p', state: 'done', receivedAt: 0 }, worktree)
    await settle(20)
    await appendFile(file, record(1) + '\n')
    await settle()
    expect(speech.spoken).toContain('reply 1')
    c.dispose()
  })
})

/**
 * R10-02 — the transcript STATES the compaction; huddle was inferring it from file length.
 *
 * ORCA writes `{"type":"system","subtype":"compact_boundary"}` at the boundary. Huddle detected a
 * rewritten transcript only by "the decodable reply count got SHORTER", and its own comment names
 * the stake: *"a lost reply is recoverable, a replayed session is not"* — the "another session's
 * replies hijacked the audio" harm the author reported from real use.
 *
 * The two directions below are the whole finding. The first is the case the length check CANNOT
 * see, and it is what makes reading the record worth doing. The second is the case the record
 * cannot see, and it is why the length check stays.
 */
const boundary = (): string => JSON.stringify({ type: 'system', subtype: 'compact_boundary' })

describe('R10-02 a compaction is read from the transcript, not inferred from its length', () => {
  it('a compaction that does NOT shrink the reply count is still detected', async () => {
    const { root, worktree, file } = await scaffold()
    const speech = new FakeSpeech()
    const h = boot(root, new MemoryStore(), speech)
    h.toggle()
    h.onAgentStatus({ worktreeId: `r::${worktree}`, paneKey: 'p', state: 'done', receivedAt: 0 }, worktree)
    await settle(20)

    await appendFile(file, [record(1), record(2), record(3)].join('\n') + '\n')
    await settle()
    expect(speech.spoken, 'the first three replies were not spoken').toEqual(['reply 1', 'reply 2', 'reply 3'])

    // ORCA compacts: it rewrites the file as a summary plus the re-emitted turns, every record
    // carrying a NEW uuid. The decodable reply count goes UP, not down, so the "file got shorter"
    // heuristic sees nothing — and the high-water mark then treats records 4 and 5 as new, which
    // is the re-reading 006 C9 calls unrecoverable. This is the case the length check CANNOT see.
    speech.spoken.length = 0
    const rewritten = [
      boundary(),
      ...[11, 12, 13, 14, 15].map((i) => record(i)),
    ].join('\n') + '\n'
    await writeFile(file, rewritten)
    await settle()

    expect(speech.spoken, 'the rewritten session was read aloud again').toEqual([])
  })

  it('CONTROL: a rewrite with NO boundary record is still caught by the length check', async () => {
    // `--resume`, a log rotation and a truncation emit no `compact_boundary`. If reading the record
    // had replaced the length check rather than joining it, this would speak the session again.
    const { root, worktree, file } = await scaffold()
    const speech = new FakeSpeech()
    const h = boot(root, new MemoryStore(), speech)
    h.toggle()
    h.onAgentStatus({ worktreeId: `r::${worktree}`, paneKey: 'p', state: 'done', receivedAt: 0 }, worktree)
    await settle(20)

    await appendFile(file, [record(1), record(2), record(3)].join('\n') + '\n')
    await settle()
    expect(speech.spoken.length).toBe(3)

    speech.spoken.length = 0
    await writeFile(file, record(21) + '\n')     // shorter, no boundary record
    await settle()
    expect(speech.spoken, 'a non-compaction rewrite was read aloud').toEqual([])
  })

  it('CONTROL: a transcript that ALREADY contains a boundary is not treated as compacting', async () => {
    // The count is compared against the previous read, not against zero. Without that, every read
    // of a transcript that has ever been compacted would clamp, and nothing would ever be spoken
    // again — an "always silent" pass that satisfies the first test for the wrong reason.
    const { root, worktree, file } = await scaffold()
    const speech = new FakeSpeech()
    const h = boot(root, new MemoryStore(), speech)
    h.toggle()
    h.onAgentStatus({ worktreeId: `r::${worktree}`, paneKey: 'p', state: 'done', receivedAt: 0 }, worktree)
    await settle(20)

    await writeFile(file, [boundary(), record(1)].join('\n') + '\n')
    await settle()
    speech.spoken.length = 0

    await appendFile(file, record(2) + '\n')
    await settle()
    expect(speech.spoken, 'a normal reply after an old compaction was swallowed').toEqual(['reply 2'])
  })
})
