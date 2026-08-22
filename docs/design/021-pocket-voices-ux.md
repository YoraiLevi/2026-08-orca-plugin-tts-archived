# 021 — Pocket voices are chosen by ear, without pretending they are ready

**Status:** design for PV-040…PV-044. No implementation is authorized by this document.

**Artifact baseline:** repository `f2319b8`, including the current `inputFor()` and
`renderControls()` in `voice-lab/index.html`, and U1…U5 in `scripts/ui-probe.mjs`.

## Scope and limitations stated up front

This design adds the twelve Pocket TTS voices to the existing **Which voice** row. It does not
choose a new default voice, replace the operating-system backend, make a missing ONNX Runtime
installation repair itself, or promise that the same rate number produces the same words per
minute on different engines. Pocket speech needs a 166 MB download before it can run. The Pocket
spike generated about 3.04 seconds of audio in 566 ms, or about 0.19 times real time
`[measured-here]`; that is not instant, and contention has not been measured here.

Pitch is still one of the designed-but-not-built decisions and stays out of the live controls.
Rate is already one of the ten live controls. Pocket therefore has to make rate audibly effective
before its voices can be called ready; merely accepting and ignoring the number would recreate the
dead-control defect from design 020.

The present page is the starting point, not the old accordion design. `renderControls()` renders
only controls whose `wire` is not null (`voice-lab/index.html:1648-1691`), and `inputFor()` renders
the current voice list as one native select (`voice-lab/index.html:1748-1811`). The design below
keeps that interaction model and changes only the voice row's data, grouping, states, and adjacent
actions.

There is one unresolved size fact that the UI must not conceal. The pinned eight-file model is
165,232,420 bytes, which rounds to the required 166 MB warning. The twelve reference clips are
also required, but PV-050 has not pinned their lengths yet. Therefore the repo does not currently
know the full first-use byte total. The examples below use the required **166 MB** wording for the
known model payload; PV-041 cannot ship that as the total unless PV-050 proves the clips are already
included. Otherwise the button and confirmation must show the larger, manifest-derived total.

## User stories

### US-PV1 — A listener chooses by ear

As a dyslexic, voice-first listener, I can move through the twelve neural voices, hear the same
short phrase in each one, stop it immediately, and keep the one I prefer without reading a page of
names or leaving the Lab.

Acceptance criteria:

1. Given the Pocket model and runtime are ready, when the listener selects Eve and activates
   **Hear this voice**, the first spoken words are produced with `pocket:eve`, and selecting Michael
   produces byte-different audio for the same phrase.
2. Given **Speak each change** is on, when the listener changes the selected ready voice, the same
   audition starts after the existing debounce; given it is off, changing the selection produces
   no Lab-generated audio and **Hear this voice** still works.
3. Given an audition is sounding, when the listener changes voice, presses **Hear this voice**
   again, presses Play, or presses Stop, at most one audio source remains live and in-flight
   synthesis for the superseded voice is cancelled.
4. Given focus is on the select, when the listener uses the native arrow-key path, focus stays on
   the select and the currently selected voice is announced by display name and backend, never as
   `pocket:eve` or a numeric index.

### US-PV2 — A `GET /voices` caller renders truth without guessing

As a caller of `GET /voices`, I receive stable keys, human names, backend groups, per-voice ability
to speak, and a machine-readable reason and action when a voice cannot speak. I do not have to
infer readiness from an empty array, decode a display label, or accept either a string or an object.

Acceptance criteria:

1. Given an empty model directory, `GET /voices` still returns all twelve `pocket:*` keys with
   `canSpeak: false`, the state `model-absent`, a plain-language reason, and the exact required byte
   count; it also returns the operating-system voices independently.
2. Given ONNX Runtime is missing, the Pocket entries say `runtime-missing`, not `model-absent`, and
   offer no download action that would falsely claim to repair the runtime.
3. Given the model is present but `eve.wav` is missing, only `pocket:eve` says `voice-missing`; a
   present Pocket voice remains speakable.
4. Given any response, every voice has one backend-qualified `key`, one `displayName`, one
   `backendId`, one `canSelect` boolean, one `canSpeak` boolean, and one state from the documented
   vocabulary. A bare string, a missing key, or an unknown state fails the contract test.
5. Given a voice is requested, the `/speak` stream names the requested key and the backend and
   voice actually used. If they differ, it supplies the reason; a caller never derives provenance
   from the selection.

### US-PV3 — A setting survives a machine without Pocket

As the owner of a settings file, I can carry a choice such as `pocket:eve` to a machine without the
model. The choice remains visible and unchanged, the system backend can keep speech working with a
named temporary fallback, and no loader rewrites my file to whatever happened to be installed.

Acceptance criteria:

1. Given a settings file containing `pocket:eve` and an absent model, loading and saving unrelated
   settings preserves the exact key `pocket:eve`; it is never converted to an OS index, the system
   default, or null.
2. Given that unavailable choice, the Lab selects the visible `Eve — download needed` option and
   explains why it cannot audition it. It does not silently select the first OS voice.
3. Given the shipped plugin must speak while that choice is unavailable, it announces the Pocket
   failure and the temporary OS fallback by name before using the fallback. The fallback does not
   replace the stored choice.
4. Given a legacy bare voice name such as `Alex`, it is interpreted in memory as `os:Alex`. Given a
   legacy numeric voice index whose recorded voice-list hash does not match the current list, it is
   reported as unresolved rather than pointed at a different voice.
5. Given an unavailable selected key, the settings file can be parsed and its other fields reach
   the plugin byte-for-byte through G1. A missing model is not a whole-file parse failure.

## Decision D1 — the exact control shape

**Question:** Is backend choice a separate control, or part of the voice choice?

**Options:**

1. Two selects, **Which engine** followed by **Which voice**. This exposes the engine, but costs two
   choices for one intention and creates transient combinations in which the second select points
   at a voice from the first engine.
2. A custom card grid or searchable combobox. This can show richer descriptions, but replaces
   native keyboard and screen-reader behavior and turns twelve voices into a visual reading task.
3. One native `<select>` with two `<optgroup>` elements, plus adjacent action buttons.

**Recommendation:** Keep one native select. Its value is the backend-qualified key. The two groups
are **This machine's voices** and **Pocket TTS — neural voices**. The collapsed option includes the
backend as well as the display name, so a listener does not have to reopen the select to learn
which engine is active. Unavailable Pocket options remain selectable and say why they cannot yet
speak. **Hear this voice** is always beside the select; the conditional download or repair action
occupies the same place and never moves to another page.

This is one decision from the listener's perspective: “Which voice do I want?” Grouping exposes
the real backend boundary without asking the listener to manage it as a second setting. A native
select is also the form control the author explicitly asked for, and it preserves the accelerator
path already used by `stepFocused()`.

```text
Voice and pacing

Which voice
+------------------------------------------------------+
| Eve — Pocket TTS neural voice                     v |
+------------------------------------------------------+
  This machine's voices
    System default
    Alex — English, United States
    Samantha — English, United States
  Pocket TTS — neural voices
    Anna
    Vera
    Fantine
    Charles
    Paul
    Eponine
    Azelma
    George
    Mary
    Jane
    Michael
    Eve — download needed

[ Hear this voice ]  [ Download the neural voices (166 MB) ]
Eve is selected. Pocket TTS needs a 166 MB download before it can speak.
```

The status sentence is connected to the select with `aria-describedby`. The action buttons are
affordances, not new tuning controls, so the existing count remains ten. Each button still needs a
consequence test; “not counted by U1” is not permission for an inert button.

**Engineer-prompt:** Render the current `voice.id` row as one native select whose option values are
backend-qualified keys, with exactly two optgroups and adjacent Hear/download-or-repair actions;
keep all other live rows and their order unchanged.

## Decision D2 — the `GET /voices` contract

**Question:** Which facts must the server supply so every caller can render the same honest state?

**Options:**

1. Keep returning strings and let each page parse prefixes and inspect model endpoints. This is the
   present guess-heavy shape and cannot distinguish an empty OS list from a failed request.
2. Return display-ready strings such as `Eve — download needed`. This is readable but makes state,
   action, and cache identity depend on parsing prose.
3. Return one versioned structured shape with backend records and fully resolved voice records.

**Recommendation:** `GET /voices` returns no string alternatives and no locally invented indices.
The server owns the derivation of state. The page consumes the result rather than combining
`/voices`, `/model/status`, import failures, and filename knowledge itself.

The minimum response shape is:

```json
{
  "schemaVersion": 2,
  "backends": [
    {
      "id": "pocket",
      "displayName": "Pocket TTS",
      "description": "Neural voices; local after download",
      "state": "model-absent",
      "reason": "The neural voice files have not been downloaded.",
      "download": { "requiredBytes": 165232420, "action": "download" },
      "rate": {
        "supported": true,
        "meaning": "relative to this voice's normal speed"
      },
      "pitch": {
        "supported": false,
        "reason": "Pitch is not implemented for this backend."
      }
    }
  ],
  "voices": [
    {
      "key": "pocket:eve",
      "displayName": "Eve",
      "backendId": "pocket",
      "canSelect": true,
      "canSpeak": false,
      "state": "model-absent",
      "reason": "Download the neural voices before auditioning Eve.",
      "action": "download"
    }
  ]
}
```

The state vocabulary is closed: `ready`, `model-absent`, `downloading`, `download-failed`,
`runtime-missing`, and `voice-missing`. When more than one limitation exists, the server returns
the most useful primary state and includes every other limitation in `issues`; for example,
`runtime-missing` remains primary because downloading cannot repair it, while `issues` may also
say the model is absent. Unknown states fail closed as `canSpeak: false` and produce an error
banner; they never become ready by default.

**Engineer-prompt:** Make `GET /voices` the sole authority for group, key, speakability, state,
reason, action, and adjustment support; delete client-side type guessing and prove every closed
state with a contract fixture.

## Decision D3 — unavailable and transitional states

**Question:** What does the listener see and hear in every state of the selected Pocket voice?

**Options:**

1. Disable or hide unavailable voices. This prevents a bad Play request but also prevents the
   listener from seeing and choosing the voice they want.
2. Leave Play unchanged and silently fall back to an OS voice. This produces sound, but confidently
   plays the wrong thing in the exact control whose purpose is comparison.
3. Keep every known Pocket voice selectable, render the state beside its name, and reserve fallback
   speech for a status sentence rather than the fixture.

**Recommendation:** Use option 3. In the Lab, an unavailable selected voice never causes the
fixture to be spoken by another backend as though the selection worked. Play or Hear speaks a
short status sentence through the working OS path, names the unavailable Pocket voice and cause,
and leaves the fixture untouched. The same sentence is visible and placed in the live region. If
the OS path itself cannot speak, the banner and live region remain; that is a visible degradation,
not a claim that audio was delivered.

| Selected voice state | What the listener sees | What the listener hears |
|---|---|---|
| **Model absent** | All twelve options remain. The selected one says `download needed`; the row says `Pocket TTS needs a 166 MB download`; the download button is present. | On selection: “Eve selected. It needs the neural voice download.” On Play or Hear: “Eve is not installed. Download the neural voices, or choose a system voice.” The fixture does not play in disguise. |
| **Downloading** | Options say `downloading`. A real progress bar and text show bytes, percent, file number, and filename. The download action cannot start a second request. | Once at start, then at 25, 50, 75, and 100 percent: “Neural voices, fifty percent downloaded.” Pressing Play or Hear reports the current progress once; byte updates do not chatter. |
| **Ready** | The Pocket group says `ready offline`; options use their short names; no download action is shown. Hear is enabled. | Selecting a voice while Speak each change is on, or pressing Hear, plays the audition in that exact voice. Play speaks the fixture in that exact voice. |
| **Download failed** | The status names the file and returned reason. The action says **Try the neural-voice download again**. OS voices remain usable. | Once: “The neural voice download stopped at flow L M main: connection reset. Your system voices still work.” Play or Hear repeats a shorter named explanation. |
| **ONNX Runtime missing** | Every Pocket option says `engine component missing`. No download button is offered. The status says reinstalling or updating the plugin is required and that downloading voices would not fix it. | “Pocket TTS cannot run because its neural engine component is missing. A system voice is still available.” The fixture is not passed off as Pocket. |
| **Selected voice missing from a present model** | Only that option says `voice file missing`. Other complete Pocket voices remain ready. The action says **Repair Eve** and states the exact bytes it will fetch before confirmation. | “Eve's voice file is missing. Repair Eve, or choose another ready voice.” Ready Pocket voices continue to audition normally. |

Completion and failure re-fetch `GET /voices` and replace the state without a page reload. Focus
returns to the same select option; a state update must not throw the listener to the first option.

**Engineer-prompt:** Implement the six-state table as a closed renderer and route unavailable
Play/Hear presses to a named status utterance, never silence and never a fixture spoken by an
unannounced fallback.

## Decision D4 — the download affordance

**Question:** How does a 166 MB action obtain informed consent and remain understandable while it
runs?

**Options:**

1. Download automatically when a Pocket voice is selected. This spends bandwidth during browsing
   and makes selection itself surprising and irreversible in practice.
2. Put setup instructions in the README or terminal. This repeats the “scatter me around to edit
   config files locally” failure.
3. Put a button in the voice row, require an in-page confirmation, and stream meaningful progress
   in that same row.

**Recommendation:** Before any bytes are requested, the row shows **Download the neural voices
(166 MB)**. Activating it opens this in-page confirmation:

```text
Download neural voices?
This uses 166 MB of network data. Afterward, speech stays on this machine.

[ Download 166 MB ]  [ Not now ]
```

After confirmation, the action becomes a progress surface:

```text
Downloading neural voices — 84.1 of 166 MB (51%)
File 5 of 20: flow_lm_main.onnx
[=========================                         ]
```

The byte total comes from the completed pinned manifest rather than a second literal. The remote
file count includes the eight bundle files and twelve reference clips. The visual bar updates with
bytes; the text names the current file, so progress remains meaningful when one large file makes
the percentage move slowly. A second press cannot start a second writer. Failure leaves any prior
ready model intact, names the file and cause, and offers retry without manual cleanup. The design
does not claim partial downloads resume; that is an implementation capability to report only if
measured. If the completed manifest total does not round to 166 MB, every piece of consent copy
uses the measured larger value; the requirement to warn is not permission to under-report.

**Engineer-prompt:** Keep consent, byte/file progress, failure, and retry beside Which voice; spend
no network bytes before the explicit **Download 166 MB** confirmation and derive every total from
the manifest.

## Decision D5 — choosing by ear

**Question:** How do twelve named choices become an auditory comparison instead of a reading task?

**Options:**

1. Add written adjectives such as “warm” or “authoritative.” Those are subjective, hard to scan,
   and prejudice the comparison before the listener hears it.
2. Play each voice's reference recording. That demonstrates the donor clip, not what the TTS engine
   will sound like reading the listener's work.
3. Synthesize one short, fixed phrase through the real selected provider, with automatic audition
   controlled by Speak each change and an explicit replay button.

**Recommendation:** Every ready voice auditions the exact phrase:

> Hello. I will read your work, file names, and numbers like forty-two milliseconds.

It is short, contains ordinary prose, a file-related phrase, and the number-and-unit pattern that
already surprised the listener. Every voice receives byte-identical text and the current rate, so
the comparison changes one thing: the selected voice. This audition goes through the same
normalize, chunk, synthesize, cache, playback, and Stop path as fixture speech; a second player
would recreate the overlap defect.

Pocket voices use the manifest's stable published order: Anna, Vera, Fantine, Charles, Paul,
Eponine, Azelma, George, Mary, Jane, Michael, Eve. The list is not sorted by guessed gender or
quality. Stable order makes repeated arrow-key comparison learnable. System voices keep the
platform's existing stable order. The select's live description announces “Eve, Pocket TTS neural
voice, twelve of twelve”; the raw key remains programmer-facing.

The limitation is explicit: one short phrase cannot reveal every pronunciation or long-form
fatigue. The existing editable fixture and Play remain the second, longer audition. The fixed
phrase is for scanning; the fixture is for deciding.

**Engineer-prompt:** Add one fixed-phrase audition through the real speech path, make it obey Speak
each change and the shared Stop, preserve stable manifest order, and announce display name,
backend, and position without speaking raw keys.

## Decision D6 — rate across non-interchangeable backends

**Question:** What does **How fast** promise when engines implement rate differently?

**Options:**

1. Send the same raw number and assume equivalent behavior. This hides backend differences and can
   leave a control inert.
2. Swap whole control panels by backend. This makes the ten-control instrument move under the
   listener and turns comparison into relearning the page.
3. Keep one common user meaning and require each backend to map it honestly.

**Recommendation:** Keep **How fast** at 0.5 through 2.0 with its current meaning: relative to that
voice's own normal speed. The same value is not promised to produce equal words per minute across
OS and Pocket voices. It is promised to be monotonic and audible within each ready voice: 0.8 is
slower than 1.0, and 1.2 is faster. A Pocket implementation that ignores rate is not ready for the
picker. Add an effect test over audio duration; changing only the request object is P47's shape one
layer deeper.

**Engineer-prompt:** Treat rate as backend-normalized user intent and prove it changes Pocket audio
duration in the expected direction.

## Decision D7 — pitch visibility

**Question:** Does adding a second backend make the unwired pitch decision visible?

**Options:**

1. Show a disabled pitch control with a backend-specific explanation. That recreates a visible
   control the listener cannot change.
2. Show pitch only for a backend that implements it. That makes the control count and layout move
   when the listener changes voice.
3. Leave pitch in **Designed but not built yet** until it has an end-to-end effect on every path
   where it is shown.

**Recommendation:** Keep pitch out of the live surface. It is not promoted, disabled, or described
as working for either backend. This preserves the ten live controls and the design-020 rule that a
visible tuning control must take effect. Backend capability data may report pitch unsupported for
honesty, but it does not manufacture a control.

**Engineer-prompt:** Leave pitch in the unbuilt decisions list until changing it has a tested audio
effect; do not vary the ten-control layout when the selected backend changes.

## Decision D8 — durable voice identity in settings

**Question:** What is persisted when the voice list can gain or lose an entire backend?

**Options:**

1. Persist the select's numeric position, as the page does today. Inserting twelve Pocket entries
   can silently re-point that number, and a model-absent machine presents a different list.
2. Persist the display name. `Eve` does not say which backend owns it and an unknown OS name may
   silently become the default.
3. Persist a backend-qualified key and keep availability separate from preference.

**Recommendation:** The selected value is a string such as `pocket:eve` or `os:Alex`, stored as
`synthesize.voiceKey`. Loading does not require the key to be currently speakable. Availability
decides the temporary runtime behavior; it never edits preference. A resolver that accepts an
ordered list still returns the first key its backend can honor and null when none match; it does
not rewrite the primary `synthesize.voiceKey` as a side effect of fallback.

Legacy bare names become `os:<name>` in memory. A legacy numeric index is resolved only when the
current OS voice-list hash matches the provenance hash that accompanied it. Without that proof, it
remains an explicitly unresolved legacy selection and the listener is asked to choose again; index
zero is not a safe guess. Migrations are in memory until the listener explicitly saves.

G1's invariant does not change: the Lab export and the plugin read path must still produce
byte-identical speech. Its voice arm changes from “index 1 happens to resolve to Samantha” to “the
exact backend-qualified key reaches the provider registry,” with an absent-model arm proving the
file and all unrelated settings survive.

**Engineer-prompt:** Replace numeric position as durable identity with a backend-qualified voice
key, preserve unavailable keys without rewriting them, and give legacy indices a hash-checked
migration that refuses to guess.

## Decision D9 — cache invalidation

**Question:** What exactly becomes invalid when the selected backend or voice changes?

**Options:**

1. Clear every decoded buffer. This is safe but discards correct auditions and makes returning to a
   voice unnecessarily cold.
2. Keep the cache and key it by display name. An OS and Pocket voice with the same name can replay
   confidently wrong audio.
3. Keep entries under the full synth key, but invalidate the current replay pointer and require the
   backend-qualified key to participate in every lookup.

**Recommendation:** Use option 3. `keyFor(text, synth)` receives `synthesize.voice` as the exact
backend-qualified key. Changing `os:*` to `pocket:*`, or one Pocket key to another, therefore cannot
hit the previous utterance's entry. The selection change immediately stops current audio, aborts
its synthesis, clears `lastPlayed`, and disables Replay until the new selection has completed one
utterance. Correct cache entries for a voice may remain for a later return; they are not reachable
under another key.

The required negative control is the shipped failure: prime the same text as an OS voice, select
`pocket:eve`, press Play, and observe a new `/speak` request rather than the roughly 41 ms old-voice
replay. A second control changes only `pocket:eve` to `pocket:michael` and must also miss. A third
switches back after Eve has genuinely been cached and may hit only Eve's key.

**Engineer-prompt:** Put the full backend-qualified voice key into `keyFor`, invalidate Replay on
selection change, and prove cross-backend and same-backend switches cannot reach old-voice bytes.

## Decision D10 — provenance names what actually spoke

**Question:** Does the footer describe the selected voice or the voice that produced the audio?

**Options:**

1. Read the selected option. This is easy and wrong whenever preparation fails or a fallback runs.
2. Read one server-wide provider field. That cannot represent two backends in one session.
3. Read requested and actual backend-qualified keys from the completed `/speak` record.

**Recommendation:** Before any successful speech the footer says **Nothing has played yet**. After
speech it says, for example, **Played by Pocket TTS — Eve — local and offline**. If a fallback was
used it says **Requested Pocket TTS — Eve; played by this machine's system voice — Samantha,
because the Pocket model is absent**. The settings provenance records the actual `tunedWith`
backend from the last completed fixture or audition, not the backend implied by the select. An
unavailable selection that only produced a status warning is not recorded as tuned with Pocket.

**Engineer-prompt:** Drive footer and exported provenance from the completed speech record's actual
backend and voice, keep the requested key beside it when they differ, and never infer actual use
from selection or a global provider variable.

## Decision D11 — keep the existing guarantees observable

**Question:** Which existing checks remain load-bearing, and what new failures must they be able to
see?

**Options:**

1. Add picker-specific DOM checks and leave the old gates alone. This can prove groups exist while
   missing a dead select, wrong audio, overlap, or schema drift.
2. Replace U1…U5 and G1 with new feature tests. This discards the controls that already proved they
   could catch the defects from design 020.
3. Keep every existing invariant and extend its independent negative controls to the new path.

**Recommendation:** Keep option 3. Nothing in this feature changes the following:

- The same ten tuning controls remain live; no eleventh tuning control is smuggled in as a button.
- G1 still compares independent Lab and plugin paths and requires byte-identical spoken output.
- The existing Voice Lab performance gate remains, including the recorded cold p95 of 1,690 ms on
  the author's machine and the two-second threshold; Pocket receives its own selected-voice arm,
  and neither number is widened to make it pass.
- FR-023 still keys audio by every synthesis input. Backend-qualified voice identity is added to
  that existing rule, not implemented as a second cache.
- U1 still moves every visible tuning control and demands a consequence. For Which voice, that
  consequence is the exact key in `window.__labEffect().speak.synthesize.voice`; its `--prove`
  mutation removes backend-qualified option wiring and must make U1 red.
- U2 still changes and restores the path dropdown; U3 still proves the example editor; U4 still
  proves that repeated stage play never overlaps; U5 still proves continuous, labelled transform
  marks. None is weakened or retargeted to a less demanding property.
- U4 gains an additional route through **Hear this voice** because every playback path shares one
  queue and one Stop. Separate download-state tests prove all twelve unavailable options remain
  visible and selectable, progress changes without navigation, and each failure state renders its
  named reason.

For rate, U1's request-object consequence remains necessary but is no longer sufficient. A
Pocket-only effect test compares audio duration at 0.8 and 1.2. For voice, the engine test compares
actual bytes at Eve and Michael. These are the checks that prevent a well-shaped but inert picker.

**Engineer-prompt:** Extend U1 and U4 without weakening U2, U3, or U5; retain G1, FR-023, the ten
live controls, and the existing latency gate; add audio-effect controls for Pocket voice and rate.

## Decisions deliberately left to the author

- Which voice, if any, should become the future neural default. This phase leaves the current OS
  default unchanged because default voice is taste, not an engineering fact.
- Whether 0.5…2.0 should later be perceptually calibrated so equal numbers sound equally fast
  across engines. This design promises only a truthful relative and monotonic control until the
  listener has compared it by ear.
- Whether the fixed audition sentence should change after first use. Its initial text is specified
  above so implementation and tests are not blocked; changing its wording later is a taste edit,
  not an API redesign.

No decision above waits on those choices.

## Defects found in the present page while designing

1. The page invents numeric indices for `/voices` entries and persists `synthesize.voiceIndex`
   (`voice-lab/index.html:1787-1794`, `:2794-2808`). Adding or removing a backend changes the list
   those numbers address. That cannot preserve a Pocket choice on a model-absent machine.
2. The `/voices` response is accepted as either strings or objects
   (`voice-lab/index.html:2796-2798`). That compatibility branch hides an unspecified API shape and
   forces the page to guess names; it cannot render per-backend or per-voice failure honestly.
3. Failure to fetch voices is swallowed (`voice-lab/index.html:2810`). The visible result is the
   same disabled “No voices found on this machine” option used for a genuine empty list. A failed
   server and a machine with no voices are different states and need different remedies.
4. `state.provider` is global and is populated only if `/voices` supplies one provider
   (`voice-lab/index.html:1184`, `:2803`); save and export then use that value as `tunedWith`
   (`:2440-2444`, `:2475-2479`). One global provider cannot report which backend actually produced
   the last utterance.
5. `setControl()` does not invalidate `lastPlayed`, and `replay()` schedules its saved keys without
   consulting the current synth options (`voice-lab/index.html:1880-1897`, `:2118-2128`). Under a
   voice change, Replay can therefore remain an affordance for the preceding voice unless the new
   design explicitly clears that pointer.
6. The task breakdown requires Pocket voices in the picker but contains no audio-effect gate for
   the already-visible **How fast** control under Pocket. U1 would see a changed request object even
   if Pocket ignored it. Without D6's duration check, the feature can repeat P47 while all current
   UI checks are green.
7. PV-041 requires a 166 MB download label before PV-050 pins the twelve reference clips. The
   current 165,232,420-byte total covers only the eight model artifacts
   (`packages/providers/src/pocket-synth/models.ts:48-70`). Until the clip lengths join that
   manifest, the full bandwidth spend is unknown and the phase ordering cannot produce honest
   consent copy.

## Falsifier

If a listener can select a named Pocket voice yet cannot tell by hearing the page whether that
exact voice is ready, downloading, broken, or actually speaking—without opening a terminal or a
settings file—this design has failed.
