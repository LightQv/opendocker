import { Show } from "solid-js"
import ContainerHeader from "@/components/panes/container/header"
import ContainerLogs from "@/components/panes/container/logs"
import ContainerFilter from "@/components/panes/container/filter"
import ContainerShell from "@/components/panes/container/shell"
import ImageConfig from "@/components/panes/image/config"
import ImageHistory from "@/components/panes/image/history"
import VolumeConfig from "@/components/panes/volume/config"
import { useApplication } from "@/context/application"

export default function Main() {
  const app = useApplication()

  return (
    <box flexDirection="column" gap={1} flexGrow={1} height="100%">
      <Show when={app.activePane === "containers"}>
        <ContainerHeader />
        <Show when={app.shellFocused} fallback={
          <>
            <ContainerLogs />
            <Show when={app.containerListMode === "containers"}>
              <ContainerFilter />
            </Show>
          </>
        }>
          <ContainerShell />
        </Show>
      </Show>
      <Show when={app.activePane === "images"}>
        <ImageConfig />
        <ImageHistory />
      </Show>
      <Show when={app.activePane === "volumes"}>
        <VolumeConfig />
      </Show>
    </box>
  )
}
