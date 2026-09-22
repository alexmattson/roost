import { useEffect, useState } from 'react';

/** Subscribe to a CSS media query, re-rendering when it flips. SSR/test-safe. */
export function useMediaQuery(query) {
  const read = () => (typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(read);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);

  return matches;
}

/** True on phone-width viewports — the threshold the responsive CSS layer uses. */
export const useIsMobile = () => useMediaQuery('(max-width: 600px)');
