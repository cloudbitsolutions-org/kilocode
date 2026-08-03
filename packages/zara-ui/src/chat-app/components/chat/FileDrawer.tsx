/** @jsxImportSource solid-js */
import { type Component, Show, Switch, Match, createSignal, createMemo, createResource, onMount, onCleanup } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Button } from "@kilocode/kilo-ui/button"
import { Markdown } from "@kilocode/kilo-ui/markdown"

export interface FileDrawerData {
  filePath: string
  line?: number
  column?: number
}

interface FileResult {
  content: string
  type: string
  mimeType?: string
  encoding?: string
}

function getApiBase() {
  const params = new URLSearchParams(window.location.search)
  return params.get("url") || window.location.origin
}

async function fetchFile(path: string, directory: string): Promise<FileResult> {
  const base = getApiBase()
  const token = btoa("kilo:kilo")
  const params = new URLSearchParams({ path, directory })
  const res = await fetch(`${base}/file/content?${params}`, {
    headers: { Authorization: `Basic ${token}` },
  })
  if (!res.ok) throw new Error(`Failed to read file: ${res.status}`)
  const data = await res.json()
  return {
    content: data.content ?? "",
    type: data.type ?? "text",
    mimeType: data.mimeType,
    encoding: data.encoding,
  }
}

const IMG_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif"])
const VIDEO_EXT = new Set(["mp4", "webm", "ogg", "mov"])
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "flac", "aac", "m4a"])
const PDF_EXT = new Set(["pdf"])
const CSV_EXT = new Set(["csv", "tsv"])

function CsvTable(props: { content: string; separator?: string }) {
  const rows = createMemo(() => {
    const sep = props.separator ?? (props.content.includes("\t") ? "\t" : ",")
    return props.content.split("\n").filter(r => r.trim()).map(r => r.split(sep))
  })

  return (
    <div class="file-drawer-csv">
      <table>
        <Show when={rows().length > 0}>
          <thead>
            <tr>
              {rows()[0].map(cell => <th>{cell.trim()}</th>)}
            </tr>
          </thead>
        </Show>
        <tbody>
          {rows().slice(1).map(row => (
            <tr>
              {row.map(cell => <td>{cell.trim()}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
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
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
  }

  const kind = createMemo(() => {
    const e = ext()
    if (e === "md" || e === "mdx") return "markdown"
    if (IMG_EXT.has(e)) return "image"
    if (VIDEO_EXT.has(e)) return "video"
    if (AUDIO_EXT.has(e)) return "audio"
    if (PDF_EXT.has(e)) return "pdf"
    if (CSV_EXT.has(e)) return "csv"
    return "code"
  })

  const dataUrl = createMemo(() => {
    const f = file()
    if (!f || f.type !== "binary") return undefined
    const mime = f.mimeType || "application/octet-stream"
    return `data:${mime};base64,${f.content}`
  })

  const openInNewTab = () => {
    window.parent.postMessage({ type: "openFileInEditor", filePath: props.data.filePath, line: props.data.line }, "*")
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
                <Switch fallback={
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
                }>
                  <Match when={kind() === "markdown"}>
                    <div class="file-drawer-markdown">
                      <Markdown text={f().content} />
                    </div>
                  </Match>
                  <Match when={kind() === "image" && (dataUrl() || (f().type === "text" && ext() === "svg"))}>
                    <div class="file-drawer-media">
                      <Show when={ext() === "svg" && f().type === "text"} fallback={
                        <img src={dataUrl()} alt={filename()} />
                      }>
                        <div innerHTML={f().content} />
                      </Show>
                    </div>
                  </Match>
                  <Match when={kind() === "video" && dataUrl()}>
                    <div class="file-drawer-media">
                      <video controls src={dataUrl()} />
                    </div>
                  </Match>
                  <Match when={kind() === "audio" && dataUrl()}>
                    <div class="file-drawer-media">
                      <audio controls src={dataUrl()} />
                    </div>
                  </Match>
                  <Match when={kind() === "pdf" && dataUrl()}>
                    <div class="file-drawer-media file-drawer-pdf">
                      <iframe src={dataUrl()} title={filename()} />
                    </div>
                  </Match>
                  <Match when={kind() === "csv"}>
                    <CsvTable content={f().content} separator={ext() === "tsv" ? "\t" : ","} />
                  </Match>
                </Switch>
              )
            }}
          </Show>
        </div>
      </div>
    </>
  )
}
