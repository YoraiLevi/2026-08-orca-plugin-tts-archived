/**
 * The no-audio recorder — Job J15 / spec FR-006, FR-106; PITFALLS **P31**.
 *
 * Preloaded with `node --import ./scripts/ci/no-audio-recorder.mjs <script>`, so it patches
 * `node:child_process` BEFORE any application module has imported it. Every spawn attempt the
 * process makes is appended, synchronously, as one NDJSON line to `$VOICE_LAB_SPAWN_LOG`.
 *
 * WHY A WRAPPER AND NOT A LOG THE SERVER WRITES ITSELF. A grep over the server's own output
 * proves only that the server agrees with itself — the exact failure P33 is about. This records
 * at the syscall boundary, in code the process under test does not own and cannot route around,
 * and it records at CALL time rather than on successful exec, so an attempt to spawn a player
 * that is not installed is still recorded. That is what makes the negative control
 * (`voice-lab-ci.mjs --prove-guard`) deterministic on a runner with no audio stack at all.
 *
 * This file RECORDS. It never judges: the verdict lives in `auditSpawns()` in voice-lab-ci.mjs,
 * so the thing being proven and the thing doing the proving are not the same function.
 */
import { createRequire } from 'node:module'
import { appendFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const cp = require('node:child_process')

const LOG = process.env.VOICE_LAB_SPAWN_LOG
if (typeof LOG !== 'string' || LOG.length === 0) {
  throw new Error('no-audio-recorder: VOICE_LAB_SPAWN_LOG is not set. Refusing to run blind — a ' +
    'recorder with nowhere to record is a guard that can never go red.')
}

function record (api, cmd, args) {
  const argv = Array.isArray(args) ? args.map(String) : []
  appendFileSync(LOG, JSON.stringify({ api, cmd: String(cmd), args: argv, pid: process.pid }) + '\n')
}

for (const api of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork']) {
  const original = cp[api]
  if (typeof original !== 'function') continue
  cp[api] = function (cmd, args, ...rest) {
    record(api, cmd, Array.isArray(args) ? args : [])
    return original.call(this, cmd, args, ...rest)
  }
}
// exec/execSync take one command STRING, not (cmd, args) — record it as the command with no argv.
for (const api of ['exec', 'execSync']) {
  const original = cp[api]
  if (typeof original !== 'function') continue
  cp[api] = function (command, ...rest) {
    record(api, command, [])
    return original.call(this, command, ...rest)
  }
}
