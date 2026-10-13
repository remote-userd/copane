import { expect, test } from "bun:test"
import { computeHighlights } from "../../src/editor/highlighter"
import { filetypeOf } from "../../src/editor/grammars"

const SAMPLES: Record<string, string> = {
  python: 'def greet(name: str) -> str:\n    # say hi\n    return f"hi {name}"\n',
  yaml: "name: copane\nversion: 1 # comment\nlist:\n  - a\n",
  bash: 'for f in *.ts; do\n  echo "$f" # each\ndone\n',
  toml: '[package]\nname = "copane"\nversion = 1\n',
  rust: 'fn main() {\n    let x: u32 = 1; // one\n    println!("{}", x);\n}\n',
  go: 'package main\n\nfunc main() {\n\tx := "hi" // say\n\tprintln(x)\n}\n',
  c: '#include <stdio.h>\nint main(void) { /* c */ return printf("hi"); }\n',
  cpp: 'class A { public: int f() const { return 1; } };\nauto x = std::string("s");\n',
  html: '<!doctype html>\n<p class="x">Hi <!-- c --></p>\n',
  css: ".a > b { color: red; /* c */ }\n",
  json: '{ "a": [1, true, null], "b": "s" }\n',
  scss: '$c: red;\n@mixin m($x) { color: $x; }\n.a { &:hover { @include m($c); } } // c\n',
  vue: '<template><p :a="x" @click="go(1)">{{ msg }}</p></template>\n',
  svelte: '{#if n > 0}<p on:click={() => n++}>{n}</p>{/if}\n',
  astro: '---\nconst t = "hi"\n---\n<h1 class={t}>{t}</h1>\n',
  nginx: 'server {\n  listen 80; # web\n  location /api/ { proxy_pass http://127.0.0.1:3000; }\n}\n',
  dockerfile: 'FROM node:24-alpine AS build\n# deps\nRUN npm ci && npm run build\nCMD ["node", "dist/main.js"]\n',
  sql: "-- users\nSELECT id, name FROM users WHERE id = 1 AND name = 'x';\n",
}

test.each(Object.entries(SAMPLES))("%s gets syntax colours", async (filetype, text) => {
  const hl = await computeHighlights(text, filetype)
  expect(hl).not.toBeNull()
  const groups = new Set(hl!.map((h) => String(h[2]).split(".")[0]))
  // At least a few kinds of tokens (keywords, strings, comments, punctuation...), not one flat colour.
  expect(groups.size).toBeGreaterThanOrEqual(3)
})

test("file types for the new languages, and JSONC as JSON", () => {
  expect(["a.py", "a.yml", "a.sh", "a.toml", "a.rs", "a.go", "a.h", "a.hpp", "a.html", "a.css", "a.json", "a.jsonc"].map(filetypeOf)).toEqual([
    "python", "yaml", "bash", "toml", "rust", "go", "c", "cpp", "html", "css", "json", "json",
  ])
  expect(["a.scss", "a.vue", "a.svelte", "a.astro"].map(filetypeOf)).toEqual(["scss", "vue", "svelte", "astro"])
})

test("nginx config by name, extension or folder, but not every file in an nginx folder", () => {
  const nginx = ["nginx.conf", "/etc/nginx/nginx.conf", "site.nginx", "/etc/nginx/sites-available/default", "deploy/nginx/conf.d/app.conf"]
  expect(nginx.map(filetypeOf)).toEqual(nginx.map(() => "nginx"))
  expect(["deploy/nginx/Dockerfile", "deploy/nginx/README.md", "app.conf"].map(filetypeOf)).not.toContain("nginx")
})

// Code inside markup gets its own language's colours, through `#set! injection.language`
// (OpenTUI's worker learns it from our patch).
test.each([
  ["html", "<script>const a = 1</script>\n<style>p { color: red }</style>\n", ["javascript", "css"]],
  ["vue", '<p @click="go(1)">{{ msg }}</p>\n<script setup lang="ts">\nconst a: number = 1\n</script>\n<style>p { color: red }</style>\n', ["typescript", "scss"]],
  ["svelte", "<script>let n = 1</script>\n<p>{n + 1}</p>\n<style>p { color: red }</style>\n", ["typescript", "scss"]],
  ["astro", "---\nconst t = 1\n---\n<p>{t}</p>\n<style>p { color: red }</style>\n", ["typescript", "scss"]],
] as const)("%s highlights the code inside it", async (filetype, text, langs) => {
  const hl = await computeHighlights(text, filetype)
  const injected = new Set(hl!.map((h) => h[3]?.injectionLang).filter(Boolean))
  expect([...injected].sort()).toEqual([...langs].sort())
})

test("file types for full-stack files: .vue, Dockerfiles, SQL, and .env read as shell", () => {
  const paths = ["a.vue", "Dockerfile", "api/Dockerfile.dev", "web.dockerfile", "q.sql", ".env", "packages/api/.env.local", "prod.env", "envs.ts"]
  expect(paths.map(filetypeOf)).toEqual(["vue", "dockerfile", "dockerfile", "dockerfile", "sql", "bash", "bash", "bash", "typescript"])
})

test("Vue: TypeScript colours in <script>, {{ }} and directives; SCSS in <style>; tags as HTML", async () => {
  const text = [
    "<template>",
    '  <div :class="isOn ? 1 : 2" @click="toggle()">{{ count + 1 }}</div>',
    "</template>",
    '<script setup lang="ts">',
    "const count: number = 1",
    "</script>",
    "<style scoped>",
    ".a { color: red; }",
    "</style>",
    "",
  ].join("\n")
  const hl = (await computeHighlights(text, "vue"))!
  const at = (needle: string) => {
    const i = text.indexOf(needle)
    return hl.filter((h) => h[0] <= i && h[1] >= i + needle.length).map((h) => String(h[2]))
  }
  expect(at("const")).toContain("keyword")
  expect(at("number")).toContain("type.builtin")
  expect(at("div")).toContain("tag")
  expect(at("color")).toContain("property")
  // In the template's expressions too, not just plain text.
  expect(at("toggle").some((g) => g.startsWith("function"))).toBe(true)
})
