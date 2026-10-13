; TypeScript in the --- frontmatter, { } expressions and <script>; SCSS in <style> (it covers plain CSS too).
((frontmatter (frontmatter_js_block) @injection.content)
  (#set! injection.language "typescript"))

((attribute_interpolation (attribute_js_expr) @injection.content)
  (#set! injection.language "typescript"))

((html_interpolation (permissible_text) @injection.content)
  (#set! injection.language "typescript"))

((script_element (raw_text) @injection.content)
  (#set! injection.language "typescript"))

((style_element (raw_text) @injection.content)
  (#set! injection.language "scss"))
