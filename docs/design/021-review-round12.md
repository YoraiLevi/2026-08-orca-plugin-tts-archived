# 021 — Round 12: the first round with nothing left to open

**Status:** review record. **Written:** 2026-08-21.
**Repo state:** `2380ca7` plus a live working tree shared with seven peers. Nothing here touched
`packages/core/**` (J27), the citation checker (J21), `os-synth` (J24), `.github/workflows/**` or
`scripts/ci/**` (J25), or the flake fixes (J28).

**What this round is.** Round 11 closed the seam inventory — five inventories, all opened, all
yielding on first look — and recommended the experiment this document reports:

> *"Run rounds 12 and 13 with **no new inventory and no new method**. Re-run the existing bar over
> the whole system and see what a round with nothing left to open produces. Dry twice and the counter
> reaches 2 of 3 honestly. **Still yielding, and that is the strongest possible evidence for
> continuing — evidence rather than an argument.**"*

**It yielded.** One item, and it did not come from opening anything. It came from the team lead
noticing that the same suite gave two different answers.

**No timing number is quoted in this document.** The machine is loaded; every duration read today is
noise. What is quoted are pass/fail **sets** and **file counts**, which are not load-dependent.

---

## R12-01 — A fixed sleep is a prediction about how fast the machine is, and the machine is the one part nobody controls
**S5 for the code, S1 for every count in this repo** · nine test files, clauses 3 and 5

### How it surfaced

Two clean detached worktrees, minutes apart, `node_modules` at parity:

| | result |
|---|---|
| J21, clean worktree at `c629b6b` | **657 / 658** — 1 red (SC-14, deliberate) |
| team lead, clean worktree at `0156560` | **653 / 658** — 5 red |

Both honest. **Four of the five reds were not defects**: a load-dependent queue-drain race in
`main.test.ts`, and two `check-citations` rows timing out at 5,000 ms in a file that takes far longer
under load. J28 owns those. The fifth, SC-14, is red on purpose.

**The finding is not the flakes. It is what the flakes mean about every number in this repo.**

> **A suite count taken today means "the machine was quiet", not "the code is correct."**

Eleven rounds of documents quote suite counts. The ledger's dry-round verdicts rest on them. `HANDOFF.md`
quotes one. The counter that is supposed to end this process is calibrated against an instrument whose
answer depends on how many agents happened to be running.

### Why it is a seam row and not a flake report

Same family as SC-15 (the filesystem) and SC-16 (ORCA's host): **the far side is not our code.** Two
predicates for one concept —

> *"has the asynchronous work finished?"*

— answered on the test's side by **a duration** and on the runtime's side by **actual completion**.
On a quiet machine they agree, which is exactly why this survived eleven rounds and a dedicated
test-audit round. It is the section-22 shape with the scheduler on the far side.

**Nine test files wait on a fixed sleep**, `[measured-here]` by source inspection — chosen over
running the suite repeatedly, because repeating it would add load to a loaded machine and corrupt
the very measurement:

```
packages/core/src/queue/queue.test.ts          packages/plugin/src/speech-service.test.ts
packages/plugin/src/adapter/adapter.test.ts    packages/plugin/src/sinks/subprocess-sink.test.ts
packages/plugin/src/huddle/huddle.test.ts      packages/providers/src/os-synth/os-synth.test.ts
packages/plugin/src/main.test.ts               packages/plugin/src/seams/announcement-seam.test.ts  ← mine
                                               packages/plugin/src/seams/tailer-seam.test.ts        ← mine
```

**Two of the nine were this round's own author's**, written in rounds 10 and 11 while documenting
that instruments must be able to fail. They were converted before this document was written; a
finding whose author leaves their own instances standing is not a finding.

### The fix is not a longer sleep

A longer sleep is the same prediction with a bigger margin: slower on every machine, still wrong on a
loaded one. **Wait for the condition, with a generous ceiling as a backstop against a hang.** On a
quiet machine it returns sooner than the sleep did; on a loaded one it returns the right answer
instead of a faster wrong one.

```ts
const until = async (done: () => boolean, ceilingTicks = 600): Promise<void> => {
  for (let i = 0; i < ceilingTicks; i++) { if (done()) return; await new Promise((r) => setTimeout(r, 5)) }
}
```

**One honest exception, stated so nobody "fixes" it into uselessness.** SC-15 probes whether the
filesystem emits an event **at all**; there is no condition to wait on, and waiting for *"an event
arrived"* would make its negative case unfalsifiable. Its waits are generous so a loaded machine
cannot produce a false negative. **An exception that is stated is a decision; an exception that is
silent is this defect.**

### The instrument

**SC-17**, in `packages/plugin/src/seams/tailer-seam.test.ts`. It carries a **control** that runs
first: the detector must fire on the pattern and must **not** fire on the condition-based
replacement, so a detector that had stopped working — or one that flagged the fix as the defect —
cannot deliver a verdict. The offender list is restated rather than derived (P36); the row comes
off `it.fails` when it is empty. **Do not remove an entry by adding an exception comment. Remove it
by waiting on a condition.**

---

## What this round means for the counter

**Round 12 is not dry. 1 item clears the bar.**

**Excluded and named:** the four flakes themselves are J28's to fix and are symptoms of R12-01, not
separate items. SC-14's red is deliberate and was already counted as R10-06.

**Provenance:** reported by the team lead from a count discrepancy between two worktrees; the
structural reading, the nine-file census, the fix of this author's own two instances, and the
instrument are this round's.

### The experiment answered its own question

Round 11 set this up in advance, and the answer is unambiguous:

| Round | Items | Inventory opened |
|---|---|---|
| 8 | 26 | — (first execution) |
| 9 | 7 | the audio path |
| 10 | 7 | the decoder, the build-time contract |
| 11 | 2 | the tailer, the adapter |
| **12** | **1** | **none — there was nothing left to open** |

**A round with no new inventory and no new method still yielded**, and what it yielded is a defect
that invalidates the measuring instrument the whole protocol is calibrated against. That is the
outcome round 11 named as *"the strongest possible evidence that the process should continue — and
unlike every previous round, it would be evidence rather than an argument."*

**It is also thin, and this record will not dress it up.** One item is one item. The curve is
26 → 7 → 7 → 2 → 1 and it is bending hard.

**Recommendation for round 13, unchanged from round 11's plan:** run it the same way — no new
inventory, no new method — but **not until the suite is deterministic.** R12-01 makes a dry verdict
unreadable: a round that comes back clean on a quiet machine and a round that comes back clean
because nothing was really checked are the same observable, which is the exact confusion `006`
section 0 ranks worst. **Fix the instrument, then run round 13.** If it comes back dry on a
deterministic suite, that verdict means something for the first time in this protocol.
