#!/usr/bin/env node
/**
 * The scripted dev loop.
 *
 * Editing worker code does NOT hot-reload: ORCA compares a spawn spec built from the MANIFEST, not
 * from the worker's bytes, so the watcher fires, refresh runs, and the old code keeps executing
 * (PITFALLS P6, measured E5). And a manifest that declares `keybindings` folds a hash of EVERY file
 * in the plugin directory into the consent fingerprint, so any edit flips the plugin to
 * `needsReconsent` (measured E7) — bumping `version` alone does not help.
 *
 * So the loop is: build -> read the LIVE fingerprint -> consent with it -> toggle to force a
 * re-fork. All four steps are required. Skipping any one of them silently runs stale code.
 *
 * Usage: node scripts/dev.mjs [--print-only]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PLUGIN_DIR = resolve('dist/plugin')   // the ARTIFACT, never the source folder
const manifest = JSON.parse(readFileSync(resolve('packages/plugin/orca-plugin.json'), 'utf8'))
const PLUGIN_KEY = `${manifest.publisher}.${manifest.id}`

const steps = [
  ['1. Build the bundle', 'node scripts/build.mjs'],
  ['2. Register this folder once', `Settings -> Plugins -> Development -> add:\n     ${PLUGIN_DIR}`],
  ['3. Re-consent with the LIVE fingerprint', `await window.api.plugins.list()
       .then(l => l.find(e => e.pluginKey === '${PLUGIN_KEY}').consentFingerprint)
       .then(fp => window.api.plugins.consent({
         pluginKey: '${PLUGIN_KEY}', reviewedFingerprint: fp, decision: 'approve' }))`],
  ['4. Force the worker to re-fork', `await window.api.plugins.setEnabled({ pluginKey: '${PLUGIN_KEY}', enabled: false })
     await window.api.plugins.setEnabled({ pluginKey: '${PLUGIN_KEY}', enabled: true })`],
  ['5. Read the logs', 'Plugin logs are a 200-line IN-MEMORY ring buffer. There is no log file on\n     disk (measured, E5) — read them from the plugin panel or the devtools console.']
]

console.log(`\nRead Aloud dev loop — plugin key: ${PLUGIN_KEY}\n`)
try {
  execFileSync('node', ['scripts/build.mjs'], { stdio: 'inherit' })
} catch {
  console.error('build failed; not continuing')
  process.exit(1)
}
for (const [title, body] of steps.slice(1)) console.log(`  ${title}\n     ${body}\n`)
console.log('  Verify by effect: change a string in main.ts, run this, and hear the NEW string.')
console.log('  Hearing the old string means the re-fork did not happen.\n')
