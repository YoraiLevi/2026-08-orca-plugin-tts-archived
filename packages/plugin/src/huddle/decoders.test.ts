import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { decodeClaudeLine } from './decoders.js'

const fixture = (name: string): string[] =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
    .split('\n').filter((l) => l.trim().length > 0)

const decodeAll = (name: string) =>
  fixture(name).map(decodeClaudeLine).filter((r): r is NonNullable<typeof r> => r !== null)

// ------------------------------------------------------------------ T076 (GATE)

describe('T076 GATE: thinking blocks are never spoken', () => {
  it('speaks only the reply from a turn containing both thinking and reply', () => {
    const replies = decodeAll('thinking-and-reply.jsonl')
    expect(replies.map((r) => r.text)).toEqual(['It is four.', 'Anything else?'])
    // The failure this gate exists to catch: reasoning reaching the speaker.
    for (const r of replies) expect(r.text).not.toContain('SECRET_REASONING')
  })

  it('drops redacted thinking as well as plain thinking', () => {
    const joined = decodeAll('thinking-and-reply.jsonl').map((r) => r.text).join(' ')
    expect(joined).not.toMatch(/SECRET_REASONING|encrypted/)
  })

  it('yields nothing at all for a thinking-only turn', () => {
    const replies = decodeAll('thinking-only.jsonl')
    expect(replies).toEqual([])
  })

  it('never speaks meta/injected turns', () => {
    const joined = decodeAll('thinking-only.jsonl').map((r) => r.text).join(' ')
    expect(joined).not.toContain('META_INJECTED')
  })
})

describe('T075b tool traffic is not speech', () => {
  it('drops tool_use and tool_result, keeps the prose', () => {
    const replies = decodeAll('tool-traffic.jsonl')
    expect(replies.map((r) => r.text)).toEqual(['Done, the files are gone.'])
    const joined = replies.map((r) => r.text).join(' ')
    expect(joined).not.toContain('rm -rf')
    expect(joined).not.toContain('deleted 4000 files')
  })
})

describe('decoder robustness', () => {
  it('malformed JSON is ignored rather than thrown', () => {
    expect(decodeClaudeLine('{not json')).toBeNull()
    expect(decodeClaudeLine('')).toBeNull()
    expect(decodeClaudeLine('null')).toBeNull()
    expect(decodeClaudeLine('{"type":"assistant"}')).toBeNull()
  })

  it('user turns are never spoken', () => {
    expect(decodeClaudeLine(
      '{"type":"user","uuid":"u9","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}'
    )).toBeNull()
  })
})
