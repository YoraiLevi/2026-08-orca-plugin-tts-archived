# STATE — orca-plugin-tts

**Updated:** 2026-08-23 (later) · **Phase:** Pocket TTS usable end to end; awaiting the author's ear · **Branch:** `main` ·
**Repo:** https://github.com/YoraiLevi/orca-plugin-tts

> **Amended 2026-08-21 — forced by the latency measurement pass** (`docs/.research/latency-measurements.md`).
> The `927 ms` first-audio figure previously printed in the audit table below was **unsupported and
> unreproducible**: it came from an unrecorded single run of `scripts/speak-e2e.mjs`, which measures
> neither end of the budget and does not execute today, and it sits **below the minimum of all twenty
> measured samples**. Every performance number in this file now carries an R006 label
> (`[measured-here]` with a run count, `[documented]` with a citation, `[claimed]` when nobody has run
> it). See also PITFALLS **P32** — the inter-sentence gap is the audio device, not the process spawn.

## IN PROGRESS — one task, named, per R041

**`PV-review19` is running against the frozen `db11fea`. Everything else waits on the author's ear.**

### Round 18: 5 findings, 5 confirmed, all closed at `db11fea`

Round 18 reviewed round 17's *repair* and found five. Two were in the command the author had just
been told to run.

| | closed by | verified by |
|---|---|---|
| R18-01 the "effect" guard was a LOG SUBSTRING | `db11fea` | round 18's own stub mutant: **BUILD_EXIT 0 -> 1** |
| R18-02 exit 2 skipped the ABSENT arm; CI maps 2 to green | `db11fea` | an unnamed substitution is now exit 1, not 2 |
| R18-03 the P31 leak check was WRITE-ONLY | `db11fea` | `--prove-p31`: 5 rows, RED on bare `say`, GREEN on `say -o` |
| R18-04 `ready` came from `readdir` NAMES | `a937d11` | delete the symlink source: `ready` -> not ready |
| R18-05 the R061 refusal was a string prefix | `a937d11` | non-existent dest via symlinked parent: **false -> true** |

**The same guard has now been defeated twice.** `scripts/build.mjs` asserted a class NAME (R17-02),
was repaired to assert a log SUBSTRING, and a stub with `id: 'pocket'` defeated that (R18-01). It now
demands the bundled provider raise `PocketModelUnavailableError` naming the empty directory and
enumerating `mimi_encoder.onnx`. Round 19's first job is to defeat it a third time.

**P50 is the lesson that generalises** and it is about the coordinator, not the code: the R061
refusal was written, tested, and hand-verified — I watched it refuse by name and watched its control
return false — and round 18 walked past it, because I passed a destination that EXISTS and the
product passes one that does NOT. Check the shape the product produces, not the shape that is easy
to build.

The step-by-step for that review is **`docs/REVIEW-SCRIPT.md`** — two commands, a named expected
result at each step so a wrong one reads as a defect rather than as his problem, the four C7 taste
questions in the shape the answers are needed, and the two policy calls left to him.

**He already has the weights.** `node scripts/stage-pocket-model.mjs` symlinks
`~/.buzz/models/pocket-tts` into the product cache and writes our marker there; no 173.8 MB
download, and nothing is ever written into buzz's directory.

### Round 17: 7 findings, 7 confirmed, all closed

| | closed by | verified by |
|---|---|---|
| R17-01 the artifact could not load its engine | `226e39d` | `prepare-failed, 0 chunks` -> **24000 Hz, rms 0.0768** |
| R17-02 the bundle guard proved a STRING | `ef837f0` | round 17's own mutant (name kept as a log string) now goes RED |
| R17-03 a failed download deleted the LIVE runtime | `76de03f` | `liveExists false` -> `true` under `afterStage` injection |
| R17-05 `safe-swap.ts` did not contain the swap | `76de03f` | re-inlining a rename turns the guard red **and nine behaviour tests with it** |
| R17-06 the documented assembler had no caller | `ef837f0` | inverting the factory's preference is now observable |
| R17-07 three answers to "is Pocket installed" | `ba9a40f` | buzz -> `incomplete` naming the marker; empty CONTROL stays `absent` |
| — the setting that makes it usable | `d4f9ff0` | `probe:artifact` PASS: PRESENT 24 kHz `rung=preferred`, ABSENT names the substitution |

**R17-01 is the one to learn from.** `#loadEngine` used `import(ENGINE_MODULE)` — a VARIABLE.
esbuild cannot follow one, so it left a runtime import of `dist/plugin/engine.ts`, a file the
artifact does not contain, while the engine sat inlined in the bundle reached by the LITERAL import
three lines above. **One specifier defeated three instruments**: a substring guard saw the string,
SC-14's graph walk followed the literal and walked past the broken door, and every provider test
injects `loadEngine` so none took the path at all.

### The gate discipline that now exists, and its residue

`pnpm probe:artifact` drives the SHIPPED `dist/plugin/main.mjs`. Exit codes were checked by effect:

  0 = model present and neural audio verified · **1 = a real defect (corrupt model -> 1, not 2)**
  2 = genuinely no model, INCONCLUSIVE · 3 = dirty machine or missing bundle

**The residue, stated rather than hidden:** CI runners never have a model, so CI always takes the
exit-2 path and the conclusive arm runs only when a human with the weights runs it. Round 18 is
testing whether an ABSENT-arm failure can also hide behind exit 2 — a hole I did not think to check.

### The author-facing claim that was wrong, and is now closed

I twice reported *"Arm B heard Pocket TTS"*. True — but only because `ui-probe` staged a manifest
marker the author's own Voice Lab never staged. On his machine the Lab said the backend was not
installed. The probe no longer treats `~/.buzz` as installed, so it can no longer tell him something
his product will not.

### What closed this session, and how it was checked

Round 16's six findings are **all closed**, and closing the last of them uncovered four more, which
are also closed. The pattern held to the end: every one was *a check that could not fail for the
thing it watches.*

| | closed by | verified by |
|---|---|---|
| R16-04 tokenizer remainder | an agent's `EncodeOptimized` port | **27,309 inputs, 0 disagreements** against Python `sentencepiece`, on corpora its fixer did not choose |
| R16-05/06 the probe was calibrated to the fallback | `afbdcc8` | Pocket ABSENT -> `[INCONC] U6`; Pocket PRESENT -> `U6/U9` green and **"Arm B heard Pocket TTS, not the OS fallback"** |
| R16-07 the engine could not load | `44c9d0a` | `engine.ts` under plain node: **FAILS -> LOADS** |
| R16-08 every offered voice 503'd | `3902a00` | real model: **503 -> 200**, `backend:"pocket"`, 24 kHz, 1.76 s, rms 0.14 |
| R16-09 `pnpm build` was red | `0c66191` | un-externalise ORT -> esbuild errors again |
| R16-10 the plugin shipped no neural backend | `0c66191` | unregister -> **"does not contain PocketSynthProvider"** |

**The chain is worth reading in order**, because each defect was hidden by the one before it. The
probe could not tell the OS from Pocket (R16-05), so nobody saw that the engine would not load
(R16-07); once it loaded, every voice returned 503 (R16-08); once they spoke, the build turned out
to have been red (R16-09) and the plugin turned out never to have registered the backend at all
(R16-10). **Four defects stacked behind one blind instrument.** Fixing the instrument first is what
made the rest findable, and that is the argument for fixing instruments first.

### The two that should sting

- **R16-10.** 975 tests, a working Voice Lab, a review round of its own — and `grep -c
  PocketSynthProvider dist/plugin/main.mjs` was **0**. Every test reached the provider by a path the
  plugin does not take. Recorded as **P49**; the guard is now on the artifact, not the source.
- **R16-08 was already in the mailbox.** PV-074's worker wrote: *"a peer still needs
  PocketSynthProvider.#resolveVoice to accept that bare name or a ready model will throw."* Nobody
  actioned it. **Reading `git log` instead of `orca orchestration check` has now cost this project
  twice.** Read the mailbox.

### Where the feature stands at `0c66191`

**977 passed | 9 skipped · typecheck 0 · lint 0 errors · build green · size-gate 4 files, 0.24 MB.**

`node scripts/ui-probe.mjs` reports **all nine checks arm A plus two arm B, exit 0**, and its last
line is the one that was missing for three rounds: *"Arm B heard Pocket TTS, not the OS fallback."*
Those green checks now mean what they say. `--prove` still drives every declared mutation red.

**NOT run in this tree:** `pnpm check:mutants` (P41 — never in the shared working tree). CI runs it.

### What is actually left

1. **The author's review.** The whole point. The Voice Lab works, the picker offers both backends,
   and neural voices play. C7 taste defaults, D002 Q5 policy and D004's principle-III call on Intel
   Macs are all his and only his.
2. **Round 17**, if wanted. Rounds 14-16 each found real defects; round 16 found six and its repair
   found four more, so the well is not dry.
3. `PocketSynthProvider` is now registered in the plugin but **has never been exercised inside a
   running ORCA** — only in tests, the Lab, and the bundle guard. That is the next honest gap.

### Dispatch notes

`grok` launches clean on the first try. `codex` needs its update prompt dismissed before every
worker will start. The `claude` launcher is disabled and the Agent tool cannot spawn.

**Two process lessons from this session.** A worker was still alive and EDITING `ui-probe.mjs`
while I measured it, so my first two runs described a file that changed under me — check
`orca orchestration task-list` for `dispatched` tasks before trusting a measurement. And six
orphaned test processes were holding the machine, one hung since 02:59; a probe that shares the
machine with another probe is not evidence (P46's cousin).

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
