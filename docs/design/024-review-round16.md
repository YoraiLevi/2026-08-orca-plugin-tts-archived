# 024 — Round 16: go where round 15 did not

**Status:** adversarial review record. **Written:** 2026-08-23.
**Subject:** the surfaces round 15 never reached: `pocket-synth/runtime.ts` (native executable
installer), Voice Lab voice picker `bdd9c92` plus `ui-probe.mjs` U6–U9, `audio.ts` after
`ff25c1d` (was R14-09 closed?), `sentencepiece.ts` after `d6f6c80` (is the 11,344-input corpus
adequate?), and a bounded cross-cut for principle VIII / principle VI.
**Review base:** `9c2d6d4`, frozen in a clean detached worktree at `/tmp/r16-review-base` before
experiments began. The shared tree was not used for mutants. Four peer agents were editing
`pocket-synth/{index,models,engine}.ts` and `scripts/voice-lab.mjs` during this round; those files
were read at the freeze SHA and were not written.

This is a review, not a repair. No product source, test, spec, manifest, generated artifact, or
shared-memory file in the shared worktree was changed. Every mutant lived only in the disposable
worktree and was restored. Nothing opened an audio device.

## Verdict

**ROUND 16: 6 findings, 6 confirmed**

`CONFIRMED` means this round ran a discriminating probe and observed the named effect. There are no
suspected-only findings. Severity is impact if the reviewed path is used, not a claim about an
unfinished page being released today.

| Finding | Status | Severity | Short result |
|---|---|---:|---|
| R16-01 | CONFIRMED | critical | The native-runtime delivery path is implemented and unit-tested, and no production caller invokes it. The provider gives up at `onnxruntime-node` before the cache fallback can run. |
| R16-02 | CONFIRMED | high | The pinned runtime integrity that "gates an executable" is checked only for `sha512-` shape. A flipped first nibble left 20/20 green. |
| R16-03 | CONFIRMED | high | SIGKILL between the two runtime renames deletes the live executable cache. The test named for swap safety never reaches a rename. |
| R16-04 | CONFIRMED | high | The lattice remainder is a class, not a singleton. A 728-input `Xyyyyy` grid found seven disagreements the committed `it.fails` row does not name. |
| R16-05 | CONFIRMED | high | U6–U9 all pass while Pocket is absent and the OS is speaking. U9 alone fails on the same clean page. The probe is calibrated to the fallback, not to Pocket working. |
| R16-06 | CONFIRMED | high | U8 cannot see stale audio in the other direction. A reverse-only cache mutant left U8 green and the reverse check red. |

R14-09 is closed by effect, not by comment. Hostile tarball writes are contained by the integrity
check plus the basename whitelist. `unsupported` and `absent` are distinct at `runtimeStatus`.
Huddle `speak()` is fire-and-forget and drops; it does not apply backpressure to ORCA.

---

## R16-01 — The runtime installer has no production caller, and the provider never reaches it

**CONFIRMED · critical · Principles I, II, III and VI; R14-01; R022**

### What the code does

`aa649af` added `downloadRuntime()` as R14-01's install-shaped delivery path: pin a version, refuse
a bad digest, extract this platform's files, swap beside the live directory. `engine.ts` `loadOrt()`
tries `import('onnxruntime-node')`, then `runtimeStatus()`, and if the cache is `ready` imports
the binding from disk. If the cache is `absent` it throws *the Voice Lab can fetch it*
(`engine.ts:111-114` at `9c2d6d4`).

`grep downloadRuntime` over `*.ts,*.mjs,*.js,*.html` at the freeze SHA returns only
`runtime.ts` and `runtime.test.ts`. Voice Lab does not import the module. There is no runtime
download endpoint.

Separately, `PocketSynthProvider.#prepareOnce` (`index.ts:170-177`) does this:

```text
await this.#loadOrt()                          // default: import('onnxruntime-node')
const { PocketTts } = await this.#loadEngine()
this.#engine = await PocketTts.load(this.#dir) // this is the call that would use the cache
```

The default `#loadOrt` is not `engine.loadOrt`. A missing `node_modules` copy throws
`PocketOrtUnavailableError` and never reaches `PocketTts.load`.

### First-red probe

A disposable test gave `prepare()` a failing `loadOrt` (the production default's failure mode), a
`ready` model status, and a `loadEngine` spy, then required the engine path to be attempted:

```text
FAIL ... > still loads the engine after onnxruntime-node fails to import
PocketOrtUnavailableError: Pocket TTS needs the optional module "onnxruntime-node",
but it could not be loaded: Cannot find module 'onnxruntime-node'

 ❯ PocketSynthProvider.#prepareOnce packages/providers/src/pocket-synth/index.ts:173:13
```

`loadEngine` was never called. A third-party install with a populated runtime cache still cannot
prepare. The error that says the Voice Lab can fetch the runtime is a sentence about a button that
does not exist.

### Required remedy

Default `#loadOrt` must be `engine.loadOrt` (node_modules, then verified cache). Wire
`downloadRuntime` to a Voice Lab endpoint with the same progress surface as the model download.
A production-shaped test: empty `node_modules`, populated cache, `prepare()` succeeds; empty
cache, the page can fetch; `darwin-x64`, the page offers no download and names the OS floor.

---

## R16-02 — The executable's integrity pin is a shape check

**CONFIRMED · high · Principles V and IX; R14-07's costume on an executable**

`RUNTIME_INTEGRITY` is documented as npm's digest, *re-verified against the bytes on this machine*,
because *this one gates an executable* (`runtime.ts:52-60`). The test that claims to pin it is:

```text
expect(RUNTIME_INTEGRITY).toMatch(/^sha512-[A-Za-z0-9+/]+={0,2}$/)
```

(`runtime.test.ts:86-89`.)

### First-red probe

Mutant M1 flipped the first nibble of the pin from `QEzGwr…` to `AEzGwr…`. Command:

```text
pnpm exec vitest run packages/providers/src/pocket-synth/runtime.test.ts
```

**20/20 green.** Load averages **4.06 / 3.73 / 3.44** `[measured-here]`. The same suite's control
was 20/20 before the edit.

A transcription error in the pin would refuse the real npm tarball forever, or — if someone
"fixes" a failure by pasting a digest of a substituted archive — accept an executable. The test
cannot tell those apart. This is R14-07's shape on the file that runs as the user.

The *bytes* check is real: mutant M3, skipping the `got !== wantIntegrity` throw, went red on
`REFUSES a tarball whose integrity does not match`. The production comparison works. The pin's
*value* is unguarded.

### Required remedy

An independent job (or a checked-in `npm view` fixture with the exact integrity string, size, and
shasum) must compare `RUNTIME_INTEGRITY` to the registry's digest for that exact version. Keep the
shape test. Do not describe the shape test as pinning.

---

## R16-03 — The swap-safety test never reaches the swap, and SIGKILL deletes the live runtime

**CONFIRMED · high · Principles I, II, V and VI; R14-06 / R15-02 on the executable cache**

### What the test claims

`runtime.test.ts:191-201` is named `KEEPS a working runtime when the swap fails`. Its fixture is
`makeTarball(KEY, FILES.slice(0, 1))` with the comment `missing a file -> throws during extraction`.
That throw is at the *wanted-files* check, before `mkdir(staging)` and before either rename.

### Mutant M4

Injected `throw new Error('R16 injected swap failure after deleting the working runtime')`
immediately after `rename(dir, backup)` and before `rename(staging, dir)`.

```text
Test Files  1 failed (1)
     Tests  3 failed | 17 passed (20)
```

The three reds are the *success* tests (`extracts THIS platform's files`, `reports progress`,
`is ready only after a real download`). The named swap-safety test is among the 17 that stayed
green: it never executes the injected line.

### SIGKILL probe

A child ran `downloadRuntime` against a seeded previous cache. After `rename(live, backup)` the
child wrote a marker and spun. The parent sent `SIGKILL`.

```json
{ "killed": true, "live": false, "liveBinding": null, "backupExists": true }
```

The live directory is gone. A PID-suffixed backup exists. `runtimeStatus()` looks only at `dir`;
it cannot see the backup. A later process uses a different PID and never recovers it. `runtime.ts`
has no `afterBackup` seam, so this window is invisible to the suite without editing source.

This is R15-02's crash window copied onto an executable. It is counted because the *test named for
the property* cannot fail for it, and because the artifact is a `.dylib` / `.node`, not a weight
file.

### Required remedy

Give the runtime swap the same recoverable journal R15-02 asked of the model cache. Change the
named test's fixture from "tarball missing a file" to "complete tarball, injected failure after
each rename, and a SIGKILL child." Assert the previous bytes are discoverable after restart.
Unique staging names; a filesystem-visible lock.

---

## R16-04 — The lattice remainder is a class; the committed oracle names one member

**CONFIRMED · high · Principles V and IX; PV-FR-002; R14-04 / PV-079**

`d6f6c80` ported SentencePiece's lattice. The file and the test both state **11,343 / 11,344
exact**, with one `it.fails` remainder: `Zggggg`. Blast radius is written as *1 in 11,344 over an
adversarial corpus, and 0 in 180 realistic inputs*.

### Corpus A — classes the 11,344 write-up does not claim

785 inputs, TypeScript `SentencePieceUnigram` against Python `sentencepiece` on the same
`tokenizer.model`:

- letter/digit runs of length 1–8
- Unicode whitespace (NBSP, em-space, ZWSP, BOM, soft hyphen, CR/LF)
- U+2581, NFC vs NFD, combining marks
- Arabic, Hebrew, mixed bidi, bidi override
- ZWJ family emoji, flag regional indicators, skin-tone, VS16
- fullwidth Latin, Hangul, Thai, CJK mixed with ASCII
- NUL, `<s>` / `<pad>`, smart quotes, URL, shebang, markdown image
- all non-NUL ASCII singles and a vowel/digit pair grid

Command: `uv run --with sentencepiece python3` plus
`node --experimental-strip-types` importing `sentencepiece.ts`.

**784 / 785 agreed.** The one disagreement is the known `Zggggg`. RTL, ZWJ, NFD, flags, and
fullwidth are not a hidden second class.

### Corpus B — the rest of the `Xyyyyy` family

728 inputs: every lowercase pair `a + b.repeat(5)`, plus 9- and 12-letter runs. **7 disagreements**,
all the same lattice-tie shape as `Zggggg`:

| Input | TypeScript ids | Python ids |
|---|---|---|
| `fggggg` | `[521, 453, 1129, 1129]` | `[521, 1129, 453, 1129]` |
| `jbbbbb` | `[260, 1000, 512, 1363, 1363]` | `[260, 1000, 1363, 512, 1363]` |
| `nzzzzz` | `[953, 690, 1818, 1818]` | `[953, 1818, 690, 1818]` |
| `qzzzzz` | `[260, 3937, 690, 1818, 1818]` | `[260, 3937, 1818, 690, 1818]` |
| `uzzzzz` | `[260, 483, 690, 1818, 1818]` | `[260, 483, 1818, 690, 1818]` |
| `vzzzzz` | `[1451, 690, 1818, 1818]` | `[1451, 1818, 690, 1818]` |
| `wbbbbb` | `[859, 512, 1363, 1363]` | `[859, 1363, 512, 1363]` |

The 11,344 corpus was not adequate to *bound the remainder*. It was adequate to find a singleton
and stop. The committed `it.fails` row will go green if someone special-cases `Zggggg` and leaves
the other seven (and whoever else is in the class) speaking the wrong ids. Token ids are model
inputs; equal decoded text does not make equal audio.

### Required remedy

Treat the remainder as a class: generate every `X + y.repeat(n)` the lattice can tie, commit the
minimized members, keep `it.fails` until the port matches Python on the whole class. Do not close
PV-079 on `Zggggg` alone. The mixed-script negative result above can stay as a regression net.

---

## R16-05 — U6–U9 pass while Pocket is absent and the OS is speaking

**CONFIRMED · high · Principles I, IV, V and IX; P47; PV-040…044**

`ORCA_TTS_MODEL_DIR` was pointed at an empty directory. Chrome was headless and muted. Load
averages **3.98 / 4.23 / 3.77** `[measured-here]`. The page snapshot before any check:

- selected `os:Albert`
- provenance `Nothing has played yet.`
- download button `Download the neural voices (173.8 MB)`
- all twelve Pocket options present, enabled, labelled `download needed (173.8 MB)`

Then all nine checks passed, including U6–U9.

### U6 — Pocket absent, request object moves, no Pocket audio

U6's effect assertion is `__labEffect().speak.synthesize.voice`, the options bound for the
synthesizer, not bytes of audio and not which provider ran. Observed:

```text
[  ok  ] U6  … synthesis moved os:Albert -> pocket:anna
```

`--prove` for U6 drops the optgroups. That proves the *shape* half. It does not prove the effect
half, and the effect half does not prove Pocket spoke.

### U7 — the stub cannot fail

Armed `window.__ui.stubDownload` always emits:

```text
{ kind: 'complete', ok: true, backend: 'pocket', fileCount: 20, totalBytes: 173764082 }
```

(`ui-probe.mjs:124-127`.) There is no `kind: 'error'` arm. A download that fails, a confirm button
that does not appear, a progress bar that lies, and the page's `phase === 'failed'` sentence are
all unexercised. Deleting the `catch` in `downloadVoices()` cannot turn U7 red, because U7 never
enters it.

### U9 — leftover state from U8's OS fallback

U9's pass condition is the conjunction of *selected Pocket*, *footer says Requested Pocket TTS*,
*footer says played by this machine's system voice*, and *exported `tunedWith` starts with `os`*
(`ui-probe.mjs:767-772`). That is a check that Pocket did **not** speak.

Full suite, after U8:

```text
[  ok  ] U9  … selected pocket:anna; footer names the OS fallback and exported tunedWith is os
```

The same clean page, U9 alone (`--only=U9`):

```text
[ FAIL ] U9  provenance names what actually spoke
         … {"selected":"os:Albert","effect":{"footer":"Nothing has played yet.",
            "tunedWith":"nothing-played-yet"}}
```

U9 is not a standalone check. It asserts leftover state from U8. `--prove` for U9 runs U9 alone
against a broken copy, so it goes red whether or not the breakage is the one named: the clean page
is already red in isolation.

A working Pocket install would fail U7 (no download button) and U9 (no OS-fallback footer). The
instrument that is supposed to watch the picker cannot go green on the success path of the feature.

### Required remedy

Hermetic empty cache as the default, plus a second arm with Pocket actually ready. U6 must assert
the `/speak` body reached the Pocket provider, or that provenance.backend is `pocket`, not that
the request object changed. U7 needs a failed-download arm that demands the error sentence and a
working OS floor. U9 must select Pocket and play *itself*, and must have two expected footers: OS
fallback when Pocket cannot, Pocket provenance when it can. `--prove` for U9 must go red on the
full suite, not only in isolation.

---

## R16-06 — U8 cannot see stale audio in the other direction

**CONFIRMED · high · Principles I and V; FR-023; P47**

U8 primes OS, switches to Pocket, and demands a new `/speak` plus Replay disabled. The live
product is symmetric: a reverse check on the unmodified page also passed
(`pocket:anna -> os:Albert`, new `/speak`, Replay disabled).

The *check* is not symmetric. A page mutant that keys Pocket voices normally and, once a Pocket
voice has been seen, keys subsequent OS voices as that Pocket voice produced:

```text
[  ok  ] U8   … os:Albert -> pocket:anna; Replay was invalidated
[ FAIL ] U8REV  reverse cache invalidation failed:
         {"replayDisabled":true, "osBody":null}
```

U8 stayed green. The reverse play hit the Pocket cache (`osBody` null: no `/speak`). Replay was
disabled because `lastPlayed` is cleared on voice change — U8's Replay assertion cannot see this
either. The listener who tries Pocket and then switches back to a system voice hears the neural
clip under an OS label.

`--prove` for U8 removes `voice` from `KEYED_FIELDS`, which breaks *both* directions. It cannot
catch a one-way key.

### Required remedy

Exercise both orders. Assert `/speak` (or a cache miss) after `os → pocket` *and* after
`pocket → os`, and after `pocket:anna → pocket:eve`. `--prove` needs a one-direction breakage,
not only "forget voice entirely."

---

## R14-09 — closed by effect

Mutants against `audio.ts` at `9c2d6d4`, `pnpm exec vitest run …/audio.test.ts`, control **23/23**.

| Mutant | Result | What went red |
|---|---|---|
| cutoff `0.95` → `0.50` (R14-09's first mutant) | **RED** | pass band through 9 kHz |
| `acc / norm` → `acc` (R14-09's second mutant) | **RED** | DC edge gain; also the 2-sample resample case |
| `reflectedIndex` → clamp-to-edge | **RED** | stop-band energy at the first/last kernel radii |
| cutoff `0.95` → `0.85` | **GREEN** | bound: 9 kHz still ≥ 0.95 gain |

The cause R14-09 named — no pass-band / boundary contract — is now an instrument that can fail.
`ff25c1d` was not a symptom patch. The 0.85 bound is recorded so a later round does not rediscover
it as a defect; it is not counted.

---

## Tar parser as a security surface — negatives, recorded so they are not re-proposed

`readTar` is not itself a sandbox. These were run against the frozen module.

| Attack | `readTar` | `downloadRuntime` |
|---|---|---|
| `../`, absolute, GNU long-name traversal | **returns the names** | **contained** — basename whitelist, nothing written outside staging |
| symlink / hardlink entries (type `1`/`2`) | **skipped** | **refused** as missing wanted files |
| 12-digit octal size `77777777777` (~8.5 GB) | returns a clamped short body, no throw, no allocation bomb | n/a |
| integrity mismatch | n/a | **nothing written** (M3 proves this test can go red) |
| empty wanted files, injected matching integrity | n/a | **installed** (production pin is of the real tarball) |
| `readTar` keeps bodies of files it will not install | 5 MB decoy copied | filter happens after parse |

Mutant M2 (`type === '2' \|\| type === '1'` treated as regular files) left **20/20 green**. The
parser's refusal of links is untested. It is not counted separately: production skips links, and
the whitelist would still have to match a wanted basename. Folded into R16-02's "the security
comments overclaim what the tests lock."

`unsupported` vs `absent`: `runtimeStatus('darwin-x64')` returns `unsupported` with the Intel-Mac
sentence; a missing dir on `linux-x64` returns `absent`; a wrong manifest returns `stale`. Mutant
M5 collapsing `unsupported` into `absent` went **red** on `runtime.test.ts`. Mutant M10, making
`loadOrt` throw that state with `reason: 'absent'`, left `engine.test.ts` **green** — the engine
file's "caller must tell them apart" test constructs two `Error` objects and never calls
`loadOrt`. That is a wiring-test gap, not a product confusion at `runtimeStatus`. Not counted.

---

## Cross-cut — principle VIII and principle VI

`SpeechService.speak` is `void`, enqueues, and drops oldest replies at `maxQueued`
(`speech-service.ts:359-390`). Huddle calls it without awaiting
(`huddle/index.ts:521-522`). This path does not apply backpressure to ORCA. Negative.

No new "speak what was not said" path was demonstrated in the reviewed files. Wrong tokenizer ids
(R16-04) are the closest: the listener hears a plausible word that is not the segmentation the
model's own tokenizer would have produced. That is already filed above rather than double-counted
as VIII.

---

## Mutation ledger — the exact cannot-fail result

All mutants were isolated in `/tmp/r16-review-base` at `9c2d6d4`, tested, and restored. Baseline
control: runtime **20/20**, audio **23/23**, load averages **4.06 / 3.73 / 3.44** `[measured-here]`.

| Mutant | Test command | Result |
|---|---|---|
| `RUNTIME_INTEGRITY` first nibble `Q` → `A` | `vitest run …/runtime.test.ts` | **20/20 green** |
| `readTar` accepts symlink/hardlink as files | `vitest run …/runtime.test.ts` | **20/20 green** |
| skip `got !== wantIntegrity` throw | `vitest run …/runtime.test.ts` | **RED** (integrity refusal) |
| throw after `rename(live, backup)` | `vitest run …/runtime.test.ts` | **3 failed / 17 passed** — swap-safety test green |
| `runtimeStatus` returns `absent` for `darwin-x64` | `vitest run …/runtime.test.ts` | **RED** |
| `loadOrt` reports unsupported as `reason: 'absent'` | `vitest run …/engine.test.ts` | **7/7 green** (7 skipped, no model) |
| resampler cutoff `0.95` → `0.50` | `vitest run …/audio.test.ts` | **RED** |
| resampler `acc / norm` → `acc` | `vitest run …/audio.test.ts` | **RED** |
| `reflectedIndex` → clamp | `vitest run …/audio.test.ts` | **RED** |
| cutoff `0.95` → `0.85` | `vitest run …/audio.test.ts` | **23/23 green** |
| `prepare()` after `onnxruntime-node` import fails | disposable first-red | **RED** (`loadEngine` never called) |
| SIGKILL between runtime renames | child + marker | live dir **absent**, backup PID-suffixed |
| U9 alone on the clean page | `node scripts/ui-probe.mjs --only=U9` | **FAIL** |
| reverse-only `keyFor` mutant | U8 vs reverse U8 | **U8 green, reverse red** |

---

## Controls and exclusions

- Clean targeted control at `9c2d6d4`: runtime 20/20, audio 23/23.
- UI probe, empty `ORCA_TTS_MODEL_DIR`, headless Chrome, `--mute-audio`, injected gain 0: **U1–U9 all ok**, Pocket labelled `download needed`.
- Tokenizer mixed-script corpus: **784/785**, remainder = `Zggggg` only.
- Tokenizer `Xyyyyy` grid: **721/728**, seven new members of the same class.
- `pnpm test` in the *shared* tree may be red while peers write tests first. Not used as a finding.
- R14-04's known `Zggggg` `it.fails` row is not counted again; R16-04 is the under-count of that class.
- R15-02 is not inflated into this round except where the executable installer copies the hole
  *and* its own named test cannot see it (R16-03).
- No test or probe opened an audio device. `say` was checked at start (`pgrep -x say`); none leaked
  from this round's commands.
- Worktree patches (`ui-probe --only`, voice-picker mutants, disposable provider test) were
  restored. The shared tree received only this file.

## Stop condition for this review

This round is not dry. The six confirmed rows are independent of unfinished peer edits: each has a
mutant that survived the advertised check, a production caller that does not exist, a corpus
disagreement against Python, or a UI probe that passed on the fallback and failed when isolated.
No ledger update is made here; review ownership is limited to this record.

ROUND 16: 6 findings, 6 confirmed
