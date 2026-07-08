import { useKeyboard, useRenderer } from "@opentui/solid"
import { createEffect, ErrorBoundary, onMount } from "solid-js"
import { ErrorComponent } from "@/components/error-component"
import { BaseLayout } from "@/layouts/base-layout"
import LeftSidebar from "@/components/left-sidebar"
import Main from "@/components/main"
import { ToastProvider, useToast } from "@/ui/toast"
import { Clipboard } from "@/util/clipboard"
import { ApplicationProvider, useApplication } from "@/context/application"
import { KeybindProvider, useKeybind } from "@/context/keybind"
import { ThemeProvider } from "@/context/theme"
import { KVProvider } from "@/context/kv"
import { useKV } from "@/context/kv"
import { DialogProvider, useDialog } from "@/ui/dialog"
import { DialogConfirm } from "@/ui/dialog-confirm"
import ThemesDialog from "@/components/dialogs/themes"
import SettingsDialog from "@/components/dialogs/settings"
import { ContainerShell } from "@/lib/container-shell"

const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000
const UPDATE_INSTALLER_URL = "https://github.com/LightQv/opendocker/releases/latest/download/install.sh"
const UPDATE_RELEASE_URL = "https://api.github.com/repos/LightQv/opendocker/releases/latest"

export function tui() {
  return (
    <ToastProvider>
      <KVProvider>
        <ApplicationProvider>
          <ThemeProvider mode="dark">
            <KeybindProvider>
              <DialogProvider>
                <BaseLayout>
                  <ErrorBoundary fallback={(error, _) => <ErrorComponent error={error} />}>
                    <App />
                  </ErrorBoundary>
                </BaseLayout>
              </DialogProvider>
            </KeybindProvider>
          </ThemeProvider>
        </ApplicationProvider>
      </KVProvider>
    </ToastProvider>
  )
}

function App() {
  const renderer = useRenderer()
  const toast = useToast()
  const app = useApplication()
  const keybind = useKeybind()
  const dialog = useDialog()
  const kv = useKV()
  let updateCheckStarted = false

  useKeyboard(event => {
    if (dialog.stack.length > 0) return

    if (app.shellFocused) return

    if (keybind.match("open_settings", event)) {
      event.preventDefault()
      event.stopPropagation()
      dialog.replace(() => <SettingsDialog />)
      return
    }

    if (
      event.name === "tab" &&
      app.activePane === "containers" &&
      app.containerListMode === "containers" &&
      app.activeContainer
    ) {
      event.preventDefault()
      if (app.filtering || app.editingSearch) {
        app.stopContainerFilter()
        app.focusContainerLogs()
        return
      }
      app.toggleContainerLogsFocus()
      return
    }

    if (app.filtering) return

    if (keybind.match("app_exit", event)) {
      exit()
    }

    if (keybind.match("debug_toggle", event)) {
      renderer?.console.toggle()
      renderer?.toggleDebugOverlay()
    }

    if (keybind.match("theme_list", event)) {
      dialog.replace(() => <ThemesDialog title="Themes" />)
    }

    if (
      keybind.match("sidebar_toggle", event)
      || (app.rightSidebarOpen && event.name === "escape")
    ) {
      app.toggleRightSidebar()
    }
  })

  function exit() {
    ContainerShell.quitAll()
    renderer.setTerminalTitle("")
    renderer.destroy()
    process.exit(0)
  }

  async function confirmDialog(props: {
    title: string
    message: string
    confirmLabel: string
    cancelLabel: string
    danger?: boolean
  }) {
    return new Promise<boolean | undefined>((resolve) => {
      let resolved = false
      function finish(value: boolean | undefined) {
        if (resolved) return
        resolved = true
        resolve(value)
      }

      dialog.replace(
        () => (
          <DialogConfirm
            title={props.title}
            message={props.message}
            confirmLabel={props.confirmLabel}
            cancelLabel={props.cancelLabel}
            danger={props.danger}
            onConfirm={() => finish(true)}
            onCancel={() => finish(false)}
          />
        ),
        () => finish(undefined),
      )
    })
  }

  function isVersionGreater(left: string, right: string) {
    const parse = (value: string) => {
      const [core, prerelease] = value.replace(/^v/, "").split("-", 2)
      return {
        core: core.split(".").map(part => Number.parseInt(part, 10) || 0),
        prerelease,
      }
    }
    const a = parse(left)
    const b = parse(right)
    for (let index = 0; index < Math.max(a.core.length, b.core.length); index++) {
      const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0)
      if (difference) return difference > 0
    }
    if (a.prerelease === b.prerelease) return false
    if (!a.prerelease) return true
    if (!b.prerelease) return false
    return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true }) > 0
  }

  async function getLatestVersion() {
    const response = await fetch(UPDATE_RELEASE_URL, {
      headers: {
        "Accept": "application/vnd.github+json",
      },
    })
    if (!response.ok) throw new Error(`Update check failed: ${response.status}`)
    const release = await response.json() as { tag_name?: string }
    if (!release.tag_name) throw new Error("Update check failed: release tag missing")
    return release.tag_name.replace(/^v/, "")
  }

  async function runInstaller(version: string) {
    const install = Bun.spawn(["sh", "-c", `curl -fsSL ${UPDATE_INSTALLER_URL} | sh`], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENDOCKER_VERSION: version,
        OPENDOCKER_INSTALL_COLIMA: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    })

    const [exitCode, stdout, stderr] = await Promise.all([
      install.exited,
      new Response(install.stdout).text(),
      new Response(install.stderr).text(),
    ])

    if (exitCode !== 0) {
      const message = stderr.trim() || stdout.trim() || `Installer exited with code ${exitCode}`
      throw new Error(message)
    }
  }

  function restart() {
    ContainerShell.quitAll()
    renderer.setTerminalTitle("")
    renderer.destroy()
    Bun.spawn([process.execPath, ...process.argv.slice(1)], {
      cwd: process.cwd(),
      env: process.env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    process.exit(0)
  }

  async function checkForUpdates() {
    const version = typeof OPENDOCKER_VERSION !== "undefined" ? OPENDOCKER_VERSION : "local"
    if (version === "local") return
    if (!kv.ready) return

    const lastCheck = kv.get("update_last_check_at", 0)
    if (Date.now() - lastCheck < UPDATE_CHECK_INTERVAL) return
    kv.set("update_last_check_at", Date.now())

    const latest = await getLatestVersion().catch(() => undefined)
    if (!latest) return
    if (!isVersionGreater(latest, version)) return

    const skipped = kv.get("update_skipped_version")
    if (skipped && !isVersionGreater(latest, skipped)) return

    const choice = await confirmDialog({
      title: "Update Available",
      message: `OpenDocker v${latest} is available. Update now?`,
      confirmLabel: "Update",
      cancelLabel: "Skip",
    })

    if (choice === false) {
      kv.set("update_skipped_version", latest)
      return
    }
    if (choice !== true) return

    toast.show({
      variant: "info",
      message: `Updating to v${latest}...`,
      duration: 30000,
    })

    const updated = await runInstaller(latest).then(() => true).catch(error => {
      toast.error(error)
      return false
    })
    if (!updated) return

    const restartNow = await confirmDialog({
      title: "Update Complete",
      message: `OpenDocker updated to v${latest}. Restart now?`,
      confirmLabel: "Restart",
      cancelLabel: "Later",
    })

    if (restartNow) restart()
  }

  function setup() {
    if (!kv.ready) return
    if (updateCheckStarted) return
    updateCheckStarted = true
    checkForUpdates()
  }

  createEffect(() => {
    if (kv.ready) setup()
  })

  createEffect(() => {
    const containersById = new Map(app.containers.map(container => [container.id, container]))

    for (const session of Object.values(app.shell.sessions)) {
      if (!session) continue

      const container = containersById.get(session.containerId)
      if (container?.state === "running") continue

      ContainerShell.quit(session.containerId)
      app.closeContainerShell(session.containerId)
    }
  })

  onMount(() => {
    setup()
  })

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="row"
      gap={1}
      onMouseUp={async () => {
        const text = renderer.getSelection()?.getSelectedText()
        if (text && text.length > 0) {
          const base64 = Buffer.from(text).toString("base64")
          const osc52 = `\x1b]52;c;${base64}\x07`
          const finalOsc52 = process.env["TMUX"] ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
          /* @ts-expect-error */
          renderer.writeOut(finalOsc52)
          await Clipboard.copy(text)
          .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
          .catch(toast.error)
          renderer.clearSelection()
        }
      }}
    >
      <LeftSidebar />
      <Main />
    </box>
  )
}
