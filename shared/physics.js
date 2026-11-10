/* Pickle Pop – vật lý bóng tất định (trình duyệt + Node)
 * Bóng được mô tả bằng một "launch": {id, from:{x,y,z}, v:{x,y,z}, spin, t0, wind:{x,z}, ...}
 * v2: lực cản bậc hai + Magnus (spin rad/s, + topspin) + nảy theo xoáy.
 * Vị trí ở thời điểm bất kỳ = mô phỏng lại từ launch với bước cố định SIM_DT.
 * Trong stepBall chỉ dùng + - * / và Math.sqrt để mọi máy cho kết quả giống hệt nhau.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const cfg = isNode ? require('./config.js') : root.PP;
  const mod = factory(cfg);
  if (isNode) module.exports = mod;
  else { root.PP = root.PP || {}; Object.assign(root.PP, mod); }
})(typeof self !== 'undefined' ? self : this, function (cfg) {
  'use strict';
  const { C, SHOTS, SERVES } = cfg;

  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function netHeightAt(x) {
    let t = (x < 0 ? -x : x) / C.NET_HALF;
    if (t > 1) t = 1;
    return C.NET_H + (C.NET_POST_H - C.NET_H) * t * t;
  }

  /** Trục xoáy (ngang, vuông góc hướng bay ngang lúc rời vợt): ω̂ = (dz, 0, −dx) ⇒ topspin chúc xuống */
  function spinAxis(vx, vz) {
    const h = Math.sqrt(vx * vx + vz * vz);
    if (h < 1e-6) return { wx: 0, wz: 0 };
    return { wx: vz / h, wz: -vx / h };
  }

  /** Tích phân một bước bay tự do (gió + trọng lực + cản + Magnus). Chỉ + − × ÷ sqrt. */
  function integrate(b, dt, wind) {
    const vx = b.vx, vy = b.vy, vz = b.vz;
    const kd = C.DRAG_K * Math.sqrt(vx * vx + vy * vy + vz * vz);
    const s = C.MAGNUS_K * b.spin;
    const a = b.wx, c = b.wz;
    // ω̂ × v với ω̂ = (a, 0, c)
    b.vx = vx + (wind.x - kd * vx - s * c * vy) * dt;
    b.vy = vy + (-C.G - kd * vy + s * (c * vx - a * vz)) * dt;
    b.vz = vz + (wind.z - kd * vz + s * a * vy) * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  }

  /** Một bước mô phỏng. ev: mảng nhận sự kiện {type:'net'|'bounce', x, z} */
  function stepBall(b, dt, wind, ev) {
    const pz = b.z;
    integrate(b, dt, wind);
    const ax = b.x < 0 ? -b.x : b.x;
    if (!b.netHit && ((pz > 0) !== (b.z > 0)) && ax < C.NET_HALF) {
      const nh = netHeightAt(b.x);
      if (b.y - C.R < nh) {
        b.netHit = true;
        if (b.y - C.R >= nh - 0.09) {
          // chạm dải băng trên đỉnh lưới: bóng bật lên, mất tốc và lật qua sân bên kia -> vẫn tiếp tục chơi
          b.y = nh + C.R + 0.01;
          b.vz *= 0.45; b.vx *= 0.7;
          b.vy = (b.vy > 0 ? b.vy : -b.vy) * 0.3 + 0.9;
          b.spin *= 0.3;
          ev.push({ type: 'netcord', x: b.x, z: b.z });
        } else {
          // đập vào thân lưới: bóng rơi lại sân người đánh
          b.z = pz > 0 ? C.R + 0.02 : -C.R - 0.02;
          b.vz *= -0.15; b.vx *= 0.3;
          b.vy = (b.vy < 0 ? b.vy : 0) * 0.3;
          b.spin *= 0.2;
          ev.push({ type: 'net', x: b.x, z: b.z });
        }
      }
    }
    if (b.y < C.R && b.vy < 0) {
      b.y = C.R;
      const impact = -b.vy;
      let sn = b.spin / C.SPIN_REF;
      if (sn > 1) sn = 1; else if (sn < -1) sn = -1;
      // topspin: nảy thấp & trườn tới; backspin: nảy cao hơn chút & khựng lại
      b.vy = impact > 0.6 ? impact * (0.65 - 0.03 * sn) : 0;
      const r = 0.75 + 0.1 * sn;
      b.vx *= r; b.vz *= r;
      b.spin *= 0.35;
      if (impact > 0.3) ev.push({ type: 'bounce', x: b.x, z: b.z });
    }
  }

  function makeBall(from, v, spin) {
    const ax = spinAxis(v.x, v.z);
    return { x: from.x, y: from.y, z: from.z, vx: v.x, vy: v.y, vz: v.z,
      spin: spin || 0, wx: ax.wx, wz: ax.wz, netHit: false };
  }

  class BallSim {
    constructor(launch) {
      this.launch = launch;
      this.wind = launch.wind || { x: 0, z: 0 };
      this.b = makeBall(launch.from, launch.v, launch.spin);
      this.n = 0;          // số bước đã chạy
      this.bounces = 0;
      this.netAt = null;
    }
    get t() { return this.n * C.SIM_DT; }
    /** Chạy tới thời gian mô phỏng simT (giây). out: mảng nhận sự kiện có kèm t, n */
    advanceTo(simT, out) {
      const target = Math.floor(simT / C.SIM_DT + 1e-7);
      let guard = 0;
      while (this.n < target && guard++ < 20000) {
        const ev = [];
        stepBall(this.b, C.SIM_DT, this.wind, ev);
        this.n++;
        for (const e of ev) {
          e.t = this.n * C.SIM_DT;
          if (e.type === 'bounce') { this.bounces++; e.n = this.bounces; }
          else if (e.type === 'net') this.netAt = e.t;
          if (out) out.push(e);
        }
      }
      return this;
    }
  }

  function simTimeOf(launch, now) { return (now - launch.t0) * C.TIME_SCALE; }

  /** Trạng thái bóng ở thời gian mô phỏng simT */
  function stateAt(launch, simT) {
    const s = new BallSim(launch).advanceTo(simT);
    return { b: Object.assign({}, s.b), bounces: s.bounces, net: s.netAt !== null };
  }

  /** Dự đoán: từ simT hiện tại, mẫu mỗi 2 bước, tối đa horizon giây mô phỏng */
  function predict(launch, fromSimT, horizon) {
    const s = new BallSim(launch).advanceTo(fromSimT);
    const samples = [];
    let first = null, net = false;
    const startN = s.n, maxN = startN + Math.floor(horizon / C.SIM_DT);
    while (s.n < maxN) {
      const ev = [];
      s.advanceTo((s.n + 2) * C.SIM_DT, ev);
      for (const e of ev) {
        if (e.type === 'net') net = true;
        if (e.type === 'bounce' && !first) first = e;
      }
      if (net) break;
      samples.push({ t: (s.n - startN) * C.SIM_DT, x: s.b.x, y: s.b.y, z: s.b.z, bounces: s.bounces });
      if (s.bounces >= 2) break;
    }
    return { samples, first, net };
  }

  const landingCache = new WeakMap();
  /** Điểm nảy đầu tiên của một launch (có cache) – null nếu vào lưới */
  function firstBounce(launch) {
    if (landingCache.has(launch)) return landingCache.get(launch);
    const s = new BallSim(launch);
    let res = null;
    const maxN = Math.floor(6 / C.SIM_DT);
    while (s.n < maxN) {
      const ev = [];
      s.advanceTo((s.n + 1) * C.SIM_DT, ev);
      let stop = false;
      for (const e of ev) {
        if (e.type === 'net') { stop = true; break; }
        if (e.type === 'bounce') { res = { x: e.x, z: e.z, t: e.t }; stop = true; break; }
      }
      if (stop) break;
    }
    landingCache.set(launch, res);
    return res;
  }

  /** Bay tự do n bước (không nảy/lưới); ghi lại độ cao khi qua mặt phẳng lưới và đỉnh quỹ đạo */
  function flyFree(from, v, spin, wind, n) {
    const b = makeBall(from, v, spin);
    let netY = null, netX = 0, apex = b.y;
    for (let i = 0; i < n; i++) {
      const pz = b.z;
      integrate(b, C.SIM_DT, wind);
      if (b.y > apex) apex = b.y;
      if (netY === null && (pz > 0) !== (b.z > 0)) { netY = b.y; netX = b.x; }
    }
    return { b, netY, netX, apex };
  }

  const NO_WIND = { x: 0, z: 0 };
  const lim = (v, a, b) => (v < a ? a : v > b ? b : v);

  /** Shooting method: tìm v để sau đúng thời gian T (giây mô phỏng) bóng chạm mặt sân tại `to` */
  function solveFixedT(from, to, T, spin, wind) {
    const n = Math.max(2, Math.round(T / C.SIM_DT));
    const Tn = n * C.SIM_DT;
    let vx = (to.x - from.x) / Tn, vz = (to.z - from.z) / Tn;
    let vy = (C.R - from.y + 0.5 * C.G * Tn * Tn) / Tn;
    let jx = Tn, jy = Tn, jz = Tn, prev = null, res = null;
    for (let it = 0; it < 10; it++) {
      res = flyFree(from, { x: vx, y: vy, z: vz }, spin, wind, n);
      const p = res.b;
      const ex = to.x - p.x, ey = C.R - p.y, ez = to.z - p.z;
      if (ex * ex + ey * ey + ez * ez < 1e-5) break;
      if (prev) {
        const dx = vx - prev.vx, dy = vy - prev.vy, dz = vz - prev.vz;
        if (Math.abs(dx) > 1e-7) jx = lim((p.x - prev.x) / dx, 0.2 * Tn, 1.5 * Tn);
        if (Math.abs(dy) > 1e-7) jy = lim((p.y - prev.y) / dy, 0.2 * Tn, 1.5 * Tn);
        if (Math.abs(dz) > 1e-7) jz = lim((p.z - prev.z) / dz, 0.2 * Tn, 1.5 * Tn);
      }
      prev = { vx, vy, vz, x: p.x, y: p.y, z: p.z };
      vx += ex / jx; vy += ey / jy; vz += ez / jz;
    }
    return { v: { x: vx, y: vy, z: vz }, res: flyFree(from, { x: vx, y: vy, z: vz }, spin, wind, n) };
  }

  /**
   * Giải vận tốc để bóng đi từ from tới to (mặt sân) trong T giây mô phỏng, có cản + xoáy (+ gió nếu truyền),
   * qua lưới với khoảng hở ≥ clear (không đạt thì tăng T). Trả về {x,y,z}.
   */
  function solveShot(from, to, T, clear, spin, wind) {
    return solveShotEx(from, to, T, clear, spin, wind).v;
  }
  function solveShotEx(from, to, T, clear, spin, wind) {
    spin = spin || 0; wind = wind || NO_WIND;
    let r = null;
    for (let i = 0; i < 8; i++) {
      r = solveFixedT(from, to, T, spin, wind);
      if (clear === undefined || clear === null || r.res.netY === null) break;
      if (r.res.netY < netHeightAt(r.res.netX) + C.R + clear) { T *= 1.1; continue; }
      break;
    }
    return { v: r.v, T, apex: r.res.apex, netY: r.res.netY, netX: r.res.netX };
  }

  /** Thời gian bay (không cản) để đạt đỉnh h rồi rơi xuống mặt sân */
  function timeForApex(y0, h) {
    if (h < y0 + 0.03) h = y0 + 0.03;
    return Math.sqrt(2 * (h - y0) / C.G) + Math.sqrt(2 * (h - C.R) / C.G);
  }

  /** Khoảng spin hợp lệ cho một loại cú (server kẹp spin của client vào đây) */
  function spinLimits(shot) {
    if (shot === 'serve') return [-30, 40];
    const sh = SHOTS[shot] || SHOTS.drive;
    const a = sh.spin * 1.5;
    return [Math.min(0, a) - 10, Math.max(0, a) + 10];
  }
  function defaultSpin(shot) {
    if (shot === 'serve') return SERVES.drive.spin;
    return (SHOTS[shot] || SHOTS.drive).spin;
  }

  /** Giải một cú theo hình dạng: apex (m) hoặc speed (smash), giữ dưới vmax */
  function shapeShot(from, to, sh, opt) {
    const d = Math.sqrt((to.x - from.x) * (to.x - from.x) + (to.z - from.z) * (to.z - from.z));
    let T;
    const pw = (opt.power || 0) * (sh.charge || 0);   // lực tích (0..1) × độ nhạy của loại cú
    if (sh.speed) {
      T = d / (sh.speed * (opt.fast ? 1.12 : 1) * (1 + pw));
      if (T < 0.12) T = 0.12;
    } else {
      let apex = sh.apex + (sh.apexB || 0) * d;
      if (sh.apexUp && apex < from.y + sh.apexUp) apex = from.y + sh.apexUp;
      apex += opt.apexAdd || 0;
      if (opt.fast) apex = C.NET_H + (apex - C.NET_H) * 0.82;
      if (pw) apex = C.NET_H + (apex - C.NET_H) * (1 - pw);   // đánh mạnh: quỹ đạo thấp, bóng nhanh
      T = timeForApex(from.y, apex);
    }
    const Tbase = T;
    let r = null;
    for (let i = 0; i < 4; i++) {
      r = solveShotEx(from, to, T, opt.clear, opt.spin, opt.wind);
      if (!opt.vmax || speedOf(r.v) <= opt.vmax * 0.97) break;
      T = r.T * 1.12;
    }
    if (opt.vmax && speedOf(r.v) > opt.vmax * 0.97) {
      // hiếm: quét T tìm cú chậm nhất còn qua lưới; vẫn quá nhanh thì giảm tốc (bóng rơi ngắn)
      let best = null, bestSp = Infinity, any = r, anySp = speedOf(r.v);
      for (let k = 0; k < 10; k++) {
        const rr = solveShotEx(from, to, Tbase * (0.6 + 0.2 * k), null, opt.spin, opt.wind);
        const okNet = rr.netY === null || opt.clear === null || opt.clear === undefined ||
          rr.netY >= netHeightAt(rr.netX) + C.R + opt.clear;
        const sp = speedOf(rr.v);
        if (okNet && sp < bestSp) { best = rr; bestSp = sp; }
        if (sp < anySp) { any = rr; anySp = sp; }
      }
      if (!best || bestSp > opt.vmax * 0.99) { best = any; bestSp = anySp; }
      r = best;
      if (bestSp > opt.vmax * 0.99) {
        const k = opt.vmax * 0.99 / bestSp;
        return { x: r.v.x * k, y: r.v.y * k, z: r.v.z * k };
      }
    }
    return r.v;
  }

  /**
   * Tính cú đánh.
   * o = {team:'A'|'B', type, ball:{x,y,z}, aim:{x,z}, quality, perfect, errBase, rng, wind?}
   * aim.x: -1..1 theo trục x thế giới; aim.z: -1..1 (+ = sâu hơn)
   * → {type, from, v, spin}
   */
  function computeShot(o) {
    const dir = o.team === 'A' ? -1 : 1;
    let type = o.type;
    if (!SHOTS[type]) type = 'drive';
    if (type === 'smash' && o.ball.y < 1.3) type = 'drive';
    if (type === 'dink' && Math.abs(o.ball.z) > 4) type = 'drop'; // "dink" từ cuối sân = drop
    const sh = SHOTS[type];
    const from = { x: o.ball.x, y: Math.max(o.ball.y, 0.12), z: o.ball.z };
    const short = type === 'dink' || type === 'drop';
    const power = clamp(o.power || 0, 0, 1);
    let depth = sh.depth + clamp(o.aim.z || 0, -1, 1) * (short ? 0.6 : 1.0) + (short ? 0 : 0.45 * power);
    depth = clamp(depth, 0.5, 7.2);
    let tx = clamp(o.aim.x || 0, -1, 1) * 2.5;
    let tz = dir * depth;
    const q = clamp(o.quality === undefined ? 0.7 : o.quality, 0, 1);
    const err = o.perfect ? 0 : o.errBase * (1 - q) * (short ? 0.6 : 1) * (1 + 0.7 * power);   // mạnh thì dễ lệch
    tx += gauss(o.rng) * err;
    tz += gauss(o.rng) * err * 1.1;
    if (tz * dir < 0.3) tz = dir * 0.3; // sai số không kéo điểm rơi về sân mình (đánh hỏng thì vào lưới)
    let clear = sh.clear, apexAdd = 0;
    if (!o.perfect && q < 0.35 && o.rng() < 0.35) { clear = -0.35; apexAdd = -(0.15 + 0.4 * o.rng()); }
    const spin = sh.spin * (o.perfect ? 1.15 : 0.8 + 0.3 * q);
    const v = shapeShot(from, { x: tx, z: tz }, sh, { clear, apexAdd, spin, power, fast: !!o.perfect && (type === 'drive' || type === 'smash'), vmax: sh.vmax, wind: o.wind });
    return { type, from, v, spin };
  }

  /** Giao bóng tay dưới. o = {team, type, pos:{x,z}, boxSign, aimX, errBase, rng, wind?} → {type, from, v, spin} */
  function serveShot(o) {
    const dir = o.team === 'A' ? -1 : 1;
    const type = SERVES[o.type] ? o.type : 'drive';
    const sv = SERVES[type];
    const from = { x: o.pos.x, y: C.SERVE_Y, z: o.pos.z + dir * C.SERVE_FWD };
    const box = o.boxSign;
    let tx = box * 1.5 + clamp(o.aimX || 0, -1, 1) * 1.0;
    tx = box > 0 ? clamp(tx, 0.3, 2.8) : clamp(tx, -2.8, -0.3);
    const power = clamp(o.power || 0, 0, 1);
    let tz = dir * (sv.depth + 0.4 * power);
    tx += gauss(o.rng) * o.errBase * (1 + 0.6 * power);
    tz += gauss(o.rng) * o.errBase * (1 + 0.6 * power);
    const v = shapeShot(from, { x: tx, z: tz }, { apex: sv.apex, charge: 0.3 }, { clear: 0.3, spin: sv.spin, power, vmax: cfg.SERVE_VMAX, wind: o.wind });
    return { type, from, v, spin: sv.spin };
  }

  /**
   * Dự đoán điểm chạm sớm nhất (xem docs/V2_CONTRACTS.md).
   * player = {x, z, team}; opts = {maxAhead, reach, maxY, avoidKitchenVolley, noVolley, volleyOnly}
   * → null | {t, ball:{x,y,z}, simT, bounces, dist, atEdge}
   * atEdge = true khi cửa sổ maxAhead cắt ngang lúc bóng vẫn đang tới gần (điểm gần nhất thật còn ở sau) –
   * gọi lại ở khung sau sẽ cho điểm chạm muộn hơn, gần hơn.
   */
  function predictContact(launch, now, player, opts) {
    opts = opts || {};
    const maxAhead = opts.maxAhead != null ? opts.maxAhead : C.CONTACT_MAX_AHEAD;
    const reach = opts.reach != null ? opts.reach : C.REACH + C.ASSIST;
    const maxY = opts.maxY || 2.4, minY = 0.08;
    const sg = player.team === 'A' ? 1 : -1;
    const mustBounce = launch.hits <= 2;
    const noVolley = !!opts.noVolley || (!!opts.avoidKitchenVolley && Math.abs(player.z) < C.K + (C.KITCHEN_FOOT || 0));
    const s = new BallSim(launch);
    let simNow = simTimeOf(launch, now);
    if (simNow < 0) simNow = 0;
    s.advanceTo(simNow);
    const endN = s.n + Math.floor(maxAhead * C.TIME_SCALE / C.SIM_DT);
    let best = null, edge = false;
    const ev = [];
    while (true) {
      if (s.netAt !== null || s.bounces >= 2) break;
      const b = s.b;
      let ok = b.z * sg > 0 && b.y >= minY && b.y <= maxY;
      if (ok && mustBounce && s.bounces === 0) ok = false;
      if (ok && s.bounces === 0 && noVolley) ok = false;
      if (ok && opts.volleyOnly && s.bounces > 0) ok = false;
      let d = Infinity;
      if (ok) {
        const dx = b.x - player.x, dz = b.z - player.z;
        d = Math.sqrt(dx * dx + dz * dz);
        if (d > reach) ok = false;
      }
      if (ok) {
        if (!best || d < best.dist) best = { n: s.n, x: b.x, y: b.y, z: b.z, bounces: s.bounces, dist: d };
        else if (d > best.dist + 1e-9) break;
      } else if (best) break;
      if (s.n >= endN) { edge = !!best; break; }
      ev.length = 0;
      s.advanceTo((s.n + 1) * C.SIM_DT, ev);
    }
    if (!best) return null;
    // +0.001 bước để simTimeOf(t) luôn rơi đúng vào bước n (tránh sai số làm tròn)
    const simT = best.n * C.SIM_DT;
    return { t: launch.t0 + (best.n + 0.001) * C.SIM_DT / C.TIME_SCALE, ball: { x: best.x, y: best.y, z: best.z },
      simT, bounces: best.bounces, dist: best.dist, atEdge: edge };
  }

  /** Kiểu vung theo vị trí điểm chạm so với người chơi */
  function strokeZone(team, px, pz, contact, opts) {
    opts = opts || {};
    if (opts.serve) return 'serve';
    if (contact.y > 1.6) return 'overhead';
    if (contact.y < 0.5) return 'low';
    if (opts.volley && Math.abs(pz) < 3.2) return 'volley';
    const right = team === 'A' ? contact.x >= px : contact.x <= px;
    return right ? 'forehand' : 'backhand';
  }

  function speedOf(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }

  const Physics = { mulberry32, gauss, clamp, netHeightAt, stepBall, BallSim, simTimeOf, stateAt,
    predict, firstBounce, solveShot, solveShotEx, timeForApex, flyFree, computeShot, serveShot, speedOf,
    predictContact, strokeZone, spinLimits, defaultSpin };
  return { Physics, BallSim };
});
