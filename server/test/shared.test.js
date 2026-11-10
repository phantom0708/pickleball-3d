'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { C } = require('../../shared/config.js');
const { Physics, BallSim } = require('../../shared/physics.js');
const { Match } = require('../../shared/match.js');
const { BotBrain } = require('../../shared/ai.js');
const { Protocol } = require('../../shared/protocol.js');

const zeroRng = () => 0.5;
function mk(opts = {}) {
  const teamSize = opts.teamSize || 1;
  const players = teamSize === 1 ? [{ id: 'a', team: 'A' }, { id: 'b', team: 'B' }]
    : [{ id: 'a', team: 'A' }, { id: 'a2', team: 'A' }, { id: 'b', team: 'B' }, { id: 'b2', team: 'B' }];
  const m = new Match(Object.assign({ teamSize, target: 11, scoring: 'rally', venue: 'gym', seed: 1, players }, opts));
  m.start(0, opts.first || 'A');
  return m;
}
function events(m) { return m.drain(); }
function runUntil(m, t0, t1, cb) { for (let t = t0; t <= t1; t += 1 / 120) { m.update(t); if (cb && cb(t)) return t; } return t1; }
// giao bóng từ người giao tới điểm (tx, tz)
function serveTo(m, tx, tz, T, now = 0.1) {
  const p = m.player(m.serverId);
  const dir = p.team === 'A' ? -1 : 1;
  const from = { x: p.x, y: 0.7, z: p.z + dir * 0.4 };
  const v = Physics.solveShot(from, { x: tx, z: tz }, T || 1.0, 0.15);
  return m.tryHit(p.id, { serve: true, ballT: now, pos: { x: p.x, z: p.z }, from, v, shot: 'serve' }, now, false);
}
function lastPoint(m) { return events(m).filter((e) => e.t === 'point').pop(); }

test('mô phỏng tất định: cùng launch cho cùng kết quả', () => {
  const la = { from: { x: 0.3, y: 0.9, z: 5 }, v: { x: -1.2, y: 4.1, z: -11.3 }, t0: 0, wind: { x: 0.37, z: -0.1 } };
  const a = new BallSim(la).advanceTo(2.5), b = new BallSim(la);
  for (let t = 0; t <= 2.5; t += 0.013) b.advanceTo(t);
  b.advanceTo(2.5);
  assert.deepEqual(a.b, b.b);
  assert.equal(a.bounces, b.bounces);
});

test('solveShot qua lưới và rơi đúng điểm', () => {
  const from = { x: 0, y: 0.5, z: 6 };
  const v = Physics.solveShot(from, { x: 1, z: -5 }, 0.8, 0.1);
  const la = { from, v, t0: 0, wind: { x: 0, z: 0 } };
  const fb = Physics.firstBounce(la);
  assert.ok(fb, 'phải có điểm nảy');
  assert.ok(Math.abs(fb.x - 1) < 0.1 && Math.abs(fb.z + 5) < 0.15, JSON.stringify(fb));
});

test('vị trí giao bóng theo điểm chẵn/lẻ và ô chéo', () => {
  const m = mk();
  const s = m.player('a'), r = m.player('b');
  assert.equal(m.serverId, 'a');
  assert.ok(s.x > 0 && s.z > C.L, 'điểm chẵn: đội A giao từ bên phải (+x)');
  assert.ok(r.x < 0 && r.z < -C.L, 'người nhận đứng chéo');
  assert.equal(m.boxSign, -1);
});

test('giao bóng vào kitchen bị lỗi', () => {
  const m = mk(); events(m);
  assert.ok(serveTo(m, -1.5, -1.5, 1.0).ok);
  runUntil(m, 0.1, 3);
  const p = lastPoint(m);
  assert.equal(p.call, 'GIAO VÀO KITCHEN');
  assert.equal(p.winner, 'B');
});

test('giao bóng sai ô bị lỗi, đúng ô thì tiếp tục', () => {
  const m = mk(); events(m);
  serveTo(m, 1.5, -5, 1.0);
  runUntil(m, 0.1, 3);
  assert.equal(lastPoint(m).call, 'GIAO HỎNG');
  const m2 = mk(); events(m2);
  serveTo(m2, -1.5, -5, 1.0);
  runUntil(m2, 0.1, 1.3);
  assert.equal(m2.phase, 'rally');
});

test('luật 2 nảy: đỡ giao bóng khi chưa nảy bị từ chối', () => {
  const m = mk(); events(m);
  serveTo(m, -1.5, -5, 1.0);
  const t = 0.1 + 0.6 / C.TIME_SCALE;
  m.update(t);
  const st = Physics.stateAt(m.launch, Physics.simTimeOf(m.launch, t));
  assert.equal(st.bounces, 0);
  const r = m.tryHit('b', { launchId: m.launch.id, ballT: t, pos: { x: st.b.x, z: st.b.z }, from: st.b, v: { x: 0, y: 3, z: 8 }, shot: 'drive' }, t, false);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'two_bounce');
});

function rallyTo3(m) {
  // giao -> trả -> cú thứ 3 (đều sau khi nảy) để hits = 3
  serveTo(m, -1.5, -5, 1.0);
  let t = runUntil(m, 0.1, 4, () => m.sim.bounces === 1);
  let b = m.sim.b;
  let v = Physics.solveShot({ x: b.x, y: 0.5, z: b.z }, { x: 1, z: 5 }, 1.0, 0.2);
  assert.ok(m.tryHit('b', { launchId: m.launch.id, ballT: t, pos: { x: b.x, z: b.z }, from: { x: b.x, y: 0.5, z: b.z }, v, shot: 'drive' }, t, false).ok);
  t = runUntil(m, t, t + 4, () => m.sim.bounces === 1);
  b = m.sim.b;
  v = Physics.solveShot({ x: b.x, y: 0.5, z: b.z }, { x: 0, z: -5 }, 1.2, 0.2);
  assert.ok(m.tryHit('a', { launchId: m.launch.id, ballT: t, pos: { x: b.x, z: b.z }, from: { x: b.x, y: 0.5, z: b.z }, v, shot: 'drive' }, t, false).ok);
  return t;
}

test('volley khi đứng trong kitchen bị xử lỗi', () => {
  const m = mk(); events(m);
  let t = rallyTo3(m);
  t = runUntil(m, t, t + 2, () => m.sim.b.z < -0.5);
  const b = m.sim.b;
  assert.equal(m.sim.bounces, 0);
  const r = m.tryHit('b', { launchId: m.launch.id, ballT: t, pos: { x: b.x, z: -1.0 }, from: b, v: { x: 0, y: 4, z: 8 }, shot: 'drive' }, t, false);
  assert.ok(r.ok && r.fault);
  const p = lastPoint(m);
  assert.equal(p.call, 'LỖI KITCHEN');
  assert.equal(p.winner, 'A');
});

test('bóng ra ngoài -> OUT, nảy 2 lần -> điểm cho người đánh', () => {
  const m = mk(); events(m);
  let t = rallyTo3(m);
  runUntil(m, t, t + 5);
  const p = lastPoint(m);
  assert.equal(p.call, 'ĐIỂM!');
  assert.equal(p.winner, 'A');

  const m2 = mk(); events(m2);
  serveTo(m2, -1.5, -5, 1.0);
  t = runUntil(m2, 0.1, 4, () => m2.sim.bounces === 1);
  const b = m2.sim.b;
  const v = Physics.solveShot({ x: b.x, y: 0.5, z: b.z }, { x: 0, z: 8.5 }, 1.2, 0.2);
  m2.tryHit('b', { launchId: m2.launch.id, ballT: t, pos: b, from: { x: b.x, y: 0.5, z: b.z }, v, shot: 'drive' }, t, false);
  runUntil(m2, t, t + 4);
  const p2 = lastPoint(m2);
  assert.equal(p2.call, 'OUT');
  assert.equal(p2.winner, 'A');
});

test('bóng vào lưới', () => {
  const m = mk(); events(m);
  const p = m.player('a');
  const from = { x: p.x, y: 0.7, z: p.z - 0.4 };
  m.tryHit('a', { serve: true, ballT: 0.1, pos: p, from, v: { x: -0.3, y: 2.25, z: -14 }, shot: 'serve' }, 0.1, false);
  runUntil(m, 0.1, 3);
  const pt = lastPoint(m);
  assert.equal(pt.call, 'LƯỚI!');
  assert.equal(pt.winner, 'B');
});

test('side-out: người nhận thắng chỉ giành giao, không có điểm', () => {
  const m = mk({ scoring: 'sideout' }); events(m);
  m.phase = 'rally'; m._end('B', 'X', 0);
  assert.deepEqual(m.score, { A: 0, B: 0 });
  assert.equal(m.serverTeam, 'B');
  m.phase = 'rally'; m._end('B', 'X', 0);
  assert.deepEqual(m.score, { A: 0, B: 1 });
});

test('phải thắng cách 2 điểm', () => {
  const m = mk(); events(m);
  m.score = { A: 10, B: 10 };
  m.phase = 'rally'; m._end('A', 'X', 0);
  assert.equal(m.overPending, false);
  m.phase = 'rally'; m._end('A', 'X', 0);
  assert.equal(m.overPending, true);
  m.update(5);
  assert.equal(m.phase, 'over');
  assert.equal(m.winner, 'A');
});

test('đánh đôi: đội giao thắng thì đổi bên, người giao theo chẵn/lẻ', () => {
  const m = mk({ teamSize: 2 }); events(m);
  assert.equal(m.serverId, 'a');           // a ở bên phải (side 1), điểm 0 chẵn
  m.phase = 'rally'; m._end('A', 'X', 1);  // A thắng khi đang giao -> đổi bên, 1 điểm (lẻ)
  m.update(5);
  assert.equal(m.player('a').side, -1);
  assert.equal(m.serverId, 'a', 'lẻ -> người bên trái giao, giờ là a');
  m.phase = 'rally'; m._end('B', 'X', 6);  // B giành giao, B có 1 điểm (lẻ) -> người bên trái của B
  m.update(10);
  assert.equal(m.serverId, 'b2');
});

test('bot đấu bot kết thúc trận, không có cú đánh nào bị từ chối', () => {
  for (const teamSize of [1, 2]) {
    const m = mk({ teamSize, seed: 9 });
    const bots = m.players.map((p, i) => new BotBrain(p, 'pro', Physics.mulberry32(i + 3)));
    let t = 0; let rejected = 0;
    while (m.phase !== 'over' && t < 1500) {
      t += 1 / 60; m.update(t);
      for (const b of bots) { const h = b.tick(1 / 60, t, m); if (h && !m.tryHit(b.p.id, h, t, false).ok) rejected++; }
      m.drain();
    }
    assert.equal(m.phase, 'over', 'teamSize ' + teamSize);
    assert.ok(rejected <= 2, 'rejected=' + rejected);
  }
});

test('protocol.validate chặn dữ liệu xấu', () => {
  assert.ok(Protocol.validate({ t: 'ping', c: 123 }));
  assert.ok(!Protocol.validate({ t: 'ping', c: NaN }));
  assert.ok(!Protocol.validate({ t: 'ping', c: Infinity }));
  assert.ok(!Protocol.validate({ t: 'nope' }));
  assert.ok(!Protocol.validate(null));
  assert.ok(!Protocol.validate({ t: 'chat', text: 'x'.repeat(500) }));
  assert.ok(Protocol.validate({ t: 'input', rid: 1, x: 0, z: 5, vx: 0, vz: 0, sw: 0 }));
  assert.ok(!Protocol.validate({ t: 'input', rid: 1, x: 'a', z: 5, vx: 0, vz: 0, sw: 0 }));
  assert.ok(!Protocol.validate({ t: 'room_create', mode: '3v3', settings: { venue: 'gym', target: 11, scoring: 'rally' } }));
  assert.equal(Protocol.cleanName('  <b>An\u0000h  '), '<b>Anh');
});

test('Protocol.cleanLook: chỉ giữ trường hợp lệ, không bao giờ ném lỗi', () => {
  const { LOOK } = require('../../shared/config.js');
  // hợp lệ đầy đủ
  const full = { shirt: '#AABBCC', shorts: '#000000', accent: '#ffffff', shoes: '#123abc', paddle: '#0f0F0f',
    pattern: 'stripe', accessory: 'headphones', shirtStyle: 'hoodie', number: 99 };
  assert.deepEqual(Protocol.cleanLook(full), Object.assign({}, full, { shirt: '#aabbcc', paddle: '#0f0f0f' }));
  assert.deepEqual(Protocol.cleanLook({ number: 0 }), { number: 0 });
  // hex sai
  for (const bad of ['#abc', 'aabbcc', '#aabbcg', '#aabbccdd', ' #aabbcc', '#aabbcc ', 'red', 123456, null, ['#aabbcc']])
    assert.deepEqual(Protocol.cleanLook({ shirt: bad }), {}, 'hex sai: ' + JSON.stringify(bad));
  // enum lạ / sai kiểu
  assert.deepEqual(Protocol.cleanLook({ pattern: 'plaid', accessory: 'Crown', shirtStyle: 'suit' }), {});
  assert.deepEqual(Protocol.cleanLook({ pattern: ['solid'], accessory: { toString: () => 'cap' } }), {});
  // number: chỉ nguyên 0..99
  for (const n of [-1, 100, 7.5, '7', NaN, Infinity, true]) assert.deepEqual(Protocol.cleanLook({ number: n }), {}, 'number ' + n);
  // trường lạ bị bỏ, giữ phần hợp lệ
  assert.deepEqual(Protocol.cleanLook({ shirt: '#ff0000', hack: '<script>', name: 'x' }), { shirt: '#ff0000' });
  // không phải object
  for (const g of [null, undefined, 0, 1, '', 'look', true, [], ['#ff0000'], () => 1, Symbol('x')])
    assert.deepEqual(Protocol.cleanLook(g), {});
  // object khổng lồ
  const huge = {}; for (let i = 0; i < 100000; i++) huge['k' + i] = 'x'.repeat(10);
  huge.accessory = 'cap';
  assert.deepEqual(Protocol.cleanLook(huge), { accessory: 'cap' });
  // khóa ô nhiễm prototype (như JSON.parse tạo ra)
  const evil = JSON.parse('{"__proto__":{"polluted":1,"shirt":"#ff0000"},"constructor":{"prototype":{"polluted":1}},"pattern":"dots"}');
  const out = Protocol.cleanLook(evil);
  assert.deepEqual(out, { pattern: 'dots' });
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.equal(({}).polluted, undefined);
  // trường kế thừa từ prototype không được dùng
  assert.deepEqual(Protocol.cleanLook(Object.create({ accessory: 'cap' })), {});
  // getter ném lỗi -> {}
  const thrower = { get shirt() { throw new Error('boom'); } };
  assert.deepEqual(Protocol.cleanLook(thrower), {});
  // enum dùng chung từ config
  assert.equal(LOOK.patterns.length, 8); assert.equal(LOOK.accessories.length, 14); assert.equal(LOOK.shirtStyles.length, 4);
  for (const id of LOOK.accessories) assert.deepEqual(Protocol.cleanLook({ accessory: id }), { accessory: id });
});

test('protocol: hello/set_profile nhận look tùy chọn, chặn look quá lớn/sai kiểu', () => {
  const hello = { t: 'hello', deviceId: 'abcdefgh123', name: 'An', char: 'bunny', version: Protocol.PROTOCOL_VERSION };
  assert.ok(Protocol.validate(hello), 'không có look vẫn hợp lệ (tương thích ngược)');
  assert.ok(Protocol.validate(Object.assign({}, hello, { look: { shirt: '#ff0000', number: 5, unknown: 'x' } })));
  assert.ok(!Protocol.validate(Object.assign({}, hello, { look: 'red' })));
  assert.ok(!Protocol.validate(Object.assign({}, hello, { look: [1, 2] })));
  assert.ok(!Protocol.validate(Object.assign({}, hello, { look: null })));
  const big = {}; for (let i = 0; i < 17; i++) big['k' + i] = 1;
  assert.ok(!Protocol.validate(Object.assign({}, hello, { look: big })));
  assert.ok(!Protocol.validate(Object.assign({}, hello, { look: { shirt: 'x'.repeat(1000) } })));
  assert.ok(!Protocol.validate(Object.assign({}, hello, { look: { shirt: { deep: { nested: 1 } } } })));
  const sp = { t: 'set_profile', name: 'An', char: 'bunny' };
  assert.ok(Protocol.validate(sp));
  assert.ok(Protocol.validate(Object.assign({}, sp, { look: { accessory: 'cap' } })));
  assert.ok(!Protocol.validate(Object.assign({}, sp, { look: 5 })));
  assert.equal(Protocol.PROTOCOL_VERSION, 2);
});

test('mặc định là luật truyền thống: chỉ bên giao bóng mới ghi điểm', () => {
  const m = new Match({ teamSize: 1, target: 11, venue: 'gym', seed: 1, players: [{ id: 'a', team: 'A' }, { id: 'b', team: 'B' }] });
  assert.equal(m.scoring, 'sideout');
  const d = new Match({ teamSize: 2, target: 11, venue: 'gym', seed: 1, players: [{ id: 'a', team: 'A' }, { id: 'a2', team: 'A' }, { id: 'b', team: 'B' }, { id: 'b2', team: 'B' }] });
  assert.equal(d.scoring, 'sideout', 'đánh đôi cũng dùng luật truyền thống');
});

test('đánh đôi truyền thống: 0-0-2, đổi ô khi ghi điểm, người giao thứ 2, đổi giao', () => {
  const m = mk({ teamSize: 2, scoring: 'sideout' });
  let e = m.drain().find((x) => x.t === 'serve_setup');
  // lượt giao đầu trận: chỉ 1 người giao, là người ở ô phải, đọc 0-0-2
  assert.equal(m.serverTeam, 'A'); assert.equal(m.serverId, 'a'); assert.equal(e.serverNum, 2);
  // A thắng pha khi đang giao -> +1, a đổi ô và giao tiếp
  m.phase = 'rally'; m._end('A', 'X', 0); m.update(5);
  assert.deepEqual(m.score, { A: 1, B: 0 });
  assert.equal(m.serverId, 'a'); assert.equal(m.player('a').side, -1, 'người giao đổi sang ô trái');
  // A thua pha: vì đang là người giao thứ 2 của lượt đầu trận -> đổi giao luôn, không ai được điểm
  m.phase = 'rally'; m._end('B', 'X', 6); m.update(10);
  assert.deepEqual(m.score, { A: 1, B: 0 }, 'bên nhận thắng không được điểm');
  assert.equal(m.serverTeam, 'B');
  e = m.drain().filter((x) => x.t === 'serve_setup').pop();
  assert.equal(e.serverNum, 1);
  const first = m.player(m.serverId);
  assert.equal(first.team, 'B'); assert.equal(first.side, 1, 'sau đổi giao, người ở ô phải giao trước');
  // B (người giao 1) thua -> chuyển sang người giao 2 của B, không ai được điểm, không đổi ô
  const sides = m.players.map((p) => p.side).join();
  m.phase = 'rally'; m._end('A', 'X', 11); m.update(15);
  assert.deepEqual(m.score, { A: 1, B: 0 });
  assert.equal(m.serverTeam, 'B');
  assert.notEqual(m.serverId, first.id, 'đồng đội giao');
  assert.equal(m.players.map((p) => p.side).join(), sides, 'không ai đổi ô');
  e = m.drain().filter((x) => x.t === 'serve_setup').pop();
  assert.equal(e.serverNum, 2);
  // người nhận luôn ở ô chéo với người giao
  assert.equal(m.player(m.receiverId).side, m.player(m.serverId).side);
  // B (người giao 2) thua -> đổi giao về A, người giao 1 là người đang ở ô phải
  m.phase = 'rally'; m._end('A', 'X', 16); m.update(20);
  assert.equal(m.serverTeam, 'A');
  assert.equal(m.player(m.serverId).side, 1);
});

test('vô-lê khi chân chạm vạch bếp cũng bị xử lỗi', () => {
  const m = mk(); m.drain();
  let t = rallyTo3(m);
  t = runUntil(m, t, t + 2, () => m.sim.b.z < -0.5);
  const b = m.sim.b;
  // đứng ngay ngoài vạch 5cm (tâm người) -> chân vẫn chạm vạch
  const r = m.tryHit('b', { launchId: m.launch.id, ballT: t, pos: { x: b.x, z: -(C.K + 0.05) }, from: b, v: { x: 0, y: 4, z: 8 }, shot: 'drive' }, t, false);
  assert.ok(r.ok && r.fault);
  assert.equal(lastPoint(m).call, 'LỖI KITCHEN');
});

test('bot đấu bot theo luật truyền thống (đơn & đôi) vẫn kết thúc trận', () => {
  for (const teamSize of [1, 2]) {
    const m = mk({ teamSize, seed: 21, scoring: 'sideout' });
    const bots = m.players.map((p, i) => new BotBrain(p, 'pro', Physics.mulberry32(i + 7)));
    let t = 0;
    while (m.phase !== 'over' && t < 4000) {
      t += 1 / 60; m.update(t);
      for (const b of bots) { const h = b.tick(1 / 60, t, m); if (h) m.tryHit(b.p.id, h, t, false); }
      m.drain();
    }
    assert.equal(m.phase, 'over', 'teamSize ' + teamSize);
    const w = m.winner, o = w === 'A' ? 'B' : 'A';
    assert.ok(m.score[w] >= 11 && m.score[w] - m.score[o] >= 2);
  }
});

test('hiệp ngắn chạm 5: vẫn phải hơn 2 điểm; server chỉ nhận 5/7/11', () => {
  const m = mk({ target: 5, scoring: 'rally' }); m.drain();
  m.score = { A: 4, B: 4 };
  m.phase = 'rally'; m._end('A', 'X', 0);
  assert.equal(m.overPending, false, '5–4 chưa kết thúc');
  m.phase = 'rally'; m._end('A', 'X', 0);
  assert.equal(m.overPending, true, '6–4 thắng');
  for (const t of [5, 7, 11]) assert.ok(Protocol.settingsOk({ venue: 'gym', target: t, scoring: 'sideout' }));
  for (const t of [15, 21, 3]) assert.ok(!Protocol.settingsOk({ venue: 'gym', target: t, scoring: 'sideout' }));
});

/* ---------- Luật áp dụng tại Việt Nam (theo USA Pickleball) ---------- */
test('bóng chạm mép lưới mà qua được thì vẫn chơi (không có let); đập thân lưới thì LƯỚI', () => {
  // giao sát mép lưới: tìm vận tốc làm bóng chạm dải băng rồi lật qua
  const m = mk(); m.drain();
  const p = m.player('a');
  const from = { x: p.x, y: 0.55, z: p.z - 0.45 };
  let cordLaunch = null;
  for (let vy = 1.0; vy < 4 && !cordLaunch; vy += 0.01) {
    const la = { from, v: { x: -0.35, y: vy, z: -13 }, t0: 0, wind: { x: 0, z: 0 }, spin: 0 };
    const s = new BallSim(la); const ev = []; s.advanceTo(2, ev);
    if (ev.some((e) => e.type === 'netcord')) cordLaunch = la;
  }
  assert.ok(cordLaunch, 'tìm được cú chạm mép lưới');
  const ev = []; new BallSim(cordLaunch).advanceTo(3, ev);
  const fb = ev.find((e) => e.type === 'bounce');
  assert.ok(fb.z < 0, 'chạm mép lưới vẫn lật sang sân bên kia');
  m.tryHit('a', { serve: true, ballT: 0.1, pos: p, from, v: cordLaunch.v, shot: 'serve' }, 0.1, false);
  runUntil(m, 0.1, 1.2);
  const evs = m.drain();
  assert.ok(!evs.some((e) => e.t === 'point' && e.call === 'LƯỚI!'), 'không xử lỗi lưới ngay khi chạm mép');
});

test('luật 10 giây: người giao không giao kịp -> lỗi giao', () => {
  const m = mk({ scoring: 'sideout' }); m.drain();
  m.update(C.SERVE_TIMEOUT + 0.1);
  const pt = lastPoint(m);
  assert.equal(pt.call, 'QUÁ 10 GIÂY');
  assert.equal(pt.winner, 'B');
  assert.equal(m.serverTeam, 'B', 'đơn truyền thống: mất giao');
  assert.deepEqual(m.score, { A: 0, B: 0 });
});

test('đánh đôi: sai người đỡ giao là lỗi', () => {
  const m = mk({ teamSize: 2, scoring: 'sideout' }); m.drain();
  const recv = m.receiverId;
  const wrong = m.players.find((q) => q.team === 'B' && q.id !== recv).id;
  const s = m.player(m.serverId);
  const from = { x: s.x, y: 0.55, z: s.z - 0.45 };
  const v = Physics.solveShot(from, { x: m.boxSign * 1.5, z: -5 }, 1.0, 0.15);
  m.tryHit(s.id, { serve: true, ballT: 0.1, pos: s, from, v, shot: 'serve' }, 0.1, false);
  const t = runUntil(m, 0.1, 4, () => m.sim.bounces === 1);
  const b = m.sim.b;
  const r = m.tryHit(wrong, { launchId: m.launch.id, ballT: t, pos: { x: b.x, z: b.z }, from: { x: b.x, y: Math.max(b.y, 0.12), z: b.z }, v: { x: 0, y: 4, z: 9 }, shot: 'drive' }, t, false);
  assert.ok(r.ok && r.fault);
  assert.equal(lastPoint(m).call, 'SAI NGƯỜI ĐỠ GIAO');
});

test('lỗi trớn: vô-lê rồi đà chạy vào bếp vẫn bị lỗi', () => {
  const m = mk(); m.drain();
  let t = rallyTo3(m);
  t = runUntil(m, t, t + 2, () => m.sim.b.z < -1.5);
  const b = m.sim.b;
  assert.equal(m.sim.bounces, 0);
  const pos = { x: b.x, z: -(C.K + 0.4) };            // vô-lê hợp lệ, đứng ngoài bếp
  const v = Physics.solveShot({ x: b.x, y: Math.max(b.y, 0.12), z: b.z }, { x: 0, z: 5 }, 0.9, 0.2);
  const r = m.tryHit('b', { launchId: m.launch.id, ballT: t, pos, from: { x: b.x, y: Math.max(b.y, 0.12), z: b.z }, v, shot: 'drive' }, t, false);
  assert.ok(r.ok && !r.fault);
  m.setPlayerState('b', b.x, -(C.K - 0.3), 0, 0);       // đà chạy đưa người vào bếp
  m.update(t + 0.2);
  const pt = lastPoint(m);
  assert.equal(pt.call, 'ĐÀ VÀO BẾP');
  assert.equal(pt.winner, 'A');
});

test('rally scoring: điểm kết thúc ván chỉ được ghi khi đang giao', () => {
  const m = mk({ target: 7, scoring: 'rally' }); m.drain();
  m.score = { A: 3, B: 6 }; m.serverTeam = 'A';
  m.phase = 'rally'; m._end('B', 'X', 0);
  assert.deepEqual(m.score, { A: 3, B: 6 }, 'bên nhận thắng ở điểm quyết định: chỉ giành giao');
  assert.equal(m.serverTeam, 'B');
  assert.equal(m.overPending, false);
  m.phase = 'rally'; m._end('B', 'X', 0);
  assert.deepEqual(m.score, { A: 3, B: 7 });
  assert.equal(m.overPending, true);
});
