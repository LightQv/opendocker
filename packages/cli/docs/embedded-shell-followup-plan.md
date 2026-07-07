# Embedded Shell Follow-Up Plan

## Goal

Polish and harden the embedded container shell after the first functional implementation.

The current architecture is sound: Docker Exec API with `Tty: true`, raw Docker HTTP upgrade stream, and `@xterm/headless` for terminal state. Remaining work should focus on native terminal feel, lifecycle edge cases, and clear unsupported states.

Out of scope:

- Replacing Docker exec with `node-pty`.
- Adding native addons or sidecar binaries.
- Building remote Docker or Windows named-pipe support in this pass.
- Replacing OpenTUI rendering with a browser terminal.

## Phase Overview

| Phase | Focus | Deliverables |
| --- | --- | --- |
| 1 | State and hints | Deduplicate footer hints, add `opening`, restore detach focus |
| 2 | Terminal behavior | Real scrollback, paste support, styled xterm rendering |
| 3 | Exec lifecycle | Creation timeout, abort, foreground-program-safe quit |
| 4 | Selection and support | Shell picker/config, unsupported Docker connection state |
| 5 | Verification | Manual matrix, build checks, cleanup checks |

Each phase should ship independently once its acceptance criteria pass.

## Phase 1: State And Hints

### Fix Duplicate Footer Hint

Keep one source of truth for `<leader>e shell` in the footer.

Current risk:

- `ContainerKeybinds` can render shell action.
- `Keybinds` also renders an explicit shell action in container list mode.
- Result can be duplicate shell hints.

Implementation notes:

- Prefer keeping shell action in `ContainerKeybinds` because it already owns container-specific labels.
- Remove the extra explicit shell block from `packages/cli/src/components/keybinds/index.tsx`.
- Keep labels consistent: `shell`, `opening shell`, `resume shell`, or `shell unavailable`.
- Hide action in project mode.
- Hide or disable action when embedded shell is unsupported.

Files likely touched:

- `packages/cli/src/components/keybinds/index.tsx`
- `packages/cli/src/components/keybinds/container/index.tsx`
- `packages/cli/src/context/application.tsx`

Acceptance criteria:

- Footer shows exactly one `<leader>e shell` for eligible running containers.
- Footer shows exactly one `<leader>e resume shell` for an existing session.
- Footer never shows shell action in project mode.
- Footer does not show actionable shell keybind when shell is unsupported.

### Add Opening State

Use a distinct `opening` status before Docker exec is attached.

Current risk:

- UI marks shell as `running` before exec startup is complete.
- Slow Docker startup can look like an empty running terminal.

Proposed state:

```ts
type ShellSessionStatus = "opening" | "running" | "exited" | "error"
```

Implementation notes:

- `openContainerShell()` sets `opening` for new sessions.
- `ContainerShell.create()` marks `running` only after exec stream upgrade succeeds and callbacks are attached.
- Existing `running` sessions stay `running` when resumed.
- Repeated opens while `opening` update callbacks and target size only.
- `selectedContainerHasShellSession` should treat both `opening` and `running` as existing shell sessions.
- Shell pane should show `Opening shell...` during startup.

Files likely touched:

- `packages/cli/src/context/application.tsx`
- `packages/cli/src/components/panes/container/shell.tsx`
- `packages/cli/src/components/keybinds/container/index.tsx`
- `packages/cli/src/lib/container-shell.ts`

Acceptance criteria:

- Opening state is visible before prompt appears.
- Slow Docker exec startup never appears as a blank running terminal.
- Repeated `<leader>e` while opening creates only one pending exec.
- Startup errors transition from `opening` to `error`.

### Restore Focus After Detach Or Quit

Detach should return to the previous useful container focus instead of always returning to the list.

Desired behavior:

- Shell opened from logs returns to logs.
- Shell opened from list returns to list.
- Shell opened from filter/search returns to logs, not half-edited input.
- Quit uses the same return target as detach.

Implementation notes:

- Add `shell.returnFocus` or `previousContainerFocusBeforeShell` to app state.
- Capture focus before setting `focus: "shell"`.
- Normalize `filter`, `searchEdit`, and `searchActive` to `logs`.
- Use this return focus in `detachContainerShell()` and `closeContainerShell()`.

Files likely touched:

- `packages/cli/src/context/application.tsx`
- `packages/cli/src/components/panes/container/shell.tsx`

Acceptance criteria:

- Detach from shell opened from logs returns to focused logs.
- Detach from shell opened from list returns to list with logs visible.
- Detach keeps session alive.
- Quit removes session and returns to same focus target.

## Phase 2: Terminal Behavior

### Render Real Scrollback

Render xterm scrollback, not only active viewport rows.

Current risk:

- `@xterm/headless` stores scrollback, but UI snapshot renders only visible rows.
- User cannot scroll command history despite `scrollback: 5000`.
- Current sticky behavior always jumps bottom, even when user wants to inspect older output.

Implementation notes:

- Snapshot normal-buffer rows from `0` to `terminal.buffer.active.length`.
- Cursor row should become `buffer.baseY + buffer.cursorY`.
- Keep `scrollback` capped by config, default `5000`.
- Detect alternate screen buffer and render viewport-only rows for full-screen programs.
- Do not mix `top`, `less`, `vim`, or alternate-screen content into normal command scrollback.
- Track follow mode separately from scrollbox sticky state.
- Disable follow mode when user scrolls up.
- Resume follow mode when user scrolls to bottom, presses end/jump-bottom key, or sends input.

Possible snapshot shape:

```ts
type ContainerShellSnapshot = {
  rows: ShellRow[]
  cursorX: number
  cursorY: number
  alternate: boolean
}
```

Files likely touched:

- `packages/cli/src/lib/container-shell.ts`
- `packages/cli/src/components/panes/container/shell.tsx`

Acceptance criteria:

- `seq 1 6000` can be scrolled back.
- New output does not force bottom while user is scrolled up.
- Scrolling back to bottom resumes live follow.
- Sending input resumes live follow.
- Full-screen programs do not pollute command scrollback after exit.

### Add Paste Support

Use OpenTUI `usePaste` when shell pane is focused.

Desired behavior:

- Paste bypasses per-key translation.
- Paste writes directly to Docker exec stream.
- Paste does not trigger OpenDocker shortcuts.

Implementation notes:

- Use `usePaste` from `@opentui/solid`.
- Ignore paste when shell is not focused.
- Ignore paste while dialogs are open.
- Normalize `\r\n` and `\r` to `\n`.
- Preserve tabs, Unicode, and multiline text.
- Wrap with bracketed paste markers when xterm reports bracketed paste mode.
- Chunk large pastes and respect stream backpressure.
- Consider `ContainerShell.write()` return/backpressure behavior before large paste support.

Possible code shape:

```ts
usePaste(event => {
  if (!app.shellFocused || dialog.stack.length > 0) return
  const containerId = app.shell.activeContainerId
  if (!containerId) return
  ContainerShell.write(containerId, normalizePaste(event.bytes))
})
```

Files likely touched:

- `packages/cli/src/components/panes/container/shell.tsx`
- `packages/cli/src/lib/container-shell.ts`

Acceptance criteria:

- Multiline paste reaches `sh`, `bash`, `ash`, and `zsh`.
- Pasted text is not interpreted as OpenDocker shortcuts.
- Pasting into `vim` with bracketed paste mode does not auto-execute lines.
- Large paste does not freeze UI.

### Render Xterm Styles

Convert xterm buffer cells into styled OpenTUI spans.

Current risk:

- `translateToString()` drops color and text attributes.
- All shell output currently uses muted text color.

Implementation notes:

- Extend snapshots from plain strings to styled row runs.
- Read foreground, background, bold, underline, inverse, dim, and default-color flags from xterm cells.
- Support ANSI 16-color, 256-color, and RGB modes if `@xterm/headless` exposes enough metadata.
- Coalesce adjacent cells with identical style.
- Render empty cells as spaces.
- Skip zero-width continuation cells for wide glyphs.
- Render cursor by reversing the styled cell under cursor.
- Map default colors to theme text and panel background.
- Add a small terminal palette helper instead of scattering color conversion in the component.

Possible types:

```ts
type ShellCellStyle = {
  fg?: RGBA
  bg?: RGBA
  bold?: boolean
  underline?: boolean
  inverse?: boolean
}

type ShellRun = {
  text: string
  style: ShellCellStyle
}

type ShellRow = ShellRun[]
```

Files likely touched:

- `packages/cli/src/lib/container-shell.ts`
- `packages/cli/src/components/panes/container/shell.tsx`
- `packages/cli/src/context/theme.tsx` or new terminal palette helper

Acceptance criteria:

- `ls --color=always` displays colors.
- ANSI red, green, blue, and bright colors render visibly.
- Bold text is visibly distinct.
- Underlined text is visibly underlined.
- Cursor remains visible on colored and inverse cells.

## Phase 3: Exec Lifecycle

### Add Startup Timeout And Abort

Pending shell creation should never hang forever.

Current risk:

- Pending cancellation is logical only.
- In-flight Docker request or stream handshake may continue until Docker returns.

Implementation notes:

- Add `execTimeoutMs`, default `8000`.
- Apply timeout to socket discovery, shell detection, exec create, and exec start upgrade.
- Use `AbortController` where supported.
- Use `req.setTimeout()` for HTTP requests.
- Use `socket.setTimeout()` for raw upgrade stream.
- Store abort handles in `pendingSessions`.
- Abort pending creation on quit, container stop/remove, restart/recreate, and app exit.
- Let detach during `opening` keep pending session alive.
- Keep generation tokens to ignore stale completions.

Files likely touched:

- `packages/cli/src/lib/container-shell.ts`
- `packages/cli/src/context/application.tsx`
- `packages/cli/src/util/config.ts`
- `packages/cli/src/app.tsx`

Acceptance criteria:

- Missing Docker socket reports error within timeout.
- Unsupported or unreachable Docker host does not hang startup.
- `<leader>q` while opening cancels pending creation.
- No prompt appears after cancelled open.
- Pending maps are empty after timeout or abort.

### Make Quit Foreground-Program Safe

Treat `<leader>q` as force-closing the embedded exec session, not as typing `exit` into the foreground program.

Current risk:

- `exit\n` is useful at shell prompt but wrong inside `vim`, `top`, `less`, REPLs, or foreground jobs.
- Foreground program can consume `exit` as text.

Implementation notes:

- For pending sessions, abort creation.
- For running sessions, mark intentional quit and return UI immediately.
- Destroy the hijacked stream to close the TTY.
- Clean session and terminal maps synchronously.
- Do not write `exit\n` before destroy unless testing proves it is needed.
- Inspect the exec after close when possible.
- Warn if Docker still reports the exec as running.
- Keep `ctrl+c`, `ctrl+d`, `q`, and `:q` as normal terminal input.

Files likely touched:

- `packages/cli/src/lib/container-shell.ts`
- `packages/cli/src/components/panes/container/shell.tsx`

Acceptance criteria:

- `<leader>q` from `top` returns to logs quickly.
- `<leader>q` from `less` removes the session.
- `<leader>q` from `vim` does not type `exit` into the buffer.
- Reopening after quit creates a fresh prompt.
- App exit closes all active and pending sessions.

## Phase 4: Selection And Support

### Add Shell Picker And Config

Allow users to choose shell behavior.

Supported modes:

- `auto`
- `bash`
- `zsh`
- `ash`
- `sh`
- `custom`

Proposed config:

```ts
type ShellConfig = {
  command: "auto" | "bash" | "zsh" | "ash" | "sh" | "custom"
  customCommand: string[]
  execTimeoutMs: number
  scrollback: number
}
```

Implementation notes:

- Default `command` is `auto`.
- Auto detection order remains `bash`, `zsh`, `ash`, then `sh`.
- Explicit named shells should fail clearly when missing.
- Custom command should be argv array, not shell-joined string.
- Reuse `DialogSelect` where possible.
- Persist config under existing app config flow.
- Use config values when creating shell sessions.

Possible keybind:

```ts
container_shell_picker: z.string().optional().default("<leader>E")
```

Files likely touched:

- `packages/cli/src/util/config.ts`
- `packages/cli/src/context/application.tsx`
- `packages/cli/src/lib/container-shell.ts`
- `packages/cli/src/components/dialogs/shell.tsx`
- `packages/cli/src/components/keybinds/container/index.tsx`

Acceptance criteria:

- Bash image opens `bash` when selected.
- Alpine auto-detects `ash`.
- Explicit missing `bash` in Alpine shows `bash not found`.
- Custom command runs without shell interpolation.
- Config persists across OpenDocker restarts.

### Gate Unsupported Docker Connections

Detect unsupported Docker connection types before shell startup.

Current risk:

- Raw Unix socket upgrade implementation cannot support every Docker transport.
- Remote contexts or Windows named pipes may fail confusingly.
- App should not silently fall back to local socket when active context is remote.

Proposed connection model:

```ts
type DockerConnection =
  | { status: "available"; socketPath: string }
  | {
      status: "unsupported"
      host: string
      reason: "npipe" | "tcp" | "ssh" | "missing" | "unknown"
    }
```

Implementation notes:

- Split Docker socket resolution into detection and selection.
- Mark `tcp://`, `ssh://`, and `npipe://` as unsupported for embedded shell.
- Preserve Unix socket and Docker Desktop Unix socket support.
- Surface unsupported state in shell pane.
- Hide or disable shell keybind when unsupported.
- Include detected host in error text when safe.
- Keep normal list/log Docker APIs unchanged unless they share the same connection limitation.

Files likely touched:

- `packages/cli/src/lib/docker-v2.ts`
- `packages/cli/src/lib/container-shell.ts`
- `packages/cli/src/context/application.tsx`
- `packages/cli/src/components/panes/container/shell.tsx`
- `packages/cli/src/components/keybinds/container/index.tsx`

Acceptance criteria:

- `DOCKER_HOST=tcp://...` does not crash.
- `DOCKER_HOST=ssh://...` shows shell unavailable.
- `DOCKER_HOST=npipe://...` shows shell unavailable.
- Current remote Docker context never falls back to `/var/run/docker.sock` for embedded shell.
- Local Unix socket behavior remains unchanged.

## Verification Plan

### Automated Checks

Run from `packages/cli` unless noted.

```bash
bun run build --single
bun run build --all
bunx tsc --noEmit
```

Known issue:

- `bunx tsc --noEmit` currently fails because `tsconfig.json` references `bun-types` while dependencies provide `@types/bun`.

### Manual Test Containers

```bash
docker rm -f od-shell-alpine od-shell-bash 2>/dev/null || true
docker run -d --name od-shell-alpine alpine:3.20 sleep 1d
docker run -d --name od-shell-bash bash:5.2 sleep infinity
```

### Manual Terminal Tests

Run inside embedded shell.

```bash
printf '\033[31mred\033[0m \033[1mbold\033[0m \033[4munder\033[0m\n'
seq 1 6000
top
less /etc/passwd
vi /tmp/opendocker-quit-test
```

Expected results:

- Colors and attributes render.
- Scrollback can inspect earlier `seq` output.
- New output does not yank scroll position to bottom while user scrolls up.
- `<leader>q` exits embedded session from `top`, `less`, and `vi` without typing `exit`.
- Reopening shell creates fresh prompt after quit.

### Paste Tests

Paste this text into shell:

```bash
printf 'one\n'
printf 'two\n'
printf 'three\n'
```

Expected results:

- Multiline content arrives intact.
- OpenDocker keybinds do not trigger during paste.
- Paste into `vim` does not auto-execute lines when bracketed paste is active.

### Unsupported Connection Tests

```bash
DOCKER_HOST=tcp://127.0.0.1:2375 bun run dev
DOCKER_HOST=ssh://example.invalid bun run dev
DOCKER_HOST=npipe:////./pipe/docker_engine bun run dev
```

Expected results:

- App does not crash.
- Shell pane shows unavailable state.
- Footer does not show actionable shell shortcut.

### Cleanup

```bash
docker rm -f od-shell-alpine od-shell-bash
```

## Risk Register

### OpenTUI Scroll Events

Risk:

- OpenTUI may not expose all scroll events needed for perfect follow-mode behavior.

Mitigation:

- Start with available `ScrollBoxRenderable` state.
- Add a small scroll adapter instead of scattering scroll logic.
- If needed, use explicit keys for follow/jump-bottom until mouse scroll detection is complete.

### Styled Scrollback Performance

Risk:

- Rendering 5,000 styled rows can be expensive.

Mitigation:

- Coalesce style runs.
- Memoize row snapshots.
- Update after xterm write batches, not every cell.
- Consider viewport culling if OpenTUI supports it cleanly.

### Docker Exec Close Behavior

Risk:

- Docker Engine behavior may differ after destroying hijacked exec stream.

Mitigation:

- Test Docker Desktop and Linux Engine.
- Inspect exec state after close when possible.
- Surface warning if Docker reports exec still running.

### Paste Flooding

Risk:

- Large paste can flood stream and freeze UI.

Mitigation:

- Chunk writes.
- Respect stream backpressure.
- Add max paste size later if needed.

### Unsupported Transports

Risk:

- Remote Docker and Windows named pipes may be possible later, but current raw Unix socket path cannot support them.

Mitigation:

- Label state as `unsupported`, not permanently unavailable.
- Keep transport detection separate from shell manager.

## Done Criteria

The follow-up pass is complete when:

- Footer has no duplicate shell hints.
- Shell startup state is explicit and truthful.
- Detach and quit return to expected focus.
- Scrollback works and respects user scroll position.
- Paste works without triggering OpenDocker shortcuts.
- ANSI colors and common text attributes render.
- Docker exec startup can timeout and abort.
- Quit is safe from foreground programs.
- Shell picker supports auto, named shells, and custom commands.
- Unsupported Docker transports show clear unavailable state.
- Build remains green for all targets.
