'use client';

import { useEffect, useState } from 'react';
import { usePageLoader } from '@/lib/hooks/usePageLoader';

const FADE_MS = 300;

// CSS transitions instead of framer-motion: this bar mounts on every page, and
// the animation library was the only reason it shipped in every page's bundle.
export function LoaderOverlay() {
  const { progress, isVisible } = usePageLoader();
  const [mounted, setMounted] = useState(isVisible);
  const [shown, setShown] = useState(false);
  // reset() zeroes progress as it hides the bar; keep the last width while it fades.
  const [width, setWidth] = useState(progress);
  useEffect(() => { if (isVisible) setWidth(progress); }, [isVisible, progress]);

  useEffect(() => {
    if (isVisible) {
      setMounted(true);
      // Two frames so the 0% / transparent state paints before animating in.
      let second = 0;
      const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setShown(true)); });
      return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), FADE_MS);
    return () => clearTimeout(timer);
  }, [isVisible]);

  if (!mounted) return null;

  return (
    <div
      // A thin bar pinned to the top of the viewport. It deliberately never
      // covers the page: a full-screen scrim on every route change made users
      // reload the app, and each reload costs a fresh burst of Appwrite reads.
      className="fixed inset-x-0 top-0 z-[9999] h-0.5 pointer-events-none transition-opacity duration-300"
      style={{ opacity: shown ? 1 : 0 }}
    >
      {/* Animated Progress Fill */}
      <div
        className="h-full bg-foreground transition-[width] duration-300 ease-out"
        style={{ width: shown ? `${width}%` : '0%' }}
      />
    </div>
  );
}
