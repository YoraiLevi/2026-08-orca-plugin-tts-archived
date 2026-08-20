/**
 * The speech pipeline: text in, audio out, cancellable.
 *
 * Two request modes, because the two callers want opposite things:
 *  - 'replace' (hotkey): a second press interrupts the first. You asked for THIS text now.
 *  - 'queue'   (huddle): replies are spoken in order and never cut each other off. An agent
 *    finishing turn 3 while turn 2 is still being read must not truncate turn 2.
 *
 * Shipping only 'replace' meant huddle silently dropped replies mid-sentence (reported live).
 */
import { type NormalizeOptions, type PlaybackSink } from '@orca-tts/core';
import type { TtsProvider } from '@orca-tts/core';
export type SpeakMode = 'replace' | 'queue';
export interface SpeechServiceDeps {
    readonly provider: TtsProvider;
    readonly sink: PlaybackSink;
    readonly log?: (m: string) => void;
    readonly maxUnits?: number;
    readonly normalizeOptions?: NormalizeOptions;
    /** Cap on queued utterances; beyond this the OLDEST are dropped (never the newest). */
    readonly maxQueued?: number;
    /** Called when the queue overflows, so the user can be told rather than left guessing. */
    readonly onDropped?: (count: number) => void;
}
export declare class SpeechService {
    #private;
    constructor(deps: SpeechServiceDeps);
    get isSpeaking(): boolean;
    get queued(): number;
    /** What is being read right now, if the caller labelled it. */
    get nowReading(): string | null;
    /** Abandon the current utterance and move to the next queued one. */
    skip(): Promise<void>;
    /** Speak `text`. See SpeakMode. Returns immediately; use `isSpeaking` to observe. */
    speak(text: string, mode?: SpeakMode, label?: string): void;
    /** Two-sided stop: cancels synthesis, flushes audio, and clears anything waiting (R022). */
    stop(): Promise<void>;
}
