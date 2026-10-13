; <script> and <style> contents, highlighted as JavaScript and CSS.
((script_element (raw_text) @injection.content)
  (#set! injection.language "javascript"))

((style_element (raw_text) @injection.content)
  (#set! injection.language "css"))
