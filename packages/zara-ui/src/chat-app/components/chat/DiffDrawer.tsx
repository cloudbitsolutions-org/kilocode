/** @jsxImportSource solid-js */
import { type Component, Show, createSignal, onMount, onCleanup } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"

export interface DiffDrawerData {
  file: string
  patch?: string
  additions: number
  deletions: number
  style: "unified" | "split"
}

export const DiffDrawer: Component<{
  data: DiffDrawerData
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

  const lines = () => {
    if (!props.data.patch) return []
    return props.data.patch.split("\n")
  }

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
            <Icon name="file-diff" size="small" />
            <span class="diff-drawer-filename">{props.data.file}</span>
            <Show when={props.data.additions > 0}>
              <span class="diff-drawer-stat diff-drawer-stat--add">+{props.data.additions}</span>
            </Show>
            <Show when={props.data.deletions > 0}>
              <span class="diff-drawer-stat diff-drawer-stat--del">-{props.data.deletions}</span>
            </Show>
          </div>
          <IconButton
            icon="close"
            size="small"
            variant="ghost"
            onClick={props.onClose}
            aria-label="Close"
          />
        </div>
        <div class="diff-drawer-content">
          <Show when={props.data.patch} fallback={<div class="diff-drawer-empty">No diff content available</div>}>
            <pre class="diff-drawer-patch">
              {lines().map((line) => {
                const cls =
                  line.startsWith("+") && !line.startsWith("+++") ? "diff-line-add" :
                  line.startsWith("-") && !line.startsWith("---") ? "diff-line-del" :
                  line.startsWith("@@") ? "diff-line-hunk" :
                  "diff-line"
                return <div class={cls}>{line}</div>
              })}
            </pre>
          </Show>
        </div>
      </div>
    </>
  )
}
