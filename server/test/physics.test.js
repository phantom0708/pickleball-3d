'use strict';
/* v2: vật lý (cản + xoáy), hình dạng cú đánh, predictContact, strokeZone, bot intent, protocol v2 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { C, SHOTS, SERVE_VMAX, VENUES } = require('../../shared/config.js');
const { Physics, BallSim } = require('../../shared/physics.js');
const { Match } = require('../../shared/match.js');
const { BotBrain } = require('../../shared/ai.js');
const { Protocol } = require('../../shared/protocol.js');
const { generate, FILE } = require('./gen-physics-fixture.js');

const NOWIND = { x: 0, z: 0 };

/** Đo hình dạng một cú: tốc độ rời vợt, đỉnh, khoảng hở qua lưới (đáy bóng − mép lưới), điểm nảy đầu */
function measure(from, v, spin) {
  const s = new BallSim({ from, v, spin, t0: 0, wind: NOWIND });
  let apex = from.y, clr = null, land = null, pz = from.z;
  while (s.n < 2400 && !land) {
    const ev = [];
    s.advanceTo((s.n + 1) * C.SIM_DT, ev);
    if (s.b.y > apex) apex = s.b.y;
    if (clr === null && (pz > 0) !== (s.b.z > 0)) clr = s.b.y - C.R - Physics.netHeightAt(s.b.x);
    pz = s.b.z;
    for (const e of ev) {
      if (e.type === 'net') return { speed: Physics.speedOf(v), net: true };
      if (e.type === 'bounce') { land = e; break; }
    }
  }
  return { speed: Physics.speedOf(v), apex, clr, land, vy: v.y };
}
const mirror = (p) => ({ x: -p.x, y: p.y, z: -p.z });

test('tất định với cản + xoáy: cùng launch, bước tiến khác nhau → trạng thái giống hệt', () => {
  const rng = Physics.mulberry32(77);
  for (let i = 0; i < 30; i++) {
    const la = { from: { x: rng() * 4 - 2, y: 0.2 + rng() * 2, z: 3 + rng() * 4 }, v: { x: rng() * 6 - 3, y: rng() * 12 - 4, z: -(3 + rng() * 20) },
      spin: rng() * 180 - 90, t0: 0, wind: { x: rng() - 0.5, z: (rng() - 0.5) * 0.4 } };
    const evA = [], evB = [], evC = [];
    const a = new BallSim(la).advanceTo(2.7, evA);
    const b = new BallSim(la);
    for (let t = 0; t <= 2.7; t += 0.013) b.advanceTo(t, evB);
    b.advanceTo(2.7, evB);
    const c = new BallSim(la);
    let t = 0;
    while (t < 2.7) { t = Math.min(2.7, t + rng() * 0.05); c.advanceTo(t, evC); }
    assert.deepEqual(a.b, b.b); assert.deepEqual(a.b, c.b);
    assert.deepEqual(evA, evB); assert.deepEqual(evA, evC);
    assert.equal(a.bounces, c.bounces);
    const st = Physics.stateAt(la, 2.7);
    assert.deepEqual(st.b, a.b);
  }
});

test('fixture 200 launch ngẫu nhiên: Node tự nhất quán (file JSON dùng để so với trình duyệt)', () => {
  const fresh = generate();
  assert.equal(fresh.cases.length, 200);
  assert.ok(fresh.cases.some((c) => c.netAt !== null) && fresh.cases.some((c) => c.bounces >= 2), 'fixture phủ cả lưới lẫn nảy');
  const again = generate();
  assert.deepEqual(again, fresh);
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify(fresh));
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  // JSON giữ nguyên số double → so sánh tuyệt đối
  assert.deepEqual(saved, JSON.parse(JSON.stringify(fresh)));
});

test('cản không khí và xoáy: topspin chúc xuống, backspin nổi, nảy theo xoáy', () => {
  const from = { x: 0, y: 1, z: 6 }, v = { x: 0, y: 3, z: -15 };
  const land = (spin) => Physics.firstBounce({ from, v, spin, t0: 0, wind: NOWIND });
  const top = land(60), flat = land(0), back = land(-60);
  assert.ok(top.z > flat.z && flat.z > back.z, `topspin rơi ngắn hơn, backspin bay xa hơn: ${top.z} ${flat.z} ${back.z}`);
  // cản: tốc độ ngang giảm rõ rệt
  const s = new BallSim({ from, v, spin: 0, t0: 0, wind: NOWIND }).advanceTo(0.5);
  assert.ok(Math.abs(s.b.vz) < 12.5, 'drag làm chậm bóng: ' + s.b.vz);
  // nảy: topspin giữ ~0.85 vận tốc ngang, backspin ~0.65, nảy dọc 0.62–0.68
  for (const [spin, rh] of [[80, 0.85], [-80, 0.65]]) {
    const b = { x: 0, y: C.R - 0.0001, z: 0, vx: 0, vy: -6, vz: -10, spin, wx: 0, wz: 0, netHit: false };
    Physics.stepBall(b, 1e-6, NOWIND, []);
    assert.ok(Math.abs(b.vz / -10 - rh) < 0.01, 'giữ ngang ' + b.vz);
    assert.ok(b.vy / 6 >= 0.62 - 0.002 && b.vy / 6 <= 0.68 + 0.002, 'nảy dọc ' + b.vy);
  }
});

test('solveShot (shooting method) trúng điểm rơi có cản + xoáy, qua lưới, nhanh', () => {
  const rng = Physics.mulberry32(3);
  let worst = 0;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) {
    const from = { x: rng() * 4 - 2, y: 0.2 + rng() * 1.2, z: 2 + rng() * 5 };
    const to = { x: rng() * 5 - 2.5, z: -(1 + rng() * 5.5) };
    const spin = rng() * 160 - 80;
    const T = Physics.timeForApex(from.y, 1.2 + rng() * 3);
    const v = Physics.solveShot(from, to, T, 0.1, spin);
    const fb = Physics.firstBounce({ from, v, spin, t0: 0, wind: NOWIND });
    assert.ok(fb, 'không được vào lưới');
    worst = Math.max(worst, Math.hypot(fb.x - to.x, fb.z - to.z));
  }
  const usPer = Number(process.hrtime.bigint() - t0) / 1000 / 200;
  assert.ok(worst < 0.12, 'sai số điểm rơi lớn nhất ' + worst);
  assert.ok(usPer < 1000, 'solver phải < 1ms: ' + usPer.toFixed(0) + 'µs');
});

test('hình dạng các cú nằm trong bảng 4.2 (UPGRADE_PLAN)', () => {
  const rng = Physics.mulberry32(1);
  const shot = (type, ball, ax) => {
    const out = [];
    for (const team of ['A', 'B']) {
      const b = team === 'A' ? ball : mirror(ball);
      const s = Physics.computeShot({ team, type, ball: b, aim: { x: team === 'A' ? ax : -ax, z: 0 }, quality: 1, perfect: false, errBase: 0, rng });
      assert.equal(s.type, type);
      assert.equal(typeof s.spin, 'number');
      const m = measure(s.from, s.v, s.spin);
      assert.ok(!m.net && m.land, type + ' vào lưới');
      assert.ok(m.speed <= SHOTS[type].vmax, type + ' vượt vmax');
      m.landDepth = m.land.z * (team === 'A' ? -1 : 1);
      m.spin = s.spin;
      out.push(m);
    }
    return out;
  };
  const inR = (v, a, b, what) => assert.ok(v >= a && v <= b, `${what}=${v.toFixed(3)} ngoài [${a}, ${b}]`);
  // Drive từ cuối sân: 14–19 m/s, đỉnh 1.1–1.6, hở lưới 0.15–0.5 (+0.1 dung sai), rơi sâu
  for (const ball of [{ x: 0.5, y: 0.7, z: 6.3 }, { x: -1, y: 0.5, z: 5.5 }, { x: 0, y: 0.9, z: 6.6 }]) for (const ax of [-0.6, 0.3]) {
    for (const m of shot('drive', ball, ax)) {
      inR(m.speed, 14, 19, 'drive tốc độ'); inR(m.apex, 1.1, 1.6, 'drive đỉnh'); inR(m.clr, 0.15, 0.6, 'drive hở lưới');
      inR(m.landDepth, 4.7, 6.2, 'drive điểm rơi'); assert.ok(m.spin > 0, 'drive topspin');
    }
  }
  // Dink: 4–6.5 m/s, đỉnh = lưới + 0.1–0.4, rơi trong kitchen
  for (const ball of [{ x: 0.3, y: 0.4, z: 2.0 }, { x: -0.8, y: 0.6, z: 2.4 }, { x: 0.5, y: 0.3, z: 1.4 }]) for (const ax of [-0.3, 0.3]) {
    for (const m of shot('dink', ball, ax)) {
      inR(m.speed, 4, 6.5, 'dink tốc độ'); inR(m.apex - C.NET_H, 0.1, 0.4, 'dink đỉnh-lưới');
      inR(m.landDepth, 0.3, C.K, 'dink điểm rơi'); assert.ok(m.spin < 0, 'dink backspin');
    }
  }
  // Drop thứ 3 từ cuối sân: 7–9.3 m/s, đỉnh 1.8–2.4, hở lưới 0.3–0.6, rơi trong kitchen
  for (const ball of [{ x: 0.3, y: 0.6, z: 6.2 }, { x: 1, y: 0.9, z: 5.5 }, { x: -1, y: 0.7, z: 6.0 }]) for (const ax of [-0.4, 0.4]) {
    for (const m of shot('drop', ball, ax)) {
      inR(m.speed, 7, 9.3, 'drop tốc độ'); inR(m.apex, 1.8, 2.4, 'drop đỉnh'); inR(m.clr, 0.3, 0.6, 'drop hở lưới');
      inR(m.landDepth, 0.3, C.K, 'drop điểm rơi'); assert.ok(m.spin < 0, 'drop backspin');
    }
  }
  // Lob từ gần lưới / giữa sân: 9–12 m/s, đỉnh 4–6, rơi sát vạch cuối
  for (const ball of [{ x: 0.3, y: 0.7, z: 2.3 }, { x: -0.5, y: 0.9, z: 3.0 }]) for (const ax of [-0.4, 0.4]) {
    for (const m of shot('lob', ball, ax)) {
      inR(m.speed, 9, 12, 'lob tốc độ'); inR(m.apex, 4, 6, 'lob đỉnh'); inR(m.landDepth, 5.2, C.L, 'lob điểm rơi');
    }
  }
  // Smash: 18–24 m/s, đánh xuống, rơi giữa sân
  for (const ball of [{ x: 0.3, y: 2.0, z: 2.5 }, { x: -0.6, y: 1.7, z: 3.5 }]) for (const ax of [-0.4, 0.4]) {
    for (const m of shot('smash', ball, ax)) {
      inR(m.speed, 18, 24, 'smash tốc độ'); assert.ok(m.vy < 0, 'smash đánh xuống');
      inR(m.landDepth, 3, 5, 'smash điểm rơi');
    }
  }
  // Smash bóng thấp → drive
  assert.equal(Physics.computeShot({ team: 'A', type: 'smash', ball: { x: 0, y: 1.0, z: 3 }, aim: { x: 0, z: 0 }, quality: 1, perfect: false, errBase: 0, rng }).type, 'drive');
  // Giao bóng tay dưới: from y=0.55, 9–13.5 m/s, đỉnh 1.5–2.2, hở lưới 0.4–1.2, sâu trong ô chéo
  for (const [team, x, box] of [['A', 1.5, -1], ['A', -1.5, 1], ['B', -1.5, 1], ['B', 1.5, -1]]) for (const aimX of [-0.5, 0, 0.5]) {
    const pos = { x, z: (team === 'A' ? 1 : -1) * (C.L + 0.45) };
    const s = Physics.serveShot({ team, type: 'drive', pos, boxSign: box, aimX, errBase: 0, rng });
    assert.equal(s.from.y, 0.55);
    assert.equal(s.from.z, pos.z + (team === 'A' ? -0.45 : 0.45));
    assert.ok(Physics.speedOf(s.v) <= SERVE_VMAX);
    const m = measure(s.from, s.v, s.spin);
    inR(m.speed, 9, 13.5, 'giao tốc độ'); inR(m.apex, 1.5, 2.2, 'giao đỉnh'); inR(m.clr, 0.4, 1.2, 'giao hở lưới');
    const depth = m.land.z * (team === 'A' ? -1 : 1);
    inR(depth, 3.8, C.L, 'giao điểm rơi');
    assert.ok(m.land.x * box > 0, 'đúng ô chéo');
  }
});

/** launch tiện dụng: từ phía B (z<0) bay sang phía A */
function launchTo(to, opts = {}) {
  const from = opts.from || { x: 0, y: 0.8, z: -6 };
  const T = Physics.timeForApex(from.y, opts.apex || 1.4);
  const spin = opts.spin || 0;
  const v = Physics.solveShot(from, to, T, 0.1, spin);
  return { id: 1, by: 'b', team: 'B', from, v, spin, t0: 10, wind: NOWIND, hits: opts.hits || 5, serve: false, shot: 'drive' };
}

test('predictContact: điểm chạm hợp lệ, nhất quán với stateAt, tôn trọng luật', () => {
  // bóng rơi ở z=4 bên A; người chơi đứng sau điểm rơi
  const la = launchTo({ x: 0.5, z: 4 }, { hits: 1 });
  const land = Physics.firstBounce(la);
  const me = { x: 0.5, z: 5.6, team: 'A' };
  // lúc đầu còn xa (> maxAhead) → null
  assert.equal(Physics.predictContact(la, la.t0 + 0.05, me), null);
  // quét theo thời gian tới khi có điểm chạm
  let c = null, now = la.t0, first = null;
  while ((!c || c.atEdge) && now < la.t0 + 3) { now += 1 / 60; c = Physics.predictContact(la, now, me); if (c && !first) first = c; }
  assert.ok(c && !c.atEdge, 'phải có điểm chạm');
  assert.ok(first.atEdge || first === c, 'lần đầu thấy thường bị cửa sổ cắt');
  assert.ok(c.dist <= first.dist + 1e-9, 'điểm chạm cuối gần hơn');
  assert.ok(c.bounces === 1, 'hits<=2 → phải đã nảy');
  assert.ok(c.simT > land.t - 1e-9, 'sau điểm nảy');
  assert.ok(c.t - now <= C.CONTACT_MAX_AHEAD + 0.01 && c.t >= now - C.SIM_DT, 'trong cửa sổ maxAhead');
  assert.ok(c.dist <= C.REACH + C.ASSIST && c.ball.y >= 0.08 && c.ball.y <= 2.4);
  const st = Physics.stateAt(la, Physics.simTimeOf(la, c.t));
  assert.deepEqual({ x: st.b.x, y: st.b.y, z: st.b.z }, c.ball, 'stateAt(contact.t) phải ra đúng ball');
  assert.equal(st.bounces, c.bounces);
  // gọi lại ở thời điểm sau vẫn cho cùng điểm chạm (tất định)
  const c2 = Physics.predictContact(la, now + 0.05, me);
  assert.equal(c2.simT, c.simT);
  // chưa nảy lần 2
  assert.ok(st.bounces < 2);

  // Người chơi đứng đúng đường bay trước điểm nảy: không được volley khi hits<=2
  const mid = launchTo({ x: 0, z: 5.5 }, { hits: 2 });
  const vol = Physics.predictContact(mid, mid.t0 + 0.2, { x: 0, z: 2.6, team: 'A' }, { maxAhead: 2 });
  assert.ok(!vol || vol.bounces >= 1, 'luật 2 nảy');
  // hits > 2: được volley
  const mid3 = Object.assign({}, mid, { hits: 3 });
  const vol3 = Physics.predictContact(mid3, mid3.t0 + 0.2, { x: 0, z: 2.6, team: 'A' }, { maxAhead: 2 });
  assert.ok(vol3 && vol3.bounces === 0, 'volley hợp lệ');
  // đứng trong kitchen + avoidKitchenVolley → không volley
  const k = Physics.predictContact(mid3, mid3.t0 + 0.2, { x: 0, z: 1.5, team: 'A' }, { maxAhead: 2, avoidKitchenVolley: true, reach: 2 });
  assert.ok(!k || k.bounces >= 1, 'không volley trong kitchen');
  const k2 = Physics.predictContact(mid3, mid3.t0 + 0.2, { x: 0, z: 1.5, team: 'A' }, { maxAhead: 2, reach: 2 });
  assert.ok(k2 && k2.bounces === 0, 'không có cờ thì được volley');
  // volleyOnly
  const vo = Physics.predictContact(la, now, me, { volleyOnly: true });
  assert.equal(vo, null);
});

test('predictContact trả về null khi không với tới / sai phía / bóng vào lưới', () => {
  const la = launchTo({ x: 0.5, z: 4 }, { hits: 5 });
  // đứng xa
  assert.equal(Physics.predictContact(la, la.t0 + 0.5, { x: -4, z: 1, team: 'A' }, { maxAhead: 3 }), null);
  // đội B: bóng đã sang nửa sân A
  let tA = la.t0;
  while (Physics.stateAt(la, Physics.simTimeOf(la, tA)).b.z < 0.3) tA += 0.01;
  assert.equal(Physics.predictContact(la, tA, { x: 0, z: -1, team: 'B' }, { maxAhead: 3, reach: 2 }), null);
  assert.ok(Physics.predictContact(la, tA, { x: 0.5, z: 4.5, team: 'A' }, { maxAhead: 3 }), 'đội A thì có');
  // bóng vào lưới
  const net = { id: 2, team: 'B', from: { x: 0, y: 0.5, z: -5 }, v: { x: 0, y: 1, z: 14 }, spin: 0, t0: 0, wind: NOWIND, hits: 5 };
  assert.equal(Physics.predictContact(net, 0, { x: 0, z: 2, team: 'A' }, { maxAhead: 3 }), null);
  // bóng đã nảy 2 lần
  const dead = launchTo({ x: 0, z: 3 }, { hits: 5 });
  assert.equal(Physics.predictContact(dead, dead.t0 + 4, { x: 0, z: 5, team: 'A' }, { maxAhead: 3, reach: 3 }), null);
});

test('strokeZone', () => {
  const z = Physics.strokeZone;
  assert.equal(z('A', 0, 6, { x: 0.5, y: 1.0, z: 6 }, { serve: true }), 'serve');
  assert.equal(z('A', 0, 6, { x: 0.5, y: 1.8, z: 6 }), 'overhead');
  assert.equal(z('A', 0, 6, { x: 0.5, y: 0.3, z: 6 }), 'low');
  assert.equal(z('A', 0, 2.5, { x: 0.5, y: 1.0, z: 2.2 }, { volley: true }), 'volley');
  assert.equal(z('A', 0, 4.5, { x: 0.5, y: 1.0, z: 4.2 }, { volley: true }), 'forehand', 'volley xa lưới → theo phía tay');
  assert.equal(z('A', 0, 6, { x: 0.5, y: 1.0, z: 6 }), 'forehand');
  assert.equal(z('A', 0, 6, { x: -0.5, y: 1.0, z: 6 }), 'backhand');
  assert.equal(z('B', 0, -6, { x: -0.5, y: 1.0, z: -6 }), 'forehand', 'đội B tay phải là −x');
  assert.equal(z('B', 0, -6, { x: 0.5, y: 1.0, z: -6 }), 'backhand');
  assert.equal(z('B', 0, -2, { x: 0.5, y: 1.9, z: -2 }, { volley: true }), 'overhead');
});

function mkMatch(teamSize = 1) {
  const players = teamSize === 1 ? [{ id: 'a', team: 'A' }, { id: 'b', team: 'B' }]
    : [{ id: 'a', team: 'A' }, { id: 'a2', team: 'A' }, { id: 'b', team: 'B' }, { id: 'b2', team: 'B' }];
  const m = new Match({ teamSize, target: 11, scoring: 'rally', venue: 'gym', seed: 4, players });
  m.start(0, 'A');
  m.drain();
  return m;
}

test('Match v2: serve từ y=0.55, spin trong launch, drop, from lệch ≤ 0.25 (strict), kẹp spin', () => {
  const m = mkMatch();
  const p = m.player('a');
  const s = Physics.serveShot({ team: 'A', type: 'drive', pos: { x: p.x, z: p.z }, boxSign: m.boxSign, aimX: 0, errBase: 0, rng: () => 0.5 });
  // strict: from cũ (y=0.7) bị từ chối
  const bad = m.tryHit('a', { serve: true, ballT: 1, pos: { x: p.x, z: p.z }, from: { x: s.from.x, y: 0.7, z: s.from.z }, v: s.v, spin: s.spin, shot: 'serve' }, 1, true);
  assert.equal(bad.reason, 'from');
  assert.ok(m.tryHit('a', { serve: true, ballT: 1, pos: { x: p.x, z: p.z }, from: s.from, v: s.v, spin: 999, shot: 'serve' }, 1, true).ok);
  const la = m.drain().find((e) => e.t === 'launch').launch;
  assert.equal(la.spin, Physics.spinLimits('serve')[1], 'spin bị kẹp');
  // chạy tới khi bóng nảy bên B rồi đánh drop
  let t = 1;
  while (m.sim.bounces < 1 && t < 5) { t += 1 / 120; m.update(t); }
  t += 0.1; m.update(t);
  const st = Physics.stateAt(m.launch, Physics.simTimeOf(m.launch, t));
  const b = st.b;
  m.setPlayerState('b', b.x, b.z - 0.3, 0, 0);
  const shot = Physics.computeShot({ team: 'B', type: 'drop', ball: b, aim: { x: 0, z: 0 }, quality: 1, perfect: false, errBase: 0, rng: () => 0.5 });
  const base = { launchId: m.launch.id, ballT: t, pos: { x: b.x, z: b.z - 0.3 }, v: shot.v, shot: 'drop' };
  const off = (d) => ({ x: shot.from.x + d, y: shot.from.y, z: shot.from.z });
  assert.equal(m.tryHit('b', Object.assign({}, base, { from: off(0.3) }), t, true).reason, 'from');
  assert.ok(m.tryHit('b', Object.assign({}, base, { from: off(0.2) }), t, true).ok, 'lệch 0.2m vẫn hợp lệ');
  const la2 = m.drain().find((e) => e.t === 'launch').launch;
  assert.equal(la2.shot, 'drop');
  assert.equal(la2.spin, SHOTS.drop.spin, 'thiếu spin → spin mặc định của loại cú');
  // vmax mới: dink quá nhanh bị từ chối
  const m2 = mkMatch();
  m2.phase = 'rally';
  assert.ok(SHOTS.dink.vmax <= 12 && SHOTS.drop.vmax < SHOTS.drive.vmax);
});

test('bot: intent đặt trước (≥0.25s thường gặp), đánh đúng intent.t với from = bóng dự đoán, giao đúng serveAt', () => {
  for (const teamSize of [1, 2]) {
    const players = teamSize === 1 ? [{ id: 'a', team: 'A' }, { id: 'b', team: 'B' }]
      : [{ id: 'a', team: 'A' }, { id: 'a2', team: 'A' }, { id: 'b', team: 'B' }, { id: 'b2', team: 'B' }];
    const m = new Match({ teamSize, target: 5, scoring: 'rally', venue: 'arena', seed: 11, players });
    m.start(0, 'A');
    const bots = m.players.map((p, i) => new BotBrain(p, 'pro', Physics.mulberry32(i + 50)));
    const seen = new Map(), leads = [];
    let t = 0, hits = 0, serves = 0, rejected = 0;
    while (m.phase !== 'over' && t < 900) {
      t += 1 / 60; m.update(t);
      for (const b of bots) {
        const announcedServe = b.serveAt;
        const h = b.tick(1 / 60, t, m);
        const prevIntent = b.lastIntent;
        const cur = b.intent || (h && !h.serve ? b.lastIntent : null);
        if (cur && seen.get(b) !== cur) { seen.set(b, cur); leads.push(cur.t - t); assert.ok(['forehand', 'backhand', 'overhead', 'low', 'volley'].includes(cur.zone)); }
        if (!h) continue;
        if (h.serve) {
          serves++;
          assert.equal(h.ballT, announcedServe, 'giao đúng serveAt');
          assert.equal(h.from.y, C.SERVE_Y);
        } else {
          hits++;
          assert.ok(prevIntent && h.ballT === prevIntent.t && t >= prevIntent.t, 'đánh đúng intent.t');
          const st = Physics.stateAt(m.launch, Physics.simTimeOf(m.launch, h.ballT));
          assert.ok(Math.hypot(st.b.x - h.from.x, Math.max(st.b.y, 0.12) - h.from.y, st.b.z - h.from.z) < 1e-9, 'from = bóng tại intent.t');
          assert.equal(typeof h.spin, 'number');
        }
        if (!m.tryHit(b.p.id, h, t, false).ok) rejected++;
      }
      m.drain();
    }
    assert.equal(m.phase, 'over');
    assert.ok(serves > 4 && hits > 20, `serves=${serves} hits=${hits}`);
    assert.equal(rejected, 0, 'bot không bị từ chối cú nào');
    leads.sort((a, b) => a - b);
    assert.ok(leads[Math.floor(leads.length / 2)] >= 0.25, 'trung vị thời gian báo trước ≥ 0.25s: ' + leads[Math.floor(leads.length / 2)]);
  }
});

test('bot: pro vs pro rally dài vừa phải, ace thắng rookie, có drop & dink', () => {
  function play(lvA, lvB, seed) {
    const m = new Match({ teamSize: 1, target: 11, scoring: 'rally', venue: VENUES[seed % VENUES.length].id, seed, players: [{ id: 'a', team: 'A' }, { id: 'b', team: 'B' }] });
    m.start(0, 'A');
    const bots = m.players.map((p, i) => new BotBrain(p, p.team === 'A' ? lvA : lvB, Physics.mulberry32(seed * 13 + i)));
    const rallies = [], shots = {};
    let t = 0, rejected = 0;
    while (m.phase !== 'over' && t < 3000) {
      t += 1 / 60; m.update(t);
      for (const b of bots) {
        const h = b.tick(1 / 60, t, m);
        if (h) { if (!m.tryHit(b.p.id, h, t, false).ok) rejected++; else if (!h.serve) shots[h.shot] = (shots[h.shot] || 0) + 1; }
      }
      for (const e of m.drain()) if (e.t === 'point') rallies.push(m.hits);
    }
    return { winner: m.winner, rallies, shots, rejected };
  }
  let all = [], shots = {}, rej = 0;
  for (let s = 1; s <= 4; s++) {
    const r = play('pro', 'pro', s);
    all = all.concat(r.rallies); rej += r.rejected;
    for (const k in r.shots) shots[k] = (shots[k] || 0) + r.shots[k];
  }
  const avg = all.reduce((a, b) => a + b, 0) / all.length;
  console.log(`  pro vs pro: ${all.length} điểm, trung bình ${avg.toFixed(1)} cú/pha, cú: ${JSON.stringify(shots)}`);
  assert.ok(avg >= 7 && avg <= 16, 'avg=' + avg);
  assert.ok(shots.drop > 0 && shots.dink > 0);
  assert.ok(rej <= 1, 'rejected=' + rej);
  let aceWins = 0;
  for (let s = 1; s <= 3; s++) if (play('ace', 'rookie', s + 20).winner === 'A') aceWins++;
  assert.equal(aceWins, 3, 'ace phải thắng rookie');
});

test('protocol v2: drop, spin, swing', () => {
  assert.equal(Protocol.PROTOCOL_VERSION, 2);
  const hit = { t: 'hit', ballT: 5, pos: { x: 0, z: 5 }, from: { x: 0, y: 1, z: 5 }, v: { x: 0, y: 2, z: -10 }, shot: 'drop', launchId: 3 };
  assert.ok(Protocol.validate(hit));
  assert.ok(Protocol.validate(Object.assign({}, hit, { spin: -80 })));
  assert.ok(!Protocol.validate(Object.assign({}, hit, { spin: 'x' })));
  assert.ok(!Protocol.validate(Object.assign({}, hit, { spin: 1e6 })));
  assert.ok(!Protocol.validate(Object.assign({}, hit, { spin: NaN })));
  const sw = { t: 'swing', contactT: 12.5, x: 0.4, y: 1.0, z: 5.5, zone: 'forehand' };
  assert.ok(Protocol.validate(sw));
  for (const zone of ['backhand', 'overhead', 'low', 'volley', 'serve']) assert.ok(Protocol.validate(Object.assign({}, sw, { zone })));
  assert.ok(!Protocol.validate(Object.assign({}, sw, { zone: 'kick' })));
  assert.ok(!Protocol.validate(Object.assign({}, sw, { contactT: -1 })));
  assert.ok(!Protocol.validate(Object.assign({}, sw, { x: 99 })));
  assert.ok(!Protocol.validate({ t: 'swing', x: 0, y: 1, z: 0, zone: 'low' }));
});
