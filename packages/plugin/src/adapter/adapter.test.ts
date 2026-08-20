import { describe, expect, it } from 'vitest'
import { asAgentStatus, makeHost, worktreePathFrom } from './index.js'

describe('T052 ORCA adapter quarantine', () => {
  it('a host missing every method degrades to no-ops instead of crashing', () => {
    const host = makeHost({})
    expect(() => host.log('x')).not.toThrow()
    expect(() => host.notify('x')).not.toThrow()
    expect(() => host.registerCommand('a', () => {})).not.toThrow()
    expect(() => host.onEvent('e', () => {})).not.toThrow()
  })

  it('a host whose method throws does not take the plugin down', () => {
    const host = makeHost({ orca: { log: () => { throw new Error('boom') } } })
    expect(() => host.log('x')).not.toThrow()
  })

  it('parses the real four-field projection', () => {
    const s = asAgentStatus({ worktreeId: 'repo::/x/y', paneKey: 'a:b', state: 'done', receivedAt: 5 })
    expect(s).toEqual({ worktreeId: 'repo::/x/y', paneKey: 'a:b', state: 'done', receivedAt: 5 })
  })

  it('rejects payloads that are not the projection', () => {
    for (const bad of [null, undefined, 42, 'x', {}, { paneKey: 1 }]) {
      expect(asAgentStatus(bad)).toBeNull()
    }
  })

  it('extracts the worktree path, the only usable correlation handle', () => {
    expect(worktreePathFrom('repoid::/Users/a/project')).toBe('/Users/a/project')
    expect(worktreePathFrom('/no/separator')).toBe('/no/separator')
    expect(worktreePathFrom(null)).toBeNull()
  })
})
