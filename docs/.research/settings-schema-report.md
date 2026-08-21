# J11 — the settings schema: what shipped, what is wired, and where the sources disagree

**Written:** 2026-08-21. **Task:** M12 T120 / T123 / T124, against `docs/design/011-settings.md`
(authoritative), `specs/002-voice-lab/spec.md` FR-011 – FR-017, and the lab's shipped inventory
`voice-lab/lib/controls.mjs`.

**Suite:** 354 tests green before, **421 tests green after** (22 files). +67 tests, all in
`packages/core/src/settings/`. No test opens an audio device or spawns a process (**P31** — the
author is at this machine). `pnpm typecheck` clean.

**What was written**

| Path | What it owns |
|---|---|
| `packages/core/src/settings/schema.ts` | `SCHEMA_VERSION`, `Owner`, `Effect`, `FieldDescriptor`, `SETTINGS_SCHEMA`, the derived views (`gapReport`, `schemaDefaults`), and the three projections onto the real option surfaces |
| `packages/core/src/settings/parse.ts` | `parse()` / `parseSettingsText()` with per-field fallback, the migration chain, the mirror envelope, `promote()` and the `stale_revision` rule, and the spoken report |
| `packages/core/src/settings/jsonc.ts` | a dependency-free JSONC reader that never throws and reports a **line number** |
| `packages/core/src/settings/option-surface.ts` | `OPTION_KEYS` and the named `EXCLUDED` lists T124 walks |
| `packages/core/src/{normalizer,chunker,types}/index.ts` | `NORMALIZE_OPTION_KEYS`, `CHUNKER_OPTION_KEYS`, `SYNTHESIZE_OPTION_KEYS` **beside their interfaces**, each with a compile-time exhaustiveness guard |

---

## 1. Field inventory by owner

47 fields ship at `SCHEMA_VERSION = 2`; 11 more are **reserved** at `since: 3` (011 section 4.2a's
forward register) and are excluded from the reachability assertion while being counted everywhere
else.

```
settings schema v2 — 47 fields shipping, 11 reserved at a later version
  wired ................. 10   (some consumer reads the value today)
    of which options .... 9   (NormalizeOptions / ChunkerOptions / SynthesizeOptions)
  designed-not-wired .... 37   (rendered and recorded; nothing consumes it yet)
  excluded .............. 2   (named, reviewable exclusions from the option surfaces)
  future ................ 11   (since > 2; no consumer by definition)
  provisional ........... 45   (defaults nobody has settled by ear)
  by owner:
    normalize    23 shipping  (5 wired, 18 designed)  +0 reserved
    chunk         2 shipping  (2 wired, 0 designed)  +0 reserved
    synthesize    6 shipping  (2 wired, 4 designed)  +0 reserved
    queue         3 shipping  (0 wired, 3 designed)  +1 reserved
    announce      9 shipping  (1 wired, 8 designed)  +0 reserved
    session       1 shipping  (0 wired, 1 designed)  +4 reserved
    input         1 shipping  (0 wired, 1 designed)  +6 reserved
    apply         1 shipping  (0 wired, 1 designed)  +0 reserved
    lab           1 shipping  (0 wired, 1 designed)  +0 reserved
```

`gapReport()` prints this and T124 attaches it, so **every one of those numbers is a value someone
can watch move.** An indicator that never changes is a broken indicator.

### The 9 that reach a typed options object

| Id | Wire | Consumer |
|---|---|---|
| `normalize.codeBlocks` | `NormalizeOptions.codeBlocks` | `normalize()` |
| `normalize.pathStyle` | `NormalizeOptions.pathStyle` | `normalize()` |
| `normalize.extensionStyle` | `NormalizeOptions.extensionStyle` | `normalize()` |
| `normalize.expandIntegers` | `NormalizeOptions.expandNumbers` | `normalize()` |
| `normalize.orderedLists` | `NormalizeOptions.orderedLists` | `normalize()` |
| `chunk.maxUnits` | `ChunkerOptions.maxUnits` | `new Chunker()` |
| `chunk.isolateFirstSentence` | `ChunkerOptions.isolateFirstSentence` | `new Chunker()` |
| `synthesize.voiceIndex` | `SynthesizeOptions.voice` | `provider.generate()` |
| `synthesize.rate` | `SynthesizeOptions.rate` | `provider.generate()` |

The **tenth** wired field is `announce.reportChannel` → `SettingsReport.channel`, which is a real
consumer (`reportDestination()` in `parse.ts`) but not an options surface. See finding **F2**.

### The 2 named exclusions

| Key | Reason |
|---|---|
| `ChunkerOptions.countUnits` | an injected size-measuring FUNCTION; a settings file cannot express one |
| `SynthesizeOptions.signal` | an `AbortSignal` supplied per call at runtime; not tuning |

Both are named constants with a stated reason, and T124 asserts in **both directions** — an
exclusion that no longer names a real property fails, because a stale allow-list entry is how an
exclusion quietly starts hiding something else.

### Provisional versus settled

**45 of 47 defaults are `provisional: true`.** Exactly two are settled, and the schema test asserts
that list by name:

- `normalize.orderedLists = 'numeral'` — dropping the ordinal makes a numbered procedure
  indistinguishable from a bullet list (002 spec row 10, *"shipped, not provisional"*).
- `queue.maxQueued = 8` — 009 section 2 C3; twenty queued replies is ~3 minutes of unrequested
  speech.

A settled default **requires a `rationale`** and the test fails without one. A provisional one is a
placeholder the listener settles by ear in Voice Lab, and settling it is a one-line data edit here —
no consumer touched, no test rewritten. That is **P23** made structural.

---

## 2. T124, proved able to fail

**Verified by effect on all three option surfaces**, in the two steps the design requires: the
compile-time guard first, then the runtime assertion. Backups were taken with `cp` and restored with
`cp`, never `git checkout` (**P34**: other agents share this tree).

### Normalizer

Step 1 — add `dummyOption?: string` to `NormalizeOptions` and nothing else:

```
> tsc -b
packages/core/src/normalizer/index.ts(71,7): error TS2322: Type 'true' is not assignable to type 'never'.
 ELIFECYCLE  Command failed with exit code 2.
```

Step 2 — add `'dummyOption'` to `NORMALIZE_OPTION_KEYS`, as `tsc` forces. `tsc` now passes and the
runtime test goes red:

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  packages/core/src/settings/reachability.test.ts > T124 (b) — schema ids and the real option surfaces name the same properties > normalize: every property of NormalizeOptions is reachable from settings, or named as excluded
AssertionError: NormalizeOptions.dummyOption is not reachable from any settings field, and is not in EXCLUDED. Either add a FieldDescriptor with wire: 'NormalizeOptions.dummyOption', or add 'dummyOption' to EXCLUDED.normalize with its reason — a field that cannot be walked is not a setting, it is a comment (P26).: expected [] to include 'dummyOption'
 ❯ packages/core/src/settings/reachability.test.ts:73:11

 Test Files  1 failed (1)
      Tests  1 failed | 14 passed (15)
```

### Chunker

Step 1 — `dummyChunkOption?: number` on `ChunkerOptions`:

```
packages/core/src/chunker/index.ts(54,7): error TS2322: Type 'true' is not assignable to type 'never'.
 ELIFECYCLE  Command failed with exit code 2.
```

Step 2:

```
AssertionError: ChunkerOptions.dummyChunkOption is not reachable from any settings field, and is not in EXCLUDED. Either add a FieldDescriptor with wire: 'ChunkerOptions.dummyChunkOption', or add 'dummyChunkOption' to EXCLUDED.chunk with its reason — a field that cannot be walked is not a setting, it is a comment (P26).: expected [ 'countUnits' ] to include 'dummyChunkOption'
      Tests  1 failed | 14 passed (15)
```

### Synthesize

Step 1 — `readonly dummySynthOption?: string` on `SynthesizeOptions`:

```
packages/core/src/types/index.ts(50,7): error TS2322: Type 'true' is not assignable to type 'never'.
 ELIFECYCLE  Command failed with exit code 2.
```

Step 2:

```
AssertionError: SynthesizeOptions.dummySynthOption is not reachable from any settings field, and is not in EXCLUDED. Either add a FieldDescriptor with wire: 'SynthesizeOptions.dummySynthOption', or add 'dummySynthOption' to EXCLUDED.synthesize with its reason — a field that cannot be walked is not a setting, it is a comment (P26).: expected [ 'signal' ] to include 'dummySynthOption'
      Tests  1 failed | 14 passed (15)
```

All three probes reverted; `pnpm typecheck` clean and `git status --porcelain` showed only the
intended settings files afterwards.

### Why the other three parts of T124 exist

(b) proves the **names** line up. It cannot prove a **value arrives** — which is the entire content
of **P26**, where `voice` and `rate` were declared, implemented on three platforms and covered by
passing provider tests while `SpeechService` called `provider.generate(chunk.text)` with no options
at all. So (c) drives each real consumer:

- **normalize** — a tuned file changes what `normalize()` **produces**, asserted field by field on
  the output text (`'drop'` removes the code-block announcement, `'verbatim'` keeps the raw path,
  `expandIntegers: false` stops "fifty two", `orderedLists: 'drop'` removes the ordinal,
  `extensionStyle: 'omit'` removes "typescript"). `extensionStyle` is deliberately exercised under
  `pathStyle: 'spoken'`, because `'verbatim'` skips the stage entirely and a wire asserted only
  under a setting that disables its own stage is not asserted.
- **chunk** — asserted on the chunks emitted, with `isolateFirstSentence` tested at `maxUnits: 200`
  where the flag is the only thing deciding the first boundary. At `maxUnits: 40` the size cap
  decides it either way, and that version of the test passed with the flag unwired.
- **synthesize** — asserted on the options object the provider was **handed**, with two controls: a
  defaults-only file claims no voice at all, and an index the host's voice list does not reach is
  **omitted rather than guessed** (a guessed voice name exits zero and silently substitutes the
  default — the P18/P26 shape).
- **CONTROL for all three** — a defaults-only file hands each consumer exactly the schema defaults
  and nothing else, so the positive assertions can be shown to fail for the right reason.

### And the counts are restated, not imported

Every count in `schema.test.ts` and in T124 (d) is written out by hand as an independent claim.
Importing them from `SETTINGS_SCHEMA` would make the test iterate one fewer row when a descriptor is
deleted and pass — **P36** exactly. The cost is a real two-place edit when the control surface
legitimately changes, and that cost is the mechanism.

---

## 3. Disagreements found

The schema agrees with the lab's inventory on **`wire`, `kind`, `default`, `panel`, `range` and
`values` for all 45 shared fields** — zero mismatches on any of those. What follows is everything
that did not line up. **Nothing in `voice-lab/` was edited.**

### F1 — the lab ships `lab.sessionLabelHashChars`; 011 says the schema must not carry it

`voice-lab/lib/controls.mjs` row 40 declares `settingsId: 'lab.sessionLabelHashChars'`.
`011` section 3.2 says, of the same row: *"Row 40 `sessionLabelHashChars` does not exist in this
schema — 008 X-04 / 007 C7 removed hex as a correctness matter, and a schema that carries it invites
it back."*

**Shipped:** the schema does **not** carry it, following 011.

**Consequence, stated rather than hidden:** the lab will render a control whose `settingsId` has no
`FieldDescriptor`. Its value cannot be validated, defaulted, mirrored, or written to the starter
file, and `parse()` will report it in `unknownFields`. This is the arithmetic that makes 011's
"**47** at `SCHEMA_VERSION = 2`" come out right — 46 lab rows, minus row 40, plus
`announce.reportChannel`, plus `apply.toQueued` — so the count and the removal are consistent with
each other and only the lab is out of step. **Fix belongs to the lab, not here:** either delete row
40 or re-declare it as lab-local UI state with no `settingsId`.

### F2 — 011 section 3.2 says "9 wired"; 011 section 3.2a and 4.3a hand out a tenth and an eleventh wire

`011` section 3.2 states the wired count is **9** (5 normalize + 2 chunk + 2 synthesize). But two
descriptors written elsewhere in the same document carry a non-null `wire`:

| Id | `wire` in 011 | Status |
|---|---|---|
| `queue.maxQueued` | `'SpeechServiceDeps.maxQueued'` (section 3.2a) | **shipped as `wire: null`** — see F3 |
| `announce.reportChannel` | `'SettingsReport.channel'` (section 4.3a) | **shipped as declared** |

**Shipped:** the gap report carries two numbers instead of one — `wired: 10` (some consumer reads
it) and `optionSurfaceWired: 9` (011 section 3.2's count, and the one T124's reachability assertion
walks, because those three types are the ones with a compile-time key list to walk against).
`SettingsReport` is a real exported interface in `parse.ts` with a real reader, so the wire does not
name a type that does not exist.

### F3 — `queue.maxQueued`'s wire is a claim about code that has not been written

`011` section 3.2a gives `queue.maxQueued` `wire: 'SpeechServiceDeps.maxQueued'`. Three other
sources say otherwise, and the code agrees with them: `main.ts` still passes a literal `8`, so the
**settings value does not reach the consumer**.

| Source | Says |
|---|---|
| `011` section 3.2 | wired count is 9 = 5 + 2 + 2, which excludes `maxQueued` |
| `specs/002-voice-lab/spec.md` FR-012 | the wired set is named, and `queue.maxQueued` is not in it |
| `specs/002-voice-lab/spec.md` row 36 | class **D** — designed |
| `voice-lab/lib/controls.mjs` row 36 | `wire: null` |

**Shipped:** `wire: null`, with the disagreement recorded in a comment on the descriptor itself.
Claiming the wire before **T122** deletes the literal would be precisely the P26 defect this field is
documented against — a setting that is declared, defaulted, rendered and untestably dead. When T122
lands, flip it to `'SpeechServiceDeps.maxQueued'` and the two count assertions in T124 (d) go from
9/10 to 10/11, which is exactly the visible edit those hand-written numbers exist to force.

### F4 — the lab has an `owner: 'unassigned'` that 011's `Owner` union cannot express

Four lab rows are `owner: 'unassigned'` while their `settingsId` names a real owner:

| Lab row | `settingsId` | Lab `owner` | Schema `owner` |
|---|---|---|---|
| 9 | `normalize.headingPauseMs` | `unassigned` | `normalize` |
| 35 | `normalize.sentencePauseMs` | `unassigned` | `normalize` |
| 44 | `synthesize.pauseBackend` | `unassigned` | `synthesize` |
| 45 | `synthesize.interruptGranularity` | `unassigned` | `synthesize` |

`'unassigned'` is not a member of 011's `Owner` union, and 011 requires every id to be
`<owner>.<name>` — which the lab's own `settingsId` values already satisfy.

**Shipped:** owner taken from the id prefix, which is what 011 and the lab's ids both say. The thing
the lab was trying to record — *these are blocked behind the single provider-seam change C-05* — is
carried instead by `effect: 'session'` plus a comment, so the fact survives without inventing a
tenth owner. `schema.test.ts` asserts `id.split('.')[0] === owner` for every field, so the two can
never drift again.

### F5 — three control kinds the lab ships that 011's `FieldKind` union does not list

011 section 3.1 lists six kinds. The lab renders **nine**: `multi`
(`normalize.codeBlockDetail`), `map` (`normalize.extensionWords`, `normalize.unitWords`) and `voice`
(`synthesize.voiceIndex`) are shipped by the lab and absent from 011's union.

**Shipped:** the union carries all nine, and `parse()` validates each. Truncating to six would leave
four controls the listener can turn and the loader cannot check.

### F6 — 011's v1 migration names a `voiceNameChecksum` that no descriptor carries

`011` section 4.2 specifies the version-1 migration as `voice: string` → `voiceIndex` +
`voiceNameChecksum`. There is no `voiceNameChecksum` field anywhere in the schema, and 011 section
4.2a rule 1 forbids inventing one here (*"a setting that is not a descriptor is not a setting; it is
a comment"*).

**Shipped:** the migration drops the name, sets `synthesize.voiceIndex` to `null`, and **pushes a
rejection so the listener is told aloud** — *"your old settings named a voice (…); voice names do not
carry between machines, so the system default is in use until you pick one again"*. A silent
carry-forward would substitute the system default and look like it worked, which is P28 on top of
P26. If the checksum is wanted, it needs a registered id.

### F7 — `synthesize.voiceIndex` persists an index but its wire is a name

The id and P28 both say **index**; `SynthesizeOptions.voice` is a `string` **name**. Nothing in 011
says who bridges them.

**Shipped:** `toSynthesizeOptions(settings, resolveVoice?)` takes the host's voice list as a
resolver, because core does not have one. With no resolver, or an index the list does not reach,
`voice` is **omitted rather than guessed**. T121 supplies the resolver; the tests cover both the
resolved and the out-of-range case.

### F8 — 011 section 7's diagram says "+9 reserved at since:3"; section 4.2a lists eleven

Section 4.2a's own prose says *"That is **eleven** reserved ids"* and its table has eleven rows; the
mermaid diagram in section 7 still reads `+ 9 reserved at since:3`. The two rows added by finding
R7-30 (`input.talkWindowIdleMs`, `input.paneFallbackWatch`) did not reach the diagram.

**Shipped:** eleven, asserted by id in `schema.test.ts`. Diagram is stale by two.

### F9 (not mine, but the tree's) — `pnpm lint` was already failing before this job

`packages/plugin/src/main.test.ts:387:29  error eslint(require-yield)`. Confirmed present with my
changes stashed, so it is pre-existing and belongs to whoever owns `packages/plugin`. My files
contribute warnings only (three `no-underscore-dangle` on the `_…KeysAreExhaustive` guards, whose
names come from 011 section 3.3's own snippet).

---

## 4. What is deliberately not here

- **The starter-file generator and the `fs.watch` / stat-poll loop** (011 section 6) are T121 —
  worker-side, filesystem-bound, and outside `packages/core/src/settings/**`. The schema carries
  everything they need (`help`, `values`, `provisional`, `since`, `SETTINGS_POLL_MS`).
- **Deleting `maxQueued: 8` at `main.ts` and `DEFAULT_MAX_QUEUED` at `speech-service.ts`** is T122,
  in `packages/plugin`. The number now exists in `schema.ts`; the two literals are still live and
  are still a T122 violation.
- **Settling any provisional default.** 45 of them are the listener's to settle by ear in Voice Lab.
  The option space is designed; the values are not.
