import { $ } from "bun"
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, untrack } from "solid-js"
import { useApplication } from "@/context/application"
import type { Container, ContainerStats } from "@/context/application"
import { useTheme } from "@/context/theme"
import { DockerV2 } from "@/lib/docker-v2"
import { formatStatsMemory, formatStatsPercent, summarizeContainerStats, summarizeProjectStats } from "@/util/container-stats"

export default function RightSidebar(props: { overlay?: boolean }) {
  const theme = useTheme().theme
  const app = useApplication()
  const [pwd, setPwd] = createSignal("")
  const [socket, setSocket] = createSignal("")
  const version = getVersion()
  let projectStatsHydrationAbortController: AbortController | undefined
  let projectStatsHydrationTimer: ReturnType<typeof setTimeout> | undefined
  let projectStatsHydrationRun = 0
  const selectedProjectContainers = createMemo(() => {
    const project = app.activeContainerProject
    if (!project) return []
    return app.containers.filter(container => container.project === project)
  })
  const projectStatsHydrationKey = createMemo(() => {
    if (app.activePane !== "containers") return ""
    if (app.containerListMode !== "projects") return ""
    return selectedProjectContainers()
      .filter(container => container.state === "running")
      .map(container => container.id)
      .join(",")
  })
  const selectedContainer = createMemo(() => {
    if (app.shellFocused) return app.activeShellContainer
    if (app.containerListMode !== "containers") return undefined
    return app.containers.find(container => container.id === app.activeContainer)
  })
  const projectStats = createMemo(() => summarizeStats(selectedProjectContainers()))
  const selectedStats = createMemo(() => {
    const container = selectedContainer()
    return summarizeContainerStats(
      container ? app.containerStats[container.id] : undefined,
      container?.state === "running",
    )
  })

  onMount(async () => {
    const cwd = process.cwd()
    const home = process.env.HOME || ""
    const path = cwd.startsWith(home) ? cwd.replace(home, "~") : cwd
    setPwd(path)
    getEndpoint()

    const branch = await getCurrentBranch()
    if (branch) {
      setPwd(`${path}:${branch}`)
    }
  })

  onCleanup(() => {
    stopProjectStatsHydration()
  })

  createEffect(on(
    projectStatsHydrationKey,
    (key) => {
      untrack(() => {
        stopProjectStatsHydration()
        if (key) scheduleProjectStatsHydration(0)
      })
    },
  ))

  async function getEndpoint() {
    const res = await DockerV2.getSocket()
    setSocket(res)
  }

  async function getCurrentBranch() {
    return $`git rev-parse --abbrev-ref HEAD`
      .quiet()
      .nothrow()
      .text()
      .then(x => x.trim())
  }

  function getVersion() {
    const version = typeof OPENDOCKER_VERSION !== "undefined" ? OPENDOCKER_VERSION : "local"
    return "v" + version
  }

  function summarizeStats(containers: Container[]) {
    return summarizeProjectStats(containers, app.containerStats)
  }

  function getMissingProjectStatsIds() {
    if (app.activePane !== "containers") return []
    if (app.containerListMode !== "projects") return []

    return selectedProjectContainers()
      .filter(container => container.state === "running" && !app.containerStats[container.id])
      .map(container => container.id)
  }

  function mergeContainerStats(stats: Record<string, ContainerStats>) {
    if (Object.keys(stats).length === 0) return

    const runningContainerIds = new Set(
      app.containers
        .filter(container => container.state === "running")
        .map(container => container.id),
    )
    const nextStats: Record<string, ContainerStats> = {}

    for (const [containerId, value] of Object.entries({ ...app.containerStats, ...stats })) {
      if (!runningContainerIds.has(containerId)) continue
      nextStats[containerId] = value
    }

    app.setContainerStats(nextStats)
  }

  function clearProjectStatsHydrationTimer() {
    if (!projectStatsHydrationTimer) return
    clearTimeout(projectStatsHydrationTimer)
    projectStatsHydrationTimer = undefined
  }

  function stopProjectStatsHydration() {
    clearProjectStatsHydrationTimer()
    projectStatsHydrationRun += 1
    projectStatsHydrationAbortController?.abort()
    projectStatsHydrationAbortController = undefined
  }

  function scheduleProjectStatsHydration(delay: number) {
    clearProjectStatsHydrationTimer()
    if (getMissingProjectStatsIds().length === 0) return

    projectStatsHydrationTimer = setTimeout(() => {
      hydrateProjectStats()
    }, delay)
  }

  async function hydrateProjectStats() {
    clearProjectStatsHydrationTimer()
    const missingContainerIds = getMissingProjectStatsIds()
    if (missingContainerIds.length === 0) return

    projectStatsHydrationAbortController?.abort()
    const controller = new AbortController()
    projectStatsHydrationAbortController = controller
    const run = ++projectStatsHydrationRun

    try {
      for (const containerId of missingContainerIds) {
        if (controller.signal.aborted || run !== projectStatsHydrationRun) return
        if (app.containerStats[containerId]) continue

        const stats = await DockerV2.getContainerStats([containerId], controller.signal)
          .catch(() => undefined)

        if (controller.signal.aborted || run !== projectStatsHydrationRun) return
        if (stats) mergeContainerStats(stats)
      }
    } finally {
      if (projectStatsHydrationAbortController === controller) {
        projectStatsHydrationAbortController = undefined
      }

      if (!controller.signal.aborted && run === projectStatsHydrationRun && getMissingProjectStatsIds().length > 0) {
        scheduleProjectStatsHydration(2_000)
      }
    }
  }

  function StatLine(props: { label: string, value: string }) {
    return (
      <box flexDirection="row" justifyContent="space-between" gap={1}>
        <text fg={theme.textMuted}>{props.label}</text>
        <text fg={theme.text}>{props.value}</text>
      </box>
    )
  }

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      width={42}
      height="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      position={props.overlay ? "absolute" : "relative"}
      flexDirection="column"
      justifyContent="space-between"
    >
      <box flexDirection="column" gap={2}>
        <box flexDirection="column">
          <text fg={theme.text}><b>Docker Socket</b></text>
          <text fg={theme.textMuted}>{socket()}</text>
        </box>
        <Show when={app.activePane === "containers"}>
          <box flexDirection="column" gap={1}>
            <text fg={theme.text}><b>Stats</b></text>
            <text fg={theme.textMuted} wrapMode="none">
              {app.activeContainerProject ?? "No project"}
            </text>
            <StatLine label="Project CPU" value={formatStatsPercent(projectStats().cpuPercent, projectStats().hasStats, projectStats().loading)} />
            <StatLine label="Project RAM" value={formatStatsMemory(projectStats())} />
          </box>
          <Show when={selectedContainer()}>
            <box flexDirection="column" gap={1}>
              <text fg={theme.text}><b>Selected Container</b></text>
              <text fg={theme.textMuted} wrapMode="none">{selectedContainer()?.name}</text>
              <StatLine label="CPU" value={formatStatsPercent(selectedStats().cpuPercent, selectedStats().hasStats, selectedStats().loading)} />
              <StatLine label="RAM" value={formatStatsMemory(selectedStats())} />
            </box>
          </Show>
          <Show when={app.containerListMode === "projects" && selectedProjectContainers().length > 0}>
            <box flexDirection="column" gap={1}>
              <text fg={theme.text}><b>Containers</b></text>
              <For each={selectedProjectContainers()}>
                {(container) => {
                  const stats = () => summarizeContainerStats(app.containerStats[container.id], container.state === "running")
                  const isActive = () => app.activeContainer === container.id

                  return (
                    <box flexDirection="column">
                      <text fg={isActive() ? theme.text : theme.textMuted} wrapMode="none">
                        {container.name}
                      </text>
                      <text fg={theme.textMuted} wrapMode="none">
                        CPU {formatStatsPercent(stats().cpuPercent, stats().hasStats, stats().loading)} RAM {formatStatsPercent(stats().memoryPercent, stats().hasStats, stats().loading)}
                      </text>
                    </box>
                  )
                }}
              </For>
            </box>
          </Show>
        </Show>
      </box>
      <box flexShrink={0} gap={1} paddingRight={1}>
        <text fg={theme.textMuted}>{pwd()}</text>
        <text fg={theme.textMuted}>
          <span style={{ fg: theme.success }}>•</span> <b>Open</b>
          <span style={{ fg: theme.text }}>
            <b>Docker</b>
          </span>{" "}
          <span>{version}</span>
        </text>
      </box>
    </box>
  )
}
