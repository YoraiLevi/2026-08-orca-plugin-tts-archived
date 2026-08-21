# Fix round 7 — the silent-failure audit, continued and reconstructed

**Status: living document.** Written BEFORE the code, and appended to as each site closes.
That ordering is the direct lesson of the two session-limit deaths recorded in
`.meta/goal/voice-lab-m11/ledger.md`: a job that writes its report last loses the map when it
dies. J03 died having landed **eight** commits and zero words about them.

Scope: `docs/design/006-fma.md` section 16 (55 silent-failure sites), section 15's cascades, and
section 19's ranked blind spots. Predecessors: `fix-round1-report.md`, `fix-round4-report.md`.

---

## 1. Forensics — what the dead J03 actually did

The ledger names four commits. It is wrong: **eight** commits belong to J03, interleaved in the
log with other agents' work. The four the ledger missed are the four that closed the FMA's own
"three to fix first". Reconstructed from `git show` alone, since no report survived.

| commit | subject | 006 sites closed |
|---|---|---|
| `83f0a5d` | a synthesizer that cannot run must not report itself warm | **41, 45, 46, 54**; FMA "fix first" 1 |
| `7decced` | a player that exits non-zero is not playback, and add a self-test | **35, 36**; section 19 **rank 1** |
| `cdb72bf` | a loss inside a reply is spoken, not logged | **31, 32, 33, 53** |
| `8bd984b` | four swallowed failures on the synth path, and C6's two voices | **39, 42, 43, 44**; **cascade C6** |
| `ee8c1cf` | silence always has a spoken reason; the reap keeps the session | **1–7, 13, 15, 25**; TT1, **cascade C4** |
| `ff7924b` | read the delivery receipt, and name the six collapsed causes | **17–23**; section 19 **rank 2** |
| `e80f0d3` | a check mark is a verdict; an unclosed fence eats the reply | **48, 50, 51** |
| `2772a01` | observe the four unwatched promises; re-read a half-written line | **9–12, 14, 29, 30, 38**; TT3 |

Round 4 (`fix-round4-report.md`) had already closed **8, 28, 55**, NM14, cascade **C5**, and C9's
high-water half.

**Therefore cascade C6 was already closed before this session began** (`8bd984b`): `cancel()` may
now return a promise, `PlaybackQueue.bargeIn()` awaits it, and `#speakDirect` refuses to hand a new
utterance to the daemon while a cancel is in flight. Task 3 of this job's brief is already done, and
the re-verification is recorded in section 4 below rather than redone as a fix.

**Interrupt policy the dead agent established, reconstructed from the commit messages, and adopted
unchanged here** — it is coherent and it is the right shape:

- `'now'` (interrupts the current utterance) only for **a control the listener just pressed**: a
  command handler that threw, a mode toggle, status, unfollow. The listener is holding a key down
  waiting to learn whether anything happened.
- `'next'` (waits for the end of the current utterance) for **everything that has already
  happened**: playback failure, synthesis dying mid-reply, an unspeakable reply, a mid-word cut.
  Interrupting the sentence the listener is following, in order to report a sentence they already
  lost, is a second loss (P30).
- **Coalesced on one window** (500 ms) for anything that can arrive in bursts, so a burst produces
  one sentence naming a total.
- **Latched once per reason, never once per event** — `agent.status.changed` fires constantly, and
  a tool that narrates its own polling is as unusable as one that says nothing. The latch clears
  when the condition clears, so a fixed-and-recurring fault can speak again.
- **An announcement never announces itself.** `#observe` is guarded against recursion; the audio
  stream is the only channel the listener has and it must not become an unbounded loop.

## 2. What is left open in section 16

After the twelve commits above, the open sites are: **16, 24 (residue), 34, 37, 40 (residue), 47
(downstream), 49, 52**. Nothing else in the 55 is still swallowing. The plan below closes what is
worth closing and states a reason for each one left.

