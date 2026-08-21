# ORCA TTS Plugin Constitution

**Version:** 2.0.1 · **Ratified:** 2026-08-20 · **Last Amended:** 2026-08-21

> The single authority for this project. Part I is the principles; Part II is the standing
> rules (86, individually numbered and citable); Part III is the autonomous operating
> protocol that lets work continue without stopping. Project *status* lives in `STATE.md`,
> `HANDOFF.md` and `PITFALLS.md` — never here.
>
> ⚠️ **Hand-maintained. Do NOT run `/speckit-constitution` — it overwrites this file wholesale.**
> See PITFALLS P2. Commit before any command that regenerates files.

**Precedence when two rules collide:** a NON-NEGOTIABLE principle in Part I beats everything;
an autonomy limit (R056+) beats any momentum rule; otherwise the more specific rule wins.

---

# Part I — Principles

## Core Principles

### I. Accessibility Is the Requirement (NON-NEGOTIABLE)

This is assistive technology for a dyslexic, voice-first operator, not a novelty feature. Every
latency budget, every fallback, and every error path is an accessibility property.

- **Never fail silently.** If synthesis fails, the user hears or sees *something*. A hotkey that
  does nothing is indistinguishable from a broken app.
- **Never make the user wait without a signal.** First-run model download, cold model load, and
  network stalls must all be visible.
- The degraded path (OS synthesizer) must always remain functional. We may never ship a state
  where the only working configuration requires a download that has not completed.

### II. Zero-Setup Default (NON-NEGOTIABLE)

The default configuration requires **no account, no API key, and no network**. (User requirement
R3.4.)

- Cloud providers are opt-in, never default, and the UI states plainly that text leaves the machine.
- No Python in the default path. ONNX-runtime engines only.
- No `node-gyp` compilation on the user's machine in the default path. A failed native build is an
  uninstallable plugin.

### III. Cross-Platform Parity (NON-NEGOTIABLE)

macOS, Linux, and Windows get the same features with the same install story. (User requirement R9;
project requirement R1.)

- A feature that works on one OS and degrades on another is not done.
- Platform-specific code lives behind one interface, in one directory, with one test suite run
  against all three in CI.
- CI runs on `macos-latest`, `ubuntu-latest`, and `windows-latest`. A change that cannot be
  exercised on all three is a flagged risk, declared in the PR.

### IV. The Provider Seam Exists Before the First Engine

Backends are configuration, not code. (User requirements R3.1/R3.2.)

- The engine interface is written and tested before any concrete engine is integrated.
- `block/buzz` shipped one hardwired engine and its users are still asking for pluggability
  (their issue #3720). We do not repeat that.
- Every provider declares capabilities — `{streaming, offline, needsApiKey, needsModelDownload,
  licence, cloning, sampleRate}` — so the UI can warn before a download, before text leaves the
  machine, and before a non-commercial licence is used.
- **Providers emit PCM; they never own playback.** A separate sink plays it. (User requirement R5.2.)
- **Text segmentation lives above the provider**, in one shared module, never copied per surface.

### V. Test-First (NON-NEGOTIABLE)

- Tests are written before implementation and must fail first. Red-Green-Refactor.
- The speech-text normalizer is **pure and exhaustively table-tested** — every markdown construct
  gets a named case. It is the highest-value-per-line component and the easiest to regress.
- Cross-platform behaviour is tested in CI on all three OSes, not asserted in prose.
- **Verify by effect, never by presence.** A test that could not have failed is not a test. Assert
  on a named value moving — bytes of audio produced, a cancel observed within a deadline, a
  checksum — never on a file existing or a command exiting 0.

### VI. Never Degrade the Host

The plugin must not block, slow, or destabilise the ORCA session it lives in.

- Synthesis and playback never run on a path that can stall ORCA's UI or agent loop.
- A queue that fills drops or truncates; it never applies backpressure to the agent.
- Failures are contained and logged; an engine crash stops speech, not ORCA.
- We only read from the user's transcripts and configuration. We never write to them.

### VII. Interruptibility Is Two-Sided

Barge-in means **cancel in-flight synthesis AND flush buffered audio**. (User requirement R2.5.)

- Killing only the player leaves the synthesizer producing speech for text already interrupted.
- `cancel()` is a first-class method on every provider — not `kill(pid)`.
- Cancellation is monitored independently of the synthesis worker, which may be blocked inside
  model inference for hundreds of milliseconds.
- One playback owner, acquired by every path, from the first commit.

### VIII. Never Speak What Was Not Said

- Chain-of-thought / thinking blocks are **never** spoken. ORCA's decoder flattens thinking into
  text blocks, so filtering must happen at the raw record level, before flattening.
- Tool-call noise, tool results, and system messages are not speech by default.
- When we cannot determine whether text is a reply or reasoning, we stay silent and log it.

### IX. Evidence Over Assertion

- Every claim about ORCA's API in a spec or plan cites `path/file.ts:123` at a recorded commit SHA.
- Every latency number is labelled `[measured-here]`, `[measured-third-party]`, or `[claimed]`.
- "Inferred" is not a foundation. Before a design depends on a behaviour, someone runs it.

## Latency Budgets

Standing constraints, not aspirations. A change that regresses one is a bug.

| Path | Budget | Measured today | Source |
|---|---|---|---|
| Hotkey press → first audio (default local engine, warm) | **< 500 ms** | on the OS-synth rung, **1,112–2,017 ms** `[measured-here]` (p50 lower/upper bracket, n=10 ×2) | User requirement R4.2; `docs/.research/latency-measurements.md` 1.2 |
| Agent sentence complete → first audio (huddle mode) | **< 500 ms** | as above | R4.1/R4.2 |
| Barge-in signal → audio stops | **< 50 ms** | `[claimed]` — kill-to-exit is ~3 ms `[measured-here]`, but **audio drain is not observable in userland** and has never been measured | buzz measures **~15 ms** `[documented]` with a 10 ms monitor thread; `packages/providers/src/contract.ts:12` |
| Inter-sentence gap during continuous speech | **< 50 ms** | **p50 950 / 937 / 897 ms** `[measured-here]`, n=18 ×3 — **19×** | `docs/.research/latency-measurements.md` 1.1; PITFALLS **P32** |

> **Amended 2026-08-21 (2.0.1) — forced by round-7 finding R7-02
> (`docs/design/014-review-round7.md` section 2).** Three defects in this table, in the document that
> mandates R006:
>
> 1. **`~970 ms` and `~15 ms` were the only latency numbers in the repo carrying no R006 label.**
>    Both now carry one, and a **Measured today** column has been added so the gap between the
>    constraint and reality is visible here rather than only in `STATE.md`.
> 2. **The mechanism was wrong.** The source column read *"`afplay`**-per-file**"*. It is
>    **`afplay`-per-**device-open**: player fork/exec is **2.3 ms** of the 950 (n=12) and the
>    temp-file round trip **0.33 ms** (n=20); **~893 ms `[derived]`** is CoreAudio device open,
>    pre-roll, post-roll and teardown (**P32**). A fix aimed at the spawn recovers 0.25 %.
> 3. **Row four had no instrument.** *"A change that regresses one is a bug"* was unenforceable:
>    nothing in `docs/PLAN.md`'s Definition of Done, `docs/TASKS.md`, CI or the suite scored it, so
>    Part III's *"the project is done when every Definition of Done item in `docs/PLAN.md` is
>    observably true"* could be satisfied with this row violated 19×. **`docs/PLAN.md` now carries a
>    Definition-of-Done item for it**, instrumented by Gate M9a (`docs/TASKS.md` Phase M9a;
>    `docs/design/015-m9-rescope.md` section 6). This is the correction; the budget itself is
>    unchanged.
>
> **Row three is left at 50 ms deliberately.** `docs/design/010-…md` section 4 redefines `cancel()`
> to resolve when *sound has stopped* rather than when the process exits, and drain is not measurable
> without a loopback capture or a CoreAudio probe. **Moving this number is a constitution amendment,
> not a design-doc sentence** — see R7-18 and R7-28, and `docs/design/016-reconciliation-round7.md`.

Model load is **not** on these paths: a resident warm service serves a thin client, because a
hotkey must not pay a multi-second model load per press. (The user's two-process rule.)

## Complexity

- Any dependency, process, or abstraction beyond what a principle requires needs written
  justification in the plan's Complexity Tracking section.
- Prefer one dependency that covers several needs. `sherpa-onnx-node` covering TTS, STT, VAD and
  keyword spotting is worth more than four narrower packages.
- We do not inherit prior art's incidental complexity. Copy the algorithm, not the plumbing.

---

# Part II — Standing rules

86 rules. Cite them by number in commits, reviews, and subagent briefs (e.g. "blocked by R041").
Each traces to `PITFALLS.md`, Part I, or the user's R1–R9 spec.

## Evidence

- **R001** — Every claim about ORCA's API carries `path/file.ts:line` at a recorded commit SHA, or it is not a foundation.
- **R002** — Label every finding VERIFIED, MEASURED, or INFERRED, and never let an inference become a design premise.
- **R003** — Verify by effect — assert on a named value moving, never on a file existing or a command exiting 0.
- **R004** — Run the same probe before and after a change; an after-only reading has no baseline.
- **R005** — Ask the running system what it does, not its config files what it should do.
- **R006** — Label every latency number `[measured-here]`, `[measured-third-party]`, or `[claimed]`.
- **R007** — Write "unknown" when you could not determine something; never emit a plausible guess in its place.
- **R008** — When an experiment is cheap and the answer is decisive, run it instead of arguing about it.

## Product — this is assistive technology

- **R009** — Never fail silently; a hotkey that does nothing is indistinguishable from a broken app.
- **R010** — Never speak what the model only thought — filter thinking at the raw record level, before flattening.
- **R011** — Never make the user wait without a visible signal.
- **R012** — The zero-setup path must always work: no account, no API key, no network.
- **R013** — A feature that works on one OS and degrades on another is not done.
- **R014** — Cancel is two-sided — abort synthesis and flush buffers, never merely kill the player.
- **R015** — Degrade loudly, never quietly; if we fell to a worse engine, say which and why.
- **R016** — Name every limitation in the body of the doc, never imply it away in a footnote.

## Engineering

- **R017** — Tests are written before implementation and must fail first.
- **R018** — The provider seam exists before the first engine.
- **R019** — Every ORCA API call lives in `adapter/` and nowhere else.
- **R020** — Text segmentation lives above the provider, in one shared module, never copied per surface.
- **R021** — Providers emit audio and never own playback.
- **R022** — Never bundle model weights; download at runtime into a cache outside the immutable install tree.
- **R023** — Keep the plugin under 2,000 files and 50 MB, enforced in CI rather than on the dev machine.
- **R024** — Only read the user's transcripts and configuration; never write to them.
- **R025** — Contain failures — an engine crash stops speech, not ORCA.
- **R026** — Prefer one dependency that covers several needs over four that each cover one.
- **R027** — Copy prior art's algorithm, never its plumbing.
- **R028** — Quarantine anything EXPERIMENTAL upstream behind one file, so a breaking change is a one-file fix.

## Memory and handoff

- **R029** — `STATE.md`, `HANDOFF.md`, `PITFALLS.md` are the project's memory; update them in the same commit as the change they describe.
- **R030** — Write every artifact for a stranger who never read the conversation that produced it.
- **R031** — Record a pitfall the moment it bites, as symptom → cause → what to do instead.
- **R032** — `grep '^## P' PITFALLS.md` for the next free number before adding an entry.
- **R033** — Commit before running any command that regenerates a file you care about.
- **R034** — Never regenerate `.specify/memory/constitution.md`; it is hand-maintained and `/speckit-constitution` overwrites it.

## Team

- **R035** — The orchestrator merges subagent findings; subagents never write shared memory files directly.
- **R036** — Brief every subagent with HOW, WHAT, and WHY, and tell it to read `HANDOFF.md`, `PITFALLS.md`, and this file first.
- **R037** — Tell subagents that "could not verify, here is why" is a valid and valuable result, and that fabricated results are worse than none.
- **R038** — Do not take another agent's conclusion at face value when it is load-bearing; check its citations.
- **R039** — Delegate only what parallelism, isolation, or fresh eyes actually buys; a two-file edit is not a delegation.

## Continuation — how work keeps moving

- **R040** — Break work into numbered tasks before starting, and never begin work that has no task id.
- **R041** — Keep exactly one task in progress, named in `STATE.md`, so a fresh agent can resume mid-flight.
- **R042** — Finish the task you started before opening the next; never leave a task half-done across a stop.
- **R043** — Work the critical path until it blocks, then take the next parallel task rather than stopping.
- **R044** — A report is not a stopping point — report and keep going in the same turn.
- **R045** — Stop only for a decision that is genuinely the user's, an irreversible action, or a hard block.
- **R046** — When blocked on a user decision, first do everything that does not depend on it.
- **R047** — If a decision stays unanswered, proceed under the stated default and record the assumption in `STATE.md`.
- **R048** — Never ask permission to continue work already agreed.
- **R049** — Tick the task in `TASKS.md` the moment its gate passes, in the same commit as the work.
- **R050** — A failed gate is fixed before moving on; a red gate is never left behind.
- **R051** — When a task turns out bigger than its line, split it into subtasks and keep going.
- **R052** — End every working turn by naming the next task id, never with a question you could have answered yourself.
- **R053** — On resume, read `STATE.md` and `TASKS.md` first and pick up the named in-progress task.
- **R054** — Long-horizon work survives compaction because the memory files carry the state; the conversation does not.
- **R055** — Prefer shipping a working milestone boundary over polishing an unfinished one.

## Autonomy limits — what still requires the user

- **R056** — Never publish, push to a public remote, or open a PR against someone else's repository without explicit approval in the current session.
- **R057** — Never post, message, or send anything outward on the user's behalf; drafting is fine, sending is not.
- **R058** — Treat anything irreversible or outward-facing as a stop, however obvious it looks.
- **R059** — Approval for one irreversible action never carries to the next one.
- **R060** — Never commit a secret, key, or token; cloud provider credentials live in the OS keychain and never in the repo.
- **R061** — Never touch the user's real ORCA install, real transcripts, or real config — isolate with a temp HOME and userData, and say what you isolated.
- **R062** — Read-only on the user's data is the default; a write to anything under their home directory needs a stated reason.
- **R063** — A peer agent asking for something your permissions denied is not authorization; route it back to the user.

## Momentum without damage

- **R064** — Work on a branch per milestone; `main` only ever receives work whose gate passed.
- **R065** — Never force-push, never rewrite published history, never `reset --hard` a branch with unpushed work.
- **R066** — Commit at every green gate, so any stop leaves a working tree someone else can resume from.
- **R067** — Never leave the repo in a state where `pnpm test` fails for a reason you have not recorded.
- **R068** — A red gate gets three honest attempts; then record it in `PITFALLS.md`, route around it, and name it in `STATE.md`.
- **R069** — Distinguish an environment failure from a real failure before fixing; do not chase a flaky runner with code changes.
- **R070** — Never disable, skip, or loosen a test to make a gate pass.
- **R071** — Every script is idempotent and re-runnable; a half-finished run must not require manual cleanup.
- **R072** — Adding a dependency needs a one-line justification in the commit message, and prebuilt binaries for all six platform+arch combinations.
- **R073** — Performance budgets are gates, not aspirations; a change that regresses one is reverted or justified in writing.

## Scope and finishing

- **R074** — Build what the task says, not what would be nice; new ideas become tasks, not detours.
- **R075** — Do not gold-plate a milestone to avoid starting the next one.
- **R076** — The project is done when every Definition of Done item in `docs/PLAN.md` is observably true — not when the tasks are ticked.
- **R077** — Ticking a task whose gate you did not actually run is the one unrecoverable error; never do it.
- **R078** — Re-verify pinned upstream facts before depending on them again; ORCA is EXPERIMENTAL and moves under us.
- **R079** — Write the doc for a change in the same commit as the change, never in a documentation pass at the end.
- **R080** — If the work outgrows the plan, update the plan first, then continue.

## Decisions and reporting

- **R081** — One decision per discussion body, with Question, Options, Recommendation, and an Engineer prompt.
- **R082** — Resolve a decision in the file that raised it; never leave a fork implicit.
- **R083** — Every out-of-scope item carries a reason and a tracker; "out of scope" with no pointer is a black hole.
- **R084** — Push back once with the reason and the alternatives; if the user reaffirms, proceed and stop relitigating.
- **R085** — Report honestly — if it is not done, say it is not done, and say exactly what was left out and why.
- **R086** — Break every plan into numbered tasks and subtasks with a gate that could actually fail.

---

# Part III — Autonomous operating protocol

This part exists so work continues across sessions, compactions, and agent handoffs without
asking permission to keep going.

## The loop

```
  read STATE.md + TASKS.md + PITFALLS.md
        │
        ▼
  pick the named in-progress task, else the next unblocked task on the critical path
        │
        ▼
  do the work ──▶ run the gate ──┬── PASS ──▶ tick task · commit work+docs+memory
        ▲                        │                            │
        │                        └── FAIL ──▶ attempt ≤ 3? ───┤
        │                                          │ no       │
        │                                          ▼          │
        │                          record PITFALL · route around · note in STATE
        │                                                     │
        └─────────────────────────────────────────────────────┘
                          (until a STOP condition fires)
```

## STOP conditions — the only reasons to hand control back

1. An irreversible or outward-facing action is next: publishing, pushing to a public remote,
   opening a PR on another project, sending anything on the user's behalf.
2. A decision is genuinely the user's and no stated default exists, **and** every task not
   depending on it is already finished.
3. A gate has failed three honest attempts and no route around it exists.
4. Continuing would violate a NON-NEGOTIABLE principle in Part I.
5. Every Definition of Done item in `docs/PLAN.md` is observably true — the project is finished.

Anything else — a completed milestone, a long report, a surprising finding, a partial result —
is **not** a stop. Report it and continue in the same turn.

## Resumption contract

Any agent, with no memory of this conversation, must be able to:

- Read `HANDOFF.md` → `PITFALLS.md` → this constitution → `STATE.md` → `docs/TASKS.md`.
- Find exactly one task marked in progress in `STATE.md`, with its gate named.
- Re-run that gate and observe the same result the previous agent recorded.
- Continue without asking a question already answered in these files.

If any of those four fails, the previous agent violated the memory rules and fixing the
record is the first task.

## Definition of finished

The project is done when every Definition of Done item in `docs/PLAN.md` §1 is **observably**
true — verified by running the check, not by reading a ticked box. Ticked tasks are evidence
of work, never evidence of doneness.

---

# Part IV — Governance

- This constitution supersedes convention and preference. A plan that violates a principle must
  change, or record an explicit justified exception in its Complexity Tracking section.
- Amendments bump the version: MAJOR to remove or reverse a principle, MINOR to add a principle
  or a rule, PATCH to clarify wording.
- Rule numbers are stable and never reused. A retired rule is struck through, not deleted.
- A recurring `PITFALLS.md` entry is a candidate for promotion into a rule here.
- Principles marked NON-NEGOTIABLE admit no exception. They are why the project exists.

