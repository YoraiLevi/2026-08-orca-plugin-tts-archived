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

To be filled from the pinned detached-worktree run before handoff.

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
