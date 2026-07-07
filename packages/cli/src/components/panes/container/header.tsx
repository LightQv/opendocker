import {
  createMemo,
  For,
} from "solid-js"
import { useApplication } from "@/context/application"
import { Pane } from "@/ui/pane"
import { getColorForContainerState } from "@/util/colors"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@/context/theme"
import { formatContainerWebPort, getContainerWebPort } from "@/util/container"
import { formatStatsPercent, summarizeContainerStats, summarizeProjectStats } from "@/util/container-stats"

type HeaderField = {
  label: () => string
  value: () => string | undefined | null
}

export default function Header() {
  const theme = useTheme().theme
  const app = useApplication()
  const selected = createMemo(() => {
    if (app.shellFocused) return app.activeShellContainer
    return app.containers.find(container => container.id === app.activeContainer)
  })
  const selectedProjectContainers = createMemo(() => {
    const project = app.activeContainerProject
    if (!project) return []
    return app.containers.filter(container => container.project === project)
  })

  const projectRunning = createMemo(() => {
    return selectedProjectContainers().filter(container => container.state === "running").length
  })

  const projectState = createMemo(() => {
    const containers = selectedProjectContainers()
    if (containers.length === 0) return undefined
    if (projectRunning() === containers.length) return "running"
    if (projectRunning() > 0) return "partial"
    return "exited"
  })

  const projectStatus = createMemo(() => {
    const containers = selectedProjectContainers()
    if (containers.length === 0) return undefined
    return `${projectRunning()}/${containers.length} running`
  })

  const stats = createMemo(() => {
    if (app.containerListMode !== "projects") {
      const container = selected()
      return summarizeContainerStats(
        container ? app.containerStats[container.id] : undefined,
        container?.state === "running",
      )
    }

    return summarizeProjectStats(selectedProjectContainers(), app.containerStats)
  })

  const highlight = createMemo(() => {
    if (app.containerListMode === "projects") {
      const containers = selectedProjectContainers()
      if (containers.length === 0) return theme.textMuted
      if (projectRunning() === containers.length) return theme.success
      if (projectRunning() > 0) return theme.warning
      return theme.error
    }

    return getColorForContainerState(
      false,
      selected()?.status,
      selected()?.state
    )
  })

  const fields = createMemo<HeaderField[]>(() => {
    const result: HeaderField[] = [
      {
        label: () => app.containerListMode === "projects" ? "Project" : "Name",
        value: () => app.containerListMode === "projects" ? app.activeContainerProject : selected()?.name,
      },
      {
        label: () => "Status",
        value: () => app.containerListMode === "projects" ? projectStatus() : selected()?.status,
      },
      {
        label: () => "State",
        value: () => app.containerListMode === "projects" ? projectState() : selected()?.state,
      },
      { label: () => "CPU", value: () => formatStatsPercent(stats().cpuPercent, stats().hasStats, stats().loading) },
      { label: () => "RAM", value: () => formatStatsPercent(stats().memoryPercent, stats().hasStats, stats().loading) },
      { label: () => "Mode", value: () => app.shellFocused ? "shell" : "logs" },
    ]
    const webPort = app.containerListMode === "containers"
      ? getContainerWebPort(selected())
      : undefined

    if (webPort) {
      result.splice(3, 0, { label: () => "Port", value: () => formatContainerWebPort(webPort) })
    }

    return result
  })

  return (
    <Pane width="100%" height="auto" flexShrink={0}>
      <box
        paddingRight={1}
        paddingLeft={1}
        flexDirection="row"
        gap={1}
      >
        <For each={fields()}>
          {(header) => (
            <box flexDirection="column">
              <text fg={theme.textMuted} attributes={TextAttributes.BOLD} flexShrink={0}>
                {header.label()}
              </text>
              <text fg={header.label() === "Status" || header.label() === "State" ? highlight() : theme.text}>{header.value()}</text>
            </box>
          )}
        </For>
      </box>
    </Pane>
  )
}
