# STATE — orca-plugin-tts

**Updated:** 2026-08-20 · **Phase:** v1 shipped to a public repo · **Branch:** `main` ·
**Repo:** https://github.com/YoraiLevi/orca-plugin-tts

## One-paragraph status

v1 is built, tested, published, and green on CI across macOS, Linux and Windows. 106 tests, lint
and typecheck clean, bundle 17 files / 0.06 MB against ORCA's 50 MB cap. Three gaps in ORCA's
plugin API are raised upstream, one of them with a merged-ready patch. The project is NOT finished:
two Definition-of-Done items are unmet and named below.

## Definition of Done — honest audit

| Criterion | State |
|---|---|
| No account, key, or network by default | ✅ |
| Hotkey speaks clipboard; second press stops < 50 ms | ✅ cancel measured at 1 ms |
| Huddle speaks replies, never thinking, never tool noise | ✅ fixture-asserted |
| CI green on three OSes | ✅ run 32403931195 |
| README documents limitations verbatim | ✅ |
| Memory files reconcile | ✅ |
| **First audio < 500 ms** | ❌ **927 ms on the OS synth.** Tracked: repo issue #1. Fixed by M9. |
| **A third party installs it and hears a reply** | ❌ **never verified by a human.** Needs the user. |

## Open work

| Task | State |
|---|---|
| T086 marketplace entry, T087 tag v1 | not started — see "decide first" below |
| M9 resident Piper service (T090–T097) | not started; the only thing that meets the latency budget |
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

1. ~970 ms between sentences (one player process per chunk) — M9 fixes it.
2. Correlation heuristic; two agents in one worktree → warns rather than guessing. PR #15640 fixes it.
3. 5 of 14 agents (only those with transcript decoders).
4. No editor selection; clipboard is the honest fallback.
5. Panel is display-only; `PanelSink` waits on #15638.

## Next action

Install it into a real ORCA and listen. Everything else is downstream of whether it sounds right.

## Reading order for a new agent

`HANDOFF.md` → `PITFALLS.md` → `.specify/memory/constitution.md` (Part II rules, Part III protocol)
→ this file → `docs/TASKS.md` → `docs/architecture.md`.
