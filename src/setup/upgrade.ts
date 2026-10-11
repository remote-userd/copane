/**
 * `copane --upgrade`: replace the running binary with the latest GitHub release.
 *
 * Downloads the release archive for this platform, checks it against SHA256SUMS, and renames the
 * new binary over the old one, the same way install.sh does, so open editors offer a restart.
 */
// mkdtemp, rename, chmod: Bun has no API for them.
import { chmod, mkdtemp, rename, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isCompiled } from "../app/update"
import pkg from "../../package.json"

export const REPO = "sevheng/copane"

/** Release archive name for a platform, or null when there is no build for it. */
export function assetName(platform: string = process.platform, arch: string = process.arch): string | null {
  const os = platform === "linux" || platform === "darwin" ? platform : null
  const cpu = arch === "x64" || arch === "arm64" ? arch : null
  return os && cpu ? `copane-${os}-${cpu}.tar.gz` : null
}

/** The hash for `name` in a `sha256sum` listing. */
export function checksumFor(sums: string, name: string): string | null {
  for (const line of sums.split("\n")) {
    const [hash, file] = line.trim().split(/\s+\*?/)
    if (file === name && hash) return hash.toLowerCase()
  }
  return null
}

/** True when `tag` (v1.2.3) is a newer version than `current` (1.2.3). */
export function isNewer(tag: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split("-")[0]!.split(".").map(Number)
  const [a, b] = [parse(tag), parse(current)]
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d) return d > 0
  }
  return false
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { "User-Agent": `copane/${pkg.version}` } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res
}

/** The latest release's tag (v1.2.3) on GitHub. */
export async function latestRelease(): Promise<string> {
  const release = (await (await fetchOk(`https://api.github.com/repos/${REPO}/releases/latest`)).json()) as { tag_name?: string }
  if (!release.tag_name) throw new Error("no release found")
  return release.tag_name
}

/**
 * Download a release for this platform, check it against SHA256SUMS, and rename it over the
 * running binary (the way install.sh does), so open editors see one clean change and offer a
 * restart. Throws with a readable message.
 */
export async function installRelease(tag: string, target = process.execPath): Promise<void> {
  const asset = assetName()
  if (!asset) throw new Error(`no release build for ${process.platform}-${process.arch}`)
  const dir = await mkdtemp(join(tmpdir(), "copane-upgrade-"))
  try {
    const base = `https://github.com/${REPO}/releases/download/${tag}`
    const [archive, sums] = await Promise.all([
      fetchOk(`${base}/${asset}`).then((r) => r.bytes()),
      fetchOk(`${base}/SHA256SUMS`).then((r) => r.text()),
    ])
    const expected = checksumFor(sums, asset)
    const actual = new Bun.CryptoHasher("sha256").update(archive).digest("hex")
    if (!expected || expected !== actual) throw new Error(`checksum mismatch for ${asset}`)

    const tarball = join(dir, asset)
    await Bun.write(tarball, archive)
    const tar = Bun.spawn(["tar", "-xzf", tarball, "-C", dir], { stdout: "ignore", stderr: "pipe" })
    if ((await tar.exited) !== 0) throw new Error(`could not unpack ${asset}: ${(await Bun.readableStreamToText(tar.stderr)).trim()}`)

    // Replace by rename: running editors keep their old file and see one clean change.
    const next = `${target}.new`
    try {
      await Bun.write(next, Bun.file(join(dir, "copane", "copane")))
      await chmod(next, 0o755)
      await rename(next, target)
    } catch (err) {
      await Bun.file(next).delete().catch(() => null)
      const code = (err as NodeJS.ErrnoException).code
      if (code === "EACCES" || code === "EPERM") throw new Error(`no permission to write ${target}; try again with sudo`)
      throw err
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Run the upgrade and return the exit code. */
export async function upgrade(log: (line: string) => void = console.log): Promise<number> {
  if (!isCompiled()) {
    log("Running from source: update with `git pull`, then `bun run install:cli`.")
    return 1
  }
  if (!assetName()) {
    log(`No release build for ${process.platform}-${process.arch}.`)
    return 1
  }
  try {
    const tag = await latestRelease()
    if (!isNewer(tag, pkg.version)) {
      log(`copane ${pkg.version} is up to date.`)
      return 0
    }
    log(`Downloading copane ${tag} (${assetName()})...`)
    await installRelease(tag)
    log(`Updated copane ${pkg.version} → ${tag} (${process.execPath}). Open editors offer a restart.`)
    return 0
  } catch (err) {
    log(`Upgrade failed: ${(err as Error).message}`)
    return 1
  }
}
