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

/**
 * R10-03 — the corpus modelled 2 of the 18 record types the format actually emits.
 *
 * Round 10's census: 60 real transcripts, 32,525 records, **18 distinct `type` values**. The three
 * committed fixtures contained `user` and `assistant` and nothing else — and omitted `attachment`,
 * which is the single most common type at 12,435 records, 38 % of everything, never mentioned
 * anywhere in this repo before that census.
 *
 * Nothing was wrong because of it. What was wrong is that the corpus **could not tell us that**: it
 * held no record that would raise the question. That is round 8's lesson — real committed files beat
 * imagined inputs — one seam further out, and it is why the census had to be run against
 * `~/.claude/projects` rather than against `fixtures/`.
 *
 * `all-record-types.jsonl` is synthetic but real-SHAPED: one record per observed type, with the
 * long-string field the census found on each type carrying a `NEVER_SPEAK_` marker. The markers are
 * the point. The decoder's whitelist is correct today (census hypothesis 3 came back empty), so an
 * assertion that only says "one reply came out" would pass for a decoder that had quietly widened.
 * A marker leaking names which type leaked, in the failure message.
 */
const ALL_TYPES = 'all-record-types.jsonl'

/**
 * Restated, not derived from the fixture (P36). A test that reads its expectations out of the file
 * it is checking cannot fail: delete a record and the expectation shrinks with it. These 18 are
 * 019 section 3's census list, and adding one here is a claim about the real format.
 */
const OBSERVED_RECORD_TYPES = [
  'attachment', 'assistant', 'user', 'bridge-session', 'mode', 'permission-mode', 'last-prompt',
  'atis-latch', 'agent-setting', 'ai-title', 'system', 'pr-link', 'frame-link',
  'file-history-snapshot', 'queue-operation', 'file-history-delta', 'artifact-comment-monitor',
  'fork-context-ref'
]

describe('R10-03 the corpus carries every record type the real format emits', () => {
  it('models all 18 observed types, including the most common one', () => {
    const present = new Set(fixture(ALL_TYPES).map((l) => JSON.parse(l).type as string))
    const missing = OBSERVED_RECORD_TYPES.filter((t) => !present.has(t))
    expect(missing, 'record types the corpus still cannot raise a question about').toEqual([])
    // Named on its own, because it is the one the corpus omitted entirely and it is 38 % of all
    // records. A regression that drops it would otherwise hide inside the list above.
    expect(present.has('attachment'), 'attachment, 12,435 records in the census').toBe(true)
  })

  it('speaks the assistant text and NOTHING from the other seventeen types', () => {
    const replies = decodeAll(ALL_TYPES)
    expect(replies.map((r) => r.text)).toEqual(['The build is green.'])

    // The marker check is what makes this more than a count. It names the leaking type.
    const spoken = replies.map((r) => r.text).join('\n')
    const leaked = [...spoken.matchAll(/NEVER_SPEAK_([a-z_]+)/g)].map((m) => m[1])
    expect(leaked, 'record types whose payload reached the listener').toEqual([])
  })

  it('every non-assistant record decodes to null, one type at a time', () => {
    // Per line, so a failure names the record rather than "the total was wrong".
    for (const line of fixture(ALL_TYPES)) {
      const type = JSON.parse(line).type as string
      if (type === 'assistant') continue
      expect(decodeClaudeLine(line), `${type} produced speech`).toBeNull()
    }
  })

  /**
   * The fixture alone cannot defend the TYPE GATE, and finding that out is the useful part.
   *
   * Widening `rec['type'] !== 'assistant'` to also accept `attachment` leaves every assertion above
   * green — because a real-shaped attachment record carries no `message` object, so the decoder
   * returns null two lines later for a different reason. The fixture proves the type is PRESENT in
   * the corpus; it cannot prove the gate is what stops it.
   *
   * So the gate is tested against a record built to get past everything else: an `attachment`
   * carrying a perfectly well-formed assistant `message`. Nothing in a real transcript looks like
   * this, which is exactly why it belongs in a hand-built record and not in the fixture — the
   * fixture's job is to be real, this record's job is to be adversarial.
   */
  it('the TYPE gate stops a non-assistant record even when its body is speakable', () => {
    const disguised = JSON.stringify({
      type: 'attachment', uuid: 'x99',
      message: { role: 'assistant', content: [{ type: 'text', text: 'NEVER_SPEAK_disguised_attachment' }] }
    })
    expect(decodeClaudeLine(disguised), 'a non-assistant type reached the speaker').toBeNull()
  })

  it('CONTROL: the fixture really does contain speakable text, so the assertions are not vacuous', () => {
    // Without this, every assertion above is satisfied by a fixture of empty lines.
    expect(fixture(ALL_TYPES).length).toBeGreaterThanOrEqual(OBSERVED_RECORD_TYPES.length)
    expect(decodeAll(ALL_TYPES).length).toBe(1)
    expect(fixture(ALL_TYPES).join('\n')).toContain('NEVER_SPEAK_')
  })
})
