import { useEffect } from 'react';
import type { WarmupStatus } from '../hooks/useWarmup';

interface WarmupScreenProps {
  status: WarmupStatus;
  error: string | null;
  onWarmupComplete: () => void;
}

export function WarmupScreen({ status, error, onWarmupComplete }: WarmupScreenProps) {
  useEffect(() => {
    if (status === 'ready') {
      onWarmupComplete();
    }
  }, [status, onWarmupComplete]);

  return (
    <div className="warmup-screen">
      <h1 className="title">SPECTRE</h1>
      {status === 'loading' && (
        <p className="warmup-status">Loading pose engine...</p>
      )}
      {status === 'error' && (
        <p className="warmup-error" role="alert">
          {error ?? 'Failed to initialize pose engine. Reload the page.'}
        </p>
      )}
      {status === 'ready' && (
        <p className="warmup-status">Ready.</p>
      )}
    </div>
  );
}
