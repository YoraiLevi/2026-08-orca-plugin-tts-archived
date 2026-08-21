# Gate M11, measured — change a control, hear the difference, in under two seconds

**Written:** 2026-08-21. **Author:** the C3 measurement pass for `.meta/goal/voice-lab-m11/contract.md`.
**Reproduce:** `node scripts/bench-lab-gate.mjs` (add `--json` for the raw arrays).
**Silent by default and there is no audible mode.** See "Silence, verified by effect".

**Machine.** Apple M5, 10 cores, macOS 26.5, Node v26.7.0, HeadlessChrome/151, repo at `510ce30`,
working tree clean at the start of the run (P31's tooling half). One full run, 2026-08-21, on an
otherwise idle machine. `voice-lab/index.html` and `scripts/voice-lab.mjs` unmodified.

**Label vocabulary** (constitution R006): `[measured-here]` — a probe in `bench-lab-gate.mjs` run on
this machine, with a run count. `[derived]` — arithmetic over `[measured-here]` values, stated as
arithmetic. `[claimed]` — nobody has run it.

---

## 0. The verdict, first

**FR-020**: t₀ = the `timeStamp` of the DOM keyboard event that requested audio; t₁ = the instant
the first `AudioBufferSourceNode` for the affected audio starts, on t₀'s clock; **≤ 2,000 ms at p95
over 20 consecutive trials**, first audio, never complete audio.

| Case | n | min | p50 | **p95** | max | Gate |
|---|---|---|---|---|---|---|
| **Cache miss** — `short.md` body, 2 chunks, the shortest fixture there is | 20 | 3,306 | 3,364 | **3,401 ms** | 3,422 | **FAIL** |
| **Cache miss** — `paths.md` body, 13 chunks | 5 | 22,588 | 22,648 | **22,755 ms** | 22,755 | **FAIL** |
| **Cache hit** — replay of already-decoded audio | 20 | 36.5 | 38 | **41 ms** | 41 | **PASS** |
| Control change with speak-on-change on (t₀ = the `→`) | 20 | 1,334 | 1,403 | **1,510 ms** | 1,553 | PASS |

All four `[measured-here]`.

**The gate is UNMET on the cache-miss path.** p95 **3,401 ms** against 2,000 ms, on the most
favourable fixture in the repository — 1.7× the budget, and 11× on a normal-length one.

**The named cause is not synthesis speed.** It is that **`POST /speak` synthesizes every chunk
before it answers**. `scripts/voice-lab.mjs` builds `out` in a loop over all chunks and returns
`chunks: out` in one envelope. FR-024 requires the opposite — chunk 1 delivered to the page while
chunk 2 is still synthesizing — and states that a whole-envelope response "MUST NOT be the path the
gate is measured on". There is no other path. So FR-026's negative control cannot be run as a
*negative* control: **the shipped path is already the disabled-streaming path.**

The arithmetic, all of it `[measured-here]` on this run:

| Leg | `short.md` (2 chunks) | `paths.md` (13 chunks) |
|---|---|---|
| server `timings.synthMs`, one sentence, n=20 | p50 **1,138 ms** | — |
| total server synthesis for the whole fixture | ~2×1,138 = ~2,276 ms `[derived]` | ~13×1,138 = ~14,800 ms `[derived]` |
| measured t₁ − t₀ | p50 **3,364 ms** | p50 **22,648 ms** |

Serialized synthesis is essentially the entire reading. **One sentence alone (1,138 ms) is 57 % of
the gate**, so even a perfectly streaming first chunk leaves ~860 ms of headroom for normalize,
chunk, transport, decode and scheduling — reachable, but only just, and only on the `say` fallback
that M9 exists to replace.

**And the gate's headline flow does not run at all on a committed fixture.** See finding G-1: all
six fixtures answer `503`.

---

## 1. The route taken, and what it costs

t₁ is defined on an `AudioContext`. That is a browser object; the harness is Node. Three routes:

| Route | Fidelity | Verdict |
|---|---|---|
| **(a)** Instrument `voice-lab/index.html` so the page records its own t₀/t₁ | highest | **Not taken.** This job may not edit `voice-lab/`, and a permanent gate hook is a design decision belonging to that file's owner. Recorded as finding **G-5**, with the exact hook it would need. |
| **(b)** Drive a real browser headlessly, injecting the instrument from outside | very high | **Taken.** |
| **(c)** Measure server-side and decode-side separately and compose | low; the composition is `[derived]` | **Not taken.** It would omit exactly the legs nobody has measured — event dispatch, `decodeAudioData`, the `AudioContext` construction on the first press — and would report a number no one had watched. |

**Route (b) as built.** Chrome is driven over the DevTools Protocol using Node's built-in
`WebSocket` (Node ≥ 22) — **no new dependency, no browser download**. The page on disk is never
touched: `Page.addScriptToEvaluateOnNewDocument` installs the probe into the page's own world
*before* its module runs, so what is measured is `voice-lab/index.html` exactly as it ships.

- **t₀** is the `timeStamp` of a real `KeyboardEvent` produced by `Input.dispatchKeyEvent`. The
  probe records `isTrusted`, and every trial in this run reported `true` — a synthetic
  `dispatchEvent` would have reported `false` and the reading would have been of our own harness.
- **t₁** is taken inside a wrapper on `AudioBufferSourceNode.prototype.start`, converting the
  `when` argument from the context clock to the performance clock through
  `AudioContext.getOutputTimestamp()` — the spec's own correspondence between the two. t₀ and t₁
  therefore come off **one clock**, with no arithmetic of ours in between.
- The 20 ms scheduling lead (`scheduleBuffers` starts at `currentTime + 0.02`) **is included**,
  because FR-020 asks when the source starts and that is when it starts.

**What the route costs, stated rather than glossed:**

1. **No real audio device, so `outputLatency` is the fake output's figure.** Measured, not assumed:
   the same page and the same probe with `--disable-audio-output` removed report `outputLatency`
   **24.0 ms** against **16.0 ms** with it `[measured-here]`. **The route understates the true
   first-sample instant by about 8 ms** against a 2,000 ms gate — 0.4 %, and it does not move any
   verdict in section 0. It also proves the indicator is one that *can* move.
2. **Headless Chrome is not the author's browser.** Blink's decode and Web Audio scheduling are the
   same code; window compositing and background-tab throttling are not exercised.
3. **The instant a sample leaves the DAC is still not observable** from userland without a loopback
   capture device — the same limit `bench-latency.mjs` records on the Node side. t₁ is where the
   source *starts*, which is what FR-020 asks for, plus a device latency of tens of milliseconds.

## 2. Silence, verified by effect

P31 is a hard constraint: the author is at this machine and was interrupted today by a benchmark
that played tones. **`bench-lab-gate.mjs` has no `--audible` mode and must never grow one.** Four
independent mechanisms, any one sufficient:

1. `--headless=new`
2. `--mute-audio`
3. `--disable-audio-output` — Chromium's `switches::kDisableAudioOutput`, which selects a fake audio
   manager, so CoreAudio is never reached.
4. the injected probe rewires **every** `connect(ctx.destination)` through a `GainNode` pinned at
   gain 0. The page's earcons go through this too — they are `OscillatorNode`s, and they are the
   tones P31 names. A gain node does not delay scheduling, so it changes no measurement.

**Verified by effect, with the control case:** the two-arm probe in section 1 (`outputLatency` 16 ms
with the flag, 24 ms without) is a *named value that moves*. A silence claim resting on flags alone
would have been presence, not effect.

Also structurally silent: the server side runs `say -o <file>`, which never opens the audio device,
and it is the shipped `createLabServer` — the same code `pnpm voice-lab` runs.

**Nothing of the author's was written.** The probe starts the lab server in-process with a **temp
settings path** and a **temp fixture directory**, so the real inbox
(`~/Library/Application Support/orca-tts/settings.jsonc`) and the committed `fixtures/` are never
opened for writing. The browser profile is a `mkdtemp` directory, removed afterwards.

---

## 3. Findings

### G-1 — Every committed fixture answers 503. The gate's own headline flow cannot be run.

`[measured-here]`, n=6, **6 of 6 fail**: `architecture.md`, `code-heavy.md`, `hostile.md`,
`paths.md`, `short.md`, `tables.md` all return `503 OsSynthEmptyOutputError: say exited successfully
but its audio file could not be read`.

Every fixture opens with an HTML comment. The normalizer does not strip HTML comments and no control
does either, so the comment reaches the chunker, and one chunk begins with the comment's own `-->`.
On macOS `OsSynthProvider.#command` builds `args.push(text)` **with no `--` end-of-options
separator** (`packages/providers/src/os-synth/index.ts:434-441`), so `say` parses the chunk as an
option:

```
$ say -o z.wav --data-format=LEI16@22050 "--> Yes"
say: unrecognized option `--> Yes'
```

The Linux builder in the same file does it correctly — `args.push('--', text)` at `:207` and `:213`.
**This is an R1 cross-platform parity gap and it is the exact shape of P26**: the field exists, the
tests pass, and the path a real caller takes is broken. It is also FR-036's neighbour: user text
reaching the synthesizer, unescaped, on one platform only.

*Consequence for M11:* US-1 step 1 — "the listener presses `Space` and the fixture is spoken" —
fails on every committed fixture today. That is a bigger problem than the gate number.

*Not fixed here:* `packages/` is outside this job's ownership.

*Verify by effect:* `POST /speak` with `fixtures/short.md` verbatim → 503; with the same file's body
minus the HTML comment → 200, 2 chunks. Both halves are in `fixture.as-committed`.

### G-2 — Changing a wired synthesize control serves audio synthesized at the OLD value

`[measured-here]`. `POST /speak` requests for `[prime, after changing voice.rate, after reloading the
fixture]` = `[1, 0, 1]`. The middle press returned in **41.6 ms** — a cache hit — after the listener
had just changed the speaking rate.

`voice-lab/lib/cache-key.mjs` is correct: `keyFor(chunkText, synth)` includes every `KEYED_FIELDS`
value, and `voice.rate` moves the key. The defect is one level up, in `index.html`'s `speak()`:

```js
const cachedKeys = state.chunkKeysFor?.get(text)
if (cachedKeys && cachedKeys.every((k) => buffers.has(k))) { …replay… }
```

`state.chunkKeysFor` is keyed by **text only**. After any play it holds the keys computed under the
*then-current* synthesize options. Change the rate and press play: the old keys are found, their
buffers are present, and the page replays the old audio. The correct key is never consulted.

This is precisely what FR-023 exists to forbid — *"a stale hit presenting as 'that control did
nothing', which the listener would read as a taste result"*. On a lab whose entire purpose is
settling taste by ear, a control that silently does nothing is the worst possible failure mode: the
listener concludes the *speech* is unchanged when only the *cache* is.

It also means the naive cold measurement is a fiction. In a first pass, 19 of 20 "cold" trials came
back at ~41 ms. The cold series in this document forces a genuine miss by reloading the fixture
between trials, and says so.

*Not fixed here:* `voice-lab/` is outside this job's ownership.

*Verify by effect:* `cachekey.stale-hit` — three presses, with the reload as the control case, so it
can fail for the right reason. FR-023's own stronger probe (compare the decoded buffers, not the
request count) is still unwritten.

### G-3 — The number the status bar shows is not the number FR-020 defines

`voice-lab/index.html` `setTiming()` measures `performance.now()` taken at the **top of `speak()`**
to the moment **`scheduleBuffers()` returns**. FR-020's interval starts at the **key event** and ends
when the **source starts**. The displayed value omits the dispatch-to-`speak()` leg at one end and
the 20 ms scheduling lead plus device latency at the other. It is a useful indicator and it is not
the gate; FR-027 requires that the displayed number be the recorded one, and there is no recorded
one — FR-025's per-trial machine-readable record does not exist in the page.

### G-4 — FR-026's negative control is unrunnable, because the shipped path is the disabled path

FR-026 asks for a run with first-chunk streaming *disabled* that exceeds 2,000 ms, as proof the
harness measures what FR-020 claims. Streaming has never been enabled: `scripts/voice-lab.mjs`
returns `chunks: out` after the full loop. The 22,755 ms `paths.md` reading is therefore the
negative control and the shipped behaviour at the same time, which means **that half of FR-026
currently proves nothing about the harness.** What does discharge it here is the *positive* control:
the same harness on the same page reports 38 ms warm and 3,364 ms cold for the same text, a
88× separation, so it is demonstrably distinguishing the two paths (FR-021's own requirement).

### G-5 — What the page would need to be measurable from inside (route (a))

Recorded rather than built, since `voice-lab/` is not this job's to edit. The minimum hook:

- In the document keydown handler, capture `e.timeStamp` for the press that requests audio and thread
  it into `speak()` / `replay()` as `t0`.
- In `scheduleBuffers`, after `src.start(t)` on the **first** source, compute
  `const ot = a.getOutputTimestamp(); const t1 = ot.performanceTime + (t - ot.contextTime) * 1000`.
- Push `{ t0, t1, path, fixture, controlChanged, chunkCount, provider, platform }` onto a bounded
  array and expose it — that array is FR-025's machine-readable record, and FR-027's displayed value
  should be read back out of it rather than computed separately.

With that in place this script shrinks to "drive the page and read the array", and the gate becomes
assertable in a test rather than only in a benchmark.

### G-6 — There is no free-text input on the page

C2 and design 004 call for "fixture picker, **free text**". `voice-lab/index.html` contains exactly
one form control, `<select id="fixture">`. Combined with G-1 this means **there is currently no way
to get any text at all through the page to the synthesizer**. Noted, not fixed.

---

## 4. Did the cache-hit claim hold up?

**Design 004's "replay is `start()` on a cached buffer — no re-synthesis, no round trip" holds, and
is now measured for the first time.**

- **p50 38 ms, p95 41 ms, max 41 ms, n=20** `[measured-here]` — key event to first sample.
- **Zero `POST /speak` requests across all 20 warm trials** `[measured-here]`, with the cold series
  in the same run as the control case that issues one every time. That discharges FR-022.
- The claim of *"~0 ms"* is optimistic by about 38 ms, and the composition is unsurprising: ~20 ms is
  `scheduleBuffers`' own `currentTime + 0.02` lead, and the rest is event dispatch plus the cache
  lookup. **It is 2 % of the gate.** The load-bearing architectural claim — that browser playback
  makes replay free — survives.

**What this does *not* establish**, and it matters: the cache hit is fast *and* (finding G-2) it is
returned for inputs that should have missed. A cache that is quick and sometimes wrong is worse for
this lab than one that is slow and always right, because the listener cannot see it happen.

---

## 5. What this measurement cannot cover

- **The instant a sample leaves the DAC.** No loopback device; t₁ is when the source starts, plus a
  device latency of tens of milliseconds, of which this route captures 16 ms of the real 24 ms.
- **The other 36 controls.** FR-016 scopes the gate to `wired` controls; `voice.rate` was chosen
  because it is `wired`, participates in the cache key, and has 31 steps. The gate says nothing
  about controls no consumer reads.
- **Any platform but macOS.** The whole cold reading is dominated by `say`, and P28/P16 say the other
  two platforms are different products. Windows and Linux are unmeasured.
- **The `spoke-elsewhere` rung.** FR-028 declares the gate not-applicable there; this run was on a
  byte-yielding backend and does not probe that rung.
- **The author's browser.** Headless Chrome only.
- **Anything about how it *sounds*.** This is a stopwatch. C7 is the author's, and remains his.
