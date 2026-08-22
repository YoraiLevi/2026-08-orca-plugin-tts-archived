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

## The 8-hour run — author away 03:57, returns 12:00

**What "done" means for this run, in his words:** the plugin **completed and waiting to be
tested for usability**, not poked at. He should be able to sit down, use it, and make taste
decisions — not hunt bugs. A deliverable for that is part of the goal: a short **usability
script** naming what to exercise and which decisions are his, so the session starts with
listening rather than triage.

**Window arithmetic.** The 5h window opened 03:57 and ends ~08:57. Wind-down fires 08:12,
hard stop 08:32 (monitor `bhtn6c2t1`). He returns 12:00, roughly 3h into the second window.

| Slot | Work |
|---|---|
| now → 08:12 | wave 1 (M12, M14, G8) lands; wave 2 (M13, M16) dispatched |
| 08:12 → 08:32 | wind down: agents commit, tree verified, checkpoint refreshed, **push** |
| 08:32 → ~09:00 | dead window. Nothing dispatched. **Re-arm the usage monitor for the new window** — the old one exits after HARD-STOP |
| ~09:00 → 11:30 | wave 3: M15 mechanical half, M17 re-scope, review rounds toward three dry |
| 11:30 → 12:00 | final: hosted CI green on 3 OSes, 37/37 mutants, usability script written, everything pushed |

**Compact at wave boundaries only** — the four checks are in `contract.md`. Do not compact
mid-wave; the unrecorded in-flight reports are what a resumed session cannot recover.

**Heartbeat `bqpgw4wyb`** fires every 25 min with load, dirty count, unpushed count and HEAD.
It exists so the run never stalls waiting on something that already finished.

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

## Self-control primitives — investigated 2026-08-22, all shell-accessible

The 5h limit and self-compaction are handled without the author, using ORCA's own tools.
`orca` resolves to `/opt/homebrew/bin/orca`, app v1.4.187, runtime ready.

| Primitive | What it gives |
|---|---|
| `orca terminal read --terminal <h> --json` | **my own live screen.** `result.terminal.tail` is a line list; the status row reads e.g. `Misting… permission2 on · 2 monitors · ← 1 agent` |
| `orca terminal send` | **types into a live terminal, including my own** — this is how earlier compactions were self-assigned. `/compact` can be self-issued rather than waited for |
| `orca terminal wait --for tui-idle --timeout-ms N` | block until an agent terminal is idle, instead of polling |
| `orca terminal list --json` | all 56 terminals with `preview` — one poll scans every worker |
| ORCA Usage meter, via cua AX | the real percentages: `6% used / now` (5h), `39% used / 2d 15h` (weekly) |

**The limit is detectable in plain text, with its reset time.** A terminal that hit it reads:
`⎿ You've hit your session limit · resets 2:20pm (Asia/Jerusalem)`

**Why this matters:** `orca terminal read` is a SHELL command, so a `Monitor` can poll it. That
closes the gap where monitors ran bash but the usage meter was only reachable through an MCP
call, which a monitor cannot make.

### Monitors armed

1. **usage thresholds** (`bhtn6c2t1`) — wakes at 2h, 3h30m, 4h15m wind-down, 4h35m hard stop,
   measured from the window start recorded in the scratchpad. At each wake, read the real AX
   meter rather than trusting the clock: the clock is the alarm, the meter is the evidence.
2. **CI verdicts** (`bybta80yd`) — every hosted run as it completes. Local green was wrong seven
   times in two hours on 2026-08-21; the hosted run is the oracle.
3. **limit signal** (`b5jy39ady`) — greps every terminal's preview for a limit/reset message.

### The residual gap, stated plainly

All monitors die if the Claude process itself exits. Everything is pushed to GitHub
continuously, so nothing is lost — but that single case needs one message from the author.
