# Q-round 1 — platform capability probe (Q31, Q33, Q16, Q17)

**Written:** 2026-08-21 · **Machine:** macOS 26.5 (build 25F71), Apple Silicon.
**Governs:** `docs/.discussion/000-open-questions.md` Q16, Q17, Q31, Q33.

Every claim below carries one of two labels:

| Label | Meaning |
|---|---|
| **MEASURED** | The command was run on this machine, on this date. Its real output is pasted. |
| **DOCUMENTED** | Taken from a primary source (vendor docs, upstream source, package manifest, registry API) with the URL or `file:line` given. **Not run here.** |

No claim in this file is a recollection. Where neither label can be applied, the question is marked
**UNRESOLVABLE** and the exact probe plus the OS required to run it is written out.

---

## Summary table — voices per platform

| Platform | Enumeration surface | Total voices | English | Usable & installed-by-default for per-agent assignment | Label |
|---|---|---|---|---|---|
| macOS 26.5 | `say -v ?` | **184** | 43 lines / 41 distinct voices | **22 speech voices + 19 novelty = 41** (all verified to produce distinct audio) | MEASURED |
| macOS 26.5 | `AVSpeechSynthesisVoice.speechVoices()` | **180** | 41 | same set, all `quality == 1` (compact); zero enhanced/premium installed | MEASURED |
| Windows 11 (stock, en-US) | `System.Speech` `GetInstalledVoices()` under **Windows PowerShell 5.1** (.NET Framework) — what our provider spawns today | **~2** (`Microsoft David Desktop`, `Microsoft Zira Desktop`) | ~2 | **2** | DOCUMENTED |
| Windows 11 (stock, en-US) | `System.Speech` under **.NET 10+** (`pwsh`) | 2 SAPI5 Desktop **+ the OneCore set** | more | not counted — needs the probe below | DOCUMENTED |
| Linux, stock Ubuntu 24.04.3 desktop | `espeak-ng --voices` | **CLI NOT INSTALLED** | — | **0 via the path our provider uses today** | DOCUMENTED |
| Linux, stock Ubuntu 24.04.3 desktop | `spd-say -L` (speech-dispatcher **is** installed) | espeak-ng backend: 104 variants × 8 English language files | large | **8 named voice-types (`-t`) guaranteed by the CLI contract**, plus `-y` synthesis-voice names | DOCUMENTED |

**The load-bearing number is 2.** A design that requires N distinct voices to work has N ≤ 2 on a
stock Windows install, and N = 0 on stock Linux through the code path we ship today.

---

## Q31 — What voice list does each platform actually expose?

### Verdict

**RESOLVED.** macOS is voice-rich (41 usable English voices, all verified distinct). Windows stock
is voice-poor (2). Linux stock exposes **zero through our current code path** because the
`espeak-ng` binary is not installed on a stock Ubuntu desktop — only the shared library is. The
three platforms share **no voice name in common**, so a per-agent voice map cannot be portable data;
it must be computed at runtime from each host's own list.

### macOS — MEASURED

```
$ sw_vers
ProductName:		macOS
ProductVersion:		26.5
BuildVersion:		25F71

$ say -v '?' | wc -l
     184

$ say -v '?' | grep -oE ' en_[A-Z]{2}' | sort | uniq -c
   1  en_AU
   9  en_GB
   1  en_IE
   3  en_IN
  28  en_US
   1  en_ZA
```

Total 43 English lines. Two of those lines are `Aman en_IN` / `Tara en_IN` variants and one
(`en_IN Rishi`) is the compact voice; `AVSpeechSynthesisVoice` reports 41 distinct English voice
objects, which is the number to trust.

**Are they installed, or listed-but-absent?** Verified by effect — each was asked to synthesize
"the quick brown fox" to a WAV and the checksums compared:

```
$ for v in Samantha Daniel Karen Moira Tessa Rishi Fred Ralph Albert Junior Kathy \
    "Flo (English (US))" "Reed (English (US))" "Rocko (English (US))" "Sandy (English (US))" \
    "Shelley (English (US))" "Eddy (English (US))" "Grandma (English (US))" \
    "Grandpa (English (US))" Zarvox Whisper Trinoids Bells Boing; do ...; done

Samantha                 ok  bytes=59924    md5=caba1118fd9a63d76ab3be1d6b0be621
Daniel                   ok  bytes=67596    md5=f5f10ccf735947758fdc9055b02de5ed
Karen                    ok  bytes=58548    md5=147e4efa52f051416863077c9676b6a8
Moira                    ok  bytes=63056    md5=09551aa1dbd4670c125b7a9a86e884bc
Tessa                    ok  bytes=65896    md5=27a68eb74def6a96640e3f4ebab14d96
Rishi                    ok  bytes=62864    md5=125217a423e7c062a758b145b97a5787
Fred                     ok  bytes=69408    md5=37311d2996d88a6cfcd64bd135c6c974
Ralph                    ok  bytes=71968    md5=23fc8480114297202ec16e21e1f14674
Albert                   ok  bytes=88864    md5=a562f671103f4843c09a7cd77c8ff3be
Junior                   ok  bytes=71968    md5=b4cb9d775fdcb2a1254409e9160a26ac
Kathy                    ok  bytes=71968    md5=3f7383a2c5699ea8e42d47cd6efe30cb
Flo (English (US))       ok  bytes=82354    md5=f670f2c5a01c35c7eba25a1888c5c2f7
Reed (English (US))      ok  bytes=82358    md5=d4f7d4d4d6019ca41561bf28034e52e2
Rocko (English (US))     ok  bytes=82358    md5=3796d7597e174a713218546a225a5bd8
Sandy (English (US))     ok  bytes=82356    md5=17c49cdfefa10f2ce8d9656c86315088
Shelley (English (US))   ok  bytes=82354    md5=6f67ea7d667515e05f8a5011d76f92c3
Eddy (English (US))      ok  bytes=82358    md5=a0b6f06cb14e320cd22478cd51c06357
Grandma (English (US))   ok  bytes=82354    md5=551f4fbf5cd480c2f835d6ea4cf24dc7
Grandpa (English (US))   ok  bytes=82358    md5=1644707af49139233def752b3b9c9a48
Zarvox                   ok  bytes=69408    md5=0c2872976483b35f9a426fb82a51f911
Whisper                  ok  bytes=74528    md5=7e93bdab7b182c17896ac38298c9e7b3
Trinoids                 ok  bytes=69408    md5=af3337915b046a103da7bd877c659253
Bells                    ok  bytes=128800   md5=fcd10775e03f66f28ce03c1905dd2ce8
Boing                    ok  bytes=81696    md5=54657364703e4a1a52bbeb7cc0ae9d19

$ md5 -q v_*.wav | sort -u | wc -l
      24
```

24 voices requested, 24 distinct checksums, zero failures. **All are installed, and all sound
different.** The set breaks down as:

| Group | Count (English) | Character |
|---|---|---|
| Compact locale voices (`com.apple.voice.compact.*`) | 6 — Samantha en-US, Daniel en-GB, Moira en-IE, Rishi en-IN, Tessa en-ZA, Karen en-AU | ordinary speech quality; distinguished by accent |
| Eloquence (`com.apple.eloquence.*`) | 16 — Eddy/Flo/Grandma/Grandpa/Reed/Rocko/Sandy/Shelley × en-US and en-GB | strongly characterful; the natural per-agent set |
| Legacy MacinTalk (`com.apple.speech.synthesis.voice.*`) | 19 — Albert, Bad News, Bahh, Bells, Boing, Bubbles, Cellos, Wobble, Fred, Good News, Jester, Junior, Kathy, Organ, Superstar, Ralph, Trinoids, Whisper, Zarvox | mostly novelty; several are unintelligible for prose |

Quality tier — MEASURED via a compiled Swift probe (`scratchpad/probe.swift`):

```
TOTAL_AVSPEECH_VOICES=180
QUALITY_RAWVALUE_HISTOGRAM=["1": 180]  // 1=default 2=enhanced 3=premium
EN_VOICES=41
EN_US_VOICES=28
EN_QUALITY_HISTOGRAM=[1: 41]
```

Every installed voice on this machine is `quality == .default` (compact). Enhanced and Premium
voices exist but are **optional downloads** (System Settings → Accessibility → Spoken Content →
System Voice → Manage Voices) and none are present here. See "Unused capabilities" below.

#### macOS silent-fallback hazard — MEASURED, and it is a P18-shaped trap

```
$ say -v "NotAVoiceAtAll" -o junk.wav --data-format=LEI16@22050 "the quick brown fox"; echo "exit=$?"
exit=0
-rw-r--r--@ 1 m5air  wheel  59924 Aug 21 01:37 junk.wav

Samantha md5: caba1118fd9a63d76ab3be1d6b0be621
Alex     md5: caba1118fd9a63d76ab3be1d6b0be621     <- Alex is NOT in `say -v ?` on this machine
junk     md5: caba1118fd9a63d76ab3be1d6b0be621
```

`say` accepts an unknown voice name, **exits 0, writes a full-length WAV, and silently substitutes
the fallback voice.** Three different `-v` arguments produced byte-identical audio. Two per-agent
voices that both fail to resolve therefore sound *identical* and nothing anywhere reports a problem
— exactly the failure shape of PITFALLS P18 (a wrong name degrading silently to apparent success).

### Windows — DOCUMENTED

Our provider spawns `powershell` (`packages/providers/src/os-synth/index.ts:97-103`), i.e. **Windows
PowerShell 5.1 on .NET Framework**, and calls
`(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices()`.

1. **`GetInstalledVoices` reads the registry, and until .NET 10 it read only the SAPI5 key.**
   Upstream source, `dotnet/runtime`,
   `src/libraries/System.Speech/src/Internal/ObjectToken/SAPICategories.cs:61-70`:
   ```
   private const string SpeechRegistryKey        = @"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech\";
   private const string SpeechOneCoreRegistryKey = @"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech_OneCore\";
   internal const string Voices          = SpeechRegistryKey + "Voices";
   internal const string Voices_OneCore  = SpeechOneCoreRegistryKey + "Voices";
   ```
   and `src/libraries/System.Speech/src/Internal/Synthesis/VoiceSynthesis.cs:1465-1477`:
   ```
   private static List<InstalledVoice> BuildInstalledVoices(VoiceSynthesis voiceSynthesizer)
   {
       List<InstalledVoice> voices = new();
       ReadOnlySpan<string> categoryIds = [SAPICategories.Voices, SAPICategories.Voices_OneCore];
   ```

2. **That second key was added on 2025-01-06 and ships in .NET 10, not before.** MEASURED against
   the raw branches:
   ```
   $ for b in release/9.0 release/10.0 main; do
       curl -sL ".../dotnet/runtime/$b/.../SAPICategories.cs" | grep -c 'Voices_OneCore'; done
   release/9.0  : Voices_OneCore occurrences = 0
   release/10.0 : Voices_OneCore occurrences = 1
   main         : Voices_OneCore occurrences = 1
   ```
   Commit history for that file (`gh api repos/dotnet/runtime/commits`):
   ```
   2025-01-06T21:56:04Z  38366f09  Update System.Speech to also recognize Speech_OneCore (#110123)
   2021-01-08T03:04:13Z  1b1ff800  Port System.Speech to .NET Core (#45941)
   ```

3. **The originating issue states the pre-fix behaviour explicitly.**
   [dotnet/runtime#110120](https://github.com/dotnet/runtime/issues/110120), *"System.Speech should
   work with OneCore voices"*:
   > `System.Speech` doesn't work with OneCore voices out of the box. While the result of
   > `new SpeechSynthesizer().GetInstalledVoices(CultureInfo.GetCultureInfo("ja-JP"));` includes
   > `Microsoft Haruka Desktop`, it doesn't include `Microsoft Ayumi`, `Microsoft Sayaka`, etc.

4. **The voices Windows ships for the SAPI5 key are the `*Desktop` pair.** Microsoft's own
   `GetInstalledVoices(CultureInfo)` page
   (<https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer.getinstalledvoices>)
   states the shipped-engine language coverage:
   > The speech synthesis engines that shipped with Microsoft Windows 7 work with the following
   > language-country codes: en-US. English (United States) · zh-CN. Chinese (China) · zh-TW.
   > Chinese (Taiwan)
   The named en-US pair on Windows 10/11 is `Microsoft David Desktop` and `Microsoft Zira Desktop`
   (corroborated by
   [StackOverflow 77443751](https://stackoverflow.com/questions/77443751/how-to-access-newly-added-natural-voices-in-powershell-after-windows-11-update):
   *"On Windows 10/11, built-in SAPI voices have names ending in 'Desktop', such as Microsoft Zira
   Desktop. The voices shown in System Settings > Time & language > Speech > Voices are OneCore
   voices, which are the voices in Speech_OneCore registry key."*). This corroborates PITFALLS P16.

**Windows verdict: 2 installed-by-default, distinct, usable voices through the code path we ship.**
Both are en-US. One is male (David), one female (Zira) — so gender is the *only* distinguishing axis
available for free.

**Also DOCUMENTED, and a live bug risk:** `SelectVoice(name)` — which our provider emits verbatim —
does a *substring* match, per Microsoft's `SelectVoice` page
(<https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer.selectvoice>):
> The `SpeechSynthesizer` object selects the first installed voice that contains `name` in the
> voice's `VoiceInfo.Name` property. The `SpeechSynthesizer` performs a case-sensitive, substring
> comparison to determine if the voice matches the name.

So `SelectVoice('David')` matches `Microsoft David Desktop` (convenient), but a short or ambiguous
per-agent voice id can bind to the wrong voice without any error.

### Linux — DOCUMENTED, and this is the sharpest finding in the file

Our provider synthesizes on Linux with `espeak-ng -w <file>`
(`packages/providers/src/os-synth/index.ts:161-166`). **`/usr/bin/espeak-ng` is not present on a
stock Ubuntu desktop.**

Primary source: the official Ubuntu 24.04.3 desktop image package manifest,
<https://releases.ubuntu.com/24.04/ubuntu-24.04.3-desktop-amd64.manifest> (1,819 packages):

```
$ curl -sfL https://releases.ubuntu.com/24.04/ubuntu-24.04.3-desktop-amd64.manifest | grep -i espeak
espeak-ng-data:amd64            1.51+dfsg-12build1
libespeak-ng1:amd64             1.51+dfsg-12build1
speech-dispatcher-espeak-ng     0.12.0~rc2-2build3

$ ... | awk '$1=="espeak-ng"||$1=="espeak-ng:amd64"{print "FOUND: "$0}'
(nothing)

$ ... | grep -iE '^(speech-dispatcher|libspeechd|orca)'
libspeechd2:amd64                       0.12.0~rc2-2build3
orca                                    46.1-1ubuntu1
speech-dispatcher                       0.12.0~rc2-2build3
speech-dispatcher-audio-plugins:amd64   0.12.0~rc2-2build3
speech-dispatcher-espeak-ng             0.12.0~rc2-2build3
```

The image ships the espeak-ng **shared library and data** (because speech-dispatcher's espeak-ng
backend links them) but **not the `espeak-ng` command-line binary**, which lives in its own package:

```
$ https://packages.ubuntu.com/search?searchon=contents&keywords=espeak-ng&mode=exactfilename&suite=noble&arch=amd64
/usr/bin/espeak-ng -> espeak-ng          <- package NOT in the desktop manifest
/usr/bin/spd-say   -> speech-dispatcher  <- package IS in the desktop manifest
```

So on a stock Ubuntu 24.04 desktop:

- `espeak-ng --voices` → **command not found**. Our `#capture('espeak-ng', ['--version'])` fallback
  and our `espeak-ng -w` synthesis both fail. `listVoices()` catches and returns `[]`; `generate()`
  throws `OsSynthUnavailableError`. **On the floor of the degradation ladder, on a stock desktop,
  we produce no sound at all.**
- `spd-say -L` → **works**, and our `listVoices()` already tries it first
  (`index.ts:105`, using the long form `--list-synthesis-voices`). But `spd-say` **cannot write a
  WAV** — see Q33 — so the list is enumerable while the audio is not reachable through it.

**What espeak-ng's voice inventory would be if the binary were installed** (upstream repo contents,
`espeak-ng/espeak-ng@master`):

```
$ gh api repos/espeak-ng/espeak-ng/contents/espeak-ng-data/voices/%21v --jq '.|length'
104
```
104 voice *variants* — `m1`–`m8`, `f1`–`f5`, `klatt`–`klatt6`, `croak`, `whisper`, `whisperf`,
`robosoft`–`robosoft8`, plus ~70 named personas (Alex, Annie, Andy, Storm, grandma, grandpa, …) —
each usable as `-v en-US+f3`. Plus 8 usable English language files
(`gh api .../espeak-ng-data/lang/gmw`): `en`, `en-029`, `en-GB-scotland`, `en-GB-x-gbclan`,
`en-GB-x-gbcwmd`, `en-GB-x-rp`, `en-US`, `en-US-nyc` (`en-Shaw` is Shavian orthography, not a
speaking voice). That is 8 × 104 ≈ 830 addressable combinations — *if the binary is present*.

### The overlap question

**Zero.** No voice name is shared between the three platforms. macOS names (`Samantha`), Windows
names (`Microsoft Zira Desktop`), and espeak-ng names (`en-US+f3`) come from three unrelated
namespaces. A per-agent voice assignment must therefore be **an index into the host's own runtime
list**, never a hard-coded name, and never persisted as a name across machines.

### Design consequence

M15 per-agent voices must be designed for **N = 2** and *degrade upward*, not designed for macOS's
41 and degrade downward; and the Linux OS-synth path must move off the `espeak-ng` binary (or
declare the dependency and detect its absence loudly) before it can claim R1 parity at all.

---

## Q33 — What other axes can each platform vary per utterance?

### Verdict

**RESOLVED.** All three platforms expose **rate**; all three expose **pitch and volume**, but on
macOS pitch/volume are reachable *only* through in-band `[[...]]` speech commands, not CLI flags,
and on Linux the pitch/volume flags live on `spd-say` — the client we cannot get a WAV out of.
Our provider currently passes **voice and rate only, on every platform.**

### What we pass today — cited from our own code

`packages/providers/src/os-synth/index.ts`, `#command()`:

| Platform | Line | What we emit | Axes used |
|---|---|---|---|
| darwin | 140-147 | `say -o <f> --data-format=LEI16@22050 [-v voice] [-r rate*175] <text>` | voice, rate |
| win32 | 148-160 | `$s.SelectVoice(voice); $s.Rate = clamp((rate-1)*10, -10, 10); $s.SetOutputToWaveFile(f); $s.Speak(text)` | voice, rate |
| linux | 161-166 | `espeak-ng -w <f> [-v voice] <text>` | voice only — **rate is dropped on Linux** |

The `SynthesizeOptions` type carries `voice` and `rate`; there is no `pitch` and no `volume` field
anywhere in the provider. Note the asymmetry: `opts.rate` is honoured on macOS and Windows and
**silently ignored on Linux**.

### macOS — MEASURED

`man say` (macOS 26.5) lists exactly one prosody flag:

```
-r rate, --rate=rate
    Speech rate to be used, in words per minute.
```

There is **no** `-p`/pitch and **no** volume flag. Pitch and volume are reachable through the
Speech Synthesis Manager's in-band embedded commands, which `say` passes through — the man page's
own example is `say -o hi.aac 'Hello, [[slnc 200]] World'`. Verified by effect:

```
=== RATE axis: -r 120 vs -r 250 (Samantha) ===
r120 bytes=65404   r250 bytes=44996                       <- audio length moved

=== PITCH via [[pbas]] ===
pbas30 md5=aa6f02dcbbc38af969484ae9c065978e bytes=59924
pbas70 md5=7f39c521eb0c9534dce12f20a0a936af bytes=59924   <- same length, different samples

=== VOLUME via [[volm]] ===
volm0.2 md5=6db1a7e2c1bcabced090e9e92c6cca3f
volm1.0 md5=caba1118fd9a63d76ab3be1d6b0be621              <- differs, and volm 1.0 == the plain baseline

=== SILENCE via [[slnc]] ===
no-slnc  bytes=30272
slnc2000 bytes=143936                                     <- +113 KB ≈ 2.0 s at 22.05 kHz mono 16-bit
```

All four axes move a named value. `[[volm 1.0]]` reproducing the unmodified baseline checksum
exactly is the control that proves the probe could have failed.

**Caveat, MEASURED:** `[[...]]` is in-band. Any user text containing `[[` would be interpreted as a
command. If we adopt embedded commands we must escape `[[` in normalized text.

### Windows — DOCUMENTED

`System.Speech.Synthesis.SpeechSynthesizer` public surface, `dotnet/runtime`
`src/libraries/System.Speech/ref/System.Speech.cs`:

```
public int Rate   { get; set; }     // -10 .. 10
public int Volume { get; set; }     //   0 .. 100
// no Pitch property
public void SpeakSsml(string textToSpeak);
public Prompt SpeakSsmlAsync(string textToSpeak);
```

- **Rate:** yes, property, already used by our provider.
- **Volume:** yes, property, **not used by us.** One-line change.
- **Pitch:** **not a property.** Only reachable via `SpeakSsml` with
  `<prosody pitch="...">`, or via a `PromptBuilder` with `PromptStyle`. Adopting a per-agent pitch
  on Windows therefore means switching the PowerShell snippet from `$s.Speak(...)` to
  `$s.SpeakSsml(...)` and XML-escaping the text.

### Linux — DOCUMENTED

Two different CLIs with two different capability sets. Upstream sources:

**`espeak-ng`** — `espeak-ng/espeak-ng@master`, `src/espeak-ng.c` help text (lines 49-125):

```
-a <integer>   Amplitude, 0 to 200, default is 100
-g <integer>   Word gap. Pause between words, units of 10mS at the default speed
-p <integer>   Pitch adjustment, 0 to 99, default is 50
-P <integer>   Pitch range adjustment, 0 to 99, default is 50
-s <integer>   Speed in approximate words per minute. The default is 175
-v <voice name>  Use voice file of this name from espeak-ng-data/voices
-w <wave file name>  Write speech to this WAV file, rather than speaking it directly
-m             Interpret SSML markup, and ignore other < > tags
--ssml-break=<percentage>   Set SSML break time multiplier, default is 100
--stdout       Write speech output to stdout
```

Rate (`-s`), pitch (`-p`), pitch-range (`-P`), volume (`-a`), word-gap (`-g`), SSML (`-m`) — the
richest of the three surfaces. **We use none of them except `-v`.**

**`spd-say`** — `brailcom/speechd@master`, `src/clients/say/options.c` usage block:

```
-r, --rate            Set the rate of the speech          (between -100 and +100, default: 0)
-p, --pitch           Set the pitch of the speech         (between -100 and +100, default: 0)
-R, --pitch-range     Set the pitch range of the speech   (between -100 and +100, default: 0)
-i, --volume          Set the volume (intensity)          (between -100 and +100, default: 0)
-t, --voice-type      Set the preferred voice type
                      (male1, male2, male3, female1, female2, female3, child_male, child_female)
-y, --synthesis-voice Set the synthesis voice
-L, --list-synthesis-voices   Get the list of synthesis voices
-m, --punctuation-mode        (none, some, most, all)
-x, --ssml            Set SSML mode on (default: off)
-S, --stop            Stop speaking the message being spoken
-C, --cancel          Cancel all messages
-w, --wait            Wait till the message is spoken or discarded
```

`spd-say` offers **eight named voice types even when the backend has one engine** — that is the
per-agent axis that survives on a voice-poor Linux. But note what is **absent**: there is no
write-to-file option. `-w` is `--wait`, not "write wav". `spd-say` hands text to the
speech-dispatcher daemon, which owns playback. That is the Linux twin of PITFALLS P9 — the
enumerable path and the capturable path are not the same path.

### Design consequence

Per-agent identity should be a **tuple** — `(voice, rate, pitch)` — not a voice alone, because the
tuple is the only thing that has enough cardinality on all three platforms; Windows gets 2 voices
× a pitch ladder via SSML, Linux gets 8 voice-types × pitch, and macOS gets 41 voices and can leave
pitch at default.

---

## Q16 — Does sherpa-onnx STT have the same platform gaps as its TTS side?

### Verdict

**RESOLVED — yes, identically, because it is the same binary.** STT inherits P7 and P13 exactly:
no `win-arm64` on npm; a `win-arm64` build *does* exist on GitHub releases. There is no *additional*
STT-specific gap, and no STT-specific relief either.

### Evidence — the npm gap is unchanged at the current latest — MEASURED

```
$ curl -sL https://registry.npmjs.org/sherpa-onnx-node | ...
latest: 1.13.6
optionalDependencies: {
 "sherpa-onnx-darwin-arm64": "^1.13.6",
 "sherpa-onnx-darwin-x64":   "^1.13.6",
 "sherpa-onnx-linux-x64":    "^1.13.6",
 "sherpa-onnx-linux-arm64":  "^1.13.6",
 "sherpa-onnx-win-x64":      "^1.13.6",
 "sherpa-onnx-win-ia32":     "^1.13.6"
}

$ for p in sherpa-onnx-win-arm64 sherpa-onnx-win-x64 sherpa-onnx-linux-arm64 sherpa-onnx-darwin-arm64; do ...; done
sherpa-onnx-win-arm64    -> HTTP 404
sherpa-onnx-win-x64      -> HTTP 200
sherpa-onnx-linux-arm64  -> HTTP 200
sherpa-onnx-darwin-arm64 -> HTTP 200
```

Six platform packages, no `win-arm64`. P13 still holds at the version we are on; it has not been
fixed upstream.

### Evidence — STT and TTS share one native binary — MEASURED

```
$ curl -sL https://data.jsdelivr.com/v1/packages/npm/sherpa-onnx-node@1.13.6   (JS layer)
addon.js  audio-tagg.js  keyword-spotter.js  non-streaming-asr.js
non-streaming-speaker-diarization.js  non-streaming-speech-denoiser.js
non-streaming-tts.js  online-speech-denoiser.js  punctuation.js  resampler.js
sherpa-onnx.js  speaker-identification.js  spoken-language-identification.js
streaming-asr.js  types.js  vad.js

$ curl -sL https://data.jsdelivr.com/v1/packages/npm/sherpa-onnx-win-x64@1.13.6   (native layer)
index.js                          49
onnxruntime.dll            17,378,304
onnxruntime_providers_shared.dll  104,960
sherpa-onnx.node              671,744
sherpa-onnx-c-api.dll       4,590,592
sherpa-onnx-cxx-api.dll       258,560
```

There is exactly **one** `sherpa-onnx.node` and **one** `sherpa-onnx-c-api.dll`. `streaming-asr.js`,
`non-streaming-asr.js` and `non-streaming-tts.js` are all thin JS over that same addon. STT cannot
have a different platform matrix from TTS because it *is* the same matrix. This confirms HANDOFF's
"one dependency covers TTS + future STT + VAD + keyword spotting" and extends it: one dependency
also means **one shared parity gap**.

### Evidence — GitHub releases do carry win-arm64, including an ASR-only build — MEASURED

```
$ gh/curl api.github.com/repos/k2-fsa/sherpa-onnx/releases/tags/v1.13.6   (283 assets)
sherpa-onnx-v1.13.6-win-arm64-shared-MD-Release.tar.bz2            19.4 MB
sherpa-onnx-v1.13.6-win-arm64-shared-MD-Release-no-tts.tar.bz2     18.0 MB   <- ASR-only build
sherpa-onnx-v1.13.6-win-arm64-shared-MD-MinSizeRel.tar.bz2         16.5 MB
sherpa-onnx-v1.13.6-win-arm64-shared-MD-MinSizeRel-no-tts.tar.bz2  15.4 MB
sherpa-onnx-v1.13.6-win-arm64-jni.tar.bz2                           7.3 MB
```

New detail beyond P13: upstream publishes explicit `-no-tts` variants. If we ever ship an
STT-only or TTS-only sidecar, the `MinSizeRel` `-no-tts` build is 15.4 MB compressed rather than
19.4 MB — worth ~4 MB of first-run download.

### Corroboration in ORCA's own code

ORCA hit the same gap and hardcoded around it. `~/source/orca` @ `87097551`,
`src/main/speech/stt-service.ts`, `getSherpaModulePath()`:

```ts
const nativePkg =
  process.platform === 'win32' && process.arch === 'x64'
    ? 'sherpa-onnx-win-x64'
    : `sherpa-onnx-${process.platform}-${process.arch}`
```

Windows-on-ARM falls through to `sherpa-onnx-win32-arm64`, which does not exist on npm — so ORCA's
first-party STT is broken on Windows-on-ARM in exactly the way P7 describes for TTS.

### Design consequence

There is nothing to decide separately for STT: the `win-arm64` fetch-from-GitHub-releases plan
already required for TTS (P13) covers voice input too, and Windows-on-ARM STT has **no OS fallback
equivalent to SAPI** — if we skip the GitHub-release path, voice input simply does not exist there.

---

## Q17 — Model size for a usable local STT against the 50 MB / 2,000 file cap

### Verdict

**RESOLVED, and the answer is plainly no: nothing usable fits under 50 MB.** The smallest
English-capable STT model ORCA itself ships is **87.7 MiB** — 1.75× the entire plugin budget — and
the recommended one is **639.4 MiB**, 12.8×. This is a finding, not a failure: it simply confirms
that STT models must live in a runtime cache outside the content-hash-verified install tree,
exactly as PITFALLS P4 already concluded for TTS voices.

### Evidence — ORCA's pinned catalog, with per-file byte counts — MEASURED

Computed from `~/source/orca` @ `87097551`, `src/main/speech/model-download-catalog.ts`, which
records an exact `sizeBytes` and `sha256` per file at a pinned Hugging Face revision:

| Total | Files | Model id | English? | Streaming? |
|---:|---:|---|---|---|
| **639.4 MiB** | 4 | `parakeet-tdt-0.6b-v3-int8` — ORCA's `recommended: true` | multilingual | no |
| **630.6 MiB** | 4 | `parakeet-tdt-0.6b-v2-int8` | en | no |
| **625.2 MiB** | 2 | `parakeet-tdt-ctc-0.6b-ja-int8` | ja | no |
| **340.3 MiB** | 5 | `zipformer-bilingual-zh-en` | zh-en | yes |
| **228.5 MiB** | 2 | `sense-voice-zh-en-ja-ko-yue` | multilingual | no |
| **226.2 MiB** | 3 | `paraformer-bilingual-zh-en` | zh-en | yes |
| **145.9 MiB** | 3 | `whisper-tiny` | multilingual | no |
| **126.3 MiB** | 4 | `zipformer-streaming-korean` | ko | yes |
| **87.7 MiB** | 4 | **`zipformer-streaming-en-20m`** — smallest English | en | **yes** |
| 53.0 MiB | 4 | `zipformer-streaming-zh-14m` | zh only | yes |

The only entry under the 50 MB cap does not exist; the only one close is Chinese-only.
`zipformer-streaming-en-20m` breaks down as `encoder 88,804,590 B` + `decoder 2,092,272 B` +
`joiner 1,026,462 B` + `tokens.txt`. **The encoder alone is 84.7 MiB — 1.7× the cap.**

### Evidence — the smallest plausible alternative also does not fit — MEASURED

Moonshine tiny (English-only, the smallest well-regarded modern English ASR in sherpa's catalog):

```
$ https://huggingface.co/api/models/csukuangfj/sherpa-onnx-moonshine-tiny-en-int8/tree/main
     6.5 MiB  preprocess.onnx
    17.4 MiB  encode.int8.onnx
    43.2 MiB  cached_decode.int8.onnx
    50.8 MiB  uncached_decode.int8.onnx
     0.4 MiB  tokens.txt
   TOTAL 119.0 MiB (12 files)
```

118.3 MiB of ONNX for the tiny, already-int8-quantized English model. `uncached_decode.int8.onnx`
**by itself** exceeds the 50 MB plugin cap.

There is one asset that is smaller as a *compressed archive*:
`sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27.tar.bz2` at **29.9 MB compressed** in the
`asr-models` release. Its **extracted** size is **UNMEASURED** — its Hugging Face mirror returned
`{'error': 'Invalid username or password.'}` and the brief forbids downloading models. Even if it
extracted to under 50 MB, it would consume the entire plugin budget with zero left for `main.mjs`,
and it would still be an immutable content-hashed artifact that could never be updated without
republishing the plugin.

**Probe to settle the residual, if anyone wants it (runnable on any OS):**
```
curl -L -o m.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27.tar.bz2
tar xjf m.tar.bz2 && du -sb sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27 && find . -type f | wc -l
```

### The file-count half of the cap is not the problem

Every candidate is 2-5 model files. `MAX_PLUGIN_FILES = 2_000` is never the binding constraint for
models; `MAX_PLUGIN_TOTAL_BYTES` is, by 1.7× to 12.8×.

### Design consequence

M17 voice input must reuse the P4/P8 runtime-cache design wholesale — download outside the install
tree, ASCII-relocated cache path on Windows, resumable, hash-verified — and the plugin must be
usable (and say so) while no STT model is present. Reusing ORCA's own catalog IDs and pinned
revisions is the cheapest correct path, since ORCA already ships the downloader, the hashes and the
Windows non-ASCII-path workaround.

---

## Unused capabilities — reported unprompted

Each row is a platform capability we are **not** using today that would measurably improve the
listening experience. Ordered by value-to-effort.

### 1. Word-boundary callbacks exist on all three platforms — MEASURED on macOS, DOCUMENTED elsewhere

This is the enabling primitive for "highlight the word being spoken", and for a *precise* resume
after barge-in (Q19) rather than "discard or restart".

**macOS — MEASURED.** Compiled Swift probe against `AVSpeechSynthesizer`:

```
UTTERANCE_KNOBS rate=0.5 pitchMultiplier=1.0 volume=1.0 preUtteranceDelay=0.0 postUtteranceDelay=0.0
PCM_FRAMES_WRITTEN=55050
WORD_BOUNDARY_CALLBACKS=9
WORD_RANGES=["The", "quick", "brown", "fox", "jumps", "over", "the", "lazy", "dog."]
DELEGATE_EVENTS=["didStart", "didFinish"]
SSML_INIT=ok speechString="Hello   world"
```

Nine words in, nine `willSpeakRangeOfSpeechString` callbacks out, each carrying the exact
`NSRange` in the source string — and this ran **headless**, via `synth.write(_:toBufferCallback:)`,
producing 55,050 PCM frames without touching an audio device. That same call is the answer to
PITFALLS P9/P10: `AVSpeechSynthesizer.write` hands us PCM buffers directly, with **no 414 ms
process spawn** and **no unseekable-file problem**. A Swift sidecar gets streaming PCM, word
boundaries, and `pauseSpeaking(at:)`/`continueSpeaking()` from one API.

**Windows — DOCUMENTED.** `System.Speech.cs` reference surface (above) exposes
`event SpeakProgress` (word-level), `event PhonemeReached`, `event VisemeReached` (mouth shapes),
`event BookmarkReached`, plus `SetOutputToAudioStream(Stream, SpeechAudioFormatInfo)` — a real
streaming sink, which our current `SetOutputToWaveFile` gives up.

**Linux — DOCUMENTED.** speech-dispatcher's protocol reports index marks; `spd-say -x/--ssml`
accepts SSML `<mark>` elements. Reaching them needs the SSIP socket rather than the `spd-say`
one-shot CLI.

### 2. Pause / resume as distinct from stop — DOCUMENTED on all three, unused on all three

- macOS: `AVSpeechSynthesizer.pauseSpeaking(at: .word | .immediate)` / `continueSpeaking()`.
  The `.word` boundary option means "finish the current word, then pause" — which is what a listener
  actually wants.
- Windows: `SpeechSynthesizer.Pause()` / `Resume()`, and `SynthesizerState` to query.
- Linux: `spd-say -S/--stop` and `-C/--cancel` distinguish *stop this message* from *cancel the
  queue*; the SSIP protocol adds `PAUSE`/`RESUME`.

Today `cancel()` in our provider is `SIGKILL` on the child — a hard stop with no resume. Given P22
("reading something you didn't ask for and can't stop is worse than silence"), a *pause* that keeps
position is a distinct, cheap control worth having next to skip and stop.

### 3. SSML — available on all three, used on none

- macOS: `AVSpeechUtterance(ssmlRepresentation:)` — **MEASURED**, returned non-nil and parsed a
  `<break time="500ms"/>` into the speech string. `say` itself does **not** take SSML; it takes the
  older `[[...]]` embedded commands (also measured, all four work).
- Windows: `SpeakSsml` / `SpeakSsmlAsync` — the only route to pitch on Windows.
- Linux: `espeak-ng -m` and `--ssml-break=<percentage>`; `spd-say -x`.

The HANDOFF "what listening taught us" table is largely a list of *prosody* fixes — "omissions
abrupt", "table rows too quick", "headings become pauses". Those are precisely what
`<break>`, `<prosody rate>` and `<emphasis>` express declaratively. Our 12-stage normalizer
currently has to fake pauses with punctuation. Adopting SSML would make the Voice Lab's
stage-by-stage output far more directly tunable.

### 4. Voice quality tiers behind a one-time download — DOCUMENTED (macOS), MEASURED as absent here

`AVSpeechSynthesisVoice.quality` has three values (`.default`, `.enhanced`, `.premium`). On this
machine **all 180 installed voices are `.default`** (`QUALITY_RAWVALUE_HISTOGRAM=["1": 180]`).
Enhanced and Premium are free, Apple-hosted, one-time downloads via System Settings →
Accessibility → Spoken Content → Manage Voices. The same shape exists on Windows (Settings →
Accessibility → Narrator → Add natural voices) and on Linux (installing the `espeak-ng` binary, or
`speech-dispatcher-*` backends for Festival/Flite/Pico/RHVoice).

We cannot install these for the user and should not try. But we can **detect and say so**: "your
system voices are the low-quality tier; here is the one-time download that improves them" is a
one-sentence, one-link improvement to the fallback path, and it fits the constitution's
never-fail-silently principle better than quietly sounding bad.

### 5. `--stdout` on espeak-ng, and `AVSpeechSynthesizer.write` on macOS — DOCUMENTED / MEASURED

Both bypass the temp-WAV round trip our provider does today
(`mkdtemp` → synth to file → `readFile` → `rm`). `espeak-ng --stdout` writes a WAV stream to stdout
and `AVSpeechSynthesizer.write` yields `AVAudioPCMBuffer`s. Neither is a streaming *player* — P9
still stands — but both remove a filesystem round trip from the latency path that R4.2's 500 ms
budget has to absorb.

### 6. Cost of `listVoices()` — MEASURED

```
$ for i in 1..5; do time say -v '?'; done   (ms)
456  439  451  460  442
```

`prepare()` calls `listVoices()`, which on macOS costs ~450 ms — essentially the same ~414 ms spawn
tax P10 recorded for `say ""`. Per-agent voice assignment must cache this list, not re-enumerate
per utterance, or every voice lookup costs an entire latency budget.

---

## Residual unknowns, with the exact probe and the OS required

| # | Unknown | Probe | OS required |
|---|---|---|---|
| U1 | Exact `GetInstalledVoices()` count and names on a stock Windows 11 install, and whether it is 1 or 2 | `powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() \| %{ \"$($_.VoiceInfo.Name) [$($_.VoiceInfo.Culture)] enabled=$($_.Enabled)\" }"` and `reg query "HKLM\SOFTWARE\Microsoft\Speech\Voices\Tokens"` | **Windows 11**, freshly imaged, no added language packs |
| U2 | Whether `pwsh` 7.x on that box is built against .NET 10 (and therefore sees `Speech_OneCore` voices) | `pwsh -NoProfile -Command "$PSVersionTable.PSEdition; [System.Environment]::Version"` then repeat U1's command under `pwsh` and diff the counts | **Windows 11** with PowerShell 7 installed |
| U3 | Whether `SelectVoice` on an unknown name throws or falls back (Windows twin of the macOS silent-fallback hazard) | `powershell -Command "Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $s.SelectVoice('NotAVoiceAtAll') } catch { $_.Exception.GetType().FullName }"` | **Windows** |
| U4 | `spd-say -L` real output on a stock Ubuntu desktop, and whether the espeak-ng backend answers with the 104 variants or a short list | `spd-say -O; spd-say -L \| wc -l; spd-say -L \| head -40` | **Ubuntu 24.04 desktop**, stock, with a session bus |
| U5 | Whether `espeak-ng` is present on Fedora Workstation / Debian / Arch stock desktops, or only on Ubuntu's | `rpm -q espeak-ng` / `dpkg -S /usr/bin/espeak-ng` / `pacman -Qo /usr/bin/espeak-ng` on each | **each distro** |
| U6 | Extracted size of `sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27` | the `curl` + `tar xjf` + `du -sb` in Q17 | any OS |
| U7 | Whether GitHub Actions runners for `windows-latest` / `ubuntu-latest` expose any voice at all (R4 headless CI) | U1's command on `windows-latest`; `which espeak-ng spd-say; spd-say -L` on `ubuntu-latest` | **GitHub Actions**, both images |

---

## Proposed resolution-log lines

To append to `docs/.discussion/000-open-questions.md` once accepted:

```
Q16 — resolved 2026-08-21 — STT and TTS share one native binary (sherpa-onnx.node /
      sherpa-onnx-c-api.dll in sherpa-onnx-win-x64@1.13.6); npm still lacks win-arm64 (HTTP 404),
      GitHub release v1.13.6 carries win-arm64-shared-MD-Release (19.4 MB) and a -no-tts variant
      (18.0 MB). Same gap, same fix. docs/.research/q-round1-platform.md
Q17 — resolved 2026-08-21 — nothing usable fits. Smallest English model in ORCA's own pinned
      catalog is zipformer-streaming-en-20m at 87.7 MiB (encoder alone 84.7 MiB); recommended
      parakeet-tdt-0.6b-v3-int8 is 639.4 MiB. Cap is 50 MB. Models go in the runtime cache (P4).
      docs/.research/q-round1-platform.md
Q31 — resolved 2026-08-21 — macOS 184 listed / 41 English, 24 of 24 verified distinct by md5;
      Windows stock 2 (David/Zira Desktop, SAPI5 key only pre-.NET-10); stock Ubuntu 24.04.3
      desktop has NO espeak-ng binary, only the library + speech-dispatcher. Zero name overlap
      across platforms. Design for N=2. docs/.research/q-round1-platform.md
Q33 — evidence gathered 2026-08-21 — rate everywhere; pitch and volume everywhere but via
      different surfaces (macOS [[pbas]]/[[volm]] in-band, Windows SSML <prosody> only, Linux
      espeak-ng -p/-a or spd-say -p/-i). We pass voice+rate today and drop rate entirely on Linux
      (os-synth/index.ts:161-166). docs/.research/q-round1-platform.md
```
