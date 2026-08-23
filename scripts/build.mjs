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
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { consultProvesRealPocket, REQUIRED_POCKET_FILES } from './artifact-score.mjs'

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
 * R16-10 / R17-02 / R18-01 / R19-01 — assert what SURVIVED by IDENTITY, not by
 * a sentence.
 *
 * Round 16 grepped a class name. Round 17 kept the name as a log string. Round 18
 * grepped `/pocket:/`. Round 18's repair grepped two longer substrings out of the
 * same haystack, and round 19's stub interpolated the product's own sentence:
 * `throw new Error(\`Pocket TTS model is not ready in ${ORCA_TTS_MODEL_DIR}:
 * missing tokenizer.model, mimi_encoder.onnx, eve.wav\`)`. `pnpm build` EXIT 0,
 * `PocketSynthProvider` gone, `PocketTts` gone. A sentence is a string and a stub
 * can copy any sentence we name.
 *
 * Discriminator a stub cannot forge: import `PocketModelUnavailableError` FROM
 * THIS BUNDLE and require `err instanceof` that class. Then the STRUCTURED
 * status (`err.status.dir` is the empty dir, `err.status.missing` enumerates
 * the 23 required files). The named exports are pinned AFTER esbuild tree-shakes,
 * so they do not keep a dead class alive — if production stopped constructing
 * `PocketSynthProvider`, the export is a ReferenceError and this arm is red.
 *
 * prefer — production wiring, empty model. Default `synthesize.engine` is `auto`,
 * which asks Pocket first. With no weights that MUST land on the OS floor at
 * rung=fallback AND name the substitution.
 */
const DEFAULT_EXPORT_SHAPE = `export {
  activate as default
};`
const IDENTITY_EXPORT_SHAPE = `export {
  activate as default,
  PocketModelUnavailableError,
  PocketSynthProvider
};`
const bundleRaw = await readFile(`${OUT}/main.mjs`, 'utf8')
if (!bundleRaw.includes(DEFAULT_EXPORT_SHAPE)) {
  throw new Error(
    `${OUT}/main.mjs default-export shape changed; cannot pin PocketModelUnavailableError ` +
    `and PocketSynthProvider as named exports (R19-01). The consult arm imports those ` +
    `classes FROM THE BUNDLE and demands instanceof.`,
  )
}
const bundle = bundleRaw.replace(DEFAULT_EXPORT_SHAPE, IDENTITY_EXPORT_SHAPE)
await writeFile(`${OUT}/main.mjs`, bundle)
await assertShippedProvidersByEffect()
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

/** @param {string[]} args */
function runArtifactChild (args) {
  return spawnSync(process.execPath, ['scripts/artifact-e2e.mjs', '--child', ...args], {
    encoding: 'utf8',
    timeout: 200_000
  })
}

/**
 * Load the JSON an artifact-e2e child wrote, or throw with the spawn's own words.
 * @param {import('node:child_process').SpawnSyncReturns<string>} probe
 * @param {string} outFile
 * @param {string} arm
 */
async function readChildResult (probe, outFile, arm) {
  let result = null
  try {
    result = JSON.parse(await readFile(outFile, 'utf8'))
  } catch {
    result = null
  }
  if (result === null) {
    throw new Error(
      `artifact-e2e --child ${arm} wrote no JSON (status=${String(probe.status)}, ` +
      `signal=${String(probe.signal)}, stdout=${JSON.stringify(probe.stdout)}, ` +
      `stderr=${JSON.stringify(probe.stderr)})`
    )
  }
  return result
}

async function assertShippedProvidersByEffect () {
  if (process.platform === 'darwin') {
    const leaked = spawnSync('pgrep', ['-x', 'say'], { encoding: 'utf8' })
    if (leaked.status === 0 && leaked.stdout.trim() !== '') {
      throw new Error(
        `leaked say process(es) already running (P42); not measuring on a dirty machine: ` +
        leaked.stdout.trim()
      )
    }
  }
  const runDir = await mkdtemp(join(tmpdir(), 'orca-tts-artifact-guard-'))
  try {
    const emptyModel = await mkdtemp(join(runDir, 'empty-'))
    // R19-01: a sentence is a string. Import the class FROM THIS BUNDLE and demand
    // the live throw is an instance of it, with structured status. The named
    // exports were pinned AFTER tree-shake, so a stub that interpolates the
    // product's sentence and drops the class is a ReferenceError here, not EXIT 0.
    if (!bundle.includes('var PocketSynthProvider = class')) {
      throw new Error(
        `${OUT}/main.mjs does not contain \`var PocketSynthProvider = class\` — the neural ` +
        `class was tree-shaken (R16-10 / R19-01). Presence is not effect, but its absence ` +
        `is round 19's interpolating stub.`,
      )
    }
    if (!bundle.includes('new PocketSynthProvider()')) {
      throw new Error(
        `${OUT}/main.mjs factory no longer default-constructs PocketSynthProvider. ` +
        `Omitting \`pocket\` must construct the class, or esbuild drops it (R19-01).`,
      )
    }
    const bundleUrl = pathToFileURL(resolvePath(`${OUT}/main.mjs`)).href + `?r19=${Date.now()}`
    let mod
    try {
      mod = await import(bundleUrl)
    } catch (err) {
      throw new Error(
        `${OUT}/main.mjs could not be imported for the R19-01 identity consult ` +
        `(PocketModelUnavailableError / PocketSynthProvider named exports). ${String(err)}`,
        { cause: err },
      )
    }
    const BundleError = mod.PocketModelUnavailableError
    const BundleProvider = mod.PocketSynthProvider
    if (typeof BundleError !== 'function' || typeof BundleProvider !== 'function') {
      throw new Error(
        `${OUT}/main.mjs did not export PocketModelUnavailableError and PocketSynthProvider ` +
        `as functions. The neural class was tree-shaken (R19-01). ` +
        `Error=${typeof BundleError} Provider=${typeof BundleProvider}`,
      )
    }
    let thrown = null
    try {
      await new BundleProvider({ dir: emptyModel }).prepare()
    } catch (err) {
      thrown = err
    }
    if (thrown === null) {
      throw new Error(
        `${OUT}/main.mjs PocketSynthProvider.prepare() succeeded against an empty dir ` +
        `(${emptyModel}). The consult arm must throw.`,
      )
    }
    if (!consultProvesRealPocket(thrown, emptyModel, BundleError)) {
      throw new Error(
        `${OUT}/main.mjs consult arm did not throw the bundled PocketModelUnavailableError ` +
        `with structured status for this empty dir. A stub that interpolates the product's ` +
        `sentence is not an instance of the bundle's own class (R19-01). ` +
        `instanceof=${thrown instanceof BundleError} ` +
        `name=${JSON.stringify(thrown?.name)} ` +
        `statusDir=${JSON.stringify(thrown?.status?.dir)} ` +
        `missingCount=${Array.isArray(thrown?.status?.missing) ? thrown.status.missing.length : 'n/a'} ` +
        `wantDir=${emptyModel} wantMissing=${REQUIRED_POCKET_FILES.length} ` +
        `message=${JSON.stringify(String(thrown?.message ?? thrown))}`,
      )
    }

    const preferOut = join(runDir, 'prefer.json')
    const preferProbe = runArtifactChild([
      '--arm', 'prefer',
      '--model-dir', emptyModel,
      '--out', preferOut,
      '--wav-dir', runDir
    ])
    const prefer = await readChildResult(preferProbe, preferOut, 'prefer')
    if (prefer.error) {
      throw new Error(
        `${OUT}/main.mjs production wiring did not become ready on the OS floor ` +
        `(empty model, no force-os-down): ${prefer.error}`
      )
    }
    const named = typeof prefer.substitution === 'string'
      && /was unavailable/.test(prefer.substitution)
      && /using /.test(prefer.substitution)
    if (prefer.displayName !== 'System voice' || prefer.rung !== 'fallback' || !named) {
      throw new Error(
        `${OUT}/main.mjs production auto did not fall back loudly when Pocket had no model. ` +
        `Want System voice at rung=fallback with "was unavailable" + "using" named; got ` +
        `displayName=${JSON.stringify(prefer.displayName)} rung=${JSON.stringify(prefer.rung)} ` +
        `substitution=${JSON.stringify(prefer.substitution)} ` +
        `engineReady=${JSON.stringify(prefer.engineReady)}.`
      )
    }
  } finally {
    await rm(runDir, { recursive: true, force: true })
  }
}
