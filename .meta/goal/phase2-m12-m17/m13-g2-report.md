# M13 / G2 dashboard report

## Outcome

G2 is implemented on the terminal TUI chosen by `docs/.discussion/003-panel-and-control-channel.md`.
The plugin panel is write-capable but read-blind; the TUI owns the live dashboard because it can
watch worker state without ORCA's panel budget, and Stop travels in the other direction over a
local socket rather than a poll.

The status file is atomically replaced, mode `0600`, and includes the section-8.4 future fields
`sourceMap` and `cursor` as present-and-null. `SpeechService` publishes now-reading state and every
queued item's existing session provenance; it does not reconstruct identity in the surface.

## Independent end-to-end oracle

`packages/plugin/src/main.test.ts`, `G2 terminal dashboard and control channel`, drives:

1. a real transcript file whose session name the test chose (`sessionalpha`);
2. the real huddle watcher and `SpeechService`;
3. a provider gate that holds reply one while exactly two later replies remain queued;
4. the real atomic dashboard document and the real terminal renderer;
5. the real control socket back to the plugin.

The expected display label is independently rebuilt from the path/session values the test wrote,
and depth is the independently-established literal `2`. No expectation reads the dashboard's own
label or count. Stop success is not `accepted` or `{ok:true}`: the test records both counters before
the command and requires `provider.cancelled` and `sink.stops` to increase, then requires published
state to become idle with depth zero. The client has a 400 ms response ceiling; the response is
sent only after `SpeechService.stop()` has awaited cancellation and sink flush. No audio was opened
or played (P31).

## RED then green

All probes ran headless against the same G2 test:

- session mutation: render `unknown session` instead of `status.nowReading.sessionLabel` → RED at
  `expect(rendered).toContain(NOW READING <independent label>)`;
- depth mutation: render `QUEUE 0 waiting` instead of `status.queueDepth` → RED at
  `expect(rendered).toContain('QUEUE  2 waiting')`;
- consumer mutation: acknowledge Stop without calling `handlers.stop()` → RED:
  `Stop was acknowledged but synthesis was not cancelled: expected 1 to be greater than 1`;
- all three reverted → GREEN, 1/1 G2 test.

The three mutations are permanent named entries in `scripts/mutation-check.mjs`:
`dashboard-hides-session`, `dashboard-hides-depth`, and `dashboard-stop-ack-only`.

## Detached verification

Pinned detached worktree at `f029e6f`, after `pnpm install --frozen-lockfile`:

- `pnpm typecheck` — PASS; `pnpm lint` — PASS with pre-existing warnings only; `pnpm build` —
  PASS; `pnpm size-gate` — **4 files / 0.18 MB**; built-artifact activation smoke — PASS with
  **9 commands** and `agent.status.changed`; load average **6.42** at start `[measured-here]`.
- Targeted G2 oracle — **1/1 PASS**, 318 ms test duration, load average 6.23 at end
  `[measured-here]`.
- Full `pnpm test` — **RED for one unrelated G5/M16 failure**, at load average **7.77**
  `[measured-here]`: `packages/plugin/src/huddle/presence.test.ts` says unmute replayed
  `must never be heard`. G2 itself passed in that run. This worker did not change M16-owned code;
  the exact pinned failure was escalated to the coordinator. After its owner corrected the test's
  watcher race, a second fresh detached worktree at integrated SHA `119c063` (again installed with
  `pnpm install --frozen-lockfile`) ran **779/779 tests in 35 files**, load average **3.70** at start
  and **4.77** at end `[measured-here]`; G2 passed there in 325 ms.
- `node scripts/mutation-check.mjs` — **40/40 behaved as declared**, including all three new G2
  mutants, at load average **15.12 → 7.06** `[measured-here]`. This is **+3 declarations and +6
  behaving declarations versus the contract baseline 34/37 at `6049c26`, load 11.01**: the three
  old survivors are now killed and the three new G2 claims are killed. Equivalent mutants retain
  their declared SURVIVED verdicts.
- Built-CLI execution probe — the first direct run went RED with `SyntaxError` because the bundle
  contained two shebangs. `scripts/build.mjs` now executes the emitted CLI headlessly and requires
  its named disconnected state. Detached SHA `73dfd8d`, load average **3.43** `[measured-here]`:
  build PASS, **4 files / 0.18 MB**, activation smoke PASS, emitted CLI executes and exits 1 after
  rendering `control: not connected` (the expected unavailable result, not a crash).

## Deferred, with reasons

- Panel-button forwarding: the panel can call `terminal.sendText`, but it sees only opaque terminal
  ids. The nonce target-resolution/onboarding/lifetime probes in 003 Q43/Q45/Q46/Q60 remain; guessing
  could submit Stop into an agent terminal and create more speech. G2 does not require that unsafe
  route because the terminal surface's `s` control already reaches the plugin.
- Last-20 replay, roster, pause, mute, and per-word cursor: these belong to their owning milestones.
  M13 only preserves the nullable cursor/source-map protocol slots so later work is additive.
- Audio-drain latency: prohibited here by P31's no-audio rule and not observable from the headless
  sink. The control path itself is pushed and capped at 400 ms; this report does not mislabel
  kill/handler completion as the last sample leaving the device.
- Exact installed command onboarding: the repository exposes `pnpm control` and ships
  `dist/plugin/orca-tts.mjs`; automatically creating or selecting a terminal is unavailable to a
  plugin and remains 003 Q43.
