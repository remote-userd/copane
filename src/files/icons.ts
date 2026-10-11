import { extname } from "node:path"
import { ui as colors } from "../config/theme"

/**
 * File-tree icons. "nerd" uses Nerd Fonts glyphs (needs a Nerd Font in the terminal, which
 * `bun run install:cli` sets up), "simple" uses plain symbols any font has, "none" shows none.
 */
export type IconStyle = "nerd" | "simple" | "none"

export interface Icon {
  glyph: string
  color: string
}

interface Kind {
  nerd: string
  simple: string
  color: string
}

const K = {
  ts: { nerd: "", simple: "◆", color: colors.iconBlue },
  react: { nerd: "", simple: "◆", color: colors.iconCyan },
  js: { nerd: "", simple: "◆", color: colors.iconYellow },
  json: { nerd: "", simple: "{", color: colors.iconYellow },
  md: { nerd: "", simple: "¶", color: colors.iconBlue },
  git: { nerd: "", simple: "±", color: colors.iconOrange },
  npm: { nerd: "", simple: "■", color: colors.iconRed },
  lock: { nerd: "", simple: "·", color: colors.dim },
  shell: { nerd: "", simple: "$", color: colors.iconGreen },
  config: { nerd: "", simple: "≡", color: colors.dim },
  image: { nerd: "", simple: "▣", color: colors.iconPurple },
  css: { nerd: "", simple: "#", color: colors.iconBlue },
  html: { nerd: "", simple: "<", color: colors.iconOrange },
  python: { nerd: "", simple: "◆", color: colors.iconYellow },
  rust: { nerd: "", simple: "◆", color: colors.iconOrange },
  go: { nerd: "", simple: "◆", color: colors.iconCyan },
  zig: { nerd: "", simple: "◆", color: colors.iconOrange },
  text: { nerd: "", simple: "·", color: colors.text },
  license: { nerd: "", simple: "©", color: colors.iconYellow },
  docker: { nerd: "", simple: "◆", color: colors.iconBlue },
  env: { nerd: "", simple: "·", color: colors.iconYellow },
  file: { nerd: "", simple: "·", color: colors.dim },
  folder: { nerd: "", simple: "", color: colors.iconFolder },
  folderOpen: { nerd: "", simple: "", color: colors.iconFolder },
  folderGit: { nerd: "", simple: "", color: colors.iconOrange },
  folderNpm: { nerd: "", simple: "", color: colors.iconRed },
  folderGithub: { nerd: "", simple: "", color: colors.text },
  folderConfig: { nerd: "", simple: "", color: colors.iconFolder },
} satisfies Record<string, Kind>

/** Every kind, exported so tests can check the glyphs exist in the bundled font. */
export const ICON_KINDS: Readonly<Record<string, Kind>> = K

const BY_NAME: Record<string, Kind> = {
  "package.json": K.npm,
  "package-lock.json": K.lock,
  "bun.lock": K.lock,
  "bun.lockb": K.lock,
  "yarn.lock": K.lock,
  "pnpm-lock.yaml": K.lock,
  ".gitignore": K.git,
  ".gitattributes": K.git,
  ".gitmodules": K.git,
  "tsconfig.json": K.config,
  "bunfig.toml": K.config,
  license: K.license,
  "license.md": K.license,
  "license.txt": K.license,
  dockerfile: K.docker,
}

const BY_EXT: Record<string, Kind> = {
  ts: K.ts,
  mts: K.ts,
  cts: K.ts,
  tsx: K.react,
  jsx: K.react,
  js: K.js,
  mjs: K.js,
  cjs: K.js,
  json: K.json,
  jsonc: K.json,
  md: K.md,
  mdx: K.md,
  css: K.css,
  scss: K.css,
  html: K.html,
  htm: K.html,
  py: K.python,
  rs: K.rust,
  go: K.go,
  zig: K.zig,
  sh: K.shell,
  bash: K.shell,
  zsh: K.shell,
  fish: K.shell,
  yml: K.config,
  yaml: K.config,
  toml: K.config,
  ini: K.config,
  txt: K.text,
  log: K.text,
  lock: K.lock,
  png: K.image,
  jpg: K.image,
  jpeg: K.image,
  gif: K.image,
  svg: K.image,
  webp: K.image,
  ico: K.image,
}

const FOLDERS: Record<string, Kind> = {
  ".git": K.folderGit,
  node_modules: K.folderNpm,
  ".github": K.folderGithub,
  ".vscode": K.folderConfig,
  ".claude": K.folderConfig,
  ".config": K.folderConfig,
}

function kindFor(name: string, isDir: boolean, expanded: boolean): Kind {
  const lower = name.toLowerCase()
  if (isDir) {
    const special = FOLDERS[lower]
    // Special folders keep their own icon while closed; open, they show an open folder in their colour.
    if (special) return expanded ? { ...K.folderOpen, color: special.color } : special
    return expanded ? K.folderOpen : K.folder
  }
  if (BY_NAME[lower]) return BY_NAME[lower]
  if (lower === ".env" || lower.startsWith(".env.")) return K.env
  return BY_EXT[extname(lower).slice(1)] ?? K.file
}

export function iconFor(name: string, isDir: boolean, expanded: boolean, style: IconStyle): Icon | null {
  if (style === "none") return null
  const kind = kindFor(name, isDir, expanded)
  const glyph = style === "nerd" ? kind.nerd : kind.simple
  return glyph ? { glyph, color: kind.color } : null
}
