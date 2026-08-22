/**
 * The binary formats and the resampler, checked by effect.
 *
 * These are all places where a mistake produces plausible audio rather than an error, so every
 * assertion here is about a MEASURED property of the output — a tone's amplitude, a round-tripped
 * sample, a rejected header — never about the shape of the code that produced it.
 */
import { describe, expect, it } from 'vitest'
import { readNpy, readWav, writeWav, resample } from './audio.js'

/* --------------------------------------------------------------------------------- helpers */

function makeWav(samples: number[], rate = 24_000, channels = 1, bits = 16): Buffer {
  const frames = samples.length / channels
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + samples.length * 2, 4)
  header.write('WAVEfmt ', 8, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * channels * 2, 28)
  header.writeUInt16LE(channels * 2, 32)
  header.writeUInt16LE(bits, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(samples.length * 2, 40)
  const body = Buffer.alloc(samples.length * 2)
  for (const [i, s] of samples.entries()) body.writeInt16LE(s, i * 2)
  void frames
  return Buffer.concat([header, body])
}

function tone(freq: number, rate: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.floor(rate * seconds))
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / rate)
  return out
}

/** Amplitude at one frequency, by correlating against a matched sine and cosine. */
function amplitudeAt(signal: Float32Array, freq: number, rate: number): number {
  let re = 0
  let im = 0
  for (let i = 0; i < signal.length; i++) {
    const phase = (2 * Math.PI * freq * i) / rate
    re += (signal[i] ?? 0) * Math.cos(phase)
    im += (signal[i] ?? 0) * Math.sin(phase)
  }
  return (2 * Math.hypot(re, im)) / signal.length
}

/* ------------------------------------------------------------------------------------- .npy */

describe('readNpy', () => {
  const npy = (shape: number[], values: number[], version = 1): Buffer => {
    const dict = `{'descr': '<f4', 'fortran_order': False, 'shape': (${shape.join(', ')}${shape.length === 1 ? ',' : ''}), }`
    const padded = dict + ' '.repeat((64 - ((10 + dict.length + 1) % 64)) % 64) + '\n'
    const head = Buffer.alloc(version === 1 ? 10 : 12)
    head.write('NUMPY', 0, 'latin1')
    head[6] = version
    head[7] = 0
    if (version === 1) head.writeUInt16LE(padded.length, 8)
    else head.writeUInt32LE(padded.length, 8)
    const body = Buffer.alloc(values.length * 4)
    for (const [i, v] of values.entries()) body.writeFloatLE(v, i * 4)
    return Buffer.concat([head, Buffer.from(padded, 'latin1'), body])
  }

  it('reads shape and values', () => {
    const { data, shape } = readNpy(npy([2, 3], [1, 2, 3, 4, 5, 6]))
    expect(shape).toEqual([2, 3])
    expect([...data]).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('reads the version 2 header too', () => {
    const { shape } = readNpy(npy([4], [1, 2, 3, 4], 2))
    expect(shape).toEqual([4])
  })

  it('REFUSES a dtype it cannot read rather than guessing', () => {
    // A float64 file read as float32 yields the right element count and the wrong numbers — the
    // flow LM would be conditioned on noise and would still produce confident speech.
    const bad = npy([2], [1, 2]).toString('latin1').replace("'<f4'", "'<f8'")
    expect(() => readNpy(Buffer.from(bad, 'latin1'))).toThrow(/float32/)
  })

  it('REFUSES fortran order rather than transposing silently', () => {
    const bad = npy([2, 2], [1, 2, 3, 4]).toString('latin1').replace('False', 'True ')
    expect(() => readNpy(Buffer.from(bad, 'latin1'))).toThrow(/fortran/i)
  })

  it('refuses a truncated body', () => {
    const full = npy([4], [1, 2, 3, 4])
    expect(() => readNpy(full.subarray(0, full.length - 6))).toThrow(/declares/)
  })

  it('refuses a file that is not .npy at all', () => {
    expect(() => readNpy(Buffer.from('hello world'))).toThrow(/not a \.npy/)
  })
})

/* -------------------------------------------------------------------------------------- WAV */

describe('readWav / writeWav', () => {
  it('reads 16-bit mono', () => {
    const { samples, rate } = readWav(makeWav([0, 16384, -16384, 32767], 24_000))
    expect(rate).toBe(24_000)
    expect(samples[0]).toBe(0)
    expect(samples[1]).toBeCloseTo(0.5, 4)
    expect(samples[2]).toBeCloseTo(-0.5, 4)
  })

  it('downmixes stereo by averaging', () => {
    const { samples } = readWav(makeWav([16384, 0, 0, 16384], 24_000, 2))
    expect(samples).toHaveLength(2)
    expect(samples[0]).toBeCloseTo(0.25, 4)
    expect(samples[1]).toBeCloseTo(0.25, 4)
  })

  it('walks chunks rather than assuming a 44-byte header', () => {
    // Real WAVs carry LIST/fact chunks before `data`. Reading from a fixed offset returns
    // metadata as audio, which sounds like a broken encoder rather than a broken parser.
    const plain = makeWav([0, 16384, -16384], 24_000)
    const list = Buffer.alloc(8 + 10)
    list.write('LIST', 0, 'ascii')
    list.writeUInt32LE(10, 4)
    list.write('INFOhello', 8, 'ascii')
    const withList = Buffer.concat([plain.subarray(0, 36), list, plain.subarray(36)])
    withList.writeUInt32LE(withList.length - 8, 4)
    const { samples } = readWav(withList)
    expect(samples).toHaveLength(3)
    expect(samples[1]).toBeCloseTo(0.5, 4)
  })

  it('refuses a bit depth it cannot read', () => {
    expect(() => readWav(makeWav([0, 1], 24_000, 1, 24))).toThrow(/16-bit/)
  })

  it('round-trips through writeWav within one quantisation step', () => {
    const original = tone(440, 24_000, 0.05)
    const { samples, rate } = readWav(writeWav(original, 24_000))
    expect(rate).toBe(24_000)
    expect(samples).toHaveLength(original.length)
    for (let i = 0; i < original.length; i++) expect(samples[i]).toBeCloseTo(original[i] ?? 0, 3)
  })

  it('clamps rather than wrapping', () => {
    // The model can overshoot 1.0. Wrapping turns an overshoot into a full-scale sign flip, which
    // is an audible crack; clamping is merely loud.
    const { samples } = readWav(writeWav(Float32Array.of(2, -2), 24_000))
    expect(samples[0]).toBeCloseTo(1, 3)
    expect(samples[1]).toBeCloseTo(-1, 3)
  })
})

/* ------------------------------------------------------------------------------- resampling */

describe('resample 32 kHz -> 24 kHz, the ratio every shipped voice needs', () => {
  it('returns the input untouched when the rates already match', () => {
    const t = tone(440, 24_000, 0.01)
    expect(resample(t, 24_000, 24_000)).toBe(t)
  })

  it('produces the expected number of samples', () => {
    const out = resample(tone(440, 32_000, 1), 32_000, 24_000)
    expect(out.length).toBe(24_000)
  })

  it('PRESERVES a tone that fits under the new Nyquist, at the same amplitude', () => {
    // The property that matters: a 1 kHz tone is still a 1 kHz tone at full level. A resampler
    // that halved the gain would make every cloned voice quieter and nothing would say so.
    const out = resample(tone(1000, 32_000, 0.5), 32_000, 24_000)
    expect(amplitudeAt(out, 1000, 24_000)).toBeCloseTo(1, 1)
  })

  it('REJECTS a tone above the new Nyquist instead of folding it down', () => {
    // 14 kHz cannot exist at 24 kHz sample rate. Decimating without a filter would alias it to
    // 10 kHz — a loud tone that was never in the recording, baked into the speaker's timbre.
    const out = resample(tone(14_000, 32_000, 0.5), 32_000, 24_000)
    const aliasAt = amplitudeAt(out, 24_000 - 14_000, 24_000)
    expect(aliasAt).toBeLessThan(0.05)
  })

  it('CONTROL: naive decimation DOES fold it down, so the check above can fail', () => {
    // Without this, "the alias is small" would also be true of a test measuring the wrong thing.
    const input = tone(14_000, 32_000, 0.5)
    const naive = new Float32Array(Math.floor((input.length * 24_000) / 32_000))
    for (let i = 0; i < naive.length; i++) naive[i] = input[Math.floor((i * 32_000) / 24_000)] ?? 0
    expect(amplitudeAt(naive, 10_000, 24_000)).toBeGreaterThan(0.5)
  })

  it('does not fade the edges', () => {
    // Normalising by the realised kernel sum is what keeps the gain at 1 where the kernel is
    // clipped. Without it the first and last milliseconds fade, which reads as a click.
    const out = resample(tone(500, 32_000, 0.2), 32_000, 24_000)
    const head = amplitudeAt(out.subarray(0, 480), 500, 24_000)
    const middle = amplitudeAt(out.subarray(2400, 2880), 500, 24_000)
    expect(head).toBeGreaterThan(middle * 0.8)
  })

  it('handles empty input and refuses nonsense rates', () => {
    expect(resample(new Float32Array(0), 32_000, 24_000)).toHaveLength(0)
    expect(() => resample(tone(440, 32_000, 0.01), 0, 24_000)).toThrow(/positive/)
  })
})
