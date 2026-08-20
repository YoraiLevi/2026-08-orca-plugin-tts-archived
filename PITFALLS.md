# PITFALLS

> Things that bit us, or that we know will bite. Append; newest at top. Each entry:
> **symptom → cause → what to do instead.**
>
> **Numbering:** highest number = newest. Before adding an entry, `grep '^## P' PITFALLS.md` and
> take the next free number — concurrent agents have collided here before (see P12).

## P20 — Speaking on the `done` edge reads the PREVIOUS reply
**Symptom:** reply 2 read reply 1 aloud, reply 3 read reply 2, and the newest reply was never
spoken. Consistently one behind.
**Cause:** two faults compounding.
1. `agent.status.changed` fires on the working→done edge, but the agent CLI flushes its final
   message to the transcript JSONL *after* that. Reading "the newest reply on disk" at `done` gets
   the previous turn.
2. Spoken-reply ids lived in worker memory. ORCA reaps an idle worker after 5 minutes; on re-fork
   the dedup set was empty, so already-spoken replies looked new again.
**Instead:** do not speak on the edge. **Watch the transcript file** (`fs.watch`, 250 ms debounce)
and speak replies when they actually appear, keeping the watch open `WATCH_WINDOW_MS` past the
event. Persist spoken ids to plugin storage, bounded to 300.
**Worth remembering:** an event that means "the turn ended" is not the same as "the text is
readable". Anywhere we react to a state change by reading a file someone else writes, watch the
file — the event only says when to start looking.

## P23 — Tuning speech by ear over a chat loop does not converge
**Symptom:** six rounds of "does this sound better?", each costing a rebuild, a refresh, a reply and
a listen. Feedback arrived after the context had gone, and defaults were still unsettled.
**Cause:** the loop was minutes long and the judgement is subjective. Every normalization question
is taste, and taste needs immediate repetition to settle — hear it, tweak it, hear it again.
**Instead:** build the tuning surface before tuning (`docs/TASKS.md` M11 Voice Lab). Ship the
*mechanism* and let the listener choose the *values*. Do not argue defaults into place over chat.
**Worth remembering:** the same shape applies to anything judged by perception rather than
correctness. If a human must say "better", give them a control and a replay button, not a dialogue.

## P22 — Huddle followed whatever transcript was touched last, and dumped each new session's backlog
**Symptom, reported live:** *"the message you just sent was cut off by another session's reply… it
read many of its replies and not a single one… this is really confusing what it is even reading."*
**Cause:** three faults compounding.
1. Every `agent.status.changed` re-picked the most-recently-modified transcript, so an unrelated
   busy session stole the audio mid-reply.
2. Backlog priming was a single global boolean, not per file. Switching to a new session found it
   "already primed", so every reply in it counted as fresh and the whole history was read out.
3. Queue overflow dropped the OLDEST utterance silently — the reply the user was actually waiting
   for — with no signal.
**Instead:** lock onto ONE session and stay there until explicitly switched; prime per file; label
every utterance with its session; announce switches aloud; tell the user when replies were skipped;
and add a skip control so the wrong thing can always be abandoned.
**Worth remembering:** for assistive tech, "reading something you didn't ask for and can't stop" is
worse than silence. Every autonomous speech path needs an interrupt reachable in one keystroke, and
must say *whose* words these are before speaking them.

## P21 — One speak() mode cannot serve both callers
**Symptom:** with huddle on, a reply arriving mid-utterance truncated the one being read.
**Cause:** `speak()` always began a new generation, which is correct for a hotkey (you asked for
*this* text now) and wrong for huddle (replies must not cut each other off). The mode was never a
decision — it was an accident of having one caller when it was written.
**Instead:** `speak(text, 'replace' | 'queue')`. Hotkey replaces; huddle queues; the queue keeps
the newest and drops the oldest so a fast agent can never block. Documented in the README, because
"what happens if it is already talking" is the first thing a user asks.

## P19 — Plugin chords silently lose to ORCA's built-in shortcuts
**Symptom:** ORCA shows *"⌘⇧I conflicts with Show Ports, Read Aloud: say status"* and the command
never fires. Nothing in the manifest or the build warns you.
**Cause:** a plugin cannot query the host's keybindings, and there is no conflict check at install
time. ORCA's defaults already claim 22 `Mod+Shift+*` chords, `I` among them
(`src/shared/keybindings.ts`).
**Instead:** pick from the free set and pin it in a test.
`packages/plugin/src/manifest/keybindings.test.ts` vendors ORCA's claimed chords (extracted at
commit 0f26ff4a / v1.4.185) and fails CI if we declare one. Re-extract when bumping the supported
ORCA version:
```
grep -oE "'Mod\+Shift\+[A-Za-z0-9]+'" src/shared/keybindings.ts | sort -u
```
Free at that version: `C H K L P Q S U W X Y`. We use `S`, `X`, `H`, `U`.
**Worth remembering:** this is the fourth thing in a row that failed silently because a plugin
cannot see the host's state (manifest schema P16, file containment P17, host API names P18, now
keybindings). Whenever the host holds a list the plugin must agree with, vendor it and test it.

## P18 — Guessed host API names + a defensive adapter = silent no-op
**Symptom:** plugin valid, enabled, shortcuts listed in the consent dialog — and ORCA reports
*"Could not run the plugin command."* The hotkey does nothing at all.
**Cause:** I invented the host API from research notes: `orca.registerCommand`, `orca.onEvent`,
`orca.notify`, `orca.storageGet`, and `activate(ctx)` reading `ctx.orca`. The real API is
`activate(orca)` with `orca.commands.register(id, fn)`, `orca.events.on(name, fn)`,
`orca.host.call('notifications.show' | 'storage.get' | ...)`, `orca.log(msg)`.
**The adapter made it worse.** It wrapped every call in `fn?.bind(o)` with a no-op fallback for
robustness, so *every wrong name degraded silently to success*. Nothing threw. Nothing logged.
Zero commands were registered and the plugin reported itself ready.
**Instead:** `examples/plugins/hello-orca/main.mjs` shows the whole contract in 24 lines and was in
the clone the entire time. Now: `makeHost` counts registrations, `activate()` logs a WARNING if
fewer than 4 land, and `scripts/smoke-activate.mjs` drives the **built artifact** with a fake host
in CI, asserting every manifest-declared command is actually registered.
**Worth remembering:** defensive fallbacks are correct for a *transient* failure and actively
harmful for a *wrong name* — they convert a loud crash into a silent nothing. Unit tests did not
help either: they mocked the same invented shape they were written against. Only running the real
artifact against the real contract catches this.

## P17 — A workspace `node_modules` symlink makes the whole plugin "Invalid"
**Symptom:** the plugin is discovered (`yorailevi.read-aloud`, Dev) but shows **Invalid**, `v0.0.0`,
"No description provided", and *"The plugin manifest or installed files are invalid."* The manifest
itself parses fine against `pluginManifestSchema`.
**Cause:** we pointed ORCA at `packages/plugin`, a pnpm workspace package. It contains
`node_modules/@orca-tts/core -> ../../../core` and `.../providers -> ../../../providers`. ORCA
resolves realpaths and **rejects any artifact escaping the plugin root**
(`plugin-manifest-fields.ts:23-24`: *"realpath containment separately rejects symlink escapes"*).
One escaping symlink invalidates the plugin, and the message does not say which file.
**Instead:** never point ORCA at a source folder. `pnpm build` emits a self-contained artifact to
**`dist/plugin/`** — exactly three files: `orca-plugin.json`, `main.mjs`, `panel.html`. No `src/`,
no `node_modules`, no tsconfig. CI now fails if any symlink appears in the artifact.
**Worth remembering:** "Invalid" covered two completely different faults in a row (P16 manifest
shape, P17 file containment) with the same opaque wording. Bisect by building the smallest possible
artifact and adding back, rather than re-reading the manifest.

## P16 — "Use the OS's built-in voice" is a two-tier trap, not a zero-install win
**Symptom:** macOS sounds fine in the demo, then Windows and Linux users hear something from 2005.
**Cause:** the three OS-native synths are not one tier. macOS `say` reaches decent Apple voices.
Windows third-party apps are fenced to SAPI 5 `*Desktop` (Zira/David) — Microsoft's own WinRT docs
say *"Only Microsoft-signed voices installed on the system can be used"*, and the maintainer of the
911★ project built to break that fence calls his own work *"more like a hack… can stop working at
any time"*. Linux out of the box is `espeak-ng` formant synthesis, and on a headless box or a GitHub
Actions runner there is **no speech stack at all** (`actions/runner-images` has zero references to
`espeak`, `speech`, `alsa` or `pulseaudio`).
**Instead:** one portable neural engine as the default on all platforms; OS-native only as a
labelled fallback. And do not let "but macOS `say` is pretty good" argue for native-first — the same
argument fails identically on the other two. Verified 2026-08-20.

## P20 — Speaking on the `done` edge reads the PREVIOUS reply
**Symptom:** reply 2 read reply 1 aloud, reply 3 read reply 2, and the newest reply was never
spoken. Consistently one behind.
**Cause:** two faults compounding.
1. `agent.status.changed` fires on the working→done edge, but the agent CLI flushes its final
   message to the transcript JSONL *after* that. Reading "the newest reply on disk" at `done` gets
   the previous turn.
2. Spoken-reply ids lived in worker memory. ORCA reaps an idle worker after 5 minutes; on re-fork
   the dedup set was empty, so already-spoken replies looked new again.
**Instead:** do not speak on the edge. **Watch the transcript file** (`fs.watch`, 250 ms debounce)
and speak replies when they actually appear, keeping the watch open `WATCH_WINDOW_MS` past the
event. Persist spoken ids to plugin storage, bounded to 300.
**Worth remembering:** an event that means "the turn ended" is not the same as "the text is
readable". Anywhere we react to a state change by reading a file someone else writes, watch the
file — the event only says when to start looking.

## P23 — Tuning speech by ear over a chat loop does not converge
**Symptom:** six rounds of "does this sound better?", each costing a rebuild, a refresh, a reply and
a listen. Feedback arrived after the context had gone, and defaults were still unsettled.
**Cause:** the loop was minutes long and the judgement is subjective. Every normalization question
is taste, and taste needs immediate repetition to settle — hear it, tweak it, hear it again.
**Instead:** build the tuning surface before tuning (`docs/TASKS.md` M11 Voice Lab). Ship the
*mechanism* and let the listener choose the *values*. Do not argue defaults into place over chat.
**Worth remembering:** the same shape applies to anything judged by perception rather than
correctness. If a human must say "better", give them a control and a replay button, not a dialogue.

## P22 — Huddle followed whatever transcript was touched last, and dumped each new session's backlog
**Symptom, reported live:** *"the message you just sent was cut off by another session's reply… it
read many of its replies and not a single one… this is really confusing what it is even reading."*
**Cause:** three faults compounding.
1. Every `agent.status.changed` re-picked the most-recently-modified transcript, so an unrelated
   busy session stole the audio mid-reply.
2. Backlog priming was a single global boolean, not per file. Switching to a new session found it
   "already primed", so every reply in it counted as fresh and the whole history was read out.
3. Queue overflow dropped the OLDEST utterance silently — the reply the user was actually waiting
   for — with no signal.
**Instead:** lock onto ONE session and stay there until explicitly switched; prime per file; label
every utterance with its session; announce switches aloud; tell the user when replies were skipped;
and add a skip control so the wrong thing can always be abandoned.
**Worth remembering:** for assistive tech, "reading something you didn't ask for and can't stop" is
worse than silence. Every autonomous speech path needs an interrupt reachable in one keystroke, and
must say *whose* words these are before speaking them.

## P21 — One speak() mode cannot serve both callers
**Symptom:** with huddle on, a reply arriving mid-utterance truncated the one being read.
**Cause:** `speak()` always began a new generation, which is correct for a hotkey (you asked for
*this* text now) and wrong for huddle (replies must not cut each other off). The mode was never a
decision — it was an accident of having one caller when it was written.
**Instead:** `speak(text, 'replace' | 'queue')`. Hotkey replaces; huddle queues; the queue keeps
the newest and drops the oldest so a fast agent can never block. Documented in the README, because
"what happens if it is already talking" is the first thing a user asks.

## P19 — Plugin chords silently lose to ORCA's built-in shortcuts
**Symptom:** ORCA shows *"⌘⇧I conflicts with Show Ports, Read Aloud: say status"* and the command
never fires. Nothing in the manifest or the build warns you.
**Cause:** a plugin cannot query the host's keybindings, and there is no conflict check at install
time. ORCA's defaults already claim 22 `Mod+Shift+*` chords, `I` among them
(`src/shared/keybindings.ts`).
**Instead:** pick from the free set and pin it in a test.
`packages/plugin/src/manifest/keybindings.test.ts` vendors ORCA's claimed chords (extracted at
commit 0f26ff4a / v1.4.185) and fails CI if we declare one. Re-extract when bumping the supported
ORCA version:
```
grep -oE "'Mod\+Shift\+[A-Za-z0-9]+'" src/shared/keybindings.ts | sort -u
```
Free at that version: `C H K L P Q S U W X Y`. We use `S`, `X`, `H`, `U`.
**Worth remembering:** this is the fourth thing in a row that failed silently because a plugin
cannot see the host's state (manifest schema P16, file containment P17, host API names P18, now
keybindings). Whenever the host holds a list the plugin must agree with, vendor it and test it.

## P18 — Guessed host API names + a defensive adapter = silent no-op
**Symptom:** plugin valid, enabled, shortcuts listed in the consent dialog — and ORCA reports
*"Could not run the plugin command."* The hotkey does nothing at all.
**Cause:** I invented the host API from research notes: `orca.registerCommand`, `orca.onEvent`,
`orca.notify`, `orca.storageGet`, and `activate(ctx)` reading `ctx.orca`. The real API is
`activate(orca)` with `orca.commands.register(id, fn)`, `orca.events.on(name, fn)`,
`orca.host.call('notifications.show' | 'storage.get' | ...)`, `orca.log(msg)`.
**The adapter made it worse.** It wrapped every call in `fn?.bind(o)` with a no-op fallback for
robustness, so *every wrong name degraded silently to success*. Nothing threw. Nothing logged.
Zero commands were registered and the plugin reported itself ready.
**Instead:** `examples/plugins/hello-orca/main.mjs` shows the whole contract in 24 lines and was in
the clone the entire time. Now: `makeHost` counts registrations, `activate()` logs a WARNING if
fewer than 4 land, and `scripts/smoke-activate.mjs` drives the **built artifact** with a fake host
in CI, asserting every manifest-declared command is actually registered.
**Worth remembering:** defensive fallbacks are correct for a *transient* failure and actively
harmful for a *wrong name* — they convert a loud crash into a silent nothing. Unit tests did not
help either: they mocked the same invented shape they were written against. Only running the real
artifact against the real contract catches this.

## P17 — A workspace `node_modules` symlink makes the whole plugin "Invalid"
**Symptom:** the plugin is discovered (`yorailevi.read-aloud`, Dev) but shows **Invalid**, `v0.0.0`,
"No description provided", and *"The plugin manifest or installed files are invalid."* The manifest
itself parses fine against `pluginManifestSchema`.
**Cause:** we pointed ORCA at `packages/plugin`, a pnpm workspace package. It contains
`node_modules/@orca-tts/core -> ../../../core` and `.../providers -> ../../../providers`. ORCA
resolves realpaths and **rejects any artifact escaping the plugin root**
(`plugin-manifest-fields.ts:23-24`: *"realpath containment separately rejects symlink escapes"*).
One escaping symlink invalidates the plugin, and the message does not say which file.
**Instead:** never point ORCA at a source folder. `pnpm build` emits a self-contained artifact to
**`dist/plugin/`** — exactly three files: `orca-plugin.json`, `main.mjs`, `panel.html`. No `src/`,
no `node_modules`, no tsconfig. CI now fails if any symlink appears in the artifact.
**Worth remembering:** "Invalid" covered two completely different faults in a row (P16 manifest
shape, P17 file containment) with the same opaque wording. Bisect by building the smallest possible
artifact and adding back, rather than re-reading the manifest.

## P16 — An invalid manifest fails SILENTLY: no plugin, no consent prompt, no error
**Symptom:** added the dev plugin path in Settings, the "Installed" count went up, but no card
appeared, no consent prompt fired, and nothing said why.
**Cause:** our `orca-plugin.json` did not satisfy `pluginManifestSchema`. Three faults:
- `capabilities` were bare strings; the schema is `z.object({ kind: ... }).strict()`
- `engines: { orca: ">=x.y.z" }` missing — **required**, not optional
- `pluginApi: 1` missing — **required**
Also missing `contributes.events`, without which `agent.status.changed` never arrives even with the
`events:subscribe` capability granted.
**Instead:** validate the manifest against the host's own parser before trusting it:
```
npx tsx validate-manifest.mts /path/to/orca-plugin.json   # imports pluginManifestSchema from the orca clone
```
`packages/plugin/src/manifest/manifest.test.ts` now pins the shape in CI so this cannot regress.
**Worth remembering:** I wrote that manifest from research notes and never parsed it. Reading the
schema is not the same as running it — the canonical example at `examples/plugins/hello-orca/` was
sitting right there and would have shown every one of these in ten seconds.

## P15 — Bare Piper `.onnx` files from Hugging Face do not work with sherpa-onnx
**Symptom:** `'sample_rate' does not exist in the metadata` at model load.
**Cause:** `rhasspy/piper-voices` serves `.onnx`/`.onnx.json` directly over HTTP 200, which looks
like a clean archive-free download path. But sherpa's own `tts-models` release tarballs embed extra
ONNX metadata *and* a `tokens.txt` the HF files do not carry.
**Instead:** download sherpa's release assets, or convert and re-host the models yourself. Verified
2026-08-20.

## P20 — Speaking on the `done` edge reads the PREVIOUS reply
**Symptom:** reply 2 read reply 1 aloud, reply 3 read reply 2, and the newest reply was never
spoken. Consistently one behind.
**Cause:** two faults compounding.
1. `agent.status.changed` fires on the working→done edge, but the agent CLI flushes its final
   message to the transcript JSONL *after* that. Reading "the newest reply on disk" at `done` gets
   the previous turn.
2. Spoken-reply ids lived in worker memory. ORCA reaps an idle worker after 5 minutes; on re-fork
   the dedup set was empty, so already-spoken replies looked new again.
**Instead:** do not speak on the edge. **Watch the transcript file** (`fs.watch`, 250 ms debounce)
and speak replies when they actually appear, keeping the watch open `WATCH_WINDOW_MS` past the
event. Persist spoken ids to plugin storage, bounded to 300.
**Worth remembering:** an event that means "the turn ended" is not the same as "the text is
readable". Anywhere we react to a state change by reading a file someone else writes, watch the
file — the event only says when to start looking.

## P23 — Tuning speech by ear over a chat loop does not converge
**Symptom:** six rounds of "does this sound better?", each costing a rebuild, a refresh, a reply and
a listen. Feedback arrived after the context had gone, and defaults were still unsettled.
**Cause:** the loop was minutes long and the judgement is subjective. Every normalization question
is taste, and taste needs immediate repetition to settle — hear it, tweak it, hear it again.
**Instead:** build the tuning surface before tuning (`docs/TASKS.md` M11 Voice Lab). Ship the
*mechanism* and let the listener choose the *values*. Do not argue defaults into place over chat.
**Worth remembering:** the same shape applies to anything judged by perception rather than
correctness. If a human must say "better", give them a control and a replay button, not a dialogue.

## P22 — Huddle followed whatever transcript was touched last, and dumped each new session's backlog
**Symptom, reported live:** *"the message you just sent was cut off by another session's reply… it
read many of its replies and not a single one… this is really confusing what it is even reading."*
**Cause:** three faults compounding.
1. Every `agent.status.changed` re-picked the most-recently-modified transcript, so an unrelated
   busy session stole the audio mid-reply.
2. Backlog priming was a single global boolean, not per file. Switching to a new session found it
   "already primed", so every reply in it counted as fresh and the whole history was read out.
3. Queue overflow dropped the OLDEST utterance silently — the reply the user was actually waiting
   for — with no signal.
**Instead:** lock onto ONE session and stay there until explicitly switched; prime per file; label
every utterance with its session; announce switches aloud; tell the user when replies were skipped;
and add a skip control so the wrong thing can always be abandoned.
**Worth remembering:** for assistive tech, "reading something you didn't ask for and can't stop" is
worse than silence. Every autonomous speech path needs an interrupt reachable in one keystroke, and
must say *whose* words these are before speaking them.

## P21 — One speak() mode cannot serve both callers
**Symptom:** with huddle on, a reply arriving mid-utterance truncated the one being read.
**Cause:** `speak()` always began a new generation, which is correct for a hotkey (you asked for
*this* text now) and wrong for huddle (replies must not cut each other off). The mode was never a
decision — it was an accident of having one caller when it was written.
**Instead:** `speak(text, 'replace' | 'queue')`. Hotkey replaces; huddle queues; the queue keeps
the newest and drops the oldest so a fast agent can never block. Documented in the README, because
"what happens if it is already talking" is the first thing a user asks.

## P19 — Plugin chords silently lose to ORCA's built-in shortcuts
**Symptom:** ORCA shows *"⌘⇧I conflicts with Show Ports, Read Aloud: say status"* and the command
never fires. Nothing in the manifest or the build warns you.
**Cause:** a plugin cannot query the host's keybindings, and there is no conflict check at install
time. ORCA's defaults already claim 22 `Mod+Shift+*` chords, `I` among them
(`src/shared/keybindings.ts`).
**Instead:** pick from the free set and pin it in a test.
`packages/plugin/src/manifest/keybindings.test.ts` vendors ORCA's claimed chords (extracted at
commit 0f26ff4a / v1.4.185) and fails CI if we declare one. Re-extract when bumping the supported
ORCA version:
```
grep -oE "'Mod\+Shift\+[A-Za-z0-9]+'" src/shared/keybindings.ts | sort -u
```
Free at that version: `C H K L P Q S U W X Y`. We use `S`, `X`, `H`, `U`.
**Worth remembering:** this is the fourth thing in a row that failed silently because a plugin
cannot see the host's state (manifest schema P16, file containment P17, host API names P18, now
keybindings). Whenever the host holds a list the plugin must agree with, vendor it and test it.

## P18 — Guessed host API names + a defensive adapter = silent no-op
**Symptom:** plugin valid, enabled, shortcuts listed in the consent dialog — and ORCA reports
*"Could not run the plugin command."* The hotkey does nothing at all.
**Cause:** I invented the host API from research notes: `orca.registerCommand`, `orca.onEvent`,
`orca.notify`, `orca.storageGet`, and `activate(ctx)` reading `ctx.orca`. The real API is
`activate(orca)` with `orca.commands.register(id, fn)`, `orca.events.on(name, fn)`,
`orca.host.call('notifications.show' | 'storage.get' | ...)`, `orca.log(msg)`.
**The adapter made it worse.** It wrapped every call in `fn?.bind(o)` with a no-op fallback for
robustness, so *every wrong name degraded silently to success*. Nothing threw. Nothing logged.
Zero commands were registered and the plugin reported itself ready.
**Instead:** `examples/plugins/hello-orca/main.mjs` shows the whole contract in 24 lines and was in
the clone the entire time. Now: `makeHost` counts registrations, `activate()` logs a WARNING if
fewer than 4 land, and `scripts/smoke-activate.mjs` drives the **built artifact** with a fake host
in CI, asserting every manifest-declared command is actually registered.
**Worth remembering:** defensive fallbacks are correct for a *transient* failure and actively
harmful for a *wrong name* — they convert a loud crash into a silent nothing. Unit tests did not
help either: they mocked the same invented shape they were written against. Only running the real
artifact against the real contract catches this.

## P17 — A workspace `node_modules` symlink makes the whole plugin "Invalid"
**Symptom:** the plugin is discovered (`yorailevi.read-aloud`, Dev) but shows **Invalid**, `v0.0.0`,
"No description provided", and *"The plugin manifest or installed files are invalid."* The manifest
itself parses fine against `pluginManifestSchema`.
**Cause:** we pointed ORCA at `packages/plugin`, a pnpm workspace package. It contains
`node_modules/@orca-tts/core -> ../../../core` and `.../providers -> ../../../providers`. ORCA
resolves realpaths and **rejects any artifact escaping the plugin root**
(`plugin-manifest-fields.ts:23-24`: *"realpath containment separately rejects symlink escapes"*).
One escaping symlink invalidates the plugin, and the message does not say which file.
**Instead:** never point ORCA at a source folder. `pnpm build` emits a self-contained artifact to
**`dist/plugin/`** — exactly three files: `orca-plugin.json`, `main.mjs`, `panel.html`. No `src/`,
no `node_modules`, no tsconfig. CI now fails if any symlink appears in the artifact.
**Worth remembering:** "Invalid" covered two completely different faults in a row (P16 manifest
shape, P17 file containment) with the same opaque wording. Bisect by building the smallest possible
artifact and adding back, rather than re-reading the manifest.

## P16 — An invalid manifest fails SILENTLY: no plugin, no consent prompt, no error
**Symptom:** added the dev plugin path in Settings, the "Installed" count went up, but no card
appeared, no consent prompt fired, and nothing said why.
**Cause:** our `orca-plugin.json` did not satisfy `pluginManifestSchema`. Three faults:
- `capabilities` were bare strings; the schema is `z.object({ kind: ... }).strict()`
- `engines: { orca: ">=x.y.z" }` missing — **required**, not optional
- `pluginApi: 1` missing — **required**
Also missing `contributes.events`, without which `agent.status.changed` never arrives even with the
`events:subscribe` capability granted.
**Instead:** validate the manifest against the host's own parser before trusting it:
```
npx tsx validate-manifest.mts /path/to/orca-plugin.json   # imports pluginManifestSchema from the orca clone
```
`packages/plugin/src/manifest/manifest.test.ts` now pins the shape in CI so this cannot regress.
**Worth remembering:** I wrote that manifest from research notes and never parsed it. Reading the
schema is not the same as running it — the canonical example at `examples/plugins/hello-orca/` was
sitting right there and would have shown every one of these in ten seconds.

## P15 — An unmatched emphasis marker was stripped, mangling `_private` identifiers
**Symptom:** running the pipeline for real, `_flush_buffer()` was spoken as "flush_buffer()".
Not caught by 106 passing tests, because every test case used *matched* markers.
**Cause:** the marker stripper decided "is this an opener?" and "is this a closer?" independently,
so a lone leading `_` looked like an opener and was dropped with no partner. Python privates are
everywhere in agent replies.
**Instead:** markers are now stripped only as a MATCHED PAIR within one line. Five regression cases
cover leading, trailing, and unmatched markers.
**Worth remembering:** the test suite was table-driven and thorough, and still only tested the
shapes I thought of. Running the actual thing and listening found it in one pass. Exercise the real
pipeline, not only its units.

## P14 — Node cannot decompress bzip2, and sherpa ships models as `.tar.bz2`
**Symptom:** first-run model download works on macOS/Linux (shell out to `tar xj`) and dies on Windows.
**Cause:** Node 26's `zlib` exposes gzip, brotli and zstd — **no bzip2**. `tar` with bz2 support is
not guaranteed on Windows.
**Instead:** pure-JS `unbzip2-stream` (1.4.3, `gypfile: false`) piped into `tar-stream`. Verified:
397 entries / 81 MB decoded in 4.7 s with no native build. Or re-host the models as `.tar.gz`.

## P20 — Speaking on the `done` edge reads the PREVIOUS reply
**Symptom:** reply 2 read reply 1 aloud, reply 3 read reply 2, and the newest reply was never
spoken. Consistently one behind.
**Cause:** two faults compounding.
1. `agent.status.changed` fires on the working→done edge, but the agent CLI flushes its final
   message to the transcript JSONL *after* that. Reading "the newest reply on disk" at `done` gets
   the previous turn.
2. Spoken-reply ids lived in worker memory. ORCA reaps an idle worker after 5 minutes; on re-fork
   the dedup set was empty, so already-spoken replies looked new again.
**Instead:** do not speak on the edge. **Watch the transcript file** (`fs.watch`, 250 ms debounce)
and speak replies when they actually appear, keeping the watch open `WATCH_WINDOW_MS` past the
event. Persist spoken ids to plugin storage, bounded to 300.
**Worth remembering:** an event that means "the turn ended" is not the same as "the text is
readable". Anywhere we react to a state change by reading a file someone else writes, watch the
file — the event only says when to start looking.

## P23 — Tuning speech by ear over a chat loop does not converge
**Symptom:** six rounds of "does this sound better?", each costing a rebuild, a refresh, a reply and
a listen. Feedback arrived after the context had gone, and defaults were still unsettled.
**Cause:** the loop was minutes long and the judgement is subjective. Every normalization question
is taste, and taste needs immediate repetition to settle — hear it, tweak it, hear it again.
**Instead:** build the tuning surface before tuning (`docs/TASKS.md` M11 Voice Lab). Ship the
*mechanism* and let the listener choose the *values*. Do not argue defaults into place over chat.
**Worth remembering:** the same shape applies to anything judged by perception rather than
correctness. If a human must say "better", give them a control and a replay button, not a dialogue.

## P22 — Huddle followed whatever transcript was touched last, and dumped each new session's backlog
**Symptom, reported live:** *"the message you just sent was cut off by another session's reply… it
read many of its replies and not a single one… this is really confusing what it is even reading."*
**Cause:** three faults compounding.
1. Every `agent.status.changed` re-picked the most-recently-modified transcript, so an unrelated
   busy session stole the audio mid-reply.
2. Backlog priming was a single global boolean, not per file. Switching to a new session found it
   "already primed", so every reply in it counted as fresh and the whole history was read out.
3. Queue overflow dropped the OLDEST utterance silently — the reply the user was actually waiting
   for — with no signal.
**Instead:** lock onto ONE session and stay there until explicitly switched; prime per file; label
every utterance with its session; announce switches aloud; tell the user when replies were skipped;
and add a skip control so the wrong thing can always be abandoned.
**Worth remembering:** for assistive tech, "reading something you didn't ask for and can't stop" is
worse than silence. Every autonomous speech path needs an interrupt reachable in one keystroke, and
must say *whose* words these are before speaking them.

## P21 — One speak() mode cannot serve both callers
**Symptom:** with huddle on, a reply arriving mid-utterance truncated the one being read.
**Cause:** `speak()` always began a new generation, which is correct for a hotkey (you asked for
*this* text now) and wrong for huddle (replies must not cut each other off). The mode was never a
decision — it was an accident of having one caller when it was written.
**Instead:** `speak(text, 'replace' | 'queue')`. Hotkey replaces; huddle queues; the queue keeps
the newest and drops the oldest so a fast agent can never block. Documented in the README, because
"what happens if it is already talking" is the first thing a user asks.

## P19 — Plugin chords silently lose to ORCA's built-in shortcuts
**Symptom:** ORCA shows *"⌘⇧I conflicts with Show Ports, Read Aloud: say status"* and the command
never fires. Nothing in the manifest or the build warns you.
**Cause:** a plugin cannot query the host's keybindings, and there is no conflict check at install
time. ORCA's defaults already claim 22 `Mod+Shift+*` chords, `I` among them
(`src/shared/keybindings.ts`).
**Instead:** pick from the free set and pin it in a test.
`packages/plugin/src/manifest/keybindings.test.ts` vendors ORCA's claimed chords (extracted at
commit 0f26ff4a / v1.4.185) and fails CI if we declare one. Re-extract when bumping the supported
ORCA version:
```
grep -oE "'Mod\+Shift\+[A-Za-z0-9]+'" src/shared/keybindings.ts | sort -u
```
Free at that version: `C H K L P Q S U W X Y`. We use `S`, `X`, `H`, `U`.
**Worth remembering:** this is the fourth thing in a row that failed silently because a plugin
cannot see the host's state (manifest schema P16, file containment P17, host API names P18, now
keybindings). Whenever the host holds a list the plugin must agree with, vendor it and test it.

## P18 — Guessed host API names + a defensive adapter = silent no-op
**Symptom:** plugin valid, enabled, shortcuts listed in the consent dialog — and ORCA reports
*"Could not run the plugin command."* The hotkey does nothing at all.
**Cause:** I invented the host API from research notes: `orca.registerCommand`, `orca.onEvent`,
`orca.notify`, `orca.storageGet`, and `activate(ctx)` reading `ctx.orca`. The real API is
`activate(orca)` with `orca.commands.register(id, fn)`, `orca.events.on(name, fn)`,
`orca.host.call('notifications.show' | 'storage.get' | ...)`, `orca.log(msg)`.
**The adapter made it worse.** It wrapped every call in `fn?.bind(o)` with a no-op fallback for
robustness, so *every wrong name degraded silently to success*. Nothing threw. Nothing logged.
Zero commands were registered and the plugin reported itself ready.
**Instead:** `examples/plugins/hello-orca/main.mjs` shows the whole contract in 24 lines and was in
the clone the entire time. Now: `makeHost` counts registrations, `activate()` logs a WARNING if
fewer than 4 land, and `scripts/smoke-activate.mjs` drives the **built artifact** with a fake host
in CI, asserting every manifest-declared command is actually registered.
**Worth remembering:** defensive fallbacks are correct for a *transient* failure and actively
harmful for a *wrong name* — they convert a loud crash into a silent nothing. Unit tests did not
help either: they mocked the same invented shape they were written against. Only running the real
artifact against the real contract catches this.

## P17 — A workspace `node_modules` symlink makes the whole plugin "Invalid"
**Symptom:** the plugin is discovered (`yorailevi.read-aloud`, Dev) but shows **Invalid**, `v0.0.0`,
"No description provided", and *"The plugin manifest or installed files are invalid."* The manifest
itself parses fine against `pluginManifestSchema`.
**Cause:** we pointed ORCA at `packages/plugin`, a pnpm workspace package. It contains
`node_modules/@orca-tts/core -> ../../../core` and `.../providers -> ../../../providers`. ORCA
resolves realpaths and **rejects any artifact escaping the plugin root**
(`plugin-manifest-fields.ts:23-24`: *"realpath containment separately rejects symlink escapes"*).
One escaping symlink invalidates the plugin, and the message does not say which file.
**Instead:** never point ORCA at a source folder. `pnpm build` emits a self-contained artifact to
**`dist/plugin/`** — exactly three files: `orca-plugin.json`, `main.mjs`, `panel.html`. No `src/`,
no `node_modules`, no tsconfig. CI now fails if any symlink appears in the artifact.
**Worth remembering:** "Invalid" covered two completely different faults in a row (P16 manifest
shape, P17 file containment) with the same opaque wording. Bisect by building the smallest possible
artifact and adding back, rather than re-reading the manifest.

## P16 — An invalid manifest fails SILENTLY: no plugin, no consent prompt, no error
**Symptom:** added the dev plugin path in Settings, the "Installed" count went up, but no card
appeared, no consent prompt fired, and nothing said why.
**Cause:** our `orca-plugin.json` did not satisfy `pluginManifestSchema`. Three faults:
- `capabilities` were bare strings; the schema is `z.object({ kind: ... }).strict()`
- `engines: { orca: ">=x.y.z" }` missing — **required**, not optional
- `pluginApi: 1` missing — **required**
Also missing `contributes.events`, without which `agent.status.changed` never arrives even with the
`events:subscribe` capability granted.
**Instead:** validate the manifest against the host's own parser before trusting it:
```
npx tsx validate-manifest.mts /path/to/orca-plugin.json   # imports pluginManifestSchema from the orca clone
```
`packages/plugin/src/manifest/manifest.test.ts` now pins the shape in CI so this cannot regress.
**Worth remembering:** I wrote that manifest from research notes and never parsed it. Reading the
schema is not the same as running it — the canonical example at `examples/plugins/hello-orca/` was
sitting right there and would have shown every one of these in ten seconds.

## P15 — An unmatched emphasis marker was stripped, mangling `_private` identifiers
**Symptom:** running the pipeline for real, `_flush_buffer()` was spoken as "flush_buffer()".
Not caught by 106 passing tests, because every test case used *matched* markers.
**Cause:** the marker stripper decided "is this an opener?" and "is this a closer?" independently,
so a lone leading `_` looked like an opener and was dropped with no partner. Python privates are
everywhere in agent replies.
**Instead:** markers are now stripped only as a MATCHED PAIR within one line. Five regression cases
cover leading, trailing, and unmatched markers.
**Worth remembering:** the test suite was table-driven and thorough, and still only tested the
shapes I thought of. Running the actual thing and listening found it in one pass. Exercise the real
pipeline, not only its units.

## P14 — Windows PowerShell helpers hang instead of failing, and nothing had a deadline
**Symptom:** CI green on macOS and Ubuntu, `windows-latest` times out on both the clipboard read and
the OS-synth contract. Locally everything passed — the Windows path had never executed anywhere.
**Cause:** two compounding faults.
1. `Get-Clipboard` drives the Windows clipboard COM API, which **requires single-threaded apartment
   mode**. Without `-STA`, PowerShell 5.1 can block indefinitely rather than erroring.
2. More seriously: **not one spawned process in the codebase had a timeout.** A helper that never
   exits would have hung the plugin worker forever on a real user's machine, with no error and no
   audio — the exact "fails silently" failure principle I forbids.
**Instead:** every `spawn` now carries a hard deadline that kills the child and rejects
(`DEFAULT_SPAWN_TIMEOUT_MS`, `DEFAULT_CLIPBOARD_TIMEOUT_MS`), and all PowerShell invocations pass
`-STA -NoProfile -NonInteractive`. A test with a 1 ms deadline exercises the timeout path on every
platform, so this cannot regress unnoticed.
**Worth remembering:** this is the value of CI on all three OSes. A hang-forever bug in the default
path was invisible to 105 passing local tests, because the platform that triggers it was never run.

## P13 — `sherpa-onnx-win-arm64` is missing from **npm**, but upstream does build it
**Symptom:** you conclude Windows-on-ARM is unsupported and design a fallback you don't need.
**Cause:** npm at 1.13.6 ships `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win-x64`
and `win-ia32` — nothing for win-arm64. (Note the naming: `win-x64`, **not** `win32-x64`.) ORCA's
own STT hit this and hardcoded Windows to x64 (`stt-service.ts:556-577`, and see P7).
**Instead:** the GitHub release **does** carry
`sherpa-onnx-v1.13.6-win-arm64-shared-MD-Release.tar.bz2`. Since an ORCA plugin gets no
`npm install` anyway (P5) and must fetch binaries itself, **source from GitHub releases, not npm** —
then all six platform+arch combos are covered. Those tarballs also contain standalone executables
(`bin/sherpa-onnx-offline-tts`, 2.1 MB), which the npm packages do not. Verified 2026-08-20.

## P20 — Speaking on the `done` edge reads the PREVIOUS reply
**Symptom:** reply 2 read reply 1 aloud, reply 3 read reply 2, and the newest reply was never
spoken. Consistently one behind.
**Cause:** two faults compounding.
1. `agent.status.changed` fires on the working→done edge, but the agent CLI flushes its final
   message to the transcript JSONL *after* that. Reading "the newest reply on disk" at `done` gets
   the previous turn.
2. Spoken-reply ids lived in worker memory. ORCA reaps an idle worker after 5 minutes; on re-fork
   the dedup set was empty, so already-spoken replies looked new again.
**Instead:** do not speak on the edge. **Watch the transcript file** (`fs.watch`, 250 ms debounce)
and speak replies when they actually appear, keeping the watch open `WATCH_WINDOW_MS` past the
event. Persist spoken ids to plugin storage, bounded to 300.
**Worth remembering:** an event that means "the turn ended" is not the same as "the text is
readable". Anywhere we react to a state change by reading a file someone else writes, watch the
file — the event only says when to start looking.

## P23 — Tuning speech by ear over a chat loop does not converge
**Symptom:** six rounds of "does this sound better?", each costing a rebuild, a refresh, a reply and
a listen. Feedback arrived after the context had gone, and defaults were still unsettled.
**Cause:** the loop was minutes long and the judgement is subjective. Every normalization question
is taste, and taste needs immediate repetition to settle — hear it, tweak it, hear it again.
**Instead:** build the tuning surface before tuning (`docs/TASKS.md` M11 Voice Lab). Ship the
*mechanism* and let the listener choose the *values*. Do not argue defaults into place over chat.
**Worth remembering:** the same shape applies to anything judged by perception rather than
correctness. If a human must say "better", give them a control and a replay button, not a dialogue.

## P22 — Huddle followed whatever transcript was touched last, and dumped each new session's backlog
**Symptom, reported live:** *"the message you just sent was cut off by another session's reply… it
read many of its replies and not a single one… this is really confusing what it is even reading."*
**Cause:** three faults compounding.
1. Every `agent.status.changed` re-picked the most-recently-modified transcript, so an unrelated
   busy session stole the audio mid-reply.
2. Backlog priming was a single global boolean, not per file. Switching to a new session found it
   "already primed", so every reply in it counted as fresh and the whole history was read out.
3. Queue overflow dropped the OLDEST utterance silently — the reply the user was actually waiting
   for — with no signal.
**Instead:** lock onto ONE session and stay there until explicitly switched; prime per file; label
every utterance with its session; announce switches aloud; tell the user when replies were skipped;
and add a skip control so the wrong thing can always be abandoned.
**Worth remembering:** for assistive tech, "reading something you didn't ask for and can't stop" is
worse than silence. Every autonomous speech path needs an interrupt reachable in one keystroke, and
must say *whose* words these are before speaking them.

## P21 — One speak() mode cannot serve both callers
**Symptom:** with huddle on, a reply arriving mid-utterance truncated the one being read.
**Cause:** `speak()` always began a new generation, which is correct for a hotkey (you asked for
*this* text now) and wrong for huddle (replies must not cut each other off). The mode was never a
decision — it was an accident of having one caller when it was written.
**Instead:** `speak(text, 'replace' | 'queue')`. Hotkey replaces; huddle queues; the queue keeps
the newest and drops the oldest so a fast agent can never block. Documented in the README, because
"what happens if it is already talking" is the first thing a user asks.

## P19 — Plugin chords silently lose to ORCA's built-in shortcuts
**Symptom:** ORCA shows *"⌘⇧I conflicts with Show Ports, Read Aloud: say status"* and the command
never fires. Nothing in the manifest or the build warns you.
**Cause:** a plugin cannot query the host's keybindings, and there is no conflict check at install
time. ORCA's defaults already claim 22 `Mod+Shift+*` chords, `I` among them
(`src/shared/keybindings.ts`).
**Instead:** pick from the free set and pin it in a test.
`packages/plugin/src/manifest/keybindings.test.ts` vendors ORCA's claimed chords (extracted at
commit 0f26ff4a / v1.4.185) and fails CI if we declare one. Re-extract when bumping the supported
ORCA version:
```
grep -oE "'Mod\+Shift\+[A-Za-z0-9]+'" src/shared/keybindings.ts | sort -u
```
Free at that version: `C H K L P Q S U W X Y`. We use `S`, `X`, `H`, `U`.
**Worth remembering:** this is the fourth thing in a row that failed silently because a plugin
cannot see the host's state (manifest schema P16, file containment P17, host API names P18, now
keybindings). Whenever the host holds a list the plugin must agree with, vendor it and test it.

## P18 — Guessed host API names + a defensive adapter = silent no-op
**Symptom:** plugin valid, enabled, shortcuts listed in the consent dialog — and ORCA reports
*"Could not run the plugin command."* The hotkey does nothing at all.
**Cause:** I invented the host API from research notes: `orca.registerCommand`, `orca.onEvent`,
`orca.notify`, `orca.storageGet`, and `activate(ctx)` reading `ctx.orca`. The real API is
`activate(orca)` with `orca.commands.register(id, fn)`, `orca.events.on(name, fn)`,
`orca.host.call('notifications.show' | 'storage.get' | ...)`, `orca.log(msg)`.
**The adapter made it worse.** It wrapped every call in `fn?.bind(o)` with a no-op fallback for
robustness, so *every wrong name degraded silently to success*. Nothing threw. Nothing logged.
Zero commands were registered and the plugin reported itself ready.
**Instead:** `examples/plugins/hello-orca/main.mjs` shows the whole contract in 24 lines and was in
the clone the entire time. Now: `makeHost` counts registrations, `activate()` logs a WARNING if
fewer than 4 land, and `scripts/smoke-activate.mjs` drives the **built artifact** with a fake host
in CI, asserting every manifest-declared command is actually registered.
**Worth remembering:** defensive fallbacks are correct for a *transient* failure and actively
harmful for a *wrong name* — they convert a loud crash into a silent nothing. Unit tests did not
help either: they mocked the same invented shape they were written against. Only running the real
artifact against the real contract catches this.

## P17 — A workspace `node_modules` symlink makes the whole plugin "Invalid"
**Symptom:** the plugin is discovered (`yorailevi.read-aloud`, Dev) but shows **Invalid**, `v0.0.0`,
"No description provided", and *"The plugin manifest or installed files are invalid."* The manifest
itself parses fine against `pluginManifestSchema`.
**Cause:** we pointed ORCA at `packages/plugin`, a pnpm workspace package. It contains
`node_modules/@orca-tts/core -> ../../../core` and `.../providers -> ../../../providers`. ORCA
resolves realpaths and **rejects any artifact escaping the plugin root**
(`plugin-manifest-fields.ts:23-24`: *"realpath containment separately rejects symlink escapes"*).
One escaping symlink invalidates the plugin, and the message does not say which file.
**Instead:** never point ORCA at a source folder. `pnpm build` emits a self-contained artifact to
**`dist/plugin/`** — exactly three files: `orca-plugin.json`, `main.mjs`, `panel.html`. No `src/`,
no `node_modules`, no tsconfig. CI now fails if any symlink appears in the artifact.
**Worth remembering:** "Invalid" covered two completely different faults in a row (P16 manifest
shape, P17 file containment) with the same opaque wording. Bisect by building the smallest possible
artifact and adding back, rather than re-reading the manifest.

## P16 — An invalid manifest fails SILENTLY: no plugin, no consent prompt, no error
**Symptom:** added the dev plugin path in Settings, the "Installed" count went up, but no card
appeared, no consent prompt fired, and nothing said why.
**Cause:** our `orca-plugin.json` did not satisfy `pluginManifestSchema`. Three faults:
- `capabilities` were bare strings; the schema is `z.object({ kind: ... }).strict()`
- `engines: { orca: ">=x.y.z" }` missing — **required**, not optional
- `pluginApi: 1` missing — **required**
Also missing `contributes.events`, without which `agent.status.changed` never arrives even with the
`events:subscribe` capability granted.
**Instead:** validate the manifest against the host's own parser before trusting it:
```
npx tsx validate-manifest.mts /path/to/orca-plugin.json   # imports pluginManifestSchema from the orca clone
```
`packages/plugin/src/manifest/manifest.test.ts` now pins the shape in CI so this cannot regress.
**Worth remembering:** I wrote that manifest from research notes and never parsed it. Reading the
schema is not the same as running it — the canonical example at `examples/plugins/hello-orca/` was
sitting right there and would have shown every one of these in ten seconds.

## P15 — An unmatched emphasis marker was stripped, mangling `_private` identifiers
**Symptom:** running the pipeline for real, `_flush_buffer()` was spoken as "flush_buffer()".
Not caught by 106 passing tests, because every test case used *matched* markers.
**Cause:** the marker stripper decided "is this an opener?" and "is this a closer?" independently,
so a lone leading `_` looked like an opener and was dropped with no partner. Python privates are
everywhere in agent replies.
**Instead:** markers are now stripped only as a MATCHED PAIR within one line. Five regression cases
cover leading, trailing, and unmatched markers.
**Worth remembering:** the test suite was table-driven and thorough, and still only tested the
shapes I thought of. Running the actual thing and listening found it in one pass. Exercise the real
pipeline, not only its units.

## P14 — Windows PowerShell helpers hang instead of failing, and nothing had a deadline
**Symptom:** CI green on macOS and Ubuntu, `windows-latest` times out on both the clipboard read and
the OS-synth contract. Locally everything passed — the Windows path had never executed anywhere.
**Cause:** two compounding faults.
1. `Get-Clipboard` drives the Windows clipboard COM API, which **requires single-threaded apartment
   mode**. Without `-STA`, PowerShell 5.1 can block indefinitely rather than erroring.
2. More seriously: **not one spawned process in the codebase had a timeout.** A helper that never
   exits would have hung the plugin worker forever on a real user's machine, with no error and no
   audio — the exact "fails silently" failure principle I forbids.
**Instead:** every `spawn` now carries a hard deadline that kills the child and rejects
(`DEFAULT_SPAWN_TIMEOUT_MS`, `DEFAULT_CLIPBOARD_TIMEOUT_MS`), and all PowerShell invocations pass
`-STA -NoProfile -NonInteractive`. A test with a 1 ms deadline exercises the timeout path on every
platform, so this cannot regress unnoticed.
**Worth remembering:** this is the value of CI on all three OSes. A hang-forever bug in the default
path was invisible to 105 passing local tests, because the platform that triggers it was never run.

## P13 — Subagent spawn can fail on the host runtime, not on your prompt
**Symptom:** `Agent` returns *"Failed to create teammate pane: Timed out waiting for the Orca runtime
to respond"* or *"tmux: Timed out waiting for split pane handle"*. Nothing about the brief is wrong.
**Cause:** the teammate pane is created through the host runtime / tmux; when that is busy or wedged,
spawning fails regardless of the task.
**Instead:** this is an environment failure, not a code failure (R072) — do not rewrite the brief.
Retry once, then route around by doing the work in-session (R070) and record it here. Parallelism is
an optimization; the tasks and gates are the contract, and they do not care who ran them.

## P12 — Two agents appending to PITFALLS.md at once produce duplicate numbers
**Symptom:** the file contains two `## P4`, two `## P5`, two `## P6`, and cross-references become
ambiguous.
**Cause:** parallel subagents each read the file, each took "the next number", and each wrote.
Last-writer-wins on content, but numbers silently collide.
**Instead:** grep for existing numbers immediately before writing, and prefer having the
orchestrator merge subagent findings rather than letting subagents append to shared memory files
directly. Renumbering after the fact is cheap only while the entries are still uncited.

## P11 — Kokoro is 16–25× slower than Piper on Apple Silicon, despite its reputation
**Symptom:** you pick the engine with the best voices-per-megabyte reputation and huddle mode stutters.
**Cause:** measured on this machine (macOS 26.5, Node 26.7, `sherpa-onnx-node` 1.13.6, 2 threads,
one sentence → ~2 s of audio): Piper amy-low **52–65 ms**, Pocket TTS int8 **210–278 ms**, Kokoro
FP32 **838–865 ms**, Kokoro int8 **1306–1358 ms**. Kokoro int8 is *slower* than FP32, reproducing
[hexgrad/kokoro#291](https://github.com/hexgrad/kokoro/issues/291).
**Instead:** default to Piper. Offer Kokoro as a quality option with its latency shown. Full table:
`docs/.research/tts-engine-landscape.md`.

## P10 — macOS `say` costs ~414 ms of process spawn before it makes a sound, and cannot be piped
**Symptom:** the "zero-install fallback" is the slowest path in the system.
**Cause:** `say ""` — empty string, zero synthesis — measured min 414 ms / median 418 ms over 5 runs.
That is 8× the entire Piper synthesis time. Separately, `say -o /dev/stdout` emits **no bytes**: the
CAF/WAVE writers need a seekable file.
**Instead:** use `say` as the never-fails fallback and the first-run bridge while a model downloads,
never as the low-latency path. For streaming on macOS you need `AVSpeechSynthesizer` in a sidecar.

## P9 — No preinstalled macOS binary accepts streaming PCM on stdin
**Symptom:** the design assumes "pipe PCM to the system player" and there isn't one.
**Cause:** `afplay -` → *"unknown argument: -"*; piping a file in → `AudioFileOpen failed ('typ?')`.
`sox`/`play`/`mpv` are absent on a stock system. `ffplay` works (verified: streams raw PCM on
`pipe:0`; `kill()` returns in 1.5 ms) but arrives via Homebrew. On the npm side, `speaker` needs a
node-gyp build *and* has a documented multi-second `end()` hang; `naudiodon` is abandoned (last push
2024-03).
**Instead:** plan for a bundled Swift audio sidecar or Web Audio in an ORCA renderer. Do not plan
around an npm audio-output package.

## P8 — `sherpa-onnx` cannot load models from non-ASCII Windows paths
**Symptom:** TTS works everywhere, then fails for a user named `Björn` or any non-Latin username.
**Cause:** sherpa-onnx 1.12.x cannot open model files under a non-ASCII Windows path. ORCA already
hit this for STT and wrote a workaround: `src/main/speech/model-cache-path.ts:46-66` relocates the
cache under an ASCII shared root (`%PROGRAMDATA%` etc.) as `<root>\Orca\speech-models\<sha256-16>`,
migrating existing files with `.partial` + atomic rename.
**Instead:** if we use sherpa-onnx or onnxruntime, **mirror that logic and its regression test**
(`src/main/speech/model-manager-windows-path.test.ts`). Cross-platform parity is R1; this is the
exact bug that quietly breaks it.

## P7 — `sherpa-onnx-win-x64` is the only Windows build: **no Windows arm64**
**Symptom:** the default engine has no binary on Windows-on-ARM.
**Cause:** ORCA resolves `sherpa-onnx-${process.platform}-${process.arch}` but Windows is x64-only
(`src/main/speech/stt-service.ts:556-577`).
**Instead:** this is a real R1 parity gap, not a theoretical one. Windows arm64 must fall back to
the OS synthesizer (SAPI) and the UI must say why. Decide this in the spec; do not discover it in CI.

## P6 — Editing worker code does NOT hot-reload; the running worker keeps the old code
**Symptom:** you edit `main.mjs`, the watcher fires, nothing changes, and you debug a stale build
for an hour.
**Cause:** `pluginWorkerSpawnSpecsEqual` compares `pluginKey`/`rootDir`/`mainEntry`/
`manifestRevision`/capabilities — where `manifestRevision` is `JSON.stringify(manifest)`
(`plugin-worker-spawn-spec.ts:18,23-41`). **Nothing hashes the worker file.** Both restart paths
skip when specs match (`plugin-worker-manager.ts:89-91`, `plugin-worker-controller.ts:119-131`).
**Instead:** make the dev build script **bump the manifest `version` on every build**, so
`manifestRevision` changes and the worker is re-forked. Alternatives: toggle the plugin off/on, or
wait out the 5-minute idle reap. A TTS plugin is almost entirely worker code, so this is our
single biggest inner-loop risk.

## P5 — A plugin is a directory that is NEVER built at install time
**Symptom:** plugin installs, then fails at runtime on a missing import.
**Cause:** install is `git clone --depth 1` then a recursive copy filtering only `.git`
(`plugin-git-repository.ts:33-41`, `plugin-install-staging.ts:165-174`). **No `npm install`, no
compile, ever.** There is no plugin SDK, no scaffolding CLI, no published types package, and the
`orca` CLI has no plugin subcommand.
**Instead:** commit runnable ESM on the published ref. Bundle TypeScript + all deps into a single
`main.mjs` (esbuild/rollup). Must default-export the activate function.

## P4 — Hard caps: 2,000 files and 50 MB per plugin
**Symptom:** plugin refuses to install after you commit `node_modules`.
**Cause:** `MAX_PLUGIN_FILES = 2_000`, `MAX_PLUGIN_TOTAL_BYTES = 50 * 1024 * 1024`
(`plugin-content-hash.ts:15-16`). A typical `node_modules` blows the file count instantly.
**Instead:** bundle to one file. And **a neural voice model cannot ship inside the plugin** — 50 MB
is at or below one decent voice. Models download at runtime into a cache **outside** the immutable,
content-hash-verified install tree, mirroring `src/main/speech/model-manager.ts`.

## P3 — Spec Kit command names are `speckit-*`, not `speckit.*`
**Symptom:** docs and the spec-kit README show `/speckit.constitution`; typing that does nothing.
**Cause:** the Claude Code integration installs them as *skills* under `.claude/skills/speckit-<name>/`,
and skill names can't contain dots.
**Instead:** use `/speckit-constitution`, `/speckit-specify`, `/speckit-clarify`, `/speckit-plan`,
`/speckit-tasks`, `/speckit-checklist`, `/speckit-analyze`, `/speckit-implement`, `/speckit-converge`,
`/speckit-taskstoissues`. Verified by `ls .claude/skills/` at v0.16.5, 2026-08-20.

## P2 — `/speckit-constitution` overwrites the constitution wholesale
**Symptom:** hand-written principles vanish after re-running the command.
**Cause:** the command regenerates `.specify/memory/constitution.md` from the template each run.
**Instead:** **we hand-maintain `.specify/memory/constitution.md` and never run that command.**
A banner at the top of the file says so. If you want it regenerated, copy the file aside first —
v1.0.0 encodes the user's R1-R9 requirements and nine principles that took a full research phase
to derive. Keep the *reasons* behind principles in `docs/.discussion/`, not only in the constitution.

## P1 — Search skills write to a repo-root `.research/`, not `docs/.research/`
**Symptom:** untracked scrape JSON appears at the repo root and pollutes `git status`.
**Cause:** `duckduckgo-search` / `web-scraper` / `github-search` hardcode `.research/prior-art-search/`.
**Instead:** `/.research/` is gitignored. Curated research belongs in `docs/.research/` (written
by hand); the root folder is regenerable scratch and may be deleted freely.

## P0 — Do not trust a plugin-API claim that has no `file:line`
**Symptom:** a design built on an ORCA hook that doesn't exist.
**Cause:** plausible-sounding API surfaces are easy to hallucinate; ORCA is young and moves.
**Instead:** every claim about ORCA's plugin API in our specs cites `path/file.ts:123` at a
recorded commit SHA. If a scout says "inferred", it is not a foundation — verify before designing on it.
