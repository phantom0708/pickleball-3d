'use strict';
/* Sảnh: người chơi, phòng, hàng chờ ghép trận, khán giả */
const crypto = require('crypto');
const { Protocol } = require('../shared/protocol.js');
const { CHARACTERS, VENUES } = require('../shared/config.js');
const { MatchHost, botLook } = require('./matchHost.js');

const ROOM_IDLE_MS = 10 * 60 * 1000;
const EMPTY_ROOM_MS = 60 * 1000;
const MEMBER_GONE_MS = 60 * 1000;
const CLIENT_FORGET_MS = 15 * 60 * 1000;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

class Lobby {
  constructor({ store, now, log }) {
    this.store = store;
    this.now = now;
    this.log = log || (() => {});
    this.clients = new Map();   // pid -> client
    this.byDevice = new Map();  // deviceId -> client
    this.rooms = new Map();     // code -> room
    this.queues = { '1v1': [], '2v2': [] };
    this.matches = new Map();   // matchId -> MatchHost
  }

  /* ---------- tiện ích ---------- */
  send(pid, msg) {
    const c = this.clients.get(pid);
    if (c && c.conn) c.conn.send(msg);
  }
  err(c, code, message) { if (c.conn) c.conn.send({ t: 'error', code, message }); }
  broadcastAll(msg) { for (const c of this.clients.values()) if (c.conn) c.conn.send(msg); }
  genCode() {
    const A = Protocol.ROOM_ALPHABET;
    for (let i = 0; i < 1000; i++) {
      let s = '';
      for (let k = 0; k < 4; k++) s += A[crypto.randomInt(A.length)];
      if (!this.rooms.has(s)) return s;
    }
    throw new Error('hết mã phòng');
  }
  stats() {
    let online = 0;
    for (const c of this.clients.values()) if (c.conn) online++;
    let active = 0;
    for (const h of this.matches.values()) if (!h.over) active++;
    return { rooms: this.rooms.size, matches: active, players: online };
  }

  /* ---------- kết nối ---------- */
  onMessage(conn, m) {
    if (m.t === 'ping') { conn.send({ t: 'pong', c: m.c, s: this.now() }); return; }
    if (m.t === 'hello') { this.onHello(conn, m); return; }
    const c = conn.client;
    if (!c) return;
    c.lastSeen = Date.now();
    const room = c.room ? this.rooms.get(c.room) : null;
    if (room) room.lastActive = Date.now();
    switch (m.t) {
      case 'set_profile': {
        const name = Protocol.cleanName(m.name);
        if (name.length >= 2) c.name = name;
        c.char = m.char;
        if (m.look !== undefined) c.look = Protocol.cleanLook(m.look);
        this.store.rename(c.deviceId, c.name);
        if (room) this.sendRoomState(room);
        break;
      }
      case 'queue_join': this.queueJoin(c, m.mode); break;
      case 'queue_leave': this.queueLeave(c, true); break;
      case 'room_create': this.roomCreate(c, m); break;
      case 'room_join': this.roomJoin(c, m.code.toUpperCase()); break;
      case 'room_leave': this.leaveRoom(c); break;
      case 'room_update': if (room) this.roomUpdate(c, room, m); break;
      case 'room_ready': if (room) { const mem = room.members.find((x) => x.pid === c.pid); if (mem) { mem.ready = m.ready; this.sendRoomState(room); } } break;
      case 'room_start':
        if (!room) break;
        if (room.hostId !== c.pid) { this.err(c, 'not_host', 'Chỉ chủ phòng mới bắt đầu được'); break; }
        this.startRoomMatch(room, c);
        break;
      case 'chat': this.chat(c, room, m.text); break;
      case 'input': if (room && room.host) room.host.onInput(c.pid, m, this.now()); break;
      case 'hit': if (room && room.host) room.host.onHit(c.pid, m, this.now()); break;
      case 'swing': if (room && room.host) room.host.onSwing(c.pid, m, this.now()); break;
      case 'rematch': if (room) this.rematch(c, room); break;
      case 'list_live': c.conn.send({ t: 'live_list', matches: this.liveList() }); break;
      case 'spectate': this.spectate(c, m.matchId); break;
      case 'spectate_leave': this.stopSpectate(c); break;
      case 'leaderboard': c.conn.send({ t: 'leaderboard', top: this.store.top(20) }); break;
    }
  }

  onHello(conn, m) {
    if (m.version !== Protocol.PROTOCOL_VERSION) {
      conn.send({ t: 'error', code: 'version', message: 'Phiên bản game đã cũ, hãy tải lại trang.' });
      conn.close(4000, 'version');
      return;
    }
    let name = Protocol.cleanName(m.name);
    if (name.length < 2) name = 'Người chơi';
    let c = this.byDevice.get(m.deviceId);
    if (c) {
      if (c.conn && c.conn !== conn) {
        const old = c.conn;
        c.conn = null;
        old.send({ t: 'error', code: 'replaced', message: 'Bạn đã mở game ở một tab khác.' });
        old.close(4001, 'replaced');
      }
      c.conn = conn; c.name = name; c.char = m.char;
      if (m.look !== undefined) c.look = Protocol.cleanLook(m.look);
    } else {
      c = { pid: crypto.randomBytes(5).toString('hex'), deviceId: m.deviceId, name, char: m.char, look: Protocol.cleanLook(m.look), conn,
        room: null, queue: null, spectating: null, chatAt: 0, lastSeen: Date.now() };
      this.clients.set(c.pid, c);
      this.byDevice.set(m.deviceId, c);
    }
    c.lastSeen = Date.now();
    conn.client = c;
    conn.send({ t: 'welcome', playerId: c.pid, serverTime: this.now() });
    if (c.room) {
      const r = this.rooms.get(c.room);
      const mem = r && r.members.find((x) => x.pid === c.pid);
      if (!mem) { c.room = null; return; }
      mem.connected = true;
      this.sendRoomState(r);
      if (r.host && r.host.isPlayer(c.pid)) r.host.onReconnect(c.pid, this.now());
    }
  }

  onClose(conn) {
    const c = conn.client;
    if (!c || c.conn !== conn) return;
    c.conn = null;
    c.lastSeen = Date.now();
    this.queueLeave(c, false);
    this.stopSpectate(c);
    const room = c.room ? this.rooms.get(c.room) : null;
    if (room) {
      const mem = room.members.find((x) => x.pid === c.pid);
      if (mem) mem.connected = false;
      if (room.host && !room.host.over && room.host.isPlayer(c.pid)) room.host.onDisconnect(c.pid, this.now());
      this.sendRoomState(room);
    }
  }

  /* ---------- hàng chờ ---------- */
  queueJoin(c, mode) {
    if (c.room) this.leaveRoom(c);
    this.queueLeave(c, false);
    this.queues[mode].push(c.pid);
    c.queue = mode;
    this.sendQueue(mode);
    this.tryQueue(mode);
  }
  queueLeave(c, notify) {
    if (!c.queue) return;
    const mode = c.queue;
    this.queues[mode] = this.queues[mode].filter((p) => p !== c.pid);
    c.queue = null;
    if (notify && c.conn) c.conn.send({ t: 'queue_status', mode, waiting: false });
    this.sendQueue(mode);
  }
  sendQueue(mode) {
    const q = this.queues[mode];
    for (const pid of q) this.send(pid, { t: 'queue_status', mode, waiting: true, count: q.length });
  }
  tryQueue(mode) {
    const need = mode === '1v1' ? 2 : 4;
    const q = this.queues[mode] = this.queues[mode].filter((p) => { const c = this.clients.get(p); return c && c.conn; });
    while (q.length >= need) {
      const group = q.splice(0, need).map((p) => this.clients.get(p));
      const room = this.newRoom(group[0], mode, { venue: pick(VENUES).id, target: 7, scoring: 'sideout' }, true);
      group.forEach((c, i) => { c.queue = null; this.addMember(room, c, i % 2 === 0 ? 'A' : 'B'); });
      this.startRoomMatch(room, null);
    }
    this.sendQueue(mode);
  }

  /* ---------- phòng ---------- */
  newRoom(host, mode, settings, quick) {
    const room = { code: this.genCode(), mode, hostId: host.pid, settings: Object.assign({}, settings),
      members: [], fillBots: false, botLevel: 'pro', quick: !!quick, host: null,
      lastActive: Date.now(), rematch: new Set(), chat: [] };
    this.rooms.set(room.code, room);
    this.log('room', room.code, mode, quick ? 'quick' : '');
    return room;
  }
  capacity(room) { return room.mode === '2v2' ? 4 : 2; }
  addMember(room, c, team) {
    const size = room.mode === '2v2' ? 2 : 1;
    if (!team) {
      const a = room.members.filter((m) => m.team === 'A').length;
      const b = room.members.filter((m) => m.team === 'B').length;
      team = a <= b && a < size ? 'A' : 'B';
    }
    room.members.push({ pid: c.pid, team, ready: false, connected: !!c.conn });
    c.room = room.code;
  }
  roomCreate(c, m) {
    this.queueLeave(c, false);
    if (c.room) this.leaveRoom(c);
    const room = this.newRoom(c, m.mode, m.settings, false);
    this.addMember(room, c);
    this.sysChat(room, `${c.name} đã tạo phòng`);
    this.sendRoomState(room);
  }
  roomJoin(c, code) {
    const room = this.rooms.get(code);
    if (!room) { this.err(c, 'room_not_found', 'Không tìm thấy phòng ' + code); return; }
    if (room.members.some((m) => m.pid === c.pid)) { this.sendRoomState(room); this.sendChatHistory(c, room); return; }
    if (room.host && !room.host.over) { this.err(c, 'room_busy', 'Phòng đang thi đấu. Bạn có thể xem trực tiếp trong sảnh.'); return; }
    if (room.members.length >= this.capacity(room)) { this.err(c, 'room_full', 'Phòng đã đủ người'); return; }
    this.queueLeave(c, false);
    if (c.room) this.leaveRoom(c);
    this.addMember(room, c);
    this.sysChat(room, `${c.name} đã vào phòng`);
    this.sendRoomState(room);
    this.sendChatHistory(c, room);
  }
  roomUpdate(c, room, m) {
    const inMatch = room.host && !room.host.over;
    if (inMatch || room.quick) return;
    const mem = room.members.find((x) => x.pid === c.pid);
    if (m.team && mem && room.mode === '2v2' && mem.team !== m.team) {
      if (room.members.filter((x) => x.team === m.team).length < 2) { mem.team = m.team; mem.ready = false; }
    }
    if (room.hostId === c.pid) {
      if (m.settings) room.settings = Object.assign({}, m.settings);
      if (typeof m.fillBots === 'boolean') room.fillBots = m.fillBots;
      if (m.botLevel) room.botLevel = m.botLevel;
      if (m.settings || m.fillBots !== undefined || m.botLevel) for (const x of room.members) if (x.pid !== room.hostId) x.ready = false;
    }
    this.sendRoomState(room);
  }
  leaveRoom(c) {
    const room = c.room ? this.rooms.get(c.room) : null;
    c.room = null;
    if (c.conn) c.conn.send({ t: 'room_left' });
    if (!room) return;
    if (room.host && !room.host.over && room.host.isPlayer(c.pid)) room.host.leave(c.pid, this.now());
    room.members = room.members.filter((m) => m.pid !== c.pid);
    room.rematch.delete(c.pid);
    if (!room.members.length) { this.closeRoom(room); return; }
    if (room.hostId === c.pid) room.hostId = room.members[0].pid;
    this.sysChat(room, `${c.name} đã rời phòng`);
    this.sendRoomState(room);
  }
  closeRoom(room) {
    for (const m of room.members) {
      const c = this.clients.get(m.pid);
      if (c && c.room === room.code) { c.room = null; if (c.conn) c.conn.send({ t: 'room_left' }); }
    }
    if (room.host) {
      if (!room.host.over) room.host.match.forfeit('A');
      this.matches.delete(room.host.id);
    }
    this.rooms.delete(room.code);
    this.log('room closed', room.code);
  }
  sendRoomState(room) {
    const msg = {
      t: 'room_state', code: room.code, mode: room.mode, hostId: room.hostId, settings: room.settings,
      fillBots: room.fillBots, botLevel: room.botLevel, quick: room.quick, inMatch: !!(room.host && !room.host.over),
      players: room.members.map((m) => {
        const c = this.clients.get(m.pid);
        return { id: m.pid, name: c ? c.name : '?', char: c ? c.char : 'bunny', look: (c && c.look) || {}, team: m.team, ready: m.ready, connected: !!(c && c.conn) };
      }),
    };
    for (const m of room.members) this.send(m.pid, msg);
  }
  sysChat(room, text) {
    const msg = { t: 'chat', sys: true, name: '', text };
    room.chat.push(msg); if (room.chat.length > 30) room.chat.shift();
    for (const m of room.members) this.send(m.pid, msg);
  }
  sendChatHistory(c, room) { for (const msg of room.chat) if (c.conn) c.conn.send(msg); }
  chat(c, room, text) {
    if (!room) return;
    const t = Date.now();
    if (t - c.chatAt < 1000) { this.err(c, 'rate_limit', 'Bạn chat nhanh quá, chờ chút nhé'); return; }
    c.chatAt = t;
    const clean = Protocol.cleanChat(text);
    if (!clean) return;
    const msg = { t: 'chat', name: c.name, text: clean };
    room.chat.push(msg); if (room.chat.length > 30) room.chat.shift();
    for (const m of room.members) this.send(m.pid, msg);
  }

  startRoomMatch(room, by) {
    if (room.host && !room.host.over) { if (by) this.err(by, 'busy', 'Trận đang diễn ra'); return; }
    const size = room.mode === '2v2' ? 2 : 1;
    const members = room.members.filter((m) => { const c = this.clients.get(m.pid); return c && c.conn; });
    const fail = (msg) => { if (by) this.err(by, 'cannot_start', msg); return null; };
    if (members.length !== room.members.length) return fail('Có người đang mất kết nối');
    if (room.mode === '1v1') {
      if (members.length < 2) return fail('Cần đủ 2 người chơi');
      if (members[0].team === members[1].team) members[1].team = members[0].team === 'A' ? 'B' : 'A';
    } else {
      if (members.length < 2) return fail('Cần ít nhất 2 người chơi');
      if (!room.fillBots && members.length < 4) return fail('Cần đủ 4 người, hoặc bật "Thêm bot vào chỗ trống"');
      for (const t of ['A', 'B']) if (members.filter((m) => m.team === t).length > 2) return fail('Mỗi đội tối đa 2 người');
    }
    if (by && !room.quick && members.some((m) => m.pid !== room.hostId && !m.ready)) return fail('Chờ mọi người bấm Sẵn sàng');

    const players = members.map((m) => { const c = this.clients.get(m.pid); return { id: m.pid, team: m.team, name: c.name, char: c.char, look: Object.assign({}, c.look), isBot: false }; });
    for (const t of ['A', 'B']) {
      let n = players.filter((p) => p.team === t).length;
      while (n < size) {
        const def = pick(CHARACTERS);
        players.push({ id: 'bot-' + crypto.randomBytes(3).toString('hex'), team: t, name: 'Bot ' + def.name, char: def.id, look: botLook(), isBot: true });
        n++;
      }
    }
    // sắp xếp để mỗi đội có thứ tự ổn định (người đầu tiên đứng bên phải)
    players.sort((a, b) => (a.team === b.team ? 0 : a.team < b.team ? -1 : 1));
    if (room.host) this.matches.delete(room.host.id);
    room.rematch.clear();
    for (const m of room.members) m.ready = false;
    const io = { send: (pid, msg) => this.send(pid, msg), now: this.now, onFinish: (h, e) => this.onMatchFinish(room, h, e) };
    room.host = new MatchHost(room, players, io);
    this.matches.set(room.host.id, room.host);
    room.lastActive = Date.now();
    this.log('match start', room.code, room.host.id, players.map((p) => p.name).join(','));
    this.sendRoomState(room);
    return room.host;
  }

  onMatchFinish(room, host, e) {
    this.log('match over', room.code, host.id, JSON.stringify(e.score), e.reason);
    if (!host.hadBots) {
      for (const p of host.players) {
        const c = this.clients.get(p.id);
        if (c) this.store.record(c.deviceId, c.name, p.team === e.winner);
      }
    }
    room.lastActive = Date.now();
    this.sendRoomState(room);
  }

  rematch(c, room) {
    if (!room.host || !room.host.over) return;
    room.rematch.add(c.pid);
    const humans = room.members.filter((m) => { const cc = this.clients.get(m.pid); return cc && cc.conn; });
    if (humans.every((m) => room.rematch.has(m.pid))) this.startRoomMatch(room, null);
    else this.sysChat(room, `${c.name} muốn đấu lại`);
  }

  /* ---------- khán giả ---------- */
  liveList() {
    const out = [];
    for (const h of this.matches.values()) if (!h.over) out.push(h.liveInfo());
    return out.slice(0, 30);
  }
  spectate(c, matchId) {
    const h = this.matches.get(matchId);
    if (!h || h.over) { this.err(c, 'no_match', 'Trận đấu đã kết thúc'); return; }
    if (h.isPlayer(c.pid)) return;
    this.stopSpectate(c);
    h.addSpectator(c.pid);
    c.spectating = h.id;
  }
  stopSpectate(c) {
    if (!c.spectating) return;
    const h = this.matches.get(c.spectating);
    if (h) h.removeSpectator(c.pid);
    c.spectating = null;
  }

  /* ---------- vòng lặp ---------- */
  tick() {
    const now = this.now();
    for (const h of this.matches.values()) if (!h.over) h.tick(now);
  }
  broadcastStates() {
    const now = this.now();
    for (const h of this.matches.values()) h.broadcastState(now);
  }
  housekeeping() {
    const t = Date.now();
    for (const room of [...this.rooms.values()]) {
      const active = room.host && !room.host.over;
      if (active) continue;
      for (const m of [...room.members]) {
        const c = this.clients.get(m.pid);
        if (!c || (!c.conn && t - c.lastSeen > MEMBER_GONE_MS)) { if (c) this.leaveRoom(c); else room.members = room.members.filter((x) => x !== m); }
      }
      if (!this.rooms.has(room.code)) continue;
      const anyConn = room.members.some((m) => { const c = this.clients.get(m.pid); return c && c.conn; });
      if (!room.members.length || (!anyConn && t - room.lastActive > EMPTY_ROOM_MS) || t - room.lastActive > ROOM_IDLE_MS) this.closeRoom(room);
    }
    for (const [id, h] of this.matches) if (h.over && (!h.room || h.room.host !== h)) this.matches.delete(id);
    for (const c of [...this.clients.values()]) {
      if (!c.conn && !c.room && t - c.lastSeen > CLIENT_FORGET_MS) { this.clients.delete(c.pid); this.byDevice.delete(c.deviceId); }
    }
  }
}

module.exports = { Lobby };
