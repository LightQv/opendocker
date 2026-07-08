import { z } from "zod"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import type { Docker } from "@/lib/docker"
import { KeybindsConfig, ShellConfig, type ShellSelection } from "@/util/config"
import { useKV } from "./kv"

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

const ContainerPort = z.object({
  hostIp: z.string().optional().describe("Published host IP"),
  privatePort: z.number().describe("Container port"),
  publicPort: z.number().optional().describe("Published host port"),
  type: z.string().describe("Port protocol"),
})
export type ContainerPort = z.infer<typeof ContainerPort>

const Container = z.object({
  id: z.string().describe("Unique container identifier"),
  name: z.string().describe("Container name"),
  project: z.string().describe("Docker Compose project or Standalone group"),
  service: z.string().optional().describe("Docker Compose service name"),
  composeWorkingDir: z.string().optional().describe("Docker Compose project working directory"),
  composeConfigFiles: z.array(z.string()).describe("Docker Compose config files"),
  ports: z.array(ContainerPort).describe("Container port mappings"),
  state: z.string().describe("Container state (e.g. running, stopped)"),
  status: z.string().describe("Container status message"),
})
export type Container = z.infer<typeof Container>

const ContainerStats = z.object({
  id: z.string().describe("Unique container identifier"),
  cpuPercent: z.number().describe("Container CPU usage percentage"),
  memoryPercent: z.number().describe("Container memory usage percentage"),
  memoryUsage: z.number().describe("Container memory usage in bytes"),
  memoryLimit: z.number().describe("Container memory limit in bytes"),
})
export type ContainerStats = z.infer<typeof ContainerStats>

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
  shell: ShellConfig,
}

type ShellSessionStatus = "opening" | "running" | "exited" | "error"

type ShellSessionState = {
  containerId: string
  status: ShellSessionStatus
  version: number
  error: string | null
  generation: number
}

type ShellState = {
  activeContainerId: string | null
  sessions: Record<string, ShellSessionState>
  generation: number
  returnFocus: ContainerFocus
}

function normalizeShellReturnFocus(focus: ContainerFocus): ContainerFocus {
  switch (focus) {
    case "filter":
    case "searchEdit":
    case "searchActive":
      return "logs"
    case "shell":
      return "list"
    default:
      return focus
  }
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
    const kv = useKV()
    const parsedShell = ShellConfig.safeParse({ selection: kv.get("shell", "auto") })
    const [store, setStore] = createStore<{
      containers: Array<Container>
      containerStats: Record<string, ContainerStats>
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
      containerStats: {},
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
        generation: 0,
        returnFocus: "list",
      },
      config: {
        keybinds: KeybindsConfig.parse({}),
        shell: parsedShell.success ? parsedShell.data : ShellConfig.parse({}),
      },
    })

    return {
      get containers() { return store.containers },
      get containerStats() { return store.containerStats },
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
        const status = store.shell.sessions[store.activeContainer]?.status
        return status === "opening" || status === "running"
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
      setContainerStats: (v: Record<string, ContainerStats>) => setStore("containerStats", v),
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
        const returnFocus = store.activeView.pane === "containers"
          ? normalizeShellReturnFocus(store.activeView.focus)
          : "list"

        setStore("shell", "activeContainerId", containerId)
        setStore("shell", "returnFocus", returnFocus)

        const existing = store.shell.sessions[containerId]
        if (!existing || existing.status === "exited" || existing.status === "error") {
          const generation = store.shell.generation + 1
          setStore("shell", "generation", generation)
          setStore("shell", "sessions", containerId, {
            containerId,
            status: "opening",
            version: 0,
            error: null,
            generation,
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
          generation: existing?.generation ?? store.shell.generation,
        })
      },
      bumpContainerShellVersion: (containerId: string) => {
        const existing = store.shell.sessions[containerId]
        if (!existing) return
        setStore("shell", "sessions", containerId, {
          containerId,
          status: existing.status,
          version: existing.version + 1,
          error: existing.error,
          generation: existing.generation,
        })
      },
      detachContainerShell: () => {
        setStore("shell", "activeContainerId", null)
        setStore("activeView", { pane: "containers", focus: store.shell.returnFocus })
      },
      closeContainerShell: (containerId: string) => {
        setStore("shell", "sessions", containerId, undefined!)
        if (store.shell.activeContainerId === containerId) {
          setStore("shell", "activeContainerId", null)
          setStore("activeView", { pane: "containers", focus: store.shell.returnFocus })
        }
      },
      setShellSelection: (selection: ShellSelection) => {
        const shell = ShellConfig.parse({ selection })
        setStore("config", "shell", shell)
        kv.set("shell", selection)
      },
      setConfig: (v: Config) => setStore("config", v),
    }
  },
})
