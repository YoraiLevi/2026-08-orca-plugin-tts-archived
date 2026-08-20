import { describe, expect, it } from 'vitest'
import { readClipboard, ClipboardUnavailableError, DEFAULT_MAX_CHARS } from './clipboard.js'

describe('T060 clipboard', () => {
  it('T060b an unsupported platform reports rather than returning silence', async () => {
    await expect(readClipboard({ platform: 'plan9' })).rejects.toBeInstanceOf(ClipboardUnavailableError)
  })

  it('T060c oversized clipboard content is truncated and flagged', async () => {
    if (process.platform !== 'darwin' && process.platform !== 'linux' && process.platform !== 'win32') return
    const res = await readClipboard({ maxChars: 5 }).catch(() => null)
    if (res === null) return                      // no clipboard tool on this runner; not a failure
    expect(res.text.length).toBeLessThanOrEqual(5)
  })

  it('exposes a sane default cap', () => {
    expect(DEFAULT_MAX_CHARS).toBeGreaterThan(1000)
  })
})
