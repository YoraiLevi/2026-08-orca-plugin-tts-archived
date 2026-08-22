import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Chunker } from '../chunker/index.ts'
import { extractSpeakFence, normalize } from './index.ts'

/**
 * M14 — GATES G3 AND G4, driven end to end.
 *
 * `.meta/goal/phase2-m12-m17/contract.md`:
 *
 *   G3 — M14a, holdable with no agent cooperation. The motivating fixture is NOT spoken as
 *        box-drawing characters, and what was skipped is announced BY NAME.
 *        Oracle: the fixture through `normalize()` -> chunker -> provider, asserting the spoken
 *        string. P30: the announcement is in the audio stream, never only a log.
 *   G4 — M14b, the enhancement. Given the same fixture WITH a ```speak block, the one-sentence
 *        description is what is spoken.
 *
 * WHY THIS RUNS THE WHOLE CHAIN rather than asserting on `normalize()` alone. P30's entire finding
 * is that a correct mechanism can deliver to the wrong address and look identical in a diff. The
 * only address that counts here is the synthesizer's input, so the assertions below are made on
 * the text a PROVIDER was really handed, one utterance at a time, after chunking. A normalizer
 * unit test cannot see a chunker that drops the announcement into a chunk nothing synthesizes.
 *
 * The three-step assembly mirrors `packages/plugin/src/speech-service.ts` `#speak()` — normalize,
 * `new Chunker`, `provider.generate(chunk.text)` — restated here rather than imported, so this
 * gate does not depend on a file two peers are editing this session and does not become vacuous
 * if that method is refactored.
 */

const FIXTURE_DIR = fileURLToPath(new URL('../../../../fixtures/', import.meta.url))
const read = (name: string): string => readFileSync(`${FIXTURE_DIR}${name}`, 'utf8')

/**
 * The corpus MINUS `code-heavy.md`, which really does carry a ```speak fence — its provenance
 * comment says so: "fenced blocks (tagged, untagged, `speak`) ... design 002 (a ```speak fence is
 * announced as an omission today)". It is the positive case and gets its own row below; putting it
 * here would have turned the identity property into an assertion that the extractor never fires.
 */
const MARKER_FREE = [
  'architecture.md', 'hostile.md', 'paths.md', 'short.md', 'tables.md'
] as const

/** Box drawing, block elements, geometric shapes: everything a terminal diagram is drawn with. */
const BOX_CHARACTER = /[─-◿]/u

/** A provider that synthesizes one empty frame and remembers everything it was asked to say. */
class RecordingProvider {
  readonly utterances: string[] = []
  async *generate(text: string): AsyncGenerator<Uint8Array> {
    this.utterances.push(text)
    yield new Uint8Array(0)
  }
}

/** Everything the synthesizer was handed, in order. */
async function spokenAloud(md: string): Promise<string[]> {
  const provider = new RecordingProvider()
  const chunker = new Chunker({})
  const text = normalize(md)
  let frames = 0
  for (const chunk of [...chunker.addText(text), ...chunker.finish()]) {
    for await (const audio of provider.generate(chunk.text)) frames += audio.length + 1
  }
  // The generator really was driven to completion. Without this, a provider that recorded the
  // text and never yielded would look identical, and the chain would not have been walked.
  expect(frames, 'the provider was never actually consumed').toBe(provider.utterances.length)
  return provider.utterances
}

describe('G3 — M14a: the diagram is not spoken as box characters, and the skip is NAMED', () => {
  it('the motivating fixture reaches the synthesizer with no box character in it', async () => {
    const raw = read('hostile.md')
    // The negative control, first. Without it the assertion below could pass on a fixture that
    // never contained a diagram, which is a check that could not have failed.
    expect(raw, 'hostile.md no longer carries the diagram this gate is about').toMatch(BOX_CHARACTER)

    const heard = (await spokenAloud(raw)).join('')
    expect(heard, 'a box-drawing character reached the synthesizer').not.toMatch(BOX_CHARACTER)
  })

  it('the audio stream NAMES what was skipped, and names it by its own labels', async () => {
    const heard = (await spokenAloud(read('hostile.md'))).join('')

    // P30: the loss terminates in the channel the listener actually has.
    expect(heard, 'the loss was silent, or reached only a log').toContain('a diagram is omitted')

    /**
     * THE DELIVERABLE, and the reason "a diagram was skipped" would not have been one. Each phrase
     * is a BOX of the fixture's diagram, reassembled from two lines by column overlap. Written out
     * here rather than derived from the fixture, so editing the fixture cannot make this vacuous.
     */
    expect(heard).toContain('transcript watcher')
    expect(heard).toContain('normalizer (seventeen stages)')
    expect(heard).toContain('synthesizer (Piper)')
    expect(heard).toContain('barge-in')
  })

  /**
   * The lead-in is its own sentence, so the chunker gives it its own utterance and the engine
   * pauses either side of it — CODE_PLACEHOLDER's property, deliberately reused. What matters is
   * that the labels arrive in the NEXT utterance and nothing is interleaved between the warning
   * and the content: an announcement whose subject turns up three utterances later is a warning
   * about nothing.
   */
  it('the labels arrive in the utterance immediately after the lead-in', async () => {
    const heard = await spokenAloud(read('hostile.md'))
    const at = heard.findIndex((u) => u.includes('a diagram is omitted'))
    expect(at, 'no utterance carried the lead-in').toBeGreaterThanOrEqual(0)
    expect(heard.filter((u) => u.includes('a diagram is omitted')),
      'the lead-in was split across utterances').toHaveLength(1)
    expect(heard[at + 1], 'the labels did not follow the warning').toContain('transcript watcher')
  })

  it('the prose either side of the diagram is untouched', async () => {
    const heard = (await spokenAloud(read('hostile.md'))).join('')
    expect(heard).toContain('Here is the shape of the pipeline')
    expect(heard).toContain('That diagram carries the whole design')
  })
})

/**
 * The one-sentence description a cooperating agent would have written for `hostile.md`'s diagram.
 * Appended to the SAME fixture, so G3 and G4 are provably two readings of one input.
 */
const SPEAK_BLOCK =
  '\n\n```speak\n' +
  'The transcript watcher feeds the normalizer, which feeds the synthesizer, and barge-in ' +
  'runs back from the synthesizer to the watcher.\n' +
  '```\n'

describe('G4 — M14b: with a ```speak block, the description is what is spoken', () => {
  it('the one-sentence description is what the synthesizer is handed', async () => {
    const withMarker = read('hostile.md') + SPEAK_BLOCK
    const { spoken } = extractSpeakFence(withMarker)
    expect(spoken, 'the marker was not found in a reply that carries one').not.toBeNull()

    const heard = (await spokenAloud(spoken as string)).join('')
    expect(heard).toBe(
      'The transcript watcher feeds the normalizer, which feeds the synthesizer, ' +
      'and barge-in runs back from the synthesizer to the watcher.'
    )
    // And none of the reply it replaced came with it.
    expect(heard).not.toContain('a diagram is omitted')
    expect(heard).not.toMatch(BOX_CHARACTER)
  })

  it('the reply MINUS the marker is still the reply, so a supplementing policy is reachable', async () => {
    const withMarker = read('hostile.md') + SPEAK_BLOCK
    const { rest } = extractSpeakFence(withMarker)
    // D002 Q5: `spoken-then-prose` and `prose-only` both need the prose back, intact.
    expect(rest).toContain('That diagram carries the whole design')
    expect(rest).not.toContain('```speak')
    const heard = (await spokenAloud(rest)).join('')
    expect(heard).toContain('a diagram is omitted')
  })

  /**
   * D002's load-bearing sentence: "The extractor's absence-case must be the IDENTITY FUNCTION, and
   * its presence-case must be the only behaviour change." Byte equality, on the whole corpus.
   */
  it('IDENTITY: a reply with no marker comes out byte-identical', () => {
    for (const name of MARKER_FREE) {
      const raw = read(name)
      const { spoken, rest } = extractSpeakFence(raw)
      expect(spoken, `${name} produced a marker it does not contain`).toBeNull()
      expect(rest, `${name} was rewritten by an extractor that found nothing`).toBe(raw)
    }
    // The corpus is a claim about coverage; a silently-empty one would make the loop free.
    expect(MARKER_FREE.length).toBeGreaterThanOrEqual(5)
  })

  it('CONTROL: the one committed fixture that DOES carry a marker is found', () => {
    const { spoken, rest } = extractSpeakFence(read('code-heavy.md'))
    expect(spoken, 'the extractor found nothing in the fixture written to carry a marker')
      .toBe('The tests pass. Nine files changed.')
    expect(rest).not.toBe(read('code-heavy.md'))
    expect(rest, 'the surrounding reply went with the marker').toContain('I traced the stutter')
  })

  it('an EMPTY marker is treated as absent, identity included', () => {
    const md = 'Some prose.\n\n```speak\n\n```\n'
    expect(extractSpeakFence(md)).toEqual({ spoken: null, rest: md })
  })

  /**
   * The buzz #6298 shape one level down: a reply that SHOWS somebody the convention writes
   * ```speak inside an outer fence. Extracting that example would speak the documentation instead
   * of the answer, with no error anywhere.
   */
  it('a ```speak written INSIDE another fence is an example, not an instruction', () => {
    const md = ['Write it like this:', '', '````markdown', '```speak', 'not this', '```',
      '````', '', 'And that is all.'].join('\n')
    expect(extractSpeakFence(md).spoken).toBeNull()
  })

  it('the marker is never announced as a code block, whatever the codeBlocks policy', () => {
    const md = 'Before.\n\n```speak\nJust this sentence.\n```\n\nAfter.'
    for (const codeBlocks of ['announce', 'drop'] as const) {
      const out = normalize(md, { codeBlocks })
      expect(out, `policy ${codeBlocks} announced the spoken channel as code`)
        .not.toContain('a code block is omitted')
      expect(out, `policy ${codeBlocks} swallowed the marker body`).toContain('Just this sentence.')
    }
    // CONTROL: an ordinary fence in the same shape IS still announced, so the assertion above is
    // about the info string and not about fences having quietly stopped being announced.
    expect(normalize('Before.\n\n```ts\nconst x = 1\n```\n\nAfter.'))
      .toContain('a code block is omitted')
  })
})
