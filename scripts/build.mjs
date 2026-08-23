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
import { consultProvesRealPocket } from './artifact-score.mjs'

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
 * R16-10 / R17-02 / R18-01 — assert what SURVIVED by EFFECT, not by substring.
 *
 * Round 16's guard was `bundle.includes('PocketSynthProvider')`. Round 17 deleted the
 * production constructor, kept the name as `host.log('PocketSynthProvider')`, and
 * watched tests 2/2 plus `pnpm build` stay green while the class was gone. Round 17's
 * repair grepped `/pocket:/` out of a log. Round 18 handed `activate()` a stub with
 * `id: 'pocket'` whose `prepare()` throws `'pocket: mutant stub'`, stopped the factory
 * default-constructing the real class, and got: `pnpm build` EXIT 0, class gone,
 * `PocketTts` gone. A log substring is not an effect. A stub can fake one.
 *
 * Reuse `scripts/artifact-e2e.mjs` rather than a third instrument. Its `--child`
 * path already imports `dist/plugin/main.mjs`, constructs the production providers,
 * and drives `prepare()`. We interpret the JSON; we do not duplicate the driver.
 *
 * Two arms, because one mutant each:
 *   consult  — OS floor forced down, isolated empty model dir (R061). Demand the
 *              real `PocketModelUnavailableError`: it names THIS empty directory
 *              and enumerates `mimi_encoder.onnx`. Round 18's stub cannot produce
 *              either — it never called `modelStatus()`. 24 kHz is the stronger
 *              discriminator but needs weights CI does not have; against an empty
 *              dir it would mean the provider ignored `ORCA_TTS_MODEL_DIR`. The
 *              PRESENT arm of `probe:artifact` is the 24 kHz gate.
 *   prefer   — production wiring, empty model. Default `synthesize.engine` is
 *              `auto`, which asks Pocket first. With no weights that MUST land
 *              on the OS floor at rung=fallback AND name the substitution.
 *              Calling `resolve()` with no id again makes OS preferred and
 *              silent — this arm goes red. Factory preference (R17-06) is
 *              asserted in `createProviderRegistry` tests; this arm is the
 *              production-path ABSENT half of `probe:artifact`.
 */
const bundle = await readFile(`${OUT}/main.mjs`, 'utf8')
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
    const consultOut = join(runDir, 'consult.json')
    const consultProbe = runArtifactChild([
      '--arm', 'consult',
      '--model-dir', emptyModel,
      '--out', consultOut,
      '--wav-dir', runDir,
      '--force-os-down'
    ])
    const consult = await readChildResult(consultProbe, consultOut, 'consult')
    // R18-01: `/pocket:/` in a log is the R17-02 log-string with a colon. A stub
    // with `id: 'pocket'` whose `prepare()` throws `'pocket: mutant stub'` satisfies
    // it. Demand the real class's `PocketModelUnavailableError` instead — it names
    // THIS empty directory and enumerates a Pocket-only weight a stub never lists.
    if (!consultProvesRealPocket(consult, emptyModel)) {
      throw new Error(
        `${OUT}/main.mjs consult arm did not run the bundled PocketSynthProvider.prepare(). ` +
        `A stub with id:'pocket' whose throw contains "pocket:" is not the real class (R18-01). ` +
        `Want PocketModelUnavailableError naming this empty dir (${emptyModel}) and ` +
        `enumerating mimi_encoder.onnx. ` +
        `error=${JSON.stringify(consult.error)} logs=${JSON.stringify(consult.logs)}`
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
