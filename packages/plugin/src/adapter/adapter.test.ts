import { describe, expect, it, vi } from 'vitest'
import { asAgentStatus, makeHost, worktreePathFrom, type OrcaApi, type StorageFailure } from './index.js'

const fakeOrca = (over: Partial<OrcaApi> = {}): OrcaApi => ({
  commands: { register: vi.fn() },
  events: { on: vi.fn() },
  host: { call: vi.fn().mockResolvedValue({}) },
  log: vi.fn(),
  ...over
})

describe('T052 ORCA adapter quarantine', () => {
  it('registers commands through the REAL api shape: orca.commands.register', () => {
    const orca = fakeOrca()
    const host = makeHost(orca)
    host.registerCommand('read-aloud.stop', () => {})
    expect(orca.commands.register).toHaveBeenCalledWith('read-aloud.stop', expect.any(Function))
    expect(host.registeredCommands()).toBe(1)
  })

  it('subscribes through orca.events.on', () => {
    const orca = fakeOrca()
    makeHost(orca).onEvent('agent.status.changed', () => {})
    expect(orca.events.on).toHaveBeenCalledWith('agent.status.changed', expect.any(Function))
  })

  it('notifies through host.call("notifications.show") with the host title cap', () => {
    const orca = fakeOrca()
    makeHost(orca).notify('x'.repeat(200), 'body')
    const [action, params] = (orca.host.call as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>]
    expect(action).toBe('notifications.show')
    expect((params['title'] as string).length).toBe(120)   // schema caps title at 120
  })

  it('unwraps storage.get, which returns { value }', async () => {
    const orca = fakeOrca({ host: { call: vi.fn().mockResolvedValue({ value: 42 }) } })
    expect(await makeHost(orca).storageGet('k')).toBe(42)
  })

  it('counts registrations, so a host API mismatch is visible instead of silent', () => {
    // This is the P18 guard: a throwing/absent register must NOT look like success.
    const orca = fakeOrca({ commands: { register: () => { throw new Error('gone') } } })
    const host = makeHost(orca)
    host.registerCommand('a', () => {})
    expect(host.registeredCommands()).toBe(0)
    expect(orca.log).toHaveBeenCalledWith(expect.stringContaining('could not register command'))
  })

  it('a command handler that throws is reported, not swallowed into a crash', async () => {
    const orca = fakeOrca()
    makeHost(orca).registerCommand('boom', () => { throw new Error('inner') })
    const wrapped = (orca.commands.register as ReturnType<typeof vi.fn>).mock.calls[0]![1] as () => Promise<unknown>
    await expect(wrapped()).resolves.toMatchObject({ ok: false })
    expect(orca.log).toHaveBeenCalledWith(expect.stringContaining('command boom failed'))
  })

  it('parses the four-field projection, and the sessionId when orca#15640 lands', () => {
    expect(asAgentStatus({ worktreeId: 'r::/x', paneKey: 'a:b', state: 'done', receivedAt: 5 }))
      .toEqual({ worktreeId: 'r::/x', paneKey: 'a:b', state: 'done', receivedAt: 5 })
    expect(asAgentStatus({ paneKey: 'a', state: 'done', receivedAt: 1, worktreeId: null, sessionId: 's1' }))
      .toMatchObject({ sessionId: 's1' })
  })

  it('rejects payloads that are not the projection', () => {
    for (const bad of [null, undefined, 42, 'x', {}, { paneKey: 1 }]) expect(asAgentStatus(bad)).toBeNull()
  })

  it('extracts the worktree path, the only correlation handle we have today', () => {
    expect(worktreePathFrom('repoid::/Users/a/project')).toBe('/Users/a/project')
    expect(worktreePathFrom('/no/separator')).toBe('/no/separator')
    expect(worktreePathFrom(null)).toBeNull()
  })
})

/**
 * 006 sites 17-23, and section 19's rank TWO undetectable: "whether the listener was told
 * anything".
 *
 * `notifications.show` returns `{ delivered }` (orca/src/shared/plugins/plugin-host-api.ts:143-152)
 * and this adapter discarded it. EVERY "never fail silently" path in the plugin terminated in that
 * call or in `host.log`, which is itself wrapped in `catch {}`. So the whole discipline could be
 * delivered to nobody while the plugin believed it had spoken. The FMA priced the fix at "one
 * conditional"; this is that conditional, plus the four collapses around it.
 */
describe('006 sites 17-23 — the adapter reports what the host actually did', () => {
  const orcaWith = (call: (a: string, p?: Record<string, unknown>) => Promise<unknown>): OrcaApi => ({
    commands: { register: () => {} },
    events: { on: () => {} },
    host: { call },
    log: () => {}
  })

  it('site 18: a notification ORCA reports as UNDELIVERED reaches the spoken fallback', async () => {
    const spoken: string[] = []
    const host = makeHost(
      orcaWith(async () => ({ delivered: false })),
      { onUndelivered: (m) => spoken.push(m) }
    )
    host.notify('Read Aloud', 'the clipboard is empty')
    await new Promise((r) => setTimeout(r, 5))
    expect(spoken, 'a successful call reporting a FAILED delivery was invisible').toEqual(['the clipboard is empty'])
  })

  it('CONTROL: a delivered notification is not spoken twice', async () => {
    const spoken: string[] = []
    const host = makeHost(
      orcaWith(async () => ({ delivered: true })),
      { onUndelivered: (m) => spoken.push(m) }
    )
    host.notify('Read Aloud', 'this one landed')
    await new Promise((r) => setTimeout(r, 5))
    expect(spoken, 'every notification would become a second spoken sentence').toEqual([])
  })

  it('a message the caller already spoke is never spoken again by the fallback', async () => {
    const spoken: string[] = []
    const host = makeHost(
      orcaWith(async () => ({ delivered: false })),
      { onUndelivered: (m) => spoken.push(m) }
    )
    host.notify('Read Aloud', 'already said aloud', { alreadySpoken: true })
    await new Promise((r) => setTimeout(r, 5))
    expect(spoken, 'hearing the same sentence twice is its own harm').toEqual([])
  })

  it('site 19/20: storage failures are named, not collapsed into "the key is not set"', async () => {
    const failures: StorageFailure[] = []
    const host = makeHost(
      orcaWith(async (action) => { throw new Error(`${action} refused: consent`) }),
      { onStorageFailure: (f) => failures.push(f) }
    )
    expect(await host.storageGet('huddle.enabled'), 'the return contract is unchanged').toBeUndefined()
    await host.storageSet('huddle.enabled', true)
    expect(failures.map((f) => f.op), 'both directions were silent').toEqual(['get', 'set'])
    expect(failures[0]?.key).toBe('huddle.enabled')
    expect(String(failures[0]?.reason), 'the ORCA error code is the actionable half').toContain('consent')
  })

  it('site 22: a command handler that throws is reported, not just returned as { ok: false }', async () => {
    const failed: string[] = []
    const commands = new Map<string, (a?: unknown) => unknown>()
    const orca: OrcaApi = {
      commands: { register: (id, fn) => { commands.set(id, fn) } },
      events: { on: () => {} },
      host: { call: async () => ({}) },
      log: () => {}
    }
    const host = makeHost(orca, { onCommandFailed: (id, reason) => failed.push(`${id}:${reason}`) })
    host.registerCommand('read-aloud.skip', () => { throw new Error('boom') })
    await commands.get('read-aloud.skip')?.()
    expect(failed.join(' '), 'a dead chord and a handler that threw are the same absence of sound')
      .toMatch(/read-aloud\.skip:.*boom/)
  })

  it('site 17: a host log that throws is counted, because nothing can report it through the log', () => {
    const host = makeHost({
      commands: { register: () => {} },
      events: { on: () => {} },
      host: { call: async () => ({}) },
      log: () => { throw new Error('log is gone') }
    })
    expect(host.logFailures(), 'a control case: the counter starts at zero').toBe(0)
    host.log('anything')
    host.log('anything else')
    expect(host.logFailures(), 'the drain every log-only report runs into was invisible').toBe(2)
  })
})
