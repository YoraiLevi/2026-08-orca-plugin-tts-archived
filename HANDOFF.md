# HANDOFF — orca-plugin-tts

## What this project is
A Text-To-Speech plugin for **ORCA** (https://github.com/stablyai/orca), giving the agent a voice.

Two headline features (not the full list):
1. **Speak selection** — hotkey reads highlighted text aloud.
2. **Huddle / conversational mode** — agent replies are spoken automatically as they stream, in
   digestible chunks, with UI affordances borrowed from `block/buzz`.

## Hard requirements (from the user, non-negotiable)

| # | Requirement | Implication |
|---|---|---|
| R1 | **Cross-platform parity.** macOS, Linux, Windows — identical features, out of the box. | No macOS-only default engine. No `afplay`. Native deps must have prebuilts for all platform+arch combos or be disqualified. |
| R2 | **Local buildable + live-debuggable.** A developer can build the plugin from source and load it into a running ORCA to debug. | Need ORCA's dev-load / hot-reload story documented before design freezes. |
| R3 | **Installable by third parties.** | Must conform to ORCA's real distribution mechanism (registry / manifest / URL — TBD by research). |
| R4 | **Tests + CI/CD + docs before publishing.** CI must run on all three OSes. | Engines that can't be exercised headlessly in GitHub Actions are a flagged risk. |
| R5 | **Publish to a public GitHub repo** — only once R4 is genuinely satisfied. | Not "tests exist" — tests pass, verified by effect. |

## Current phase
**Phase 0 — Research.** Nothing implemented. Four research agents running:

| Agent | Scope | Output |
|---|---|---|
| orca-api-scout | ORCA plugin API; how to tap agent reply markdown; build/dev-loop/install/publish; per-OS paths | `docs/.research/orca-plugin-api.md` |
| buzz-scout | `block/buzz` architecture: streaming chunker, speech normalization, barge-in, UI inventory, portability | `docs/.research/prior-art-buzz.md` |
| tts-engine-scout | Engine landscape, cross-platform strategy, audio playback, + mining YoraiLevi's stars/gists | `docs/.research/tts-engine-landscape.md` |
| speckit-scout | Spec Kit workflow + templates; merge with STATE/HANDOFF/PITFALLS | `docs/.research/speckit-workflow.md` |

## Open questions blocking design
1. Does ORCA expose a streaming hook for assistant messages, and is the payload markdown or
   structured blocks? (Everything about huddle mode depends on this.)
2. Can a plugin register a hotkey and read the editor selection on all three OSes?
3. One portable neural engine as default, or three OS-native synths behind one interface?

## Where things live
- `docs/.research/` — raw research artifacts (hot). Promote to `docs/` when settled.
- `docs/.discussion/` — open questions with Question + Options + Recommendation + Engineer-prompt bodies.
- `specs/` — speckit-style specs (layout pending speckit-scout's recommendation).

## Next agent picks up from
Read the four research files above, then `docs/.discussion/`.
