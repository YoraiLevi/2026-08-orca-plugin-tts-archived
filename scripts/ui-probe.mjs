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
 *
 * EACH CHECK CAN FAIL, and `--prove` demonstrates it: it re-runs U1, U2 and U4 against a
 * deliberately broken copy of the page and requires them to go red. A check that could not have
 * failed is not a check.
 *
 * SILENT — P31, the author is at this machine. Chrome runs headless with `--mute-audio` and
 * `--disable-audio-output`, and the injected probe additionally pins a zero gain node between
 * every source and the destination. Four mechanisms, same as `bench-lab-gate.mjs`.
 *
 * Usage:
 *   node scripts/ui-probe.mjs            # run the four checks
 *   node scripts/ui-probe.mjs --prove    # also prove each one can go red
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
  const p = { live: 0, maxLive: 0, started: 0, errors: [] };
  window.__ui = p;

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
async function startLab (pageDir) {
  const child = spawn(process.execPath, [
    join(ROOT, 'scripts/voice-lab.mjs'), '--port', '0', '--page', pageDir
  ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
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
  const midway = await cdp.evaluate('JSON.stringify({ ui: window.__ui, timing: document.getElementById("timing").textContent, status: document.getElementById("status").textContent })')
  await click()
  const after = await cdp.evaluate('JSON.stringify({ ui: window.__ui, timing: document.getElementById("timing").textContent, status: document.getElementById("status").textContent })')

  await waitUntil(cdp, 'window.__ui.started', (n) => Number(n) >= 2, 30000)
  await sleep(1200)
  const p = JSON.parse(await cdp.evaluate('JSON.stringify(window.__ui)'))
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

/* ---------------------------------------------------------------------------------- the runner */

const CHECKS = [
  { id: 'U1', what: 'every control on screen is operable', fn: u1, provable: true },
  { id: 'U2', what: 'a dropdown changes what is spoken', fn: u2, provable: true },
  { id: 'U3', what: 'editing the example changes what is spoken', fn: u3, provable: false },
  { id: 'U4', what: 'two plays never overlap', fn: u4, provable: true },
  { id: 'U5', what: 'one transform is one mark, and the mark is labelled', fn: u5, provable: true }
]

/**
 * The breakages `--prove` applies to a COPY of the page. Each is the exact defect the matching
 * check exists to catch, so a check that stays green here is decorative.
 */
const BREAKAGES = {
  U1: {
    what: 'render the unwired controls again',
    apply: (html) => html.replace(
      'return CONTROLS.filter((c) => c.wire !== null)',
      'return CONTROLS.slice()')
  },
  U2: {
    what: 'drop the change listener from the dropdown',
    apply: (html) => html.replace(
      "s.addEventListener('change', () => setControl(c, s.value))",
      "s.addEventListener('change', () => {})")
  },
  U5: {
    what: 'go back to one span per word instead of one per run',
    apply: (html) => html.replace(
      'if (last && last.stage === tok.stage && last.kind === tok.kind) { last.tokens.push(tok); continue }',
      '// merging disabled by --prove')
  },
  U4: {
    what: 'remove the stopAudio() that makes play barge in',
    apply: (html) => html.replace(
      '  stopAudio()\n\n  // The warm path first',
      '  /* stopAudio() removed by --prove */\n\n  // The warm path first')
  }
}

async function runAgainst (pageDir, only) {
  const chromeDir = await mkdtemp(join(tmpdir(), 'ui-probe-chrome-'))
  const lab = await startLab(pageDir)
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

async function main () {
  const prove = process.argv.includes('--prove')
  let failures = 0

  console.log('Voice Lab UI probe — headless, muted, 127.0.0.1 only.\n')
  const results = await runAgainst(join(ROOT, 'voice-lab'))
  for (const r of results) {
    console.log(`[${r.pass ? '  ok  ' : ' FAIL '}] ${r.id}  ${r.what}`)
    console.log(`         ${r.detail}`)
    if (!r.pass) failures++
  }

  if (prove) {
    console.log('\n--prove: each check, against a page broken in exactly the way it watches for.')
    for (const [id, breakage] of Object.entries(BREAKAGES)) {
      const dir = await brokenCopy(breakage)
      try {
        const [r] = await runAgainst(dir, [id])
        const wentRed = r && !r.pass
        console.log(`[${wentRed ? '  ok  ' : ' FAIL '}] ${id}  went ${wentRed ? 'RED' : 'GREEN'} when we ${breakage.what}`)
        console.log(`         ${r?.detail ?? '(no result)'}`)
        if (!wentRed) failures++
      } finally {
        await removeWhenReleased(dir)
      }
    }
  }

  console.log(failures === 0 ? '\nAll checks behaved as declared.' : `\n${failures} check(s) did not.`)
  process.exit(failures === 0 ? 0 : 1)
}

await main()
