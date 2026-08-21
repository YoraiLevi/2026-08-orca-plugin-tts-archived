# J22 — `POST /speak` streams, one unspeakable chunk is survivable, and the remedy fits the platform

**Written:** 2026-08-21. **Author:** job J22. **Commits:** `407f958`, `c22d9da`, `dc9e2c6`, `242a170`.
**Reproduce:** `node scripts/bench-lab-gate.mjs` and `node scripts/bench-lab-gate.mjs --no-stream`.
**Silent by default and there is still no audible mode** — `docs/.research/m11-gate.md` section 2 is
unchanged and all four of its silence mechanisms are intact.

This file answers `docs/.research/m11-gate.md` section 0, which measured Gate M11 UNMET at p95
3,401 ms and named the cause: `POST /speak` synthesized every chunk before it answered.

---

## 0. The verdict, first

**Streaming removes the per-chunk multiplication. It does not, on this machine on this day, make
the gate pass.** Both statements are measured and both matter.

The decisive reading is the pair below — same binary, same machine, minutes apart, one flag
different (`--no-stream` is FR-026's negative control, which finding G-4 recorded as *unrunnable*
because the shipped path WAS the disabled path):

| Series | streaming ON | streaming OFF (`--no-stream`) | ratio |
|---|---|---|---|
| `gate.cold.longest` — `paths.md` body, 13 chunks, n=5 | p50 **2,278** · p95 **4,229 ms** | p50 86,034 · p95 98,066 ms | **23× at p95** |
| `gate.cold.short` — `short.md` body, 2 chunks, n=20 | p50 **4,156** · p95 **7,813 ms** | p50 8,031 · p95 9,935 ms | 1.9× at p50 |
| `component.server.synth` — one sentence through `generate()`, n=20 | p50 2,586 ms | p50 3,689 ms | — |

All `[measured-here]`, one run each, 2026-08-21, repo at `242a170`, HeadlessChrome/151, Node v26.7.0.

**Read the ratio, not the absolute number.** The 13-chunk fixture now costs about what ONE chunk
costs (p50 2,278 ms against a one-sentence synthesis of p50 2,586 ms): first audio no longer waits
for chunk 13, which is exactly FR-024. The two-chunk fixture halves, which is the most streaming can
do when there are only two chunks.

**The absolute numbers on this run are contended and must not be compared with
`m11-gate.md`'s.** Load average was **31** during these runs — other agents were building and
running the full test suite in the same tree. The honest evidence of that is in the table itself:
`component.server.synth`, which measures ONE `say` invocation and which no change of ours touches,
reads p50 **2,022 / 2,586 / 3,689 ms** across the three runs in chronological order, against
**1,138 ms** in `m11-gate.md`. The machine got 2–3× slower while we measured. Any cross-run
comparison of a cold reading on this page is therefore worthless, and the same-machine pair above is
the only comparison this document makes.

**What that leaves for the gate.** First audio is now bounded by ONE sentence of synthesis plus
transport, decode and scheduling, instead of by all of them. `m11-gate.md` predicted the
consequence and it holds: *"even a perfectly streaming first chunk leaves ~860 ms of headroom"* on
the `say` rung at 1,138 ms/sentence. **The gate is now an M9 question — how long one sentence takes
on the default backend — and no longer a Voice Lab question.** Piper is 52–65 ms/sentence
`[measured-here]` (P11) and a warm resident `AVSpeechSynthesizer` is 17.7 ms (SPIKE-1); on either,
this path is comfortably inside 2,000 ms. On a cold `say` spawn on a loaded machine it is not.

Unchanged and still true: the warm path is p50 **39 ms** with **zero** `POST /speak` requests over
20 trials (FR-022), in all three runs.

---

## 1. The wire format, and the two it was chosen against

`POST /speak` answers **NDJSON over one chunked response** — one JSON object per line, flushed the
instant it exists: `head`, then a `chunk` per synthesized chunk, then `end`. The alternatives were
considered on the three properties that actually differ between them.

| | abort | backpressure | error mid-stream |
|---|---|---|---|
| **NDJSON over chunked** (taken) | the transport's own: the page aborts the `fetch`, the socket closes, the server cancels the synthesizer. Stop stays **pushed** | TCP's, honoured by awaiting the socket write before pulling the next record from the generator | a **record**, not a status code — the one thing a single envelope cannot express |
| **SSE** (rejected) | same, but `EventSource` cannot POST, so the options object needs a query string or a second call — a two-call handle by the back door. Its auto-reconnect would **re-speak an utterance the listener already stopped** | same | same |
| **two-call handle + poll** (rejected) | explicit `DELETE`/`/stop`, plus server state with a lifetime | explicit, at the cost of a round trip per chunk against a budget where one sentence costs 1,138–3,689 ms | fine |

SSE's only advantage over NDJSON here is framing we would have to parse by hand anyway, since the
POST body forces `fetch` rather than `EventSource`. The handle+poll design's only advantage is
surviving a dropped connection, which is worth nothing on `127.0.0.1`.

**The HTTP status is still honest.** The response head is deferred until the first chunk actually
synthesizes, so a provider that is genuinely unavailable — or that fails on every chunk — still
answers a real `503` carrying the provider's own words. Once bytes are out the status is spent, and
later trouble is reported in-band. That deferral is the whole reason the head is not written eagerly.

`{ stream: false }` keeps the single envelope. Three callers need it and are named in the source:
FR-026's negative control (the table above), `scripts/ci/voice-lab-ci.mjs`, and the two
envelope-shaped probes inside `bench-lab-gate.mjs`.

---

## 2. One unspeakable chunk (P30, in the channel the listener has)

A chunk that yields no audio no longer 503s the utterance. The chunks that worked are delivered,
the one that did not is named in a `chunk-error` record, and **the loss is spoken**: the server
synthesizes one coalesced sentence with the same voice and rate and appends it to the end of the
stream.

> **"one of three parts could not be spoken and was skipped."**
> (plural: *"three of thirteen parts could not be spoken and were skipped."*)

Written in words, not numerals, because this sentence goes straight to the synthesizer and never
through `normalize()`. Deferred to the end and coalesced, per P30: an announcement that interrupts
is itself a harm. If the announcement cannot be synthesized either, `end.announcementSpoken` is
`false` and the page says it through the banner and the screen-reader channel — a loss is never
silent.

**Unavailable is still unavailable.** `OsSynthUnavailableError` and `LinuxSpeechUnavailableError` are
named as provider-level and abort the request; anything else is chunk-level and survivable; and
zero chunks delivered is a 503 however each individual failure was classified. Three rules, because
one classifier would have been a single point of wrongness.

---

## 3. What changed in the page, and one thing it exposed

The page reads the stream and schedules each chunk as it arrives (`beginSchedule` /
`appendToSchedule` / `finishSchedule`), with `t` never allowed to fall behind the context clock —
otherwise, when synthesis is slower than playback, the backlog would fire at once.

**Streaming made Stop able to land mid-request, and that broke the cache in a way worth recording.**
The first post-fix measurement showed warm replay at p50 3,327 ms with **20 of 20** "warm" trials
issuing a network request — FR-022 violated. Cause: the page committed its chunk-key list only when
the stream ended, and the harness stops 250 ms after first audio, so the prime never completed. It
is a real behaviour, not only a harness artefact: Stop, then Play, is now a cold path.

The fix is not to commit a truncated list — replaying part of an utterance as though it were all of
it is the silent-wrong-answer shape this project keeps finding. Instead the page now publishes
`window.__lab.utterance` (`complete` / `delivered` / `aborted`), which is the machine-readable
record `m11-gate.md` finding **G-5** asked for and recorded as unbuilt, and the harness waits on it
before measuring a warm series or running FR-023's stale-hit probe. FR-023's probe additionally
reports **VIOLATION** when its own prime did not complete, because a probe whose setup silently
failed is a probe that cannot go red.

---

## 4. Still open, deliberately

- **G-2, the stale cache hit,** reproduces in this run (`cachekey.stale-hit`: requests
  `[1, 0, 1]`, prime completed). `state.chunkKeysFor` is keyed by text only, so changing a
  `synthesize.*` control replays the old audio. It is FR-023's own defect, it is not this job's, and
  it is the worst remaining failure in the lab: a control that silently does nothing reads to the
  listener as a taste result.
- **G-6, no free-text input on the page.** Unfixed.
- **The gate itself.** UNMET on the `say` rung on a loaded machine; see section 0 for why that is
  now an M9 question.
- **Windows and Linux.** Unmeasured, as before.
