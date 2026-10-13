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
})

test("file types for full-stack files: .vue, Dockerfiles, SQL, and .env read as shell", () => {
  const paths = ["a.vue", "Dockerfile", "api/Dockerfile.dev", "web.dockerfile", "q.sql", ".env", "packages/api/.env.local", "prod.env", "envs.ts"]
  expect(paths.map(filetypeOf)).toEqual(["vue", "dockerfile", "dockerfile", "dockerfile", "sql", "bash", "bash", "bash", "typescript"])
})

test("Vue: TypeScript colours in <script>, {{ }} and directives; CSS in <style>; tags as HTML", async () => {
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
