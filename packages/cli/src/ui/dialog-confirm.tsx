import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@/context/theme"
import { useDialog } from "@/ui/dialog"
import { createStore } from "solid-js/store"
import { For } from "solid-js"

export function DialogConfirm(props: {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel?: () => void
}) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const confirmLabel = () => props.confirmLabel ?? "Confirm"
  const cancelLabel = () => props.cancelLabel ?? "Cancel"
  const [store, setStore] = createStore({
    active: "confirm" as "confirm" | "cancel",
  })

  function cancel() {
    props.onCancel?.()
    dialog.clear()
  }

  function confirm() {
    props.onConfirm()
    dialog.clear()
  }

  function select() {
    if (store.active === "confirm") confirm()
    else cancel()
  }

  function toggle() {
    setStore("active", store.active === "confirm" ? "cancel" : "confirm")
  }

  useKeyboard((evt) => {
    if (evt.name === "return") {
      evt.preventDefault()
      evt.stopPropagation()
      select()
      return
    }

    if (evt.name === "left" || evt.name === "right") {
      evt.preventDefault()
      evt.stopPropagation()
      toggle()
    }
  })

  return (
    <box gap={1} paddingLeft={2} paddingRight={2}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={props.danger ? theme.error : theme.text} attributes={TextAttributes.BOLD}>
          {props.title}
        </text>
        <text fg={theme.textMuted} onMouseUp={cancel}>
          esc
        </text>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.textMuted}>{props.message}</text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <For each={["cancel", "confirm"] as const}>
          {(key) => {
            const active = () => key === store.active
            const label = () => key === "cancel" ? cancelLabel() : confirmLabel()
            return (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={active() ? theme.primary : undefined}
                onMouseUp={() => {
                  if (key === "confirm") confirm()
                  else cancel()
                }}
              >
                <text fg={active() ? theme.selectedListItemText : theme.textMuted}>
                  {label()}
                </text>
              </box>
            )
          }}
        </For>
      </box>
    </box>
  )
}
