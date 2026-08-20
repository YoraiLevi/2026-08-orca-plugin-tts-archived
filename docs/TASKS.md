# Tasks — ORCA TTS plugin

Format: `T### [P?] [M#] Description → path`
`[P]` = parallelizable with its siblings (different files, no shared state). No `[P]` = sequential.
Checkbox states: `[ ]` not started · `[x]` done, gate run · `[~]` raised upstream, not ours to close.
Derived from `docs/PLAN.md`. Checkpoints are gates: do not start the next phase until the gate holds.

**Gate rule:** a checkpoint that could not have failed is not a checkpoint. Every one below names a
value that must move.

---

## Phase M0 — Spec (blocking; nothing else starts)

- [ ] **T001** Answer the three open questions in `docs/PLAN.md` §1 → user decision
  - [x] T001a Repo layout: **one repo, two packages** — decided by default, see STATE.md assumptions
  - [x] T001b Licence: **MIT** — decided by default, revisit before T082/publish
  - [x] T001c **v1 is OS-synth-only**; service is M9 — decided by default
- [ ] **T002** Run `/speckit-specify` for `001-speak-selection` → `specs/001-speak-selection/spec.md`
- [ ] **T003** Write user stories with acceptance scenarios → same file
  - [ ] T003a US1 (P1): speak the clipboard on a hotkey
  - [ ] T003b US2 (P2): hear agent replies automatically (huddle)
  - [ ] T003c US3 (P3): choose a voice and engine
  - [ ] T003d Edge cases: empty clipboard · 50k-char clipboard · no audio device · engine crash mid-utterance · two agents one worktree
- [ ] **T004** State the selection limitation in the spec body, not a footnote → spec.md
- [ ] **T005** Run `/speckit-clarify`, resolve every `[NEEDS CLARIFICATION]` → spec.md
- [ ] **T006** Run `/speckit-plan` → `plan.md`, `research.md`, `data-model.md`, `contracts/`
- [ ] **T007** Run `/speckit-tasks` and reconcile against this file → `tasks.md`

**Gate M0:** `grep -c 'NEEDS CLARIFICATION' spec.md` returns 0, and the requirements checklist passes.

---

## Phase M1 — Repo skeleton

- [x] **T010** pnpm workspace + root `package.json` → `package.json`, `pnpm-workspace.yaml`
- [x] **T011** [P] TypeScript strict config → `tsconfig.base.json`
- [x] **T012** [P] vitest config with per-package projects → `vitest.config.ts`
- [x] **T013** [P] esbuild bundle script → `scripts/build.mjs`
- [x] **T014** [P] oxlint config → `.oxlintrc.json`
- [x] **T015** Create `packages/core`, `packages/providers`, `packages/plugin` with index + package.json
- [x] **T016** [P] `.gitattributes` (LF everywhere) — CRLF will corrupt fixture comparisons on Windows

**Gate M1:** `pnpm test` exits 0 on macOS, Linux, Windows locally or in a throwaway CI run.

---

## Phase M2 — Speech normalizer (TEST-FIRST, non-negotiable)

### Tests first — all must fail before any implementation

- [x] **T020** Test harness: table-driven cases, one named case per construct → `core/src/normalizer/normalize.test.ts`
- [x] **T021** [P] Ported-from-buzz cases (must fail)
  - [x] T021a Fenced code ``` and ~~~ → "code block omitted"; unclosed fence omits remainder
  - [x] T021b Inline code: backticks stripped, content KEPT
  - [x] T021c URLs → "link omitted"; trailing `.!?` preserved for prosody
  - [x] T021d `**bold**` `__x__` `~~strike~~` markers deleted, text kept
  - [x] T021e `_emphasis_` stripped ONLY when wrapping a word
  - [x] T021f `snake_case`, `foo_bar()` survive untouched ← the anti-goal case
  - [x] T021g Emoji deleted; ASCII emoticons `:)` left alone
  - [x] T021h Integers 0–999999 → words; `9:05` → "nine oh five"; decimals left alone
  - [x] T021i Whitespace collapsed; result of length ≤1 suppressed entirely
- [x] **T022** [P] Our four additions buzz lacks (must fail)
  - [x] T022a Headings → pause, not "hash hash Foo"
  - [x] T022b List items → sentences
  - [x] T022c Tables → announced by row
  - [x] T022d File paths → spoken sensibly, not slash-by-slash garbage
- [x] **T023** [P] Tool-call noise and system messages produce empty output
- [x] **T024** [P] Property test: output contains no residual markdown metacharacters for 500 generated inputs

### Then implement until green

- [x] **T025** Implement 11 stages in fixed order → `core/src/normalizer/index.ts`
- [x] **T026** [P] `NormalizeOptions` (verbosity, path style, code-block policy)
- [x] **T027** Zero-dependency audit: no imports at all in this module

**Gate M2:** all normalizer tests green; T021f passes (identifiers intact); `pnpm test --filter core` on 3 OSes.

---

## Phase M3 — Chunker (TEST-FIRST)

- [x] **T030** Invariant test FIRST: `chunks.join('') === input` for 500 generated inputs → `core/src/chunker/chunker.test.ts`
- [x] **T031** [P] Boundary ladder tests: sentence → clause → word → scalar
- [x] **T032** [P] Abbreviation guard: `e.g.` `i.e.` `Dr.` `1.` do not end a sentence
- [x] **T033** [P] First-sentence-alone policy: chunk 1 = earliest sentence end
- [x] **T034** [P] Greedy packing: chunks 2..n = latest boundary that fits the limit
- [x] **T035** [P] Streaming equivalence: text fed 5 chars at a time == whole string at once
- [x] **T036** [P] Single word exceeding the limit does not deadlock (scalar fallback)
- [x] **T037** Implement `SentenceBoundaryDetector` with `addText()` / `finish()` → `core/src/chunker/index.ts`
- [x] **T038** Implement the limit strategy as an injected function (tokens for local, chars for cloud)

**Gate M3:** T030 and T035 green — streaming and batch produce identical chunks.

---

## Phase M4 — Provider seam + OS synthesizer

- [x] **T040** Define `TtsProvider`, `AudioChunk`, `ProviderCapabilities` → `core/src/types/`
- [x] **T041** Write the provider CONTRACT suite; it must fail against a null provider → `providers/src/contract.test.ts`
  - [x] T041a Yields at least one non-empty audio chunk for ordinary text
  - [x] T041b Returns empty, does not throw, for empty input
  - [x] T041c `cancel()` observed within 50 ms — measured elapsed, not exit code
  - [x] T041d `capabilities` matches actual behaviour (streaming claim verified)
  - [x] T041e `prepare()` is idempotent and reports warm state
- [x] **T042** Implement `OsSynthProvider` dispatch → `providers/src/os-synth/index.ts`
  - [x] T042a macOS: `say -o out.wav --data-format=LEI16@22050` ← never AIFF, decodeAudioData rejects AIFF-C
  - [x] T042b Windows: `System.Speech` via `powershell -NoProfile`
  - [x] T042c Linux: `spd-say`, falling back to `espeak-ng`
  - [x] T042d Cancel = kill the child process; assert the measured latency
  - [x] T042e Detect absence of every OS synth and surface a real error (never silence)
- [x] **T043** [P] `ProviderRegistry`: select by config, query capability, report warm state
- [x] **T044** [P] Generation-tagged playback queue → `core/src/queue/`
  - [x] T044a Barge-in clears the queue; voice-switch preserves it
  - [x] T044b Single-flight lock: a second hotkey press never overlaps the first
  - [x] T044c Two-sided cancel: abort synthesis AND flush buffers
- [x] **T045** Wire the contract suite to run against `OsSynthProvider` on all 3 OSes

**Gate M4:** contract suite green per OS; T041c reports a real measured number under 50 ms.

---

## Phase M5 — Plugin skeleton + scripted dev loop (lands before any feature)

- [x] **T050** `orca-plugin.json` manifest → `plugin/orca-plugin.json`
  - [x] T050a Capabilities: `events:subscribe`, `storage`, `settings:own`, `notifications:show`
  - [x] T050b Commands + rebindable keybindings
  - [x] T050c Panel declaration
- [x] **T051** `activate()` + one command that speaks a fixed string → `plugin/src/main.ts`
- [x] **T052** `adapter/` — every ORCA API call isolated here, nowhere else → `plugin/src/adapter/`
- [x] **T053** esbuild → single `main.mjs`, ESM, default-exporting activate
- [x] **T054** **Scripted dev loop** → `scripts/dev.mjs`
  - [x] T054a Build
  - [x] T054b `plugins.list()` → read the LIVE `consentFingerprint`
  - [x] T054c `plugins.consent({ reviewedFingerprint })`
  - [x] T054d `setEnabled` off → on, forcing the worker re-fork
  - [x] T054e Print the plugin's log ring buffer (there is no log file on disk)
- [x] **T055** [P] Size gate script: fail if > 2000 files or > 50 MB → `scripts/size-gate.mjs`
- [x] **T056** [P] `docs/dev-loop.md` — why the naive edit-and-reload silently runs stale code

**Gate M5:** change a string in `main.ts`, run `scripts/dev.mjs`, hear the NEW string. Proves the re-fork happened — the old string playing is the failure this gate exists to catch.

---

## Phase M6 — US1: clipboard hotkey

- [x] **T060** Clipboard read per OS from the worker → `plugin/src/clipboard.ts`
  - [x] T060a macOS `pbpaste` · Windows `Get-Clipboard` · Linux `wl-paste` → `xclip` → `xsel`
  - [x] T060b Empty clipboard → spoken notice, not silence
  - [x] T060c Oversized clipboard → truncate at a stated limit and say so
- [x] **T061** Command handler: normalize → chunk → provider → sink
- [x] **T062** Second press stops; assert measured stop latency < 50 ms
- [x] **T063** [P] "Speak last agent reply" command (the other honest selection fallback)
- [ ] **T064** [P] Settings: engine, voice, rate, enabled → `settings:own`
- [ ] **T065** [P] Panel v1: what is speaking, stop button, engine picker, limitation notice
- [x] **T066** Integration test against a fake provider, asserting the ordered call sequence

**Gate M6:** on each OS, hotkey speaks clipboard; second press silences within a measured 50 ms.

---

## Phase M7 — US2: huddle mode

- [x] **T070** Subscribe `agent.status.changed`, capture `worktreeId` → `plugin/src/huddle/`
- [x] **T071** Session correlation heuristic from the worktree path
  - [x] T071a Resolve project slug → transcript directory
  - [x] T071b Most-recently-modified selection
  - [x] T071c Detect the two-agents-one-worktree ambiguity and DEGRADE LOUDLY, not silently
- [x] **T072** JSONL tailer with debounce → `plugin/src/huddle/tailer.ts`
- [x] **T073** **Thinking-block filter at the RAW record level, before flattening** ← load-bearing ordering
- [x] **T074** [P] Vendored decoders: claude, openclaude, codex, grok, omp
- [x] **T075** [P] Fixture transcripts committed as test data
  - [x] T075a Fixture containing BOTH thinking and reply blocks
  - [x] T075b Fixture with tool calls and tool results
  - [x] T075c Fixture with an unclosed code fence
- [x] **T076** Test: fixture T075a speaks ONLY the reply — the fixture exists to make this failable
- [ ] **T077** [P] Mute / pause / skip controls in the panel
- [x] **T078** [P] Unsupported-agent detection → tell the user, don't fail silently

**Gate M7:** T076 green. A real agent turn is spoken end to end and no thinking text is audible.

---

## Phase M8 — CI, docs, publish

- [x] **T080** CI matrix `[macos, ubuntu, windows] × Node 24` → `.github/workflows/ci.yml`
  - [x] T080a install → typecheck → lint → unit → contract → bundle
  - [x] T080b Size gate enforced in CI, not just locally
  - [x] T080c Headless smoke: OS synth yields non-empty audio bytes on each runner
- [x] **T081** [P] `README.md`: install, config, engines, limitations verbatim from the blocked table
- [x] **T082** [P] `LICENSE` per T001b
- [x] **T083** [P] `CONTRIBUTING.md` + the dev-loop pointer
- [x] **T084** Reconcile `STATE.md`, `HANDOFF.md`, `PITFALLS.md` against the shipped system
- [x] **T085** Create the public GitHub repo and push
- [ ] **T086** Marketplace entry `{kind:git, url, ref}` pinned to an exact commit
- [ ] **T087** Tag v1.0.0

**Gate M8:** install from the public repo into a clean ORCA profile **on a second machine** and hear a reply. Installing on the dev machine proves nothing.

---

## Phase M9 — Resident service + Piper (post-v1)

- [ ] **T090** Service skeleton: `/synthesize` (streaming), `/cancel`, `/health`, `/engines`
- [ ] **T091** Piper via `sherpa-onnx-node` → `service/src/engines/piper.ts`
- [ ] **T092** Model manager
  - [ ] T092a Download with resume + progress
  - [ ] T092b **ASCII-safe Windows cache path** mirroring ORCA's `model-cache-path.ts`
  - [ ] T092c Regression test with a non-ASCII path ← the `Björn` bug
  - [ ] T092d Checksum verification
- [ ] **T093** Warm-on-start + one-character warm-up generation
- [ ] **T094** [P] `ServiceProvider` implementing `TtsProvider`, passing the same contract suite
- [ ] **T095** Degradation ladder with explicit rung reporting
- [ ] **T096** Test: kill the service mid-utterance → falls back to OS synth, no user-visible failure
- [ ] **T097** [P] Latency benchmark asserting < 500 ms warm, per OS, in CI

**Gate M9:** T097 reports measured first-audio under 500 ms on each OS; T096 green.

---

## Phase M10 — Upstream PRs to `stablyai/orca`

- [~] **T100** PR 1: host→panel `postMessage` channel (unlocks measured-good panel playback)
- [x] **T101** PR 2: `sessionId` / `transcriptPath` in the `agent.status.changed` projection
- [~] **T102** PR 3: `selection:read` capability
- [ ] **T103** [P] `PanelSink` implementation, dormant until PR 1 merges
- [ ] **T104** [P] Swap the correlation heuristic for the real id once PR 2 merges

**Gate M10:** three PRs open, each with a test and this plugin cited as the motivating consumer.

---

## Dependency graph

```
M0 ──▶ M1 ──▶ M2 ──┐
              M3 ──┼──▶ M4 ──▶ M5 ──┬──▶ M6 ──┐
                   │                 └──▶ M7 ──┼──▶ M8 ──▶ M9 ──▶ M10
                   │                           │
   (M2 and M3 are parallel; both feed M4)      │
   (M6 and M7 are parallel after M5)  ─────────┘
```

- **Critical path:** M0 → M1 → M2/M3 → M4 → M5 → M7 → M8.
- **Parallel pairs:** M2 ∥ M3 · M6 ∥ M7 · most `[P]` tasks within a phase.
- **M5 is a hard serialization point** — every later phase debugs stale code without the scripted dev loop.

## MVP boundary

M0–M6 is a shippable product: a hotkey that speaks your clipboard on three platforms with zero setup.
M7 makes it the thing you actually asked for. M9 makes it fast. M10 makes it correct.

---

# PHASE 2 — from usable to refined

Opened 2026-08-21 after the first day of real use. v1 works; it is not refined. Roadmap issues
[#4](https://github.com/YoraiLevi/orca-plugin-tts/issues/4) and
[#5](https://github.com/YoraiLevi/orca-plugin-tts/issues/5).

**Ordering rule:** M11 first and alone. Every later milestone is cheaper once taste can be settled
by ear in seconds instead of by conversation in minutes.

---

## Phase M11 — Voice Lab (roadmap item 1)

A local page running the real normalizer and the real provider. No ORCA involvement.

- [ ] **T110** Fixture corpus → `fixtures/*.md`, committed and reviewable
  - [ ] T110a code-heavy reply (fences, inline code, identifiers with leading underscores)
  - [ ] T110b table-heavy reply (2-col, 4-col, ragged, one with no header row)
  - [ ] T110c path-heavy reply (shallow, deep, unknown extensions, paths with trailing punctuation)
  - [ ] T110d long architecture explanation — the queue/skip stress case
  - [ ] T110e short answer — the latency case
  - [ ] T110f hostile: emoji, box-drawing ASCII diagram, URLs, keyboard glyphs, mixed RTL
- [ ] **T111** Local server → `scripts/voice-lab.mjs`, `pnpm voice-lab`
  - [ ] T111a serve the page from localhost, bind 127.0.0.1 only
  - [ ] T111b `POST /normalize` returns spoken text for `{text, options}`
  - [ ] T111c `POST /speak` synthesizes and plays on this machine
  - [ ] T111d `POST /stop`
- [ ] **T112** The page → `voice-lab/index.html`, self-contained, no CDN
  - [ ] T112a fixture picker plus a free-text box
  - [ ] T112b every `NormalizeOptions` field as a control, live-updating
  - [ ] T112c side-by-side: written text vs spoken text, diff-highlighted
  - [ ] T112d Play / Stop per fixture
  - [ ] T112e A/B — same fixture under two option sets, back to back
  - [ ] T112f Export settings as JSON
- [ ] **T113** Round-trip test: exported JSON, fed to `normalize()`, reproduces the lab's spoken text
- [ ] **T114** Runs on all three OSes in CI (headless: normalize only, no audio)

**Gate M11:** change a control, hear the difference in under two seconds, without touching ORCA.

---

## Phase M12 — Settings (roadmap item 2)

- [ ] **T120** Settings schema shared by plugin and lab → `packages/core/src/settings/`
- [ ] **T121** Plugin reads settings via `settings.get` on activate, and on change
- [ ] **T122** Defaults come from the schema, never hardcoded at a call site
- [ ] **T123** Invalid/partial settings fall back per-field, never wholesale, and log which field
- [ ] **T124** Test: every `NormalizeOptions` field is reachable from settings, asserted by iterating
      the schema — a new option that is not settable fails the test

**Gate M12:** a value exported from Voice Lab, pasted into ORCA settings, produces byte-identical
spoken text.

---

## Phase M13 — The panel that shows what is happening (roadmap item 3)

**Blocked** on [stablyai/orca#15643](https://github.com/stablyai/orca/pull/15643) (`storage.get`
panel-callable) or [#15638](https://github.com/stablyai/orca/issues/15638) (host→panel push).

- [ ] **T130** Worker publishes status to plugin storage on every transition
  - [ ] T130a now reading: text preview, session label, elapsed
  - [ ] T130b queue: count and per-item session label
  - [ ] T130c engine and degradation rung
  - [ ] T130d last 20 spoken replies, for replay
- [ ] **T131** Panel polls `storage.get` and renders it
  - [ ] T131a poll interval respects the panel bridge rate limit (30 per 10 s)
  - [ ] T131b stale-status detection: say "not connected" rather than showing a frozen lie
- [ ] **T132** Controls in the panel — stop, skip, unfollow, replay item N
  - [ ] T132a **blocked**: panels cannot invoke commands. Needs an upstream answer or a storage-flag
        polled by the worker as a command channel. Decide, do not improvise silently.
- [ ] **T133** Fall back to the current static panel when `storage.get` is not panel-callable, and
      say why in the panel itself
- [ ] **T134** Test: status written by the worker parses in the panel's renderer

**Gate M13:** while a reply is being read, the panel names the session and the queue depth, and a
click stops it.

---

## Phase M14 — A spoken channel the agent controls (roadmap item 4)

The biggest quality change available. `block/buzz` does not read the reply; the agent chooses what
is said aloud, which is why it can render an ASCII diagram and describe it in one sentence.

- [ ] **T140** Design doc → `docs/.discussion/002-agent-spoken-channel.md`, with Options and a
      Recommendation. **Do not code before this is settled.**
  - [ ] T140a Option A: a marker convention in the reply (e.g. a fenced `speak` block) that the
        plugin extracts and reads instead of the prose
  - [ ] T140b Option B: an MCP tool the agent calls to speak, so speech is an explicit action
  - [ ] T140c Option C: a hook/subagent that summarises the reply for the ear
  - [ ] T140d Option D: heuristic — read the summary sentences, skip the artifact
  - [ ] T140e How each degrades when the agent does not cooperate (most will not)
  - [ ] T140f Whether the spoken channel replaces or supplements the full reply, and who chooses
- [ ] **T141** Implement the chosen option behind the provider-agnostic seam
- [ ] **T142** Fallback: when no spoken channel is present, today's behaviour is unchanged
- [ ] **T143** Fixture: a reply with an ASCII diagram plus a one-line description — the motivating case
- [ ] **T144** Test: the diagram is never spoken; the description always is

**Gate M14:** the motivating fixture is spoken as one sentence, not as box-drawing characters.

---

## Phase M15 — Per-agent voices (roadmap item 5)

- [ ] **T150** Voice assignment: stable per session, from the available voice list
  - [ ] T150a deterministic from the session id, so the same agent keeps its voice across restarts
  - [ ] T150b avoid collisions while sessions are concurrent
  - [ ] T150c user override per session, persisted
- [ ] **T151** Provider interface carries voice per utterance (already does — verify end to end)
- [ ] **T152** Announce the speaker on switch, and make the announcement suppressible once voices
      make it redundant
- [ ] **T153** Test: two sessions receive different voices; the same session is stable across a
      worker restart

**Gate M15:** with two agents running, you can tell who is speaking without being told.

---

## Phase M16 — Huddle presence (roadmap item 6)

Depends on M13.

- [ ] **T160** Model: which sessions are "in the huddle", which is speaking, which are queued
- [ ] **T161** Panel presence list — session label, voice, speaking indicator
- [ ] **T162** Join / leave a session from the panel, replacing the follow/unfollow chords
- [ ] **T163** Per-session mute
- [ ] **T164** Test: presence reflects reality after a session ends mid-utterance

**Gate M16:** the panel shows who is in the room and who is talking, and you can mute one.

---

## Phase M17 — Voice input (roadmap item 8, later)

- [ ] **T170** Decide whether to use ORCA's existing STT stack or our own `sherpa-onnx`
- [ ] **T171** Push-to-talk before hands-free; barge-in gated behind it
- [ ] **T172** Half-duplex gate so the mic does not hear the speaker

**Gate M17:** speaking interrupts playback within the barge-in budget, without echo.

---

## Cross-cutting, tracked but unscheduled

- [ ] **T180** Identifiers spoken raw: `_flush_buffer()` gets no treatment. Decide in Voice Lab.
- [ ] **T181** Deep folder paths read as long flat word lists — depth limit or ellipsis
- [ ] **T182** Replay the last thing said
- [ ] **T183** Scrub within a long reply, not only skip
- [ ] **T184** Re-verify vendored host facts against a newer ORCA (currently pinned to 1.4.185)
