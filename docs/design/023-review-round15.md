# 023 — Round 15: Pocket-TTS adversarial review

**Status:** adversarial review record. **Written:** 2026-08-23.
**Subject:** the Pocket inference loop and oracle, the R14-02/R14-06 repairs, the provider seam,
and the Voice Lab model endpoints named in the round-15 brief.
**Review base:** `3b61429`, frozen in a clean detached worktree before experiments began. This
includes the brief's named commits plus `6f4545b` and `3b61429`, which had already landed when the
base was frozen. Commits and uncommitted peer edits that arrived after the freeze are not evidence
for this round and are not silently folded into its verdict.

This is a review, not a repair. No product source, test, spec, manifest, generated artifact, or
shared-memory file in the shared worktree was changed. Every added assertion and every engine
mutation below lived only in disposable detached worktrees. Nothing opened an audio device.

## Verdict

**ROUND 15: 9 findings, 9 confirmed**

`CONFIRMED` means this round ran a discriminating probe and observed the named effect. There are no
suspected-only findings. Severity is impact if the reviewed path is used, not a claim about an
unfinished page being released today.

| Finding | Status | Severity | Short result |
|---|---|---:|---|
| R15-01 | CONFIRMED | critical | Pocket `cancel()` wins an output race but never cancels the ONNX frame loop. |
| R15-02 | CONFIRMED | critical | The cache swap is not crash-safe or multi-process-safe; a hard signal removes the live model and two Labs both acquire the supposed single-writer slot. |
| R15-03 | CONFIRMED | high | The landed `/speak` endpoint hands `pocket:eve` to the OS provider and returns 200. |
| R15-04 | CONFIRMED | high | A 260-token sentence is returned as one chunk against the bundle's 50-token maximum. |
| R15-05 | CONFIRMED | high | The STT oracle passes wrong transcripts and two load-bearing numerical engine mutants. |
| R15-06 | CONFIRMED | high | The production lazy engine import fails under plain Node; the oracle's custom resolver hides it. |
| R15-07 | CONFIRMED | high | `SynthesizeOptions.rate` is discarded, leaving the Voice Lab rate control inert for Pocket. |
| R15-08 | CONFIRMED | medium | Provider capabilities understate the required download by all twelve voice clips: 165,232,420 vs 173,764,082 bytes. |
| R15-09 | CONFIRMED | high | A cache missing upstream `LICENSE` still reports `ready`; the R14-08 attribution repair is incomplete. |

---

## R15-01 — Cancellation stops delivery, not synthesis

**CONFIRMED · critical · Principles I, VI and VII; R014; PV-024**

### What the code does

`PocketSynthProvider.generate()` creates a local cancellation token, starts
`engine.synthesize(text, state, {})`, and races that promise against `active.stopped`
(`pocket-synth/index.ts:186-212` at the review base). `cancel()` only resolves the local stopped
promise (`:228-232`). There is no abort signal or callback in `PocketTtsEngine.synthesize`,
`PocketTts.synthesize`, or `framesFor`.

The existing PV-024 test therefore proves only that the async iterator yields no stale bytes. Its
fake synthesis promise never resolves, and the test goes green precisely because the abandoned
work is allowed to keep running forever. The task's promised assertion was different: *the frame
loop stopped, by effect, within the budget*.

### First-red probe

The disposable test captured the options passed to a deliberately non-terminating engine, called
`cancel()`, waited for the provider iterator to end, then required the engine's abort signal to be
present and aborted.

```text
FAIL ... > R15 probe: cancel reaches the engine frame loop, not only the output iterator
AssertionError: no abort signal reached PocketTts.synthesize:
expected undefined to be an instance of AbortSignal

Tests  1 failed | 9 passed (10)
```

The important conjunction is observed: the existing iterator-budget row stayed green while the
engine-facing row went red. The provider can report `cancel()` complete while native inference is
still consuming CPU for text the listener already interrupted. A second utterance can then contend
with the abandoned first one.

### Required remedy

Thread one cancellation primitive through provider → `PocketTts.synthesize` → `framesFor`, check it
between every awaited ONNX call and before every decoder batch, and make `cancel()` resolve only
after that loop acknowledges cancellation. Keep the existing no-stale-output assertion, but add an
independent counter/gate proving no further frame or decoder call begins after cancellation.

---

## R15-02 — The repaired swap survives exceptions, not process death or another process

**CONFIRMED · critical · Principles I, II, V and VI; PV-FR-012; R14-06**

### Hard-signal probe

The R14 rewrite stages beside the live directory and catches JavaScript exceptions around the two
renames. That is an improvement, and its injected `afterBackup`/`afterSwap` exception tests are
real. But `rename(live, backup)` still makes the documented claim false: until
`rename(staging, live)` completes, there is no live model. A `catch` cannot execute after a hard
signal or power loss.

The first-red test seeded a known-good cache, ran `downloadModel()` in a child, and sent the child
`SIGKILL` from the existing `afterBackup` seam—after the live directory moved aside and before the
staging rename. The parent then checked the effect:

```text
FAIL ... > R15 probe: a hard signal between the two renames leaves the live model usable
AssertionError: SIGKILL removed the only live model; recovery exists only in catch:
expected false to be true

Tests  1 failed | 35 skipped (36)
```

The backup did exist, but `modelStatus(live)` could not see it. A later process uses a different
PID-suffixed backup name and never scans or recovers the orphan; eventual PID reuse can instead
remove it without inspection (`models.ts:320-336`). There is no startup recovery protocol.

### Concurrent-writer probe

The endpoint's `modelDownloadInFlight` is a closure local to one `createLabServer()` instance
(`voice-lab.mjs:913-915,969-979`). It is not a cache lock. Two Lab processes—or simply two server
instances in one process—can write the same cache. The model manager then names staging and backup
from only the target and `process.pid` (`models.ts:261-267`), so same-process writers share both
scratch paths; different processes still race the same two live-directory renames.

The first-red test opened two independent Lab servers over one isolated cache, held both injected
downloads open, and posted to each endpoint:

```text
FAIL ... > R15 probe: two Lab processes sharing one cache cannot both start a download
AssertionError: both processes accepted a writer for the same cache:
expected [ 200, 200 ] to deeply equal [ 200, 409 ]

Tests  1 failed | 51 skipped (52)
```

One more gap was established by source search: `afterSwap` is called an activation seam in the
tests, but no production caller supplies it. The only non-test occurrences are its interface and
the call inside `downloadModel`. Production discards the backup without ever loading the five
graphs. The tiny success fixture even demonstrates that hash-valid nonsense ONNX bytes can earn a
successful swap when supplied as the injected manifest.

### Required remedy

Use a filesystem-visible single-writer lock scoped to the cache, unique staging names, and a
recoverable swap journal. On entry, recover `backup → live` when live is absent before deleting any
backup. Validate the newly live bundle by actually loading the required graph/session surface before
discarding the known-good copy. A hard-kill child test, two-process contention test, pre-existing
backup test, and activation-failure test must all assert the old model is discoverable after restart.

---

## R15-03 — `/speak` advertises Pocket and then invokes the OS provider

**CONFIRMED · high · Principles I, IV and IX; PV-FR-023 through PV-FR-025; R14-03**

At the frozen base the server imports only `OsSynthProvider`, constructs one `prov`, and uses it for
every `POST /speak` and `/stop` (`voice-lab.mjs:47-62,904-950`). `GET /voices` independently appends
twelve Pocket-shaped records based only on model-file status (`:802-827,953-962`). No
`PocketSynthProvider` exists in the server, and no backend-qualified dispatch occurs.

The first-red HTTP test posted `voice: "pocket:eve"` with a recording OS fake. The response was 200,
and the OS fake received the Pocket-qualified key:

```text
FAIL ... > R15 probe: POST /speak never hands a pocket voice to the OS provider
AssertionError: the OS provider was invoked for a Pocket-qualified voice:
expected [ { ... } ] to deeply equal []

Received:
[{ "opts": { "voice": "pocket:eve", "signal": AbortSignal },
   "text": "This must use Pocket." }]

Tests  1 failed | 50 skipped (51)
```

This promotes R14-03 from suspected to confirmed. On an OS synthesizer that substitutes its default
for an unknown voice, the response is successful audio in the wrong backend—the exact silent
substitution the qualified key was meant to prevent. `GET /voices.available` also means only “files
present”, not “the Pocket provider/runtime can prepare”.

### Required remedy

Construct both providers, parse the qualified key before response headers, strip qualification only
after selecting the matching provider, and route `/stop` to the provider actually serving the
request. If Pocket cannot prepare, use the OS floor only with explicit response provenance and a
spoken/visible degradation reason. A production-shaped HTTP test must use real default wiring, not
two fakes that restate the desired dispatch.

---

## R15-04 — The splitter has no fallback below sentence boundaries

**CONFIRMED · high · Principle V; PV-FR-007; PV-013**

`splitIntoChunks()` builds boundaries only after sentence-ending token pieces. When a segment alone
exceeds `max_token_per_chunk`, the overflow branch is guarded by `current !== ''`; the first
oversized segment is therefore accepted whole (`engine.ts:404-442`). There is no clause, word, or
Unicode-scalar fallback.

The test was written first against the real bundle. Ninety whitespace-separated words encoded as
260 tokens. The engine returned one chunk against the bundle's 50-token maximum:

```text
FAIL ... > R15 probe: a single sentence still stays inside the model cap
AssertionError: expected 1 to be greater than 1

const chunks = tts.splitIntoChunks(text)
expect(chunks.length).toBeGreaterThan(1)

Tests  1 failed | 14 passed (15)
```

The existing “keeps every chunk inside the cap” row permits
`tokenCount <= maxTokenPerChunk * 2` and uses many short punctuated sentences. It cannot reach this
failure. The Phase-1 task explicitly named a single boundary-free 60-token sentence as its negative
control; that control was not implemented.

### Required remedy

Use the natural fallback ladder already present in the cross-read implementation: sentence, clause,
word, then Unicode scalar, checking the prepared token count at every candidate. Assert every chunk
is `<= maxTokenPerChunk`, never `* 2`, and assert byte/code-point conservation for one oversized
sentence, one oversized word, punctuation with closing quotes, and non-ASCII text.

---

## R15-05 — The semantic oracle admits wrong words and wrong numerical loops

**CONFIRMED · high · Principles V and IX; R003; PV-FR-004**

### The threshold admits a known wrong answer

The oracle's one fixed sentence has nine words and accepts WER `<= 0.25`
(`pocket-e2e.mjs:83-111,289-294`). Therefore two deletions pass. Running the script's exact WER
algorithm over a deliberately wrong transcript produced:

```json
{
  "asked": "The quick brown fox jumps over the lazy dog.",
  "heard": "The brown fox jumps over the dog.",
  "wer": 0.2222222222222222,
  "gate": 0.25,
  "passes": true
}
```

Punctuation is already normalized away before WER, so the comment that strict equality would fail
on a comma does not justify allowing two of nine words to disappear. The clean deterministic arm
transcribed at WER 0.00.

### `--prove` proves one mutation, not the engine

The clean `--prove` control worked as designed: zero-filling recurrent state went red at WER 0.67.
Two other gross mutations also went red: swapping same-shaped flow states 0 and 3 produced WER 1.00,
and preventing EOS from ever firing produced “...the lazy dog. The lazy dog.” at WER 0.33.

But two load-bearing mutations survived the same oracle:

| Mutation | Baseline effect | Mutant effect | Oracle |
|---|---:|---:|---|
| `framesAfterEos` effective value → `0` | 3.04 s output | 2.80 s output | **WER 0.00, PASS** |
| Euler interval `dt = 1/steps` → `0.9/steps` | 3.04 s output | 2.96 s output | **WER 0.00, PASS** |

The first deletes 240 ms through the exact mechanism whose own comment warns about a swallowed final
consonant (`engine.ts:447-453,550-560`). The second stops integration at 0.9 rather than 1.0. Both
change the model computation; neither silence nor a different reference clip can expose that,
because those controls check the transcriber, not these numerical contracts.

### Required remedy

For the fixed deterministic sentence, require exact normalized words (WER 0) unless an independently
measured corpus justifies a nonzero bound; a nine-word sample cannot support a 0.25 tolerance. Add
several independent sentences, including short and tail-sensitive words. Keep STT for semantic
correctness, but add numerical/property checks for frame count/EOS tail and integration endpoints,
and make `--prove` a small mutation matrix rather than one zero-fill switch. Each mutant above must
make a named gate red.

---

## R15-06 — The production engine cannot load under the Voice Lab's resolver

**CONFIRMED · high · Principle V; P38; SC-14**

`PocketSynthProvider` lazily imports `./engine.ts`, which then imports `./sentencepiece.js` and
`./audio.js` (`engine.ts:31-34`). Plain Node does not rewrite those specifiers to the `.ts` files on
disk. The direct production-shaped probe failed:

```text
$ node --experimental-strip-types --input-type=module \
    -e "await import('./packages/providers/src/pocket-synth/engine.ts')"

Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'.../packages/providers/src/pocket-synth/sentencepiece.js'
imported from .../packages/providers/src/pocket-synth/engine.ts
```

Vitest rewrites the specifiers, so all provider/engine unit tests stay green. The provider tests
also inject `loadEngine`, bypassing the default import. Finally, `pocket-e2e.mjs` installs a custom
`registerHooks` resolver that maps `.js` to `.ts`; the oracle therefore masks the failure instead of
testing the production lazy import. The esbuild plugin bundle is a different resolver and is not
claimed broken by this finding.

### Required remedy

Name the files on disk (`.ts`) as P38 requires, then run the real default `PocketSynthProvider`
prepare path under a fresh plain-Node process. Extend SC-14's production import inventory through
lazy modules, so adding a dynamic dependency cannot stop at a green top-level import.

---

## R15-07 — Pocket drops the shared rate option

**CONFIRMED · high · Principles I, IV and V; P26/P47; `SynthesizeOptions.rate`**

The Voice Lab sends `{ voice, rate }`, and the shared contract defines rate as the provider's speech
rate. The OS provider explicitly honors it on all backends. Pocket calls
`engine.synthesize(text, state, {})` (`pocket-synth/index.ts:202-205`), discarding both `opts.rate`
and the cancellation signal.

The first-red effect test used a rate-aware fake engine, synthesized the same text at 0.7 and 1.4,
and compared the emitted WAV bytes:

```text
FAIL ... > R15 probe: the shared rate option changes Pocket output by effect
AssertionError: PocketSynthProvider discarded SynthesizeOptions.rate:
expected Buffer[...] to not deeply equal Buffer[...]

Tests  1 failed | 10 skipped (11)
```

This is P47 in the new backend: the UI can prove that the request object changes while the spoken
effect does not. A Pocket selection makes the existing rate control inert.

### Required remedy

Define how Pocket changes rate (engine conditioning if supported, or an explicit audio-domain
operation that preserves pitch), plumb the shared option, and keep an end-to-end effect test from
page request to different output duration/bytes. If Pocket cannot honor rate, remove/disable the
control with a named backend reason instead of accepting and ignoring it.

---

## R15-08 — The provider still advertises the pre-voice download size

**CONFIRMED · medium · Principles I and V; PV-FR-022; R14-02**

R14-02 correctly changed readiness to require twelve voice clips and introduced
`INSTALL_TOTAL_BYTES = MODEL_TOTAL_BYTES + VOICES_TOTAL_BYTES`. The provider capability still uses
`MODEL_TOTAL_BYTES`, and its test asserts that same old constant. The first-red independent seam
assertion observed the exact drift:

```text
FAIL ... > R15 probe: capabilities advertise every byte modelStatus requires for ready
AssertionError: the twelve required voice clips were omitted from the advertised download:
expected 165232420 to be 173764082

Tests  1 failed | 11 skipped (12)
```

The server endpoint happens to use the complete total, but any other consumer of the provider
contract understates the pressed download by 8,531,662 bytes. This is the symptom-level half of the
R14 fix: the manifest changed and one independently maintained consumer did not.

### Required remedy

Set the capability from `INSTALL_TOTAL_BYTES`, and make the test compare against the complete
ready-set rather than the implementation's chosen partial constant. One invariant should compute
the advertised bytes from every artifact `modelStatus()` requires.

---

## R15-09 — Upstream `LICENSE` is fetched but not required

**CONFIRMED · high · Principles V and IX; PV-FR-013; R14-08**

`downloadModel()` now refuses a failed upstream license request and writes `LICENSE`; that is a real
improvement. But `requiredFiles()` contains weights, voices, `MODEL_LICENSE.txt`, and the version
manifest—never upstream `LICENSE` (`models.ts:147-154`). Consequently `modelStatus()` declares an
attribution-incomplete cache ready.

The first-red test seeded exactly `requiredFiles()`, verified `LICENSE` was absent, and asked status:

```text
FAIL ... > R15 probe: ready requires the fetched upstream LICENSE beside the model
AssertionError: modelStatus called an attribution-incomplete cache ready:
expected 'ready' to be 'absent'

Tests  1 failed | 36 skipped (37)
```

The upstream license is also outside the pinned artifact table: no digest or length is recorded.
Thus the R14-08 remedy—both sidecars required and independently pinned—was only partly implemented.
A copied cache, cleanup, or later deletion can remove the legal attribution while every readiness
surface stays green.

### Required remedy

Make upstream `LICENSE` a pinned required artifact with independent expected path, digest, and
length. `modelStatus()` must name it when missing, and the test must restate both required sidecars
independently rather than seeding its expectation from `requiredFiles()`.

---

## Red ledger — the checks written first

All disposable assertions were added before any product change; no product fix was made. Each
failed on the frozen base for the named reason.

| First-red assertion/probe | Observed red |
|---|---|
| cancel reaches engine frame loop | no `AbortSignal` reached `PocketTts.synthesize` |
| hard signal between swap renames | live known-good directory absent after child `SIGKILL` |
| two Labs, one cache | both endpoint responses were 200, not one 409 |
| Pocket request never reaches OS | OS fake recorded `voice: "pocket:eve"` |
| boundary-free long sentence | one 260-token chunk against cap 50 |
| wrong two-word-deletion transcript | WER 0.222, accepted by 0.25 gate |
| plain-Node engine import | `ERR_MODULE_NOT_FOUND` for `sentencepiece.js` |
| rate changes output | 0.7 and 1.4 produced identical bytes |
| complete download capability | 165,232,420 reported; 173,764,082 required |
| upstream license is required | missing `LICENSE` still returned `ready` |

The mutation probes were restored after each run. Only a disposable worktree was dirtied with the
added red assertions themselves.

## Controls and negative results

- Clean targeted control at `3b61429`, load averages **3.83 / 5.16 / 5.59**
  `[measured-here]`: **4 files passed, 101 tests passed, 7 engine-tier tests skipped with the named
  no-model reason**.
- Real-model engine control at the same SHA, load averages **3.71 / 5.09 / 5.56**
  `[measured-here]`: **14/14 passed**.
- `pnpm typecheck` passed at the frozen base.
- Clean `pocket-e2e --bundle --prove`, load averages **6.43 / 5.99 / 5.56**
  `[measured-here]`: silence `""`; reference WER 3.78; clean WER 0.00; zero-fill mutant WER 0.67.
- The oracle **did** reject two additional gross mutants: swapping flow states 0/3 (WER 1.00) and
  disabling EOS detection (WER 0.33, duplicated “the lazy dog”). Those negative results constrain
  R15-05: the oracle is not useless; it is too permissive and too narrow for the claim made about it.
- The exception-path swap tests are genuine: throws after backup and after swap restore the previous
  model. R15-02 is specifically the process-death, recovery, real-activation, and inter-process gap.
- The R14-04 tokenizer disagreement remained a known open item at the frozen base and is not counted
  again. The known R14-07 independent-manifest-oracle gap is likewise not inflated into this round.
- No test or probe opened an audio device. ONNX synthesis and STT used files only.

## Scope correction under R038

The brief described its commit list as “everything landed since round 14”. At freeze time, `6f4545b`
and `3b61429` were also landed, so the literal claim was stale; both were included in the review
base. Other commits and peer edits appeared after the base was frozen. Mixing them into individual
runs would violate P40/P41's same-tree rule, so this document does not claim to review them and does
not use their presence to erase a defect demonstrated at `3b61429`.

ROUND 15: 9 findings, 9 confirmed
