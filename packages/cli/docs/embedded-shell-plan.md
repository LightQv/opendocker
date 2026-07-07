# Embedded Shell Plan

## Goal

Build a real embedded container shell in the right panel using Docker Exec API with `Tty: true`.

The shell should feel native to OpenDocker:

- Container list stays visible on the left.
- Right panel toggles between logs and shell.
- Logs remain the default right-panel view.
- Shell replaces the logs area when toggled on.
- Log filter/search remains available only in logs mode.
- Shell sessions are persistent per container while OpenDocker is running.
- Detaching from a shell returns to logs without killing the session.
- Reopening shell for the same container resumes the existing session.
- Reopening an existing session reattaches current UI callbacks instead of creating a new session.
- Default shell auto-detects `bash`, then `zsh`, then `ash`, then `sh`.
- Later shell picker can choose from `sh`, `bash`, `ash`, `zsh`.

## Packaging Spike Result

`node-pty` was tested first and rejected.

Findings:

- `node-pty` installed, but its `spawn-helper` lacked executable bit under Bun install layout.
- After fixing the bit locally, `node-pty` worked under Node but produced no PTY output under Bun.
- Native addon packaging also would complicate Bun standalone builds.

Decision:

- Do not use `node-pty`.
- Use Docker's own exec TTY support instead.
- This avoids native addon packaging and still gives the container process a real TTY.

Implementation path:

- Create exec with `Tty: true`.
- Start exec with `hijack: true` and `stdin: true`.
- Keep the stream open for persistent sessions.
- Write keyboard bytes to the stream.
- Read shell output from the stream.
- Feed shell output into `@xterm/headless` to maintain terminal screen state.
- Render the xterm buffer into OpenTUI rows.

## State Model

Update `packages/cli/src/context/application.tsx`.

Add shell state:

```ts
shell: {
  activeContainerId: string | null
  sessions: Record<string, ShellSessionState>
}
```

Each session is keyed by container ID:

```ts
type ShellSessionState = {
  containerId: string
  status: "running" | "exited" | "error"
  version: number
  error: string | null
}
```

The live Docker exec stream and xterm terminal should not be stored directly in Solid store state. Keep stream/terminal handles in a module-level session manager map and expose serializable state through context.

Add shell focus:

```ts
type ContainerFocus = "list" | "logs" | "filter" | "searchEdit" | "searchActive" | "shell"
```

Add getters:

- `shellOpen`
- `shellFocused`
- `activeShellContainer`
- `selectedContainerHasShellSession`

Add methods:

- `openContainerShell(containerId)`
- `detachContainerShell()`
- `closeContainerShell(containerId)`
- `markContainerShell(containerId, status, error)`
- `bumpContainerShellVersion(containerId)`

Behavior:

- Default shell state has no active container and no sessions.
- Shell is available only in the containers pane and container list mode.
- Opening shell captures the currently selected container as `activeContainerId`.
- Opening shell for a container with an existing running session resumes that session.
- Opening shell for a container without a session creates a new session.
- Detaching from shell returns to logs and keeps the session alive.
- Quitting shell kills only the active container shell session.
- Switching selected containers must not silently switch or kill an active shell session.
- Switching to project mode should detach from shell or disable shell toggle.
- Closing OpenDocker kills all shell sessions.

## Keybind

Update `packages/cli/src/util/config.ts`.

Add:

```ts
container_shell: z.string().optional().default("<leader>e").describe("Open or resume a container shell")
container_shell_detach: z.string().optional().default("<leader>z").describe("Detach from the active container shell")
container_shell_quit: z.string().optional().default("<leader>q").describe("Quit the active container shell")
```

Footer behavior:

- Logs shown: `<leader>e shell`
- Logs shown for a container with an existing session: `<leader>e resume shell`
- Shell focused: show `<leader>z detach`
- Shell focused: show `<leader>q quit`
- Do not show `ctrl+c` / `ctrl+d`; they pass through as normal terminal controls.

Left-side hints:

- When shell is focused, hide left-side `1` / `2` / `3` navigation hints, same as logs focus.
- Footer remains the source of shell-specific shortcuts.

## Layout

Update `packages/cli/src/components/main.tsx`.

Header stays above both modes.

Logs mode renders:

- `ContainerLogs`
- `ContainerFilter` when container list mode is `containers`

Shell mode renders:

- `ContainerShell`
- No log filter/search box

Shell rendering should be tied to `activeShellContainerId`, not current list selection. This prevents list navigation from switching the visible shell unexpectedly.

## Shell Component

Create:

```txt
packages/cli/src/components/panes/container/shell.tsx
```

Responsibilities:

- Require an active shell container.
- Require the active shell container state to be `running` when creating a new session.
- Show empty state if no active shell container is set.
- Show blocked state if the target container is not running and no session can be created.
- Start Docker exec only when opening shell for a container without an existing running session.
- Reuse the existing session when reopening shell for the same container.
- Do not close the Docker exec stream on detach.
- Close the Docker exec stream on `<leader>q`, container stop/remove, process exit, or app exit.
- Render xterm buffer rows in a scrollbox.
- Cap scrollback.
- Header should show the shell container name/id, not whichever container is currently selected after detaching or browsing.

Default command resolution:

```bash
docker exec <containerId> sh -lc 'for shell in bash zsh ash sh; do command -v "$shell" && exit 0; done; printf sh'
```

Interactive shell then starts with the detected shell path/name. This avoids defaulting to minimal `sh` implementations that print arrow-key escape sequences like `^[[D` instead of moving the cursor.

## Shell Session Wrapper

Create:

```txt
packages/cli/src/lib/container-shell.ts
```

Purpose:

- Isolate Docker exec stream handling.
- Own the headless xterm terminal instance per session.
- Update callbacks when a detached session is resumed.
- Keep stream/session details out of UI code.
- Make future shell config and resize support easier.

Proposed API:

```ts
ContainerShell.create({ containerId, shell, cols, rows, onRender, onExit, onError })
```

Returns:

- `write(data)`
- `resize(cols, rows)`
- `attach(callbacks)`
- `quit()`
- `snapshot(containerId)`

Also maintain a session manager that can:

- get session by container ID
- create session by container ID
- kill session by container ID
- kill all sessions on app exit

## Input Handling

When shell is focused:

- Printable chars write directly to the Docker exec stream.
- Enter writes `\n`.
- Backspace writes `\x7f`.
- Tab writes `\t`.
- Up arrow writes `\x1b[A`.
- Down arrow writes `\x1b[B`.
- Right arrow writes `\x1b[C`.
- Left arrow writes `\x1b[D`.
- `ctrl+c` writes `\x03`.
- `ctrl+d` writes `\x04`.
- `<leader>z` detaches from the shell and returns to logs/list without killing the session.
- `<leader>q` quits the current shell session and returns to logs/list.
- Escape behavior should be avoided for shell detach because many terminal programs use Escape.
- `ctrl+z` and `ctrl+q` should pass through to the shell because they are real terminal controls.
- While shell is focused, global app shortcuts must not consume terminal controls such as `ctrl+c` or `ctrl+d`.
- While shell is focused, shell pane owns leader handling locally for `<leader>z` and `<leader>q`.

Paste support can come later if OpenTUI exposes raw pasted text.

## Rendering

First version:

- Feed Docker exec output to `@xterm/headless`.
- Render terminal buffer rows in a scrollbox.
- Keep xterm scrollback at about 5,000 lines.
- Stick to bottom while following output.
- Render a visible cursor by inverting the cursor cell.
- Do not strip ANSI like logs do; xterm parses ANSI/VT sequences.

Color and text attributes can be mapped from xterm buffer cells as a follow-up. Current implementation focuses on cursor, backspace, line editing, and prompt redraw correctness.

## Resize

On panel size change:

- Calculate columns and rows from the shell panel/scrollbox size.
- Resize the xterm terminal and send Docker exec resize request.
- Resize is idempotent; same `cols`/`rows` must not trigger render callbacks.
- Shell creation waits for real viewport size; invalid early layout sizes are ignored.
- The viewport resize event drives Docker exec resize, not the outer scrollbox wrapper.

This matters for prompt wrapping and full-screen terminal programs.

## Lifecycle

Container changes:

- Do not kill the old shell.
- Do not auto-start a new shell.
- Selected container changes only affect which shell will open when `<leader>e` is pressed from logs/list mode.

Detaching from shell:

- `<leader>z` returns to logs/list and keeps the session alive.

Quitting shell:

- `<leader>q` kills the active shell session and returns to logs/list.

Process exits:

- If shell exits through `exit` or `ctrl+d`, mark the session as exited.
- Reopening shell for that container should create a fresh session.

Container stop/remove:

- Kill matching shell session.

Container restart/recreate:

- Kill matching shell session before the container is replaced or restarted.

External container stop/remove:

- Reconcile known shell sessions against refreshed container state and close sessions whose container is gone or no longer running.

Pending shell creation:

- Only one Docker exec may be pending per container.
- Repeated opens while pending update callbacks and target size instead of spawning duplicate execs.
- Quitting while pending cancels the pending create and ignores stale completion.
- Per-open generation tokens prevent stale async create results from updating a later shell open for the same container.

App exit:

- Kill all shell sessions without an extra confirm.

App/dialog interactions:

- Ignore shell input when dialogs are open.
- Cleanly close all shell streams when app exits.

## Error States

Show clear states in the shell pane:

- `Select a running container`
- `Container must be running`
- `Shell exited`
- `Failed to start shell`
- `Embedded shell unavailable in this build`
- `Shell session detached`

The unavailable state is less likely with Docker exec than with `node-pty`, but still useful for unsupported Docker connection types.

## Future Shell Picker

Later add an option dialog.

Shell options:

- `sh`
- `bash`
- `ash`
- `zsh`

Store selected shell in config.

Command becomes:

```bash
docker exec -it <containerId> <shell>
```

## Packaging Plan

Current implementation uses `dockerode` and Docker Engine API, not native addons.

Packaging impact:

- No `node-pty` native addon.
- No `.node` sidecar files.
- Single-binary Bun build remains viable.
- Musl targets remain viable from shell feature perspective.

Verification:

- `bun run build --single` passes.
- `bun run build --all` passes.

## Risk Register

- Docker exec stream behavior may differ across Docker Desktop, Linux Engine, and remote contexts.
- Windows named pipe Docker connections may need follow-up if current socket detection cannot support them.
- ANSI rendering may need extra parser work.
- Full-screen apps inside OpenTUI may need more terminal emulation than simple text rendering.

## Milestones

1. Packaging spike: done, rejected `node-pty`.
2. Minimal embedded shell: `sh`, output, input, detach, quit, cleanup.
3. Native feel pass: resize, scrollback, ANSI handling, key mapping.
4. Release hardening: artifacts, feature gates, target support.
5. Shell picker: `sh`, `bash`, `ash`, `zsh`.

## Acceptance Criteria

- `<leader>e` toggles shell/logs.
- Shell appears where logs were.
- Container list remains usable when shell is unfocused.
- Shell accepts commands and displays output.
- Enter, backspace, arrows, `ctrl+c`, and `ctrl+d` work.
- `<leader>z` returns to logs/list and keeps the shell session alive.
- Reopening shell for the same container resumes the existing session.
- Shell sessions can exist for multiple containers at the same time.
- `<leader>q` kills only the active shell session and returns to logs/list.
- Switching containers does not kill or silently switch an existing shell session.
- Container stop/remove cleans up matching shell session.
- Closing OpenDocker kills all shell sessions.
- Build does not regress.
- Unsupported packages degrade cleanly instead of crashing.
