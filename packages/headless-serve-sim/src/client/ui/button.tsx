import { motion, type HTMLMotionProps } from "motion/react";
import { forwardRef, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";

type Variant = "primary" | "secondary" | "plain" | "destructive" | "record";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-ink text-on-ink shadow-[0_1px_2px_rgba(0,0,0,0.12),inset_0_0.5px_0_rgba(255,255,255,0.18)] hover:bg-ink/88",
  secondary:
    "bg-control text-label shadow-[0_0_0_0.5px_var(--separator),0_1px_2px_rgba(0,0,0,0.06)] hover:bg-fill-3 dark:shadow-[inset_0_0.5px_0_rgba(255,255,255,0.08)] dark:hover:bg-fill-2",
  plain: "text-label hover:bg-fill-3",
  destructive:
    "bg-control text-red shadow-[0_0_0_0.5px_var(--separator),0_1px_2px_rgba(0,0,0,0.06)] hover:bg-red/8",
  record:
    "bg-red text-white shadow-[0_1px_2px_rgba(0,0,0,0.12),inset_0_0.5px_0_rgba(255,255,255,0.25)] hover:bg-red/90",
};

const sizes: Record<Size, string> = {
  sm: "h-6 px-2.5 text-footnote gap-1 font-medium",
  md: "h-7 px-3 text-body gap-1.5 font-medium",
  lg: "h-8 px-3.5 text-body gap-1.5 font-semibold",
};

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  children?: ReactNode;
  block?: boolean;
}

/** Capsule push button. Feedback lives on the press, instantly. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, children, block, className, disabled, ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type="button"
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={spring.snappy}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-full transition-colors duration-150 disabled:opacity-40 [&_svg]:size-[15px] [&_svg]:shrink-0",
        variants[variant],
        sizes[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </motion.button>
  );
});

export interface IconButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  label: string;
  children: ReactNode;
  active?: boolean;
  size?: "sm" | "md" | "lg";
}

const iconSizes = {
  sm: "size-6 [&_svg]:size-[14px]",
  md: "size-7 [&_svg]:size-[16px]",
  lg: "size-8 [&_svg]:size-[17px]",
};

/** Borderless icon button that lives inside glass groups and rows. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, active, size = "lg", className, disabled, ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.9 }}
      transition={spring.snappy}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full text-label transition-colors duration-150 hover:bg-fill-2 disabled:opacity-35 [&_svg]:shrink-0 [&_svg]:stroke-[1.75]",
        iconSizes[size],
        active && "bg-ink text-on-ink hover:bg-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </motion.button>
  );
});
