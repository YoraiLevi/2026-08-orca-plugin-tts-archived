#!/usr/bin/env node
// Splice voice-lab/lib/*.mjs into index.html between its markers.
//
// The page must be self-contained — no CDN, no external fetch, no build step at serve time — and
// the pure functions must be importable by a test that runs without a browser. Those two demands
// pull in opposite directions, and the usual resolution (copy the code by hand into the page) goes
// stale silently. So: the lib files are the source, this script splices them in, and
// voice-lab/lib/inline.test.mjs fails if the copy in the page has drifted from the source. The
// test is the guard; this script is the convenience.

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

export const INLINED = [
  'lib/controls.mjs', 'lib/diff.mjs', 'lib/cache-key.mjs',
  'lib/settings.mjs', 'lib/keys.mjs', 'lib/earcons.mjs'
]

/**
 * The exact transform from module source to inlined source: drop the local `import` lines (every
 * module ends up in one scope) and drop the `export` keyword. Nothing else changes, so a drift
 * check is a string comparison rather than a judgement call.
 */
export function inlineForm (source) {
  return source
    .split('\n')
    .filter((line) => !/^import\s.*from\s+'\.\/[\w.-]+\.mjs'\s*$/.test(line.trim()))
    .map((line) => line.replace(/^export (?=(const|function|let|class)\b)/, ''))
    .join('\n')
    .trim()
}

export function markers (name) {
  return { begin: `/* ==INLINE BEGIN ${name}== */`, end: `/* ==INLINE END ${name}== */` }
}

export function splice (html, name, body) {
  const { begin, end } = markers(name)
  const a = html.indexOf(begin)
  const b = html.indexOf(end)
  if (a < 0 || b < 0) throw new Error(`index.html has no markers for ${name}`)
  return html.slice(0, a + begin.length) + '\n' + body + '\n' + html.slice(b)
}

export function extract (html, name) {
  const { begin, end } = markers(name)
  const a = html.indexOf(begin)
  const b = html.indexOf(end)
  if (a < 0 || b < 0) return null
  return html.slice(a + begin.length, b).trim()
}

async function main () {
  const htmlPath = join(HERE, 'index.html')
  let html = await readFile(htmlPath, 'utf8')
  for (const name of INLINED) {
    const source = await readFile(join(HERE, name), 'utf8')
    html = splice(html, name, inlineForm(source))
  }
  await writeFile(htmlPath, html)
  console.log(`inlined ${INLINED.length} modules into ${htmlPath}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main()
