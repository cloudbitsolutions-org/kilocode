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
      const { data: sessionList } = await client.session.listSessions()
      if (sessionList && sessionList.length > 0) {
        setActiveSessionId(sessionList[0].id)
      } else {
        const { data: newSession } = await client.session.createSession({})
        if (newSession) {
          setActiveSessionId(newSession.id)
        }
      }

      // Fetch messages for active session
      const sid = activeSessionId()
      if (sid) {
        const { data: msgs } = await client.message.listMessages({ path: { sessionId: sid } })
        if (msgs) {
          setStore(produce(s => {
            s.messages[sid] = msgs
          }))
          // Fetch parts for each message
          for (const m of msgs) {
            const { data: pts } = await client.part.listParts({ path: { sessionId: sid, messageId: m.id } })
            if (pts) {
              setStore(produce(s => {
                s.parts[m.id] = pts
              }))
            }
          }
        }
      }

      // Listen to SSE events
      const eventSource = client.event.subscribe() as unknown as EventSource
      eventSource.onmessage = (e) => {
        const ev = JSON.parse(e.data) as GlobalEvent
        if (ev.type === "messageAppended" || ev.type === "messageUpdated") {
          setStore(produce(s => {
            if (!s.messages[ev.sessionId]) s.messages[ev.sessionId] = []
            const idx = s.messages[ev.sessionId].findIndex(m => m.id === ev.message.id)
            if (idx === -1) {
              s.messages[ev.sessionId].push(ev.message as any)
            } else {
              s.messages[ev.sessionId][idx] = ev.message as any
            }
          }))
        } else if (ev.type === "partAppended" || ev.type === "partUpdated") {
          setStore(produce(s => {
            if (!s.parts[ev.messageId]) s.parts[ev.messageId] = []
            const idx = s.parts[ev.messageId].findIndex(p => p.id === ev.part.id)
            if (idx === -1) {
              s.parts[ev.messageId].push(ev.part as any)
            } else {
              s.parts[ev.messageId][idx] = ev.part as any
            }
          }))
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
                          turnID={msg.id}
                          message={msg}
                          isLast={i() === activeMessages().filter(m => m.role === "user").length - 1}
                        />
                      )}
                    </For>
                  </main>
                  <footer style={{ padding: "1rem", "border-top": "1px solid var(--color-border)" }}>
                    <PromptInput 
                      onSend={async (text) => {
                        const sid = activeSessionId()
                        if (!sid) return
                        await client.message.createMessage({
                          path: { sessionId: sid },
                          body: { content: [{ type: "text", text }] }
                        })
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
