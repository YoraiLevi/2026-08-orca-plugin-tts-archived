import { describe, expect, it, vi } from 'vitest';
import { SpeechService } from './speech-service.js';
/** Let the async drain loop run to completion. */
const settle = async () => {
    for (let i = 0; i < 20; i++)
        await new Promise((r) => setTimeout(r, 5));
};
class RecordingProvider {
    id = 'fake';
    displayName = 'Fake';
    synthesized = [];
    cancelled = 0;
    #warm = false;
    capabilities = {
        streaming: true, offline: true, needsApiKey: false, needsModelDownload: 0,
        licence: 'test', cloning: false, sampleRate: 22050
    };
    get isWarm() { return this.#warm; }
    async prepare() { this.#warm = true; }
    cancel() { this.cancelled++; }
    async listVoices() { return []; }
    async *generate(text) {
        this.synthesized.push(text);
        yield { data: new Uint8Array([1]), format: 'wav', sampleRate: 22050, channels: 1 };
    }
}
class FakeSink {
    chunks = 0;
    stops = 0;
    isPlaying = false;
    async enqueue() { this.chunks++; }
    async stop() { this.stops++; }
}
describe('T066 pipeline integration', () => {
    it('normalizes, chunks, synthesizes, and plays in that order', async () => {
        const provider = new RecordingProvider();
        const sink = new FakeSink();
        const s = new SpeechService({ provider, sink });
        s.speak('# Title\nThis is **one**. This is two.');
        await settle();
        // Markdown is gone before the engine ever sees the text.
        expect(provider.synthesized.join('')).not.toMatch(/[*#]/);
        expect(provider.synthesized.join('')).toContain('Title.');
        expect(sink.chunks).toBeGreaterThan(0);
    });
    it('speaks nothing when the text normalizes to empty, and says so', async () => {
        const provider = new RecordingProvider();
        const log = vi.fn();
        const s = new SpeechService({ provider, sink: new FakeSink(), log });
        s.speak('.');
        await settle();
        expect(provider.synthesized).toEqual([]);
        expect(log).toHaveBeenCalled(); // never fail silently
    });
    it('stop() is two-sided: cancels synthesis AND flushes playback', async () => {
        const provider = new RecordingProvider();
        const sink = new FakeSink();
        const s = new SpeechService({ provider, sink });
        s.speak('One. Two. Three.');
        await s.stop();
        expect(provider.cancelled).toBeGreaterThan(0);
        expect(sink.stops).toBeGreaterThan(0);
    });
    it('a synthesis failure stops speech, not the host', async () => {
        const provider = new RecordingProvider();
        provider.generate = async function* () {
            // Yield once so this is a real generator, then fail mid-utterance — the realistic case:
            // an engine that dies after producing some audio, not one that never starts.
            yield { data: new Uint8Array([1]), format: 'wav', sampleRate: 22050, channels: 1 };
            throw new Error('engine died');
        };
        const log = vi.fn();
        const s = new SpeechService({ provider, sink: new FakeSink(), log });
        s.speak('Hello there.');
        await settle();
        expect(log).toHaveBeenCalledWith(expect.stringContaining('engine died'));
    });
    it("queue mode speaks utterances in order and never cuts one off", async () => {
        const provider = new RecordingProvider();
        const s = new SpeechService({ provider, sink: new FakeSink() });
        s.speak('First reply.', 'queue');
        s.speak('Second reply.', 'queue');
        s.speak('Third reply.', 'queue');
        await settle();
        const said = provider.synthesized.join(' ');
        expect(said).toContain('First reply.');
        expect(said).toContain('Second reply.');
        expect(said).toContain('Third reply.');
        expect(said.indexOf('First')).toBeLessThan(said.indexOf('Second'));
        expect(said.indexOf('Second')).toBeLessThan(said.indexOf('Third'));
    });
    it('replace mode interrupts, which is what a hotkey press means', async () => {
        const provider = new RecordingProvider();
        const sink = new FakeSink();
        const s = new SpeechService({ provider, sink });
        s.speak('Old text.', 'queue');
        s.speak('New text.', 'replace');
        await settle();
        expect(provider.cancelled).toBeGreaterThan(0);
        expect(sink.stops).toBeGreaterThan(0);
    });
    it('a full queue drops the OLDEST, never blocking the agent', async () => {
        const provider = new RecordingProvider();
        const log = vi.fn();
        const s = new SpeechService({ provider, sink: new FakeSink(), log, maxQueued: 2 });
        for (let i = 0; i < 6; i++)
            s.speak(`Reply number ${i}.`, 'queue');
        await settle();
        expect(log).toHaveBeenCalledWith(expect.stringContaining('queue full'));
    });
});
