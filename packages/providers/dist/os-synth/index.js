/**
 * OS synthesizer provider — the floor of the degradation ladder.
 *
 * Every desktop OS ships a speech synthesizer. It is slower than a neural engine
 * (macOS `say` costs ~414 ms just to spawn, measured — PITFALLS P10) and cannot stream partial
 * audio, but it needs no download, no key, no network, and it is always there. That is what makes
 * "never fail silently" (constitution principle I) true on first run and on Windows-on-ARM, where
 * no sherpa build exists (PITFALLS P7).
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/** PowerShell + Add-Type of System.Speech is slow to start; be generous but never unbounded. */
export const DEFAULT_SPAWN_TIMEOUT_MS = 60_000;
const CAPABILITIES = {
    streaming: false, // whole-utterance only; honest per T041d
    offline: true,
    needsApiKey: false,
    needsModelDownload: 0,
    licence: 'OS-provided',
    cloning: false,
    sampleRate: 22050
};
export class OsSynthUnavailableError extends Error {
    constructor(platform, tried) {
        super(`No OS speech synthesizer found on ${platform}. Tried: ${tried.join(', ')}`);
        this.name = 'OsSynthUnavailableError';
    }
}
export class OsSynthTimeoutError extends Error {
    constructor(cmd, ms) {
        super(`${cmd} did not finish within ${ms} ms and was killed`);
        this.name = 'OsSynthTimeoutError';
    }
}
export class OsSynthProvider {
    id = 'os-synth';
    displayName = 'System voice';
    capabilities = CAPABILITIES;
    #platform;
    #timeoutMs;
    #warm = false;
    #child = null;
    #cancelled = false;
    constructor(opts = {}) {
        this.#platform = opts.platform ?? process.platform;
        this.#timeoutMs = opts.timeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS;
    }
    get isWarm() { return this.#warm; }
    async prepare() {
        if (this.#warm)
            return;
        // Presence is not warmth; confirm the binary actually answers.
        await this.listVoices();
        this.#warm = true;
    }
    cancel() {
        this.#cancelled = true;
        const c = this.#child;
        this.#child = null;
        if (c !== null && c.exitCode === null)
            c.kill('SIGKILL');
    }
    async listVoices() {
        try {
            switch (this.#platform) {
                case 'darwin': {
                    const out = await this.#capture('say', ['-v', '?']);
                    return out.split('\n').map((l) => l.split(/\s{2,}/)[0]?.trim() ?? '').filter((v) => v.length > 0);
                }
                case 'win32': {
                    const ps = 'Add-Type -AssemblyName System.Speech; ' +
                        '(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ' +
                        '%{ $_.VoiceInfo.Name }';
                    const out = await this.#capture('powershell', ['-NoProfile', '-NonInteractive', '-STA', '-Command', ps]);
                    return out.split('\n').map((l) => l.trim()).filter((v) => v.length > 0);
                }
                case 'linux': {
                    const out = await this.#capture('spd-say', ['--list-synthesis-voices']).catch(() => '');
                    if (out.length > 0)
                        return out.split('\n').map((l) => l.trim()).filter((v) => v.length > 0);
                    await this.#capture('espeak-ng', ['--version']);
                    return ['default'];
                }
            }
        }
        catch {
            return [];
        }
    }
    async *generate(text, opts = {}) {
        this.#cancelled = false;
        if (text.trim().length === 0)
            return; // T041b: nothing to say
        const dir = await mkdtemp(join(tmpdir(), 'orca-tts-'));
        const wav = join(dir, 'out.wav');
        try {
            try {
                await this.#synthesizeToFile(text, wav, opts);
            }
            catch (err) {
                if (err instanceof OsSynthTimeoutError)
                    return; // no audio, but never a hang
                throw err;
            }
            if (this.#cancelled || opts.signal?.aborted === true)
                return;
            const data = await readFile(wav).catch(() => null);
            if (data === null || data.length === 0)
                return;
            yield { data: new Uint8Array(data), format: 'wav', sampleRate: CAPABILITIES.sampleRate, channels: 1 };
        }
        finally {
            await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        }
    }
    #command(text, outFile, opts) {
        switch (this.#platform) {
            case 'darwin': {
                // WAV, never the default AIFF: decodeAudioData rejects AIFF-C (measured, E6e).
                const args = ['-o', outFile, '--data-format=LEI16@22050'];
                if (opts.voice !== undefined)
                    args.push('-v', opts.voice);
                if (opts.rate !== undefined)
                    args.push('-r', String(Math.round(opts.rate * 175)));
                args.push(text);
                return { cmd: 'say', args };
            }
            case 'win32': {
                const esc = (s) => s.replace(/'/g, "''");
                const rate = opts.rate === undefined ? 0 : Math.max(-10, Math.min(10, Math.round((opts.rate - 1) * 10)));
                const voice = opts.voice === undefined ? '' : `$s.SelectVoice('${esc(opts.voice)}'); `;
                const ps = 'Add-Type -AssemblyName System.Speech; ' +
                    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
                    voice +
                    `$s.Rate = ${rate}; ` +
                    `$s.SetOutputToWaveFile('${esc(outFile)}'); ` +
                    `$s.Speak('${esc(text)}'); $s.Dispose()`;
                return { cmd: 'powershell', args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', ps] };
            }
            case 'linux': {
                const args = ['-w', outFile];
                if (opts.voice !== undefined)
                    args.push('-v', opts.voice);
                args.push(text);
                return { cmd: 'espeak-ng', args };
            }
        }
    }
    async #synthesizeToFile(text, outFile, opts) {
        const { cmd, args } = this.#command(text, outFile, opts);
        await new Promise((resolve, reject) => {
            let child;
            try {
                child = spawn(cmd, args, { stdio: 'ignore' });
            }
            catch (err) {
                reject(new OsSynthUnavailableError(this.#platform, [cmd]));
                void err;
                return;
            }
            this.#child = child;
            const timer = setTimeout(() => {
                if (child.exitCode === null)
                    child.kill('SIGKILL');
                reject(new OsSynthTimeoutError(cmd, this.#timeoutMs));
            }, this.#timeoutMs);
            const settle = (fn) => { clearTimeout(timer); fn(); };
            child.on('error', () => settle(() => reject(new OsSynthUnavailableError(this.#platform, [cmd]))));
            child.on('close', () => settle(() => { this.#child = null; resolve(); }));
            opts.signal?.addEventListener('abort', () => this.cancel(), { once: true });
        });
    }
    #capture(cmd, args) {
        return new Promise((resolve, reject) => {
            let child;
            try {
                child = spawn(cmd, [...args], { stdio: ['ignore', 'pipe', 'ignore'] });
            }
            catch {
                reject(new OsSynthUnavailableError(this.#platform, [cmd]));
                return;
            }
            let out = '';
            const timer = setTimeout(() => {
                if (child.exitCode === null)
                    child.kill('SIGKILL');
                reject(new OsSynthTimeoutError(cmd, this.#timeoutMs));
            }, this.#timeoutMs);
            const settle = (fn) => { clearTimeout(timer); fn(); };
            child.stdout?.on('data', (d) => { out += d.toString('utf8'); });
            child.on('error', () => settle(() => reject(new OsSynthUnavailableError(this.#platform, [cmd]))));
            child.on('close', (code) => settle(() => {
                if (code === 0)
                    resolve(out);
                else
                    reject(new OsSynthUnavailableError(this.#platform, [cmd]));
            }));
        });
    }
}
