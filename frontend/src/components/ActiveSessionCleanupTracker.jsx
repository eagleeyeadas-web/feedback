import { useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { triggerActivityCleanup } from '../lib/api';

/**
 * ActiveSessionCleanupTracker
 * 
 * Automatically tracks genuine user active usage across all authenticated workspaces.
 * Rules enforced:
 * 1. Starts tracking when an authenticated user session is active.
 * 2. Requires at least 2 minutes (120s) of accumulated genuine active interaction.
 * 3. Inactivity threshold (30s): Pauses timer if user is idle or tab is hidden.
 * 4. Cancels cleanly when user logs out or closes the app.
 * 5. After 2 minutes of genuine active usage, requests backend to evaluate 24h cleanup.
 * 6. Never blocks user workflows or renders any visible DOM.
 */
export default function ActiveSessionCleanupTracker() {
  const { session, token } = useAuth();

  const activeSecondsRef = useRef(0);
  const lastActivityTimeRef = useRef(Date.now());
  const hasTriggeredRef = useRef(false);

  useEffect(() => {
    // If not authenticated, do nothing and reset state
    if (!session || !token) {
      activeSecondsRef.current = 0;
      hasTriggeredRef.current = false;
      return;
    }

    // Inactivity threshold: 30 seconds of no interaction means the user is idle
    const INACTIVITY_THRESHOLD_MS = 30 * 1000;
    // Target active time: 2 minutes (120 seconds)
    const TARGET_ACTIVE_SECONDS = 120;

    lastActivityTimeRef.current = Date.now();

    // Throttled activity listener
    let lastThrottledTime = 0;
    const handleUserInteraction = () => {
      const now = Date.now();
      if (now - lastThrottledTime > 1000) {
        lastThrottledTime = now;
        lastActivityTimeRef.current = now;
      }
    };

    const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    ACTIVITY_EVENTS.forEach((event) => {
      window.addEventListener(event, handleUserInteraction, { passive: true });
    });

    // 1-second active usage ticker
    const tickerInterval = setInterval(() => {
      // Rule 11: Do not advance timer if tab is hidden in background
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }

      // Check if user is currently active (within 30s inactivity threshold)
      const now = Date.now();
      const idleDuration = now - lastActivityTimeRef.current;

      if (idleDuration <= INACTIVITY_THRESHOLD_MS) {
        activeSecondsRef.current += 1;

        // Rule 2 & 3: Check if genuine 2-minute active duration reached
        if (activeSecondsRef.current >= TARGET_ACTIVE_SECONDS && !hasTriggeredRef.current) {
          hasTriggeredRef.current = true;
          
          triggerActivityCleanup(token)
            .then((res) => {
              if (res.status === 'completed') {
                console.info('[ActiveSessionCleanup] 24-hour cleanup executed successfully:', res.result?.policy || '20-Day Retention');
              } else if (res.status === 'skipped') {
                console.info('[ActiveSessionCleanup] Cleanup skipped (cooldown active or running):', res.reason || 'Less than 24 hours since last run');
              }
            })
            .catch((err) => {
              console.warn('[ActiveSessionCleanup] Cleanup check request error:', err.message);
              // Allow retry after another 2 minutes of active usage on network/server error
              hasTriggeredRef.current = false;
              activeSecondsRef.current = 0;
            });
        }
      }
    }, 1000);

    // Rule 10: If user logs out or window unmounts, cancel pending trigger
    return () => {
      clearInterval(tickerInterval);
      ACTIVITY_EVENTS.forEach((event) => {
        window.removeEventListener(event, handleUserInteraction);
      });
    };
  }, [session, token]);

  return null;
}
