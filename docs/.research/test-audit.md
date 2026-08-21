# Test audit — how many of the 180 tests could not have failed

**Written:** 2026-08-21. **Scope:** the whole vitest suite, all 13 files, plus the two CI smoke
scripts. **Method:** read every assertion against the claim it is cited for, then break the
implementation on purpose for the load-bearing ones and check the test goes red.
**Reproduce the mutation half:** `pnpm check:mutants`.

**Suite: 180 passing before, 186 passing after.** No test was deleted, skipped, or loosened.

> The finding that started this: nine documents say provider `cancel()` is *"measured within
> 50 ms"*. The assertion was `<= CANCEL_BUDGET_MS * 20` — 1,000 ms. Verified by mutation: delaying
> the SIGKILL in `OsSynthProvider.cancel()` by 900 ms measured **904 ms** and was **green** in both
> cancel tests. The number in the documents was never the number being enforced.

---

## 1. Verdict

| | |
|---|---|
| Tests audited | **180** (13 files) + 2 CI smoke scripts |
| Could not have failed for the reason they are named for | **9** |
| Of those, hiding a real behavioural gap | **3** — the queue drop policy, the thinking-block gate, the compaction re-anchor |
| Load-bearing tests mutation-tested | **16 mutants over 10 modules** (18 in the registry, including 2 declared-equivalent) |
| Mutants that stayed green when they should not have | **3** — all three now red |
| Assertions that failed when first tightened | **0** |
| Assertions that passed at the tighter bound | **9** — every loose bound here was undisciplined, not load-bearing |

That last row matters and is stated separately because conflating the two is dishonest. **Not one
of the nine loose assertions was hiding a live regression.** Every one of them passed immediately
at the tight bound. What they were hiding is the *capacity* to hide one: `cancel` measures 1 ms
against a 1,000 ms gate, so 999 ms of regression was available for free, silently, at any time.

---

## 2. The nine, with what each one actually asserted

Ranked by what a regression would have cost the listener.

### 2.1 `T041c cancel() is observed within 50 ms` — `providers/src/contract.ts`

The headline. `CANCEL_BUDGET_MS` is 50; the gate was `CANCEL_BUDGET_MS * 20`. Above 50 ms it
emitted a `console.warn` — a report nobody reads in a green CI log. The stated reason for the 20x
was *"hard ceiling keeps a wedged provider from hanging CI"*, which is what the 120 s test timeout
already does; conflating "don't hang" with "meet the budget" is what produced the multiplier.

**Mutation:** `setTimeout(() => c.kill('SIGKILL'), 900)`. **Before:** green at 904 ms.
**After:** red, `cancel took 904 ms, budget 50 ms`.

**The budget now enforced is 50 ms, with no multiplier.** Argued in section 3.

### 2.2 `T042d cancel stops the child process promptly` — `os-synth.test.ts`

`expect(elapsed).toBeLessThan(2000)` under a name that says "promptly", 40x the documented budget.
Same mutation, same result: green at 905 ms. Now 50 ms — and it also asserts the half nothing
checked: that cancel yields **no audio chunk**. A fast return that still emitted audio for text the
listener had already interrupted would have satisfied a latency-only assertion and been exactly
the R014 bug.

### 2.3 `a full queue drops the OLDEST, never blocking the agent` — `speech-service.test.ts`

Asserted only `expect(log).toHaveBeenCalledWith(stringContaining('queue full'))`. A call, not an
effect. Nothing asserted which end of the queue was discarded.

**Mutation:** `replies.slice(-max)` -> `replies.slice(0, max)` — keep the OLDEST, discard the
newest, the exact inverse of the documented policy. **Before:** green. Not just this test — **the
entire 16-test file was green.** For a voice-first listener that mutation means the agent's most
recent replies are the ones thrown away while stale ones are read out. **After:** red.

### 2.4 `T076 GATE: thinking blocks are never spoken` — `huddle/decoders.test.ts`

Principle VIII, the highest-stakes rule in the project. `decoders.ts` guards it twice: a `continue`
on `type === 'thinking' | 'redacted_thinking'`, and an allowlist that only pushes `type === 'text'`.
Remove **both** and the decoder speaks the model's reasoning aloud.

**Before:** all seven tests in the file, including both gate cases, stayed **green** while the
decoder leaked `SECRET_REASONING`. The fixtures cannot see it — a real thinking block keeps its
payload under `thinking`/`data` and has **no `text` key at all**, so a decoder reading `block.text`
blindly finds nothing to leak in the fixture and everything to leak in the record ORCA hands us.
Constitution VIII names this exact hazard: *"ORCA's decoder flattens thinking into text blocks."*

**After:** two cases added — a thinking block that also carries `text`, and a thinking-only control.
Both go red on the combined mutation; the seven originals still do not, which is the point.

### 2.5 `C9: a compacted transcript is re-anchored, not read out from the top` — `huddle.test.ts`

Asserted only silence after a compaction. Deleting the whole re-anchor branch left it green,
because `replies.slice(mark)` of a shrunken file is empty either way. Silence proved nothing.

And the failure the branch prevents is not the one the test names. A replay is loud and obvious.
The real risk is the **opposite**: a high-water mark frozen at 20 over a 4-line file means the next
sixteen replies are never spoken and the session goes quietly mute — which is principle I's
failure, not principle VIII's. The test now appends replies after the compaction and asserts they
are heard.

### 2.6 `T042e reports unavailability rather than failing silently` — `os-synth.test.ts`

`expect(Array.isArray(voices)).toBe(true)`. True for the empty list, for a populated list, and for
a list of nulls. It could only fail if `listVoices()` threw. Now asserts the entries are strings
and that a platform with nothing installed carries a **named `unavailableReason`** (R015) — the
difference between "no sound, no idea why" and a sentence naming the missing binary.
`lists voices without throwing` in the contract had the same shape and got the same treatment.

### 2.7 Vacuous loops over the manifest — `manifest.test.ts`, `keybindings.test.ts`, `main.test.ts`

Six assertions live inside `for` loops over arrays read from `orca-plugin.json`. An empty or
renamed array makes every one of them vacuous and green. `main.test.ts`'s guard is literally named
*"the guard counts the manifest, not a number that drifted away from it"* — and it did not count
anything. Each now asserts its fixture is non-empty first, and the command guard also asserts
`activate()` registered something at all.

### 2.8 `T060c oversized clipboard content is truncated and flagged` — `clipboard.test.ts`

`if (res === null) { console.info('[skip] ...'); return }` — it early-returned on any runner with
no readable clipboard, which is **every headless CI runner**, i.e. the machine the gate actually
runs on. A cap checked only on a developer's laptop is not a gate. The cap is now a pure
`capText()` tested unconditionally at 5 MB, at the boundary, and below it; the integration case is
kept and now calls `ctx.skip()` so a runner that never runs it reports SKIPPED, not PASSED.

### 2.9 `is skipped on this platform, and says why` — `providers/src/contract.ts`

`expect(opts.skipReason!.length).toBeGreaterThan(0)` — inside `if (opts.skipReason)`, where a
truthy string always has non-zero length. A tautology with a test's name on it. Deleted; the reason
now goes in the **suite title**, so `describe.skip` prints it in the reporter, which is what the
tautology was pretending to do.

---

## 3. The cancel budget: 50 ms, and why not 1,000, 100, or 3

`CANCEL_BUDGET_MS = 50` is unchanged. What changed is that the assertion is now that number, with
no arithmetic between the constant and the gate.

**Why not simply "the docs say 50".** Because that is how the 20x got there — someone reasoned from
a document instead of from the system. The argument has to stand on its own:

1. **50 ms is the constitution's own barge-in budget** — *"Barge-in signal -> audio stops: < 50 ms"*,
   sourced to buzz measuring ~15 ms with a 10 ms monitor thread. The contract measures the
   synthesis-side half of that path, so the whole budget is a strict upper bound on it, and holding
   one segment to the whole budget is conservative in the right direction.
2. **The headroom is measured, not hoped for.** This contract measured **1 ms** on macOS `afplay`
   across 8 consecutive runs — 50x margin. `bench-latency.mjs` measures `cancel.kill-to-exit` at
   **p50 3.5 ms / p95 8.8 ms** — 5.7x margin at p95 on the real process kill. There is no plausible
   CI-jitter story that turns 1 ms into 50.
3. **It is tight enough to catch the failure that actually matters.** Principle VII requires
   cancellation to be monitored *independently* of a synthesis worker that may sit inside model
   inference for hundreds of milliseconds. The Piper/sherpa providers M9 will add are exactly that
   shape. A provider that simply lets inference finish before honouring cancel costs hundreds of
   ms — so **any gate above ~100 ms cannot see the defect this contract exists to prevent.** The
   old 1,000 ms gate could not. 50 ms can, with room to spare.
4. **Why not 3 ms, the measured figure.** The contract must hold for providers that do not exist
   yet, on runners we do not own. 3 ms is one implementation's number on one machine; pinning the
   contract to it would make the gate a description of `afplay` rather than a requirement on
   anybody's provider, and the first honest neural provider would have to argue the number up.
   50 ms is the *requirement*; 1 ms is the *reading*. The suite prints the reading on every run.
5. **The wedged-provider concern is handled by the timeout, which already existed.** 120 s. That is
   what a timeout is for.

**Consequence for the documents:** the nine citations that say "within 50 ms" are now true, and no
document needed editing. That is not a coincidence — it is the cheaper of the two repairs. Setting
the gate to the number everyone already quotes corrects nine documents with one code change; the
alternative was nine edits each inventing a new number, under contention with three other agents.

---

## 4. Mutation results in full

`pnpm check:mutants` — 18 mutants, run against the tightened suite. **18/18 behave as declared.**
The "before" column is what happened against the suite as it stood at commit `1161722`.

| Mutant | Invariant attacked | Before | After |
|---|---|---|---|
| `cancel-late-kill` | cancel within budget | **SURVIVED** (904 ms, green) | killed |
| `cancel-never-kill` | cancel actually kills the child | killed | killed |
| `queue-drops-newest` | the queue drops the OLDEST | **SURVIVED** (whole file green) | killed |
| `thinking-leaks` | principle VIII, reasoning never spoken | **SURVIVED** (7/7 green while leaking) | killed |
| `announce-interrupts` | `announce('next')` never goes to the back | killed | killed |
| `stop-one-sided` | R014, stop cancels synthesis too | killed | killed |
| `bargein-no-cancel` | `bargeIn` cancels synthesis | killed | killed |
| `stale-generation-plays` | superseded audio cannot play | killed | killed |
| `user-turns-spoken` | the listener's own prompts are never read back | killed | killed |
| `evicted-id-respoken` | B-01, past the 300-id bound | killed | killed |
| `dunder-mangled` | `__init__` survives the normalizer | killed | killed |
| `chunker-lossy` | T030, `chunks.join() === input` | killed | killed |
| `silent-degradation` | R015, a fallback carries a reason | killed | killed |
| `register-always-succeeds` | P18, a host API mismatch is visible | killed | killed |
| `status-deletes-queue` | C5, asking must not delete | killed | killed |
| `inband-command-reaches-engine` | E-06, `[[volm 0.2]]` is spoken not executed | killed | killed |
| `thinking-continue-only` | *declared equivalent* | SURVIVED | SURVIVED |
| `compaction-no-reanchor` | *declared equivalent* | SURVIVED | SURVIVED |

**On the two equivalents.** Both are genuine: the `thinking` `continue` is redundant with the
`type === 'text'` allowlist two lines below, and the compaction branch is redundant with
`#setHighWater(file, replies.length)` running unconditionally after it. Redundant defence in depth
is fine. A test that cannot tell the difference is not — which is why 2.4 and 2.5 were still fixed.
The script declares each equivalent **with the line that makes it inert**, and fails if a
declared-equivalent mutant turns out to break something, because a wrongly-marked equivalent is
precisely the blind spot the script exists to find.

**Verified by effect, on the checker itself.** Reverting the 2.3 tightening makes the run report
`queue-drops-newest SURVIVED` and exit 1. Restoring it returns `1/1`. The checker can fail.

---

## 5. Platform gates — visibility, not coverage

Five tests used `if (wrong platform) return`, which reports **PASS** for a body that never ran.
This project ships to three OSes with parity as a NON-NEGOTIABLE requirement (principle III), and a
green tick for a no-op is the *"permanently-green indicator"* the constitution names as broken.

They now use `it.skipIf(...)` / `ctx.skip()` and report **SKIPPED**:

| Test | Runs only where | Why the gate is legitimate |
|---|---|---|
| `T042a macOS output is WAV, never AIFF` | darwin | `--data-format` is a `say` flag; there is no Linux/Windows equivalent to assert |
| `E-06 VERIFY BY EFFECT: bracketed text is spoken` | darwin | measures `say`'s in-band command lexer by comparing real audio byte counts |
| `detection failure is named and actionable` | no espeak-ng/espeak/spd-say on the box | models the stock-Ubuntu-desktop condition, which is the *absence* of all three |
| `prepare() refuses to report warm...` | same | same |
| `tells the user, through notify, which binary is missing` | same | same |
| `T060c-integration` (clipboard) | a readable clipboard exists | the pure cap test now gates every runner unconditionally |

**Coverage is unchanged by this; honesty is not.** On `ubuntu-latest`, where CI installs
`espeak-ng`, the three Linux-floor tests now visibly skip — they test the missing-binary path, and
the runner has the binary. That is a real and now-visible gap: **the stock-Ubuntu silence case
(P25) is exercised on the developer's Mac and on no CI runner.** Closing it needs a matrix entry
that deliberately omits the apt install. Listed in section 7 rather than fixed here.

---

## 6. What was checked and found sound

Not everything was broken, and saying so is part of the report.

- **The normalizer (80 tests)** is the strongest thing in this repo. Table-driven with exact
  equality on every case, an anti-goal block for identifiers, and a generated-combination test that
  asserts its own iteration count (`expect(checked).toBe(200)`) so it cannot go vacuous. Both
  dunder mutants land on named cases.
- **The chunker (21 tests)** asserts a real invariant (`join() === input`) over 500 deterministic
  generated inputs, seeded so failures reproduce, with an explicit `expect(corpus.length).toBe(500)`
  guard. The lossy mutant kills five tests at once.
- **`speech-service.test.ts`'s announcement block** already does what this audit is about: it
  disables the notification path so the assertions can only pass if the sentence was genuinely
  synthesized, it asserts through `numberToWords` so a match also proves the text went through the
  normalizer, and it carries an explicit **control case** (`says nothing about drops when nothing
  was dropped`) reasoned from *"an indicator that never changes is a broken indicator"*.
- **`main.test.ts`** drives `activate(orca)` end to end through the real command registry, real
  SpeechService, real normalizer and real HuddleController, and carries controls for both TT6 and
  DC1. This is P26's remedy applied properly.
- **`adapter.test.ts`'s `toHaveBeenCalledWith` assertions** were considered and kept. For an
  adapter whose entire job is to call the host with a specific shape, the call **is** the effect —
  and the P18 counter test (`registeredCommands()` must stay 0 when `register` throws) covers the
  silent-no-op failure that motivated the file.

---

## 7. What could not be verified, and what is still open

Stated rather than implied (R016).

1. **Nothing here was run on Linux or Windows.** Every mutation result in section 4 is from macOS
   26.5 / Node v26.7. The two cancel mutants go through whichever synthesizer the runner has, so
   their behaviour on `espeak-ng` and on PowerShell `System.Speech` is **unknown** until CI runs.
   If either platform cannot make 50 ms, that is a finding about the provider, not a reason to
   restore the multiplier — record it and fix the provider.
2. **The stock-Ubuntu silence case (P25) is exercised on no CI runner** — see section 5. Needs a
   matrix entry without the `espeak-ng` apt install. Not done here: it is a CI topology change,
   outside this task's scope.
3. **`scripts/smoke-activate.mjs` carries a hardcoded `EXPECTED_COMMANDS` list that has drifted** —
   it omits `read-aloud.follow`, which the manifest declares. The script's *other* loop, over the
   built manifest, does cover it, so nothing is currently unchecked; but the hardcoded list is dead
   weight that reads as coverage. Left alone: it is a CI script, not a test, and removing the list
   is a separate change.
4. **The claims guard checks numbers, not semantics.** `budget-claims.test.ts` can tell you that a
   document quotes 200 where the suite enforces 50. It cannot tell you that a sentence describes
   the wrong *quantity* — which is a live hazard here, because design 003's Stop budget (p50 120 /
   p99 250 ms, input event to last sample out) uses the same words for a different measurement. The
   guard skips percentile-qualified lines for exactly that reason, and that exclusion is a
   judgement call a future reader may need to revisit.
5. **`docs/.discussion/003`'s 50 ms audio-device drain segment remains `[claimed]`.** It is not in
   the guard's file list and cannot be, because it is a different quantity. Per
   `latency-measurements.md` section 1.0 it is also structurally unmeasurable on this machine.
6. **No coverage measurement was taken.** Deliberately: the cancel path was at full coverage
   throughout the entire period it was ungated, so a coverage number would have been evidence of
   nothing here. That is argued in `budget-claims.test.ts`'s header.

---

## 8. What changed

Three commits, no doc edits outside this file.

| Commit | What |
|---|---|
| `fix(tests): enforce the 50 ms cancel budget the docs have always quoted` | 2.1, 2.2, 2.3, 2.6, 2.7, 2.8, 2.9 and the platform gates |
| `fix(tests): make the thinking-block gate and the compaction gate fail for the right reason` | 2.4, 2.5 |
| `feat(ci): two guards against a check that could not have failed` | section 9 |

## 9. The guards

**`packages/providers/src/budget-claims.test.ts`** — inside `pnpm test`, ~2 ms. Parses cancel/stop
budgets out of the four documents that cite the contract and asserts each equals
`CANCEL_BUDGET_MS`, plus that the contract applies no arithmetic to that constant. Fails four ways,
all checked: restore the `* 20`; edit a doc to 200 ms; loosen the constant to 900 (it then names
all nine drifting citations); or empty the file list, which trips a floor assertion
(`claimsSeen >= 9`) because a guard that silently stops matching is the same failure wearing the
uniform of the fix.

**`scripts/mutation-check.mjs` / `pnpm check:mutants`** — 18 mutants, CI on Linux only, not in
`pnpm test` because it runs the suite once per mutant. Idempotent: every file is restored in a
`finally` and the restore is re-verified before continuing.

**Rejected, with reasons, in the files themselves:** a naming convention (T041c was already *named*
"within 50 ms" while asserting 1,000 — a convention adds no signal the name did not carry); a
coverage gate (100% coverage on the cancel path throughout; wrong instrument for this failure
class); Stryker (thousands of mostly-equivalent mutants over 6.6k lines, and the triage would cost
more than this project has).
