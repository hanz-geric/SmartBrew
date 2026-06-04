import { useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

/**
 * Calls `onTimeout` after `timeoutMs` of inactivity.
 * Also triggers if the app was backgrounded for longer than `timeoutMs`.
 *
 * Returns `resetTimer` — call it on any user interaction to restart the clock.
 */
export function useIdleTimeout(timeoutMs: number, onTimeout: () => void) {
  // Keep onTimeout stable so the timer callback is always up-to-date
  const onTimeoutRef = useRef(onTimeout);
  useEffect(() => { onTimeoutRef.current = onTimeout; }, [onTimeout]);

  const timerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bgTimestamp   = useRef<number | null>(null);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onTimeoutRef.current(), timeoutMs);
  }, [timeoutMs]);

  useEffect(() => {
    resetTimer();

    function handleAppState(nextState: AppStateStatus) {
      if (nextState === 'background' || nextState === 'inactive') {
        // Record when we left; cancel the in-app idle timer
        bgTimestamp.current = Date.now();
        if (timerRef.current) clearTimeout(timerRef.current);
      } else if (nextState === 'active') {
        const away = bgTimestamp.current ? Date.now() - bgTimestamp.current : 0;
        bgTimestamp.current = null;
        if (away >= timeoutMs) {
          onTimeoutRef.current();
        } else {
          resetTimer();
        }
      }
    }

    const sub = AppState.addEventListener('change', handleAppState);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      sub.remove();
    };
  }, [resetTimer, timeoutMs]);

  return resetTimer;
}
