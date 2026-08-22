# Tasks — ORCA TTS plugin

Format: `T### [P?] [M#] Description → path`
`[P]` = parallelizable with its siblings (different files, no shared state). No `[P]` = sequential.
Checkbox states: `[ ]` not started · `[x]` done, gate run · `[~]` raised upstream, not ours to close.
Derived from `docs/PLAN.md`. Checkpoints are gates: do not start the next phase until the gate holds.

**Gate rule:** a checkpoint that could not have failed is not a checkpoint. Every one below names a
value that must move.

> **Amended 2026-08-21 — forced by round-7 findings R7-01, R7-02, R7-06 and R7-11
> (`docs/design/014-review-round7.md`).** PITFALLS **P32**'s propagation list omitted this file and
> `docs/PLAN.md`, so **six rounds of measurement folding never opened either** — which is how Gate M9
> came to pass with the ~950 ms inter-sentence gap fully intact, and how the constitution's sharpest
> latency constraint came to have no task carrying it. P32's list has been extended. Three things
> changed here: **Phase M9 was rescoped and re-gated** (already landed, `docs/design/015-m9-rescope.md`,
> and Gate M9a is now the instrument for `docs/PLAN.md`'s new inter-sentence-gap Definition-of-Done
> item); **T125 now carries `queue.maxQueued`**, which four documents specified three incompatible
> ways while no task carried any of them (R7-06); and **M15's dependency on M16** — decided in
> `docs/design/009-reconciliation.md` section 2, conflict C5, and never propagated here — is stated
> below.

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

## Phase M9 — The resident service (post-v1)

> **Rescoped 2026-08-21 by `docs/design/015-m9-rescope.md`, which amends `010` sections 8, 10 and 12.**
> This phase read *"Resident service + Piper — only a neural engine meets the 500 ms budget"*. Both
> halves of that are measured false. **The ~950 ms inter-sentence gap is the CoreAudio device open,
> not the process spawn** — spawn is 2.3 ms of it, the temp file 0.33 ms, ~893 ms is the device
> `[measured-here]` (`docs/.research/latency-measurements.md` 1.1, PITFALLS **P32**). And a **warm
> resident `AVSpeechSynthesizer` reaches its first buffer in p50 17.7 / 17.1 ms**, n=20 ×2
> `[measured-here]` (`docs/.research/spike1-resident-synth.md` 1) — 8.5× inside 010's 150 ms pass
> condition. **So M9's deliverable is holding the audio DEVICE open across an utterance, and Piper is
> a quality decision on its own schedule.** A change that stops spawning a player per chunk while
> still opening the device per chunk recovers **2 ms of 950** and alters nothing a listener hears.

### M9a — the resident service, OS synthesizer, device held

- [ ] **T088** SPIKE-3: hold a device open across two buffers; report gap and device-open count. **Audible — not on a machine anyone is listening to** (P31). The one number M9a's plan rests on and the only one nobody has taken
- [ ] **T089** [P] Run the committed cross-platform SPIKE-1 probes — `scripts/spikes/spike1-windows-firstbuffer.ps1` and `scripts/spikes/spike1-linux-firstindex.mjs`. Both are `[claimed]` today; each is one command on the right machine
- [ ] **T090** macOS sidecar skeleton: resident process, `AVSpeechSynthesizer.write(_:toBufferCallback:)` → `AVAudioEngine` + `AVAudioPlayerNode`, **one engine start per session**
- [ ] **T090a** Device lifecycle: lazy acquire on first synthesize; **engine never stops between sentences**; release at `IDLE_RELEASE_MS` (60 s); process exit at `IDLE_EXIT_MS` (15 min, 5 min on battery); **no timer ever touches the device on a schedule** (B-03)
- [ ] **T090b** Default-device change mid-sentence — headphones plugged in — rebuild the graph at the new output format and **resume from the last completed word boundary**; announce only if a sentence was lost, at `next` urgency (P30)
- [ ] **T090c** Device lost to hog/exclusive mode → announce the rung change **by name**, fall back to the subprocess sink (R015)
- [ ] **T090d** Two-sided cancel while we own the device: `stopSpeaking(.immediate)` + drop unscheduled buffers + `playerNode.stop()` with a short fade, **engine stays running**; sidecar timestamps the last non-silent sample (this is 003's drain segment, finally measurable)
- [ ] **T090e** `duck(level)` / `unduck()` as transport verbs — a mixer gain ramp. **B-04 is structural and belongs in this brief, not a later patch**
- [ ] **T090f** Protocol + addressing: `/synthesize` (streaming), `/cancel`, `/pause`, `/resume`, `/duck`, `/health`, `/engines`; per-worktree socket path (P27), `protocolVersion` in the path, `{pid, procStart}` liveness (B-02), version mismatch **announced and degraded, never silent** (C-03 covers the Windows named-pipe half)
- [ ] **T094** [P] `ServiceProvider` implementing `TtsProvider` v2, passing the same contract suite
- [ ] **T095** Degradation ladder with explicit rung reporting — the plugin can say which rung each platform is on
- [ ] **T096** Kill the service mid-utterance → restart **once** with backoff, resume from the last completed sentence, and **say so aloud**. *(Reworded: the old "no user-visible failure" is the discipline P30 forbids.)* Verify by effect with `log` and `notify` disabled, plus a negative control
- [ ] **T097a** Gap probe: `interchunk.gap` shape from `scripts/bench-latency.mjs`, run against the resident sink **and against today's `SubprocessSink` in the same session as the baseline** (R004)
- [ ] **T097b** Idle probe: `powermetrics` wakeups/sec and package idle residency, service warm and queue empty, against a plugin-disabled baseline. Closes the half of B-03 that `spike1-resident-synth.md` 3.1 excludes
- [ ] **T098** [P] Windows resident host (`SetOutputToAudioStream`, `SpeakProgress`, WASAPI shared-mode client held open)
- [ ] **T099** [P] Linux SSIP socket client — pause/resume and index marks, **`bytes: false` permanently**; it is a `spoke-elsewhere` provider, not a synthesis service

**Gate M9a — the device stays open across a reply.** Full statement, with its instrument and its
falsifier, in `docs/design/015-m9-rescope.md` section 6. In brief:

- **Pass:** inter-sentence gap **p50 ≤ 50 ms, p95 ≤ 100 ms**, gap-to-audio ratio **p50 ≤ 5 %**;
  **exactly one device open per reply**, asserted by the test; `firstaudio.upper` **p50 ≤ 500 ms**
  warm (the conservative bound, so the gate cannot be met by picking the flattering one); no
  measurable rise in idle wakeups/sec; and the same-session baseline against today's sink still
  reads ~890–950 ms.
- **FALSIFIER:** p50 gap above **150 ms**, or more than one device open per reply, or
  `firstaudio.upper` p50 above **500 ms**. Any one means residency did not buy the device back and
  the milestone routes to design 004's held-`AudioContext` path.
- **Not a CI gate.** CI runners have no audio device at all (P16), so every probe that matters would
  report NOT-RUN and the row would be a permanently-broken indicator. *(This replaces the old T097's
  "in CI".)* CI gates the **protocol**: socket lifecycle, version refusal, cancel semantics,
  restart-and-resume, capability descriptor.
- **Running it is audible** — `afplay` has no device-selection flag and stock macOS has no null sink
  (P31, `latency-measurements.md` 1.0). Not on a machine anyone is listening to.

### M9b — Piper as an engine inside the service

Gated on **quality**, not latency. Piper's 52–65 ms/sentence `[measured-here]` (P11) is a regression
guard here, not the gate. The argument for it is that all 180 installed macOS voices on this machine
are the compact tier `[measured-here]`, Windows third-party apps are fenced to SAPI 5 `*Desktop`
voices and stock Linux is espeak-ng (P16) — so **one good voice, identical on three platforms**, for
a listener who spends hours a day with it. Quality is an accessibility property here.

- [ ] **T091** Piper via `sherpa-onnx-node` → `service/src/engines/piper.ts`
- [ ] **T092** Model manager
  - [ ] T092a Download with resume + progress
  - [ ] T092b **ASCII-safe Windows cache path** mirroring ORCA's `model-cache-path.ts`
  - [ ] T092c Regression test with a non-ASCII path ← the `Björn` bug
  - [ ] T092d Checksum verification
- [ ] **T093** Warm-on-start + one-character warm-up generation
- [ ] **T097c** Quality comparison against the OS voice, and a latency regression guard (must not get worse than M9a)

**Gate M9b:** a listener prefers the Piper voice in a blind A/B on all three platforms; T092c green;
the licence is shown before any download; M9a's latency gate still passes.

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

Designed in `docs/design/011-settings.md`, which supersedes three sentences of `004` and **owns every
settings id in the project** — including the ones M16 and M17 add at `since: 3`.

- [ ] **T120** Settings schema shared by plugin and lab → `packages/core/src/settings/`
- [ ] **T121** Plugin reads settings via `settings.get` on activate, and on change
- [ ] **T122** Defaults come from the schema, never hardcoded at a call site
- [ ] **T123** Invalid/partial settings fall back per-field, never wholesale, and log which field
- [ ] **T124** Test: every `NormalizeOptions` field is reachable from settings, asserted by iterating
      the schema — a new option that is not settable fails the test, with the named `EXCLUDED` list
      carrying the reason for every deliberate omission
- [ ] **T125** **`queue.maxQueued` becomes one control with one owner** — added 2026-08-21, forced by
      **R7-06**. Four documents specified it three incompatible ways and **no task carried any of
      them**: `docs/design/009-reconciliation.md` C3 and `004`/`003` say the one value is **8**;
      `docs/design/011-settings.md` T122 says **delete** both `maxQueued: 8` and `DEFAULT_MAX_QUEUED`
      so no call site holds a fallback literal; `docs/design/012-huddle-presence.md` says set it to 8
      **and** make it `ceil(8 / |F|)`; `docs/design/013-voice-input.md` assumes a flat 8; and
      `packages/plugin/src/speech-service.ts:89` still reads `const DEFAULT_MAX_QUEUED = 20`.
  - [ ] T125a `011`'s schema owns the control. Every other document **cites** `queue.maxQueued`; none
        restates the number. The shipped default moves **20 → 8** (C3: twenty queued replies is ~3
        minutes of unrequested speech).
  - [ ] T125b Delete `DEFAULT_MAX_QUEUED` and the `maxQueued: 8` call-site literal; the fallback-literal
        lint (`011` section on T122) goes red if either returns.
  - [ ] T125c **Per-session fairness is a second field, not a redefinition of the first** —
        `queue.perSessionFairness` at `since: 3`, so `011`'s plain-`int` `queue.maxQueued` keeps one
        meaning. Its arithmetic must not admit more than the global cap (R7-36).
  - [ ] T125d Test: with `|F| > 1`, the **total** admitted across all sessions is asserted against the
        global cap, with a negative control that fails when the cap is raised.

**Gate M12:** a value exported from Voice Lab, pasted into ORCA settings, produces byte-identical
spoken text.

---

## Phase M13 — The dashboard and control channel (roadmap item 3)

Design of record: `docs/.discussion/003-panel-and-control-channel.md`. **Not blocked upstream.** A
plugin panel is write-capable through `terminal.sendText` and read-blind because storage remains
panel-forbidden; the live surface is therefore the foreground terminal TUI. Stop is pushed through
a socket and never polled (the panel poll floor is ~345 ms `[derived]`).

- [x] **T130** Worker publishes an atomic, mode-`0600` status document on every speech transition
  - [x] T130a now reading: source/spoken text, existing session provenance, start time
  - [x] T130b queue: independently stored count and per-item session label
  - [x] T130c engine and degradation rung
  - [ ] T130d last 20 spoken replies, for replay — deferred: not required by G2; belongs with the
        replay/presence work rather than being invented inside the dashboard
- [x] **T131** `orca-tts control` terminal TUI watches atomic state transitions and renders them;
      it spends zero panel-bridge messages and never interpolates a word cursor
  - [x] T131a exact session label and queue depth rendered in fixed rows
  - [x] T131b disconnected state is named; it never displays a frozen value as current
- [x] **T132** `s` / `.` Stop is pushed over the worker control socket and awaits the plugin effect
  - [x] T132a Stop converges on `SpeechService.stop()`: synthesis cancel plus sink flush
  - [ ] T132b panel-button forwarding — deferred to the nonce target-resolution/onboarding work in
        003 Q43/Q45/Q46/Q60; the panel must not guess among opaque terminal ids
  - [ ] T132c skip, pause, mute, replay — deferred to their owning milestones; an unimplemented
        verb received by the worker is refused by name in the audio stream
- [x] **T133** Static plugin panel says honestly that live state is in the terminal TUI
- [x] **T134** End-to-end oracle: real transcript watcher → held speech queue → atomic state → real
      renderer, then real socket → `SpeechService.stop()`; expected label/depth come from values the
      test chose independently, and Stop is asserted on cancellation and sink-flush counters

**Gate M13 / G2:** while a reply is being read, the terminal TUI names its session and shows
`QUEUE  2 waiting`; its Stop control reaches the plugin and clears both synthesis and playback.

---

## Phase M14 — A spoken channel the agent controls (roadmap item 4)

The biggest quality change available. `block/buzz` does not read the reply; the agent chooses what
is said aloud, which is why it can render an ASCII diagram and describe it in one sentence.

> **Reordered 2026-08-21 (round 3 reconciliation), forced by 007 C6 / 008 X-08.** This phase
> previously listed the marker convention **first** and the heuristic **last**, which inverts the
> conclusion `002` actually reached: *"Option D is the product and Option A is an enhancement — not
> the other way round, which is how the roadmap currently reads."* Options B and C are **closed
> negative** (B: no MCP surface exists in ORCA's plugin system, Q1; C: fails R4.1, R4.2 and R3.4)
> and are kept only as recorded rejections. The gate is split, because a gate that only passes with
> a cooperating agent is a gate we cannot hold — the expected cooperation rate is near zero.

- [x] **T140** Design doc → `docs/.discussion/002-agent-spoken-channel.md`, with Options and a
      Recommendation. **Settled: D is the floor and the deliverable; A is the enhancement.**
  - [ ] T140a **Option D (FIRST): heuristic** — structural classifier; read the prose, skip the
        artifact, and **announce every skip by name**. Serves 100 % of replies from every agent.
  - [ ] T140b **Option A (SECOND): the marker convention** — a fenced `speak` block extracted in
        `decoders.ts` before normalization, with the absence-case pinned as the identity function.
  - [ ] T140c **Option E (THIRD): the listener-invoked recap** over `terminal.sendText`, behind the
        four validation checks, `enter: true`, target resolved per `003` §2D.1. Never automatic.
  - [ ] T140d Option B — **rejected, recorded**: no MCP surface exists (Q1).
  - [ ] T140e Option C — **rejected, recorded**: a summarizer forfeits R4.1/R4.2 and needs a second
        model (R3.4); its failure mode is a confidently wrong summary the listener cannot check.
  - [ ] T140f How each degrades when the agent does not cooperate (most will not)
  - [ ] T140g Whether the spoken channel replaces or supplements the full reply, and who chooses
        — **four policies wired, default left to Voice Lab (Q8, taste)**
- [ ] **T141** Implement **Option D** behind the provider-agnostic seam. Only then Option A.
- [ ] **T142** Fallback: when no spoken channel is present, today's behaviour is unchanged —
      pinned by the identity-function test over a marker-free corpus
- [ ] **T143** Fixture: a reply with an ASCII diagram plus a one-line description — the motivating case
- [ ] **T144a** Test: **with no marker present**, the diagram is never spoken and the omission is
      announced by name
- [ ] **T144b** Test: **with a marker present**, the description is spoken
- [ ] **T145** The per-utterance **length cap** on the huddle path, announced aloud, remainder to
      the replay buffer (`002` "The reply that does not fit"; the number is `input.huddleReplyCap`
      in M11)
- [ ] **T146** Wire the *"spoken channel used in N of M replies"* counter. It will read 0.

**Gate M14a (the product, holdable without any agent's cooperation):** the motivating fixture is
**not** spoken as box-drawing characters, and what was skipped is announced by name.

**Gate M14b (the enhancement, requires a cooperating agent):** given the same fixture *with* a
```speak block, the one-sentence description is what is spoken.

---

## Phase M15 — Per-agent voices (roadmap item 5)

> **Dependency stated 2026-08-21 — forced by R7-03's root cause (P32's propagation list omitted this
> file). Decided in round 3, `docs/design/009-reconciliation.md` section 2, conflict C5, and never
> propagated here.** **M15 is scheduled after M16, or Gate M15 cannot be run.** Gate M15 reads *"with
> two agents running, you can tell who is speaking"* — but huddle today locks to one session, and
> **that lock is the P22 fix**, so a two-agent gate has no configuration to run in until M16's
> followed set exists. The coherent alternative, recorded so it is not rediscovered: ship identity for
> **switch announcements only**, which requires **rewording the gate in the same change** rather than
> leaving a gate nothing can satisfy. See `docs/design/005-agent-identity.md` section 15.1.
>
> Two live prerequisites travel with it, from `005` section 16: M16's followed set (9), and
> **`switchTo()` has no caller** (10, `007` C8) — a live defect on which every identity announcement
> rides.

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

Depends on M13. **Scheduled before M15** — see the note under Phase M15.
Designed in `docs/design/012-huddle-presence.md`; its settings are `docs/design/011-settings.md`'s.

- [ ] **T160** Model: which sessions are "in the huddle", which is speaking, which are queued
- [ ] **T161** Panel presence list — session label, voice, speaking indicator
- [ ] **T162** Join / leave a session from the panel, replacing the follow/unfollow chords
- [ ] **T163** Per-session mute
- [ ] **T164** Test: presence reflects reality after a session ends mid-utterance

**Gate M16:** the panel shows who is in the room and who is talking, and you can mute one.

---

## Phase M17 — Voice input (roadmap item **7**, later)

> **Renumbered 2026-08-21 — forced by R7-11.** This read *"roadmap item 8"* while M11–M16 map to
> items 1–6 and `HANDOFF.md:74-77` lists exactly **seven** Phase-2 items in this order. There is no
> item 7 anywhere in the repo: `grep -rn "roadmap item 7" .` returns nothing. **Read as an off-by-one,
> not as a dropped item** — but this is an inference from two artifacts, not from the tracker. If
> issue [#4](https://github.com/YoraiLevi/orca-plugin-tts/issues/4) or
> [#5](https://github.com/YoraiLevi/orca-plugin-tts/issues/5) names an eighth item, that item has no
> milestone here and needs one (R083). **Whoever next opens those issues should check and record the
> answer beside this note**; nobody in this session could reach the network.
>
> **Designed 2026-08-21 in `docs/design/013-voice-input.md`**, which supersedes T170–T172 below.
> Its verdict: full voice-input parity is **not buildable to R1 today**, and what ships is
> **M17a — push-to-talk plus a listener-invoked recap**, with M17b (recognizer) and M17c (own STT
> stack) unscheduled and their reasons recorded.

- [x] **T170** Decide whether to use ORCA's existing STT stack or our own `sherpa-onnx`.
      **Settled in `013`: neither, at M17a.** ORCA's thirteen host methods touch no speech, so the
      plugin cannot reach ORCA's stack from the worker at all — the reason is reachability, not the
      panel.
- [ ] **T171** Push-to-talk before hands-free; barge-in gated behind it. **M17a.** Barge-in is
      **two named budgets, not one** (R7-28): press → last sample is 250 ms end-to-end; the
      **provider-cancel segment inside it** stays at the constitutional `< 50 ms`
      (`.specify/memory/constitution.md:118`, `packages/providers/src/contract.ts:12`). M17a asserts
      **both**, separately — collapsing them is the conflation
      `packages/providers/src/budget-claims.test.ts` exists to prevent.
- [ ] **T172** Half-duplex gate so the mic does not hear the speaker
- [ ] **T173** The listening window's close condition, and what it does when the followed set is
      empty — added 2026-08-21, forced by **R7-30**. The primary close signal is a new `type:'user'`
      record in a **followed** transcript, and `012`'s R1 guarantees `F = ∅` after every reap,
      restart and first run, so on a fresh worker that signal **cannot fire** and the window runs to
      `TALK_WINDOW_MS`. See `013` for the specified behaviour; say aloud at press time which close
      condition is armed.

**Gate M17a:** speaking interrupts playback within **both** named budgets, without echo; and with
`F = ∅` the window closes on the specified fallback, not on the 30 s clock.

---

## Cross-cutting, tracked but unscheduled

- [ ] **T180** Identifiers spoken raw: `_flush_buffer()` gets no treatment. Decide in Voice Lab.
- [ ] **T181** Deep folder paths read as long flat word lists — depth limit or ellipsis
- [ ] **T182** Replay the last thing said
- [ ] **T183** Scrub within a long reply, not only skip
- [ ] **T184** Re-verify vendored host facts against a newer ORCA (currently pinned to 1.4.185)
