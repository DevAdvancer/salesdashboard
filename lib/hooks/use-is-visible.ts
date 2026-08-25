import { useState, useEffect } from 'react';

export function useIsVisible() {
  const [isVisible, setIsVisible] = useState(() => {
    if (typeof document !== 'undefined') {
      return document.visibilityState === 'visible';
    }
    return true;
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return isVisible;
}
