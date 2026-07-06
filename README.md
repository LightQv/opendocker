<p align="center">
  <strong>OpenDocker</strong>
</p>
<p align="center">A beautiful TUI for managing Docker containers, images, and volumes.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/opendocker"><img alt="npm version" src="https://img.shields.io/npm/v/opendocker" /></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" /></a>
</p>

[![OpenDocker Terminal UI](packages/cli/assets/screenshot.png)](https://opendocker.dev)

---

### Installation

```bash
# npm
npm install -g opendocker

# bun
bun install -g opendocker

# Homebrew (coming soon)
brew install opendocker
```

### Features

- **Container Management** — View all containers with real-time status updates, color-coded by state
- **Live Logs** — Stream container logs in real-time with filtering support
- **Image Browser** — Browse Docker images, view configuration and layer history
- **Volume Browser** — Inspect volumes with detailed configuration info
- **Vim-style Navigation** — Navigate with `j/k`, switch panes with `Tab`, quit with `q`
- **Clipboard Support** — Copy text with OSC52 (works in tmux)
- **Cross-platform** — Native binaries for macOS, Linux, and Windows

### FAQ

#### How is this different from lazydocker?

- Built with a modern TypeScript + Solid.js stack using the [@opentui](https://github.com/anomalyco/opentui) framework
- 60 FPS rendering for a smooth terminal experience
- Clean, minimal interface focused on the essentials
- Active development with native cross-platform binaries

#### Does this work with Docker Desktop?

Yes. OpenDocker works with Docker Desktop, OrbStack, and any Docker-compatible runtime. It connects to the Docker socket to stream data, so as long as your Docker daemon is running, you're good to go.

#### Does it work over SSH/tmux?

Yes. OpenDocker supports OSC52 for clipboard operations, so copying text works even in remote SSH sessions and tmux.

#### What are the requirements?

- Docker (or a Docker-compatible runtime) installed and running
- macOS, Linux, or Windows

---

Based on the original [OpenDocker project](https://github.com/flat6solutions/opendocker), forked and extended from there.
