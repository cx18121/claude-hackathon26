import type { CalibrationStage } from '../hooks/useCalibration';

interface CalibrationOverlayProps {
  stage: CalibrationStage;
  punchesRecorded: number;
  tposeProgress: number;
  neutralProgress: number;
  instruction: string;
  playerSlot: 1 | 2;
}

export function CalibrationOverlay({
  stage,
  punchesRecorded,
  tposeProgress,
  neutralProgress,
  instruction,
  playerSlot,
}: CalibrationOverlayProps) {
  if (stage === 'idle') {
    return (
      <div className="calibration-overlay">
        <p className="calibration-instruction">Waiting for server...</p>
      </div>
    );
  }
  if (stage === 'done') {
    return (
      <div className="calibration-overlay calibration-fade">
        <p className="calibration-fight">Fight!</p>
      </div>
    );
  }

  return (
    <div className="calibration-overlay">
      <p className="calibration-instruction">{instruction}</p>

      {stage === 'tpose' ? (
        <>
          <TposeSilhouette progress={tposeProgress} />
          <p className="calibration-tip">
            Stand 2m from camera facing {playerSlot === 1 ? 'RIGHT' : 'LEFT'}, full body visible.
          </p>
        </>
      ) : null}

      {stage === 'punches' ? (
        <div className="punch-icons">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`punch-icon${i < punchesRecorded ? ' filled' : ''}`}
            >
              <svg viewBox="0 0 24 24" width="40" height="40">
                <path
                  fill="currentColor"
                  d="M9 4h6l1 4h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-3l-1 4H10l-1-4H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h1z"
                />
              </svg>
            </div>
          ))}
        </div>
      ) : null}

      {stage === 'neutral' ? (
        <div className="neutral-ring-wrap">
          <ProgressRing progress={neutralProgress} />
        </div>
      ) : null}
    </div>
  );
}

function ProgressRing({ progress }: { progress: number }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(1, Math.max(0, progress)));
  return (
    <svg width="100" height="100" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={r} fill="none" stroke="#333" strokeWidth="6" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke="#3ecf6e"
        strokeWidth="6"
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 50 50)"
      />
    </svg>
  );
}

function TposeSilhouette({ progress }: { progress: number }) {
  return (
    <div className="tpose-wrap">
      <svg
        viewBox="0 0 200 260"
        width="180"
        height="234"
        className="tpose-svg"
        aria-hidden
      >
        <circle cx="100" cy="40" r="22" />
        <line x1="100" y1="62" x2="100" y2="160" />
        <line x1="20" y1="90" x2="180" y2="90" />
        <line x1="100" y1="160" x2="70" y2="240" />
        <line x1="100" y1="160" x2="130" y2="240" />
      </svg>
      <div className="tpose-progress-track">
        <div
          className="tpose-progress-fill"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
    </div>
  );
}
