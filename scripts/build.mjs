#!/usr/bin/env node
// Bundles the plugin worker to a single ESM file.
// ORCA never runs a build at install time (git clone + copy only), so the committed
// artifact must be runnable as-is with no node_modules.
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

mkdirSync('packages/plugin/dist', { recursive: true })

await build({
  entryPoints: ['packages/plugin/src/main.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outfile: 'packages/plugin/dist/main.mjs',
  // Node builtins stay external; everything else is inlined.
  external: ['node:*'],
  legalComments: 'inline'
})

console.log('build: packages/plugin/dist/main.mjs')
