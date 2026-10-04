export function recordingExtension(mimeType: string): "mp4" | "webm" {
  return mimeType.toLowerCase().startsWith("video/mp4") ? "mp4" : "webm";
}

export function recordingFilename(startedAt: Date, mimeType: string): string {
  const stamp = startedAt
    .toISOString()
    .replace(/\.\d{3}Z$/, "")
    .replace(/[-:T]/g, "");
  return `simulator-${stamp}.${recordingExtension(mimeType)}`;
}
