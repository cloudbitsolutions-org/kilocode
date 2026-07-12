import { createKiloClient } from "@kilocode/sdk/v2/client"
import type { ExtensionMessage, WebviewMessage } from "./chat-app/types/messages"

// Initialize the SDK Client
function getClient() {
  const urlParams = new URLSearchParams(window.location.search)
  const baseUrl = urlParams.get("url") || "http://127.0.0.1:4101"
  const directory = urlParams.get("dir") || "/"
  
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
    directory
  }
}

// Global Message Emitter (simulates VS Code sending messages to the webview)
export function emitVsCodeMessage(message: ExtensionMessage) {
  window.postMessage(message, "*")
}

// Global state
const { client, directory } = getClient()

// Core Emulator Logic
export function setupEmulator() {
  console.log("[Zara UI] Setting up VS Code API Emulator...")
  
  // Expose the acquireVsCodeApi globally
  ;(window as any).acquireVsCodeApi = () => {
    return {
      postMessage: async (msg: any) => { // Type as any for now to bypass strict WebviewMessage type bounds
        console.log("[Emulator] Received outbound message:", msg.type, msg)
        
        try {
          switch (msg.type) {
            case "webviewReady": {
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
              break
            }
            case "requestWorkStyle": {
              emitVsCodeMessage({
                type: "workStyleLoaded",
                style: "skipped"
              })
              break
            }
            case "requestAgents": {
              const res = await client.app.agents()
              if (res.data) {
                emitVsCodeMessage({ 
                  type: "agentsLoaded", 
                  agents: res.data as any,
                  allAgents: res.data as any,
                  defaultAgent: "code" 
                })
              }
              break
            }
            case "requestProviders": {
              const res = await client.provider.list()
              if (res.data) {
                emitVsCodeMessage({
                  type: "providersLoaded",
                  providers: {} as any, // Needs proper mapping later if needed
                  connected: [] as any,
                  defaults: {},
                  defaultSelection: { providerID: "kilo-auto", modelID: "kilo-auto" } as any,
                  authMethods: {},
                  authStates: {}
                })
              }
              break
            }
            case "requestConfig": {
              const res = await client.config.overlay({ scope: "global" })
              if (res.data) {
                emitVsCodeMessage({
                  type: "configLoaded",
                  config: res.data.global as any,
                  features: {
                    indexing: true,
                    sandboxControls: true
                  }
                })
              }
              break
            }
            case "requestSessions": {
              const res = await client.experimental.session.list({ archived: false, limit: 50 })
              if (res.data) {
                emitVsCodeMessage({
                  type: "sessionsLoaded",
                  sessions: res.data as any
                })
              }
              break
            }
            case "requestNotifications": {
              emitVsCodeMessage({
                type: "notificationsLoaded",
                notifications: [],
                dismissedIds: []
              })
              break
            }
            case "requestModelSelectorExpanded": {
              emitVsCodeMessage({
                type: "modelSelectorExpandedLoaded",
                value: true
              })
              break
            }
            case "requestTimelineSetting": {
              emitVsCodeMessage({
                type: "timelineSettingLoaded",
                visible: false
              })
              break
            }
            case "requestAutocompleteSettings": {
              emitVsCodeMessage({
                type: "autocompleteSettingsLoaded",
                settings: {
                  enableAutoTrigger: false,
                  enableSmartInlineTaskKeybinding: false,
                  enableChatAutocomplete: false,
                  provider: null,
                  model: null,
                }
              })
              break
            }
            case "requestKiloEmbeddingModels": {
              emitVsCodeMessage({
                type: "kiloEmbeddingModelsLoaded",
                catalog: {} as any
              })
              break
            }
            case "requestMcpStatus": {
              emitVsCodeMessage({ type: "mcpStatusLoaded", status: {} as any })
              break
            }
            case "requestSkills": {
              emitVsCodeMessage({ type: "skillsLoaded", skills: [] as any })
              break
            }
            case "requestVariants": {
              emitVsCodeMessage({ type: "variantsLoaded", variants: {} as any })
              break
            }
            case "requestModelSelections": {
              emitVsCodeMessage({ type: "modelSelectionsLoaded", selections: {} as any })
              break
            }
            case "requestRecents": {
              emitVsCodeMessage({ type: "recentsLoaded", recents: [] })
              break
            }
            case "requestFavorites": {
              emitVsCodeMessage({ type: "favoritesLoaded", favorites: [] })
              break
            }
            case "sendMessage": {
              await (client as any).session.sendMessage({
                sessionID: msg.sessionID,
                directory,
                messageInput: {
                  role: "user",
                  content: msg.text,
                }
              })
              break
            }
            default:
              console.log("[Emulator] Mocking response for:", msg.type)
          }
        } catch (e) {
          console.error("[Emulator] Error handling message", msg.type, e)
        }
      },
      getState: () => undefined,
      setState: () => {},
    }
  }

  // Also setup SSE event streaming from kilo serve
  setupEventStream()
}

function setupEventStream() {
  const ctl = new AbortController()
  void (async () => {
    try {
      const events = await client.global.event({ signal: ctl.signal, sseMaxRetryAttempts: 0 })
      for await (const event of events.stream) {
        if (ctl.signal.aborted) return
        console.log("[Emulator] Received SSE event:", event)
        // Map Kilo serve SSE events back to VS Code Extension messages
        // e.g., if event is "session.status", emitVsCodeMessage({ type: "statusUpdated", ... })
      }
    } catch (e) {
      console.warn("[Emulator] Event stream error:", e)
    }
  })()
}
