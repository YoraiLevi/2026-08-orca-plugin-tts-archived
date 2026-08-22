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

## BLOCKER discovered 04:20 — in-process agent dispatch is dead

`Agent` spawns fail with **"Could not determine current tmux pane/window"** / **"stale or
unauthorized agent team"**. Cause: `TMUX` points at
`/tmp/orca-claude-agent-teams/team-b52938d6-fc2f-4132-9271-05081ed8a4ea`, and **that directory
does not exist**. Two dispatch attempts failed identically, so it is not transient.

**Agents spawned BEFORE the break are unaffected** — M14-spoken and G8-mutants were created
under the old team and still hold their own processes. Messaging them still works.

**The fallback is ORCA orchestration, and it is available.** `orca orchestration run-list --json`
returns `ok: true`; `task-list` returns `run_required`, meaning it needs a Run bound first:

    orca orchestration run-create ...     # then task-create / worker-start

This is the path the `orchestration` skill documents, it creates real Task/Dispatch provenance,
and it does **not** depend on the tmux agent-team socket. Read the version-matched guide before
using it — `orca skills get orchestration` — and do not guess subcommands; they change between
releases.

**Consequence for the 8-hour plan:** wave 2 (M13 dashboard, M16 huddle presence) cannot be
dispatched in-process. Either bind a Run and dispatch through ORCA, or the architect does the
work directly. Do not silently drop the milestones.

## Dispatch state 04:22 — two mechanisms degraded, work rerouted

**In-process `Agent` dispatch: dead.** `TMUX` names an agent-team directory that does not exist.

**ORCA orchestration: partially working, and it is the route that survived.**
Run **`run_6cacb5c5f4f2`**, coordinator handle `term_197efdbd` (this terminal).

| Task | Gate | State |
|---|---|---|
| `task_1d8cb1712962` | G2, M13 dashboard | **dispatched**, codex worker |
| `task_13b2e15aa4e2` | G5, M16 huddle presence | **failed twice** — `Agent startup blocked: codex-update-prompt` |

`--agent claude` is refused outright: `agent_unconfigured — Agent launcher claude is disabled or
unavailable`. `--agent codex` works, but the codex updater prompt blocks startup after the first
launch, and it blocked both M16 attempts.

**Decision: the architect builds M16 directly.** Two identical failures is a mechanism problem,
and a milestone must not stall on a launcher prompt with the author away until 12:00. This
departs from "the architect orchestrates and never does deep work" deliberately and for a stated
reason — the doctrine exists to keep the architect's context disposable, and that is preserved by
the same discipline it always was: checkpoint before each step, commit continuously, push.

**Still live from the pre-break dispatch:** M14-spoken (normalizer, five-file renumber staged)
and G8-mutants. Both were created before the tmux break and still take messages.

**File ownership while M16 is mine:** `packages/plugin/src/huddle/**` and its tests. M14 holds
`packages/core/src/normalizer/**`, `scripts/voice-lab*`, `voice-lab/**`. M13's codex worker holds
the panel/TUI surface. Disjoint.


## Usage-meter limitation, found at the 2h checkpoint — 2026-08-22 05:57

The ORCA Usage meter read **6% used** on the 5-hour window. It also read 6% at 03:57, two hours
and roughly forty commits earlier, and the weekly figure is unchanged at 39%.

**So the meter is STALE, and a monitor that trusts it would be reporting a number nobody
refreshed.** ORCA has a `Refresh rate limits` button (AX element 62) — the figure updates when
something asks, not continuously. Reading it without pressing that is reading a cache.

This is the same shape as everything else found today: an indicator that looks live and is not.
It would have failed in the most expensive direction — reporting plenty of headroom right up to
the wall.

**Ruling: the wall-clock thresholds are the primary signal**, which is how monitor `bhtn6c2t1`
was already built — it fires at 2h / 3h30m / 4h15m / 4h35m from a recorded window start. The AX
meter is corroboration only, and a reading that has not moved is evidence of staleness rather
than of headroom. Pressing Refresh is a UI interaction with the author's live ORCA and is not
worth it unattended.


## State at 07:30, 3h33m into the window — nine of ten gates

| Gate | State |
|---|---|
| G1 settings round-trip | **met**, verified 349/349 at `9079f27` |
| G2 dashboard | **landed**, M13 via ORCA orchestration |
| G3 diagrams-to-labels | **met**, 405/405, Lab at 17 stages |
| G4 speak-fence | **PARTIAL — the author's.** Needs the D002 Q5 policy as a setting; the design forbids choosing its default outside the Voice Lab |
| G5 huddle presence | **met**, mute proved by effect |
| G6 identity | **met**, checksum oracle with its control |
| G7 M17 re-scope | **met** — the cap blocked M17c, not M17a; M17c moves to *unscored* |
| G8 mutants | **met on macOS 37/37**; Linux 36/37 with one documented gap |
| G9 review protocol | round 13 opened BOTH unopened inventories, 5 items, **counter still 0 of 3** |
| G10 hosted CI | **macOS fully green; all three Voice Lab legs green.** Ubuntu: the one documented mutant. Windows: a real stall, now instrumented to name itself |

**Suite 784/784** at `ba3fccf`, detached worktree, load 10.86, zero leaked `say`.

### The two things that are honestly not done, and why

1. **G4 needs a decision only the listener can make.** Not effort — the design forbids it.
2. **`half-written-line-concluded-on` survives on Linux.** The test goes vacuous there; the
   invariant does not. I attempted a fix (stay truncated across more than one retry interval, so
   the mutant's exhausted budget becomes a structural difference rather than a race macOS happens
   to win) and **reverted it**, because it broke the correct implementation on macOS and there is
   no Linux host here that can run vitest to verify. An honest red beats a green I cannot defend.

### Next, in order

- Read the CI run for the Windows stall — `until` now names its condition instead of timing out
  anonymously, so the failure should identify the stuck wait.
- Round 14: the ledger says rounds 13's items were mostly *broken instruments*, so the protocol is
  now better at finding those than broken code. That is what convergence looks like and is also
  why the counter has not started.
- `docs/USABILITY.md` is written and is what the author should open first.


## WIND-DOWN at 4h16m — clean, and what the next window should do

Tree clean, **0 unpushed**, HEAD `f38779f`, 0 leaked `say`, load 2.71. Nothing was in flight to
rescue: the in-process agents finished hours ago and the ORCA-dispatched M13 worker completed.

### The last hour produced one real product defect and three instrument findings

**PRODUCT — the million ceiling is a live defect on Windows.** SAPI reads `1234567` DIGIT BY
DIGIT: 139,800 B, Δ76,716 from the spelled-out reference, with the probe's own controls green
(`STABLE`, `NOISE` 0 B, `"1000000" === "one million"` PASS) so the verdict is not vacuous. macOS
and espeak-ng both read it as a number. **Q64 named this exact risk** — a platform-specific defect
hiding behind a macOS-only probe — and I called it retired when espeak-ng came back clean. **Two
platforms agreeing is not three.** Left RED deliberately; extending `numberToWords` past 999,999
is the first real job of the next window.

**INSTRUMENTS — three variants of one shape, all mine:**

1. `until` in the seam file **returned silently** at its ceiling, so a condition that never arrived
   produced no error — only a confusing assertion later or an anonymous "Test timed out".
2. Making it throw broke a row that was RIGHT to time out: the runaway detector waits for a thing
   that must never happen, and reaching the ceiling IS its pass. **Two opposite intentions shared
   one spelling.** Now `until` and `watchFor`.
3. The helpers in `main.test.ts` already threw naming the stuck wait — at a 30 s backstop. I set
   the test budget to **30 s as well**, so vitest's anonymous kill won the race every time and
   three CI runs reported nothing useful. **A diagnostic that loses to the timeout it explains is
   not a diagnostic.** 45 s now; the gap is the point.

The checks were all present. None could be heard.

### Corrections to my own earlier claims, so they are not inherited

- **"30 s firing means a hang"** — wrong. Windows was genuinely that slow; the suite passes at
  45 s. The budget was right for a different reason than I gave.
- **"The espeak result retires the ceiling risk"** — wrong, as above.

### First jobs of the next window, in order

1. **Extend `numberToWords` past 999,999.** A live defect on a shipped platform, now measured.
2. `half-written-line-concluded-on` on Linux — the documented gap. My attempted fix is described
   in the ledger; it broke macOS and was reverted.
3. Round 14. The counter is 0 of 3 after thirteen rounds.
4. **G4 is the author's** and blocks M14b: the D002 Q5 policy needs to be chosen in the Voice Lab.
