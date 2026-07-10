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
            case "requestAgents": {
              const res = await client.app.agents()
              if (res.data) {
                emitVsCodeMessage({ 
                  type: "agentsLoaded", 
                  agents: res.data as any,
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
                  providers: {} as any, // Mapped in future
                  connected: [] as any
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
                  features: {}
                })
              }
              break
            }
            case "requestSessions": {
              // Note: the v2 SDK uses experimental.session.list for listing sessions
              const res = await client.experimental.session.list({ archived: false, limit: 50 })
              if (res.data) {
                emitVsCodeMessage({
                  type: "sessionsLoaded",
                  sessions: res.data as any
                })
              }
              break
            }
            case "sendMessage": {
              // First, send the initial message via the API
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
