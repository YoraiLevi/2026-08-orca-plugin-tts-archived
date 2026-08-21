# 012 — Huddle presence: the followed set, liveness, and a room with seven agents in it

**Status:** design. **Written:** 2026-08-21. **Milestone:** M16 (`docs/TASKS.md` "Phase M16 — Huddle
presence", T160–T164).
**Author had no session context.** Every claim about our own code cites `path:line` verified at
`1161722`. Every number carries **[measured-here]**, **[documented]** or **[claimed]** (constitution
R006).

**What this document decides.**

1. **The lock becomes a followed *set*** — which is `docs/design/005-agent-identity.md` section 15.1's
   named precondition for gate M15, and the reason M15 is scheduled after M16.
2. **The roster is the session registry, not the transcript directory.** That single change is the
   structural fix for PITFALLS **P31**, and it was verified live, during the fan-out that produced
   P31's entry (section 3).
3. **Liveness is `kill(pid,0)` *and* `procStart`** — cross-review **B-02** — with a parsing rule
   nobody had, because the naive comparison is wrong on every entry (section 4, measured).
4. **Mute gains an inverse: solo**, because with seven sessions "mute this one" is six presses.
5. **What presence costs while idle** — cross-review **B-03** — measured rather than asserted.

**What this document does not do.** It does not restate `docs/.discussion/003-panel-and-control-channel.md`.
Sections 6 and 7 of that document already settled display identity, the presence predicates, mute
semantics and the replay-buffer rules; this document **extends** them and says so at each point. It
does not redefine the call-sign or the earcon (`005` sections 11.1, 11.2 own both). It does not mint
control earcons. It writes no implementation code.

---

## 1. What is already settled, and is therefore not re-argued here

| Fact | Owner | Used here for |
|---|---|---|
| *"In the huddle"* = `running` and not muted. *"The voice"* = `followed`. `spoke-recently` is decoration, never membership | `003` section 7, Q29 | section 2's membership model |
| A muted session's reply is **dropped from the speech queue, retained in the replay buffer, and the omission announced** | `003` section 7, Q30 | section 6 |
| Entering the replay buffer **marks a reply seen**; replaying does **not** rewind the high-water mark | `003` section 7.1 | section 2.4 |
| `~/.claude/sessions/<pid>.json` is a live-session registry carrying `sessionId`, `cwd`, `name`, `status`, `procStart`, `messagingSocketPath` | `docs/.research/q-round1-buzz-transcript.md` Q27 | sections 3, 4, 5 |
| Display identity is the long-form chain; the call-sign is `WORDS[fnv1a32(sessionId) mod 64]` | `003` section 6, `005` section 11.2 | the wireframe, section 7 |
| Every control is one envelope with `gen`, six named refusal codes, and every refusal audible | `003` section 3 | sections 2.3, 6 |
| The dashboard is the control-pane TUI; the plugin panel is write-capable and read-blind | `003` section 4 | section 7 |
| The interrupt control never moves | `003` section 9, `005` section 11.5 | section 7 |

Two facts from our own source, verified at `1161722`, are the starting position:

- **The lock is one nullable string.** `#locked: string | null` at
  `packages/plugin/src/huddle/index.ts:77`, set by `switchTo()` (`:165-170`), cleared by `unlock()`
  (`:189-192`), read by `#ensureWatching()` (`:199`). One watcher (`#watcher`, `:78`), one watched
  file (`#watching`, `:79`).
- **Everything P22 actually fixed is already per-file.** `#primed` is a `Set<string>` keyed by file
  (`:82`), `#highWater` a `Map<string, number>` keyed by file (`:97`), and every utterance is already
  labelled with its session at the point of speaking —
  `this.#deps.speech.speak(r.text, 'queue', sessionLabel(file))` (`:275`). **The P22 protections do
  not assume one session. The lock does.** That asymmetry is what makes section 2 cheap.

---

## 2. The followed set

### 2.1 The question M15 could not answer

`005` section 15.1 states the bind plainly: gate M15 is *"with two agents running, you can tell who is
speaking without being told"*, and huddle follows exactly one session, and that lock **is** the P22
fix. So M16 owns the question: **what replaces a single lock without reopening P22?**

The answer starts by naming what P22 was actually about. Re-read its three faults
(`PITFALLS.md` P31 quotes the symptom, P22 the cause): the audio **changed owner without saying so**;
the priming flag was **global instead of per file**; and overflow **dropped the oldest utterance
silently**. Not one of the three is "more than one session was followed". Two of the three are
already fixed per-file, in code, at `:82` and `:97`. The lock was the third fix's cheapest available
implementation — with one owner, ownership cannot change unannounced — and it is the only one of the
three that does not survive contact with a listener who runs several agents on purpose.

**So the invariant to preserve is not cardinality. It is attribution:** the listener always knows
whose words these are, and membership only ever changes because the listener changed it.

### 2.2 The model

```
PRESENT   = every live session in the registry              (section 4 decides "live")
FOLLOWED  = a listener-chosen subset of PRESENT             (F below)
MUTED     = a listener-chosen subset of FOLLOWED
SPEAKABLE = FOLLOWED \ MUTED
SPEAKING  = at most ONE member of SPEAKABLE, ever           (the audio device is serial)
```

Five rules define it, and each one is answerable to a specific failure:

**R1 — Membership is explicit. A new session joins nothing.** A session that appears in the registry
enters `PRESENT` and stops there. It is never auto-followed, never on the strength of being newest,
busiest, or in the current worktree. This retires `#newestTranscript()`'s mtime pick
(`packages/plugin/src/huddle/index.ts:311-345`) as an *automatic* selector; it survives only as the
implementation of the explicit `followNewest()` command (`:181-186`).

*Why:* automatic membership is the whole of P22 and the whole of P31. Both were the machine choosing.

**R2 — `F` is capped, and the cap is a spoken refusal, not a silent truncation.** `FOLLOW_MAX`,
default **3**. A fourth `follow` is refused with the named code `follow_capacity`
(`003` section 3 R5's discipline; the code is new, the mechanism is not) and one spoken sentence:
*"Already following three. Unfollow one first, or say follow all."* A **`follow all`** verb exists and
is capped by the same number: with seven present it refuses and **names the count**, rather than
enrolling seven.

*Why 3, and why it is taste-with-a-floor:* three is the largest number of concurrent speakers this
project has any evidence a listener can track — `005` section 14 works its identity example at three,
and the guaranteed-on-all-three voice count is **1** (P28), so at four the listener is separating
speakers by call-sign alone. The **number is the listener's** (P23): the option space is 1..7 plus
`all`, settled in Voice Lab against a recorded multi-session fixture, and `1` reproduces today's lock
exactly. What is **not** taste is that a "select all" enrolls without a cap — that is the foot-gun,
and R2 is the guard.

**R3 — Speech is serialized, and every change of speaker is announced.** The queue stays one queue.
Two followed sessions do not overlap; the second waits. Whenever the **speaker changes between
adjacent queue items**, identity is spoken — mandatory, not a setting. This is `005` section 13's
rule 2 (*"a switch is always audible in some form"*) applied to a set instead of a lock, and it is the
direct answer to P31's *"another agent seem to spoke while it was saying the test pass"*: with `|F| > 1`
the change-of-speaker announcement is the only thing standing between the listener and P22.

**R4 — Leaving is instant and never destructive.** `unfollow` removes a session from `F`. If it was
the speaker, the current utterance is **abandoned** (as `skip` does — generation bumped, queue kept:
`003` section 8.7's table) and its remaining queued items are dropped to the replay buffer with a
count announced, exactly as mute does. Unfollow is not stop: the other followed sessions keep talking.

**R5 — `F` is persisted by `sessionId`, and re-resolved on restore, never trusted.** ORCA reaps an
idle worker after five minutes (P20/P6), so `F` lives in plugin storage beside
`HUDDLE_HIGH_WATER_KEY` (`packages/plugin/src/huddle/index.ts:42`). On restore, every member is
re-checked against the live registry; a member that is gone is dropped **silently at restore** and
its absence reported only if the listener asks. (Announcing five departures at every worker re-fork is
the "announcement that interrupts is itself a harm" failure of P30.)

### 2.3 What happens to the P22 protections when `|F| > 1`

| P22 protection | Today | Under a followed set | Change needed |
|---|---|---|---|
| Per-file priming | `#primed: Set<string>` (`:82`), keyed by file | unchanged — one entry per followed file | **none** |
| High-water mark | one integer per file, `#highWater` (`:97`) | unchanged — `MAX_TRACKED_FILES = 50` (`:49`) already bounds it | **none** |
| Shrink re-anchor | `:257-264` | unchanged, per file | **none** |
| Utterance labelling | `speak(text,'queue',sessionLabel(file))` (`:275`) | now load-bearing rather than decorative | label must come from the identity chain (`003` section 6), not `sessionLabel()`'s hex slice (`:64-69`) |
| One watcher | `#watcher` / `#watching` singletons (`:78-79`, `:206-231`) | **must become a map keyed by file** | the one real structural change |
| One stop timer | `#stopTimer` (`:80`), `WATCH_WINDOW_MS` (`:51`) | per file — a done-edge in session A must not stop watching session B | per-file timer |
| One debounce | `#debounce` (`:81`) | per file — a shared 250 ms debounce coalesces two sessions' changes into one read of the wrong file | per-file debounce |
| Ambiguity warning | `#warnedAmbiguous` (`:76`), *"two agents are active… speaking the most recent"* (`:339-342`) | **retired.** It exists because the machine was guessing; under R1 it never guesses | delete, and delete its test |
| Queue overflow | `maxQueued`, drop oldest, announce (`speech-service.ts:155-185`) | **now the sharpest edge**: three followed fills a queue of 8 three times faster | section 3's per-session fairness rule |

**The one structural change is that four singletons become four per-file entries.** That is the whole
of T160's mechanism. Everything else P22 bought us is already keyed by file and was always ready for
this.

### 2.4 What a new session defaults to, stated as a table

| Situation | Default | Reason |
|---|---|---|
| Session appears in the registry | `PRESENT`, not followed | R1 |
| Session appears while `F` is empty and huddle is on | **still not followed** — huddle says nothing | the alternative is P22's auto-pick with a nicer name |
| Listener presses `f` on a present session | followed; primed per file so the backlog is **not** read (`:211-224`) | P22 fault 2 |
| Session is followed and has a persisted high-water mark from an earlier worker | resume at the mark (`:219-220`) | 006 TT10: the reply that arrived during the reap window used to vanish |
| Followed session dies | leaves `F` and `PRESENT`; announced once *when it was the speaker*, silently otherwise | section 4 |
| Followed session is muted, then unmuted | `003` section 7 Q30 rules 1–5 apply unchanged; the replay buffer already marked those replies seen (`003` section 7.1) | — |

---

## 3. P31's scale: seven transcripts in one directory

P31 is not a hypothetical, and it is not a *fan-out* problem either. **It is a roster problem**, and
the evidence is that the registry already distinguishes the two classes of writer.

### 3.1 The measurement, taken during the fan-out that this document was written in

**[measured-here]**, 2026-08-21, in `/Users/m5air/source/orca-plugin-tts`, while six sibling agents
were writing:

```
REGISTRY entries with cwd under orca-plugin-tts:  1
  pid 2052  orca-plugin-tts-13  111693de-38da-4de8-a288-506104eb7c9c  busy

TRANSCRIPTS modified in the last 10 minutes:      5
  111693de-…  212s ago   IN REGISTRY
  2ad2f15d-…   20s ago   NOT in registry
  569cbfc0-…  331s ago   NOT in registry
  8658881a-…    6s ago   NOT in registry
  a4146985-…   12s ago   NOT in registry
```

Four live transcripts, four agents genuinely producing assistant text, and **not one of them is a
registered session.** Total transcripts in this worktree's project directories: **31**.

Today's selector sorts *every* `.jsonl` in the directory by mtime and takes the newest
(`packages/plugin/src/huddle/index.ts:322-344`). In the snapshot above it would have picked
`8658881a` — a subagent — six seconds after that subagent wrote. **That is P31, reproduced as a
selection, from data on disk, without playing any audio.**

### 3.2 The rule that follows

**Presence enumerates the registry. It never enumerates transcripts.**

- The roster is `~/.claude/sessions/*.json`, filtered by section 4's liveness. Its size is bounded by
  *live processes*, not by history: **5 registry entries against 31 transcripts** in this worktree
  right now [measured-here].
- A transcript is only ever read because a **registered** session was explicitly followed, and it is
  found by `sessionId` — glob `~/.claude/projects/*/<sessionId>.jsonl`, never by re-deriving the
  project directory from `cwd`, which breaks on paths containing spaces or `@`
  (`q-round1-buzz-transcript.md` Q27).
- Subagent transcripts are therefore invisible to presence **by construction**, not by a heuristic
  that has to recognise them. Nothing has to detect a fan-out.

`decoders.ts:34` already rejects `isSidechain` records — but that filter only catches sidechain
records *inside* a followed transcript. P31's subagents each wrote a **separate file** whose records
are ordinary assistant records. The registry gate is what covers that case; the `isSidechain` filter
is not, and it should not be expected to.

**The named risk, and its handling.** Q46 (`005` section 17) is open: whether `~/.claude/sessions/`
registers non-Claude agent CLIs at all. If it does not, a registry-only roster makes Codex/Grok/omp
sessions unfollowable. So presence shows a second, clearly separated region — **UNREGISTERED**: any
transcript modified in the last `UNREGISTERED_WINDOW` (default 10 min) in a followed worktree whose
`sessionId` is in no registry entry. Rules: it is **listed, never auto-followed**, follow requires an
explicit press, and the row says *"not in the session registry — may be a subagent"*. That single
region answers Q46 without reopening P31, because the failure mode of the unknown case is a row the
listener can see and decline, not audio.

### 3.3 What protects the listener from a room that is too loud

Five mechanisms, in the order they engage:

1. **The cap (R2).** Seven present, at most three followed, and `follow all` refuses by name.
2. **Serialization plus mandatory speaker-change announcement (R3).** Overlap is impossible;
   unattributed hand-off is impossible.
3. **Per-session queue fairness.** `maxQueued` has one value, **8** (`003` section 8.7's amendment;
   `speech-service.ts:74` still declares `DEFAULT_MAX_QUEUED = 20` and `main.ts:96` passes `8` — the
   constant must be changed to 8 so there is one number). With `|F| > 1` the cap becomes **per
   session**, `ceil(8 / |F|)`, so one chatty agent cannot evict a quiet one's reply. Drops are still
   announced and coalesced (`speech-service.ts:184`), and the announcement now **names the session**
   whose replies were dropped — with several agents, *"skipped 3 older replies"* does not tell the
   listener what they lost.
4. **Solo (section 6).** One press collapses seven to one, and the inverse press restores the set.
5. **The loud-room warning, once.** When `|PRESENT|` first exceeds `FOLLOW_MAX` in a worktree, one
   spoken sentence at `next` urgency: *"Seven sessions are active here; huddle is following two."*
   Once per worktree per worker lifetime, never repeated — an announcement that repeats is the P30
   harm, and a warning that never changes is a broken indicator.

**P31's own instruction stands and is not superseded**: run fan-outs in a separate worktree, or
unfollow before fanning out. This design makes the failure survivable; it does not make the practice
wrong.

---

## 4. Liveness, and the field nobody used (B-02)

### 4.1 The rule

**A registry entry is live iff `kill(pid, 0)` succeeds AND its `procStart` matches the process's
actual start time.** `kill(pid,0)` alone cannot distinguish a live session from a recycled pid, and
the consequence is not cosmetic: a dead session holds a voice slot, which pushes a live agent out of
tier 0 into tier ≥ 1, where `005` section 13 rule 1 makes the call-sign **mandatory on every turn**.
A stale file degrades the audio of every other agent (B-02).

### 4.2 The parsing rule, which the proposed fix did not have — and needs

B-02 says *"comparing `procStart` against the process's actual start time makes the liveness check
pid-reuse-proof"*. Implemented literally, it reports **every** entry stale. **[measured-here]**, macOS
26.5, this machine:

```
registry 2052.json  procStart = "Thu Aug 20 22:24:14 2026"
ps -o lstart= -p 2052         = "Fri Aug 21 01:24:14 2026"
string equality                 -> differs (would mark a live session dead)

new Date(procStart + " UTC").toISOString()      = 2026-08-20T22:24:14.000Z
new Date(ps_lstart).toISOString()               = 2026-08-20T22:24:14.000Z
                                                -> identical instants
```

Three facts follow, and each is a defect if missed:

- **`procStart` is a `ctime`-style string rendered in UTC**; `ps -o lstart=` renders **local time**.
  The machine is `IDT` (UTC+3) [measured-here], so a naive comparison is off by exactly the offset —
  and would be *correct* on a UTC machine, which is the worst kind of bug to ship.
- **Its resolution is one second.** Two processes with the same pid started in the same second are
  indistinguishable. Accept it: the residual is a pid recycled within one second of the original's
  death, and the cost of a miss is one wrong roster row, corrected at the next poll.
- **The comparison must be `|a - b| <= 1s` on parsed epoch values**, never string equality, because
  `ps` pads its output (trailing spaces observed [measured-here]) and formats differ across
  platforms.

Per-platform derivation of "the process's actual start time":

| Platform | Source | Label |
|---|---|---|
| macOS | `ps -o lstart= -p <pid>`, parsed as **local** | **[measured-here]** — matches `procStart` parsed as UTC |
| Linux | `ps -o lstart= -p <pid>`, or `/proc/<pid>/stat` field 22 against `/proc/uptime` for a monotonic answer | **[claimed]** — not run; probe named in section 9 |
| Windows | no `ps`; `(Get-Process -Id <pid>).StartTime`, or the registry's `messagingSocketPath` named-pipe existence | **[claimed]** — and it lands inside `010` section 11.2's open finding C-03, *"`kill(pid,0)`, `/tmp/…` sockets and unix-socket semantics all have undeclared Windows behaviour"* |

Where the start time cannot be derived, the entry is **`liveness: unverified`**, is shown as such in
the roster, and is **followable but never auto-anything**. It is not silently treated as live and it
is not silently dropped — a third state named out loud beats a coin flip either way (P18).

The second liveness signal costs nothing and should be used as corroboration, not as the test:
`messagingSocketPath` = `/tmp/cc-socks/<pid>.sock` existed for all five live sessions in Q27's probe.
Socket present + pid alive + `procStart` match = live; any disagreement = `unverified`.

### 4.3 The reaper

Every registry poll (section 8), an entry that fails the liveness test is removed from `PRESENT` and
from `F`. Because a slot was freed, `005` section 9's reassignment path runs — and it already knows
how to announce a reassignment. Three rules:

1. **A dead session that was the speaker is announced**: *"Cedar's session ended."* Once.
2. **A dead session that was merely present is not announced.** It appears and disappears from the
   roster like any other row.
3. **Its high-water mark is retained**, not pruned, until `MAX_TRACKED_FILES` evicts it (`:49`) — the
   same pid may not come back, but the same `sessionId` can be resumed, and re-reading a resumed
   transcript from zero is P22's third fault.

**Verify by effect:** start a session, record the roster, `kill -9` it (leaving the registry file
behind), and assert the row disappears **and** that a probe with the `procStart` comparison removed
leaves the row present. Without that negative control the test passes on a registry file that was
cleanly deleted, which proves nothing about pid reuse.

---

## 5. The second day

Cross-review B-01's neighbour: *12 dead sessions in the registry, 400 remembered ids. What does
presence look like on day two, and what prunes?*

**The registry-gated roster answers most of it structurally, and that is the point of section 3.**

| Thing that accumulates | Bound | Mechanism |
|---|---|---|
| Registry entries | **self-pruning** — the file is removed on clean exit; a named value moved and moved back in Q27's probe (5 → 6 → 5) | the OS |
| Registry entries after a **crash** | the reaper (4.3), at the next poll | ours |
| Transcript files — **31 in this worktree already** [measured-here] | never enumerated by presence | section 3.2 |
| `#highWater` entries | `MAX_TRACKED_FILES = 50` (`packages/plugin/src/huddle/index.ts:49`), oldest-touched evicted (`:282-290`) | already shipped |
| `#spoken` ids | `MAX_REMEMBERED_IDS = 300` (`:44`), and **explicitly no longer load-bearing** (`:45-47`) — the gate is `replies.slice(mark)` (`:268`) | already shipped |
| `F` membership | `FOLLOW_MAX`, and re-resolved against the live registry at restore (R5) | this document |
| Identity assignments (`005` section 9) | pruned when the `sessionId` leaves the registry **and** its transcript is gone | `005` owns it; this document supplies the liveness input |
| Replay buffer | last 20 (`003` section 4) | already designed |

**So day two looks like day one**: a roster of however many sessions are alive right now — five on
this machine, across four different worktrees [measured-here] — with no history in it. The only
day-two artifact a listener can perceive is a crashed session's row, and it survives exactly one poll
interval.

**The one thing that does not self-heal** is a `sessionId` that is resumed (`claude --resume`) after
its transcript was rewritten: the file shrinks or its uuids change, and `:257-264` re-anchors and
stays quiet, by design (006 C9). Presence must show that as a row state — **`re-anchored`** — rather
than silently, because from the listener's side an agent that stops speaking and an agent that was
re-anchored are the same experience.

---

## 6. Mute, and its inverse

`003` section 7 Q30 settled what mute *does*. With seven sessions present the missing half is
ergonomic: **"mute this one" is the wrong verb; "only this one" is the right one.**

| Verb | Effect on `F` | Effect on `MUTED` | Announced | Stale? |
|---|---|---|---|---|
| `mute <session>` | none | add | count of skipped replies, continuously in the TUI (`003` section 7 rule 3) | never — a level (`003` section 3 R4) |
| `unmute <session>` | none | remove | one sentence: *"three replies were skipped while muted; press R to replay"*, then quiet (`003` rule 4) | never |
| **`solo <session>`** | none | **`MUTED := F \ {session}`** | *"Solo: Cedar. Two others muted."* | never — a level |
| **`unsolo`** | none | restores the `MUTED` set captured at solo time | *"Solo off. Two sessions unmuted."* | never |
| `mute all` | none | `MUTED := F` | count | never |

Four rules attach:

1. **Solo saves and restores.** `solo` snapshots `MUTED` before overwriting it; `unsolo` restores that
   snapshot, not an empty set. Otherwise solo silently un-mutes a session the listener muted an hour
   ago, which is an unrequested change in what speaks — the class P22 belongs to.
2. **Solo is a level and is idempotent.** `solo X` while soloed on `X` is a no-op; `solo Y` while
   soloed on `X` moves the solo and keeps the original snapshot.
3. **Solo does not change `F`.** Muting is a speech filter, not a delivery filter (`003` section 7),
   so the muted sessions' replies still enter the replay buffer and still advance their high-water
   marks. Unsolo therefore never floods — the guarantee is inherited, not re-derived.
4. **Solo has a key and mute already has one.** `003` section 4a.1 gives `m` = mute on both surfaces.
   Solo takes **`o`** in the TUI — free in both tables of `003` section 4a — and appears in the panel's
   secondary row as a fixed-width `[ solo ]` / `[ unsolo ]` label, per `003` section 8.7's no-reflow
   rule. `o` is **not** added to the spoken control vocabulary of `003` section 4a.3 by this document;
   that list constrains the call-sign words (`005` section 11.2) and extending it is `003`'s to do.
   Recorded as Q72.

---

## 7. The display surface — extending 003's wireframe

`003` section 4 already fixed the geometry: 80×24, every region a fixed height, the Stop slot never
moving. This document changes **one region** — SESSIONS — and one status line. Everything else is
`003`'s and is reproduced only so the diff is legible.

```
┌─ Read Aloud ─────────────────────────────── engine: Piper (amy-low) · 58 ms ─┐
│                                                                              │
│  NOW READING            Cedar · orca-plugin-tts-13                  0:07/0:19│   rows 3-6, height 4
│  The normalizer now announces the file name first, then the ▐folder▌,        │   (unchanged from 003
│  then the kind. That was the third listening fix in a row.                   │    except the identity
│  ████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  38%           │    is 003 §6's chain)
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │   rows 8-10,
│  │                          [ S ]   S T O P                               │  │   PRE-RESERVED,
│  └────────────────────────────────────────────────────────────────────────┘  │   NEVER MOVES
│    [ Space ] pause   [ N ] skip   [ M ] mute   [ O ] solo                    │
│  QUEUE  2 waiting                                    per-session cap 3 of 8  │   rows 12-15, height 4
│    1.  Cedar    "I have updated the roadmap and reconciled..."          0:12 │
│    2.  Willow   "The panel bridge is a transport, not a..."             0:31 │
│        (empty)                                                               │
│                                                                              │
│  SESSIONS   3 followed of 7 present            [ F ] follow  [ U ] unfollow  │   rows 17-21,
│   ▶ Cedar     orca-plugin-tts-13   main         speaking                     │   height 5  <- CHANGED
│   ● Willow    orca-5c              panel-bridge followed                     │
│   ● ~~Rowan~~ math-study-f8        main         MUTED  2 skipped             │
│   ○ Juniper   split-the-windows-…  main         present                      │
│   ⚠ (4 more, 2 unregistered — [ ↑↓ ] to scroll)                              │
│  LAST 20   [ R ] replay  [ ↑↓ ] choose         SOLO: off · loud room: 7 here │   row 22  <- CHANGED
│  [ ? ] help                                            control: connected    │   row 23
└──────────────────────────────────────────────────────────────────────────────┘
```

**What changed from `003` section 4's wireframe, and why:**

| Change | Reason |
|---|---|
| SESSIONS header carries `3 followed of 7 present` | with more than one followed session, "how many can talk to me" is the first question and it was previously not on screen |
| Marker column `▶ ● ○` — speaking / followed / present | `003`'s single `>` marked the lock; a set needs to distinguish *is speaking* from *may speak* |
| Region grows to height 5 with an explicit overflow row | seven sessions do not fit in four rows, and a silently truncated roster is the P31 blind spot rendered in a box |
| `MUTED` shown with the skipped count on the row | `003` section 7 rule 3 requires the count displayed continuously; on one row per session it belongs on the row |
| `SOLO: off` and `loud room: 7 here` on row 22 | a state that changes what speaks must be visible; a solo the listener forgot is indistinguishable from a broken plugin |
| `[ O ] solo` in the control row | section 6 |
| QUEUE header shows `per-session cap 3 of 8` | section 3.3 rule 3 — the fairness rule is invisible otherwise, and an invisible cap reads as a bug |
| Queue items labelled by **call-sign** | `005` section 11.2 owns the identity; `sessionLabel()`'s hex slice (`packages/plugin/src/huddle/index.ts:64-69`) is what M15 exists to replace |

**The plugin panel is unchanged.** It is read-blind (`003` section 4), so it gains one button —
`[ solo ]` in the secondary row — and nothing else. It cannot show a roster and must not pretend to.

---

## 8. What presence costs while idle (B-03)

B-03 found no CPU, wakeup or battery figure anywhere in this project. Here are three, measured on
this machine, plus what is honestly not measured.

| What runs | Period | Cost | Label |
|---|---|---|---|
| Registry scan: `readdir` + `JSON.parse` + `kill(pid,0)` over 5 entries | 2 000 ms while huddle is **on** | **0.115 ms per scan** (2.306 ms for 20 scans) → ~0.006 % duty cycle | **[measured-here]** |
| `fs.watch` on followed transcripts | event-driven, no timer | **5 watchers produced 2 events in 12.0 s = 0.17 events/sec** with agents mostly idle | **[measured-here]** |
| `procStart` verification via `ps` | only for entries whose pid is alive **and** whose `procStart` has not already been verified this worker lifetime — cached per (pid, procStart) | one `ps` spawn per new session, ~5–15 ms | **[claimed]** — spawn cost not isolated here |
| Registry scan while huddle is **off** | never | 0 | design constraint |
| `fs.watch` on **unfollowed** sessions | never | 0 | design constraint |

Four rules follow, and they are the design's answer to B-03 rather than a note:

1. **Presence never watches what it is not following.** Roster comes from the registry poll; only
   members of `F` get an `fs.watch`. Cost scales with `|F|` (≤ 3), not with `|PRESENT|` (7) and not
   with transcripts on disk (31).
2. **The registry poll stops when huddle is off**, and `restore()` (`:108-119`) does not start it.
3. **Nothing wakes the audio device.** `010` section 11.5 already adopted B-03's back-off for the
   paused heartbeat; presence adds no periodic sound at all.
4. **The poll interval is a setting with a floor of 1 000 ms.** At 0.115 ms of work, the interval is
   chosen for *freshness*, not for cost — 2 s means a crashed session's row is wrong for at most 2 s.

**The honest gap.** The 0.17 events/sec figure was taken while the watched agents were between turns;
a fan-out writing continuously will be far higher, and neither figure is a *wakeup* count. The probe
that would settle it is `010` section 11.5's, unrun there and unrun here: `powermetrics` sampled for
60 s with huddle on, `|F| = 3`, queue empty, against the plugin disabled — watching wakeups/sec and
package idle residency move. Recorded as **Q73**. Do not quote the two numbers above as a battery
claim; they are CPU-time and event-count figures and nothing more.

---

## 9. A session's life, as a state chart

```mermaid
stateDiagram-v2
    [*] --> unknown
    unknown --> present: registry entry, pid alive, procStart matches
    unknown --> unverified: pid alive but procStart not derivable (C-03)
    unverified --> present: verification succeeds later
    unverified --> dead: pid gone

    present --> followed: listener presses f (never automatic, R1)
    present --> dead: reaper, pid gone or procStart disagrees

    followed --> speaking: its reply reaches the head of the queue
    speaking --> followed: utterance ends, skipped, or unfollowed
    followed --> muted: mute, or solo on another session
    muted --> followed: unmute or unsolo, count announced, never auto-play
    followed --> present: unfollow, queued items to the replay buffer
    muted --> present: unfollow while muted

    followed --> dead: reaper
    muted --> dead: reaper
    speaking --> dead: died mid-utterance, announced once

    present --> reanchored: transcript shrank (resume or compaction)
    reanchored --> present: next reply arrives above the new mark

    dead --> [*]

    note right of speaking
      At most ONE session is in this state at any time.
      Entering it from a DIFFERENT session always speaks
      identity first (R3, and 005 section 13 rule 2).
    end note
```

---

## 10. Gate M16, restated so it can fail

`docs/TASKS.md` gate M16 reads *"the panel shows who is in the room and who is talking, and you can
mute one."* The panel is read-blind (`003` section 4), so the display half of that gate is not
runnable as written. Restated:

> **The control-pane TUI shows who is in the room and who is talking, more than one session can be
> followed at once without either being spoken unattributed, and one press silences all but one.**

| Test | What would prove us wrong |
|---|---|
| **Two followed, interleaved replies.** Feed two transcripts, alternating. | any utterance whose speaker differs from the previous one and was not preceded by an identity announcement (R3) |
| **The P31 fixture.** Seven transcripts in one directory, one registered. Follow the registered one. | the sink speaking **any** text from the six unregistered transcripts. *Negative control:* explicitly follow one unregistered row and assert it now speaks — otherwise the test passes on a plugin that is simply broken |
| **Pid reuse.** `kill -9` a session, leave its registry file, spawn a process that takes the pid. | the row surviving on the roster. *Negative control:* the same fixture with the `procStart` comparison disabled must leave it present |
| **Timezone.** Run the liveness check under `TZ=UTC` and `TZ=Asia/Jerusalem`. | any difference in the verdict — this is the exact defect section 4.2 measured |
| **Solo restores.** Mute A, solo B, unsolo. | A coming back unmuted |
| **Capacity refusal.** Follow four with `FOLLOW_MAX = 3`. | a silent fourth join, or a refusal that is not spoken and not named `follow_capacity` |
| **Death mid-utterance (T164).** Kill the speaking session mid-reply, with `log` and `notify` both disabled. | no **spoken** sentence naming the end (P30 — the discipline that announced into a channel the listener does not read) |
| **Per-session fairness.** One agent emits 20 replies while another emits 1, two followed. | the single reply being evicted, or the drop announcement not naming which session lost replies |
| **Idle cost.** `powermetrics`, huddle on and queue empty, versus plugin disabled. | any measurable wakeup delta (Q73) |

---

## 11. What would prove this document wrong

| Claim | What would refute it |
|---|---|
| Subagent sessions never register in `~/.claude/sessions/` | one registry entry whose `sessionId` matches a Task-tool subagent transcript. The measurement in 3.1 is **one machine, one CLI version** (Claude Code 2.1.238, macOS 26.5) |
| The P22 protections are already per-file | any of `#primed` (`:82`), `#highWater` (`:97`) or the utterance label (`:275`) turning out to need cross-file state |
| Three concurrent speakers are trackable by a listener | the M15 blind listening test scoring below 10/10 at three followed but passing at two followed — in which case `FOLLOW_MAX` drops to 2 and nothing else changes |
| Serialized speech is enough | a listener reporting that waiting for agent A to finish makes agent B's reply useless by the time it is spoken, which would argue for *interrupting* by priority — a different design |
| `procStart` + `kill(pid,0)` is pid-reuse-proof | a pid recycled inside one second, which the 1-second resolution cannot see [measured-here] |
| Presence costs nothing while idle | Q73's `powermetrics` run |

---

## 12. New open questions

To append to `docs/.discussion/000-open-questions.md`. **Numbered from Q70 deliberately**: `010`
section 14 and `011` both claimed Q62–Q66/Q67 concurrently, so Q62–Q69 are ambiguous and must be
cited document-qualified until someone reconciles them.

| # | Kind | Question | Cheapest reversible option |
|---|---|---|---|
| **Q70** | T | **`FOLLOW_MAX`'s default.** 3 is argued in R2; the listener settles it in Voice Lab against a recorded multi-session fixture. `1` reproduces today's lock exactly. | ship 3, expose 1..7 plus `all` |
| **Q71** | D | **Interrupt or wait.** R3 serializes: agent B waits for agent A. Should a *directly addressed* session pre-empt instead? buzz's *"the pickup is the feedback that you heard them"* (`q-round1-buzz-transcript.md`, "What buzz does that we do not" item 1) argues yes; P22 argues no. | ship wait; pre-emption is additive later |
| **Q72** | D | Does `solo` / `unsolo` enter `003` section 4a.3's spoken control vocabulary? It would forbid those words as call-signs (`005` section 11.2). `003` owns that list; this document only takes the `o` key. | add both words — the cost is two of 64 call-sign slots |
| **Q73** | E | **Idle cost, properly.** `powermetrics` with huddle on, three followed, queue empty, versus the plugin disabled. Section 8's figures are CPU-time and event counts, not wakeups. Shares its shape with `010` Q66 and should be run once for both. | if it is not ~zero, the poll interval rises until it is |
| **Q74** | E | **Windows liveness.** Does `(Get-Process -Id <pid>).StartTime` agree with the registry's `procStart`, and in which timezone? Section 4.2 measured macOS and reasoned about the rest. Lands inside `010`'s open C-03. | `unverified` state (4.2) is the fallback and is already specified |
| **Q75** | E | **Is `procStart` UTC by construction or by this machine's accident?** The offset was exactly +3 h here, matching `IDT`. A machine running in UTC would make a string comparison pass and hide the bug. Probe: read a registry entry on a UTC host. | the epoch comparison with a one-second tolerance is correct either way |
| **Q76** | D | **Unregistered rows (3.2).** Shown always, shown only when a followed worktree has them, or hidden behind a keypress? Showing seven subagent rows during a fan-out is noise; hiding them makes Q46's non-Claude agents unreachable. | show, collapsed to a count, expandable with `↑↓` |
