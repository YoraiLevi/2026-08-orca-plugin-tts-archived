# Speech normalizer

Turns an agent's markdown reply into text that sounds right spoken aloud.
Pure, synchronous, **zero imports** (T027 audits this) — runs identically in a worker, a panel,
a service, and a test.

`normalize(md: string, opts?: NormalizeOptions): string`

## Stage order (load-bearing)

Block constructs are handled while line structure still exists; whitespace collapses last.

1. fenced code → `code block omitted` · 2. inline code → content kept · 3. markdown links → label
· 4. bare URLs → `link omitted` · 5. headings → pauses · 6. list items → sentences · 7. tables → rows
· 8. file paths → basename + locator · 9. emphasis markers · 10. emoji · 11. numbers/times · 12. whitespace

## Rules

| Construct | Spoken as | Note |
|---|---|---|
| ` ```fenced``` `, `~~~` | "code block omitted" | unclosed fence omits the remainder |
| `` `inline` `` | content, backticks gone | `` `foo()` `` → "foo()" |
| `https://…` | "link omitted" | trailing `.!?` preserved for sentence splitting |
| `[label](url)` | label | runs before bare-URL stripping |
| `**bold**`, `~~strike~~` | text, markers gone | |
| `_word_`, `*word*` | text, markers gone | only when they **wrap** a word |
| `snake_case`, `foo_bar()`, `a_b_c` | unchanged | explicit anti-goal — never mangle identifiers |
| `__dunder__` | **unchanged** | deviation from buzz, see below |
| `# Heading` | "Heading." + pause | `C#`, `#42` mid-line are not headings |
| `- item`, `1. item` | "item." | numeral marker dropped before number expansion |
| `\| a \| b \|` | "a, b." | separator row `\|---\|` dropped |
| `src/core/main.ts` | "main.ts in src/core" | configurable via `pathStyle` |
| emoji, ZWJ, keycaps | removed | ASCII `:)` left alone |
| `42`, `11:30`, `9:05` | "forty two", "eleven thirty", "nine oh five" | |
| `3.14`, `5000000`, `#42` | unchanged | decimals and large numbers suit the engine; `#42` is a reference |
| result of length ≤ 1 | "" | stops TTS saying "period" |

## Written for the ear, not the eye

Five changes made after a human listened to a real reply and said what grated. None were catchable
by reading the output:

| Complaint | Change |
|---|---|
| "the omission was abrupt, I didn't expect it" | placeholders became a lead-in in their own sentence: *"Here, a code block is omitted."* |
| "the URL was abruptly surprising" | links say their destination: *"a link to github dot com"* |
| "52 ms was odd to hear" | units expand: *"fifty two milliseconds"* |
| "row reading was too quick, I can't tell what I'm hearing" | every cell is paired with its header: *"Piper. Latency, fifty two milliseconds."* |
| "file paths made no sense whatsoever" | announce the name, humanise the stem, announce the folder |
| "not heads up enough… the file kind is garbled noise… extension should be last" | *"file named session handler, python, in folder src core"* — see below |

Plus keyboard glyphs, which reached the engine as garbage: `⌘⇧S` → *"command shift S"*.

### File paths

Default: `src/core/session_handler.py` → **"file named session handler, python, in folder src core"**

Three rules, each from a listener:

- **Announce that a name is coming.** "the python file X" was *"not heads up enough"* — you are
  already mid-name before realising it is a name.
- **Kind goes last.** Leading with it was *"garbled noise"*: it means nothing until you know what is
  being named.
- **Announce the folder too.** Bare "in src core" was *"hard to understand where the files are"*.

Configurable, because none of this is universal:

| Option | Result |
|---|---|
| `pathStyle: 'spoken'` *(default)* | file named session handler, python, in folder src core |
| `pathStyle: 'terse'` | session handler, in folder src core |
| `pathStyle: 'verbatim'` | src/core/session_handler.py |
| `extensionStyle: 'omit'` | file named session handler, in folder src core |
| `extensionStyle: 'raw-last'` | file named session handler, dot py, in folder src core |
| `extensionStyle: 'word-first'` | python file named session handler, in folder src core |

Trailing punctuation is split off before parsing, or `index.ts,` becomes extension `ts,` and the
full stop ending a sentence disappears into the file name.

## Deliberate deviation from buzz

buzz strips `__x__` as bold. We **preserve** it. `__x__` is lexically indistinguishable from a
Python dunder, and for an agent that talks about code, mangling `__init__` is worse than reading
two underscores aloud in the far rarer `__bold__`.

## Options

- `codeBlocks`: `'announce'` (default) | `'drop'`
- `pathStyle`: `'basename'` (default) | `'verbatim'`
- `expandNumbers`: `true` (default) | `false` — stage 14 only
- `expandUnits`: `true` (default) | `false` — stage 13 only

`expandNumbers` and `expandUnits` are SEPARATE switches, and that separation is load-bearing
(006 NM12 / section 22 SC-8). One flag used to gate both, so the Voice Lab control that declares
stage 14 also silently switched off stage 13 and re-broke "52 ms" — the exact defect the listener
had asked to have fixed.

## Tests

49 cases in `normalize.test.ts`, table-driven, one per construct, plus a property test over 200
generated combinations asserting no markdown metacharacter survives.
