import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { decodePasteBytes, TextAttributes, type ParsedKey, type PasteEvent, type RGBA, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, usePaste } from "@opentui/solid"
import { useApplication } from "@/context/application"
import { useKeybind } from "@/context/keybind"
import { useTheme } from "@/context/theme"
import { useDialog } from "@/ui/dialog"
import { Pane } from "@/ui/pane"
import { ContainerShell, type ShellRow, type ShellRun, type ShellRunStyle } from "@/lib/container-shell"

const PASTE_CHUNK_SIZE = 8_192
const BRACKETED_PASTE_START = "\x1b[200~"
const BRACKETED_PASTE_END = "\x1b[201~"
type RenderColor = string | RGBA

export default function Shell() {
  const app = useApplication()
  const keybind = useKeybind()
  const dialog = useDialog()
  const theme = useTheme().theme
  const [scroll, setScroll] = createSignal<ScrollBoxRenderable>()
  const [terminalSize, setTerminalSize] = createSignal<{ cols: number, rows: number }>()
  const [leaderActive, setLeaderActive] = createSignal(false)
  const [followingShell, setFollowingShell] = createSignal(true)
  let removeViewportResize: (() => void) | undefined
  let measureTimer: ReturnType<typeof setTimeout> | undefined
  let leaderTimer: ReturnType<typeof setTimeout> | undefined
  let pasteTimer: ReturnType<typeof setTimeout> | undefined
  let pasteQueue = ""
  let pasteTargetContainerId: string | null = null
  let lastMaxScrollTop = 0
  let lastActiveContainerId: string | null = null
  let lastAlternate = false
  const snapshot = createMemo(() => {
    app.activeShellSession?.version
    const containerId = app.shell.activeContainerId
    if (!containerId) return undefined
    return ContainerShell.snapshot(containerId)
  })
  const shellVisible = createMemo(() => {
    const status = app.activeShellSession?.status
    return status === "opening" || status === "running"
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

  function setShellLeader(active: boolean) {
    if (leaderTimer) clearTimeout(leaderTimer)
    setLeaderActive(active)
    if (!active) return

    leaderTimer = setTimeout(() => setLeaderActive(false), 2000)
  }

  function getMaxScrollTop(scrollBox: ScrollBoxRenderable) {
    return Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height)
  }

  function scrollToBottom(scrollBox = scroll()) {
    if (!scrollBox) return

    scrollBox.stickyScroll = false
    scrollBox.scrollTo({ x: 0, y: scrollBox.scrollHeight })
    lastMaxScrollTop = getMaxScrollTop(scrollBox)
  }

  function resumeFollow() {
    setFollowingShell(true)
    queueMicrotask(() => scrollToBottom())
  }

  function normalizePaste(text: string) {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  }

  function clearPasteQueue() {
    if (pasteTimer) clearTimeout(pasteTimer)
    pasteTimer = undefined
    pasteQueue = ""
    pasteTargetContainerId = null
  }

  function flushPasteQueue() {
    pasteTimer = undefined

    if (!pasteTargetContainerId || !pasteQueue) {
      clearPasteQueue()
      return
    }

    if (!app.shellFocused || app.shell.activeContainerId !== pasteTargetContainerId) {
      clearPasteQueue()
      return
    }

    const chunk = pasteQueue.slice(0, PASTE_CHUNK_SIZE)
    pasteQueue = pasteQueue.slice(PASTE_CHUNK_SIZE)
    if (!ContainerShell.write(pasteTargetContainerId, chunk)) {
      clearPasteQueue()
      return
    }

    if (pasteQueue) {
      pasteTimer = setTimeout(flushPasteQueue, 0)
    } else {
      pasteTargetContainerId = null
    }
  }

  function writePaste(containerId: string, text: string) {
    const normalized = normalizePaste(text)
    if (!normalized) return

    const data = ContainerShell.bracketedPasteMode(containerId)
      ? `${BRACKETED_PASTE_START}${normalized}${BRACKETED_PASTE_END}`
      : normalized

    if (pasteTargetContainerId && pasteTargetContainerId !== containerId) {
      clearPasteQueue()
    }

    pasteTargetContainerId = containerId
    pasteQueue += data
    resumeFollow()

    if (!pasteTimer) {
      flushPasteQueue()
    }
  }

  useKeyboard(key => {
    if (!app.shellFocused) return
    if (dialog.stack.length > 0) return

    const containerId = app.shell.activeContainerId
    if (!containerId) return

    if (keybind.match("leader", key, false)) {
      key.preventDefault()
      setShellLeader(true)
      return
    }

    if (leaderActive() && keybind.match("container_shell_detach", key, true)) {
      key.preventDefault()
      setShellLeader(false)
      app.detachContainerShell()
      return
    }

    if (leaderActive() && keybind.match("container_shell_quit", key, true)) {
      key.preventDefault()
      setShellLeader(false)
      ContainerShell.quit(containerId)
      app.closeContainerShell(containerId)
      return
    }

    if (leaderActive()) {
      key.preventDefault()
      setShellLeader(false)
      return
    }

    const data = keyToData(key)
    if (!data) return

    key.preventDefault()
    resumeFollow()
    ContainerShell.write(containerId, data)
  })

  usePaste((event: PasteEvent) => {
    if (!app.shellFocused) return
    if (dialog.stack.length > 0) return

    const containerId = app.shell.activeContainerId
    if (!containerId) return

    event.preventDefault()
    event.stopPropagation()
    writePaste(containerId, decodePasteBytes(event.bytes))
  })

  function getScrollSize() {
    const scrollBox = scroll()
    if (!scrollBox) return undefined

    const viewport = scrollBox.viewport
    if (viewport.width < 20 || viewport.height < 5) return undefined

    return {
      cols: viewport.width,
      rows: viewport.height,
    }
  }

  function updateTerminalSize() {
    const size = getScrollSize()
    if (!size) return

    const current = terminalSize()
    if (current?.cols === size.cols && current.rows === size.rows) return

    setTerminalSize(size)
  }

  function setScrollRef(scrollBox: ScrollBoxRenderable) {
    removeViewportResize?.()
    setScroll(scrollBox)
    scrollBox.viewport.on("resize", updateTerminalSize)
    removeViewportResize = () => scrollBox.viewport.off("resize", updateTerminalSize)
    queueMicrotask(() => {
      updateTerminalSize()
      scrollToBottom(scrollBox)
    })
    measureTimer = setTimeout(() => {
      updateTerminalSize()
      scrollToBottom(scrollBox)
    }, 0)
  }

  onCleanup(() => {
    removeViewportResize?.()
    if (measureTimer) clearTimeout(measureTimer)
    if (leaderTimer) clearTimeout(leaderTimer)
    clearPasteQueue()
  })

  function hasShellState(containerId: string, generation: number) {
    return app.shell.sessions[containerId]?.generation === generation
  }

  createEffect(() => {
    const containerId = app.shell.activeContainerId
    if (containerId === lastActiveContainerId) return

    lastActiveContainerId = containerId
    lastMaxScrollTop = 0
    lastAlternate = false
    setFollowingShell(true)
    queueMicrotask(() => scrollToBottom())
  })

  createEffect(() => {
    const containerId = app.shell.activeContainerId
    const size = terminalSize()
    const generation = app.activeShellSession?.generation
    if (!containerId || !size || generation === undefined) return

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

    ContainerShell.create({
      containerId,
      cols: size.cols,
      rows: size.rows,
      onRender: () => {
        if (!hasShellState(containerId, generation)) return
        app.bumpContainerShellVersion(containerId)
      },
      onExit: () => {
        if (!hasShellState(containerId, generation)) return
        app.markContainerShell(containerId, "exited", null)
      },
      onError: error => {
        if (!hasShellState(containerId, generation)) return
        app.markContainerShell(containerId, "error", error.message)
      },
    }).then(() => {
      if (!hasShellState(containerId, generation)) return
      app.markContainerShell(containerId, "running", null)
    }).catch(error => {
      if (!hasShellState(containerId, generation)) return
      if (error instanceof Error && error.message === "Shell creation cancelled") return
      app.markContainerShell(containerId, "error", error instanceof Error ? error.message : String(error))
    })
  })

  createEffect(() => {
    const current = snapshot()
    const scrollBox = scroll()
    if (!scrollBox || !current) return

    if (current.alternate !== lastAlternate) {
      lastAlternate = current.alternate
      setFollowingShell(true)
      scrollToBottom(scrollBox)
      return
    }

    const previousMaxScrollTop = lastMaxScrollTop
    const wasAtBottom = scrollBox.scrollTop >= previousMaxScrollTop - 1
    const userScrolledUp = scrollBox.scrollTop < previousMaxScrollTop - 1

    if (userScrolledUp) {
      setFollowingShell(false)
    }

    if (followingShell() || wasAtBottom) {
      setFollowingShell(true)
      scrollToBottom(scrollBox)
      return
    }

    scrollBox.stickyScroll = false
    lastMaxScrollTop = getMaxScrollTop(scrollBox)
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

  function attributesFor(style: ShellRunStyle) {
    let attributes = TextAttributes.NONE
    if (style.bold) attributes |= TextAttributes.BOLD
    if (style.dim) attributes |= TextAttributes.DIM
    if (style.italic) attributes |= TextAttributes.ITALIC
    if (style.underline) attributes |= TextAttributes.UNDERLINE
    if (style.blink) attributes |= TextAttributes.BLINK
    if (style.hidden) attributes |= TextAttributes.HIDDEN
    if (style.strikethrough) attributes |= TextAttributes.STRIKETHROUGH
    return attributes
  }

  function resolveRunColors(style: ShellRunStyle): { fg?: RenderColor, bg?: RenderColor } {
    if (!style.inverse) {
      return {
        fg: style.fg,
        bg: style.bg,
      }
    }

    return {
      fg: style.bg ?? theme.backgroundPanel,
      bg: style.fg ?? theme.text,
    }
  }

  function resolveCursorColors(style: ShellRunStyle): { fg: RenderColor, bg: RenderColor } {
    const colors = resolveRunColors(style)
    return {
      fg: colors.bg ?? theme.backgroundPanel,
      bg: colors.fg ?? theme.text,
    }
  }

  function renderRun(run: ShellRun, text = run.text, cursor = false) {
    const colors = cursor ? resolveCursorColors(run.style) : resolveRunColors(run.style)

    return (
      <span
        style={{
          fg: colors.fg,
          bg: colors.bg,
          attributes: attributesFor(run.style),
        }}
      >
        {text}
      </span>
    )
  }

  function splitRunText(run: ShellRun, cursorColumn: number) {
    const cursorIndex = run.text.length === run.columns
      ? cursorColumn
      : Math.min(cursorColumn, run.text.length)

    return {
      before: run.text.slice(0, cursorIndex),
      cursor: run.text.slice(cursorIndex, cursorIndex + 1) || " ",
      after: run.text.slice(cursorIndex + 1),
    }
  }

  function renderLine(line: ShellRow, lineIndex: number) {
    const current = snapshot()
    if (!current || current.cursorY !== lineIndex) {
      return line.map(run => renderRun(run))
    }

    const rendered = []
    let cursorRendered = false
    let column = 0

    for (let index = 0; index < line.length; index += 1) {
      const run = line[index]!
      const nextColumn = column + run.columns

      if (!cursorRendered && current.cursorX >= column && current.cursorX < nextColumn) {
        const split = splitRunText(run, current.cursorX - column)
        if (split.before) {
          rendered.push(renderRun(run, split.before))
        }
        rendered.push(renderRun(run, split.cursor, true))
        if (split.after) {
          rendered.push(renderRun(run, split.after))
        }
        cursorRendered = true
      } else {
        rendered.push(renderRun(run))
      }

      column = nextColumn
    }

    if (!cursorRendered) {
      rendered.push(
        <span style={{ fg: theme.backgroundPanel, bg: theme.text, attributes: TextAttributes.NONE }}> </span>,
      )
    }

    return rendered
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
          <Match when={shellVisible()}>
            <scrollbox
              ref={setScrollRef}
              scrollY={true}
              stickyScroll={false}
              stickyStart="bottom"
              flexGrow={1}
              flexShrink={1}
              width="100%"
            >
              <box width="100%" flexDirection="column">
                <Show when={terminalSize()} fallback={<text fg={theme.textMuted}>Preparing shell...</text>}>
                  <Show when={snapshot()} fallback={<text fg={theme.textMuted}>Opening shell...</text>}>
                    <For each={snapshot()?.rows ?? []}>
                      {(line, index) => (
                        <box width="100%" flexShrink={0}>
                          <text width="100%" fg={theme.text} wrapMode="none">{renderLine(line, index())}</text>
                        </box>
                      )}
                    </For>
                  </Show>
                </Show>
              </box>
            </scrollbox>
          </Match>
        </Switch>
      </box>
    </Pane>
  )
}
