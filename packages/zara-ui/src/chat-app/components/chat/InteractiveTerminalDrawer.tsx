/** @jsxImportSource solid-js */
import { type Component, createSignal, createEffect, onMount, onCleanup, Show } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"

export interface InteractiveTerminalInfo {
  id: string
  sessionID: string
  command: string
  cwd: string
  description?: string
}

function getApiBase() {
  const params = new URLSearchParams(window.location.search)
  return params.get("url") || window.location.origin
}

function getWsBase() {
  const base = getApiBase()
  return base.replace(/^http/, "ws")
}

export const InteractiveTerminalDrawer: Component<{
  terminal: InteractiveTerminalInfo
  onClose: () => void
}> = (props) => {
  const [width, setWidth] = createSignal(Math.min(window.innerWidth * 0.55, 900))
  const [dragging, setDragging] = createSignal(false)
  const [connected, setConnected] = createSignal(false)
  const minWidth = 320
  const maxWidth = () => window.innerWidth * 0.85
  let containerRef: HTMLDivElement | undefined
  let ws: WebSocket | undefined
  let outputRef: HTMLPreElement | undefined

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

  const writeInput = async (data: string) => {
    const base = getApiBase()
    const token = btoa("kilo:kilo")
    await fetch(`${base}/interactive-terminal/${props.terminal.id}/input`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${token}`,
      },
      body: JSON.stringify({ data }),
    })
  }

  const closeTerminal = async () => {
    const base = getApiBase()
    const token = btoa("kilo:kilo")
    await fetch(`${base}/interactive-terminal/${props.terminal.id}/close`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${token}`,
      },
      body: JSON.stringify({}),
    }).catch(() => {})
    props.onClose()
  }

  const connectSSE = () => {
    const base = getApiBase()
    const token = btoa("kilo:kilo")
    const url = `${base}/event?token=${token}`
    const source = new EventSource(url)
    source.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data)
        if (event.type === "interactive_terminal.data" && event.properties?.terminalID === props.terminal.id) {
          if (outputRef) {
            outputRef.textContent = (outputRef.textContent || "") + event.properties.data
            outputRef.scrollTop = outputRef.scrollHeight
          }
          setConnected(true)
        }
        if (event.type === "interactive_terminal.deleted" && event.properties?.terminalID === props.terminal.id) {
          props.onClose()
        }
      } catch {}
    }
    return source
  }

  let source: EventSource | undefined

  onMount(() => {
    document.addEventListener("keydown", onKey)
    source = connectSSE()
    setConnected(true)
  })

  onCleanup(() => {
    document.removeEventListener("keydown", onKey)
    source?.close()
  })

  const handleKeyDown = (e: KeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()

    let data = ""
    if (e.key === "Enter") data = "\r"
    else if (e.key === "Backspace") data = "\x7f"
    else if (e.key === "Tab") data = "\t"
    else if (e.key === "Escape") data = "\x1b"
    else if (e.key === "ArrowUp") data = "\x1b[A"
    else if (e.key === "ArrowDown") data = "\x1b[B"
    else if (e.key === "ArrowRight") data = "\x1b[C"
    else if (e.key === "ArrowLeft") data = "\x1b[D"
    else if (e.ctrlKey && e.key === "c") data = "\x03"
    else if (e.ctrlKey && e.key === "d") data = "\x04"
    else if (e.ctrlKey && e.key === "z") data = "\x1a"
    else if (e.key.length === 1) data = e.key

    if (data) writeInput(data)
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
            <Icon name="terminal" size="small" />
            <span class="diff-drawer-filename">{props.terminal.description || "Interactive Terminal"}</span>
          </div>
          <div class="file-drawer-actions">
            <IconButton
              icon="close"
              size="small"
              variant="ghost"
              onClick={closeTerminal}
              aria-label="Close terminal"
            />
          </div>
        </div>
        <div class="iterm-drawer-info">
          <span class="iterm-drawer-cmd">{props.terminal.command}</span>
          <Show when={props.terminal.cwd}>
            <span class="iterm-drawer-cwd">{props.terminal.cwd}</span>
          </Show>
        </div>
        <div
          ref={containerRef}
          class="iterm-drawer-terminal"
          tabindex={0}
          onKeyDown={handleKeyDown}
        >
          <pre ref={outputRef} class="iterm-drawer-output" />
          <div class="iterm-drawer-input-hint">
            Click here and type to interact with the terminal
          </div>
        </div>
      </div>
    </>
  )
}
