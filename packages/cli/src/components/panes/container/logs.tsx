import { createEffect, createMemo, createSignal, onCleanup, Switch, Match, For } from "solid-js"
import { Renderable, ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useApplication } from "@/context/application"
import { Pane } from "@/ui/pane"
import { stripANSI } from "bun"
import { tint, useTheme } from "@/context/theme"
import { Clipboard } from "@/util/clipboard"
import { useToast } from "@/ui/toast"

export default function Logs() {
  const app = useApplication()
  const theme = useTheme().theme
  const toast = useToast()
  const [logs, setLogs] = createSignal<string>("")
  const [tempLogs, setTempLogs] = createSignal<string>("")
  const [paused, setPaused] = createSignal<boolean>(false)
  const [scroll, setScroll] = createSignal<ScrollBoxRenderable>()
  const [cursorLine, setCursorLine] = createSignal<number>(0)
  const [selectionStart, setSelectionStart] = createSignal<number | null>(null)
  const [pendingKey, setPendingKey] = createSignal<"g" | "y" | null>(null)
  const [followingLogs, setFollowingLogs] = createSignal<boolean>(true)
  const activeFilter = () => {
    const activeContainer = app.activeContainer
    return activeContainer ? app.filters[activeContainer] || "" : ""
  }
  const activeSearch = () => {
    const activeContainer = app.activeContainer
    return activeContainer ? app.searches[activeContainer] || "" : ""
  }
  const searchIndex = () => {
    const activeContainer = app.activeContainer
    return activeContainer ? app.searchIndexes[activeContainer] || 0 : 0
  }
  const searchMatches = createMemo(() => {
    const query = activeSearch().trim().toLowerCase()
    if (!query) return []

    const lines = logs().split("\n")
    const matches: number[] = []
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].toLowerCase().includes(query)) {
        matches.push(index)
      }
    }

    return matches
  })
  const logLines = createMemo(() => logs().split("\n"))

  function setSearchIndex(index: number) {
    const activeContainer = app.activeContainer
    if (!activeContainer) return

    const matches = searchMatches()
    if (matches.length === 0) {
      app.setContainerSearchIndex(activeContainer, 0)
      return
    }

    const nextIndex = ((index % matches.length) + matches.length) % matches.length
    app.setContainerSearchIndex(activeContainer, nextIndex)
  }

  function clampLine(line: number) {
    return Math.max(0, Math.min(line, logLines().length - 1))
  }

  function findChildById(root: Renderable, id: string): Renderable | undefined {
    for (const child of root.getChildren()) {
      if (child.id === id) return child
      const found = findChildById(child, id)
      if (found) return found
    }
  }

  function scrollToLine(line: number, center = false) {
    const scrollBox = scroll()
    if (!scrollBox) return
    const target = findChildById(scrollBox, `log-line-${line}`)
    if (!target) {
      scrollBox.scrollTo(line)
      return
    }

    const y = target.y - scrollBox.y
    if (center) {
      scrollBox.scrollBy(y - Math.floor(scrollBox.height / 2))
      return
    }

    if (y >= scrollBox.height) {
      scrollBox.scrollBy(y - scrollBox.height + 1)
      return
    }

    if (y < 0) {
      scrollBox.scrollBy(y)
    }
  }

  function moveCursor(delta: number) {
    setFollowingLogs(false)
    setCursorLine(line => {
      const next = clampLine(line + delta)
      scrollToLine(next)
      return next
    })
  }

  function goToLine(line: number, follow = false) {
    const next = clampLine(line)
    setFollowingLogs(follow)
    setCursorLine(next)
    if (follow) {
      const scrollBox = scroll()
      if (scrollBox) {
        scrollBox.scrollTo({ x: 0, y: scrollBox.scrollHeight })
        scrollBox.stickyScroll = true
      }
      return
    }

    const scrollBox = scroll()
    if (scrollBox && next === 0) {
      scrollBox.scrollTo(0)
      return
    }

    scrollToLine(next)
  }

  function copyText(text: string, message: string) {
    Clipboard.copy(text)
      .then(() => toast.show({ message, variant: "info" }))
      .catch(toast.error)
  }

  function copyCurrentLine() {
    const line = logLines()[cursorLine()]
    if (line === undefined) return
    copyText(line, "Copied log line")
  }

  function copySelection() {
    const start = selectionStart()
    if (start === null) return
    const from = Math.min(start, cursorLine())
    const to = Math.max(start, cursorLine())
    copyText(logLines().slice(from, to + 1).join("\n"), `Copied ${to - from + 1} log lines`)
    setSelectionStart(null)
  }

  function copyAllLogs() {
    copyText(logs(), "Copied all loaded logs")
  }

  useKeyboard(key => {
    if (app.activePane !== "containers") {
      return
    }

    if (app.logNavigationActive) {
      const halfPage = Math.max(1, Math.floor((scroll()?.height ?? 10) / 2))

      if (key.name === "escape") {
        key.preventDefault()
        if (selectionStart() !== null) {
          setSelectionStart(null)
          return
        }
        if (app.logsFocused) {
          app.unfocusContainerLogs()
          return
        }
        app.stopContainerSearch()
        return
      }

      if (key.name === "/") {
        key.preventDefault()
        app.startContainerSearch()
        return
      }

      if (activeSearch().trim().length > 0) {
        if (key.name === "n" && !key.shift) {
          key.preventDefault()
          setSearchIndex(searchIndex() + 1)
          return
        }

        if ((key.name === "n" && key.shift) || key.name === "N") {
          key.preventDefault()
          setSearchIndex(searchIndex() - 1)
          return
        }
      }

      if (key.name === "v") {
        key.preventDefault()
        setPendingKey(null)
        setSelectionStart(start => start === null ? cursorLine() : null)
        return
      }

      if ((key.name === "y" && key.shift) || key.name === "Y") {
        key.preventDefault()
        setPendingKey(null)
        copyAllLogs()
        return
      }

      if (key.name === "y") {
        key.preventDefault()
        if (selectionStart() !== null) {
          copySelection()
          setPendingKey(null)
          return
        }
        if (pendingKey() === "y") {
          copyCurrentLine()
          setPendingKey(null)
          return
        }
        setPendingKey("y")
        return
      }

      if ((key.name === "g" && key.shift) || key.name === "G") {
        key.preventDefault()
        setPendingKey(null)
        goToLine(logLines().length - 1, true)
        return
      }

      if (key.name === "g" && !key.shift) {
        key.preventDefault()
        if (pendingKey() === "g") {
          setPendingKey(null)
          goToLine(0)
          return
        }
        setPendingKey("g")
        return
      }

      setPendingKey(null)

      if (key.name === "j" || key.name === "down") {
        key.preventDefault()
        moveCursor(1)
        return
      }

      if (key.name === "k" || key.name === "up") {
        key.preventDefault()
        moveCursor(-1)
        return
      }

      if (key.name === "d" && key.ctrl) {
        key.preventDefault()
        moveCursor(halfPage)
        return
      }

      if (key.name === "u" && key.ctrl) {
        key.preventDefault()
        moveCursor(-halfPage)
        return
      }

      return
    }

    if (app.filtering || app.editingSearch) {
      return
    }

    if (app.containerListMode === "containers" && app.searching && activeSearch().trim().length > 0) {
      if (key.name === "n" && !key.shift) {
        key.preventDefault()
        setSearchIndex(searchIndex() + 1)
        return
      }

      if ((key.name === "n" && key.shift) || key.name === "N") {
        key.preventDefault()
        setSearchIndex(searchIndex() - 1)
        return
      }
    }

    if (key.name === "p") {
      setPaused(true)
    }

    if (key.name === "r") {
      setLogs(prev => prev + tempLogs())
      setTempLogs("")
      const scrollBox = scroll()
      if (scrollBox) {
        scrollBox.scrollTo({ x: 0, y: scrollBox.scrollHeight })
        scrollBox.stickyScroll = true
      }
      setPaused(false)
    }
  })

  createEffect(() => {
    const activeContainer = app.activeContainer
    if (!activeContainer) return

    const matches = searchMatches()
    app.setContainerSearchMatchCount(activeContainer, matches.length)

    if (matches.length === 0) {
      app.setContainerSearchIndex(activeContainer, 0)
      return
    }

    if (searchIndex() >= matches.length) {
      app.setContainerSearchIndex(activeContainer, matches.length - 1)
    }
  })

  createEffect(() => {
    if (!app.logNavigationActive) {
      setSelectionStart(null)
      setPendingKey(null)
      return
    }

    if (followingLogs()) {
      setCursorLine(clampLine(logLines().length - 1))
    } else {
      setCursorLine(line => clampLine(line))
    }
  })

  function isSelectedLine(lineIndex: number) {
    const start = selectionStart()
    if (start === null) return false
    const from = Math.min(start, cursorLine())
    const to = Math.max(start, cursorLine())
    return lineIndex >= from && lineIndex <= to
  }

  function renderLogLine(line: string, lineIndex: number) {
    const query = activeSearch().trim()
    if ((!app.searching && !app.logNavigationActive) || query.length === 0) {
      return line
    }

    const lowerLine = line.toLowerCase()
    const lowerQuery = query.toLowerCase()
    const firstMatch = lowerLine.indexOf(lowerQuery)
    if (firstMatch === -1) {
      return line
    }

    const activeLine = searchMatches()[searchIndex()] === lineIndex
    const matchBg = activeLine ? theme.warning : tint(theme.backgroundPanel, theme.warning, 0.25)
    const matchFg = activeLine ? theme.background : theme.text
    const parts = []
    let cursor = 0
    let matchIndex = firstMatch

    while (matchIndex !== -1) {
      if (matchIndex > cursor) {
        parts.push(line.slice(cursor, matchIndex))
      }

      parts.push(
        <span style={{ fg: matchFg, bg: matchBg }}>
          {line.slice(matchIndex, matchIndex + query.length)}
        </span>
      )

      cursor = matchIndex + query.length
      matchIndex = lowerLine.indexOf(lowerQuery, cursor)
    }

    if (cursor < line.length) {
      parts.push(line.slice(cursor))
    }

    return parts
  }

  function scrollToSearchLine(scrollBox: ScrollBoxRenderable, line: number) {
    scrollBox.stickyScroll = false
    scrollToLine(line, true)
    if (app.logNavigationActive) {
      setFollowingLogs(false)
      setCursorLine(line)
    }
  }

  createEffect(() => {
    const matches = searchMatches()
    if (matches.length === 0) return

    const scrollBox = scroll()
    if (!scrollBox) return

    const line = matches[searchIndex()] ?? matches[0]
    scrollToSearchLine(scrollBox, line)
  })

  createEffect(() => {
    if (!app.activeContainer) {
      setLogs("")
      setTempLogs("")
      return
    }

    const filter = activeFilter()
    const baseCommand = `docker logs --follow --tail 100 ${app.activeContainer}`
    const shellCommand = filter
      ? `${baseCommand} 2>&1 | grep --line-buffered "${filter}"`
      : baseCommand

    const process = Bun.spawn([
      "bash",
      "-c",
      shellCommand,
    ], {
        stdout: "pipe",
        stderr: "pipe",
      })

    const abortController = new AbortController()

    async function readStream(stream: ReadableStream) {
      const decoder = new TextDecoder()
      const reader = stream.getReader()

      try {
        while (!abortController.signal.aborted) {
          const { done, value } = await reader.read()
          if (done) break


          const text = decoder.decode(value, { stream: true })
          const cleanText = stripANSI(text)
          if (cleanText.length > 0) {
            if (paused()) {
              setTempLogs(prev => prev + cleanText)
              continue
            }

            setLogs(prev => prev + cleanText)
          }
        }
      } catch (err) {}
    }

    readStream(process.stdout)
    readStream(process.stderr)

    onCleanup(() => {
      abortController.abort()
      process.kill()
      setLogs("")
      setTempLogs("")
      setPaused(false)
    })
  })

  return (
    <Pane
      width="100%"
      flexGrow={1}
      height="100%"
      borderColor={() => app.logNavigationActive ? theme.border : theme.backgroundPanel}
    >
      <box
        paddingLeft={1}
        paddingRight={1}
        flexGrow={1}
        flexShrink={1}
        flexDirection="column"
        gap={1}
      >
        <Switch>
          <Match when={app.activeContainer && activeFilter().length > 0 && logs().length === 0}>
            <box height="100%" width="100%" paddingLeft={1} paddingRight={1}>
              <text fg={theme.textMuted}>No matching logs for "{activeFilter()}"</text>
            </box>
          </Match>
          <Match when={app.activeContainer && logs().length > 0}>
            <scrollbox
              ref={(r: ScrollBoxRenderable) => setScroll(r)}
              scrollY={true}
              stickyScroll={true}
              stickyStart="bottom"
              flexGrow={1}
              flexShrink={1}
            >
              <box flexDirection="column">
                <For each={logLines()}>
                  {(line, index) => (
                    <box
                      id={`log-line-${index()}`}
                      flexShrink={0}
                      backgroundColor={
                        app.logNavigationActive && isSelectedLine(index())
                          ? tint(theme.backgroundPanel, theme.accent, 0.25)
                          : app.logNavigationActive && cursorLine() === index()
                            ? tint(theme.backgroundPanel, theme.border, 0.35)
                            : undefined
                      }
                    >
                      <text fg={theme.textMuted}>{renderLogLine(line, index())}</text>
                    </box>
                  )}
                </For>
              </box>
            </scrollbox>
          </Match>
          <Match when={app.activeContainer && logs().length === 0}>
            <box height="100%" width="100%" paddingLeft={1} paddingRight={1}>
              <text fg={theme.textMuted}>Logs will stream here when available</text>
            </box>
          </Match>
          <Match when={!app.activeContainer && app.containers.length > 0}>
            <box height="100%" width="100%" paddingLeft={1} paddingRight={1}>
              <text fg={theme.textMuted}>No container selected</text>
              <text fg={theme.textMuted}>
                Select a container to view logs (use j/k or ↑/↓ to navigate)
              </text>
            </box>
          </Match>
          <Match when={!app.activeContainer && app.containers.length === 0}>
            <box height="100%" width="100%" paddingLeft={1} paddingRight={1}>
              <text fg={theme.textMuted}>No container selected</text>
            </box>
          </Match>
        </Switch>
      </box>
    </Pane>
  )
}
