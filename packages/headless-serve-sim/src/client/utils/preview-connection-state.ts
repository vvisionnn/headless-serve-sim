export interface PreviewConnectionState<T> {
  config: T | null;
  helperAvailable: boolean;
}

export function updateSelectedPreviewConnection<T extends { device: string }>(
  previous: PreviewConnectionState<T>,
  next: T | null,
  selectedDevice: string | null,
): PreviewConnectionState<T> {
  if (!next || !selectedDevice || next.device !== selectedDevice) {
    return previous.helperAvailable
      ? { config: previous.config, helperAvailable: false }
      : previous;
  }
  return { config: next, helperAvailable: true };
}
