import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PhonePreviewCard } from "../client/shell/phone-link";

describe("PhonePreviewCard", () => {
  test("renders a scannable and copyable selected-device link", () => {
    const url = "http://192.168.1.42:3200/phone/secret/11111111-2222-3333-4444-555555555555";
    const html = renderToStaticMarkup(
      <PhonePreviewCard url={url} deviceName="iPhone Air" copied={false} onCopy={() => {}} />,
    );

    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="QR code for phone preview"');
    expect(html).toContain("192.168.1.42:3200");
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain("iPhone Air");
    expect(html).toContain(">Copy<");
    expect(html).toContain("autofocus");
  });

  test("morphs the button label once copied", () => {
    const html = renderToStaticMarkup(
      <PhonePreviewCard url="http://x.local/p" copied onCopy={() => {}} />,
    );
    expect(html).toContain(">Copied<");
    expect(html).toContain("Phone preview link copied");
  });
});
