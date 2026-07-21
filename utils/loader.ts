import { usePageLoader } from '@/hooks/usePageLoader';

let loadingInterval: NodeJS.Timeout | null = null;
let finishTimeout: NodeJS.Timeout | null = null;

/**
 * Simulates a realistic page loading progress.
 * Fast to 30%, steady to 70%, slow to 90%, very slow to 99%.
 */
export function startLoaderSimulation(options?: { overlay?: boolean }) {
  const store = usePageLoader.getState();
  
  // Clear any existing intervals
  stopLoaderSimulation();
  
  store.start(options);
  
  loadingInterval = setInterval(() => {
    const current = usePageLoader.getState().progress;
    let increment = 0;

    if (current < 30) {
      increment = Math.random() * 15; // Fast initial burst
    } else if (current < 70) {
      increment = Math.random() * 10; // Steady mid-phase
    } else if (current < 90) {
      increment = Math.random() * 5; // Slowing down
    } else if (current < 99) {
      increment = Math.random() * 1; // Trickle, never hits 100 on its own
    }

    if (current + increment < 99) {
      store.setProgress(current + increment);
    } else {
      store.setProgress(99);
    }
  }, 300); // Update every 300ms
}

/**
 * Pushes the loader to 100%, waits briefly for visual completion, then resets.
 */
export function finishLoaderSimulation() {
  const store = usePageLoader.getState();
  
  stopLoaderSimulation();
  
  if (!store.isVisible) return; // Prevent finishing if not started
  
  store.finish(); // Jump to 100%

  // Wait for the CSS transition to hit 100% before hiding (approx 400ms)
  finishTimeout = setTimeout(() => {
    store.reset();
  }, 400); 
}

/**
 * Clears timers without altering state.
 */
function stopLoaderSimulation() {
  if (loadingInterval) {
    clearInterval(loadingInterval);
    loadingInterval = null;
  }
  if (finishTimeout) {
    clearTimeout(finishTimeout);
    finishTimeout = null;
  }
}
