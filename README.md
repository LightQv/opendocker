<div align="center">

# OPENDOCKER

Beautiful Docker management from the terminal.

_Current version:_ `0.7.4`

[About](#about) | [Installation](#installation) | [Usage](#usage) | [Development](#development) | [FAQ](#faq) | [License](#license) | [Credits](#credits)

</div>

[![OpenDocker Terminal UI](packages/cli/assets/screenshot.png)](https://opendocker.dev)

---

## About

OpenDocker is a terminal UI for managing Docker containers, logs, images, and volumes.

It uses TypeScript, Solid.js, and [@opentui](https://github.com/anomalyco/opentui) to provide a fast keyboard-first Docker workflow.

---

## Installation

Install the latest release with curl.

```bash
curl -fsSL https://github.com/LightQv/opendocker/releases/latest/download/install.sh | sh
```

The installer writes `opendocker` to `$HOME/.local/bin` by default.
Add that directory to `PATH` if the command is not found.

| Platform | Format | Asset pattern |
| -------- | ------ | ------------- |
| macOS | `.zip` | `opendocker-darwin-*.zip` |
| Linux | `.tar.gz` | `opendocker-linux-*.tar.gz` |

Linux release archives include glibc and musl variants when available.

Set installer options on the `sh` process.

```bash
curl -fsSL https://github.com/LightQv/opendocker/releases/latest/download/install.sh \
  | env OPENDOCKER_VERSION=0.7.4 \
    OPENDOCKER_INSTALL_DIR=/usr/local/bin \
    OPENDOCKER_INSTALL_COLIMA=1 \
    OPENDOCKER_REPO=LightQv/opendocker \
    sh
```

| Option | Purpose |
| ------ | ------- |
| `OPENDOCKER_VERSION` | Release tag to install, with or without `v` |
| `OPENDOCKER_INSTALL_DIR` | Install directory, defaults to `$HOME/.local/bin` |
| `OPENDOCKER_INSTALL_COLIMA` | `1` auto installs Colima, `0` skips setup |
| `OPENDOCKER_REPO` | GitHub repo, defaults to `LightQv/opendocker` |

On macOS, the installer runs `docker info` and checks common sockets: `/var/run/docker.sock`, `$HOME/.docker/run/docker.sock`, `$HOME/.colima/default/docker.sock`, and `$HOME/.orbstack/run/docker.sock`.

If no daemon or socket is found, it prompts before installing Docker CLI, Docker Compose, and Colima through Homebrew.
Set `OPENDOCKER_INSTALL_COLIMA=1` to accept automatically, or `OPENDOCKER_INSTALL_COLIMA=0` to skip setup.

---

## Usage

Start Docker Desktop, OrbStack, Colima, or another Docker-compatible runtime before launching.

```bash
opendocker
```

Default navigation uses Vim-style movement and a `Ctrl+X` leader key.

| Key | Action |
| --- | ------ |
| `up`, `k` | Move up |
| `down`, `j` | Move down |
| `1` | Focus containers |
| `2` | Focus images |
| `3` | Focus volumes |
| `Tab` | Switch between containers and logs |
| `Ctrl+P` | Open commands and settings |
| `Ctrl+C`, `<leader>q` | Exit |

Container rows show state, health, ports, CPU, and memory.
Use `<leader>s` to start or stop, `<leader>r` to restart, `<leader>d` to remove, and `<leader>o` to open detected web ports.

Logs stream live for the selected container.
Use `/` to search, `n` and `N` to jump matches, `p` to pause, `yy` to copy a line, `v` and `y` to copy a selection, and `Y` to copy all loaded logs.

Images show config and layer history.
Volumes show driver, mountpoint, labels, options, and status.

Compose labels group containers by project and service.
Project actions can up, stop, restart, recreate, or remove with `docker compose down`; service actions can force recreate a selected service.

Use `<leader>e` on a running container to open or resume an embedded shell.
Use `<leader>z` to detach and `<leader>q` to close the shell session.

Clipboard actions use OSC52 and wrap OSC52 for tmux when `TMUX` is set.
Native clipboard fallback uses local OS tools when available.

OpenDocker reads Docker data through local Docker API sockets from `DOCKER_HOST`, the current Docker context, or common local paths.
Mutating actions call `docker`, Compose actions call `docker compose`, and embedded shell requires a local Docker socket.

---

## Development

Use Bun from the workspace root.

| Task | Command |
| ---- | ------- |
| Install dependencies | `bun install` |
| Run development TUI | `bun run dev` |
| Single build | `bun run ./packages/cli/scripts/build.ts --single` |
| Single archive | `bun run ./packages/cli/scripts/build.ts --single --archive --skip-install` |
| All archives | `bun run ./packages/cli/scripts/build.ts --all --archive` |
| Versioned build | `OPENDOCKER_VERSION=0.7.4 bun run ./packages/cli/scripts/build.ts --single --archive` |

`OPENDOCKER_VERSION` overrides the version embedded in build output.
Without it, builds use `packages/cli/package.json`.

- `packages/cli` contains the TUI source, Docker integration, themes, assets, and build script.
- `packages/script` resolves build metadata and version values.
- `install.sh` downloads release archives, verifies checksums, installs the binary, and handles optional Colima setup.
- `.github/workflows` contains release automation.

---

## FAQ

### How is this different from lazydocker?

OpenDocker uses a modern TypeScript and Solid.js stack on top of @opentui.
It focuses on a clean minimal interface, smooth rendering, and native macOS/Linux binaries.

### Does it work with Docker Desktop, OrbStack, and Colima?

Yes. OpenDocker works with Docker Desktop, OrbStack, Colima, and any Docker-compatible runtime that exposes a local Docker socket.

### Does copy work over SSH or tmux?

Yes. OpenDocker supports OSC52 clipboard operations, including tmux wrapping for remote sessions.

---

## License

OpenDocker is licensed under MIT.
See [LICENSE](LICENSE).

---

## Credits

OpenDocker is based on the original OpenDocker project by flat6solutions:
https://github.com/flat6solutions/opendocker

The original project README states it is MIT licensed. This project keeps that attribution and continues under MIT.
