import type { Container, ContainerStats } from "@/context/application"

export type ContainerStatsSummary = {
  cpuPercent: number
  memoryPercent: number
  memoryUsage: number
  memoryLimit: number
  hasStats: boolean
}

export const EMPTY_CONTAINER_STATS_SUMMARY: ContainerStatsSummary = {
  cpuPercent: 0,
  memoryPercent: 0,
  memoryUsage: 0,
  memoryLimit: 0,
  hasStats: false,
}

function cleanMetric(value: number): number {
  return Number.isFinite(value) ? Math.max(value, 0) : 0
}

export function summarizeContainerStats(stats: ContainerStats | undefined): ContainerStatsSummary {
  if (!stats) return EMPTY_CONTAINER_STATS_SUMMARY

  return {
    cpuPercent: cleanMetric(stats.cpuPercent),
    memoryPercent: cleanMetric(stats.memoryPercent),
    memoryUsage: cleanMetric(stats.memoryUsage),
    memoryLimit: cleanMetric(stats.memoryLimit),
    hasStats: true,
  }
}

export function summarizeProjectStats(
  containers: Container[],
  statsByContainer: Record<string, ContainerStats>,
): ContainerStatsSummary {
  let cpuPercent = 0
  let memoryUsage = 0
  let memoryLimit = 0
  let statCount = 0

  for (const container of containers) {
    const stats = statsByContainer[container.id]
    if (!stats) continue

    cpuPercent += cleanMetric(stats.cpuPercent)
    memoryUsage += cleanMetric(stats.memoryUsage)
    memoryLimit += cleanMetric(stats.memoryLimit)
    statCount += 1
  }

  if (statCount === 0) return EMPTY_CONTAINER_STATS_SUMMARY

  return {
    cpuPercent,
    memoryPercent: memoryLimit > 0 ? (memoryUsage / memoryLimit) * 100 : 0,
    memoryUsage,
    memoryLimit,
    hasStats: true,
  }
}

export function formatStatsPercent(value: number, hasStats: boolean) {
  if (!hasStats) return "-"
  const percent = cleanMetric(value)
  return `${percent >= 100 ? percent.toFixed(0) : percent.toFixed(1)}%`
}

export function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = cleanMetric(bytes)
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

export function formatStatsMemory(stats: ContainerStatsSummary) {
  if (!stats.hasStats) return "-"

  const limit = stats.memoryLimit > 0 ? formatBytes(stats.memoryLimit) : "-"
  return `${formatBytes(stats.memoryUsage)} / ${limit} (${formatStatsPercent(stats.memoryPercent, true)})`
}
