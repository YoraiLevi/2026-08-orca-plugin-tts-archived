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
