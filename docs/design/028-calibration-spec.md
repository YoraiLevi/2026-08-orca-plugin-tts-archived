# 028 — Calibration is one audible decision at a time

**Status:** design specification; no implementation is part of this document.

**Scope:** the systematic calibration route in Voice Lab: start, hear one decision in isolation,
choose, resume, review, save, and export. The free-form written-versus-spoken inspector remains an
advanced tool, but it is not the calibration experience.

**Evidence:** the listener's first real ear session in `ux-brief.md`, the measured 10-of-46
reachability fact, PITFALLS P47, and the current `voice-lab/index.html` and
`voice-lab/lib/controls.mjs`.

**Relationship to earlier designs:** for the systematic calibration route, this replaces 004's
global A/B, snapshot, Blind ×3, “Speak each change,” More-tier, and Tab-as-panel interaction. It
also replaces 020's collapsed disclosure of the 36 inert decisions with the explicit availability
model in section 7. The round-trip production-path and revision-conflict guarantees remain. Section
8.2 deliberately changes the current serializer's all-46 behavior: a `wire:null` placeholder is
informational, not an authoritative exported value. No source, test, or control inventory is
changed by this design document.

## 1. The outcome

The listener opens Voice Lab and sees one primary action: **Calibrate my reader**. Nothing speaks
until he invokes it. Voice Lab then presents one audible question at a time. For every question it:

1. names the decision and its current accepted value;
2. plays a diagnostic sample that isolates that decision;
3. lets left/right or a native form control choose another value;
4. names the candidate and automatically plays the same sample;
5. optionally compares the accepted value and candidate in an unlabeled order; and
6. keeps the candidate only when the listener presses **Keep and next**.

At the end, the listener hears what is complete, what still needs review, and which planned
settings are not actually built. He saves only accepted, effective values to the reader. A reload
resumes the same question and preserves an unfinished candidate without applying it.

This is an ear task, not a settings dashboard. The unit of work is therefore **one audible
decision**, not a panel, an A/B set, a snapshot, or a test mode.

### 1.1 What this directly resolves

| Complaint or fact | Required result |
|---|---|
| `XMLHttpRequest` sounded like “x m l hp request” | Voice Lab says that identifier formatting is not built today; when it is built, it is a template-and-pronunciation decision with an exact ear preview. It never presents the current inert identifier menu as a solution. |
| The listener wants to edit the path output as a template | Every wired template has a visible preset and the actual editable template beside it. Editing a preset makes it Custom; the rendered path is previewed through the production speech path. |
| Announcement wording was not hearable | Each announcement template has an event fixture and a **Preview & use** action that triggers the real event wording with sample slot values. |
| He wants to test every option one by one | Calibration contains only effect-proven decisions, in a fixed sequence, with a diagnostic fixture per option. Planned decisions are declared separately and never masquerade as controls. |
| “Speak each change” was not understood | The switch is removed. A systematic calibration change is always named and previewed. Template keystrokes are a draft transaction and speak only on **Preview & use**. |
| A/B, blind test, and snapshots were not understood | Global A/B sets, blind mode, Blind ×3, and named snapshots are removed. **Compare accepted with candidate** is a single temporary action; accepted decisions create automatic undo checkpoints. |
| “Describe this control” was not understood | It becomes **Hear instructions**. Its text is also always visible and connected to the field with `aria-describedby`; `?` and `F1` speak the same contextual instructions. |
| 36 controls do nothing | The start screen and review screen state “10 ready to calibrate; 36 planned and unavailable.” The 36 are informational rows, never form fields. Eligibility requires a proved downstream effect, not widget shape or `wire` alone. |

### 1.2 Guesses about the listener

Only these design assumptions go beyond his verbatim report:

- **[GUESS G1]** A stable narrator will make candidate audio easier to judge than announcements
  whose voice and rate change along with the candidate. The narrator is therefore frozen for a
  calibration run; samples use the candidate settings.
- **[GUESS G2]** He will prefer resuming at one named decision over restoring a user-named
  snapshot. Automatic history is kept, but naming and managing snapshots is removed.
- **[GUESS G3]** A single blind comparison, repeatable on demand, is sufficient for personal
  tuning. The page does not score three trials unless later listening evidence asks for it.
- **[GUESS G4]** He may sometimes use a screen reader at the same time as Voice Lab. The page
  therefore offers “Voice Lab narration” and “screen reader narration” as delivery choices for
  the same messages, and never attempts to detect a screen reader.
- **[GUESS G5]** Spelling `XML` as “X M L” and `HTTP` as “H T T P” may be more intelligible to
  him than asking the engine to pronounce the acronyms. They are audition candidates in the
  identifier fixture, never accepted defaults without his choice.

No other preference is attributed to him. In particular, this specification does not guess the
best identifier, path, voice, rate, or announcement wording.

## 2. Concepts and state

### 2.1 The listener owns four concepts

| Concept | What it means aloud | What it replaces |
|---|---|---|
| **Accepted** | “The value the reader will save.” | Set A, “current set,” and an unnamed baseline |
| **Candidate** | “The value being auditioned on this question.” | Set B and edits spread across two complete sets |
| **Keep and next** | “Accept this candidate and move on.” | Copy-to-other-set, keep first/second mutating both sets, and manual snapshots |
| **Needs review** | “Not yet heard, skipped, invalid, unavailable on this machine, or invalidated by a platform change.” | Inferring completeness from a control count or from whatever happened to be in local storage |

**Decision S1 — one accepted profile plus one candidate.** The candidate exists only for the
current decision. All other samples use accepted values.

**Rejected:** two complete, editable A/B profiles.

**Why:** the listener could not form a useful mental model of two global sets. They also allow
several differences to contaminate one comparison. A per-question candidate guarantees that one
audible dimension changes.

### 2.2 Per-decision states

Each effective decision is in exactly one of these states:

| State | Entry | Exit | Saved to the reader? |
|---|---|---|---|
| `not-checked` | Imported/default accepted value has not been heard in this calibration context | Keep, Skip, or runtime refusal | Yes, as the existing accepted value, but review warns it was not calibrated |
| `editing` | Candidate differs from accepted, or a template has a draft | Keep, revert, compare choice, navigation, or reload | No; the accepted value remains authoritative |
| `accepted` | Listener presses Keep and next after hearing a valid candidate | Edit, Undo, platform invalidation | Yes |
| `needs-review` | Listener skips, Undo reopens it, or provenance no longer matches | Keep after a new preview | Yes, but review and export identify it as unreviewed |
| `unavailable` | Runtime cannot provide the effect on this machine | Capability appears in a later session | No new value; existing accepted value is preserved |

`wire:null` items do not use this state machine. They are **planned/unavailable**, not unfinished
calibration questions.

**Decision S2 — accepting is explicit.** Changing a select, slider, or template changes only the
candidate. **Keep and next** promotes it to accepted.

**Rejected:** applying every audition immediately to the saved profile.

**Why:** hearing a bad option is part of calibration. An audition must not silently become the
reader's configuration. Explicit acceptance also gives “accepted” one stable meaning.

### 2.3 Internal session record

The UI may implement the state however it needs, but the persisted record must be equivalent to:

```text
CalibrationSession
  version
  acceptedValues           effective control id -> value
  candidates               control id -> unfinished candidate, if any
  decisionStatus           control id -> not-checked | accepted | needs-review | unavailable
  currentControlId
  narrator                 frozen backend, voice, and rate OR screen-reader-only
  provenance               platform, provider, voice-list hash, lab version
  history[]                automatic accepted checkpoints
  templateDrafts           invalid/uncommitted text, never sent to the plugin
  lastSavedRevision
  interruptedCompare       boolean only; no hidden trial order survives reload
```

`history[]` contains the control id, before value, after value, and time of each acceptance. The
listener sees **Undo last accepted decision**, not a snapshot manager. History is bounded, but the
bound must exceed all effective decisions in one run; 100 entries is sufficient for the current
10 without forcing the listener to understand the number.

**Decision S3 — automatic checkpoints, one Undo surface.** Every acceptance creates history.

**Rejected:** named snapshots with Keep and Restore, and no history at all.

**Why:** named snapshots exposed storage mechanics the listener did not understand. Removing
recovery entirely would make experimentation unsafe. Automatic checkpoints retain recovery without
asking him to invent names or decide when a snapshot is warranted.

### 2.4 Comparison is an action, not a mode

**Compare accepted with candidate** is available only when they differ and both can produce a
complete sample.

1. It captures the accepted and candidate values for the current control.
2. It randomly orders those two values for this invocation only.
3. It plays first sample, the reserved compare separator, then second sample.
4. It asks for `1` or `2`.
5. It reveals both values and makes the chosen one the candidate.
6. It does **not** accept the choice; **Keep and next** remains the only commit.
7. Pressing Compare again creates a fresh one-trial order. No score is accumulated.
8. Stop or Escape cancels the comparison, reveals nothing, and preserves the earlier candidate.

Only the sample is blind. The page never enters a persistent “blind mode.”

**Decision S4 — local, one-trial, blind-while-playing comparison.**

**Rejected:** labelled A/B playback, a persistent blind toggle, and Blind ×3 with an automatic
winner.

**Why:** labels bias the judgement; a mode is state the listener must remember; three scored trials
turn a personal tuning decision into a research protocol. Repeating Compare already provides
another trial when wanted.

### 2.5 “Speak each change” does not exist in calibration

Discrete controls always produce the change sequence in section 4. Template typing changes only a
draft; **Preview & use** validates, makes it the candidate, and produces the same sequence. Stop is
always available.

The advanced free-form inspector may keep a preference for automatic fixture replay, but it must be
named **Automatically replay the whole example**, live outside calibration, and have no effect on
calibration.

**Decision S5 — mandatory semantic feedback, no mute-like calibration switch.**

**Rejected:** the current “Speak each change: on/off.”

**Why:** its object (“what is spoken?”) and consequence were unclear. Turning it off also breaks the
audible-state contract of a systematic ear workflow. The listener can stop any utterance; he does
not need to disable the workflow's defining feedback.

## 3. The calibration route

### 3.1 Entry and resume

Opening the page is silent. The start screen shows:

- **Start calibration** when no session exists;
- **Resume at _decision name_** when a session exists;
- **Review and save** when at least one decision is accepted;
- the actual runtime count of effective and planned decisions; and
- a visible warning naming identifier and custom path wording as not built in this version.

Invoking Start or Resume freezes the narrator choice for the run, then speaks:

> “Voice Lab calibration. Ten decisions can change the reader in this build. Thirty-six planned
> decisions cannot. Identifier pronunciation and custom path wording are not built yet; Pocket TTS
> receives identifiers unchanged. Starting with Which voice. Current: Pocket TTS.”

Numbers in actual speech use words, not digits. The exact count comes from the capability contract,
not from hard-coded prose.

**Decision F1 — no autoplay, but a complete orientation after an explicit start.**

**Rejected:** startup speech and a silent dashboard.

**Why:** unsolicited audio recreates P31; a silent dashboard recreates the listener's first session,
where essential explanations existed only visually.

### 3.2 Eligibility: an effect, not a widget

A decision enters calibration only when all three facts agree:

1. the descriptor has a non-null production wire;
2. the running server declares that control id effective for this provider/build; and
3. the effect contract names a downstream consequence: normalized text, chunk plan, synthesis
   options, or a production event template.

The page must obtain the effective-id set from the server. It must not infer it solely from its
inlined `CONTROLS` copy. A mismatch fails closed and is reported:

> “Voice Lab and the reader disagree about How an identifier is said. It is not safe to calibrate
> that decision in this session.”

P47's check remains consequence-based: change every eligible control and demand a different
normalized output, chunk plan, synthesis request, or rendered production event. Merely finding a
form element is not a check.

**Decision F2 — runtime capability intersection.**

**Rejected:** `wire !== null` as the only eligibility test, rendering every descriptor, and hiding
all unavailable work.

**Why:** the first alternative can drift from the server; the second is P47's shipped failure; the
third conceals why a requested change is impossible.

### 3.3 Current systematic order

The current sequence contains the 10 effect-proven controls. Voice and rate come first so every
later judgement uses the chosen reading voice. Each sample is short enough to repeat and contains
the smallest text that can distinguish the options.

| Step | Control | Diagnostic sample | What the listener judges |
|---:|---|---|---|
| 1 | `voice.id` — Which voice | “Hello. I will read your work, file names, and numbers like forty-two milliseconds.” | intelligibility and comfort; each available voice is auditioned with identical words |
| 2 | `voice.rate` — How fast | the same voice audition | comprehension at the candidate rate, not a different sentence |
| 3 | `path.style` — How a path is said | `packages/core/src/normalizer/index.ts` in a short sentence | whether the path has a followable shape |
| 4 | `path.extensionStyle` — Where the file kind goes | the identical path sentence | only placement/wording of the kind |
| 5 | `omit.codeBlocks` — How a code block is handled | one sentence, a two-line JavaScript fence, one sentence after it | whether omission is announced or silent, with context on both sides |
| 6 | `struct.orderedLists` — How a numbered list is said | a three-item numbered list whose items do not contain other numbers | numeral, ordinal word, or omission without confounds |
| 7 | `num.expandIntegers` — Whether numbers become words | “The build copied 1,204 files in 52 milliseconds.” | number rendering while unit expansion is held accepted |
| 8 | `num.expandUnits` — Whether units become words | the identical number sentence | unit rendering while number rendering is held accepted |
| 9 | `pace.isolateFirstSentence` — Whether the first sentence goes alone | one very short first sentence followed by a long second and third sentence | first-sound delay and continuity on a cold trial |
| 10 | `pace.chunkMaxUnits` — How long a chunk | a six-sentence passage longer than the largest candidate chunk | onset delay and gaps; the narrator reports first-sound time and longest gap in rounded, spoken units after playback |

For steps 9 and 10, Replay replays bytes and is useful for sound quality, but Compare must use cold,
complete synthesis because the property under judgement includes onset and inter-chunk continuity.
The narrator says “Cold timing comparison” before those trials. Cache hits must never be labelled a
latency comparison.

The order is data-driven. A newly wired control joins its audible group only after it has a
diagnostic fixture and an effect consequence. It does not appear merely because `wire` changed.

**Decision F3 — fixed, dependency-aware order with one diagnostic fixture per decision.**

**Rejected:** panel order, a user-built playlist, and one general fixture for all controls.

**Why:** panel order starts with content before choosing the voice that presents it; playlist
construction adds setup work; one fixture makes it hard to know which heard difference belongs to
the current decision.

### 3.4 Navigation and completion

- **Keep and next** accepts the candidate, writes one automatic checkpoint, and moves to the next
  needs-review decision.
- **Skip for now** preserves the accepted value, marks the decision needs-review, plays the skip
  earcon, and moves on.
- **Back** moves without accepting. An unfinished candidate remains labelled “Not kept.”
- **Reset candidate** restores the accepted value. **Use recommended** is separate and sets the
  candidate to the schema default; “accepted” and “default” are never synonyms.
- At the end, the review screen groups decisions as Accepted, Needs review, Unavailable on this
  machine, and Planned/not built.
- “Complete” means every currently effective decision is accepted. The page may still save a
  partial calibration, but it says exactly how many were not reviewed.

**Decision F4 — Skip is explicit and completion is countable.**

**Rejected:** silently moving on when the listener navigates away, and blocking Save until every
decision is accepted.

**Why:** silent movement makes completion unknowable; mandatory completion traps a listener when a
voice or backend cannot be judged on that machine. Partial Save is allowed only with an audible
summary.

## 4. Audio grammar

### 4.1 Three audio roles

| Role | Sound | May change with the candidate? | Purpose |
|---|---|---:|---|
| **Narrator** | the voice/backend/rate frozen when calibration starts, or the external screen reader | No | names UI state, values, instructions, validation, save/export results |
| **Sample** | the exact production normalize → chunk → synthesize path with the candidate applied only to the current decision | Yes | the thing being judged |
| **Earcon** | existing motifs from the reserved control band | No | identifies transport, boundary, refusal, skip, or error before words are understood |

If the chosen sample voice fails, the narrator remains able to explain the failure. If Voice Lab
narration itself is unavailable, the live region contains the same message and the error earcon
still sounds.

**Decision A1 — stable narrator and candidate sample are separate roles.**

**Rejected:** speaking UI confirmations through the candidate voice and minting a second arbitrary
tone vocabulary.

**Why:** candidate speech makes the label change along with the object being judged and can lose the
error channel when a candidate backend fails. A new tone vocabulary would collide with the
project's reserved identity/control bands and demand unnecessary memorization.

### 4.2 Queue and interruption rules

There is one audio arbiter for narrator, samples, stage playback, comparison, earcons, errors, and
voice auditions.

- No two sources may sound at once.
- A new navigation or value change replaces a pending navigation/value narration and its sample.
- Keep, Skip, Compare, Save, Export, and errors wait for the current word boundary only if that
  boundary is guaranteed; otherwise they replace immediately after stopping the old source.
- Stop cancels scheduled browser audio **and** the server synthesizer.
- A comparison is atomic except for Stop/Escape: unrelated previews cannot enter between its two
  samples.
- Screen-reader narration suppresses Voice Lab narration, not samples or earcons.

**Decision A2 — one arbiter, newest deliberate action wins.**

**Rejected:** separate queues for explanations, previews, and transport.

**Why:** the listener already heard the result of independent queues as cacophony. Queue-level
protection without playback-level protection is also P44's truncated-announcement failure.

### 4.3 Event vocabulary

The phrases below are templates, not suggestions. Labels and values come from the control
descriptor's listener-facing words; schema ids are never spoken unless the listener requests
technical details.

| Event | Earcon | Narrator | Sample | Silence/boundary |
|---|---|---|---|---|
| Page load, reconnect, background normalize | none | none | none | Silent by rule; visible/live-region state may update without forcing speech |
| Start/Resume | none | “Voice Lab calibration. {effectiveCount} decisions can change the reader… {current control and value}.” | none until orientation ends | 300 ms before first optional sample |
| Focus a different decision by calibration navigation | none | “Step {n} of {total}. {label}. Accepted: {value}. {Not kept: candidate.}” | none | Rapid navigation is replace/debounced; no audio on mouse hover |
| Choose a discrete candidate | none | “Candidate: {value}.” | `control.play`, then the diagnostic sample | 250 ms between narrator and play earcon |
| Reset candidate or Use recommended | none | the same “Candidate: {value}” sequence; recommended adds “Schema recommendation.” | `control.play`, then the diagnostic sample | neither action silently accepts |
| Choose a voice candidate that is unavailable | `control.refused` | “{voice} is not installed. {exact remedy}. Your accepted voice is unchanged.” | none | none used as meaning |
| Voice download confirmation opens | none | “Download neural voices? {size} of network data. Speech stays on this machine afterward.” | none | waits for an explicit Download or Not now choice |
| Requested voice download progresses | none | none unless the listener invokes Hear status | none | progress is visible and exposed to the screen reader without repeatedly interrupting calibration |
| Requested voice download completes | none | “Neural voices downloaded. {voiceCount} choices are now available.” | none | spoken because the listener initiated the download and calibration capability changed |
| Requested voice download fails | `control.error` | exact file/reason plus “Your system voices still work.” | none | no generic replacement of the provider reason |
| Preview & use a valid custom template | none | “Custom template. Preview.” | `control.play`, then the fully rendered event | 250 ms before earcon |
| Type or edit an uncommitted template draft | none | none from Voice Lab; the screen reader/input echo owns typing | none | draft state is exposed in the field and status, but does not become a calibration candidate |
| Invalid template preview | `control.error` | “Template not used. {first error}. {allowed-slot help}.” | none; last valid candidate remains | no silent fallback |
| Space when idle | `control.play` | none | current candidate's diagnostic sample | earcon immediately precedes content |
| Pause | `control.pause` | none | audio suspends | silence means paused only because the pause earcon preceded it |
| Resume | `control.play` | none | audio resumes | none |
| Stop | `control.stop` | none unless nothing was playing, in which case “Nothing is playing.” | all audio and synthesis stop | silence follows an explicit stop tone |
| Skip | `control.skip` | “Skipped {label}. {remaining} decisions still need review.” | none | none |
| Keep and next | none | “Kept {value}. Next: {next label}. Accepted: {next value}.” | none until the listener requests or changes it | 200 ms between the two clauses |
| Undo | none | “Undid {label}. Restored {value}. It needs review.” | none | none |
| Compare begins | `control.play` | “Compare accepted with candidate.” before blindness starts | first sample | 300 ms after narration |
| Compare boundary | `control.compare` | none | second sample | the 300 ms separator is the boundary; no A/B names |
| Compare choice requested | none | “Choose first or second.” | none | 300 ms after second sample |
| Compare choice | none | “First was {value}; second was {value}. Candidate is {chosen}. Press Enter to keep it.” | none | no automatic acceptance |
| Compare canceled | `control.stop` | “Comparison canceled. Candidate remains {value}.” | none | none |
| Planned/unbuilt item invoked | `control.refused` | “Not built in this reader. Changing it in Voice Lab would do nothing. {specific current behavior}.” | none | none |
| Runtime/server/provider error after an action | `control.error` | exact provider/server reason plus next action | none, or last complete accepted sample if explicitly requested | errors interrupt because the requested action failed |
| Draft persistence failure | `control.error` once | “This browser could not keep your calibration draft. Keep this page open, or export before leaving.” | none | repeated failures do not repeat until state recovers and fails again |
| Draft persistence recovery | none | “Draft saving is working again.” | none | spoken once because safety state changed |
| Narration changes to screen-reader mode | none | Voice Lab's last narrator phrase is “Voice Lab narration off. Your screen reader will read instructions.” | none | subsequent semantic messages use only the live region |
| Narration changes to Voice Lab mode | none | “Voice Lab narration on.” | none | live region remains semantic but is not used as a second assertive narrator |
| Save finds unkept candidates | none | “{count} decisions have changes you have not kept. Save accepted values anyway, or return to review.” | none | waits for an explicit choice |
| Save success | none | “Saved to the reader. Revision {revision}. It applies to the next utterance.” | none | none |
| Save refused/conflict | `control.refused` | exact conflict and recovery action | none | none |
| Export surface opens | none | accepted, needs-review, engine-personal, and unavailable counts | none | no copy/download success is implied |
| Export copy success | none | “Copied the settings to the clipboard.” | none | only after the clipboard promise succeeds |
| Download requested | none | “Download requested: {filename}.” | none | never claims the browser completed a download it cannot observe |
| Calibration review opens | none | “{accepted} accepted. {review} need review. {unavailable} unavailable here. {planned} planned and not built.” | none | none |
| Calibration complete | none | “Calibration complete. All {count} effective decisions were heard and accepted.” | none | success is speech, not an invented tone |

**Decision A3 — earcons name event classes; speech carries values and reasons; silence only
separates or follows an announced transport state.**

**Rejected:** an earcon for every value, speech for every internal autosave, and silent success or
failure.

**Why:** dozens of value tones are not learnable; narrating internal writes overwhelms the thing
being tuned; silence cannot distinguish success, failure, waiting, and refusal. Autosave success is
not exposed as a listener state, while autosave failure is.

### 4.4 Narration discipline

- UI phrases are short, grammatical sentences. No raw JSON ids, hex, milliseconds, or symbol-only
  values are spoken by default.
- Counts and units expand to words. Timing summaries round to tenths of seconds unless the listener
  opens technical details.
- The narrator never reads a tooltip. The visible help sentence and spoken help are the same source.
- No speech occurs on hover, scroll, background download progress, cache fill, or focus moved by
  page re-render.
- A screen reader receives equivalent semantic text through a live region, but not the sample
  transcript as an assertive announcement.

**Decision A4 — announce listener state, not implementation activity.**

**Rejected:** narrating every network/cache/render transition and relying on browser `title=` text.

**Why:** the first is noise and invites overlap; the second is the exact ear-inaccessible path that
hid all five existing explanations.

## 5. Keyboard contract

### 5.1 Dispatch rules

1. Letter bindings are case-insensitive outside editable fields: `c` and `C` are the same action.
   The UI displays lowercase keys so Shift is never implied.
2. `Tab` and `Shift+Tab` are always native focus traversal. Voice Lab never repurposes Tab.
3. Arrow keys are native inside selects, sliders, text fields, and screen-reader browse mode. They
   navigate/change calibration only when focus is on the calibration card's navigation target.
4. Printable single-letter bindings do not fire while an input, textarea, select, contenteditable,
   IME composition, or modal prompt owns focus.
5. `Escape` is the emergency exception: if audio is sounding or synthesis is in flight, it stops
   both from any focus context. With no audio, it cancels the current compare/editor/overlay.
6. Button activation, Space on a native button, Enter on a native button, and select behavior stay
   native. The global Space binding runs only from the card/body navigation target.
7. `1` and `2` are active only while a comparison is awaiting a choice.
8. Every shortcut has a visible button or native control. Shortcuts are accelerators, never the
   only route.
9. Context precedence is: emergency Escape; comparison choice; native editable/form behavior;
   attributed-run or stage-ladder behavior; calibration-card binding. One key may have a
   contextual meaning only when the focused role makes that context audible and unambiguous.

**Decision K1 — native form behavior wins over global shortcuts, except emergency Escape.**

**Rejected:** the current global Tab-as-next-panel behavior and suppressing all transport keys
whenever any form field is focused.

**Why:** repurposed Tab breaks expected keyboard navigation. Suppressing every stop route while a
textarea owns focus leaves a voice-first listener unable to silence unexpected audio without
leaving the editor.

### 5.2 Complete map and reconciliation

| Key | Calibration action | Existing `index.html` action | Resolution |
|---|---|---|---|
| `Space` | Play/pause current diagnostic sample from card/body focus; native activation elsewhere | play/pause fixture | Retained semantically; object narrows to the current diagnostic sample |
| `p` | Pause/resume alias outside editors | play/pause alias | Retained |
| `s` | Stop outside editors | Stop outside form fields | Retained; Escape supplies the editor-safe emergency path |
| `.` | Stop alias outside editors | Stop alias | Retained |
| `Escape` | Stop first; otherwise cancel compare/template draft/overlay and restore focus | close overlays only | Strengthened so one keystroke always silences audio |
| `r` | Replay the last exact, complete audio | uppercase `R` only | Retained and made case-insensitive; incomplete/aborted audio is never replayable |
| `↑` / `↓` | Previous/next calibration decision from card navigation focus | previous/next visible control | Retained with native-control guard; moving does not accept |
| `←` / `→` | Previous/next candidate value from card navigation focus | step focused value | Retained with native-control guard |
| `Enter` | Keep candidate and move to next, from the card or Keep button | no global binding | Added as the primary completion action; native in controls |
| `Enter` on an attributed changed run | Open/jump to the calibration decision that owns the change | jump to the first governing control | Retained as an advanced-inspector context; it takes precedence over Keep because the changed run owns focus |
| `Enter` / `Shift+Enter` on a stage-ladder row | Play that stage / the stage before it | same per-row binding | Retained as an advanced-inspector context; the visible row instructions name both actions |
| `c` | Compare accepted with candidate for this one decision | uppercase `C`, compare global A/B sets | Narrowed to a temporary local comparison; made case-insensitive |
| `1` / `2` | Choose first/second only after Compare asks | choose first/second | Retained, but choice sets candidate rather than overwriting both global sets |
| `u` | Undo last accepted decision | unbound | Added; it exposes automatic history without snapshot vocabulary |
| `?` or `F1` | Hear instructions for the current decision | `?` “Describe this control” | Renamed and retained; F1 adds a conventional help route |
| `e` | Open **Inspect how the text changed** for the current sample | uppercase `E`, stage ladder | Retained as advanced inspection and made case-insensitive |
| `Ctrl+Enter` | In a template editor: validate, Preview & use; elsewhere no action | unbound | Added only for the explicit template transaction |
| `Ctrl+S` / `Cmd+S` | Save accepted effective values to the reader; browser Save Page is suppressed only on the Lab origin | unbound | Added as a conventional save shortcut; same action as the visible button |
| `m` | Unbound | toggle “Speak each change” | Retired, not reassigned, because that state no longer exists |
| `k` | Unbound | snapshot | Retired, not reassigned |
| `l` | Unbound | restore latest snapshot | Retired, not reassigned |
| `+` / `-` | Unbound | declared as More/Less in `BINDINGS`, deliberately ignored by the current handler | Removed from help and binding table; there is no hidden More tier in calibration |
| `Tab` / `Shift+Tab` | Native next/previous focus | Tab is next panel outside form fields | Current interception removed |

The page must ship one binding table used by dispatch and help. Retired keys are absent from both;
they are not silent verbs left in the table. A collision check includes lowercase normalization and
context, so `r`/`R` cannot accidentally acquire different meanings.

**Decision K2 — retire old concepts without recycling their keys.**

**Rejected:** assigning `m`, `k`, or `l` immediately to new actions.

**Why:** reusing a learned key for a different meaning is worse than leaving it unused. `u` says
Undo directly; `k` and `l` do not.

## 6. Template strings

### 6.1 The interaction: preset → edit → Custom

Every effective template control renders all of these at once:

1. a **Preset** select with human names;
2. the actual **Template** text field populated by that preset;
3. the allowed slots, visible as text and insertable with keyboard-accessible buttons;
4. a concrete sample binding, such as `name = index`, never only abstract slot names;
5. the last valid rendered output; and
6. **Preview & use**.

Selecting a preset copies its complete string into Template, validates it, makes it the candidate,
and previews it. Editing any character changes the select to **Custom (not yet previewed)**. If the
text again exactly matches a preset, its preset name returns. There is no separate operation to
“save a custom preset”; the exact template string is the value persisted and exported.

Typing edits a draft and is silent from Voice Lab. `Ctrl+Enter` or **Preview & use** is the
transaction boundary. A valid draft becomes the candidate and is heard. An invalid draft stays in
the editor for repair, while the last valid candidate remains active. Escape restores the last
valid text after confirmation when the draft differs.

**Decision T1 — the preset is an editable starting string, not a mode hiding its implementation.**

**Rejected:** preset-only dropdowns, a separate Custom dialog, and speaking on every template
keystroke.

**Why:** preset-only is the listener's complaint; a separate dialog hides the relationship between
preset and output; per-keystroke TTS would overlap typing and produce incomplete nonsense.

### 6.2 Grammar

Templates are Unicode plain text plus named slots.

```text
template  := (literal | slot | escaped-open | escaped-close)*
slot      := "{" slot-name "}"
slot-name := ASCII lower-case letter, followed by ASCII letters or digits
escaped-open  := "{{"   -> literal "{"
escaped-close := "}}"   -> literal "}"
```

Examples:

```text
file {name}, {kind}, in folder {folders}
{spoken}
Now reading from {label}.
Use {{ and }} when the braces themselves must be spoken.
```

Rules:

- Slot names are exact and case-sensitive. `{name}` is valid; `{Name}` is unknown.
- Unknown slots, unmatched braces, nested slots, and an empty slot name are invalid.
- A slot value is data. Braces inside a path, label, or identifier are never parsed again.
- Duplicate slots are legal because repetition may be an intentional listening aid.
- No conditionals, functions, filters, JavaScript, regular expressions, SSML, HTML, backslash
  escapes, or provider commands exist in this grammar.
- Whitespace and punctuation are literal. The preview is authoritative about how the production
  pipeline ultimately normalizes them.
- Each control retains its descriptor length limit, counted in Unicode code points. Expansion has
  a separate production utterance cap; truncation must be announced and cannot cut inside a slot.
- Empty text is legal only for a control whose explicit preset is **Say nothing**. Otherwise it is
  invalid. Silence is a named choice, never an accidental blank.
- At least one identity-bearing slot from the per-template table is required where losing the
  subject would make different inputs indistinguishable.

**Decision T2 — a deliberately small, non-programming grammar.**

**Rejected:** Mustache/Handlebars conditionals, positional `%s` tokens, and arbitrary SSML.

**Why:** conditionals create a language the listener must debug; positional tokens are hard to
name by ear; SSML is provider-dependent and reopens template injection. Named replacement is
enough to reorder, omit, and phrase the output.

### 6.3 Path templates

The full-path template is the listener-facing control once it is implemented. It supersedes the
calibration UI combination of `path.style`, `path.extensionStyle`, `path.namePhrase`, and
`path.folderPhrase`; old combinations migrate to an equivalent preset where possible. Folder depth
and pronunciation dictionaries remain slot producers, not extra wording fragments the listener
must mentally concatenate.

For input `packages/core/src/normalizer/index.ts`, the preview shows these concrete bindings:

| Slot | Example value | Meaning |
|---|---|---|
| `{raw}` | `packages/core/src/normalizer/index.ts` | the untouched path, treated as data |
| `{name}` | `index` | base filename after identifier/component pronunciation |
| `{extension}` | `T S` | suffix pronunciation without the dot |
| `{kind}` | `TypeScript file` | mapped file kind, including “file” |
| `{folders}` | `packages, core, source, normalizer` | folders after depth policy and component pronunciation |
| `{folderCount}` | `four` | spoken count of folders represented |

Required: at least one of `{raw}` or `{name}`. `{folders}` may be empty for a file with no folder;
presets that use it must render an alternate fixture as well so dangling wording is heard before
acceptance.

Initial presets:

| Preset | Template |
|---|---|
| Name, kind, then location | `file {name}, {kind}, in folder {folders}` |
| Name, then location, kind last | `file {name}, in folder {folders}, {kind}` |
| Terse | `{folders}, {name}, {extension}` |
| As written | `{raw}` |

The preset labels describe audible order. Internal names such as `word-last` are technical details,
not primary UI text.

**Decision T3 — one full path template composes path wording.**

**Rejected:** asking the listener to coordinate four dropdowns/phrase fragments and exposing a
template that formats only the filename while folder wording remains elsewhere.

**Why:** his request is to edit the complete output he hears. Split fragments recreate the hidden
composition problem and make it impossible to see or hear the actual format in one place.

### 6.4 Identifier templates and pronunciation

The current fact is stated without qualification: `normalize('XMLHttpRequest')` returns the input
unchanged, and `ident.style` is `wire:null`. Until production identifier segmentation and rendering
exist, no identifier template field is shown as editable.

When the production wire exists, an identifier decision has two layers on the same card:

1. a template choosing the output shape; and
2. a pronunciation table for recognized tokens/acronyms.

For input `XMLHttpRequest`, the bindings are:

| Slot | Example value | Meaning |
|---|---|---|
| `{raw}` | `XMLHttpRequest` | untouched identifier |
| `{split}` | `XML HTTP Request` | deterministic boundary segmentation |
| `{spelled}` | `X M L, H T T P, Request` | acronym segments spelled as letters |
| `{spoken}` | `X M L, H T T P, request` | user pronunciation table, then spelled-acronym fallback |
| `{kind}` | `identifier` | context kind; `function` when the parser actually knows it |

Required: at least one of `{raw}`, `{split}`, `{spelled}`, or `{spoken}`.

Initial presets:

| Preset | Template |
|---|---|
| Pronounced words | `{spoken}` |
| Split words | `{split}` |
| Spell acronyms | `{spelled}` |
| Name the kind | `{kind}: {spoken}` |
| As written | `{raw}` |

The pronunciation table is exact-token, case-insensitive matching after segmentation. The visible
sample begins with entries `XML → X M L` and `HTTP → H T T P`; the listener may edit the spoken
right-hand side and hear the entire identifier. An exact full-identifier override is also allowed
for exceptions. The page says whether a preview used a token rule, a full override, spelling
fallback, or raw fallback.

**Decision T4 — template plus explicit pronunciation data.**

**Rejected:** a template alone, an opaque “smart identifier” mode, and trusting the engine to infer
acronym boundaries.

**Why:** a template can order fields but cannot make Pocket pronounce `HTTP` correctly. An opaque
mode cannot be corrected by the listener. Engine inference is the measured source of the bad
reading.

### 6.5 Announcement templates

Each announcement template owns an event fixture. Preview invokes the production renderer with the
shown bindings and sends the result through the same speech route used by the plugin.

| Template/control | Allowed slots | Required | Primary preview event |
|---|---|---|---|
| Code block omission (`omit.codeBlockPhrase`) | `{language}`, `{lines}` | none; a generic omission remains informative | a two-line JavaScript block between two sentences |
| Link wording (`omit.urlPhrase`) | `{label}`, `{host}`, `{path}`, `{url}` | one of `{label}`, `{host}`, `{url}` | a labelled GitHub link and an unlabelled URL |
| Table lead-in (`struct.tableLeadIn`) | `{rows}`, `{columns}` when production supplies them | none | a two-by-two table before its first row |
| Session switch (`announce.switchPhrase`) | `{label}` | `{label}` | switch to call sign “Cedar” |
| Status (`announce.statusTemplate`) | `{state}`, `{queued}`, `{label}` | `{state}` | “reading, three waiting, following Cedar” |
| Future diagram omission wording | `{labels}`, `{omitted}` when production supplies them | none | a diagram with two retained labels |

Optional slots can be empty. Therefore every template is previewed against both a fully populated
fixture and the fixture with optional data absent. The latter is part of acceptance, not an
advanced test hidden elsewhere.

**Decision T5 — templates are previewed as real events, including missing optional data.**

**Rejected:** reading the literal template string aloud and previewing only the happy-path slot
values.

**Why:** hearing “left brace host right brace” does not reveal the final announcement. Optional
slots are where dangling commas and meaningless phrases appear.

### 6.6 Invalid and unsafe templates

Validation is live visually but audible only on **Preview & use**, leaving the field, Save, or
Export. The field has `aria-invalid="true"`; the first error is adjacent and referenced with
`aria-describedby`; a full list is available without a tooltip.

Invalid draft behavior:

- the draft is retained locally for repair;
- the last valid candidate remains the heard/applied candidate;
- Keep, Save, and Export do not include the invalid draft;
- Preview plays `control.error` and names the first error and allowed slots;
- Review counts it as Needs review;
- no autocorrection, silent slot deletion, or fallback to a preset occurs.

Provider safety is below the template grammar. The rendered string is data, never shell or
PowerShell source. `[[...]]`, XML-like text, quotes, newlines from slot data, and shell metacharacters
have no command meaning. A provider that cannot prove literal-data handling cannot declare template
controls effective. A cross-platform adversarial fixture must reach the provider as literal text
before the control becomes eligible.

**Decision T6 — fail closed on syntax and prove provider escaping at the effect boundary.**

**Rejected:** deleting unknown slots, blacklisting a few dangerous character sequences, and letting
each provider interpret template output.

**Why:** silent deletion changes what is said; blacklists are incomplete and platform-specific;
provider interpretation makes one exported template mean different things or become executable on
different systems.

## 7. The 36 planned decisions

### 7.1 Declaration, not concealment and not disabled controls

At the current control inventory the page says, in visible text before Start and in every Review:

> **10 decisions are ready to calibrate. 36 are planned and do not change the reader yet.**

Immediately below it:

> “Identifier pronunciation and custom path wording are in the planned group. Today identifiers
> are passed unchanged to Pocket TTS. Voice Lab cannot save a setting that changes that.”

The page provides **Review the 36 planned decisions**. That screen contains headings and plain
informational rows. Rows are focusable only as disclosure items, not exposed with `button`,
`checkbox`, `combobox`, `slider`, or `aria-disabled` roles. Activating a row plays
`control.refused` and speaks why it is not effective and what production currently does.

The start count, review count, and list all derive from the same runtime capability intersection.
No hard-coded “36” is trusted after controls change.

**Decision U1 — prominent count plus an optional complete informational list.**

**Rejected:** hiding the 36 in collapsed footer prose, rendering grey disabled controls, and
showing editable sandbox previews that cannot reach the plugin.

**Why:** collapsed prose was not legible to the listener; disabled form fields still imply a real
setting blocked by temporary state; sandbox previews repeat the lie at a more convincing level.

### 7.2 Current inventory

| Group | Effective now | Planned/not built now |
|---|---|---|
| What gets left out | `omit.codeBlocks` | `omit.codeBlockPhrase`, `omit.codeBlockDetail`, `omit.inlineCode`, `omit.urls`, `omit.urlPhrase`, `omit.emoji` |
| Structure | `struct.orderedLists` | `struct.headingCue`, `struct.headingPauseMs`, `struct.bulletMarker`, `struct.tableLeadIn`, `struct.tableHeaderRepeat`, `struct.tableFirstCellHeader` |
| Names, paths, identifiers | `path.style`, `path.extensionStyle` | `path.namePhrase`, `path.folderPhrase`, `path.depthPolicy`, `path.depthN`, `path.extensionWords`, `ident.style`, `ident.parens` |
| Numbers and units | `num.expandIntegers`, `num.expandUnits` | `num.unitWords`, `num.decimals` |
| Voice and pacing | `voice.id`, `voice.rate`, `pace.chunkMaxUnits`, `pace.isolateFirstSentence` | `voice.pitch`, `voice.volume`, `pace.simulateChunkGapMs`, `pace.sentencePauseMs`, `pace.pauseBackend` |
| Interruptions and announcements | none | `queue.maxQueued`, `queue.overflowPolicy`, `announce.mode`, `announce.sessionLabel`, `announce.sessionLabelHashChars`, `announce.switchPhrase`, `announce.statusTemplate`, `input.clipboardCap`, `input.huddleReplyCap`, `interrupt.granularity` |

This table records the present source, not a permanent number. The runtime page must recalculate.
`announce.sessionLabelHashChars` is informational only; the planned list must also state that the
product design rejects spoken hex rather than suggesting that values above zero are a future goal.

**Decision U2 — planned does not mean promised or desirable.**

**Rejected:** wording all `wire:null` descriptors as upcoming features.

**Why:** some rows are design records or rejected option spaces. “Planned” here means “specified but
not effective”; each row must name whether it is intended, blocked, superseded, or rejected.

## 8. Persistence, Save, import, and export

### 8.1 Browser draft persistence

One versioned record, `voice-lab.calibration.v1`, replaces the listener-facing meaning of
`voice-lab.current`, `.a`, `.b`, and `.snapshots`. It is written after every accepted value,
candidate, status, navigation change, template draft, and narrator choice, debounced as one atomic
record.

On reload:

- no audio plays;
- Resume names the current decision;
- an unfinished candidate returns as “Not kept”;
- an interrupted comparison is canceled, never resumed with a hidden order;
- history remains available through Undo;
- invalid template drafts return to their fields but never become active.

If storage fails, the in-memory session continues and the failure is spoken once after an explicit
user action. The page keeps **Export** reachable. Recovery is also spoken once.

Legacy migration imports `voice-lab.current` as the accepted profile. Distinct A/B sets and named
snapshots become recovery-history entries rather than disappearing. After the listener invokes
Resume, the narrator says once:

> “I imported an older Voice Lab session. Its current set is accepted; the other set and snapshots
> are available in recovery history.”

**Decision P1 — one atomic, versioned calibration record with explicit legacy recovery.**

**Rejected:** four independently written local-storage keys, silent fallback to defaults, and
discarding old A/B data.

**Why:** independent keys can describe different moments; silent fallback can erase an ear session
without the listener knowing; old data can be preserved without preserving old concepts.

### 8.2 Accepted values versus drafts

Save to reader serializes accepted effective values. A candidate or invalid template draft is not a
setting. If any exist, Save first speaks:

> “Two decisions have changes you have not kept. Save the accepted values anyway, or return to
> review.”

The listener chooses; there is no default timed action. A partial calibration is valid and records
its review status as metadata, but the plugin receives only accepted settings.

`wire:null` values are not emitted as authoritative settings. Export may list their ids under
informational `unavailableAtExport`, but an old placeholder value must not spring to life when a
future version wires a field. A missing future field receives that future schema's default.

**Decision P2 — only accepted, effective values are authoritative.**

**Rejected:** serializing all 46 defaults, saving candidates, and refusing every partial save.

**Why:** all-46 export turns inert placeholders into future behavior; candidate export confuses an
audition with a choice; refusing partial work can trap the listener on a machine where one effective
control is unavailable.

### 8.3 Save to reader

The existing revision guard remains load-bearing:

1. re-read the settings file;
2. refuse on syntax error;
3. compare its revision with the last seen revision;
4. on equality, write the next revision atomically;
5. on conflict, preserve both the browser session and file and speak the recovery action; and
6. report only observed success.

The saved file contains:

- `kind`, schema version, revision, writer version;
- accepted effective settings;
- calibration status for effective ids, ignored by the plugin's behavior reader;
- platform, provider/backend, voice-list hash, and tuned time;
- `unavailableAtExport` ids as information, never values; and
- generated comments naming which settings are engine- or platform-personal.

On a platform/provider/voice-list mismatch, import preserves portable values, marks affected voice
and pacing decisions Needs review, and speaks the mismatch after Resume. It does not silently map a
voice name or discard the whole file.

**Decision P3 — preserve the revision conflict guard and invalidate only provenance-sensitive
decisions.**

**Rejected:** last-write-wins, whole-file rejection on platform mismatch, and silent voice mapping.

**Why:** last-write-wins destroys hand edits; portable normalization choices remain useful across
machines; voice namespaces do not port and silent substitution is P18's shape.

### 8.4 Export

**Export settings** opens an in-page export surface with:

- a readonly, selectable JSONC preview;
- **Download file**;
- **Copy to clipboard**; and
- an audible summary of accepted, needs-review, engine-personal, and unavailable counts.

Clipboard success is announced only after the returned promise succeeds; failure uses
`control.error` and leaves the selectable text. Download says “Download requested” because a web
page cannot prove the browser wrote the file. No surprise tab is opened. The exported file is the
same settings representation Save would write, except it does not increment the on-disk reader
revision and records `writtenBy` as export.

**Decision P4 — explicit in-page export with independently verifiable copy/download actions.**

**Rejected:** silently opening a new tab, claiming clipboard success before it resolves, and
maintaining a separate export schema.

**Why:** popup blockers and clipboard policy make those first two claims unreliable. A second
schema makes an exported result differ from what the reader consumes.

## 9. Accessibility contract

Accessibility is not a checklist after the interaction; it determines the interaction.

### 9.1 Cognitive and reading load

- One question is primary at a time. The current label, accepted value, candidate, sample, and
  primary action fit in one card.
- Text is left-aligned, system sans-serif, not italicized for essential content, and never fully
  justified. Line length is bounded; zoom and narrow windows reflow to one column.
- Labels describe the heard decision (“Where the file kind goes”), not code ownership
  (`normalize.extensionStyle`). Technical ids live under **Technical details**.
- Instructions use the same verbs everywhere: Hear, Candidate, Keep and next, Skip for now,
  Compare accepted with candidate, Undo, Review, Save to reader, Export settings.
- Progress is words plus numbers: “Step 3 of 10, 2 accepted,” not a color-only progress bar.

**Decision X1 — one-card linear disclosure.**

**Rejected:** the current sticky control sidebar as the systematic route and a grid/dense settings
form.

**Why:** the listener asked to test items individually, and a sidebar requires scanning and state
comparison before listening begins.

### 9.2 Semantics, focus, and error handling

- Every field has a persistent visible label and help text linked with `aria-describedby`.
- Errors are adjacent, programmatically associated, and included in review. No essential text lives
  only in `title=`, hover, color, underline, or an earcon.
- The current step is a heading and uses `aria-current="step"` in the step list.
- Keep moves focus to the next step heading only after its spoken transition is queued. Back and
  overlay close restore the invoking control. Re-render never resets focus.
- Native select, checkbox, range, input, textarea, button, progress, and details semantics are used
  without placing interactive elements inside other interactive elements.
- Touch targets span the row and are at least 44 by 44 CSS pixels. At 400% zoom and 320 CSS pixels
  wide, content remains in document order with no horizontal scrolling for actions or text.
- High-contrast/forced-color modes preserve focus, accepted/candidate distinction, errors, and
  progress without relying on custom colors. Reduced-motion preference removes nonessential motion.
- Busy synthesis uses `aria-busy`; status messages are polite. A requested-action error is
  assertive, but does not repeat the full sample transcript through the screen reader.

**Decision X2 — visible text, programmatic semantics, and spoken semantics share one message
source.**

**Rejected:** duplicating help separately for tooltip, screen reader, narrator, and generated JSON
comments.

**Why:** duplicated wording drifts. Existing explanations already proved that correct words in the
wrong channel are functionally absent.

### 9.3 Screen reader and Voice Lab narration

The start screen offers:

- **Voice Lab reads instructions aloud** — default based on the listener's reported ear workflow;
- **My screen reader reads instructions** — Voice Lab places state messages in live regions and
  suppresses narrator TTS; samples and earcons still play.

The choice persists as a Lab preference and can be changed from the start/review screen, not in the
middle of a comparison. The two choices deliver identical semantic messages; they are not “Speak
each change on/off.”

**Decision X3 — explicit mutually exclusive narration channel.**

**Rejected:** trying to detect assistive technology, speaking both channels, and suppressing all
Lab audio in screen-reader mode.

**Why:** detection is unreliable and invasive; two narrators overlap; the actual TTS samples must
still be heard because they are the object being calibrated.

### 9.4 Never fail silently

Every user-requested action ends in one of four audible outcomes: sample begins, success sentence,
refusal sentence, or error sentence. Background persistence is the one intentionally quiet success;
its failure changes the safety state and is announced. Stop always remains possible while an error,
download, preview, comparison, or narration is in progress.

**Decision X4 — outcome closure is asserted on the listener's channel.**

**Rejected:** treating a DOM update, log, notification, or resolved callback as sufficient evidence.

**Why:** P30 and P47 show that a correct internal consequence in a channel the listener does not use
is still silence.

## 10. Screen drawings

These drawings are normative for information order, wording, and what is present together. They are
not pixel specifications.

### 10.1 Start / resume

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ VOICE LAB                                                     [Stop]         │
├──────────────────────────────────────────────────────────────────────────────┤
│ Calibrate my reader                                                        │
│                                                                            │
│ Hear one decision at a time. Nothing speaks until you start.               │
│                                                                            │
│  10 decisions are ready to calibrate.                                      │
│  36 are planned and do not change the reader yet.                          │
│                                                                            │
│  Identifier pronunciation and custom path wording are not built.          │
│  Today Pocket TTS receives identifiers unchanged.                          │
│                                                                            │
│  Narration  (●) Voice Lab reads instructions aloud                         │
│             ( ) My screen reader reads instructions                        │
│                                                                            │
│  [ Resume at “Where the file kind goes” ]  [ Start again ]                 │
│  [ Review accepted settings ]             [ Review 36 planned decisions ]  │
│                                                                            │
│  Draft kept in this browser · Last reader save: revision four              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 10.2 One calibration decision

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ CALIBRATION · Names and paths                         Step 4 of 10 · 3 kept  │
│ [Stop s/.] [Replay r] [Undo u] [? Hear instructions] [Review]               │
├──────────────────────────────────────────────────────────────────────────────┤
│ Where the file kind goes                                                   │
│                                                                            │
│ Sample                                                                     │
│   packages/core/src/normalizer/index.ts                                    │
│                                                                            │
│ Accepted: kind last, as a word                                             │
│ Candidate                                                                  │
│   [ kind first, as a word                                      ▾ ]         │
│                                                                            │
│ [Space Hear candidate]  [c Compare accepted with candidate]                │
│                                                                            │
│ This changes the actual path text sent to the voice.                       │
│                                                                            │
│ [Back]  [Skip for now]                 [Enter Keep and next]                │
│                                                                            │
│ Draft saved in this browser · Candidate not kept                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 10.3 Comparison transient state

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ COMPARING · Where the file kind goes                    [Stop / Esc cancel] │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│       First sample        ♪ separator        Second sample                 │
│                                                                            │
│       Which sounded better?                                                │
│                                                                            │
│       [1 Keep first as candidate]   [2 Keep second as candidate]           │
│                                                                            │
│       The values stay hidden until you choose or cancel.                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 10.4 Template calibration

This is the future-state card after a full path template has a production wire and passes the
eligibility contract in section 3.2; it is not one of today's 10 effective decisions.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ CALIBRATION · Paths                                  Step 6 of 14 · 5 kept  │
├──────────────────────────────────────────────────────────────────────────────┤
│ How a complete path is worded                                              │
│                                                                            │
│ Preset   [ Name, then location, kind last                     ▾ ]           │
│ Template                                                                  │
│ ┌────────────────────────────────────────────────────────────────────────┐ │
│ │ file {name}, in folder {folders}, {kind}                              │ │
│ └────────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│ Slots: {raw} {name} {extension} {kind} {folders} {folderCount}             │
│ This sample: name=index · kind=TypeScript file · folders=packages, core,   │
│ source, normalizer                                                         │
│                                                                            │
│ Last valid output                                                          │
│   file index, in folder packages, core, source, normalizer, TypeScript file│
│                                                                            │
│ [Ctrl+Enter Preview & use] [c Compare accepted with candidate]             │
│ [Reset draft]                                  [Enter Keep and next]       │
│                                                                            │
│ Custom (not yet previewed) · Draft saved in this browser                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

Invalid state changes the final two regions, not the layout:

```text
│ Error: unknown slot {folder}. Allowed: {folders}.                           │
│ [Preview & use — unavailable until fixed]                                  │
│ Last valid candidate is still: Name, then location, kind last              │
```

### 10.5 Planned decisions

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ PLANNED DECISIONS                                      [Back to calibration]│
├──────────────────────────────────────────────────────────────────────────────┤
│ These 36 decisions do not change the reader in this build.                 │
│ They are information, not disabled settings.                               │
│                                                                            │
│ Names, paths and identifiers                                               │
│                                                                            │
│  How an identifier is said                                                 │
│  NOT BUILT · The normalizer passes XMLHttpRequest unchanged to Pocket TTS. │
│  [Hear why this is unavailable]                                            │
│                                                                            │
│  What a file is called                                                     │
│  NOT BUILT · Custom path wording is not read by the plugin.                │
│  [Hear why this is unavailable]                                            │
│                                                                            │
│  ... plain informational rows, grouped by heard subject ...                │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 10.6 Review, save, export

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ REVIEW CALIBRATION                                             [Stop]       │
├──────────────────────────────────────────────────────────────────────────────┤
│  8 accepted · 2 need review · 0 unavailable here · 36 not built            │
│                                                                            │
│ Accepted                                                                  │
│  ✓ Which voice                         Pocket TTS                           │
│  ✓ How fast                            one point zero times                 │
│  ✓ How a path is said                  spoken in full                      │
│  ...                                                                       │
│                                                                            │
│ Needs review                                                              │
│  ! Whether the first sentence goes alone    skipped      [Review now]      │
│  ! How long a chunk                       not checked    [Review now]      │
│                                                                            │
│ Engine-personal: voice and rate were tuned on macOS with Pocket TTS.       │
│                                                                            │
│ [Save accepted values to reader]  [Export settings]  [Undo last accepted] │
│                                                                            │
│ Reader file: revision four · Browser draft: saved                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 11. Observable acceptance contract for a future implementation

This is design, but it is not complete unless its promises are falsifiable by the experience.

| Contract | Required observation | Negative control |
|---|---|---|
| C1 — one-decision isolation | Every comparison request differs in exactly one effective control id and uses identical fixture text | Deliberately vary a second setting; the trial must refuse and name both differing ids in technical details |
| C2 — no dead calibration control | Moving each eligible control changes normalized text, chunk plan, synthesis request, or production event rendering | Hand the page an effective-looking descriptor with no downstream change; it must appear in Planned/disagreement, not Calibration |
| C3 — honest 10/36 declaration | Page, narrator orientation, planned list, and review report counts from one runtime set | Remove one id from server capability; all four count surfaces move together |
| C4 — no overlap | Across change, help, stage play, compare, save error, and repeated Play, concurrent audible sources never exceed one | Trigger the same action twice on warm and cold paths; without arbiter cancellation the probe must observe overlap |
| C5 — Stop reaches both sides | Escape/s/Stop silence browser audio and cancel server synthesis | Keep synthesis running after browser nodes stop; the contract must fail |
| C6 — audio grammar closure | Every requested action ends in sample start, success, refusal, or error on the selected narration channel | Disable notifications and visual banners; the spoken or screen-reader outcome must remain |
| C7 — comparison blindness | No value/set label is spoken or exposed as an accessible announcement between start and choice | Inspect the accessibility tree/live-region tape during playback; accepted/candidate labels must be absent |
| C8 — explicit acceptance | Auditioned values are absent from Save until Keep and next | Change a value, Save accepted anyway, reload reader settings; the earlier accepted value must remain |
| C9 — template round trip | Previewed rendered event equals the string the production consumer receives for every slot fixture | Mutate a slot after preview but before production rendering; equality must fail |
| C10 — invalid template safety | Invalid draft persists for editing but never enters candidate, Save, or Export | Use unknown and unmatched slots; last valid production output must remain |
| C11 — literal-data safety | Adversarial template/slot text reaches every provider as literal data without command interpretation | Include `[[rate +100]]`, quotes, braces, dollar/command characters, and XML-like text; a provider interpretation makes the control ineligible |
| C12 — keyboard coherence | Dispatch and help derive from one map; no normalized key/context collision exists; Tab remains native | Reintroduce Tab-as-panel or `R`/`r` divergence; the map check must fail |
| C13 — focus stability | Change, Keep, Back, close, error, and rerender land focus at the specified control/heading | Replace a row and let focus fall to body; the interaction check must fail |
| C14 — reload recovery | Accepted values, unfinished candidate, invalid template draft, current decision, history, and statuses return; comparison is canceled | Reload during second comparison sample; no hidden choice/order may resume |
| C15 — persistence failure is audible | Blocking local storage produces one error outcome and leaves Export usable | Make storage throw; a silent default/reset must fail |
| C16 — revision conflict preserves both sides | External file edit causes Save refusal without overwriting disk or browser session | Change disk revision between read and write; last-write-wins must fail |
| C17 — export claims only observed effects | Clipboard success is spoken only after promise resolution; download is called requested, not completed | Reject clipboard and block popup/download; no success claim may be spoken |
| C18 — screen-reader channel exclusivity | Narrator mode speaks UI state through Lab; screen-reader mode emits equivalent live text with no narrator overlap; both retain samples | Enable both UI narration paths simultaneously; concurrent narration must fail |

## 12. Decision summary

| Decision | Chosen | Rejected because |
|---|---|---|
| Listener state | accepted value + per-question candidate | global A/B sets make unrelated differences and were not understood |
| Recovery | automatic history + Undo | named snapshots expose storage mechanics; no recovery makes audition unsafe |
| Bias control | repeatable one-trial local blind comparison | blind mode and Blind ×3 add persistent/statistical state |
| Change speech | always name and preview discrete changes | “Speak each change” was ambiguous and can disable the ear contract |
| Narration | stable frozen narrator or screen-reader-only | candidate narration confounds the thing being judged; dual narration overlaps |
| Availability | descriptor ∩ server capability ∩ proved consequence | widget shape and `wire` alone can both lie |
| Unbuilt work | prominent count + informational list | hidden prose conceals it; disabled controls imply they work |
| Template UX | visible preset populates editable string; edits become Custom | dropdown-only and hidden Custom fail the listener's request |
| Template language | literal text + named slots + escaped braces | conditionals/SSML create a programming and injection surface |
| Template errors | keep draft, keep last valid effect, refuse Save of draft | autocorrection and fallback silently change speech |
| Path wording | one complete path template | coordinating fragments does not expose the heard output |
| Identifier wording | template plus pronunciation table, only after production wire | a template alone cannot repair HTTP; engine guessing already failed |
| Persistence | one versioned atomic browser session | four keys can describe different moments; silent fallback loses work |
| Reader Save | accepted effective values only, revision guarded | candidates and `wire:null` placeholders are not chosen behavior |
| Export | same settings representation, explicit copy/download | popup/clipboard assumptions and a second schema create false claims |
| Keyboard | native forms/Tab first; old concept keys retired | global interception and key recycling break expected behavior |
| Layout | one question/card at a time | a sidebar/dashboard makes the listener scan before he can listen |

The smallest useful mental model is therefore: **hear one question, try a candidate, compare if
needed, keep it, move on**. Everything else in this specification exists to make those five actions
truthful without requiring the listener to look.
