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
import { cp, mkdir, rm } from 'node:fs/promises'

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
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'inline'
})

await cp('packages/plugin/orca-plugin.json', `${OUT}/orca-plugin.json`)
await cp('packages/plugin/panel.html', `${OUT}/panel.html`)

console.log(`build: ${OUT}/ (orca-plugin.json, main.mjs, panel.html, orca-tts.mjs)`)
