---
description: "Executable task breakdown for M11 — Voice Lab"
---

# Tasks: Voice Lab

**Input**: `specs/002-voice-lab/spec.md`, `specs/002-voice-lab/plan.md`

**Prerequisites**: `docs/design/004-voice-lab.md` (as amended), `docs/design/011-settings.md`,
`.specify/memory/constitution.md`, `PITFALLS.md`.

**Tests**: required. Constitution principle V is NON-NEGOTIABLE — tests are written before
implementation and must fail first.

**Task ids**: this file uses `VL-nnn` so it never collides with `docs/TASKS.md`'s `T1nn` numbering.
The mapping to `docs/TASKS.md` Phase M11 is in the table at the end; the corrections that mapping
applies are Appendix B of the spec.

## Format: `[ID] [P?] [Story] Description`

- **[P]** — may run in parallel (different files, no dependency)
- **[Story]** — US1 · US2 · US3 · US4, or `FOUND` for foundations
- Every task carries a **Verify** line. A task whose verify line could not fail is not done
  (R003, PITFALLS **P33**).

---

## Phase 0: Correct the ground (Blocking)

**Purpose**: the lab renders the pipeline. The pipeline must describe itself correctly first.

- [ ] **VL-001** Export the pipeline stage list from `packages/core/src/normalizer/`, derived from
      the calls in `normalize()` (`packages/core/src/normalizer/index.ts:96-109`), each entry
      carrying its ordinal, its function name, and whether it is conditional.
      **Verify**: a test asserts the exported list equals the pipeline. Add a sixteenth stage on a
      scratch branch and confirm the test goes red before removing it.
- [ ] **VL-002** [P] Correct the misnumbered stage banner comments in the same file so no comment
      contradicts the exported list.
      **Verify**: a test asserts every `stage N` comment's N matches that function's position in the
      exported list. Renumber one comment wrongly and confirm red.
- [ ] **VL-003** [P] Reconcile the queue-cap constant to the single settled value of **8**, removing
      the second, differing default so one constant exists.
      **Verify**: grep asserts exactly one queue-cap default literal exists in source, and a test
      asserts the shipped value is 8. Re-introduce the second literal and confirm red.
- [ ] **VL-004** [P] Re-derive the `NormalizeOptions` field list against `HEAD` and pin it as a
      compile-time exhaustive key constant; do the same for the chunker and synthesize options, with
      every deliberate exclusion named rather than silently omitted.
      **Verify**: add a sixth field to `NormalizeOptions` on a scratch branch and confirm it fails
      to **compile**, not merely fails a test.

**Checkpoint 0**: the source describes itself. Nothing user-visible changed. `pnpm test` green.

---

## Phase 1: Foundations (Blocking — no user story can start without these)

- [ ] **VL-010** [FOUND] Settings schema module in `packages/core/src/settings/`: `SCHEMA_VERSION`
      (**2**), the field-descriptor type, and the descriptor for all **46** controls of spec
      Appendix A — each with id, owner, kind, legal values, provisional default, tier, tag, effect
      class, engine-provisional flag, and `wire` (the exact consumer property, or `null` where none
      exists today).
      **Verify**: a test asserts the descriptor count is 46 and that the per-panel counts are
      7·7·9·4·9·10. Delete one descriptor and confirm red. (FR-010)
- [ ] **VL-011** [FOUND] Mark every default `provisional` unless it carries a written rationale, and
      pin the rule.
      **Verify**: a test fails on any descriptor that is neither provisional nor rationalised. Strip
      a rationale and confirm red. (FR-090)
- [ ] **VL-012** [FOUND] Derive the `wired` set from the exhaustive key constants of VL-004 and
      assert it equals the schema's non-`null` `wire` set, in both directions.
      **Verify**: add a normalizer option without a control and confirm the test goes red. This is
      the check that keeps Finding 1's gap countable rather than forgotten. (FR-011, FR-012)
- [ ] **VL-013** [P] [FOUND] Reserved control-earcon band in `packages/core/src/earcons/`, consumed
      by the lab, with `control.play`, `control.stop`, `control.skip`, `control.error` and
      `control.compare` named and their durations owned there.
      **Verify**: a test asserts every earcon the lab can emit is in the control band and **not** in
      the identity space. Move one motif into the identity space and confirm red. (FR-054, FR-065)
- [ ] **VL-014** [P] [FOUND] Shared key map in `packages/core/src/`, consumed by both the lab and
      the terminal control surface.
      **Verify**: a test asserts no key in the map carries two meanings across the two surfaces.
      Give one key a second meaning and confirm red. (FR-058)
- [ ] **VL-015** [P] [FOUND] Fixture corpus in `fixtures/` — code-heavy, table-heavy (2-col, 4-col,
      ragged, headerless), path-heavy (shallow, deep, unknown extensions, trailing punctuation),
      long architecture explanation, short answer, hostile (emoji, box-drawing, URLs, keyboard
      glyphs, mixed right-to-left) — with a manifest declaring each fixture's sentence count.
      **Verify**: a test asserts each declared sentence count equals the chunker's actual count, and
      asserts at least one fixture has ≥ 3 sentences. Mis-declare one count and confirm red.
      (FR-085, FR-086, FR-087)
- [ ] **VL-016** [FOUND] Lab server skeleton `scripts/voice-lab.mjs` bound to `127.0.0.1`, importing
      `@orca-tts/core` and `@orca-tts/providers` from **TypeScript source**, plus `pnpm voice-lab`.
      **Verify**: assert the resolved module path for `normalize` contains `/src/`; assert a
      non-loopback connection is refused and a loopback one returns 200. Point the import at a build
      output and confirm red. (FR-001, FR-002)

**Checkpoint 1**: 46 controls exist as data; the server starts; nothing plays.

---

## Phase 2: User Story 1 — play, change, hear (Priority: P1) 🎯 MVP

**Goal**: Gate M11. Change a wired control, hear the difference in under two seconds, without ORCA.

**Independent Test**: `pnpm voice-lab`, `Space`, `↓`, `→`, `Space` — two audibly different
playbacks, the second within the gate, evidenced by the recorded log.

### Tests first

- [ ] **VL-020** [P] [US1] Contract test for `POST /normalize`: spoken text plus the per-stage
      record, with ran/skipped per stage and the governing control ids.
      **Verify**: written before the endpoint; must fail with no endpoint present. (FR-030)
- [ ] **VL-021** [P] [US1] Contract test for `POST /speak` covering all **three** provider outcomes
      — bytes, throw → `503` with the provider's error text, and `spoke-elsewhere` read from the
      provider's own backend capability.
      **Verify**: force each of the three; for `spoke-elsewhere` assert the announcement was
      **spoken** (asserted on the daemon call), and run the byte-yielding case asserting the four
      affordances are **enabled** — without that half the test cannot fail for the right reason.
      (FR-034, FR-035)
- [ ] **VL-022** [P] [US1] Test that the server spawns no player and opens no audio device, with the
      synthesizer spawn as the control case that must still appear. (FR-006)

### Implementation

- [ ] **VL-023** [US1] `POST /normalize` — spoken text and the per-stage record, derived from
      VL-001's exported stage list. **Verify**: VL-020 goes green; disable a stage and confirm the
      record reports *not run*, naming the control. (FR-030, FR-042)
- [ ] **VL-024** [US1] `POST /speak` — normalize → chunk → synthesize, returning bytes with the
      provider's declared format. Never plays. **Verify**: VL-021 and VL-022 green; independently
      compute `normalize(fixture, options)` and assert equality with the lab's spoken text.
      (FR-031, FR-008)
- [ ] **VL-025** [US1] `POST /stop` — abort in-flight synthesis (the server half of the two-sided
      cancel). **Verify**: start a long fixture, stop, assert the synthesizer child process exited;
      control case, without Stop it does not. Assert the working set and cache are untouched.
      (FR-037)
- [ ] **VL-026** [US1] Page: one `AudioContext` for the session; decode each chunk once; schedule
      chunks back to back. **Verify**: assert one context instance across a ≥4-chunk session, and
      assert the lab's inter-chunk gap is under the 50 ms budget against the shipped sink's p50
      897–950 ms `[measured-here]` as the contrast. (FR-007)
- [ ] **VL-027** [US1] Page: the decoded-buffer cache, keyed on **every** input that can change the
      bytes — spoken chunk text, provider id, and every `synthesize.*` value, derived rather than
      hand-listed. **Verify**: replay with nothing changed issues zero `/speak` requests; then for
      each `synthesize.*` control, change it, replay, and assert the **decoded buffers differ** —
      not merely that a request was made. Add a new synthesize field without touching the key and
      confirm the test goes red. (FR-022, FR-023)
- [ ] **VL-028** [US1] Server: stream chunk 1 to the page while synthesizing chunk 2.
      **Verify**: assert the page receives the first chunk before the server has finished the
      second, on a ≥3-sentence fixture. (FR-024)
- [ ] **VL-029** [US1] Page: render the 46 controls from the schema, one column, one control per
      row, full width, Common tier open and More tier collapsed, with class and tag visible.
      **Verify**: assert the rendered id set equals the schema's, both directions; add a throwaway
      descriptor and confirm it renders with no page edit. (FR-010, FR-018, FR-019)
- [ ] **VL-030** [US1] Page: a `designed` control states — aloud and in text — that its value was
      recorded and nothing consumes it yet, naming the milestone.
      **Verify**: turn each `designed` control and assert on the **spoken text handed to the
      provider**, with the log and notification channels removed. Control case: a `wired` control
      produces no such statement. (FR-013, FR-014, FR-066)
- [ ] **VL-031** [US1] Page: speak-on-change — control name, then value, nothing else, in the voice
      and rate under test; debounced 250 ms in replace mode; through the same
      normalize → chunk → synthesize entry point as the fixture; mutable by one key; auto-muted
      while a fixture plays.
      **Verify**: assert the exact spoken text; emit thirty changes in 300 ms and assert at most one
      utterance; assert both paths pass the same instrumented entry point; change a control
      mid-playback and assert nothing was spoken and the fixture was not interrupted.
      (FR-060, FR-061, FR-062, FR-063)
- [ ] **VL-032** [US1] Voice control: populated only from the runtime voice list, cached once per
      session, free text rejected; plus the **byte-comparison probe** — synthesize a short probe
      under the chosen voice and under the platform default and say aloud *that voice did not take*
      when the bytes are identical.
      **Verify**: request a non-existent voice and assert the spoken warning; control case, request a
      real voice and assert **no** warning; assert exactly one enumeration per session.
      (FR-032, FR-033)
- [ ] **VL-033** [US1] Status bar: cold/warm state, elapsed ms for the last play, and the live
      counts — total controls, engine-provisional, and **not yet wired**.
      **Verify**: assert the displayed elapsed equals the logged value; assert the value takes ≥ 2
      distinct values across a session; remove a wire in a scratch build and assert the unwired count
      increments. (FR-015, FR-027)
- [ ] **VL-034** [US1] Escaping contract applied to every free-text template before synthesis, on
      every platform. **Verify**: put an in-band macOS speech command in a template and assert the
      audio is not silenced; put a quote-and-semicolon sequence in one on Windows and assert the
      literal text is spoken. (FR-036)

### The gate

- [ ] **VL-035** [US1] Gate instrumentation: t₀ from the DOM key event's timestamp, t₁ from the
      converted `AudioContext` start of the first buffer for the affected text; one record per trial
      carrying t₀, t₁, path, fixture, control changed, chunk count, provider and platform, appended
      to a machine-readable log.
      **Verify**: run N trials and assert N records. A missing record is a failed run, not a silent
      zero. (FR-025)
- [ ] **VL-036** [US1] Gate harness `voice-lab/gate.mjs`: evaluates the log — p95 ≤ 2,000 ms per
      fixture per path over 20 trials, and warm strictly below cold for the same text.
      **Verify**: feed it a synthetic log breaching the budget and assert it reports failure.
      (FR-020, FR-021)
- [ ] **VL-037** [US1] **The negative control.** Run the same harness with first-chunk streaming
      disabled against the longest multi-sentence fixture and record the result.
      **Verify**: it MUST exceed 2,000 ms. If it passes, the harness is not measuring what FR-020
      claims and the gate is void. This task's output is a recorded number, not a green tick.
      (FR-026)
- [ ] **VL-038** [US1] Re-take the two warm-path `[claimed]` numbers — in-page re-normalize and
      `start()` on a decoded buffer — as `[measured-here]` with run counts, or withdraw the claim and
      declare the gate met on the cold path alone.
      **Verify**: the plan's Constraints table carries measured labels with run counts, or carries
      an explicit withdrawal. An unlabelled number beside labelled ones is the failure mode that
      produced three separate corrections in this repository (R006). (plan, Constraints)
- [ ] **VL-039** [US1] On the `spoke-elsewhere` rung, the gate reports **not-applicable with the
      reason** and never reports a pass.
      **Verify**: force the rung and assert `not-applicable`; assert it does not report a pass.
      (FR-028)

**Checkpoint 2 — GATE M11**: 20 trials per fixture, p95 ≤ 2,000 ms on both paths, warm < cold, and
VL-037's disabled-streaming run **above** the budget. Evidence is the log. The author can begin
tuning the ten wired controls.

---

## Phase 3: User Story 2 — the ladder and the attributed diff (Priority: P2)

**Goal**: "this sounds wrong" resolves to "turn this control".

**Independent Test**: press the explain key on a path fixture; the ladder names the stage and the
control, and each row plays alone.

- [ ] **VL-040** [P] [US2] Test: the ladder's stage names equal VL-001's exported list, and a stage
      disabled by a control renders **not run**, naming the control — never *no change*.
      **Verify**: written first; set the path style to verbatim and assert *not run*; set it back and
      assert *changed*. Both halves. (FR-041, FR-042)
- [ ] **VL-041** [US2] The stage ladder, opened by one key, over the panes not beside them; one row
      per stage; a row shows only what that stage changed. (FR-040, FR-041, FR-042)
- [ ] **VL-042** [US2] Per-stage play, and play-the-stage-before. **Verify**: assert each row plays
      the text that row shows, not the whole document. (FR-043)
- [ ] **VL-043** [US2] Word-level, stage-attributed diff computed in the page, no external library.
      **Verify**: assert a known path rewrite produces one attributed span rather than a run of
      character fragments. (FR-044, FR-047)
- [ ] **VL-044** [US2] Stable character offsets on every span in the spoken pane.
      **Verify**: assert every span's offsets index the exact substring it renders. This is the
      ten-line insurance premium that makes a later word cursor a display change. (FR-045)
- [ ] **VL-045** [US2] A span from an ungoverned stage says *fixed by design*, naming the stage; the
      controls M11 deliberately does not expose appear in the stage view as decisions taken.
      **Verify**: assert each of the fixed-by-design constants is visible in the stage view.
      (FR-046, FR-095)
- [ ] **VL-046** [US2] Colour is never the sole carrier: a changed span is also underlined and
      keyboard-reachable. **Verify**: render in greyscale and assert changed spans remain
      distinguishable and focusable. (FR-047)

**Checkpoint 3**: the 46-control surface is navigable by symptom rather than by memory.

---

## Phase 4: User Story 3 — Compare (Priority: P2)

**Goal**: settle a close call without the expectation effect that broke the chat loop.

**Independent Test**: with A and B differing in one control, Compare shows only first/second and
names the control after.

- [ ] **VL-050** [P] [US3] Test: the reveal names the differing control for sets differing in one,
      three and **eight** controls — at most three named, then a count.
      **Verify**: written first; the one-difference case alone would pass a wrong specification.
      (FR-051)
- [ ] **VL-051** [US3] Compare: play A, the reserved `control.compare` separator, play B; show only
      "first" and "second" throughout. **Verify**: assert no set identity is rendered or spoken
      during playback; assert the separator is the reserved earcon and not a locally minted tone.
      (FR-050, FR-054)
- [ ] **VL-052** [US3] The reveal on stop, spoken and shown. (FR-050, FR-051)
- [ ] **VL-053** [US3] Keep-first / keep-second, one key each, no confirmation step.
      **Verify**: assert one keystroke makes the set current. (FR-052)
- [ ] **VL-054** [US3] Blind × 3: shuffled per trial, three trials, count reported before the
      reveal, opt-in. **Verify**: assert the order varies across trials and that the mode is off by
      default. (FR-053)

**Checkpoint 4**: A/B decisions are recorded rather than remembered.

---

## Phase 5: User Story 4 — persistence, Save, export, round trip (Priority: P3)

**Goal**: a settled taste becomes a shipped setting, as a data edit.

**Independent Test**: change three controls, reload, confirm survival; Save, confirm the inbox file
carries them with a bumped revision.

- [ ] **VL-060** [P] [US4] Test: the round trip — parse the exported file, re-run `normalize()` per
      fixture, assert the spoken text **and** the chunk boundaries; then mutate `path.depthN` and
      assert the comparison **fails**.
      **Verify**: written first; run the mutation and confirm red. A round trip that cannot fail is
      a check that both sides read the same file. (FR-110, FR-111, FR-112)
- [ ] **VL-061** [US4] Autosave the working set, both A/B slots and the named snapshots, debounced
      200 ms; every storage read and write individually guarded.
      **Verify**: change, reload, assert restored; run with storage throwing on every access and
      assert the page is fully operable from schema defaults. (FR-070, FR-071)
- [ ] **VL-062** [US4] `POST /settings` writes the **inbox** in the project's own namespace —
      `${XDG_CONFIG_HOME:-~/.config}/orca-tts/settings.jsonc`,
      `~/Library/Application Support/orca-tts/settings.jsonc`, `%APPDATA%\orca-tts\settings.jsonc`,
      overridden by `$ORCA_TTS_CONFIG_DIR`. Never `~/.orca/`, never ORCA's `userData`.
      **Verify**: Save on each platform and assert the path; audit the file system and assert
      nothing under `~/.orca/` or `<userData>` was opened for writing. (FR-073)
- [ ] **VL-063** [US4] The envelope: `kind`, `schemaVersion` **2**, monotonic `revision`,
      `writtenAt` (humans only, never compared for ordering), `writtenBy`, `provenance`, `settings`,
      `expected`; JSONC with per-field comments generated from the schema.
      **Verify**: assert every field present; assert `revision` strictly increases across two Saves.
      (FR-074, FR-077)
- [ ] **VL-064** [US4] Re-read before every Save; refuse a `revision` the lab did not last see as
      `stale_revision`, spoken once; warn audibly before the first Save over a hand-written file.
      **Verify**: mutate the file externally between read and Save, assert the refusal, assert the
      external edit survives intact. (FR-075, FR-076)
- [ ] **VL-065** [US4] `expected[]` written from the text actually spoken — never re-derived — with
      chunk boundaries recorded per fixture.
      **Verify**: assert the recorded boundaries equal the chunker's output for the same options.
      This field does not exist in 004's schema and is added here (spec Finding 5). (FR-079, FR-080)
- [ ] **VL-066** [P] [US4] Export a copy, as a separate artifact the plugin never reads. (FR-078)
- [ ] **VL-067** [P] [US4] The settled report: each control the listener settled, its value, and
      when it was heard.
      **Verify**: settle a control and assert the entry appears. This is what makes a settled default
      a one-line data edit with a traceable reason rather than a value nobody can source. (FR-081,
      FR-091)
- [ ] **VL-068** [US4] `lab.*` values written under a prefix the plugin never reads.
      **Verify**: a test asserts the plugin's loader ignores every `lab.*` key. Feed it one and
      confirm it is ignored. (FR-082)
- [ ] **VL-069** [US4] Assert the round trip makes no cross-platform claim about the `synthesize`
      section — voice and rate are engine-provisional and do not port. (FR-113)

**Checkpoint 5**: a value settled by ear reaches the plugin, and the file that carries it is one a
human can read and edit.

---

## Phase 6: Accessibility assertions and CI

Accessibility is implemented in phases 2–5 as functional requirements. This phase asserts it against
the finished surface, because focus, hit-target and keyboard-sufficiency claims are only meaningful
there.

- [ ] **VL-070** [P] Drive every acceptance scenario of all four user stories with synthesized key
      events only, no pointer. **Verify**: each completes; introduce a pointer-only affordance and
      confirm red. (FR-057)
- [ ] **VL-071** [P] Measure every control row's rendered box and hit target: ≥ 64 px tall, target
      spanning the full row width. **Verify**: shrink one row and confirm red. (FR-055, FR-056)
- [ ] **VL-072** [P] Assert focus never moves on its own across every control type's change, and
      that changing a value re-orders nothing. **Verify**: re-order on change and confirm red.
      (FR-059)
- [ ] **VL-073** [P] Assert every control's value renders and speaks as words, never a bare numeral,
      for every legal value. **Verify**: make one speak "2" and confirm red. (FR-064)
- [ ] **VL-074** [P] Assert the description key speaks the focused control's one-line description,
      and that the panes use the specified large serif treatment. (FR-068, FR-069)
- [ ] **VL-075** Run the whole failure suite — `503`, `spoke-elsewhere`, stale revision, storage
      failure, voice substitution, unwired control — with logging and notification **removed**, and
      assert on the text handed to the provider.
      **Verify**: each produces spoken text; a control case with no failure produces none. Asserting
      that a callback fired does not satisfy this (PITFALLS **P30**). (FR-066, SC-005)
- [ ] **VL-076** Run the normalize-side suite headless on macOS, Linux and Windows in CI: fixtures
      in, normalized text out, settings round-tripped, stage records asserted. (FR-105)
- [ ] **VL-077** **Silence gate.** Instrument the audio device and assert the CI job opens it
      **zero** times; assert the opt-in audible form opens it and prints its warning first.
      **Verify**: both halves. A silent-by-default rule nobody verified is how an audible benchmark
      ends up interrupting the author mid-sentence (PITFALLS **P31**). (FR-106)
- [ ] **VL-078** Not-run accounting: every capability CI cannot exercise is reported with its
      reason; the expected/reported/ran/not-run counts reconcile; the job exits non-zero when a probe
      neither ran nor declared a reason. **Verify**: suppress one probe's reason and confirm the job
      fails. (FR-107)
- [ ] **VL-079** Assert the gate is **not** a CI threshold, and that the CI job instead asserts the
      harness — records produced, cold and warm distinguishable, and VL-037's negative control
      failing. **Verify**: the CI job has no absolute-latency assertion; a permanently-green
      threshold on a machine with no audio device would be a broken indicator. (FR-108)

**Checkpoint 6**: M11 is done and doneness is observable by running the checks, not by reading ticks.

---

## Dependencies

```
Phase 0 ──▶ Phase 1 ──▶ Phase 2 (MVP, GATE M11)
                          ├──▶ Phase 3   (needs VL-023's stage record, VL-026's audio graph)
                          ├──▶ Phase 4   (needs VL-026, VL-027 and VL-013's separator)
                          └──▶ Phase 5   (needs VL-010's schema and VL-024's spoken text)
                                            └──▶ Phase 6 (asserts against the finished surface)
```

Phases 3, 4 and 5 are independent of one another and may run in parallel once Checkpoint 2 holds.
Within Phase 1, VL-013, VL-014 and VL-015 are independent of VL-010.

---

## Mapping to `docs/TASKS.md` Phase M11

Corrections are Appendix B of the spec; this table only records where each existing task lands.

| `docs/TASKS.md` | Here | Note |
|---|---|---|
| T110 (a–f) | VL-015 | plus declared sentence counts and a ≥3-sentence fixture |
| T111a | VL-016 | |
| T111b | VL-023 | now returns the per-stage record as well as spoken text |
| T111c | VL-024 | **corrected**: returns bytes; the server never plays |
| T111d | VL-025 | scoped to aborting synthesis; stopping sound is client-side |
| T112a | VL-015, VL-029 | fixture picker plus free-text input (FR-088) |
| T112b | VL-029, VL-030 | **corrected**: 46 controls, not five normalizer fields |
| T112c | VL-043, VL-044, VL-046 | |
| T112d | VL-026, VL-025 | |
| T112e | VL-051 – VL-054 | plus blind-until-stop, the reveal, one-key keep |
| T112f | VL-062 – VL-066 | plus the inbox location, envelope and stale-revision refusal |
| T113 | VL-060, VL-065 | plus the negative control and chunk boundaries |
| T114 | VL-076 – VL-079 | plus the silence gate and not-run accounting |
| — | VL-001 – VL-004 | new: correct the pipeline's self-description first |
| — | VL-010 – VL-014 | new: the shared schema, earcon band and key map |
| — | VL-035 – VL-039 | new: the gate made measurable, with its negative control |
| — | VL-067 | new: the settled report |
| — | VL-070 – VL-075 | new: accessibility asserted rather than assumed |

**Gate M11, restated measurably**: change a wired control and hear the difference within 2,000 ms at
p95 over 20 trials per committed fixture, on both the cold and the warm path, with warm strictly
faster than cold, **and** with the disabled-streaming negative control recorded above the budget —
without touching ORCA. Not satisfiable on the `spoke-elsewhere` rung, which the lab says out loud.
