#!/usr/bin/env node
// check-citations.mjs — make a stale `path:line` citation loud instead of silent.
//
// WHY THIS EXISTS
// ---------------
// PITFALLS P0: "do not trust a plugin-API claim that has no file:line". The rule bought us
// citations everywhere. Round-3 cross-review (docs/design/008-crossreview-round3.md, E-01) then
// found ~30 of them stale by 15-150 lines, because implementation commits moved the files while
// the designs were being written. The claims were right and the pointers were wrong, which is
// P0's failure mode arriving through the front door: a reader who follows a stale pointer lands on
// unrelated code and cannot tell a stale pointer from a fabricated one.
//
// STALENESS DETECTION — THE DESIGN DECISION, AND WHY
// --------------------------------------------------
// A "does line N exist" check is a check that could not fail (the files are thousands of lines
// long), so it is exactly the ritual this repo's "verify by effect" rule forbids. Three options
// were weighed:
//
//   (a) require every citation to carry an explicit `#symbol` anchor  — strongest, but it invalidates
//       all 900 existing citations at once and the tool reports red until every document is rewritten;
//   (b) fingerprint each cited line into a lockfile and diff it     — catches any edit, but it goes red
//       on a rename or a reflow that did not invalidate the claim, and nothing in the lockfile says
//       what the document actually asserted, so the human reviewing the diff re-does the work;
//   (c) INFER the expected token from the prose around the citation — chosen.
//
// (c) is chosen because these documents already write the anchor. The prevailing house style is
//     `plugin-host-service-bindings.ts:57-59` -- `workspace.readContext` maps every terminal ...
// i.e. a backticked symbol sits next to nearly every citation. So the checker reads the backticked
// spans in the citation's own paragraph/table-row, and asserts that the RAREST of them that occurs
// in the target file at all occurs INSIDE the cited span (plus a small slack). "Rarest" matters:
// picking the least-frequent anchor is what stops a citation from going green on a token like
// `text` that appears on every other line. When the anchor lives somewhere else in the file, that
// is a stale citation and its current line is printed as the fix.
//
// Verify by effect -- this can, and does, go red. Reproduced:
//   mkdir /tmp/c && git archive 8666cc0 | tar -x -C /tmp/c
//   cp scripts/check-citations.mjs /tmp/c/scripts/
//   git show bb74a5f:docs/design/004-voice-lab.md > /tmp/c/docs/design/004-voice-lab.md
//   (cd /tmp/c && node scripts/check-citations.mjs)
// -> flags `os-synth/index.ts:132` and `:140-141`, the same two rows E-01 found by hand.
//
// The honest limits are printed in the summary rather than hidden:
//   * unanchored  — the prose offers no token that occurs in the file, so the claim cannot be
//                   checked at all. Counted and listed under --strict; this is the tool's blind spot.
//   * external    — the path is not in this repo or the ORCA checkout (buzz, espeak-ng, speechd).
//                   Verifiable only by cloning those; counted, never silently dropped.
//
// USAGE
//   pnpm check:citations              non-zero on any stale citation
//   pnpm check:citations --summary    print the counts even when clean
//   pnpm check:citations --strict     also fail on unanchored citations
//   pnpm check:citations --list       dump every resolved citation and its verdict
//   node scripts/check-citations.mjs --fix    rewrite stale citations onto the anchor's current line
//                                    (CITATION_LOCKED=a.md,b.md exempts files another agent owns)
//   pnpm check:citations --require-orca       fail if the ORCA checkout is missing
//   pnpm check:citations --ratchet            enforce THIS configuration's ratchet, read from
//                                    docs/.research/citation-ratchet.json. PREFERRED — the number
//                                    lives beside its reasoning and its calibration commit, and
//                                    cannot be quietly raised in a workflow file.
//   pnpm check:citations --max-stale=N        a raw threshold. REFUSED unless N is this
//                                    configuration's calibrated ratchet — see CONFIGURATION
//                                    IDENTITY below for why a number from another config is worse
//                                    than no number.
//
// EVERY RUN PRINTS ITS CONFIGURATION, clean or not: which ORCA state produced the count, which
// threshold was applied and where it came from, and whether the working tree was dirty. A count
// without its configuration is unusable, and this repo proved it the expensive way — see
// docs/.research/citation-audit.md "Re-audit".
//   ORCA_SRC=/path/to/orca pnpm check:citations

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ORCA = process.env.ORCA_SRC ?? '/Users/m5air/source/orca'
const ARGS = new Set(process.argv.slice(2))
const STRICT = ARGS.has('--strict')
const SUMMARY = ARGS.has('--summary') || ARGS.has('--list')
const LIST = ARGS.has('--list')
const FIX = ARGS.has('--fix')
const REQUIRE_ORCA = ARGS.has('--require-orca')
// A ratchet, not an amnesty: the number of citations we have not yet re-derived. It may only go
// down. Every entry is listed in docs/.research/citation-audit.md with why it is still open.
const MAX_STALE_ARG = [...ARGS].find((a) => a.startsWith('--max-stale='))?.split('=')[1]
const MAX_STALE = Number(MAX_STALE_ARG ?? 0)
// Read the per-configuration ratchet instead of taking a number on the command line. Preferred:
// the number then lives beside its reasoning and its calibration commit, and cannot be quietly
// raised in a workflow file.
const USE_RATCHET = ARGS.has('--ratchet')
// Files another agent owns right now; --fix must not touch them.
const LOCKED = (process.env.CITATION_LOCKED ?? '').split(',').map((x) => x.trim()).filter(Boolean)

// The ORCA commit our documents pin. HANDOFF/008 record it; if the checkout has moved, every
// ORCA citation was verified against a different tree than the documents claim.
const ORCA_PINNED = '87097551f8e98a21c3afa7d457f66d6fd1f94038'

const MAX_ANCHOR_OCCURRENCES = 8
const SLACK = 10 // lines of tolerance: within ~a screen of the claim, the reader still lands on it

// ---------------------------------------------------------------- document set

function gitFiles(root, args) {
  try {
    // stderr ignored: probing a missing ORCA checkout is an EXPECTED outcome, reported by the
    // config line below. Letting git's "fatal: cannot change to ..." through would put a scary
    // line next to a number that is fine, which is how people learn to skim past real errors.
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/** Every markdown file under docs/, tracked or not -- an untracked design doc still gets read. */
function walkMarkdown(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    const abs = join(dir, e.name)
    if (e.isDirectory()) walkMarkdown(abs, out)
    else if (e.name.endsWith('.md')) out.push(relative(REPO, abs))
  }
  return out
}

const DOCS = [
  ...walkMarkdown(join(REPO, 'docs')).toSorted(),
  'HANDOFF.md',
  'PITFALLS.md',
  'STATE.md',
  'README.md',
  '.specify/memory/constitution.md',
].filter((f) => existsSync(join(REPO, f)))

// ---------------------------------------------------------------- path resolution

const repoIndex = gitFiles(REPO, ['ls-files'])
const orcaIndex = gitFiles(ORCA, ['ls-files'])
const ORCA_PRESENT = orcaIndex.length > 0
// Names that exist at the root of almost every repository. Cited bare, they are only meaningful
// alongside the checkout they belong to.
const AMBIGUOUS_ROOT = /^(README\.md|package\.json|orca-plugin\.json|tsconfig\.json|LICENSE)$/

function suffixMatch(index, p) {
  const needle = '/' + p
  return index.filter((f) => f === p || f.endsWith(needle))
}

const resolveCache = new Map()

/**
 * Resolve a cited path to every plausible target file, best first.
 * The documents cite by shorthand -- `os-synth/index.ts`, `speech-service.ts`, `plugin-host-api.ts` --
 * and some shorthands legitimately match more than one file in ORCA's tree. Rather than guess or
 * refuse, every candidate is returned and the anchor decides: a citation is verified if it verifies
 * against ANY candidate. If none verify, the report names the candidate whose anchor came closest.
 * @returns {{kind:'repo'|'orca', abs:string, rel:string}[]}
 */
function resolvePath(p) {
  if (!resolveCache.has(p)) resolveCache.set(p, resolveUncached(p))
  return resolveCache.get(p)
}

function isFile(abs) {
  try {
    return statSync(abs).isFile()
  } catch {
    return false
  }
}

function resolveUncached(raw) {
  const p = raw.replace(/^\.\//, '')
  const out = []
  const add = (kind, root, rel) => {
    if (out.some((o) => o.rel === rel && o.kind === kind)) return
    out.push({ kind, abs: join(root, rel), rel })
  }

  // Shorthands the documents actually use for our own workspace:
  //   core/src/... plugin/src/... providers/src/...  ->  packages/<pkg>/src/...
  const shorthand = p.match(/^(core|plugin|providers)\/(.*)$/)
  const repoCandidates = [p]
  if (shorthand) repoCandidates.push(`packages/${shorthand[1]}/${shorthand[2]}`)
  // ORCA's own tree, cited either bare (`src/main/...`) or prefixed (`orca/src/main/...`).
  const orcaCandidates = [p, p.replace(/^orca\//, '')]

  // Both trees are consulted before returning: `README.md:221-222` and `package.json:283-286` mean
  // ORCA's, not ours, and a repo-first early return would bind them to the wrong file and invent a
  // stale citation out of nothing.
  for (const c of repoCandidates) if (isFile(join(REPO, c))) add('repo', REPO, c)
  for (const c of orcaCandidates) if (isFile(join(ORCA, c))) add('orca', ORCA, c)
  if (out.length) {
    // With no ORCA checkout, a root-level name that exists in both trees is unresolvable, not ours.
    if (!ORCA_PRESENT && AMBIGUOUS_ROOT.test(p)) return []
    return out
  }

  // Bare filenames and partial paths: accept every suffix match in either tree.
  for (const c of repoCandidates) for (const hit of suffixMatch(repoIndex, c)) add('repo', REPO, hit)
  for (const c of orcaCandidates) for (const hit of suffixMatch(orcaIndex, c)) add('orca', ORCA, hit)
  return out
}

// ---------------------------------------------------------------- citation extraction

const PATHY = String.raw`[A-Za-z0-9_@./+-]*[A-Za-z0-9_-]\.(?:ts|tsx|mjs|cjs|js|jsx|json|md|c|h|py|yml|yaml|sh|ps1)`
const LINES = String.raw`:\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*`
// `path.ts:12-20` and the continuation form `` `:211-215` `` that inherits the last path named.
const CITE_RE = new RegExp(String.raw`(?:(${PATHY})|(?<=\`))(${LINES})`, 'g')
const PATH_MENTION_RE = new RegExp(String.raw`\`(${PATHY})(?:${LINES})?\``, 'g')

function parseLineSpec(spec) {
  const spans = []
  for (const part of spec.slice(1).split(',')) {
    const [a, b] = part.split('-').map(Number)
    if (!Number.isFinite(a)) continue
    spans.push([a, Number.isFinite(b) ? b : a])
  }
  return spans
}

// Placeholders, not citations: P0's own worked example and similar.
const PLACEHOLDER = /^(path\/(to\/)?file\.ts|path\/file\.ts)$/

function collectCitations(docRel) {
  const text = readFileSync(join(REPO, docRel), 'utf8')
  const lines = text.split('\n')
  const out = []

  // How the documents actually use the continuation form `:211-215`:
  //   * a section names its subject file in prose FIRST ("`packages/core/src/normalizer/index.ts`.") and
  //     every bare `:NN` in that section's table then refers to it -- docs/design/006-fma.md is
  //     written entirely this way;
  //   * within one line, a path named to the LEFT of the citation wins over the section's subject
  //     -- 006's TT1 cell writes `huddle/index.ts:206` then `:134` about the same file.
  // So: a heading resets the section subject, prose lines set it, table rows never do (a cell
  // mentions other files in passing and must not hijack the whole table).
  let sectionPath = null
  let prevLinePath = null

  // Escape hatches, for the cases where prose genuinely cannot carry an anchor and for documents
  // that quote stale citations ON PURPOSE -- 008's E-01 table is a list of pointers that were wrong,
  // and "correcting" it would delete the finding.
  //   <!-- citation-check: ignore-file -->            skip the whole document
  //   <!-- citation-check: ignore-begin --> … -end    skip a region
  //   <!-- citation-check: ignore -->                 skip the line it appears on
  if (/<!--\s*citation-check:\s*ignore-file\s*-->/.test(text)) return out
  let ignoring = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/<!--\s*citation-check:\s*ignore-begin\s*-->/.test(line)) { ignoring = true; continue }
    if (/<!--\s*citation-check:\s*ignore-end\s*-->/.test(line)) { ignoring = false; continue }
    if (ignoring) continue
    if (/<!--\s*citation-check:\s*ignore\s*-->/.test(line)) continue
    if (/^#{1,6}\s/.test(line)) { sectionPath = null; continue }
    if (!line.trim()) continue

    const isTableRow = line.trimStart().startsWith('|')
    let linePath = null

    const events = []
    for (const m of line.matchAll(CITE_RE)) events.push({ at: m.index, len: m[0].length, cite: m })
    for (const m of line.matchAll(PATH_MENTION_RE)) events.push({ at: m.index, len: m[0].length, path: m[1] })
    const ordered = events.toSorted((a, b) => a.at - b.at || (a.path ? -1 : 1))

    for (const e of ordered) {
      if (e.path) { linePath = e.path; continue }
      const m = e.cite
      // An explicit path is exact. An inherited one is genuinely ambiguous between the path named
      // to the left on this line and the section's subject, so BOTH are offered as candidates and
      // the anchor decides -- reporting stale only when the citation fits neither reading.
      const paths = m[1] ? [m[1]] : [linePath, prevLinePath, sectionPath].filter(Boolean)
      if (m[1]) linePath = m[1]
      if (!paths.length || paths.every((x) => PLACEHOLDER.test(x))) continue
      out.push({
        doc: docRel,
        docLine: i + 1,
        raw: (m[1] ?? '') + m[2],
        paths: paths.filter((x) => !PLACEHOLDER.test(x)),
        path: paths[0],
        inherited: !m[1],
        spans: parseLineSpec(m[2]),
        context: contextFor(lines, i, e.at, e.len),
      })
    }
    // First prose path in the section is its subject; later prose mentions are asides. The
    // previous line's path is offered too: prose wraps, and `:120` on one line routinely belongs
    // to the file named at the end of the line above.
    if (!isTableRow && linePath && sectionPath === null) sectionPath = linePath
    if (linePath) prevLinePath = linePath
  }
  return out
}

/**
 * The citation's own sentence. Adjacent lines are pulled in only when the citation sits at the very
 * start or end of its line, i.e. when the sentence plainly wrapped -- otherwise a neighbouring
 * citation's anchors bleed into this one and the verdict describes the wrong claim.
 */
function contextFor(lines, i, col, len) {
  const line = lines[i]
  // A markdown table row holds several independent claims. Confine the context to the citation's
  // own cell, or a neighbouring cell's symbol is read as this citation's anchor.
  if (line.trimStart().startsWith('|')) return tableCell(line, col)

  const parts = [line]
  if (col < 40 && i > 0 && lines[i - 1].trim()) parts.unshift(lines[i - 1])
  if (line.length - (col + len) < 40 && i + 1 < lines.length && lines[i + 1].trim()) parts.push(lines[i + 1])
  return parts.join('\n')
}

function tableCell(line, col) {
  let start = 0
  let end = line.length
  for (let k = col; k >= 0; k--) if (line[k] === '|') { start = k + 1; break }
  for (let k = col; k < line.length; k++) if (line[k] === '|') { end = k; break }
  return line.slice(start, end)
}

// ---------------------------------------------------------------- anchor inference

const STOPWORDS = new Set([
  'true', 'false', 'null', 'undefined', 'const', 'let', 'var', 'this', 'new', 'return',
  'string', 'number', 'boolean', 'void', 'any', 'text', 'name', 'id', 'type', 'value',
  'src', 'dist', 'node', 'npm', 'pnpm', 'git', 'main', 'index', 'test', 'and', 'the',
])

/**
 * Backticked spans in the context become candidate anchors, minus the citations themselves.
 *
 * Only STRONG anchors are allowed to decide a verdict. A strong anchor is one that could not
 * plausibly be ordinary English prose that merely happens to occur in a source file: CONSTANT_CASE,
 * camelCase, a dotted member expression, a hyphenated flag or command, or a multi-word literal.
 * The distinction is what separates the real anchors these documents write -- `CODE_PLACEHOLDER`,
 * `workspace.readContext`, `stripFencedCode`, `onDropped` -- from the incidental backticked words
 * that sit near a citation without describing it -- `version`, `speak`, `length`, `plugins`.
 * Weak anchors are discarded entirely rather than allowed to turn either colour: letting them go
 * green would be the "check that could not fail" this tool exists to replace, and letting them go
 * red buries the real staleness in noise.
 */
function anchorsFrom(context) {
  const raw = [...context.matchAll(/`([^`\n]+)`/g)].map((m) => m[1])
  const out = new Set()
  for (const span of raw) {
    if (new RegExp(String.raw`^(?:${PATHY})?(?:${LINES})$`).test(span)) continue
    const marked = /^[#.]/.test(span.trim())   // `#spoken`, `.strict()` -- unambiguously code
    for (const tok of splitAnchor(span)) {
      if (new RegExp(String.raw`^${PATHY}$`).test(tok)) continue   // a filename is not an anchor
      if (marked || isStrongAnchor(tok)) out.add(tok)
    }
  }
  return [...out]
}

function isStrongAnchor(t) {
  if (t.length < 3) return false
  if (/\s/.test(t)) return t.length >= 8            // a multi-word literal: a quoted string, a shell fragment
  if (/[A-Z]/.test(t.slice(1)) && /[a-z]/.test(t)) return true  // camelCase / PascalCase with a body
  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(t)) return true      // CONSTANT_CASE
  if (t.includes('.')) return true                   // dotted member expression
  if (t.includes('-') && t.length >= 6) return true  // --flag, spd-say, kebab-case
  if (/^[A-Z]{3,}$/.test(t)) return true             // an acronym constant
  return false
}

function splitAnchor(span) {
  const toks = []
  let s = span.trim()
  // `provider.generate(...)` -> provider.generate, generate ; `#command()` -> command
  s = s.replace(/\(.*?\)/g, '').replace(/[;,]+$/, '').trim()
  const quoted = s.match(/^['"](.+)['"]$/)
  if (quoted) s = quoted[1]

  const push = (t) => {
    const c = t.replace(/^[#.@]+/, '').trim()
    if (c.length >= 3 && !STOPWORDS.has(c.toLowerCase()) && /[A-Za-z_]/.test(c)) toks.push(c)
  }

  if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(s)) {
    push(s)
    push(s.split('.').pop())
  } else if (/^[-A-Za-z_$][\w$-]*$/.test(s)) {
    push(s)
  } else {
    // A longer literal such as a shell fragment or an error string: keep it whole if it is short
    // enough to be a plausible source substring, plus its identifier-looking words.
    if (s.length >= 6 && s.length <= 80) toks.push(s)
    for (const w of s.match(/[A-Za-z_$][\w$.]{2,}/g) ?? []) push(w)
  }
  return toks
}

// ---------------------------------------------------------------- verification

const fileCache = new Map()
function fileLines(abs) {
  if (!fileCache.has(abs)) fileCache.set(abs, readFileSync(abs, 'utf8').split('\n'))
  return fileCache.get(abs)
}

function occurrences(lines, anchor) {
  const hits = []
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(anchor)) hits.push(i + 1)
  return hits
}

function inSpans(spans, line) {
  return spans.some(([a, b]) => line >= a - SLACK && line <= b + SLACK)
}

/**
 * How far the declaration on `line` extends, by indentation. A document that cites a line INSIDE a
 * function names the function as its anchor -- 006-fma cites `huddle/index.ts:134` and writes
 * `#ensureWatching`, which is declared at 130. Without this, every such citation reads as stale.
 */
function blockEnd(lines, line) {
  const decl = lines[line - 1] ?? ''
  const base = decl.length - decl.trimStart().length
  if (!/[{(]\s*$/.test(decl.trimEnd())) return line
  for (let i = line; i < lines.length; i++) {
    const l = lines[i]
    if (!l.trim()) continue
    const indent = l.length - l.trimStart().length
    if (indent < base) return i
    if (indent === base && /^[})\]]/.test(l.trim())) return i + 1
  }
  return lines.length
}

/** The citation points at this anchor if it lands on it, or inside the block the anchor opens. */
function anchorCovers(lines, spans, at) {
  if (inSpans(spans, at)) return true
  const end = blockEnd(lines, at)
  if (end === at) return false
  const start = Math.min(...spans.map(([a]) => a))
  const stop = Math.max(...spans.map(([, b]) => b))
  if (start >= at - SLACK && start <= end + SLACK) return true
  return at >= start && at <= stop      // the declaration itself falls inside the cited range
}

/** Verify one citation against one candidate file. */
function verifyAgainst(cit, target, anchors) {
  const lines = fileLines(target.abs)
  const max = Math.max(...cit.spans.map(([, b]) => b))
  const overrun = max > lines.length

  // Rank candidate anchors by how rare they are in the file. The rarest anchor that occurs at all
  // is the decisive one -- a common token would let the citation pass for free.
  // An anchor that occurs all over the file is not discriminating: finding it inside the cited
  // span proves nothing, and finding it outside proves nothing either. Drop it rather than let it
  // decide -- `terminalId` occurs 100+ times in ORCA's bundled runtime.
  const ranked = []
  for (const a of anchors) {
    const hits = occurrences(lines, a)
    if (hits.length && hits.length <= MAX_ANCHOR_OCCURRENCES) ranked.push({ anchor: a, hits })
  }
  if (!ranked.length) {
    return overrun
      ? { verdict: 'stale', target, overrun, why: `line ${max} is past the end of ${target.rel} (${lines.length} lines)` }
      : { verdict: 'unanchored', target }
  }
  const byRarity = ranked.toSorted((x, y) => x.hits.length - y.hits.length || y.anchor.length - x.anchor.length)

  const hit = byRarity.find((r) => r.hits.some((l) => anchorCovers(lines, cit.spans, l)))
  if (hit) return { verdict: 'ok', target, anchor: hit.anchor }

  const best = byRarity[0]
  return {
    verdict: 'stale',
    target,
    overrun,
    anchor: best.anchor,
    why: overrun
      ? `line ${max} is past the end of ${target.rel} (${lines.length} lines)`
      : `\`${best.anchor}\` is not within the cited lines`,
    now: best.hits,
  }
}

// ok beats unanchored beats stale: with several candidate files for one bare name, a
// candidate we cannot check is weaker evidence of a bug than a candidate we can.
const RANK = { ok: 0, unanchored: 1, stale: 2 }

/** A citation is verified if it verifies against any candidate file for its path. */
function verify(cit, targets) {
  const anchors = anchorsFrom(cit.context)
  const results = targets.map((t) => verifyAgainst(cit, t, anchors))
  // Within an equal verdict, an in-range candidate is the more informative report: "the symbol
  // moved" beats "this file is too short" when the cited line plainly belongs to the other file.
  const ranked = results.toSorted((a, b) => RANK[a.verdict] - RANK[b.verdict] || (a.overrun ? 1 : 0) - (b.overrun ? 1 : 0))
  return ranked[0]
}

// ---------------------------------------------------------------- run

const counts = { total: 0, ok: 0, stale: 0, unanchored: 0, external: 0, orca: 0, repo: 0 }
const stale = []
const unanchored = []
const external = new Map()

for (const doc of DOCS) {
  for (const cit of collectCitations(doc)) {
    counts.total++
    const targets = cit.paths.flatMap((x) => resolvePath(x))
    if (!targets.length) {
      counts.external++
      external.set(cit.path, (external.get(cit.path) ?? 0) + 1)
      continue
    }
    const r = verify(cit, targets)
    counts[r.target.kind]++
    if (r.verdict === 'ok') counts.ok++
    else if (r.verdict === 'unanchored') { counts.unanchored++; unanchored.push({ cit, r }) }
    else { counts.stale++; stale.push({ cit, r }) }
    if (LIST) {
      console.log(
        `${r.verdict.padEnd(10)} ${cit.doc}:${cit.docLine}  ${cit.raw} -> ${r.target.rel}` +
        `${r.anchor ? `  [${r.anchor}]` : ''}`,
      )
    }
  }
}

// ------------------------------------------------------------------ --fix
//
// Shift a stale citation onto the anchor's current line, preserving the span's width. Code is
// almost always inserted ABOVE a claim rather than rewritten around it, so a uniform shift is the
// right repair; the re-run is what proves it, not this arithmetic.
let fixedCount = 0
let skippedCount = 0
if (FIX) {
  const edits = new Map()
  for (const { cit, r } of stale) {
    if (LOCKED.some((l) => cit.doc === l || cit.doc.endsWith('/' + l))) { skippedCount++; continue }
    // Only a HIGH-CONFIDENCE repair is applied. Everything else is a human's call, because a
    // wrong "fix" is a fabricated pointer -- the exact harm this tool exists to prevent.
    //   * the anchor must occur EXACTLY once in the file, so there is no choice to get wrong;
    //   * the citation must name its own path, so we are not also guessing the file;
    //   * the path must resolve to exactly one file.
    if (!r.now || r.now.length !== 1) { skippedCount++; continue }
    if (cit.inherited) { skippedCount++; continue }
    if (resolvePath(cit.path).length !== 1) { skippedCount++; continue }
    const start = Math.min(...cit.spans.map(([a]) => a))
    // Prefer the occurrence nearest the line the document already claims: drift is small and
    // directional, and picking the nearest keeps a multi-hit anchor from teleporting the citation.
    const target = r.now.reduce((best, l) => (Math.abs(l - start) < Math.abs(best - start) ? l : best))
    const delta = target - start
    if (delta === 0) { skippedCount++; continue }
    const rewritten = ':' + cit.spans.map(([a, b]) => (a === b ? `${a + delta}` : `${a + delta}-${b + delta}`)).join(',')
    const oldText = cit.raw
    const newText = (cit.raw.startsWith(':') ? '' : cit.raw.slice(0, cit.raw.indexOf(':'))) + rewritten
    if (!edits.has(cit.doc)) edits.set(cit.doc, [])
    edits.get(cit.doc).push({ line: cit.docLine, oldText, newText })
  }
  for (const [doc, list] of edits) {
    const abs = join(REPO, doc)
    const lines = readFileSync(abs, 'utf8').split('\n')
    // Right-to-left within a line so earlier replacements do not shift later offsets.
    for (const e of list.toSorted((a, b) => b.line - a.line)) {
      const i = e.line - 1
      if (!lines[i].includes(e.oldText)) { skippedCount++; continue }
      lines[i] = lines[i].replace(e.oldText, e.newText)
      fixedCount++
    }
    writeFileSync(abs, lines.join('\n'))
  }
}

// ORCA checkout HEAD -- documents claim a pinned commit; say so if the tree has moved.
const orcaHead = counts.orca > 0 ? (gitFiles(ORCA, ['rev-parse', 'HEAD'])[0] ?? null) : null

/* ================================================================ CONFIGURATION IDENTITY
 *
 * THE DEFECT THIS EXISTS TO END. This checker does not measure the same population in every
 * configuration. With an ORCA checkout resolved it checks ~527 citations into ORCA's tree and
 * calls ~129 paths external; with no checkout those same paths fall to external and the count is
 * drawn from a partly DISJOINT set. Measured, on one pinned tree: seven repairs moved the
 * ORCA-resolved count 92 -> 85 and the ORCA-absent count 98 -> 98. A team can therefore repair
 * everything a local run shows and leave CI exactly as red, with no way to tell that from a lack
 * of effort. That is a permanently-red signal carrying no information, and it will camouflage the
 * real failure when it comes.
 *
 * So every run now states which configuration produced its number, and a threshold calibrated in
 * one configuration is REFUSED in another rather than silently enforced.
 *
 * The ORCA SHA is part of the identity, not decoration: ORCA citations verified against a moved
 * checkout were verified against a different tree than the documents claim, which is a different
 * measurement again.
 */
function configId() {
  if (!ORCA_PRESENT) return 'orca:absent'
  if (orcaHead === null) return 'orca:present-unknown-head'
  return orcaHead === ORCA_PINNED ? `orca:${ORCA_PINNED.slice(0, 10)}` : `orca:moved@${orcaHead.slice(0, 10)}`
}
const CONFIG = configId()

/**
 * Uncommitted edits to the files citations point INTO change the answer, and in a shared worktree
 * they belong to somebody else. This is not a config -- it is a validity condition on the reading.
 * Reported loudly and never silently absorbed: the same tree read 139 while a peer had one source
 * file open and 85 once it was pinned.
 */
function dirtyTargets() {
  const out = gitFiles(REPO, ['status', '--porcelain'])
    .map((l) => l.slice(3).trim())
    .filter((f) => /\.(ts|tsx|js|mjs|cjs|json|yml)$/.test(f) && !f.startsWith('dist/'))
  return out
}
const DIRTY = dirtyTargets()

/* ---------------------------------------------------------------- the ratchet, per config */

function readRatchetFile() {
  const path = join(REPO, 'docs/.research/citation-ratchet.json')
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}
const RATCHET = readRatchetFile()
const ratchetEntry = RATCHET?.configs?.[CONFIG] ?? null

/**
 * Decide the threshold, and REFUSE rather than compare across configurations.
 *
 * Returns { limit, refuse } -- `refuse` is a message that forces a non-zero exit no matter what
 * the count is, because a number that cannot be honestly compared is worse than no number.
 */
function resolveThreshold() {
  if (USE_RATCHET) {
    if (RATCHET === null) {
      return { limit: 0, refuse: '--ratchet was passed but docs/.research/citation-ratchet.json is missing or unparseable.' }
    }
    if (ratchetEntry === null) {
      return {
        limit: 0,
        refuse:
          `no ratchet is calibrated for configuration ${CONFIG}. Calibrate one in ` +
          'docs/.research/citation-ratchet.json, on a CLEAN worktree, with the reason written beside it.',
      }
    }
    return { limit: ratchetEntry.maxStale, refuse: null }
  }
  if (MAX_STALE_ARG === undefined) return { limit: 0, refuse: null }

  // A number was passed on the command line. Only accept it if it IS this configuration's
  // calibrated ratchet; anything else is a threshold from somewhere else being applied here.
  if (ratchetEntry !== null && Number(MAX_STALE_ARG) !== ratchetEntry.maxStale) {
    const elsewhere = Object.entries(RATCHET?.configs ?? {})
      .filter(([, v]) => v.maxStale === Number(MAX_STALE_ARG))
      .map(([k]) => k)
    const supersededWhy = RATCHET?.superseded?.[String(Number(MAX_STALE_ARG))]
    return {
      limit: ratchetEntry.maxStale,
      refuse:
        `--max-stale=${MAX_STALE_ARG} is not the ratchet for configuration ${CONFIG}, which is ` +
        `${ratchetEntry.maxStale}.` +
        (elsewhere.length ? ` ${MAX_STALE_ARG} is the ratchet for ${elsewhere.join(', ')}.` : '') +
        (supersededWhy ? `\n           ${MAX_STALE_ARG} is recorded as SUPERSEDED: ${supersededWhy}` : '') +
        '\n           Pass --ratchet instead of a number, so the threshold travels with its ' +
        'configuration and its reasoning.',
    }
  }
  return { limit: MAX_STALE, refuse: null }
}
const { limit: STALE_LIMIT, refuse: REFUSAL } = resolveThreshold()

const problems =
  REFUSAL !== null ||
  stale.length > STALE_LIMIT || (STRICT && unanchored.length > 0) || (REQUIRE_ORCA && !ORCA_PRESENT)

if (stale.length) {
  console.error(`\nSTALE CITATIONS (${stale.length})\n`)
  for (const { cit, r } of stale) {
    console.error(`  ${cit.doc}:${cit.docLine}`)
    console.error(`    cited: ${cit.raw}${cit.inherited ? '  (inherits the preceding path)' : ''} -> ${r.target.rel}`)
    console.error(`    why:   ${r.why}`)
    if (r.now) {
      const shown = r.now.slice(0, 6).join(',') + (r.now.length > 6 ? ',…' : '')
      console.error(`    fix:   ${r.anchor} is now at ${r.target.rel}:${shown}`)
    }
  }
}

if (unanchored.length && (STRICT || LIST)) {
  console.error(`\nUNANCHORED (${unanchored.length}) — no token in the surrounding prose occurs in the`)
  console.error(`file, so the claim cannot be checked. Add a backticked symbol next to the citation.\n`)
  for (const { cit, r } of unanchored) {
    console.error(`  ${cit.doc}:${cit.docLine}  ${cit.raw} -> ${r.target.rel}`)
  }
}

// A missing ORCA checkout must be announced, not absorbed. Without it, ~480 citations resolve to
// "external" and the run goes green having checked less than half of what the documents assert --
// a permanently-green indicator, which is the failure this tool was written to end.
if (!ORCA_PRESENT) {
  const n = [...external.values()].reduce((a, b) => a + b, 0)
  console.error(`\nNOTICE: no ORCA checkout at ${ORCA} (set ORCA_SRC). ORCA citations were NOT`)
  console.error(`        checked; ${n} citations in total resolved to nothing and were skipped.`)
  if (REQUIRE_ORCA) console.error('        --require-orca was passed, so this is a failure.')
}

if (orcaHead && orcaHead !== ORCA_PINNED) {
  console.error(`\nWARNING: the ORCA checkout at ${ORCA} is HEAD ${orcaHead.slice(0, 10)},`)
  console.error(`         but the documents pin ${ORCA_PINNED.slice(0, 10)}. ORCA citations were`)
  console.error(`         verified against a different tree than the documents claim.`)
}

/* ---------------------------------------------------------------- the config line
 *
 * Printed on EVERY run, clean or not. The tool used to be quiet when clean, and quiet was the
 * problem: a bare count carries no evidence of which population produced it, so two runs that
 * disagree look like progress or regression instead of two different measurements. A number
 * without its configuration is unusable, and this repo proved it the expensive way.
 */
const thresholdLabel =
  REFUSAL !== null ? 'REFUSED'
  : USE_RATCHET ? `${STALE_LIMIT} (from citation-ratchet.json, calibrated ${RATCHET?.calibratedAt ?? '?'})`
  : MAX_STALE_ARG !== undefined ? `${STALE_LIMIT} (--max-stale, matches this config's ratchet)`
  : `${STALE_LIMIT} (none passed — any stale citation fails)`
console.error(
  `\nconfig:    ${CONFIG}  ·  threshold ${thresholdLabel}` +
  `  ·  tree ${DIRTY.length === 0 ? 'clean' : `DIRTY, ${DIRTY.length} file(s)`}`,
)
if (DIRTY.length > 0) {
  console.error(
    '           This count includes UNCOMMITTED edits to files citations point into, which in a\n' +
    '           shared worktree may be a peer\'s in-flight work rather than citation rot. Pin the\n' +
    '           reading: git worktree add --detach /tmp/x <sha>, symlink node_modules, re-run.',
  )
  for (const f of DIRTY.slice(0, 8)) console.error(`             ${f}`)
  if (DIRTY.length > 8) console.error(`             … and ${DIRTY.length - 8} more`)
}
if (REFUSAL !== null) {
  console.error(`\nREFUSED:   ${REFUSAL}`)
}

if (SUMMARY || problems) {
  console.error(
    `\ncitations: ${counts.total} found · ${counts.repo} into this repo · ${counts.orca} into ORCA` +
    ` (${orcaHead ? orcaHead.slice(0, 10) : 'n/a'}) · ${counts.external} external\n` +
    `verdicts:  ${counts.ok} verified · ${counts.stale} stale · ${counts.unanchored} unanchored`,
  )
  if (FIX) {
    console.error(`\n--fix rewrote ${fixedCount} citation(s); ${skippedCount} left for a human.`)
  }
  if (SUMMARY && external.size) {
    console.error(`\nexternal paths (not in this repo or ${ORCA}):`)
    for (const [pth, n] of [...external].toSorted((a, b) => b[1] - a[1])) {
      console.error(`  ${String(n).padStart(3)}  ${pth}`)
    }
  }
}

process.exit(problems ? 1 : 0)
