import { createSignal, Switch, Match, Show, createEffect } from "solid-js"
import { KeyEvent, TextareaRenderable, TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { SplitBorder } from "@/components/border"
import { useApplication } from "@/context/application"
import { useTheme } from "@/context/theme"
import { useDialog } from "@/ui/dialog"

export default function Filter() {
  const app = useApplication()
  const theme = useTheme().theme
  const dialog = useDialog()
  const [value, setValue] = createSignal<string>("")
  let input: TextareaRenderable | undefined

  const activeSearch = () => {
    const activeContainer = app.activeContainer
    return activeContainer ? app.searches[activeContainer] || "" : ""
  }

  const searchMatchCount = () => {
    const activeContainer = app.activeContainer
    return activeContainer ? app.searchMatchCounts[activeContainer] || 0 : 0
  }

  const searchIndex = () => {
    const activeContainer = app.activeContainer
    return activeContainer ? app.searchIndexes[activeContainer] || 0 : 0
  }

  const mode = () => app.filtering ? "filter" : app.editingSearch ? "searchEdit" : app.searching ? "searchActive" : "idle"
  const inputVisible = () => app.filtering || app.editingSearch

  function focusInput(nextValue: string) {
    setValue(nextValue)
    setTimeout(() => {
      if (!input || !inputVisible()) return
      input.setText(nextValue)
      input.focus()
      input.cursorOffset = input.plainText.length
    }, 0)
  }

  useKeyboard(key => {
    if (dialog.stack.length > 0) return
    if (app.rightSidebarOpen) return
    if (app.containerListMode !== "containers") return
    if (app.logsFocused) return

    if (key.name === "f") {
      if (!input?.focused) {
        const filterValue = app.activeContainer ? app.filters[app.activeContainer] || "" : ""
        key.preventDefault()
        app.startContainerFilter()
        focusInput(filterValue)
        return
      }
    }

    if (key.name === "/") {
      if (!input?.focused && app.activeContainer) {
        const searchValue = activeSearch()
        key.preventDefault()
        app.startContainerSearch()
        focusInput(searchValue)
        return
      }
    }

    if (app.searching && !app.editingSearch && key.name === "escape") {
      key.preventDefault()
      app.stopContainerSearch()
    }
  })

  function submit(key: KeyEvent) {
    if (!input) return
    input.submit()
    key.preventDefault()

    if (app.filtering && app.activeContainer) {
      app.setContainerFilter(app.activeContainer, value())
    }

    if (app.searching && app.activeContainer) {
      app.setContainerSearch(app.activeContainer, value())
      app.setContainerSearchIndex(app.activeContainer, 0)
      input.blur()
      input = undefined
      app.activateContainerSearch()
      return
    }

    if (!inputVisible()) return
    input.focus()
    input.cursorOffset = input.plainText.length

    return
  }

  function cancel(key: KeyEvent) {
    if (!input) return
    input.blur()
    input = undefined
    key.preventDefault()

    if (app.editingSearch && activeSearch().length > 0) {
      app.activateContainerSearch()
      return
    }

    app.stopContainerFilter()
    return
  }

  createEffect(() => {
    if (app.logsFocused) {
      return
    }

    if (input && (app.filtering || app.editingSearch) && !input.focused) {
      const nextValue = app.editingSearch ? activeSearch() : app.activeContainer ? app.filters[app.activeContainer] || "" : ""
      focusInput(nextValue)
      return
    }

    if (!input || !inputVisible() || !app.activeContainer || input.focused) {
      return
    }

    const nextValue = app.searching ? activeSearch() : app.filters[app.activeContainer] || ""
    setValue(nextValue)
    input.setText(nextValue)
  })

  createEffect(() => {
    if (app.containerListMode !== "containers" && (app.filtering || app.searching)) {
      app.stopContainerFilter()
    }
  })

  const borderColor = () => app.filtering || app.searching ? theme.border : theme.backgroundPanel

  return (
    <box
      border={["left"]}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={borderColor()}
      flexShrink={0}
    >
      <box backgroundColor={theme.backgroundPanel} flexDirection="row">
        <box
          flexDirection="row"
          alignItems="center"
          gap={1}
          paddingLeft={1}
          paddingRight={3}
          paddingTop={1}
          paddingBottom={1}
          width="100%"
        >
          <Switch>
            <Match when={mode() === "idle"}>
              <text marginLeft={1} fg={theme.textMuted}>Search or filter logs</text>
            </Match>
            <Match when={mode() === "searchActive"}>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>SEARCH</text>
              <text marginLeft={1} fg={theme.textMuted}>{activeSearch()}</text>
            </Match>
            <Match when={mode() === "filter" || mode() === "searchEdit"}>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>{app.filtering ? "FILTER" : "SEARCH"}</text>
              <textarea
                marginLeft={1}
                placeholder={app.filtering ? `"GET /api"` : `"error"`}
                textColor={theme.textMuted}
                focusedTextColor={theme.text}
                flexGrow={1}
                minHeight={1}
                maxHeight={1}
                onContentChange={() => setValue(input?.plainText ?? "")}
                ref={(r: TextareaRenderable) => {
                  input = r
                  setTimeout(() => {
                    if (!input || !inputVisible()) return
                    input.cursorColor = theme.text
                  }, 0)
                }}
                focusedBackgroundColor={theme.backgroundPanel}
                cursorColor={theme.warning}
                onKeyDown={key => {
                  if (key.name === "enter" || key.name === "return") {
                    submit(key)
                  }

                  if (key.name === "escape") {
                    cancel(key)
                  }
                }}
              />
            </Match>
          </Switch>
          <Show when={app.searching}>
            <box flexGrow={1} />
            <text fg={theme.text} flexShrink={0}>
              {searchMatchCount() > 0 ? `${searchIndex() + 1}/${searchMatchCount()}` : "0/0"}
            </text>
          </Show>
        </box>
        <box
          flexDirection="row"
          flexShrink={0}
          gap={1}
          paddingTop={1}
          paddingLeft={1}
          paddingRight={2}
          paddingBottom={1}
          backgroundColor={theme.backgroundElement}
          justifyContent="space-between"
        >
          <box flexDirection="row" gap={1}>
          </box>
          <box flexDirection="row" gap={2}>
            <Switch>
              <Match when={mode() === "idle"}>
                <text fg={theme.text}>
                  {"f"} <span style={{ fg: theme.textMuted }}>filter</span>
                </text>
                <text fg={theme.text}>
                  {"/"} <span style={{ fg: theme.textMuted }}>search</span>
                </text>
              </Match>
              <Match when={app.filtering}>
                <text fg={theme.text}>
                  esc <span style={{ fg: theme.textMuted }}>cancel</span>
                </text>
                <text fg={theme.text}>
                  enter <span style={{ fg: theme.textMuted }}>apply</span>
                </text>
              </Match>
              <Match when={app.searching}>
                <Show when={!app.editingSearch}>
                  <text fg={theme.text}>
                    {"/"} <span style={{ fg: theme.textMuted }}>edit</span>
                  </text>
                </Show>
                <text fg={theme.text}>
                  esc <span style={{ fg: theme.textMuted }}>close</span>
                </text>
                <Show when={app.editingSearch}>
                  <text fg={theme.text}>
                    enter <span style={{ fg: theme.textMuted }}>apply</span>
                  </text>
                </Show>
                <Show when={!app.editingSearch}>
                  <text fg={theme.text}>
                    n <span style={{ fg: theme.textMuted }}>next</span>
                  </text>
                  <text fg={theme.text}>
                    shift+n <span style={{ fg: theme.textMuted }}>prev</span>
                  </text>
                </Show>
              </Match>
            </Switch>
          </box>
        </box>
      </box>
    </box>
  )
}
