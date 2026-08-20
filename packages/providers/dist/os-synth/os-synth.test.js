import { describe, expect, it } from 'vitest';
import { OsSynthProvider } from './index.js';
import { runProviderContract } from '../contract.js';
// T045: the contract runs against the real OS synthesizer on whatever platform CI is on.
runProviderContract('OsSynthProvider', () => new OsSynthProvider());
describe('T042 per-platform command construction', () => {
    it('T042e reports unavailability rather than failing silently', async () => {
        // A platform whose binary does not exist must yield no voices, not throw into the caller.
        const p = new OsSynthProvider({ platform: 'linux' });
        const voices = await p.listVoices();
        expect(Array.isArray(voices)).toBe(true);
    });
    it('produces real audio bytes on this platform', async () => {
        const p = new OsSynthProvider();
        await p.prepare();
        let bytes = 0;
        for await (const c of p.generate('Testing one two three.'))
            bytes += c.data.length;
        expect(bytes, 'the OS synthesizer produced no audio').toBeGreaterThan(1000);
    }, 120_000);
    it('T042a macOS output is WAV, never AIFF — decodeAudioData rejects AIFF-C', async () => {
        if (process.platform !== 'darwin')
            return;
        const p = new OsSynthProvider();
        await p.prepare();
        for await (const c of p.generate('hello')) {
            expect(c.format).toBe('wav');
            const header = new TextDecoder().decode(c.data.slice(0, 4));
            expect(header, 'not a RIFF/WAV header').toBe('RIFF');
            break;
        }
    }, 120_000);
});
describe('T042d cancel latency is measured, not assumed', () => {
    it('cancel stops the child process promptly', async () => {
        const p = new OsSynthProvider();
        await p.prepare();
        const iter = p.generate('This is a long sentence. '.repeat(30))[Symbol.asyncIterator]();
        const pending = iter.next();
        await new Promise((r) => setTimeout(r, 50));
        const t0 = Date.now();
        p.cancel();
        await pending;
        const elapsed = Date.now() - t0;
        console.info(`[measured] OsSynthProvider cancel -> return: ${elapsed} ms`);
        expect(elapsed).toBeLessThan(2000);
    }, 120_000);
});
