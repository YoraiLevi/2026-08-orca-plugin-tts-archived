/** Minimal port, so huddle can be tested without a synthesizer. */
export interface SpeechPort {
    speak(text: string): void;
    stop(): Promise<void>;
}
import type { AgentStatusChanged } from '../adapter/index.js';
export interface HuddleStore {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
}
export declare const HUDDLE_STATE_KEY = "huddle.enabled";
export interface HuddleDeps {
    readonly speech: SpeechPort;
    /** Persisted so the setting survives the 5-minute idle worker reap. */
    readonly store?: HuddleStore;
    readonly log: (m: string) => void;
    readonly notify: (m: string) => void;
    /** Override for tests. */
    readonly projectsDir?: string;
}
export declare class HuddleController {
    #private;
    constructor(deps: HuddleDeps);
    get enabled(): boolean;
    /**
     * Restore the persisted setting. The worker is reaped after 5 minutes idle and re-forked on the
     * next trigger, so without this huddle mode silently switches itself off between uses.
     */
    restore(): Promise<boolean>;
    toggle(): boolean;
    lastReply(): Promise<string | null>;
    /** Called on every `agent.status.changed`. Speaks on the working -> done edge. */
    onAgentStatus(status: AgentStatusChanged, worktreePath: string | null): void;
}
