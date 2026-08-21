# 011 — Settings: where they live, what shape they are, how they migrate

**Status:** design. **Written:** 2026-08-21. **Phase:** M12 (T120–T124).
**Work order:** `docs/design/008-crossreview-round3.md` findings **X-06**, **X-08**, **C-04**;
carried forward as unresolved by `docs/design/009-reconciliation.md` section 3.
**Supersedes:** `docs/design/004-voice-lab.md` section 7's *location* sentence
(`~/.orca/read-aloud/settings.json`) and its *`schemaVersion: 1`, no migration* stance. The rest of
004 section 7 — the four consumer sections, `provenance`, `expected[]`, T113's round-trip with its
negative control — stands and is consumed here.

**Commits used for every citation below.** `orca-plugin-tts` at **`ee8c1cf`** (re-derived
2026-08-21 from `32b929a`, see the amendment note); ORCA at
**`87097551f8e98a21c3afa7d457f66d6fd1f94038`**. Every `file:line` in this document was read at those
two commits during this session, not inherited from an earlier document (E-01 is the reason that
sentence is here).

> ### Amended 2026-08-21 — round-7 review, `docs/design/014-review-round7.md`
>
> Five findings landed on this document. Each is resolved **in place**, in the section that owns the
> mechanism, and each change carries the finding number that forced it. Nothing here is a new
> document; `014` is the record of what was found and is not edited.
>
> | Finding | What changed here |
> |---|---|
> | **R7-27** blocks-impl — the KV mirror can never fire, because the create-once starter file shadows it | Section 1.2 "The load sequence" is new and **replaces per-file precedence with an ordered load**: mirror first on a missing inbox, starter file generated *from mirrored values*, `revision` seeded to `mirror.revision + 1`. Section 1.2 now **states explicitly that `revision` is mirrored** — the document never said, and that silence was the second half of the finding. Section 6's create-once rule rewritten. New verify-by-effect with its negative control. |
> | **R7-31** needs-decision — the settings-failure report speaks unprompted at `activate()` | Section 4.3 destination 1 rewritten: the spoken path is **gated on evidence the audio channel is in use**. New schema field **`announce.reportChannel`**, `provisional`, three options, and section 4.3a **designs the option space and leaves the default to the listener** rather than choosing silently (**P23**). New **Q68**. |
> | **R7-32** needs-decision — Q66's `fs.watch` rename risk had no runtime detection | Section 6 "What a hand-edit costs" gains **stat-poll fallback + watch-health**; `read-aloud.status` now speaks the loaded **`revision` and `writtenAt`**. Q66 rewritten from "probe before T121" to "probe *and* the fallback ships either way". |
> | **R7-06** needs-decision — `maxQueued` specified three incompatible ways | Section 3.2a is new: **`011` owns `queue.maxQueued`; `012`/`013` cite it and restate no number.** Per-session fairness registered as a **second** field `queue.perSessionFairness` at `since: 3`. (`012` and `013` are amended by another pass; this document does not edit them.) |
> | **R7-29** needs-decision — `012`/`013` invent ≥7 ids the frozen schema does not carry | Section 4.2a is new: the **registration protocol** for ids a later milestone adds, the seven ids `012`/`013` need named as a forward register at `since: 3`, and T124's gap report extended to count them (section 3.3 (d)). |
>
> **Citations.** `pnpm check:citations` had never been run over this document. It reported **8 stale**
> citations in `011`; all eight are fixed, plus four more the tool could not anchor and that were
> stale in fact (`speech-service.ts` `normalize`/chunker/`announce` read-points and the adapter's
> storage methods). **One inherited fact expired rather than drifted:** section 4.3's claim that
> `notify` discards its delivery result is **no longer true of the code** — `adapter/index.ts:122-126`
> now reads `{ delivered: false }` and routes it to `onUndelivered`. The sentence is rewritten; the
> argument it supported (a log-only report is a silent report) survives on `host.log`, which is still
> swallowed at `adapter/index.ts:101`.

> **Two corrections to inherited facts, made while verifying.**
> 1. `docs/.research/q-round1-orca-api.md` Q35 Evidence 3 quotes the settings binding as
>    `set: (itemKey, value)`. It is **three** parameters —
>    `set: (key, itemKey, value)` (`src/main/plugins/plugin-host-service-bindings.ts:80-82`), where
>    `key` is the qualified plugin key. The verdict is unaffected; the signature is not.
> 2. The brief says the normalizer has five fields and names the fifth "the newly added ordered-list
>    field". Verified: **five**, `codeBlocks` `:24`, `pathStyle` `:31`, `extensionStyle` `:36`,
>    `expandNumbers` `:38`, `orderedLists` `:51` (`packages/core/src/normalizer/index.ts:22-52`).
>    Note `:36`, not `:37` — 004 section 7's own pointer to `22-52` is right, the field list is right,
>    and this document pins the per-field lines because T124 walks them.
>    The brief also says 004 specifies 43 controls; the document says **46**
>    (`docs/design/004-voice-lab.md:28`, `:236`, `:736`). This design is written against 46.

---

## 1. Where settings live

### 1.1 What the four candidate homes can actually do

| Home | Who can write | Who can read | Survives uninstall | User can find / back up | Evidence |
|---|---|---|---|---|---|
| ORCA `settings:own` KV — `<userData>/plugins-data/yorailevi.read-aloud/settings.json` | **the worker only**, via `settings.set` | the worker only, via `settings.get` | **no** | barely | `plugin-host-api.ts:224-241`; `plugin-host-service-bindings.ts:79-83`; `plugin-storage-store.ts:28-37`; `plugin-discovery.ts:72`; deleted by `plugin-install.ts:282` |
| ORCA `storage` KV — same directory, `storage.json` | the worker only | the worker only | no | barely | `plugin-host-service-bindings.ts:66-73` |
| `~/.orca/read-aloud/settings.json` (004's choice) | anyone | anyone | yes | yes | — |
| Our own namespace under the OS config dir | anyone | anyone | yes | yes | — |

Four facts decide it, and each is a `file:line`, not a preference:

1. **The lab cannot write the sanctioned home.** `settings.get` and `settings.set` are both
   `panel: false` (`src/shared/plugins/plugin-host-api.ts:229`, `:239`), and the store is a
   main-process class reached only through the worker's host call
   (`src/main/plugins/plugin-host-method-bindings.ts:156-161`). The Voice Lab is a browser page plus
   a local server — neither is a plugin worker, so neither has a route into that file. This is the
   fact that makes X-06 hard: the sanctioned home has **no UI-side writer**, and the UI-side writer
   has **no sanctioned home**.
2. **The sanctioned home is destroyed on uninstall.** `removeInstalledPlugin` removes the plugin's
   data directory as well as its install directory (`src/main/plugins/plugin-install.ts:274-283`),
   and the behaviour is pinned by a test that asserts `storage.json` is unreadable afterwards
   (`src/main/plugins/plugin-install.test.ts:516-531`). A listener who reinstalls to fix something
   loses every hour of tuning. That alone disqualifies it as the *only* home.
3. **It also silently resets on corruption.** `PluginKvStore.read()` swallows a parse error and
   returns `{}` (`src/main/plugins/plugin-storage-store.ts:39-55`, the `catch` at `:51-53` with the
   comment *"Corrupt files reset to empty rather than wedging the plugin"*). From the plugin's side
   that is indistinguishable from "never configured" — the exact FMA-section-20 shape.
4. **It is not a file a human is invited into.** Every write goes through `writeSecureFile`, which
   creates the directory `0o700` and the file `0o600` and re-`chmod`s on each hardening pass
   (`src/shared/secure-file.ts:106`, `:115`, `:210`). It is JSON with no comments, under
   `<userData>`, which on a dev build is a *different directory per worktree* (PITFALLS **P27**).

And `~/.orca/` is refused outright: **C-04** stands. R062 requires a stated reason for a write under
the user's home and 004 gives none; R024 (*"Only read the user's transcripts and configuration; never
write to them"*) makes writing into the host's own config namespace the wrong instinct even for a
file we own. We are a guest there.

### 1.2 The decision — an inbox we own, a cache ORCA owns, one direction

```
Voice Lab (browser) ──POST──▶ lab server ──writes──▶  INBOX      (ours, JSONC, human-readable)
                                                        │
                                     worker fs.watch ───┘
                                                        │ validate + migrate
                                                        ▼
                                                     settings.set  ──▶  ORCA KV  (last-known-good)
                                                        │
                                                        ▼
                                             SettingsSnapshot in memory  ──▶ consumers
```

**The inbox — the source of truth for tuning.** One file, in **our** namespace, never ORCA's:

| Platform | Path |
|---|---|
| Linux / BSD | `${XDG_CONFIG_HOME:-~/.config}/orca-tts/settings.jsonc` |
| macOS | `~/Library/Application Support/orca-tts/settings.jsonc` |
| Windows | `%APPDATA%\orca-tts\settings.jsonc` |
| any | `$ORCA_TTS_CONFIG_DIR/settings.jsonc` when set — the escape hatch for a dev worktree that wants isolated tuning (P27's shape, applied to us) |

**The stated reason R062 asks for**, recorded here so it is not re-derived: *this file exists because
ORCA renders no settings UI for plugins (Q35, upstream stablyai/orca#15655), the only writable
sanctioned store is unreachable from the tuning UI and is deleted on uninstall, and the listener must
be able to find, read, hand-edit and back up their own tuning.* It is created in a directory named
for this plugin, it contains nothing but this plugin's settings, and nothing outside that directory
is ever written.

**The ORCA KV — last-known-good, not source of truth.** After a successful load the worker mirrors
the resolved values into `settings:own` via `settings.set`, one key per field. It earns its place by
doing exactly one job: when the inbox is missing, unreadable, or newly-invalid, the worker falls back
to the KV mirror rather than to bare defaults, so a listener whose config file got deleted still
hears the voice they tuned. It also means we genuinely use the capability we already declare
(`packages/plugin/orca-plugin.json:108`) rather than declaring one we never call.

**What is in the mirror — `revision` included, and this is the sentence the document was missing.**
The mirror carries **every schema id**, plus **three reserved envelope keys** that are not settings
ids and are never rendered as controls:

| Key | Value | Why it must be mirrored |
|---|---|---|
| `__revision` | the `revision` of the snapshot being mirrored | Without it the mirror cannot be ordered against anything, and a starter file regenerated from it would restart at `1` — permanently below whatever the listener's file had reached. |
| `__schemaVersion` | `SCHEMA_VERSION` at the time of the mirror | So a mirror written by an older plugin runs the same migration chain as an older file (4.1), instead of being read as current. |
| `__writtenAt` | the mirrored snapshot's `writtenAt` | Diagnostics only. **Never** compared for ordering — same rule as 2.1. |

The reserved prefix is `__`; the schema forbids any field id starting with it, and T124 asserts that.

> **R7-27 (`014`, blocks-implementation).** The table above is new. This document previously said only
> that the worker *"mirrors the resolved values … one key per field"* and **never said whether
> `revision` was mirrored** — which left the second branch of R7-27 undecidable: a starter file at
> `revision: 1` against a mirror at 17 either is or is not refused as `stale_revision`, and nothing
> here answered. **It is mirrored.** Saying so is half the fix; the other half is the load *order*,
> immediately below.

**Who writes what — no file has two writers in steady state.**

| Writer | Writes | Never writes |
|---|---|---|
| Voice Lab server | the inbox (whole-file rewrite from the schema template) | the KV, `storage`, anything under `~/.orca/` |
| A human with an editor | the inbox | — |
| The worker | the KV mirror; **the inbox only if it does not exist** (create-once starter file, section 6 — **generated from the mirror when one exists**, 1.2a) | an existing inbox — never rewrites, never reformats, never strips a comment |
| The worker's `storage` | *session state* — spoken-reply ids, huddle on/off | tuning |

**What happens when both write.** They cannot write the same file, so the only real collision is
lab-Save versus human-edit on the inbox, and it is resolved by `revision` (section 2): a write whose
`revision` is not greater than the one the worker last promoted is refused as `stale_revision` and
**spoken once**, so a listener editing in `vim` while the lab is open is told which one won instead of
silently losing an hour. The lab re-reads the file before every Save and refuses to Save over a
`revision` it did not last see.

### 1.2a The load sequence — rewritten for R7-27

**The old rule was per-field precedence alone: inbox → KV mirror → schema default.** Round 7 showed
that rule is unreachable in the one scenario the mirror exists for. Section 6 has the worker create a
complete, **default-valued** starter file whenever the inbox is absent. So *delete the inbox and
restart* produces a file in which **every field has an inbox value** — per-field precedence never
descends to the mirror, and the listener silently gets defaults where this document promised them the
voice they tuned. **The recommendation is withdrawn and replaced**, not softened: precedence is no
longer the whole story, because the starter file is written *before* precedence would ever run.

**Load is now an ordered sequence, and the mirror is read first.**

1. **Read the mirror** (`settings.get`, all keys) — always, before touching the filesystem. It yields
   either `null` (nothing mirrored: a genuinely first run) or `{ values, __revision, __schemaVersion }`.
2. **Read the inbox.**
   - **Inbox exists and parses** → per-field precedence as before: **inbox field** → **mirror field**
     → **schema default**. Per field, not per file: one unparseable line does not demote the other 46
     controls (3.2's count). Unchanged.
   - **Inbox exists and is wholly unparseable** → the whole file is refused, the mirror supplies every
     field, and the failure is reported by section 4.3. Unchanged.
   - **Inbox is absent** → **step 3**. This is the branch R7-27 broke.
3. **Generate the starter file from the resolved values, not from the defaults.** The generator that
   section 6 specifies takes a `Settings` record as input; on a first run that record is all defaults,
   and after a mirror exists it is *the mirrored values*. One generator, two inputs — the comments,
   banners and ordering are identical either way, and only the values differ.
4. **Seed the starter file's `revision` to `mirror.__revision + 1`**, or to `1` when there is no
   mirror. Monotonicity survives a delete-and-restart, so the regenerated file is not refused as
   `stale_revision` by 2.2, and neither is the listener's next hand edit on top of it.
5. **`writtenBy` on a mirror-restored starter file is `"read-aloud/<version> (restored)"`**, and the
   restoration is **said once, aloud**: *"Your settings file was missing. I rebuilt it from the last
   settings I had, at `<path>`."* A silent rebuild is indistinguishable from a silent reset, and the
   difference is an hour of the listener's tuning.

**Consequence for 2.2's refusal rule, stated so it is not re-derived.** At `activate()` there is no
`currentSnapshot`, so the first promotion of a session is never refused. `stale_revision` governs
*subsequent* promotions within a session only. Step 4 exists so that the *file on disk* stays above
the mirror across sessions, which is the case 2.2 alone could not reach.

**Verify by effect — with its negative control.**

| | Steps | Assert |
|---|---|---|
| **Positive** | Start with a tuned inbox (`synthesize.rate = 0.8`, `normalize.pathStyle = "terse"`, `revision: 17`). Let the worker mirror it. **Delete the inbox.** Restart the worker. Speak one utterance. | **The provider receives `{ rate: 0.8 }`** and the normalizer receives `pathStyle: "terse"` — assert on the object the consumer was handed, not on the file. And the regenerated inbox on disk has `revision: 18`, `writtenBy` ending `(restored)`, and `synthesize.rate: 0.8` in its text. |
| **Negative control** | Same, but with **no mirror present** (fresh KV). Delete the inbox, restart, speak. | The provider receives the **schema defaults**, the regenerated file has `revision: 1`, and the restoration sentence is **not** spoken. |

The control is what makes the positive case evidence: without it, a test asserting "the provider got
`0.8`" would pass just as well if `0.8` happened to be the schema default, and it is the assertion
that fails under the pre-R7-27 design (which returns the default in *both* rows).

### 1.3 The split that keeps this honest: tuning versus state

Tuning is what the listener chose by ear and must survive an uninstall; state is what the running plugin remembers between reaps. Tuning goes
in the inbox. State stays in `storage` (`storageGet`/`storageSet`,
`packages/plugin/src/adapter/index.ts:74-75`, already wired, already used by huddle at
`packages/plugin/src/main.ts:206`). This is why the worker never needs to
write tuning values: **nothing inside the plugin changes a tuning value.** In M12 the plugin's
controls change *state* only. If M13 or M15 ever adds an in-plugin control that changes tuning, it
writes the inbox and bumps `revision` like any other writer — and that is the point at which this
document must be re-opened, not before.

---

## 2. The write path and its ordering

### 2.1 The envelope

Every settings file carries the ordering fields **X-06** found missing:

```jsonc
{
  "kind": "orca-tts-settings",
  "schemaVersion": 2,
  "revision": 17,                       // monotonic, per file. The ordering primitive.
  "writtenAt": "2026-08-21T14:02:11Z",  // human diagnostics only. NEVER compared for ordering.
  "writtenBy": "voice-lab/0.2.0",       // or "hand", or "read-aloud/0.4.1" for the starter file
  "provenance": { … },                  // unchanged from 004 section 7
  "settings":  { … },                   // section 3
  "expected":  [ … ]                    // unchanged from 004 section 7; T113's oracle
}
```

`revision` is an integer the writer increments. `writtenAt` is deliberately **not** the ordering key:
clocks go backwards, files get copied between machines, and a timestamp comparison would silently do
the wrong thing on exactly the machine that matters least often.

### 2.2 Ordering against Stop — by not competing with it

003's `gen` orders control verbs against a *playback generation*
(`packages/core/src/queue/index.ts:41-46` bumps it on barge-in; the counter and its accessor are
at `packages/core/src/queue/index.ts:16`, `:23`, and `begin()` is at `:27-30`; a
superseded chunk is refused at `:34` and again at `:55`). X-06's worry is that a settings write
landing during playback cannot be ordered against a Stop.

**The resolution is to make the race impossible rather than to arbitrate it.** A settings promotion:

- **never bumps the playback generation**, and
- **never touches `#pending`** — applying settings must not destroy what is queued. That is C5 and
  PITFALLS **P30** in one sentence: *destroying what is queued is the fault this class of message
  exists to report.*

Instead, loading produces an immutable **`SettingsSnapshot { revision, values }`**, and every
utterance is enqueued **carrying a reference to the snapshot current at enqueue time**. Playback
reads the item's own snapshot. A Stop is therefore always ordered correctly with respect to a
settings write, because a settings write is not a playback-queue operation at all: Stop bumps the
generation and every queued item dies regardless of which snapshot it held.

A promotion whose `revision <= currentSnapshot.revision` is refused with the named code
`stale_revision`. It is logged, and it is spoken **only** when the refusal was a human's edit losing
to the lab (section 4.3's channel rule) — a duplicate promotion of the same revision by the watcher's
debounce is not news.

**Verify by effect.** Enqueue three utterances, promote a new snapshot between the first and the
second, then Stop during the first. Assert: the sink received zero chunks after the Stop, `#pending`
is empty, and the *promotion itself* did not empty it — the control case is the same sequence without
the Stop, where all three utterances still play and items 2 and 3 use the new snapshot. A test that
only asserts "Stop stopped it" would pass with the queue-clearing bug present.

### 2.3 When each control takes effect — three classes, and where each is read

The read-point in current source **is** the answer; these are not policy choices so much as
observations that must be made deliberate.

| Class | Meaning | Read-point today |
|---|---|---|
| **`utterance`** | takes effect on the next utterance; the one playing finishes as tuned | `speech-service.ts:399` (`normalize(text, …)`), `:405-409` (chunker constructed per utterance) |
| **`immediate`** | takes effect on the next queue operation, i.e. within milliseconds | `speech-service.ts:263` (`maxQueued` read on each enqueue) |
| **`session`** | takes effect on the next `activate()`; the plugin says so aloud when one changes | provider resolution in `main.ts:94-96`, resolved at `:128` |

**One required change to source falls out of this.** `#synthesizeOptions()` is called **inside the
per-chunk loop** (`packages/plugin/src/speech-service.ts:424`, calling `#synthesizeOptions()` declared at `:386-391`). With a mutable
snapshot behind it, a voice change would land *between chunk three and chunk four of one utterance* —
a sentence that changes speaker mid-word. `synthesize.*` must be read **once per utterance**, into a
local, at the top of `#speakOne`. This is a settings-design constraint on M12's implementation and it
belongs in T121's acceptance, not discovered later.

**A second constraint: `SpeechServiceDeps` is `readonly` and captured in the constructor**
(`speech-service.ts:34-72`, constructor at `:160-166`). Nothing today can change a setting after construction. T121
must replace the frozen fields with a single injected `settings: () => SettingsSnapshot`, or the
plugin's only way to apply a settings change is to rebuild the service — which would drop the queue
and re-pay provider warm-up. Say it now: **settings are injected as a getter, not as values.**

**And a live T122 violation to delete:** `maxQueued: 8` is hardcoded at
`packages/plugin/src/main.ts:152`, while `SpeechService`'s own fallback is `20`
(`speech-service.ts:74`, read at `:263`). Two different "defaults" for one control, neither from a
schema. T122 exists for this.

### 2.4 Mid-utterance policy, and the one part that is taste

| Question | Answer | Kind |
|---|---|---|
| Does a settings change interrupt the utterance being spoken? | **No.** Never. An interruption the listener did not ask for is itself a harm (P30). | correctness |
| Does it apply to items already queued behind it? | **Default no** — each item keeps its enqueue-time snapshot. | **taste** — option `apply.toQueued: false \| true`, `provisional` |
| Does it apply to the next utterance? | **Yes**, for `utterance`- and `immediate`-class fields. | correctness |
| Does a `session`-class change apply now? | No — and the plugin **says so aloud, once**: *"That takes effect the next time ORCA starts."* Silence here is the failure this project keeps re-learning. | correctness |

`apply.toQueued` is genuinely undecidable from a desk. A listener who has just heard a path mangled
wants the fix to reach the four replies already queued; a listener mid-way through a long answer wants
consistency. Default `false` because it is the conservative one, marked `provisional`, settled by ear.

---

## 3. The schema

### 3.1 Shape: one flat, dotted-key record with a descriptor per field

```ts
// packages/core/src/settings/schema.ts  — T120. The only place a default is ever written.

export const SCHEMA_VERSION = 2 as const

export type Owner =
  | 'normalize'   // -> NormalizeOptions   (packages/core/src/normalizer/index.ts:22-52)
  | 'chunk'       // -> ChunkerOptions     (packages/core/src/chunker/index.ts:27-34)
  | 'synthesize'  // -> SynthesizeOptions  (packages/core/src/types/index.ts:26-31)
  | 'queue'       // -> SpeechService queue+announce  (speech-service.ts:34-72)
  | 'announce'    // -> spoken wording: huddle labels, switch, status
  | 'session'     // -> HuddleController: follow, caps, labels
  | 'input'       // -> clipboard / hotkey path
  | 'apply'       // -> this document: how a settings change lands
  | 'lab'         // -> the Voice Lab only. The plugin never reads these.

export type Effect = 'utterance' | 'immediate' | 'session' | 'lab-only'

export interface FieldDescriptor<T = unknown> {
  readonly id: string             // dotted, unique, stable forever: 'normalize.pathStyle'
  readonly owner: Owner
  readonly panel: string          // which Voice Lab panel renders it — presentation, not ownership
  readonly label: string          // spoken and written. One short noun phrase.
  readonly help: string           // one sentence. Becomes the generated comment (section 6).
  readonly kind: 'enum' | 'bool' | 'int' | 'float' | 'string' | 'template'
  readonly values?: readonly T[]  // enum
  readonly range?: { min: number; max: number; step: number }
  readonly default: T
  /** TASTE. The default is a placeholder nobody has settled by ear. See section 5. */
  readonly provisional: boolean
  /** Why this default. Required when `provisional` is false — a settled default has a reason. */
  readonly rationale?: string
  readonly effect: Effect
  /** Engine-dependent (004's `EP`): does not transfer across platform or provider. */
  readonly enginePersonal: boolean
  /**
   * The exact property this value becomes, on the exact object the consumer receives.
   * `null` means DESIGNED BUT NOT WIRED — the control renders, the schema carries it, and
   * T124 excludes it from the reachability assertion while counting it in the gap report.
   */
  readonly wire: string | null    // e.g. 'NormalizeOptions.pathStyle'
  readonly since: number          // schemaVersion in which this id first appeared
  readonly deprecated?: { since: number; replacedBy?: string; note: string }
}

export const SETTINGS_SCHEMA: Readonly<Record<string, FieldDescriptor>> = { … }
```

**Flat dotted keys, not nested objects** — for three reasons, in descending weight:

1. **The sanctioned mirror is flat.** `settings.set` takes `{ key, value }`
   (`src/shared/plugins/plugin-host-api.ts:234-241`) into a flat `Record`
   (`plugin-storage-store.ts:57-93`). A flat file maps 1:1 into the KV with no path walker, and each
   field is written independently, so one bad field cannot corrupt the mirror. Headroom is ample:
   1,024 keys, 256 KB per value, 5 MB total (`src/shared/plugins/plugin-host-api.ts:68-70`) against
   our ~50 fields.
2. **Per-field fallback (T123) becomes a `for` over keys**, not a recursive walk that has to decide
   what "partially valid subtree" means.
3. **T124 becomes a set comparison** rather than a tree diff.

The generated file still *reads* grouped, because the writer emits banner comments in schema order
(section 6). Grouping is presentation; ownership is the `owner` field.

### 3.2 Grouped by owner — the table X-06 and the brief both ask for

Control ids are 004 section 6's, at `docs/design/004-voice-lab.md:236-400`.

| Owner | Fields (004's rows) | Consumer, with `file:line` | Write path | Takes effect |
|---|---|---|---|---|
| `normalize` | rows 1–27 → **5 wired**: `codeBlocks` `pathStyle` `extensionStyle` `expandNumbers` `orderedLists`; the other ~17 are `wire: null` today | `normalize(text, opts)` — `packages/core/src/normalizer/index.ts:22-52`, called at `speech-service.ts:399` | inbox → worker → snapshot | **utterance** |
| `chunk` | 32, 33 (`maxUnits`, `isolateFirstSentence`); `countUnits` is a function, **not settable** | `ChunkerOptions` — `packages/core/src/chunker/index.ts:27-34`, constructed at `speech-service.ts:405-409` | same | **utterance** |
| `synthesize` | 28, 29 wired (`voice`, `rate`); 30, 31 (`pitch`, `volume`) `wire: null` — no field exists; `signal` is runtime, not settable | `SynthesizeOptions` — declared at `packages/core/src/types/index.ts:26-31`, built by `#synthesizeOptions()` at `packages/plugin/src/speech-service.ts:386-391` and handed to the provider in the per-chunk loop at `:424` | same | **utterance** (see 2.3 — must be snapshotted once per utterance) |
| `queue` | 36, 37, 38 (`maxQueued`, `overflowPolicy`, `announce.mode`) **plus `queue.perSessionFairness` at `since: 3`** — see **3.2a** | `SpeechService` — `speech-service.ts:55`, read at `:263`; mode is P21's `speak(text, mode)` | same | **immediate** |
| `announce` | 39, 41, 42 (`sessionLabel`, `switchPhrase`, `statusTemplate`) **plus `announce.reportChannel` at `since: 2`** — new, 4.3a, R7-31. **Row 40 `sessionLabelHashChars` does not exist in this schema** — 008 X-04 / 007 C7 removed hex as a correctness matter, and a schema that carries it invites it back | `SpeechService.announce()` (`speech-service.ts:191`) and huddle labels | same | **immediate** |
| `session` | 46 (huddle reply cap; **existence** is correctness per B-05, the number is taste) | `HuddleController` (`packages/plugin/src/huddle/`) | same | **immediate** |
| `input` | 43 (`clipboardCap`) | `packages/plugin/src/clipboard.ts` | same | **immediate** |
| `apply` | `apply.toQueued` (this document, 2.4) | `SpeechService` enqueue | same | **immediate** |
| `lab` | 34 (`simulateChunkGapMs`), fixture selection, A/B set | the lab's playback scheduler only | inbox, `lab.*` prefix | **lab-only** — the plugin must never read these, and a test asserts it does not |
| *unassigned* | 44, 45 (`pace.pauseBackend`, `interrupt.granularity`), 9 and 35 (pause milliseconds) | blocked behind the single provider-seam change **C-05** demands | — | **session** |

**The control count, and how the amendments move it.** 004 specifies **46**. This document ships
**47** at `SCHEMA_VERSION = 2` — 46 plus `announce.reportChannel` (4.3a, R7-31), which is a control
004 never had because 004 never specified a failure report. **`since: 3` reserves nine more** (4.2a),
which are counted by T124's `future` bucket (3.3 (d)) and rendered disabled by the lab; they are not
part of the 47.

**The gap the brief points at, named plainly:** of those 47, the number that reach a typed options
object today is **9** (5 normalize + 2 chunk + 2 synthesize). Everything else is either plugin-local
literals, unimplemented, or blocked on C-05. That is not a reason to shrink the schema — a
`wire: null` descriptor is how the lab renders a control and how the gap stays countable. It *is* a
reason T124 must report the gap rather than only assert the wired subset.

### 3.2a `queue.maxQueued` is owned here — R7-06

**`014` R7-06 found one control specified four ways**: `009` section 2 (C3) and `004:411` say the one
value is 8; `011`'s own T122 says delete the literal and let the schema carry it; `012` said
change the constant to 8 **and** make the cap a function of `|F|` (now amended to cite this field —
`012:255`, `012:279`); `013:231` assumes a flat 8; and
`packages/plugin/src/speech-service.ts:74` still says 20. Four documents, four shapes, no task.

**Ownership, stated so the other documents can stop restating it.**

| | |
|---|---|
| **The control** | `queue.maxQueued` — `kind: 'int'`, `range { min: 1, max: 20, step: 1 }`, `default: 8`, `effect: 'immediate'`, `wire: 'SpeechServiceDeps.maxQueued'`, `since: 2`, `provisional: false`, `rationale`: *"what the listener has been living with; twenty queued replies is ~3 minutes of unrequested speech" (`009` section 2, C3)*. |
| **Where the number lives** | **`SETTINGS_SCHEMA` in `packages/core/src/settings/schema.ts`, and nowhere else.** T122 deletes `maxQueued: 8` at `packages/plugin/src/main.ts:152` and `DEFAULT_MAX_QUEUED = 20` at `packages/plugin/src/speech-service.ts:74`, and section 5's fallback-literal lint keeps them deleted. |
| **What other documents do** | **Cite `011` `queue.maxQueued`. Restate no number.** A design document that writes `8` is writing a second source of truth, which is the fault this row exists to close. `009` section 2's C3 row and `004` row 36 are the *history* of the value; the schema is the value. |
| **What `009`'s C3 instruction now means** | *"`DEFAULT_MAX_QUEUED` must change from 20 to 8"* is superseded in form, not in substance: the constant is **deleted**, and the 8 it would have held is the schema default. Same audible behaviour; one fewer place to disagree. |

**Per-session fairness is a second field, not a redefinition of the first — and this is the part that
changed `012`'s instruction.** `012` originally asked for `maxQueued` to *become* `ceil(8 / |F|)` when
more than one session is followed. Making one id mean two things depending on runtime state breaks three
properties this document relies on: the descriptor's `range` stops describing the legal values, the
lab can no longer render the control honestly ("8" would be a number the listener never observes), and
4.2's rule — *changing the meaning of an existing id is not allowed at all* — is violated outright. So
the behaviour `012` wants is registered as its own control:

```ts
'queue.perSessionFairness': {
  id: 'queue.perSessionFairness', owner: 'queue', panel: 'Queue',
  label: 'share the queue between followed sessions',
  help: 'When more than one session is followed, cap each one at its share of the queue instead of letting the fastest agent fill it.',
  kind: 'bool', default: false, provisional: true,
  effect: 'immediate', enginePersonal: false,
  wire: null,              // no consumer until M16; T124 counts it in the gap report
  since: 3                 // M16 registers it; an M12-era plugin ignores it and says so (4.1)
}
```

When it is `true`, the per-session cap is **derived from `queue.maxQueued`, never replacing it**, and
when `|F| <= 1` it is inert by construction. **The division itself belongs to `012`, which owns the
multi-session rule** — `012:255`, `012:270-279` specify `floor(C / |F|)` plus a remainder, under the
invariant *sum over `F` of `cap(s) == C`, exactly, always*. This document owns the id, the `kind`, the
default and the fact that the divisor is `queue.maxQueued`; it deliberately restates none of that
arithmetic, which is the same mistake in the other direction.

**Why `false` is the shipped default and why it is `provisional`.** Fairness trades "the agent you are
listening to keeps its place" against "the fastest agent cannot monopolise the queue", and which one is
correct is a thing you learn by hearing a two-agent fan-out, not by reasoning at a desk (**P23**). It
ships off because off is today's behaviour and therefore the reversible one.

**Verify by effect.** Set `queue.maxQueued` to 3 in the inbox, enqueue five utterances, and assert the
sink played **three** — then re-run with the field absent and assert it played **eight**. The control
case is what shows the setting arrived rather than the constant surviving; asserting only the first
half passes with a hardcoded 3 anywhere on the path (**P26**).

### 3.3 T124, specified precisely enough to write

T124 as worded in `docs/TASKS.md:355-356` iterates `NormalizeOptions`. A TypeScript interface has no
runtime representation, so "iterating" it requires a hand-written key list — which is exactly the
thing that silently goes stale when a sixth field is added. Two halves, and both are needed:

**(a) A compile-time exhaustiveness guard, in the module that owns the type.**

```ts
// packages/core/src/normalizer/index.ts, beside the interface
export const NORMALIZE_OPTION_KEYS = [
  'codeBlocks', 'pathStyle', 'extensionStyle', 'expandNumbers', 'orderedLists'
] as const satisfies readonly (keyof NormalizeOptions)[]

// Adding a field to NormalizeOptions without adding it here fails to COMPILE.
type _MissingNormalizeKey =
  Exclude<keyof NormalizeOptions, (typeof NORMALIZE_OPTION_KEYS)[number]> extends never ? true : never
const _normalizeKeysAreExhaustive: _MissingNormalizeKey = true
```

The same pair for `CHUNKER_OPTION_KEYS` (excluding `countUnits`, which is a function, with the
exclusion written as a named constant so the exclusion itself is reviewable) and
`SYNTHESIZE_OPTION_KEYS` (excluding `signal`).

**(b) A runtime test that iterates the schema, in three assertions.**

```ts
for (const owner of ['normalize', 'chunk', 'synthesize'] as const) {
  const wired = Object.values(SETTINGS_SCHEMA)
    .filter(d => d.owner === owner && d.wire !== null)
    .map(d => d.wire!.split('.')[1])
  // 1. every schema field points at a real property of the real options type
  expect(new Set(wired)).toBeSubsetOf(new Set(OPTION_KEYS[owner]))
  // 2. every property of the real options type is reachable from settings
  expect(new Set(OPTION_KEYS[owner]).difference(new Set(wired))).toEqual(new Set(EXCLUDED[owner]))
}
```

Assertion 2 is the one the brief asks for: **a new normalizer option that is not settable fails the
test**, because it appears in `NORMALIZE_OPTION_KEYS` (forced by (a)) and not in the schema. Any
deliberate exclusion must be named in `EXCLUDED`, so an exclusion is a reviewable line rather than a
silent omission.

**(c) The half that P26 says is the actual check.** Assertions (a) and (b) prove the *names* line up.
They cannot prove a value **arrives**. So T124 also carries a reachability case per owner, in the
shape `speech-service.test.ts` already uses ("voice, rate and chunking are reachable from the
caller"): build a settings file that differs from every default, load it through `parse()`, drive the
outermost object a real caller constructs, and assert the innermost consumer received the changed
value — **with the control case** (a defaults-only file → the consumer receives `{}`), so the positive
assertions can be shown to fail for the right reason.

**(d) The gap report, extended for R7-06 and R7-29.** T124 does not only assert; it **prints a
counted gap report**, and CI attaches it. Four counts, each of which is a number someone can watch
move:

| Count | What it is | Why it is counted |
|---|---|---|
| `wired` | descriptors with `wire !== null` | Today **9** of 46 (3.2). |
| `designed-not-wired` | descriptors with `wire === null` | The lab renders these; nothing consumes them. |
| `excluded` | entries in `EXCLUDED` | An exclusion must be a reviewable line, never a silent omission. |
| **`future` (new)** | descriptors with `since > SCHEMA_VERSION` | **R7-29.** These are the ids a *later* milestone registered against a schema this build has not bumped to. They must be visible, or M16/M17 land controls that no starter file writes, no lab renders, and no gap report counts. |

`future` fields are excluded from the reachability assertion (they have no consumer yet, by
definition) and **included in every other count**, in the starter file as commented-out lines, and in
the lab as disabled rows labelled *"arrives in a later version"*. A `future` field with
`wire !== null` is a contradiction and fails the test.

**Verify by effect for T124 itself:** add a sixth field to `NormalizeOptions` on a scratch branch and
confirm (a) fails to compile *and* (b) goes red. A test that could not have failed is not a check.

---

## 4. Migration and versioning

### 4.1 The three-line policy

- **File newer than plugin** (`file.schemaVersion > SCHEMA_VERSION`): **load it**, apply every field
  the plugin understands, ignore the rest, and **say once, aloud**, how many were ignored.
- **File older than plugin** (`<`): run the migration chain step by step to `SCHEMA_VERSION` in
  memory, apply, and **never write the migrated result back to the inbox** — the listener's file is
  theirs; the migrated form goes to the KV mirror only.
- **Field removed**: never. Mark `deprecated` and keep the id reserved forever; a migration moves its
  value to `replacedBy` when there is a successor, and drops it silently when there is not.

### 4.2 Why "newer file" is tolerated rather than refused

X-08's option (b) proposes refusing an unknown `schemaVersion` **by name**. Refusing is right about
the diagnosis and wrong about the remedy for *this* user: a refused settings file means the plugin
speaks with default voice, default rate, default path style — which for a dyslexic, voice-first
listener is not a safe fallback, it is the failure. Tolerate-and-announce keeps 45 working controls
and reports the one that is not.

The asymmetry is deliberate and worth stating: **adding a field is a minor bump and is
forward-compatible; changing the meaning of an existing id is not allowed at all.** If a control's
semantics change, it gets a **new id**, and the old one becomes `deprecated` with a migration. This is
what makes X-08's real worry — M12 freezing a schema that M14 must extend — a non-event: M14 adds
`omit.artifacts.*` ids at `since: 3`, an M12-era plugin ignores them and says so, and no migration is
needed in the common direction.

`SCHEMA_VERSION` starts at **2**, not 1. 004 published `schemaVersion: 1` describing a schema that was
missing `orderedLists` and persisted a voice *name* (its own round-3 amendment says so). Shipping the
corrected shape as `1` would mean two incompatible files both claiming version 1 — the one thing a
version number exists to prevent. Version 1 is burned; the loader recognises it and migrates it
(`voice: string` → `voiceIndex` + `voiceNameChecksum`, per 004 section 7 and PITFALLS **P28**).

### 4.2a How a later milestone adds ids — the protocol R7-29 asks for

`014` R7-29 found `012` and `013` inventing **at least seven** settings this schema does not carry,
citing `011` nowhere. The mechanism to carry them already exists two paragraphs up (*M14 adds
`omit.artifacts.*` ids at `since: 3`*) — what was missing is a **stated protocol**, so a later
document adds an id rather than inventing a setting. Here it is, in four rules.

1. **A later milestone registers a `FieldDescriptor` in `SETTINGS_SCHEMA`, at `since: N+1`.** It does
   not invent a constant, a config key, or a "setting with a floor of 1,000 ms" in its own prose. A
   setting that is not a descriptor is not a setting; it is a comment (**P26**).
2. **`SCHEMA_VERSION` bumps once per milestone that adds ids**, not once per id. M14, M16 and M17 may
   all land at `since: 3` if they ship against the same schema version; the number tracks the *shape*
   of the file, not the calendar.
3. **The design document that wants the control writes one row** — id, `kind`, `default`,
   `provisional`, `effect`, `wire`, `since` — and **cites `011` for everything else**. Ownership of
   the field's *meaning* stays with the milestone; ownership of the *schema, the file format, the
   defaults rule and the migration policy* stays here.
4. **Nothing is renamed and nothing is repurposed.** 4.2's asymmetry applies to later milestones
   exactly as it applies to M12: a new meaning is a new id.

**The forward register.** These are the ids `012` and `013` need, named here so both documents cite
rather than invent, and so T124's `future` count (3.3 (d)) has something to count. **The values are
each milestone's to set; the ids are reserved now.**

| Id | Owner | Kind | Milestone, and where it is argued | Note |
|---|---|---|---|---|
| `session.followMax` | `session` | `int` \| `'all'` | M16 — `012:123` (`FOLLOW_MAX`), `012:602` (Q70: *"1..7 plus `all`"*) | The `'all'` sentinel means the `kind` is `enum`-with-range; `012` specifies which. |
| `session.registryPollMs` | `session` | `int` | M16 — `012:508` | `012` states a floor of 1,000 ms; that floor is the descriptor's `range.min`, not a literal in a poll loop. |
| `session.unregisteredWindowMs` | `session` | `int` | M16 — `012:240` (`UNREGISTERED_WINDOW`, default 10 min) | |
| `session.showUnregistered` | `session` | `bool` | M16 — `012:608` (Q76) | |
| `queue.perSessionFairness` | `queue` | `bool` | M16 — `012:255`, `012:279` | **Already specified in 3.2a**, because it is a redefinition of a field `011` owns. |
| `input.talkWindowMs` | `input` | `int` | M17 — `013:202`, `013:437` (`TALK_WINDOW_MS`, Q77) | |
| `input.talkGesture` | `input` | `enum` | M17 — `013:202`, `013:437` (Q77) | |
| `input.resumePolicy` | `input` | `enum` | M17 — `013:334` (Q19/Q78, *"ship all three behind one setting"*) | Exactly the shape this schema is for: three behaviours, one enum, `provisional`. |
| `input.recognizerCommand` | `input` | `string` | M17b — `013:407` | A command path is `enginePersonal: true` and does not transfer between machines. |

That is **nine reserved ids**, against R7-29's floor of seven — the extra two are `queue.perSessionFairness`
(counted by R7-06 instead) and the split of `TALK_WINDOW_MS` from its gesture, which are two decisions
and therefore two ids.

> **Line numbers in `012` and `013` above were read 2026-08-21 while `012` was under concurrent
> amendment by another pass.** Each citation carries the symbol it anchors on, so
> `pnpm check:citations` can re-anchor it if those documents move; the symbol, not the number, is the
> claim.

**This is coverage, not architecture.** Nothing above changes where settings live, how they are
ordered, or how they migrate. It changes only that M16 and M17 land ids the starter-file generator,
the lab and T124 already know how to count.

### 4.3 Where a settings failure surfaces

**This is the part FMA section 20 and P30 make load-bearing.** T123 requires per-field fallback that
logs which field failed. `host.log` is still swallowed — `try { orca.log(m) } catch { logFailures++ }`
(`packages/plugin/src/adapter/index.ts:101`) — so a log-only report is a report the listener never
receives. Of the 55 silent-failure sites the FMA counted, the number reaching the audio stream was
**zero**. A settings loader that only logs is a settings loader that fails silently.

> **Corrected 2026-08-21 while re-verifying citations.** This paragraph used to add *"and `notify`
> discards its delivery result (`adapter/index.ts:63-65`)"*. **That is no longer true of the code.**
> `adapter/index.ts:122-126` now reads `{ delivered: false }` as a successful call reporting a failed
> delivery and routes it to `onUndelivered` (`adapter/index.ts:66`, `:118`). The fact expired; the
> argument it supported does not, because `host.log` is still the drain above. Stated rather than
> quietly deleted, because an inherited fact that expires is the failure mode E-01 exists for.

`parse()` returns the rejections rather than swallowing them:

```ts
export interface ParseResult {
  readonly settings: Settings            // fully populated; every field has a value
  readonly revision: number
  readonly rejected: readonly { field: string; reason: string; usedDefault: unknown }[]
  readonly unknownFields: readonly string[]     // newer file
  readonly migratedFrom?: number
}
```

Destinations, in this order:

1. **Spoken — the channel this listener actually has, when they are actually using it.**
   `SpeechService.announce(text, 'next')` (`packages/plugin/src/speech-service.ts:191`), urgency
   `next`, so it is heard **after** whatever is playing and never interrupts. Coalesced into one
   sentence, naming at most two fields and a count: *"Three settings could not be read and are using
   their defaults: how a path is said, and two others. Say status to hear the rest."* Announcements
   are already exempt from overflow trimming (`speech-service.ts:80-81`), so the report cannot be
   dropped by the thing it is reporting. **This destination is now gated — see 4.3a.**
2. **`read-aloud.status`** gains a settings-health clause, so the listener can ask again in an hour.
   It must **not** clear the queue to answer (that was C5).
3. `host.log` and `notify`, as supplements, exactly as `onDropped` is a supplement today
   (`speech-service.ts:57-65`).

Silence means a clean load. A clean load says nothing — adding a "settings loaded" chirp would spend
the listener's only channel on non-news.

### 4.3a The report's channel is itself a setting — R7-31

**The finding.** `next` protects a listener who is already hearing something. It does nothing for a
listener who is hearing nothing: with an empty queue, `next` **is** now. For the author — voice-first,
huddle on — a spoken settings report at `activate()` is correct and wanted. For a second user who
installed this to read a selection on a hotkey, ORCA launching with one stale field produces a voice
announcing a settings problem **into a room where nobody asked for audio**. Every default in this
document is honestly marked `provisional` (section 5); the **delivery channel** was not one of the
marked axes, and that omission is what `014` R7-31 caught.

**This is partly correctness and partly taste, and they separate cleanly.**

| | |
|---|---|
| **Correctness — decided here** | A failure must reach a channel the listener has (**P30**), and an unrequested interruption is itself a harm (**P22**, **P30**). Both hold simultaneously, so *some* channel always carries the report and `read-aloud.status` always carries it on request (destination 2). **The report is never dropped.** |
| **Taste — not decided here** | *Which* channel carries it unprompted, on a machine whose owner we have not met. That is a judgement about a first-run experience nobody has heard, and picking it silently is exactly **P23**. |

**So the option space is designed and the value is left to the listener** — stated explicitly here
because a document that quietly picks a default is indistinguishable from a document that never saw
the question.

```ts
'announce.reportChannel': {
  id: 'announce.reportChannel', owner: 'announce', panel: 'Announcements',
  label: 'how settings problems are reported',
  help: 'Whether a settings problem is spoken as soon as it is found, spoken only when you are already using audio, or kept for when you ask.',
  kind: 'enum',
  values: ['always-spoken', 'when-audio-in-use', 'on-request-only'],
  default: 'when-audio-in-use',
  provisional: true,            // TASTE. See Q68. Nobody has heard all three.
  effect: 'session',            // read at activate(), before any utterance exists
  enginePersonal: false,
  wire: 'SettingsReport.channel',
  since: 2
}
```

| Value | Unprompted behaviour | Who it is right for |
|---|---|---|
| `always-spoken` | Speak at `activate()`, `next` urgency. Today's specified behaviour. | The author: huddle on, audio is the primary channel, silence about a problem is worse than a sentence. |
| `when-audio-in-use` | **Speak only on evidence the audio channel is in use** (below). Otherwise `notify` at `activate()`, and hold the sentence for the first spoken moment or for `read-aloud.status`. | A machine whose owner has not told us they want audio yet. |
| `on-request-only` | Never unprompted. `notify` plus `read-aloud.status`. | Someone who wants the plugin mute until they press a key. |

**"Evidence the audio channel is in use" is a named predicate, not a vibe.** It is true when **any**
of these holds, and each is a fact the worker already has:

1. **Huddle is on** — the persisted huddle flag is already read at `activate()`:
   `void huddle.restore().then(...)` `void huddle.restore()` at `packages/plugin/src/main.ts:247`, over the `storage` pair wired as
   `store: { get: host.storageGet, set: host.storageSet }` (`packages/plugin/src/main.ts:236`); and `huddle.enabled` is already the first clause pushed by the command registered at
   `main.ts:268` (`:271`). Huddle on *is* a standing request for audio, and no new state is needed to know it.
2. **A speak request has landed this session** — any `read-aloud.*` speak command has run since
   `activate()`. The listener has demonstrated the channel.
3. **The listener asked** — `read-aloud.status`, which is destination 2 and always answers.

Under `when-audio-in-use` with none of the three true, the report is **held, not discarded**: it is
queued as a pending report and spoken at the head of the **first** utterance the listener requests, so
the first thing they hear after asking for audio is *"Before that — three settings could not be read."*
A held report that expires silently would be the P30 shape wearing the uniform of politeness.

**Why `when-audio-in-use` is the value in the code and not the answer to the question.** It is the
reversible middle: it is what `always-spoken` degrades to on a machine that never uses audio, and what
`on-request-only` becomes the moment the listener presses the hotkey. Shipping it costs the author one
`storage` read at `activate()` (huddle is on, so predicate 1 fires, so their experience is unchanged),
and it costs a second user nothing they did not ask for. **It is `provisional: true` and it is Q68.**
The listener settles it in Voice Lab against a recorded first-run fixture — not in this document.

**Verify by effect, with the negative control.**

| | Setup | Assert |
|---|---|---|
| **Positive** | `announce.reportChannel: 'when-audio-in-use'`, **huddle off**, no speak command, one bad field in the inbox. `activate()`. | **Zero** provider calls. `notify` was called once. Then issue one speak command and assert the provider's **first** text contains the settings sentence *and* the requested text. |
| **Control 1** | Same, but **huddle on**. | The provider receives the settings sentence **at `activate()`**, with no speak command. |
| **Control 2** | Same as positive, but a **clean** inbox. | Zero provider calls, **zero** `notify` calls, and no held report — so the positive row's `notify` is shown to be caused by the bad field and not by startup. |

Control 2 is the row that makes the other two evidence: without it, a report that fired on every
launch regardless of file health would pass both of the first two.

**Verify by effect.** Construct the loader with **no** `log` and **no** `notify`, hand it a file with
one bad field, and assert on the **text the provider was handed** — the sentence naming the count —
not that a callback fired. Control case: a valid file produces **zero** provider calls. This mirrors
`speech-service.test.ts` "losses and degradations reach the audio stream".

---

## 5. Defaults

**One rule: a default is a data field in `SETTINGS_SCHEMA`, and the code that consumes a setting has
no fallback literal at all.** `parse()` always returns a fully populated `Settings`, so a consumer
never needs `?? something`. That removes the class of bug now live at `main.ts:152` (`maxQueued: 8`)
against `speech-service.ts:74` (`DEFAULT_MAX_QUEUED = 20`).

**Pinned by a lint, not by discipline.** A test greps the consumer modules for `??` and `||`
fallbacks applied to a settings-derived value and fails on any hit, with an allowlist of named
exceptions. Verify by effect: re-introduce `maxQueued: 8` at a call site and confirm the test goes red.

**Taste is marked, not hidden.** `provisional: true` means *"this value was chosen so the plugin
would run; nobody has heard it and decided."* The consequences are concrete:

| | `provisional: false` | `provisional: true` |
|---|---|---|
| requires `rationale` | **yes** | no |
| Voice Lab rendering | normal | marked *"not yet settled"*, and listed first in its panel |
| changing the shipped value | a design decision | **a data edit** — one line in `schema.ts`, no consumer touched, no test rewritten |
| counted in the status bar | — | 004's `46 controls · 8 EP` becomes `47 controls · 8 EP · N unsettled` (3.2) |

This is **P23** made structural: *"Ship the mechanism and let the listener choose the values."* When
the listener settles a control in Voice Lab, two things happen — the value lands in their inbox
immediately (they hear it now), and the lab emits a **settled report** (`lab/settled.json`, a list of
`{id, value, heardAt}`) that a maintainer folds into `schema.ts` as a one-line `default` change with
`provisional: false` and a `rationale` quoting what the listener said. The report exists so that
"settled by ear" leaves a trace instead of living in a chat log that ages out.

**Every taste question this document itself opens is marked `provisional` rather than decided:**
`apply.toQueued`, the announcement's field-naming budget (two names plus a count, or one, or all),
whether a `session`-class change is announced at the moment of the change or at the next start, and
the entire `announce.*` wording set. The option space is designed; the values are the listener's.

---

## 6. The degraded path — no lab, and a human with an editor

The Voice Lab is a local server the listener must start. Settings must work when it has never been
run, and must be safely hand-editable when it is not running.

**Format: JSONC** — JSON plus `//` and `/* */` comments, trailing commas tolerated. The reasoning is
forced: hand-editability requires that each control carry its explanation *at the point of edit*,
because a listener who must cross-reference a separate document to know what `pathStyle: "terse"`
means will not edit the file. JSON forbids comments. YAML would add significant-whitespace failure
modes to a file a dyslexic user edits by hand. TOML needs a real parser. A comment-stripper for JSONC
is ~60 dependency-free lines in `packages/core/src/settings/jsonc.ts`, and the normalizer's own
constraint — *imports nothing, not even `node:` builtins*
(`packages/core/src/normalizer/index.ts:4-6`) — says that is the house style. The file is `.jsonc` so
editors highlight it correctly.

**Create-once starter file — amended for R7-27.** On `activate()`, if the inbox does not exist, the
worker writes it: every field in the schema, in schema order, with banner comments per group, and each
field preceded by its `help` sentence and its legal values — **all generated from `SETTINGS_SCHEMA`, so
the comments cannot drift from the code.** Provisional fields are marked in their comment. Then the
worker never writes that file again.

**The values are not necessarily the defaults.** The generator takes a `Settings` record and a
`revision` as arguments; section 1.2a supplies them — **the mirror's values and `mirror.__revision + 1`
when a mirror exists**, the schema defaults and `1` when it does not. This is the whole of R7-27's fix
on this side: the sentence that used to read *"every field in the schema, at its default"* was what
made the mirror unreachable, because a fully-populated default file wins per-field precedence against
every mirrored value. **That wording is withdrawn.** A restored file additionally carries
`"writtenBy": "read-aloud/<version> (restored)"` and a banner comment at the top saying it was rebuilt
from the last known-good settings and when.

```jsonc
{
  "kind": "orca-tts-settings",
  "schemaVersion": 2,
  "revision": 1,
  "writtenBy": "read-aloud/0.4.1",

  "settings": {

    // ───── How a path is said ─────────────────────────────────────────────
    // How file paths are spoken.
    //   "spoken"   — file named session handler, python, in folder src core
    //   "terse"    — session handler, in folder src core
    //   "verbatim" — the raw path, untouched
    // Not yet settled by ear — change it freely.
    "normalize.pathStyle": "spoken",
    …
  }
}
```

**Discoverability, since the listener cannot see a settings pane.** `read-aloud.status` **speaks the
path** on request, and the one-time spoken report in section 4.3 ends with it. A file the listener
cannot find is a file the listener does not have.

**And it speaks what was actually loaded — R7-32.** `read-aloud.status` (`packages/plugin/src/main.ts:268`,
which already assembles a `parts[]` of spoken clauses at `:270-276`) gains a **settings clause**:

> *"Settings revision 18, written 12 minutes ago by hand, from `<path>`. Three fields are using their
> defaults."*

Four values, each chosen because it distinguishes a specific confusion the listener would otherwise
have no way to resolve:

| Spoken | Distinguishes |
|---|---|
| `revision` | *the watch is dead* from *I edited the wrong thing*. The listener edits, hears no change, asks status: an unchanged `revision` means the plugin never saw their write. |
| `writtenAt`, spoken as **relative age** ("12 minutes ago") | *my edit landed* from *I am hearing a file from last week*. Relative because an absolute timestamp read aloud is a sentence nobody can parse (**what listening taught us**: "52 ms was odd to hear"). `writtenAt` is still **never** compared for ordering (2.1) — speaking it is diagnostics, which is the only thing 2.1 permits it for. |
| `writtenBy` | *the lab overwrote my hand edit* from *my hand edit won*. |
| the rejected count | the settings-health clause of 4.3 destination 2. |

It must **not** clear the queue to answer (C5), and it is `next` urgency, because the listener asked.

**The watch-health fallback — R7-32's other half.** Q66 asks whether `fs.watch` survives a
rename-write; the answer changes how likely this is, **not whether the fallback ships**. It ships
either way, because the failure it guards is indistinguishable from user error (Principle I) and the
guard costs one `stat` on one file:

1. **`fs.watch` stays the primary**, 250 ms debounce, the P20 shape — **with its `'error'` event
   subscribed**, exactly as huddle already does —
   `w.on('error', (err) => { this.#watchFailed(file, err) })`
   (`packages/plugin/src/huddle/index.ts:319`). An
   unsubscribed `'error'` on an `FSWatcher` is both a silent death and a process-level throw waiting
   to happen; that is a settled lesson on the transcript path and it transfers unchanged. A watch
   that reports its own death is the cheap half of this fix; the poll below is the half that catches
   the death it does **not** report.
2. **A `fs.stat` poll runs alongside it**, every 2,000 ms, comparing `(mtimeMs, size, ino)` against the
   loaded snapshot's. One `stat` on one file every two seconds is not a cost worth a setting; it is a
   constant, `SETTINGS_POLL_MS`, in `packages/core/src/settings/`.
3. **A change the poll sees and the watch did not report is a watch failure, named.** The worker
   re-reads the file, promotes it normally, **re-arms the watch on the new inode**, and increments a
   `watchMisses` counter.
4. **The first miss in a session is said once, aloud:** *"I am now checking your settings file every
   couple of seconds — the automatic notification stopped working."* Subsequent misses are counted,
   not spoken. `read-aloud.status` reports the counter, so a permanently degraded watch is one question
   away rather than invisible.
5. **`ino` is in the comparison on purpose.** A rename-write can produce an identical `mtimeMs` and
   `size` on a fast machine — the same file content saved twice — and the inode is the value that
   actually changed. Where `ino` is unavailable or unstable (Windows, some network filesystems) the
   pair `(mtimeMs, size)` alone is the comparison and the poll is the only detector on that platform.

**Verify by effect, with the negative control.** Load a tuned inbox. **Disable the watch entirely**
(inject a no-op watcher, so the poll is the only detector). Write a new `revision` to the file. Assert:
the provider receives the new value within ~2.5 s, `read-aloud.status` speaks the **new** `revision`,
and the degradation sentence was spoken **once**. Control: with the watch enabled and working, write
the file and assert `watchMisses` is **0** and the degradation sentence is **never** spoken — an
indicator that is always red carries no information (a permanently-firing "the watch failed" notice is
the same failure as no notice at all).

**What a hand-edit costs.** The worker watches the inbox (`fs.watch`, 250 ms debounce — the same shape
huddle already uses for transcripts, PITFALLS **P20**, wired at
`packages/plugin/src/huddle/index.ts:314` with the debounce at `:340`, and — the precedent worth
copying — its `'error'` event subscribed at `:319` into `#watchFailed`, because *"a rename-replace
write or an inode change silently ends the watch"* was FMA site 7 on the transcript path
(`huddle/index.ts:315-318`)), **backed by the stat poll above**, so an edit takes effect on the next utterance with no restart and does so even when the
watch is attached to a dead inode. A syntax error that makes the whole file unparseable falls back to the KV mirror and
is **spoken**: *"Your settings file has a syntax error on or near line 34. I am using the last good
settings."* A single bad *value* falls back per field (T123) and is reported by the same route.

**What a lab Save costs a hand-editor, said honestly.** Save rewrites the whole file from the schema
template. Generated comments are regenerated and survive; **a comment a human added does not.** Two
mitigations, both stated rather than assumed: the lab warns before the first Save over a file whose
`writtenBy` is `"hand"`, and **Export a copy** (004 section 7) remains the artifact a human annotates
and version-controls freely, since the plugin never reads it.

---

## 7. Read and write paths

```mermaid
flowchart TB
    subgraph browser["Voice Lab page (browser)"]
        UI["47 controls at schemaVersion 2<br/>+ 9 reserved at since:3, disabled<br/>renders from SETTINGS_SCHEMA"]
    end
    subgraph server["Voice Lab server (local, node)"]
        SRV["POST /settings<br/>re-reads file, checks revision,<br/>rewrites whole file from schema template"]
    end
    subgraph fs["Filesystem — our namespace"]
        INBOX[("settings.jsonc<br/>$XDG_CONFIG_HOME/orca-tts/<br/>~/Library/Application Support/orca-tts/<br/>%APPDATA%\\orca-tts\\<br/><b>revision N</b>")]
    end
    subgraph human["A human with an editor"]
        VIM["vim / VS Code"]
    end
    subgraph worker["Plugin worker (ORCA)"]
        WATCH["fs.watch + 250 ms debounce (P20 shape)<br/>'error' subscribed<br/>+ fs.stat poll every 2 s (R7-32)"]
        PARSE["parse(unknown): ParseResult<br/>per-field fallback (T123)<br/>migrate v1..v(N-1)"]
        SNAP["SettingsSnapshot<br/>{revision, values} — immutable"]
        SS["SpeechService<br/>settings injected as a GETTER"]
        ANN["announce(text,'next')<br/>SPOKEN — gated on announce.reportChannel<br/>+ evidence audio is in use (R7-31)"]
    end
    subgraph orca["ORCA main process"]
        KV[("settings:own KV<br/>&lt;userData&gt;/plugins-data/<br/>yorailevi.read-aloud/settings.json<br/><i>deleted on uninstall</i>")]
    end

    UI -->|"Save to plugin"| SRV
    SRV -->|"write, revision N+1"| INBOX
    VIM -->|"write, revision N+1"| INBOX
    INBOX --> WATCH --> PARSE --> SNAP
    SNAP -->|"settings.set, one key per field<br/>mirror only"| KV
    KV -->|"READ FIRST, always (R7-27)<br/>values + __revision + __schemaVersion"| PARSE
    PARSE -->|"rejected[] / unknownFields[]<br/>coalesced, never interrupting"| ANN
    SNAP -->|"per-utterance snapshot<br/>captured at enqueue"| SS
    ANN --> SS
    WORKERW["worker: create-once starter file, ONLY if the inbox is absent<br/>values = mirror if present, else defaults<br/>revision = mirror.__revision + 1, else 1 (R7-27)"] -.-> INBOX
    KV -.->|"supplies the values"| WORKERW
    WATCH -.- WORKERW

    KV -. "no route: settings.get/set are panel:false<br/>(plugin-host-api.ts:229, :239)" .-x browser
    INBOX -. "R024/C-04: never ~/.orca/" .-x orca
```

---

## 8. What this changes in TASKS M12

Not a task-list edit — a statement of what each existing task now means, so M12 can be planned
against it.

| Task | Now reads as |
|---|---|
| **T120** | `packages/core/src/settings/` owns `SCHEMA_VERSION`, `SETTINGS_SCHEMA`, `FieldDescriptor`, `parse()`, the migration chain, the JSONC reader/writer and the starter-file generator. The lab imports it (004's answer to Q36 stands). |
| **T121** | Watch the **inbox**; `settings.get`/`settings.set` are the **mirror** — read **first** at `activate()` (1.2a), never the primary *source of truth*. Adds two adapter methods — `packages/plugin/src/adapter/index.ts:74-75` today exposes `storageGet`/`storageSet` and nothing for settings. Also: settings become a **getter** on `SpeechService`, and `#synthesizeOptions()` moves out of the per-chunk loop (section 2.3). **Adds the stat-poll fallback and the watch-health counter** (section 6, R7-32), and subscribes the watcher's `'error'` event. |
| **T122** | Delete `maxQueued: 8` at `main.ts:152` and `DEFAULT_MAX_QUEUED` at `speech-service.ts:74`. Add the fallback-literal lint. **This is the whole of R7-06's code half**: after it, `queue.maxQueued`'s value exists in `SETTINGS_SCHEMA` and nowhere else, and `012`/`013` cite rather than restate (3.2a). |
| **T123** | `parse()` returns `ParseResult`; the report is **spoken** (section 4.3) **through the channel `announce.reportChannel` selects, gated on evidence the audio channel is in use** (4.3a, R7-31), with the log and the notification as supplements. A held report must survive to the first requested utterance. |
| **T124** | Iterates `SETTINGS_SCHEMA`, not `NormalizeOptions`, in the **four** parts of section 3.3 — compile-time exhaustiveness, schema-versus-type set comparison with a named `EXCLUDED` list, an end-to-end reachability case with its control, and **the counted gap report including the `future` bucket** (3.3 (d), R7-29). |
| **New, and no task carries it** | **The R7-27 restore path** (1.2a) — mirror read first, starter file generated from mirrored values, `revision` seeded to `mirror.__revision + 1` — with its verify-by-effect and negative control. It is T121-shaped work and blocks M12's implementation; `docs/TASKS.md` is another pass's file to edit, so it is recorded here rather than added there. |
| **Gate M12** | *"a value exported from Voice Lab, pasted into ORCA settings, produces byte-identical spoken text"* — there is no "ORCA settings" to paste into (Q35). Restate as: **a settings file written by the lab, dropped into the inbox on a second machine, produces byte-identical spoken text for the committed fixtures**, with the `provenance.platform` mismatch reported aloud when the platforms differ. |

---

## 9. Open questions this design leaves

> **Cite these document-qualified — `011 Q66`, not `Q66`.** `010` section 14 numbers from Q62 as well
> (`docs/design/010-provider-seam-and-resident-service.md:1248`), so **Q62–Q69 are ambiguous across the
> two documents** and `012:699` / `013:576` both record it. `011 Q66` is `fs.watch` reliability;
> `010 Q66` is idle cost. **Q68 is new here** (R7-31) and is free in `010`, which stops at Q66 — it is
> still written `011 Q68` because the ambiguous band is the band, not the individual number.

| # | Kind | Question |
|---|---|---|
| **Q62** | T | `apply.toQueued` — does a settings change reach utterances already queued? Default `false`, `provisional`. Option space in 2.4; the listener decides by hearing a four-deep queue both ways. |
| **Q63** | T | The failure announcement's naming budget: two field names plus a count, one plus a count, or a bare count with "say status for the list". Section 4.3 ships two; it is taste. |
| **Q64** | D | **004 Q46 inherits here, unresolved.** An `enginePersonal` value tuned on macOS lands in a file opened on Linux. Options: (a) apply anyway, (b) ignore `enginePersonal` fields whose `provenance.platform` differs and say so once, (c) attempt a mapping. This design carries `provenance` and `enginePersonal` so all three are expressible, and picks none. Recommendation, unsettled: (b). |
| **Q65** | D | Does the settings promotion need a verb in 003's envelope set at all? Section 2.2 argues it does not — a promotion never touches the playback queue, so there is nothing to order it against. If 003 later adds a control that *reads* settings synchronously, that argument lapses and `settings` becomes a ninth verb with `stale_revision` as its refusal code. |
| **Q66** | E | `fs.watch` reliability for a single file across the three platforms, under an editor that writes via rename (`vim`'s default) — a rename-write can leave the watch attached to the old inode. Probe before T121: edit the inbox with `vim`, `code`, and `printf >`, and assert the worker re-read it in each case. This is the one mechanism in this document with no citation behind it. **Amended for R7-32: the probe still runs, but it no longer gates anything.** The stat-poll fallback and the watch-health counter (section 6) ship regardless of the answer, because a dead watch is indistinguishable from user error to the listener. What Q66 now decides is only *how often the fallback is the thing doing the work* — and therefore whether `SETTINGS_POLL_MS` can be relaxed on a platform where the watch is reliable. |
| **Q68** | T | **`announce.reportChannel`'s default (4.3a, R7-31).** `always-spoken`, `when-audio-in-use`, or `on-request-only` on a machine we have not met. `when-audio-in-use` is in the code as the reversible middle and is `provisional`. **The listener settles it in Voice Lab against a recorded first-run fixture** — a stale-field inbox, huddle off, nothing playing — by hearing all three. The option space is this document's; the value is not. |
| **Q67** | D | Does the lab server refuse to start when the inbox is owned by a *newer* `schemaVersion` than the lab knows? Symmetric to 4.1 but the answer may differ: the lab writing a v2 file over a v3 file destroys settings, where the plugin merely ignores them. |

---

## 10. Summary

**Where they live.** An inbox we own — `settings.jsonc` under the OS config dir, never `~/.orca/`
(C-04) — written by the lab server or by hand, watched by the worker, mirrored into ORCA's
`settings:own` KV as last-known-good — **`revision` included, under the reserved key `__revision`**.
**Load is an ordered sequence, not precedence alone (1.2a, R7-27):** the mirror is read first; with an
inbox present, precedence per field is inbox, then mirror, then schema default; with the inbox absent,
the starter file is generated **from the mirrored values** at `mirror.__revision + 1`, because a
default-valued starter file shadowed the mirror in the only scenario the mirror existed for.
The sanctioned home cannot be the only home because the lab has no route into it
(`plugin-host-api.ts:229`, `:239`) and ORCA deletes it on uninstall (`plugin-install.ts:274-283`).

**Shape.** One flat record of dotted ids, one `FieldDescriptor` each, grouped by **owner** —
`normalize` `chunk` `synthesize` `queue` `announce` `session` `input` `apply` `lab` — with `wire`,
`effect`, `provisional` and `since` on every field. Flat because the KV mirror is flat, per-field
fallback is a loop, and T124 is a set comparison.

**Version policy, three lines.** Newer file: load it, ignore unknown ids, say how many once, aloud.
Older file: migrate in memory, never write back to the listener's file. Removed field: never removed —
`deprecated`, id reserved forever, value migrated to `replacedBy` when one exists.

**Ordering.** A settings promotion never bumps the playback generation and never clears the queue;
every utterance carries the snapshot current when it was enqueued. Stop therefore always wins, because
a settings write is not a playback operation at all.

**Reporting.** A settings failure always reaches the listener and never reaches them unasked-for on a
machine that has not asked for audio: `announce.reportChannel` (`provisional`, three options, 4.3a)
selects the unprompted channel, the spoken path is gated on huddle being on or a speak request having
landed this session, a held report is spoken at the head of the first requested utterance, and
`read-aloud.status` answers on demand in every configuration.

**Staying honest about what loaded.** `read-aloud.status` speaks the loaded `revision`, the relative
age of `writtenAt`, `writtenBy` and the rejected count, and a 2 s `fs.stat` poll runs beside
`fs.watch` so a watch left on a dead inode is detected, named once aloud, and worked around (R7-32).

**Ownership.** This document owns `queue.maxQueued` (3.2a) and the protocol by which a later milestone
registers new ids (4.2a). `012` and `013` cite; they do not restate a number and they do not invent a
setting.
