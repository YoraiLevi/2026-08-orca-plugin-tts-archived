import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SpeechStatus } from '../speech-service.ts'

export const DASHBOARD_FILE = 'dashboard.json'
const COMMAND_MAX_BYTES = 4_096
const COMMAND_MAX_AGE_MS = 5_000

export interface DashboardEngine {
  readonly state: 'starting' | 'ready' | 'failed'
  readonly name: string
  readonly rung: string | number | null
  readonly reason: string | null
}

export interface DashboardStatus extends SpeechStatus {
  readonly version: 1
  readonly updatedAtEpochMs: number
  readonly engine: DashboardEngine
}

export interface DashboardDocument {
  readonly status: DashboardStatus
  readonly control: {
    readonly endpoint: string
    readonly pid: number
  }
}

export type ControlVerb = 'stop'

export interface ControlEnvelope {
  readonly v: 1
  readonly id: string
  readonly verb: ControlVerb
  readonly gen: number
  readonly at: number
}

export type ControlResponse =
  | { readonly ok: true; readonly code: 'stopped' | 'duplicate' }
  | {
    readonly ok: false
    readonly code: 'expired' | 'stale_generation' | 'unknown_verb' | 'invalid_envelope' | 'action_failed'
    readonly message: string
  }

type ControlFailure = Extract<ControlResponse, { readonly ok: false }>

export interface DashboardHandlers {
  readonly stop: () => Promise<void>
  /** A received control that cannot act must reach the listener's audio channel. */
  readonly announceRefusal: (message: string) => void
}

const EMPTY_SPEECH_STATUS: SpeechStatus = {
  generation: 0,
  nowReading: null,
  queueDepth: 0,
  queue: []
}

/**
 * The same native per-user location on the worker and CLI sides.
 * Tests always inject a temp directory and never touch this path.
 */
export function defaultControlDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  if (env['ORCA_TTS_CONTROL_DIR']) return env['ORCA_TTS_CONTROL_DIR']
  if (platform === 'win32') {
    return join(env['LOCALAPPDATA'] ?? env['APPDATA'] ?? homedir(), 'orca-tts', 'control')
  }
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'orca-tts', 'control')
  return join(env['XDG_STATE_HOME'] ?? join(homedir(), '.local', 'state'), 'orca-tts', 'control')
}

const endpointFor = (dir: string): string => process.platform === 'win32'
  ? `\\\\.\\pipe\\orca-tts-${process.pid}`
  : join(dir, `control-${process.pid}.sock`)

const responseLine = (socket: Socket, response: ControlResponse): void => {
  socket.end(`${JSON.stringify(response)}\n`)
}

const parseEnvelope = (line: string): ControlEnvelope | ControlFailure => {
  let value: unknown
  try { value = JSON.parse(line) }
  catch {
    return { ok: false, code: 'invalid_envelope', message: 'That control message was not valid JSON.' }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, code: 'invalid_envelope', message: 'That control message was not an object.' }
  }
  const record = value as Record<string, unknown>
  if (record['v'] !== 1 || typeof record['id'] !== 'string' || record['id'].length === 0 ||
      typeof record['verb'] !== 'string' || typeof record['gen'] !== 'number' ||
      !Number.isSafeInteger(record['gen']) || typeof record['at'] !== 'number' ||
      !Number.isFinite(record['at'])) {
    return { ok: false, code: 'invalid_envelope', message: 'That control message was missing a required field.' }
  }
  if (record['verb'] !== 'stop') {
    return { ok: false, code: 'unknown_verb', message: `The ${record['verb']} control has no plugin consumer.` }
  }
  return { v: 1, id: record['id'], verb: 'stop', gen: record['gen'], at: record['at'] }
}

/**
 * Worker-side state publisher and pushed control consumer.
 *
 * State crosses by atomic file replacement because the foreground TUI owns its screen and can
 * watch that file without spending ORCA's panel budget. Stop crosses a socket in the opposite
 * direction and is never polled.
 */
export class DashboardRuntime {
  readonly #dir: string
  readonly #path: string
  readonly #endpoint: string
  readonly #handlers: DashboardHandlers
  readonly #log: (message: string) => void
  readonly #seen: string[] = []
  #server: Server | null = null
  #writeSerial: Promise<void> = Promise.resolve()
  #speech: SpeechStatus = EMPTY_SPEECH_STATUS
  #engine: DashboardEngine = { state: 'starting', name: 'starting', rung: null, reason: null }

  constructor(dir: string, handlers: DashboardHandlers, log: (message: string) => void = () => {}) {
    this.#dir = dir
    this.#path = join(dir, DASHBOARD_FILE)
    this.#endpoint = endpointFor(dir)
    this.#handlers = handlers
    this.#log = log
  }

  get path(): string { return this.#path }

  async start(): Promise<void> {
    await mkdir(this.#dir, { recursive: true, mode: 0o700 })
    await new Promise<void>((resolve, reject) => {
      const server = createServer((socket) => { this.#accept(socket) })
      this.#server = server
      server.once('error', reject)
      server.listen(this.#endpoint, () => {
        server.off('error', reject)
        server.on('error', (err) => { this.#log(`dashboard control server failed: ${String(err)}`) })
        server.unref()
        resolve()
      })
    })
    await this.#publish()
    this.#log(`read-aloud: dashboard listening at ${this.#endpoint}`)
  }

  updateSpeech(status: SpeechStatus): void {
    this.#speech = status
    void this.#publish()
  }

  updateEngine(engine: DashboardEngine): void {
    this.#engine = engine
    void this.#publish()
  }

  async close(): Promise<void> {
    const server = this.#server
    this.#server = null
    if (server === null) return
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }

  #document(): DashboardDocument {
    return {
      status: {
        version: 1,
        updatedAtEpochMs: Date.now(),
        engine: this.#engine,
        ...this.#speech
      },
      control: { endpoint: this.#endpoint, pid: process.pid }
    }
  }

  async #publish(): Promise<void> {
    const document = this.#document()
    const json = `${JSON.stringify(document, null, 2)}\n`
    this.#writeSerial = this.#writeSerial.then(async () => {
      const temp = `${this.#path}.${process.pid}.tmp`
      await writeFile(temp, json, { encoding: 'utf8', mode: 0o600 })
      await rename(temp, this.#path)
    }).catch((err: unknown) => {
      this.#log(`could not publish dashboard status: ${String(err)}`)
    })
    await this.#writeSerial
  }

  #accept(socket: Socket): void {
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', (part: string) => {
      buffer += part
      if (Buffer.byteLength(buffer, 'utf8') > COMMAND_MAX_BYTES) {
        const response: ControlResponse = {
          ok: false, code: 'invalid_envelope', message: 'That control message was too large.'
        }
        this.#handlers.announceRefusal(response.message)
        responseLine(socket, response)
        return
      }
      const newline = buffer.indexOf('\n')
      if (newline === -1) return
      const line = buffer.slice(0, newline)
      buffer = ''
      void this.#dispatch(line, socket)
    })
    socket.on('error', (err) => { this.#log(`dashboard control connection failed: ${String(err)}`) })
  }

  async #dispatch(line: string, socket: Socket): Promise<void> {
    const parsed = parseEnvelope(line)
    if ('ok' in parsed) {
      this.#handlers.announceRefusal(parsed.message)
      responseLine(socket, parsed)
      return
    }
    if (this.#seen.includes(parsed.id)) {
      responseLine(socket, { ok: true, code: 'duplicate' })
      return
    }
    this.#seen.push(parsed.id)
    if (this.#seen.length > 64) this.#seen.shift()

    if (Date.now() - parsed.at > COMMAND_MAX_AGE_MS) {
      const response: ControlResponse = {
        ok: false, code: 'expired', message: 'That Stop control arrived too late and was not applied.'
      }
      this.#handlers.announceRefusal(response.message)
      responseLine(socket, response)
      return
    }
    const currentGeneration = this.#speech.nowReading?.gen ?? this.#speech.generation
    if (parsed.gen < currentGeneration) {
      const response: ControlResponse = {
        ok: false,
        code: 'stale_generation',
        message: 'That Stop control belonged to an earlier reply and was not applied.'
      }
      this.#handlers.announceRefusal(response.message)
      responseLine(socket, response)
      return
    }
    try {
      await this.#handlers.stop()
      responseLine(socket, { ok: true, code: 'stopped' })
    } catch (err) {
      const response: ControlResponse = {
        ok: false, code: 'action_failed', message: `Stop did not reach speech: ${String(err)}`
      }
      this.#handlers.announceRefusal(response.message)
      responseLine(socket, response)
    }
  }
}

export async function readDashboardDocument(dir = defaultControlDir()): Promise<DashboardDocument> {
  const value = JSON.parse(await readFile(join(dir, DASHBOARD_FILE), 'utf8')) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('dashboard state is not an object')
  }
  const document = value as Partial<DashboardDocument>
  if (document.status?.version !== 1 || typeof document.control?.endpoint !== 'string') {
    throw new Error('dashboard state has an unsupported shape')
  }
  return document as DashboardDocument
}

/** Plain, stable text is both a TUI and a screen-reader-friendly test oracle. */
export function renderDashboard(status: DashboardStatus): string {
  const lines = [
    `Read Aloud  engine: ${status.engine.name}`,
    '',
    status.nowReading === null
      ? 'NOW READING  nothing'
      : `NOW READING  ${status.nowReading.sessionLabel}`,
    status.nowReading?.spokenText ?? '',
    status.nowReading === null ? '' : 'CURSOR  unavailable on this engine',
    '',
    '[ S ]  STOP',
    '',
    `QUEUE  ${status.queueDepth} waiting`
  ]
  if (status.queue.length === 0) lines.push('  (empty)')
  else status.queue.forEach((item, index) => {
    lines.push(`  ${index + 1}. ${item.sessionLabel}  "${item.textPreview}"`)
  })
  lines.push('', 'control: connected')
  return lines.join('\n')
}

let nextCommand = 0

/** Send one pushed command and wait for the worker's named result. */
export async function sendControl(
  document: DashboardDocument,
  verb: ControlVerb,
  timeoutMs = 400
): Promise<ControlResponse> {
  const envelope: ControlEnvelope = {
    v: 1,
    id: `c-${process.pid}-${++nextCommand}-${Date.now()}`,
    verb,
    gen: document.status.nowReading?.gen ?? document.status.generation,
    at: Date.now()
  }
  return await new Promise<ControlResponse>((resolve, reject) => {
    const socket = createConnection(document.control.endpoint)
    let buffer = ''
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('control_unavailable: the plugin did not answer Stop'))
    }, timeoutMs)
    timer.unref?.()
    socket.setEncoding('utf8')
    socket.once('connect', () => { socket.write(`${JSON.stringify(envelope)}\n`) })
    socket.on('data', (part: string) => {
      buffer += part
      const newline = buffer.indexOf('\n')
      if (newline === -1) return
      clearTimeout(timer)
      socket.end()
      resolve(JSON.parse(buffer.slice(0, newline)) as ControlResponse)
    })
    socket.once('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`control_unavailable: Stop could not reach the plugin (${String(err)})`))
    })
  })
}

/** Ensures callers can create a sibling report file without re-deriving this module's path. */
export function dashboardPath(dir = defaultControlDir()): string {
  return join(dir, DASHBOARD_FILE)
}
