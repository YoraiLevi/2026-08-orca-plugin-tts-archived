export class PlaybackQueue {
    #generation = 0;
    #pending = [];
    #draining = false;
    #deps;
    constructor(deps) { this.#deps = deps; }
    get generation() { return this.#generation; }
    get depth() { return this.#pending.length; }
    /** Begin a new utterance. Returns its generation tag. */
    begin() {
        this.#generation++;
        return this.#generation;
    }
    /** Enqueue audio for `gen`. Chunks from a superseded generation are dropped. */
    push(gen, chunk) {
        if (gen !== this.#generation)
            return false;
        this.#pending.push({ gen, chunk });
        void this.#drain();
        return true;
    }
    /** Two-sided cancel: stop synthesis, stop playback, drop the queue. */
    async bargeIn() {
        this.#generation++;
        this.#pending = [];
        this.#deps.cancelSynthesis();
        await this.#deps.sink.stop();
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
                if (next.gen !== this.#generation)
                    continue; // superseded while queued
                await this.#deps.sink.enqueue(next.chunk);
            }
        }
        finally {
            this.#draining = false;
        }
    }
}
