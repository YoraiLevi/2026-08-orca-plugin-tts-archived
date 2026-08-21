// The control band — docs/design/005-agent-identity.md section 11.1b.
//
// THE LAB DOES NOT MINT TONES. 005 section 11.1 allocates all thirty motifs of a six-note
// pentatonic space to agent identity; any tone this page invented would, by construction, be some
// live agent's identity, and a listener who has learned "rising G5-A5 is Cedar" would hear that
// motif as the confirmation of a Stop. Every earcon below is copied from the named table, with its
// notes and its duration. Identity is two notes from the pentatonic set; control is one or three
// notes from a DISJOINT set — C4, F4, A4 low and E6, G6 high — and never two.
//
// Sound discipline (PITFALLS P31): nothing here is played on load, on reconnect, or on any timer.
// An earcon sounds when the listener pressed something. That is the whole rule.
//
// This module is inlined verbatim into index.html; voice-lab/lib/inline.test.mjs fails if the
// two copies drift.

/** The control band's pitches, in hertz. Disjoint from the identity set by construction. */
export const CONTROL_PITCHES = { C4: 261.63, F4: 349.23, A4: 440.0, E6: 1318.51, G6: 1567.98 }

/** The identity band's pitches, listed only so a test can assert the two sets do not overlap. */
export const IDENTITY_PITCHES = { C5: 523.25, D5: 587.33, E5: 659.26, G5: 783.99, A5: 880.0, C6: 1046.5 }

export const GAIN = 0.05

export const EARCONS = {
  'control.play': { notes: ['E6'], totalMs: 150 },
  'control.stop': { notes: ['C4'], totalMs: 150 },
  'control.pause': { notes: ['F4'], totalMs: 150 },
  'control.skip': { notes: ['C4', 'A4', 'E6'], totalMs: 150 },
  'control.error': { notes: ['C4', 'C4', 'C4'], totalMs: 150 },
  'control.refused': { notes: ['E6', 'A4', 'C4'], totalMs: 150 },
  // The one deliberate exception to the 150 ms rule: a separator has to read as a gap.
  'control.compare': { notes: ['G6'], totalMs: 300 }
}

/**
 * The note schedule for one earcon: one note filling the duration, or three of 40 ms with 15 ms
 * gaps (005 section 11.1's envelope column).
 * @returns {{freq:number, offsetMs:number, durationMs:number}[]}
 */
export function schedule (id) {
  const spec = EARCONS[id]
  if (!spec) return []
  if (spec.notes.length === 1) {
    return [{ freq: CONTROL_PITCHES[spec.notes[0]], offsetMs: 0, durationMs: spec.totalMs }]
  }
  return spec.notes.map((n, i) => ({
    freq: CONTROL_PITCHES[n], offsetMs: i * 55, durationMs: 40
  }))
}
