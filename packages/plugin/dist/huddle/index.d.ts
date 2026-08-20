/** Minimal port, so huddle can be tested without a synthesizer. */
export interface SpeechPort {
    speak(text: string): void;
    stop(): Promise<void>;
}
import type { AgentStatusChanged } from '../adapter/index.js';
export interface HuddleDeps {
    readonly speech: SpeechPort;
    readonly log: (m: string) => void;
    readonly notify: (m: string) => void;
    /** Override for tests. */
    readonly projectsDir?: string;
}
export declare class HuddleController {
    #private;
    constructor(deps: HuddleDeps);
    get enabled(): boolean;
    toggle(): boolean;
    lastReply(): Promise<string | null>;
    /** Called on every `agent.status.changed`. Speaks on the working -> done edge. */
    onAgentStatus(status: AgentStatusChanged, worktreePath: string | null): void;
}
