/**
 * SC-9 — the provider -> sink seam: does the sink handle every audio format a provider may declare?
 *
 * Part of `docs/design/006-fma.md` section 22, round 9. This is the round's "one probe asking a
 * question the brief did not" (`018-review-round9.md` section 5): the brief pointed at the text
 * seams, and the same class of defect exists one layer further down, in bytes.
 *
 * THE SEAM. `AudioChunk.format` is a free-form `string` whose own doc comment enumerates the
 * intended vocabulary -- "e.g. 'wav' | 'pcm-s16le' | 'mp3' | 'opus'"
 * (`packages/core/src/types/index.ts`). `SubprocessSink.enqueue()` reduces that vocabulary to one
 * bit -- as it did before J26 closed this row:
 *
 *     const file = join(dir, `chunk.${chunk.format === 'wav' ? 'wav' : 'bin'}`)
 *
 * Everything that was not `wav` was written to a file called `chunk.bin` and handed to `afplay` /
 * `aplay` / `powershell`, which identify audio BY EXTENSION AND HEADER. There was no validation,
 * no refusal, and -- the part that mattered -- no announcement.
 *
 * WHY IT IS NOT MERELY THEORETICAL. `OsSynthProvider` is the only provider today and it declares
 * `'wav'`, so the seam is currently held closed by there being one implementation. `010` plans the
 * resident Piper service, and a streaming neural provider's natural output is raw PCM, not a
 * container -- that is the whole reason `010` argues for it. The moment a second provider exists,
 * this line decides whether the listener hears anything, and its failure mode is the one this
 * project ranks worst: silence with no sentence.
 *
 * NO AUDIO IS OPENED BY THIS FILE (P31). The player ladder is overridden with `sh -c 'exit 0'`,
 * the documented test seam, and what is asserted is the FILE NAME the sink chose.
 */
import { describe, it, expect } from 'vitest'
import { SubprocessSink } from '../sinks/subprocess-sink.js'
import type { AudioChunk } from '@orca-tts/core'

/**
 * The format vocabulary, RESTATED from `AudioChunk`'s doc comment rather than imported (P36) --
 * there is nothing to import: `format` is typed `string`, so the vocabulary exists only in prose.
 * That is itself the finding. If this list drifts from the doc comment, this test is wrong in a
 * visible, arguable way, which is the point.
 */
const DECLARED_FORMATS = ['wav', 'pcm-s16le', 'mp3', 'opus'] as const

/** Captures the path the sink chose, without playing anything. */
function recordingSink (seen: string[]): SubprocessSink {
  return new SubprocessSink({
    platform: 'linux',
    players: [{ cmd: 'sh', args: (file: string) => { seen.push(file); return ['-c', 'exit 0'] } }]
  })
}

function chunk (format: string): AudioChunk {
  return { data: new Uint8Array([1, 2, 3, 4]), format, sampleRate: 22050, channels: 1 }
}

describe('SC-9 — every format a provider may declare reaches the player as that format', () => {
  it('names the file after the format for wav, which is the one format that works today', async () => {
    const seen: string[] = []
    await recordingSink(seen).enqueue(chunk('wav'))
    expect(seen[0]?.endsWith('.wav')).toBe(true)
  })

  /**
   * CLOSED by J26. Every non-wav format used to collapse to `chunk.bin`, so a player that
   * dispatches on extension was handed a file it could not identify. `SubprocessSink` now carries
   * a format-to-extension table and never writes `bin`.
   *
   * The expected extensions are RESTATED here (P36) rather than imported from that table: a test
   * that asked the sink what extension it uses would agree with it by construction.
   *
   * [CLOSED: 018 R9-05 — seen red before the marker came off]
   */
  it('names the file after the format for every declared format [was OPEN: R9-05]', async () => {
    for (const format of DECLARED_FORMATS) {
      const seen: string[] = []
      await recordingSink(seen).enqueue(chunk(format))
      expect(seen[0], format).toContain(format === 'pcm-s16le' ? 'pcm' : format)
    }
  })

  /**
   * The weaker contract, and the one that actually protects the listener: if the sink cannot play a
   * format, SOMETHING must say so. It does not have to be this file's job to play opus; it does
   * have to be somebody's job to announce that opus was not played.
   *
   * CLOSED by J26. It used to be that an unknown format produced no `PlaybackFailure`, because the
   * fake player exits 0 on the `.bin` file and the sink counted the bytes as played. On a real
   * machine the player would exit non-zero and `onFailure` WOULD fire -- so the harm was never
   * that failure is silent, it was that the sink reported SUCCESS for a format it never handled,
   * and `bytesPlayed` (the self-test's only evidence that audio is alive) moved for audio nobody
   * heard.
   *
   * The fix is stated as a rule about EVIDENCE, not about decoding: a zero exit is accepted as
   * proof of playback only for a format that has been verified end to end. Everything else is
   * played, and then announced as unverified. Restated here rather than imported: this test says
   * `opus` must not be counted, and says nothing about which table the sink keeps.
   *
   * [CLOSED: 018 R9-06 — seen red before the marker came off]
   */
  it('refuses a format it cannot play, rather than reporting bytes played [was OPEN: R9-06]', async () => {
    const seen: string[] = []
    const failures: unknown[] = []
    const sink = new SubprocessSink({
      platform: 'linux',
      onFailure: (f) => failures.push(f),
      players: [{ cmd: 'sh', args: (file: string) => { seen.push(file); return ['-c', 'exit 0'] } }]
    })
    await sink.enqueue(chunk('opus'))
    expect(failures.length, 'an unplayable format was reported as played').toBeGreaterThan(0)
    expect(sink.bytesPlayed, 'bytesPlayed moved for audio nobody heard').toBe(0)
  })

  /**
   * CONTROL, and the reason the test above is not passing vacuously: the SAME sink, the SAME fake
   * player exiting 0, and a format that IS verified must announce nothing and must move the byte
   * counter. Without this row a sink that announced a loss for every chunk -- including wav --
   * would pass the test above and be worse than the defect it replaced.
   */
  it('CONTROL: a verified format announces nothing and does move bytesPlayed', async () => {
    const failures: unknown[] = []
    const sink = new SubprocessSink({
      platform: 'linux',
      onFailure: (f) => failures.push(f),
      players: [{ cmd: 'sh', args: () => ['-c', 'exit 0'] }]
    })
    await sink.enqueue(chunk('wav'))
    expect(failures, 'wav is verified; announcing it would be a false alarm').toEqual([])
    expect(sink.bytesPlayed, 'the one format that works must still count').toBe(4)
  })
})
