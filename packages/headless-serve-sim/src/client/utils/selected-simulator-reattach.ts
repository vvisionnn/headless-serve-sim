export interface SelectedSimulatorReattachRequest {
  udid: string;
}

export function selectedSimulatorReattachRequest(
  helperAvailable: boolean,
  selectedDevice: string | null,
): SelectedSimulatorReattachRequest | null {
  return !helperAvailable && selectedDevice ? { udid: selectedDevice } : null;
}
