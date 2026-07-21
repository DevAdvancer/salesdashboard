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
          className="absolute inset-0 z-[9999]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.3 } }}
        >
          {/* Use sticky so that if the parent container is very tall, the loader stays in the viewport */}
          <div className="sticky top-0 left-0 w-full h-[100dvh] flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm pointer-events-auto">
            <div className="flex flex-col items-start w-full max-w-[320px] gap-3 relative -mt-32">
              
              {/* Monochrome Border Container */}
              <div className="w-full h-3 rounded-full border border-foreground/30 p-[1px] bg-background/50 overflow-hidden relative flex items-center">
                {/* Animated Progress Fill */}
                <motion.div
                  className="h-full bg-foreground rounded-full"
                  initial={{ width: '0%' }}
                  animate={{ width: `${progress}%` }}
                  transition={{ ease: 'easeOut', duration: 0.3 }}
                />
              </div>

              {/* Text Loading */}
              <div className="flex items-center gap-3 font-mono text-foreground tracking-[0.2em]">
                <span className="text-sm">LOADING...</span>
                <span className="font-bold text-lg">{Math.round(progress)}%</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
