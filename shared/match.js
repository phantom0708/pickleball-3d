/* Pickle Pop – Match: trạng thái pha, luật pickleball, tính điểm (đơn & đôi)
 * Đội A ở nửa z > 0, đội B ở nửa z < 0. Thời gian `now` tính bằng giây.
 * Match phát sự kiện vào hàng đợi (drain()):
 *   serve_setup, launch, point, over, paused
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
  const { C, SHOTS, SERVE_VMAX, VENUES } = cfg;
  const { Physics, BallSim } = phy;
  const other = (t) => (t === 'A' ? 'B' : 'A');
  const tsign = (t) => (t === 'A' ? 1 : -1);
  // Không strict (offline / bot server): dùng h.ballT nếu là thời điểm chạm vừa qua (≤ 0.1s), để cú đánh
  // xuất phát đúng điểm chạm đã lên lịch; còn lại dùng now.
  const localT = (h, now) => (typeof h.ballT === 'number' && h.ballT <= now && h.ballT >= now - 0.1 ? h.ballT : now);
  /** spin của cú đánh: thiếu → mặc định theo loại; strict → kẹp vào khoảng hợp lệ */
  function spinOf(h, shot, strict) {
    if (typeof h.spin !== 'number' || !Number.isFinite(h.spin)) return Physics.defaultSpin(shot);
    if (!strict) return h.spin;
    const r = Physics.spinLimits(shot);
    return Physics.clamp(h.spin, r[0], r[1]);
  }

  class Match {
    /**
     * opts = {teamSize:1|2, target, scoring:'rally'|'sideout', venue, seed, grace,
     *         players:[{id, team}]}
     */
    constructor(opts) {
      this.teamSize = opts.teamSize === 2 ? 2 : 1;
      this.target = opts.target || 11;
      // mặc định luật truyền thống: chỉ bên giao bóng mới ghi điểm (side-out); 'rally' là tùy chọn
      this.scoring = opts.scoring === 'rally' ? 'rally' : 'sideout';
      this.serverNum = 1;          // đánh đôi side-out: người giao thứ 1 hay thứ 2 của đội
      this.serverPlayerId = null;  // đánh đôi side-out: ai đang giữ lượt giao
      this.venue = VENUES.find((v) => v.id === opts.venue) || VENUES[0];
      this.grace = opts.grace || 0;
      this.rng = Physics.mulberry32((opts.seed >>> 0) || 1);
      this.players = opts.players.map((p) => ({ id: p.id, team: p.team, x: 0, z: tsign(p.team) * 6, vx: 0, vz: 0, side: 1 }));
      for (const t of ['A', 'B']) {
        const tp = this.players.filter((p) => p.team === t);
        tp.forEach((p, i) => { p.side = i === 0 ? 1 : -1; });
      }
      this.score = { A: 0, B: 0 };
      this.phase = 'idle';
      this.serverTeam = 'A';
      this.serverId = null;
      this.rallyId = 0;
      this.launchSeq = 0;
      this.launch = null;
      this.sim = null;
      this.hits = 0;
      this.lastTeam = null;
      this.pending = null;
      this.boxSign = 1;
      this.serveDeadline = 0;
      this.pointUntil = 0;
      this.winner = null;
      this.overPending = false;
      this.wind = { x: 0, z: 0 };
      if (this.venue.wind === 'steady') {
        const s = this.venue.strength * (0.6 + 0.4 * this.rng());
        this.wind = { x: (this.rng() < 0.5 ? -1 : 1) * s, z: 0 };
      }
      this.out = [];
    }

    player(id) { return this.players.find((p) => p.id === id) || null; }
    doublesSideOut() { return this.teamSize === 2 && this.scoring === 'sideout'; }
    drain() { const o = this.out; this.out = []; return o; }
    emit(e) { this.out.push(e); }

    setPlayerState(id, x, z, vx, vz) {
      const p = this.player(id);
      if (!p) return;
      p.x = x; p.z = z; p.vx = vx || 0; p.vz = vz || 0;
    }

    start(now, firstServer) {
      this.serverTeam = firstServer || (this.rng() < 0.5 ? 'A' : 'B');
      if (this.doublesSideOut()) {
        // lượt giao đầu trận: đội giao trước chỉ có 1 người giao ("0-0-2"), bắt đầu từ ô bên phải
        this.serverNum = 2;
        const first = this.players.find((p) => p.team === this.serverTeam && p.side === 1) || this.players.find((p) => p.team === this.serverTeam);
        this.serverPlayerId = first ? first.id : null;
      }
      this.setupServe(now);
    }

    setupServe(now) {
      this.rallyId++;
      this.phase = 'serve';
      this.launch = null; this.sim = null; this.pending = null;
      this.hits = 0; this.lastTeam = null;
      if (this.venue.wind === 'gust') {
        const ang = this.rng() * Math.PI * 2;
        const m = this.venue.strength * (0.3 + 0.7 * this.rng());
        this.wind = { x: Math.cos(ang) * m, z: Math.sin(ang) * m * 0.4 };
      }
      const st = this.serverTeam, rt = other(st);
      const sideName = this.score[st] % 2 === 0 ? 1 : -1;
      let server, receiver;
      const sp = this.players.filter((p) => p.team === st);
      const rp = this.players.filter((p) => p.team === rt);
      if (this.teamSize === 1) {
        server = sp[0]; receiver = rp[0];
        if (server) server.side = sideName;
        if (receiver) receiver.side = sideName;
      } else if (this.doublesSideOut()) {
        // người giữ lượt giao đứng ở ô hiện tại của mình; người nhận là đối thủ ở ô chéo
        server = this.player(this.serverPlayerId) || sp[0];
        receiver = rp.find((p) => p.side === server.side) || rp[0];
      } else {
        server = sp.find((p) => p.side === sideName) || sp[0];
        receiver = rp.find((p) => p.side === sideName) || rp[0];
      }
      for (const p of this.players) {
        const sg = tsign(p.team);
        p.x = p.side * sg * C.SERVE_X;
        if (p === server) p.z = sg * (C.L + 0.45);
        else if (p.team === st) p.z = sg * (C.L + 0.2);
        else if (p === receiver) p.z = sg * (C.L + 0.2);
        else p.z = sg * (C.K + 0.4);
        p.vx = 0; p.vz = 0;
      }
      this.serverId = server ? server.id : null;
      this.receiverId = receiver ? receiver.id : null;
      this.boxSign = server ? -Math.sign(server.x) : 1;
      this.serveDeadline = now + C.SERVE_TIMEOUT;
      this.emit({
        t: 'serve_setup', rallyId: this.rallyId, server: this.serverId, serverTeam: st, serverNum: this.teamSize === 2 && this.scoring === 'sideout' ? this.serverNum : 0,
        receiver: this.receiverId, boxSign: this.boxSign, wind: Object.assign({}, this.wind),
        score: Object.assign({}, this.score),
        positions: this.players.map((p) => ({ id: p.id, x: p.x, z: p.z, side: p.side })),
      });
    }

    serveSpot(id) {
      const p = this.player(id);
      if (!p) return null;
      return { x: p.side * tsign(p.team) * C.SERVE_X, z: tsign(p.team) * (C.L + 0.45) };
    }

    /**
     * Người chơi đánh bóng / giao bóng.
     * h = {launchId, ballT, pos:{x,z}, from:{x,y,z}, v:{x,y,z}, spin, shot, perfect, serve}
     * strict = true khi chạy trên server online (kiểm tra chống gian lận)
     * Trả về {ok, reason?, fault?}
     */
    tryHit(id, h, now, strict) {
      const p = this.player(id);
      if (!p) return { ok: false, reason: 'no_player' };
      const vmag = Physics.speedOf(h.v);

      if (h.serve) {
        if (this.phase !== 'serve' || id !== this.serverId) return { ok: false, reason: 'not_server' };
        if (vmag > SERVE_VMAX) return { ok: false, reason: 'speed' };
        let t0 = localT(h, now);
        if (strict) {
          const spot = this.serveSpot(id);
          if (Math.abs(h.pos.z - spot.z) > 1.0 || h.pos.x * spot.x <= 0 || Math.abs(h.pos.x) > C.W + 0.3) return { ok: false, reason: 'serve_pos' };
          const fz = h.pos.z + (p.team === 'A' ? -C.SERVE_FWD : C.SERVE_FWD);
          if (Math.abs(h.from.x - h.pos.x) > 0.25 || Math.abs(h.from.z - fz) > 0.25 || Math.abs(h.from.y - C.SERVE_Y) > 0.06) return { ok: false, reason: 'from' };
          if (h.ballT > now + 0.05 || h.ballT < now - 0.35) return { ok: false, reason: 'time' };
          t0 = Math.min(h.ballT, now);
        }
        this._launch(p, h.from, h.v, t0, 'serve', false, true, spinOf(h, 'serve', strict));
        return { ok: true };
      }

      if (this.phase !== 'rally' || !this.launch) return { ok: false, reason: 'no_rally' };
      if (h.launchId !== this.launch.id) return { ok: false, reason: 'stale' };
      if (p.team === this.lastTeam) return { ok: false, reason: 'same_team' };
      const ballT = strict ? h.ballT : localT(h, now);
      if (strict && (ballT > now + 0.05 || ballT < now - 0.35)) return { ok: false, reason: 'time' };
      if (ballT < this.launch.t0) return { ok: false, reason: 'time' };
      if (this.pending && ballT >= this.pending.t) return { ok: false, reason: 'late' };
      const st = Physics.stateAt(this.launch, Physics.simTimeOf(this.launch, ballT));
      if (st.net) return { ok: false, reason: 'net' };
      const b = st.b;
      if (b.z * tsign(p.team) < -0.1) return { ok: false, reason: 'side' };
      if (st.bounces >= 2) return { ok: false, reason: 'dead' };
      if (st.bounces === 0 && this.hits <= 2) return { ok: false, reason: 'two_bounce' };
      const sh = SHOTS[h.shot] || SHOTS.drive;
      if (vmag > sh.vmax) return { ok: false, reason: 'speed' };
      if (strict) {
        const d = Math.hypot(h.pos.x - b.x, h.pos.z - b.z);
        if (d > C.REACH + 0.35) return { ok: false, reason: 'reach' };
        if (b.y < 0.03 || b.y > 2.5) return { ok: false, reason: 'height' };
        const df = Math.hypot(h.from.x - b.x, h.from.y - Math.max(b.y, 0.12), h.from.z - b.z);
        if (df > 0.25) return { ok: false, reason: 'from' };
        if (Math.hypot(h.pos.x - p.x, h.pos.z - p.z) > 1.8) return { ok: false, reason: 'pos' };
      }
      if (this.hits === 1 && this.receiverId && id !== this.receiverId) {
        // đánh đôi: chỉ người ở ô chéo được đỡ giao
        this._end(other(p.team), 'SAI NGƯỜI ĐỠ GIAO', now);
        return { ok: true, fault: true };
      }
      if (st.bounces === 0 && Math.abs(h.pos.z) < C.K + (C.KITCHEN_FOOT || 0)) {
        this._end(other(p.team), 'LỖI KITCHEN', now);
        return { ok: true, fault: true };
      }
      // vô-lê: trong 0.8s sau đó nếu đà chạy đưa người vào bếp vẫn là lỗi
      this.volleyGuard = st.bounces === 0 ? { id, until: now + 0.8 } : null;
      this._launch(p, h.from, h.v, ballT, h.shot, !!h.perfect, false, spinOf(h, h.shot, strict));
      return { ok: true };
    }

    _launch(p, from, v, t0, shot, perfect, serve, spin) {
      this.launchSeq++;
      this.hits++;
      const la = {
        id: this.launchSeq, rallyId: this.rallyId, by: p.id, team: p.team,
        from: { x: from.x, y: from.y, z: from.z }, v: { x: v.x, y: v.y, z: v.z }, spin: spin || 0,
        t0, wind: Object.assign({}, this.wind), hits: this.hits, serve: !!serve, shot, perfect: !!perfect,
      };
      this.launch = la;
      this.netBlocked = false;
      this.sim = new BallSim(la);
      this.lastTeam = p.team;
      this.pending = null;
      this.phase = 'rally';
      this.emit({ t: 'launch', launch: la });
    }

    update(now) {
      if (this.phase === 'serve') {
        if (now >= this.serveDeadline && this.serverId) {
          // luật 10 giây: người giao không giao kịp sau khi xướng điểm -> lỗi giao
          this.phase = 'rally';
          this._end(other(this.serverTeam), 'QUÁ 10 GIÂY', now);
        }
      } else if (this.phase === 'rally' && this.launch) {
        const g = this.volleyGuard;
        if (g) {
          const gp = this.player(g.id);
          if (now > g.until || !gp) this.volleyGuard = null;
          else if (Math.abs(gp.z) < C.K + (C.KITCHEN_FOOT || 0)) {
            this.volleyGuard = null;
            this._end(other(gp.team), 'ĐÀ VÀO BẾP', now);
            return;
          }
        }
        const ev = [];
        this.sim.advanceTo(Physics.simTimeOf(this.launch, now), ev);
        for (const e of ev) {
          if (this.phase !== 'rally') break;
          this._onBallEvent(e, now);
        }
        if (this.phase === 'rally') {
          if (this.pending && now >= this.pending.t + this.grace) this._end(this.pending.winner, this.pending.call, now);
          else if (!this.pending && this.sim.t > C.MAX_RALLY_SIM) this._end(this.lastTeam, 'ĐIỂM!', now);
        }
      } else if (this.phase === 'point') {
        if (now >= this.pointUntil) {
          if (this.overPending) {
            this.phase = 'over';
            this.emit({ t: 'over', winner: this.winner, score: Object.assign({}, this.score), reason: 'score' });
          } else this.setupServe(now);
        }
      }
    }

    _onBallEvent(e, now) {
      if (this.pending) return;
      const la = this.launch;
      const te = la.t0 + e.t / C.TIME_SCALE;
      const hitter = this.lastTeam, target = other(hitter);
      if (e.type === 'net') { this.netBlocked = true; return; }   // bóng đập lưới: sẽ rơi lại sân người đánh
      if (e.type !== 'bounce') return;                                // 'netcord' = chạm mép lưới mà qua: vẫn chơi
      const side = e.z > 0 ? 'A' : 'B';
      if (e.n === 1) {
        if (side !== target) { this._end(target, this.netBlocked ? 'LƯỚI!' : 'LỖI!', now); return; }
        const inside = Math.abs(e.x) <= C.W + C.R && Math.abs(e.z) <= C.L + C.R;
        if (la.serve) {
          if (Math.abs(e.z) <= C.K + 0.025) { this.pending = { t: te, winner: target, call: 'GIAO VÀO KITCHEN' }; return; }
          const rightBox = e.x * this.boxSign >= -C.R;
          if (!inside || !rightBox) { this.pending = { t: te, winner: target, call: 'GIAO HỎNG' }; return; }
        } else if (!inside) {
          this.pending = { t: te, winner: target, call: 'OUT' };
        }
      } else if (e.n >= 2) {
        this.pending = { t: te, winner: hitter, call: 'ĐIỂM!' };
      }
    }

    _end(winner, call, now) {
      if (this.phase !== 'rally') return;
      let sideOut = false;
      if (this.scoring === 'rally') {
        const o2 = other(winner), would = this.score[winner] + 1;
        const gamePoint = would >= this.target && would - this.score[o2] >= 2;
        if (gamePoint && winner !== this.serverTeam) {
          // bên nhận không được ghi điểm kết thúc ván: chỉ giành quyền giao
          this.serverTeam = winner; sideOut = true;
        } else {
          if (winner === this.serverTeam && this.teamSize === 2) {
            for (const p of this.players) if (p.team === winner) p.side = -p.side;
          }
          this.score[winner]++;
          this.serverTeam = winner;
        }
      } else if (this.doublesSideOut()) {
        if (winner === this.serverTeam) {
          // đội giao ghi điểm, người giao đổi ô với đồng đội và giao tiếp
          this.score[winner]++;
          for (const p of this.players) if (p.team === winner) p.side = -p.side;
        } else if (this.serverNum === 1) {
          // người giao thứ nhất mất lượt -> đồng đội giao (không đổi ô)
          this.serverNum = 2;
          const mate = this.players.find((p) => p.team === this.serverTeam && p.id !== this.serverPlayerId);
          if (mate) this.serverPlayerId = mate.id;
        } else {
          // người giao thứ hai mất lượt -> đổi giao, người ở ô phải của đội kia giao trước
          this.serverTeam = winner; sideOut = true; this.serverNum = 1;
          const first = this.players.find((p) => p.team === winner && p.side === 1) || this.players.find((p) => p.team === winner);
          this.serverPlayerId = first ? first.id : null;
        }
      } else {
        if (winner === this.serverTeam) this.score[winner]++;
        else { this.serverTeam = winner; sideOut = true; }
      }
      this.phase = 'point';
      this.pending = null;
      this.volleyGuard = null;
      this.pointUntil = now + C.POINT_DELAY;
      const w = winner, o = other(winner);
      if (this.score[w] >= this.target && this.score[w] - this.score[o] >= 2) {
        this.overPending = true; this.winner = w;
      }
      this.emit({ t: 'point', winner, call, score: Object.assign({}, this.score), serverTeam: this.serverTeam, sideOut,
        serverNum: this.doublesSideOut() ? this.serverNum : 0 });
    }

    /** Hủy pha hiện tại và tạm dừng (khi có người mất kết nối) */
    pause() {
      if (this.phase === 'over') return;
      this.phase = 'paused';
      this.launch = null; this.sim = null; this.pending = null;
      this.emit({ t: 'paused' });
    }
    resume(now) {
      if (this.phase !== 'paused') return;
      if (this.overPending) {
        this.phase = 'over';
        this.emit({ t: 'over', winner: this.winner, score: Object.assign({}, this.score), reason: 'score' });
      } else this.setupServe(now);
    }
    forfeit(team) {
      if (this.phase === 'over') return;
      this.phase = 'over';
      this.winner = other(team);
      this.launch = null; this.sim = null;
      this.emit({ t: 'over', winner: this.winner, score: Object.assign({}, this.score), reason: 'forfeit' });
    }

    snapshot() {
      return {
        phase: this.phase, score: Object.assign({}, this.score), serverTeam: this.serverTeam,
        server: this.serverId, receiver: this.receiverId, rallyId: this.rallyId, boxSign: this.boxSign,
        serverNum: this.doublesSideOut() ? this.serverNum : 0, scoring: this.scoring,
        wind: Object.assign({}, this.wind), launch: this.launch,
        positions: this.players.map((p) => ({ id: p.id, x: p.x, z: p.z, side: p.side })),
      };
    }
  }

  return { Match };
});
