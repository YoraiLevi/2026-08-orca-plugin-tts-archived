# 026 — Round 18: the R17 repair's own instruments

**Status:** adversarial review record. **Written:** 2026-08-23.
**Subject:** the surfaces rounds 14–17 never attacked because they did not exist until the
R17 repair: `synthesize.engine` (schema + `requestedEngineId` + resolve),
`scripts/artifact-e2e.mjs` and its four exit codes, `scripts/stage-pocket-model.mjs`,
incomplete-vs-absent `modelStatus`, `isForeignModelCache` and the `downloadModel`
refusal, the effect-based bundle guard in `scripts/build.mjs`, and
`createProviderRegistry` as the single assembler.
**Review base:** `ba9a40f`, frozen in a clean detached worktree at `/tmp/r18-review-base`
before experiments began. The shared tree was not used for mutants. Every mutant lived
only in the disposable worktree and was restored. Nothing opened an audio device (P31).
`say -o` was used by the ABSENT arm of the probe (never the device). The author's Pocket
weights at `~/.buzz/models/pocket-tts` were read through a symlink (R061). One probe
*did* create a sibling directory under `~/.buzz` via a parent symlink, then deleted it
in the same process; `ls ~/.buzz | grep r18` was empty afterwards.

This is a review, not a repair. No product source, test, spec, manifest, generated
artifact, or shared-memory file in the shared worktree was changed.

The method was first-red: for each check that claimed to watch a thing, break that thing
and record whether the check went red. A check that stayed green is the finding, and the
exact green output is the evidence.

Round 17's three newest templates, pointed at this code:

- a guard that asserts a STRING where it means a BEHAVIOUR (R17-02)
- a module named for a fix that does not contain the fix; callers re-inline it (R17-05)
- two correct components with two different predicates for one concept (R17-07, R16-08)

## Verdict

**ROUND 18: 5 findings, 5 confirmed. 3 areas sound, each earned by a mutation that went red
or by driving the path the suspicion named.**

The pattern held. Round 17 replaced `bundle.includes('PocketSynthProvider')` with an
"effect" guard. The effect is `/pocket:/` in a log line. A stub provider whose `id` is
`pocket` and whose `prepare()` throws `pocket: mutant stub` keeps `pnpm build` green
while `PocketSynthProvider` and `PocketTts` are both absent from the artifact — R16-10
wearing R17-02's uniform. The new `probe:artifact` gate maps its skip code to CI green,
so the one arm that would have caught that mutant never runs on a hosted runner.

| Finding | Status | Severity | Short result |
|---|---|---:|---|
| R18-01 | CONFIRMED | critical | The effect-based bundle guard is `/pocket:/` in a log. Production `activate()` handed a stub with `id: 'pocket'` whose `prepare()` throws `pocket: mutant stub`; factory no longer default-constructed the class. `pnpm build` exit 0. R17-02 tests 6 passed. `rg PocketSynthProvider dist/plugin/main.mjs` → ZERO. `PocketTts` gone. |
| R18-02 | CONFIRMED | high | `probe:artifact` exits 2 before `failRows()` whenever `modelStatus` is not `ready`. Swallowing `nameSubstitution` left ABSENT `substitution: (none named)` and still EXIT 2. An incomplete cache (1 of 23 files) is the same skip. CI maps 2 to step-green. Hosted runners never have a model, so the PRESENT=24 kHz arm is dead code in CI. |
| R18-03 | CONFIRMED | medium | `leakedSayAfter` is write-only. Hardcoding it to 99, EXIT 2 unchanged. `pgrep -x say` cannot tell `say -o` (silent, correct) from bare `say` (audible, P31). Nothing in `failRows` proves no bare `say` was spawned. |
| R18-04 | CONFIRMED | high | `modelStatus` `ready` is `readdir` names, not reachable bytes. Stage, delete the source files, dest is still `ready` while `existsSync(eve.wav)` (follows the dangling link) is false. Dest nested inside source creates a self-symlink (`nestedContainsNested: true`) and still reports `ready`. |
| R18-05 | CONFIRMED | high | `isForeignModelCache` is a path-prefix guess plus a marker file. A dest whose *parent* is a symlink into `~/.buzz` is `isForeign: false`. `stageModelFrom` and the CLI both wrote there (exit 0). `~/.BUZZ/...` is `isForeign: false` on a case-insensitive volume. R061 is a string prefix, not a realpath of the write. |

The suspicions that were wrong, and the mutation that earned that:

- **`synthesize.engine=pocket` with no model names the substitution.** Artifact driven with a settings file `{ 'synthesize.engine': 'pocket' }`, empty model: `namedAtReady: true`. Auto and pocket both request registry id `pocket` when it is registered, so the probe's auto path *is* this path. Not counted.
- **`modelStatus` incomplete-vs-absent, as a kind.** Collapsing `incomplete` back to `absent`: 4 tests red, including `expected 'absent' to be 'incomplete'`. The kind itself is guarded. What is not guarded is what `ready` *means* (R18-04) and what the probe does with `incomplete` (R18-02).
- **`createProviderRegistry` is the assembler, and OS-preferred is guarded.** `main.ts` calls it. Inverting `{ preferred: true }` onto Pocket: PV-025 red. Plugin auto tests stayed green because they use `requestedEngineId`, not the preferred flag — that is the design, and PV-025 is the check that can fail for the flag.

---

## R18-01 — The effect guard still asserts a string, so the neural class can vanish again

**CONFIRMED · critical · R17-02's costume on the repair of R17-02; R16-10; P49; R17-05
(the factory is named THE assembler; production re-inlines a stub and never takes the
default construct that keeps the class reachable)**

### What the check claims

`scripts/build.mjs` `assertShippedProvidersByEffect` (the R17-02 repair):

```javascript
const consulted = /pocket:/.test(consultHay) || /engine ready \(Pocket TTS/.test(consultHay)
```

Consult arm: OS floor forced down, empty model. Demand the failure names `pocket:`.
Prefer arm: production auto, empty model, demand System voice at `rung=fallback` with
`"was unavailable"` + `"using"`.

The comment says this is not a substring search for the class name. It is a substring
search for `pocket:`.

`packages/plugin/src/main.test.ts` R17-02 is the same predicate on source:
`expect(logs.join('\n')).toMatch(/pocket:/)`.

### Mutant

In `/tmp/r18-review-base` only.

`packages/plugin/src/main.ts` production default (omit `pocket`) no longer lets the
factory construct `PocketSynthProvider`. It registers this stub instead:

```javascript
pocket: options.pocket === undefined
  ? {
      id: 'pocket',
      displayName: 'Pocket TTS',
      isWarm: false,
      capabilities: { streaming: false, offline: true, needsApiKey: false,
        needsModelDownload: 0, licence: 'test', cloning: false, sampleRate: 24_000 },
      prepare: async () => { throw new Error('pocket: mutant stub, real class skipped') },
      generate: async function * () { throw new Error('unreachable') },
      cancel () {},
      listVoices: async () => [],
    }
  : options.pocket
```

And the factory default that was the only remaining `new PocketSynthProvider()` from
the plugin graph:

```javascript
// packages/providers/src/index.ts — before
if (options.pocket !== false) {
  registry.register(options.pocket ?? new PocketSynthProvider())
}
// after
if (options.pocket !== false && options.pocket !== undefined) {
  registry.register(options.pocket)
}
```

`main.ts` does not import `PocketSynthProvider`. Once the factory stops naming it,
esbuild tree-shakes the class and the engine.

### Command

```text
pnpm exec vitest run packages/plugin/src/main.test.ts -t "R17-02|registers Pocket|pocket:false|auto selects|auto NAME"
node scripts/build.mjs
rg -n "PocketSynthProvider" dist/plugin/main.mjs || echo "ZERO hits"
rg -n "mutant stub" dist/plugin/main.mjs
rg -c "PocketTts" dist/plugin/main.mjs || echo "no PocketTts"
```

Load averages **3.10 / 2.92 / 3.06** going in, **3.65 / 3.13 / 3.09** after
`[measured-here]`. No `say` processes.

### Green output (the finding)

R17-02 / wiring / auto tests:

```text
✓ packages/plugin/src/main.test.ts (21 tests | 15 skipped) 266ms
Test Files  1 passed (1)
     Tests  6 passed | 15 skipped (21)
```

Build:

```text
build: dist/plugin/ (orca-plugin.json, main.mjs, panel.html, orca-tts.mjs)
BUILD:0
=== PocketSynthProvider in bundle ===
ZERO hits
=== mutant stub ===
5015:        throw new Error("pocket: mutant stub, real class skipped");
=== pocket-synth engine inlined? ===
no PocketTts
```

A first mutant that only passed the stub and left `new PocketSynthProvider()` in the
factory also kept `pnpm build` at exit 0; the class remained in the bundle at
`var PocketSynthProvider = class` / `new PocketSynthProvider()` because the factory
still named it. The guard does not look at that. It looks at `pocket:`. The stub
satisfies consult (the throw contains `pocket:`) and prefer (the stub fails, OS
fallback is named). Removing the factory default is what deletes the class. Both
steps stayed green.

Control, same worktree after restore (`git checkout -- dist/plugin/main.mjs`):

```text
1783:var PocketSynthProvider = class {
2058:    registry.register(options.pocket ?? new PocketSynthProvider());
```

### Required remedy

The consult arm must fail unless the thing that threw is the bundled
`PocketSynthProvider`. A stub with `id: 'pocket'` is the R17-02 log-string with a
colon. Cheapest discriminator that would have gone red here: after consult, the
bundle must still contain `var PocketSynthProvider = class` *and* the production
`activate()` path must not pass `pocket:` as an option (omit the field, so the
factory default runs). Stronger: stage a ready cache and demand 24 kHz — that is
R18-02's PRESENT arm, which CI currently skips.

---

## R18-02 — Exit 2 is how a real ABSENT defect, and every PRESENT defect, leaves CI green

**CONFIRMED · high · the suspicion the coordinator named; R16-05 inverted; P32's
indicator that cannot go red**

### What the check claims

`scripts/artifact-e2e.mjs` four exits: 0 pass, 1 fail, 2 inconclusive (no model), 3
harness. CI (`.github/workflows/ci.yml`):

```yaml
set +e
pnpm probe:artifact
got=$?
set -e
if [ "$got" -eq 0 ]; then echo "artifact e2e: PASS"; exit 0; fi
if [ "$got" -eq 2 ]; then echo "artifact e2e: INCONCLUSIVE (no Pocket model on this runner)"; exit 0; fi
echo "artifact e2e: FAIL (exit $got)"; exit "$got"
```

Hosted runners never have a Pocket model. Exit 2 is the only code this step produces,
and it is mapped to green.

`failRows(present, absent)` is the conclusive assertion (PRESENT 24 kHz + signal,
ABSENT 22050 + named substitution, arms must differ). It is called only after PRESENT
has run. When `modelStatus(modelDir())` is not `ready`, PRESENT is skipped and the
parent `process.exit(2)` happens first.

### Mutant A — unnamed substitution, no model (the path a corrupt tokenizer cannot take)

A corrupt tokenizer is `ready` (the name is present), so PRESENT runs and a generation
failure is exit 1. That is the path that was tested. The path that was not: ABSENT
fails *and* PRESENT is skipped.

In the *artifact* only (`dist/plugin/main.mjs` at the freeze SHA):

```javascript
const nameSubstitution = (reason) => {
  /* R18 mutant: swallow substitution; ABSENT failRows is dead when PRESENT is skipped */
};
```

No rebuild. `pnpm build` was not re-run (its prefer arm would have caught this mutant
*in source*; the question is whether `probe:artifact` does).

Also, independently, `summarize` was forced to `leakedSayAfter: 99` (R18-03).

### Command

```text
pgrep -x say || echo "no say"
node scripts/artifact-e2e.mjs --keep
echo EXIT:$?
```

Load averages **3.10 / 2.92 / 3.06** `[measured-here]`. Product cache at freeze:
`absent` (`~/Library/Application Support/orca-tts/models/pocket-tts` does not exist).

### Green output (the finding)

```text
--- ABSENT (production, no model) ---
engineReady:  read-aloud: engine ready (System voice, rung=fallback)
displayName:  System voice
rung:         fallback
chunk.rate:   22050  (wav header 22050)
signal:       true
substitution: (none named)
...
INCONCLUSIVE: no Pocket model on this machine, so the neural arm could not run.
The absent arm is recorded above. This is not a pass.
EXIT:2
```

Baseline before the mutant, same machine, same absent cache: substitution *was* named,
and the parent still exited 2. The named value that moved is `substitution`:
`"pocket was unavailable (...); using System voice"` → `(none named)`. The exit code
did not move. CI would print `artifact e2e: INCONCLUSIVE` and exit 0 of the step.

Kept child JSON: `substitution: null`. `failRows` never ran.

### Mutant B — incomplete is the same skip

No source mutation. `ORCA_TTS_MODEL_DIR` pointed at a directory holding only
`tokenizer.model` (1 of 23 required names).

```text
Pocket product cache is incomplete: this directory has 1 of 23 required files; missing ...
PRESENT arm INCONCLUSIVE.
...
INCONCLUSIVE: no Pocket model on this machine, so the neural arm could not run.
EXIT:2
```

The sentence is false: there *is* a Pocket model, it is broken. `failRows` would have
been exit 1 if PRESENT had been pointed at that directory (Pocket cannot prepare, OS
speaks at 22050). The skip treats incomplete as absent.

### What this means for CI

`pnpm build` still runs the empty-model consult/prefer arms, so an unnamed-substitution
mutant *in source* is caught before `probe:artifact` if the full job runs. That is not
a defence of `probe:artifact`. The CI step named for PRESENT=24 kHz never executes
PRESENT. A Pocket that cannot generate when weights exist (the stub in R18-01, a
broken `#loadEngine`, a tree-shaken class) is consult-green, prefer-green, probe-exit-2,
CI-green.

The conclusive arm is dead code in CI. A real ABSENT-arm defect reaches exit 2 rather
than 1 whenever the product cache is not `ready`. That is every hosted runner, and it
is this machine at freeze.

### Required remedy

Do not map 2 to green without running the ABSENT half of `failRows`. If PRESENT is
skipped, still score ABSENT (sample rate, named substitution, no `error`) and fail the
job on those; keep 2 only for "ABSENT could not run either" (no OS synth). PRESENT
belongs in CI on at least one leg that has weights, or the step should be named a skip
in the workflow summary rather than a gate. Incomplete is not inconclusive: it is a
cache that cannot speak, which is exit 1.

---

## R18-03 — `leakedSayAfter` is recorded and never read; `pgrep -x say` cannot see P31

**CONFIRMED · medium · P31 / P42; a write-only instrument**

`scripts/artifact-e2e.mjs`:

```javascript
function leakedSay () {
  if (process.platform !== 'darwin') return 0
  const r = spawnSync('pgrep', ['-x', 'say'], { encoding: 'utf8' })
  ...
}
```

`sayBefore` aborts the parent with exit 3 if any `say` is already running (P42 dirty
machine). `summarize` sets `leakedSayAfter: leakedSay()`. `failRows` never mentions
the field. `printArm` never prints it.

### Mutant

```javascript
leakedSayAfter: 99,
```

Same `--keep` run as R18-02.

Kept `absent.json`:

```text
leakedSayAfter= 99
substitution= None
```

Parent EXIT 2. The field moved from a live `pgrep` count to the constant 99 and
nothing noticed.

`pgrep -x say` matches the executable name. `say -o out.wav` and bare `say` are the
same executable. A check that *did* read `leakedSayAfter === 0` would still be green
for a completed bare `say` (process gone) and red for a slow `say -o` still writing
(the correct path). It cannot fail for P31.

`darwinCommand` itself is a different check: it builds `['-o', outFile, ...]`. That
path was not mutated (removing `-o` and then running generate would have opened the
device). The new probe's leak detector is not that check.

### Required remedy

Delete the write-only field, or assert it, knowing `pgrep -x say` is P42 (orphan
still running) and not P31 (argv contained `-o`). P31 on this path is the capturing
sink plus `darwinCommand`'s argv test. Do not claim the probe proves no bare `say`.

---

## R18-04 — `ready` is a directory listing; dangling symlinks and a self-link still pass

**CONFIRMED · high · R14-02 (`ready` must mean the voices work); R17-07 option A
(stage is the reuse path); two predicates for "the files are here"**

`modelStatus` (`models.ts`):

```javascript
const names = new Set(await readdir(dir))
const missing = required.filter((f) => !names.has(f))
```

`readdir` returns symlink names whether or not the target exists.
`stageModelFrom` `symlink`s every source name except the two markers, then writes
OUR marker, then demands `modelStatus(dest) === ready`.

### Probe — no source mutation

Staged a weights-complete temp source into a temp dest (never `~/.buzz`). Then
deleted every payload file in the source, leaving dest as dangling symlinks.

```json
{
  "name": "dangling-symlink-ready",
  "stagedFiles": 22,
  "afterStage": "ready",
  "afterSourceDeleted": "ready",
  "afterDetail": "Pocket TTS is ready in /var/folders/.../T/r18-dest-ZBdXT8",
  "eveExistsFollowsLink": false,
  "destNamesIncludeEve": true,
  "destEveIsSymlink": true
}
```

The named value that did not move is `kind: ready`. The named value that did is
`existsSync(dest/eve.wav)` following the link: `false`. R14-02's sentence — *ready
must mean the voices work* — is false for the reuse path the R17-07 repair added.

Dest nested inside source (symlink loop):

```json
{
  "name": "dest-nested-in-source",
  "threw": null,
  "files": 23,
  "status": "ready",
  "nestedContainsNested": true
}
```

`mkdir(dest)` inside `source`, then `readdir(source)` includes `nested-dest`, then
`symlink(source/nested-dest, dest/nested-dest)` — a link to itself. Status is
`ready`. The stage tests never nest dest in source and never delete the source
before asserting, so they cannot fail for this.

Dest already populated: leftover `leftover-junk.bin` survived, `eve.wav` was
replaced with a symlink, status `ready`. Dest equal to source (non-buzz): 0 files
linked, marker written into the source, status `ready`. Dest is a plain file:
`EEXIST, mkdir`. Those are the partial-run / dest-exists / symlink-loop answers
the suspicion asked for. The leftover and dest-equals-source cases are sloppy;
the dangling-ready case is the load-bearing one.

### Required remedy

`modelStatus` must follow each required name (`stat` / `realpath`) and treat a
dangling link as missing. `stageModelFrom` must refuse dest-inside-source and
dest-equals-source. A test that stages, deletes the source payload, and demands
`kind !== 'ready'` would have failed this probe; today's stage tests cannot.

---

## R18-05 — `isForeignModelCache` is a path-prefix guess, so R061 is optional

**CONFIRMED · high · R061 / PV-NFR-004; R17-07's "never write into ~/.buzz"**

```javascript
export function isForeignModelCache(dir: string): boolean {
  const target = resolvePath(dir)
  const buzzRoot = resolvePath(join(homedir(), '.buzz'))
  if (target === buzzRoot || target.startsWith(buzzRoot + sep)) return true
  // realpath only if dest already exists
  ...
  if (existsSync(join(dir, BUZZ_MANIFEST_FILE))) return true
  return false
}
```

`path.resolve` does not follow a parent symlink. `realpath` is skipped when dest
does not exist yet. The tests cover `join(homedir(), '.buzz', ...)` and a marker
file in a temp dir. They do not cover a dest that *will* be created under a
symlink to buzz.

### Probe — dest parent is a symlink into `~/.buzz`

```json
{
  "name": "dest-parent-symlink-into-buzz",
  "dest": "/var/folders/.../T/r18-alias-vbU0fQ/buzz-link/r18-must-not-exist-1787451744673",
  "isForeign": false,
  "existsBefore": false,
  "threw": null,
  "createdThenCleaned": true,
  "leakedIntoBuzz": true
}
```

`buzz-link` → `~/.buzz`. Dest did not exist. `isForeignModelCache` returned false.
`stageModelFrom` created `~/.buzz/r18-must-not-exist-*` and wrote our marker plus
22 symlinks. The probe deleted that sibling in the same process.
`ls ~/.buzz | grep r18` afterwards: empty.

The CLI, same arrangement:

```json
{
  "name": "cli-dest-parent-symlink-into-buzz",
  "status": 0,
  "stderr": "",
  "stdout": "Staged 22 files from\n  /var/folders/.../T/r18-cli-src-PSWTb4\ninto\n  /var/folders/.../T/r18-cli-alias-392hP2/buzz-link/r18-cli-1787451744685\n",
  "createdThenCleaned": true
}
```

Exit 0. The refusal at the top of `stage-pocket-model.mjs` uses the same predicate.

Case fold, no write (R061):

```json
{
  "name": "case-fold-BUZZ",
  "dest": "/Users/m5air/.BUZZ/r18-case-1787451744677",
  "isForeign": false,
  "homeBuzzExists": true
}
```

This volume is case-insensitive. `~/.BUZZ` *is* `~/.buzz`. The predicate says it is
not foreign. The logical `..` form (`~/.buzz/../.buzz/...`) *is* caught, because
`resolvePath` collapses `.` / `..`. The realpath of a missing dest's parent is the
hole.

Control, the cases the tests name, same process:

```json
{ "name": "nonexistent-under-buzz", "isForeign": true }
{ "name": "dotdot-buzz", "isForeign": true }
{ "name": "marker-only-foreign", "isForeign": true }
```

`downloadModel` calls `assertModelDirWritable` first; it inherits the same miss.

### Required remedy

`isForeignModelCache` must `realpath` the dest if it exists, and the nearest existing
ancestor if it does not, and compare that to `realpath(~/.buzz)`. Compare
case-folded on case-insensitive volumes. A test whose dest is
`symlink(~/.buzz)/new-name` and that demands a throw *before* `mkdir` would have
failed this probe; today's tests create nothing under a symlink.

---

## Areas examined and found sound — and what was mutated to earn that

`looks fine` is not a review. Each row below is a mutation or a drive of the named
path.

### `modelStatus` incomplete-vs-absent, as a kind — SOUND

Mutant in `models.ts`: after `present === 0` returns `absent`, the non-empty-missing
branch also returned `{ kind: 'absent', dir, missing }` (the pre-R17-07 behaviour).

```text
pnpm exec vitest run packages/providers/src/pocket-synth/models.test.ts -t "R17-07|incomplete is not absent|modelStatusDetail|INCOMPLETE"
```

**4 failed.** Exact first red:

```text
R17-07: a directory with every file but the marker is INCOMPLETE, not absent
AssertionError: a one-file-short cache must not read as the same kind as an empty directory:
expected 'absent' to be 'incomplete'
```

Also red: the stage source-is-incomplete assertion, `modelStatusDetail` must contain
the marker name, R14-02 weights-only directory. Restored. The kind is guarded. What
callers *do* with `incomplete` (probe:artifact skip, `ready` via dangling names) is
R18-02 and R18-04.

The comment at `downloadModel` still says a directory holding every file but the
marker "reads as `absent`". That sentence is false. It is not a check. Not counted.

### `synthesize.engine=pocket` names the substitution — SOUND (suspicion 5, disproved)

Drove `dist/plugin/main.mjs` with a settings file
`{ 'synthesize.engine': 'pocket' }` and an empty `ORCA_TTS_MODEL_DIR`. Capturing
sink, no player (P31). Load averages **3.10 / 2.92 / 3.06**.

```json
{
  "namedAtReady": true,
  "namedAnytime": true,
  "engineLines": [
    "read-aloud: settings loaded from inbox (revision 1, 0 rejected, 0 unknown) at ...",
    "read-aloud: engine ready (System voice, rung=fallback)",
    "read-aloud: pocket was unavailable (pocket: Pocket TTS model is not ready in ... missing ...); using System voice",
    "read-aloud: self-test chunks=2 bytes=110402 played=110402"
  ],
  "chunkRates": [22050, 22050],
  "settingsEngine": "pocket"
}
```

`requestedEngineId('auto', true)` and `requestedEngineId('pocket', true)` both
return `'pocket'`. The probe's default auto path *is* this path when Pocket is
registered. The schema default is `auto`; the value passed to the first
`resolveFor` is captured at `activate()` time from the snapshot, which is still
the default until the inbox lands — and that default is the same id. Not a silent
substitution.

### `createProviderRegistry` is the assembler — SOUND for the preferred flag

`main.ts` calls it (R17-06's remedy is in the source). Mutant: Pocket registered
`{ preferred: true }`, OS without.

```text
pnpm exec vitest run packages/providers/src/pocket-synth/provider.test.ts packages/plugin/src/main.test.ts -t "PV-025|auto selects|R17-02|engine os"
```

PV-025 **red** (default `resolve()` no longer returns OS). Plugin auto / R17-02 /
engine=os tests **green** — they go through `requestedEngineId`, not the preferred
flag. Restored. The factory's *default construct* of `PocketSynthProvider` is the
untested half, and that is R18-01: every plugin test that cares either injects a
fake or matches `/pocket:/`.

---

## Mutation ledger

All mutants were isolated in `/tmp/r18-review-base` at `ba9a40f`, tested, and
restored. Shared tree product files were not edited. After restore:

```text
git -C /tmp/r18-review-base status --short
# empty
git -C /tmp/r18-review-base rev-parse HEAD
# ba9a40f04f859de94601b371b2688a828c747e60
rg -n PocketSynthProvider dist/plugin/main.mjs
# 1783:var PocketSynthProvider = class {
# 2058:    registry.register(options.pocket ?? new PocketSynthProvider());
```

No `say` processes at start or end (`pgrep -x say`). Load averages during the
session **1.43–3.65** `[measured-here]`. One write into `~/.buzz` (R18-05) was a
timestamped sibling created through a parent symlink and removed before the probe
returned; `ls ~/.buzz | grep r18` was empty.

This file is the only deliverable in the shared tree.
