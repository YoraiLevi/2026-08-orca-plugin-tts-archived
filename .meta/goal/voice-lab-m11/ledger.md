# Ledger: voice-lab-m11

Append-only. One entry per Job outcome. Never edit past entries — they are the
audit trail that explains the whole session after the fact.

<!-- Append entries below as Jobs complete. Format:

### J-001  [done|blocked]
- did: <what the subagent produced>
- evidence: <command output summary / row count / commit SHA>
- audited_before: <yes/no>   tested_after: <yes/no>
-->

### J00 `spec` — running
- dispatched: R7-spec-m11. Owns `specs/002-voice-lab/**`.
- observed: directory exists; contents not yet verified.

### J01 `review7` — running
- dispatched: R7-review. Owns `docs/design/014-review-round7.md`.
- must also report whether round 7 was DRY — the author's stop condition counts it.

### J02 `spike1` — running
- dispatched: R7-spike. Owns `scripts/spikes/**`, `docs/.research/spike1-*.md`.
- observed: `scripts/spikes/` exists. Decides M9's scope; headless by construction.

### J03 `fma-fixes` — running
- dispatched: R7-fma-fixes. Owns `packages/**`, `docs/.research/fix-round7-report.md`.
- **blocks J11** — both land in `packages/`.

### J10 `fixtures` — running
- dispatched: J10-fixtures. Owns `fixtures/**` plus one test file.

### J13 `page` — dispatched early, dependency relaxed
- The plan had J13 depend on J11 (schema module). Relaxed deliberately: the page
  consumes the settings **JSON shape** specified in `011` section 3 and `004` section 7,
  not the TypeScript module. The shape is designed and frozen; the module is not written.
  This keeps the queue full while J03 blocks J11, and costs one integration step later.
- Risk accepted: if J11 changes the shape, the page needs an edit. The shape is
  specified in two committed documents, so the risk is small and named.

### J10 `fixtures` — done
- did: six fixtures in `fixtures/` per T110a–f — `code-heavy`, `tables`, `paths`,
  `architecture`, `short`, `hostile`. Plus a coverage test.
- evidence, **verified by the architect against an independent oracle**, not from the
  subagent's report: an out-of-band `normalize()` run over every fixture, asserting each
  produces output that differs from its input.
  ```
  architecture.md  3106 -> 3391 CHANGED     code-heavy.md  1824 -> 1568 CHANGED
  hostile.md       2095 -> 1983 CHANGED     paths.md       1576 -> 1897 CHANGED
  short.md          529 ->  595 CHANGED     tables.md      1432 -> 1918 CHANGED
  ```
  A fixture that passed through unchanged would exercise nothing; none did.
- suite: 186 -> **213 passing**, 15 files. No test plays audio.
- audited_before: no (mechanically simple, no shared path). tested_after: yes.
- note: `code-heavy` and `hostile` SHRINK (code and emoji removed); the other four GROW
  (paths, tables and units expand). Both directions are expected and are a cheap sanity
  check for anyone re-running this.

### J02 `spike1` — done
- did: `scripts/spikes/spike1-macos-firstbuffer.swift` (+ committed, unrun Windows and
  Linux probes), `docs/.research/spike1-resident-synth.md`.
- evidence, **re-run by the architect rather than read from the report** —
  `swiftc -O ... && /tmp/spike1-verify --n 10 --json`:
  ```
  SPIKE1_VERDICT=PASS medianFirstAudible=17.5 medianFirstBuffer=17.5 pass<=150 falsifier>350
  SPIKE1_COLD_PENALTY_MS=348.5     SPIKE1_SSML_MINUS_PLAIN_P50_MS=-0.2
  SPIKE1_IDLE_RSS_AFTER_MB=9.7     SPIKE1_IDLE_CPU_PERCENT=0.056
  ```
  Two independent runs agree: the agent measured p50 17.7/17.1, the architect 17.5.
- **The finding that redirects a milestone.** 010 section 8.2's pass condition was
  median first-buffer <= 150 ms, falsifier > 350 ms. Measured **17.5 ms — 8.5x inside
  the gate, 20x below the falsifier.** So residency alone buys R4.2 on the synthesis
  side of macOS and **the neural engine is not on the latency critical path.** M9 is
  "hold the audio device open", not "build the thing that makes latency acceptable".
- Three sub-findings worth as much as the headline:
  - **Cold start costs 348-366 ms**, i.e. the entire benefit is residency. A service
    that is respawned per utterance gains nothing.
  - **SSML is free**: -0.2 ms against plain text. 010 wanted it in the seam and it is
    the only route to pitch on Windows; it costs nothing to adopt.
  - **Idle cost is 9.7 MB RSS and 0.056 % CPU** — cross-review B-03 asked for this
    figure and nobody had it. A resident service is affordable to keep warm.
- Scope, stated honestly: **macOS measured; Windows and Linux are `[claimed]`.** Their
  probes are committed and runnable in one command. R1 says the three ship together, so
  this verdict is one third of an answer.
- audited_before: no. tested_after: yes — reproduced independently by the architect.

### J12 `server` — done
- did: `scripts/voice-lab.mjs`, `pnpm voice-lab`. `/normalize` returning 15 stage
  intermediates, `/speak` returning base64 WAV chunks, `/stop`, fixtures, settings inbox.
- evidence, **the architect ran C2's oracle rather than reading the report**: started the
  server, POSTed every fixture to `/normalize`, and compared `spoken` byte-for-byte with
  `normalize()` called directly from the library — the expected value comes from the
  library, never from the server's own output.
  ```
  PASS architecture.md stages=15   PASS code-heavy.md stages=15
  PASS hostile.md      stages=15   PASS paths.md      stages=15
  PASS short.md        stages=15   PASS tables.md     stages=15
  pass 6 fail 0
  ```
  Output lengths match the independent `normalize()` run recorded under J10 exactly
  (3391 / 1568 / 1983 / 1897 / 595 / 1918) — two separate paths, one answer.
- **The dist trap is closed, and it announces itself.** Startup prints:
  `normalizer .../packages/core/src/normalizer/index.ts (source, not dist — checked
  against 7 probes)`. That is a check that could have failed, not a comment claiming
  it cannot.
- bound to 127.0.0.1 only. Starting the server made no sound.
- audited_before: no. tested_after: yes, by the architect, against an external oracle.
- **C2 is NOT yet tickable**: it requires the page as well, and J13 is still running.
  The server half is verified; the criterion waits.

### J17 `m9-rescope` — done
- did: `docs/design/015-m9-rescope.md`; TASKS/STATE/HANDOFF updated; repo issue #3
  commented (not closed, not renamed).
- **It corrected the architect.** The dispatch brief quoted SPIKE-1 as *17.5 ms / 348-366
  cold*, which was the architect's own n=10 re-run. The agent read the committed document
  instead and reported **17.7 and 17.1 ms, n=20 per run over two runs**, flagging the
  discrepancy rather than adopting the briefing. Both are consistent; the point is the
  method. A subagent that trusts the brief over the artifact is how P32 happened.
  **Rule reaffirmed: brief from the artifact, and let the subagent check the brief.**
- M9's scope is now "hold the audio device open", not "swap the engine". Piper is argued
  on voice quality, on its own schedule, behind the seam — not smuggled back in on latency.
- audited_before: no. tested_after: partial — the architect verified the issue comment
  landed and that 015 states its own precedence over 010. The doc-level merge of 015 into
  010 is J20's, and until it happens **two documents describe M9**; 015 says which wins.

### J15 `ci` — done
- did: `.github/workflows/ci.yml` extended, `scripts/ci/voice-lab-ci.mjs`,
  `scripts/ci/no-audio-recorder.mjs`.
- evidence: committed at `2bdaeda`. Suite green. The no-audio guard is a recorder, not a
  log grep.
- **not yet verified by the architect**: the workflow has not run, because nothing has
  been pushed. Its assertions are read, not observed. C6 stays unticked until a real
  3-OS run is green — CI that has never executed is a claim, not a check.

### J03 `fma-fixes` — PARTIAL, killed by the 5-hour session limit
- landed before death, four commits: `ee8c1cf` (silence always has a spoken reason; the
  reap keeps the session — cascade C4), `ff7924b` (read the delivery receipt; name the
  six collapsed causes), `e80f0d3` (a check mark is a verdict; an unclosed fence eats the
  reply), `2772a01` (four unwatched promises observed; re-read a half-written line).
- **missing**: `docs/.research/fix-round7-report.md`. So there is no record of which FMA
  section-16 sites were closed, which were deliberately left, or what the interrupt policy
  decisions were. Re-dispatch must start by reading the four commits to find out.
- suite: 330 passing.

### J20 `reconcile7` — PARTIAL, killed by the 5-hour session limit
- 1,548 insertions left **uncommitted** in the working tree; committed by the architect
  rather than lost. Reached `PLAN.md`, `TASKS.md`, the constitution, and `010`-`013`.
- **missing**: `016-reconciliation-round7.md`, so nothing records which of round 7's 31
  findings are addressed. And `check-citations` went from **33 stale to 190** — the pass
  added citations faster than it verified them, and fixing `011`-`013`'s citations was its
  own task 4. Re-dispatch must close that.
- **Lesson for the ledger, not just this job:** a long-running Job that writes its ledger
  entry LAST loses the map when it dies. Future briefs should require the ledger row to be
  written incrementally, as each finding is resolved.

### J03 `fma-fixes` — RESUMED and done
- **forensics first, and the ledger was wrong**: J03 landed **eight** commits, not four. The four
  the entry above missed — `83f0a5d`, `7decced`, `cdb72bf`, `8bd984b` — are the four that closed
  the FMA's own "three to fix first" (finding 1, sites 31/32/33/35/36/41/42/43/44/45/46/53/54) and
  **cascade C6**. Reconstructed from `git show`; the dead agent wrote no report.
- did: `docs/.research/fix-round7-report.md` — **written and committed BEFORE the code** (50cc300),
  appended as each site closed. Then section 19 **rank 3** (cascade C1, provenance re-resolved at
  speak time), site **37**, section 19 **rank 4** (a pressed control answers aloud), site **24**'s
  unbounded deferred buffer, and an end-to-end test proving the new wire is wired.
- deliberately left, each with a written argument in the report: sites 16, 34, 40, 47, 49, 52.
  **49 and 52 are false positives** — verified by re-reading the source, not by trusting the audit.
- evidence: suite **330 -> 337**, 18 files, green. Every fix mutation-verified (the mutation and
  the exact red message are in each commit body). No test opens an audio device (P31).
- C6 was **re-verified by effect rather than redone**: reverting `await cancelSynthesis()` to
  `void` turns the guard red.
- new pitfall **P34**: a concurrent agent's `git add -A` swept this job's uncommitted source into
  `172c061`, and `git checkout` as an undo then reverted the whole fix. ~80 lines of rework.
- **next blind spot, ranked first**: section 19 rank 5 — whether the words spoken are the words
  that were written. Its cheap 60% is a corpus test over `fixtures/` asserting every input token
  appears in the output or in an announcement; it needs no offset map and would have caught the
  deleted check marks of site 50.
