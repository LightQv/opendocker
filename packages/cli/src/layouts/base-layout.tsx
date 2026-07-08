import type { JSX } from "solid-js"
import { Toast } from "@/ui/toast"
import { Docker } from "@/lib/docker"
import { useApplication, type Container, type ContainerStats, type Image, type Volume } from "@/context/application"
import Footer from "@/components/footer"
import { useTheme } from "@/context/theme"
import { RGBA } from "@opentui/core"
import { createEffect, createSignal, Show, onCleanup, onMount } from "solid-js"
import RightSidebar from "@/components/right-sidebar"
import { useKV } from "@/context/kv"

const DOCKER_SNAPSHOT_KEY = "docker_snapshot_v1"

type DockerSnapshot = {
  version: 1
  savedAt: number
  containers: Container[]
  images: Image[]
  volumes: Volume[]
  containerStats: Record<string, ContainerStats>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseSnapshot(value: unknown): DockerSnapshot | undefined {
  if (!isRecord(value)) return undefined
  if (value.version !== 1) return undefined
  if (!Array.isArray(value.containers)) return undefined
  if (!Array.isArray(value.images)) return undefined
  if (!Array.isArray(value.volumes)) return undefined
  if (!isRecord(value.containerStats)) return undefined

  return value as DockerSnapshot
}

function cloneContainer(container: Container): Container {
  return {
    ...container,
    composeConfigFiles: [...container.composeConfigFiles],
    volumeNames: container.volumeNames ? [...container.volumeNames] : undefined,
    ports: container.ports.map(port => ({ ...port })),
  }
}

function cloneVolume(volume: Volume): Volume {
  return {
    ...volume,
    labels: { ...volume.labels },
    options: volume.options ? { ...volume.options } : null,
    status: volume.status ? { ...volume.status } : null,
  }
}

export function BaseLayout({ children }: { children: JSX.Element }) {
  const app = useApplication()
  const kv = useKV()
  const theme = useTheme().theme
  const [snapshotHydrated, setSnapshotHydrated] = createSignal(false)
  let snapshotSaveTimer: ReturnType<typeof setTimeout> | undefined

  onMount(() => {
    createDockerInstance()
  })

  createEffect(() => {
    if (!kv.ready || snapshotHydrated()) return

    const snapshot = parseSnapshot(kv.get(DOCKER_SNAPSHOT_KEY))
    if (snapshot) {
      if (app.containers.length === 0) app.setContainers(snapshot.containers)
      if (app.images.length === 0) app.setImages(snapshot.images)
      if (app.volumes.length === 0) app.setVolumes(snapshot.volumes)
      if (Object.keys(app.containerStats).length === 0) app.setContainerStats(snapshot.containerStats)
    }

    setSnapshotHydrated(true)
  })

  createEffect(() => {
    if (!kv.ready || !snapshotHydrated()) return

    const fingerprint = [
      app.containers.map(container => `${container.id}:${container.state}:${container.imageId ?? ""}:${(container.volumeNames ?? []).join(",")}`).join("|"),
      app.images.map(image => `${image.id}:${image.name}:${image.tag}:${image.used}`).join("|"),
      app.volumes.map(volume => `${volume.name}:${volume.used}`).join("|"),
      Object.values(app.containerStats).map(stats => `${stats.id}:${stats.cpuPercent}:${stats.memoryUsage}:${stats.memoryLimit}`).join("|"),
    ].join("\n")
    void fingerprint

    scheduleSnapshotSave()
  })

  onCleanup(() => {
    if (snapshotSaveTimer) clearTimeout(snapshotSaveTimer)
  })

  function createDockerInstance() {
    const d = Docker.getInstance()
    app.setDocker(d)
  }

  function scheduleSnapshotSave() {
    if (app.containers.length === 0 && app.images.length === 0 && app.volumes.length === 0) return
    if (snapshotSaveTimer) clearTimeout(snapshotSaveTimer)

    snapshotSaveTimer = setTimeout(() => {
      snapshotSaveTimer = undefined
      kv.set(DOCKER_SNAPSHOT_KEY, {
        version: 1,
        savedAt: Date.now(),
        containers: app.containers.map(cloneContainer),
        images: app.images.map(image => ({ ...image })),
        volumes: app.volumes.map(cloneVolume),
        containerStats: Object.fromEntries(
          Object.entries(app.containerStats).map(([containerId, stats]) => [containerId, { ...stats }]),
        ),
      } satisfies DockerSnapshot)
    }, 250)
  }

  return (
    <>
      <Toast />
      <box width="100%" height="100%" backgroundColor={theme.background}>
        <box height="100%" width="100%" padding={1}>
          {children}
        </box>
        <Footer />
      </box>
      <Show when={app.rightSidebarOpen}>
        <box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          alignItems="flex-end"
          backgroundColor={RGBA.fromInts(0, 0, 0, 70)}
        >
          <RightSidebar overlay />
        </box>
      </Show>
    </>
  )
}
