# J14 — the settings round trip: two independent paths to one string

**Written:** 2026-08-21. **Task:** M11 contract criterion **C4**
(`.meta/goal/voice-lab-m11/contract.md`). **Test:**
`packages/core/src/settings/roundtrip.test.ts` — the only file this job wrote.

**Suite: 421 tests green before, 549 tests green after** (22 files → 23). +128 tests, all in the
one new file. `pnpm typecheck` clean. No test opens an audio device, spawns a player, or reaches
the author's real config (**P31**): the lab server is started on port 0, only `/normalize` is
driven, the provider is a stub whose `generate()` throws if anything ever calls it, and the server
is closed in `afterAll`.

**Nothing outside `packages/core/src/settings/` was changed.** Two mutation probes touched
`schema.ts` and `voice-lab/lib/settings.mjs` for seconds each, with `cp` backups and `cp` restores
— never `git checkout` (**P34**: other agents share this tree). `git status --porcelain` after each
revert showed only the intended file.

---

## 1. What C4 asks for, and what was built

> **C4 — the round trip proves lab and plugin agree.** Settings exported from the lab, fed to
> `normalize()`, reproduce the lab's spoken text byte-for-byte. *Oracle:* a test whose expected
> value is the lab's own emitted text captured in a fixture, compared against a fresh `normalize()`
> — **two independent paths to one string.**

The whole value of the criterion is in the last four words. A round-trip test where both sides call
the same helper proves that a function equals itself, and would go green on the exact drift it
exists to catch. So the seam was designed first and the assertions second.

```
   LAB PATH                                    PLUGIN PATH
   ─────────                                   ───────────
   lab control values ────────────────┬──────► the same lab control values
     'path.style' · 'num.expandIntegers'│         'path.style' · 'num.expandIntegers'
              │                        │                  │
   voice-lab/index.html                │        voice-lab/lib/settings.mjs
   normalizeOptions()                  │        toSettingsFile() + serializeJsonc()
   lifted from the PAGE'S OWN BYTES    │                  │
              │                        │                  ▼
              ▼                        │        JSONC TEXT — the file the listener gets,
   NormalizeOptions                    │        keyed by SETTINGS ids
              │                        │                  │
   HTTP POST /normalize                │        packages/core/src/settings/jsonc.ts
   (createLabServer, scratch port)     │        + parse.ts  parseSettingsText()
              │                        │                  ▼
   scripts/voice-lab.mjs               │        Settings record
   computeStages()                     │                  │
              │                        │        packages/core/src/settings/schema.ts
              ▼                        │        toNormalizeOptions()
        spoken text  ◄─────byte-equal──┴──────►        │
                                                        ▼
                                                normalize() in process → spoken text
```

### Why the two paths are independent

Four separations, any one of which a divergence can hide in:

1. **Two id namespaces.** The lab projects from CONTROL ids (`path.style`, `num.expandIntegers`);
   the plugin projects from SETTINGS ids (`normalize.pathStyle`, `normalize.expandIntegers`). The
   mapping between them lives in `controls.mjs`'s `settingsId` column and is exercised, not assumed.
2. **Two projection functions, two languages, two packages.** A hand-written object literal in
   `voice-lab/index.html` versus a schema-table-driven `project()` in `packages/core/.../schema.ts`.
   Neither imports the other.
3. **Only one path is serialized.** The plugin path goes to JSONC text and back through a reader
   with per-field fallback. A field the serializer drops, a comment the reader mis-scans, or a
   validator that refuses a legal value shows up here. The lab path never touches a file.
4. **Two transports.** HTTP into a separate server module, versus an in-process call.

The one thing both paths end at is `normalize()` itself — which is the subject under test, not the
seam.

**The lab's projection is lifted from the page, not re-typed.** `normalizeOptions()` and
`chunkOptions()` live in `voice-lab/index.html` and nowhere else — they are not in `lib/`, so they
cannot be imported. Copying their bodies into the test would compare *our copy of the lab* against
the plugin, which is a different and much weaker question. Instead the test reads `index.html`,
extracts the two function bodies by brace-matching, and evaluates them with the page's own `values()`
accessor supplied as an argument. Edit the page's mapping and this test sees the edit. If the
functions are renamed, the extractor throws with a message that says explicitly not to substitute a
local copy.

---

## 2. The settings sets covered

Ten sets × six fixtures for the spoken-text comparison, plus the same ten sets for the chunk-boundary
comparison. **Defaults are the case least likely to diverge** — every default is the same literal on
both sides, so a projection that ignored its input entirely would still pass — so nine of the ten
move something.

| # | Set | What it moves | Why this one exists |
|---|---|---|---|
| 0 | `defaults` | nothing | the baseline the others differ from; weakest of the ten |
| 1 | `verbatim paths, no extension word` | `pathStyle: 'verbatim'`, `extensionStyle: 'omit'` | `'verbatim'` skips stage 8 entirely |
| 2 | `terse paths` | `pathStyle: 'terse'` | the middle rung of stage 8 |
| 3 | `spoken paths, extension omitted` | `extensionStyle: 'omit'` | **`extensionStyle` is observable ONLY under `pathStyle: 'spoken'`** — see finding D1 |
| 4 | `spoken paths, extension spoken first` | `extensionStyle: 'word-first'` | a second observable value; one could coincide with the normalizer's own default, two cannot |
| 5 | `code blocks dropped, numbers left alone` | `codeBlocks: 'drop'`, `expandNumbers: false` | turns two independent stages OFF; an options object that failed to arrive would leave them on |
| 6 | `ordinals spoken as words` | `orderedLists: 'word'` | the one default 011 calls *settled* rather than provisional |
| 7 | `every wired normalize field off its default` | all five | catches a dropped field even when another masks it |
| 8 | `chunker moved` | `maxUnits: 60`, `isolateFirstSentence: false` | the second option surface; changes no spoken text, must change the boundaries |
| 9 | `wired at defaults, 37 designed fields perturbed` | all 37 designed-not-wired controls | a designed field must carry its VALUE and change NOTHING spoken |

**Six fixtures**, all committed: `architecture.md`, `code-heavy.md`, `hostile.md`, `paths.md`,
`short.md`, `tables.md`. Named as a literal list rather than globbed, so a fixture that disappears
makes the test go red instead of quietly shrinking (**P36**).

### The designed fields

Set 9 moves every one of the **37 designed-not-wired** controls off its default, by kind: `bool`
negated, `enum` to its second value, `multi` inverted, `int`/`float` one step up (or down at the
ceiling), `template` with a probe suffix inside `maxLength`, `map` with an extra entry, `voice` to
index 3. Then, per control, one test asserts the value survives **lab → JSONC → `parseSettingsText()`
unchanged**, and one asserts nothing legal was rejected on the way through. A designed field that
does not carry its value means the option space silently stops being settleable the day a consumer
appears — P26 arriving one milestone late.

Set 9 is also asserted to speak **exactly** what set 0 speaks. If a designed field ever leaks into
`normalize()`, that equality breaks — and that would be a real finding, not a test bug.

### Negative controls

A byte-equality test is satisfied by a normalizer that ignores its options entirely, so four checks
exist to prove this comparison can tell strings apart at all:

- two settings sets differing in a wired field produce **different** spoken text, on both paths;
- a value corrupted in the serialized JSONC text changes what the plugin path speaks — proving the
  plugin path really reads the *file* rather than re-deriving from the values it was handed;
- the extractor really lifted the page's own projection, and it returns **at least five** keys — a
  projection that silently returned `{}` would make every equality pass for the wrong reason;
- moving the chunker settings really does move the chunk boundaries.

### The observability guard

Added *because* a mutation went green (D1 below). For each of the five wired normalize fields, the
test searches the ten sets × six fixtures for a pair where changing **that field alone** moves the
lab's spoken text, and fails naming any field for which no such pair exists:

> these wired fields change nothing spoken under ANY settings set on ANY fixture, so the
> byte-equality assertions above cannot see them at all. Add a settings set (or a fixture) where the
> field is observable, or the wire is asserted by a test that could not fail.

This is the check that catches the next blind spot without needing someone to think of a mutation.

---

## 3. Proved able to fail — the verbatim mutation output

Three probes. Each was applied, run, and reverted with `cp`.

### Probe 1 — drop a field from the PLUGIN's projection (`schema.ts`)

```diff
   for (const f of Object.values(SETTINGS_SCHEMA)) {
     if (f.owner !== owner || !isWired(f)) continue
+    if (f.id === 'normalize.extensionStyle') continue   // MUTATION PROBE
```

**On the first draft of this test, this went GREEN.** That is finding D1, below. After the two
`spoken`-path sets were added, the same probe goes red on exactly the two rows that can see it:

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  packages/core/src/settings/roundtrip.test.ts > C4 — settings exported from the lab reproduce the lab's spoken text byte-for-byte > settings set: spoken paths, extension omitted > paths.md — the lab's spoken text and the plugin's are the same bytes
AssertionError: LAB and PLUGIN disagree on paths.md under settings set "spoken paths, extension omitted".
  why this set exists: extensionStyle is observable ONLY under pathStyle 'spoken' — 'terse' and 'verbatim' both skip the part of stage 8 that speaks it. A mutation probe that dropped extensionStyle from the plugin's projection went GREEN until this set existed. Without it, that wire is asserted only under settings that disable it.
  the options the PLUGIN path built: {"codeBlocks":"announce","orderedLists":"numeral","pathStyle":"spoken","expandNumbers":true}
  the options the LAB path built:    {"codeBlocks":"announce","pathStyle":"spoken","extensionStyle":"omit","expandNumbers":true,"orderedLists":"numeral"}: expected '<!-- T110c — shallow paths, a deep on…' to be '<!-- T110c — shallow paths, a deep on…' // Object.is equality

Expected: "… The whole of the behaviour you are hearing lives in file named index, in folder packages core src normalizer, — that is the deep one …"
Received: "… The whole of the behaviour you are hearing lives in file named index, typescript, in folder packages core src normalizer, — that is the deep one …"

 ❯ packages/core/src/settings/roundtrip.test.ts:405:13

 FAIL  … > settings set: spoken paths, extension spoken first > paths.md — the lab's spoken text and the plugin's are the same bytes
AssertionError: LAB and PLUGIN disagree on paths.md under settings set "spoken paths, extension spoken first".
  the options the PLUGIN path built: {"codeBlocks":"announce","orderedLists":"numeral","pathStyle":"spoken","expandNumbers":true}
  the options the LAB path built:    {"codeBlocks":"announce","pathStyle":"spoken","extensionStyle":"word-first","expandNumbers":true,"orderedLists":"numeral"}

Expected: "… lives in typescript file named index, in folder packages core src normalizer …"
Received: "… lives in file named index, typescript, in folder packages core src normalizer …"

 Test Files  1 failed (1)
      Tests  2 failed | 109 passed (111)
```

The field names itself twice: by its **absence** from the printed plugin options and its presence in
the lab's, and in the differing text (`file named index, typescript,` versus `file named index,`).

### Probe 2 — write a stale value in the LAB's serializer (`voice-lab/lib/settings.mjs`)

```diff
-    settings[c.settingsId] = v === undefined ? c.default : v
+    settings[c.settingsId] = c.settingsId === 'normalize.orderedLists' ? 'numeral' : (v === undefined ? c.default : v)   // MUTATION PROBE
```

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  packages/core/src/settings/roundtrip.test.ts > C4 — settings exported from the lab reproduce the lab's spoken text byte-for-byte > settings set: ordinals spoken as words > architecture.md — the lab's spoken text and the plugin's are the same bytes
AssertionError: LAB and PLUGIN disagree on architecture.md under settings set "ordinals spoken as words".
  why this set exists: the one default the schema calls settled rather than provisional; 'word' is the value the lab can still choose.
  the options the PLUGIN path built: {"codeBlocks":"announce","orderedLists":"numeral","pathStyle":"spoken","extensionStyle":"word-last","expandNumbers":true}
  the options the LAB path built:    {"codeBlocks":"announce","pathStyle":"spoken","extensionStyle":"word-last","expandNumbers":true,"orderedLists":"word"}

Expected: "… Of that: first, The fork and exec of the player … second, The temp file round trip … third, Everything else …"
Received: "… Of that: one, The fork and exec of the player … two, The temp file round trip … three, Everything else …"

 FAIL  … > settings set: every wired normalize field off its default > architecture.md — …
AssertionError: LAB and PLUGIN disagree on architecture.md under settings set "every wired normalize field off its default".
  the options the PLUGIN path built: {"codeBlocks":"drop","orderedLists":"numeral","pathStyle":"terse","extensionStyle":"raw-last","expandNumbers":false}
  the options the LAB path built:    {"codeBlocks":"drop","pathStyle":"terse","extensionStyle":"raw-last","expandNumbers":false,"orderedLists":"drop"}

Expected: "… Of that: The fork and exec of the player … The temp file round trip … Everything else …"
Received: "… Of that: 1, The fork and exec of the player … 2, The temp file round trip … 3, Everything else …"

 Test Files  1 failed (1)
      Tests  2 failed | 109 passed (111)
```

`orderedLists` is named on both sides of the printed options, and the differing text is the ordinal
itself — `first / second / third` versus `one / two / three`, and `1, 2, 3` versus nothing. This is
the P22 shape: both outputs are plausible speech, and only the comparison reveals which one the
listener actually tuned.

### Probe 3 — drop a field from the PLUGIN's chunker projection

```diff
+    if (f.id === 'chunk.maxUnits') continue   // MUTATION PROBE
```

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  packages/core/src/settings/roundtrip.test.ts > C4 — the chunker surface: the lab and the plugin split the speech at the same places > settings set "chunker moved: smaller units, first sentence not isolated" — same chunk boundaries on architecture.md
AssertionError: chunk boundaries differ under "chunker moved: smaller units, first sentence not isolated". lab: {"maxUnits":60,"isolateFirstSentence":false}, plugin: {"isolateFirstSentence":false}: expected [ …(24) ] to deeply equal [ '<!', …(77) ]

 Test Files  1 failed (1)
      Tests  1 failed | 127 passed (128)
```

All three reverted. `pnpm typecheck` clean and `pnpm test` 549 green afterwards.

---

## 4. Divergences found

### D1 — `extensionStyle` was asserted only under settings that disable it (**found in this test, fixed here**)

Not a lab/plugin divergence; a hole in the first draft of this very test, and the reason the mutation
budget exists. `normalize()` speaks a file extension only under `pathStyle: 'spoken'` — `'terse'`
drops the extension and `'verbatim'` skips stage 8 altogether. Measured directly:

```
paths.md         spoken   word-first differs: true   raw-last differs: true   omit differs: true
paths.md         terse    word-first differs: false  raw-last differs: false  omit differs: false
architecture.md  spoken   word-first differs: false  raw-last differs: false  omit differs: false
code-heavy.md    spoken   … false      hostile.md  spoken  … false
short.md         spoken   … false      tables.md   spoken  … false
```

`extensionStyle` is observable on **exactly one of the six fixtures, under exactly one of the three
path styles**. The first draft's sets moved it only alongside `'terse'` and `'verbatim'`, so
deleting the wire from the plugin's projection changed nothing anywhere and the suite stayed green.
J11 recorded the same shape for T124 (*"`extensionStyle` is deliberately exercised under
`pathStyle: 'spoken'`, because `'verbatim'` skips the stage entirely"*) — the lesson did not
transfer, and only the mutation caught it.

**Fixed:** sets 3 and 4 exercise it under `'spoken'`, and the **observability guard** now fails
naming any wired field that changes nothing spoken under any set on any fixture.

### D2 — the first draft's designed-field set was the defaults set a second time (**found here, fixed here**)

Set 9's `overrides` were left `{}` with a comment saying they would be filled in later, and never
were. All 37 designed-field assertions were comparing defaults with defaults — a test that could not
have failed, in the file written to eliminate exactly that. Now computed from `perturbAllDesigned()`,
with `expect(Object.keys(perturbed).length).toBe(37)` in front of it so an empty perturbation is a
red test, not a silent pass.

### D3 — no real lab/plugin divergence exists today (**VERIFIED**)

With the test correct, **all 128 assertions pass unmutated**. Across ten settings sets and six
fixtures, the lab's spoken text and the plugin's are byte-identical; the chunk boundaries match on
every set; and all 45 shared settings ids round-trip their values through the lab's JSONC serializer
and the plugin's reader unchanged, with an empty `rejected` list.

### D4 — dropping a key from `toSettingsFile()` costs the whole file, not one field (**observation, no action**)

Noticed while running probe 2's first variant, which `continue`d past a control instead of writing a
wrong value. `serializeJsonc()` emits one line per control from `CONTROLS` regardless of what is in
`file.settings`, so a missing key renders as `JSON.stringify(undefined)` → the bare token
`undefined` → the JSONC reader refuses the **whole file** and every field falls back to its default.
The test showed this loudly (56 failures, and the plugin's options visibly reverted to defaults), so
nothing is hidden — but per-field fallback, the property T123 exists for, does not survive a
serializer bug of this shape. It is reachable only from a code defect, never from a hand edit, so it
is recorded rather than filed. **`voice-lab/` was not edited.**

---

## 5. The known lab/schema disagreement — named, not absorbed

J11 finding **F1**: `voice-lab/lib/controls.mjs` row 40 declares
`settingsId: 'lab.sessionLabelHashChars'`, while `docs/design/011-settings.md` section 3.2 says the
schema must **not** carry it (008 X-04 / 007 C7 removed hex as a correctness matter). The schema
follows 011 and does not have the field.

**Which side should change is the author's decision and has not been made. Neither side was edited.**
Resolving it by deleting the lab row or by adding a schema field would make the round trip green by
erasing the question, which is the opposite of what this test is for. Instead the **consequence** is
asserted, as a named exception with its reason, in `describe('C4 — the lab/schema disagreement is
named, not absorbed')`:

- the lab's serializer **does** write `"lab.sessionLabelHashChars"` into the JSONC file;
- `parseSettingsText()` reports it in `unknownFields`, and `unknownFields` equals **exactly**
  `['lab.sessionLabelHashChars']` — not "contains", so a second unknown id is a new red test;
- it is **not** in `rejected`: an unknown id is not a bad value, and conflating the two would hide
  the difference between a file from a newer plugin and a file with a typo in it;
- `SETTINGS_SCHEMA['lab.sessionLabelHashChars']` is asserted `undefined`;
- the field is skipped — by name, from `LAB_ONLY_IDS` — in the designed-field value round trip,
  because a field the schema does not carry cannot round-trip through it.

The day the author resolves it, this assertion goes red and names itself, in either direction.

**The mirror-image asymmetry is asserted too.** `announce.reportChannel` and `apply.toQueued` are in
the schema and have **no lab control**, so the lab's serializer cannot write them and they must come
back as schema defaults. Both are asserted, along with J11's arithmetic restated by hand rather than
imported (**P33/P36**): **46 lab rows − 1 lab-only + 2 schema-only = 47 shipping schema fields.** A
new control on either side lands on that assertion.

---

## 6. What this test does not cover

- **`SynthesizeOptions`.** The lab's `synthOptions()` resolves `voice` against `state.voices`, the
  browser's cached copy of the host's runtime voice list, and the plugin's `toSynthesizeOptions()`
  takes a resolver for the same reason (J11 **F7**). With no host there is no list, and comparing
  two paths that both omit `voice` would be a check that could not fail. `rate` alone would be an
  options-object comparison, not an effect. J11's T124 (c) already drives the synthesize surface
  against the options object the provider was **handed**, including the out-of-range control.
- **Audio.** C4 is about text. Nothing here synthesizes, and the stub provider's `generate()`
  throws if anything tries (**P31**).
- **The `since: 3` reserved fields.** Eleven ids with no consumer by definition and no lab control;
  `isFuture()` excludes them from the inventory comparison, as it does in T124.
- **Whether any default is the RIGHT default.** 45 of 47 are provisional and the listener settles
  them by ear (**P23**, contract C7). This test proves the value the listener picks is the value the
  plugin speaks — not that it was a good pick.
