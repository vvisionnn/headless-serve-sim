import { AppActionsTool } from "../components/app-actions-tool";
import { AppDetectionTool } from "../components/app-detection-tool";
import { AppPermissionsTool } from "../components/app-permissions-tool";
import { ImportDocumentTool } from "../components/import-document-tool";
import { UserDefaultsTool } from "../components/user-defaults-tool";
import type { InspectorProps } from "./types";

/** App: who is in the foreground, what you can do to it, and what it stores. */
export function AppTab({ udid, currentApp }: InspectorProps) {
  const bundleId = currentApp?.bundleId ?? null;
  return (
    <>
      <AppDetectionTool udid={udid} currentApp={currentApp} />
      <AppActionsTool udid={udid} bundleId={bundleId} />
      <AppPermissionsTool udid={udid} bundleId={bundleId} />
      <UserDefaultsTool udid={udid} bundleId={bundleId} />
      <ImportDocumentTool udid={udid} />
    </>
  );
}
