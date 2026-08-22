# 022 — Round 14: Pocket-TTS pre-verification review

**Status:** adversarial review record. **Written:** 2026-08-22.  
**Subject:** `specs/003-pocket-voices/**`, commits `b7b2e3e`, `cc8c647`, and `dc710e0`, and
the Pocket tokenizer/audio/model/voice implementation that those commits introduced.  
**Review base:** experiments ran in a clean detached worktree at `f2319b8`; the targeted Pocket
baseline was **3 files, 68/68 green**, and the whole baseline was **40 files, 860/860 green**.

This is a review, not a repair. No Pocket source, test, specification, manifest, ledger, or generated
artifact was changed by this round. Every mutant below was applied only in the disposable worktree,
tested, and restored. Timings are omitted because they do not bear on any verdict.

## Verdict

**ROUND 14: 10 findings, 8 confirmed**

`CONFIRMED` means this round executed a falsifying experiment or directly measured the disputed
artifact. `SUSPECTED` means the defect is established by the source/task topology but its eventual
runtime effect cannot be executed until the unfinished provider/server work lands. Severity is the
impact if the shipped design follows the reviewed plan, not a claim that the unfinished feature is
already in a release.

| Finding | Status | Severity | Short result |
|---|---|---:|---|
| R14-01 | CONFIRMED | critical | There is no install-shaped route from the plugin artifact to the native ORT runtime, and the named npm package does not cover all six targets. |
| R14-02 | CONFIRMED | critical | The downloader/status manifest excludes every voice clip, while the phase plan requires audible Pocket voices before clips are fetched. |
| R14-03 | SUSPECTED | high | The planned `/speak` path has no backend-key dispatch, and the null-returning resolver has no production caller. |
| R14-04 | CONFIRMED | high | The TypeScript tokenizer disagrees with the pinned Python SentencePiece oracle on a 34,997-input differential corpus. |
| R14-05 | CONFIRMED | medium | Literal `U+2581` survives normalization but is lost by encode/decode, violating the prompt rejoin requirement. |
| R14-06 | CONFIRMED | critical | The claimed atomic model replacement deletes the known-good cache before the fallible rename; its tests never reach that window. |
| R14-07 | CONFIRMED | high | A wrong model digest passes the manifest tests; the checked-in values happen to be right, but the guard cannot establish that. |
| R14-08 | CONFIRMED | high | A successful install may omit upstream `LICENSE`, contrary to the spec's attribution requirement, and its test derives expectations from the implementation. |
| R14-09 | CONFIRMED | high | The resampler suite admits both severe pass-band deletion and removal of edge normalization; the live filter also emits a boundary stop-band transient. |
| R14-10 | SUSPECTED | high | The one-page falsifier can pass from a developer-preseeded cache while one-button installability and platform parity remain false. |

---

## R14-01 — The optional native runtime has no install-shaped delivery path

**CONFIRMED · critical · Principles II, III, V and IX; R022 and R072**

### Checked and ran

- Read the distribution claim in `plan.md`: optional `onnxruntime-node@1.27.0` is said to keep
  cross-platform parity and third-party installability honest, while adding nothing to the artifact.
- Read the actual build/install contract: the Orca plugin artifact is self-contained, Orca never
  runs `npm install`, and `size-gate` caps it at 50 MB.
- Ran `pnpm build && pnpm size-gate` in the detached worktree: the artifact was four files and
  0.18 MB, with neither ORT nor a runtime installer/manager.
- Ran `npm view onnxruntime-node@1.27.0 ... --json` and
  `npm pack onnxruntime-node@1.27.0 --dry-run --json`.

### Observed

The named npm tarball is **100,893,124 bytes compressed** and **270,827,297 bytes unpacked**. It
cannot enter a 50 MB artifact. It contains native binaries for Darwin arm64, Linux arm64/x64, and
Windows arm64/x64, but **not Darwin x64**. The repository has no second path that fetches and verifies
the native runtime into an external cache. Consequently a third-party Orca install receives no ORT,
and the optional-backend rule makes it fall back forever rather than making Pocket usable.

This is one distribution defect, not two findings: the absent delivery mechanism is also why the
plan's all-platform statement is not evidence of parity. Optional degradation is necessary behavior
when a backend really is unavailable; it is not an implementation of a feature whose dependency is
unavailable by construction. Windows/Linux execution remains unmeasured, and the declared package
does not satisfy R072's six-combination prebuilt requirement.

### Required remedy

Design and test an install-shaped native-runtime delivery mechanism before the engine phase: pinned
per-platform/per-arch artifacts, hashes and sizes verified before activation, a cache outside the
immutable plugin tree, named degradation on download/ABI failure, and a real smoke test on every
supported target. If one target has no binary, narrow the support claim explicitly; do not call the
absence parity.

---

## R14-02 — The phase that must be hearable runs before its voices exist

**CONFIRMED · critical · Principles I, II, V and IX; PV-FR-011 through PV-FR-015**

### Checked and ran

- Compared `POCKET_VOICES` with `MODEL_ARTIFACTS` and `requiredFiles()` by compiling and executing
  the reviewed modules.
- Measured the twelve pinned reference WAVs in the local upstream Buzz checkout.
- Mutated Eve's registry entry from `eve.wav` to `does-not-exist.wav`, then ran
  `pnpm exec vitest run packages/providers/src/pocket-synth/models.test.ts`.
- Traced the phase graph: Phase 4 is the hearable picker/falsifier; `PV-050`, which fetches and pins
  the reference clips, is in Phase 5.

### Observed

The executable comparison returned twelve missing voice files: the eleven named voices plus
`reference_sample.wav`. `requiredFiles()` contains eight model artifacts, `MODEL_LICENSE.txt`, and
the manifest only. `modelStatus()` can therefore say **ready** while no Pocket voice can supply its
conditioning clip. The Eve filename mutant left **20/20 tests green**.

The twelve upstream WAVs total **8,531,662 bytes**. The UI's advertised 166 MB total counts the eight
model artifacts, not the complete install the feature needs. A fresh download cannot satisfy the
Phase 4 falsifier because the files required to synthesize Eve and Michael do not arrive until after
that phase.

### Required remedy

Move clip pinning before downloader/status and before the falsifier. Use one independently checked
manifest covering both model repositories, require all twelve clips for ready status, calculate UI
bytes from that full manifest, and add a test that intersects every `POCKET_VOICES[*].file` with the
pinned required-file set. The success test must start from an empty cache and use downloaded files,
not developer-preseeded files.

---

## R14-03 — A qualified voice key is displayed, but no planned route dispatches it

**SUSPECTED · high · Principles I, IV and IX; PV-FR-020 through PV-FR-024**

### Checked

- Traced every use of `resolveVoiceForBackend`; only its definition and a model unit test exist.
- Traced Voice Lab `POST /speak`: it calls the one provider selected at server construction and
  passes the request options through to that provider.
- Traced the tasks for provider registration, `GET /voices`, optgroups, cache invalidation, and
  provenance. None adds backend-key dispatch to `POST /speak`.

### Observed

The planned UI can offer `pocket:eve`, while the current server still hands that string to its one
OS provider. The per-backend resolver's `null` contract has no production caller, so there is no
executable proof that `null` cannot become an OS default. On macOS, an unknown OS voice is already a
known route to silent default substitution; the unfinished Pocket provider prevents an end-to-end
confirmation today, hence `SUSPECTED` rather than `CONFIRMED`.

### Required remedy

Add an explicit server task and seam test: parse the qualified key at `POST /speak`, select its
backend, remove qualification before calling the provider, and assert with fake OS/Pocket providers
that exactly the named provider is invoked. Test missing backend and `null` voice separately; the
audible response and provenance must name the backend that actually spoke, never the one requested.

---

## R14-04 — The tokenizer is not id-for-id with the pinned oracle

**CONFIRMED · high · Principles V and IX; PV-FR-002**

### Checked and ran

- Ran the 29 checked-in tokenizer tests: all green.
- Ran a deterministic **34,997-input** differential corpus against Python `sentencepiece==0.2.2`
  using the same pinned model. The corpus included all ASCII characters and pairs, Latin-1,
  combining marks, CJK, emoji, and deterministic mixed strings.
- Mutated the Viterbi replacement comparison from `score > bestScore` to
  `score >= bestScore`, then reran `sentencepiece.test.ts`.

### Observed

The implementations disagree on small ordinary inputs, not merely malformed Unicode:

| Input | Python ids | TypeScript ids |
|---|---|---|
| `Zccc` | `[1557, 3169, 440]` | `[1557, 440, 3169]` |
| `0bbb` | `[260, 316, 1363, 512]` | `[260, 316, 512, 1363]` |

The `>` to `>=` mutant left **29/29 tests green**, exposing that the 24 golden vectors do not lock
score/tie behavior. A trial using float32-like score arithmetic fixed those two minimized cases but
not all corpus failures, so this review does not claim a one-line repair. Because token ids are model
inputs, equal decoded text does not make the resulting audio equivalent.

### Required remedy

Port the reference implementation's numeric precision and tie policy exactly, then retain the
differential generator as a development oracle and commit independently generated minimized vectors
for every discovered equivalence class. Assert parsed model properties as values, not only piece
counts. The committed `pnpm test` gate remains Node-only; Python is appropriate for regenerating
oracle data and is not introduced into the runtime or default test path.

---

## R14-05 — The SentencePiece marker can be user text, and round-trip deletes it

**CONFIRMED · medium · Principles I, V and VIII; PV-FR-007**

### Checked and ran

Passed a literal `U+2581 LOWER ONE EIGHTH BLOCK` (`▁`) through the reviewed normalizer and tokenizer,
then decoded its ids. Also compared with the reference library to distinguish a port disagreement
from a contract mismatch.

### Observed

The normalizer preserves the character. TypeScript encodes it as `[260, 260]` and decodes it as a
space, not `▁`; the reference library has the same SentencePiece convention. This is therefore not
another parity example from R14-04. It is a mismatch between the library convention and PV-FR-007's
promise that decoded chunks rejoin the prepared prompt exactly. A real prompt containing this block
character changes before inference.

### Required remedy

Choose and document an input policy before chunking: either escape the meta-symbol reversibly or
replace/reject it audibly and explicitly. Add a literal-marker vector to the normalize → tokenize →
chunk/decode seam test; a tokenizer-only reference comparison cannot protect the product contract.

---

## R14-06 — “Atomic” cache replacement deletes the known-good model first

**CONFIRMED · critical · Principles I, II, V and VI; PV-FR-014 and PV-FR-015**

### Checked and ran

- Traced the downloader's success tail: it removes the live directory and then renames staging.
- Injected `throw new Error('R14 injected swap failure after deleting the working model')`
  immediately after that removal, then ran `models.test.ts`.
- Checked the fake download bodies and failure assertions to identify which lifecycle stages the
  current tests actually execute.

### Observed

The injected catastrophic failure left **20/20 tests green**. Existing fake bodies cannot satisfy
the real manifest hashes, so no test reaches the license/manifest/swap success tail; the failure test
dies while fetching `mimi_encoder`, before deletion. At runtime, a crash or rename failure in this
window destroys the only working cache. Staging under the generic temp directory also leaves
cross-filesystem `EXDEV` as a possible rename failure. The implementation comment's “atomic” claim
is false at the exact seam where preservation matters.

### Required remedy

Stage beside the live directory on the same filesystem. Rename live to a backup, rename staging to
live, and roll the backup back on any failure; remove it only after activation succeeds. Inject file
operations so tests can fail after each rename, and independently assert that old known bytes remain
usable after every failure. Give the success test a tiny injected manifest with real matching bytes
so it reaches the tail rather than deriving an impossible fixture from production hashes.

---

## R14-07 — The manifest guard accepts a false digest

**CONFIRMED · high · Principles V and IX; PV-FR-012 and PV-013**

### Checked and ran

- Changed the first nibble of `flow_lm_main.onnx`'s SHA-256 from `f9…` to `e9…`, then ran
  `models.test.ts`.
- Independently queried the pinned Hugging Face revision's tree metadata for the seven LFS objects,
  and downloaded/hashed the small non-LFS `bundle.json`.

### Observed

The false digest left **20/20 tests green**. The test checks only digest shape, positive size, a
self-derived total, revision shape, and absence of `main`; it has no independent value oracle. A
single transcription error would therefore reject the correct download forever.

The negative result matters: the **current** seven LFS OIDs and sizes match the pinned remote tree,
and `bundle.json` is 24,381 bytes with SHA-256 `bab643…`, matching the source. This is not an
accusation that today's manifest is wrong. It is evidence that today's test cannot keep it right.

### Required remedy

Add an explicit network/integration verification job that resolves the exact pinned revision,
compares LFS OID and size for all seven graphs, downloads and hashes non-LFS artifacts, and compares
all paths/revisions/values against the source manifest. Keep the fast shape unit tests, but do not
describe them as manifest verification.

---

## R14-08 — Required attribution is optional in both code and test

**CONFIRMED · high · Principles V and IX; PV-FR-016**

### Checked and ran

- Executed `requiredFiles()` and compared it with the spec's statement that both
  `MODEL_LICENSE.txt` and upstream `LICENSE` are required.
- Removed `MODEL_LICENSE_FILE` from `requiredFiles()`, then ran `models.test.ts`.
- Traced the upstream license fetch on the success path.

### Observed

The executable required list reports `hasLicense: false`. The upstream `LICENSE` fetch is accepted
only when `response.ok`; failure does not fail installation. Removing the other license sidecar from
the implementation still left **20/20 tests green**, because the test uses `requiredFiles()` itself
to construct the expected fixture. This is P36's self-derived-oracle shape: implementation and test
can omit the same legal requirement together.

### Required remedy

Pin `LICENSE` as a required artifact with independent expected path/hash/size, fail installation if
either attribution sidecar cannot be verified, and restate the complete expected file list literally
in the test. A successful empty-cache download test must inspect both sidecars' bytes.

---

## R14-09 — The resampler checks neither the promised band nor its boundary mechanism

**CONFIRMED · high · Principles I, V and IX; PV-FR-006**

### Checked and ran

Two independent mutants and a deterministic frequency/phase probe were used:

1. Changed cutoff scale from `0.95` to `0.50`; `audio.test.ts` remained **19/19 green**.
2. Changed output from `acc / norm` to `acc`; `audio.test.ts` remained **19/19 green**.
3. Swept tones around the 24 kHz Nyquist boundary and inspected the kernel-radius boundary rather
   than averaging a 480-sample prefix.

### Observed

The first mutant discards much of the voice band above roughly 6 kHz, yet the suite's only pass-band
tone is 1 kHz. Its only stop-band tone is 14 kHz, far enough above Nyquist to flatter almost any
low-pass: the live filter's measured middle amplitudes descend from approximately 0.986 at 10 kHz to
0.137 at 12 kHz and 0.104 for the 12.25 kHz alias.

The second mutant proves the named edge-normalization check does not exercise the normalization it
claims to protect. It averages 480 output samples while the clipped kernel affects only about 17.
With the live code, a 14 kHz tone whose middle alias is roughly `0.00004` produced a first-boundary
peak from approximately 0.31 to 0.45 as phase changed. Signed normalization of a clipped high-pass
kernel amplifies the boundary transient.

These are grouped as one finding because the user-visible defect and required instrument are one:
the resampler's frequency response has no enforced transition/boundary contract. The two mutants are
reported separately so neither failure mode can disappear inside that grouping.

### Required remedy

Specify pass band, transition band, stop band, attenuation, gain tolerance, and boundary policy.
Test a multi-frequency, multi-phase sweep on the middle and on the first/last kernel radii, with a
deliberately bad control for cutoff and for boundary handling. Use a boundary extension/padding rule
appropriate to band-limited resampling rather than dividing a clipped oscillatory kernel by a near-
zero signed sum.

---

## R14-10 — The falsifier can pass without falsifying distribution or parity

**SUSPECTED · high · Principles II, III, V and IX; User Stories 1 and 2**

### Checked

Traced the spec's falsifier and the dependency graph. The falsifier asks for a single page session
“with model present” and two audible voices. Clip pinning and hosted platform checks occur after it;
native-runtime distribution is not a task at all.

### Observed

A developer can preseed models and clips and have a locally installed ORT on an arm64 Mac, then pass
the one-page falsifier while a third-party artifact cannot download a native runtime, a fresh cache
cannot acquire voices, Darwin x64 has no named binary, and Windows/Linux have not executed inference.
The test is hearable, but it is not the smallest test that could disprove the P1 distribution story
or Principle III. Because Phase 4 is unfinished, this is a source-level proof about what the stated
procedure admits, not a witnessed false acceptance.

### Required remedy

Make the falsifier start with an empty `ORCA_TTS_MODEL_DIR` in an install-shaped artifact. From the
page alone, trigger acquisition, reach verified-ready state, and hear two distinguishable voices
without a terminal, local source tree, or rebuild. Before “Done,” run a minimal native inference
smoke on every claimed platform/arch. The falsifier must fail if any file was manually preseeded or
if the backend named in provenance was not the backend that produced the bytes.

---

## Mutation ledger — the exact cannot-fail result

All seven mutants were isolated, tested, and restored. Every claimed guard stayed green.

| Mutant | Test command | Result |
|---|---|---|
| `flow_lm_main` SHA first nibble `f9…` → `e9…` | `vitest run …/models.test.ts` | **20/20 green** |
| throw immediately after `rm(liveModelDir)` | `vitest run …/models.test.ts` | **20/20 green** |
| remove `MODEL_LICENSE_FILE` from `requiredFiles()` | `vitest run …/models.test.ts` | **20/20 green** |
| Eve file `eve.wav` → `does-not-exist.wav` | `vitest run …/models.test.ts` | **20/20 green** |
| resampler cutoff scale `0.95` → `0.50` | `vitest run …/audio.test.ts` | **19/19 green** |
| resampler output `acc / norm` → `acc` | `vitest run …/audio.test.ts` | **19/19 green** |
| tokenizer winner `score > best` → `score >= best` | `vitest run …/sentencepiece.test.ts` | **29/29 green** |

The exact clean targeted control was **68/68 green** across those same three files. The whole clean
control was **860/860 green**. Therefore these are not conclusions drawn from an already-red suite.

## Negative results and exclusions

- **The checked-in manifest values are currently correct.** R14-07 is about an unfailable guard,
  not bad production hashes.
- **The Python constitution rule is not violated by this review or Phase 0.** Python was used only
  to generate/differentially audit vectors; committed runtime and `pnpm test` remain Node-only.
- **R022 is not currently violated by `tokenizer.model`.** It is a learned model artifact in the
  source tree, but the measured plugin build does not contain it. Runtime consumption from the
  external model cache is consistent with R022; copying it into a later artifact would not be.
- The voice registry's prose is weaker than its data: eight VCTK entries omit their known speaker
  ids (`p254`, `p259`, `p262`, `p303`, `p315`, `p339`, `p360`, `p361`). This is folded into R14-02's
  full-manifest/provenance remedy rather than counted separately because it has the same owner,
  artifact set, and test.
- The missing native-runtime distribution and its unmeasured parity are one item (R14-01); splitting
  consequence from cause would inflate the count. The two resampler mutants are likewise one
  response-contract item (R14-09), but both exact failure modes remain recorded.

## Stop condition for this review

This round is not dry. The two suspected rows should become executable seam tests as their provider
and server phases land; they do not need speculative product code now. The eight confirmed rows are
independent of unfinished inference: each has a measured artifact, a live oracle disagreement, or a
mutant that survived the check advertised for it. No ledger update is made here; review ownership is
limited to this record.

ROUND 14: 10 findings, 8 confirmed
