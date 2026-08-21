#!/usr/bin/env node
// SPIKE-1 / Linux — first-event latency of speech-dispatcher SSIP `SPEAK`
//
// STATUS: UNMEASURED. This script has never been executed. It is committed so the number is one
// command away for anyone with a Linux machine running speech-dispatcher, rather than an estimate
// in a design document. Whoever runs it: paste the output into
// docs/.research/spike1-resident-synth.md section 5 and relabel that section's rows from
// [claimed] to [measured-here] with the machine, distro and date.
//
// READ THIS BEFORE READING THE NUMBER — it does NOT measure the same quantity as the macOS arm.
//
//   The macOS arm measures API call -> first PCM buffer WE receive. On Linux there is no such
//   quantity and there never will be. SSIP's verb list is
//   set/history/stop/cancel/pause/resume/sound_icon/char/key/list/get/help/block/speak/quit
//   (speechd src/server/parse.c:98-110) — no audio-retrieval verb; SET has no audio-output
//   parameter; and src/audio/libao.c:75 calls ao_open_live(), so no file driver can be opened.
//   Design 010 section 9 states the consequence: the Linux resident service is a `spoke-elsewhere`
//   provider with pause/resume and index marks, and NO bytes, permanently.
//
//   So what this probe measures is: t0 at the end of the SPEAK block, t1 at the first event the
//   daemon sends back — `701 BEGIN`, or the first `700 INDEX MARK` in the SSML arm. That is
//   "the daemon told us it started", not "a sample left the DAC" and not "we hold audio".
//   It is the best-defined boundary that exists on this platform, and the honest reading of it is:
//   this is the floor on how fast a Linux resident service can KNOW speech began. The number that
//   would answer R4.2 on Linux cannot be taken through speech-dispatcher at all — it needs the
//   espeak-ng library path (010 section 9), which is a different probe and a different rung.
//
// SILENCE (PITFALLS P31)
//   THIS PROBE IS AUDIBLE. speech-dispatcher speaks through the daemon's own audio output and we
//   cannot stop it: there is no capture path and no null-sink parameter in SSIP. Do not run it on
//   a machine anyone is listening to. It refuses to start without --audible for exactly that
//   reason. On a headless CI runner there is no audio device at all (PITFALLS P16), in which case
//   the daemon may fail to open output — the script reports that as NOT-RUN with the reason, it
//   does not report a number.
//
// RUN
//   node scripts/spikes/spike1-linux-firstindex.mjs --audible [--n 20] [--socket <path>]
//
// PASS CONDITION (010 section 8.2): median <= 150 ms.
// FALSIFIER: median > 350 ms.

import net from 'node:net'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}

const WARM_N = Number(opt('--n', '20'))
const IDLE_SECONDS = Number(opt('--idle', '30'))

if (!flag('--audible')) {
  console.log('SPIKE1_PROBE=linux-firstindex')
  console.log('SPIKE1_NOT_RUN=audible probe — speech-dispatcher speaks through its own audio output')
  console.log('SPIKE1_NOT_RUN_REASON=SSIP has no audio-retrieval verb and no null-sink parameter, so')
  console.log('SPIKE1_NOT_RUN_REASON=there is no silent form of this measurement. Re-run with --audible')
  console.log('SPIKE1_NOT_RUN_REASON=on a machine nobody is listening to. See PITFALLS P31.')
  process.exit(0)
}

// ── the same corpus as the macOS and Windows arms, so the three numbers compare ──
const SENTENCES = [
  'I read the three design documents and the measurement pass before changing anything.',
  'The gap you are hearing between sentences is the audio device, not the process spawn.',
  'Process fork and exec costs about two milliseconds, which is a rounding error here.',
  'The temp file round trip is a third of a millisecond, so removing it buys nothing.',
  'That leaves roughly eight hundred and ninety milliseconds of device open and teardown.',
  'So the milestone should be scoped as holding the device open across chunks.',
  'Pooling player processes while still opening the device per chunk would ship and change nothing.',
  'I also checked whether the synthesizer itself is on the critical path.',
  'A real sentence through the system synthesizer takes about one point one seconds end to end.',
  'That is already twice the five hundred millisecond budget with playback set to zero.',
  'The neural engine synthesizes the same sentence in about sixty milliseconds.',
  'But the command line tool only returns once the entire wave file has been written.',
  'The streaming API delivers buffers as they are produced, which is a different quantity.',
  'Nobody has measured the time from the write call to the first buffer in a warm process.',
  'That single number decides whether the milestone builds a service or swaps an engine.',
  'If it is under one hundred and fifty milliseconds, residency alone buys the budget.',
  'If it is above three hundred and fifty, the neural engine returns to the critical path.',
  'I have written the probe so that it never opens an audio device or plays a sample.',
  'The equivalent probes for Windows and Linux are committed but remain unmeasured.',
  'I will report the median, the spread, the cold start penalty and the idle cost.',
]

const pct = (xs, p) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  if (s.length === 1) return s[0]
  const idx = p * (s.length - 1)
  const lo = Math.floor(idx), hi = Math.ceil(idx)
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo)
}
const f = (x) => Number.isFinite(x) ? x.toFixed(1) : 'NaN'
const nowMs = () => Number(process.hrtime.bigint()) / 1e6

// ── where the daemon listens ────────────────────────────────────────────────
function socketCandidates() {
  const out = []
  const explicit = opt('--socket', null)
  if (explicit) out.push(explicit)
  const xdg = process.env.XDG_RUNTIME_DIR
  if (xdg) out.push(path.join(xdg, 'speech-dispatcher', 'speechd.sock'))
  out.push(path.join(os.homedir(), '.cache', 'speech-dispatcher', 'speechd.sock'))
  out.push('/run/user/' + process.getuid?.() + '/speech-dispatcher/speechd.sock')
  return out
}

function notRun(reason) {
  console.log('SPIKE1_PROBE=linux-firstindex')
  console.log(`SPIKE1_NOT_RUN=${reason}`)
  process.exit(0)
}

const sockPath = socketCandidates().find((p) => { try { return fs.statSync(p).isSocket() } catch { return false } })

console.log('SPIKE1_PROBE=linux-firstindex')
console.log(`SPIKE1_SOCKET=${sockPath ?? 'none of ' + socketCandidates().join(', ')}`)

/** A minimal SSIP client. Line protocol, CRLF, `NNN-continuation` / `NNN final`. */
class Ssip {
  constructor(sock) {
    this.sock = sock
    this.buf = ''
    /** replies waiting for a final line */
    this.pending = []
    /** event listeners: (code, lines) => void */
    this.onEvent = () => {}
    sock.setEncoding('utf8')
    sock.on('data', (d) => this.#feed(d))
  }
  #feed(d) {
    this.buf += d
    let i
    while ((i = this.buf.indexOf('\r\n')) >= 0) {
      const line = this.buf.slice(0, i)
      this.buf = this.buf.slice(i + 2)
      this.#line(line, nowMs())
    }
  }
  #line(line, t) {
    const code = Number(line.slice(0, 3))
    const sep = line[3]                   // '-' continuation, ' ' final
    // 7xx are asynchronous events (701 BEGIN, 700 INDEX MARK, 702 END, 703 CANCEL, 704 PAUSE…)
    if (code >= 700 && code < 800) { this.onEvent(code, line, t); return }
    this.cur = this.cur ?? []
    this.cur.push(line)
    if (sep === ' ') {
      const lines = this.cur; this.cur = null
      const p = this.pending.shift()
      if (p) p.resolve({ code, lines, t })
    }
  }
  send(cmd) {
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject })
      this.sock.write(cmd + '\r\n')
    })
  }
  /** SPEAK is a block: the command, the text, then a lone `.` line. t0 is when `.` is flushed. */
  speakBlock(text) {
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject })
      const body = text.split('\n').map((l) => (l === '.' ? '..' : l)).join('\r\n')
      this.sock.write('SPEAK\r\n' + body + '\r\n.\r\n')
    })
  }
}

function connect(p) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(p)
    s.once('connect', () => resolve(s))
    s.once('error', reject)
  })
}

async function main() {
  if (!sockPath) notRun('no speech-dispatcher socket found — is speechd running? tried: ' + socketCandidates().join(', '))

  let sock
  try { sock = await connect(sockPath) } catch (e) { notRun('connect failed: ' + e.message) }
  const c = new Ssip(sock)

  const hello = await c.send('SET self CLIENT_NAME orca:spike1:main')
  console.log(`SPIKE1_SSIP_HELLO=${hello.code}`)
  if (hello.code >= 300) notRun(`SSIP refused CLIENT_NAME: ${hello.lines.join(' | ')}`)

  // Events are the whole instrument. Without them there is nothing to time against.
  const notif = await c.send('SET self NOTIFICATION ALL on')
  console.log(`SPIKE1_SSIP_NOTIFICATION=${notif.code}`)
  if (notif.code >= 300) notRun(`SSIP refused NOTIFICATION ALL: ${notif.lines.join(' | ')}`)

  const mod = await c.send('LIST OUTPUT_MODULES')
  console.log(`SPIKE1_OUTPUT_MODULES=${mod.lines.join(' ')}`)
  const voice = await c.send('GET VOICE')
  console.log(`SPIKE1_VOICE=${voice.lines.join(' ')}`)

  /** One utterance. Returns { beginMs, firstIndexMs, endMs } relative to t0. */
  async function measure(text, { ssml = false } = {}) {
    await c.send(`SET self SSML_MODE ${ssml ? 'on' : 'off'}`)
    let resolveDone
    const done = new Promise((r) => { resolveDone = r })
    let t0 = 0, beginT = 0, indexT = 0, endT = 0
    c.onEvent = (code, _line, t) => {
      if (code === 701 && !beginT) beginT = t          // BEGIN
      if (code === 700 && !indexT) indexT = t          // INDEX MARK
      if (code === 702 || code === 703) { endT = t; resolveDone() }  // END / CANCEL
    }
    const payload = ssml
      ? `<speak><mark name="m0"/>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</speak>`
      : text
    t0 = nowMs()
    const ack = await c.speakBlock(payload)
    if (ack.code >= 300) return null
    const timeout = setTimeout(resolveDone, 30000)
    await done
    clearTimeout(timeout)
    c.onEvent = () => {}
    return {
      ackMs: ack.t - t0,
      beginMs: beginT ? beginT - t0 : NaN,
      firstIndexMs: indexT ? indexT - t0 : NaN,
      endMs: endT ? endT - t0 : NaN,
    }
  }

  // ARM 0 — COLD. The first SPEAK on this connection. Reported alone.
  const cold = await measure(SENTENCES[0])
  if (!cold) notRun('SSIP refused the first SPEAK block')
  console.log(`SPIKE1_COLD_ACK_MS=${f(cold.ackMs)}`)
  console.log(`SPIKE1_COLD_BEGIN_MS=${f(cold.beginMs)}`)
  console.log(`SPIKE1_COLD_END_MS=${f(cold.endMs)}`)

  // ARM 1 — WARM, plain text.
  const warm = []
  for (let i = 0; i < WARM_N; i++) {
    const r = await measure(SENTENCES[(i + 1) % SENTENCES.length])
    if (r) warm.push(r)
  }
  const beginMs = warm.map((r) => r.beginMs).filter(Number.isFinite)
  const ackMs = warm.map((r) => r.ackMs).filter(Number.isFinite)
  console.log(`SPIKE1_WARM_BEGIN_MS_RAW=${beginMs.map(f).join(' ')}`)
  console.log(`SPIKE1_WARM_BEGIN_MIN=${f(Math.min(...beginMs))} P50=${f(pct(beginMs, 0.5))} P95=${f(pct(beginMs, 0.95))} MAX=${f(Math.max(...beginMs))} N=${beginMs.length}`)
  console.log(`SPIKE1_WARM_ACK_P50=${f(pct(ackMs, 0.5))}  // SSIP round trip only, not speech`)
  console.log(`SPIKE1_COLD_PENALTY_MS=${f(cold.beginMs - pct(beginMs, 0.5))}`)

  // ARM 2 — SSML with an index mark. The mark is the only per-position event Linux offers, and
  // 010 extension 5 (word boundaries) depends on it.
  const ssml = []
  for (let i = 0; i < WARM_N; i++) {
    const r = await measure(SENTENCES[(i + 1) % SENTENCES.length], { ssml: true })
    if (r) ssml.push(r)
  }
  const idxMs = ssml.map((r) => r.firstIndexMs).filter(Number.isFinite)
  const ssmlBegin = ssml.map((r) => r.beginMs).filter(Number.isFinite)
  console.log(`SPIKE1_SSML_INDEXMARKS_SEEN=${idxMs.length}/${ssml.length}`)
  if (idxMs.length) {
    console.log(`SPIKE1_SSML_FIRSTINDEX_MS_RAW=${idxMs.map(f).join(' ')}`)
    console.log(`SPIKE1_SSML_FIRSTINDEX_MIN=${f(Math.min(...idxMs))} P50=${f(pct(idxMs, 0.5))} P95=${f(pct(idxMs, 0.95))} MAX=${f(Math.max(...idxMs))} N=${idxMs.length}`)
  }
  if (ssmlBegin.length) {
    console.log(`SPIKE1_SSML_BEGIN_P50=${f(pct(ssmlBegin, 0.5))}`)
    console.log(`SPIKE1_SSML_MINUS_PLAIN_P50_MS=${f(pct(ssmlBegin, 0.5) - pct(beginMs, 0.5))}`)
  }

  // ARM 3 — IDLE COST of holding the SSIP connection. Note this is OUR client's cost only; the
  // daemon is a separate process we do not own and its residency is not ours to account for.
  const rss0 = process.memoryUsage().rss
  const cpu0 = process.cpuUsage()
  const t0 = nowMs()
  await new Promise((r) => setTimeout(r, IDLE_SECONDS * 1000))
  const idleWallMs = nowMs() - t0
  const cpu1 = process.cpuUsage(cpu0)
  const rss1 = process.memoryUsage().rss
  const idleCpuSec = (cpu1.user + cpu1.system) / 1e6
  console.log(`SPIKE1_IDLE_WINDOW_S=${f(idleWallMs / 1000)}`)
  console.log(`SPIKE1_IDLE_RSS_BEFORE_BYTES=${rss0}`)
  console.log(`SPIKE1_IDLE_RSS_AFTER_BYTES=${rss1}`)
  console.log(`SPIKE1_IDLE_RSS_AFTER_MB=${f(rss1 / 1048576)}  // node client only, NOT the daemon`)
  console.log(`SPIKE1_IDLE_CPU_SECONDS=${idleCpuSec.toFixed(4)}`)
  console.log(`SPIKE1_IDLE_CPU_PERCENT=${(idleCpuSec / (idleWallMs / 1000) * 100).toFixed(3)}`)

  const median = pct(beginMs, 0.5)
  const verdict = median <= 150 ? 'PASS' : median > 350 ? 'FAIL-FALSIFIES-010' : 'MARGINAL'
  console.log(`SPIKE1_VERDICT=${verdict} median=${f(median)} pass<=150 falsifier>350`)
  console.log('SPIKE1_CAVEAT=this median is daemon-said-BEGIN, not first-PCM-we-hold. Linux never yields bytes (010 section 9).')

  await c.send('QUIT')
  sock.end()
}

main().catch((e) => { console.log(`SPIKE1_NOT_RUN=probe threw: ${e.message}`); process.exit(1) })
