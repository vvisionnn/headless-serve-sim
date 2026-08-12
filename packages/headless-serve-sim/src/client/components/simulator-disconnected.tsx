// Shown when the user-selected simulator disconnects. The view stays pinned to
// that selection until the user explicitly opens the picker.
export function SimulatorDisconnected({
  deviceName,
  onChooseAnother,
}: {
  deviceName: string | null;
  onChooseAnother: () => void;
}) {
  const name = deviceName ?? "This simulator";
  return (
    <div className="ds-canvas flex h-screen w-screen flex-col items-center justify-center p-6 font-system box-border">
      <div className="flex w-full max-w-100 flex-col items-center gap-3 rounded-panel bg-panel shadow-panel px-6 py-8 text-center">
        {/* Small solid status dot — orange reads as "waiting", not an error. */}
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: "var(--color-warning)" }}
        />
        <h1 className="m-0 font-display text-heading font-semibold text-fg">{name} disconnected</h1>
        <p className="m-0 max-w-90 text-body text-fg-2">
          The view stays with this simulator and resumes once {name} is available again.
        </p>
        <button
          type="button"
          onClick={onChooseAnother}
          className="mt-1 cursor-pointer rounded-card border border-divider bg-panel px-4 py-2 text-value font-medium text-fg [transition:background_0.2s_cubic-bezier(0.4,0,0.6,1)] hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
        >
          Choose another simulator
        </button>
      </div>
    </div>
  );
}
