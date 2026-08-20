/**
 * Huddle mode: speak agent replies as they land.
 *
 * The correlation from a plugin event to a transcript file is a HEURISTIC and we say so out loud.
 * `agent.status.changed` carries no session id (measured, E3); the only handle is `worktreeId`,
 * which embeds the absolute worktree path. When two agents share one worktree — ORCA's headline
 * feature — the heuristic cannot distinguish them, so we degrade LOUDLY (R015) rather than speak
 * the wrong agent's words.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { decodeClaudeLine } from './decoders.js';
export class HuddleController {
    #deps;
    #enabled = false;
    #spokenIds = new Set();
    #lastReply = null;
    #warnedAmbiguous = false;
    constructor(deps) { this.#deps = deps; }
    get enabled() { return this.#enabled; }
    toggle() {
        this.#enabled = !this.#enabled;
        if (!this.#enabled)
            void this.#deps.speech.stop();
        return this.#enabled;
    }
    async lastReply() {
        if (this.#lastReply !== null)
            return this.#lastReply;
        const file = await this.#newestTranscript(null);
        if (file === null)
            return null;
        const replies = await this.#readReplies(file);
        const last = replies[replies.length - 1];
        return last?.text ?? null;
    }
    /** Called on every `agent.status.changed`. Speaks on the working -> done edge. */
    onAgentStatus(status, worktreePath) {
        if (status.state !== 'done')
            return;
        void this.#speakNewReplies(worktreePath);
    }
    async #speakNewReplies(worktreePath) {
        const file = await this.#newestTranscript(worktreePath);
        if (file === null)
            return;
        const replies = await this.#readReplies(file);
        const fresh = replies.filter((r) => !this.#spokenIds.has(r.id));
        for (const r of fresh)
            this.#spokenIds.add(r.id);
        const last = fresh[fresh.length - 1];
        if (last === undefined)
            return;
        this.#lastReply = last.text;
        if (this.#enabled)
            this.#deps.speech.speak(last.text);
    }
    #projectsRoot() {
        return this.#deps.projectsDir ?? join(homedir(), '.claude', 'projects');
    }
    /**
     * Most-recently-modified transcript under the worktree's project slug.
     * This is the heuristic. If two transcripts were touched within a few seconds of each other we
     * cannot tell which agent spoke, so we warn once and decline to guess.
     */
    async #newestTranscript(worktreePath) {
        const root = this.#projectsRoot();
        let dirs;
        try {
            dirs = await readdir(root);
        }
        catch {
            return null;
        }
        const slug = worktreePath === null ? null : worktreePath.replace(/[/\\:]/g, '-');
        const candidates = slug === null
            ? dirs
            : dirs.filter((d) => d === slug || d.endsWith(slug) || slug.endsWith(d));
        const search = candidates.length > 0 ? candidates : dirs;
        const files = [];
        for (const d of search) {
            let entries;
            try {
                entries = await readdir(join(root, d));
            }
            catch {
                continue;
            }
            for (const e of entries) {
                if (!e.endsWith('.jsonl'))
                    continue;
                const p = join(root, d, e);
                try {
                    files.push({ path: p, mtime: (await stat(p)).mtimeMs });
                }
                catch {
                    continue;
                }
            }
        }
        if (files.length === 0)
            return null;
        files.sort((a, b) => b.mtime - a.mtime);
        const first = files[0];
        const second = files[1];
        if (first !== undefined && second !== undefined && first.mtime - second.mtime < 2000) {
            if (!this.#warnedAmbiguous) {
                this.#warnedAmbiguous = true;
                this.#deps.notify('Read Aloud: two agents are active in this worktree, so huddle mode cannot tell which one ' +
                    'replied. Speaking the most recent — use "speak last reply" if it picks the wrong one.');
            }
        }
        return first?.path ?? null;
    }
    async #readReplies(file) {
        let raw;
        try {
            raw = await readFile(file, 'utf8');
        }
        catch {
            return [];
        }
        const out = [];
        for (const line of raw.split('\n')) {
            if (line.trim().length === 0)
                continue;
            const decoded = decodeClaudeLine(line);
            if (decoded !== null)
                out.push(decoded);
        }
        return out;
    }
}
