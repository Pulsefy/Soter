// app/hooks/useSessionExpiry.ts
import { useEffect, useState, useCallback, useRef } from 'react';

interface SessionOptions {
  timeoutMs: number;
  warningThresholdMs: number;
  onRefresh: () => Promise<boolean>;
  onExpire: () => void;
}

const BROADCAST_CHANNEL_NAME = 'soter_session_sync';

export function useSessionExpiry({ timeoutMs, warningThresholdMs, onRefresh, onExpire }: SessionOptions) {
  const [isWarningVisible, setIsWarningVisible] = useState(false);
  const [remainingTime, setRemainingTime] = useState(timeoutMs);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const isRefreshingRef = useRef(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.BroadcastChannel) {
      channelRef.current = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      channelRef.current.onmessage = (event) => {
        if (event.data === 'REFRESHED' || event.data === 'EXTENDED') {
          setIsWarningVisible(false);
          setRemainingTime(timeoutMs);
        } else if (event.data === 'EXPIRED') {
          onExpire();
        }
      };
    }

    return () => {
      channelRef.current?.close();
    };
  }, [timeoutMs, onExpire]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;

    try {
      const success = await onRefresh();
      if (success) {
        setIsWarningVisible(false);
        setRemainingTime(timeoutMs);
        channelRef.current?.postMessage('REFRESHED');
      } else {
        onExpire();
        channelRef.current?.postMessage('EXPIRED');
      }
    } finally {
      isRefreshingRef.current = false;
    }
  }, [onRefresh, onExpire, timeoutMs]);

  useEffect(() => {
    const interval = 1000;
    const timer = setInterval(() => {
      setRemainingTime((prev) => {
        const next = prev - interval;
        if (next <= warningThresholdMs && next > 0 && !isWarningVisible) {
          setIsWarningVisible(true);
        }
        if (next <= 0) {
          clearInterval(timer);
          onExpire();
          return 0;
        }
        return next;
      });
    }, interval);

    const handleUserActivity = () => {
      if (remainingTime > warningThresholdMs && remainingTime < timeoutMs - 60000) {
        // Silent refresh check on active engagement if within threshold window
        handleRefresh();
      }
    };

    window.addEventListener('mousemove', handleUserActivity, { passive: true });
    window.addEventListener('keydown', handleUserActivity, { passive: true });

    return () => {
      clearInterval(timer);
      window.removeEventListener('mousemove', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
    };
  }, [remainingTime, warningThresholdMs, timeoutMs, isWarningVisible, handleRefresh, onExpire]);

  return {
    isWarningVisible,
    remainingSeconds: Math.ceil(remainingTime / 1000),
    extendSession: handleRefresh,
  };
}