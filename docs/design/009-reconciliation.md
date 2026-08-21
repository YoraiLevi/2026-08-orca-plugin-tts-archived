# 009 — Round-3 reconciliation ledger

**Status:** complete for the eight blocks-implementation findings and the six named cross-document
conflicts. **Written:** 2026-08-21. **Citations re-derived against** `orca-plugin-tts` at `8666cc0`, then **refreshed again at
`393248f`** — teammates landed five commits into `packages/` while this pass was being written, and
the second refresh was driven by `scripts/check-citations.mjs`, which appeared in the tree during
the same window. That tool is the durable answer to E-01; run it before trusting any `path:line`
below.

**What this document is.** One row per finding: what changed, in which document, and — where a
finding was not resolved — why. **It does not restate the designs.** The designs are
`docs/.discussion/002-agent-spoken-channel.md`, `docs/.discussion/003-panel-and-control-channel.md`,
`docs/design/004-voice-lab.md` and `docs/design/005-agent-identity.md`, all four amended **in place**
with dated notes naming the finding that forced each change.

**What this document is not.** It is not a ninth design. Nothing here should be read as the
authority on a mechanism; the amended document is.

**The record is untouched.** `006-fma.md`, `007-user-stories.md` and `008-crossreview-round3.md` are
the record of what was found and were not edited. Rewriting the record hides the work.

---

## 1. The eight blocks-implementation findings

| # | Resolved? | What changed, and where |
|---|---|---|
| **X-01** panel cannot identify the control pane | **yes** | `003` §2D rewritten around a **nonce handshake** (new §2D.1): probe every terminal in the worktree with **`enter: false`**, the control pane answers over the unix socket, the answering id is cached and re-probed on worktree change or on a throw, nothing answering renders `no_control_pane` with the buttons disabled. `003` §2D.3 is new and **specifies the `enter` flag for the first time** — `false` on every probe and every control envelope, `true` **only** for text a human asked us to say. `002` "Validating the target" check 2 rewritten to consume the handshake instead of refusing in every real configuration. `003` §11 gains summary rows 1a and 1b. |
| **X-02** one stdin, two reading modes | **yes** | `003` §2D.2 is new: envelopes are framed as `\x1b]777;orca-tts;<json>\x07`; the reader is a two-state machine (`KEYS` / `FRAME`); nothing inside a frame is ever dispatched as a keypress; frames are bounded at 4,096 bytes; discarded and unparseable frames are **counted and shown**. |
| **X-03** three documents mint earcons from one space | **yes** | `005` §11.1 is now **the one earcon table**, owned by `packages/core/src/earcons/`. New §11.1a reserves **two** axes — note count (identity = exactly 2, control = 1 or 3) and a **disjoint pitch set** (identity keeps the pentatonic; control uses C4 F4 A4 E6 G6). New §11.1b names the eight control earcons and which document emits each. New §11.1c is the pinning test, **with a negative control**. `003` §3 R5 and `004` §8 rule 5 now cite the table and mint nothing. |
| | | **Recomputed cardinality: still 30 (`30 × 64 = 1,920`).** `008` expected a shrink; it does not happen, because the reservation takes notes from **outside** the pentatonic set rather than pairs from inside it, and the extra notes cost nothing since we synthesize them. Stated explicitly in §11.1a so the unchanged number is visibly reasoned rather than overlooked. |
| **X-07** H24, H25 and the ordinals asserted as live defects | **yes** | All three were closed by `5cab7eb` / `6b776d4` **before** `004` and `005` were written. `004`: Panel E preamble rewritten (the wire exists; the **UI** is the gap), row 28 "unreachable" → "reachable, unset", row 29 "Linux drops it entirely" → "honoured on all three", row 33 "never forwarded" → "forwarded at `speech-service.ts:142-144`", row 10 `drop` → **`numeral`** with the correct field name and the correct legal values, the "comprehension bug" paragraph withdrawn, the "Bug, not a control: H25" paragraph withdrawn. `005`: §2's H24 row and §16 prerequisite 1 both moved from *open* to **done**. `004` §7's schema gains the missing fifth field **`orderedLists`**. |
| **X-10** the `spd-say` rung yields no bytes | **yes** | `004` §2's failure section rewritten to **three** provider outcomes: bytes, throw (`503`), and **`spoke-elsewhere`** — a named state read from `provider.linuxBackend` (`os-synth/index.ts:226`), announced through the daemon, with Compare / replay / per-stage play / the timing readout **disabled with the reason attached** and the written-vs-spoken half still working. States plainly that **the M11 two-second gate is not satisfiable on that rung**, and gives the install remedy from `LINUX_INSTALL_HINT`. |
| **E-01** ~30 stale citations | **yes, and the correction table in `008` was itself partly wrong** | Every `packages/` citation in `002`, `004` and `005` re-derived against `8666cc0` by symbol lookup. **All eleven of `008`'s `os-synth` corrections were 16–17 lines low**, because `887f4fe` inserted 16 lines into that file *after* `008` read it at `bb74a5f`; its normalizer / speech-service / main.ts corrections were sound, and one (the stage pipeline) was off by one. `003`'s three stale repo citations also fixed. **Two of `003`'s ORCA citations are still flagged by the checker and are NOT stale** — `plugin-host-api.ts:261-265` and `orca-runtime.ts:39794-39810` are correct at the pinned ORCA commit; the tool's anchor heuristic picks a nearby token from the same sentence. Do not "fix" them. `004` Panel E now carries the durable fix: **cite a symbol plus the line**, and a `scripts/check-citations.mjs` that could actually fail. |
| **E-02 / C-06** `accepted: false` never happens | **yes** | `003` §5's *"It is a real check"* **deleted**, replaced by the rejection path (catch the throw, branch on the code) plus the §2D.1 handshake as the only positive evidence; `{ accepted }` retained solely to distinguish "host accepted the write" from "host threw", never as evidence of effect. `002` check 3 rewritten from *"log the `false`, and say it"* to **"catch and name the throw"**, with the three throw sites cited. `003` §5's state table gains an `action_failed` row. |
| **B-01** the 301st reply | **yes — and implemented mid-pass** | `003` §7.1 is new. Two parts: the id set becomes a **floor** (never speak a record older than the oldest remembered id — ~3 lines, required), and a **per-file byte high-water mark** is the durable bound. Two rules close the replay-buffer gap the finding named: entering the replay buffer **marks a reply seen**; replaying does **not** rewind. Verified by a 305-reply fixture with a worker restart, plus the negative control. **Commit `393248f` landed part 2 while this section was being written** — `#highWater` at `huddle/index.ts:97`, persisted under `HUDDLE_HIGH_WATER_KEY` (`:42`), gate at `:266-268`. **The two replay-buffer rules are NOT covered by that commit**; check them before closing B-01. |
| **B-05** no length cap on the huddle path | **yes** | `002` gains "The reply that does not fit": a per-utterance character cap applied **after** the Option D classifier, announced aloud in buzz's shape, remainder retained in `003`'s replay buffer and marked seen. **The existence of the cap is correctness and is settled in `002`; the number is taste** and is `004` Panel F **row 46 `input.huddleReplyCap`**, beside `input.clipboardCap`. `docs/TASKS.md` gains **T145**. |

---

## 2. The six cross-document conflicts

| # | Chosen answer | Both documents amended |
|---|---|---|
| **X-04 / C4** call-sign primacy | **005 wins.** One word, `WORDS[fnv1a32(sessionId) mod 64]`, layer 0, collisions resolved by probing. `003`'s two-word, rank-4, resolve-by-appending call-sign is withdrawn. | `005` §11.2 gains a confirmation note. `003` §6 rewritten: it now owns the **display-name chain** (registry `name` → branch → displayName → call-sign alone, never hex) and consumes 005's call-sign as the disambiguator — a value already *known* unique, rather than one minted locally and hoped to be. `005` §13 rule 1's every-turn naming for tier ≥ 1 explicitly **overrides** `003`'s transitions-only rule. `004` row 39's option space replaced with the resolved chain. `003` §11 row 6 rewritten. |
| **X-09 / C1** keyboard vocabulary | **One table, `003` §4a**, cited by `004` §8 and `005` §11.2. `Space` = play/pause **toggle** on both; `s` = stop on both (`.` demoted to alias); `R` = replay on both; `m` = mute on both. The lab's snapshot/restore move `S`/`R` → `K`/`L`; its More tier moves `M` → `+`; `V` and `,` retired. | `003` §4a is new (transport keys, surface-specific keys, the **17-word spoken control vocabulary**, and the chord caveat). `004` §8 rule 2 replaced with a citation plus a changed-column reproduction; `004` §6a's `,`/`.` line and the `V` toggle updated. `005` §11.2's four-word vocabulary superseded by §4a.3. |
| | | **Why `s` beat the lab's `.` even though the lab ships first:** the lab's `.` is arbitrary; the TUI's `s` is the fastest press-to-silence route in the system and the one binding a listener must hit without looking. Where the lab's choice was not load-bearing (`Space`, `E`, `C`, `?`, arrows) it was kept. Stated in `003` §4a so the trade is visible. |
| **C7** hex in the lab | **Row 39 loses `path-tail-3-plus-hash` entirely. Row 40 keeps the slider — 0 is a useful setting — with default `0`, demoted to the More tier, and a spoken warning if set above 0.** | `004` rows 39 and 40, plus the replacement of the "Row 40 is not cosmetic" paragraph with a note explaining that hex was shipped as *taste* when both `003` and `005` treat it as *correctness*. `004` §7 schema updated. |
| **C3** queue cap | **8.** It is what the listener has been living with; twenty queued replies is ~3 minutes of unrequested speech. `DEFAULT_MAX_QUEUED` must change from 20 to 8 so one constant exists. | `004` row 36 (default stated, range 1–20 kept) plus a settled-note under Panel F. `003` §8.7 rule 1 now **cites row 36** rather than restating a number, with a note recording the three-value drift. `004` §7 schema keeps `"maxQueued": 8`. |
| **C5** M15 vs the P22 lock | **A precondition, not a question. M15 is scheduled after M16**, or gate M15 cannot be run — huddle locks to one session and that lock *is* the P22 fix. | `005` §15.1 is new, stating the dependency plainly and giving the coherent alternative (identity for switch announcements only, which requires **rewording the gate** in the same change). `005` Q50 marked answered. `005` §16 gains prerequisite 9 (M16's followed set) and prerequisite 10 (`switchTo()` has no caller — 007 C8, a live defect on which every identity announcement rides). |
| **C6** M14 task order | **Reordered.** Option D first, A second, E third; B and C recorded as closed-negative. **Gate split** into M14a (no marker → the diagram is not spoken and the omission is named; holdable with zero agent cooperation) and M14b (marker → the description is spoken). | `docs/TASKS.md` Phase M14 reordered and re-gated, with T145 (the cap) and T146 (the N-of-M counter) added. `002`'s "Gate M14 must be satisfiable by Option D alone" paragraph updated from a request into a record of the change. |

---

## 3. Not resolved, and why

Each of these is a `needs-a-decision` or `worth-noting` finding outside the eight blockers. They are
listed so that round 4 does not have to rediscover which ones were skipped **on purpose**.

| # | Why not resolved here |
|---|---|
| **X-05** ~2.7 s of preamble in front of a 1.0 s reply | **Opened as `Q61`.** The mechanism (a preamble budget, elements dropped in a stated priority order, the drop counted not spoken) is designable; the **priority order and the percentage are taste**, and picking them without hearing the stack is exactly the P23 mistake. Recorded in `003` §6 and `005` §13 so neither document leaves it implicit. |
| **X-06** settings file is a control-plane mutation with no generation, in `~/.orca/` | Needs a decision nobody has made about where plugin settings live (ORCA's `pluginsDataDir` via `settings.set` from the worker, or our own namespace) and whether the lab writes through the worker. It touches `004` Q47 and `003`'s verb set together. Deferred rather than guessed. |
| **X-08** Option D's skip vocabulary has no controls in M11, and no migration past a frozen `schemaVersion: 1` | Recorded in `004` §10 as an explicit gap. Resolving it means either reserving an `omit.artifacts` group now or writing a version policy — both are `004`'s call and neither is blocked, but the choice changes what M12 freezes. |
| **X-11** Stop during an earcon; the two route-2 numbers disagree (40–120 vs 250 ms) | Partly addressed: `005` §11.1b specifies `control.stop` fires **on every Stop press including stale ones**. The fade-out on `bargeIn()` and the numeric contradiction in `003` §2 remain. |
| **E-03 / C-01 / E-05** unlabelled latency numbers; the ~970 ms nobody measured | `005` §11.1d now labels the earcon's real cost and says the ~970 ms is unmeasured. The full `[measured] / [claimed]` sweep across three documents, and the five-minute probe that would settle the 970, are a separate pass. |
| **C-02** a CI gate on an architecture whose viability is `003`'s own Q45/Q46 | `003` §12 now states the 400 ms number is a **target until those probes run**. The gate itself is not rewritten; that is M13's task list, not a design edit. |
| **E-04 / E-06 / E-07 / C-03 / C-04 / C-05 / C-07 / C-08 / B-02 / B-03 / B-04 / B-06 / B-07** | Not in scope for this pass. **C-05 in particular deserves scheduling**: four uncoordinated extensions to the provider seam (`005`'s `identity` + `pitchSemitones`, `003`'s `pause()`/`resume()`, `004`'s `chunk.format` branch, and now the earcon's format) all land before or around M11, and doing it four times will produce four shapes. **E-06 is a live v1 defect, not a future one**: `[[volm 0.2]]` in an agent reply reaches macOS `say` intact and silences the tool with no error. |
| **C-09** two `## P27` entries in `PITFALLS.md` | Outside the four documents. Still true at `8666cc0`; still a two-minute fix before either number is cited. |

---

## 4. New questions opened

Both in `docs/.discussion/000-open-questions.md`, numbered from **Q60** — because Q43–Q52 are
**ambiguous**: all four designs opened new questions starting at Q43 without consulting the arbiter
(`006` §15b X5; PITFALLS P12). That collision is now recorded in the open-questions file with the
instruction to cite them document-qualified (`003 Q45`, not `Q45`) until the ledger publishes a
mapping. **They were deliberately not renumbered** — `006`, `007` and `008` cite them, and those are
the record.

| # | Kind | One line | Cheapest reversible option, as picked |
|---|---|---|---|
| **Q60** | E | Does a raw-mode stdin reader in an ORCA pane actually receive `terminal.sendText` bytes with `enter: false`? The whole X-01 handshake rests on it and it has never been run (P0). | If negative: `enter: true` **for the probe only**, carrying a lone `#` comment that is inert in every shell and in an agent composer — `enter: false` stays mandatory for real envelopes. |
| **Q61** | D | Who arbitrates the audio stream, and what is the utterance-preamble budget (X-05)? | A budget enforced by whichever module assembles the utterance, with the **percentage set by the listener** — so the reversible half is a number in a settings file, not a hard-coded priority order. |

---

## 5. Files changed

| File | Why |
|---|---|
| `docs/.discussion/002-agent-spoken-channel.md` | E-01, E-02/C-06, X-01 (check 2), B-05, C6 |
| `docs/.discussion/003-panel-and-control-channel.md` | X-01, X-02, X-04/C4, X-09/C1, E-01, E-02/C-06, B-01, C3, C-02 note, Q-collision note |
| `docs/design/004-voice-lab.md` | X-03 (cite), X-04/C4, X-07, X-09/C1, X-10, E-01, E-08, C3, C7, B-05 |
| `docs/design/005-agent-identity.md` | X-03 (owner), X-04/C4, X-07, X-09/C1 (cite), E-01, E-04, E-07, C5, C8 |
| `docs/.discussion/000-open-questions.md` | Q60, Q61, the Q43–Q52 collision note, resolution log entries |
| `docs/TASKS.md` | C6 — Phase M14 reordered, gate split into M14a/M14b, T145 and T146 added |

Not touched, on instruction: `docs/design/006-fma.md`, `docs/design/007-user-stories.md`,
`docs/design/008-crossreview-round3.md`. Nothing committed.

---

## 6. What would prove this reconciliation wrong

| Claim | What would refute it |
|---|---|
| The `enter: false` handshake resolves the control pane | Q60 coming back negative — a raw-mode reader that receives nothing without a submit |
| Identity cardinality survives the earcon reservation at 30 | a control earcon that is audibly confusable with an identity motif despite the disjoint pitch set — a listening failure the byte-distinctness test cannot catch |
| `s` for stop is the right cross-surface binding | the listener, having used the lab first, reaching for `.` under pressure |
| 8 is the right queue cap | replies the listener wanted being dropped at the cap in normal use |
| M15 depends on M16 | the author choosing resolution B — identity for switch announcements only — in which case gate M15 is reworded and the dependency disappears |
| Every citation in the four documents is now correct | `scripts/check-citations.mjs`, once it exists, failing on any of them |
