/**
 * A comment stripper for JSONC — 011 section 6.
 *
 * The inbox is `.jsonc` because hand-editability requires each control to carry its explanation AT
 * THE POINT OF EDIT: a listener who must cross-reference a separate document to learn what
 * `pathStyle: "terse"` means will not edit the file. JSON forbids comments; YAML adds
 * significant-whitespace failure modes to a file a dyslexic user edits by hand; TOML needs a real
 * parser. So: JSON plus `//`, `/* *\/` and trailing commas, and a stripper that is dependency-free.
 *
 * Strings are respected — a `//` inside `"a link to //host"` is text, not a comment. Comment bodies
 * are replaced by spaces rather than removed, so a byte offset in the stripped text is still the
 * byte offset in the original, and a `JSON.parse` error position can be turned into a LINE NUMBER
 * the listener can be told about ("a syntax error on or near line 34").
 */

export function stripJsonComments(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]!
    if (c === '"') {
      out += c
      i++
      while (i < n) {
        const ch = text[i]!
        out += ch
        i++
        if (ch === '\\') {
          if (i < n) { out += text[i]!; i++ }
          continue
        }
        if (ch === '"') break
      }
      continue
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') { out += ' '; i++ }
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      out += '  '
      i += 2
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i] === '\n' ? '\n' : ' '
        i++
      }
      if (i < n) { out += '  '; i += 2 }
      continue
    }
    out += c
    i++
  }
  return out
}

/** Trailing commas before `}` or `]`, which a hand editor produces constantly. */
export function stripTrailingCommas(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]!
    if (c === '"') {
      out += c
      i++
      while (i < n) {
        const ch = text[i]!
        out += ch
        i++
        if (ch === '\\') { if (i < n) { out += text[i]!; i++ } ; continue }
        if (ch === '"') break
      }
      continue
    }
    if (c === ',') {
      let j = i + 1
      while (j < n && /\s/.test(text[j]!)) j++
      if (j < n && (text[j] === '}' || text[j] === ']')) { out += ' '; i++; continue }
    }
    out += c
    i++
  }
  return out
}

export interface JsoncResult {
  readonly value: unknown
  /** Set when the whole file is unparseable. 1-based; `null` when the position is unknowable. */
  readonly error?: { readonly message: string; readonly line: number | null }
}

/**
 * Parse JSONC. NEVER throws — a whole-file syntax error is a reportable condition, not a crash,
 * because the plugin must still speak using the KV mirror (011 section 1.2a).
 */
export function parseJsonc(text: string): JsoncResult {
  const stripped = stripTrailingCommas(stripJsonComments(text))
  try {
    return { value: JSON.parse(stripped) as unknown }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const at = /position (\d+)/.exec(message)
    let line: number | null = null
    if (at) {
      const pos = Math.min(Number(at[1]), stripped.length)
      line = stripped.slice(0, pos).split('\n').length
    }
    return { value: undefined, error: { message, line } }
  }
}
