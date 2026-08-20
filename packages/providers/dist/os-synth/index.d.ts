import type { AudioChunk, ProviderCapabilities, SynthesizeOptions, TtsProvider } from '@orca-tts/core';
export type OsPlatform = 'darwin' | 'win32' | 'linux';
export interface OsSynthOptions {
    /** Override for tests. Defaults to `process.platform`. */
    readonly platform?: OsPlatform;
    /**
     * Hard deadline for any spawned helper. A synthesizer that never exits must not hang the
     * plugin — Windows PowerShell can block indefinitely on a headless session, and without this
     * the worker waits forever (found by CI on windows-latest, PITFALLS P14).
     */
    readonly timeoutMs?: number;
}
/** PowerShell + Add-Type of System.Speech is slow to start; be generous but never unbounded. */
export declare const DEFAULT_SPAWN_TIMEOUT_MS = 60000;
export declare class OsSynthUnavailableError extends Error {
    constructor(platform: string, tried: readonly string[]);
}
export declare class OsSynthTimeoutError extends Error {
    constructor(cmd: string, ms: number);
}
export declare class OsSynthProvider implements TtsProvider {
    #private;
    readonly id = "os-synth";
    readonly displayName = "System voice";
    readonly capabilities: ProviderCapabilities;
    constructor(opts?: OsSynthOptions);
    get isWarm(): boolean;
    prepare(): Promise<void>;
    cancel(): void;
    listVoices(): Promise<readonly string[]>;
    generate(text: string, opts?: SynthesizeOptions): AsyncIterable<AudioChunk>;
}
