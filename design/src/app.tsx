import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "motion/react";
import { Harness } from "./harness";
import { useApp } from "./lib/store";
import { PhoneScene } from "./scenes/phone-scene";
import { Workspace } from "./shell/workspace";
import { TipProvider } from "./ui/tooltip";

export function App() {
  const { scene } = useApp();
  return (
    <MotionConfig reducedMotion="user">
      <TipProvider delay={450}>
        <LayoutGroup>
          <AnimatePresence mode="wait" initial={false}>
            {scene === "phone" ? (
              <motion.div key="phone" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                <PhoneScene />
              </motion.div>
            ) : (
              <motion.div key="ws" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                <Workspace />
              </motion.div>
            )}
          </AnimatePresence>
        </LayoutGroup>
        <Harness />
      </TipProvider>
    </MotionConfig>
  );
}
