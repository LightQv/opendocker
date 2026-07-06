import http from "node:http"
import net from "node:net"
import { Terminal } from "@xterm/headless"
import { DockerV2 } from "./docker-v2"

export type ContainerShellSession = {
  containerId: string
  write(data: string): void
  resize(cols: number, rows: number): void
  attach(callbacks: ContainerShellCallbacks): void
  quit(): void
}

export type ContainerShellSnapshot = {
  rows: string[]
  cursorX: number
  cursorY: number
}

type CreateShellSessionOptions = {
  containerId: string
  shell?: string
  cols: number
  rows: number
} & ContainerShellCallbacks

type ContainerShellCallbacks = {
  onRender(): void
  onExit(): void
  onError(error: Error): void
}

const sessions = new Map<string, ContainerShellSession>()
const terminals = new Map<string, Terminal>()

const SHELL_CANDIDATES = ["bash", "zsh", "ash", "sh"]

function dockerRequest<T>(socketPath: string, path: string, method: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? "" : JSON.stringify(body)
    const req = http.request({
      socketPath,
      path,
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        "Content-Length": Buffer.byteLength(data),
      },
    }, (res) => {
      let text = ""

      res.on("data", chunk => text += chunk)
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Docker API ${res.statusCode}: ${text}`))
          return
        }

        try {
          resolve(JSON.parse(text) as T)
        } catch (error) {
          reject(error)
        }
      })
    })

    req.on("error", reject)
    req.end(data)
  })
}

function startExecStream(socketPath: string, execId: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ Detach: false, Tty: true })
    const socket = net.createConnection(socketPath)
    let header = Buffer.alloc(0)
    let connected = false

    socket.on("connect", () => {
      socket.write([
        `POST /exec/${execId}/start HTTP/1.1`,
        "Host: docker",
        "Connection: Upgrade",
        "Upgrade: tcp",
        "Content-Type: application/json",
        `Content-Length: ${Buffer.byteLength(body)}`,
        "",
        body,
      ].join("\r\n"))
    })

    socket.on("data", (chunk) => {
      if (connected) return

      header = Buffer.concat([header, chunk])
      const marker = header.indexOf("\r\n\r\n")
      if (marker === -1) return

      const statusLine = header.subarray(0, marker).toString().split("\r\n")[0]
      if (!statusLine.includes("101")) {
        reject(new Error(`Docker exec start failed: ${statusLine}`))
        socket.destroy()
        return
      }

      connected = true
      socket.removeAllListeners("data")
      const rest = header.subarray(marker + 4)
      resolve(socket)
      if (rest.length > 0) {
        queueMicrotask(() => socket.emit("data", rest))
      }
    })

    socket.on("error", reject)
  })
}

async function runExecCommand(socketPath: string, containerId: string, command: string[]): Promise<string> {
  const exec = await dockerRequest<{ Id: string }>(socketPath, `/containers/${containerId}/exec`, "POST", {
    Cmd: command,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  })

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ Detach: false, Tty: false })
    const req = http.request({
      socketPath,
      path: `/exec/${exec.Id}/start`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks: Buffer[] = []

      res.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Docker exec command failed: ${res.statusCode}`))
          return
        }

        resolve(demuxDockerOutput(Buffer.concat(chunks)))
      })
    })

    req.on("error", reject)
    req.end(body)
  })
}

function demuxDockerOutput(buffer: Buffer): string {
  const chunks: Buffer[] = []
  let offset = 0

  while (offset + 8 <= buffer.length) {
    const streamType = buffer[offset]
    const length = buffer.readUInt32BE(offset + 4)
    const start = offset + 8
    const end = start + length
    if ((streamType !== 1 && streamType !== 2) || end > buffer.length) break
    chunks.push(buffer.subarray(start, end))
    offset = end
  }

  if (chunks.length === 0) return buffer.toString("utf8")
  return Buffer.concat(chunks).toString("utf8")
}

async function detectShell(socketPath: string, containerId: string, preferredShell?: string): Promise<string> {
  if (preferredShell) return preferredShell

  const command = `for shell in ${SHELL_CANDIDATES.join(" ")}; do command -v "$shell" && exit 0; done; printf sh`
  const output = await runExecCommand(socketPath, containerId, ["sh", "-lc", command]).catch(() => "sh")
  return output.split("\n").map(line => line.trim()).find(Boolean) ?? "sh"
}

export namespace ContainerShell {
  export function get(containerId: string): ContainerShellSession | undefined {
    return sessions.get(containerId)
  }

  export function snapshot(containerId: string): ContainerShellSnapshot | undefined {
    const terminal = terminals.get(containerId)
    if (!terminal) return undefined

    const buffer = terminal.buffer.active
    const rows: string[] = []
    for (let row = 0; row < terminal.rows; row += 1) {
      rows.push(buffer.getLine(buffer.viewportY + row)?.translateToString(false) ?? "")
    }

    return {
      rows,
      cursorX: buffer.cursorX,
      cursorY: buffer.cursorY,
    }
  }

  export async function create(options: CreateShellSessionOptions): Promise<ContainerShellSession> {
    const existing = sessions.get(options.containerId)
    if (existing) {
      existing.attach(options)
      existing.resize(options.cols, options.rows)
      return existing
    }

    const socketPath = await DockerV2.getSocket()
    const shell = await detectShell(socketPath, options.containerId, options.shell)
    const terminal = new Terminal({
      cols: options.cols,
      rows: options.rows,
      allowProposedApi: true,
      scrollback: 5_000,
    })
    const exec = await dockerRequest<{ Id: string }>(socketPath, `/containers/${options.containerId}/exec`, "POST", {
      Cmd: [shell],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      Env: ["TERM=xterm-256color"],
    })
    const stream = await startExecStream(socketPath, exec.Id)
    let callbacks: ContainerShellCallbacks = options
    let cols = options.cols
    let rows = options.rows

    let intentionalQuit = false
    let finished = false
    const finish = (callback: () => void) => {
      if (finished) return
      finished = true
      sessions.delete(options.containerId)
      if (!intentionalQuit) callback()
    }

    const session: ContainerShellSession = {
      containerId: options.containerId,
      write(data: string) {
        stream.write(data)
      },
      attach(nextCallbacks: ContainerShellCallbacks) {
        callbacks = nextCallbacks
      },
      resize(nextCols: number, nextRows: number) {
        if (cols === nextCols && rows === nextRows) return
        cols = nextCols
        rows = nextRows
        terminal.resize(cols, rows)
        dockerRequest(socketPath, `/exec/${exec.Id}/resize?h=${rows}&w=${cols}`, "POST").catch(() => {})
        callbacks.onRender()
      },
      quit() {
        intentionalQuit = true
        stream.write("exit\n")
        stream.destroy()
        sessions.delete(options.containerId)
        terminals.delete(options.containerId)
      },
    }

    stream.on("data", (chunk: Buffer) => {
      terminal.write(chunk.toString("utf8"), callbacks.onRender)
    })
    stream.on("error", (error: Error) => {
      terminals.delete(options.containerId)
      finish(() => callbacks.onError(error))
    })
    stream.on("close", () => {
      terminals.delete(options.containerId)
      finish(callbacks.onExit)
    })
    stream.on("end", () => {
      terminals.delete(options.containerId)
      finish(callbacks.onExit)
    })

    sessions.set(options.containerId, session)
    terminals.set(options.containerId, terminal)
    return session
  }

  export function write(containerId: string, data: string): boolean {
    const session = sessions.get(containerId)
    if (!session) return false
    session.write(data)
    return true
  }

  export function quit(containerId: string): void {
    const session = sessions.get(containerId)
    if (!session) return
    session.quit()
    sessions.delete(containerId)
    terminals.delete(containerId)
  }

  export function resize(containerId: string, cols: number, rows: number): boolean {
    const session = sessions.get(containerId)
    if (!session) return false
    session.resize(cols, rows)
    return true
  }

  export function quitAll(): void {
    for (const containerId of sessions.keys()) {
      quit(containerId)
    }
  }
}
