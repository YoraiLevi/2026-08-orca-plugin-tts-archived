# Streaming chunker

Turns an incrementally-arriving reply into utterances a synthesizer can speak without sounding
choppy. Pure, **zero imports**, incremental.

```ts
const c = new Chunker({ maxUnits: 200 })
c.addText('First sentence. Second ')   // -> [{ text: 'First sentence. ', boundary: 'sentence', isFirst: true }]
c.addText('sentence here.')
c.finish()
```

## Two policies, one splitter

| Chunk | Cut at | Why |
|---|---|---|
| first | the **earliest** sentence end | minimum time to first audio |
| later | the **latest** boundary that fits | fewest synthesis calls, best prosody |

One flag (`isolateFirstSentence`) switches them. There is no second code path.

## Boundary ladder

`sentence` → `clause` → `word` → `scalar`, preferring the highest that fits.

- sentence: `.!?` after skipping closing quotes/brackets, and not an abbreviation
- clause: `,;:—–` · word: whitespace · scalar: a hard cut, so one very long word cannot deadlock

## Abbreviation guard

`e.g.` `i.e.` `Dr.` `etc.` `vs.` months, `Step 1.`, `J. Smith`, and `3.14` do not end a sentence.

## The invariant that catches real bugs

`chunks.join('') === input`, exactly — trailing whitespace travels with its chunk. Asserted over
500 generated inputs (T030) and on pathological ones.

## Why streaming waits

Streaming must equal batch (T035, asserted at 5 and 1 characters per feed). The first chunk emits
the instant its sentence completes — batch would choose the same one. Later chunks **cannot** emit
on sight: a visible sentence end may be beaten by a later one that also fits. So they wait for the
buffer to overflow the limit, at which point no further boundary can join and the answer provably
equals batch's. This was a real bug caught by T035, not a theoretical concern.

## Injected size limit (T038)

`countUnits(text)` defaults to characters. Local engines pass a tokenizer; cloud engines pass a
character count. The scan stops at the first overflow, because unit cost is monotonic in prefix
length — buzz notes this scan was originally superlinear and the cost landed *before first audio*.
