/**
 * The engine — PV-012 (seeded sampling), PV-013 (chunking), PV-014 (the voice cache),
 * PV-015 (the gated tier).
 *
 * TWO TIERS, and the split is deliberate.
 *
 * **Pure** cases run everywhere: the RNG, the ONNX-absent path, and anything that can be checked
 * without 166 MB of weights. They run in CI on all three OSes.
 *
 * **Engine** cases need the model on disk and are gated behind `POCKET_MODEL_DIR`. They SKIP with a
 * printed reason rather than silently — PITFALLS **P42**'s shape is a check that quietly does
 * nothing and reads as a pass, and a suite that says "48 passed" while the eight that mattered
 * never ran is exactly that. `describe.skipIf` with a logged reason is the difference.
 *
 * The end-to-end oracle is NOT here. It lives in `scripts/pocket-e2e.mjs` because it needs an
 * out-of-process transcriber and it is the check that decides whether any of this is correct; a
 * vitest case that shells out to `uv` would be a slow, flaky copy of it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { makeRng, OnnxRuntimeMissingError, splitAtNaturalBoundaries } from './engine.js'
import { SentencePieceUnigram } from './sentencepiece.js'

/* ------------------------------------------------------------------------------ PV-012 the RNG */

describe('PV-012 — sampling is seeded, so a regression is a comparison and not a judgement', () => {
  it('is identical for the same seed', () => {
    const a = Array.from({ length: 64 }, () => makeRng(42)(1))
    const b = Array.from({ length: 64 }, () => makeRng(42)(1))
    expect(a).toEqual(b)
  })

  it('DIFFERS for a different seed', () => {
    // Without this, "the same seed matches" is also true of a generator that returns a constant.
    const a = makeRng(1)
    const b = makeRng(2)
    const seqA = Array.from({ length: 32 }, () => a(1))
    const seqB = Array.from({ length: 32 }, () => b(1))
    expect(seqA).not.toEqual(seqB)
  })

  it('is a sequence, not one number repeated', () => {
    // A generator that returned a constant would satisfy "same seed, same output" perfectly.
    const rng = makeRng(7)
    const values = Array.from({ length: 256 }, () => rng(1))
    expect(new Set(values).size).toBeGreaterThan(200)
  })

  it('is approximately normal with the requested standard deviation', () => {
    // The distribution has to be normal because the flow field was trained against Gaussian
    // noise. It does NOT have to match NumPy's Mersenne Twister, and claiming it did would be a
    // claim this project cannot support — so the assertion is on the moments, not on the bytes.
    const rng = makeRng(99)
    const n = 20_000
    const std = Math.sqrt(0.7)
    const xs = Array.from({ length: n }, () => rng(std))
    const mean = xs.reduce((a, b) => a + b, 0) / n
    const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n
    expect(Math.abs(mean)).toBeLessThan(0.05)
    expect(Math.sqrt(variance)).toBeCloseTo(std, 1)
  })

  it('scales with std rather than ignoring it', () => {
    const wide = Array.from({ length: 4000 }, ((r) => () => r(4))(makeRng(3)))
    const narrow = Array.from({ length: 4000 }, ((r) => () => r(0.25))(makeRng(3)))
    const spread = (xs: number[]): number => Math.max(...xs) - Math.min(...xs)
    expect(spread(wide)).toBeGreaterThan(spread(narrow) * 4)
  })
})

/* -------------------------------------------------------------- the ONNX-absent path, PV-FR-021 */

describe('a missing ONNX Runtime is a sentence, not a stack trace', () => {
  it('names the module, says what still works, and says how to fix it', () => {
    // R015: degrade LOUDLY. A bare ERR_MODULE_NOT_FOUND reaching a listener as "speech failed"
    // is the quiet degradation this rule exists to forbid.
    const absent = new OnnxRuntimeMissingError(
      'The neural voices need the ONNX Runtime, which is not on this machine yet (37 MB). ' +
      'The operating system voices are unaffected, and the Voice Lab can fetch it.')
    expect(absent.code).toBe('onnxruntime_missing')
    expect(absent.reason).toBe('absent')
    expect(absent.message).toMatch(/operating system voices are unaffected/i)

    // `unsupported` is a DIFFERENT state and the caller must be able to tell them apart: one is a
    // button the listener can press, the other is a fact about their hardware. Collapsing them
    // would offer an Intel Mac a download that can never work.
    const never = new OnnxRuntimeMissingError('no Intel-Mac binary exists', 'unsupported')
    expect(never.reason).toBe('unsupported')
  })

  it('is importable on a machine without the runtime', async () => {
    // The whole point of the lazy import: `import('./engine.js')` must succeed so the provider can
    // REPORT the absence. A top-level import would make it a crash at load time instead.
    const mod = await import('./engine.js')
    expect(typeof mod.PocketTts.load).toBe('function')
    expect(typeof mod.makeRng).toBe('function')
  })
})

/* ---------------------------------------------- PV-077 the splitter ladder, no model required */

/**
 * Word-count tokenizer, the same stand-in buzz uses to pin the ladder without the 166 MB
 * of weights. One whitespace-separated token is one unit. Trailing punctuation rides with
 * its word, so "three," counts as one.
 */
function whitespaceTokenCount(text: string): number {
  const t = text.trim()
  if (t === '') return 0
  return t.split(/\s+/).length
}

const TOKENIZER_PATH = join(dirname(fileURLToPath(import.meta.url)), 'model/tokenizer.model')
const sp = SentencePieceUnigram.fromBuffer(readFileSync(TOKENIZER_PATH))

describe('PV-077 — splitAtNaturalBoundaries falls below the sentence (pure tier)', () => {
  it('a single oversized sentence with NO full stop still splits and loses nothing', () => {
    // The existing PV-013 conservation row uses twelve punctuated sentences, so a splitter
    // that only cuts on '.' stays green. This one has no sentence end at all.
    const text = 'One two three four five six seven eight nine ten eleven twelve'
    const chunks = splitAtNaturalBoundaries(text, 5, whitespaceTokenCount)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe(text)
    for (const chunk of chunks) expect(whitespaceTokenCount(chunk)).toBeLessThanOrEqual(5)
    for (const word of text.split(' ')) expect(chunks.join('')).toContain(word)
  })

  it('falls back to a clause when no sentence end fits', () => {
    const text = 'One two three, four five six seven.'
    const chunks = splitAtNaturalBoundaries(text, 5, whitespaceTokenCount)
    expect(chunks[0]).toBe('One two three, ')
    expect(chunks.join('')).toBe(text)
    for (const chunk of chunks) expect(whitespaceTokenCount(chunk)).toBeLessThanOrEqual(5)
  })

  it('falls back to a word when no clause fits', () => {
    const text = 'One two three four five six.'
    const chunks = splitAtNaturalBoundaries(text, 4, whitespaceTokenCount)
    expect(chunks[0]).toBe('One two three four ')
    expect(chunks.join('')).toBe(text)
    for (const chunk of chunks) expect(whitespaceTokenCount(chunk)).toBeLessThanOrEqual(4)
  })

  it('falls back to a unicode-scalar cut when a SINGLE WORD exceeds the cap, and loses nothing', () => {
    // Character count as the unit, matching buzz's oversized-word row. Four "é"s at a cap
    // of 3 cannot split on whitespace — there is none — so the last rung must fire.
    const text = 'éééé'
    const chunks = splitAtNaturalBoundaries(text, 3, (s) => [...s].length)
    expect(chunks).toEqual(['ééé', 'é'])
    expect(chunks.join('')).toBe(text)
  })

  it('throws when even one character cannot fit the cap, rather than dropping it', () => {
    expect(() => splitAtNaturalBoundaries('é', 0, (s) => [...s].length)).toThrow(/one character/)
  })

  it('does not treat 12:30 or 1,000 as clause cuts', () => {
    const text = 'Meet at 12:30 with 1,000 guests onward.'
    const chunks = splitAtNaturalBoundaries(text, 3, whitespaceTokenCount)
    expect(chunks.join('')).toBe(text)
    expect(chunks.some((c) => c.includes('12:30'))).toBe(true)
    expect(chunks.some((c) => c.includes('1,000'))).toBe(true)
    for (const chunk of chunks) expect(whitespaceTokenCount(chunk)).toBeLessThanOrEqual(3)
  })

  it('preserves closing quotes and non-ASCII and still conserves every code point', () => {
    const text = '“Café naïve?” Maybe—yes, definitely; 東京 speaks.'
    const chunks = splitAtNaturalBoundaries(text, 3, whitespaceTokenCount)
    expect(chunks.join('')).toBe(text)
    for (const chunk of chunks) expect(whitespaceTokenCount(chunk)).toBeLessThanOrEqual(3)
  })

  it('packs several sentences when they fit (model split, not first-sentence isolation)', () => {
    const text = 'One two. Three four. Five six.'
    const chunks = splitAtNaturalBoundaries(text, 4, whitespaceTokenCount)
    expect(chunks).toEqual(['One two. Three four. ', 'Five six.'])
    expect(chunks.join('')).toBe(text)
  })

  it('a 90-word boundary-free sentence stays inside the real tokenizer cap of 50', () => {
    // R15-04's fixture shape, against the vendored 59 KB tokenizer, no ONNX weights.
    const text = Array.from({ length: 90 }, (_, i) => `word${i}`).join(' ')
    const tokens = sp.encode(text).length
    expect(tokens, 'fixture must overflow 50 or this row cannot fail').toBeGreaterThan(50)

    const chunks = splitAtNaturalBoundaries(text, 50, (s) => sp.encode(s).length)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe(text)
    for (const chunk of chunks) {
      // Trailing whitespace rides with the chunk so join('') conserves the
      // source; the cap is what the model hears, which is the trimmed prompt.
      expect(sp.encode(chunk.trim()).length).toBeLessThanOrEqual(50)
    }
    for (const word of text.split(' ')) expect(chunks.join('')).toContain(word)
  })
})

/* ------------------------------------------------------------------------ the gated engine tier */

const MODEL_DIR = process.env.POCKET_MODEL_DIR ?? ''
const HAVE_MODEL = MODEL_DIR !== '' && existsSync(join(MODEL_DIR, 'bundle.json'))

if (!HAVE_MODEL) {
  // Printed, not silent. A skip nobody sees is a check that reads as a pass (P42).
  console.log(
    '[pocket] engine tier SKIPPED: set POCKET_MODEL_DIR to a Pocket TTS bundle to run PV-013 and PV-014. ' +
    'The pure tier above still ran.',
  )
}

describe.skipIf(!HAVE_MODEL)('PV-013 / PV-014 — against a real bundle', () => {
  // `InstanceType<typeof PocketTts>` is not available: the constructor is private on purpose, so
  // nothing outside the module can build one in an unloaded state. The return type comes from the
  // factory instead, which is the shape callers actually get.
  type Engine = Awaited<ReturnType<typeof import('./engine.js').PocketTts.load>>
  const load = async (): Promise<Engine> => {
    const { PocketTts } = await import('./engine.js')
    return PocketTts.load(MODEL_DIR)
  }

  it('PV-013 splits only when the bundle cap demands it', async () => {
    const tts = await load()
    const short = 'The quick brown fox jumps over the lazy dog.'
    expect(tts.splitIntoChunks(short)).toHaveLength(1)
    expect(tts.tokenizer.encode(short).length).toBeLessThanOrEqual(tts.maxTokenPerChunk)
  })

  it('PV-013 splits long text and LOSES NOTHING', async () => {
    // The failure mode is silent truncation: a reply that stops early sounds like the agent
    // finished. So the assertion is that every chunk's words are present, in order, not merely
    // that more than one chunk came back.
    const tts = await load()
    const sentences = Array.from({ length: 12 }, (_, i) =>
      `This is sentence number ${i + 1} and it carries enough words to matter.`)
    const text = sentences.join(' ')
    const chunks = tts.splitIntoChunks(text)
    expect(chunks.length).toBeGreaterThan(1)

    const flat = (s: string): string => s.toLowerCase().replaceAll(/[^a-z0-9 ]/g, '').replaceAll(/\s+/g, ' ').trim()
    const rejoined = flat(chunks.join(' '))
    for (const s of sentences) expect(rejoined).toContain(flat(s))
  })

  it('PV-013 keeps every chunk inside the cap', async () => {
    const tts = await load()
    const text = Array.from({ length: 20 }, (_, i) => `Sentence ${i} with several words in it.`).join(' ')
    for (const chunk of tts.splitIntoChunks(text)) {
      // A chunk over the cap does not error — it degrades. The gate IS the cap (P33): a
      // `* 2` slack is what lets a 51–99 token sentence through, which is the silent-wrong
      // half of R15-04. The other half was this fixture — short punctuated sentences never
      // reach a missing lower rung.
      expect(tts.tokenizer.encode(chunk.trim()).length).toBeLessThanOrEqual(tts.maxTokenPerChunk)
    }
  })

  it('PV-077 R15-04: a single sentence with no full stop still stays inside the cap and loses nothing', async () => {
    // Exact demonstration from docs/design/023-review-round15.md R15-04: ninety
    // whitespace-separated words, no sentence end, one chunk against a 50-token cap.
    const tts = await load()
    const words = Array.from({ length: 90 }, (_, i) => `word${i}`)
    const text = words.join(' ')
    const { text: prepared } = tts.preparePrompt(text)
    expect(
      tts.tokenizer.encode(prepared).length,
      'fixture must overflow the bundle cap or this row cannot fail',
    ).toBeGreaterThan(tts.maxTokenPerChunk)

    const chunks = tts.splitIntoChunks(text)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe(prepared)
    for (const chunk of chunks) {
      expect(tts.tokenizer.encode(chunk.trim()).length).toBeLessThanOrEqual(tts.maxTokenPerChunk)
    }
    const flat = (s: string): string =>
      s.toLowerCase().replaceAll(/[^a-z0-9 ]/g, '').replaceAll(/\s+/g, ' ').trim()
    const rejoined = flat(chunks.join(''))
    for (const w of words) expect(rejoined).toContain(w.toLowerCase())
  })

  it('PV-077 an oversized word is cut at a unicode scalar and loses nothing', async () => {
    const tts = await load()
    const text = `${'é'.repeat(80)} tail`
    const { text: prepared } = tts.preparePrompt(text)
    expect(tts.tokenizer.encode(prepared).length).toBeGreaterThan(tts.maxTokenPerChunk)

    const chunks = tts.splitIntoChunks(text)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe(prepared)
    for (const chunk of chunks) {
      expect(tts.tokenizer.encode(chunk.trim()).length).toBeLessThanOrEqual(tts.maxTokenPerChunk)
    }
  })

  it('PV-013 prepares the prompt the way the model was trained to receive it', async () => {
    const tts = await load()
    // Capitalisation and the final stop are not cosmetic: they change the tokens, so they change
    // the audio.
    expect(tts.preparePrompt('hello there').text).toBe('Hello there.')
    expect(tts.preparePrompt('Already fine.').text).toBe('Already fine.')
    expect(tts.preparePrompt('a question?').text).toBe('A question?')
    expect(() => tts.preparePrompt('   ')).toThrow(/empty/)
  })

  it('PV-014 builds a voice state once and reuses it', async () => {
    const tts = await load()
    expect(tts.hasVoice('eve.wav')).toBe(false)
    const wav = await readFile(join(MODEL_DIR, 'eve.wav'))

    const t0 = performance.now()
    await tts.voiceState('eve.wav', wav)
    const cold = performance.now() - t0
    expect(tts.hasVoice('eve.wav')).toBe(true)

    const t1 = performance.now()
    await tts.voiceState('eve.wav', null)
    const warm = performance.now() - t1

    // By effect and by a wide margin, not by a tight timing that a loaded machine would break
    // (P40/P43). Cold runs the Mimi encoder over ten seconds of audio; warm copies tensors.
    expect(warm).toBeLessThan(cold / 4)
  })

  it('PV-014 refuses an uncached voice with no audio, rather than returning something wrong', async () => {
    const tts = await load()
    await expect(tts.voiceState('never-seen.wav', null)).rejects.toThrow(/not cached/)
  })

  it('PV-014 gives different voices different states', async () => {
    // If the cache key were ignored, every voice would sound like the first one loaded and
    // nothing would report it.
    const tts = await load()
    const eve = await tts.voiceState('eve.wav', await readFile(join(MODEL_DIR, 'eve.wav')))
    const michael = await tts.voiceState('michael.wav', await readFile(join(MODEL_DIR, 'michael.wav')))

    // Across ALL state tensors, not the first one. The first version of this case compared
    // `Object.keys(eve)[0]` and FAILED against a correct engine: state_0 is the attention cache,
    // NaN-filled at these positions for every voice, so it is identical by construction. A check
    // that fails on correct code is as useless as one that passes on broken code, and it was
    // this test that said so.
    let differing = 0
    for (const key of Object.keys(eve)) {
      const a = eve[key]?.data
      const b = michael[key]?.data
      if (!(a instanceof Float32Array) || !(b instanceof Float32Array)) continue
      for (let i = 0; i < a.length; i++) {
        // NaN !== NaN, so compare only the positions that carry real numbers.
        if (Number.isFinite(a[i]) && Number.isFinite(b[i]) && a[i] !== b[i]) { differing++; break }
      }
    }
    expect(differing, 'no state tensor differs between two voices — the cache key is being ignored')
      .toBeGreaterThan(0)
  })
})
