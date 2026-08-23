var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// packages/providers/src/pocket-synth/audio.ts
function readNpy(buf) {
  if (buf.toString("latin1", 0, 6) !== "\x93NUMPY") throw new Error("not a .npy file");
  const major = buf[6];
  if (major !== 1 && major !== 2) throw new Error(`unsupported .npy version ${major}`);
  const headerLen = major === 1 ? buf.readUInt16LE(8) : buf.readUInt32LE(8);
  const headerStart = major === 1 ? 10 : 12;
  const header = buf.toString("latin1", headerStart, headerStart + headerLen);
  const descr = /'descr'\s*:\s*'([^']+)'/.exec(header)?.[1];
  if (descr !== "<f4") throw new Error(`only little-endian float32 .npy is supported, got ${String(descr)}`);
  if (/'fortran_order'\s*:\s*True/.test(header)) throw new Error("fortran-ordered .npy is not supported");
  const shapeText = /'shape'\s*:\s*\(([^)]*)\)/.exec(header)?.[1] ?? "";
  const shape = [...shapeText.matchAll(/\d+/g)].map((m) => Number(m[0] ?? 0));
  const count = shape.reduce((a, b) => a * b, 1);
  const body = headerStart + headerLen;
  if (body + count * 4 > buf.length) {
    throw new Error(`.npy declares ${count} float32 values but the file holds ${(buf.length - body) / 4}`);
  }
  const data = new Float32Array(count);
  for (let i = 0; i < count; i++) data[i] = buf.readFloatLE(body + i * 4);
  return { data, shape };
}
function readWav(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let pos = 12;
  let fmt = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") {
      fmt = {
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14)
      };
    } else if (id === "data") {
      if (fmt === null) throw new Error("WAV data chunk arrived before its fmt chunk");
      if (fmt.bits !== 16) throw new Error(`only 16-bit PCM WAV is supported, got ${fmt.bits}-bit`);
      if (fmt.channels < 1) throw new Error("WAV declares zero channels");
      const available = Math.min(size, buf.length - body);
      const frames = Math.floor(available / 2 / fmt.channels);
      const mono = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let acc = 0;
        for (let c = 0; c < fmt.channels; c++) acc += buf.readInt16LE(body + (i * fmt.channels + c) * 2);
        mono[i] = acc / fmt.channels / 32768;
      }
      return { samples: mono, rate: fmt.rate };
    }
    pos = body + size + size % 2;
  }
  throw new Error("WAV has no data chunk");
}
function writeWav(samples, rate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + samples.length * 2, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(samples.length * 2, 40);
  const body = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    body.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  return Buffer.concat([header, body]);
}
function reflectedIndex(index, length) {
  if (index >= 0 && index < length) return index;
  if (length === 1) return 0;
  const period = 2 * (length - 1);
  const wrapped = (index % period + period) % period;
  return wrapped < length ? wrapped : period - wrapped;
}
function resample(input, fromRate, toRate, width = 16) {
  if (fromRate <= 0 || toRate <= 0) throw new Error("sample rates must be positive");
  if (fromRate === toRate) return input;
  if (input.length === 0) return input;
  const ratio = toRate / fromRate;
  const cutoff = Math.min(1, ratio) * 0.95;
  const outLen = Math.floor(input.length * ratio);
  const out = new Float32Array(outLen);
  const half = Math.ceil(width / Math.min(1, ratio));
  for (let i = 0; i < outLen; i++) {
    const centre = i / ratio;
    const first = Math.ceil(centre - half);
    const last = Math.floor(centre + half);
    let acc = 0;
    let norm = 0;
    for (let j = first; j <= last; j++) {
      const d2 = centre - j;
      const w = 0.42 + 0.5 * Math.cos(Math.PI * d2 / half) + 0.08 * Math.cos(2 * Math.PI * d2 / half);
      const x = cutoff * d2;
      const k = (x === 0 ? cutoff : Math.sin(Math.PI * x) / (Math.PI * x) * cutoff) * w;
      acc += (input[reflectedIndex(j, input.length)] ?? 0) * k;
      norm += k;
    }
    out[i] = norm === 0 ? 0 : acc / norm;
  }
  return out;
}
var init_audio = __esm({
  "packages/providers/src/pocket-synth/audio.ts"() {
    "use strict";
  }
});

// packages/providers/src/pocket-synth/voices.ts
function parseVoiceKey(key) {
  const at = key.indexOf(":");
  if (at < 0) return { backend: OS_BACKEND, voice: key };
  return { backend: key.slice(0, at), voice: key.slice(at + 1) };
}
function formatVoiceKey(backend, voice) {
  return `${backend}:${voice}`;
}
var OS_BACKEND, POCKET_BACKEND, POCKET_VOICES, POCKET_DEFAULT_VOICE;
var init_voices = __esm({
  "packages/providers/src/pocket-synth/voices.ts"() {
    "use strict";
    OS_BACKEND = "os";
    POCKET_BACKEND = "pocket";
    POCKET_VOICES = [
      {
        key: "pocket:anna",
        displayName: "Anna",
        file: "anna.wav",
        upstream: "p228_023_enhanced.wav",
        sha256: "0a6de25cf12bf1540beb85979f306a92be81fecc051c547c5395e7e5237a3856",
        bytes: 804630,
        source: "VCTK p228"
      },
      {
        key: "pocket:vera",
        displayName: "Vera",
        file: "vera.wav",
        upstream: "p229_023_enhanced.wav",
        sha256: "309cf91a895830f15842b398f69a4962cb1f7e0bfab10e25dd27838e826c204b",
        bytes: 691416,
        source: "VCTK p229"
      },
      {
        key: "pocket:fantine",
        displayName: "Fantine",
        file: "fantine.wav",
        upstream: "p244_023_enhanced.wav",
        sha256: "5f07d4e2a3f20a15572aae885156b43ef3fc12ef3812996fd135680d9956448b",
        bytes: 674852,
        source: "VCTK p244"
      },
      {
        key: "pocket:charles",
        displayName: "Charles",
        file: "charles.wav",
        upstream: "p254_023_enhanced.wav",
        sha256: "6b681a429198f16e378d53bccb08d06939da7b00144a7696111d4f8f76be7756",
        bytes: 639272,
        source: "VCTK p254"
      },
      {
        key: "pocket:paul",
        displayName: "Paul",
        file: "paul.wav",
        upstream: "p259_023_enhanced.wav",
        sha256: "7aba504fe0b3b16478b69eb27ce6007e3cb42b0c1915b5f1c6a6024ae37d679b",
        bytes: 717182,
        source: "VCTK p259"
      },
      {
        key: "pocket:eponine",
        displayName: "Eponine",
        file: "eponine.wav",
        upstream: "p262_023_enhanced.wav",
        sha256: "a13c27fb47627b05223691a0ef2974358a18c886e6c2f9d2762ff1d02c20926b",
        bytes: 716330,
        source: "VCTK p262"
      },
      {
        key: "pocket:azelma",
        displayName: "Azelma",
        file: "azelma.wav",
        upstream: "p303_023_enhanced.wav",
        sha256: "60e3d26cdf2efdec5df712152c839928f4d5522821e6554ae11fd96c57ab1026",
        bytes: 823852,
        source: "VCTK p303"
      },
      {
        key: "pocket:george",
        displayName: "George",
        file: "george.wav",
        upstream: "p315_023_enhanced.wav",
        sha256: "29a41f93bf5236e5b21501091d7774c255d5f3d4e62fa4f9fdf0a92a793c84ae",
        bytes: 642692,
        source: "VCTK p315"
      },
      {
        key: "pocket:mary",
        displayName: "Mary",
        file: "reference_sample.wav",
        upstream: "p333_023_enhanced.wav",
        sha256: "a35b0468382218e9f37a9a7494d1e4b74deaf18d7ced22265b4e325bb55c183f",
        bytes: 639084,
        source: "VCTK p333"
      },
      {
        key: "pocket:jane",
        displayName: "Jane",
        file: "jane.wav",
        upstream: "p339_023_enhanced.wav",
        sha256: "2f12e7f155eb3118f55425394f1b049e5b1b67bdc9b3932c8ba4521420aeb84a",
        bytes: 759340,
        source: "VCTK p339"
      },
      {
        key: "pocket:michael",
        displayName: "Michael",
        file: "michael.wav",
        upstream: "p360_023_enhanced.wav",
        sha256: "b6743e9195e5e3fd34fe9d1633ae93f7ffab787b249e45f6467d7d6f7a6ee6ad",
        bytes: 751140,
        source: "VCTK p360"
      },
      {
        key: "pocket:eve",
        displayName: "Eve",
        file: "eve.wav",
        upstream: "p361_023_enhanced.wav",
        sha256: "396e7cbd066b0f3fb6d67fa26e7904076958239d736d4390f15b5fe88feb14cd",
        bytes: 671872,
        source: "VCTK p361"
      }
    ];
    POCKET_DEFAULT_VOICE = "pocket:mary";
  }
});

// packages/providers/src/pocket-synth/safe-swap.ts
import { randomBytes } from "node:crypto";
import { readFile as readFile2, rename, rm as rm2, readdir, open, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join as join2, dirname, basename } from "node:path";
function lockPathFor(dir) {
  return `${dir}.lock`;
}
function journalPathFor(dir) {
  return `${dir}.swap-journal`;
}
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}
async function readLockPid(lockPath) {
  try {
    const raw = (await readFile2(lockPath, "utf8")).trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}
function isBackupName(base, name) {
  return name === `${base}.previous` || name.startsWith(`${base}.previous-`);
}
async function recoverLiveFromBackup(dir) {
  if (existsSync(dir)) return;
  const lockPath = lockPathFor(dir);
  if (existsSync(lockPath)) {
    const holder = await readLockPid(lockPath);
    if (holder !== null && pidAlive(holder)) return;
  }
  const parent = dirname(dir);
  const base = basename(dir);
  if (!existsSync(parent)) return;
  const backups = (await readdir(parent)).filter((n) => isBackupName(base, n)).toSorted((a, b) => {
    if (a === `${base}.previous`) return -1;
    if (b === `${base}.previous`) return 1;
    return a.localeCompare(b);
  });
  if (backups.length === 0) return;
  const chosen = backups[0];
  if (chosen === void 0) return;
  try {
    await rename(join2(parent, chosen), dir);
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  await rm2(journalPathFor(dir), { force: true });
}
var init_safe_swap = __esm({
  "packages/providers/src/pocket-synth/safe-swap.ts"() {
    "use strict";
  }
});

// packages/providers/src/pocket-synth/models.ts
import { createHash } from "node:crypto";
import { readFile as readFile3, writeFile as writeFile2, readdir as readdir2, mkdir as mkdir2, rm as rm3, symlink } from "node:fs/promises";
import { existsSync as existsSync2, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename as basename2, dirname as dirname2, join as join3, resolve as resolvePath, sep } from "node:path";
function modelDir(env = process.env) {
  const override = env.ORCA_TTS_MODEL_DIR;
  if (override !== void 0 && override !== "") return override;
  if (process.platform === "win32") {
    const base2 = env.LOCALAPPDATA ?? join3(homedir(), "AppData", "Local");
    return join3(base2, "orca-tts", "models", "pocket-tts");
  }
  if (process.platform === "darwin") {
    return join3(homedir(), "Library", "Application Support", "orca-tts", "models", "pocket-tts");
  }
  const base = env.XDG_CACHE_HOME ?? join3(homedir(), ".cache");
  return join3(base, "orca-tts", "models", "pocket-tts");
}
function requiredFiles() {
  return [
    ...MODEL_ARTIFACTS.map((a) => a.file),
    ...VOICE_ARTIFACTS.map((a) => a.file),
    UPSTREAM_LICENSE_FILE,
    LICENSE_FILE,
    MANIFEST_FILE
  ];
}
function incompleteDetail(missing, present, required) {
  if (missing.length === 1 && missing[0] === MANIFEST_FILE) {
    return `this directory has every required file except ${MANIFEST_FILE}`;
  }
  return `this directory has ${present} of ${required} required files; missing ${missing.join(", ")}`;
}
function modelStatusDetail(status) {
  if (status.kind === "ready") return `Pocket TTS is ready in ${status.dir}`;
  if (status.kind === "absent") {
    return `Pocket TTS is not installed in ${status.dir}`;
  }
  if (status.kind === "incomplete") return `${status.detail} (${status.dir})`;
  return `Pocket TTS model is stale in ${status.dir}; found manifest ${status.found}, expected ${status.want}`;
}
async function modelStatus(dir = modelDir()) {
  await recoverLiveFromBackup(dir);
  const required = requiredFiles();
  if (!existsSync2(dir)) return { kind: "absent", dir, missing: required };
  const names = new Set(await readdir2(dir));
  const missing = required.filter((f) => {
    if (!names.has(f)) return true;
    const path = join3(dir, f);
    if (!existsSync2(path)) return true;
    const want2 = PINNED_BYTES.get(f);
    if (want2 === void 0) return false;
    try {
      return statSync(path).size !== want2;
    } catch {
      return true;
    }
  });
  const present = required.length - missing.length;
  if (missing.length > 0) {
    if (present === 0) return { kind: "absent", dir, missing };
    return {
      kind: "incomplete",
      dir,
      missing,
      present,
      required: required.length,
      detail: incompleteDetail(missing, present, required.length)
    };
  }
  const found = (await readFile3(join3(dir, MANIFEST_FILE), "utf8")).trim();
  const want = String(MANIFEST_VERSION);
  if (found !== want) return { kind: "stale", dir, found, want };
  return { kind: "ready", dir };
}
var MODEL_REPO, MODEL_REVISION, BUNDLE_ID, MANIFEST_VERSION, MODEL_ARTIFACTS, MODEL_TOTAL_BYTES, MANIFEST_FILE, LICENSE_FILE, UPSTREAM_LICENSE_FILE, LICENSE_TEXT, VOICE_ARTIFACTS, VOICES_TOTAL_BYTES, PINNED_BYTES, INSTALL_TOTAL_BYTES;
var init_models = __esm({
  "packages/providers/src/pocket-synth/models.ts"() {
    "use strict";
    init_voices();
    init_safe_swap();
    init_safe_swap();
    MODEL_REPO = "KevinAHM/pocket-tts-onnx";
    MODEL_REVISION = "58a6d00cf13d239b6748cb0769f35c580a8f606c";
    BUNDLE_ID = "english_2026-04";
    MANIFEST_VERSION = 2;
    MODEL_ARTIFACTS = [
      { file: "bundle.json", sha256: "bab643150f437f37df080a710520ff39ed9ebd9a339f8ebdc739f7eddfc28b3f", bytes: 24381 },
      { file: "bos_before_voice.npy", sha256: "f46edf4f7007b7ba4ea58831f49d003e59e167b4641c44bb3addfe9231a780b1", bytes: 4224 },
      { file: "tokenizer.model", sha256: "d461765ae179566678c93091c5fa6f2984c31bbe990bf1aa62d92c64d91bc3f6", bytes: 59339 },
      { file: "flow_lm_main_int8.onnx", sha256: "f9bd8106b79a0192c1c43399ab938fb24900a95c1c599870d75a884e99000116", bytes: 76341079 },
      { file: "flow_lm_flow_int8.onnx", sha256: "3dd781ee5abee9e195320bf0106bebd6372a852b3b36352524ee78b40554635d", bytes: 9962530 },
      { file: "mimi_decoder_int8.onnx", sha256: "3630450a3297a101792a6ac66619ebc70ab916b265e6220c2afaef8b1673f925", bytes: 22684077 },
      { file: "mimi_encoder.onnx", sha256: "853e2ca623b8782d94c3745ec6133bfdff7ce33d9b11128bd29ea03f28d76e3d", bytes: 39768446 },
      { file: "text_conditioner.onnx", sha256: "4ecee995fb69f85c7a7493d11f7b5ee15d9950facc7ab3f5c9c49ef1e03847bb", bytes: 16388344 }
    ];
    MODEL_TOTAL_BYTES = MODEL_ARTIFACTS.reduce((n, a) => n + a.bytes, 0);
    MANIFEST_FILE = ".orca-tts-model-manifest";
    LICENSE_FILE = "MODEL_LICENSE.txt";
    UPSTREAM_LICENSE_FILE = "LICENSE";
    LICENSE_TEXT = `Pocket TTS model files
======================

Model:       Pocket TTS, by Kyutai (https://huggingface.co/kyutai/pocket-tts)
ONNX export: ${MODEL_REPO} at ${MODEL_REVISION}, bundle ${BUNDLE_ID}
Licence:     CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/)

Reference voices are VCTK speakers from kyutai/tts-voices, ai-coustics-enhanced,
also CC-BY-4.0.

These files are downloaded unmodified and are not part of the orca-plugin-tts
distribution. Provided AS IS, without warranty of any kind.
`;
    VOICE_ARTIFACTS = POCKET_VOICES.map((v) => ({
      file: v.file,
      sha256: v.sha256,
      bytes: v.bytes
    }));
    VOICES_TOTAL_BYTES = VOICE_ARTIFACTS.reduce((n, a) => n + a.bytes, 0);
    PINNED_BYTES = new Map(
      [...MODEL_ARTIFACTS, ...VOICE_ARTIFACTS].map((a) => [a.file, a.bytes])
    );
    INSTALL_TOTAL_BYTES = MODEL_TOTAL_BYTES + VOICES_TOTAL_BYTES;
  }
});

// packages/providers/src/pocket-synth/sentencepiece.ts
function readVarint(buf, pos) {
  let result = 0n;
  let shift = 0n;
  for (; ; ) {
    const byte = buf[pos++];
    if (byte === void 0) throw new Error("truncated varint");
    result |= BigInt(byte & 127) << shift;
    if ((byte & 128) === 0) break;
    shift += 7n;
    if (shift > 63n) throw new Error("varint longer than 64 bits");
  }
  return [result, pos];
}
function skipField(buf, pos, wireType) {
  switch (wireType) {
    case 0:
      return readVarint(buf, pos)[1];
    case 1:
      return pos + 8;
    case 2: {
      const [len, p] = readVarint(buf, pos);
      return p + Number(len);
    }
    case 5:
      return pos + 4;
    default:
      throw new Error(`unsupported protobuf wire type ${wireType}`);
  }
}
function parsePiece(buf, start, end) {
  let pos = start;
  let piece = "";
  let score = 0;
  let type = PieceType.NORMAL;
  while (pos < end) {
    const [key, p] = readVarint(buf, pos);
    pos = p;
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (field === 1 && wire === 2) {
      const [len, q] = readVarint(buf, pos);
      piece = buf.toString("utf8", q, q + Number(len));
      pos = q + Number(len);
    } else if (field === 2 && wire === 5) {
      score = buf.readFloatLE(pos);
      pos += 4;
    } else if (field === 3 && wire === 0) {
      const [v, q] = readVarint(buf, pos);
      type = Number(v);
      pos = q;
    } else {
      pos = skipField(buf, pos, wire);
    }
  }
  return { piece, score, type };
}
function parseModelProto(buf) {
  const pieces = [];
  let pos = 0;
  while (pos < buf.length) {
    const [key, p] = readVarint(buf, pos);
    pos = p;
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (field === 1 && wire === 2) {
      const [len, q] = readVarint(buf, pos);
      pieces.push(parsePiece(buf, q, q + Number(len)));
      pos = q + Number(len);
    } else {
      pos = skipField(buf, pos, wire);
    }
  }
  return pieces;
}
var SPACE, PieceType, SentencePieceUnigram;
var init_sentencepiece = __esm({
  "packages/providers/src/pocket-synth/sentencepiece.ts"() {
    "use strict";
    SPACE = "\u2581";
    PieceType = {
      NORMAL: 1,
      UNKNOWN: 2,
      CONTROL: 3,
      USER_DEFINED: 4,
      BYTE: 6
    };
    SentencePieceUnigram = class _SentencePieceUnigram {
      pieces;
      byId;
      unkId;
      #byteId;
      #usable;
      #maxPieceLen;
      #unkPenalty;
      constructor(pieces) {
        this.pieces = pieces;
        this.byId = pieces.map((p) => p.piece);
        this.unkId = Math.max(0, pieces.findIndex((p) => p.type === PieceType.UNKNOWN));
        this.#byteId = new Int32Array(256).fill(-1);
        for (const [i, p] of pieces.entries()) {
          if (p.type !== PieceType.BYTE) continue;
          const m = /^<0x([0-9A-Fa-f]{2})>$/.exec(p.piece);
          if (m?.[1] !== void 0) this.#byteId[Number.parseInt(m[1], 16)] = i;
        }
        this.#usable = /* @__PURE__ */ new Map();
        let maxLen = 0;
        for (const [i, p] of pieces.entries()) {
          if (p.type === PieceType.CONTROL || p.type === PieceType.UNKNOWN || p.type === PieceType.BYTE) continue;
          if (!this.#usable.has(p.piece)) this.#usable.set(p.piece, { id: i, score: p.score });
          maxLen = Math.max(maxLen, [...p.piece].length);
        }
        this.#maxPieceLen = maxLen;
        const normals = pieces.filter((p) => p.type === PieceType.NORMAL).map((p) => p.score);
        this.#unkPenalty = (normals.length > 0 ? Math.min(...normals) : 0) - 10;
      }
      static fromBuffer(buf) {
        return new _SentencePieceUnigram(parseModelProto(buf));
      }
      /** `add_dummy_prefix` then `escape_whitespaces`, exactly as this bundle's proto declares them. */
      normalize(text) {
        return (" " + text).replaceAll(" ", SPACE);
      }
      /** `noUncheckedIndexedAccess` is on: reads past the end are a real possibility, not a formality. */
      #charAt(chars, i) {
        const c = chars[i];
        if (c === void 0) throw new Error(`tokenizer read past the end of the input at ${i}`);
        return c;
      }
      /**
       * Encode as Python `sentencepiece.SentencePieceProcessor.Encode` does it.
       *
       * **That is `Model::EncodeOptimized`, not `Lattice::Viterbi`, and the difference was
       * measurable.** `d6f6c80` ported the lattice: one node per candidate, first-wins among
       * `end_nodes_` on a float32 tie. That took an 11,344-input corpus from 17 disagreements to 1
       * (`Zggggg`). Round 16 then found seven more of the same class on a 728-input `Xyyyyy` grid —
       * the lattice remainder is not a singleton, and Python never ran Viterbi for `Encode()` at all.
       *
       * `EncodeOptimized` (unigram_model.cc) keeps **one best path ending at each position**. For
       * each start it walks matching pieces shortest-first and replaces the path ending at
       * `start + length` only when `starts_at == -1` (first to arrive) or the candidate score is
       * strictly greater. Ties therefore go to the earlier start — the longer piece — which is the
       * opposite of "first node in `end_nodes_`". `>` and `>=` on the lattice have both been
       * measured (17 and 21 disagreements, opposite directions) and are not this fix.
       *
       * Two other details are load-bearing and both were settled by the oracle rather than by
       * reasoning:
       *
       *  - **empty input is empty output.** The dummy prefix would otherwise make `''` encode to
       *    `[▁]`, which is one spurious token of silence at the head of every empty utterance.
       *  - **byte fallback is a post-process of UNK**, not a lattice alternative scored per byte.
       *    Unknown characters are one UNK node at `min_score - 10`; the processor then emits one
       *    byte piece per UTF-8 byte. Scoring `unk * nbytes` in the lattice is a different path.
       */
      encode(text) {
        if (text === "") return [];
        const chars = [...this.normalize(text)];
        const n = chars.length;
        if (n === 0) return [];
        const best = Array.from({ length: n + 1 }, () => ({
          ids: [],
          score: 0,
          startsAt: -1
        }));
        const kScoreResetThreshold = 1e5;
        let maxFrontier = 0;
        for (let startsAt = 0; startsAt < n; startsAt++) {
          const here = best[startsAt];
          if (here === void 0) throw new Error(`tokenizer read past the end of the input at ${startsAt}`);
          let till = here.score;
          if (till < -kScoreResetThreshold || till > kScoreResetThreshold) {
            const offset = till;
            for (let i = startsAt; i <= maxFrontier; i++) {
              const node = best[i];
              if (node !== void 0 && (i === startsAt || node.startsAt !== -1)) {
                node.score = Math.fround(node.score - offset);
              }
            }
            till = 0;
          }
          let hasSingleChar = false;
          const limit = Math.min(this.#maxPieceLen, n - startsAt);
          let candidate = "";
          for (let len = 1; len <= limit; len++) {
            candidate += this.#charAt(chars, startsAt + len - 1);
            const hit = this.#usable.get(candidate);
            if (hit === void 0) continue;
            maxFrontier = Math.max(maxFrontier, startsAt + len);
            const candScore = Math.fround(hit.score + till);
            const target = best[startsAt + len];
            if (target === void 0) continue;
            if (target.startsAt === -1 || candScore > target.score) {
              target.score = candScore;
              target.startsAt = startsAt;
              target.ids = [hit.id];
            }
            if (len === 1) hasSingleChar = true;
          }
          if (!hasSingleChar) {
            const one = this.#charAt(chars, startsAt);
            const bytes = Buffer.from(one, "utf8");
            const ids = [];
            for (const b of bytes) {
              const id = this.#byteId[b] ?? -1;
              ids.push(id >= 0 ? id : this.unkId);
            }
            maxFrontier = Math.max(maxFrontier, startsAt + 1);
            const target = best[startsAt + 1];
            const candScore = Math.fround(this.#unkPenalty + till);
            if (target !== void 0 && (target.startsAt === -1 || candScore > target.score)) {
              target.score = candScore;
              target.startsAt = startsAt;
              target.ids = ids;
            }
          }
        }
        const out = [];
        let endsAt = n;
        while (endsAt > 0) {
          const node = best[endsAt];
          if (node === void 0 || node.startsAt < 0) {
            throw new Error("no path through the tokenizer lattice");
          }
          for (let k = node.ids.length - 1; k >= 0; k--) out.push(node.ids[k] ?? this.unkId);
          endsAt = node.startsAt;
        }
        return out.toReversed();
      }
      /**
       * Ids back to text.
       *
       * Byte pieces must be reassembled as BYTES, not concatenated as the literal string `<0x2F>`.
       * Encoding `src/core/…` produces `<0x2F>` for each slash, so a naive decode turns a file path
       * into `src<0x2F>core<0x2F>…` — and chunk splitting decodes id ranges back to text before
       * re-encoding them, which means the corruption would reach the synthesizer as real words.
       * Caught by the round-trip case, which is why it is a test and not a comment.
       */
      decode(ids) {
        const out = [];
        let pending = [];
        const flush = () => {
          if (pending.length === 0) return;
          out.push(Buffer.from(pending));
          pending = [];
        };
        for (const id of ids) {
          const piece = this.byId[id];
          if (piece === void 0) continue;
          if (this.pieces[id]?.type === PieceType.BYTE) {
            const m = /^<0x([0-9A-Fa-f]{2})>$/.exec(piece);
            if (m?.[1] !== void 0) {
              pending.push(Number.parseInt(m[1], 16));
              continue;
            }
          }
          flush();
          out.push(Buffer.from(piece, "utf8"));
        }
        flush();
        return Buffer.concat(out).toString("utf8").replaceAll(SPACE, " ").replace(/^ /, "");
      }
    };
  }
});

// packages/providers/src/pocket-synth/runtime.ts
import { createHash as createHash2 } from "node:crypto";
import { existsSync as existsSync3 } from "node:fs";
import { readFile as readFile4, writeFile as writeFile3, readdir as readdir3, chmod } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { join as join4, dirname as dirname3 } from "node:path";
function platformKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}
function runtimeDir(env = process.env) {
  const override = env.ORCA_TTS_RUNTIME_DIR;
  if (override !== void 0 && override !== "") return override;
  return join4(dirname3(modelDir(env)), "onnxruntime", RUNTIME_VERSION);
}
async function runtimeStatus(dir = runtimeDir(), key = platformKey()) {
  const wanted = RUNTIME_FILES[key];
  if (wanted === void 0) {
    return {
      kind: "unsupported",
      platform: key,
      why: key === "darwin-x64" ? `${RUNTIME_PACKAGE} ${RUNTIME_VERSION} publishes no Intel-Mac binary, so the neural voices cannot run on this machine. Your system voices are unaffected.` : `${RUNTIME_PACKAGE} ${RUNTIME_VERSION} publishes no binary for ${key}. Your system voices are unaffected.`
    };
  }
  const bytes = RUNTIME_APPROX_BYTES[key] ?? 0;
  if (!existsSync3(dir)) return { kind: "absent", dir, missing: [...wanted], bytes };
  const present = new Set(await readdir3(dir));
  const missing = [...wanted, RUNTIME_MANIFEST_FILE].filter((f) => !present.has(f));
  if (missing.length > 0) return { kind: "absent", dir, missing, bytes };
  const found = (await readFile4(join4(dir, RUNTIME_MANIFEST_FILE), "utf8")).trim();
  const want = `${RUNTIME_VERSION}/${RUNTIME_MANIFEST_VERSION}`;
  if (found !== want) return { kind: "stale", dir, found, want };
  return { kind: "ready", dir, binding: join4(dir, "onnxruntime_binding.node") };
}
var RUNTIME_VERSION, RUNTIME_PACKAGE, RUNTIME_MANIFEST_VERSION, RUNTIME_MANIFEST_FILE, RUNTIME_TARBALL, RUNTIME_FILES, RUNTIME_APPROX_BYTES;
var init_runtime = __esm({
  "packages/providers/src/pocket-synth/runtime.ts"() {
    "use strict";
    init_models();
    init_safe_swap();
    RUNTIME_VERSION = "1.27.0";
    RUNTIME_PACKAGE = "onnxruntime-node";
    RUNTIME_MANIFEST_VERSION = 1;
    RUNTIME_MANIFEST_FILE = ".orca-tts-runtime-manifest";
    RUNTIME_TARBALL = `https://registry.npmjs.org/${RUNTIME_PACKAGE}/-/${RUNTIME_PACKAGE}-${RUNTIME_VERSION}.tgz`;
    RUNTIME_FILES = {
      "darwin-arm64": ["libonnxruntime.1.27.0.dylib", "libonnxruntime.1.dylib", "onnxruntime_binding.node"],
      "linux-x64": ["libonnxruntime.so.1", "onnxruntime_binding.node"],
      "linux-arm64": ["libonnxruntime.so.1", "onnxruntime_binding.node"],
      "win32-x64": ["onnxruntime.dll", "onnxruntime_binding.node", "DirectML.dll", "dxcompiler.dll", "dxil.dll"],
      "win32-arm64": ["onnxruntime.dll", "onnxruntime_binding.node"]
    };
    RUNTIME_APPROX_BYTES = {
      "darwin-arm64": 391e5,
      "linux-x64": 37e6,
      "linux-arm64": 19e6,
      "win32-x64": 61e6,
      "win32-arm64": 67e6
    };
  }
});

// packages/providers/src/pocket-synth/engine.ts
var engine_exports = {};
__export(engine_exports, {
  OnnxRuntimeMissingError: () => OnnxRuntimeMissingError,
  PocketTts: () => PocketTts,
  loadOrt: () => loadOrt,
  makeRng: () => makeRng,
  splitAtNaturalBoundaries: () => splitAtNaturalBoundaries
});
import { readFile as readFile5 } from "node:fs/promises";
import { join as join5 } from "node:path";
async function loadOrt() {
  ortPromise ??= (async () => {
    try {
      const mod = await import("onnxruntime-node");
      return mod.default ?? mod;
    } catch (bundled) {
      const status = await runtimeStatus();
      if (status.kind === "unsupported") {
        ortPromise = null;
        throw new OnnxRuntimeMissingError(status.why, "unsupported");
      }
      if (status.kind === "ready") {
        try {
          const mod = await import(status.dir + "/onnxruntime_binding.node");
          return mod.default ?? mod;
        } catch (cached) {
          ortPromise = null;
          throw new OnnxRuntimeMissingError(
            `an ONNX Runtime is cached at ${status.dir} but could not be loaded: ${cached instanceof Error ? cached.message : String(cached)}. The operating system voices are unaffected.`
          );
        }
      }
      ortPromise = null;
      const size = status.kind === "absent" ? Math.round(status.bytes / 1e6) : 0;
      throw new OnnxRuntimeMissingError(
        `The neural voices need the ONNX Runtime, which is not on this machine yet (about ${size} MB). The operating system voices are unaffected, and the Voice Lab can fetch it. (${bundled instanceof Error ? bundled.message : String(bundled)})`
      );
    }
  })();
  return ortPromise;
}
function makeRng(seed = 1) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  let spare = null;
  return (std) => {
    if (spare !== null) {
      const v2 = spare;
      spare = null;
      return v2 * std;
    }
    let u = 0;
    let v = 0;
    let r = 0;
    do {
      u = next() * 2 - 1;
      v = next() * 2 - 1;
      r = u * u + v * v;
    } while (r === 0 || r >= 1);
    const f = Math.sqrt(-2 * Math.log(r) / r);
    spare = v * f;
    return u * f * std;
  };
}
function isSpace(ch) {
  return ch !== void 0 && ch.trim() === "";
}
function isCloser(ch) {
  return ch !== void 0 && CLOSERS.has(ch);
}
function lastWord(candidate) {
  const trimmed = candidate.trimEnd();
  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1] ?? "";
}
function looksLikeAbbreviation(candidate) {
  let s = candidate;
  while (s.length > 0 && isCloser(s[s.length - 1])) s = s.slice(0, -1);
  const word = lastWord(s);
  if (ABBREVIATIONS.has(word)) return true;
  if (word.endsWith(".")) {
    const stem = word.slice(0, -1);
    if (stem.length > 0 && [...stem].every((c) => c >= "0" && c <= "9")) return true;
  }
  return false;
}
function naturalBoundary(candidate, isEndOfText) {
  if (isEndOfText) return "sentence";
  let i = candidate.length;
  while (i > 0) {
    const ch = candidate[i - 1];
    if (ch === void 0 || !isCloser(ch)) break;
    i -= 1;
  }
  const last = candidate[i - 1];
  if (last !== void 0 && SENTENCE_ENDERS.has(last) && !looksLikeAbbreviation(candidate)) {
    return "sentence";
  }
  if (last !== void 0 && CLAUSE_ENDERS.has(last)) return "clause";
  return "word";
}
function splitAtNaturalBoundaries(text, maxTokens, tokenCount) {
  if (text === "") return [];
  if (tokenCount(text) <= maxTokens) return [text];
  const chunks = [];
  let start = 0;
  const len = text.length;
  while (start < len) {
    while (start < len && isSpace(text[start])) start += text[start].length;
    if (start >= len) break;
    let sentenceEnd;
    let clauseEnd;
    let wordEnd;
    let i = start;
    overflow:
      for (const ch of text.slice(start)) {
        const end2 = i + ch.length;
        const next = text[end2];
        const atWordEnd = end2 === len || isSpace(next);
        const atUnspacedDash = (ch === "\u2014" || ch === "\u2013") && !isCloser(next);
        i = end2;
        if (!atWordEnd && !atUnspacedDash) continue;
        if (tokenCount(text.slice(start, end2)) > maxTokens) break overflow;
        wordEnd = end2;
        const kind = naturalBoundary(text.slice(start, end2), end2 === len);
        if (kind === "sentence") sentenceEnd = end2;
        else if (kind === "clause") clauseEnd = end2;
      }
    let end = sentenceEnd ?? clauseEnd ?? wordEnd;
    if (end === void 0) {
      let scalarEnd;
      let j = start;
      for (const ch of text.slice(start)) {
        if (isSpace(ch)) break;
        const next = j + ch.length;
        if (tokenCount(text.slice(start, next)) <= maxTokens) scalarEnd = next;
        else break;
        j = next;
      }
      if (scalarEnd === void 0) {
        throw new Error(
          `Pocket TTS prompt cannot fit one character within the ${maxTokens}-token limit`
        );
      }
      end = scalarEnd;
    }
    let nextStart = end;
    while (nextStart < len && isSpace(text[nextStart])) nextStart += text[nextStart].length;
    chunks.push(text.slice(start, nextStart));
    start = nextStart;
  }
  return chunks;
}
var OnnxRuntimeMissingError, ortPromise, SENTENCE_ENDERS, CLAUSE_ENDERS, CLOSERS, ABBREVIATIONS, PocketTts;
var init_engine = __esm({
  "packages/providers/src/pocket-synth/engine.ts"() {
    "use strict";
    init_sentencepiece();
    init_audio();
    init_runtime();
    OnnxRuntimeMissingError = class extends Error {
      code = "onnxruntime_missing";
      /** `absent` — it can be downloaded. `unsupported` — it cannot, on this machine, ever. */
      reason;
      constructor(message, reason = "absent") {
        super(message);
        this.name = "OnnxRuntimeMissingError";
        this.reason = reason;
      }
    };
    ortPromise = null;
    SENTENCE_ENDERS = /* @__PURE__ */ new Set([".", "!", "?", "\u3002"]);
    CLAUSE_ENDERS = /* @__PURE__ */ new Set([",", ";", ":", "\u2014", "\u2013"]);
    CLOSERS = /* @__PURE__ */ new Set(['"', "'", "\u201D", "\u2019", ")", "]", "}"]);
    ABBREVIATIONS = /* @__PURE__ */ new Set([
      "Dr.",
      "Mr.",
      "Mrs.",
      "Ms.",
      "Prof.",
      "Sr.",
      "Jr.",
      "St.",
      "Ave.",
      "Rd.",
      "Blvd.",
      "Dept.",
      "Inc.",
      "Ltd.",
      "Co.",
      "Corp.",
      "etc.",
      "vs.",
      "i.e.",
      "e.g.",
      "Ph.D."
    ]);
    PocketTts = class _PocketTts {
      sampleRate;
      latentDim;
      conditioningDim;
      frameRate;
      maxTokenPerChunk;
      tokenizer;
      #ort;
      #meta;
      #bos;
      #zeroFill;
      #mimiEncoder;
      #textConditioner;
      #flowMain;
      #flowNet;
      #mimiDecoder;
      #voiceStates = /* @__PURE__ */ new Map();
      constructor(parts) {
        this.#ort = parts.ort;
        this.#meta = parts.meta;
        this.#bos = parts.bos;
        this.#zeroFill = parts.zeroFill;
        this.tokenizer = parts.tokenizer;
        this.#mimiEncoder = parts.mimiEncoder;
        this.#textConditioner = parts.textConditioner;
        this.#flowMain = parts.flowMain;
        this.#flowNet = parts.flowNet;
        this.#mimiDecoder = parts.mimiDecoder;
        this.sampleRate = parts.meta.sample_rate;
        this.latentDim = parts.meta.latent_dim;
        this.conditioningDim = parts.meta.conditioning_dim;
        this.frameRate = parts.meta.frame_rate;
        this.maxTokenPerChunk = parts.meta.max_token_per_chunk ?? 50;
      }
      static async load(dir, options = {}) {
        const ort = await loadOrt();
        const meta = JSON.parse(await readFile5(join5(dir, "bundle.json"), "utf8"));
        const sessionOptions = {
          // The model card's number, and it is not a micro-optimisation: the autoregressive loop is a
          // chain of small matmuls and letting ORT use every core makes them fight for cache. buzz
          // ships 1; the card measures ~2x at min(cpu, 4). Both are defensible and it is measurable.
          intraOpNumThreads: options.intraOpNumThreads ?? 4,
          interOpNumThreads: 1,
          executionMode: "sequential",
          graphOptimizationLevel: "all"
        };
        const open2 = (file) => ort.InferenceSession.create(join5(dir, file), sessionOptions);
        const [mimiEncoder, textConditioner, flowMain, flowNet, mimiDecoder] = await Promise.all([
          open2("mimi_encoder.onnx"),
          open2("text_conditioner.onnx"),
          open2("flow_lm_main_int8.onnx"),
          open2("flow_lm_flow_int8.onnx"),
          open2("mimi_decoder_int8.onnx")
        ]);
        const tokenizer = SentencePieceUnigram.fromBuffer(await readFile5(join5(dir, meta.tokenizer_file)));
        const bos = meta.bos_before_voice_file === void 0 ? null : readNpy(await readFile5(join5(dir, meta.bos_before_voice_file)));
        return new _PocketTts({
          ort,
          meta,
          bos,
          tokenizer,
          zeroFill: options.__proveZeroFill === true,
          mimiEncoder,
          textConditioner,
          flowMain,
          flowNet,
          mimiDecoder
        });
      }
      /* ---- recurrent state, from the bundle's own manifest ---------------------- */
      /**
       * Build the initial state for one graph.
       *
       * **`fill` is load-bearing and this is the most dangerous line in the file.** The flow LM's
       * attention cache is filled with NaN so that unwritten positions poison anything that reads
       * them — that is how the graph knows a slot is empty. Zero-filling it produces perfectly
       * plausible audio that says nothing, which is exactly why `--prove` breaks it here.
       */
      #initState(manifest) {
        const state = {};
        for (const entry of manifest) {
          const size = entry.shape.reduce((a, b) => a * b, 1);
          let data;
          if (entry.dtype === "int64") data = new BigInt64Array(size);
          else if (entry.dtype === "bool") data = new Uint8Array(size);
          else if (entry.dtype === "float32") data = new Float32Array(size);
          else throw new Error(`unsupported state dtype ${entry.dtype} for ${entry.input_name}`);
          if (!this.#zeroFill) {
            if (entry.fill === "nan" && data instanceof Float32Array) data.fill(Number.NaN);
            else if (entry.fill === "ones") {
              if (data instanceof BigInt64Array) data.fill(1n);
              else data.fill(1);
            }
          }
          state[entry.input_name] = new this.#ort.Tensor(entry.dtype, data, entry.shape);
        }
        return state;
      }
      /**
       * Carry each `out_state_N` back to its `state_N`.
       *
       * BY NAME, not by output position. The reference indexes a positional list with an offset, which
       * is correct there and would be one silent renumber away from wrong here — the same species as
       * `FIXED_BY_DESIGN_STAGES` denoting different transforms after an insert (P37).
       */
      #advance(state, result, manifest) {
        for (const entry of manifest) {
          const next = result[entry.output_name];
          if (next === void 0) throw new Error(`the graph produced no ${entry.output_name}`);
          state[entry.input_name] = next;
        }
      }
      #clone(state) {
        const out = {};
        for (const [k, t] of Object.entries(state)) {
          out[k] = new this.#ort.Tensor(t.type, t.data.slice(), t.dims);
        }
        return out;
      }
      /* ---- voices --------------------------------------------------------------- */
      /** Encode a reference clip into voice embeddings. ~1 s for a 10 s clip, hence the cache above. */
      async encodeVoice(wavBuffer) {
        const { samples, rate } = readWav(wavBuffer);
        const audio = resample(samples, rate, this.sampleRate);
        const out = await this.#mimiEncoder.run({
          audio: new this.#ort.Tensor("float32", audio, [1, 1, audio.length])
        });
        const name = this.#mimiEncoder.outputNames[0];
        const tensor = name === void 0 ? void 0 : out[name];
        if (tensor === void 0) throw new Error("the Mimi encoder produced no output");
        return tensor;
      }
      /**
       * The state every utterance in a voice starts from.
       *
       * Expensive and dependent on nothing else, so it is computed once and cloned per utterance —
       * 746 ms then 7 ms `[measured-here]`. `wavBuffer` may be null once the voice is cached, which is
       * what lets a caller avoid reading 600 KB it will not use.
       */
      async voiceState(key, wavBuffer) {
        const cached = this.#voiceStates.get(key);
        if (cached !== void 0) return this.#clone(cached);
        if (wavBuffer === null) throw new Error(`voice ${key} is not cached and no audio was given`);
        const emb = await this.encodeVoice(wavBuffer);
        let dims = [...emb.dims];
        let data = emb.data;
        if (dims.length > 3) dims = dims.slice(dims.length - 3);
        if (dims.length < 3) dims = [1, dims[0] ?? 0, this.conditioningDim];
        if (this.#meta.insert_bos_before_voice === true && this.#bos !== null) {
          const bosFrames = this.#bos.shape[this.#bos.shape.length - 2] ?? 0;
          const merged = new Float32Array(this.#bos.data.length + data.length);
          merged.set(this.#bos.data, 0);
          merged.set(data, this.#bos.data.length);
          data = merged;
          dims = [1, bosFrames + (dims[1] ?? 0), dims[2] ?? this.conditioningDim];
        }
        const state = this.#initState(this.#meta.flow_lm_state_manifest);
        const result = await this.#flowMain.run({
          sequence: new this.#ort.Tensor("float32", new Float32Array(0), [1, 0, this.latentDim]),
          text_embeddings: new this.#ort.Tensor("float32", data, dims),
          ...state
        });
        this.#advance(state, result, this.#meta.flow_lm_state_manifest);
        this.#voiceStates.set(key, this.#clone(state));
        return state;
      }
      /** Whether a voice's state is already built, so a caller can report a cold first utterance. */
      hasVoice(key) {
        return this.#voiceStates.has(key);
      }
      /* ---- text ----------------------------------------------------------------- */
      /**
       * The reference's prompt hygiene, kept verbatim.
       *
       * It changes the tokens, so it changes the audio: capitalising the first letter and adding a
       * final full stop are not cosmetic, they are what the model was trained to receive.
       */
      preparePrompt(text) {
        let t = text.trim();
        if (t === "") throw new Error("cannot synthesize empty text");
        t = t.replaceAll("\n", " ").replaceAll("\r", " ").replaceAll("  ", " ");
        if (this.#meta.remove_semicolons === true) t = t.replaceAll(";", ",");
        const words = t.split(/\s+/).length;
        const framesAfterEos = words <= 4 ? 3 : 1;
        const first = t[0] ?? "";
        if (first !== first.toUpperCase()) t = first.toUpperCase() + t.slice(1);
        const last = t[t.length - 1] ?? "";
        if (/[\p{L}\p{N}]/u.test(last)) t += ".";
        if (this.#meta.pad_with_spaces_for_short_inputs === true && t.split(/\s+/).length < 5) {
          t = " ".repeat(8) + t;
        }
        return { text: t, framesAfterEos };
      }
      /**
       * Split at the bundle's token cap.
       *
       * The cap is the model's, not ours: `max_token_per_chunk` is 50 for this bundle, and a longer
       * prompt does not error — it degrades. Sentence ends are preferred so prosody does not break
       * mid-phrase; when a single sentence (or a single word) still overflows, the fallback ladder
       * in `splitAtNaturalBoundaries` cuts at a clause, then a word, then a Unicode scalar. Nothing
       * is dropped at any rung.
       */
      splitIntoChunks(text) {
        const { text: prepared } = this.preparePrompt(text);
        return splitAtNaturalBoundaries(
          prepared,
          this.maxTokenPerChunk,
          (s) => this.tokenizer.encode(s).length
        );
      }
      /* ---- generation ----------------------------------------------------------- */
      /**
       * One chunk of text into latent frames. This loop is the entire cost of speaking.
       *
       * **EOS is a logit, not a token.** The graph reports `eos_logit > -4.0`, and the reference then
       * runs `framesAfterEos` MORE frames before stopping — cutting on the first EOS clips the tail of
       * the last word, which is the kind of defect a listener hears as a swallowed consonant and
       * cannot name.
       */
      async *framesFor(baseState, tokenIds, opts) {
        const state = this.#clone(baseState);
        const ids = BigInt64Array.from(tokenIds.map((n) => BigInt(n)));
        const conditioned = await this.#textConditioner.run({
          token_ids: new this.#ort.Tensor("int64", ids, [1, ids.length])
        });
        const teName = this.#textConditioner.outputNames[0];
        const te = teName === void 0 ? void 0 : conditioned[teName];
        if (te === void 0) throw new Error("the text conditioner produced no output");
        const teDims = te.dims.length === 2 ? [1, ...te.dims] : [...te.dims];
        const primed = await this.#flowMain.run({
          sequence: new this.#ort.Tensor("float32", new Float32Array(0), [1, 0, this.latentDim]),
          text_embeddings: new this.#ort.Tensor("float32", te.data, teDims),
          ...state
        });
        this.#advance(state, primed, this.#meta.flow_lm_state_manifest);
        let curr = new this.#ort.Tensor(
          "float32",
          new Float32Array(this.latentDim).fill(this.#zeroFill ? 0 : Number.NaN),
          [1, 1, this.latentDim]
        );
        const emptyText = new this.#ort.Tensor("float32", new Float32Array(0), [1, 0, this.conditioningDim]);
        const limit = opts.maxFrames ?? Math.ceil((tokenIds.length / 3 + 2) * this.frameRate);
        const dt = 1 / opts.lsdSteps;
        const std = opts.temperature > 0 ? Math.sqrt(opts.temperature) : 0;
        let eosStep = null;
        for (let step = 0; step < limit; step++) {
          const out = await this.#flowMain.run({ sequence: curr, text_embeddings: emptyText, ...state });
          const conditioning = out.conditioning;
          const eos = out.eos_logit;
          if (conditioning === void 0 || eos === void 0) {
            throw new Error("the flow LM produced no conditioning or no eos_logit");
          }
          this.#advance(state, out, this.#meta.flow_lm_state_manifest);
          const eosValue = eos.data[0] ?? Number.NEGATIVE_INFINITY;
          if (eosValue > -4 && eosStep === null) eosStep = step;
          if (eosStep !== null && step >= eosStep + opts.framesAfterEos) return;
          const x = new Float32Array(this.latentDim);
          if (std > 0) for (let i = 0; i < x.length; i++) x[i] = opts.rng(std);
          for (let j = 0; j < opts.lsdSteps; j++) {
            const s = j / opts.lsdSteps;
            const flow = await this.#flowNet.run({
              c: conditioning,
              s: new this.#ort.Tensor("float32", Float32Array.of(s), [1, 1]),
              t: new this.#ort.Tensor("float32", Float32Array.of(s + dt), [1, 1]),
              x: new this.#ort.Tensor("float32", x, [1, this.latentDim])
            });
            const dirName = this.#flowNet.outputNames[0];
            const dir = dirName === void 0 ? void 0 : flow[dirName];
            if (dir === void 0) throw new Error("the flow network produced no direction");
            const d2 = dir.data;
            for (let i = 0; i < x.length; i++) x[i] = (x[i] ?? 0) + (d2[i] ?? 0) * dt;
          }
          curr = new this.#ort.Tensor("float32", x.slice(), [1, 1, this.latentDim]);
          yield x.slice();
        }
      }
      /** Latent frames into audio, in batches, carrying the decoder's own recurrent state. */
      async decodeFrames(frames, chunkSize = 15) {
        const state = this.#initState(this.#meta.mimi_state_manifest);
        const pieces = [];
        for (let i = 0; i < frames.length; i += chunkSize) {
          const batch = frames.slice(i, i + chunkSize);
          const flat = new Float32Array(batch.length * this.latentDim);
          for (const [b, frame] of batch.entries()) flat.set(frame, b * this.latentDim);
          const out = await this.#mimiDecoder.run({
            latent: new this.#ort.Tensor("float32", flat, [1, batch.length, this.latentDim]),
            ...state
          });
          const audio = out.audio_frame;
          if (audio === void 0) throw new Error("the Mimi decoder produced no audio_frame");
          pieces.push(audio.data);
          this.#advance(state, out, this.#meta.mimi_state_manifest);
        }
        const total = pieces.reduce((n, p) => n + p.length, 0);
        const merged = new Float32Array(total);
        let at = 0;
        for (const p of pieces) {
          merged.set(p, at);
          at += p.length;
        }
        return merged;
      }
      /** Text plus a voice into 24 kHz mono float32. */
      async synthesize(text, voice, params = {}) {
        const temperature = params.temperature ?? 0.7;
        const lsdSteps = params.lsdSteps ?? 1;
        const rng = makeRng(params.seed ?? 1);
        const frames = [];
        for (const chunk of this.splitIntoChunks(text)) {
          const trimmed = chunk.trim();
          if (trimmed === "") continue;
          const { framesAfterEos } = this.preparePrompt(trimmed);
          const effective = this.#meta.model_recommended_frames_after_eos ?? framesAfterEos + 2;
          for await (const frame of this.framesFor(voice, this.tokenizer.encode(trimmed), {
            temperature,
            lsdSteps,
            maxFrames: params.maxFrames ?? null,
            framesAfterEos: effective,
            rng
          })) frames.push(frame);
        }
        return this.decodeFrames(frames);
      }
    };
  }
});

// packages/plugin/src/main.ts
import { existsSync as existsSync4 } from "node:fs";
import { readFile as readFile9 } from "node:fs/promises";

// packages/providers/src/os-synth/index.ts
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
var DEFAULT_SPAWN_TIMEOUT_MS = 6e4;
var CAPABILITIES = {
  streaming: false,
  // whole-utterance only; honest per T041d
  offline: true,
  needsApiKey: false,
  needsModelDownload: 0,
  licence: "OS-provided",
  cloning: false,
  sampleRate: 22050
};
function neutralizeInBandCommands(text) {
  return text.replace(/\[\[/g, "[ [");
}
var OsSynthUnavailableError = class extends Error {
  constructor(platform, tried) {
    super(`No OS speech synthesizer found on ${platform}. Tried: ${tried.join(", ")}`);
    this.name = "OsSynthUnavailableError";
  }
};
var OsSynthEmptyOutputError = class extends Error {
  constructor(cmd, why) {
    super(why === "empty" ? `${cmd} exited successfully but wrote no audio (is the disk full?)` : `${cmd} exited successfully but its audio file could not be read`);
    this.name = "OsSynthEmptyOutputError";
  }
};
var OsSynthExitError = class extends Error {
  code;
  stderr;
  constructor(cmd, code, stderr) {
    const said = stderr.trim();
    super(said.length > 0 ? `${cmd} exited ${String(code)}: ${said}` : `${cmd} exited ${String(code)} without writing audio and said nothing about why`);
    this.name = "OsSynthExitError";
    this.code = code;
    this.stderr = said;
  }
};
var OsSynthTimeoutError = class extends Error {
  constructor(cmd, ms) {
    super(`${cmd} did not finish within ${ms} ms and was killed`);
    this.name = "OsSynthTimeoutError";
  }
};
var LINUX_BACKENDS = ["espeak-ng", "espeak", "spd-say"];
var LINUX_WAV_BACKENDS = ["espeak-ng", "espeak"];
var LINUX_INSTALL_HINT = "Install one with:  sudo apt install espeak-ng   (or, for the speech-dispatcher floor:  sudo apt install speech-dispatcher speech-dispatcher-espeak-ng). Note: a stock Ubuntu desktop ships the espeak-ng LIBRARY but not the espeak-ng command.";
var LinuxSpeechUnavailableError = class extends Error {
  tried;
  constructor(tried = LINUX_BACKENDS) {
    super(`No Linux speech synthesizer found. Tried: ${tried.join(", ")}. ${LINUX_INSTALL_HINT}`);
    this.name = "LinuxSpeechUnavailableError";
    this.tried = tried;
  }
};
var ESPEAK_BASE_WPM = 175;
var clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function linuxCommand(backend, rawText, outFile, opts) {
  const text = neutralizeInBandCommands(rawText);
  if (backend === "spd-say") {
    const args2 = ["--wait"];
    if (opts.voice !== void 0) args2.push("-y", opts.voice);
    if (opts.rate !== void 0) args2.push("-r", String(clamp(Math.round((opts.rate - 1) * 100), -100, 100)));
    args2.push("--", text);
    return { cmd: "spd-say", args: args2 };
  }
  const args = ["-w", outFile];
  if (opts.voice !== void 0) args.push("-v", opts.voice);
  if (opts.rate !== void 0) args.push("-s", String(clamp(Math.round(opts.rate * ESPEAK_BASE_WPM), 80, 450)));
  args.push("--", text);
  return { cmd: backend, args };
}
function darwinCommand(text, outFile, opts) {
  const args = ["-o", outFile, "--data-format=LEI16@22050"];
  if (opts.voice !== void 0) args.push("-v", opts.voice);
  if (opts.rate !== void 0) args.push("-r", String(Math.round(opts.rate * 175)));
  args.push("--", text);
  return { cmd: "say", args };
}
function win32Command(text, outFile, opts) {
  const esc = (s) => s.replace(/'/g, "''");
  const rate = opts.rate === void 0 ? 0 : Math.max(-10, Math.min(10, Math.round((opts.rate - 1) * 10)));
  const voice = opts.voice === void 0 ? "" : `$s.SelectVoice('${esc(opts.voice)}'); `;
  const ps = "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; " + voice + `$s.Rate = ${rate}; $s.SetOutputToWaveFile('${esc(outFile)}'); $s.Speak('${esc(text)}'); $s.Dispose()`;
  return { cmd: "powershell", args: ["-NoProfile", "-NonInteractive", "-STA", "-Command", ps] };
}
var OsSynthProvider = class {
  id = "os-synth";
  displayName = "System voice";
  capabilities = CAPABILITIES;
  #platform;
  #timeoutMs;
  #notify;
  #warm = false;
  #child = null;
  #cancelled = false;
  #linuxBackend = void 0;
  #linuxCandidates = LINUX_BACKENDS;
  #announcedFloor = false;
  #unavailableReason = null;
  /**
   * Resolves once the last `spd-say --cancel` has actually exited. 006 C6 + site 39: the cancel was
   * fire-and-forget with BOTH its 'error' event and its surrounding catch swallowed, so barge-in on
   * the Linux floor could fail with no trace — and the next utterance was handed to the same daemon
   * before the cancel arrived, producing two overlapping voices.
   */
  #cancelInFlight = null;
  #lastCancelFailure = null;
  constructor(opts = {}) {
    this.#platform = opts.platform ?? process.platform;
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS;
    this.#notify = opts.notify ?? (() => {
    });
    if (opts.linuxBackend !== void 0) this.#linuxBackend = opts.linuxBackend;
    if (opts.linuxBackendCandidates !== void 0) this.#linuxCandidates = opts.linuxBackendCandidates;
  }
  get isWarm() {
    return this.#warm;
  }
  /**
   * Why the last detection failed, in words a user can act on. `null` once something works.
   * Read by the host so the reason reaches a notification instead of dying in a catch block.
   */
  get unavailableReason() {
    return this.#unavailableReason;
  }
  /** Which Linux binary is actually driving speech, once detected. `null` on other platforms. */
  get linuxBackend() {
    return this.#linuxBackend ?? null;
  }
  /**
   * Confirm the synthesizer actually answers, and THROW when it does not.
   *
   * This used to be `await this.listVoices()`, which catches everything and returns `[]` without
   * throwing — so on macOS and Windows a broken `say` or a broken PowerShell set `#warm = true`,
   * the registry reported `rung: 'preferred'` with no reason, and the plugin logged "engine ready"
   * while being permanently mute. The real cause was written to `unavailableReason`, whose own doc
   * comment says it exists "so the reason reaches a notification instead of dying in a catch
   * block", and NO CALLER READ IT (006 sites 41 and 54, and the first of the FMA's three to fix
   * first). P25 and P18 fused: a probe that cannot fail, feeding a diagnostic nobody reads.
   *
   * `listVoices()` keeps its forgiving contract — it answers a settings UI's question, and "[]"
   * is a survivable answer there. `prepare()` answers "can this machine speak at all", and the
   * only honest answers to that are yes and a named no.
   */
  async prepare() {
    if (this.#warm) return;
    if (this.#platform === "linux") {
      await this.#resolveLinuxBackend();
      this.#warm = true;
      return;
    }
    const voices = await this.listVoices();
    if (voices.length === 0) {
      const why = this.#unavailableReason ?? `${this.#platform === "darwin" ? "say" : "powershell"} ran but listed no voices`;
      this.#unavailableReason = why;
      const err = new OsSynthUnavailableError(this.#platform, [this.#platform === "darwin" ? "say" : "powershell"]);
      err.message = `${err.message} \u2014 ${why}`;
      this.#notify(`Read Aloud: ${err.message}`);
      throw err;
    }
    this.#unavailableReason = null;
    this.#warm = true;
  }
  /** Why the last daemon cancel failed, if it did. `null` when barge-in reached the daemon. */
  get lastCancelFailure() {
    return this.#lastCancelFailure;
  }
  cancel() {
    this.#cancelled = true;
    const c = this.#child;
    this.#child = null;
    if (c !== null && c.exitCode === null) c.kill("SIGKILL");
    if (this.#linuxBackend !== "spd-say") return;
    this.#cancelInFlight = new Promise((resolve) => {
      let child;
      try {
        child = spawn("spd-say", ["--cancel"], { stdio: "ignore" });
      } catch (err) {
        this.#noteCancelFailure(`spd-say --cancel could not be spawned: ${String(err)}`);
        resolve();
        return;
      }
      const done = (why) => {
        this.#noteCancelFailure(why);
        resolve();
      };
      child.on("error", (err) => {
        done(`spd-say --cancel could not be started: ${String(err)}`);
      });
      child.on("close", (code) => {
        done(code === 0 ? null : `spd-say --cancel exited ${String(code)}; the daemon may still be speaking`);
      });
    });
    return this.#cancelInFlight;
  }
  #noteCancelFailure(why) {
    this.#lastCancelFailure = why;
    if (why !== null) this.#notify(`Read Aloud: stop may not have worked \u2014 ${why}`);
  }
  /**
   * Detect once, cache, and FAIL LOUDLY. Returns the winning backend or throws
   * `LinuxSpeechUnavailableError` naming every binary tried and the install command.
   */
  async #resolveLinuxBackend() {
    if (this.#linuxBackend !== void 0 && this.#linuxBackend !== null) return this.#linuxBackend;
    const tried = [];
    for (const backend of this.#linuxCandidates) {
      tried.push(backend);
      const ok = await this.#capture(backend, ["--version"]).then(() => true, () => false);
      if (!ok) continue;
      this.#linuxBackend = backend;
      this.#unavailableReason = null;
      if (!LINUX_WAV_BACKENDS.includes(backend) && !this.#announcedFloor) {
        this.#announcedFloor = true;
        this.#notify(
          `Read Aloud: espeak-ng is not installed, so speech is going through speech-dispatcher (spd-say). Quality and interruption are limited. ${LINUX_INSTALL_HINT}`
        );
      }
      return backend;
    }
    this.#linuxBackend = null;
    const err = new LinuxSpeechUnavailableError(tried);
    this.#unavailableReason = err.message;
    this.#notify(`Read Aloud: ${err.message}`);
    throw err;
  }
  async listVoices() {
    try {
      switch (this.#platform) {
        case "darwin": {
          const out = await this.#capture("say", ["-v", "?"]);
          return out.split("\n").map((l) => l.split(/\s{2,}/)[0]?.trim() ?? "").filter((v) => v.length > 0);
        }
        case "win32": {
          const ps = "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | %{ $_.VoiceInfo.Name }";
          const out = await this.#capture("powershell", ["-NoProfile", "-NonInteractive", "-STA", "-Command", ps]);
          return out.split("\n").map((l) => l.trim()).filter((v) => v.length > 0);
        }
        case "linux": {
          const out = await this.#capture("spd-say", ["--list-synthesis-voices"]).catch(() => "");
          if (out.length > 0) return out.split("\n").map((l) => l.trim()).filter((v) => v.length > 0);
          await this.#resolveLinuxBackend();
          return ["default"];
        }
      }
    } catch (err) {
      this.#unavailableReason = err instanceof Error ? err.message : String(err);
      return [];
    }
  }
  async *generate(text, opts = {}) {
    this.#cancelled = false;
    if (text.trim().length === 0) return;
    if (this.#platform === "linux") {
      const backend = await this.#resolveLinuxBackend();
      if (!LINUX_WAV_BACKENDS.includes(backend)) {
        await this.#speakDirect(text, opts);
        return;
      }
    }
    const dir = await mkdtemp(join(tmpdir(), "orca-tts-"));
    const wav = join(dir, "out.wav");
    try {
      await this.#synthesizeToFile(text, wav, opts);
      if (this.#cancelled || opts.signal?.aborted === true) return;
      const data = await readFile(wav).catch(() => null);
      if (data === null) throw new OsSynthEmptyOutputError(this.#command(text, wav, opts).cmd, "unreadable");
      if (data.length === 0) throw new OsSynthEmptyOutputError(this.#command(text, wav, opts).cmd, "empty");
      yield { data: new Uint8Array(data), format: "wav", sampleRate: CAPABILITIES.sampleRate, channels: 1 };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => void 0);
    }
  }
  #command(rawText, outFile, opts) {
    const text = neutralizeInBandCommands(rawText);
    switch (this.#platform) {
      case "darwin":
        return darwinCommand(text, outFile, opts);
      case "win32":
        return win32Command(text, outFile, opts);
      case "linux": {
        return linuxCommand(this.#linuxBackend ?? "espeak-ng", text, outFile, opts);
      }
    }
  }
  async #synthesizeToFile(text, outFile, opts) {
    const { cmd, args } = this.#command(text, outFile, opts);
    await new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
      } catch (err) {
        reject(new OsSynthUnavailableError(this.#platform, [cmd]));
        void err;
        return;
      }
      this.#child = child;
      let stderr = "";
      child.stderr?.on("data", (d2) => {
        if (stderr.length < 4096) stderr += d2.toString("utf8");
      });
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
        reject(new OsSynthTimeoutError(cmd, this.#timeoutMs));
      }, this.#timeoutMs);
      const settle = (fn) => {
        clearTimeout(timer);
        fn();
      };
      child.on("error", () => settle(() => reject(new OsSynthUnavailableError(this.#platform, [cmd]))));
      child.on("close", (code) => settle(() => {
        this.#child = null;
        if (code === null || code === 0 || this.#cancelled || opts.signal?.aborted === true) {
          resolve();
          return;
        }
        reject(new OsSynthExitError(cmd, code, stderr));
      }));
      opts.signal?.addEventListener("abort", () => this.cancel(), { once: true });
    });
  }
  /**
   * Linux floor: hand the text to speech-dispatcher and wait for it to finish speaking.
   * We produce NO audio here — the daemon plays it. This is the one place a provider does not
   * emit PCM, and it exists only because on a stock Ubuntu desktop the alternative is silence.
   */
  async #speakDirect(text, opts) {
    if (this.#cancelInFlight !== null) {
      await this.#cancelInFlight;
      this.#cancelInFlight = null;
      if (this.#cancelled) return;
    }
    await this.#synthesizeToFile(text, "", opts);
  }
  #capture(cmd, args) {
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(cmd, [...args], { stdio: ["ignore", "pipe", "ignore"] });
      } catch {
        reject(new OsSynthUnavailableError(this.#platform, [cmd]));
        return;
      }
      let out = "";
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
        reject(new OsSynthTimeoutError(cmd, this.#timeoutMs));
      }, this.#timeoutMs);
      const settle = (fn) => {
        clearTimeout(timer);
        fn();
      };
      child.stdout?.on("data", (d2) => {
        out += d2.toString("utf8");
      });
      child.on("error", () => settle(() => reject(new OsSynthUnavailableError(this.#platform, [cmd]))));
      child.on("close", (code) => settle(() => {
        if (code === 0) resolve(out);
        else reject(new OsSynthUnavailableError(this.#platform, [cmd]));
      }));
    });
  }
};

// packages/providers/src/pocket-synth/index.ts
init_audio();
init_models();
init_voices();
import { readFile as readFile6 } from "node:fs/promises";
import { join as join6 } from "node:path";
var ORT_MODULE = "onnxruntime-node";
var POCKET_CAPABILITIES = {
  streaming: false,
  offline: true,
  needsApiKey: false,
  needsModelDownload: INSTALL_TOTAL_BYTES,
  licence: "CC-BY-4.0",
  cloning: true,
  sampleRate: 24e3
};
var PocketOrtUnavailableError = class extends Error {
  constructor(cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    super(`Pocket TTS needs the optional module "${ORT_MODULE}", but it could not be loaded: ${why}`, {
      cause
    });
    this.name = "PocketOrtUnavailableError";
  }
};
var PocketModelUnavailableError = class extends Error {
  status;
  constructor(status) {
    const detail = status.kind === "absent" ? `missing ${status.missing.join(", ")}` : modelStatusDetail(status);
    super(`Pocket TTS model is not ready in ${status.dir}: ${detail}`);
    this.name = "PocketModelUnavailableError";
    this.status = status;
  }
};
var PocketVoiceUnavailableError = class extends Error {
  voice;
  constructor(voice) {
    super(`Pocket TTS has no voice named ${voice}`);
    this.name = "PocketVoiceUnavailableError";
    this.voice = voice;
  }
};
function cancellation(external) {
  const controller = new AbortController();
  let settleStopped;
  let settleFinished;
  const token = {
    cancelled: external?.aborted === true,
    iterator: null,
    signal: controller.signal,
    stopped: new Promise((resolve) => {
      settleStopped = resolve;
    }),
    finished: new Promise((resolve) => {
      settleFinished = resolve;
    }),
    stop: () => {
      if (token.cancelled) return;
      token.cancelled = true;
      controller.abort();
      void token.iterator?.return?.()?.then(() => void 0, () => void 0);
      settleStopped?.();
    },
    finish: () => {
      settleFinished?.();
    },
    dispose: () => {
      external?.removeEventListener("abort", token.stop);
      settleFinished?.();
    }
  };
  if (token.cancelled) {
    controller.abort();
    settleStopped?.();
  } else {
    external?.addEventListener("abort", token.stop, { once: true });
  }
  return token;
}
function hasFrameLoop(engine) {
  return typeof engine.framesFor === "function" && typeof engine.decodeFrames === "function" && engine.tokenizer !== void 0;
}
function applySpeechRate(samples, sampleRate, rate) {
  if (rate === void 0 || rate === 1) return samples;
  if (!(rate > 0) || !Number.isFinite(rate)) {
    throw new RangeError(`Pocket TTS speaking rate must be a positive finite number, got ${String(rate)}`);
  }
  return resample(samples, sampleRate, sampleRate / rate);
}
function pocketRng(seed = 1) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  let spare = null;
  return (std) => {
    if (spare !== null) {
      const v2 = spare;
      spare = null;
      return v2 * std;
    }
    let u = 0;
    let v = 0;
    let r = 0;
    do {
      u = next() * 2 - 1;
      v = next() * 2 - 1;
      r = u * u + v * v;
    } while (r === 0 || r >= 1);
    const mag = Math.sqrt(-2 * Math.log(r) / r);
    spare = v * mag;
    return u * mag * std;
  };
}
var PocketSynthProvider = class {
  id = "pocket";
  displayName = "Pocket TTS (neural)";
  capabilities = POCKET_CAPABILITIES;
  #dir;
  #loadOrt;
  #loadEngine;
  #modelStatus;
  #readFile;
  #voiceStates = /* @__PURE__ */ new Map();
  #active = /* @__PURE__ */ new Set();
  #engine = null;
  #preparing = null;
  constructor(opts = {}) {
    this.#dir = opts.dir ?? modelDir();
    this.#loadOrt = opts.loadOrt ?? (async () => {
      const { loadOrt: loadOrt2 } = await Promise.resolve().then(() => (init_engine(), engine_exports));
      return loadOrt2();
    });
    this.#loadEngine = opts.loadEngine ?? (async () => await Promise.resolve().then(() => (init_engine(), engine_exports)));
    this.#modelStatus = opts.modelStatus ?? modelStatus;
    this.#readFile = opts.readFile ?? (async (path) => readFile6(path));
  }
  get isWarm() {
    return this.#engine !== null;
  }
  async prepare() {
    if (this.#engine !== null) return;
    if (this.#preparing !== null) return this.#preparing;
    const preparing = this.#prepareOnce();
    this.#preparing = preparing;
    try {
      await preparing;
    } finally {
      if (this.#preparing === preparing) this.#preparing = null;
    }
  }
  async #prepareOnce() {
    const status = await this.#modelStatus(this.#dir);
    if (status.kind !== "ready") throw new PocketModelUnavailableError(status);
    try {
      await this.#loadOrt();
    } catch (err) {
      throw new PocketOrtUnavailableError(err);
    }
    const { PocketTts: PocketTts2 } = await this.#loadEngine();
    this.#engine = await PocketTts2.load(this.#dir);
  }
  async listVoices() {
    return POCKET_VOICES.map((voice) => voice.key);
  }
  async *generate(text, opts = {}) {
    if (text.trim().length === 0) return;
    const active = cancellation(opts.signal);
    this.#active.add(active);
    try {
      if (active.cancelled) return;
      await this.prepare();
      if (active.cancelled) return;
      const engine = this.#engine;
      if (engine === null) throw new Error("Pocket TTS prepare completed without an engine");
      const voice = this.#resolveVoice(opts.voice ?? POCKET_DEFAULT_VOICE);
      const state = await this.#voiceState(engine, voice);
      if (active.cancelled) return;
      const samples = hasFrameLoop(engine) ? await this.#renderFrames(engine, state, text, active) : await this.#renderSynthesize(engine, state, text, active);
      if (samples === null || active.cancelled) return;
      const timed = applySpeechRate(samples, engine.sampleRate, opts.rate);
      const wav = writeWav(timed, engine.sampleRate);
      yield {
        data: new Uint8Array(wav),
        format: "wav",
        sampleRate: engine.sampleRate,
        channels: 1
      };
    } finally {
      this.#active.delete(active);
      active.finish();
      active.dispose();
    }
  }
  async cancel() {
    const pending = [...this.#active];
    for (const active of pending) active.stop();
    await Promise.all(pending.map((active) => active.finished));
  }
  /**
   * Drive `framesFor` so cancel can close the generator between ONNX frames.
   * The real engine exposes this loop; tests that only stub `synthesize` take the other path.
   */
  async #renderFrames(engine, state, text, active) {
    const chunks = engine.splitIntoChunks?.(text) ?? [text];
    const frames = [];
    const rng = pocketRng(1);
    for (const chunk of chunks) {
      if (active.cancelled) return null;
      const ids = [...engine.tokenizer.encode(chunk)];
      const framesAfterEos = (engine.preparePrompt?.(chunk).framesAfterEos ?? 1) + 2;
      const iterator = engine.framesFor(state, ids, {
        temperature: 0.7,
        lsdSteps: 1,
        maxFrames: null,
        framesAfterEos,
        rng,
        signal: active.signal
      })[Symbol.asyncIterator]();
      active.iterator = iterator;
      try {
        for (; ; ) {
          const next = await iterator.next();
          if (next.done === true || active.cancelled) break;
          frames.push(next.value);
        }
      } finally {
        if (active.iterator === iterator) active.iterator = null;
      }
      if (active.cancelled) return null;
    }
    if (active.cancelled) return null;
    return engine.decodeFrames(frames);
  }
  async #renderSynthesize(engine, state, text, active) {
    const rendered = engine.synthesize(text, state, { signal: active.signal }).then(
      (samples) => ({ kind: "audio", samples }),
      (error) => ({ kind: "error", error })
    );
    const outcome = await Promise.race([
      rendered,
      active.stopped.then(() => ({ kind: "cancelled" }))
    ]);
    if (outcome.kind === "cancelled" || active.cancelled) return null;
    if (outcome.kind === "error") throw outcome.error;
    return outcome.samples;
  }
  /**
   * R16-08: accept BOTH spellings, because the seam produces both and neither half was wrong.
   *
   * `listVoices()` advertises qualified keys (`pocket:anna`) so the picker cannot confuse a Pocket
   * voice with an OS one. But `scripts/voice-lab.mjs` strips the qualifier before dispatch, on
   * purpose -- "a qualified key is never handed to either provider" -- so what actually arrives
   * here is the bare `anna`. This used to run it through `parseVoiceKey`, whose documented rule is
   * that an unqualified name means `os:`, and throw. Every advertised voice 503'd.
   *
   * A bare name is therefore provider-local and means THIS backend. A qualified one must name this
   * backend or be refused. What is never allowed is falling back to a default: a listener who
   * asked for Anna and silently got Mary has been lied to about who is speaking (principle VIII),
   * so an unknown name is still an error in both spellings.
   */
  #resolveVoice(key) {
    const qualified = key.includes(":");
    if (qualified && parseVoiceKey(key).backend !== POCKET_BACKEND) {
      throw new PocketVoiceUnavailableError(key);
    }
    const wanted = qualified ? key : formatVoiceKey(POCKET_BACKEND, key);
    const voice = POCKET_VOICES.find((candidate) => candidate.key === wanted);
    if (voice === void 0) throw new PocketVoiceUnavailableError(key);
    return voice;
  }
  async #voiceState(engine, voice) {
    const cached = this.#voiceStates.get(voice.key);
    if (cached !== void 0) return cached;
    const loading = this.#readFile(join6(this.#dir, voice.file)).then(async (wav) => engine.voiceState(voice.key, wav));
    this.#voiceStates.set(voice.key, loading);
    try {
      return await loading;
    } catch (err) {
      if (this.#voiceStates.get(voice.key) === loading) this.#voiceStates.delete(voice.key);
      throw err;
    }
  }
};

// packages/providers/src/registry.ts
var ProviderRegistry = class {
  #providers = /* @__PURE__ */ new Map();
  #preferredId = null;
  #lastFailure = null;
  #lastFailureDetail = null;
  register(p, opts = {}) {
    this.#providers.set(p.id, p);
    if (opts.preferred === true) this.#preferredId = p.id;
  }
  get(id) {
    return this.#providers.get(id);
  }
  /**
   * Why the last `resolve()` could not use a provider. Kept because discarding it is how a
   * missing Linux binary turned into "no speech engine is available" with no way to act on it.
   */
  get lastFailure() {
    return this.#lastFailure;
  }
  /**
   * The named form of the same failure. Read this, not `lastFailure`, when the caller has to
   * DECIDE something — "nothing was registered" is a bug in our own wiring and "prepare threw" is
   * a fact about the user's machine, and they were previously the same `null`.
   */
  get lastFailureDetail() {
    return this.#lastFailureDetail;
  }
  list() {
    return [...this.#providers.values()];
  }
  /**
   * Resolve the best usable provider, preferring `requestedId`, then the preferred engine, then
   * anything offline. Never returns silently-degraded: the status carries the reason (R015).
   */
  async resolve(requestedId) {
    const tryOrder = [
      requestedId,
      this.#preferredId ?? void 0,
      ...this.list().filter((p) => p.capabilities.offline).map((p) => p.id)
    ].filter((x) => typeof x === "string");
    this.#lastFailure = null;
    this.#lastFailureDetail = null;
    const seen = /* @__PURE__ */ new Set();
    const unknown = [];
    const tried = [];
    const failures = [];
    let rung = "preferred";
    for (const id of tryOrder) {
      if (seen.has(id)) continue;
      seen.add(id);
      const p = this.#providers.get(id);
      if (p === void 0) {
        rung = "fallback";
        unknown.push(id);
        continue;
      }
      try {
        await p.prepare();
      } catch (err) {
        rung = "fallback";
        tried.push(id);
        const why = err instanceof Error ? err.message : String(err);
        failures.push(`${id}: ${why}`);
        this.#lastFailure = why;
        continue;
      }
      const unavailable = [
        ...failures,
        ...unknown.map((missing) => `${missing}: no provider with that id is registered`)
      ];
      const reason = rung === "preferred" ? void 0 : `${requestedId ?? this.#preferredId ?? "preferred engine"} was unavailable${unavailable.length === 0 ? "" : ` (${unavailable.join("; ")})`}; using ${p.displayName}`;
      return { provider: p, status: reason === void 0 ? { providerId: p.id, rung } : { providerId: p.id, rung, reason } };
    }
    this.#lastFailureDetail = this.#describeFailure(tried, unknown, failures);
    this.#lastFailure = this.#lastFailureDetail.reason;
    return null;
  }
  #describeFailure(tried, unknown, failures) {
    if (this.#providers.size === 0) {
      return {
        kind: "none-registered",
        reason: "no speech engine is registered \u2014 the plugin did not finish wiring itself up",
        tried,
        unknown
      };
    }
    if (tried.length === 0) {
      return {
        kind: "unknown-id",
        reason: unknown.length === 0 ? "no speech engine could be selected" : `no speech engine named ${unknown.join(", ")} is installed in this build`,
        tried,
        unknown
      };
    }
    return { kind: "prepare-failed", reason: failures.join("; "), tried, unknown };
  }
};

// packages/providers/src/index.ts
function createProviderRegistry(options = {}) {
  const registry = new ProviderRegistry();
  registry.register(options.os ?? new OsSynthProvider(), { preferred: true });
  if (options.pocket !== false) {
    registry.register(options.pocket ?? new PocketSynthProvider());
  }
  return registry;
}

// packages/core/src/normalizer/index.ts
var EXTENSION_WORDS = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "C",
  h: "header",
  cpp: "C plus plus",
  cs: "C sharp",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  md: "markdown",
  json: "JSON",
  jsonl: "JSON lines",
  yml: "YAML",
  yaml: "YAML",
  toml: "TOML",
  html: "HTML",
  css: "CSS",
  sql: "SQL",
  txt: "text",
  csv: "CSV",
  xml: "XML",
  lock: "lock"
};
var UNIT_WORDS = {
  ms: ["millisecond", "milliseconds"],
  s: ["second", "seconds"],
  m: ["minute", "minutes"],
  h: ["hour", "hours"],
  kb: ["kilobyte", "kilobytes"],
  mb: ["megabyte", "megabytes"],
  gb: ["gigabyte", "gigabytes"],
  tb: ["terabyte", "terabytes"],
  hz: ["hertz", "hertz"],
  khz: ["kilohertz", "kilohertz"],
  px: ["pixel", "pixels"]
};
var KEY_GLYPHS = {
  "\u2318": "command",
  "\u21E7": "shift",
  "\u2325": "option",
  "\u2303": "control",
  "\u23CE": "enter",
  "\u232B": "delete",
  "\u21E5": "tab",
  "\u2423": "space",
  "\u2191": "up",
  "\u2193": "down",
  "\u2190": "left",
  "\u2192": "right",
  /**
   * 006 site 50: `stripEmoji` deleted emoji, dingbats AND CHECK MARKS with no announcement, so
   * "\u2705 done" and "\u274C done" reached the listener as the same word — the verdict removed and
   * only the subject left. These carry MEANING in an agent reply; a party popper does not, and
   * still does not get one. Spoken as words, not announced as omissions: "yes" is the content, and
   * "an emoji was omitted" would be narration.
   */
  "\u2713": "yes",
  "\u2714": "yes",
  "\u2705": "yes",
  "\u2717": "no",
  "\u2718": "no",
  "\u274C": "no",
  "\u274E": "no",
  "\u26A0": "warning",
  "\u2757": "important",
  "\u2755": "important"
};
var CODE_PLACEHOLDER = " . Here, a code block is omitted. ";
var UNCLOSED_CODE_PLACEHOLDER = " . Here, a code block is omitted, and the reply ends inside it, so anything after it was not read. ";
var SPEAKABLE_GLYPH = /[\p{L}\p{N}]/u;
function hasSpeakableGlyph(text) {
  return SPEAKABLE_GLYPH.test(text);
}
function normalize(md, opts = {}) {
  const codeBlocks = opts.codeBlocks ?? "announce";
  const pathStyle = opts.pathStyle ?? "spoken";
  const doNumbers = opts.expandNumbers ?? true;
  const doUnits = opts.expandUnits ?? true;
  let s = stripFencedCode(md, codeBlocks);
  s = stripHtmlComments(s);
  s = diagramsToLabels(s);
  s = stripInlineCode(s);
  s = expandMarkdownLinks(s);
  s = stripUrls(s);
  s = headingsToPauses(s);
  s = listItemsToSentences(s, opts.orderedLists ?? "numeral");
  s = tablesToRows(s);
  if (pathStyle !== "verbatim") s = speakFilePaths(s, pathStyle, opts.extensionStyle ?? "word-last");
  s = stripMarkdownMarkers(s);
  s = speakKeyGlyphs(s);
  s = stripEmoji(s);
  if (doUnits) s = expandUnits(s);
  if (doNumbers) s = expandNumbers(s);
  s = collapseWhitespace(s);
  s = tidyPunctuation(s);
  return hasSpeakableGlyph(s) ? s : "";
}
function isFence(line) {
  const t = line.trimStart();
  return t.startsWith("```") || t.startsWith("~~~");
}
function fenceInfo(line) {
  const t = line.trimStart();
  return t.slice(3).trim().toLowerCase();
}
function isSpeakFence(line) {
  const info = fenceInfo(line);
  return info === "speak" || info.startsWith("speak ");
}
function stripFencedCode(src, policy) {
  const out = [];
  const lines = src.split("\n");
  let inFence = false;
  let inSpeak = false;
  let announced = false;
  for (const line of lines) {
    if (isFence(line)) {
      if (inSpeak) {
        inSpeak = false;
        continue;
      }
      if (!inFence) {
        if (isSpeakFence(line)) {
          inSpeak = true;
          continue;
        }
        inFence = true;
        announced = false;
        if (policy === "announce") {
          out.push(CODE_PLACEHOLDER);
          announced = true;
        }
      } else {
        inFence = false;
      }
      continue;
    }
    if (inSpeak) {
      out.push(line);
      continue;
    }
    if (!inFence) out.push(line);
  }
  if (inFence && announced) {
    const at = out.lastIndexOf(CODE_PLACEHOLDER);
    if (at !== -1) out[at] = UNCLOSED_CODE_PLACEHOLDER;
  } else if (inFence && policy !== "announce") {
    out.push(UNCLOSED_CODE_PLACEHOLDER);
  }
  return out.join("\n");
}
function stripHtmlComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const open2 = src.indexOf("<!--", i);
    if (open2 === -1) {
      out += src.slice(i);
      break;
    }
    out += src.slice(i, open2);
    const close = src.indexOf("-->", open2 + 4);
    if (close === -1) {
      out += src.slice(open2 + 4);
      break;
    }
    const newlines = src.slice(open2, close + 3).split("\n").length - 1;
    out += newlines > 0 ? "\n".repeat(newlines) : " ";
    i = close + 3;
  }
  return out;
}
var LINE_ART = /[\u2500-\u259f]/gu;
var ART_SEPARATOR = /[\u2500-\u25ff\u2190-\u21ff]/u;
var ART_LINE_MIN_GLYPHS = 2;
var MAX_SPOKEN_LABELS = 6;
var DIAGRAM_UNLABELLED = " . Here, a diagram is omitted. It has no labels to read. ";
function artGlyphCount(line) {
  return (line.match(LINE_ART) ?? []).length;
}
function wordGlyphCount(line) {
  return (line.match(/[\p{L}\p{N}]/gu) ?? []).length;
}
function isArtLine(line) {
  return artGlyphCount(line) >= ART_LINE_MIN_GLYPHS;
}
function labelFragments(line) {
  const out = [];
  const push = (from, to) => {
    const raw = line.slice(from, to);
    const text = raw.trim().replace(/\s+/g, " ");
    if (text.length === 0) return;
    out.push({
      text,
      start: from + (raw.length - raw.trimStart().length),
      end: to - (raw.length - raw.trimEnd().length)
    });
  };
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    if (ART_SEPARATOR.test(line[i])) {
      push(start, i);
      start = i + 1;
    }
  }
  push(start, line.length);
  return out;
}
function diagramLabels(run) {
  const groups = [];
  let openOnPrev = [];
  for (const line of run) {
    const opened = [];
    for (const f of labelFragments(line)) {
      const joined = openOnPrev.find((g) => f.start < g.end && g.start < f.end);
      if (joined === void 0) {
        const fresh = { parts: [f.text], start: f.start, end: f.end };
        groups.push(fresh);
        opened.push(fresh);
        continue;
      }
      joined.parts.push(f.text);
      if (opened.includes(joined)) {
        joined.start = Math.min(joined.start, f.start);
        joined.end = Math.max(joined.end, f.end);
      } else {
        joined.start = f.start;
        joined.end = f.end;
        opened.push(joined);
      }
    }
    openOnPrev = opened;
  }
  return groups.map((g) => g.parts.join(" "));
}
function diagramPlaceholder(labels) {
  if (labels.length === 0) return DIAGRAM_UNLABELLED;
  const named = labels.slice(0, MAX_SPOKEN_LABELS);
  const more = labels.length - named.length;
  const tail = more > 0 ? `, and ${more} more` : "";
  return ` . Here, a diagram is omitted. It is labelled: ${named.join(", ")}${tail}. `;
}
function diagramsToLabels(src) {
  const lines = src.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!isArtLine(lines[i])) {
      out.push(lines[i]);
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && isArtLine(lines[j])) j++;
    const run = lines.slice(i, j);
    i = j;
    if (run.length === 1) {
      const only = run[0];
      if (artGlyphCount(only) < wordGlyphCount(only)) {
        out.push(only);
        continue;
      }
      if (diagramLabels(run).length === 0) continue;
    }
    out.push(diagramPlaceholder(diagramLabels(run)));
  }
  return out.join("\n");
}
function stripInlineCode(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "`") {
      const close = src.indexOf("`", i + 1);
      if (close === -1) {
        out += src.slice(i + 1);
        break;
      }
      out += src.slice(i + 1, close);
      i = close + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
function expandMarkdownLinks(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "[") {
      const close = src.indexOf("](", i);
      if (close !== -1) {
        const end = src.indexOf(")", close + 2);
        if (end !== -1) {
          const label = src.slice(i + 1, close);
          const url = src.slice(close + 2, end);
          out += label + linkSuffix(label, url);
          i = end + 1;
          continue;
        }
      }
    }
    out += src[i];
    i++;
  }
  return out;
}
function linkSuffix(label, url) {
  const host = (url.replace(/^https?:\/\//, "").split("/")[0] ?? "").replace(/^www\./, "");
  if (host.length === 0 || !host.includes(".")) return "";
  if (label.toLowerCase().includes(host.toLowerCase())) return "";
  return `, ${linkPhrase(url)},`;
}
function linkPhrase(url) {
  const afterScheme = url.replace(/^https?:\/\//, "");
  const host = (afterScheme.split("/")[0] ?? "").replace(/^www\./, "");
  if (host.length === 0) return "a link";
  return `a link to ${host.split(".").join(" dot ")}`;
}
var URL_TERMINATORS = /* @__PURE__ */ new Set([")", "]", '"', "'", "<", ">"]);
var TRAILING_PUNCT = /* @__PURE__ */ new Set([".", ",", "!", "?", ";", ":"]);
function stripUrls(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    if (rest.startsWith("http://") || rest.startsWith("https://")) {
      let j = i;
      while (j < src.length) {
        const c = src[j];
        if (c === " " || c === "\n" || c === "	" || URL_TERMINATORS.has(c)) break;
        j++;
      }
      let end = j;
      while (end > i && TRAILING_PUNCT.has(src[end - 1])) end--;
      out += linkPhrase(src.slice(i, end));
      i = end;
      continue;
    }
    out += src[i];
    i++;
  }
  return out;
}
var TERMINAL = /* @__PURE__ */ new Set([".", "!", "?"]);
function endWithStop(text) {
  const t = text.trimEnd();
  if (t.length === 0) return "";
  return TERMINAL.has(t[t.length - 1]) ? t : `${t}.`;
}
function headingsToPauses(src) {
  return src.split("\n").map((line) => {
    const t = line.trimStart();
    if (!t.startsWith("#")) return line;
    let k = 0;
    while (k < t.length && t[k] === "#") k++;
    if (k > 6 || t[k] !== " ") return line;
    return endWithStop(t.slice(k + 1));
  }).join("\n");
}
var ORDINAL_WORDS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
  "twentieth"
];
function ordinalWord(n) {
  return ORDINAL_WORDS[n - 1] ?? `number ${n}`;
}
function listMarker(t) {
  if (t.startsWith("- ") || t.startsWith("* ") || t.startsWith("+ ")) return { length: 2, ordinal: null };
  let k = 0;
  while (k < t.length && t[k] >= "0" && t[k] <= "9") k++;
  if (k > 0 && t[k] === "." && t[k + 1] === " ") {
    return { length: k + 2, ordinal: Number.parseInt(t.slice(0, k), 10) };
  }
  return { length: 0, ordinal: null };
}
function listItemsToSentences(src, ordered) {
  return src.split("\n").map((line) => {
    const t = line.trimStart();
    const { length, ordinal } = listMarker(t);
    if (length === 0) return line;
    const body = t.slice(length);
    if (ordinal === null || ordered === "drop") return endWithStop(body);
    const lead = ordered === "word" ? ordinalWord(ordinal) : String(ordinal);
    return endWithStop(`${lead}, ${body}`);
  }).join("\n");
}
function isTableSeparator(cells) {
  return cells.every((c) => c.length > 0 && /^[:\-\s]+$/.test(c));
}
function tablesToRows(src) {
  const out = [];
  let headers = null;
  let inTable = false;
  for (const line of src.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|")) {
      headers = null;
      inTable = false;
      out.push(line);
      continue;
    }
    const cells = t.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (isTableSeparator(cells)) continue;
    if (!inTable) {
      inTable = true;
      headers = cells;
      out.push(endWithStop(`Table. ${cells.filter((c) => c.length > 0).join(", ")}`));
      continue;
    }
    const first = cells[0] ?? "";
    const rest = [];
    for (let i = 1; i < cells.length; i++) {
      const value = cells[i] ?? "";
      if (value.length === 0) continue;
      const header = headers?.[i];
      rest.push(header !== void 0 && header.length > 0 ? `${header}, ${value}` : value);
    }
    out.push(endWithStop(rest.length === 0 ? first : `${first}. ${rest.join(". ")}`));
  }
  return out.join("\n");
}
var WORD_BREAK = /* @__PURE__ */ new Set([" ", "\n", "	"]);
function humanise(text) {
  return text.split("_").join(" ").split("-").join(" ");
}
function speakFilePaths(src, style, extStyle) {
  const tokens = [];
  let cur = "";
  for (const ch of src) {
    if (WORD_BREAK.has(ch)) {
      tokens.push(cur, ch);
      cur = "";
    } else cur += ch;
  }
  tokens.push(cur);
  return tokens.map((raw) => {
    if (raw.length === 0 || WORD_BREAK.has(raw)) return raw;
    let tok = raw;
    let trailing = "";
    while (tok.length > 0 && TRAILING_PUNCT.has(tok[tok.length - 1])) {
      trailing = tok[tok.length - 1] + trailing;
      tok = tok.slice(0, -1);
    }
    if (tok.length === 0) return raw;
    if (!tok.includes("/")) return raw;
    const slash = tok.lastIndexOf("/");
    const base = tok.slice(slash + 1);
    const dir = tok.slice(0, slash);
    if (base.length === 0 || dir.length === 0) return raw;
    const dot = base.lastIndexOf(".");
    if (dot <= 0 || dot === base.length - 1) return raw;
    const stem = humanise(base.slice(0, dot));
    const ext = base.slice(dot + 1).toLowerCase();
    if (!/^[a-z0-9]+$/.test(ext)) return raw;
    const kindWord = EXTENSION_WORDS[ext] ?? `dot ${ext}`;
    const folder = `in folder ${humanise(dir.split("/").join(" "))}`;
    const tail = trailing.length > 0 ? trailing : ",";
    if (style === "terse") return `${stem}, ${folder}${tail}`;
    switch (extStyle) {
      case "omit":
        return `file named ${stem}, ${folder}${tail}`;
      case "word-first":
        return `${kindWord} file named ${stem}, ${folder}${tail}`;
      case "raw-last":
        return `file named ${stem}, dot ${ext}, ${folder}${tail}`;
      default:
        return `file named ${stem}, ${kindWord}, ${folder}${tail}`;
    }
  }).join("");
}
function isBoundaryBefore(prev) {
  return prev === void 0 || WORD_BREAK.has(prev) || prev === "(" || prev === '"';
}
function isBoundaryAfter(next) {
  return next === void 0 || WORD_BREAK.has(next) || TRAILING_PUNCT.has(next) || next === ")" || next === '"';
}
function stripMarkdownMarkers(src) {
  let s = src.split("**").join("");
  s = s.split("~~").join("");
  const chars = [...s];
  const drop = /* @__PURE__ */ new Set();
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch !== "*" && ch !== "_") continue;
    if (drop.has(i)) continue;
    if (ch === "_" && (chars[i + 1] === "_" || chars[i - 1] === "_")) continue;
    const opens = isBoundaryBefore(chars[i - 1]) && !isBoundaryAfter(chars[i + 1]);
    if (!opens) continue;
    for (let j = i + 1; j < chars.length; j++) {
      const c = chars[j];
      if (c === "\n") break;
      if (c !== ch) continue;
      if (ch === "_" && (chars[j + 1] === "_" || chars[j - 1] === "_")) continue;
      const closes = !isBoundaryBefore(chars[j - 1]) && isBoundaryAfter(chars[j + 1]);
      if (closes) {
        drop.add(i);
        drop.add(j);
        break;
      }
    }
  }
  return chars.filter((_, i) => !drop.has(i)).join("");
}
function isEmoji(cp) {
  return cp >= 127744 && cp <= 129791 || cp >= 9728 && cp <= 10175 || cp >= 126976 && cp <= 127231 || cp === 8205 || // ZWJ
  cp >= 65024 && cp <= 65039 || // variation selectors
  cp === 8419;
}
function stripEmoji(src) {
  let out = "";
  for (const ch of src) {
    const cp = ch.codePointAt(0);
    if (cp !== void 0 && isEmoji(cp)) continue;
    out += ch;
  }
  return out;
}
var ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen"
];
var TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function under100(n) {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const r = n % 10;
  return r === 0 ? t : `${t} ${ONES[r]}`;
}
function under1000(n) {
  if (n < 100) return under100(n);
  const h = `${ONES[Math.floor(n / 100)]} hundred`;
  const r = n % 100;
  return r === 0 ? h : `${h} ${under100(r)}`;
}
var SCALES = [
  [1e9, "billion"],
  [1e6, "million"],
  [1e3, "thousand"]
];
function numberToWords(n) {
  if (n < 1e3) return under1000(n);
  for (const [size, name] of SCALES) {
    if (n >= size) {
      const head = `${numberToWords(Math.floor(n / size))} ${name}`;
      const rest = n % size;
      return rest === 0 ? head : `${head} ${numberToWords(rest)}`;
    }
  }
  return under1000(n);
}
function spokenTime(h, m) {
  const hh = under100(h);
  if (m === 0) return hh;
  if (m < 10) return `${hh} oh ${ONES[m]}`;
  return `${hh} ${under100(m)}`;
}
function isDigit(c) {
  return c !== void 0 && c >= "0" && c <= "9";
}
var LETTER = new RegExp("\\p{L}", "u");
function isLetter(c) {
  return c !== void 0 && LETTER.test(c);
}
function isMinusSign(src, pos) {
  if (src[pos] !== "-") return false;
  const before = src[pos - 1];
  if (before === void 0) return true;
  return before === " " || before === "\n" || before === "	" || before === "(" || before === "[";
}
function expandNumbers(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (!isDigit(src[i])) {
      out += src[i];
      i++;
      continue;
    }
    if (out.endsWith("-") && isMinusSign(src, i - 1)) {
      out = out.slice(0, -1) + "minus ";
    }
    let j = i;
    while (isDigit(src[j])) j++;
    if (j - i <= 3) {
      let k = j;
      while (src[k] === "," && isDigit(src[k + 1]) && isDigit(src[k + 2]) && isDigit(src[k + 3]) && !isDigit(src[k + 4])) k += 4;
      j = k;
    }
    const raw = src.slice(i, j);
    const digits = raw.split(",").join("");
    if (src[j] === ":" && isDigit(src[j + 1])) {
      let k = j + 1;
      while (isDigit(src[k])) k++;
      const mins = src.slice(j + 1, k);
      const h = Number(digits);
      const m = Number(mins);
      if (mins.length === 2 && h < 24 && m < 60) {
        out += spokenTime(h, m);
        i = k;
        continue;
      }
    }
    if (src[j] === "." && isDigit(src[j + 1])) {
      let k = j + 1;
      while (isDigit(src[k])) k++;
      out += src.slice(i, k);
      i = k;
      continue;
    }
    if (src[i - 1] === "#") {
      out += raw;
      i = j;
      continue;
    }
    if (isLetter(src[i - 1])) {
      out += raw;
      i = j;
      continue;
    }
    if (digits.length > 1 && digits.startsWith("0")) {
      out += [...digits].map((d2) => ONES[Number(d2)]).join(" ");
      i = j;
      continue;
    }
    const value = Number(digits);
    if (value >= 1e9 || digits.length > 12) {
      out += raw;
      i = j;
      continue;
    }
    out += numberToWords(value);
    i = j;
  }
  return out;
}
function expandUnits(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (!isDigit(src[i])) {
      out += src[i];
      i++;
      continue;
    }
    let j = i;
    while (isDigit(src[j]) || src[j] === ".") j++;
    const numeral = src.slice(i, j);
    let k = j;
    if (src[k] === " ") k++;
    let u = k;
    while (u < src.length && /[A-Za-z%°]/.test(src[u])) u++;
    const unitRaw = src.slice(k, u);
    const unit = unitRaw.toLowerCase();
    const boundaryOk = u >= src.length || !/[A-Za-z0-9]/.test(src[u]);
    if (boundaryOk && (unit === "%" || unitRaw === "%")) {
      out += `${numeral} percent`;
      i = u;
      continue;
    }
    const words = UNIT_WORDS[unit];
    if (boundaryOk && words !== void 0) {
      const plural = Number(numeral) === 1 ? words[0] : words[1];
      out += `${numeral} ${plural}`;
      i = u;
      continue;
    }
    out += numeral;
    i = j;
  }
  return out;
}
function speakKeyGlyphs(src) {
  let out = "";
  for (const ch of src) {
    const word = KEY_GLYPHS[ch];
    out += word === void 0 ? ch : `${word} `;
  }
  return out;
}
function tidyPunctuation(src) {
  let out = src.split(" .").join(".");
  for (const lead of [":", ",", ";", ".", "!", "?"]) {
    out = out.split(`${lead}.`).join(lead);
  }
  if (out.startsWith(". ")) out = out.slice(2);
  if (out.startsWith(".")) out = out.slice(1);
  return out.trim();
}
function collapseWhitespace(src) {
  let out = "";
  let pendingSpace = false;
  for (const ch of src) {
    if (ch === " " || ch === "\n" || ch === "	" || ch === "\r") {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) {
      out += " ";
      pendingSpace = false;
    }
    out += ch;
  }
  return out;
}

// packages/core/src/chunker/index.ts
var SPEAKABLE_GLYPH2 = /[\p{L}\p{N}]/u;
function hasSpeakableGlyph2(text) {
  return SPEAKABLE_GLYPH2.test(text);
}
var SENTENCE_END = /* @__PURE__ */ new Set([".", "!", "?"]);
var CLAUSE_END = /* @__PURE__ */ new Set([",", ";", ":", "\u2014", "\u2013"]);
var CLOSERS2 = /* @__PURE__ */ new Set([")", "]", "}", '"', "'", "\u201D", "\u2019"]);
var SPACE2 = /* @__PURE__ */ new Set([" ", "\n", "	", "\r"]);
var ABBREVIATIONS2 = /* @__PURE__ */ new Set([
  "e.g",
  "i.e",
  "etc",
  "vs",
  "cf",
  "al",
  "approx",
  "est",
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "sr",
  "jr",
  "st",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
  "fig",
  "no",
  "vol",
  "pp",
  "ed"
]);
var DEFAULT_MAX_UNITS = 200;
var Chunker = class {
  #maxUnits;
  #countUnits;
  #isolateFirst;
  #buffer = "";
  #emittedAny = false;
  constructor(opts = {}) {
    this.#maxUnits = Math.max(1, opts.maxUnits ?? DEFAULT_MAX_UNITS);
    this.#countUnits = opts.countUnits ?? ((t) => t.length);
    this.#isolateFirst = opts.isolateFirstSentence ?? true;
  }
  /** Feed more text. Returns whatever chunks are now complete. */
  addText(text) {
    this.#buffer += text;
    return this.#drain(false);
  }
  /** End of utterance: flush whatever remains. */
  finish() {
    const out = this.#drain(true);
    if (this.#buffer.length > 0) {
      out.push({ text: this.#buffer, boundary: "end", isFirst: !this.#emittedAny });
      this.#emittedAny = true;
      this.#buffer = "";
    }
    return out;
  }
  /** Discard buffered text without emitting it (barge-in). */
  reset() {
    this.#buffer = "";
    this.#emittedAny = false;
  }
  #drain(final) {
    const out = [];
    for (; ; ) {
      const cut = this.#findCut(final);
      if (cut === null) break;
      const text = this.#buffer.slice(0, cut.index);
      if (text.length === 0) break;
      this.#buffer = this.#buffer.slice(cut.index);
      out.push({ text, boundary: cut.kind, isFirst: !this.#emittedAny });
      this.#emittedAny = true;
    }
    return out;
  }
  /**
   * Scan candidate boundaries in order, remembering the best of each kind that still fits.
   * Stops at the first candidate that overflows: unit cost is monotonic in prefix length, so
   * nothing longer can fit. (buzz notes this scan was originally superlinear and the cost landed
   * BEFORE first audio — a latency bug, not a throughput bug.)
   */
  #findCut(final) {
    const buf = this.#buffer;
    if (buf.length === 0) return null;
    const wantEarliestSentence = this.#isolateFirst && !this.#emittedAny;
    let firstSentence = -1;
    let lastSentence = -1;
    let lastClause = -1;
    let lastWord2 = -1;
    let lastFitting = -1;
    let overflowed = false;
    for (let i = 0; i < buf.length; i++) {
      const end = i + 1;
      if (this.#countUnits(buf.slice(0, end)) > this.#maxUnits) {
        overflowed = true;
        break;
      }
      lastFitting = end;
      const ch = buf[i];
      if (SENTENCE_END.has(ch)) {
        const after = this.#skipClosers(i + 1);
        if (this.#isSentenceEnd(i, after)) {
          const cut = this.#absorbSpaces(after);
          if (cut <= buf.length && this.#countUnits(buf.slice(0, cut)) <= this.#maxUnits && this.#carriesSpeech(cut)) {
            if (firstSentence === -1) firstSentence = cut;
            lastSentence = cut;
            if (wantEarliestSentence && this.#complete(cut, final)) break;
          }
        }
      } else if (CLAUSE_END.has(ch)) {
        const cut = this.#absorbSpaces(i + 1);
        if (this.#countUnits(buf.slice(0, cut)) <= this.#maxUnits && this.#carriesSpeech(cut)) {
          lastClause = cut;
        }
      } else if (SPACE2.has(ch)) {
        const cut = this.#absorbSpaces(i);
        if (cut > 0 && this.#countUnits(buf.slice(0, cut)) <= this.#maxUnits && this.#carriesSpeech(cut)) {
          lastWord2 = cut;
        }
      }
    }
    if (!final) {
      if (wantEarliestSentence && firstSentence !== -1 && this.#complete(firstSentence, final)) {
        return { index: firstSentence, kind: "sentence" };
      }
      if (!overflowed) return null;
    } else {
      const sentence = wantEarliestSentence ? firstSentence : lastSentence;
      if (sentence !== -1) return { index: sentence, kind: "sentence" };
      if (!overflowed) return null;
    }
    if (lastSentence > 0) return { index: lastSentence, kind: "sentence" };
    if (lastClause > 0) return { index: lastClause, kind: "clause" };
    if (lastWord2 > 0) return { index: lastWord2, kind: "word" };
    if (lastFitting > 0) return { index: lastFitting, kind: "scalar" };
    return { index: 1, kind: "scalar" };
  }
  /**
   * A boundary is only safe to emit mid-stream once we can see a non-space character after it,
   * or the stream has ended. Otherwise a later fragment could extend the token (`e.g` -> `e.g.`)
   * and streaming would disagree with batch.
   */
  #complete(cut, final) {
    if (final) return true;
    return cut < this.#buffer.length;
  }
  /**
   * SC-2 (006 section 22, finding R8-08). May the prefix `buf[0..cut)` be emitted as a chunk of
   * its own, or would it be an utterance with nothing in it to say?
   *
   * `#isSentenceEnd` returns true unconditionally for '!' and '?' — "'!' and '?' are never
   * abbreviations", which is true as written and wrong as a SENTENCE rule: '.' gets six context
   * tests and '!' got none. So `#!/usr/bin/env node` yielded a first chunk of `"#!"` and
   * `![alt](url)` yielded `"!"`. Each costs a full synthesis round trip and returns near-silence
   * (p50 747 ms of provider time for 97 ms of noise, `017` R8-09), and each lands on chunk 0 — the
   * one chunk `isolateFirstSentence` exists to make fast.
   *
   * Stated as a property of the CHUNK rather than of the punctuation mark, because that is the
   * form the downstream provider actually needs: it does not care which glyph ended the sentence,
   * it cares whether there is a word in the utterance. A boundary that would mint a speechless
   * chunk is simply not a boundary, so the fragment travels with the text that follows it —
   * `"#!/usr/bin/env node Run it."` becomes one chunk instead of two, and the invariant
   * `chunks.join('') === input` is untouched (it is a refusal to cut, never a rewrite).
   *
   * Safe for streaming: this reads a PREFIX of the buffer, and a prefix never changes as more text
   * arrives — so streaming still agrees with batch (SC-5, T035).
   *
   * NOT applied to the `scalar` fallback below. That path fires only when a single token overruns
   * `maxUnits` with no boundary anywhere, and it exists to guarantee forward progress; refusing it
   * would hang the chunker on a long enough run of punctuation. A 200-character wall of '!' is
   * still speech-free and still reaches the provider — recorded here as the residue rather than
   * fixed, because the provider's own empty-output guard is the right place for it and
   * `OsSynthEmptyOutputError` (006 site 43) already names that outcome.
   */
  #carriesSpeech(cut) {
    return hasSpeakableGlyph2(this.#buffer.slice(0, cut));
  }
  #skipClosers(from) {
    let i = from;
    while (i < this.#buffer.length && CLOSERS2.has(this.#buffer[i])) i++;
    return i;
  }
  #absorbSpaces(from) {
    let i = from;
    while (i < this.#buffer.length && SPACE2.has(this.#buffer[i])) i++;
    return i;
  }
  /** Is the '.' at `dot` a real sentence end, given the next non-closer is at `after`? */
  #isSentenceEnd(dot, after) {
    const buf = this.#buffer;
    if (buf[dot] !== ".") return true;
    if (isDigit2(buf[after])) return false;
    let start = dot;
    while (start > 0 && !SPACE2.has(buf[start - 1])) start--;
    const token = buf.slice(start, dot).toLowerCase();
    if (ABBREVIATIONS2.has(token)) return false;
    if (token.includes(".")) return false;
    if (token.length > 0 && [...token].every((c) => c >= "0" && c <= "9")) return false;
    if (token.length === 1 && token !== token.toUpperCase()) return false;
    return true;
  }
};
function isDigit2(c) {
  return c !== void 0 && c >= "0" && c <= "9";
}

// packages/core/src/queue/index.ts
var PlaybackQueue = class {
  #generation = 0;
  #pending = [];
  #draining = false;
  #deps;
  constructor(deps) {
    this.#deps = deps;
  }
  get generation() {
    return this.#generation;
  }
  get depth() {
    return this.#pending.length;
  }
  /** Begin a new utterance. Returns its generation tag. */
  begin() {
    this.#generation++;
    return this.#generation;
  }
  /** Enqueue audio for `gen`. Chunks from a superseded generation are dropped. */
  push(gen, chunk) {
    if (gen !== this.#generation) return false;
    this.#pending.push({ gen, chunk });
    void this.#drain();
    return true;
  }
  /** Two-sided cancel: stop synthesis, stop playback, drop the queue. */
  async bargeIn() {
    this.#generation++;
    this.#pending = [];
    await this.#deps.cancelSynthesis();
    await this.#deps.sink.stop();
  }
  async #drain() {
    if (this.#draining) return;
    this.#draining = true;
    try {
      for (; ; ) {
        const next = this.#pending.shift();
        if (next === void 0) break;
        if (next.gen !== this.#generation) continue;
        await this.#deps.sink.enqueue(next.chunk);
      }
    } finally {
      this.#draining = false;
    }
  }
};

// packages/core/src/settings/schema.ts
var SCHEMA_VERSION = 2;
var MIRROR_ENVELOPE_KEYS = {
  revision: "__revision",
  schemaVersion: "__schemaVersion",
  writtenAt: "__writtenAt"
};
var d = (x) => x;
var SETTINGS_SCHEMA = {
  // ─────────────────────────────────────────────────────────────────────────────────────────
  // normalize — NormalizeOptions. 23 fields, 5 wired. Read at speech-service.ts's normalize().
  // ─────────────────────────────────────────────────────────────────────────────────────────
  "normalize.codeBlocks": d({
    id: "normalize.codeBlocks",
    owner: "normalize",
    panel: "A",
    label: "How a code block is handled",
    help: "Whether an omitted code block is announced or dropped in silence.",
    kind: "enum",
    values: ["announce", "drop"],
    default: "announce",
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: "NormalizeOptions.codeBlocks",
    since: 2
  }),
  "normalize.codeBlockDetail": d({
    id: "normalize.codeBlockDetail",
    owner: "normalize",
    panel: "A",
    label: "What a code block tells you",
    help: "Whether the language and the line count are named in the announcement.",
    kind: "multi",
    values: ["language", "lineCount"],
    default: [],
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "normalize.inlineCode": d({
    id: "normalize.inlineCode",
    owner: "normalize",
    panel: "A",
    label: "How inline code is said",
    help: "Backticked code inside a sentence: stripped to its text, read verbatim, or announced.",
    kind: "enum",
    values: ["strip", "verbatim", "announce"],
    default: "strip",
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "normalize.urls": d({
    id: "normalize.urls",
    owner: "normalize",
    panel: "A",
    label: "How a link is said",
    help: "What you hear where a URL was. A link that vanishes with no signal is the loss this control exists for.",
    kind: "enum",
    values: ["host-phrase", "host-and-path", "label-only", "drop-silent"],
    default: "host-phrase",
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "normalize.emoji": d({
    id: "normalize.emoji",
    owner: "normalize",
    panel: "A",
    label: "How an emoji is handled",
    help: "Emoji vanish with no signal today, while code blocks and links get one. Same loss, opposite treatment.",
    kind: "enum",
    values: ["silent", "announce-count", "name"],
    default: "silent",
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "normalize.headingCue": d({
    id: "normalize.headingCue",
    owner: "normalize",
    panel: "B",
    label: "How a heading is marked",
    help: "All six heading levels collapse to nothing today.",
    kind: "enum",
    values: ["none", "level-word", "prefix-word", "pause-only"],
    default: "none",
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "normalize.headingPauseMs": d({
    id: "normalize.headingPauseMs",
    owner: "normalize",
    panel: "B",
    label: "How long a heading pauses",
    help: 'Milliseconds, never "comma versus full stop" \u2014 a number survives the arrival of SSML; a punctuation mark does not.',
    kind: "int",
    range: { min: 0, max: 1500, step: 50 },
    unit: "ms",
    default: 0,
    provisional: true,
    // 011 section 3.2 "unassigned": blocked behind the single provider-seam change C-05, so a
    // change here cannot land mid-session even once a consumer exists.
    effect: "session",
    enginePersonal: true,
    wire: null,
    since: 2
  }),
  "normalize.orderedLists": d({
    id: "normalize.orderedLists",
    owner: "normalize",
    panel: "B",
    label: "How a numbered list is said",
    help: "A numbered item can keep its numeral, become an ordinal word, or lose its number.",
    kind: "enum",
    values: ["numeral", "word", "drop"],
    default: "numeral",
    provisional: false,
    rationale: 'Settled, not taste: dropping the ordinal (v1 behaviour) makes a numbered procedure indistinguishable from a bullet list. 002 spec row 10, "shipped, not provisional".',
    effect: "utterance",
    enginePersonal: false,
    wire: "NormalizeOptions.orderedLists",
    since: 2
  }),
  "normalize.bulletMarker": d({
    id: "normalize.bulletMarker",
    owner: "normalize",
    panel: "B",
    label: "How a bullet is said",
    help: 'Whether a bullet marker is dropped or spoken as "item".',
    kind: "enum",
    values: ["drop", "say-item"],
    default: "drop",
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "normalize.tableHeaderRepeat": d({
    id: "normalize.tableHeaderRepeat",
    owner: "normalize",
    panel: "B",
    label: "How often a table header repeats",
    help: 'Table rows were "too quick, not obvious what I am hearing" until every value carried its header.',
    kind: "enum",
    values: ["every-cell", "row-start", "first-row-only", "never"],
    default: "every-cell",
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "normalize.tableFirstCellHeader": d({
    id: "normalize.tableFirstCellHeader",
    owner: "normalize",
    panel: "B",
    label: "Whether the first cell is a header",
    help: "Treat the leading cell of each row as that row's name rather than a bare value.",
    kind: "bool",
    default: false,
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "normalize.pathStyle": d({
    id: "normalize.pathStyle",
    owner: "normalize",
    panel: "C",
    label: "How a path is said",
    help: 'Paths "made no sense whatsoever" read raw. This is the shape of the repair.',
    kind: "enum",
    values: ["spoken", "terse", "verbatim"],
    default: "spoken",
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: "NormalizeOptions.pathStyle",
    since: 2
  }),
  "normalize.extensionStyle": d({
    id: "normalize.extensionStyle",
    owner: "normalize",
    panel: "C",
    label: "Where the file kind goes",
    help: 'The file kind was "garbled noise" in front of the name, and wanted to come last.',
    kind: "enum",
    values: ["word-last", "word-first", "raw-last", "omit"],
    default: "word-last",
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: "NormalizeOptions.extensionStyle",
    since: 2
  }),
  "normalize.pathDepthPolicy": d({
    id: "normalize.pathDepthPolicy",
    owner: "normalize",
    panel: "C",
    label: "How much of the folder",
    help: "Four folders of flat word list, and by the third you have lost the first. This is Q41's option space; which one is the default is yours.",
    kind: "enum",
    values: ["full", "last-n", "first-n", "filename-only", "filename-then-location", "elide-middle"],
    default: "full",
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "normalize.pathDepthN": d({
    id: "normalize.pathDepthN",
    owner: "normalize",
    panel: "C",
    label: "How many folders",
    help: "How many folders the policy above keeps.",
    kind: "int",
    range: { min: 1, max: 8, step: 1 },
    unit: "folders",
    default: 2,
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "normalize.extensionWords": d({
    id: "normalize.extensionWords",
    owner: "normalize",
    panel: "C",
    label: "What each file kind is called",
    help: "The suffix-to-word table. An unknown suffix is spelled out.",
    kind: "map",
    default: {},
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "normalize.identStyle": d({
    id: "normalize.identStyle",
    owner: "normalize",
    panel: "C",
    label: "How an identifier is said",
    help: "Underscore flush underscore buffer is spoken raw today. This is Q39's option space; the default is yours.",
    kind: "enum",
    values: ["verbatim", "underscore-pause", "split-words", "split-and-announce", "spell-leading-underscore"],
    default: "verbatim",
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "normalize.identParens": d({
    id: "normalize.identParens",
    owner: "normalize",
    panel: "C",
    label: "How a call's brackets are said",
    help: "What happens to the parentheses after a function name.",
    kind: "enum",
    values: ["keep", "drop", "say-call"],
    default: "keep",
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "normalize.expandIntegers": d({
    id: "normalize.expandIntegers",
    owner: "normalize",
    panel: "D",
    label: "Whether numbers become words",
    help: 'Whether a numeral becomes words. Units are a separate switch \u2014 turning this off leaves "52 milliseconds".',
    kind: "bool",
    default: true,
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    // FR-017 used to read: "this and `normalize.expandUnits` are two controls over ONE field
    // today. This id owns the wire; the other is `wire: null`." That WAS the SC-8 defect (006
    // NM12): this control declares stage 14 and also governed stage 13. J26 split the normalizer
    // flag, so each id now owns its own wire and its own stage.
    wire: "NormalizeOptions.expandNumbers",
    since: 2
  }),
  "normalize.expandUnits": d({
    id: "normalize.expandUnits",
    owner: "normalize",
    panel: "D",
    label: "Whether units become words",
    help: '"52 ms was odd to hear" \u2014 units are expanded before the number.',
    kind: "bool",
    default: true,
    // Wired by J26 closing SC-8. Before that this was `wire: null` and the field was governed by
    // `normalize.expandIntegers` — a control claiming a stage it did not own.
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: "NormalizeOptions.expandUnits",
    since: 2
  }),
  "normalize.unitWords": d({
    id: "normalize.unitWords",
    owner: "normalize",
    panel: "D",
    label: "What each unit is called",
    help: "The symbol-to-word table for units.",
    kind: "map",
    default: {},
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "normalize.decimals": d({
    id: "normalize.decimals",
    owner: "normalize",
    panel: "D",
    label: "How a decimal is said",
    help: "Hand three point one four to the engine, or say it in words.",
    kind: "enum",
    values: ["engine", "words"],
    default: "engine",
    provisional: true,
    effect: "utterance",
    enginePersonal: true,
    wire: null,
    since: 2
  }),
  "normalize.sentencePauseMs": d({
    id: "normalize.sentencePauseMs",
    owner: "normalize",
    panel: "E",
    label: "How long a sentence pauses",
    help: "Milliseconds between sentences. In milliseconds so the number survives when SSML lands.",
    kind: "int",
    range: { min: 0, max: 800, step: 25 },
    unit: "ms",
    default: 0,
    provisional: true,
    effect: "session",
    enginePersonal: true,
    wire: null,
    since: 2
  }),
  // ─────────────────────────────────────────────────────────────────────────────────────────
  // chunk — ChunkerOptions. 2 fields, both wired. `countUnits` is a FUNCTION and not settable.
  // ─────────────────────────────────────────────────────────────────────────────────────────
  "chunk.maxUnits": d({
    id: "chunk.maxUnits",
    owner: "chunk",
    panel: "E",
    label: "How long a chunk",
    help: "How much text is synthesized at once. Judged today against a floor that changes.",
    kind: "int",
    range: { min: 40, max: 600, step: 20 },
    unit: "characters",
    default: 200,
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: "ChunkerOptions.maxUnits",
    since: 2
  }),
  "chunk.isolateFirstSentence": d({
    id: "chunk.isolateFirstSentence",
    owner: "chunk",
    panel: "E",
    label: "Whether the first sentence goes alone",
    help: "Send sentence one on its own so the first audio arrives sooner.",
    kind: "bool",
    default: true,
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: "ChunkerOptions.isolateFirstSentence",
    since: 2
  }),
  // ─────────────────────────────────────────────────────────────────────────────────────────
  // synthesize — 7 fields, 3 wired. Two of those land on SynthesizeOptions (voice, rate);
  // `synthesize.engine` selects WHICH provider `registry.resolve()` tries first, so its wire
  // is `ProviderRegistry.resolve`, not a generate() option. `signal` is runtime, not settable.
  // Read ONCE PER UTTERANCE, never per chunk (011 section 2.3): a voice change between chunk
  // three and chunk four is a sentence that changes speaker mid-word. Same cadence for engine:
  // swapping the backend mid-utterance is the same failure wearing a different costume.
  // ─────────────────────────────────────────────────────────────────────────────────────────
  "synthesize.engine": d({
    id: "synthesize.engine",
    owner: "synthesize",
    panel: "E",
    label: "Which engine",
    help: "Auto uses Pocket TTS when the neural model is installed, otherwise the system voice. OS always uses the system voice. Pocket asks for the neural voice and names the substitution out loud when it cannot.",
    kind: "enum",
    values: ["auto", "os", "pocket"],
    default: "auto",
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    // Not SynthesizeOptions: this value chooses the provider, it is not handed to generate().
    // P28's voiceIndex stays an index into the SELECTED backend's list; do not qualify it.
    wire: "ProviderRegistry.resolve",
    since: 2
  }),
  "synthesize.voiceIndex": d({
    id: "synthesize.voiceIndex",
    owner: "synthesize",
    panel: "E",
    label: "Which voice",
    help: "Filled in from the machine's own voice list. Never free text: an unknown name exits zero and silently substitutes the default.",
    kind: "voice",
    default: null,
    provisional: true,
    effect: "utterance",
    enginePersonal: true,
    // P28: an INDEX into the host's runtime voice list is persisted, never a name — the three
    // platforms' voice namespaces have zero overlap. The consumer's property is still
    // `SynthesizeOptions.voice: string`, so resolving index -> name is the loader's job (T121).
    wire: "SynthesizeOptions.voice",
    since: 2
  }),
  "synthesize.rate": d({
    id: "synthesize.rate",
    owner: "synthesize",
    panel: "E",
    label: "How fast",
    help: "Speaking rate, as a multiple of the voice's own.",
    kind: "float",
    range: { min: 0.5, max: 2, step: 0.05 },
    unit: "times",
    default: 1,
    provisional: true,
    effect: "utterance",
    enginePersonal: true,
    wire: "SynthesizeOptions.rate",
    since: 2
  }),
  "synthesize.pitch": d({
    id: "synthesize.pitch",
    owner: "synthesize",
    panel: "E",
    label: "How high",
    help: "No field exists yet \u2014 this control renders and the schema carries it, so the gap stays countable.",
    kind: "int",
    range: { min: -50, max: 50, step: 5 },
    unit: "steps",
    default: 0,
    provisional: true,
    effect: "utterance",
    enginePersonal: true,
    wire: null,
    since: 2
  }),
  "synthesize.volume": d({
    id: "synthesize.volume",
    owner: "synthesize",
    panel: "E",
    label: "How loud",
    help: "No field exists yet \u2014 designed, not wired.",
    kind: "int",
    range: { min: 0, max: 100, step: 5 },
    unit: "percent",
    default: 100,
    provisional: true,
    effect: "utterance",
    enginePersonal: true,
    wire: null,
    since: 2
  }),
  "synthesize.pauseBackend": d({
    id: "synthesize.pauseBackend",
    owner: "synthesize",
    panel: "E",
    label: "How a pause is written",
    help: "Punctuation is the only one implemented; the others are here so the cost of SSML can be heard before it is paid.",
    kind: "enum",
    values: ["punctuation", "ssml", "in-band"],
    default: "punctuation",
    provisional: true,
    effect: "session",
    enginePersonal: true,
    wire: null,
    since: 2
  }),
  "synthesize.interruptGranularity": d({
    id: "synthesize.interruptGranularity",
    owner: "synthesize",
    panel: "F",
    label: "How a stop lands",
    help: "Cut now, finish the word first, or pause and keep the position.",
    kind: "enum",
    values: ["immediate", "at-word", "pause-keeps-position"],
    default: "immediate",
    provisional: true,
    effect: "session",
    enginePersonal: true,
    wire: null,
    since: 2
  }),
  // ─────────────────────────────────────────────────────────────────────────────────────────
  // queue — SpeechService's queue. 011 section 3.2a: `queue.maxQueued` IS OWNED HERE and its
  // number exists in this file and nowhere else.
  // ─────────────────────────────────────────────────────────────────────────────────────────
  "queue.maxQueued": d({
    id: "queue.maxQueued",
    owner: "queue",
    panel: "F",
    label: "How many replies wait",
    help: "Twenty queued replies is roughly three minutes of unrequested speech. Eight is what you have been living with.",
    kind: "int",
    range: { min: 1, max: 20, step: 1 },
    unit: "replies",
    default: 8,
    provisional: false,
    rationale: "What the listener has been living with; twenty queued replies is ~3 minutes of unrequested speech (009 section 2, C3). Settled, not taste.",
    effect: "immediate",
    enginePersonal: false,
    // `wire: null` TODAY, and this disagrees with 011 section 3.2a's descriptor, which writes
    // `wire: 'SpeechServiceDeps.maxQueued'`. The settings value does not reach the consumer yet:
    // `main.ts` still passes a literal 8. 011 section 3.2's own count ("9 wired = 5 normalize +
    // 2 chunk + 2 synthesize"), 002 spec FR-012 and row 36 (class D), and the lab inventory all
    // say null. T122 is the task that makes it non-null; claiming the wire before then would be
    // exactly the P26 defect this field is documented against. See the report.
    wire: null,
    since: 2
  }),
  "queue.overflowPolicy": d({
    id: "queue.overflowPolicy",
    owner: "queue",
    panel: "F",
    label: "Which reply is dropped when full",
    help: "Dropping the oldest silently was the third fault behind the session that hijacked your audio.",
    kind: "enum",
    values: ["drop-oldest", "drop-newest"],
    default: "drop-oldest",
    provisional: true,
    effect: "immediate",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "queue.announceMode": d({
    id: "queue.announceMode",
    owner: "queue",
    panel: "F",
    label: "Whether an announcement interrupts",
    help: "Replace cuts off a reply in progress; queue waits for it.",
    kind: "enum",
    values: ["replace", "queue"],
    default: "replace",
    provisional: true,
    effect: "immediate",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  // ─────────────────────────────────────────────────────────────────────────────────────────
  // announce — the WORDING. 9 fields, none wired.
  // ─────────────────────────────────────────────────────────────────────────────────────────
  "announce.codeBlockPhrase": d({
    id: "announce.codeBlockPhrase",
    owner: "announce",
    panel: "A",
    label: "What a code block is called",
    help: "The sentence spoken in place of a code block. {lang} and {lines} are filled in.",
    kind: "template",
    default: " . Here, a code block is omitted. ",
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "announce.urlPhrase": d({
    id: "announce.urlPhrase",
    owner: "announce",
    panel: "A",
    label: "What a link is called",
    help: "The phrase spoken for a link. {host} and {path} are filled in.",
    kind: "template",
    default: "a link to {host}",
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "announce.tableLeadIn": d({
    id: "announce.tableLeadIn",
    owner: "announce",
    panel: "B",
    label: "What a table is called",
    help: "The lead-in sentence spoken before a table.",
    kind: "template",
    default: "Table.",
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "announce.pathNamePhrase": d({
    id: "announce.pathNamePhrase",
    owner: "announce",
    panel: "C",
    label: "What a file is called",
    help: "The phrase that introduces a file name. {name} is filled in.",
    kind: "template",
    default: "file named {name}",
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "announce.pathFolderPhrase": d({
    id: "announce.pathFolderPhrase",
    owner: "announce",
    panel: "C",
    label: "What a folder is called",
    help: "The phrase that introduces the folders. {folders} is filled in.",
    kind: "template",
    default: "in folder {folders}",
    provisional: true,
    effect: "utterance",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "announce.sessionLabel": d({
    id: "announce.sessionLabel",
    owner: "announce",
    panel: "F",
    label: "How a session is named",
    help: "Hex is not on this list, and that is deliberate: two designs call eight hex characters a non-answer to who is speaking.",
    kind: "enum",
    values: ["call-sign", "call-sign-plus-name", "registry-name", "branch", "displayName"],
    default: "call-sign",
    provisional: true,
    effect: "immediate",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "announce.switchPhrase": d({
    id: "announce.switchPhrase",
    owner: "announce",
    panel: "F",
    label: "What a session switch says",
    help: "Spoken when the audio moves to another session. {label} is filled in.",
    kind: "template",
    default: "Now reading from {label}.",
    provisional: true,
    effect: "immediate",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "announce.statusTemplate": d({
    id: "announce.statusTemplate",
    owner: "announce",
    panel: "F",
    label: "What status says",
    help: "The wording and order of the spoken status report.",
    kind: "template",
    default: "{state}. {queued} waiting. Following {label}.",
    provisional: true,
    effect: "immediate",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "announce.reportChannel": d({
    id: "announce.reportChannel",
    owner: "announce",
    panel: "F",
    label: "How settings problems are reported",
    help: "Whether a settings problem is spoken as soon as it is found, spoken only when you are already using audio, or kept for when you ask.",
    kind: "enum",
    values: ["always-spoken", "when-audio-in-use", "on-request-only"],
    default: "when-audio-in-use",
    // TASTE. 011 Q68 — nobody has heard all three. `when-audio-in-use` is in the code as the
    // REVERSIBLE MIDDLE, not as an answer: a failure must reach a channel the listener has (P30)
    // and an unrequested interruption is itself a harm (P22/P30), and only a listener can settle
    // which of those wins on a machine we have not met.
    provisional: true,
    effect: "session",
    enginePersonal: false,
    wire: "SettingsReport.channel",
    since: 2
  }),
  // ─────────────────────────────────────────────────────────────────────────────────────────
  // session · input · apply · lab
  // ─────────────────────────────────────────────────────────────────────────────────────────
  "session.huddleReplyCap": d({
    id: "session.huddleReplyCap",
    owner: "session",
    panel: "F",
    label: "How much of a reply is read",
    help: "No cap exists at all today, and the reply queue counts replies, so one forty-thousand-character reply is thirty-three minutes and nothing can drop it.",
    kind: "int",
    range: { min: 2e3, max: 5e4, step: 1e3 },
    unit: "characters",
    default: 8e3,
    // B-05: the EXISTENCE of a cap is correctness; the NUMBER is taste.
    provisional: true,
    effect: "immediate",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "input.clipboardCap": d({
    id: "input.clipboardCap",
    owner: "input",
    panel: "F",
    label: "How much clipboard is read",
    help: "Above this, the clipboard read is truncated and the truncation is announced.",
    kind: "int",
    range: { min: 2e3, max: 5e4, step: 1e3 },
    unit: "characters",
    default: 2e4,
    provisional: true,
    effect: "immediate",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "apply.toQueued": d({
    id: "apply.toQueued",
    owner: "apply",
    panel: "F",
    label: "Whether a change reaches replies already waiting",
    help: "A settings change never interrupts what is playing. This decides whether it also reaches the replies already queued behind it.",
    kind: "bool",
    default: false,
    // TASTE. 011 Q62 — genuinely undecidable from a desk. A listener who has just heard a path
    // mangled wants the fix to reach the four queued replies; a listener mid-way through a long
    // answer wants consistency. `false` because it is the conservative, reversible one.
    provisional: true,
    effect: "immediate",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  "lab.simulateChunkGapMs": d({
    id: "lab.simulateChunkGapMs",
    owner: "lab",
    panel: "E",
    label: "The gap between chunks",
    help: "The lab has no gap; the shipped plugin has about nine hundred and fifty milliseconds of one. Hear either world.",
    kind: "int",
    range: { min: 0, max: 1500, step: 50 },
    unit: "ms",
    default: 0,
    provisional: true,
    // 'lab-only': THE PLUGIN MUST NEVER READ THIS, and `schema.test.ts` asserts owner and effect
    // agree so a lab-only field cannot quietly acquire a plugin consumer.
    effect: "lab-only",
    enginePersonal: false,
    wire: null,
    since: 2
  }),
  // ─────────────────────────────────────────────────────────────────────────────────────────
  // RESERVED — `since: 3`, 011 section 4.2a. These are ids a LATER milestone registered against a
  // schema this build has not bumped to. They are counted in the `future` bucket, rendered by the
  // lab as disabled rows, written into the starter file as commented-out lines, and excluded from
  // the reachability assertion (they have no consumer yet, by definition). The mechanism exists so
  // that M16 and M17 ADD AN ID rather than invent a constant in their own prose (P26).
  // ─────────────────────────────────────────────────────────────────────────────────────────
  "session.followMax": d({
    id: "session.followMax",
    owner: "session",
    panel: "F",
    label: "How many sessions are followed",
    help: "How many agent sessions the audio follows at once, or all of them.",
    kind: "enum",
    values: [1, 2, 3, 4, 5, 6, 7, "all"],
    default: 1,
    provisional: true,
    effect: "immediate",
    enginePersonal: false,
    wire: null,
    since: 3
  }),
  "session.registryPollMs": d({
    id: "session.registryPollMs",
    owner: "session",
    panel: "F",
    label: "How often the session registry is re-read",
    help: "Milliseconds between re-reads of the session registry.",
    kind: "int",
    range: { min: 1e3, max: 6e4, step: 500 },
    unit: "ms",
    default: 1e3,
    provisional: true,
    effect: "session",
    enginePersonal: false,
    wire: null,
    since: 3
  }),
  "session.unregisteredWindowMs": d({
    id: "session.unregisteredWindowMs",
    owner: "session",
    panel: "F",
    label: "How long an unregistered session stays interesting",
    help: "How long a session that never registered is still treated as live.",
    kind: "int",
    range: { min: 6e4, max: 36e5, step: 6e4 },
    unit: "ms",
    default: 6e5,
    provisional: true,
    effect: "session",
    enginePersonal: false,
    wire: null,
    since: 3
  }),
  "session.showUnregistered": d({
    id: "session.showUnregistered",
    owner: "session",
    panel: "F",
    label: "Whether unregistered sessions are offered",
    help: "Whether sessions that never registered appear in the follow list at all.",
    kind: "bool",
    default: false,
    provisional: true,
    effect: "immediate",
    enginePersonal: false,
    wire: null,
    since: 3
  }),
  "queue.perSessionFairness": d({
    id: "queue.perSessionFairness",
    owner: "queue",
    panel: "F",
    label: "Share the queue between followed sessions",
    help: "When more than one session is followed, cap each one at its share of the queue instead of letting the fastest agent fill it.",
    kind: "bool",
    default: false,
    // TASTE. Fairness trades "the agent you are listening to keeps its place" against "the fastest
    // agent cannot monopolise the queue", and which is correct is learned by hearing a two-agent
    // fan-out (P23). Ships off because off is today's behaviour and therefore the reversible one.
    // The per-session cap is DERIVED FROM `queue.maxQueued`, never replacing it — one id, one
    // meaning (011 section 4.2). The arithmetic belongs to 012.
    provisional: true,
    effect: "immediate",
    enginePersonal: false,
    wire: null,
    since: 3
  }),
  "input.talkWindowMs": d({
    id: "input.talkWindowMs",
    owner: "input",
    panel: "F",
    label: "How long the talk window stays open",
    help: "How long the plugin keeps listening after the talk gesture.",
    kind: "int",
    range: { min: 1e3, max: 12e4, step: 1e3 },
    unit: "ms",
    default: 15e3,
    provisional: true,
    effect: "immediate",
    enginePersonal: false,
    wire: null,
    since: 3
  }),
  "input.talkGesture": d({
    id: "input.talkGesture",
    owner: "input",
    panel: "F",
    label: "What opens the talk window",
    help: "Which gesture opens the talk window.",
    kind: "enum",
    values: ["hold", "toggle", "double-tap"],
    default: "hold",
    provisional: true,
    effect: "session",
    enginePersonal: false,
    wire: null,
    since: 3
  }),
  "input.resumePolicy": d({
    id: "input.resumePolicy",
    owner: "input",
    panel: "F",
    label: "What happens to speech when the talk window closes",
    help: "Whether speech resumes where it stopped, starts the reply again, or stays stopped.",
    kind: "enum",
    values: ["resume", "restart", "stay-stopped"],
    default: "resume",
    provisional: true,
    effect: "immediate",
    enginePersonal: false,
    wire: null,
    since: 3
  }),
  "input.recognizerCommand": d({
    id: "input.recognizerCommand",
    owner: "input",
    panel: "F",
    label: "Which recognizer command is run",
    help: "The command that turns your speech into text. A path on this machine.",
    kind: "string",
    default: "",
    // A command path does not transfer between machines — 011 section 4.2a, same shape as P28.
    provisional: true,
    effect: "session",
    enginePersonal: true,
    wire: null,
    since: 3
  }),
  "input.talkWindowIdleMs": d({
    id: "input.talkWindowIdleMs",
    owner: "input",
    panel: "F",
    label: "How long the talk window waits when nothing is followed",
    help: "The window's clock when there is no session to close it on evidence.",
    kind: "int",
    range: { min: 1e3, max: 12e4, step: 1e3 },
    unit: "ms",
    default: 15e3,
    provisional: true,
    effect: "immediate",
    enginePersonal: false,
    wire: null,
    since: 3
  }),
  "input.paneFallbackWatch": d({
    id: "input.paneFallbackWatch",
    owner: "input",
    panel: "F",
    label: "Whether an empty follow set watches the pane's own transcript",
    help: "With nothing followed, may the talk window read the control pane's own working-directory transcript, read-only, for the window's duration.",
    kind: "bool",
    default: false,
    provisional: true,
    effect: "immediate",
    enginePersonal: false,
    wire: null,
    since: 3
  })
};
function isFuture(f) {
  return f.since > SCHEMA_VERSION;
}
function isWired(f) {
  return f.wire !== null && !isFuture(f);
}
var OPTION_SURFACE_TYPES = [
  "NormalizeOptions",
  "ChunkerOptions",
  "SynthesizeOptions"
];
function isOptionWired(f) {
  return isWired(f) && OPTION_SURFACE_TYPES.includes(f.wire.split(".")[0]);
}
function schemaDefaults() {
  const out = {};
  for (const f of Object.values(SETTINGS_SCHEMA)) {
    if (isFuture(f)) continue;
    out[f.id] = Array.isArray(f.default) ? [...f.default] : f.default;
  }
  return out;
}
function wireProperty(f) {
  return f.wire === null ? null : f.wire.split(".")[1] ?? null;
}
function project(s, owner) {
  const out = {};
  for (const f of Object.values(SETTINGS_SCHEMA)) {
    if (f.owner !== owner || !isOptionWired(f)) continue;
    const prop = wireProperty(f);
    if (prop === null) continue;
    const v = s[f.id];
    if (v === void 0 || v === null) continue;
    out[prop] = v;
  }
  return out;
}
function toNormalizeOptions(s) {
  return project(s, "normalize");
}
function toChunkerOptions(s) {
  return project(s, "chunk");
}
function toSynthesizeOptions(s, resolveVoice) {
  const out = project(s, "synthesize");
  const idx = out["voice"];
  if (typeof idx === "number") {
    const name = resolveVoice?.(idx);
    if (typeof name === "string" && name.length > 0) out["voice"] = name;
    else delete out["voice"];
  }
  return out;
}
function requestedEngineId(engine, pocketRegistered) {
  if (engine === "os") return "os-synth";
  if (engine === "pocket") return "pocket";
  return pocketRegistered ? "pocket" : void 0;
}

// packages/core/src/settings/jsonc.ts
function stripJsonComments(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      out += c;
      i++;
      while (i < n) {
        const ch = text[i];
        out += ch;
        i++;
        if (ch === "\\") {
          if (i < n) {
            out += text[i];
            i++;
          }
          continue;
        }
        if (ch === '"') break;
      }
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        out += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
function stripTrailingCommas(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      out += c;
      i++;
      while (i < n) {
        const ch = text[i];
        out += ch;
        i++;
        if (ch === "\\") {
          if (i < n) {
            out += text[i];
            i++;
          }
          ;
          continue;
        }
        if (ch === '"') break;
      }
      continue;
    }
    if (c === ",") {
      let j = i + 1;
      while (j < n && /\s/.test(text[j])) j++;
      if (j < n && (text[j] === "}" || text[j] === "]")) {
        out += " ";
        i++;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}
function parseJsonc(text) {
  const stripped = stripTrailingCommas(stripJsonComments(text));
  try {
    return { value: JSON.parse(stripped) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const at = /position (\d+)/.exec(message);
    let line = null;
    if (at) {
      const pos = Math.min(Number(at[1]), stripped.length);
      line = stripped.slice(0, pos).split("\n").length;
    }
    return { value: void 0, error: { message, line } };
  }
}

// packages/core/src/settings/parse.ts
var SETTINGS_KIND = "orca-tts-settings";
function validate(f, v) {
  switch (f.kind) {
    case "bool":
      return typeof v === "boolean" ? { ok: true, value: v } : { ok: false, reason: `expected true or false, got ${describe(v)}` };
    case "enum": {
      const values = f.values ?? [];
      return values.includes(v) ? { ok: true, value: v } : { ok: false, reason: `expected one of ${values.map((x) => JSON.stringify(x)).join(", ")}, got ${describe(v)}` };
    }
    case "multi": {
      const values = f.values ?? [];
      if (!Array.isArray(v)) return { ok: false, reason: `expected a list, got ${describe(v)}` };
      const bad = v.find((x) => !values.includes(x));
      if (bad !== void 0) return { ok: false, reason: `${JSON.stringify(bad)} is not one of ${values.map((x) => JSON.stringify(x)).join(", ")}` };
      return { ok: true, value: [...v] };
    }
    case "int":
    case "float": {
      if (typeof v !== "number" || !Number.isFinite(v)) return { ok: false, reason: `expected a number, got ${describe(v)}` };
      if (f.kind === "int" && !Number.isInteger(v)) return { ok: false, reason: `expected a whole number, got ${v}` };
      const r = f.range;
      if (r && (v < r.min || v > r.max)) return { ok: false, reason: `expected ${r.min} to ${r.max}, got ${v}` };
      return { ok: true, value: v };
    }
    case "string":
    case "template":
      return typeof v === "string" ? { ok: true, value: v } : { ok: false, reason: `expected text, got ${describe(v)}` };
    case "map": {
      if (v === null || typeof v !== "object" || Array.isArray(v)) return { ok: false, reason: `expected a table, got ${describe(v)}` };
      for (const [k, val] of Object.entries(v)) {
        if (typeof val !== "string") return { ok: false, reason: `the entry for "${k}" is ${describe(val)}, not text` };
      }
      return { ok: true, value: { ...v } };
    }
    case "voice":
      if (v === null) return { ok: true, value: null };
      if (typeof v === "number" && Number.isInteger(v) && v >= 0) return { ok: true, value: v };
      return { ok: false, reason: `expected a voice index (a whole number) or null, got ${describe(v)}` };
  }
}
function describe(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "a list";
  switch (typeof v) {
    case "undefined":
      return "nothing";
    case "string":
      return JSON.stringify(v);
    case "object":
      return "a table";
    default:
      return String(v);
  }
}
var MIGRATIONS = {
  1: (values, rejected) => {
    const out = { ...values };
    if ("synthesize.voice" in out) {
      const name = out["synthesize.voice"];
      delete out["synthesize.voice"];
      out["synthesize.voiceIndex"] = null;
      rejected.push({
        field: "synthesize.voiceIndex",
        reason: `your old settings named a voice (${describe(name)}); voice names do not carry between machines, so the system default is in use until you pick one again`,
        usedDefault: null
      });
    }
    return out;
  }
};
function parseSettingsText(text, opts = {}) {
  const r = parseJsonc(text);
  if (r.error) return parse(void 0, { ...opts, fileError: r.error });
  return parse(r.value, opts);
}
function parse(input, opts = {}) {
  const rejected = [];
  const unknownFields = [];
  const defaults = schemaDefaults();
  const mirror = opts.mirror ?? null;
  let fileVersion = SCHEMA_VERSION;
  let revision = 0;
  let writtenAt;
  let writtenBy;
  let raw = {};
  let fileError = opts.fileError;
  let migratedFrom;
  if (fileError === void 0 && input !== void 0 && input !== null) {
    if (typeof input !== "object" || Array.isArray(input)) {
      fileError = { message: "the settings file is not a JSON object", line: null };
    } else {
      const env = input;
      if (typeof env["kind"] === "string" && env["kind"] !== SETTINGS_KIND) {
        fileError = { message: `this is not a settings file \u2014 its kind is ${describe(env["kind"])}`, line: null };
      } else {
        const sv = env["schemaVersion"];
        if (typeof sv === "number" && Number.isInteger(sv) && sv >= 1) fileVersion = sv;
        else if (sv !== void 0) {
          rejected.push({ field: "schemaVersion", reason: `expected a whole number, got ${describe(sv)}`, usedDefault: SCHEMA_VERSION });
        }
        const rev = env["revision"];
        if (typeof rev === "number" && Number.isInteger(rev) && rev >= 0) revision = rev;
        else if (rev !== void 0) {
          rejected.push({ field: "revision", reason: `expected a whole number, got ${describe(rev)}`, usedDefault: 0 });
        }
        if (typeof env["writtenAt"] === "string") writtenAt = env["writtenAt"];
        if (typeof env["writtenBy"] === "string") writtenBy = env["writtenBy"];
        const s = env["settings"];
        if (s !== void 0 && (typeof s !== "object" || s === null || Array.isArray(s))) {
          fileError = { message: 'the "settings" block is not a JSON object', line: null };
        } else if (s) {
          raw = { ...s };
        }
      }
    }
  }
  if (fileError === void 0 && fileVersion < SCHEMA_VERSION) {
    migratedFrom = fileVersion;
    for (let v = fileVersion; v < SCHEMA_VERSION; v++) {
      const step = MIGRATIONS[v];
      if (step) raw = step(raw, rejected);
    }
  }
  if (fileError !== void 0) raw = {};
  const out = {};
  for (const f of Object.values(SETTINGS_SCHEMA)) {
    if (isFuture(f)) continue;
    const fallback = resolveFallback(f, mirror, defaults);
    if (!(f.id in raw)) {
      out[f.id] = fallback.value;
      continue;
    }
    const v = validate(f, raw[f.id]);
    if (v.ok) {
      out[f.id] = v.value;
      continue;
    }
    out[f.id] = fallback.value;
    rejected.push({ field: f.id, reason: `${v.reason} \u2014 using ${fallback.from}`, usedDefault: fallback.value });
  }
  for (const id of Object.keys(raw)) {
    const f = SETTINGS_SCHEMA[id];
    if (f === void 0 || isFuture(f)) unknownFields.push(id);
  }
  return {
    settings: out,
    revision,
    rejected,
    unknownFields,
    ...migratedFrom !== void 0 ? { migratedFrom } : {},
    ...fileError !== void 0 ? { fileError } : {},
    ...writtenAt !== void 0 ? { writtenAt } : {},
    ...writtenBy !== void 0 ? { writtenBy } : {}
  };
}
function resolveFallback(f, mirror, defaults) {
  if (mirror && f.id in mirror.values) {
    const m = validate(f, mirror.values[f.id]);
    if (m.ok) return { value: m.value, from: "the last settings I had" };
  }
  const dv = defaults[f.id];
  return { value: Array.isArray(dv) ? [...dv] : dv, from: "the built-in default" };
}
function toMirror(settings, revision, writtenAt) {
  const out = {};
  for (const [id, v] of Object.entries(settings)) out[id] = v;
  out[MIRROR_ENVELOPE_KEYS.revision] = revision;
  out[MIRROR_ENVELOPE_KEYS.schemaVersion] = SCHEMA_VERSION;
  if (writtenAt !== void 0) out[MIRROR_ENVELOPE_KEYS.writtenAt] = writtenAt;
  return out;
}
function fromMirror(kv) {
  if (!kv) return null;
  const rev = kv[MIRROR_ENVELOPE_KEYS.revision];
  if (typeof rev !== "number" || !Number.isInteger(rev)) return null;
  const sv = kv[MIRROR_ENVELOPE_KEYS.schemaVersion];
  const values = {};
  for (const [k, v] of Object.entries(kv)) {
    if (k.startsWith("__")) continue;
    values[k] = v;
  }
  return { values, revision: rev, schemaVersion: typeof sv === "number" ? sv : SCHEMA_VERSION };
}
function promote(current, next) {
  if (current !== null && next.revision <= current.revision) {
    return {
      promoted: false,
      code: "stale_revision",
      reason: `revision ${next.revision} is not newer than the ${current.revision} already loaded`
    };
  }
  return { promoted: true, snapshot: next };
}
function reportDestination(channel, evidence) {
  switch (channel) {
    case "always-spoken":
      return "speak-now";
    case "on-request-only":
      return "on-request-only";
    default:
      return evidence.huddleOn || evidence.speakRequestThisSession ? "speak-now" : "hold-for-first-utterance";
  }
}
function settingsReportSentence(r) {
  const parts = [];
  if (r.fileError) {
    const where = r.fileError.line === null ? "" : ` on or near line ${r.fileError.line}`;
    parts.push(`Your settings file could not be read${where}. I am using the last good settings.`);
  }
  if (r.rejected.length > 0) {
    const names = r.rejected.map((x) => SETTINGS_SCHEMA[x.field]?.label ?? x.field);
    const shown = names.slice(0, 2);
    const rest = names.length - shown.length;
    const list = rest > 0 ? `${shown.join(", ")}, and ${rest} ${rest === 1 ? "other" : "others"}` : shown.join(" and ");
    const n = r.rejected.length;
    parts.push(`${n === 1 ? "One setting" : `${n} settings`} could not be read and ${n === 1 ? "is" : "are"} using ${n === 1 ? "its" : "their"} defaults: ${list}.`);
  }
  if (r.unknownFields.length > 0) {
    const n = r.unknownFields.length;
    parts.push(`${n === 1 ? "One setting" : `${n} settings`} in your file ${n === 1 ? "is" : "are"} newer than this version and ${n === 1 ? "was" : "were"} ignored.`);
  }
  if (r.migratedFrom !== void 0) {
    parts.push(`Your settings file is from an older version and was read forward. It has not been changed.`);
  }
  if (parts.length === 0) return null;
  parts.push("Say status to hear the rest.");
  return parts.join(" ");
}

// packages/plugin/src/adapter/index.ts
function makeHost(orca, hooks = {}) {
  let registered = 0;
  let logFailures = 0;
  const log = (m) => {
    try {
      orca.log(m);
    } catch {
      logFailures++;
    }
  };
  return {
    log,
    logFailures: () => logFailures,
    registeredCommands: () => registered,
    notify(title, body, opts = {}) {
      const safeTitle = title.trim() !== "" ? title : (body ?? "").trim() !== "" ? body : "Read aloud";
      const params = { title: safeTitle.slice(0, 120) };
      if (body !== void 0) params["body"] = body.slice(0, 1e3);
      const message = body ?? title;
      const undelivered = (why) => {
        log(`notification not delivered (${why}): ${message}`);
        if (opts.alreadySpoken !== true) hooks.onUndelivered?.(message);
      };
      void Promise.resolve(orca.host.call("notifications.show", params)).then((r) => {
        if (r?.delivered === false) undelivered("reported undelivered");
      }).catch((err) => {
        undelivered(String(err));
      });
    },
    async storageGet(key) {
      try {
        const r = await orca.host.call("storage.get", { key });
        return r?.value;
      } catch (err) {
        hooks.onStorageFailure?.({ op: "get", key, reason: String(err) });
        return void 0;
      }
    },
    async storageSet(key, value) {
      try {
        await orca.host.call("storage.set", { key, value });
      } catch (err) {
        hooks.onStorageFailure?.({ op: "set", key, reason: String(err) });
      }
    },
    async settingsGet() {
      try {
        const r = await orca.host.call("settings.get");
        if (r === null || typeof r !== "object") return null;
        const env = r;
        const inner = env["settings"] ?? env["value"];
        const out = inner !== void 0 && inner !== null && typeof inner === "object" ? inner : env;
        return out;
      } catch (err) {
        hooks.onSettingsFailure?.({ op: "get", reason: String(err) });
        return null;
      }
    },
    /** Returns whether the write was OBSERVED to land, not whether the call returned. */
    async settingsSet(values) {
      try {
        for (const [key, value] of Object.entries(values)) {
          const r = await orca.host.call("settings.set", { key, value });
          const ok = r?.ok;
          if (ok === false) {
            const why = r.error;
            hooks.onSettingsFailure?.({ op: "set", reason: `${key}: ${String(why ?? "refused")}` });
            return false;
          }
        }
      } catch (err) {
        hooks.onSettingsFailure?.({ op: "set", reason: String(err) });
        return false;
      }
      try {
        const back = await orca.host.call("settings.get");
        const env = back ?? {};
        const inner = env["settings"] ?? env["value"];
        const rec = inner !== void 0 && inner !== null && typeof inner === "object" ? inner : env;
        const key = "__revision";
        if (rec[key] !== values[key]) {
          hooks.onSettingsFailure?.({
            op: "verify",
            reason: `wrote ${key}=${String(values[key])} and read back ${String(rec[key])} \u2014 the mirror did not take the write`
          });
          return false;
        }
      } catch (err) {
        hooks.onSettingsFailure?.({ op: "verify", reason: String(err) });
        return false;
      }
      return true;
    },
    onEvent(name, handler) {
      try {
        orca.events.on(name, handler);
      } catch (err) {
        log(`could not subscribe to ${name}: ${String(err)}`);
        hooks.onUndelivered?.(`Huddle could not subscribe to ${name}, so agent replies will not be spoken.`);
      }
    },
    registerCommand(id, handler) {
      try {
        orca.commands.register(id, async () => {
          try {
            await handler();
            return { ok: true };
          } catch (err) {
            log(`command ${id} failed: ${String(err)}`);
            hooks.onCommandFailed?.(id, String(err));
            return { ok: false, error: String(err) };
          }
        });
        registered++;
      } catch (err) {
        log(`could not register command ${id}: ${String(err)}`);
      }
    }
  };
}
function asAgentStatus(payload) {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload;
  if (typeof p["paneKey"] !== "string" || typeof p["state"] !== "string") return null;
  const out = {
    worktreeId: typeof p["worktreeId"] === "string" ? p["worktreeId"] : null,
    paneKey: p["paneKey"],
    state: p["state"],
    receivedAt: typeof p["receivedAt"] === "number" ? p["receivedAt"] : 0
  };
  return typeof p["sessionId"] === "string" ? { ...out, sessionId: p["sessionId"] } : out;
}
function worktreePathFrom(worktreeId) {
  if (worktreeId === null) return null;
  const sep2 = worktreeId.indexOf("::");
  const path = sep2 === -1 ? worktreeId : worktreeId.slice(sep2 + 2);
  return path.length > 0 ? path : null;
}

// packages/plugin/src/clipboard.ts
import { spawn as spawn2 } from "node:child_process";
var ClipboardUnavailableError = class extends Error {
  /** Per-helper reason, in ladder order. */
  reasons;
  constructor(platform, tried, reasons = []) {
    super(reasons.length > 0 ? `Could not read the clipboard on ${platform}. ${reasons.join("; ")}.` : `Could not read the clipboard on ${platform}. Tried: ${tried.join(", ")}`);
    this.name = "ClipboardUnavailableError";
    this.reasons = reasons;
  }
};
var CANDIDATES = {
  darwin: [{ cmd: "pbpaste", args: [] }],
  win32: [{ cmd: "powershell", args: ["-NoProfile", "-NonInteractive", "-STA", "-Command", "Get-Clipboard -Raw"] }],
  linux: [
    { cmd: "wl-paste", args: ["--no-newline"] },
    { cmd: "xclip", args: ["-selection", "clipboard", "-o"] },
    { cmd: "xsel", args: ["--clipboard", "--output"] }
  ]
};
function capture(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn2(cmd, [...args], { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      reject(new Error(`${cmd} could not be started`));
      return;
    }
    let out = "";
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    const settle = (fn) => {
      clearTimeout(timer);
      fn();
    };
    child.stdout?.on("data", (d2) => {
      out += d2.toString("utf8");
    });
    child.on("error", (err) => settle(() => reject(new Error(
      err.code === "ENOENT" ? `${cmd} is not installed` : `${cmd} could not be started`
    ))));
    child.on("close", (code) => settle(() => code === 0 ? resolve(out) : reject(new Error(`${cmd} exited with code ${String(code)}`))));
  });
}
function capText(raw, maxChars) {
  if (raw.length <= maxChars) return { text: raw, truncated: false };
  return { text: raw.slice(0, maxChars), truncated: true };
}
var DEFAULT_MAX_CHARS = 2e4;
var DEFAULT_CLIPBOARD_TIMEOUT_MS = 2e4;
async function readClipboard(opts = {}) {
  const platform = opts.platform ?? process.platform;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CLIPBOARD_TIMEOUT_MS;
  const candidates = opts.helpers ?? CANDIDATES[platform] ?? [];
  const tried = [];
  const reasons = [];
  for (const c of candidates) {
    tried.push(c.cmd);
    try {
      return capText(await capture(c.cmd, c.args, timeoutMs), maxChars);
    } catch (err) {
      reasons.push(err instanceof Error ? err.message : String(err));
      continue;
    }
  }
  if (candidates.length === 0) {
    reasons.push(`no clipboard helper is known for ${platform}`);
  }
  throw new ClipboardUnavailableError(platform, tried, reasons);
}

// packages/plugin/src/speech-service.ts
var DEFAULT_MAX_QUEUED = 20;
var DEFAULT_ANNOUNCE_DELAY_MS = 500;
var LOSS_SENTENCE = {
  // 006 site 31, "the most reachable total-silence path in the product": a reply that is only code,
  // only a diagram, only emoji, only a check mark normalizes to nothing and produced a log line.
  // For a listener, that is indistinguishable from the agent not having answered.
  unspeakable: (n) => n === 1 ? "One reply had nothing in it that could be read aloud." : `${n} replies had nothing in them that could be read aloud.`,
  // 006 site 33: the listener hears sentence one, the rest of the reply is gone, and the NEXT
  // queued reply starts — so the loss is disguised as the conversation moving on.
  "synthesis-failed": (n) => n === 1 ? "A reply was cut short: the voice engine failed part way through it." : `${n} replies were cut short: the voice engine failed part way through them.`,
  // 006 site 53: the chunker computes `boundary: 'scalar'` to mark a mid-word cut and the speech
  // service read only `.text`. Rare by construction — it needs 200 characters with no sentence,
  // clause or word boundary in them — which is exactly why it is worth naming when it happens.
  "cut-mid-word": (n) => n === 1 ? "One very long unbroken run of text was cut mid-word to be read." : `${n} very long unbroken runs of text were cut mid-word to be read.`
};
var SpeechService = class {
  #deps;
  #provider;
  #playback;
  #pending = [];
  #draining = false;
  #cancelled = false;
  #skip = false;
  #current = null;
  #droppedPendingAnnounce = 0;
  #dropTimer = null;
  #losses = /* @__PURE__ */ new Map();
  #lossTimer = null;
  #reportingFailure = false;
  /** Sessions whose provenance change has already been spoken. Bounded by `stop()`. */
  #reattributed = /* @__PURE__ */ new Set();
  constructor(deps) {
    this.#deps = deps;
    this.#provider = deps.provider;
    this.#playback = new PlaybackQueue({
      sink: deps.sink,
      cancelSynthesis: () => this.#provider.cancel()
    });
  }
  get isSpeaking() {
    return this.#draining || this.#pending.length > 0 || this.#deps.sink.isPlaying;
  }
  get queued() {
    return this.#pending.length;
  }
  /** What is being read right now, if the caller labelled it. */
  get nowReading() {
    return this.#current?.sessionLabel ?? null;
  }
  /** A fresh value object: consumers never receive the service's mutable queue. */
  status() {
    return {
      generation: this.#playback.generation,
      nowReading: this.#current,
      queueDepth: this.#pending.length,
      queue: this.#pending.map((entry) => ({
        sessionId: entry.sessionId ?? null,
        sessionLabel: entry.label ?? (entry.announcement === true ? "Read Aloud" : "Unlabelled speech"),
        textPreview: entry.text.trim().replace(/\s+/g, " ").slice(0, 120)
      }))
    };
  }
  /** Abandon the current utterance and move to the next queued one. */
  async skip() {
    this.#skip = true;
    await this.#playback.bargeIn();
  }
  /**
   * Say something ABOUT the speech system, in the speech system. The listener cannot read a log
   * and does not watch the notification tray, so this is the only channel a loss or a degradation
   * can honestly be reported through (buzz's rule, recorded in our own research and never adopted:
   * every omission is announced in the audio stream itself).
   *
   * Never clears the queue. See AnnounceUrgency for what each urgency costs.
   */
  announce(text, urgency = "next") {
    if (text.trim().length === 0) return;
    if (urgency === "now") {
      this.#skip = true;
      this.#observe(this.#playback.bargeIn(), "stop the current sentence");
    }
    const entry = { text, announcement: true };
    const snap = this.#deps.settings?.();
    if (snap !== void 0) entry.snapshot = snap;
    let at = 0;
    while (this.#pending[at]?.announcement === true) at++;
    this.#pending.splice(at, 0, entry);
    this.#cancelled = false;
    this.#emitStatus();
    this.#observe(this.#drain(), "read that text");
  }
  /**
   * Synthesize a fresh phrase end to end and report what actually happened, aloud.
   *
   * The listener-facing half of 006 section 19 rank 1. Every other diagnostic in this system
   * ("engine ready", "N commands registered", `isPlaying`) reports healthy on a mute plugin; this
   * one cannot, because it reports numbers that came from this invocation.
   *
   * Deliberately `'now'`: the listener asked for it this second, and a self-test that queued behind
   * a backlog would answer a question they had already given up on.
   */
  async selfTest(phrase = "Read aloud self test. One two three.") {
    const before = this.#deps.sink.bytesPlayed;
    let chunks = 0;
    let bytes = 0;
    let error = null;
    try {
      const snapshot = this.#deps.settings?.();
      await this.#applyEngine(snapshot);
      const spokenText = normalize(phrase, this.#normalizeOptions(snapshot));
      const chunker = new Chunker(this.#chunkerOptions(snapshot));
      for (const chunk of [...chunker.addText(spokenText), ...chunker.finish()]) {
        for await (const audio of this.#provider.generate(chunk.text, this.#synthesizeOptions(snapshot))) {
          chunks++;
          bytes += audio.data.length;
          await this.#deps.sink.enqueue(audio);
        }
      }
    } catch (err) {
      error = String(err);
    }
    const after = this.#deps.sink.bytesPlayed;
    const bytesPlayed = typeof before === "number" && typeof after === "number" ? after - before : null;
    const spoken = error !== null ? `Self test failed. The voice engine reported: ${error}.` : bytes === 0 ? "Self test failed. The voice engine produced no audio at all." : bytesPlayed === 0 ? `Self test: the engine produced ${bytes} bytes, but nothing reached the audio device.` : `Self test passed. ${chunks} chunk${chunks === 1 ? "" : "s"}, ${bytes} bytes of fresh audio.`;
    this.announce(spoken, "now");
    return { chunks, bytes, bytesPlayed, error, spoken };
  }
  /** Speak `text`. See SpeakMode. Returns immediately; use `isSpeaking` to observe. */
  speak(text, mode = "replace", label, sessionId) {
    if (mode === "replace") {
      const discarded = this.#pending.filter((p) => p.announcement !== true).length;
      this.#pending = this.#pending.filter((p) => p.announcement === true);
      this.#observe(this.#playback.bargeIn(), "stop the current sentence");
      if (discarded > 0) this.#noteDropped(discarded);
    }
    const entry = { text };
    if (label !== void 0) entry.label = label;
    if (sessionId !== void 0) entry.sessionId = sessionId;
    const snap = this.#deps.settings?.();
    if (snap !== void 0) entry.snapshot = snap;
    this.#pending.push(entry);
    const max = this.#deps.maxQueued ?? DEFAULT_MAX_QUEUED;
    const replies = this.#pending.filter((p) => p.announcement !== true);
    if (replies.length > max) {
      const dropped = replies.length - max;
      const keep = new Set(replies.slice(-max));
      this.#pending = this.#pending.filter((p) => p.announcement === true || keep.has(p));
      this.#deps.log?.(`speech queue full, dropped ${dropped} older utterance(s)`);
      this.#noteDropped(dropped);
    }
    this.#cancelled = false;
    this.#emitStatus();
    void this.#drain();
  }
  /**
   * Record a loss and speak it, coalesced, in the audio stream.
   *
   * Urgency is always `'next'`, deliberately. Every one of these describes something that has
   * ALREADY happened — a reply that could not be read, an engine that died mid-sentence, a run cut
   * mid-word. Interrupting the sentence the listener is currently following to tell them about a
   * sentence they already lost is a second loss, not a fix for the first (P30).
   */
  /**
   * Sites 29 and 30: two `void somePromise()` calls with no handler. `#drain` in particular can
   * reject from `normalize()` or the `Chunker` (NM11), and an unhandled rejection is, to this
   * listener, indistinguishable from the agent never having answered.
   *
   * Reported through `announce`, not through `log`: the log is not a channel they have. Guarded
   * against recursion — if announcing the failure fails too, it stops there rather than looping.
   */
  #observe(p, what) {
    void p.catch((err) => {
      this.#deps.log?.(`could not ${what}: ${String(err)}`);
      if (this.#reportingFailure) return;
      this.#reportingFailure = true;
      try {
        this.announce(`Speech failed: could not ${what}.`, "next");
      } finally {
        this.#reportingFailure = false;
      }
    });
  }
  #noteLoss(kind, count = 1) {
    this.#losses.set(kind, (this.#losses.get(kind) ?? 0) + count);
    if (this.#lossTimer !== null) return;
    this.#lossTimer = setTimeout(() => {
      this.#lossTimer = null;
      const entries = [...this.#losses.entries()];
      this.#losses.clear();
      for (const [k, n] of entries) if (n > 0) this.announce(LOSS_SENTENCE[k](n), "next");
    }, this.#deps.announceDelayMs ?? DEFAULT_ANNOUNCE_DELAY_MS);
    this.#lossTimer.unref?.();
  }
  /**
   * Coalesce a burst of drops into one spoken sentence naming the TOTAL.
   *
   * The count accumulates. The previous implementation restarted a timer holding only the latest
   * `n`, so a burst that dropped 1 + 1 + 1 announced "skipped 1" — under-reporting the loss in the
   * one message whose entire job is to size it.
   */
  #noteDropped(count) {
    this.#deps.onDropped?.(count);
    this.#droppedPendingAnnounce += count;
    if (this.#dropTimer !== null) clearTimeout(this.#dropTimer);
    this.#dropTimer = setTimeout(() => {
      const n = this.#droppedPendingAnnounce;
      this.#droppedPendingAnnounce = 0;
      this.#dropTimer = null;
      if (n > 0) this.announce(`Skipped ${n} older repl${n === 1 ? "y" : "ies"} to keep up.`, "next");
    }, this.#deps.announceDelayMs ?? DEFAULT_ANNOUNCE_DELAY_MS);
    if (typeof this.#dropTimer === "object" && this.#dropTimer !== null) {
      this.#dropTimer.unref?.();
    }
  }
  /**
   * Two-sided stop: cancels synthesis, flushes audio, and clears anything waiting (R022).
   *
   * Deliberately does NOT announce what it discarded. Stop is the listener's own explicit command
   * for silence; a control that answers "stop" with more speech is the helplessness P22 recorded,
   * not a fix for it. Every OTHER path that clears the queue does announce.
   */
  async stop() {
    this.#cancelled = true;
    this.#pending = [];
    this.#current = null;
    if (this.#dropTimer !== null) {
      clearTimeout(this.#dropTimer);
      this.#dropTimer = null;
    }
    if (this.#lossTimer !== null) {
      clearTimeout(this.#lossTimer);
      this.#lossTimer = null;
    }
    this.#losses.clear();
    this.#reattributed.clear();
    this.#droppedPendingAnnounce = 0;
    this.#emitStatus();
    await this.#playback.bargeIn();
  }
  async #drain() {
    if (this.#draining) return;
    this.#draining = true;
    try {
      for (; ; ) {
        const next = this.#pending.shift();
        if (next === void 0) break;
        const attribution = next.announcement === true ? null : this.#reattribute(next);
        this.#skip = false;
        const outcome = await this.#speakOne(
          attribution === null ? next.text : attribution.prefix + next.text,
          next.snapshot,
          {
            sourceText: next.text,
            sessionId: next.sessionId ?? null,
            sessionLabel: attribution?.label ?? next.label ?? (next.announcement === true ? "Read Aloud" : "Unlabelled speech")
          }
        );
        this.#current = null;
        this.#emitStatus();
        if (next.announcement !== true) {
          if (outcome === "empty") this.#noteLoss("unspeakable");
          else if (outcome === "synthesis-failed") this.#noteLoss("synthesis-failed");
        }
        if (this.#cancelled) break;
      }
    } finally {
      this.#draining = false;
      this.#current = null;
      this.#emitStatus();
    }
  }
  /**
   * Ask, at the moment of speaking, whose words these actually are — and say so when the answer
   * has changed since they were queued.
   *
   * 006 section 19 rank 3 / cascade C1. The queue carried a display string with no way to check
   * it. Now it carries a session id, and this re-resolves it against the live system.
   *
   * **The judgement, stated, because it departs from the FMA's own prescription.** C1 says
   * *"refuse to speak an entry whose identity generation is stale."* Refusing deletes an agent
   * reply the listener was waiting for, to prevent a label being wrong — which today, with one
   * voice for every session, is the smaller of the two harms by a wide margin. So we CORRECT the
   * attribution instead: the reply is spoken, preceded by the session it really came from. The
   * refusal becomes the right answer the moment M15 makes the VOICE carry identity, and at that
   * point it is one conditional on this same, now-existing, field. The instrument is what was
   * missing; the policy is cheap once the instrument exists.
   *
   * Spoken ONCE per session per change, not once per reply: five queued replies from a session
   * that has ended get one provenance sentence, not five. Narrating provenance on every utterance
   * is the harm on the other side of this one.
   */
  #reattribute(entry) {
    const id = entry.sessionId;
    const was = entry.label;
    if (id === void 0 || was === void 0 || this.#deps.resolveLabel === void 0) return null;
    const now = this.#deps.resolveLabel(id);
    if (now === was) {
      this.#reattributed.delete(id);
      return null;
    }
    if (this.#reattributed.has(id)) return { label: now ?? was, prefix: "" };
    this.#reattributed.add(id);
    this.#deps.log?.(`attribution changed for ${id}: queued as "${was}", now ${now ?? "gone"}`);
    return now === null ? { label: was, prefix: `From ${was}, which has since ended. ` } : { label: now, prefix: `From ${now}. ` };
  }
  /**
   * Voice and rate are the two settings every user asks for first, and until this existed no
   * caller could reach them: `generate(chunk.text)` was called with no options at all, while
   * `SynthesizeOptions.voice`/`.rate` and the provider's implementations of both sat unused (H24).
   * Built fresh per utterance and omitting undefined fields, so "nothing passed" stays byte-for-
   * byte the request the provider received before.
   */
  #synthesizeOptions(snapshot) {
    if (snapshot !== void 0) {
      return toSynthesizeOptions(snapshot.values, this.#deps.resolveVoice);
    }
    const opts = {};
    if (this.#deps.voice !== void 0) opts.voice = this.#deps.voice;
    if (this.#deps.rate !== void 0) opts.rate = this.#deps.rate;
    return opts;
  }
  /** Normalizer options for one utterance: the item's own snapshot, else the constructor's. */
  #normalizeOptions(snapshot) {
    return snapshot === void 0 ? this.#deps.normalizeOptions ?? {} : toNormalizeOptions(snapshot.values);
  }
  /** Chunker options for one utterance, same rule. */
  #chunkerOptions(snapshot) {
    if (snapshot !== void 0) return toChunkerOptions(snapshot.values);
    const opts = {};
    if (this.#deps.maxUnits !== void 0) opts.maxUnits = this.#deps.maxUnits;
    if (this.#deps.isolateFirstSentence !== void 0) {
      opts.isolateFirstSentence = this.#deps.isolateFirstSentence;
    }
    return opts;
  }
  /**
   * Returns WHY it stopped, rather than a bare `return`. Site 32: cancelled, skipped and superseded
   * all arrived at one indistinguishable early return, so the caller could not tell a loss the
   * listener should hear about from a control the listener just pressed.
   */
  async #speakOne(text, snapshot, identity) {
    const spoken = normalize(text, this.#normalizeOptions(snapshot));
    if (spoken.length === 0) {
      this.#deps.log?.("nothing speakable in that text");
      return "empty";
    }
    const chunker = new Chunker(this.#chunkerOptions(snapshot));
    const chunks = [...chunker.addText(spoken), ...chunker.finish()];
    if (chunks.some((c) => c.boundary === "scalar")) this.#noteLoss("cut-mid-word");
    await this.#applyEngine(snapshot);
    const generation = this.#playback.begin();
    const startedAtEpochMs = Date.now();
    this.#current = {
      sessionId: identity.sessionId,
      sessionLabel: identity.sessionLabel,
      gen: generation,
      sourceText: identity.sourceText,
      spokenText: spoken,
      sourceMap: null,
      cursor: null,
      chunkIndex: chunks.length === 0 ? 0 : 1,
      chunkCount: chunks.length,
      startedAtEpochMs,
      estimatedMs: null
    };
    this.#emitStatus();
    const synthOpts = this.#synthesizeOptions(snapshot);
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      if (this.#current !== null && this.#current.chunkIndex !== index + 1) {
        this.#current = { ...this.#current, chunkIndex: index + 1 };
        this.#emitStatus();
      }
      if (this.#cancelled) return "cancelled";
      if (this.#skip) return "skipped";
      if (generation !== this.#playback.generation) return "superseded";
      try {
        for await (const audio of this.#provider.generate(chunk.text, synthOpts)) {
          if (!this.#playback.push(generation, audio)) return "superseded";
        }
      } catch (err) {
        this.#deps.log?.(`synthesis failed: ${String(err)}`);
        return "synthesis-failed";
      }
    }
    return "spoken";
  }
  /**
   * Apply `synthesize.engine` once per utterance. The registry does the ladder walk;
   * we only read the setting and hand the id across.
   */
  async #applyEngine(snapshot) {
    if (this.#deps.selectEngine === void 0) return;
    const engine = snapshot?.values["synthesize.engine"] ?? "auto";
    try {
      const selected = await this.#deps.selectEngine(engine);
      if (selected !== null) this.#provider = selected;
    } catch (err) {
      this.#deps.log?.(`engine selection failed: ${String(err)}`);
    }
  }
  /** Status reporting is supplementary; a dashboard failure must never stop speech. */
  #emitStatus() {
    try {
      this.#deps.onStatus?.(this.status());
    } catch (err) {
      this.#deps.log?.(`could not publish dashboard status: ${String(err)}`);
    }
  }
};

// packages/plugin/src/sinks/subprocess-sink.ts
import { spawn as spawn3 } from "node:child_process";
import { mkdtemp as mkdtemp2, writeFile as writeFile4, rm as rm4 } from "node:fs/promises";
import { tmpdir as tmpdir2 } from "node:os";
import { join as join7 } from "node:path";
var PLAYERS = {
  darwin: [{ cmd: "afplay", args: (f) => [f] }],
  win32: [{
    cmd: "powershell",
    args: (f) => [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$p = New-Object System.Media.SoundPlayer '${f.replace(/'/g, "''")}'; $p.PlaySync()`
    ]
  }],
  linux: [
    { cmd: "paplay", args: (f) => [f] },
    { cmd: "aplay", args: (f) => [f] },
    { cmd: "ffplay", args: (f) => ["-nodisp", "-autoexit", "-loglevel", "quiet", f] }
  ]
};
var FORMAT_EXTENSION = {
  wav: "wav",
  "pcm-s16le": "pcm",
  mp3: "mp3",
  opus: "opus",
  ogg: "ogg",
  flac: "flac",
  aiff: "aiff",
  m4a: "m4a"
};
var VERIFIED_PLAYABLE_FORMATS = /* @__PURE__ */ new Set(["wav"]);
var SubprocessSink = class {
  #platform;
  #log;
  #onFailure;
  #players;
  #child = null;
  #playing = false;
  #stopping = false;
  #bytesPlayed = 0;
  #lastExit = null;
  #lastTried = [];
  constructor(opts = {}) {
    this.#platform = opts.platform ?? process.platform;
    this.#log = opts.log ?? (() => {
    });
    this.#onFailure = opts.onFailure ?? (() => {
    });
    this.#players = opts.players ?? null;
  }
  get isPlaying() {
    return this.#playing;
  }
  /**
   * Bytes this sink has actually handed to a player that then exited 0. The self-test reads it,
   * because a byte count that MOVED is the only evidence that the audio path is alive; every other
   * indicator in this system reports healthy while mute (006 section 19 rank 1).
   */
  get bytesPlayed() {
    return this.#bytesPlayed;
  }
  /** Exit code of the last player invocation. `null` if it was killed by barge-in or never ran. */
  get lastExitCode() {
    return this.#lastExit;
  }
  async enqueue(chunk) {
    const dir = await mkdtemp2(join7(tmpdir2(), "orca-tts-play-"));
    const ext = FORMAT_EXTENSION[chunk.format] ?? sanitiseExtension(chunk.format);
    const file = join7(dir, `chunk.${ext}`);
    await writeFile4(file, chunk.data);
    try {
      const played = await this.#play(file);
      if (!played) return;
      if (VERIFIED_PLAYABLE_FORMATS.has(chunk.format)) {
        this.#bytesPlayed += chunk.data.length;
        return;
      }
      const failure = {
        kind: "unverified-format",
        reason: `the audio format '${chunk.format}' has never been verified on ${this.#platform}, so the player reporting success is not evidence you heard it`,
        tried: this.#lastTried
      };
      this.#log(`read-aloud: ${failure.reason}`);
      this.#onFailure(failure);
    } finally {
      await rm4(dir, { recursive: true, force: true }).catch(() => void 0);
    }
  }
  async stop() {
    const c = this.#child;
    this.#child = null;
    this.#stopping = true;
    this.#playing = false;
    if (c !== null && c.exitCode === null) c.kill("SIGKILL");
  }
  async #play(file) {
    const players = this.#players ?? PLAYERS[this.#platform] ?? [];
    const tried = [];
    this.#lastTried = tried;
    let lastReason = "";
    this.#stopping = false;
    for (const p of players) {
      tried.push(p.cmd);
      const outcome = await new Promise((resolve) => {
        let child;
        try {
          child = spawn3(p.cmd, p.args(file), { stdio: "ignore" });
        } catch {
          resolve({ ok: false, why: `${p.cmd} could not be spawned` });
          return;
        }
        this.#child = child;
        this.#playing = true;
        child.on("error", () => {
          this.#playing = false;
          resolve({ ok: false, why: `${p.cmd} could not be started` });
        });
        child.on("close", (code) => {
          this.#playing = false;
          this.#child = null;
          this.#lastExit = code;
          resolve(code === 0 ? { ok: true, why: "" } : { ok: false, why: `${p.cmd} exited ${String(code)}` });
        });
      });
      if (outcome.ok) return true;
      if (this.#stopping) return false;
      lastReason = outcome.why;
      this.#log(`read-aloud: ${outcome.why}`);
    }
    const failure = players.length === 0 ? {
      kind: "no-player",
      reason: `no audio player is installed on ${this.#platform}`,
      tried
    } : { kind: "player-failed", reason: lastReason, tried };
    this.#log(`read-aloud: ${failure.reason}`);
    this.#onFailure(failure);
    return false;
  }
};
function sanitiseExtension(format) {
  const cleaned = format.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length === 0 ? "unknown" : cleaned.slice(0, 24);
}

// packages/plugin/src/huddle/index.ts
import { readFile as readFile7, readdir as readdir4, stat } from "node:fs/promises";
import { watch } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join8 } from "node:path";

// packages/plugin/src/huddle/decoders.ts
var UNSUPPORTED_AGENTS = [
  "gemini",
  "cursor",
  "copilot",
  "amp",
  "droid",
  "devin",
  "aider",
  "continue",
  "cline"
];
var isRecord = (v) => typeof v === "object" && v !== null;
function stableId(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `nouuid-${h.toString(16)}-${text.length}`;
}
function decodeClaudeLine(line) {
  let rec;
  try {
    rec = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(rec)) return null;
  if (rec["isMeta"] === true || rec["isSidechain"] === true) return null;
  if (rec["type"] !== "assistant") return null;
  const message = rec["message"];
  if (!isRecord(message)) return null;
  const content = message["content"];
  if (!Array.isArray(content)) return null;
  const parts = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    const type = block["type"];
    if (type === "thinking" || type === "redacted_thinking") continue;
    if (type === "tool_use" || type === "tool_result") continue;
    if (type === "text" && typeof block["text"] === "string") parts.push(block["text"]);
  }
  const text = parts.join("\n").trim();
  if (text.length === 0) return null;
  return { id: typeof rec["uuid"] === "string" ? rec["uuid"] : stableId(text), text };
}
function decodeGenericLine(line) {
  let rec;
  try {
    rec = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(rec)) return null;
  const role = rec["role"] ?? rec["type"];
  if (role !== "assistant") return null;
  if (rec["thinking"] === true || rec["reasoning"] === true) return null;
  const content = rec["content"] ?? rec["text"];
  if (typeof content !== "string" || content.trim().length === 0) return null;
  const text = content.trim();
  return { id: typeof rec["id"] === "string" ? rec["id"] : stableId(text), text };
}
function decoderFor(agent) {
  return agent === "claude" || agent === "openclaude" ? decodeClaudeLine : decodeGenericLine;
}
function isCompactBoundary(line) {
  let rec;
  try {
    rec = JSON.parse(line);
  } catch {
    return false;
  }
  if (!isRecord(rec)) return false;
  return rec["type"] === "system" && rec["subtype"] === "compact_boundary";
}
function countCompactBoundaries(raw) {
  let n = 0;
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    if (isCompactBoundary(line)) n++;
  }
  return n;
}
function detectTranscriptFormat(raw, maxLines = 200) {
  let sawGeneric = false;
  let n = 0;
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    if (++n > maxLines) break;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(rec)) continue;
    if (isRecord(rec["message"]) && Array.isArray(rec["message"]["content"])) {
      return "claude";
    }
    if ((typeof rec["role"] === "string" || typeof rec["type"] === "string") && (typeof rec["content"] === "string" || typeof rec["text"] === "string")) {
      sawGeneric = true;
    }
  }
  return sawGeneric ? "generic" : "unknown";
}
function unreadableTranscriptMessage(file) {
  const segments = file.toLowerCase().split(/[/\\.]+/);
  const named = UNSUPPORTED_AGENTS.find((a) => segments.includes(a));
  return named === void 0 ? "Huddle cannot read this agent's transcript, so its replies will not be spoken." : `Huddle cannot read ${named}'s transcript, so its replies will not be spoken.`;
}

// packages/plugin/src/huddle/index.ts
var NO_TRANSCRIPT_SENTENCE = {
  "no-root": "Huddle found no agent transcripts on this machine yet, so there is nothing to read.",
  "root-unreadable": "Huddle cannot read the folder agent transcripts live in, so replies will not be spoken. This is usually a permissions problem.",
  "no-transcripts": "Huddle found no agent transcript for this worktree yet, so there is nothing to read."
};
var HUDDLE_STATE_KEY = "huddle.enabled";
var HUDDLE_SPOKEN_KEY = "huddle.spokenIds";
var HUDDLE_HIGH_WATER_KEY = "huddle.highWater";
var HUDDLE_FOLLOWING_KEY = "huddle.following";
var MAX_REMEMBERED_IDS = 300;
var MAX_TRACKED_FILES = 50;
var WATCH_WINDOW_MS = 2e4;
var DEBOUNCE_MS = 250;
var MAX_TRUNCATED_RETRIES = 6;
function sessionLabel(file) {
  const parts = file.split(/[/\\]/);
  const name = (parts[parts.length - 1] ?? "").replace(/\.jsonl$/, "");
  const project2 = (parts[parts.length - 2] ?? "").replace(/^-+/, "").split("-").slice(-3).join(" ");
  return `${project2}, session ${name.slice(0, 8)}`;
}
var HuddleController = class {
  #deps;
  #enabled = false;
  #spoken = /* @__PURE__ */ new Set();
  #lastReply = null;
  #locked = null;
  // the ONE session we are following
  /**
   * M16 presence. ADDITIVE to `#locked`, never a replacement for it.
   *
   * `#locked` is P22's remedy and it is load-bearing: it survives a re-fork precisely because
   * losing it made the next `agent.status.changed` re-pick "whatever was touched last", which is
   * P22 fault 1 (see C4 above). Presence answers a DIFFERENT question — "who else is here" — and
   * must not answer it by widening what gets spoken.
   *
   * So the roster records every session we have SEEN produce a reply, while the lock still decides
   * whose replies are read. That keeps G5 ("show who is in the room") honest without reopening the
   * fault the lock closed.
   */
  #roster = /* @__PURE__ */ new Map();
  /**
   * Sessions whose replies must never reach the audio stream.
   *
   * Enforced at the ONE `speech.speak` call site, not at the surface. A mute that only hides a row
   * is a lie to a listener who cannot see the row — he would still hear the agent he silenced.
   */
  #muted = /* @__PURE__ */ new Set();
  /** The file whose reply was most recently handed to speech — "who is talking". */
  #talking = null;
  #watcher = null;
  #watching = null;
  #stopTimer = null;
  #debounce = null;
  #primed = /* @__PURE__ */ new Set();
  // per FILE: a new session must be primed too, or it dumps its backlog
  /**
   * Per FILE: how many decoded replies have already been accounted for.
   *
   * This, not the id set, is what makes dedup correct. `MAX_REMEMBERED_IDS = 300` trimmed `#spoken`
   * to the last 300, so on reply 301 the oldest ids fell out of the set while their lines were
   * still on disk — and the next whole-file re-read found them "fresh" and read them out again.
   * That is P22's "it read out the whole history" with a new cause (cross-review B-01).
   *
   * An id set is the wrong data structure for a monotonic append-only log: it is unordered, so it
   * cannot express "everything before here is done", which is the only fact we actually need. A
   * high-water mark is O(1) per session, cannot be evicted into a re-speak, and shrinks the storage
   * cost from 300 uuids to one integer. The id set is kept as a secondary filter for duplicates
   * WITHIN one read; it is no longer the gate.
   */
  #highWater = /* @__PURE__ */ new Map();
  /** Set when huddle is switched on, so the next attach re-primes instead of trusting a stale mark. */
  #reprime = false;
  /** The worktree the last agent event came from — the only correlation handle a plugin gets. */
  #lastWorktree = null;
  #warnedUnreadable = /* @__PURE__ */ new Set();
  // per FILE: say "cannot read this" once, not per change
  /**
   * R10-02. How many `compact_boundary` records this file had the last time we read it, THIS
   * SESSION. Not persisted, and that is the safe direction: on the first read of a file we record
   * the count without acting on it, so a restart cannot mistake a compaction that happened while
   * we were down for one happening now and clamp over replies that arrived in between. The harm
   * this closes is re-speaking during a LIVE session, which is exactly when we do have a previous
   * count to compare against.
   */
  #compactBoundaries = /* @__PURE__ */ new Map();
  /**
   * The last "nothing to follow" reason announced. Latched per REASON, not forever: a permissions
   * problem that is fixed and then recurs must be able to speak again, and a reason that changes
   * (root-unreadable -> no-transcripts) is new information. Cleared the moment a file is found.
   */
  #announcedNoTranscript = null;
  /** Files whose watch failure has been announced, so a churning file cannot flood the audio. */
  #warnedWatch = /* @__PURE__ */ new Set();
  /**
   * The ambiguous pair we last warned about. Was a single boolean that latched TRUE for the
   * worker's lifetime (006 site 13 / TT5): the first ambiguity produced one notification and every
   * ambiguity after it produced nothing at all, forever.
   */
  #warnedAmbiguousPair = null;
  constructor(deps) {
    this.#deps = deps;
  }
  get enabled() {
    return this.#enabled;
  }
  async restore() {
    this.#enabled = await this.#deps.store?.get(HUDDLE_STATE_KEY) === true;
    const ids = await this.#deps.store?.get(HUDDLE_SPOKEN_KEY);
    if (Array.isArray(ids)) this.#spoken = new Set(ids.filter((x) => typeof x === "string"));
    const marks = await this.#deps.store?.get(HUDDLE_HIGH_WATER_KEY);
    if (typeof marks === "object" && marks !== null && !Array.isArray(marks)) {
      for (const [file, n] of Object.entries(marks)) {
        if (typeof n === "number" && Number.isFinite(n) && n >= 0) this.#highWater.set(file, n);
      }
    }
    const following = await this.#deps.store?.get(HUDDLE_FOLLOWING_KEY);
    if (typeof following === "string" && following.length > 0) this.#locked = following;
    return this.#enabled;
  }
  /**
   * The session being followed, as a sentence, for re-announcement after a worker reap.
   *
   * C4's other half: the listener is not told that the worker restarted, so if the lock had
   * silently changed they would have had no way to know whose words they were hearing — the S1
   * failure this whole document ranks first. Returns null when there is nothing to re-announce.
   */
  restoredAnnouncement() {
    if (!this.#enabled || this.#locked === null) return null;
    return `Still following ${sessionLabel(this.#locked)}.`;
  }
  toggle() {
    this.#enabled = !this.#enabled;
    this.#observe(this.#deps.store?.set(HUDDLE_STATE_KEY, this.#enabled), "save the huddle setting");
    if (this.#enabled) {
      this.#primed.clear();
      this.#reprime = true;
      this.#locked = null;
      void this.#persistFollowing();
    } else {
      this.#stopWatching();
      this.#observe(this.#deps.speech.stop(), "stop speaking");
    }
    return this.#enabled;
  }
  async lastReply() {
    if (this.#lastReply !== null) return this.#lastReply;
    const file = await this.#newestTranscript(null);
    if (file === null) return null;
    const replies = await this.#readReplies(file);
    return replies[replies.length - 1]?.text ?? null;
  }
  /** The event is a hint: start (or extend) watching the transcript for this worktree. */
  onAgentStatus(status, worktreePath) {
    if (worktreePath !== null) this.#lastWorktree = worktreePath;
    if (!this.#enabled) return;
    this.#observe(this.#ensureWatching(worktreePath), "start watching for replies");
  }
  dispose() {
    this.#stopWatching();
  }
  /**
   * G5: who is in the room, who is talking, and who is silenced.
   *
   * Returns data, not a rendering — the surface (M13) decides how to say it, and a test can assert
   * against state it set itself rather than against a formatted string.
   */
  presence() {
    const inRoom = [...this.#roster.entries()].sort((a, b) => b[1].lastReplyAt - a[1].lastReplyAt).map(([file, r]) => ({
      file,
      label: r.label,
      replies: r.replies,
      muted: this.#muted.has(file),
      following: this.#locked === file
    }));
    return { inRoom, talking: this.#talking };
  }
  /**
   * Silence one session. Returns the announcement, because a control that changes what the listener
   * hears must say so IN the audio stream — he cannot see a muted row (P30).
   */
  mute(file) {
    this.#muted.add(file);
    if (this.#talking === file) this.#talking = null;
    return `Muted ${sessionLabel(file)}. Its replies will not be read.`;
  }
  /**
   * Unmute. Deliberately does NOT replay what was missed: the backlog was marked spoken while
   * muted, so unmuting resumes rather than catching up. Replaying it would be P22's whole-history
   * dump arriving by a new route.
   */
  unmute(file) {
    const was = this.#muted.delete(file);
    return was ? `Unmuted ${sessionLabel(file)}. New replies will be read; what it said while muted is not replayed.` : `${sessionLabel(file)} was not muted.`;
  }
  isMuted(file) {
    return this.#muted.has(file);
  }
  /**
   * Follow a different session, announcing the switch so the listener is never disoriented.
   *
   * This is P22's recorded remedy — "announce switches aloud" — and until `read-aloud.follow`
   * existed it had NO caller anywhere in the source tree: one grep hit, the declaration itself.
   * An unreachable implementation reads to the next agent as a shipped feature (006 TT6, P26).
   *
   * One announcement, not two. It used to `notify` AND `speak(..., 'replace')`, which both
   * duplicated the message and cleared the queue; `notify` now routes into the audio stream, so
   * the switch is heard once and queued replies survive.
   */
  switchTo(file) {
    this.#locked = file;
    void this.#persistFollowing();
    this.#warnedWatch.delete(file);
    this.#stopWatching();
    this.#deps.notify(`Now reading from ${sessionLabel(file)}.`);
    void this.#ensureWatching(this.#lastWorktree);
  }
  /**
   * Lock onto the most recently active transcript for this worktree, announcing the switch.
   *
   * The command behind this exists because `unfollow` shipped without a counterpart: the listener
   * could stop following a session and had no way to pick one back up except by waiting for the
   * next `agent.status.changed` to silently re-pick "whatever was touched last" (006 TT7).
   *
   * Returns the file now followed, or null when there is nothing to follow.
   */
  async followNewest() {
    const file = await this.#newestTranscript(this.#lastWorktree);
    if (file === null) return null;
    this.switchTo(file);
    return file;
  }
  /** Stop following any session; huddle stays on but silent until you pick one. */
  unlock() {
    this.#locked = null;
    void this.#persistFollowing();
    this.#stopWatching();
  }
  get following() {
    return this.#locked;
  }
  async #ensureWatching(worktreePath) {
    let file = this.#locked;
    if (file === null) {
      const found = await this.#findNewest(worktreePath);
      file = found.file;
      if (file === null) {
        const reason = found.reason ?? "no-transcripts";
        if (this.#announcedNoTranscript !== reason) {
          this.#announcedNoTranscript = reason;
          this.#deps.notify(NO_TRANSCRIPT_SENTENCE[reason]);
        }
        return;
      }
    }
    this.#announcedNoTranscript = null;
    if (this.#locked === null) {
      this.#locked = file;
      this.#deps.log(`read-aloud: following ${file}`);
      void this.#persistFollowing();
    }
    if (this.#watching !== file) {
      this.#stopWatching();
      this.#watching = file;
      if (!this.#primed.has(file)) {
        const replies = await this.#readReplies(file);
        for (const r of replies) this.#spoken.add(r.id);
        const persisted = this.#highWater.get(file);
        this.#setHighWater(file, this.#reprime || persisted === void 0 ? replies.length : persisted);
        this.#reprime = false;
        this.#primed.add(file);
        await this.#persistSpoken();
      }
      try {
        const w = watch(file, () => {
          this.#onChange(file);
        });
        w.on("error", (err) => {
          this.#watchFailed(file, err);
        });
        this.#watcher = w;
        this.#deps.log(`read-aloud: watching ${file}`);
      } catch (err) {
        this.#watchFailed(file, err);
      }
    }
    if (this.#stopTimer !== null) clearTimeout(this.#stopTimer);
    this.#stopTimer = setTimeout(() => {
      this.#stopWatching();
    }, WATCH_WINDOW_MS);
    this.#onChange(file);
  }
  #onChange(file) {
    if (this.#debounce !== null) clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => {
      this.#observe(this.#speakNew(file), "read new replies");
    }, DEBOUNCE_MS);
  }
  async #speakNew(file) {
    if (!this.#enabled) return;
    const { replies, format, truncated, boundaries } = await this.#read(file);
    if (truncated) {
      const spent = this.#truncatedRetries.get(file) ?? 0;
      if (spent < MAX_TRUNCATED_RETRIES) {
        this.#truncatedRetries.set(file, spent + 1);
        this.#deps.log(`read-aloud: transcript ends mid-line, re-read ${spent + 1}`);
        setTimeout(() => {
          this.#observe(this.#speakNew(file), "read new replies");
        }, DEBOUNCE_MS).unref?.();
        return;
      }
      this.#deps.log("read-aloud: transcript last line is unreadable; treating it as absent");
    }
    this.#truncatedRetries.delete(file);
    if (format === "unknown") {
      if (!this.#warnedUnreadable.has(file)) {
        this.#warnedUnreadable.add(file);
        this.#deps.notify(unreadableTranscriptMessage(file));
      }
      return;
    }
    const mark = this.#highWater.get(file) ?? 0;
    const seenBoundaries = this.#compactBoundaries.get(file);
    this.#compactBoundaries.set(file, boundaries);
    if (seenBoundaries !== void 0 && boundaries > seenBoundaries) {
      this.#setHighWater(file, replies.length);
      this.#deps.log(`read-aloud: transcript compacted (${boundaries} boundaries), re-anchoring at ${replies.length}`);
      await this.#persistSpoken();
      return;
    }
    if (replies.length < mark) {
      this.#setHighWater(file, replies.length);
      this.#deps.log(`read-aloud: transcript shrank, re-anchoring at ${replies.length}`);
      await this.#persistSpoken();
      return;
    }
    const fresh = replies.slice(mark).filter((r) => !this.#spoken.has(r.id));
    this.#setHighWater(file, replies.length);
    if (fresh.length === 0) {
      await this.#persistSpoken();
      return;
    }
    const seen = this.#roster.get(file);
    this.#roster.set(file, {
      label: sessionLabel(file),
      replies: (seen?.replies ?? 0) + fresh.length,
      lastReplyAt: Date.now()
    });
    if (this.#muted.has(file)) {
      for (const r of fresh) this.#spoken.add(r.id);
      this.#deps.log(`read-aloud: ${fresh.length} repl${fresh.length === 1 ? "y" : "ies"} from ${sessionLabel(file)} not spoken (muted)`);
      await this.#persistSpoken();
      return;
    }
    for (const r of fresh) {
      this.#spoken.add(r.id);
      this.#lastReply = r.text;
      this.#talking = file;
      this.#deps.speech.speak(r.text, "queue", sessionLabel(file), file);
    }
    this.#deps.log(`read-aloud: spoke ${fresh.length} new repl${fresh.length === 1 ? "y" : "ies"}`);
    await this.#persistSpoken();
  }
  /** Record a mark and keep the map bounded, oldest-touched first. */
  #setHighWater(file, n) {
    this.#highWater.delete(file);
    this.#highWater.set(file, n);
    while (this.#highWater.size > MAX_TRACKED_FILES) {
      const oldest = this.#highWater.keys().next();
      if (oldest.done === true) break;
      this.#highWater.delete(oldest.value);
    }
  }
  /**
   * One sentence per file, not per event: a file that fails to watch usually keeps failing, and a
   * hundred identical reports would flood the only channel the listener has.
   */
  #watchFailed(file, err) {
    this.#deps.log(`read-aloud: could not watch transcript ${file}: ${String(err)}`);
    if (this.#warnedWatch.has(file)) return;
    this.#warnedWatch.add(file);
    this.#deps.notify(
      "Huddle lost track of the agent transcript, so new replies may not be spoken. Use follow to pick the session up again."
    );
  }
  async #persistFollowing() {
    await this.#deps.store?.set(HUDDLE_FOLLOWING_KEY, this.#locked);
  }
  async #persistSpoken() {
    const ids = [...this.#spoken].slice(-MAX_REMEMBERED_IDS);
    this.#spoken = new Set(ids);
    await this.#deps.store?.set(HUDDLE_SPOKEN_KEY, ids);
    await this.#deps.store?.set(HUDDLE_HIGH_WATER_KEY, Object.fromEntries(this.#highWater));
  }
  #stopWatching() {
    this.#watcher?.close();
    this.#watcher = null;
    this.#watching = null;
    if (this.#stopTimer !== null) {
      clearTimeout(this.#stopTimer);
      this.#stopTimer = null;
    }
    if (this.#debounce !== null) {
      clearTimeout(this.#debounce);
      this.#debounce = null;
    }
  }
  /**
   * The one place a fire-and-forget promise is allowed, because it is not fire-and-forget any more.
   *
   * Sites 9-12 were four `void somePromise()` calls with no `.catch`. Each one is a whole subsystem
   * — persistence, playback, tailing, decoding — failing into an unhandled rejection, which for
   * this listener is exactly the same experience as the plugin not existing.
   */
  #observe(p, what) {
    void Promise.resolve(p).catch((err) => {
      this.#deps.log(`read-aloud: could not ${what}: ${String(err)}`);
      this.#deps.notify(`Huddle could not ${what}, so replies may stop being spoken.`);
    });
  }
  #projectsRoot() {
    return this.#deps.projectsDir ?? join8(homedir2(), ".claude", "projects");
  }
  async #newestTranscript(worktreePath) {
    return (await this.#findNewest(worktreePath)).file;
  }
  /**
   * Find the newest transcript, and say WHY when there is none.
   *
   * Site 5: this returned a bare `null` for six different causes, and `#ensureWatching` returned on
   * it with no log and no notify. Distinguishing them is what makes TT1 announceable at all — "no
   * agent has ever run here" and "we are not allowed to read your home directory" need completely
   * different sentences, and the listener can act on the second one.
   */
  async #findNewest(worktreePath) {
    const root = this.#projectsRoot();
    let dirs;
    try {
      dirs = await readdir4(root);
    } catch (err) {
      const code = err.code;
      this.#deps.log(`read-aloud: cannot read ${root}: ${String(code ?? err)}`);
      return { file: null, reason: code === "ENOENT" ? "no-root" : "root-unreadable" };
    }
    const slug = worktreePath === null ? null : worktreePath.replace(/[/\\:]/g, "-");
    const matched = slug === null ? [] : dirs.filter((d2) => d2 === slug || d2.endsWith(slug) || slug.endsWith(d2));
    const search = matched.length > 0 ? matched : dirs;
    const files = [];
    let skipped = 0;
    for (const d2 of search) {
      let entries;
      try {
        entries = await readdir4(join8(root, d2));
      } catch {
        skipped++;
        continue;
      }
      for (const e of entries) {
        if (!e.endsWith(".jsonl")) continue;
        const p = join8(root, d2, e);
        try {
          files.push({ path: p, mtime: (await stat(p)).mtimeMs });
        } catch {
          skipped++;
          continue;
        }
      }
    }
    if (files.length === 0) {
      return { file: null, reason: skipped > 0 ? "root-unreadable" : "no-transcripts" };
    }
    files.sort((a, b) => b.mtime - a.mtime);
    for (const f of files) {
      const seen = this.#roster.get(f.path);
      this.#roster.set(f.path, {
        label: sessionLabel(f.path),
        replies: seen?.replies ?? 0,
        lastReplyAt: seen?.lastReplyAt ?? f.mtime
      });
    }
    const [first, second] = files;
    if (first !== void 0 && second !== void 0 && first.mtime - second.mtime < 2e3) {
      const pair = `${first.path}\0${second.path}`;
      if (this.#warnedAmbiguousPair !== pair) {
        this.#warnedAmbiguousPair = pair;
        this.#deps.notify(
          "two agents are active in this worktree, so huddle cannot tell which one replied. Speaking the most recent."
        );
      }
    } else {
      this.#warnedAmbiguousPair = null;
    }
    return { file: first?.path ?? null, reason: null };
  }
  async #readReplies(file) {
    return (await this.#read(file)).replies;
  }
  /**
   * Re-reads spent on a file whose last line was mid-write. Bounded, because a genuinely corrupt
   * final line must not spin forever — after this many attempts the line really is unreadable and
   * is treated as absent, which is what it now is.
   */
  #truncatedRetries = /* @__PURE__ */ new Map();
  /**
   * Read a transcript with the decoder its own records call for.
   *
   * This used to call `decodeClaudeLine` unconditionally, so every non-Claude agent produced total
   * silence while the plugin reported itself healthy and the panel claimed the format was
   * supported (006 DC1). `format` is returned rather than swallowed so the caller can SAY that it
   * could not read the file — "unreadable" and "nothing new" were previously the same empty array.
   */
  async #read(file) {
    let raw;
    try {
      raw = await readFile7(file, "utf8");
    } catch (err) {
      this.#deps.log(`read-aloud: cannot read ${file}: ${String(err)}`);
      return { replies: [], format: "unknown", truncated: false, boundaries: 0 };
    }
    let lastNonEmpty = "";
    for (const line of raw.split("\n")) if (line.trim().length > 0) lastNonEmpty = line;
    const truncated = lastNonEmpty.length > 0 && !this.#isCompleteJson(lastNonEmpty);
    const format = detectTranscriptFormat(raw);
    if (format === "unknown") return { replies: [], format, truncated, boundaries: 0 };
    const decode = decoderFor(format === "claude" ? "claude" : "codex");
    const replies = [];
    for (const line of raw.split("\n")) {
      if (line.trim().length === 0) continue;
      const decoded = decode(line);
      if (decoded !== null) replies.push(decoded);
    }
    return { replies, format, truncated, boundaries: countCompactBoundaries(raw) };
  }
  #isCompleteJson(line) {
    try {
      JSON.parse(line);
      return true;
    } catch {
      return false;
    }
  }
};

// packages/plugin/src/settings/index.ts
var INBOX_FILENAME = "settings.jsonc";
var INBOX_DIRNAME = "orca-tts";
function inboxDir(env, platform) {
  const override = env["ORCA_TTS_CONFIG_DIR"];
  if (override !== void 0 && override.length > 0) return override;
  const home = env["HOME"] ?? env["USERPROFILE"] ?? ".";
  if (platform === "win32") {
    const appData = env["APPDATA"];
    return join9(appData !== void 0 && appData.length > 0 ? appData : join9(home, "AppData", "Roaming"), INBOX_DIRNAME);
  }
  if (platform === "darwin") return join9(home, "Library", "Application Support", INBOX_DIRNAME);
  const xdg = env["XDG_CONFIG_HOME"];
  return join9(xdg !== void 0 && xdg.length > 0 ? xdg : join9(home, ".config"), INBOX_DIRNAME);
}
function inboxPath(env, platform) {
  return join9(inboxDir(env, platform), INBOX_FILENAME);
}
function join9(...parts) {
  return parts.join("/");
}
function nativeInboxPath(env, platform) {
  const p = inboxPath(env, platform);
  return platform === "win32" ? p.replaceAll("/", "\\") : p;
}
function isAbsent(err) {
  const code = err?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
async function loadSettings(io, path, evidence) {
  let mirror = null;
  try {
    mirror = fromMirror(await io.mirrorGet());
  } catch (err) {
    io.log?.(`read-aloud: settings mirror unreadable: ${String(err)}`);
  }
  let text = null;
  let inboxFailure = null;
  try {
    text = await io.readInbox(path);
  } catch (err) {
    inboxFailure = isAbsent(err) ? { kind: "absent" } : { kind: "unreadable", reason: String(err) };
  }
  const result = text === null ? parse(void 0, { mirror }) : parseSettingsText(text, { mirror });
  const wholeFileRefused = inboxFailure !== null || result.fileError !== void 0;
  const source = !wholeFileRefused ? "inbox" : mirror !== null ? "mirror" : "defaults";
  return {
    snapshot: { revision: result.revision, values: result.settings },
    result,
    source,
    path,
    inboxFailure,
    sentence: sentenceFor(result, inboxFailure, source, path),
    destination: reportDestination(result.settings["announce.reportChannel"], evidence),
    mirrorable: !wholeFileRefused
  };
}
function sentenceFor(result, failure, source, path) {
  const parts = [];
  if (failure?.kind === "absent") {
    if (source === "mirror") {
      parts.push(
        `I could not find your settings file at ${path}, so I am using the last settings I had. Save from the Voice Lab to write it again.`
      );
    }
  } else if (failure?.kind === "unreadable") {
    parts.push(
      `Your settings file at ${path} could not be opened: ${failure.reason}. I am using ${source === "mirror" ? "the last settings I had" : "the built-in defaults"}.`
    );
  }
  const fromParser = settingsReportSentence(result);
  if (fromParser !== null) parts.push(fromParser);
  return parts.length === 0 ? null : parts.join(" ");
}
var SettingsRuntime = class {
  #snapshot;
  #source = "defaults";
  #path;
  #rejected = 0;
  #unknown = 0;
  #writtenAt = null;
  #writtenBy = null;
  /** The host's runtime voice list. Empty until the provider answers; never guessed (P28). */
  #voices = [];
  /**
   * The load's report sentence, kept for the LIFE of the session.
   *
   * 011 section 4.3a's correctness half: *the report is never dropped*, in any configuration.
   * `on-request-only` is a channel, not a silence — so `status` must still be able to answer with
   * the same sentence an hour later, which means it cannot be consumed by whoever reads it first.
   */
  #report = null;
  /** ...and whether it is ALSO owed to the first utterance the listener asks for (4.3a). */
  #owedToFirstUtterance = false;
  constructor(path) {
    this.#path = path;
    this.#snapshot = { revision: 0, values: schemaDefaults() };
  }
  get snapshot() {
    return this.#snapshot;
  }
  get values() {
    return this.#snapshot.values;
  }
  get source() {
    return this.#source;
  }
  get path() {
    return this.#path;
  }
  get rejectedCount() {
    return this.#rejected;
  }
  /**
   * Adopt a load, if it is newer. Refused as `stale_revision` by the same rule the write path uses
   * — and the FIRST promotion of a session is never refused, because there is nothing to be stale
   * against (011 1.2a).
   */
  adopt(outcome, first = true) {
    const r = promote(first ? null : this.#snapshot, outcome.snapshot);
    if (!r.promoted) return false;
    this.#snapshot = r.snapshot;
    this.#source = outcome.source;
    this.#path = outcome.path;
    this.#rejected = outcome.result.rejected.length;
    this.#unknown = outcome.result.unknownFields.length;
    this.#writtenAt = outcome.result.writtenAt ?? null;
    this.#writtenBy = outcome.result.writtenBy ?? null;
    return true;
  }
  setVoices(voices) {
    this.#voices = voices;
  }
  voiceName(index) {
    return this.#voices[index];
  }
  normalizeOptions() {
    return toNormalizeOptions(this.values);
  }
  chunkerOptions() {
    return toChunkerOptions(this.values);
  }
  synthesizeOptions() {
    return toSynthesizeOptions(this.values, (i) => this.voiceName(i));
  }
  /** The flat record written to ORCA's KV. Callers must only do this for a mirrorable load. */
  mirrorRecord() {
    return toMirror(this.values, this.#snapshot.revision, this.#writtenAt ?? void 0);
  }
  /** Record the report. Kept whether or not anything speaks it unprompted. */
  setReport(sentence) {
    this.#report = sentence;
  }
  get report() {
    return this.#report;
  }
  /** Also owe it to the first requested utterance — the `when-audio-in-use` hold (011 4.3a). */
  hold() {
    if (this.#report !== null) this.#owedToFirstUtterance = true;
  }
  /**
   * Take the report if it is owed to an utterance, ONCE. Returns `null` when nothing is owed —
   * including when a report exists but its channel said "not unprompted", which is the whole
   * distinction `on-request-only` buys.
   */
  takeHeld() {
    if (!this.#owedToFirstUtterance) return null;
    this.#owedToFirstUtterance = false;
    return this.#report;
  }
  get hasHeld() {
    return this.#owedToFirstUtterance;
  }
  /**
   * R7-32's status clause. Four values, each chosen because it separates a specific confusion the
   * listener has no other way to resolve: an unchanged `revision` means the plugin never saw their
   * edit; a relative age separates "my edit landed" from "I am hearing last week's file";
   * `writtenBy` separates "the lab overwrote my hand edit" from "my hand edit won"; the rejected
   * count is the settings-health answer.
   *
   * Relative, never absolute: an absolute timestamp read aloud is a sentence nobody can parse.
   */
  statusClause(now) {
    if (this.#source !== "inbox") {
      const why = this.#source === "mirror" ? "I am using the last settings I had" : "I am using the built-in defaults";
      return `No settings file was read from ${this.#path}, so ${why}.`;
    }
    const age = this.#writtenAt === null ? null : relativeAge(this.#writtenAt, now);
    const by = this.#writtenBy === null ? "" : `, by ${writerPhrase(this.#writtenBy)}`;
    const when = age === null ? "" : `, written ${age}`;
    const counts = [];
    if (this.#rejected > 0) {
      counts.push(`${this.#rejected} field${this.#rejected === 1 ? " is" : "s are"} using defaults`);
    }
    if (this.#unknown > 0) {
      counts.push(`${this.#unknown} ${this.#unknown === 1 ? "is" : "are"} newer than this version`);
    }
    const health = counts.length === 0 ? "" : ` ${counts.join(" and ")}.`;
    return `Settings revision ${this.#snapshot.revision}${when}${by}, from ${this.#path}.${health}`;
  }
};
function writerPhrase(writtenBy) {
  const who = (writtenBy.split("/")[0] ?? writtenBy).trim();
  if (who === "hand") return "hand";
  if (who === "voice-lab") return "the Voice Lab";
  if (who === "read-aloud") return writtenBy.includes("(restored)") ? "Read Aloud, rebuilt from the last good settings" : "Read Aloud";
  return who.replaceAll("/", " ");
}
function relativeAge(writtenAt, now) {
  const then = Date.parse(writtenAt);
  if (Number.isNaN(then)) return null;
  const secs = Math.max(0, Math.round((now - then) / 1e3));
  if (secs < 90) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 90) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// packages/plugin/src/control/dashboard.ts
import { createConnection, createServer } from "node:net";
import { mkdir as mkdir3, readFile as readFile8, rename as rename2, writeFile as writeFile5 } from "node:fs/promises";
import { homedir as homedir3 } from "node:os";
import { join as join10 } from "node:path";
var DASHBOARD_FILE = "dashboard.json";
var COMMAND_MAX_BYTES = 4096;
var COMMAND_MAX_AGE_MS = 5e3;
var EMPTY_SPEECH_STATUS = {
  generation: 0,
  nowReading: null,
  queueDepth: 0,
  queue: []
};
function defaultControlDir(env = process.env, platform = process.platform) {
  if (env["ORCA_TTS_CONTROL_DIR"]) return env["ORCA_TTS_CONTROL_DIR"];
  if (platform === "win32") {
    return join10(env["LOCALAPPDATA"] ?? env["APPDATA"] ?? homedir3(), "orca-tts", "control");
  }
  if (platform === "darwin") return join10(homedir3(), "Library", "Application Support", "orca-tts", "control");
  return join10(env["XDG_STATE_HOME"] ?? join10(homedir3(), ".local", "state"), "orca-tts", "control");
}
var endpointFor = (dir) => process.platform === "win32" ? `\\\\.\\pipe\\orca-tts-${process.pid}` : join10(dir, `control-${process.pid}.sock`);
var responseLine = (socket, response) => {
  socket.end(`${JSON.stringify(response)}
`);
};
var parseEnvelope = (line) => {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return { ok: false, code: "invalid_envelope", message: "That control message was not valid JSON." };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, code: "invalid_envelope", message: "That control message was not an object." };
  }
  const record = value;
  if (record["v"] !== 1 || typeof record["id"] !== "string" || record["id"].length === 0 || typeof record["verb"] !== "string" || typeof record["gen"] !== "number" || !Number.isSafeInteger(record["gen"]) || typeof record["at"] !== "number" || !Number.isFinite(record["at"])) {
    return { ok: false, code: "invalid_envelope", message: "That control message was missing a required field." };
  }
  if (record["verb"] !== "stop") {
    return { ok: false, code: "unknown_verb", message: `The ${record["verb"]} control has no plugin consumer.` };
  }
  return { v: 1, id: record["id"], verb: "stop", gen: record["gen"], at: record["at"] };
};
var DashboardRuntime = class {
  #dir;
  #path;
  #endpoint;
  #handlers;
  #log;
  #seen = [];
  #server = null;
  #writeSerial = Promise.resolve();
  #speech = EMPTY_SPEECH_STATUS;
  #engine = { state: "starting", name: "starting", rung: null, reason: null };
  constructor(dir, handlers, log = () => {
  }) {
    this.#dir = dir;
    this.#path = join10(dir, DASHBOARD_FILE);
    this.#endpoint = endpointFor(dir);
    this.#handlers = handlers;
    this.#log = log;
  }
  get path() {
    return this.#path;
  }
  async start() {
    await mkdir3(this.#dir, { recursive: true, mode: 448 });
    await new Promise((resolve, reject) => {
      const server = createServer((socket) => {
        this.#accept(socket);
      });
      this.#server = server;
      server.once("error", reject);
      server.listen(this.#endpoint, () => {
        server.off("error", reject);
        server.on("error", (err) => {
          this.#log(`dashboard control server failed: ${String(err)}`);
        });
        server.unref();
        resolve();
      });
    });
    await this.#publish();
    this.#log(`read-aloud: dashboard listening at ${this.#endpoint}`);
  }
  updateSpeech(status) {
    this.#speech = status;
    void this.#publish();
  }
  updateEngine(engine) {
    this.#engine = engine;
    void this.#publish();
  }
  async close() {
    const server = this.#server;
    this.#server = null;
    if (server === null) return;
    await new Promise((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
  #document() {
    return {
      status: {
        version: 1,
        updatedAtEpochMs: Date.now(),
        engine: this.#engine,
        ...this.#speech
      },
      control: { endpoint: this.#endpoint, pid: process.pid }
    };
  }
  async #publish() {
    const document = this.#document();
    const json = `${JSON.stringify(document, null, 2)}
`;
    this.#writeSerial = this.#writeSerial.then(async () => {
      const temp = `${this.#path}.${process.pid}.tmp`;
      await writeFile5(temp, json, { encoding: "utf8", mode: 384 });
      await rename2(temp, this.#path);
    }).catch((err) => {
      this.#log(`could not publish dashboard status: ${String(err)}`);
    });
    await this.#writeSerial;
  }
  #accept(socket) {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (part) => {
      buffer += part;
      if (Buffer.byteLength(buffer, "utf8") > COMMAND_MAX_BYTES) {
        const response = {
          ok: false,
          code: "invalid_envelope",
          message: "That control message was too large."
        };
        this.#handlers.announceRefusal(response.message);
        responseLine(socket, response);
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const line = buffer.slice(0, newline);
      buffer = "";
      void this.#dispatch(line, socket);
    });
    socket.on("error", (err) => {
      this.#log(`dashboard control connection failed: ${String(err)}`);
    });
  }
  async #dispatch(line, socket) {
    const parsed = parseEnvelope(line);
    if ("ok" in parsed) {
      this.#handlers.announceRefusal(parsed.message);
      responseLine(socket, parsed);
      return;
    }
    if (this.#seen.includes(parsed.id)) {
      responseLine(socket, { ok: true, code: "duplicate" });
      return;
    }
    this.#seen.push(parsed.id);
    if (this.#seen.length > 64) this.#seen.shift();
    if (Date.now() - parsed.at > COMMAND_MAX_AGE_MS) {
      const response = {
        ok: false,
        code: "expired",
        message: "That Stop control arrived too late and was not applied."
      };
      this.#handlers.announceRefusal(response.message);
      responseLine(socket, response);
      return;
    }
    const currentGeneration = this.#speech.nowReading?.gen ?? this.#speech.generation;
    if (parsed.gen < currentGeneration) {
      const response = {
        ok: false,
        code: "stale_generation",
        message: "That Stop control belonged to an earlier reply and was not applied."
      };
      this.#handlers.announceRefusal(response.message);
      responseLine(socket, response);
      return;
    }
    try {
      await this.#handlers.stop();
      responseLine(socket, { ok: true, code: "stopped" });
    } catch (err) {
      const response = {
        ok: false,
        code: "action_failed",
        message: `Stop did not reach speech: ${String(err)}`
      };
      this.#handlers.announceRefusal(response.message);
      responseLine(socket, response);
    }
  }
};

// packages/plugin/src/main.ts
var EXPECTED_COMMANDS = 9;
function activate(orca, options = {}) {
  let announce = () => {
  };
  const settingsPath = options.settingsDir === void 0 ? nativeInboxPath(process.env, process.platform) : `${options.settingsDir}/settings.jsonc`;
  const settings = new SettingsRuntime(settingsPath);
  const host = makeHost(orca, {
    // 006 section 19 rank 2: `{ delivered }` was computed by ORCA and discarded here, so a muted
    // tray, focus assist or a revoked permission silenced every announcement in this plugin while
    // it reported success. Anything that was NOT already spoken now falls back to speech.
    onUndelivered: (m) => {
      announce(m);
    },
    // Site 19/20: `undefined` was indistinguishable from "the key is not set". Storage failing is
    // why huddle comes back off after a reap, and why a re-forked worker replays a backlog.
    onStorageFailure: (f) => {
      host.log(`read-aloud: storage.${f.op}(${f.key}) failed: ${f.reason}`);
      if (f.op === "get") {
        announce("Huddle could not read its saved settings, so it started from defaults.");
      }
    },
    // Site 22, and section 19 rank 4 — "whether a control fired". A dead chord and a handler that
    // threw are the same absence of sound. 'now', because the listener pressed a key THIS second
    // and is waiting to find out whether anything happened.
    onCommandFailed: (id, reason) => {
      announce(`That control did not work: ${id.replace("read-aloud.", "")}. ${reason}`, "now");
    },
    // Logged, answerable by `status`, and deliberately not spoken — see the hook's own comment.
    onSettingsFailure: (f) => {
      host.log(`read-aloud: settings mirror ${f.op} failed: ${f.reason}`);
    }
  });
  host.log("read-aloud: activating");
  const sink = options.sink ?? new SubprocessSink({
    log: host.log,
    onFailure: (f) => {
      if (f.kind === "no-player") {
        announce(`${f.reason}. Speech is being produced but nothing can play it.`);
      } else if (f.kind === "unverified-format") {
        announce(`That may not have been played: ${f.reason}.`);
      } else {
        announce(`Audio playback failed: ${f.reason}.`);
      }
    }
  });
  let speech = null;
  let engineError = null;
  const deferredAnnouncements = [];
  const MAX_DEFERRED = 20;
  let deferredDropped = 0;
  announce = (message, urgency = "next") => {
    host.log(`read-aloud: ${message}`);
    host.notify("Read Aloud", message, { alreadySpoken: true });
    if (speech !== null) speech.announce(message, urgency);
    else if (deferredAnnouncements.length < MAX_DEFERRED) deferredAnnouncements.push(message);
    else deferredDropped++;
  };
  const dashboardDisabled = options.controlDir === false || options.controlDir === void 0 && options.settingsDir !== void 0;
  const dashboard = dashboardDisabled ? null : new DashboardRuntime(options.controlDir ?? defaultControlDir(), {
    // The control server awaits the REAL effect. A transport receipt is not success: stop()
    // returns only after synthesis cancellation and sink flush have both been requested.
    stop: async () => {
      if (speech === null) throw new Error("the speech engine is still starting");
      await speech.stop();
    },
    // A received control with no consumer is said in the audio stream, never discarded as an
    // inert message or left only in a log (P30 and the G2 brief).
    announceRefusal: (message) => {
      announce(message, "now");
    }
  }, host.log);
  if (dashboard !== null) {
    void dashboard.start().catch((err) => {
      announce(`The Read Aloud control pane could not connect: ${String(err)}.`, "next");
    });
  }
  const registry = createProviderRegistry({
    os: options.provider ?? new OsSynthProvider({ notify: (m) => {
      announce(m);
    } }),
    ...options.pocket === void 0 ? {} : { pocket: options.pocket }
  });
  const pocketRegistered = registry.get("pocket") !== void 0;
  const resolveFor = (engine) => registry.resolve(requestedEngineId(engine, pocketRegistered));
  let lastNamedReason;
  const nameSubstitution = (reason) => {
    if (reason === void 0 || reason === lastNamedReason) return;
    lastNamedReason = reason;
    announce(reason);
  };
  void resolveFor(settings.snapshot.values["synthesize.engine"]).then((resolved) => {
    if (resolved === null) {
      const detail = registry.lastFailureDetail;
      const why = detail === null ? registry.lastFailure ?? "no speech engine is available on this system" : `no speech engine is available on this system (${detail.kind}) \u2014 ${detail.reason}`;
      engineError = why;
      dashboard?.updateEngine({ state: "failed", name: "unavailable", rung: null, reason: why });
      host.log(`read-aloud: ${why}`);
      host.notify("Read Aloud", why);
      return;
    }
    speech = new SpeechService({
      provider: resolved.provider,
      sink,
      log: host.log,
      maxQueued: 8,
      // 011 section 2.3: a GETTER, not values. The service is constructed once and lives for the
      // session; the listener's file can change at any point inside it.
      settings: () => settings.snapshot,
      resolveVoice: (i) => settings.voiceName(i),
      // Engine is a synthesize setting: read once per utterance from the snapshot, pass the
      // mapped id to registry.resolve(). Pocket failing names the substitution out loud.
      selectEngine: async (engine) => {
        const next = await resolveFor(engine);
        if (next === null) return null;
        nameSubstitution(next.status.reason);
        return next.provider;
      },
      ...dashboard === null ? {} : { onStatus: (status) => {
        dashboard.updateSpeech(status);
      } },
      ...options.announceDelayMs === void 0 ? {} : { announceDelayMs: options.announceDelayMs },
      // Supplement only. The spoken sentence naming the count comes from SpeechService itself, so
      // it cannot be lost by a notification channel that is muted, denied, or simply not looked at.
      /**
       * 006 section 19 rank 3 — "whose words are being spoken". Answered by asking the
       * filesystem, not by re-reading the string we built: a session whose transcript is gone
       * has ended, and C1's dead-agent-in-a-live-voice depends on nobody ever checking.
       */
      resolveLabel: (id) => existsSync4(id) ? sessionLabel(id) : null,
      onDropped: (n2) => {
        host.notify("Read Aloud", `Skipped ${n2} older repl${n2 === 1 ? "y" : "ies"} to keep up`);
      }
    });
    dashboard?.updateSpeech(speech.status());
    dashboard?.updateEngine({
      state: "ready",
      name: resolved.provider.displayName,
      rung: resolved.status.rung,
      reason: resolved.status.reason ?? null
    });
    host.log(`read-aloud: engine ready (${resolved.provider.displayName}, rung=${resolved.status.rung})`);
    void Promise.resolve(resolved.provider.listVoices()).then((voices) => {
      settings.setVoices(voices);
    }).catch((err) => {
      host.log(`read-aloud: could not list voices: ${String(err)}`);
    });
    for (const m of deferredAnnouncements.splice(0)) speech.announce(m, "next");
    if (deferredDropped > 0) {
      speech.announce(
        `${deferredDropped} earlier message${deferredDropped === 1 ? "" : "s"} could not be kept while the voice was starting up.`,
        "next"
      );
      deferredDropped = 0;
    }
    nameSubstitution(resolved.status.reason);
  }).catch((err) => {
    engineError = String(err);
    dashboard?.updateEngine({ state: "failed", name: "unavailable", rung: null, reason: engineError });
    host.log(`read-aloud: engine resolution failed: ${engineError}`);
    host.notify("Read Aloud", `speech engine failed to start: ${engineError}`);
  });
  let speakRequestThisSession = false;
  const flushHeldReport = (s) => {
    const held = settings.takeHeld();
    if (held === null) return false;
    s.announce(`Before that. ${held}`, "next");
    return true;
  };
  const modeAfter = (flushed) => flushed ? "queue" : "replace";
  const withSpeech = async (fn) => {
    if (speech === null) {
      host.notify("Read Aloud", engineError ?? "still starting up, try again in a moment");
      return;
    }
    await fn(speech);
  };
  host.registerCommand("read-aloud.speak-clipboard", async () => {
    speakRequestThisSession = true;
    await withSpeech(async (s) => {
      if (s.isSpeaking) {
        await s.stop();
        return;
      }
      try {
        const { text, truncated } = await readClipboard();
        if (text.trim().length === 0) {
          announce("The clipboard is empty.", "now");
          return;
        }
        s.speak(text, modeAfter(flushHeldReport(s)));
        if (truncated) announce("That clipboard was long, so you heard the first part of it.", "next");
      } catch (err) {
        announce(err instanceof ClipboardUnavailableError ? err.message : `Could not read the clipboard: ${String(err)}`, "now");
      }
    });
  });
  host.registerCommand("read-aloud.self-test", async () => {
    await withSpeech(async (s) => {
      const r = await s.selfTest();
      host.notify("Read Aloud", r.spoken);
      host.log(`read-aloud: self-test chunks=${r.chunks} bytes=${r.bytes} played=${String(r.bytesPlayed)}`);
    });
  });
  host.registerCommand("read-aloud.stop", async () => {
    await withSpeech(async (s) => {
      await s.stop();
    });
  });
  const huddle = new HuddleController({
    speech: {
      // 'queue' is the whole point for huddle: replies must not cut each other off.
      speak: (t, mode, label, sessionId) => {
        speech?.speak(t, mode ?? "queue", label, sessionId);
      },
      stop: async () => {
        await speech?.stop();
      }
    },
    log: host.log,
    // The two-agents ambiguity notice and the session-switch notice both come through here. Both
    // are about WHOSE WORDS the listener is hearing — provenance, the thing 006 ranks S1 — so both
    // belong in the audio stream, not the notification tray.
    notify: (m) => {
      announce(m);
    },
    store: { get: host.storageGet, set: host.storageSet },
    ...options.projectsDir === void 0 ? {} : { projectsDir: options.projectsDir }
  });
  const huddleRestored = huddle.restore();
  void (async () => {
    const huddleOn = await huddleRestored.catch(() => false);
    const outcome = await loadSettings(
      {
        readInbox: (path) => readFile9(path, "utf8"),
        mirrorGet: () => host.settingsGet(),
        log: host.log
      },
      settingsPath,
      { huddleOn, speakRequestThisSession }
    );
    settings.adopt(outcome);
    settings.setReport(outcome.sentence);
    host.log(
      `read-aloud: settings loaded from ${outcome.source} (revision ${outcome.snapshot.revision}, ${outcome.result.rejected.length} rejected, ${outcome.result.unknownFields.length} unknown) at ${outcome.path}`
    );
    if (outcome.mirrorable) void host.settingsSet(settings.mirrorRecord());
    if (outcome.sentence === null) return;
    switch (outcome.destination) {
      case "speak-now":
        announce(outcome.sentence, "next");
        break;
      case "hold-for-first-utterance":
        settings.hold();
        host.notify("Read Aloud", outcome.sentence);
        break;
      case "on-request-only":
        host.notify("Read Aloud", outcome.sentence);
        break;
    }
  })();
  void huddleRestored.then((on) => {
    host.log(`read-aloud: huddle mode restored to ${on ? "on" : "off"}`);
    const again = huddle.restoredAnnouncement();
    if (again !== null) announce(again, "next");
  }).catch((err) => {
    announce(`Huddle mode could not be restored: ${String(err)}. Press the huddle key to turn it on.`);
  });
  host.registerCommand("read-aloud.toggle-huddle", () => {
    const on = huddle.toggle();
    announce(`Huddle mode ${on ? "on" : "off"}.`, "now");
  });
  host.registerCommand("read-aloud.status", async () => {
    await withSpeech((s) => {
      const parts = [];
      parts.push(huddle.enabled ? "Huddle mode is on." : "Huddle mode is off.");
      const following = huddle.following;
      if (following !== null) parts.push(`Following ${sessionLabel(following)}.`);
      const now = s.nowReading;
      if (now !== null) parts.push(`Now reading ${now}.`);
      if (s.queued > 0) parts.push(`${s.queued} more waiting.`);
      else if (now === null) parts.push("Nothing is being read.");
      parts.push(settings.statusClause(Date.now()));
      const report = settings.report;
      if (report !== null) parts.push(report);
      settings.takeHeld();
      s.announce(parts.join(" "), "now");
    });
  });
  host.registerCommand("read-aloud.skip", async () => {
    await withSpeech(async (s) => {
      await s.skip();
    });
  });
  host.registerCommand("read-aloud.unfollow", () => {
    huddle.unlock();
    announce("Stopped following that session.", "now");
  });
  host.registerCommand("read-aloud.follow", async () => {
    const file = await huddle.followNewest();
    if (file === null) {
      announce("No agent transcript to follow in this worktree yet.", "now");
      return;
    }
    if (!huddle.enabled) announce("Huddle mode is off, so replies will not be spoken yet.", "next");
  });
  host.registerCommand("read-aloud.speak-last-reply", async () => {
    speakRequestThisSession = true;
    await withSpeech(async (s) => {
      const text = await huddle.lastReply();
      if (text === null) {
        announce("There is no agent reply to read yet.", "now");
        return;
      }
      s.speak(text, modeAfter(flushHeldReport(s)));
    });
  });
  let malformedEvents = 0;
  let announcedMalformed = false;
  host.onEvent("agent.status.changed", (payload) => {
    const status = asAgentStatus(payload);
    if (status === null) {
      malformedEvents++;
      if (malformedEvents >= 3 && !announcedMalformed) {
        announcedMalformed = true;
        announce("Huddle is not recognising this version of Orca\u2019s agent events, so replies may not be spoken.");
      }
      return;
    }
    huddle.onAgentStatus(status, worktreePathFrom(status.worktreeId));
  });
  const n = host.registeredCommands();
  if (n < EXPECTED_COMMANDS) {
    host.log(`read-aloud: WARNING only ${n}/${EXPECTED_COMMANDS} commands registered \u2014 host API mismatch?`);
  }
  host.log(`read-aloud: ready (${n} commands)`);
}
export {
  activate as default,
  PocketModelUnavailableError,
  PocketSynthProvider
};
