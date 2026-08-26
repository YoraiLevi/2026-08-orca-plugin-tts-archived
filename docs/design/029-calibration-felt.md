# 029 — Calibration: what the session feels like

**Written:** 2026-08-24, after the listener's first real ear session.
**Status:** design. One of three written in parallel (028 systematic, this one felt, 030 synthesis).
**Changes no code, no test, no control table.**

This document is the human half. It owns the spoken lines, the screens as lived, the
ten-minute story, the arc, the never-do, and the argument about "one by one." 028 owns
which decisions exist and which controls they fold. 030 owns the inversion and the
template shape. Where this file disagrees with 030, the disagreement is named in
section 10, not smoothed over.

---

## 0. Verdict

The Voice Lab is a mixing desk. He needed a fitting.

He opened a page with fourteen things in the header, a sidebar of knobs, two transcript
panes, and a footer. He wanted to sit down, hear a thing, pick the one that sounded
right, and know he was finished. Those are different rooms.

**"Calibrate every option one by one" is not what he wants.** It is what he asked for
because the alternative, that afternoon, was copy-pasting samples from an agent.
The load-bearing phrase is *"so i hear them individually instead of needing to copy
paste."* The unit he is asking for is **one sound at a time**, not one row of
`CONTROLS` at a time.

The front door is a ten-minute session: six sounds, one proof, an ending that says
it is an ending. The mixing desk is visit two, behind **"Just change one thing."**

---

## 1. The first ten minutes, today

Reconstructed from his verbatim complaints and from the page that was actually on
screen. He was in the room. The quotes are his. The minute marks are mine, labeled
`[judgment]`. The page facts are `[page]`.

### Minute 0 — it works, then it is a cockpit

He stages the model, opens the Lab, presses Play. Pocket TTS is clear. That part
works. He said so.

Then he is looking at this, and his eyes are not on it, because he is listening:

```
┌─ Voice Lab ── Example ▾ ── Play  Stop  Replay ─┬─ Tuning set A▾  Copy to the other set
│  Compare A and B   Blind test × 3              │  Keep a snapshot  Restore
│  Show every step   Describe this control       │  Speak each change: on
├────────────────────────┬───────────────────────┴─────────────────────────────────────┐
│ How a code block is    │  The words being read                                       │
│ handled          ▾     │  ┌─────────────────────────────────────────────────────┐    │
│ How a path is said ▾   │  │  (a whole example)                                  │    │
│ How an identifier      │  └─────────────────────────────────────────────────────┘    │
│ is said          ▾     │  WRITTEN              SPOKEN                                │
│ …ten more rows…        │  (underlines, [N]     (the reading, with stage numbers      │
│                        │   superscripts)        hanging off runs)                    │
└────────────────────────┴─────────────────────────────────────────────────────────────┘
  Ready. Nothing has played.          Nothing has played yet.     Save to plugin  Export
```

Fourteen things in the header. Counted from `voice-lab/index.html:164-192` `[page]`.
Every one of the five he later said he did not understand is already visible, at
minute zero, before he has anything to compare.

The page is silent until he presses. That part is right (P31). Everything else is
a mixing desk handed to someone who has not yet heard a single isolated choice.

### Minute 1 — the thing he came to fix

He finds **"How an identifier is said."** The control enumerates five styles
(`controls.mjs:151-155` `[page]`); he called them *"these 4"*. He does not know
the vocabulary. He changes one.

What he hears is not `XMLHttpRequest`. What he hears is:

> "How an identifier is said, as written."

That sentence is `changeSentence()` at `voice-lab/index.html:603` and
`setControl()` at `:2239-2242` `[page]`. Speak-each-change is on. It is doing
exactly what 004 designed: control name, then value, nothing else. For *rate*
that sentence is the sample. For *identifiers* it contains no identifier.

He changes another option. Same shape of sentence. The fixture may still be a
whole markdown file. The four readings are buried in it, if they are in it at
all.

And the control is `wire: null` (`voice-lab/lib/controls.mjs:151-155`) `[page]`.
Moving it changes nothing downstream. P47, in the chair, in the first minute:
a perfect widget, four labels, zero effect.

He also types, or already has, `XMLHttpRequest`. Pocket reads it as
*"xml hp request."* Our normalizer returns the string unchanged — that is a
measured fact from the brief, not a guess. He reasonably thinks this is the
identifier setting. It is the engine.

**This is where he gets annoyed.** He came to fix names. The page offered him a
control named for names. It spoke the name of the control. The names themselves
did not change.

### Minute 2 — announcement wording

He wants to hear the sentences the plugin says on its own behalf. There is no
sample of those sentences on the page. The current example is whatever fixture
was selected. If it has no omitted code block, no fallback, no skip, there is
nothing to hear. The templates (`omit.codeBlockPhrase`, `omit.urlPhrase`,
`announce.switchPhrase`, `announce.statusTemplate`) are all `wire: null`.

He said: *"Not sure how to hear the 'Announcement wording'."*

He is not lost in the vocabulary. He is lost because **the thing to judge is
not playing.**

### Minute 3 — the five buttons

He is listening. The explanations are in `title=` hover tooltips on those same
header buttons (`voice-lab/index.html:182-192`) `[page]`. Hover text, for a
person whose eyes are elsewhere. The words exist and never reach him. That is
also a measured fact from the brief.

He looks at **"Speak each change: on."** The key is `m`, which the code still
calls mute (`toggleMute` at `:3016`). The button is a state. The tooltip says
what it does. He never hovers. He does not know whether it is the reason the
page keeps talking, or a thing he has not tried yet.

He looks at **Tuning set A**, **Copy to the other set**, **Compare A and B**,
**Blind test × 3.** This looks like an experiment. He did not come to run an
experiment. He came to make it sound right. Compare, if he presses it with A
and B still identical, says *"The two sets are identical. Change a control,
then compare."* (`:2578-2581`) `[page]`. A dead end unless you already know
what a set is.

He looks at **Keep a snapshot** and **Restore.** Restore of what? He has not
kept anything. Restore with an empty stack says there are no snapshots yet.
**Describe this control** needs a focused control. He is not looking at the
sidebar. Focus may be nowhere he means.

**This is where he gets lost.** Not because the features are stupid. Because
they are tools for someone who already has a theory, shown to someone who has
"it doesn't sound right."

### Minutes 4 to 8 — wandering the desk

Some knobs work. Path style is wired. Rate is wired. Voice is wired. Most of
the ones whose names match what he cares about are not. Nothing on the live
rows says so. The honest list is below the fold, collapsed, *"Designed but not
built yet"* — which is the right treatment for a mixing desk (020) and the
wrong treatment for a man who just used one of those names as if it were live.

USABILITY.md, which is what he is supposed to open, tells him to pick
`fixtures/architecture.md` and move one control at a time. That is the
one-by-one he was offered. It is how a mixing desk is operated. It is also how
you spend twenty minutes and still cannot hear an identifier in isolation.

### Minutes 9 and 10 — no ending

Save to plugin sits in the footer. Export a copy next to it. Nothing has said
"you are done." Nothing has played a whole reply in the voice of the choices
he made and asked him to keep it. Nothing has said "from now on, this is what
you will hear."

He does the reasonable next thing. He tells an agent:

> "Make a calibrate setup that allows me to test each and every option one by
> one so i hear them individually instead of needing to copy paste what you
> just did."

That sentence is the design brief. The rest of this document is what should
have happened instead of the ten minutes above.

---

## 2. The first ten minutes, instead

Same person. Same ears. Same first visit. The mixing desk is not on screen.

### Minute 0 — the door

The page is still silent. One sentence is on the screen. The same sentence is
waiting in the live region, not yet spoken.

```
┌──────────────────────────────────────────────────────────────┐
│  Voice Lab                                                   │
│                                                              │
│  This is the first time.                                     │
│                                                              │
│  I'll read a few kinds of text, and you pick                 │
│  the one that sounds right.                                  │
│                                                              │
│  Six things. About ten minutes.                              │
│                                                              │
│     [ Space   Start ]      [  Just change one thing  ]       │
│                                                              │
│  Nothing plays until you press.                              │
└──────────────────────────────────────────────────────────────┘
```

He presses Space. Now, and only now, the page speaks:

> "This is the first time. I'll read a few kinds of text, and you pick the one
> that sounds right. Six things. About ten minutes."

Then, without asking him to look:

> "First. Who is reading."

If he already chose Eve and heard her clearly this sitting, skip this station
aloud: *"You're already Eve. Next, a name from the code."* Do not make him
re-pick a voice he just staged a model to hear. `[judgment]`

**"Just change one thing"** is always on this door. A session that cannot be
abandoned is worse than no session. That much is locked with 030.

### Minute 1 — who is reading, if it is still open

Short phrase, same one 021 already specified:

> Hello. I will read your work, file names, and numbers like forty-two milliseconds.

Arrow, hear the next voice. Return, keep this one. Stop cuts it. One voice at
a time. Never two.

> "Kept. Eve. One of six."

### Minute 2 — a name from the code

This is the station he came for. The whole screen is two identifiers and four
ways to say them. No fixture around them. No architecture.md. No underlines.

```
┌─  2 of 6  ──────────────────────────────── [ Stop ] [ Skip ] [ I'm done ] ─┐
│                                                                            │
│  A name from the code.                                                     │
│                                                                            │
│      XMLHttpRequest                                                        │
│      _flush_buffer()                                                       │
│                                                                            │
│  Four ways. I'll read each one.                                            │
│                                                                            │
│      1   As written                                                        │
│     ▶2   As words                              ← hearing this now          │
│      3   With a pause at the underscores                                   │
│      4   I'll write it                                                     │
│                                                                            │
│  Space hear this again     1 2 3 4 pick     Return keep this               │
│  B  I'm not sure — play two without names                                  │
└────────────────────────────────────────────────────────────────────────────┘
```

What the page says, in the moment it matters, before the sample:

> "A name from the code. Four ways. I'll read each one."

Then, for the one it is about to play:

> "Reading two. As words."

Then it speaks **the names**, in that style, and only the names.

Not *"How an identifier is said, as separate words."* That is the mixing-desk
confirmation. It does not contain a name.

**If `ident.style` is still `wire: null`, this screen must not offer a
choice.** See section 8, never-do 2, and section 10 question 3. The honest
beat, spoken once:

> "I can't change how this sounds yet. Pocket reads it like this."

*[plays XMLHttpRequest as Pocket actually says it]*

> "That's the engine, not a setting of mine. Press Space to go on."

He can hear the truth. He cannot "keep" a style that does not exist. That is
the version of P47 a session can still commit: finishing while changing
nothing.

He hears reading two. He thinks **that one.** He presses 2, or Return.

> "Kept. Names as words. Two of six."

**This is the middle of the arc.** "Oh, THAT one." It has to happen on an
isolated sound, in the first few minutes, or he will not trust the rest.

### Minute 4 — a file path

The sample is one path. The one he already named. Nothing else.

```
packages/core/src/normalizer/index.ts
```

Three readings, not five controls. The fifth control is folded into "I'll
write it."

> "A file path. Three ways."
> "Reading one. The name, the kind last, then where it is."
> *[plays that reading of that path, and only that path]*

He wants a wording the three do not contain. He presses 4, **I'll write it.**

```
┌─  Your wording  ─ a file path ─────────────────────────────────────────────┐
│                                                                            │
│  Type how you want this said. I read it back when you pause.               │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ index, typescript, in normalizer                                     │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                              yours, not a preset           │
│                                                                            │
│  packages/core/src/normalizer/index.ts                                     │
│  →  "index, typescript, in normalizer"                                     │
│                                                                            │
│  Return  keep this          Esc  back to the three                         │
└────────────────────────────────────────────────────────────────────────────┘
```

Spoken:

> "Write it the way you want it said. I'll read it back as you pause."

The box starts as the reading he was on. Editing flips the label to **yours**.
That is his sentence, verbatim, turned into behaviour: *"the picks shall be
default template that if i edit become custom readings."*

He hears the custom line. That is a second "oh, THAT one."

> "Kept. Paths, in your wording. Three of six."

### Minute 6 — a number, then a skip

A number with a unit. Two readings. The sample is `52 ms`, because that is the
one that sounded odd.

> "A number. Two ways."
> "Reading one. Fifty-two milliseconds."
> "Reading two. Fifty-two ms."

Then a skip. The page manufactures the situation. He does not have to find a
fixture that contains a code block.

> "When I skip something. I'm going to skip a code block, the way I would in
> a real reply."
> "Reading one. I tell you I skipped it."
> *[plays: "Here, a code block is omitted."]*
> "Reading two. I skip it in silence."

He can press **I'll write it** on reading one and type the sentence. The
filled values sit under the box so he hears the filled sentence, not the
braces: `typescript`, `twelve lines`.

This is how announcement wording becomes hearable. Not a hunt through
examples. A situation the page creates, then a sentence he can rewrite.

> "Kept. I tell you when I skip. Five of six."

### Minute 8 — how fast, if it is still open

A sentence at this speed, then a nudge slower, then a nudge faster. The
sentence can be the confirmation itself; for rate, 004 was right.

> "How fast. This is how I sound now."
> *[plays a short sentence at 1.0]*
> "Slower." / "Faster." / "As it is."

### Minute 9 — the proof, which is the ending

The room changes. No more numbered readings. One paragraph. The hostile
shape: a path, a name, a number, a skipped block, ordinary prose.

```
┌─  6 of 6  ─ this is the end ───────────────────────────────────────────────┐
│                                                                            │
│  This is how I will read your work.                                        │
│                                                                            │
│  ♪  (a real reply, ~twenty seconds, in the choices just made)              │
│                                                                            │
│  Names      as words                                                       │
│  Paths      index, typescript, in normalizer                      yours    │
│  Numbers    fifty-two milliseconds                                         │
│  Skips      "Here, a code block is omitted."                               │
│  Voice      Eve                                                            │
│  Speed      as it is                                                       │
│                                                                            │
│  [ Keep this ]   [ Hear it again ]   [ Change one thing ]   [ Start over ] │
│                                                                            │
│  Keep means: from now on, agent replies sound like that.                   │
└────────────────────────────────────────────────────────────────────────────┘
```

Spoken, before the paragraph:

> "This is how I will read your work."

Then the paragraph. Then, after it finishes, not over it:

> "Keep this? From now on, replies will sound like that."

He presses Keep.

> "Saved. You're done. Open this page any time to change one thing."

The chrome goes away. Play, Stop, **Change one thing.** That is what an
ending feels like: the room gets simpler, and a sentence about the future
has been said, and a file has been written.

**If he leaves without Keep, nothing is written.** Closing the tab does not
save. The next visit starts at the door, with his last Keep still in the
file. Never punish an abandoned session by writing it.

---

## 3. The arc

```
BEGINNING                         MIDDLE                         END
I don't know what I want          oh, THAT one                   I'm finished, and I trust it
        │                              │                                  │
        │   isolated sound             │   a whole reply                  │
        │   two to four readings       │   in MY choices                  │
        │   a keep that counts         │   a future-tense sentence        │
        │                              │   the room getting simpler       │
        ▼                              ▼                                  ▼
"Six things. About ten            "Kept. Names as words.         "Saved. You're done.
 minutes."                         Two of six."                   From now on, replies
                                                                  will sound like that."
```

**The beginning** has to name the job, the count, and the time, in sentences
a person would say. "Voice Lab" is a place. "I'll read a few kinds of text,
and you pick the one that sounds right" is a job.

**The middle** is the first isolated keep. If that keep does not happen on a
sound he actually came to judge, the rest is a tour. Identifiers first, after
voice, because that is what he reached for.

**The ending** is four things at once. Missing any one of them is why today
does not feel finished.

1. **A count that lands.** "Six of six." Not a progress bar he has to look at.
2. **A proof, not a setting list.** A whole reply, in the choices, spoken.
3. **A future-tense sentence.** "From now on, replies will sound like that."
   Today the closest thing is a footer button named Save to plugin. That is
   a file operation. It is not an ending.
4. **The room getting simpler.** Session chrome goes away. If the fourteen
   header buttons are still there, it is not over.

The mixing desk, on a later visit:

```
┌─  Change one thing  ───────────────────────────────────────────────────────┐
│                                                                            │
│  What sounds wrong?                                                        │
│                                                                            │
│      A name from the code                                                  │
│      A file path                                                           │
│      A number                                                              │
│      When I skip something                                                 │
│      The voice                                                             │
│      How fast                                                              │
│      Something else — show the mixing desk                                 │
│                                                                            │
│      [  Calibrate from the start  ]                                        │
└────────────────────────────────────────────────────────────────────────────┘
```

Spoken:

> "What sounds wrong?"

**Something else — show the mixing desk** is how the 46 survive without being
the front door. 020 still holds: a visible tuning control takes effect, or it
is not visible as a control.

---

## 4. The five features, as sentences a person would say

All five exist. All five have a `title=` tooltip. All five failed because they
are mixing-desk tools shown at minute zero, explained in hover, to a man
listening with his eyes elsewhere.

The version that explains itself is not a better tooltip. It is a sentence
spoken in the moment the feature is used, or the feature disappearing into
behaviour so no sentence is needed.

### Speak each change

**On the page today:** a header toggle, `m`, labelled as a state. Tooltip:
*"After you change a control, hear the difference immediately without pressing
Play."* (`index.html:192`) What it actually speaks is the control's name
(`changeSentence`).

**Why it failed.** The toggle is a switch for the product. The sample is the
wrong text. He was listening for `XMLHttpRequest` and heard the label of a
dropdown.

**The sentence a person would say:**

> "Say it the new way when I change something."

**What should happen.** During the session there is no toggle. Speaking the
new way *is* the station. The sample is the thing under judgment, not the
knob's name. On the mixing desk, later, the same rule: changing "how a path
is said" plays the path, once, in the new way. If someone needs it off, the
label is that sentence, not "Speak each change: on."

030 deletes the toggle. This file agrees, for the session. On the mixing desk
a mute still has to exist, because dragging a slider at 250 ms debounce is
how you get thirty utterances (P21). Mute is a desk tool. It does not belong
on the door.

### The A/B setup

**On the page today:** Tuning set A/B, Copy to the other set, Compare A and B.
Tooltip on Compare: *"Play set A, then set B, and pick the one that sounded
better."* (`:183`)

**Why it failed.** It assumes two theories. Copy-then-edit-then-compare is a
four-step ritual to hear two options. He has zero theories. He has "it
doesn't sound right."

**The sentence a person would say:**

> "Hear this way, then that way. I'll pick."

**What should happen.** That sentence *is* a station. Readings 1 and 2 are
the two ways. There is no set to copy. Compare-as-a-header-button does not
exist at minute zero. If he is on the desk later and has two live candidates,
the button that appears is labelled with that sentence, not "Compare A and B."

### Blind test

**On the page today:** Blind test × 3. Tooltip: *"The same two sets three
times in a random order, without telling you which is which, so your ears
decide and not your expectations."* (`:184`)

**Why it failed.** Ceremony for a person who already distrusts their own
bias. 004 Q21 already said he is not a research subject. Showing × 3 at
minute zero is researcher-think leaking onto the door.

**The sentence a person would say:**

> "Play those two again without saying which is which."

**What should happen.** That sentence is the `B` key, and it is only live
*inside a station, after two readings exist.* Default is name-then-sample
(section 10, question 1). Blind is opt-in at the moment of doubt: "I'm not
sure." It is not a header button, and it is not three trials unless he asks
for three.

030 absorbs blind into "sample first, name second" as the default. This file
disagrees. Unlabelled readings ask him to hold four sounds and map them onto
numbers afterwards. Working memory is small. The bias 004 wanted to remove
is real, and cheap, and belongs on the *I'm not sure* key — not on every
station of a first visit.

### Snapshot tools

**On the page today:** Keep a snapshot / Restore. Tooltips: *"Keep the current
set so you can come back to it."* / *"Go back to the last snapshot you kept."*
(`:188-189`) Restore is last-one-only. The stack is invisible. Names are
"snapshot one."

**Why it failed.** A stack you cannot see, for a session that has no concept
of "before." He has not kept anything. The word "snapshot" is not a thing a
person says about a voice.

**The sentence a person would say:**

> "Remember this in case I mess it up."

**What should happen.** Every Keep inside the session is a restore point.
Back goes to the previous station, with that station's keep. No naming. No
header buttons. At the ending, Keep this writes the file. If he wants to
throw away the last station, Back is enough. Automatic session-end save of
an unnamed snapshot is how you overwrite a file he did not agree to — do
not do that (section 8, never-do 8).

### Describe this control

**On the page today:** `?` Describe this control. Tooltip: *"Say the focused
control's name, what it does, and its current value."* (`:191`) Implementation
speaks `label. help Currently value.` (`describeFocused`, `:2988-2997`).

**Why it failed.** It requires knowing which control is focused. He is not
looking. The help text was already in a tooltip. A third copy, behind a
button named for a focus state, does not reach him.

**The sentence a person would say:**

> "What am I listening to?"

**What should happen.** The page answers before he asks, in the same breath
as the sample: *"A name from the code. This is reading two: as words."* Then
the names. `?` can repeat that sentence. It does not depend on sidebar
focus. On the mixing desk, landing on a row speaks that row's version of the
same sentence, once, and the sample of the thing, not only the help string.

---

## 5. What this never does

These are close-the-tab moments. Ranked by how fast he leaves.

1. **Never speak two things at once.** Already earned. *"The cacophony of the
   audio was horrible."* One queue, one Stop, every path. 020 defect 4.

2. **Never offer a choice whose two readings sound the same.** That is P47
   in session clothing. `ident.style` at `wire: null` is the current case.
   Announcement templates at `wire: null` are the next. A station you can
   complete while the audio does not move is a lie with a progress count.

3. **Never explain in a hover tooltip.** The five failures were all written,
   all true, and all in `title=`. If the sentence matters, speak it, or put
   it on the screen next to the thing, or do not have the feature yet.

4. **Never play a whole fixture to judge one kind of text.** A path is a
   path. A name is a name. `architecture.md` is a reply. Using a reply as
   the sample for an identifier is why he could not hear the four.

5. **Never confirm a setting by speaking the setting's name.** "How an
   identifier is said, as written" is a receipt. He needs the goods.

6. **Never dump the mixing-desk chrome at minute zero.** Fourteen things in
   the header is a cockpit. Compare, blind, snapshot, describe, speak-each-change,
   copy-to-the-other-set — none of these have a use until there is a thing
   to compare, a doubt, a keep, or a desk.

7. **Never autoplay, never speak on load.** P31. The door is silent. Space
   starts it.

8. **Never write the settings file without Keep.** Closing the tab, skipping
   a station, pressing I'm done, killing the tab — none of these save.
   Abandoned sessions must not overwrite a previous Keep.

9. **Never trap him in the session.** Skip, I'm done, and Just change one
   thing are always available. A wizard he cannot leave is worse than the
   mixing desk.

10. **Never pretend Pocket's pronunciation is a setting we own.**
    `XMLHttpRequest` → `"XMLHttpRequest"` unchanged, then Pocket says
    *"xml hp request."* If we let him "keep" split-words and tomorrow's
    replies still say *xml hp request*, he will not open the tab again.
    Either the transform exists, or the station tells the truth and does
    not offer a keep.

11. **Never ask him to copy-paste what an agent just did.** That is the
    sentence this whole design exists to retire.

12. **Never use vocabulary he does not have on the door.** EI, Tuning set,
    Blind test × 3, Describe this control, Speak each change, snapshot.
    The door speaks like a person.

13. **Never tell him he is done without a proof paragraph and a
    future-tense sentence.** A footer Save is a file operation. It is not
    an ending.

14. **Never grey out a dead control and leave it looking like a control.**
    020: hidden, not greyed, or rendered as a sentence that says it is not
    built. A session simply does not include it as a choice.

15. **Never start the next station on top of the last sample.** Stop, then
    the next sentence. He has one pair of ears.

---

## 6. Is "every option one by one" what he wants?

**Verdict: no.** He wants every *sound* one by one. He asked for every
*option* because that was the only lever he could see.

### What he actually said

> "Make a calibrate setup that allows me to test each and every option one
> by one so i hear them individually instead of needing to copy paste what
> you just did."

Two halves. The second half is the pain: copy-paste, mixed samples, cannot
isolate. The first half is the request you make when you do not trust the
page to choose the things worth hearing.

### Why a 46-station tour would make him close the tab

- He is voice-first, dyslexic, and running several agents at once. Time is
  scarce. Forty-six isolated decisions is a second job, not a fitting.
- **36 of 46 are `wire: null`.** Calibrating them is P47 with a progress
  count. The session would ask him to keep settings that do not exist.
- He already named the sounds that matter: identifiers, paths, announcement
  wording. Voice and rate are in his ears from this sitting. A skip. A
  proof. That is the first visit.
- Panel F (queue depth, overflow, interrupt granularity, clipboard caps)
  cannot be heard from a lab fixture the way a path can. Putting them in
  the first session trains him that calibration is abstract.
- 004's own leftover taste list is small: identifier default, path depth,
  announcement wording, overhead budget. USABILITY.md section 1 asked him
  for four decisions, not forty-six. The desk forgot that.

### What "one by one" correctly demands, and must keep

- **One class of text on the table.** A name, or a path, or a number. Not
  a reply that contains all three.
- **Two to four readings, heard in isolation, keep one, count it, next.**
- **A way to write the reading when the menu is wrong.** That is the
  template request, and it is load-bearing. Menus are starting points.
- **No agent in the loop.** The page produces the samples. That is the
  end of copy-paste.

### The shape

```
what he asked for, literally          what he asked for, actually
────────────────────────────          ────────────────────────────
46 options                            ~6 sounds
each control, in table order          each class of text he hears
dropdown, then Play on a fixture      2–4 isolated readings of that class
agent pastes a sample                 the page is the sample
no ending                             a proof, then Keep, then simpler
```

Visit two is **"What sounds wrong?"** Visit three, if he wants it, is the
mixing desk. Anyone who wants 46 can have 46. Nobody is greeted with 46.

---

## 7. The six sounds of the first session

Not nine, not forty-six. Six, plus the proof which is the ending, not a
seventh choice.

| # | Sound | Sample on the table | Readings he hears | Folded controls (028 maps these) |
|---|---|---|---|---|
| 1 | Who is reading | 021's audition sentence | the voices that can speak | `voice.id` |
| 2 | A name from the code | `XMLHttpRequest` · `_flush_buffer()` | as written / as words / pause at underscores / I'll write it *(five enum values collapsed to three presets plus custom; "announced as a function" and "leading underscore spoken" live in I'll write it, or on the desk)* | `ident.style`, `ident.parens` — **only if wired** |
| 3 | A file path | `packages/core/src/normalizer/index.ts` | three spoken shapes / I'll write it | `path.style`, `path.extensionStyle`, `path.depthPolicy`, `path.depthN`, the two phrases |
| 4 | A number | `52 ms` | words / left as written | `num.expandIntegers`, `num.expandUnits` |
| 5 | When I skip something | a code block the page invents | tell me / silence / I'll write it | `omit.codeBlocks`, `omit.codeBlockPhrase` (and later, links) |
| 6 | How fast | one short sentence | slower / as it is / faster | `voice.rate` |

Then the proof paragraph. Then Keep.

**Deliberately not in the first session:** headings, lists, tables, emoji,
chunk gaps, queue depth, session labels, huddle caps, interrupt
granularity, pitch, volume. Those are "What sounds wrong?" or the desk.
Headings that collapse to nothing are real, and they are not what he
reached for in the first sitting.

**Announcement wording, which he named, lives in station 5** as a skip he
can rewrite. System-status announcements (engine missing, fallback,
download) are a different ear and a rarer event. They are visit two. Mixing
them into the first session is how you play him a sentence he cannot
connect to anything he just heard.

---

## 8. Sentences the page actually says

Not descriptions of sentences. The inventory. If an implementer needs a
line, it is here. If a line is not here, the page does not improvise a
cousin.

**Door, after Space**

- "This is the first time. I'll read a few kinds of text, and you pick the one that sounds right. Six things. About ten minutes."
- "You're already Eve. Next, a name from the code." *(only if voice is already settled this sitting)*

**Station open**

- "First. Who is reading."
- "A name from the code. Four ways. I'll read each one."
- "A file path. Three ways."
- "A number. Two ways."
- "When I skip something. I'm going to skip a code block, the way I would in a real reply."
- "How fast. This is how I sound now."

**A reading**

- "Reading one. As written."
- "Reading two. As words."
- "Reading three. With a pause at the underscores."
- "Reading one. The name, the kind last, then where it is."
- "Reading one. Fifty-two milliseconds."
- "Reading two. Fifty-two ms."
- "Reading one. I tell you I skipped it."
- "Reading two. I skip it in silence."
- "Slower." / "Faster." / "As it is."

Then the sample of the thing. Never the other way round, except on `B`.

**Keep / skip / back**

- "Kept. Eve. One of six."
- "Kept. Names as words. Two of six."
- "Kept. Paths, in your wording. Three of six."
- "Kept. I tell you when I skip. Five of six."
- "Skipped. We'll leave names as they are. Two of six."
- "Back. A file path."

**Can't**

- "I can't change how this sounds yet. Pocket reads it like this." *[sample]* "That's the engine, not a setting of mine. Press Space to go on."
- "Those two sound the same, so this isn't a choice yet. Press Space to go on."

**Doubt (`B`)**

- "I'll play two of them again without saying which." *[sample] [gap] [sample]* "Press 1 for the first, 2 for the second."
- "You picked the second. That was as words."

**Custom**

- "Write it the way you want it said. I'll read it back as you pause."
- "Yours."

**Ending**

- "This is how I will read your work." *[proof paragraph]*
- "Keep this? From now on, replies will sound like that."
- "Saved. You're done. Open this page any time to change one thing."
- "Nothing was saved. Your last Keep still stands." *(I'm done, or the tab closed, without Keep this)*

**Visit two**

- "What sounds wrong?"
- "The mixing desk. Every control here changes what you hear, or it is not on this list."

**Stop, always**

- "Stopped."

No other line talks over a sample. No line is only in a tooltip.

---

## 9. Failure modes, felt

The dangerous class is silent, misdetected, or reports-success-falsely.
Coverage is the list below. Anything not on it is not claimed as analysed.

| # | What happens | What he hears | Why it is deadly | What the session does |
|---|---|---|---|---|
| F1 | A station is offered for a `wire: null` control | two readings that match, or a label-change with no sample-change | he "keeps" a setting that will not be in tomorrow's replies | refuse the choice; speak the can't-line; do not count a keep |
| F2 | Pocket mangles a raw identifier and we call it a style | "xml hp request" both before and after Keep | he believes calibration is broken at the thing he cares about most | same as F1, named as the engine, not as a setting |
| F3 | Speak-on-change / next station overlaps the sample | two voices | close the tab (already happened) | one queue, Stop first, then the next line |
| F4 | Proof paragraph plays before he has kept anything | a default he did not choose, billed as "how I will read your work" | false ending | proof is 6 of 6 only; I'm done without Keep does not play a fake proof as saved |
| F5 | Tab close or I'm done writes the file | nothing, or a surprise tomorrow | overwrite without Keep | write only on Keep this |
| F6 | Session cannot be left | he is still in station 3 and wants the desk | wizard-trap; close the tab | Skip, I'm done, Just change one thing, always |
| F7 | Custom template is spoken with braces | "open brace name close brace" | unusable custom, the feature he asked for | speak the filled sentence; unknown slot is an error, named, nothing spoken of the sample (030's rule, kept) |
| F8 | Progress says 6 of 6 after skips of unwired stations | "you're done" having judged nothing | false completion | skipped-because-unwired does not count as a judged keep; the ending names "four judged, two I can't change yet" |
| F9 | Mixing desk still shows a dead widget as a dropdown | the minute-1 identifier failure, on visit two | 020, again | 020's rule, restated: sentence, not switch |

**Deliberately excluded from this analysis:** server-down, spoke-elsewhere,
download-of-Pocket. Those have pages in 021 and in the current Lab. The
session uses them; it does not redesign them.

---

## 10. Open questions

### Question 1 — name then sample, or sample then name?

**Situation.** 030 argues ear-first so the label cannot bias the ear, and
treats that as absorbing the blind test. He already could not hear four
identifier options.

**Problem.** Four unlabelled readings require holding four sounds and
mapping them onto 1–4 afterwards. That is working memory. He is dyslexic
and voice-first. Bias is real. Disorientation is also real.

**Options.**

1. Sample first, name after (030's lean).
2. Name first, then the sample of the thing.
3. Name quietly *and* play the thing; blind on an explicit "I'm not sure."

**Recommendation: 3.** The spoken name is one short sentence ("Reading two.
As words."), then the names themselves. Blind is the `B` key, at the moment
of doubt, not the default. 004 Q21: he is not a research subject. Ceremony
that costs a click per trial is worse than the bias it removes — and a
default that costs four unlabelled holds is ceremony by another name.

### Question 2 — six sounds, or nine decisions, or forty-six options?

**Situation.** 030 proposes a queue of about nine decisions. He asked for
every option. Ten controls are wired.

**Problem.** Nine may still be where he gets bored. Forty-six is a job.
Three (only what he named) skips voice, rate, and the proof.

**Options.**

1. Three: identifiers, paths, announcement wording.
2. Six plus proof, as in section 7.
3. Nine, 030's number.
4. Every wired control, currently ten.

**Recommendation: 2.** Identifiers, paths, skips, numbers, voice, rate,
then a proof. Structure and interruptions wait for "What sounds wrong?"
028 may split a sound into two decisions if the readings cannot carry both;
the *session* still presents one sound. If 028 needs a seventh sound to
keep a reading honest, add it. Do not add it to reach a round number.

### Question 3 — the identifier station, while it is unwired?

**Situation.** It is the first thing he tried. `ident.style` is `wire: null`.
Pocket, not us, pronounces `XMLHttpRequest`.

**Problem.** Hide it, and tomorrow still says *xml hp request*, and the
session looks like it ignored him. Show it as a choice, and we commit F1
and F2.

**Options.**

1. Hide until the transform exists.
2. Show an honest non-choice: the can't-line, then go on. No Keep on a style.
3. Block the whole first session until identifiers are real.

**Recommendation: 2, and build the transform first.** The honest beat takes
fifteen seconds and tells him we heard him. The choice waits. 3 is how a
missing feature holds a fitting hostage. 1 is how he thinks we ignored the
complaint. 030 already says this is a missing feature, not a missing
explanation, and should be built first. This file agrees, and adds: the
session may ship without the *choice*, not without the *truth*.

### Question 4 — does a returning visitor see the door or the desk?

**Situation.** First visit wants a session. Second visit may be "the paths
are too long."

**Problem.** Always-session is a trap. Always-desk is today.

**Options.**

1. Always the door.
2. Door until one Keep this has ever happened; then "What sounds wrong?"
3. Always "What sounds wrong?" with Calibrate from the start as a choice.

**Recommendation: 2.** The door is for a machine with no Keep. After one
Keep, the door is "What sounds wrong?" with Calibrate from the start still
on it. First-time-this-browser and first-time-this-settings-file should
agree; if they disagree, the settings file wins, because that is what
tomorrow's replies use.

---

## 11. Grounding, and what this file does not reopen

**His words, from the brief, all eight:** identifier readings were a hard
hear, and `http` came out *xml hp request*; he wants a template string
whose picks become custom when edited; he could not hear announcement
wording; he asked for calibrate-one-by-one instead of copy-paste; he did
not understand speak each change, A/B, blind, snapshots, or describe this
control.

**Measured, from the brief:** `normalize('XMLHttpRequest')` is unchanged;
10 of 46 wired; 36 `wire: null` including every path control *and* the
identifier control he used; all five unexplained features have hover
tooltips.

**Page, cited above:** header at `voice-lab/index.html:164-192`; tooltips
on `:182-192`; `changeSentence` / `setControl` confirmation; compare
identical-set refusal; `describeFocused`; `ident.style` `wire: null` at
`voice-lab/lib/controls.mjs:151-155`.

**Already closed, not reopened:** 020's four defects (inert controls,
affordance, speak-on-change that cannot demonstrate, overlap). 021's voice
picker, one native select, Hear this voice, honest unavailability. Q20
browser playback. G1 round-trip. One audio queue. P31 no audio without a
press. P47 consequence, not shape.

**Taste, still his:** which reading is the default, once he has heard it.
This file designs the option space and the session that presents it. It
does not pick Eve, does not pick "as words," does not pick a path template.

---

## 12. Falsifier

If he can finish this session without ever hearing an isolated identifier,
or a path, or a skip-sentence, in two to four readings, with a keep that
counts — this design has failed.

If he can Keep a reading that does not change tomorrow's audio — this
design has failed. That is P47. The progress count will not save it.

If at the end he does not hear a whole reply in his choices, and does not
hear "you're done" and "from now on," and the fourteen header things are
still the room — this design has failed, even if every station was correct.

If the first screen is still the mixing desk — this design was not
implemented, however complete the control table is.

---

## 13. What 028 and 030 should take from this

- The spoken inventory in section 8 is the copy. Do not paraphrase it into
  a cousin on the way to a spec.
- Stations are sounds, not rows. 028 folds controls behind a sound. It
  does not present `path.depthN` as a station.
- Templates are how a pick becomes custom. 030's screen 2 is the right
  shape; the felt constraint is: he is writing the *sentence he will hear*,
  and he hears the filled sentence as he pauses, never the braces.
- Disagree with 030 on default-blind. Agree on: session as front door,
  desk as reference, unbuilt is not a widget, identifier transform before
  identifier choice, abandonable always.
- Do not implement from this file. This file is what it should feel like.
  028 plus 030 plus this, reconciled, is what it should be.
)
