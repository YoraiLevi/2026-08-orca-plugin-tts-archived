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
 * This file RECORDS. It never judges: the verdict lives in `auditSaySpawns()` /
 * `p31Rows()` in artifact-e2e.mjs, so the thing being proven and the thing doing the
 * proving are not the same function.
 *
 * R19-05: `exec`/`execSync` take a command STRING. Recording `{ cmd: 'say hello', args: [] }`
 * made the judge drop the spawn (`spawnBase('say hello') !== 'say'`). Parse the string.
 * A grandchild `node` that then `spawn('say')` was invisible because `--import` does not
 * cross `spawn(node)`. We prepend `--import` on node spawns (depth-capped). We do NOT
 * set NODE_OPTIONS — that fork-bombs, because every new node re-loads this file and
 * wraps spawn, including node's own loader spawns.
 * An `--import` module that loads and patches nothing must not be able to report green
 * — we write a `loaded` marker the judge requires.
 */
import { createRequire } from 'node:module'
import { appendFileSync } from 'node:fs'
import { spawnBase, unwrapSpawn } from './spawn-argv.mjs'

const require = createRequire(import.meta.url)
const cp = require('node:child_process')

const LOG = process.env.VOICE_LAB_SPAWN_LOG
if (typeof LOG !== 'string' || LOG.length === 0) {
  throw new Error('no-audio-recorder: VOICE_LAB_SPAWN_LOG is not set. Refusing to run blind — a ' +
    'recorder with nowhere to record is a guard that can never go red.')
}

const SELF = import.meta.url
const NODE_BASES = new Set(['node', 'nodejs'])
const DEPTH = Number(process.env.ORCA_TTS_RECORDER_DEPTH ?? '0')

function record (api, cmd, args) {
  const argv = Array.isArray(args) ? args.map(String) : []
  const decoded = unwrapSpawn(cmd, argv)
  appendFileSync(
    LOG,
    JSON.stringify({
      api,
      cmd: decoded.cmd,
      args: decoded.args,
      rawCmd: String(cmd),
      rawArgs: argv,
      pid: process.pid,
    }) + '\n',
  )
}

function injectNodeImport (cmd, argv, options) {
  if (!NODE_BASES.has(spawnBase(cmd))) return { argv, options }
  if (DEPTH >= 2) return { argv, options }
  if (argv.some((a) => String(a).includes('no-audio-recorder'))) return { argv, options }
  const env = {
    ...(options?.env ?? process.env),
    ORCA_TTS_RECORDER_DEPTH: String(DEPTH + 1),
    VOICE_LAB_SPAWN_LOG: LOG,
  }
  return {
    argv: ['--import', SELF, ...argv],
    options: { ...options, env },
  }
}

let patched = false
if (!patched) {
  patched = true
  for (const api of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
    const original = cp[api]
    if (typeof original !== 'function') continue
    cp[api] = function (cmd, args, ...rest) {
      const argv = Array.isArray(args) ? args.map(String) : []
      const options = Array.isArray(args) ? rest[0] : args
      record(api, cmd, argv)
      const injected = injectNodeImport(cmd, argv, options && typeof options === 'object' ? options : undefined)
      if (Array.isArray(args)) {
        const tail = rest.slice(1)
        return injected.options === undefined
          ? original.call(this, cmd, injected.argv, ...rest)
          : original.call(this, cmd, injected.argv, injected.options, ...tail)
      }
      return original.call(this, cmd, args, ...rest)
    }
  }
  for (const api of ['fork']) {
    const original = cp[api]
    if (typeof original !== 'function') continue
    cp[api] = function (modulePath, args, ...rest) {
      record(api, process.execPath, [String(modulePath), ...(Array.isArray(args) ? args : [])])
      return original.call(this, modulePath, args, ...rest)
    }
  }
  for (const api of ['exec', 'execSync']) {
    const original = cp[api]
    if (typeof original !== 'function') continue
    cp[api] = function (command, ...rest) {
      record(api, command, [])
      return original.call(this, command, ...rest)
    }
  }

  appendFileSync(
    LOG,
    JSON.stringify({ api: 'recorder', cmd: 'loaded', args: [], pid: process.pid }) + '\n',
  )
}
