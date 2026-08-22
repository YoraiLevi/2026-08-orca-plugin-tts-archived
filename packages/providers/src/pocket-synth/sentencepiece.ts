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

/** SentencePiece piece types, from `sentencepiece_model.proto`. */
const enum PieceType {
  NORMAL = 1,
  UNKNOWN = 2,
  CONTROL = 3,
  USER_DEFINED = 4,
  BYTE = 6,
}

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
      if (m !== null) this.#byteId[Number.parseInt(m[1], 16)] = i
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
  encode(text: string): number[] {
    if (text === '') return []
    const chars = [...this.normalize(text)]
    const n = chars.length
    if (n === 0) return []

    const best = new Float64Array(n + 1).fill(Number.NEGATIVE_INFINITY)
    const from = new Int32Array(n + 1).fill(-1)
    const pieceAt = new Int32Array(n + 1).fill(-1)
    const BYTE_FALLBACK = -2
    best[0] = 0

    for (let i = 0; i < n; i++) {
      if (best[i] === Number.NEGATIVE_INFINITY) continue
      const limit = Math.min(this.#maxPieceLen, n - i)
      let candidate = ''
      for (let len = 1; len <= limit; len++) {
        candidate += chars[i + len - 1]
        const hit = this.#usable.get(candidate)
        if (hit === undefined) continue
        const score = best[i] + hit.score
        if (score > best[i + len]) {
          best[i + len] = score
          from[i + len] = i
          pieceAt[i + len] = hit.id
        }
      }
      const one = chars[i]
      if (!this.#usable.has(one)) {
        const bytes = Buffer.from(one, 'utf8')
        const score = best[i] + this.#unkPenalty * bytes.length
        if (score > best[i + 1]) {
          best[i + 1] = score
          from[i + 1] = i
          pieceAt[i + 1] = BYTE_FALLBACK
        }
      }
    }

    const out: number[] = []
    let i = n
    while (i > 0) {
      const prev = from[i]
      if (prev < 0) throw new Error(`no path through the tokenizer lattice at position ${i}`)
      if (pieceAt[i] === BYTE_FALLBACK) {
        const bytes = Buffer.from(chars.slice(prev, i).join(''), 'utf8')
        const ids: number[] = []
        for (const b of bytes) ids.push(this.#byteId[b] >= 0 ? this.#byteId[b] : this.unkId)
        out.push(...ids.reverse())
      } else {
        out.push(pieceAt[i])
      }
      i = prev
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
        if (m !== null) { pending.push(Number.parseInt(m[1], 16)); continue }
      }
      flush()
      out.push(Buffer.from(piece, 'utf8'))
    }
    flush()
    return Buffer.concat(out).toString('utf8').replaceAll(SPACE, ' ').replace(/^ /, '')
  }
}
