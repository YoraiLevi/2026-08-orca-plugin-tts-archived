/**
 * Agent identity — `docs/design/005-agent-identity.md`.
 *
 * The design's verdict, and the reason this module exists at all: **a voice difference cannot be
 * the load-bearing identity mechanism.** Distinct identities guaranteed on all three platforms,
 * voice-based, is exactly **1** — macOS offers 66 recommended, stock Windows 6, stock Ubuntu 0-2.
 * The axes that are identical everywhere are the ones WE generate and that ask the host for
 * nothing: a spoken **call-sign** and a synthesized **earcon**.
 *
 * So identity is carried by the call-sign first. A voice index is an enhancement where the host
 * happens to have voices, never the mechanism.
 *
 * Pure and dependency-free, deliberately: this runs in the plugin worker, in a panel, in a
 * service and in a test, and `packages/core/src/normalizer` proved what that property is worth.
 */

/**
 * Call-signs, ordered for PERCEPTUAL DISTANCE rather than alphabetically (005 section 6).
 *
 * Adjacent entries differ in stress pattern and vowel, so the first two agents in a room are the
 * two easiest to tell apart — which is the case that actually happens. Alphabetical order would
 * put "Anchor" next to "Amber" and make the common case the hardest one.
 *
 * Every entry is a single ordinary English word a synthesizer on any platform pronounces without
 * a dictionary. **No hex, ever** — 005 forbids it, and `sessionLabel()` was speaking eight
 * characters of a UUID aloud before this existed.
 */
export const CALL_SIGNS: readonly string[] = [
  'Anchor', 'Willow', 'Beacon', 'Cobalt', 'Harbor', 'Ember',
  'Lantern', 'Osprey', 'Meadow', 'Falcon', 'Juniper', 'Quarry',
  'Bramble', 'Vector', 'Cinder', 'Marlow', 'Thistle', 'Dover',
  'Pennant', 'Kestrel', 'Solstice', 'Rook', 'Verdant', 'Halyard'
]

/** Motif count for the earcon axis. 005 section 1 puts the portable earcon space at >= 30. */
export const EARCON_MOTIFS = 30

export interface AgentIdentity {
  /** One spoken word. The load-bearing axis, because it works where there are no voices. */
  readonly callSign: string
  /** Index into the motif table. Portable: we synthesize it, the host supplies nothing. */
  readonly earconId: number
  /**
   * Index into the provider's ordered voice list, or `null` when the host has fewer than two
   * voices. **Null is a real answer, not a failure** — on stock Ubuntu it is the correct one, and
   * a caller that treats null as "use voice 0" would silently give two agents the same voice
   * while believing they differed.
   */
  readonly voiceIndex: number | null
}

/**
 * A stable 32-bit hash. Order-independent output is not wanted here — the same session must map
 * to the same call-sign across restarts, or the listener re-learns who is who every morning.
 */
function hash (s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Derive an identity from a session id.
 *
 * Deterministic and stateless: no registry to keep in sync, and two processes that never speak to
 * each other still agree. `voiceCount` is what the PROVIDER reports at runtime (005 section 4 —
 * the identity space is declared by the provider, not hard-coded per OS), so the same code gives
 * macOS-class cardinality once Piper voices are cached on Windows and Linux.
 */
export function identityFor (sessionId: string, voiceCount = 0): AgentIdentity {
  const h = hash(sessionId)
  return {
    callSign: CALL_SIGNS[h % CALL_SIGNS.length] as string,
    earconId: (h >>> 8) % EARCON_MOTIFS,
    // Fewer than two voices cannot distinguish anything, so the axis reports itself unavailable
    // rather than pretending. This is the stock-Ubuntu case and it must not look like success.
    voiceIndex: voiceCount >= 2 ? (h >>> 16) % voiceCount : null
  }
}

/** What the listener hears in front of a reply. One word, no hex, no session id. */
export function spokenPrefix (identity: AgentIdentity): string {
  return `${identity.callSign}.`
}
