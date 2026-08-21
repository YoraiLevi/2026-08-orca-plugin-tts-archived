# Contract — M11 Voice Lab

**Goal in one sentence.** Build the Voice Lab: a local page, running the real normalizer
and the real provider, where the listener settles speech taste by ear in seconds — and
then settle the taste questions that have been blocked on it.

**Why this goal and not another.** Every remaining quality question in this project is
taste, and taste is settleable only by the listener, only by hearing the same sample
repeatedly (PITFALLS P23). Seven findings across four design documents resolve to "the
listener picks the default from an option space". All of them are blocked on this one
instrument. Thirteen design documents exist; nothing reaches the author's ears.

**Ruling in force.** Design → spec → code, speckit method (author, this session).
Repo markdown only. v1 decisions are reopenable with evidence.

---

## Done when

- [x] **C1 — the spec gate is passed.** `specs/002-voice-lab/` holds spec, plan and tasks,
      each requirement numbered and independently testable.
      *Oracle:* every functional requirement names its verification method; a reader can
      walk the acceptance criteria without reading the implementation.
      *OR* ack blocked, naming the design question too vague to specify, recorded in
      `docs/.discussion/000-open-questions.md`.

- [x] **C2 — `pnpm voice-lab` serves a working page on 127.0.0.1.** Fixture picker, free
      text, every control from the design, written-vs-spoken side by side.
      *Oracle:* a scripted HTTP client fetches the page and POSTs `/normalize`, asserting
      the spoken text byte-equals `normalize()` called directly with the same options —
      the expected value comes from the library, not from the server's own output.
      *OR* ack blocked after 3 attempts, naming the platform capability that is missing.

- [x] **C3 — the two-second gate is met and measured.** From changing a control to hearing
      the difference, p50 ≤ 2,000 ms.
      *Oracle:* `scripts/bench-latency.mjs` extended with a lab-replay probe, run count
      reported, labelled `[measured-here]` per constitution R006. **Silent by default —
      P31: the author is at this machine.**
      *OR* ack the gate unmet with the measured number and the named cause.

- [x] **C4 — the round trip proves lab and plugin agree.** Settings exported from the lab,
      fed to `normalize()`, reproduce the lab's spoken text byte-for-byte.
      *Oracle:* a test whose expected value is the lab's own emitted text captured in a
      fixture, compared against a fresh `normalize()` — two independent paths to one string.
      *OR* ack blocked, naming the field that cannot round-trip and why.

- [x] **C5 — every `NormalizeOptions` field is reachable from settings, proven by
      iterating the schema.** A new option that is not settable fails the test (T124).
      *Oracle:* the assertion enumerates the schema at runtime; adding a field to
      `NormalizeOptions` without a control makes it go red. **Verify by mutation** —
      add a dummy field, confirm red, revert.

- [x] **C6 — CI runs it on all three OSes, headless, silent.** Normalize-only; no audio
      device is opened in CI.
      *Oracle:* the workflow run is green on macOS, Linux and Windows, and a grep of the
      job log shows no player was spawned.
      *OR* ack with the named platform and its blocker.

- [x] **C7 — the listener has heard it and the taste defaults are recorded as data.**
      The provisional defaults for identifier speech, path depth, announcement wording and
      the spoken-overhead budget are settled by the author in the lab and written to the
      settings file — a data edit, not a code change.
      *Oracle:* **the author.** This criterion cannot be satisfied by any agent.
      *OR* ack "awaiting the listener" — which is a legitimate terminal state for this
      criterion and must not block C1–C6.

---

## Reconciliation — 2026-08-21, by the architect, against the artefacts

Ticked only after checking the artefact, never on a subagent's report.

| | Verdict | Evidence |
|---|---|---|
| **C1** | met | `specs/002-voice-lab/{spec,plan,tasks}.md` all present. |
| **C2** | met | Lab boots at `stages 16`; `POST /normalize` and `POST /speak` answered live on a pinned worktree; `short.md` / `paths.md` / `code-heavy.md` return 200 with 4 / 15 / 12 NDJSON lines. All six fixtures returned **503** this morning — that was **G-1**, and it is closed. |
| **C3** | **ticked as an HONEST FAILURE**, per its own failure clause | **p95 3,401 ms against a 2,000 ms budget**; `paths.md` 22,755 ms; cache-hit replay 41 ms. Cause named: `POST /speak` synthesized every chunk before answering. It now streams NDJSON, **but the re-measurement has NOT been taken** — the machine hit load average 51.62 with six agents running, and a control reply with no unusual content took **71 s and dropped a chunk**. Re-measuring under that is how a fabricated regression gets published. **The number stands at 3,401 ms until re-taken quiet.** |
| **C4** | met | `packages/core/src/settings/` 195/195; the round-trip compares two independent paths to one string. |
| **C5** | met | T124 enumerates the schema at runtime and asserts by effect that a tuned file changes what the normalizer *produces*, not merely what the options object holds. |
| **C6** | **2 of 3 legs RAN and are GREEN; Windows acked with its named blocker** | Executed for the first time, by the architect, after four unanswered requests. **macOS** `[measured-here]`: 12 probes = 9 ran + 3 not-run, exit 0. **Linux** `[measured-here]`, `node:24-bookworm` under podman: same 12, exit 0. **Windows** — cannot run on this machine; no Windows host and no emulation, which is a genuine platform blocker and is what the failure clause is for. `--prove-guard` was run first and the no-audio guard **went red on a real spawned player and on all four aloud rungs**, then stayed green on the five spawns the provider legitimately makes — the guard can fail, so its green means something. Both legs independently derived **16 stages in order** from source. `speak.outcome` differs by platform and both are correct: macOS returns 128,752 bytes played by nobody; Linux returns **503 carrying the provider's own words** with the `apt install espeak-ng` remedy — P25 caught by a probe built for it. **The remaining gap is a GitHub-hosted run, which needs a push and is the author's call.** |
| **C7** | ack **"awaiting the listener"** — a legitimate terminal state | The taste defaults are the author's alone and no agent may satisfy this. The instrument he needs now exists and works. |

**Two decisions are the author's and are not agent-blocked:** whether `006-fma.md` is **pinned** to the SHA it analysed or **reconciled** row by row (66 of the 133 DRIFTED citations live there, and it is stale by *remedy* — re-pointing lands the citation on the fix while the sentence beside it describes the defect); and whether to throttle the agent swarm off his machine.

## External blockers — allowed to stop without success

- A platform capability that does not exist, cited `file:line` or by a failed probe.
- An upstream ORCA behaviour that blocks the path, with the issue number.
- A taste decision that is the author's alone (C7) — ack and continue; never guess.
- The author says stop.

## Retry ceiling

Three attempts per Job. A fourth identical failure is a blocker, recorded by name in the
ledger with the actual error text, not a paraphrase.

## Halt immediately if

- Any change would touch the author's real ORCA install, transcripts, or config.
- Anything would be pushed to a public remote or opened against a third-party repo
  without approval in the live session.
- Audio plays on the author's machine outside an explicit opt-in (P31).
- The same failure recurs three times with no new information.
- The test suite goes red and is not green again within one Job.

## Standing invariants — true at the end of every Job

- `pnpm test` green. Count reported, never decreasing without a stated reason.
- `pnpm check:citations` no worse than its ratchet.
- `grep -c '^## P[0-9]' PITFALLS.md` increases only by entries deliberately added (P24).
- No test plays audio. Tests assert what *would* be spoken.
