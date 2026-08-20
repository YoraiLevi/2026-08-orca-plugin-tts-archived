# Tasks — ORCA TTS plugin

Format: `T### [P?] [M#] Description → path`
`[P]` = parallelizable with its siblings (different files, no shared state). No `[P]` = sequential.
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

- [ ] **T020** Test harness: table-driven cases, one named case per construct → `core/src/normalizer/normalize.test.ts`
- [ ] **T021** [P] Ported-from-buzz cases (must fail)
  - [ ] T021a Fenced code ``` and ~~~ → "code block omitted"; unclosed fence omits remainder
  - [ ] T021b Inline code: backticks stripped, content KEPT
  - [ ] T021c URLs → "link omitted"; trailing `.!?` preserved for prosody
  - [ ] T021d `**bold**` `__x__` `~~strike~~` markers deleted, text kept
  - [ ] T021e `_emphasis_` stripped ONLY when wrapping a word
  - [ ] T021f `snake_case`, `foo_bar()` survive untouched ← the anti-goal case
  - [ ] T021g Emoji deleted; ASCII emoticons `:)` left alone
  - [ ] T021h Integers 0–999999 → words; `9:05` → "nine oh five"; decimals left alone
  - [ ] T021i Whitespace collapsed; result of length ≤1 suppressed entirely
- [ ] **T022** [P] Our four additions buzz lacks (must fail)
  - [ ] T022a Headings → pause, not "hash hash Foo"
  - [ ] T022b List items → sentences
  - [ ] T022c Tables → announced by row
  - [ ] T022d File paths → spoken sensibly, not slash-by-slash garbage
- [ ] **T023** [P] Tool-call noise and system messages produce empty output
- [ ] **T024** [P] Property test: output contains no residual markdown metacharacters for 500 generated inputs

### Then implement until green

- [ ] **T025** Implement 11 stages in fixed order → `core/src/normalizer/index.ts`
- [ ] **T026** [P] `NormalizeOptions` (verbosity, path style, code-block policy)
- [ ] **T027** Zero-dependency audit: no imports at all in this module

**Gate M2:** all normalizer tests green; T021f passes (identifiers intact); `pnpm test --filter core` on 3 OSes.

---

## Phase M3 — Chunker (TEST-FIRST)

- [ ] **T030** Invariant test FIRST: `chunks.join('') === input` for 500 generated inputs → `core/src/chunker/chunker.test.ts`
- [ ] **T031** [P] Boundary ladder tests: sentence → clause → word → scalar
- [ ] **T032** [P] Abbreviation guard: `e.g.` `i.e.` `Dr.` `1.` do not end a sentence
- [ ] **T033** [P] First-sentence-alone policy: chunk 1 = earliest sentence end
- [ ] **T034** [P] Greedy packing: chunks 2..n = latest boundary that fits the limit
- [ ] **T035** [P] Streaming equivalence: text fed 5 chars at a time == whole string at once
- [ ] **T036** [P] Single word exceeding the limit does not deadlock (scalar fallback)
- [ ] **T037** Implement `SentenceBoundaryDetector` with `addText()` / `finish()` → `core/src/chunker/index.ts`
- [ ] **T038** Implement the limit strategy as an injected function (tokens for local, chars for cloud)

**Gate M3:** T030 and T035 green — streaming and batch produce identical chunks.

---

## Phase M4 — Provider seam + OS synthesizer

- [ ] **T040** Define `TtsProvider`, `AudioChunk`, `ProviderCapabilities` → `core/src/types/`
- [ ] **T041** Write the provider CONTRACT suite; it must fail against a null provider → `providers/src/contract.test.ts`
  - [ ] T041a Yields at least one non-empty audio chunk for ordinary text
  - [ ] T041b Returns empty, does not throw, for empty input
  - [ ] T041c `cancel()` observed within 50 ms — measured elapsed, not exit code
  - [ ] T041d `capabilities` matches actual behaviour (streaming claim verified)
  - [ ] T041e `prepare()` is idempotent and reports warm state
- [ ] **T042** Implement `OsSynthProvider` dispatch → `providers/src/os-synth/index.ts`
  - [ ] T042a macOS: `say -o out.wav --data-format=LEI16@22050` ← never AIFF, decodeAudioData rejects AIFF-C
  - [ ] T042b Windows: `System.Speech` via `powershell -NoProfile`
  - [ ] T042c Linux: `spd-say`, falling back to `espeak-ng`
  - [ ] T042d Cancel = kill the child process; assert the measured latency
  - [ ] T042e Detect absence of every OS synth and surface a real error (never silence)
- [ ] **T043** [P] `ProviderRegistry`: select by config, query capability, report warm state
- [ ] **T044** [P] Generation-tagged playback queue → `core/src/queue/`
  - [ ] T044a Barge-in clears the queue; voice-switch preserves it
  - [ ] T044b Single-flight lock: a second hotkey press never overlaps the first
  - [ ] T044c Two-sided cancel: abort synthesis AND flush buffers
- [ ] **T045** Wire the contract suite to run against `OsSynthProvider` on all 3 OSes

**Gate M4:** contract suite green per OS; T041c reports a real measured number under 50 ms.

---

## Phase M5 — Plugin skeleton + scripted dev loop (lands before any feature)

- [ ] **T050** `orca-plugin.json` manifest → `plugin/orca-plugin.json`
  - [ ] T050a Capabilities: `events:subscribe`, `storage`, `settings:own`, `notifications:show`
  - [ ] T050b Commands + rebindable keybindings
  - [ ] T050c Panel declaration
- [ ] **T051** `activate()` + one command that speaks a fixed string → `plugin/src/main.ts`
- [ ] **T052** `adapter/` — every ORCA API call isolated here, nowhere else → `plugin/src/adapter/`
- [ ] **T053** esbuild → single `main.mjs`, ESM, default-exporting activate
- [ ] **T054** **Scripted dev loop** → `scripts/dev.mjs`
  - [ ] T054a Build
  - [ ] T054b `plugins.list()` → read the LIVE `consentFingerprint`
  - [ ] T054c `plugins.consent({ reviewedFingerprint })`
  - [ ] T054d `setEnabled` off → on, forcing the worker re-fork
  - [ ] T054e Print the plugin's log ring buffer (there is no log file on disk)
- [ ] **T055** [P] Size gate script: fail if > 2000 files or > 50 MB → `scripts/size-gate.mjs`
- [ ] **T056** [P] `docs/dev-loop.md` — why the naive edit-and-reload silently runs stale code

**Gate M5:** change a string in `main.ts`, run `scripts/dev.mjs`, hear the NEW string. Proves the re-fork happened — the old string playing is the failure this gate exists to catch.

---

## Phase M6 — US1: clipboard hotkey

- [ ] **T060** Clipboard read per OS from the worker → `plugin/src/clipboard.ts`
  - [ ] T060a macOS `pbpaste` · Windows `Get-Clipboard` · Linux `wl-paste` → `xclip` → `xsel`
  - [ ] T060b Empty clipboard → spoken notice, not silence
  - [ ] T060c Oversized clipboard → truncate at a stated limit and say so
- [ ] **T061** Command handler: normalize → chunk → provider → sink
- [ ] **T062** Second press stops; assert measured stop latency < 50 ms
- [ ] **T063** [P] "Speak last agent reply" command (the other honest selection fallback)
- [ ] **T064** [P] Settings: engine, voice, rate, enabled → `settings:own`
- [ ] **T065** [P] Panel v1: what is speaking, stop button, engine picker, limitation notice
- [ ] **T066** Integration test against a fake provider, asserting the ordered call sequence

**Gate M6:** on each OS, hotkey speaks clipboard; second press silences within a measured 50 ms.

---

## Phase M7 — US2: huddle mode

- [ ] **T070** Subscribe `agent.status.changed`, capture `worktreeId` → `plugin/src/huddle/`
- [ ] **T071** Session correlation heuristic from the worktree path
  - [ ] T071a Resolve project slug → transcript directory
  - [ ] T071b Most-recently-modified selection
  - [ ] T071c Detect the two-agents-one-worktree ambiguity and DEGRADE LOUDLY, not silently
- [ ] **T072** JSONL tailer with debounce → `plugin/src/huddle/tailer.ts`
- [ ] **T073** **Thinking-block filter at the RAW record level, before flattening** ← load-bearing ordering
- [ ] **T074** [P] Vendored decoders: claude, openclaude, codex, grok, omp
- [ ] **T075** [P] Fixture transcripts committed as test data
  - [ ] T075a Fixture containing BOTH thinking and reply blocks
  - [ ] T075b Fixture with tool calls and tool results
  - [ ] T075c Fixture with an unclosed code fence
- [ ] **T076** Test: fixture T075a speaks ONLY the reply — the fixture exists to make this failable
- [ ] **T077** [P] Mute / pause / skip controls in the panel
- [ ] **T078** [P] Unsupported-agent detection → tell the user, don't fail silently

**Gate M7:** T076 green. A real agent turn is spoken end to end and no thinking text is audible.

---

## Phase M8 — CI, docs, publish

- [ ] **T080** CI matrix `[macos, ubuntu, windows] × Node 24` → `.github/workflows/ci.yml`
  - [ ] T080a install → typecheck → lint → unit → contract → bundle
  - [ ] T080b Size gate enforced in CI, not just locally
  - [ ] T080c Headless smoke: OS synth yields non-empty audio bytes on each runner
- [ ] **T081** [P] `README.md`: install, config, engines, limitations verbatim from the blocked table
- [ ] **T082** [P] `LICENSE` per T001b
- [ ] **T083** [P] `CONTRIBUTING.md` + the dev-loop pointer
- [ ] **T084** Reconcile `STATE.md`, `HANDOFF.md`, `PITFALLS.md` against the shipped system
- [ ] **T085** Create the public GitHub repo and push
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

- [ ] **T100** PR 1: host→panel `postMessage` channel (unlocks measured-good panel playback)
- [ ] **T101** PR 2: `sessionId` / `transcriptPath` in the `agent.status.changed` projection
- [ ] **T102** PR 3: `selection:read` capability
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
