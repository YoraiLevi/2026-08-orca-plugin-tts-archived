# 020 — The Voice Lab UI is a rewrite, not a polish

**Status:** open. **Opened** 2026-08-22, from the author's own session using it.
**Supersedes** the interaction model in `004-voice-lab.md`; the measurement work there stands.

## What he said, verbatim

> "the ui of the voice lab still makes no sense to me. i cannot edit/configure from the voice lab
> what's being pronounced and how, i just see the currently coded settings i think? there is no way
> for me to change anything here, i can just hear things"

> "i was expecting to have some kind of drop down/cyclic choice controls that allow me to pick and
> choose or even write down different modes and configs in the webui so i can live change the
> reading and test it live"

> "i don't understand what speak on change is because i cannot seem to be able change anything. i
> don't understand how blind works too"

## Why he is right, from the page's own footer

    46 controls · 12 engine- or pacing-provisional · 36 designed, not wired

**Thirty-six of forty-six controls cannot change anything.** The page renders them, names them,
and describes them — and moving one has no effect, because nothing consumes it. `wired` vs
`designed` was an honest internal distinction and it leaked into the product as a screen full of
dead switches.

## The four defects, in the order they hurt

**1. Most controls are inert.** A tuning instrument whose controls mostly do nothing is not a
tuning instrument. Either wire it or do not show it — a dead control is worse than a missing one,
because it costs the listener a press and a guess.

**2. The live ones have no visible affordance.** They cycle on a focused element via the keyboard,
with the discovery hint in a footer: `+/- more controls · ? describe the focused control`. He
looked for a dropdown, found `‹ announced ›` and an `EI` badge, and reasonably concluded it was a
readout. **He asked for dropdowns. Give him dropdowns.**

**3. `Speak-on-change` is meaningless when nothing is changeable.** It is the marquee feature of
the whole design and it cannot demonstrate itself.

**4. `Explain` overlaps its own audio.** Pressing *play this stage* twice speaks both at once with
no stop — *"the cacophony of the audio was horrible"*. Every play path must go through one queue
with one Stop. This is the barge-in guarantee the plugin already has, missing in the Lab.

## What it has to become

- **Every visible control is editable and takes effect on the next press.** Anything not wired is
  hidden, not greyed.
- **Real form controls** — a `<select>` for a choice, a slider for a number, a text box for a
  phrase. Keyboard shortcuts stay as an accelerator, never as the only route.
- **Free text and examples are editable in place**, and new examples can be created from a phrase.
  *(The server half landed 2026-08-22: `PUT`/`DELETE /fixtures/<name>`. The UI half is open.)*
- **One audio queue. One Stop.** Nothing can overlap anything.
- **Grouped by what a listener hears**, not by which options object a field lives in. "How paths
  are read" is a heading; `path.extensionStyle` is not.

## What NOT to change

The measurement work is sound and the round-trip guarantee is load-bearing: what the Lab speaks is
byte-identical to what the plugin will speak, proved by `g1-roundtrip.test.ts` across two
independent paths. **Any redesign keeps that.** The gate (p95 1,690 ms) and the cache-key
correctness (FR-023) also stay.

## The lesson worth carrying

This UI was reviewed for thirteen rounds by agents and passed every one. **It failed the first time
its actual user opened it.** No amount of adversarial review by people who cannot use the product
substitutes for the person who needs it. The reviews were not wrong about what they checked; they
were checking the wrong thing.
