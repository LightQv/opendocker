import http from "http"
import { DockerV2 } from "./docker-v2"

const DEFAULT_SOCKET = "/var/run/docker.sock"

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
    return DockerV2.getSocket()
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

  public async removeVolume(volumeName: string): Promise<void> {
    await this.runDocker(["volume", "rm", volumeName])
  }
}
