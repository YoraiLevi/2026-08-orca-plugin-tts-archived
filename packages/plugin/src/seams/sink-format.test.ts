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
 * bit:
 *
 *     const file = join(dir, `chunk.${chunk.format === 'wav' ? 'wav' : 'bin'}`)
 *
 * Everything that is not `wav` is written to a file called `chunk.bin` and handed to `afplay` /
 * `aplay` / `powershell`, which identify audio BY EXTENSION AND HEADER. There is no validation, no
 * refusal, and -- the part that matters -- no announcement.
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
   * VIOLATED TODAY. Every non-wav format collapses to `chunk.bin`, so a player that dispatches on
   * extension is handed a file it cannot identify. Remove `.fails` when the sink either maps the
   * full vocabulary or refuses an unknown format by name.
   *
   * [OPEN: 018 R9-05]
   */
  it.fails('names the file after the format for every declared format [OPEN: R9-05]', async () => {
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
   * VIOLATED TODAY: an unknown format produces no `PlaybackFailure`, because the fake player exits
   * 0 on the `.bin` file and the sink counts the bytes as played. On a real machine the player
   * would exit non-zero and `onFailure` WOULD fire -- so the harm is not that failure is silent,
   * it is that the sink reports SUCCESS for a format it never handled, and `bytesPlayed` (the
   * self-test's only evidence that audio is alive) moves for audio nobody heard.
   *
   * [OPEN: 018 R9-06]
   */
  it.fails('refuses a format it cannot play, rather than reporting bytes played [OPEN: R9-06]', async () => {
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
})
