#!/usr/bin/env node
/**
 * The Voice Lab UI probe — the check that was missing when thirteen review rounds passed a page
 * its own user could not operate.
 *
 * `docs/design/020-voice-lab-ux.md` records what he said:
 *
 *   "i cannot edit/configure from the voice lab what's being pronounced and how ... there is no
 *    way for me to change anything here, i can just hear things"
 *   "pressing 'play this stage' in succession makes it speak over itself without a way to stop
 *    anything. the cacophony of the audio was horrible."
 *
 * Every existing test asserted what the page WOULD say. None asserted that a person could change
 * it. So this probe drives the real page in a real browser and asserts by effect:
 *
 *   U1  every control on screen is an operable form element, and none is inert
 *   U2  changing a dropdown changes the spoken text — with a control that restores it
 *   U3  editing the example changes the spoken text — with a no-op control
 *   U4  two plays in succession never overlap: at most one audio source is live at a time
 *   U5  one transform is one continuous, labelled mark
 *   U6  the voice picker exposes both backends, and Play of a Pocket voice is served by Pocket
 *       (INCONCLUSIVE when Pocket is absent — a green fallback is not a neural voice)
 *   U7  an absent Pocket model: a failed download names the error and keeps the OS floor, then a
 *       successful stub download becomes ready without navigation
 *   U8  switching voice cannot replay cached bytes — os→pocket, pocket→os, AND pocket→pocket
 *   U9  provenance follows the backend that completed speech: OS fallback when Pocket cannot,
 *       Pocket when it can. This check plays itself; leftover state from U8 is not evidence.
 *
 * EACH CHECK CAN FAIL, and `--prove` demonstrates it: it re-runs every provable check against a
 * deliberately broken copy of the page and requires them to go red. A check that could not have
 * failed is not a check.
 *
 * TWO ARMS. The default is a hermetic empty model directory, so U7's download button exists and
 * U9 can see the OS fallback. If a Pocket install is on disk (`ORCA_TTS_MODEL_DIR` or
 * `~/.buzz/models/pocket-tts`), a second arm re-runs U6/U8/U9 against it and REQUIRES Pocket to
 * be what spoke. A probe that cannot say "I could not tell" reports acceptable under conditions
 * it never tested — that is R16-05.
 *
 * SILENT — P31, the author is at this machine. Chrome runs headless with `--mute-audio` and
 * `--disable-audio-output`, and the injected probe additionally pins a zero gain node between
 * every source and the destination. Four mechanisms, same as `bench-lab-gate.mjs`.
 *
 * Usage:
 *   node scripts/ui-probe.mjs            # hermetic arm, plus Pocket arm if the model is on disk
 *   node scripts/ui-probe.mjs --prove    # also prove each check can go red
 *   node scripts/ui-probe.mjs --only=U9  # one check (U9 must stand alone; it plays itself)
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir, symlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ the smallest CDP client */

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
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    })
  }

  static async connect (url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error('no DevTools socket at ' + url)), { once: true })
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

  async evaluate (expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) {
      throw new Error('page-side error: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
    }
    return r.result.value
  }

  close () { try { this.ws.close() } catch { /* already gone */ } }
}

/* ------------------------------------------------------------------------- the injected probe */

/**
 * Runs before the page's own module, via `Page.addScriptToEvaluateOnNewDocument`.
 *
 * `live` is the count of AudioBufferSourceNodes that have been started and not yet stopped or
 * ended; `maxLive` is its high-water mark. That is the ONLY thing U4 needs, and it is a property
 * of the audio graph rather than of any function the page happens to call — so a future refactor
 * that overlaps audio a different way still trips it.
 */
const PROBE = String.raw`
(() => {
  const nativeFetch = window.fetch.bind(window);
  const p = {
    live: 0, maxLive: 0, started: 0, errors: [], requests: [], speakHeads: [],
    stubDownload: false, stubDownloadError: false, downloadComplete: false
  };
  window.__ui = p;

  function ndjsonBody (records, onLast) {
    const enc = new TextEncoder();
    return new ReadableStream({
      start (controller) {
        controller.enqueue(enc.encode(JSON.stringify(records[0]) + String.fromCharCode(10)));
        setTimeout(() => controller.enqueue(enc.encode(JSON.stringify(records[1]) + String.fromCharCode(10))), 120);
        setTimeout(() => {
          if (onLast) onLast();
          controller.enqueue(enc.encode(JSON.stringify(records[2]) + String.fromCharCode(10)));
          controller.close();
        }, 520);
      }
    });
  }

  function recordSpeakHead (response) {
    const cloned = response.clone();
    const type = response.headers.get('content-type') || '';
    cloned.text().then((text) => {
      try {
        if (type.includes('ndjson')) {
          for (const line of text.split(String.fromCharCode(10))) {
            if (!line.trim()) continue;
            const rec = JSON.parse(line);
            if (rec.kind === 'head' || rec.backend || rec.degradation) p.speakHeads.push(rec);
          }
        } else if (text) {
          p.speakHeads.push(JSON.parse(text));
        }
      } catch (e) { p.errors.push(String(e)); }
    }).catch((e) => { p.errors.push(String(e)); });
  }

  // PV-042's independent control. The real endpoint is a 173.8 MB network action, so the probe
  // must never press it. When explicitly armed by U7/U8, this substitutes a tiny NDJSON download
  // and makes the NEXT /voices response report the same twelve entries as ready. U7 also arms
  // stubDownloadError to emit kind: 'error' — without that arm, deleting the catch in
  // downloadVoices() cannot turn U7 red. Normal page runs and every other endpoint still reach
  // the real 127.0.0.1 server.
  window.fetch = async function (input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    p.requests.push({ url: url.pathname, method: init.method || 'GET', body: init.body || null });

    if (p.stubDownloadError && url.pathname === '/model/download') {
      const records = [
        { kind: 'start', backend: 'pocket', fileCount: 20, totalBytes: 173764082 },
        { kind: 'progress', backend: 'pocket', file: 'bundle.json', received: 24381, total: 24381, fileIndex: 0, fileCount: 20 },
        { kind: 'error', ok: false, error: 'model_download_failed', backend: 'pocket',
          file: 'bundle.json', name: 'Error', cause: 'injected download failure',
          message: 'injected download failure' }
      ];
      return new Response(ndjsonBody(records), { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
    }

    if (p.stubDownload && url.pathname === '/model/download') {
      const records = [
        { kind: 'start', backend: 'pocket', fileCount: 20, totalBytes: 173764082 },
        { kind: 'progress', backend: 'pocket', file: 'bundle.json', received: 24381, total: 24381, fileIndex: 0, fileCount: 20 },
        { kind: 'complete', ok: true, backend: 'pocket', fileCount: 20, totalBytes: 173764082 }
      ];
      return new Response(ndjsonBody(records, () => { p.downloadComplete = true; }), {
        status: 200, headers: { 'content-type': 'application/x-ndjson' }
      });
    }

    const response = await nativeFetch(input, init);
    if (url.pathname === '/speak') recordSpeakHead(response);
    if (p.stubDownload && p.downloadComplete && url.pathname === '/voices') {
      const json = await response.json();
      json.voices = (json.voices || []).map((voice) => voice.backend === 'pocket'
        ? { ...voice, available: true, reason: null }
        : voice);
      return new Response(JSON.stringify(json), {
        status: response.status,
        headers: { 'content-type': 'application/json' }
      });
    }
    return response;
  };

  const AC = window.AudioContext || window.webkitAudioContext;
  const origConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    try {
      const ctx = this.context;
      if (ctx && dest === ctx.destination) {
        if (!ctx.__mute) { const g = ctx.createGain(); g.gain.value = 0; origConnect.call(g, ctx.destination); ctx.__mute = g; }
        return origConnect.call(this, ctx.__mute, ...rest);
      }
    } catch (e) { p.errors.push(String(e)); }
    return origConnect.call(this, dest, ...rest);
  };

  const wrap = (proto) => {
    const start = proto.start, stop = proto.stop;
    proto.start = function (...a) {
      if (!this.__counted) {
        this.__counted = true;
        p.started++; p.live++; if (p.live > p.maxLive) p.maxLive = p.live;
        // Clamped at zero: a counter reset between checks can leave sources alive that were never
      // counted, and their 'ended' would otherwise drive live negative — which silently pins
      // maxLive at 0 and makes the whole check vacuous. It did, once.
      this.addEventListener('ended', () => { if (this.__counted !== 'done') { this.__counted = 'done'; p.live = Math.max(0, p.live - 1); } });
      }
      return start.apply(this, a);
    };
    proto.stop = function (...a) {
      if (this.__counted === true) { this.__counted = 'done'; p.live = Math.max(0, p.live - 1); }
      return stop.apply(this, a);
    };
  };
  wrap(AudioBufferSourceNode.prototype);
})();
`

/* ------------------------------------------------------------------------------- the processes */

function findChrome () {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean)
  return candidates.find((c) => existsSync(c)) ?? null
}

async function startChrome (userDataDir) {
  const bin = findChrome()
  if (bin === null) return { bin: null }
  const child = spawn(bin, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`,
    '--mute-audio', '--disable-audio-output', '--autoplay-policy=no-user-gesture-required',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--disable-default-apps',
    '--disable-component-update', '--metrics-recording-only', '--no-pings', 'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let err = ''
  child.stderr.on('data', (b) => { err += b })
  for (let i = 0; i < 200; i++) {
    try {
      const port = Number((await readFile(join(userDataDir, 'DevToolsActivePort'), 'utf8')).split('\n')[0])
      if (Number.isFinite(port) && port > 0) return { bin, child, port }
    } catch { /* not written yet */ }
    await sleep(100)
  }
  child.kill('SIGKILL')
  throw new Error('Chrome never wrote DevToolsActivePort:\n' + err)
}

async function attach (devtoolsPort) {
  for (let i = 0; i < 100; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json()
    const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    if (page) return await Cdp.connect(page.webSocketDebuggerUrl)
    await sleep(100)
  }
  throw new Error('no page target appeared')
}

/**
 * The lab, on an EPHEMERAL port, and we read back the port IT says it bound.
 *
 * The first version of this function asked for a fixed port and then polled `/fixtures` until
 * something answered 200. Something did — a Voice Lab left running since the previous evening.
 * The new process died `EADDRINUSE`, the OLD one replied, and four checks failed against a page
 * from before the rewrite while reporting nothing about which program they had reached.
 *
 * That is the same trap that cost the author a session (`PITFALLS` and the EADDRINUSE message in
 * `scripts/voice-lab.mjs`), reproduced by the very script written to prevent regressions. So:
 * `--port 0` lets the OS pick a free one, and the URL is taken from THIS child's own stdout.
 * There is no port for a stranger to be squatting on.
 */
async function startLab (pageDir, modelDir) {
  const child = spawn(process.execPath, [
    join(ROOT, 'scripts/voice-lab.mjs'), '--port', '0', '--page', pageDir
  ], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ORCA_TTS_MODEL_DIR: modelDir }
  })
  let out = ''
  child.stdout.on('data', (b) => { out += b })
  child.stderr.on('data', (b) => { out += b })
  for (let i = 0; i < 300; i++) {
    const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)/)
    if (m) {
      const port = Number(m[1])
      const r = await fetch(`http://127.0.0.1:${port}/fixtures`).catch(() => null)
      if (r && r.ok) return { child, port, out: () => out }
    }
    if (child.exitCode !== null) break
    await sleep(100)
  }
  child.kill('SIGKILL')
  throw new Error('the lab never announced a port it had bound:\n' + out)
}

/* --------------------------------------------------------------------------------- the checks */

const spoken = 'document.getElementById("pane-spoken").textContent.trim()'

/** Which arm is running. Hermetic empty cache is the default; the Pocket arm sets this true. */
let ARM = { pocketInstalled: false }

async function waitUntil (cdp, expr, predicate, timeoutMs = 15000) {
  const t0 = Date.now()
  let last
  while (Date.now() - t0 < timeoutMs) {
    last = await cdp.evaluate(expr)
    if (predicate(last)) return last
    await sleep(120)
  }
  return last
}

async function muteConfirmations (cdp) {
  const muteText = await cdp.evaluate(`document.getElementById('btn-mute').textContent`)
  if (!/on/i.test(muteText)) return
  const beforeMute = await cdp.evaluate('window.__lab.utterances.length')
  await cdp.evaluate(`document.getElementById('btn-mute').click()`)
  await waitUntil(cdp, 'window.__lab.utterances.length', (n) => Number(n) > beforeMute, 30000)
  await cdp.evaluate(`document.getElementById('btn-stop').click()`)
  await waitUntil(cdp, 'window.__ui.live', (n) => Number(n) === 0, 5000)
}

function chooseVoice (cdp, key) {
  return cdp.evaluate(`(() => {
    const s = document.getElementById('ctl-voice.id');
    s.value = ${JSON.stringify(key)};
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return s.value;
  })()`)
}

async function pickerKeys (cdp) {
  return await cdp.evaluate(`(() => {
    const select = document.getElementById('ctl-voice.id');
    const group = (label) => [...select.querySelectorAll('optgroup')].find((g) => g.label === label);
    const values = (g) => g ? [...g.querySelectorAll('option')].map((o) => o.value) : [];
    return {
      os: values(group("This machine's voices")),
      pocket: values(group('Pocket TTS (neural)'))
    };
  })()`)
}

/**
 * Press Play and wait until the utterance is delivered. Captures the /speak REQUEST (what the
 * page asked for) and the /speak HEAD (what the server says actually spoke). Those are different
 * values when Pocket is absent: the request is pocket:anna, the head is os + degradation.
 * Asserting only the request is how U6 passed while the OS was speaking (R16-05).
 */
async function playUntilDone (cdp) {
  // Play toggles pause when something is already flagged as playing. Stop first so this
  // click is always a new utterance, not a pause that never increments the counter.
  await cdp.evaluate(`document.getElementById('btn-stop').click()`)
  await waitUntil(cdp, 'window.__ui.live', (n) => Number(n) === 0, 5000)
  await cdp.evaluate('window.__ui.requests = []; window.__ui.speakHeads = []')
  const before = await cdp.evaluate('window.__lab.utterances.length')
  await cdp.evaluate(`document.getElementById('btn-play').click()`)
  const grew = await waitUntil(cdp, 'window.__lab.utterances.length', (n) => Number(n) > before, 120000)
  if (!(Number(grew) > before)) {
    throw new Error(`Play did not deliver an utterance (still ${grew} after Stop+Play)`)
  }
  await waitUntil(cdp, 'window.__ui.live', (n) => Number(n) === 0, 30000)
  await waitUntil(cdp, 'window.__labEffect().provenance.backend', (v) => v != null, 10000)
  await waitUntil(cdp, 'window.__ui.speakHeads.length', (n) => Number(n) > 0, 10000)
  return JSON.parse(await cdp.evaluate(`JSON.stringify({
    bodies: window.__ui.requests.filter((r) => r.url === '/speak').map((r) => r.body),
    heads: window.__ui.speakHeads,
    replayDisabled: document.getElementById('btn-replay').disabled,
    provenance: window.__labEffect().provenance
  })`))
}

function lastSpeak (snap) {
  const body = snap.bodies.length ? JSON.parse(snap.bodies.at(-1)) : null
  const head = snap.heads.at(-1) ?? null
  const provenance = snap.provenance ?? { footer: '', tunedWith: 'nothing-played-yet', backend: null, reason: null }
  return {
    body, head, provenance,
    requested: body?.options?.synthesize?.voice ?? null,
    served: head?.backend ?? provenance.backend ?? null
  }
}

/**
 * U1 — every control on screen TAKES EFFECT.
 *
 * The first version of this check counted rows and asked whether each held a `<select>` or an
 * `<input>`. It went GREEN against a page rendering all forty-six controls, because after the
 * rewrite even the dead ones render as real form elements — it was measuring shape, and the
 * defect was never about shape. `--prove` caught that, which is what `--prove` is for.
 *
 * So it moves every control and demands a consequence. "A consequence" is either different spoken
 * text or a different set of options heading for the synthesizer, read through `window.__labEffect`.
 * A control that moves neither is precisely the thing the author could not tell from a working
 * one, and it is now the thing that fails the build.
 */
async function u1 (cdp) {
  const ids = await cdp.evaluate(`[...document.querySelectorAll('#controls .row')].map((r) => r.dataset.control)`)
  if (!ids.length) return { pass: false, detail: 'no controls rendered at all' }

  const dead = []
  for (const id of ids) {
    const before = await cdp.evaluate('JSON.stringify(window.__labEffect())')
    // Move it to a value it is not already on. Restoring afterwards is not needed — the next
    // control's baseline is re-read, so each test is independent of the last.
    const moved = await cdp.evaluate(`(() => {
      const row = document.querySelector('.row[data-control="' + CSS.escape(${JSON.stringify(id)}) + '"]');
      const el = row && row.querySelector('select, input');
      if (!el) return 'no input';
      if (el.tagName === 'SELECT') {
        const other = [...el.options].find((o) => o.value !== el.value);
        if (!other) return 'only one option';
        el.value = other.value;
      } else if (el.type === 'checkbox') {
        el.checked = !el.checked;
      } else if (el.type === 'range') {
        const min = Number(el.min), max = Number(el.max), step = Number(el.step) || 1;
        const now = Number(el.value);
        el.value = String(now + step * 4 <= max ? now + step * 4 : min);
      } else {
        el.value = el.value + ' x';
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'moved';
    })()`)
    if (moved !== 'moved') { dead.push(`${id} (${moved})`); continue }

    const after = await waitUntil(cdp, 'JSON.stringify(window.__labEffect())', (s) => s !== before, 12000)
    if (after === before) dead.push(id)
  }

  return {
    pass: dead.length === 0,
    detail: dead.length === 0
      ? `all ${ids.length} controls on screen changed what would be spoken or synthesized`
      : `${dead.length} of ${ids.length} controls changed nothing: ${dead.join(', ')}`
  }
}

/**
 * U2 — a dropdown changes what is spoken.
 *
 * The control is that putting the dropdown BACK restores the text exactly. It restores to whatever
 * the control was on when this check started, not to a value chosen here: U1 runs first and moves
 * every control, so a hard-coded "spoken" was restoring to a state the page had never been in —
 * which failed, correctly, and for a reason that had nothing to do with the page.
 */
async function u2 (cdp) {
  const was = await cdp.evaluate(`(document.getElementById('ctl-path.style') || {}).value ?? null`)
  if (was === null) return { pass: false, detail: 'there is no "how a path is said" control on the page' }
  const before = await cdp.evaluate(spoken)
  const set = (v) => cdp.evaluate(`(() => {
    const s = document.getElementById('ctl-path.style');
    s.value = ${JSON.stringify('')} || ${JSON.stringify(v)};
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return s.value;
  })()`)

  const other = await cdp.evaluate(`[...document.getElementById('ctl-path.style').options].map((o) => o.value).find((v) => v !== ${JSON.stringify(was)})`)
  const applied = await set(other)
  if (applied !== other) return { pass: false, detail: `could not set path.style to ${other}` }
  const after = await waitUntil(cdp, spoken, (t) => t !== before)
  const changed = after !== before

  await set(was)
  const restored = await waitUntil(cdp, spoken, (t) => t === before)
  const backAgain = restored === before

  return {
    pass: changed && backAgain,
    detail: changed
      ? (backAgain
          ? `changed on "${other}" and restored on "${was}"`
          : 'changed, but did NOT restore — the control failed')
      : 'the spoken text did not move at all'
  }
}

/** U3 — editing the example changes what is spoken. The control is a no-op edit. */
async function u3 (cdp) {
  const before = await cdp.evaluate(spoken)
  const type = (t) => cdp.evaluate(`(() => {
    const a = document.getElementById('example-text');
    if (!a) return 'no editor';
    a.value = ${JSON.stringify(t)};
    a.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`)

  const ok = await type('The path is src/core/session_handler.py and it took 1,234,567 ms.')
  if (ok !== 'ok') return { pass: false, detail: ok }
  const after = await waitUntil(cdp, spoken, (t) => t !== before && t.length > 0)
  const changed = after !== before
  const readsPath = /session handler/i.test(after ?? '')

  // The control: setting the SAME text again must leave the spoken pane where it is.
  await type('The path is src/core/session_handler.py and it took 1,234,567 ms.')
  await sleep(700)
  const again = await cdp.evaluate(spoken)
  const stable = again === after

  return {
    pass: changed && readsPath && stable,
    detail: !changed
      ? 'typing changed nothing — the editor is not wired to the pipeline'
      : `spoken text followed the edit${readsPath ? ' and reads the path aloud' : ' but did NOT expand the path'}` +
        `${stable ? '; a repeat edit was stable' : '; a repeat edit moved it, so something else is changing the text'}`
  }
}

/**
 * U4 — two plays in succession never overlap.
 *
 * Driven through the STAGE LADDER, because that is the path he was on: "pressing 'play this stage'
 * in succession makes it speak over itself without a way to stop anything."
 *
 * On the WARM path, deliberately. Three earlier versions of this check were vacuous, always the
 * same shape — the overlap was never reachable, so "no overlap" proved nothing:
 *   1. it pressed the header Play twice, and the second press only PAUSED the first;
 *   2. it waited on a counter a suspended context would never move;
 *   3. it pressed two different stages COLD, and the second spent longer in the synthesizer than
 *      the first took to finish playing, so they could not have overlapped on any page.
 * Warm, the second press starts in about 40 ms, while the first is unmistakably still sounding.
 * That is the only arrangement in which a missing barge-in shows up.
 */
async function u4 (cdp) {
  await cdp.evaluate(`(() => {
    const a = document.getElementById('example-text');
    a.value = [
      '# Heading here', '',
      'The file src/core/session_handler.py took 1,234,567 ms and 42 ms more, which is a while.', '',
      '1. First item with **bold** text and a link to https://example.com/page',
      '2. Second item, also long enough to be worth hearing all the way through, twice over.', ''
    ].join(String.fromCharCode(10));
    a.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await sleep(1200)

  const buttons = await cdp.evaluate(`(() => {
    document.getElementById('btn-explain').click();
    return [...document.querySelectorAll('#ladder-body button')]
      .filter((b) => /play this stage/i.test(b.textContent) && !b.disabled).length;
  })()`)
  if (!buttons) return { pass: false, detail: 'the ladder offered no enabled "play this stage" button' }

  const click = () => cdp.evaluate(`(() => {
    const bs = [...document.querySelectorAll('#ladder-body button')].filter((b) => /play this stage/i.test(b.textContent) && !b.disabled);
    bs[0].click();
    return true;
  })()`)

  // Press once to fill the cache, and wait for the utterance to COMPLETE.
  //
  // "no audio is sounding right now" is not "the utterance finished": on the cold path the gap
  // between two chunks reads as live === 0 while the stream is still open, and pressing again
  // there aborts the fetch, so the cache is never filled and both presses end up cold. That is a
  // race, and it made this check pass or fail on timing rather than on the page. The timing
  // readout is only written when an utterance is delivered, so it is the signal that means done.
  await click()
  await waitUntil(cdp, 'document.getElementById("timing").textContent', (t) => /cold/.test(String(t)), 120000)
  await waitUntil(cdp, 'window.__ui.live', (n) => Number(n) === 0, 120000)

  await cdp.evaluate('window.__ui.live = 0; window.__ui.maxLive = 0; window.__ui.started = 0')

  // Now the pair, warm and fast — exactly the succession he described.
  await click()
  await waitUntil(cdp, 'window.__ui.started', (n) => Number(n) >= 1, 30000)
  const midway = await cdp.evaluate('JSON.stringify({ ui: { live: window.__ui.live, maxLive: window.__ui.maxLive, started: window.__ui.started, errors: window.__ui.errors }, timing: document.getElementById("timing").textContent, status: document.getElementById("status").textContent })')
  await click()
  const after = await cdp.evaluate('JSON.stringify({ ui: { live: window.__ui.live, maxLive: window.__ui.maxLive, started: window.__ui.started, errors: window.__ui.errors }, timing: document.getElementById("timing").textContent, status: document.getElementById("status").textContent })')

  await waitUntil(cdp, 'window.__ui.started', (n) => Number(n) >= 2, 30000)
  await sleep(1200)
  const p = JSON.parse(await cdp.evaluate('JSON.stringify({ live: window.__ui.live, maxLive: window.__ui.maxLive, started: window.__ui.started, errors: window.__ui.errors })'))
  await cdp.evaluate('document.getElementById("ladder-close").click()')

  if (p.started < 2) {
    return { pass: false, detail: `only ${p.started} source(s) started — the second press never played, so nothing was tested` }
  }
  // Warmth is the precondition, not a detail. A cold second press cannot overlap the first,
  // because aborting the fetch already stops it — so a "no overlap" verdict there would be a
  // verdict about the network, not about barge-in. Say so rather than passing.
  if (!/warm/.test(JSON.parse(after).timing ?? '')) {
    return {
      pass: false,
      detail: 'the second press was not served from the cache, so an overlap was never reachable ' +
              `and nothing was tested — press 2: ${after}`
    }
  }
  return {
    pass: p.maxLive <= 1,
    detail: `${p.started} sources started from the stage ladder, at most ${p.maxLive} live at once` +
            (p.maxLive > 1 ? ' — that is the cacophony' : '') +
            `\n         after press 1: ${midway}\n         after press 2: ${after}`
  }
}

/**
 * U5 — one transform is one mark, and the mark says which transform.
 *
 * "make the underline continous for things that are processed from the same phase instead of it
 *  breaking" and "make it indicative which one with a upper [phase/rule number] applies to that
 *  line not just when hovered".
 *
 * Two properties, both structural and both checkable without looking at pixels:
 *   - no two ADJACENT marked runs share a stage. If they did they were one run that got split,
 *     which is exactly the broken underline -- eight marks where the listener made one change.
 *   - every marked run carries a visible `[N]` label IN THE DOCUMENT. A `title` tooltip does not
 *     count: it is invisible to the person deciding whether to look, and on a keyboard or touch
 *     path it may never appear at all.
 */
async function u5 (cdp) {
  const r = await cdp.evaluate(`(() => {
    const marked = [...document.querySelectorAll('#pane-spoken .run.added, #pane-written .run.removed')];
    const untagged = marked.filter((el) => {
      const t = el.querySelector('.tag');
      return !t || !/^\\[\\d+\\]$/.test(t.textContent.trim());
    }).length;
    // Adjacent runs of the same stage, counted over each pane's own children in order.
    let split = 0;
    for (const pane of ['pane-spoken', 'pane-written']) {
      const runs = [...document.getElementById(pane).querySelectorAll(':scope > .run')];
      for (let i = 1; i < runs.length; i++) {
        const a = runs[i - 1], b = runs[i];
        if (a.dataset.stage === b.dataset.stage && a.dataset.kind && a.dataset.kind === b.dataset.kind) split++;
      }
    }
    const skip = marked.length
      ? getComputedStyle(marked[0]).getPropertyValue('text-decoration-skip-ink').trim()
      : '';
    return { marked: marked.length, untagged, split, skip };
  })()`)

  if (!r.marked) return { pass: false, detail: 'nothing in either pane is marked, so nothing was tested' }
  const problems = []
  if (r.untagged) problems.push(`${r.untagged} of ${r.marked} runs carry no visible [n] label`)
  if (r.split) problems.push(`${r.split} pair(s) of adjacent runs share a stage — that underline is broken in two`)
  if (r.skip && r.skip !== 'none') problems.push(`text-decoration-skip-ink is "${r.skip}", so descenders will break the line`)
  return {
    pass: problems.length === 0,
    detail: problems.length === 0
      ? `${r.marked} marked runs, each labelled, none adjacent-and-same-stage, skip-ink off`
      : problems.join('; ')
  }
}

/**
 * U6 — one voice picker, both backends, and Play of a Pocket voice is served by Pocket.
 *
 * Counting optgroups alone would repeat U1's first mistake. Asserting only
 * `__labEffect().speak.synthesize.voice` (the REQUEST) is R16-05: that object moves to
 * pocket:anna while the OS synthesizer is what actually speaks. The discriminating signal is
 * the /speak HEAD's `backend` (and `__labEffect().provenance.backend`, the same value the
 * footer is built from).
 *
 * When Pocket is absent this check is INCONCLUSIVE, not ok. A green fallback is not a neural
 * voice, and reporting it as success is how "all nine UI checks pass" was cited as evidence
 * the picker works.
 */
async function u6 (cdp) {
  const shape = await cdp.evaluate(`(() => {
    const select = document.getElementById('ctl-voice.id');
    if (!select) return { error: 'there is no Which voice control' };
    const groups = [...select.querySelectorAll(':scope > optgroup')].map((g) => ({
      label: g.label,
      options: [...g.querySelectorAll(':scope > option')].map((o) => ({
        value: o.value, disabled: o.disabled, text: o.textContent.trim()
      }))
    }));
    return { groups };
  })()`)
  if (shape.error) return { pass: false, detail: shape.error }

  const machine = shape.groups.find((g) => g.label === "This machine's voices")
  const pocket = shape.groups.find((g) => g.label === 'Pocket TTS (neural)')
  const problems = []
  if (shape.groups.length !== 2) problems.push(`expected exactly 2 optgroups, found ${shape.groups.length}`)
  if (!machine) problems.push(`missing optgroup "This machine's voices"`)
  if (!pocket) problems.push('missing optgroup "Pocket TTS (neural)"')
  if (machine && !machine.options.some((o) => o.value.startsWith('os:'))) {
    problems.push('the machine group has no backend-qualified os:* value')
  }
  if (pocket && !pocket.options.some((o) => o.value.startsWith('pocket:'))) {
    problems.push('the Pocket group has no backend-qualified pocket:* value')
  }
  if (pocket && pocket.options.some((o) => o.disabled)) {
    problems.push('at least one Pocket option is disabled instead of selectable')
  }
  if (problems.length > 0) return { pass: false, detail: problems.join('; ') }

  const osKey = machine.options.find((o) => o.value.startsWith('os:')).value
  const pocketKey = pocket.options.find((o) => o.value.startsWith('pocket:')).value

  const osApplied = await chooseVoice(cdp, osKey)
  const osEffect = await waitUntil(
    cdp,
    'window.__labEffect().speak.synthesize.voice ?? null',
    (v) => v === osKey
  )
  const pocketApplied = await chooseVoice(cdp, pocketKey)
  const pocketEffect = await waitUntil(
    cdp,
    'window.__labEffect().speak.synthesize.voice ?? null',
    (v) => v === pocketKey
  )

  const moved = osApplied === osKey && pocketApplied === pocketKey &&
    osEffect === osKey && pocketEffect === pocketKey && osEffect !== pocketEffect
  if (!moved) {
    return {
      pass: false,
      detail: `the picker moved in the DOM but the request did not follow: os=${osEffect}, pocket=${pocketEffect}`
    }
  }

  await muteConfirmations(cdp)
  await chooseVoice(cdp, pocketKey)
  let snap
  try {
    snap = lastSpeak(await playUntilDone(cdp))
  } catch (err) {
    if (ARM.pocketInstalled) {
      return {
        pass: false,
        inconclusive: true,
        detail: `Pocket was staged but Play delivered nothing: ${err.message ?? err}`
      }
    }
    throw err
  }
  const served = snap.served
  const requested = snap.requested
  const degraded = snap.head?.degradation ?? null
  const recorded = snap.provenance?.backend ?? null

  if (served === 'pocket' && (recorded === 'pocket' || recorded == null) && degraded == null && requested === pocketKey) {
    return {
      pass: true,
      detail: `one picker lists ${machine.options.length} machine and ${pocket.options.length} Pocket voices; Play of ${pocketKey} was served by pocket (head.backend=${served})`
    }
  }
  if (ARM.pocketInstalled && requested === pocketKey && degraded != null) {
    return {
      pass: false,
      inconclusive: true,
      detail: `the picker requested ${pocketKey} but Pocket could not speak (${degraded.code}: ${degraded.reason}). Not evidence the picker is wrong, and not evidence a neural voice was heard.`
    }
  }
  if (ARM.pocketInstalled) {
    return {
      pass: false,
      detail: `Pocket was staged as ready but was not what spoke: ${JSON.stringify({ served, recorded, degraded, requested, pocketKey })}`
    }
  }

  if (served === 'pocket' || recorded === 'pocket') {
    return {
      pass: false,
      detail: `Pocket was ABSENT but provenance claimed it spoke: ${JSON.stringify({ served, recorded, degraded, requested, pocketKey })}`
    }
  }
  return {
    pass: false,
    inconclusive: true,
    detail: `picker lists both backends and the request followed ${osKey} -> ${pocketKey}, but Pocket was ABSENT so Play was served by ${served ?? 'the OS'} (requested ${requested}). This is not evidence a neural voice was heard.`
  }
}

async function ensurePocketReady (cdp) {
  const already = await cdp.evaluate(`(() => {
    const select = document.getElementById('ctl-voice.id');
    const options = [...select.querySelectorAll('optgroup[label="Pocket TTS (neural)"] option')];
    return options.length === 12 && options.every((o) => !/download needed/i.test(o.textContent));
  })()`)
  if (already) return { progressSeen: true }

  await cdp.evaluate(`(() => {
    window.__ui.stubDownload = true;
    document.getElementById('btn-download-voices').click();
    return !!document.getElementById('btn-confirm-download');
  })()`)
  const confirmed = await cdp.evaluate(`(() => {
    const button = document.getElementById('btn-confirm-download');
    if (!button) return false;
    button.click();
    return true;
  })()`)
  if (!confirmed) return { error: 'the download confirmation never appeared' }

  const progressSeen = await waitUntil(cdp, `(() => {
    const p = document.querySelector('#controls progress');
    const status = document.getElementById('voice-status')?.textContent || '';
    return !!p && Number(p.value) > 0 && /File 1 of 20: bundle\\.json/.test(status);
  })()`, (v) => v === true, 5000)
  const ready = await waitUntil(cdp, `(() => {
    const select = document.getElementById('ctl-voice.id');
    const options = [...select.querySelectorAll('optgroup[label="Pocket TTS (neural)"] option')];
    return options.length === 12 && options.every((o) => !/download needed/i.test(o.textContent)) &&
      !document.getElementById('btn-download-voices') && !document.getElementById('btn-confirm-download');
  })()`, (v) => v === true, 10000)
  return { progressSeen, ready }
}

/** U7 — absent voices stay selectable; a failed download names the error and keeps the OS floor; a stubbed success becomes ready without reload. */
async function u7 (cdp) {
  if (ARM.pocketInstalled) {
    const button = await cdp.evaluate(`document.getElementById('btn-download-voices')?.textContent || ''`)
    if (!button) {
      return {
        pass: false,
        inconclusive: true,
        detail: 'Pocket is already installed; the download path was not exercised. Not a pass for U7.'
      }
    }
    return { pass: false, detail: `Pocket was installed but the download button still reads ${JSON.stringify(button)}` }
  }

  const before = await cdp.evaluate(`(() => {
    const group = document.getElementById('ctl-voice.id')
      .querySelector('optgroup[label="Pocket TTS (neural)"]');
    const options = group ? [...group.querySelectorAll('option')] : [];
    return {
      count: options.length,
      disabled: options.filter((o) => o.disabled).length,
      sized: options.filter((o) => /173\\.8 MB/.test(o.textContent)).length,
      button: document.getElementById('btn-download-voices')?.textContent || '',
      selected: document.getElementById('ctl-voice.id')?.value || null,
      navigations: performance.getEntriesByType('navigation').length
    };
  })()`)
  const problems = []
  if (before.count !== 12) problems.push(`expected 12 Pocket voices, found ${before.count}`)
  if (before.disabled !== 0) problems.push(`${before.disabled} Pocket voices were disabled`)
  if (before.sized !== 12) problems.push(`${before.sized} of 12 Pocket labels showed the honest 173.8 MB size`)
  if (!/Download the neural voices \(173\.8 MB\)/.test(before.button)) {
    problems.push('the 173.8 MB download button was missing')
  }
  if (problems.length > 0) return { pass: false, detail: problems.join('; ') }

  // Failed-download arm. R16-05: the stub had no kind:'error', so deleting the catch in
  // downloadVoices() could not turn U7 red. Demand the named error sentence AND that the OS
  // floor still speaks afterwards.
  await cdp.evaluate('window.__ui.stubDownloadError = true')
  const confirmShown = await cdp.evaluate(`(() => {
    document.getElementById('btn-download-voices').click();
    return !!document.getElementById('btn-confirm-download');
  })()`)
  if (!confirmShown) return { pass: false, detail: 'the download confirmation never appeared (error arm)' }
  await cdp.evaluate(`document.getElementById('btn-confirm-download').click()`)
  const errorSentence = await waitUntil(cdp, `(() => ({
    status: document.getElementById('status')?.textContent || '',
    voice: document.getElementById('voice-status')?.textContent || ''
  }))()`, (t) => /Your system voices still work/i.test(t.status + t.voice) && /download stopped/i.test(t.status + t.voice), 10000)
  const errorSeen = errorSentence &&
    /Your system voices still work/i.test(errorSentence.status + errorSentence.voice) &&
    /download stopped/i.test(errorSentence.status + errorSentence.voice)
  await muteConfirmations(cdp)
  const keys = await pickerKeys(cdp)
  const osKey = keys.os[0]
  if (!osKey) return { pass: false, detail: 'no OS voice after a failed download — the floor is gone' }
  await chooseVoice(cdp, osKey)
  const osSnap = lastSpeak(await playUntilDone(cdp))
  const osFloor = osSnap.served === 'os' && osSnap.requested === osKey
  if (!errorSeen || !osFloor) {
    return {
      pass: false,
      detail: `failed-download arm: errorSeen=${errorSeen} osFloor=${osFloor} ${JSON.stringify({ errorSentence, os: { served: osSnap.served, requested: osSnap.requested } })}`
    }
  }

  await cdp.evaluate('window.__ui.stubDownloadError = false')
  const result = await ensurePocketReady(cdp)
  const after = await cdp.evaluate(`(() => ({
    selected: document.getElementById('ctl-voice.id')?.value || null,
    navigations: performance.getEntriesByType('navigation').length,
    ready: [...document.getElementById('ctl-voice.id')
      .querySelectorAll('optgroup[label="Pocket TTS (neural)"] option')]
      .filter((o) => !/download needed/i.test(o.textContent)).length
  }))()`)
  if (result.error) return { pass: false, detail: result.error }
  const pass = result.progressSeen === true && result.ready === true && after.ready === 12 &&
    after.navigations === before.navigations
  return {
    pass,
    detail: pass
      ? 'failed download named the error and kept the OS floor; then 12 voices became ready with no navigation'
      : `download transition failed: ${JSON.stringify({ before, result, after })}`
  }
}

/**
 * U8 — changing voice cannot reach the old voice's cached bytes, in either direction.
 *
 * R16-06: os→pocket was checked; pocket→os was not. A reverse-only cache key (OS voices reuse
 * the last Pocket key) left U8 green. `--prove` used to drop `voice` from KEYED_FIELDS entirely,
 * which breaks both directions and cannot catch a one-way key.
 */
async function u8 (cdp) {
  const ready = await ensurePocketReady(cdp)
  if (ready.error || ready.ready === false) return { pass: false, detail: ready.error ?? 'Pocket voices never became ready' }

  await muteConfirmations(cdp)

  const keys = await pickerKeys(cdp)
  const osKey = keys.os[0]
  const pocketA = keys.pocket[0]
  const pocketB = keys.pocket.find((k) => k !== pocketA)
  if (!osKey || !pocketA || !pocketB) {
    return { pass: false, detail: `need one OS voice and two Pocket voices, got os=${keys.os.length} pocket=${keys.pocket.length}` }
  }

  async function setExample (text) {
    await cdp.evaluate(`(() => {
      const input = document.getElementById('example-text');
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    await sleep(900)
  }

  async function switchAndSpeak (from, to) {
    await chooseVoice(cdp, from)
    // Warming `from` may be a cache hit if we already played it. The property under
    // test is the switch: Play of `to` must miss the cache.
    await playUntilDone(cdp)
    await chooseVoice(cdp, to)
    const replayDisabled = await cdp.evaluate(`document.getElementById('btn-replay').disabled`)
    const snap = lastSpeak(await playUntilDone(cdp))
    return {
      from, to, replayDisabled,
      spoke: snap.body !== null,
      requested: snap.requested
    }
  }

  // Separate sentences so a correct cache of an earlier OS prime cannot satisfy
  // pocket→os. R16-06's reverse mutant is "OS keyed as last Pocket"; a prior
  // os play of the SAME text is a legitimate hit and would hide it.
  await setExample('Cache identity os to pocket.')
  const fwd = await switchAndSpeak(osKey, pocketA)
  await setExample('Cache identity pocket to os.')
  const rev = await switchAndSpeak(pocketA, osKey)
  await setExample('Cache identity pocket to pocket.')
  const sibling = await switchAndSpeak(pocketA, pocketB)
  const problems = []
  for (const row of [fwd, rev, sibling]) {
    if (row.error) problems.push(row.error)
    else {
      if (row.replayDisabled !== true) problems.push(`${row.from} -> ${row.to}: Replay was not invalidated`)
      if (row.spoke !== true) problems.push(`${row.from} -> ${row.to}: no /speak (cache served the previous voice)`)
      if (row.requested !== row.to) problems.push(`${row.from} -> ${row.to}: requested ${row.requested}`)
    }
  }
  return {
    pass: problems.length === 0,
    detail: problems.length === 0
      ? `cache missed on ${osKey}->${pocketA}, ${pocketA}->${osKey}, and ${pocketA}->${pocketB}; Replay invalidated each time`
      : `cache invalidation failed: ${problems.join('; ')} ${JSON.stringify({ fwd, rev, sibling })}`
  }
}

/**
 * U9 — provenance follows the backend that completed speech, and this check plays itself.
 *
 * R16-05: U9 was leftover state from U8. Alone on a clean page it failed; after U8's OS fallback
 * it passed. `--prove` ran U9 in isolation, so it went red whether or not the breakage was the
 * one named. It also required the OS-fallback footer, so a working Pocket install would fail it.
 *
 * Two expected footers: OS fallback when Pocket cannot, Pocket provenance when it can. The
 * discriminating field is provenance.backend (what spoke), not the selected option.
 */
async function u9 (cdp) {
  await muteConfirmations(cdp)
  const keys = await pickerKeys(cdp)
  const pocketKey = keys.pocket[0]
  if (!pocketKey) return { pass: false, detail: 'no Pocket option to play' }

  await chooseVoice(cdp, pocketKey)
  let snap
  try {
    snap = lastSpeak(await playUntilDone(cdp))
  } catch (err) {
    if (ARM.pocketInstalled) {
      return {
        pass: false,
        inconclusive: true,
        detail: `Pocket was staged but Play delivered nothing: ${err.message ?? err}`
      }
    }
    throw err
  }
  const effect = snap.provenance
  const selected = await cdp.evaluate(`document.getElementById('ctl-voice.id').value`)
  const served = effect?.backend ?? snap.served
  const footerSaysPocket = /Played by Pocket TTS/i.test(effect.footer) && /local and offline/i.test(effect.footer)
  const footerSaysOs = /this machine's system voice/i.test(effect.footer)

  if (!selected.startsWith('pocket:')) {
    return { pass: false, detail: `U9 must play a Pocket option itself; selected ${selected}` }
  }

  if (served === 'pocket') {
    const pass = footerSaysPocket && effect.tunedWith.startsWith('pocket:') && !effect.reason &&
      (effect.backend === 'pocket' || effect.backend == null)
    return {
      pass,
      detail: pass
        ? `selected ${selected}; Play was served by pocket; footer names Pocket TTS and tunedWith is ${effect.tunedWith}`
        : `head said pocket but the footer did not: ${JSON.stringify({ selected, served, effect, head: snap.head })}`
    }
  }

  const pass = served === 'os' &&
    footerSaysOs &&
    !footerSaysPocket &&
    /^os(?::|$)/.test(effect.tunedWith) &&
    (effect.backend === 'os' || effect.backend == null)
  return {
    pass,
    detail: pass
      ? `selected ${selected}; Play was served by the OS; footer names the system voice and tunedWith is ${effect.tunedWith}`
      : `provenance did not name the OS as what spoke: ${JSON.stringify({ selected, served, effect, head: snap.head })}`
  }
}

/* ---------------------------------------------------------------------------------- the runner */

const CHECKS = [
  { id: 'U1', what: 'every control on screen is operable', fn: u1, provable: true },
  { id: 'U2', what: 'a dropdown changes what is spoken', fn: u2, provable: true },
  { id: 'U3', what: 'editing the example changes what is spoken', fn: u3, provable: false },
  { id: 'U4', what: 'two plays never overlap', fn: u4, provable: true },
  { id: 'U5', what: 'one transform is one mark, and the mark is labelled', fn: u5, provable: true },
  { id: 'U6', what: 'Play of a Pocket voice is served by Pocket, not by the OS fallback', fn: u6, provable: true },
  { id: 'U7', what: 'a failed neural download is named and the OS floor still speaks', fn: u7, provable: true },
  { id: 'U8', what: 'os→pocket, pocket→os, and pocket→pocket all miss the audio cache', fn: u8, provable: true },
  { id: 'U9', what: 'provenance names what actually spoke, and this check plays itself', fn: u9, provable: true }
]

/**
 * The breakages `--prove` applies to a COPY of the page. Each is the exact defect the matching
 * check exists to catch, so a check that stays green here is decorative.
 */
const BREAKAGES = [
  {
    id: 'U1',
    what: 'render the unwired controls again',
    apply: (html) => html.replace(
      'return CONTROLS.filter((c) => c.wire !== null)',
      'return CONTROLS.slice()')
  },
  {
    id: 'U2',
    what: 'drop the change listener from the dropdown',
    apply: (html) => html.replace(
      "s.addEventListener('change', () => setControl(c, s.value))",
      "s.addEventListener('change', () => {})")
  },
  {
    id: 'U5',
    what: 'go back to one span per word instead of one per run',
    apply: (html) => html.replace(
      'if (last && last.stage === tok.stage && last.kind === tok.kind) { last.tokens.push(tok); continue }',
      '// merging disabled by --prove')
  },
  {
    id: 'U4',
    what: 'remove the stopAudio() that makes play barge in',
    apply: (html) => html.replace(
      '  stopAudio()\n\n  // The warm path first',
      '  /* stopAudio() removed by --prove */\n\n  // The warm path first')
  },
  {
    id: 'U6',
    what: 'drop the optgroup wiring from the voice picker',
    apply: (html) => html.replace(
      's.append(machineGroup, pocketGroup)',
      's.append(...machineGroup.children, ...pocketGroup.children)')
  },
  {
    id: 'U6',
    what: 'always bind the OS voice for synthesis, ignoring the picker',
    apply: (html) => html.replace(
      'return { voice: chosen?.key, rate: v[\'voice.rate\'] }',
      'return { voice: state.voices.find((voice) => voice.backend === \'os\' && voice.available)?.key, rate: v[\'voice.rate\'] }')
  },
  {
    id: 'U7',
    what: 'skip the no-reload voice refresh after download',
    apply: (html) => html.replace(
      '    await loadVoices()\n    adoptVoiceSelection(chosen)',
      '    /* loadVoices() removed by --prove */\n    adoptVoiceSelection(chosen)')
  },
  {
    id: 'U7',
    what: 'swallow the download error sentence the listener is owed',
    apply: (html) => {
      const broken = html.replaceAll(
        'Your system voices still work.',
        'Download finished.')
      if (broken === html) throw new Error('the error-sentence breakage matched nothing')
      return broken
    }
  },
  {
    id: 'U8',
    what: 'reuse the last Pocket voice as the cache key for later OS voices',
    apply: (html) => {
      const from = 'const parts = KEYED_FIELDS.map((f) => `' + '${f}=${serializeField(synth[f])}' + '`)'
      const to = "if (synth.voice && String(synth.voice).startsWith('pocket:')) window.__lastPocketVoice = synth.voice; const __v = (synth.voice && String(synth.voice).startsWith('os:') && window.__lastPocketVoice) ? window.__lastPocketVoice : synth.voice; const parts = KEYED_FIELDS.map((f) => `" + '${f}=${serializeField(f === \'voice\' ? __v : synth[f])}' + '`)'
      return html.replace(from, to)
    }
  },
  {
    id: 'U9',
    what: 'invert the served backend so provenance names the other one',
    apply: (html) => html.replace(
      '  state.lastProvenance = provenance',
      '  state.lastProvenance = Object.assign({}, provenance, { backend: provenance.backend === \'pocket\' ? \'os\' : \'pocket\' })')
  }
]

async function runAgainst (pageDir, only, arm) {
  ARM = { pocketInstalled: arm.pocketInstalled === true }
  const chromeDir = await mkdtemp(join(tmpdir(), 'ui-probe-chrome-'))
  const lab = await startLab(pageDir, arm.modelDir)
  const port = lab.port
  const chrome = await startChrome(chromeDir)
  if (chrome.bin === null) {
    lab.child.kill('SIGKILL')
    throw new Error('no Chrome or Chromium on this machine; the UI cannot be driven here')
  }
  const cdp = await attach(chrome.port)
  const results = []
  const pageErrors = []
  try {
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    // A page-side exception is the most likely reason a check fails, and the least likely thing to
    // be visible from here. Report it verbatim rather than leaving the reader to infer it from a
    // control that "does not exist".
    cdp.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails
        pageErrors.push(d.exception?.description ?? d.text)
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        pageErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
      }
    })
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE })
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` })
    // The page is ready when it has rendered controls and normalized once.
    // The page's own end-of-start() signal, not a guess from the DOM. Guessing from "a control
    // row exists" was true one render BEFORE the voice list arrived, so the voice picker still
    // held its "no voices found" placeholder and U1 flickered on timing alone.
    const ready = await waitUntil(cdp, 'window.__labReady === true', (v) => v === true, 60000)
    if (ready !== true) throw new Error('the page never finished start(): window.__labReady never became true')
    await waitUntil(cdp, spoken, (t) => (t ?? '').length > 0, 30000)

    if (pageErrors.length) {
      console.log('  page-side errors:\n    ' + pageErrors.join('\n    '))
    }
    if (process.argv.includes('--dump')) {
      console.log(await cdp.evaluate('document.getElementById("controls").innerHTML.slice(0,3000)'))
      console.log('--- has editor:', await cdp.evaluate('!!document.getElementById("example-text")'))
      console.log('--- title:', await cdp.evaluate('document.title'))
      console.log('--- voice options:', await cdp.evaluate('(document.getElementById("ctl-voice.id")||{options:[]}).options.length'))
      console.log('--- /voices says:', await cdp.evaluate('fetch("/voices").then(r=>r.json()).then(j=>(j.voices||[]).length)'))
      console.log('--- head bytes:', await cdp.evaluate('document.documentElement.outerHTML.length'))
    }
    for (const c of CHECKS) {
      if (only && !only.includes(c.id)) continue
      let r
      try { r = await c.fn(cdp) } catch (err) { r = { pass: false, detail: String(err.message ?? err) } }
      results.push({ ...c, ...r })
    }
  } finally {
    cdp.close()
    chrome.child.kill('SIGKILL')
    lab.child.kill('SIGKILL')
    await removeWhenReleased(chromeDir)
  }
  return results
}

/**
 * Delete a directory a just-killed process may still be holding.
 *
 * On Windows, SIGKILL returns before the OS has released the process's file handles, so removing
 * Chrome's profile immediately fails `EBUSY` on `first_party_sets.db` — which took down the whole
 * CI job over a temp file nobody cares about. Retry briefly, then give up QUIETLY: a leftover
 * profile in the runner's temp directory is not a reason to fail a run about the UI.
 */
async function removeWhenReleased (dir, attempts = 10) {
  for (let i = 0; i < attempts; i++) {
    try {
      await rm(dir, { recursive: true, force: true })
      return
    } catch (err) {
      if (err?.code !== 'EBUSY' && err?.code !== 'ENOTEMPTY' && err?.code !== 'EPERM') return
      await sleep(200)
    }
  }
}

/** Copy `voice-lab/` to a temp dir, applying one breakage to index.html. */
async function brokenCopy (breakage) {
  const dir = await mkdtemp(join(tmpdir(), 'ui-probe-page-'))
  const src = join(ROOT, 'voice-lab')
  await mkdir(join(dir, 'lib'), { recursive: true })
  for (const f of await readdir(src)) {
    if (f === 'lib') continue
    const body = await readFile(join(src, f))
    await writeFile(join(dir, f), body)
  }
  const html = await readFile(join(dir, 'index.html'), 'utf8')
  const broken = breakage.apply(html)
  if (broken === html) throw new Error(`the breakage "${breakage.what}" matched nothing — it would prove nothing`)
  await writeFile(join(dir, 'index.html'), broken)
  return dir
}

function parseOnly () {
  const arg = process.argv.find((a) => a.startsWith('--only='))
  return arg ? arg.slice('--only='.length).split(',').filter(Boolean) : null
}

/**
 * A Pocket install we can actually play. Prefer an explicit ORCA_TTS_MODEL_DIR when it looks
 * populated; otherwise the buzz cache the brief names. Missing files → no second arm.
 */
function findPocketDir () {
  const candidates = [
    process.env.ORCA_TTS_MODEL_DIR,
    join(homedir(), '.buzz', 'models', 'pocket-tts')
  ].filter((d) => typeof d === 'string' && d.length > 0)
  for (const dir of candidates) {
    if (existsSync(join(dir, 'tokenizer.model')) && existsSync(join(dir, 'eve.wav'))) return dir
  }
  return null
}

/**
 * The Voice Lab's modelStatus requires `.orca-tts-model-manifest` with version 2. The buzz
 * cache the brief names has the weights and the twelve clips, but buzz's own marker
 * (`.buzz-model-manifest`). Writing into the author's cache is forbidden. Stage a temp
 * directory of symlinks plus the one file the lab checks, so Arm B actually sees Pocket ready.
 */
async function stagePocketDir (source) {
  const dir = await mkdtemp(join(tmpdir(), 'ui-probe-pocket-model-'))
  for (const name of await readdir(source)) {
    if (name === '.orca-tts-model-manifest') continue
    await symlink(join(source, name), join(dir, name))
  }
  await writeFile(join(dir, '.orca-tts-model-manifest'), '2\n')
  return dir
}

function printResults (results, failures) {
  let inconclusive = 0
  for (const r of results) {
    const tag = r.pass ? '  ok  ' : (r.inconclusive ? 'INCONC' : ' FAIL ')
    console.log(`[${tag}] ${r.id}  ${r.what}`)
    console.log(`         ${r.detail}`)
    if (!r.pass && !r.inconclusive) failures++
    if (r.inconclusive) inconclusive++
  }
  return { failures, inconclusive }
}

async function main () {
  const prove = process.argv.includes('--prove')
  const only = parseOnly()
  let failures = 0
  let neuralHeard = false
  let hermeticInconclusive = 0

  const emptyDir = await mkdtemp(join(tmpdir(), 'ui-probe-empty-model-'))
  const pocketSource = findPocketDir()
  const stagedPocket = pocketSource ? await stagePocketDir(pocketSource) : null
  const pocketDir = stagedPocket

  console.log('Voice Lab UI probe — headless, muted, 127.0.0.1 only.')
  console.log('Arm A — hermetic empty model (Pocket ABSENT by construction).\n')
  const hermetic = await runAgainst(join(ROOT, 'voice-lab'), only, {
    pocketInstalled: false, modelDir: emptyDir
  })
  ;({ failures, inconclusive: hermeticInconclusive } = printResults(hermetic, failures))

  if (prove) {
    console.log('\n--prove: each check, against a page broken in exactly the way it watches for.')
    for (const breakage of BREAKAGES) {
      if (only && !only.includes(breakage.id)) continue
      const dir = await brokenCopy(breakage)
      try {
        const [r] = await runAgainst(dir, [breakage.id], {
          pocketInstalled: false, modelDir: emptyDir
        })
        const wentRed = r && r.pass === false && r.inconclusive !== true
        console.log(`[${wentRed ? '  ok  ' : ' FAIL '}] ${breakage.id}  went ${wentRed ? 'RED' : 'GREEN'} when we ${breakage.what}`)
        console.log(`         ${r?.detail ?? '(no result)'}`)
        if (!wentRed) failures++
      } finally {
        await removeWhenReleased(dir)
      }
    }
  }

  const pocketOnly = (only ?? ['U6', 'U9']).filter((id) => id === 'U6' || id === 'U9')
  if (!prove && pocketDir && pocketOnly.length > 0) {
    console.log(`\nArm B — Pocket model present at ${pocketDir}.`)
    console.log('U6 and U9 must now require that Pocket is what spoke.\n')
    const pocket = await runAgainst(join(ROOT, 'voice-lab'), pocketOnly, {
      pocketInstalled: true, modelDir: pocketDir
    })
    ;({ failures } = printResults(pocket, failures))
    const u6arm = pocket.find((r) => r.id === 'U6')
    if (u6arm?.pass === true) neuralHeard = true
  } else if (prove) {
    console.log('\nArm B skipped during --prove (breakages are hermetic).')
  } else if (!pocketDir) {
    console.log('\nArm B skipped — no Pocket model at ORCA_TTS_MODEL_DIR or ~/.buzz/models/pocket-tts.')
  }

  await removeWhenReleased(emptyDir)
  if (stagedPocket) await removeWhenReleased(stagedPocket)

  if (failures > 0) {
    console.log(`\n${failures} check(s) did not.`)
    process.exit(1)
  }
  if (neuralHeard) {
    console.log('\nAll checks behaved as declared. Arm B heard Pocket TTS, not the OS fallback.')
    process.exit(0)
  }
  console.log('\nPage checks behaved as declared. Neural speech was INCONCLUSIVE — Pocket was not what spoke.')
  if (hermeticInconclusive === 0 && !pocketDir) {
    console.log('         (no INCONC row was printed either, which means U6 never ran or never reached Play.)')
  }
  process.exit(2)
}

await main()
