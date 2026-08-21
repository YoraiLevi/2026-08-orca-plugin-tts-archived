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

## The huddle work RESOLVED before the break — this section is kept as history

An earlier revision of this checkpoint warned that `packages/plugin/src/huddle/**` was uncommitted
and **red**. **That is no longer true and the warning is retired**, because a stale warning costs
more than no warning.

The agent landed it at **`03186ea` — "R10-02: read the compaction the transcript states, instead of
inferring it"**: huddle no longer infers a compaction from *"the file got shorter"* but reads the
`{"type":"system","subtype":"compact_boundary"}` record ORCA actually writes. Verified at that
commit: huddle **28/28**, `pnpm lint` 0, `tsc -b --force` 0.

Kept as history because the judgement is worth reusing: **an earlier batch of the same agent's work
was preserved by the architect at `20e64cc` after checking it was 56/56 green, and a later batch was
deliberately NOT committed because it was red.** Preserving a peer's work across a break is worth a
byline; it is not worth a broken build, and only running the tests tells you which case you are in.

## ROUTED AND UNOWNED — take these early on resume

`node scripts/mutation-check.mjs` is **34/37**. All three live in `speech-service.ts` / the queue,
which was outside the reporting agent's file set, so nobody owns them.

**One is a live hole, and it is the important one.**

- **`skip-reported-as-failure` — SURVIVED.** The invariant is *"006 site 32: a control the listener
  pressed must never be reported as an engine failure"*, and `speech-service.test.ts` no longer
  notices when it is violated. **That test cannot fail for the reason it exists.** It sits on the
  P22 helplessness path: the listener presses skip, and is told the engine broke. Fix the test
  first — prove it red against the mutant — then confirm the behaviour.
- **`stop-one-sided` — target drifted.** `cancelSynthesis: () => { deps.provider.cancel() }` is no
  longer in the file.
- **`bargein-no-cancel` — target drifted.** `this.#deps.cancelSynthesis()` is no longer in the file.

The two drifts are a refactor that moved code without updating the registry. Cheap to repair — but
until they are, **two named invariants are unguarded** while the script reports them as errors
rather than passes, which is the difference between a gap that is visible and one that is loud but
meaningless.

## Two gate decisions answered, with the condition that would reverse them

- **QUOTE-GONE: reported, never gated.** A new one appears when somebody **fixes code** a document
  quotes verbatim, so gating makes the bug fix break the build — and the person who fixed the bug
  usually cannot fix the document. **A ratchet a correct action breaks is not a ratchet.** It is a
  work queue. *Reversal condition:* today 15 of 19 sit in record documents where re-pointing is
  harmful by construction; if the population became mostly live documents that can be fixed cheaply,
  a falling ratchet becomes right, because then a correct action clears it instead of breaking it.
- **Malformed suppression markers: GATED AT ZERO.** A marker the parser cannot read is a false claim
  of coverage — the suppression never happened while the document reads as though it did, which is
  worse than a stale citation that is wrong and says so. **Zero is the only moment when setting a
  threshold is not an argument about a backlog** — the whole lesson of the superseded 34.
  **Prose stamps (`[live tree]`) are reported, not gated**: failing on them would punish a document
  for being honest about its own uncertainty.

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
