export interface DeviceView {
  rotation: number;
  includeFrame?: boolean;
}

export function sendDeviceView(
  socket: { readyState: number; send(data: Uint8Array<ArrayBuffer>): void } | null,
  view: DeviceView | null,
): boolean {
  if (!socket || socket.readyState !== 1 || !view) return false;
  const json = new TextEncoder().encode(JSON.stringify(view));
  const message = new Uint8Array(1 + json.length);
  message[0] = 0x0f;
  message.set(json, 1);
  socket.send(message);
  delete view.includeFrame;
  return true;
}
