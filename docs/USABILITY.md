# Try it — a script for the listener

**Written for one sitting, headphones on, ~20 minutes.** You are not hunting bugs here. Every
item below either works or is named as not working, and the questions at the end are the ones no
agent can answer.

---

## 0. Before you start

```bash
pnpm build
pnpm voice-lab        # http://127.0.0.1:7311
```

If the Lab prints `stages 17` and a fixture list, everything downstream of it is live.

**Nothing plays sound until you press something.** No agent has heard any of this — the whole
build was done with `say -o <file>`, which never opens the audio device.

---

## 1. The thing this was all for — settle the defaults by ear (~15 min)

Open the Lab, pick `fixtures/architecture.md`, and press play. Then move one control at a time
and press again. **Written and spoken sit side by side**, so you can see what changed.

Four decisions are yours, and they are the only reason the Lab exists:

| Decision | What to listen for | Where it lands |
|---|---|---|
| **Identifier speech** | `p50`, `P22`, `T110d` — say them aloud yourself, then hear them. These were spoken as *"pfifty"* and *"Ptwenty two"* for months | `num.*` controls |
| **Path depth** | `packages/core/src/normalizer/index.ts` — how much of that do you want? Where should "typescript file" land? | `path.style`, `path.extensionStyle` |
| **Announcement wording** | Every loss interrupts your reply. Is *"one of two parts could not be spoken and was skipped"* worth its length? | `announce.*` |
| **Spoken-overhead budget** | How much extra speech buys how much extra information | across all of the above |

**Save writes `~/Library/Application Support/orca-tts/settings.jsonc`.** The plugin reads that
file — verified byte-for-byte by `g1-roundtrip.test.ts`, which drives the real Lab server and the
real plugin read path and compares the strings the synthesizer was handed. What you tune is what
you will hear.

---

## 2. Five minutes of "does it actually work"

Each of these was broken this week and is fixed. If any misbehaves, that is a regression, not a
known gap.

1. **A reply with a diagram.** Load `fixtures/hostile.md`. You should hear *"Here, a diagram is
   omitted. It is labelled: transcript watcher, normalizer (seventeen stages), synthesizer
   (Piper), barge-in."* — **not** box-drawing characters. 16 words replacing 343 characters of
   glyphs.
2. **A reply with a horizontal rule.** Type `First point.` / `---` / `Second point.` Both halves
   must be spoken. Until yesterday the second half vanished silently: `say` read the leading `--`
   as an option flag.
3. **Numbers.** `p50 1,112-2,017 ms` should be *"one thousand one hundred twelve to two thousand
   seventeen milliseconds"*. It used to be *"one, one hundred twelve"*.
4. **Change a control, press play.** You must hear the NEW setting. Until today the page replayed
   audio synthesized before your change — 41 ms and confidently wrong.
5. **Stop.** Press it mid-utterance. It should cut within a fifth of a second.

---

## 3. What is honestly NOT done

Named so you do not spend time discovering it.

| | |
|---|---|
| **`speak` fence (M14b)** | The mechanism works; **the wire is not in.** It needs a policy setting — spoken-only / spoken-then-prose / prose-only / agent-decides — and the design forbids choosing its default outside the Lab. **That is a question for you**, and it is the one blocking the milestone. |
| **Per-agent voices, the perceptual half** | Two agents render to measurably different audio — proved by checksum. Whether you can *tell them apart* is yours; identity rides on a spoken call-sign because voice-based identity guaranteed on all three platforms is exactly **one**. |
| **`sessionLabel` still speaks hex** | It slices 8 characters of a UUID. The call-sign that replaces it exists; wiring it in is next. |
| **Live settings reload** | An edit needs an ORCA restart today. |
| **Windows unreadable-root** | Unguarded: the test harness cannot produce the condition with `chmod`. Needs an injected fs seam. |
| **One mutant on Linux** | `half-written-line-concluded-on` survives there — the test goes vacuous on Linux, the invariant is not safe. Written up in the registry. |

---

## 4. If you want to check our work rather than the product

```bash
pnpm test                    # expect 780-odd green; pin the count with a SHA and a load average
pnpm check:mutants           # 37/37 on macOS. RUN IT IN A DETACHED WORKTREE (PITFALLS P41)
pnpm check:citations --ratchet
gh run list --limit 1        # the hosted run is the oracle; local green has been wrong repeatedly
```

**`pnpm check:mutants` must not run in this working tree.** It mutates source in place and
restores in a `finally` — and a `finally` does not run if the process is killed. It left live
mutants here twice today, including one that would have spoken the model's private reasoning
aloud.
