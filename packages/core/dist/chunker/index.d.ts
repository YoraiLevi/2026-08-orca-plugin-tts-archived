/**
 * Streaming sentence chunker.
 *
 * Turns an incrementally-arriving reply into utterances a synthesizer can speak without
 * sounding choppy. Pure, DEPENDENCY-FREE, and incremental: `addText()` may be called with
 * arbitrary fragments and must produce exactly what the whole string would have produced.
 *
 * Algorithm ported from block/buzz `pocket_april.rs` (docs/.research/prior-art-buzz.md,
 * "Streaming chunker"), with buzz's SentencePiece token counter replaced by an injected
 * unit counter so local (token-budget) and cloud (character-budget) engines share one splitter.
 *
 * Two policies over ONE splitter, switched by a single flag:
 *   - first chunk  -> the EARLIEST sentence end   (minimum time to first audio)
 *   - later chunks -> the LATEST boundary that fits (fewest synthesis calls, best prosody)
 *
 * Invariant: `chunks.join('') === input`, exactly. Trailing whitespace travels with its chunk.
 */
export type BoundaryKind = 'sentence' | 'clause' | 'word' | 'scalar' | 'end';
export interface Chunk {
    readonly text: string;
    readonly boundary: BoundaryKind;
    readonly isFirst: boolean;
}
export interface ChunkerOptions {
    /** Maximum units per chunk. Units are whatever `countUnits` returns. */
    maxUnits?: number;
    /** Engine-specific size measure. Default: characters. Local engines pass a tokenizer. */
    countUnits?: (text: string) => number;
    /** Isolate the first sentence of an utterance for minimum latency. Default true. */
    isolateFirstSentence?: boolean;
}
export declare class Chunker {
    #private;
    constructor(opts?: ChunkerOptions);
    /** Feed more text. Returns whatever chunks are now complete. */
    addText(text: string): Chunk[];
    /** End of utterance: flush whatever remains. */
    finish(): Chunk[];
    /** Discard buffered text without emitting it (barge-in). */
    reset(): void;
}
