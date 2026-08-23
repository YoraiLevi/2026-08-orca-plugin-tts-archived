/**
 * R18-01: the build consult arm must fail unless the bundled PocketSynthProvider
 * actually ran `prepare()` against the empty dir the harness created.
 *
 * Round 17 grepped `/pocket:/` out of a log. Round 18's stub (`id: 'pocket'`,
 * `prepare()` throws `'pocket: mutant stub'`) kept `pnpm build` at EXIT 0 while
 * `PocketSynthProvider` and `PocketTts` were both absent from the artifact.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  consultProvesRealPocket,
  POCKET_WEIGHT_THE_REAL_CLASS_ENUMERATES,
} from './artifact-score.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD = join(ROOT, 'scripts/build.mjs')
const EMPTY = '/var/folders/xx/r18-empty-dir'

function hay (text) {
  return { error: text, logs: [text], engineReady: null }
}

describe('R18-01: consultProvesRealPocket is something a stub cannot fake', () => {
  it('REJECTS round 18\'s stub — id:pocket whose throw contains pocket:', () => {
    const consult = hay(
      'read-aloud: no speech engine is available on this system (prepare-failed) — ' +
      'os-synth: diagnostic: OS floor forced down; pocket: mutant stub, real class skipped',
    )
    expect(
      consultProvesRealPocket(consult, EMPTY),
      'R18 stub satisfied /pocket:/ and must not satisfy the real-class check',
    ).toBe(false)
  })

  it('REJECTS round 17\'s log-string mutant — the name with no prepare()', () => {
    const consult = hay('PocketSynthProvider')
    expect(consultProvesRealPocket(consult, EMPTY)).toBe(false)
  })

  it('REJECTS a pocket: hit that does not name THIS empty directory', () => {
    const consult = hay(
      `pocket: Pocket TTS model is not ready in /somewhere/else: missing ${POCKET_WEIGHT_THE_REAL_CLASS_ENUMERATES}`,
    )
    expect(consultProvesRealPocket(consult, EMPTY)).toBe(false)
  })

  it('ACCEPTS the real PocketModelUnavailableError for THIS dir + a Pocket weight', () => {
    const consult = hay(
      'read-aloud: no speech engine is available on this system (prepare-failed) — ' +
      `os-synth: diagnostic: OS floor forced down; pocket: Pocket TTS model is not ready in ${EMPTY}: ` +
      `missing tokenizer.model, ${POCKET_WEIGHT_THE_REAL_CLASS_ENUMERATES}, eve.wav`,
    )
    expect(consultProvesRealPocket(consult, EMPTY)).toBe(true)
  })

  it('CONTROL: missing either half is not enough — weight without the dir', () => {
    const consult = hay(`missing ${POCKET_WEIGHT_THE_REAL_CLASS_ENUMERATES}`)
    expect(consultProvesRealPocket(consult, EMPTY)).toBe(false)
  })
})

describe('scripts/build.mjs actually uses that predicate (P26)', () => {
  const src = readFileSync(BUILD, 'utf8')

  it('imports consultProvesRealPocket and calls it on the consult child', () => {
    expect(src).toContain("from './artifact-score.mjs'")
    expect(src).toContain('consultProvesRealPocket(consult, emptyModel)')
  })

  it('no longer greps /pocket:/ out of the consult haystack — the R18-01 costume', () => {
    expect(src).not.toMatch(/\/pocket:\/\.test\(consultHay\)/)
    expect(src).not.toMatch(/\/engine ready \\+\(Pocket TTS/)
  })
})
