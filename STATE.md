# STATE — orca-plugin-tts

**Updated:** 2026-08-21 · **Phase:** v1 shipped to a public repo · **Branch:** `main` ·
**Repo:** https://github.com/YoraiLevi/orca-plugin-tts

> **Amended 2026-08-21 — forced by the latency measurement pass** (`docs/.research/latency-measurements.md`).
> The `927 ms` first-audio figure previously printed in the audit table below was **unsupported and
> unreproducible**: it came from an unrecorded single run of `scripts/speak-e2e.mjs`, which measures
> neither end of the budget and does not execute today, and it sits **below the minimum of all twenty
> measured samples**. Every performance number in this file now carries an R006 label
> (`[measured-here]` with a run count, `[documented]` with a citation, `[claimed]` when nobody has run
> it). See also PITFALLS **P32** — the inter-sentence gap is the audio device, not the process spawn.

## One-paragraph status

v1 is built, tested, published, and green on CI across macOS, Linux and Windows. **337 tests** (18 files,
`pnpm test` at `745d36c` — amended 2026-08-21, forced by round-7 finding R7-09, which found this file,
`HANDOFF.md` and `006` carrying three different wrong counts; the number is recorded WITH the SHA it was
measured at, per R7-13, because a bare count goes stale the next time anyone adds a test), lint
and typecheck clean, bundle 17 files / 0.06 MB against ORCA's 50 MB cap. Three gaps in ORCA's
plugin API are raised upstream, one of them with a merged-ready patch. The project is NOT finished:
two Definition-of-Done items are unmet and named below.

## Definition of Done — honest audit

| Criterion | State |
|---|---|
| No account, key, or network by default | ✅ |
| Hotkey speaks clipboard; second press stops < 50 ms | ⚠️ **kill-to-exit ~3 ms** `[measured-here]` (`afplay`, n=10 ×2, `docs/.research/latency-measurements.md` 1.5). That is the *process dying*, not audio stopping; **drain is unmeasured**. **The contract gate is FIXED** — amended 2026-08-21, forced by round-7 finding R7-10. This row read *"the contract gate asserts `<= 1000 ms`, not 50 (`contract.ts:69`) — a check that could not have failed"*, in the present tense, long after `22269aa` fixed it. The gate today is `.toBeLessThanOrEqual(CANCEL_BUDGET_MS)` at `packages/providers/src/contract.ts:80`, against `CANCEL_BUDGET_MS = 50` (`packages/providers/src/contract.ts:12`), **with no multiplier**; `docs/.research/test-audit.md` 2.1 records the fix. What remains true is the first half: kill-to-exit is not audio-stop, and drain is `[claimed]`. |
| Huddle speaks replies, never thinking, never tool noise | ✅ fixture-asserted |
| CI green on three OSes | ✅ run 32403931195 |
| README documents limitations verbatim | ✅ |
| Memory files reconcile | ✅ |
| **First audio < 500 ms** *(R4.2 scores the **default local backend**; the default is Piper. The row below scores the **OS-synth fallback**, which is not what the budget is written against.)* | ❌ **On the OS synth: between 1,112 ms and 2,017 ms** `[measured-here]` (p50 lower/upper bound, n=10 ×2, `docs/.research/latency-measurements.md` 1.2). Bracket, not midpoint — nothing in userland can see the first sample leave the DAC without a loopback or CoreAudio probe. **Rescoped 2026-08-21 by `docs/design/015-m9-rescope.md`.** `OsSynthProvider.generate()` is p50 1,054–1,163 ms `[measured-here]` (1.3) — but that cost is **per-process engine and voice init, not synthesis compute**: a *warm resident* `AVSpeechSynthesizer` reaches its first buffer in **p50 17.7 / 17.1 ms**, n=20 ×2 `[measured-here]` (`docs/.research/spike1-resident-synth.md` 1), and ~328 ms cold (section 2). So **the engine is not on the macOS latency critical path and Piper is not what this row needs** — what it needs is the audio **device** held open across the utterance (~893 ms of the ~950 ms gap, P32). Windows and Linux first-buffer are `[claimed]`; their probes are committed and unrun. Tracked: repo issue #1, and issue #3 whose title is now false. |
| **A human installs it and hears an agent reply** | ✅ **VERIFIED 2026-08-21.** Huddle mode spoke a live reply in a real ORCA session, on time and without repeating. |

## Open work

| Task | State |
|---|---|
| T086 marketplace entry, T087 tag v1 | not started — see "decide first" below |
| **M9a — the resident service (device held open), T088–T099** | not started. **Rescoped**: the deliverable is holding the audio device open, not swapping the synthesizer (`docs/design/015-m9-rescope.md`). Gate and falsifier: 015 section 6. Blocking measurement: **SPIKE-3 (T088), the held-device probe, `[claimed]` in every configuration today** |
| **M9b — Piper inside the service, T091–T097c** | not started; gated on **quality**, not latency. Piper's 52–65 ms `[measured-here]` (P11) is a regression guard here, not the gate |
| T100 host→panel channel PR | issue #15638 raised; awaiting ORCA's design decision |
| T102 `selection:read` PR | issue #15639-sibling #15637 raised; awaiting decision |

## Decide first

- **Marketplace entry (T086)** requires a `{kind:'git', url, ref}` pinned to an exact commit in an
  `orca-marketplace.json`. ORCA's index is theirs, not ours — submitting means asking them to list
  us, which is a second outward-facing action and needs approval.
- **Tag v1 (T087)** should wait until a human has actually heard it speak inside ORCA. Tagging
  something never run end-to-end by a person would be a version number claiming more than we know.

## Upstream (stablyai/orca)

- Issue #15637 — no plugin route to assistant text
- Issue #15638 — panel can play audio, no channel to receive it
- Issue #15639 — no session id on `agent.status.changed`
- **PR #15640** — projects `sessionId`; 6 new tests, their 359 existing plugin tests still pass

## What exists

- `packages/core` — normalizer (49 tests), chunker (21), queue (3), types. Zero imports, audited.
- `packages/providers` — `TtsProvider` seam, contract suite, `OsSynthProvider`, registry.
- `packages/plugin` — manifest, activate, adapter quarantine, clipboard, huddle + decoders +
  fixtures, subprocess sink, panel.
- `scripts/` — build, size-gate, smoke-synth, dev loop. `.github/workflows/ci.yml` — 3-OS matrix.

## Known gaps, named not hidden

1. **~950 ms between sentences** `[measured-here]` (p50 950/937/897 ms, n=18 ×3, `docs/.research/latency-measurements.md` 1.1). **The cause is the audio device, not the process** — spawn is 2.3 ms of it, the temp file 0.33 ms, and ~893 ms is CoreAudio open/pre-roll/post-roll/teardown. M9 fixes it **only if it holds the device open across chunks**; pooling player processes would save 2 ms of 950 (PITFALLS P32).
2. Correlation heuristic; two agents in one worktree → warns rather than guessing. PR #15640 fixes it.
3. 5 of 14 agents (only those with transcript decoders).
4. No editor selection; clipboard is the honest fallback.
5. Panel is display-only; `PanelSink` waits on #15638.

## Next action

Listening quality. It works; now find out where it sounds wrong. The obvious targets:
- a reply dense with code, file paths and keyboard symbols (⌘⇧S currently goes to the engine raw)
- the ~950 ms gap between sentences `[measured-here]` (M9 removes it only by holding the device open — P32)
- a very long reply — is queue-and-drop the right policy in practice?

## Reading order for a new agent

`HANDOFF.md` → `PITFALLS.md` → `.specify/memory/constitution.md` (Part II rules, Part III protocol)
→ this file → `docs/TASKS.md` → `docs/architecture.md`.
