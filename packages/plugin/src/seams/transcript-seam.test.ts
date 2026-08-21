/**
 * SC-12 — seam 11: ORCA's transcript writer → `decoders.ts`.
 *
 * `006` section 22 was scoped to the audio path. This is the first row on the OTHER side, and it is
 * the least controllable seam shape in the project: **the upstream is someone else's code, it
 * changes without telling us, and our handling of anything unrecognised is silence.**
 *
 * THE CENSUS THAT MOTIVATED IT (`019-review-round10.md` section 3). 60 newest transcripts on the
 * author's own machine, 32,525 records, `[measured-here]`:
 *
 *   - **18 record `type` values** occur. `decoders.ts` names ONE (`assistant`).
 *   - The single most common is `attachment` (12,435), a type this project has never mentioned.
 *   - **6,596 assistant records; 738 carry any speakable text — 11.2 %.**
 *   - Content-block types seen inside assistant records: exactly three (`tool_use`, `thinking`,
 *     `text`) — every one of which the decoder names. **Zero unknown block types.**
 *   - Non-assistant record types carrying assistant prose: **zero**. Their long-string fields are
 *     `lastPrompt` (the user's own words), `queue-operation.content` (queued user input) and
 *     `system.content` (hook output).
 *
 * **So the decoder's whitelist is CORRECT today**, and this file's job is to keep it correct
 * against an upstream that will add types. Two of the three rows below are therefore
 * characterisation tests over the real format; the third is the defect the census did find.
 *
 * NO TRANSCRIPT CONTENT IS READ BY THIS FILE. The census was a one-off probe whose output is
 * counts only; these tests run on synthetic records shaped like the real ones.
 */
import { describe, expect, it } from 'vitest'
import { decodeClaudeLine, detectTranscriptFormat } from '../huddle/decoders.js'

const rec = (o: unknown): string => JSON.stringify(o)

/**
 * The 18 record `type` values observed in real transcripts, restated (P36). `decoders.ts` has no
 * list to import — it tests `type !== 'assistant'` and returns null — which is exactly why an
 * independent restatement is the only available check.
 */
const REAL_RECORD_TYPES = [
  'attachment', 'assistant', 'user', 'bridge-session', 'mode', 'permission-mode', 'last-prompt',
  'atis-latch', 'agent-setting', 'ai-title', 'system', 'pr-link', 'frame-link',
  'file-history-snapshot', 'queue-operation', 'file-history-delta', 'artifact-comment-monitor',
  'fork-context-ref'
] as const

describe('SC-12 — every record type the real format emits is handled deliberately', () => {
  it('speaks assistant text and nothing else, across all 18 observed record types', () => {
    for (const type of REAL_RECORD_TYPES) {
      const line = rec({ type, uuid: 'x', message: { content: [{ type: 'text', text: 'Spoken.' }] } })
      const out = decodeClaudeLine(line)
      if (type === 'assistant') expect(out?.text, type).toBe('Spoken.')
      else expect(out, `${type} produced speech`).toBeNull()
    }
  })

  /**
   * The census found no non-assistant record carrying assistant prose, so nothing is being dropped
   * today. This pins the fields that DO carry long strings, so that if huddle ever grows a reason
   * to read one it is a decision in a diff rather than an accident.
   */
  it('never speaks the user\'s own words back at them', () => {
    expect(decodeClaudeLine(rec({ type: 'last-prompt', lastPrompt: 'my long prompt text' }))).toBeNull()
    expect(decodeClaudeLine(rec({ type: 'queue-operation', content: 'queued user input' }))).toBeNull()
    expect(decodeClaudeLine(rec({ type: 'system', subtype: 'stop_hook_summary', content: 'hook output' }))).toBeNull()
  })

  it('still refuses thinking and tool traffic, which is principle VIII', () => {
    expect(decodeClaudeLine(rec({
      type: 'assistant', uuid: 'a',
      message: { content: [{ type: 'thinking', thinking: 'SECRET' }] }
    }))).toBeNull()
    expect(decodeClaudeLine(rec({
      type: 'assistant', uuid: 'b',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }] }
    }))).toBeNull()
  })

  /**
   * VIOLATED TODAY — the defect the census found (019 R10-01).
   *
   * A reply made only of block types the decoder does not name returns `null`, which is the SAME
   * observable as "this line was a user turn" and as "this line was tool traffic". Nothing counts
   * it and nothing announces it.
   *
   * The census says this is **latent, not live**: zero unknown block types occur in 6,022 assistant
   * records today. It is filed as a seam row precisely because the upstream is not ours — Anthropic
   * has shipped `server_tool_use`, `web_search_tool_result`, `mcp_tool_use`, `document` and
   * `container_upload` as content-block types, and the day one of those reaches this decoder the
   * listener gets silence indistinguishable from "the agent has not answered yet".
   *
   * The asymmetry that makes it a defect rather than a gap: `#read` ALREADY distinguishes
   * "unreadable" from "nothing new" at the FILE level, and returns `format` so the caller can say
   * so aloud. The same distinction does not exist at the BLOCK level. The instrument was built one
   * layer up and not one layer down.
   *
   * Remove `.fails` when an unrecognised block type is reported rather than skipped.
   */
  it.fails('distinguishes "we chose not to speak this" from "we did not recognise this" [OPEN: R10-01]', () => {
    const filtered = decodeClaudeLine(rec({
      type: 'assistant', uuid: 'a', message: { content: [{ type: 'thinking', thinking: 'x' }] }
    }))
    const unrecognised = decodeClaudeLine(rec({
      type: 'assistant', uuid: 'b', message: { content: [{ type: 'server_tool_use', id: 'x' }] }
    }))
    expect(filtered, 'a deliberately filtered block and an unknown one are the same observable')
      .not.toEqual(unrecognised)
  })
})

describe('SC-12b — the transcript states compaction outright; huddle infers it from file length', () => {
  /**
   * VIOLATED TODAY (019 R10-02), and this is the round's sharpest ORCA-facing finding.
   *
   * `huddle/index.ts:382` detects a rewritten transcript by "the file got SHORTER", and its own
   * comment names the stake: *"a lost reply is recoverable, a replayed session is not"* — the
   * "another session's replies hijacked the audio" harm, which is on the listening-lessons table
   * in HANDOFF.
   *
   * But the transcript SAYS SO. `{"type":"system","subtype":"compact_boundary"}` is written at the
   * boundary — 3 occurrences in the 200-transcript census `[measured-here]`. Nothing in this repo
   * reads `subtype`: `grep -n 'compact\\|subtype' packages/plugin/src/huddle/index.ts` returns one
   * line, and it is the prose comment above the length heuristic.
   *
   * The heuristic is strictly weaker than the ground truth. A compaction that leaves the decodable
   * reply count equal or higher is not detected at all, and huddle then reads previously-spoken
   * replies aloud again — the outcome the code says is unrecoverable.
   *
   * Remove `.fails` when the boundary record is read.
   */
  it.fails('recognises the compaction boundary record [OPEN: R10-02]', () => {
    const boundary = rec({ type: 'system', subtype: 'compact_boundary', sessionId: 's1' })
    // The contract, stated at the seam: SOMETHING in the decode path must be able to tell a caller
    // that this line means "everything before me was rewritten". Today the only decoder output is
    // `DecodedReply | null`, so a boundary is indistinguishable from a blank line.
    expect(decodeClaudeLine(boundary), 'the boundary record decodes to the same null as tool traffic')
      .not.toBeNull()
  })

  it('detects the claude format from a real-shaped record, which is the half that does work', () => {
    expect(detectTranscriptFormat(rec({
      type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] }
    }))).toBe('claude')
  })
})
