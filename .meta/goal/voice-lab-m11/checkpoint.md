# Checkpoint

**Updated:** 2026-08-21 17:55 IDT, at a break for the 5-hour usage window. Resumes ~19:43.

## Where I am

**Six of seven contract criteria are resolved**, each ticked against the artefact rather than a
subagent's report. The Voice Lab is up, streaming, and every defect that reached the author's ears
is fixed and verified by effect.

**C3 is the only open criterion**, and it is open honestly: **p95 3,401 ms** against a 2,000 ms
budget. `POST /speak` now streams NDJSON, so the number is stale — but it could not be re-taken,
because the machine reached **load average 51.62** with seven agents running and a control reply
containing nothing unusual took **71 seconds and dropped a chunk**. A measurement there is a
property of the swarm, not the code. **This is the first task on resume.**

## UNCOMMITTED WORK IN THE TREE AT THE BREAK — read before you touch huddle

`packages/plugin/src/huddle/{decoders.ts,index.ts,huddle.test.ts}` are **modified and NOT
committed**, and they are **RED**: 1 of 28 huddle tests failing, `pnpm lint` exit 1. `tsc -b
--force` is clean.

**This was deliberately left uncommitted.** An earlier batch of the same agent's work was preserved
at `20e64cc` after verifying 56/56 green; this later batch is mid-edit and committing it would land
a red on a tree that is otherwise green at `20e64cc` (`lint` 0, `typecheck` 0). Preserving work is
worth a byline, not a broken build.

Most likely **R10-02**: huddle infers a compaction from *"the file got shorter"* instead of reading
the `{"type":"system","subtype":"compact_boundary"}` record ORCA actually writes — a strictly weaker
proxy for a fact that is in the file, guarding a harm the code itself calls unrecoverable.

**On resume:** find the failing test, finish or revert the change, and commit it deliberately.
Do not simply `git checkout` these files — P34's second half records `git checkout`-as-undo
destroying 80 lines here once. Read them first.

## Resume here — the one task waiting on the reset

1. **`uptime` first.** If the load average is not in single digits, do not measure. Say so and wait.
2. Run `scripts/bench-lab-gate.mjs` against a **freshly started** server in a **clean detached
   worktree** at HEAD. Never the shared tree; never a long-lived server process, which serves a
   stale pipeline loaded at boot and yields plausible wrong numbers.
3. **Report two arms.** Per `PITFALLS.md` **P39**, streaming made the cold path ~23x faster and
   collapsed the warm path — p50 39 ms to 3,327 ms — because "audio playing while the request is
   still open" became reachable, so **Stop-then-Play is now a cold path** and the cache commits
   nothing. Both numbers go in the record beside the old 3,401 ms.

## Then

- Collect wind-down status from **J21, J23, J27, J28** and fold into the ledger.
- Check the hosted CI run at HEAD. The Voice Lab job is **green on macOS, Linux and Windows**;
  typecheck and lint were fixed and pushed at `8a33e95`.
- **SC-14 is red on purpose** — `packages/core/src/index.ts` will not load under plain node. J27
  owns the resolver class. Do not make it pass by narrowing what it checks.
- The review protocol continues. **Dry counter 0 of 3 after twelve rounds**; the author's rule is
  ten minimum AND three consecutive dry.

## Open GitHub issues — alternatives catalogued, not discarded

| # | |
|---|---|
| 6 | Reconcile `006` row by row instead of pinning it |
| 7 | Stage identity by name, not position (P37) |
| 8 | Symbol-anchored citations, so drift stops existing |
| 9 | A `pnpm verify` that runs what CI runs, cold |
| 10 | **C7 — the taste defaults. The author's alone; no agent can satisfy it.** |

## The one thing to know

The day found the same defect in **nine costumes**: *a check that cannot fail for the thing it
watches.* A seam contract green after its defect was fixed · a ratchet calibrated in one config and
enforced in another, so seven repairs moved it by zero · `FIXED_BY_DESIGN_STAGES` integers silently
denoting different transforms · vitest resolving `.js`→`.ts` while plain node, the only resolver
that ships, does not · `tsc -b` passing locally on a build cache CI does not have · and a lint gate
that worked perfectly and was simply never run.

**Knowing the failure mode by name did not prevent it.** The architect committed the seventh
instance while writing up the other six. Only running the actual gate caught it.

## Standing invariants

No audio without explicit opt-in — the author is at this machine (P31) · `git commit -- <paths>`,
never stage-then-commit (P34, amended after the rule was followed and still lost a race) · every
number carries `[measured-here]` with a run count, `[documented]` with a citation, or `[claimed]` ·
verify by effect against the artefact, never a report · **do not spawn a large swarm again without
asking** — seven agents cost real accuracy and degraded the author's machine.
