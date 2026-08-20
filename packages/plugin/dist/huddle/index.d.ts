import type { AgentStatusChanged } from '../adapter/index.js';
/** Minimal port, so huddle can be tested without a synthesizer. */
export interface SpeechPort {
    speak(text: string, mode?: 'replace' | 'queue', label?: string): void;
    stop(): Promise<void>;
}
export interface HuddleStore {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
}
export declare const HUDDLE_STATE_KEY = "huddle.enabled";
export declare const HUDDLE_SPOKEN_KEY = "huddle.spokenIds";
/** Bounded so plugin storage (256 KB per value) can never be blown by a long session. */
export declare const MAX_REMEMBERED_IDS = 300;
/** The transcript flush lags the done event; keep watching this long after it. */
export declare const WATCH_WINDOW_MS = 20000;
export interface HuddleDeps {
    readonly speech: SpeechPort;
    readonly store?: HuddleStore;
    readonly log: (m: string) => void;
    readonly notify: (m: string) => void;
    /** Override for tests. */
    readonly projectsDir?: string;
}
/** "orca-plugin-tts, session 111693de" — enough to know whose words you are hearing. */
export declare function sessionLabel(file: string): string;
export declare class HuddleController {
    #private;
    constructor(deps: HuddleDeps);
    get enabled(): boolean;
    restore(): Promise<boolean>;
    toggle(): boolean;
    lastReply(): Promise<string | null>;
    /** The event is a hint: start (or extend) watching the transcript for this worktree. */
    onAgentStatus(status: AgentStatusChanged, worktreePath: string | null): void;
    dispose(): void;
    /** Follow a different session, announcing the switch so the listener is never disoriented. */
    switchTo(file: string): void;
    /** Stop following any session; huddle stays on but silent until you pick one. */
    unlock(): void;
    get following(): string | null;
}
