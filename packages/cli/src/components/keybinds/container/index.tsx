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
import { DialogConfirm } from "@/ui/dialog-confirm"
import { ContainerShell } from "@/lib/container-shell"
import { canOpenContainerWebUi, getContainerWebUrl } from "@/util/container"

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

    if (app.containerListMode === "projects") {
      if (getComposeProject(selectedProjectContainers())) {
        items.push(
          { label: "restart project", key: "container_restart" },
          { label: "recreate project", key: "container_recreate" },
          { label: "remove project", key: "resource_remove" },
        )
      }
    } else if (selected()) {
      const container = selected()
      items.push(
        { label: "restart", key: "container_restart" },
        { label: "remove", key: "resource_remove" },
      )

      let insertAt = 1
      if (canOpenShell(container)) {
        items.splice(insertAt, 0, { label: getShellLabel(container), key: "container_shell" })
        insertAt += 1
      }

      if (canOpenContainerWebUi(container)) {
        items.splice(insertAt, 0, { label: "open", key: "container_open" })
      }

      if (getComposeService(selected())) {
        items.push({ label: "recreate", key: "container_recreate" })
      }
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

  function getComposeService(container: Container | undefined): DockerV2.ComposeService | null {
    if (!container) return null
    if (container.project === "Standalone") return null
    if (!container.service) return null
    if (!container.composeWorkingDir) return null
    if (container.composeConfigFiles.length === 0) return null

    return {
      project: container.project,
      service: container.service,
      workingDir: container.composeWorkingDir,
      configFiles: container.composeConfigFiles,
    }
  }

  function getShellLabel(container: Container | undefined): "opening shell" | "resume shell" | "shell" {
    if (!container) return "shell"

    const status = app.shell.sessions[container.id]?.status
    if (status === "opening") return "opening shell"
    if (status === "running") return "resume shell"
    return "shell"
  }

  function canOpenShell(container: Container | undefined): boolean {
    if (!container) return false
    if (container.state === "running") return true

    const status = app.shell.sessions[container.id]?.status
    return status === "opening" || status === "running"
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

  function closeShellSessions(containers: Container[]) {
    for (const container of containers) {
      ContainerShell.quit(container.id)
      app.closeContainerShell(container.id)
    }
  }

  function closeShellSession(container: Container) {
    closeShellSessions([container])
  }

  async function openBrowser(url: string) {
    const command = process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["rundll32", "url.dll,FileProtocolHandler", url]
        : ["xdg-open", url]

    const proc = Bun.spawn(command, {
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
    ])

    if (exitCode !== 0) {
      throw new Error(stderr.trim() || `Failed to open ${url}`)
    }
  }

  function stopProject(containers: Container[]) {
    closeShellSessions(containers)

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

    closeShellSessions(containers)
    return DockerV2.restartComposeProject(composeProject)
      .catch(toast.error)
  }

  function recreateProject(containers: Container[]) {
    const composeProject = getComposeProject(containers)
    if (!composeProject) {
      return
    }

    closeShellSessions(containers)
    return DockerV2.recreateComposeProject(composeProject)
      .catch(toast.error)
  }

  function removeProject(containers: Container[]) {
    const composeProject = getComposeProject(containers)
    if (!composeProject) {
      return
    }

    return DockerV2.removeComposeProject(composeProject)
      .catch(toast.error)
  }

  function confirmRemoveProject(containers: Container[]) {
    const composeProject = getComposeProject(containers)
    if (!composeProject) return

    dialog.replace(() => (
      <DialogConfirm
        title="Remove project?"
        message={`This will run docker compose down for ${composeProject.project} and remove ${containers.length} container${containers.length === 1 ? "" : "s"}.`}
        confirmLabel="Remove"
        danger
        onConfirm={() => {
          toast.show({
            variant: "info",
            message: "Removing project",
          })
          closeShellSessions(containers)
          removeProject(containers)
        }}
      />
    ))
  }

  function confirmRemoveContainer(container: Container) {
    dialog.replace(() => (
      <DialogConfirm
        title="Remove container?"
        message={`This will remove ${container.name}. Running containers must be stopped first.`}
        confirmLabel="Remove"
        danger
        onConfirm={() => {
          toast.show({
            variant: "info",
            message: "Removing container",
          })
          closeShellSession(container)
          DockerV2.removeContainer(container.id).catch(toast.error)
        }}
      />
    ))
  }

  useKeyboard(key => {
    if (dialog.stack.length > 0) return
    if (app.activePane !== "containers") return

    if (keybind.match("container_shell", key)) {
      if (app.containerListMode !== "containers") return
      if (app.filtering || app.editingSearch) return

      const container = selected()
      if (!container) return
      if (!canOpenShell(container)) return

      app.openContainerShell(container.id)
      return
    }

    if (app.rightPanelFocused) return

    if (keybind.match("container_open", key)) {
      if (app.containerListMode !== "containers") return

      const container = selected()
      if (!canOpenContainerWebUi(container)) return

      const url = getContainerWebUrl(container)
      if (!url) return

      toast.show({
        variant: "info",
        message: `Opening ${url}`,
      })
      openBrowser(url).catch(toast.error)
      return
    }

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
        DockerV2.startContainer(container.id).catch(toast.error)
        return
      }

      if (cmd === "stop") {
        toast.show({
          variant: "info",
          message: "Stopping container",
        })
        closeShellSession(container)
        DockerV2.stopContainer(container.id).catch(toast.error)
        return
      }
    }

    if (keybind.match("container_restart", key)) {
      if (app.containerListMode === "projects") {
        const containers = selectedProjectContainers()
        if (!getComposeProject(containers)) return

        toast.show({
          variant: "info",
          message: "Restarting project",
        })
        restartProject(containers)
        return
      }

      const container = selected()
      if (!container) return

      toast.show({
        variant: "info",
        message: "Restarting container",
      })
      closeShellSession(container)
      DockerV2.restartContainer(container.id).catch(toast.error)
      return
    }

    if (keybind.match("container_recreate", key)) {
      if (app.containerListMode === "projects") {
        const containers = selectedProjectContainers()
        if (!getComposeProject(containers)) return

        toast.show({
          variant: "info",
          message: "Recreating project",
        })
        recreateProject(containers)
        return
      }

      const composeService = getComposeService(selected())
      if (!composeService) return

      const container = selected()
      if (container) closeShellSession(container)

      toast.show({
        variant: "info",
        message: "Recreating container",
      })
      DockerV2.recreateComposeService(composeService).catch(toast.error)
      return
    }

    if (keybind.match("resource_remove", key)) {
      if (app.containerListMode === "projects") {
        const containers = selectedProjectContainers()
        if (!getComposeProject(containers)) return

        confirmRemoveProject(containers)
        return
      }

      const container = selected()
      if (!container) return

      confirmRemoveContainer(container)
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
