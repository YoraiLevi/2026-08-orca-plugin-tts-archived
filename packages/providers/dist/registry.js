export class ProviderRegistry {
    #providers = new Map();
    #preferredId = null;
    register(p, opts = {}) {
        this.#providers.set(p.id, p);
        if (opts.preferred === true)
            this.#preferredId = p.id;
    }
    get(id) { return this.#providers.get(id); }
    list() { return [...this.#providers.values()]; }
    /**
     * Resolve the best usable provider, preferring `requestedId`, then the preferred engine, then
     * anything offline. Never returns silently-degraded: the status carries the reason (R015).
     */
    async resolve(requestedId) {
        const tryOrder = [
            requestedId,
            this.#preferredId ?? undefined,
            ...this.list().filter((p) => p.capabilities.offline).map((p) => p.id)
        ].filter((x) => typeof x === 'string');
        const seen = new Set();
        let rung = 'preferred';
        for (const id of tryOrder) {
            if (seen.has(id))
                continue;
            seen.add(id);
            const p = this.#providers.get(id);
            if (p === undefined) {
                rung = 'fallback';
                continue;
            }
            try {
                await p.prepare();
            }
            catch (err) {
                rung = 'fallback';
                void err;
                continue;
            }
            const reason = rung === 'preferred'
                ? undefined
                : `${requestedId ?? this.#preferredId ?? 'preferred engine'} was unavailable; using ${p.displayName}`;
            return { provider: p, status: reason === undefined ? { providerId: p.id, rung } : { providerId: p.id, rung, reason } };
        }
        return null;
    }
}
