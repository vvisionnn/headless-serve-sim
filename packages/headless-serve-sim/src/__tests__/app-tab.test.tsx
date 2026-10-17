import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { formatVersion } from "../client/components/app-detection-tool";
import { actionForSegment, segmentForAction } from "../client/components/app-permissions-tool";
import { formatFileSize, localStorageName } from "../client/components/import-document-tool";
import { AppTab } from "../client/inspector/app-tab";
import type { InspectorProps } from "../client/inspector/types";

// The tools read window.__SIM_PREVIEW__ for the CLI path; SSR has no window.
(globalThis as { window?: unknown }).window ??= globalThis;

test("permission segments map onto the CLI's grant/revoke/reset actions", () => {
  expect(segmentForAction("grant")).toBe("allow");
  expect(segmentForAction("revoke")).toBe("deny");
  expect(segmentForAction("reset")).toBe("unset");
  expect(segmentForAction(undefined)).toBe("unset");
  expect(actionForSegment("allow")).toBe("grant");
  expect(actionForSegment("deny")).toBe("revoke");
  expect(actionForSegment("unset")).toBe("reset");
});

test("version shows short (build), an ellipsis while loading, else a dash", () => {
  expect(formatVersion({ shortVersion: "2.4.1", bundleVersion: "318", loading: false })).toBe(
    "2.4.1 (318)",
  );
  expect(formatVersion({ shortVersion: "2.4.1", loading: false })).toBe("2.4.1 (—)");
  expect(formatVersion({ loading: true })).toBe("…");
  expect(formatVersion({ loading: false })).toBe("—");
});

test("document sizes read like Finder", () => {
  expect(formatFileSize(512)).toBe("512 B");
  expect(formatFileSize(2048)).toBe("2 KB");
  expect(formatFileSize(2.4 * 1024 * 1024)).toBe("2.4 MB");
});

test("Files' local storage is named after the device", () => {
  expect(localStorageName("iphone")).toBe("On My iPhone");
  expect(localStorageName("ipad")).toBe("On My iPad");
  expect(localStorageName(undefined)).toBe("On My iPad");
});

test("app tab waits for a foreground app and keeps every section", () => {
  const html = renderToStaticMarkup(
    <AppTab {...({ udid: "U", currentApp: null } as unknown as InspectorProps)} />,
  );
  expect(html).toContain("Waiting for an app to come to the foreground…");
  for (const title of ["Actions", "Permissions", "User defaults", "Documents"]) {
    expect(html).toContain(`>${title}</h3>`);
  }
  expect(html).toContain('type="file"');
  expect(html).not.toMatch(/bg-panel|text-fg|border-divider|rounded-card|text-value|ds-/);
});

test("permissions render one tri-state segmented control per service", () => {
  const html = renderToStaticMarkup(
    <AppTab
      {...({
        udid: "U",
        currentApp: { bundleId: "com.example.trails", isReactNative: true, pid: 42 },
      } as unknown as InspectorProps)}
    />,
  );
  expect(html).toContain('aria-label="Camera"');
  expect(html).toContain('title="Allow"');
  expect(html).toContain('title="Deny"');
  expect(html).toContain('title="Not set"');
  expect(html).toContain("Reset all");
  expect(html).toContain("React Native");
  expect(html).toContain("Running");
  expect(html).toContain("com.example.trails");
});
