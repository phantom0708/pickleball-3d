/* Pickle Pop – Bot AI (chạy offline trong trình duyệt và trên server online)
 * Bot điều khiển trực tiếp object người chơi trong Match (x, z, vx, vz)
 * và trả về "cú đánh" giống hệt dữ liệu một người chơi gửi lên.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const cfg = isNode ? require('./config.js') : root.PP;
  const phy = isNode ? require('./physics.js') : root.PP;
  const mod = factory(cfg, phy);
  if (isNode) module.exports = mod;
  else { root.PP = root.PP || {}; Object.assign(root.PP, mod); }
})(typeof self !== 'undefined' ? self : this, function (cfg, phy) {
  'use strict';
  const { C, LEVELS } = cfg;
  const { Physics } = phy;
  const clamp = Physics.clamp;

  class BotBrain {
    constructor(player, levelId, rng) {
      this.p = player;
      this.L = LEVELS[levelId] || LEVELS.pro;
      this.rng = rng;
      this.seen = -1; this.hitId = -1;
      this.plan = null; this.react = 0;
      this.serveRally = -1;
      /** thời điểm trận bot sẽ giao bóng (Infinity nếu không sắp giao) – công khai cho client chạy hoạt ảnh */
      this.serveAt = Infinity;
      this.serveType = 'drive';
      this.homeDepth = C.L - 0.6;
      /** điểm chạm dự kiến {launchId, t, x, y, z, zone, bounces} – công khai cho client chạy hoạt ảnh */
      this.intent = null;
      this.lastIntent = null; // intent của cú vừa đánh (kể cả khi được đặt và dùng trong cùng một tick)
      this.swing = 0;
    }
    rand(a, b) { return a + this.rng() * (b - a); }
    sg() { return this.p.team === 'A' ? 1 : -1; }

    tick(dt, now, m) {
      const p = this.p, L = this.L, sg = this.sg();
      let tx = p.x, tz = p.z, hit = null;

      if (m.phase === 'serve') {
        p.vx = 0; p.vz = 0;
        this.plan = null; this.intent = null;
        const recvTeam = m.serverTeam !== p.team;
        this.homeDepth = recvTeam && L.net && m.receiverId !== p.id && m.teamSize === 2 ? L.home : C.L - 0.6;
        if (m.serverId === p.id) {
          if (this.serveRally !== m.rallyId) {
            this.serveRally = m.rallyId;
            this.serveAt = now + this.rand(1.0, 1.7);
            const r = this.rng();
            this.serveType = r < 0.75 ? 'drive' : r < 0.9 ? 'lob' : 'dink';
          }
          if (now >= this.serveAt) {
            const at = this.serveAt;
            this.serveAt = Infinity;
            const s = Physics.serveShot({ team: p.team, type: this.serveType, pos: { x: p.x, z: p.z }, boxSign: m.boxSign,
              aimX: this.rand(-0.8, 0.8), errBase: L.err * 0.3, rng: this.rng,
              power: this.rng() < (L.power || 0) * 0.6 ? this.rand(0.3, 0.8) : 0 });
            this.swing++;
            return { serve: true, ballT: at, pos: { x: p.x, z: p.z }, from: s.from, v: s.v, spin: s.spin, shot: s.type };
          }
        } else this.serveAt = Infinity;
        return null;
      }
      this.serveAt = Infinity;

      if (m.phase === 'rally' && m.launch && m.sim) {
        const la = m.launch, ball = m.sim.b;
        if (la.id !== this.seen) {
          this.seen = la.id; this.plan = null; this.intent = null;
          this.react = la.team === p.team ? 0 : L.react * (0.8 + 0.4 * this.rng());
        }
        const home = this.home(m, ball);
        tx = home.x; tz = home.z;
        if (la.team !== p.team && la.id !== this.hitId) {
          if (this.react > 0) this.react -= dt;
          else if (!this.plan) this.plan = this.planIntercept(m, now);
          const plan = this.plan;
          // đánh đôi: chỉ người nhận ở ô chéo được đỡ giao (đồng đội đánh thay là lỗi)
          const wrongReceiver = la.serve && m.receiverId && m.receiverId !== p.id;
          if (plan && !plan.leave && plan.mine && !wrongReceiver) {
            tx = plan.x; tz = plan.z;
            if (!this.intent) {
              const c = Physics.predictContact(la, now, { x: p.x, z: p.z, team: p.team },
                { reach: L.reach, maxY: plan.maxH, avoidKitchenVolley: true, volleyOnly: plan.volleyOnly,
                  noVolley: Math.abs(p.z) < C.K + 0.4 }); // sát kitchen: không volley (tránh trượt chân vào)
              // chỉ chốt khi đã thấy điểm gần nhất (không bị cửa sổ cắt), hoặc sắp tới lúc chạm
              if (c && (!c.atEdge || c.t - now < 0.3)) {
                const volley = c.bounces === 0;
                this.intent = { launchId: la.id, t: c.t, x: c.ball.x, y: c.ball.y, z: c.ball.z, bounces: c.bounces,
                  zone: Physics.strokeZone(p.team, p.x, p.z, c.ball, { volley }) };
              }
            }
            const it = this.intent;
            if (it) {
              // tiến về điểm chạm (đứng hơi lùi sau bóng); volley thì không bước vào kitchen
              tx = it.x; tz = it.z + sg * 0.25;
              if (it.bounces === 0 && Math.abs(tz) < C.K + (C.KITCHEN_FOOT || 0) + 0.08) tz = sg * (C.K + (C.KITCHEN_FOOT || 0) + 0.08);
              if (now >= it.t) {
                this.hitId = la.id; this.swing++;
                hit = this.makeHit(m, it);
                if (it.bounces === 0) this.volleyAt = now;   // vừa vô-lê: không để trớn chạy vào bếp
                this.lastIntent = it;
                this.intent = null;
              }
            }
          }
        }
      } else if (m.phase === 'point') {
        this.intent = null;
        const home = this.home(m, { x: 0 });
        tx = home.x; tz = home.z;
      } else this.intent = null;

      // di chuyển
      const dx = tx - p.x, dz = tz - p.z, dist = Math.hypot(dx, dz);
      let vx = 0, vz = 0;
      if (dist > 0.04) { const s = Math.min(L.speed, dist * 7); vx = dx / dist * s; vz = dz / dist * s; }
      const k = 1 - Math.exp(-dt * 10);
      p.vx += (vx - p.vx) * k; p.vz += (vz - p.vz) * k;
      p.x = clamp(p.x + p.vx * dt, -C.BOUND_X, C.BOUND_X);
      const guard = (this.intent && this.intent.bounces === 0) || (this.volleyAt !== undefined && now - this.volleyAt < 0.9);
      const minZ = guard ? C.K + (C.KITCHEN_FOOT || 0) + 0.08 : C.NET_GAP;
      const lz = clamp((p.z + p.vz * dt) * sg, Math.min(minZ, Math.abs(p.z)), C.BOUND_BACK);
      p.z = lz * sg;
      return hit;
    }

    home(m, ball) {
      const p = this.p, sg = this.sg();
      const x = m.teamSize === 2 ? p.side * sg * 1.4 : clamp((ball.x || 0) * 0.4, -1.5, 1.5);
      return { x, z: sg * this.homeDepth };
    }

    /** Đánh đôi: ai nhận bóng – quyết định theo điểm rơi (hai bot cùng đội luôn ra cùng kết quả) */
    isMine(m, claimX) {
      const p = this.p, sg = this.sg();
      const mate = m.players.find((q) => q.team === p.team && q.id !== p.id);
      if (!mate) return true;
      if (Math.abs(claimX) < 0.3) return p.side === 1;
      return claimX * sg * p.side > 0;
    }

    planIntercept(m, now) {
      const la = m.launch, L = this.L, p = this.p, sg = this.sg();
      const simT = Physics.simTimeOf(la, now);
      const pr = Physics.predict(la, simT, 4);
      if (pr.net) return { leave: true };
      const land = Physics.firstBounce(la);
      let volleyOnly = false;
      if (land && land.t > simT) {
        let out = Math.abs(land.x) > C.W + 0.03 || Math.abs(land.z) > C.L + 0.03 || land.z * sg < 0;
        if (la.serve) out = out || Math.abs(land.z) <= C.K + 0.03 || land.x * m.boxSign < -0.03;
        if (out) {
          // bóng hỏng: phải để nảy (luật 2 nảy) hoặc đọc đúng → bỏ; đọc sai → cố volley (lỗi người chơi)
          if (la.hits <= 2 || this.rng() < L.judge) return { leave: true };
          volleyOnly = true;
        }
      }
      const mine = this.isMine(m, land ? land.x : m.sim.b.x);
      const mustBounce = la.hits <= 2;
      const maxH = this.rng() < L.smash ? 2.2 : 1.5;
      for (const s of pr.samples) {
        if (s.z * sg < 0.3) continue;
        if (s.bounces >= 2) break;
        if (volleyOnly && s.bounces > 0) break;
        const inK = Math.abs(s.z) < C.K + 0.15;
        if ((mustBounce || inK) && s.bounces === 0) continue;
        if (s.y < 0.2 || s.y > maxH) continue;
        const need = Math.max(0, Math.hypot(s.x - p.x, s.z - p.z) - 0.3) / L.speed;
        if (need <= s.t / C.TIME_SCALE) return { x: s.x, z: s.z + sg * 0.25, maxH, volleyOnly, mine };
      }
      const after = pr.samples.filter((s) => s.z * sg > 0.3 && s.bounces === 1 && s.y > 0.12);
      if (!volleyOnly && after.length) { const s = after[Math.min(after.length - 1, 8)]; return { x: s.x, z: s.z, maxH, volleyOnly, mine }; }
      const h = this.home(m, { x: 0 });
      return { x: h.x, z: h.z, maxH, volleyOnly, mine };
    }

    chooseShot(m, ball) {
      const L = this.L, p = this.p, r = this.rng();
      const opps = m.players.filter((q) => q.team !== p.team);
      const hitsBefore = m.launch.hits;
      const depth = Math.abs(p.z);
      const oppAtNet = opps.some((o) => Math.abs(o.z) < 3.4);
      if (ball.y > 1.35 && Math.abs(ball.z) > C.K && r < L.smash) return 'smash';
      if (hitsBefore <= 1) return r < 0.85 ? 'drive' : 'lob';               // trả giao bóng: sâu
      if (hitsBefore === 2 && depth > 4.5) return r < L.drop ? 'drop' : 'drive'; // cú thứ 3
      if (depth < 3.3 && ball.y < 1.05) {
        if (r < L.dink) return 'dink';
        return r < L.dink + (1 - L.dink) * 0.25 ? 'lob' : 'drive';
      }
      if (depth > 4.2 && oppAtNet) {
        if (r < L.drop * 0.8) return 'drop';
        return r < L.drop * 0.8 + 0.12 ? 'lob' : 'drive';
      }
      return r < 0.7 ? 'drive' : r < 0.85 ? 'drop' : 'lob';
    }

    makeHit(m, it) {
      const L = this.L, p = this.p;
      const ball = { x: it.x, y: it.y, z: it.z };
      const opps = m.players.filter((q) => q.team !== p.team);
      const shot = this.chooseShot(m, ball);
      let ax;
      const aggro = L.aggro || 0;
      if (opps.length <= 1) {
        const o = opps[0] || { x: 0 };
        // bot giỏi ép sát biên hơn
        ax = (o.x > 0 ? -1 : 1) * this.rand(0.35 + 0.35 * aggro, 0.95 + 0.05 * aggro);
      } else {
        const mid = (opps[0].x + opps[1].x) / 2;
        ax = this.rng() < 0.5 ? mid / 2.5 : (this.rng() < 0.5 ? -1 : 1) * this.rand(0.5, 0.9);
      }
      ax = ax * L.judge + this.rand(-0.9, 0.9) * (1 - L.judge);
      if (shot === 'dink' || shot === 'drop') ax *= 0.7;
      let az = this.rand(-0.3, 0.3);
      // đối thủ đứng ở lưới -> đánh drive vào chân (rơi ngắn hơn)
      if (shot === 'drive' && opps.some((o) => Math.abs(o.z) < 3.2) && this.rng() < (L.feet || 0)) az = this.rand(-1, -0.6);
      // cú tấn công dùng lực
      let power = 0;
      if ((shot === 'drive' || shot === 'smash') && this.rng() < (L.power || 0)) power = this.rand(0.45, 1);
      const perfect = this.rng() < L.perfect;
      // chạy gấp hoặc bóng thấp/xa thì đánh kém hơn
      const rush = Math.min(1, Math.hypot(p.vx, p.vz) / L.speed);
      const dist = Math.hypot(ball.x - p.x, ball.z - p.z) / L.reach;
      let q = this.rand(0.3, 0.95) - rush * 0.25 - Math.max(0, dist - 0.6) * 0.3 - (ball.y < 0.35 ? 0.15 : 0);
      q = perfect ? 1 : Math.max(0.05, q);
      const s = Physics.computeShot({ team: p.team, type: shot, ball, aim: { x: ax, z: az }, quality: q, perfect, power, errBase: L.err, rng: this.rng,
        wind: L.judge > 0.7 ? m.wind : undefined }); // bot giỏi tính cả gió
      this.homeDepth = L.net && (shot !== 'lob' || Math.abs(p.z) < 4) ? L.home : C.L - 0.6;
      return { launchId: it.launchId, ballT: it.t, pos: { x: p.x, z: p.z }, from: s.from, v: s.v, spin: s.spin, shot: s.type, perfect };
    }
  }

  return { BotBrain };
});
