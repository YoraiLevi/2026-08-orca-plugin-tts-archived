import { watch, type FSWatcher } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import {
  DASHBOARD_FILE, defaultControlDir, readDashboardDocument, renderDashboard, sendControl,
  type DashboardDocument
} from './dashboard.ts'

const unavailable = (reason: string): string => [
  'Read Aloud',
  '',
  'NOW READING  not connected',
  '',
  '[ S ]  STOP  unavailable',
  '',
  'QUEUE  unknown',
  '',
  `control: not connected — ${reason}`
].join('\n')

const chooseDir = (args: readonly string[]): string => {
  const at = args.indexOf('--dir')
  return at === -1 ? defaultControlDir() : args[at + 1] ?? defaultControlDir()
}

const readOrNull = async (dir: string): Promise<DashboardDocument | null> =>
  await readDashboardDocument(dir).catch(() => null)

const printFrame = (text: string): void => {
  if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[H')
  process.stdout.write(`${text}\n`)
}

/**
 * Foreground terminal surface. State arrives through atomic file transitions; controls are pushed
 * through the worker socket. There is no Stop poll loop.
 */
async function runControl(dir: string, once: boolean): Promise<number> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  let current = await readOrNull(dir)
  printFrame(current === null
    ? unavailable('the plugin worker has not published state here')
    : renderDashboard(current.status))
  if (once) return current === null ? 1 : 0

  let lastFailure = ''
  const redraw = async (): Promise<void> => {
    current = await readOrNull(dir)
    const frame = current === null
      ? unavailable('the plugin worker is not connected')
      : renderDashboard(current.status) + (lastFailure === '' ? '' : `\n${lastFailure}`)
    printFrame(frame)
  }
  const watcher: FSWatcher = watch(dir, (_event, name) => {
    if (name === DASHBOARD_FILE) void redraw()
  })

  const input = process.stdin
  input.setEncoding('utf8')
  input.setRawMode?.(true)
  input.resume()
  input.on('data', (key: string) => {
    if (key === '\u0003' || key === 'q') {
      input.setRawMode?.(false)
      input.pause()
      watcher.close()
      process.stdout.write('\n')
      return
    }
    if (key !== 's' && key !== '.') return
    void (async () => {
      const document = current ?? await readOrNull(dir)
      if (document === null) {
        lastFailure = 'STOP DID NOT REACH THE PLUGIN: no control consumer is connected.'
        // Audible terminal bell plus explicit text. Never a silent dead key.
        process.stdout.write('\x07')
        await redraw()
        return
      }
      try {
        const response = await sendControl(document, 'stop')
        lastFailure = response.ok ? '' : `STOP REFUSED (${response.code}): ${response.message}`
        if (!response.ok) process.stdout.write('\x07')
      } catch (err) {
        lastFailure = `STOP DID NOT REACH THE PLUGIN: ${String(err)}`
        process.stdout.write('\x07')
      }
      await redraw()
    })()
  })
  return await new Promise<number>((resolve) => {
    input.on('data', (key: string) => {
      if (key === '\u0003' || key === 'q') resolve(0)
    })
  })
}

export async function runCli(args = process.argv.slice(2)): Promise<number> {
  const command = args[0] ?? 'control'
  const dir = chooseDir(args)
  if (command === 'control') return await runControl(dir, args.includes('--once'))
  if (command === 'stop') {
    const document = await readOrNull(dir)
    if (document === null) {
      process.stderr.write('STOP DID NOT REACH THE PLUGIN: no control consumer is connected.\n')
      return 1
    }
    try {
      const response = await sendControl(document, 'stop')
      if (!response.ok) {
        process.stderr.write(`STOP REFUSED (${response.code}): ${response.message}\n`)
        return 1
      }
      process.stdout.write(`${response.code}\n`)
      return 0
    } catch (err) {
      process.stderr.write(`STOP DID NOT REACH THE PLUGIN: ${String(err)}\n`)
      return 1
    }
  }
  process.stderr.write('usage: orca-tts control [--dir PATH] [--once] | orca-tts stop [--dir PATH]\n')
  return 2
}
