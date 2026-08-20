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
| "file paths made no sense whatsoever" | *"the python file session handler, in src core"* — name the kind, humanise the stem |

Plus keyboard glyphs, which reached the engine as garbage: `⌘⇧S` → *"command shift S"*.

## Deliberate deviation from buzz

buzz strips `__x__` as bold. We **preserve** it. `__x__` is lexically indistinguishable from a
Python dunder, and for an agent that talks about code, mangling `__init__` is worse than reading
two underscores aloud in the far rarer `__bold__`.

## Options

- `codeBlocks`: `'announce'` (default) | `'drop'`
- `pathStyle`: `'basename'` (default) | `'verbatim'`
- `expandNumbers`: `true` (default) | `false`

## Tests

49 cases in `normalize.test.ts`, table-driven, one per construct, plus a property test over 200
generated combinations asserting no markdown metacharacter survives.
