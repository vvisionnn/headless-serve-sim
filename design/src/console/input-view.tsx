import { motion } from "motion/react";
import { inputEvents } from "../lib/mock";
import { spring } from "../lib/motion";

export function InputView() {
  const items = [...inputEvents].reverse();
  if (items.length === 0) {
    return <div className="flex h-full items-center justify-center text-footnote text-label-3">No input yet. Tap the simulator to see events here.</div>;
  }
  return (
    <div className="thin-scrollbar scroll-fade h-full overflow-y-auto px-1.5 py-2">
      {items.map((e, i) => (
        <motion.div
          key={e.time}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring.ui, delay: i * 0.035 }}
          className="grid min-h-7 grid-cols-[104px_1fr] items-center gap-2 rounded-[7px] px-1.5 transition-colors hover:bg-fill-3"
        >
          <span className="font-mono text-caption text-label-3 tabular">{e.time}</span>
          <span className="font-mono text-[11.5px]/4 text-label">{e.message}</span>
        </motion.div>
      ))}
    </div>
  );
}
