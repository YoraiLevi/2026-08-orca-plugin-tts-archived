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
