import { dirname, join, relative, sep } from "node:path"

/**
 * Files that mark a project for each server: its nearest folder with one is the server's root.
 * TypeScript goes by package, not tsconfig: the server finds each file's tsconfig itself, and a
 * package often has several (Nuxt's server/tsconfig.json).
 */
const MARKERS: Record<string, string[]> = {
  typescript: ["package.json"],
  vue: ["package.json"],
  go: ["go.mod"],
  python: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt"],
  rust: ["Cargo.toml"],
}

// Looked up once per folder and server: opening files asks again for every file.
const cache = new Map<string, Promise<string>>()

/**
 * The folder a server for `file` should run in: the nearest one between the file and `root`
 * holding one of that server's markers (a package in a monorepo), else `root` itself.
 * Never above `root`, and `root` for files outside it.
 */
export function projectRoot(serverKey: string, file: string, root: string): Promise<string> {
  const markers = MARKERS[serverKey]
  const rel = relative(root, file)
  if (!markers || rel.startsWith("..") || rel.startsWith(sep)) return Promise.resolve(root)
  const dir = dirname(file)
  const key = `${serverKey}\0${root}\0${dir}`
  let found = cache.get(key)
  if (!found) {
    found = (async () => {
      for (let d = dir; d.length >= root.length; d = dirname(d)) {
        for (const m of markers) if (await Bun.file(join(d, m)).exists()) return d
        if (d === root || dirname(d) === d) break
      }
      return root
    })()
    cache.set(key, found)
  }
  return found
}

/** Tests: folders differ per test, but a marker added later must be seen. */
export function resetProjectRoots(): void {
  cache.clear()
}
