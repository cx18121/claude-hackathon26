import { useEffect, useRef, useState, type RefObject } from 'react';

export interface UseCameraResult {
  stream: MediaStream | null;
  error: string | null;
  ready: boolean;
}

// Opens the device camera and pipes the stream into the supplied <video> ref.
// Prefers the rear camera for phones; desktop browsers fall back to whatever
// camera is available (FaceTime, Continuity Camera, etc.).
export function useCamera(videoRef: RefObject<HTMLVideoElement | null>): UseCameraResult {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    // Snapshot the ref so the cleanup function uses the same node we attached
    // to, even if the parent re-renders and swaps the video element.
    const videoEl = videoRef.current;
    let activeStream: MediaStream | null = null;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera API not available in this browser.');
        return;
      }

      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            // Front-facing camera so the player sees themselves while
            // playing -- natural for a solo capture app. Note: MediaPipe
            // landmark indices (left_wrist = 15, etc.) follow the
            // SUBJECT's perspective, not the camera's, so the keypoint
            // stream sent to the server stays correct without any flip.
            facingMode: { ideal: 'user' },
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        });

        if (cancelledRef.current) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }

        activeStream = s;
        setStream(s);

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = s;

        const onLoaded = () => {
          if (!cancelledRef.current) setReady(true);
        };
        if (video.readyState >= 1) {
          onLoaded();
        } else {
          video.addEventListener('loadedmetadata', onLoaded, { once: true });
        }

        // iOS Safari requires an explicit play() after srcObject assignment.
        try {
          await video.play();
        } catch {
          /* play() may reject silently if already playing */
        }
      } catch (err) {
        const e = err as DOMException;
        if (e.name === 'NotAllowedError') {
          setError('Camera permission denied. Allow camera access and reload.');
        } else if (e.name === 'NotFoundError') {
          setError('No camera found on this device.');
        } else {
          setError(`Could not open camera: ${e.message ?? String(e)}`);
        }
      }
    }

    void start();

    return () => {
      cancelledRef.current = true;
      if (activeStream) {
        activeStream.getTracks().forEach((t) => t.stop());
      }
      if (videoEl) {
        videoEl.srcObject = null;
      }
      setReady(false);
      setStream(null);
    };
  }, [videoRef]);

  return { stream, error, ready };
}
