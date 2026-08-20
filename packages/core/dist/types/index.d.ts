/** Shared contracts. Zero imports — these types travel to every process. */
export interface AudioChunk {
    /** Encoded or raw audio. Format is declared by the provider, per utterance. */
    readonly data: Uint8Array;
    /** e.g. 'wav' | 'pcm-s16le' | 'mp3' | 'opus'. */
    readonly format: string;
    readonly sampleRate: number;
    readonly channels: number;
}
export interface ProviderCapabilities {
    /** Can it yield audio before the whole utterance is synthesized? */
    readonly streaming: boolean;
    /** Does it work with no network at all? */
    readonly offline: boolean;
    readonly needsApiKey: boolean;
    /** Bytes that must be downloaded before first use. 0 if none. */
    readonly needsModelDownload: number;
    /** SPDX-ish string, surfaced in the UI before use. */
    readonly licence: string;
    readonly cloning: boolean;
    readonly sampleRate: number;
}
export interface SynthesizeOptions {
    readonly voice?: string;
    /** 1.0 is the provider's natural rate. */
    readonly rate?: number;
    readonly signal?: AbortSignal;
}
/**
 * A speech engine.
 *
 * Providers emit audio and NEVER own playback (constitution R023): a synthesizer that plays
 * cannot serve a different machine, and the user requires playback to belong to the client.
 */
export interface TtsProvider {
    readonly id: string;
    readonly displayName: string;
    readonly capabilities: ProviderCapabilities;
    /** Idempotent. Loads models, warms caches. Safe to call repeatedly. */
    prepare(): Promise<void>;
    /** True once `prepare()` has completed and synthesis will not pay a cold-start cost. */
    readonly isWarm: boolean;
    /** Yields audio for `text`. Must respect `opts.signal` and stop promptly. */
    generate(text: string, opts?: SynthesizeOptions): AsyncIterable<AudioChunk>;
    /**
     * Two-sided cancel (R022): abort in-flight synthesis AND stop producing.
     * Killing only the player leaves the synthesizer generating speech for interrupted text.
     */
    cancel(): void;
    /** Voices the provider can currently offer. May be empty before `prepare()`. */
    listVoices(): Promise<readonly string[]>;
}
export interface PlaybackSink {
    enqueue(chunk: AudioChunk): Promise<void>;
    /** Stop immediately and discard anything queued. */
    stop(): Promise<void>;
    readonly isPlaying: boolean;
}
/** Incremental text producer: transcript tail, clipboard, or a test. */
export interface TextSource {
    addText(chunk: string): void;
    finish(): void;
}
export type DegradationRung = 'preferred' | 'fallback' | 'floor' | 'unavailable';
export interface EngineStatus {
    readonly providerId: string;
    readonly rung: DegradationRung;
    /** Shown to the user when we are not on the preferred rung. Never degrade silently (R015). */
    readonly reason?: string;
}
