# Speech normalizer

Turns an agent's markdown reply into text that sounds right spoken aloud.
Pure, synchronous, **zero imports** (T027 audits this) — runs identically in a worker, a panel,
a service, and a test.

`normalize(md: string, opts?: NormalizeOptions): string`

## Stage order (load-bearing)

Block constructs are handled while line structure still exists; whitespace collapses last.

1. fenced code → `code block omitted` · 2. HTML comments → removed · 3. **line art → its labels**
· 4. inline code → content kept · 5. markdown links → label · 6. bare URLs → destination
· 7. headings → pauses · 8. list items → sentences · 9. tables → rows
· 10. file paths → basename + locator · 11. emphasis markers · 12. key glyphs · 13. emoji
· 14. units · 15. numbers/times · 16. whitespace · 17. punctuation

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
| a box-drawing run | "Here, a diagram is omitted. It is labelled: …" | see **Diagrams** below |
| ` ```speak ` | its body, as prose | never announced as code, whatever `codeBlocks` says |
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

### Diagrams

`fixtures/hostile.md`'s pipeline diagram used to reach the engine intact, and the listener heard a
few hundred box characters where the explanation should have been. Stage 3 replaces a run of
box-drawing lines with one sentence:

> *"Here, a diagram is omitted. It is labelled: transcript watcher, normalizer (17 stages),
> synthesizer (Piper), barge-in."*

**Dropping the diagram is the easy half; the announcement is the deliverable** (PITFALLS P30 — a
loss the listener cannot see must be named in the audio). The split the stage makes:

- the box characters are the diagram's **geometry**. A linear audio stream cannot carry geometry at
  all, so nothing deliverable is lost by dropping it.
- the text inside the boxes is its **nouns**. That is the only part that survives linearisation, it
  costs one sentence, and it is what tells the listener whether the picture is worth asking about.

Labels are merged **down columns**, so a two-line box is one name — "transcript watcher", not
"transcript" and "watcher" three fragments apart. Six labels maximum, and past that the
announcement says *"and 9 more"*, because an announcement that buries the reply is the harm it
exists to prevent and one that hides its own truncation is that harm one level up.

Three lines it does **not** cross:

| Input | Spoken as | Why |
|---|---|---|
| `The └ character is a corner.` | unchanged | one box glyph is a sentence ABOUT box glyphs |
| a lone `──────────` | *nothing*, silently | a rule carries no proposition; announcing layout is narration |
| two unlabelled art lines | "…It has no labels to read." | that IS a picture, and something really was withheld |

The wording and the cap are **taste** (D002 Q47) and are owed a Voice Lab control. The existence of
both is correctness and lives here.

### The spoken channel

A fence whose info string is `speak` is the agent speaking, not the agent showing code. Its body is
kept as prose and it is **never** announced as a code block, whatever `codeBlocks` is set to.
`extractSpeakFence(md)` lifts it out for a caller that wants to speak it *instead of* the reply;
its absence case is the identity function, byte for byte, and that property is pinned by a test.
Choosing between the marker and the prose is a listener policy and is not decided here.

## Deliberate deviation from buzz

buzz strips `__x__` as bold. We **preserve** it. `__x__` is lexically indistinguishable from a
Python dunder, and for an agent that talks about code, mangling `__init__` is worse than reading
two underscores aloud in the far rarer `__bold__`.

## Options

- `codeBlocks`: `'announce'` (default) | `'drop'`
- `pathStyle`: `'basename'` (default) | `'verbatim'`
- `expandNumbers`: `true` (default) | `false` — stage 15 only
- `expandUnits`: `true` (default) | `false` — stage 14 only

`expandNumbers` and `expandUnits` are SEPARATE switches, and that separation is load-bearing
(006 NM12 / section 22 SC-8). One flag used to gate both, so the Voice Lab control that declares
stage 15 also silently switched off stage 14 and re-broke "52 ms" — the exact defect the listener
had asked to have fixed.

## Tests

`normalize.test.ts` is table-driven, one named case per construct, plus a property test over 200
generated combinations asserting no markdown metacharacter survives. `m14-gates.test.ts` drives
gates G3 and G4 end to end — fixture, `normalize()`, chunker, provider — and asserts on the text a
provider was really handed, because P30's finding is that a correct mechanism can deliver to the
wrong address and look identical in a diff.
