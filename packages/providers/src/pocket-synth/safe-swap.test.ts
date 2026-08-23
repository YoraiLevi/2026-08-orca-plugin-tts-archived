/**
 * The crash-safe swap is one function. Callers invoke it; they do not restate it.
 *
 * R16-03 claimed the swap lived here. Round 17 found the file ended at lock/recovery helpers
 * and both caches had inlined a different body. Runtime's leftover-staging cleanup swapped
 * (base, name); its catch rm(dir)'d on a throw that happened before the swap. The tests
 * below fail if either caller copies the two-rename sequence back into itself.
 *
 * Temp dirs only (R061). Zero audio (P31).
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { swapLiveDirectory } from './safe-swap.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const made: string[] = []
const scratch = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'safe-swap-'))
  made.push(d)
  return d
}
afterEach(async () => { for (const d of made.splice(0)) await rm(d, { recursive: true, force: true }) })

function readSrc(name: string): string {
  return readFileSync(join(HERE, name), 'utf8')
}

function seed(dir: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'payload.txt'), 'PREVIOUS')
}

function stillPrevious(dir: string): boolean {
  return existsSync(join(dir, 'payload.txt')) && readFileSync(join(dir, 'payload.txt'), 'utf8') === 'PREVIOUS'
}

describe('the swap is genuinely shared', () => {
  it('lives in safe-swap.ts as swapLiveDirectory, with the two-rename sequence', () => {
    const src = readSrc('safe-swap.ts')
    expect(src, 'the swap function is missing — R16-03 claimed it was here and it was not')
      .toMatch(/export async function swapLiveDirectory\b/)
    // The body that actually moves directories. Restated as literals so a rename of locals
    // that quietly drops the sequence is visible (P36: do not import the function and
    // assert it exists).
    expect(src).toMatch(/await rename\(\s*dir\s*,\s*backup\s*\)/)
    expect(src).toMatch(/await rename\(\s*staging\s*,\s*dir\s*\)/)
  })

  it('FAILS if a caller re-inlines the swap instead of invoking the shared function', () => {
    // R17-05. models.ts and runtime.ts each inlined a different swap. A comment claiming
    // the machinery moved here is not a check. If a caller copies `await rename(dir, backup)`
    // back into itself, this row goes red — even if the leftover-staging test still happens
    // to pass because that caller copied the *correct* half.
    const models = readSrc('models.ts')
    const runtime = readSrc('runtime.ts')

    expect(models, 'downloadModel does not invoke the shared swap').toMatch(/\bswapLiveDirectory\s*\(/)
    expect(runtime, 'downloadRuntime does not invoke the shared swap').toMatch(/\bswapLiveDirectory\s*\(/)

    const inlinedMove = /await rename\(\s*(dir|staging)\s*,/
    expect(models, 'models.ts re-inlined a directory rename; the swap is supposed to live in one place')
      .not.toMatch(inlinedMove)
    expect(runtime, 'runtime.ts re-inlined a directory rename; the swap is supposed to live in one place')
      .not.toMatch(inlinedMove)

    const catchDeletesLive = /await rm\(\s*dir\s*,/
    expect(models, 'models.ts restated the catch that rm(dir) — that is the R17-03 defect')
      .not.toMatch(catchDeletesLive)
    expect(runtime, 'runtime.ts restated the catch that rm(dir) — that is the R17-03 defect')
      .not.toMatch(catchDeletesLive)
  })
})

describe('swapLiveDirectory', () => {
  it('KEEPS the previous tree when afterStage throws, before live is touched', async () => {
    const dir = join(scratch(), 'cache')
    seed(dir)
    await expect(swapLiveDirectory(dir, async (staging) => {
      writeFileSync(join(staging, 'payload.txt'), 'NEW')
    }, { afterStage: () => { throw new Error('injected: died while staging') } }))
      .rejects.toThrow(/injected: died while staging/)
    expect(existsSync(dir), 'afterStage throw deleted live').toBe(true)
    expect(stillPrevious(dir)).toBe(true)
  })

  it('KEEPS the previous tree when afterBackup throws, after live moved aside', async () => {
    const dir = join(scratch(), 'cache')
    seed(dir)
    await expect(swapLiveDirectory(dir, async (staging) => {
      writeFileSync(join(staging, 'payload.txt'), 'NEW')
    }, { afterBackup: () => { throw new Error('injected: died mid-rename') } }))
      .rejects.toThrow(/injected/)
    expect(stillPrevious(dir)).toBe(true)
  })

  it('replaces the previous tree on success, and names the staging uniquely', async () => {
    const root = scratch()
    const dir = join(root, 'cache')
    seed(dir)
    const seen: string[] = []
    await swapLiveDirectory(dir, async (staging) => {
      seen.push(staging)
      writeFileSync(join(staging, 'payload.txt'), 'NEW')
    })
    expect(readFileSync(join(dir, 'payload.txt'), 'utf8')).toBe('NEW')
    expect(seen).toHaveLength(1)
    expect(seen[0], 'staging must be a sibling of live, not a system temp path').toMatch(/\.staging-/)
    expect(seen[0]?.startsWith(`${dir}.staging-`)).toBe(true)
    // Unique per attempt, not per pid: `${dir}.staging-${pid}` collided across in-process callers.
    expect(seen[0]).toMatch(/\.staging-\d+-[0-9a-f]+$/)
    expect(readdirSync(root).filter((n) => n.includes('.staging-') || n.includes('.previous'))).toEqual([])
  })

  it('removes leftover .staging-* from a killed predecessor on the next successful swap', async () => {
    const root = scratch()
    const dir = join(root, 'cache')
    seed(dir)
    const leftover = `${dir}.staging-99999`
    mkdirSync(leftover, { recursive: true })
    writeFileSync(join(leftover, 'orphan.bin'), 'ORPHAN')
    await swapLiveDirectory(dir, async (staging) => {
      writeFileSync(join(staging, 'payload.txt'), 'NEW')
    })
    expect(existsSync(leftover), 'leftover staging survived a successful swap').toBe(false)
    expect(readFileSync(join(dir, 'payload.txt'), 'utf8')).toBe('NEW')
  })
})
