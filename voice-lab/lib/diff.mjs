// Word-level, stage-attributed diff — docs/design/004-voice-lab.md section 4 (Q24).
//
// Word-level, not character-level, and the reason is in the document: `session_handler.py` ->
// `session handler, python` diffs into a dozen character fragments that carry no meaning to a
// dyslexic reader. Word-level with no attribution tells you WHAT changed and leaves you guessing
// WHICH CONTROL TO TURN. So every changed span carries the stage that produced it, and the page
// turns that into the control that governs it.
//
// 004 specifies the output of `POST /normalize` (`{spoken, stages:[{n,name,text}]}`) and says
// "the page computes the word diff locally" — but it never says how a span in the FINAL spoken
// text is traced back to the stage that made it, given fifteen successive rewrites. The answer
// implemented here is a forward provenance pass: diff each stage against the one before it, and
// carry each surviving token's origin forward across the alignment. A token that is aligned is
// inherited; a token that is an insertion belongs to the stage that inserted it. After fifteen
// passes every token of the spoken text names its author, and `stage 0` means "this word came
// through untouched from what you wrote".
//
// No diff library, by design: the page is CDN-free and this is ~60 lines.
//
// This module is inlined verbatim into index.html; voice-lab/lib/inline.test.mjs fails if the
// two copies drift.

/** Split into whitespace-delimited tokens, keeping each one's offsets into the source string. */
export function tokenize (text) {
  const out = []
  const re = /\S+/g
  let m
  while ((m = re.exec(text)) !== null) {
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length })
  }
  return out
}

/**
 * Longest common subsequence over token text. Returns aligned index pairs [ai, bi], ascending.
 * Classic dynamic programme — quadratic, which is correct for the few hundred tokens a fixture has.
 */
export function lcsPairs (a, b) {
  const n = a.length
  const m = b.length
  // Row-major (n+1) x (m+1) table of common-length.
  const dp = new Uint32Array((n + 1) * (m + 1))
  const at = (i, j) => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = a[i] === b[j]
        ? dp[at(i + 1, j + 1)] + 1
        : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)])
    }
  }
  const pairs = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++ } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) i++
    else j++
  }
  return pairs
}

/**
 * A word diff of two strings, as a flat op list.
 * ops: {type: 'same'|'add'|'del', text, start, end} — offsets are into whichever side owns the op.
 */
export function wordDiff (before, after) {
  const A = tokenize(before)
  const B = tokenize(after)
  const pairs = lcsPairs(A.map((t) => t.text), B.map((t) => t.text))
  const ops = []
  let i = 0
  let j = 0
  const flushDel = (upto) => { while (i < upto) { ops.push({ type: 'del', ...A[i] }); i++ } }
  const flushAdd = (upto) => { while (j < upto) { ops.push({ type: 'add', ...B[j] }); j++ } }
  for (const [ai, bi] of pairs) {
    flushDel(ai)
    flushAdd(bi)
    ops.push({ type: 'same', ...B[j] })
    i++
    j++
  }
  flushDel(A.length)
  flushAdd(B.length)
  return ops
}

/**
 * Trace every token of the final text back to the stage that produced it.
 *
 * @param {string} source        the text as written
 * @param {{n:number, name:string, text:string}[]} stages  fifteen stage outputs, in order
 * @returns {{
 *   spoken: {text:string,start:number,end:number,stage:number,stageName:string|null}[],
 *   removed: {text:string,start:number,end:number,stage:number,stageName:string|null}[]
 * }}
 *   `stage: 0` on a spoken token means it came through untouched from the source.
 *   `removed` are source tokens that no stage carried forward, each naming the stage that dropped it.
 */
export function attribute (source, stages) {
  let prevTokens = tokenize(source)
  // Provenance of each token of the CURRENT stage output: 0 = came from the source untouched.
  let origin = prevTokens.map(() => 0)
  // Provenance of each SOURCE token: null while it survives, else the stage that dropped it.
  const sourceIndexOf = prevTokens.map((_, k) => k)
  const removedAt = prevTokens.map(() => null)
  let traceToSource = sourceIndexOf.slice()

  for (const stage of stages) {
    const nextTokens = tokenize(stage.text)
    const pairs = lcsPairs(prevTokens.map((t) => t.text), nextTokens.map((t) => t.text))
    const nextOrigin = new Array(nextTokens.length).fill(stage.n)
    const nextTrace = new Array(nextTokens.length).fill(-1)
    const survived = new Array(prevTokens.length).fill(false)
    for (const [pi, ni] of pairs) {
      nextOrigin[ni] = origin[pi]
      nextTrace[ni] = traceToSource[pi]
      survived[pi] = true
    }
    for (let k = 0; k < prevTokens.length; k++) {
      const src = traceToSource[k]
      if (!survived[k] && src >= 0 && removedAt[src] === null) removedAt[src] = stage.n
    }
    prevTokens = nextTokens
    origin = nextOrigin
    traceToSource = nextTrace
  }

  const nameOf = (n) => stages.find((s) => s.n === n)?.name ?? null
  const spoken = prevTokens.map((t, k) => ({
    text: t.text, start: t.start, end: t.end, stage: origin[k], stageName: nameOf(origin[k])
  }))
  const sourceTokens = tokenize(source)
  const removed = []
  for (let k = 0; k < sourceTokens.length; k++) {
    if (removedAt[k] !== null) {
      removed.push({ ...sourceTokens[k], stage: removedAt[k], stageName: nameOf(removedAt[k]) })
    }
  }
  return { spoken, removed }
}
