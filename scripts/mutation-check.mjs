#!/usr/bin/env node
/**
 * Mutation check — the only guard in this repo that verifies a TEST by effect.
 *
 * Every other gate here asks "did the suite pass?". This one asks the question the constitution
 * actually requires: **what result would have proved me wrong?** It breaks the implementation on
 * purpose, one named edit at a time, and fails if the test that is supposed to catch that edit
 * stays green. A mutant that survives is a test that could not have failed.
 *
 * WHY THIS EXISTS. `CANCEL_BUDGET_MS` was 50, nine documents said "measured within 50 ms", and the
 * contract asserted `CANCEL_BUDGET_MS * 20`. Delaying `OsSynthProvider.cancel()`'s SIGKILL by
 * 900 ms — an 18x regression on the project's own barge-in budget — was green in all 180 tests.
 * Two more of the same shape were found the same way, one of them on principle VIII, the rule that
 * agent reasoning is never spoken aloud. Full write-up: docs/.research/test-audit.md.
 *
 * WHY IT IS NOT IN `pnpm test`. It runs the suite once per mutant, so it costs minutes, not
 * seconds, and R067 requires `pnpm test` to stay fast enough that nobody is tempted to skip it.
 * It is a pre-milestone gate and a CI job, run deliberately: `pnpm check:mutants`.
 *
 * WHY A HAND-WRITTEN REGISTRY AND NOT STRYKER. Stryker generates thousands of mutants over a
 * 6.6k-line workspace, most of them equivalent, and the triage cost is the whole budget of a
 * project this size. Sixteen mutants chosen for what they MEAN — cancel stops late, the queue
 * discards the wrong end, reasoning reaches the speaker, the degradation ladder goes quiet — are
 * readable, reviewable, and each one names the claim it is defending. Grow the list when a new
 * load-bearing invariant lands; that is cheaper than tuning a generator's ignore-list.
 *
 * EQUIVALENT MUTANTS ARE REAL AND ARE MARKED. Some mutations cannot change behaviour, because a
 * second guard already covers the same case. Those carry `equivalent: true`, are NOT failures, and
 * carry a note saying which other line makes them inert. Marking one is a claim you must be able
 * to defend — a wrongly-marked equivalent is exactly the blind spot this script exists to find.
 *
 * Usage:
 *   node scripts/mutation-check.mjs             # every mutant
 *   node scripts/mutation-check.mjs cancel      # only mutants whose id contains "cancel"
 *
 * Idempotent (R071): every file is restored in a `finally`, and a final pass re-verifies that the
 * working tree matches what it was before the run. A crashed run leaves nothing to clean up.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const abs = (p) => new URL(p, new URL('..', import.meta.url))

/**
 * Each mutant: what invariant it attacks, the edit, and the test file that must go red.
 * `only` narrows vitest with `-t` so the run is fast and the report names the guarding test.
 */
const MUTANTS = [
  {
    id: 'cancel-late-kill',
    claim: 'cancel() is observed within CANCEL_BUDGET_MS — the claim nine documents quote',
    file: 'packages/providers/src/os-synth/index.ts',
    from: "    if (c !== null && c.exitCode === null) c.kill('SIGKILL')",
    to: "    setTimeout(() => { if (c !== null && c.exitCode === null) c.kill('SIGKILL') }, 900)",
    test: 'packages/providers/src/os-synth/os-synth.test.ts',
    only: 'cancel'
  },
  {
    id: 'cancel-never-kill',
    claim: 'cancel() actually kills the synthesizer child, rather than waiting it out',
    file: 'packages/providers/src/os-synth/index.ts',
    from: "    if (c !== null && c.exitCode === null) c.kill('SIGKILL')",
    to: '    void c',
    test: 'packages/providers/src/os-synth/os-synth.test.ts',
    only: 'cancel'
  },
  {
    id: 'queue-drops-newest',
    claim: 'a full queue drops the OLDEST replies, never the newest',
    file: 'packages/plugin/src/speech-service.ts',
    from: '      const keep = new Set(replies.slice(-max))',
    to: '      const keep = new Set(replies.slice(0, max))',
    test: 'packages/plugin/src/speech-service.test.ts',
    only: 'a full queue drops the OLDEST'
  },
  {
    id: 'announce-interrupts',
    claim: "announce('next') is heard before what is queued behind it, and never at the back",
    file: 'packages/plugin/src/speech-service.ts',
    from: `    let at = 0
    while (this.#pending[at]?.announcement === true) at++
    this.#pending.splice(at, 0, { text, announcement: true })`,
    to: '    this.#pending.push({ text, announcement: true })',
    test: 'packages/plugin/src/speech-service.test.ts'
  },
  {
    id: 'stop-one-sided',
    claim: 'stop is two-sided (R014): killing the player without cancelling synthesis is the bug',
    file: 'packages/plugin/src/speech-service.ts',
    from: '      cancelSynthesis: () => { deps.provider.cancel() }',
    to: '      cancelSynthesis: () => { /* mutant */ }',
    test: 'packages/plugin/src/speech-service.test.ts'
  },
  {
    id: 'bargein-no-cancel',
    claim: 'PlaybackQueue.bargeIn cancels synthesis as well as flushing audio',
    file: 'packages/core/src/queue/index.ts',
    from: '    this.#deps.cancelSynthesis()',
    to: '    void 0',
    test: 'packages/core/src/queue/queue.test.ts'
  },
  {
    id: 'stale-generation-plays',
    claim: 'audio from a superseded utterance can never play over the new one',
    file: 'packages/core/src/queue/index.ts',
    from: '    if (gen !== this.#generation) return false',
    to: '    if (false) return false',
    test: 'packages/core/src/queue/queue.test.ts'
  },
  {
    id: 'thinking-leaks',
    claim: 'principle VIII: model reasoning is never spoken — needs BOTH guards removed to leak',
    file: 'packages/plugin/src/huddle/decoders.ts',
    edits: [
      ["    if (type === 'thinking' || type === 'redacted_thinking') continue", '    // MUTANT'],
      ["    if (type === 'tool_use' || type === 'tool_result') continue", '    // MUTANT'],
      [
        "    if (type === 'text' && typeof block['text'] === 'string') parts.push(block['text'])",
        "    if (typeof block['text'] === 'string') parts.push(block['text'])"
      ]
    ],
    test: 'packages/plugin/src/huddle/decoders.test.ts'
  },
  {
    id: 'thinking-continue-only',
    claim: 'the `continue` on thinking blocks, alone',
    equivalent: true,
    note: "the `type === 'text'` allowlist two lines below already excludes it; only removing BOTH leaks",
    file: 'packages/plugin/src/huddle/decoders.ts',
    from: "    if (type === 'thinking' || type === 'redacted_thinking') continue",
    to: '    // MUTANT',
    test: 'packages/plugin/src/huddle/decoders.test.ts'
  },
  {
    id: 'attachment-type-accepted',
    claim: 'R10-03: the TYPE gate, tested against a record built to get past everything else',
    note: 'the all-record-types fixture alone does NOT kill this — a real-shaped attachment carries no `message`, so the decoder returns null for a different reason. The hand-built disguised record is what defends the gate',
    file: 'packages/plugin/src/huddle/decoders.ts',
    from: "  if (rec['type'] !== 'assistant') return null",
    to: "  if (rec['type'] !== 'assistant' && rec['type'] !== 'attachment') return null",
    test: 'packages/plugin/src/huddle/decoders.test.ts'
  },
  {
    id: 'thinking-allowlist-only',
    claim: 'the `type === text` allowlist, alone',
    equivalent: true,
    note: "mirror image of thinking-continue-only: the two `continue`s above still drop thinking and tool blocks before they reach the push, so only removing BOTH leaks. Recorded because it was mistaken for a live defect on principle VIII once, and the next person deserves the answer rather than the alarm",
    file: 'packages/plugin/src/huddle/decoders.ts',
    from: "    if (type === 'text' && typeof block['text'] === 'string') parts.push(block['text'])",
    to: "    if (typeof block['text'] === 'string') parts.push(block['text'])",
    test: 'packages/plugin/src/huddle/decoders.test.ts'
  },
  {
    id: 'user-turns-spoken',
    claim: 'the listener never hears their own prompts read back',
    file: 'packages/plugin/src/huddle/decoders.ts',
    from: "  if (rec['type'] !== 'assistant') return null",
    to: "  if (rec['type'] !== 'assistant' && rec['type'] !== 'user') return null",
    test: 'packages/plugin/src/huddle/decoders.test.ts'
  },
  {
    id: 'evicted-id-respoken',
    claim: 'B-01: past the 300-id bound, an evicted reply must not be read out a second time',
    file: 'packages/plugin/src/huddle/index.ts',
    from: '    const fresh = replies.slice(mark).filter((r) => !this.#spoken.has(r.id))',
    to: '    const fresh = replies.filter((r) => !this.#spoken.has(r.id))',
    test: 'packages/plugin/src/huddle/huddle.test.ts'
  },
  {
    id: 'compaction-boundary-ignored',
    claim: 'R10-02: a compaction that does NOT shrink the reply count must not be re-spoken',
    note: 'the ONLY guard for this case — the shrink branch below is equivalent, see compaction-no-reanchor',
    file: 'packages/plugin/src/huddle/index.ts',
    from: '    if (seenBoundaries !== undefined && boundaries > seenBoundaries) {',
    to: '    if (false) {',
    test: 'packages/plugin/src/huddle/huddle.test.ts'
  },
  {
    id: 'compaction-boundary-always',
    claim: 'the boundary count is compared to the PREVIOUS read, not to zero',
    note: 'clamping on any boundary at all would make a once-compacted transcript permanently mute',
    file: 'packages/plugin/src/huddle/index.ts',
    from: '    if (seenBoundaries !== undefined && boundaries > seenBoundaries) {',
    to: '    if (boundaries > 0) {',
    test: 'packages/plugin/src/huddle/huddle.test.ts'
  },
  {
    id: 'compaction-no-reanchor',
    claim: 'the compaction early-return branch',
    equivalent: true,
    note: '#setHighWater(file, replies.length) below runs unconditionally, so the mark re-anchors anyway. R10-02: this being inert is WHY compact_boundary had to be read — the shrink proxy guarded nothing, and a compaction that did not shrink the count was unguarded entirely',
    file: 'packages/plugin/src/huddle/index.ts',
    from: '    if (replies.length < mark) {',
    to: '    if (false) {',
    test: 'packages/plugin/src/huddle/huddle.test.ts'
  },
  {
    id: 'dunder-mangled',
    claim: '__init__ survives the normalizer — needs BOTH the opener and closer guards removed',
    file: 'packages/core/src/normalizer/index.ts',
    edits: [
      ["    if (ch === '_' && (chars[i + 1] === '_' || chars[i - 1] === '_')) continue   // dunder", '    // MUTANT'],
      ["      if (ch === '_' && (chars[j + 1] === '_' || chars[j - 1] === '_')) continue", '      // MUTANT']
    ],
    test: 'packages/core/src/normalizer/normalize.test.ts'
  },
  {
    id: 'chunker-lossy',
    claim: 'T030: chunks.join() === input, exactly, for every input',
    file: 'packages/core/src/chunker/index.ts',
    from: '      const text = this.#buffer.slice(0, cut.index)',
    to: '      const text = this.#buffer.slice(0, cut.index).trimEnd()',
    test: 'packages/core/src/chunker/chunker.test.ts'
  },
  {
    id: 'silent-degradation',
    claim: 'R015: falling to a worse engine carries a reason the UI can show',
    file: 'packages/providers/src/registry.ts',
    from: '      return { provider: p, status: reason === undefined ? { providerId: p.id, rung } : { providerId: p.id, rung, reason } }',
    to: '      return { provider: p, status: { providerId: p.id, rung } }',
    test: 'packages/providers/src/registry.test.ts'
  },
  {
    id: 'register-always-succeeds',
    claim: 'P18: a host API mismatch is visible, never a silent success',
    file: 'packages/plugin/src/adapter/index.ts',
    from: '    registeredCommands: () => registered,',
    to: '    registeredCommands: () => 1,',
    test: 'packages/plugin/src/adapter/adapter.test.ts'
  },
  // ---- round 7: the silent-failure sites. Each of these was a real defect until this round; a
  // surviving mutant here means the fix is no longer defended and the site is silently back.
  {
    id: 'prepare-warm-on-broken-say',
    claim: '006 finding 1: a synthesizer that cannot run must never report itself warm',
    file: 'packages/providers/src/os-synth/index.ts',
    from: '    if (voices.length === 0) {',
    to: '    if (false) {',
    test: 'packages/providers/src/os-synth/os-synth.test.ts',
    only: 'finding 1'
  },
  {
    id: 'player-exit-ignored',
    claim: '006 site 35 / section 19 rank 1: a player that exits non-zero is not playback',
    file: 'packages/plugin/src/sinks/subprocess-sink.ts',
    from: "          resolve(code === 0\n            ? { ok: true, why: '' }\n            : { ok: false, why: `${p.cmd} exited ${String(code)}` })",
    to: "          void code; resolve({ ok: true, why: '' })",
    test: 'packages/plugin/src/sinks/subprocess-sink.test.ts'
  },
  {
    id: 'delivery-receipt-discarded',
    claim: '006 site 18 / section 19 rank 2: { delivered: false } must reach the spoken fallback',
    file: 'packages/plugin/src/adapter/index.ts',
    from: "          if ((r as { delivered?: unknown } | undefined)?.delivered === false) undelivered('reported undelivered')",
    to: '          void r',
    test: 'packages/plugin/src/adapter/adapter.test.ts'
  },
  {
    id: 'unspeakable-reply-silent',
    claim: '006 site 31: a reply with nothing speakable in it is announced, not logged',
    file: 'packages/plugin/src/speech-service.ts',
    from: "          if (outcome === 'empty') this.#noteLoss('unspeakable')",
    to: '          void outcome',
    test: 'packages/plugin/src/speech-service.test.ts'
  },
  {
    id: 'skip-reported-as-failure',
    claim: '006 site 32: a control the listener pressed must never be reported as an engine failure',
    file: 'packages/plugin/src/speech-service.ts',
    from: "      if (this.#skip) return 'skipped'",
    to: "      if (this.#skip) return 'synthesis-failed'",
    test: 'packages/plugin/src/speech-service.test.ts'
  },
  {
    id: 'cancel-not-awaited',
    claim: '006 C6: barge-in must not return before the daemon cancel has landed',
    file: 'packages/core/src/queue/index.ts',
    from: '    await this.#deps.cancelSynthesis()',
    to: '    void this.#deps.cancelSynthesis()',
    test: 'packages/core/src/queue/queue.test.ts'
  },
  {
    id: 'no-transcript-silent',
    claim: '006 TT1: "nothing to follow" must never be a bare return',
    file: 'packages/plugin/src/huddle/index.ts',
    from: '          this.#deps.notify(NO_TRANSCRIPT_SENTENCE[reason])',
    to: '          void reason',
    test: 'packages/plugin/src/huddle/huddle.test.ts'
  },
  {
    id: 'no-transcript-narrates',
    claim: '006 TT1, the other side: it must be said ONCE, not once per agent event',
    file: 'packages/plugin/src/huddle/index.ts',
    from: '        if (this.#announcedNoTranscript !== reason) {',
    to: '        if (true) {',
    test: 'packages/plugin/src/huddle/huddle.test.ts'
  },
  {
    id: 'reap-drops-the-lock',
    claim: '006 C4: the five-minute reap must not silently change which session is followed',
    file: 'packages/plugin/src/huddle/index.ts',
    from: "    if (typeof following === 'string' && following.length > 0) this.#locked = following",
    to: '    void following',
    test: 'packages/plugin/src/huddle/huddle.test.ts'
  },
  {
    id: 'unstable-id-for-uuidless-record',
    claim: '006 TT4/site 15: a record with no uuid must decode to the same id every read',
    file: 'packages/plugin/src/huddle/decoders.ts',
    from: '  return { id: typeof rec[\'uuid\'] === \'string\' ? rec[\'uuid\'] : stableId(text), text }',
    to: '  return { id: typeof rec[\'uuid\'] === \'string\' ? rec[\'uuid\'] : `${Date.now()}-${parts.length}`, text }',
    test: 'packages/plugin/src/huddle/huddle.test.ts'
  },
  {
    id: 'verdict-glyph-deleted',
    claim: '006 site 50: a check mark is a verdict, so "yes done" and "no done" must differ',
    file: 'packages/core/src/normalizer/index.ts',
    from: "  '\\u2713': 'yes', '\\u2714': 'yes', '\\u2705': 'yes',",
    to: '  // MUTANT',
    test: 'packages/core/src/normalizer/normalize.test.ts'
  },
  {
    id: 'half-written-line-concluded-on',
    claim: '006 TT3: a transcript ending mid-line is re-read, not concluded on',
    file: 'packages/plugin/src/huddle/index.ts',
    from: '        this.#truncatedRetries.set(file, spent + 1)',
    to: '        this.#truncatedRetries.set(file, MAX_TRUNCATED_RETRIES)',
    test: 'packages/plugin/src/huddle/huddle.test.ts'
  },
  {
    id: 'status-deletes-queue',
    claim: 'C5: asking what is being read must not delete what is being read',
    file: 'packages/plugin/src/main.ts',
    from: "      s.announce(parts.join(' '), 'now')",
    to: "      s.speak(parts.join(' '), 'replace')",
    test: 'packages/plugin/src/main.test.ts'
  },
  {
    id: 'inband-command-reaches-engine',
    claim: "E-06: `[[volm 0.2]]` in an agent reply must not be executed by `say`",
    file: 'packages/providers/src/os-synth/index.ts',
    from: "  return text.replace(/\\[\\[/g, '[ [')",
    to: '  return text',
    test: 'packages/providers/src/os-synth/os-synth.test.ts'
  },
  {
    id: 'darwin-text-in-option-position',
    claim: "R8-04: no chunk text, however it begins, may be parsed by `say` as an option",
    file: 'packages/providers/src/os-synth/index.ts',
    from: "  args.push('--', text)\n  return { cmd: 'say', args }",
    to: "  args.push(text)\n  return { cmd: 'say', args }",
    test: 'packages/providers/src/os-synth/os-synth.test.ts',
    only: 'R8-04'
  },
  {
    id: 'synth-ignores-exit-code',
    claim: "R8-05: a non-zero exit must not be reported as `exited successfully`",
    file: 'packages/providers/src/os-synth/index.ts',
    from: "        if (code === null || code === 0 || this.#cancelled || opts.signal?.aborted === true) {",
    to: '        if (true) {',
    test: 'packages/providers/src/os-synth/os-synth.test.ts',
    only: 'R8-05'
  },
  {
    id: 'synth-discards-stderr',
    claim: "R8-05: the engine's own diagnosis must reach the listener, not be thrown away",
    file: 'packages/providers/src/os-synth/index.ts',
    from: "        child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })",
    to: "        child = spawn(cmd, args, { stdio: 'ignore' })",
    test: 'packages/providers/src/os-synth/os-synth.test.ts',
    only: 'R8-05'
  }
]

const filter = process.argv[2]
const chosen = filter === undefined ? MUTANTS : MUTANTS.filter((m) => m.id.includes(filter))
if (chosen.length === 0) {
  console.error(`no mutant id matches ${JSON.stringify(filter)}`)
  process.exit(2)
}

const applyEdits = (src, edits) => {
  let out = src
  for (const [from, to] of edits) {
    if (!out.includes(from)) {
      throw new Error(`mutation target has drifted; this snippet is no longer in the file:\n  ${from}`)
    }
    out = out.replace(from, to)
  }
  return out
}

const results = []
for (const m of chosen) {
  const path = abs(m.file)
  const original = readFileSync(path, 'utf8')
  const edits = m.edits ?? [[m.from, m.to]]
  let verdict
  try {
    writeFileSync(path, applyEdits(original, edits))
    const args = ['vitest', 'run', m.file === m.test ? m.test : m.test]
    if (m.only !== undefined) args.push('-t', m.only)
    const r = spawnSync('npx', args, { cwd: ROOT, encoding: 'utf8' })
    verdict = r.status === 0 ? 'SURVIVED' : 'killed'
  } catch (err) {
    verdict = `ERROR: ${err.message}`
  } finally {
    writeFileSync(path, original)
    if (readFileSync(path, 'utf8') !== original) {
      console.error(`FATAL: could not restore ${m.file} — restore it from git before continuing`)
      process.exit(3)
    }
  }
  const expected = m.equivalent === true ? 'SURVIVED' : 'killed'
  const ok = verdict === expected
  results.push({ ...m, verdict, ok })
  const tag = ok ? '  ok  ' : ' FAIL '
  console.log(`[${tag}] ${m.id.padEnd(30)} ${verdict.padEnd(9)} ${m.claim}`)
  if (!ok && verdict === 'SURVIVED') {
    console.log(`         ^ nothing in ${m.test} noticed. That test cannot fail for this reason.`)
  }
  if (!ok && verdict === 'killed') {
    console.log(`         ^ marked equivalent but it DID break a test — the note is wrong: ${m.note}`)
  }
}

const bad = results.filter((r) => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} mutants behaved as declared.`)
if (bad.length > 0) {
  console.log('A surviving non-equivalent mutant means a test could not have failed. Fix the TEST.')
  process.exit(1)
}
