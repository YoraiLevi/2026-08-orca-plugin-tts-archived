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
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUT = 'dist/plugin'

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

await build({
  entryPoints: ['packages/plugin/src/main.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outfile: `${OUT}/main.mjs`,
  external: ['node:*'],
  legalComments: 'inline'
})

await build({
  entryPoints: ['scripts/orca-tts.mjs'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outfile: `${OUT}/orca-tts.mjs`,
  external: ['node:*'],
  legalComments: 'inline'
})

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
