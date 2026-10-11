import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { NativeImagePool, type ImageRenderable, type ImageRenderProtocol } from "@opentui/core"
import { GifPlayer, parseGif } from "./gif"
import { windowFocus, windowFocused } from "../app/windowFocus"

/**
 * An image that plays when it is an animated GIF (OpenTUI alone shows a GIF's first frame).
 * Frames go through a small pool of native images that are reused, at the GIF's own timing,
 * only while `playing`; paused, it keeps the frame it is on.
 */
export function AnimatedImage({
  path,
  width,
  height,
  protocol,
  playing,
  onError,
}: {
  path: string
  width: number
  height: number
  protocol: ImageRenderProtocol
  playing: boolean
  onError?: (message: string) => void
}) {
  const ref = useRef<ImageRenderable | null>(null)
  // Paused while the terminal window is in the background: nobody is watching.
  const focused = useSyncExternalStore(windowFocus.subscribe, windowFocused)
  playing &&= focused
  const [player, setPlayer] = useState<GifPlayer | null>(null)

  useEffect(() => {
    setPlayer(null)
    if (!path.toLowerCase().endsWith(".gif")) return
    let stale = false
    void Bun.file(path)
      .bytes()
      .then((bytes) => {
        const gif = parseGif(bytes)
        if (!stale && gif.frames.length > 1) setPlayer(new GifPlayer(gif))
      })
      .catch(() => {}) // not animated, or unreadable: the still image (or its error) shows
    return () => {
      stale = true
    }
  }, [path])

  // One pool per GIF: frames reuse a few native images instead of allocating one each.
  const pool = useRef<NativeImagePool | null>(null)
  useEffect(() => {
    if (!player) return
    pool.current = new NativeImagePool({ width: player.gif.width, height: player.gif.height, capacity: 3 })
    return () => {
      pool.current?.dispose()
      pool.current = null
    }
  }, [player])

  useEffect(() => {
    if (!player || !playing) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const show = () => {
      let delay = 100
      try {
        delay = player.next()
        const image = pool.current?.publishRgba(player.canvas)
        // null: every pooled image is still being drawn; skip this frame.
        if (image && ref.current) {
          ref.current.source = image
          image.dispose() // the renderable holds its own reference
        } else image?.dispose()
      } catch (err) {
        onError?.(err instanceof Error ? err.message : String(err))
        return
      }
      timer = setTimeout(show, delay)
    }
    show()
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [player, playing, onError])

  return (
    <image
      ref={ref}
      source={path}
      fit="fit"
      protocol={protocol}
      width={width}
      height={height}
      onError={(e) => onError?.(e instanceof Error ? e.message : String(e))}
    />
  )
}
