/**
 * Syntax highlighting beyond what OpenTUI bundles (JavaScript, TypeScript, Markdown, Zig): the
 * official Tree-sitter grammars (all MIT; each folder in assets/grammars has its LICENSE), embedded in the binary.
 * C++'s queries build on C's, so it gets both. Vue, Dockerfile and SQL have no release builds:
 * built from their repositories with tree-sitter-cli 0.25.10 (OpenTUI's web-tree-sitter version).
 * Vue colours its script, {{ }} and directives as TypeScript and its style as CSS (injections).
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
import cssWasm from "../../assets/grammars/css/tree-sitter-css.wasm" with { type: "file" }
import cssHighlights from "../../assets/grammars/css/highlights.scm" with { type: "file" }
import jsonWasm from "../../assets/grammars/json/tree-sitter-json.wasm" with { type: "file" }
import jsonHighlights from "../../assets/grammars/json/highlights.scm" with { type: "file" }
import vueWasm from "../../assets/grammars/vue/tree-sitter-vue.wasm" with { type: "file" }
import vueHtmlHighlights from "../../assets/grammars/vue/html_tags.scm" with { type: "file" }
import vueHighlights from "../../assets/grammars/vue/highlights.scm" with { type: "file" }
import vueInjections from "../../assets/grammars/vue/injections.scm" with { type: "file" }
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
  { filetype: "html", wasm: htmlWasm, queries: { highlights: [htmlHighlights] } },
  { filetype: "css", wasm: cssWasm, queries: { highlights: [cssHighlights] } },
  { filetype: "json", aliases: ["jsonc"], wasm: jsonWasm, queries: { highlights: [jsonHighlights] } },
  {
    filetype: "vue",
    wasm: vueWasm,
    queries: { highlights: [vueHtmlHighlights, vueHighlights], injections: [vueInjections] },
    // By the captured node's type (assets/grammars/vue/injections.scm).
    injectionMapping: { nodeTypes: { raw_text: "typescript", attribute_value: "typescript", style_element: "css" } },
  },
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

/** A path's filetype, as OpenTUI names it, plus the few it doesn't know. */
export function filetypeOf(path: string): string | undefined {
  if (/\.jsonc$/i.test(path)) return "json"
  // .env, .env.local, prod.env: KEY=value lines and # comments read well as shell.
  if (/(^|\/)\.env(\.[\w.-]+)?$|\.env$/i.test(path)) return "bash"
  // Dockerfile.dev, api.Dockerfile
  if (/(^|\/)(dockerfile(\.[\w-]+)?|[\w.-]+\.dockerfile)$/i.test(path)) return "dockerfile"
  return pathToFiletype(path)
}
