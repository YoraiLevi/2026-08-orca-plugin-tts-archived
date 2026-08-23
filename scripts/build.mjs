#!/usr/bin/env node
/**
 * Builds the shippable plugin ARTIFACT into dist/plugin/.
 *
 * The artifact must be a SELF-CONTAINED directory:
 *  - ORCA never runs a build at install time (git clone + recursive copy only), so the bundle has
 *    to be runnable as-is.
 *  - Artifact validation resolves realpaths and rejects anything escaping the plugin root, so a
 *    workspace `node_modules` full of symlinks makes the whole plugin Invalid (PITFALLS P17).
 *  - Hard caps of 2,000 files and 50 MB (PITFALLS P4).
 *
 * That is why we do NOT point ORCA at packages/plugin: it contains src/, node_modules/ and
 * tsconfig files that have no business shipping.
 */
import { build } from 'esbuild'
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUT = 'dist/plugin'

/**
 * R16-09 — `onnxruntime-node` must stay a BARE IMPORT, never a bundled dependency.
 *
 * It is an OPTIONAL native module, resolved at runtime from `node_modules` or from the model
 * cache (`loadOrt()` in `pocket-synth/engine.ts`), and it carries 270 MB of `.node` binaries for
 * five platforms. R022 forbids shipping those in the immutable install tree and the size gate caps
 * the artifact at 50 MB, so bundling it is wrong twice over.
 *
 * It became bundle-able by accident. The specifier used to be a VARIABLE -- `import(ORT_MODULE)`
 * -- which esbuild cannot follow, so it stayed external for free. R16-01 routed the load through
 * `engine.ts`, where it is the literal `import('onnxruntime-node')`, and esbuild followed it
 * straight into the native binaries. `pnpm build` has failed outright ever since:
 *
 *   No loader is configured for ".node" files: .../darwin/arm64/onnxruntime_binding.node   (x5)
 *
 * Nothing local noticed, because `dist/` is COMMITTED: a stale artifact that still imports fine is
 * indistinguishable from a fresh one until you rebuild. CI runs `pnpm build` and would have said
 * so; nobody read it.
 */
const EXTERNAL = ['node:*', 'onnxruntime-node']

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

await build({
  entryPoints: ['packages/plugin/src/main.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outfile: `${OUT}/main.mjs`,
  external: EXTERNAL,
  legalComments: 'inline'
})

await build({
  entryPoints: ['scripts/orca-tts.mjs'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outfile: `${OUT}/orca-tts.mjs`,
  external: EXTERNAL,
  legalComments: 'inline'
})

/**
 * R16-10 — assert what SURVIVED, not what was written.
 *
 * `main.ts` registered only `OsSynthProvider`, so esbuild tree-shook `PocketSynthProvider` out of
 * this bundle entirely and the artifact ORCA loads had no neural backend in it at all -- while 975
 * tests passed and the Voice Lab spoke with neural voices, because every one of them reached the
 * provider by a path the plugin does not take. A source-level import would not have caught it: the
 * import was never the question, reachability was.
 *
 * Paired with the opposite failure, because these two are one decision: ORT must NOT be inlined
 * (R16-09, 270 MB of `.node` binaries against a 50 MB cap), and the provider MUST be. Checking
 * only one of them would let a "fix" for either quietly break the other.
 */
const bundle = await readFile(`${OUT}/main.mjs`, 'utf8')
const required = ['PocketSynthProvider', 'OsSynthProvider']
const missing = required.filter((name) => !bundle.includes(name))
if (missing.length > 0) {
  throw new Error(
    `${OUT}/main.mjs does not contain ${missing.join(', ')}. Something the plugin must reach was ` +
    `tree-shaken out: the code exists and nothing in the bundle calls it. See R16-10.`
  )
}
// NOT a substring search for "onnxruntime_binding": `runtime.ts` names that file in its pinned
// integrity table, so the string is legitimately present and a naive check fires on the fix. What
// must be absent is the PACKAGE -- esbuild stamps a `// node_modules/...` header on every module
// it inlines -- and the megabytes that come with it.
const inlinedModule = /^\/\/ node_modules\/.*onnxruntime/m.exec(bundle)
if (inlinedModule !== null) {
  throw new Error(
    `${OUT}/main.mjs inlined ${inlinedModule[0].replace('// ', '')}. onnxruntime-node is optional, ` +
    `resolved at runtime, and 270 MB unpacked. Keep it in EXTERNAL. See R16-09.`
  )
}
const BUNDLE_CEILING = 2 * 1024 * 1024
if (bundle.length > BUNDLE_CEILING) {
  throw new Error(
    `${OUT}/main.mjs is ${(bundle.length / 1024 / 1024).toFixed(1)} MB, over the ${
      BUNDLE_CEILING / 1024 / 1024} MB ceiling. The plugin is a few hundred KB of glue; this size ` +
    `means a dependency that should be resolved at runtime got bundled. See R16-09.`
  )
}

// Execute the artifact, not its source. A second injected shebang made line 2 invalid JavaScript;
// every TypeScript test stayed green because none of them loaded the bundle Node actually runs.
const cliProbeDir = await mkdtemp(join(tmpdir(), 'orca-tts-cli-build-'))
try {
  const probe = spawnSync(process.execPath, [
    `${OUT}/orca-tts.mjs`, 'control', '--once', '--dir', cliProbeDir
  ], { encoding: 'utf8' })
  if (probe.status !== 1 || !probe.stdout.includes('control: not connected')) {
    throw new Error(
      `built control CLI did not render its named disconnected state ` +
      `(exit=${String(probe.status)}, stdout=${JSON.stringify(probe.stdout)}, ` +
      `stderr=${JSON.stringify(probe.stderr)})`
    )
  }
} finally {
  await rm(cliProbeDir, { recursive: true, force: true })
}

await cp('packages/plugin/orca-plugin.json', `${OUT}/orca-plugin.json`)
await cp('packages/plugin/panel.html', `${OUT}/panel.html`)

console.log(`build: ${OUT}/ (orca-plugin.json, main.mjs, panel.html, orca-tts.mjs)`)
