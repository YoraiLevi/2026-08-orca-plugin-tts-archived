# Plan — M11 Voice Lab

Jobs are sliced so no two touch the same files. Parallel dispatch is safe within a wave.

## Wave 0 — in flight when this goal was formed

| Job | Scope (files it owns) | Status |
|---|---|---|
| J00 `spec` | `specs/002-voice-lab/**` | running (R7-spec-m11) |
| J01 `review7` | `docs/design/014-review-round7.md` | running (R7-review) |
| J02 `spike1` | `scripts/spikes/**`, `docs/.research/spike1-*.md` | running (R7-spike) |
| J03 `fma-fixes` | `packages/**`, `docs/.research/fix-round7-report.md` | running (R7-fma-fixes) |

## Wave 1 — the lab's own parts, disjoint by construction

| Job | Depends | Scope (files it owns) | Postcondition |
|---|---|---|---|
| J10 `fixtures` | — | `fixtures/*.md` | Six fixture files per T110a–f, committed and reviewable |
| J11 `schema` | J00 | `packages/core/src/settings/**` | Schema + defaults; T124's iteration test red without a control |
| J12 `server` | J10, J11 | `scripts/voice-lab.mjs` | `/normalize`, `/speak`, `/stop` on 127.0.0.1; imports TS source, never `dist/` |
| J13 `page` | J11 | `voice-lab/index.html` | Self-contained, no CDN, controls + side-by-side + A/B |
| J14 `roundtrip` | J12, J13 | `packages/core/src/settings/*.test.ts` | C4's two-path equality test |
| J15 `ci` | J12 | `.github/workflows/**` | 3-OS, headless, silent; no player spawned |
| J16 `gate` | J13 | `scripts/bench-latency.mjs` (lab probe only) | C3 measured, labelled, silent by default |

**Collision note.** J16 edits `bench-latency.mjs`, which J02 does not touch (J02 owns
`scripts/spikes/`). J11 and J03 both touch `packages/` — **J11 waits for J03 to land.**

## Wave 2 — reconcile and hand to the listener

| Job | Depends | Scope | Postcondition |
|---|---|---|---|
| J20 `reconcile7` | J01 | `docs/design/**`, `docs/.discussion/**` | Round-7 findings amended into the designs |
| J21 `handoff` | all | `HANDOFF.md`, `STATE.md`, `docs/TASKS.md` | Memory files reconciled; M11 marked against its gate |
| J22 `listen` | J12–J16 | — | **The author runs the lab and settles C7.** Agent work ends here. |

## Ordering rule

M11 first and alone. M12 settings ships *inside* M11 because ORCA renders no settings UI
(Q35) — the lab is the settings surface, so the schema is not a separate milestone.
