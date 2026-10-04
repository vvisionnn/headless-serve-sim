import { expect, test } from "bun:test";
import { sendDeviceView, type DeviceView } from "../client/utils/device-view-control";

function socket(readyState: number) {
  const messages: Uint8Array[] = [];
  return { readyState, messages, send: (message: Uint8Array) => messages.push(message) };
}
const payload = (message: Uint8Array) => JSON.parse(new TextDecoder().decode(message.subarray(1)));

test("view preferences survive closed and connecting sockets and replay on open", () => {
  const ws = socket(0);
  const view: DeviceView = { rotation: 90, includeFrame: false };
  expect(sendDeviceView(ws, view)).toBe(false);
  expect(view.includeFrame).toBe(false);
  ws.readyState = 3;
  expect(sendDeviceView(ws, view)).toBe(false);
  ws.readyState = 1;
  expect(sendDeviceView(ws, view)).toBe(true);
  expect(ws.messages[0]![0]).toBe(0x0f);
  expect(payload(ws.messages[0]!)).toEqual({ rotation: 90, includeFrame: false });
  expect(view.includeFrame).toBeUndefined();
  sendDeviceView(ws, view);
  expect(payload(ws.messages[1]!)).toEqual({ rotation: 90 });
});
