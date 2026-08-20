import { describe, expect, it } from 'vitest'
import { normalize } from './index.js'

/**
 * Table-driven. One named case per markdown construct.
 * Rules ported from block/buzz `preprocess_for_tts` (see docs/.research/prior-art-buzz.md,
 * "Speech text normalization"), plus the four constructs buzz does not handle.
 */
type Case = { name: string; input: string; expect: string }

const run = (cases: Case[]) => {
  for (const c of cases) {
    it(c.name, () => { expect(normalize(c.input)).toBe(c.expect) })
  }
}

describe('T021a fenced code blocks', () => {
  run([
    { name: 'fenced block becomes a spoken placeholder',
      input: 'Before\n```js\nconst x = 1\n```\nAfter', expect: 'Before code block omitted After' },
    { name: 'tilde fence behaves the same',
      input: 'Before\n~~~\nraw\n~~~\nAfter', expect: 'Before code block omitted After' },
    { name: 'unclosed fence omits the remainder',
      input: 'Before\n```js\nconst x = 1\nnever closed', expect: 'Before code block omitted' }
  ])
})

describe('T021b inline code', () => {
  run([
    { name: 'backticks stripped, content kept', input: 'Call `foo()` now', expect: 'Call foo() now' },
    { name: 'unclosed backtick emits remainder as-is', input: 'Call `foo', expect: 'Call foo' }
  ])
})

describe('T021c urls', () => {
  run([
    { name: 'bare url becomes a placeholder', input: 'See https://example.com now', expect: 'See link omitted now' },
    { name: 'sentence punctuation after a url is preserved', input: 'See https://example.com.', expect: 'See link omitted.' },
    { name: 'markdown link keeps its label', input: 'See [the docs](https://example.com) now', expect: 'See the docs now' }
  ])
})

describe('T021d strong/strike markers', () => {
  run([
    { name: 'bold markers removed', input: 'This is **important** ok', expect: 'This is important ok' },
    // DELIBERATE DEVIATION from buzz, which strips `__x__` as bold. `__x__` is lexically
    // indistinguishable from a dunder, and mangling `__init__` in a coding agent's reply is worse
    // than reading two underscores aloud in the rare `__bold__`. See normalizer README.
    { name: 'double underscore is PRESERVED (dunder-safe)', input: 'This is __important__ ok', expect: 'This is __important__ ok' },
    { name: 'strikethrough removed', input: 'This is ~~gone~~ ok', expect: 'This is gone ok' }
  ])
})

describe('T021e emphasis vs identifiers', () => {
  run([
    { name: 'word-wrapping underscore emphasis is stripped', input: 'a _word_ here', expect: 'a word here' },
    { name: 'single asterisk emphasis is stripped', input: 'a *word* here', expect: 'a word here' }
  ])
})

// The anti-goal case. This is the M2 gate: identifiers must never be mangled.
describe('T021f identifiers survive untouched', () => {
  run([
    { name: 'snake_case survives', input: 'the snake_case value', expect: 'the snake_case value' },
    { name: 'function with underscore survives', input: 'call foo_bar() twice', expect: 'call foo_bar() twice' },
    { name: 'dunder survives', input: 'use __init__ here', expect: 'use __init__ here' },
    { name: 'multiple underscores survive', input: 'a_b_c_d stays', expect: 'a_b_c_d stays' }
  ])
})

describe('T021g emoji', () => {
  run([
    { name: 'emoji removed', input: 'done 🎉 now', expect: 'done now' },
    { name: 'zwj sequence removed', input: 'hi 👩‍💻 there', expect: 'hi there' },
    { name: 'ascii emoticon left alone', input: 'nice :) ok', expect: 'nice :) ok' }
  ])
})

describe('T021h numbers and times', () => {
  run([
    { name: 'small integer expanded', input: 'it took 42 tries', expect: 'it took forty two tries' },
    { name: 'zero expanded', input: 'we had 0 errors', expect: 'we had zero errors' },
    { name: 'time with minutes', input: 'at 11:30 today', expect: 'at eleven thirty today' },
    { name: 'time on the hour', input: 'at 9:00 today', expect: 'at nine today' },
    { name: 'time with oh-five', input: 'at 9:05 today', expect: 'at nine oh five today' },
    { name: 'decimal left for the engine', input: 'pi is 3.14 ok', expect: 'pi is 3.14 ok' },
    { name: 'very large number left for the engine', input: 'about 5000000 rows', expect: 'about 5000000 rows' }
  ])
})

describe('T021i whitespace and trivial results', () => {
  run([
    { name: 'whitespace runs collapse', input: 'a   b\n\n\nc', expect: 'a b c' },
    { name: 'a lone period is suppressed so TTS never says "period"', input: '.', expect: '' },
    { name: 'a lone comma is suppressed', input: ',', expect: '' },
    { name: 'empty input yields empty output', input: '', expect: '' }
  ])
})

describe('T022a headings become pauses', () => {
  run([
    { name: 'atx heading becomes a sentence', input: '# Results\nAll good', expect: 'Results. All good' },
    { name: 'deep heading behaves the same', input: '### Deep\ntext', expect: 'Deep. text' },
    { name: 'heading already ending in punctuation is not doubled', input: '# Done!\ntext', expect: 'Done! text' },
    { name: 'a hash mid-sentence is not a heading', input: 'issue #42 filed', expect: 'issue #42 filed' },
    { name: 'a language name containing a hash survives', input: 'C# is fine', expect: 'C# is fine' }
  ])
})

describe('T022b list items become sentences', () => {
  run([
    { name: 'dash list', input: '- alpha\n- beta', expect: 'alpha. beta.' },
    { name: 'asterisk list', input: '* alpha\n* beta', expect: 'alpha. beta.' },
    { name: 'ordered list drops the numeral marker', input: '1. alpha\n2. beta', expect: 'alpha. beta.' },
    { name: 'item already punctuated is not doubled', input: '- alpha.\n- beta', expect: 'alpha. beta.' }
  ])
})

describe('T022c tables announced by row', () => {
  run([
    { name: 'table row is spoken as cells, separator row dropped',
      input: '| a | b |\n| --- | --- |\n| 1 | 2 |',
      expect: 'a, b. one, two.' }
  ])
})

describe('T022d file paths', () => {
  run([
    { name: 'path is spoken as its basename with a locator by default',
      input: 'edit src/core/main.ts now', expect: 'edit main.ts in src/core now' },
    { name: 'bare filename is left alone', input: 'edit main.ts now', expect: 'edit main.ts now' }
  ])
})

describe('T023 tool noise produces nothing', () => {
  run([
    { name: 'a message that is only a code block yields empty', input: '```\nls -la\n```', expect: 'code block omitted' },
    { name: 'a message that is only a url yields a placeholder', input: 'https://example.com', expect: 'link omitted' }
  ])
})

describe('T024 no residual markdown metacharacters', () => {
  const CORPUS = ['**a**', '_b_', '`c`', '# d', '- e', '| f |', '~~g~~', '[h](https://x.y)', '### i', '1. j']
  it('generated combinations leave no markdown metacharacters', () => {
    let checked = 0
    for (let i = 0; i < CORPUS.length; i++) {
      for (let j = 0; j < CORPUS.length; j++) {
        // Newline separators: heading/list/table rules are line-based by definition, so a
        // generator that buries `# d` mid-sentence is testing a construct that does not exist.
        for (const sep of ['\n', '\n\n']) {
          const out = normalize(`${CORPUS[i]}${sep}${CORPUS[j]}`)
          expect(out, `input: ${JSON.stringify(`${CORPUS[i]}${sep}${CORPUS[j]}`)}`).not.toMatch(/[*`|~]|^#/)
          checked++
        }
      }
    }
    expect(checked).toBe(CORPUS.length * CORPUS.length * 2)
  })
})

describe('T026 options', () => {
  it('paths can be spoken verbatim when asked', () => {
    expect(normalize('edit src/a/b.ts now', { pathStyle: 'verbatim' })).toBe('edit src/a/b.ts now')
  })
  it('code blocks can be dropped silently', () => {
    expect(normalize('a\n```\nx\n```\nb', { codeBlocks: 'drop' })).toBe('a b')
  })
  it('number expansion can be disabled', () => {
    expect(normalize('it took 42 tries', { expandNumbers: false })).toBe('it took 42 tries')
  })
})
