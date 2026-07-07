import type { Container, ContainerPort } from "@/context/application"

const WEB_PORT_PRIORITY = [443, 8443, 9443, 80, 8080, 8000, 3000, 5000, 5173]
const HTTPS_PORTS = new Set([443, 8443, 9443])

export type PublishedContainerPort = ContainerPort & {
  publicPort: number
}

function isPublishedTcpPort(port: ContainerPort): port is PublishedContainerPort {
  return port.type.toLowerCase() === "tcp" && typeof port.publicPort === "number"
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
  if (!port.hostIp || port.hostIp === "0.0.0.0" || port.hostIp === "::") return "localhost"
  if (port.hostIp === "127.0.0.1" || port.hostIp === "::1") return "localhost"
  if (port.hostIp.includes(":")) return `[${port.hostIp}]`
  return port.hostIp
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

  const protocol = HTTPS_PORTS.has(port.publicPort) || HTTPS_PORTS.has(port.privatePort) ? "https" : "http"
  return `${protocol}://${getHost(port)}:${port.publicPort}`
}

export function formatContainerWebPort(port: PublishedContainerPort | undefined): string | undefined {
  if (!port) return undefined
  if (port.publicPort === port.privatePort) return String(port.publicPort)
  return `${port.publicPort}->${port.privatePort}`
}
