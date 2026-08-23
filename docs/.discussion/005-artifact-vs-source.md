# D005 — What else is asserted on SOURCE that never reaches the ARTIFACT?

**Status:** (a) and (b) resolved by measurement. **(c) BLOCKED** — coordinator `ask`
`msg_0499579fe283` timed out after 600000 ms with no answer. I did not pick a dist
policy.
**Opened:** 2026-08-23, forced by PITFALLS **P49** / round-16 **R16-10**. Round 17
(`docs/design/025-review-round17.md`) landed in parallel at `7a86765` and is cited
where it independently names the same leftover.
**Touches:** P5, P17, P49, R16-09, R16-10, R17-01, R17-06, SC-16.
**Does not change:** `.gitignore`, CI, `dist/`, product source. Evidence and a
decision body only.

Measured at **`7a86765`**, load averages **3.57 / 4.19 / 3.70** `[measured-here]`.
The rebuild-vs-committed diff was first taken at `adecd4e`; plugin source did not
change between those SHAs (`git diff --stat adecd4e..HEAD` is three files, none of
them under `packages/` or `dist/`). Checksums were re-compared at `7a86765` and
still matched.

---

## Question A — Is the committed `dist/` the build of the committed source?

**Verdict:** **Yes, at this SHA.** All four files are byte-identical. That is not
the same as "this will stay true."

### Method

1. Extracted `HEAD:dist/plugin` into `/tmp/p49-artifact-vs-source-<sha>/committed`.
2. Copied `scripts/build.mjs` to a gitignored path, rewrote only
   `const OUT = 'dist/plugin'` to a temp directory. The in-repo script was not
   edited. Shared `dist/plugin/main.mjs` mtime and sha256 were identical before
   and after the rebuild.
3. `diff -ru committed fresh` printed **0 lines**.

### Exact diff

```
(no output)
```

SHA-256, committed = fresh, all four files:

| File | SHA-256 |
|---|---|
| `main.mjs` | `ca91d28b8402052dc61c785ef3d49c4ea36f0b53ffa6a67b8310a59ba825f3a8` |
| `orca-plugin.json` | `05e6f65c5ce7db17e1196ffb5de7fc702f603f35cb60fa2d771e978d4e9b89d1` |
| `orca-tts.mjs` | `1ad38684a296bd4e5c010ec5a16ba8e5acdea0d0ab83d5877eaf4a1dfcfa491d` |
| `panel.html` | `c515de190083e696935d16b0982b130fd2035ad7d3d71bb1e304205f512dace3` |

`dist/` last changed in `0c66191` (the R16-09/R16-10 repair). Two later commits
(`adecd4e`, `7a86765`) did not touch it. The match is expected if those commits
are docs and a probe script, and it was still **measured**, not inferred.

### Options

**A1 — Treat the match as the end of the question.**

- **For:** the named value (checksum) is equal. There is no current drift.
- **Against:** this is a reading, not a gate. The same reading was available the
  whole time `pnpm build` was red (R16-09) and nobody took it.

**A2 — Add an instrument that fails when they diverge.**

CI today is:

```
pnpm test
pnpm build
```

then smoke on the *fresh* overwrite. It never runs `git diff --exit-code dist/plugin`.
SC-16 (`packages/plugin/src/seams/tailer-seam.test.ts`) compares the two
**manifest** copies and would have caught `791cc94`'s missing self-test. It does
not hash `main.mjs`. A stale JS bundle with an unchanged manifest is invisible
to every current gate, including the R16-10 substring search, because the stale
bundle still *contains the names*.

### Recommendation (A)

**A2.** The match at this SHA is the control. The defect is that nothing makes
the next SHA fail when it stops matching. That instrument is a CI step after
`pnpm build`, not a rewrite of the plugin. It is also option A of Question C;
I did not add it, because C is not mine.

---

## Question B — What else is tree-shaken out?

**Verdict:** R16-10's original hole (the class name missing) is **closed**. Two
other shapes are open. One of them is how a user actually hears silence.

Workspace product surface, for this question, is the three package barrels
(`packages/{core,providers,plugin}/src/index.ts`) plus the two artifact entry
points `packages/plugin/src/main.ts` and `scripts/orca-tts.mjs`. Voice Lab is a
third product; it loads **source** under plain node and is not this artifact.

`grep -c` on committed `dist/plugin/main.mjs` / `orca-tts.mjs` at `7a86765`:

| Symbol | Barrel? | Tested? | In `main.mjs` | In `orca-tts.mjs` | Read as |
|---|---|---|---:|---:|---|
| `OsSynthProvider` | `@orca-tts/providers` | yes | 2 | 0 | reached |
| `PocketSynthProvider` | `@orca-tts/providers` | yes | 2 | 0 | reached **as a name**. See row `ENGINE_MODULE` |
| `ProviderRegistry` | `@orca-tts/providers` | yes | 2 | 0 | reached |
| `activate` | `@orca-tts/plugin` | yes | 2 | 0 | reached (default export) |
| `normalize` | `@orca-tts/core` | yes | >0 | 0 | reached via `SpeechService` |
| `createProviderRegistry` | `@orca-tts/providers` (barrel-only) | yes (2 call sites in `provider.test.ts`) | **0** | **0** | **R16-10 leftover / R17-06** |
| `extractSpeakFence` | `@orca-tts/core` | yes (`m14-gates.test.ts`) | **0** | **0** | M14 helper; no production caller in either entry. Not claimed shipped |
| `identityFor` | **no** — `packages/core/src/identity/` is not re-exported by the core barrel | yes (`identity.test.ts`) | **0** | **0** | M15 design; not product surface yet |
| `downloadRuntime` | **no** — not re-exported by the providers barrel | yes | **0** | **0** | Voice Lab / cache installer, not the plugin entry |
| `ENGINE_MODULE` (`./engine.ts`) | n/a (internal specifier) | source tests load it via vitest | specifier **present**, file **absent** from `dist/plugin/` | — | **R17-01: the class is in the bundle, the engine load is not** |

Schema-introspection names on the core barrel (`EXCLUDED`, `OPTION_KEYS`,
`OWNERS`, `gapReport`, `fieldsByOwner`, `formatGapReport`, `excludedCount`,
`isOptionWired`, `WIRED_OWNERS`, `RESERVED_KEY_PREFIX`) are exported, tested,
and absent from the bundle. They are consumed by Voice Lab and schema tests.
They are not a plugin feature the listener can miss. Listed so the filter
"exported + tested + absent" is not silently narrowed.

### The two that are R16-10 again

**1. `createProviderRegistry` — the factory the repair did not call.**

`packages/providers/src/index.ts:16-21` registers OS preferred, Pocket beside
it. `packages/plugin/src/main.ts:12` imports `OsSynthProvider`,
`PocketSynthProvider`, `ProviderRegistry` and **does not import the factory**.
`main.ts:207-216` duplicates the same two `registry.register` calls. Tests of
the factory (`provider.test.ts:116`, `:312`) cannot go red for a bug in the
duplicate. Independently recorded as **R17-06**.

This is not "Pocket is missing from the bundle." `grep -c PocketSynthProvider
dist/plugin/main.mjs` is **2**. It is "the tests of the assembler do not watch
the assembler the plugin actually uses."

**2. `ENGINE_MODULE = './engine.ts'` — a dynamic import esbuild cannot follow.**

Independently confirmed in the committed bundle, not only in round 17's write-up:

```
dist/plugin/main.mjs:732   // packages/providers/src/pocket-synth/engine.ts
dist/plugin/main.mjs:895   "packages/providers/src/pocket-synth/engine.ts"() {
dist/plugin/main.mjs:1644  var ENGINE_MODULE = "./engine.ts";
dist/plugin/main.mjs:1776  this.#loadEngine = opts.loadEngine ?? (async () => await import(ENGINE_MODULE));
```

`PocketTts` **is inlined** (line 895). `prepare()` does not use that inlined
copy. It `import("./engine.ts")` as a sibling of `main.mjs`. `ls dist/plugin`
is four files and no `engine.ts`. Runtime dynamic imports in the same bundle:

```
import("onnxruntime-node")           # external, intentional (R16-09)
import(ENGINE_MODULE)                # sibling that does not exist
import(status.dir + "/onnxruntime_binding.node")
```

Round 17's first-red (`025` R17-01): artifact `activate()` with a ready staged
model and the OS floor unusable → `prepare-failed` naming
`Cannot find module '.../dist/plugin/engine.ts'`. Source `prepare()` on the
same cache: warm in 259 ms. `fb4ae69` added `scripts/artifact-e2e.mjs` as the
effect check. I did not add a second one.

### Options (B)

**B1 — Call the factory from `main.ts`, and make `#loadEngine` a literal import
(or reuse the inlined `engine_exports`).**

- **For:** one assembler, one load path. The tests of the factory start meaning
  something about the plugin. esbuild can see a literal `import('./engine.ts')`
  the way it already sees `#loadOrt`.
- **Against:** that is product repair. This document does not do it.

**B2 — Delete `createProviderRegistry` so the duplicate cannot drift, and keep
the engine load as a variable specifier.**

- **For:** removes a lying export.
- **Against:** leaves R17-01 intact. The listener still cannot get neural audio
  from the artifact.

**B3 — Leave both. Rely on `scripts/artifact-e2e.mjs`.**

- **For:** the effect check already exists after `fb4ae69`.
- **Against:** a probe that is not in `pnpm test` / CI is the R16-09 costume
  (the instrument exists and nobody runs it). `package.json` has
  `probe:artifact`; `.github/workflows/ci.yml` does not.

### Recommendation (B)

**B1, as an engineer prompt, not as an edit in this commit.** The substring
guard in `scripts/build.mjs` will stay green for R17-01 (`PocketSynthProvider`
is in the file). Presence of the class name is what round 16 learned to ask
and round 17 proved is not enough.

I did **not** add a failing check in this commit. `scripts/artifact-e2e.mjs`
already owns the R17-01 effect, and a second red test in the shared tree would
fail peers for a defect they are not repairing. The factory-name assertion
(`createProviderRegistry` in the bundle) would go red today and would go green
on a comment containing the string — R17-02's costume. The check that can fail
for the right reason is "artifact `prepare()` loads, or `main.ts` imports the
factory," and both are product edits.

---

## Question C — Should `dist/` be committed at all?

**Verdict:** **not mine. ASK timed out. No recommendation is recorded as a
choice.** The options and the evidence are below so the next reader can pick
without re-deriving.

### Evidence, not judgement

**The loader does not build.**

ORCA install is clone + copy. No `npm install`, no compile.

- `checkoutPluginGitSource` (`/Users/m5air/source/orca/src/main/plugins/plugin-git-repository.ts:33-41`):
  `git clone --depth 1` or fetch-one-commit. Nothing after checkout.
- `installStagedPluginTree` (`plugin-install-staging.ts:165-174`): `cp` recursive,
  filter is `.git` only.
- PITFALLS **P5**, cited those two files.

**Development load and marketplace load are different directories.**

- Development → Add writes `devPluginPaths` and `discoverPlugins` calls
  `readManifestDir(devPath)` (`plugin-discovery.ts:238-239`). The path is
  whatever the user pasted. README says paste **`dist/plugin`**. That
  directory must exist **on disk**. Git tracking is irrelevant to this path.
  `pnpm build` produces it.
- Marketplace git source is a **strict** `{kind: 'git', url, ref}` — no
  subdirectory field (`plugin-marketplace.ts:43-54`, `z.strictObject`).
  `inspectPluginInstallTree` reads `orca-plugin.json` at the **clone root**
  (`plugin-install-staging.ts:84-89`, `plugin-manifest-file.ts:12`). This
  repo's manifests live at `dist/plugin/` and `packages/plugin/`, not at
  repo root. Listing **this** repo as a marketplace plugin fails today
  **even with `dist/` committed.**

**Caps are not the reason.** At this SHA: 296 tracked files, 5.21 MB. Under
2,000 files / 50 MB. The nested manifest is the reason.

**We already tried un-committing it.** `791cc94`: *"commit dist, which I
wrongly excluded and which made a command unreachable."* SC-16 went red:
source declared `read-aloud.self-test`, shipped manifest did not. Tracking
was restored because `dist/` **is** the copy a clone-without-build loads,
for anyone who points ORCA at the committed tree rather than at a fresh
`pnpm build`.

`.gitignore` already encodes the split: `packages/*/dist/` is ignored;
`dist/plugin` is tracked, with a comment pointing at P5.

### Options

**A — Keep `dist/plugin` committed. Add `git diff --exit-code dist/plugin`
after `pnpm build` in CI.**

- **For:** matches P5 and `791cc94`. Makes Question A's match a gate instead
  of a reading. Does not require anyone to remember to commit the bundle:
  CI says so. Leaves Development → Add unchanged.
- **Against:** does not make marketplace work. This repo still has no
  `orca-plugin.json` at clone root. A freshness gate on a nested artifact
  is a gate on the dev-load copy, not on the install copy.
- **Against:** every source change that changes the bundle becomes a
  two-file commit (`*.ts` + `dist/plugin/main.mjs`), which is the window
  P49 hid inside.

**B — Gitignore `dist/plugin`. Require `pnpm build` before load. Reorder CI
to build before any test that reads the artifact.**

- **For:** a clone cannot silently load a stale bundle, because there is no
  committed bundle. R16-09 would have been a missing file, not a file that
  still imported.
- **Against:** `pnpm test` currently runs **before** `pnpm build` and SC-16
  reads `dist/plugin/orca-plugin.json` from disk. Gitignoring without
  reordering CI makes SC-16 red on a clean checkout.
- **Against:** anyone who follows README and forgets `pnpm build` pastes a
  path that does not exist. That is loud. Anyone who has an *old* leftover
  `dist/plugin` on disk from a previous clone... there isn't one, if it was
  never committed and they just cloned. Local dirty leftover is still a
  trap (P46's cousin).
- **Against:** marketplace is still impossible from this repo. Gitignore
  does not move the manifest to clone root.

**C — Keep committed, no new gate. Status quo.**

- **For:** zero work.
- **Against:** P49's exact mechanism, named, left in place. The next stale
  bundle will look like the current one until somebody rebuilds, and CI
  will be green because it rebuilds then throws the result away.

**D — Publish an artifact-only git ref whose root **is** the four files
(what marketplace actually needs). Treat in-repo `dist/` tracking as a
separate choice (A, B, or C).**

- **For:** the only option that makes `{kind:'git', url, ref}` installable.
  Four files, `orca-plugin.json` at root, under both caps, no workspace
  `node_modules` symlinks (P17).
- **Against:** a second ref (orphan branch or separate repo) to keep in
  sync. Without a freshness gate it is P49 pointed at a different remote.
- **Against:** T086 (marketplace entry) is not started and needs the
  author's approval to ask ORCA to list us. This option is the *shape* of
  that artifact, not permission to publish it.

### Recommendation (C)

**Not recorded.** Coordinator `ask` thread `msg_0499579fe283` timed out.
The standing rule: a silent pick is the defect that produced R16-08 (the
mailbox named the bug; nobody actioned it) and the round-15 cancel-contract
guess. A blocked report is the success condition.

If I had been required to write a *provisional* leaning for the engineer
who picks this up: **A for the in-repo copy** (because `791cc94` already
paid for un-committing it, and Development → Add is the path in daily use)
**and D when T086 is actually started** (because A does not satisfy the
marketplace loader). That sentence is not a decision.

### Engineer prompt (C, for whoever is allowed to pick)

Do not start from "build output belongs in git" or "build output does not."
Start from **which directory ORCA will treat as the plugin root.**

1. If the answer is "the path the author pastes in Development → Add":
   keep or drop `dist/plugin` as A or B, and in either case add a check
   whose first-red is a mutated `main.mjs` that `pnpm build` would not
   emit. `git diff --exit-code dist/plugin` after a temp-dir rebuild is
   that check. SC-16 stays; it only covers the manifest.
2. If the answer is "a marketplace `{kind:git}` listing of this repo":
   that listing cannot work until `orca-plugin.json` sits at the clone
   root of the listed ref. That is D, not A.
3. Do not gitignore `dist/plugin` without moving `pnpm build` above
   `pnpm test` and rewriting SC-16 to rebuild first. A check that reads a
   file git no longer has is a check that is red on every clean CI runner
   for a reason that has nothing to do with drift.

---

## Engineer prompt (A + B, unblocked)

These do not wait on C.

> After `pnpm build` in CI, fail if `git diff --exit-code dist/plugin` is
> dirty. Prove it: change one byte of `packages/plugin/src/main.ts` in a
> disposable worktree, run the check, record the red, restore. That is
> Question A's instrument.
>
> Make `#loadEngine` a literal `import('./engine.ts')` (or reuse the
> inlined `engine_exports` the way `#loadOrt` already does), so esbuild
> inlines the engine the production `prepare()` actually calls. The
> check is `scripts/artifact-e2e.mjs` going from
> `Cannot find module '.../engine.ts'` to 24 kHz neural PCM. Do not
> strengthen `bundle.includes('PocketSynthProvider')` — R17-02 already
> showed that substring staying green while the class is deleted.
>
> Make `packages/plugin/src/main.ts` call `createProviderRegistry()`, or
> delete the factory. A test that inverts preferred-vs-beside on the
> factory and stays green on the plugin is R17-06; after the call, that
> inversion must move the artifact.

---

## What this commit is not

- Not a product repair of `main.ts`, `engine.ts`, or `ENGINE_MODULE`.
- Not a `.gitignore` or CI change.
- Not a failing test added to the shared tree. Round 17's
  `scripts/artifact-e2e.mjs` already owns the R17-01 effect.
- Not a decision on C.
