; copane's own: OpenTUI picks the injected language by the captured node's type
; (see injectionMapping in src/editor/grammars.ts), so script and style must capture different types.

; <script> and {{ interpolations }}: TypeScript (which also reads plain JavaScript)
(script_element (raw_text) @injection.content)
(interpolation (raw_text) @injection.content)

; :prop="…", v-if="…", @click="…": TypeScript
(directive_attribute (quoted_attribute_value (attribute_value) @injection.content))

; <style>: CSS
(style_element) @injection.content
