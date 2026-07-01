import { Switch, Match, createMemo, createSignal, createEffect, For } from "solid-js"
import { useKeybind } from "@/context/keybind"
import { useTheme } from "@/context/theme"
import { useKeyboard } from "@opentui/solid"
import { useDialog } from "@/ui/dialog"
import { useApplication } from "@/context/application"
import type { Container } from "@/context/application"
import { DockerV2 } from "@/lib/docker-v2"
import { useToast } from "@/ui/toast"
import type { Config, ConfigItem } from "@/components/keybinds"

export default function ContainerKeybinds() {
  const theme = useTheme().theme
  const keybind = useKeybind()
  const dialog = useDialog()
  const app = useApplication()
  const toast = useToast()
  const [selected, setSelected] = createSignal<Container>()
  const selectedProjectContainers = createMemo(() => {
    const project = app.activeContainerProject
    if (!project) return []
    return app.containers.filter(container => container.project === project)
  })

  const keybinds = createMemo<Config>(() => {
    const cmd = app.containerListMode === "projects"
      ? getCmdForProject(selectedProjectContainers())
      : getCmdForState(selected())

    const items: Config = cmd ? [{ label: cmd, key: "container_start_stop" }] : []
    if (app.containerListMode === "projects" && getComposeProject(selectedProjectContainers())) {
      items.push({ label: "restart project", key: "project_restart" })
    }

    return items
  })

  createEffect(() => {
    if (app.containerListMode !== "containers") {
      setSelected(undefined)
      return
    }

    setSelected(
      app.containers.find((c: Container) => c.id === app.activeContainer)
    )
  })

  function getCmdForState(container: Container | undefined): "start" | "stop" | null {
    if (!container) return null
    switch (container.state) {
      case "created":
      case "restarting":
      case "running":
        return "stop"
      case "paused": case "exited":
      case "dead":
        return "start"
      default:
        return null
    }
  }

  function getCmdForProject(containers: Container[]): "up project" | "stop project" | null {
    if (containers.length === 0) return null
    return containers.some(container => container.state === "running")
      ? "stop project"
      : "up project"
  }

  function getComposeProject(containers: Container[]): DockerV2.ComposeProject | null {
    const container = containers.find(container => (
      container.project !== "Standalone" &&
      container.composeWorkingDir &&
      container.composeConfigFiles.length > 0
    ))

    if (!container) return null

    return {
      project: container.project,
      workingDir: container.composeWorkingDir,
      configFiles: container.composeConfigFiles,
    }
  }

  function startProject(containers: Container[]) {
    const composeProject = getComposeProject(containers)
    if (composeProject) {
      return DockerV2.upComposeProject(composeProject)
        .catch(toast.error)
    }

    return DockerV2.startContainers(containers.map(container => container.id))
      .catch(toast.error)
  }

  function stopProject(containers: Container[]) {
    const composeProject = getComposeProject(containers)
    if (composeProject) {
      return DockerV2.stopComposeProject(composeProject)
        .catch(toast.error)
    }

    return DockerV2.stopContainers(containers.map(container => container.id))
      .catch(toast.error)
  }

  function restartProject(containers: Container[]) {
    const composeProject = getComposeProject(containers)
    if (!composeProject) {
      return
    }

    return DockerV2.restartComposeProject(composeProject)
      .catch(toast.error)
  }

  useKeyboard(key => {
    if (dialog.stack.length > 0) return
    if (app.activePane !== "containers") return

    if (keybind.match("container_start_stop", key)) {
      if (app.containerListMode === "projects") {
        const containers = selectedProjectContainers()
        const cmd = getCmdForProject(containers)
        if (!cmd) return

        if (cmd === "up project") {
          toast.show({
            variant: "info",
            message: "Starting project",
          })
          startProject(containers)
          return
        }

        toast.show({
          variant: "info",
          message: "Stopping project",
        })
        stopProject(containers)
        return
      }

      const container = selected()
      if (!container) return
      const cmd = getCmdForState(container)

      if (cmd === "start") {
          toast.show({
            variant: "info",
            message: "Starting container",
          })
          DockerV2.startContainer(container.name).catch(toast.error)
          return
        }

      if (cmd === "stop") {
          toast.show({
            variant: "info",
            message: "Stopping container",
          })
          DockerV2.stopContainer(container.name).catch(toast.error)
          return
        }
    }

    if (keybind.match("project_restart", key)) {
      if (app.containerListMode !== "projects") return
      const containers = selectedProjectContainers()
      if (!getComposeProject(containers)) return

      toast.show({
        variant: "info",
        message: "Restarting project",
      })
      restartProject(containers)
    }
  })

  return (
    <Switch>
      <Match when={keybinds().length === 0}>
        <></>
      </Match>
      <Match when={keybinds().length > 0}>
        <For each={keybinds()}>
          {(item: ConfigItem) => {
            return (
              <box flexDirection="row" gap={1}>
                <text fg={theme.text}>{keybind.print(item.key)}</text>
                <text fg={theme.textMuted}>{item.label}</text>
              </box>
            )
          }}
        </For>
      </Match>
    </Switch>
  )
}
