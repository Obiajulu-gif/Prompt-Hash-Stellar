/**
 * Live region component for screen reader announcements.
 * Announces dynamic status changes without disrupting user flow.
 */

import React, { useEffect, useState } from 'react';

export type LiveRegionPriority = 'polite' | 'assertive';

export interface LiveRegionProps {
  message: string;
  priority?: LiveRegionPriority;
  delay?: number;
  onClear?: () => void;
}

export function LiveRegion({
  message,
  priority = 'polite',
  delay = 2000,
  onClear,
}: LiveRegionProps) {
  const [visible, setVisible] = useState(!!message);

  useEffect(() => {
    if (!message) {
      setVisible(false);
      return;
    }

    setVisible(true);

    const timer = setTimeout(() => {
      setVisible(false);
      onClear?.();
    }, delay);

    return () => clearTimeout(timer);
  }, [message, delay, onClear]);

  if (!visible) return null;

  return (
    <div
      // role=status is implicitly polite; errors need role=alert so they
      // interrupt and are reliably announced.
      role={priority === 'assertive' ? 'alert' : 'status'}
      aria-live={priority}
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>
  );
}

/**
 * Hook to use live region announcements
 */
export function useLiveRegion() {
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<LiveRegionPriority>('polite');

  const announce = (text: string, nextPriority: LiveRegionPriority = 'polite') => {
    setPriority(nextPriority);
    setMessage(text);
  };

  const clear = () => {
    setMessage('');
  };

  return { message, priority, announce, clear };
}

export default LiveRegion;
