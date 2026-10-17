import { Select as S } from "@base-ui/react/select";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "../lib/cn";

export interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/**
 * Pop-up button (Base UI Select). Like macOS, the menu opens with the current
 * item sitting exactly over the trigger, so the eye never has to search.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Option<T>[];
  label: string;
  className?: string;
}) {
  return (
    <S.Root value={value} onValueChange={(v) => v != null && onChange(v as T)} items={options}>
      <S.Trigger
        aria-label={label}
        className={cn(
          "group inline-flex h-7 min-w-[132px] max-w-full items-center justify-between gap-2 rounded-[8px] bg-control pr-1.5 pl-2.5 text-body font-medium text-label shadow-[0_0_0_0.5px_var(--separator),0_1px_2px_rgba(0,0,0,0.06)] outline-none transition-colors hover:bg-fill-3 focus-visible:outline-2 focus-visible:outline-[var(--focus)] data-[popup-open]:bg-fill-3 dark:shadow-[inset_0_0.5px_0_rgba(255,255,255,0.08)]",
          className,
        )}
      >
        <S.Value className="truncate" />
        <S.Icon className="flex text-label-3">
          <ChevronsUpDown className="size-[13px]" strokeWidth={2} />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Positioner sideOffset={6} className="z-[80] outline-none">
          <S.Popup className="glass-pop menu-pop min-w-[var(--anchor-width)] origin-[var(--transform-origin)] rounded-[12px] p-[5px] outline-none">
            <S.List>
              {options.map((o) => (
                <S.Item
                  key={o.value}
                  value={o.value}
                  className="group grid min-h-7 cursor-default grid-cols-[16px_1fr] items-center gap-1.5 rounded-[7px] py-1 pr-3 pl-1.5 text-body text-label outline-none select-none data-[highlighted]:bg-ink data-[highlighted]:text-on-ink"
                >
                  <S.ItemIndicator className="col-start-1 flex">
                    <Check className="size-[13px]" strokeWidth={2.5} />
                  </S.ItemIndicator>
                  <span className="col-start-2 flex flex-col">
                    <S.ItemText>{o.label}</S.ItemText>
                    {o.hint && (
                      <span className="text-caption text-label-3 group-data-[highlighted]:text-on-ink/70">
                        {o.hint}
                      </span>
                    )}
                  </span>
                </S.Item>
              ))}
            </S.List>
          </S.Popup>
        </S.Positioner>
      </S.Portal>
    </S.Root>
  );
}
