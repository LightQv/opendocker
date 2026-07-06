import http from "node:http"
import net from "node:net"
import { DockerV2 } from "./docker-v2"

export type ContainerShellSession = {
  containerId: string
  write(data: string): void
  quit(): void
}

type CreateShellSessionOptions = {
  containerId: string
  shell: string
  cols: number
  rows: number
  onData(data: string): void
  onExit(): void
  onError(error: Error): void
}

const sessions = new Map<string, ContainerShellSession>()

function dockerRequest<T>(socketPath: string, path: string, method: string, body: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = http.request({
      socketPath,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
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

export namespace ContainerShell {
  export function get(containerId: string): ContainerShellSession | undefined {
    return sessions.get(containerId)
  }

  export async function create(options: CreateShellSessionOptions): Promise<ContainerShellSession> {
    const existing = sessions.get(options.containerId)
    if (existing) return existing

    const socketPath = await DockerV2.getSocket()
    const exec = await dockerRequest<{ Id: string }>(socketPath, `/containers/${options.containerId}/exec`, "POST", {
      Cmd: [options.shell],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      Env: ["TERM=xterm-256color"],
    })
    const stream = await startExecStream(socketPath, exec.Id)

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
      quit() {
        intentionalQuit = true
        stream.write("exit\n")
        stream.destroy()
        sessions.delete(options.containerId)
      },
    }

    stream.on("data", (chunk: Buffer) => {
      options.onData(chunk.toString("utf8"))
    })
    stream.on("error", (error: Error) => {
      finish(() => options.onError(error))
    })
    stream.on("close", () => {
      finish(options.onExit)
    })
    stream.on("end", () => {
      finish(options.onExit)
    })

    sessions.set(options.containerId, session)
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
  }

  export function quitAll(): void {
    for (const containerId of sessions.keys()) {
      quit(containerId)
    }
  }
}
