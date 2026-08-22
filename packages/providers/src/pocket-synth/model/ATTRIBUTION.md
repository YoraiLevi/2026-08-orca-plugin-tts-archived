# Vendored model files

## `tokenizer.model` — 59,339 bytes

The SentencePiece vocabulary for Pocket TTS's `english_2026-04` bundle.

- **Model:** Pocket TTS, by [Kyutai](https://huggingface.co/kyutai/pocket-tts). CC-BY-4.0.
- **ONNX export:** [`KevinAHM/pocket-tts-onnx`](https://huggingface.co/KevinAHM/pocket-tts-onnx),
  revision `58a6d00cf13d239b6748cb0769f35c580a8f606c`, bundle `english_2026-04`. CC-BY-4.0.
- **Licence text:** `LICENSE`, beside this file, copied unmodified from that revision.

**Why this one file is committed and the other 166 MB are not.** The tokenizer is 59 KB and it is
the only artifact `sentencepiece.test.ts` needs. Without it that test could not run in CI, and a
hand-written tokenizer with no oracle is exactly the thing this project has learned not to trust.
The model weights are downloaded at first use instead — see `models.ts`.

The file is copied byte-for-byte and is not modified in any way.
