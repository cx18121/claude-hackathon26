import { forwardRef } from 'react';

interface CameraViewProps {
  error: string | null;
}

// Renders the live camera feed. Uses muted+playsInline to satisfy iOS
// autoplay rules. No mirror transform: rear-facing phone camera and
// Continuity Camera both look natural without flipping.
export const CameraView = forwardRef<HTMLVideoElement, CameraViewProps>(
  function CameraView({ error }, ref) {
    return (
      <div className="camera-view">
        <video
          ref={ref}
          className="camera-video"
          autoPlay
          playsInline
          muted
        />
        {error ? <div className="camera-error">{error}</div> : null}
      </div>
    );
  },
);
