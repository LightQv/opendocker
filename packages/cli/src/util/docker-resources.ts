import type { Container, Image, Volume } from "@/context/application"

export function applyImageUsage(images: Image[], containers: Container[]): Image[] {
  const usedImageIds = new Set(
    containers
      .map(container => container.imageId)
      .filter((imageId): imageId is string => Boolean(imageId)),
  )

  return images.map(image => ({ ...image, used: usedImageIds.has(image.id) }))
}

export function applyVolumeUsage(volumes: Volume[], containers: Container[]): Volume[] {
  const usedVolumeNames = new Set(
    containers.flatMap(container => container.volumeNames ?? []),
  )

  return volumes.map(volume => ({ ...volume, used: usedVolumeNames.has(volume.name) }))
}
