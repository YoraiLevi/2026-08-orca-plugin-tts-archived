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
