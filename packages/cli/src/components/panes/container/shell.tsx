import { createEffect, createMemo, createSignal, For, Match, Switch } from "solid-js"
import type { ParsedKey, ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useApplication } from "@/context/application"
import { useKeybind } from "@/context/keybind"
import { useTheme } from "@/context/theme"
import { useDialog } from "@/ui/dialog"
import { Pane } from "@/ui/pane"
import { ContainerShell } from "@/lib/container-shell"

export default function Shell() {
  const app = useApplication()
  const keybind = useKeybind()
  const dialog = useDialog()
  const theme = useTheme().theme
  const [scroll, setScroll] = createSignal<ScrollBoxRenderable>()
  const [terminalSize, setTerminalSize] = createSignal<{ cols: number, rows: number }>()
  const snapshot = createMemo(() => {
    app.activeShellSession?.version
    const containerId = app.shell.activeContainerId
    if (!containerId) return undefined
    return ContainerShell.snapshot(containerId)
  })

  function keyToData(key: ParsedKey): string | null {
    if (key.name === "return" || key.name === "enter") return "\n"
    if (key.name === "backspace") return "\x7f"
    if (key.name === "tab") return "\t"
    if (key.name === "up") return "\x1b[A"
    if (key.name === "down") return "\x1b[B"
    if (key.name === "right") return "\x1b[C"
    if (key.name === "left") return "\x1b[D"

    if (key.ctrl && key.name.length === 1) {
      const code = key.name.toUpperCase().charCodeAt(0) - 64
      if (code > 0 && code < 32) return String.fromCharCode(code)
    }

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

  function getScrollSize() {
    const scrollBox = scroll()
    if (!scrollBox) return undefined

    return {
      cols: Math.max(20, scrollBox.width - 1),
      rows: Math.max(5, scrollBox.height),
    }
  }

  createEffect(() => {
    const size = getScrollSize()
    if (!size) return

    const current = terminalSize()
    if (current?.cols === size.cols && current.rows === size.rows) return

    setTerminalSize(size)
  })

  createEffect(() => {
    const containerId = app.shell.activeContainerId
    const size = terminalSize()
    if (!containerId || !size) return

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
      cols: size.cols,
      rows: size.rows,
      onRender: () => app.bumpContainerShellVersion(containerId),
      onExit: () => app.markContainerShell(containerId, "exited", null),
      onError: error => app.markContainerShell(containerId, "error", error.message),
    }).then(() => {
      app.markContainerShell(containerId, "running", null)
    }).catch(error => {
      app.markContainerShell(containerId, "error", error instanceof Error ? error.message : String(error))
    })
  })

  createEffect(() => {
    snapshot()
    const scrollBox = scroll()
    if (!scrollBox) return
    scrollBox.scrollTo({ x: 0, y: scrollBox.scrollHeight })
    scrollBox.stickyScroll = true
  })

  createEffect(() => {
    const containerId = app.shell.activeContainerId
    const size = terminalSize()
    if (!containerId || !size) return

    ContainerShell.resize(
      containerId,
      size.cols,
      size.rows,
    )
  })

  function renderLine(line: string, lineIndex: number) {
    const current = snapshot()
    if (!current || current.cursorY !== lineIndex) return line

    const cursorX = current.cursorX
    const padded = line.padEnd(cursorX + 1, " ")
    const before = padded.slice(0, cursorX)
    const cursor = padded[cursorX] || " "
    const after = padded.slice(cursorX + 1)

    return [
      before,
      <span style={{ fg: theme.backgroundPanel, bg: theme.text }}>{cursor}</span>,
      after,
    ]
  }

  return (
    <Pane
      width="100%"
      flexGrow={1}
      height="100%"
      borderColor={() => app.shellFocused ? theme.border : theme.backgroundPanel}
    >
      <box width="100%" paddingLeft={1} paddingRight={1} flexGrow={1} flexShrink={1} flexDirection="column">
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
              width="100%"
            >
              <box width="100%" flexDirection="column">
                <For each={snapshot()?.rows ?? []}>
                  {(line, index) => (
                    <box width="100%" flexShrink={0}>
                      <text width="100%" fg={theme.textMuted} wrapMode="none">{renderLine(line, index())}</text>
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
