<!-- T110f — emoji, a box-drawing diagram, bare and markdown-linked URLs, keyboard glyphs, and
     mixed right-to-left text. Emoji vanish today with no announcement at all while code blocks
     and URLs get a lead-in — the inconsistency the FMA flagged. The ASCII diagram is design
     002's motivating case: it must never be spoken as box characters. -->

✅ Done — huddle mode is live and the hotkey is bound. 🎉

Here is the shape of the pipeline, which is the part I want you to look at:

┌──────────────┐     ┌───────────────┐     ┌──────────────┐
│  transcript  │ ──▶ │  normalizer   │ ──▶ │  synthesizer │
│   watcher    │     │  (16 stages)  │     │   (Piper)    │
└──────────────┘     └───────────────┘     └──────────────┘
       │                                          │
       └────────────── barge-in ──────────────────┘

That diagram carries the whole design and it is worth exactly nothing aloud. Read literally it is
a few hundred box characters, and the listener hears static where the explanation should be. ⚠️

The chord is ⌘⇧U for speak-selection and ⌘⇧S for stop. On Windows and Linux the same two are
⌃⇧U and ⌃⇧S, and ⌥ is unused on every platform. Press ⏎ to confirm, ⌫ to dismiss, ⇥ to move on,
and the ↑ ↓ ← → keys walk the queue.

Two references, one bare and one wrapped. The upstream issue is at
https://github.com/stablyai/orca/issues/15637, and the fix is tracked in
[the pull request that projects sessionId](https://github.com/stablyai/orca/pull/15640). There is
also a trailing-punctuation case: see https://github.com/YoraiLevi/orca-plugin-tts.

Now the part that will really hurt. The author writes in two directions, and a reply can carry
both: the Hebrew for "read aloud" is הקראה, and a sentence like "the setting is called הקראה
אוטומטית and it defaults to off" mixes the two inside one clause. There is a colon here too, and
an ellipsis... and an em-dash — all of which the engine treats differently.

🔥 One last flourish, because agents do this: a 100% success rate, 3 of 10 samples warm, and a
👍 that means nothing at all once the emoji is gone.
