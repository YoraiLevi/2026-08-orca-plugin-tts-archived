import type { TtsProvider } from '@orca-tts/core';
export declare const CANCEL_BUDGET_MS = 50;
export interface ContractOptions {
    /** Skip the suite when the platform cannot run this provider (reported, never silent). */
    readonly skipReason?: string;
    /** Text long enough that synthesis is still running when we cancel. */
    readonly longText?: string;
}
export declare function runProviderContract(name: string, make: () => TtsProvider, opts?: ContractOptions): void;
