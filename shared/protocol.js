/* Pickle Pop – giao thức online (JSON qua WebSocket) + kiểm tra dữ liệu */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const cfg = isNode ? require('./config.js') : root.PP;
  const mod = factory(cfg);
  if (isNode) module.exports = mod;
  else { root.PP = root.PP || {}; Object.assign(root.PP, mod); }
})(typeof self !== 'undefined' ? self : this, function (cfg) {
  'use strict';
  const PROTOCOL_VERSION = 2;
  const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const MODES = ['1v1', '2v2'];
  const TARGETS = [5, 7, 11];   // hiệp ngắn: chạm 5 / 7 / 11 (vẫn phải hơn 2 điểm)
  const SCORINGS = ['rally', 'sideout'];
  const SHOT_TYPES = ['drive', 'dink', 'drop', 'lob', 'smash', 'serve'];
  const ZONES = ['forehand', 'backhand', 'overhead', 'low', 'volley', 'serve'];
  const LEVEL_IDS = Object.keys(cfg.LEVELS);
  const VENUE_IDS = cfg.VENUES.map((v) => v.id);
  const CHAR_IDS = cfg.CHARACTERS.map((c) => c.id);
  const LOOK = cfg.LOOK || { patterns: [], accessories: [], shirtStyles: [], colorKeys: [], numberMax: 99 };
  const HEX_RE = /^#[0-9a-f]{6}$/i;

  const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  const isStr = (v, max, min) => typeof v === 'string' && v.length <= max && v.length >= (min || 0);
  const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  const vec2 = (o, r) => isObj(o) && isNum(o.x, -r, r) && isNum(o.z, -r, r);
  const vec3 = (o, r) => isObj(o) && isNum(o.x, -r, r) && isNum(o.y, -r, r) && isNum(o.z, -r, r);
  // look thô từ client: tùy chọn, phải là object nhỏ (≤ 16 khóa, chuỗi ngắn); cleanLook lọc chi tiết ở server
  const lookOk = (l) => {
    if (l === undefined) return true;
    if (!isObj(l)) return false;
    const keys = Object.keys(l);
    if (keys.length > 16) return false;
    for (const k of keys) {
      const v = l[k];
      if (k.length > 24) return false;
      if (typeof v === 'string' ? v.length > 24 : !(typeof v === 'number' || typeof v === 'boolean' || v === null)) return false;
    }
    return true;
  };
  const settingsOk = (s) => isObj(s) && VENUE_IDS.includes(s.venue) && TARGETS.includes(s.target) && SCORINGS.includes(s.scoring);

  const V = {
    hello: (m) => isStr(m.deviceId, 64, 8) && isStr(m.name, 40, 1) && CHAR_IDS.includes(m.char) && isInt(m.version, 0, 1e6) &&
      lookOk(m.look),
    ping: (m) => isNum(m.c, 0, 1e12),
    queue_join: (m) => MODES.includes(m.mode),
    queue_leave: () => true,
    room_create: (m) => MODES.includes(m.mode) && settingsOk(m.settings),
    room_join: (m) => isStr(m.code, 4, 4),
    room_leave: () => true,
    room_update: (m) => (m.settings === undefined || settingsOk(m.settings)) &&
      (m.team === undefined || m.team === 'A' || m.team === 'B') &&
      (m.fillBots === undefined || typeof m.fillBots === 'boolean') &&
      (m.botLevel === undefined || LEVEL_IDS.includes(m.botLevel)),
    room_ready: (m) => typeof m.ready === 'boolean',
    room_start: () => true,
    chat: (m) => isStr(m.text, 200, 1),
    input: (m) => isInt(m.rid, 0, 1e9) && isNum(m.x, -20, 20) && isNum(m.z, -20, 20) &&
      isNum(m.vx, -20, 20) && isNum(m.vz, -20, 20) && isInt(m.sw, 0, 1e9),
    hit: (m) => isNum(m.ballT, 0, 1e9) && vec2(m.pos, 20) && vec3(m.from, 20) && vec3(m.v, 60) &&
      SHOT_TYPES.includes(m.shot) && (m.serve === true || isInt(m.launchId, 0, 1e9)) &&
      (m.perfect === undefined || typeof m.perfect === 'boolean') &&
      (m.spin === undefined || isNum(m.spin, -300, 300)),
    // v2: báo trước cú vung (hoạt ảnh) – contactT là thời điểm trận dự kiến chạm bóng
    swing: (m) => isNum(m.contactT, 0, 1e9) && isNum(m.x, -20, 20) && isNum(m.y, -1, 10) && isNum(m.z, -20, 20) &&
      ZONES.includes(m.zone),
    rematch: () => true,
    list_live: () => true,
    spectate: (m) => isStr(m.matchId, 32, 1),
    spectate_leave: () => true,
    leaderboard: () => true,
    set_profile: (m) => isStr(m.name, 40, 1) && CHAR_IDS.includes(m.char) && lookOk(m.look),
  };

  function validate(m) {
    if (!isObj(m) || typeof m.t !== 'string') return false;
    const f = V[m.t];
    if (!f) return false;
    try { return f(m) === true; } catch (e) { return false; }
  }

  function cleanText(s, max) {
    return String(s).replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  }
  const cleanName = (s) => cleanText(s, 16);
  const cleanChat = (s) => cleanText(s, 120);

  /** Lọc look: chỉ giữ trường hợp lệ (hex #rrggbb, enum, number nguyên 0..99); không bao giờ ném lỗi */
  function cleanLook(o) {
    const out = {};
    try {
      if (!isObj(o)) return out;
      const own = (k) => Object.prototype.hasOwnProperty.call(o, k);
      for (const k of LOOK.colorKeys) {
        if (own(k) && typeof o[k] === 'string' && HEX_RE.test(o[k])) out[k] = o[k].toLowerCase();
      }
      if (own('pattern') && typeof o.pattern === 'string' && LOOK.patterns.includes(o.pattern)) out.pattern = o.pattern;
      if (own('accessory') && typeof o.accessory === 'string' && LOOK.accessories.includes(o.accessory)) out.accessory = o.accessory;
      if (own('shirtStyle') && typeof o.shirtStyle === 'string' && LOOK.shirtStyles.includes(o.shirtStyle)) out.shirtStyle = o.shirtStyle;
      if (own('number') && isInt(o.number, 0, LOOK.numberMax)) out.number = o.number;
    } catch (e) { return {}; }
    return out;
  }

  return { Protocol: { PROTOCOL_VERSION, ROOM_ALPHABET, MODES, TARGETS, SCORINGS, SHOT_TYPES, ZONES, validate, cleanName, cleanChat, cleanLook, lookOk, settingsOk } };
});
