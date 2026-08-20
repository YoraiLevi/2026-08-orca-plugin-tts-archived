/**
 * ORCA plugin entry point.
 *
 * `activate(orca)` receives the host API object directly — verified against
 * examples/plugins/hello-orca/main.mjs, not guessed.
 *
 * Bundled by esbuild into the self-contained artifact at dist/plugin/, because ORCA never runs a
 * build at install time and rejects any file escaping the plugin root (PITFALLS P17).
 */
import { OsSynthProvider, ProviderRegistry } from '@orca-tts/providers';
import { asAgentStatus, makeHost, worktreePathFrom } from './adapter/index.js';
import { readClipboard, ClipboardUnavailableError } from './clipboard.js';
import { SpeechService } from './speech-service.js';
import { SubprocessSink } from './sinks/subprocess-sink.js';
import { HuddleController } from './huddle/index.js';
export default function activate(orca) {
    const host = makeHost(orca);
    host.log('read-aloud: activating');
    const registry = new ProviderRegistry();
    registry.register(new OsSynthProvider(), { preferred: true });
    const sink = new SubprocessSink({ log: host.log });
    let speech = null;
    let engineError = null;
    // Resolve the engine in the background: activate() must return promptly so command registration
    // is never delayed behind a process spawn.
    void registry.resolve().then((resolved) => {
        if (resolved === null) {
            engineError = 'no speech engine is available on this system';
            host.log(`read-aloud: ${engineError}`);
            return;
        }
        speech = new SpeechService({ provider: resolved.provider, sink, log: host.log });
        host.log(`read-aloud: engine ready (${resolved.provider.displayName}, rung=${resolved.status.rung})`);
        // R015: degrade loudly. Never let a worse engine pass unmentioned.
        if (resolved.status.reason !== undefined)
            host.notify('Read Aloud', resolved.status.reason);
    }).catch((err) => {
        engineError = String(err);
        host.log(`read-aloud: engine resolution failed: ${engineError}`);
    });
    /** Principle I: never fail silently. Every path either speaks or says why it did not. */
    const withSpeech = async (fn) => {
        if (speech === null) {
            host.notify('Read Aloud', engineError ?? 'still starting up, try again in a moment');
            return;
        }
        await fn(speech);
    };
    host.registerCommand('read-aloud.speak-clipboard', async () => {
        await withSpeech(async (s) => {
            if (s.isSpeaking) {
                await s.stop();
                return;
            } // second press stops (single-flight)
            try {
                const { text, truncated } = await readClipboard();
                if (text.trim().length === 0) {
                    host.notify('Read Aloud', 'the clipboard is empty');
                    return;
                }
                if (truncated)
                    host.notify('Read Aloud', 'clipboard was long; reading the first part');
                s.speak(text);
            }
            catch (err) {
                host.notify('Read Aloud', err instanceof ClipboardUnavailableError
                    ? err.message
                    : 'could not read the clipboard');
            }
        });
    });
    host.registerCommand('read-aloud.stop', async () => {
        await withSpeech(async (s) => { await s.stop(); });
    });
    const huddle = new HuddleController({
        speech: {
            speak: (t) => { speech?.speak(t); },
            stop: async () => { await speech?.stop(); }
        },
        log: host.log,
        notify: (m) => { host.notify('Read Aloud', m); },
        store: { get: host.storageGet, set: host.storageSet }
    });
    // Survive the idle worker reap: without this, huddle mode silently turns itself off.
    void huddle.restore().then((on) => {
        host.log(`read-aloud: huddle mode restored to ${on ? 'on' : 'off'}`);
    });
    host.registerCommand('read-aloud.toggle-huddle', () => {
        const on = huddle.toggle();
        host.notify('Read Aloud', `Huddle mode ${on ? 'ON' : 'OFF'}`);
        // Say it out loud. This is a text-to-speech plugin talking to a voice-first user: speech is
        // the one status channel that always works. The panel cannot be updated (no host->panel
        // channel, orca#15638) and a desktop notification is transient and easy to miss.
        if (speech !== null)
            speech.speak(on ? 'Huddle mode on.' : 'Huddle mode off.');
    });
    host.registerCommand('read-aloud.status', async () => {
        await withSpeech((s) => {
            s.speak(huddle.enabled
                ? 'Read Aloud is on. Huddle mode is on, so agent replies are spoken as they arrive.'
                : 'Read Aloud is on. Huddle mode is off.');
        });
    });
    host.registerCommand('read-aloud.speak-last-reply', async () => {
        await withSpeech(async (s) => {
            const text = await huddle.lastReply();
            if (text === null) {
                host.notify('Read Aloud', 'no agent reply to read yet');
                return;
            }
            s.speak(text);
        });
    });
    host.onEvent('agent.status.changed', (payload) => {
        const status = asAgentStatus(payload);
        if (status === null)
            return;
        huddle.onAgentStatus(status, worktreePathFrom(status.worktreeId));
    });
    // Verify by effect: if the host API shape changed under us, every registration silently no-ops
    // and the only symptom is "Could not run the plugin command" (PITFALLS P18). Say so loudly.
    const n = host.registeredCommands();
    if (n < 4)
        host.log(`read-aloud: WARNING only ${n}/4 commands registered — host API mismatch?`);
    host.log(`read-aloud: ready (${n} commands)`);
}
