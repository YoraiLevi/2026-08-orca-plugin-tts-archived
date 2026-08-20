/**
 * ORCA API quarantine.
 *
 * EVERY call into ORCA's plugin host happens here and nowhere else (constitution R020). The host
 * API is EXPERIMENTAL with an explicit no-compatibility promise, so when it breaks, it breaks in
 * one file.
 *
 * Shapes verified against `examples/plugins/hello-orca/main.mjs` and
 * `src/shared/plugins/plugin-host-api.ts` at commit 0f26ff4a — NOT guessed. An earlier version of
 * this file invented `registerCommand` / `onEvent` / `notify`; every one of them silently no-oped,
 * so no command was ever registered and ORCA reported "Could not run the plugin command"
 * (PITFALLS P18).
 */
/** The four-field projection ORCA emits. Verified: plugin-events.ts:28-33. */
export interface AgentStatusChanged {
    readonly worktreeId: string | null;
    readonly paneKey: string;
    readonly state: string;
    readonly receivedAt: number;
    /** Present only once stablyai/orca#15640 lands. */
    readonly sessionId?: string | null;
}
/** The object ORCA passes to `activate(orca)`. */
export interface OrcaApi {
    commands: {
        register(id: string, handler: (args?: unknown) => unknown): void;
    };
    events: {
        on(name: string, handler: (payload: unknown) => void): void;
    };
    host: {
        call(action: string, params?: Record<string, unknown>): Promise<unknown>;
    };
    log(message: string): void;
}
export interface Host {
    log(message: string): void;
    /** Desktop notification. Falls back to the log if the capability is denied. */
    notify(title: string, body?: string): void;
    storageGet(key: string): Promise<unknown>;
    storageSet(key: string, value: unknown): Promise<void>;
    onEvent(name: string, handler: (payload: unknown) => void): void;
    registerCommand(id: string, handler: () => void | Promise<void>): void;
}
/**
 * Adapts the real `orca` object to our internal `Host`.
 *
 * Defensive on purpose: a missing method degrades to a logged no-op rather than taking the plugin
 * down (R024). But note the lesson from P18 — defensiveness HIDES a wrong method name. The
 * `registeredCommands` counter exists so activate() can assert it actually wired something up.
 */
export declare function makeHost(orca: OrcaApi): Host & {
    registeredCommands: () => number;
};
/** Narrows an untyped event payload to the projection, or null. Never throws. */
export declare function asAgentStatus(payload: unknown): AgentStatusChanged | null;
/**
 * `worktreeId` is `<repoId>::<absolute path>` (measured, E3). It is the ONLY correlation handle a
 * plugin gets today — `paneKey` is `<tabId>:<layoutLeaf>` and carries no session id.
 */
export declare function worktreePathFrom(worktreeId: string | null): string | null;
