# 020 — Round 11: the last two inventories, and the survey is complete

**Status:** build-and-review record. **Written:** 2026-08-21.
**Repo state:** `020a00a` plus a live working tree shared with six peers. Nothing here touched
`packages/core/src/**` (J27's resolver work), `os-synth` (J24), `.github/workflows/**` or
`scripts/ci/**` (J25), or the seam rows J26 is closing.

**Where the numbers came from.** The SC-16 finding is measured against **committed `HEAD` via
`git show`**, and re-proved red in a **detached worktree** — not read from the live tree, which
cannot be trusted for this (a local `pnpm build` masks the defect, and one was run during this
round). **No duration is quoted anywhere in this document**; the machine is loaded and every timing
read today is noise.

**Scope:** round 10's own instruction — open the two inventories that had never been opened: the
transcript **tailer** (`006` section 1) and the **adapter and manifest** (section 8). These are the
two seams whose far side is **not our code**.

**Round 11 is not dry. 2 items clear the ledger bar** — the thinnest round in the protocol, with the
bar fully met. Section 5 says what that does and does not mean, and it is a different position from
round 10's.

---

## 1. R11-01 — A rename-replace kills the watch, emits no error, and the tailer discards the one signal the OS gives
**S2** · `huddle/index.ts`, `006` TT13 and section 19 rank 7, clauses 3 and 5

`huddle/index.ts` subscribes to the watcher's `'error'` event, and the comment there names the exact
scenario:

> *"Site 7: `fs.watch` error events were NOT SUBSCRIBED AT ALL. **A rename-replace write or an inode
> change silently ends the watch**, and one session then goes permanently quiet while every other
> session works (TT13, and 006 section 19 rank 7)."*

**The subscription does not cover that scenario.** Measured, with a control that passes
`[measured-here]`:

| Step | What `fs.watch` did |
|---|---|
| ordinary append | `change` |
| **atomic rename-replace** (`write tmp; rename tmp → file`) | **`rename`** |
| append *after* the replace | **nothing** |
| `'error'` events, whole run | **none** |
| **control** — appends with no replace | fires every time |

So a rename-replace produces **no `error`**, which is the only channel the fix listens on. It
produces a `'rename'` **change** event — the OS does tell us — and the callback is written:

```ts
const w = watch(file, () => { this.#onChange(file) })
```

**`eventType` is discarded in the argument list.** The one signal available is thrown away, and the
watcher then holds a descriptor on a dead inode: silent, forever, for that session only.

**Why this is the tailer's characteristic failure and not an edge case.** A rename-replace is how a
careful writer makes an append atomic, and the far side of this seam is a writer we do not control
and cannot ask. `006` section 19 ranks *"one session goes permanently quiet while every other session
works"* **seventh**, and TT13 is recorded as **closed**. It is not closed; it is closed against the
wrong channel.

**Resolution.** Read the event type. On `'rename'`, re-`stat` the path and re-establish the watch on
the new inode — and if the path is gone, say so, because a transcript that vanished is a fact the
listener needs. **SC-15** pins the filesystem behaviour so the row goes red if node ever changes it,
plus an `it.fails` row on the discarded parameter.

---

## 2. R11-02 — The manifest exists twice, the checks are split across the copies, and the self-test is not shipped
**S2** · `packages/plugin/orca-plugin.json`, `dist/plugin/orca-plugin.json`, `006` section 19 rank 1, clauses 3 and 5

Measured at committed `HEAD` `[measured-here]`, via `git show HEAD:dist/plugin/orca-plugin.json`:

| | commands |
|---|---|
| `packages/plugin/orca-plugin.json` (source) | **9** |
| `dist/plugin/orca-plugin.json` (shipped, **committed**) | **8** |
| missing from the shipped copy | **`read-aloud.self-test`** |

`scripts/build.mjs` merely `cp`s one onto the other, so the shipped manifest is stale whenever the
source changes without a rebuild being committed. **A local `pnpm build` fixes it** — which is why
this cannot be measured in a working tree and is measured at `HEAD` instead.

**The seam is that nothing compares the copies, because the checks are split across them:**

| Check | Reads | Verdict at `HEAD` |
|---|---|---|
| `manifest.test.ts`, `keybindings.test.ts` | the **source** manifest | green — 9 commands, all well-formed |
| CI `scripts/smoke-activate.mjs` | the **dist** manifest | green — 8 declared, and `activate()` registers all 8 |

Both are correct about their own copy. `smoke-activate` asserts *activate registers every declared
command*; registering **more** than the manifest declares is fine, so **a command declared in source
and never shipped passes it silently**. Two copies of one contract, two checks, neither comparing
them. Section 22's shape on the last inventory.

**Why the missing command is the one that matters.** `read-aloud.self-test` is the instrument built
for `006` section 19 **rank one** — *"that the plugin is mute"*, the single thing this system cannot
otherwise detect. It synthesizes a fresh phrase and reports the bytes that actually moved, and its
own doc comment says why it exists: *"every other diagnostic in this system reports healthy on a mute
plugin; this one cannot."*

**So the one command that exists to answer "is the plugin broken, or merely idle?" is the one absent
from the manifest a user installs.** Rank one's instrument was built, tested, and not shipped.

**Resolution.** **SC-16** compares the two copies — commands and keybindings — and names the
self-test separately so the failure says *why* rather than diffing two lists. Longer term the
question is whether a build artifact belongs in the repo at all; that is a decision, not a defect,
and it is the author's.

---

## 3. The mutation log

| Row | Proved red by |
|---|---|
| **SC-15** | the probe **is** the measurement — it asserts what the filesystem actually did, and carries a **control** (appends with no replace must keep firing) that would go red if the harness stopped working |
| **SC-15** `it.fails` row | the discarded `eventType` parameter, which has no runtime trace and is therefore asserted against the source |
| **SC-16** | **red at committed `HEAD` in a detached worktree** — `expected 8 commands to deeply equal 9`, and `expected […] to include 'read-aloud.self-test'`. It passes in a working tree only because a `pnpm build` was run during this round, which is itself the mechanism of the defect |

---

## 4. What the two new inventories did NOT turn up

Recorded as results, so the next reader knows the questions were asked.

- **The manifest→`activate()` binding is sound.** All 9 declared commands are registered and all 9
  registered commands are declared — no dead menu entry, no unreachable command. Checked both
  directions; only the source-to-dist copy drifts.
- **Keybindings agree across both manifest copies**, and `keybindings.test.ts` already covers
  duplicate chords.
- **The tailer's other guards are real.** `NoTranscriptReason` distinguishes three causes and each
  gets its own sentence; `MAX_TRUNCATED_RETRIES` bounds the mid-write re-read; `#highWater` is
  persisted against the worker reap; the ambiguous-pair warning re-arms rather than latching. Every
  one was probed and none yielded. **This is the first inventory where most questions came back
  empty**, and that is worth as much as the two that did not.

---

## 5. The survey is complete, and that changes the question

| Inventory | Opened | Yielded on first look |
|---|---|---|
| the audio path | round 9 | **yes** — 10 rows |
| the transcript decoder | round 10 | **yes** — 2 rows + a census that invalidated a test corpus |
| the normalizer's build-time contract | round 10, by accident | **yes** — 2 rows |
| the transcript **tailer** | **round 11** | **yes** — 1 row |
| the **adapter and manifest** | **round 11** | **yes** — 1 row |

**Five for five. Every inventory has yielded on its first look, including the one where most
questions came back empty.** That was the fact this record used at round 10 to argue against
convergence, and it has now held five times out of five.

**But the argument it supported has expired, and this record should say so rather than repeat
itself.** Round 10's reason for continuing was *"two of five inventories have never been opened."*
**That is no longer true.** The seam method has now been applied to every adjacent pair in the
system, and the endpoint stated in advance — *"open the tailer and the adapter by the same rule, two
more rounds, not an open-ended extension"* — **is met.**

**So the honest position is a decision point, not a recommendation, and it belongs to the author:**

- **Round 11 is not dry** — 2 items, both S2, both live, both seen red. The counter stays at **0 of
  3**.
- **The yield curve is 26 → 7 → 7 → 2.** Round 11 is the thinnest, with the bar fully met.
- **There is no longer a named inventory to open next.** Rounds 12+ cannot repeat this round's
  method; they would need a *different* lens over an already-surveyed system, and this record has no
  evidence about whether that would yield.
- **What this record will not do is invent one to keep the process alive.** Round 8's argument was
  right because it named a specific ungathered class. There is no such class named today, and
  manufacturing one would be exactly the enthusiasm the ledger's bar exists to exclude.

**Recommendation, stated plainly:** run rounds 12 and 13 with **no new inventory and no new method** —
simply re-run the existing bar over the whole system and see what a round with nothing new to open
produces. If those come back dry, the counter reaches 2 of 3 honestly, on a surveyed system, and
round 14 can close the protocol. **If a round with nothing left to open still yields, that is the
strongest possible evidence that the process should continue — and unlike every previous round, it
would be evidence rather than an argument.**

---

## 6. The count

| Item | Clause |
|---|---|
| **R11-01** — a rename-replace kills the watch, emits no `error`, and the tailer discards the `eventType` it is given. TT13 is recorded closed and is closed against the wrong channel | 3, 5 |
| **R11-02** — the manifest exists twice with the checks split across the copies, so the **self-test** — the instrument for the FMA's rank-one undetectable — is declared in source and absent from the shipped manifest | 3, 5 |

**2 clear the bar. Round 11 is not dry.**

**Excluded and named**, so the count can be checked: the completion of the seam inventory (section 5)
is this round's **conclusion**, not a new item — it changes no decision and adds no failure mode, and
counting a round's own summary would be the shape the bar exists to exclude. The four negative
results in section 4 are results, not items.

**Provenance:** both items came from this round's own probing. Unlike rounds 9 and 10, nothing here
arrived from a peer's live work.
