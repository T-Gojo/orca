import { copyFile, lstat, mkdir, readdir, readlink, rm, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'

/**
 * Fork: a private HOME for one worker that sees the user's real home (git, ssh, tools, settings)
 * through symlinks, except along `ownPath`, whose last entry is the worker's own copy.
 *
 * Why: agy and kiro-cli keep one login per machine. Running a worker with this HOME lets it use a
 * saved account's login without switching the login every other session of that agent uses.
 */
export async function prepareOverlayHome(args: {
  root: string
  /** Path under the real home that the worker gets its own copy of, e.g. `.gemini/antigravity-cli`. */
  ownPath: string
  realHome?: string
}): Promise<{ home: string; ownDirectory: string }> {
  const realHome = args.realHome ?? homedir()
  const parts = args.ownPath.split(/[\\/]/).filter(Boolean)
  if (parts.length === 0 || parts.includes('..')) {
    throw new Error(`Invalid overlay path: ${args.ownPath}`)
  }
  const home = join(args.root, 'home')
  let real = realHome
  let overlay = home
  for (const [index, part] of parts.entries()) {
    await mirrorDirectoryExcept(real, overlay, [part])
    real = join(real, part)
    overlay = join(overlay, part)
    if (index < parts.length - 1) {
      await mkdir(overlay, { recursive: true, mode: 0o700 })
    }
  }
  await mkdir(overlay, { recursive: true, mode: 0o700 })
  return { home, ownDirectory: overlay }
}

/**
 * Links every entry of a real directory into `overlay` except the named ones (and their `-wal`/
 * `-shm` siblings), refreshing links the user added since. Entries the worker wrote stay.
 */
export async function mirrorDirectoryExcept(
  real: string,
  overlay: string,
  privateNames: readonly string[]
): Promise<void> {
  await mkdir(overlay, { recursive: true, mode: 0o700 })
  const names: string[] = await readdir(real).catch(() => [])
  for (const name of names) {
    if (
      privateNames.some((privateName) => name === privateName || name.startsWith(`${privateName}-`))
    ) {
      continue
    }
    const target = join(real, name)
    const link = join(overlay, name)
    const existing = await lstat(link).catch(() => null)
    if (existing?.isSymbolicLink() && (await readlink(link)) === target) {
      continue
    }
    if (existing && !existing.isSymbolicLink()) {
      continue
    }
    await rm(link, { force: true })
    await symlink(target, link)
  }
}

/** Copies a SQLite database with its write-ahead log so the copy opens consistent. */
export async function copySqliteDatabase(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
  for (const suffix of ['', '-wal']) {
    await copyFile(`${source}${suffix}`, `${destination}${suffix}`).catch(
      (error: NodeJS.ErrnoException) => {
        if (!(suffix && error.code === 'ENOENT')) {
          throw error
        }
      }
    )
  }
}

/** The path of `absolute` under the real home, or null when it lives elsewhere. */
export function pathUnderHome(absolute: string, realHome = homedir()): string | null {
  const rel = relative(realHome, absolute)
  return rel && !rel.startsWith('..') && !rel.startsWith(sep) ? rel : null
}
