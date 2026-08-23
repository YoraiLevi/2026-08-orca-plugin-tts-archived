# 025 — Round 17: the R16-10 repair stopped one layer short

**Status:** adversarial review record. **Written:** 2026-08-23.
**Subject:** the surfaces round 16's *repair* left unexamined: `packages/plugin/src/main.ts`
registering `PocketSynthProvider`, `scripts/build.mjs`'s new bundle guard,
`scripts/seam-stage-identity.test.mjs`'s new graph walk, `pocket-synth/safe-swap.ts` and
`runtime.ts`, and the queue/cancel path under a real Pocket generation.
**Review base:** `adecd4e`, frozen in a clean detached worktree at `/tmp/r17-review-base`
before experiments began. The shared tree was not used for mutants. Every mutant lived
only in the disposable worktree and was restored. Nothing opened an audio device (P31).
The author's Pocket weights at `~/.buzz/models/pocket-tts` were read through a symlink
(R061); nothing was written there.

This is a review, not a repair. No product source, test, spec, manifest, generated
artifact, or shared-memory file in the shared worktree was changed.

The method was first-red: for each check that claimed to watch a thing, break that thing
and record whether the check went red. A check that stayed green is the finding, and the
exact green output is the evidence.

## Verdict

**ROUND 17: 7 findings, 7 confirmed**

`CONFIRMED` means this round ran a discriminating probe and observed the named effect.
There are no suspected-only findings. Severity is impact if the reviewed path is used.

The pattern held. Round 16's repair of "the shipped plugin had no neural backend" left a
class in the artifact whose engine load is a dynamic import of a file the artifact does
not contain. The guard written to prevent that is a substring search. The graph walk
written to prevent R16-07 follows a *different* import of the same module. Three
instruments, three costumes, one specifier.

| Finding | Status | Severity | Short result |
|---|---|---:|---|
| R17-01 | CONFIRMED | critical | The shipped `dist/plugin/main.mjs` inlines `PocketTts` and then loads the engine with `import("./engine.ts")`, a sibling that does not exist. A ready model, production `PocketSynthProvider`, OS floor forced unusable: `prepare-failed` naming the missing file. `grep -c PocketSynthProvider` is 2. |
| R17-02 | CONFIRMED | high | The R16-10 wiring test is an injection seam. The bundle guard is `bundle.includes('PocketSynthProvider')`. Deleting the production constructor, keeping the name as `host.log("PocketSynthProvider")`: tests 2/2 green, `pnpm build` green, the class gone. |
| R17-03 | CONFIRMED | high | `downloadRuntime`'s `catch` does `rm(dir)` on every failure, including a throw *before* the swap. `afterStage` injection with a working runtime: live directory deleted. The named swap-safety tests are 24/24 green — they inject `afterBackup` / `afterSwap`, never `afterStage`. |
| R17-04 | CONFIRMED | high | SC-14 walks the *literal* `import('./engine.ts')` inside `#loadOrt`. Production `#loadEngine` is `import(ENGINE_MODULE)`, unfollowable. `ENGINE_MODULE = './engine.js'`: SC-14 14/14 green, provider tests 17/17 green, production `prepare()` cannot find `engine.js`. |
| R17-05 | CONFIRMED | high | `safe-swap.ts` does not contain the swap. `models.ts` and `runtime.ts` inlined different ones. Runtime leftover `.staging-*` is never cleaned: the `finally` callback swaps `(base, name)` argument order. Models' `isStagingName` cleans the same debris; runtime's does not. |
| R17-06 | CONFIRMED | medium | `createProviderRegistry()` is still the documented assembler and still has no production caller. Inverting which backend is preferred: plugin R16-10 tests 2/2 green. `main.ts` duplicates the factory and they are never compared. |
| R17-07 | CONFIRMED | medium | Two predicates for "Pocket is installed". `modelDir()` is `~/Library/Application Support/orca-tts/...` and is absent. `~/.buzz/models/pocket-tts` has every required file except `.orca-tts-model-manifest`. `ui-probe` finds the buzz cache by `tokenizer.model` + `eve.wav` and stages the marker. Vanilla `pnpm voice-lab` and the plugin do not. |

Real Pocket cancel on the *source* provider, against a staged copy of the author's model,
resolved in 30 ms and yielded no audio. That path cannot be reached from the artifact
(R17-01). The test named `PV-072 cancel reaches the engine frame loop` uses a stub that
has no `framesFor`; a sibling test does, and went red when `#renderFrames` was broken.
Not counted separately: the property is guarded, the name is not.

---

## R17-01 — The shipped plugin cannot load the neural engine

**CONFIRMED · critical · Principles I, II, III and VI; R16-10's costume one layer down; R16-07's specifier**

### What the code does

R16-10's repair put `new PocketSynthProvider()` in `packages/plugin/src/main.ts:215` so
esbuild would keep the class. It did. `dist/plugin/main.mjs` contains both the inlined
engine (`engine_exports.PocketTts` at line 736) and this constructor (line 1776):

```javascript
this.#loadOrt = opts.loadOrt ?? (async () => {
  const { loadOrt: loadOrt2 } = await Promise.resolve().then(() => (init_engine(), engine_exports));
  return loadOrt2();
});
this.#loadEngine = opts.loadEngine ?? (async () => await import(ENGINE_MODULE));
```

`#loadOrt` was rewritten to the inlined module. `#loadEngine` was not, because the
specifier is a variable (`ENGINE_MODULE = "./engine.ts"` at line 1644). `prepare()` then
does `const { PocketTts } = await this.#loadEngine()` (line 1802). There is no
`dist/plugin/engine.ts`. `PocketTts` is already in the bundle and is not the object
`#loadEngine` returns.

Voice Lab and every Pocket unit test reach the provider through source, or inject
`loadEngine`. None of them load `dist/plugin/main.mjs` and ask `prepare()` to finish.

### First-red probe

Staged the author's model as symlinks plus `.orca-tts-model-manifest` (R061). Forced the
OS floor to fail so `registry.resolve()` had to consult Pocket — the same arrangement the
R16-10 wiring test uses, pointed at the *artifact*. `pocket` option omitted, so the
production default constructor runs. No audio device.

Command:

```text
ORCA_TTS_MODEL_DIR=<staged> node --experimental-strip-types .r17-probe-artifact-engine.mjs
```

Load averages **2.67 / 3.06 / 3.11** `[measured-here]`. Exact log line:

```text
read-aloud: no speech engine is available on this system (prepare-failed) — os-synth: no system synthesizer on this machine; pocket: Cannot find module '/private/tmp/r17-review-base/dist/plugin/engine.ts' imported from /private/tmp/r17-review-base/dist/plugin/main.mjs
```

Control, same staged model, *source* `PocketSynthProvider.prepare()`: **prepared in 259 ms,
`warm: true`**. The named value that moved is the engine load: source succeeds, artifact
names a file that is not in `dist/plugin/` (`ls` of that directory is `main.mjs`,
`orca-plugin.json`, `orca-tts.mjs`, `panel.html`).

The R16-10 metric on this same artifact:

```text
grep -c PocketSynthProvider dist/plugin/main.mjs
2
```

### Required remedy

Make `#loadEngine` a literal `import('./engine.ts')` (or reuse `engine_exports` the way
`#loadOrt` already does) so esbuild inlines it. Add a check that *executes the artifact*:
stage a ready cache, `activate()` from `dist/plugin/main.mjs` with the OS floor unusable,
demand `engine ready` naming Pocket, not `Cannot find module .../engine.ts`. A substring
search for the class name cannot fail for this.

---

## R17-02 — The R16-10 instruments watch a name and an injection seam

**CONFIRMED · high · Principles V and IX; P49; R16-10's own guard**

`packages/plugin/src/main.test.ts` "registers Pocket, so the registry actually consults
it" boots with `pocket: fakePocket()`. Every other `boot()` in that file passes
`pocket: false`. The production line `options.pocket ?? new PocketSynthProvider()` is
never executed by the suite: `false` is not nullish, and a fake is not nullish.

`scripts/build.mjs:83-84` is:

```javascript
const required = ['PocketSynthProvider', 'OsSynthProvider']
const missing = required.filter((name) => !bundle.includes(name))
```

### Mutant

Deleted the `PocketSynthProvider` import and the production constructor. Replaced with:

```javascript
const pocket = options.pocket ?? false
if (pocket !== false) registry.register(pocket)
else host.log('PocketSynthProvider')
```

Command:

```text
pnpm exec vitest run packages/plugin/src/main.test.ts -t "R16-10"
node scripts/build.mjs
rg -n PocketSynthProvider dist/plugin/main.mjs
```

Load averages **4.96 / 3.74 / 3.32** `[measured-here]`.

Wiring tests: **2 passed | 14 skipped**. Build: **exit 0**,
`build: dist/plugin/ (orca-plugin.json, main.mjs, panel.html, orca-tts.mjs)`.
The only occurrence in the fresh bundle:

```text
4944:  else host.log("PocketSynthProvider");
```

A first mutant that used `void 'PocketSynthProvider'` (no live use) *did* turn the guard
red — esbuild DCE dropped the string — so the guard can fail for a complete absence of
the bytes. It cannot fail for a log string. Tree-shaking is what R16-10 asked about;
`includes` is a claim about punctuation.

Control: restore. Dist again contains `var PocketSynthProvider = class {` and
`new PocketSynthProvider()`.

### Required remedy

The wiring test must construct the production default (against an isolated temp cache,
never the author's). The bundle guard must require a constructor call — or, cheaper and
stronger, run R17-01's artifact `prepare()` and demand it does not name `engine.ts`.

---

## R17-03 — Runtime swap-safety still does not reach a pre-swap failure

**CONFIRMED · high · Principles I, II, V and VI; R16-03's catch path; R14-06**

`runtime.ts:317-330` is one `try` around staging *and* swap. The `catch` is:

```javascript
await rm(dir, { recursive: true, force: true })
if (existsSync(backup)) await rename(backup, dir)
```

`afterStage` fires at line 317, *before* `rename(dir, backup)`. A throw there still
executes `rm(dir)`. The live runtime is the directory that just got deleted, and there
is no backup yet.

`models.ts` does not do this. Staging failures are an inner `catch` that only removes
staging and rethrows; live is untouched. The licence-refusal test
(`models.test.ts`, "R14-08: REFUSES to install when the upstream licence cannot be
fetched") seeds a previous cache and asserts `stillPrevious`. That is the contrast.

### First-red probe

No source mutation. The test seam `hooks.afterStage` is the injection R16-03 asked for
and then did not use. Seeded a working `linux-x64` runtime, called `downloadRuntime`
with `afterStage: () => { throw new Error('injected: died while staging') }`.

Load averages **5.92 / 3.63 / 3.25** `[measured-here]`. Exact output:

```json
{"name":"A-afterStage-throw","threw":"injected: died while staging","liveExists":false,"stillPrevious":false,"siblings":[],"dirListing":null}
```

The named tests, same tree, no mutation:

```text
pnpm exec vitest run packages/providers/src/pocket-synth/runtime.test.ts
✓ packages/providers/src/pocket-synth/runtime.test.ts (24 tests) 21ms
Test Files  1 passed (1)
     Tests  24 passed (24)
```

Load averages **5.69 / 3.62 / 3.25**. They inject `afterBackup` and `afterSwap`. They
cannot fail for a throw that happens earlier, which is the window `afterStage` exists to
name.

### Required remedy

Give `downloadRuntime` the same nested catch `downloadModel` already has: a staging
failure must not `rm(dir)`. Add the missing `afterStage` + previous-cache case to
`runtime.test.ts`. Folding the swap itself into `safe-swap.ts` (R17-05) is what stops
the next cache from copying this `catch` a fourth time.

---

## R17-04 — SC-14 follows a different import of the engine than `prepare()` uses

**CONFIRMED · high · P48 / R16-07's fifth costume, now a sixth**

`PocketSynthProvider` loads the engine two ways:

- `#loadOrt` default: `await import('./engine.ts')` — a literal, walked, inlined in the
  bundle.
- `#loadEngine` default: `await import(ENGINE_MODULE)` with
  `const ENGINE_MODULE = './engine.ts'` (`index.ts:24`) — a variable, unfollowable, left
  as a runtime import.

SC-14's walk (`scripts/seam-stage-identity.test.mjs:418-441`) collects
`from '...'` and `import('...')` *literals*. It then loads every discovered `.ts` file
under plain node. `ENGINE_MODULE` is not a literal, so the walk's opinion about
`engine.ts` is the *other* import.

### Mutant

```javascript
const ENGINE_MODULE = './engine.js'
```

Commands:

```text
pnpm exec vitest run scripts/seam-stage-identity.test.mjs -t "SC-14"
pnpm exec vitest run packages/providers/src/pocket-synth/provider.test.ts
node --experimental-strip-types .r17-probe-engine.mjs
```

Load averages **4.61 / 3.51 / 3.22** `[measured-here]`.

SC-14: **14 passed | 11 skipped**. Provider tests (every one injects `loadEngine`):
**17 passed**. Production default `prepare()`:

```json
{"ok":false,"name":"Error","message":"Cannot find module '/private/tmp/r17-review-base/packages/providers/src/pocket-synth/engine.js' imported from /private/tmp/r17-review-base/packages/providers/src/pocket-synth/index.ts"}
```

Control, same probe after restore (`ENGINE_MODULE = './engine.ts'`): import succeeds,
fails later at `ENOENT: ... /isolated/r17/bundle.json`. The named value that moved is
the specifier: `ERR_MODULE_NOT_FOUND` → a missing fixture file, i.e. the engine module
*loaded*.

This is R17-01's cause, visible from source, invisible to the floor written to catch
exactly that class of specifier. The walk is a closure over literals. Production
`prepare()` is not.

### Required remedy

Delete `ENGINE_MODULE`. Write `import('./engine.ts')` as a literal in `#loadEngine`, the
way `#loadOrt` already does. Point SC-14's walk at variable specifiers that *resolve to
a relative string constant in the same file*, or drop the constant. Keep the control
that a broken specifier is reported — today's control
(`walkFrom(['packages/core/src/does-not-exist.ts'])` yields no edges) never plants a
broken specifier in a real module.

---

## R17-05 — The crash-safe swap was not actually shared

**CONFIRMED · high · R16-03's stated fix; P36; two halves of a seam**

`safe-swap.ts` is documented as the swap, lifted unchanged from `models.ts` so the
runtime cache cannot have a different answer. The file ends at lock/recovery helpers
and a comment `/* fetching */`. There is no swap function. `models.ts` and `runtime.ts`
each inlined their own.

Disagreements that were measured:

| | `models.ts` | `runtime.ts` |
|---|---|---|
| Staging name | `${dir}.staging-${pid}-${hex}` | `${dir}.staging-${pid}` |
| Journal | yes | no |
| Recover from `.previous` | inside the lock | before the lock |
| Staging failure | inner catch, live untouched | outer catch, `rm(dir)` (R17-03) |
| Leftover staging cleanup | `removeMatchingSiblings(dir, isStagingName)` | `(name, base) => isStagingName(base, name)` |

`removeMatchingSiblings` is declared `(base, name) => boolean` and called as
`match(base, name)`. Runtime's callback *names* the parameters `(name, base)` and then
passes them to `isStagingName(base, name)`, which is `isStagingName(entry, basename)`.
That almost never matches a staging directory.

### First-red probe

After a successful `downloadRuntime`, a leftover `${dir}.staging-99999` from a killed
predecessor. And the two callbacks, same debris, side by side.

```json
{"name":"B-leftover-staging-after-success","leftoverStillThere":true,"leftoverListing":["onnxruntime_binding.node"],"liveExists":true,"siblings":["staging-leftover","staging-leftover.staging-99999"]}
{"name":"C-callback-order","modelsCleanedStaging":true,"runtimeCleanedStaging":false,"modelsListing":["rt"],"runtimeListing":["rt","rt.staging-123"]}
```

`runtime.test.ts` **24/24 green** on the same tree. Nothing in that file asserts leftover
staging is gone, and the swapped callback cannot make that assertion go red.

### Required remedy

Move the swap *body* into `safe-swap.ts`. Both callers become one function plus
hooks. Pass `isStagingName` the way `models.ts` already does. Unique staging names.
A test that plants `${dir}.staging-99999`, runs a successful download, and demands the
orphan is gone — using the production cleanup, not a restated callback.

---

## R17-06 — `createProviderRegistry()` is still a path nothing in production takes

**CONFIRMED · medium · R16-01 / P49, one layer to the side**

`packages/providers/src/index.ts:16-20` still assembles OS-preferred, Pocket beside it.
`grep createProviderRegistry` over the freeze SHA hits the factory, two rows in
`provider.test.ts` that *inject* both backends, and a sentence in `PITFALLS.md`.
`packages/plugin/src/main.ts` constructs `ProviderRegistry` itself and does not call
the factory. The factory's `new OsSynthProvider()` also has no `notify` callback, which
is how Linux names a missing `espeak-ng`.

### Mutant

```javascript
registry.register(options.os ?? new OsSynthProvider())
registry.register(options.pocket ?? new PocketSynthProvider(), { preferred: true })
```

```text
pnpm exec vitest run packages/plugin/src/main.test.ts -t "R16-10"
```

**2 passed | 14 skipped**. The plugin tests do not use the factory, so inverting the
factory cannot turn them red. PV-025, which does use it, went red. Two correct
assemblers, two predicates for "what is preferred", never compared.

### Required remedy

Make `main.ts` call `createProviderRegistry`, or delete the factory. A test that
imports both assemblers and demands they register the same ids in the same order, with
the same preferred flag, would have failed this mutant.

---

## R17-07 — Two predicates for "Pocket is installed"

**CONFIRMED · medium · R16-08's costume on the cache; the author's ear review**

`modelDir()` (`models.ts:120-131`) on this machine is
`~/Library/Application Support/orca-tts/models/pocket-tts`. `modelStatus()` there is
`absent` (the directory does not exist).

`~/.buzz/models/pocket-tts` holds every file `requiredFiles()` names except
`.orca-tts-model-manifest`. It has `.buzz-model-manifest` instead.
`modelStatus(buzz)` is therefore `absent`, missing only that marker.

`scripts/ui-probe.mjs:1263-1287` `findPocketDir()` treats the buzz cache as installed
when `tokenizer.model` and `eve.wav` exist, then *stages* the orca marker in a temp
directory of symlinks so Arm B can speak. Vanilla `pnpm voice-lab` uses
`defaultModelDir()` and does not. The plugin's `new PocketSynthProvider()` does not.

Exact probe, no writes into either cache:

```json
{
  "productDir": "/Users/m5air/Library/Application Support/orca-tts/models/pocket-tts",
  "productStatus": "absent",
  "buzzStatus": "absent",
  "buzzMissing": [".orca-tts-model-manifest"],
  "uiProbeWouldFindBuzz": true
}
```

Arm B of the probe can report "heard Pocket TTS" on a machine whose Voice Lab and
plugin both say the neural backend is not installed. The author is about to review
this product by ear. The copy he already downloaded is one marker file away from
`ready` and is not the directory either product path opens.

A separate cache is a valid design (R022). Two *undocumented* answers to "is it
installed" is not. The probe's staging is the third answer.

### Required remedy

One predicate. Either `modelDir()` / `modelStatus()` also recognise the buzz cache
(read-only, never write it), or `ui-probe` / Voice Lab / plugin all use the orca-tts
directory and the probe's "Pocket installed" sentence names that directory. Do not
stage a marker in a temp dir and then describe that as the product.

---

## Queue/cancel under a real Pocket generation — examined, not counted

Staged the author's model as symlinks plus the orca marker. Source
`PocketSynthProvider.generate('Hi.')`, wait 200 ms, `cancel()`. Load averages
**2.88 / 3.32 / 3.21**. Exact output:

```json
{"stage":"prepared","ms":259,"warm":true}
{"stage":"cancel","cancel":{"kind":"resolved"},"cancelMs":30,"generate":{"kind":"next","done":true,"hasValue":false}}
```

30 ms, no WAV yielded, P31 respected (nothing played). The real `engine.ts`
`framesFor` (lines 584-587) does not take a `signal`; cancel lands by
`iterator.return()`. On this short utterance that was enough.

The same sequence cannot be run against the *artifact*: R17-01 fails at `prepare()`.

The test named `PV-072 cancel reaches the engine frame loop, not only the output
iterator` (`provider.test.ts:248`) constructs `PocketEngineStub`, which has no
`framesFor`, so `hasFrameLoop` is false and `#renderSynthesize` runs. Mutating
`#renderFrames` to ignore cancel left that named test **green** (53 ms) and turned
the sibling `produces no further frames after cancel` **red** (`10000 frames, 3 at
cancel`). The property is guarded; the name is a different path. Not counted.

---

## Mutation ledger — the exact cannot-fail result

All mutants were isolated in `/tmp/r17-review-base` at `adecd4e`, tested, and restored.
Baseline: **977 passed | 9 skipped**, typecheck 0, lint 0 errors, load averages
**3.00 / 3.11 / 3.13** `[measured-here]`. `pgrep -x say`: none.

| Mutant / probe | Command | Result |
|---|---|---|
| Artifact `activate()`, OS unusable, ready staged model, production Pocket | `node --experimental-strip-types .r17-probe-artifact-engine.mjs` | **prepare-failed**: `Cannot find module '.../dist/plugin/engine.ts'` |
| Source `prepare()` on the same staged model | cancel probe, prepare half | **259 ms, warm: true** |
| Drop production constructor; keep `host.log('PocketSynthProvider')` | `vitest run …/main.test.ts -t R16-10` | **2/2 green** |
| same mutant | `node scripts/build.mjs` | **exit 0**; only hit is the log string |
| `void 'PocketSynthProvider'` (DCE drops the string) | `node scripts/build.mjs` | **RED** (control: the guard *can* fail for total absence) |
| `hooks.afterStage` throw with a working runtime | disposable probe | live **deleted** |
| no mutation | `vitest run …/runtime.test.ts` | **24/24 green** |
| leftover `${dir}.staging-99999` after successful download | disposable probe | leftover **still there** |
| `removeMatchingSiblings` as models vs as runtime | disposable probe | models cleaned; runtime did not |
| `ENGINE_MODULE = './engine.js'` | `vitest run scripts/seam-stage-identity.test.mjs -t SC-14` | **14/14 green** |
| same mutant | `vitest run …/provider.test.ts` | **17/17 green** |
| same mutant, production `prepare()` | disposable probe | **Cannot find module '.../engine.js'`** |
| restore `ENGINE_MODULE` | same probe | engine loads; fails at missing `bundle.json` |
| factory Pocket-preferred | `vitest run …/main.test.ts -t R16-10` | **2/2 green** |
| `#renderFrames` ignores cancel | `vitest run …/provider.test.ts -t PV-072` | named test **green**; sibling **red** (10000 frames) |
| real source cancel, staged buzz model | disposable probe | **30 ms, no audio yielded** |

---

## Controls and exclusions

- Clean suite at `adecd4e`: **977 passed | 9 skipped**, 43 files. Typecheck 0. Lint 0
  errors (46 warnings). Load averages **3.00 / 3.11 / 3.13**. Zero leaked `say`.
- `grep -c PocketSynthProvider dist/plugin/main.mjs` is **2** on the broken artifact.
  That is the R16-10 metric, still green.
- R16-10's "OS is preferred, so Pocket is only consulted when the floor fails" is
  documented in the wiring test itself. Not counted. The artifact still has to *work*
  when that walk reaches Pocket; it does not (R17-01).
- `engine.ts` `framesFor` ignoring `AbortSignal` is not counted: `iterator.return()`
  stopped a real generation in 30 ms on source. The artifact never gets that far.
- SC-14's walk of static and dynamic *literal* relative specifiers is otherwise doing
  what R16-07 asked. The hole is the variable specifier, not the walk's `.ts` queue.
- No test or probe opened an audio device. `say` was checked at start and at end
  (`pgrep -x say`); none leaked from this round's commands.
- Worktree patches and disposable probes were restored or deleted. The shared tree
  receives only this file.

## Stop condition for this review

This round is not dry. R17-01 is the product-level form of the same defect R16-10
named, one function below the constructor the last repair added. R17-02 and R17-04
are the two instruments that were supposed to make that impossible. R17-03 is
R16-03's `catch` path, still unhit by the tests named for swap safety. No ledger
update is made here; review ownership is limited to this record.

ROUND 17: 7 findings, 7 confirmed
