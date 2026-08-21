# Feature Specification: Voice Lab

**Feature Branch**: `002-voice-lab`

**Created**: 2026-08-21

**Status**: Draft — spec gate for milestone M11

**Input**: `docs/design/004-voice-lab.md` (authoritative design, as amended 2026-08-21 by the
round-3 reconciliation and the latency-measurement pass), `docs/design/007-user-stories.md` US-15,
`docs/design/011-settings.md` (supersedes 004 section 7's file location and version stance),
`docs/design/009-reconciliation.md`, `docs/TASKS.md` Phase M11 (T110–T114), PITFALLS **P23**.

---

## 0. What this document is, and what it is not

004 argues. This document specifies. Where 004 reasons from a measurement to a verdict, this
document states the behaviour the system must have, the behaviour it must not have, and the probe
that would show it absent.

**One rule governs the whole document, and it is the reason M11 exists.** The Voice Lab ships the
*option space* and provisional defaults. It does **not** settle taste. Every place 004 leaves a
value to the listener, this specification leaves it too — see "The taste boundary" (FR-090 to
FR-093). A requirement in this document that fixed one of those values would re-create P23 in the
one artifact built to end it.

**Precedence for this feature**, highest first:

1. A NON-NEGOTIABLE principle of `.specify/memory/constitution.md` Part I.
2. `docs/design/011-settings.md`, for the settings file's location, format, envelope and version
   policy — it explicitly supersedes 004 section 7 on those points.
3. `docs/design/004-voice-lab.md` as amended, for everything else.
4. `docs/TASKS.md` Phase M11. Where T110–T114 disagree with 3, the design wins; every such
   correction is listed in "Corrections to `docs/TASKS.md` Phase M11" below.

**Numbers.** Every latency figure carries an R006 label. Unlabelled numbers in this document are
budgets and limits, not measurements.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Hear a fixture, change one control, hear the difference (Priority: P1) 🎯

This is US-15 steps 1–7 and it is the whole milestone. The listener starts the lab, plays a
committed fixture, hears a specific thing that is wrong, moves to the control that governs it,
changes it, and hears the new version — without touching ORCA, without a rebuild, and without
reading anything.

**Why this priority**: it is Gate M11. Every other story is worthless if this one does not hold,
because the reason the lab exists is that the tune–listen loop must be seconds long (P23). If only
this story shipped, the author could settle identifier speech, path depth and extension placement —
the three open decisions in `HANDOFF.md` — which is the entire business value of M11.

**Independent Test**: run `pnpm voice-lab`, open the page, press `Space`, press `↓` to a wired
control, press `→`, press `Space`. Both playbacks are audible, differ audibly, and the second one
starts within the gate.

**Acceptance Scenarios**:

1. **Given** the lab is serving and fixture `paths.md` is selected, **When** the listener presses
   `Space`, **Then** the fixture is spoken through the browser's audio output, the status bar shows
   `cold` and an elapsed millisecond count, and no player process is spawned anywhere.
2. **Given** the fixture has just played, **When** the listener presses `Space` again with no
   control changed, **Then** playback starts from the decoded cache, the status bar shows `warm`,
   and the recorded warm elapsed value is strictly smaller than the recorded cold one.
3. **Given** focus is on a wired control, **When** the listener presses `→`, **Then** the page
   speaks the control's name and its new value — and nothing else — in the voice and rate currently
   under test, and the written-versus-spoken pane re-renders with the changed spans underlined.
4. **Given** a control was just changed, **When** the listener presses `Space`, **Then** first audio
   of the affected text is audible within the gate defined in FR-020, measured and recorded, not
   estimated.
5. **Given** the platform yields no audio bytes (the `spoke-elsewhere` rung, FR-034), **When** the
   listener presses `Space`, **Then** the page states aloud that this machine's speech service
   played it, names the install remedy, and disables — visibly, audibly, with the reason attached —
   Compare, replay, per-stage play and the timing readout.

---

### User Story 2 — Understand *why* it sounds like that (Priority: P2)

The listener hears something wrong and does not know which control governs it. The stage ladder and
the stage-attributed word diff turn "this sounds wrong" into "turn this control".

**Why this priority**: without it the 46-control surface is a haystack. It is P2 rather than P1
because a listener who already knows which control to turn can settle taste without it.

**Independent Test**: press `E` on a fixture whose text exercises paths; the ladder names the stage
that rewrote the path and the control that governs that stage, and each stage row plays on its own.

**Acceptance Scenarios**:

1. **Given** a fixture is loaded, **When** the listener presses `E`, **Then** the stage ladder opens
   over the written/spoken panes showing one row per pipeline stage, each row showing only what that
   stage changed.
2. **Given** the ladder is open and a stage did not run because a control disabled it, **When** the
   listener reads or hears that row, **Then** it says *not run* and names the control that disabled
   it — never *no change*, which would be false (FR-042).
3. **Given** a changed word span in the spoken pane, **When** it is focused, **Then** the page names
   the stage that produced it and the control that governs that stage, or says *fixed by design*
   when no control governs it.
4. **Given** any word span in the spoken pane, **When** it is inspected, **Then** it carries stable
   character offsets into the spoken string (FR-045).

---

### User Story 3 — Decide between two candidates without fooling yourself (Priority: P2)

The listener is unsure whether the change was an improvement. Compare plays both, blind, and reveals
only after it stops.

**Why this priority**: this is the specific mechanism that fixes the chat loop's *expectation*
failure, as distinct from its *latency* failure. Story 1 fixes the latency; this fixes the bias.

**Independent Test**: with A and B differing in exactly one control, press `C`; the page shows only
"first"/"second" during playback and names the differing control after.

**Acceptance Scenarios**:

1. **Given** sets A and B differ, **When** the listener presses `C`, **Then** the page plays A, the
   reserved `control.compare` separator, then B, showing only "first" and "second" throughout.
2. **Given** Compare has stopped, **When** the reveal happens, **Then** the page speaks and shows
   which set was first and names the control(s) that differ (FR-051 governs more than one).
3. **Given** the reveal has happened, **When** the listener presses `1` or `2`, **Then** that set
   becomes current with one keystroke and no confirmation dialog.
4. **Given** the listener does not trust their own judgement on a control, **When** they invoke
   Blind × 3, **Then** the order is shuffled per trial, three trials run, and the page reports the
   count chosen before revealing — and this mode is never the default.

---

### User Story 4 — Keep the tuning, and make the plugin use it (Priority: P3)

Ten minutes of ear-tuning survives a reload, a restart and a crash; and when the listener is
satisfied, one action makes the plugin speak that way.

**Why this priority**: it is what converts a settled taste into a shipped setting. P3 because the
first three stories are what make a value worth saving; a lab that saved nothing would still have
told the author what he wanted to know, which is more than chat did.

**Independent Test**: change three controls, reload the page, confirm all three survived; press Save
to plugin and confirm the inbox file on disk contains those values with a bumped revision.

**Acceptance Scenarios**:

1. **Given** controls have been changed, **When** the page is reloaded or the browser restarted,
   **Then** the working set, both A/B slots and all named snapshots are restored.
2. **Given** browser storage is unavailable or throws, **When** the page loads, **Then** it renders
   correctly from schema defaults and says so — it never renders blank or wedged.
3. **Given** a tuned working set, **When** the listener invokes **Save to plugin**, **Then** the
   settings inbox is rewritten whole from the schema template with `revision` incremented, and the
   page states aloud that it saved and where.
4. **Given** the inbox on disk has a `revision` the lab has not seen (a hand-edit landed since the
   lab last read it), **When** the listener invokes Save, **Then** the Save is refused as
   `stale_revision`, spoken once, and nothing is overwritten.
5. **Given** a tuned working set, **When** the listener invokes **Export a copy**, **Then** a
   separate file is written that the plugin never reads and that a human may annotate freely.

---

### Edge Cases

- **The provider throws, or the platform has no synthesizer.** `POST /speak` answers `503` with the
  provider's error text and the page says it aloud and in text. Never a dead, silent Play button.
- **The provider speaks elsewhere** (stock Ubuntu `spd-say`). Named state, four affordances
  disabled with the reason attached, written-versus-spoken half still fully working, install remedy
  spoken. The two-second gate is **not satisfiable on this rung** and the lab says so.
- **The chosen voice does not take.** macOS `say` accepts an unknown voice name, exits 0 and writes
  a full-length WAV of the default voice. The lab must detect this by effect (FR-032) rather than
  trust the exit code.
- **A control the listener turns changes nothing audible** because it is not wired to any consumer.
  This is true of most of the surface today (FR-013 to FR-016) and is the single largest honesty
  risk in this milestone.
- **A fixture longer than one sentence.** `generate()` is p50 1,054–1,163 ms per sentence
  `[measured-here]`, so a non-streaming cold path misses the gate on any multi-sentence fixture.
- **The listener drags a slider.** Thirty confirmations must not queue behind the drag.
- **A phrase template containing `[[` on macOS, or `'` on Windows.** User text reaches the
  synthesizer; `[[` is an in-band command on macOS and PowerShell interpolation is escaped only for
  `'`. See FR-036.
- **The lab is opened while huddle mode is running in ORCA.** Both would then be speaking.
- **Browser storage throws** — private window, cleared site data, thumbnail capture.

---

## Requirements *(mandatory)*

Each requirement is independently testable and carries its verification. "Verify" lines name what
would prove the requirement **absent**; a check that could not have failed does not satisfy them
(constitution principle V, R003, PITFALLS **P33**).

### A. The lab process and its boundaries

- **FR-001**: The lab MUST start from one command, `pnpm voice-lab`, and MUST serve a page and an
  API from a local HTTP server bound to `127.0.0.1` only.
  *Verify*: connect from a non-loopback address on the same host and assert the connection is
  refused; connect from loopback and assert `200`. Both halves, or the test cannot fail.
- **FR-002**: The lab MUST import the **TypeScript source** of `@orca-tts/core`, never a build
  output, so that the normalizer being tuned is the normalizer that ships.
  *Verify*: a test asserts the lab's resolved module path for `normalize` contains `/src/`. Enforced
  mechanically, not as an instruction to a human.
- **FR-003**: The page MUST be self-contained: no CDN, no external network request, no build step.
  *Verify*: load the page with all outbound network blocked and assert every acceptance scenario of
  User Story 1 still passes.
- **FR-004**: The lab MUST NOT involve ORCA. It MUST NOT require ORCA to be installed, running, or
  configured, and MUST NOT read or write ORCA's `userData`, transcripts or plugin data directory.
  *Verify*: run the full User Story 1 flow with `ORCA_*` environment unset and no ORCA process; then
  assert by file-system audit that nothing under `<userData>` or `~/.orca/` was opened for writing.
- **FR-005**: The lab MUST NOT require the neural engine (M9) or a resident service. It MUST run
  against the OS synthesizer as shipped.
  *Verify*: run with no model cache present and assert User Story 1 passes.
- **FR-006**: The server MUST NOT spawn an audio player and MUST NOT open an audio device. All
  playback belongs to the browser (constitution IV / R021).
  *Verify*: run a full session under process accounting and assert zero child processes other than
  the synthesizer; and assert the server opened no audio device. The control case is the synthesizer
  spawn, which must still appear — otherwise the probe is measuring nothing.
- **FR-007**: The page MUST hold exactly one `AudioContext` for the session and schedule all chunks
  on it, so the audio device is opened once rather than once per chunk.
  *Verify*: assert one `AudioContext` instance across a session in which at least four chunks
  played, and assert the measured inter-chunk gap in the lab is below the 50 ms budget — against the
  shipped sink's p50 897–950 ms `[measured-here]` (n=18 ×3, `docs/.research/latency-measurements.md`
  1.1) as the contrast case.
- **FR-008**: The audio layer MUST branch on the provider's declared `chunk.format` and MUST NOT
  assume WAV, so that a future PCM-emitting provider is a ten-line change and not a rewrite.
  *Verify*: feed the page a synthetic `pcm-s16le` chunk and assert it plays; feed a `wav` chunk and
  assert it plays. A single-format test cannot fail for the right reason.

### B. The control surface

- **FR-010**: The lab MUST render the control inventory of `docs/design/004-voice-lab.md` section 6
  — **46 controls in six panels**: 7 omissions · 7 structure · 9 names and paths · 4 numbers ·
  9 voice and pacing · 10 interruptions and announcements. The inventory, with each control's id,
  type, legal values, provisional default, tier, tag and consumer, is Appendix A of this document
  and is normative for M11.
  *Verify*: a test iterates the rendered control ids and asserts the set equals the inventory's set,
  in both directions. Adding a control to the inventory without rendering it fails; rendering one
  not in the inventory fails.
- **FR-011**: Every control MUST declare its **class**, and the class MUST be visible and speakable:
  | Class | Meaning | Count today |
  |---|---|---|
  | `wired` | the value reaches a typed options object a consumer reads today | **10 rows / 9 fields** |
  | `designed` | the option space is specified; no consumer reads it yet | **35 rows** |
  | `lab-only` | affects the lab's own playback and nothing in the plugin, ever | **1 row** — `pace.simulateChunkGapMs`; fixture and set selection are lab state, not controls, and are not counted in the 46 |
  *Verify*: assert the per-class counts against the inventory, and assert each `wired` control's
  value arrives at its named consumer end-to-end (the P26 reachability shape), with the control case
  of an unset control producing `{}` at the consumer.
- **FR-012**: The `wired` set MUST be exactly: `omit.codeBlocks`, `struct.orderedLists`,
  `path.style`, `path.extensionStyle`, `num.expandIntegers` + `num.expandUnits` (one field today —
  see FR-017), `pace.chunkMaxUnits`, `pace.isolateFirstSentence`, `voice.id`, `voice.rate`.
  *Verify*: derive the list at test time from `NORMALIZE_OPTION_KEYS`, `CHUNKER_OPTION_KEYS` and
  `SYNTHESIZE_OPTION_KEYS` and compare to the inventory's `wired` set. Adding a normalizer option
  without wiring a control fails the test.
- **FR-013** *(the honesty requirement — the sharpest one in this milestone)*: A `designed` control
  MUST NOT present itself as live. Turning it MUST produce an audible and visible statement that the
  value was recorded but that nothing consumes it yet, naming the milestone that will. It MUST NOT
  silently do nothing.
  *Verify*: turn each `designed` control in turn and assert the page produced the not-yet-wired
  statement — asserted on the spoken text handed to the provider, not on a log line or a CSS class
  (PITFALLS **P30**). Control case: turning a `wired` control must produce **no** such statement.
- **FR-014**: A `designed` control's value MUST still be recorded in the working set, persisted, and
  written to the settings file, so that the option space is settleable the moment a consumer exists.
  *Verify*: set a `designed` control, Save, and assert the value appears in the file on disk.
- **FR-015**: The status bar MUST show the live counts — total controls, engine-provisional count,
  and **the number that are not yet wired** — so the gap is visible rather than discovered.
  *Verify*: remove a wire in a scratch build and assert the displayed unwired count increments. An
  indicator that never changes is a broken indicator.
- **FR-016**: Gate M11 (FR-020) MUST be asserted only over `wired` controls. The specification
  states plainly that **the change→hear loop is exercisable today on 10 of 46 rows**, and that this
  is a scope fact about the current normalizer, not a defect in the lab.
- **FR-017**: The lab MUST render `num.expandIntegers` and `num.expandUnits` as two independent
  controls even though one field (`expandNumbers`) governs both today, and MUST make the split
  visible; the split must reach the schema before M12 freezes it.
  *Verify*: assert two distinct control ids exist and that both currently map to the single field,
  with the mapping declared rather than implicit.
- **FR-018**: Each panel MUST open with a **Common** tier of two to four controls, with the rest
  behind that panel's More tier. Nothing is rendered as a grid.
- **FR-019**: Every control MUST carry its tag — `EI` engine-independent, `EP` engine-provisional,
  `PP` pacing-provisional — and the tag MUST be speakable on request.

### C. The gate, made measurable

004's gate is *"change a control, hear the difference in under two seconds, without touching
ORCA"*. FR-020 to FR-027 turn that into something a test asserts.

- **FR-020** *(Gate M11)*: For every committed fixture and every `wired` control, the interval from
  **t₀** to **t₁** MUST be ≤ **2,000 ms** at p95 over 20 consecutive trials, where:
  - **t₀** = the `timeStamp` of the DOM keyboard event that requested audio — the `→`/`←` that
    changed the value when speak-on-change is on, or the `Space` that started the fixture;
  - **t₁** = the wall-clock instant of the **first audible sample of the affected audio**, derived
    from the `AudioContext` time at which the first `AudioBufferSourceNode` for the changed text
    actually starts, converted to the same clock as t₀.
  It is time to **first** audio, never to complete audio, and it is measured with
  `lab.simulateChunkGapMs` at `0`.
  *Verify*: FR-025 and FR-026.
- **FR-021**: The gate MUST hold on both paths, recorded separately and both reported:
  | Path | Condition | Requirement |
  |---|---|---|
  | **warm** | the affected text is already decoded in the page's buffer cache | ≤ 2,000 ms, and strictly less than the cold reading for the same text |
  | **cold** | synthesis is required | ≤ 2,000 ms to first audible sample |
  *Verify*: assert both rows from the recorded log, and assert `warm < cold` for the same text. If
  they are equal the harness is not distinguishing them and the gate is not being measured.
- **FR-022** *(the mechanism that makes warm possible)*: Decoded audio MUST be cached in the page,
  keyed so that a cache hit is only ever returned for bytes that would be byte-identical. Replay is
  `start()` on a cached buffer — no re-synthesis, no round trip.
  *Verify*: play, change nothing, play again, and assert zero `POST /speak` requests on the second
  play. Control case: change a control that affects the bytes and assert a request **is** made.
- **FR-023** *(the cache-key correctness requirement)*: The cache key MUST include **every** input
  that can change the returned bytes — at minimum the chunk's spoken text, the provider id, and
  every `synthesize.*` value in effect, including any that are added later. It MUST NOT be a
  hand-listed subset.
  *Verify*: for each `synthesize.*` control, change it, replay, and assert the audio actually
  differs (compare decoded buffers, not request counts). This is the probe that catches a stale hit
  presenting as "that control did nothing" — which the listener would read as a taste result.
- **FR-024** *(the mechanism that makes cold possible)*: For a multi-sentence fixture, the server
  MUST deliver chunk 1 to the page while it is still synthesizing chunk 2. A response envelope that
  returns all chunks at once MUST NOT be the path the gate is measured on.
  *Rationale, labelled*: one real sentence through `OsSynthProvider.generate()` is p50
  1,054–1,163 ms `[measured-here]` (n=9 ×2, `docs/.research/latency-measurements.md` 1.3), which is
  ~55 % of the gate for one sentence; three sentences serialized is ~3.2 s and misses outright.
  *Verify*: FR-026's negative control.
- **FR-025**: The lab MUST record every gate measurement in a machine-readable form — one record per
  trial, carrying t₀, t₁, path (`cold`/`warm`), fixture, control changed, chunk count, provider id
  and platform — and the gate MUST be evaluated by a script over those records, never by a
  stopwatch or by a human's impression.
  *Verify*: run the flow and assert the record count equals the trial count; a missing record is a
  failed run, not a silent zero.
- **FR-026** *(the negative control — without this, FR-020 is a ritual)*: The same harness, run with
  first-chunk streaming disabled against the longest committed multi-sentence fixture, MUST record a
  cold reading that **exceeds** 2,000 ms.
  *Verify*: run it and assert failure. If the disabled-streaming run also passes, the harness is not
  measuring what FR-020 claims and the gate is void.
- **FR-027**: The status bar MUST show the cold/warm state and the elapsed millisecond count for the
  most recent play, and the displayed number MUST be the recorded one.
  *Verify*: assert the displayed value equals the logged value for the same trial, and assert that
  across a session the value takes at least two distinct values.
- **FR-028**: The gate MUST be declared **not satisfiable** on the `spoke-elsewhere` rung
  (FR-034), and the lab MUST say so on that rung rather than reporting a gate it did not measure.
  *Verify*: force that rung and assert the gate harness reports `not-applicable` with the reason,
  and that it does not report a pass.

### D. Synthesis, playback and failure

- **FR-030**: `POST /normalize` MUST return the spoken text **and** the per-stage record: for each
  pipeline stage, its ordinal, its name, its output, whether it ran, and the control ids that govern
  it.
  *Verify*: assert the response's stage list against the pipeline read from source, and assert a
  stage disabled by a control is reported as *not run*, not as *no change*.
- **FR-031**: `POST /speak` MUST run the same **normalize → chunk → synthesize** path the plugin
  uses, and MUST return audio bytes. It MUST NOT play.
  *Verify*: FR-006, plus a test asserting the lab's spoken text for a fixture equals
  `normalize(fixture, options)` computed independently.
- **FR-032**: When a voice is first used, the lab MUST verify by effect that the engine honoured it
  — synthesize a short probe under the chosen voice and under the platform default and compare the
  bytes — and MUST say aloud *that voice did not take; the system substituted its default* when they
  are identical.
  *Verify*: request a voice name that does not exist and assert the spoken substitution warning;
  control case, request a real voice and assert **no** warning.
- **FR-033**: `voice.id` MUST be populated only from the provider's runtime voice list and MUST NOT
  accept free text. The list MUST be cached for the session (enumeration costs p50 487/472 ms on
  macOS `[measured-here]`, n=6 ×2, `latency-measurements.md` 1.6).
  *Verify*: assert exactly one enumeration per session; assert a free-text value is rejected.
- **FR-034**: The lab MUST handle **three** provider outcomes, not two:
  | Outcome | Lab behaviour |
  |---|---|
  | **bytes** | decode, cache, play in the page |
  | **throw** | `503` carrying the provider's error text; the page says it **aloud** and in text |
  | **spoke-elsewhere** | `200 { played: 'elsewhere', backend }` read from the provider's own capability, announced through the daemon that will speak everything else, with the install hint taken from the provider's existing constant and never a second copy of it |
  *Verify*: force each of the three and assert the named behaviour. For `spoke-elsewhere`, assert
  the announcement was **spoken** (asserted on the daemon call), and run the same probe with a
  byte-yielding backend asserting the affordances are **enabled** — without that half the test
  cannot fail for the right reason.
- **FR-035**: On `spoke-elsewhere`, exactly four affordances MUST be disabled **with the reason
  attached and never hidden** — Compare, replay, per-stage play, the timing readout — and everything
  not depending on owning the bytes MUST keep working: the written-versus-spoken pane, the word
  diff, the stage ladder, and export.
- **FR-036**: Free-text phrase templates reach the synthesizer. The lab MUST apply the project's
  escaping contract to every template value before synthesis, on every platform.
  *Verify*: put `[[volm 0.2]]` in a phrase template on macOS and assert the audio is not silenced;
  put `'; ` in one on Windows and assert the command still runs and speaks the literal text.
- **FR-037**: Stop MUST be two-sided (constitution VII): the page stops playback **and** the server
  aborts in-flight synthesis. Stopping MUST NOT clear the working set, the cache, or any snapshot.
  *Verify*: start a long fixture, press Stop, assert no further chunks are handed to the audio graph
  **and** assert the synthesizer child process exited. Control case: without Stop, all chunks play.

### E. Understanding what happened

- **FR-040**: The default and only view MUST be written-versus-spoken. The stage ladder MUST be one
  keystroke away and MUST NOT be on screen unless asked for.
- **FR-041**: The stage ladder MUST have exactly one row per stage of the shipped pipeline, in
  pipeline order, and the row count and names MUST be derived from the source, not hard-coded.
  *Verify*: assert the ladder's stage names equal the pipeline's, read from
  `packages/core/src/normalizer/index.ts` (the call list in `normalize()`). Adding a stage without a row fails.
- **FR-042** *(three row states, not two)*: A row MUST distinguish **changed** (show only what that
  stage changed), **no change** (it ran and altered nothing), and **not run** (a control disabled
  it, naming the control). Two stages in the shipped pipeline are conditional —
  `speakFilePaths` at `packages/core/src/normalizer/index.ts:103` and the
  `expandUnits`/`expandNumbers` pair at `:107` — so a two-state ladder reports a falsehood whenever
  `path.style` is `verbatim` or number expansion is off.
  *Verify*: set `path.style` to `verbatim` and assert the row reads *not run*, naming `path.style`;
  control case, set it back and assert the row reads *changed*.
- **FR-043**: Every stage row MUST be independently playable, and the row before it MUST be playable
  alongside, so "why does this sound wrong" is answered by hearing the before and the after.
- **FR-044**: The diff MUST be **word-level and stage-attributed**. Character-level diff is
  prohibited: it is noise for this reader.
  *Verify*: assert a known rewrite produces one attributed span rather than a run of fragments.
- **FR-045**: Every word span in the spoken pane MUST carry stable character offsets into the spoken
  string, so a later word cursor is a display change and not a rewrite of the pane.
  *Verify*: assert every span's offsets index the exact substring it renders.
- **FR-046**: A span produced by a stage no control governs MUST say so — *fixed by design* —
  naming the stage. A control the lab deliberately does not expose MUST be visible as a decision
  taken, not as an omission.
- **FR-047**: The diff MUST NOT rely on an external library, and colour MUST NOT be the sole carrier
  of meaning: a changed span is also underlined and reachable by keyboard.

### F. Compare

- **FR-050**: Compare MUST be blind during playback — "first" and "second" only — and revealed the
  instant it stops, with no extra click and no extra reading.
- **FR-051**: The reveal MUST name the differing control. When the two sets differ in more than one
  control, it MUST name at most three and then state the count of the rest; it MUST NOT read the
  whole set and MUST NOT silently name only one of several. *(004 section 3 specifies the
  single-difference case only; this requirement generalises it — see Finding 3.)*
  *Verify*: construct sets differing in one, in three and in eight controls; assert the three
  announcements.
- **FR-052**: Keep-first / keep-second MUST each be one keystroke and MUST make that set current
  with no confirmation step.
- **FR-053**: Blind × 3 MUST shuffle order per trial, run three trials, report the count chosen, and
  be opt-in — never the default.
- **FR-054**: The A/B separator MUST be the reserved `control.compare` earcon from the project's one
  earcon table. The lab MUST NOT mint tones and MUST NOT choose its own durations.
  *Verify*: assert every earcon the lab emits is a member of the reserved control band, and that
  none is a member of the identity space. A listener who has learned an agent's motif must never
  hear it as a Stop confirmation.

### G. Accessibility — first-class, not a section at the end

The person operating this instrument is the person the whole product is for. These are functional
requirements and each one fails the build if absent.

- **FR-055**: The layout MUST be one column, one control per row, full width. No two-dimensional
  scanning, ever.
  *Verify*: assert no rendered control row shares a horizontal band with another control.
- **FR-056**: Every control row MUST be at least **64 px** tall with a hit target spanning the full
  row width.
  *Verify*: measure the rendered bounding box of every row and assert the minimum; assert the
  clickable area equals the row, not the widget inside it.
- **FR-057**: The keyboard MUST be sufficient to perform every operation in every acceptance
  scenario in this document. No operation may require a pointer.
  *Verify*: drive all four user stories through synthesized key events only and assert each
  completes.
- **FR-058**: The key bindings MUST come from the project's single shared key map, consumed by both
  the lab and the terminal control surface. The lab MUST NOT define its own vocabulary, and a key
  MUST NOT mean one thing here and another there.
  *Verify*: assert the lab's binding table is the shared map, by identity; assert no key in the map
  has two meanings across the two surfaces. A listener who is not looking is building one muscle
  memory, and a key that changes meaning is worse than a key that moves.
- **FR-059**: Focus MUST never move on its own. No modal steals it, no re-render resets it, and
  changing a value MUST NOT re-order anything on screen.
  *Verify*: change every control type in turn and assert the focused element is unchanged after each
  re-render.
- **FR-060**: On any control change the page MUST speak a confirmation of **control name, then
  value, and nothing else**, in the voice and rate currently under test — so that the voice controls
  are judged by the sentence that announces them.
  *Verify*: assert the exact spoken text; assert it was synthesized with the current
  `synthesize.*` values and not with defaults.
- **FR-061**: The confirmation MUST be debounced 250 ms and issued in `replace` mode, so a slider
  drag can never queue a backlog of confirmations.
  *Verify*: emit thirty change events in 300 ms and assert at most one utterance was synthesized.
- **FR-062**: The confirmation MUST travel the **same** normalize → chunk → synthesize path as the
  fixture. There MUST NOT be a second speech implementation in the lab.
  *Verify*: assert the confirmation and the fixture both pass through the same entry point, by
  instrumenting that entry point rather than by reading the code.
- **FR-063**: The confirmation MUST be mutable by one key and MUST auto-mute while a fixture is
  playing. Confirmation audio MUST NOT be what FR-020 measures.
  *Verify*: start a fixture, change a control mid-playback, assert no confirmation was spoken and
  the fixture was not interrupted.
- **FR-064**: Every control's **value** MUST be spoken and displayed as words, never as a bare
  number: "last two folders", not "2".
  *Verify*: assert no control's rendered or spoken value is a bare numeral for any legal value.
- **FR-065**: Play, stop, skip and error MUST each have a distinct audible signal, taken from the
  reserved control band (FR-054), so "is it doing anything" never needs to be read.
- **FR-066**: Every error state MUST be **spoken**, not only rendered. A `503`, a
  `spoke-elsewhere`, a stale-revision refusal and a storage failure all terminate in audio.
  *Verify*: construct the lab with **no** logging and **no** on-screen error channel, cause each
  failure, and assert on the text the provider was handed. A test that asserts a callback fired does
  not satisfy this (PITFALLS **P30**).
- **FR-067**: The lab MUST be operable without reading. The written-versus-spoken panes are a
  confirmation for the times the listener is looking, not the interface.
  *Verify*: run every User Story 1 and 3 acceptance scenario with the display covered.
- **FR-068**: Text panes MUST use a large serif face with generous line height and no syntax
  colouring.
- **FR-069**: `?` MUST speak the focused control's one-line description.

### H. Persistence, export and the settings contract

- **FR-070**: The working set, both A/B slots and all named snapshots MUST survive a page reload and
  a browser restart, autosaved on change with a 200 ms debounce.
  *Verify*: change, reload, assert restored; assert the write is debounced by emitting rapid changes
  and counting writes.
- **FR-071**: Every browser-storage read and write MUST be individually guarded, and the page MUST
  render correctly from schema defaults when storage is empty or throws.
  *Verify*: run with storage throwing on every access and assert the page is fully operable.
- **FR-072**: The lab MUST NOT declare the schema. It MUST import the shared settings module that
  the plugin also imports, and no generator may sit between them.
  *Verify*: assert both the lab and the plugin resolve the same module instance for the schema.
- **FR-073**: **Save to plugin** MUST write the settings **inbox** in the project's own namespace —
  `${XDG_CONFIG_HOME:-~/.config}/orca-tts/settings.jsonc` on Linux,
  `~/Library/Application Support/orca-tts/settings.jsonc` on macOS,
  `%APPDATA%\orca-tts\settings.jsonc` on Windows, overridden by `$ORCA_TTS_CONFIG_DIR` when set. It
  MUST NOT write `~/.orca/`, MUST NOT write ORCA's `userData`, and MUST NOT attempt ORCA's settings
  KV — which is unreachable from a browser page by construction.
  *Verify*: Save on each platform and assert the path written; assert by file-system audit that
  nothing under `~/.orca/` or `<userData>` was opened for writing.
  *(This supersedes 004 section 7's `~/.orca/read-aloud/settings.json` per `011` section 1.)*
- **FR-074**: The written file MUST carry the ordering envelope — `kind`, `schemaVersion` (**2**,
  not 1), a monotonic integer `revision`, `writtenAt` for humans only, `writtenBy`, `provenance`,
  `settings`, `expected` — and MUST be JSONC with generated per-field comments taken from the
  schema.
  *Verify*: assert every envelope field is present and that `revision` strictly increases across two
  Saves.
- **FR-075**: The lab MUST re-read the file immediately before every Save and MUST refuse to
  overwrite a `revision` it did not last see, reporting `stale_revision` **aloud, once**.
  *Verify*: mutate the file externally between a read and a Save, assert the refusal and assert the
  external edit survives intact.
- **FR-076**: The lab MUST warn — audibly — before the first Save over a file whose `writtenBy` is
  `hand`, because a Save regenerates the file and a human's own comments do not survive it.
- **FR-077**: `provenance` MUST record the provider id, the platform, a hash of the voice list, the
  lab version and the tuning timestamp, because engine-provisional values do not port.
- **FR-078**: **Export a copy** MUST be a separate artifact that the plugin never reads.
- **FR-079**: The lab MUST write the `expected[]` oracle from the text it actually spoke, never
  re-derived, one entry per committed fixture.
- **FR-080**: `expected[]` MUST record the **chunk boundaries** as well as the spoken string,
  because chunking is what the listener heard and a file that reproduces the words but not the
  pauses has not reproduced the experience. *(004 section 7's schema has no field for this while
  004 section 7 step 5 requires asserting it — see Finding 5.)*
- **FR-081**: The lab MUST emit a **settled report** listing each control the listener settled, its
  value, and when it was heard, so that "settled by ear" leaves a durable trace rather than living
  in a chat log.
- **FR-082**: `lab.*` values MUST be written under a prefix the plugin never reads.
  *Verify*: a test asserts the plugin's loader ignores every `lab.*` key.

### I. Fixtures

- **FR-085**: The fixture corpus MUST be committed to the repository, so the input to every
  comparison is fixed and reviewable.
- **FR-086**: The corpus MUST cover, at minimum: a code-heavy reply (fences, inline code,
  identifiers with leading underscores); a table-heavy reply (2-column, 4-column, ragged, and one
  with no header row); a path-heavy reply (shallow, deep, unknown extensions, paths with trailing
  punctuation); a long architecture explanation (the queue and skip stress case); a short answer
  (the latency case); and a hostile case (emoji, box-drawing diagram, URLs, keyboard glyphs, mixed
  right-to-left text).
- **FR-087**: Each fixture MUST declare its sentence count, and the corpus MUST contain at least one
  fixture of three or more sentences — the case FR-024 and FR-026 exist for.
  *Verify*: assert the declared count equals the chunker's actual sentence count for each fixture.
- **FR-088**: The page MUST offer a free-text input alongside the fixture picker, so a listener can
  paste the reply that actually annoyed them.

### J. The taste boundary — stated as a requirement

- **FR-090**: The lab MUST ship every control's option space with a **provisional** default, and
  every provisional default MUST be marked as such — visibly, audibly, and in the exported file.
  *Verify*: assert every default is either marked `provisional` or carries a written rationale;
  a default with neither fails.
- **FR-091**: Settling a default MUST be a **data edit** — one line changing a value and clearing
  its provisional mark — with no consumer touched and no test rewritten.
  *Verify*: change one provisional default in the schema and assert the shipped behaviour changed
  with no other file modified.
- **FR-092**: This specification does **not** set, and MUST NOT be read as setting, the values of:
  | Question | Control | Option space is specified in |
  |---|---|---|
  | How an identifier is spoken | `ident.style` | 004 row 22 |
  | How much of a path is spoken, and to what depth | `path.depthPolicy`, `path.depthN` | 004 rows 19–20 |
  | The wording of every announcement and phrase template | `omit.codeBlockPhrase`, `omit.urlPhrase`, `path.namePhrase`, `path.folderPhrase`, `struct.tableLeadIn`, `announce.switchPhrase`, `announce.statusTemplate` | 004 Panels A–F |
  | Which session label is spoken | `announce.sessionLabel` | 004 row 39, resolved chain |
  | The spoken-overhead budget — how much preamble may precede a reply, and what is dropped first | (opened as Q61; no control exists yet — see Finding 6) | `009` section 3, `003`, `005` |
  | The huddle reply cap's number | `input.huddleReplyCap` | 004 row 46 — its **existence** is settled correctness; only the number is taste |
- **FR-093**: Where a value is **correctness** rather than taste, the lab MUST NOT offer it as a
  choice. Specifically: no control may produce a hexadecimal session label; the
  `announce.sessionLabelHashChars` control defaults to `0`, lives in the More tier, and the lab
  speaks a one-time warning if it is ever raised above `0`.
  *Verify*: assert no legal value of `announce.sessionLabel` yields hex; assert the warning is
  spoken when the slider is raised, and **not** spoken when it is not.

### K. Non-goals — what M11 deliberately does not do

- **FR-095**: The lab MUST NOT expose the constants 004 declares fixed by design: the key-glyph
  table, the large-number cutoff, issue-number handling, the empty-output threshold, the
  abbreviation table, overflow-notice coalescing, sample rate, the spawn timeout, the clipboard
  timeout, the transcript watch window, the debounce, the remembered-id cap, and the ambiguity
  window. *A lab that exposes everything is not a lab; it is a config file with a Play button.*
  Each MUST nevertheless appear in the stage view as **fixed by design**, so the listener can see
  the decision was made rather than overlooked.
- **FR-096**: M11 MUST NOT emit SSML and MUST NOT change `normalize()`'s output contract. Pause
  controls are denominated in **milliseconds** so that a value chosen today survives the arrival of
  a pause primitive; the encoding is deferred.
- **FR-097**: M11 MUST NOT implement a live word cursor. Its only obligation is FR-045's offsets, so
  the cursor is later a display change and not a rewrite.
- **FR-098**: M11 MUST NOT build a second playback path for the plugin, and MUST NOT attempt to fix
  the shipped inter-chunk gap. The gap is CoreAudio device open, pre-roll, post-roll and teardown —
  ~893 ms `[derived]` of a p50 897–950 ms gap `[measured-here]` — and holding the **device** open is
  M9's job, not M11's.
- **FR-099**: M11 MUST NOT require, wait for, or block on the neural engine, a resident service, a
  sidecar, or any upstream ORCA change.
- **FR-100**: M11 MUST NOT tune defaults on the author's behalf. See FR-092.

### L. Cross-platform and CI

- **FR-105**: The normalize-side behaviour MUST run headlessly on macOS, Linux and Windows in CI:
  fixtures in, normalized text out, settings round-tripped, stage records asserted.
- **FR-106**: CI MUST be **silent**. No CI job and no default local command may open an audio
  device. Audible probes are behind an explicit opt-in that prints a warning first.
  *Rationale, and it is a requirement rather than a preference*: an audible probe running on the
  author's machine interrupts the person the product is for (PITFALLS **P31**), and a benchmark
  whose default behaviour interrupts the user is a benchmark that gets deleted.
  *Verify*: run the CI job with the audio device instrumented and assert zero opens. Control case:
  run the opt-in form and assert the device **is** opened — otherwise the probe proves nothing.
- **FR-107**: A capability CI cannot exercise MUST be reported as **not-run with its reason**, never
  omitted from the report.
  *Verify*: assert the report's expected/reported/ran/not-run counts reconcile, and that the job
  exits non-zero when a probe neither ran nor declared a reason.
- **FR-108**: The two-second gate MUST NOT be a CI threshold. Absolute audio latency is dominated by
  the machine's audio stack and CI runners have no audio device at all; a threshold there would be a
  permanently-green light. The gate is asserted on the author's machine from the recorded log
  (FR-025), and CI asserts the **harness** — that records are produced, that cold and warm differ,
  and that FR-026's negative control fails.

### M. The round-trip

- **FR-110**: A test MUST load the exported settings file, parse it, re-run `normalize()` over each
  committed fixture with the parsed options, and assert equality with that fixture's `expected`
  spoken text.
- **FR-111**: The same test MUST also assert the **chunk boundaries** recorded per FR-080.
- **FR-112** *(the negative control, without which FR-110 is a check that both sides read the same
  file)*: The test MUST mutate one field — `path.depthN` — and assert the comparison now **fails**.
  *Verify*: run it; a round-trip test that cannot fail is not a test.
- **FR-113**: The round-trip MUST NOT assert anything about the `synthesize` section across
  platforms: voice and rate are engine-provisional by definition and do not port.

---

## Key Entities

- **Fixture** — a committed markdown file with a declared sentence count; the fixed input to every
  comparison.
- **Control** — an id, a type, a legal value space, a provisional default, a tier, a tag
  (`EI`/`EP`/`PP`), a class (`wired`/`designed`/`lab-only`), and the consumer it feeds.
- **Control set** — a complete assignment of values to all 46 controls. The working set, slot A,
  slot B and each named snapshot are each one of these.
- **Stage record** — per pipeline stage: ordinal, name, output, ran/skipped, governing control ids.
- **Audio chunk** — bytes plus a declared format, sample rate and channel count; cached in the page
  by a key covering everything that can change the bytes.
- **Gate record** — one trial: t₀, t₁, path, fixture, control changed, chunk count, provider,
  platform.
- **Settings file (inbox)** — the envelope of FR-074; simultaneously the lab's export format and the
  plugin's settings format, because there is no host settings form to target.
- **Settled report** — the durable trace of which controls the listener settled, and when.

---

## Success Criteria *(mandatory)*

- **SC-001**: The listener changes a wired control and hears the difference in **≤ 2,000 ms** at p95
  over 20 trials on every committed fixture, without touching ORCA — measured from the recorded gate
  log, with FR-026's negative control demonstrably failing.
- **SC-002**: Replay of unchanged audio issues **zero** synthesis requests, and the recorded warm
  reading is strictly below the cold reading for the same text.
- **SC-003**: All 46 controls render, and the number that are not yet wired is displayed and equals
  the number the reachability test derives from source.
- **SC-004**: Every acceptance scenario of User Stories 1 and 3 completes using the keyboard only,
  with the display covered.
- **SC-005**: Every failure mode in "Edge Cases" produces **spoken** output, asserted on the text
  handed to the provider with the logging and notification channels removed.
- **SC-006**: A settings file written by the lab reproduces, through `normalize()`, the exact spoken
  text and chunk boundaries the lab produced — and the mutated-field control case fails.
- **SC-007**: CI is green on macOS, Linux and Windows with **zero** audio-device opens, and reports
  every not-run probe with its reason.
- **SC-008**: At the end of one sitting, the author has settled at least the three open decisions
  named in `HANDOFF.md` — identifier speech, path depth, and how a path is announced — and each
  settled value is a data edit in the schema plus an entry in the settled report.

---

## Assumptions

- The listener runs the lab on macOS with the OS synthesizer. Linux and Windows must work; the gate
  is asserted on the author's machine because that is where taste is settled.
- The 46-control inventory is taken from 004 section 6 as amended. **The brief for this spec said
  43; the document says 46** — verified by counting the rows: 7 + 7 + 9 + 4 + 9 + 10.
- The pipeline has **16** stages, read from the call list in `normalize()`
  (`packages/core/src/normalizer/index.ts`) — never a line range. Two are conditional, so a run
  exercises 13 to 16 of them. It was 15 when this spec was written; J21 added `stripHtmlComments`
  at stage 2, so every stage number in the tables below is one higher than the version of this
  document that shipped with M11. The in-source banner comments, which this spec recorded as
  misnumbered, were corrected in the same change.
- `NormalizeOptions` has **five** fields — `codeBlocks`, `pathStyle`, `extensionStyle`,
  `expandNumbers`, `orderedLists` (`packages/core/src/normalizer/index.ts:22-52`) — verified in
  source, not inherited.
- The settings module (`packages/core/src/settings/`) is M12's deliverable but M11 depends on its
  shape. M11 may land the schema module first; it must not fork a second copy.
- Nothing in M11 depends on an upstream ORCA change. Every open upstream issue is treated as a bonus
  if it merges.

---

## Findings — where 004 was too vague to specify

These matter more than a tidy requirement list. Each is a place where the design does not determine
the behaviour, and where this specification had to choose or had to escalate.

**Finding 1 — the gate applies to a minority of the surface, and 004 never says so.**
004 specifies 46 controls and a gate of the form *change a control, hear the difference*. But only
**10 of those 46 rows** reach a typed options object that a consumer reads today (5 normalizer
fields over 6 rows, 2 chunker, 2 synthesize). `011` section 3.2 counts the same gap from the other
end and calls the rest `wire: null`. 004 writes every row's "Feeds" column as though the consumer
existed — *"stage 5 `stripUrls`"* for a four-valued `omit.urls` control that `stripUrls` does not
take — so a reader plans a lab in which all 46 controls are audible. They are not. Turning 36 of
them would change nothing the listener can hear, which is precisely PITFALLS **P26**'s shape (*"a
field that cannot be walked is not a setting, it is a comment"*) and **P18**'s (*a wrong name
degrading silently to success*), arriving inside the instrument built to prevent exactly that class
of error. **What this spec did**: FR-011 to FR-016 introduce the control **class**, require a
`designed` control to say aloud that nothing consumes it, require the unwired count in the status
bar, and scope the gate to `wired` controls. **What is escalated**: whether M11 also lands the
~17 new normalizer options that would make Panels A–D audible is a scope decision nobody has made.
Doing it turns M11 into a normalizer rewrite — the exact cost 004 refuses to pay for SSML. Not doing
it means the first session settles path depth and identifier speech (both wired-adjacent) and cannot
settle emoji, URLs, headings, tables or list markers by ear at all.

**Finding 2 — the stage ladder has three states, and 004 specifies two.**
004 section 4: *"a stage that changed nothing renders as one dim line, 'no change'"*. Two stages are
conditional in source — `speakFilePaths` is skipped entirely when `path.style` is `verbatim`
(`packages/core/src/normalizer/index.ts:103`) and `expandUnits`/`expandNumbers` are skipped when
number expansion is off (`:107`). A ladder with only *changed* and *no change* would report *no
change* for a stage that never ran, which is a falsehood displayed by the instrument whose purpose
is explaining what happened. FR-042 adds *not run*, naming the control that disabled it.

**Finding 3 — Compare's reveal is specified only for the one-difference case.**
004 section 3 step 3 says the reveal names *"the single differing control"*. But A and B hold two
full control sets and there is no mechanism preventing them from differing in eight controls; a
listener who tunes A for ten minutes and then compares against an older B is the normal case, not
the edge case. 004 does not say what is announced then. FR-051 generalises: name at most three, then
a count.

**Finding 4 — the cache key is under-specified in a way that would be read as a taste result.**
004 section 2 keys the decoded-buffer cache on `hash(chunkText + voice + rate)`. That omits the
provider id and rows 30 and 31 (`voice.pitch`, `voice.volume`), which 004 itself specifies as
controls. A listener who changes pitch, presses Space and gets a cache hit hears the *old* audio and
concludes *pitch does nothing* — a wrong conclusion, produced silently, about a taste question, by
the instrument built to answer taste questions. FR-023 requires the key to cover every input that
can change the bytes and requires the probe to compare decoded buffers rather than request counts.

**Finding 5 — the export schema cannot express what the round-trip test is required to assert.**
004 section 7 step 5 requires the round-trip to assert chunk boundaries — *"a settings file that
reproduces the words but not the pauses has not reproduced the experience"* — but the `expected[]`
entry in the same section carries only `{fixture, spoken}`. There is no field for boundaries.
FR-080 adds one. This is worth naming because 004 calls that schema *"a contract"* and it froze a
version number over it.

**Finding 6 — the spoken-overhead budget is named as the listener's, and has no control.**
`HANDOFF.md` lists *"who arbitrates the audio stream"* as an open decision: three designs write into
the stream — skip announcements, tunable wording, and a spoken call-sign — and none summed the
total. `009` opened it as Q61 and explicitly says the percentage is the listener's. **004 has no
control for it.** So the one instrument built for settling taste cannot settle this taste question,
and the brief for this spec asks the spec to name the spoken-overhead budget as a listener default —
which it cannot do against a control that does not exist. FR-092 names it as the listener's and
records that no control exists; specifying one is a design change to 004, not a spec decision.

**Finding 7 — the same class of gap exists for the skip vocabulary.**
004 section 10 records it: the named vocabulary of the spoken channel's skip announcements —
*"a diagram"*, *"a table of N rows"*, *"a stack trace"* — is assigned to the lab by the spoken-channel
design, and **004 has no controls for it**. Panel A covers code blocks, inline code, URLs and emoji
and none of the classifier's classes. Left unresolved deliberately by `009` section 3 (X-08). The
consequence is concrete: if M12 freezes a schema without reserving those ids, M14's wording cannot be
settled by ear without a version bump. `011` section 4.2 argues the bump is a non-event; that
argument should be checked before M12 freezes, not after.

**Finding 8 — `docs/design/007-user-stories.md` US-15 carries three values 004 has since amended.**
US-15 step 8 says a *300 ms earcon* and step 11 says **`S`** snapshots; the amended 004 takes every
earcon from the reserved control band rather than minting durations, and the shared key map moved
snapshot to **`K`** because `s` became Stop across both surfaces. US-15's "when it goes wrong" also
still quotes the `970` gap preset, which the measurement pass replaced with **950** `[measured-here]`.
007 is the record and was deliberately not edited; a reader who implements from US-15 alone will
build the superseded bindings. This spec follows 004 as amended.

**Finding 9 — `pnpm check:citations` does not read `specs/`.**
The checker walks `docs/` plus five named root files (`scripts/check-citations.mjs:97-115`).
Nothing under `specs/` is scanned, so every `path:line` in this document and in the plan and tasks
beside it is **ungated**. The citations here were verified by hand against `HEAD`. Adding `specs/`
to the checker's document list is a two-line change and would extend a real gate to the artifacts
the implementation is built from; it is not made here because the checker currently carries 38
known-stale citations under a ratchet another agent may own, and widening its input in the same
commit as a spec would confuse the two.

---

## Appendix A — the control inventory (normative)

**46 controls, six panels.** Source: `docs/design/004-voice-lab.md` section 6 as amended
2026-08-21. Row numbers are 004's and are stable; rows 44, 45 and 46 were added by amendment and
sit in the panel they belong to rather than at the numeric end.

**Columns.** *Class* is FR-011's: `W` wired · `D` designed, no consumer reads it yet · `L` lab-only.
*Tag* is 004's: `EI` engine-independent · `EP` engine-provisional · `PP` pacing-provisional.
*Tier* is `C` Common or `M` More. **Every default in this table is provisional** unless the
"Default" cell says otherwise; FR-090 requires the mark and FR-092 forbids this document from
settling any of them.

### Panel A — What gets left out, and how you are told (7)

| # | Control | Type | Legal values | Default (provisional) | Tier | Feeds | Class | Tag |
|---|---|---|---|---|---|---|---|---|
| 1 | `omit.codeBlocks` | select | `announce` · `drop` | `announce` | C | `NormalizeOptions.codeBlocks` → stage 1 `stripFencedCode` | **W** | EI |
| 2 | `omit.codeBlockPhrase` | template (`{lang}`, `{lines}`) | string ≤ 120 chars | `" . Here, a code block is omitted. "` | C | stage 1 | D | EI |
| 3 | `omit.codeBlockDetail` | multi-toggle | `language` · `lineCount` | neither | M | stage 1 (fills the template) | D | EI |
| 4 | `omit.inlineCode` | select | `strip` · `verbatim` · `announce` | `strip` | M | stage 3 `stripInlineCode` | D | EI |
| 5 | `omit.urls` | select | `host-phrase` · `host-and-path` · `label-only` · `drop-silent` | `host-phrase` | C | stage 5 `stripUrls` | D | EI |
| 6 | `omit.urlPhrase` | template (`{host}`, `{path}`) | string ≤ 120 chars | `"a link to {host}"` | M | stage 5 | D | EI |
| 7 | `omit.emoji` | select | `silent` · `announce-count` · `name` | `silent` | C | stage 12 `stripEmoji` | D | EI |

### Panel B — How structure is spoken (7)

| # | Control | Type | Legal values | Default (provisional) | Tier | Feeds | Class | Tag |
|---|---|---|---|---|---|---|---|---|
| 8 | `struct.headingCue` | select | `none` · `level-word` · `prefix-word` · `pause-only` | `none` | C | stage 6 `headingsToPauses` | D | EI |
| 9 | `struct.headingPauseMs` | slider | 0–1500 ms, step 50 — **milliseconds, never "comma vs full stop"** | `0` | M | stage 6 → pause token | D | **EP** |
| 10 | `struct.orderedLists` | select | `numeral` · `word` · `drop` | `numeral` — **shipped, not provisional** | C | `NormalizeOptions.orderedLists` → stage 7 | **W** | EI |
| 11 | `struct.bulletMarker` | select | `drop` · `say-item` | `drop` | M | stage 7 | D | EI |
| 12 | `struct.tableLeadIn` | text | string ≤ 60 chars | `"Table."` | M | stage 8 `tablesToRows` | D | EI |
| 13 | `struct.tableHeaderRepeat` | select | `every-cell` · `row-start` · `first-row-only` · `never` | `every-cell` | C | stage 8 | D | EI |
| 14 | `struct.tableFirstCellHeader` | toggle | on · off | off | M | stage 8 | D | EI |

### Panel C — How names, paths and identifiers are spoken (9)

**Q40 and Q42 live here and are deliberately unset (FR-092).**

| # | Control | Type | Legal values | Default (provisional) | Tier | Feeds | Class | Tag |
|---|---|---|---|---|---|---|---|---|
| 15 | `path.style` | select | `spoken` · `terse` · `verbatim` | `spoken` | C | `NormalizeOptions.pathStyle` → stage 9 `speakFilePaths` | **W** | EI |
| 16 | `path.extensionStyle` | select | `word-last` · `word-first` · `raw-last` · `omit` | `word-last` | C | `NormalizeOptions.extensionStyle` → stage 9 | **W** | EI |
| 17 | `path.namePhrase` | template (`{name}`) | ≤ 60 chars | `"file named {name}"` | M | stage 9 | D | EI |
| 18 | `path.folderPhrase` | template (`{folders}`) | ≤ 60 chars | `"in folder {folders}"` | M | stage 9 | D | EI |
| **19** | **`path.depthPolicy`** — Q42's option space | select | `full` · `last-n` · `first-n` · `filename-only` · `filename-then-location` · `elide-middle` | **unset — the listener's** | C | stage 9 | D | EI |
| 20 | `path.depthN` | slider | 1–8 | **unset — the listener's** | C | stage 9 | D | EI |
| 21 | `path.extensionWords` | key/value editor | add · remove · edit; 32 rows today, unknown suffixes fall to "dot x y z" | the shipped table | M | stage 9 | D | EI |
| **22** | **`ident.style`** — Q40's option space | select | `verbatim` · `underscore-pause` · `split-words` · `split-and-announce` · `spell-leading-underscore` | **unset — the listener's**; today's behaviour is `verbatim` | C | stages 4 + 10 | D | EI |
| 23 | `ident.parens` | select | `keep` · `drop` · `say-call` | `keep` | M | stages 4 + 10 | D | EI |

Row 22 must not fight stage 10: `stripMarkdownMarkers` deliberately preserves dunders and leading
underscores so that `ident.style` is the only place deciding what an underscore sounds like.

### Panel D — Numbers and units (4)

| # | Control | Type | Legal values | Default (provisional) | Tier | Feeds | Class | Tag |
|---|---|---|---|---|---|---|---|---|
| 24 | `num.expandIntegers` | toggle | on · off | on | C | `NormalizeOptions.expandNumbers` (shared with 25 today — FR-017) → stage 14 | **W** | EI |
| 25 | `num.expandUnits` | toggle | on · off | on | C | same field as 24 today → stage 13 | **W** | EI |
| 26 | `num.unitWords` | key/value editor | 11 rows today | the shipped table | M | stage 13 | D | EI |
| 27 | `num.decimals` | select | `engine` · `words` | `engine` | M | stage 14 | D | **EP** |

Rows 24 and 25 are the fix for one flag gating two behaviours: a listener who wants
"fifty two milliseconds" but numeral-shaped counts cannot have it today. **The split must land in
the schema before M12 freezes it.**

### Panel E — Voice and pacing (9)

| # | Control | Type | Legal values | Default (provisional) | Tier | Feeds | Class | Tag |
|---|---|---|---|---|---|---|---|---|
| 28 | `voice.id` | select | populated at runtime from the provider's voice list — **never free text, never a hard-coded name** | platform default | C | `SynthesizeOptions.voice` | **W** | **EP** |
| 29 | `voice.rate` | slider | 0.5–2.0, step 0.05 | `1.0` | C | `SynthesizeOptions.rate` | **W** | **EP** |
| 30 | `voice.pitch` | slider | −50…+50, or `engine` | `engine` | M | no field exists | D | **EP** |
| 31 | `voice.volume` | slider | 0–100 | engine default | M | no field exists | D | **EP** |
| 32 | `pace.chunkMaxUnits` | slider | 40–600, step 20 | `200` | C | `ChunkerOptions.maxUnits` | **W** | **PP** |
| 33 | `pace.isolateFirstSentence` | toggle | on · off | on | M | `ChunkerOptions.isolateFirstSentence` | **W** | **PP** |
| 34 | `pace.simulateChunkGapMs` | slider | 0–1500; presets `0` (M9 target) and `950` (v1 macOS, `[measured-here]` p50 950/937/897 ms, n=18 ×3, `docs/.research/latency-measurements.md` 1.1) | `0` | C | the lab's playback scheduler only | **L** | **PP** |
| 35 | `pace.sentencePauseMs` | slider | 0–800 ms, step 25 | `0` | M | pause token → rendering stage | D | **EP** |
| 44 | `pace.pauseBackend` | select | `punctuation` (the only one implemented) · `ssml` · `in-band` | `punctuation` | C | how rows 9 and 35 are encoded | D | **EP** |

`voice.id` carries a specific trap: the macOS synthesizer accepts an unknown voice name, exits 0 and
writes a full-length WAV of the **default** voice. FR-032's byte-comparison probe is the only thing
that catches it. Voice enumeration costs p50 487/472 ms `[measured-here]` (n=6 ×2,
`latency-measurements.md` 1.6) and must be cached (FR-033).

### Panel F — What interrupts what, and what gets announced (10)

| # | Control | Type | Legal values | Default (provisional) | Tier | Feeds | Class | Tag |
|---|---|---|---|---|---|---|---|---|
| 36 | `queue.maxQueued` | slider | 1–20 | **8 — settled, not provisional** (the one value; the second constant must be removed) | C | the speech queue | D | EI |
| 37 | `queue.overflowPolicy` | select | `drop-oldest` · `drop-newest` | `drop-oldest` | M | the speech queue | D | EI |
| 38 | `announce.mode` | select | `replace` · `queue` | `replace` | C | `speak(text, mode)` | D | EI |
| 39 | `announce.sessionLabel` | select | `call-sign` · `call-sign-plus-name` · `registry-name` · `branch` · `displayName` — **no hex value exists** | **unset — the listener's**, among these five only | C | the huddle session label | D | EI |
| 40 | `announce.sessionLabelHashChars` | slider | 0–8 | **`0` — correctness, not taste** (FR-093); warned aloud once if raised | M | the same | D | EI |
| 41 | `announce.switchPhrase` | template (`{label}`) | ≤ 80 chars | `"Now reading from {label}."` | M | the huddle switch announcement | D | EI |
| 42 | `announce.statusTemplate` | text | ≤ 160 chars | the shipped order and phrasing | M | the status command | D | EI |
| 43 | `input.clipboardCap` | slider | 2,000–50,000 chars | `20,000` | M | the clipboard read path | D | EI |
| 45 | `interrupt.granularity` | select | `immediate` · `at-word` · `pause-keeps-position` | `immediate` | C | barge-in / skip / stop | D | **EP** |
| **46** | **`input.huddleReplyCap`** | slider | 2,000–50,000 chars | **existence settled; the number is unset — the listener's** | C | the huddle speak path | D | EI |

Row 46 exists because the queue cap cannot help: `queue.maxQueued` counts **replies**, so a single
reply is never dropped by overflow however long it is. Its **existence** is correctness, settled
elsewhere; only its number is taste and lives here, beside `input.clipboardCap`, which is the
identical control for the other input.

### Counts, reconciled

| | |
|---|---|
| Controls | **46** — 7 + 7 + 9 + 4 + 9 + 10 |
| `wired` | **10 rows**, 9 distinct fields (rows 24 and 25 share one) |
| `designed` | **35 rows** |
| `lab-only` | **1 row** (34) |
| Engine-provisional (`EP`) | **9 rows** — 9, 27, 28, 29, 30, 31, 35, 44, 45 |
| Pacing-provisional (`PP`) | **3 rows** — 32, 33, 34 |
| Defaults this spec leaves unset | **6** — 19, 20, 22, 39, 46, and every phrase template |

004's wireframe status bar reads `46 controls · 8 EP`. Counting the `EP` tags in the amended tables
gives **9** (row 44 was added by the same amendment that wrote the wireframe). FR-015 requires the
count to be derived and displayed, not written into the markup, which is what makes this kind of
drift impossible rather than merely corrected.

---

## Appendix B — Corrections to `docs/TASKS.md` Phase M11

Where T110–T114 as written disagree with 004 as amended, the amended design wins. Each row is a
correction the implementation must apply; none of them is a scope increase invented here.

| Task, as written | Correction, and why |
|---|---|
| **T111c** — *"`POST /speak` synthesizes **and plays on this machine**"* | **The server never plays.** 004 section 2's verdict is that the browser plays and the server returns bytes; the server spawning a player would build a second playback path the plugin does not use, re-pay a CoreAudio device open per chunk (~893 ms `[derived]` of a p50 897–950 ms gap `[measured-here]`), and make replay impossible because there is nothing to replay from. Read T111c as: **`POST /speak` synthesizes and returns audio bytes.** FR-006, FR-031. |
| **T111b** — *"`POST /normalize` returns spoken text"* | Spoken text alone cannot render the stage ladder or attribute a diff span to a control. `POST /normalize` returns **spoken text plus the per-stage record**, including whether each stage ran. FR-030, FR-042. |
| **T111d** — *"`POST /stop`"* | With browser playback, stopping the sound is a client-side operation. The endpoint's remaining job is the **other half** of the two-sided cancel: abort in-flight synthesis. Stated so it is not implemented as a no-op. FR-037. |
| **T112b** — *"every `NormalizeOptions` field as a control"* | `NormalizeOptions` has five fields. 004 specifies **46 controls**. Read T112b as: **render the 46-control inventory** (Appendix A), with each control's class visible. FR-010 to FR-016. |
| **T112** — no stage ladder, no speak-on-change, no snapshots, no Save | 004 sections 4, 8 and 7 require all four. They are not optional polish: the ladder is how a control is found, speak-on-change is how the lab is operable without reading, and Save is what makes a settled value reach the plugin. FR-040 to FR-046, FR-060 to FR-063, FR-070 to FR-078. |
| **T112e** — *"A/B, same fixture under two option sets"* | Add the blind-until-stop rule, the reveal, the one-key keep, and the reserved `control.compare` separator. A labelled A/B reproduces the expectation effect that made the chat loop fail. FR-050 to FR-054. |
| **T110** — fixture list | Each fixture must **declare its sentence count**, and the corpus must contain at least one fixture of three or more sentences. The gate is only meaningful measured on a fixture the listener actually uses; a one-liner passes trivially and a three-sentence fixture is where the cold path fails. FR-087. |
| **T113** — round-trip | Add (a) the **negative control** — mutate `path.depthN` and assert the comparison now fails; (b) the **chunk-boundary** assertion, which the current `expected[]` schema cannot express (Finding 5). FR-110 to FR-113. |
| **T114** — *"runs on all three OSes in CI (headless: normalize only, no audio)"* | Correct and kept. Made explicit: **silence is a requirement, not a preference** — an audible probe interrupts the person the product is for (PITFALLS **P31**) — and every capability CI cannot exercise is reported **not-run with its reason** rather than omitted. FR-106, FR-107. |
| **Gate M11** — *"change a control, hear the difference in under two seconds, without touching ORCA"* | Kept as the intent; restated measurably as FR-020 (t₀ and t₁ defined, p95 over 20 trials, first audio not complete audio), with FR-024's streaming mechanism, FR-025's recorded log, FR-026's negative control, and FR-028's declared non-applicability on the `spoke-elsewhere` rung. |
| **Settings location** — 004 section 7's `~/.orca/read-aloud/settings.json` | **Superseded** by `docs/design/011-settings.md` section 1: an inbox in the project's own namespace under the OS config directory, `settings.jsonc`, `schemaVersion` **2**, with a monotonic `revision`. Writing into ORCA's own config namespace is refused. FR-073, FR-074. |
| **New, not in T110–T114** | A **fixture-corpus sentence-count assertion** (FR-087), a **gate-measurement harness** (FR-025/FR-026), a **control-class reachability test** (FR-011/FR-012), and a **settled report** (FR-081). Each is required by 004 or `011` as amended and has no task line today. |
