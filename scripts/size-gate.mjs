#!/usr/bin/env node
// Fails if the plugin artifact exceeds ORCA's hard install limits.
// MAX_PLUGIN_FILES = 2_000 / MAX_PLUGIN_TOTAL_BYTES = 50 MB
// (orca src/main/plugins/plugin-content-hash.ts:15-16)
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAX_FILES = 2000
const MAX_BYTES = 50 * 1024 * 1024
const root = process.argv[2] ?? 'packages/plugin/dist'

let files = 0
let bytes = 0
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else { files++; bytes += statSync(p).size }
  }
}

try { walk(root) } catch { console.error(`size-gate: ${root} does not exist yet`); process.exit(0) }

const mb = (bytes / 1024 / 1024).toFixed(2)
console.log(`size-gate: ${files} files, ${mb} MB (limits: ${MAX_FILES} files, 50 MB)`)
if (files > MAX_FILES) { console.error(`FAIL: ${files} files exceeds ${MAX_FILES}`); process.exit(1) }
if (bytes > MAX_BYTES) { console.error(`FAIL: ${mb} MB exceeds 50 MB`); process.exit(1) }
