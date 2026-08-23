#!/usr/bin/env node
/**
 * Reuse Pocket TTS weights that already exist on disk (typically buzz's cache) without
 * downloading 173.8 MB again, and without writing into that other application's directory.
 *
 * R17-07 option A: the product does NOT look in `~/.buzz` on its own. This command is the
 * explicit opt-in. It reads the source (default `~/.buzz/models/pocket-tts`), stages a
 * symlink copy into a directory WE own, writes `.orca-tts-model-manifest` there, and prints
 * the `ORCA_TTS_MODEL_DIR` line to use.
 *
 * Never writes into `~/.buzz`. Never opens an audio device.
 *
 * Usage:
 *   node scripts/stage-pocket-model.mjs
 *   node scripts/stage-pocket-model.mjs --from ~/.buzz/models/pocket-tts --dest /tmp/orca-tts-pocket
 */

import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function arg (name) {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

function flag (name) {
  return process.argv.includes(name)
}

const { modelDir, stageModelFrom, isForeignModelCache, modelStatus, modelStatusDetail } =
  await import(pathToFileURL(join(ROOT, 'packages/providers/src/pocket-synth/models.ts')).href)

const from = arg('--from') ?? join(homedir(), '.buzz', 'models', 'pocket-tts')
const dest = arg('--dest') ?? modelDir()

if (flag('--help') || flag('-h')) {
  console.log(`stage-pocket-model — symlink a Pocket TTS cache into a directory we own.

  --from <dir>   source (default: ~/.buzz/models/pocket-tts). READ-ONLY.
  --dest <dir>   destination (default: the product cache, or ORCA_TTS_MODEL_DIR).

Refuses to write into ~/.buzz. After a successful run, modelStatus(dest) is ready.

  node scripts/stage-pocket-model.mjs
  export ORCA_TTS_MODEL_DIR=<printed dest>   # only needed when --dest is not the default
  pnpm voice-lab
`)
  process.exit(0)
}

if (isForeignModelCache(dest)) {
  console.error(`refusing to write into ${dest} — that directory belongs to another application (buzz).`)
  console.error('Pick a destination we own with --dest, or omit --dest to use the product cache.')
  process.exit(1)
}

try {
  const result = await stageModelFrom(from, dest)
  const status = await modelStatus(result.dest)
  console.log(`Staged ${result.files} files from`)
  console.log(`  ${result.source}`)
  console.log('into')
  console.log(`  ${result.dest}`)
  console.log('(read-only source; .orca-tts-model-manifest written only in the destination)')
  console.log('')
  console.log(`modelStatus: ${modelStatusDetail(status)}`)
  console.log('')
  console.log('To use this directory:')
  console.log(`  export ORCA_TTS_MODEL_DIR=${JSON.stringify(result.dest)}`)
  console.log('')
  if (result.dest === modelDir() && !process.env.ORCA_TTS_MODEL_DIR) {
    console.log('That export is optional here: this IS the product default, so')
    console.log('`pnpm voice-lab` and the plugin will find it without the env var.')
  } else {
    console.log('Then: pnpm voice-lab')
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
