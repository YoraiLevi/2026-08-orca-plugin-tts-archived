/**
 * The bridge T124 walks: the three REAL option surfaces, and the keys deliberately not settable.
 *
 * The key lists live beside their interfaces (`NORMALIZE_OPTION_KEYS` and friends) with a
 * compile-time exhaustiveness guard, so adding a field to `NormalizeOptions` without listing it
 * FAILS TO COMPILE. This module only gathers them, so the test iterates one table.
 */

import { NORMALIZE_OPTION_KEYS } from '../normalizer/index.js'
import { CHUNKER_OPTION_KEYS, CHUNKER_OPTION_KEYS_EXCLUDED } from '../chunker/index.js'
import { SYNTHESIZE_OPTION_KEYS, SYNTHESIZE_OPTION_KEYS_EXCLUDED } from '../types/index.js'

/** The owners whose fields become properties on a typed options object. */
export const WIRED_OWNERS = ['normalize', 'chunk', 'synthesize'] as const
export type WiredOwner = (typeof WIRED_OWNERS)[number]

export const OPTION_KEYS: Readonly<Record<WiredOwner, readonly string[]>> = {
  normalize: NORMALIZE_OPTION_KEYS,
  chunk: CHUNKER_OPTION_KEYS,
  synthesize: SYNTHESIZE_OPTION_KEYS
}

/**
 * Keys of the real options types that NO settings field may reach, each with the reason.
 *
 * An exclusion must be a reviewable line, never a silent omission — that is the whole difference
 * between "we decided this is not tunable" and "we forgot to wire it" (P26).
 */
export const EXCLUDED: Readonly<Record<WiredOwner, readonly string[]>> = {
  normalize: [],
  chunk: CHUNKER_OPTION_KEYS_EXCLUDED,      // countUnits — an injected FUNCTION; no file carries one
  synthesize: SYNTHESIZE_OPTION_KEYS_EXCLUDED // signal — an AbortSignal is runtime plumbing, not tuning
}

export const EXCLUSION_REASONS: Readonly<Record<string, string>> = {
  'chunk.countUnits': 'an injected size-measuring function; a settings file cannot express one',
  'synthesize.signal': 'an AbortSignal supplied per call at runtime; not tuning'
}

export function excludedCount(): number {
  return Object.values(EXCLUDED).reduce((n, xs) => n + xs.length, 0)
}
