# Token conservation — are the words spoken the words that were written?

**Closes the cheap 60 % of 006 section 19 rank 5**, the last S1-shaped blind spot in this project.
Written after the code, against a working tree that was green before and after.

Deliverable: `packages/core/src/normalizer/token-conservation.test.ts` (17 tests) and one
one-line fix in `packages/core/src/normalizer/index.ts` that the test found.

**Out of scope, and stated so nobody reads this as the whole fix:** the source→spoken offset map.
Design 003 section 8.4 scopes it and calls it *"larger than the display work it enables"*. It is
not built here and rank 5 is not closed — only its cheap, high-yield half is. What the offset map
would add is named in "What this cannot catch" below.

---

## 1. Why this one and not a louder one

Every other class of defect this project has fixed announces itself eventually: silence, a reply
that stops mid-sentence, the wrong session's words. This one does not, because **a plausible wrong
sentence sounds exactly like a right one.** The listener is dyslexic and voice-first — the audio
*is* the document — and cannot glance at the original to check. That is why 006 section 0 ranks it
S1 while noisier failures rank lower.

It is not hypothetical. Round 7 fixed a transform that **deleted check marks** (006 site 50): a
verdict silently removed, so "✅ done" and "❌ done" reached the listener as the same sentence.
The audit's own note was that this test would have caught it. Section 3 shows it does.

## 2. What the test asserts

For each of the six committed fixtures, **every token of the source must be accounted for in
exactly one of four ways**, and anything else fails by name and by fixture:

| | Way | What is checked |
|---|---|---|
| 1 | **Spoken** | The token appears verbatim in `normalize()`'s output. |
| 2 | **Transformed** | A declared rule maps it to text that must appear — a number to its words, a unit abbreviation to its word, an extension to its kind word, a key glyph to its word. **The mapped text is then checked for**, so a token that vanishes instead of transforming still fails. |
| 3 | **Announced** | It is inside a construct the pipeline replaces with a spoken lead-in, and **the lead-in must be present** in the output. |
| 4 | **Allow-listed** | It is in `REMOVED_TOKENS`, which carries a written reason per entry. |

A token is a run of Unicode **letters** (`\p{L}`, not `[A-Za-z]` — `hostile.md` carries Hebrew and
a Hebrew content word vanishing silently is exactly this failure) or a run of **digits**.

**Glyphs are tokens too**, and that is the half that catches site 50. Every non-ASCII, non-letter,
non-whitespace character is classified, and the ordering is the policy: a **verdict** glyph is
checked *before* the decorative-emoji rule, because `✅` sits squarely inside the emoji code-point
range. If the emoji rule saw it first, deleting a check mark would be permitted forever. That
ordering has its own test.

### The transform tables are restated, not imported

This is the load-bearing decision in the file. Importing `KEY_GLYPHS` from `index.ts` would make
the assertion true by construction: delete a check mark from the table and an imported copy
deletes it here too, green forever. Written out, the two tables are **independent claims** and the
mutation goes red. Same reasoning for the unit and extension tables. This is P33's shape and the
reason `budget-claims.test.ts` parses the prose rather than importing the constant.

## 3. The allow-list, and each rule's reason

The allow-list is the design work, and the whole difficulty of the task. It lives in `POLICY` in
the test file, one entry per rule with its reason written beside it. Summarised:

| rule | disposition | reason |
|---|---|---|
| `spoken` | not a loss | the token is in the output verbatim |
| `transformed:number` | not a loss | an integer is spoken as words; the words are asserted present |
| `transformed:unit` | not a loss | `ms` → "milliseconds"; the listener hears the unit rather than decoding two letters |
| `transformed:extension` | not a loss | `index.ts` → "file named index, typescript"; the raw suffix was reported as *"garbled noise"* |
| `glyph:spoken-word` | not a loss | key glyphs **and verdicts** become words, at least as often as the glyph was written |
| `announced:code-block` | **announced loss** | code read aloud character by character is unusable; the listener is *told* — S3, not S2 |
| `announced:url` | **announced loss** | the **host** is spoken, the scheme and **path** are not; the host is what says where the link goes, and the rule checks the host really arrived |
| `glyph:removed` | **silent loss** | a **decorative** emoji carries no proposition, and *"an emoji was omitted"* is narration, which is its own harm |
| `glyph:passthrough` | not a loss | a mark nothing touches — em dash, box drawing — reaches the engine unchanged, **asserted rather than assumed** |
| `allow-list` | **silent loss** | an explicit token with its own reason |

**Markdown syntax** (`#`, `*`, `|`, backticks, `-`) is not tokenized at all, deliberately and
stated: it is layout, it is removed by design, and tracking it would produce an allow-list of
punctuation that buries the content words. **Content words are never deliberately removed** — a
content word vanishing is a bug, and that is the assertion.

Three of these are judgement calls and each is argued in the file rather than inferred:

- **Emoji** are the only deliberate *silent* removal in the pipeline. 006 flagged the inconsistency
  with code blocks and URLs on purpose; the answer taken here is that a party popper has no
  proposition to lose, while a check mark does — so verdicts are spoken and decoration is not.
- **URL paths** are dropped and the host is spoken. A path read aloud is unusable; the host is the
  part that answers *"where does this link go"*. The rule checks the host survived, so a URL that
  vanishes entirely is still a failure.
- **Box drawing** passes through today, which is design 002's motivating complaint. The rule
  asserts the passthrough, so the day a stage starts stripping it, this test goes red and forces
  the announcement to be **designed** rather than defaulted into silence.

### Why appending to it does not work

`REMOVED_TOKENS` and `POLICY` are both frozen against a reviewed list (`REVIEWED_REMOVED_TOKENS`,
`REVIEWED_POLICY_IDS`) and the assertion **prints the delta** — what was added, what was dropped —
with a message saying so. Adding a way for content to leave the pipeline therefore takes two edits
in the same commit, and shows up in the diff as a decision rather than as a longer list. A third
test rejects any entry whose reason is under 60 characters, because a reason too short to be an
argument is a shrug. The file says in its own header that appending without a reason converts a
check that *can* fail into one that cannot — which is the failure mode two rounds of this project
were spent removing.

**`REMOVED_TOKENS` is empty, and that is the finding**: across all six fixtures every single loss
is explained by a named rule. Nothing needed a bespoke exemption.

## 4. Proof it can fail

Three mutations, each applied to a scratch copy of `index.ts` (`cp` to `/tmp`, `cp` back — never
`git checkout`, P34) and each reverted. Verbatim output:

**Mutant 1 — the check-mark defect this round just fixed, reintroduced.** The verdict glyphs are
deleted from `KEY_GLYPHS`, so `stripEmoji` swallows them again exactly as at site 50:

```
   × token conservation … > hostile.md loses no glyph without a reason
   × token conservation … > a verdict glyph is never absorbed by the decorative-emoji rule
AssertionError: hostile.md: GLYPHS lost with no accounting: expected [ …(2) ] to deeply equal []
+   "U+2705 ✅ — glyph:spoken-word: written 1x, expected \"yes\" at least 1x, heard 0x",
+   "U+26A0 ⚠ — glyph:spoken-word: written 1x, expected \"warning\" at least 1x, heard 0x",
      Tests  4 failed | 120 passed (124)
```

The audit's claim was that this test would have caught site 50. It does, and it says which glyph,
how often it was written, and how often it was heard.

**Mutant 2 — the letter-glued-numeral guard removed** (the defect the test itself found, section 5):

```
   × … architecture.md / code-heavy.md / hostile.md / paths.md / short.md / tables.md
+   "t — unaccounted: lost with no rule and no allow-list entry",
+   "p — unaccounted: lost with no rule and no allow-list entry",
+   "22 — unaccounted: lost with no rule and no allow-list entry",
+   "110 — unaccounted: lost with no rule and no allow-list entry",
      Tests  7 failed
```

All six fixtures, because the defect was everywhere.

**Mutant 3 — `speakFilePaths` drops the containing folder** (`in folder src core` → `in a folder`):

```
   × … paths.md loses no token without a reason
+   "normalizer", "scripts", "docs", "plugin", "sinks", "providers",
+   "models", "piper", "fixtures", "github", "workflows"
      Tests  2 failed | 15 passed (17)
```

Eleven directory names silently deleted, named individually.

## 5. What it found across the six fixtures

**One class of real loss, present in all six fixtures, now fixed.**

A digit run **glued to a letter** was expanded as if it were a quantity, and `expandNumbers`
appends the words directly onto the preceding character — so the letter and the numeral were both
destroyed and replaced by a word that was never written:

| written | spoken, before | spoken, after |
|---|---|---|
| `p50` | *"pfifty"* | *"p50"* |
| `P22` | *"Ptwenty two"* | *"P22"* |
| `T110d` | *"Tone hundred tend"* | *"T110d"* |
| `P15` | *"Pfifteen"* | *"P15"* |

This is the S1 shape precisely: not silence, not a gap — a confident, plausible, wrong word. A
listener hearing *"Ptwenty two"* has no way to recover `P22`, and a pitfall reference, a milestone
id (`M9`), an architecture (`x86`) or a percentile (`p50`) is exactly the kind of token an agent
reply is full of.

The fix is one line in `expandNumbers`, beside the existing `#42` rule which makes the same
judgement for the same reason: **a digit run glued to a letter is a label, not a quantity.**

No other unaccounted loss exists across the corpus. `REMOVED_TOKENS` stayed empty.

## 6. What this cannot catch

Stated plainly, because green here is not proof the words are the words.

1. **Conservation is a set property; it says nothing about sequence.** A token that survives but is
   reordered, re-attached to a different subject, or negated by a lost punctuation mark conserves
   perfectly. *"the tests do not pass"* and *"do the tests pass not"* are the same multiset.
2. **A numeral whose VALUE changes while still expanding to real words.** This is the largest class
   and it is live in current source:

   | written | spoken today | what the listener concludes |
   |---|---|---|
   | `1,112 ms` | *"one, one hundred twelve milliseconds"* | a number 1000× wrong |
   | `2,017` | *"two, seventeen"* | a year became two small numbers |
   | `design 002` | *"design two"* | a label became a quantity |

   Every one of these **passes** the conservation test: `1`→"one", `112`→"one hundred twelve",
   `002`→"two" are all accounted for by `transformed:number`. They were found by *reading the
   output*, not by the test. The cause is that `expandNumbers` treats `,` as a terminator rather
   than a thousands separator, and `Number("002")` silently drops the leading zero. **Not fixed
   here** — they are not losses the test found, and the brief scopes this job to the test plus the
   losses it finds. They are recorded here as the next normalizer fix, and they are the concrete
   argument for the offset map.
3. **Anything downstream of `normalize()`** — chunking, the queue, the synthesizer, the sink.
4. **Whether the spoken form is a *good* reading.** That is taste and P23 says do not argue it in a
   test.
5. **Anything the six fixtures do not contain.** The corpus is the coverage. A construct no fixture
   carries is not asserted about, and the fixtures are owned elsewhere.

Closing 1 and 2 needs the source→spoken offset map. **Rank 5 stays open**, reduced.

## 7. Two things noticed and not acted on

Neither is a conservation failure — both conserve their tokens — and both are outside this job's
paths. Recorded so they are not re-derived.

- **HTML comments are spoken.** All six fixtures open with a `<!-- ... -->` block and `normalize()`
  reads it aloud. Harmless for a fixture; an agent reply containing an HTML comment would have it
  narrated.
- **Box-drawing diagrams are spoken as box characters.** `hostile.md`'s pipeline diagram reaches
  the engine intact — the `glyph:passthrough` rule asserts exactly this, so design 002's fix will
  turn the rule red and force the announcement to be chosen.

## 8. Counts

- Suite: **337 passing before, 354 passing after**, 18 files → 19. The 17 new tests are the whole
  delta.
- **No test plays audio or opens an audio device** (P31): this file imports `normalize` from
  `@orca-tts/core`, which imports nothing at all — not even `node:` builtins.
- `REMOVED_TOKENS`: **0 entries**. `POLICY`: 10 rules, each with a written reason.
- Mutants proven red: 3. They are **not** registered in `scripts/mutation-check.mjs` — that file is
  another agent's this round. Registering mutant 1 there is the recommended follow-up, since it is
  the one that guards a verdict reaching the listener.
