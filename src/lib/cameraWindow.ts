export const PRELOAD_CAMERAS = 3

/** Visible cameras refresh; only the next few are warmed once for smooth navigation. */
export function cameraWindow<T extends { id: string }>(cameras: T[], visible: number[]) {
  const indexes = [...new Set(visible)].filter((i) => i >= 0 && i < cameras.length).sort((a, b) => a - b)
  const last = indexes.at(-1)
  return {
    visible: indexes.map((i) => cameras[i].id),
    preload: last == null ? [] : cameras.slice(last + 1, last + 1 + PRELOAD_CAMERAS).map((c) => c.id),
  }
}
