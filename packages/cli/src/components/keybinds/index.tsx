import { createMemo, Switch, Match, For } from "solid-js"
import { useKeybind } from "@/context/keybind"
import { KeybindsConfig } from "@/util/config"
import { useTheme } from "@/context/theme"
import { useApplication } from "@/context/application"
import ContainerKeybinds from "./container"

export type Config = Array<ConfigItem>
export type ConfigItem = { label: string; key: keyof KeybindsConfig }

export default function Keybinds() {
  const theme = useTheme().theme
  const keybind = useKeybind()
  const app = useApplication()

  const right = createMemo<Config>(() => [
    { label: "themes", key: "theme_list" },
  ])

  return (
    <box
      width="100%"
      height="auto"
      paddingLeft={1}
      paddingRight={1}
      flexDirection="row"
      justifyContent="space-between"
    >
      <box flexDirection="row" gap={2}>
        <Switch>
          <Match when={app.shellFocused}>
            <ModeKeybinds items={[
              [keybind.print("container_shell_detach"), "detach"],
              [keybind.print("container_shell_quit"), "quit"],
            ]} />
          </Match>
          <Match when={app.logsFocused}>
            <ModeKeybinds items={[
              ["tab", "back"],
              ["/", "search"],
              ["j/k", "move"],
              ["gg/G", "jump"],
              ["p", app.logsPaused ? "play" : "pause"],
              ["yy", "line"],
              ["v", "select"],
              ["y", "yank"],
              ["Y", "all"],
            ]} />
          </Match>
          <Match when={app.searchActive}>
            <ModeKeybinds items={[
              ["esc", "close"],
              ["/", "edit"],
              ["n/N", "match"],
              ["j/k", "move"],
              ["gg/G", "jump"],
              ["p", app.logsPaused ? "play" : "pause"],
              ["yy", "line"],
              ["v", "select"],
              ["y", "yank"],
              ["Y", "all"],
            ]} />
          </Match>
          <Match when={app.editingSearch}>
            <ModeKeybinds items={[
              ["enter", "apply"],
              ["esc", "cancel"],
              ["tab", "logs"],
            ]} />
          </Match>
          <Match when={app.filtering}>
            <ModeKeybinds items={[
              ["enter", "apply"],
              ["esc", "cancel"],
              ["tab", "logs"],
            ]} />
          </Match>
          <Match when={!app.rightPanelFocused}>
            <Switch>
              <Match when={app.activePane === "containers"}>
                <ContainerKeybinds />
                <Match when={app.containerListMode === "containers" && app.activeContainer}>
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.text}>tab</text>
                    <text fg={theme.textMuted}>logs</text>
                  </box>
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.text}>{keybind.print("container_shell")}</text>
                    <text fg={theme.textMuted}>{app.selectedContainerHasShellSession ? "resume shell" : "shell"}</text>
                  </box>
                </Match>
              </Match>
              <Match when={app.activePane === "images" && app.activeImage}>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.text}>{keybind.print("resource_remove")}</text>
                  <text fg={theme.textMuted}>remove</text>
                </box>
              </Match>
              <Match when={app.activePane === "volumes" && app.activeVolume}>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.text}>{keybind.print("resource_remove")}</text>
                  <text fg={theme.textMuted}>remove</text>
                </box>
              </Match>
            </Switch>
          </Match>
        </Switch>
      </box>
      <box flexDirection="row" gap={2}>
        <For each={right()}>
          {(item) => {
            return (
              <box flexDirection="row" gap={1}>
                <text fg={theme.text}>{keybind.print(item.key)}</text>
                <text fg={theme.textMuted}>{item.label}</text>
              </box>
            )
          }}
        </For>
      </box>
    </box>
  )
}

function ModeKeybinds(props: { items: string[][] }) {
  const theme = useTheme().theme

  return (
    <box flexDirection="row" gap={2}>
      <For each={props.items}>
        {([keys, label]) => (
          <box flexDirection="row" gap={1}>
            <text fg={theme.text}>{keys}</text>
            <text fg={theme.textMuted}>{label}</text>
          </box>
        )}
      </For>
    </box>
  )
}
