# The dev loop, and why the obvious one silently fails

## The trap

You edit `main.ts`, rebuild, and the plugin keeps running your old code. Nothing errors.

ORCA decides whether to re-fork a plugin worker by comparing a **spawn spec** built from
`pluginKey`, `rootDir`, `mainEntry`, capabilities, and `manifestRevision` — where `manifestRevision`
is `JSON.stringify(manifest)`. **Nothing in that spec hashes your worker's bytes.** The dev
watcher fires, `refresh()` runs, and both restart paths skip because the specs match.

Measured, not inferred (E5 in `docs/.research/orca-empirical-findings.md`).

## The second trap

"Just bump the version to change the manifest" does not work either — it works *too well*. A
manifest that declares `keybindings` folds a hash of **every file in the plugin directory** into the
consent fingerprint. So any byte change anywhere — including a stray `.DS_Store` — flips the plugin
to `needsReconsent` and **disables it** until re-approved.

Measured in E7: a one-character `version` edit moved the fingerprint and flipped the plugin to
pending, while an otherwise identical plugin without `keybindings` kept its fingerprint byte-for-byte.

## The loop that works

```bash
node scripts/dev.mjs
```

Four steps, all required:

1. **Build** the bundle.
2. **Read the LIVE fingerprint** — `plugins.list()`, find your `pluginKey`, take `consentFingerprint`.
   A stale one is refused: *"plugin … changed since its permissions were reviewed"*.
3. **Consent programmatically** — `plugins.consent({ pluginKey, reviewedFingerprint, decision: 'approve' })`.
   Verified to work with zero UI.
4. **Toggle** `setEnabled` off then on, forcing the re-fork step 1 did not cause.

Writing `pluginConsents` directly through `settings.set` does **not** work — it races the dev
watcher's re-hash.

## Verify by effect

Change a visible string, run the loop, and **hear the new string**. Hearing the old one means the
re-fork did not happen. Checking that the file on disk changed proves nothing.

## Where the logs are

There is no log file. Plugin logs are a **200-line in-memory ring buffer** (measured, E5). Read them
from the panel or devtools; they are gone when the worker is reaped.
