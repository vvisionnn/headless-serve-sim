export interface DetectedAppState {
  device: string;
  bundleId: string;
  isReactNative: boolean;
  pid?: number;
}

export function currentAppForDevice(
  app: DetectedAppState | null,
  device: string,
): DetectedAppState | null {
  return app?.device === device ? app : null;
}
