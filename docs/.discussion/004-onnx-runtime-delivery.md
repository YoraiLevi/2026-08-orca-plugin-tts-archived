# D004 — How the ONNX Runtime reaches a third party's machine

**Opened** 2026-08-23, forced by round-14 finding **R14-01** (CONFIRMED, critical).
**Touches** principles **II** (zero-setup), **III** (cross-platform parity, NON-NEGOTIABLE) and
rules **R022**, **R072**.

---

## The measurements, first

Everything below is `[measured-here]` on 2026-08-23 against `onnxruntime-node@1.27.0`, re-run
independently of the review that reported it (R038).

| | |
|---|---|
| npm tarball, compressed | **100,893,124 bytes** |
| unpacked | **270,827,297 bytes** |
| plugin artifact today | 4 files, **0.18 MB** |
| `size-gate` cap | 2,000 files / **50 MB** (R023) |

Native binaries actually present in the package:

```
darwin/arm64      linux/arm64   linux/x64   win32/arm64   win32/x64
```

**`darwin/x64` is absent.** Five of six platform+arch targets, not six.

Two independent facts follow, and they are different problems:

1. **270 MB cannot enter a 50 MB artifact.** ORT can never be bundled, on any platform.
2. **Intel Macs have no binary at all.** Even with a perfect delivery path, `darwin/x64` cannot run
   this backend.

And a third, which is the one that makes it critical rather than annoying: **the repository has no
path that fetches ORT into a cache.** So a third-party ORCA install today receives no ORT, the
optional-dependency rule makes the Pocket backend report itself unavailable forever, and the
feature is decorative for everyone who is not us. `pnpm add onnxruntime-node` works on a developer's
machine and is not a distribution story — ORCA never runs `npm install` for a plugin.

---

## Question

**How does the native ONNX Runtime reach the machine of somebody who installed this plugin from
ORCA's registry, and what do we do about `darwin/x64`?**

---

## Options

### A — Bundle it

Rejected on arithmetic. 270 MB against a 50 MB cap, and R022 forbids shipping weights in the
immutable install tree for the same reason. Recorded so nobody re-proposes it.

### B — Fetch the runtime into the model cache, exactly as we fetch the weights

The pattern already exists in this repository and is now well tested: pinned revision, per-file
SHA-256 and length, staged download, atomic swap, licence beside the bytes, `absent`/`stale`/`ready`
status naming what is missing. ORT becomes one more artifact set in the same cache, selected by
`process.platform` + `process.arch`.

- **For:** one mechanism for both, one cache to clear, one progress surface, one refusal path. The
  listener presses one button and gets a working backend. R022's own words — *"download at runtime
  into a cache outside the immutable install tree"* — describe this exactly; it was written about
  weights and the reasoning is identical for a runtime.
- **Against:** we would be fetching an executable, not data. That is a materially higher bar: a
  compromised or substituted binary runs as the user. The digest pin is what carries that weight,
  and it must be a hard failure, never best-effort.
- **Against:** ~100 MB more download on top of 173.8 MB of model and voices. The honest total to
  advertise becomes **~275 MB**.
- **Against:** `require()` of a native module from a cache directory needs the loader to look
  there. Solvable, and it needs a real check rather than an assumption.

### C — Declare Pocket a developer-only backend

Ship the code, document `pnpm add onnxruntime-node`, and let third parties have the OS voices only.

- **For:** zero delivery work, zero new attack surface, no 275 MB download.
- **Against:** it makes the author's request unreachable for everyone but the author. He asked for
  buzz's system; buzz ships this to its users.

### D — Ship a sidecar binary of our own

Compile PocketTTS.cpp (MIT, single-file, has an HTTP server and a C FFI) per platform and fetch
that instead.

- **For:** smaller than ORT-plus-bindings, and it is a build we control.
- **Against:** we become a cross-compiler for six targets and own the security updates of an ONNX
  build. R027 — copy the algorithm, not the plumbing — and this is inheriting somebody's plumbing
  and then maintaining it.

---

## Recommendation

**B, with the `darwin/x64` gap named in the product rather than papered over.**

B is the only option that satisfies both the author's request and principle II, and it reuses a
mechanism this repository has already hardened. The security objection is real and is answered by
making the digest check a hard refusal — which `downloadModel` already does for weights, and which
R14-08 just tightened for the licence.

**On principle III.** Parity is NON-NEGOTIABLE and a strict reading says a feature absent on
`darwin/x64` is not done. Two things about that reading:

- The **baseline is unaffected**. Every platform keeps a working synthesizer; `darwin/x64` keeps
  `say`, which is what it has today. This is an addition on five targets, not a degradation on one.
- The gap is **upstream and not ours to close**. Microsoft does not publish a `darwin/x64` binary
  for this version. We can report it precisely — *"the neural voices need a runtime Microsoft does
  not publish for Intel Macs; your system voices are unaffected"* — which is R015's degrade-loudly,
  or we can pretend the feature does not exist there, which is worse.

That is a constitutional judgement and it is **the author's**, not mine. Recorded here rather than
decided quietly. Under R047 I proceed on B and record the assumption; a reversal costs the delivery
module and nothing else, because the backend seam is unaffected either way.

**Not doing D**, and not because it is a bad idea. It is the better engineering answer in a year
where somebody owns the build. Today it converts a download problem into a cross-compilation and
security-maintenance problem, and the project has one author.

---

## Engineer prompt

> Add `runtime.ts` beside `models.ts` in `packages/providers/src/pocket-synth/`. It should mirror
> the model manifest's shape exactly — a pinned version, a per-platform artifact list with SHA-256
> and byte length, `runtimeStatus()` returning `ready`/`absent`/`stale`/`unsupported`, and a
> download that stages and swaps atomically. `unsupported` is a first-class state, not an error:
> `darwin/x64` must return it with a sentence a person can act on, and the OS backend must keep
> working beside it.
>
> `loadOrt()` in `engine.ts` should try the cache before the bundled resolution, so a developer's
> `node_modules` copy still wins locally and a third party's cache copy works in production.
>
> The check that matters is not "the file downloaded". It is **an ORT loaded from the cache
> produces audio the STT transcribes correctly** — reuse `scripts/pocket-e2e.mjs`.

---

## What would reverse this

- Microsoft publishing `darwin/x64`, which removes the parity argument entirely.
- ORCA growing a native-dependency mechanism, which would make delivery the host's problem.
- A measured finding that loading a native module from a cache directory is unreliable on Windows,
  which would push toward D.
