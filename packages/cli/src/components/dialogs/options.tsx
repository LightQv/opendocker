import { DialogSelect, type DialogSelectOption } from "@/ui/dialog-select"
import { useApplication } from "@/context/application"
import { useDialog } from "@/ui/dialog"
import { type ShellSelection } from "@/util/config"

type OptionsValue = "shell.select"

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

export default function OptionsDialog() {
  const app = useApplication()
  const dialog = useDialog()

  const options: DialogSelectOption<OptionsValue>[] = [
    {
      title: "Select shell",
      value: "shell.select",
      category: "Shell",
      footer: app.config.shell.selection,
    },
  ]

  return (
    <DialogSelect
      title="Options"
      options={options}
      onSelect={(option) => {
        if (option.value === "shell.select") {
          dialog.replace(() => <ShellSelectDialog />)
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
