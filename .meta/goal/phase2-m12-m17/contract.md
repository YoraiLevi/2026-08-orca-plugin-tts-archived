# Contract — Phase 2, M12 through M17

**Goal in one sentence.** Build the six remaining Phase 2 milestones to their written gates,
autonomously, stopping only where a gate requires a human ear.

**Why this goal.** M11 shipped an instrument. The product it exists to tune is still six
milestones from done, and every one of those gates is mechanically checkable except the two
named below. The author has authorised continuous autonomous work with self-monitoring.

**Ruling in force.** Design → code, speckit. Push authorised. GitHub issues authorised.
Cap 3-4 concurrent agents. v1 decisions reopenable with evidence.

---

## Done when — every box mechanically checkable

- [ ] **G1 — M12 settings.** A value exported from the Voice Lab, placed in ORCA settings,
      produces **byte-identical** speech to the lab's own output.
      *Oracle:* a test whose expected value comes from the lab's captured output, compared
      against the plugin's read path — two independent paths to one string.
      *OR* ack blocked, naming the field that cannot round-trip.

- [ ] **G2 — M13 dashboard.** While a reply is being read, the surface names the session and
      the queue depth, and a control reaches the plugin.
      *Oracle:* drive it end to end and assert the rendered text against state the test set
      independently. `terminal.sendText` is panel-callable — this is NOT blocked upstream.

- [ ] **G3 — M14a, holdable with no agent cooperation.** The motivating fixture is **not**
      spoken as box-drawing characters, and what was skipped is announced **by name**.
      *Oracle:* the fixture through `normalize()` → chunker → provider, asserting the spoken
      string. P30: the announcement is in the audio stream, never only a log.

- [ ] **G4 — M14b, the enhancement.** Given the same fixture WITH a ```speak block, the
      one-sentence description is what is spoken.

- [ ] **G5 — M16 huddle presence.** The surface shows who is in the room and who is talking,
      and one can be muted. **This is also the P22 fix and it unblocks M15.**

- [ ] **G6 — M15 per-agent voices, MECHANICAL HALF ONLY.** With two agents, each renders to
      **measurably different audio** — different checksum, same input text.
      *Oracle:* render to file and compare, the technique that has been reliable all session.
      **The perceptual half — "you can tell who is speaking without being told" — is the
      author's and is a legitimate terminal state for that half.**

- [ ] **G7 — M17 re-scoped against the lifted constraint.** The recorded blockers were (a) no
      local STT under a 50 MB cap and (b) ORCA's STT is main-process only. **(a) is void — the
      author has lifted the size cap.** Re-examine (b) by reading ORCA's source: main-process
      only may still be reachable via a command rather than a direct call.
      *Deliverable:* a measured answer and a build if it is buildable; an honest blocked with
      `file:line` if it is not. **Do not repeat the old conclusion without re-deriving it.**

- [ ] **G8 — the suite is honest.** `mutation-check` **37/37**: no SURVIVED, no drifted
      targets. Today it is 33/37 — three routed live holes plus two drifted, including
      `skip-reported-as-failure`, where a control the listener pressed is reported as an
      engine failure and its own test cannot notice.

- [ ] **G9 — the review protocol converges.** **Three consecutive dry rounds** by the bar in
      `docs/design/000-round-ledger.md`. Twelve rounds so far, never dry. The tailer and
      adapter seam inventories have never been opened.

- [ ] **G10 — hosted CI green on all three OSes**, test job included, at the final commit.
      *Oracle:* `gh run view`. **Local green is not evidence** — it was wrong seven times in
      two hours on 2026-08-21.

## Handed back to the author, never certified by an agent

- **C7 taste defaults** — identifier speech, path depth, announcement wording, overhead budget.
- **M15 perceptual half** — whether two voices are tellable apart by ear.
- Anything whose only oracle is hearing it.

## Halt immediately if

- Audio plays on the author's machine outside an explicit opt-in (P31).
- Anything touches the author's real ORCA install, transcripts or config.
- A change would be pushed to a THIRD-PARTY repo or opened as a PR against one.
- The same failure recurs three times with no new information.
- `mutation-check` regresses — a previously-killed mutant starts surviving.

## Standing invariants — after every Job

- `git commit -- <paths>`, never stage-then-commit (P34, amended).
- Every number labelled `[measured-here]` with a run count, `[documented]`, or `[claimed]`.
- Counts pinned to a SHA **and a load average**, taken in a detached worktree (P40).
- **`mutation-check` after any test edit.** A test made unable to fail is the defect class this
  project has found in ten costumes, and the architect shipped one of them.
- Checkpoint written BEFORE dispatch, not after.
