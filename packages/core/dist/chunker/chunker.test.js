import { describe, expect, it } from 'vitest';
import { Chunker } from './index.js';
const joinAll = (chunks) => chunks.map((c) => c.text).join('');
/** Deterministic pseudo-random corpus — no Math.random, so failures reproduce exactly. */
function makeCorpus(count) {
    const words = ['alpha', 'beta', 'gamma', 'delta', 'e.g.', 'i.e.', 'Dr.', 'etc.', 'one', 'two'];
    const puncts = ['. ', ', ', '; ', '! ', '? ', ' ', ': ', '— ', '\n', '.  '];
    const out = [];
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let i = 0; i < count; i++) {
        let s = '';
        const n = 3 + (next() % 25);
        for (let j = 0; j < n; j++) {
            s += words[next() % words.length];
            s += puncts[next() % puncts.length];
        }
        out.push(s);
    }
    return out;
}
const chunkAll = (text, limit = 60) => {
    const c = new Chunker({ maxUnits: limit });
    return [...c.addText(text), ...c.finish()];
};
// ---------------------------------------------------------------- T030 (GATE)
describe('T030 lossless invariant', () => {
    it('chunks.join() === input for 500 generated inputs', () => {
        const corpus = makeCorpus(500);
        for (const input of corpus) {
            expect(joinAll(chunkAll(input)), `input: ${JSON.stringify(input)}`).toBe(input);
        }
        expect(corpus.length).toBe(500);
    });
    it('holds for pathological inputs too', () => {
        for (const input of ['', ' ', '.', 'a', 'a'.repeat(500), '...   ...', '\n\n\n', 'no terminator here']) {
            expect(joinAll(chunkAll(input)), `input: ${JSON.stringify(input)}`).toBe(input);
        }
    });
});
// ---------------------------------------------------------------- T035 (GATE)
describe('T035 streaming equals batch', () => {
    const feed = (text, size, limit = 60) => {
        const c = new Chunker({ maxUnits: limit });
        const out = [];
        for (let i = 0; i < text.length; i += size)
            out.push(...c.addText(text.slice(i, i + size)));
        out.push(...c.finish());
        return out;
    };
    it('5 characters at a time produces identical chunks to the whole string', () => {
        for (const input of makeCorpus(200)) {
            expect(feed(input, 5).map((c) => c.text), `input: ${JSON.stringify(input)}`)
                .toEqual(chunkAll(input).map((c) => c.text));
        }
    });
    it('1 character at a time also agrees', () => {
        for (const input of makeCorpus(50)) {
            expect(feed(input, 1).map((c) => c.text)).toEqual(chunkAll(input).map((c) => c.text));
        }
    });
});
// ---------------------------------------------------------------- T031
describe('T031 boundary preference ladder', () => {
    it('prefers a sentence end', () => {
        const chunks = chunkAll('One two three. Four five six. Seven eight.', 20);
        expect(chunks[0].text).toBe('One two three. ');
        expect(chunks[0].boundary).toBe('sentence');
    });
    it('falls back to a clause when no sentence end fits', () => {
        const chunks = chunkAll('alpha beta gamma, delta epsilon zeta and more text here.', 22);
        expect(chunks[0].boundary).toBe('clause');
        expect(chunks[0].text.trimEnd().endsWith(',')).toBe(true);
    });
    it('falls back to a word when no clause fits', () => {
        const chunks = chunkAll('alpha beta gamma delta epsilon zeta eta theta iota kappa', 20);
        expect(chunks[0].boundary).toBe('word');
    });
    it('falls back to a scalar cut when a single word exceeds the limit', () => {
        const chunks = chunkAll(`${'x'.repeat(50)} tail`, 10);
        expect(chunks[0].boundary).toBe('scalar');
    });
});
// ---------------------------------------------------------------- T032
describe('T032 abbreviation guard', () => {
    const oneChunk = (t) => chunkAll(t, 200);
    it('e.g. does not end a sentence', () => {
        expect(oneChunk('Use a tool, e.g. ripgrep, for this.').length).toBe(1);
    });
    it('i.e. does not end a sentence', () => {
        expect(oneChunk('The main one, i.e. the first, wins.').length).toBe(1);
    });
    it('titles do not end a sentence', () => {
        expect(oneChunk('Ask Dr. Smith about it.').length).toBe(1);
    });
    it('etc. does not end a sentence', () => {
        expect(oneChunk('Files, dirs, etc. are handled.').length).toBe(1);
    });
    it('a numbered marker does not end a sentence', () => {
        expect(oneChunk('Step 1. Do the thing now.').length).toBe(1);
    });
    it('a real sentence end still splits', () => {
        expect(chunkAll('First one. Second one.', 12).length).toBe(2);
    });
});
// ---------------------------------------------------------------- T033 / T034
describe('T033 first chunk is the EARLIEST sentence end', () => {
    it('minimises time to first audio', () => {
        const text = 'Short. Then a considerably longer second sentence follows here.';
        const chunks = chunkAll(text, 200);
        expect(chunks[0].text).toBe('Short. ');
        expect(chunks[0].isFirst).toBe(true);
    });
    it('can be disabled, packing the first chunk greedily too', () => {
        const c = new Chunker({ maxUnits: 200, isolateFirstSentence: false });
        const chunks = [...c.addText('Short. Then a longer second sentence follows.'), ...c.finish()];
        expect(chunks.length).toBe(1);
    });
});
describe('T034 later chunks pack greedily to the LATEST boundary that fits', () => {
    it('packs several sentences into one chunk', () => {
        const text = 'A one. B two. C three. D four. E five.';
        const chunks = chunkAll(text, 30);
        expect(chunks[0].text).toBe('A one. '); // first is isolated
        expect(chunks[1].text.split('.').length - 1).toBeGreaterThan(1); // rest are packed
    });
});
// ---------------------------------------------------------------- T036
describe('T036 no deadlock', () => {
    it('a single word longer than the limit still makes progress', () => {
        const chunks = chunkAll('y'.repeat(300), 10);
        expect(chunks.length).toBeGreaterThan(1);
        expect(joinAll(chunks)).toBe('y'.repeat(300));
        for (const c of chunks)
            expect(c.text.length).toBeGreaterThan(0);
    });
    it('terminates on a limit of one unit', () => {
        const chunks = chunkAll('abc def', 1);
        expect(joinAll(chunks)).toBe('abc def');
    });
});
// ---------------------------------------------------------------- T038
describe('T038 the size limit is injected', () => {
    it('accepts a custom unit counter (tokens rather than characters)', () => {
        // Pretend every 4 characters is one token, as a local engine would count.
        const c = new Chunker({ maxUnits: 5, countUnits: (t) => Math.ceil(t.length / 4) });
        const chunks = [...c.addText('One two three four. Five six seven eight nine ten.'), ...c.finish()];
        expect(joinAll(chunks)).toBe('One two three four. Five six seven eight nine ten.');
        for (const ch of chunks)
            expect(Math.ceil(ch.text.length / 4)).toBeLessThanOrEqual(5 + 1);
    });
    it('defaults to counting characters', () => {
        const chunks = chunkAll('A short one. Another short one.', 16);
        for (const ch of chunks)
            expect(ch.text.length).toBeLessThanOrEqual(17);
    });
});
