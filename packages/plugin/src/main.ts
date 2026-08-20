/**
 * ORCA plugin entry point.
 *
 * Bundled by esbuild to a single `dist/main.mjs`, because ORCA never runs a build at install time
 * (git clone + copy only) and caps a plugin at 2,000 files / 50 MB (PITFALLS P4, P5).
 */
import { OsSynthProvider, ProviderRegistry } from '@orca-tts/providers'
import { asAgentStatus, makeHost, worktreePathFrom, type OrcaActivateContext } from './adapter/index.js'
import { readClipboard, ClipboardUnavailableError } from './clipboard.js'
import { SpeechService } from './speech-service.js'
import { SubprocessSink } from './sinks/subprocess-sink.js'
import { HuddleController } from './huddle/index.js'

export default async function activate(ctx: OrcaActivateContext): Promise<void> {
  const host = makeHost(ctx)
  host.log('read-aloud: activating')

  const registry = new ProviderRegistry()
  registry.register(new OsSynthProvider(), { preferred: true })

  const resolved = await registry.resolve()
  if (resolved === null) {
    // Principle I: never fail silently. A hotkey that does nothing looks like a broken app.
    host.notify('Read Aloud: no speech engine is available on this system.')
    host.log('read-aloud: no provider resolved; commands will report rather than stay silent')
    return
  }
  if (resolved.status.reason !== undefined) host.notify(`Read Aloud: ${resolved.status.reason}`)

  const sink = new SubprocessSink({ log: host.log })
  const speech = new SpeechService({ provider: resolved.provider, sink, log: host.log })

  const speakOrExplain = async (text: string, emptyMessage: string): Promise<void> => {
    if (text.trim().length === 0) { host.notify(emptyMessage); return }
    speech.speak(text)
  }

  host.registerCommand('orca-tts.speakClipboard', async () => {
    // A second press stops, rather than overlapping (single-flight, R022).
    if (speech.isSpeaking) { await speech.stop(); return }
    try {
      const { text, truncated } = await readClipboard()
      if (truncated) host.notify('Read Aloud: clipboard was long; reading the first part.')
      await speakOrExplain(text, 'Read Aloud: the clipboard is empty.')
    } catch (err) {
      if (err instanceof ClipboardUnavailableError) host.notify(`Read Aloud: ${err.message}`)
      else host.notify('Read Aloud: could not read the clipboard.')
    }
  })

  host.registerCommand('orca-tts.stop', async () => { await speech.stop() })

  const huddle = new HuddleController({
    speech,
    log: host.log,
    notify: host.notify,
    onUnsupportedAgent: (name) => {
      host.notify(`Read Aloud: huddle mode does not support ${name} — it has no transcript format we can read.`)
    }
  })

  host.registerCommand('orca-tts.toggleHuddle', () => {
    const on = huddle.toggle()
    host.notify(`Read Aloud: huddle mode ${on ? 'on' : 'off'}`)
  })

  host.registerCommand('orca-tts.speakLastReply', async () => {
    const text = await huddle.lastReply()
    await speakOrExplain(text ?? '', 'Read Aloud: no agent reply to read yet.')
  })

  host.onEvent('agent.status.changed', (payload) => {
    const status = asAgentStatus(payload)
    if (status === null) return
    huddle.onAgentStatus(status, worktreePathFrom(status.worktreeId))
  })

  host.log('read-aloud: ready')
}
