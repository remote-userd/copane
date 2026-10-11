import { basename, dirname, join, relative, sep } from "node:path"
import type { MenuItem } from "../app/state"
import type { Workspace } from "../app/workspace"
import { runCommand } from "../keymap/commands"
import { countEntries, createFile, createFolder, deletePath, renamePath } from "./fileOps"
import type { TreeModel, TreeRow } from "./TreeModel"

/** File-tree actions behind the tree keys and its right-click menu. */

const rel = (ws: Workspace, path: string) => relative(ws.root, path).split(sep).join("/") || "."

/** Folder new items go into: the row itself when it is a folder, else its parent. */
function targetDir(tree: TreeModel, row: TreeRow | null): string {
  if (!row) return tree.root
  return row.entry.isDir ? row.entry.path : dirname(row.entry.path)
}

export async function newItem(ws: Workspace, tree: TreeModel, row: TreeRow | null, kind: "file" | "folder"): Promise<void> {
  const dir = targetDir(tree, row)
  if (row?.entry.isDir) await tree.expand(dir)
  const where = dir === tree.root ? "the project root" : rel(ws, dir) + "/"
  ws.ui.set({
    modal: {
      kind: "prompt",
      title: kind === "file" ? "New file" : "New folder",
      label: `Name in ${where} (use / for subfolders)`,
      initial: "",
      submit: async (name) => {
        let path: string
        try {
          path = kind === "file" ? await createFile(dir, name) : await createFolder(dir, name)
        } catch (err) {
          return (err as Error).message
        }
        ws.ui.set({ modal: null })
        await tree.reveal(path)
        if (kind === "folder") await tree.expand(path)
        await tree.refresh(dirname(path))
        if (kind === "file") {
          await ws.buffers.open(path)
          ws.ui.set({ focus: "editor" })
        } else ws.ui.set({ focus: "tree" })
        return null
      },
    },
  })
}

export function renameItem(ws: Workspace, tree: TreeModel, row: TreeRow): void {
  const from = row.entry.path
  ws.ui.set({
    modal: {
      kind: "prompt",
      title: row.entry.isDir ? "Rename folder" : "Rename file",
      label: `New name for ${rel(ws, from)}`,
      initial: row.entry.name,
      cursorBeforeExt: !row.entry.isDir,
      submit: async (name) => {
        if (name.trim() === row.entry.name) return null
        let to: string
        try {
          // Move open tabs first so the watcher's echo does not report them as deleted.
          const planned = join(dirname(from), name.trim())
          ws.buffers.renamePath(from, planned)
          try {
            to = await renamePath(from, name)
          } catch (err) {
            ws.buffers.renamePath(planned, from)
            throw err
          }
        } catch (err) {
          return (err as Error).message
        }
        ws.ui.set({ modal: null, focus: "tree" })
        await tree.renamed(from, to)
        await tree.reveal(to)
        ws.notify(`Renamed to ${rel(ws, to)}`)
        return null
      },
    },
  })
}

export async function deleteItem(ws: Workspace, tree: TreeModel, row: TreeRow): Promise<void> {
  const path = row.entry.path
  let body = `Permanently delete ${rel(ws, path)}?`
  if (row.entry.isDir) {
    const n = await countEntries(path)
    body = `Permanently delete folder ${rel(ws, path)} and ${n === 0 ? "nothing inside (empty)" : `${n} item${n === 1 ? "" : "s"} inside`}?`
  }
  const unsaved = ws.buffers.list().filter((b) => b.dirty && (b.path === path || b.path.startsWith(path + sep)))
  if (unsaved.length) body += ` ${unsaved.length} open file${unsaved.length === 1 ? " has" : "s have"} unsaved changes.`
  ws.ui.set({
    modal: {
      kind: "confirm",
      title: "Delete",
      body,
      options: [
        {
          key: "d",
          label: "Delete",
          run: async () => {
            ws.ui.set({ modal: null, focus: "tree" })
            const rows = tree.rows()
            const i = rows.findIndex((r) => r.entry.path === path)
            try {
              await deletePath(path)
            } catch (err) {
              return ws.notify((err as Error).message, "error")
            }
            ws.buffers.pathDeleted(path)
            await tree.refresh(dirname(path))
            const after = tree.rows()
            tree.select(after[Math.min(i, after.length - 1)]?.entry.path ?? null)
            ws.notify(`Deleted ${rel(ws, path)}`)
          },
        },
        { key: "c", label: "Cancel", run: () => ws.ui.set({ modal: null }) },
      ],
    },
  })
}

async function copyPath(ws: Workspace, text: string): Promise<void> {
  const how = await ws.clipboard.copy(text)
  ws.notify(how === "internal" ? `Copied ${text} (editor only: no system clipboard found)` : `Copied ${text}`)
}

function sendToAi(ws: Workspace, row: TreeRow): void {
  if (!ws.ai) return ws.notify("AI terminal is not running", "warn")
  ws.ai.type(`@${rel(ws, row.entry.path)}${row.entry.isDir ? "/" : ""} `)
  void runCommand(ws, "focus.ai")
}

export function openTreeMenu(ws: Workspace, tree: TreeModel, row: TreeRow | null, x: number, y: number): void {
  const items: MenuItem[] = [
    { label: "New File…", hint: "a", run: () => newItem(ws, tree, row, "file") },
    { label: "New Folder…", hint: "A", run: () => newItem(ws, tree, row, "folder") },
  ]
  if (row) {
    items.push(
      { label: "Rename…", hint: "r", run: () => renameItem(ws, tree, row) },
      { label: "Delete…", hint: "Del", run: () => deleteItem(ws, tree, row) },
      { label: "Copy Path", run: () => copyPath(ws, row.entry.path) },
      { label: "Copy Relative Path", run: () => copyPath(ws, rel(ws, row.entry.path)) },
      { label: `Send to AI (@${basename(row.entry.path)})`, disabled: !ws.ai, run: () => sendToAi(ws, row) },
    )
  }
  ws.ui.set({ modal: { kind: "menu", x, y, items } })
}
