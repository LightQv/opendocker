import { isIP } from "node:net"
import type { Container, ContainerPort } from "@/context/application"

const WEB_PORT_PRIORITY = [443, 8443, 9443, 80, 8080, 8000, 3000, 5000, 5173]
const HTTPS_PORTS = new Set([443, 8443, 9443])

export type PublishedContainerPort = ContainerPort & {
  publicPort: number
}

function isPublishedTcpPort(port: ContainerPort): port is PublishedContainerPort {
  return port.type.toLowerCase() === "tcp" && isValidPort(port.privatePort) && isValidPort(port.publicPort)
}

function isValidPort(port: number | undefined): port is number {
  return port !== undefined && Number.isInteger(port) && port > 0 && port <= 65535
}

function getPortPriority(port: PublishedContainerPort) {
  const publicIndex = WEB_PORT_PRIORITY.indexOf(port.publicPort)
  const privateIndex = WEB_PORT_PRIORITY.indexOf(port.privatePort)

  if (publicIndex === -1 && privateIndex === -1) return WEB_PORT_PRIORITY.length
  if (publicIndex === -1) return privateIndex
  if (privateIndex === -1) return publicIndex
  return Math.min(publicIndex, privateIndex)
}

function getHost(port: PublishedContainerPort) {
  const hostIp = port.hostIp?.trim()
  if (!hostIp || hostIp === "0.0.0.0" || hostIp === "::") return "localhost"
  if (hostIp === "127.0.0.1" || hostIp === "::1") return "localhost"
  if (isIP(hostIp) === 6) return `[${hostIp}]`
  if (isIP(hostIp) === 4) return hostIp
  return "localhost"
}

export function getContainerWebPort(container: Container | undefined): PublishedContainerPort | undefined {
  if (!container) return undefined

  return container.ports
    .filter(isPublishedTcpPort)
    .sort((a, b) => getPortPriority(a) - getPortPriority(b) || a.publicPort - b.publicPort)[0]
}

export function canOpenContainerWebUi(container: Container | undefined): boolean {
  return container?.state === "running" && getContainerWebPort(container) !== undefined
}

export function getContainerWebUrl(container: Container | undefined): string | undefined {
  const port = getContainerWebPort(container)
  if (!port) return undefined

  const protocol = HTTPS_PORTS.has(port.privatePort) ? "https" : "http"
  const url = new URL(`${protocol}://${getHost(port)}`)
  url.port = String(port.publicPort)
  return url.toString().replace(/\/$/, "")
}

export function formatContainerWebPort(port: PublishedContainerPort | undefined): string | undefined {
  if (!port) return undefined
  return `${port.publicPort}->${port.privatePort}`
}
