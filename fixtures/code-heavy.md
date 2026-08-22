<!-- T110a — fenced blocks (tagged, untagged, `speak`), inline code, leading-underscore and
     dunder identifiers. Motivated by PITFALLS P15 (a lone `_` was once stripped as unmatched
     emphasis) and design 002 (a ```speak fence is announced as an omission today). -->

I traced the stutter to the sink, not the synthesizer.

`SubprocessSink` writes each chunk to a temp file and spawns a player, so the drain path never
gets a chance to run between chunks. The method that should have been doing that work is
`_flush_buffer()`, and it is only ever called from the constructor — which is why it looks alive
in a stack trace and is dead in practice. The dunder pair `__init__` calls it once, `__repr__`
mentions it, and nothing else touches it.

Here is the current shape:

```ts
class SubprocessSink {
  #queue: Buffer[] = []

  async write(pcm: Buffer): Promise<void> {
    this.#queue.push(pcm)
    await this.#play(pcm)
  }
}
```

The fix is to drain on a timer rather than per write:

```
async #drain() {
  while (this.#queue.length > 0) {
    await this.#play(this.#queue.shift())
  }
}
```

Note the second block has **no language tag** — that is deliberate, it is pseudocode, and the
normalizer must treat it exactly like the tagged one above.

There is one more case worth calling out:

```speak
The tests pass. Nine files changed.
```

That fence is the agent asking to be *spoken*, not to be omitted. It used to be announced as an
omission like any other block, which was the disqualifying failure arriving through the front door;
since M14a the info string is honoured whatever the code-block policy says.

Two small things while I was in there. `normalize()` is pure and imports nothing, so it stays
testable in the panel as well as the worker. And I left `__dunder__` handling alone on purpose —
mangling `__init__` is worse than reading two underscores aloud in the rarer bold case.
