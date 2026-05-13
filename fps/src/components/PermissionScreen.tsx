import { useState } from 'react';

interface PermissionScreenProps {
  onPermissionGranted: (stream: MediaStream) => void;
}

type RequestState = 'idle' | 'requesting' | 'error';

export function PermissionScreen({ onPermissionGranted }: PermissionScreenProps) {
  const [requestState, setRequestState] = useState<RequestState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleAllow() {
    setRequestState('requesting');
    setErrorMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'user' },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 60 },
        },
        audio: false,
      });
      onPermissionGranted(stream);
    } catch (err) {
      const e = err as DOMException;
      if (e.name === 'NotAllowedError') {
        setErrorMessage('Camera permission denied. Allow access in your browser settings and reload.');
      } else if (e.name === 'NotFoundError') {
        setErrorMessage('No camera detected. Connect a webcam and reload.');
      } else {
        setErrorMessage(`Could not open camera: ${e.message}`);
      }
      setRequestState('error');
    }
  }

  return (
    <div className="permission-screen">
      <h1 className="title">SPECTRE</h1>
      <p className="permission-body">
        SPECTRE needs your camera to track your movements. No video is transmitted.
      </p>
      <button
        className="permission-btn"
        onClick={handleAllow}
        disabled={requestState === 'requesting'}
      >
        {requestState === 'requesting' ? 'Requesting...' : 'Allow camera access'}
      </button>
      {errorMessage && (
        <p className="permission-error" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
