'use strict';
/* Test tích hợp online: server thật + client WebSocket chơi bằng BotBrain (có độ trễ giả) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const WebSocket = require('ws');
const { C } = require('../../shared/config.js');
const { Physics, BallSim } = require('../../shared/physics.js');
const { BotBrain } = require('../../shared/ai.js');
const { Protocol } = require('../../shared/protocol.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-test-'));
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, NODE_ENV: 'test' }, env || {}),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  return new Promise((resolve, reject) => {
    const t = setInterval(() => {
      if (out.includes('đang chạy')) { clearInterval(t); resolve({ port, proc, dataDir, log: () => out }); }
    }, 50);
    setTimeout(() => { clearInterval(t); reject(new Error('server không khởi động: ' + out)); }, 5000);
  });
}

/** Client mô phỏng một người chơi thật: đồng bộ đồng hồ, input 20Hz, đánh bằng BotBrain */
class TestClient {
  constructor(port, name, level) {
    this.port = port; this.name = name; this.level = level || 'ace';
    this.deviceId = 'dev-' + name + '-' + Math.random().toString(16).slice(2);
    this.msgs = []; this.offset = 0; this.best = Infinity;
    this.rejects = []; this.points = []; this.over = null; this.matchStart = null;
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${this.port}/ws`, { headers: { origin: `http://localhost:${this.port}` } });
      this.ws.on('open', () => {
        const hello = { t: 'hello', deviceId: this.deviceId, name: this.name, char: 'bunny', version: Protocol.PROTOCOL_VERSION };
        if (this.look !== undefined) hello.look = this.look;
        this.send(hello);
        for (let i = 0; i < 5; i++) setTimeout(() => this.send({ t: 'ping', c: performance.now() }), i * 60);
      });
      this.ws.on('message', (d) => this.onMsg(JSON.parse(d)));
      this.ws.on('error', reject);
      const t = setInterval(() => { if (this.pid && this.best < Infinity) { clearInterval(t); resolve(); } }, 20);
    });
  }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  serverNow() { return performance.now() / 1000 + this.offset; }
  waitFor(pred, ms) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const m = this.msgs.find(pred);
        if (m) { clearInterval(iv); resolve(m); }
        else if (Date.now() - t0 > (ms || 5000)) { clearInterval(iv); reject(new Error(this.name + ': hết thời gian chờ')); }
      }, 10);
    });
  }
  onMsg(m) {
    this.msgs.push(m);
    if (m.t === 'welcome') this.pid = m.playerId;
    if (m.t === 'pong') {
      const nowS = performance.now() / 1000, rtt = nowS - m.c / 1000;
      if (rtt < this.best) { this.best = rtt; this.offset = m.s + rtt / 2 - nowS; }
      return;
    }
    if (m.t === 'match_start') this.setupMatch(m);
    if (!this.view || m.matchId !== this.view.matchId) return;
    const v = this.view;
    if (m.t === 'serve_setup') {
      Object.assign(v, { phase: 'serve', serverId: m.server, rallyId: m.rallyId, boxSign: m.boxSign, launch: null, sim: null });
      for (const pos of m.positions) { const p = v.players.find((q) => q.id === pos.id); if (p) { p.x = pos.x; p.z = pos.z; p.side = pos.side; } }
    } else if (m.t === 'launch') {
      v.phase = 'rally'; v.launch = m.launch; v.sim = new BallSim(m.launch);
    } else if (m.t === 'point') { v.phase = 'point'; this.points.push(m); }
    else if (m.t === 'over') { v.phase = 'over'; this.over = m; }
    else if (m.t === 'hit_rejected') this.rejects.push(m.reason);
    else if (m.t === 'state') {
      for (const s of m.players) { const p = v.players.find((q) => q.id === s.id); if (p && p.id !== this.pid) { p.x = s.x; p.z = s.z; } }
    }
  }
  setupMatch(m) {
    this.matchStart = m;
    const players = m.players.map((p) => ({ id: p.id, team: p.team, x: 0, z: 0, vx: 0, vz: 0, side: 1 }));
    this.view = { matchId: m.matchId, teamSize: m.settings.teamSize, phase: 'idle', players, launch: null, sim: null, serverId: null, rallyId: 0, boxSign: 1 };
    this.me = players.find((p) => p.id === this.pid);
    if (!this.me) return; // khán giả
    this.brain = new BotBrain(this.me, this.level, Physics.mulberry32(Math.floor(Math.random() * 1e9)));
    this.last = performance.now(); this.inputAcc = 0;
    clearInterval(this.loop);
    this.loop = setInterval(() => this.tick(), 1000 / 60);
  }
  tick() {
    const v = this.view;
    const t = performance.now(); const dt = Math.min(0.05, (t - this.last) / 1000); this.last = t;
    const now = this.serverNow();
    if (v.sim) v.sim.advanceTo(Physics.simTimeOf(v.launch, now));
    if (v.phase === 'over') { clearInterval(this.loop); return; }
    const h = this.brain.tick(dt, now, v);
    // v2: báo trước cú vung như client thật
    const it = this.brain.intent;
    if (it && it !== this.sentIntent) {
      this.sentIntent = it;
      this.send({ t: 'swing', contactT: it.t, x: it.x, y: it.y, z: it.z, zone: it.zone });
    }
    if (h) {
      this.send(Object.assign({ t: 'hit' }, h));
      if (h.serve) v.phase = 'rally';
    }
    this.inputAcc += dt;
    if (this.inputAcc >= 0.05) {
      this.inputAcc = 0;
      this.send({ t: 'input', rid: v.rallyId, x: this.me.x, z: this.me.z, vx: this.me.vx, vz: this.me.vz, sw: this.brain.swing });
    }
  }
  close() { clearInterval(this.loop); try { this.ws.close(); } catch (e) { /* bỏ qua */ } }
}

test('online 1v1: phòng, chat, trận đấu với độ trễ 60±30ms', { timeout: 120000 }, async () => {
  const srv = await startServer({ LAG_MS: '60', JITTER_MS: '30' });
  const a = new TestClient(srv.port, 'An', 'rookie'), b = new TestClient(srv.port, 'Binh', 'pro');
  try {
    await a.connect(); await b.connect();
    a.send({ t: 'room_create', mode: '1v1', settings: { venue: 'gym', target: 11, scoring: 'rally' } });
    const rs = await a.waitFor((m) => m.t === 'room_state');
    assert.equal(rs.code.length, 4);
    for (const ch of rs.code) assert.ok(Protocol.ROOM_ALPHABET.includes(ch));
    b.send({ t: 'room_join', code: rs.code });
    await b.waitFor((m) => m.t === 'room_state' && m.players.length === 2);
    b.send({ t: 'chat', text: '<script>alert(1)</script> chào' });
    const chat = await a.waitFor((m) => m.t === 'chat' && !m.sys);
    assert.equal(chat.text, '<script>alert(1)</script> chào', 'chat được giữ nguyên dạng chữ (client hiển thị bằng textContent)');
    a.send({ t: 'room_start' });
    const err = await a.waitFor((m) => m.t === 'error' && m.code === 'cannot_start');
    assert.match(err.message, /Sẵn sàng/);
    b.send({ t: 'room_ready', ready: true });
    await sleep(250);
    a.send({ t: 'room_start' });
    await a.waitFor((m) => m.t === 'match_start');
    await b.waitFor((m) => m.t === 'match_start');
    assert.notEqual(a.matchStart.yourTeam, b.matchStart.yourTeam);

    // chơi đến khi có 6 điểm
    const t0 = Date.now();
    while (a.points.length < 6 && Date.now() - t0 < 100000) await sleep(100);
    await sleep(400);
    console.log('  rejects:', JSON.stringify([...a.rejects, ...b.rejects]), 'launches:', a.msgs.filter((m) => m.t === 'launch').length);
    assert.ok(a.points.length >= 6, 'cần ít nhất 6 điểm, có ' + a.points.length);
    const n = Math.min(a.points.length, b.points.length);
    for (let i = 0; i < n; i++) assert.deepEqual(a.points[i].score, b.points[i].score, 'hai client thấy cùng tỉ số');
    const launches = a.msgs.filter((m) => m.t === 'launch').length;
    const rej = a.rejects.length + b.rejects.length;
    console.log(`  điểm: ${n}, cú đánh được chấp nhận: ${launches}, bị từ chối: ${rej} ${JSON.stringify([...a.rejects, ...b.rejects])}`);
    console.log('  các lời phân xử:', a.points.map((p) => p.call).join(', '));
    assert.ok(launches >= n * 2, 'phải có các pha bóng qua lại thật');
    assert.ok(rej <= Math.max(2, launches * 0.1), 'tỉ lệ cú đánh hợp lệ bị từ chối phải thấp');
  } finally {
    a.close(); b.close(); srv.proc.kill('SIGTERM');
  }
});

test('ghép trận nhanh, mất kết nối & kết nối lại, khán giả', { timeout: 60000 }, async () => {
  const srv = await startServer({});
  const a = new TestClient(srv.port, 'Cuong'), b = new TestClient(srv.port, 'Dung'), s = new TestClient(srv.port, 'Xem');
  try {
    await a.connect(); await b.connect(); await s.connect();
    a.send({ t: 'queue_join', mode: '1v1' });
    await a.waitFor((m) => m.t === 'queue_status' && m.waiting);
    b.send({ t: 'queue_join', mode: '1v1' });
    await a.waitFor((m) => m.t === 'match_start');
    await b.waitFor((m) => m.t === 'match_start');
    await sleep(1500);

    s.send({ t: 'list_live' });
    const live = await s.waitFor((m) => m.t === 'live_list' && m.matches.length > 0);
    s.send({ t: 'spectate', matchId: live.matches[0].matchId });
    const ms = await s.waitFor((m) => m.t === 'match_start');
    assert.equal(ms.yourTeam, null, 'khán giả không thuộc đội nào');
    await s.waitFor((m) => m.t === 'sync');
    await s.waitFor((m) => m.t === 'state');

    // b mất kết nối -> trận tạm dừng, a nhận player_status
    b.close();
    await a.waitFor((m) => m.t === 'player_status' && m.connected === false);
    await a.waitFor((m) => m.t === 'paused');
    // b kết nối lại bằng cùng deviceId
    const b2 = new TestClient(srv.port, 'Dung');
    b2.deviceId = b.deviceId;
    await b2.connect();
    assert.equal(b2.pid, b.pid, 'kết nối lại giữ nguyên người chơi');
    await b2.waitFor((m) => m.t === 'match_start');
    await b2.waitFor((m) => m.t === 'sync');
    await a.waitFor((m) => m.t === 'player_status' && m.connected === true);
    const before = a.msgs.filter((m) => m.t === 'serve_setup').length;
    await sleep(500);
    assert.ok(a.msgs.filter((m) => m.t === 'serve_setup').length > before - 1);

    // b2 rời trận -> a thắng do đối thủ bỏ cuộc
    b2.send({ t: 'room_leave' });
    const over = await a.waitFor((m) => m.t === 'over');
    assert.equal(over.reason, 'forfeit');
    assert.equal(over.winner, a.matchStart.yourTeam);
    b2.close();
  } finally {
    a.close(); s.close(); srv.proc.kill('SIGTERM');
  }
});

test('look (tùy chỉnh) đi qua room_state, set_profile, match_start; bot có look hợp lệ', { timeout: 30000 }, async () => {
  const { LOOK } = require('../../shared/config.js');
  const srv = await startServer({});
  const a = new TestClient(srv.port, 'Lan'), b = new TestClient(srv.port, 'Minh');
  a.look = { shirt: '#FF0000', shorts: '#00ff00', pattern: 'flame', accessory: 'crown', shirtStyle: 'jersey', number: 7,
    paddle: 'red', evil: 'x', __proto__: { polluted: true } };
  try {
    await a.connect(); await b.connect();
    const expectA = { shirt: '#ff0000', shorts: '#00ff00', pattern: 'flame', accessory: 'crown', shirtStyle: 'jersey', number: 7 };
    a.send({ t: 'room_create', mode: '1v1', settings: { venue: 'gym', target: 11, scoring: 'rally' } });
    const rs = await a.waitFor((m) => m.t === 'room_state');
    b.send({ t: 'room_join', code: rs.code });
    const rsB = await b.waitFor((m) => m.t === 'room_state' && m.players.length === 2);
    assert.deepEqual(rsB.players.find((p) => p.id === a.pid).look, expectA, 'b thấy look (đã clean) của a');
    assert.deepEqual(rsB.players.find((p) => p.id === b.pid).look, {}, 'không gửi look -> {}');

    // b đổi look qua set_profile -> room_state gửi lại cho a
    b.send({ t: 'set_profile', name: 'Minh', char: 'bunny', look: { accessory: 'cap', number: 100, shoes: '#123abc' } });
    const rsA = await a.waitFor((m) => m.t === 'room_state' && m.players.some((p) => p.id === b.pid && p.look.accessory === 'cap'));
    assert.deepEqual(rsA.players.find((p) => p.id === b.pid).look, { accessory: 'cap', shoes: '#123abc' });
    // look quá lớn bị validate chặn (không đổi gì)
    const bad = {}; for (let i = 0; i < 50; i++) bad['k' + i] = i;
    b.send({ t: 'set_profile', name: 'Minh', char: 'bunny', look: bad });

    b.send({ t: 'room_ready', ready: true });
    await sleep(250);
    a.send({ t: 'room_start' });
    const msA = await a.waitFor((m) => m.t === 'match_start');
    const msB = await b.waitFor((m) => m.t === 'match_start');
    for (const ms of [msA, msB]) {
      assert.deepEqual(ms.players.find((p) => p.id === a.pid).look, expectA);
      assert.deepEqual(ms.players.find((p) => p.id === b.pid).look, { accessory: 'cap', shoes: '#123abc' });
    }
    a.close(); b.close();

    // 2v2 với bot: bot có look là object hợp lệ (cleanLook không đổi gì)
    const c = new TestClient(srv.port, 'Nga'), d = new TestClient(srv.port, 'Oanh');
    await c.connect(); await d.connect();
    c.send({ t: 'room_create', mode: '2v2', settings: { venue: 'gym', target: 11, scoring: 'rally' } });
    const rs2 = await c.waitFor((m) => m.t === 'room_state');
    d.send({ t: 'room_join', code: rs2.code });
    await c.waitFor((m) => m.t === 'room_state' && m.players.length === 2);
    c.send({ t: 'room_update', fillBots: true });
    d.send({ t: 'room_ready', ready: true });
    await sleep(250);
    c.send({ t: 'room_start' });
    const ms2 = await d.waitFor((m) => m.t === 'match_start');
    const bots = ms2.players.filter((p) => p.isBot);
    assert.equal(bots.length, 2);
    for (const p of ms2.players) {
      assert.ok(p.look && typeof p.look === 'object');
      assert.deepEqual(Protocol.cleanLook(p.look), p.look, 'look gửi ra luôn hợp lệ');
      if (p.look.accessory) assert.ok(LOOK.accessories.includes(p.look.accessory));
    }
    c.close(); d.close();
  } finally {
    a.close(); b.close(); srv.proc.kill('SIGTERM');
  }
});

test('server từ chối origin lạ (production), phiên bản cũ và dữ liệu rác', { timeout: 20000 }, async () => {
  const srv = await startServer({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://game.example.com' });
  try {
    await assert.rejects(new Promise((res, rej) => {
      const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`, { headers: { origin: 'https://evil.example' } });
      ws.on('open', res); ws.on('error', rej);
    }));
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`, { headers: { origin: 'https://game.example.com' } });
    await new Promise((r) => ws.on('open', r));
    const got = [];
    ws.on('message', (d) => got.push(JSON.parse(d)));
    for (let i = 0; i < 20; i++) ws.send('{"t":"input","x":"rác"}');
    ws.send('không phải json');
    ws.send(JSON.stringify({ t: 'hello', deviceId: 'abcdefgh123', name: 'Cu', char: 'bunny', version: 999 }));
    await sleep(400);
    assert.ok(got.some((m) => m.t === 'error' && m.code === 'version'));
    const h = await fetch(`http://127.0.0.1:${srv.port}/healthz`).then((r) => r.json());
    assert.equal(h.ok, true);
    ws.close();
  } finally { srv.proc.kill('SIGTERM'); }
});

test('online 2v2: 2 người + 2 bot của server', { timeout: 170000 }, async () => {
  const srv = await startServer({ LAG_MS: '40', JITTER_MS: '20' });
  const a = new TestClient(srv.port, 'Em', 'pro'), b = new TestClient(srv.port, 'Gia', 'pro');
  try {
    await a.connect(); await b.connect();
    a.send({ t: 'room_create', mode: '2v2', settings: { venue: 'roof', target: 11, scoring: 'rally' } });
    const rs = await a.waitFor((m) => m.t === 'room_state');
    b.send({ t: 'room_join', code: rs.code });
    await a.waitFor((m) => m.t === 'room_state' && m.players.length === 2);
    a.send({ t: 'room_update', fillBots: true, botLevel: 'rookie' });
    b.send({ t: 'room_update', team: 'A' }); // cùng đội với a
    await sleep(200);
    b.send({ t: 'room_ready', ready: true });
    await sleep(200);
    a.send({ t: 'room_start' });
    const ms = await a.waitFor((m) => m.t === 'match_start');
    assert.equal(ms.players.length, 4);
    assert.equal(ms.players.filter((p) => p.isBot).length, 2);
    assert.equal(ms.settings.scoring, 'rally');
    const t0 = Date.now();
    while (a.points.length < 4 && Date.now() - t0 < 140000) await sleep(100);
    assert.ok(a.points.length >= 4, 'có ' + a.points.length + ' điểm');
    const rej = a.rejects.length + b.rejects.length;
    const launches = a.msgs.filter((m) => m.t === 'launch').length;
    console.log(`  2v2 điểm: ${a.points.length}, cú đánh: ${launches}, bị từ chối: ${rej} ${JSON.stringify([...a.rejects, ...b.rejects])}`);
    assert.ok(rej <= Math.max(2, launches * 0.1));
    // swing: bot server phát (cả giao bóng), người chơi được chuyển tiếp cho người khác, không gửi lại cho chính mình
    const botIds = ms.players.filter((p) => p.isBot).map((p) => p.id);
    const sw = a.msgs.filter((m) => m.t === 'swing');
    assert.ok(sw.some((m) => botIds.includes(m.id) && m.zone !== 'serve'), 'bot phát swing khi có intent');
    // chỉ kiểm tra khi trận thực sự có lượt bot giao (đội người có thể thắng liền nhiều điểm và giữ giao suốt)
    const botServed = a.msgs.some((m) => m.t === 'serve_setup' && botIds.includes(m.server));
    if (botServed) assert.ok(sw.some((m) => botIds.includes(m.id) && m.zone === 'serve'), 'bot phát swing giao bóng');
    assert.ok(sw.some((m) => m.id === b.pid), 'swing của b được chuyển cho a');
    assert.ok(!sw.some((m) => m.id === a.pid), 'không gửi lại swing cho chính người gửi');
    for (const m of sw) assert.ok(m.matchId === ms.matchId && Number.isFinite(m.contactT) && typeof m.zone === 'string');
    // launch có spin
    assert.ok(a.msgs.filter((m) => m.t === 'launch').every((m) => typeof m.launch.spin === 'number'));
  } finally { a.close(); b.close(); srv.proc.kill('SIGTERM'); }
});
