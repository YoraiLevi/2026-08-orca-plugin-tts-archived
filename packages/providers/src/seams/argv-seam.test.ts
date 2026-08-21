/**
 * SC-3 (v2) — seam 4: the `Chunker` → the engine's ARGUMENT VECTOR, on all three platforms.
 *
 * WHY THIS FILE REPLACES THE ORIGINAL SC-3, stated first because the correction is the finding.
 *
 * SC-3 as first written asserted `argvIsSafeForBareExec(chunk.text)` — a property of the CHUNK. That
 * was wrong, and wrong in the exact way `006` section 22 exists to catch. Chunk text will never be
 * safe for a bare exec: an agent reply may legitimately open with a markdown horizontal rule, and
 * `normalize()` is right to keep it. **Nothing the chunker can ever do would make that assertion
 * pass.** So once J24 fixed the real defect, the row sat `it.fails`-green forever — an indicator
 * that cannot go red for the thing it was built to detect, which is **P32's shape, in the
 * instrument rather than in the code.** Round 9 wrote it; the team lead caught it from J24's fix.
 *
 * **The contract is a property of the ARGUMENT VECTOR THE PROVIDER BUILDS, not of the text it was
 * handed.** Restated:
 *
 *   > For every chunk in the hostile corpus, on every platform branch, the constructed argv
 *   > delivers the text as an OPERAND and never as an OPTION.
 *
 * That is checkable for macOS, Linux AND Windows on one machine, because J24 made the builders pure
 * and exported them for this: *"an argument vector is the one thing in this file that can be checked
 * without a machine of that OS… These exports exist so ONE hostile corpus can be run through ALL
 * THREE."* It therefore also closes `006` section 22.5's *"Windows and Linux are reasoned from
 * source"* gap **for this row specifically** — not by finding a real box, but by moving the claim to
 * something a pure function can answer.
 *
 * **Windows needs a DIFFERENT assertion for the same property**, and that is the point of R8-06
 * rather than an inconvenience: the text never occupies an argv position at all, so the R8-04 class
 * cannot exist there by construction. One concept, three implementations — which is exactly why
 * they must be checked against one corpus.
 */
import { describe, expect, it } from 'vitest'
import { normalize, Chunker } from '@orca-tts/core'
import { darwinCommand, win32Command, linuxCommand } from '../os-synth/index.ts'

/**
 * Inputs whose FIRST CHUNK begins with a character an argv parser reads as an option, plus the
 * in-band-command case. Restated here rather than imported from the core seam corpus: this file
 * asserts a different property and must be able to disagree with it.
 */
const HOSTILE = [
  ['horizontal rule first', '---\n\n# Heading\n\nBody text here.'],
  ['setext underline', 'Title\n-----\n\nBody.'],
  ['long option shape', '--rate=300 hello there.'],
  ['short option shape', '-f /etc/passwd is not a file to read.'],
  ['negative number first', '-5 degrees today.'],
  ['bare dash', '- alone on a line.'],
  ['double dash alone', '-- and then some words.']
] as const

/**
 * The neutralisation the provider applies before any text reaches an engine, RESTATED (P36).
 * Importing `neutralizeInBandCommands` would compare the builder against itself.
 */
const neutralised = (text: string): string => text.replace(/\[\[/g, '[ [')

/** The in-band-command case lives on its own, because it tests a DIFFERENT property — see R10-07. */
const IN_BAND = 'The token [[volm 0.2]] should be spoken, not executed.'

function firstChunk (src: string): string {
  const spoken = normalize(src, {})
  const c = new Chunker({})
  const chunks = [...c.addText(spoken), ...c.finish()]
  return chunks[0]?.text ?? ''
}

describe('SC-3 (v2) — the constructed argv delivers the text as an operand, never as an option', () => {
  it('the corpus really does produce option-shaped chunks, or this file proves nothing', () => {
    // The control. If normalize()+Chunker stopped emitting leading-dash chunks, every assertion
    // below would pass vacuously and this row would become decoration.
    const leading = HOSTILE.map(([, src]) => firstChunk(src)).filter((t) => t.startsWith('-'))
    expect(leading.length, 'no corpus row produces an option-shaped chunk any more').toBeGreaterThan(0)
  })

  describe('darwin — separated by the POSIX end-of-options marker', () => {
    for (const [name, src] of HOSTILE) {
      it(`${name}: the text follows \`--\``, () => {
        const text = firstChunk(src)
        const { cmd, args } = darwinCommand(text, '/tmp/out.wav', {})
        expect(cmd).toBe('say')
        const sep = args.indexOf('--')
        expect(sep, `no \`--\` in ${JSON.stringify(args)}`).toBeGreaterThanOrEqual(0)
        expect(args[sep + 1], 'the text is not the operand right after `--`').toBe(neutralised(text))
        expect(args.length, 'something follows the operand, so it is not the last word')
          .toBe(sep + 2)
        // And nothing BEFORE the separator is the user's text, which is the failure mode itself.
        expect(args.slice(0, sep)).not.toContain(text)
      })
    }
  })

  describe('linux — the same marker, on every rung of the ladder', () => {
    for (const backend of ['espeak-ng', 'espeak', 'spd-say'] as const) {
      for (const [name, src] of HOSTILE) {
        it(`${backend}, ${name}: the text follows \`--\``, () => {
          const text = firstChunk(src)
          const { args } = linuxCommand(backend, text, '/tmp/out.wav', {})
          const sep = args.indexOf('--')
          expect(sep, `no \`--\` in ${JSON.stringify(args)}`).toBeGreaterThanOrEqual(0)
          expect(args[sep + 1]).toBe(neutralised(text))
          expect(args.length).toBe(sep + 2)
        })
      }
    }
  })

  describe('win32 — the same property by construction, so a different assertion', () => {
    for (const [name, src] of HOSTILE) {
      it(`${name}: the text never occupies an argv position at all`, () => {
        const text = firstChunk(src)
        const { cmd, args } = win32Command(text, 'C:\\tmp\\out.wav', {})
        expect(cmd).toBe('powershell')
        // Not "the text is quoted" — the stronger and simpler claim: no ELEMENT is the text.
        // A leading `-` inside a PowerShell single-quoted literal is a character, not an option.
        expect(args, 'the text is its own argv element, which is the R8-04 class')
          .not.toContain(text)
        expect(args.at(-1), 'the script is not the last argument').toContain('System.Speech')
        expect(args.at(-1)).toContain(text.replace(/'/g, "''"))
      })
    }
  })

  /**
   * R8-06, promoted from an observation to an assertion. Three branches invented three answers to
   * one question — "how does user text reach an engine safely?" — and no test compared them. That
   * is what produced R8-04. This is the comparison.
   */
  it('R8-06 — all three platform branches agree on the one property, over one corpus', () => {
    for (const [name, src] of HOSTILE) {
      const text = firstChunk(src)
      const verdicts = {
        darwin: (() => { const a = darwinCommand(text, '/tmp/o.wav', {}).args; return a[a.indexOf('--') + 1] === neutralised(text) })(),
        linux: (() => { const a = linuxCommand('espeak-ng', text, '/tmp/o.wav', {}).args; return a[a.indexOf('--') + 1] === neutralised(text) })(),
        win32: !win32Command(text, 'C:\\o.wav', {}).args.includes(text)
      }
      expect(verdicts, `${name}: the platforms disagree about whether this text is safe`)
        .toEqual({ darwin: true, linux: true, win32: true })
    }
  })
})

/**
 * R10-07 — the exports built so one corpus could check all three still do not agree.
 *
 * `linuxCommand` neutralises `[[` itself, and its source says exactly why:
 *
 *   > "Also neutralized here, not only at `#command`: this builder is exported and is what the
 *   >  tests (and any future caller) reach, and the operation is idempotent, so belt-and-braces is
 *   >  free."
 *
 * **That reasoning applies word for word to `darwinCommand` and `win32Command`, which are now also
 * exported — and neither does it.** Measured here: run one corpus row through all three and the
 * operand is neutralised on Linux and raw on macOS and Windows.
 *
 * **Production is safe**: `#command` neutralises once at the spawn boundary before dispatching, so
 * nothing a listener hears is affected today. The hazard is in the SEAM the exports created. A
 * direct caller of `darwinCommand` — the exact caller the Linux builder's comment anticipates —
 * gets an argv carrying live `[[volm 0.2]]`, which is **NM14**: an agent reply that silently sets
 * the assistive tool's volume to zero.
 *
 * This is **R8-06's residual**, and its shape is the reason R8-06 was a row rather than a footnote:
 * one concept, three implementations, and fixing the separator asymmetry left the neutralisation
 * asymmetry standing. Three branches still answer *"how does user text reach an engine safely?"*
 * differently.
 *
 * Marked `it.fails` rather than left blocking, unlike SC-13 and SC-14: nothing a listener can hear
 * is wrong today. Remove the marker when all three builders neutralise.
 */
describe('R10-07 — one concept, three implementations, still not agreeing', () => {
  it.fails('every exported builder neutralises in-band commands [OPEN: R10-07]', () => {
    const darwin = darwinCommand(IN_BAND, '/tmp/o.wav', {}).args
    const linux = linuxCommand('espeak-ng', IN_BAND, '/tmp/o.wav', {}).args
    const win = win32Command(IN_BAND, 'C:\\o.wav', {}).args

    const carriesLiveCommand = (s: string): boolean => s.includes('[[')
    expect({
      darwin: carriesLiveCommand(darwin[darwin.indexOf('--') + 1] ?? ''),
      linux: carriesLiveCommand(linux[linux.indexOf('--') + 1] ?? ''),
      win32: carriesLiveCommand(win.at(-1) ?? '')
    }, 'a builder handed an agent reply containing [[ passes it to the engine live (NM14)')
      .toEqual({ darwin: false, linux: false, win32: false })
  })

  it('the asymmetry is real and this test can see it: Linux neutralises, the other two do not', () => {
    const linux = linuxCommand('espeak-ng', IN_BAND, '/tmp/o.wav', {}).args
    const darwin = darwinCommand(IN_BAND, '/tmp/o.wav', {}).args
    expect(linux[linux.indexOf('--') + 1], 'linux stopped neutralising').toBe(neutralised(IN_BAND))
    expect(darwin[darwin.indexOf('--') + 1], 'darwin started neutralising — remove the it.fails above')
      .toBe(IN_BAND)
  })

  /**
   * The control for this whole file, and it is permanent rather than a one-off mutation.
   *
   * Proving a seam row can go red normally means editing the code under test — which is not
   * available here: `os-synth` belongs to another agent and a temporary mutation in a tree five
   * agents share is how P34 happens. So the assertion is run against a DELIBERATELY BROKEN builder
   * defined right here, and required to fail. If it ever stops failing, every row above has
   * stopped meaning anything and this row says so.
   */
  it('CONTROL: the argv assertion rejects a builder that forgets the separator', () => {
    const broken = (text: string): string[] => ['-o', '/tmp/o.wav', text]   // no `--`
    const text = firstChunk('---\n\n# Heading\n\nBody.')
    expect(text.startsWith('-'), 'the corpus stopped producing an option-shaped chunk').toBe(true)
    const args = broken(text)
    expect(() => {
      const sep = args.indexOf('--')
      expect(sep).toBeGreaterThanOrEqual(0)
    }, 'the assertion accepted an argv with no end-of-options marker').toThrow()
  })

})
