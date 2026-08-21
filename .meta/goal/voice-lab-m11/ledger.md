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
