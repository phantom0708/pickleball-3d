'use strict';
/* Sinh fixture tất định cho vật lý bóng (cản + Magnus + nảy theo xoáy).
 * node server/test/gen-physics-fixture.js --write  → ghi fixtures/physics-fixture.json
 * Trình duyệt có thể nạp cùng file JSON, chạy lại từng launch bằng PP.BallSim và so sánh === từng số.
 */
const fs = require('fs');
const path = require('path');
const { C } = require('../../shared/config.js');
const { Physics, BallSim } = require('../../shared/physics.js');

const FILE = path.join(__dirname, 'fixtures', 'physics-fixture.json');
const N = 200, SIM_T = 3.0, SEED = 20261110;

function generate() {
  const rng = Physics.mulberry32(SEED);
  const r = (a, b) => a + rng() * (b - a);
  const cases = [];
  for (let i = 0; i < N; i++) {
    const side = rng() < 0.5 ? 1 : -1;
    const launch = {
      from: { x: r(-3, 3), y: r(0.12, 2.3), z: side * r(0.5, 7.2) },
      v: { x: r(-4, 4), y: r(-6, 11), z: -side * r(2, 24) },
      spin: r(-90, 90), t0: 0,
      wind: rng() < 0.4 ? { x: 0, z: 0 } : { x: r(-0.9, 0.9), z: r(-0.36, 0.36) },
    };
    const events = [];
    const s = new BallSim(launch).advanceTo(SIM_T, events);
    cases.push({ launch, steps: s.n, bounces: s.bounces, netAt: s.netAt,
      b: { x: s.b.x, y: s.b.y, z: s.b.z, vx: s.b.vx, vy: s.b.vy, vz: s.b.vz, spin: s.b.spin },
      events: events.map((e) => ({ type: e.type, t: e.t, x: e.x, z: e.z })) });
  }
  return { seed: SEED, simT: SIM_T, simDt: C.SIM_DT, dragK: C.DRAG_K, magnusK: C.MAGNUS_K, cases };
}

if (require.main === module && process.argv.includes('--write')) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(generate()));
  console.log('đã ghi', FILE);
}
module.exports = { generate, FILE };
