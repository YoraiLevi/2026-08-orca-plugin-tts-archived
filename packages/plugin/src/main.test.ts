import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import activate from './main.ts'
import type { OrcaApi } from './adapter/index.ts'
import type { AudioChunk, PlaybackSink, ProviderCapabilities, SynthesizeOptions, TtsProvider }
  from '@orca-tts/core'
import {
  readDashboardDocument, renderDashboard, sendControl, type DashboardDocument
} from './control/dashboard.ts'

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
  cancelled = 0
  /**
   * A gate the test OPENS, in place of a delay the test HOPES is long enough.
   *
   * `delayMs` arranged queue depth by out-running the drain: 150 ms per utterance against a
   * `settle()` of nominally 350 ms. Under load a `setTimeout(5)` is not 5 ms, `settle()` spends
   * seconds of wall clock, the queue drains before the control is invoked, and the test fails
   * with its own message — "the queue had already drained; no depth to destroy" — for a reason
   * that has nothing to do with the code it guards. Measured here: 8 of 10 runs at load average
   * ~32.
   *
   * `#drain()` awaits `#speakOne()`, which awaits this generator. So blocking here stops the
   * drain at utterance one and leaves every later utterance in `#pending`, for as long as the
   * test wants and no longer. The precondition becomes a fact the test established rather than a
   * race it won.
   */
  #gate: Promise<void> | null = null
  #openGate: (() => void) | null = null
  /** Hold the drain at the NEXT utterance to enter the engine. */
  hold(): void {
    if (this.#gate !== null) return
    this.#gate = new Promise<void>((resolve) => { this.#openGate = resolve })
  }
  /** Let it go. Idempotent, so a test may release without knowing whether it held. */
  release(): void {
    const open = this.#openGate
    this.#gate = null
    this.#openGate = null
    open?.()
  }
  #warm = false
  capabilities: ProviderCapabilities = {
    streaming: true, offline: true, needsApiKey: false, needsModelDownload: 0,
    licence: 'test', cloning: false, sampleRate: 22050
  }
  get isWarm(): boolean { return this.#warm }
  async prepare(): Promise<void> { this.#warm = true }
  cancel(): void { this.cancelled++ }
  async listVoices(): Promise<readonly string[]> { return ['test'] }
  async *generate(text: string, _opts: SynthesizeOptions = {}): AsyncIterable<AudioChunk> {
    // Recorded BEFORE the gate: "this utterance reached the engine" is what the test waits on,
    // and it must be observable while the engine is still holding it.
    this.synthesized.push(text)
    if (this.#gate !== null) await this.#gate
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs))
    yield { data: new Uint8Array([1]), format: 'wav', sampleRate: 22050, channels: 1 }
  }
}

class FakeSink implements PlaybackSink {
  isPlaying = false
  stops = 0
  async enqueue(): Promise<void> {}
  async stop(): Promise<void> { this.stops++ }
}

interface Harness {
  readonly provider: RecordingProvider
  readonly sink: FakeSink
  readonly commands: Map<string, (args?: unknown) => unknown>
  readonly events: Map<string, (payload: unknown) => void>
  readonly notifications: string[]
  /** Everything the plugin logged, so readiness can be OBSERVED rather than waited out. */
  readonly logs: string[]
  readonly spoken: () => string
  run(id: string): Promise<void>
  /** Fire `agent.status.changed` the way ORCA does, for a worktree at `path`. */
  agentDone(path: string): void
}

const settle = async (ticks = 40): Promise<void> => {
  for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 5))
}

/**
 * Wait for a CONDITION to become true, not for a duration to elapse.
 *
 * `settle(n)` is n scheduler turns of hope. It is safe when the thing waited for is bounded by a
 * gate the test holds (waiting longer than needed costs only time), and unsound when it is racing
 * the system (waiting less than needed is a red for no reason). Every `until()` below is paired
 * with `provider.hold()`, so the condition cannot be satisfied early and cannot be missed late.
 *
 * `capMs` is a BACKSTOP, not a budget: it fires only when the condition will never be true, and
 * it is deliberately far larger than any plausible slow-machine figure so that load alone can
 * never reach it. If it ever does fire, the message names the condition rather than a duration.
 */
const until = async (
  predicate: () => boolean, what: string, capMs = 30_000
): Promise<void> => {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > capMs) {
      throw new Error(`gave up waiting for: ${what} (${capMs} ms backstop — this is a HANG, not slowness)`)
    }
    await new Promise((r) => setTimeout(r, 2))
  }
}

const untilValue = async <T>(read: () => Promise<T | null>, what: string): Promise<T> => {
  const started = Date.now()
  for (;;) {
    const value = await read()
    if (value !== null) return value
    if (Date.now() - started > 30_000) {
      throw new Error(`gave up waiting for: ${what} (30000 ms backstop — this is a HANG, not slowness)`)
    }
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

/**
 * Huddle is watching the transcript and has marked the backlog as already-spoken.
 *
 * The `read-aloud: watching <file>` log line is emitted by HuddleController only after
 * `#readReplies` has primed `#spoken` and `fs.watch` has been established — so it is the effect,
 * not a proxy for it. `settle(20)` was the proxy, and on a quiet machine it could also be too
 * SHORT.
 */
const watching = async (h: Harness): Promise<void> =>
  until(() => h.logs.some((l) => l.startsWith('read-aloud: watching ')),
    'huddle to prime the transcript and establish its watch')

/**
 * `settingsDir` defaults to a directory inside the test's own temp root that does not exist.
 *
 * Without it, every `boot()` in this file would read the AUTHOR'S real settings inbox out of
 * `~/Library/Application Support/orca-tts/` — so the spoken-text assertions below would depend on
 * how they last tuned the plugin by ear and would change under them with no commit. That is P40's
 * shape aimed at the one file M12 exists to read. Tests that WANT a settings file pass their own
 * directory.
 */
async function boot(projectsDir: string, settingsDir?: string, controlDir?: string | false): Promise<Harness> {
  const provider = new RecordingProvider()
  const sink = new FakeSink()
  const commands = new Map<string, (args?: unknown) => unknown>()
  const events = new Map<string, (payload: unknown) => void>()
  const notifications: string[] = []
  const logs: string[] = []
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
    log: (m: string) => { logs.push(m) }
  }
  activate(orca, {
    provider, sink, projectsDir, announceDelayMs: 5,
    settingsDir: settingsDir ?? join(projectsDir, 'no-settings-inbox-here'),
    controlDir: controlDir ?? false,
    // Same reason as `settingsDir` above, one directory over: the default is a real
    // `PocketSynthProvider`, which would stat the AUTHOR'S model cache. Whether these assertions
    // ran against a machine with neural weights on it would then depend on what he downloaded
    // last (P40), and no test may read his install (R061). R16-10's own tests pass a fake.
    pocket: false
  })
  await settle(10)   // let registry.resolve() finish so `speech` exists
  return {
    provider, sink, commands, events, notifications, logs,
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

    await h.run('read-aloud.toggle-huddle')
    h.agentDone(worktree)
    await watching(h)
    await until(() => h.spoken().includes('Huddle mode'), 'the huddle-on announcement to be spoken')
    h.provider.synthesized.length = 0

    // Hold the engine on the FIRST reply. Everything behind it stays in `#pending` until this
    // test says otherwise, so "the queue has depth when the control is invoked" is established,
    // not raced.
    h.provider.hold()
    await appendReplies(file, 'sess1', [
      'alpha reply one here', 'bravo reply two here', 'charlie reply three here'
    ])
    await until(() => h.spoken().includes('alpha reply'),
      'the first reply to reach the engine (past the 250 ms debounce)')
    expect(h.spoken(), 'the queue had already drained; no depth to destroy')
      .not.toContain('charlie reply')

    // THE MOMENT UNDER TEST: two replies are provably still queued, right now.
    await h.run('read-aloud.status')

    h.provider.release()
    await until(() => h.spoken().includes('more waiting') || h.spoken().includes('Huddle mode is on'),
      'status to be spoken')
    await settle(60)   // let anything status queued behind it drain too
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

    await h.run('read-aloud.toggle-huddle')
    h.agentDone(worktree)
    await watching(h)
    await until(() => h.spoken().includes('Huddle mode'), 'the huddle-on announcement to be spoken')
    h.provider.synthesized.length = 0

    h.provider.hold()   // depth established by a gate, not by out-running the drain
    await appendReplies(file, 'sess1', ['delta reply one', 'echo reply two', 'foxtrot reply three'])
    await until(() => h.spoken().includes('delta reply one'),
      'the first reply to reach the engine (past the 250 ms debounce)')
    expect(h.spoken(), 'the queue had already drained; no depth to destroy')
      .not.toContain('foxtrot reply three')

    await h.run('read-aloud.unfollow')

    h.provider.release()
    await until(() => h.spoken().includes('Stopped following that session'),
      'the unfollow announcement to be spoken')
    await settle(60)
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
      await import('./huddle/decoders.ts')
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
    activate(orca, {
      provider: new BrokenProvider(), sink: new FakeSink(), projectsDir: '/nonexistent',
      controlDir: false, pocket: false
    })
    await settle(10)
    const engineReport = notifications.find((n) => n.includes('no speech engine'))
    expect(engineReport, 'total engine failure was not reported at all').toBeDefined()
    expect(String(engineReport), 'the cause is what a user or a bug report can act on')
      .toContain('say could not be spawned')
    expect(String(engineReport), 'which KIND of failure this is must survive to the report')
      .toContain('prepare-failed')
  })
})

/**
 * 006 section 19, rank 1 — "that the plugin is mute", the worst state this system can be in.
 *
 * Chosen as the one undetectable item closable with instrumentation rather than architecture.
 * Every existing diagnostic reports healthy while mute: `prepare()` said warm, the registry said
 * `preferred`, the log said "engine ready", `isPlaying` said false because nothing was playing.
 * The self-test reports numbers that came from THIS invocation, so it cannot report healthy on a
 * dead engine — and it synthesizes fresh rather than replaying a stored WAV, which would pass
 * while synthesis is dead.
 */
describe('006 section 19 rank 1 — the listener can ask whether the voice actually works', () => {
  class SilentProvider extends RecordingProvider {
    // Yielding NOTHING is the condition under test: a provider that reports success and produces
    // no audio is the mute-plugin state 006 rank 1 exists to detect. Adding a yield here would
    // delete the defect this test is looking for, so the rule is suppressed rather than satisfied.
    // eslint-disable-next-line require-yield
    override async *generate(text: string): AsyncIterable<AudioChunk> {
      this.synthesized.push(text)   // pretends to work, yields nothing — the mute-plugin state
    }
  }

  it('says the engine produced no audio, instead of reporting healthy', async () => {
    const provider = new SilentProvider()
    const notifications: string[] = []
    const orca: OrcaApi = {
      commands: { register: (id, fn) => { commands.set(id, fn) } },
      events: { on: () => {} },
      host: {
        call: async (action, params) => {
          if (action === 'notifications.show') notifications.push(String(params?.['body'] ?? ''))
          return { value: undefined }
        }
      },
      log: () => {}
    }
    const commands = new Map<string, (args?: unknown) => unknown>()
    activate(orca, {
      provider, sink: new FakeSink(), projectsDir: '/nonexistent', controlDir: false, pocket: false
    })
    await settle(10)
    await commands.get('read-aloud.self-test')?.()
    await settle(20)
    // The verdict must reach the AUDIO stream, so assert on what the provider was handed to speak.
    const spoken = provider.synthesized.join(' ')
    expect(spoken, 'a mute engine reported nothing at all').toMatch(/self test failed/i)
    expect(spoken).toMatch(/no audio/i)
  })

  it('CONTROL: a working engine passes, and the verdict names the byte count', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-tts-selftest-'))
    const h = await boot(root)
    await h.run('read-aloud.self-test')
    await settle(20)
    const spoken = h.spoken()
    expect(spoken, 'a working engine must not be reported as broken').toMatch(/self test passed/i)
    // The number is the point: a verdict with no measurement is the presence check this replaces.
    expect(spoken, 'the verdict must carry a value that moved').toMatch(/\d|one|two|three|four|five|six|seven|eight|nine/i)
  })
})

/**
 * A control that was pressed must answer in the AUDIO STREAM.
 *
 * 006 section 19 rank 4 — "whether a control fired". A plugin keybinding is inert in terminal
 * focus and a plugin cannot query host keybindings (P19), so a dead chord and a working chord are
 * the same absence of sound. Three "nothing happened" answers still terminated in
 * `notifications.show`: an empty clipboard, a clipboard that could not be read, and "no agent
 * reply yet". For a listener who does not read the tray, pressing the key and pressing nothing
 * were identical.
 *
 * Asserted on WHAT WOULD BE SPOKEN, from a fake provider that records strings (P31).
 */
describe('006 rank 4 — a pressed control always answers in the audio stream', () => {
  it('speaks "no agent reply yet" instead of only notifying', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-tts-noreply-'))
    const h = await boot(root)
    await h.run('read-aloud.speak-last-reply')
    await settle()
    expect(h.spoken(), 'the listener pressed a key and must hear an answer, not silence')
      .toMatch(/no agent reply to read yet/i)
  })
})

/**
 * The wire, not the unit. Nothing asserted that `activate()` actually PASSES `resolveLabel` to the
 * speech service — every provenance test in round 7 injects its own, so the host could stop wiring
 * it and all of them would stay green while provenance silently stopped being checked. That is
 * P26's shape on the wire round 7 just added, and P26's rule is the fix: drive the OUTERMOST
 * object, assert what the innermost consumer received.
 */
describe('006 rank 3 — provenance is wired end to end, not only unit-tested', () => {
  it('a session whose transcript is gone is named when its queued reply is spoken', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-tts-prov-'))
    const worktree = join(root, 'wt')
    const project = worktree.replace(/[/\\:]/g, '-')
    const file = await writeTranscript(root, project, 'sess1', ['already heard, primed away'])
    const h = await boot(root)
    await h.run('read-aloud.toggle-huddle')
    h.agentDone(worktree)
    await watching(h)                 // prime + watch established, observed not waited out
    await until(() => h.spoken().includes('Huddle mode'), 'the huddle-on announcement to be spoken')
    h.provider.synthesized.length = 0

    // Same gate, same reason as C5: `delayMs = 200` was a bet that four utterances take longer to
    // drain than `settle(70)` takes to return, and under load that bet loses.
    h.provider.hold()
    await appendReplies(file, 'sess1', [
      'alpha reply one here', 'bravo reply two here', 'charlie reply three here',
      'delta reply four here'
    ])
    await until(() => h.spoken().includes('alpha reply'),
      'the first reply to reach the engine (past the 250 ms debounce)')
    expect(h.spoken(), 'the queue drained already — there was no pending reply to re-check')
      .not.toContain('delta reply')

    // The session ends while its later replies are still waiting to be spoken. That is C1's
    // sequence, and until this round nothing in the system could notice it happened.
    await (await import('node:fs/promises')).rm(file)
    h.provider.release()
    await until(() => h.spoken().includes('delta reply'),
      'the last queued reply to reach the listener despite its session having ended')

    expect(h.spoken(), 'the queued reply must still reach the listener').toContain('delta reply')
    expect(h.spoken(), 'activate() never wired resolveLabel, so provenance is never re-checked')
      .toMatch(/has since ended/)
  })
})

/**
 * M13 G2 — the terminal TUI is the live surface because ORCA's panel is read-blind, while the
 * control socket is pushed because polling cannot meet Stop's budget (003 sections 2 and 4).
 *
 * One end-to-end oracle covers the gate as one user experience: the worker tails a real transcript,
 * SpeechService holds a real queue, the state crosses the real atomic file, the real renderer names
 * it, and Stop crosses the real socket back into the service. Expected label and depth are rebuilt
 * from values chosen by this test — never read back from the surface under test.
 */
describe('G2 terminal dashboard and control channel', () => {
  /**
   * 30 s, and this is a HANG DETECTOR rather than a race budget — the distinction the other
   * timeout decisions in this repo turn on.
   *
   * Every wait inside is `until(...)`, a CONDITION, so a slower machine simply arrives later and
   * nothing is being out-run. What blew the 5 s default is vitest's wrapper, on the one platform
   * where `fs.watch` is measurably different: SC-15 measured darwin emitting ["change","rename"],
   * linux ["change","change","rename","rename"], and win32 keeping the watch ALIVE across an
   * atomic replace (CI run 32505473403).
   *
   * Windows could not be measured locally — there is no Windows host here — so this is `[claimed]`
   * as a bound, not `[measured-here]`. If it ever fires, that is a hang and it should be read as
   * one, not raised again.
   *
   * 45 s, NOT 30 s, and the gap is the whole point. `until`/`untilValue` carry their own 30 s
   * backstop that throws NAMING the stuck condition. Setting the test budget to 30 s as well made
   * vitest's anonymous kill win the race every time, so three CI runs reported "Test timed out in
   * 30000 ms" and never said which wait was stuck (runs 32550849182, 32552002823). A diagnostic
   * that loses to the timeout it exists to explain is not a diagnostic.
   */
  it('names the independently-created session and queue depth, then Stop reaches the plugin by effect', { timeout: 45_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-tts-g2-'))
    const worktree = join(root, 'dashboard-worktree')
    const project = worktree.replace(/[/\\:]/g, '-')
    const sessionName = 'sessionalpha'
    const file = await writeTranscript(root, project, sessionName, ['primed already'])
    const controlDir = join(root, 'control')
    const h = await boot(root, undefined, controlDir)

    await h.run('read-aloud.toggle-huddle')
    h.agentDone(worktree)
    await watching(h)
    await until(() => h.spoken().includes('Huddle mode'), 'the huddle-on announcement to be spoken')
    h.provider.synthesized.length = 0

    h.provider.hold()
    await appendReplies(file, sessionName, [
      'alpha reply is being read', 'bravo reply is queued', 'charlie reply is queued'
    ])
    await until(() => h.spoken().includes('alpha reply'), 'the first reply to reach the held provider')

    const document = await untilValue<DashboardDocument>(async () => {
      const candidate = await readDashboardDocument(controlDir).catch(() => null)
      return candidate?.status.nowReading !== null && candidate?.status.queueDepth === 2
        ? candidate
        : null
    }, 'the dashboard to publish the held reply and two queued replies')

    // Independent oracle: the expected label is rebuilt from the path and session name the TEST
    // chose. It does not read any label or queue value back from the dashboard implementation.
    const expectedProject = project.replace(/^-+/, '').split('-').slice(-3).join(' ')
    const expectedLabel = `${expectedProject}, session ${sessionName.slice(0, 8)}`
    const rendered = renderDashboard(document.status)
    expect(rendered).toContain(`NOW READING  ${expectedLabel}`)
    expect(rendered).toContain('QUEUE  2 waiting')
    expect(rendered).toContain(`1. ${expectedLabel}`)
    expect(rendered).toContain(`2. ${expectedLabel}`)

    const cancelledBefore = h.provider.cancelled
    const stoppedBefore = h.sink.stops
    const response = await sendControl(document, 'stop')
    expect(response).toEqual({ ok: true, code: 'stopped' })
    expect(h.provider.cancelled, 'Stop was acknowledged but synthesis was not cancelled')
      .toBeGreaterThan(cancelledBefore)
    expect(h.sink.stops, 'Stop was acknowledged but buffered playback was not flushed')
      .toBeGreaterThan(stoppedBefore)
    await untilValue(async () => {
      const after = await readDashboardDocument(controlDir).catch(() => null)
      return after?.status.nowReading === null && after?.status.queueDepth === 0 ? after : null
    }, 'the effect of Stop to clear the rendered speech state')

    h.provider.release()
  })
})

/**
 * R16-10 — the shipped plugin had no neural backend in it at all.
 *
 * `main.ts` registered `OsSynthProvider` and nothing else, so esbuild tree-shook
 * `PocketSynthProvider` out of `dist/plugin/main.mjs` completely. Measured on the artifact ORCA
 * actually loads:
 *
 *   grep -c PocketSynthProvider dist/plugin/main.mjs   ->  0
 *
 * Meanwhile 975 tests passed, the Voice Lab spoke with neural voices, and `specs/003-pocket-voices`
 * read as delivered. Every Pocket test drove the provider directly or through the Lab's own
 * server; none asked whether the PLUGIN reaches it. R16-01 was this same defect one layer down --
 * "the delivery path had no production caller" -- and that repair did not go far enough up.
 *
 * Wiring is checked here by effect. The BUNDLE is guarded in `scripts/build.mjs` by importing
 * the artifact and demanding `prepare()` ran — a substring search is how R17-02 kept a log
 * string and deleted the class. Tree-shaking is still what did the original damage (P49).
 */
describe('R16-10 the plugin registers the neural backend beside the OS floor', () => {
  /** Unavailable on purpose: the interesting case is a machine with no weights, which is most. */
  function fakePocket(): TtsProvider & { prepared: number } {
    return {
      id: 'pocket',
      displayName: 'Pocket TTS',
      prepared: 0,
      isWarm: false,
      capabilities: { canPause: false, canChangeRateLive: false, canQueue: true, offline: true },
      async prepare(): Promise<void> {
        ;(this as { prepared: number }).prepared++
        throw new Error('no model on this machine')
      },
      // eslint-disable-next-line require-yield
      async *generate(): AsyncIterable<AudioChunk> { throw new Error('unreachable') },
      cancel(): void { /* nothing to cancel */ }
    } as unknown as TtsProvider & { prepared: number }
  }

  /**
   * An OS floor that cannot start. That is the ONLY way registration is observable from outside:
   * `registry.resolve()` walks the ladder and stops at the first provider that prepares, so while
   * the OS voice works -- which is the normal case, and the correct behaviour -- Pocket is never
   * touched. Making the floor fail forces the walk to continue, and whether it reaches Pocket is
   * exactly the question R16-10 asks.
   */
  function unusableOs(): TtsProvider {
    return {
      id: 'os', displayName: 'System voice', isWarm: false,
      capabilities: { canPause: false, canChangeRateLive: false, canQueue: true, offline: true },
      prepare: async () => { throw new Error('no system synthesizer on this machine') },
      // eslint-disable-next-line require-yield
      generate: async function *(): AsyncIterable<AudioChunk> { throw new Error('unreachable') },
      cancel: () => { /* nothing */ }
    } as unknown as TtsProvider
  }

  function usable(id: string, displayName: string): TtsProvider & { prepared: number } {
    return {
      id, displayName, prepared: 0, isWarm: false,
      capabilities: { canPause: false, canChangeRateLive: false, canQueue: true, offline: true },
      async prepare(): Promise<void> {
        ;(this as { prepared: number }).prepared++
      },
      async listVoices(): Promise<readonly string[]> { return [] },
      // eslint-disable-next-line require-yield
      async *generate(): AsyncIterable<AudioChunk> { throw new Error('unreachable') },
      cancel(): void { /* nothing to cancel */ }
    } as unknown as TtsProvider & { prepared: number }
  }

  function bootWith(
    pocket: TtsProvider | false | undefined,
    opts: { provider?: TtsProvider, logs?: string[] } = {}
  ): { pocket: TtsProvider | false | undefined, logs: string[] } {
    const logs = opts.logs ?? []
    const orca: OrcaApi = {
      commands: { register: () => { /* ignored */ } },
      events: { on: () => { /* ignored */ } },
      host: {
        call: async (action) => (action === 'storage.get' ? { value: undefined } : {})
      },
      log: (m: string) => { logs.push(m) }
    }
    const pocketOpt = pocket === undefined ? {} : { pocket }
    activate(orca, {
      provider: opts.provider ?? unusableOs(), sink: new FakeSink(),
      projectsDir: '/nonexistent', settingsDir: '/nonexistent/settings',
      controlDir: false, ...pocketOpt
    })
    return { pocket, logs }
  }

  it('registers Pocket, so the registry actually consults it', async () => {
    const pocket = fakePocket()
    bootWith(pocket)
    await settle(20)
    expect(pocket.prepared,
      'the registry never consulted Pocket, so the plugin did not register it at all')
      .toBeGreaterThan(0)
  })

  it('CONTROL: pocket:false removes it, so the assertion above can fail', async () => {
    const pocket = fakePocket()
    bootWith(false)
    await settle(20)
    expect(pocket.prepared, 'the probe reports registration for a provider never passed in')
      .toBe(0)
  })

  /**
   * R17-02: the two tests above inject a fake, so `options.pocket ?? new PocketSynthProvider()`
   * never ran. Round 17 deleted that constructor, logged the name, and this file stayed 2/2
   * green. Omitting `pocket` is the production default.
   *
   * Isolated empty cache (R061): we assert the registry CONSULTED pocket (prepare was
   * invoked and named in the failure), not that neural audio came back.
   */
  it('R17-02: production default constructs Pocket and the registry consults it', async () => {
    const modelDir = await mkdtemp(join(tmpdir(), 'orca-tts-r17-pocket-cache-'))
    const prev = process.env.ORCA_TTS_MODEL_DIR
    process.env.ORCA_TTS_MODEL_DIR = modelDir
    const logs: string[] = []
    try {
      bootWith(undefined, { logs })
      await until(
        () => logs.some((l) => l.includes('no speech engine is available') || l.includes('engine ready (')),
        'engine resolution to name pocket or become ready'
      )
      expect(logs.join('\n'),
        'production constructor never ran — registry failure does not name pocket:')
        .toMatch(/pocket:/)
    } finally {
      if (prev === undefined) delete process.env.ORCA_TTS_MODEL_DIR
      else process.env.ORCA_TTS_MODEL_DIR = prev
    }
  })

  it('CONTROL: pocket:false drops pocket: from the failure, so the assertion above can fail', async () => {
    const logs: string[] = []
    bootWith(false, { logs })
    await until(
      () => logs.some((l) => l.includes('no speech engine is available') || l.includes('engine ready (')),
      'engine resolution to finish without pocket'
    )
    expect(logs.join('\n'), 'pocket:false still named pocket in the failure')
      .not.toMatch(/pocket:/)
    expect(logs.join('\n')).toMatch(/no speech engine is available/)
  })

  /**
   * Default `synthesize.engine` is `auto`: Pocket if it can prepare, else the OS floor.
   * Both backends here prepare, so auto must select Pocket on the production resolve path
   * — the thing `probe:artifact`'s PRESENT arm watches. If this logs System voice at
   * preferred, `registry.resolve()` was called with no id again.
   */
  it('auto selects Pocket when it can prepare, so the model dir is consulted', async () => {
    const os = usable('os-synth', 'System voice')
    const pocket = usable('pocket', 'Pocket TTS')
    const logs: string[] = []
    bootWith(pocket, { provider: os, logs })
    await until(
      () => logs.some((l) => l.includes('engine ready (') || l.includes('no speech engine is available')),
      'engine ready on the auto-selected neural backend'
    )
    expect(logs.join('\n'),
      'auto did not select Pocket — registry.resolve() was called without the engine setting')
      .toMatch(/engine ready \(Pocket TTS, rung=preferred\)/)
    expect(pocket.prepared, 'auto never asked Pocket to prepare').toBeGreaterThan(0)
  })

  it('auto NAMEs the substitution when Pocket cannot prepare — the ABSENT arm', async () => {
    const os = usable('os-synth', 'System voice')
    const pocket = fakePocket()
    const logs: string[] = []
    bootWith(pocket, { provider: os, logs })
    await until(
      () => logs.some((l) => l.includes('engine ready (') || l.includes('no speech engine is available')),
      'engine ready on the OS floor after Pocket failed'
    )
    expect(logs.join('\n'),
      'auto fell back to the OS floor without naming the substitution')
      .toMatch(/was unavailable/)
    expect(logs.join('\n')).toMatch(/using System voice/)
    expect(os.prepared, 'OS floor never prepared after Pocket failed').toBeGreaterThan(0)
  })

  it('engine os keeps the system voice even when Pocket can prepare', async () => {
    const os = usable('os-synth', 'System voice')
    const pocket = usable('pocket', 'Pocket TTS')
    const osGenerated: string[] = []
    const pocketGenerated: string[] = []
    os.generate = async function * (text: string): AsyncIterable<AudioChunk> {
      osGenerated.push(text)
      yield { data: new Uint8Array([1, 2, 3, 4]), format: 'wav', sampleRate: 22050, channels: 1 }
    }
    pocket.generate = async function * (text: string): AsyncIterable<AudioChunk> {
      pocketGenerated.push(text)
      yield { data: new Uint8Array([1, 2, 3, 4]), format: 'wav', sampleRate: 24000, channels: 1 }
    }
    const logs: string[] = []
    const commands = new Map<string, (args?: unknown) => unknown>()
    const root = await mkdtemp(join(tmpdir(), 'orca-tts-engine-os-'))
    const settingsDir = join(root, 'settings')
    await mkdir(settingsDir)
    await writeFile(join(settingsDir, 'settings.jsonc'), JSON.stringify({
      kind: 'orca-tts-settings',
      schemaVersion: 2,
      revision: 1,
      settings: { 'synthesize.engine': 'os' }
    }))
    const orca: OrcaApi = {
      commands: { register: (id, fn) => { commands.set(id, fn) } },
      events: { on: () => { /* ignored */ } },
      host: {
        call: async (action) => (action === 'storage.get' ? { value: undefined } : {})
      },
      log: (m: string) => { logs.push(m) }
    }
    activate(orca, {
      provider: os, pocket, sink: new FakeSink(),
      projectsDir: join(root, 'projects'), settingsDir, controlDir: false
    })
    await until(
      () => logs.some((l) => l.startsWith('read-aloud: settings loaded from ')),
      'settings file with engine=os to be adopted'
    )
    await until(
      () => logs.some((l) => l.includes('engine ready (') || l.includes('no speech engine is available')),
      'engine ready'
    )
    const selfTest = commands.get('read-aloud.self-test')
    expect(selfTest, 'self-test was never registered').toBeTypeOf('function')
    await selfTest!()
    await until(() => osGenerated.length + pocketGenerated.length > 0, 'self-test to synthesize')
    expect(osGenerated.length, 'engine=os still synthesized with Pocket')
      .toBeGreaterThan(0)
    expect(pocketGenerated, 'engine=os handed the utterance to Pocket').toEqual([])
  })
})
