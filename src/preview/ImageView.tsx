import { memo, useCallback, useState } from "react"
import { useKeyboard } from "@opentui/react"
import { AnimatedImage } from "./AnimatedImage"
import { imageCells } from "./images"
import { useWorkspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import type { Buffer, ImageMeta } from "../editor/BufferStore"

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** "PNG · 1200×800 · 245.3 KB", plus the frame count for an animated GIF. */
export function describeImage(meta: ImageMeta): string {
  const frames = meta.frames > 1 ? ` · ${meta.frames} frames` : ""
  return `${meta.format.toUpperCase()} · ${meta.width}×${meta.height} · ${formatBytes(meta.bytes)}${frames}`
}

/** Space pauses and resumes an animation (mounted only while the image tab has focus). */
function PlayKeys({ toggle }: { toggle: () => void }) {
  useKeyboard((key) => {
    if (key.name !== "space") return
    key.preventDefault()
    toggle()
  })
  return null
}

/** An image tab: the picture, fitted to the pane, under a line with its format and size. GIFs play. */
type ImageViewProps = { buf: Buffer; active: boolean; focused: boolean }

/** Re-rendered only when the tab's state or the image itself changes. */
export const ImageView = memo(
  (props: ImageViewProps) => <ImageViewInner {...props} />,
  (a, b) => a.active === b.active && a.focused === b.focused && a.buf.id === b.buf.id && a.buf.version === b.buf.version && a.buf.deleted === b.buf.deleted && a.buf.image === b.buf.image,
)

function ImageViewInner({ buf, active, focused }: ImageViewProps) {
  const ws = useWorkspace()
  const [error, setError] = useState<string | null>(null)
  const [space, setSpace] = useState({ width: 0, height: 0 })
  const [paused, setPaused] = useState(false)
  const onError = useCallback((message: string) => setError(message), [])
  const meta = buf.image
  const animated = (meta?.frames ?? 1) > 1
  const problem = buf.deleted ? "The file was deleted" : !meta ? "Can't read this image" : error ? `Can't display this image: ${error}` : null
  return (
    <box visible={active} flexGrow={1} flexDirection="column" backgroundColor={colors.bg}>
      {focused && animated ? <PlayKeys toggle={() => setPaused((p) => !p)} /> : null}
      <box height={1} paddingLeft={1} flexShrink={0} flexDirection="row" gap={2}>
        <text selectable={false} fg={colors.dim}>
          {meta ? describeImage(meta) : buf.relPath}
        </text>
        {animated ? (
          <text selectable={false} fg={colors.accent}>
            {paused ? "⏸ paused · Space plays" : "▶ playing · Space pauses"}
          </text>
        ) : null}
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
          <AnimatedImage
            // A new version (the file changed on disk) loads the picture again.
            key={buf.version}
            path={buf.path}
            protocol={ws.config.preview.imageProtocol}
            // Hidden tabs and paused animations stop drawing frames.
            playing={active && !paused}
            onError={onError}
            {...(space.width > 0 ? imageCells(meta!.width, meta!.height, space.width, space.height) : { width: 1, height: 1 })}
          />
        </box>
      )}
    </box>
  )
}
