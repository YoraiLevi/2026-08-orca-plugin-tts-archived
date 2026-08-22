---
name: orca-tts-onboarding
description: Read this before touching orca-plugin-tts. Explains what the project is, who it is for, the three memory files, the verification rules that are not optional, and the traps that have cost real time. Use when joining the project, resuming after a break, or before any first commit.
---

# Joining orca-plugin-tts

## What it is, and who decides

A text-to-speech plugin for ORCA that reads AI agent replies aloud. **The author is dyslexic and
voice-first: he LISTENS to replies instead of reading them, and runs several agents at once.**

Rank severity by what the audio stream does, not what the process does. Worst is speech he did not
ask for and cannot stop; next is a plausible wrong sentence he has no way to check. A log he cannot
see is not a report.

**Anything about how something SOUNDS is his call, not yours.** Design the option space, measure
what you can, hand him the choice. Tuning by ear over chat does not converge (P23).

## The three files that are the memory

`STATE.md` · `HANDOFF.md` · `PITFALLS.md` at the repo root, plus `.meta/goal/<slug>/` for an active
goal (`contract.md`, `checkpoint.md`, `ledger.md`). Read the checkpoint FIRST on any resume.
`PITFALLS.md` is 45+ numbered entries and every one already cost someone time.

## The rules that are not optional

1. **Prove every test can fail.** Mutate the code it guards, watch it go red, paste the output,
   revert. This repo has found *fifteen* checks that could not fail, several written by the agent
   auditing the others.
2. **`pnpm check:mutants` NEVER in the shared working tree** (P41). It edits source in place and
   restores in a `finally` — and a `finally` does not run when the process is killed. It has left
   live mutants twice, one of which would have spoken the model's private reasoning aloud. Use
   `git worktree add --detach` + `pnpm install --frozen-lockfile`.
3. **`git commit -- <paths>`**, never `git add -A`, never stage-then-commit (P34). Peers share the
   tree and the index is shared.
4. **Every number carries a label**: `[measured-here]` with a run count, `[documented]` with a
   citation, or `[claimed]`. A count also needs its SHA, its load average, and a leak check —
   the same suite has given 653, 657 and 790 on one machine in one day.
5. **No audio without an explicit opt-in.** `say -o <file>` never opens the device; bare `say`
   does. The author is at this machine.
6. **The hosted CI run is the oracle.** Local green has been wrong repeatedly: a `.ts` specifier
   `tsc -b` rejects but a warm build cache accepts, a lint gate nobody ran, a probe whose two
   signals disagreed.

## The one failure this project keeps finding

**A check that cannot fail for the thing it watches.** Fifteen instances and counting, in every
costume: a seam contract green after its defect was fixed; a ratchet calibrated in one config and
enforced in another; a wait that gave up silently; a backstop starved of the time to speak; a leak
detector that matched its own command line; a mutation harness that discarded the only evidence
that could settle an argument.

**The code is rarely the problem. The instrument usually is.** When something disagrees with your
model of it, go read what the run actually printed before building a theory. Four separate
"verified" claims in one session turned out to be verified against the wrong thing — a stale CI
verdict, a stale usage meter, one test directory instead of the suite, and a Linux container
without the synthesizer CI installs.

## Traps that have already cost time

- **A stale Voice Lab on port 7311** answers your presses with code from hours ago. `EADDRINUSE`
  now explains this; believe it.
- **Usage meters lie.** The ORCA AX meter read 6% across two hours and forty commits. The status
  line has the real figures but renders with ANSI positioning, so `orca terminal read` returns
  fragments. **There is currently no reliable programmatic usage source. Do not build a monitor on
  a guess** — a wrong indicator is worse than none, and one was built and had to be deleted.
- **Old agent terminals hold stale scrollback.** A "session limit" message in one of them may be a
  day old. Cross-check before acting.

## Where the work stands

`docs/USABILITY.md` is what the author opens. `.meta/goal/phase2-m12-m17/contract.md` has the
gates. **The Voice Lab's UI is the current priority and it is a rewrite, not a polish** — see
`docs/design/020-voice-lab-ux.md`.
