<!-- T110b — a 2-column table, a 4-column table, a ragged table, and one with no header row.
     Motivated by the listening report: table rows were "way too quick... not obvious what I am
     hearing". The normalizer repeats the header on every cell, which is fine at 2 columns and
     punishing at 4. -->

Here is where the time actually goes.

The two-column version first, because it is the one that reads cleanly aloud:

| stage | p50 |
|---|---|
| synthesis | 58 ms |
| device open | 893 ms |
| playback | 210 ms |

Now the same measurement broken out per platform, which is where it stops being comfortable to
listen to — every value comes back paired with its column name, four times a row:

| platform | engine | first audio | inter-sentence gap |
|---|---|---|---|
| macOS | Piper | 640 ms | 950 ms |
| macOS | say | 1112 ms | 937 ms |
| Linux | Piper | 705 ms | 120 ms |
| Windows | SAPI | 880 ms | 340 ms |

The next one is ragged on purpose — it is what the benchmark script emits when a platform did not
report a column at all, and I have not padded it:

| run | notes | outcome |
|---|---|---|
| 1 | warm device | ok |
| 2 | | ok |
| 3 | cold, retried once |
| 4 | | |

And this last one arrived with no header row at all, straight out of a paste:

| kill to exit | 3 ms |
| queue depth | 8 |
| dropped utterances | 0 |

My reading of it: the device open dominates everywhere, and the gap is not the process spawn.
