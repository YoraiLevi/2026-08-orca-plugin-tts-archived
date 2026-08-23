/**
 * R19-01: the build consult arm must fail unless the live throw is an instance of
 * `PocketModelUnavailableError` imported FROM THE BUNDLE, with structured status.
 *
 * Round 17 grepped a class NAME. Round 18 grepped `/pocket:/`. Round 18's repair
 * grepped two substrings of a sentence. Round 19's stub interpolated that sentence
 * and `pnpm build` stayed EXIT 0 while the class was gone. A sentence is a string.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  consultProvesRealPocket,
  REQUIRED_POCKET_FILES,
  POCKET_WEIGHT_THE_REAL_CLASS_ENUMERATES,
} from './artifact-score.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD = join(ROOT, 'scripts/build.mjs')
const EMPTY = '/var/folders/xx/r19-empty-dir'

class BundlePocketModelUnavailableError extends Error {
  constructor (status) {
    super(`Pocket TTS model is not ready in ${status.dir}: missing ${(status.missing ?? []).join(', ')}`)
    this.name = 'PocketModelUnavailableError'
    this.status = status
  }
}

function absentStatus (dir, missing = REQUIRED_POCKET_FILES) {
  return { kind: 'absent', dir, missing: [...missing] }
}

describe('R19-01: consultProvesRealPocket is instanceof + structured status', () => {
  it('REJECTS round 19\'s interpolating Error — the sentence the last guard named', () => {
    const err = new Error(
      `Pocket TTS model is not ready in ${EMPTY}: missing tokenizer.model, ` +
      `${POCKET_WEIGHT_THE_REAL_CLASS_ENUMERATES}, eve.wav`,
    )
    expect(
      consultProvesRealPocket(err, EMPTY, BundlePocketModelUnavailableError),
      'R19 stub interpolated the product sentence and must not satisfy instanceof',
    ).toBe(false)
  })

  it('REJECTS round 18\'s stub — id:pocket whose throw contains pocket:', () => {
    const err = new Error('pocket: mutant stub')
    expect(consultProvesRealPocket(err, EMPTY, BundlePocketModelUnavailableError)).toBe(false)
  })

  it('REJECTS a haystack string — the R17/R18 costume; a sentence is not a class', () => {
    const hay = {
      error: `Pocket TTS model is not ready in ${EMPTY}: missing ${POCKET_WEIGHT_THE_REAL_CLASS_ENUMERATES}`,
      logs: ['x'],
    }
    expect(consultProvesRealPocket(hay, EMPTY, BundlePocketModelUnavailableError)).toBe(false)
  })

  it('REJECTS a duck-typed object with the right status that is not instanceof the bundle class', () => {
    const duck = {
      name: 'PocketModelUnavailableError',
      message: `Pocket TTS model is not ready in ${EMPTY}: missing tokenizer.model`,
      status: absentStatus(EMPTY),
    }
    expect(consultProvesRealPocket(duck, EMPTY, BundlePocketModelUnavailableError)).toBe(false)
  })

  it('REJECTS an instance of a DIFFERENT class that copies the name and the sentence', () => {
    class Impostor extends Error {
      constructor (status) {
        super(`Pocket TTS model is not ready in ${status.dir}: missing ${status.missing.join(', ')}`)
        this.name = 'PocketModelUnavailableError'
        this.status = status
      }
    }
    const err = new Impostor(absentStatus(EMPTY))
    expect(consultProvesRealPocket(err, EMPTY, BundlePocketModelUnavailableError)).toBe(false)
  })

  it('REJECTS the real class constructed for a DIFFERENT dir', () => {
    const err = new BundlePocketModelUnavailableError(absentStatus('/somewhere/else'))
    expect(consultProvesRealPocket(err, EMPTY, BundlePocketModelUnavailableError)).toBe(false)
  })

  it('REJECTS the real class with a partial missing list (three filenames is a sentence, not 23 files)', () => {
    const err = new BundlePocketModelUnavailableError(absentStatus(EMPTY, [
      'tokenizer.model', POCKET_WEIGHT_THE_REAL_CLASS_ENUMERATES, 'eve.wav',
    ]))
    expect(consultProvesRealPocket(err, EMPTY, BundlePocketModelUnavailableError)).toBe(false)
  })

  it('REJECTS a missing-class third argument — cannot claim instanceof without the bundle class', () => {
    const err = new BundlePocketModelUnavailableError(absentStatus(EMPTY))
    expect(consultProvesRealPocket(err, EMPTY, undefined)).toBe(false)
    expect(consultProvesRealPocket(err, EMPTY)).toBe(false)
  })

  it('ACCEPTS instanceof the bundle class + this dir + all 23 required files', () => {
    const err = new BundlePocketModelUnavailableError(absentStatus(EMPTY))
    expect(consultProvesRealPocket(err, EMPTY, BundlePocketModelUnavailableError)).toBe(true)
  })

  it('CONTROL: the restated table is 23 names and includes the pins a stub used to name', () => {
    expect(REQUIRED_POCKET_FILES).toHaveLength(23)
    expect(REQUIRED_POCKET_FILES).toContain(POCKET_WEIGHT_THE_REAL_CLASS_ENUMERATES)
    expect(REQUIRED_POCKET_FILES).toContain('tokenizer.model')
    expect(REQUIRED_POCKET_FILES).toContain('eve.wav')
    expect(REQUIRED_POCKET_FILES).toContain('LICENSE')
    expect(REQUIRED_POCKET_FILES).toContain('.orca-tts-model-manifest')
  })
})

describe('scripts/build.mjs actually uses that identity (P26)', () => {
  const src = readFileSync(BUILD, 'utf8')

  it('imports consultProvesRealPocket and the restated 23-file table', () => {
    expect(src).toContain("from './artifact-score.mjs'")
    expect(src).toContain('consultProvesRealPocket(thrown, emptyModel, BundleError)')
    expect(src).toContain('REQUIRED_POCKET_FILES')
  })

  it('imports PocketModelUnavailableError FROM THE BUNDLE and demands instanceof', () => {
    expect(src).toContain('mod.PocketModelUnavailableError')
    expect(src).toContain('mod.PocketSynthProvider')
    expect(src).toContain('new BundleProvider({ dir: emptyModel })')
    expect(src).toContain('thrown instanceof BundleError')
    expect(src).toContain('pathToFileURL(resolvePath(`${OUT}/main.mjs`))')
  })

  it('pins the named exports AFTER tree-shake, so they cannot keep a dead class alive', () => {
    expect(src).toContain('PocketModelUnavailableError,\n  PocketSynthProvider')
    expect(src).toContain('var PocketSynthProvider = class')
    expect(src).toContain('new PocketSynthProvider()')
  })

  it('no longer greps a sentence out of a consult haystack — the R18-01 / R19-01 costume', () => {
    expect(src).not.toMatch(/hay\.includes/)
    expect(src).not.toMatch(/\/pocket:\/\.test/)
    expect(src).not.toContain('consultProvesRealPocket(consult, emptyModel)')
  })
})
