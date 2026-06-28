import { type GridDevice, gridPreviewHref } from "../utils/grid";

export function GridTile({
  device,
  active,
  previewEndpoint,
  starting,
  shuttingDown,
  error,
  onStart,
  onShutdown,
}: {
  device: GridDevice;
  active: boolean;
  previewEndpoint: string;
  starting: boolean;
  shuttingDown: boolean;
  error: string | null;
  onStart: () => void;
  onShutdown: () => void;
}) {
  const helper = device.helper;
  const isBooted = device.state === "Booted";
  const status = helper
    ? "● live"
    : starting
    ? (isBooted ? "starting helper…" : "booting & starting…")
    : shuttingDown
    ? "shutting down…"
    : isBooted ? "booted (no stream)" : device.state.toLowerCase();
  const statusColor = helper ? "var(--color-success)" : "var(--color-fg-3)";
  const ringColor = active ? "var(--color-accent)" : "transparent";

  const Wrapper: any = helper ? "a" : "div";
  const wrapperProps = helper
    ? { href: gridPreviewHref(previewEndpoint, device.device) }
    : {};

  return (
    <Wrapper
      {...wrapperProps}
      className="grid-tile relative flex flex-col bg-surface-3 overflow-hidden no-underline text-inherit border border-divider [transition:border-color_120ms]"
      style={{ outline: `1px solid ${ringColor}` }}
    >
      {(helper || isBooted) && (
        <button
          type="button"
          title={shuttingDown ? "Shutting down…" : "Shutdown simulator"}
          aria-label="Shutdown simulator"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onShutdown();
          }}
          disabled={shuttingDown}
          className="grid-shutdown-btn absolute top-1.5 right-1.5 w-[22px] h-[22px] border border-divider bg-panel text-fg text-[13px] leading-none cursor-pointer flex items-center justify-center p-0 z-[2] pointer-events-auto"
        >
          ×
        </button>
      )}
      {helper ? (
        <div className="flex-1 min-h-0 flex items-center justify-center p-2 bg-black pointer-events-none">
          <img
            src={helper.streamUrl}
            alt={device.name}
            draggable={false}
            className="max-w-full max-h-full object-contain"
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center p-2 flex-col gap-2 text-fg-2 text-[12px] text-center">
          {starting ? (
            <span
              aria-hidden
              className="w-5.5 h-5.5 border-2 border-divider animate-[grid-spin_0.8s_linear_infinite]"
              style={{ borderTopColor: "var(--color-accent)" }}
            />
          ) : (
            <div className="text-[28px] text-fg-3">{isBooted ? "▣" : "▢"}</div>
          )}
          {error ? <div className="text-danger text-[11px] font-mono">{error}</div> : null}
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onStart(); }}
            disabled={starting}
            className={`px-2 py-1 border border-divider text-[11px] font-mono ${starting ? "bg-surface-2 text-fg-2 cursor-default" : "bg-panel text-success cursor-pointer"}`}
          >
            {starting ? (isBooted ? "Starting…" : "Booting…") : (isBooted ? "Start stream" : "Boot & start")}
          </button>
        </div>
      )}
      <div className="px-2 py-1.5 border-t border-divider text-[11px] font-mono text-fg-2 flex justify-between gap-2">
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">{device.name}</span>
        <span className="whitespace-nowrap" style={{ color: statusColor }}>
          {status}
          {helper ? <span className="text-fg-3"> :{helper.port}</span> : null}
        </span>
      </div>
    </Wrapper>
  );
}
