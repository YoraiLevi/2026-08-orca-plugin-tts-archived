import { describe, expect, it, vi } from 'vitest';
import { PlaybackQueue } from './index.js';
const chunk = (n) => ({ data: new Uint8Array([n]), format: 'wav', sampleRate: 22050, channels: 1 });
class FakeSink {
    played = [];
    stopped = 0;
    isPlaying = false;
    async enqueue(c) { this.played.push(c.data[0]); }
    async stop() { this.stopped++; this.played = []; }
}
describe('T044 playback queue', () => {
    it('T044a barge-in clears the queue and cancels SYNTHESIS too', async () => {
        const sink = new FakeSink();
        const cancelSynthesis = vi.fn();
        const q = new PlaybackQueue({ sink, cancelSynthesis });
        const gen = q.begin();
        q.push(gen, chunk(1));
        await q.bargeIn();
        // Two-sided cancel (R022): stopping the player alone would leave the synthesizer running.
        expect(cancelSynthesis).toHaveBeenCalledTimes(1);
        expect(sink.stopped).toBe(1);
    });
    it('T044b a superseded generation cannot play over the new one', async () => {
        const sink = new FakeSink();
        const q = new PlaybackQueue({ sink, cancelSynthesis: () => { } });
        const first = q.begin();
        const second = q.begin();
        expect(q.push(first, chunk(1))).toBe(false); // stale audio is refused outright
        expect(q.push(second, chunk(2))).toBe(true);
        await new Promise((r) => setTimeout(r, 0));
        expect(sink.played).toEqual([2]);
    });
    it('T044c chunks of one generation play in order', async () => {
        const sink = new FakeSink();
        const q = new PlaybackQueue({ sink, cancelSynthesis: () => { } });
        const gen = q.begin();
        for (const n of [1, 2, 3, 4])
            q.push(gen, chunk(n));
        await new Promise((r) => setTimeout(r, 0));
        expect(sink.played).toEqual([1, 2, 3, 4]);
    });
});
