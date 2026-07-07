import {
  createMemo,
  createEffect,
  createSignal,
  For,
} from "solid-js"
import { useApplication } from "@/context/application"
import type { Container } from "@/context/application"
import { Pane } from "@/ui/pane"
import { getColorForContainerState } from "@/util/colors"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@/context/theme"
import { formatContainerWebPort, getContainerWebPort } from "@/util/container"

type StatsSummary = {
  cpuPercent: number
  memoryPercent: number
  hasStats: boolean
}

type HeaderField = {
  label: () => string
  value: () => string | undefined | null
}

const EMPTY_STATS: StatsSummary = {
  cpuPercent: 0,
  memoryPercent: 0,
  hasStats: false,
}

export default function Header() {
  const theme = useTheme().theme
  const app = useApplication()
  const [selected, setSelected] = createSignal<Container>()
  const selectedProjectContainers = createMemo(() => {
    const project = app.activeContainerProject
    if (!project) return []
    return app.containers.filter(container => container.project === project)
  })

  createEffect(() => {
    if (app.shellFocused) {
      setSelected(app.activeShellContainer)
      return
    }

    setSelected(
      app.containers.find((c: Container) => c.id === app.activeContainer)
    )
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

  const stats = createMemo<StatsSummary>(() => {
    if (app.containerListMode !== "projects") {
      const container = selected()
      if (!container) return EMPTY_STATS

      const stats = app.containerStats[container.id]
      return stats
        ? {
          cpuPercent: stats.cpuPercent,
          memoryPercent: stats.memoryPercent,
          hasStats: true,
        }
        : EMPTY_STATS
    }

    let cpuPercent = 0
    let memoryUsage = 0
    let memoryLimit = 0
    let statCount = 0

    for (const container of selectedProjectContainers()) {
      const stats = app.containerStats[container.id]
      if (!stats) continue

      cpuPercent += stats.cpuPercent
      memoryUsage += stats.memoryUsage
      memoryLimit += stats.memoryLimit
      statCount += 1
    }

    if (statCount === 0) return EMPTY_STATS

    return {
      cpuPercent,
      memoryPercent: memoryLimit > 0 ? (memoryUsage / memoryLimit) * 100 : 0,
      hasStats: true,
    }
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

  function formatPercent(value: number, hasStats: boolean) {
    if (!hasStats) return "-"
    return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)}%`
  }

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
      { label: () => "CPU", value: () => formatPercent(stats().cpuPercent, stats().hasStats) },
      { label: () => "RAM", value: () => formatPercent(stats().memoryPercent, stats().hasStats) },
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
