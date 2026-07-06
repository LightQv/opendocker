import { createEffect, createMemo, createSignal, For, Match, Switch } from "solid-js"
import type { ParsedKey, ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useApplication } from "@/context/application"
import { useKeybind } from "@/context/keybind"
import { useTheme } from "@/context/theme"
import { useDialog } from "@/ui/dialog"
import { Pane } from "@/ui/pane"
import { ContainerShell } from "@/lib/container-shell"

const DEFAULT_SHELL = "sh"

export default function Shell() {
  const app = useApplication()
  const keybind = useKeybind()
  const dialog = useDialog()
  const theme = useTheme().theme
  const [scroll, setScroll] = createSignal<ScrollBoxRenderable>()
  const lines = createMemo(() => app.activeShellSession?.output.split("\n") ?? [])

  function keyToData(key: ParsedKey): string | null {
    if (key.name === "return" || key.name === "enter") return "\n"
    if (key.name === "backspace") return "\x7f"
    if (key.name === "tab") return "\t"
    if (key.name === "up") return "\x1b[A"
    if (key.name === "down") return "\x1b[B"
    if (key.name === "right") return "\x1b[C"
    if (key.name === "left") return "\x1b[D"

    const sequence = (key as ParsedKey & { sequence?: string }).sequence
    if (sequence) return sequence
    if (key.name.length === 1) return key.name
    return null
  }

  useKeyboard(key => {
    if (!app.shellFocused) return
    if (dialog.stack.length > 0) return

    const containerId = app.shell.activeContainerId
    if (!containerId) return

    if (keybind.match("leader", key)) {
      key.preventDefault()
      return
    }

    if (keybind.match("container_shell_detach", key)) {
      key.preventDefault()
      app.detachContainerShell()
      return
    }

    if (keybind.match("container_shell_quit", key)) {
      key.preventDefault()
      ContainerShell.quit(containerId)
      app.closeContainerShell(containerId)
      return
    }

    const data = keyToData(key)
    if (!data) return

    key.preventDefault()
    ContainerShell.write(containerId, data)
  })

  createEffect(() => {
    const containerId = app.shell.activeContainerId
    if (!containerId) return

    const container = app.containers.find(item => item.id === containerId)
    if (!container) {
      app.markContainerShell(containerId, "error", "Container not found")
      return
    }

    if (container.state !== "running") {
      ContainerShell.quit(containerId)
      app.markContainerShell(containerId, "error", "Container must be running")
      return
    }

    if (ContainerShell.get(containerId)) return

    ContainerShell.create({
      containerId,
      shell: DEFAULT_SHELL,
      cols: Math.max(20, scroll()?.width ?? 80),
      rows: Math.max(5, scroll()?.height ?? 24),
      onData: data => app.appendContainerShellOutput(containerId, data),
      onExit: () => app.markContainerShell(containerId, "exited", null),
      onError: error => app.markContainerShell(containerId, "error", error.message),
    }).then(() => {
      app.markContainerShell(containerId, "running", null)
    }).catch(error => {
      app.markContainerShell(containerId, "error", error instanceof Error ? error.message : String(error))
    })
  })

  createEffect(() => {
    lines()
    const scrollBox = scroll()
    if (!scrollBox) return
    scrollBox.scrollTo({ x: 0, y: scrollBox.scrollHeight })
    scrollBox.stickyScroll = true
  })

  return (
    <Pane
      width="100%"
      flexGrow={1}
      height="100%"
      borderColor={() => app.shellFocused ? theme.border : theme.backgroundPanel}
    >
      <box paddingLeft={1} paddingRight={1} flexGrow={1} flexShrink={1} flexDirection="column">
        <Switch>
          <Match when={!app.shell.activeContainerId}>
            <text fg={theme.textMuted}>Open a container shell with {keybind.print("container_shell")}</text>
          </Match>
          <Match when={app.activeShellSession?.status === "error"}>
            <text fg={theme.error}>{app.activeShellSession?.error ?? "Failed to start shell"}</text>
          </Match>
          <Match when={app.activeShellSession?.status === "exited"}>
            <text fg={theme.textMuted}>Shell exited</text>
          </Match>
          <Match when={app.activeShellSession?.status === "running"}>
            <scrollbox
              ref={(r: ScrollBoxRenderable) => setScroll(r)}
              scrollY={true}
              stickyScroll={true}
              stickyStart="bottom"
              flexGrow={1}
              flexShrink={1}
            >
              <box flexDirection="column">
                <For each={lines()}>
                  {(line) => (
                    <box flexShrink={0}>
                      <text fg={theme.textMuted}>{line}</text>
                    </box>
                  )}
                </For>
              </box>
            </scrollbox>
          </Match>
        </Switch>
      </box>
    </Pane>
  )
}
