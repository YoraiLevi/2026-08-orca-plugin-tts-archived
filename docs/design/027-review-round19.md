# 027 — Round 19: the same guard, a third sentence

**Status:** adversarial review record. **Written:** 2026-08-23.
**Subject:** the surfaces the R18 repair of R18-01/02/03/04/05 just added: `consultProvesRealPocket`
in `scripts/artifact-score.mjs` (the third rewrite of the bundle guard), `judge()` / exit 2,
`scripts/ci/no-audio-recorder.mjs` plus `p31Rows` / `applyP31`, `realWriteLocation()` /
`isForeignModelCache`, and `modelStatus` after `existsSync`. The four new test files
(`scripts/build.test.mjs`, `scripts/artifact-e2e.test.mjs`, `scripts/artifact-e2e-p31.test.mjs`,
and the R18-04/05 cases in `models.test.ts`) were read as instruments, not as evidence.
**Review base:** `db11fea`, frozen in a clean detached worktree at `/tmp/r19-review-base`
before experiments began. The shared tree was not used for mutants. Every mutant lived
only in the disposable worktree and was restored. Nothing opened an audio device (P31).
`say -o` was used by the ABSENT arm of `probe:artifact` (never the device). PATH stubs
named `say` were used for recorder probes; `/usr/bin/say` was not on those PATHs. The
author's Pocket weights at `~/.buzz/models/pocket-tts` were not written. The case-fold
write proof used a fake `home=` under `/var/folders`; `ls ~/.buzz | grep r19` was empty.

This is a review, not a repair. No product source, test, spec, manifest, generated
artifact, or shared-memory file in the shared worktree was changed.

The method was first-red: for each check that claimed to watch a thing, break that thing
and record whether the check went red. A check that stayed green is the finding, and the
exact green output is the evidence.

P50, applied to this freeze: the R18-01 repair was re-run against **round 18's own stub**
(`throw new Error('pocket: mutant stub')`) and reported BUILD_EXIT 0 → 1. That is the case
the coordinator could build. It is not the sentence the product throws, and it is not the
input `consultProvesRealPocket` now demands. Assume that mistake is still in the repairs.

## Verdict

**ROUND 19: 6 findings, 6 confirmed. 4 areas sound, each earned by a mutation that went
red or by driving the path the suspicion named.**

The pattern held for a third time. Round 17 grepped a class name. Round 18 grepped
`/pocket:/` out of a log. Round 18's repair greps two longer substrings out of the same
haystack — the empty dir path, and `mimi_encoder.onnx` — and the comment still says this
is `PocketModelUnavailableError`. It is not. The function never mentions the class. A
stub that reads `ORCA_TTS_MODEL_DIR` and throws the product's own sentence keeps
`pnpm build` at EXIT 0 while `PocketSynthProvider` and `PocketTts` are both absent from
the artifact. The unit test named "ACCEPTS the real PocketModelUnavailableError" feeds a
raw string and does not mention the class.

P50 is in the other three repairs too. `isForeignModelCache` gained a nearest-ancestor
walk and a test for the symlink-parent case round 18 named; the other case round 18 named
(`~/.BUZZ` on this case-insensitive volume, same inode as `~/.buzz`) is still
`isForeign: false`, and `stageModelFrom` writes through it. `modelStatus` now calls
`existsSync` per name, which catches a dangling symlink and does not catch a zero-length
file; the test for `ready` writes `'x'` into every required name and expects `ready`.
`scoreAbsent` treats `substitution == null` as a defect; `substitution: ''` is exit 2,
and CI still maps 2 to step-green.

| Finding | Status | Severity | Short result |
|---|---|---:|---|
| R19-01 | CONFIRMED | critical | `consultProvesRealPocket` is two `hay.includes(...)` of a sentence. Stub `prepare()` throws `Pocket TTS model is not ready in ${ORCA_TTS_MODEL_DIR}: missing tokenizer.model, mimi_encoder.onnx, eve.wav`; factory no longer default-constructs the class. `pnpm build` EXIT 0. R18-01 tests 13 passed. `rg PocketSynthProvider dist/plugin/main.mjs` → ZERO. `PocketTts` gone. Predicate returns true; `PocketModelUnavailableError` is not in the hay. |
| R19-02 | CONFIRMED | high | `realWriteLocation` does not case-fold. `~/.buzz` and `~/.BUZZ` are inode 9541114 on this APFS volume. `isForeignModelCache('~/.BUZZ/r19-must-not-exist')` is **false**. Fake-home `stageModelFrom(source, home/.BUZZ/r19-staged)`: `foreign: false`, `threw: null`, 22 files land in `home/.buzz/r19-staged`. The new test covers the symlink parent and does not cover case-fold. Relative and `..` **are** caught. |
| R19-03 | CONFIRMED | high | `modelStatus` `ready` is `existsSync` per required name plus a version string. Zero-length files + `MANIFEST_VERSION`: `kind: 'ready'`. One-byte `'x'`: `ready`. `mimi_encoder.onnx` pin is 39,768,446 bytes / `853e2ca623b8…`; actual 1 byte / `2d711642b726…`; still `ready`. `MODEL_ARTIFACTS[].sha256` and `.bytes` are not consulted. The committed test writes `'x'` and expects `ready`. |
| R19-04 | CONFIRMED | high | `scoreAbsent` checks `substitution == null`. Empty string is not null. Kept ABSENT JSON `substitution: ''` (the log still named the floor). `judge` EXIT 2. `applyP31` on linux with leftover 0 stays 2. CI maps 2 to green. R18-02's next costume. |
| R19-05 | CONFIRMED | medium | Recorder wraps `exec`/`execSync` and records `{cmd: 'say hello there', args: []}`. `auditSaySpawns` requires `spawnBase(cmd) === 'say'`, so the exec is dropped. Mixed with a sibling `spawn('say', ['-o', …])`: `sayCount: 1`, `violations: []`, `p31Rows: []`. Grandchild `node` that then `spawnSync('say', …)`: parent log has the node spawn, `sayCount: 0`. Empty `--import` module: darwin `p31Rows` goes red ("recorder is blind"); linux `applyP31` stays EXIT 2. |
| R19-06 | CONFIRMED | medium | `leakedSayAfter === 0` is now load-bearing. Round 18 predicted `pgrep -x say` is red for a slow `say -o` still writing (the correct path). Two consecutive healthy ABSENT runs on this machine: `leakedSayAfter: 1`, leftover PID was a `-o` spawn, parent EXIT 1. Darwin false-red; it also masked R19-04 on this host. Linux `leakedSay()` is hardwired 0, so R19-04 is unmasked on hosted runners. |

The suspicions that were wrong, and the mutation that earned that:

- **Relative path, and a path with `..`, through a parent symlink into `.buzz`.** `isForeign: true` for both `parentlink/not-yet-created` (cwd = the outside dir) and `dummy/../parentlink/via-dotdot`. The nearest-ancestor walk plus `path.resolve` collapsing `..` catches those. Not counted.
- **Hardlink dest.** Directory hardlinks are not possible on APFS. A file hardlink is not a staging dest. Not counted.
- **Incomplete / stale still skip as exit 2.** Mutant: `if (false && productKind !== 'ready' && …)` in `judge`. `incomplete cache is exit 1` **red**: `expected 2 to be 1`. Stale the same. Restored. The kind is guarded. What is not guarded is `substitution: ''` (R19-04).
- **ABSENT skipped.** The parent always `spawnArm`s ABSENT first and `process.exit(3)`s if the child wrote no JSON. The empty-substitution run printed the ABSENT arm. Not skipped.

A TOCTOU (ancestor appears between `existsSync` and the write) was not won. Suspected, not counted.

---

## R19-01 — The effect guard still asserts a sentence, so the neural class can vanish a third time

**CONFIRMED · critical · R18-01's costume on the repair of R18-01; R17-02; R16-10; P49; P50
(the repair was verified against round 18's stub, not against the sentence the product
throws)**

### What the check claims

`scripts/artifact-score.mjs` `consultProvesRealPocket` (the R18-01 repair):

```javascript
const hay = [consult.error, consult.engineReady, ...(consult.logs ?? [])]
  .filter((x) => typeof x === 'string' && x.length > 0)
  .join('\n')
const observedThisDir = hay.includes(`Pocket TTS model is not ready in ${emptyModelDir}`)
const enumeratedAWeight = hay.includes(POCKET_WEIGHT_THE_REAL_CLASS_ENUMERATES)
return observedThisDir && enumeratedAWeight
```

The comment, and `scripts/build.mjs`'s throw, say this is `PocketModelUnavailableError`.
The function never looks at `error.name`, never looks at the class in the bundle, and
never calls `modelStatus`. It looks at two substrings.

`scripts/build.test.mjs` "ACCEPTS the real PocketModelUnavailableError for THIS dir + a
Pocket weight" feeds a raw string containing those two substrings and expects `true`.
It does not construct `PocketModelUnavailableError`. A sentence is a string.

Round 18's stub (`id: 'pocket'`, throw `'pocket: mutant stub'`) does not contain the
empty dir or `mimi_encoder.onnx`. That is the case the freeze commit re-ran. The product
throws `Pocket TTS model is not ready in ${status.dir}: missing ${status.missing.join(', ')}`,
and the consult child sets `process.env.ORCA_TTS_MODEL_DIR` to that dir.

### Mutant

In `/tmp/r19-review-base` only.

`packages/plugin/src/main.ts` production default (omit `pocket`) no longer lets the
factory construct `PocketSynthProvider`. It registers this stub instead:

```javascript
pocket: {
  id: 'pocket',
  displayName: 'Pocket TTS',
  isWarm: false,
  capabilities: { streaming: false, offline: true, needsApiKey: false,
    needsModelDownload: 0, licence: 'test', cloning: false, sampleRate: 24_000 },
  prepare: async () => {
    const dir = process.env.ORCA_TTS_MODEL_DIR ?? ''
    throw new Error(
      `Pocket TTS model is not ready in ${dir}: missing tokenizer.model, mimi_encoder.onnx, eve.wav`,
    )
  },
  generate: async function * () { throw new Error('unreachable') },
  cancel () {},
  listVoices: async () => [],
}
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
pnpm exec vitest run scripts/build.test.mjs packages/plugin/src/main.test.ts \
  -t "R17-02|registers Pocket|pocket:false|auto selects|auto NAME|consultProvesRealPocket|R18-01"
pnpm build
rg -n "PocketSynthProvider" dist/plugin/main.mjs || echo "ZERO hits"
rg -c "PocketTts" dist/plugin/main.mjs || echo "no PocketTts"
```

Load averages **2.15 / 2.41 / 2.36** going in, **2.38 / 2.45 / 2.38** after
`[measured-here]`. One transient `say` PID during the prefer arm, gone before the next
probe. No leftover `say` at restore.

### Green output (the finding)

R18-01 / R17-02 / wiring tests:

```text
✓ scripts/build.test.mjs (7 tests) 2ms
✓ packages/plugin/src/main.test.ts (21 tests | 15 skipped) 259ms
Test Files  2 passed (2)
     Tests  13 passed | 15 skipped (28)
```

Build, 06:56:47–06:56:51:

```text
build: dist/plugin/ (orca-plugin.json, main.mjs, panel.html, orca-tts.mjs)
BUILD_EXIT:0
=== PocketSynthProvider in bundle ===
ZERO hits
=== mutant stub ===
5002:      // R19 mutant: a lookalike sentence, not PocketModelUnavailableError.
5019:            `Pocket TTS model is not ready in ${dir}: missing tokenizer.model, mimi_encoder.onnx, eve.wav`
=== PocketTts ===
no PocketTts
```

Consult child against that artifact, empty dir
`/var/folders/…/T/r19-consult-a4a22m_8/r19-empty-kryhnqvp`:

```text
error: "read-aloud: no speech engine is available on this system (prepare-failed) — pocket: Pocket TTS model is not ready in /var/folders/…/r19-empty-kryhnqvp: missing tokenizer.model, mimi_encoder.onnx, eve.wav; os-synth: diagnostic: OS floor forced down"
```

Predicate on that JSON:

```text
proves true
classNameInHay false
dirInHay true
weightInHay true
```

A stub that does not read the env (round 18's) still goes red. A stub that copies the
product's sentence does not. The check is still a string. The class name the comments
demand is not in the haystack.

Control, same worktree after restore (`git checkout -- packages/plugin/src/main.ts
packages/providers/src/index.ts dist/plugin/main.mjs`):

```text
1783:var PocketSynthProvider = class {
2058:    registry.register(options.pocket ?? new PocketSynthProvider());
PocketTts count: 6
```

### Required remedy

The consult arm must fail unless the thing that threw is the bundled
`PocketSynthProvider`. A stub that interpolates `ORCA_TTS_MODEL_DIR` and a filename
from a comment is the R18-01 log-string with a longer literal. Discriminators that
would have gone red here, cheapest first:

1. After consult, the bundle must still contain `var PocketSynthProvider = class` **and**
   the production `activate()` path must omit the `pocket` field (so the factory default
   runs). Presence is not effect, but its absence is this mutant.
2. Demand `error.name === 'PocketModelUnavailableError'` from an object, not a
   substring of a concatenated log. A sentence is not a class. This alone is still a
   string (`this.name = 'PocketModelUnavailableError'` is one assignment in a stub).
3. Stage a ready cache and demand 24 kHz. That is the PRESENT arm. CI currently maps
   its skip to green (R19-04). Without weights this is not a CI gate.

Do not verify the next rewrite against this stub. Verify it against a stub that
produces whatever sentence the new check names. That is P50.

---

## R19-02 — `realWriteLocation` does not case-fold, so R061 is still a string prefix

**CONFIRMED · high · R18-05's leftover; P50 (the new test is the symlink parent round 18
named, not the case-fold round 18 also named); R061 / PV-NFR-004**

Round 18 found two holes in `isForeignModelCache`: a dest whose parent is a symlink
into `~/.buzz`, and `~/.BUZZ` on this case-insensitive volume. The repair walks to the
nearest existing ancestor and `realpathSync`s it. The new test
(`models.test.ts` "a dest that does not exist yet, under a parent symlinked into
.buzz, is foreign") covers the first. It does not mention case-fold.

`realpathSync` on this APFS volume **preserves the case you asked for**:

```text
/Users/m5air/.buzz  inode=9541114
/Users/m5air/.BUZZ  inode=9541114
realpathBuzz:  /Users/m5air/.buzz
realpathBUZZ:  /Users/m5air/.BUZZ
```

`under()` is `candidate === root || candidate.startsWith(root + sep)` with no
case-fold. `realWriteLocation('~/.BUZZ/new')` walks to `~/.BUZZ` (exists), realpaths it
to `/Users/m5air/.BUZZ`, and compares to `realpath('~/.buzz')` = `/Users/m5air/.buzz`.
They do not match.

### Probe — read-only against the real home; write proof against a fake home

```text
isForeignModelCache('/Users/m5air/.BUZZ/r19-must-not-exist-1787457512778')
# false
```

No write into the author's `~/.buzz`. Write proof, `home=` a mkdtemp (also APFS,
case-insensitive — `/tmp` `.buzz` and `.BUZZ` share an inode too):

```text
dest = $home/.BUZZ/r19-staged
isForeignModelCache(dest, home)  -> false
stageModelFrom(source, dest)     -> { files: 22 }, threw: null
after.buzzKids                   -> ['.buzz-model-manifest', 'r19-staged']
after.markerInBuzz               -> true
after.destViaBuzz                -> true
after.destViaBUZZ                -> true
```

The named value that did not move is `isForeign: false`. The named value that did is
`buzzKids`: the staged directory appeared inside `.buzz`. Both views cleaned up in the
same process.

Relative path and `..` through a symlink parent, same process: `isForeign: true`.
Those suspicions were wrong. Case-fold is the one that was not re-driven.

### Required remedy

Compare case-folded on case-insensitive volumes (`realpath` is not a case-fold). A
test whose dest is `join(home, '.BUZZ', 'not-yet')` on this machine and that demands
`isForeign === true` *before* `mkdir` would have failed this probe; today's tests
create nothing under a case variant.

---

## R19-03 — `ready` is `existsSync`, so a zero-length file is a working model

**CONFIRMED · high · R14-02 (`ready` must mean the voices work); R18-04 repaired NAMES
not BYTES; P50 (the new test writes `'x'` and expects `ready`, which is the case the
author could build)**

`modelStatus` after the R18-04 repair:

```javascript
const missing = required.filter((f) => !names.has(f) || !existsSync(join(dir, f)))
…
if (found !== want) return { kind: 'stale', … }
return { kind: 'ready', dir }
```

`existsSync` follows a symlink (dangling is missing — R18-04 closed). It is true for
a zero-length file. `MODEL_ARTIFACTS[].sha256` and `.bytes` are the pins the downloader
already has. `modelStatus` does not read them.

The committed test is the proof the instrument agrees:

```javascript
it('reports ready only when everything is there and current', async () => {
  for (const f of requiredFiles()) writeFileSync(join(dir, f), 'x')
  writeFileSync(join(dir, MANIFEST_FILE), `${MANIFEST_VERSION}\n`)
  expect((await modelStatus(dir)).kind).toBe('ready')
})
```

### Probe — no source mutation

Temp dirs. Every required name written. Manifest version current.

```json
{
  "zeroKind": "ready",
  "oneKind": "ready",
  "wrongKind": "ready",
  "encoderExpectedBytes": 39768446,
  "encoderActualBytes": 1,
  "digestMatchesPin": false,
  "encoderSha256Prefix": "853e2ca623b8",
  "actualSha256Prefix": "2d711642b726"
}
```

The named value that did not move is `kind: 'ready'`. The named values that did are
the bytes (39,768,446 → 1) and the digest (does not match the pin). The author's
reuse path is symlinks into buzz; `existsSync` follows those, so a dangling buzz
clean is now `incomplete` (R18-04) and a truncated or empty buzz file is `ready`.

### Required remedy

`ready` has to mean the voices work. Stat size against `MODEL_ARTIFACTS[].bytes` at
minimum; the digest is already in the table. A test that writes zero-length
`mimi_encoder.onnx` plus a current marker and demands `kind !== 'ready'` would have
failed this probe; today's ready test would fail that test.

---

## R19-04 — Empty substitution is not `null`, so an unnamed floor is still exit 2

**CONFIRMED · high · R18-02's next costume; CI still maps 2 to green**

`scoreAbsent`:

```javascript
if (absent.substitution == null) {
  rows.push('ABSENT did not NAME the substitution. …')
}
```

R18-02's mutant swallowed `nameSubstitution` and left `substitution: null`. That is
now exit 1. `substitution: ''` is not `null`.

### Mutant

In `/tmp/r19-review-base` only, `scripts/artifact-e2e.mjs`:

```javascript
function substitutionFrom (logs, notifications) {
  return ''
  // … original body unreachable
}
```

`ORCA_TTS_MODEL_DIR` pointed at an empty temp so PRESENT could not run. Production
ABSENT still named the floor in the log. `--keep`.

### Command

```text
ORCA_TTS_MODEL_DIR=$EMPTY node scripts/artifact-e2e.mjs --keep
# then judge() against the kept absent.json
```

Load averages **2.17 / 2.41 / 2.38** `[measured-here]`.

### Green output (the finding)

Parent print (the named value that moved is `substitution`):

```text
substitution: 
  [log] read-aloud: pocket was unavailable (pocket: Pocket TTS model is not ready in …/artifact-e2e-empty-WguqpF: missing tokenizer.model, mimi_encoder.onnx, eve.wav); using System voice
```

Kept `absent.json`: `substitution: ''`, `chunkSampleRate: 22050`, `signal: true`,
`error: null`. `scoreAbsent(absent)` → `[]`. `judge({ productKind: 'absent', present: null, absent })`:

```text
exit: 2
summary: INCONCLUSIVE: PRESENT arm could not run (no ready Pocket model). ABSENT passed. This is not a pass.
```

`applyP31` on **linux** with `leakedSayAfter: 0` (what every hosted runner computes —
`leakedSay()` is `if (process.platform !== 'darwin') return 0`): still EXIT 2.
`.github/workflows/ci.yml` maps 2 to step-green.

The log named the substitution. The scorer was handed `''`. That is the same
blindness as `null` wearing a zero-length string.

(On this darwin host the parent process exited 1 because `leakedSayAfter` was 1 —
R19-06. `applyP31` overrode judge's 2. Linux CI does not have that override.)

### Required remedy

`scoreAbsent` must fail unless the substitution **matches** `/was unavailable/` and
`/using /`, not unless the field is non-null. An empty string, and a constant
`'ok'`, are the next two costumes of R18-02. Do not verify the next rewrite only
against `null`.

---

## R19-05 — The recorder sees the syscall and the judge drops anything whose argv encoding is not `(cmd='say', args=…)`

**CONFIRMED · medium · R18-03; P31; the recorder claims every spawn including `exec`**

`no-audio-recorder.mjs` patches `exec` / `execSync` and records them as
`{ api, cmd: command, args: [] }` — the whole string in `cmd`. `auditSaySpawns`:

```javascript
if (spawnBase(e.cmd) !== 'say') continue
```

`spawnBase('say hello there')` is `'say hello there'`, not `'say'`.

### Probe — PATH stub `say` that `exit 0`; `/usr/bin/say` never reached

Decoy: `spawnSync('say', ['-o', '/tmp/r19-x.wav', '--', 'hello'])` **and**
`execSync('say hello there')`.

```json
{
  "entryCmds": [
    { "api": "spawnSync", "cmd": "say", "args": ["-o", "/tmp/r19-x.wav", "--", "hello"] },
    { "api": "execSync", "cmd": "say hello there", "args": [] }
  ],
  "sayCount": 1,
  "violations": [],
  "p31Rows": []
}
```

The recorder **saw** the bare exec. The judge dropped it. A sibling `say -o`
satisfied `sayCount > 0`, so the darwin "recorder is blind" row did not fire.
`p31Rows` empty. P31 green for a process that spawned bare `say`.

Grandchild: parent `--import`s the recorder, `spawnSync(node, grand.mjs)`, grandchild
`spawnSync('say', ['hello from grandchild'])` with no `--import`.

```json
{
  "entryCmds": [
    { "api": "spawnSync", "cmd": "…/node", "args": ["…/grand.mjs"] }
  ],
  "sayCount": 0,
  "violations": []
}
```

The grandchild's `say` is not in the log. On darwin ABSENT (OS-rate + bytes) this
goes red as "recorder is blind". On linux, and on darwin PRESENT (24 kHz),
`p31Rows` does not demand a say spawn. Empty `--import` module (loads, does not
patch): darwin ABSENT red ("blind"); linux `applyP31` **EXIT 2**, rows `[]`.

`--import` that throws is not silent (child writes no JSON, parent exit 3).
`--import` that loads and does nothing is silent on linux.

The product path uses `spawn('say', ['-o', …])` (darwinCommand). A mixed spawn+exec
is not today's OsSynth. It is the instrument claiming to wrap `exec` and then
judging a different encoding. The grandchild hole is the same claim: "every spawn
the process makes", past the process boundary.

### Required remedy

Parse `exec`'s command string for a leading `say`. Treat `sh -c 'say …'` the same
way, or stop claiming the recorder sees every spawn. Prove the recorder is loaded
on linux with a row that does not depend on darwin OS-rate audio (a self-spawn of
`say -v '?'` inside `--prove-p31` is enough). Do not take `sayCount > 0` from a
`-o` sibling as evidence that a bare exec was classified.

---

## R19-06 — `leakedSayAfter === 0` is red for in-flight `say -o`, the path P31 requires

**CONFIRMED · medium · R18-03 predicted this; P42 detector used as a P31 gate**

Round 18, required remedy, verbatim: *"A check that did read `leakedSayAfter === 0`
would still be green for a completed bare `say` (process gone) and red for a slow
`say -o` still writing (the correct path)."*

`p31Rows` now fails the arm when `leakedSayAfter !== 0`. Two consecutive healthy
ABSENT runs on this machine, load **2.17–2.32**, capturing sink, every recorded argv
either `-v '?'` or `-o <file>`:

```text
leakedSayAfter: 1
say spawns:   5
  say ["-v","?"]
  say ["-o", "…/out.wav", "--data-format=LEI16@22050", …]
FAIL: ABSENT leakedSayAfter=1 (want 0).
parent re-pgrep: 1 say process(es) still running (P42)
EXIT:1
```

The leftover PID was gone within a second. It was the `-o` spawn draining. This is
not a P31 violation and not a P42 orphan. It is the predicted false-red.

On darwin it also **masked R19-04**: `applyP31` overrode `judge`'s exit 2 with 1.
On linux `leakedSay()` returns 0 before `pgrep`, so the empty-substitution hole is
the exit code CI will see.

### Required remedy

`pgrep -x say` is still P42 (an orphan still running at the **start** of the parent,
already exit 3). It cannot be the P31 leftover check. P31 is argv, and argv was
clean in both runs. If leftover `say` is going to fail a run, classify it the same
way as a spawn (`ps -o args=` contains `-o` → ignore). Otherwise a slow `say -o` is
a flake that hides real ABSENT defects behind exit 1 on the one OS that has `say`.

---

## Areas examined and found sound — and what was mutated to earn that

`looks fine` is not a review. Each row below is a mutation or a drive of the named
path.

### Relative dest, and `..`, through a parent symlink into `.buzz` — SOUND

Drove `isForeignModelCache('parentlink/not-yet-created', home)` with cwd = the
outside dir, `parentlink` → `$home/.buzz/models`. `isForeign: true`. Drove
`join(outside, 'dummy', '..', 'parentlink', 'via-dotdot')`. `isForeign: true`.
Control ordinary dest `join(outside, 'ours')`: `false`. The nearest-ancestor walk
catches a relative and a `..` dest of the same shape as the R18-05 symlink parent.
Case-fold is R19-02.

### Incomplete / stale is still exit 1 — SOUND

Mutant in `artifact-score.mjs`: `if (false && productKind !== 'ready' && productKind !== 'absent')`.

```text
pnpm exec vitest run scripts/artifact-e2e.test.mjs -t "incomplete cache|stale cache|unnamed substitution|CONTROL: named"
```

**2 failed.** Exact first red:

```text
R18-02: incomplete cache is exit 1 even when ABSENT named the floor
AssertionError: incomplete was treated as a skip: expected 2 to be 1
```

Stale the same (`expected 2 to be 1`). Unnamed `null` substitution still exit 1
(that half of R18-02 holds). Restored. What callers do with `substitution: ''` is
R19-04.

### ABSENT is not skipped — SOUND

Read `artifact-e2e.mjs` `main()`: ABSENT `spawnArm` always runs; missing JSON is
exit 3. The empty-substitution drive printed the ABSENT arm (engine ready, 22050,
signal, logs). The skip that used to sit in front of `failRows` is gone as a
control-flow path. The remaining skip is semantic (R19-04: ABSENT "passes" on `''`).

### Dangling-symlink `ready` — SOUND as a name, not as bytes

R18-04's test still exists and still deletes the source after staging. This round
did not invert `existsSync` (that would re-open a closed finding). Zero-length and
wrong-digest files are `ready`; that is R19-03, not a regression of dangling.

---

## Mutation ledger

All mutants were isolated in `/tmp/r19-review-base` at `db11fea`, tested, and
restored. Shared tree product files were not edited. After restore:

```text
git -C /tmp/r19-review-base status --short
# empty
git -C /tmp/r19-review-base rev-parse HEAD
# db11fea6db914cd5ea66d7671c61f308594c3ad2
rg -n PocketSynthProvider dist/plugin/main.mjs
# 1783:var PocketSynthProvider = class {
# 2058:    registry.register(options.pocket ?? new PocketSynthProvider());
```

No `say` processes at start or end (`pgrep -x say`). Load averages during the
session **2.15–2.75** `[measured-here]`. One write into a **fake** `$home/.buzz`
(R19-02) was a timestamped child of a mkdtemp and removed before the probe
returned; `ls ~/.buzz | grep r19` was empty. Two ABSENT `--keep` dirs under
`/var/folders` hold the empty-substitution JSON; they are not in the tree.

This file is the only deliverable in the shared tree.
