/**
 * The author's reuse command (R17-07). Drives the CLI, not just the function, because the
 * printed `export ORCA_TTS_MODEL_DIR=...` line is the thing he types.
 *
 * Never writes into ~/.buzz. Never opens an audio device.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, rm, readFile, lstat } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'scripts/stage-pocket-model.mjs')
const made = []
const scratch = async () => {
  const d = await mkdtemp(join(tmpdir(), 'stage-pocket-'))
  made.push(d)
  return d
}
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true })
})

const REQUIRED = [
  'bundle.json', 'bos_before_voice.npy', 'tokenizer.model',
  'flow_lm_main_int8.onnx', 'flow_lm_flow_int8.onnx', 'mimi_decoder_int8.onnx',
  'mimi_encoder.onnx', 'text_conditioner.onnx',
  'anna.wav', 'vera.wav', 'fantine.wav', 'charles.wav', 'paul.wav', 'eponine.wav',
  'azelma.wav', 'george.wav', 'reference_sample.wav', 'jane.wav', 'michael.wav', 'eve.wav',
  'LICENSE', 'MODEL_LICENSE.txt',
]

async function weightsComplete (dir) {
  for (const f of REQUIRED) await writeFile(join(dir, f), `payload-${f}`)
  await writeFile(join(dir, '.buzz-model-manifest'), 'buzz')
}

function run (args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8', cwd: ROOT,
  })
}

describe('scripts/stage-pocket-model.mjs', () => {
  it('stages a buzz-shaped cache into a dest we own and prints the ORCA_TTS_MODEL_DIR line', async () => {
    const from = await scratch()
    const dest = await scratch()
    await weightsComplete(from)
    const r = run(['--from', from, '--dest', dest])
    expect(r.status, r.stderr || r.stdout).toBe(0)
    expect(r.stdout).toMatch(/modelStatus: Pocket TTS is ready/)
    expect(r.stdout).toContain(`export ORCA_TTS_MODEL_DIR=${JSON.stringify(dest)}`)
    expect(existsSync(join(from, '.orca-tts-model-manifest')), 'must not write the marker into the source').toBe(false)
    expect(await readFile(join(dest, '.orca-tts-model-manifest'), 'utf8')).toMatch(/^2\n?$/)
    expect((await lstat(join(dest, 'eve.wav'))).isSymbolicLink()).toBe(true)
  })

  it('REFUSES --dest under ~/.buzz and creates nothing there', () => {
    const dest = join(homedir(), '.buzz', `orca-tts-r17-07-must-not-exist-${Date.now()}`)
    expect(existsSync(dest)).toBe(false)
    const r = run(['--from', '/tmp/does-not-matter', '--dest', dest])
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/refusing to write/)
    expect(existsSync(dest)).toBe(false)
  })

  it('CONTROL: a missing --from does not write the dest', async () => {
    const dest = await scratch()
    const r = run(['--from', join(dest, 'missing-source'), '--dest', dest])
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/no Pocket TTS files/)
    expect(readdirSync(dest)).toEqual([])
  })
})
