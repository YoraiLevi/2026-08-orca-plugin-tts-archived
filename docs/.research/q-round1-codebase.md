# Round 1 — empirical answers from the codebase

**Scope:** Q22 and Q25 from `docs/.discussion/000-open-questions.md`, plus the stage inventory and
hidden-preference audit the M11 design round needs.
**Method:** read `packages/**/src`, ran `pnpm test`, ran probes against the real `normalize()`.
No source file was modified. Every claim carries `path:line`.
**Date:** 2026-08-21. Working tree at `c8b6fdc`, plus one untracked discussion file.

---

## Q22 — the complete `NormalizeOptions` contract

**Verdict: the claim of four fields is CONFIRMED.** `NormalizeOptions` has exactly four fields,
all optional, all declared at `packages/core/src/normalizer/index.ts:20-37`. There is no fifth
field, no nested object, and no field added since the type was written.

| Field | Type | Legal values | Default | Read at | Consumed by stage |
|---|---|---|---|---|---|
| `codeBlocks` | `CodeBlockPolicy` (`index.ts:15`) | `'announce'` · `'drop'` | `'announce'` (`index.ts:77`) | `index.ts:77` | 1 · `stripFencedCode` (`index.ts:107-129`) |
| `pathStyle` | `PathStyle` (`index.ts:16`) | `'spoken'` · `'terse'` · `'verbatim'` | `'spoken'` (`index.ts:78`) | `index.ts:78` | 8 · `speakFilePaths` (`index.ts:309-360`) |
| `extensionStyle` | `ExtensionStyle` (`index.ts:18`) | `'word-last'` · `'word-first'` · `'raw-last'` · `'omit'` | `'word-last'` (`index.ts:88`) | `index.ts:88` | 8 · `speakFilePaths` (`index.ts:349-358`) |
| `expandNumbers` | `boolean` | `true` · `false` | `true` (`index.ts:79`) | `index.ts:79` | 12 · `expandUnits` **and** 13 · `expandNumbers` (both gated by `index.ts:92`) |

### Four facts T124 must encode, or the assertion will be green and wrong

**1. `extensionStyle` is dead for two of the three `pathStyle` values.** `speakFilePaths` is not
called at all when `pathStyle === 'verbatim'` (`index.ts:88`), and returns before the
`extensionStyle` switch when `pathStyle === 'terse'` (`index.ts:347`). The 3×4 grid has six
distinct behaviours, not twelve. Verified by probe:

```
{pathStyle:'terse',    extensionStyle:'word-first'}  -> "edit a, in folder src core, now"
{pathStyle:'verbatim', extensionStyle:'omit'}        -> "edit src/core/a.py now"
```

A naive "every field changes the output" test will fail on those combinations. Assert
*reachability from settings*, as T124 words it — not independence of effect.

**2. `expandNumbers` is one flag driving two behaviours.** `index.ts:92` gates `expandUnits` and
`expandNumbers` together, so a listener who wants "52 milliseconds" but numerals rather than words
cannot have it. Probe:

```
'it took 52 ms flat' + {}                     -> "it took fifty two milliseconds flat"
'it took 52 ms flat' + {expandNumbers:false}  -> "it took 52 ms flat"
```

This should become two fields before M12 freezes the schema.

**3. `NormalizeOptions` is not the whole tunable surface, so it is the wrong target for T124
alone.** Two other option types carry listener-facing settings and neither is reachable from the
plugin today:

- `ChunkerOptions` — `maxUnits`, `countUnits`, `isolateFirstSentence`
  (`packages/core/src/chunker/index.ts:27-34`). `SpeechService` forwards only `maxUnits`
  (`packages/plugin/src/speech-service.ts:112-114`), and `main.ts` never sets it, so
  `isolateFirstSentence` is unreachable from any caller.
- `SynthesizeOptions` — `voice`, `rate`, `signal` (`packages/core/src/types/index.ts:26-31`).
  **`SpeechService` calls `provider.generate(chunk.text)` with no options at all**
  (`speech-service.ts:121`). Voice and rate are therefore not settable by any path through the
  running plugin, even though `OsSynthProvider` implements both
  (`packages/providers/src/os-synth/index.ts:196-218`).

**Recommendation:** T124 should iterate a `SpeechSettings` schema covering all three option types
(matching T120's "settings schema shared by plugin and lab"), not `NormalizeOptions` alone.
Iterating `NormalizeOptions` only would pass today while rate, voice and chunk size stay
unreachable — the check could not have failed on the things most likely to be wrong.

**4. Nothing validates option values at runtime.** `normalize()` uses `??` defaults only
(`index.ts:77-79`); an unknown `pathStyle` string falls through to the `'spoken'` branch and an
unknown `extensionStyle` hits the `default:` case (`index.ts:356`). T123's per-field fallback has
no existing validation to build on.

---

## Q25 — does the Voice Lab need the resident service (M9)?

**Verdict: NO for the decisions M11 exists to settle. M11 must not wait for M9.**
But the lab must **label** three controls as engine-provisional, or the listener will freeze values
that M9 invalidates.

### The argument from what actually differs

Almost every question the lab exists to answer is *which words get emitted*, and `normalize()` is a
pure string→string function with zero imports (`index.ts:1-13`). Its output is identical whatever
speaks it. Every single item in HANDOFF's "What listening taught us that testing could not" table —
omission lead-ins, URL destinations, unit expansion, table headers, path announcement — is a
word-choice decision, settled entirely upstream of the engine. Piper and `say` receive the same
string and the decision transfers unchanged.

Concretely, the normalizer already removes the classic engine-divergence cases before synthesis:
integers and clock times become words (`index.ts:479-519`), units become words
(`index.ts:522-551`), keyboard glyphs become words (`index.ts:554-561`), emoji are deleted
(`index.ts:428-436`). Abbreviation handling is likewise pre-decided in the chunker's own table
(`chunker/index.ts:46-51`) rather than left to the engine. So the brief's worry — "how each
pronounces abbreviations and numbers" — is mostly designed out already.

### Where the two genuinely differ, and what to do about it

**Difference 1 — inter-chunk pauses are a transport artifact today, not prosody.**
`OsSynthProvider` declares `streaming: false` (`os-synth/index.ts:41`) and synthesizes a whole
utterance to a temp WAV before yielding anything (`os-synth/index.ts:120-132`). `SubprocessSink`
then spawns **one player process per chunk** (`sinks/subprocess-sink.ts:70-83`), which its own
header documents as a **~970 ms inter-sentence gap on macOS**
(`sinks/subprocess-sink.ts:8-10`). M9 exists precisely to hold one player open
(`docs/TASKS.md:202-217`).

That gap is roughly an order of magnitude larger than any pause a comma or full stop produces.
Any lab control whose audible effect is *pause length* — chunk size, whether a code-block lead-in
gets its own sentence, how heavily tables are punctuated — is being judged today against a
~970 ms floor that will disappear at M9. **Mark those provisional.**

**Difference 2 — rate is not comparable, and is not plumbed.**
`SynthesizeOptions.rate` maps three different ways: macOS multiplies by 175 wpm
(`os-synth/index.ts:144`), Windows clamps to a −10…+10 SAPI scale (`os-synth/index.ts:150`), and
**Linux ignores `rate` entirely** — `espeak-ng` gets only `-w` and `-v`
(`os-synth/index.ts:161-166`). And none of it reaches the provider anyway
(`speech-service.ts:121`). A rate chosen by ear on macOS `say` is not a number that means anything
on Piper or on another OS. **Rate belongs in the lab as a control, but its value must not be
frozen as a cross-engine default.**

**Difference 3 — the handful of things the normalizer deliberately hands to the engine.**
These are the only word-level decisions that are genuinely engine-dependent:

| Handed off | Where | Why it differs |
|---|---|---|
| Decimals (`3.14`) | `index.ts:501-507` | left verbatim; espeak-ng and Piper read them differently |
| Integers ≥ 1,000,000 or >6 digits | `index.ts:513` | left verbatim, engine's own expansion |
| `#42` | `index.ts:510` | digits passed through |
| Unknown extensions → `dot xyz` | `index.ts:341` | letter-by-letter behaviour varies |
| Anything not in `UNIT_WORDS` / `EXTENSION_WORDS` | `index.ts:40-62` | untouched, engine decides |

These are five narrow cases. They argue for a lab affordance ("this row is engine-dependent"), not
for delaying M11 by an entire milestone.

**Difference 4 — the OS synthesizer is not one thing.** PITFALLS P16: macOS reaches good Apple
voices, Windows is fenced to SAPI 5 desktop voices, Linux is `espeak-ng` formant synthesis. The
lab on the author's macOS box is therefore already testing against the *best* of the three
fallbacks. This cuts the same way as the M9 argument: it is a reason to label voice/rate as
machine-local, not a reason to wait.

### Recommendation

Build M11 now, on `OsSynthProvider`, which `docs/TASKS.md:18` already records as `OS-synth-only`
for v1 (T001c). Gate M11 as written ("change a control, hear the difference in under two seconds",
`docs/TASKS.md:292`). Add one requirement to the lab spec: **each control is tagged
engine-independent or engine-provisional**, and exported settings (T112f) carry the provider id and
platform they were tuned on, so M9 can re-open exactly the three provisional controls rather than
the whole set.

---

## Stage inventory

Fifteen transforms run in `normalize()` (`index.ts:81-94`), not twelve. Three different counts
exist in the repo: `docs/architecture.md:96` says 11, `000-open-questions.md` Q23 says 12, the
in-file banner comments are misnumbered (`index.ts:438` labels the number stages "stage 10";
`index.ts:618-620` labels `collapseWhitespace` "stage 11" while sitting *below* `tidyPunctuation`).
**Fix the count in the docs before the lab renders stage intermediates**, or the UI will disagree
with itself.

| # | Stage | `index.ts` | What it does | Before → after (from tests) | Status |
|---|---|---|---|---|---|
| 1 | `stripFencedCode` | 107 | Fence contents removed; announced or dropped | `Fix it:\n\`\`\`js\nx()\n\`\`\`\nDone.` → `Fix it: Here, a code block is omitted. Done.` (`normalize.test.ts:203-205`) | **configurable** (`codeBlocks`) — but the wording is not |
| 2 | `stripInlineCode` | 133 | Backticks deleted, contents kept | `Call \`foo()\` now` → `Call foo() now` (`test:30`) | hardcoded — **should be configurable** (identifier speech, T180/Q39) |
| 3 | `expandMarkdownLinks` | 154 | `[label](url)` → `label` | `See [the docs](https://example.com) now` → `See the docs now` (`test:39`) | hardcoded — defensible |
| 4 | `stripUrls` | 182 | Bare URL → host phrase | `See https://github.com/YoraiLevi/orca-plugin-tts for details` → `See a link to github dot com for details` (`test:207-208`) | hardcoded — **should be configurable** (path is discarded entirely) |
| 5 | `headingsToPauses` | 218 | ATX heading → its own sentence | `# Results\nAll good` → `Results. All good` (`test:109`) | hardcoded — **should be configurable** (all six levels collapse to one treatment) |
| 6 | `listItemsToSentences` | 237 | Marker dropped, item → sentence | `1. alpha\n2. beta` → `alpha. beta.` (`test:121`) | hardcoded — **should be configurable** (ordinals are lost; a numbered instruction list becomes indistinguishable from bullets) |
| 7 | `tablesToRows` | 253 | Header row announced; every later value paired with its header | `\| Engine \| Latency \|…\| Piper \| fast \|` → `Table. Engine, Latency. Piper. Latency, fast.` (`test:226-228`) | hardcoded — **should be configurable** (header repeats on every cell of every row) |
| 8 | `speakFilePaths` | 309 | Path → announced name, kind, folder | `see src/core/session_handler.py now` → `see file named session handler, python, in folder src core, now` (`test:249-250`) | **configurable** (`pathStyle`, `extensionStyle`) — wording and depth are not |
| 9 | `stripMarkdownMarkers` | 386 | `**`/`~~` deleted; `*`/`_` only as a matched pair; dunders preserved | `in _flush_buffer() now` → unchanged (`test:70`) | hardcoded — defensible (this is the M2 anti-goal gate) |
| 10 | `speakKeyGlyphs` | 554 | Keyboard glyphs → words | `press ⌘⇧S now` → `press command shift S now` (`test:261`) | hardcoded — defensible |
| 11 | `stripEmoji` | 428 | Emoji deleted, silently | `done 🎉 now` → `done now` (`test:80`) | hardcoded — **should be configurable**; see Hidden preferences H18 |
| 12 | `expandUnits` | 522 | Unit after a numeral → word | `it took 52 ms flat` → `it took fifty two milliseconds flat` (`test:216`) | **configurable, but only jointly** with stage 13 |
| 13 | `expandNumbers` | 479 | Integers and `HH:MM` → words | `at 9:05 today` → `at nine oh five today` (`test:92`) | **configurable** (`expandNumbers`) |
| 14 | `collapseWhitespace` | 581 | Runs of whitespace → one space | `a   b\n\n\nc` → `a b c` (`test:100`) | hardcoded — defensible |
| 15 | `tidyPunctuation` | 568 | Collapse doubled terminators from lead-ins | `Fix it:` + placeholder → `Fix it: Here,…` not `Fix it: . Here,…` (`test:203-205`) | hardcoded — defensible |

---

## Hidden preferences

Hardcoded values in the speech path a listener might reasonably want to change.
**Verdict** is one of *unexposed preference* (belongs in the lab), *defensible as fixed*, or *bug*.

| # | What | `path:line` | Current value | Verdict |
|---|---|---|---|---|
| H1 | Code-block announcement wording | `core/src/normalizer/index.ts:73` | `" . Here, a code block is omitted. "` | **unexposed preference** — no language name, no line count; "a 40-line javascript block omitted" may be what the listener wants |
| H2 | Link phrase wording + host-only | `core/src/normalizer/index.ts:172-177` | `"a link to <host with dots spoken>"` | **unexposed preference** — the path is discarded; some listeners want the repo/file |
| H3 | `EXTENSION_WORDS` table | `core/src/normalizer/index.ts:40-47` | 32 fixed extensions | **unexposed preference** — not extendable; a project's own suffixes fall to `dot xyz` (`:341`) |
| H4 | `UNIT_WORDS` table | `core/src/normalizer/index.ts:50-62` | 11 fixed units | **unexposed preference** — same reason |
| H5 | `KEY_GLYPHS` table | `core/src/normalizer/index.ts:65-69` | 12 glyphs | defensible as fixed |
| H6 | Path lead-in words | `core/src/normalizer/index.ts:347-357` | `"file named"`, `"in folder"` | **unexposed preference** — baked into all four `extensionStyle` branches; changing the wording means editing four string literals |
| H7 | Path depth: no limit | `core/src/normalizer/index.ts:342` | every segment spoken | **unexposed preference** — already an open decision (HANDOFF, Q41). Probe: `packages/core/src/normalizer/index.ts` → `"…in folder packages core src normalizer,…"` |
| H8 | Table lead-in word | `core/src/normalizer/index.ts:272` | `"Table."` | **unexposed preference** |
| H9 | Header repeated on every cell of every row | `core/src/normalizer/index.ts:282` | always | **unexposed preference** — correct for a 2-column table, punishing for a 6-column one |
| H10 | First cell spoken without its header | `core/src/normalizer/index.ts:276,284` | always | **unexposed preference** — asymmetry a listener may or may not want |
| H11 | Heading level is discarded | `core/src/normalizer/index.ts:218-227` | `#`…`######` all become a plain sentence | **unexposed preference** — no level cue, no extra pause for `#` |
| H12 | Ordered-list numerals discarded | `core/src/normalizer/index.ts:229-243` | `"1. alpha"` → `"alpha."` | **unexposed preference, arguably a bug** — a numbered procedure loses its numbers |
| H13 | Large-number cutoff | `core/src/normalizer/index.ts:513` | ≥ 1,000,000 or >6 digits → digits | defensible as fixed (engine-dependent by design) |
| H14 | `#42` spoken as digits | `core/src/normalizer/index.ts:510` | always | defensible as fixed |
| H15 | Decimals handed to the engine | `core/src/normalizer/index.ts:501-507` | always | defensible as fixed, but **engine-provisional** (see Q25) |
| H16 | `expandNumbers` gates units too | `core/src/normalizer/index.ts:92` | one flag, two behaviours | **bug in the option shape** — split before M12 freezes the schema |
| H17 | Empty-output threshold | `core/src/normalizer/index.ts:97` | `length <= 1` → `""` | defensible as fixed |
| H18 | Emoji deleted with no announcement | `core/src/normalizer/index.ts:428-436` | always silent | **unexposed preference** — directly contradicts the lesson that produced H1 and H2 ("omissions abrupt, I didn't expect it", HANDOFF). Code blocks and URLs get a lead-in; emoji vanish |
| H19 | Chunk size | `core/src/chunker/index.ts:53` | `DEFAULT_MAX_UNITS = 200` chars | **unexposed preference, high value** — with the ~970 ms per-chunk gap (`plugin/src/sinks/subprocess-sink.ts:8-10`), chunk size *is* the pacing control |
| H20 | `isolateFirstSentence` | `core/src/chunker/index.ts:66` | `true`, and never forwarded | **unexposed preference** — `SpeechService` passes only `maxUnits` (`plugin/src/speech-service.ts:112-114`), so this option is unreachable from the plugin |
| H21 | `ABBREVIATIONS` table | `core/src/chunker/index.ts:46-51` | 30 fixed tokens | defensible as fixed |
| H22 | Queue overflow limit | `plugin/src/main.ts:41` | `maxQueued: 8` | **unexposed preference** — and it disagrees with `DEFAULT_MAX_QUEUED = 20` (`plugin/src/speech-service.ts:74`); the shipped value is 8 |
| H23 | Overflow-notice coalescing delay | `plugin/src/main.ts:45` | 500 ms | defensible as fixed |
| H24 | Voice and rate are never passed | `plugin/src/speech-service.ts:121` | `generate(chunk.text)`, no options | **the single largest gap** — `SynthesizeOptions.voice`/`.rate` exist (`core/src/types/index.ts:26-31`) and `OsSynthProvider` implements both (`providers/src/os-synth/index.ts:196-218`), but no caller can reach them |
| H25 | Linux ignores `rate` | `providers/src/os-synth/index.ts:161-166` | `-w`, `-v` only | **bug (R1 parity)** — rate is honoured on macOS and Windows, silently dropped on Linux |
| H26 | Rate scale differs per OS | `providers/src/os-synth/index.ts:144,150` | `rate*175` wpm vs. −10…+10 clamp | **unexposed preference + not portable** — one "rate" number does not mean the same thing on two platforms |
| H27 | Output sample rate | `providers/src/os-synth/index.ts:41,142` | 22050 Hz, `LEI16@22050` | defensible as fixed |
| H28 | OS-synth spawn timeout | `providers/src/os-synth/index.ts:32` | 60,000 ms | defensible as fixed |
| H29 | Clipboard cap | `plugin/src/clipboard.ts:63` | 20,000 chars | **unexposed preference** — mild; the truncation is announced (`main.ts:76`) |
| H30 | Clipboard timeout | `plugin/src/clipboard.ts:64` | 20,000 ms | defensible as fixed |
| H31 | Transcript watch window | `plugin/src/huddle/index.ts:42` | `WATCH_WINDOW_MS = 20_000` | defensible as fixed |
| H32 | Transcript debounce | `plugin/src/huddle/index.ts:43` | `DEBOUNCE_MS = 250` | defensible as fixed |
| H33 | Remembered spoken ids | `plugin/src/huddle/index.ts:40` | 300 | defensible as fixed (storage cap, documented) |
| H34 | Ambiguity window | `plugin/src/huddle/index.ts:228` | 2000 ms | defensible as fixed |
| H35 | Session label format | `plugin/src/huddle/index.ts:55-59` | last 3 path segments + 8 hex chars | **unexposed preference, high value** — `"orca-plugin-tts, session 111693de"` is spoken aloud on every switch; eight hex characters read to a dyslexic listener is close to worst-case. Q28 asks exactly this |
| H36 | Announcement wording | `plugin/src/huddle/index.ts:118-119`; `plugin/src/main.ts:110,114,141` | `"Now reading from X."`, `"Huddle mode on."`, `"Stopped following that session."` | **unexposed preference** — all spoken strings are literals |
| H37 | Status sentence assembly | `plugin/src/main.ts:119-127` | fixed order and phrasing | **unexposed preference** |
| H38 | Announcements interrupt | `plugin/src/main.ts:114,127,141` | `'replace'` mode | **unexposed preference** — status/toggle speech cuts off a reply in progress |
| H39 | No explicit pause control anywhere | — | pauses come only from emitted punctuation plus the ~970 ms spawn gap | **unexposed preference** — there is no pause-length knob to expose yet; M11 should decide whether one is added at the normalizer level |

**Count: 39 constants audited · 23 are unexposed preferences (2 of them also bugs) · 1 further
bug (H25) · 15 defensible as fixed.**

### Adversarial notes on our own v1

1. **The strongest listening lesson is applied inconsistently.** "Omissions were abrupt, I didn't
   expect it" produced a lead-in for code blocks (H1) and a destination for URLs (H2) — and emoji
   still vanish with no signal at all (H18). Same class of loss, opposite treatment.
2. **Ordered lists lose their ordinals** (H12). For an assistive tool whose main input is agent
   replies full of numbered procedures, "alpha. beta." for "1. alpha 2. beta" is a real
   comprehension loss, not a taste question.
3. **The two settings a listener asks for first — voice and speed — have no wire** (H24). This is
   larger than any normalizer question and should be in M11's scope, or M11 will settle word
   choices while the loudest complaint stays unfixable.
4. **`packages/core/dist/` is committed and stale.** It is tracked (`git ls-files
   packages/core/dist`), not gitignored, and last written at `9627118` — two normalizer commits
   ago. `packages/core/dist/normalizer/index.js:304-305` still emits the *old* path wording <!-- citation-check: ignore -->
   (`"the python file session handler"`) and has no `extensionStyle` at all. The shipped artifact
   is safe — `packages/core/package.json` points `main` at `./src/index.ts` and
   `scripts/build.mjs:24` bundles from `packages/plugin/src/main.ts` — but **T111's
   `scripts/voice-lab.mjs` is a plain `.mjs` server**, and if it imports the built JS rather than
   the TypeScript source, the lab will tune a normalizer two commits behind the one that ships.
   Probe, same input, two module paths:
   ```
   dist: "see the typescript file index, in packages core src normalizer, now"
   src : "see file named index, typescript, in folder packages core src normalizer, now"
   ```
   Delete `packages/core/dist/` from the index and gitignore it before M11 starts.

---

## Test baseline

`pnpm test` → `vitest run` (`package.json:8`). Run 2026-08-21 on this machine.

```
 Test Files  11 passed (11)
      Tests  145 passed (145)
   Duration  8.00s
```

**145 tests, all passing, zero failures.** This matches HANDOFF's recorded count of 145.

| File | Tests |
|---|---|
| `packages/core/src/normalizer/normalize.test.ts` | 73 |
| `packages/core/src/chunker/chunker.test.ts` | 21 |
| `packages/providers/src/os-synth/os-synth.test.ts` | 10 |
| `packages/plugin/src/adapter/adapter.test.ts` | 9 |
| `packages/plugin/src/huddle/decoders.test.ts` | 7 |
| `packages/plugin/src/speech-service.test.ts` | 7 |
| `packages/plugin/src/manifest/manifest.test.ts` | 6 |
| `packages/plugin/src/clipboard.test.ts` | 4 |
| `packages/core/src/queue/queue.test.ts` | 3 |
| `packages/providers/src/registry.test.ts` | 3 |
| `packages/plugin/src/manifest/keybindings.test.ts` | 2 |

Two measurements printed by the suite, both real:
`OsSynthProvider: cancel -> stopped in 0 ms` and `OsSynthProvider cancel -> return: 1 ms`.
The os-synth file takes 7.66 s of the 8.00 s total — it spawns real `say` processes, which is why
it is the only slow file and why T114 specifies headless CI runs normalize-only.
