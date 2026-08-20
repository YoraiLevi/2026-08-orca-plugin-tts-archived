/**
 * Streaming sentence chunker.
 *
 * Turns an incrementally-arriving reply into utterances a synthesizer can speak without
 * sounding choppy. Pure, DEPENDENCY-FREE, and incremental: `addText()` may be called with
 * arbitrary fragments and must produce exactly what the whole string would have produced.
 *
 * Algorithm ported from block/buzz `pocket_april.rs` (docs/.research/prior-art-buzz.md,
 * "Streaming chunker"), with buzz's SentencePiece token counter replaced by an injected
 * unit counter so local (token-budget) and cloud (character-budget) engines share one splitter.
 *
 * Two policies over ONE splitter, switched by a single flag:
 *   - first chunk  -> the EARLIEST sentence end   (minimum time to first audio)
 *   - later chunks -> the LATEST boundary that fits (fewest synthesis calls, best prosody)
 *
 * Invariant: `chunks.join('') === input`, exactly. Trailing whitespace travels with its chunk.
 */
/** Terminal punctuation that may end a sentence, once closing quotes/brackets are skipped. */
const SENTENCE_END = new Set(['.', '!', '?']);
const CLAUSE_END = new Set([',', ';', ':', '—', '–']);
const CLOSERS = new Set([')', ']', '}', '"', "'", '”', '’']);
const SPACE = new Set([' ', '\n', '\t', '\r']);
/**
 * Tokens whose trailing '.' is not a sentence end. Compared case-insensitively against the
 * word immediately preceding the period.
 */
const ABBREVIATIONS = new Set([
    'e.g', 'i.e', 'etc', 'vs', 'cf', 'al', 'approx', 'est',
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st',
    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
    'fig', 'no', 'vol', 'pp', 'ed'
]);
const DEFAULT_MAX_UNITS = 200;
export class Chunker {
    #maxUnits;
    #countUnits;
    #isolateFirst;
    #buffer = '';
    #emittedAny = false;
    constructor(opts = {}) {
        this.#maxUnits = Math.max(1, opts.maxUnits ?? DEFAULT_MAX_UNITS);
        this.#countUnits = opts.countUnits ?? ((t) => t.length);
        this.#isolateFirst = opts.isolateFirstSentence ?? true;
    }
    /** Feed more text. Returns whatever chunks are now complete. */
    addText(text) {
        this.#buffer += text;
        return this.#drain(false);
    }
    /** End of utterance: flush whatever remains. */
    finish() {
        const out = this.#drain(true);
        if (this.#buffer.length > 0) {
            out.push({ text: this.#buffer, boundary: 'end', isFirst: !this.#emittedAny });
            this.#emittedAny = true;
            this.#buffer = '';
        }
        return out;
    }
    /** Discard buffered text without emitting it (barge-in). */
    reset() {
        this.#buffer = '';
        this.#emittedAny = false;
    }
    #drain(final) {
        const out = [];
        for (;;) {
            const cut = this.#findCut(final);
            if (cut === null)
                break;
            const text = this.#buffer.slice(0, cut.index);
            if (text.length === 0)
                break;
            this.#buffer = this.#buffer.slice(cut.index);
            out.push({ text, boundary: cut.kind, isFirst: !this.#emittedAny });
            this.#emittedAny = true;
        }
        return out;
    }
    /**
     * Scan candidate boundaries in order, remembering the best of each kind that still fits.
     * Stops at the first candidate that overflows: unit cost is monotonic in prefix length, so
     * nothing longer can fit. (buzz notes this scan was originally superlinear and the cost landed
     * BEFORE first audio — a latency bug, not a throughput bug.)
     */
    #findCut(final) {
        const buf = this.#buffer;
        if (buf.length === 0)
            return null;
        const wantEarliestSentence = this.#isolateFirst && !this.#emittedAny;
        let firstSentence = -1;
        let lastSentence = -1;
        let lastClause = -1;
        let lastWord = -1;
        let lastFitting = -1;
        let overflowed = false;
        for (let i = 0; i < buf.length; i++) {
            const end = i + 1;
            if (this.#countUnits(buf.slice(0, end)) > this.#maxUnits) {
                overflowed = true;
                break;
            }
            lastFitting = end;
            const ch = buf[i];
            if (SENTENCE_END.has(ch)) {
                const after = this.#skipClosers(i + 1);
                if (this.#isSentenceEnd(i, after)) {
                    const cut = this.#absorbSpaces(after);
                    if (cut <= buf.length && this.#countUnits(buf.slice(0, cut)) <= this.#maxUnits) {
                        if (firstSentence === -1)
                            firstSentence = cut;
                        lastSentence = cut;
                        // The earliest sentence end is all the first chunk needs; stop scanning.
                        if (wantEarliestSentence && this.#complete(cut, final))
                            break;
                    }
                }
            }
            else if (CLAUSE_END.has(ch)) {
                const cut = this.#absorbSpaces(i + 1);
                if (this.#countUnits(buf.slice(0, cut)) <= this.#maxUnits)
                    lastClause = cut;
            }
            else if (SPACE.has(ch)) {
                const cut = this.#absorbSpaces(i);
                if (cut > 0 && this.#countUnits(buf.slice(0, cut)) <= this.#maxUnits)
                    lastWord = cut;
            }
        }
        // Streaming must agree with batch exactly (T035), and that constrains WHEN we may emit.
        //
        // The first chunk wants the EARLIEST sentence end, which is knowable the moment that sentence
        // completes — batch would pick the same one. Emit immediately; this is the latency win.
        //
        // Every later chunk wants the LATEST boundary that fits. That is NOT knowable while more text
        // may still arrive: a sentence end we can see now might be beaten by another one that also
        // fits. So we wait until the buffer overflows the limit — at which point no further boundary
        // can join this chunk and our answer provably equals batch's.
        if (!final) {
            if (wantEarliestSentence && firstSentence !== -1 && this.#complete(firstSentence, final)) {
                return { index: firstSentence, kind: 'sentence' };
            }
            if (!overflowed)
                return null;
        }
        else {
            const sentence = wantEarliestSentence ? firstSentence : lastSentence;
            if (sentence !== -1)
                return { index: sentence, kind: 'sentence' };
            if (!overflowed)
                return null; // everything fits; finish() flushes the tail
        }
        if (lastSentence > 0)
            return { index: lastSentence, kind: 'sentence' };
        if (lastClause > 0)
            return { index: lastClause, kind: 'clause' };
        if (lastWord > 0)
            return { index: lastWord, kind: 'word' };
        if (lastFitting > 0)
            return { index: lastFitting, kind: 'scalar' };
        return { index: 1, kind: 'scalar' };
    }
    /**
     * A boundary is only safe to emit mid-stream once we can see a non-space character after it,
     * or the stream has ended. Otherwise a later fragment could extend the token (`e.g` -> `e.g.`)
     * and streaming would disagree with batch.
     */
    #complete(cut, final) {
        if (final)
            return true;
        return cut < this.#buffer.length;
    }
    #skipClosers(from) {
        let i = from;
        while (i < this.#buffer.length && CLOSERS.has(this.#buffer[i]))
            i++;
        return i;
    }
    #absorbSpaces(from) {
        let i = from;
        while (i < this.#buffer.length && SPACE.has(this.#buffer[i]))
            i++;
        return i;
    }
    /** Is the '.' at `dot` a real sentence end, given the next non-closer is at `after`? */
    #isSentenceEnd(dot, after) {
        const buf = this.#buffer;
        if (buf[dot] !== '.')
            return true; // '!' and '?' are never abbreviations
        // A period followed immediately by a digit is a decimal or a version, not an end.
        if (isDigit(buf[after]))
            return false;
        // Walk back over the token that owns this period.
        let start = dot;
        while (start > 0 && !SPACE.has(buf[start - 1]))
            start--;
        const token = buf.slice(start, dot).toLowerCase();
        if (ABBREVIATIONS.has(token))
            return false;
        // "e.g." style: the token itself contains internal periods.
        if (token.includes('.'))
            return false;
        // A bare numeral before the period is a list marker: "Step 1. Do the thing".
        if (token.length > 0 && [...token].every((c) => c >= '0' && c <= '9'))
            return false;
        // A single capital letter is an initial: "J. Smith".
        if (token.length === 1 && token !== token.toUpperCase())
            return false;
        return true;
    }
}
function isDigit(c) {
    return c !== undefined && c >= '0' && c <= '9';
}
