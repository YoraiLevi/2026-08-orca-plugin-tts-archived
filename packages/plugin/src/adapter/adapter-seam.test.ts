import { describe, expect, it, vi } from 'vitest'
import { makeHost, type OrcaApi } from './index.ts'

/**
 * Round 13 — the ADAPTER seam, opened for the first time.
 *
 * This is the seam round 10 named as hardest: the far side is **someone else's code**, and it can
 * change without telling us. Everything the plugin believes about the host API is a belief until
 * something checks it against ORCA's own schemas.
 *
 * SEAM: our adapter -> `orca.host.call(method, params)` -> ORCA's zod validation.
 * CONTRACT: we never send params ORCA's schema would reject. A rejected call is not a crash — it
 * is a silence, and every "never fail silently" path in this plugin terminates in one of these.
 *
 * The constraints below are RESTATED from `~/source/orca/src/shared/plugins/plugin-host-api.ts`,
 * read 2026-08-22, never imported (P36). Two sources that must agree is a check; one source
 * compared against itself is not — and this repo already shipped a `settings.set` that sent the
 * whole record where ORCA accepts one `{key, value}`, because the test's fake host accepted
 * whatever the plugin sent.
 */

/** `notificationsShowParams`: title 1-120 REQUIRED, body max 1000 optional. */
const TITLE_MIN = 1
const TITLE_MAX = 120
const BODY_MAX = 1000

function hostWithSpy (): { orca: OrcaApi; calls: Array<{ m: string; p: Record<string, unknown> }> } {
  const calls: Array<{ m: string; p: Record<string, unknown> }> = []
  const orca = {
    host: {
      call: vi.fn(async (m: string, p: Record<string, unknown>) => {
        calls.push({ m, p })
        if (m === 'notifications.show') return { delivered: true }
        return {}
      })
    }
  } as unknown as OrcaApi
  return { orca, calls }
}

describe('SC-20 — the adapter never sends params ORCA would reject', () => {
  it('clamps an over-long title to ORCA\'s maximum', async () => {
    const { orca, calls } = hostWithSpy()
    const host = makeHost(orca, {})
    host.notify('x'.repeat(400), 'y'.repeat(4000))
    await new Promise((r) => setTimeout(r, 20))
    const found = calls.find((c) => c.m === 'notifications.show')
    expect(found, 'no notification was attempted at all').toBeDefined()
    const p = found?.p ?? {}
    expect(String(p['title'] ?? '').length,
      `title exceeds ORCA's max(${TITLE_MAX}); zod rejects the call and the announcement is silent`)
      .toBeLessThanOrEqual(TITLE_MAX)
    expect(String(p['body'] ?? '').length,
      `body exceeds ORCA's max(${BODY_MAX})`).toBeLessThanOrEqual(BODY_MAX)
  })

  it('never sends an EMPTY title, which ORCA\'s min(1) rejects', async () => {
    // The clamp handles max. Nothing was found handling min — and an empty title is not exotic:
    // any announcement built from a value that turned out to be empty produces one, and the
    // result is a call that fails validation, so the listener hears nothing and the plugin
    // believes it spoke.
    const { orca, calls } = hostWithSpy()
    const host = makeHost(orca, {})
    host.notify('', 'the body still carries the message')
    await new Promise((r) => setTimeout(r, 20))
    const p = calls.find((c) => c.m === 'notifications.show')?.p
    if (p === undefined) return   // refusing to send is a legitimate answer
    expect(String(p['title'] ?? '').length,
      `sent title="" — ORCA's schema is z.string().min(${TITLE_MIN}), so this call is REJECTED and `
      + 'the announcement reaches nobody while the plugin reports success')
      .toBeGreaterThanOrEqual(TITLE_MIN)
  })
})
