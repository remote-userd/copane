import { afterEach, expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { decodeEntities, extractFootnotes, MarkdownView } from "../../src/preview/MarkdownView"

let destroy: (() => void) | null = null
afterEach(() => destroy?.())

async function render(md: string, width = 80): Promise<string> {
  const setup = await testRender(<MarkdownView text={md} ctx={{ path: "/tmp/x.md", width, protocol: "blocks", animate: false }} />, { width, height: 60 })
  destroy = () => setup.renderer.destroy()
  for (let i = 0; i < 5; i++) await setup.renderOnce()
  return setup.captureCharFrame()
}

test("headings, emphasis and code lose their markers", async () => {
  const f = await render("# Title\n\n## Sub\n\nSome *it* **bold** ~~gone~~ `code` [link](https://x.y).\nNext line.")
  expect(f).toContain("Title")
  expect(f).not.toMatch(/[#*~`]/)
  // A line break inside a paragraph is a space.
  expect(f).toContain("link. Next line.")
})

test("lists: bullets per depth, numbers, and task checkboxes", async () => {
  const f = await render("- a\n  - b\n    - c\n- [ ] open\n- [x] done\n\n3. three\n4. four\n")
  expect(f).toContain("• a")
  expect(f).toContain("◦ b")
  expect(f).toContain("▪ c")
  expect(f).toContain("☐ open")
  expect(f).toContain("☑ done")
  expect(f).toContain("3. three")
  expect(f).not.toContain("[x]")
})

test("tables align columns as the separator row says", async () => {
  const f = await render("| L | C | R |\n| :-- | :-: | --: |\n| a | b | c |\n| long text | mid | 1 |\n")
  expect(f).toContain("┌")
  expect(f).toMatch(/│ a\s+│\s+b\s+│\s+c │/)
  expect(f).toMatch(/│ long text │ mid │\s+1 │/)
})

test("GitHub alerts, quotes and footnotes", async () => {
  const f = await render("> [!WARNING]\n> Careful.\n\n> plain quote\n\nSee[^n].\n\n[^n]: The note.\n")
  expect(f).toContain("⚠ Warning")
  expect(f).not.toContain("[!WARNING]")
  expect(f).toContain("│ plain quote")
  expect(f).toContain("See[1].")
  expect(f).toContain("[1] The note.")
})

test("README-style HTML: centred blocks, inline tags, <br>, <details>, comments", async () => {
  const f = await render('<div align="center">\n\n# Name\n\n</div>\n\nA <b>bold</b> word<br>next <!-- hidden -->\n\n<details><summary>More</summary>Inside</details>\n', 60)
  expect(f).not.toMatch(/<\/?(div|b|br|details|summary)/)
  expect(f).not.toContain("hidden")
  const name = f.split("\n").find((l) => l.includes("Name"))!
  expect(name.indexOf("Name")).toBeGreaterThan(20) // centred
  expect(f).toContain("A bold word")
  expect(f).toContain("▸ More")
  expect(f).toContain("Inside")
})

test("code blocks show their language", async () => {
  const f = await render("```ts\nconst a = 1\n```\n")
  expect(f).toContain("ts")
  expect(f).toContain("const a = 1")
  expect(f).not.toContain("```")
})

test("extractFootnotes numbers references in order of use and drops unknown ones", () => {
  const r = extractFootnotes("b[^b] a[^a] b[^b] x[^none]\n\n[^a]: A\n[^b]: B\n")
  expect(r.notes).toEqual([
    { n: 1, text: "B" },
    { n: 2, text: "A" },
  ])
  expect(r.src).toContain("b<sup>[1]</sup> a<sup>[2]</sup> b<sup>[1]</sup> x[^none]")
})

test("decodeEntities", () => {
  expect(decodeEntities("&copy; &amp; &lt;b&gt; &#65; &#x42; &unknown;")).toBe("© & <b> A B &unknown;")
})

test("emoji shortcodes become emoji, except in code", async () => {
  const f = await render(":rocket: Ship it :white_check_mark: :not_a_real_code: `:rocket:`\n\n```\n:tada:\n```\n")
  expect(f).toContain("🚀 Ship it ✅ :not_a_real_code:")
  expect(f).toContain(":rocket:") // the code span
  expect(f).toContain(":tada:") // the code block
})

test("HTML tables render like Markdown tables, with alignment", async () => {
  const f = await render('<table>\n<tr><th>Name</th><th align="right">Price</th></tr>\n<tr><td><b>Cable</b></td><td style="text-align: right">9</td></tr>\n<tr><td>Keyboard</td><td>49</td></tr>\n</table>\n')
  expect(f).toContain("┌")
  expect(f).toMatch(/│ Name\s+│\s+Price │/)
  expect(f).toMatch(/│ Cable\s+│\s+9 │/)
  expect(f).toMatch(/│ Keyboard │\s+49 │/)
  expect(f).not.toMatch(/<\/?(table|tr|td|th|b)\b/)
})
