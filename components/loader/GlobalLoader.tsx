'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { startLoaderSimulation, finishLoaderSimulation } from '@/utils/loader';
import { LoaderOverlay } from './LoaderOverlay';

export function GlobalLoader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Whenever the URL changes (pathname or search params), we finish the loader.
  // The server component has successfully rendered the new page.
  useEffect(() => {
    finishLoaderSimulation();
  }, [pathname, searchParams]);

  // Intercept all internal anchor clicks to start the loader
  useEffect(() => {
    const handleAnchorClick = (e: MouseEvent) => {
      // Find the closest anchor element to the click target
      const target = (e.target as HTMLElement).closest('a');
      
      if (!target) return;
      
      const href = target.getAttribute('href');
      
      // Ignore if no href, or if it's an external link, or a new tab
      if (!href || href.startsWith('http') || target.target === '_blank') return;
      
      // Ignore anchor links on the same page
      if (href.startsWith('#')) return;

      // Ignore if user is holding modifier keys (they open in new tab)
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

      // Start the loading simulation
      startLoaderSimulation();
    };

    // Attach click listener globally
    document.addEventListener('click', handleAnchorClick);

    return () => {
      document.removeEventListener('click', handleAnchorClick);
    };
  }, []);

  return null;
}
