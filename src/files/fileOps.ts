// Bun has no rename/remove/mkdir/listing APIs: those stay on node:fs.
import { mkdir, readdir, rename, rm } from "node:fs/promises"
import { dirname, isAbsolute, join } from "node:path"

/** File-tree operations. Each returns the affected absolute path or throws an Error with a user-facing message. */

/** Problems with a typed name, or null. Names may contain "/" to create nested paths. */
export function validateName(name: string): string | null {
  const n = name.trim()
  if (!n) return "Name is empty"
  if (n.includes("\0")) return "Name contains a NUL character"
  if (isAbsolute(n)) return "Use a name relative to the folder"
  const parts = n.split(/[\\/]/)
  if (parts.some((p) => p === "..")) return "Name cannot contain .."
  if (parts.every((p) => p === "" || p === ".")) return "Name is empty"
  return null
}

/** A file or a folder at `path` (Bun.file().exists() is false for folders, so stat it). */
async function exists(path: string): Promise<boolean> {
  return Bun.file(path)
    .stat()
    .then(() => true)
    .catch(() => false)
}

function target(dir: string, name: string): string {
  const err = validateName(name)
  if (err) throw new Error(err)
  return join(dir, name.trim())
}

export async function createFile(dir: string, name: string): Promise<string> {
  const path = target(dir, name)
  if (await exists(path)) throw new Error(`${name.trim()} already exists`)
  await Bun.write(path, "") // creates missing parent folders
  return path
}

export async function createFolder(dir: string, name: string): Promise<string> {
  const path = target(dir, name)
  if (await exists(path)) throw new Error(`${name.trim()} already exists`)
  await mkdir(path, { recursive: true })
  return path
}

/** Rename within the same parent folder (a "/" in the name moves it into a subfolder). */
export async function renamePath(from: string, toName: string): Promise<string> {
  const to = target(dirname(from), toName)
  if (to === from) return from
  if (await exists(to)) throw new Error(`${toName.trim()} already exists`)
  await mkdir(dirname(to), { recursive: true })
  await rename(from, to)
  return to
}

/** Permanently delete a file or a folder with everything in it. */
export async function deletePath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: false })
}

/** Number of files and folders inside a folder (for the delete confirmation), capped. */
export async function countEntries(dir: string, cap = 10_000): Promise<number> {
  let n = 0
  const queue = [dir]
  while (queue.length && n < cap) {
    let entries
    try {
      entries = await readdir(queue.shift()!, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      n++
      if (e.isDirectory()) queue.push(join(e.parentPath, e.name))
    }
  }
  return n
}
