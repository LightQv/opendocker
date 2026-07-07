import { access, readdir } from "node:fs/promises"
import http from "node:http"
import { homedir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

export namespace DockerV2 {
  const DEFAULT_SOCKET = "/var/run/docker.sock"
  const REQUEST_TIMEOUT_MS = 2_000
  const FALLBACK_LOCAL_SOCKETS = [
    "/var/run/docker.sock",
    join(homedir(), ".docker", "run", "docker.sock"),
  ]

  const DockerConfigSchema = z.object({
    currentContext: z.string().optional(),
  })

  const DockerContextMetaSchema = z.object({
    Name: z.string().optional(),
    Endpoints: z.object({
      docker: z.object({
        Host: z.string().optional(),
      }).optional(),
    }).optional(),
  })

  type DockerHealth = "healthy" | "unhealthy" | "starting" | "exited"

  interface DockerContainer {
    Id: string
    Names: string[]
    State: string
    Status: string
    Labels?: Record<string, string> | null
    Ports?: DockerPort[]
  }

  interface DockerPort {
    IP?: string
    PrivatePort: number
    PublicPort?: number
    Type: string
  }

  const DockerCpuStatsSchema = z.object({
    cpu_usage: z.object({
      total_usage: z.number().optional().default(0),
      percpu_usage: z.array(z.number()).optional(),
    }).passthrough().optional().default({}),
    system_cpu_usage: z.number().optional().default(0),
    online_cpus: z.number().optional(),
  }).passthrough()

  const DockerMemoryStatsSchema = z.object({
    usage: z.number().optional().default(0),
    limit: z.number().optional().default(0),
    stats: z.object({
      total_inactive_file: z.number().optional(),
      inactive_file: z.number().optional(),
      cache: z.number().optional(),
    }).passthrough().optional().default({}),
  }).passthrough()

  const DockerStatsSchema = z.object({
    cpu_stats: DockerCpuStatsSchema,
    precpu_stats: DockerCpuStatsSchema.optional(),
    memory_stats: DockerMemoryStatsSchema,
  }).passthrough()

  type DockerStats = z.infer<typeof DockerStatsSchema>

  export interface ContainerV2 {
    id: string
    name: string
    project: string
    service?: string
    composeWorkingDir?: string
    composeConfigFiles: string[]
    ports: Array<{
      hostIp?: string
      privatePort: number
      publicPort?: number
      type: string
    }>
    state: string
    status: string
    health?: DockerHealth
  }

  export interface ContainerStats {
    id: string
    cpuPercent: number
    memoryPercent: number
    memoryUsage: number
    memoryLimit: number
  }

  export type ComposeProject = {
    project: string
    workingDir?: string
    configFiles: string[]
  }

  export type ComposeService = ComposeProject & {
    service: string
  }

  async function pathExists(filePath: string): Promise<boolean> {
    return access(filePath).then(() => true).catch(() => false)
  }

  function parseJson(text: string): unknown | undefined {
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }

  function toLocalSocketPath(host: string): string | undefined {
    if (host.startsWith("unix://")) {
      return host.slice("unix://".length)
    }

    if (host.startsWith("/")) {
      return host
    }

    return undefined
  }

  async function readDockerConfigContext(): Promise<string | undefined> {
    const configPath = join(homedir(), ".docker", "config.json")
    const raw: unknown = await Bun.file(configPath).json().catch(() => undefined)
    const parsed = DockerConfigSchema.safeParse(raw)

    if (!parsed.success) {
      return undefined
    }

    const context = parsed.data.currentContext?.trim()
    return context && context.length > 0 ? context : undefined
  }

  async function readContextHost(contextName: string): Promise<string | undefined> {
    const metaRoot = join(homedir(), ".docker", "contexts", "meta")
    const dirs = await readdir(metaRoot, { withFileTypes: true }).catch(() => [])

    for (const dir of dirs) {
      if (!dir.isDirectory()) {
        continue
      }

      const metaPath = join(metaRoot, dir.name, "meta.json")
      const raw: unknown = await Bun.file(metaPath).json().catch(() => undefined)
      const parsed = DockerContextMetaSchema.safeParse(raw)

      if (!parsed.success) {
        continue
      }

      if (parsed.data.Name !== contextName) {
        continue
      }

      const host = parsed.data.Endpoints?.docker?.Host
      if (!host) {
        continue
      }

      return host
    }

    return undefined
  }

  async function readContextSocket(contextName: string): Promise<string | undefined> {
    const host = await readContextHost(contextName)
    if (!host) return undefined

    const socketPath = toLocalSocketPath(host)
    if (!socketPath) return undefined
    if (await pathExists(socketPath)) return socketPath
    return undefined
  }

  function inferHealth(status: string): DockerHealth | undefined {
    const normalized = status.toLowerCase()

    if (normalized.includes("unhealthy")) {
      return "unhealthy"
    }

    if (normalized.includes("health: starting") || normalized.includes("(starting)")) {
      return "starting"
    }

    if (normalized.includes("healthy")) {
      return "healthy"
    }

    return undefined
  }

  function calculateCpuPercent(stats: DockerStats): number {
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats?.cpu_usage.total_usage ?? 0)
    const systemDelta = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats?.system_cpu_usage ?? 0)
    const onlineCpus = stats.cpu_stats.online_cpus ?? stats.cpu_stats.cpu_usage.percpu_usage?.length ?? 1

    if (cpuDelta <= 0 || systemDelta <= 0) {
      return 0
    }

    return (cpuDelta / systemDelta) * onlineCpus * 100
  }

  function calculateMemoryUsage(stats: DockerStats): number {
    const usage = stats.memory_stats.usage
    const inactiveFile = stats.memory_stats.stats.total_inactive_file
      ?? stats.memory_stats.stats.inactive_file
      ?? stats.memory_stats.stats.cache
      ?? 0

    return Math.max(usage - inactiveFile, 0)
  }

  function calculateContainerStats(id: string, stats: DockerStats): ContainerStats {
    const memoryUsage = calculateMemoryUsage(stats)
    const memoryLimit = stats.memory_stats.limit

    return {
      id,
      cpuPercent: calculateCpuPercent(stats),
      memoryPercent: memoryLimit > 0 ? (memoryUsage / memoryLimit) * 100 : 0,
      memoryUsage,
      memoryLimit,
    }
  }

  function parseComposeConfigFiles(value: string | undefined): string[] {
    if (!value) return []
    return value.split(",").map(file => file.trim()).filter(Boolean)
  }

  async function runDocker(args: string[], cwd?: string): Promise<void> {
    const proc = Bun.spawn(["docker", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    })

    const [exitCode, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
    ])

    if (exitCode !== 0) {
      const message = stderr.trim() || `docker ${args.join(" ")} failed with exit code ${exitCode}`
      throw new Error(message)
    }
  }

  function composeProjectArgs(project: ComposeProject): string[] {
    const args = ["compose"]

    if (project.workingDir) {
      args.push("--project-directory", project.workingDir)
    }

    for (const file of project.configFiles) {
      args.push("-f", file)
    }

    args.push("-p", project.project)
    return args
  }

  async function request(socketPath: string, path: string, method: string = "GET"): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const req = http.request({ socketPath, path, method }, (res) => {
        let data = ""
        res.on("data", (chunk) => {
          data += chunk
        })

        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Docker API ${res.statusCode}: ${data}`))
            return
          }

          if (!data.trim()) {
            reject(new Error("Docker API returned empty response"))
            return
          }

          const parsed = parseJson(data)
          if (parsed === undefined) {
            reject(new Error("Docker API returned invalid JSON"))
            return
          }

          resolve(parsed)
        })
      })

      req.on("error", reject)
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy(new Error(`Docker request timed out after ${REQUEST_TIMEOUT_MS}ms`))
      })
      req.end()
    })
  }

  export async function getSocket(): Promise<string> {
    const dockerHost = process.env.DOCKER_HOST?.trim()
    const envSocket = dockerHost ? toLocalSocketPath(dockerHost) : undefined

    if (envSocket && await pathExists(envSocket)) {
      return envSocket
    }

    const contextName = await readDockerConfigContext()
    if (contextName && contextName !== "default") {
      const contextSocket = await readContextSocket(contextName)
      if (contextSocket) {
        return contextSocket
      }
    }

    for (const candidate of FALLBACK_LOCAL_SOCKETS) {
      if (await pathExists(candidate)) {
        return candidate
      }
    }

    return DEFAULT_SOCKET
  }

  export async function getShellSocket(): Promise<string> {
    const dockerHost = process.env.DOCKER_HOST?.trim()

    if (dockerHost) {
      const envSocket = toLocalSocketPath(dockerHost)
      if (!envSocket) {
        throw new Error(`Embedded shell supports local Docker sockets only. DOCKER_HOST uses ${dockerHost}.`)
      }
      if (await pathExists(envSocket)) return envSocket
      throw new Error(`Docker socket not found: ${envSocket}`)
    }

    const contextName = await readDockerConfigContext()
    if (contextName && contextName !== "default") {
      const host = await readContextHost(contextName)
      if (!host) {
        throw new Error(`Embedded shell supports local Docker sockets only. Docker context "${contextName}" has no local socket.`)
      }

      const contextSocket = toLocalSocketPath(host)
      if (!contextSocket) {
        throw new Error(`Embedded shell supports local Docker sockets only. Docker context "${contextName}" uses ${host}.`)
      }
      if (await pathExists(contextSocket)) return contextSocket
      throw new Error(`Docker context "${contextName}" socket not found: ${contextSocket}`)
    }

    for (const candidate of FALLBACK_LOCAL_SOCKETS) {
      if (await pathExists(candidate)) {
        return candidate
      }
    }

    return DEFAULT_SOCKET
  }

  export async function getContainers(): Promise<ContainerV2[]> {
    const socketPath = await getSocket()
    const raw = await request(socketPath, "/containers/json?all=1")
    const portSchema = z.object({
      IP: z.string().optional(),
      PrivatePort: z.number(),
      PublicPort: z.number().optional(),
      Type: z.string(),
    })
    const parsed = z.array(z.object({
      Id: z.string(),
      Names: z.array(z.string()),
      State: z.string(),
      Status: z.string(),
      Labels: z.record(z.string(), z.string()).nullable().optional(),
      Ports: z.array(portSchema).optional().default([]),
    })).safeParse(raw)

    if (!parsed.success) {
      return []
    }

    return parsed.data
      .map((container: DockerContainer): ContainerV2 => {
        const primaryName = container.Names[0] ?? container.Id.slice(0, 12)
        const labels = container.Labels ?? {}
        const composeProject = labels["com.docker.compose.project"]
        return {
          id: container.Id,
          name: primaryName.replace(/^\//, ""),
          project: composeProject ?? "Standalone",
          service: labels["com.docker.compose.service"],
          composeWorkingDir: labels["com.docker.compose.project.working_dir"],
          composeConfigFiles: parseComposeConfigFiles(labels["com.docker.compose.project.config_files"]),
          ports: container.Ports?.map(port => ({
            hostIp: port.IP,
            privatePort: port.PrivatePort,
            publicPort: port.PublicPort,
            type: port.Type,
          })) ?? [],
          state: container.State,
          status: container.Status,
          health: inferHealth(container.Status),
        }
      })
      .sort((a, b) => {
        if (a.state === "running" && b.state !== "running") return -1
        if (b.state === "running" && a.state !== "running") return 1
        return a.name.localeCompare(b.name)
      })
  }

  export async function getContainerStats(containerIds: string[]): Promise<Record<string, ContainerStats>> {
    if (containerIds.length === 0) return {}

    const socketPath = await getSocket()
    const stats = await Promise.all(containerIds.map(async (id) => {
      const raw = await request(socketPath, `/containers/${encodeURIComponent(id)}/stats?stream=false`)
        .catch(() => undefined)
      const parsed = DockerStatsSchema.safeParse(raw)

      if (!parsed.success) {
        return undefined
      }

      return calculateContainerStats(id, parsed.data)
    }))
    const result: Record<string, ContainerStats> = {}

    for (const item of stats) {
      if (!item) continue
      result[item.id] = item
    }

    return result
  }

  export async function stopContainer(container: string): Promise<void> {
    await runDocker(["stop", container])
  }

  export async function startContainer(container: string): Promise<void> {
    await runDocker(["start", container])
  }

  export async function restartContainer(container: string): Promise<void> {
    await runDocker(["restart", container])
  }

  export async function removeContainer(container: string): Promise<void> {
    await runDocker(["rm", container])
  }

  export async function stopContainers(containers: string[]): Promise<void> {
    if (containers.length === 0) return
    await runDocker(["stop", ...containers])
  }

  export async function startContainers(containers: string[]): Promise<void> {
    if (containers.length === 0) return
    await runDocker(["start", ...containers])
  }

  export async function stopComposeProject(project: ComposeProject): Promise<void> {
    await runDocker([...composeProjectArgs(project), "stop"], project.workingDir)
  }

  export async function downComposeProject(project: ComposeProject): Promise<void> {
    await runDocker([...composeProjectArgs(project), "down"], project.workingDir)
  }

  export async function upComposeProject(project: ComposeProject): Promise<void> {
    await runDocker([...composeProjectArgs(project), "up", "-d"], project.workingDir)
  }

  export async function restartComposeProject(project: ComposeProject): Promise<void> {
    await runDocker([...composeProjectArgs(project), "restart"], project.workingDir)
  }

  export async function recreateComposeProject(project: ComposeProject): Promise<void> {
    await downComposeProject(project)
    await runDocker([...composeProjectArgs(project), "up", "-d", "--build"], project.workingDir)
  }

  export async function recreateComposeService(service: ComposeService): Promise<void> {
    await runDocker([
      ...composeProjectArgs(service),
      "up",
      "-d",
      "--build",
      "--force-recreate",
      service.service,
    ], service.workingDir)
  }

  export async function removeComposeProject(project: ComposeProject): Promise<void> {
    await downComposeProject(project)
  }
}
