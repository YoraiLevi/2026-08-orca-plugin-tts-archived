/**
 * Generation-tagged playback queue.
 *
 * Barge-in clears the queue; a voice switch preserves it. Single-flight: a second speak request
 * never overlaps the first. Pure bookkeeping — no audio dependency, so it is fully testable.
 */
import type { AudioChunk, PlaybackSink } from '../types/index.js';
export interface QueueDeps {
    readonly sink: PlaybackSink;
    /** Called on barge-in so in-flight SYNTHESIS stops too, not just playback (R022). */
    readonly cancelSynthesis: () => void;
}
export declare class PlaybackQueue {
    #private;
    constructor(deps: QueueDeps);
    get generation(): number;
    get depth(): number;
    /** Begin a new utterance. Returns its generation tag. */
    begin(): number;
    /** Enqueue audio for `gen`. Chunks from a superseded generation are dropped. */
    push(gen: number, chunk: AudioChunk): boolean;
    /** Two-sided cancel: stop synthesis, stop playback, drop the queue. */
    bargeIn(): Promise<void>;
}
