/**
 * Syntax highlighting beyond what OpenTUI bundles (JavaScript, TypeScript, Markdown, Zig): the
 * official Tree-sitter grammars and, for SCSS, Vue, Svelte, Astro, nginx, Dockerfile and SQL, community ones
 * (all MIT; each folder in assets/grammars has its LICENSE), embedded in the binary. Those without release builds
 * were built from their repositories with tree-sitter-cli 0.25.10 (OpenTUI's web-tree-sitter version).
 * Queries build on each other: C++ on C, SCSS on CSS, Svelte/Astro on HTML.
 * Injections highlight the code inside (`<script>`, `<style>`, `{{ }}`...) with the language named by
 * `#set! injection.language`, which OpenTUI's parser worker learns from patches/@opentui%2Fcore@0.6.2.patch.
 */
import { addDefaultParsers, pathToFiletype } from "@opentui/core"
import pythonWasm from "../../assets/grammars/python/tree-sitter-python.wasm" with { type: "file" }
import pythonHighlights from "../../assets/grammars/python/highlights.scm" with { type: "file" }
import yamlWasm from "../../assets/grammars/yaml/tree-sitter-yaml.wasm" with { type: "file" }
import yamlHighlights from "../../assets/grammars/yaml/highlights.scm" with { type: "file" }
import bashWasm from "../../assets/grammars/bash/tree-sitter-bash.wasm" with { type: "file" }
import bashHighlights from "../../assets/grammars/bash/highlights.scm" with { type: "file" }
import tomlWasm from "../../assets/grammars/toml/tree-sitter-toml.wasm" with { type: "file" }
import tomlHighlights from "../../assets/grammars/toml/highlights.scm" with { type: "file" }
import rustWasm from "../../assets/grammars/rust/tree-sitter-rust.wasm" with { type: "file" }
import rustHighlights from "../../assets/grammars/rust/highlights.scm" with { type: "file" }
import goWasm from "../../assets/grammars/go/tree-sitter-go.wasm" with { type: "file" }
import goHighlights from "../../assets/grammars/go/highlights.scm" with { type: "file" }
import cWasm from "../../assets/grammars/c/tree-sitter-c.wasm" with { type: "file" }
import cHighlights from "../../assets/grammars/c/highlights.scm" with { type: "file" }
import cppWasm from "../../assets/grammars/cpp/tree-sitter-cpp.wasm" with { type: "file" }
import cppHighlights from "../../assets/grammars/cpp/highlights.scm" with { type: "file" }
import htmlWasm from "../../assets/grammars/html/tree-sitter-html.wasm" with { type: "file" }
import htmlHighlights from "../../assets/grammars/html/highlights.scm" with { type: "file" }
import htmlInjections from "../../assets/grammars/html/injections.scm" with { type: "file" }
import cssWasm from "../../assets/grammars/css/tree-sitter-css.wasm" with { type: "file" }
import cssHighlights from "../../assets/grammars/css/highlights.scm" with { type: "file" }
import jsonWasm from "../../assets/grammars/json/tree-sitter-json.wasm" with { type: "file" }
import jsonHighlights from "../../assets/grammars/json/highlights.scm" with { type: "file" }
import scssWasm from "../../assets/grammars/scss/tree-sitter-scss.wasm" with { type: "file" }
import scssHighlights from "../../assets/grammars/scss/highlights.scm" with { type: "file" }
import vueWasm from "../../assets/grammars/vue/tree-sitter-vue.wasm" with { type: "file" }
import vueHtmlHighlights from "../../assets/grammars/vue/html_tags.scm" with { type: "file" }
import vueHighlights from "../../assets/grammars/vue/highlights.scm" with { type: "file" }
import vueInjections from "../../assets/grammars/vue/injections.scm" with { type: "file" }
import svelteWasm from "../../assets/grammars/svelte/tree-sitter-svelte.wasm" with { type: "file" }
import svelteHighlights from "../../assets/grammars/svelte/highlights.scm" with { type: "file" }
import svelteInjections from "../../assets/grammars/svelte/injections.scm" with { type: "file" }
import astroWasm from "../../assets/grammars/astro/tree-sitter-astro.wasm" with { type: "file" }
import astroHighlights from "../../assets/grammars/astro/highlights.scm" with { type: "file" }
import astroInjections from "../../assets/grammars/astro/injections.scm" with { type: "file" }
import nginxWasm from "../../assets/grammars/nginx/tree-sitter-nginx.wasm" with { type: "file" }
import nginxHighlights from "../../assets/grammars/nginx/highlights.scm" with { type: "file" }
import dockerfileWasm from "../../assets/grammars/dockerfile/tree-sitter-dockerfile.wasm" with { type: "file" }
import dockerfileHighlights from "../../assets/grammars/dockerfile/highlights.scm" with { type: "file" }
import sqlWasm from "../../assets/grammars/sql/tree-sitter-sql.wasm" with { type: "file" }
import sqlHighlights from "../../assets/grammars/sql/highlights.scm" with { type: "file" }

export const EXTRA_GRAMMARS = [
  { filetype: "python", wasm: pythonWasm, queries: { highlights: [pythonHighlights] } },
  { filetype: "yaml", wasm: yamlWasm, queries: { highlights: [yamlHighlights] } },
  { filetype: "bash", aliases: ["sh", "zsh", "shell"], wasm: bashWasm, queries: { highlights: [bashHighlights] } },
  { filetype: "toml", wasm: tomlWasm, queries: { highlights: [tomlHighlights] } },
  { filetype: "rust", wasm: rustWasm, queries: { highlights: [rustHighlights] } },
  { filetype: "go", wasm: goWasm, queries: { highlights: [goHighlights] } },
  { filetype: "c", wasm: cWasm, queries: { highlights: [cHighlights] } },
  { filetype: "cpp", wasm: cppWasm, queries: { highlights: [cHighlights, cppHighlights] } },
  { filetype: "html", wasm: htmlWasm, queries: { highlights: [htmlHighlights], injections: [htmlInjections] } },
  { filetype: "css", wasm: cssWasm, queries: { highlights: [cssHighlights] } },
  { filetype: "json", aliases: ["jsonc"], wasm: jsonWasm, queries: { highlights: [jsonHighlights] } },
  { filetype: "scss", wasm: scssWasm, queries: { highlights: [cssHighlights, scssHighlights] } },
  { filetype: "vue", wasm: vueWasm, queries: { highlights: [vueHtmlHighlights, vueHighlights], injections: [vueInjections] } },
  {
    filetype: "svelte",
    wasm: svelteWasm,
    queries: { highlights: [htmlHighlights, svelteHighlights], injections: [svelteInjections] },
  },
  {
    filetype: "astro",
    wasm: astroWasm,
    queries: { highlights: [htmlHighlights, astroHighlights], injections: [astroInjections] },
  },
  { filetype: "nginx", wasm: nginxWasm, queries: { highlights: [nginxHighlights] } },
  { filetype: "dockerfile", wasm: dockerfileWasm, queries: { highlights: [dockerfileHighlights] } },
  { filetype: "sql", wasm: sqlWasm, queries: { highlights: [sqlHighlights] } },
]

let registered = false

/** Make the extra grammars available. Call before the first highlight (the parser worker reads them when it starts). */
export function registerGrammars(): void {
  if (registered) return
  registered = true
  addDefaultParsers(EXTRA_GRAMMARS)
}

/**
 * A path's filetype, as OpenTUI names it, plus the few it doesn't know. `text` (the file's
 * content, when known) recognises nginx config in a `.conf` file anywhere (deploy/conf.d/app.conf).
 */
export function filetypeOf(path: string, text?: string): string | undefined {
  if (/\.jsonc$/i.test(path)) return "json"
  // .env, .env.local, prod.env: KEY=value lines and # comments read well as shell.
  if (/(^|\/)\.env(\.[\w.-]+)?$|\.env$/i.test(path)) return "bash"
  // Dockerfile.dev, api.Dockerfile
  if (/(^|\/)(dockerfile(\.[\w-]+)?|[\w.-]+\.dockerfile)$/i.test(path)) return "dockerfile"
  if (isNginx(path) || (text !== undefined && /\.conf$/i.test(path) && looksLikeNginx(text))) return "nginx"
  return pathToFiletype(path)
}

/** A top-level nginx block (`server {`, `upstream app {`, `http {`, `events {`, `location / {`) near the start. */
function looksLikeNginx(text: string): boolean {
  return /^[ \t]*(server|http|events|stream|upstream[ \t]+[\w.-]+|location[ \t][^{\n]*)[ \t]*\{/m.test(text.slice(0, 64_000))
}

/** nginx.conf, *.nginx, and .conf or extensionless files in an nginx or sites-* folder (nginx/conf.d/site.conf, sites-available/default). */
function isNginx(path: string): boolean {
  if (/(^|[\\/])nginx\.conf$|\.nginx$/i.test(path)) return true
  if (!/(^|[\\/])(nginx|sites-available|sites-enabled)[\\/]/i.test(path)) return false
  const base = path.split(/[\\/]/).pop()!
  return /\.conf$/i.test(base) || (!base.includes(".") && !/^(dockerfile|makefile|license|readme)$/i.test(base))
}
