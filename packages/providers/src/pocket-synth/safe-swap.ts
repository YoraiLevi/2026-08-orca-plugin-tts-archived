/**
 * Crash-safe directory replacement, shared by every cache this plugin installs.
 *
 * **This exists because the same defect was fixed twice in two places and then found a third
 * time in a third.** R14-06: the model swap deleted the live directory before the fallible
 * rename. R15-02: the repair survived exceptions but not `SIGKILL` or a second process. R16-03:
 * the runtime cache — written AFTER both of those — had the original bug again, and its test
 * named for swap safety threw before reaching either rename.
 *
 * Fixing one call site three times is how a defect becomes a habit. The machinery below was
 * written for `models.ts` and is lifted here unchanged so `runtime.ts` cannot have a different
 * answer, and so the next cache cannot either.
 *
 * The guarantees, in the order they matter:
 *
 *  1. **A failed replacement leaves what was there.** Stage beside the target (same filesystem, so
 *     no `EXDEV`), rename the live directory aside, rename staging in, discard the backup LAST.
 *  2. **`SIGKILL` is survivable.** `finally` does not run when a process is killed, so the backup
 *     has a STABLE name and the next start recovers from it. A per-pid backup name is a name, not
 *     a recovery.
 *  3. **Two writers cannot both win.** An `O_EXCL` lock file carrying the holder's pid, stolen
 *     exactly once when that pid is gone. Advisory, filesystem-visible, and honest about being
 *     both.
 *
 * The machine that fails halfway is the machine that can least afford to lose the copy it had.
 */

import { readFile, rename, rm, readdir, open } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'

export class DownloadInProgressError extends Error {
  readonly lockPath: string
  readonly holderPid: number | null

  constructor(lockPath: string, holderPid: number | null) {
    const who = holderPid !== null ? ` (pid ${holderPid})` : ''
    super(`download already in progress${who}; refusing a second writer for ${lockPath}`)
    this.name = 'DownloadInProgressError'
    this.lockPath = lockPath
    this.holderPid = holderPid
  }
}

export function lockPathFor(dir: string): string {
  return `${dir}.lock`
}

export function backupPathFor(dir: string): string {
  return `${dir}.previous`
}

export function journalPathFor(dir: string): string {
  return `${dir}.swap-journal`
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: the process exists, we just cannot signal it.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export async function readLockPid(lockPath: string): Promise<number | null> {
  try {
    const raw = (await readFile(lockPath, 'utf8')).trim()
    const pid = Number(raw)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

export interface HeldLock {
  readonly path: string
  release: () => Promise<void>
}

export async function acquireDownloadLock(dir: string): Promise<HeldLock> {
  const lockPath = lockPathFor(dir)
  const tryCreate = async (): Promise<HeldLock | 'busy'> => {
    try {
      const fh = await open(lockPath, 'wx')
      await fh.writeFile(`${process.pid}\n`)
      let released = false
      return {
        path: lockPath,
        release: async () => {
          if (released) return
          released = true
          await fh.close().catch(() => undefined)
          await rm(lockPath, { force: true })
        },
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      return 'busy'
    }
  }

  const first = await tryCreate()
  if (first !== 'busy') return first

  const holder = await readLockPid(lockPath)
  if (holder !== null && pidAlive(holder)) {
    throw new DownloadInProgressError(lockPath, holder)
  }
  // Stale: the holder died (SIGKILL does not run `finally`). Steal once.
  await rm(lockPath, { force: true })
  const second = await tryCreate()
  if (second !== 'busy') return second
  const other = await readLockPid(lockPath)
  throw new DownloadInProgressError(lockPath, other)
}

export function isBackupName(base: string, name: string): boolean {
  return name === `${base}.previous` || name.startsWith(`${base}.previous-`)
}

export function isStagingName(base: string, name: string): boolean {
  return name.startsWith(`${base}.staging-`)
}

/**
 * If live is gone and a backup sibling remains, put the backup back.
 *
 * Does NOT recover while a live writer holds the lock — that writer is mid-swap and the missing
 * live directory is the window, not a crash. A dead pid in the lock file is a crash; then we do
 * recover. Also accepts the old `*.previous-<pid>` names so a cache crashed under the R14-06
 * scheme is not orphaned forever (or deleted on pid reuse).
 */
export async function recoverLiveFromBackup(dir: string): Promise<void> {
  if (existsSync(dir)) return
  const lockPath = lockPathFor(dir)
  if (existsSync(lockPath)) {
    const holder = await readLockPid(lockPath)
    if (holder !== null && pidAlive(holder)) return
  }
  const parent = dirname(dir)
  const base = basename(dir)
  if (!existsSync(parent)) return
  const backups = (await readdir(parent))
    .filter((n) => isBackupName(base, n))
    .toSorted((a, b) => {
      if (a === `${base}.previous`) return -1
      if (b === `${base}.previous`) return 1
      return a.localeCompare(b)
    })
  if (backups.length === 0) return
  const chosen = backups[0]
  if (chosen === undefined) return
  try {
    await rename(join(parent, chosen), dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  await rm(journalPathFor(dir), { force: true })
}

export async function removeMatchingSiblings(
  dir: string,
  match: (base: string, name: string) => boolean,
): Promise<void> {
  const parent = dirname(dir)
  const base = basename(dir)
  if (!existsSync(parent)) return
  for (const name of await readdir(parent)) {
    if (match(base, name)) await rm(join(parent, name), { recursive: true, force: true })
  }
}

/* --------------------------------------------------------------------------------- fetching */

