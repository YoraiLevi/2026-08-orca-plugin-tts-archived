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

---

## 3. What this round closed

### 3.1 Section 19 rank 3 — *whose words are being spoken* (cascade C1)

**What was wrong.** The queue entry was `{ text, label }` — a display string formatted at enqueue
time, with nothing left to re-verify against. A session that ends while its reply is queued has its
words spoken under a label that by then belongs to a different, still-live agent; once M15 makes
voice carry identity, in that agent's **voice**, arriving immediately after *"voices were
reassigned after a system change."* The misattribution arrives wearing an explanation.

**What changed.** Entries carry `sessionId` — the transcript path, a stable identity, not a
formatted string. `SpeechServiceDeps.resolveLabel(sessionId)` re-resolves provenance at the instant
of speaking, and the host answers it by asking the **filesystem** whether the transcript still
exists. An effect check by construction: it cannot pass by consulting the string it built earlier.

**The judgement, stated, because it departs from the FMA's own prescription.** C1 says *"refuse to
speak an entry whose identity generation is stale."* Refusing deletes an agent reply the listener
was waiting for, in order to prevent a **label** being wrong — which today, with one voice for
every session, is the smaller of the two harms by a wide margin. So the attribution is **corrected
aloud** instead: the reply is spoken, preceded by the session it really came from. The refusal
becomes the right answer the moment M15 makes voice carry identity, and at that point it is one
conditional on this same, now-existing field. **The instrument was what was missing; the policy is
cheap once the instrument exists.**

**Interrupt policy:** spoken once per session per change, never once per reply. Four queued replies
from a session that has ended get one provenance sentence. Cleared by `stop()`, and cleared the
moment provenance resolves to the label it was queued under, so a session that comes back speaks
again.

**Verified by effect, by mutation.** With `#reattribute` stubbed to `return null`, all three
assertions go red — *"expected [] to have a length of 1 but got +0"* is the once-per-session claim
failing for the right reason.

### 3.2 Site 37 — each clipboard helper keeps its own reason

Timeout, not-installed and non-zero-exit arrived at one bare `continue`, and `capture` rejected
with `new Error(cmd)` for all three, so the only thing that reached the listener was the list of
**names** tried. *"Tried: wl-paste, xclip, xsel"* is not something anyone can act on; *"xclip is
not installed"* is the same information, kept. **Outcome: distinguishable, not louder** — the
sentence was already being spoken; this only decides whether it is worth hearing.

A test seam for the helper ladder was added, with its reason written down: `xclip` is present on
some CI images and absent on others, so a test built on the real ladder asserts a different thing
per runner, which is not a test.

### 3.3 Section 19 rank 4 — a pressed control always answers in the audio stream

A keybinding is inert in terminal focus and a plugin cannot query host keybindings (P19), so **a
dead chord and a working chord are the same absence of sound**. Three *"nothing happened"* answers
still terminated in `notifications.show`: an empty clipboard, a clipboard that could not be read,
and *"no agent reply yet"*. All three now speak, urgency `'now'` — the listener is holding a key
and waiting to find out whether anything happened.

The clipboard truncation notice is the one that goes `'next'`, and is queued **behind** the
clipboard content: said first it delays the thing they asked for, said as an interruption it cuts
into it, said afterwards it costs nothing and still answers *"was that all of it?"*.

### 3.4 Site 24's residue — the buffer of things that could not be said

`deferredAnnouncements` holds every announcement made before the engine resolves. If the engine
**never** resolves it grows for the life of the process. Bounded at 20, and the drop is itself
reported once a voice exists — a silently truncated report of silences is this audit's own joke.

### 3.5 Cascade C6 — already closed, and re-verified rather than redone

`8bd984b` closed it before this session: `TtsProvider.cancel()` may return a promise,
`PlaybackQueue.bargeIn()` awaits it, and `#speakDirect` refuses to hand a new utterance to the
daemon while a cancel is in flight. **Re-verified by effect here rather than taken from the commit
message:** changing `await this.#deps.cancelSynthesis()` back to `void` in `queue/index.ts` turns
the guard red with *"the sink was stopped before the daemon was even told: expected
[ 'cancel.start', 'sink.stop' ] to deeply equal [ 'cancel.start' ]"*. The guard is load-bearing.

---

## 4. What was deliberately left, and why

A deliberate silence documented is fine; an accidental one is the defect. These are the deliberate
ones. **All six were re-read in current source, not assumed from the FMA's line numbers.**

| site | what it is | why it stays |
|---|---|---|
| **16** | `decodeGenericLine`'s own `catch { return null }` | It has a caller now (round 4 wired `decoderFor`), so this is no longer dead code — but the loss it hides is already covered from above. A mid-write final line is caught by the truncation detector, which is decoder-agnostic; a file of records none of which decode is caught by `detectTranscriptFormat` returning `'unknown'`, which speaks. What remains is a single corrupt line in the middle of an otherwise good transcript, and announcing that is narration about one line the agent may not even have written. |
| **34** | temp-dir cleanup swallowed | Cleanup failing costs the listener nothing and is not something they can act on. A plugin that reports its own housekeeping to a blind user is the harm on the other side of this audit. |
| **40** | `.catch(() => '')` on the Linux voice list | Closed in substance by `83f0a5d`: the empty list now falls through to `#resolveLinuxBackend()` and the reason is recorded in `unavailableReason`, which `main.ts` reads. `[]` is a survivable answer to *"which voices are there"*; it is not an answer to *"can this machine speak"*, and only the second question now defaults. |
| **47** | `normalize()` returning `''` for a whole reply | The distinction the FMA asks for is made **downstream**, which is the right layer: `cdb72bf` made site 31 speak *"One reply had nothing in it that could be read aloud."* The normalizer is a pure function over text and should not be the thing that decides what to say about its own output. |
| **49** | an unclosed inline backtick | Re-read: `stripInlineCode` emits the remainder of the string as-is (`out += src.slice(i + 1); break`). **No content is lost** — only the backtick character. Unlike site 48's fence, there is nothing here to announce. The FMA row is a false positive and this is the record of checking it. |
| **52** | `if (text.length === 0) break` ends the drain | Re-read: unreachable. Every return path in `#findCut` yields an index `>= 1` (`lastSentence/lastClause/lastWord/lastFitting` are all guarded `> 0`, and the fallback is a literal `{ index: 1 }`). Even if it were reached it would lose nothing — the buffer is left intact and `finish()` still flushes it. Defensive code, correctly defensive. |

**Also left, and named as such:** total engine failure (`resolved === null`) still reaches only a
notification. There is no engine to speak the engine failure with. Round 4 recorded this exception;
it is unchanged, and closing it needs a second, independent sound path (an earcon from a bundled
asset), which is a design and not a line of code.

---

## 5. Section 19 — the blind spots that remain, ranked

Rank 1 (`7decced`), rank 2 (`ff7924b`), rank 3 (this round) and rank 6 (round 4) are closed.
What is left, ranked by cost to this listener — an honest list, not a failure.

| rank | blind spot | cost to close | why it was not closed here |
|---|---|---|---|
| **5** | **whether the words spoken are the words that were written** | large — a source→spoken offset map, plus a corpus test asserting every input token appears in the output *or* in an announcement | 003 section 8.4 scopes the offset map and calls it *"larger than the display work it enables"*. It is the only remaining S1-shaped blind spot: a normalizer defect that **changes meaning** rather than dropping content is invisible, and the listener is told something the agent did not say. **This is the one I would fix next**, and the cheap 60 % of it is the corpus test alone — every token of the six `fixtures/` files must appear in the spoken output or in an announcement — which needs no offset map and would have caught site 50's deleted check marks. |
| **8** | whether the settings in force are the settings chosen | medium — a runtime `effectiveSettings()` the status command speaks, plus per-field reachability tests | P26 is the recorded instance and its fix was one wire. Nothing structural prevents the next one. Blocked on M12 freezing the field set; the reachability tests should be written the same day it does. |
| **7** | whether a transcript is still being watched | small — a periodic `stat` compared to last-seen mtime | Half closed: `ee8c1cf` subscribed `fs.watch`'s error events (site 7), which was the crash and the commonest cause. The remaining half is a **liveness indicator that can move**, and the policy question — how quiet is too quiet before saying so — is a real one, because a false *"I have stopped hearing this session"* during a long agent think is worse than the failure it reports. |
| **9** | whether the voice being used is the voice asked for | small per platform — 005's checksum probe and the Windows read-back, **both specified, neither built** | Cosmetic today; becomes misattribution the moment M15 makes voice mean identity. It should land with M15, not before, so the probe is written against the identity rules it has to enforce. |
| **10** | whether the Linux floor is speaking | small — treat `spd-say --wait`'s exit as the playback signal and set a synthetic playing flag | The C6 half (skip producing two voices) is closed. What remains is `isSpeaking` reading false throughout on the `spd-say` rung, so every guard in `main.ts` sees an idle system. Needs a Linux runner to verify by effect, and verifying it on macOS would be exactly the "check that could not have failed" this audit was written about. |
| **11** | whether a Stop landed (design 003) | small — one worker-emitted earcon at the instant of barge-in | Blocked on the control TUI existing (design 003, C7). Four indicators in series and none an effect check; the fix is specified and has nowhere to live yet. |
| **12** | whether the Voice Lab and the plugin run the same code | already instrumented, not yet asserted in the plugin | `bb27b34` made the lab print its resolved module path against 7 probes. The plugin side has no equivalent, and `packages/*/dist/` is tracked and stale. |
| — | ~~the new one, found while closing rank 3~~ **CLOSED** | small | Nothing asserted that `resolveLabel` was *wired*: every provenance test injects its own, so the host could stop passing it and all of them would stay green while provenance silently stopped being checked — P26's shape on the wire this round just added. Closed by an end-to-end test through `activate()`: huddle follows a real transcript, four replies are queued behind a slow provider, the transcript is **deleted mid-drain**, and the assertion is that the still-queued reply is spoken *and* named. Verified by mutation on the wire itself. |

---

## 6. Counts

- Suite: **330 passing before, 337 passing after**, 18 files. No test plays audio or opens an audio
  device (P31): the providers under test are fakes that record strings, `sh -c 'exit N'`, or
  `process.execPath -e`.
- Section 16 sites closed across all rounds: **all 55 are now closed, downstream-covered, or
  deliberately left with a written reason** — 6 left, itemised in section 4 above, of which 2
  (49, 52) are false positives verified by re-reading the source.
- Cascades: C1 closed this round; C4, C5, C6, C9 closed earlier; C2, C3, C7, C8 untouched and
  belong to designs that are not built.
- New pitfall: **P34** — a concurrent agent's `git add -A` claims your uncommitted work, and
  `git checkout` as an undo then reverts your whole fix. `grep -c '^## P[0-9]' PITFALLS.md`:
  34 → 35.
