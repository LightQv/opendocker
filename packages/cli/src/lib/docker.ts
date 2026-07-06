import http from "http"
import type { Image, Volume } from "@/context/application"

const DEFAULT_SOCKET = "/var/run/docker.sock"

interface DockerImage {
  Id: string
  RepoTags: string[] | null
  Size: number
  Created: number
}

interface DockerContainerUsage {
  ImageID: string
  Mounts?: Array<{
    Type?: string
    Name?: string
  }>
}

interface DockerVolume {
  Name: string
  Driver: string
  Scope: string
  Mountpoint: string
  Labels: Record<string, string> | null
  Options: Record<string, string> | null
  Status: Record<string, string> | null
}

export interface ImageHistoryItem {
  Id: string
  Created: number
  CreatedBy: string
  Size: number
  Comment: string
  Tags: string[] | null
}

export class Docker {
  private static instance: Docker | null = null
  private socketPath: string

  private constructor(socket: string) {
    this.socketPath = socket
  }

  public static getInstance(): Docker {
    if (!Docker.instance) {
      Docker.instance = new Docker(DEFAULT_SOCKET)
      Docker.detectAndUpdateSocket()
    }
    return Docker.instance
  }

  private static async detectAndUpdateSocket() {
    try {
      const detectedSocket = await Docker.getSocket()

      if (Docker.instance && detectedSocket !== Docker.instance.socketPath) {
        console.log(`Updating socket from ${Docker.instance.socketPath} to ${detectedSocket}`)
        Docker.instance.socketPath = detectedSocket
      }
    } catch (error) {
      console.error("Failed to detect docker socket:", error)
    }
  }

  public static async getSocket(): Promise<string> {
    try {
      const res =
        await Bun.$`docker context inspect --format '{{.Endpoints.docker.Host}}' | sed 's|unix://||'`.text()
      return res.trim() || "/var/run/docker.sock"
    } catch (error) {
      console.error("Failed to get docker socket:", error)
      return "/var/run/docker.sock"
    }
  }

  private request(path: string, method: string = "GET"): Promise<any> {
    return new Promise((resolve, reject) => {
      const options = {
        socketPath: this.socketPath,
        path: path,
        method: method,
      }

      const req = http.request(options, (res) => {
        let data = ""
        res.on("data", chunk => data += chunk)
        res.on("end", () => {
          try {
            resolve(JSON.parse(data))
          } catch (err) {
            reject(new Error(`Failed to parse response: ${err}`))
          }
        })
      })

      req.on("error", reject)
      req.end()
    })
  }

  private async runDocker(args: string[]): Promise<void> {
    const proc = Bun.spawn(["docker", ...args], {
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

  private async getContainerUsage(): Promise<{ imageIds: Set<string>, volumeNames: Set<string> }> {
    const containers: DockerContainerUsage[] = await this.request("/containers/json?all=1")
    const imageIds = new Set<string>()
    const volumeNames = new Set<string>()

    for (const container of containers) {
      if (container.ImageID) {
        imageIds.add(container.ImageID)
      }

      for (const mount of container.Mounts ?? []) {
        if (mount.Type === "volume" && mount.Name) {
          volumeNames.add(mount.Name)
        }
      }
    }

    return { imageIds, volumeNames }
  }

  public async streamImages(): Promise<Array<Image>> {
    const [images, usage] = await Promise.all([
      this.request("/images/json") as Promise<DockerImage[]>,
      this.getContainerUsage(),
    ])

    return images
      .map((image: DockerImage) => {
        const fullName = image.RepoTags?.[0] ?? "<none>:<none>"
        const lastColonIndex = fullName.lastIndexOf(":")
        const name = lastColonIndex > 0 ? fullName.substring(0, lastColonIndex) : fullName
        const tag = lastColonIndex > 0 ? fullName.substring(lastColonIndex + 1) : "<none>"
        const bytes = image.Size
        const mb = Math.round(bytes / 1_000_000)
        const createdDate = new Date(image.Created * 1000)
        const created = createdDate.toLocaleDateString()

        return {
          id: image.Id,
          name,
          tag,
          size: `${mb} MB`,
          created,
          used: usage.imageIds.has(image.Id),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  public async getContainer(id: string): Promise<string> {
    const data = await this.request(`/containers/${id}/json`)
    return data.Name
  }

  public getLogsStream(containerId: string): http.ClientRequest {
    const options = {
      socketPath: this.socketPath,
      path: `/containers/${containerId}/logs?follow=1&stdout=1&stderr=1&tail=100`,
      method: "GET",
    }

    return http.request(options)
  }

  public async streamImageHistory(imageId: string): Promise<ImageHistoryItem[]> {
    return this.request(`/images/${imageId}/history`)
  }

  public async removeImage(imageId: string): Promise<void> {
    await this.runDocker(["image", "rm", imageId])
  }

  public async streamVolumes(): Promise<Array<Volume>> {
    const [response, usage] = await Promise.all([
      this.request("/volumes"),
      this.getContainerUsage(),
    ])
    const volumes: DockerVolume[] = response.Volumes || []

    return volumes
      .map((volume: DockerVolume) => ({
        name: volume.Name,
        driver: volume.Driver,
        scope: volume.Scope,
        mountpoint: volume.Mountpoint,
        labels: volume.Labels || {},
        options: volume.Options,
        status: volume.Status,
        used: usage.volumeNames.has(volume.Name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  public async removeVolume(volumeName: string): Promise<void> {
    await this.runDocker(["volume", "rm", volumeName])
  }
}
