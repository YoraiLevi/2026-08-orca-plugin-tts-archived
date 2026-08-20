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
import { Chunker, PlaybackQueue, normalize } from '@orca-tts/core';
const DEFAULT_MAX_QUEUED = 20;
export class SpeechService {
    #deps;
    #playback;
    #pending = [];
    #draining = false;
    #cancelled = false;
    #skip = false;
    #current = null;
    constructor(deps) {
        this.#deps = deps;
        this.#playback = new PlaybackQueue({
            sink: deps.sink,
            cancelSynthesis: () => { deps.provider.cancel(); }
        });
    }
    get isSpeaking() {
        return this.#draining || this.#pending.length > 0 || this.#deps.sink.isPlaying;
    }
    get queued() { return this.#pending.length; }
    /** What is being read right now, if the caller labelled it. */
    get nowReading() { return this.#current; }
    /** Abandon the current utterance and move to the next queued one. */
    async skip() {
        this.#skip = true;
        await this.#playback.bargeIn();
    }
    /** Speak `text`. See SpeakMode. Returns immediately; use `isSpeaking` to observe. */
    speak(text, mode = 'replace', label) {
        if (mode === 'replace') {
            this.#pending = [];
            void this.#playback.bargeIn();
        }
        this.#pending.push(label === undefined ? { text } : { text, label });
        const max = this.#deps.maxQueued ?? DEFAULT_MAX_QUEUED;
        if (this.#pending.length > max) {
            const dropped = this.#pending.length - max;
            this.#pending = this.#pending.slice(-max); // keep the newest; never block the agent
            // Never silently. Losing a reply you were waiting for, with no signal, is the worst outcome.
            this.#deps.log?.(`speech queue full, dropped ${dropped} older utterance(s)`);
            this.#deps.onDropped?.(dropped);
        }
        this.#cancelled = false;
        void this.#drain();
    }
    /** Two-sided stop: cancels synthesis, flushes audio, and clears anything waiting (R022). */
    async stop() {
        this.#cancelled = true;
        this.#pending = [];
        await this.#playback.bargeIn();
    }
    async #drain() {
        if (this.#draining)
            return;
        this.#draining = true;
        try {
            for (;;) {
                const next = this.#pending.shift();
                if (next === undefined)
                    break;
                this.#current = next.label ?? null;
                this.#skip = false;
                await this.#speakOne(next.text);
                this.#current = null;
                if (this.#cancelled)
                    break;
            }
        }
        finally {
            this.#draining = false;
        }
    }
    async #speakOne(text) {
        const spoken = normalize(text, this.#deps.normalizeOptions ?? {});
        if (spoken.length === 0) {
            this.#deps.log?.('nothing speakable in that text');
            return;
        }
        const chunkerOpts = {};
        if (this.#deps.maxUnits !== undefined)
            chunkerOpts.maxUnits = this.#deps.maxUnits;
        const chunker = new Chunker(chunkerOpts);
        const chunks = [...chunker.addText(spoken), ...chunker.finish()];
        const generation = this.#playback.begin();
        for (const chunk of chunks) {
            if (this.#cancelled || this.#skip || generation !== this.#playback.generation)
                return;
            try {
                for await (const audio of this.#deps.provider.generate(chunk.text)) {
                    if (!this.#playback.push(generation, audio))
                        return;
                }
            }
            catch (err) {
                // R024: contain the failure. Speech stops; the host does not.
                this.#deps.log?.(`synthesis failed: ${String(err)}`);
                return;
            }
        }
    }
}
