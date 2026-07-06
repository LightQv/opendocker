import { z } from "zod"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import type { Docker } from "@/lib/docker"
import { KeybindsConfig } from "@/util/config"

const Pane = z.enum(["containers", "images", "volumes"])
type Pane = z.infer<typeof Pane>

const ContainerFocus = z.enum(["list", "logs", "filter", "searchEdit", "searchActive", "shell"])
type ContainerFocus = z.infer<typeof ContainerFocus>

const ActiveView = z.discriminatedUnion("pane", [
  z.object({
    pane: z.literal("containers"),
    focus: ContainerFocus,
  }),
  z.object({
    pane: z.literal("images"),
  }),
  z.object({
    pane: z.literal("volumes"),
  }),
])
type ActiveView = z.infer<typeof ActiveView>

const Container = z.object({
  id: z.string().describe("Unique container identifier"),
  name: z.string().describe("Container name"),
  project: z.string().describe("Docker Compose project or Standalone group"),
  service: z.string().optional().describe("Docker Compose service name"),
  composeWorkingDir: z.string().optional().describe("Docker Compose project working directory"),
  composeConfigFiles: z.array(z.string()).describe("Docker Compose config files"),
  state: z.string().describe("Container state (e.g. running, stopped)"),
  status: z.string().describe("Container status message"),
})
export type Container = z.infer<typeof Container>

export type ContainerListMode = "projects" | "containers"

const Image = z.object({
  id: z.string().describe("Unique image identifier"),
  name: z.string().describe("Image name"),
  tag: z.string().describe("Image tag"),
  size: z.string().describe("Image size"),
  created: z.string().describe("Image creation date"),
  used: z.boolean().describe("Whether any container references this image"),
})
export type Image = z.infer<typeof Image>

const Volume = z.object({
  name: z.string().describe("Volume name"),
  driver: z.string().describe("Volume driver"),
  scope: z.string().describe("Volume scope"),
  mountpoint: z.string().describe("Volume mountpoint"),
  labels: z.record(z.string(), z.string()).describe("Volume labels"),
  options: z.record(z.string(), z.string()).nullable().describe("Volume options"),
  status: z.record(z.string(), z.string()).nullable().describe("Volume status"),
  used: z.boolean().describe("Whether any container mounts this volume"),
})
export type Volume = z.infer<typeof Volume>

type Config = {
  theme?: string,
  keybinds: KeybindsConfig,
}

type ShellSessionStatus = "running" | "exited" | "error"

type ShellSessionState = {
  containerId: string
  status: ShellSessionStatus
  version: number
  error: string | null
}

type ShellState = {
  activeContainerId: string | null
  sessions: Record<string, ShellSessionState>
}

function getViewForPane(pane: Pane): ActiveView {
  switch (pane) {
    case "containers":
      return { pane, focus: "list" }
    case "images":
      return { pane }
    case "volumes":
      return { pane }
  }
}

export const { use: useApplication, provider: ApplicationProvider } = createSimpleContext({
  name: "Application",
  init: () => {
    const [store, setStore] = createStore<{
      containers: Array<Container>
      images: Array<Image>
      volumes: Array<Volume>
      activeContainer: string | null
      activeContainerProject: string | null
      containerListMode: ContainerListMode
      activeImage: string | null
      activeVolume: string | null
      rightSidebarOpen: boolean
      docker: Docker | null
      activeView: ActiveView
      previousContainerFocus: ContainerFocus
      returnToLogsAfterSearch: boolean
      filters: Record<string, string>
      searches: Record<string, string>
      searchIndexes: Record<string, number>
      searchMatchCounts: Record<string, number>
      logsPaused: boolean
      shell: ShellState
      config: Config
    }>({
      containers: [],
      images: [],
      volumes: [],
      activeContainer: null,
      activeContainerProject: null,
      containerListMode: "projects",
      activeImage: null,
      activeVolume: null,
      rightSidebarOpen: false,
      docker: null,
      activeView: { pane: "containers", focus: "list" },
      previousContainerFocus: "list",
      returnToLogsAfterSearch: false,
      filters: {},
      searches: {},
      searchIndexes: {},
      searchMatchCounts: {},
      logsPaused: false,
      shell: {
        activeContainerId: null,
        sessions: {},
      },
      config: {
        keybinds: KeybindsConfig.parse({}),
      },
    })

    return {
      get containers() { return store.containers },
      get images() { return store.images },
      get volumes() { return store.volumes },
      get activeContainer() { return store.activeContainer },
      get activeContainerProject() { return store.activeContainerProject },
      get containerListMode() { return store.containerListMode },
      get activeImage() { return store.activeImage },
      get activeVolume() { return store.activeVolume },
      get rightSidebarOpen() { return store.rightSidebarOpen },
      get docker() { return store.docker },
      get activePane() { return store.activeView.pane },
      get filters() { return store.filters },
      get searches() { return store.searches },
      get searchIndexes() { return store.searchIndexes },
      get searchMatchCounts() { return store.searchMatchCounts },
      get logsPaused() { return store.logsPaused },
      get shell() { return store.shell },
      get shellFocused() {
        return store.activeView.pane === "containers" && store.activeView.focus === "shell"
      },
      get activeShellContainer() {
        if (!store.shell.activeContainerId) return undefined
        return store.containers.find(container => container.id === store.shell.activeContainerId)
      },
      get activeShellSession() {
        const containerId = store.shell.activeContainerId
        if (!containerId) return undefined
        return store.shell.sessions[containerId]
      },
      get selectedContainerHasShellSession() {
        if (!store.activeContainer) return false
        return store.shell.sessions[store.activeContainer]?.status === "running"
      },
      get filtering() {
        return store.activeView.pane === "containers" && store.activeView.focus === "filter"
      },
      get searching() {
        return store.activeView.pane === "containers" && (
          store.activeView.focus === "searchEdit" ||
          store.activeView.focus === "searchActive"
        )
      },
      get editingSearch() {
        return store.activeView.pane === "containers" && store.activeView.focus === "searchEdit"
      },
      get logsFocused() {
        return store.activeView.pane === "containers" && store.activeView.focus === "logs"
      },
      get searchActive() {
        return store.activeView.pane === "containers" && store.activeView.focus === "searchActive"
      },
      get rightPanelFocused() {
        return store.activeView.pane === "containers" && store.activeView.focus !== "list"
      },
      get logNavigationActive() {
        return store.activeView.pane === "containers" && (
          store.activeView.focus === "logs" ||
          store.activeView.focus === "searchActive"
        )
      },
      get config() { return store.config },

      setContainers: (v: Array<Container>) => setStore("containers", v),
      setImages: (v: Array<Image>) => setStore("images", v),
      setVolumes: (v: Array<Volume>) => setStore("volumes", v),
      setActiveContainer: (v: string | null) => setStore("activeContainer", v),
      setActiveContainerProject: (v: string | null) => setStore("activeContainerProject", v),
      setContainerListMode: (v: ContainerListMode) => {
        setStore("containerListMode", v)
        if (v === "projects") {
          setStore("activeView", { pane: "containers", focus: "list" })
        }
      },
      setActiveImage: (v: string | null) => setStore("activeImage", v),
      setActiveVolume: (v: string | null) => setStore("activeVolume", v),
      toggleRightSidebar: () => setStore("rightSidebarOpen", open => !open),
      setDocker: (v: Docker | null) => setStore("docker", v),
      focusContainers: () => setStore("activeView", getViewForPane("containers")),
      focusImages: () => setStore("activeView", getViewForPane("images")),
      focusVolumes: () => setStore("activeView", getViewForPane("volumes")),
      startContainerFilter: () => setStore("activeView", { pane: "containers", focus: "filter" }),
      stopContainerFilter: () => {
        setStore("returnToLogsAfterSearch", false)
        setStore("activeView", { pane: "containers", focus: "list" })
      },
      startContainerSearch: () => {
        setStore("returnToLogsAfterSearch", store.activeView.pane === "containers" && store.activeView.focus === "logs")
        setStore("activeView", { pane: "containers", focus: "searchEdit" })
      },
      activateContainerSearch: () => {
        if (store.returnToLogsAfterSearch) {
          setStore("returnToLogsAfterSearch", false)
          setStore("activeView", { pane: "containers", focus: "logs" })
          return
        }
        setStore("activeView", { pane: "containers", focus: "searchActive" })
      },
      stopContainerSearch: () => {
        setStore("returnToLogsAfterSearch", false)
        setStore("activeView", { pane: "containers", focus: "list" })
      },
      focusContainerLogs: () => {
        if (store.activeView.pane !== "containers") return
        if (store.activeView.focus !== "logs") {
          setStore("previousContainerFocus", store.activeView.focus)
        }
        setStore("activeView", { pane: "containers", focus: "logs" })
      },
      unfocusContainerLogs: () => {
        setStore("activeView", { pane: "containers", focus: store.previousContainerFocus })
      },
      toggleContainerLogsFocus: () => {
        if (store.activeView.pane !== "containers") return
        if (store.activeView.focus === "logs") {
          setStore("activeView", { pane: "containers", focus: store.previousContainerFocus })
          return
        }
        if (store.activeView.focus === "filter" || store.activeView.focus === "searchEdit") {
          setStore("returnToLogsAfterSearch", false)
        }
        setStore("previousContainerFocus", store.activeView.focus)
        setStore("activeView", { pane: "containers", focus: "logs" })
      },
      setContainerFilter: (id: string, value: string) => setStore("filters", id, value),
      setContainerSearch: (id: string, value: string) => setStore("searches", id, value),
      setContainerSearchIndex: (id: string, value: number) => setStore("searchIndexes", id, value),
      setContainerSearchMatchCount: (id: string, value: number) => setStore("searchMatchCounts", id, value),
      setLogsPaused: (paused: boolean) => setStore("logsPaused", paused),
      openContainerShell: (containerId: string) => {
        setStore("shell", "activeContainerId", containerId)
        if (!store.shell.sessions[containerId] || store.shell.sessions[containerId].status !== "running") {
          setStore("shell", "sessions", containerId, {
            containerId,
            status: "running",
            version: 0,
            error: null,
          })
        }
        setStore("activeView", { pane: "containers", focus: "shell" })
      },
      markContainerShell: (containerId: string, status: ShellSessionStatus, error: string | null = null) => {
        const existing = store.shell.sessions[containerId]
        setStore("shell", "sessions", containerId, {
          containerId,
          status,
          version: existing?.version ?? 0,
          error,
        })
      },
      bumpContainerShellVersion: (containerId: string) => {
        const existing = store.shell.sessions[containerId]
        setStore("shell", "sessions", containerId, {
          containerId,
          status: existing?.status ?? "running",
          version: (existing?.version ?? 0) + 1,
          error: existing?.error ?? null,
        })
      },
      detachContainerShell: () => {
        setStore("shell", "activeContainerId", null)
        setStore("activeView", { pane: "containers", focus: "list" })
      },
      closeContainerShell: (containerId: string) => {
        setStore("shell", "sessions", containerId, undefined!)
        if (store.shell.activeContainerId === containerId) {
          setStore("shell", "activeContainerId", null)
          setStore("activeView", { pane: "containers", focus: "list" })
        }
      },
      setConfig: (v: Config) => setStore("config", v),
    }
  },
})
