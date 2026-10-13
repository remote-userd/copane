; TypeScript in <script>, {{ }} and directive values (it covers plain JavaScript too).
; SCSS in <style> (it covers plain CSS too).
((script_element (raw_text) @injection.content)
  (#set! injection.language "typescript"))

((interpolation (raw_text) @injection.content)
  (#set! injection.language "typescript"))

((directive_attribute
  (quoted_attribute_value (attribute_value) @injection.content))
  (#set! injection.language "typescript"))

((style_element (raw_text) @injection.content)
  (#set! injection.language "scss"))
