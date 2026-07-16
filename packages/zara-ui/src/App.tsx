import { createSignal, createMemo, onMount, For, Show } from "solid-js"
import { createStore, reconcile, produce } from "solid-js/store"
import { createKiloClient } from "@kilocode/sdk/v2/client"
import type { Session, Message, Part, GlobalEvent } from "@kilocode/sdk/v2/client"
import { ThemeProvider } from "@kilocode/kilo-ui/theme/context"
import { DataProvider } from "@kilocode/kilo-ui/context/data"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { FileComponentProvider } from "@kilocode/kilo-ui/context/file"
import { Code } from "@kilocode/kilo-ui/code"
import { Diff } from "@kilocode/kilo-ui/diff"
import { File } from "@kilocode/kilo-ui/file"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { SessionTurn } from "@kilocode/kilo-ui/session-turn"
// @ts-expect-error missing types for styles
import "@kilocode/kilo-ui/styles"

function PromptInput(props: { onSend: (text: string) => void; placeholder?: string }) {
  const [text, setText] = createSignal("")
  return (
    <div style={{ display: "flex", gap: "0.5rem" }}>
      <input
        type="text"
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            if (text().trim()) {
              props.onSend(text())
              setText("")
            }
          }
        }}
        placeholder={props.placeholder}
        style={{ flex: 1, padding: "0.5rem", "border-radius": "0.25rem", border: "1px solid var(--color-border)", background: "transparent", color: "inherit" }}
      />
      <Button onClick={() => {
        if (text().trim()) {
          props.onSend(text())
          setText("")
        }
      }}>Send</Button>
    </div>
  )
}

export default function App() {
  const client = createKiloClient({
    baseUrl: window.location.origin,
  })

  const [store, setStore] = createStore<{
    sessions: Record<string, Session>
    messages: Record<string, Message[]>
    parts: Record<string, Part[]>
    status: Record<string, any>
  }>({
    sessions: {},
    messages: {},
    parts: {},
    status: {},
  })

  const [activeSessionId, setActiveSessionId] = createSignal<string | null>(null)

  onMount(async () => {
    try {
      const { data: sessionList } = await client.session.list()
      if (sessionList && sessionList.length > 0) {
        setActiveSessionId(sessionList[0].id)
      } else {
        // @ts-expect-error start does not exist
        const { data: newSession } = await client.session.start({})
        if (newSession) {
          setActiveSessionId(newSession.id)
        }
      }

      // Fetch messages for active session
      const sid = activeSessionId()
      if (sid) {
        const msgsData = await client.session.messages({ sessionID: sid })
        const msgs = msgsData.data
        if (msgs) {
          setStore(produce(s => {
            s.messages[sid] = msgs as any[]
          }))
          // Parts are assumed to be loaded with messages or via SSE
        }
      }

      // Listen to SSE events
      const eventSource = client.event.subscribe() as unknown as EventSource
      eventSource.onmessage = (e) => {
        const ev = JSON.parse(e.data) as GlobalEvent
        const payload = ev.payload
        if ("type" in payload) {
          if (payload.type === "message.updated") {
            const msgInfo = payload.properties.info
            setStore(produce(s => {
              if (!s.messages[payload.properties.sessionID]) s.messages[payload.properties.sessionID] = []
              const idx = s.messages[payload.properties.sessionID].findIndex(m => m.id === msgInfo.id)
              if (idx === -1) {
                s.messages[payload.properties.sessionID].push(msgInfo as any)
              } else {
                s.messages[payload.properties.sessionID][idx] = msgInfo as any
              }
            }))
          } else if (payload.type === "message.part.updated") {
            const partInfo = payload.properties.part
            setStore(produce(s => {
              const msgId = partInfo.messageID
              if (!s.parts[msgId]) s.parts[msgId] = []
              const idx = s.parts[msgId].findIndex(p => p.id === partInfo.id)
              if (idx === -1) {
                s.parts[msgId].push(partInfo as any)
              } else {
                s.parts[msgId][idx] = partInfo as any
              }
            }))
          }
        }
      }
    } catch (e) {
      console.error("Failed to init", e)
    }
  })

  const dataBridge = {
    get session() { return Object.values(store.sessions) },
    get session_status() { return store.status },
    get session_diff() { return {} },
    get message() { return store.messages },
    get part() { return store.parts },
    get permission() { return {} },
    get question() { return {} },
    get provider() { return { all: new Map(), connected: [], default: {} } }
  }

  const activeMessages = createMemo(() => {
    const sid = activeSessionId()
    if (!sid) return []
    return store.messages[sid] || []
  })

  return (
    <ThemeProvider defaultTheme="system">
      <DataProvider data={dataBridge} directory="/">
        <MarkedProvider>
          <DiffComponentProvider component={Diff}>
            <CodeComponentProvider component={Code}>
              <FileComponentProvider component={File}>
                <div style={{ display: "flex", "flex-direction": "column", height: "100vh", "background-color": "var(--color-bg)" }}>
                  <header style={{ padding: "1rem", "border-bottom": "1px solid var(--color-border)" }}>
                    <h3>Zara Assistant</h3>
                  </header>
                  <main style={{ flex: 1, overflow: "auto", padding: "1rem" }}>
                    <For each={activeMessages().filter(m => m.role === "user")}>
                      {(msg, i) => (
                        <SessionTurn
                          sessionID={activeSessionId()!}
                          messageID={msg.id}
                        />
                      )}
                    </For>
                  </main>
                  <footer style={{ padding: "1rem", "border-top": "1px solid var(--color-border)" }}>
                    <PromptInput 
                      onSend={async (text) => {
                        const sid = activeSessionId()
                        if (!sid) return
                        await client.session.prompt({
                          sessionID: sid,
                          prompt: { text }
                        } as any)
                      }}
                      placeholder="Ask Zara..."
                    />
                  </footer>
                </div>
              </FileComponentProvider>
            </CodeComponentProvider>
          </DiffComponentProvider>
        </MarkedProvider>
      </DataProvider>
    </ThemeProvider>
  )
}
