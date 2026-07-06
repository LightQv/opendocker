import { createEffect, createMemo, createSignal, onCleanup, Switch, Match, For } from "solid-js"
import { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useApplication } from "@/context/application"
import { Pane } from "@/ui/pane"
import { stripANSI } from "bun"
import { useTheme } from "@/context/theme"

export default function Logs() {
  const app = useApplication()
  const theme = useTheme().theme
  const [logs, setLogs] = createSignal<string>("")
  const [tempLogs, setTempLogs] = createSignal<string>("")
  const [paused, setPaused] = createSignal<boolean>(false)
  const [scroll, setScroll] = createSignal<ScrollBoxRenderable>()
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

  useKeyboard(key => {
    if (app.activePane !== "containers") {
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

  function renderLogLine(line: string, lineIndex: number) {
    const query = activeSearch().trim()
    if (!app.searching || query.length === 0) {
      return line
    }

    const lowerLine = line.toLowerCase()
    const lowerQuery = query.toLowerCase()
    const firstMatch = lowerLine.indexOf(lowerQuery)
    if (firstMatch === -1) {
      return line
    }

    const activeLine = searchMatches()[searchIndex()] === lineIndex
    const matchBg = activeLine ? theme.warning : theme.backgroundElement
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

  createEffect(() => {
    const matches = searchMatches()
    if (matches.length === 0) return

    const scrollBox = scroll()
    if (!scrollBox) return

    const line = matches[searchIndex()] ?? matches[0]
    scrollBox.stickyScroll = false
    scrollBox.scrollTo({ x: 0, y: line })
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
    <Pane width="100%" flexGrow={1} height="100%">
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
                    <text fg={theme.textMuted}>{renderLogLine(line, index())}</text>
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
