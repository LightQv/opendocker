import { DialogSelect, type DialogSelectOption } from "@/ui/dialog-select"
import { useApplication } from "@/context/application"
import { useDialog } from "@/ui/dialog"
import { type ShellSelection } from "@/util/config"
import ThemesDialog from "./themes"
import { useKeybind } from "@/context/keybind"

type SettingsValue = "shell.select" | "system.theme"

const SHELL_OPTIONS: DialogSelectOption<ShellSelection>[] = [
  {
    title: "auto",
    value: "auto",
    description: "bash -> zsh -> ash -> sh",
  },
  {
    title: "bash",
    value: "bash",
  },
  {
    title: "zsh",
    value: "zsh",
  },
  {
    title: "ash",
    value: "ash",
  },
  {
    title: "sh",
    value: "sh",
  },
]

export default function SettingsDialog() {
  const app = useApplication()
  const dialog = useDialog()
  const keybind = useKeybind()

  const options: DialogSelectOption<SettingsValue>[] = [
    {
      title: "Select shell",
      value: "shell.select",
      category: "Shell",
      footer: app.config.shell.selection,
    },
    {
      title: "Switch theme",
      value: "system.theme",
      category: "System",
      footer: keybind.print("theme_list"),
    },
  ]

  return (
    <DialogSelect
      title="Settings"
      options={options}
      onSelect={(option) => {
        if (option.value === "shell.select") {
          dialog.replace(() => <ShellSelectDialog />)
          return
        }

        if (option.value === "system.theme") {
          dialog.replace(() => <ThemesDialog title="Themes" />)
        }
      }}
    />
  )
}

function ShellSelectDialog() {
  const app = useApplication()
  const dialog = useDialog()

  return (
    <DialogSelect
      title="Select shell"
      options={SHELL_OPTIONS}
      current={app.config.shell.selection}
      onSelect={(option) => {
        app.setShellSelection(option.value)
        dialog.clear()
      }}
    />
  )
}
