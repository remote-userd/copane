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
