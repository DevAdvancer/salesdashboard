'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { usePageLoader } from '@/hooks/usePageLoader';

export function LoaderOverlay() {
  const { progress, isVisible } = usePageLoader();
  const shouldShow = isVisible;

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          // A thin bar pinned to the top of the viewport. It deliberately never
          // covers the page: a full-screen scrim on every route change made users
          // reload the app, and each reload costs a fresh burst of Appwrite reads.
          className="fixed inset-x-0 top-0 z-[9999] h-0.5 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.3 } }}
        >
          {/* Animated Progress Fill */}
          <motion.div
            className="h-full bg-foreground"
            initial={{ width: '0%' }}
            animate={{ width: `${progress}%` }}
            transition={{ ease: 'easeOut', duration: 0.3 }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
