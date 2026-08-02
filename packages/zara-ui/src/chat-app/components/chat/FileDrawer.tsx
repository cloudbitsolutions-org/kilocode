/** @jsxImportSource solid-js */
import { type Component, Show, createSignal, createResource, onMount, onCleanup } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Button } from "@kilocode/kilo-ui/button"

export interface FileDrawerData {
  filePath: string
  line?: number
  column?: number
}

function getApiBase() {
  const params = new URLSearchParams(window.location.search)
  return params.get("url") || window.location.origin
}

async function fetchFile(path: string, directory: string): Promise<{ content: string; type: string }> {
  const base = getApiBase()
  const token = btoa("kilo:kilo")
  const params = new URLSearchParams({ path, directory })
  const res = await fetch(`${base}/v1/file?${params}`, {
    headers: { Authorization: `Basic ${token}` },
  })
  if (!res.ok) throw new Error(`Failed to read file: ${res.status}`)
  const data = await res.json()
  return { content: data.content ?? "", type: data.type ?? "text" }
}

export const FileDrawer: Component<{
  data: FileDrawerData
  directory: string
  onClose: () => void
}> = (props) => {
  const [width, setWidth] = createSignal(Math.min(window.innerWidth * 0.55, 900))
  const [dragging, setDragging] = createSignal(false)
  const minWidth = 320
  const maxWidth = () => window.innerWidth * 0.85
  let contentRef: HTMLPreElement | undefined

  const [file] = createResource(
    () => props.data.filePath,
    (path) => fetchFile(path, props.directory),
  )

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

  const scrollToLine = () => {
    const line = props.data.line
    if (!line || !contentRef) return
    const el = contentRef.querySelector(`[data-line="${line}"]`) as HTMLElement | null
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  const filename = () => {
    const parts = props.data.filePath.split("/")
    return parts[parts.length - 1]
  }

  const dir = () => {
    const parts = props.data.filePath.split("/")
    if (parts.length <= 1) return ""
    return parts.slice(0, -1).join("/")
  }

  const ext = () => {
    const name = filename()
    const dot = name.lastIndexOf(".")
    return dot > 0 ? name.slice(dot + 1) : ""
  }

  const openInNewTab = () => {
    const base = window.location.origin
    const path = encodeURIComponent(props.data.filePath)
    window.open(`${base}/editor?file=${path}`, "_blank")
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
            <Icon name="file" size="small" />
            <span class="diff-drawer-filename" title={props.data.filePath}>{filename()}</span>
            <Show when={props.data.line}>
              <span class="file-drawer-line">:{props.data.line}</span>
            </Show>
          </div>
          <div class="file-drawer-actions">
            <Button size="small" variant="ghost" onClick={openInNewTab}>
              <Icon name="square-arrow-top-right" size="small" />
              Open in Editor
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
        <Show when={dir()}>
          <div class="file-drawer-path">{dir()}</div>
        </Show>
        <div class="diff-drawer-content">
          <Show when={file.loading}>
            <div class="diff-drawer-empty">Loading...</div>
          </Show>
          <Show when={file.error}>
            <div class="diff-drawer-empty">Failed to load file</div>
          </Show>
          <Show when={file()}>
            {(f) => {
              setTimeout(scrollToLine, 50)
              return (
                <pre ref={contentRef} class="file-drawer-code" data-ext={ext()}>
                  {f().content.split("\n").map((line, i) => {
                    const num = i + 1
                    const active = num === props.data.line
                    return (
                      <div
                        class="file-line"
                        classList={{ "file-line--active": active }}
                        data-line={num}
                      >
                        <span class="file-line-num">{num}</span>
                        <span class="file-line-text">{line}</span>
                      </div>
                    )
                  })}
                </pre>
              )
            }}
          </Show>
        </div>
      </div>
    </>
  )
}
