import { describe, expect, it, vi } from 'vitest'
import { asAgentStatus, makeHost, worktreePathFrom, type OrcaApi } from './index.js'

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
