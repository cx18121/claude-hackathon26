import { useEffect, useRef } from 'react';
import type React from 'react';
import type { PoseKeypoint } from '@shared/protocol';
import { useCalibration } from '@shared/client/useCalibration';

interface CalibrationScreenProps {
  stream: MediaStream | null;
  keypoints: PoseKeypoint[] | null;
  onCalibrationDone: (referenceVelocity: number) => void;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

export function CalibrationScreen({
  stream,
  keypoints,
  onCalibrationDone,
  videoRef: externalVideoRef,
}: CalibrationScreenProps) {
  const internalVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoRef = externalVideoRef ?? internalVideoRef;

  // Wire camera stream to video element
  useEffect(() => {
    const video = videoRef.current;
    if (video && stream) {
      video.srcObject = stream;
    }
  }, [stream, videoRef]);

  const cal = useCalibration({
    keypoints,
    active: true,
    onComplete: onCalibrationDone,
  });

  return (
    <div className="calibration-screen">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="calibration-video"
      />
      <div className="calibration-ui">
        <p className="calibration-instruction">{cal.instruction}</p>

        {cal.stage === 'tpose' && (
          <div className="tpose-panel">
            <p className="visibility-hint">
              Step back so your full upper body is visible in the camera.
            </p>
            <div className="progress-bar-track">
              <div
                className="progress-bar-fill"
                style={{ width: `${Math.round(cal.tposeProgress * 100)}%` }}
              />
            </div>
            <span className="progress-label">{Math.round(cal.tposeProgress * 100)}%</span>
          </div>
        )}

        {cal.stage === 'punches' && (
          <div className="punches-panel">
            <span className="punch-counter">{cal.punchesRecorded}/3</span>
          </div>
        )}

        {cal.stage === 'neutral' && (
          <div className="neutral-panel">
            <div className="progress-bar-track">
              <div
                className="progress-bar-fill"
                style={{ width: `${Math.round(cal.neutralProgress * 100)}%` }}
              />
            </div>
          </div>
        )}

        {cal.stage === 'done' && (
          <p className="calibration-done">Calibrated! Get ready to fight.</p>
        )}
      </div>
    </div>
  );
}
