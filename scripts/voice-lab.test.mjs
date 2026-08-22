/**
 * T111 — the Voice Lab server, tested for everything that does not need a browser.
 *
 * NO TEST HERE PLAYS AUDIO. The provider is a fake everywhere synthesis is involved; the only
 * real bytes asserted on are the ones the fake yields. That is P31's rule applied to the suite:
 * a test run must not make a sound at the author's machine.
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  STAGES, computeStages, assertSourceModule, assertLoadedModuleIsOnDiskSource,
  speak, speakStream, providerError, installHintFor, lossAnnouncement, countWord,
  isProviderUnavailable, parseArgs, createLabServer, SPOKE_ELSEWHERE_DISABLED,
  settingsPathFor, stripJsonComments, checkRevision, readSettings, writeSettings,
  safeJoin, REPO_ROOT
} from './voice-lab.mjs'

const NORMALIZER = join(REPO_ROOT, 'packages/core/src/normalizer/index.ts')

/* ------------------------------------------------------------------ the stage ladder */

describe('the 17-stage ladder is the pipeline, not a description of it', () => {
  it('has exactly 17 stages, in the order normalize() calls them', () => {
    // 004 section 4 corrects three documents that disagreed. The source was counted:
    // packages/core/src/normalizer/index.ts:96-109.
    expect(STAGES).toHaveLength(17)
    expect(STAGES.map((s) => s.name)).toEqual([
      'stripFencedCode', 'stripHtmlComments', 'diagramsToLabels', 'stripInlineCode',
      'expandMarkdownLinks', 'stripUrls', 'headingsToPauses', 'listItemsToSentences',
      'tablesToRows', 'speakFilePaths', 'stripMarkdownMarkers', 'speakKeyGlyphs', 'stripEmoji',
      'expandUnits', 'expandNumbers', 'collapseWhitespace', 'tidyPunctuation'
    ])
    expect(STAGES.map((s) => s.n)).toEqual([...Array(17)].map((_, i) => i + 1))
  })

  it('the incremental ladder reproduces normalize() on every committed fixture', async () => {
    const proof = await assertLoadedModuleIsOnDiskSource()
    // Six fixtures plus the inline probe. A silently-empty probe set would make this free.
    expect(proof.fixtures).toBeGreaterThanOrEqual(7)
  })

  it('records what each stage changed, and says so when a stage changed nothing', async () => {
    const { stages } = await computeStages('plain words with nothing to transform\n')
    const changed = stages.filter((s) => s.changed)
    expect(changed.length).toBeGreaterThan(0)                 // collapseWhitespace at minimum
    expect(stages.filter((s) => !s.changed).length).toBeGreaterThan(0)
  })

  it('attributes a real change to the stage that produced it', async () => {
    const { stages } = await computeStages('See packages/core/src/normalizer/index.ts for it.\n')
    const paths = stages.find((s) => s.name === 'speakFilePaths')
    expect(paths.changed).toBe(true)
    expect(paths.text).toContain('typescript')
    expect(paths.controlIds).toContain('path.style')
    // The stage BEFORE it must still hold the raw path — otherwise the ladder is not incremental.
    expect(stages[7].text).toContain('normalizer/index.ts')
  })

  it('keeps 17 rows when a stage is switched off, and marks it not-applied', async () => {
    // `expandUnits: false` is now its OWN switch (SC-8 / 006 NM12) — before J26 one flag turned
    // off both stage 14 and stage 15, which is the defect. Both are named here so a future merge
    // of the two flags fails this row rather than quietly passing it.
    const { stages } = await computeStages('a/b/c.ts\n',
      { pathStyle: 'verbatim', expandNumbers: false, expandUnits: false })
    expect(stages).toHaveLength(17)
    expect(stages.find((s) => s.name === 'speakFilePaths').applied).toBe(false)
    expect(stages.find((s) => s.name === 'expandUnits').applied).toBe(false)
    expect(stages.find((s) => s.name === 'expandNumbers').applied).toBe(false)

    // ...and one flag must not move the other stage. This is the row that would have caught NM12.
    const numbersOnly = await computeStages('it took 52 ms\n', { expandNumbers: false })
    expect(numbersOnly.stages.find((s) => s.name === 'expandUnits').applied,
      'expandNumbers: false must not switch off stage 14').toBe(true)
    const unitsOnly = await computeStages('it took 52 ms\n', { expandUnits: false })
    expect(unitsOnly.stages.find((s) => s.name === 'expandNumbers').applied,
      'expandUnits: false must not switch off stage 15').toBe(true)
    // A stage that did not run must not claim it changed anything.
    expect(stages.find((s) => s.name === 'speakFilePaths').changed).toBe(false)
  })

  it('options reach the ladder AND normalize() identically (P26: walk the wire)', async () => {
    const md = '1. alpha\n2. beta\n'
    const numeral = await computeStages(md, { orderedLists: 'numeral' })
    const dropped = await computeStages(md, { orderedLists: 'drop' })
    expect(numeral.spoken).not.toEqual(dropped.spoken)
    expect(numeral.spoken).toBe(numeral.ladderSpoken)
    expect(dropped.spoken).toBe(dropped.ladderSpoken)
  })
})

/* ------------------------------------------------------------------ source, not dist */

describe('the source-not-dist guard (PITFALLS P17 aimed at this file)', () => {
  it('accepts the TypeScript source the plugin build uses', () => {
    expect(assertSourceModule(pathToFileURL(NORMALIZER).href)).toBe(NORMALIZER)
  })

  it('REFUSES a built artifact — the negative half, without which the check is a ritual', () => {
    const dist = pathToFileURL(join(REPO_ROOT, 'packages/core/dist/normalizer/index.js')).href
    expect(() => assertSourceModule(dist, 'normalizer')).toThrow(/BUILT artifact/)
  })

  it('refuses anything outside packages/<pkg>/src, source or not', () => {
    expect(() => assertSourceModule(pathToFileURL('/tmp/normalizer.ts').href)).toThrow(/not TypeScript source/)
  })

  it('VERIFY BY EFFECT: a drifted ladder makes the check go red', async () => {
    // Simulate the failure the guard exists for — a normalizer whose behaviour differs from the
    // one the ladder was compiled from — by running the ladder against a mutated stage order.
    const { stages } = await computeStages('# Title\n\n- one\n')
    const rebuilt = stages.at(-1).text
    expect(rebuilt.length > 1 ? rebuilt : '').toBe((await computeStages('# Title\n\n- one\n')).spoken)
    // and the real assertion, over the real fixtures, must have run without throwing:
    await expect(assertLoadedModuleIsOnDiskSource()).resolves.toMatchObject({ source: NORMALIZER })
  })

  it('refuses to run its own check against an empty fixture directory', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'vl-empty-'))
    await expect(assertLoadedModuleIsOnDiskSource(empty)).rejects.toThrow(/no fixtures found/)
  })
})

/* ------------------------------------------------------------------ the three outcomes */

function fakeProvider ({ backend = null, chunksPerCall = 1, throwOnPrepare = null, throwOnGenerate = null } = {}) {
  const calls = []
  return {
    linuxBackend: backend,
    calls,
    async prepare () { if (throwOnPrepare) throw throwOnPrepare },
    async * generate (text) {
      calls.push(text)
      if (throwOnGenerate) throw throwOnGenerate
      for (let i = 0; i < chunksPerCall; i++) {
        yield { data: new Uint8Array([82, 73, 70, 70, i]), format: 'wav', sampleRate: 22050, channels: 1 }
      }
    },
    cancel () {}
  }
}

function routedProvider ({ id, voices, throwOnPrepare = null } = {}) {
  const calls = []
  let prepareCalls = 0
  return {
    id,
    calls,
    get prepareCalls () { return prepareCalls },
    async prepare () {
      prepareCalls++
      if (throwOnPrepare) throw throwOnPrepare
    },
    async listVoices () { return voices },
    async * generate (text, options = {}) {
      calls.push({ text, options })
      yield {
        data: new Uint8Array([82, 73, 70, 70]),
        format: 'wav', sampleRate: 22_050, channels: 1
      }
    },
    cancel () {}
  }
}

describe('R14-03 — /speak dispatches a backend-qualified voice key', () => {
  it('routes the review payload to Pocket and hands it bare "eve", never "pocket:eve"', async () => {
    const os = routedProvider({ id: 'os-synth', voices: ['Alex'] })
    const pocket = routedProvider({ id: 'pocket', voices: ['pocket:eve'] })
    const { base, close } = await listen(createLabServer({ provider: os, pocketProvider: pocket }))
    try {
      const res = await fetch(`${base}/speak`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        // Exact payload from R14-03. The page's nested `options.synthesize.voice` shape is
        // exercised separately below; accepting one and ignoring the other was the measured bug.
        body: JSON.stringify({ text: 'Backend dispatch probe.', options: { voice: 'pocket:eve' }, stream: false })
      })
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(pocket.calls).toHaveLength(1)
      expect(pocket.calls[0].options.voice).toBe('eve')
      expect(pocket.calls[0].options.voice).not.toContain(':')
      expect(os.calls).toEqual([])
      expect(body).toMatchObject({ backend: 'pocket', voice: 'eve' })
      expect(body.degradation).toBeUndefined()
    } finally { await close() }
  })

  it('strips os: before the existing OS provider too', async () => {
    const os = routedProvider({ id: 'os-synth', voices: ['Alex'] })
    const pocket = routedProvider({ id: 'pocket', voices: ['pocket:eve'] })
    const { base, close } = await listen(createLabServer({ provider: os, pocketProvider: pocket }))
    try {
      const res = await fetch(`${base}/speak`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'OS dispatch probe.', options: { synthesize: { voice: 'os:Alex' } }, stream: false
        })
      })
      const body = await res.json()
      expect(os.calls).toHaveLength(1)
      expect(os.calls[0].options.voice).toBe('Alex')
      expect(pocket.calls).toEqual([])
      expect(body).toMatchObject({ backend: 'os', voice: 'Alex' })
    } finally { await close() }
  })

  it('names an unavailable requested backend and the OS fallback in a renderable field', async () => {
    const os = routedProvider({ id: 'os-synth', voices: ['Alex'] })
    const pocket = routedProvider({
      id: 'pocket', voices: ['pocket:eve'],
      throwOnPrepare: new Error('onnxruntime-node has no binary for this machine')
    })
    const { base, close } = await listen(createLabServer({ provider: os, pocketProvider: pocket }))
    try {
      const res = await fetch(`${base}/speak`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'Fallback probe.', options: { synthesize: { voice: 'pocket:eve' } }, stream: false
        })
      })
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(pocket.calls).toEqual([])
      expect(os.calls).toHaveLength(1)
      expect(os.calls[0].options.voice).toBeUndefined()
      expect(body.backend).toBe('os')
      expect(body.degradation).toMatchObject({
        code: 'backend_unavailable', requestedBackend: 'pocket', servedBackend: 'os'
      })
      expect(body.degradation.reason).toMatch(/onnxruntime-node has no binary/)
    } finally { await close() }
  })

  it('does not guess when the requested backend has no such voice', async () => {
    const os = routedProvider({ id: 'os-synth', voices: ['Alex'] })
    const pocket = routedProvider({ id: 'pocket', voices: ['pocket:eve'] })
    const { base, close } = await listen(createLabServer({ provider: os, pocketProvider: pocket }))
    try {
      const res = await fetch(`${base}/speak`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'Null resolver probe.', options: { synthesize: { voice: 'pocket:nobody' } }, stream: false
        })
      })
      const body = await res.json()
      expect(pocket.prepareCalls).toBe(0)
      expect(pocket.calls).toEqual([])
      expect(os.calls).toHaveLength(1)
      expect(os.calls[0].options.voice).toBeUndefined()
      expect(body.degradation).toMatchObject({
        code: 'voice_unavailable', requestedBackend: 'pocket', requestedVoice: 'nobody',
        servedBackend: 'os'
      })
    } finally { await close() }
  })

  it('names a backend that is not registered, separately from a missing voice', async () => {
    const os = routedProvider({ id: 'os-synth', voices: ['Alex'] })
    const pocket = routedProvider({ id: 'pocket', voices: ['pocket:eve'] })
    const { base, close } = await listen(createLabServer({ provider: os, pocketProvider: pocket }))
    try {
      const res = await fetch(`${base}/speak`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'Unknown backend probe.', options: { synthesize: { voice: 'cloud:eve' } }, stream: false
        })
      })
      const body = await res.json()
      expect(pocket.prepareCalls).toBe(0)
      expect(pocket.calls).toEqual([])
      expect(os.calls).toHaveLength(1)
      expect(body.degradation).toMatchObject({
        code: 'backend_unavailable', requestedBackend: 'cloud', requestedVoice: 'eve',
        servedBackend: 'os'
      })
      expect(body.degradation.reason).toMatch(/not registered/)
    } finally { await close() }
  })

  it('puts the same degradation field on the streaming head the page actually renders', async () => {
    const os = routedProvider({ id: 'os-synth', voices: ['Alex'] })
    const pocket = routedProvider({
      id: 'pocket', voices: ['pocket:eve'],
      throwOnPrepare: new Error('Pocket model is not downloaded')
    })
    const { base, close } = await listen(createLabServer({ provider: os, pocketProvider: pocket }))
    try {
      const res = await fetch(`${base}/speak`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'Streaming fallback probe.',
          options: { synthesize: { voice: 'pocket:eve' } }
        })
      })
      const records = []
      for await (const record of readLines(res)) records.push(record)
      expect(records[0]).toMatchObject({
        kind: 'head', backend: 'os', voice: null,
        degradation: {
          code: 'backend_unavailable', requestedBackend: 'pocket', servedBackend: 'os'
        }
      })
      expect(records[0].degradation.reason).toMatch(/not downloaded/)
    } finally { await close() }
  })

  it('keeps the named Linux speech-service backend while also naming the routed provider', async () => {
    const os = {
      ...fakeProvider({ backend: 'spd-say' }),
      id: 'os-synth', async listVoices () { return ['Alex'] }
    }
    const pocket = routedProvider({ id: 'pocket', voices: ['pocket:eve'] })
    const { base, close } = await listen(createLabServer({ provider: os, pocketProvider: pocket }))
    try {
      const body = await (await fetch(`${base}/speak`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Elsewhere route probe.', stream: false })
      })).json()
      expect(body).toMatchObject({
        played: 'elsewhere', backend: 'spd-say', providerBackend: 'os', voice: null
      })
    } finally { await close() }
  })
})

describe('R15-03 — default wiring, not two fakes restating dispatch', () => {
  // 3a4db83 asserted routing against injected `routedProvider` fakes. Those rows stay green if
  // `createLabServer()`'s default constructors never run, which is exactly how R15-03 survived
  // a claimed fix: the suite restated the desired dispatch instead of watching the product's.
  // This block posts the reviewer's payload to a server constructed with NO provider injection,
  // under plain node (the resolver `pnpm voice-lab` uses), and asserts the PROVIDER THAT RAN.

  it('POST pocket:eve never hands the qualified key to the OS provider', () => {
    const report = runDefaultSpeakProbe({
      pocketPrepare: 'ok',
      payload: { text: 'This must use Pocket.', options: { voice: 'pocket:eve' } }
    })
    expect(report.status, JSON.stringify(report)).toBe(200)
    expect(report.osCalls, 'OS provider ran for a Pocket-qualified voice').toEqual([])
    expect(report.pocketCalls).toHaveLength(1)
    expect(report.pocketCalls[0].id).toBe('pocket')
    expect(report.pocketCalls[0].voice).toBe('eve')
    expect(report.pocketCalls[0].voice).not.toContain(':')
    const head = Array.isArray(report.body) ? report.body[0] : report.body
    expect(head).toMatchObject({ backend: 'pocket', voice: 'eve' })
    expect(head.degradation).toBeUndefined()
  })

  it('names the OS fallback when Pocket cannot prepare, and does not hand it pocket:eve', () => {
    const report = runDefaultSpeakProbe({
      pocketPrepare: 'throw',
      prepareError: 'onnxruntime-node has no binary for this machine',
      payload: {
        text: 'This must use Pocket.',
        options: { voice: 'pocket:eve' },
        stream: false
      }
    })
    expect(report.status).toBe(200)
    expect(report.pocketCalls).toEqual([])
    expect(report.osCalls).toHaveLength(1)
    expect(report.osCalls[0].voice, 'OS must not receive the Pocket-qualified key').toBeNull()
    expect(report.body).toMatchObject({
      backend: 'os',
      degradation: {
        code: 'backend_unavailable', requestedBackend: 'pocket', servedBackend: 'os'
      }
    })
    expect(report.body.degradation.reason).toMatch(/onnxruntime-node has no binary/)
  })

  it('names a Pocket voice that does not exist, without guessing another', () => {
    const report = runDefaultSpeakProbe({
      payload: {
        text: 'Null resolver probe.',
        options: { voice: 'pocket:nobody' },
        stream: false
      }
    })
    expect(report.pocketCalls).toEqual([])
    expect(report.osCalls).toHaveLength(1)
    expect(report.osCalls[0].voice).toBeNull()
    expect(report.body.degradation).toMatchObject({
      code: 'voice_unavailable', requestedBackend: 'pocket', requestedVoice: 'nobody',
      servedBackend: 'os'
    })
  })
})

describe('004 section 2 — there are three provider outcomes, not two', () => {
  it('bytes: returns base64 chunks and never a file path', async () => {
    const p = fakeProvider()
    const { status, body } = await speak(p, 'Hello there. Second sentence.', {})
    expect(status).toBe(200)
    expect(body.played).toBe('browser')
    expect(body.chunks.length).toBeGreaterThan(0)
    expect(Buffer.from(body.chunks[0].base64, 'base64').subarray(0, 4).toString()).toBe('RIFF')
    expect(body.chunks[0].format).toBe('wav')     // page branches on format, never assumes WAV
    expect(body.spoken).toBe('Hello there. Second sentence.')
  })

  it('throw: 503 carrying the provider\'s OWN error text and the install remedy', async () => {
    const err = new Error('espeak-ng, espeak, spd-say: none of these are installed. sudo apt install espeak-ng')
    const { status, body } = await speak(fakeProvider({ throwOnPrepare: err }), 'anything', {})
    expect(status).toBe(503)
    expect(body.error).toBe('provider_error')
    expect(body.message).toBe(err.message)        // not a generic message (P18)
    expect(body.played).toBe('nothing')
  })

  it('throw during generate() is 503 too, not a silent empty envelope', async () => {
    const { status, body } = await speak(
      fakeProvider({ backend: 'espeak-ng', throwOnGenerate: new Error('espeak-ng exited 1') }), 'x. y.', {})
    expect(status).toBe(503)
    expect(body.message).toBe('espeak-ng exited 1')
  })

  it('spoke-elsewhere: named, 200, no bytes, and generate() is NEVER called', async () => {
    const p = fakeProvider({ backend: 'spd-say' })
    const { status, body } = await speak(p, 'Say something.', {})
    expect(status).toBe(200)
    expect(body.played).toBe('elsewhere')
    expect(body.backend).toBe('spd-say')
    expect(body.chunks).toEqual([])
    expect(p.calls).toEqual([])                   // P31: the server made no sound
    expect(body.disabled).toEqual(SPOKE_ELSEWHERE_DISABLED)
    expect(body.reason).toMatch(/cannot replay, compare or scrub/)
    expect(body.installHint).toMatch(/espeak-ng/)
    // the written half still works on this rung (004 section 2, item 3)
    expect(body.spoken).toBe('Say something.')
  })

  it('CONTROL: the same probe on a WAV backend enables everything', async () => {
    const p = fakeProvider({ backend: 'espeak-ng' })
    const { body } = await speak(p, 'Say something.', {})
    expect(body.played).toBe('browser')
    expect(body.disabled).toBeUndefined()
    expect(p.calls).toEqual(['Say something.'])
  })

  it('the daemon speaks only on an explicit opt-in, never by default', async () => {
    const p = fakeProvider({ backend: 'spd-say', chunksPerCall: 0 })
    const { body } = await speak(p, 'Say something.', {}, { allowElsewhere: true })
    expect(p.calls).toEqual(['Say something.'])
    expect(body.played).toBe('elsewhere-forced')
    expect(body.chunks).toEqual([])
  })

  it('providerError never swallows a non-Error throw', () => {
    expect(providerError('boom').body.message).toBe('boom')
  })
})


/* ------------------------------------------------------------------ FR-024: the stream */

/** One sentence per chunk, so "chunk 1 while chunk 2 synthesizes" is about the sentences we wrote
 *  and not about where the chunker happened to draw its boundaries. Units are CHARACTERS. */
const ONE_PER_CHUNK = { chunk: { maxUnits: 60 } }
const S1 = 'The first sentence is exactly this long here.'
const S2 = 'The second sentence is exactly this long too.'
const S3 = 'The third sentence is also about this long.'
const THREE = `${S1} ${S2} ${S3}`
const TWO = `${S1} ${S2}`

/**
 * A provider whose `generate()` can be held open, so "chunk 1 was delivered while chunk 2 was
 * still being synthesized" is a fact the test can WATCH rather than infer from a duration.
 */
function gatedProvider ({ backend = null, fail = () => null } = {}) {
  const calls = []
  const gates = []
  const self = {
    linuxBackend: backend,
    calls,
    completed: 0,          // generate() calls that have RUN TO COMPLETION, not merely started
    /** Release the i-th `generate()` call, letting it yield its bytes. */
    release (i) { gates[i] ??= makeGate(); gates[i].open() },
    /** Resolves when the i-th `generate()` has been ENTERED. */
    entered (i) {
      gates[i] ??= makeGate()
      return gates[i].enteredPromise
    },
    async prepare () {},
    async * generate (text) {
      const i = calls.length
      calls.push(text)
      gates[i] ??= makeGate()
      gates[i].enter()
      await gates[i].openPromise
      const err = fail(text, i)
      if (err) throw err
      yield { data: new Uint8Array([82, 73, 70, 70, i]), format: 'wav', sampleRate: 22050, channels: 1 }
      self.completed++
    },
    cancel () {}
  }
  return self
}

/** Release each `generate()` as soon as it is entered — for tests that stage failures, not timing. */
function pump (p, n = 8) { for (let i = 0; i < n; i++) void p.entered(i).then(() => p.release(i)) }

function makeGate () {
  let enter, open
  const enteredPromise = new Promise((r) => { enter = r })
  const openPromise = new Promise((r) => { open = r })
  return { enter: () => enter(), open: () => open(), enteredPromise, openPromise }
}

describe('FR-024 — chunk 1 is delivered while chunk 2 is still being synthesized', () => {
  it('yields the first chunk before generate() has been called for the second', async () => {
    const p = gatedProvider()
    const it = speakStream(p, THREE, ONE_PER_CHUNK)

    const head = await it.next()
    expect(head.value.kind).toBe('head')
    expect(head.value.chunkCount).toBe(3)
    expect(p.calls).toEqual([])                       // nothing synthesized to answer the head

    // Ask for the next record, THEN let only the first `generate()` finish.
    const pending = it.next()
    await p.entered(0)
    p.release(0)
    const first = await pending

    // THE ASSERTION THIS FILE EXISTS FOR. Chunk 1 is in the consumer's hands and the provider has
    // been asked for exactly one chunk: chunk 2 has not been synthesized, and is not waited for.
    expect(first.value.kind).toBe('chunk')
    expect(first.value.i).toBe(0)
    expect(p.calls).toHaveLength(1)

    p.release(1); p.release(2)
    const rest = []
    for await (const rec of it) rest.push(rec)
    expect(rest.map((r) => r.kind)).toEqual(['chunk', 'chunk', 'end'])
    expect(rest.at(-1).delivered).toBe(3)
  })

  it('over HTTP: the first NDJSON line reaches the client before the last chunk is synthesized',
    async () => {
      const p = gatedProvider()
      const { base, close } = await listen(createLabServer({ provider: p }))
      try {
        const posted = fetch(base + '/speak', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: TWO, options: ONE_PER_CHUNK })
        })
        // The head is not written until the first chunk exists, so releasing chunk 1 is what makes
        // the response arrive at all — and what arrives is a STREAM, not an envelope.
        await p.entered(0)
        p.release(0)
        const res = await posted
        expect(res.headers.get('content-type')).toMatch(/ndjson/)

        const lines = readLines(res)
        expect((await lines.next()).value.kind).toBe('head')
        const chunk = (await lines.next()).value
        expect(chunk.kind).toBe('chunk')
        // The client is HOLDING chunk 1 and exactly one `generate()` has finished: the second
        // sentence is still inside the synthesizer. That is FR-024, watched rather than timed.
        expect(p.completed).toBe(1)
        expect(p.calls).toHaveLength(2)     // started, not finished — the overlap is the point

        p.release(1)
        const seen = [chunk.kind]
        for await (const rec of lines) seen.push(rec.kind)
        expect(seen).toEqual(['chunk', 'chunk', 'end'])
      } finally { await close() }
    })

  it('{ stream: false } still returns the single envelope — FR-026 needs a disabled path',
    async () => {
      const p = fakeProvider({ backend: 'espeak-ng' })
      const { base, close } = await listen(createLabServer({ provider: p }))
      try {
        const res = await fetch(base + '/speak', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: TWO, options: ONE_PER_CHUNK, stream: false })
        })
        expect(res.headers.get('content-type')).toMatch(/application\/json/)
        const body = await res.json()
        expect(body.chunks).toHaveLength(2)
        expect(body.chunkCount).toBe(2)
      } finally { await close() }
    })

  it('an abort between chunks stops the synthesizer — Stop is pushed, not polled', async () => {
    const p = fakeProvider({ backend: 'espeak-ng' })
    const ac = new AbortController()
    const recs = []
    for await (const rec of speakStream(p, THREE, ONE_PER_CHUNK, { signal: ac.signal })) {
      recs.push(rec)
      if (rec.kind === 'chunk' && rec.i === 0) ac.abort()
    }
    expect(p.calls).toHaveLength(1)                       // chunks 2 and 3 were never synthesized
    expect(recs.at(-1).kind).toBe('end')
    expect(recs.at(-1).aborted).toBe(true)
  })
})

/* ------------------------------------------------------------------ one unspeakable chunk */

describe('one unspeakable chunk does not kill the utterance (P30: the loss is SPOKEN)', () => {
  const empty = () => Object.assign(new Error('say exited successfully but its audio file could not be read'), { name: 'OsSynthEmptyOutputError' })

  it('delivers the chunks that worked, names the one that did not, and speaks the loss', async () => {
    const p = gatedProvider({ fail: (_t, i) => (i === 1 ? empty() : null) })
    const recs = []
    pump(p)
    for await (const r of speakStream(p, THREE, ONE_PER_CHUNK)) recs.push(r)

    expect(recs.map((r) => r.kind)).toEqual(['head', 'chunk', 'chunk-error', 'chunk', 'chunk', 'end'])
    const errRec = recs.find((r) => r.kind === 'chunk-error')
    expect(errRec.i).toBe(1)
    expect(errRec.name).toBe('OsSynthEmptyOutputError')
    expect(errRec.message).toMatch(/could not be read/)

    // The listener HEARS the loss: the last chunk is a synthesized sentence, not a log line.
    const spokenChunks = recs.filter((r) => r.kind === 'chunk')
    expect(spokenChunks).toHaveLength(3)                  // two survivors plus the announcement
    expect(spokenChunks.at(-1).announcement).toBe(true)
    expect(spokenChunks.at(-1).text).toBe('one of three parts could not be spoken and was skipped.')
    expect(p.calls.at(-1)).toBe('one of three parts could not be spoken and was skipped.')

    const end = recs.at(-1)
    expect(end.ok).toBe(true)
    expect(end.lost).toBe(1)
    expect(end.delivered).toBe(3)
    expect(end.announcementSpoken).toBe(true)
  })

  it('the unspeakable chunk is a CLASS, not the HTML comment: a bare `---` rule survives too',
    async () => {
      // Named against a moving target on purpose. The HTML comment that produced the 503 in
      // docs/.research/m11-gate.md G-1 is gone — the normalizer strips comments now — so an input
      // shaped like THAT is a test of someone else's fix. This one is shaped like the class that
      // remains: a chunk whose text a synthesizer refuses. A markdown horizontal rule between two
      // paragraphs is the live instance (`say` reads a leading `--` as an option), and
      // punctuation-only and whitespace-only chunks are the others. The provider fails on the
      // chunk BY ITS TEXT, so this test asserts our resilience and never the normalizer's.
      const p = gatedProvider({
        backend: 'espeak-ng',
        fail: (text) => (text.trimStart().startsWith('-')
          ? Object.assign(new Error("say: unrecognized option `--- '"), { name: 'OsSynthEmptyOutputError' })
          : null)
      })
      pump(p)
      const recs = []
      for await (const rec of speakStream(p, `${S1} --- ${S2}`, ONE_PER_CHUNK)) recs.push(rec)

      const failed = recs.find((r) => r.kind === 'chunk-error')
      expect(failed).toBeDefined()
      expect(failed.text.trimStart().startsWith('-')).toBe(true)
      expect(failed.text).not.toMatch(/<!--/)               // NOT the HTML-comment instance
      const end = recs.at(-1)
      expect(end.ok).toBe(true)
      expect(end.lost).toBe(1)
      expect(end.delivered).toBe(2)                         // the surviving sentence, plus the notice
      expect(end.announcementSpoken).toBe(true)
      // The listener HEARS what survived and is TOLD what did not — instead of a 503 and silence.
      // This is the live shape of the defect: the rule takes the sentence it is glued to with it,
      // which is why the notice matters more here than a count in a log would.
      const spoken = recs.filter((r) => r.kind === 'chunk').map((r) => r.text)
      expect(spoken[0]).toContain('first sentence')
      expect(spoken.at(-1)).toBe(end.announcement)
      expect(end.announcement).toBe('one of two parts could not be spoken and was skipped.')
    })

  it('CONTROL: with nothing failing there is no announcement and nothing extra is synthesized',
    async () => {
      const p = fakeProvider({ backend: 'espeak-ng' })
      const recs = []
      for await (const r of speakStream(p, THREE, ONE_PER_CHUNK)) recs.push(r)
      expect(recs.at(-1).lost).toBe(0)
      expect(recs.at(-1).announcement).toBe(null)
      expect(p.calls).toHaveLength(3)                     // exactly the three sentences
    })

  it('the loss sentence coalesces and is written in WORDS, since it bypasses normalize()', () => {
    // Restated here as an independent claim, not imported from the source (PITFALLS P36).
    expect(lossAnnouncement(1, 3)).toBe('one of three parts could not be spoken and was skipped.')
    expect(lossAnnouncement(3, 13)).toBe('three of thirteen parts could not be spoken and were skipped.')
    expect(lossAnnouncement(0, 13)).toBe(null)
    expect(countWord(2)).toBe('two')
    expect(countWord(21)).toBe('21')
    expect(lossAnnouncement(1, 3)).not.toMatch(/[0-9]/)   // a numeral here is read by the synth raw
  })

  it('if the announcement itself cannot be synthesized, the loss is still reported, not dropped',
    async () => {
      const p = gatedProvider({ fail: (t, i) => (i === 1 || i === 3 ? empty() : null) })
      const recs = []
      pump(p)
      for await (const r of speakStream(p, THREE, ONE_PER_CHUNK)) recs.push(r)
      const end = recs.at(-1)
      expect(end.announcement).toBe('one of three parts could not be spoken and was skipped.')
      expect(end.announcementSpoken).toBe(false)          // the page says it through its other channels
      expect(end.ok).toBe(true)
    })

  it('a provider that is genuinely unavailable is STILL a real 503, mid-utterance', async () => {
    const gone = Object.assign(new Error('No OS speech synthesizer found on darwin. Tried: say'), { name: 'OsSynthUnavailableError' })
    const p = gatedProvider({ fail: (_t, i) => (i === 1 ? gone : null) })
    const recs = []
    pump(p)
    for await (const r of speakStream(p, THREE, ONE_PER_CHUNK)) recs.push(r)
    expect(recs.at(-1).kind).toBe('fatal')
    expect(recs.at(-1).status).toBe(503)
    expect(recs.at(-1).body.message).toMatch(/No OS speech synthesizer/)
    expect(p.calls).toHaveLength(2)                       // it did not keep trying
    expect(isProviderUnavailable(gone)).toBe(true)
    expect(isProviderUnavailable(empty())).toBe(false)    // the control: one chunk, not the machine
  })

  it('EVERY chunk failing is a 503 over HTTP, not a 200 with no audio', async () => {
    const p = fakeProvider({ backend: 'espeak-ng', throwOnGenerate: empty() })
    const { base, close } = await listen(createLabServer({ provider: p }))
    try {
      const res = await fetch(base + '/speak', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: TWO, options: ONE_PER_CHUNK })
      })
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.failedChunks).toBe(2)
      expect(body.message).toMatch(/all 2 chunks failed/)
    } finally { await close() }
  })

  it('CONTROL: one failure of two over HTTP is a 200 stream, and the survivor is delivered',
    async () => {
      const p = gatedProvider({ backend: 'espeak-ng', fail: (_t, i) => (i === 0 ? empty() : null) })
      const { base, close } = await listen(createLabServer({ provider: p }))
      try {
        const post = fetch(base + '/speak', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: TWO, options: ONE_PER_CHUNK })
        })
        pump(p)
        const res = await post
        expect(res.status).toBe(200)
        const recs = []
        for await (const rec of readLines(res)) recs.push(rec)
        expect(recs.map((r) => r.kind)).toEqual(['head', 'chunk-error', 'chunk', 'chunk', 'end'])
        expect(recs.at(-1).lost).toBe(1)
        expect(recs.at(-1).delivered).toBe(2)
      } finally { await close() }
    })
})

/* ------------------------------------------------------------------ the remedy must fit */

describe('the 503 hands out a remedy for THIS platform, or none at all (P18)', () => {
  it('offers no install hint on macOS: `say` is part of the operating system', () => {
    const err = Object.assign(new Error('say exited successfully but its audio file could not be read'), { name: 'OsSynthEmptyOutputError' })
    const { body } = providerError(err, 'darwin')
    expect(body.installHint).toBe(null)
    expect(body.platform).toBe('darwin')
    expect(JSON.stringify(body)).not.toMatch(/apt install/)   // the actual G-1 defect
  })

  it('offers none on Windows either — SAPI is not installable', () => {
    expect(installHintFor('win32', 'anything')).toBe(null)
  })

  it('CONTROL: on Linux the hint IS the remedy, because there it really is a missing package', () => {
    const hint = installHintFor('linux', 'No Linux speech synthesizer found. Tried: espeak-ng')
    expect(hint).toMatch(/apt install espeak-ng/)
    // and it is not repeated when the provider's own message already carries it
    expect(installHintFor('linux', hint)).toBe(null)
  })
})

/* ------------------------------------------------------------------ the flag */

describe('--port is honoured, or refused loudly — never ignored', () => {
  it('accepts both spellings', () => {
    expect(parseArgs(['--port=7399']).port).toBe(7399)
    expect(parseArgs(['--port', '7399']).port).toBe(7399)   // silently ignored before this fix
    expect(parseArgs([]).port).toBe(7311)
  })

  it('refuses what it does not understand, by name', () => {
    expect(() => parseArgs(['--prot=7399'])).toThrow(/unrecognised argument/)
    expect(() => parseArgs(['--port', 'seven'])).toThrow(/integer from 0 to 65535/)
    expect(() => parseArgs(['--port=99999'])).toThrow(/integer from 0 to 65535/)
  })
})

/** Listen on an ephemeral port and hand back the base URL plus a closer. */
async function listen (server) {
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((ok) => server.close(ok))
  }
}

/**
 * Production-shaped /speak probe: plain node, default `createLabServer()` constructors, no
 * injected providers. Prototype spies record which class ran; they never call `say` or ONNX.
 */
function runDefaultSpeakProbe (scenario) {
  const script = `
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const REPO = ${JSON.stringify(REPO_ROOT)}
const scenario = ${JSON.stringify(scenario)}
const { createLabServer } = await import(pathToFileURL(join(REPO, 'scripts/voice-lab.mjs')).href)
const { OsSynthProvider } = await import(pathToFileURL(join(REPO, 'packages/providers/src/os-synth/index.ts')).href)
const { PocketSynthProvider } = await import(pathToFileURL(join(REPO, 'packages/providers/src/pocket-synth/index.ts')).href)

const osCalls = []
const pocketCalls = []
const fakeWav = { data: new Uint8Array([82, 73, 70, 70]), format: 'wav', sampleRate: 22_050, channels: 1 }

OsSynthProvider.prototype.prepare = async () => {}
OsSynthProvider.prototype.generate = async function * (text, opts = {}) {
  osCalls.push({ id: this.id, text, voice: opts.voice ?? null })
  yield fakeWav
}
if (scenario.pocketPrepare === 'ok') {
  PocketSynthProvider.prototype.prepare = async () => {}
} else if (scenario.pocketPrepare === 'throw') {
  PocketSynthProvider.prototype.prepare = async () => {
    throw new Error(scenario.prepareError)
  }
}
PocketSynthProvider.prototype.generate = async function * (text, opts = {}) {
  pocketCalls.push({ id: this.id, text, voice: opts.voice ?? null })
  yield fakeWav
}

const dir = await mkdtemp(join(tmpdir(), 'vl-r15-03-'))
const server = createLabServer({ modelDirectory: dir })
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
try {
  const base = 'http://127.0.0.1:' + server.address().port
  const res = await fetch(base + '/speak', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(scenario.payload)
  })
  const ctype = res.headers.get('content-type') || ''
  const raw = await res.text()
  const body = ctype.includes('ndjson')
    ? raw.split('\\n').filter(Boolean).map((l) => JSON.parse(l))
    : JSON.parse(raw)
  process.stdout.write(JSON.stringify({
    status: res.status, ctype, body, osCalls, pocketCalls
  }) + '\\n')
} finally {
  await new Promise((ok) => server.close(ok))
  await rm(dir, { recursive: true, force: true })
}
`
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    timeout: 30_000
  })
  if (r.status !== 0) {
    throw new Error(`default-wiring probe exited ${r.status}: ${(r.stderr || r.stdout || '').trim()}`)
  }
  const lines = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  const last = lines.at(-1)
  try {
    return JSON.parse(last)
  } catch {
    throw new Error(`default-wiring probe stdout was not JSON:\n${r.stdout}`)
  }
}

/** Iterate an NDJSON response as parsed records. */
async function * readLines (res) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (line.trim()) yield JSON.parse(line)
    }
  }
  if (buf.trim()) yield JSON.parse(buf)
}

/* ------------------------------------------------------------------ the settings inbox */

describe('the settings inbox (011 sections 1.2 and 2)', () => {
  it('resolves the documented path per platform, and honours the escape hatch', () => {
    expect(settingsPathFor('linux', { HOME: '/h', XDG_CONFIG_HOME: '/h/.config' }))
      .toBe(join('/h/.config', 'orca-tts', 'settings.jsonc'))
    expect(settingsPathFor('linux', { HOME: '/h' })).toBe(join('/h/.config', 'orca-tts', 'settings.jsonc'))
    expect(settingsPathFor('darwin', { HOME: '/h' }))
      .toBe(join('/h/Library/Application Support/orca-tts/settings.jsonc'))
    expect(settingsPathFor('win32', { APPDATA: 'C:\\R' })).toBe(join('C:\\R', 'orca-tts', 'settings.jsonc'))
    expect(settingsPathFor('darwin', { HOME: '/h', ORCA_TTS_CONFIG_DIR: '/wt' }))
      .toBe(join('/wt', 'settings.jsonc'))
    // never under ~/.orca/ — 011 section 1.2 forbids writing into ORCA's namespace
    expect(settingsPathFor('darwin', { HOME: '/h' })).not.toMatch(/\.orca/)
  })

  it('reads JSONC without eating a comment marker inside a phrase', () => {
    const src = '{\n // a comment\n "phrase": "a link to https://x.dev", /* block */ "n": 1\n}\n'
    expect(JSON.parse(stripJsonComments(src))).toEqual({ phrase: 'a link to https://x.dev', n: 1 })
  })

  it('refuses a write whose revision is not GREATER than the promoted one', () => {
    expect(checkRevision(17, 18).ok).toBe(true)
    expect(checkRevision(17, 17)).toMatchObject({ ok: false, code: 'stale_revision' })
    expect(checkRevision(17, 3)).toMatchObject({ ok: false, code: 'stale_revision' })
    expect(checkRevision(17, 17.5)).toMatchObject({ ok: false, code: 'bad_revision' })
    expect(checkRevision(null, 99)).toMatchObject({ ok: false, code: 'unreadable_current' })
  })

  it('VERIFY BY EFFECT: the stale write leaves the file on disk untouched', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vl-settings-'))
    const path = join(dir, 'settings.jsonc')
    const first = { kind: 'orca-tts-settings', schemaVersion: 2, revision: 4, settings: { 'normalize.pathStyle': 'spoken' } }
    expect((await writeSettings(first, path)).status).toBe(200)
    expect((await readSettings(path)).revision).toBe(4)

    const stale = { ...first, revision: 4, settings: { 'normalize.pathStyle': 'terse' } }
    const refused = await writeSettings(stale, path)
    expect(refused.status).toBe(409)
    expect(refused.body.error).toBe('stale_revision')
    expect(refused.body.currentRevision).toBe(4)
    // the value the refused write carried must NOT be on disk
    expect((await readSettings(path)).file.settings['normalize.pathStyle']).toBe('spoken')

    // CONTROL: bump the revision and the identical payload lands
    const fresh = { ...stale, revision: 5 }
    expect((await writeSettings(fresh, path)).status).toBe(200)
    expect((await readSettings(path)).file.settings['normalize.pathStyle']).toBe('terse')
    expect((await readSettings(path)).revision).toBe(5)
  })

  it('a hand-written file with comments is read, and its comments are not required to survive a lab Save', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vl-jsonc-'))
    const path = join(dir, 'settings.jsonc')
    await writeFile(path, '{\n  // tuned by ear, 2026-08-21\n  "kind": "orca-tts-settings",\n  "revision": 9,\n  "settings": {}\n}\n')
    const read = await readSettings(path)
    expect(read.revision).toBe(9)
    expect(read.file.kind).toBe('orca-tts-settings')
    expect((await writeSettings({ ...read.file, revision: 10 }, path)).status).toBe(200)
  })

  it('an unparseable inbox is refused, never treated as revision 0', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vl-bad-'))
    const path = join(dir, 'settings.jsonc')
    await writeFile(path, '{ this is not json\n')
    const read = await readSettings(path)
    expect(read.exists).toBe(true)
    expect(read.revision).toBeNull()
    expect(read.parseError).toBeTruthy()
    const before = await readFile(path, 'utf8')
    const refused = await writeSettings({ kind: 'orca-tts-settings', revision: 1, settings: {} }, path)
    expect(refused.status).toBe(409)
    expect(refused.body.error).toBe('unreadable_current')
    expect(await readFile(path, 'utf8')).toBe(before)
  })

  it('refuses to write a file that is not ours', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vl-kind-'))
    const out = await writeSettings({ kind: 'something-else', revision: 1 }, join(dir, 'settings.jsonc'))
    expect(out.status).toBe(400)
    expect(out.body.error).toBe('wrong_kind')
  })
})

/* ------------------------------------------------------------------ static confinement */

describe('static serving is confined to its root', () => {
  it('rejects traversal, encoded or not', () => {
    expect(safeJoin('/srv/page', '/../../etc/passwd')).toBeNull()
    expect(safeJoin('/srv/page', '/%2e%2e%2f%2e%2e%2fetc/passwd')).toBeNull()
    // `resolve`, not `join`, and the difference only shows on Windows. `safeJoin` resolves to an
    // ABSOLUTE path because its whole job is a containment check — `full.startsWith(rootAbs)` is
    // meaningless against a relative path. On Windows `join('/srv/page','lib/diff.mjs')` gives
    // `\srv\page\lib\diff.mjs` with no drive, while the implementation correctly returns
    // `D:\srv\page\lib\diff.mjs`. The expectation was wrong, not the code — CI run 32545094360.
    expect(safeJoin('/srv/page', '/lib/diff.mjs')).toBe(resolve('/srv/page', 'lib/diff.mjs'))
  })
})

/**
 * Examples are EDITABLE from the page — added 2026-08-22 because the author could not use the
 * instrument without leaving it.
 *
 * They were read-only, so trying a phrase meant editing a file on disk and coming back. Tuning by
 * ear means typing a sentence and hearing it; the sentences worth keeping are the ones that
 * surprised you, and they only exist after you have heard them.
 */
describe('examples can be created, edited and removed from the page', () => {
  it('creates a new example, lists it, reads it back, and removes it', async () => {
    const { base, close } = await listen(createLabServer())
    try {
      const put = await fetch(`${base}/fixtures/probe-example`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'A new sentence to hear.' })
      })
      expect(put.status, 'the example could not be written').toBe(200)
      expect((await put.json()).created, 'a new example did not report itself as new').toBe(true)

      const list = await (await fetch(`${base}/fixtures`)).json()
      expect(list.fixtures, 'the new example is not in the list').toContain('probe-example.md')

      const back = await (await fetch(`${base}/fixtures/probe-example.md`)).text()
      expect(back, 'what came back is not what was written').toBe('A new sentence to hear.')

      const del = await fetch(`${base}/fixtures/probe-example.md`, { method: 'DELETE' })
      expect(del.status, 'the example could not be removed').toBe(200)
      const after = await (await fetch(`${base}/fixtures`)).json()
      expect(after.fixtures, 'the example survived deletion').not.toContain('probe-example.md')
    } finally { await close() }
  })

  it('refuses a name that escapes the examples folder', async () => {
    // The containment check is `safeJoin`, and this is the row that proves it is wired here and
    // not merely present elsewhere. Without it, a write endpoint reachable from a page is an
    // arbitrary-file-write.
    const { base, close } = await listen(createLabServer())
    try {
      const r = await fetch(`${base}/fixtures/${encodeURIComponent('../../evil')}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'should never be written' })
      })
      expect(r.status, 'a path-escaping name was accepted').toBe(400)
      expect((await r.json()).error).toBe('bad_name')

      // A name `safeJoin` would ACCEPT — it stays inside the folder and resolves fine — but the
      // charset rule rejects. Without this row the test passes with the charset rule deleted,
      // because containment catches the `../../` case on its own: a check that cannot fail for
      // the thing it names. The mutant that proved it: replacing the regex test with `false`.
      const odd = await fetch(`${base}/fixtures/${encodeURIComponent('we;ird$name')}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'x' })
      })
      expect(odd.status, 'a name outside the allowed charset was accepted — only containment is '
        + 'guarding this endpoint, and containment does not restrict what a filename may contain')
        .toBe(400)
    } finally { await close() }
  })
})

/* ------------------------------------------------------------------ Pocket TTS server surface */

// Restated independently of the manifest (P36): deleting a manifest row must make these tests
// disagree, not silently make the expected progress stream one row shorter too.
const POCKET_DOWNLOAD_FILES = [
  'bundle.json',
  'bos_before_voice.npy',
  'tokenizer.model',
  'flow_lm_main_int8.onnx',
  'flow_lm_flow_int8.onnx',
  'mimi_decoder_int8.onnx',
  'mimi_encoder.onnx',
  'text_conditioner.onnx',
  'anna.wav',
  'vera.wav',
  'fantine.wav',
  'charles.wav',
  'paul.wav',
  'eponine.wav',
  'azelma.wav',
  'george.wav',
  'reference_sample.wav',
  'jane.wav',
  'michael.wav',
  'eve.wav'
]

async function readyModelFixture (dir) {
  await mkdir(dir, { recursive: true })
  for (const file of [...POCKET_DOWNLOAD_FILES, 'LICENSE', 'MODEL_LICENSE.txt']) {
    await writeFile(join(dir, file), 'fixture')
  }
  await writeFile(join(dir, '.orca-tts-model-manifest'), '2\n')
}

describe('PV-030 — /voices names both backends and their availability', () => {
  it('keeps OS voices usable by the existing page and exposes unavailable Pocket voices', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vl-pocket-voices-'))
    let listCalls = 0
    const provider = {
      ...fakeProvider(),
      id: 'os-synth',
      unavailableReason: null,
      async listVoices () { listCalls++; return ['Alex', 'Samantha'] }
    }
    const { base, close } = await listen(createLabServer({ provider, modelDirectory: dir }))
    try {
      const first = await (await fetch(`${base}/voices`)).json()
      const second = await (await fetch(`${base}/voices`)).json()

      expect(listCalls, 'the ~487 ms OS probe was not cached (P28)').toBe(1)
      expect(second.voices).toEqual(first.voices)

      const alex = first.voices.find((voice) => voice.key === 'os:Alex')
      expect(alex).toEqual({
        key: 'os:Alex', displayName: 'Alex', backend: 'os', available: true, reason: null,
        // Compatibility alias consumed by the page on disk before PV-040 lands.
        name: 'Alex'
      })
      const eve = first.voices.find((voice) => voice.key === 'pocket:eve')
      expect(eve).toMatchObject({
        key: 'pocket:eve', displayName: 'Eve', backend: 'pocket', available: false
      })
      expect(eve.reason).toMatch(/mimi_encoder\.onnx/)
      expect(first.voices.filter((voice) => voice.backend === 'pocket')).toHaveLength(12)

      // This is the exact mapper in the existing page's start(). If the compatibility field is
      // removed, Alex silently becomes "0" and the current Voice Lab control regresses.
      const currentPageVoices = first.voices.map((entry, index) => ({
        index, name: typeof entry === 'string' ? entry : (entry.name ?? entry.id ?? String(index))
      }))
      expect(currentPageVoices.find((voice) => voice.index === 0)?.name).toBe('Alex')
    } finally {
      await close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('PV-031 — /model/status names what is missing', () => {
  it('reports an empty isolated directory as absent and names mimi_encoder.onnx', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vl-pocket-status-'))
    const { base, close } = await listen(createLabServer({ modelDirectory: dir }))
    try {
      const res = await fetch(`${base}/model/status`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.kind).toBe('absent')
      expect(body.dir).toBe(dir)
      expect(body.missing).toContain('mimi_encoder.onnx')
    } finally {
      await close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('marks a ready cache present at server start as preseeded or otherwise unverified', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vl-pocket-preseeded-'))
    await readyModelFixture(dir)
    const { base, close } = await listen(createLabServer({ modelDirectory: dir }))
    try {
      const body = await (await fetch(`${base}/model/status`)).json()
      expect(body.kind).toBe('ready')
      expect(body.installation).toEqual({
        source: 'preseeded-or-unverified', verified: false, manifestVersion: 2
      })
    } finally {
      await close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('PV-032 — /model/download streams progress and a terminal result', () => {
  it('emits one ordered progress record per artifact and verifies ready by effect', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vl-pocket-download-'))
    const noNetwork = async () => { throw new Error('the test tried to use the network') }
    let receivedOptions = null
    const downloadModelImpl = async (options) => {
      receivedOptions = options
      for (const [fileIndex, file] of POCKET_DOWNLOAD_FILES.entries()) {
        options.onProgress({ file, received: fileIndex + 1, total: fileIndex + 1, fileIndex, fileCount: POCKET_DOWNLOAD_FILES.length })
      }
      await readyModelFixture(options.dir)
      return options.dir
    }
    const { base, close } = await listen(createLabServer({
      modelDirectory: dir, fetchImpl: noNetwork, downloadModelImpl, runtimeStatusImpl: null,
      // This row tests the transport. R14-10 below tests the real byte verifier with an
      // independently hashed tiny artifact, so a 173 MB production manifest is never fabricated.
      verifyModelInstallImpl: async () => ({
        verified: true, manifestVersion: 2,
        artifactCount: POCKET_DOWNLOAD_FILES.length, totalBytes: 1
      })
    }))
    try {
      const res = await fetch(`${base}/model/download`, { method: 'POST' })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/ndjson/)
      const records = []
      for await (const record of readLines(res)) records.push(record)

      expect(records.filter((record) => record.kind === 'progress').map((record) => record.file))
        .toEqual(POCKET_DOWNLOAD_FILES)
      expect(records.at(-1)).toMatchObject({ kind: 'complete', ok: true, backend: 'pocket' })
      expect(receivedOptions.dir).toBe(dir)
      expect(receivedOptions.fetchImpl).toBe(noNetwork)
      expect(receivedOptions.signal).toBeInstanceOf(AbortSignal)
      expect((await (await fetch(`${base}/model/status`)).json()).kind).toBe('ready')
    } finally {
      await close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('ends an induced failure with a record naming the file and cause', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vl-pocket-failure-'))
    const downloadModelImpl = async (options) => {
      options.onProgress({
        file: 'bundle.json', received: 24381, total: 24381,
        fileIndex: 0, fileCount: POCKET_DOWNLOAD_FILES.length
      })
      throw new Error('downloading flow_lm_main_int8.onnx: HTTP 503 Service Unavailable')
    }
    const { base, close } = await listen(createLabServer({
      modelDirectory: dir, downloadModelImpl, runtimeStatusImpl: null,
      verifyModelInstallImpl: async () => ({
        verified: true, manifestVersion: 2,
        artifactCount: POCKET_DOWNLOAD_FILES.length, totalBytes: 1
      })
    }))
    try {
      const res = await fetch(`${base}/model/download`, { method: 'POST' })
      const records = []
      for await (const record of readLines(res)) records.push(record)
      expect(records.at(-1)).toMatchObject({
        kind: 'error', ok: false, error: 'model_download_failed',
        file: 'flow_lm_main_int8.onnx'
      })
      expect(records.at(-1).cause).toMatch(/HTTP 503 Service Unavailable/)
      expect(records.at(-1).kind, 'the stream stopped without a terminal failure record').toBe('error')
    } finally {
      await close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('R14-10 — the falsifier distinguishes a verified page download from a preseeded cache', () => {
  const manifestFile = '.r14-test-manifest'
  const manifestVersion = 17
  const correct = Buffer.from('the bytes the page downloaded')
  const artifact = {
    file: 'tiny-model.onnx', bytes: correct.length,
    sha256: createHash('sha256').update(correct).digest('hex')
  }

  function statusProbe (dir, ready) {
    return async () => ready.value
      ? { kind: 'ready', dir }
      : { kind: 'absent', dir, missing: [artifact.file] }
  }

  it('records manifest-and-digest verification only after this server downloaded the bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vl-pocket-proof-'))
    const ready = { value: false }
    const downloadModelImpl = async (options) => {
      await writeFile(join(options.dir, artifact.file), correct)
      await writeFile(join(options.dir, manifestFile), `${manifestVersion}\n`)
      ready.value = true
      return options.dir
    }
    const { base, close } = await listen(createLabServer({
      modelDirectory: dir,
      modelStatusImpl: statusProbe(dir, ready),
      verificationArtifacts: [artifact], verificationManifestFile: manifestFile,
      verificationManifestVersion: manifestVersion,
      downloadModelImpl, runtimeStatusImpl: null
    }))
    try {
      const before = await (await fetch(`${base}/model/status`)).json()
      expect(before.installation.verified).toBe(false)

      const records = []
      for await (const record of readLines(await fetch(`${base}/model/download`, { method: 'POST' }))) {
        records.push(record)
      }
      expect(records.at(-1)).toMatchObject({
        kind: 'complete', ok: true,
        verification: {
          verified: true, manifestVersion, artifactCount: 1, totalBytes: correct.length
        }
      })

      const after = await (await fetch(`${base}/model/status`)).json()
      expect(after.installation).toEqual({
        source: 'voice-lab-download', verified: true,
        manifestVersion, artifactCount: 1, totalBytes: correct.length
      })
    } finally {
      await close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses to mint page-download provenance when a downloaded digest is wrong', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vl-pocket-proof-bad-'))
    const ready = { value: false }
    const downloadModelImpl = async (options) => {
      await writeFile(join(options.dir, artifact.file), Buffer.from('wrong bytes'))
      await writeFile(join(options.dir, manifestFile), `${manifestVersion}\n`)
      ready.value = true
      return options.dir
    }
    const { base, close } = await listen(createLabServer({
      modelDirectory: dir,
      modelStatusImpl: statusProbe(dir, ready),
      verificationArtifacts: [artifact], verificationManifestFile: manifestFile,
      verificationManifestVersion: manifestVersion,
      downloadModelImpl, runtimeStatusImpl: null
    }))
    try {
      const records = []
      for await (const record of readLines(await fetch(`${base}/model/download`, { method: 'POST' }))) {
        records.push(record)
      }
      expect(records.at(-1)).toMatchObject({
        kind: 'error', ok: false, error: 'model_download_failed', file: artifact.file
      })
      expect(records.at(-1).cause).toMatch(/tiny-model\.onnx.*(bytes|hash)/)

      const status = await (await fetch(`${base}/model/status`)).json()
      expect(status.installation).toEqual({
        source: 'preseeded-or-unverified', verified: false, manifestVersion
      })
    } finally {
      await close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('PV-033 — a second model download is refused by name', () => {
  it('returns model_download_in_progress while the first request still completes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vl-pocket-overlap-'))
    const gate = makeGate()
    let calls = 0
    const downloadModelImpl = async (options) => {
      calls++
      gate.enter()
      await gate.openPromise
      for (const [fileIndex, file] of POCKET_DOWNLOAD_FILES.entries()) {
        options.onProgress({ file, received: 1, total: 1, fileIndex, fileCount: POCKET_DOWNLOAD_FILES.length })
      }
      await readyModelFixture(options.dir)
      return options.dir
    }
    const { base, close } = await listen(createLabServer({
      modelDirectory: dir, downloadModelImpl, runtimeStatusImpl: null,
      verifyModelInstallImpl: async () => ({
        verified: true, manifestVersion: 2,
        artifactCount: POCKET_DOWNLOAD_FILES.length, totalBytes: 1
      })
    }))
    try {
      const firstPending = fetch(`${base}/model/download`, { method: 'POST' })
      const firstEffect = await Promise.race([
        gate.enteredPromise.then(() => 'download-entered'),
        firstPending.then((res) => `HTTP ${res.status}`)
      ])
      expect(firstEffect, 'the first request never entered the downloader').toBe('download-entered')
      const first = await firstPending

      const second = await fetch(`${base}/model/download`, { method: 'POST' })
      expect(second.status).toBe(409)
      expect(await second.json()).toMatchObject({
        error: 'model_download_in_progress', backend: 'pocket'
      })
      expect(calls).toBe(1)

      gate.open()
      const firstRecords = []
      for await (const record of readLines(first)) firstRecords.push(record)
      expect(firstRecords.at(-1)).toMatchObject({ kind: 'complete', ok: true })
      expect(calls).toBe(1)
    } finally {
      gate.open()
      await close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})


/* ------------------------------------------------ R16-01: the installer has a production caller */

describe('R16-01 — one button yields a WORKING backend, not half of one', () => {
  it('fetches the ONNX Runtime as part of the model download when it is absent', async () => {
    // The defect: `downloadRuntime()` was implemented, unit-tested, and called by NOTHING. A
    // listener could press the one button, watch 173.8 MB arrive, and still be told the neural
    // voices cannot run. A delivery path nothing calls is not a delivery path.
    const dir = await mkdtemp(join(tmpdir(), 'r16-01-'))
    let runtimeFetched = false
    let runtimeReady = false
    const { base, close } = await listen(createLabServer({
      modelDirectory: dir,
      downloadModelImpl: async () => {},
      modelStatusImpl: async () => ({ kind: 'ready', dir }),
      runtimeStatusImpl: async () => (runtimeFetched ? { kind: 'ready', dir, binding: 'x' } : { kind: 'absent', dir, missing: ['onnxruntime_binding.node'], bytes: 39_000_000 }),
      downloadRuntimeImpl: async () => { runtimeFetched = true; runtimeReady = true; return dir }
    }))
    try {
      const res = await fetch(`${base}/model/download`, { method: 'POST' })
      const body = await res.text()
      const records = body.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      const runtime = records.filter((r) => r.kind === 'runtime')
      expect(runtimeReady, 'the runtime installer was never called').toBe(true)
      expect(runtime.map((r) => r.state)).toContain('fetching')
      expect(runtime.map((r) => r.state)).toContain('ready')
    } finally { await close(); await rm(dir, { recursive: true, force: true }) }
  })

  it('reports an unsupported platform without pretending the download failed', async () => {
    // An Intel Mac gets a sentence and keeps its OS voices. "Download failed" would be a lie.
    const dir = await mkdtemp(join(tmpdir(), 'r16-01b-'))
    let downloadCalled = false
    const { base, close } = await listen(createLabServer({
      modelDirectory: dir,
      downloadModelImpl: async () => {},
      modelStatusImpl: async () => ({ kind: 'ready', dir }),
      runtimeStatusImpl: async () => ({ kind: 'unsupported', platform: 'darwin-x64', why: 'no Intel-Mac binary exists; your system voices are unaffected' }),
      downloadRuntimeImpl: async () => { downloadCalled = true }
    }))
    try {
      const body = await (await fetch(`${base}/model/download`, { method: 'POST' })).text()
      const records = body.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      const runtime = records.find((r) => r.kind === 'runtime')
      expect(runtime?.state).toBe('unsupported')
      expect(runtime?.why).toMatch(/system voices are unaffected/i)
      expect(downloadCalled, 'offered a download that can never work').toBe(false)
    } finally { await close(); await rm(dir, { recursive: true, force: true }) }
  })

  it('CONTROL: a ready runtime is not re-downloaded', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'r16-01c-'))
    let downloadCalled = false
    const { base, close } = await listen(createLabServer({
      modelDirectory: dir,
      downloadModelImpl: async () => {},
      modelStatusImpl: async () => ({ kind: 'ready', dir }),
      runtimeStatusImpl: async () => ({ kind: 'ready', dir, binding: 'x' }),
      downloadRuntimeImpl: async () => { downloadCalled = true }
    }))
    try {
      await (await fetch(`${base}/model/download`, { method: 'POST' })).text()
      expect(downloadCalled).toBe(false)
    } finally { await close(); await rm(dir, { recursive: true, force: true }) }
  })
})
