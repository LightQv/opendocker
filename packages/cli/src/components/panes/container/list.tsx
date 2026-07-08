import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onMount,
  Show,
  Switch,
  onCleanup,
} from "solid-js"
import { useApplication } from "@/context/application"
import type { Container, ContainerStats } from "@/context/application"
import { Pane } from "@/ui/pane"
import { getColorForContainerState } from "@/util/colors"
import { useTheme } from "@/context/theme"
import { useKeybind } from "@/context/keybind"
import { DockerV2 } from "@/lib/docker-v2"
import { useDialog } from "@/ui/dialog"

const CONTAINER_REFRESH_MS = 1000
const STATS_REFRESH_MS = 2000

export default function List() {
  const keybind = useKeybind()
  const app = useApplication()
  const dialog = useDialog()
  const [active, setActive] = createSignal<boolean>(false)
  const selectedProjectContainers = createMemo(() => {
    const project = app.activeContainerProject
    if (!project) return []
    return app.containers.filter(container => container.project === project)
  })
  const projects = createMemo(() => {
    const byName = new Map<string, { name: string, total: number, running: number }>()

    for (const container of app.containers) {
      const project = byName.get(container.project) ?? {
        name: container.project,
        total: 0,
        running: 0,
      }

      project.total += 1
      if (container.state === "running") {
        project.running += 1
      }
      byName.set(container.project, project)
    }

    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name))
  })
  const maxStateLength = () => Math.max(...selectedProjectContainers().map(c => c.state.length), 0)
  const theme = useTheme().theme
  let refreshingContainers = false
  let statsAbortController: AbortController | undefined
  let statsRefreshTimer: ReturnType<typeof setTimeout> | undefined
  let backgroundStatsAbortController: AbortController | undefined
  let backgroundStatsTimer: ReturnType<typeof setTimeout> | undefined
  let backgroundStatsCursor = 0
  let statsRequestId = 0

  async function refreshContainers() {
    if (refreshingContainers) return
    refreshingContainers = true

    try {
      const c = await DockerV2.getContainers()
      app.setContainers(c)
      const activeProject = validateActiveProject(c, app.activeContainerProject)
      if (activeProject !== app.activeContainerProject) {
        app.setActiveContainerProject(activeProject)
      }

      const containers = activeProject
        ? c.filter(container => container.project === activeProject)
        : c
      const activeId = validateActiveContainer(containers, app.activeContainer)
      if (activeId !== app.activeContainer) {
        app.setActiveContainer(activeId)
      }

      pruneContainerStats(c)
    } finally {
      refreshingContainers = false
    }
  }

  function getRunningContainerIds(containers = app.containers) {
    return containers
      .filter(container => container.state === "running")
      .map(container => container.id)
  }

  function pruneContainerStats(containers = app.containers) {
    const runningContainerIds = new Set(getRunningContainerIds(containers))
    app.setContainerStats(filterStats(app.containerStats, runningContainerIds))
  }

  function filterStats(stats: Record<string, ContainerStats>, containerIds: Set<string>) {
    const result: Record<string, ContainerStats> = {}

    for (const [containerId, value] of Object.entries(stats)) {
      if (!containerIds.has(containerId)) continue
      result[containerId] = value
    }

    return result
  }

  function selectedContainer() {
    if (!app.activeContainer) return undefined
    return app.containers.find(container => container.id === app.activeContainer)
  }

  function selectedRunningContainerId() {
    const selected = selectedContainer()
    return selected?.state === "running" ? selected.id : undefined
  }

  function selectedStatsTargetIds() {
    if (app.containerListMode === "projects") {
      return selectedProjectContainers()
        .filter(container => container.state === "running")
        .map(container => container.id)
    }

    const selectedId = selectedRunningContainerId()
    return selectedId ? [selectedId] : []
  }

  const statsTargetKey = createMemo(() => selectedStatsTargetIds().join(","))
  const runningContainerKey = createMemo(() => getRunningContainerIds().join(","))

  function mergeContainerStats(stats: Record<string, ContainerStats>) {
    const runningContainerIds = new Set(getRunningContainerIds())
    app.setContainerStats(filterStats({ ...app.containerStats, ...stats }, runningContainerIds))
  }

  function clearStatsRefreshTimer() {
    if (!statsRefreshTimer) return
    clearTimeout(statsRefreshTimer)
    statsRefreshTimer = undefined
  }

  function abortStatsRefresh() {
    statsAbortController?.abort()
    statsAbortController = undefined
  }

  function clearBackgroundStatsTimer() {
    if (!backgroundStatsTimer) return
    clearTimeout(backgroundStatsTimer)
    backgroundStatsTimer = undefined
  }

  function abortBackgroundStatsRefresh() {
    backgroundStatsAbortController?.abort()
    backgroundStatsAbortController = undefined
  }

  function getBackgroundStatsTargetIds() {
    const selectedTargetIds = new Set(selectedStatsTargetIds())
    const targetIds = getRunningContainerIds()
      .filter(containerId => !selectedTargetIds.has(containerId))
    const missingStatsIds = targetIds.filter(containerId => !app.containerStats[containerId])

    return missingStatsIds.length > 0 ? missingStatsIds : targetIds
  }

  function hasMissingBackgroundStats() {
    return getBackgroundStatsTargetIds().some(containerId => !app.containerStats[containerId])
  }

  function scheduleStatsRefresh() {
    clearStatsRefreshTimer()
    if (selectedStatsTargetIds().length === 0) return

    statsRefreshTimer = setTimeout(() => {
      refreshStatsNow()
    }, STATS_REFRESH_MS)
  }

  function refreshStatsNow() {
    clearStatsRefreshTimer()
    clearBackgroundStatsTimer()
    abortBackgroundStatsRefresh()
    const requestId = ++statsRequestId
    abortStatsRefresh()

    const targetIds = selectedStatsTargetIds()
    if (targetIds.length === 0) {
      scheduleBackgroundStatsRefresh(0)
      return
    }

    const controller = new AbortController()
    statsAbortController = controller

    DockerV2.getContainerStats(targetIds, controller.signal)
      .then((stats) => {
        if (controller.signal.aborted || requestId !== statsRequestId) return
        mergeContainerStats(stats)
      })
      .catch(() => {
        // Stats are best-effort; keep cached values visible on transient Docker API failures.
      })
      .finally(() => {
        if (requestId !== statsRequestId) return
        if (statsAbortController === controller) {
          statsAbortController = undefined
        }
        scheduleStatsRefresh()
        scheduleBackgroundStatsRefresh(0)
      })
  }

  function scheduleBackgroundStatsRefresh(delay = STATS_REFRESH_MS) {
    clearBackgroundStatsTimer()
    if (getBackgroundStatsTargetIds().length === 0) return

    backgroundStatsTimer = setTimeout(() => {
      refreshBackgroundStats()
    }, delay)
  }

  function refreshBackgroundStats() {
    clearBackgroundStatsTimer()
    if (statsAbortController) {
      scheduleBackgroundStatsRefresh(500)
      return
    }

    abortBackgroundStatsRefresh()
    const targetIds = getBackgroundStatsTargetIds()
    if (backgroundStatsCursor >= targetIds.length) {
      backgroundStatsCursor = 0
    }

    const targetId = targetIds[backgroundStatsCursor]
    backgroundStatsCursor = (backgroundStatsCursor + 1) % Math.max(targetIds.length, 1)
    if (!targetId) return

    const controller = new AbortController()
    backgroundStatsAbortController = controller

    DockerV2.getContainerStats([targetId], controller.signal)
      .then((stats) => {
        if (controller.signal.aborted) return
        mergeContainerStats(stats)
      })
      .catch(() => {
        // Stats are best-effort; background warming should never block navigation.
      })
      .finally(() => {
        if (backgroundStatsAbortController === controller) {
          backgroundStatsAbortController = undefined
        }
        if (!controller.signal.aborted) {
          scheduleBackgroundStatsRefresh(hasMissingBackgroundStats() ? 0 : STATS_REFRESH_MS)
        }
      })
  }

  onMount(() => {
    refreshContainers().then(() => refreshStatsNow())

    const containerIntervalId = setInterval(() => {
      refreshContainers()
    }, CONTAINER_REFRESH_MS)

    onCleanup(() => {
      clearInterval(containerIntervalId)
      clearStatsRefreshTimer()
      clearBackgroundStatsTimer()
      statsRequestId += 1
      abortStatsRefresh()
      abortBackgroundStatsRefresh()
    })
  })

  createEffect(on(
    statsTargetKey,
    () => {
      refreshStatsNow()
    },
    { defer: true },
  ))

  createEffect(on(
    runningContainerKey,
    () => {
      scheduleBackgroundStatsRefresh(0)
    },
    { defer: true },
  ))

  function validateActiveContainer(containers: Array<Container>, activeId: string | null) {
    if (!activeId) return containers[0]?.id ?? null
    const exists = containers.find(c => c.id === activeId)
    return exists ? activeId : containers[0]?.id ?? null
  }

  function validateActiveProject(containers: Array<Container>, activeProject: string | null) {
    if (containers.length === 0) return null
    const projectNames = Array.from(new Set(containers.map(container => container.project)))
      .sort((a, b) => a.localeCompare(b))
    if (!activeProject) return projectNames[0]
    const exists = containers.find(c => c.project === activeProject)
    return exists ? activeProject : projectNames[0]
  }

  function getSelectedProjectIndex() {
    if (!app.activeContainerProject) return -1
    return projects().findIndex(project => project.name === app.activeContainerProject)
  }

  function getSelectedIndex() {
    if (!app.activeContainer) {
      return -1
    }

    return selectedProjectContainers().findIndex(c => c.id === app.activeContainer)
  }

  function selectProject(project: string | null) {
    app.setActiveContainerProject(project)
    const container = app.containers.find(container => container.project === project)
    app.setActiveContainer(container?.id ?? null)
    refreshStatsNow()
  }

  function enterProject() {
    if (!app.activeContainerProject) return
    app.setContainerListMode("containers")
  }

  function leaveProject() {
    app.setContainerListMode("projects")
  }

  function getProjectStatusColor(project: { total: number, running: number }) {
    if (project.running === project.total) return theme.success
    if (project.running > 0) return theme.warning
    return theme.error
  }

  useKeyboard(key => {
    if (app.rightPanelFocused) return
    if (app.activePane !== "containers") return
    if (dialog.stack.length > 0) return
    if (app.rightSidebarOpen) return

    if (key.name === "right" || key.name === "l") {
      enterProject()
      return
    }

    if (key.name === "left" || key.name === "h") {
      leaveProject()
      return
    }

    if (keybind.match("up", key)) {
      if (app.containerListMode === "projects") {
        const index = getSelectedProjectIndex()
        if (index === -1 && projects().length > 0) {
          selectProject(projects()[projects().length - 1].name)
          return
        }

        if (index <= 0) {
          return
        }

        selectProject(projects()[index - 1].name)
        return
      }

      const index = getSelectedIndex()
      const containers = selectedProjectContainers()
      if (index === -1 && containers.length > 0) {
        app.setActiveContainer(containers[containers.length - 1].id)
        return
      }

      if (index <= 0) {
        return
      }

      const newSelected = containers[index - 1]
      app.setActiveContainer(newSelected.id)
    }

    if (keybind.match("down", key)) {
      if (app.containerListMode === "projects") {
        const index = getSelectedProjectIndex()
        if (index === -1 && projects().length > 0) {
          selectProject(projects()[0].name)
          return
        }

        if (index >= projects().length - 1) {
          return
        }

        selectProject(projects()[index + 1].name)
        return
      }

      const index = getSelectedIndex()
      const containers = selectedProjectContainers()

      if (index === -1 && containers.length > 0) {
        app.setActiveContainer(containers[0].id)
        return
      }

      if (index >= containers.length - 1) {
        return
      }

      const newSelected = containers[index + 1]
      app.setActiveContainer(newSelected.id)
    }
  })

  createEffect(() => {
    if (!app.activeContainerProject && projects().length > 0) {
      selectProject(projects()[0].name)
      return
    }

    if (!app.activeContainer && selectedProjectContainers().length > 0) {
      app.setActiveContainer(selectedProjectContainers()[0].id)
    }
  })

  createEffect(() => {
    setActive(app.activePane === "containers")
  })

  return (
    <Pane
      title={app.containerListMode === "projects" ? "Projects" : app.activeContainerProject ?? "Containers"}
      shortcut={app.rightPanelFocused ? undefined : "1"}
      width="100%"
      flexGrow={active() ? 1 : 0}
      flexShrink={1}
      borderColor={() => (active() && !app.filtering && !app.searching && !app.logsFocused && !app.shellFocused ? theme.border : theme.backgroundPanel)}
      active={active()}
      subtitle={
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.textMuted}>
            {app.containerListMode === "projects" ? projects().length : selectedProjectContainers().length}
          </text>
        </box>
      }
    >
      <Show when={active()}>
        <Switch>
          <Match when={app.containers.length > 0 && app.containerListMode === "projects"}>
            <box flexDirection="column" width="100%">
              <For each={projects()}>
                {(project) => {
                  const isActive = () => app.activeContainerProject === project.name
                  return (
                    <box
                      backgroundColor={isActive() ? theme.border : undefined}
                      flexDirection="row"
                      gap={1}
                      paddingLeft={1}
                      paddingRight={1}
                    >
                      <text
                        fg={isActive() ? theme.text : theme.textMuted}
                        attributes={isActive() ? TextAttributes.BOLD : undefined}
                        flexShrink={1}
                        flexGrow={1}
                        wrapMode="none"
                      >
                        {project.name}
                      </text>
                      <text
                        fg={getProjectStatusColor(project)}
                        attributes={isActive() ? TextAttributes.BOLD : undefined}
                        flexShrink={0}
                      >
                        ●
                      </text>
                      <text
                        fg={isActive() ? theme.text : theme.textMuted}
                        attributes={isActive() ? TextAttributes.BOLD : undefined}
                        flexShrink={0}
                      >
                        {project.running}/{project.total}
                      </text>
                    </box>
                  )
                }}
              </For>
            </box>
          </Match>
          <Match when={app.containers.length > 0 && app.containerListMode === "containers"}>
            <box flexDirection="column" width="100%">
              <For each={selectedProjectContainers()}>
                {(container: Container) => {
                  const isActive = () => app.activeContainer === container.id
                  return (
                    <box
                      backgroundColor={isActive() ? theme.border : undefined}
                      flexDirection="row"
                      gap={1}
                      paddingLeft={1}
                      paddingRight={1}
                    >
                      <text
                        fg={getColorForContainerState(
                          isActive(),
                          container.status,
                          container.state
                        )}
                        attributes={
                          isActive() ? TextAttributes.BOLD : undefined
                        }
                        flexShrink={0}
                      >
                        {container.state.padEnd(maxStateLength())}
                      </text>
                      <text
                        fg={
                          isActive()
                            ? theme.text
                            : theme.textMuted
                        }
                        attributes={
                          isActive() ? TextAttributes.BOLD : undefined
                        }
                        flexShrink={1}
                        flexGrow={1}
                        wrapMode="none"
                      >
                        {container.name}
                      </text>
                    </box>
                  )
                }}
              </For>
            </box>
          </Match>
          <Match when={app.containers.length === 0}>
            <box flexDirection="column" width="100%">
              <box paddingLeft={1} paddingRight={1} paddingBottom={1}>
                <text fg={theme.textMuted}>No containers found</text>
              </box>
            </box>
          </Match>
        </Switch>
      </Show>
    </Pane>
  )
}
