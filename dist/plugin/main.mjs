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
var OsSynthUnavailableError = class extends Error {
  constructor(platform, tried) {
    super(`No OS speech synthesizer found on ${platform}. Tried: ${tried.join(", ")}`);
    this.name = "OsSynthUnavailableError";
  }
};
var OsSynthTimeoutError = class extends Error {
  constructor(cmd, ms) {
    super(`${cmd} did not finish within ${ms} ms and was killed`);
    this.name = "OsSynthTimeoutError";
  }
};
var OsSynthProvider = class {
  id = "os-synth";
  displayName = "System voice";
  capabilities = CAPABILITIES;
  #platform;
  #timeoutMs;
  #warm = false;
  #child = null;
  #cancelled = false;
  constructor(opts = {}) {
    this.#platform = opts.platform ?? process.platform;
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS;
  }
  get isWarm() {
    return this.#warm;
  }
  async prepare() {
    if (this.#warm) return;
    await this.listVoices();
    this.#warm = true;
  }
  cancel() {
    this.#cancelled = true;
    const c = this.#child;
    this.#child = null;
    if (c !== null && c.exitCode === null) c.kill("SIGKILL");
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
          await this.#capture("espeak-ng", ["--version"]);
          return ["default"];
        }
      }
    } catch {
      return [];
    }
  }
  async *generate(text, opts = {}) {
    this.#cancelled = false;
    if (text.trim().length === 0) return;
    const dir = await mkdtemp(join(tmpdir(), "orca-tts-"));
    const wav = join(dir, "out.wav");
    try {
      try {
        await this.#synthesizeToFile(text, wav, opts);
      } catch (err) {
        if (err instanceof OsSynthTimeoutError) return;
        throw err;
      }
      if (this.#cancelled || opts.signal?.aborted === true) return;
      const data = await readFile(wav).catch(() => null);
      if (data === null || data.length === 0) return;
      yield { data: new Uint8Array(data), format: "wav", sampleRate: CAPABILITIES.sampleRate, channels: 1 };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => void 0);
    }
  }
  #command(text, outFile, opts) {
    switch (this.#platform) {
      case "darwin": {
        const args = ["-o", outFile, "--data-format=LEI16@22050"];
        if (opts.voice !== void 0) args.push("-v", opts.voice);
        if (opts.rate !== void 0) args.push("-r", String(Math.round(opts.rate * 175)));
        args.push(text);
        return { cmd: "say", args };
      }
      case "win32": {
        const esc = (s) => s.replace(/'/g, "''");
        const rate = opts.rate === void 0 ? 0 : Math.max(-10, Math.min(10, Math.round((opts.rate - 1) * 10)));
        const voice = opts.voice === void 0 ? "" : `$s.SelectVoice('${esc(opts.voice)}'); `;
        const ps = "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; " + voice + `$s.Rate = ${rate}; $s.SetOutputToWaveFile('${esc(outFile)}'); $s.Speak('${esc(text)}'); $s.Dispose()`;
        return { cmd: "powershell", args: ["-NoProfile", "-NonInteractive", "-STA", "-Command", ps] };
      }
      case "linux": {
        const args = ["-w", outFile];
        if (opts.voice !== void 0) args.push("-v", opts.voice);
        args.push(text);
        return { cmd: "espeak-ng", args };
      }
    }
  }
  async #synthesizeToFile(text, outFile, opts) {
    const { cmd, args } = this.#command(text, outFile, opts);
    await new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(cmd, args, { stdio: "ignore" });
      } catch (err) {
        reject(new OsSynthUnavailableError(this.#platform, [cmd]));
        void err;
        return;
      }
      this.#child = child;
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
        reject(new OsSynthTimeoutError(cmd, this.#timeoutMs));
      }, this.#timeoutMs);
      const settle = (fn) => {
        clearTimeout(timer);
        fn();
      };
      child.on("error", () => settle(() => reject(new OsSynthUnavailableError(this.#platform, [cmd]))));
      child.on("close", () => settle(() => {
        this.#child = null;
        resolve();
      }));
      opts.signal?.addEventListener("abort", () => this.cancel(), { once: true });
    });
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
      child.stdout?.on("data", (d) => {
        out += d.toString("utf8");
      });
      child.on("error", () => settle(() => reject(new OsSynthUnavailableError(this.#platform, [cmd]))));
      child.on("close", (code) => settle(() => {
        if (code === 0) resolve(out);
        else reject(new OsSynthUnavailableError(this.#platform, [cmd]));
      }));
    });
  }
};

// packages/providers/src/registry.ts
var ProviderRegistry = class {
  #providers = /* @__PURE__ */ new Map();
  #preferredId = null;
  register(p, opts = {}) {
    this.#providers.set(p.id, p);
    if (opts.preferred === true) this.#preferredId = p.id;
  }
  get(id) {
    return this.#providers.get(id);
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
    const seen = /* @__PURE__ */ new Set();
    let rung = "preferred";
    for (const id of tryOrder) {
      if (seen.has(id)) continue;
      seen.add(id);
      const p = this.#providers.get(id);
      if (p === void 0) {
        rung = "fallback";
        continue;
      }
      try {
        await p.prepare();
      } catch (err) {
        rung = "fallback";
        void err;
        continue;
      }
      const reason = rung === "preferred" ? void 0 : `${requestedId ?? this.#preferredId ?? "preferred engine"} was unavailable; using ${p.displayName}`;
      return { provider: p, status: reason === void 0 ? { providerId: p.id, rung } : { providerId: p.id, rung, reason } };
    }
    return null;
  }
};

// packages/plugin/src/adapter/index.ts
function makeHost(ctx) {
  const o = ctx.orca ?? {};
  const safe = (fn, fallback) => (...args) => {
    try {
      return fn === void 0 ? fallback : fn(...args);
    } catch {
      return fallback;
    }
  };
  return {
    log: safe(o.log?.bind(o), void 0),
    notify: safe(o.notify?.bind(o) ?? o.log?.bind(o), void 0),
    storageGet: safe(o.storageGet?.bind(o), Promise.resolve(void 0)),
    storageSet: safe(o.storageSet?.bind(o), Promise.resolve()),
    onEvent: safe(o.onEvent?.bind(o), void 0),
    registerCommand: safe(o.registerCommand?.bind(o), void 0)
  };
}
function asAgentStatus(payload) {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload;
  if (typeof p["paneKey"] !== "string" || typeof p["state"] !== "string") return null;
  return {
    worktreeId: typeof p["worktreeId"] === "string" ? p["worktreeId"] : null,
    paneKey: p["paneKey"],
    state: p["state"],
    receivedAt: typeof p["receivedAt"] === "number" ? p["receivedAt"] : 0
  };
}
function worktreePathFrom(worktreeId) {
  if (worktreeId === null) return null;
  const sep = worktreeId.indexOf("::");
  const path = sep === -1 ? worktreeId : worktreeId.slice(sep + 2);
  return path.length > 0 ? path : null;
}

// packages/plugin/src/clipboard.ts
import { spawn as spawn2 } from "node:child_process";
var ClipboardUnavailableError = class extends Error {
  constructor(platform, tried) {
    super(`Could not read the clipboard on ${platform}. Tried: ${tried.join(", ")}`);
    this.name = "ClipboardUnavailableError";
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
      reject(new Error(cmd));
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
    child.stdout?.on("data", (d) => {
      out += d.toString("utf8");
    });
    child.on("error", () => settle(() => reject(new Error(cmd))));
    child.on("close", (code) => settle(() => code === 0 ? resolve(out) : reject(new Error(cmd))));
  });
}
var DEFAULT_MAX_CHARS = 2e4;
var DEFAULT_CLIPBOARD_TIMEOUT_MS = 2e4;
async function readClipboard(opts = {}) {
  const platform = opts.platform ?? process.platform;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CLIPBOARD_TIMEOUT_MS;
  const candidates = CANDIDATES[platform] ?? [];
  const tried = [];
  for (const c of candidates) {
    tried.push(c.cmd);
    try {
      const raw = await capture(c.cmd, c.args, timeoutMs);
      if (raw.length <= maxChars) return { text: raw, truncated: false };
      return { text: raw.slice(0, maxChars), truncated: true };
    } catch {
      continue;
    }
  }
  throw new ClipboardUnavailableError(platform, tried);
}

// packages/core/src/normalizer/index.ts
var CODE_PLACEHOLDER = " code block omitted ";
var LINK_PLACEHOLDER = "link omitted";
function normalize(md, opts = {}) {
  const codeBlocks = opts.codeBlocks ?? "announce";
  const pathStyle = opts.pathStyle ?? "basename";
  const doNumbers = opts.expandNumbers ?? true;
  let s = stripFencedCode(md, codeBlocks);
  s = stripInlineCode(s);
  s = expandMarkdownLinks(s);
  s = stripUrls(s);
  s = headingsToPauses(s);
  s = listItemsToSentences(s);
  s = tablesToRows(s);
  if (pathStyle === "basename") s = speakFilePaths(s);
  s = stripMarkdownMarkers(s);
  s = stripEmoji(s);
  if (doNumbers) s = expandNumbers(s);
  s = collapseWhitespace(s);
  return s.length <= 1 ? "" : s;
}
function isFence(line) {
  const t = line.trimStart();
  return t.startsWith("```") || t.startsWith("~~~");
}
function stripFencedCode(src, policy) {
  const out = [];
  const lines = src.split("\n");
  let inFence = false;
  let announced = false;
  for (const line of lines) {
    if (isFence(line)) {
      if (!inFence) {
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
    if (!inFence) out.push(line);
  }
  void announced;
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
          out += src.slice(i + 1, close);
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
      out += LINK_PLACEHOLDER;
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
function listMarkerLength(t) {
  if (t.startsWith("- ") || t.startsWith("* ") || t.startsWith("+ ")) return 2;
  let k = 0;
  while (k < t.length && t[k] >= "0" && t[k] <= "9") k++;
  if (k > 0 && t[k] === "." && t[k + 1] === " ") return k + 2;
  return 0;
}
function listItemsToSentences(src) {
  return src.split("\n").map((line) => {
    const t = line.trimStart();
    const n = listMarkerLength(t);
    return n === 0 ? line : endWithStop(t.slice(n));
  }).join("\n");
}
function isTableSeparator(cells) {
  return cells.every((c) => c.length > 0 && /^[:\-\s]+$/.test(c));
}
function tablesToRows(src) {
  const out = [];
  for (const line of src.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|")) {
      out.push(line);
      continue;
    }
    const cells = t.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (isTableSeparator(cells)) continue;
    out.push(endWithStop(cells.filter((c) => c.length > 0).join(", ")));
  }
  return out.join("\n");
}
var WORD_BREAK = /* @__PURE__ */ new Set([" ", "\n", "	"]);
function speakFilePaths(src) {
  const tokens = [];
  let cur = "";
  for (const ch of src) {
    if (WORD_BREAK.has(ch)) {
      tokens.push(cur, ch);
      cur = "";
    } else cur += ch;
  }
  tokens.push(cur);
  return tokens.map((tok) => {
    if (tok.length === 0 || WORD_BREAK.has(tok)) return tok;
    if (!tok.includes("/")) return tok;
    const slash = tok.lastIndexOf("/");
    const base = tok.slice(slash + 1);
    const dir = tok.slice(0, slash);
    if (base.length === 0 || dir.length === 0) return tok;
    if (!base.includes(".")) return tok;
    return `${base} in ${dir}`;
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
function numberToWords(n) {
  if (n < 1e3) return under1000(n);
  const th = Math.floor(n / 1e3);
  const r = n % 1e3;
  const head = `${under1000(th)} thousand`;
  return r === 0 ? head : `${head} ${under1000(r)}`;
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
function expandNumbers(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (!isDigit(src[i])) {
      out += src[i];
      i++;
      continue;
    }
    let j = i;
    while (isDigit(src[j])) j++;
    const digits = src.slice(i, j);
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
      out += digits;
      i = j;
      continue;
    }
    const value = Number(digits);
    if (value >= 1e6 || digits.length > 6) {
      out += digits;
      i = j;
      continue;
    }
    out += numberToWords(value);
    i = j;
  }
  return out;
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
var SENTENCE_END = /* @__PURE__ */ new Set([".", "!", "?"]);
var CLAUSE_END = /* @__PURE__ */ new Set([",", ";", ":", "\u2014", "\u2013"]);
var CLOSERS = /* @__PURE__ */ new Set([")", "]", "}", '"', "'", "\u201D", "\u2019"]);
var SPACE = /* @__PURE__ */ new Set([" ", "\n", "	", "\r"]);
var ABBREVIATIONS = /* @__PURE__ */ new Set([
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
    let lastWord = -1;
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
          if (cut <= buf.length && this.#countUnits(buf.slice(0, cut)) <= this.#maxUnits) {
            if (firstSentence === -1) firstSentence = cut;
            lastSentence = cut;
            if (wantEarliestSentence && this.#complete(cut, final)) break;
          }
        }
      } else if (CLAUSE_END.has(ch)) {
        const cut = this.#absorbSpaces(i + 1);
        if (this.#countUnits(buf.slice(0, cut)) <= this.#maxUnits) lastClause = cut;
      } else if (SPACE.has(ch)) {
        const cut = this.#absorbSpaces(i);
        if (cut > 0 && this.#countUnits(buf.slice(0, cut)) <= this.#maxUnits) lastWord = cut;
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
    if (lastWord > 0) return { index: lastWord, kind: "word" };
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
  #skipClosers(from) {
    let i = from;
    while (i < this.#buffer.length && CLOSERS.has(this.#buffer[i])) i++;
    return i;
  }
  #absorbSpaces(from) {
    let i = from;
    while (i < this.#buffer.length && SPACE.has(this.#buffer[i])) i++;
    return i;
  }
  /** Is the '.' at `dot` a real sentence end, given the next non-closer is at `after`? */
  #isSentenceEnd(dot, after) {
    const buf = this.#buffer;
    if (buf[dot] !== ".") return true;
    if (isDigit2(buf[after])) return false;
    let start = dot;
    while (start > 0 && !SPACE.has(buf[start - 1])) start--;
    const token = buf.slice(start, dot).toLowerCase();
    if (ABBREVIATIONS.has(token)) return false;
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
    this.#deps.cancelSynthesis();
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

// packages/plugin/src/speech-service.ts
var SpeechService = class {
  #deps;
  #queue;
  #chunker;
  constructor(deps) {
    this.#deps = deps;
    this.#queue = new PlaybackQueue({
      sink: deps.sink,
      cancelSynthesis: () => {
        deps.provider.cancel();
      }
    });
    this.#chunker = this.#newChunker();
  }
  #newChunker() {
    const opts = {};
    if (this.#deps.maxUnits !== void 0) opts.maxUnits = this.#deps.maxUnits;
    return new Chunker(opts);
  }
  get isSpeaking() {
    return this.#queue.depth > 0 || this.#deps.sink.isPlaying;
  }
  /** Speak a complete string. Returns as soon as the first chunk is queued. */
  speak(text) {
    const generation = this.#queue.begin();
    this.#chunker = this.#newChunker();
    const done = this.#run(generation, text);
    return { generation, done };
  }
  /** Two-sided stop: cancels synthesis AND flushes queued audio (R022). */
  async stop() {
    await this.#queue.bargeIn();
    this.#chunker = this.#newChunker();
  }
  async #run(generation, text) {
    const spoken = normalize(text, this.#deps.normalizeOptions ?? {});
    if (spoken.length === 0) {
      this.#deps.log?.("nothing speakable in that text");
      return;
    }
    const chunks = [...this.#chunker.addText(spoken), ...this.#chunker.finish()];
    for (const chunk of chunks) {
      if (generation !== this.#queue.generation) return;
      try {
        for await (const audio of this.#deps.provider.generate(chunk.text)) {
          if (!this.#queue.push(generation, audio)) return;
        }
      } catch (err) {
        this.#deps.log?.(`synthesis failed: ${String(err)}`);
        return;
      }
    }
  }
};

// packages/plugin/src/sinks/subprocess-sink.ts
import { spawn as spawn3 } from "node:child_process";
import { mkdtemp as mkdtemp2, writeFile, rm as rm2 } from "node:fs/promises";
import { tmpdir as tmpdir2 } from "node:os";
import { join as join2 } from "node:path";
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
var SubprocessSink = class {
  #platform;
  #log;
  #child = null;
  #playing = false;
  constructor(opts = {}) {
    this.#platform = opts.platform ?? process.platform;
    this.#log = opts.log ?? (() => {
    });
  }
  get isPlaying() {
    return this.#playing;
  }
  async enqueue(chunk) {
    const dir = await mkdtemp2(join2(tmpdir2(), "orca-tts-play-"));
    const file = join2(dir, `chunk.${chunk.format === "wav" ? "wav" : "bin"}`);
    await writeFile(file, chunk.data);
    try {
      await this.#play(file);
    } finally {
      await rm2(dir, { recursive: true, force: true }).catch(() => void 0);
    }
  }
  async stop() {
    const c = this.#child;
    this.#child = null;
    this.#playing = false;
    if (c !== null && c.exitCode === null) c.kill("SIGKILL");
  }
  async #play(file) {
    const players = PLAYERS[this.#platform] ?? [];
    for (const p of players) {
      const ok = await new Promise((resolve) => {
        let child;
        try {
          child = spawn3(p.cmd, p.args(file), { stdio: "ignore" });
        } catch {
          resolve(false);
          return;
        }
        this.#child = child;
        this.#playing = true;
        child.on("error", () => {
          this.#playing = false;
          resolve(false);
        });
        child.on("close", () => {
          this.#playing = false;
          this.#child = null;
          resolve(true);
        });
      });
      if (ok) return;
    }
    this.#log(`read-aloud: no audio player found on ${this.#platform}`);
  }
};

// packages/plugin/src/huddle/index.ts
import { readFile as readFile2, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join as join3 } from "node:path";

// packages/plugin/src/huddle/decoders.ts
var isRecord = (v) => typeof v === "object" && v !== null;
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
  const id = typeof rec["uuid"] === "string" ? rec["uuid"] : `${Date.now()}-${parts.length}`;
  return { id, text };
}

// packages/plugin/src/huddle/index.ts
var HuddleController = class {
  #deps;
  #enabled = false;
  #spokenIds = /* @__PURE__ */ new Set();
  #lastReply = null;
  #warnedAmbiguous = false;
  constructor(deps) {
    this.#deps = deps;
  }
  get enabled() {
    return this.#enabled;
  }
  toggle() {
    this.#enabled = !this.#enabled;
    if (!this.#enabled) void this.#deps.speech.stop();
    return this.#enabled;
  }
  async lastReply() {
    if (this.#lastReply !== null) return this.#lastReply;
    const file = await this.#newestTranscript(null);
    if (file === null) return null;
    const replies = await this.#readReplies(file);
    const last = replies[replies.length - 1];
    return last?.text ?? null;
  }
  /** Called on every `agent.status.changed`. Speaks on the working -> done edge. */
  onAgentStatus(status, worktreePath) {
    if (status.state !== "done") return;
    void this.#speakNewReplies(worktreePath);
  }
  async #speakNewReplies(worktreePath) {
    const file = await this.#newestTranscript(worktreePath);
    if (file === null) return;
    const replies = await this.#readReplies(file);
    const fresh = replies.filter((r) => !this.#spokenIds.has(r.id));
    for (const r of fresh) this.#spokenIds.add(r.id);
    const last = fresh[fresh.length - 1];
    if (last === void 0) return;
    this.#lastReply = last.text;
    if (this.#enabled) this.#deps.speech.speak(last.text);
  }
  #projectsRoot() {
    return this.#deps.projectsDir ?? join3(homedir(), ".claude", "projects");
  }
  /**
   * Most-recently-modified transcript under the worktree's project slug.
   * This is the heuristic. If two transcripts were touched within a few seconds of each other we
   * cannot tell which agent spoke, so we warn once and decline to guess.
   */
  async #newestTranscript(worktreePath) {
    const root = this.#projectsRoot();
    let dirs;
    try {
      dirs = await readdir(root);
    } catch {
      return null;
    }
    const slug = worktreePath === null ? null : worktreePath.replace(/[/\\:]/g, "-");
    const candidates = slug === null ? dirs : dirs.filter((d) => d === slug || d.endsWith(slug) || slug.endsWith(d));
    const search = candidates.length > 0 ? candidates : dirs;
    const files = [];
    for (const d of search) {
      let entries;
      try {
        entries = await readdir(join3(root, d));
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.endsWith(".jsonl")) continue;
        const p = join3(root, d, e);
        try {
          files.push({ path: p, mtime: (await stat(p)).mtimeMs });
        } catch {
          continue;
        }
      }
    }
    if (files.length === 0) return null;
    files.sort((a, b) => b.mtime - a.mtime);
    const first = files[0];
    const second = files[1];
    if (first !== void 0 && second !== void 0 && first.mtime - second.mtime < 2e3) {
      if (!this.#warnedAmbiguous) {
        this.#warnedAmbiguous = true;
        this.#deps.notify(
          'Read Aloud: two agents are active in this worktree, so huddle mode cannot tell which one replied. Speaking the most recent \u2014 use "speak last reply" if it picks the wrong one.'
        );
      }
    }
    return first?.path ?? null;
  }
  async #readReplies(file) {
    let raw;
    try {
      raw = await readFile2(file, "utf8");
    } catch {
      return [];
    }
    const out = [];
    for (const line of raw.split("\n")) {
      if (line.trim().length === 0) continue;
      const decoded = decodeClaudeLine(line);
      if (decoded !== null) out.push(decoded);
    }
    return out;
  }
};

// packages/plugin/src/main.ts
async function activate(ctx) {
  const host = makeHost(ctx);
  host.log("read-aloud: activating");
  const registry = new ProviderRegistry();
  registry.register(new OsSynthProvider(), { preferred: true });
  const resolved = await registry.resolve();
  if (resolved === null) {
    host.notify("Read Aloud: no speech engine is available on this system.");
    host.log("read-aloud: no provider resolved; commands will report rather than stay silent");
    return;
  }
  if (resolved.status.reason !== void 0) host.notify(`Read Aloud: ${resolved.status.reason}`);
  const sink = new SubprocessSink({ log: host.log });
  const speech = new SpeechService({ provider: resolved.provider, sink, log: host.log });
  const speakOrExplain = async (text, emptyMessage) => {
    if (text.trim().length === 0) {
      host.notify(emptyMessage);
      return;
    }
    speech.speak(text);
  };
  host.registerCommand("read-aloud.speak-clipboard", async () => {
    if (speech.isSpeaking) {
      await speech.stop();
      return;
    }
    try {
      const { text, truncated } = await readClipboard();
      if (truncated) host.notify("Read Aloud: clipboard was long; reading the first part.");
      await speakOrExplain(text, "Read Aloud: the clipboard is empty.");
    } catch (err) {
      if (err instanceof ClipboardUnavailableError) host.notify(`Read Aloud: ${err.message}`);
      else host.notify("Read Aloud: could not read the clipboard.");
    }
  });
  host.registerCommand("read-aloud.stop", async () => {
    await speech.stop();
  });
  const huddle = new HuddleController({
    speech,
    log: host.log,
    notify: host.notify,
    onUnsupportedAgent: (name) => {
      host.notify(`Read Aloud: huddle mode does not support ${name} \u2014 it has no transcript format we can read.`);
    }
  });
  host.registerCommand("read-aloud.toggle-huddle", () => {
    const on = huddle.toggle();
    host.notify(`Read Aloud: huddle mode ${on ? "on" : "off"}`);
  });
  host.registerCommand("read-aloud.speak-last-reply", async () => {
    const text = await huddle.lastReply();
    await speakOrExplain(text ?? "", "Read Aloud: no agent reply to read yet.");
  });
  host.onEvent("agent.status.changed", (payload) => {
    const status = asAgentStatus(payload);
    if (status === null) return;
    huddle.onAgentStatus(status, worktreePathFrom(status.worktreeId));
  });
  host.log("read-aloud: ready");
}
export {
  activate as default
};
