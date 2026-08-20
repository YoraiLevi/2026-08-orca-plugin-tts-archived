# STATE — orca-plugin-tts

**Updated:** 2026-08-20 · **Phase:** 5 (implementation) → complete to the approval gate · **Branch:** `main`

## One-paragraph status

The plugin is built and tested. 105 tests green, lint clean, typecheck clean, bundle 17 files /
0.06 MB against ORCA's 2,000-file / 50 MB cap. CI is written for all three OSes but **has never
run**, because the repo has no remote — pushing it is the approval gate. M9 (resident Piper
service) is deliberately post-v1.

## STOPPED AT — approval gate (constitution Part III, STOP condition 1)

Two things remain and both are irreversible and outward-facing (R056–R058):

| Task | Needs |
|---|---|
| **T085** create the public GitHub repo and push | your explicit approval |
| **T100–T102** three PRs against `stablyai/orca` | your explicit approval |

Everything reachable without approval is done. `T086` (marketplace entry) and `T087` (tag) follow
T085 mechanically.

## Definition of Done — honest audit

| Criterion | State |
|---|---|
| Third party installs from a public repo and hears a reply | ❌ blocked on T085 |
| No account, key, or network in the default path | ✅ OS synthesizer, zero setup |
| Hotkey speaks clipboard; second press stops < 50 ms | ✅ cancel measured at 1 ms |
| Huddle speaks replies, never thinking, never tool noise | ✅ T076 fixtures assert it |
| First audio < 500 ms | ⚠️ **not met on the OS synth** — 927 ms measured on darwin. M9 (Piper, 52–65 ms) is what meets this. Stated, not hidden. |
| CI green on three OSes | ⚠️ written, never executed — no remote |
| README documents limitations verbatim | ✅ |
| Memory files reconcile | ✅ this file |

## What exists

- `packages/core` — normalizer (49 tests), chunker (21), queue (3), types. Zero imports, audited.
- `packages/providers` — `TtsProvider` seam, contract suite, `OsSynthProvider` (mac/win/linux), registry.
- `packages/plugin` — manifest, `activate`, adapter quarantine, clipboard, huddle + decoders +
  fixtures, subprocess sink, panel.
- `scripts/` — build, size-gate, smoke-synth, dev loop.
- `.github/workflows/ci.yml` — 3-OS matrix.

## Assumptions taken by default (T001, still reversible)

- One repo, two packages. · MIT licence. · v1 is OS-synth-only; Piper service is M9.

## Known gaps, named not hidden

1. **Inter-sentence gap.** One player process per chunk. M9's resident service fixes it.
2. **Correlation heuristic.** Two agents in one worktree → warns, speaks most recent.
3. **5 of 14 agents.** Only those with transcript decoders.
4. **No editor selection.** Clipboard is the honest fallback until upstream `selection:read`.
5. **Panel is display-only.** No host→panel channel exists; `PanelSink` waits on upstream PR 1.

## Next action

Ask the user to approve T085. On approval: create the repo, push, watch CI on three runners, fix
what the Linux and Windows runners surface (nothing has ever executed there), then T086/T087.

## Reading order for a new agent

`HANDOFF.md` → `PITFALLS.md` → `.specify/memory/constitution.md` (Part II rules, Part III protocol)
→ this file → `docs/TASKS.md` → `docs/architecture.md`.
