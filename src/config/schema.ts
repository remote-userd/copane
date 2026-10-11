import { z } from "zod"

export const configSchema = z
  .object({
    ai: z
      .object({
        /** Program to run in the AI pane: "claude", "codex", "opencode", "gemini", "/bin/zsh", ... */
        command: z.string().min(1).default("claude"),
        args: z.array(z.string()).default([]),
        /** Start the AI pane hidden. */
        startHidden: z.boolean().default(false),
        maxScrollbackBytes: z.number().int().min(0).max(50_000_000).default(2_000_000),
      })
      .prefault({}),
    editor: z
      .object({
        highlightMaxBytes: z.number().int().positive().default(1_000_000),
        /** Show the function signature while typing call arguments. */
        parameterHints: z.boolean().default(true),
        /** Highlight the cursor's line, the matching bracket, and other uses of the word under the cursor. */
        highlightCursor: z.boolean().default(true),
        /** Faint marks at each indent level in leading whitespace. */
        indentGuides: z.boolean().default(true),
        /** Start with long lines wrapped (toggle with Alt+Z). */
        wordWrap: z.boolean().default(false),
        /** Suggest completions while typing (after "." or two letters) when a language server runs. */
        autocomplete: z.boolean().default(true),
        /** Save unsaved files when focus moves to the AI pane, so the AI reads what you see. */
        saveBeforeAi: z.boolean().default(true),
        /** Enter keeps the line's indent, one level more after an opening bracket. */
        autoIndent: z.boolean().default(true),
        /** Typing a bracket or quote adds its closer; over a selection it wraps the selection. */
        autoClosingBrackets: z.boolean().default(true),
        /**
         * Format document (Shift+Alt+F): "auto" uses the project's Prettier when it has one and
         * the language server otherwise; "prettier" or "lsp" force one.
         */
        formatter: z.enum(["auto", "prettier", "lsp"]).default("auto"),
        /** Format the file on Ctrl+S, like VS Code's editor.formatOnSave. */
        formatOnSave: z.boolean().default(false),
        /** Copy the editor selection to the clipboard when the mouse button is released. */
        copyOnSelect: z.boolean().default(false),
      })
      .prefault({}),
    /**
     * Language servers per filetype, e.g. { "python": { "command": ["pylsp"] } }, or false to
     * turn one off. TypeScript/JavaScript use the project's TypeScript 7 `tsc --lsp` when present.
     */
    lsp: z.record(z.string(), z.union([z.object({ command: z.array(z.string()).min(1) }), z.literal(false)])).default({}),
    git: z
      .object({
        /** Who last changed the cursor's line, in the status bar. */
        blame: z.boolean().default(true),
        /** The AI message button in Source Control (uses `claude -p`). */
        aiCommitMessage: z.boolean().default(true),
      })
      .prefault({}),
    tree: z
      .object({
        /** File-type icons: "nerd" needs a Nerd Font in the terminal (install:cli sets one up). */
        icons: z.enum(["nerd", "simple", "none"]).default("simple"),
      })
      .prefault({}),
    /** Extra key bindings per layer, e.g. { "global": { "ctrl+o": "file.picker" } }. null removes one. */
    keys: z
      .partialRecord(z.enum(["global", "editor", "tree", "ai"]), z.record(z.string(), z.string().nullable()))
      .default({}),
  })
  .prefault({})

export type Config = z.infer<typeof configSchema>
