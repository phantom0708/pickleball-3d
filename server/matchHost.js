'use strict';
/* Chạy một trận online có thẩm quyền: Match + bot + kiểm tra input/cú đánh */
const crypto = require('crypto');
const { C, CHARACTERS, LOOK } = require('../shared/config.js');
const { Physics } = require('../shared/physics.js');
const { Match } = require('../shared/match.js');
const { BotBrain } = require('../shared/ai.js');

const GRACE_SEC = 30;

/** Look nhẹ nhàng ngẫu nhiên cho bot: chỉ phụ kiện + họa tiết vợt (màu giữ mặc định của nhân vật) */
function botLook(rand) {
  const r = rand || Math.random;
  const pick = (a) => a[Math.floor(r() * a.length)];
  const look = {};
  if (r() < 0.7) look.accessory = pick(LOOK.accessories.filter((a) => a !== 'crown' && a !== 'halo'));
  if (r() < 0.7) look.pattern = pick(LOOK.patterns);
  return look;
}

class MatchHost {
  /**
   * players: [{id, team, name, char, look, isBot}]
   * io: {send(pid, msg), now(), onFinish(host, overEvent)}
   */
  constructor(room, players, io) {
    this.id = crypto.randomBytes(6).toString('hex');
    this.room = room;
    this.io = io;
    this.players = players;
    this.teamSize = room.mode === '2v2' ? 2 : 1;
    this.settings = {
      venue: room.settings.venue, target: room.settings.target,
      scoring: room.settings.scoring === 'rally' ? 'rally' : 'sideout', teamSize: this.teamSize,
    };
    this.seed = crypto.randomBytes(4).readUInt32LE(0);
    this.match = new Match({ teamSize: this.teamSize, target: this.settings.target, scoring: this.settings.scoring,
      venue: this.settings.venue, seed: this.seed, grace: C.GRACE_ONLINE, players: players.map((p) => ({ id: p.id, team: p.team })) });
    this.bots = new Map();
    this.hadBots = false;
    players.filter((p) => p.isBot).forEach((p, i) => this.addBot(p, i));
    this.spectators = new Set();
    this.lastInput = new Map();
    this.swing = new Map();
    this.botSwing = new Map();   // id -> serveAt đã phát
    this.announced = new WeakSet(); // intent của bot đã phát 'swing'
    this.swingAt = new Map();    // id -> lần cuối người chơi gửi swing (giới hạn tần suất)
    this.disconnected = new Map();
    this.over = false;
    this.overEvent = null;
    this.lastTick = io.now();
    for (const p of players) if (!p.isBot) this.sendStart(p.id, p.team);
    this.match.start(io.now());
    this.flush();
  }

  addBot(p, i) {
    p.isBot = true;
    this.hadBots = true;
    const mp = this.match.player(p.id);
    this.bots.set(p.id, new BotBrain(mp, this.room.botLevel || 'pro', Physics.mulberry32(this.seed + 17 * (i + 1))));
  }

  publicPlayers() { return this.players.map((p) => ({ id: p.id, team: p.team, name: p.name, char: p.char, look: p.look || {}, isBot: !!p.isBot })); }
  humans() { return this.players.filter((p) => !p.isBot); }
  isPlayer(pid) { return this.players.some((p) => p.id === pid && !p.isBot); }

  sendStart(pid, team) {
    this.io.send(pid, { t: 'match_start', matchId: this.id, seed: this.seed, settings: this.settings, players: this.publicPlayers(), yourTeam: team || null });
  }
  sendSync(pid) { this.io.send(pid, { t: 'sync', matchId: this.id, snapshot: this.match.snapshot() }); }

  broadcast(msg) {
    for (const p of this.players) if (!p.isBot) this.io.send(p.id, msg);
    for (const s of this.spectators) this.io.send(s, msg);
  }

  tick(now) {
    const dt = Math.min(0.1, now - this.lastTick);
    this.lastTick = now;
    if (this.over) return;
    this.checkGrace(now);
    if (this.over) return;
    this.match.update(now);
    for (const [id, b] of this.bots) {
      const h = b.tick(dt, now, this.match);
      if (b.swing !== this.swing.get(id)) this.swing.set(id, b.swing);
      this.announceBotSwing(id, b);
      if (h) this.match.tryHit(id, h, now, false);
    }
    this.flush();
  }

  /** Bot có ý định đánh mới (hoặc lịch giao bóng mới) → phát 'swing' để client chạy hoạt ảnh đúng lúc */
  announceBotSwing(id, b) {
    // intent hiện tại, hoặc intent vừa đặt và dùng ngay trong cùng tick (phát muộn vẫn hơn không)
    const it = b.intent || b.lastIntent;
    if (it && !this.announced.has(it)) {
      this.announced.add(it);
      this.broadcast({ t: 'swing', matchId: this.id, id, contactT: it.t, x: it.x, y: it.y, z: it.z, zone: it.zone });
    } else if (b.serveAt !== Infinity && this.botSwing.get(id) !== b.serveAt) {
      this.botSwing.set(id, b.serveAt);
      const p = b.p, dir = p.team === 'A' ? -1 : 1;
      this.broadcast({ t: 'swing', matchId: this.id, id, contactT: b.serveAt, x: p.x, y: C.SERVE_Y, z: p.z + dir * C.SERVE_FWD, zone: 'serve' });
    }
  }

  /** Người chơi báo trước cú vung → chuyển cho người khác trong trận + khán giả */
  onSwing(pid, m, now) {
    if (this.over || !this.isPlayer(pid)) return;
    const ph = this.match.phase;
    const serving = ph === 'serve' && this.match.serverId === pid && m.zone === 'serve';
    if (ph !== 'rally' && !serving) return;
    if (m.contactT < now - 0.5 || m.contactT > now + 1.5) return;
    const last = this.swingAt.get(pid);
    if (last !== undefined && now - last < 0.15) return;
    this.swingAt.set(pid, now);
    const msg = { t: 'swing', matchId: this.id, id: pid, contactT: m.contactT, x: m.x, y: m.y, z: m.z, zone: m.zone };
    for (const p of this.players) if (!p.isBot && p.id !== pid) this.io.send(p.id, msg);
    for (const s of this.spectators) this.io.send(s, msg);
  }

  flush() {
    for (const e of this.match.drain()) {
      e.matchId = this.id;
      this.broadcast(e);
      if (e.t === 'over') this.finish(e);
    }
  }

  broadcastState(now) {
    if (this.over) return;
    const r = (v) => Math.round(v * 1000) / 1000;
    this.broadcast({
      t: 'state', matchId: this.id, ts: r(now),
      players: this.match.players.map((p) => ({ id: p.id, x: r(p.x), z: r(p.z), vx: r(p.vx), vz: r(p.vz), sw: this.swing.get(p.id) || 0 })),
    });
  }

  onInput(pid, m, now) {
    if (this.over || !this.isPlayer(pid)) return;
    const p = this.match.player(pid);
    if (!p) return;
    this.swing.set(pid, m.sw);
    if (m.rid !== this.match.rallyId) return; // input cũ trước serve_setup
    const sg = p.team === 'A' ? 1 : -1;
    let x = Physics.clamp(m.x, -C.BOUND_X, C.BOUND_X);
    let z = Physics.clamp(m.z * sg, C.NET_GAP, C.BOUND_BACK) * sg;
    // "ngân sách di chuyển": tích lũy theo thời gian để chịu được input tới dồn cục do jitter mạng
    const last = this.lastInput.get(pid) || { t: now - 0.05, budget: 0.5 };
    const budget = Math.min(2.5, last.budget + C.PLAYER_SPEED * 1.35 * Math.max(0, now - last.t));
    const maxD = budget + 0.3;
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d > maxD) { x = p.x + dx / d * maxD; z = p.z + dz / d * maxD; }
    this.lastInput.set(pid, { t: now, budget: Math.max(0, budget - Math.min(d, maxD)) });
    this.match.setPlayerState(pid, x, z, Physics.clamp(m.vx, -8, 8), Physics.clamp(m.vz, -8, 8));
  }

  onHit(pid, m, now) {
    if (this.over || !this.isPlayer(pid)) return;
    const r = this.match.tryHit(pid, m, now, true);
    if (!r.ok) this.io.send(pid, { t: 'hit_rejected', matchId: this.id, launchId: m.launchId, reason: r.reason });
    this.flush();
  }

  addSpectator(pid) {
    this.spectators.add(pid);
    this.sendStart(pid, null);
    this.sendSync(pid);
  }
  removeSpectator(pid) { this.spectators.delete(pid); }

  onDisconnect(pid, now) {
    if (this.over || !this.isPlayer(pid)) return;
    this.disconnected.set(pid, now + GRACE_SEC);
    this.match.pause();
    this.flush();
    this.broadcast({ t: 'player_status', id: pid, connected: false, graceSec: GRACE_SEC });
  }

  onReconnect(pid, now) {
    if (!this.isPlayer(pid)) return;
    const p = this.players.find((q) => q.id === pid);
    this.sendStart(pid, p.team);
    if (this.over) { this.io.send(pid, Object.assign({}, this.overEvent)); return; }
    this.sendSync(pid);
    if (this.disconnected.delete(pid)) {
      this.broadcast({ t: 'player_status', id: pid, connected: true });
      if (this.disconnected.size === 0) { this.match.resume(now); this.flush(); }
    }
  }

  /** Người chơi rời trận (chủ động hoặc hết thời gian chờ) */
  leave(pid, now) {
    if (this.over || !this.isPlayer(pid)) return;
    this.disconnected.delete(pid);
    const p = this.players.find((q) => q.id === pid);
    if (this.teamSize === 2 && this.room.fillBots) {
      const def = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
      p.name = 'Bot ' + def.name;
      this.addBot(p, this.players.indexOf(p));
      this.broadcast({ t: 'player_replaced', id: pid, name: p.name });
      if (this.disconnected.size === 0) { this.match.resume(now); this.flush(); }
      return;
    }
    // không có bot thay thế -> cả đội bị xử thua
    this.match.forfeit(p.team);
    this.flush();
  }

  checkGrace(now) {
    for (const [pid, deadline] of this.disconnected) {
      if (now >= deadline) this.leave(pid, now);
      if (this.over) return;
    }
  }

  finish(e) {
    if (this.over) return;
    this.over = true;
    this.overEvent = e;
    this.io.onFinish(this, e);
  }

  liveInfo() {
    const names = (t) => this.players.filter((p) => p.team === t).map((p) => p.name);
    return { matchId: this.id, a: names('A'), b: names('B'), score: Object.assign({}, this.match.score), viewers: this.spectators.size };
  }
}

module.exports = { MatchHost, botLook };
