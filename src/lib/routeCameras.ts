export const ROUTE_CAMERA_LIMIT = 40

/** Input is in driving order. Keep the ends, then fill the largest gaps by driving distance. */
export function selectRouteCameras<T extends { along: number }>(cameras: T[]): T[] {
  if (cameras.length <= ROUTE_CAMERA_LIMIT) return cameras
  const selected = [0, cameras.length - 1]
  while (selected.length < ROUTE_CAMERA_LIMIT) {
    let bestIndex = -1, bestGap = -1
    for (let gap = 1; gap < selected.length; gap++) {
      const left = selected[gap - 1], right = selected[gap]
      for (let i = left + 1; i < right; i++) {
        const spacing = Math.min(cameras[i].along - cameras[left].along, cameras[right].along - cameras[i].along)
        if (spacing > bestGap) { bestGap = spacing; bestIndex = i }
      }
    }
    selected.push(bestIndex)
    selected.sort((a, b) => a - b)
  }
  return selected.map((i) => cameras[i])
}
