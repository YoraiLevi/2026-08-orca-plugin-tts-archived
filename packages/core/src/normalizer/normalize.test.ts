import { describe, expect, it } from 'vitest'
import { normalize } from './index.ts'

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
      input: 'Before\n```js\nconst x = 1\n```\nAfter', expect: 'Before. Here, a code block is omitted. After' },
    { name: 'tilde fence behaves the same',
      input: 'Before\n~~~\nraw\n~~~\nAfter', expect: 'Before. Here, a code block is omitted. After' },
    // CHANGED DELIBERATELY (006 site 48). An unclosed fence swallows the whole remainder of the
    // reply, not just a code block, and `stripFencedCode` computed that fact and wrote
    // `void announced`. The old expectation said the listener should hear the SAME sentence for
    // "here is a code block, and the answer continues after it" and "the answer ends here and you
    // are not getting the rest" — which is the collapse this round exists to remove.
    { name: 'an unclosed fence says the rest of the reply went with it',
      input: 'Before\n```js\nconst x = 1\nnever closed',
      expect: 'Before. Here, a code block is omitted, and the reply ends inside it, ' +
        'so anything after it was not read.' }
  ])
})

describe('T140a diagrams and line art (M14a)', () => {
  run([
    /**
     * The deliverable. Box characters are the diagram's GEOMETRY and cannot be linearised into
     * audio at all; the text inside the boxes is its NOUNS and is the only part that survives.
     * Labels are merged DOWN COLUMNS, so a two-line box is one name rather than two fragments.
     */
    { name: 'a box diagram is announced by its own labels, boxes reassembled down columns',
      input: 'Before\n\u250c\u2500\u2500\u2500\u2500\u2510\n\u2502 web \u2502\n\u2502 tier \u2502\n\u2514\u2500\u2500\u2500\u2500\u2518\nAfter',
      expect: 'Before. Here, a diagram is omitted. It is labelled: web tier. After' },

    /**
     * The cap, and it says so. Reading forty cells aloud is the harm the announcement exists to
     * prevent, and an announcement that is silently partial is that harm one level up.
     */
    { name: 'more than six labels are capped, and the cap is announced',
      input: '\u2502a\u2502b\u2502c\u2502d\u2502e\u2502f\u2502g\u2502h\u2502',
      expect: 'Here, a diagram is omitted. It is labelled: a, b, c, d, e, f, and two more.' },

    // Two or more lines with nothing readable in them IS a picture, and the listener is told.
    { name: 'unlabelled art is still announced, because something really was withheld',
      input: 'Before\n\u259b\u2580\u2580\u259c\n\u2599\u2584\u2584\u259f\nAfter',
      expect: 'Before. Here, a diagram is omitted. It has no labels to read. After' },

    /**
     * The ONE silent removal this stage makes, and the judgement behind it: a lone rule carries no
     * proposition, so "a diagram is omitted" would be narration about layout — the same call
     * `stripEmoji` makes for a party popper.
     */
    { name: 'a lone unlabelled rule is layout, and goes in silence',
      input: 'Before\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nAfter',
      expect: 'Before After' },

    /**
     * The guard that keeps this stage from eating prose. One box character is a sentence ABOUT box
     * characters; a line needs two before it can be art at all.
     */
    { name: 'a sentence that MENTIONS a box character is prose, and is spoken',
      input: 'The \u2514 character is a corner.',
      expect: 'The \u2514 character is a corner.' },

    /**
     * The TWO-glyph threshold, pinned where it is the only thing deciding. A WRAPPED sentence
     * about box characters is two consecutive lines that each contain one; at a threshold of one
     * they would form a run of two and be announced as a diagram, and the ratio guard below never
     * sees a multi-line run. Without this row the constant is unfalsifiable — measured: setting
     * it to 1 left all 167 tests green `[measured-here]`.
     */
    { name: 'a WRAPPED sentence about box characters is prose, not a two-line diagram',
      input: 'The \u2514 corner and\nthe \u2518 corner are different.',
      expect: 'The \u2514 corner and the \u2518 corner are different.' },

    /**
     * The ratio guard, pinned where IT is the only thing deciding: one line, two box glyphs — so
     * it clears the threshold — but far more letters than glyphs, which makes it a sentence.
     */
    { name: 'one line with two box glyphs and mostly words is still prose',
      input: 'The \u2514 and \u2518 characters are the bottom corners of a box.',
      expect: 'The \u2514 and \u2518 characters are the bottom corners of a box.' },

    // Arrows are far too common in prose to make a line art, so they stay words (stage 12).
    { name: 'arrows in prose are still spoken as words',
      input: 'Go from A \u2192 B \u2192 C now.', expect: 'Go from A right B right C now.' },

    // Position, proved by effect. Stage 1 reached the fence first, so this is a code block.
    { name: 'a diagram INSIDE a fence is a code block, announced once and as code',
      input: 'Before\n```\n\u250c\u2500\u2500\u2510\n\u2502x \u2502\n\u2514\u2500\u2500\u2518\n```\nAfter',
      expect: 'Before. Here, a code block is omitted. After' },

    // ...and stage 2 reached the comment first, so this is not content and is not announced.
    { name: 'a diagram inside an HTML comment is not content, and is not announced',
      input: 'Before\n<!--\n\u250c\u2500\u2500\u2510\n\u2502x \u2502\n\u2514\u2500\u2500\u2518\n-->\nAfter',
      expect: 'Before After' }
  ])
})

describe('T140b the spoken channel (M14b)', () => {
  run([
    { name: 'a speak fence is the agent speaking, so its body is kept and never announced',
      input: 'Before.\n```speak\nJust this sentence.\n```\nAfter.',
      expect: 'Before. Just this sentence. After.' },
    { name: 'an annotated speak fence is still a speak fence',
      input: 'Before.\n```speak also\nJust this sentence.\n```\nAfter.',
      expect: 'Before. Just this sentence. After.' },
    // CONTROL: any other info string is still a code block.
    { name: 'a fence tagged speaker is NOT a speak fence',
      input: 'Before.\n```speaker\nnot us\n```\nAfter.',
      expect: 'Before. Here, a code block is omitted. After.' },
    // D002 Q6: an unterminated marker keeps the rest of the reply rather than swallowing it.
    { name: 'an unclosed speak fence keeps everything after it',
      input: 'Before.\n```speak\nJust this sentence.\nAnd this one.',
      expect: 'Before. Just this sentence. And this one.' }
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
    { name: 'bare url becomes a placeholder', input: 'See https://example.com now', expect: 'See a link to example dot com now' },
    { name: 'sentence punctuation after a url is preserved', input: 'See https://example.com.', expect: 'See a link to example dot com.' },
    // CHANGED DELIBERATELY (006 site 51). The destination was dropped silently while a BARE url in
    // the same reply is announced. The asymmetry is the defect, and "URLs vanished without warning"
    // is the listener's own recorded feedback on this project.
    { name: 'a markdown link says where it goes, when the label does not',
      input: 'See [the docs](https://example.com) now',
      expect: 'See the docs, a link to example dot com, now' },
    // ...and does NOT say it twice when the label already carries the host. Reading every
    // destination would be narration, which is its own harm.
    { name: 'a label that already names the host is not repeated',
      input: 'See [example.com](https://example.com) now', expect: 'See example.com now' },
    { name: 'a relative link gets no destination at all',
      input: 'See [the docs](/guide/intro) now', expect: 'See the docs now' }
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
    { name: 'multiple underscores survive', input: 'a_b_c_d stays', expect: 'a_b_c_d stays' },
    // Found by running the pipeline for real: a lone leading underscore was being stripped as an
    // unmatched emphasis opener, turning every Python private method into a public-looking one.
    { name: 'leading-underscore private survives', input: 'in _flush_buffer() now', expect: 'in _flush_buffer() now' },
    { name: 'leading underscore on a bare word survives', input: 'the _private value', expect: 'the _private value' },
    { name: 'unmatched trailing underscore survives', input: 'value_ here', expect: 'value_ here' },
    { name: 'unmatched asterisk survives', input: 'a * b', expect: 'a * b' },
    { name: 'emphasis does not pair across a line break', input: 'a _start\nend_ b', expect: 'a _start end_ b' }
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
    // CHANGED from v1, which spoke this as "alpha. beta."
    // See "ordered lists keep their numbers" at the bottom of this file.
    { name: 'ordered list keeps its ordinals', input: '1. alpha\n2. beta', expect: 'one, alpha. two, beta.' },
    { name: 'item already punctuated is not doubled', input: '- alpha.\n- beta', expect: 'alpha. beta.' }
  ])
})

describe('T022c tables announced by row', () => {
  run([
    { name: 'table row is spoken as cells, separator row dropped',
      input: '| a | b |\n| --- | --- |\n| 1 | 2 |',
      expect: 'Table. a, b. one. b, two.' }
  ])
})

describe('T022d file paths', () => {
  run([
    { name: 'path is announced, humanised, and located',
      input: 'edit src/core/main.ts now',
      expect: 'edit file named main, typescript, in folder src core, now' },
    { name: 'bare filename is left alone', input: 'edit main.ts now', expect: 'edit main.ts now' }
  ])
})

describe('T023 tool noise produces nothing', () => {
  run([
    { name: 'a message that is only a code block yields empty', input: '```\nls -la\n```', expect: 'Here, a code block is omitted.' },
    { name: 'a message that is only a url yields a placeholder', input: 'https://example.com', expect: 'a link to example dot com' }
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

  it('terse style drops the file kind entirely', () => {
    expect(normalize('edit src/core/session_handler.py now', { pathStyle: 'terse' }))
      .toBe('edit session handler, in folder src core, now')
  })

  it('the file kind can be omitted, kept raw, or moved first', () => {
    const p = 'edit src/core/session_handler.py now'
    expect(normalize(p, { extensionStyle: 'omit' }))
      .toBe('edit file named session handler, in folder src core, now')
    expect(normalize(p, { extensionStyle: 'raw-last' }))
      .toBe('edit file named session handler, dot py, in folder src core, now')
    expect(normalize(p, { extensionStyle: 'word-first' }))
      .toBe('edit python file named session handler, in folder src core, now')
  })
  it('code blocks can be dropped silently', () => {
    expect(normalize('a\n```\nx\n```\nb', { codeBlocks: 'drop' })).toBe('a b')
  })
  it('number expansion can be disabled', () => {
    expect(normalize('it took 42 tries', { expandNumbers: false })).toBe('it took 42 tries')
  })
})

/* ------------------------------------------------------------------------------------------
 * Listening feedback, 2026-08-21. Every case below comes from a human hearing a real reply and
 * saying what grated. None of these were catchable by reading the output.
 * ---------------------------------------------------------------------------------------- */

describe('L1 omissions are announced, not dropped in abruptly', () => {
  run([
    { name: 'a code block gets a lead-in and its own sentence',
      input: 'Fix it:\n```js\nx()\n```\nDone.',
      expect: 'Fix it: Here, a code block is omitted. Done.' },
    { name: 'a link says where it goes instead of vanishing',
      input: 'See https://github.com/YoraiLevi/orca-plugin-tts for details',
      expect: 'See a link to github dot com for details' },
    { name: 'link keeps sentence punctuation for the pause',
      input: 'See https://example.com.', expect: 'See a link to example dot com.' }
  ])
})

describe('L2 units are spoken as words', () => {
  run([
    { name: 'milliseconds', input: 'it took 52 ms flat', expect: 'it took fifty two milliseconds flat' },
    { name: 'seconds', input: 'waited 3 s here', expect: 'waited three seconds here' },
    { name: 'megabytes', input: 'about 50 MB total', expect: 'about fifty megabytes total' },
    { name: 'percent', input: 'at 30% used', expect: 'at thirty percent used' },
    { name: 'a bare unit word is untouched', input: 'the ms field', expect: 'the ms field' }
  ])
})

describe('L3 tables pair each value with its header', () => {
  run([
    { name: 'header row labels every cell that follows',
      input: '| Engine | Latency |\n| --- | --- |\n| Piper | fast |',
      expect: 'Table. Engine, Latency. Piper. Latency, fast.' }
  ])
})

describe('L4b trailing punctuation is not swallowed into the extension', () => {
  run([
    { name: 'a comma after a path stays a comma',
      input: 'from packages/core/index.ts, and then',
      expect: 'from file named index, typescript, in folder packages core, and then' },
    { name: 'a full stop ends the sentence rather than becoming part of the extension',
      input: 'lived in src/core/session_handler.py. There is also',
      expect: 'lived in file named session handler, python, in folder src core. There is also' },
    { name: 'a hyphenated stem is humanised',
      input: 'run scripts/smoke-activate.mjs now',
      expect: 'run file named smoke activate, javascript, in folder scripts, now' }
  ])
})

describe('L4 file paths are comprehensible', () => {
  run([
    { name: 'name is announced first, kind last, folder announced',
      input: 'see src/core/session_handler.py now',
      expect: 'see file named session handler, python, in folder src core, now' },
    { name: 'typescript file', input: 'edit packages/core/index.ts here',
      expect: 'edit file named index, typescript, in folder packages core, here' },
    { name: 'unknown extension falls back to the raw suffix, still last',
      input: 'open a/b/thing.xyz now',
      expect: 'open file named thing, dot xyz, in folder a b, now' }
  ])
})

describe('L5 keyboard symbols become words', () => {
  run([
    { name: 'command shift', input: 'press ⌘⇧S now', expect: 'press command shift S now' },
    { name: 'option control', input: 'press ⌥⌃X now', expect: 'press option control X now' }
  ])
})

/**
 * Ordered-list ordinals.
 *
 * v1 discarded them: "1. alpha / 2. beta" was spoken "alpha. beta." For a tool whose main input is
 * agent replies full of numbered procedures, losing "step 1, step 2" is a comprehension loss, not
 * a style choice — a numbered list became indistinguishable from a bullet list.
 *
 * The DEFAULT CHANGED to 'numeral'. The old behaviour is still reachable as 'drop'. Which of the
 * three sounds best is taste, and taste is settled in the Voice Lab, so this is an option and not
 * a new hardcoded opinion.
 */
describe('ordered lists keep their numbers', () => {
  it('default preserves the ordinal', () => {
    expect(normalize('1. alpha\n2. beta')).toBe('one, alpha. two, beta.')
  })

  it("'word' speaks it as an ordinal word", () => {
    expect(normalize('1. alpha\n2. beta', { orderedLists: 'word' })).toBe('first, alpha. second, beta.')
  })

  it("'drop' is v1's behaviour, still available", () => {
    expect(normalize('1. alpha\n2. beta', { orderedLists: 'drop' })).toBe('alpha. beta.')
  })

  it('bullets have no ordinal to keep, and are unchanged by the option', () => {
    for (const style of ['numeral', 'word', 'drop'] as const) {
      expect(normalize('- alpha\n- beta', { orderedLists: style })).toBe('alpha. beta.')
    }
  })

  it('numbering that does not start at 1 is preserved as written', () => {
    // Agents renumber and resume lists; speaking "one, two" over "7., 8." would be a lie.
    expect(normalize('7. seven\n8. eight', { expandNumbers: false })).toBe('7, seven. 8, eight.')
  })

  it('past the ordinal-word table it falls back to the numeral', () => {
    expect(normalize('27. late\n', { orderedLists: 'word', expandNumbers: false }))
      .toBe('number 27, late.')
  })

  it('the ordinal stays inside the item, so the chunker cannot orphan it', () => {
    // "1." as its own sentence would be split off and spoken alone. A comma keeps it attached.
    const out = normalize('1. alpha', { expandNumbers: false })
    expect(out).toBe('1, alpha.')
    expect(out).not.toContain('1. ')
  })
})

/**
 * 006 site 50 — emoji, dingbats AND CHECK MARKS were deleted with no announcement.
 *
 * The chosen outcome is neither "announce the omission" nor "leave it": a check mark is CONTENT,
 * not decoration. "✅ done" and "❌ done" reached the listener as the same word — the verdict
 * removed and only the subject left, which is 006's S1 shape (told something the agent did not
 * say) rather than its S2 one. A party popper carries no verdict and is still deleted, silently
 * and correctly: announcing it would be narration.
 */
describe('006 site 50 — a check mark is a verdict, not decoration', () => {
  it('speaks the glyphs that carry meaning', () => {
    expect(normalize('✅ the tests pass')).toContain('yes')
    expect(normalize('❌ the tests fail')).toContain('no')
    expect(normalize('⚠ be careful')).toContain('warning')
  })

  it('the two verdicts are no longer the same sentence', () => {
    // The assertion that could not have failed before: both sides normalized to "done".
    expect(normalize('✅ done')).not.toBe(normalize('❌ done'))
  })

  it('CONTROL: decorative emoji are still deleted, and not announced', () => {
    const out = normalize('\u{1F389} shipped it')
    expect(out).toContain('shipped it')
    expect(out, 'narrating a party popper is the harm on the other side').not.toMatch(/omit|emoji/i)
  })
})

/**
 * J21 bug 1 — HTML comments reached the listener.
 *
 * All six committed fixtures open with a `<!-- ... -->` provenance comment, and with no stage to
 * remove them the FIRST THING the listener heard from every one was the chunk `"<!"` — because
 * `stripMarkdownMarkers` had already eaten the `--` and the sentence splitter fell into the
 * wreckage. Then the comment body was read aloud as if it were the answer.
 *
 * These are effect assertions on both halves: what must vanish, and what must survive.
 */
describe('J21-1 HTML comments are not spoken', () => {
  run([
    { name: 'a leading comment is gone and the prose after it is intact',
      input: '<!-- T110e provenance -->\n\nYes, it works.',
      expect: 'Yes, it works.' },
    { name: 'a multi-line comment is gone',
      input: '<!-- line one\n     line two\n     line three -->\nThe answer.',
      expect: 'The answer.' },
    { name: 'an inline comment leaves a word boundary rather than fusing its neighbours',
      input: 'alpha<!--hidden-->beta',
      expect: 'alpha beta' },
    { name: 'a comment between sentences does not merge them',
      input: 'One. <!-- aside --> Two.',
      expect: 'One. Two.' },
    // The `<!` / `--` wreckage, asserted as the artefact it actually was.
    { name: 'no fragment of the marker survives to the engine',
      input: '<!-- T110a — fenced blocks, `speak`, dunders -->\nI traced it.',
      expect: 'I traced it.' }
  ])

  /**
   * ORDERING, asserted rather than described.
   *
   * Stage 1 has already removed the fence body, so a `<!--` written INSIDE a code sample never
   * reaches stage 2 — including an unterminated one, which if seen would have consumed the
   * fence's own closing delimiter and merged the code block into the prose after it.
   */
  it('a comment marker inside a fenced code block cannot reach stage 2', () => {
    // The mutation this is written against is moving stage 2 in front of stage 1. An `<!--` in a
    // code SAMPLE would then pair with a `-->` written in the PROSE much later, and everything
    // between them — the fence's own closing delimiter included — would be deleted, leaving an
    // unclosed fence that swallows the rest of the reply. Fence-first, the code block is already
    // gone and there is nothing to pair with.
    expect(normalize(
      'Before\n```html\n<!-- an example comment\n```\nAfter the block, the arrow --> is spoken.'
    )).toBe('Before. Here, a code block is omitted. After the block, the arrow --> is spoken.')
  })

  /**
   * CONTROL, labelled as one. This does NOT prove an ordering: `stripInlineCode` unwraps rather
   * than deletes, so swapping stages 2 and 3 produces byte-identical output here and on all six
   * fixtures — measured, not assumed. What it pins is the outcome the listener gets when a comment
   * carries an odd backtick, which is the shape `fixtures/code-heavy.md` actually has.
   */
  it('CONTROL: a stray backtick inside a comment does not eat the prose after it', () => {
    expect(normalize('see <!-- a `q --> and `real code` here'))
      .toBe('see and real code here')
  })

  /**
   * THE UNTERMINATED CASE, and it is deliberately the opposite of the unclosed-FENCE rule above.
   *
   * A stray `<!--` must not swallow the remainder of a reply. The content after it is ordinary
   * prose that was going to be spoken, and `<!--` occurs in innocent writing about markup. For a
   * listener who cannot see what went missing, losing the whole answer to one token is the
   * catastrophic failure; losing four marker characters is not a loss at all — so nothing is
   * announced either.
   */
  it('an unterminated comment drops the marker and still speaks the rest of the reply', () => {
    expect(normalize('The answer is ready. <!-- note to self, and the reply was cut off here'))
      .toBe('The answer is ready. note to self, and the reply was cut off here')
  })

  it('an unterminated comment is NOT announced as an omission, because nothing was omitted', () => {
    expect(normalize('Text <!-- cut')).not.toContain('omitted')
  })

  /**
   * Line structure survives the removal. Stages 6-8 are line-oriented and run after stage 2, so a
   * multi-line comment must leave its newlines behind or a heading on the line after it is lost.
   */
  it('removing a multi-line comment does not destroy the heading on the line after it', () => {
    expect(normalize('intro <!-- a\nb\n-->\n## Real Heading\n\nBody.'))
      .toBe('intro Real Heading. Body.')
  })
})

/**
 * J21 bug 2 — thousands separators.
 *
 * `p50 1,112-2,017 ms` was spoken "p50 one,one hundred twelve-two,seventeen milliseconds": the
 * digit scanner stopped at each comma, and `Number('017')` is 17, so the second group even lost
 * its leading zero. That string is this repo's own measured latency bracket, read back to the
 * author as nonsense.
 */
describe('J21-2 thousands separators are one number', () => {
  run([
    { name: 'the measured latency bracket reads as a range of two numbers',
      input: 'p50 1,112-2,017 ms',
      expect: 'p50 one thousand one hundred twelve-two thousand seventeen milliseconds' },
    { name: 'a leading zero inside a group is not dropped',
      input: 'took 2,017 ms',
      expect: 'took two thousand seventeen milliseconds' },
    { name: 'a round thousand',
      input: '1,000 files', expect: 'one thousand files' },
    { name: 'a three-digit leading group',
      input: '123,456 rows', expect: 'one hundred twenty three thousand four hundred fifty six rows' },
    // Above the expansion ceiling the numeral goes to the engine — WITH its commas, which is how
    // an engine reads a large number correctly. Joining the digits here would have been a
    // regression dressed as a fix.
    { name: 'a number past the expansion ceiling keeps its separators',
      input: 'x 12,345,678 y', expect: 'x 12,345,678 y' },
    // The guards that were already there must still hold once a run can span commas.
    { name: 'a reference keeps its numerals and its separators',
      input: 'see #1,000 now', expect: 'see #1,000 now' },
    // Not a grouped number: the run after the comma is four digits, so it is two tokens.
    { name: 'a malformed group is not joined',
      input: '1,1234 total', expect: 'one,one thousand two hundred thirty four total' },
    // Nor is a comma-separated list of numbers: the leading run is four digits.
    { name: 'a comma-separated list of numbers is not fused into one',
      input: 'ports 8080,1000 open', expect: 'ports eight thousand eighty,one thousand open' }
  ])
})
