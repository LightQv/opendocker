import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import {
  createEffect,
  createSignal,
  For,
  Match,
  on,
  onMount,
  Switch,
  onCleanup,
  Show,
} from "solid-js"
import { useApplication } from "@/context/application"
import type { Image } from "@/context/application"
import { Pane } from "@/ui/pane"
import { useTheme } from "@/context/theme"
import { Spinner } from "@/components/spinner"
import { useKeybind } from "@/context/keybind"
import { useDialog } from "@/ui/dialog"
import { DialogConfirm } from "@/ui/dialog-confirm"
import { useToast } from "@/ui/toast"
import { DockerV2 } from "@/lib/docker-v2"
import { applyImageUsage } from "@/util/docker-resources"

export default function List() {
  const keybind = useKeybind()
  const app = useApplication()
  const dialog = useDialog()
  const toast = useToast()
  const theme = useTheme().theme
  const [loaded, setLoaded] = createSignal<boolean>(true)
  const [active, setActive] = createSignal<boolean>(false)
  let refreshingImages = false

  function validateActiveImage(images: Array<Image>, activeId: string | null) {
    if (!activeId) return images[0]?.id
    const exists = images.find((i: Image) => i.id === activeId)
    return exists ? activeId : images[0]?.id
  }

  async function imagePulse() {
    if (refreshingImages) return

    refreshingImages = true

    try {
      const images = await DockerV2.getImages().catch(() => undefined)
      if (!images) return

      const fetchedImages = applyImageUsage(preserveUsage(images), app.containers)
      app.setImages(fetchedImages)

      const validActiveId = validateActiveImage(fetchedImages, app.activeImage)
      if (validActiveId !== app.activeImage) {
        app.setActiveImage(validActiveId)
      }

      setLoaded(true)
    } finally {
      refreshingImages = false
    }
  }

  function preserveUsage(images: Array<Image>) {
    const usedById = new Map(app.images.map(image => [image.id, image.used]))
    return images.map(image => ({ ...image, used: usedById.get(image.id) ?? image.used }))
  }

  onMount(() => {
    imagePulse()

    const intervalId = setInterval(() => {
      imagePulse()
    }, 1000)

    onCleanup(() => {
      clearInterval(intervalId)
    })
  })

  function getSelectedIndex() {
    if (!app.activeImage) {
      return -1
    }

    return app.images.findIndex(i => i.id === app.activeImage)
  }

  function selectedImage() {
    if (!app.activeImage) return undefined
    return app.images.find(image => image.id === app.activeImage)
  }

  function confirmRemoveImage(image: Image) {
    const label = `${image.name}:${image.tag}`
    dialog.replace(() => (
      <DialogConfirm
        title="Remove image?"
        message={`This will remove ${label}. Docker will fail if the image is used by a container.`}
        confirmLabel="Remove"
        danger
        onConfirm={() => {
          toast.show({
            variant: "info",
            message: "Removing image",
          })
          app.docker?.removeImage(image.id).catch(toast.error)
        }}
      />
    ))
  }

  useKeyboard(key => {
    if (app.filtering) return
    if (app.activePane !== "images") return
    if (dialog.stack.length > 0) return
    if (app.rightSidebarOpen) return

    if (keybind.match("up", key)) {
      const index = getSelectedIndex()
      if (index === -1 && app.images.length > 0) {
        app.setActiveImage(app.images[app.images.length - 1].id)
        return
      }

      if (index <= 0) {
        return
      }

      const newSelected = app.images[index - 1]
      app.setActiveImage(newSelected.id)
    }

    if (keybind.match("down", key)) {
      const index = getSelectedIndex()

      if (index === -1 && app.images.length > 0) {
        app.setActiveImage(app.images[0].id)
        return
      }

      if (index >= app.images.length - 1) {
        return
      }

      const newSelected = app.images[index + 1]
      app.setActiveImage(newSelected.id)
    }

    if (keybind.match("resource_remove", key)) {
      const image = selectedImage()
      if (!image) return
      confirmRemoveImage(image)
    }
  })

  createEffect(() => {
    if (!app.activeImage && app.images.length > 0) {
      app.setActiveImage(app.images[0].id)
    }
  })

  createEffect(on(
    () => app.containers.map(container => `${container.id}:${container.imageId ?? ""}`).join("|"),
    () => {
      if (app.images.length === 0) return
      app.setImages(applyImageUsage(app.images, app.containers))
    },
    { defer: true },
  ))

  createEffect(() => {
    setActive(app.activePane === "images")
  })

  return (
    <Pane
      title="Images"
      shortcut={app.rightPanelFocused ? undefined : "2"}
      width="100%"
      flexGrow={active() ? 1 : 0}
      flexShrink={1}
      borderColor={() => active() ? theme.success : theme.backgroundPanel}
      active={active()}
      subtitle={
        <box flexDirection="row" gap={1}>
          <Show when={app.images.length === 0 && !loaded() && active()}>
            <Spinner />
          </Show>
          <Show when={loaded() || app.images.length > 0 || !active()}>
            <text fg={theme.textMuted}>
              {app.images.length}
            </text>
          </Show>
        </box>
      }
    >
      <Show when={active()}>
        <Switch>
          <Match when={app.images.length > 0}>
            <box flexDirection="column" width="100%">
              <For each={app.images}>
                {(image: Image) => {
                  const isActive = () => app.activeImage === image.id
                  return (
                    <box
                      backgroundColor={isActive() ? theme.success : undefined}
                      flexDirection="row"
                      gap={1}
                        paddingLeft={1}
                        paddingRight={1}
                      >
                        <text
                          fg={
                            isActive()
                            ? theme.backgroundPanel
                            : theme.textMuted
                        }
                        attributes={
                          isActive() ? TextAttributes.BOLD : undefined
                        }
                        flexShrink={1}
                        flexGrow={1}
                        wrapMode="none"
                      >
                        {image.name}
                      </text>
                    </box>
                  )
                }}
              </For>
            </box>
          </Match>
          <Match when={app.images.length === 0 && loaded()}>
            <box flexDirection="column" width="100%">
              <box paddingLeft={1} paddingRight={1} paddingBottom={1}>
                <text fg={theme.textMuted}>No images found</text>
              </box>
            </box>
          </Match>
        </Switch>
      </Show>
    </Pane>
  )
}
