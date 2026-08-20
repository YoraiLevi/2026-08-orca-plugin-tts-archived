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

/**
 * `Get-Clipboard` uses the Windows clipboard COM API, which REQUIRES single-threaded apartment
 * mode. Without `-STA`, PowerShell 5.1 can block indefinitely instead of failing (found by CI on
 * windows-latest, PITFALLS P14).
 */
const CANDIDATES: Record<string, ReadonlyArray<{ cmd: string; args: readonly string[] }>> = {
  darwin: [{ cmd: 'pbpaste', args: [] }],
  win32: [{ cmd: 'powershell', args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', 'Get-Clipboard -Raw'] }],
  linux: [
    { cmd: 'wl-paste', args: ['--no-newline'] },
    { cmd: 'xclip', args: ['-selection', 'clipboard', '-o'] },
    { cmd: 'xsel', args: ['--clipboard', '--output'] }
  ]
}

/** Every clipboard helper gets a deadline: a hung reader must not freeze the hotkey. */
function capture(cmd: string, args: readonly string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let child
    try { child = spawn(cmd, [...args], { stdio: ['ignore', 'pipe', 'ignore'] }) }
    catch { reject(new Error(cmd)); return }
    let out = ''
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
      reject(new Error(`${cmd} timed out after ${timeoutMs} ms`))
    }, timeoutMs)
    const settle = (fn: () => void) => { clearTimeout(timer); fn() }
    child.stdout?.on('data', (d: Buffer) => { out += d.toString('utf8') })
    child.on('error', () => settle(() => reject(new Error(cmd))))
    child.on('close', (code) => settle(() => code === 0 ? resolve(out) : reject(new Error(cmd))))
  })
}

export interface ClipboardOptions {
  readonly platform?: string
  /** Hard cap. A 5 MB paste must not be synthesized in full. */
  readonly maxChars?: number
  /** Deadline per helper. PowerShell start-up is slow; never unbounded. */
  readonly timeoutMs?: number
}

export interface ClipboardResult {
  readonly text: string
  readonly truncated: boolean
}

export const DEFAULT_MAX_CHARS = 20_000
export const DEFAULT_CLIPBOARD_TIMEOUT_MS = 20_000

export async function readClipboard(opts: ClipboardOptions = {}): Promise<ClipboardResult> {
  const platform = opts.platform ?? process.platform
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CLIPBOARD_TIMEOUT_MS
  const candidates = CANDIDATES[platform] ?? []
  const tried: string[] = []

  for (const c of candidates) {
    tried.push(c.cmd)
    try {
      const raw = await capture(c.cmd, c.args, timeoutMs)
      if (raw.length <= maxChars) return { text: raw, truncated: false }
      return { text: raw.slice(0, maxChars), truncated: true }
    } catch { continue }
  }
  throw new ClipboardUnavailableError(platform, tried)
}
