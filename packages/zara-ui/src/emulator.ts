import { createKiloClient } from "@kilocode/sdk/v2/client"
import type { ExtensionMessage } from "./chat-app/types/messages"

// ─── SDK Client ─────────────────────────────────────────────────────────────

function getClient() {
  const urlParams = new URLSearchParams(window.location.search)
  const baseUrl = urlParams.get("url") || window.location.origin
  const directory = urlParams.get("dir") || urlParams.get("project") || "/"

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
    switch (event.name) {
      case "message.updated.1": {
        const info = event.data.info
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
          sessionID: event.data.sessionID,
          messageID: event.data.messageID,
        } as any
      case "message.part.updated.1": {
        const part = event.data.part
        return {
          type: "partUpdated",
          sessionID: event.data.sessionID,
          messageID: part.messageID,
          part,
        } as any
      }
      case "message.part.removed.1":
        return {
          type: "partRemoved",
          sessionID: event.data.sessionID,
          messageID: event.data.messageID,
          partID: event.data.partID,
        } as any
      case "session.created.1":
        return {
          type: "sessionCreated",
          session: sessionToWebview(event.data.info),
        } as any
      case "session.updated.1":
        return null // handled separately
      case "session.deleted.1":
        return {
          type: "sessionDeleted",
          sessionID: event.data.sessionID,
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
          type: "text",
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
        const msg = mapSSEEvent(event)
        if (msg) {
          emitVsCodeMessage(msg)
        }
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
      const defaultAgent = visible.length > 0 ? visible[0].name : "code"
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
  try {
    let sessionID = msg.sessionID || currentSessionID

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
      type: "sendMessageFailed",
      error:
        e instanceof Error ? e.message : "Failed to send message",
      text: msg.text,
      sessionID: msg.sessionID || currentSessionID,
      draftID: msg.draftID,
      messageID: msg.messageID,
      files: msg.files,
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
  if (!sessionID) return
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
      id: msg.permissionId,
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

// ─── Core Emulator ──────────────────────────────────────────────────────────

export function setupEmulator() {
  console.log("[Zara UI] Setting up VS Code API Emulator...")

  ;(window as any).acquireVsCodeApi = () => {
    return {
      postMessage: async (msg: any) => {
        console.log("[Emulator] \u2190", msg.type, msg)

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
                visible: false,
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

            case "requestMcpStatus":
              emitVsCodeMessage({
                type: "mcpStatusLoaded",
                status: {} as any,
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
                variants: {} as any,
              })
              break

            case "requestModelSelections":
              emitVsCodeMessage({
                type: "modelSelectionsLoaded",
                selections: {} as any,
              })
              break

            case "requestRecents":
              emitVsCodeMessage({
                type: "recentsLoaded",
                recents: [],
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

            case "replyToQuestion":
              await handleQuestionReply(msg)
              break

            case "rejectQuestion":
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

            // ── Git status ──

            case "requestGitStatus":
              emitVsCodeMessage({
                type: "gitStatus",
                repo: false,
              } as any)
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
