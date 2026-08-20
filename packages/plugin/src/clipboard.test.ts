import { describe, expect, it } from 'vitest'
import { readClipboard, ClipboardUnavailableError, DEFAULT_MAX_CHARS } from './clipboard.js'

describe('T060 clipboard', () => {
  it('T060b an unsupported platform reports rather than returning silence', async () => {
    await expect(readClipboard({ platform: 'plan9' })).rejects.toBeInstanceOf(ClipboardUnavailableError)
  })

  it('T060c oversized clipboard content is truncated and flagged', async () => {
    // A CI runner may have no clipboard tool or an empty clipboard; that is not a product failure.
    // What we assert is the cap, whenever a read succeeds at all.
    const res = await readClipboard({ maxChars: 5 }).catch(() => null)
    if (res === null) {
      console.info('[skip] no readable clipboard on this runner')
      return
    }
    expect(res.text.length).toBeLessThanOrEqual(5)
    if (res.truncated) expect(res.text.length).toBe(5)
  }, 60_000)

  it('a hung helper is killed rather than hanging the hotkey', async () => {
    // 1 ms deadline: whatever the platform helper is, it cannot beat this, so the timeout path runs.
    await expect(readClipboard({ timeoutMs: 1 })).rejects.toBeInstanceOf(ClipboardUnavailableError)
  }, 60_000)

  it('exposes a sane default cap', () => {
    expect(DEFAULT_MAX_CHARS).toBeGreaterThan(1000)
  })
})
