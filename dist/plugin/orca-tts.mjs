#!/usr/bin/env node
#!/usr/bin/env node

// packages/plugin/src/control/cli.ts
import { watch } from "node:fs";
import { mkdir as mkdir2 } from "node:fs/promises";

// packages/plugin/src/control/dashboard.ts
import { createConnection, createServer } from "node:net";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
var DASHBOARD_FILE = "dashboard.json";
function defaultControlDir(env = process.env, platform = process.platform) {
  if (env["ORCA_TTS_CONTROL_DIR"]) return env["ORCA_TTS_CONTROL_DIR"];
  if (platform === "win32") {
    return join(env["LOCALAPPDATA"] ?? env["APPDATA"] ?? homedir(), "orca-tts", "control");
  }
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "orca-tts", "control");
  return join(env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state"), "orca-tts", "control");
}
async function readDashboardDocument(dir = defaultControlDir()) {
  const value = JSON.parse(await readFile(join(dir, DASHBOARD_FILE), "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("dashboard state is not an object");
  }
  const document = value;
  if (document.status?.version !== 1 || typeof document.control?.endpoint !== "string") {
    throw new Error("dashboard state has an unsupported shape");
  }
  return document;
}
function renderDashboard(status) {
  const lines = [
    `Read Aloud  engine: ${status.engine.name}`,
    "",
    status.nowReading === null ? "NOW READING  nothing" : `NOW READING  ${status.nowReading.sessionLabel}`,
    status.nowReading?.spokenText ?? "",
    status.nowReading === null ? "" : "CURSOR  unavailable on this engine",
    "",
    "[ S ]  STOP",
    "",
    `QUEUE  ${status.queueDepth} waiting`
  ];
  if (status.queue.length === 0) lines.push("  (empty)");
  else status.queue.forEach((item, index) => {
    lines.push(`  ${index + 1}. ${item.sessionLabel}  "${item.textPreview}"`);
  });
  lines.push("", "control: connected");
  return lines.join("\n");
}
var nextCommand = 0;
async function sendControl(document, verb, timeoutMs = 400) {
  const envelope = {
    v: 1,
    id: `c-${process.pid}-${++nextCommand}-${Date.now()}`,
    verb,
    gen: document.status.nowReading?.gen ?? document.status.generation,
    at: Date.now()
  };
  return await new Promise((resolve, reject) => {
    const socket = createConnection(document.control.endpoint);
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("control_unavailable: the plugin did not answer Stop"));
    }, timeoutMs);
    timer.unref?.();
    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(envelope)}
`);
    });
    socket.on("data", (part) => {
      buffer += part;
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      clearTimeout(timer);
      socket.end();
      resolve(JSON.parse(buffer.slice(0, newline)));
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`control_unavailable: Stop could not reach the plugin (${String(err)})`));
    });
  });
}

// packages/plugin/src/control/cli.ts
var unavailable = (reason) => [
  "Read Aloud",
  "",
  "NOW READING  not connected",
  "",
  "[ S ]  STOP  unavailable",
  "",
  "QUEUE  unknown",
  "",
  `control: not connected \u2014 ${reason}`
].join("\n");
var chooseDir = (args) => {
  const at = args.indexOf("--dir");
  return at === -1 ? defaultControlDir() : args[at + 1] ?? defaultControlDir();
};
var readOrNull = async (dir) => await readDashboardDocument(dir).catch(() => null);
var printFrame = (text) => {
  if (process.stdout.isTTY) process.stdout.write("\x1B[2J\x1B[H");
  process.stdout.write(`${text}
`);
};
async function runControl(dir, once) {
  await mkdir2(dir, { recursive: true, mode: 448 });
  let current = await readOrNull(dir);
  printFrame(current === null ? unavailable("the plugin worker has not published state here") : renderDashboard(current.status));
  if (once) return current === null ? 1 : 0;
  let lastFailure = "";
  const redraw = async () => {
    current = await readOrNull(dir);
    const frame = current === null ? unavailable("the plugin worker is not connected") : renderDashboard(current.status) + (lastFailure === "" ? "" : `
${lastFailure}`);
    printFrame(frame);
  };
  const watcher = watch(dir, (_event, name) => {
    if (name === DASHBOARD_FILE) void redraw();
  });
  const input = process.stdin;
  input.setEncoding("utf8");
  input.setRawMode?.(true);
  input.resume();
  input.on("data", (key) => {
    if (key === "" || key === "q") {
      input.setRawMode?.(false);
      input.pause();
      watcher.close();
      process.stdout.write("\n");
      return;
    }
    if (key !== "s" && key !== ".") return;
    void (async () => {
      const document = current ?? await readOrNull(dir);
      if (document === null) {
        lastFailure = "STOP DID NOT REACH THE PLUGIN: no control consumer is connected.";
        process.stdout.write("\x07");
        await redraw();
        return;
      }
      try {
        const response = await sendControl(document, "stop");
        lastFailure = response.ok ? "" : `STOP REFUSED (${response.code}): ${response.message}`;
        if (!response.ok) process.stdout.write("\x07");
      } catch (err) {
        lastFailure = `STOP DID NOT REACH THE PLUGIN: ${String(err)}`;
        process.stdout.write("\x07");
      }
      await redraw();
    })();
  });
  return await new Promise((resolve) => {
    input.on("data", (key) => {
      if (key === "" || key === "q") resolve(0);
    });
  });
}
async function runCli(args = process.argv.slice(2)) {
  const command = args[0] ?? "control";
  const dir = chooseDir(args);
  if (command === "control") return await runControl(dir, args.includes("--once"));
  if (command === "stop") {
    const document = await readOrNull(dir);
    if (document === null) {
      process.stderr.write("STOP DID NOT REACH THE PLUGIN: no control consumer is connected.\n");
      return 1;
    }
    try {
      const response = await sendControl(document, "stop");
      if (!response.ok) {
        process.stderr.write(`STOP REFUSED (${response.code}): ${response.message}
`);
        return 1;
      }
      process.stdout.write(`${response.code}
`);
      return 0;
    } catch (err) {
      process.stderr.write(`STOP DID NOT REACH THE PLUGIN: ${String(err)}
`);
      return 1;
    }
  }
  process.stderr.write("usage: orca-tts control [--dir PATH] [--once] | orca-tts stop [--dir PATH]\n");
  return 2;
}

// scripts/orca-tts.mjs
process.exitCode = await runCli();
