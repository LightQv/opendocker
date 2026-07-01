import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onMount,
  Show,
  Switch,
  onCleanup,
} from "solid-js"
import { useApplication } from "@/context/application"
import type { Container } from "@/context/application"
import { Pane } from "@/ui/pane"
import { getColorForContainerState } from "@/util/colors"
import { useTheme } from "@/context/theme"
import { useKeybind } from "@/context/keybind"
import { DockerV2 } from "@/lib/docker-v2"
import { useDialog } from "@/ui/dialog"

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

  async function setup() {
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
  }

  onMount(() => {
    setup()

    const intervalId = setInterval(() => {
      setup()
    }, 1000)

    onCleanup(() => {
      clearInterval(intervalId)
    })
  })

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
    if (app.filtering) return
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
      shortcut="1"
      width="100%"
      flexGrow={active() ? 1 : 0}
      flexShrink={1}
      borderColor={() => (active() && !app.filtering ? theme.border : theme.backgroundPanel)}
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
