import { describe, expect, it } from 'vitest'
import { readClipboard, capText, ClipboardUnavailableError, DEFAULT_MAX_CHARS } from './clipboard.ts'

describe('T060 clipboard', () => {
  it('T060b an unsupported platform reports rather than returning silence', async () => {
    await expect(readClipboard({ platform: 'plan9' })).rejects.toBeInstanceOf(ClipboardUnavailableError)
  })

  it('T060c the cap truncates and flags — unconditionally, on every runner', () => {
    // The integration version of this below early-returns wherever no clipboard is readable, which
    // is every headless CI runner. The cap itself is pure, so it is gated here with no escape:
    // a 5 MB paste must not be handed to the synthesizer.
    const huge = 'x'.repeat(5_000_000)
    const capped = capText(huge, DEFAULT_MAX_CHARS)
    expect(capped.text.length, 'the cap did not apply').toBe(DEFAULT_MAX_CHARS)
    expect(capped.truncated, 'truncation happened but was not flagged, so nothing can report it').toBe(true)
    // The control case: at or under the cap nothing is touched and nothing is flagged, so the
    // assertions above can be shown to distinguish outcomes rather than always holding.
    const small = capText('abc', DEFAULT_MAX_CHARS)
    expect(small.text).toBe('abc')
    expect(small.truncated).toBe(false)
    // Exactly at the boundary is NOT a truncation.
    expect(capText('x'.repeat(10), 10)).toEqual({ text: 'x'.repeat(10), truncated: false })
    expect(capText('x'.repeat(11), 10).truncated).toBe(true)
  })

  it('T060c-integration the cap survives the real read path, where a clipboard exists', async (ctx) => {
    // A CI runner may have no clipboard tool or an empty clipboard; that is not a product failure.
    // What we assert is the cap, whenever a read succeeds at all. `ctx.skip()` rather than a bare
    // `return`, so a runner where this never runs reports SKIPPED instead of PASSED — the pure
    // cap test above is the one that gates every runner.
    const res = await readClipboard({ maxChars: 5 }).catch(() => null)
    if (res === null) { ctx.skip('no readable clipboard on this runner'); return }
    expect(res.text.length).toBeLessThanOrEqual(5)
    if (res.truncated) expect(res.text.length).toBe(5)
  }, 60_000)

  it('a hung helper is killed rather than hanging the hotkey', async () => {
    // 1 ms deadline: whatever the platform helper is, it cannot beat this, so the timeout path runs.
    await expect(readClipboard({ timeoutMs: 1 })).rejects.toBeInstanceOf(ClipboardUnavailableError)
  }, 60_000)

  it('exposes a default cap large enough to be a cap and not a truncator', () => {
    // A constant assertion, kept deliberately: DEFAULT_MAX_CHARS is the number the cap test above
    // is measured against, and a value small enough to clip an ordinary agent reply would make
    // that test pass while silently breaking the product.
    expect(DEFAULT_MAX_CHARS).toBeGreaterThan(1000)
    expect(capText('a normal length reply', DEFAULT_MAX_CHARS).truncated,
      'the default cap truncates ordinary text').toBe(false)
  })
})

/**
 * 006 site 37 — timeout, not-installed and non-zero-exit arrived at one bare `continue`, and the
 * only thing that reached the listener was the list of NAMES tried.
 *
 * The outcome chosen is DISTINGUISHABLE, not louder. "Tried: wl-paste, xclip, xsel" is a sentence
 * the listener cannot act on; "xclip is not installed" is the same information, kept, and it names
 * the one thing they could go and do. No clipboard is read and no audio is played.
 */
describe('006 site 37 — each clipboard helper failure keeps its own reason', () => {
  it('names a missing binary, a non-zero exit and a hang separately', async () => {
    const err = await readClipboard({
      platform: 'linux',
      timeoutMs: 150,
      helpers: [
        { cmd: 'orca-tts-no-such-clipboard-helper', args: [] },
        { cmd: process.execPath, args: ['-e', 'process.exit(3)'] },
        { cmd: process.execPath, args: ['-e', 'setTimeout(() => {}, 10000)'] }
      ]
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ClipboardUnavailableError)
    const message = (err as ClipboardUnavailableError).message
    expect(message, 'a missing helper is the actionable case and was the one being hidden')
      .toContain('orca-tts-no-such-clipboard-helper is not installed')
    expect(message, 'a helper that ran and failed is not a helper that is absent')
      .toMatch(/exited with code 3/)
    expect(message, 'a hang is not an exit').toMatch(/timed out after 150 ms/)
  })

  it('says so when the platform has no clipboard helper at all', async () => {
    const err = await readClipboard({ platform: 'plan9' }).catch((e: unknown) => e)
    expect((err as ClipboardUnavailableError).message)
      .toContain('no clipboard helper is known for plan9')
  })
})
