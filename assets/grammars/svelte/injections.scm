; TypeScript in <script> and { } expressions (it covers plain JavaScript too).
; SCSS in <style> (it covers plain CSS too).
((script_element (raw_text) @injection.content)
  (#set! injection.language "typescript"))

((svelte_raw_text) @injection.content
  (#set! injection.language "typescript"))

((style_element (raw_text) @injection.content)
  (#set! injection.language "scss"))
