/* Pickle Pop v2 – vòng lặp game, chế độ Offline (LocalHost) & Online (NetClient), menu */
(function (PP) {
  'use strict';
  const C = PP.C, A = PP.Audio, UI = PP.UI, $ = UI.$, Physics = PP.Physics, BallSim = PP.BallSim, Protocol = PP.Protocol;
  const clamp = Physics.clamp;
  const CHAR = (id) => PP.CHARACTERS.find((c) => c.id === id) || PP.CHARACTERS[0];
  const VENUE = (id) => PP.VENUES.find((v) => v.id === id) || PP.VENUES[0];
  const IS_FILE = location.protocol === 'file:';
  const SHOT_NAME = { drive: 'Drive', dink: 'Dink', drop: 'Drop', lob: 'Lob', smash: 'Smash', serve: 'Giao bóng' };
  const shotColor = (t) => (t === 'serve' ? (PP.SERVE_COLOR || '#ffffff') : ((PP.SHOTS[t] && PP.SHOTS[t].color) || '#ffffff'));
  const other = (t) => (t === 'A' ? 'B' : 'A');
  const SERVE_LEAD = 0.25;
  const CONTACT_REACH = 1.3;   // tầm với thực tế của nhân vật (vai → mặt vợt + dịch thân)

  /* ================= Lưu trữ ================= */
  const DEFAULT_SETTINGS = { quality: 'auto', volume: 80, ring: true, landing: true, hitstop: true, shake: true, rules: true };
  const Save = {
    data: { wins: 0, losses: 0, char: 'bunny', level: 'pro', venue: 'gym', target: 7, scoring: 'sideout', mode: 1, muted: false, name: '', deviceId: '', settings: {}, looks: {} },
    load() {
      try { Object.assign(this.data, JSON.parse(localStorage.getItem('pp-save') || '{}')); } catch (e) { /* localStorage bị chặn */ }
      this.data.settings = Object.assign({}, DEFAULT_SETTINGS, this.data.settings || {});
      if (!this.data.looks || typeof this.data.looks !== 'object') this.data.looks = {};
      // chuyển sang luật chuẩn (chỉ bên giao ghi điểm) cho bản lưu cũ đang mặc định Rally
      if (!this.data.rulesV2) { this.data.scoring = 'sideout'; this.data.rulesV2 = true; this.save(); }
      // hiệp ngắn: chỉ còn chạm 5 / 7 / 11; bản lưu cũ chạm 15/21 -> 7
      if (![5, 7, 11].includes(+this.data.target)) { this.data.target = 7; this.save(); }
      if (!this.data.deviceId) {
        this.data.deviceId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
          : 'd' + Math.random().toString(16).slice(2) + Date.now().toString(16);
        this.save();
      }
      if (CHAR(this.data.char).unlock > this.data.wins) this.data.char = 'bunny';
      if (!PP.VENUES.some((v) => v.id === this.data.venue)) this.data.venue = 'gym';
    },
    save() { try { localStorage.setItem('pp-save', JSON.stringify(this.data)); } catch (e) { /* bỏ qua */ } },
  };
  const S = () => Save.data.settings;
  let softwareGL = false;   // trình duyệt đang dựng hình bằng CPU (không có GPU)
  function quality() {
    const q = S().quality;
    if (q && q !== 'auto') return q;
    if (softwareGL) return 'low';
    const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    return coarse || (navigator.hardwareConcurrency || 4) <= 4 ? 'medium' : 'high';
  }

  /* ================= Trang phục (look) ================= */
  const pickOne = (a) => a[(Math.random() * a.length) | 0];
  function myLook(id) { return Object.assign({}, Save.data.looks[id || Save.data.char] || {}); }
  function fullLook(id) {
    const d = PP.Character.defaultLook ? PP.Character.defaultLook(id) : {};
    return Object.assign({}, d, myLook(id));
  }
  function botLook() {
    const O = PP.Character.OPTIONS;
    if (!O) return {};
    const look = {};
    if (Math.random() < 0.5 && O.patterns) look.pattern = pickOne(O.patterns).id;
    if (Math.random() < 0.4 && O.accessories) look.accessory = pickOne(O.accessories.filter((a) => !a.unlock)).id;
    return look;
  }

  /* ================= Three.js ================= */
  let renderer, scene, camera, clock, world = null;
  let ball, ring, land, boxHint, bursts, fx, surface = 'wood';
  const camPos = new THREE.Vector3(0, 7, 15), camLook = new THREE.Vector3(0, 0.3, -1.5);
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
  const camTest = new THREE.PerspectiveCamera(42, 1, 0.1, 300);   // camera thử để kiểm tra bóng có trong khung không
  let shake = 0, hitStop = 0, time = 0;

  /* ================= Trạng thái ================= */
  let mode = 'menu';            // menu | offline | online | spectate
  let paused = false;
  let session = null;
  const players = new Map();
  let me = null, myTeam = 'A', flip = 1, myPid = null;
  const V = {};
  const CHARGE_MIN = 0.12, CHARGE_FULL = 0.75;   // giữ < 0.12s = cú thường; 0.75s = lực tối đa
  const ctl = { charge: null, pending: null, servePending: null, cool: 0, servedRally: -1, sw: 0, frameContact: null, dustT: 0 };
  const ballOff = { x: 0, y: 0, z: 0 };
  let twoBounceHinted = false;
  let menuT = 0;

  function resetView(cfg) {
    Object.assign(V, {
      phase: 'idle', score: { A: 0, B: 0 }, serverTeam: 'A', serverId: null, rallyId: 0, boxSign: 1,
      wind: { x: 0, z: 0 }, launch: null, sim: null, prevLaunch: null, prevPhase: null, landing: null,
      teamSize: 1, target: 7, scoring: 'sideout', serverNum: 0, venue: 'gym', serveHalf: 1, lastPoint: null,
    }, cfg || {});
    ctl.pending = null; ctl.armed = null; ctl.charge = null; ctl.servePending = null; ctl.cool = 0; ctl.servedRally = -1; ctl.frameContact = null;
    ballOff.x = ballOff.y = ballOff.z = 0;
  }
  resetView();
  const now = () => (session ? session.now() : time);

  /* ================= Dựng cảnh ================= */
  function detectSoftwareGL(r) {
    try {
      const gl = r.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    } catch (e) { return false; }
  }
  function initRenderer() {
    renderer = PP.World.createRenderer($('#game'), 'low');
    softwareGL = detectSoftwareGL(renderer);
    PP.World.applyQuality(renderer, quality());
    if (softwareGL) renderer.setPixelRatio(Math.min(1, 0.75 * (window.devicePixelRatio || 1)));
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
    clock = new THREE.Clock();
    resize();
    window.addEventListener('resize', resize);
  }
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w / h < 0.9 ? 58 : w / h < 1.3 ? 48 : 42;
    camera.updateProjectionMatrix();
  }

  function disposeWorld() {
    for (const p of players.values()) { try { p.ch.dispose(); } catch (e) { /* bỏ qua */ } }
    players.clear();
    if (world) { try { world.dispose(); } catch (e) { /* bỏ qua */ } }
    world = null; scene = null;
    $('#tags').textContent = '';
  }

  function buildScene(venueId, list, tags) {
    disposeWorld();
    world = PP.World.buildScene(renderer, venueId, quality());
    scene = world.scene;
    surface = PP.World.surfaceOf ? PP.World.surfaceOf(venueId) : 'hard';
    for (const p of list) {
      const ch = PP.Character.build(CHAR(p.char), { team: p.team, look: p.look || {} });
      scene.add(ch.root);
      if (p.isMe) ch.setHighlight(0xffffff);
      const obj = Object.assign({ x: 0, z: p.team === 'A' ? 6 : -6, vx: 0, vz: 0, buf: [], sw: 0, swingKey: null, tag: null }, p, { ch });
      if (tags) {
        const el = document.createElement('div');
        el.className = 'nametag ' + (p.isMe ? 'me ' : '') + (p.team === 'A' ? 'ta' : 'tb');
        const dot = document.createElement('span'); dot.className = 'sv'; dot.style.display = 'none';
        const nm = document.createElement('span'); nm.textContent = p.isMe ? 'Bạn' : p.name;
        el.append(dot, nm);
        $('#tags').append(el);
        obj.tag = el; obj.tagDot = dot;
      }
      players.set(p.id, obj);
    }
    ball = new PP.World.Ball(); scene.add(ball.root);
    ring = new PP.World.TimingRing(); scene.add(ring.root);
    land = new PP.World.LandingMarker(); scene.add(land.root);
    boxHint = new PP.World.BoxHint(); scene.add(boxHint.root);
    bursts = new PP.World.Bursts(); scene.add(bursts.root);
    fx = new PP.World.Particles(); scene.add(fx.root);
  }

  function buildMenuScene() {
    const pick = PP.CHARACTERS.filter((c) => c.id !== Save.data.char);
    buildScene(Save.data.venue || 'gym', [
      { id: 'm1', team: 'A', char: Save.data.char, name: '', look: myLook() },
      { id: 'm2', team: 'B', char: pick[(Math.random() * pick.length) | 0].id, name: '', look: botLook() },
    ], false);
    players.get('m1').x = 1.4; players.get('m1').z = 3.6;
    players.get('m2').x = -1.4; players.get('m2').z = -3.6;
    A.ambience && A.ambience(false);
  }

  /* ================= Sự kiện trận đấu ================= */
  function teamName(t) {
    const ps = [...players.values()].filter((p) => p.team === t);
    if (mode !== 'spectate' && t === myTeam) return V.teamSize === 2 ? 'Đội bạn' : 'Bạn';
    if (V.teamSize === 2) return mode === 'offline' ? 'Đối thủ' : ps.map((p) => p.name).join(' & ');
    return ps[0] ? ps[0].name : '?';
  }

  /** Cách đọc tỉ số trước khi giao: điểm đội giao – điểm đội nhận (– người giao, khi đánh đôi truyền thống) */
  function scoreCall() {
    if (V.scoring !== 'sideout') return '';
    const st = V.serverTeam, rt = other(st);
    return '  (' + V.score[st] + ' – ' + V.score[rt] + (V.serverNum ? ' – ' + V.serverNum : '') + ')';
  }
  function serveCard(show) {
    const el = $('#serve-card');
    if (!show) { el.classList.add('hidden'); return; }
    el.textContent = '';
    const t = document.createElement('b'); t.className = 't'; t.textContent = 'Lượt giao của bạn' + scoreCall();
    const sm = document.createElement('small');
    const k = (s) => { const x = document.createElement('span'); x.className = 'k'; x.textContent = s; return x; };
    if (PP.Input.isTouch()) sm.append('Bấm ', k('Drive'), ' sâu · ', k('Lob'), ' cao · ', k('Dink'), ' ngắn');
    else sm.append(k('J'), ' sâu · ', k('L'), ' cao · ', k('K'), ' ngắn · giữ ', k('←'), '/', k('→'), ' để ngắm · giữ phím đánh để giao mạnh');
    el.append(t, sm);
    el.classList.remove('hidden');
  }

  function applyEvent(e) {
    switch (e.t) {
      case 'serve_setup': {
        V.phase = 'serve'; V.rallyId = e.rallyId; V.serverId = e.server; V.serverTeam = e.serverTeam;
        V.boxSign = e.boxSign; V.wind = e.wind; V.score = e.score; V.serverNum = e.serverNum || 0;
        V.receiverId = e.receiver || null; V.serveDeadline = now() + C.SERVE_TIMEOUT;
        setLaunch(null);
        for (const pos of e.positions) {
          const p = players.get(pos.id);
          if (p) { p.x = pos.x; p.z = pos.z; p.vx = p.vz = 0; p.buf.length = 0; }
        }
        if (me) V.serveHalf = Math.sign(me.x) || 1;
        ctl.pending = null; ctl.armed = null; ctl.servePending = null; ctl.servedRally = -1;
        ball && ball.clearTrail();
        UI.hideCall();
        updateHUD();
        const iServe = me && V.serverId === me.id;
        serveCard(iServe);
        if (iServe || mode === 'spectate') UI.setMsg('');
        else {
          const sp = players.get(V.serverId);
          UI.setMsg((sp && sp.team === myTeam ? 'Đồng đội giao bóng…' : 'Đối thủ giao bóng…') + scoreCall());
        }
        break;
      }
      case 'launch': onLaunch(e.launch); break;
      case 'point': {
        V.phase = 'point'; V.score = e.score; V.serverTeam = e.serverTeam; V.lastPoint = e; V.serverNum = e.serverNum || 0;
        ctl.pending = null;
        serveCard(false);
        showPoint(e); updateHUD();
        for (const p of players.values()) p.ch.react(p.team === e.winner ? 'celebrate' : 'sad');
        break;
      }
      case 'over': V.phase = 'over'; onOver(e); break;
      case 'paused': V.phase = 'paused'; setLaunch(null); serveCard(false); break;
    }
  }

  function currentBallPos() {
    if (!V.sim) return null;
    return { x: V.sim.b.x + ballOff.x, y: V.sim.b.y + ballOff.y, z: V.sim.b.z + ballOff.z };
  }
  function setLaunch(la, smooth) {
    const old = smooth ? currentBallPos() : null;
    V.launch = la;
    if (!la) { V.sim = null; V.landing = null; return; }
    V.sim = new BallSim(la);
    V.sim.advanceTo(Physics.simTimeOf(la, now()));
    V.landing = Physics.firstBounce(la);
    if (old) { ballOff.x = old.x - V.sim.b.x; ballOff.y = old.y - V.sim.b.y; ballOff.z = old.z - V.sim.b.z; }
    else { ballOff.x = ballOff.y = ballOff.z = 0; }
    if (ball) {
      const st = la.serve ? 'serve' : la.shot;
      ball.setTrailColor(shotColor(st), st === 'smash' ? 1.6 : 1);
      if (land && land.setColor) land.setColor(shotColor(st));
    }
  }

  function zoneOf(p, contact, la) {
    return Physics.strokeZone(p.team, p.x, p.z, contact, { serve: !!(la && la.serve), volley: false });
  }

  function onLaunch(la) {
    const mine = me && la.by === me.id;
    if (mine && V.launch && V.launch.predicted) setLaunch(la, false);
    else {
      setLaunch(la, !mine);
      if (!mine) hitFx(la.from, la.serve ? 'serve' : la.shot, la.perfect ? 'perfect' : 'good', false);
    }
    V.phase = 'rally';
    UI.setMsg(''); serveCard(false);
    const p = players.get(la.by);
    // hoạt ảnh dự phòng nếu chưa có swing được lên lịch cho cú này
    if (p && !p.isMe && p.swingKey !== 'L' + la.id && p.swingKey !== 'R' + V.rallyId + (la.serve ? 's' : '')) {
      p.ch.swing({ zone: la.serve ? 'serve' : zoneOf(p, la.from, la), contact: la.from, timeToContact: 0.03 });
    }
    // đội nhận bóng bật split-step
    for (const q of players.values()) if (q.team !== la.team) q.ch.splitStep();
  }

  function hitFx(pos, type, qname, mineHit) {
    const power = (PP.SHOTS[type] && PP.SHOTS[type].power) || 0.8;
    A.hit(type, qname, power);
    const perfect = qname === 'perfect';
    bursts.spawn(pos.x, pos.y, pos.z, perfect ? '#ffd35c' : '#ffffff', perfect ? 1.3 : 0.7, perfect ? 0.4 : 0.25);
    if (perfect) {
      fx.burst(pos.x, pos.y, pos.z, { count: 18, colors: ['#ffe27a', '#fff3c4', '#ffb3c7'], speed: 3.2, gravity: 2 });
      if (mineHit) {
        ring.flash();
        if (S().shake) shake = Math.max(shake, 0.16);
        if (S().hitstop && mode === 'offline') hitStop = 0.075;
        world.crowd.cheer(0.35);
      }
    }
    if (type === 'smash') { A.swoosh && A.swoosh(); if (S().shake) shake = Math.max(shake, 0.08); }
  }

  function floater(text, cls, x, y, z) {
    tmpV.set(x, y, z).project(camera);
    if (tmpV.z > 1) return;
    const el = document.createElement('div');
    el.className = 'floater ' + (cls || '');
    el.textContent = text;
    el.style.left = ((tmpV.x * 0.5 + 0.5) * window.innerWidth) + 'px';
    el.style.top = ((-tmpV.y * 0.5 + 0.5) * window.innerHeight) + 'px';
    $('#floaters').append(el);
    setTimeout(() => el.remove(), 950);
  }

  function showPoint(e) {
    const mine = mode === 'spectate' ? null : myTeam;
    const won = e.winner === mine;
    let main = e.call;
    if (main === 'ĐIỂM!' && mine) main = won ? 'GHI ĐIỂM!' : 'MẤT ĐIỂM';
    let sub;
    const secondServer = V.scoring === 'sideout' && !e.sideOut && e.winner !== e.serverTeam;  // không ai được điểm
    if (secondServer) sub = 'Chuyển sang người giao thứ 2';
    else if (!mine) sub = (e.sideOut ? 'Đổi giao bóng · ' : '+1 · ') + teamName(e.winner);
    else if (e.sideOut) sub = won ? (V.teamSize === 2 ? 'Đội bạn' : 'Bạn') + ' giành quyền giao bóng' : 'Đối thủ giành quyền giao bóng';
    else sub = won ? '+1 cho ' + (V.teamSize === 2 ? 'đội bạn' : 'bạn') : '+1 cho đối thủ';
    UI.call(main, sub, mine ? (won ? 'good' : 'bad') : '');
    A.whistle();
    const big = Math.max(e.score.A, e.score.B) >= V.target - 1;
    world.crowd.cheer(won || !mine ? (big ? 1 : 0.7) : 0.3);
    if (won || !mine) A.cheer(big ? 1 : 0.6);
    if (/OUT|LƯỚI/.test(e.call)) A.ooh && A.ooh();
    if (big && won) fx.burst(0, 2.5, myTeam === 'A' ? 3 : -3, { count: 40, colors: ['#ff6f91', '#ffd35c', '#7cc8ff', '#8fe3c0'], speed: 5, gravity: 3 });
  }

  function onOver(e) {
    const spect = mode === 'spectate';
    const won = !spect && e.winner === myTeam;
    const L = spect ? 'A' : myTeam, R = other(L);
    let unlockText = '';
    if (!spect) {
      const before = Save.data.wins;
      if (won) Save.data.wins++; else Save.data.losses++;
      Save.save();
      const newly = PP.CHARACTERS.filter((c) => c.unlock > before && c.unlock <= Save.data.wins);
      if (newly.length) unlockText = '🎉 Mở khóa nhân vật mới: ' + newly.map((c) => c.name).join(', ');
    }
    if (won) world.crowd.wave();
    setTimeout(() => {
      if (!session) return;
      $('#over-title').textContent = spect ? 'Trận đấu kết thúc' : won ? 'CHIẾN THẮNG! 🏆' : 'THUA RỒI! 😿';
      $('#over-score').textContent = `${e.score[L]} – ${e.score[R]}`;
      $('#over-reason').textContent = e.reason === 'forfeit' ? (won ? 'Đối thủ đã rời trận.' : 'Bạn bị xử thua do rời trận.') : (spect ? teamName(e.winner) + ' thắng' : '');
      const ul = $('#over-unlock');
      ul.textContent = unlockText; ul.classList.toggle('hidden', !unlockText);
      const again = $('#btn-again');
      again.disabled = false;
      again.classList.toggle('hidden', spect);
      again.textContent = 'Đấu lại';
      $('#btn-over-menu').textContent = mode === 'offline' ? 'Về menu' : spect ? 'Về sảnh' : 'Về phòng';
      UI.show('scr-over');
      if (!spect) (won ? A.win : A.lose)();
    }, e.reason === 'forfeit' ? 300 : 1100);
  }

  /* ================= Người chơi điều khiển ================= */
  function myContact(t) {
    const la = V.launch;
    if (!me || !la || !V.sim || la.team === myTeam || V.phase !== 'rally') return null;
    if (la.serve && V.receiverId && V.receiverId !== me.id) return null;   // đồng đội đỡ giao
    return Physics.predictContact(la, t, { x: me.x, z: me.z, team: myTeam }, { reach: CONTACT_REACH });
  }
  /** Bắt đầu hoạt ảnh thả bóng của người giao: bóng rơi từ tay trái xuống điểm chạm */
  function startServeDrop(p, contactT, from) {
    p.ch.getHandWorld('L', tmpV);
    p.drop = { t0: now(), t1: contactT, a: { x: tmpV.x, y: tmpV.y, z: tmpV.z }, b: from, rally: V.rallyId };
  }
  function serveContactPoint() {
    const dir = myTeam === 'A' ? -1 : 1;
    return { x: me.x, y: C.SERVE_Y || 0.55, z: me.z + dir * (C.SERVE_FWD || 0.45) };
  }

  /** Nhấn phím đánh: bắt đầu tích lực (chưa vung) */
  function onShotDown(type) {
    A.unlock();
    if (!me || !session || paused) return;
    if (ctl.charge) return;
    ctl.charge = { type, t0: performance.now() };
  }
  /** Thả phím: vung vợt với lực đã tích. Thời điểm vung tính lúc thả. */
  function onShotUp(type) {
    const c = ctl.charge;
    if (!c || c.type !== type) return;
    ctl.charge = null;
    const held = (performance.now() - c.t0) / 1000;
    const power = clamp((held - CHARGE_MIN) / (CHARGE_FULL - CHARGE_MIN), 0, 1);
    onShot(type, power);
  }
  function chargeLevel() {
    if (!ctl.charge) return 0;
    return clamp(((performance.now() - ctl.charge.t0) / 1000 - CHARGE_MIN) / (CHARGE_FULL - CHARGE_MIN), 0, 1);
  }

  function onShot(type, power) {
    A.unlock();
    power = power || 0;
    if (!me || !session || paused) return;
    const t = now();
    if (V.phase === 'serve' && V.serverId === me.id) {
      if (ctl.servePending || ctl.servedRally === V.rallyId) return;
      ctl.servedRally = V.rallyId;
      ctl.servePending = { at: t + SERVE_LEAD, type: type === 'smash' ? 'drive' : type, power };
      const cp = serveContactPoint();
      startServeDrop(me, t + SERVE_LEAD, cp);
      me.ch.swing({ zone: 'serve', contact: cp, timeToContact: SERVE_LEAD });
      serveCard(false);
      if (mode === 'online') net.send({ t: 'swing', contactT: t + SERVE_LEAD, x: cp.x, y: cp.y, z: cp.z, zone: 'serve' });
      return;
    }
    if (ctl.pending || ctl.armed || ctl.cool > 0) return;
    if (V.phase !== 'rally') { me.ch.swing({ zone: 'forehand', contact: null, timeToContact: 0.15 }); ctl.cool = 0.35; return; }
    const c = ctl.frameContact || myContact(t);
    const la = V.launch;
    if (c && c.t - t <= C.CONTACT_MAX_AHEAD + 0.02) {
      // bóng còn đang tới gần (atEdge) -> "đã bấm", chờ tới khi có điểm chạm thật mới khóa
      if (!c.atEdge || c.t - t < 0.25) lockSwing(c, type, t, power);
      else ctl.armed = { type, pressT: t, until: t + 0.8, launchId: la.id, power };
      return;
    }
    // không có điểm chạm hợp lệ -> vung hụt
    me.ch.swing({ zone: 'forehand', contact: null, timeToContact: 0.15 });
    ctl.cool = 0.35; ctl.sw++;
    const incoming = la && la.team !== myTeam && V.sim && V.sim.b.z * (myTeam === 'A' ? 1 : -1) > -2;
    if (incoming && la.hits <= 2 && V.sim.bounces === 0 && !twoBounceHinted) {
      twoBounceHinted = true; UI.hint('Luật 2 nảy: chờ bóng nảy rồi mới đánh!', 3500);
    } else if (incoming) floater('Hụt', 'miss', me.x, 1.9, me.z);
  }

  function lockSwing(c, type, pressT, power) {
    const t = now();
    const lead = Math.max(0, c.t - pressT);
    const zone = Physics.strokeZone(myTeam, me.x, me.z, c.ball, { volley: c.bounces === 0 });
    ctl.pending = { c, type, lead, launchId: V.launch.id, power: power || 0 };
    ctl.armed = null;
    me.ch.swing({ zone, contact: c.ball, timeToContact: Math.max(0.03, c.t - t) });
    ctl.sw++;
    if (mode === 'online') net.send({ t: 'swing', contactT: c.t, x: c.ball.x, y: c.ball.y, z: c.ball.z, zone });
  }

  function fireServe() {
    const sp = ctl.servePending; ctl.servePending = null;
    if (V.phase !== 'serve' || V.serverId !== me.id) return;
    const ax = PP.Input.axes();
    const s = Physics.serveShot({ team: myTeam, type: sp.type, pos: { x: me.x, z: me.z }, boxSign: V.boxSign, aimX: ax.x * flip, errBase: 0.3, rng: Math.random, power: sp.power || 0 });
    const t = now();
    const h = { serve: true, ballT: t, pos: { x: me.x, z: me.z }, from: s.from, v: s.v, spin: s.spin, shot: 'serve' };
    hitFx(s.from, 'serve', 'good', true);
    if (mode === 'online') predict({ id: -1, by: me.id, team: myTeam, from: s.from, v: s.v, spin: s.spin, t0: t, wind: V.wind, hits: 1, serve: true, shot: 'serve', predicted: true });
    session.hit(h);
  }

  function firePending() {
    const p = ctl.pending; ctl.pending = null;
    if (V.phase !== 'rally' || !V.launch || V.launch.id !== p.launchId) return;
    const c = p.c, lead = p.lead;
    let qname, q, perfect = false;
    if (lead >= 0.02 && lead <= 0.13) { qname = 'perfect'; q = 1; perfect = true; }
    else if (lead < 0.02) { qname = 'late'; q = 0.5; }
    else if (lead <= 0.25) { qname = 'good'; q = 0.82; }
    else { qname = 'early'; q = Math.max(0.3, 0.6 - (lead - 0.25)); }
    const ax = PP.Input.axes();
    // sớm -> chéo sân, muộn -> dọc biên
    const bias = clamp((lead - C.PERFECT_LEAD) / 0.35, -1, 1);
    const side = Math.sign(c.ball.x) || 1;
    let aimX = (ax.x !== 0 ? ax.x * flip : (Math.random() * 0.5 - 0.25)) - side * 0.45 * bias;
    aimX = clamp(aimX, -1, 1);
    const s = Physics.computeShot({ team: myTeam, type: p.type, ball: c.ball, aim: { x: aimX, z: ax.y }, quality: q, perfect, power: p.power || 0, errBase: 1.0, rng: Math.random });
    const h = { launchId: V.launch.id, ballT: c.t, pos: { x: me.x, z: me.z }, from: s.from, v: s.v, spin: s.spin, shot: s.type, perfect };
    if (c.bounces === 0) ctl.volleyAt = now();
    hitFx(c.ball, s.type, qname, true);
    let label = { perfect: s.type === 'smash' ? 'SIÊU SMASH!' : 'PERFECT!', good: SHOT_NAME[s.type], early: 'Sớm', late: 'Trễ' }[qname];
    const pw = p.power || 0;
    if (pw > 0.7 && (s.type === 'drive' || s.type === 'smash')) {
      label = (qname === 'perfect' ? 'PERFECT · ' : '') + 'CỰC MẠNH!';
      if (S().shake) shake = Math.max(shake, 0.06 + 0.1 * pw);
    }
    floater(label, qname, me.x, 1.95, me.z);
    if (mode === 'online') predict({ id: -1, by: me.id, team: myTeam, from: s.from, v: s.v, spin: s.spin, t0: c.t, wind: V.wind, hits: V.launch.hits + 1, shot: s.type, perfect, predicted: true });
    session.hit(h);
  }

  function predict(la) {
    V.prevLaunch = V.launch; V.prevPhase = V.phase;
    setLaunch(la, false);
    V.phase = 'rally';
  }

  function updateMe(dt) {
    const t = now();
    const ax = PP.Input.axes();
    let mx = ax.x * flip, mz = -ax.y * flip;
    const m = Math.hypot(mx, mz);
    if (m > 1) { mx /= m; mz /= m; }
    const sg = myTeam === 'A' ? 1 : -1, sp = C.PLAYER_SPEED;
    if (V.phase === 'serve' && V.serverId === me.id) {
      me.vx = ctl.servePending ? 0 : mx * sp * 0.6; me.vz = 0;
      me.x += me.vx * dt;
      me.x = V.serveHalf > 0 ? clamp(me.x, 0.3, 2.8) : clamp(me.x, -2.8, -0.3);
    } else if (V.phase === 'paused' || V.phase === 'over') {
      me.vx = me.vz = 0;
    } else {
      const k = 1 - Math.exp(-dt * 14);
      me.vx += (mx * sp - me.vx) * k; me.vz += (mz * sp - me.vz) * k;
      // hỗ trợ bước tới điểm chạm (tối đa C.ASSIST) khi đã vung
      if (ctl.pending) {
        const c = ctl.pending.c.ball;
        const dx = c.x - me.x, dz = c.z - me.z, d = Math.hypot(dx, dz);
        const want = d - (C.REACH - 0.2);
        if (want > 0) { const st = Math.min(want, 2.5 * dt); me.x += dx / d * st; me.z += dz / d * st; }
      }
      me.x = clamp(me.x + me.vx * dt, -C.BOUND_X, C.BOUND_X);
      me.z = clamp((me.z + me.vz * dt) * sg, C.NET_GAP, C.BOUND_BACK) * sg;
    }
    if (ctl.cool > 0) ctl.cool -= dt;
    ctl.frameContact = ctl.pending ? null : myContact(t);
    if (ctl.armed) {
      const c = ctl.frameContact;
      if (t > ctl.armed.until || !V.launch || V.launch.id !== ctl.armed.launchId) ctl.armed = null;
      else if (c && (!c.atEdge || c.t - t < 0.25)) lockSwing(c, ctl.armed.type, ctl.armed.pressT, ctl.armed.power);
    }
    if (ctl.servePending && t >= ctl.servePending.at) fireServe();
    if (ctl.pending) {
      if (!V.launch || V.launch.id !== ctl.pending.launchId) ctl.pending = null;
      else if (t >= ctl.pending.c.t) firePending();
    }
  }

  function updateBall(dt) {
    if (V.launch && V.sim) {
      const ev = [];
      V.sim.advanceTo(Physics.simTimeOf(V.launch, now()), ev);
      for (const e of ev) {
        if (e.type === 'bounce') { A.bounce(surface); fx.dust(e.x, e.z, surface); }
        else if (e.type === 'net') { A.net(); world.net.shake(e.x, 1); }
        else if (e.type === 'netcord') { A.net(); world.net.shake(e.x, 0.6); floater('Chạm lưới!', 'good', e.x, 1.3, e.z); }
      }
    }
    const k = Math.exp(-dt / 0.06);
    ballOff.x *= k; ballOff.y *= k; ballOff.z *= k;
  }

  /* ================= Phiên chơi Offline ================= */
  class OfflineSession {
    constructor(cfg) {
      this.cfg = cfg; this.t = 0;
      const pool = PP.CHARACTERS.filter((c) => c.id !== Save.data.char).map((c) => c.id).sort(() => Math.random() - 0.5);
      const list = [{ id: 'me', team: 'A', char: Save.data.char, name: 'Bạn', isMe: true, look: myLook() }];
      if (cfg.teamSize === 2) {
        list.push({ id: 'mate', team: 'A', char: pool[0], name: 'Đồng đội', isBot: true, look: botLook() });
        list.push({ id: 'b1', team: 'B', char: pool[1], name: CHAR(pool[1]).name, isBot: true, look: botLook() });
        list.push({ id: 'b2', team: 'B', char: pool[2], name: CHAR(pool[2]).name, isBot: true, look: botLook() });
      } else list.push({ id: 'b1', team: 'B', char: pool[0], name: CHAR(pool[0]).name, isBot: true, look: botLook() });
      this.list = list;
      this.match = new PP.Match({ teamSize: cfg.teamSize, target: cfg.target, scoring: cfg.scoring, venue: cfg.venue,
        seed: (Math.random() * 1e9) | 0, grace: 0, players: list });
      this.bots = list.filter((p) => p.isBot).map((p, i) => new PP.BotBrain(this.match.player(p.id),
        p.team === 'A' ? 'pro' : cfg.level, Physics.mulberry32((Math.random() * 1e9) | i)));
    }
    now() { return this.t; }
    start() { this.match.start(0, Math.random() < 0.5 ? 'A' : 'B'); this.flush(); }
    update(dt) {
      this.t += dt;
      const m = this.match, t = this.t;
      if (me) m.setPlayerState(me.id, me.x, me.z, me.vx, me.vz);
      m.update(t);
      for (const b of this.bots) {
        const v = players.get(b.p.id);
        // lên lịch hoạt ảnh vung theo ý định của bot
        const it = b.intent;
        if (it && m.launch && it.launchId === m.launch.id && v.swingKey !== 'L' + it.launchId && it.t - t <= 0.26) {
          v.swingKey = 'L' + it.launchId;
          v.ch.swing({ zone: it.zone, contact: { x: it.x, y: it.y, z: it.z }, timeToContact: Math.max(0.03, it.t - t) });
        }
        if (m.phase === 'serve' && m.serverId === b.p.id && isFinite(b.serveAt) && v.swingKey !== 'R' + m.rallyId + 's' && b.serveAt - t <= SERVE_LEAD) {
          v.swingKey = 'R' + m.rallyId + 's';
          const dir = b.p.team === 'A' ? -1 : 1;
          const cp = { x: b.p.x, y: C.SERVE_Y || 0.55, z: b.p.z + dir * (C.SERVE_FWD || 0.45) };
          startServeDrop(v, b.serveAt, cp);
          v.ch.swing({ zone: 'serve', contact: cp, timeToContact: Math.max(0.03, b.serveAt - t) });
        }
        const h = b.tick(dt, t, m);
        if (h) m.tryHit(b.p.id, h, t, false);
      }
      for (const b of this.bots) {
        const v = players.get(b.p.id);
        v.x = b.p.x; v.z = b.p.z; v.vx = b.p.vx; v.vz = b.p.vz;
      }
      this.flush();
    }
    flush() { for (const e of this.match.drain()) applyEvent(e); }
    hit(h) { const r = this.match.tryHit(me.id, h, this.t, false); this.flush(); return r; }
  }

  /* ================= Phiên chơi Online ================= */
  class OnlineSession {
    constructor(start) { this.matchId = start.matchId; this.inputT = 0; }
    now() { return net ? net.serverNow() : 0; }
    update(dt) {
      this.inputT += dt;
      if (me && this.inputT >= 0.05) {
        this.inputT = 0;
        const r = (v) => Math.round(v * 1000) / 1000;
        net.send({ t: 'input', rid: V.rallyId, x: r(me.x), z: r(me.z), vx: r(me.vx), vz: r(me.vz), sw: ctl.sw });
      }
      const rt = this.now() - 0.08;
      for (const p of players.values()) {
        if (p.isMe || p.buf.length === 0) continue;
        const buf = p.buf;
        let a = buf[0], b = buf[buf.length - 1];
        for (let i = 0; i < buf.length - 1; i++) if (buf[i].ts <= rt && buf[i + 1].ts >= rt) { a = buf[i]; b = buf[i + 1]; break; }
        if (rt >= b.ts) { const ex = Math.min(0.2, rt - b.ts); p.x = b.x + b.vx * ex; p.z = b.z + b.vz * ex; p.vx = b.vx; p.vz = b.vz; }
        else if (rt <= a.ts) { p.x = a.x; p.z = a.z; }
        else { const k = (rt - a.ts) / (b.ts - a.ts || 1); p.x = a.x + (b.x - a.x) * k; p.z = a.z + (b.z - a.z) * k; p.vx = b.vx; p.vz = b.vz; }
      }
    }
    hit(h) { net.send(Object.assign({ t: 'hit' }, h)); return { ok: true }; }
  }

  /* ================= Hiển thị mỗi khung hình ================= */
  function updateVisuals(dt) {
    const bp = (V.launch && V.sim && mode !== 'menu') ? currentBallPos() : null;
    const look = bp;
    for (const p of players.values()) {
      let md = 'ready';
      if (mode === 'menu') md = 'idle';
      else if (V.phase === 'serve') md = p.id === V.serverId ? 'serve' : 'ready';
      else if (V.phase === 'point' && V.lastPoint) md = p.team === V.lastPoint.winner ? 'celebrate' : 'sad';
      else if (V.phase === 'over' || V.phase === 'idle') md = 'idle';
      const dropping = p.drop && p.drop.rally === V.rallyId;
      const hold = V.phase === 'serve' && p.id === V.serverId && mode !== 'menu' && !dropping;
      p.ch.update(dt, { x: p.x, z: p.z, vx: p.vx, vz: p.vz, look, mode: md, holdBall: hold });
    }
    if (mode === 'menu') { ball.update(dt, { x: 0, y: -5, z: 0 }, null, 'hidden', camera, 0); ring.update(0, 0, null, dt); land.update(null, time); boxHint.update(null, time); bursts.update(dt, camera); fx.update(dt); return; }

    // bóng
    if (V.phase === 'serve') {
      const sp = players.get(V.serverId);
      if (sp && sp.drop && sp.drop.rally === V.rallyId) {
        const d = sp.drop, k = clamp((now() - d.t0) / Math.max(0.05, d.t1 - d.t0), 0, 1), e = k * k;
        ball.update(dt, { x: d.a.x + (d.b.x - d.a.x) * e, y: d.a.y + (d.b.y - d.a.y) * e, z: d.a.z + (d.b.z - d.a.z) * e }, null, 'held', camera, 0);
      } else if (sp) { sp.ch.getHandWorld('L', tmpV); ball.update(dt, { x: tmpV.x, y: tmpV.y, z: tmpV.z }, null, 'held', camera, 0); }
      else ball.update(dt, { x: 0, y: -5, z: 0 }, null, 'hidden', camera, 0);
    } else if (bp) {
      const b = V.sim.b;
      const sp2 = Math.hypot(b.vx, b.vy, b.vz);
      ball.update(dt, bp, { x: b.vx, y: b.vy, z: b.vz }, sp2 > 0.3 ? 'flight' : 'rest', camera, V.launch.spin || 0);
    } else ball.update(dt, { x: 0, y: -5, z: 0 }, null, 'hidden', camera, 0);

    // dấu điểm rơi
    const la = V.launch;
    const showLand = S().landing && V.phase === 'rally' && la && V.landing && V.sim && V.sim.bounces === 0 && (mode === 'spectate' || la.team !== myTeam);
    land.update(showLand ? { x: V.landing.x, z: V.landing.z } : null, time);
    // gợi ý ô giao bóng
    if (V.phase === 'serve' && me && (V.serverId === me.id || players.get(V.serverId)?.team !== myTeam)) {
      const rt = other(V.serverTeam), zs = rt === 'A' ? 1 : -1;
      const x0 = V.boxSign > 0 ? 0 : -C.W, x1 = V.boxSign > 0 ? C.W : 0;
      const za = zs * C.K, zb = zs * C.L;
      boxHint.update({ x0, x1, z0: Math.min(za, zb), z1: Math.max(za, zb) }, time);
    } else boxHint.update(null, time);
    // vòng canh thời điểm (theo thời gian)
    let prog = null;
    if (me && S().ring && V.phase === 'rally') {
      const t = now();
      const c = ctl.pending ? ctl.pending.c : ctl.frameContact;
      if (c) prog = clamp((c.t - t - C.PERFECT_LEAD) / (C.CONTACT_MAX_AHEAD - C.PERFECT_LEAD), 0, 1);
    }
    if (me) ring.update(me.x, me.z, prog, dt); else ring.update(0, 0, null, dt);
    bursts.update(dt, camera);
    // bụi khi chạy nhanh
    ctl.dustT -= dt;
    if (ctl.dustT <= 0) {
      ctl.dustT = 0.22;
      for (const p of players.values()) if (Math.hypot(p.vx, p.vz) > 4) fx.dust(p.x, p.z, surface);
    }
    fx.update(dt);
    // đồng hồ giao bóng 10 giây
    if (V.phase === 'serve' && me && V.serverId === me.id && !ctl.servePending && V.serveDeadline) {
      const left = Math.ceil(V.serveDeadline - now());
      const card = $('#serve-card');
      let clk = card.querySelector('.clk');
      if (left <= 5 && left >= 0) {
        if (!clk) { clk = document.createElement('div'); clk.className = 'clk'; card.append(clk); }
        clk.textContent = '⏱ Còn ' + left + ' giây (quá 10 giây là lỗi giao)';
      } else if (clk) clk.remove();
    }
    // thanh lực
    const cg = $('#charge');
    if (me && ctl.charge) {
      const lv = chargeLevel();
      tmpV.set(me.x, 2.15, me.z).project(camera);
      cg.style.left = ((tmpV.x * 0.5 + 0.5) * window.innerWidth) + 'px';
      cg.style.top = ((-tmpV.y * 0.5 + 0.5) * window.innerHeight) + 'px';
      $('#charge-fill').style.width = Math.round(lv * 100) + '%';
      $('#charge-label').textContent = lv >= 1 ? 'TỐI ĐA' : 'Lực';
      cg.classList.toggle('full', lv >= 1);
      cg.classList.remove('hidden');
    } else cg.classList.add('hidden');
    // nhãn tên
    for (const p of players.values()) {
      if (!p.tag) continue;
      tmpV.set(p.x, 1.9, p.z).project(camera);
      const vis = tmpV.z < 1;
      p.tag.style.display = vis ? '' : 'none';
      if (vis) { p.tag.style.left = ((tmpV.x * 0.5 + 0.5) * window.innerWidth) + 'px'; p.tag.style.top = ((-tmpV.y * 0.5 + 0.5) * window.innerHeight) + 'px'; }
      p.tagDot.style.display = V.serverId === p.id && V.phase !== 'idle' ? '' : 'none';
    }
  }

  function updateCamera(dt) {
    if (mode === 'menu') {
      menuT += dt;
      const a = -0.85 + menuT * 0.045;
      camPos.set(Math.sin(a) * 13.5, 7.4, Math.cos(a) * 13.5);
      camLook.set(0, 0.2, 0);
    } else {
      const aspect = camera.aspect;
      const portrait = aspect < 0.9, shortL = aspect > 1 && window.innerHeight <= 500;
      const px = me ? me.x * flip : 0, pz = me ? me.z * flip : C.L;
      const n = portrait ? 8.4 : shortL ? 7.6 : 6.2;
      const a = portrait ? 12.6 : shortL ? 13.1 : 12.4;
      const s = portrait ? 8.6 : 5.9;
      const camZ = a + (Math.max(s, pz + (portrait ? 2 : 0.9)) - s);
      const ang = Math.atan2(n, a - s) - (camera.fov / 2) * Math.PI / 180;
      const lookZ = camZ - n / Math.tan(Math.max(0.2, ang));
      // Giữ quả bóng trong khung hình: nếu bóng sắp ra khỏi màn hình (bóng sâu sau lưng, lob qua đầu),
      // lùi camera ra sau + nâng lên từng bước cho tới khi thấy được bóng.
      let back = 0, lift = 0;
      const bp = (V.launch && V.sim && (V.phase === 'rally' || V.phase === 'point')) ? currentBallPos() : null;
      const lx = 0.2 * px * flip, lz = lookZ * flip;
      const cx = px * (portrait ? 0.25 : 0.4) * flip;
      if (bp) {
        camTest.fov = camera.fov; camTest.aspect = camera.aspect; camTest.updateProjectionMatrix();
        for (let i = 0; i < 10; i++) {
          camTest.position.set(cx, n + lift, (camZ + back) * flip);
          camTest.lookAt(lx, 0, lz);
          camTest.updateMatrixWorld();
          tmpV2.set(bp.x, bp.y, bp.z).project(camTest);
          if (Math.abs(tmpV2.x) < 0.9 && tmpV2.y > -0.86 && tmpV2.y < 0.8 && tmpV2.z < 1) break;
          back += 0.7; lift += 0.35;
        }
      }
      const k = 1 - Math.exp(-dt * (back > 0 ? 9 : 3.5));
      camPos.lerp(tmpV.set(cx, n + lift, (camZ + back) * flip), k);
      camLook.lerp(tmpV.set(lx, 0, lz), k);
    }
    shake += (0 - shake) * (1 - Math.exp(-9 * dt));
    camera.position.copy(camPos);
    if (shake > 0.002) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; }
    camera.lookAt(camLook);
  }

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 1 / 30);
    time += dt;
    PP.Input.poll();
    if (session && !paused) {
      if (hitStop > 0) hitStop -= dt;
      else {
        if (me) updateMe(dt);
        session.update(dt);
        updateBall(dt);
      }
    }
    if (scene) {
      world.update(dt, time);
      updateRulesPanel(dt);
      updateCamera(dt);
      updateVisuals(dt);   // sau camera: vệt bóng quay mặt về camera
      renderer.render(scene, camera);
    }
  }

  /* ================= HUD ================= */
  function updateHUD() {
    const L = mode === 'spectate' ? 'A' : myTeam, R = other(L);
    $('#hud-l-score').textContent = V.score[L];
    $('#hud-r-score').textContent = V.score[R];
    $('#hud-l-dot').classList.toggle('on', V.serverTeam === L);
    $('#hud-r-dot').classList.toggle('on', V.serverTeam === R);
    $('#hud-l-name').textContent = teamName(L);
    $('#hud-r-name').textContent = teamName(R);
    const firstOf = (t) => (t === myTeam && me) ? me : [...players.values()].find((p) => p.team === t);
    const fl = firstOf(L), fr = firstOf(R);
    const setAva = (sel, p) => { const el = $(sel); el.textContent = ''; if (p) el.append(UI.avatarEl(p.char, 'em')); };
    setAva('#hud-l-ava', fl); setAva('#hud-r-ava', fr);
    $('#hud-target').textContent = 'Chạm ' + V.target + (V.scoring === 'sideout' ? ' · Truyền thống' + (V.serverNum ? ' · Giao ' + V.serverNum : '') : ' · Rally');
    const w = V.wind || { x: 0, z: 0 }, wm = Math.hypot(w.x, w.z);
    $('#hud-wind').textContent = wm < 0.05 ? 'Không gió' : 'Gió ' + (w.x * flip >= 0 ? '→' : '←') + ' ' + wm.toFixed(1);
  }
  function showHUD(on) {
    $('#hud').classList.toggle('hidden', !on);
    const touch = on && PP.Input.isTouch() && mode !== 'spectate';
    $('#touch').classList.toggle('hidden', !touch);
    document.body.classList.toggle('touch', PP.Input.isTouch());
    if (!on) { serveCard(false); $('#floaters').textContent = ''; }
  }

  /* ================= Điều hướng ================= */
  function endSession() {
    session = null; me = null; paused = false; hitStop = 0;
    resetView();
    showHUD(false);
    UI.banner(null); UI.setMsg(''); UI.hideCall();
    if (net) net.watch = false;
  }
  function goMenu() {
    endSession();
    if (net) { net.send({ t: 'queue_leave' }); if (room) net.send({ t: 'room_leave' }); net.close(); net = null; room = null; }
    mode = 'menu';
    buildMenuScene();
    refreshMainStats();
    UI.show('scr-main');
  }
  function refreshMainStats() {
    const d = Save.data;
    $('#main-stats').textContent = `Thắng ${d.wins} · Thua ${d.losses}`;
    $('#btn-sound').textContent = d.muted ? '🔇 Âm thanh: Tắt' : '🔊 Âm thanh: Bật';
  }

  function startOffline() {
    endSession();
    const d = Save.data;
    const teamSize = +d.mode === 2 ? 2 : 1;
    const cfg = { teamSize, level: d.level, venue: d.venue, target: +d.target, scoring: d.scoring === 'rally' ? 'rally' : 'sideout' };
    mode = 'offline';
    session = new OfflineSession(cfg);
    resetView({ teamSize, target: cfg.target, scoring: cfg.scoring, venue: cfg.venue });
    buildScene(cfg.venue, session.list, teamSize === 2);
    me = players.get('me'); myTeam = 'A'; flip = 1;
    twoBounceHinted = false;
    UI.hideScreens();
    showHUD(true);
    $('#hud-ping').classList.add('hidden');
    A.ambience && A.ambience(true, cfg.venue);
    initRulesPanelForMatch();
    session.start();
    updateHUD();
  }

  function togglePause() {
    if (!session) return;
    if (UI.visible('scr-over') || UI.visible('scr-settings')) return;
    if (UI.visible('scr-pause')) { resume(); return; }
    if (mode === 'offline') paused = true;
    $('#pause-online-note').classList.toggle('hidden', mode === 'offline');
    $('#btn-restart').classList.toggle('hidden', mode !== 'offline');
    $('#btn-quit').textContent = mode === 'offline' ? 'Về menu' : mode === 'spectate' ? 'Thôi xem' : 'Rời trận (bị xử thua)';
    UI.show('scr-pause');
  }
  function resume() {
    UI.hideScreens();
    paused = false;
    clock.getDelta();
  }

  /* ================= Bảng mẹo luật chơi ================= */
  let rulesText = '', rulesCheckT = 0;
  function rulesTip() {
    const sg = myTeam === 'A' ? 1 : -1, la = V.launch;
    if (mode === 'spectate' || !me) return ['Đang xem trực tiếp. Bên giao bóng có chấm vàng trên bảng điểm.', false];
    if (V.phase === 'serve') {
      if (V.serverId === me.id) {
        const even = V.score[myTeam] % 2 === 0;
        return [`Lượt giao của bạn: giao tay dưới, đánh chéo sang ô đối diện, bóng phải qua vùng bếp. Điểm đội bạn ${even ? 'chẵn → đứng ô phải' : 'lẻ → đứng ô trái'}.`, false];
      }
      const sp = players.get(V.serverId);
      if (sp && sp.team === myTeam) return ['Đồng đội giao. Sau cú giao, cú trả của đối thủ phải được để nảy 1 lần rồi mới đánh.', false];
      if (V.receiverId && V.receiverId !== me.id) return ['Đồng đội (ô chéo) là người đỡ giao – bạn KHÔNG được đánh quả giao này.', false];
      return ['Chuẩn bị đỡ giao: phải để bóng nảy 1 lần rồi mới đánh trả (luật 2 nảy).', false];
    }
    if (V.phase === 'point' && V.lastPoint) {
      const e = V.lastPoint;
      if (V.scoring === 'sideout') {
        if (e.sideOut) return [e.call === 'ĐÀ VÀO BẾP' ? 'Lỗi trớn: sau cú vô-lê, đà chạy đưa người vào vùng bếp.' : e.call === 'SAI NGƯỜI ĐỠ GIAO' ? 'Chỉ người ở ô chéo được đỡ giao.' : 'Bên nhận thắng pha nên chỉ giành quyền giao, không được điểm (chỉ bên giao mới ghi điểm).', false];
        if (e.winner !== e.serverTeam) return ['Người giao thứ 1 mất lượt → đồng đội giao tiếp. Không ai được điểm.', false];
        if (e.call === 'QUÁ 10 GIÂY') return ['Người giao phải giao trong 10 giây sau khi xướng điểm, quá giờ là lỗi giao.', false];
        return ['Bên giao thắng pha → +1 điểm và tiếp tục giao, người giao đổi sang ô bên kia.', false];
      }
      return ['Luật Rally: pha nào thắng cũng được 1 điểm – riêng điểm kết thúc ván chỉ được ghi khi đang giao.', false];
    }
    if (V.phase === 'rally' && la && V.sim) {
      const incoming = la.team !== myTeam;
      const inKitchen = Math.abs(me.z) < C.K + (C.KITCHEN_FOOT || 0) + 0.05;
      if (ctl.volleyAt && now() - ctl.volleyAt < 0.8) return ['Vừa vô-lê: đừng để trớn chạy vào vùng bếp, kể cả khi bóng đã chết!', true];
      if (incoming && la.hits === 1 && V.receiverId && V.receiverId !== me.id) return ['Đồng đội đỡ giao – bạn đứng yên, không đánh quả này.', false];
      if (incoming && la.hits === 1) return ['Luật 2 nảy: chờ bóng giao NẢY rồi mới đánh trả.', false];
      if (incoming && la.hits === 2) return ['Luật 2 nảy: bên giao cũng phải để cú trả giao NẢY 1 lần rồi mới đánh.', false];
      if (incoming && inKitchen && V.sim.bounces === 0) return ['⚠️ Bạn đang đứng trong vùng bếp: đợi bóng nảy rồi mới đánh. Vô-lê ở đây là lỗi!', true];
      if (incoming) return ['Từ cú thứ 3 được đánh vô-lê (trên không) – nhưng không được đứng trong vùng bếp. Nhìn vòng cam để biết điểm rơi.', false];
      return ['Lùi về hoặc tiến lên vạch bếp chờ bóng. Bóng ra ngoài / vào lưới / nảy 2 lần bên mình là mất pha.', false];
    }
    return ['Chỉ bên giao bóng mới ghi điểm. Chạm ' + V.target + ' và hơn 2 điểm thì thắng.', false];
  }
  function updateRulesPanel(dt) {
    const panel = $('#rules-panel');
    const show = S().rules && session && (mode === 'offline' || mode === 'online' || mode === 'spectate');
    panel.classList.toggle('hidden', !show);
    if (!show || panel.classList.contains('collapsed')) return;
    rulesCheckT -= dt;
    if (rulesCheckT > 0) return;
    rulesCheckT = 0.2;
    const [txt, warn] = rulesTip();
    if (txt !== rulesText) {
      rulesText = txt;
      $('#rules-now-text').textContent = txt;
      const box = panel.querySelector('.rules-now');
      box.classList.toggle('warn', warn);
      box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash');
    }
  }
  function initRulesPanelForMatch() {
    Save.data.matchesStarted = (Save.data.matchesStarted || 0) + 1;
    Save.save();
    // 3 trận đầu: mở sẵn để người mới đọc; sau đó thu gọn thành nút 📘
    $('#rules-panel').classList.toggle('collapsed', Save.data.matchesStarted > 3);
    rulesText = '';
  }

  /* ================= Cài đặt ================= */
  let settingsBack = 'scr-main';
  function openSettings() {
    settingsBack = UI.visible('scr-pause') ? 'scr-pause' : 'scr-main';
    const st = S();
    UI.seg($('#set-quality'), st.quality, (v) => {
      st.quality = v; Save.save();
      PP.World.applyQuality(renderer, quality());
      UI.toast('Đã chuyển đồ họa: ' + ({ low: 'Thấp', medium: 'Vừa', high: 'Cao' })[quality()]);
    });
    $('#set-volume').value = st.volume;
    $('#set-volume').oninput = () => { st.volume = +$('#set-volume').value; A.setVolume && A.setVolume(st.volume / 100); Save.save(); };
    const bindCheck = (id, key) => { const el = $(id); el.checked = !!st[key]; el.onchange = () => { st[key] = el.checked; Save.save(); }; };
    bindCheck('#set-ring', 'ring'); bindCheck('#set-landing', 'landing'); bindCheck('#set-hitstop', 'hitstop'); bindCheck('#set-shake', 'shake'); bindCheck('#set-rules', 'rules');
    UI.show('scr-settings');
  }
  function closeSettings() {
    A.click();
    if (settingsBack === 'scr-pause' && session) UI.show('scr-pause');
    else if (session) resume();
    else UI.show('scr-main');
  }

  /* ================= Ảnh chân dung ================= */
  function loadPortraits() {
    if (!PP.Character.portraits || softwareGL) return;   // máy không GPU: dùng emoji, tránh vài giây đứng hình
    PP.Character.portraits(PP.CHARACTERS, 128, Save.data.looks).then((map) => {
      PP.Portraits = map;
      if (UI.visible('scr-setup')) openSetup();
      if (UI.visible('scr-profile')) openProfile();
      if (session) updateHUD();
    }).catch(() => { /* giữ emoji */ }).then(loadVenueThumbs);
  }
  function loadVenueThumbs() {
    if (!PP.World.thumbnails || PP.VenueThumbs || softwareGL) return;
    PP.World.thumbnails(renderer, PP.VENUES.map((v) => v.id), 320, 180).then((map) => {
      PP.VenueThumbs = map;
      if (UI.visible('scr-setup')) UI.venueList($('#setup-venue'), Save.data.venue, (v) => { Save.data.venue = v; Save.save(); setupSummary(); });
      if (room) renderRoom();
    }).catch(() => { /* giữ ô màu */ });
  }
  function refreshPortrait(id) {
    if (!PP.Character.portraits) return;
    PP.Character.portraits([CHAR(id)], 128, { [id]: myLook(id) }).then((m) => {
      PP.Portraits = PP.Portraits || new Map();
      const u = m.get(id); if (u) PP.Portraits.set(id, u);
      if (UI.visible('scr-setup')) openSetup();
      if (UI.visible('scr-profile')) openProfile();
    }).catch(() => {});
  }

  /* ================= Tủ đồ ================= */
  let wdPreview = null, wdChar = 'bunny', wdBack = 'scr-main';
  const COLOR_KEYS = [['shirt', 'Áo'], ['shorts', 'Quần'], ['accent', 'Viền'], ['shoes', 'Giày'], ['paddle', 'Vợt']];
  const FALLBACK_PALETTE = ['#ffffff', '#2b2d42', '#ff6f91', '#ff9f1c', '#ffd23f', '#9ad06a', '#2ec4b6', '#4cc9f0', '#3f8cff', '#5468d9', '#9b5de5', '#e63946', '#8d5a3c', '#ffb3c7', '#b5e48c', '#a0c4ff'];
  const hex = (v) => (typeof v === 'number' ? '#' + v.toString(16).padStart(6, '0') : String(v || '#ffffff')).toLowerCase();
  function setLook(patch) {
    Save.data.looks[wdChar] = Object.assign({}, Save.data.looks[wdChar] || {}, patch);
    Save.save();
    wdRefresh();
  }
  function openWardrobe() {
    closeSetupPreview();
    const vis = ['scr-setup', 'scr-profile', 'scr-main'].find((id) => UI.visible(id));
    wdBack = vis || 'scr-main';
    wdChar = Save.data.char;
    UI.show('scr-wardrobe');
    if (!wdPreview && PP.Character.createPreview) {
      try { wdPreview = PP.Character.createPreview($('#wardrobe-canvas')); } catch (e) { wdPreview = null; }
    }
    wdRender();
  }
  function wdSeg(el, items, key) {
    el.textContent = '';
    for (const it of items) { const b = document.createElement('button'); b.dataset.v = it.id; b.textContent = it.name; el.append(b); }
    return UI.seg(el, fullLook(wdChar)[key], (v) => setLook({ [key]: v }));
  }
  function wdRender() {
    const O = PP.Character.OPTIONS || {};
    UI.charGrid($('#wd-chars'), wdChar, Save.data.wins, (id) => { wdChar = id; Save.data.char = id; Save.save(); wdRender(); });
    const box = $('#wd-colors'); box.textContent = '';
    const h = document.createElement('h3'); h.textContent = 'Màu sắc'; box.append(h);
    const palette = (O.palette && O.palette.length ? O.palette : FALLBACK_PALETTE).map(hex);
    for (const [key, label] of COLOR_KEYS) {
      const row = document.createElement('div'); row.className = 'color-row'; row.dataset.key = key;
      const l = document.createElement('span'); l.className = 'lbl'; l.textContent = label; row.append(l);
      for (const c of palette) {
        const b = document.createElement('button'); b.className = 'sw-btn'; b.style.background = c; b.dataset.c = c; b.title = c;
        b.onclick = () => { A.click(); setLook({ [key]: c }); };
        row.append(b);
      }
      const inp = document.createElement('input'); inp.type = 'color'; inp.title = 'Màu tự chọn';
      inp.oninput = () => setLook({ [key]: inp.value.toLowerCase() });
      row.append(inp);
      box.append(row);
    }
    wdSeg($('#wd-shirtstyle'), O.shirtStyles || [{ id: 'tee', name: 'Áo thun' }], 'shirtStyle');
    wdSeg($('#wd-pattern'), O.patterns || [{ id: 'solid', name: 'Trơn' }], 'pattern');
    const acc = $('#wd-acc'); acc.textContent = '';
    for (const a of (O.accessories || [])) {
      const locked = (a.unlock || 0) > Save.data.wins;
      const b = document.createElement('button'); b.dataset.v = a.id;
      b.textContent = (locked ? '🔒 ' : '') + a.name;
      if (locked) { b.classList.add('locked'); b.title = 'Thắng ' + a.unlock + ' trận để mở'; }
      b.onclick = () => { if (locked) { UI.toast('Thắng ' + a.unlock + ' trận để mở khóa ' + a.name); return; } A.click(); setLook({ accessory: a.id }); };
      acc.append(b);
    }
    $('#wd-number').onchange = () => { const n = Math.max(0, Math.min(99, Math.round(+$('#wd-number').value || 0))); setLook({ number: n }); };
    wdRefresh();
  }
  function wdRefresh() {
    const look = fullLook(wdChar);
    $('#wd-name').textContent = CHAR(wdChar).name;
    UI.$$('#wd-colors .color-row').forEach((row) => {
      const cur = hex(look[row.dataset.key]);
      row.querySelectorAll('.sw-btn').forEach((b) => b.classList.toggle('sel', b.dataset.c === cur));
      row.querySelector('input').value = /^#[0-9a-f]{6}$/.test(cur) ? cur : '#ffffff';
    });
    UI.$$('#wd-acc button').forEach((b) => b.classList.toggle('sel', b.dataset.v === (look.accessory || 'default')));
    UI.$$('#wd-shirtstyle button').forEach((b) => b.classList.toggle('sel', b.dataset.v === look.shirtStyle));
    UI.$$('#wd-pattern button').forEach((b) => b.classList.toggle('sel', b.dataset.v === look.pattern));
    $('#wd-number').value = look.number != null ? look.number : 0;
    if (wdPreview) wdPreview.set(CHAR(wdChar), look);
  }
  function wdRandom() {
    const O = PP.Character.OPTIONS || {};
    const palette = (O.palette && O.palette.length ? O.palette : FALLBACK_PALETTE).map(hex);
    const look = {};
    for (const [key] of COLOR_KEYS) look[key] = pickOne(palette);
    if (O.patterns) look.pattern = pickOne(O.patterns).id;
    if (O.shirtStyles) look.shirtStyle = pickOne(O.shirtStyles).id;
    if (O.accessories) look.accessory = pickOne(O.accessories.filter((a) => (a.unlock || 0) <= Save.data.wins)).id;
    look.number = (Math.random() * 100) | 0;
    Save.data.looks[wdChar] = look; Save.save();
    wdRender();
  }
  function closeWardrobe() {
    A.click();
    if (wdPreview) { try { wdPreview.dispose(); } catch (e) { /* bỏ qua */ } wdPreview = null; }
    refreshPortrait(wdChar);
    if (net) net.send({ t: 'set_profile', name: Save.data.name || 'Người chơi', char: Save.data.char, look: myLook() });
    if (mode === 'menu') buildMenuScene();
    if (wdBack === 'scr-setup') openSetup();
    else if (wdBack === 'scr-profile') openProfile();
    else { refreshMainStats(); UI.show('scr-main'); }
  }

  /* ================= Online: sảnh, phòng ================= */
  let net = null, room = null, pendingRoom = null, queueStart = 0, queueTimer = 0;

  function ensureNet() {
    if (net) return net;
    net = new PP.NetClient({
      onOpen() { net.send({ t: 'hello', deviceId: Save.data.deviceId, name: Save.data.name, char: Save.data.char, look: myLook(), version: Protocol.PROTOCOL_VERSION }); },
      onMessage: onNet,
      onStatus(s) {
        const pill = $('#online-ping');
        if (s !== 'open') { pill.textContent = s === 'reconnecting' ? '● đang kết nối lại…' : '● đang kết nối…'; pill.className = 'pill bad'; }
        if (mode === 'online' || mode === 'spectate') UI.banner(s === 'open' ? null : 'Mất kết nối, đang kết nối lại…');
      },
      onPing(ms) {
        const cls = ms < 90 ? 'good' : ms < 200 ? 'mid' : 'bad';
        const pill = $('#online-ping'); pill.textContent = '● ' + ms + ' ms'; pill.className = 'pill ' + cls;
        const hp = $('#hud-ping'); hp.textContent = ms + ' ms' + (ms > 400 ? ' · Mạng chậm' : ''); hp.className = 'pill small ' + cls;
        if (mode !== 'online' && mode !== 'spectate') hp.classList.add('hidden');
      },
    });
    net.connect();
    return net;
  }

  function goOnline() {
    if (IS_FILE) { UI.toast('Hãy mở game qua server (http/https) để chơi online. Chế độ chơi với bot vẫn dùng được.', 4000); return; }
    if (!Save.data.name) { openProfile(); return; }
    ensureNet();
    $('#online-me').textContent = `${CHAR(Save.data.char).emoji} ${Save.data.name}`;
    UI.show('scr-online');
    net.send({ t: 'list_live' }); net.send({ t: 'leaderboard' });
  }
  function openProfile() {
    $('#profile-name').value = Save.data.name || '';
    UI.charGrid($('#profile-chars'), Save.data.char, Save.data.wins, (id) => { Save.data.char = id; });
    UI.show('scr-profile');
    setTimeout(() => $('#profile-name').focus(), 50);
  }

  function onNet(m) {
    switch (m.t) {
      case 'welcome':
        myPid = m.playerId;
        if (UI.visible('scr-queue')) { stopQueueTimer(); UI.show('scr-online'); UI.toast('Mất kết nối khi đang tìm trận, hãy tìm lại nhé'); }
        if (pendingRoom) { net.send({ t: 'room_join', code: pendingRoom }); pendingRoom = null; }
        net.send({ t: 'list_live' }); net.send({ t: 'leaderboard' });
        break;
      case 'error':
        UI.toast(m.message || 'Có lỗi xảy ra');
        if (m.code === 'version') UI.banner('Game đã có bản mới. Vui lòng tải lại trang.');
        if (m.code === 'room_not_found' || m.code === 'room_full') { if (!session) UI.show('scr-online'); }
        break;
      case 'queue_status':
        if (m.waiting === false) { stopQueueTimer(); if (!session && !room) UI.show('scr-online'); break; }
        $('#queue-title').textContent = 'Đang tìm trận ' + m.mode + '…';
        $('#queue-info').textContent = 'Đang có ' + (m.count || 1) + ' người chờ';
        if (!UI.visible('scr-queue')) { queueStart = performance.now(); startQueueTimer(); UI.show('scr-queue'); }
        break;
      case 'room_state':
        room = m;
        stopQueueTimer();
        renderRoom();
        if (!session) UI.show('scr-room');
        break;
      case 'room_left':
        room = null;
        if (!session) UI.show('scr-online');
        break;
      case 'chat': addChat(m.name, m.text, m.sys); break;
      case 'match_start': startOnlineMatch(m); break;
      case 'sync': if (session) applySync(m.snapshot); break;
      case 'serve_setup': case 'launch': case 'point': case 'over': case 'paused':
        if (session && session.matchId === m.matchId) applyEvent(m);
        break;
      case 'state':
        if (!session || session.matchId !== m.matchId) break;
        for (const s of m.players) {
          const p = players.get(s.id);
          if (!p || p.isMe) continue;
          p.buf.push({ ts: m.ts, x: s.x, z: s.z, vx: s.vx, vz: s.vz });
          if (p.buf.length > 24) p.buf.shift();
          p.sw = s.sw;
        }
        break;
      case 'swing': {
        if (!session || session.matchId !== m.matchId) break;
        const p = players.get(m.id);
        if (!p || p.isMe) break;
        const tt = m.contactT - now();
        if (tt < -0.05) break;
        p.swingKey = m.zone === 'serve' ? 'R' + V.rallyId + 's' : 'L' + (V.launch ? V.launch.id : 0);
        if (m.zone === 'serve') startServeDrop(p, m.contactT, { x: m.x, y: m.y, z: m.z });
        p.ch.swing({ zone: m.zone, contact: { x: m.x, y: m.y, z: m.z }, timeToContact: Math.max(0.03, tt) });
        break;
      }
      case 'hit_rejected':
        if (V.launch && V.launch.predicted) {
          setLaunch(V.prevLaunch, false);
          V.phase = V.prevPhase || V.phase;
          if (V.phase === 'serve') ctl.servedRally = -1;
        }
        break;
      case 'player_status': {
        const p = players.get(m.id);
        if (!session) break;
        if (m.connected) UI.banner(null);
        else UI.banner(`${p ? p.name : 'Người chơi'} mất kết nối. Chờ tối đa ${m.graceSec}s…`);
        break;
      }
      case 'player_replaced': {
        const p = players.get(m.id);
        if (p) { p.isBot = true; p.name = m.name; }
        UI.banner(null);
        UI.toast(m.name + ' thay thế người chơi đã rời trận');
        updateHUD();
        break;
      }
      case 'live_list': renderLive(m.matches); break;
      case 'leaderboard': renderLeaderboard(m.top); break;
      case 'server_restart': UI.toast('Server đang cập nhật, đang kết nối lại…', 5000); break;
    }
  }

  function startQueueTimer() {
    stopQueueTimer();
    queueTimer = setInterval(() => {
      const s = Math.floor((performance.now() - queueStart) / 1000);
      $('#queue-time').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }, 250);
  }
  function stopQueueTimer() { clearInterval(queueTimer); queueTimer = 0; }

  function renderRoom() {
    if (!room) return;
    const isHost = room.hostId === myPid;
    $('#room-code').textContent = room.code;
    $('#room-mode').textContent = room.mode + (room.quick ? ' · ghép nhanh' : '');
    const size = room.mode === '2v2' ? 2 : 1;
    for (const t of ['A', 'B']) {
      const ul = $('#room-team-' + t); ul.textContent = '';
      const ps = room.players.filter((p) => p.team === t);
      for (const p of ps) {
        const li = document.createElement('li');
        li.className = p.ready || p.id === room.hostId ? 'ready' : '';
        const em = UI.avatarEl(p.char, 'em');
        const nm = document.createElement('span'); nm.textContent = p.name + (p.id === myPid ? ' (bạn)' : '');
        const st = document.createElement('span'); st.className = 'st';
        st.textContent = !p.connected ? 'mất kết nối' : p.id === room.hostId ? '👑 chủ phòng' : p.ready ? '✓ sẵn sàng' : 'chưa sẵn sàng';
        li.append(em, nm, st);
        ul.append(li);
      }
      for (let i = ps.length; i < size; i++) {
        const li = document.createElement('li');
        li.textContent = room.mode === '2v2' && room.fillBots ? '🤖 Bot (' + PP.LEVELS[room.botLevel].name + ')' : '… chờ người chơi';
        li.style.opacity = 0.6;
        ul.append(li);
      }
    }
    UI.$$('[data-team]').forEach((b) => b.classList.toggle('hidden', room.mode !== '2v2' || room.quick));
    const venueSel = $('#room-venue');
    if (!venueSel.options.length) for (const v of PP.VENUES) { const o = document.createElement('option'); o.value = v.id; o.textContent = v.name; venueSel.append(o); }
    venueSel.value = room.settings.venue;
    const th = PP.VenueThumbs && PP.VenueThumbs.get(room.settings.venue);
    const ti = $('#room-venue-thumb');
    if (th) { ti.src = th; ti.classList.remove('hidden'); } else ti.classList.add('hidden');
    $('#room-target').value = String(room.settings.target);
    $('#room-scoring').value = room.settings.scoring;
    $('#room-fill').checked = !!room.fillBots;
    $('#room-botlevel').value = room.botLevel || 'pro';
    for (const id of ['#room-venue', '#room-target', '#room-scoring', '#room-fill', '#room-botlevel']) $(id).disabled = !isHost || room.quick;
    $('#room-scoring-wrap').classList.remove('hidden');
    $('#room-fill-wrap').classList.toggle('hidden', room.mode !== '2v2');
    $('#room-host-note').textContent = room.quick ? '(ghép nhanh)' : isHost ? '(bạn là chủ phòng)' : '(chủ phòng chỉnh)';
    const meP = room.players.find((p) => p.id === myPid);
    const rb = $('#btn-ready');
    rb.classList.toggle('hidden', isHost || room.quick);
    rb.textContent = meP && meP.ready ? '✓ Đã sẵn sàng' : 'Sẵn sàng';
    rb.classList.toggle('on', !!(meP && meP.ready));
    $('#btn-room-start').classList.toggle('hidden', !isHost || room.quick);
    $('#btn-room-start').disabled = !!room.inMatch;
  }

  function addChat(name, text, sys) {
    const log = $('#chat-log');
    const p = document.createElement('p');
    if (sys) { p.className = 'sys'; p.textContent = text; }
    else { const b = document.createElement('b'); b.textContent = name + ': '; p.append(b, document.createTextNode(text)); }
    log.append(p);
    while (log.children.length > 80) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  function renderLive(list) {
    const ul = $('#live-list'); ul.textContent = '';
    if (!list || !list.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'Chưa có trận nào.'; ul.append(li); return; }
    for (const mt of list) {
      const li = document.createElement('li');
      const tx = document.createElement('span');
      tx.textContent = `${mt.a.join(' & ')}  ${mt.score.A}–${mt.score.B}  ${mt.b.join(' & ')}`;
      const right = document.createElement('span');
      const vw = document.createElement('small'); vw.className = 'muted'; vw.textContent = '👁 ' + mt.viewers + ' ';
      const btn = document.createElement('button'); btn.className = 'btn tiny'; btn.textContent = 'Xem';
      btn.onclick = () => net.send({ t: 'spectate', matchId: mt.matchId });
      right.append(vw, btn);
      li.append(tx, right);
      ul.append(li);
    }
  }
  function renderLeaderboard(top) {
    const ol = $('#lb-list'); ol.textContent = '';
    if (!top || !top.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'Chưa có ai. Hãy là người đầu tiên!'; ol.append(li); return; }
    for (const r of top) {
      const li = document.createElement('li');
      const n = document.createElement('span'); n.textContent = r.name;
      const w = document.createElement('span'); w.textContent = r.wins + ' thắng · ' + r.losses + ' thua';
      w.className = 'muted';
      li.append(n, w);
      ol.append(li);
    }
  }

  function startOnlineMatch(m) {
    endSession();
    const spect = !m.yourTeam;
    mode = spect ? 'spectate' : 'online';
    session = new OnlineSession(m);
    const s = m.settings;
    resetView({ teamSize: s.teamSize, target: s.target, scoring: s.scoring, venue: s.venue });
    const list = m.players.map((p) => ({ id: p.id, team: p.team, char: p.char, name: p.name, isBot: p.isBot, isMe: p.id === myPid && !spect, look: p.look || {} }));
    buildScene(s.venue, list, true);
    me = spect ? null : players.get(myPid) || null;
    myTeam = m.yourTeam || 'A';
    flip = myTeam === 'B' ? -1 : 1;
    twoBounceHinted = false;
    camPos.set(0, 7, 15 * flip);
    UI.hideScreens();
    showHUD(true);
    $('#hud-ping').classList.remove('hidden');
    net.watch = true;
    A.ambience && A.ambience(true, s.venue);
    initRulesPanelForMatch();
    updateHUD();
    if (spect) UI.setMsg('Đang xem trực tiếp');
  }

  function applySync(s) {
    V.phase = s.phase; V.score = s.score; V.serverTeam = s.serverTeam; V.serverId = s.server;
    V.rallyId = s.rallyId; V.boxSign = s.boxSign; V.wind = s.wind; V.serverNum = s.serverNum || 0; V.receiverId = s.receiver || null; V.serveDeadline = now() + C.SERVE_TIMEOUT;
    for (const pos of s.positions) { const p = players.get(pos.id); if (p) { p.x = pos.x; p.z = pos.z; p.buf.length = 0; } }
    if (me) V.serveHalf = Math.sign(me.x) || 1;
    setLaunch(s.launch || null, false);
    updateHUD();
    if (s.phase === 'paused') UI.banner('Đang chờ người chơi kết nối lại…');
    serveCard(s.phase === 'serve' && me && V.serverId === me.id);
  }

  /* ================= Gắn sự kiện giao diện ================= */
  function bindUI() {
    UI.$$('[data-act="back-main"]').forEach((b) => b.onclick = () => { A.click(); closeSetupPreview(); if (mode === 'menu') { refreshMainStats(); UI.show('scr-main'); } });
    $('[data-act="offline"]').onclick = () => { A.unlock(); A.click(); openSetup(); };
    $('[data-act="online"]').onclick = () => { A.unlock(); A.click(); goOnline(); };
    $('[data-act="help"]').onclick = () => { A.click(); UI.show('scr-help'); };
    $('#btn-sound').onclick = () => { Save.data.muted = !Save.data.muted; A.setMuted(Save.data.muted); Save.save(); refreshMainStats(); A.click(); };
    $('#btn-start').onclick = () => { A.unlock(); A.click(); closeSetupPreview(); startOffline(); };
    UI.$$('[data-act="settings"]').forEach((b) => b.onclick = () => { A.click(); openSettings(); });
    $('#btn-settings-close').onclick = closeSettings;
    $('#rules-toggle').onclick = () => { A.click(); $('#rules-panel').classList.toggle('collapsed'); rulesText = ''; rulesCheckT = 0; };
    UI.$$('[data-act="wardrobe"]').forEach((b) => b.onclick = () => { A.unlock(); A.click(); openWardrobe(); });
    $('#wd-done').onclick = closeWardrobe;
    $('#wd-reset').onclick = () => { A.click(); delete Save.data.looks[wdChar]; Save.save(); wdRender(); };
    $('#wd-random').onclick = () => { A.click(); wdRandom(); };
    UI.seg($('#wd-anim'), 'ready', (v) => { if (wdPreview && wdPreview.setAnim) wdPreview.setAnim(v); });
    window.addEventListener('resize', () => { if (wdPreview && wdPreview.resize) wdPreview.resize(); });

    $('#btn-pause').onclick = () => togglePause();
    $('#btn-resume').onclick = () => { A.click(); resume(); };
    $('#btn-restart').onclick = () => { A.click(); startOffline(); };
    $('#btn-quit').onclick = () => {
      A.click();
      if (mode === 'offline') { goMenu(); return; }
      if (mode === 'spectate') net.send({ t: 'spectate_leave' }); else net.send({ t: 'room_leave' });
      endSession(); mode = 'menu'; buildMenuScene(); room = null;
      goOnline();
    };
    $('#btn-again').onclick = () => {
      A.click();
      if (mode === 'offline') { startOffline(); return; }
      net.send({ t: 'rematch' });
      $('#btn-again').disabled = true;
      $('#btn-again').textContent = 'Đang chờ đối thủ…';
    };
    $('#btn-over-menu').onclick = () => {
      A.click();
      if (mode === 'offline') { goMenu(); return; }
      const wasSpect = mode === 'spectate';
      endSession(); mode = 'menu'; buildMenuScene();
      if (wasSpect || !room) goOnline(); else { renderRoom(); UI.show('scr-room'); }
    };

    $('#btn-profile-ok').onclick = () => {
      const name = Protocol.cleanName($('#profile-name').value);
      if (name.length < 2) { UI.toast('Biệt danh cần ít nhất 2 ký tự'); return; }
      Save.data.name = name; Save.save();
      if (net) net.send({ t: 'set_profile', name, char: Save.data.char, look: myLook() });
      A.click();
      goOnline();
    };
    $('#profile-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-profile-ok').click(); });
    $('#btn-edit-profile').onclick = () => { A.click(); openProfile(); };
    $('#btn-online-back').onclick = () => { A.click(); goMenu(); };
    UI.$$('[data-queue]').forEach((b) => b.onclick = () => { A.click(); net.send({ t: 'queue_join', mode: b.dataset.queue }); });
    UI.$$('[data-create]').forEach((b) => b.onclick = () => {
      A.click();
      net.send({ t: 'room_create', mode: b.dataset.create, settings: { venue: Save.data.venue, target: +Save.data.target, scoring: Save.data.scoring } });
    });
    $('#btn-join').onclick = () => {
      const code = $('#join-code').value.trim().toUpperCase();
      if (code.length !== 4) { UI.toast('Mã phòng gồm 4 ký tự'); return; }
      A.click(); net.send({ t: 'room_join', code });
    };
    $('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-join').click(); });
    $('#btn-live-refresh').onclick = () => { net.send({ t: 'list_live' }); net.send({ t: 'leaderboard' }); };
    $('#btn-queue-cancel').onclick = () => { A.click(); net.send({ t: 'queue_leave' }); stopQueueTimer(); UI.show('scr-online'); };

    $('#btn-copy-link').onclick = () => {
      if (!room) return;
      const link = location.origin + location.pathname + '?room=' + room.code;
      const done = () => UI.toast('Đã sao chép link mời: ' + link, 3500);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, () => window.prompt('Sao chép link mời:', link));
      else window.prompt('Sao chép link mời:', link);
    };
    UI.$$('[data-team]').forEach((b) => b.onclick = () => net.send({ t: 'room_update', team: b.dataset.team }));
    const sendSettings = () => net.send({ t: 'room_update', settings: { venue: $('#room-venue').value, target: +$('#room-target').value, scoring: $('#room-scoring').value } });
    $('#room-venue').onchange = sendSettings; $('#room-target').onchange = sendSettings; $('#room-scoring').onchange = sendSettings;
    $('#room-fill').onchange = () => net.send({ t: 'room_update', fillBots: $('#room-fill').checked });
    $('#room-botlevel').onchange = () => net.send({ t: 'room_update', botLevel: $('#room-botlevel').value });
    $('#btn-ready').onclick = () => {
      const meP = room && room.players.find((p) => p.id === myPid);
      net.send({ t: 'room_ready', ready: !(meP && meP.ready) });
    };
    $('#btn-room-start').onclick = () => { A.click(); net.send({ t: 'room_start' }); };
    $('#btn-room-leave').onclick = () => { A.click(); net.send({ t: 'room_leave' }); room = null; $('#chat-log').textContent = ''; UI.show('scr-online'); };
    $('#chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = $('#chat-input');
      const text = Protocol.cleanChat(inp.value);
      if (text) net.send({ t: 'chat', text });
      inp.value = '';
    });

    PP.Input.on('shot', onShot);
    PP.Input.on('shotDown', onShotDown);
    PP.Input.on('shotUp', onShotUp);
    PP.Input.on('cancel', () => { ctl.charge = null; });
    PP.Input.on('pause', togglePause);
    PP.Input.setupTouch();
    document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'offline' && session && !paused) togglePause(); });
  }

  const BLURB = {
    bunny: 'Phản xạ nhanh ở lưới', bear: 'Cú drive như sấm', cat: 'Dink khéo, khó đoán', pig: 'Lì đòn, chạy không biết mệt',
    frog: 'Bật nhảy đập bóng cao', penguin: 'Chậm mà chắc', fox: 'Ranh mãnh với cú drop', panda: 'Bình tĩnh ở điểm quyết định',
    dino: 'Smash rung cả sân', monkey: 'Lăng xăng khắp sân', elephant: 'Tầm với dài, đỡ đâu cũng tới', raccoon: 'Chuyên cú lob lén',
    deer: 'Bước chân nhẹ như gió', turtle: 'Phòng thủ như bức tường', capybara: 'Không gì làm nao núng', seal: 'Giữ bóng như làm xiếc',
    lion: 'Thủ lĩnh sân đấu', sloth: 'Chậm rãi nhưng chuẩn từng li',
  };
  let setupPreview = null;
  function closeSetupPreview() {
    if (setupPreview) { try { setupPreview.dispose(); } catch (e) { /* bỏ qua */ } setupPreview = null; }
  }
  function setupHero() {
    const d = Save.data, def = CHAR(d.char);
    $('#setup-hero-name').textContent = def.name;
    $('#setup-hero-tag').textContent = BLURB[def.id] || '';
    const pic = $('#setup-hero-pic');
    if (setupPreview) { setupPreview.set(def, fullLook(def.id)); pic.classList.add('hidden'); }
    else { pic.textContent = ''; pic.append(UI.avatarEl(def.id, 'em')); pic.classList.remove('hidden'); }
  }
  function setupSummary() {
    const d = Save.data, v = VENUE(d.venue);
    const chips = [CHAR(d.char).name, +d.mode === 2 ? 'Đánh đôi' : 'Đánh đơn', PP.LEVELS[d.level].name, 'Chạm ' + d.target,
      d.scoring === 'rally' ? 'Rally' : 'Truyền thống', v.name];
    const el = $('#setup-summary'); el.textContent = '';
    for (const c of chips) { const s2 = document.createElement('span'); s2.className = 'chip'; s2.textContent = c; el.append(s2); }
    $('#setup-venue-info').textContent = v.desc;
  }
  function openSetup() {
    const d = Save.data;
    $('#setup-wins').textContent = `🏆 ${d.wins} thắng · ${d.losses} thua`;
    UI.charGrid($('#setup-chars'), d.char, d.wins, (id) => { d.char = id; Save.save(); setupHero(); setupSummary(); });
    UI.seg($('#setup-mode'), d.mode, (v) => { d.mode = +v; Save.save(); syncScoring(); setupSummary(); });
    UI.seg($('#setup-level'), d.level, (v) => { d.level = v; Save.save(); setupSummary(); });
    UI.seg($('#setup-target'), d.target, (v) => { d.target = +v; Save.save(); setupSummary(); });
    const setSc = UI.seg($('#setup-scoring'), d.scoring, (v) => { d.scoring = v; Save.save(); syncScoring(); setupSummary(); });
    UI.venueList($('#setup-venue'), d.venue, (v) => { d.venue = v; Save.save(); setupSummary(); });
    function syncScoring() {
      const dbl = +d.mode === 2;
      setSc(d.scoring);
      $('#setup-scoring-note').textContent = d.scoring === 'rally'
        ? 'Biến thể nhanh: pha nào cũng có điểm.'
        : 'Luật chuẩn: chỉ bên giao bóng mới ghi điểm.' + (dbl ? ' Mỗi người trong đội giao một lượt.' : '');
    }
    syncScoring();
    UI.show('scr-setup');
    if (!setupPreview && !softwareGL && PP.Character.createPreview) {
      try { setupPreview = PP.Character.createPreview($('#setup-canvas')); } catch (e) { setupPreview = null; }
    }
    $('#setup-canvas').classList.toggle('hidden', !setupPreview);
    setupHero(); setupSummary();
  }

  /* ================= Khởi động ================= */
  /** Chờ trình duyệt vẽ lại để chữ trên màn tải kịp cập nhật giữa các bước nặng */
  const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  function bootStep(text) { const el = document.getElementById('loading-text'); if (el) el.textContent = text; return nextPaint(); }
  function bootFail(msg) { if (window.__bootFail) window.__bootFail(msg); else $('#loading').textContent = msg; }

  const HTML_REV = 6;   // phải khớp window.PP_HTML_REV trong index.html
  async function boot() {
    if (window.PP_HTML_REV !== HTML_REV) {
      bootFail('Trang đang dùng bản cũ trong bộ nhớ đệm của trình duyệt. Bấm "Tải lại" (hoặc Ctrl+F5 / Cmd+Shift+R).');
      const btn = document.getElementById('loading-reload');
      if (btn) btn.onclick = () => { const u = new URL(location.href); u.searchParams.set('r', Date.now()); location.replace(u.toString()); };
      return;
    }
    // lỗi khi đang chơi: báo cho người dùng thay vì để giao diện đứng im
    let lastErrToast = 0;
    window.addEventListener('error', (e) => {
      if (!$('#loading').classList.contains('hidden')) return;
      if (Date.now() - lastErrToast < 4000) return;
      lastErrToast = Date.now();
      UI.toast('Có lỗi: ' + (e.message || 'không rõ') + '. Thử tải lại trang (Ctrl+F5).', 6000);
    });
    try {
      Save.load();
      A.setMuted(Save.data.muted);
      if (A.setVolume) A.setVolume(S().volume / 100);
      await bootStep('Đang khởi tạo đồ họa…');
      try { initRenderer(); }
      catch (e) { bootFail('Trình duyệt không hỗ trợ WebGL. Hãy bật "Tăng tốc phần cứng" hoặc dùng Chrome/Edge/Safari bản mới.'); return; }
      bindUI();
      await bootStep(softwareGL ? 'Đang dựng sân (máy không dùng GPU nên sẽ hơi lâu)…' : 'Đang dựng sân…');
      buildMenuScene();
      refreshMainStats();
      document.body.classList.toggle('touch', PP.Input.isTouch());
      await bootStep('Đang chuẩn bị đồ họa…');
      updateCamera(0); updateVisuals(0);
      renderer.render(scene, camera);   // biên dịch shader trước khi tắt màn tải
    } catch (e) {
      console.error(e);
      bootFail('Lỗi: ' + (e && e.message ? e.message : e));
      return;
    }
    $('#loading').classList.add('hidden');
    UI.show('scr-main');
    if (softwareGL) UI.toast('Trình duyệt đang không dùng GPU nên game sẽ chậm. Hãy bật "Tăng tốc phần cứng" trong cài đặt trình duyệt.', 7000);
    // việc nặng (ảnh chân dung, ảnh sân) để sau khi menu đã hiện
    setTimeout(loadPortraits, 600);
    const params = new URLSearchParams(location.search);
    const code = (params.get('room') || '').toUpperCase();
    if (code.length === 4) {
      pendingRoom = code;
      params.delete('room');
      const q = params.toString();
      history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
      goOnline();
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('DOMContentLoaded', boot);
  PP.Game = { Save, now, get state() { return { mode, V, players, me, ctl, myTeam, ball, camera }; } };
})(window.PP);
