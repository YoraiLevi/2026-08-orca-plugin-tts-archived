# Checkpoint — Phase 2

**Updated:** 2026-08-22 03:45, at dispatch of wave 1. Written BEFORE the work, deliberately.

## Where I am

Phase 2 scaffolded and running autonomously. **M11 is complete** (its own goal directory,
7/7 criteria). This goal covers **M12–M17 plus the two protocol gates**, ten boxes in
`contract.md`, all mechanically checkable.

**Wave 1 dispatched — three agents, disjoint file sets:**

| Agent | Gate | Owns |
|---|---|---|
| M12-settings | G1 | `packages/plugin/src/main.ts`, the settings read path |
| M14-spoken | G3, G4 | `packages/core/src/normalizer/**`, fixtures |
| G8-mutants | G8 | `speech-service.ts`, queue, sinks, the mutation registry |

M13, M16, M15, M17 are NOT dispatched — they wait on wave 1 landing.

## The dependency that decides ordering

**M15 depends on M16, not the reverse.** M15's gate needs two agents speaking at once, and
huddle locks to one session — which *is* the P22 fix. So M16 unblocks M15.

## Read first on resume

1. This file.
2. `contract.md` — the ten gates and the halt conditions.
3. `HANDOFF.md`, `PITFALLS.md` (P0–P40).
4. `.meta/goal/voice-lab-m11/` — the completed M11 goal, for how the discipline is applied.

## The rule that must not slip

**`node scripts/mutation-check.mjs` after ANY test edit**, count reported. It is 33/37 today.
A previously-killed mutant that starts surviving means something is broken — halt and report.

This is not theoretical. The architect shipped exactly that defect on 2026-08-21: made a
barge-in assertion conditional to fix a false CI failure, the condition was always true on
Linux, and `cancel-late-kill` and `cancel-never-kill` both began surviving silently. The
mutation oracle caught it; the suite did not. **Then** the guard written to prevent a repeat
had the twin fault — it read a flag that cancel itself sets, so it could never pass. A check
that cannot fail and a check that cannot pass are the same mistake facing opposite directions.

## What is handed back to the author, never certified here

- **C7 taste defaults** — a final refinement pass, not a prerequisite. M12's gate tests the
  round-trip MECHANISM, so provisional defaults are fine until then.
- **M15's perceptual half** — whether two voices are tellable apart by ear. The mechanical
  half (measurably different audio, same input) is G6 and is checkable here.
- Anything whose only oracle is hearing it.

## Two constraints the author lifted, and what follows

- **C7 is not a blocker.** I had treated it as one; it is a last refinement.
- **M17's 50 MB cap is gone**, which voids half its recorded blocker. The other half — ORCA's
  STT being main-process only — must be **re-derived from ORCA's source**, not re-asserted.
  Main-process-only may still be reachable via a command rather than a direct call.

## Standing invariants

`git commit -- <paths>`, never stage-then-commit (P34) · counts pinned to a SHA **and a load
average**, in a detached worktree (P40) · every number labelled · no audio without explicit
opt-in (P31) · checkpoint before dispatch · **hosted CI on three OSes is the oracle; local
green was wrong seven times in two hours on 2026-08-21.**
