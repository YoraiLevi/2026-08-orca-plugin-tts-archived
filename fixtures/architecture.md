<!-- T110d — a long explanation, headings, ordered and unordered lists, numbers and units.
     The queue and skip stress case: long enough to overflow the 8-deep utterance queue and to
     make the skip control matter (PITFALLS P22). -->

## Why the gap is the audio device

Short answer: every document in this repo explained the silence between sentences as the cost of
spawning one player process per chunk, and that explanation was wrong. It was wrong in a
particularly expensive way, because it was about to become the scope of a whole milestone. We
would have shipped a player pool, measured nothing, and told the user it was fixed.

Here is the decomposition that settled it. The gap measures 950 ms at p50 over eighteen sentences.
Of that:

1. The fork and exec of the player, with the audio device never opened, is 2 ms.
2. The temp file round trip — make the directory, write 56 kb, remove it — is under 1 ms.
3. Everything else, roughly 893 ms, is the audio device itself: open, pre-roll, post-roll,
   teardown.

A regression of player lifetime against audio duration over four tone lengths gives a slope of
about 1 and an intercept between 905 ms and 915 ms. That intercept is the whole finding. It is a
fixed cost per invocation, and it does not care how much audio you hand it.

### What follows from that

- Pooling or pre-warming player processes saves 2 ms out of 950. It is not a fix; it is noise.
- The question to ask of any candidate player, on any platform, is whether it holds the device
  open between buffers. Never how fast it starts.
- The same arithmetic kills the streaming argument in both directions, because the piece it
  removes is the 1 ms temp file, not the 893 ms device.

### Why the wrong answer was sticky

Two true statements sat one paragraph apart in almost every document. A process spawn *is*
expensive — the synthesizer costs 414 ms to spawn with an empty string and produce no sound at
all. And the gap *is* about 950 ms. The intuition is correct about the synth spawn and wrong about
the player spawn, and nothing in the prose distinguished them. Nobody decomposed the number
because the number already had an explanation attached.

### What this means for the queue

The utterance queue is 8 deep and keeps the newest, dropping the oldest when it overflows. With a
900 ms floor per chunk, a reply of ten sentences takes about 15 seconds to speak, and a fast agent
producing three replies in a row will overflow the queue before the first reply has finished. That
is not a hypothetical: it is the shape of every long explanation like this one.

So two things have to be true at once. The listener must be told when something was dropped —
silently discarding the reply they were waiting for is the fault this whole class of message
exists to report. And the listener must be able to abandon the current utterance in one keystroke,
because reading something you did not ask for and cannot stop is worse than silence.

That is the entire argument for holding the device open, and for the skip control landing in the
same milestone rather than the next one.
