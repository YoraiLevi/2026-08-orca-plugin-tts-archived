<!-- T110e — a two-sentence answer. The latency case: first audio is p50 1,112-2,017 ms
     [measured-here], so a short reply is where that cost is most audible — the wait is a large
     fraction of the whole utterance. Also the unit-and-number expansion case. -->

Yes — the first sentence is synthesized while the rest of the reply is still being written, so
you do not wait for the whole paragraph. On the `say` fallback the first audio still lands at
p50 1,112 ms, which on an answer this short is most of what you notice.
