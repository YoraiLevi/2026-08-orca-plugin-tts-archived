#!/usr/bin/env node
/**
 * READ-ONLY dry run of huddle mode against your real transcripts.
 *
 * Answers, without ORCA and without speaking: which transcript would we pick, which replies would
 * we speak, and does any thinking or tool output leak into the speech?
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { decodeClaudeLine } from '../packages/plugin/src/huddle/decoders.ts'
import { normalize } from '../packages/core/src/index.ts'

const worktree = process.argv[2] ?? process.cwd()
const root = join(homedir(), '.claude', 'projects')
const slug = worktree.replace(/[/\\:]/g, '-')

console.log(`worktree : ${worktree}`)
console.log(`slug     : ${slug}`)

const dirs = readdirSync(root)
const matched = dirs.filter((d) => d === slug || d.endsWith(slug) || slug.endsWith(d))
console.log(`projects : ${dirs.length} total, ${matched.length} matched by slug`)
if (matched.length === 0) console.log('  (no slug match — huddle would fall back to scanning all projects)')

const files = []
for (const d of (matched.length > 0 ? matched : dirs)) {
  for (const e of readdirSync(join(root, d))) {
    if (!e.endsWith('.jsonl')) continue
    const p = join(root, d, e)
    files.push({ path: p, mtime: statSync(p).mtimeMs })
  }
}
files.sort((a, b) => b.mtime - a.mtime)
console.log(`files    : ${files.length}`)
if (files.length === 0) { console.log('nothing to read'); process.exit(0) }

const [first, second] = files
console.log(`picked   : ${first.path}`)
if (second && first.mtime - second.mtime < 2000) {
  console.log(`  AMBIGUOUS: next file is only ${Math.round(first.mtime - second.mtime)} ms older`)
  console.log('  huddle would warn the user rather than guess silently')
}

const lines = readFileSync(first.path, 'utf8').split('\n').filter((l) => l.trim())
const replies = lines.map(decodeClaudeLine).filter(Boolean)
console.log(`\nlines: ${lines.length}  ->  speakable assistant replies: ${replies.length}\n`)

const last = replies.slice(-3)
for (const r of last) {
  const spoken = normalize(r.text)
  console.log('--- would speak ---')
  console.log(spoken.slice(0, 400) + (spoken.length > 400 ? ' …' : ''))
  console.log()
}

// The safety check that matters: nothing the model merely thought, and no tool payloads.
const allSpoken = replies.map((r) => normalize(r.text)).join(' ')
const leaks = []
for (const line of lines) {
  let rec; try { rec = JSON.parse(line) } catch { continue }
  const blocks = rec?.message?.content
  if (!Array.isArray(blocks)) continue
  for (const b of blocks) {
    if (b?.type === 'thinking' && typeof b.thinking === 'string') {
      const probe = b.thinking.trim().split(/\s+/).slice(0, 6).join(' ')
      if (probe.length > 20 && allSpoken.includes(probe)) leaks.push(`THINKING: ${probe}`)
    }
    if (b?.type === 'tool_use' && b?.input?.command && typeof b.input.command === 'string') {
      const probe = b.input.command.trim().slice(0, 40)
      if (probe.length > 15 && allSpoken.includes(probe)) leaks.push(`TOOL: ${probe}`)
    }
  }
}
console.log(leaks.length === 0
  ? 'PASS: no thinking text and no tool commands appear in anything we would speak'
  : `FAIL: ${leaks.length} leak(s):\n  ${leaks.slice(0, 5).join('\n  ')}`)
process.exit(leaks.length === 0 ? 0 : 1)
