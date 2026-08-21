# PITFALLS

> Things that bit us, or that we know will bite. Append; newest at top. Each entry:
> **symptom → cause → what to do instead.**
>
> **Numbering:** highest number = newest. Before adding an entry, `grep '^## P' PITFALLS.md` and
> take the next free number — concurrent agents have collided here before (see P12).

## P37 — Stage identity is a positional integer, so inserting a stage silently re-points every reference
**Symptom:** the normalizer needed one new transform, `stripHtmlComments`, and it is only correct at
position 2 — after `stripFencedCode`, which is the one placement where it cannot reach a `<!--`
written inside a fenced code block. That one insert is a **five-file breaking change**: the
normalizer, `scripts/voice-lab.mjs` (`STAGES` **and** `apply[]`), `voice-lab/lib/controls.mjs`, its
inlined twin in `voice-lab/index.html`, and two test files. Two of them are byte-compared at boot by
`assertLoadedModuleIsOnDiskSource()`, so a half-done renumber does not fail a test — it makes the
Voice Lab server **refuse to start**, on every fixture, with a message about a stale `dist`.
**Cause:** a stage is addressed by its ORDINAL. `stages: [8]` on a control, `FIXED_BY_DESIGN_STAGES
= [3, 10, 14, 15]`, `stage 13 expandNumbers` in eight documents. An ordinal is a name that changes
meaning when its neighbours move.
**The part that has no indicator at all:** `FIXED_BY_DESIGN_STAGES = [3, 10, 14, 15]`. After an
insert at 2 those four integers are still in range, still valid, and now name four DIFFERENT
transforms. The listener is told "fixed by design" about a stage two controls govern, and is sent to
the wrong knob. Nothing type-checks it, nothing tests it, and the ladder still renders. Contrast the
same repo's `STAGES` name list, which is compared against the call order in `normalize()` and went
red immediately — the difference is that one list carries NAMES and the other carries POSITIONS.
**Instead — the recommendation, stated so it can be picked up as its own Job (NOT implemented):**
give every stage a **stable string id** and make that the identity. `'strip-fenced-code'`,
`'expand-numbers'`. Controls then name what they govern — `stages: ['speak-file-paths']` — and
`FIXED_BY_DESIGN` becomes a list of ids rather than a list of positions. **The numeric index is
demoted to a display detail, DERIVED from the pipeline array and never written down twice.**

The property that buys is the one this entry is about: an id cannot be silently re-pointed by an
insert. Its two failure modes are both loud — a typo is a lookup miss, and a renamed stage is an id
nothing resolves. Compare the positional version, whose failure mode is an integer that is still in
range, still valid, and now means something else. The right-sized cost is real: it is a five-file
mechanical change plus a decision about whether the ladder's on-screen numbering follows array
order, so it deserves its own Job rather than being smuggled into a bug fix.

Until that exists, treat "insert a stage" as a **five-file atomic change** and serialise it against
anyone else in the tree: a split renumber leaves the Lab unbootable, and if someone is measuring
against that server they get a corrupted reading they cannot diagnose. `33037fc` is the worked
example of the full sweep — read it before attempting another insert.
**Verify by effect:** change one integer in `FIXED_BY_DESIGN_STAGES` and run `pnpm test`. Today it
goes red only because `lab.test.mjs` recomputes the same list from `controlsForStage()` — which is
the ONE check standing between that constant and a silent wrong answer. Delete that test and the
constant becomes unfalsifiable. Found by J21, 2026-08-21, adding the HTML-comment stage; the
architect's arbitration is in `.meta/goal/voice-lab-m11/ledger.md`.

## P36 — A test that IMPORTS the table it is checking cannot fail
**Symptom:** `token-conservation.test.ts` asserts that a check mark reaches the listener as the
word "yes" — 006 site 50, where `stripEmoji` deleted verdict glyphs and "check done" / "cross done"
became the same sentence. The obvious way to write it is
`import { KEY_GLYPHS } from './index.js'` and assert every mapping arrives. That test is green
forever: delete `'\u2705': 'yes'` from `KEY_GLYPHS` and the imported table loses the entry too, so
the assertion iterates one fewer row and passes. The defect the test exists to catch makes the test
smaller instead of red.
**Cause:** the expected value and the actual value were read from the same source. It is the shape
of a tautology wearing the uniform of a data-driven test, and it looks *better* than the
alternative — no duplication, no drift, one place to edit.
**Instead:** **restate the table in the test as an independent claim.** Duplication is the point:
two tables that must agree is a check; one table compared against itself is not. The cost is a real
edit in two places when the mapping legitimately changes, and that cost is the mechanism — it makes
a change to what the listener hears visible in the diff as a decision. Same reasoning as
`packages/providers/src/budget-claims.test.ts`, which parses the documented number out of the prose
rather than importing the constant (P33).
**Verify by effect:** delete one row from the table in `index.ts` and run the test. If the count of
failures is zero, the test is reading its expectations from the code under test. Mutant 1 in
`docs/.research/token-conservation.md` is this probe, recorded with its output.
**Worth remembering:** the same trap sits under every fixture generated by the code it tests, every
snapshot refreshed with `--update` when it goes red, and every allow-list appended to because a
check complained. In all four the expected value is derived from the actual one, and the assertion
degrades to `x === x`.

## P35 — A suppression marker the tool does not parse is a suppression that never happened
**Symptom:** two ORCA citations were annotated `<!-- citation-check: ignore — VERIFIED CORRECT … -->`
so `--fix` would leave them alone. `--fix` rewrote one of them anyway —
`plugin-host-api.ts:261-265` → `:144-148`, the exact citation `009` finding E-01 records as correct
and says *"Do not 'fix' them."*
**Cause:** the marker was written with its reason **inside** the comment. The tool's matcher is
`/<!--\s*citation-check:\s*ignore\s*-->/` — nothing may sit between `ignore` and `-->`. Every such
marker parsed as ordinary prose. The annotation was **present**; the suppression was **absent**.
**Instead:** after adding any suppression, ignore-rule, allowlist entry or lint disable, **re-run the
tool and confirm the count moved by exactly what you suppressed.** Watch a named value move. A marker
you added and did not re-measure is a comment addressed to a human, and the machine never read it.
Put the reason in a **second** comment beside the marker, never inside it. This is the same shape as
the backup heartbeat reading `ok:false` for six weeks: the indicator existed and nobody checked it
could still go red.

## P34 — A concurrent agent's `git add -A` claims your uncommitted work
**Symptom:** mid-fix, `git status` showed the source files clean while the working tree plainly
contained the edits. They had been swept into `172c061` — a **documentation** commit from another
agent working the same repo, which staged everything rather than its own paths. Worse follow-on:
`git checkout <file>` was then used to undo a one-line mutation probe and reverted the ENTIRE fix,
because the fix was no longer in the working tree relative to HEAD. Roughly 80 lines had to be
re-applied from scratch.
**Cause:** several agents share one worktree and one index. `git add -A` / `git commit -a` is not
"commit my work", it is "commit whatever anyone happens to have open". And `git checkout` as an
undo assumes your baseline is HEAD, which stops being true the moment somebody else commits.
**What to do instead:** stage **explicit paths**, never `-A` or `-a`. To undo a deliberate mutation
probe, `cp file /tmp/x.bak` first and `cp` it back — never `git checkout`. Commit early and often
so the window in which your work is unattributed and revertible stays small. If you find your work
already committed by someone else, say so in your own commit message: the content is fine, only the
attribution is wrong, and the record is worth more than the blame.

**Amended 2026-08-21, after the rule above was followed and failed anyway.** An agent staged six
explicit paths and verified with `git status --short` that only those six were staged. Between that
check and `git commit`, a peer staged their files into the shared index, and the commit took the
whole index — roughly 14 files belonging to someone else. Neither agent ran `-A` or `-a`.
**`git add` and `git commit` are two operations against one shared index, and anything can land
between them.** "Stage explicit paths" is necessary and not sufficient; it closes the careless case
and leaves the race open.
**The stronger form:** pass the paths to the commit itself — `git commit -- <paths>` commits only
those paths regardless of what else is staged — or re-check `git diff --cached --name-only`
immediately before committing and abort on a mismatch. Prefer the first: it has no window at all,
where the second merely has a smaller one.

## P33 — The number in the document was never the number in the assertion
**Symptom:** nine places quoted provider `cancel()` as *"measured within 50 ms"* — `STATE.md`,
`docs/TASKS.md` x4, `docs/PLAN.md` x2, `docs/design/007-user-stories.md` x3 — and all nine were
green. The assertion was `expect(elapsed).toBeLessThanOrEqual(CANCEL_BUDGET_MS * 20)`, i.e.
1,000 ms, with a `console.warn` above 50 that nobody reads in a passing log. **Verified by effect:**
delaying the SIGKILL in `OsSynthProvider.cancel()` by 900 ms measured 904 ms and stayed green in
both cancel tests. An 18x regression on the project's own barge-in budget was free, silently, at
any time. Two more of the same shape came out of the same pass: a queue-overflow test that asserted
a log line and not which end of the queue was discarded (inverting the policy left all 16 tests in
the file green), and principle VIII's thinking-block gate, which could be made to speak the model's
reasoning aloud with all seven of its own tests still passing.
**Cause:** three artefacts that each looked right alone. The constant was right (50). The prose was
right (50). The arithmetic *between* them made the gate 20x the claim, and nothing in the repo ever
compared the three. The stated reason for the multiplier — *"a hard ceiling keeps a wedged provider
from hanging CI"* — is what the 120 s test timeout already does; conflating "don't hang" with "meet
the budget" is what produced it. The thinking-block case has a different cause worth naming on its
own: the FIXTURE could not exercise the branch. A real thinking block keeps its payload under
`thinking`/`data` and has no `text` key at all, so a decoder reading `block.text` blindly finds
nothing to leak in the fixture and everything to leak in the record ORCA actually hands us.
**Instead:**
- **The gate is the budget. No multiplier, ever.** If a number needs slack, change the constant and
  change every document with it — do not hide the slack in arithmetic beside the constant.
- **"Don't hang CI" is a timeout, not an assertion.** Two different concerns; never one expression.
- **`pnpm check:mutants`** (`scripts/mutation-check.mjs`) — 18 named mutants, each declaring the
  invariant it attacks and the test that must go red. It is the only gate here that verifies a TEST
  by effect. Add one whenever a load-bearing invariant lands. Equivalent mutants are declared as
  such *with the line that makes them inert*, because a wrongly-marked equivalent is exactly the
  blind spot the script exists to find.
- **`packages/providers/src/budget-claims.test.ts`** — runs in `pnpm test`, parses the documented
  numbers out of the prose and asserts they equal the constant the suite enforces, in both
  directions. It carries its own floor assertion (`claimsSeen >= 9`), because a guard that quietly
  stops matching is the same failure wearing the uniform of the fix.
- **Before trusting a fixture, ask what the real record looks like.** A fixture that cannot express
  the failure makes every assertion over it green for free.
**Worth remembering:** a coverage gate would not have caught any of this — the cancel path was at
full coverage the entire time it was ungated. Neither would a naming convention: the test was
*named* "T041c cancel() is observed within 50 ms" while asserting 1,000. The only instrument that
finds a check which could not have failed is breaking the code and watching whether it goes red.
Full audit, including the six other loose assertions and everything that was checked and found
sound: `docs/.research/test-audit.md`.

## P32 — The ~950 ms inter-sentence gap is the audio DEVICE, not the process spawn
**Symptom:** every document in this repo explained macOS's inter-sentence silence as *"one process
per chunk"*, and M9 was on the way to being scoped as *"stop spawning a player per chunk"*. That fix
would have shipped and changed nothing a listener could hear.
**Cause:** the framing entered at `packages/plugin/src/sinks/subprocess-sink.ts:8-10` as bare prose
and was copied into HANDOFF, STATE, the constitution, `architecture.md`, **`docs/PLAN.md`,
`docs/TASKS.md`** and designs 004, 005, 006, 007 and 010. Nobody decomposed it.
**Propagation list corrected 2026-08-21, forced by round-7 finding R7-03.** This list originally
**omitted `docs/PLAN.md` and `docs/TASKS.md`** — the documents that define *done* and schedule the
work. Round 6 folded exactly the list it was given, so those two were never opened, and **that one
omission produced three of round 7's eight blocks-implementation findings** (R7-01, R7-02, R7-03):
Gate M9 could be met with the ~950 ms gap fully intact, and the constitution's inter-sentence budget
had no Definition-of-Done item, no task, no test and no CI gate. **When a pitfall names a propagation
list, the list must include every document that defines a gate, a budget or a milestone — not only
the documents that repeat the wrong sentence.** Measured (`docs/.research/latency-measurements.md` section 1.1,
2026-08-21) against the shipped `SubprocessSink` with real `say` output, gap p50 950 / 937 / 897 ms
over three runs of n=18 `[measured-here]`:

| component | p50 | share |
|---|---|---|
| `afplay` fork/exec with the device never opened (spawned on a missing file), n=12 | **2.3 ms** | 0.25 % |
| `mkdtemp` + `writeFile(56 kB)` + `rm` — the sink's whole temp-file round trip, n=20 | **0.33 ms** | 0.03 % |
| CoreAudio device open, pre-roll, post-roll, teardown | **~893 ms** `[derived]` | **99.7 %** |

A regression of `afplay` lifetime against audio duration over 200/500/1,000/2,000 ms tones gives
slope ~1.0 and intercept **905–915 ms** — a fixed per-invocation cost, not a duration-proportional
one (`latency-measurements.md` 2.5).
**Instead:** scope M9 as *hold the audio **device** open across chunks*. Pooling or pre-warming
player **processes** saves 2 ms of 950. The question to ask any candidate player, on any platform,
is **"does it hold the device open between buffers"** — never "how fast does it start". The same
arithmetic kills the latency argument for `--stdout` in either direction (P29): it removes 0.03 %
of the cost.
**Why the wrong answer is sticky:** "a process spawn is expensive" is intuitive, `say ""` really
does cost 414 ms (P10), and the two numbers sit one paragraph apart in most of these documents. The
intuition is right about the *synth* spawn and wrong about the *player* spawn, and nothing in the
prose distinguished them.
**Corroboration:** 2 of 10 / 3 of 10 earcon samples came in at ~370 ms instead of ~870 ms, and only
when a previous `afplay` had exited moments earlier — a **warm device** is where the ~500 ms of
headroom lives (`latency-measurements.md` 1.4).
**Verify by effect:** `pnpm bench:latency` (silent) prints `player.no-device` — `afplay` spawned on
a missing file, which exits before reaching CoreAudio. If that number is ~2 ms and the gap is
~950 ms, the spawn is not the gap. Both readings, before and after any M9 change.

## P31 — A subagent swarm in the watched worktree is the P22 scenario at a scale nothing was tested against
**Symptom:** the author, sitting at the machine, hears agent replies they never asked for — including
one agent talking over another — while huddle is following "their" session. Reported live:
*"I hear beeps... then 'the tests pass'... and then another agent seem to spoke while it was saying
the test pass so it was hard to understand what they said."*
**Cause:** every subagent spawned by the Task tool is a **full Claude session that writes its own
transcript** into the same `~/.claude/projects/<worktree>/` directory the huddle watcher tails. A
six-agent fan-out inside this project's own worktree put seven live transcripts in one directory,
all modified within nine minutes. Session selection was designed and tested against one or two
concurrent sessions; it was never exercised against seven, and the developer of the tool running a
swarm inside the tool's own worktree is the exact configuration nobody designs for.
**Instead:** run fan-outs in a separate worktree, or with a HOME whose `projects/` directory the
watcher does not tail, so agent transcripts never land in the directory the listener is following.
When that is not possible, unfollow before fanning out.
**Also:** any benchmark that measures *device-side* latency must play real audio, so it is audible
to whoever is at the machine. `scripts/bench-latency.mjs` is silent by default for that reason —
synthesis-side numbers come from `say -o <file>`, which never touches the audio device, and the
audible measurements are behind an explicit opt-in with a printed warning. **A benchmark whose
default behaviour interrupts the user is a benchmark that gets deleted.**
**Consequence for the design:** this is the first *observed* reproduction of P22 since its fix, and
it arrived through a path none of the fixes cover. The high-water mark, the lock and the per-file
priming all assume a small, stable set of sessions in a worktree.
**Gates are run in a detached worktree at a named SHA, never in the shared tree, and the SHA is
recorded beside the number.** Added 2026-08-21, forced by round-7 finding R7-13: `pnpm
check:citations` run twice minutes apart in the live tree returned **38 stale**, then **75 stale**,
with no document edited between them — concurrent agents held uncommitted edits to
`packages/plugin/src/main.ts` and `packages/providers/src/`, and the checker resolves symbols against
the *working tree*. This is P31's own shape reaching the **verification tooling** rather than the
plugin, and it defeats R004: the same probe before and after is unsatisfiable in a tree with other
writers. A number taken in a shared tree is not a measurement, it is a sample of someone else's
in-progress edit.
**Verify by effect:** `ls -lt ~/.claude/projects/<worktree>/*.jsonl | head` during a fan-out — count
the files modified in the last five minutes. More than two means the listener is in this situation.
For the tooling half: `git stash list && git status --porcelain` before any gate — a non-empty
working tree means the number you are about to record belongs to a tree nobody can reconstruct.

## P30 — "Never fail silently" that terminates in a channel the user does not have
**Symptom:** the project has a real, enforced discipline — every catch notifies, every degradation
is announced, every drop is reported — and the user still experiences unexplained silence. Nothing
is red. Every code review passes. The FMA counted **55 silent-failure sites in current source and
found that the number reaching the audio stream was zero.**
**Cause:** every announcement path ended at `host.notify` -> `notifications.show`, whose
`{ delivered }` result was discarded (`adapter/index.ts:63`), or at `host.log`, which is itself
wrapped in `catch {}`. Both are real channels. Neither is a channel a dyslexic, voice-first listener
uses. The discipline was never violated; it was pointed at the wrong audience — which is invisible
in a diff, because "we notify the user" and "the user is told" look identical in code.
**Instead:** name the channel the user actually has, and make every announcement terminate there.
Here that is spoken audio, so `SpeechService.announce()` is the destination and the desktop
notification is the supplement. Then decide urgency deliberately — an announcement that interrupts
is itself a harm, so losses defer to the end of the current utterance and coalesce, and only a thing
the listener just asked for interrupts. And announcements must never clear the queue: destroying
what is queued is the fault this class of message exists to report (that was C5 — `read-aloud.status`
answered "what is it reading" by deleting what it was reading).
**Verify by effect:** disable the notification path entirely, cause the loss, and assert the
**spoken sentence naming the count** — not that the callback fired. `speech-service.test.ts`
"losses and degradations reach the audio stream" constructs the service with no `onDropped` and no
`log` and asserts on text the provider was actually handed.
**Worth remembering:** ask of every safety mechanism *who receives this, and do they read it?*
before asking whether it fires. P18 was a defensive adapter that converted a wrong name into a
silent success; this is the same shape one level up — a correct mechanism delivering to the wrong
address. Both look like working code and produce nothing.

## P29 — `espeak-ng --stdout` emits a WAV that claims 2 GB, and nothing ever fixes it
**Symptom:** you remove the `mkdtemp` -> synthesize-to-file -> `readFile` -> `rm` round trip by
switching to `--stdout`, the audio still plays through `aplay`, and later `decodeAudioData` in a
renderer rejects or mis-decodes the same bytes. The saving was real and the regression is silent
until it reaches a strict decoder.
**Cause:** `espeak-ng/espeak-ng` `src/espeak-ng.c` writes a static 44-byte header template whose
RIFF size is `0x7ffff024` and data size `0x7ffff000` (`:211-215`), then backpatches both with
`fseek` when the file is closed (`:256-260`) — except `CloseWavFile()` **returns early when the
output is stdout** (`:250`). A pipe is not seekable, so the lengths stay at ~2 GB forever. With
`-w <file>` they are corrected.
**Instead:** keep `-w <file>` while we hand whole WAVs to a sink or a decoder. `--stdout` is correct
only for a *streaming* consumer that ignores the declared lengths, and even then patch the two
length fields or strip the 44-byte header and treat the rest as raw `LEI16@22050`.
**Verify by effect:**
```
espeak-ng --stdout "one two three" > /tmp/s.wav
python3 -c "import struct;d=open('/tmp/s.wav','rb').read();print(struct.unpack('<I',d[4:8])[0], struct.unpack('<I',d[40:44])[0], len(d))"
# stdout: ~2147479588 ~2147479552 <a few tens of kB>   |   -w file: actual-8 actual-44 actual
```
**Worth remembering:** this is P10's twin on the other platform — macOS `say -o /dev/stdout` emits
no bytes at all because its writers need a seekable file. **On every OS-native synthesizer we have
looked at, the file path and the stream path are not the same path**, and the stream path is always
the one with the caveat. Assume that for the next engine too, and check the header before trusting
a pipe.

## P28 — Voice names do not port across platforms, and there is zero overlap
**Symptom:** a persisted voice preference is meaningless on another machine, and a design sized on
one platform collapses on another.
**Cause:** macOS (`Samantha`), Windows (`Microsoft Zira Desktop`) and espeak-ng (`en-US+f3`) are
three unrelated namespaces with no shared member. The counts are not comparable either: 41 usable
voices on macOS, **2** on a stock Windows 11, and 0 through our own path on a stock Ubuntu desktop.
Guaranteed-on-all-three is therefore **1**.
**Instead:** persist an index or a seed into the host's runtime voice list, never a name. Size any
speaker-differentiation design for **N = 1 and degrade upward**. The axes that are equal on every
platform are the ones we generate ourselves — a synthesized earcon and a spoken call-sign — because
they never consult the host. And cache the voice list: `say -v '?'` costs ~450 ms, which is the
entire first-audio budget.
**Source:** `docs/.research/q-round1-platform.md` Q31 · `docs/design/005-agent-identity.md`.

## P27 — Parallel ORCA dev builds share one userData profile, so the CLI addresses the wrong app
**Symptom:** `orca <cmd>` silently talks to whichever dev instance started last. Both windows work.
Nothing errors. The failure is silent and it fails in the direction of looking correct.
**Cause:** a git worktree separates the *code*; nothing separates the *state*. Every checkout
resolves `userData` to the same `<appData>/orca-dev`. The dev single-instance lock is skipped on
purpose (stablyai/orca#1419) so parallel worktree builds are possible at all, so instance B boots
fully and takes over the shared profile — rewriting `orca-runtime.json` and the `cli/bin/orca` shim
in place, while still exporting A's user-data path.
**Instead:** give every worktree its own profile.
`ORCA_DEV_USER_DATA_PATH="$HOME/Library/Application Support/orca-dev-$(basename "$(git rev-parse --show-toplevel)")" pnpm dev`
Address each instance through its own `"$P/cli/bin/orca"` shim. Never create a global
`/usr/local/bin/orca-dev` — it binds to whichever checkout installed it last. Each worktree needs
its own `pnpm install` (native modules are per-checkout), and killing `pnpm dev` does **not** stop
the app: target the Electron main process.
**Verify by effect:** read `pid` in `<profile>/orca-runtime.json` before and after starting the
second instance. Shared profile, the pid changes. Isolated, it does not. Equivalently, `grep
'Replacing daemon'` in the second instance's log — one line means shared, zero means isolated.
**Source:** the author's own write-up,
https://gist.github.com/YoraiLevi/e171337e96dedd678769cdc0ba074bbd · upstream stablyai/orca#15647,
fix in #15648.

## P26 — An option nobody can pass is invisible to every test you would think to write
**Symptom:** `SynthesizeOptions.voice` and `.rate` were declared in core, implemented by
`OsSynthProvider` on all three platforms, and covered by provider tests — and **no caller could
reach them.** `SpeechService` called `provider.generate(chunk.text)` with no options at all. Same
for the chunker's `isolateFirstSentence`: only `maxUnits` was forwarded. The two settings every
user asks for first were unsettable in the shipped plugin, and nothing was red.
**Cause:** the tests asserted the *field exists and the provider honours it*. Nothing asserted the
value **arrives** by the path a real caller uses. A dead wire passes both halves of that split.
**Instead:** for anything a user is meant to configure, test **reachability end to end** — set it
on the outermost object a caller actually constructs, and assert the innermost consumer received
it. `packages/plugin/src/speech-service.test.ts` "voice, rate and chunking are reachable from the
caller" does this, and it includes the control case (nothing configured → provider receives `{}`),
so the other assertions can be shown to fail for the right reason.
**Worth remembering:** this is the same shape as P18 — a defensible-looking layer between two
correct pieces, where the failure is that nothing connects them. Before M12 freezes any settings
schema, walk each field from the UI to the process that consumes it; a field that cannot be walked
is not a setting, it is a comment.

## P25 — A shared library is not a CLI, and that made our Linux floor silent
**Symptom:** on a stock Ubuntu 24.04 desktop the plugin produced **no sound at all**, with no error
the user could see. `listVoices()` returned `[]` from a bare `catch` and `generate()` threw into
another one.
**Cause:** we synthesized on Linux with `espeak-ng -w`. The Ubuntu desktop image ships
`libespeak-ng1` and `espeak-ng-data` — because speech-dispatcher's backend links them — but **not**
`/usr/bin/espeak-ng`, which lives in its own package that is not in the manifest. The library's
presence makes the binary look installed, and nothing in our code distinguished them.
**Instead:** probe the **binary**, never infer it from a library or a data package, and ladder down
to something that is actually on the image. `spd-say` is installed there and **cannot write a
WAV** — verified upstream (`brailcom/speechd` `src/clients/say/options.c` has no file-output
option, `-w` is `--wait`; `src/modules/module_utils.c` `module_audio_init` only opens
oss/alsa/nas/libao/pulse, so there is no capture path either). So it is driven as a *speaker*:
`spd-say --wait`, the provider yields no audio, and the daemon owns playback — a deliberate,
announced exception to "providers never play" taken because silence is worse for assistive tech.
Barge-in must then also send `spd-say --cancel`: killing our client does not stop the daemon.
**Verify by effect** (needs a Linux box):
```
curl -sfL https://releases.ubuntu.com/24.04/ubuntu-24.04.3-desktop-amd64.manifest | grep -i espeak
command -v espeak-ng espeak spd-say
spd-say -w /tmp/b.wav "x"; ls /tmp/b.wav      # expect: no such file (-w is --wait)
```
**Worth remembering:** the same trap sits under every "the OS already has X" assumption. Ask what
the *image manifest* ships, not what the *distro packages*. And a swallowed exception on the floor
of a degradation ladder is the worst place to have one: there is nothing below it to catch you, so
the only symptom is silence.

## P24 — `str.replace` duplicated every pitfall in this very file
**Symptom:** `PITFALLS.md` held **62 entries where 24 existed** — every entry from P13 up repeated
three or four times. Nobody noticed for hours because the file is only ever appended to and read
from the top.
**Cause:** each new pitfall was inserted with `t.replace('## P22 —', new + '## P22 —')`. Python's
`str.replace` replaces **every** occurrence, not the first. Once one duplicate existed, each later
insert multiplied all of them.
**Instead:** pass a count — `t.replace(old, new, 1)` — or split on the first index. And **verify by
effect**: `grep -c '^## P[0-9]' PITFALLS.md` should equal the highest number plus one. It did not,
and a wrong count nearly went into a compaction document as fact.
**Worth remembering:** the memory files are the one thing a fresh agent trusts completely. A silent
corruption there is worse than a bug in the product, because everything downstream is derived from
it. Check the count whenever you write to them.

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

## P15 — Bare Piper `.onnx` files from Hugging Face do not work with sherpa-onnx
**Symptom:** `'sample_rate' does not exist in the metadata` at model load.
**Cause:** `rhasspy/piper-voices` serves `.onnx`/`.onnx.json` directly over HTTP 200, which looks
like a clean archive-free download path. But sherpa's own `tts-models` release tarballs embed extra
ONNX metadata *and* a `tokens.txt` the HF files do not carry.
**Instead:** download sherpa's release assets, or convert and re-host the models yourself. Verified
2026-08-20.

## P14 — Node cannot decompress bzip2, and sherpa ships models as `.tar.bz2`
**Symptom:** first-run model download works on macOS/Linux (shell out to `tar xj`) and dies on Windows.
**Cause:** Node 26's `zlib` exposes gzip, brotli and zstd — **no bzip2**. `tar` with bz2 support is
not guaranteed on Windows.
**Instead:** pure-JS `unbzip2-stream` (1.4.3, `gypfile: false`) piped into `tar-stream`. Verified:
397 entries / 81 MB decoded in 4.7 s with no native build. Or re-host the models as `.tar.gz`.

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
hit this for STT and wrote a workaround: `getSpeechModelCacheDirCandidates`
(`src/main/speech/model-cache-path.ts:46-66`) relocates the cache under an ASCII shared root (`%PROGRAMDATA%` etc.) as `<root>\Orca\speech-models\<sha256-16>`,
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
