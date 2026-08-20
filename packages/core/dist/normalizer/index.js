/**
 * Speech text normalizer.
 *
 * Turns an agent's markdown reply into text that sounds right when spoken.
 * Pure, synchronous, and DEPENDENCY-FREE — this module imports nothing, not even `node:`
 * builtins, so it runs identically in a plugin worker, a panel, a service, and a test.
 *
 * Stage order is load-bearing. Block constructs (fences, headings, lists, tables) are handled
 * while line structure still exists; whitespace is collapsed last.
 *
 * Ported from block/buzz `preprocess_for_tts` (docs/.research/prior-art-buzz.md), plus the four
 * constructs buzz does not handle: headings, lists, tables, file paths.
 */
const CODE_PLACEHOLDER = ' code block omitted ';
const LINK_PLACEHOLDER = 'link omitted';
export function normalize(md, opts = {}) {
    const codeBlocks = opts.codeBlocks ?? 'announce';
    const pathStyle = opts.pathStyle ?? 'basename';
    const doNumbers = opts.expandNumbers ?? true;
    let s = stripFencedCode(md, codeBlocks);
    s = stripInlineCode(s);
    s = expandMarkdownLinks(s);
    s = stripUrls(s);
    s = headingsToPauses(s);
    s = listItemsToSentences(s);
    s = tablesToRows(s);
    if (pathStyle === 'basename')
        s = speakFilePaths(s);
    s = stripMarkdownMarkers(s);
    s = stripEmoji(s);
    if (doNumbers)
        s = expandNumbers(s);
    s = collapseWhitespace(s);
    // "." or "," alone would be spoken as "period" / "comma". Say nothing instead.
    return s.length <= 1 ? '' : s;
}
/* ---------------------------------------------------------------- stage 1 */
function isFence(line) {
    const t = line.trimStart();
    return t.startsWith('```') || t.startsWith('~~~');
}
function stripFencedCode(src, policy) {
    const out = [];
    const lines = src.split('\n');
    let inFence = false;
    let announced = false;
    for (const line of lines) {
        if (isFence(line)) {
            if (!inFence) {
                inFence = true;
                announced = false;
                if (policy === 'announce') {
                    out.push(CODE_PLACEHOLDER);
                    announced = true;
                }
            }
            else {
                inFence = false;
            }
            continue;
        }
        if (!inFence)
            out.push(line);
    }
    // An unclosed fence swallows the remainder; the announcement already happened.
    void announced;
    return out.join('\n');
}
/* ---------------------------------------------------------------- stage 2 */
function stripInlineCode(src) {
    let out = '';
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        if (ch === '`') {
            const close = src.indexOf('`', i + 1);
            if (close === -1) {
                out += src.slice(i + 1);
                break;
            } // unclosed: emit remainder as-is
            out += src.slice(i + 1, close);
            i = close + 1;
            continue;
        }
        out += ch;
        i++;
    }
    return out;
}
/* ---------------------------------------------------------------- stage 3 */
/** `[label](url)` -> `label`. Runs before bare-URL stripping so the label survives. */
function expandMarkdownLinks(src) {
    let out = '';
    let i = 0;
    while (i < src.length) {
        if (src[i] === '[') {
            const close = src.indexOf('](', i);
            if (close !== -1) {
                const end = src.indexOf(')', close + 2);
                if (end !== -1) {
                    out += src.slice(i + 1, close);
                    i = end + 1;
                    continue;
                }
            }
        }
        out += src[i];
        i++;
    }
    return out;
}
const URL_TERMINATORS = new Set([')', ']', '"', "'", '<', '>']);
const TRAILING_PUNCT = new Set(['.', ',', '!', '?', ';', ':']);
function stripUrls(src) {
    let out = '';
    let i = 0;
    while (i < src.length) {
        const rest = src.slice(i);
        if (rest.startsWith('http://') || rest.startsWith('https://')) {
            let j = i;
            while (j < src.length) {
                const c = src[j];
                if (c === ' ' || c === '\n' || c === '\t' || URL_TERMINATORS.has(c))
                    break;
                j++;
            }
            // Give back trailing sentence punctuation — it belongs to the sentence, not the URL,
            // and downstream sentence splitting depends on it.
            let end = j;
            while (end > i && TRAILING_PUNCT.has(src[end - 1]))
                end--;
            out += LINK_PLACEHOLDER;
            i = end;
            continue;
        }
        out += src[i];
        i++;
    }
    return out;
}
/* ---------------------------------------------------------------- stages 4-6 */
const TERMINAL = new Set(['.', '!', '?']);
function endWithStop(text) {
    const t = text.trimEnd();
    if (t.length === 0)
        return '';
    return TERMINAL.has(t[t.length - 1]) ? t : `${t}.`;
}
function headingsToPauses(src) {
    return src.split('\n').map((line) => {
        const t = line.trimStart();
        if (!t.startsWith('#'))
            return line;
        let k = 0;
        while (k < t.length && t[k] === '#')
            k++;
        if (k > 6 || t[k] !== ' ')
            return line; // `#tag` / `C#` are not headings
        return endWithStop(t.slice(k + 1));
    }).join('\n');
}
function listMarkerLength(t) {
    if ((t.startsWith('- ') || t.startsWith('* ') || t.startsWith('+ ')))
        return 2;
    let k = 0;
    while (k < t.length && t[k] >= '0' && t[k] <= '9')
        k++;
    if (k > 0 && t[k] === '.' && t[k + 1] === ' ')
        return k + 2;
    return 0;
}
function listItemsToSentences(src) {
    return src.split('\n').map((line) => {
        const t = line.trimStart();
        const n = listMarkerLength(t);
        return n === 0 ? line : endWithStop(t.slice(n));
    }).join('\n');
}
function isTableSeparator(cells) {
    return cells.every((c) => c.length > 0 && /^[:\-\s]+$/.test(c));
}
function tablesToRows(src) {
    const out = [];
    for (const line of src.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('|')) {
            out.push(line);
            continue;
        }
        const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
        if (isTableSeparator(cells))
            continue; // `| --- | --- |` is layout, not content
        out.push(endWithStop(cells.filter((c) => c.length > 0).join(', ')));
    }
    return out.join('\n');
}
/* ---------------------------------------------------------------- stage 7 */
const WORD_BREAK = new Set([' ', '\n', '\t']);
/**
 * `src/core/main.ts` -> `main.ts in src/core`.
 * A listener wants to identify the file, not transcribe every separator.
 */
function speakFilePaths(src) {
    const tokens = [];
    let cur = '';
    for (const ch of src) {
        if (WORD_BREAK.has(ch)) {
            tokens.push(cur, ch);
            cur = '';
        }
        else
            cur += ch;
    }
    tokens.push(cur);
    return tokens.map((tok) => {
        if (tok.length === 0 || WORD_BREAK.has(tok))
            return tok;
        if (!tok.includes('/'))
            return tok;
        const slash = tok.lastIndexOf('/');
        const base = tok.slice(slash + 1);
        const dir = tok.slice(0, slash);
        if (base.length === 0 || dir.length === 0)
            return tok;
        if (!base.includes('.'))
            return tok; // not a file reference
        return `${base} in ${dir}`;
    }).join('');
}
/* ---------------------------------------------------------------- stage 8 */
function isBoundaryBefore(prev) {
    return prev === undefined || WORD_BREAK.has(prev) || prev === '(' || prev === '"';
}
function isBoundaryAfter(next) {
    return next === undefined || WORD_BREAK.has(next) || TRAILING_PUNCT.has(next) || next === ')' || next === '"';
}
/**
 * `**bold**` and `~~strike~~` markers are deleted outright.
 *
 * Single `*` / `_` are deleted only as a MATCHED PAIR that wraps a word, so `snake_case`,
 * `a_b_c` and — critically — a leading-underscore identifier like `_flush_buffer` all survive.
 *
 * Pairing is the whole point. An earlier version stripped any underscore that merely *looked*
 * like an opener, which silently turned `_private_method` into `private_method`: a lone opener
 * with no partner. Python privates are everywhere in agent replies, so this mattered.
 *
 * DELIBERATE DEVIATION from buzz: `__dunder__` is PRESERVED. buzz strips `__x__` as bold, but it
 * is lexically indistinguishable from a dunder, and mangling `__init__` is worse than reading two
 * underscores in the rarer `__bold__`.
 */
function stripMarkdownMarkers(src) {
    let s = src.split('**').join('');
    s = s.split('~~').join('');
    const chars = [...s];
    const drop = new Set();
    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        if (ch !== '*' && ch !== '_')
            continue;
        if (drop.has(i))
            continue;
        if (ch === '_' && (chars[i + 1] === '_' || chars[i - 1] === '_'))
            continue; // dunder
        const opens = isBoundaryBefore(chars[i - 1]) && !isBoundaryAfter(chars[i + 1]);
        if (!opens)
            continue;
        // Only strip if a matching closer exists before the next line break.
        for (let j = i + 1; j < chars.length; j++) {
            const c = chars[j];
            if (c === '\n')
                break;
            if (c !== ch)
                continue;
            if (ch === '_' && (chars[j + 1] === '_' || chars[j - 1] === '_'))
                continue;
            const closes = !isBoundaryBefore(chars[j - 1]) && isBoundaryAfter(chars[j + 1]);
            if (closes) {
                drop.add(i);
                drop.add(j);
                break;
            }
        }
    }
    return chars.filter((_, i) => !drop.has(i)).join('');
}
/* ---------------------------------------------------------------- stage 9 */
function isEmoji(cp) {
    return ((cp >= 0x1f300 && cp <= 0x1faff) ||
        (cp >= 0x2600 && cp <= 0x27bf) ||
        (cp >= 0x1f000 && cp <= 0x1f0ff) ||
        cp === 0x200d || // ZWJ
        (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors
        cp === 0x20e3 // keycap
    );
}
function stripEmoji(src) {
    let out = '';
    for (const ch of src) {
        const cp = ch.codePointAt(0);
        if (cp !== undefined && isEmoji(cp))
            continue;
        out += ch;
    }
    return out;
}
/* ---------------------------------------------------------------- stage 10 */
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
    'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function under100(n) {
    if (n < 20)
        return ONES[n];
    const t = TENS[Math.floor(n / 10)];
    const r = n % 10;
    return r === 0 ? t : `${t} ${ONES[r]}`;
}
function under1000(n) {
    if (n < 100)
        return under100(n);
    const h = `${ONES[Math.floor(n / 100)]} hundred`;
    const r = n % 100;
    return r === 0 ? h : `${h} ${under100(r)}`;
}
/** 0..999999 to words. Larger numbers are left for the engine, which handles them better. */
export function numberToWords(n) {
    if (n < 1000)
        return under1000(n);
    const th = Math.floor(n / 1000);
    const r = n % 1000;
    const head = `${under1000(th)} thousand`;
    return r === 0 ? head : `${head} ${under1000(r)}`;
}
function spokenTime(h, m) {
    const hh = under100(h);
    if (m === 0)
        return hh;
    if (m < 10)
        return `${hh} oh ${ONES[m]}`;
    return `${hh} ${under100(m)}`;
}
function isDigit(c) {
    return c !== undefined && c >= '0' && c <= '9';
}
function expandNumbers(src) {
    let out = '';
    let i = 0;
    while (i < src.length) {
        if (!isDigit(src[i])) {
            out += src[i];
            i++;
            continue;
        }
        let j = i;
        while (isDigit(src[j]))
            j++;
        const digits = src.slice(i, j);
        // HH:MM
        if (src[j] === ':' && isDigit(src[j + 1])) {
            let k = j + 1;
            while (isDigit(src[k]))
                k++;
            const mins = src.slice(j + 1, k);
            const h = Number(digits);
            const m = Number(mins);
            if (mins.length === 2 && h < 24 && m < 60) {
                out += spokenTime(h, m);
                i = k;
                continue;
            }
        }
        // Decimals go to the engine untouched — and the WHOLE decimal must be consumed here,
        // or the fractional part gets re-scanned and expanded ("3.14" -> "3.fourteen").
        if (src[j] === '.' && isDigit(src[j + 1])) {
            let k = j + 1;
            while (isDigit(src[k]))
                k++;
            out += src.slice(i, k);
            i = k;
            continue;
        }
        // "#42" is a reference, not a quantity. Speak the numerals.
        if (src[i - 1] === '#') {
            out += digits;
            i = j;
            continue;
        }
        const value = Number(digits);
        if (value >= 1_000_000 || digits.length > 6) {
            out += digits;
            i = j;
            continue;
        }
        out += numberToWords(value);
        i = j;
    }
    return out;
}
/* ---------------------------------------------------------------- stage 11 */
function collapseWhitespace(src) {
    let out = '';
    let pendingSpace = false;
    for (const ch of src) {
        if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') {
            pendingSpace = out.length > 0;
            continue;
        }
        if (pendingSpace) {
            out += ' ';
            pendingSpace = false;
        }
        out += ch;
    }
    return out;
}
