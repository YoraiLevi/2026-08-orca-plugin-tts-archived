# 020 — The Voice Lab UI is a rewrite, not a polish

**Status:** the four defects are CLOSED and verified by effect (2026-08-22, `4c5313e` + `7bf408d`); what remains is his ears. **Opened** 2026-08-22, from the author's own session using it.
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


## What landed, 2026-08-22

Each row was checked against the running page by `scripts/ui-probe.mjs`, which drives real Chrome
and whose every check is proved able to go red by `--prove`. Not one of these is a claim from a
report.

| Defect | State | The check that would catch a regression |
|---|---|---|
| 1. Most controls inert | closed | **U1** moves every control on screen and demands a consequence. Handed the old 46, it names all 36 dead ones. |
| 2. No visible affordance | closed | **U2** sets a `<select>` and asserts the spoken text moves, then restores it and asserts it comes back. |
| 3. `Speak-on-change` could not demonstrate itself | closed | It is renamed *"Speak each change"* and there are now ten things to change. |
| 4. `Explain` overlapped its own audio | closed | **U4** presses the same stage twice on the warm path. Without the fix it measures **six sources sounding at once**. |

**How the 36 are handled.** Hidden, not greyed, as the spec required — they are below the fold in a
collapsed list, rendered as sentences with no affordance suggesting they are switches. They stay in
`CONTROLS` because `toSettingsFile()` iterates all 46 and C4's round-trip compares against it; what
changed is what the page RENDERS. When one is genuinely wired, deleting its `wire: null` is the
whole change and it appears among the live controls automatically.

**The example editor** is the other half of *"don't scatter me around to edit config files
locally"*: the text under test is a textarea, editing is live, and save / save-as / delete write
through the `PUT`/`DELETE /fixtures/<name>` that landed the day before.

### Still open, and it is his

**C7 — the taste defaults.** The instrument now works; what it is for has not happened. Nothing an
agent can do closes this.

**The 36 themselves are a product question, not a UI one.** They are hidden because nothing reads
them — `NormalizeOptions` has six fields. Wiring any of them means building the transform, which is
real work with a real ordering, and hiding them was the honest move rather than the whole answer.

### The lesson, restated with what it cost

Writing the probe reproduced the same failure three more times. U1's first version went green
against the broken page because it measured shape. U4's first three versions each passed because
the overlap was never reachable — the second press only paused the first, then waited on a counter
a suspended context could never move, then ran on the cold path where aborting the fetch already
prevents overlap. **Knowing the failure mode by name did not prevent it four times in one
afternoon.** Only `--prove` — running each check against the defect it claims to watch — caught
any of them.
