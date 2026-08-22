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
   * Encode as Python `sentencepiece.SentencePieceProcessor.Encode` does it.
   *
   * **That is `Model::EncodeOptimized`, not `Lattice::Viterbi`, and the difference was
   * measurable.** `d6f6c80` ported the lattice: one node per candidate, first-wins among
   * `end_nodes_` on a float32 tie. That took an 11,344-input corpus from 17 disagreements to 1
   * (`Zggggg`). Round 16 then found seven more of the same class on a 728-input `Xyyyyy` grid —
   * the lattice remainder is not a singleton, and Python never ran Viterbi for `Encode()` at all.
   *
   * `EncodeOptimized` (unigram_model.cc) keeps **one best path ending at each position**. For
   * each start it walks matching pieces shortest-first and replaces the path ending at
   * `start + length` only when `starts_at == -1` (first to arrive) or the candidate score is
   * strictly greater. Ties therefore go to the earlier start — the longer piece — which is the
   * opposite of "first node in `end_nodes_`". `>` and `>=` on the lattice have both been
   * measured (17 and 21 disagreements, opposite directions) and are not this fix.
   *
   * Two other details are load-bearing and both were settled by the oracle rather than by
   * reasoning:
   *
   *  - **empty input is empty output.** The dummy prefix would otherwise make `''` encode to
   *    `[▁]`, which is one spurious token of silence at the head of every empty utterance.
   *  - **byte fallback is a post-process of UNK**, not a lattice alternative scored per byte.
   *    Unknown characters are one UNK node at `min_score - 10`; the processor then emits one
   *    byte piece per UTF-8 byte. Scoring `unk * nbytes` in the lattice is a different path.
   */
  encode(text: string): number[] {
    if (text === '') return []
    const chars = [...this.normalize(text)]
    const n = chars.length
    if (n === 0) return []

    interface Best {
      /** Several ids when this node is a byte-fallback expansion of one character. */
      ids: readonly number[]
      score: number
      startsAt: number
    }

    // BOS lives at index 0 with score 0 and `startsAt === -1`, matching EncodeOptimized's
    // default `BestPathNode`. Every later index is filled left-to-right; a single-character
    // piece or an UNK node always advances by one, so no position is skipped.
    const best: Best[] = Array.from({ length: n + 1 }, () => ({
      ids: [], score: 0, startsAt: -1,
    }))

    // EncodeOptimized rescales when the running score would overflow a float. TTS captions
    // never reach ±1e5, but omitting it is a second algorithm, not a simplification.
    const kScoreResetThreshold = 100000
    let maxFrontier = 0
    for (let startsAt = 0; startsAt < n; startsAt++) {
      const here = best[startsAt]
      if (here === undefined) throw new Error(`tokenizer read past the end of the input at ${startsAt}`)
      let till = here.score
      if (till < -kScoreResetThreshold || till > kScoreResetThreshold) {
        const offset = till
        for (let i = startsAt; i <= maxFrontier; i++) {
          const node = best[i]
          if (node !== undefined && (i === startsAt || node.startsAt !== -1)) {
            node.score = Math.fround(node.score - offset)
          }
        }
        till = 0
      }

      let hasSingleChar = false
      const limit = Math.min(this.#maxPieceLen, n - startsAt)
      let candidate = ''
      for (let len = 1; len <= limit; len++) {
        candidate += this.#charAt(chars, startsAt + len - 1)
        const hit = this.#usable.get(candidate)
        if (hit === undefined) continue
        maxFrontier = Math.max(maxFrontier, startsAt + len)
        const candScore = Math.fround(hit.score + till)
        const target = best[startsAt + len]
        if (target === undefined) continue
        // First-wins: EncodeOptimized replaces only when empty or strictly greater.
        if (target.startsAt === -1 || candScore > target.score) {
          target.score = candScore
          target.startsAt = startsAt
          target.ids = [hit.id]
        }
        if (len === 1) hasSingleChar = true
      }

      // AFTER the matches, and only when no single-character piece matched — the
      // reference's `has_single_node`. UNK is scored once per character, not per byte.
      if (!hasSingleChar) {
        const one = this.#charAt(chars, startsAt)
        const bytes = Buffer.from(one, 'utf8')
        const ids: number[] = []
        for (const b of bytes) {
          const id = this.#byteId[b] ?? -1
          ids.push(id >= 0 ? id : this.unkId)
        }
        maxFrontier = Math.max(maxFrontier, startsAt + 1)
        const target = best[startsAt + 1]
        const candScore = Math.fround(this.#unkPenalty + till)
        if (target !== undefined && (target.startsAt === -1 || candScore > target.score)) {
          target.score = candScore
          target.startsAt = startsAt
          target.ids = ids
        }
      }
    }

    const out: number[] = []
    let endsAt = n
    while (endsAt > 0) {
      const node = best[endsAt]
      if (node === undefined || node.startsAt < 0) {
        throw new Error('no path through the tokenizer lattice')
      }
      for (let k = node.ids.length - 1; k >= 0; k--) out.push(node.ids[k] ?? this.unkId)
      endsAt = node.startsAt
    }
    return out.toReversed()
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
