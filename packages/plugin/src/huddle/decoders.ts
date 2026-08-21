/**
 * Transcript record decoders.
 *
 * ORCA's own decoders live in `src/main` and are not shipped to plugins, so we reimplement the
 * minimum we need. CRITICAL (constitution principle VIII): we filter thinking blocks HERE, at the
 * raw record level. ORCA's decoder flattens thinking into text blocks, after which the distinction
 * is unrecoverable — filtering later is impossible, not merely harder.
 */

export type AgentKind = 'claude' | 'openclaude' | 'codex' | 'grok' | 'omp'

/** Agents ORCA supports that have NO transcript format we can read. Huddle cannot serve these. */
export const UNSUPPORTED_AGENTS = [
  'gemini', 'cursor', 'copilot', 'amp', 'droid', 'devin', 'aider', 'continue', 'cline'
] as const

export interface DecodedReply {
  readonly id: string
  readonly text: string
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

/**
 * Extract only speakable assistant prose from one Claude-format JSONL line.
 * Returns null for user turns, tool traffic, meta records, and thinking-only turns.
 */
export function decodeClaudeLine(line: string): DecodedReply | null {
  let rec: unknown
  try { rec = JSON.parse(line) } catch { return null }
  if (!isRecord(rec)) return null

  if (rec['isMeta'] === true || rec['isSidechain'] === true) return null
  if (rec['type'] !== 'assistant') return null

  const message = rec['message']
  if (!isRecord(message)) return null
  const content = message['content']
  if (!Array.isArray(content)) return null

  const parts: string[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    const type = block['type']
    // Never speak what the model only thought.
    if (type === 'thinking' || type === 'redacted_thinking') continue
    // Tool calls and results are not speech.
    if (type === 'tool_use' || type === 'tool_result') continue
    if (type === 'text' && typeof block['text'] === 'string') parts.push(block['text'])
  }

  const text = parts.join('\n').trim()
  if (text.length === 0) return null
  const id = typeof rec['uuid'] === 'string' ? rec['uuid'] : `${Date.now()}-${parts.length}`
  return { id, text }
}

/** Codex/omp/grok share a simpler envelope; same filtering discipline. */
export function decodeGenericLine(line: string): DecodedReply | null {
  let rec: unknown
  try { rec = JSON.parse(line) } catch { return null }
  if (!isRecord(rec)) return null
  const role = rec['role'] ?? rec['type']
  if (role !== 'assistant') return null
  if (rec['thinking'] === true || rec['reasoning'] === true) return null
  const content = rec['content'] ?? rec['text']
  if (typeof content !== 'string' || content.trim().length === 0) return null
  const id = typeof rec['id'] === 'string' ? rec['id'] : `${Date.now()}`
  return { id, text: content.trim() }
}

export function decoderFor(agent: AgentKind): (line: string) => DecodedReply | null {
  return agent === 'claude' || agent === 'openclaude' ? decodeClaudeLine : decodeGenericLine
}

/** What `detectTranscriptFormat` concluded. 'unknown' means we have no decoder for these records. */
export type TranscriptFormat = 'claude' | 'generic' | 'unknown'

/**
 * Pick a decoder from the records themselves rather than assuming Claude.
 *
 * `#readReplies` called `decodeClaudeLine` unconditionally, so a Codex/Grok/omp record — which
 * fails `rec['type'] !== 'assistant'` — decoded to null on every line and huddle was completely
 * mute while `panel.html` claimed "supports Claude, Codex, Grok and omp". `decoderFor`,
 * `decodeGenericLine` and `UNSUPPORTED_AGENTS` had ZERO non-test callers: P26's shape on a new
 * wire (006 DC1/DC2, silent-failure site 55).
 *
 * Sniffed from the shape, not from a filename, because the filename is a uuid on every format we
 * have seen. Scans a bounded prefix so a 40 MB transcript costs the same as a small one.
 */
export function detectTranscriptFormat(raw: string, maxLines = 200): TranscriptFormat {
  let sawGeneric = false
  let n = 0
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue
    if (++n > maxLines) break
    let rec: unknown
    try { rec = JSON.parse(line) } catch { continue }
    if (!isRecord(rec)) continue
    // The Claude envelope is unmistakable: a `message` object carrying a content-block array.
    if (isRecord(rec['message']) && Array.isArray((rec['message'] as Record<string, unknown>)['content'])) {
      return 'claude'
    }
    // The simpler envelope: a role and a string body, on one flat record.
    if ((typeof rec['role'] === 'string' || typeof rec['type'] === 'string') &&
        (typeof rec['content'] === 'string' || typeof rec['text'] === 'string')) {
      sawGeneric = true
    }
  }
  return sawGeneric ? 'generic' : 'unknown'
}

/**
 * The honest sentence for a transcript we cannot decode, spoken aloud once per session.
 *
 * Silence and "the agent has not answered yet" are indistinguishable to a listener, which is the
 * S2 failure this whole document class is about. Saying so is worse than reading the reply and far
 * better than saying nothing.
 *
 * `UNSUPPORTED_AGENTS` finally has a caller: when the transcript path names an agent we know we
 * cannot serve, the sentence names it too, so the listener learns WHICH tool is unreadable rather
 * than being told a format they cannot see is wrong.
 */
export function unreadableTranscriptMessage(file: string): string {
  const segments = file.toLowerCase().split(/[/\\.]+/)
  const named = UNSUPPORTED_AGENTS.find((a) => segments.includes(a))
  return named === undefined
    ? "Huddle cannot read this agent's transcript, so its replies will not be spoken."
    : `Huddle cannot read ${named}'s transcript, so its replies will not be spoken.`
}
