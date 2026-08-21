# 018 — Round 9: the seam contracts, built

**Status:** build record, not a review record. **Written:** 2026-08-21.
**Repo state:** `42b9a28` plus a live working tree — J24 was editing
`packages/providers/src/os-synth/**` throughout (fixing R8-04) and J21 the normalizer. Nothing in
this round touched either. Citations into them are stamped `[live tree]`.
**Scope:** round 8's own instruction — *"rounds 9 and 10 do not re-read anything; they build `006`
section 22 and write the tests that let each row go red."* This is that, executed.

**Deliverables:** `006` section 22 (nine seam rows, three asked-and-empty, two covered elsewhere),
three new test files, **616 tests green**, and a mutation log in section 4 in which **every row was
seen red**.

**Round 9 is not dry. 6 items clear the ledger bar** — a quarter of round 8's 24. Section 6 argues
that the drop is a real signal rather than a slow round, and says what would confirm it.

---

## 1. What was built

| Row | Seam | Test | Status |
|---|---|---|---|
| SC-1 | `normalize()` → `Chunker` — output is empty or speakable | `packages/core/src/seams/seam-contracts.test.ts` | **OPEN** (R8-07) |
| SC-2 | `Chunker` → provider — every chunk carries a speakable glyph | same | **OPEN** (R8-08) |
| SC-3 | `Chunker` → the engine's **argv** — no chunk parses as an option | same | **OPEN** (R8-04) |
| SC-4 | `normalize()` → `Chunker` — the chunker returns what it was given | same | **closed** |
| SC-5 | `normalize()` → `Chunker` — streaming equals batch | same | **closed** |
| SC-6 | `normalize()` → the listener — a written number is heard as that number | same | **partly OPEN** (R8-20, R8-21) |
| SC-7 | control map → stages — a ladder row names the transform it ran | `scripts/seam-stage-identity.test.mjs` | **closed** |
| SC-8 | control map → stages — a control moves the stage it claims | same | **partly OPEN** (NM12) |
| SC-9 | provider → sink — the sink handles every declared format | `packages/plugin/src/seams/sink-format.test.ts` | **OPEN** (R9-05, R9-06) |

**Three seams were asked and came back empty or unclosable**, and are recorded as such in section
22.2 rather than left blank: host text → `normalize()` (nothing the host can emit that it cannot
accept); `PlaybackSink` → the audio **device** (not observable from userland without a loopback
capture device — the same limit `m11-gate.md` section 1 records); and settings → options, which
`packages/core/src/settings/reachability.test.ts` T124 (c) **already covers by effect** and did
before this round. A row that was asked and yielded nothing is a result; a row that was skipped is a
gap wearing the same face.

**Two conventions, both load-bearing.** The downstream requirement is **restated** in every test,
never imported (P36) — a seam test that imported the far side's own guard would compare it against
itself. And a currently-violated contract is marked **`it.fails`**, not deleted: green today
*because* the contract is broken, **red the moment someone fixes it**, at which point the marker
comes off. Five such rows are live, each naming its finding id, so an open seam defect is visible in
every suite run instead of only in a document.

---

## 2. R9-01 — `006` now has a section whose subject is a seam
**structural** · `006` section 22, R8-01

The finding is the section itself and the rule attached to it: **a row closes only when a test feeds
the upstream component's real output to the downstream one, and that test has been seen red.** The
130 rows above it were all produced by reading a component against its own job, which is why they
are excellent about components and blind between them.

The general form is stated at 22.1 and is the round-8 characterisation as amended by the fourth
witness:

> A cross-component contract expressed in a form that carries no meaning of its own — a character
> count, a punctuation class, a positional integer, a bare argv string — can only be validated by
> comparing it against another copy of itself. That is the one check incapable of detecting an error
> the copies share.

---

## 3. What building the section found

### R9-02 — NM12 is not an option-shape defect, it is a control-map defect, and SC-8 is the first thing that can see it
**S4 → S2 in the Lab** · `voice-lab/lib/controls.mjs` row 24 `[live tree]`, `006` NM12

`006` NM12 records that one flag gates two behaviours: `if (doNumbers) { s = expandUnits(s); s =
expandNumbers(s) }`, so `expandNumbers: false` also disables unit expansion and silently re-breaks
*"52 ms"* — the exact defect the listener asked to have fixed. It is filed as a defect in the
**option shape**.

SC-8 asks a different question — *does a control move the stage it claims?* — and the answer is red,
`[measured-here]`:

```
× num.expandIntegers first moves a stage it claims (NormalizeOptions.expandNumbers)
  → num.expandIntegers claims stages [14], but the option first moved stage 13 (expandUnits)
```

**Why that is a new item and not a restatement.** NM12's listener experience is *"turning off
number-to-words silently re-breaks 52 ms"*. This is the **Voice Lab** experience, which is different
and worse: the listener toggles a control labelled *"Whether numbers become words"*, declared as a
stage-14 control, and the ladder shows **stage 13 changing too** — a row moving for a reason no
control on screen explains. In the tool whose entire purpose is settling taste by ear, an effect
with no visible cause is how a listener concludes the instrument is lying. NM12 had no detection
column that could fire; it has one now.

### R9-03 — A consistently-wrong control→transform binding survives the entire suite. Measured, not argued.
**S4** · R8-26, P37

Round 8 asserted this from reading. Round 9 ran it. **Mutation M5**: move the control
`num.expandUnits` from stage 13 to stage 14, **consistently in all three copies** — the server's
`STAGES[].controlIds`, `voice-lab/lib/controls.mjs`, and its inlined twin in `voice-lab/index.html`.

`[measured-here]`, full suite:

| Indicator | Result |
|---|---|
| `pnpm test` (598 tests at the time) | **green** — the only failures were J24's in-flight `os-synth` edit, unrelated |
| `assertLoadedModuleIsOnDiskSource()` | **PASSED**, 7 probes |
| every stage and control test in `lab.test.mjs` / `voice-lab.test.mjs` | **green** |

Nothing anywhere noticed. The listener would focus a changed word and be sent to a knob that does
not govern it. **This is the R8-26 claim confirmed by effect, and it is the reason SC-8 exists.**

**Honest limit, stated because it bounds the fix.** SC-8 does not catch M5 either, because
`num.expandUnits` has `wire: null` — it is a designed control with no implementation behind it yet.
SC-8 covers the **five** controls that are genuinely wired to a `NormalizeOptions` field. The other
41 controls in `004` section 6 cannot have an effect check until they have an effect. That is not a
gap in the test; it is the shape of a design surface that runs ahead of its implementation, and it
means **section 22's row 9 closes progressively, one control at a time, as each is wired.**

### R9-04 — The stale-citation count went from 91 to 130 in one afternoon, with the ratchet still at 34
**S5 / process** · `.github/workflows/ci.yml:57`, R8-02, R8-03

Measured twice in this session, `[measured-here]`:

| When | Stale | Ratchet |
|---|---|---|
| start of round 9 | **91** | 34 |
| after two peers' code edits, ~one afternoon | **130** | 34 |

The 39 new ones are in `004`, `005`, `010` and `017` — documents nobody edited. They went stale
because `packages/providers/src/os-synth/index.ts` and the normalizer moved underneath them while
J24 and J21 worked, which is P0's failure mode exactly. **None came from `006` section 22**, which
was written this round and is citation-clean; `006`'s own stale count went 66 → 65.

Round 8's R8-03 established that CI is red and `HANDOFF.md:56` says it is green. This adds the
**rate**: at roughly 39 per working afternoon of two agents, the ratchet is not a number anyone can
walk back by hand between rounds. **The instrument needs to run per-commit and fail the commit, or
be re-derived automatically; a ratchet checked only in CI on a branch nobody merges is decoration**
— which is the word its own comment uses.

### R9-05 — The sink collapses every non-`wav` format to `chunk.bin`, silently
**S2 (latent)** · `packages/plugin/src/sinks/subprocess-sink.ts:100`

This round's **one probe asking a question the brief did not**. The brief pointed at the text seams;
the same class of defect sits one layer down, in bytes.

`AudioChunk.format` is a free-form `string` whose own doc comment enumerates the vocabulary — *"e.g.
'wav' | 'pcm-s16le' | 'mp3' | 'opus'"* (`packages/core/src/types/index.ts`). The sink reduces that
vocabulary to one bit:

```ts
const file = join(dir, `chunk.${chunk.format === 'wav' ? 'wav' : 'bin'}`)
```

Everything not `wav` is written to `chunk.bin` and handed to `afplay` / `aplay` / `powershell`,
which identify audio by extension and header. No validation, no refusal, **no announcement**.

**Latent, not live, and the distinction is the whole point.** `OsSynthProvider` declares `'wav'`, so
this seam is currently held closed by there being exactly one provider. `010` plans the resident
Piper service, and a streaming neural provider's natural output is raw PCM rather than a container —
that is `010`'s own argument for it. **The moment a second provider exists, this line decides
whether the listener hears anything**, and the FMA's provider section (6) and queue section (5) both
stop at the boundary without meeting in the middle. `[measured-here]`, removing `.fails`:

```
× names the file after the format for every declared format
  → pcm-s16le: expected '/var/folders/…/chunk.bin' to contain 'pcm'
```

### R9-06 — `bytesPlayed` moves for audio nobody heard, so the self-test can report success on an unplayable format
**S2** · `subprocess-sink.ts:100-106`, `speech-service.ts` `selfTest()`, `006` section 19 rank 1

The sink counts bytes as played whenever the player exits 0. Hand it an `opus` chunk: it writes
`chunk.bin`, the player runs, and on a player that tolerates an unknown file (or any environment
where the exit code is 0 for a reason unrelated to audio) **`bytesPlayed` advances for a file that
produced no sound and no `PlaybackFailure` fires**.

That number is not incidental. `selfTest()` — built specifically as the instrument for `006` section
19's **rank one** undetectable, *"that the plugin is mute"* — reads exactly this counter, and its
doc comment says it reports *"a value that MOVED, not a state that was asserted"*. **A counter that
moves for audio nobody heard is a state asserted while wearing the uniform of a value that moved.**
That is P32's shape landing on the one instrument built to prevent it.

**Resolution.** The sink must know which formats it can play and refuse the rest by name through
`onFailure`, and `bytesPlayed` must advance only for a format it actually handled. Both halves are
pinned by SC-9.

---

## 4. The mutation log — every row seen red

The rule for section 22 is that a row is not closed until its test has failed on purpose. All
mutations were applied to a `cp` backup and restored by `cp`, never `git checkout` (P34).

| # | Mutation | Row it was aimed at | Result |
|---|---|---|---|
| **M1** | `#absorbSpaces` advances `i += 2` | SC-4 | **SURVIVED** — see R9-07 |
| **M1b** | `#drain` slices `cut.index - 1` | SC-4 | **RED** — `expected 'Why the gap is the audio device.Short…' to be '…device. Shor…'` |
| **M2** | `#complete()` forced to return `true` | SC-5 | **RED** — `fixtures/architecture.md: expected [ …(23) ] to deeply equal [ …(23) ]` |
| **M3** | `raw.split(',').join('')` → `raw` (delete thousands-separator handling) | SC-6 | **RED** — `expected 'It took undefined hundred undefined u…' to contain 'one thousand one hundred twelve…'` |
| **M4** | swap the NAMES of stages 13 and 14 in `STAGES`, leaving `apply[]` correct | SC-7 | **RED** — `stage 13 name: expected 'expandNumbers' to be 'expandUnits'` |
| **M5** | move a control between stages, consistently in all three copies | SC-8 | **SURVIVED** (unwired control) — see R9-03 |
| **M6** | re-point `path.style` at stage 10 | SC-8 | **RED** — `path.style claims stages [10], but the option first moved stage 9 (speakFilePaths)` |
| **—** | remove `.fails` from the five open rows | SC-1, SC-2, SC-3, SC-6 | **RED, each naming its own offending input**: `".!!!???"` · `"#!"` · `"--- Heading. "` · `'Call seven now.'` · `'The delta was -forty two milliseconds.'` |
| **—** | remove `.fails` from SC-9's two rows | SC-9 | **RED** — `pcm-s16le` and `an unplayable format was reported as played` |

---

## 5. Two results that do not clear the bar, recorded so they are not re-found

### R9-07 — M1 survived, which bounds SC-4's sensitivity
The first mutation aimed at SC-4 — making `#absorbSpaces` skip two characters at a time — **did not
go red**. SC-4 catches a chunk that loses content (M1b) and does not catch every possible
mis-advance of the boundary scanner. Recorded rather than quietly replaced with the mutation that
worked, because *"the test went red"* means nothing without *"and here is what it did not catch"*.
Not a new item: it is a property of a test written this round.

### R9-08 — Part of R8-26's premise was wrong: the existing suite DOES catch a stage-name swap
Round 8 implied nothing anchored `STAGES[i].name`. **M4 proved otherwise**: alongside SC-7,
`scripts/voice-lab.test.mjs` *"has exactly 16 stages, in the order normalize() calls them"* also
went red, because it restates the name list independently — P36 done correctly, by whoever wrote it.
The boot assertion did pass, as R8-26 said it would.

**So the residual gap is narrower than round 8 stated, and sharper**: names are checked (by that
test), `apply[]` is checked by effect (by the boot assertion), and the **`controlIds` binding is
checked by nothing** — which M5 then confirmed. SC-7 is therefore partly redundant and kept anyway,
because it is an *effect* check where the existing one is a *name* check, and because it is the
thing that will still work when stages carry string ids. Not a new item: a correction to one.

---

## 6. The count, and the honest reading of it

| Item | Bar clause |
|---|---|
| **R9-01** — `006` section 22 exists, with the seen-red rule | 1 (changes how the FMA is organised) |
| **R9-02** — NM12 is a control-map defect with a Lab-specific listener experience, and now has a detection | 3 |
| **R9-03** — a consistently-wrong control binding survives the whole suite, **measured** | 5 |
| **R9-04** — stale citations 91 → 130 in one afternoon; the ratchet cannot be walked back by hand | 5 |
| **R9-05** — the sink collapses every non-`wav` format to `chunk.bin`, silently | 3 |
| **R9-06** — `bytesPlayed` moves for audio nobody heard, so `selfTest()` can report success while mute | 3 |

**6 clear the bar. R9-07 and R9-08 do not**, and are named above so the count can be checked.

**Round 9 is not dry.** But 6 against round 8's 24 is a four-fold drop, and the brief asked for this
to be read honestly in both directions. The honest reading:

- **Round 8's yield came from a method that had never been applied.** Running the pipeline over real
  and hostile input was new, so it harvested a backlog. A backlog is harvested once.
- **Round 9's yield came from building instruments**, and four of its six items are things the
  instruments found *while being built* (R9-02, R9-03, R9-05, R9-06) rather than things the
  instruments caught afterwards. **That is what a converging process looks like from the inside**,
  and it is also what a slowing one looks like. The two are not distinguishable from one round.
- **What would distinguish them is round 10.** Section 22 now exists, with five rows OPEN and a rule
  for closing them. If round 10 extends the inventory to the ORCA-facing seams (sections 1, 2, 8 —
  deliberately out of scope here) and comes back thin, that is a genuine dry signal on the audio
  path. If it comes back thick, the seam method still has a backlog and the counter should not be
  trusted yet.

**Do not read the drop as convergence yet.** Two of this round's six items (R9-05, R9-06) are on a
seam nobody had looked at, found by one probe in ten minutes, on the first layer below the one the
brief named. There is no evidence the layer below *that* has been examined either.

---

## 7. Where the seam inventory still does not reach

- **The ORCA-facing seams** — transcript tailing, the decoder, the adapter — are `006` sections 1, 2
  and 8 and were **not** re-derived. Round 9 was scoped to the audio path. That is the obvious next
  inventory and it is untouched.
- **Seam 7 (sink → device) has no possible instrument** from userland. Named, not solved.
- **Seam 10 (outcome → announcement) is reasoned, not tested** — the one row in section 22 produced
  by the method the section exists to replace, and labelled as such in 22.2.
- **SC-3's requirement is measured on macOS only.** The Linux and Windows halves are `[claimed]`.
  The probes are one line each and need a real box.
- **41 of the Voice Lab's 46 controls cannot have an effect check** because they have no effect yet.
  Section 22 row 9 closes one control at a time, as each is wired.
