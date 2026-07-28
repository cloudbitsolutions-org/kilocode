import { createKiloClient } from "@kilocode/sdk/v2/client"
import type { ExtensionMessage } from "./chat-app/types/messages"

// ─── SDK Client ─────────────────────────────────────────────────────────────

function getClient() {
  const urlParams = new URLSearchParams(window.location.search)
  const baseUrl = urlParams.get("url") || window.location.origin
  let directory = urlParams.get("dir") || urlParams.get("project") || "/"

  if (directory === "/workspace" && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    directory = ""
  }

  // Create a base64 basic auth token "kilo:kilo"
  const token = btoa("kilo:kilo")

  return {
    client: createKiloClient({
      baseUrl,
      directory,
      headers: {
        Authorization: `Basic ${token}`,
      },
      fetch: window.fetch.bind(window),
    }),
    directory,
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function emitVsCodeMessage(message: ExtensionMessage) {
  window.postMessage(message, "*")
}

/**
 * Convert a raw SDK session object to the shape the webview expects.
 * Mirrors kilo-provider-utils.ts sessionToWebview()
 */
function sessionToWebview(session: any) {
  return {
    id: session.id,
    parentID: session.parentID ?? null,
    title: session.title ?? null,
    createdAt: session.time
      ? new Date(session.time.created).toISOString()
      : new Date().toISOString(),
    updatedAt: session.time
      ? new Date(session.time.updated).toISOString()
      : new Date().toISOString(),
    revert: session.revert ?? null,
    summary: session.summary ?? null,
  }
}

/**
 * Convert raw SDK provider list to the Record<id, provider> shape.
 * Mirrors kilo-provider-utils.ts indexProvidersById()
 */
function indexProvidersById(all: any[]): Record<string, any> {
  const normalized: Record<string, any> = {}
  for (const provider of all) {
    if (provider.id) {
      // Strip secret keys before sending to webview
      const { key, ...safe } = provider
      normalized[provider.id] = safe
    }
  }
  return normalized
}

// ─── Global State ───────────────────────────────────────────────────────────

const { client, directory } = getClient()
let currentSessionID: string | null = null
let selectedAgent: string | undefined = undefined
let autoApproveEnabled = false
const settingKey = "kilo-webview-settings"

function loadSettings(): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(settingKey)
    return raw ? JSON.parse(raw) as Record<string, unknown> : {}
  } catch (e) {
    console.warn("[Emulator] Failed to load settings cache:", e)
    return {}
  }
}

function saveSettings(next: Record<string, unknown>) {
  try {
    window.localStorage.setItem(settingKey, JSON.stringify(next))
  } catch (e) {
    console.warn("[Emulator] Failed to persist settings cache:", e)
  }
}

const settings = loadSettings()

// ─── SSE Event Stream ───────────────────────────────────────────────────────

/**
 * Map a kilo-serve SSE event to the webview message format.
 * This mirrors kilo-provider-utils.ts mapSSEEventToWebviewMessage()
 * but runs in the browser without Node.js dependencies.
 */
function mapSSEEvent(event: any): ExtensionMessage | null {
  if (!event || !event.type) return null

  // ── Sync events (message/session CRUD) ──
  if (event.type === "sync") {
    const syncName = event.syncEvent?.type || event.syncEvent?.name || event.name
    const syncData = event.syncEvent?.data || event.data
    switch (syncName) {
      case "message.updated.1": {
        const info = syncData.info
        return {
          type: "messageCreated",
          message: {
            ...info,
            createdAt: info.time
              ? new Date(info.time.created).toISOString()
              : new Date().toISOString(),
          },
        } as any
      }
      case "message.removed.1":
        return {
          type: "messageRemoved",
          sessionID: syncData.sessionID,
          messageID: syncData.messageID,
        } as any
      case "message.part.updated.1": {
        const part = syncData.part
        return {
          type: "partUpdated",
          sessionID: syncData.sessionID,
          messageID: part.messageID,
          part,
        } as any
      }
      case "message.part.removed.1":
        return {
          type: "partRemoved",
          sessionID: syncData.sessionID,
          messageID: syncData.messageID,
          partID: syncData.partID,
        } as any
      case "session.created.1":
        return {
          type: "sessionCreated",
          session: sessionToWebview(syncData.info),
        } as any
      case "session.updated.1":
        return null // handled separately
      case "session.deleted.1":
        return {
          type: "sessionDeleted",
          sessionID: syncData.sessionID,
        } as any
    }
    return null
  }

  // ── Standard SSE events ──
  switch (event.type) {
    case "message.part.delta": {
      const props = event.properties
      if (!props) return null
      return {
        type: "partUpdated",
        sessionID: props.sessionID,
        messageID: props.messageID,
        part: {
          id: props.partID,
          type: props.partType || "text",
          messageID: props.messageID,
          text: props.delta,
        },
        delta: { type: "text-delta", textDelta: props.delta },
      } as any
    }

    case "message.updated": {
      const info = event.properties?.info
      if (!info) return null
      return {
        type: "messageCreated",
        message: {
          ...info,
          createdAt: info.time
            ? new Date(info.time.created).toISOString()
            : new Date().toISOString(),
        },
      } as any
    }

    case "message.part.updated": {
      const props = event.properties
      if (!props) return null
      return {
        type: "partUpdated",
        sessionID: props.sessionID,
        messageID: props.part?.messageID,
        part: props.part,
      } as any
    }

    case "message.part.removed": {
      const props = event.properties
      if (!props) return null
      return {
        type: "partRemoved",
        sessionID: props.sessionID,
        messageID: props.messageID,
        partID: props.partID,
      } as any
    }

    case "message.removed": {
      const props = event.properties
      if (!props) return null
      return {
        type: "messageRemoved",
        sessionID: props.sessionID,
        messageID: props.messageID,
      } as any
    }

    case "session.status": {
      const props = event.properties
      if (!props) return null
      const info = props.status
      const extra: any = {}
      if (info.type === "retry") {
        extra.attempt = info.attempt
        extra.message = info.message
        extra.next = info.next
      } else if (info.type === "offline") {
        extra.message = info.message
      }
      return {
        type: "sessionStatus",
        sessionID: props.sessionID,
        status: info.type,
        ...extra,
      } as any
    }

    case "session.turn.close":
      return {
        type: "sessionTurnClosed",
        sessionID: event.properties?.sessionID,
        reason: event.properties?.reason,
      } as any

    case "session.created":
      return {
        type: "sessionCreated",
        session: sessionToWebview(event.properties?.info),
      } as any

    case "session.updated": {
      const props = event.properties
      if (!props) return null
      const info = props.info
      const patch: any = { id: props.sessionID }
      if (info.title !== undefined) patch.title = info.title
      if (info.time?.created !== undefined)
        patch.createdAt = new Date(info.time.created).toISOString()
      if (info.time?.updated !== undefined)
        patch.updatedAt = new Date(info.time.updated).toISOString()
      if (info.revert !== undefined) patch.revert = info.revert
      if (info.summary !== undefined) patch.summary = info.summary
      if (info.parentID !== undefined) patch.parentID = info.parentID
      return { type: "sessionUpdated", session: patch } as any
    }

    case "session.deleted":
      return {
        type: "sessionDeleted",
        sessionID: event.properties?.sessionID,
      } as any

    case "permission.asked": {
      const props = event.properties
      if (!props) return null
      return {
        type: "permissionRequest",
        permission: {
          id: props.id,
          sessionID: props.sessionID,
          toolName: props.permission,
          patterns: props.patterns ?? [],
          always: props.always ?? [],
          args: props.metadata ?? {},
          message: `Permission required: ${props.permission}`,
          tool: props.tool,
        },
      } as any
    }

    case "permission.replied":
      return {
        type: "permissionResolved",
        permissionID: event.properties?.requestID,
      } as any

    case "todo.updated":
      return {
        type: "todoUpdated",
        sessionID: event.properties?.sessionID,
        items: event.properties?.todos ?? [],
      } as any

    case "question.asked": {
      const props = event.properties
      if (!props) return null
      return {
        type: "questionRequest",
        question: {
          id: props.id,
          sessionID: props.sessionID,
          questions: props.questions ?? [],
          blocking: props.blocking,
          tool: props.tool,
        },
      } as any
    }

    case "question.replied":
    case "question.rejected":
      return {
        type: "questionResolved",
        requestID: event.properties?.requestID,
      } as any

    case "suggestion.shown": {
      const props = event.properties
      if (!props) return null
      return {
        type: "suggestionRequest",
        suggestion: {
          id: props.id,
          sessionID: props.sessionID,
          text: props.text,
          actions: props.actions ?? [],
          blocking: props.blocking,
          tool: props.tool,
        },
      } as any
    }

    case "suggestion.accepted":
    case "suggestion.dismissed":
      return {
        type: "suggestionResolved",
        requestID: event.properties?.requestID,
      } as any

    case "session.error":
      return {
        type: "sessionError",
        sessionID: event.properties?.sessionID,
        error: event.properties?.error,
      } as any

    case "indexing.status":
      return {
        type: "indexingStatusLoaded",
        status: event.properties?.status,
      } as any

    default:
      return null
  }
}

function setupEventStream() {
  const ctl = new AbortController()
  void (async () => {
    try {
      const events = await client.global.event({
        signal: ctl.signal,
        sseMaxRetryAttempts: 0,
      })
      for await (const event of events.stream) {
        if (ctl.signal.aborted) return
        const payload = event.payload ?? event
        if ((payload.type as string) !== "server.heartbeat") {
          // console.log("[Emulator SSE Raw Payload]", payload)
        }
        const msg = mapSSEEvent(payload)
        if (msg) {
          // console.log("[Emulator SSE Mapped Msg]", msg)
          if (msg.type === "permissionRequest" && autoApproveEnabled) {
            void client.permission.respond({
              sessionID: (msg as any).permission.sessionID,
              directory,
              permissionID: (msg as any).permission.id,
              response: "once",
            }).catch(e => console.error("[Emulator] Auto-approve failed:", e))
          }
          emitVsCodeMessage(msg)
        }
      }
      
      // Stream ended normally, we must reconnect
      if (!ctl.signal.aborted) {
        setTimeout(() => setupEventStream(), 1000)
      }
    } catch (e) {
      console.warn("[Emulator] Event stream error:", e)
      // Attempt reconnect after a delay
      setTimeout(() => setupEventStream(), 3000)
    }
  })()
}

// ─── Message Handlers ───────────────────────────────────────────────────────

async function handleWebviewReady() {
  emitVsCodeMessage({
    type: "ready",
    serverInfo: {
      port: 4101,
      version: "1.0.0",
    },
    workspaceDirectory: directory,
    extensionVersion: "1.0.0",
    fontSize: 14,
  })
}

async function handleRequestAgents() {
  try {
    const res = await client.app.agents()
    if (res.data) {
      const agents = res.data as any[]
      const visible = agents.filter(
        (a: any) => a.mode !== "subagent" && !a.hidden
      )
      let defaultAgent = visible.length > 0 ? visible[0].name : "code"
      if (settings.selectedAgent && visible.some((a: any) => a.name === settings.selectedAgent)) {
        defaultAgent = settings.selectedAgent as string
      }
      emitVsCodeMessage({
        type: "agentsLoaded",
        agents: visible as any,
        allAgents: agents as any,
        defaultAgent,
      })
    }
  } catch (e) {
    console.error("[Emulator] Failed to load agents:", e)
    // Send fallback so UI doesn't get stuck
    emitVsCodeMessage({
      type: "agentsLoaded",
      agents: [
        { name: "code", mode: "agent", description: "Code agent" },
      ] as any,
      allAgents: [
        { name: "code", mode: "agent", description: "Code agent" },
      ] as any,
      defaultAgent: "code",
    })
  }
}

async function handleRequestProviders() {
  try {
    const { data: response } = await client.provider.list(
      { directory },
      { throwOnError: true }
    )
    const providers = indexProvidersById(response.all ?? [])
    const connected = response.connected ?? []
    const defaults = response.default ?? {}

    emitVsCodeMessage({
      type: "providersLoaded",
      providers: providers as any,
      connected: connected as any,
      defaults: defaults as any,
      defaultSelection: {
        providerID: "kilo-auto",
        modelID: "kilo-auto",
      } as any,
      authMethods: {} as any,
      authStates: {} as any,
    })
  } catch (e) {
    console.error("[Emulator] Failed to load providers:", e)
    // Send empty but valid response so UI doesn't get stuck
    emitVsCodeMessage({
      type: "providersLoaded",
      providers: {} as any,
      connected: [] as any,
      defaults: {} as any,
      defaultSelection: {
        providerID: "kilo-auto",
        modelID: "kilo-auto",
      } as any,
      authMethods: {} as any,
      authStates: {} as any,
    })
  }
}

async function handleRequestConfig() {
  try {
    const res = await client.config.overlay({ scope: "global" })
    if (res.data) {
      emitVsCodeMessage({
        type: "configLoaded",
        config: (res.data as any).global ?? {},
        features: {
          indexing: true,
          sandboxControls: true,
        },
      } as any)
    }
  } catch (e) {
    console.error("[Emulator] Failed to load config:", e)
    emitVsCodeMessage({
      type: "configLoaded",
      config: {} as any,
      features: { indexing: false, sandboxControls: false },
    } as any)
  }
}

async function handleRequestSessions() {
  try {
    const res = await client.experimental.session.list({
      archived: false,
      limit: 50,
    })
    if (res.data) {
      const sessions = (res.data as any[]).map(sessionToWebview)
      emitVsCodeMessage({
        type: "sessionsLoaded",
        sessions: sessions as any,
      })
    }
  } catch (e) {
    console.error("[Emulator] Failed to load sessions:", e)
    emitVsCodeMessage({
      type: "sessionsLoaded",
      sessions: [] as any,
    })
  }
}

async function handleSendMessage(msg: any) {
  let sessionID = msg.sessionID || currentSessionID

  try {
    // Create a new session if none exists
    if (!sessionID) {
      const { data: session } = await client.session.create(
        { directory, platform: "web" },
        { throwOnError: true }
      )
      sessionID = session.id
      currentSessionID = sessionID

      emitVsCodeMessage({
        type: "sessionCreated",
        session: sessionToWebview(session),
        draftID: msg.draftID,
      } as any)
    }

    currentSessionID = sessionID

    // Build parts array
    const parts: any[] = []
    if (msg.files) {
      for (const f of msg.files) {
        parts.push({
          type: "file",
          mime: f.mime,
          url: f.url,
          filename: f.filename,
          source: f.source,
        })
      }
    }
    parts.push({
      type: "text",
      text: msg.text,
    })

    // Build model parameter
    const model =
      msg.providerID && msg.modelID
        ? { providerID: msg.providerID, modelID: msg.modelID }
        : undefined

    // Send the message asynchronously — the SSE stream delivers responses
    await client.session.promptAsync(
      {
        sessionID,
        directory,
        messageID: msg.messageID,
        parts,
        model,
        agent: msg.agent || selectedAgent,
        variant: msg.variant,
      },
      { throwOnError: true }
    )
  } catch (e) {
    console.error("[Emulator] Failed to send message:", e)
    emitVsCodeMessage({
      type: "messageCreated",
      sessionID,
      message: {
        id: "error-" + Date.now(),
        time: { created: new Date().toISOString(), updated: new Date().toISOString() },
        role: "assistant",
        parts: [{ type: "text", text: `[Emulator Error] Request failed: ${e}` }],
        createdAt: new Date().toISOString(),
      },
    } as any)
  }
}

async function handleEnhancePrompt(msg: any) {
  try {
    const { data } = await client.enhancePrompt.enhance(
      { text: msg.text },
      { throwOnError: true }
    )
    emitVsCodeMessage({
      type: "enhancePromptResult",
      text: data.text,
      requestId: msg.requestId,
    } as any)
  } catch (e: any) {
    console.error("[Emulator] Failed to enhance prompt:", e)
    emitVsCodeMessage({
      type: "enhancePromptError",
      error: e.message || "Failed to enhance prompt",
      requestId: msg.requestId,
    } as any)
  }
}

async function handleSendCommand(msg: any) {
  try {
    let sessionID = msg.sessionID || currentSessionID

    if (!sessionID) {
      const { data: session } = await client.session.create(
        { directory, platform: "web" },
        { throwOnError: true }
      )
      sessionID = session.id
      currentSessionID = sessionID
      emitVsCodeMessage({
        type: "sessionCreated",
        session: sessionToWebview(session),
        draftID: msg.draftID,
      } as any)
    }

    currentSessionID = sessionID

    await client.session.command(
      {
        sessionID,
        directory,
        command: msg.command,
        arguments: msg.arguments,
        messageID: msg.messageID,
        agent: msg.agent || selectedAgent,
        variant: msg.variant,
      },
      { throwOnError: true }
    )
  } catch (e) {
    console.error("[Emulator] Failed to send command:", e)
    emitVsCodeMessage({
      type: "sendMessageFailed",
      error:
        e instanceof Error ? e.message : "Failed to send command",
      text: `/${msg.command} ${msg.arguments || ""}`.trim(),
      sessionID: msg.sessionID || currentSessionID,
      draftID: msg.draftID,
      messageID: msg.messageID,
    } as any)
  }
}

async function handleAbort(msg: any) {
  const sessionID = msg.sessionID || currentSessionID
  if (!sessionID) return
  try {
    await client.session.abort({ sessionID, directory })
  } catch (e) {
    console.error("[Emulator] Failed to abort:", e)
  }
}

async function handleLoadMessages(msg: any) {
  const sessionID = msg.sessionID
  if (!sessionID || sessionID === "{sessionID}") {
    emitVsCodeMessage({
      type: "messagesLoaded",
      sessionID,
      messages: [],
      mode: msg.mode ?? "replace",
      hasMore: false,
    } as any)
    return
  }
  try {
    const { data: items, response } = await client.session.messages(
      {
        sessionID,
        directory,
        limit: msg.limit ?? 80,
        before: msg.before,
      },
      { throwOnError: true }
    )

    const messages = (items as any[]).map((m: any) => ({
      ...m.info,
      parts: m.parts,
      createdAt: m.info.time
        ? new Date(m.info.time.created).toISOString()
        : new Date().toISOString(),
    }))

    const cursor = response.headers.get("X-Next-Cursor")

    currentSessionID = sessionID

    emitVsCodeMessage({
      type: "messagesLoaded",
      sessionID,
      messages,
      mode: msg.mode ?? "replace",
      cursor: cursor ?? undefined,
      hasMore: Boolean(cursor),
    } as any)
  } catch (e) {
    console.error("[Emulator] Failed to load messages:", e)
    emitVsCodeMessage({
      type: "error",
      message: "Failed to load messages",
      sessionID,
    } as any)
  }
}

async function handleCreateSession() {
  try {
    const { data: session } = await client.session.create(
      { directory, platform: "web" },
      { throwOnError: true }
    )
    currentSessionID = session.id
    emitVsCodeMessage({
      type: "sessionCreated",
      session: sessionToWebview(session),
    } as any)
  } catch (e) {
    console.error("[Emulator] Failed to create session:", e)
  }
}

async function handleDeleteSession(msg: any) {
  const sessionID = msg.sessionID
  if (!sessionID) return
  try {
    await client.session.delete(
      { sessionID, directory },
      { throwOnError: true }
    )
    emitVsCodeMessage({
      type: "sessionDeleted",
      sessionID,
    } as any)
    if (currentSessionID === sessionID) {
      currentSessionID = null
    }
  } catch (e) {
    console.error("[Emulator] Failed to delete session:", e)
  }
}

async function handlePermissionResponse(msg: any) {
  try {
    await client.permission.respond({
      sessionID: msg.sessionID,
      directory,
      permissionID: msg.permissionId,
      response: msg.response,
    })
  } catch (e) {
    console.error("[Emulator] Failed to respond to permission:", e)
    emitVsCodeMessage({
      type: "permissionError",
      permissionID: msg.permissionId,
    } as any)
  }
}

async function handleQuestionReply(msg: any) {
  try {
    await client.question.reply({
      id: msg.requestID,
      directory,
      answers: msg.answers,
    } as any)
  } catch (e) {
    console.error("[Emulator] Failed to reply to question:", e)
  }
}

async function handleQuestionReject(msg: any) {
  try {
    await client.question.reject({
      id: msg.requestID,
      directory,
    } as any)
  } catch (e) {
    console.error("[Emulator] Failed to reject question:", e)
  }
}

async function handleRevertSession(msg: any) {
  const sessionID = msg.sessionID
  if (!sessionID) return
  try {
    await client.session.revert({
      sessionID,
      directory,
      messageID: msg.messageID,
    } as any)
  } catch (e) {
    console.error("[Emulator] Failed to revert session:", e)
  }
}

async function handleSuggestionAccept(msg: any) {
  try {
    await client.suggestion.accept({
      requestID: msg.requestID,
      index: msg.index,
      directory,
    }, { throwOnError: true })
  } catch (e) {
    console.error("[Emulator] Failed to accept suggestion:", e)
    emitVsCodeMessage({
      type: "suggestionError",
      requestID: msg.requestID,
    } as any)
  }
}

async function handleSuggestionDismiss(msg: any) {
  try {
    await client.suggestion.dismiss({
      requestID: msg.requestID,
      directory,
    }, { throwOnError: true })
  } catch (e) {
    console.error("[Emulator] Failed to dismiss suggestion:", e)
    emitVsCodeMessage({
      type: "suggestionError",
      requestID: msg.requestID,
    } as any)
  }
}

// ─── Core Emulator ──────────────────────────────────────────────────────────

function injectVscodeThemeVars() {
  const urlParams = new URLSearchParams(window.location.search)
  const theme = urlParams.get("theme") || "dark"
  const isDark = theme === "dark"
  const root = document.documentElement

  if (isDark) {
    document.body.classList.add("vscode-dark")
    root.style.setProperty("--vscode-editor-background", "#1e1e1e")
    root.style.setProperty("--vscode-sideBar-background", "#252526")
    root.style.setProperty("--vscode-foreground", "#cccccc")
    root.style.setProperty("--vscode-editor-foreground", "#d4d4d4")
    root.style.setProperty("--vscode-descriptionForeground", "#858585")
    root.style.setProperty("--vscode-disabledForeground", "#6b6b6b")
    root.style.setProperty("--vscode-input-background", "#3c3c3c")
    root.style.setProperty("--vscode-button-background", "#0e639c")
    root.style.setProperty("--vscode-button-foreground", "#ffffff")
    root.style.setProperty("--vscode-button-hoverBackground", "#1177bb")
    root.style.setProperty("--vscode-button-secondaryBackground", "#3a3d41")
    root.style.setProperty("--vscode-button-secondaryForeground", "#cccccc")
    root.style.setProperty("--vscode-button-secondaryHoverBackground", "#45494e")
    root.style.setProperty("--vscode-panel-border", "#454545")
    root.style.setProperty("--vscode-widget-border", "#454545")
    root.style.setProperty("--vscode-focusBorder", "#007fd4")
    root.style.setProperty("--vscode-textLink-foreground", "#3794ff")
    root.style.setProperty("--vscode-list-hoverBackground", "#2a2d2e")
    root.style.setProperty("--vscode-list-activeSelectionBackground", "#094771")
    root.style.setProperty("--vscode-list-activeSelectionForeground", "#ffffff")
    root.style.setProperty("--vscode-list-inactiveSelectionBackground", "#37373d")
    root.style.setProperty("--vscode-editorWidget-background", "#252526")
    root.style.setProperty("--vscode-editorGroup-border", "#303031")
    root.style.setProperty("--vscode-editorGroupHeader-tabsBackground", "#252526")
    root.style.setProperty("--vscode-icon-foreground", "#c5c5c5")
    root.style.setProperty("--vscode-toolbar-hoverBackground", "#5a5d5e50")
    root.style.setProperty("--vscode-toolbar-activeBackground", "#717171")
    root.style.setProperty("--vscode-charts-green", "#89d185")
    root.style.setProperty("--vscode-charts-yellow", "#cca700")
    root.style.setProperty("--vscode-charts-red", "#f14c4c")
    root.style.setProperty("--vscode-charts-blue", "#3794ff")
    root.style.setProperty("--vscode-charts-orange", "#d18616")
    root.style.setProperty("--vscode-charts-purple", "#b180d7")
    root.style.setProperty("--vscode-errorForeground", "#f14c4c")
    root.style.setProperty("--vscode-gitDecoration-addedResourceForeground", "#81b88b")
    root.style.setProperty("--vscode-gitDecoration-deletedResourceForeground", "#c74e39")
    root.style.setProperty("--vscode-gitDecoration-modifiedResourceForeground", "#e2c08d")
    root.style.setProperty("--vscode-debugTokenExpression-string", "#ce9178")
    root.style.setProperty("--vscode-debugTokenExpression-number", "#b5cea8")
    root.style.setProperty("--vscode-debugTokenExpression-name", "#9cdcfe")
    root.style.setProperty("--vscode-debugTokenExpression-type", "#4ec9b0")
    root.style.setProperty("--vscode-editorLineNumber-foreground", "#858585")
    root.style.setProperty("--vscode-input-border", "#3c3c3c")
    root.style.setProperty("--vscode-input-foreground", "#cccccc")
    root.style.setProperty("--vscode-editorWidget-border", "#454545")
    root.style.setProperty("--vscode-dropdown-background", "#3c3c3c")
    root.style.setProperty("--vscode-dropdown-border", "#454545")
    root.style.setProperty("--vscode-dropdown-foreground", "#cccccc")
    root.style.setProperty("--vscode-menu-background", "#252526")
    root.style.setProperty("--vscode-badge-background", "#4d4d4d")
    root.style.setProperty("--vscode-badge-foreground", "#ffffff")
    root.style.setProperty("--vscode-editorStickyScrollHover-background", "#2a2d2e")
    root.style.setProperty("--vscode-editor-inactiveSelectionBackground", "#3a3d41")
    root.style.setProperty("--vscode-contrastBorder", "transparent")
  } else {
    document.body.classList.add("vscode-light")
    root.style.setProperty("--vscode-editor-background", "#ffffff")
    root.style.setProperty("--vscode-sideBar-background", "#f3f3f3")
    root.style.setProperty("--vscode-foreground", "#616161")
    root.style.setProperty("--vscode-editor-foreground", "#333333")
    root.style.setProperty("--vscode-descriptionForeground", "#767676")
    root.style.setProperty("--vscode-disabledForeground", "#a0a0a0")
    root.style.setProperty("--vscode-input-background", "#ffffff")
    root.style.setProperty("--vscode-button-background", "#007acc")
    root.style.setProperty("--vscode-button-foreground", "#ffffff")
    root.style.setProperty("--vscode-button-hoverBackground", "#0062a3")
    root.style.setProperty("--vscode-button-secondaryBackground", "#f3f3f3")
    root.style.setProperty("--vscode-button-secondaryForeground", "#616161")
    root.style.setProperty("--vscode-button-secondaryHoverBackground", "#e8e8e8")
    root.style.setProperty("--vscode-panel-border", "#cecece")
    root.style.setProperty("--vscode-widget-border", "#cecece")
    root.style.setProperty("--vscode-focusBorder", "#0090f1")
    root.style.setProperty("--vscode-textLink-foreground", "#006ab1")
    root.style.setProperty("--vscode-list-hoverBackground", "#e8e8e8")
    root.style.setProperty("--vscode-list-activeSelectionBackground", "#0060c0")
    root.style.setProperty("--vscode-list-activeSelectionForeground", "#ffffff")
    root.style.setProperty("--vscode-list-inactiveSelectionBackground", "#e4e6f1")
    root.style.setProperty("--vscode-editorWidget-background", "#f3f3f3")
    root.style.setProperty("--vscode-editorGroup-border", "#e7e7e7")
    root.style.setProperty("--vscode-editorGroupHeader-tabsBackground", "#f8f8f8")
    root.style.setProperty("--vscode-icon-foreground", "#424242")
    root.style.setProperty("--vscode-toolbar-hoverBackground", "#b8b8b850")
    root.style.setProperty("--vscode-toolbar-activeBackground", "#a6a6a6")
    root.style.setProperty("--vscode-charts-green", "#388a34")
    root.style.setProperty("--vscode-charts-yellow", "#bf8803")
    root.style.setProperty("--vscode-charts-red", "#e51400")
    root.style.setProperty("--vscode-charts-blue", "#1a85ff")
    root.style.setProperty("--vscode-charts-orange", "#d18616")
    root.style.setProperty("--vscode-charts-purple", "#652d90")
    root.style.setProperty("--vscode-errorForeground", "#e51400")
    root.style.setProperty("--vscode-gitDecoration-addedResourceForeground", "#587c0c")
    root.style.setProperty("--vscode-gitDecoration-deletedResourceForeground", "#ad0707")
    root.style.setProperty("--vscode-gitDecoration-modifiedResourceForeground", "#895503")
    root.style.setProperty("--vscode-debugTokenExpression-string", "#a31515")
    root.style.setProperty("--vscode-debugTokenExpression-number", "#098658")
    root.style.setProperty("--vscode-debugTokenExpression-name", "#001080")
    root.style.setProperty("--vscode-debugTokenExpression-type", "#267f99")
    root.style.setProperty("--vscode-editorLineNumber-foreground", "#767676")
    root.style.setProperty("--vscode-input-border", "#cecece")
    root.style.setProperty("--vscode-input-foreground", "#333333")
    root.style.setProperty("--vscode-editorWidget-border", "#c8c8c8")
    root.style.setProperty("--vscode-dropdown-background", "#ffffff")
    root.style.setProperty("--vscode-dropdown-border", "#cecece")
    root.style.setProperty("--vscode-dropdown-foreground", "#616161")
    root.style.setProperty("--vscode-menu-background", "#ffffff")
    root.style.setProperty("--vscode-badge-background", "#c4c4c4")
    root.style.setProperty("--vscode-badge-foreground", "#333333")
    root.style.setProperty("--vscode-editorStickyScrollHover-background", "#e8e8e8")
    root.style.setProperty("--vscode-editor-inactiveSelectionBackground", "#e4e6f1")
    root.style.setProperty("--vscode-contrastBorder", "transparent")
  }
}

export function setupEmulator() {
  injectVscodeThemeVars()

  ;(window as any).acquireVsCodeApi = () => {
    return {
      postMessage: async (msg: any) => {
        try {
          switch (msg.type) {
            case "webviewReady":
              await handleWebviewReady()
              break

            case "requestWorkStyle":
              emitVsCodeMessage({
                type: "workStyleLoaded",
                style: "skipped",
              })
              break

            case "requestAgents":
              await handleRequestAgents()
              break

            case "requestProviders":
              await handleRequestProviders()
              break

            case "requestConfig":
              await handleRequestConfig()
              break

            case "requestSessions":
            case "loadSessions":
              await handleRequestSessions()
              break

            case "requestNotifications":
              emitVsCodeMessage({
                type: "notificationsLoaded",
                notifications: [],
                dismissedIds: [],
              })
              break

            case "requestModelSelectorExpanded":
              emitVsCodeMessage({
                type: "modelSelectorExpandedLoaded",
                value: true,
              })
              break

            case "requestTimelineSetting":
              emitVsCodeMessage({
                type: "timelineSettingLoaded",
                visible: settings.showTaskTimeline !== false,
              })
              break

            case "requestAutocompleteSettings":
              emitVsCodeMessage({
                type: "autocompleteSettingsLoaded",
                settings: {
                  enableAutoTrigger: false,
                  enableSmartInlineTaskKeybinding: false,
                  enableChatAutocomplete: false,
                  provider: null,
                  model: null,
                },
              })
              break

            case "requestKiloEmbeddingModels":
              emitVsCodeMessage({
                type: "kiloEmbeddingModelsLoaded",
                catalog: {} as any,
              })
              break

            case "requestSkills":
              emitVsCodeMessage({
                type: "skillsLoaded",
                skills: [] as any,
              })
              break

            case "requestVariants":
              emitVsCodeMessage({
                type: "variantsLoaded",
                variants: (settings.variants as any) || {},
              })
              break

            case "requestModelSelections":
              emitVsCodeMessage({
                type: "modelSelectionsLoaded",
                selections: (settings.modelSelections as any) || {},
              })
              break

            case "requestRecents":
              emitVsCodeMessage({
                type: "recentsLoaded",
                recents: (settings.recents as any) || [],
              })
              break

            case "requestFavorites":
              emitVsCodeMessage({
                type: "favoritesLoaded",
                favorites: [],
              })
              break

            // ── Core chat operations ──

            case "sendMessage":
              await handleSendMessage(msg)
              break

            case "sendCommand":
              await handleSendCommand(msg)
              break

            case "abort":
              await handleAbort(msg)
              break

            case "reload":
              window.location.reload()
              break

            case "loadMessages":
              await handleLoadMessages(msg)
              break

            case "createSession":
              await handleCreateSession()
              break

            case "clearSession":
              currentSessionID = null
              break

            case "deleteSession":
              await handleDeleteSession(msg)
              break

            // ── Session management ──

            case "syncSession":
              // Track the child session for events - messages will come via SSE
              if (msg.sessionID) {
                await handleLoadMessages({
                  sessionID: msg.sessionID,
                  mode: "replace",
                })
              }
              break

            case "selectSession":
              if (msg.sessionID) {
                currentSessionID = msg.sessionID
              }
              break

            // ── Agent / model selection ──

            case "selectAgent":
              selectedAgent = msg.agent
              settings.selectedAgent = msg.agent
              saveSettings(settings)
              break

            case "selectModel":
              // Model selection is sent per-message, just acknowledge
              break

            case "persistModelSelectorExpanded":
              // No-op in web context
              break

            // ── Permissions / questions ──

            case "permissionResponse":
              await handlePermissionResponse(msg)
              break

            case "questionReply":
              await handleQuestionReply(msg)
              break

            case "questionReject":
              await handleQuestionReject(msg)
              break

            // ── Session operations ──

            case "revertSession":
              await handleRevertSession(msg)
              break

            case "unrevertSession":
              try {
                await (client.session as any).unrevert({
                  sessionID: msg.sessionID,
                  directory,
                })
              } catch (e) {
                console.error("[Emulator] Failed to unrevert:", e)
              }
              break

            // ── File operations (no-ops in web context) ──

            case "openFile":
            case "openDiffVirtual":
            case "openExternal":
            case "openContent":
            case "saveImage":
            case "validateFiles":
              if (msg.type === "openExternal" && msg.url) {
                window.open(msg.url, "_blank")
              }
              if (msg.type === "validateFiles" && msg.id) {
                // Can't validate files in web context, return empty
                emitVsCodeMessage({
                  type: "validateFilesResult",
                  id: msg.id,
                  existing: [],
                } as any)
              }
              break

            // ── Config updates ──

            case "updateConfig":
              try {
                await client.config.update({
                  directory,
                  ...msg.config,
                })
                await handleRequestConfig()
              } catch (e) {
                console.error("[Emulator] Failed to update config:", e)
              }
              break

            // ── Memory ──

            case "requestIndexingStatus":
              try {
                const { data: status } = await client.indexing.status({ directory: directory || undefined }, { throwOnError: true })
                emitVsCodeMessage({ type: "indexingStatusLoaded", status } as any)
              } catch (e) {
                console.error("[Emulator] Failed to request indexing status:", e)
              }
              break

            case "requestIndexingSettings":
              emitVsCodeMessage({
                type: "indexingSettingsLoaded",
                settings: { showButtonWhenDisabled: true },
              })
              break

            case "requestFileSearch":
              try {
                const query = msg.query
                const [fileRes, folderRes] = await Promise.all([
                  client.find.files({ query, directory: directory || undefined, type: "file", limit: 50 }).catch(() => ({ data: [] })),
                  client.find.files({ query, directory: directory || undefined, type: "directory", limit: 50 }).catch(() => ({ data: [] }))
                ])
                const files = fileRes.data || []
                const folders = folderRes.data || []
                
                const items: any[] = []
                for (const f of folders) {
                  items.push({ path: f, type: "folder" })
                }
                for (const f of files) {
                  items.push({ path: f, type: "file" })
                }
                
                emitVsCodeMessage({
                  type: "fileSearchResult",
                  paths: files,
                  items,
                  dir: directory,
                  requestId: msg.requestId
                } as any)
              } catch (e) {
                console.error("[Emulator] Failed to request file search:", e)
                emitVsCodeMessage({
                  type: "fileSearchResult",
                  paths: [],
                  items: [],
                  dir: directory,
                  requestId: msg.requestId
                } as any)
              }
              break

            case "requestSandboxDefault":
              try {
                const { data: status } = await client.sandbox.support({ directory }, { throwOnError: true })
                emitVsCodeMessage({
                  type: "sandboxDefaultStatus",
                  desired: true,
                  enabled: status.available,
                  available: status.available,
                  reason: status.reason,
                } as any)
              } catch (e) {
                console.error("[Emulator] Failed to request sandbox default status:", e)
              }
              break

            case "setSandboxDefault":
              emitVsCodeMessage({
                type: "sandboxDefaultStatus",
                desired: msg.enabled,
                enabled: msg.enabled,
                available: true,
                reason: undefined,
                revision: 1,
                requestID: msg.requestID,
              })
              break

            case "toggleSandbox":
              try {
                const sid = msg.sessionID || currentSessionID
                if (sid && sid !== "{sessionID}") {
                  const { data } = await client.sandbox.toggle({ sessionID: sid, directory }, { throwOnError: true })
                  emitVsCodeMessage({
                    type: "sandboxStatus",
                    sessionID: sid,
                    revision: 1,
                    ...data,
                    requestID: msg.requestID
                  } as any)
                }
              } catch (e) {
                console.error("[Emulator] Failed to toggle sandbox:", e)
              }
              break

            case "requestImageModels":
              emitVsCodeMessage({ type: "imageModelsLoaded", models: [] } as any)
              break

            case "requestMcpStatus":
              try {
                const { data: status } = await client.mcp.status({ directory }, { throwOnError: true })
                emitVsCodeMessage({ type: "mcpStatusLoaded", status } as any)
              } catch (e) {
                console.error("[Emulator] Failed to request MCP status:", e)
              }
              break

            case "requestSandboxStatus":
              try {
                const sid = msg.sessionID || currentSessionID
                if (!sid || sid === "{sessionID}") {
                  emitVsCodeMessage({ type: "sandboxStatus", sessionID: sid, status: { enabled: false } } as any)
                  break
                }
                const { data: status } = await client.sandbox.status({ sessionID: sid, directory }, { throwOnError: true })
                emitVsCodeMessage({ type: "sandboxStatus", sessionID: sid, status } as any)
              } catch (e) {
                console.error("[Emulator] Failed to request sandbox status:", e)
              }
              break

            case "requestSessionModelUsage":
              if (msg.sessionID && msg.sessionID !== "{sessionID}") {
                try {
                  const { data: usage } = await client.kilocode.sessionModelUsage({ sessionID: msg.sessionID, directory }, { throwOnError: true })
                  emitVsCodeMessage({ type: "sessionModelUsageLoaded", sessionID: msg.sessionID, requestID: msg.requestID, data: usage } as any)
                } catch (e) {
                  console.error("[Emulator] Failed to request session model usage:", e)
                }
              }
              break

            case "updateSetting":
              try {
                settings[msg.key] = msg.value
                saveSettings(settings)
                if (msg.key === "showTaskTimeline") {
                  emitVsCodeMessage({
                    type: "timelineSettingLoaded",
                    visible: msg.value !== false,
                  } as any)
                }
              } catch (e) {
                console.error("[Emulator] Failed to update setting:", e)
              }
              break

            case "compact":
              if (msg.sessionID) {
                console.warn("[Emulator] Session compaction is not supported in the emulator environment.")
              }
              break

            case "requestMemory":
              try {
                const memRes = await (client as any).memory.status({
                  directory,
                })
                emitVsCodeMessage({
                  type: "memoryLoaded",
                  status: memRes.data,
                } as any)
              } catch {
                emitVsCodeMessage({
                  type: "memoryLoaded",
                  status: { enabled: false },
                } as any)
              }
              break

            case "enhancePrompt":
              void handleEnhancePrompt(msg)
              break

            // ── Git status ──

            case "requestGitStatus":
              emitVsCodeMessage({
                type: "gitStatus",
                repo: false,
              } as any)
              break

            case "requestAutoApproveState":
              emitVsCodeMessage({ type: "autoApproveState", active: autoApproveEnabled } as any)
              break

            case "toggleAutoApprove":
              autoApproveEnabled = !autoApproveEnabled
              emitVsCodeMessage({ type: "autoApproveState", active: autoApproveEnabled } as any)
              break

             case "openSettingsPanel":
             case "openSettingsTab":
               window.parent.postMessage({ type: 'navigateZaraCli', path: msg.tab ? `/console/settings/${msg.tab}` : '/console/settings' }, "*")
               break
             case "persistModelSelection": {
               const modelSelections = (settings.modelSelections as Record<string, { providerID: string, modelID: string }>) || {}
               modelSelections[msg.agent] = { providerID: msg.providerID, modelID: msg.modelID }
               settings.modelSelections = modelSelections
               saveSettings(settings)
               break
             }
             case "clearModelSelection": {
               const modelSelections = (settings.modelSelections as Record<string, { providerID: string, modelID: string }>) || {}
               delete modelSelections[msg.agent]
               settings.modelSelections = modelSelections
               saveSettings(settings)
               break
             }

             case "persistVariant": {
               const variants = (settings.variants as Record<string, string>) || {}
               variants[msg.key] = msg.value
               settings.variants = variants
               saveSettings(settings)
               break
             }

             case "persistRecents":
               try {
                 settings.recents = msg.recents
                 saveSettings(settings)
               } catch (e) {
                 console.error("[Emulator] Failed to persist recents:", e)
               }
               break

             case "suggestionAccept":
               await handleSuggestionAccept(msg)
               break

             case "suggestionDismiss":
               await handleSuggestionDismiss(msg)
               break

            default:
              console.log(
                "[Emulator] Unhandled message type:",
                msg.type
              )
          }
        } catch (e) {
          console.error(
            "[Emulator] Error handling message",
            msg.type,
            e
          )
        }
      },
      getState: () => undefined,
      setState: () => {},
    }
  }

  // Start the SSE event stream
  setupEventStream()
}
