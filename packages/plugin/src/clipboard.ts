/**
 * Clipboard reader.
 *
 * "Speak selection" cannot read a real editor selection: ORCA exposes no selection API and no
 * clipboard capability (verified, orca-plugin-api.md). The clipboard is the honest fallback, and
 * the README says so plainly rather than implying otherwise.
 */
import { spawn } from 'node:child_process'

/**
 * 006 site 37. Every helper failure — a missing binary, a helper that timed out, a helper that
 * exited non-zero — arrived at one bare `continue`, and the only thing that survived to the
 * listener was the LIST OF NAMES tried. "Tried: wl-paste, xclip, xsel" tells them nothing they can
 * act on; "xclip is not installed" tells them exactly what to do next, and it is the same
 * information, kept instead of thrown away.
 *
 * The outcome chosen here is DISTINGUISHABLE, not louder: the sentence is spoken either way, and
 * this only decides whether it is worth hearing.
 */
export class ClipboardUnavailableError extends Error {
  /** Per-helper reason, in ladder order. */
  readonly reasons: readonly string[]
  constructor(platform: string, tried: readonly string[], reasons: readonly string[] = []) {
    super(reasons.length > 0
      ? `Could not read the clipboard on ${platform}. ${reasons.join('; ')}.`
      : `Could not read the clipboard on ${platform}. Tried: ${tried.join(', ')}`)
    this.name = 'ClipboardUnavailableError'
    this.reasons = reasons
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
    catch { reject(new Error(`${cmd} could not be started`)); return }
    let out = ''
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
      reject(new Error(`${cmd} timed out after ${timeoutMs} ms`))
    }, timeoutMs)
    const settle = (fn: () => void) => { clearTimeout(timer); fn() }
    child.stdout?.on('data', (d: Buffer) => { out += d.toString('utf8') })
    // Site 37: these three were one indistinguishable `new Error(cmd)`. ENOENT is the actionable
    // one — the helper is simply not installed — and it was the one being hidden.
    child.on('error', (err: NodeJS.ErrnoException) => settle(() => reject(new Error(
      err.code === 'ENOENT' ? `${cmd} is not installed` : `${cmd} could not be started`
    ))))
    child.on('close', (code) => settle(() => code === 0
      ? resolve(out)
      : reject(new Error(`${cmd} exited with code ${String(code)}`))))
  })
}

export interface ClipboardOptions {
  readonly platform?: string
  /** Hard cap. A 5 MB paste must not be synthesized in full. */
  readonly maxChars?: number
  /** Deadline per helper. PowerShell start-up is slow; never unbounded. */
  readonly timeoutMs?: number
  /**
   * Override the helper ladder. Test seam ONLY, and it exists for the same reason the sink's
   * `players` seam does: the failures worth testing (a missing binary, a helper that exits
   * non-zero, a helper that hangs) cannot be produced deterministically from the real ladder on
   * three operating systems. `xclip` is present on some CI images and absent on others, so a test
   * built on the real ladder asserts a different thing per runner — which is not a test.
   */
  readonly helpers?: ReadonlyArray<{ cmd: string; args: readonly string[] }>
}

export interface ClipboardResult {
  readonly text: string
  readonly truncated: boolean
}

/**
 * The cap, as a pure function, so it can be tested without a clipboard.
 *
 * It used to be inline in `readClipboard`, and its only test early-returned whenever the runner
 * had no readable clipboard — which is every headless CI runner, i.e. the machine the gate
 * actually runs on. A cap that is only checked on a developer's laptop is not a gate.
 */
export function capText(raw: string, maxChars: number): ClipboardResult {
  if (raw.length <= maxChars) return { text: raw, truncated: false }
  return { text: raw.slice(0, maxChars), truncated: true }
}

export const DEFAULT_MAX_CHARS = 20_000
export const DEFAULT_CLIPBOARD_TIMEOUT_MS = 20_000

export async function readClipboard(opts: ClipboardOptions = {}): Promise<ClipboardResult> {
  const platform = opts.platform ?? process.platform
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CLIPBOARD_TIMEOUT_MS
  const candidates = opts.helpers ?? CANDIDATES[platform] ?? []
  const tried: string[] = []
  const reasons: string[] = []

  for (const c of candidates) {
    tried.push(c.cmd)
    try {
      return capText(await capture(c.cmd, c.args, timeoutMs), maxChars)
    } catch (err) {
      // Site 37: `catch { continue }` discarded WHY. The aggregate error named the helpers and
      // not one fact about any of them.
      reasons.push(err instanceof Error ? err.message : String(err))
      continue
    }
  }
  if (candidates.length === 0) {
    reasons.push(`no clipboard helper is known for ${platform}`)
  }
  throw new ClipboardUnavailableError(platform, tried, reasons)
}
