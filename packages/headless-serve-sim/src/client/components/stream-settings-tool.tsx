import { useState } from "react";
import { CollapsibleSection } from "./collapsible-section";
import { SettingSwitch } from "./setting-switch";

// Inspector section for stream/viewer preferences that live in the browser
// (localStorage), not on the simulator device. Today it hosts a single control:
// whether the view may hop to another booted simulator when the selected one
// disconnects.
export function StreamSettingsTool({
  autoConnect,
  onAutoConnectChange,
}: {
  autoConnect: boolean;
  onAutoConnectChange: (next: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <CollapsibleSection
      open={open}
      onOpenChange={setOpen}
      data-stream-settings=""
      summary="Streaming"
    >
      <div className="flex flex-col gap-2">
        <div
          className="flex items-center justify-between gap-2 min-h-[32px]"
          data-setting-row="Auto-connect"
        >
          <span className="text-[13px] text-fg-3 whitespace-nowrap">
            Auto-connect to another simulator
          </span>
          <SettingSwitch
            label="Auto-connect to another simulator"
            checked={autoConnect}
            onChange={onAutoConnectChange}
          />
        </div>
        <p className="m-0 text-[12px] leading-snug tracking-[-0.01em] text-fg-3">
          When your simulator disconnects, switch to whichever simulator is booted. Off keeps the
          view on your chosen simulator and resumes when it returns.
        </p>
      </div>
    </CollapsibleSection>
  );
}
