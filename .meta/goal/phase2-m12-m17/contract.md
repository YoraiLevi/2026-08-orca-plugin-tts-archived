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

- [x] **G1 — M12 settings.** ✅ **MET** at `9079f27`. Verified independently by the architect in a pinned detached worktree: **349/349** across `packages/plugin` and `packages/core/src/settings`, load 12 `[measured-here]`. The oracle is `g1-roundtrip.test.ts`, 20 tests, two genuinely independent paths — the LAB path lifts the projections from `voice-lab/index.html`'s own bytes and runs a real HTTP server; the PLUGIN path writes a real file to a real inbox and reads it through `activate()`. A value exported from the Voice Lab, placed in ORCA settings,
      produces **byte-identical** speech to the lab's own output.
      *Oracle:* a test whose expected value comes from the lab's captured output, compared
      against the plugin's read path — two independent paths to one string.
      *OR* ack blocked, naming the field that cannot round-trip.

- [x] **G2 — M13 dashboard.** ✅ **MET.** The surface is `orca-tts control`, a terminal TUI: the
      plugin panel is write-capable through `terminal.sendText` but read-blind, while the TUI can
      render atomic worker state without a panel poll and push Stop through a local socket. While
      the test holds reply one in synthesis with replies two and three queued, the rendered surface
      names the independently-created session and says `QUEUE  2 waiting`; Stop is asserted by the
      effects `provider.cancelled` and `sink.stops`, never by the socket receipt.
      *Oracle:* drive it end to end and assert the rendered text against state the test set
      independently. `terminal.sendText` is panel-callable — this is NOT blocked upstream.

- [x] **G3 — M14a.** ✅ **MET** at `213ee55`, verified independently: **405/405** in `packages/core`, and the Voice Lab boots at **17 stages** with the full six-file renumber landed in one commit. The announcement reads *"Here, a diagram is omitted. It is labelled: transcript watcher, normalizer (seventeen stages), synthesizer (Piper), barge-in."* — geometry dropped because a linear audio stream cannot carry it, nouns kept because they are the only part that survives linearisation. 16 words, **5.7 %** of `hostile.md`'s spoken words `[measured-here]`, replacing 343 characters of box glyphs that previously reached the engine verbatim. The motivating fixture is **not**
      spoken as box-drawing characters, and what was skipped is announced **by name**.
      *Oracle:* the fixture through `normalize()` → chunker → provider, asserting the spoken
      string. P30: the announcement is in the audio stream, never only a log.

- [ ] **G4 — M14b. PARTIAL, deliberately not ticked.** The mechanism is green — `extractSpeakFence()` with its absence case pinned byte-identical over five marker-free fixtures, and a `speak` fence is never announced as code whatever `codeBlocks` says, with a control proving ordinary fences still are. **The wire is not in**, and the reason is not laziness: the call site needs the D002 Q5 policy (spoken-only / spoken-then-prose / prose-only / agent-decides) **as a setting that does not exist**, and D002 forbids choosing its default outside the Voice Lab. **Do not tick this without that setting.** Original text follows.

- [ ] **G4 original — M14b, the enhancement.** Given the same fixture WITH a ```speak block, the
      one-sentence description is what is spoken.

- [ ] **G5 — M16 huddle presence.** The surface shows who is in the room and who is talking,
      and one can be muted. **This is also the P22 fix and it unblocks M15.**

- [ ] **G6 — M15 per-agent voices, MECHANICAL HALF ONLY.** With two agents, each renders to
      **measurably different audio** — different checksum, same input text.
      *Oracle:* render to file and compare, the technique that has been reliable all session.
      **The perceptual half — "you can tell who is speaking without being told" — is the
      author's and is a legitimate terminal state for that half.**

- [x] **G7 — M17 re-scoped.** ✅ **MET — a measured answer, and the old conclusion did not survive re-derivation.** The 50 MB cap **never blocked M17a**, which is option E, push-to-talk, shipping no model. It blocked **M17c**: ORCA's smallest English model is 87.7 MiB and Moonshine tiny 119.0 MiB, against a VAD model at ~1–2 MB. R7-34 had already found the binary cost is owed by TTS anyway, so *the delta STT adds is the model download and nothing else* — with the cap gone that was the last objection, and **M17c moves from refused-on-size to unscored**. Confirmed unchanged at source: `dictation`/`speech` appear nowhere in `plugin-host-api.ts`, so ORCA's STT stays unreachable — reachability, not the panel. Written up as `docs/design/013-voice-input.md` section 0. Original text follows.

- [ ] **G7 original —** The recorded blockers were (a) no
      local STT under a 50 MB cap and (b) ORCA's STT is main-process only. **(a) is void — the
      author has lifted the size cap.** Re-examine (b) by reading ORCA's source: main-process
      only may still be reachable via a command rather than a direct call.
      *Deliverable:* a measured answer and a build if it is buildable; an honest blocked with
      `file:line` if it is not. **Do not repeat the old conclusion without re-deriving it.**

- [x] **G8 — the suite is honest.** ✅ **MET.** `40/40 mutants behaved as declared`, detached
      worktree at `f029e6f`, load average 15.12 → 7.06 `[measured-here]`, per P41/P43. The previous
      37 declarations still behave, and M13 adds three killed mutants: session hidden, queue depth
      hidden, and Stop acknowledged without invoking its plugin consumer. Every original survivor
      is killed, including **`skip-reported-as-failure`** — *a control the listener pressed must
      never be reported as an engine failure* — which sat on the P22 helplessness path with a test
      that could not notice. Original text follows.

- [ ] **G8 original —** `mutation-check` **37/37**: no SURVIVED, no drifted
      targets. Today it is **34/37** at `6049c26`, load 11.01 `[measured-here]` — I wrote 33 in an earlier revision and in three agent briefs; 34 is what the script actually reports. The survivors are
      `skip-reported-as-failure`, where a control the listener pressed is reported as an
      engine failure and its own test cannot notice.

- [ ] **G9 — the review protocol converges.** **Three consecutive dry rounds** by the bar in
      `docs/design/000-round-ledger.md`. Twelve rounds so far, never dry. The tailer and
      adapter seam inventories have never been opened.

- [ ] **G10 — hosted CI green on all three OSes**, test job included, at the final commit.
      *Oracle:* `gh run view`. **Local green is not evidence** — it was wrong seven times in
      two hours on 2026-08-21.

## Operating autonomously across the 5-hour limit and compaction

Written for whoever manages this next. All of it is shell-accessible, so a `Monitor` can use it
— which matters, because a monitor runs bash and cannot make an MCP call.

### Reading your own state

| Command | What it gives |
|---|---|
| `orca terminal read --terminal <h> --json` | your own live screen. `result.terminal.tail` is a line list; the status row reads e.g. `permission2 on · 2 monitors · ← 1 agent` |
| `orca terminal send` | **types into a live terminal, including your own.** This is how a `/compact` gets self-issued rather than waited for |
| `orca terminal wait --terminal <h> --for tui-idle --timeout-ms N` | block until an agent terminal is idle instead of polling |
| `orca terminal list --json` | every terminal with a `preview` — one call scans the whole fleet |
| ORCA Usage meter, via cua `get_window_state` on the ORCA window, `query: "% used"` | the real numbers: element 50 is the **5-hour** figure, 53 the weekly |

`orca status --json` first; `orca skills get orchestration` prints the version-matched guide.
Do not guess subcommands — they change between releases.

### The limit is directly detectable

A terminal that hit it reads, in plain text with the reset time:

    ⎿  You've hit your session limit · resets 2:20pm (Asia/Jerusalem)

**Prime a baseline before watching for it.** A monitor that alerts on first sight fires forever
on yesterday's scrollback — this exact monitor was built, fired within seconds on a stale
message while the live meter read 6 %, and had to be rebuilt. A permanently-red indicator
carries no information and will camouflage the real event. **Cross-check any signal against
the meter before acting on it.**

### When to compact — the rule that matters

**Compact at a wave boundary, never mid-wave.** The boundary is the moment your context is
genuinely disposable: every agent in the wave has reported, the ledger and checkpoint are
current, the tree is committed and pushed. Compacting there costs nothing, because everything
load-bearing is on disk and the next wave starts from files rather than from memory.

Compacting mid-wave loses the one thing that is not yet written down: the in-flight agent
reports you have read but not yet folded into the ledger. That is how a resumed session forks
a second attempt at a job already running.

**The checklist, all four before compacting:**

1. No unreported agent results in flight.
2. `checkpoint.md` names what is running and what is next.
3. `ledger.md` has the wave's outcomes with their evidence.
4. Tree committed and **pushed** — GitHub is the state that survives process death.

**Compact BEFORE a large fan-out, not after.** Synthesis is the expensive thinking; give it a
fresh window rather than the dregs of one spent reading reports.

**Do not compact agents.** Subagents are ephemeral by design. Keep each Job small enough to
finish inside one context; if one is running long, tell it to **commit partial work and report**
rather than continue. A Job that cannot fit in one context is a Job that was scoped too large,
and splitting it is cheaper than rescuing it.

### Wind down before the wall, not at it

At roughly **4h15m** into the window: every agent commits partial work with
`git commit -- <paths>`, the tree is verified, the checkpoint is refreshed, everything is
pushed. Then stop dispatching.

This is not caution for its own sake. Hitting the wall on 2026-08-21 killed two agents
mid-work, one holding **1,548 uncommitted lines**, and the recovery cost more than the pause
would have.

### The one gap that needs a human

Monitors and crons die if the Claude process itself exits. Everything is pushed continuously so
no work is lost, but that single case needs one message from the author to resume. Say so
plainly rather than implying the loop is unbreakable.

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
