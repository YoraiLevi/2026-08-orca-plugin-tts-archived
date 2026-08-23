# R18-01 + R18-02 repair evidence

**SHA of shared tree while measuring:** `cede484` · **load:** 2.04 / 2.83 / 3.00 going into first-red; 1.81 / 2.74 / 2.97 on the clean build `[measured-here]`.
**No `say` leaked** (`pgrep -x say` empty at start and end of both builds). Mutant lived only in `/tmp/r18-01-guard-red` (P41). `models.ts` and `stage-pocket-model.mjs` were not edited.

## R18-01 first-red — round 18's own stub mutant, after the guard change

Worktree at `cede484` plus this repair's `scripts/{build,artifact-e2e,artifact-score}.mjs`. Mutant as 026 specified: `activate()` registers `{ id:'pocket', prepare(){ throw new Error('pocket: mutant stub, real class skipped') } }` when `pocket` is omitted; factory no longer default-constructs `PocketSynthProvider`.

```
Error: dist/plugin/main.mjs consult arm did not run the bundled PocketSynthProvider.prepare(). A stub with id:'pocket' whose throw contains "pocket:" is not the real class (R18-01). Want PocketModelUnavailableError naming this empty dir (/var/folders/4y/1j0rlkg97bq9l3smp56y8t840000gn/T/orca-tts-artifact-guard-0PGFzr/empty-FGC5Ld) and enumerating mimi_encoder.onnx. error="read-aloud: no speech engine is available on this system (prepare-failed) — pocket: pocket: mutant stub, real class skipped; os-synth: diagnostic: OS floor forced down" logs=[]
    at assertShippedProvidersByEffect (file:///private/tmp/r18-01-guard-red/scripts/build.mjs:204:13)

BUILD_EXIT:1
=== PocketSynthProvider in mutant bundle ===
ZERO hits
=== mutant stub in bundle ===
5015:        throw new Error("pocket: mutant stub, real class skipped");
=== PocketTts in bundle ===
no PocketTts
```

The haystack still contains `pocket:` (the old predicate would have stayed green). The new predicate requires `Pocket TTS model is not ready in ${emptyDir}` and `mimi_encoder.onnx`.

## After — clean tree, no mutant

```
build: dist/plugin/ (orca-plugin.json, main.mjs, panel.html, orca-tts.mjs)
BUILD_EXIT:0
=== PocketSynthProvider in clean bundle ===
1783:var PocketSynthProvider = class {
=== mutant stub must be ABSENT ===
no stub (want this)
```

`dist/plugin/main.mjs` was restored to HEAD after this rebuild so a peer's in-progress `models.ts` (R18-04) was not baked into the artifact.

## R18-02

`judge()` in `scripts/artifact-score.mjs` is the only place that picks 0/1/2. ABSENT is scored first. Unnamed substitution + no model → exit 1. Healthy ABSENT + no model → exit 2. Incomplete/stale → exit 1. Parent no longer `process.exit(2)` before scoring.

`.github/workflows/ci.yml` now states: ABSENT (OS floor + named substitution) is covered on every runner; PRESENT 24 kHz is not covered on a hosted runner with no model; exit 2 is only "PRESENT could not run".

## Gates

| | |
|---|---|
| `pnpm exec vitest run scripts/build.test.mjs scripts/artifact-e2e.test.mjs` | **17 passed** |
| plus peer `scripts/artifact-e2e-p31.test.mjs` (R18-03, not ours) | **29 passed** together |
| R17-02 / wiring tests in `main.test.ts` | **6 passed** (15 skipped) |
| `pnpm typecheck` | **0** |
| `pnpm lint` | **0 errors**, 49 pre-existing warnings |
| `pnpm build` (clean) | **0** |
| full `pnpm test` | **not run** in the shared tree (P40) |

`scripts/artifact-e2e.mjs` also contains R18-03's P31 spawn recorder (`proveP31`, `applyP31`). That overlap is in the same file; this repair did not revert it.
