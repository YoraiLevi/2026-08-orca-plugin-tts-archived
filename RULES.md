# RULES — orca-plugin-tts

Standing rules for every agent and every session on this project. Earned, not invented: each one
traces to something in `PITFALLS.md`, `.specify/memory/constitution.md`, or the user's R1–R9 spec.

Read this file on spawn, alongside `HANDOFF.md` and `PITFALLS.md`.

## Evidence

RULE: Every claim about ORCA's API carries `path/file.ts:line` at a recorded commit SHA, or it is not a foundation.
RULE: Label every finding VERIFIED, MEASURED, or INFERRED, and never let an inference become a design premise.
RULE: Verify by effect — assert on a named value moving, never on a file existing or a command exiting 0.
RULE: Run the same probe before and after a change; an after-only reading has no baseline.
RULE: Ask the running system what it does, not its config files what it should do.
RULE: Label every latency number `[measured-here]`, `[measured-third-party]`, or `[claimed]`.
RULE: Write "unknown" when you could not determine something; never emit a plausible guess in its place.
RULE: When an experiment is cheap and the answer is decisive, run it instead of arguing about it.

## Product — this is assistive technology

RULE: Never fail silently; a hotkey that does nothing is indistinguishable from a broken app.
RULE: Never speak what the model only thought — filter thinking at the raw record level, before flattening.
RULE: Never make the user wait without a visible signal.
RULE: The zero-setup path must always work: no account, no API key, no network.
RULE: A feature that works on one OS and degrades on another is not done.
RULE: Cancel is two-sided — abort synthesis and flush buffers, never merely kill the player.
RULE: Degrade loudly, never quietly; if we fell to a worse engine, say which and why.
RULE: Name every limitation in the body of the doc, never imply it away in a footnote.

## Engineering

RULE: Tests are written before implementation and must fail first.
RULE: The provider seam exists before the first engine.
RULE: Every ORCA API call lives in `adapter/` and nowhere else.
RULE: Text segmentation lives above the provider, in one shared module, never copied per surface.
RULE: Providers emit audio and never own playback.
RULE: Never bundle model weights; download at runtime into a cache outside the immutable install tree.
RULE: Keep the plugin under 2,000 files and 50 MB, enforced in CI rather than on the dev machine.
RULE: Only read the user's transcripts and configuration; never write to them.
RULE: Contain failures — an engine crash stops speech, not ORCA.
RULE: Prefer one dependency that covers several needs over four that each cover one.
RULE: Copy prior art's algorithm, never its plumbing.
RULE: Quarantine anything EXPERIMENTAL upstream behind one file, so a breaking change is a one-file fix.

## Memory and handoff

RULE: `STATE.md`, `HANDOFF.md`, `PITFALLS.md` are the project's memory; update them in the same commit as the change they describe.
RULE: Write every artifact for a stranger who never read the conversation that produced it.
RULE: Record a pitfall the moment it bites, as symptom → cause → what to do instead.
RULE: `grep '^## P' PITFALLS.md` for the next free number before adding an entry.
RULE: Commit before running any command that regenerates a file you care about.
RULE: Never regenerate `.specify/memory/constitution.md`; it is hand-maintained and `/speckit-constitution` overwrites it.

## Team

RULE: The orchestrator merges subagent findings; subagents never write shared memory files directly.
RULE: Brief every subagent with HOW, WHAT, and WHY, and tell it to read `HANDOFF.md`, `PITFALLS.md`, and this file first.
RULE: Tell subagents that "could not verify, here is why" is a valid and valuable result, and that fabricated results are worse than none.
RULE: Do not take another agent's conclusion at face value when it is load-bearing; check its citations.
RULE: Delegate only what parallelism, isolation, or fresh eyes actually buys; a two-file edit is not a delegation.

## Decisions and reporting

RULE: One decision per discussion body, with Question, Options, Recommendation, and an Engineer prompt.
RULE: Resolve a decision in the file that raised it; never leave a fork implicit.
RULE: Every out-of-scope item carries a reason and a tracker; "out of scope" with no pointer is a black hole.
RULE: Push back once with the reason and the alternatives; if the user reaffirms, proceed and stop relitigating.
RULE: Report honestly — if it is not done, say it is not done, and say exactly what was left out and why.
RULE: Break every plan into numbered tasks and subtasks with a gate that could actually fail.
