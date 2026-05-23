import type { PoseKeypoint } from '@shared/protocol';
import type { LabeledSample } from '@shared/client/useCalibration';
import { useCalibration } from '@shared/client/useCalibration';

interface CalibrationScreenProps {
  keypoints: PoseKeypoint[] | null;
  onCalibrationDone: (referenceVelocity: number, calibrationSamples?: LabeledSample[]) => void;
}

const LABELED_PUNCH_STAGES = new Set([
  'punch_jab', 'punch_cross', 'punch_hook_l', 'punch_hook_r',
]);

const PUNCH_LABEL: Record<string, string> = {
  punch_jab:    'JAB',
  punch_cross:  'CROSS',
  punch_hook_l: 'LEFT HOOK',
  punch_hook_r: 'RIGHT HOOK',
};

export function CalibrationScreen({
  keypoints,
  onCalibrationDone,
}: CalibrationScreenProps) {
  const cal = useCalibration({
    keypoints,
    active: true,
    labeledPunchMode: true,
    onComplete: onCalibrationDone,
  });

  const isLabeledPunch = LABELED_PUNCH_STAGES.has(cal.stage);

  return (
    <div className="calibration-screen">
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

        {isLabeledPunch && (
          <div className="punches-panel">
            <span className="punch-type-label">{PUNCH_LABEL[cal.stage]}</span>
            <span className="punch-counter">{cal.punchesRecorded}/4</span>
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
