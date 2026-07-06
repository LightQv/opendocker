import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@/context/theme"
import { useDialog } from "@/ui/dialog"

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

  function cancel() {
    props.onCancel?.()
    dialog.clear()
  }

  function confirm() {
    dialog.clear()
    props.onConfirm()
  }

  useKeyboard((evt) => {
    if (evt.name === "return" || evt.name === "y") {
      evt.preventDefault()
      evt.stopPropagation()
      confirm()
      return
    }

    if (evt.name === "n") {
      evt.preventDefault()
      evt.stopPropagation()
      cancel()
    }
  })

  return (
    <box gap={1} paddingLeft={4} paddingRight={4} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={props.danger ? theme.error : theme.text} attributes={TextAttributes.BOLD}>
          {props.title}
        </text>
        <text fg={theme.textMuted} onMouseUp={cancel}>
          esc
        </text>
      </box>
      <text fg={theme.textMuted}>{props.message}</text>
      <box flexDirection="row" justifyContent="space-between" paddingTop={1}>
        <box flexDirection="row" gap={2}>
          <text>
            <span style={{ fg: theme.text }}>enter/y </span>
            <span style={{ fg: props.danger ? theme.error : theme.textMuted }}>
              {confirmLabel().toLowerCase()}
            </span>
          </text>
          <text>
            <span style={{ fg: theme.text }}>n/esc </span>
            <span style={{ fg: theme.textMuted }}>{cancelLabel().toLowerCase()}</span>
          </text>
        </box>
      </box>
    </box>
  )
}
