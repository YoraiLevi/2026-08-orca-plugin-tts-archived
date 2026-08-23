# The ear review — what to do, in order

**For:** the author, at his own machine. **Written:** 2026-08-23, at `ba9a40f`.
**Why this exists:** every remaining open item is a matter of taste or policy. None of them can be
settled by another review round, and four rounds of agents have now confirmed the machinery works.
The only instrument left is your ear.

**Time:** about 20 minutes for steps 1–4. Steps 5–6 are decisions you can take later.

---

## Before you start

**Sound will come out of your speakers in step 3 and after.** Nothing before that plays audio, and
nothing in the test suite ever does (P31 — `say -o <file>` writes a file and never opens the
device). The Voice Lab plays in the *browser*, not in the server process; the server says so on
startup.

Nothing below writes into `~/.buzz`. That directory belongs to buzz and the product now refuses to
write there by name.

---

## 1. Reuse the weights you already have (30 seconds)

You already downloaded Pocket TTS for buzz. Do not download 173.8 MB again.

```
node scripts/stage-pocket-model.mjs
```

This reads `~/.buzz/models/pocket-tts`, symlinks it into
`~/Library/Application Support/orca-tts/models/pocket-tts`, and writes our manifest marker *there*.
It prints an `export ORCA_TTS_MODEL_DIR=...` line and then tells you the export is **optional**,
because that destination is already the product default.

**Expected last lines:**

```
modelStatus: Pocket TTS is ready in /Users/<you>/Library/Application Support/orca-tts/models/pocket-tts
That export is optional here: this IS the product default, so
`pnpm voice-lab` and the plugin will find it without the env var.
```

If it says anything else, stop and paste it to me — that is a finding, not your problem to debug.

## 2. Open the Voice Lab

```
pnpm voice-lab
```

It prints a `http://127.0.0.1:<port>` URL. Open it. The startup block also tells you which
normalizer source it loaded and that the process itself makes no sound.

## 3. Confirm you are hearing the neural voice, not the system one

In the left sidebar, **Which voice** now lists two groups: your machine's voices, and
**Pocket TTS (neural)** with twelve names (Anna, Vera, Fantine, Charles, Paul, Eponine, Azelma,
George, Mary, Jane, Michael, Eve).

- Pick a system voice. Press **Play**. Note how it sounds.
- Pick **Anna**. Press **Play**.

The footer names what actually spoke. If it says *"Played by this machine's system voice"* while
Anna is selected, that is a defect and I want to know immediately — the whole R16/R17 series was
about exactly that lie.

## 4. THE ACTUAL JOB — the four taste decisions (C7)

This is the part only you can do. Everything in the sidebar is live; changing a control changes what
is spoken. Use your own text in the example box, especially paths and code.

**4a. Identifiers.** How should `getUserById` be said? Split into words, spelled, or read raw?
Does the answer change for `XMLHttpRequest`, `snake_case_name`, `kIsEnabled`?

**4b. Path depth.** `packages/core/src/normalizer/index.ts` — you said before that paths "made no
sense whatsoever", and the current fix announces the name first, the kind last, and names the
folder. Is that right? How many folder levels before it becomes noise — all of them, the last one,
none?

**4c. Announcement wording.** The sentences the plugin says on its own behalf: engine ready, a
degraded fallback, a download starting. Are they too chatty, too terse, or wrong in tone?

**4d. Overhead budget.** How much *non-content* speech per reply is acceptable before it is
irritating? This one is a number and I have no way to guess it.

For each: tell me the setting and the value. "Identifiers: split into words, but never spell."
That is enough — I will wire the defaults and the schema.

## 5. Two policy calls I deliberately did not make for you

**D004 — Intel Macs get no neural voices.** Microsoft publishes no `darwin/x64` ONNX Runtime
binary, so on an Intel Mac the neural backend cannot run at all. The system voices are unaffected.
Constitutionally this is principle III (cross-platform parity, NON-NEGOTIABLE) and the call is
yours: **say it out loud** on those machines ("the neural voices need a runtime Microsoft does not
publish for Intel Macs; your system voices are unaffected"), or **hide the feature there** so it is
never offered. I recommend saying it. Full evidence: `docs/.discussion/004-onnx-runtime-delivery.md`.

**D005 Question C — should `dist/` stay committed.** A worker gathered the evidence and asked me;
its terminal closed before I answered, and I owe you that honestly. Facts: ORCA never builds at
install, so the built files must exist on disk; the committed copy is currently byte-identical to a
fresh build; but CI never runs `git diff --exit-code dist/`, so a future stale artifact would stay
green — which is how `pnpm build` was red for an unknown number of commits without anyone noticing.
Full evidence: `docs/.discussion/005-artifact-vs-source.md`.

## 6. Optional — hear it inside ORCA rather than the Lab

The plugin now has a `synthesize.engine` setting: `auto` (default), `os`, `pocket`. On `auto` it
uses Pocket when the model is installed and the system voice otherwise, and when it cannot use
Pocket it **names the substitution** rather than quietly switching.

This path is verified on the built artifact (24000 Hz, `rung=preferred`) but has **never run inside
a live ORCA**. If you load the plugin and it misbehaves, that is expected territory, not a
surprise — it is the one honest gap left.

---

## What I do not need from you

Round 18 is already running and does not need you. Any defect it finds is mine to fix. The
remaining review cadence, the build gates and the artifact probe are all mine. If you want the
rounds to stop, say so — they are unbounded and each one has cost real tokens and found real bugs.
