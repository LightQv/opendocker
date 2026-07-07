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

export type ShellColor = `#${string}`

export type ShellRunStyle = {
  fg?: ShellColor
  bg?: ShellColor
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  blink?: boolean
  inverse?: boolean
  hidden?: boolean
  strikethrough?: boolean
}

export type ShellRun = {
  text: string
  columns: number
  style: ShellRunStyle
}

export type ShellRow = ShellRun[]

export type ContainerShellSnapshot = {
  rows: ShellRow[]
  cursorX: number
  cursorY: number
  alternate: boolean
}

type TerminalCell = {
  getWidth(): number
  getChars(): string
  getFgColor(): number
  getBgColor(): number
  isBold(): number
  isItalic(): number
  isDim(): number
  isUnderline(): number
  isBlink(): number
  isInverse(): number
  isInvisible(): number
  isStrikethrough(): number
  isFgRGB(): boolean
  isBgRGB(): boolean
  isFgPalette(): boolean
  isBgPalette(): boolean
}

type TerminalLine = {
  readonly length: number
  getCell(x: number, cell?: TerminalCell): TerminalCell | undefined
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

type PendingShellSession = {
  promise: Promise<ContainerShellSession>
  callbacks: ContainerShellCallbacks
  cols: number
  rows: number
  cancelled: boolean
  controller: AbortController
  timeoutMs: number
}

type DockerRequestOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  timeoutLabel?: string
}

const sessions = new Map<string, ContainerShellSession>()
const terminals = new Map<string, Terminal>()
const pendingSessions = new Map<string, PendingShellSession>()

const SHELL_CANDIDATES = ["bash", "zsh", "ash", "sh"]
const EXEC_TIMEOUT_MS = 8_000
const SHELL_CREATION_CANCELLED = "Shell creation cancelled"
const ANSI_PALETTE: ShellColor[] = [
  "#000000",
  "#cd0000",
  "#00cd00",
  "#cdcd00",
  "#0000ee",
  "#cd00cd",
  "#00cdcd",
  "#e5e5e5",
  "#7f7f7f",
  "#ff0000",
  "#00ff00",
  "#ffff00",
  "#5c5cff",
  "#ff00ff",
  "#00ffff",
  "#ffffff",
]
const CUBE_STEPS = [0, 95, 135, 175, 215, 255]

function shellCancellationError(): Error {
  return new Error(SHELL_CREATION_CANCELLED)
}

function timeoutError(label: string, timeoutMs: number): Error {
  return new Error(`${label} timed out after ${timeoutMs}ms`)
}

function isShellCancellation(error: unknown): boolean {
  return error instanceof Error && error.message === SHELL_CREATION_CANCELLED
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.message.includes(" timed out after ")
}

function componentToHex(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")
}

function rgbToHex(r: number, g: number, b: number): ShellColor {
  return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`
}

function packedRgbToHex(value: number): ShellColor {
  return rgbToHex((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff)
}

function paletteToHex(index: number): ShellColor {
  if (index >= 0 && index < ANSI_PALETTE.length) {
    return ANSI_PALETTE[index]!
  }

  if (index >= 16 && index <= 231) {
    const cubeIndex = index - 16
    return rgbToHex(
      CUBE_STEPS[Math.floor(cubeIndex / 36)] ?? 0,
      CUBE_STEPS[Math.floor(cubeIndex / 6) % 6] ?? 0,
      CUBE_STEPS[cubeIndex % 6] ?? 0,
    )
  }

  if (index >= 232 && index <= 255) {
    const value = 8 + (index - 232) * 10
    return rgbToHex(value, value, value)
  }

  return "#ffffff"
}

function getCellColor(cell: TerminalCell, foreground: boolean): ShellColor | undefined {
  if (foreground) {
    if (cell.isFgRGB()) return packedRgbToHex(cell.getFgColor())
    if (cell.isFgPalette()) return paletteToHex(cell.getFgColor())
    return undefined
  }

  if (cell.isBgRGB()) return packedRgbToHex(cell.getBgColor())
  if (cell.isBgPalette()) return paletteToHex(cell.getBgColor())
  return undefined
}

function getCellStyle(cell: TerminalCell): ShellRunStyle {
  const fg = getCellColor(cell, true)
  const bg = getCellColor(cell, false)

  return {
    ...(fg ? { fg } : {}),
    ...(bg ? { bg } : {}),
    ...(cell.isBold() ? { bold: true } : {}),
    ...(cell.isDim() ? { dim: true } : {}),
    ...(cell.isItalic() ? { italic: true } : {}),
    ...(cell.isUnderline() ? { underline: true } : {}),
    ...(cell.isBlink() ? { blink: true } : {}),
    ...(cell.isInverse() ? { inverse: true } : {}),
    ...(cell.isInvisible() ? { hidden: true } : {}),
    ...(cell.isStrikethrough() ? { strikethrough: true } : {}),
  }
}

function styleKey(style: ShellRunStyle): string {
  return [
    style.fg ?? "",
    style.bg ?? "",
    style.bold ? "1" : "0",
    style.dim ? "1" : "0",
    style.italic ? "1" : "0",
    style.underline ? "1" : "0",
    style.blink ? "1" : "0",
    style.inverse ? "1" : "0",
    style.hidden ? "1" : "0",
    style.strikethrough ? "1" : "0",
  ].join("|")
}

function lineToRuns(line: TerminalLine | undefined, minColumns: number): ShellRow {
  if (!line) {
    return [{ text: " ".repeat(minColumns), columns: minColumns, style: {} }]
  }

  const runs: ShellRun[] = []
  const cell = line.getCell(0)
  const columns = Math.max(line.length, minColumns)
  let previousKey = ""

  for (let column = 0; column < columns; column += 1) {
    const nextCell = line.getCell(column, cell)
    if (!nextCell) continue

    const width = nextCell.getWidth()
    if (width === 0) continue

    const style = getCellStyle(nextCell)
    const text = style.hidden ? " " : nextCell.getChars() || " "
    const key = styleKey(style)
    const previous = runs.at(-1)

    if (previous && previousKey === key) {
      previous.text += text
      previous.columns += width
      continue
    }

    runs.push({ text, columns: width, style })
    previousKey = key
  }

  return runs
}

function withTimeout<T>(promise: Promise<T>, options: Required<Pick<DockerRequestOptions, "timeoutMs" | "timeoutLabel">> & Pick<DockerRequestOptions, "signal">): Promise<T> {
  if (options.signal?.aborted) return Promise.reject(shellCancellationError())

  return new Promise((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    const abort = () => finishReject(shellCancellationError())
    const cleanup = () => {
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", abort)
    }
    const finishResolve = (value: T) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const finishReject = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    timer = setTimeout(() => finishReject(timeoutError(options.timeoutLabel, options.timeoutMs)), options.timeoutMs)
    options.signal?.addEventListener("abort", abort, { once: true })
    promise.then(finishResolve, finishReject)
  })
}

function dockerRequest<T>(socketPath: string, path: string, method: string, body?: unknown, options: DockerRequestOptions = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(shellCancellationError())
      return
    }

    const data = body === undefined ? "" : JSON.stringify(body)
    const timeoutMs = options.timeoutMs ?? EXEC_TIMEOUT_MS
    const timeoutLabel = options.timeoutLabel ?? "Docker request"
    let settled = false
    let cleanupAbort = () => {}
    const finishResolve = (value: T) => {
      if (settled) return
      settled = true
      cleanupAbort()
      resolve(value)
    }
    const finishReject = (error: unknown) => {
      if (settled) return
      settled = true
      cleanupAbort()
      reject(error)
    }

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
          finishReject(new Error(`Docker API ${res.statusCode}: ${text}`))
          return
        }

        try {
          finishResolve(JSON.parse(text) as T)
        } catch (error) {
          finishReject(error)
        }
      })
    })

    const abort = () => req.destroy(shellCancellationError())
    if (options.signal) {
      options.signal.addEventListener("abort", abort, { once: true })
      cleanupAbort = () => options.signal?.removeEventListener("abort", abort)
    }

    req.on("error", finishReject)
    req.setTimeout(timeoutMs, () => {
      req.destroy(timeoutError(timeoutLabel, timeoutMs))
    })
    req.end(data)
  })
}

function startExecStream(socketPath: string, execId: string, options: DockerRequestOptions = {}): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(shellCancellationError())
      return
    }

    const body = JSON.stringify({ Detach: false, Tty: true })
    const socket = net.createConnection(socketPath)
    const timeoutMs = options.timeoutMs ?? EXEC_TIMEOUT_MS
    const timeoutLabel = options.timeoutLabel ?? "Docker exec start"
    let header = Buffer.alloc(0)
    let connected = false
    let settled = false
    let cleanupAbort = () => {}
    const finishResolve = () => {
      if (settled) return
      settled = true
      cleanupAbort()
      socket.setTimeout(0)
      resolve(socket)
    }
    const finishReject = (error: unknown) => {
      if (settled) return
      settled = true
      cleanupAbort()
      socket.destroy()
      reject(error)
    }

    const abort = () => finishReject(shellCancellationError())
    if (options.signal) {
      options.signal.addEventListener("abort", abort, { once: true })
      cleanupAbort = () => options.signal?.removeEventListener("abort", abort)
    }

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
        finishReject(new Error(`Docker exec start failed: ${statusLine}`))
        return
      }

      connected = true
      socket.removeAllListeners("data")
      const rest = header.subarray(marker + 4)
      finishResolve()
      if (rest.length > 0) {
        queueMicrotask(() => socket.emit("data", rest))
      }
    })

    socket.on("error", finishReject)
    socket.setTimeout(timeoutMs, () => {
      finishReject(timeoutError(timeoutLabel, timeoutMs))
    })
  })
}

async function runExecCommand(socketPath: string, containerId: string, command: string[], options: DockerRequestOptions = {}): Promise<string> {
  const exec = await dockerRequest<{ Id: string }>(socketPath, `/containers/${containerId}/exec`, "POST", {
    Cmd: command,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  }, options)

  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(shellCancellationError())
      return
    }

    const body = JSON.stringify({ Detach: false, Tty: false })
    const timeoutMs = options.timeoutMs ?? EXEC_TIMEOUT_MS
    const timeoutLabel = options.timeoutLabel ?? "Docker exec command"
    let settled = false
    let cleanupAbort = () => {}
    const finishResolve = (value: string) => {
      if (settled) return
      settled = true
      cleanupAbort()
      resolve(value)
    }
    const finishReject = (error: unknown) => {
      if (settled) return
      settled = true
      cleanupAbort()
      reject(error)
    }

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
          finishReject(new Error(`Docker exec command failed: ${res.statusCode}`))
          return
        }

        finishResolve(demuxDockerOutput(Buffer.concat(chunks)))
      })
    })

    const abort = () => req.destroy(shellCancellationError())
    if (options.signal) {
      options.signal.addEventListener("abort", abort, { once: true })
      cleanupAbort = () => options.signal?.removeEventListener("abort", abort)
    }

    req.on("error", finishReject)
    req.setTimeout(timeoutMs, () => {
      req.destroy(timeoutError(timeoutLabel, timeoutMs))
    })
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function detectShell(socketPath: string, containerId: string, preferredShell: string | undefined, options: DockerRequestOptions): Promise<string> {
  if (preferredShell) {
    const quotedShell = shellQuote(preferredShell)
    const output = await runExecCommand(socketPath, containerId, ["sh", "-lc", `command -v ${quotedShell} >/dev/null 2>&1 && printf %s ${quotedShell}`], {
      ...options,
      timeoutLabel: "Docker shell validation",
    }).catch((error) => {
      if (isShellCancellation(error) || isTimeout(error)) throw error
      return ""
    })

    if (!output.trim()) {
      throw new Error(`Shell "${preferredShell}" not found in container. Select auto or install ${preferredShell}.`)
    }

    return preferredShell
  }

  const command = `for shell in ${SHELL_CANDIDATES.join(" ")}; do command -v "$shell" && exit 0; done; printf sh`
  const output = await runExecCommand(socketPath, containerId, ["sh", "-lc", command], {
    ...options,
    timeoutLabel: "Docker shell detection",
  }).catch((error) => {
    if (isShellCancellation(error) || isTimeout(error)) throw error
    return "sh"
  })
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
    const rows: ShellRow[] = []

    if (buffer.type === "alternate") {
      for (let row = 0; row < terminal.rows; row += 1) {
        rows.push(lineToRuns(buffer.getLine(row), terminal.cols))
      }

      return {
        rows,
        cursorX: buffer.cursorX,
        cursorY: buffer.cursorY,
        alternate: true,
      }
    }

    for (let row = 0; row < buffer.length; row += 1) {
      rows.push(lineToRuns(buffer.getLine(row), terminal.cols))
    }

    return {
      rows,
      cursorX: buffer.cursorX,
      cursorY: buffer.baseY + buffer.cursorY,
      alternate: false,
    }
  }

  export function bracketedPasteMode(containerId: string): boolean {
    return terminals.get(containerId)?.modes.bracketedPasteMode ?? false
  }

  export async function create(options: CreateShellSessionOptions): Promise<ContainerShellSession> {
    const existing = sessions.get(options.containerId)
    if (existing) {
      existing.attach(options)
      existing.resize(options.cols, options.rows)
      return existing
    }

    const pending = pendingSessions.get(options.containerId)
    if (pending) {
      pending.callbacks = options
      pending.cols = options.cols
      pending.rows = options.rows
      return pending.promise.then((session) => {
        session.attach(options)
        session.resize(options.cols, options.rows)
        return session
      })
    }

    const nextPending: PendingShellSession = {
      callbacks: options,
      cols: options.cols,
      rows: options.rows,
      cancelled: false,
      controller: new AbortController(),
      timeoutMs: EXEC_TIMEOUT_MS,
      promise: undefined as unknown as Promise<ContainerShellSession>,
    }

    pendingSessions.set(options.containerId, nextPending)
    nextPending.promise = createNewSession(options.containerId, options.shell, nextPending)
    return nextPending.promise
  }

  async function createNewSession(
    containerId: string,
    preferredShell: string | undefined,
    pending: PendingShellSession,
  ): Promise<ContainerShellSession> {
    try {
      const requestOptions = {
        signal: pending.controller.signal,
        timeoutMs: pending.timeoutMs,
      }
      const socketPath = await withTimeout(DockerV2.getShellSocket(), {
        ...requestOptions,
        timeoutLabel: "Docker socket discovery",
      })
      if (pending.cancelled) throw shellCancellationError()

      const shell = await detectShell(socketPath, containerId, preferredShell, requestOptions)
      if (pending.cancelled) throw shellCancellationError()

      const terminal = new Terminal({
        cols: pending.cols,
        rows: pending.rows,
        allowProposedApi: true,
        scrollback: 5_000,
      })
      const exec = await dockerRequest<{ Id: string }>(socketPath, `/containers/${containerId}/exec`, "POST", {
        Cmd: [shell],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Env: ["TERM=xterm-256color"],
      }, {
        ...requestOptions,
        timeoutLabel: "Docker exec create",
      })

      if (pending.cancelled) throw shellCancellationError()

      const stream = await startExecStream(socketPath, exec.Id, {
        ...requestOptions,
        timeoutLabel: "Docker exec start",
      })
      if (pending.cancelled) {
        stream.destroy()
        throw shellCancellationError()
      }

      let callbacks = pending.callbacks
      let cols = pending.cols
      let rows = pending.rows

      let intentionalQuit = false
      let finished = false
      let session: ContainerShellSession
      const clearSession = () => {
        if (sessions.get(containerId) === session) {
          sessions.delete(containerId)
        }
        if (terminals.get(containerId) === terminal) {
          terminals.delete(containerId)
        }
      }
      const finish = (callback: () => void) => {
        if (finished) return
        finished = true
        clearSession()
        if (!intentionalQuit) callback()
      }

      session = {
        containerId,
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
          stream.destroy()
          clearSession()
        },
      }

      stream.on("data", (chunk: Buffer) => {
        terminal.write(chunk.toString("utf8"), callbacks.onRender)
      })
      stream.on("error", (error: Error) => {
        finish(() => callbacks.onError(error))
      })
      stream.on("close", () => {
        finish(callbacks.onExit)
      })
      stream.on("end", () => {
        finish(callbacks.onExit)
      })

      sessions.set(containerId, session)
      terminals.set(containerId, terminal)
      dockerRequest(socketPath, `/exec/${exec.Id}/resize?h=${rows}&w=${cols}`, "POST").catch(() => {})
      return session
    } finally {
      if (pendingSessions.get(containerId) === pending) {
        pendingSessions.delete(containerId)
      }
    }
  }

  export function write(containerId: string, data: string): boolean {
    const session = sessions.get(containerId)
    if (!session) return false
    session.write(data)
    return true
  }

  export function quit(containerId: string): void {
    const pending = pendingSessions.get(containerId)
    if (pending) {
      pending.cancelled = true
      pending.controller.abort()
      pendingSessions.delete(containerId)
    }

    const session = sessions.get(containerId)
    if (!session) return
    session.quit()
  }

  export function resize(containerId: string, cols: number, rows: number): boolean {
    const pending = pendingSessions.get(containerId)
    if (pending) {
      pending.cols = cols
      pending.rows = rows
      return true
    }

    const session = sessions.get(containerId)
    if (!session) return false
    session.resize(cols, rows)
    return true
  }

  export function quitAll(): void {
    for (const containerId of Array.from(pendingSessions.keys())) {
      quit(containerId)
    }

    for (const containerId of Array.from(sessions.keys())) {
      quit(containerId)
    }
  }
}
