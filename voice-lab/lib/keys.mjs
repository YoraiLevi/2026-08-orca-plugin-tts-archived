// The keyboard vocabulary — docs/.discussion/003-panel-and-control-channel.md section 4a.
//
// 4a is THE SOURCE. This table is transcribed from it and nothing here is invented: a control that
// means two things on two surfaces is the muscle-memory bug X-09 and 007 C1 both pin, and the
// listener is not looking at the screen. `s` is stop on both surfaces because it is the fastest
// press-to-silence route in the system; `R` is replay, not restore; `m` is mute, not more;
// snapshot and restore are `K` and `L`; the More tier is `+` and `-`.
//
// This module is inlined verbatim into index.html; voice-lab/lib/inline.test.mjs fails if the
// two copies drift.

/** 4a.1 — transport. Identical meaning on every surface. */
export const TRANSPORT = [
  { key: ' ', display: 'Space', verb: 'play-pause', does: 'play, pause, resume' },
  { key: 'p', display: 'p', verb: 'play-pause', does: 'pause or resume' },
  { key: 's', display: 's', verb: 'stop', does: 'stop' },
  { key: '.', display: '.', verb: 'stop', does: 'stop (alias)' },
  { key: 'R', display: 'R', verb: 'replay', does: 'replay the last thing played' },
  { key: 'm', display: 'm', verb: 'mute', does: 'mute the speak-on-change confirmations' },
  { key: '?', display: '?', verb: 'describe', does: 'speak the focused control\'s description' },
  { key: 'Escape', display: 'Esc', verb: 'close', does: 'close whatever opened' }
]

/** 4a.2 — surface-specific to the lab. */
export const LAB_KEYS = [
  { key: 'ArrowUp', display: '↑', verb: 'prev-control', does: 'previous control' },
  { key: 'ArrowDown', display: '↓', verb: 'next-control', does: 'next control' },
  { key: 'ArrowLeft', display: '←', verb: 'step-down', does: 'change the focused control down one step' },
  { key: 'ArrowRight', display: '→', verb: 'step-up', does: 'change the focused control up one step' },
  { key: 'Tab', display: 'Tab', verb: 'next-panel', does: 'next panel' },
  { key: '+', display: '+', verb: 'more', does: 'reveal this panel\'s More tier' },
  { key: '-', display: '-', verb: 'less', does: 'collapse this panel\'s More tier' },
  { key: 'C', display: 'C', verb: 'compare', does: 'compare A against B, blind' },
  { key: '1', display: '1', verb: 'keep-first', does: 'keep the first set' },
  { key: '2', display: '2', verb: 'keep-second', does: 'keep the second set' },
  { key: 'E', display: 'E', verb: 'explain', does: 'explain — open the fifteen-stage ladder' },
  { key: 'K', display: 'K', verb: 'snapshot', does: 'keep — snapshot this set' },
  { key: 'L', display: 'L', verb: 'restore', does: 'load — restore a snapshot' }
]

export const BINDINGS = [...TRANSPORT, ...LAB_KEYS]

/** Look up the verb for a KeyboardEvent. Case matters: `R` is replay, `r` is nothing. */
export function verbFor (event) {
  const k = event.key
  const hit = BINDINGS.find((b) => b.key === k)
  return hit ? hit.verb : null
}

/**
 * No key may mean two things on this surface (4a.2's own title). This is asserted by a test
 * rather than trusted, because the collision it prevents is invisible until a listener who is not
 * looking presses the key.
 */
export function collisions () {
  const seen = new Map()
  const out = []
  for (const b of BINDINGS) {
    const prior = seen.get(b.key)
    if (prior && prior.verb !== b.verb) out.push([prior, b])
    else if (!prior) seen.set(b.key, b)
  }
  return out
}
