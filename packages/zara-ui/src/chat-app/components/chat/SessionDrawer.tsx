/** @jsxImportSource solid-js */

import { Component, For, Show, createSignal, createMemo, onMount } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { formatRelativeDate } from "../../utils/date"
import type { SessionInfo } from "../../types/messages"

interface SessionDrawerProps {
  onSelectSession: (id: string) => void
  onNewSession: () => void
  open: boolean
  onClose: () => void
  width?: number
}

export const SessionDrawer: Component<SessionDrawerProps> = (props) => {
  const session = useSession()
  const language = useLanguage()
  const [filter, setFilter] = createSignal("")

  onMount(() => session.loadSessions())

  const filtered = createMemo(() => {
    const q = filter().toLowerCase().trim()
    const all = session.sessions().filter((s) => !s.parentID)
    if (!q) return all
    return all.filter((s) => (s.title || "").toLowerCase().includes(q))
  })

  const name = (s: SessionInfo) => s.title || language.t("session.untitled")

  const active = (s: SessionInfo) => session.currentSessionID() === s.id

  return (
    <>
      <div
        class="session-drawer"
        classList={{ "session-drawer--open": props.open }}
        style={props.width ? { width: `${props.width}px` } : undefined}
      >
        <div class="session-drawer-header">
          <span class="session-drawer-title">{language.t("session.tab.local")}</span>
          <IconButton
            icon="plus"
            size="small"
            variant="ghost"
            aria-label={language.t("command.session.new")}
            onClick={() => {
              props.onNewSession()
              props.onClose()
            }}
          />
        </div>
        <div class="session-drawer-search">
          <input
            type="text"
            placeholder={language.t("session.search.placeholder")}
            value={filter()}
            onInput={(e) => setFilter(e.currentTarget.value)}
            class="session-drawer-search-input"
          />
        </div>
        <div class="session-drawer-list">
          <Show
            when={filtered().length > 0}
            fallback={<div class="session-drawer-empty">{language.t("session.empty")}</div>}
          >
            <For each={filtered()}>
              {(s) => (
                <button
                  class="session-drawer-item"
                  classList={{ "session-drawer-item--active": active(s) }}
                  onClick={() => {
                    props.onSelectSession(s.id)
                    props.onClose()
                  }}
                  title={name(s)}
                  type="button"
                >
                  <span class="session-drawer-item-title">{name(s)}</span>
                  <span class="session-drawer-item-date">{formatRelativeDate(s.updatedAt)}</span>
                </button>
              )}
            </For>
          </Show>
        </div>
      </div>
      <Show when={props.open}>
        <div class="session-drawer-backdrop" onClick={() => props.onClose()} />
      </Show>
    </>
  )
}
