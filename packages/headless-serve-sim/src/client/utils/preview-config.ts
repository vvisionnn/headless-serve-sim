type PreviewConfig = NonNullable<Window["__SIM_PREVIEW__"]>;

export function selectedPreviewConfig(
  config: Partial<PreviewConfig> | null | undefined,
): PreviewConfig | null {
  if (
    !config ||
    typeof config.device !== "string" ||
    !config.device.trim() ||
    typeof config.pid !== "number" ||
    typeof config.port !== "number" ||
    typeof config.url !== "string" ||
    typeof config.streamUrl !== "string" ||
    typeof config.wsUrl !== "string"
  ) {
    return null;
  }
  return config as PreviewConfig;
}

// Identity of a preview config, used to skip no-op re-renders/state writes when
// the server re-pushes an unchanged config. execToken is part of the identity
// on purpose: the server mints a fresh token on every process start, and the
// control socket must re-auth with the new one. Leaving it out made a pushed
// config look unchanged after a restart, so window.__SIM_PREVIEW__ kept a dead
// token and the control socket stayed closed until a manual page reload.
export function previewConfigKey(config: PreviewConfig | null): string {
  return config
    ? [
        config.device,
        config.pid,
        config.streamUrl,
        config.wsUrl,
        config.deviceName ?? "",
        config.deviceTypeIdentifier ?? "",
        JSON.stringify(config.deviceFrameSpec ?? null),
        config.execToken ?? "",
      ].join(":")
    : "";
}
