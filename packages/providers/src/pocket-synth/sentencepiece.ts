/**
 * A minimal SentencePiece **unigram** encoder, for Pocket TTS's `tokenizer.model`.
 *
 * Hand-rolled rather than depended upon, because the plugin ships to third parties (R3) and every
 * native or transitive dependency is a platform-parity risk (R1). That trade is only defensible
 * because this bundle's tokenizer is the easy case, and the proto says so in writing:
 *
 *     model_type          UNIGRAM
 *     normalizer          "identity", precompiled_charsmap 0 bytes   <- no NFKC table to port
 *     add_dummy_prefix    true      escape_whitespaces true      remove_extra_whitespaces false
 *     byte_fallback       true      unk_id 0
 *     4000 pieces: 1 unknown, 3 control, 256 byte, 3740 normal
 *
 * So the whole encoder is: escape whitespace, Viterbi over the piece scores, UTF-8 byte fallback.
 *
 * **This file is only trustworthy because of `sentencepiece.test.ts`,** which checks it id-for-id
 * against vectors produced by the real Python `sentencepiece`. A tokenizer that is 99 % right does
 * not fail loudly — it produces speech that is subtly wrong in a way nobody can debug by ear.
 *
 * Attribution: the vocabulary in `model/tokenizer.model` is Kyutai's, CC-BY-4.0, via the ONNX
 * export `KevinAHM/pocket-tts-onnx`. `model/LICENSE` travels with it.
 */

/** U+2581 LOWER ONE EIGHTH BLOCK — SentencePiece's space marker. */
const SPACE = '▁'

/**
 * SentencePiece piece types, from `sentencepiece_model.proto`.
 *
 * A plain frozen object, NOT a `const enum`. Node's strip-only type stripping rejects `const enum`
 * outright — it is the one TypeScript construct that is not erasable — and this file is loaded
 * from plain node by `scripts/pocket-e2e.mjs` and by the Voice Lab server. PITFALLS **P37** is the
 * same species: vitest resolves and compiles things the resolver that actually SHIPS does not, so
 * a suite can be green over a tree that cannot boot. Caught here by running the oracle under plain
 * node, which is exactly why it runs there.
 */
const PieceType = {
  NORMAL: 1,
  UNKNOWN: 2,
  CONTROL: 3,
  USER_DEFINED: 4,
  BYTE: 6,
} as const

export interface Piece {
  readonly piece: string
  readonly score: number
  readonly type: number
}

/* ------------------------------------------------------------- just enough protobuf wire format */

function readVarint(buf: Uint8Array, pos: number): [bigint, number] {
  let result = 0n
  let shift = 0n
  for (;;) {
    const byte = buf[pos++]
    if (byte === undefined) throw new Error('truncated varint')
    result |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) break
    shift += 7n
    if (shift > 63n) throw new Error('varint longer than 64 bits')
  }
  return [result, pos]
}

function skipField(buf: Uint8Array, pos: number, wireType: number): number {
  switch (wireType) {
    case 0: return readVarint(buf, pos)[1]
    case 1: return pos + 8
    case 2: { const [len, p] = readVarint(buf, pos); return p + Number(len) }
    case 5: return pos + 4
    default: throw new Error(`unsupported protobuf wire type ${wireType}`)
  }
}

function parsePiece(buf: Buffer, start: number, end: number): Piece {
  let pos = start
  let piece = ''
  let score = 0
  let type: number = PieceType.NORMAL
  while (pos < end) {
    const [key, p] = readVarint(buf, pos)
    pos = p
    const field = Number(key >> 3n)
    const wire = Number(key & 7n)
    if (field === 1 && wire === 2) {
      const [len, q] = readVarint(buf, pos)
      piece = buf.toString('utf8', q, q + Number(len))
      pos = q + Number(len)
    } else if (field === 2 && wire === 5) {
      score = buf.readFloatLE(pos)
      pos += 4
    } else if (field === 3 && wire === 0) {
      const [v, q] = readVarint(buf, pos)
      type = Number(v)
      pos = q
    } else {
      pos = skipField(buf, pos, wire)
    }
  }
  return { piece, score, type }
}

/**
 * Read `ModelProto.pieces` and nothing else.
 *
 * Everything outside field 1 — the trainer spec, the normalizer spec, the self-test data — is
 * skipped by wire type. That is deliberate: we assert the specs we rely on in a test rather than
 * parsing them, so this reader stays 60 lines and the assertions stay readable.
 */
export function parseModelProto(buf: Buffer): Piece[] {
  const pieces: Piece[] = []
  let pos = 0
  while (pos < buf.length) {
    const [key, p] = readVarint(buf, pos)
    pos = p
    const field = Number(key >> 3n)
    const wire = Number(key & 7n)
    if (field === 1 && wire === 2) {
      const [len, q] = readVarint(buf, pos)
      pieces.push(parsePiece(buf, q, q + Number(len)))
      pos = q + Number(len)
    } else {
      pos = skipField(buf, pos, wire)
    }
  }
  return pieces
}

/* ------------------------------------------------------------------------------- the encoder */

export class SentencePieceUnigram {
  readonly pieces: readonly Piece[]
  readonly byId: readonly string[]
  readonly unkId: number
  readonly #byteId: Int32Array
  readonly #usable: Map<string, { id: number, score: number }>
  readonly #maxPieceLen: number
  readonly #unkPenalty: number

  constructor(pieces: readonly Piece[]) {
    this.pieces = pieces
    this.byId = pieces.map((p) => p.piece)
    this.unkId = Math.max(0, pieces.findIndex((p) => p.type === PieceType.UNKNOWN))

    // Byte pieces spell themselves: `<0x41>` stands for the byte 0x41.
    this.#byteId = new Int32Array(256).fill(-1)
    for (const [i, p] of pieces.entries()) {
      if (p.type !== PieceType.BYTE) continue
      const m = /^<0x([0-9A-Fa-f]{2})>$/.exec(p.piece)
      if (m?.[1] !== undefined) this.#byteId[Number.parseInt(m[1], 16)] = i
    }

    // Control, unknown and byte pieces are excluded from the lattice: SentencePiece marks them
    // "unused" precisely so that ordinary text can never match them. A `</s>` produced by matching
    // the literal characters would be a control token smuggled into a caption.
    this.#usable = new Map()
    let maxLen = 0
    for (const [i, p] of pieces.entries()) {
      if (p.type === PieceType.CONTROL || p.type === PieceType.UNKNOWN || p.type === PieceType.BYTE) continue
      if (!this.#usable.has(p.piece)) this.#usable.set(p.piece, { id: i, score: p.score })
      maxLen = Math.max(maxLen, [...p.piece].length)
    }
    this.#maxPieceLen = maxLen

    // SentencePiece scores an unknown symbol at (min score - 10). Matching that constant matters:
    // it is what makes byte fallback lose to any real piece that covers the same span.
    const normals = pieces.filter((p) => p.type === PieceType.NORMAL).map((p) => p.score)
    this.#unkPenalty = (normals.length > 0 ? Math.min(...normals) : 0) - 10
  }

  static fromBuffer(buf: Buffer): SentencePieceUnigram {
    return new SentencePieceUnigram(parseModelProto(buf))
  }

  /** `add_dummy_prefix` then `escape_whitespaces`, exactly as this bundle's proto declares them. */
  normalize(text: string): string {
    return (' ' + text).replaceAll(' ', SPACE)
  }

  /** `noUncheckedIndexedAccess` is on: reads past the end are a real possibility, not a formality. */
  #charAt(chars: readonly string[], i: number): string {
    const c = chars[i]
    if (c === undefined) throw new Error(`tokenizer read past the end of the input at ${i}`)
    return c
  }

  /**
   * Viterbi over code points, maximising the summed piece score.
   *
   * Two details are load-bearing and both were settled by the oracle rather than by reasoning:
   *
   *  - **empty input is empty output.** The dummy prefix would otherwise make `''` encode to
   *    `[▁]`, which is one spurious token of silence at the head of every empty utterance.
   *  - **byte fallback is offered at every position**, not only where nothing matched. A code
   *    point that has its own piece can still be cheaper as bytes in an unusual context, and the
   *    reference lattice offers both paths.
   */
  /**
   * Encode, as SentencePiece's lattice does it.
   *
   * **This is a faithful port, not an equivalent algorithm, and the difference was measurable.**
   * The first version was an ordinary Viterbi keeping one best score per position with float64
   * accumulation. It agreed with upstream on 11,327 of 11,344 inputs and disagreed on runs of a
   * repeated letter — `Zccc` came out `['▁Z','c','cc']` against upstream's `['▁Z','cc','c']`
   * (R14-04). Two theories were tested and both were WRONG: flipping `>` to `>=` moved the count
   * to 21 in the opposite direction, and `c + cc === cc + c` in both float64 and float32 so it
   * looked like it could not be precision.
   *
   * What the probe actually showed is that upstream's answer is not consistent even between
   * letters — `Zbbb` is `['▁Z','b','bb']` while `Zccc` is `['▁Z','cc','c']`. No tie-break rule
   * produces both. What produces both is **float32 accumulation**, where the ORDER of additions
   * changes the sum: `(B + b) + bb` and `(B + bb) + b` are not the same float32 number even though
   * `b + bb === bb + b`. The isolated comparison that seemed to rule precision out was measuring
   * the wrong thing.
   *
   * So, exactly as `lattice.cc` does it:
   *
   *  - every candidate piece is a NODE with its own best predecessor and its own backtrace score,
   *    rather than one best score per position;
   *  - for each node starting at `pos`, the best node ENDING at `pos` is chosen, with the first
   *    one encountered winning a tie;
   *  - and every addition is rounded to float32 by `Math.fround`, because the reference stores and
   *    accumulates `float`.
   */
  encode(text: string): number[] {
    if (text === '') return []
    const chars = [...this.normalize(text)]
    const n = chars.length
    if (n === 0) return []

    interface Node {
      readonly begin: number
      readonly end: number
      readonly id: number
      readonly score: number
      /** Several ids when this node is a byte-fallback expansion of one character. */
      readonly ids: readonly number[]
      prev: Node | null
      backtrace: number
    }

    const beginNodes: Node[][] = Array.from({ length: n + 1 }, () => [])
    const endNodes: Node[][] = Array.from({ length: n + 1 }, () => [])
    const insert = (node: Node): void => {
      beginNodes[node.begin]?.push(node)
      endNodes[node.end]?.push(node)
    }

    // Populate, begin position ascending and piece length ascending within each — the order the
    // reference's trie walk produces, and the order that decides every tie below.
    for (let i = 0; i < n; i++) {
      const limit = Math.min(this.#maxPieceLen, n - i)
      let candidate = ''
      let hasSingleChar = false
      for (let len = 1; len <= limit; len++) {
        candidate += this.#charAt(chars, i + len - 1)
        const hit = this.#usable.get(candidate)
        if (hit === undefined) continue
        if (len === 1) hasSingleChar = true
        insert({
          begin: i, end: i + len, id: hit.id, ids: [hit.id],
          score: Math.fround(hit.score), prev: null, backtrace: 0,
        })
      }
      // AFTER the matches, not before, exactly as `PopulateNodes` does it — and only when no
      // single-character piece matched, which is the reference's `has_single_node`. Insertion
      // order IS the tie-break, so putting this first silently changes which segmentation wins.
      if (!hasSingleChar) {
        const one = this.#charAt(chars, i)
        const bytes = Buffer.from(one, 'utf8')
        const ids: number[] = []
        for (const b of bytes) {
          const id = this.#byteId[b] ?? -1
          ids.push(id >= 0 ? id : this.unkId)
        }
        insert({
          begin: i, end: i + 1, id: ids[0] ?? this.unkId, ids,
          score: Math.fround(this.#unkPenalty * bytes.length), prev: null, backtrace: 0,
        })
      }
    }

    // The forward pass. `begin === 0` has no predecessor and starts at zero, which is what the
    // reference's BOS node provides.
    for (let pos = 0; pos <= n; pos++) {
      for (const rnode of beginNodes[pos] ?? []) {
        if (pos === 0) { rnode.prev = null; rnode.backtrace = rnode.score; continue }
        let best: Node | null = null
        let bestScore = 0
        for (const lnode of endNodes[pos] ?? []) {
          const score = Math.fround(lnode.backtrace + rnode.score)
          if (best === null || score > bestScore) { best = lnode; bestScore = score }
        }
        rnode.prev = best
        rnode.backtrace = best === null ? Number.NEGATIVE_INFINITY : bestScore
      }
    }

    // Pick the best node ending at the end, then walk back. Same tie rule as above.
    let tail: Node | null = null
    let tailScore = 0
    for (const lnode of endNodes[n] ?? []) {
      if (tail === null || lnode.backtrace > tailScore) { tail = lnode; tailScore = lnode.backtrace }
    }
    if (tail === null) throw new Error('no path through the tokenizer lattice')

    const out: number[] = []
    for (let node: Node | null = tail; node !== null; node = node.prev) {
      for (let k = node.ids.length - 1; k >= 0; k--) out.push(node.ids[k] ?? this.unkId)
    }
    return out.reverse()
  }

  /**
   * Ids back to text.
   *
   * Byte pieces must be reassembled as BYTES, not concatenated as the literal string `<0x2F>`.
   * Encoding `src/core/…` produces `<0x2F>` for each slash, so a naive decode turns a file path
   * into `src<0x2F>core<0x2F>…` — and chunk splitting decodes id ranges back to text before
   * re-encoding them, which means the corruption would reach the synthesizer as real words.
   * Caught by the round-trip case, which is why it is a test and not a comment.
   */
  decode(ids: readonly number[]): string {
    const out: Buffer[] = []
    let pending: number[] = []
    const flush = (): void => {
      if (pending.length === 0) return
      out.push(Buffer.from(pending))
      pending = []
    }
    for (const id of ids) {
      const piece = this.byId[id]
      if (piece === undefined) continue
      if (this.pieces[id]?.type === PieceType.BYTE) {
        const m = /^<0x([0-9A-Fa-f]{2})>$/.exec(piece)
        if (m?.[1] !== undefined) { pending.push(Number.parseInt(m[1], 16)); continue }
      }
      flush()
      out.push(Buffer.from(piece, 'utf8'))
    }
    flush()
    return Buffer.concat(out).toString('utf8').replaceAll(SPACE, ' ').replace(/^ /, '')
  }
}
