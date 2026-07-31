/** @jsxImportSource solid-js */
import { For, Show, createMemo } from "solid-js"
import type { UserMessage } from "@kilocode/sdk/v2"
import { MessageNav } from "@kilocode/kilo-ui/message-nav"
import { useSession } from "../../context/session"

export function ChatMessageNav(props: {
  messages: UserMessage[]
  current?: UserMessage
  onMessageSelect: (message: UserMessage) => void
}) {
  const session = useSession()

  return (
    <MessageNav
      messages={props.messages}
      current={props.current}
      size="compact"
      onMessageSelect={props.onMessageSelect}
      getLabel={(m: UserMessage) => {
        if (m.summary?.title) return m.summary.title
        const parts = session.getParts(m.id)
        const text = parts?.find((p: any) => p.type === "text")
        if (text && "text" in text && text.text) return text.text.split("\n")[0]
        return "New Task"
      }}
    />
  )
}
