export interface SelectedSimulatorTarget {
  udid: string;
  name: string | null;
}

export function selectedSimulatorTarget(input: {
  urlDevice: string | null;
  liveDevice: string | null;
  liveDeviceName: string | null;
}): SelectedSimulatorTarget | null {
  const urlDevice = input.urlDevice?.trim();
  if (urlDevice) {
    return {
      udid: urlDevice,
      name: input.liveDevice?.trim() === urlDevice ? input.liveDeviceName : null,
    };
  }

  const liveDevice = input.liveDevice?.trim();
  if (liveDevice) return { udid: liveDevice, name: input.liveDeviceName };
  return null;
}
