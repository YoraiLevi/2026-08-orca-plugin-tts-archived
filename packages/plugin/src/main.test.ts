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
    // The test's own name promises it "counts the manifest". It did not: an empty command list
    // would have made the loop vacuous and the guard green while activate() registered nothing.
    expect(manifest.contributes.commands.length,
      'the manifest declares no commands, so this guard checked nothing').toBeGreaterThan(0)
    expect(h.commands.size, 'activate() registered nothing at all').toBeGreaterThan(0)
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

/** A Codex/Grok/omp-style transcript: a flat record with a role and a string body. */
async function writeGenericTranscript(root: string, project: string, name: string, texts: string[]): Promise<string> {
  const dir = join(root, project)
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${name}.jsonl`)
  await writeFile(file, texts.map((text, i) => JSON.stringify({
    role: 'assistant', id: `${name}-${i}`, content: text
  })).join('\n') + '\n')
  return file
}

/**
 * 006 section 20 finding 3 / DC1 — huddle silently served nothing to every non-Claude agent.
 *
 * `#readReplies` called `decodeClaudeLine` unconditionally, so a Codex record decoded to null on
 * every line and the plugin was completely mute while `panel.html` said the format was supported.
 * `decoderFor`, `decodeGenericLine` and `UNSUPPORTED_AGENTS` had zero non-test callers: P26's shape
 * on a new wire.
 */
describe('DC1 huddle reads non-Claude transcripts, or says it cannot', () => {
  it('a Codex transcript is spoken, through the real HuddleController', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-tts-main-'))
    const worktree = join(root, 'wt')
    const project = worktree.replace(/[/\\:]/g, '-')
    const file = await writeGenericTranscript(root, project, 'codexsess', ['primed already'])
    const h = await boot(root)

    await h.run('read-aloud.toggle-huddle')
    h.agentDone(worktree)
    await settle(20)
    h.provider.synthesized.length = 0

    const { appendFile } = await import('node:fs/promises')
    await appendFile(file, JSON.stringify({
      role: 'assistant', id: 'codexsess-new', content: 'the codex agent replied here'
    }) + '\n')
    await settle(90)

    expect(h.spoken(), 'a Codex reply produced silence').toContain('the codex agent replied here')
  })

  it('CONTROL: the Claude decoder finds nothing in that same file, so the test above can fail', async () => {
    // Verify by effect needs a case that proves the assertion is capable of failing. This is the
    // pre-fix behaviour, asserted directly against the decoder that used to be hardcoded.
    const { decodeClaudeLine, decodeGenericLine, detectTranscriptFormat } =
      await import('./huddle/decoders.js')
    const line = JSON.stringify({ role: 'assistant', id: 'x', content: 'the codex agent replied here' })
    expect(decodeClaudeLine(line), 'the wrong decoder silently returns null — this is DC1')
      .toBeNull()
    expect(decodeGenericLine(line)?.text).toBe('the codex agent replied here')
    expect(detectTranscriptFormat(line)).toBe('generic')
  })

  it('an undecodable transcript is announced ALOUD, once, rather than producing silence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-tts-main-'))
    const worktree = join(root, 'wt')
    const project = worktree.replace(/[/\\:]/g, '-')
    const dir = join(root, project)
    await mkdir(dir, { recursive: true })
    // A shape no decoder we ship understands.
    const file = join(dir, 'gemini.jsonl')
    await writeFile(file, JSON.stringify({ kind: 'turn', parts: [{ blob: 'x' }] }) + '\n')

    const h = await boot(root)
    await h.run('read-aloud.toggle-huddle')
    h.agentDone(worktree)
    await settle(90)

    const spoken = h.spoken()
    expect(spoken, 'huddle went silent instead of saying it could not read the file')
      .toMatch(/cannot read/i)
    // UNSUPPORTED_AGENTS finally has a caller: the sentence names the tool, not just the format.
    expect(spoken).toContain('gemini')
    // Once per session, not once per file change.
    expect(spoken.match(/cannot read/gi)?.length).toBe(1)
  })
})

/**
 * 006 TT6 / P26 — `switchTo` was implemented, commented, and unreachable.
 *
 * It implements P22's recorded remedy ("announce switches aloud") and had exactly one grep hit in
 * the whole source tree: its own declaration. The manifest had `unfollow` and no counterpart, so
 * the only way back to a session was to wait for the next agent event to silently re-pick whatever
 * was touched last. An unreachable implementation reads to the next agent as a shipped feature.
 *
 * This is a reachability test in P26's exact shape: the outermost object a caller constructs
 * (`activate(orca)`, as ORCA calls it) driven through a real registered command, asserting what
 * the innermost consumer — the synthesizer — was actually handed.
 */
describe('TT6 read-aloud.follow reaches switchTo end to end', () => {
  it('announces the session it switched to, in the audio stream', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-tts-main-'))
    const worktree = join(root, 'wt')
    const project = worktree.replace(/[/\\:]/g, '-')
    await writeTranscript(root, project, 'sessionalpha', ['some earlier reply'])
    const h = await boot(root)

    await h.run('read-aloud.toggle-huddle')
    h.agentDone(worktree)            // gives the controller a worktree to resolve against
    await settle(20)
    h.provider.synthesized.length = 0

    await h.run('read-aloud.follow')
    await settle(40)

    const spoken = h.spoken()
    expect(spoken, 'the switch was never announced aloud').toMatch(/Now reading from/i)
    // sessionLabel() names the session, so the listener learns WHOSE words are coming.
    // (Deliberately an alphabetic id here: a real session id is hex, and `expandNumbers` turns
    // "abcdef12" into "abcdeftwelve". That is a live audible defect, unrelated to this fix, and
    // it belongs to Voice Lab and to HANDOFF's standing rule "never speak hex".)
    expect(spoken).toContain('sessiona')
  })

  it('says so when there is nothing to follow, rather than doing nothing', async () => {
    // The control case: an empty projects root must produce a DIFFERENT sentence, so the assertion
    // above is shown to distinguish outcomes rather than matching whatever was said.
    const root = await mkdtemp(join(tmpdir(), 'orca-tts-main-'))
    const h = await boot(root)
    await h.run('read-aloud.follow')
    await settle(40)
    const spoken = h.spoken()
    expect(spoken).toMatch(/No agent transcript to follow/i)
    expect(spoken).not.toMatch(/Now reading from/i)
  })
})

/**
 * 006 sites 45/46/54 end to end: when no engine resolves, the plugin used to report
 * "no speech engine is available on this system" — one sentence for six causes, and
 * `registry.lastFailure` was `null` for most of them.
 *
 * Outcome chosen: **make it distinguishable**, not spoken. There is no engine to speak with, which
 * is the one announcement this project has already recorded as unspeakable (round 4). What was
 * fixable is that the report now names WHICH failure it is, so the notification, the log and any
 * future bug report all carry an actionable cause instead of a shrug.
 */
describe('006 sites 45/46 — total engine failure reports a named cause', () => {
  it('names the engine and the thrown reason, not just "no speech engine is available"', async () => {
    class BrokenProvider extends RecordingProvider {
      override async prepare(): Promise<void> {
        throw new Error('say could not be spawned: ENOENT')
      }
    }
    const notifications: string[] = []
    const orca: OrcaApi = {
      commands: { register: () => {} },
      events: { on: () => {} },
      host: {
        call: async (action, params) => {
          if (action === 'notifications.show') notifications.push(String(params?.['body'] ?? ''))
          return { value: undefined }
        }
      },
      log: () => {}
    }
    activate(orca, { provider: new BrokenProvider(), sink: new FakeSink(), projectsDir: '/nonexistent' })
    await settle(10)
    const engineReport = notifications.find((n) => n.includes('no speech engine'))
    expect(engineReport, 'total engine failure was not reported at all').toBeDefined()
    expect(String(engineReport), 'the cause is what a user or a bug report can act on')
      .toContain('say could not be spawned')
    expect(String(engineReport), 'which KIND of failure this is must survive to the report')
      .toContain('prepare-failed')
  })
})
