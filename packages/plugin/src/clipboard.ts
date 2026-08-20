/**
 * Clipboard reader.
 *
 * "Speak selection" cannot read a real editor selection: ORCA exposes no selection API and no
 * clipboard capability (verified, orca-plugin-api.md). The clipboard is the honest fallback, and
 * the README says so plainly rather than implying otherwise.
 */
import { spawn } from 'node:child_process'

export class ClipboardUnavailableError extends Error {
  constructor(platform: string, tried: readonly string[]) {
    super(`Could not read the clipboard on ${platform}. Tried: ${tried.join(', ')}`)
    this.name = 'ClipboardUnavailableError'
  }
}

const CANDIDATES: Record<string, ReadonlyArray<{ cmd: string; args: readonly string[] }>> = {
  darwin: [{ cmd: 'pbpaste', args: [] }],
  win32: [{ cmd: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw'] }],
  linux: [
    { cmd: 'wl-paste', args: ['--no-newline'] },
    { cmd: 'xclip', args: ['-selection', 'clipboard', '-o'] },
    { cmd: 'xsel', args: ['--clipboard', '--output'] }
  ]
}

function capture(cmd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let child
    try { child = spawn(cmd, [...args], { stdio: ['ignore', 'pipe', 'ignore'] }) }
    catch { reject(new Error(cmd)); return }
    let out = ''
    child.stdout?.on('data', (d: Buffer) => { out += d.toString('utf8') })
    child.on('error', () => reject(new Error(cmd)))
    child.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(cmd)))
  })
}

export interface ClipboardOptions {
  readonly platform?: string
  /** Hard cap. A 5 MB paste must not be synthesized in full. */
  readonly maxChars?: number
}

export interface ClipboardResult {
  readonly text: string
  readonly truncated: boolean
}

export const DEFAULT_MAX_CHARS = 20_000

export async function readClipboard(opts: ClipboardOptions = {}): Promise<ClipboardResult> {
  const platform = opts.platform ?? process.platform
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS
  const candidates = CANDIDATES[platform] ?? []
  const tried: string[] = []

  for (const c of candidates) {
    tried.push(c.cmd)
    try {
      const raw = await capture(c.cmd, c.args)
      if (raw.length <= maxChars) return { text: raw, truncated: false }
      return { text: raw.slice(0, maxChars), truncated: true }
    } catch { continue }
  }
  throw new ClipboardUnavailableError(platform, tried)
}
