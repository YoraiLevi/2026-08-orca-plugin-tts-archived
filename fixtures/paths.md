<!-- T110c — shallow paths, a deep one, unknown extensions, and paths carrying trailing
     punctuation. Motivated by the listening report: file paths "made no sense whatsoever", and
     later that the file kind was "garbled noise" and should come last. Highest-value fixture. -->

Four files changed, and one of them is the interesting one.

The whole of the behaviour you are hearing lives in
packages/core/src/normalizer/index.ts — that is the deep one, and by the time the folder has
been announced you may already have lost the file name. Compare it with src/index.ts, which is
two segments and lands easily.

The rest of the change is small. scripts/build.mjs picked up the new entry point,
docs/TASKS.md got the checkbox, and packages/plugin/src/sinks/subprocess-sink.ts lost the comment
that started the whole misdiagnosis.

Three of these end a sentence, so the trailing punctuation has to come back afterwards or the
sentence never closes: see packages/core/src/index.ts. Then compare against
packages/providers/src/os-synth.ts, and finally check scripts/bench-latency.mjs.

Two paths have extensions we have no word for. The model manifest is
models/piper/en_US-amy-low.onnx and the fixture list is fixtures/corpus.lst — neither of those is
in the extension table, so both fall back to spelling the suffix out.

One more shape worth hearing: a directory with no file at all, packages/core/src/, and a bare
name with a dot in it that is not a path, like README.md sitting on its own.

Config lives in .github/workflows/ci.yml, and the lock file is pnpm-lock.yaml.
