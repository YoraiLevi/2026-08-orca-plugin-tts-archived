# HANDOFF — orca-plugin-tts

## What this project is
A Text-To-Speech plugin for **ORCA** (https://github.com/stablyai/orca), giving the agent a voice.

Two headline features:
1. **Speak selection** — hotkey reads highlighted text aloud.
2. **Huddle / conversational mode** — agent replies are spoken automatically as they stream, in
   digestible chunks, with UI affordances borrowed from `block/buzz`.

## Current phase
**Phase 0 — Research.** Nothing implemented. Research agents are mapping:
- ORCA plugin API surface + how to tap agent reply markdown
- `block/buzz` TTS/STT architecture
- TTS engine landscape (local + cloud)
- speckit (spec-driven development) workflow

## Where things live
- `docs/.research/` — raw research artifacts (hot). Promote to `docs/` when settled.
- `docs/.discussion/` — open questions with Options + Recommendation bodies.
- `specs/` — speckit-style specs.

## Next agent picks up from
Read `docs/.research/` index once it exists.
