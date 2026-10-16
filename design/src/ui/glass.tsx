import { motion, type HTMLMotionProps } from "motion/react";
import { forwardRef } from "react";
import { cn } from "../lib/cn";

/** A Liquid Glass capsule that groups related toolbar controls. */
export const GlassGroup = forwardRef<HTMLDivElement, HTMLMotionProps<"div">>(function GlassGroup(
  { className, ...rest },
  ref,
) {
  return <motion.div ref={ref} className={cn("glass-sm flex items-center gap-0.5 rounded-full p-1", className)} {...rest} />;
});
