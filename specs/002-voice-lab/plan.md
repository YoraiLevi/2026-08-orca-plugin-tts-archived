# Implementation Plan: Voice Lab

**Branch**: `002-voice-lab` | **Date**: 2026-08-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-voice-lab/spec.md`

---

## Summary

Build a local, ORCA-free instrument that lets the listener change a speech-normalization control and
hear the difference in under two seconds, repeatedly, until taste settles — and that writes what he
settled into the file the plugin reads.

**Primary requirement**: FR-020's gate, met by two mechanisms working together — the browser owns a
single long-lived audio context so replay is a cache hit rather than a re-synthesis, and the server
streams the first chunk while it synthesizes the second so the cold path fits inside two seconds
against a p50 1,054–1,163 ms `[measured-here]` per-sentence synthesizer.

**Approach**: one local HTTP server importing the shipping TypeScript source of the normalizer,
chunker and provider; one self-contained page holding the 46-control surface, the diff, the stage
ladder and the audio graph; one shared settings schema module that both the lab and the plugin
import, so the export format and the settings format cannot drift apart.

**What this milestone deliberately is not**: a normalizer rewrite, an SSML implementation, a
playback fix for the shipped plugin, a word cursor, or a place where anybody but the listener
decides how a path should sound.

---

## Technical Context

**Language/Version**: TypeScript, compiled and consumed as source by the lab server; the page is
plain ES modules with no build step.

**Primary Dependencies**: none new. The lab imports `@orca-tts/core` (normalizer, chunker, settings
schema, earcon table, key map) and `@orca-tts/providers` (`OsSynthProvider`) from source. No CDN, no
bundler for the page, no audio npm package. Web Audio is the playback layer.

**Storage**: browser local storage for the working set, the A/B slots and the named snapshots; a
JSONC settings inbox on disk for anything that must reach the plugin; a JSON-lines gate log for the
recorded measurements.

**Testing**: the repository's existing runner. Three tiers — pure unit tests over the normalizer and
the diff; server contract tests over the three endpoints and the three provider outcomes; and a
headless page-driving tier for the keyboard, focus and gate-harness requirements.

**Target Platform**: macOS, Linux and Windows. The listener's machine is macOS with the OS
synthesizer; parity is a constitutional requirement, and the one place it does not hold is declared
rather than hidden (FR-028).

**Project Type**: local developer tool plus a shared library module. Not a plugin surface; the lab
never runs inside ORCA.

**Performance Goals**: FR-020 — ≤ 2,000 ms from keypress to first audible sample, p95 over 20
trials, on both the cold and the warm path, with warm strictly faster than cold.

**Constraints**:

| Constraint | Number | Label | Source |
|---|---|---|---|
| One real sentence through the OS synthesizer | p50 1,054–1,163 ms | `[measured-here]` (n=9 ×2) | `docs/.research/latency-measurements.md` 1.3 |
| Shipped sink's inter-chunk gap — the thing the browser path removes | p50 950 / 937 / 897 ms | `[measured-here]` (n=18 ×3) | `latency-measurements.md` 1.1 |
| …of which the player **process spawn** is | 2.3 / 2.9 ms — 0.25 % | `[measured-here]` | PITFALLS **P32** |
| …of which the audio **device** open/teardown is | ~893 ms — 99.7 % | `[derived]` | PITFALLS **P32** |
| Voice enumeration, uncached | p50 487 / 472 ms | `[measured-here]` (n=6 ×2) | `latency-measurements.md` 1.6 |
| In-page re-normalize | ~1 ms | `[claimed]` — no probe | 004 section 9 |
| Replay from a decoded buffer | ~0 ms | `[claimed]` — no probe | 004 section 2 |
| Loopback round trip | < 5 ms | `[claimed]` | 004 section 9 |

The two `[claimed]` figures on the warm path are the ones the whole cache design rests on and **no
probe has run**. Phase 2's exit criterion turns both into `[measured-here]` before the gate is
declared met; if the warm path is not what the reasoning says it is, the gate is met on the cold
path alone or not at all.

**Scale/Scope**: 46 controls, 6 panels, 16 pipeline stages, 6 fixture families, 3 endpoints, 3
provider outcomes, 98 functional requirements.

---

## Constitution Check

*GATE: must pass before implementation begins, and re-checked at every phase checkpoint.*

| Principle / rule | How this feature satisfies it | Where |
|---|---|---|
| **I. Accessibility is the requirement** (NON-NEGOTIABLE) | Accessibility is specified as functional requirements FR-055 to FR-069, not as a closing section. Every failure terminates in **spoken** audio, asserted with the log and notification channels removed. | FR-066, SC-005 |
| **II. Zero-setup default** (NON-NEGOTIABLE) | No account, no key, no network, no model download. The lab runs against the OS synthesizer as shipped. | FR-003, FR-005 |
| **III. Cross-platform parity** (NON-NEGOTIABLE) | Normalize-side behaviour runs headless on all three OSes in CI. The one rung where the audio half cannot hold — a Linux desktop whose speech daemon speaks and yields no bytes — is **declared in the body**, with the remedy, not implied away. | FR-034, FR-035, FR-105, R016 |
| **IV. Provider seam before the engine** | The lab consumes the existing seam and adds nothing to it. It branches on the declared chunk format rather than assuming WAV. Providers still never play. | FR-006, FR-008 |
| **V. Test-first / verify by effect** (NON-NEGOTIABLE) | Every requirement carries a probe that names what would prove it absent. Three checks exist purely as negative controls: FR-026 (streaming disabled must miss the gate), FR-112 (the mutated field must fail the round trip), and the control halves of FR-013, FR-023, FR-032, FR-034 and FR-106. | throughout |
| **VI. Never degrade the host** | The lab does not run inside ORCA and cannot stall it. | FR-004 |
| **VII. Interruptibility is two-sided** | Stop stops playback **and** aborts in-flight synthesis, and destroys no queued state. | FR-037 |
| **VIII. Never speak what was not said** | Not exercised: fixtures are committed files, not transcripts. The lab never reads a transcript. | FR-004, FR-085 |
| **IX. Evidence over assertion** | Every latency number carries an R006 label. Every claim about the shipped pipeline cites `path:line` verified against `HEAD`, not inherited. | Constraints table, FR-041 |
| **R021** providers never own playback | The server returns bytes; the browser plays. | FR-006 |
| **R024** never write the user's config | The settings inbox is in the project's own namespace; ORCA's config namespace is never written. | FR-073 |
| **R062** a write under the user's home needs a stated reason | The reason is recorded in `docs/design/011-settings.md` section 1.2 and cited, not re-derived. | FR-073 |
| **R073** budgets are gates | FR-020 is a gate with a negative control. It is **not** a CI threshold, and FR-108 states why: CI runners have no audio device, so a threshold there would be a permanently-green light — a broken indicator. | FR-108 |
| **R006** label every latency number | Done throughout; unlabelled numbers are declared to be budgets. | spec section 0 |

**Violations requiring justification**: none. See Complexity Tracking for the one judgement call.

---

## Project Structure

### Documentation (this feature)

```text
specs/002-voice-lab/
├── spec.md      # the specification and the normative control inventory
├── plan.md      # this file
└── tasks.md     # the executable breakdown
```

No `research.md`: the research is `docs/design/004-voice-lab.md`, `docs/design/011-settings.md` and
`docs/.research/latency-measurements.md`, and duplicating it here would create a second source of
truth for numbers this project has already been bitten by copying (PITFALLS **P32**, **P33**).

No `data-model.md`: the data model is the settings schema, owned by
`packages/core/src/settings/` and specified in `011` section 3. A second declaration is exactly what
FR-072 forbids.

### Source Code (repository root)

```text
fixtures/                       # T110 — committed, reviewable, sentence-counts declared
  code.md  tables.md  paths.md  architecture.md  short.md  hostile.md
  manifest.json                 # per fixture: sentence count, what it exercises

scripts/
  voice-lab.mjs                 # the local server: /normalize, /speak, /stop, /settings, /gate
  check-citations.mjs           # existing

voice-lab/
  index.html                    # the page — self-contained, no CDN, no build step
  app.js                        # control surface, diff, ladder, audio graph, gate timing
  gate.mjs                      # the harness that evaluates the recorded gate log

packages/core/src/
  settings/                     # the schema both surfaces import (shared with M12)
  earcons/                      # the one earcon table — the lab consumes, never mints
  keymap/                       # the one key map — the lab consumes, never defines
  normalizer/                   # stage banner comments corrected; stage list exported

packages/core/src/**/*.test.ts  # unit + contract tiers
voice-lab/*.test.*              # page-driving tier
```

**Structure decision**: the lab lives beside the plugin, not inside it. The page and its server are
new top-level directories because the lab is not shipped in the plugin artifact — which is capped at
2,000 files and 50 MB and must contain exactly three files. The three shared modules (`settings`,
`earcons`, `keymap`) live in `packages/core` precisely because two surfaces consume each, and a
second copy of any of them is the failure mode the round-3 reconciliation spent a pass repairing.

---

## Phases

Each phase has an exit criterion that could fail. A phase is not finished when its code exists; it is
finished when its criterion is observed.

### Phase 0 — Correct the ground the lab renders against

**Why first**: the lab displays the pipeline. If the pipeline's own stage numbering disagrees with
itself, the instrument will show a disagreement and the listener will not know which side is wrong.

- The in-source stage banner comments are misnumbered relative to the pipeline they annotate. Fix
  them, and export the stage list from the module so the ladder derives it rather than restating it.
- Reconcile the queue-cap constant: two different defaults exist for one control. One value.
- Confirm the five `NormalizeOptions` fields against `HEAD` rather than against any document.

**Exit criterion**: a test reads the exported stage list and asserts it equals the calls in
`normalize()`; adding a stage without exporting it fails the test. **Verify by effect**: add a
sixteenth stage on a scratch branch and watch the test go red.

**Checkpoint 0**: the source describes itself correctly. Nothing user-visible has changed.

---

### Phase 1 — Foundations: the schema, the earcons, the key map, the fixtures

**Why here**: every later phase consumes at least one of these, and each is a place where a second
copy would be created by accident if the phase were skipped.

- The settings schema module — field descriptors carrying id, owner, kind, legal values, default,
  provisional mark, effect class, engine-provisional flag, and the wire (or `null` where none
  exists). This is M12's T120 landing early because M11 cannot render a control surface without it.
- The reserved control earcon band, consumed by both surfaces. The lab mints nothing.
- The shared key map, consumed by both surfaces. The lab defines nothing.
- The fixture corpus, committed, with declared sentence counts and at least one fixture of three or
  more sentences.

**Exit criterion**: the control inventory renders from the schema alone — a control added to the
schema appears in the page with no page edit, and a control removed disappears. **Verify by effect**:
add a throwaway control to the schema and confirm it renders; remove it and confirm it does not.

**Checkpoint 1**: 46 controls exist as data. Nothing plays yet.

---

### Phase 2 — User Story 1: play, change, hear — and prove the gate

**This is the MVP.** If the project stopped here, the author could settle path depth, extension
placement and identifier speech, which is the business value of M11.

Ordering inside the phase is forced by what each step needs to be measurable:

1. Server: `/normalize` returning spoken text and the per-stage record.
2. Server: `/speak` returning bytes, with the three provider outcomes distinguished — bytes, throw,
   spoke-elsewhere — before anything is built on top of the happy path.
3. Page: one audio context, decode, cache, schedule back to back.
4. Page: the cache key, covering every input that can change the bytes, with the differing-buffer
   probe. Building the key later means rebuilding the cache.
5. Server: first-chunk streaming, so the cold path is measurable on a real fixture.
6. Page: the gate instrumentation — t₀ from the key event, t₁ from the scheduled start, recorded.
7. The harness that evaluates the log, **including its negative control**.

**Exit criterion — the gate, and the only one that matters**:

- 20 trials per committed fixture on the author's machine record p95 ≤ 2,000 ms on both paths;
- the warm reading is strictly below the cold reading for the same text;
- **the same harness with streaming disabled, on the longest multi-sentence fixture, records a cold
  reading above 2,000 ms.** If that run also passes, the harness is not measuring what it claims and
  the gate is void.
- The two `[claimed]` warm-path numbers in the Constraints table are re-taken as `[measured-here]`
  with run counts, or the gate is declared met on the cold path only and the claim is withdrawn.

**Checkpoint 2**: Gate M11 is met and the evidence is a log, not an impression. The author can start
tuning the ten wired controls today.

---

### Phase 3 — User Story 2: the ladder and the attributed diff

- The stage ladder, one row per stage, three row states — changed, no change, **not run** naming the
  control that disabled it.
- Word-level diff with stage attribution, computed in the page, no external library.
- Stable character offsets on every span (the cheap insurance premium that makes a future word
  cursor a display change).
- Per-stage play, and play-the-stage-before.

**Exit criterion**: set the path style to verbatim and confirm the ladder reads *not run*, naming the
control; set it back and confirm the row reads *changed*. A ladder that reads *no change* in the
first case is displaying a falsehood.

**Checkpoint 3**: "this sounds wrong" resolves to "turn this control" without asking anyone.

---

### Phase 4 — User Story 3: Compare

- Blind during playback, revealed on stop, using the reserved separator earcon.
- The reveal names the differing control, and generalises past one difference.
- One-key keep-first / keep-second.
- Opt-in Blind × 3.

**Exit criterion**: construct sets differing in one, three and eight controls and assert the three
distinct announcements. The one-difference case alone would pass a specification that is wrong about
the general case.

**Checkpoint 4**: the listener can distrust themselves productively.

---

### Phase 5 — User Story 4: persistence, Save, export, round trip

- Autosave of the working set, both slots and the snapshots, with guarded storage access.
- The settings inbox writer: the envelope, the monotonic revision, the JSONC comments generated from
  the schema, the re-read-before-Save and the stale-revision refusal, and the warning before the
  first Save over a hand-written file.
- The `expected[]` oracle, written from what was spoken, with chunk boundaries.
- The settled report.
- The round-trip test **with its negative control**.

**Exit criterion**: the round trip reproduces the spoken text and the chunk boundaries for every
fixture, and the mutated-field run fails. A round trip that cannot fail is a check that both sides
read the same file.

**Checkpoint 5**: a settled value reaches the plugin as a data edit.

---

### Phase 6 — Accessibility hardening and CI

Accessibility work is distributed through phases 2–5 as functional requirements; this phase is where
it is **asserted**, because assertions about focus, hit targets and keyboard sufficiency are only
meaningful against the finished surface.

- Drive all four user stories with synthesized key events only.
- Measure every control row's rendered box and hit target.
- Assert focus never moves across every control type's change.
- Run the failure suite with logging and notification removed, asserting on spoken text.
- CI on three OSes: normalize-only, headless, **zero audio-device opens**, with every not-run probe
  reporting its reason and the counts reconciling.

**Exit criterion**: the CI job runs with the audio device instrumented and opens it **zero** times;
the opt-in audible form opens it. Both halves — an audio assertion that could not have failed proves
nothing, and a silent-by-default rule that nobody verified is how an audible benchmark ends up
interrupting the author mid-sentence.

**Checkpoint 6**: M11 is done, and done is observable.

---

## Risks, and what would show each one real

| Risk | What would show it | Response already planned |
|---|---|---|
| **The gate fails on real fixtures.** ~55 % of the budget is the synthesizer on one sentence; three sentences serialized misses outright. | The recorded cold p95 above 2,000 ms on the architecture fixture. | Phase 2 step 5 — first-chunk streaming — is sequenced *before* the gate is declared, not after. If streaming is still not enough, the honest answers are a shorter default fixture or a faster engine, not a redefinition of the gate. |
| **The warm path is not ~0 ms.** Both warm-path numbers are `[claimed]`; no probe has run. | The recorded warm reading close to the cold one. | Phase 2's exit criterion re-takes both as measurements before the gate is declared met. |
| **36 of 46 controls change nothing audible** (Finding 1). | The author turns an omissions control, hears no difference, and concludes the lab is broken. | FR-013 makes an unwired control say so, out loud. The scope question — whether M11 also wires them — is escalated in the spec's Findings rather than answered here. |
| **A stale cache hit reads as a taste result** (Finding 4). | Changing pitch produces identical audio. | FR-023 requires the key to cover every byte-affecting input, and requires the probe to compare decoded buffers rather than request counts. |
| **The lab and the plugin fork the schema.** | Two declarations of the same field, drifting. | FR-072: one module, imported by both, no generator between them. Phase 1 lands it before either surface needs it. |
| **A subagent fan-out inside this worktree while the author is listening.** | Agent replies the author never asked for, talking over each other (PITFALLS **P31**). | Run fan-outs in a separate worktree or under a HOME the watcher does not tail. This is an operating constraint on building M11, not a property of M11. |
| **Concurrent edits to `docs/design/`.** | A design amendment landing while this plan is executed. | The spec pins its inputs by name and the corrections are listed explicitly in Appendix B, so a later amendment is a visible diff against a stated baseline. |

---

## Complexity Tracking

| Judgement | Why | Simpler alternative, and why it was rejected |
|---|---|---|
| The settings schema module (`packages/core/src/settings/`) lands in **M11** although it is M12's T120 | M11 cannot render a control surface, persist a working set, or write an export without the schema, and building a lab-local schema first would guarantee a second declaration and a later merge. | A lab-local control list, migrated to the shared schema in M12 — rejected: it creates exactly the two-declarations-of-one-field shape that FR-072 exists to forbid, and the drift would be discovered by a listener whose tuning did not survive the migration. |
| The lab is a **second surface** in the repository, not a plugin panel | ORCA's panel is write-capable and read-blind, its settings capability renders nothing, and a browser page cannot reach the plugin's sanctioned settings store at all. There is no host surface to build this in. | An in-ORCA settings pane — rejected: it does not exist and cannot be made to exist from a plugin. |
| Web Audio playback in the page rather than the shipped sink | The shipped sink opens the audio device per chunk, at ~893 ms `[derived]` of a p50 897–950 ms gap `[measured-here]`; sharing it would put a device open between every replay and make the gate unreachable. The shared path with the plugin is preserved exactly where it matters — normalize → chunk → synthesize, which is the whole decision surface the lab exists to tune. | Reusing the plugin's sink — rejected: it shares the one layer scheduled for demolition in M9 and the one layer the constitution says providers must not own. |

---

## What would prove this plan wrong

- A fixture that takes longer than two seconds from keypress to audio on the author's machine, with
  first-chunk streaming enabled. This is a live risk on any fixture longer than about one sentence,
  not a theoretical one.
- The disabled-streaming negative control passing — which would mean the gate harness never measured
  the thing it claims.
- The author sitting down with the finished lab and finding that the controls he wanted to settle
  are among the 36 that change nothing (Finding 1). That would mean the milestone shipped the
  instrument and not the tuning.
