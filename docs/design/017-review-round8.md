# 017 — Adversarial review, round 8

**Status:** review record. **Written:** 2026-08-21. **Reviewer had no session context** and wrote
none of the documents or code under review.
**Repo state:** `be593f1`, plus a live working tree that two peer agents were editing throughout
(`packages/core/src/normalizer/**` — J21; `scripts/voice-lab.mjs` + `voice-lab/**` — J22). Every
citation into those two paths is stamped **`[live tree]`** and may have moved by the time you read
it; citations elsewhere are at `be593f1`. This is round 7's **R7-13** recurring, and it is recorded
again rather than worked around, because it made two findings in this round harder to state than
they should have been.
**Scope:** the brief's assignment — `PLAN.md`, `TASKS.md`, the constitution's budget table,
`006-fma.md`, and `packages/core/src/**` — plus the seams those documents describe. Per the ledger,
`002`–`005` were **not** re-read.

**What this document is.** The record of what round 8 found. It edits nothing it reviews. Every
performance number carries an R006 label with a run count.

**Round 8 was not dry. 24 items clear the ledger bar** (section 8). But the count is not the point
of this round, and section 1 is.

---

## 1. The blind spot, characterised

The brief's first question was not "what else is broken". It was: *what kind of blindness let three
obvious defects survive 130 enumerated failure modes and seven rounds of review?*

### R8-01 — The FMA is organised by component, and every defect found this round lives between two
**structural** · `006`, and the method every round after this one will use

`006` has fourteen numbered sections and each one is a **module**: the tailer, the decoder, the
normalizer, the chunker, the queue, the provider, the ladder, the adapter, the panel, the TUI, the
lab, settings, identity, the extractor. Section 15 adds nine *cascades*, and those are genuinely
cross-component — but read what they are about: **timing**. C1 is a session ending mid-queue, C2 is
Stop during a swap, C3 is a mid-write settings file, C6 is a cancel racing an utterance. Every one
is *the same data arriving in the wrong order*.

**Not one of the nine is about the same data arriving in the wrong shape.**

That is the gap, and it has a precise name. At every seam in this pipeline, **both sides own a
predicate for the same concept, the two predicates were written independently, and nothing anywhere
checks that they agree.** The FMA reviews each predicate against its own component's job — which it
does very well, hence 130 rows — and never once puts two of them side by side.

Three concepts, three disagreements, all of them live:

| Concept | Normalizer says | Chunker says | Provider says |
|---|---|---|---|
| **"there is nothing to say"** | `s.length <= 1` — a **length** test (`normalizer/index.ts:156` `[live tree]`) | never asks; it emits whatever a boundary rule cut | `text.trim().length === 0` — a **whitespace** test (`os-synth/index.ts:395`) |
| **"a sentence ended"** | — | `!` and `?` end a sentence **unconditionally** (`chunker/index.ts:222`) | — |
| **"a safe argument"** | — | — | macOS: **nothing** (`os-synth/index.ts:439`) · Linux: `--` (`:207`, `:213`) · Windows: `''`-doubling (`:443`) |

Row 1 produces R8-07 and R8-08. Row 3 produces R8-04 and R8-06 — and it is the true cause of
`m11-gate.md` **G-1**, the finding that opened this round.

**Why seven rounds of reading could not see it.** A per-component review asks *"is this component's
rule correct?"* and each of these rules **is** correct for its own component. `s.length <= 1` is a
correct guard against a bare `"."`. `!` really does end a sentence. `args.push(text)` really does
pass the text. The defect is not in any rule; it is in the *space between two rules*, and a document
with one section per component has no page on which that space appears. **The FMA has no section
whose subject is a seam.**

**Why running it found it in five minutes.** Real input crosses the seams; imagined input does not.
Everything in this round came from pointing committed files and hostile strings at the actual
functions and reading what came out the far end — not from reading either function.

**Resolution.** Add **`006` section 22 — Seam contracts**, one row per adjacent pair
(normalizer→chunker, chunker→provider, provider→sink, sink→device), and for each row state the
contract in the form *"what X may emit that Y cannot accept"*. A row is only closed when a **test
feeds X's real output to Y** — not when both sides pass their own unit tests. Round 7 gave the
rounds a map of *which documents* yielded findings; this is a map of *which questions* do.

### R8-02 — 66 of the repo's 91 stale citations are inside `006`, the document exempted from the sweep
**S5 / process** · `006`, R7-08

`pnpm check:citations` at clean `HEAD` in an isolated worktree: **1,773 citations · 467 verified ·
91 stale · 1,086 unanchored** `[measured-here]`, n=2 (live tree and a `git worktree` at `be593f1`,
identical stale count). Grouped by file, the stale ones are:

| File | Stale |
|---|---|
| `docs/design/006-fma.md` | **66** |
| `docs/design/014-review-round7.md` | 13 |
| `docs/design/008-crossreview-round3.md` | 6 |
| `docs/.discussion/002-agent-spoken-channel.md` | 4 |
| `docs/design/010-provider-seam-and-resident-service.md` | 2 |
| `011`, `012`, `013` | **0** |

`HANDOFF.md:129-131` exempts `006` from the R006 sweep on the grounds that it is *"the record"*.
Round 7 disputed that exemption in **R7-08**. This is the measurement that settles it: the document
claiming to be the record is the one whose pointers into the code have drifted most, by 5×. A record
whose `path:line` no longer lands is not a record — it is 66 invitations to re-derive.

**Resolution.** Lift the exemption. `006`'s rows are the highest-value citations in the repo and the
only ones a future round will follow.

### R8-03 — CI is red at `HEAD`, and `HANDOFF.md` says it is green
**S5 / process, blocks-publishing** · `HANDOFF.md:56`, `.github/workflows/ci.yml:51-57`, R5

`ci.yml:57` runs `pnpm check:citations --max-stale=34`. The actual count is **91**. Verified by
effect at clean `HEAD` in an isolated worktree: **exit 1** `[measured-here]`, n=2.

The step's own comment (`ci.yml:51-54`) predicted this exact failure and forbade the usual escape:

> *"`--max-stale` is a RATCHET, not an amnesty. 34 citations are still stale… Lower this number as
> they are re-derived. **It must never go up: raising it is how a checker becomes decoration.**"*

It has gone up **2.7×** without anyone raising it, which is the healthier of the two failures — the
gate really did go red rather than being quietly widened. But `HANDOFF.md:56` states *"CI | green on
macOS, Linux, Windows"*, and R5 makes publishing conditional on CI genuinely passing. **That row is
false, and it is the row a publishing decision would be made on.**

This is also the round's own small proof of R8-01's method: nobody had *run* the gate, so everybody
had inherited the sentence about it.

**Resolution.** Re-derive the stale citations (66 of them are R8-02's), correct `HANDOFF.md:56` to
state the real status, and do not raise the ratchet.

---

## 2. The argv seam — G-1's real cause, still live

### R8-04 — The leading-`-` argv defect is unfixed, and `---` is a commoner trigger than the HTML comment
**S2, blocks-implementation** · `os-synth/index.ts:439` vs `:207`,`:213` · R1

The brief states G-1's root cause as *"the chunker sees `<!` … `say -o file "<!"` exits 0 and writes
nothing"*. **The first half is right and the second half is wrong, and the correction matters.**
Measured on this machine, `[measured-here]` n=6:

```
say -o out.wav --data-format=LEI16@22050 "<!"     → exit 0, 4,332 bytes  (97 ms of near-silence)
say -o out.wav --data-format=LEI16@22050 "--- Heading. " → exit 1, no file
     say: unrecognized option `--- Heading. '
```

`<!` synthesizes fine. What 503'd all six fixtures is the *other* chunk the HTML comment produced —
the one beginning `-->` — and `m11-gate.md` G-1 says exactly this, correctly, at its own line 135.
The operative cause is that **`#command`'s darwin branch appends the text with no `--`
end-of-options separator** (`os-synth/index.ts:439`), while the Linux builder in the same file does
it correctly at `:207` and `:213`.

**Why this is a round-8 finding and not a restatement of G-1.** J21 has landed `stripHtmlComments`
(`normalizer/index.ts:254` `[live tree]`), and with it in place all six fixtures now synthesize
clean — 73 chunks, 0 failures `[measured-here]`, n=1 per fixture, every chunk through the real
`OsSynthProvider`. **That fix removes the only known trigger and leaves the defect completely
intact.** There is a second trigger, and it is more common than an HTML comment in an agent reply:

```
input:  "---\n\n# Heading\n\nBody text here."
normalize() → "--- Heading. Body text here."
chunk 0    → "--- Heading. "                    ← begins with '-'
provider   → OsSynthEmptyOutputError            ← 0 bytes, whole reply lost
```

`[measured-here]`, n=3, `say` exit 1 on all three. A markdown horizontal rule is how agents separate
sections and how YAML frontmatter is delimited. `speech-service.ts:495` turns the throw into
`'synthesis-failed'` and **returns from `#speakOne` immediately** — so the listener hears *"A reply
was cut short: the voice engine failed part way through it"* and **none of the reply**, on macOS
only, on the platform the author uses.

**Resolution.** `args.push('--', text)` in the darwin branch, and a seam test that feeds
`normalize()`'s real output for a leading-`---` reply to `#command` and asserts the text lands after
a `--`. Not a normalizer fix: stripping `---` would close this trigger and leave the third one.

### R8-05 — `#synthesizeToFile` ignores the child's exit code; `#capture`, twenty lines away, checks it
**S2** · `os-synth/index.ts:481` vs `:521`

```ts
// #synthesizeToFile — the synthesis path
child.on('close', () => settle(() => { this.#child = null; resolve() }))      // :481

// #capture — the voice-listing path
child.on('close', (code) => settle(() => {
  if (code === 0) resolve(out)
  else reject(new OsSynthUnavailableError(this.#platform, [cmd]))             // :521
}))
```

The path that produces speech accepts any exit status. The path that lists voices does not. So a
`say` that exits **1** with `say: unrecognized option` resolves normally, `readFile(wav)` then
returns `null`, and the error the listener is eventually told about is
`OsSynthEmptyOutputError(cmd, 'unreadable')` — whose message (`:109`) reads:

> *"say **exited successfully** but its audio file could not be read"*

**That sentence is false about a process that exited 1**, it points at the wrong subsystem (the
filesystem, not the argument vector), and its sibling message at `os-synth/index.ts:108` `wrote no audio` volunteers *"is the disk
full?"*. The real diagnosis is on the child's stderr, which is discarded by `stdio: 'ignore'`
(`:468`). A reviewer chasing R8-04 from the symptom is sent to disk space.

**Resolution.** Check the code in `#synthesizeToFile`, capture stderr, and name a distinct error for
non-zero exit carrying the engine's own words. This is 006 site 43's fix applied one layer lower —
site 43 correctly separated "unreadable" from "empty" and never asked whether the process succeeded.

### R8-06 — Three escaping contracts in one file, no test compares them; this is the R1-parity generator
**S4, structural** · `os-synth/index.ts:434-455`

`#command` has one branch per platform and each invented its own answer to *"how does user text
reach an engine safely?"* — darwin: nothing; win32: double the `'` (`os-synth/index.ts:443`, `replace(/'/g, "''")`); linux: `--` (via
`linuxCommand`). `neutralizeInBandCommands` is applied on all three, which is the one thing that
*was* generalised, and its doc comment explains why in detail. Nothing generalised the rest.

The consequences are a list the FMA already keeps, without noticing they are one item: **NM6**
(Windows paths unspoken — a normalizer branch that only knows `/`), **H25** (rate silently dropped
on Linux, since fixed), **NM14/NM15** (unescaped text on macOS and Windows by two different
mechanisms), and now **R8-04**. Four R1-parity defects, one cause: per-platform branches reviewed
per platform.

**Resolution.** One table-driven test that runs every platform branch over one shared hostile corpus
and asserts a stated property per platform. The corpus is the point — three branches over three
different inputs is what produced this.

---

## 3. "There is nothing to say" — three predicates, three answers

### R8-07 — `normalize()` guards on length where it means speakability, so a punctuation-only reply reaches the engine
**S2** · `normalizer/index.ts:156` `[live tree]`, `speech-service.ts:463`

```ts
return s.length <= 1 ? '' : s          // "." or "," alone would be spoken as "period"
```

The comment states the intent — *do not hand the engine something with nothing in it* — and the code
implements a **character count**. `normalize("...!!!???")` returns `".!!!???"`, length 7, and passes.
`speech-service.ts:463` checks `spoken.length === 0`, so the `'empty'` outcome does not fire, so
`#noteLoss('unspeakable')` does not fire, so **the listener is told nothing** and hears ~800 ms of
provider time produce 97 ms of near-silence (R8-09).

**006 NM1 covers the empty case and only the empty case** — *"a whole reply normalizes to nothing"*,
cause cited as this very line. The non-empty-but-unspeakable case is not in the FMA, and it is
strictly worse than NM1: NM1 at least reaches a code path that could be made to announce itself.

**Resolution.** Replace the length test with a speakability test — `/[\p{L}\p{N}]/u` — and route the
failure to the existing `'empty'` → `unspeakable` loss sentence, which already says the right thing
(`speech-service.ts` `LOSS_SENTENCE.unspeakable`). The instrument exists; only the predicate is
wrong.

### R8-08 — `!` and `?` end a sentence unconditionally, so `<!--`, `#!` and `![alt]` each mint a chunk with no speakable glyph
**S2** · `chunker/index.ts:222`

```ts
if (buf[dot] !== '.') return true              // '!' and '?' are never abbreviations
```

True as written and wrong as a sentence rule. `.` gets six context tests — decimals, abbreviations,
internal periods, list markers, initials. `!` and `?` get none. Measured through `normalize()` then
`Chunker`, `[measured-here]`:

| Input | Chunk 0 | Speakable? |
|---|---|---|
| `<!-- note -->` (pre-J21) | `"<!"` | no |
| `#!/usr/bin/env node` | `"#!"` | no |
| `![alt text](https://x.com/i.png)` | `"!"` | no |
| `...!!!???` | `"."` then `"!!!???"` | no, twice |

A shebang is ordinary content in an agent reply about scripts; a markdown image is ordinary content
in an agent reply about anything. Both are live in the tree today — J21's `stripHtmlComments` closed
the first row only.

**Resolution.** Give `!` and `?` the same treatment `.` has: a terminator that is not preceded by a
letter or digit is not a sentence end. Then a chunk with no speakable glyph should never be minted;
if one is minted anyway, the chunker should refuse to emit it rather than leaving the provider to
discover it — which is the seam contract R8-01 asks for.

### R8-09 — An unspeakable first chunk spends the whole first-audio budget delivering 97 ms of silence
**S4, against R4.2** · `chunker/index.ts` `isolateFirstSentence`, constitution budget table row 1

`[measured-here]`, n=6 per row, real `OsSynthProvider` on this machine, `say -o` only, no device
opened:

| Chunk text | p50 provider time | Bytes | Audio produced |
|---|---|---|---|
| `"#!"` | 736 ms | 4,332 | 97 ms |
| `"!"` | 822 ms | 4,332 | 97 ms |
| `"."` | 840 ms | 4,332 | 97 ms |
| `"<!"` | 747 ms | 4,332 | 97 ms |
| `"Hello world."` (control) | 945 ms | 41,258 | 935 ms |

The control is the point: an **unspeakable** chunk costs 78–89 % of what a real sentence costs, and
returns 10 % of the audio. And it lands on the **first** chunk by construction — `isolateFirstSentence`
exists precisely to isolate chunk 0 for minimum time-to-first-audio, so a reply opening with a
shebang or an image pays ~800 ms of the **< 500 ms** budget (`constitution.md:118`) *before* the real
first sentence is even submitted. Measured first audio for such a reply is therefore ~1.7 s, on a
budget the constitution calls a standing constraint.

**Not in `006`.** CK1–CK5 cover mid-word cuts, chunk size, the unit counter, `no` in the abbreviation
table, and a fixed reachability bug. None asks what a chunk *costs* when it contains nothing.

**Resolution.** R8-07 and R8-08 remove the cause. Independently, the provider's own
`text.trim().length === 0` guard (`os-synth/index.ts:395`) should become the same speakability test as R8-07's, so
the seam has one predicate instead of three.

### R8-10 — The synthesis timeout is 60 seconds, which is 120× the first-audio budget
**S2** · `os-synth/index.ts:44`

`DEFAULT_SPAWN_TIMEOUT_MS = 60_000`, justified in its doc comment by Windows PowerShell blocking on
a headless session (P14) — a real reason for the *Windows* rung.

**Observed once**, `[measured-here]` n=1, **not reproduced** in 24 subsequent identical calls: a
`say` child in this probe run did not close and was killed at the 60-second deadline. I cannot state
a cause and do not. What the incident does establish is what the *budget* means: when `say` stalls
for any reason, the listener sits in **silence for a full minute** and then hears *"A reply was cut
short"*. Against `< 500 ms` first audio, and for a listener whose only channel is the audio stream,
sixty seconds of nothing is indistinguishable from the plugin being dead — which `006` section 19
ranks as the number-one thing this system cannot detect.

006 **site 42** made the timeout *throw* instead of returning silently. It never asked whether 60
seconds is a survivable wait.

**Resolution.** Per-platform deadlines — a few seconds on macOS `say`, generous only on Windows
PowerShell — and a spoken "the voice engine is not responding" at a much earlier mark, so the
silence is announced long before it is abandoned.

---

## 4. Markdown constructs the normalizer does not know

All measured through `normalize()` on the **live tree** (J21's `stripHtmlComments` present), then
through `Chunker`. Each is a distinct cause with a distinct listener experience, so each is a
distinct FMA row.

### R8-11 — Blockquotes keep their `>` and are indistinguishable from the agent's own words
**S1 by section 0's ranking** · no transform exists

`"> quoted line\n> more"` → `"> quoted line > more"`. Two harms, and the second is the serious one.
The `>` glyphs reach the engine as garbage (S4). But an agent quoting the user, quoting a document,
or quoting another agent produces text the listener **cannot tell from the agent's own claim** —
`006` section 0 ranks provenance loss S1, above a crash, because *"the misattribution corrupts the
listener's model of what is happening"*. `#reattribute` in `speech-service.ts` exists to protect
exactly this property at the utterance level; nothing protects it at the sentence level.

**Resolution.** Announce the quote — a lead-in and a lead-out, the same shape the code-block
placeholder already uses.

### R8-12 — `[x]` and `[ ]` reach the listener as the same sentence — site 50, in its markdown form
**S2** · `KEY_GLYPHS` (`normalizer/index.ts:104-118` `[live tree]`)

`"- [ ] do this\n- [x] done that"` → `"[ ] do this. [x] done that."` The project has already fought
and won this exact battle: **006 site 50**, where `stripEmoji` deleted ✅ and ❌ so that *"✅ done"*
and *"❌ done"* became the same sentence, and P36 records the test that now pins it. `KEY_GLYPHS`
maps seven verdict glyphs to `yes`/`no`.

**The markdown checkbox is the same verdict in ASCII, and it is unmapped.** For a listener, "bracket
x" versus "bracket" is at best a subtle difference and at worst inaudible — and a task list is
precisely where the done/not-done bit is the entire content. Agents emit task lists constantly.

**Resolution.** `- [x] ` → `"done, "` and `- [ ] ` → `"not done, "` in `listItemsToSentences`, and
extend `token-conservation.test.ts` in P36's independent-restatement shape.

### R8-13 — A markdown image emits a bare `!` before its alt text
**S4 → S2 via R8-08** · `expandMarkdownLinks` handles `[…](…)` and not `![…](…)`

`"![alt text](https://x.com/i.png)"` → `"!alt text, a link to x dot com,"`. The leading `!` is left
behind because `expandMarkdownLinks` matches from `[`, and it then becomes an unspeakable chunk 0
(R8-08). The listener also gets no signal that an *image* was there rather than a link — the
destination is announced, the fact that it was a picture is not.

**Resolution.** Match `![` first and announce it as an image: *"an image, alt text"*.

### R8-14 — Setext headings are not headings, and the underline is spoken
**S4** · `headingsToPauses` (`normalizer/index.ts:383,386` `[live tree]`)

`if (!t.startsWith('#')) return line` — only ATX headings become pauses.
`"Title\n=====\n\nbody"` → `"Title ===== body"`. The listener gets no structural pause where a
heading was, and hears five equals signs, which the engine will read or mangle. Same for the `---`
underline form, which additionally arms R8-04.

**Resolution.** Recognise the setext forms in the same pass; they are two-line patterns and the pass
still has line structure.

### R8-15 — A nested fence leaks its contents *and* announces the omission twice
**S2** · `isFence` (`normalizer/index.ts:161-164` `[live tree]`)

`isFence` is a `startsWith` test, so it cannot tell a four-backtick fence from the three-backtick
fence inside it. Measured:

```
input:  ````\n```\ncode\n```\n````\nafter
output: "Here, a code block is omitted. code. Here, a code block is omitted. after"
```

The listener is told twice that a code block was omitted, and hears the code anyway, between the two
announcements. Both halves are wrong in opposite directions, which is why this is not NM2: NM2 is an
*unclosed* fence swallowing the remainder, detected and now announced honestly. This is a *closed*
fence whose contents survive while the announcement fires twice. Four-backtick fences are how agents
quote markdown containing code — i.e. how an agent shows you a README.

**Resolution.** Track the opening fence's length and require the closer to be at least as long, as
CommonMark specifies.

### R8-16 — Raw HTML tags and entities reach the engine
**S4** · no transform exists

`'<div class="x">text</div>'` → unchanged. `"a &amp; b &lt;c&gt; &nbsp; done."` → unchanged. Agent
replies contain HTML whenever the subject is a web page, and contain entities whenever markdown has
been round-tripped through HTML. The listener hears attribute syntax read aloud, or hears
`&nbsp;` decoded letter by letter. **NM6's sibling and not in `006`.**

**Resolution.** Strip tags in the same pass as R8-11's blockquote handling; decode the five named
entities plus `&nbsp;` and numeric forms.

### R8-17 — Footnote markers and reference links survive as brackets
**S4** · `expandMarkdownLinks` requires the `](` form

`"See[^1] the note."` → `"See[^one] the note."` — and the `1` is expanded, so the marker becomes
*"bracket caret one bracket"*. `"[label][ref]"` → unchanged, brackets and all.

**Resolution.** Drop footnote markers (they have no spoken meaning inline) and reduce reference
links to their label.

---

## 5. Numbers

J21 fixed the thousands separator during this round — `1,112` now reads *"one thousand one hundred
twelve"*, verified `[measured-here]` against the live tree. The following survive it.

### R8-18 — A hyphenated date is read as three unrelated quantities
**S4** · `expandNumbers` (`normalizer/index.ts:674-750` `[live tree]`)

`"on 2026-08-21 we shipped"` → `"on two thousand twenty six-eight-twenty one we shipped"`. Dates
appear in every changelog, every commit reference and every measurement this project records.

### R8-19 — A version string loses its last component to the decimal rule
**S4** · same

`"v1.2.3 released"` → `"v1.2.three released"`. The `1` is protected by the letter-glued rule, the
`2.3` is caught by the decimal rule, and the tail is expanded anyway. `v1.2.3` and `v1.2.30` become
*"v1.2.three"* and *"v1.2.thirty"* — a listener cannot tell a version from a sentence fragment.

### R8-20 — Leading zeros are silently dropped
**S4, arguably S2** · `Number(digits)` discards them

`"call 007 now"` → `"call seven now"`. Exit codes, zero-padded ids, ticket numbers, and times
written `08:05` in prose all lose digits **with no announcement** — the listener hears a
different number than was written and has no way to know. This is the token-conservation property
`token-conservation.test.ts` exists to defend, in a form it does not test.

### R8-21 — A minus sign is inaudible, so a negative measurement is heard as positive
**S2** · no transform maps `-` before a digit

`"The delta was -42 ms."` → `"The delta was -forty two milliseconds."` The engine will render a bare
hyphen as nothing or as a pause. **A regression of −42 ms and an improvement of 42 ms become the
same sentence**, and this project's entire subject matter is measured deltas.

### R8-22 — Two numbers in one sentence are read in two different systems
**S4** · `if (value >= 1_000_000 || digits.length > 6)` (`normalizer/index.ts:744` `[live tree]`)

`"We processed 1234567 rows and 999999 more."` → `"We processed 1234567 rows and nine hundred ninety
nine thousand nine hundred ninety nine more."` One numeral is handed to the engine, the next is
spelled out, in the same breath. The cutoff is defensible; the **inconsistency inside one sentence**
is what the listener actually notices.

### R8-23 — A colon and a slash between numbers are read raw
**S4** · `spokenTime` rejects out-of-range clocks and nothing catches the remainder

`"at 99:99 sharp"` → `"at ninety nine:ninety nine sharp"`; `"a 16/9 ratio"` → `"a sixteen/nine
ratio"`. The clock path correctly declines a value that is not a time and then leaves the colon in
place. Ratios, scores, dates written `16/9`, and fractions all land here.

---

## 6. Paths

### R8-24 — A dotfile path loses its space, and a reply that opens with one loses its first character
**S4** · `speakFilePaths` (`:519` `[live tree]`) and `tidyPunctuation` (`:810` `[live tree]`)

`".gitignore in src/.eslintrc.json here"` → `"gitignore in file named.eslintrc, JSON, in folder src,
here"`. Two defects:

1. **`"file named.eslintrc"`** — no space. The stem begins with `.`, and the `${...}` join produces
   the words glued to the dot.
2. **The leading `.gitignore` became `gitignore`.** `tidyPunctuation:810` strips a leading `.` from
   the whole utterance — correct for a stray separator left by a placeholder, wrong when the reply
   genuinely begins with a dotfile name. `.gitignore` and `gitignore` are different files.

**Resolution.** Handle a leading dot in the stem explicitly, and make the `tidyPunctuation` strip
conditional on the next character being a space.

### R8-25 — Windows paths are still unspoken (NM6, unresolved; **does not clear the bar**)
`tok.includes('/')` at `:519` `[live tree]` is unchanged, so `C:\Users\me\file.ts` is read as
backslashes and letters. Recorded here only so the next round does not re-find it: **this is `006`
NM6, already on the books, still open.** A restatement, not a new item.

---

## 7. Process results that are not findings

- **`pnpm check:citations` over `011`, `012`, `013`** — the brief's assigned check, never run before.
  **Result: zero stale citations in all three** `[measured-here]`. A clean negative result, recorded
  because an unrun check and a passed check look identical afterwards. Does not clear the bar.
- **All six committed fixtures now synthesize clean** on the live tree — 73 chunks, 0 provider
  failures, 0 near-silent chunks `[measured-here]`, n=1 per fixture. J21's `stripHtmlComments` closed
  G-1's trigger. R8-04 records why that is not the same as closing G-1.
- **`002`–`005` were not opened**, per the ledger's instruction.

---

## 8. The count, and what it means

| Section | Items | Clearing the bar |
|---|---|---|
| 1 — the blind spot | R8-01 … R8-03 | 3 |
| 2 — the argv seam | R8-04 … R8-06 | 3 |
| 3 — "nothing to say" | R8-07 … R8-10 | 4 |
| 4 — markdown constructs | R8-11 … R8-17 | 7 |
| 5 — numbers | R8-18 … R8-23 | 6 |
| 6 — paths | R8-24, R8-25 | 1 (R8-25 is a restatement) |
| 7 — process results | — | 0 |
| **Total** | **25 recorded** | **24** |

By severity, using `006` section 0's ranking:

| | Count | Which |
|---|---|---|
| **S1** | 1 | R8-11 (provenance) |
| **S2** | 9 | R8-04, R8-05, R8-07, R8-08, R8-10, R8-12, R8-15, R8-16, R8-21 |
| **S4** | 12 | R8-06, R8-09, R8-13, R8-14, R8-17, R8-18 … R8-20, R8-22 … R8-24 |
| **S5 / process** | 3 | R8-01, R8-02, R8-03 |

**Blocks implementation: R8-04** (a live, reachable, whole-reply loss on the author's own platform)
and **R8-03** (CI is red, and R5 conditions publishing on it).

**The shape, which matters more than the number.** Twenty-two of the twenty-four came from **running
the code**, not reading it — one probe battery of 45 hostile inputs through `normalize()` → `Chunker`
→ `OsSynthProvider`, plus the six committed fixtures. Two (R8-02, R8-03) came from running an
existing checker that nobody had run. **Zero came from reading a document.** Seven prior rounds read
these documents closely and well; the yield curve on reading has gone flat, and the yield curve on
execution has not started.

**What rounds 9 and 10 should do.** Not more reading. Build the seam-contract section R8-01 names,
and write the tests that make each row of it able to go red — a test that feeds one component's real
output to the next, rather than two components each passing their own. Round 7 said *where* to look;
round 8 says *how*.
