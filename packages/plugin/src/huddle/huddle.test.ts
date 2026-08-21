import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HuddleController, MAX_REMEMBERED_IDS, type HuddleStore } from './index.js'

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
