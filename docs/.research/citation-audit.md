# Citation audit — `scripts/check-citations.mjs`

**Written:** 2026-08-21. **Tool:** `pnpm check:citations`. **Wired into:** `.github/workflows/ci.yml`
("Citations must still point at what the documents say they do", Linux job only), `README.md`
"Development".

## Why

PITFALLS **P0** says every claim about ORCA's plugin API cites `path/file.ts:123`. The rule worked —
this repo now holds **1,189 citations**. Round-3 cross-review then found that ~30 of them had gone
stale by 15–150 lines, because implementation commits moved the files *while* the documents were
being written (`docs/design/008-crossreview-round3.md` finding **E-01**).

That is P0's failure mode arriving through the front door. The claims were right; the pointers were
wrong. A reader who follows a stale pointer lands on unrelated code and **cannot tell a stale
pointer from a fabricated one** — which is exactly the distinction P0 exists to protect.

## How staleness is detected, and why this way

A "does line N exist" check could not fail on files thousands of lines long, so it is a presence
check, not a check. Three designs were weighed:

| Option | Why not / why |
|---|---|
| Require an explicit `#symbol` anchor on every citation | Strongest, but it invalidates all 1,189 citations at once; the tool reports red until every document is rewritten, so nobody adopts it |
| Fingerprint each cited line into a lockfile and diff | Goes red on a rename or a reflow that did not invalidate the claim, and the lockfile does not record what the document actually *asserted*, so the human reviewing the diff re-does the work |
| **Infer the anchor from the prose around the citation** | **Chosen** |

These documents already write the anchor. The house style is

> `` `plugin-host-service-bindings.ts:57-59` `` — `` `workspace.readContext` `` maps every terminal…

so the checker reads the backticked spans in the citation's own paragraph (or its own **table
cell** — a row holds several independent claims), keeps only the **strong** ones, and asserts that
the **rarest strong anchor that occurs in the file at all** occurs *inside* the cited span.

- **Strong anchor** = CONSTANT_CASE, camelCase, a dotted member expression, a `#private` or
  `.member` marker, a hyphenated flag or command, or a multi-word literal. Not `version`, `speak`,
  `length`, `plugins` — words that are ordinary English *and* happen to occur in a source file.
  Weak anchors are discarded rather than allowed to turn either colour: letting them go green is
  the check-that-could-not-fail this tool replaces; letting them go red buries real drift in noise.
- **Rarest wins**, and an anchor occurring more than 8 times in the file is dropped entirely. A
  token on every other line proves nothing whether it is inside the span or outside it.
- **Slack is 10 lines**, plus the *block* the anchor opens — a document that cites a line inside a
  function names the function (006 cites `huddle/index.ts:134` and writes `#ensureWatching`,
  declared at 130). Within ~a screen of the claim, the reader still lands on it.

**It can go red, and it does — verified by effect, not asserted.** Rebuild the tree E-01 reviewed
and run the checker on it:

```bash
mkdir /tmp/c && git archive 8666cc0 | tar -x -C /tmp/c
cp scripts/check-citations.mjs /tmp/c/scripts/
git show bb74a5f:docs/design/004-voice-lab.md > /tmp/c/docs/design/004-voice-lab.md
(cd /tmp/c && node scripts/check-citations.mjs)
```

It flags `os-synth/index.ts:132` and `os-synth/index.ts:140-141` — two of E-01's own rows — and
names the lines the `AudioChunk`/`--data-format=LEI16@22050` anchors moved to. The same run against
today's tree passes those two, which is the control: the indicator moves.

### Path resolution

- Repo-relative; the `core/` · `plugin/` · `providers/` shorthands expand to `packages/<pkg>/`.
- Bare filenames (`speech-service.ts`, `os-synth/index.ts`, `plugin-host-api.ts`) resolve by
  path-suffix against `git ls-files` in **both** trees. Several matches are all offered as
  candidates and the anchor decides — a citation is verified if it verifies against any of them.
- The continuation form `` `:211-215` `` (PITFALLS P29 writes `src/espeak-ng.c` once, then cites it
  four times) inherits the path named to its left on the same line, else the previous line's, else
  the section's subject file. All three are offered as candidates.
- Root-level names (`README.md`, `package.json`) exist in every repo; with no ORCA checkout they are
  reported as unresolvable rather than silently bound to ours.

### ORCA

Citations into ORCA are checked against `$ORCA_SRC` (default `/Users/m5air/source/orca`), and the
run prints that checkout's HEAD. Documents pin `87097551f8e98a21c3afa7d457f66d6fd1f94038`; the
checkout is at that commit today, and the script **warns** if it ever differs. With no checkout at
all it prints a NOTICE naming how many citations went unchecked — never a silent green.

### Escape hatches

```
<!-- citation-check: ignore-file -->             skip a document
<!-- citation-check: ignore-begin --> … -end     skip a region
<!-- citation-check: ignore -->                  skip the line it is on
```

Two are in use: 008's **E-01 table**, whose left column is a list of pointers that *were* wrong
(correcting it would delete the finding), and one negative claim in `q-round1-codebase.md` — *"…has
no `extensionStyle` at all"* — which asserts a symbol's **absence** and so can never be anchored.

## Numbers

Measured with the ORCA checkout present, at the end of this session.

| | |
|---|---|
| Citations found | **1,189** |
| into this repo | 583 |
| into ORCA | 487 |
| external (buzz, espeak-ng, speechd — not cloned here) | 119 |
| Verified | **412** |
| Stale at the start of the audit | **150** |
| Stale now | **33** |
| Fixed | **117** |
| Unanchored (the declared blind spot) | 625 |

Without an ORCA checkout — the CI condition — the counts are 226 verified, 34 stale, 323
unanchored, 606 unresolvable-and-announced. CI's ratchet is `--max-stale=34`.

## What is still stale, and why it was left

All 33 are in documents another agent was actively writing during this session, or that analyse code
a third agent was rewriting underneath them.

| Document | Stale | Why it is not fixed here |
|---|---|---|
| `docs/design/006-fma.md` | 26 | A failure-mode analysis of huddle/main/os-synth **as they were before** commits `7387862`…`9cac384` fixed several of the failure modes it describes. Re-pointing the lines would make the pointers land on code that no longer has the defect — a substantive reconciliation, not a citation fix. Owner must re-derive it against a pinned SHA. **See the disclosure below.** |
| `docs/.discussion/003-panel-and-control-channel.md` | 3–5 | Owned by another agent this session; not editable here |
| `docs/design/008-crossreview-round3.md` | 1 | `:186` for `#spoken`, which moved in `393248f` |
| `docs/design/009-reconciliation.md` | 1 | Created by another agent mid-audit |

### Disclosure — 006-fma.md was mechanically edited, and needs a human pass

An early, looser version of the `--fix` pass rewrote roughly 40 citations in `006-fma.md` and 5 in
`008-crossreview-round3.md` before the fixer was tightened. Two of those rewrites were checked and
found **wrong** and were reverted by hand (`sinks/subprocess-sink.ts:8-10` in 008 and
`model-cache-path.ts:46-66` in PITFALLS P8; both original citations were correct and the prose
anchor was the culprit). The remaining rewrites in 006 have **not** been individually verified, and
006 is untracked, so there is no baseline to diff against. **Before 006 is committed, its author
should re-derive its citations against a pinned SHA.** 008's E-01 table was verified intact,
row by row, and is now protected by an ignore marker.

`--fix` is now high-confidence-only: it rewrites a citation only when the anchor occurs **exactly
once** in the file, the citation names its own path (no inheritance), and the path resolves to
exactly one file. Everything else is left for a human, because a wrong "fix" is a fabricated
pointer — the harm this tool exists to prevent.

## Re-audit, 2026-08-21 (J21) — the ratchet is red, and the two runs measure different populations

Everything below was measured on a **clean checkout of `06b060d`** in a detached worktree with
`node_modules` and `dist` symlinked in, not on the shared working tree. That distinction turned out
to matter and is the first finding.

### The readings

| Run | Config | Stale | Ratchet | Verdict |
|---|---|---|---|---|
| Local, before | clean `06b060d`, ORCA resolved | **92** (73 sites) | 34 | red |
| Local, after this pass | same, plus the seven repairs below | **85** (66 sites) | 34 | red |
| CI-equivalent, before | same tree, no ORCA checkout | **98** | 34 | red |
| CI-equivalent, after | same, plus the seven repairs | **98** | 34 | red |

### Finding 1 — the local run and the CI run check partly DISJOINT sets

The seven citations repaired in this pass moved the local count 92 → 85 and the CI count **not at
all**. They are not checked in the CI configuration: without an ORCA checkout the resolver
reclassifies a large block of paths (129 external locally, **644** external without ORCA), and the
`packages/...` citations in `002`, `010` and `017` fall out of scope entirely. The CI run also flags
citations the local run never sees — five in `011-settings.md`, two in `016`, and
`002-agent-spoken-channel.md:613`, which points at another *document*, not at code.

So **`--max-stale=34` was never a threshold on the number this document's "Numbers" table reports.**
That table's 33 was measured with ORCA resolved; the ratchet was calibrated against the ORCA-less CI
run. Two different populations, one number, and a green CI claim on top. Repairing what a local run
shows you can leave CI exactly as red as it was — which is what happened here, measured.

**Recommendation (not implemented):** the checker should print which configuration it ran in and
refuse to compare against a ratchet calibrated in the other one, or the ratchet should be stored per
configuration. Until then, only the ORCA-less number may be compared against `--max-stale`.

### Finding 2 — CI has been red since `42280b6`, and no ratchet was ever raised to hide it

Swept the history with one instrument held fixed (one worktree, one copy of the checker, `git
checkout` between readings). ORCA resolved:

| Commit | Stale sites | What moved |
|---|---|---|
| `5f2a72e` | 63 | — |
| **`42280b6`** `feat(settings)` | **72** | +9 sites. The settings work inserted `NORMALIZE_OPTION_KEYS` and its compile guard near the top of `normalizer/index.ts`, shifting everything below it |
| `42b9a28` | 73 | +1, mine — the million-ceiling comment moved `tidyPunctuation` |
| `06b060d` | 73 | — |

Nobody raised the ratchet, which is the one thing that went right: the number stayed at 34 and the
job stayed red. What went wrong is that `HANDOFF.md` said CI was green for four days
(corrected in `06b060d`) — the indicator was working and the *summary of* the indicator was not.

### Finding 3 — `--fix` is unsafe here, demonstrated rather than asserted

`006-fma.md:51` (row TT1) cites `huddle/index.ts:130` and its prose anchor is
`try { dirs = await readdir(root) } catch { return null }`. The checker cannot see that: it picks the
rarest *strong* anchor in the table cell, which is `#ensureWatching`, and reports "now at
228,250,278,474". Of those, **278 is the declaration and 228, 250 are call sites**. A `--fix` pass
rewrites the citation onto one of them and the row then points at code that has nothing to do with
`readdir`. Green, and wrong — the E-01 failure this tool exists to prevent, reproduced.

### Finding 4 — `006` is stale by REMEDY, not by drift, and that is why it cannot be mechanically fixed

Three rows checked by hand against today's code:

| Row | Claim | Today |
|---|---|---|
| TT1 | bare `catch { return null }` after `readdir(root)`, `:130` | **FIXED.** `huddle/index.ts:485-491` separates `ENOENT` from anything else, logs, and returns a structured reason — which is TT1's own "Instrument:" recommendation |
| TT2 | bare `catch { return [] }` after `readFile(file)`, `:241` | **FIXED.** `:560-568` returns `format: 'unknown'`, routing to the spoken "cannot read this transcript" |
| TT3 | `decodeClaudeLine` `catch { return null }`, `decoders.ts:31` | **STILL PRESENT** at `decoders.ts:49`. Genuine line drift, defect intact |

Re-pointing TT1 to `:485` would make the pointer green while the sentence beside it describes a
defect that is no longer there. **A stale pointer is a navigation problem; a re-pointed pointer on a
remedied defect is a false claim.** The second is worse, and it is what any bulk fix of `006`
produces. Which rows are which cannot be derived from the checker's output — it needs a human
reading each row's claim against today's code, 66 times.

### What was repaired in this pass — seven, all outside the record

Each was verified by reading the target line, not by watching the checker turn green.

| Site | Was | Now | Anchor verified at the new line |
|---|---|---|---|
| `002-agent-spoken-channel.md:54` | `:122-144`, `:96`, `:88` | `:166-195`, `:135`/`:139`, `:122` | `stripFencedCode` 166-195; policy default 135; call 139; `CODE_PLACEHOLDER` 122 |
| `002:296` | `chunker/index.ts:53` | `:72` | `DEFAULT_MAX_UNITS = 200` |
| `002:570` | `:88`, `:96`, `:122-144` | `:122`, `:139`, `:166-195` | same three |
| `010:474` | `types/index.ts:64-69` | `:82-87` | `PlaybackSink` interface body |
| `010:1025` | `types/index.ts:46` | `:64` | `readonly isWarm: boolean` |
| `017:433` | `normalizer/index.ts:674-750` | `:698-774` | `expandNumbers` body |
| `017:461` | `:744` | `:768` | `if (value >= 1_000_000 …` |
| `017:480` | `tidyPunctuation :810` | `:827` | `function tidyPunctuation` |

`017:480`'s **`speakFilePaths` `:519` was left alone.** The checker reported it stale, and it is not:
`:519` is a deliberate pointer *inside* `speakFilePaths` (the same line `017:495` cites), the anchor
declaration at `:498` opens the block containing it, and only the `tidyPunctuation` half of that line
had actually moved. Following the tool there would have replaced a precise pointer with a coarser
one. Recorded because "the checker said so" is not a reason.

### Finding 5 — `[live tree]` is a stamp the machine cannot read

`017-review-round8.md` marks ten citations `` `[live tree]` `` and explains at `:7` that they may have
moved by the time you read them. That is an honest disclosure addressed to a **human**; the checker
does not parse it, so those citations are counted like any other and go stale on the next edit to the
file they point into. This is **P35's exact shape** — an annotation that was present while the
suppression was absent. Either they should carry a real `<!-- citation-check: ignore -->` beside the
prose stamp, or they should be re-anchored and the stamp dropped. All ten were checked by hand in
this pass and all ten now land on the construct they name.

### The decision this pass prepares but does not take

`006`'s exemption is the author's call (round 7 **R7-08**, round 8 **R8-02**). Two things worth
knowing before taking it:

- **The exemption is not implemented.** `006` contains **zero** `citation-check:` markers. What is
  exempt today is `006`'s obligation to carry R006 evidence labels — *not* its citations, which are
  fully counted by CI. Lifting or keeping the documented exemption changes **0** citations by itself.
- **The cost of actually closing `006` is 66 hand judgements**, not a `--fix` run: for each row, does
  the defect still exist (re-point) or has it been remedied (rewrite the row, or pin the document to
  the SHA it reviewed)? Three rows sampled here split 2 remedied / 1 drifted, so expect roughly half.

The two clean options, costed: **pin** `006` to the SHA it analysed and add `ignore-file` — cheap,
honest, and the document stops being a live claim about today's code. Or **reconcile** it row by row
— expensive, and it turns the FMA into a status report rather than a record of what was found. They
are different documents afterwards, which is why it is not a maintenance decision.

### The ratchet was NOT lowered, and CI stays red

The honest floor after this pass is **85** local / **98** CI-equivalent, against a ratchet of 34.
Moving `--max-stale` to 98 would make CI green and make the ratchet decoration, which is the failure
`.github/workflows/ci.yml` already warns about in its own comment. **It is left at 34 and the job is
left red.** The number to beat is 98, and it is 98 because of `006`.

## The instrument, fixed — 2026-08-21 (J21), `e71ff4f` and `1558ecc`

The re-audit above diagnosed the checker; this is what changed in it. Three things, each aimed at
one half of a defect that was measured rather than suspected.

**1. Every run prints its configuration, clean or not.** The tool was quiet when clean, and quiet
was the problem: a bare count carries no evidence of which population produced it, so two runs that
disagree look like progress or regression instead of two different measurements. The line names the
ORCA state and SHA, the threshold and where it came from, and the working tree's condition:

```
config:    orca:87097551f8  ·  threshold 85 (from citation-ratchet.json, calibrated 98309f8)  ·  tree clean
```

**2. The ratchet is per configuration**, in `docs/.research/citation-ratchet.json`, with its reason
and its calibration commit beside it. `--ratchet` reads the entry for the configuration actually
running. A number on the command line is still accepted, but only if it *is* that configuration's
calibrated ratchet — anything else is refused by name:

```
config:    orca:absent  ·  threshold REFUSED  ·  tree clean
REFUSED:   --max-stale=34 is not the ratchet for configuration orca:absent, which is 98.
           34 is recorded as SUPERSEDED: …
           Pass --ratchet instead of a number, so the threshold travels with its configuration…
```

**3. A dirty working tree is reported loudly**, with the offending files named and the pin-it
recipe, because uncommitted edits to files citations point into are usually a peer's in-flight work
and not citation rot.

Seven tests in `scripts/check-citations.test.mjs`, each proved able to fail against four mutants:
deleting the config line (4 red), removing the cross-config refusal (2 red), refusing *every* number
rather than only foreign ones — the CONTROL (1 red), and making `--ratchet` ignore the config
(1 red). They deliberately pin no citation COUNT: that moves whenever anyone edits a source file,
and a test red for that reason would say nothing about the instrument.

## What the ratchet should measure instead — the recommendation, not implemented

Fixing the instrument exposed a second defect underneath it, and this one is the author's to settle
because it changes what the gate *means*.

**A stale citation is two different things wearing one number.**

| | | Moves when |
|---|---|---|
| **DRIFTED** | the anchor is still in the cited file, somewhere else — the claim is intact, the pointer is off | anyone edits a line above a cited one, in bulk |
| **LOST** | the anchor is nowhere in the cited file — renamed, moved or deleted, and the claim itself is in question | somebody makes a decision |

Both are now printed. The current split, measured clean at `1558ecc`:

```
stale is:  129 DRIFTED · 1 LOST      (orca:87097551f8)
           141 DRIFTED · 1 LOST      (orca:absent)
```

**Almost nothing the gate measures is a documentation decision.** And the demonstration is sharper
than the ratio: `4ccfa20` — *fix(os-synth): a reply beginning with `---` lost half of it* — moved the
ORCA-resolved total from **85 to 130 in a single commit, with no documentation changing at all**.
Bisected in a pinned worktree with the instrument held fixed, and controlled: the same tree scored
85 with the old script and 85 with the new one, so the jump is the code, not the change to the
checker.

So the total-count ratchet **punishes whoever fixes a bug in a heavily-cited file and rewards
leaving it alone**, which is backwards, and it currently has **no honest path to green**: raising the
number is decoration, and re-pointing the citations is actively harmful for the 66 in `006-fma`,
which is stale by remedy. A gate whose only exits are "lie" and "make it worse" is the finding.

**Recommendation: ratchet on LOST, report DRIFTED.** `LOST` is churn-invariant, it is 1 today, and a
ratchet of 1 is a real bound that a bug fix cannot break. `DRIFTED` stays visible, and stops being a
gate. The stronger version, if the author wants pointers that do not rot at all, is the one `004`
Panel E already named: **cite a symbol plus the line**, and let the tool resolve the line from the
symbol rather than comparing against it — at which point drift stops existing rather than being
tolerated. That is a larger change and deserves its own Job.

**Left as-is deliberately:** the ratchet is still on the total, and the standing numbers 85 / 98 were
**not** raised to meet the measured 130 / 142. Both are recorded in `citation-ratchet.json` —
`standing` versus `measured` — so the gap is visible instead of resolved by moving a threshold to
fit the number it measures.

## What the checker should have caught and did not — two, one fixed, one bounded

The re-audit found two failures that were not staleness at all: things the instrument was blind to.
The architect asked whether either is fixable in the tool rather than by hand. One is, and now is;
the other is only partly, and the boundary is written down here so nobody spends a day on the rest.

### Fixed — an annotation the parser does not read

**P35, twice over.** `<!-- citation-check: ignore — VERIFIED CORRECT … -->` never parsed, because
the matcher allows nothing between `ignore` and `-->`, so markers written with their reason inside
suppressed nothing while looking like they did — and `--fix` then rewrote a citation `009` E-01 says
explicitly not to touch. Separately, `017-review-round8.md` stamps ten citations `` `[live tree]` ``
and explains at its top that they may have moved; that is an honest disclosure addressed to a
**human**, and this tool had never read it.

Both are now **named on every run**, as `UNREAD ANNOTATIONS`, with the count by kind. They do not
fail the run — whether an unread marker should break the build belongs with the ratchet decision,
not smuggled in beside it — but a tool that silently ignores an annotation somebody wrote *for* it
is the same class of defect it exists to catch.

The exclusion matters as much as the rule. R006's evidence vocabulary — `[measured-here]`,
`[claimed]`, `[derived]` and the rest — is a different and legitimate convention that qualifies a
**number**, not a citation. Without excluding it the check reported **58 hits, 58 of them noise**,
burying the two real ones. That is the weak-anchor mistake in a new costume, and the vocabulary is
restated in the script rather than imported so that adding a word to it shows up in a diff.

### Fixed as far as it can be — the remedied row

`006`'s rows are stale by **remedy**: TT1 quotes `try { dirs = await readdir(root) } catch { return
null }` and that bare catch has since been fixed. Re-pointing it makes the pointer green beside a
sentence describing a defect that no longer exists — a **false claim**, and strictly worse than the
stale pointer it replaces.

**What is not automatable, stated plainly so the next person does not try.** Whether a document's
CLAIM still holds is a question about prose. It needs a human to read the row against today's code.
No amount of anchor cleverness decides it, and a tool that guessed would produce exactly the
plausible-but-wrong verdict this whole file exists to prevent.

**What is automatable, and now is.** When a document quotes a **code fragment verbatim** and that
exact fragment no longer occurs anywhere in the cited file, the citation is stale for a reason no
re-numbering can fix. That is decidable, and it is reported as a separate bucket, **QUOTE-GONE** — a
flag for a human, never a fix:

```
stale is:  133 DRIFTED · 1 LOST · 19 QUOTE-GONE
QUOTE-GONE (19) — the document quotes code verbatim and that exact code is
no longer in the cited file. READ THE ROW; do not re-number it.
  docs/design/006-fma.md:51 -> packages/plugin/src/huddle/index.ts
    gone: `try { dirs = await readdir(root) } catch { return null }`
  docs/design/006-fma.md:52 -> packages/plugin/src/huddle/index.ts
    gone: `try { raw = await readFile(file,'utf8') } catch { return [] }`
```

**Validated against the three rows that motivated it, negative control included:** TT1 and TT2 are
flagged; **TT3 is not**, because the `catch { return null }` it quotes is still in `decoders.ts` — it
is ordinary drift and the tool says so. A rule that fired on all three would have been useless.

Two exclusions carry the weight, and both are tested:
- **An elided quote is never evidence.** `child.on('close', () => { …; resolve(true) })` can never
  match, so treating its absence as deletion is a check that could only go one way.
- **A braced shape that is not a statement is not quoted source.** `200 { played: 'elsewhere' }` is a
  response shape a document invented for the reader; it was never in the file and its absence proves
  nothing.

Fifteen tests in `scripts/check-citations.test.mjs`, every one proved able to fail against eleven
mutants. The four QUOTE-GONE tests run against a **synthetic repository** in a temp directory rather
than this one, because this repo's counts move whenever any of five agents edits a file — and
because a fixture is the only way to state the negative cases at all.

## What this checker cannot catch

Stated plainly, because a tool that hides its blind spots is worse than none.

1. **Unanchored citations — 625 of 1,189.** The prose next to them offers no strong token that
   occurs in the file, so nothing about them is checked beyond the line existing. `--strict` fails
   on them; the fix is to name a symbol next to the citation. This is the largest gap by far.
2. **The end of a range.** `:122-144` is verified by finding the anchor near 122. Nothing checks
   that 144 is still where the construct ends.
3. **A claim that is simply wrong.** The checker verifies that the pointer lands on the named
   symbol. It has no opinion on whether the sentence about that symbol is true.
4. **Negative claims.** *"`X` does not appear here"* is unanchorable by construction.
5. **External repositories** — buzz, espeak-ng, speechd, and ORCA's own docs/README when no
   checkout is present. 119 citations are counted and listed, never silently dropped, but they are
   not verified. Cloning those trees and pointing the resolver at them would close this.
6. **Renames.** A file that moved is reported as unresolvable/external, not as "renamed to X".
7. **A moving tree.** Three agents were committing during this audit and the counts moved under
   every run. The checker reports the state at the moment it runs; that is the point of putting it
   in CI rather than running it once.
