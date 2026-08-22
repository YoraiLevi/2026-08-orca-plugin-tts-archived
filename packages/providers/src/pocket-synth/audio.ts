/**
 * The small binary formats Pocket TTS needs, and the one signal-processing step it needs.
 *
 * Kept apart from `engine.ts` so they can be tested without loading 166 MB of ONNX graphs: these
 * are pure functions over typed arrays, and every one of them is a place where a quiet mistake
 * produces plausible audio rather than an error.
 */

export interface Pcm {
  readonly samples: Float32Array
  readonly rate: number
}

/* -------------------------------------------------------------------------------------- .npy */

export interface Npy {
  readonly data: Float32Array
  readonly shape: readonly number[]
}

/**
 * NumPy `.npy`, restricted to the little-endian float32 C-order case the bundle ships
 * (`bos_before_voice.npy`).
 *
 * Everything else THROWS rather than coercing. A silently mis-read header would hand the flow LM
 * an array of the right length and the wrong meaning, which is the failure mode that produces
 * confident nonsense instead of an exception.
 */
export function readNpy(buf: Buffer): Npy {
  if (buf.toString('latin1', 0, 6) !== 'NUMPY') throw new Error('not a .npy file')
  const major = buf[6]
  if (major !== 1 && major !== 2) throw new Error(`unsupported .npy version ${major}`)
  const headerLen = major === 1 ? buf.readUInt16LE(8) : buf.readUInt32LE(8)
  const headerStart = major === 1 ? 10 : 12
  const header = buf.toString('latin1', headerStart, headerStart + headerLen)

  const descr = /'descr'\s*:\s*'([^']+)'/.exec(header)?.[1]
  if (descr !== '<f4') throw new Error(`only little-endian float32 .npy is supported, got ${String(descr)}`)
  if (/'fortran_order'\s*:\s*True/.test(header)) throw new Error('fortran-ordered .npy is not supported')

  const shapeText = /'shape'\s*:\s*\(([^)]*)\)/.exec(header)?.[1] ?? ''
  const shape = [...shapeText.matchAll(/\d+/g)].map((m) => Number(m[0] ?? 0))
  const count = shape.reduce((a, b) => a * b, 1)
  const body = headerStart + headerLen
  if (body + count * 4 > buf.length) {
    throw new Error(`.npy declares ${count} float32 values but the file holds ${(buf.length - body) / 4}`)
  }
  const data = new Float32Array(count)
  for (let i = 0; i < count; i++) data[i] = buf.readFloatLE(body + i * 4)
  return { data, shape }
}

/* -------------------------------------------------------------------------------------- WAV */

/**
 * 16-bit PCM WAV in, mono float32 out.
 *
 * Chunk-walking rather than assuming a 44-byte header: real WAVs carry `LIST`/`fact` chunks before
 * `data`, and reading from a fixed offset would return metadata as audio — noise that sounds like
 * a broken encoder rather than a broken parser.
 */
export function readWav(buf: Buffer): Pcm {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file')
  }
  let pos = 12
  let fmt: { channels: number, rate: number, bits: number } | null = null
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    const body = pos + 8
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      }
    } else if (id === 'data') {
      if (fmt === null) throw new Error('WAV data chunk arrived before its fmt chunk')
      if (fmt.bits !== 16) throw new Error(`only 16-bit PCM WAV is supported, got ${fmt.bits}-bit`)
      if (fmt.channels < 1) throw new Error('WAV declares zero channels')
      const available = Math.min(size, buf.length - body)
      const frames = Math.floor(available / 2 / fmt.channels)
      const mono = new Float32Array(frames)
      for (let i = 0; i < frames; i++) {
        let acc = 0
        for (let c = 0; c < fmt.channels; c++) acc += buf.readInt16LE(body + (i * fmt.channels + c) * 2)
        mono[i] = acc / fmt.channels / 32768
      }
      return { samples: mono, rate: fmt.rate }
    }
    pos = body + size + (size % 2)
  }
  throw new Error('WAV has no data chunk')
}

/** Mono float32 out to a 16-bit PCM WAV buffer. Clamped, because the model can overshoot 1.0. */
export function writeWav(samples: Float32Array, rate: number): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + samples.length * 2, 4)
  header.write('WAVEfmt ', 8, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(samples.length * 2, 40)
  const body = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0))
    body.writeInt16LE(Math.round(v * 32767), i * 2)
  }
  return Buffer.concat([header, body])
}

/* -------------------------------------------------------------------------------- resampling */

/** Even reflection supplies real kernel support without inventing a discontinuous zero edge. */
function reflectedIndex(index: number, length: number): number {
  if (index >= 0 && index < length) return index
  if (length === 1) return 0
  const period = 2 * (length - 1)
  const wrapped = ((index % period) + period) % period
  return wrapped < length ? wrapped : period - wrapped
}

/**
 * Band-limited resampling by windowed sinc.
 *
 * Every shipped reference voice is 32 kHz and the model wants 24 kHz, so this runs on every voice.
 * It matters more than its size suggests: the reference clip is the ONE input the zero-shot
 * cloning reads, so aliasing introduced here is aliasing baked into the speaker's timbre for every
 * utterance afterwards. Dropping samples naively would fold everything above 12 kHz back down.
 *
 * Bit-parity with any particular reference is explicitly NOT the goal, and could not be: the
 * Python reference uses `scipy.signal.resample_poly` while buzz uses sherpa-onnx's
 * `LinearResampler`, and those two do not agree with each other either. What is required is that
 * the result be band-limited and gain-correct, which `audio.test.ts` checks by measuring a
 * swept tone rather than by comparing bytes.
 */
export function resample(input: Float32Array, fromRate: number, toRate: number, width = 16): Float32Array {
  if (fromRate <= 0 || toRate <= 0) throw new Error('sample rates must be positive')
  if (fromRate === toRate) return input
  if (input.length === 0) return input

  const ratio = toRate / fromRate
  // Below Nyquist of whichever side is lower, with a little transition band.
  const cutoff = Math.min(1, ratio) * 0.95
  const outLen = Math.floor(input.length * ratio)
  const out = new Float32Array(outLen)
  const half = Math.ceil(width / Math.min(1, ratio))

  for (let i = 0; i < outLen; i++) {
    const centre = i / ratio
    const first = Math.ceil(centre - half)
    const last = Math.floor(centre + half)
    let acc = 0
    let norm = 0
    for (let j = first; j <= last; j++) {
      const d = centre - j
      // Blackman window over the kernel's support: without a window the truncated sinc rings.
      const w = 0.42 + 0.5 * Math.cos((Math.PI * d) / half) + 0.08 * Math.cos((2 * Math.PI * d) / half)
      const x = cutoff * d
      const k = (x === 0 ? cutoff : (Math.sin(Math.PI * x) / (Math.PI * x)) * cutoff) * w
      acc += (input[reflectedIndex(j, input.length)] ?? 0) * k
      norm += k
    }
    // Reflecting supplies the complete kernel at a finite record boundary. Clipping it and then
    // dividing by its signed partial sum preserves DC but amplifies phase-dependent stop-band
    // transients. The complete-kernel normalisation below keeps DC gain exactly one without that
    // unstable boundary mechanism.
    out[i] = norm === 0 ? 0 : acc / norm
  }
  return out
}
