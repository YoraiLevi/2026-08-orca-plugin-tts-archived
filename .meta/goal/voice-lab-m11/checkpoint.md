# Checkpoint

**Updated:** 2026-08-21, after the M11 gate measurement and the G-1 root cause.

## Where I am

Wave 0 and Wave 1 are done. The lab is built and running (127.0.0.1:7311). **The gate is
measured and UNMET** — p95 3,401 ms against 2,000 ms — and the cause is named, not guessed.

**Two Jobs are `running`:** J21-normalizer and J22-server, on disjoint file sets. Do not
re-dispatch either; ask them for status with SendMessage.

## Read first on resume

1. This file.
2. `ledger.md` — see the J20 and G-1 entries at the end. Never redo a `done` Job.
3. `contract.md` — C3 is ticked as an **honest failure**, with the number and the cause. C7 is
   the author's alone and is a legitimate terminal state.
4. `docs/.research/m11-gate.md` section 0 — the evidence.
5. `HANDOFF.md` and `PITFALLS.md` (37 entries).

## The one thing to know

G-1 turned out not to be a lab bug. **The normalizer speaks HTML comments aloud**, which is why
every fixture 503s — and it has been doing that in v1, in the author's ears, all along. The lab
found a shipping defect the first time it was pointed at real files. That is the lab justifying
its own cost.

## Immediately next, when J21 and J22 report

- Re-run the gate with the same harness. New p95 next to 3,401 ms, or it did not happen.
- Then C6: **the Voice Lab CI job has never executed.** CI that has never run is a claim, not a
  check. Do not tick C6 until a real 3-OS run is green.
- Then rounds 8-10 of the review protocol. Dry counter is **0 of 3**. Round 7 named where to
  look: `PLAN.md`, `TASKS.md`, the constitution's budget table, `006-fma.md` — not `002`-`005`,
  which have converged.
- SPIKE-3, the held-device probe (T088), is what M9a's measurement is blocked on.

## Standing invariants after every Job

`pnpm test` green with the count reported (baseline 549) · no test plays audio, the author is at
this machine (P31) · `PITFALLS` grows only by entries deliberately added (P24) · explicit paths
on every `git add`, never `-A`, while a peer shares the worktree (P34).
