import { createSignal } from "solid-js"
import { isDragLeavingComponent } from "./image-attachments-utils"
import { extractDropPaths, KILO_FILE_PATH_MIME } from "../utils/path-mentions"

export interface FileAttachment {
  id: string
  filename: string
  mime: string
  dataUrl: string
}

/** Callback for handling text/URI file path drops. */
export type FilePathDropHandler = (paths: string[]) => void

export function useFileAttachments() {
  const [images, setImages] = createSignal<FileAttachment[]>([])
  const [dragging, setDragging] = createSignal(false)
  let onFilePaths: FilePathDropHandler | undefined

  /** Register a handler for file path drops (text/URI-list). */
  const setFilePathDropHandler = (handler: FilePathDropHandler) => {
    onFilePaths = handler
  }

  const add = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const attachment: FileAttachment = {
        id: crypto.randomUUID(),
        filename: file.name || "file",
        mime: file.type || "application/octet-stream",
        dataUrl: reader.result as string,
      }
      setImages((prev) => [...prev, attachment])
    }
    reader.readAsDataURL(file)
  }

  const remove = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id))
  }

  const clear = () => setImages([])

  const replace = (next: FileAttachment[]) => setImages(next)

  const handlePaste = (event: ClipboardEvent) => {
    const cb = event.clipboardData
    if (!cb) return

    // Standard way to get pasted files in many browsers / Electron
    if (cb.files && cb.files.length > 0) {
      event.preventDefault()
      for (const file of Array.from(cb.files)) add(file)
      return
    }

    // Fallback: check items array
    const items = Array.from(cb.items ?? [])
    const fileItems = items.filter((item) => item.kind === "file")
    if (fileItems.length === 0) return
    event.preventDefault()
    for (const item of fileItems) {
      const file = item.getAsFile()
      if (file) add(file)
    }
  }

  const handleDragOver = (event: DragEvent) => {
    const types = event.dataTransfer?.types
    if (!types) return
    // Accept file drops, VS Code URI-list drops, and internal file-path drags.
    // Do NOT accept bare text/plain here — that would intercept normal text drags.
    const acceptable =
      types.includes("Files") || types.includes("application/vnd.code.uri-list") || types.includes(KILO_FILE_PATH_MIME)
    if (!acceptable) return
    event.preventDefault()
    setDragging(true)
  }

  const handleDragLeave = (event: DragEvent) => {
    if (isDragLeavingComponent(event.relatedTarget, event.currentTarget as HTMLElement)) {
      setDragging(false)
    }
  }

  const handleDrop = (event: DragEvent) => {
    setDragging(false)
    event.preventDefault()
    const dt = event.dataTransfer
    if (!dt) return

    // Prioritize actual file drops from the OS over text/URI mentions.
    // (VS Code explorer drags typically do not populate dt.files with File objects).
    if (dt.files && dt.files.length > 0) {
      for (const file of Array.from(dt.files)) {
        add(file)
      }
      return
    }

    // Fall back to text/URI file path drops (VS Code explorer, editor tabs)
    const paths = extractDropPaths(dt)
    if (paths && paths.length > 0 && onFilePaths) {
      onFilePaths(paths)
    }
  }

  return {
    files: images,
    dragging,
    add,
    remove,
    clear,
    replace,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    setFilePathDropHandler,
  }
}
