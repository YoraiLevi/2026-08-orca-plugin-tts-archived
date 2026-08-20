/** Selects a provider and reports which rung of the degradation ladder we are on. */
import type { EngineStatus, TtsProvider } from '@orca-tts/core';
export declare class ProviderRegistry {
    #private;
    register(p: TtsProvider, opts?: {
        preferred?: boolean;
    }): void;
    get(id: string): TtsProvider | undefined;
    list(): readonly TtsProvider[];
    /**
     * Resolve the best usable provider, preferring `requestedId`, then the preferred engine, then
     * anything offline. Never returns silently-degraded: the status carries the reason (R015).
     */
    resolve(requestedId?: string): Promise<{
        provider: TtsProvider;
        status: EngineStatus;
    } | null>;
}
