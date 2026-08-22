/**
 * The tokenizer against an oracle that is not us.
 *
 * Every vector below was produced by the real Python `sentencepiece` loading the same
 * `tokenizer.model`, and is pasted here verbatim. That is the only reason `sentencepiece.ts` is
 * allowed to exist: a hand-written tokenizer that agrees with itself proves nothing, and one that
 * is 99 % right does not fail loudly — it produces speech that is subtly wrong in a way nobody can
 * debug by ear.
 *
 * To regenerate (needs Python and network):
 *
 *     uv run --with sentencepiece python3 -c "
 *     import json, sentencepiece as spm
 *     sp = spm.SentencePieceProcessor(); sp.Load('packages/providers/src/pocket-synth/model/tokenizer.model')
 *     print(json.dumps([{'text': t, 'ids': sp.Encode(t)} for t in [...]], ensure_ascii=False))"
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SentencePieceUnigram, parseModelProto } from './sentencepiece.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const MODEL = join(HERE, 'model/tokenizer.model')

const sp = SentencePieceUnigram.fromBuffer(readFileSync(MODEL))

/** Produced by Python `sentencepiece`, pasted verbatim. Do not hand-edit an id. */
const GOLDEN: { text: string, ids: number[] }[] = [
  { text: "Hello world.", ids: [2994, 578, 263] },
  { text: "a", ids: [267] },
  { text: "The quick brown fox jumps over the lazy dog.", ids: [364, 976, 3683, 521, 1923, 1609, 261, 408, 265, 697, 690, 327, 1497, 263] },
  { text: "The file src/core/session_handler.py took 1,234,567 ms.", ids: [364, 2742, 260, 261, 334, 440, 51, 756, 280, 51, 261, 2894, 2510, 2643, 334, 263, 401, 327, 955, 260, 341, 262, 365, 450, 487, 262, 437, 543, 579, 260, 283, 261, 263] },
  { text: "Set path.style to verbatim.", ids: [1136, 274, 1871, 263, 3336, 266, 260, 692, 1078, 274, 711, 263] },
  { text: "ORCA", ids: [705, 941, 732, 637] },
  { text: "orca-plugin-tts", ids: [311, 841, 337, 401, 792, 453, 356, 337, 274, 274, 261] },
  { text: "Cafe naive resume", ids: [1130, 1273, 913, 937, 338, 261, 766, 336] },
  { text: "Café naïve résumé", ids: [1130, 601, 745, 913, 199, 179, 314, 670, 745, 261, 766, 745] },
  { text: "emoji 🎉 here", ids: [1574, 3033, 260, 244, 163, 146, 141, 375] },
  { text: "日本語テキスト", ids: [260, 234, 155, 169, 234, 160, 176, 236, 174, 162, 231, 135, 138, 231, 134, 177, 231, 134, 189, 231, 135, 140] },
  { text: "  leading and trailing  ", ids: [260, 260, 893, 273, 269, 3007, 273, 260, 260] },
  { text: "multiple   internal   spaces", ids: [1403, 1257, 260, 260, 276, 2291, 260, 260, 947, 261] },
  { text: "Punctuation!? Semi;colon: dash - em—dash", ids: [497, 813, 440, 1729, 431, 682, 292, 1136, 1005, 1230, 756, 2101, 3244, 1093, 1028, 260, 337, 260, 897, 3133, 307, 1911] },
  { text: "CAPS lock ON", ids: [444, 637, 759, 640, 260, 1460, 705, 1200] },
  { text: "v1.2.3-rc.4+build", ids: [1451, 341, 263, 365, 263, 450, 337, 334, 440, 263, 487, 47, 1579, 457, 307] },
  { text: "x=1; y=2", ids: [260, 568, 65, 341, 1230, 614, 65, 365] },
  { text: "\"quoted\"", ids: [694, 1431, 1025, 278, 3877] },
  { text: "it's", ids: [275, 264, 261] },
  { text: "10ms 20 ms 30MS", ids: [260, 341, 316, 283, 261, 260, 365, 316, 260, 283, 261, 260, 450, 316, 864, 640] },
  { text: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", ids: [383, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637] },
  { text: "Tabs\tand\nnewlines", ids: [602, 1222, 261, 13, 1096, 14, 532, 479, 994, 261] },
  { text: "​zero width", ids: [260, 230, 132, 143, 1505, 489, 859, 594, 465] },
  { text: "Ω≈ç√∫˜µ", ids: [260, 210, 173, 230, 141, 140, 2467, 230, 140, 158, 230, 140, 175, 207, 160, 198, 185] },
]

describe('SentencePiece unigram — against the Python reference', () => {
  it('parses the vocabulary the bundle actually ships', () => {
    const pieces = parseModelProto(readFileSync(MODEL))
    expect(pieces).toHaveLength(4000)
    // The composition this encoder is written for. If a future bundle changes it — a real
    // normalizer, a BPE model — these counts move and the encoder must be revisited rather than
    // quietly producing different speech.
    const byType = new Map<number, number>()
    for (const p of pieces) byType.set(p.type, (byType.get(p.type) ?? 0) + 1)
    expect(byType.get(2), 'unknown pieces').toBe(1)
    expect(byType.get(3), 'control pieces').toBe(3)
    expect(byType.get(6), 'byte pieces').toBe(256)
    expect(byType.get(1), 'normal pieces').toBe(3740)
    expect(pieces[0]?.piece).toBe('<unk>')
  })

  it.each(GOLDEN)('encodes $text exactly as the reference does', ({ text, ids }) => {
    expect(sp.encode(text)).toEqual(ids)
  })

  /**
   * R14-04, closed but for one case, and the route there is worth more than the result.
   *
   * The defect: our Viterbi and SentencePiece's disagreed on runs of a repeated letter — `Zccc`
   * was `['▁Z','c','cc']` here and `['▁Z','cc','c']` upstream. **Two confident theories were
   * measured and both were wrong.** Flipping `>` to `>=` moved an 11,344-input corpus from 17
   * disagreements to 21, in the opposite direction. And `c + cc === cc + c` in float64 AND
   * float32, which appeared to rule out precision entirely.
   *
   * What broke it open was probing upstream instead of reasoning about it: `Zbbb` is
   * `['▁Z','b','bb']` while `Zccc` is `['▁Z','cc','c']`. **No tie-break rule produces both.** What
   * produces both is float32 accumulation, where the ORDER of additions changes the sum —
   * `(B + b) + bb` and `(B + bb) + b` are different float32 numbers even though `b + bb === bb + b`.
   * The isolated comparison that "ruled out precision" was measuring the wrong expression.
   *
   * So `encode` is now a faithful port of `lattice.cc`: nodes carrying their own predecessor and
   * backtrace rather than one best per position, insertion order as the tie-break, the unknown node
   * inserted AFTER the trie matches, and `Math.fround` on every addition.
   *
   * **11,343 / 11,344 exact**, from 11,327. The one survivor is below.
   */
  it('R14-04: the cases that started it now match upstream exactly', () => {
    expect(sp.encode('Zccc')).toEqual([1557, 3169, 440])
    expect(sp.encode('0bbb')).toEqual([260, 316, 1363, 512])
    // And the case whose asymmetry was the clue — no single tie rule gives both of these.
    expect(sp.encode('Zbbb')).toEqual([1557, 512, 1363])
  })

  it.fails('R14-04 remainder: one five-letter run still resolves the other way', () => {
    // `Zggggg`: upstream ['▁Z','gg','g','gg'], ours ['▁Z','g','gg','gg']. Traced by hand to a
    // float32 tie at the final position where both candidates round to -34.59474182128906, so the
    // winner is decided purely by node insertion order in `end_nodes_`. One residual ordering
    // difference remains and it is NOT worth a fifth guess: the honest position is that this is
    // measured, bounded, and open.
    //
    // Blast radius, measured rather than asserted: 1 in 11,344 over an adversarial corpus, and
    // 0 in 180 realistic inputs. `it.fails` so it goes RED the day somebody closes it.
    expect(sp.encode('Zggggg')).toEqual([1557, 1129, 453, 1129])
  })

  it('R14-04 blast radius: no realistic input disagrees, including elongated words', () => {
    // The severity claim above, as a check rather than a sentence. These are the inputs a reply
    // actually contains; if one of them ever starts disagreeing, the finding has grown and this
    // row is where it shows up.
    //
    // Expected ids come from Python `sentencepiece`, pasted. The first version of this case had
    // ids I typed from memory and it FAILED -- which is the whole point of the rule it broke, in
    // the same commit that documents the rule. An expected value invented by the author is not an
    // oracle, it is the implementation's opinion written twice.
    expect(sp.encode('hmmm')).toEqual([260, 3428, 283])
    expect(sp.encode('shhh')).toEqual([1069, 506, 506])
    expect(sp.encode('nooo')).toEqual([354, 1339])
  })

  it('CONTROL: a deliberately wrong expectation fails', () => {
    // Without this, "every case passed" would also be true of a test that asserted nothing.
    expect(sp.encode('Hello world.')).not.toEqual([1, 2, 3])
  })

  it('encodes empty input as nothing at all', () => {
    // The dummy prefix would otherwise emit a lone U+2581, which is one token of leading silence
    // on every empty utterance. The reference returns [].
    expect(sp.encode('')).toEqual([])
  })

  it('never emits a control piece from ordinary text', () => {
    // <s>, </s> and <pad> are matchable strings. If they were in the lattice, a reply that
    // mentioned them literally would smuggle a control token into the audio.
    const controls = new Set(
      sp.pieces.flatMap((p, i) => (p.type === 3 ? [i] : []))
    )
    for (const text of ['<s> hello </s>', '<pad><pad>', 'a <s> b']) {
      for (const id of sp.encode(text)) expect(controls.has(id)).toBe(false)
    }
  })

  it('round-trips text through decode for every golden case', () => {
    // Chunk splitting decodes id ranges back to text, so a decode that loses characters would
    // silently drop words from long replies rather than fail.
    for (const { text } of GOLDEN) {
      if (text.trim() === '') continue
      expect(sp.decode(sp.encode(text))).toBe(text)
    }
  })
})
