#!/usr/bin/env node
/**
 * bench-lab-gate — measure Gate M11 (FR-020) as FR-020 defines it, not as it is convenient.
 *
 * WHY THIS EXISTS. `specs/002-voice-lab/spec.md` FR-020 states the gate precisely:
 *
 *   t0 = the `timeStamp` of the DOM keyboard event that requested audio.
 *   t1 = the wall-clock instant of the first audible sample of the affected audio, derived from
 *        the `AudioContext` time at which the first `AudioBufferSourceNode` for the changed text
 *        actually starts, converted to the same clock as t0.
 *   <= 2,000 ms at p95 over 20 consecutive trials. First audio, never complete audio.
 *
 * Until this script existed the gate was ASSERTED. The page's own status bar shows a number, but
 * it is NOT this number: `setTiming()` in `voice-lab/index.html` measures
 * `performance.now()` taken at the top of `speak()` (not the key event) to the moment
 * `scheduleBuffers()` RETURNS (not the moment a source starts). It therefore omits the key-event
 * to `speak()` leg entirely and omits the 20 ms scheduling lead plus device latency at the other
 * end. It is a useful indicator; it is not the gate. This script measures the gate.
 *
 * ------------------------------------------------------------------ THE ROUTE, AND WHAT IT COSTS
 *
 * t1 lives in a browser; the harness is Node. Three routes were available (see
 * `docs/.research/m11-gate.md` for the full argument):
 *
 *   (a) instrument `voice-lab/index.html` so the page records its own t0/t1 — highest fidelity,
 *       but this job may not edit `voice-lab/`, and a permanent gate hook in the page is a design
 *       decision that belongs to whoever owns that file. Reported as a FINDING instead.
 *   (b) drive a real browser headlessly — chosen. See below.
 *   (c) compose server-side and decode-side components measured separately — cheapest, but the
 *       composition would be `[derived]` and would silently omit exactly the legs nobody has
 *       measured (event dispatch, decodeAudioData, the AudioContext construction on first press).
 *
 * ROUTE (b) IS TAKEN, WITH THE INSTRUMENTATION INJECTED FROM OUTSIDE. Chrome is driven over the
 * DevTools Protocol with no dependency beyond Node's built-in `WebSocket` (Node >= 22). The page
 * on disk is never modified: `Page.addScriptToEvaluateOnNewDocument` installs the probe into the
 * page's own world before its module runs, so `voice-lab/index.html` is measured exactly as it
 * ships. Keys are dispatched with `Input.dispatchKeyEvent`, which produces genuine trusted
 * `KeyboardEvent`s carrying a real `timeStamp` on the page's own `performance` clock — the same
 * clock `AudioContext.getOutputTimestamp().performanceTime` reports on. So t0 and t1 are read from
 * one clock without conversion arithmetic of our own.
 *
 * FIDELITY COST, STATED RATHER THAN GLOSSED:
 *   - The audio device is NOT opened (see SILENCE below), so `outputLatency` is the fake output's
 *     figure and not CoreAudio's. MEASURED, not assumed: the same page and the same probe with
 *     `--disable-audio-output` removed report `outputLatency` 24.0 ms against 16.0 ms here — so
 *     this route understates the true first-sample instant by about 8 ms against a 2,000 ms gate,
 *     and the indicator is one that demonstrably moves. Both latencies are recorded per trial.
 *   - Headless Chrome is not the author's browser. Decode and scheduling are the same Blink/WebAudio
 *     code; window compositing and tab throttling are not exercised.
 *   - The scheduling lead (`scheduleBuffers` starts at `currentTime + 0.02`) IS included, because
 *     FR-020 asks for the instant the source starts, and that is when it starts.
 *
 * ------------------------------------------------------------------------------------- SILENCE
 *
 * P31 IS A HARD CONSTRAINT AND THIS SCRIPT MAKES NO SOUND. The author is at this machine and was
 * interrupted today by a benchmark that played tones. Four independent mechanisms, any one of
 * which is sufficient:
 *   1. `--headless=new`
 *   2. `--mute-audio`
 *   3. `--disable-audio-output` — Chromium's `switches::kDisableAudioOutput`, which selects a fake
 *      audio manager, so CoreAudio is never reached at all.
 *   4. the injected probe rewires every `connect(ctx.destination)` through a `GainNode` pinned at
 *      gain 0. This costs nothing in timing (a gain node does not delay scheduling) and means that
 *      even a Chrome that ignored all three flags would emit silence. The page's earcons go through
 *      this too — they are `OscillatorNode`s and they are the tones P31 names.
 * There is no `--audible` mode here and there must not be one: nothing in this measurement needs
 * to be heard.
 *
 * ------------------------------------------------------------------------------------ RUN IT
 *
 *   node scripts/bench-lab-gate.mjs                 human-readable
 *   node scripts/bench-lab-gate.mjs --json          machine-readable, full raw arrays
 *   node scripts/bench-lab-gate.mjs --trials=20     default 20, per FR-020
 *   node scripts/bench-lab-gate.mjs --no-stream     FR-026's negative control: streaming OFF
 *
 * NOT A CI GATE, for the same reason `bench-latency.mjs` is not: absolute latency is machine- and
 * OS-dependent by more than the differences we care about, and CI has no synthesizer on two of the
 * three platforms. Run it manually, record the machine and the SHA beside the number.
 *
 * WHAT IT CANNOT COVER. Stated, not skipped:
 *   - The instant a sample leaves the DAC. Unobservable from userland without a loopback capture
 *     device (`bench-latency.mjs` header says the same thing about the Node side).
 *   - Any control that is not `wired` (FR-016). 36 of the 46 controls change no bytes today, so
 *     "change a control, hear the difference" is only exercisable on the other 10.
 *   - The `spoke-elsewhere` rung (FR-028), where the lab never receives bytes and the gate is
 *     declared not-applicable rather than measured.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { createLabServer, assertLoadedModuleIsOnDiskSource } from './voice-lab.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const JSON_OUT = process.argv.includes('--json')
const TRIALS = Number(process.argv.find((a) => a.startsWith('--trials='))?.slice(9) ?? 20)
const GATE_MS = 2000
/**
 * FR-026: run the SAME harness with first-chunk streaming disabled and watch the reading exceed
 * 2,000 ms. Before FR-024 landed this control was unrunnable — the shipped path WAS the disabled
 * path (`docs/.research/m11-gate.md` finding G-4). It is a flag, not a code edit, so the two
 * readings come from one binary on one machine minutes apart.
 */
const NO_STREAM = process.argv.includes('--no-stream')

/* ------------------------------------------------------------------------------ small helpers */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function stats (xs) {
  if (xs.length === 0) return null
  const s = xs.toSorted((a, b) => a - b)
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]
  const mean = s.reduce((a, b) => a + b, 0) / s.length
  return { n: s.length, min: s[0], p50: q(0.5), p95: q(0.95), max: s[s.length - 1], mean }
}

const RESULTS = []
const record = (r) => { RESULTS.push(r); if (!JSON_OUT) printRow(r) }
const notRun = (id, label, reason) =>
  record({ id, label, status: 'NOT-RUN', label_kind: 'not-run', reason })

function printRow (r) {
  if (r.status === 'NOT-RUN') {
    console.log(`  ${r.id.padEnd(26)} NOT-RUN  — ${r.reason}`)
    return
  }
  if (r.status === 'OK' || r.status === 'VIOLATION') {
    // A count, not a duration. Printing it in the millisecond columns would be a lie of format.
    console.log(`  ${r.id.padEnd(26)} ${r.status.padEnd(10)} [${r.label_kind}]`)
    console.log(`  ${' '.repeat(26)} ${r.label}`)
    return
  }
  const s = r.stats
  const verdict = r.gate === undefined ? '' : (r.gate ? '  PASS' : '  ** FAIL **')
  console.log(
    `  ${r.id.padEnd(26)} n=${String(s.n).padStart(3)}  ` +
    `min ${s.min.toFixed(0).padStart(6)}  p50 ${s.p50.toFixed(0).padStart(6)}  ` +
    `p95 ${s.p95.toFixed(0).padStart(6)}  max ${s.max.toFixed(0).padStart(6)} ms` +
    `  [${r.label_kind}]${verdict}`)
  console.log(`  ${' '.repeat(26)} ${r.label}`)
}

/** Every probe this script claims to run. A probe is never silently omitted (bench-latency's rule). */
const PROBE_IDS = [
  'fixture.as-committed', 'gate.cold.short', 'gate.cold.longest', 'gate.warm.replay',
  'gate.arrow.speak-on-change', 'cachehit.zero-network', 'cachekey.stale-hit',
  'component.server.synth'
]

/** Trials for the long-fixture negative control. It is ~23 s per trial; 20 would be 8 minutes. */
const LONG_TRIALS = Number(process.argv.find((a) => a.startsWith('--long-trials='))?.slice(14) ?? 5)

/* --------------------------------------------------------------- the smallest possible CDP client */

class Cdp {
  constructor (ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? null)})`))
        else resolve(msg.result)
      }
    })
  }

  static async connect (url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error(`could not open a DevTools socket at ${url}`)), { once: true })
    })
    return new Cdp(ws)
  }

  send (method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  /** Evaluate in the page and return the JS value. Throws on a page-side exception. */
  async evaluate (expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true
    })
    if (r.exceptionDetails) {
      throw new Error('page-side error: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
    }
    return r.result.value
  }

  close () { try { this.ws.close() } catch { /* already gone */ } }
}

/* --------------------------------------------------------------------- the injected instrument */

/**
 * Installed with `Page.addScriptToEvaluateOnNewDocument`, so it runs BEFORE the page's module.
 * It records t0 and t1 and it silences the graph. It changes no timing:
 *   - the keydown listener is passive bookkeeping in the capture phase;
 *   - `createBufferSource` is wrapped, and the wrapper reads two clocks before delegating;
 *   - the gain node is inserted between source and destination, which the Web Audio spec renders
 *     in the same quantum. It moves no `start()` time.
 */
const PROBE_SOURCE = String.raw`
(() => {
  const g = { keys: [], starts: [], contexts: 0, fetches: 0, errors: [] };
  window.__gate = g;
  // FR-026's negative control. Set by --no-stream, read by the page's streamSpeak(): the request
  // carries { stream: false } and the server answers ONE envelope, so nothing plays until the last
  // chunk has been synthesized — the behaviour that measured p95 3,401 ms before FR-024 landed.
  window.__labNoStream = __NO_STREAM__;

  addEventListener('keydown', (e) => {
    // e.timeStamp is on the document's performance clock — the same clock
    // AudioContext.getOutputTimestamp().performanceTime uses. No conversion of ours.
    g.keys.push({ key: e.key, timeStamp: e.timeStamp, perfNow: performance.now(), trusted: e.isTrusted });
  }, true);

  // Count network calls to /speak, so a claimed cache hit can be shown to have made none.
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const u = String(typeof input === 'string' ? input : (input && input.url) || '');
      if (u.includes('/speak')) g.fetches++;
    } catch (err) { g.errors.push(String(err)); }
    return origFetch.apply(this, arguments);
  };

  const AC = window.AudioContext || window.webkitAudioContext;

  // (4) Silence, belt-and-braces. See the header: nothing may make a sound on this machine.
  const origConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    try {
      const ctx = this.context;
      if (ctx && dest === ctx.destination) {
        if (!ctx.__gateMute) {
          const mute = ctx.createGain();
          mute.gain.value = 0;
          origConnect.call(mute, ctx.destination);
          ctx.__gateMute = mute;
        }
        origConnect.call(this, ctx.__gateMute);
        return dest;   // preserve chaining: a.connect(b).connect(c)
      }
    } catch (err) { g.errors.push('connect: ' + String(err)); }
    return origConnect.call(this, dest, ...rest);
  };

  const origCreate = AC.prototype.createBufferSource;
  AC.prototype.createBufferSource = function () {
    const ctx = this;
    const src = origCreate.call(this);
    const origStart = src.start.bind(src);
    src.start = function (when, ...rest) {
      try {
        const w = (when === undefined ? ctx.currentTime : when);
        // Convert the AudioContext clock to the performance clock. getOutputTimestamp() is the
        // spec's own correspondence between the two; if it is not yet meaningful (contextTime 0
        // before the first render quantum) fall back to currentTime/now taken back to back.
        const ot = ctx.getOutputTimestamp();
        const usable = ot && ot.contextTime > 0 && ot.performanceTime > 0;
        const refCtx = usable ? ot.contextTime : ctx.currentTime;
        const refPerf = usable ? ot.performanceTime : performance.now();
        g.starts.push({
          startsAtPerf: refPerf + (w - refCtx) * 1000,
          when: w,
          ctxCurrentTime: ctx.currentTime,
          perfNow: performance.now(),
          usedOutputTimestamp: Boolean(usable),
          duration: src.buffer ? src.buffer.duration : null,
          baseLatency: ctx.baseLatency ?? null,
          outputLatency: ctx.outputLatency ?? null,
          sampleRate: ctx.sampleRate
        });
      } catch (err) { g.errors.push('start: ' + String(err)); }
      return origStart(when, ...rest);
    };
    return src;
  };

  const OrigCtor = AC;
  const Wrapped = function (...a) { g.contexts++; return new OrigCtor(...a); };
  Wrapped.prototype = OrigCtor.prototype;
  window.AudioContext = Wrapped;
  if (window.webkitAudioContext) window.webkitAudioContext = Wrapped;
})();
`

/* ------------------------------------------------------------------------- launching the pieces */

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
]

function findChrome () {
  const override = process.env.CHROME_PATH
  if (override && existsSync(override)) return override
  return CHROME_CANDIDATES.find((p) => existsSync(p)) ?? null
}

/**
 * The lab server, in-process, pointed at a TEMP fixture directory and a TEMP settings file.
 *
 * WHY A TEMP FIXTURE DIRECTORY, stated up front because it is the largest caveat in this run:
 * every one of the six committed fixtures opens with an HTML comment, and on macOS a chunk whose
 * text begins with `-` (the comment's own `-->`) is handed to `say` as an OPTION, so the fixture
 * cannot be spoken at all. `fixture.as-committed` measures that and reports it. To have any gate
 * distribution to report, the gate series run against the same fixture BODIES with the leading
 * HTML comment removed — the text a listener would have heard if the comment were speakable.
 * The committed files are never modified; the temp copies live under a mkdtemp directory.
 *
 * WHY A TEMP SETTINGS FILE: the real inbox is the author's own
 * `~/Library/Application Support/orca-tts/settings.jsonc`. A benchmark does not write there.
 */
async function startServer (port, fixtureDir, settingsPath) {
  const proof = await assertLoadedModuleIsOnDiskSource(join(ROOT, 'fixtures'))
  const server = createLabServer({ fixtureDir, settingsPath })
  await new Promise((ok) => server.listen(port, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${server.address().port}`
  const fixtures = (await (await fetch(base + '/fixtures')).json()).fixtures
  return { server, base, fixtures, proof, child: null }
}

/** Copy the committed fixtures into a temp dir: each one verbatim, and each one comment-stripped. */
async function makeFixtureDir (dir) {
  await mkdir(dir, { recursive: true })
  const src = join(ROOT, 'fixtures')
  const names = (await readdir(src)).filter((f) => f.endsWith('.md'))
  const made = []
  for (const name of names) {
    const text = await readFile(join(src, name), 'utf8')
    await writeFile(join(dir, name), text)
    const stripped = text.replace(/<!--[\s\S]*?-->/g, '').trim() + '\n'
    await writeFile(join(dir, basename(name, '.md') + SPEAKABLE_SUFFIX + '.md'), stripped)
    made.push(name)
  }
  return made
}

const SPEAKABLE_SUFFIX = '-speakable'

async function startChrome (userDataDir) {
  const bin = findChrome()
  if (bin === null) return { bin: null }
  const child = spawn(bin, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    // Silence — P31. Three of the four mechanisms; the fourth is inside PROBE_SOURCE.
    '--mute-audio',
    '--disable-audio-output',
    // A page that must be clicked before it may make audio cannot be measured; this does not make
    // it audible (see above), it only removes the gesture requirement.
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--disable-default-apps',
    '--disable-component-update', '--metrics-recording-only', '--no-pings',
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let err = ''
  child.stderr.on('data', (b) => { err += b })
  const portFile = join(userDataDir, 'DevToolsActivePort')
  for (let i = 0; i < 200; i++) {
    try {
      const txt = await readFile(portFile, 'utf8')
      const port = Number(txt.split('\n')[0])
      if (Number.isFinite(port) && port > 0) return { bin, child, port }
    } catch { /* not written yet */ }
    await sleep(100)
  }
  child.kill('SIGKILL')
  throw new Error('Chrome never wrote DevToolsActivePort:\n' + err)
}

async function attachToPage (devtoolsPort) {
  for (let i = 0; i < 100; i++) {
    const r = await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)
    const targets = await r.json()
    const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    if (page) return await Cdp.connect(page.webSocketDebuggerUrl)
    await sleep(100)
  }
  throw new Error('no page target appeared in Chrome')
}

/* ----------------------------------------------------------------------------- driving the page */

const KEYS = {
  space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
  right: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  stop: { key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, text: 's' },
  mute: { key: 'm', code: 'KeyM', windowsVirtualKeyCode: 77, text: 'm' }
}

async function press (cdp, spec) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...spec })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: spec.key, code: spec.code, windowsVirtualKeyCode: spec.windowsVirtualKeyCode })
}

/** Wait until the page's own probe has recorded a new BufferSource start, or give up. */
async function waitForStart (cdp, sinceStarts, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const n = await cdp.evaluate('window.__gate.starts.length')
    if (n > sinceStarts) return true
    await sleep(20)
  }
  return false
}

/**
 * One trial. Snapshot the probe, press the key, wait for the first source of the affected audio,
 * and return t1 - t0 from the page's own two clocks.
 */
async function trial (cdp, keySpec) {
  const before = await cdp.evaluate('({ k: window.__gate.keys.length, s: window.__gate.starts.length, f: window.__gate.fetches })')
  await press(cdp, keySpec)
  const arrived = await waitForStart(cdp, before.s)
  if (!arrived) return { ok: false, reason: 'no AudioBufferSourceNode started within 20 s' }
  const after = await cdp.evaluate(`(() => {
    const g = window.__gate;
    return { key: g.keys[${before.k}] ?? null, start: g.starts[${before.s}] ?? null, fetches: g.fetches - ${before.f} };
  })()`)
  if (!after.key || !after.start) return { ok: false, reason: 'the probe recorded no key or no start for this trial' }
  return {
    ok: true,
    ms: after.start.startsAtPerf - after.key.timeStamp,
    t0: after.key.timeStamp,
    t1: after.start.startsAtPerf,
    trustedEvent: after.key.trusted,
    speakRequests: after.fetches,
    outputLatencyMs: after.start.outputLatency === null ? null : after.start.outputLatency * 1000,
    baseLatencyMs: after.start.baseLatency === null ? null : after.start.baseLatency * 1000,
    usedOutputTimestamp: after.start.usedOutputTimestamp
  }
}

async function settle (cdp) {
  // Stop anything still playing and let the page's own debounced work (persist, renormalize)
  // finish, so a trial measures a press and not a leftover.
  await press(cdp, KEYS.stop)
  await sleep(250)
}

/* ---------------------------------------------------------------------------------------- main */

async function main () {
  if (!JSON_OUT) {
    console.log('')
    console.log(NO_STREAM
      ? '  bench-lab-gate — FR-026 NEGATIVE CONTROL: first-chunk streaming DISABLED.'
      : '  bench-lab-gate — Gate M11 / FR-020, measured. Streaming ON (FR-024).')
    console.log('  Silent: headless, muted,')
    console.log('  audio output disabled, and every destination connection routed through gain 0.')
    console.log('')
  }

  const chromeProbe = findChrome()
  if (chromeProbe === null) {
    for (const id of PROBE_IDS) {
      notRun(id, 'gate probe', 'no Chrome/Chromium/Edge binary was found. Set CHROME_PATH. ' +
        'The gate cannot be measured without a browser: t1 is defined on an AudioContext.')
    }
    return report(null)
  }

  const dir = await mkdtemp(join(tmpdir(), 'orca-tts-labgate-'))
  const port = 7900 + Math.floor(Math.random() * 90)
  let server = null
  let chrome = null
  let cdp = null
  const meta = { streaming: !NO_STREAM }

  try {
    const fixtureDir = join(dir, 'fixtures')
    await makeFixtureDir(fixtureDir)
    server = await startServer(port, fixtureDir, join(dir, 'settings.jsonc'))
    meta.normalizerSource = server.proof.source
    chrome = await startChrome(join(dir, 'chrome'))
    cdp = await attachToPage(chrome.port)

    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE_SOURCE.replace('__NO_STREAM__', String(NO_STREAM)) })
    await cdp.send('Page.navigate', { url: server.base + '/' })

    // The page is ready when its own start() has finished: the status line says so and the
    // control rows exist. Presses before that would be measuring the boot, not the gate.
    for (let i = 0; i < 300; i++) {
      const ready = await cdp.evaluate(
        `Boolean(document.querySelector('.row[data-control]')) && ` +
        `(document.getElementById('status')?.textContent ?? '').startsWith('Ready')`)
      if (ready) break
      await sleep(100)
    }
    const ready = await cdp.evaluate(`(document.getElementById('status')?.textContent ?? '')`)
    if (!ready.startsWith('Ready')) throw new Error(`the page never became ready; status was: ${ready}`)

    meta.platform = await cdp.evaluate('navigator.platform')
    meta.userAgent = await cdp.evaluate('navigator.userAgent')
    meta.probeErrors = await cdp.evaluate('window.__gate.errors')

    // Speak-on-change off: a confirmation utterance racing a trial's Space press would make the
    // measurement a measurement of two overlapping things.
    await press(cdp, KEYS.mute)
    await sleep(2500)
    await settle(cdp)

    // Focus `voice.rate`. It is `wired` (FR-012), it participates in the cache key (KEYED_FIELDS),
    // and it has 31 steps — so 20 consecutive right-arrows give 20 genuinely distinct cache keys
    // and therefore 20 genuine cache MISSES, which is the case the gate is at risk on.
    const focused = await focusControl(cdp, 'voice.rate')
    if (!focused) throw new Error('could not focus voice.rate')

    /* ---- 0. can a COMMITTED fixture be spoken at all? ------------------------------------ */
    await asCommittedProbe(cdp, server.fixtures)

    /* ---- 1. cold / cache miss, on the SHORT fixture -------------------------------------- */
    await selectFixture(cdp, 'short' + SPEAKABLE_SUFFIX + '.md')
    const shortFixture = 'short' + SPEAKABLE_SUFFIX + '.md'
    await staleHitProbe(cdp, shortFixture)
    const cold = await coldSeries(cdp, TRIALS, shortFixture)
    reportSeries('gate.cold.short', cold,
      'COLD (cache miss) — the short.md BODY (2 chunks), one right-arrow on `voice.rate` (a new ' +
      'cache key), then Space. t0 = the Space keydown, t1 = the first AudioBufferSourceNode start. ' +
      'This is the shortest committed fixture: the most favourable cold case that exists.')

    /* ---- 2. warm / cache hit ------------------------------------------------------------- */
    const warm = await warmSeries(cdp, TRIALS)
    reportSeries('gate.warm.replay', warm,
      'WARM (cache hit) — the same text and the same synthesize options, replayed from the ' +
      'page\'s decoded AudioBuffer cache. Design 004 claims this is ~0 ms.')

    const hitFetches = warm.trials.reduce((a, t) => a + (t.speakRequests ?? 0), 0)
    record({
      id: 'cachehit.zero-network',
      label: `FR-022 control — POST /speak requests issued across ${warm.trials.length} warm trials: ` +
        `${hitFetches}. Any number above zero means the "cache hit" was a round trip.`,
      label_kind: 'measured-here',
      status: hitFetches === 0 ? 'OK' : 'VIOLATION',
      stats: { n: warm.trials.length, min: hitFetches, p50: hitFetches, p95: hitFetches, max: hitFetches, mean: hitFetches },
      raw: warm.trials.map((t) => t.speakRequests)
    })

    /* ---- 3. the arrow-key variant of t0 (speak-on-change ON) ------------------------------ */
    const arrow = await arrowSeries(cdp, TRIALS)
    reportSeries('gate.arrow.speak-on-change', arrow,
      'ARROW variant of t0 — speak-on-change ON, t0 = the right-arrow that changed the value, ' +
      't1 = first audio of the spoken confirmation. This is the other t0 FR-020 admits.')

    /* ---- 4. cold on the LONGEST fixture — FR-026's negative control ----------------------- */
    const longest = pickLongest(server.fixtures)
    await selectFixture(cdp, longest)
    await focusControl(cdp, 'voice.rate')
    const coldLong = await coldSeries(cdp, LONG_TRIALS, longest)
    reportSeries('gate.cold.longest', coldLong,
      `COLD (cache miss) — the ${longest} BODY, a long multi-sentence fixture (n=${LONG_TRIALS}: ` +
      'each trial takes tens of seconds). ' +
      'The server returns every chunk in one envelope (`scripts/voice-lab.mjs` `chunks: out`), so ' +
      'this is FR-026\'s no-streaming case and it is the shipped path, not a disabled one.')

    /* ---- 5. the server-side component, for attribution ------------------------------------ */
    const synthMs = await serverComponent(cdp, TRIALS)
    if (synthMs.length > 0) {
      record({
        id: 'component.server.synth',
        label: 'COMPONENT — the server\'s own reported `timings.synthMs` for the same cold calls: ' +
          'how much of the cold reading is `OsSynthProvider.generate()` and how much is everything else.',
        label_kind: 'measured-here', stats: stats(synthMs), raw: synthMs
      })
    } else {
      notRun('component.server.synth', 'server synthesis component', 'no cold trial reported timings')
    }

    meta.probeErrorsAfter = await cdp.evaluate('window.__gate.errors')
    meta.contexts = await cdp.evaluate('window.__gate.contexts')
    meta.latency = await cdp.evaluate(
      // The LAST start, not the first: outputLatency reads 0 until the context has rendered its
      // first quantum, so reading it at the first start would report a zero that means "too early"
      // rather than "no device".
      '(() => { const a = window.__gate.starts; const s = a[a.length - 1]; return s ? { baseLatencyMs: s.baseLatency*1000, outputLatencyMs: s.outputLatency*1000, sampleRate: s.sampleRate } : null })()')
  } finally {
    cdp?.close()
    chrome?.child?.kill('SIGKILL')
    server?.server?.close()
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  report(meta)
}

/* ------------------------------------------------------------------------------ the four series */

/**
 * The cold series.
 *
 * A right-arrow on `voice.rate` is the control change, exactly as a listener would make it. It
 * does NOT by itself force a cache miss: `state.chunkKeysFor` is keyed by TEXT ONLY, so the page
 * finds the previous rate's keys, finds those buffers present, and replays the OLD audio — see
 * `cachekey.stale-hit`, which measures that directly. So the fixture is reselected as well, which
 * runs the page's own `loadFixture()` and clears the decoded cache. Without that step 19 of 20
 * "cold" trials would be 40 ms cache hits and the cold distribution would be a fiction.
 */
async function coldSeries (cdp, n, fixture) {
  const trials = []
  for (let i = 0; i < n; i++) {
    await settle(cdp)
    await press(cdp, KEYS.right)          // the control change: a listener turning `voice.rate`
    await sleep(200)                      // the page's debounced persist/renormalize, not measured
    await selectFixture(cdp, fixture)     // clears the page cache, so the next press is truly cold
    await focusControl(cdp, 'voice.rate')
    const t = await trial(cdp, KEYS.space)
    trials.push(t)
  }
  return { trials, ms: trials.filter((t) => t.ok).map((t) => t.ms) }
}

/**
 * FR-023's probe, run as a named check rather than inferred from the cold numbers.
 * Three presses, and the third is the control case without which this could not fail:
 *   1. prime  — Space on fresh text. MUST issue a POST /speak.
 *   2. change — right-arrow on `voice.rate` (a `wired` synthesize control), then Space.
 *               MUST issue a POST /speak, because the bytes must change.
 *   3. text   — reload the fixture (new cache state), then Space. MUST issue a POST /speak.
 * If 2 issues none while 1 and 3 do, the page served audio synthesized at the OLD rate for a
 * control the listener just changed. That is the stale hit FR-023 exists to forbid, and the
 * listener reads it as "that control does nothing" — a taste result that is really a cache bug.
 */
const req = (t) => (t.ok ? t.speakRequests : null)

async function staleHitProbe (cdp, fixture) {
  await settle(cdp)
  await selectFixture(cdp, fixture)
  await focusControl(cdp, 'voice.rate')
  const prime = await trial(cdp, KEYS.space)

  await settle(cdp)
  await press(cdp, KEYS.right)
  await sleep(300)
  const afterChange = await trial(cdp, KEYS.space)

  await settle(cdp)
  await selectFixture(cdp, fixture)
  await focusControl(cdp, 'voice.rate')
  const afterReload = await trial(cdp, KEYS.space)

  const stale = req(afterChange) === 0 && req(prime) > 0 && req(afterReload) > 0
  record({
    id: 'cachekey.stale-hit',
    label: 'FR-023 — POST /speak requests for: [prime, after changing `voice.rate`, after ' +
      `reloading the fixture] = [${req(prime)}, ${req(afterChange)}, ${req(afterReload)}]. ` +
      (stale
        ? 'ZERO after a changed `voice.rate` while the control case issued one: the page replayed ' +
          'audio synthesized at the OLD rate. `state.chunkKeysFor` is keyed by text only.'
        : 'The changed control produced a fresh synthesis.') +
      ` Elapsed after the change: ${afterChange.ok ? afterChange.ms.toFixed(0) + ' ms' : 'n/a'}.`,
    label_kind: 'measured-here',
    status: stale ? 'VIOLATION' : 'OK',
    stats: { n: 3, min: 0, p50: 0, p95: 0, max: 0, mean: 0 },
    raw: { prime: req(prime), afterChange: req(afterChange), afterReload: req(afterReload),
           msAfterChange: afterChange.ok ? +afterChange.ms.toFixed(1) : null }
  })
}

async function warmSeries (cdp, n) {
  // Prime: one cold play of the current text at the current options, so the buffers exist.
  await settle(cdp)
  await trial(cdp, KEYS.space)
  const trials = []
  for (let i = 0; i < n; i++) {
    await settle(cdp)                     // stop, so Space is a play and not a pause
    const t = await trial(cdp, KEYS.space)
    trials.push(t)
  }
  return { trials, ms: trials.filter((t) => t.ok).map((t) => t.ms) }
}

async function arrowSeries (cdp, n) {
  await settle(cdp)
  await press(cdp, KEYS.mute)             // speak-on-change back ON
  await sleep(2500)
  await settle(cdp)
  // Always the SAME direction, from the bottom of the range. Alternating left/right revisits a
  // value the page has already spoken, so the confirmation comes back out of the buffer cache and
  // the series silently becomes a mix of cold and warm readings.
  for (let i = 0; i < 40; i++) await press(cdp, KEYS.left)   // clamp `voice.rate` to its minimum
  await sleep(500)
  await settle(cdp)
  const trials = []
  for (let i = 0; i < n; i++) {
    await settle(cdp)
    const t = await trial(cdp, KEYS.right)
    trials.push(t)
    await sleep(200)
  }
  await settle(cdp)
  await press(cdp, KEYS.mute)             // and off again
  await sleep(2500)
  await settle(cdp)
  return { trials, ms: trials.filter((t) => t.ok).map((t) => t.ms) }
}

/** The server reports its own synthesis time; read it out of the page's status line contract.
 *  `stream: false` here on purpose: this probe wants ONE number for a whole sentence, and
 *  `res.json()` cannot parse the NDJSON stream FR-024 added. Same for `asCommittedProbe` below. */
async function serverComponent (cdp, n) {
  const out = []
  for (let i = 0; i < n; i++) {
    const r = await cdp.evaluate(`(async () => {
      const res = await fetch('/speak', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'The quick brown fox jumps over the lazy dog.', options: { synthesize: { rate: ${1 + i * 0.01} } }, stream: false }) });
      const j = await res.json();
      return j && j.timings ? j.timings.synthMs : null;
    })()`)
    if (typeof r === 'number') out.push(r)
  }
  return out
}

/* ------------------------------------------------------------------------------ page navigation */

async function focusControl (cdp, id) {
  return await cdp.evaluate(`(() => {
    const row = document.querySelector('.row[data-control=' + JSON.stringify(${JSON.stringify(id)}) + ']');
    if (row) { row.click(); return true; }
    // The control's panel is closed: open every panel head until the row appears.
    for (const head of document.querySelectorAll('.panel .head')) {
      head.click();
      const r = document.querySelector('.row[data-control=' + JSON.stringify(${JSON.stringify(id)}) + ']');
      if (r) { r.click(); return true; }
    }
    return false;
  })()`)
}

async function selectFixture (cdp, name) {
  await cdp.evaluate(`(() => {
    const sel = document.getElementById('fixture');
    sel.value = ${JSON.stringify(name)};
    sel.dispatchEvent(new Event('change'));
    return sel.value;
  })()`)
  await sleep(600)
}

function pickLongest (fixtures) {
  // paths.md is the highest-value fixture and 13 chunks; architecture.md is 23 chunks and would
  // make one trial take most of a minute. Both miss the gate by an order of magnitude.
  for (const want of ['paths', 'architecture', 'code-heavy']) {
    const n = want + SPEAKABLE_SUFFIX + '.md'
    if (fixtures.includes(n)) return n
  }
  return fixtures[0]
}

/**
 * FR-020 is stated over "every committed fixture". Before measuring a distribution, establish
 * whether a committed fixture can produce audio at all. This asks the page, through the page's
 * own `POST /speak`, using the committed file verbatim.
 */
async function asCommittedProbe (cdp, fixtures) {
  const committed = fixtures.filter((f) => !f.includes(SPEAKABLE_SUFFIX))
  const outcomes = []
  for (const name of committed) {
    const r = await cdp.evaluate(`(async () => {
      const text = await (await fetch('/fixtures/' + encodeURIComponent(${JSON.stringify(name)}))).text();
      const res = await fetch('/speak', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, options: {}, stream: false }) });
      const j = await res.json().catch(() => null);
      return { status: res.status, chunks: (j && j.chunkCount) ?? null, message: (j && j.message) ?? null };
    })()`)
    outcomes.push({ fixture: name, ...r })
  }
  const bad = outcomes.filter((o) => o.status !== 200)
  record({
    id: 'fixture.as-committed',
    label: `COMMITTED FIXTURES, played verbatim through POST /speak: ${committed.length - bad.length} of ` +
      `${committed.length} produced audio. ${bad.length ? 'First failure: ' + bad[0].fixture + ' — ' + String(bad[0].message).slice(0, 120) : ''}`,
    label_kind: 'measured-here',
    status: bad.length === 0 ? 'OK' : 'VIOLATION',
    stats: { n: committed.length, min: bad.length, p50: bad.length, p95: bad.length, max: bad.length, mean: bad.length },
    raw: outcomes
  })
}

/* ---------------------------------------------------------------------------------- reporting */

function reportSeries (id, series, label) {
  const failed = series.trials.filter((t) => !t.ok)
  if (series.ms.length === 0) {
    notRun(id, label, `every trial failed: ${failed[0]?.reason ?? 'unknown'}`)
    return
  }
  const s = stats(series.ms)
  record({
    id,
    label: label + (failed.length ? `  [${failed.length} of ${series.trials.length} trials produced no audio: ${failed[0].reason}]` : ''),
    label_kind: 'measured-here',
    stats: s,
    gate: s.p95 <= GATE_MS,
    raw: series.ms.map((x) => +x.toFixed(1)),
    trustedEvents: series.trials.filter((t) => t.ok).every((t) => t.trustedEvent),
    speakRequests: series.trials.map((t) => t.speakRequests ?? null)
  })
}

function report (meta) {
  const reported = new Set(RESULTS.map((r) => r.id))
  const missing = PROBE_IDS.filter((id) => !reported.has(id))

  if (JSON_OUT) {
    console.log(JSON.stringify({
      gateMs: GATE_MS, trials: TRIALS, streaming: !NO_STREAM, node: process.version, meta,
      expected: PROBE_IDS.length, reported: RESULTS.length, missing, results: RESULTS
    }, null, 2))
  } else {
    console.log('')
    for (const r of RESULTS.filter((x) => x.gate !== undefined)) {
      console.log(`  ${r.gate ? 'PASS' : 'FAIL'}  ${r.id.padEnd(26)} p95 ${r.stats.p95.toFixed(0)} ms against the ${GATE_MS} ms gate  (n=${r.stats.n})`)
    }
    console.log('')
    console.log(`  probes expected ${PROBE_IDS.length} · reported ${RESULTS.length}`)
    if (meta?.latency) {
      console.log(`  AudioContext: sampleRate ${meta.latency.sampleRate} · baseLatency ` +
        `${meta.latency.baseLatencyMs?.toFixed(1)} ms · outputLatency ${meta.latency.outputLatencyMs?.toFixed(1)} ms ` +
        '(a FAKE output device. Control case, same page and probe with --disable-audio-output ' +
        'removed: outputLatency 24.0 ms against 16.0 ms here [measured-here] — so the route costs ' +
        'about 8 ms of the 2,000 ms gate, and the indicator is one that can move.)')
    }
    if (meta?.probeErrorsAfter?.length) {
      console.log(`  probe errors: ${meta.probeErrorsAfter.length} — ${meta.probeErrorsAfter[0]}`)
    }
    console.log('')
    console.log('  Not a CI gate. Record the machine and the SHA beside the number.')
    console.log('')
  }

  if (missing.length > 0) {
    console.error(`\nBUG: ${missing.length} probe(s) neither ran nor reported NOT-RUN: ${missing.join(', ')}`)
    process.exitCode = 1
  }
}

await main()
