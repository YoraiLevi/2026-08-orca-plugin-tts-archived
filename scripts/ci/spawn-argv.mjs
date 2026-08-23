/**
 * Argv decoding shared by the recorder (syscall boundary) and the P31 judge.
 *
 * Isolated so `no-audio-recorder.mjs` can import it without importing
 * `artifact-e2e.mjs` (that file has a main) and without the recorder growing
 * a second, drifting copy of the parser.
 *
 * `exec`/`execSync` take one command STRING. Recording that string as `cmd`
 * with `args: []` made `spawnBase(cmd) === 'say'` fail for `exec('say hello')`
 * — R19-05. `sh -c 'say …'` is the same encoding wearing a shell.
 */

export function spawnBase (cmd) {
  return String(cmd).replaceAll('\\', '/').split('/').pop().toLowerCase().replace(/\.exe$/, '')
}

export function tokenize (s) {
  const out = []
  let cur = ''
  let quote = null
  for (const ch of String(s)) {
    if (quote !== null) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === "'" || ch === '"') {
      quote = ch
    } else if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (cur.length > 0) {
        out.push(cur)
        cur = ''
      }
    } else {
      cur += ch
    }
  }
  if (cur.length > 0) out.push(cur)
  return out
}

const SHELLS = new Set(['sh', 'bash', 'dash', 'zsh'])

/**
 * Decode an `exec` command string into `{ cmd, args }`, unwrapping a leading
 * `sh -c '…'` (and bash/dash/zsh) so the program that would actually run is
 * what the judge sees.
 *
 * @param {string} command
 * @returns {{ cmd: string, args: string[] }}
 */
export function parseExecArgv (command) {
  let tokens = tokenize(command)
  for (let i = 0; i < 4; i++) {
    if (tokens.length < 3) break
    if (!SHELLS.has(spawnBase(tokens[0]))) break
    if (tokens[1] !== '-c' && tokens[1] !== '-lc') break
    tokens = tokenize(tokens[2])
  }
  return { cmd: tokens[0] ?? '', args: tokens.slice(1) }
}

/**
 * Normalise a recorded spawn/exec entry to `{ cmd, args }` of the program
 * that would run. Handles:
 *   spawn('say', ['hello'])
 *   exec('say hello')                — whole string in cmd, args []
 *   spawn('sh', ['-c', 'say hello'])
 */
export function unwrapSpawn (cmd, args) {
  const argv = Array.isArray(args) ? args.map(String) : []
  if (argv.length === 0 && /\s/.test(String(cmd))) {
    return parseExecArgv(cmd)
  }
  const base = spawnBase(cmd)
  if (SHELLS.has(base)) {
    const cIdx = argv.indexOf('-c')
    if (cIdx >= 0 && argv[cIdx + 1] !== undefined) {
      return parseExecArgv(argv[cIdx + 1])
    }
  }
  return { cmd: String(cmd), args: argv }
}
