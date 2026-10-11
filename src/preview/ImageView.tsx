import { useState } from "react"
import { imageCells } from "./images"
import { useWorkspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import type { Buffer, ImageMeta } from "../editor/BufferStore"

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** "PNG · 1200×800 · 245.3 KB" */
export function describeImage(meta: ImageMeta): string {
  return `${meta.format.toUpperCase()} · ${meta.width}×${meta.height} · ${formatBytes(meta.bytes)}`
}

/** An image tab: the picture, fitted to the pane, under a line with its format and size. */
export function ImageView({ buf, active }: { buf: Buffer; active: boolean }) {
  const ws = useWorkspace()
  const [error, setError] = useState<string | null>(null)
  const [space, setSpace] = useState({ width: 0, height: 0 })
  const meta = buf.image
  const problem = buf.deleted ? "The file was deleted" : !meta ? "Can't read this image" : error ? `Can't display this image: ${error}` : null
  return (
    <box visible={active} flexGrow={1} flexDirection="column" backgroundColor={colors.bg}>
      <box height={1} paddingLeft={1} flexShrink={0}>
        <text selectable={false} fg={colors.dim}>
          {meta ? describeImage(meta) : buf.relPath}
        </text>
      </box>
      {problem ? (
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <text selectable={false} fg={colors.warn}>
            {problem}
          </text>
        </box>
      ) : (
        <box
          flexGrow={1}
          padding={1}
          justifyContent="center"
          alignItems="center"
          onSizeChange={function (this: { width: number; height: number }) {
            setSpace({ width: this.width - 2, height: this.height - 2 })
          }}
        >
          <image
            // A new version (the file changed on disk) loads the picture again.
            key={buf.version}
            source={buf.path}
            fit="fit"
            protocol={ws.config.preview.imageProtocol}
            {...(space.width > 0 ? imageCells(meta!.width, meta!.height, space.width, space.height) : { width: 1, height: 1 })}
            onLoad={() => setError(null)}
            onError={(e) => setError(e instanceof Error ? e.message : String(e))}
          />
        </box>
      )}
    </box>
  )
}
