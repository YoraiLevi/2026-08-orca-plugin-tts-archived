import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import activate from './main.js'
import type { OrcaApi } from './adapter/index.js'
import type { AudioChunk, PlaybackSink, ProviderCapabilities, SynthesizeOptions, TtsProvider }
  from '@orca-tts/core'

/**
 * End-to-end reachability, P26's rule verbatim: drive the OUTERMOST object a caller constructs —
 * `activate(orca)`, exactly as ORCA calls it — and assert what the innermost consumer received.
 *
 * Unit tests that mock the layer under test are how `switchTo` shipped with zero callers and how
 * `voice`/`rate` shipped unsettable. Everything here goes through the real command registry, the
 * real SpeechService, the real normalizer and the real HuddleController.
 */
class RecordingProvider implements TtsProvider {
  id = 'fake'; displayName = 'Fake'
  synthesized: string[] = []
  /** Non-zero gives the queue real depth, so "the queue survived" can actually be observed. */
  delayMs = 0
  #warm = false
  capabilities: ProviderCapabilities = {
    streaming: true, offline: true, needsApiKey: false, needsModelDownload: 0,
    licence: 'test', cloning: false, sampleRate: 22050
  }
  get isWarm(): boolean { return this.#warm }
  async prepare(): Promise<void> { this.#warm = true }
  cancel(): void {}
  async listVoices(): Promise<readonly string[]> { return ['test'] }
  async *generate(text: string, _opts: SynthesizeOptions = {}): AsyncIterable<AudioChunk> {
    this.synthesized.push(text)
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs))
    yield { data: new Uint8Array([1]), format: 'wav', sampleRate: 22050, channels: 1 }
  }
}

class FakeSink implements PlaybackSink {
  isPlaying = false
  async enqueue(): Promise<void> {}
  async stop(): Promise<void> {}
}

interface Harness {
  readonly provider: RecordingProvider
  readonly commands: Map<string, (args?: unknown) => unknown>
  readonly events: Map<string, (payload: unknown) => void>
  readonly notifications: string[]
  readonly spoken: () => string
  run(id: string): Promise<void>
  /** Fire `agent.status.changed` the way ORCA does, for a worktree at `path`. */
  agentDone(path: string): void
}

const settle = async (ticks = 40): Promise<void> => {
  for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 5))
}

async function boot(projectsDir: string): Promise<Harness> {
  const provider = new RecordingProvider()
  const commands = new Map<string, (args?: unknown) => unknown>()
  const events = new Map<string, (payload: unknown) => void>()
  const notifications: string[] = []
  const orca: OrcaApi = {
    commands: { register: (id, fn) => { commands.set(id, fn) } },
    events: { on: (name, fn) => { events.set(name, fn) } },
    host: {
      call: async (action, params) => {
        if (action === 'notifications.show') notifications.push(String(params?.['body'] ?? ''))
        if (action === 'storage.get') return { value: undefined }
        return {}
      }
    },
    log: () => {}
  }
  activate(orca, { provider, sink: new FakeSink(), projectsDir, announceDelayMs: 5 })
  await settle(10)   // let registry.resolve() finish so `speech` exists
  return {
    provider, commands, events, notifications,
    spoken: () => provider.synthesized.join(' '),
    run: async (id) => {
      const fn = commands.get(id)
      if (fn === undefined) throw new Error(`command ${id} is not registered`)
      await fn()
    },
    agentDone: (path) => {
      const fn = events.get('agent.status.changed')
      if (fn === undefined) throw new Error('agent.status.changed was never subscribed')
      fn({ worktreeId: `repo::${path}`, paneKey: 'p:1', state: 'done', receivedAt: Date.now() })
    }
  }
}

/** A Claude-format transcript with `n` assistant replies, on disk where huddle will find it. */
async function writeTranscript(root: string, project: string, name: string, texts: string[]): Promise<string> {
  const dir = join(root, project)
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${name}.jsonl`)
  await writeFile(file, texts.map((text, i) => JSON.stringify({
    type: 'assistant', uuid: `${name}-${i}`, message: { content: [{ type: 'text', text }] }
  })).join('\n') + '\n')
  return file
}

/** Append more assistant records to an existing transcript, as the agent CLI does. */
async function appendReplies(file: string, name: string, texts: string[]): Promise<void> {
  const { appendFile } = await import('node:fs/promises')
  await appendFile(file, texts.map((text, i) => JSON.stringify({
    type: 'assistant', uuid: `${name}-append-${i}-${text.slice(0, 4)}`,
    message: { content: [{ type: 'text', text }] }
  })).join('\n') + '\n')
}

describe('every manifest command is actually registered', () => {
  it('the guard counts the manifest, not a number that drifted away from it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-tts-main-'))
    const h = await boot(root)
    const manifest = JSON.parse(
      await (await import('node:fs/promises')).readFile(
        new URL('../orca-plugin.json', import.meta.url), 'utf8')
    ) as { contributes: { commands: Array<{ id: string }> } }
    for (const c of manifest.contributes.commands) {
      expect(h.commands.has(c.id), `manifest declares ${c.id} and activate() never registers it`)
        .toBe(true)
    }
  })
})

/**
 * C5 — asking what is happening must not destroy what is happening.
 *
 * `read-aloud.status` exists to answer P22's *"this is really confusing what it is even reading"*.
 * It was wired to speak(..., 'replace'), which clears #pending at speech-service.ts:79 with no
 * onDropped call — so the answer deleted the subject of the question, silently, while announcing
 * "N more waiting" about the replies it had just removed. Same for the huddle toggle and unfollow.
 */
describe('C5 the status/toggle/unfollow controls do not delete the queue', () => {
  it('status answers the question AND every reply it counted is still spoken', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-tts-main-'))
    const worktree = join(root, 'wt')
    const project = worktree.replace(/[/\\:]/g, '-')
    const file = await writeTranscript(root, project, 'sess1', ['already heard, primed away'])
    const h = await boot(root)
    h.provider.delayMs = 150      // give the queue real depth; otherwise nothing is proved

    await h.run('read-aloud.toggle-huddle')
    h.agentDone(worktree)
    await settle(20)             // prime + watch established
    h.provider.synthesized.length = 0

    await appendReplies(file, 'sess1', [
      'alpha reply one here', 'bravo reply two here', 'charlie reply three here'
    ])
    await settle(70)             // past the 250 ms debounce: three replies are now queued
    expect(h.spoken(), 'nothing was queued, so the test proves nothing').toContain('alpha reply')
    expect(h.spoken(), 'the queue had already drained; no depth to destroy')
      .not.toContain('charlie reply')

    await h.run('read-aloud.status')
    await settle(160)

    const spoken = h.spoken()
    expect(spoken, 'status did not answer').toMatch(/Huddle mode is on|Now reading|more waiting/)
    // The point of the fix: the answer must not have deleted its own subject.
    for (const word of ['alpha reply', 'bravo reply', 'charlie reply']) {
      expect(spoken, `status destroyed the queued reply "${word}"`).toContain(word)
    }
  })

  it('unfollow announces without wiping what is already queued', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-tts-main-'))
    const worktree = join(root, 'wt')
    const project = worktree.replace(/[/\\:]/g, '-')
    const file = await writeTranscript(root, project, 'sess1', ['primed'])
    const h = await boot(root)
    h.provider.delayMs = 150

    await h.run('read-aloud.toggle-huddle')
    h.agentDone(worktree)
    await settle(20)
    h.provider.synthesized.length = 0
    await appendReplies(file, 'sess1', ['delta reply one', 'echo reply two', 'foxtrot reply three'])
    await settle(70)
    expect(h.spoken(), 'nothing was queued, so the test proves nothing').toContain('delta reply one')
    expect(h.spoken(), 'the queue had already drained; no depth to destroy')
      .not.toContain('foxtrot reply three')

    await h.run('read-aloud.unfollow')
    await settle(160)
    const spoken = h.spoken()
    expect(spoken).toContain('Stopped following that session')
    // Unfollow stops NEW replies arriving. Replies already queued are still replies the listener
    // was waiting for; Stop is the control for silence.
    expect(spoken, 'unfollow discarded replies the listener was waiting for').toContain('echo reply two')
    expect(spoken).toContain('foxtrot reply three')
  })
})

export { boot, settle, writeTranscript, appendReplies }
