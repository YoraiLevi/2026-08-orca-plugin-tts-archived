# Fix round 1 — three confirmed bugs, plus one committed trap

**Date:** 2026-08-21 · **Machine:** macOS 26.5, Apple Silicon · **Branch:** `main`, not pushed.
**Suite:** 145 → **161 tests, all passing** (16 new).

Every claim is labelled **MEASURED** (run here, output pasted) or **DOCUMENTED** (primary source
cited, not run here). Nothing below is recollection. Anything needing a Linux box to settle is in
"What a Linux machine still has to settle".

| Bug | Status | Commit |
|---|---|---|
| 1 · silent on stock Linux (R1) | **partially fixed** — code fixed, floor unverifiable from macOS | `6ebfd6b` |
| 2 · ordered lists lose their numbers | **fixed** | `5cab7eb` |
| 3 · voice and rate have no wire | **fixed** | `6b776d4` |
| — · committed stale `dist/` | **fixed** | `c8fccf9` |

---

## Bug 1 — silent on stock Linux

### What was wrong

`packages/providers/src/os-synth/index.ts` synthesized on Linux only via `espeak-ng -w <file>`.
That binary is not on a stock Ubuntu 24.04 desktop. `listVoices()` caught the failure and returned
`[]`; `generate()` threw `OsSynthUnavailableError` into `SpeechService`'s catch, which logged.
`ProviderRegistry.resolve()` discarded the error entirely (`void err`). Net effect on the most
common Linux desktop: **no sound, and nothing actionable said to the user.**

### What I verified myself, and what it changes

**DOCUMENTED — the image manifest.** Re-run here against the official manifest (1,819 packages):

```
$ curl -sfL https://releases.ubuntu.com/24.04/ubuntu-24.04.3-desktop-amd64.manifest \
  | grep -iE '^(espeak|libespeak|speech-dispatcher|alsa-utils|pulseaudio|sox|ffmpeg|pipewire)'
alsa-utils                              1.2.9-1ubuntu5
espeak-ng-data:amd64                    1.51+dfsg-12build1
libespeak-ng1:amd64                     1.51+dfsg-12build1
pipewire:amd64 / pipewire-alsa / pipewire-pulse   1.0.5-1ubuntu3.1
speech-dispatcher                       0.12.0~rc2-2build3
speech-dispatcher-audio-plugins:amd64   0.12.0~rc2-2build3
speech-dispatcher-espeak-ng             0.12.0~rc2-2build3
```

Three findings the prior research did not record:

1. **No `sox`, no `ffmpeg`, no `festival`, no `flite`, no `libttspico`/`pico2wave`.** There is no
   second WAV-capable synthesizer hiding on the image.
2. **`pulseaudio-utils` is NOT on the image, so `paplay` is not either** — and
   `packages/plugin/src/sinks/subprocess-sink.ts:29` tries `paplay` FIRST on Linux. `alsa-utils`
   *is* on the image, so `aplay` (second in the list) is what will actually run, through
   `pipewire-alsa`. Not a bug — the ladder falls through correctly — but the first rung is dead on
   the reference desktop and every playback will pay one failed spawn. Worth reordering later.
3. `gstreamer1.0-tools` is present, but no GStreamer TTS element ships with it
   (`gst-plugins-bad` is not on the image), so it is not a synthesis route.

**DOCUMENTED — the `spd-say` claim, which I was told to distrust. It holds.** Fetched upstream
`brailcom/speechd@master`:

- `src/clients/say/options.c` — the full option table has `-r/--rate`, `-p/--pitch`,
  `-R/--pitch-range`, `-i/--volume`, `-t/--voice-type`, `-y/--synthesis-voice`,
  `-L/--list-synthesis-voices`, `-m/--punctuation-mode`, `-x/--ssml`, `-S/--stop`, `-C/--cancel`,
  and **`-w/--wait` = "Wait till the message is spoken or discarded"**. There is **no file-output
  option of any kind**.
- I also checked the layer below, in case the client was just missing a feature the daemon has:
  `src/modules/module_utils.c` `module_audio_init()` accepts only `oss`, `alsa`, `nas`, `libao`,
  `pulse` (and rejects `"server"` with *"server audio is not supported"*), and `module_tts_output()`
  hands the track straight to `spd_audio_play()`. **The modules play audio themselves; there is no
  capture path and no file writer anywhere in speech-dispatcher.**
- Package file lists confirm the same at the binary level:
  `speech-dispatcher-audio-plugins` ships exactly `spd_alsa.so`, `spd_libao.so`, `spd_oss.so`,
  `spd_pulse.so`. `speech-dispatcher-espeak-ng` ships `/usr/lib/speech-dispatcher-modules/sd_espeak-ng`,
  which is a module of that same architecture — driving it directly would be another *direct-speak*
  path, more fragile than `spd-say`, not a WAV path.

**So: the claim is true, and the conclusion I draw from it is the opposite of "give up".**
`spd-say` cannot give us bytes, but it *can* make the machine speak, and on a stock desktop it is
the only thing that can. Silence is the worse outcome.

### What I changed

1. **A detection ladder, probed by running the binary** — `espeak-ng` → `espeak` → `spd-say`,
   cached after the first resolution. Never inferred from a library.
2. **`spd-say` is driven as a speaker, not a file writer.** `spd-say --wait <text>`; the provider
   yields no audio and speech-dispatcher owns playback. This is a **deliberate, announced exception
   to R023** ("providers emit PCM, the client plays"), taken because the alternative on the
   reference desktop is nothing at all. `--wait` preserves utterance ordering. `cancel()` now also
   issues `spd-say --cancel`, because killing our own client does not stop the daemon's voice —
   without that, barge-in would be one-sided on this rung.
3. **Loud failure, everywhere the old code was quiet.**
   - `LinuxSpeechUnavailableError` names every binary tried and carries the fix:
     `sudo apt install espeak-ng`, plus the fact that a stock desktop ships the library and not the
     command.
   - `prepare()` throws instead of reporting warm. Reporting warm while unable to make a sound was
     the root of the silence.
   - `listVoices()` records `unavailableReason` instead of discarding the error. An empty voice
     list is not evidence of "no voices" — it is evidence of a failed probe.
   - `ProviderRegistry.lastFailure` carries the reason out of `resolve()`.
   - `main.ts` notifies the user with it, and passes a `notify` channel into the provider so the
     degraded `spd-say` rung is **announced when it is taken**, not discovered by ear.
4. **H25 fixed: `rate` no longer dropped on Linux.** espeak-ng now gets
   `-s round(rate * 175)`, clamped to 80–450. 175 wpm is espeak-ng's own documented default and the
   same base macOS `say` uses, so one rate number means the same thing on both. `spd-say` gets
   `-r clamp(round((rate - 1) * 100), -100, 100)`, its own documented scale.

### Before / after evidence — MEASURED

This machine has none of `espeak-ng`, `espeak`, `spd-say` (`which` returns non-zero for all three),
so `new OsSynthProvider({ platform: 'linux' })` exercises the real ladder and the real failure. The
five new tests, run against the pre-fix provider:

```
Tests  5 failed | 10 skipped (15)

× detection failure is named and actionable, not a swallowed exception
  → the floor we do have was never tried: expected '…Tried: espeak-ng' to contain 'spd-say'
× prepare() refuses to report warm when nothing on the box can speak
  → expected promise to reject, received: undefined      (it resolved, and reported warm)
× tells the user, through notify, which binary is missing
  → expected '' to contain 'apt install espeak-ng'       (notify was never called)
× espeak-ng honours rate — it used to be dropped on Linux only
× spd-say is driven as a speaker, not as a file writer
  → (both: linuxCommand did not exist; rate was absent from the Linux argv)
```

After: `15 passed (15)` in that file.

### Why this is "partially fixed"

The loud-failure half is verified here by effect. The **`spd-say` floor itself has never been
heard** — I cannot run Linux. The code is written from primary sources, and the exact probes are in
the source comment and below. Until someone runs them, treat the floor as *designed and untested*.

---

## Bug 2 — ordered lists lose their numbers

**Was:** `listItemsToSentences` stripped the whole marker, so `"1. alpha\n2. beta"` → `"alpha. beta."`.
A numbered procedure became indistinguishable from a bullet list.

**Now:** new `NormalizeOptions.orderedLists: 'numeral' | 'word' | 'drop'`.

| Value | `"1. alpha"` becomes | Note |
|---|---|---|
| `'numeral'` (**new default**) | `"1, alpha."` → heard as *"one, alpha"* | `expandNumbers` runs later and expands the numeral |
| `'word'` | `"first, alpha."` | ordinal words to twentieth, then `"number 27, …"` |
| `'drop'` | `"alpha."` | v1 behaviour, still reachable |

**The default changed. Say so out loud in any release note.** I did not preserve `'drop'` because I
cannot argue for it: it destroys information the listener has no way to recover, and this is
assistive technology for a user whose main input is agent replies full of numbered steps. The
choice between `'numeral'` and `'word'` *is* taste and belongs to the listener in the Voice Lab —
which is exactly why this shipped as an option and not as a new hardcoded opinion.

Two decisions worth keeping:
- **A comma, not a full stop.** `"1."` as its own sentence would be split off by the chunker and
  spoken alone, with the ~970 ms inter-chunk gap either side. There is a test pinning this.
- **Numbering is preserved as written**, not renumbered from 1 — agents renumber and resume lists,
  and speaking "one, two" over `7.` / `8.` would be a lie.

**Before / after — MEASURED.** 7 new tests + 1 updated; 6 failed before:

```
× ordered list keeps its ordinals            expected 'alpha. beta.' to be 'one, alpha. two, beta.'
× 'word' speaks it as an ordinal word        expected 'alpha. beta.' to be 'first, alpha. second, beta.'
× numbering that does not start at 1         expected 'seven. eight.' to be '7, seven. 8, eight.'
× past the ordinal-word table                expected 'late.'        to be 'number 27, late.'
× the ordinal stays inside the item          expected 'alpha.'       to be '1, alpha.'
Tests  6 failed | 74 passed (80)
```

After: `80 passed (80)`.

---

## Bug 3 — voice and rate have no wire

**Was:** `speech-service.ts:121` called `provider.generate(chunk.text)` with no options.
`SynthesizeOptions.voice`/`.rate` existed and `OsSynthProvider` implemented both — on all three
platforms — but no caller could reach them. `isolateFirstSentence` was unreachable the same way:
`SpeechService` built its `ChunkerOptions` from `maxUnits` alone (H20).

**Now:** `SpeechServiceDeps` accepts `voice`, `rate`, `isolateFirstSentence` and forwards all three.
No settings file, no UI — that is being designed separately; this only makes the values reachable.

**Today's behaviour is preserved exactly when nothing is passed.** The synthesize-options object is
built per utterance and omits undefined fields, so the provider still receives `{}`. There is a
dedicated test for that, which passed before *and* after — it is the control that proves the other
three failed for the right reason rather than because the test was broken.

`voice` is documented as **not portable**: macOS `Samantha`, Windows `Microsoft Zira Desktop` and
espeak-ng `en-US+f3` share no namespace and no member, so a voice name must never be persisted
across machines. Whoever designs the settings schema should store an index into the host's runtime
list, not a name.

**Before / after — MEASURED.** 4 new tests, 3 failed before:

```
× forwards voice and rate to the provider
  → voice never reached the engine: expected undefined to be 'Samantha'
× every chunk of a long utterance carries the same voice and rate
  → expected undefined to be 'Daniel'
× forwards isolateFirstSentence, which no caller could reach (H20)
  → isolateFirstSentence:false had no effect: expected 'One here. ' to contain 'Two here.'
Tests  3 failed | 8 passed (11)
```

After: `11 passed (11)`.

---

## The committed `dist/` trap

`git rm -r --cached` on `packages/core/dist`, **and also `packages/providers/dist` and
`packages/plugin/dist`** — all three were tracked, all three are the same trap, and removing only
the one that had already gone stale would have left the other two to go stale next. `.gitignore`
now carries `packages/*/dist/`.

The shipped artifact at **`/dist/plugin` stays tracked** — that one is load-bearing, because ORCA
never builds a plugin at install time (P5).

Verified nothing imports them, by effect:

```
$ grep -rn "core/dist\|providers/dist\|plugin/dist" \
    --include='*.ts' --include='*.mjs' --include='*.json' . | grep -v node_modules
docs/design/004-voice-lab.md:29    (prose)
docs/.research/q-round1-codebase.md:243  (prose)
docs/.research/pitfalls-pending.md:49    (prose)
```

Zero code references. `pnpm test` and `tsc -b` both still pass with the directories untracked
(they are still built locally; only git stopped carrying them).

---

## What a Linux machine still has to settle

Run these on a stock Ubuntu 24.04 desktop. They are also in the source comment at the top of the
Linux ladder in `packages/providers/src/os-synth/index.ts`.

| # | Probe | What it settles | Expected |
|---|---|---|---|
| 1 | `command -v espeak-ng espeak spd-say` | which rung we land on | only `spd-say` on a stock image |
| 2 | `spd-say -w /tmp/b.wav "x"; ls /tmp/b.wav` | the claim I could only check in source | no such file — `-w` is `--wait` |
| 3 | `spd-say --wait "one two three"` | **the floor actually makes a sound** | audible speech, exit 0 |
| 4 | `spd-say --wait "…long…" & sleep 1; spd-say --cancel` | barge-in reaches the daemon | speech stops within ~1 s |
| 5 | `spd-say --wait -r 50 "one two three"` vs `-r -50` | rate is real on this rung | audibly different durations |
| 6 | `sudo apt install espeak-ng` then `espeak-ng -w /tmp/a.wav -s 260 "one two three" && ls -l /tmp/a.wav` | the preferred rung and the H25 rate fix | non-empty WAV, faster than `-s 120` |
| 7 | `paplay /tmp/a.wav; aplay /tmp/a.wav` | finding 2 above | `paplay` not found, `aplay` plays |

Two things I could not settle at all from here:

- **Whether the `spd-say` rung is *pleasant* enough to ship as the floor.** It is espeak-ng formant
  synthesis through the daemon; P16 already warns it sounds like 2005. It is a floor, not a
  feature.
- **Whether the daemon is running in the user's session.** `spd-say` autospawns
  speech-dispatcher via its user socket unit, but on a headless box or a CI runner there is no
  audio sink at all (P16 already records that `actions/runner-images` has no speech stack). CI
  cannot exercise rungs 3–5; it can only exercise the pure command builder and the failure path,
  which is what the new tests do.

## Round 2 — the two leads from the design round

Both were run down against upstream source. **Neither opens a capture path, and one of them is a
trap.** Everything here is DOCUMENTED (upstream source at `master`, `file:line` given); nothing in
this section was executed, because it needs Linux.

### Lead 1 — `espeak-ng --stdout`: do NOT adopt it in the current architecture

The flag exists and does what the help text says. But the WAV it writes is malformed in a way that
matters to us, and this is visible in `espeak-ng/espeak-ng` `src/espeak-ng.c`:

```c
static int OpenWavFile(char *path, int rate) {
    static const unsigned char wave_hdr[44] = {
        'R','I','F','F', 0x24,0xf0,0xff,0x7f, 'W','A','V','E', ...   // RIFF size 0x7ffff024
        ...                                   0x00,0xf0,0xff,0x7f };  // data size 0x7ffff000
    if (strcmp(path, "stdout") == 0) { ... f_wavfile = stdout; }      // :224-229
    fwrite(wave_hdr, 1, 24, f_wavfile); ...                           // :239-242
}
static void CloseWavFile() {
    if ((f_wavfile == NULL) || (f_wavfile == stdout)) return;         // :250  <-- early return
    ... fseek(f_wavfile, 4,  SEEK_SET); Write4Bytes(f_wavfile, pos - 8);   // :256-257
    ... fseek(f_wavfile, 40, SEEK_SET); Write4Bytes(f_wavfile, pos - 44);  // :259-260
}
```

`--stdout` writes the header **template** and then returns early from `CloseWavFile`, so the RIFF
and data lengths are **never backpatched** — every `--stdout` stream declares roughly **2 GB of
audio**. `-w <file>` is seekable, so it does backpatch them and produces a correct WAV.

We hand complete WAV bytes to a sink today and, per P9/E6e, to `decodeAudioData` in a renderer
later. A data chunk claiming 2 GB is a decoder problem, not a saved syscall. **So the invocation we
document stays `-w <file>`.** `--stdout` becomes the right call only for a streaming consumer that
ignores the declared lengths — that is an M9 change, and it needs its own header fixup (patch the
two length fields, or strip the 44-byte header and treat the rest as raw `LEI16@22050`).

This is the same shape as P10 (`say -o /dev/stdout` emits no bytes because the CAF/WAVE writers
need a seekable file): **on both platforms the file-writing path and the streaming path are not the
same path.** Recorded as P29 so the next person to try to remove the temp file finds it first.

`AVSpeechSynthesizer.write(_:toBufferCallback:)` on macOS is real and is the right long-term
answer there, but it is a Swift API — it needs the bundled sidecar HANDOFF already contemplates,
not a flag change. Out of scope here.

**Probe that settles it in one command** (Linux):
```
espeak-ng --stdout "one two three" > /tmp/s.wav &&   python3 -c "import struct,sys;d=open('/tmp/s.wav','rb').read();print('declared riff',struct.unpack('<I',d[4:8])[0],'declared data',struct.unpack('<I',d[40:44])[0],'actual bytes',len(d))"
# expect: declared ~2147479588 / ~2147479552, actual a few tens of kB
espeak-ng -w /tmp/f.wav "one two three" && python3 -c "...same..."   # expect: declared == actual-8 / actual-44
```

### Lead 2 — the SSIP socket: richer than the CLI, still no bytes

The lead is right that SSIP exposes more than `spd-say`, and wrong that it might expose audio.
The complete top-level verb list, `speechd` `src/server/parse.c:98-110` plus `:128`:

```
set · history · stop · cancel · pause · resume · sound_icon · char · key · list · get · help ·
block · speak · bye/quit
```

There is **no audio-retrieval verb of any kind**. `SET` (`:424-680`) accepts priority, language,
synthesis_voice, client_name, rate, pitch, pitch_range, volume, voice_type, punctuation,
output_module, cap_let_recogn, pause_context, notification — and **no audio-output parameter**, so
audio routing is daemon/module configuration only and is not settable per connection.

I then closed the one route that was still theoretically open. speech-dispatcher's audio plugins
are `spd_alsa.so`, `spd_libao.so`, `spd_oss.so`, `spd_pulse.so`, and libao *does* have file drivers
(`wav`, `raw`, `au`), so "set `AudioOutputMethod libao` and point `~/.libao` at the wav driver"
looks plausible. It cannot work: `src/audio/libao.c:75` calls **`ao_open_live()`**, and libao's file
drivers are reachable only through `ao_open_file()`. A live-open against a file driver fails.
`src/modules/module_utils.c` `module_audio_init()` confirms the same list and explicitly rejects
`"server"` with *"server audio is not supported"*.

`sd_generic` is shipped and can run an arbitrary command from a `.conf`, which is the only
user-reachable escape hatch — but a generic module's command is itself a synthesizer, so it needs a
synthesizer we do not have. It is not a capture path.

**What SSIP would genuinely buy us, if we ever want it:** `PAUSE`/`RESUME` (which `spd-say` cannot
do at all), index marks via SSML for word-level progress, and per-connection voice/rate/pitch
without a process spawn per utterance. That is a real upgrade to the floor's *control*, and zero
help to its *architecture*.

**Probe that settles it in one command** (Linux):
```
printf 'SET SELF CLIENT_NAME orca:tts:probe\r\nHELP\r\nQUIT\r\n' \
  | socat - UNIX-CONNECT:"${XDG_RUNTIME_DIR}/speech-dispatcher/speechd.sock"
# expect: the verb list above, and nothing resembling an audio/capture command
```

### The design finding: our provider seam is wrong for Linux

This is the part that outlives the bug fix, and it should go to the design round rather than be
solved here.

Our contract is **"the provider produces audio, the client plays it"** (R023, and R5.2 in the
user's own spec: *"playback belongs to the client, not the synthesis service"*). Speech-dispatcher's
contract is the exact inverse: **"I speak; you do not touch the audio."** Those are not reconcilable
by any flag, and the evidence above says the second contract is the *only* one available on a stock
Ubuntu desktop.

Three concrete consequences, none of which the current code models:

1. **`cancel()` is not two-sided on this rung, it is two-*process*.** Killing our client leaves the
   daemon speaking. The fix in this commit — also issuing `spd-say --cancel` — works, but it is a
   *global* cancel: it cancels every message that client sent, and via SSIP `CANCEL ALL` would
   cancel other applications' speech too. A screen reader sharing the daemon is a real scenario on
   this exact desktop (`orca` is in the manifest). Cancel semantics need a design decision, not a
   flag.
2. **`PlaybackQueue` has nothing to schedule.** Our pacing, our queue depth, our barge-in flush and
   the ~970 ms inter-chunk gap all live in a layer that this rung bypasses entirely. The rung is
   sequenced only by `--wait` blocking. Any timing the Voice Lab tunes on macOS means nothing here.
3. **`ProviderCapabilities` cannot express it.** There is no `ownsPlayback` flag, so a caller cannot
   tell that `generate()` will yield zero chunks *and* that this is success rather than failure.
   Today that distinction is carried only by a comment and by `notify()`.

**The shape of the answer, for the design round to weigh:** either `TtsProvider` grows an explicit
`ownsPlayback: true` rung (honest, and forces every caller to handle both), or Linux gets a
*separate provider* (`SpeechDispatcherProvider`) selected by the registry, so `OsSynthProvider`
keeps the one clean contract and the exception is visible in the type system rather than inside a
branch. I did not choose between them; both change the seam, and that is a design decision.

### The honest bottom line

**A stock Ubuntu 24.04 desktop cannot produce a captured WAV without installing a package.** There
is no second synthesizer on the image, speech-dispatcher has no file output at any layer, and its
one file-capable plugin is opened in live mode. What the image *can* do is speak, through
speech-dispatcher, on a rung where the system owns the audio.

So the shipped behaviour is: use `espeak-ng` when it is there; speak through speech-dispatcher when
it is not; and when neither exists, fail **loudly** with the binary name and
`sudo apt install espeak-ng`. That last outcome is not a fallback we are embarrassed by — it is the
correct end of the ladder, and it is now the only one that says so out loud.

## Notes for whoever picks this up

- `docs/.research/pitfalls-pending.md` (written by another agent, staged to avoid the P24 collision)
  contains a draft entry for the espeak-ng finding and one for the tracked `dist/`. **I have now
  written both into `PITFALLS.md` as P25 and P26 — drop those two from the pending file rather than
  merging them again.** Its other two entries (ORCA dev profiles, voice-name portability) are
  untouched by me and still need numbers.
- `subprocess-sink.ts` tries `paplay` first on Linux and the reference desktop does not have it.
  Small, real, not in my brief — left alone deliberately.
- `expandNumbers` is still one flag driving two behaviours (H16). Untouched; it should be split
  before M12 freezes the settings schema.
- **P29** records the `--stdout` trap. Anyone optimizing the temp file away needs to read it first.
- The provider-seam question in "Round 2" is the one item here that is design work, not a fix. It
  belongs in `docs/.discussion/`, and I deliberately did not write there — other agents are.
