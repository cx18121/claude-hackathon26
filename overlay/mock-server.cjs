const { WebSocketServer } = require('ws');

const PORT = 8002;
const TICK_MS = 16;
const ROUND_TIME_S = 90;
const MAX_ROUNDS = 3;

// Rough humanoid layout in normalized world coords (33 MediaPipe-style keypoints).
// Layout hint: 0 nose / 1-10 face / 11-12 shoulders / 13-14 elbows / 15-16 wrists /
// 17-22 hands / 23-24 hips / 25-26 knees / 27-28 ankles / 29-32 feet.
function buildBaseSkeleton() {
  const k = (x, y, z = 0) => ({ x, y, z, visibility: 1 });
  const pts = new Array(33);
  pts[0] = k(0.00, -0.55);
  for (let i = 1; i <= 10; i++) {
    const off = (i - 5) * 0.02;
    pts[i] = k(off, -0.58 + Math.abs(off) * 0.2);
  }
  pts[11] = k(-0.18, -0.30); pts[12] = k(0.18, -0.30);
  pts[13] = k(-0.22, -0.05); pts[14] = k(0.22, -0.05);
  pts[15] = k(-0.24, 0.20); pts[16] = k(0.24, 0.20);
  pts[17] = k(-0.25, 0.24); pts[18] = k(0.25, 0.24);
  pts[19] = k(-0.23, 0.26); pts[20] = k(0.23, 0.26);
  pts[21] = k(-0.22, 0.25); pts[22] = k(0.22, 0.25);
  pts[23] = k(-0.10, 0.10); pts[24] = k(0.10, 0.10);
  pts[25] = k(-0.12, 0.40); pts[26] = k(0.12, 0.40);
  pts[27] = k(-0.13, 0.65); pts[28] = k(0.13, 0.65);
  pts[29] = k(-0.14, 0.68); pts[30] = k(0.14, 0.68);
  pts[31] = k(-0.16, 0.70); pts[32] = k(0.16, 0.70);
  return pts;
}

function mirrorX(pose) {
  return pose.map(p => ({ x: -p.x, y: p.y, z: p.z, visibility: p.visibility }));
}

function jitter(pose) {
  return pose.map(p => ({
    x: p.x + (Math.random() - 0.5) * 0.01,
    y: p.y + (Math.random() - 0.5) * 0.01,
    z: p.z,
    visibility: p.visibility,
  }));
}

const REGIONS = ['head_face', 'torso', 'left_arm', 'right_arm', 'left_leg', 'right_leg'];
const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pickRegion = () => REGIONS[Math.floor(Math.random() * REGIONS.length)];

const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });

wss.on('connection', (ws, req) => {
  console.log(`mock: spectator connected path=${req.url}`);

  const baseP1 = buildBaseSkeleton();
  const baseP2 = mirrorX(baseP1);

  let tick = 0;
  let round = 1;
  let hp = [100, 100];
  let roundOver = false;
  let stopped = false;
  const timeouts = new Set();

  const send = (msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const schedule = (fn, ms) => {
    const t = setTimeout(() => { timeouts.delete(t); fn(); }, ms);
    timeouts.add(t);
  };

  send({ type: 'round_start', round_number: round });

  const interval = setInterval(() => {
    if (stopped || roundOver) return;

    const recent_hits = [];

    // Scripted damage: P1 hits P2 every ~70 ticks; P2 hits P1 offset by 35.
    if (tick > 0 && tick % 70 === 0) {
      const dmg = randInt(8, 14);
      hp[1] = Math.max(0, hp[1] - dmg);
      recent_hits.push({
        player: 2, region: pickRegion(), damage: dmg,
        position: { x: 0.15, y: -0.25, z: 0 },
      });
    }
    if (tick > 35 && (tick - 35) % 70 === 0) {
      const dmg = randInt(8, 14);
      hp[0] = Math.max(0, hp[0] - dmg);
      recent_hits.push({
        player: 1, region: pickRegion(), damage: dmg,
        position: { x: -0.15, y: -0.25, z: 0 },
      });
    }

    // Extra flavor hit roughly every 90 ticks if nothing happened that frame.
    if (tick > 0 && tick % 90 === 0 && recent_hits.length === 0) {
      const target = Math.random() < 0.5 ? 1 : 2;
      recent_hits.push({
        player: target, region: pickRegion(), damage: randInt(8, 16),
        position: {
          x: (Math.random() - 0.5) * 0.3,
          y: -0.25 + (Math.random() - 0.5) * 0.2,
          z: 0,
        },
      });
    }

    // One scripted transient disconnect at tick 450.
    if (tick === 450) {
      send({ type: 'player_disconnected', player: 2 });
    }

    send({
      type: 'game_state',
      tick,
      hp: [hp[0], hp[1]],
      poses: [jitter(baseP1), jitter(baseP2)],
      recent_hits,
      high_latency: tick >= 200 && tick <= 260,
      remaining_time: Math.max(0, ROUND_TIME_S - tick / 60),
    });

    tick++;

    if (hp[0] <= 0 || hp[1] <= 0) {
      roundOver = true;
      const winner = hp[0] > 0 ? 1 : 2;
      send({ type: 'round_end', winner, final_hp: [hp[0], hp[1]] });
      if (round >= MAX_ROUNDS) {
        send({ type: 'match_end', winner });
        stopped = true;
        clearInterval(interval);
        return;
      }
      schedule(() => {
        round++;
        hp = [100, 100];
        roundOver = false;
        send({ type: 'round_start', round_number: round });
      }, 2000);
    }
  }, TICK_MS);

  ws.on('close', () => {
    stopped = true;
    clearInterval(interval);
    for (const t of timeouts) clearTimeout(t);
    timeouts.clear();
    console.log('mock: spectator disconnected');
  });

  ws.on('error', (err) => console.log('mock: ws error', err.message));
});

console.log(`Mock spectator server on ws://localhost:${PORT}`);
