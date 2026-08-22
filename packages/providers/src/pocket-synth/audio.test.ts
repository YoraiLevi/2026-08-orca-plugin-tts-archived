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

function tone(freq: number, rate: number, seconds: number, phase = 0): Float32Array {
  const out = new Float32Array(Math.floor(rate * seconds))
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / rate + phase)
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

/** Total signal energy, used where a rejected tone must not turn into any boundary sound. */
function rms(signal: Float32Array): number {
  let energy = 0
  for (const sample of signal) energy += sample * sample
  return Math.sqrt(energy / signal.length)
}

function naiveDecimate(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  const out = new Float32Array(Math.floor((input.length * toRate) / fromRate))
  for (let i = 0; i < out.length; i++) out[i] = input[Math.floor((i * fromRate) / toRate)] ?? 0
  return out
}

function meanAbsolute(signal: Float32Array): number {
  let total = 0
  for (const sample of signal) total += Math.abs(sample)
  return total / signal.length
}

function edgeToMiddleGain(signal: Float32Array, edgeSamples: number): number {
  const middleStart = Math.floor((signal.length - edgeSamples) / 2)
  const middle = meanAbsolute(signal.subarray(middleStart, middleStart + edgeSamples))
  const head = meanAbsolute(signal.subarray(0, edgeSamples))
  const tail = meanAbsolute(signal.subarray(signal.length - edgeSamples))
  return Math.min(head, tail) / middle
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

  it('PRESERVES the promised pass band through 9 kHz, at the same amplitude', () => {
    // One 1 kHz point admitted a filter whose cutoff was gutted to 6 kHz. Measure the voice band,
    // away from the finite-record boundaries, so losing consonant detail cannot stay green. The
    // contract permits at most 5% loss through 9 kHz; 9–14 kHz is the transition band.
    for (const freq of [1_000, 4_000, 8_000, 9_000]) {
      for (const phase of [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4]) {
        const out = resample(tone(freq, 32_000, 0.5, phase), 32_000, 24_000)
        const middle = out.subarray(2_400, out.length - 2_400)
        expect(amplitudeAt(middle, freq, 24_000), `${freq} Hz pass-band gain`).toBeGreaterThan(0.95)
      }
    }
  })

  it('CONTROL: the pass-band measurement detects severe high-frequency deletion', () => {
    const out = resample(tone(8_000, 32_000, 0.5), 32_000, 24_000)
    const deleted = new Float32Array(out.length)
    // A three-sample moving average has a zero at 8 kHz when the output rate is 24 kHz.
    for (let i = 1; i < out.length - 1; i++) {
      deleted[i] = ((out[i - 1] ?? 0) + (out[i] ?? 0) + (out[i + 1] ?? 0)) / 3
    }
    const middle = deleted.subarray(2_400, deleted.length - 2_400)
    expect(amplitudeAt(middle, 8_000, 24_000)).toBeLessThan(0.05)
  })

  it('REJECTS a tone above the new Nyquist instead of folding it down', () => {
    // The stop band begins at 14 kHz. Decimating without a filter would alias these tones below
    // 12 kHz — energy that was never there, baked into the cloned speaker's timbre.
    for (const freq of [14_000, 15_000]) {
      for (const phase of [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4]) {
        const out = resample(tone(freq, 32_000, 0.5, phase), 32_000, 24_000)
        const middle = out.subarray(2_400, out.length - 2_400)
        const aliasAt = amplitudeAt(middle, 24_000 - freq, 24_000)
        expect(aliasAt, `${freq} Hz alias amplitude`).toBeLessThan(0.05)
        expect(rms(middle), `${freq} Hz stop-band RMS`).toBeLessThan(0.01)
      }
    }
  })

  it('CONTROL: naive decimation DOES fold it down, so the check above can fail', () => {
    // Without this, "the alias is small" would also be true of a test measuring the wrong thing.
    const input = tone(14_000, 32_000, 0.5)
    const naive = naiveDecimate(input, 32_000, 24_000)
    expect(amplitudeAt(naive, 10_000, 24_000)).toBeGreaterThan(0.5)
    expect(rms(naive.subarray(2_400, naive.length - 2_400))).toBeGreaterThan(0.5)
  })

  it('keeps DC gain exact at both edges as well as the middle', () => {
    // A constant input makes edge gain directly observable. Averaging 480 samples hid the first
    // 17 affected samples and let removal of kernel normalisation survive.
    const level = 0.5
    const out = resample(new Float32Array(3_200).fill(level), 32_000, 24_000)
    expect(out[0]).toBeCloseTo(level, 6)
    expect(out[out.length - 1]).toBeCloseTo(level, 6)
    expect(edgeToMiddleGain(out, 17)).toBeCloseTo(1, 6)
  })

  it('CONTROL: the edge-gain measurement detects a boundary fade', () => {
    const faded = new Float32Array(2_400).fill(0.5)
    for (let i = 0; i < 17; i++) {
      faded[i] = (faded[i] ?? 0) * 0.5
      const tail = faded.length - 1 - i
      faded[tail] = (faded[tail] ?? 0) * 0.5
    }
    expect(edgeToMiddleGain(faded, 17)).toBeLessThan(0.75)
  })

  it('REJECTS stop-band energy at the first and last kernel radii across phase', () => {
    // The middle rejects 14 kHz almost completely. A clipped signed-kernel normaliser used to
    // turn that same tone into a phase-dependent boundary transient with a 0.45 peak.
    let worstBoundaryRms = 0
    for (const freq of [14_000, 14_500, 15_000, 15_500]) {
      for (let p = 0; p < 16; p++) {
        const phase = (2 * Math.PI * p) / 16
        const out = resample(tone(freq, 32_000, 0.1, phase), 32_000, 24_000)
        worstBoundaryRms = Math.max(
          worstBoundaryRms,
          rms(out.subarray(0, 17)),
          rms(out.subarray(out.length - 17)),
        )
      }
    }
    expect(worstBoundaryRms).toBeLessThan(0.08)
  })

  it('CONTROL: an unfiltered boundary retains the stop-band energy', () => {
    let worstBoundaryRms = 0
    for (let p = 0; p < 16; p++) {
      const phase = (2 * Math.PI * p) / 16
      const out = naiveDecimate(tone(14_000, 32_000, 0.1, phase), 32_000, 24_000)
      worstBoundaryRms = Math.max(
        worstBoundaryRms,
        rms(out.subarray(0, 17)),
        rms(out.subarray(out.length - 17)),
      )
    }
    expect(worstBoundaryRms).toBeGreaterThan(0.5)
  })

  it('handles empty input and refuses nonsense rates', () => {
    expect(resample(new Float32Array(0), 32_000, 24_000)).toHaveLength(0)
    expect([...resample(Float32Array.of(0.5, 0.5), 32_000, 24_000)]).toEqual([0.5])
    expect(() => resample(tone(440, 32_000, 0.01), 0, 24_000)).toThrow(/positive/)
  })
})
