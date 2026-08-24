# 030 — Calibration: the coordinator's design

**Written:** 2026-08-24, after the listener's first real ear session.
**Status:** design. One of three written in parallel (028 systematic, 029 felt, this one).
**Changes no code.**

## The diagnosis: eight complaints, one root cause

He raised eight things. They are not eight problems.

| What he said | What it really is |
|---|---|
| "not sure if i have ui to configure it" | the control is `wire: null` — it does nothing |
| "give me a template string, not a drop down" | the menu is a **closed vocabulary** |
| "not sure how to hear the announcement wording" | no sample exists for that class of text |
| "make a calibrate setup … one by one" | **auditioning is not a control-panel activity** |
| "didn't understand 'speak each change'" | a toggle for the tool's whole purpose |
| "don't understand the A/B setup nor the blind test" | power tools shown at minute zero |
| "don't understand what the snapshot tools are doing" | ditto |
| "don't understand 'describe this control'" | ditto — and its help lives in a **hover tooltip** |

**The root cause: the Voice Lab is a control panel, and calibration is not a control-panel
activity.**

A control panel answers *"where do I change X"*. It assumes you already know what you want. But a
listener calibrating by ear does not know what he wants until he has heard the alternatives — the
whole point is that the answer is not knowable in advance. So the page hands him 46 knobs and he
correctly asks *what should I be listening to right now?* Nothing on screen answers that.

Everything else follows. Tooltips are a control-panel idiom (hover the knob, read the label). A/B
sets, snapshots and blind trials are control-panel idioms too — they are for someone who already
has two candidate configurations. He does not have one yet.

## The inversion: the unit is a DECISION, not a control

```
   TODAY                              PROPOSED
   ┌──────────────┬──────────────┐    ┌───────────────────────────────┐
   │ 46 controls  │              │    │  Decision 3 of 9              │
   │ ▸ knob       │  transcript  │    │  How should a path be said?   │
   │ ▸ knob       │              │    │                               │
   │ ▸ knob       │              │    │  ♪ hear · ↓ next · ⏎ keep     │
   │ ▸ knob  ×36  │              │    │                               │
   │   (do        │              │    │  [ the sample, and only the   │
   │    nothing)  │              │    │    thing being decided ]      │
   └──────────────┴──────────────┘    └───────────────────────────────┘
   "where do I change X"               "what should X be"
```

A calibration session is a **queue of decisions**. Each has a sample, a small set of readings, and
an ending. The 46-control sidebar does not vanish — it becomes the *reference* view, for the day he
wants to change one thing without a session. It is no longer the front door.

## Screen 1 — Calibrate

```
┌─ Calibrate ─────────────────────────────── decision 3 of 9 ─┐
│                                                             │
│  How should a path be said?                                 │
│                                                             │
│  packages/core/src/normalizer/index.ts                      │
│                                                             │
│    ♪  ▶ hearing reading 2 of 4 …                            │
│                                                             │
│       1  "packages slash core slash src slash …"            │
│    ▶  2  "index typescript, in normalizer"                  │
│       3  "index typescript"                                 │
│       4  your own wording…                          ✎       │
│                                                             │
│  ␣ hear again    ↓↑ move    ⏎ keep this    b  2 vs 3        │
│  e edit wording  s  skip    ⌫ back         ? what is this   │
└─────────────────────────────────────────────────────────────┘
```

**Sample first, name second.** The reading plays, *then* the page says which one it was. The ear
judges before the label can bias it — and this quietly absorbs the "blind test" feature, which
becomes the default behaviour instead of an exotic mode nobody understood.

**The last option is always "your own wording"**, so the menu can never be a closed vocabulary.

## Screen 2 — Template, reached by pressing `e`

```
┌─ Your own wording ── How a path is said ────────────────────┐
│                                                             │
│  Start from:  ( ) full path   (•) name and folder   ( ) name│
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ {name} {ext:word}, in {folder:last}                   │  │
│  └───────────────────────────────────────────────────────┘  │
│                                          ▲ edited → CUSTOM  │
│                                                             │
│  {name} {ext} {ext:word} {folder:last} {folder:all}         │
│  {depth:2} {sep}          ← click or type; ? explains each  │
│                                                             │
│  packages/core/src/normalizer/index.ts                      │
│  →  "index typescript, in normalizer"              ␣ hear   │
│                                                             │
│  ⏎ keep    r back to the preset    (unknown {slot} = error, │
│                                     named, nothing spoken)  │
└─────────────────────────────────────────────────────────────┘
```

Every preset **is** a template. Choosing one writes its text into the box; editing the text flips
the label to CUSTOM; `r` restores the preset. There is no hidden formatting anywhere — exactly what
he asked for, generalised to identifiers (`{words} {case:announce}`) and to announcements
(`"{engine} was unavailable, using {fallback}"`), which is how "I can't hear the announcement
wording" stops being true: it is just another decision with a sample and a Play key.

## Screen 3 — the ending

Nothing today tells him he is finished. Calibration needs a last page.

```
┌─ Finished ──────────────────────────────────────────────────┐
│  9 decisions · 7 changed · 2 left as they were              │
│                                                             │
│  ♪ Here is a paragraph read the way you just chose.         │
│                                                             │
│  identifiers  as separate words                             │
│  paths        {name} {ext:word}, in {folder:last}   CUSTOM  │
│  numbers      spoken as words                               │
│  …                                                          │
│                                                             │
│  ⏎ use these    r  redo one    ␣ hear it again              │
└─────────────────────────────────────────────────────────────┘
```

## What happens to the five features he could not understand

They were not bad ideas. They were shown at minute zero to someone with nothing to compare yet.

| Feature | Fate |
|---|---|
| **Speak each change** | becomes the default and the toggle is deleted. Speaking the difference **is** the tool; a switch for it is a switch for the product |
| **Blind test** | absorbed into "sample first, name second". No mode, no button |
| **Compare A and B** | collapses into `b` — "hear 2 vs 3" — which is what comparing actually means during a decision |
| **Keep a snapshot / Restore** | becomes `⌫ back` inside a session, and one automatic save when a session ends. Nobody should have to name a snapshot |
| **Describe this control** | `?` stays, but the same sentence appears **on screen next to the decision**. A tooltip is not an explanation for a person who is listening |

The general rule: **no feature explains itself in hover text**, and nothing appears before the
listener has a use for it.

## The 36 unbuilt controls

He could not tell which knobs do nothing, because nothing says so. During calibration the queue
contains **only decisions that are real** — 9 today, not 46. In the reference view an unbuilt
control renders as a statement, not a widget:

```
  How an identifier is said                       NOT BUILT YET
  Chooses how getUserById is spoken. Nothing is wired to this;
  changing it will not change what you hear.
```

## The identifier reading is not a UX problem

`normalize('XMLHttpRequest')` returns `"XMLHttpRequest"`. The bad reading is Pocket's own
pronunciation of a raw identifier — **we do nothing to identifiers at all**, and `ident.style` is a
placeholder. No amount of calibration UI fixes that; the transform has to exist before a decision
about it is meaningful. It is the one item on his list that is a missing feature rather than a
missing explanation, and it should be built first, because it is the decision he most wants to make.

## What I am least sure about

- **Sample-then-name, or name-then-sample?** I argue ear-first. But hearing four unlabelled readings
  may just be disorienting, and the honest answer may be: name it quietly *and* play it.
- **Nine decisions or nine categories?** Paths alone have five controls. Collapsing them into one
  "how should a path sound" decision with a template is cleaner, but it hides real choices.
- **Does he want a session at all**, or does he want to fix one thing and leave? A session that
  cannot be abandoned halfway is worse than no session.
