import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { decodeClaudeLine } from './decoders.ts'

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

  it('a thinking block is dropped by its TYPE, even when it also carries a text field', () => {
    // MUTATION-CHECKED, and this is why the case exists: dropping the `type === 'text'` allowlist
    // and pushing any block with a string `text` left every other assertion in this file green.
    // The fixtures could not catch it, because a real thinking block keeps its payload under
    // `thinking`/`data` and has no `text` key at all — so a decoder reading `block.text` blindly
    // finds nothing to leak in the fixture, and everything to leak in the record ORCA actually
    // hands us. Principle VIII is the highest-stakes rule in this project; its gate must fail for
    // the right reason.
    const leaky = JSON.stringify({
      type: 'assistant', uuid: 'a9',
      message: { content: [
        { type: 'thinking', thinking: 'SECRET_REASONING', text: 'SECRET_REASONING' },
        { type: 'redacted_thinking', data: 'enc', text: 'SECRET_REDACTED' },
        { type: 'tool_use', name: 'Bash', text: 'rm -rf /' },
        { type: 'text', text: 'The answer is four.' }
      ] }
    })
    const out = decodeClaudeLine(leaky)
    expect(out?.text, 'a block was spoken because it had a .text field, not because it was speech')
      .toBe('The answer is four.')
  })

  it('a turn of nothing but a text-bearing thinking block yields NOTHING', () => {
    // The control for the case above: if the allowlist were dropped, this would return the
    // reasoning instead of null, so the assertion above can be shown to distinguish outcomes.
    expect(decodeClaudeLine(JSON.stringify({
      type: 'assistant', uuid: 'a10',
      message: { content: [{ type: 'thinking', thinking: 'SECRET', text: 'SECRET' }] }
    })), 'a thinking-only turn was spoken').toBeNull()
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
