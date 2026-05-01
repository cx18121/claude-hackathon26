import { useEffect, useRef } from 'react';
import type { PoseKeypoint } from '@shared/protocol';

interface PoseOverlayProps {
  keypoints: PoseKeypoint[] | null;
}

const CONNECTIONS: [number, number][] = [
  [11, 13], [13, 15], // left arm
  [12, 14], [14, 16], // right arm
  [11, 12],           // shoulders
  [11, 23], [12, 24], // torso sides
  [23, 24],           // hips
  [23, 25], [25, 27], // left leg
  [24, 26], [26, 28], // right leg
  [7, 0], [8, 0],     // ears to nose
];

export function PoseOverlay({ keypoints }: PoseOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    ctx.clearRect(0, 0, w, h);
    if (!keypoints || keypoints.length === 0) return;

    ctx.lineCap = 'round';
    ctx.lineWidth = 2;

    for (const [a, b] of CONNECTIONS) {
      const ka = keypoints[a];
      const kb = keypoints[b];
      if (!ka || !kb) continue;
      const vis = Math.min(ka.visibility, kb.visibility);
      if (vis < 0.3) continue;
      ctx.strokeStyle = `rgba(0,255,140,${(vis * 0.85).toFixed(2)})`;
      ctx.beginPath();
      ctx.moveTo(ka.x * w, ka.y * h);
      ctx.lineTo(kb.x * w, kb.y * h);
      ctx.stroke();
    }

    for (let i = 0; i < keypoints.length; i++) {
      const kp = keypoints[i];
      if (!kp || kp.visibility < 0.35) continue;
      ctx.fillStyle = `rgba(120,255,200,${(kp.visibility * 0.9).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(kp.x * w, kp.y * h, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [keypoints]);

  return <canvas ref={canvasRef} className="pose-overlay" />;
}
