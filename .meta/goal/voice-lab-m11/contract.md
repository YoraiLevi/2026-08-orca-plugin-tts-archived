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

- [ ] **C1 — the spec gate is passed.** `specs/002-voice-lab/` holds spec, plan and tasks,
      each requirement numbered and independently testable.
      *Oracle:* every functional requirement names its verification method; a reader can
      walk the acceptance criteria without reading the implementation.
      *OR* ack blocked, naming the design question too vague to specify, recorded in
      `docs/.discussion/000-open-questions.md`.

- [ ] **C2 — `pnpm voice-lab` serves a working page on 127.0.0.1.** Fixture picker, free
      text, every control from the design, written-vs-spoken side by side.
      *Oracle:* a scripted HTTP client fetches the page and POSTs `/normalize`, asserting
      the spoken text byte-equals `normalize()` called directly with the same options —
      the expected value comes from the library, not from the server's own output.
      *OR* ack blocked after 3 attempts, naming the platform capability that is missing.

- [ ] **C3 — the two-second gate is met and measured.** From changing a control to hearing
      the difference, p50 ≤ 2,000 ms.
      *Oracle:* `scripts/bench-latency.mjs` extended with a lab-replay probe, run count
      reported, labelled `[measured-here]` per constitution R006. **Silent by default —
      P31: the author is at this machine.**
      *OR* ack the gate unmet with the measured number and the named cause.

- [ ] **C4 — the round trip proves lab and plugin agree.** Settings exported from the lab,
      fed to `normalize()`, reproduce the lab's spoken text byte-for-byte.
      *Oracle:* a test whose expected value is the lab's own emitted text captured in a
      fixture, compared against a fresh `normalize()` — two independent paths to one string.
      *OR* ack blocked, naming the field that cannot round-trip and why.

- [ ] **C5 — every `NormalizeOptions` field is reachable from settings, proven by
      iterating the schema.** A new option that is not settable fails the test (T124).
      *Oracle:* the assertion enumerates the schema at runtime; adding a field to
      `NormalizeOptions` without a control makes it go red. **Verify by mutation** —
      add a dummy field, confirm red, revert.

- [ ] **C6 — CI runs it on all three OSes, headless, silent.** Normalize-only; no audio
      device is opened in CI.
      *Oracle:* the workflow run is green on macOS, Linux and Windows, and a grep of the
      job log shows no player was spawned.
      *OR* ack with the named platform and its blocker.

- [ ] **C7 — the listener has heard it and the taste defaults are recorded as data.**
      The provisional defaults for identifier speech, path depth, announcement wording and
      the spoken-overhead budget are settled by the author in the lab and written to the
      settings file — a data edit, not a code change.
      *Oracle:* **the author.** This criterion cannot be satisfied by any agent.
      *OR* ack "awaiting the listener" — which is a legitimate terminal state for this
      criterion and must not block C1–C6.

---

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
