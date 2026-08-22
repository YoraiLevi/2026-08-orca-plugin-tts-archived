import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, appendFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HuddleController, type HuddleStore } from './index.ts'

/**
 * M16 — gate G5: the surface shows who is in the room and who is talking, and one can be muted.
 *
 * The mute assertions are BY EFFECT: a muted session's words must never appear in what the speech
 * layer was handed. "The mute flag is set" is presence, not effect, and this project has found
 * that distinction to be the difference between a working control and a lie told to someone who
 * cannot see the screen (P30, and SC-9 where a player exiting 0 advanced `bytesPlayed` for audio
 * nobody heard).
 *
 * The expected values are built by the test from records it wrote itself — never read back out of
 * the controller and compared against itself (P36).
 */

class FakeSpeech {
  spoken: string[] = []
  labels: Array<string | undefined> = []
  speak (text: string, _mode?: string, label?: string): void {
    this.spoken.push(text); this.labels.push(label)
  }
  async stop (): Promise<void> {}
}

class MemoryStore implements HuddleStore {
  #m = new Map<string, unknown>()
  async get (k: string): Promise<unknown> { return this.#m.get(k) }
  async set (k: string, v: unknown): Promise<void> { this.#m.set(k, v) }
}

const record = (id: string, text: string): string =>
  JSON.stringify({ type: 'assistant', uuid: id, message: { content: [{ type: 'text', text }] } })

const settle = (ms = 260): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Two sessions in ONE worktree, so both are reachable by the same watcher. */
async function scaffoldTwo (): Promise<{ root: string; worktree: string; alpha: string; bravo: string }> {
  const root = await mkdtemp(join(tmpdir(), 'orca-tts-presence-'))
  const worktree = join(root, 'wt')
  const project = worktree.replace(/[/\\:]/g, '-')
  await mkdir(join(root, project), { recursive: true })
  const alpha = join(root, project, 'alpha.jsonl')
  const bravo = join(root, project, 'bravo.jsonl')
  await writeFile(bravo, ''); await writeFile(alpha, '')
  // Age bravo deliberately. Two transcripts whose mtimes are within 2 s are the AMBIGUOUS PAIR
  // (site 13 / TT5) and the scan refuses to guess which the listener meant — correctly. A test
  // that left them ambiguous would be measuring that guard rather than presence, and it did:
  // the first draft of this file spoke nothing at all and the control caught it.
  const old = Date.now() / 1000 - 600
  await utimes(bravo, old, old)
  return { root, worktree, alpha, bravo }
}

function boot (root: string, speech: FakeSpeech): HuddleController {
  return new HuddleController({
    speech, store: new MemoryStore(), projectsDir: root, log: () => {}, notify: () => {}
  })
}

describe('G5 — presence: who is in the room, who is talking, and mute', () => {
  it('a muted session\'s reply never reaches the audio stream', async () => {
    const { root, worktree, alpha } = await scaffoldTwo()
    const speech = new FakeSpeech()
    const h = boot(root, speech)
    h.toggle()
    h.onAgentStatus({ worktreeId: `r::${worktree}`, paneKey: 'p', state: 'done', receivedAt: 0 }, worktree)
    await settle(20)

    // CONTROL first: unmuted, the reply IS spoken. Without this the mute assertion below could
    // pass because nothing was ever spoken for an unrelated reason.
    await appendFile(alpha, record('a-1', 'audible one') + '\n')
    await settle()
    expect(speech.spoken, 'the control never spoke, so a silent mute proves nothing')
      .toContain('audible one')

    h.mute(alpha)
    await appendFile(alpha, record('a-2', 'must never be heard') + '\n')
    await settle()
    expect(speech.spoken, 'a muted session reached the audio stream')
      .not.toContain('must never be heard')

    h.unmute(alpha)
    await appendFile(alpha, record('a-3', 'audible again') + '\n')
    await settle()
    expect(speech.spoken, 'unmute did not resume speech').toContain('audible again')
    // And the muted reply is NOT replayed on unmute — that would be P22's whole-history dump
    // arriving by a new route.
    expect(speech.spoken, 'unmute replayed what the listener chose to miss')
      .not.toContain('must never be heard')
  })

  it('names who is in the room and who is talking, with the muted one still listed', async () => {
    const { root, worktree, alpha } = await scaffoldTwo()
    const speech = new FakeSpeech()
    const h = boot(root, speech)
    h.toggle()
    h.onAgentStatus({ worktreeId: `r::${worktree}`, paneKey: 'p', state: 'done', receivedAt: 0 }, worktree)
    await settle(20)

    await appendFile(alpha, record('a-1', 'first') + '\n')
    await settle()

    const p = h.presence()
    expect(p.inRoom.map((r) => r.file), 'the session that spoke is not in the room')
      .toContain(alpha)
    expect(p.talking, 'the speaking session is not reported as talking').toBe(alpha)

    // A muted agent is STILL in the room. Hiding it would make the mute unreviewable — the
    // listener could never find what to unmute.
    h.mute(alpha)
    const q = h.presence()
    expect(q.inRoom.find((r) => r.file === alpha)?.muted, 'a muted session vanished from the room')
      .toBe(true)
    expect(q.talking, 'a muted session is still reported as talking').toBeNull()
  })
})
