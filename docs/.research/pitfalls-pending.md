# Pending PITFALLS entries — merge after FIX-parity-bugs lands

Staged here rather than appended directly, because an agent is appending to `PITFALLS.md` right
now and two concurrent appends is exactly how P24 happened.

## P?? — Parallel ORCA dev builds share one userData profile, so the CLI addresses the wrong app
**Symptom:** `orca <cmd>` silently talks to whichever dev instance started last. Both windows work.
Nothing errors.
**Cause:** a git worktree separates the *code*; nothing separates the *state*. Every checkout
resolves `userData` to the same `<appData>/orca-dev`. The dev single-instance lock is skipped on
purpose (stablyai/orca#1419) so parallel worktree builds are possible at all, so the second
instance boots fully and takes over the shared profile — rewriting `orca-runtime.json` and the
`cli/bin/orca` shim in place.
**Instead:** launch every worktree with its own profile.
`ORCA_DEV_USER_DATA_PATH="$HOME/Library/Application Support/orca-dev-$(basename "$(git rev-parse --show-toplevel)")" pnpm dev`
Address each instance through its own `"$P/cli/bin/orca"` shim, never a global one. Never create
`/usr/local/bin/orca-dev` — it binds to whichever checkout installed it last.
**Verify by effect:** read the `pid` in `<profile>/orca-runtime.json` before and after starting the
second instance. Shared profile, the pid changes. Isolated, it does not. Also `grep 'Replacing
daemon'` in the second instance's log: one line means shared, zero means isolated.
**Source:** the author's own write-up, https://gist.github.com/YoraiLevi/e171337e96dedd678769cdc0ba074bbd
· upstream stablyai/orca#15647, fix in #15648. Also: killing `pnpm dev` does NOT stop the app —
target the Electron main process directly. Each worktree needs its own `pnpm install` (native
modules are per-checkout). A new profile starts empty; agent logins live outside it and survive.

## P?? — A stock Ubuntu desktop has no `espeak-ng` binary, and our Linux floor is silent
**Symptom:** on stock Ubuntu 24.04 desktop, `listVoices()` returns `[]` and `generate()` throws
`OsSynthUnavailableError`. The bottom rung of the degradation ladder produces no sound at all.
**Cause:** the desktop image ships `libespeak-ng1` and `espeak-ng-data` — because
speech-dispatcher's backend links them — but **not** `/usr/bin/espeak-ng`, which lives in its own
package that is not in the manifest. The library's presence makes the binary look installed.
**Instead:** never infer a CLI binary from its shared library. Probe the binary itself, and when it
is absent say so audibly and by name. `spd-say` IS installed on that image but cannot write a WAV.
**Verify by effect:** `curl -sfL https://releases.ubuntu.com/24.04/ubuntu-24.04.3-desktop-amd64.manifest | grep -i espeak`
returns the library and the data package, and no `espeak-ng` row.
**Source:** `docs/.research/q-round1-platform.md`, Q31 Linux section.

## P?? — Voice names do not port across platforms, and there is zero overlap
**Symptom:** a persisted voice preference is meaningless on another machine.
**Cause:** macOS (`Samantha`), Windows (`Microsoft Zira Desktop`) and espeak-ng (`en-US+f3`) are
three unrelated namespaces with no shared member. Counts differ by an order of magnitude: 41 / 2 / 0.
**Instead:** persist an index or a seed into the host's runtime voice list, never a name. Design
identity for **N=2** and degrade upward; the macOS-first instinct produces a design that collapses
on Windows.
**Source:** `docs/.research/q-round1-platform.md`, Q31.

## P?? — A committed `dist/` will make the Voice Lab tune the wrong normalizer
**Symptom:** the lab's spoken output does not match the plugin's, with no error.
**Cause:** `packages/core/dist/` was tracked in git and two commits stale. The plugin is safe
because `package.json` main points at `./src/index.ts`, but a plain `.mjs` server importing the
built JS gets the old pipeline. Same input, two module paths, different speech.
**Instead:** `dist/` is gitignored and untracked. Any `.mjs` tooling imports the TypeScript source
through the same entry the build uses.
**Source:** `docs/.research/q-round1-codebase.md`, adversarial note 4.
