/** @jsxImportSource solid-js */
import { type Component, createSignal, onMount, onCleanup } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Button } from "@kilocode/kilo-ui/button"
import { showToast } from "@kilocode/kilo-ui/toast"

export const ContentDrawer: Component<{
  content: string
  language?: string
  onClose: () => void
}> = (props) => {
  const [width, setWidth] = createSignal(Math.min(window.innerWidth * 0.55, 900))
  const [dragging, setDragging] = createSignal(false)
  const minWidth = 320
  const maxWidth = () => window.innerWidth * 0.85

  const startDrag = (e: MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    const onMove = (ev: MouseEvent) => {
      const next = window.innerWidth - ev.clientX
      setWidth(Math.max(minWidth, Math.min(next, maxWidth())))
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") props.onClose()
  }

  onMount(() => document.addEventListener("keydown", onKey))
  onCleanup(() => document.removeEventListener("keydown", onKey))

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.content)
      showToast({ title: "Copied to clipboard", variant: "success" })
    } catch {
      showToast({ title: "Failed to copy", variant: "error" })
    }
  }

  const lines = () => props.content.split("\n")

  return (
    <>
      <div class="diff-drawer-backdrop" onClick={props.onClose} />
      <div
        class="diff-drawer"
        classList={{ "diff-drawer--dragging": dragging() }}
        style={{ width: `${width()}px` }}
      >
        <div class="diff-drawer-handle" onMouseDown={startDrag}>
          <div class="diff-drawer-handle-bar" />
        </div>
        <div class="diff-drawer-header">
          <div class="diff-drawer-title">
            <Icon name="file-code" size="small" />
            <span class="diff-drawer-filename">{props.language || "Output"}</span>
          </div>
          <div class="file-drawer-actions">
            <Button size="small" variant="ghost" onClick={copy}>
              <Icon name="clipboard" size="small" />
              Copy
            </Button>
            <IconButton
              icon="close"
              size="small"
              variant="ghost"
              onClick={props.onClose}
              aria-label="Close"
            />
          </div>
        </div>
        <div class="diff-drawer-content">
          <pre class="file-drawer-code" data-ext={props.language}>
            {lines().map((line, i) => (
              <div class="file-line">
                <span class="file-line-num">{i + 1}</span>
                <span class="file-line-text">{line}</span>
              </div>
            ))}
          </pre>
        </div>
      </div>
    </>
  )
}
