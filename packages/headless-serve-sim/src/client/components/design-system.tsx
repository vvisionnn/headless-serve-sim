import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

// The design system's meta components — the shapes the whole UI is assembled
// from. Presentation only: none of these own state, fetch, or talk to a device.
//
// The language, in one line: white cards float on a dotted gray canvas, hairline
// rules divide sections *inside* a card, numbers are mono in a bordered chip, and
// the only emphasis is near-black on white. No hue anywhere.

// ─── Card ───

/** A floating white card. The only thing in the tree allowed to cast a shadow. */
export function PanelCard({
  children,
  className = "",
  style,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
} & Record<`data-${string}`, string | undefined> & { "aria-label"?: string }) {
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-panel bg-panel shadow-panel ${className}`}
      style={style}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * The header's icon button: a soft-cornered square, not a circle — it echoes the
 * segment and chip shapes so the card reads as one family.
 */
export function SquareIconButton({
  onClick,
  label,
  title,
  disabled = false,
  expanded,
  children,
}: {
  onClick: () => void;
  label: string;
  title?: string;
  disabled?: boolean;
  /** For a button that discloses something — the rail toggles need this. */
  expanded?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-expanded={expanded}
      title={title ?? label}
      className="flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-sm border border-control-border bg-surface-3 text-fg-3 hover:bg-hover hover:text-fg disabled:cursor-default disabled:opacity-45 focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)] [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1),color_0.3s_cubic-bezier(0.4,0,0.6,1)]"
    >
      {children}
    </button>
  );
}

/**
 * A group of sections inside a panel. Sixteen tools as flat peers is a list, not
 * an interface — you cannot find anything because nothing says what anything is
 * FOR. Grouping is by function (what the tool acts on: the device, the app, a
 * capture, an inspection), so the label answers "where would I look for this".
 *
 * The label sticks to the top of the scroll area, so the group you are inside
 * is always named even after scrolling deep into a long panel.
 *
 * This is a real flex item, NOT `display:contents` — under `contents` the
 * group's box disappears, the parent's `shrink-0` no longer applies to anything,
 * and every section inside collapses to zero height in a bounded flex column.
 */
export function SectionGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex shrink-0 flex-col">
      <h2 className="sticky top-0 z-10 m-0 border-t border-divider bg-panel-deep px-5 py-2 text-micro font-bold uppercase tracking-[0.09em] text-fg-3">
        {label}
      </h2>
      {children}
    </section>
  );
}

/**
 * The panel collapse/expand affordance. Deliberately NOT a chevron: a chevron
 * already means "disclose this section" everywhere in the panel body, and the
 * same glyph doing two different jobs is the picker-looks-like-a-switch mistake
 * in another form. This is the shape of the thing it acts on — the panel — with
 * the side rail filled while the panel is open and hollow once it's collapsed,
 * mirrored to whichever edge the panel lives on.
 */
export function PanelToggleIcon({ side, open }: { side: "left" | "right"; open: boolean }) {
  const divider = side === "right" ? 15 : 9;
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <line x1={divider} y1="5" x2={divider} y2="19" />
      {open && (
        <rect
          x={side === "right" ? divider : 3.5}
          y="5.5"
          width={side === "right" ? 20.5 - divider : divider - 3.5}
          height="13"
          rx="1.6"
          fill="currentColor"
          stroke="none"
          opacity="0.3"
        />
      )}
    </svg>
  );
}

// ─── Value ───

/**
 * A numeric readout: mono, bordered, on white. Every number in the UI wears this
 * so values are never confused with labels.
 */
export function ValueChip({
  children,
  title,
  className = "",
}: {
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`shrink-0 rounded-chip border border-control-border bg-panel px-2.5 py-[5px] font-mono text-value leading-none text-fg tabular-nums ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * The label line that sits above a control: name on the left, current value on
 * the right. The value is mono and the lightest text rank — it reports, it
 * doesn't compete with the label.
 */
export function FieldLabel({
  label,
  value,
  htmlFor,
}: {
  label: ReactNode;
  value?: ReactNode;
  htmlFor?: string;
}) {
  // A <label> with nothing to point at is not a label — several callers name a
  // composite control (a segmented group) that has no single form element.
  const Text = htmlFor ? "label" : "span";
  return (
    <div className="flex items-center justify-between gap-3">
      <Text htmlFor={htmlFor} className="min-w-0 truncate text-body text-fg">
        {label}
      </Text>
      {value !== undefined &&
        (typeof value === "string" || typeof value === "number" ? (
          <span className="shrink-0 font-mono text-value leading-none text-fg-3">{value}</span>
        ) : (
          value
        ))}
    </div>
  );
}

// ─── Segmented ───

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

/**
 * Pick one of N. Buttons wrap onto as many rows as they need rather than
 * squeezing — a cramped segment is harder to read than a second row. The
 * selected one is a near-black fill; the rest are quiet gray on a hairline.
 */
export function SegmentedGroup<T extends string>({
  label,
  ariaLabel,
  value,
  options,
  onChange,
  disabled = false,
  showValue = true,
}: {
  label: ReactNode;
  /** Accessible name, when `label` is decorated and no longer a plain string. */
  ariaLabel?: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (next: T) => void;
  disabled?: boolean;
  /** Echo the selected label in mono at the right of the label line. */
  showValue?: boolean;
}) {
  const selected = options.find((o) => o.value === value);
  // A radiogroup promises arrow-key navigation and a single tab stop. Announcing
  // the role without implementing either leaves assistive tech describing a
  // keyboard model that doesn't work, so the group owns both.
  const step = (event: ReactKeyboardEvent<HTMLDivElement>, delta: number) => {
    const pickable = options.filter((o) => !o.disabled && !disabled);
    if (pickable.length === 0) return;
    event.preventDefault();
    const at = pickable.findIndex((o) => o.value === value);
    const next =
      pickable[
        (((at < 0 ? 0 : at + delta) % pickable.length) + pickable.length) % pickable.length
      ]!;
    onChange(next.value);
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons[options.indexOf(next)]?.focus();
  };
  return (
    <div className="flex flex-col gap-2.5">
      <FieldLabel
        label={label}
        value={
          showValue && selected && typeof selected.label === "string" ? selected.label : undefined
        }
      />
      {/* Two or three short options become equal columns filling the row, so the
          set reads as ONE segmented control rather than a couple of loose
          buttons that happen to sit next to each other. Longer sets wrap. */}
      <div
        role="radiogroup"
        aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowDown") step(e, 1);
          else if (e.key === "ArrowLeft" || e.key === "ArrowUp") step(e, -1);
        }}
        className={
          options.length <= 3 && options.every((o) => String(o.label).length <= 10)
            ? `grid gap-1.5 ${options.length === 2 ? "grid-cols-2" : "grid-cols-3"}`
            : "flex flex-wrap gap-1.5"
        }
      >
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              disabled={disabled || option.disabled}
              onClick={() => onChange(option.value)}
              className={`min-h-[40px] cursor-pointer rounded-sm px-4 text-body disabled:cursor-default disabled:opacity-45 focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)] [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1),color_0.3s_cubic-bezier(0.4,0,0.6,1),border-color_0.3s_cubic-bezier(0.4,0,0.6,1)] ${
                active
                  ? "border border-accent-solid bg-accent-solid font-semibold text-on-accent"
                  : "border border-divider bg-panel-deep text-fg-2 hover:bg-hover hover:text-fg"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Slider ───

/**
 * A value on a range. The track is tall enough to be a target in its own right;
 * the filled portion is one shade darker than the rest, and the knob rides
 * inside it. The current value sits in a chip on the label line.
 *
 * `format` renders the chip; without it the raw value is shown.
 */
export function Slider({
  label,
  ariaLabel,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  format,
  onChange,
  onCommit,
  id,
  below,
}: {
  label: ReactNode;
  /** Accessible name, when `label` is decorated and no longer a plain string. */
  ariaLabel?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  format?: (value: number) => ReactNode;
  onChange: (next: number) => void;
  onCommit?: () => void;
  id?: string;
  /** Optional tick marks or caption rendered directly under the track. */
  below?: ReactNode;
}) {
  const span = max - min;
  const fill = span > 0 ? ((value - min) / span) * 100 : 0;
  return (
    <div className="flex flex-col gap-2.5">
      <FieldLabel
        label={label}
        htmlFor={id}
        value={<ValueChip>{format ? format(value) : value}</ValueChip>}
      />
      <input
        id={id}
        type="range"
        className="ds-slider"
        aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
        style={{ "--ds-slider-fill": `${fill}%` } as CSSProperties}
      />
      {below}
    </div>
  );
}
