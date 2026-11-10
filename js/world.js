/* Pickle Pop v3 – thế giới: renderer, sân, 10 bối cảnh, khán giả, hiệu ứng, ảnh xem trước (nhóm W)
 * API: xem docs/V2_CONTRACTS.md mục "W". Three.js r147 (UMD toàn cục), script thường, chạy được qua file://
 * Màu khai báo bằng hex sRGB và được đổi sang linear bằng lin() vì ColorManagement.legacyMode của r147 = true.
 */
(function (PP) {
  'use strict';
  const C = PP.C || { W: 3.05, L: 6.7, K: 2.13, NET_H: 0.86, NET_POST_H: 0.91, NET_HALF: 3.35, R: 0.065 };
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  const QUALITY = {
    low:    { pr: 1,   shadow: 0,    crowd: 60,  ambient: 0,   aniso: 2 },
    medium: { pr: 1.5, shadow: 1024, crowd: 160, ambient: 50,  aniso: 4 },
    high:   { pr: 2,   shadow: 2048, crowd: 320, ambient: 120, aniso: 8 },
  };
  const qOf = (q) => (QUALITY[q] ? q : 'medium');
  const SURFACE = { gym: 'wood', beach: 'sand', roof: 'hard', park: 'hard', arena: 'hard' };

  /* ================= tiện ích ================= */
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0; let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function lin(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }
  function jit(hex, r, amt) { const c = new THREE.Color(hex); const hsl = {}; c.getHSL(hsl); c.setHSL(hsl.h + (r() - 0.5) * amt * 0.1, clamp(hsl.s + (r() - 0.5) * amt * 0.3, 0, 1), clamp(hsl.l + (r() - 0.5) * amt, 0, 1)); return c.convertSRGBToLinear(); }
  function M(hex, o) {
    o = Object.assign({}, o || {}); const em = o.emissive; delete o.emissive;
    const m = new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.75, metalness: 0 }, o));
    m.color.copy(lin(hex)); if (em !== undefined) m.emissive.copy(lin(em));
    return m;
  }
  function MB(hex, o) { const m = new THREE.MeshBasicMaterial(o || {}); m.color.copy(lin(hex)); return m; }

  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _m4 = new THREE.Matrix4();
  const UP = new THREE.Vector3(0, 1, 0);
  function T(x, y, z, rx, ry, rz, sx, sy, sz) {
    _e.set(rx || 0, ry || 0, rz || 0); _q.setFromEuler(_e);
    const a = sx === undefined ? 1 : sx;
    _s.set(a, sy === undefined ? a : sy, sz === undefined ? a : sz);
    return new THREE.Matrix4().compose(_v.set(x || 0, y || 0, z || 0), _q, _s);
  }
  function Tq(p, q, s) { return new THREE.Matrix4().compose(p, q, s); }

  let GEO = null;
  function G() {
    if (GEO) return GEO;
    GEO = {
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
      cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
      cylT: new THREE.CylinderGeometry(0.36, 0.5, 1, 10),
      cone: new THREE.ConeGeometry(0.5, 1, 12),
      cone4: new THREE.ConeGeometry(0.5, 1, 4),
      sph: new THREE.SphereGeometry(0.5, 14, 10),
      ico: new THREE.IcosahedronGeometry(0.5, 1),
      ico0: new THREE.IcosahedronGeometry(0.5, 0),
      plane: new THREE.PlaneGeometry(1, 1),
      circle: new THREE.CircleGeometry(0.5, 20),
    };
    return GEO;
  }

  /* Gộp geometry tĩnh (màu theo đỉnh) để giảm draw call */
  class Batch {
    constructor() { this.p = []; this.n = []; this.c = []; this.u = []; }
    add(geo, m, hex, us, vs) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      if (m) g.applyMatrix4(m);
      const P = g.attributes.position.array, N = g.attributes.normal.array, U = g.attributes.uv ? g.attributes.uv.array : null;
      const col = hex && hex.isColor ? hex : lin(hex);
      const n = P.length / 3; us = us || 1; vs = vs || 1;
      for (let i = 0; i < n; i++) {
        this.p.push(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
        this.n.push(N[3 * i], N[3 * i + 1], N[3 * i + 2]);
        this.c.push(col.r, col.g, col.b);
        this.u.push(U ? U[2 * i] * us : 0, U ? U[2 * i + 1] * vs : 0);
      }
      g.dispose();
      return this;
    }
    build(mat, cast) {
      if (!this.p.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = !!cast; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      return mesh;
    }
  }
  const box = (b, x, y, z, sx, sy, sz, hex, ry, rx, rz) => b.add(G().box, T(x, y, z, rx, ry, rz, sx, sy, sz), hex);
  const cyl = (b, x, y, z, r, h, hex, geo, rx, ry, rz) => b.add(geo || G().cyl, T(x, y, z, rx, ry, rz, r * 2, h, r * 2), hex);
  const sph = (b, x, y, z, rx, ry, rz, hex, geo, rotY) => b.add(geo || G().sph, T(x, y, z, 0, rotY || 0, 0, rx * 2, ry * 2, rz * 2), hex);

  /* ================= texture canvas ================= */
  let ANISO = 4;
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function tex(c, o) {
    o = o || {};
    const t = new THREE.CanvasTexture(c);
    t.encoding = o.linear ? THREE.LinearEncoding : THREE.sRGBEncoding;
    if (o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(o.repeat[0], o.repeat[1]); }
    t.anisotropy = o.aniso || ANISO;
    return t;
  }
  function noiseFill(g, w, h, amt, r) {
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = ((r ? r() : Math.random()) - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
  }
  function woodTexture(r) {
    const S = 1024, c = makeCanvas(S, S), g = c.getContext('2d');
    const planks = 14, pw = S / planks;
    const bases = ['#cf8f52', '#d99d5e', '#c58247', '#d6965a', '#cb8b50', '#e0a96b', '#c98a4e'];
    for (let i = 0; i < planks; i++) {
      let y = -r() * S * 0.6;
      while (y < S) {
        const len = S * (0.3 + r() * 0.45);
        g.fillStyle = bases[(r() * bases.length) | 0]; g.fillRect(i * pw, y, pw, len);
        for (let k = 0; k < 16; k++) {
          g.strokeStyle = 'rgba(110,60,25,' + (0.05 + r() * 0.1).toFixed(3) + ')';
          g.lineWidth = 0.6 + r() * 1.6; g.beginPath();
          const x0 = i * pw + 2 + r() * (pw - 4), amp = 0.6 + r() * 2.4, fr = 0.008 + r() * 0.03, ph = r() * 6;
          for (let yy = y; yy <= y + len; yy += 6) { const xx = x0 + Math.sin(yy * fr + ph) * amp; if (yy === y) g.moveTo(xx, yy); else g.lineTo(xx, yy); }
          g.stroke();
        }
        if (r() < 0.25) { g.fillStyle = 'rgba(100,55,20,0.35)'; g.beginPath(); g.ellipse(i * pw + pw * (0.3 + r() * 0.4), y + len * r(), 3 + r() * 3, 6 + r() * 6, 0, 0, TAU); g.fill(); }
        g.fillStyle = 'rgba(70,38,15,0.55)'; g.fillRect(i * pw, y + len - 1.5, pw, 2.5);
        y += len;
      }
      g.fillStyle = 'rgba(70,38,15,0.55)'; g.fillRect(i * pw, 0, 2, S);
    }
    noiseFill(g, S, S, 12, r);
    return c;
  }
  function speckleCanvas(r) {
    const S = 256, c = makeCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#efefef'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 5200; i++) {
      const v = r(); g.fillStyle = v < 0.45 ? '#ffffff' : v < 0.8 ? '#d2d2d2' : '#b8b8b8';
      const s = r() < 0.85 ? 1 : 2; g.fillRect((r() * S) | 0, (r() * S) | 0, s, s);
    }
    noiseFill(g, S, S, 8, r);
    return c;
  }
  function sandCanvas(r, base) {
    const S = 512, c = makeCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = base || '#f0d9a6'; g.fillRect(0, 0, S, S);
    for (let k = 0; k < 46; k++) {
      const y0 = (k / 46) * S + r() * 6, amp = 3 + r() * 5, fr = (1 + ((r() * 3) | 0)) * TAU / S, ph = r() * 6;
      g.strokeStyle = k % 2 ? 'rgba(255,248,225,0.35)' : 'rgba(170,130,80,0.16)'; g.lineWidth = 2 + r() * 3;
      g.beginPath();
      for (let x = 0; x <= S; x += 8) { const y = y0 + Math.sin(x * fr + ph) * amp; if (!x) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
    }
    for (let i = 0; i < 900; i++) { g.fillStyle = r() < 0.5 ? 'rgba(150,110,70,0.35)' : 'rgba(255,255,240,0.5)'; g.fillRect(r() * S, r() * S, 1.5, 1.5); }
    noiseFill(g, S, S, 16, r);
    return c;
  }
  function grassCanvas(r) {
    const S = 512, c = makeCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#62a344'; g.fillRect(0, 0, S, S);
    const cols = ['#4f8f36', '#76b955', '#5a9a3e', '#84c25f', '#4a8432', '#6fae4a'];
    for (let i = 0; i < 7000; i++) {
      g.strokeStyle = cols[(r() * cols.length) | 0]; g.globalAlpha = 0.35 + r() * 0.4; g.lineWidth = 1 + r();
      const x = r() * S, y = r() * S, l = 3 + r() * 7, a = -Math.PI / 2 + (r() - 0.5) * 0.9;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    g.globalAlpha = 1; noiseFill(g, S, S, 14, r);
    return c;
  }
  function tileCanvas(r, base, grout, n) {
    const S = 512, c = makeCanvas(S, S), g = c.getContext('2d'), ts = S / n;
    const b = new THREE.Color(base);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const k = 1 + (r() - 0.5) * 0.12;
      g.fillStyle = 'rgb(' + [b.r, b.g, b.b].map((v) => Math.round(clamp(v * k, 0, 1) * 255)).join(',') + ')';
      g.fillRect(i * ts, j * ts, ts, ts);
    }
    for (let i = 0; i < 14; i++) { const x = r() * S, y = r() * S, rr = 20 + r() * 60; const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, 'rgba(60,50,40,0.12)'); gr.addColorStop(1, 'rgba(60,50,40,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
    g.fillStyle = grout; for (let i = 0; i <= n; i++) { g.fillRect(i * ts - 2, 0, 4, S); g.fillRect(0, i * ts - 2, S, 4); }
    noiseFill(g, S, S, 14, r);
    return c;
  }
  function gridAlphaCanvas(px, lw, diamond) {
    const c = makeCanvas(px, px), g = c.getContext('2d');
    g.strokeStyle = '#ffffff'; g.lineWidth = lw; g.lineCap = 'square';
    if (diamond) {
      for (const o of [-px, 0, px]) { g.beginPath(); g.moveTo(o, 0); g.lineTo(o + px, px); g.stroke(); g.beginPath(); g.moveTo(o + px, 0); g.lineTo(o, px); g.stroke(); }
    } else {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, px, lw / 2); g.fillRect(0, px - lw / 2, px, lw / 2); g.fillRect(0, 0, lw / 2, px); g.fillRect(px - lw / 2, 0, lw / 2, px);
    }
    return c;
  }
  function softCircleCanvas(inner) {
    const S = 64, c = makeCanvas(S, S), g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(inner || 0.35, 'rgba(255,255,255,0.65)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    return c;
  }
  let _softTex = null;
  function softTex() { if (!_softTex) { _softTex = tex(softCircleCanvas(0.3)); _softTex.userData = { shared: true }; } return _softTex; }
  function gradientCanvas(stops, h) {
    const c = makeCanvas(4, h || 256), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, c.height);
    for (const s of stops) gr.addColorStop(s[0], s[1]);
    g.fillStyle = gr; g.fillRect(0, 0, 4, c.height);
    return c;
  }
  function windowCanvases(r, facade, cols, rows, litP, palette) {
    const S = 256, a = makeCanvas(S, S), e = makeCanvas(S, S), g = a.getContext('2d'), h = e.getContext('2d');
    g.fillStyle = facade; g.fillRect(0, 0, S, S); h.fillStyle = '#000'; h.fillRect(0, 0, S, S);
    const cw = S / cols, rh = S / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x = i * cw + cw * 0.2, y = j * rh + rh * 0.22, w = cw * 0.6, hh = rh * 0.55;
      if (r() < litP) { const col = palette[(r() * palette.length) | 0]; g.fillStyle = col; h.fillStyle = col; g.fillRect(x, y, w, hh); h.globalAlpha = 0.6 + r() * 0.4; h.fillRect(x, y, w, hh); h.globalAlpha = 1; }
      else { g.fillStyle = 'rgba(15,18,32,0.85)'; g.fillRect(x, y, w, hh); }
    }
    return { map: a, emi: e };
  }
  function textBannerCanvas(items, w, h) {
    const c = makeCanvas(w, h), g = c.getContext('2d');
    const seg = w / items.length;
    items.forEach((it, i) => {
      g.fillStyle = it.bg; g.fillRect(i * seg, 0, seg, h);
      g.fillStyle = it.fg; g.font = '900 ' + Math.round(h * 0.52) + 'px "Baloo 2", "Arial Rounded MT Bold", system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(it.text, i * seg + seg / 2, h * 0.54);
      if (it.dot) { g.fillStyle = it.dot; g.beginPath(); g.arc(i * seg + h * 0.4, h / 2, h * 0.16, 0, TAU); g.fill(); g.beginPath(); g.arc((i + 1) * seg - h * 0.4, h / 2, h * 0.16, 0, TAU); g.fill(); }
    });
    return c;
  }

  /* ================= nhận dạng bối cảnh ================= */
  // sky: các mốc gradient (trên → dưới); fog; hemi [trời, đất, cường độ]; sun; env; exposure
  const LOOKS = {
    gym: {
      court: 0x2f68c0, kitchen: 0x3f8fd0, outer: 0x3f9465, line: 0xffffff,
      sky: [[0, '#cfe8ff'], [0.5, '#fff4df'], [1, '#e9d6b8']], fog: [0xf2e4cc, 34, 110],
      hemi: [0xfff1dc, 0xb88050, 0.42], sun: { color: 0xffeccc, intensity: 1.45, pos: [-11, 14, -3] }, env: 0.45, exposure: 0.95,
      crowdBodies: [0xffd6a5, 0xffadad, 0xcaffbf, 0x9bf6ff, 0xa0c4ff, 0xbdb2ff, 0xffc6ff, 0xfdffb6, 0xffb38a],
      ambient: { kind: 'fall', shape: 'petal', colors: [0xffd23f, 0xffc61a, 0xffe27a, 0xfff0a8], size: 0.07, area: [-9, 9, 0, 7, -13, 9], fall: 0.45, sway: 0.5, wind: [0.12, 0.05] },
    },
    beach: {
      court: 0x1f7fc0, kitchen: 0x2aa6c8, outer: 0xe8955f, line: 0xffffff,
      sky: [[0, '#2f9fe8'], [0.42, '#8fd6ff'], [0.5, '#d9f3ff'], [1, '#f2dcaa']], fog: [0xc8ecff, 60, 230],
      hemi: [0xc6e8ff, 0xf0d6a0, 0.45], sun: { color: 0xfff1d8, intensity: 1.55, pos: [8, 16, 9] }, env: 0.5, exposure: 0.95,
      crowdBodies: [0xffd6a5, 0xffadad, 0xfdffb6, 0x9bf6ff, 0xffc6ff, 0xffb38a, 0xcaffbf, 0xffe0f0],
      ambient: { kind: 'float', colors: [0xffffff, 0xfff6dc], size: 0.06, area: [-14, 14, 0.3, 4, -16, 10], drift: [0.9, 0.1], twinkle: 0.4 },
    },
    roof: {
      court: 0x6b55c0, kitchen: 0x8b74d8, outer: 0x2f8577, line: 0xffffff,
      sky: [[0, '#2c2c6e'], [0.25, '#7a4d9e'], [0.4, '#e2738a'], [0.48, '#ffb27a'], [0.52, '#ffd59a'], [1, '#463a58']], fog: [0xf0a07e, 45, 170],
      hemi: [0xffcba8, 0x58587a, 0.55], sun: { color: 0xffb57a, intensity: 1.5, pos: [-9, 6.5, -14] }, env: 0.45, exposure: 0.98,
      crowdBodies: [0xffd6a5, 0xffadad, 0xbdb2ff, 0xa0c4ff, 0xffc6ff, 0xfdffb6, 0x9bf6ff],
      ambient: { kind: 'float', colors: [0xffd68a, 0xffb36b, 0xfff0b0], size: 0.07, area: [-10, 10, 0.5, 4.5, -13, 9], drift: [0.15, 0.05], twinkle: 1 },
    },
    park: {
      court: 0x2563b8, kitchen: 0x3a86d0, outer: 0x3f8f4c, line: 0xffffff,
      sky: [[0, '#4aa6ea'], [0.46, '#a9dcff'], [0.5, '#e4f6ff'], [1, '#7cae5c']], fog: [0xd5ecfa, 50, 210],
      hemi: [0xd2ecff, 0x6a9a48, 0.45], sun: { color: 0xfff0d4, intensity: 1.55, pos: [10, 15, 5] }, env: 0.5, exposure: 0.95,
      crowdBodies: [0xffd6a5, 0xffadad, 0xcaffbf, 0x9bf6ff, 0xa0c4ff, 0xfdffb6, 0xffc6ff, 0xffb38a],
      ambient: { kind: 'fall', shape: 'leaf', colors: [0x7cbf4a, 0xa6cf4f, 0xd6b13a, 0x5ea33a], size: 0.08, area: [-12, 12, 0, 8, -15, 8], fall: 0.6, sway: 0.8, wind: [0.5, 0.1], gust: true },
    },
    arena: {
      court: 0x1a56b0, kitchen: 0x2a74cc, outer: 0x173c55, line: 0xffffff,
      sky: [[0, '#050818'], [0.45, '#141c44'], [0.52, '#232c5c'], [1, '#0a0d1c']], fog: [0x121732, 40, 130],
      hemi: [0x6d7fc8, 0x1a1c2a, 0.32], sun: { color: 0xf3f6ff, intensity: 1.9, pos: [1.5, 20, 3] }, env: 0.35, exposure: 1.0,
      crowdBodies: [0xffadad, 0xa0c4ff, 0xbdb2ff, 0xffd6a5, 0x9bf6ff, 0xffc6ff, 0xfdffb6],
      ambient: { kind: 'float', colors: [0xdfe8ff, 0xffffff], size: 0.05, area: [-9, 9, 1, 9, -11, 9], drift: [0.05, 0.02], twinkle: 0.6 },
    },
  };
  const TEAM_FLAGS = [0x3d8bff, 0xff6b5b, 0x3d8bff, 0xff6b5b, 0xffd23f];

  /* ================= renderer ================= */
  function createRenderer(canvas, quality) {
    quality = qOf(quality);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance', alpha: false });
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 1);
    applyQuality(renderer, quality);
    return renderer;
  }
  const WORLDS = new Set();
  function applyQuality(renderer, quality) {
    quality = qOf(quality);
    const qc = QUALITY[quality];
    renderer.__ppQuality = quality;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    renderer.setPixelRatio(Math.min(dpr, qc.pr));
    renderer.shadowMap.enabled = qc.shadow > 0;
    renderer.shadowMap.needsUpdate = true;
    WORLDS.forEach((w) => { if (w._renderer === renderer) w._applyQuality(quality); });
  }
  function envFor(renderer) {
    if (renderer.__ppEnv) return renderer.__ppEnv;
    if (!THREE.RoomEnvironment) return null;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new THREE.RoomEnvironment();
    const rt = pmrem.fromScene(room, 0.04);
    room.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    pmrem.dispose();
    renderer.__ppEnv = rt.texture;
    return rt.texture;
  }

  /* ================= sân pickleball ================= */
  function buildCourt(X) {
    const L = X.look, W = C.W, LL = C.L, K = C.K;
    const SX = W + 3.0, SZ = LL + 4.0;
    X.courtHalf = { x: SX, z: SZ };
    const speckC = speckleCanvas(X.r);
    const mk = (hex, rep, off, rough) => {
      const t = tex(speckC, { repeat: rep });
      return M(hex, { map: t, roughness: rough || L.courtRough || 0.78, polygonOffset: true, polygonOffsetFactor: off, polygonOffsetUnits: off * 2 });
    };
    const flatMesh = (w, d, mat, y, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(0, y, z || 0); m.receiveShadow = true; X.root.add(m); return m; };
    if (L.outerWood) {
      const wt = tex(woodTexture(X.r), { repeat: [2 * SX / 3, 2 * SZ / 3] });
      const wm = M(L.outer, { map: wt, roughness: 0.55 }); wm.envMapIntensity = 0.7;
      flatMesh(2 * SX, 2 * SZ, wm, 0.0).userData.keepEnv = true;
    } else flatMesh(2 * SX, 2 * SZ, mk(L.outer, [2 * SX / 1.3, 2 * SZ / 1.3], 0), 0.0);
    flatMesh(2 * W, 2 * LL, mk(L.court, [2 * W / 1.3, 2 * LL / 1.3], -1), 0.002);
    flatMesh(2 * W, 2 * K, mk(L.kitchen, [2 * W / 1.3, 2 * K / 1.3], -2), 0.004);
    // curb nhẹ quanh vùng sân ngoài
    const curb = new Batch(), cc = new THREE.Color(L.outer).multiplyScalar(0.72).getHex();
    box(curb, 0, 0.012, -SZ - 0.06, 2 * SX + 0.24, 0.03, 0.12, cc); box(curb, 0, 0.012, SZ + 0.06, 2 * SX + 0.24, 0.03, 0.12, cc);
    box(curb, -SX - 0.06, 0.012, 0, 0.12, 0.03, 2 * SZ, cc); box(curb, SX + 0.06, 0.012, 0, 0.12, 0.03, 2 * SZ, cc);
    X.root.add(curb.build(M(0xffffff, { vertexColors: true, roughness: 0.8 }), false));
    // vạch (gộp 1 mesh)
    const lb = new Batch(), lw = 0.052, y = 0.006, wh = L.line;
    const ln = (x, z, sx, sz) => lb.add(G().plane, T(x, y, z, -Math.PI / 2, 0, 0, sx, sz, 1), wh);
    ln(0, LL, 2 * W + lw, lw); ln(0, -LL, 2 * W + lw, lw);
    ln(W, 0, lw, 2 * LL + lw); ln(-W, 0, lw, 2 * LL + lw);
    ln(0, K, 2 * W, lw); ln(0, -K, 2 * W, lw);
    ln(0, (K + LL) / 2, lw, LL - K); ln(0, -(K + LL) / 2, lw, LL - K);
    ln(0, LL - 0.1, lw, 0.2); ln(0, -LL + 0.1, lw, 0.2);
    const lm = M(0xffffff, { vertexColors: true, roughness: 0.45, emissive: 0x9a9a9a, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    lm.emissiveIntensity = L.lineGlow || 0.22;
    X.root.add(lb.build(lm, false));
  }

  /* ================= lưới ================= */
  function buildNet(X) {
    const half = C.NET_HALF, sx = 44, sy = 6, bottom = 0.05;
    const topY = (x) => C.NET_H + (C.NET_POST_H - 0.012 - C.NET_H) * (x / half) * (x / half);
    const nt = tex(gridAlphaCanvas(32, 7), { repeat: [2 * half / 0.075, 0.85 / 0.075], linear: true });
    const netGeo = new THREE.PlaneGeometry(2 * half, 1, sx, sy);
    const np = netGeo.attributes.position, nBX = [], nBV = [];
    for (let i = 0; i < np.count; i++) { nBX.push(np.getX(i)); nBV.push(np.getY(i) + 0.5); }
    const netMat = M(0x1f232b, { alphaMap: nt, transparent: true, alphaTest: 0.25, side: THREE.DoubleSide, roughness: 0.9 });
    const net = new THREE.Mesh(netGeo, netMat); net.castShadow = true; net.frustumCulled = false; X.root.add(net);
    const tapeGeo = new THREE.PlaneGeometry(2 * half, 1, sx, 1);
    const tp = tapeGeo.attributes.position, tBX = [], tBV = [];
    for (let i = 0; i < tp.count; i++) { tBX.push(tp.getX(i)); tBV.push(tp.getY(i) + 0.5); }
    const tape = new THREE.Mesh(tapeGeo, M(0xffffff, { side: THREE.DoubleSide, roughness: 0.5, emissive: 0x888888 }));
    tape.material.emissiveIntensity = 0.15; tape.castShadow = true; tape.frustumCulled = false; X.root.add(tape);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1, 0.012), tape.material);
    strap.castShadow = true; X.root.add(strap);
    // cột lưới
    const b = X.solid;
    for (const s of [-1, 1]) {
      const px = s * (half + 0.06);
      cyl(b, px, C.NET_POST_H / 2, 0, 0.045, C.NET_POST_H, 0x2a2e38);
      sph(b, px, C.NET_POST_H, 0, 0.052, 0.03, 0.052, 0xffd23f);
      cyl(b, px, 0.015, 0, 0.16, 0.03, 0x2a2e38);
      box(b, px - s * 0.12, 0.05, 0, 0.26, 0.06, 0.08, 0x2a2e38);
    }
    box(b, 0, 0.012, 0, 0.12, 0.024, 0.08, 0x2a2e38);
    const imp = [];
    let idle = 0;
    const wind = X.look.windNet || 0;
    function disp(x, v, t) {
      let d = 0;
      for (const p of imp) {
        const a = p.t;
        const g = Math.exp(-((x - p.x) * (x - p.x)) / 0.9);
        d += p.s * 0.11 * Math.exp(-a * 4.2) * Math.sin(a * 30) * g;
      }
      const w = wind ? Math.sin(t * 1.7 + x * 0.9) * 0.012 * wind : 0;
      return (d + w) * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, v * 1.15)));
    }
    function apply(t) {
      for (let i = 0; i < np.count; i++) {
        const x = nBX[i], v = nBV[i], top = topY(x);
        const dz = disp(x, v, t);
        np.setXYZ(i, x, bottom + v * (top - 0.03 - bottom) - Math.abs(dz) * 0.3 * v, dz);
      }
      np.needsUpdate = true;
      for (let i = 0; i < tp.count; i++) {
        const x = tBX[i], v = tBV[i], dz = disp(x, 1, t);
        tp.setXYZ(i, x, topY(x) - 0.055 + v * 0.058 - Math.abs(dz) * 0.3, dz);
      }
      tp.needsUpdate = true;
      const h = topY(0) - 0.05, dz0 = disp(0, 0.6, t);
      strap.scale.y = h; strap.position.set(0, h / 2, dz0 * 0.8);
    }
    apply(0);
    netGeo.computeBoundingSphere(); tapeGeo.computeBoundingSphere();
    return {
      shake(x, strength) {
        imp.push({ x: clamp(+x || 0, -half, half), s: clamp(strength === undefined ? 0.8 : strength, 0, 1.6), t: 0 });
        if (imp.length > 5) imp.shift();
        idle = 0;
      },
      update(dt, t) {
        for (let i = imp.length - 1; i >= 0; i--) { imp[i].t += dt; if (imp[i].t > 1.6) imp.splice(i, 1); }
        if (imp.length || wind) { apply(t); idle = 0; }
        else if (idle < 2) { apply(t); idle++; }
      },
    };
  }

  /* ================= khán đài + khán giả "fan hạt đậu" ================= */
  // o: {x, z, len, rows, axis:'x'|'z', out:±1, rowH, rowD, riser, seatA, seatB, base, standing}
  function stand(X, o) {
    const b = X.deco, rowH = o.rowH === undefined ? 0.42 : o.rowH, rowD = o.rowD || 0.8, base = o.base || 0;
    const ax = o.axis === 'x';
    for (let r = 0; r < o.rows; r++) {
      const h = base + (r + 1) * rowH, off = r * rowD + rowD / 2;
      const cx = ax ? o.x : o.x + o.out * off, cz = ax ? o.z + o.out * off : o.z;
      if (rowH > 0) {
        box(b, cx, h / 2, cz, ax ? o.len : rowD, h, ax ? rowD : o.len, o.riser);
        const sOff = off - rowD * 0.2;
        const scx = ax ? o.x : o.x + o.out * sOff, scz = ax ? o.z + o.out * sOff : o.z;
        box(b, scx, h + 0.025, scz, ax ? o.len : rowD * 0.42, 0.05, ax ? rowD * 0.42 : o.len, r % 2 ? o.seatA : o.seatB);
      }
      const n = Math.floor(o.len / (o.spacing || 0.6));
      for (let i = 0; i < n; i++) {
        const along = -o.len / 2 + (i + 0.5) * (o.len / n) + (X.r() - 0.5) * 0.12;
        const so = off + (o.standing ? (X.r() - 0.5) * 0.3 : 0);
        const x = ax ? o.x + along : o.x + o.out * so, z = ax ? o.z + o.out * so : o.z + along;
        const tz = z * 0.45, tx = 0;
        X.seats.push({ x, y: h + (rowH > 0 ? 0.05 : 0), z, yaw: Math.atan2(tx - x, tz - z), u: (Math.atan2(z, x) / TAU + 1) % 1, standing: !!o.standing || rowH === 0 });
      }
    }
    if (rowH > 0 && o.rail !== false) {
      const h = base + o.rows * rowH + 0.5, off = o.rows * rowD;
      const cx = ax ? o.x : o.x + o.out * off, cz = ax ? o.z + o.out * off : o.z;
      box(b, cx, h - 0.25, cz, ax ? o.len : 0.06, 0.04, ax ? 0.06 : o.len, o.rail || 0xd8dde8);
      box(b, cx, base + o.rows * rowH + 0.1, cz, ax ? o.len : 0.05, 0.2, ax ? 0.05 : o.len, o.riser);
    }
  }

  function crowdGeometries() {
    const body = new Batch(), flag = new Batch();
    const lo = new THREE.SphereGeometry(0.5, 8, 6), lo2 = new THREE.SphereGeometry(0.5, 6, 4);
    body.add(new THREE.CapsuleGeometry(0.17, 0.24, 3, 10), T(0, 0.29, 0), 0xffffff);
    for (const s of [-1, 1]) {
      body.add(lo, T(s * 0.062, 0.43, 0.148, 0, 0, 0, 0.05, 0.064, 0.03), 0x1d1d26);
      body.add(lo2, T(s * 0.11, 0.37, 0.125, 0, 0, 0, 0.06, 0.035, 0.03), 0xffa0b0);
      body.add(lo, T(s * 0.17, 0.26, 0.04, 0, 0, s * 0.5, 0.07, 0.13, 0.07), 0xf2f2f2);
    }
    body.add(lo2, T(0, 0.37, 0.165, 0, 0, 0, 0.04, 0.02, 0.015), 0x5a2a2a);
    body.add(lo2, T(0, 0.6, 0, 0, 0, 0, 0.08, 0.05, 0.08), 0xe6e6e6);
    lo.dispose(); lo2.dispose();
    flag.add(G().cyl6, T(0, 0.22, 0, 0, 0, 0, 0.014, 0.44, 0.014), 0xbfbfbf);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.44, 0, 0, 0.3, 0, 0.2, 0.37, 0, 0, 0.44, 0, 0.2, 0.37, 0, 0, 0.3, 0], 3));
    tri.computeVertexNormals();
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0.5, 0, 1, 1, 0.5, 0, 0], 2));
    flag.add(tri, null, 0xffffff);
    return { body, flag };
  }

  function buildCrowd(X) {
    const seats = X.seats; if (!seats.length) return null;
    const r = rng(hashStr(X.id + 'crowd'));
    for (let i = seats.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = seats[i]; seats[i] = seats[j]; seats[j] = t; }
    const cap = Math.min(320, seats.length);
    const g = crowdGeometries();
    const bm = M(0xffffff, { vertexColors: true, roughness: 0.62 });
    const fm = M(0xffffff, { vertexColors: true, roughness: 0.7, side: THREE.DoubleSide });
    const bodyMesh = g.body.build(bm, false), flagMesh = g.flag.build(fm, false);
    const bodies = new THREE.InstancedMesh(bodyMesh.geometry, bm, cap);
    const flags = new THREE.InstancedMesh(flagMesh.geometry, fm, cap);
    for (const m of [bodies, flags]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; X.root.add(m); }
    const pal = X.look.crowdBodies;
    const data = [];
    for (let i = 0; i < cap; i++) {
      const s = seats[i];
      bodies.setColorAt(i, jit(pal[(r() * pal.length) | 0], r, 0.06));
      flags.setColorAt(i, lin(TEAM_FLAGS[(r() * TEAM_FLAGS.length) | 0]));
      data.push({ s, ph: r() * TAU, sp: 0.8 + r() * 0.6, ex: 0.6 + r() * 0.6, hasFlag: r() < 0.55, sc: (s.standing ? 1.18 : 1) * (0.9 + r() * 0.2), bob: s.bob || 0 });
    }
    bodies.instanceColor.needsUpdate = true; flags.instanceColor.needsUpdate = true;
    let pads = null;
    if (X.look.crowdPads) {
      const pg = new THREE.CylinderGeometry(0.3, 0.22, 0.06, 16);
      pads = new THREE.InstancedMesh(pg, new THREE.MeshBasicMaterial({ toneMapped: false }), cap);
      pads.instanceMatrix.setUsage(THREE.DynamicDrawUsage); pads.frustumCulled = false;
      const pc = [0x3fe8ff, 0xff4fd8, 0x8a7cff];
      for (let i = 0; i < cap; i++) pads.setColorAt(i, lin(pc[i % 3]));
      pads.instanceColor.needsUpdate = true; X.root.add(pads);
    }
    let count = cap, cheer = 0, waveT = -1;
    const mB = new THREE.Matrix4(), mF = new THREE.Matrix4(), mL = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3(), eul = new THREE.Euler(0, 0, 0, 'YXZ');
    const flagOff = new THREE.Vector3(), flagQ = new THREE.Quaternion(), flagE = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), zero = new THREE.Vector3(0, 0, 0);
    function setCount(n) { count = clamp(n | 0, 0, cap); bodies.count = count; flags.count = count; if (pads) pads.count = count; }
    setCount(QUALITY[X.q].crowd);
    function update(dt, t) {
      cheer = Math.max(0, cheer - dt * 0.32);
      if (waveT >= 0) { waveT += dt; if (waveT > 3.2) waveT = -1; }
      const wpos = waveT * 0.42 - 0.1;
      for (let i = 0; i < count; i++) {
        const d = data[i], s = d.s;
        let up = Math.sin(t * 2.1 * d.sp + d.ph) * 0.012, stretch = 0, armA = 0.25 + Math.sin(t * 1.6 + d.ph) * 0.15;
        if (cheer > 0.02) {
          const j = Math.max(0, Math.sin(t * 9.5 * d.sp + d.ph * 3));
          up += cheer * d.ex * j * 0.24; stretch += cheer * 0.12 * j;
          armA += cheer * (0.6 + Math.sin(t * 13 + d.ph) * 0.6);
        }
        if (waveT >= 0) {
          let dd = s.u - wpos; dd -= Math.round(dd);
          const a = Math.exp(-(dd * dd) / 0.0016);
          up += a * 0.42; stretch += a * 0.22; armA += a * 1.3;
        }
        const sway = Math.sin(t * 1.25 * d.sp + d.ph) * 0.07;
        if (d.bob) up += Math.sin(t * 0.9 * d.sp + d.ph) * d.bob;
        pos.set(s.x, s.y + up, s.z);
        if (pads) { mL.makeTranslation(s.x, s.y + up - 0.05, s.z); pads.setMatrixAt(i, mL); }
        eul.set(0, s.yaw, sway); quat.setFromEuler(eul);
        scl.set(d.sc * (1 - stretch * 0.25), d.sc * (1 + stretch), d.sc * (1 - stretch * 0.25));
        mB.compose(pos, quat, scl); bodies.setMatrixAt(i, mB);
        if (d.hasFlag) {
          flagOff.set(0.19, 0.22, 0.05); flagE.set(0, 0, -clamp(armA, -0.3, 1.6) * 0.9 + 0.2); flagQ.setFromEuler(flagE);
          mL.compose(flagOff, flagQ, one); mF.multiplyMatrices(mB, mL);
        } else mF.compose(zero, quat, zero);
        flags.setMatrixAt(i, mF);
      }
      bodies.instanceMatrix.needsUpdate = true; flags.instanceMatrix.needsUpdate = true;
      if (pads) pads.instanceMatrix.needsUpdate = true;
    }
    update(0, 0);
    return {
      bodies, flags, setCount, update,
      cheer(level) { cheer = Math.max(cheer, clamp(level === undefined ? 0.8 : +level, 0, 1)); },
      wave() { if (waveT < 0) waveT = 0; },
    };
  }

  /* ================= hạt môi trường ================= */
  function buildAmbient(X) {
    const sp = X.look.ambient; if (!sp) return null;
    const cap = Math.round(QUALITY.high.ambient * (sp.mult || 1));
    const a = sp.area, r = rng(hashStr(X.id + 'amb'));
    const P = [];
    const rand = (lo, hi) => lo + r() * (hi - lo);
    for (let i = 0; i < cap; i++) P.push({ x: rand(a[0], a[1]), y: rand(a[2], a[3]), z: rand(a[4], a[5]), ph: r() * TAU, sp: 0.6 + r() * 0.8, rx: r() * TAU, ry: r() * TAU, s: 0.7 + r() * 0.6 });
    let count = 0, obj, update;
    if (sp.kind === 'fall') {
      const geo = new THREE.CircleGeometry(0.5, 7);
      geo.scale(sp.size, sp.size * (sp.shape === 'leaf' ? 0.42 : 0.62), 1);
      const mat = M(0xffffff, { side: THREE.DoubleSide, roughness: 0.6 });
      obj = new THREE.InstancedMesh(geo, mat, cap);
      for (let i = 0; i < cap; i++) obj.setColorAt(i, jit(sp.colors[i % sp.colors.length], r, 0.05));
      obj.instanceColor.needsUpdate = true;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
      update = (dt, t) => {
        const gust = sp.gust ? (0.6 + 0.8 * Math.max(0, Math.sin(t * 0.37)) * Math.sin(t * 1.3) ** 2) : 1;
        for (let i = 0; i < count; i++) {
          const o = P[i];
          o.y -= sp.fall * o.sp * dt;
          o.x += (sp.wind[0] * gust + Math.sin(t * 1.1 * o.sp + o.ph) * sp.sway * 0.4) * dt;
          o.z += (sp.wind[1] * gust + Math.cos(t * 0.9 * o.sp + o.ph) * sp.sway * 0.25) * dt;
          o.rx += dt * 2.4 * o.sp; o.ry += dt * 1.7 * o.sp;
          if (o.y < 0.02) { o.y = a[3] + r() * 1.5; o.x = rand(a[0], a[1]); o.z = rand(a[4], a[5]); }
          if (o.x > a[1] + 2) o.x = a[0]; else if (o.x < a[0] - 2) o.x = a[1];
          e.set(o.rx, o.ry, o.rx * 0.5); q.setFromEuler(e); s.setScalar(o.s);
          m.compose(p.set(o.x, o.y, o.z), q, s); obj.setMatrixAt(i, m);
        }
        obj.instanceMatrix.needsUpdate = true;
      };
      obj.frustumCulled = false;
    } else {
      const geo = new THREE.BufferGeometry();
      const posA = new Float32Array(cap * 3), colA = new Float32Array(cap * 3), base = [];
      for (let i = 0; i < cap; i++) { const c = lin(sp.colors[i % sp.colors.length]); base.push(c); colA.set([c.r, c.g, c.b], i * 3); }
      geo.setAttribute('position', new THREE.BufferAttribute(posA, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(colA, 3).setUsage(THREE.DynamicDrawUsage));
      const mat = new THREE.PointsMaterial({ size: sp.size * 2.2, map: softTex(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, sizeAttenuation: true });
      obj = new THREE.Points(geo, mat); obj.frustumCulled = false;
      update = (dt, t) => {
        const gust = sp.gust ? (0.6 + 0.8 * Math.max(0, Math.sin(t * 0.37)) * Math.sin(t * 1.3) ** 2) : 1;
        for (let i = 0; i < count; i++) {
          const o = P[i];
          if (sp.fall) { o.y -= sp.fall * o.sp * dt; if (o.y < a[2]) { o.y = a[3]; o.x = rand(a[0], a[1]); o.z = rand(a[4], a[5]); } }
          o.x += (sp.drift[0] * gust + Math.sin(t * 0.7 * o.sp + o.ph) * 0.25) * dt;
          o.z += (sp.drift[1] + Math.cos(t * 0.6 * o.sp + o.ph) * 0.2) * dt;
          o.y += Math.sin(t * 0.9 * o.sp + o.ph * 2) * 0.12 * dt;
          if (o.x > a[1]) o.x = a[0]; if (o.x < a[0]) o.x = a[1];
          if (o.z > a[5]) o.z = a[4]; if (o.z < a[4]) o.z = a[5];
          posA[i * 3] = o.x; posA[i * 3 + 1] = o.y; posA[i * 3 + 2] = o.z;
          const k = 1 - sp.twinkle * 0.5 * (1 + Math.sin(t * 3 * o.sp + o.ph));
          const c = base[i]; colA[i * 3] = c.r * k; colA[i * 3 + 1] = c.g * k; colA[i * 3 + 2] = c.b * k;
        }
        geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
        geo.setDrawRange(0, count);
      };
    }
    X.root.add(obj);
    const setCount = (n) => { count = clamp(Math.round(n * (sp.mult || 1)), 0, cap); if (obj.isInstancedMesh) obj.count = count; obj.visible = count > 0; };
    setCount(QUALITY[X.q].ambient);
    update(0.016, 0);
    return { obj, update: (dt, t) => { if (count) update(dt, t); }, setCount };
  }

  /* ================= môi trường chung ================= */
  function addSky(X, radius) {
    const t = tex(X.look.skyCanvas ? X.look.skyCanvas(X) : gradientCanvas(X.look.sky, 512));
    const m = new THREE.Mesh(new THREE.SphereGeometry(radius || 190, 32, 16), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
    m.renderOrder = -10; m.frustumCulled = false;
    X.scene.add(m);
    return m;
  }
  function addGround(X, canvas, repeatM, size, hex, rough, y) {
    const S = Array.isArray(size) ? size : [size || 260, size || 260];
    const mat = M(hex || 0xffffff, { map: canvas ? tex(canvas, { repeat: [S[0] / repeatM, S[1] / repeatM] }) : null, roughness: rough || 0.9 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(S[0], S[1]), mat);
    m.rotation.x = -Math.PI / 2; m.position.y = y === undefined ? -0.01 : y; m.receiveShadow = true;
    X.root.add(m);
    return m;
  }
  function addLights(X) {
    const L = X.look;
    const hemi = new THREE.HemisphereLight(lin(L.hemi[0]), lin(L.hemi[1]), L.hemi[2]);
    X.scene.add(hemi);
    const sun = new THREE.DirectionalLight(lin(L.sun.color), L.sun.intensity);
    _v.set(L.sun.pos[0], L.sun.pos[1], L.sun.pos[2]).normalize().multiplyScalar(32);
    sun.position.copy(_v); sun.target.position.set(0, 0, 0);
    const sc = sun.shadow.camera; sc.left = -12; sc.right = 12; sc.top = 14; sc.bottom = -14; sc.near = 4; sc.far = 70;
    sun.shadow.normalBias = 0.02; sun.shadow.bias = -0.0004;
    X.scene.add(sun, sun.target);
    X.sun = sun; X.hemi = hemi;
  }
  function glowPoints(X, list, size, opts) {
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(list.length * 3), c = new Float32Array(list.length * 3);
    list.forEach((o, i) => { p.set([o[0], o[1], o[2]], i * 3); const cc = lin(o[3]); c.set([cc.r, cc.g, cc.b], i * 3); });
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size, map: softTex(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: (opts && opts.opacity) || 1, fog: !(opts && opts.noFog) }));
    pts.frustumCulled = false;
    X.root.add(pts);
    return pts;
  }

  /* --------- đạo cụ tái sử dụng --------- */
  function maiTree(X, x, z, s) {
    const b = X.solid, r = X.r; s = s || 1;
    cyl(b, x, 0.28 * s, z, 0.34 * s, 0.56 * s, 0xc4553a, G().cylT, Math.PI);
    cyl(b, x, 0.57 * s, z, 0.36 * s, 0.05 * s, 0x8f3a27);
    cyl(b, x, 0.56 * s, z, 0.3 * s, 0.03 * s, 0x5b3a22);
    const tips = [];
    const trunk = (x0, y0, z0, ang, tilt, len, rad, depth) => {
      const dx = Math.sin(tilt) * Math.cos(ang), dy = Math.cos(tilt), dz = Math.sin(tilt) * Math.sin(ang);
      const x1 = x0 + dx * len, y1 = y0 + dy * len, z1 = z0 + dz * len;
      _v2.set(dx, dy, dz).normalize(); _q.setFromUnitVectors(UP, _v2);
      b.add(G().cyl6, Tq(_v3.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), _q, _s.set(rad * 2, len, rad * 2)), 0x6b4428);
      if (depth > 0) { const n = depth > 1 ? 3 : 2; for (let k = 0; k < n; k++) trunk(x1, y1, z1, ang + (k - (n - 1) / 2) * 1.6 + (r() - 0.5) * 0.8, tilt * 0.6 + 0.35 + r() * 0.3, len * 0.66, rad * 0.62, depth - 1); }
      else tips.push([x1, y1, z1]);
    };
    trunk(x, 0.58 * s, z, r() * TAU, 0.12, 0.85 * s, 0.07 * s, 2);
    for (const t of tips) {
      for (let k = 0; k < 9; k++) {
        const rr = 0.22 * s;
        const col = r() < 0.82 ? jit(0xffcf2e, r, 0.08) : jit(0x7fb34a, r, 0.1);
        sph(b, t[0] + (r() - 0.5) * rr * 2, t[1] + (r() - 0.3) * rr * 1.6, t[2] + (r() - 0.5) * rr * 2, 0.07 * s, 0.07 * s, 0.07 * s, col, G().ico0);
      }
    }
  }
  function canopyTree(X, x, z, o) {
    const b = o.batch || X.solid, r = X.r, h = o.h;
    const lean = (r() - 0.5) * 0.15;
    b.add(G().cylT, T(x, h * 0.32, z, lean, 0, lean, o.tr * 2, h * 0.64, o.tr * 2), o.trunk || 0x6e4a2e);
    for (let k = 0; k < o.blobs; k++) {
      const a = r() * TAU, rad = o.r * Math.sqrt(r()) * 0.85, y = h * 0.62 + (r() - 0.25) * o.r * 0.9;
      const sz = o.r * (o.blobSize || 0.42) * (0.65 + r() * 0.6);
      sph(b, x + Math.cos(a) * rad, y, z + Math.sin(a) * rad, sz, sz * 0.82, sz, jit(o.greens[(r() * o.greens.length) | 0], r, 0.06), G().ico);
    }
  }
  function palm(X, x, z, h, dir) {
    const b = X.solid, r = X.r, n = 7;
    const pt = (t) => _v.set(x + Math.cos(dir) * h * 0.35 * t * t, h * t, z + Math.sin(dir) * h * 0.35 * t * t).clone();
    let top = null;
    for (let i = 0; i < n; i++) {
      const p0 = pt(i / n), p1 = pt((i + 1) / n);
      _v2.subVectors(p1, p0); const len = _v2.length(); _v2.normalize(); _q.setFromUnitVectors(UP, _v2);
      const rad = lerp(0.17, 0.11, i / n);
      b.add(G().cylT, Tq(p0.clone().add(p1).multiplyScalar(0.5), _q, _s.set(rad * 2, len * 1.08, rad * 2)), i % 2 ? 0x9a7048 : 0x8a613c);
      top = p1;
    }
    for (let k = 0; k < 9; k++) {
      const yaw = (k / 9) * TAU + r() * 0.3, droop = 0.35 + r() * 0.35;
      const m = new THREE.Matrix4().makeTranslation(top.x, top.y, top.z)
        .multiply(new THREE.Matrix4().makeRotationY(yaw))
        .multiply(new THREE.Matrix4().makeRotationX(droop))
        .multiply(new THREE.Matrix4().makeTranslation(0, 0, 1.05))
        .multiply(new THREE.Matrix4().makeScale(0.5, 0.06, 2.3));
      b.add(G().sph, m, jit(k % 2 ? 0x3faa55 : 0x2f9a4a, r, 0.06));
    }
    for (let k = 0; k < 3; k++) sph(b, top.x + Math.cos(k * 2.1) * 0.16, top.y - 0.12, top.z + Math.sin(k * 2.1) * 0.16, 0.1, 0.1, 0.1, 0x6b4a2a);
  }
  function umbrella(X, x, z, cols, tilt) {
    const b = X.solid, n = 8;
    cyl(b, x, 1.15, z, 0.03, 2.3, 0xf4f4f4);
    for (let i = 0; i < n; i++) {
      const g = new THREE.ConeGeometry(1.35, 0.55, 2, 1, true, (i / n) * TAU, TAU / n);
      b.add(g, T(x, 2.35, z, tilt || 0, 0, 0), cols[i % cols.length]); g.dispose();
    }
    sph(b, x, 2.64, z, 0.05, 0.05, 0.05, 0xffffff);
  }
  function bench(X, x, z, ry, col) {
    const b = X.solid, c = Math.cos(ry), s = Math.sin(ry);
    box(b, x, 0.42, z, 1.8, 0.06, 0.4, col || 0xd9a066, ry);
    box(b, x - s * 0.18, 0.72, z - c * 0.18, 1.8, 0.28, 0.05, col || 0xd9a066, ry);
    for (const k of [-0.75, 0.75]) box(b, x + c * k, 0.2, z - s * k, 0.06, 0.4, 0.36, 0x3a3f4a, ry);
  }
  function courtsideKit(X, side) {
    // ghế nghỉ + chai nước + túi vợt cạnh sân, ghế trọng tài ở đầu lưới
    const b = X.solid, x = side * (C.W + 2.0);
    bench(X, x, -1.6, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0x4a7fd0);
    bench(X, x, 1.6, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0xff7a59);
    const bottles = [0x5ec8ff, 0xff8fb1, 0x7ee0a1, 0xffd35c];
    for (let i = 0; i < 4; i++) { cyl(b, x + side * 0.6, 0.12, -0.4 + i * 0.26, 0.04, 0.24, bottles[i]); cyl(b, x + side * 0.6, 0.26, -0.4 + i * 0.26, 0.025, 0.04, 0xffffff); }
    box(b, x + side * 0.45, 0.14, 0.9, 0.3, 0.28, 0.75, 0x2f3a55, 0.2); box(b, x + side * 0.45, 0.3, 0.9, 0.18, 0.05, 0.6, 0xff6f91, 0.2);
    box(b, x + side * 0.5, 0.11, -1.0, 0.35, 0.22, 0.24, 0xffffff); box(b, x + side * 0.5, 0.23, -1.0, 0.37, 0.03, 0.26, 0x3d8bff);
  }
  function umpireChair(X, x) {
    const b = X.solid, s = Math.sign(x);
    for (const dx of [-0.25, 0.25]) for (const dz of [-0.25, 0.25]) box(b, x + dx, 0.75, dz, 0.05, 1.5, 0.05, 0xe8e8ee);
    box(b, x, 1.5, 0, 0.62, 0.06, 0.62, 0x3a6fd0); box(b, x + s * 0.28, 1.75, 0, 0.06, 0.5, 0.6, 0x3a6fd0);
    for (let k = 0; k < 4; k++) box(b, x - s * 0.3, 0.3 + k * 0.35, 0, 0.04, 0.04, 0.5, 0xe8e8ee);
    box(b, x, 1.85, 0, 0.5, 0.3, 0.5, 0xffffff, 0, 0, 0);
  }

  /* ================= 5 bối cảnh ================= */
  const VENUE_BUILD = {};

  VENUE_BUILD.gym = function (X) {
    const r = X.r;
    const floor = addGround(X, woodTexture(r), 3.2, 60, 0xffffff, 0.42);
    floor.material.envMapIntensity = 1.0; floor.userData.keepEnv = true;
    const d = X.deco, wallC = 0xf3e4cc, trim = 0x3f8f86, wood = 0xb9824f;
    const WX = 16, WZ = -19, WZN = 21, WH = 11;
    // tường
    box(d, 0, WH / 2, WZ, 2 * WX, WH, 0.4, wallC); box(d, 0, WH / 2, WZN, 2 * WX, WH, 0.4, wallC);
    box(d, -WX, WH / 2, 1, 0.4, WH, WZN - WZ, wallC); box(d, WX, WH / 2, 1, 0.4, WH, WZN - WZ, wallC);
    box(d, 0, 0.6, WZ + 0.22, 2 * WX, 1.2, 0.06, trim); box(d, -WX + 0.22, 0.6, 1, 0.06, 1.2, WZN - WZ, trim); box(d, WX - 0.22, 0.6, 1, 0.06, 1.2, WZN - WZ, trim);
    box(d, 0, 1.22, WZ + 0.24, 2 * WX, 0.06, 0.08, 0xffffff);
    box(d, 0, WH, 1, 2 * WX, 0.3, WZN - WZ, 0xd8c8ae);
    for (let i = -3; i <= 3; i++) box(d, i * 4.4, WH - 0.5, 1, 0.35, 0.7, WZN - WZ, 0xa87a4c);
    // cửa sổ lớn (kính sáng) – tường trái & tường sau
    const gl = X.glow;
    const win = (cx, cy, cz, w, h, axis) => {
      const sx = axis === 'x' ? w : 0.08, sz = axis === 'x' ? 0.08 : w, off = axis === 'x' ? [0, 0.16] : [0.16, 0];
      const sgn = axis === 'x' ? 1 : (cx < 0 ? 1 : -1);
      gl.add(G().box, T(cx + off[0] * sgn, cy + h * 0.25, cz + off[1], 0, 0, 0, sx, h * 0.5, sz), 0xdff1ff);
      gl.add(G().box, T(cx + off[0] * sgn, cy - h * 0.25, cz + off[1], 0, 0, 0, sx, h * 0.5, sz), 0xfff7e6);
      const fx = cx + off[0] * sgn * 1.4, fz = cz + off[1] * 1.4, fc = 0x7a5232;
      box(d, fx, cy + h / 2, fz, axis === 'x' ? w + 0.2 : 0.12, 0.14, axis === 'x' ? 0.12 : w + 0.2, fc);
      box(d, fx, cy - h / 2, fz, axis === 'x' ? w + 0.2 : 0.2, 0.18, axis === 'x' ? 0.2 : w + 0.2, fc);
      box(d, fx, cy, fz, axis === 'x' ? w : 0.1, 0.08, axis === 'x' ? 0.1 : w, fc);
      for (const k of [-0.5, 0, 0.5]) box(d, axis === 'x' ? fx + k * w : fx, cy, axis === 'x' ? fz : fz + k * w, axis === 'x' ? 0.1 : 0.12, h, axis === 'x' ? 0.12 : 0.1, fc);
    };
    for (let i = 0; i < 5; i++) win(-WX, 6.6, -15 + i * 5.2, 3.4, 3.8, 'z');
    for (let i = 0; i < 4; i++) win(-10.5 + i * 7, 7.6, WZ, 4.2, 2.6, 'x');
    for (let i = 0; i < 5; i++) win(WX, 6.6, -15 + i * 5.2, 3.4, 3.8, 'z');
    // vệt nắng xiên qua cửa sổ trái + mảng nắng trên sàn
    const L = X.look.sun.pos; _v.set(L[0], L[1], L[2]).normalize().negate();
    const shaftP = [], shaftC = [], sc = lin(0xfff0c8);
    const quad = (a, b2, c, dd, al) => { shaftP.push(...a, ...b2, ...c, ...a, ...c, ...dd); for (const k of [al[0], al[1], al[2], al[0], al[2], al[3]]) shaftC.push(sc.r, sc.g, sc.b, k); };
    for (let i = 0; i < 5; i++) {
      const z0 = -15 + i * 5.2, wx = -WX + 0.3, y0 = 6.6 + 1.9, y1 = 6.6 - 1.9;
      const tA = y0 / -_v.y, tB = y1 / -_v.y;
      const fA = [wx + _v.x * tA, 0.02, 0], fB = [wx + _v.x * tB, 0.02, 0];
      for (const [zz, w] of [[z0, 1.7]]) {
        const za = zz - w, zb = zz + w, dzA = _v.z * tA, dzB = _v.z * tB;
        quad([wx, y0, za], [wx, y0, zb], [fA[0], 0.02, zb + dzA], [fA[0], 0.02, za + dzA], [0.18, 0.18, 0.0, 0.0]);
        quad([wx, y1, za], [wx, y1, zb], [fB[0], 0.02, zb + dzB], [fB[0], 0.02, za + dzB], [0.1, 0.1, 0.0, 0.0]);
        quad([fB[0], 0.015, za + dzB], [fB[0], 0.015, zb + dzB], [fA[0], 0.015, zb + dzA], [fA[0], 0.015, za + dzA], [0.32, 0.32, 0.32, 0.32]);
      }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(shaftP, 3));
    sg.setAttribute('color', new THREE.Float32BufferAttribute(shaftC, 4));
    const shafts = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false }));
    shafts.renderOrder = 3; X.root.add(shafts);
    // khán đài gỗ
    const st = { riser: 0x8f9bc0, seatA: 0x4f86e0, seatB: 0xff9a5c, rowH: 0.42, rowD: 0.8, rail: 0xffffff };
    stand(X, Object.assign({ x: 7.6, z: 0, len: 17, rows: 4, axis: 'z', out: 1 }, st));
    stand(X, Object.assign({ x: -7.6, z: 0, len: 17, rows: 4, axis: 'z', out: -1 }, st));
    stand(X, Object.assign({ x: 0, z: -11.4, len: 13.5, rows: 5, axis: 'x', out: -1 }, st));
    // băng rôn & bảng điểm
    const ban = tex(textBannerCanvas([
      { text: 'HOA MAI OPEN', bg: '#e8463a', fg: '#ffe9a8', dot: '#ffd23f' },
      { text: 'PICKLE POP', bg: '#2f6fd0', fg: '#ffffff', dot: '#ffd23f' },
      { text: 'KITCHEN CLUB', bg: '#2e9a6f', fg: '#ffffff', dot: '#ffe9a8' },
    ], 2048, 128));
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(24, 1.5), M(0xffffff, { map: ban, roughness: 0.8, emissive: 0xffffff, emissiveMap: ban }));
    banner.material.emissiveIntensity = 0.12; banner.position.set(0, 4.7, WZ + 0.26); X.root.add(banner);
    box(d, 0, 9.6, WZ + 0.4, 4.6, 1.8, 0.4, 0x24262e);
    const sb = makeCanvas(256, 96), sg2 = sb.getContext('2d');
    sg2.fillStyle = '#0b0d14'; sg2.fillRect(0, 0, 256, 96); sg2.font = '900 54px system-ui, sans-serif'; sg2.textBaseline = 'middle';
    sg2.fillStyle = '#5ec8ff'; sg2.textAlign = 'left'; sg2.fillText('08', 22, 52); sg2.fillStyle = '#ffd23f'; sg2.textAlign = 'center'; sg2.fillText(':', 128, 48);
    sg2.fillStyle = '#ff8a5c'; sg2.textAlign = 'right'; sg2.fillText('06', 234, 52);
    const sbt = tex(sb);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.5), new THREE.MeshBasicMaterial({ map: sbt, toneMapped: false }));
    board.position.set(0, 9.6, WZ + 0.62); X.root.add(board);
    // cây mai chậu
    maiTree(X, -6.6, -10.2, 1.25); maiTree(X, 6.6, -10.2, 1.25); maiTree(X, -6.9, 8.4, 1.1); maiTree(X, 6.9, 8.4, 1.1);
    maiTree(X, -14.5, -17, 1.6); maiTree(X, 14.5, -17, 1.6);
    courtsideKit(X, -1); umpireChair(X, C.NET_HALF + 0.9);
    // đèn trần
    const lights = [];
    for (let i = -2; i <= 2; i++) for (let j = 0; j < 4; j++) { gl.add(G().box, T(i * 5, WH - 0.9, -14 + j * 8, 0, 0, 0, 1.6, 0.12, 0.6), 0xfffbe8); lights.push([i * 5, WH - 1.0, -14 + j * 8, 0xfff2cc]); }
    glowPoints(X, lights, 2.4, { opacity: 0.6 });
  };

  VENUE_BUILD.beach = function (X) {
    const r = X.r;
    const sand = addGround(X, sandCanvas(r, '#ecc98f'), 5, [320, 200], 0xffffff, 0.95);
    sand.position.z = -22 + 100;
    // biển (dịch đỉnh trên CPU)
    const seaGeo = new THREE.PlaneGeometry(320, 140, 64, 26); seaGeo.rotateX(-Math.PI / 2); seaGeo.translate(0, 0, -21 - 70);
    const sp = seaGeo.attributes.position, sBase = new Float32Array(sp.array);
    const cols = new Float32Array(sp.count * 3), near = lin(0x22c4c8), far = lin(0x0c5aa6), tmp = new THREE.Color();
    for (let i = 0; i < sp.count; i++) { const t = clamp((-21 - sBase[i * 3 + 2]) / 60, 0, 1); tmp.copy(near).lerp(far, Math.pow(t, 0.6)); cols.set([tmp.r, tmp.g, tmp.b], i * 3); }
    seaGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const sea = new THREE.Mesh(seaGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.0 }));
    sea.material.envMapIntensity = 0.55; sea.userData.keepEnv = true; sea.receiveShadow = false; X.root.add(sea);
    const foamGeo = new THREE.PlaneGeometry(320, 2.2, 64, 1); foamGeo.rotateX(-Math.PI / 2); foamGeo.translate(0, 0.05, -21.2);
    const foam = new THREE.Mesh(foamGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }));
    X.root.add(foam);
    const wet = new THREE.Mesh(new THREE.PlaneGeometry(320, 5), M(0xc9a873, { roughness: 0.35, transparent: true, opacity: 0.55, depthWrite: false }));
    wet.rotation.x = -Math.PI / 2; wet.position.set(0, -0.005, -19.6); X.root.add(wet);
    let seaFrame = 0;
    X.updaters.push((dt, t) => {
      if ((seaFrame++ & 1) === 0) {
        for (let i = 0; i < sp.count; i++) {
          const x = sBase[i * 3], z = sBase[i * 3 + 2];
          const k = clamp((-21 - z) / 10, 0.12, 1);
          sp.array[i * 3 + 1] = -0.06 + k * (Math.sin(x * 0.18 + t * 1.1 + z * 0.05) * 0.16 + Math.sin(z * 0.33 - t * 1.6) * 0.12 + Math.sin((x + z) * 0.6 + t * 2.3) * 0.04);
        }
        sp.needsUpdate = true; seaGeo.computeVertexNormals();
      }
      foam.position.z = Math.sin(t * 0.8) * 0.9; foam.material.opacity = 0.45 + 0.3 * Math.sin(t * 0.8 + 1.2);
    });
    // mây
    const cb = X.deco;
    for (let i = 0; i < 9; i++) {
      const cx = -120 + i * 30 + r() * 12, cy = 22 + r() * 18, cz = -150 - r() * 20;
      for (let k = 0; k < 6; k++) sph(cb, cx + (k - 2.5) * 4 + r() * 2, cy + r() * 3 * Math.sin(k), cz, 5 + r() * 3, 3 + r() * 2, 3, 0xffffff, G().ico);
    }
    // cây dừa, ô, tháp cứu hộ
    const palms = [[-10, -8, 6.2, 0.4], [-12.5, -2, 7, 2.8], [10.5, -9, 6.6, 2.6], [12.5, -3, 7.2, 0.3], [-11, 7, 6.4, 3.4], [11.5, 6, 6.8, -0.2], [-17, -14, 7.5, 0.6], [17, -15, 7.2, 2.7], [-7, -17.5, 6.5, -0.6], [8, -17, 7.0, 3.6]];
    for (const p of palms) palm(X, p[0], p[1], p[2], p[3]);
    umbrella(X, -9.2, -13.5, [0xff6f61, 0xffffff], 0.08); umbrella(X, 9.5, -13, [0x2ec4b6, 0xffffff], -0.06); umbrella(X, -14, 3, [0xffd166, 0xff8fab], 0.1); umbrella(X, 14, 0, [0x7b9cff, 0xffffff], -0.08);
    const s = X.solid;
    const towel = (x, z, ry, a, b2) => { box(s, x, 0.01, z, 0.9, 0.02, 1.8, a, ry); box(s, x, 0.012, z, 0.9, 0.02, 0.3, b2, ry); };
    towel(-8.6, -12.2, 0.2, 0xff8fab, 0xffffff); towel(10.2, -11.8, -0.3, 0x5ec8ff, 0xffffff); towel(-13, 4.5, 0.5, 0xffd166, 0xff6f61);
    for (const [x, z, c] of [[-7.6, -13.4, 0x3d8bff], [11, -13.6, 0xff6f61]]) { box(s, x, 0.2, z, 0.6, 0.4, 0.4, c); box(s, x, 0.42, z, 0.62, 0.06, 0.42, 0xffffff); }
    for (const [x, z, c, ry] of [[-15.5, -9, 0xff6f61, 0.3], [-15.9, -8.2, 0x2ec4b6, 0.1], [15.6, -7.5, 0xffd166, -0.2]]) s.add(G().sph, T(x, 1.0, z, 0.15, ry, 0, 0.55, 2.4, 0.12), c);
    // tháp cứu hộ
    const tx = 15, tz = -12;
    for (const dx of [-0.8, 0.8]) for (const dz of [-0.8, 0.8]) box(s, tx + dx, 1.3, tz + dz, 0.12, 2.6, 0.12, 0xf3efe6);
    box(s, tx, 2.65, tz, 2.2, 0.12, 2.2, 0xd9b48a); box(s, tx, 3.35, tz, 1.8, 1.3, 1.6, 0xff5d4f);
    box(s, tx, 3.35, tz + 0.81, 1.2, 0.6, 0.02, 0x9fd8ff); s.add(G().cone4, T(tx, 4.35, tz, 0, Math.PI / 4, 0, 3.0, 0.8, 3.0), 0xffffff);
    for (let k = 0; k < 6; k++) box(s, tx - 0.4, 0.3 + k * 0.4, tz + 1.5 - k * 0.12, 0.8, 0.05, 0.18, 0xf3efe6);
    // khán đài gỗ thấp 2 bên + khán giả đứng trên cát phía sau
    const st = { riser: 0xeee6d8, seatA: 0x2ec4b6, seatB: 0xff8a6b, rowH: 0.4, rowD: 0.78, rail: 0xffffff };
    stand(X, Object.assign({ x: 7.7, z: -0.5, len: 15, rows: 3, axis: 'z', out: 1 }, st));
    stand(X, Object.assign({ x: -7.7, z: -0.5, len: 15, rows: 3, axis: 'z', out: -1 }, st));
    stand(X, { x: 0, z: -11.6, len: 13, rows: 2, axis: 'x', out: -1, rowH: 0, rowD: 0.8, standing: true, spacing: 0.7 });
    // dây cờ đuôi nheo quanh sân + cờ lông vũ bay theo gió
    const flagGeo = new THREE.BufferGeometry(), fP = [], fC = [], fBase = [], fW = [];
    const flagDefs = [[-6.8, -11.2, 0xff6f61], [6.8, -11.2, 0x2ec4b6], [-13.5, -11, 0xffd166], [13.2, -10.5, 0x7b9cff], [-9.8, 10, 0xff8fab], [9.8, 10, 0xffd166]];
    for (const [fx, fz, fc] of flagDefs) {
      cyl(s, fx, 1.8, fz, 0.035, 3.6, 0x3a3f4a);
      const g = new THREE.PlaneGeometry(0.9, 2.2, 8, 4); g.translate(0.45, 2.3, 0);
      const ng = g.toNonIndexed(); g.dispose();
      const a = ng.attributes.position.array, cc = lin(fc);
      for (let i = 0; i < a.length; i += 3) {
        let lx = a[i], ly = a[i + 1];
        const taper = 1 - ((ly - 1.2) / 2.2) * 0.0; const tip = lx / 0.9;
        ly = 1.2 + (ly - 1.2) * (1 - 0.25 * tip * (ly < 2.3 ? 1 : 0)) ;
        fBase.push(fx + lx * taper, ly, fz); fW.push(tip);
        fP.push(fx + lx, ly, fz); fC.push(cc.r, cc.g, cc.b);
      }
      ng.dispose();
    }
    flagGeo.setAttribute('position', new THREE.Float32BufferAttribute(fP, 3));
    flagGeo.setAttribute('color', new THREE.Float32BufferAttribute(fC, 3));
    flagGeo.computeVertexNormals();
    const flagsM = new THREE.Mesh(flagGeo, M(0xffffff, { vertexColors: true, side: THREE.DoubleSide, roughness: 0.6 }));
    flagsM.castShadow = true; flagsM.frustumCulled = false; X.root.add(flagsM);
    const fpa = flagGeo.attributes.position.array;
    X.updaters.push((dt, t) => {
      for (let i = 0, n = fBase.length / 3; i < n; i++) {
        const w = fW[i], bx = fBase[i * 3], by = fBase[i * 3 + 1], bz = fBase[i * 3 + 2];
        const ph = t * 6 - w * 4 + bx * 0.3;
        fpa[i * 3] = bx; fpa[i * 3 + 1] = by + Math.sin(ph * 0.5) * 0.04 * w; fpa[i * 3 + 2] = bz + Math.sin(ph) * 0.22 * w;
      }
      flagGeo.attributes.position.needsUpdate = true;
      if ((X.frame & 3) === 0) flagGeo.computeVertexNormals();
    });
    // hải âu (instanced)
    const gulls = 6, gb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 10, 8), M(0xffffff, { roughness: 0.6 }), gulls);
    const wingGeo = new THREE.BoxGeometry(1, 0.03, 0.32); wingGeo.translate(0.5, 0, 0);
    const gw = new THREE.InstancedMesh(wingGeo, M(0xe9edf3, { roughness: 0.6 }), gulls * 2);
    gb.frustumCulled = gw.frustumCulled = false; X.root.add(gb, gw);
    const gd = []; for (let i = 0; i < gulls; i++) gd.push({ cx: (r() - 0.5) * 30, cz: -16 - r() * 14, rad: 5 + r() * 7, h: 7 + r() * 5, sp: (0.25 + r() * 0.2) * (r() < 0.5 ? -1 : 1), ph: r() * TAU });
    const mm = new THREE.Matrix4(), mw = new THREE.Matrix4(), q1 = new THREE.Quaternion(), e1 = new THREE.Euler(0, 0, 0, 'YXZ'), p1 = new THREE.Vector3(), s1 = new THREE.Vector3(0.5, 0.3, 0.9), s2 = new THREE.Vector3(1, 1, 1);
    const ml = new THREE.Matrix4(), ql = new THREE.Quaternion(), el = new THREE.Euler();
    X.updaters.push((dt, t) => {
      for (let i = 0; i < gulls; i++) {
        const g = gd[i], a = t * g.sp + g.ph;
        p1.set(g.cx + Math.cos(a) * g.rad, g.h + Math.sin(t * 0.8 + g.ph) * 0.6, g.cz + Math.sin(a) * g.rad);
        const yaw = Math.atan2(-Math.sin(a) * Math.sign(g.sp), Math.cos(a) * Math.sign(g.sp));
        e1.set(0, yaw, -Math.sign(g.sp) * 0.25); q1.setFromEuler(e1);
        mm.compose(p1, q1, s1); gb.setMatrixAt(i, mm);
        const flap = Math.sin(t * 7 + g.ph * 3) * 0.55;
        for (const sd of [-1, 1]) {
          el.set(0, sd < 0 ? Math.PI : 0, flap * (sd < 0 ? -1 : 1) * -1 + 0.1); ql.setFromEuler(el);
          ml.compose(_v3.set(0, 0.05, 0), ql, s2); mw.compose(p1, q1, s2).multiply(ml); gw.setMatrixAt(i * 2 + (sd > 0 ? 1 : 0), mw);
        }
      }
      gb.instanceMatrix.needsUpdate = true; gw.instanceMatrix.needsUpdate = true;
    });
  };

  VENUE_BUILD.roof = function (X) {
    const r = X.r;
    const rf = addGround(X, tileCanvas(r, '#b0aaa2', '#7d7770', 4), 2.4, [26, 34], 0xffffff, 0.85);
    rf.position.z = -2;
    const d = X.deco, s = X.solid;
    const PX = 13, PZ0 = -19, PZ1 = 15;
    // lan can
    box(d, 0, 0.55, PZ0, 2 * PX + 0.5, 1.1, 0.3, 0xc8c2bb); box(d, 0, 1.13, PZ0, 2 * PX + 0.7, 0.08, 0.45, 0xe8e2da);
    box(d, -PX, 0.55, (PZ0 + PZ1) / 2, 0.3, 1.1, PZ1 - PZ0, 0xc8c2bb); box(d, PX, 0.55, (PZ0 + PZ1) / 2, 0.3, 1.1, PZ1 - PZ0, 0xc8c2bb);
    box(d, -PX, 1.13, (PZ0 + PZ1) / 2, 0.45, 0.08, PZ1 - PZ0, 0xe8e2da); box(d, PX, 1.13, (PZ0 + PZ1) / 2, 0.45, 0.08, PZ1 - PZ0, 0xe8e2da);
    // mặt bằng thấp bên dưới (nền thành phố)
    const cityFloor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), M(0x3a3550, { roughness: 1 })); cityFloor.rotation.x = -Math.PI / 2; cityFloor.position.y = -30; X.root.add(cityFloor);
    // toà nhà có cửa sổ sáng (1 mesh)
    const wc = windowCanvases(r, '#8a8fa8', 6, 8, 0.5, ['#ffd27a', '#ffe7b0', '#ffc46b', '#bfe0ff']);
    const wm = tex(wc.map, { repeat: [1, 1] }), we = tex(wc.emi, { repeat: [1, 1] });
    const bb = new Batch();
    const bcol = [0x6c6f95, 0x8a7aa8, 0x5b6a8f, 0x9a8296, 0x7b86a6, 0xb08a8a];
    for (let i = 0; i < 70; i++) {
      const ang = -Math.PI / 2 + (r() - 0.5) * Math.PI * 1.7;
      const rad = 48 + r() * 70, w = 7 + r() * 9, dd = 7 + r() * 9;
      const tall = r() < 0.18;
      const top = tall ? 14 + r() * 22 : -12 + r() * 16 + (rad - 48) * 0.08;
      const h = 30 + top;
      const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      if (z > 8 || h < 4) continue;
      bb.add(G().box, T(x, -30 + h / 2, z, 0, -ang, 0, w, h, dd), jit(bcol[i % bcol.length], r, 0.08), Math.round(w / 3.5), Math.round(h / 4));
      if (r() < 0.4) box(d, x, -30 + h + 0.8, z, w * 0.3, 1.6, dd * 0.3, 0x4a4560);
      if (tall) X.glow.add(G().sph, T(x, -30 + h + 0.4, z, 0, 0, 0, 0.6, 0.6, 0.6), 0xff4a4a);
    }
    const bmat = new THREE.MeshStandardMaterial({ map: wm, emissive: lin(0xffffff), emissiveMap: we, emissiveIntensity: 1.1, vertexColors: true, roughness: 0.8 });
    X.root.add(bb.build(bmat, false));
    // mặt trời lặn
    X.glow.add(G().circle, T(-55, 9, -150, 0, 0.35, 0, 22, 22, 1), 0xffe2a0);
    glowPoints(X, [[-55, 9, -149, 0xffb070]], 70, { opacity: 0.55, noFog: true });
    // bồn nước, máy lạnh, chậu hoa giấy
    const tx = -10.2, tz = -15.8;
    for (const dx of [-0.9, 0.9]) for (const dz of [-0.9, 0.9]) box(s, tx + dx, 1.2, tz + dz, 0.14, 2.4, 0.14, 0x5a5e6a);
    box(s, tx, 2.42, tz, 2.3, 0.1, 2.3, 0x5a5e6a);
    cyl(s, tx, 3.6, tz, 1.15, 2.3, 0x4f8fc8); cyl(s, tx, 3.6, tz, 1.17, 0.08, 0x3a6fa0); s.add(G().cone, T(tx, 5.0, tz, 0, 0, 0, 2.35, 0.6, 2.35), 0x3a6fa0);
    for (let i = 0; i < 4; i++) {
      const ax = PX - 0.9, az = -14 + i * 2.2;
      box(s, ax, 0.42, az, 0.7, 0.8, 1.6, 0xe7e9ee); cyl(s, ax - 0.36, 0.42, az, 0.32, 0.02, 0x3a3e48, null, 0, 0, Math.PI / 2);
      cyl(s, ax - 0.37, 0.42, az, 0.08, 0.02, 0xbfc3cc, null, 0, 0, Math.PI / 2);
    }
    for (const [x, z] of [[-11.5, -6], [-11.5, 2], [11.8, 4], [-6.5, -17.8], [6.5, -17.8]]) {
      cyl(s, x, 0.3, z, 0.38, 0.6, 0xd27a4f, G().cylT, Math.PI);
      canopyTree(X, x, z, { h: 1.9, r: 0.75, tr: 0.06, blobs: 12, greens: [0xff4fa0, 0xff6fb5, 0xe83a8a, 0x5fa83a], blobSize: 0.38 });
    }
    // khán đài kim loại thấp + ghế băng
    const st = { riser: 0x6d7388, seatA: 0xffb35c, seatB: 0x7b6cff, rowH: 0.38, rowD: 0.75, rail: 0xd8dde8 };
    stand(X, Object.assign({ x: 7.5, z: -1.5, len: 13, rows: 2, axis: 'z', out: 1 }, st));
    stand(X, Object.assign({ x: -7.5, z: -1.5, len: 13, rows: 2, axis: 'z', out: -1 }, st));
    stand(X, Object.assign({ x: 1.5, z: -11.5, len: 12, rows: 3, axis: 'x', out: -1 }, st));
    // dây đèn lấp lánh dọc 2 bên + phía sau
    const poles = [[-6.4, -11], [-6.4, -3.5], [-6.4, 4], [-6.4, 11], [6.4, -11], [6.4, -3.5], [6.4, 4], [6.4, 11]];
    for (const p of poles) { cyl(s, p[0], 1.9, p[1], 0.05, 3.8, 0x2f3340); }
    const bulbs = [];
    const wireSeg = [];
    const strand2 = (a, b2, sag, n) => {
      let px = a[0], py = 3.75, pz = a[1];
      for (let i = 1; i <= n; i++) {
        const t = i / n, x = lerp(a[0], b2[0], t), z = lerp(a[1], b2[1], t), y = 3.75 - sag * Math.sin(Math.PI * t);
        wireSeg.push(px, py, pz, x, y, z); px = x; py = y; pz = z;
        if (i < n) bulbs.push([x, y - 0.08, z]);
      }
    };
    for (const sd of [-6.4, 6.4]) { strand2([sd, -11], [sd, -3.5], 0.55, 10); strand2([sd, -3.5], [sd, 4], 0.55, 10); strand2([sd, 4], [sd, 11], 0.55, 10); }
    strand2([-6.4, -11], [6.4, -11], 0.9, 16);
    strand2([-6.4, -11], [6.4, -3.5], 1.0, 18);
    strand2([6.4, -11], [-6.4, -3.5], 1.0, 18);
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wireSeg, 3));
    X.root.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: lin(0x2a2a30) })));
    const bulbCols = [0xffe6a0, 0xffd06a, 0xfff2c8, 0xffb86b];
    const bm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), bulbs.length);
    bulbs.forEach((p, i) => { bm.setMatrixAt(i, T(p[0], p[1], p[2])); bm.setColorAt(i, lin(bulbCols[i % 4])); });
    bm.instanceColor.needsUpdate = true; X.root.add(bm);
    const glow = glowPoints(X, bulbs.map((p, i) => [p[0], p[1], p[2], bulbCols[i % 4]]), 0.55, { opacity: 0.85 });
    const gcol = glow.geometry.attributes.color, gbase = Float32Array.from(gcol.array);
    const phs = bulbs.map(() => r() * TAU);
    X.updaters.push((dt, t) => {
      for (let i = 0; i < bulbs.length; i++) {
        const k = 0.65 + 0.35 * Math.sin(t * 2.2 + phs[i]) * Math.sin(t * 0.7 + phs[i] * 2);
        gcol.array[i * 3] = gbase[i * 3] * k; gcol.array[i * 3 + 1] = gbase[i * 3 + 1] * k; gcol.array[i * 3 + 2] = gbase[i * 3 + 2] * k;
      }
      gcol.needsUpdate = true;
    });
    courtsideKit(X, -1); umpireChair(X, C.NET_HALF + 0.9);
  };

  VENUE_BUILD.park = function (X) {
    const r = X.r;
    addGround(X, grassCanvas(r), 4, 320, 0xffffff, 0.95);
    const s = X.solid, d = X.deco;
    // lối đi
    const path = new THREE.Mesh(new THREE.PlaneGeometry(3, 80), M(0xd8c9a8, { roughness: 0.95 })); path.rotation.x = -Math.PI / 2; path.rotation.z = 0.0; path.position.set(-11.2, -0.004, -10); path.receiveShadow = true; X.root.add(path);
    // hàng rào lưới B40 (alphaTest => có bóng đổ)
    const FX = 7.2, FZ = -11.6, FH = 3.0;
    const ft = tex(gridAlphaCanvas(64, 5, true), { repeat: [1, 1], linear: true });
    const fenceMat = M(0x9aa8a4, { alphaMap: ft, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.3 });
    const fenceGeo = new THREE.BufferGeometry(), fp = [], fu = [], fnn = [];
    const panel = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0), ru = len / 0.12, rv = FH / 0.12;
      fp.push(x0, 0, z0, x1, 0, z1, x1, FH, z1, x0, 0, z0, x1, FH, z1, x0, FH, z0);
      fu.push(0, 0, ru, 0, ru, rv, 0, 0, ru, rv, 0, rv);
      const nx = -(z1 - z0) / len, nz = (x1 - x0) / len; for (let i = 0; i < 6; i++) fnn.push(nx, 0, nz);
    };
    panel(-FX, FZ, FX, FZ); panel(-FX, FZ, -FX, 10.5); panel(FX, FZ, FX, 10.5);
    fenceGeo.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); fenceGeo.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2)); fenceGeo.setAttribute('normal', new THREE.Float32BufferAttribute(fnn, 3));
    const fence = new THREE.Mesh(fenceGeo, fenceMat); fence.castShadow = true; fence.receiveShadow = false; X.root.add(fence);
    const postC = 0x3d5a48;
    for (let x = -FX; x <= FX + 0.01; x += FX / 3) cyl(s, x, FH / 2, FZ, 0.045, FH, postC);
    for (let z = FZ + 3.7; z <= 10.6; z += 3.7) { cyl(s, -FX, FH / 2, z, 0.045, FH, postC); cyl(s, FX, FH / 2, z, 0.045, FH, postC); }
    box(s, 0, FH, FZ, 2 * FX, 0.05, 0.05, postC); box(s, -FX, FH, (FZ + 10.5) / 2, 0.05, 0.05, 10.5 - FZ, postC); box(s, FX, FH, (FZ + 10.5) / 2, 0.05, 0.05, 10.5 - FZ, postC);
    // khán đài ngoài hàng rào + người đứng xem trên cỏ phía sau
    const st = { riser: 0x8d97a5, seatA: 0x5ec27a, seatB: 0xf2f2f2, rowH: 0.4, rowD: 0.78, rail: 0xd8dde8 };
    stand(X, Object.assign({ x: 8.3, z: -0.5, len: 14, rows: 3, axis: 'z', out: 1 }, st));
    stand(X, Object.assign({ x: -8.3, z: -0.5, len: 14, rows: 3, axis: 'z', out: -1 }, st));
    stand(X, { x: 0, z: -12.9, len: 12, rows: 2, axis: 'x', out: -1, rowH: 0, rowD: 0.8, standing: true, spacing: 0.75 });
    // cây me (tán lá mịn)
    const greens = [0x3f8a2e, 0x529e38, 0x337a28, 0x67ad45, 0x4a9334];
    const trees = [[-12.5, -8], [-13.5, -1.5], [-12.8, 6], [13, -9], [13.6, -2], [12.6, 5.5], [-9.5, -16.5], [-3, -17.5], [4, -17], [10.5, -16.2], [-17, -13], [17, -13], [-18, 3], [18, 2]];
    for (const t of trees) canopyTree(X, t[0], t[1], { h: 5.5 + r() * 2, r: 2.6 + r() * 0.9, tr: 0.2, blobs: 26, greens, blobSize: 0.36, trunk: 0x5e4029 });
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU, rad = 45 + r() * 25, x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (z > 20) continue;
      canopyTree(X, x, z, { batch: d, h: 7 + r() * 5, r: 4 + r() * 2, tr: 0.35, blobs: 6, greens: [0x5c9a48, 0x4c8a3c, 0x6eaa52], blobSize: 0.6 });
    }
    for (let i = 0; i < 6; i++) { const x = -120 + i * 48, z = -140 - r() * 20; sph(d, x, -6, z, 40 + r() * 20, 22 + r() * 10, 30, jit(0x7fb07a, r, 0.06), G().sph); }
    // đèn công viên, ghế, thùng rác
    for (const [x, z] of [[-9.6, -11.8], [9.6, -11.8], [-9.6, 10], [9.6, 10]]) {
      cyl(s, x, 2.6, z, 0.07, 5.2, 0x2f3a3a); box(s, x, 5.25, z, 0.5, 0.18, 0.3, 0x2f3a3a); X.glow.add(G().box, T(x, 5.14, z, 0, 0, 0, 0.42, 0.05, 0.22), 0xfff4d6);
    }
    bench(X, -10.4, -13.6, 0, 0xc98a52); bench(X, 10.4, -13.6, 0, 0xc98a52);
    cyl(s, -9.8, 0.45, -14.6, 0.28, 0.9, 0x3c8a5a); cyl(s, 11.2, 0.45, -14.4, 0.28, 0.9, 0x3c8a5a);
    courtsideKit(X, -1);
    for (const [x, z, c] of [[-10.8, -6, 0xff6f91], [-11, -5, 0xffd35c], [-10.6, -4.2, 0x5ec8ff]]) s.add(G().sph, T(x, 0.25, z, 0, 0, 0, 0.5, 0.5, 0.5), c);
  };

  VENUE_BUILD.arena = function (X) {
    const r = X.r;
    const fl = addGround(X, tileCanvas(r, '#22283a', '#1a1f2e', 2), 6, 120, 0xffffff, 0.35);
    fl.material.envMapIntensity = 0.8; fl.userData.keepEnv = true;
    const d = X.deco, s = X.solid;
    // khán đài dốc cao bao quanh
    const st = { riser: 0x30364e, seatA: 0x3c4568, seatB: 0x2a3150, rowH: 0.5, rowD: 0.85, rail: 0x9aa4c8 };
    stand(X, Object.assign({ x: 0, z: -12.2, len: 20, rows: 6, axis: 'x', out: -1, spacing: 0.55 }, st));
    stand(X, Object.assign({ x: 8.4, z: -0.5, len: 21, rows: 5, axis: 'z', out: 1, spacing: 0.55 }, st));
    stand(X, Object.assign({ x: -8.4, z: -0.5, len: 21, rows: 5, axis: 'z', out: -1, spacing: 0.55 }, st));
    // tầng trên tối (không người) để khán đài trông cao
    box(d, 0, 4.0, -18.7, 24, 2.6, 1.4, 0x1b2034); box(d, -14.1, 3.5, -0.5, 1.4, 2.4, 25, 0x1b2034); box(d, 14.1, 3.5, -0.5, 1.4, 2.4, 25, 0x1b2034);
    box(d, 0, 5.5, -19.5, 40, 11, 0.6, 0x161a2a); box(d, -15.5, 5.5, -0.5, 0.6, 11, 40, 0x161a2a); box(d, 15.5, 5.5, -0.5, 0.6, 11, 40, 0x161a2a);
    // bảng LED quanh sân (texture chạy chữ)
    const ledC = textBannerCanvas([
      { text: 'PICKLE POP', bg: '#ff3d7f', fg: '#ffffff' }, { text: 'ĐẤU TRƯỜNG ĐÊM', bg: '#1b2a6b', fg: '#7ef0ff' },
      { text: 'KITCHEN CLUB', bg: '#ffb020', fg: '#1b1b2b' }, { text: 'DINK • DROP • DRIVE', bg: '#11b886', fg: '#ffffff' },
    ], 2048, 96);
    const ledT = tex(ledC, { repeat: [1, 1] });
    const lb = new Batch();
    const ledH = 0.8;
    lb.add(G().plane, T(0, ledH / 2 + 0.02, -11.15, 0, 0, 0, 13, ledH, 1), 0xffffff, 1.6, 1);
    lb.add(G().plane, T(-7.05, ledH / 2 + 0.02, -1, 0, Math.PI / 2, 0, 18, ledH, 1), 0xffffff, 2.2, 1);
    lb.add(G().plane, T(7.05, ledH / 2 + 0.02, -1, 0, -Math.PI / 2, 0, 18, ledH, 1), 0xffffff, 2.2, 1);
    const ledMat = new THREE.MeshBasicMaterial({ map: ledT, vertexColors: true, toneMapped: false });
    X.root.add(lb.build(ledMat, false));
    box(d, 0, ledH / 2, -11.25, 13.2, ledH + 0.06, 0.18, 0x111522); box(d, -7.15, ledH / 2, -1, 0.18, ledH + 0.06, 18.2, 0x111522); box(d, 7.15, ledH / 2, -1, 0.18, ledH + 0.06, 18.2, 0x111522);
    // vòng LED trên mép khán đài
    const ring = new Batch();
    ring.add(G().plane, T(0, 4.6, -17.98, 0, 0, 0, 22, 0.7, 1), 0xffffff, 1.8, 1);
    ring.add(G().plane, T(-13.38, 4.1, -0.5, 0, Math.PI / 2, 0, 24, 0.7, 1), 0xffffff, 2, 1);
    ring.add(G().plane, T(13.38, 4.1, -0.5, 0, -Math.PI / 2, 0, 24, 0.7, 1), 0xffffff, 2, 1);
    const ringT = tex(ledC, { repeat: [1, 1] });
    X.root.add(ring.build(new THREE.MeshBasicMaterial({ map: ringT, vertexColors: true, toneMapped: false }), false));
    X.updaters.push((dt, t) => { ledT.offset.x = (t * 0.06) % 1; ringT.offset.x = (-t * 0.04) % 1; });
    // tháp đèn pha
    const flood = [];
    for (const [x, z] of [[-13.5, -16.5], [13.5, -16.5], [-14, 9], [14, 9]]) {
      box(s, x, 6, z, 0.4, 12, 0.4, 0x2a2f40);
      box(d, x, 12.3, z, 3.2, 1.6, 0.3, 0x1c2030, Math.atan2(-x, -z));
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
        const ox = (i - 1) * 0.95, oy = (j - 0.5) * 0.7, ry = Math.atan2(-x, -z);
        const px = x + Math.cos(ry) * ox + Math.sin(ry) * 0.2, pz = z - Math.sin(ry) * ox + Math.cos(ry) * 0.2;
        X.glow.add(G().circle, T(px, 12.3 + oy, pz, 0, ry, 0, 0.6, 0.6, 1), 0xf4f8ff);
        flood.push([px, 12.3 + oy, pz, 0xdde8ff]);
      }
    }
    // dàn đèn treo trên tường sau & hai bên (nằm trong khung hình)
    for (let i = 0; i < 8; i++) {
      const x = -10.5 + i * 3;
      box(d, x, 6.3, -19.0, 2.2, 0.7, 0.4, 0x23283a);
      for (let k = 0; k < 3; k++) { X.glow.add(G().circle, T(x - 0.65 + k * 0.65, 6.3, -18.78, 0, 0, 0, 0.5, 0.5, 1), 0xf4f8ff); flood.push([x - 0.65 + k * 0.65, 6.3, -18.6, 0xdde8ff]); }
    }
    for (const sd of [-1, 1]) for (let i = 0; i < 6; i++) {
      const z = -14 + i * 4;
      box(d, sd * 15.1, 7.0, z, 0.4, 0.7, 2.2, 0x23283a);
      for (let k = 0; k < 3; k++) { X.glow.add(G().circle, T(sd * 14.88, 7.0, z - 0.65 + k * 0.65, 0, -sd * Math.PI / 2, 0, 0.5, 0.5, 1), 0xf4f8ff); flood.push([sd * 14.7, 7.0, z - 0.65 + k * 0.65, 0xdde8ff]); }
    }
    glowPoints(X, flood, 3.2, { opacity: 0.85, noFog: true });
    // sao trời
    const stars = []; for (let i = 0; i < 160; i++) { const a = r() * TAU, el = 0.08 + r() * 0.9, R = 170; stars.push([Math.cos(a) * Math.cos(el) * R, Math.sin(el) * R, Math.sin(a) * Math.cos(el) * R, r() < 0.2 ? 0xbcd2ff : 0xffffff]); }
    glowPoints(X, stars, 1.6, { opacity: 0.9, noFog: true });
    // đèn rọi quét sân (không đổ bóng) + nón sáng
    const spot = new THREE.SpotLight(lin(0xfff1d0), 1.8, 40, 0.3, 0.6, 1.2);
    spot.position.set(0, 14, 7); spot.target.position.set(0, 0, 0); X.scene.add(spot, spot.target);
    const coneGeo = new THREE.ConeGeometry(1, 1, 24, 1, true); coneGeo.translate(0, -0.5, 0);
    const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: lin(0xfff1d0), transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false }));
    X.root.add(cone);
    let focus = null;
    const tgt = new THREE.Vector3();
    X.updaters.push((dt, t) => {
      if (focus) tgt.set(focus.x, 0, focus.z); else tgt.set(Math.sin(t * 0.31) * 2.4, 0, Math.sin(t * 0.17) * 5.5);
      spot.target.position.lerp(tgt, 1 - Math.exp(-dt * (focus ? 6 : 1.5)));
      const dir = _v.subVectors(spot.target.position, spot.position), len = dir.length();
      cone.position.copy(spot.position); cone.quaternion.setFromUnitVectors(_v2.set(0, -1, 0), dir.normalize());
      const rad = Math.tan(spot.angle) * len; cone.scale.set(rad, len, rad);
    });
    X.focus = (p) => { focus = p ? { x: p.x, z: p.z } : null; };
    // ghế trọng tài + băng ghế
    courtsideKit(X, -1); umpireChair(X, C.NET_HALF + 0.9);
  };

  /* ================= v3: tiện ích cho 5 sân mới ================= */
  const VCFG = (id) => ((PP.VENUES || []).find((v) => v.id === id)) || {};
  function lighten(hex, k) { const c = new THREE.Color(hex), hsl = {}; c.getHSL(hsl); c.setHSL(hsl.h, hsl.s, clamp(hsl.l + k, 0, 1)); return c.getHex(); }
  const qn = (X, hi, lo) => (X.q === 'high' ? hi : X.q === 'low' ? lo : Math.round((hi + lo) / 2));
  const f4 = (v) => (+v).toFixed(4);
  function prismGeo() {
    const g0 = G(); if (g0.prism) return g0.prism;
    const p = [-0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,
      0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0,
      -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0];
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.computeVertexNormals();
    g0.prism = g; g0.cone8 = new THREE.ConeGeometry(0.5, 1, 8); g0.torusH = null;
    return g;
  }
  function cone8() { prismGeo(); return G().cone8; }
  /* ma trận cục bộ: đặt đồ vật theo hệ trục của một công trình (xoay quanh Y) */
  function placer(x, y, z, yaw) {
    const base = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw || 0, 0)), new THREE.Vector3(1, 1, 1));
    const fn = (b, geo, lx, ly, lz, sx, sy, sz, hex, rx, ry, rz) => b.add(geo, new THREE.Matrix4().multiplyMatrices(base, T(lx, ly, lz, rx, ry, rz, sx, sy, sz)), hex);
    fn.pt = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyMatrix4(base);
    return fn;
  }
  /* geometry có màu theo đỉnh → Batch (hex = null) */
  function addVC(b, geo, m) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m) g.applyMatrix4(m);
    const P = g.attributes.position.array, N = g.attributes.normal.array, Cc = g.attributes.color.array, n = P.length / 3;
    for (let i = 0; i < n; i++) { b.p.push(P[3 * i], P[3 * i + 1], P[3 * i + 2]); b.n.push(N[3 * i], N[3 * i + 1], N[3 * i + 2]); b.c.push(Cc[3 * i], Cc[3 * i + 1], Cc[3 * i + 2]); b.u.push(0, 0); }
    g.dispose();
  }
  function cloudCanvas(r) {
    const W = 256, H = 128, c = makeCanvas(W, H), g = c.getContext('2d');
    for (let i = 0; i < 26; i++) {
      const x = 56 + r() * 144, y = 52 + r() * 30, rr = 16 + r() * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    return c;
  }
  /* mặt nước: sóng dịch đỉnh trong vertex shader (rẻ), pháp tuyến giải tích */
  function waterSurface(X, o) {
    const geo = new THREE.PlaneGeometry(o.w, o.d, o.seg[0], o.seg[1]); geo.rotateX(-Math.PI / 2);
    if (o.colors) {
      const p = geo.attributes.position, col = new Float32Array(p.count * 3), tmp = new THREE.Color();
      for (let i = 0; i < p.count; i++) { o.colors(p.getX(i) + (o.cx || 0), p.getZ(i) + (o.cz || 0), tmp); col.set([tmp.r, tmp.g, tmp.b], i * 3); }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    const mat = M(o.color || 0xffffff, { roughness: o.rough || 0.2, metalness: 0, vertexColors: !!o.colors });
    const uT = { value: 0 };
    let code = 'float ppH = 0.0; vec2 ppG = vec2(0.0); float ppPh; vec2 ppW = position.xz + vec2(' + f4(o.cx || 0) + ',' + f4(o.cz || 0) + ');\n';
    for (const w of o.waves) {
      const L = Math.hypot(w[0], w[1]), kx = (w[0] / L) * w[2], kz = (w[1] / L) * w[2];
      code += 'ppPh = dot(ppW, vec2(' + f4(kx) + ',' + f4(kz) + ')) + uT * ' + f4(w[3]) + ';\nppH += ' + f4(w[4]) + ' * sin(ppPh); ppG += ' + f4(w[4]) + ' * cos(ppPh) * vec2(' + f4(kx) + ',' + f4(kz) + ');\n';
    }
    code += 'vec3 objectNormal = normalize(vec3(-ppG.x, 1.0, -ppG.y));\n';
    const key = 'ppwater' + hashStr(code);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uT = uT;
      sh.vertexShader = 'uniform float uT;\n' + sh.vertexShader
        .replace('#include <beginnormal_vertex>', code)
        .replace('#include <begin_vertex>', 'vec3 transformed = vec3( position ); transformed.y += ppH;');
    };
    mat.customProgramCacheKey = () => key;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(o.cx || 0, o.y, o.cz || 0); mesh.receiveShadow = true; mesh.frustumCulled = false;
    if (o.env !== undefined) { mat.envMapIntensity = o.env; mesh.userData.keepEnv = true; }
    X.root.add(mesh);
    X.updaters.push((dt, t) => { uT.value = t; });
    return mesh;
  }
  /* đàn chim / hải âu bay vòng */
  function flock(X, o) {
    const n = o.n, r = X.r, sz = o.size || 1;
    const gb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 8, 6), M(o.color, { roughness: 0.7 }), n);
    const wingGeo = new THREE.BoxGeometry(1, 0.03, 0.32); wingGeo.translate(0.5, 0, 0);
    const gw = new THREE.InstancedMesh(wingGeo, M(o.wing || o.color, { roughness: 0.7 }), n * 2);
    gb.frustumCulled = gw.frustumCulled = false; gb.castShadow = gw.castShadow = false; X.root.add(gb, gw);
    const gd = [];
    for (let i = 0; i < n; i++) gd.push({ cx: o.cx + (r() - 0.5) * o.spread[0], cz: o.cz + (r() - 0.5) * o.spread[1], rad: lerp(o.rad[0], o.rad[1], r()), h: lerp(o.h[0], o.h[1], r()), sp: o.speed * (0.8 + r() * 0.4) * (r() < 0.5 ? -1 : 1), ph: r() * TAU });
    const mm = new THREE.Matrix4(), mw = new THREE.Matrix4(), ml = new THREE.Matrix4(), q1 = new THREE.Quaternion(), ql = new THREE.Quaternion();
    const e1 = new THREE.Euler(0, 0, 0, 'YXZ'), el = new THREE.Euler(), p1 = new THREE.Vector3(), off = new THREE.Vector3(0, 0.05, 0);
    const s1 = new THREE.Vector3(0.5, 0.3, 0.9).multiplyScalar(sz), s2 = new THREE.Vector3(sz, sz, sz), one = new THREE.Vector3(1, 1, 1);
    X.updaters.push((dt, t) => {
      for (let i = 0; i < n; i++) {
        const g = gd[i], a = t * g.sp + g.ph, sg = Math.sign(g.sp);
        p1.set(g.cx + Math.cos(a) * g.rad, g.h + Math.sin(t * 0.8 + g.ph) * 0.6, g.cz + Math.sin(a) * g.rad);
        e1.set(0, Math.atan2(-Math.sin(a) * sg, Math.cos(a) * sg), -sg * 0.25); q1.setFromEuler(e1);
        mm.compose(p1, q1, s1); gb.setMatrixAt(i, mm);
        const flap = Math.sin(t * (o.flap || 7) + g.ph * 3) * 0.55;
        for (const sd of [-1, 1]) {
          el.set(0, sd < 0 ? Math.PI : 0, flap * (sd < 0 ? 1 : -1) + 0.1); ql.setFromEuler(el);
          ml.compose(off, ql, one); mw.compose(p1, q1, s2).multiply(ml); gw.setMatrixAt(i * 2 + (sd > 0 ? 1 : 0), mw);
        }
      }
      gb.instanceMatrix.needsUpdate = true; gw.instanceMatrix.needsUpdate = true;
    });
  }
  /* cờ đuôi nheo bay theo gió (1 mesh) – gust(t) trả về hệ số gió */
  function featherFlags(X, defs, gust) {
    const s = X.solid, fP = [], fC = [], fBase = [], fW = [];
    for (const [fx, fz, fc, ph] of defs) {
      cyl(s, fx, 1.9, fz, 0.035, 3.8, 0x4a3a2a);
      const g = new THREE.PlaneGeometry(0.7, 2.4, 8, 4); g.translate(0.35, 2.5, 0);
      const ng = g.toNonIndexed(); g.dispose();
      const a = ng.attributes.position.array, cc = lin(fc);
      for (let i = 0; i < a.length; i += 3) { fBase.push(fx + a[i], a[i + 1], fz, ph || 0); fW.push(a[i] / 0.7); fP.push(fx + a[i], a[i + 1], fz); fC.push(cc.r, cc.g, cc.b); }
      ng.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(fP, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(fC, 3)); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, M(0xffffff, { vertexColors: true, side: THREE.DoubleSide, roughness: 0.6 }));
    mesh.castShadow = true; mesh.frustumCulled = false; X.root.add(mesh);
    const pa = geo.attributes.position.array;
    X.updaters.push((dt, t) => {
      const gs = gust ? gust(t) : 1;
      for (let i = 0, n = fW.length; i < n; i++) {
        const w = fW[i], bx = fBase[i * 4], by = fBase[i * 4 + 1], bz = fBase[i * 4 + 2], ph = t * (5 + 3 * gs) - w * 4 + fBase[i * 4 + 3];
        pa[i * 3] = bx;
        pa[i * 3 + 1] = by + Math.sin(ph * 0.5) * 0.05 * w;
        pa[i * 3 + 2] = bz + Math.sin(ph) * (0.12 + 0.2 * gs) * w;
      }
      geo.attributes.position.needsUpdate = true;
      if ((X.frame & 3) === 0) geo.computeVertexNormals();
    });
  }
  /* gió giật dùng chung (đồng bộ với hạt môi trường) */
  const gustOf = (t) => 0.6 + 0.8 * Math.max(0, Math.sin(t * 0.37)) * Math.sin(t * 1.3) ** 2;

  /* ================= v3: 5 bối cảnh mới ================= */
  {
    const c = VCFG('hoian');
    LOOKS.hoian = {
      court: c.court || 0xc0563b, kitchen: lighten(c.court || 0xc0563b, 0.07), outer: c.outer || 0x9a3b3b, line: 0xffffff, lineGlow: 0.42,
      sky: [[0, '#060718'], [0.34, '#121436'], [0.45, '#2c2452'], [0.5, '#4d3160'], [0.53, '#22182c'], [1, '#0c0912']], fog: [0x1c1630, 22, 105],
      hemi: [0x5a56b8, 0x2a1810, 0.34], sun: { color: 0xffb070, intensity: 0.5, pos: [3, 13, 10] }, env: 0.06, exposure: 1.05,
      crowdBodies: [0xffd6a5, 0xffadad, 0xfdffb6, 0xffc6ff, 0xa0c4ff, 0xffb38a, 0xcaffbf, 0xff9f9f],
      ambient: { kind: 'float', colors: [0xffb84a, 0xffcf7a, 0xff9a3a, 0xffe2a8], size: 0.06, area: [-15, 15, 0.3, 3.2, -13.5, 11], drift: [0.04, 0.02], twinkle: 1, mult: 0.6 },
    };
  }
  {
    const c = VCFG('terrace');
    LOOKS.terrace = {
      court: c.court || 0x3d8bbf, kitchen: lighten(c.court || 0x3d8bbf, 0.08), outer: c.outer || 0x5a9a3a, line: 0xffffff, windNet: 1.3,
      sky: [[0, '#3f9be6'], [0.4, '#a8d8fb'], [0.49, '#e4f2f8'], [0.52, '#eef4ee'], [1, '#9cc27a']], fog: [0xdce9ee, 80, 300],
      hemi: [0xdcefff, 0x6f9248, 0.5], sun: { color: 0xfff0d2, intensity: 1.5, pos: [9, 15, 7] }, env: 0.45, exposure: 0.95,
      crowdBodies: [0x3a46a0, 0xe0384e, 0xf2a03a, 0x2fae7a, 0xff6fae, 0xffd23f, 0x7b5cd6, 0x23272e],
      ambient: { kind: 'fall', shape: 'leaf', colors: [0xc8a24a, 0xa88a3a, 0x5f8f34, 0xdcb868], size: 0.075, area: [-14, 14, 0, 7, -15, 9], fall: 0.5, sway: 1.0, wind: [1.3, 0.25], gust: true },
    };
  }
  {
    const c = VCFG('halong');
    LOOKS.halong = {
      court: c.court || 0x2b7fb0, kitchen: lighten(c.court || 0x2b7fb0, 0.08), outer: 0xd9b48a, outerWood: true, line: 0xffffff, windNet: 0.6,
      sky: [[0, '#4fb0dc'], [0.42, '#b6e2ef'], [0.49, '#e2f2ef'], [0.52, '#d6ece6'], [1, '#3f9e94']], fog: [0xcde6e2, 26, 185],
      hemi: [0xe0f4ff, 0x2f8f88, 0.5], sun: { color: 0xfff2dc, intensity: 1.5, pos: [-8, 14, 7] }, env: 0.5, exposure: 0.95,
      crowdBodies: [0xffd6a5, 0xffadad, 0xfdffb6, 0x9bf6ff, 0xffc6ff, 0xffb38a, 0xcaffbf, 0xffffff],
      ambient: { kind: 'float', colors: [0xffffff, 0xeafffa], size: 0.05, area: [-16, 16, 0.2, 3, -17, 12], drift: [0.7, 0.1], twinkle: 0.5, mult: 0.5 },
    };
  }
  {
    const c = VCFG('snow');
    LOOKS.snow = {
      court: c.court || 0x4a6fd0, kitchen: lighten(c.court || 0x4a6fd0, 0.08), outer: c.outer || 0x9cc3de, line: 0xffffff, windNet: 0.7,
      sky: [[0, '#6aa2d8'], [0.42, '#bcd8f0'], [0.49, '#e6f0f8'], [0.52, '#eef3f8'], [1, '#d4e0ea']], fog: [0xdbe6f0, 30, 240],
      hemi: [0xcfe4ff, 0x9fb2c8, 0.55], sun: { color: 0xeaf2ff, intensity: 1.3, pos: [-7, 12, 6] }, env: 0.5, exposure: 0.88,
      crowdBodies: [0xff5d5d, 0x3d8bff, 0xffd23f, 0x2fbf7a, 0xff8fc8, 0xff9a3c, 0x8a6cff, 0xffffff],
      ambient: { kind: 'float', colors: [0xf4f8ff, 0xe8f0ff, 0xdde8ff], size: 0.055, area: [-16, 16, 0, 10, -18, 12], drift: [0.35, 0.05], twinkle: 0, fall: 0.75, gust: true, mult: 2.4 },
    };
  }
  {
    const c = VCFG('space');
    LOOKS.space = {
      court: c.court || 0x5b4bd6, kitchen: lighten(c.court || 0x5b4bd6, 0.08), outer: c.outer || 0x3a3f6a, line: 0xffffff, lineGlow: 0.45, crowdPads: true,
      sky: [[0, '#05061a'], [1, '#0b0d24']], skyCanvas: (X) => spaceSkyCanvas(X.r), fog: [0x0b0d24, 70, 280],
      hemi: [0x9a96ff, 0x2a2048, 0.5], sun: { color: 0xf0f2ff, intensity: 1.65, pos: [2, 18, 7] }, env: 0.6, exposure: 1.0,
      crowdBodies: [0xa0c4ff, 0xbdb2ff, 0xffc6ff, 0x9bf6ff, 0xcaffbf, 0xfdffb6, 0xffadad, 0x7ef0d0],
      ambient: { kind: 'float', colors: [0x9ef0ff, 0xd0a0ff, 0xffffff], size: 0.05, area: [-14, 14, 0.5, 6, -14, 10], drift: [0.05, 0.03], twinkle: 1, mult: 0.5 },
    };
  }
  Object.assign(SURFACE, { hoian: 'hard', terrace: 'hard', halong: 'wood', snow: 'hard', space: 'hard' });

  /* ---------- Phố Hội ---------- */
  const HA_WALL = [0xf2c14e, 0xe9b43c, 0xf5cd62, 0xdfa83a, 0xf0bc48, 0xe6a845, 0xf3c75a];
  const LANTERN_COLS = [0xff3b2f, 0xff8a1f, 0xffd23f, 0xff4f9a, 0xc05cff, 0x3fd07a, 0x4f9fff, 0xff3b2f, 0xff8a1f];
  function shophouse(X, x, z, yaw, w, dep, h, hang) {
    const r = X.r, b = X.deco, gl = X.glow, P = placer(x, 0, z, yaw);
    const wall = jit(HA_WALL[(r() * HA_WALL.length) | 0], r, 0.05), wood = jit(0x5a2e1a, r, 0.06), roof = jit(0x9a4530, r, 0.06), roofD = 0x5e2418;
    const fz = dep / 2, BX = G().box;
    P(b, BX, 0, h / 2, 0, w, h, dep, wall);
    P(b, BX, 0, 1.35, fz + 0.03, w * 0.94, 2.7, 0.08, wood);
    const doors = w > 3.6 ? 3 : 2, dw = (w * 0.94) / doors;
    for (let i = 0; i < doors; i++) {
      const dx = (i - (doors - 1) / 2) * dw;
      if (r() < 0.72) P(gl, BX, dx, 1.12, fz + 0.08, dw * 0.72, 1.95, 0.02, jit(0xffa448, r, 0.05));
      else P(b, BX, dx, 1.12, fz + 0.08, dw * 0.72, 1.95, 0.02, 0x2e180e);
    }
    P(b, BX, 0, 2.97, fz + 0.5, w + 0.12, 0.07, 1.06, roof, 0.33);
    P(b, BX, 0, 2.8, fz + 1.0, w + 0.12, 0.07, 0.09, roofD);
    if (r() < 0.6) {
      P(b, BX, 0, 3.32, fz + 0.36, w * 0.9, 0.08, 0.72, wood);
      P(b, BX, 0, 3.86, fz + 0.7, w * 0.9, 0.05, 0.05, wood);
      for (let k = 0; k <= 6; k++) P(b, BX, -w * 0.45 + (k / 6) * w * 0.9, 3.6, fz + 0.7, 0.04, 0.5, 0.04, wood);
    }
    const nw = w > 3.6 ? 3 : 2, shut = r() < 0.5 ? 0x2f6f62 : 0x2c5a86;
    const floors = h > 5.6 ? 2 : 1;
    for (let f = 0; f < floors; f++) for (let i = 0; i < nw; i++) {
      const wx = (i - (nw - 1) / 2) * (w / nw), wy = 4.1 + f * 1.45;
      if (r() < 0.75) P(gl, BX, wx, wy, fz + 0.02, 0.62, 0.86, 0.04, jit(0xffc066, r, 0.06)); else P(b, BX, wx, wy, fz + 0.02, 0.62, 0.86, 0.04, 0x3a2418);
      P(b, BX, wx - 0.45, wy, fz + 0.05, 0.26, 0.9, 0.04, shut); P(b, BX, wx + 0.45, wy, fz + 0.05, 0.26, 0.9, 0.04, shut);
    }
    const rh = 1.25 + r() * 0.45, rd = dep + 1.0;
    P(b, prismGeo(), 0, h, 0, w + 0.5, rh, rd, roof);
    const slope = Math.atan2(rh, rd / 2), sl = Math.hypot(rh, rd / 2), step = X.q === 'low' ? 0.55 : 0.34;
    for (let k = -w / 2 - 0.1; k <= w / 2 + 0.1; k += step) {
      P(b, BX, k, h + rh / 2 + 0.035, rd / 4 + 0.015, 0.07, 0.05, sl, roofD, slope);
      P(b, BX, k, h + rh / 2 + 0.035, -rd / 4 - 0.015, 0.07, 0.05, sl, roofD, -slope);
    }
    P(b, BX, 0, h + rh + 0.03, 0, w + 0.62, 0.13, 0.17, roofD);
    for (const sd of [-1, 1]) P(b, BX, sd * (w / 2 + 0.3), h + rh + 0.1, 0, 0.12, 0.3, 0.18, roofD, 0, 0, -sd * 0.4);
    if (hang) {
      const n = w > 3.6 ? 3 : 2;
      for (let i = 0; i < n; i++) { const p = P.pt((i - (n - 1) / 2) * (w / n), 2.7, fz + 0.75); hang.push([p.x, p.y, p.z]); }
    }
  }
  function lanternGeometry() {
    const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(0.05 + Math.sin(Math.PI * t) * 0.17, -0.02 - t * 0.4)); }
    const b = new Batch();
    const lathe = new THREE.LatheGeometry(pts, 12); b.add(lathe, null, 0xffffff); lathe.dispose();
    b.add(G().cyl, T(0, -0.01, 0, 0, 0, 0, 0.13, 0.04, 0.13), 0x26120a);
    b.add(G().cyl, T(0, -0.43, 0, 0, 0, 0, 0.13, 0.04, 0.13), 0x26120a);
    b.add(G().cyl6, T(0, -0.55, 0, 0, 0, 0, 0.035, 0.2, 0.035), 0xffffff);
    b.add(G().cyl6, T(0, 0.12, 0, 0, 0, 0, 0.012, 0.26, 0.012), 0x1a0e08);
    const m = b.build(null); return m.geometry;
  }
  VENUE_BUILD.hoian = function (X) {
    const r = X.r, s = X.solid, d = X.deco, gl = X.glow;
    const g0 = addGround(X, tileCanvas(r, '#8c7260', '#5a4636', 6), 3, [150, 60], 0xffffff, 0.85); g0.position.z = 15.8;
    const far = new THREE.Mesh(new THREE.PlaneGeometry(200, 60), M(0x4a3c34, { roughness: 0.95 })); far.rotation.x = -Math.PI / 2; far.position.set(0, -0.01, -55.4); X.root.add(far);
    // bờ kè + sông
    const RZ0 = -14.2, RZ1 = -25.4, WY = -0.62;
    box(d, 0, -0.35, RZ0 - 0.15, 200, 0.75, 0.3, 0x6e5e50); box(d, 0, -0.35, RZ1 + 0.15, 200, 0.75, 0.3, 0x5e5046);
    for (let x = -30; x <= 30; x += 2.4) { box(s, x, 0.32, RZ0 + 0.05, 0.22, 0.64, 0.22, 0x8a7a6c); }
    box(s, 0, 0.62, RZ0 + 0.05, 60, 0.08, 0.16, 0x9a8a7a);
    waterSurface(X, { w: 200, d: RZ0 - RZ1 + 0.6, seg: [100, 8], cx: 0, cz: (RZ0 + RZ1) / 2, y: WY, color: 0x152640, rough: 0.07, env: 0.9,
      waves: [[1, 0.3, 1.6, 1.1, 0.012], [-0.4, 1, 2.3, 1.7, 0.008], [0.8, -0.6, 3.1, 2.2, 0.005]] });
    // dãy nhà vàng hai bên + bên kia sông
    const hang = [];
    for (const sd of [-1, 1]) {
      let z = -12.6;
      while (z < 16) { const w = 3.2 + r() * 1.2; shophouse(X, sd * 12.9, z + w / 2, sd > 0 ? -Math.PI / 2 : Math.PI / 2, w, 4.5, 4.7 + r() * 1.6, z + w / 2 < 11 ? hang : null); z += w + 0.05; }
    }
    { let x = -48; while (x < 48) { const w = 3.3 + r() * 1.3; shophouse(X, x + w / 2, -28.3, 0, w, 5, 4.6 + r() * 1.8, Math.abs(x) < 34 ? hang : null); x += w + 0.05; } }
    // Chùa Cầu
    const bx = -7.5, bzc = (RZ0 + RZ1) / 2, bl = RZ0 - RZ1 + 0.6;
    box(s, bx, 0.05, bzc, 3.4, 0.22, bl, 0x6a3a22);
    for (const z of [RZ0 - 2.5, bzc, RZ1 + 2.5]) for (const sx of [-1, 1]) box(d, bx + sx * 1.3, -0.4, z, 0.5, 0.9, 0.5, 0x8a7c6c);
    for (let z = RZ1 + 0.2; z <= RZ0 + 0.01; z += 1.38) for (const sx of [-1, 1]) box(s, bx + sx * 1.55, 1.25, z, 0.16, 2.4, 0.16, 0x7a2416);
    for (const sx of [-1, 1]) { box(s, bx + sx * 1.58, 0.5, bzc, 0.1, 0.62, bl, 0xb5502c); box(s, bx + sx * 1.58, 2.42, bzc, 0.14, 0.16, bl, 0x6a2214); }
    s.add(prismGeo(), T(bx, 2.48, bzc, 0, Math.PI / 2, 0, bl + 1.0, 1.5, 4.6), 0x9a4230);
    box(s, bx, 4.0, bzc, 0.2, 0.16, bl + 1.2, 0x5e2418);
    for (const zz of [RZ0 + 0.4, RZ1 - 0.4]) box(s, bx, 4.1, zz, 0.2, 0.42, 0.14, 0x5e2418, 0, zz > bzc ? 0.4 : -0.4);
    for (let z = RZ1 + 1.2; z < RZ0; z += 2.6) for (const sx of [-1, 1]) hang.push([bx + sx * 2.05, 2.3, z]);
    // dây đèn lồng giăng ngang phía sau sân
    const wire = [];
    for (const [zz, hh] of [[-12.4, 5.3], [-13.5, 5.8]]) {
      const n = 15; let px = -10.4, py = hh, pz = zz;
      for (let i = 1; i <= n; i++) {
        const t = i / n, x = lerp(-10.4, 10.4, t), y = hh - 0.9 * Math.sin(Math.PI * t);
        wire.push(px, py, pz, x, y, zz); px = x; py = y;
        if (i < n) hang.push([x, y - 0.02, zz]);
      }
    }
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    X.root.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: lin(0x1a1210) })));
    for (const sd of [-1, 1]) for (const zz of [-12.4, -13.5]) box(s, sd * 10.4, zz < -13 ? 2.9 : 2.65, zz, 0.12, zz < -13 ? 5.8 : 5.3, 0.12, 0x3a2416);
    // đèn lồng (instanced, đung đưa)
    const L = hang.filter((p, i) => X.q !== 'low' || i % 2 === 0);
    const lg = lanternGeometry();
    const lm = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
    const lan = new THREE.InstancedMesh(lg, lm, L.length); lan.frustumCulled = false; X.root.add(lan);
    const lcol = L.map(() => LANTERN_COLS[(r() * LANTERN_COLS.length) | 0]);
    L.forEach((p, i) => { const cc = lin(lcol[i]); lan.setColorAt(i, cc.multiplyScalar(1.15)); });
    lan.instanceColor.needsUpdate = true;
    const glow = glowPoints(X, L.map((p, i) => [p[0], p[1] - 0.22, p[2], lcol[i]]), 1.5, { opacity: 0.75 });
    const gpos = glow.geometry.attributes.position;
    const lph = L.map(() => r() * TAU), lsc = L.map(() => 0.9 + r() * 0.35);
    // phản chiếu trên mặt sông (vệt dọc lung linh)
    const refl = [];
    L.forEach((p, i) => { if (p[2] < RZ0 - 0.5) refl.push({ x: p[0], z: Math.min(RZ0 - 0.5, p[2] + 2.2), c: lin(lcol[i]), ph: lph[i] }); });
    const rg = new THREE.BufferGeometry(), rP = [], rU = [], rC = new Float32Array(refl.length * 6 * 4);
    for (const o of refl) {
      const w = 0.32, l = 3.6, y = WY + 0.05;
      rP.push(o.x - w, y, o.z - l / 2, o.x + w, y, o.z - l / 2, o.x + w, y, o.z + l / 2, o.x - w, y, o.z - l / 2, o.x + w, y, o.z + l / 2, o.x - w, y, o.z + l / 2);
      rU.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    }
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rP, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(rU, 2));
    rg.setAttribute('color', new THREE.BufferAttribute(rC, 4).setUsage(THREE.DynamicDrawUsage));
    const reflM = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ map: softTex(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    reflM.renderOrder = 2; reflM.frustumCulled = false; X.root.add(reflM);
    // hoa đăng trôi sông
    const nf = qn(X, 18, 8);
    const fg = new Batch(); fg.add(G().cylT, T(0, 0.06, 0, Math.PI, 0, 0, 0.34, 0.12, 0.34), 0xffffff); fg.add(G().sph, T(0, 0.14, 0, 0, 0, 0, 0.12, 0.14, 0.12), 0xfff2c0);
    const fmesh = new THREE.InstancedMesh(fg.build(null).geometry, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), nf);
    fmesh.frustumCulled = false; X.root.add(fmesh);
    const fl = [], fcols = [0xff5a6e, 0xffa040, 0xffd84a, 0xff7ac0, 0xffffff];
    for (let i = 0; i < nf; i++) { fl.push({ x: -40 + r() * 80, z: lerp(RZ1 + 1.2, RZ0 - 1.2, r()), sp: 0.25 + r() * 0.3, ph: r() * TAU, c: fcols[i % fcols.length] }); fmesh.setColorAt(i, lin(fl[i].c)); }
    fmesh.instanceColor.needsUpdate = true;
    const fglow = glowPoints(X, fl.map((o) => [o.x, WY + 0.25, o.z, 0xffc870]), 1.1, { opacity: 0.9 });
    const fgp = fglow.geometry.attributes.position;
    // thuyền gỗ neo bờ
    for (const [x, z, ry] of [[6, -16.2, 0.12], [15, -23.4, -0.2]]) {
      const P = placer(x, WY + 0.05, z, ry);
      P(s, G().sph, 0, 0, 0, 4.2, 0.9, 1.3, 0x4a2a18); P(s, G().box, 0, 0.32, 0, 3.4, 0.06, 1.0, 0x6a4026);
      const arc = new THREE.CylinderGeometry(0.62, 0.62, 1.5, 10, 1, true, -Math.PI / 2, Math.PI);
      P(s, arc, 0, 0.36, 0, 1, 1, 1, 0x8a6a3a, 0, 0, Math.PI / 2); arc.dispose();
      const p = P.pt(1.7, 0.9, 0); glowPoints(X, [[p.x, p.y, p.z, 0xff6a3a]], 1.2, { opacity: 0.8 });
    }
    // hoa giấy trước nhà
    for (const [x, z] of [[-10.2, -10.5], [10.2, -9], [-10.2, 9.5], [10.2, 10.5]]) {
      cyl(s, x, 0.25, z, 0.32, 0.5, 0x7a4a32, G().cylT, Math.PI);
      canopyTree(X, x, z, { h: 2.0, r: 0.9, tr: 0.06, blobs: 12, greens: [0xff4fa0, 0xff6fb5, 0xe83a8a, 0x4f8a3a], blobSize: 0.38 });
    }
    // trăng + sao
    gl.add(G().circle, T(-46, 24, -150, 0, 0.3, 0, 9, 9, 1), 0xfff4d0);
    glowPoints(X, [[-46, 24, -149, 0xffe8b0]], 40, { opacity: 0.45, noFog: true });
    const stars = []; for (let i = 0; i < 140; i++) { const a = -Math.PI * 0.05 - r() * Math.PI * 0.9, el = 0.06 + r() * 0.8, R = 170; stars.push([Math.cos(a) * Math.cos(el) * R, Math.sin(el) * R, Math.sin(a) * Math.cos(el) * R, r() < 0.25 ? 0xffe2b0 : 0xffffff]); }
    glowPoints(X, stars, 1.4, { opacity: 0.85, noFog: true });
    // khán giả: ghế gỗ thấp + người đứng ven sông
    const st = { riser: 0x5a3a26, seatA: 0xc0563b, seatB: 0xe8b23a, rowH: 0.34, rowD: 0.78, rail: false };
    stand(X, Object.assign({ x: 7.7, z: -0.5, len: 15, rows: 2, axis: 'z', out: 1 }, st));
    stand(X, Object.assign({ x: -7.7, z: -0.5, len: 15, rows: 2, axis: 'z', out: -1 }, st));
    stand(X, { x: 0, z: -11.4, len: 13, rows: 1, axis: 'x', out: -1, rowH: 0, rowD: 0.8, standing: true, spacing: 0.7 });
    courtsideKit(X, -1); umpireChair(X, C.NET_HALF + 0.9);
    // đèn rọi ấm chiếu sân (không đổ bóng) – sân sáng, phố quanh chìm trong đêm
    for (const zz of [-4.6, 4.6]) {
      const spot = new THREE.SpotLight(lin(0xfff0dc), 1.25, 30, 0.44, 0.6, 1.0);
      spot.position.set(0, 16, zz * 1.15); spot.target.position.set(0, 0, zz); X.scene.add(spot, spot.target);
    }
    // cập nhật: đèn lồng đung đưa, hoa đăng trôi, phản chiếu lung linh
    const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), ee = new THREE.Euler(), pp = new THREE.Vector3(), ss = new THREE.Vector3(), dn = new THREE.Vector3();
    X.updaters.push((dt, t) => {
      for (let i = 0; i < L.length; i++) {
        const p = L[i], a = Math.sin(t * 1.25 + lph[i]) * 0.09 + Math.sin(t * 0.47 + lph[i] * 2) * 0.05;
        ee.set(a * 0.5, 0, a); qq.setFromEuler(ee); ss.setScalar(lsc[i]); pp.set(p[0], p[1], p[2]);
        mm.compose(pp, qq, ss); lan.setMatrixAt(i, mm);
        dn.set(0, -0.22 * lsc[i], 0).applyQuaternion(qq);
        gpos.setXYZ(i, p[0] + dn.x, p[1] + dn.y, p[2] + dn.z);
      }
      lan.instanceMatrix.needsUpdate = true; gpos.needsUpdate = true;
      for (let i = 0; i < nf; i++) {
        const o = fl[i]; o.x += o.sp * dt; if (o.x > 45) o.x = -45;
        const y = WY + 0.02 + Math.sin(t * 1.6 + o.ph) * 0.02;
        ee.set(Math.sin(t * 1.3 + o.ph) * 0.06, o.ph, 0); qq.setFromEuler(ee); mm.compose(pp.set(o.x, y, o.z), qq, ss.setScalar(1)); fmesh.setMatrixAt(i, mm);
        fgp.setXYZ(i, o.x, y + 0.2, o.z);
      }
      fmesh.instanceMatrix.needsUpdate = true; fgp.needsUpdate = true;
      for (let i = 0; i < refl.length; i++) {
        const o = refl[i], k = 0.28 + 0.16 * Math.sin(t * 2.3 + o.ph) * Math.sin(t * 0.9 + o.ph * 3);
        for (let v = 0; v < 6; v++) { const j = (i * 6 + v) * 4; rC[j] = o.c.r; rC[j + 1] = o.c.g; rC[j + 2] = o.c.b; rC[j + 3] = k; }
      }
      rg.attributes.color.needsUpdate = true;
    });
  };

  /* ---------- Ruộng bậc thang ---------- */
  // đồi ruộng: các dải vòng đồng tâm gợn sóng, mỗi bậc = mặt ruộng (bờ sáng) + vách
  function terraceHill(X, o) {
    const r = rng(o.seed), N = o.levels, S = o.segs;
    const P = [], Nn = [], Cc = [];
    const ph = [r() * TAU, r() * TAU, r() * TAU];
    const ex = o.ex || 1, ez = o.ez || 1;
    // bậc không đều: bề rộng và chiều cao mỗi bậc ngẫu nhiên → bớt cảm giác "khán đài"
    const fr = [0], ys = [0];
    for (let k = 1; k <= N + 1; k++) { fr.push(fr[k - 1] + (o.rTop !== undefined ? 1 : 0.55 + r() * 0.9)); ys.push(ys[k - 1] + o.step * (o.rTop !== undefined ? 1 : 0.7 + r() * 0.6)); }
    const R = (k, th) => {
      const kk = Math.min(k, N), u = fr[kk] / fr[N];
      const base = o.rTop !== undefined ? lerp(o.r0, o.rTop, u) : o.r0 * Math.pow(Math.max(0, 1 - u * N / (N + 0.6)), o.pow || 0.9);
      const ell = 1 / Math.sqrt((Math.cos(th) / ex) ** 2 + (Math.sin(th) / ez) ** 2);
      return base * ell * (1 + o.wob * (0.55 * Math.sin(2 * th + ph[0] + k * 0.07) + 0.3 * Math.sin(5 * th + ph[1] - k * 0.13) + 0.15 * Math.sin(9 * th + ph[2] + k * 0.2)));
    };
    const Y = (k) => (o.y0 || 0) + ys[Math.min(k, N + 1)];
    const pal = o.palette, dyke = lin(0xb6dc72), riserA = lin(0x4a7430), riserB = lin(0x6e5e38), tmp = new THREE.Color();
    const quad = (a, b, c, d2, na, nb, nc, nd, col) => {
      P.push(...a, ...b, ...c, ...a, ...c, ...d2);
      Nn.push(...na, ...nb, ...nc, ...na, ...nc, ...nd);
      for (let i = 0; i < 6; i++) Cc.push(col.r, col.g, col.b);
    };
    const ptA = (rad, th, y) => [o.cx + Math.cos(th) * rad, y, o.cz + Math.sin(th) * rad];
    const UPN = [0, 1, 0];
    for (let k = -1; k < N; k++) {
      for (let j = 0; j < S; j++) {
        const t0 = (j / S) * TAU, t1 = ((j + 1) / S) * TAU;
        const sector = (j / 2) | 0;
        if (k >= 0) {
          const ro0 = R(k, t0), ro1 = R(k, t1), ri0 = R(k + 1, t0) + 0.35, ri1 = R(k + 1, t1) + 0.35, y = Y(k);
          const rd0 = ro0 - 0.4, rd1 = ro1 - 0.4;
          quad(ptA(ro0, t0, y), ptA(rd0, t0, y), ptA(rd1, t1, y), ptA(ro1, t1, y), UPN, UPN, UPN, UPN, dyke);
          const h = hashStr(o.seed + ':' + k + ':' + sector) % 1000 / 1000;
          tmp.copy(pal[Math.floor(h * pal.length)]);
          const sh = 0.94 + ((hashStr('s' + k + sector + o.seed) % 100) / 100) * 0.12; tmp.multiplyScalar(sh);
          quad(ptA(rd0, t0, y + 0.01), ptA(ri0, t0, y + 0.01), ptA(ri1, t1, y + 0.01), ptA(rd1, t1, y + 0.01), UPN, UPN, UPN, UPN, tmp);
        }
        // vách giữa bậc k và k+1 (k = -1: chân đồi xuống dưới mặt đất)
        const rb0 = k >= 0 ? R(k + 1, t0) + 0.35 : R(0, t0), rb1 = k >= 0 ? R(k + 1, t1) + 0.35 : R(0, t1);
        const rt0 = k >= 0 ? R(k + 1, t0) : R(0, t0) - 0.05, rt1 = k >= 0 ? R(k + 1, t1) : R(0, t1) - 0.05;
        const yb = k >= 0 ? Y(k) : Y(0) - 3, yt = k >= 0 ? Y(k + 1) : Y(0);
        const n0 = [Math.cos(t0), 0.35, Math.sin(t0)], n1 = [Math.cos(t1), 0.35, Math.sin(t1)];
        const col = ((hashStr('r' + k + ':' + sector + o.seed) % 9) === 0) ? riserB : riserA;
        quad(ptA(rb0, t0, yb), ptA(rt0, t0, yt), ptA(rt1, t1, yt), ptA(rb1, t1, yb), n0, n0, n1, n1, col);
      }
    }
    // đỉnh đồi: chỏm rừng
    const yTop = Y(N), cap = lin(o.cap || 0x4f7f38), capH = o.capH === undefined ? 2.5 : o.capH;
    for (let j = 0; j < S; j++) {
      const t0 = (j / S) * TAU, t1 = ((j + 1) / S) * TAU, ra = R(N, t0) + 0.35, rb = R(N, t1) + 0.35;
      P.push(o.cx, yTop + capH, o.cz, ...ptA(rb, t1, yTop), ...ptA(ra, t0, yTop));
      for (let i = 0; i < 3; i++) { Nn.push(0, 1, 0); Cc.push(cap.r, cap.g, cap.b); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
    for (let i = 0; i < Nn.length; i += 3) { const l = Math.hypot(Nn[i], Nn[i + 1], Nn[i + 2]); g.attributes.normal.array[i] /= l; g.attributes.normal.array[i + 1] /= l; g.attributes.normal.array[i + 2] /= l; }
    g.computeBoundingSphere();
    return g;
  }
  function stiltHouse(X, x, z, yaw) {
    const s = X.solid, P = placer(x, 0, z, yaw), BX = G().box, wood = 0x8a5a32, dark = 0x5a3a20;
    for (let i = -2; i <= 2; i++) for (const k of [-1, 1]) P(s, G().cyl6, i * 1.1, 0.85, k * 1.4, 0.18, 1.7, 0.18, dark);
    P(s, BX, 0, 1.75, 0, 5.2, 0.16, 3.4, wood);
    P(s, BX, 0, 2.6, 0, 4.6, 1.6, 2.8, 0xb0814e);
    for (let i = -2; i <= 2; i++) P(s, BX, i * 1.1, 2.6, 1.42, 0.08, 1.6, 0.06, dark);
    P(s, BX, -0.9, 2.65, 1.43, 0.7, 0.55, 0.04, 0x2a1a10); P(s, BX, 0.9, 2.65, 1.43, 0.7, 0.55, 0.04, 0x2a1a10);
    P(s, G().cone4, 0, 4.25, 0, 6.6, 2.4, 4.8, 0xc8a464, 0, Math.PI / 4);
    P(s, BX, 0, 5.35, 0, 1.6, 0.14, 0.14, 0x8a6a3a);
    for (let k = 0; k < 6; k++) P(s, BX, 2.9, 0.2 + k * 0.29, 1.0 - k * 0.1, 0.5, 0.05, 0.14, dark);
    P(s, BX, 3.0, 0.9, 1.0, 0.05, 1.9, 0.05, dark, 0.25);
  }
  function bambooClump(X, x, z, n) {
    const s = X.solid, r = X.r;
    for (let i = 0; i < n; i++) {
      const a = r() * TAU, rr = r() * 0.6, h = 4 + r() * 3, lean = (r() - 0.5) * 0.3, lz = (r() - 0.5) * 0.3;
      const bx = x + Math.cos(a) * rr, bz = z + Math.sin(a) * rr;
      s.add(G().cyl6, T(bx + Math.sin(lean) * h / 2, h / 2, bz + Math.sin(lz) * h / 2, lz, 0, -lean, 0.09, h, 0.09), jit(0x7aa040, r, 0.08));
      for (let k = 0; k < 4; k++) sph(s, bx + Math.sin(lean) * h * (0.7 + k * 0.1) + (r() - 0.5), h * (0.72 + k * 0.08), bz + Math.sin(lz) * h * (0.7 + k * 0.1) + (r() - 0.5), 0.6, 0.3, 0.6, jit(0x6faa3a, r, 0.08), G().ico0);
    }
  }
  VENUE_BUILD.terrace = function (X) {
    const r = X.r, s = X.solid, d = X.deco;
    const VY = -13.2;
    const gc = grassCanvas(r);
    const top = new THREE.Mesh(new THREE.CircleGeometry(18.2, 48), M(0xd8e8b0, { map: tex(gc, { repeat: [9, 9] }), roughness: 0.95 }));
    top.rotation.x = -Math.PI / 2; top.position.y = 0.003; top.receiveShadow = true; X.root.add(top);
    addGround(X, gc, 5, 700, 0x9cbf74, 0.95, VY);
    const pal = [0x86cc3c, 0x9ad448, 0xeec23a, 0xf2b232, 0xd8cc40, 0x8ccff0, 0x6fbc3a, 0xe8c84a, 0xb6d444].map(lin);
    const segs = qn(X, 110, 56), lvMul = X.q === 'low' ? 0.7 : 1;
    const hills = [
      { cx: 0, cz: -1, r0: 60, rTop: 19.6, ex: 1.12, ez: 1, levels: 11, step: 1.2, y0: VY, wob: 0.06, seed: 7, capH: 0, cap: 0x7fb84a },
      { cx: -52, cz: -142, r0: 84, ex: 1.15, ez: 0.9, levels: 34, step: 1.3, y0: VY, wob: 0.14, seed: 11 },
      { cx: 82, cz: -128, r0: 72, ex: 1.05, ez: 0.9, levels: 30, step: 1.3, y0: VY, wob: 0.14, seed: 17 },
      { cx: -128, cz: -40, r0: 58, ex: 0.9, ez: 1.3, levels: 28, step: 1.2, y0: VY, wob: 0.12, seed: 23 },
      { cx: 132, cz: -36, r0: 58, ex: 0.92, ez: 1.3, levels: 28, step: 1.2, y0: VY, wob: 0.12, seed: 37 },
      { cx: -100, cz: 86, r0: 52, ex: 1, ez: 1, levels: 22, step: 1.2, y0: VY, wob: 0.12, seed: 41 },
      { cx: 104, cz: 90, r0: 50, ex: 1, ez: 1, levels: 22, step: 1.2, y0: VY, wob: 0.12, seed: 53 },
    ];
    const hb = new THREE.BufferGeometry();
    const parts = hills.map((h, i) => terraceHill(X, Object.assign({ segs: h.cz > 20 ? Math.round(segs * 0.6) : segs, palette: pal, pow: 0.85 }, h, i === 0 ? {} : { levels: Math.round(h.levels * lvMul), step: h.step / lvMul })));
    const tot = parts.reduce((a, g) => a + g.attributes.position.count, 0);
    for (const k of ['position', 'normal', 'color']) {
      const arr = new Float32Array(tot * 3); let off = 0;
      for (const g of parts) { arr.set(g.attributes[k].array, off); off += g.attributes[k].array.length; }
      hb.setAttribute(k, new THREE.BufferAttribute(arr, 3));
    }
    parts.forEach((g) => g.dispose()); hb.computeBoundingSphere();
    const hm = new THREE.Mesh(hb, M(0xffffff, { vertexColors: true, roughness: 0.82 })); hm.receiveShadow = true; X.root.add(hm);
    // núi xa trong sương
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI * 0.08 - (i / 13) * Math.PI * 0.84 + (r() - 0.5) * 0.1, R = 165 + r() * 30, h = 55 + r() * 45;
      d.add(G().cone, T(Math.cos(a) * R * 1.1, h / 2 - 14, Math.sin(a) * R, 0, r() * TAU, 0, 60 + r() * 50, h, 50 + r() * 40), jit(0x6f9a86, r, 0.05));
    }
    // nhà sàn, tre, cây rải trên ruộng
    stiltHouse(X, -13.6, -6.5, Math.PI / 2 + 0.25);
    bambooClump(X, -12.2, -12.6, 7); bambooClump(X, 12.8, -11.5, 6); bambooClump(X, 13.2, 6.5, 5); bambooClump(X, -12.8, 7.5, 5);
    { // vài lùm cây dưới thung lũng
      const tb = new Batch();
      for (let i = 0; i < qn(X, 30, 14); i++) {
        const a = -Math.PI * 0.12 - r() * Math.PI * 0.76, rad = 64 + r() * 12;
        canopyTree(X, Math.cos(a) * rad * 1.1, Math.sin(a) * rad, { batch: tb, h: 4 + r() * 2.5, r: 2 + r(), tr: 0.18, blobs: 5, greens: [0x4f8a38, 0x5f9a3e, 0x3f7a30], blobSize: 0.6 });
      }
      const tm = tb.build(M(0xffffff, { vertexColors: true, roughness: 0.85 }), false); tm.position.y = VY; tm.updateMatrix(); X.root.add(tm);
    }
    // trâu nhỏ cạnh nhà sàn
    { const P = placer(-12.4, 0, -1.8, 0.6), bf = 0x4a4a52; P(s, G().sph, 0, 0.75, 0, 1.5, 0.75, 0.8, bf); P(s, G().sph, 0.85, 0.85, 0, 0.5, 0.45, 0.42, bf);
      for (const lx of [-0.5, 0.45]) for (const lz of [-0.22, 0.22]) P(s, G().cyl6, lx, 0.3, lz, 0.14, 0.6, 0.14, bf);
      P(s, G().box, 0.95, 1.08, 0, 0.08, 0.06, 0.9, 0xe8e0d0, 0, 0, 0.3); }
    // mây thấp trôi qua thung lũng
    const nc = qn(X, 16, 8), ct = tex(cloudCanvas(r));
    const cm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 0.5), new THREE.MeshBasicMaterial({ map: ct, transparent: true, depthWrite: false, opacity: 0.85, color: lin(0xffffff) }), nc);
    cm.frustumCulled = false; cm.renderOrder = 1; X.root.add(cm);
    const cl = []; for (let i = 0; i < nc; i++) cl.push({ x: -130 + r() * 260, y: -9 + r() * 22, z: -62 - r() * 90, w: 45 + r() * 50, sp: 0.6 + r() * 0.9 });
    const cmat = new THREE.Matrix4(), cq = new THREE.Quaternion(), cp = new THREE.Vector3(), cs = new THREE.Vector3();
    X.updaters.push((dt, t) => {
      const g = gustOf(t);
      for (let i = 0; i < nc; i++) { const o = cl[i]; o.x += o.sp * g * dt; if (o.x > 140) o.x = -140; cmat.compose(cp.set(o.x, o.y, o.z), cq, cs.set(o.w, o.w, 1)); cm.setMatrixAt(i, cmat); }
      cm.instanceMatrix.needsUpdate = true;
    });
    flock(X, { n: qn(X, 9, 5), color: 0x2a2e38, cx: 0, cz: -30, spread: [30, 20], rad: [6, 14], h: [9, 16], speed: 0.35, size: 0.7, flap: 9 });
    featherFlags(X, [[-8.6, -11.4, 0xe0384e, 0], [8.6, -11.4, 0xffd23f, 1.3], [-12.0, 2.4, 0x3a46a0, 2.1], [12.0, -3.0, 0x2fae7a, 0.7]], gustOf);
    const st = { riser: 0xa08a52, seatA: 0xc8a050, seatB: 0xb08a40, rowH: 0.36, rowD: 0.78, rail: 0x8a7040 };
    stand(X, Object.assign({ x: 7.7, z: -0.5, len: 14, rows: 2, axis: 'z', out: 1 }, st));
    stand(X, Object.assign({ x: -7.7, z: 1.5, len: 10, rows: 2, axis: 'z', out: -1 }, st));
    stand(X, { x: 0, z: -11.5, len: 12, rows: 2, axis: 'x', out: -1, rowH: 0, rowD: 0.8, standing: true, spacing: 0.7 });
    courtsideKit(X, 1); umpireChair(X, -C.NET_HALF - 0.9);
  };

  /* ---------- Vịnh Hạ Long ---------- */
  function karstGeo(r, h, rad) {
    const prof = [[0.8, -0.1], [0.84, 0.0], [0.97, 0.06], [1.0, 0.16], [0.95, 0.3], [0.99, 0.44], [0.97, 0.58], [0.9, 0.7], [0.8, 0.8], [0.64, 0.89], [0.44, 0.95], [0.22, 0.99], [0, 1.0]];
    const g = new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(p[0], p[1])), 20);
    const p = g.attributes.position, ph = [r() * TAU, r() * TAU, r() * TAU], lean = (r() - 0.5) * 0.25;
    const col = new Float32Array(p.count * 3), tmp = new THREE.Color();
    const rock = lin(0x9aa69c), rockD = lin(0x6c7a72), green = lin(0x4f7d45), greenD = lin(0x3a6236), wl = lin(0x3c4844);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
      const n = 1 + 0.13 * Math.sin(3 * a + ph[0] + y * 2.5) + 0.07 * Math.sin(6 * a + ph[1] - y * 4) + 0.035 * Math.sin(11 * a + ph[2] + y * 7);
      p.setXYZ(i, x * n * rad + lean * y * rad, y * h, z * n * rad);
      const veg = 0.5 + 0.5 * Math.sin(5 * a + ph[1] * 2 + y * 9) * Math.sin(3 * a - ph[2] + y * 5);
      if (y < 0.04) tmp.copy(wl);
      else if (y > 0.82 || veg > 0.62 - y * 0.35) tmp.copy(green).lerp(greenD, 0.5 + 0.5 * Math.sin(a * 7 + y * 13));
      else tmp.copy(rock).lerp(rockD, 0.5 + 0.5 * Math.sin(a * 9 + y * 21 + ph[0]));
      col.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }
  function junkBoat(X, sails) {
    const b = new Batch(), r = X.r, hull = 0x5a3420;
    b.add(G().sph, T(0, 0, 0, 0, 0, 0, 6.2, 1.6, 1.9), hull);
    b.add(G().box, T(0, 0.55, 0, 0, 0, 0, 5.0, 0.1, 1.5), 0x8a5a34);
    b.add(G().box, T(-1.9, 0.95, 0, 0, 0, 0, 1.6, 0.8, 1.4), 0x6a3a22);
    b.add(G().box, T(-2.6, 1.0, 0, 0, 0, 0.25, 0.8, 0.9, 1.5), hull);
    b.add(G().box, T(2.7, 0.75, 0, 0, 0, -0.35, 1.0, 0.5, 1.0), hull);
    b.add(G().box, T(0.4, 0.85, 0, 0, 0, 0, 2.2, 0.5, 1.3), 0x7a4a2a);
    const mast = (mx, mh, sw) => {
      b.add(G().cyl6, T(mx, 0.6 + mh / 2, 0, 0, 0, 0, 0.1, mh, 0.1), 0x3a2414);
      // buồm cánh dơi: các dải xòe hình quạt
      const sh = new THREE.Shape(); const bot = 1.2, top = mh - 0.2, hw = sw / 2;
      sh.moveTo(-hw * 0.7, bot); sh.lineTo(hw * 0.9, bot);
      sh.quadraticCurveTo(hw * 1.15, (bot + top) / 2, hw * 0.75, top);
      sh.quadraticCurveTo(0, top + 0.6, -hw * 0.9, top - 0.3);
      sh.quadraticCurveTo(-hw * 1.05, (bot + top) / 2, -hw * 0.7, bot);
      const sg = new THREE.ShapeGeometry(sh, 6);
      b.add(sg, T(mx, 0.6, 0.06, 0, 0, 0), jit(r() < 0.5 ? 0xc0482a : 0xd2683a, r, 0.05)); sg.dispose();
      for (let k = 1; k <= 4; k++) { const y = 0.6 + bot + (k / 5) * (top - bot); b.add(G().box, T(mx + 0.05 * k, y + k * 0.06, 0.09, 0, 0, 0.05 * (k - 2.5), sw * 0.95, 0.035, 0.03), 0x6a3420); }
    };
    sails.forEach((sv) => mast(sv[0], sv[1], sv[2]));
    const m = b.build(M(0xffffff, { vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }), false);
    m.matrixAutoUpdate = true;
    return m;
  }
  VENUE_BUILD.halong = function (X) {
    const r = X.r, s = X.solid, d = X.deco;
    const WY = -0.55, DX = 10.6, DZ0 = -14.6, DZ1 = 12.8;
    // sàn gỗ nổi
    const deck = addGround(X, woodTexture(r), 3.0, [2 * DX, DZ1 - DZ0], 0xe8c8a0, 0.6, -0.008);
    deck.position.z = (DZ0 + DZ1) / 2; deck.material.envMapIntensity = 0.7; deck.userData.keepEnv = true;
    const dzc = (DZ0 + DZ1) / 2, dl = DZ1 - DZ0;
    box(d, 0, -0.3, DZ0 - 0.1, 2 * DX + 0.4, 0.5, 0.2, 0x6a4428); box(d, 0, -0.3, DZ1 + 0.1, 2 * DX + 0.4, 0.5, 0.2, 0x6a4428);
    box(d, -DX - 0.1, -0.3, dzc, 0.2, 0.5, dl, 0x6a4428); box(d, DX + 0.1, -0.3, dzc, 0.2, 0.5, dl, 0x6a4428);
    // phao + lan can dây
    for (let x = -DX + 1; x <= DX - 1; x += 2.2) for (const z of [DZ0 - 0.45, DZ1 + 0.45]) cyl(d, x, WY + 0.05, z, 0.42, 1.6, (Math.round(x) & 1) ? 0x2f7fd0 : 0xf2f2f2, null, 0, 0, Math.PI / 2);
    for (let z = DZ0 + 1; z <= DZ1 - 1; z += 2.2) for (const x of [-DX - 0.45, DX + 0.45]) cyl(d, x, WY + 0.05, z, 0.42, 1.6, (Math.round(z) & 1) ? 0x2f7fd0 : 0xf2f2f2, null, Math.PI / 2);
    const rail = (x0, z0, x1, z1) => {
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 2.2));
      for (let i = 0; i <= n; i++) { const x = lerp(x0, x1, i / n), z = lerp(z0, z1, i / n); box(s, x, 0.45, z, 0.14, 0.9, 0.14, 0x7a4a2a); }
      const len = Math.hypot(x1 - x0, z1 - z0), ry = -Math.atan2(z1 - z0, x1 - x0);
      box(s, (x0 + x1) / 2, 0.85, (z0 + z1) / 2, len, 0.05, 0.05, 0xe8d8b8, ry); box(s, (x0 + x1) / 2, 0.55, (z0 + z1) / 2, len, 0.04, 0.04, 0xe8d8b8, ry);
    };
    rail(-DX + 0.15, DZ0 + 0.15, DX - 0.15, DZ0 + 0.15); rail(-DX + 0.15, DZ0 + 0.15, -DX + 0.15, DZ1 - 0.15); rail(DX - 0.15, DZ0 + 0.15, DX - 0.15, DZ1 - 0.15);
    for (const [x, z, ry] of [[-DX + 0.05, -3, Math.PI / 2], [DX - 0.05, 4, -Math.PI / 2], [4.5, DZ0 + 0.05, 0]]) {
      const tor = new THREE.TorusGeometry(0.32, 0.09, 6, 16);
      s.add(tor, T(x, 0.62, z, 0, ry, 0), 0xff6a3a); tor.dispose();
    }
    // nước vịnh xanh ngọc
    const nearC = lin(0x1fa58f), farC = lin(0x2a8f98), deepC = lin(0x137a72);
    waterSurface(X, { w: 420, d: 420, seg: [qn(X, 150, 80), qn(X, 150, 80)], y: WY, rough: 0.16, env: 0.75,
      colors: (x, z, out) => { const dd = Math.hypot(x, z * 1.1); const k = clamp((dd - 14) / 90, 0, 1); out.copy(nearC).lerp(deepC, Math.min(1, dd / 30) * 0.4).lerp(farC, k); },
      waves: [[1, 0.25, 0.35, 1.0, 0.09], [-0.3, 1, 0.55, 1.4, 0.05], [0.7, -0.7, 1.2, 2.1, 0.022], [-1, -0.2, 2.1, 2.9, 0.01]] });
    // bọt quanh sàn
    const fb = new Batch();
    for (const [x, z, w, dd] of [[0, DZ0 - 1.0, 2 * DX + 2.6, 0.9], [0, DZ1 + 1.0, 2 * DX + 2.6, 0.9], [-DX - 1.0, dzc, 0.9, dl + 1.2], [DX + 1.0, dzc, 0.9, dl + 1.2]]) fb.add(G().plane, T(x, WY + 0.12, z, -Math.PI / 2, 0, 0, w, dd, 1), 0xffffff);
    const foam = fb.build(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.4, depthWrite: false, map: tex(gradientCanvas([[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']], 64)) }), false);
    foam.receiveShadow = false; X.root.add(foam);
    X.updaters.push((dt, t) => { foam.material.opacity = 0.28 + 0.16 * Math.sin(t * 1.1); });
    // đảo đá vôi trong sương
    const kb = new Batch();
    const isl = [[-44, -62, 30, 8], [-70, -92, 44, 11], [-22, -118, 38, 10], [18, -78, 26, 7], [44, -124, 52, 13], [70, -70, 36, 9], [104, -112, 46, 12], [-108, -56, 40, 10], [-128, -128, 54, 14],
      [4, -170, 60, 16], [-72, -168, 52, 14], [86, -176, 60, 15], [-150, -76, 46, 12], [150, -54, 42, 11], [124, 4, 34, 9], [-132, 10, 32, 9], [56, -48, 18, 5], [-36, -44, 15, 4.5],
      [-90, 70, 38, 11], [100, 74, 34, 10], [0, 130, 44, 13]];
    for (const [x, z, h, rad] of isl) { const g = karstGeo(r, h * (0.9 + r() * 0.2), rad); addVC(kb, g, T(x, WY - 0.6, z, 0, r() * TAU, 0)); g.dispose(); if (r() < 0.5 && h > 25) { const g2 = karstGeo(r, h * 0.6, rad * 0.6); addVC(kb, g2, T(x + rad * 0.9, WY - 0.6, z + rad * 0.4, 0, r() * TAU, 0)); g2.dispose(); } }
    X.root.add(kb.build(M(0xffffff, { vertexColors: true, roughness: 0.9 }), false));
    // làng chài nổi xa xa
    const hcol = [0x3f8fd0, 0xf2c14e, 0xe06a5a, 0x6ac48a, 0xffffff];
    for (let i = 0; i < 7; i++) {
      const x = -48 + i * 5.2 + r() * 1.5, z = -52 - r() * 5;
      box(d, x, WY + 0.15, z, 4.2, 0.3, 3.4, 0x6a4a30);
      box(d, x, WY + 1.2, z, 3.0, 1.8, 2.5, hcol[i % hcol.length]);
      d.add(prismGeo(), T(x, WY + 2.1, z, 0, 0, 0, 3.5, 1.0, 3.1), 0x8a4a3a);
    }
    // thuyền buồm
    const boats = [];
    const defs = [{ x: -26, z: -40, ry: 0.15, sp: 0.6, sc: 0.75 }, { x: 30, z: -56, ry: -0.2, sp: 0.45, sc: 0.9 }, { x: -6, z: -84, ry: 0.05, sp: 0.35, sc: 1.05 }];
    for (const df of defs.slice(0, qn(X, 3, 2))) {
      const m = junkBoat(X, [[-1.4, 5.2, 2.6], [0.6, 6.4, 3.2], [2.2, 4.2, 2.0]]);
      m.scale.setScalar(df.sc); m.position.set(df.x, WY, df.z); m.rotation.y = df.ry; X.root.add(m); boats.push(Object.assign({ m, ph: r() * TAU }, df));
    }
    // thúng chai quanh sàn
    for (const [x, z] of [[-14.5, -6], [14.8, 2], [-13.8, 8], [9, -19]]) {
      s.add(G().sph, T(x, WY + 0.1, z, 0, 0, 0, 1.6, 0.8, 1.6), 0x8a6a3a); s.add(G().cyl, T(x, WY + 0.42, z, 0, 0, 0, 1.62, 0.06, 1.62), 0x5a3a20);
    }
    X.updaters.push((dt, t) => {
      for (const b of boats) {
        b.x += b.sp * dt; if (b.x > 70) b.x = -70;
        b.m.position.set(b.x, WY - 0.15 + Math.sin(t * 0.9 + b.ph) * 0.12, b.z);
        b.m.rotation.set(Math.sin(t * 0.7 + b.ph) * 0.03, b.ry, Math.sin(t * 0.9 + b.ph) * 0.04);
      }
    });
    flock(X, { n: qn(X, 8, 4), color: 0xffffff, wing: 0xe9edf3, cx: 0, cz: -26, spread: [34, 16], rad: [5, 12], h: [7, 12], speed: 0.3 });
    const st = { riser: 0x8a6440, seatA: 0x2f9fb0, seatB: 0xf2efe6, rowH: 0.4, rowD: 0.78, rail: 0xf2efe6 };
    stand(X, Object.assign({ x: 7.6, z: -0.5, len: 15, rows: 3, axis: 'z', out: 1 }, st));
    stand(X, Object.assign({ x: -7.6, z: -0.5, len: 15, rows: 3, axis: 'z', out: -1 }, st));
    stand(X, Object.assign({ x: 0, z: -11.5, len: 12, rows: 2, axis: 'x', out: -1 }, st));
    courtsideKit(X, -1); umpireChair(X, C.NET_HALF + 0.9);
  };

  /* ---------- Đỉnh tuyết ---------- */
  function snowCanvas(r) {
    const S = 512, c = makeCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#f2f6fb'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) { const x = r() * S, y = r() * S, rr = 30 + r() * 80; const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, 'rgba(170,195,225,0.16)'); gr.addColorStop(1, 'rgba(170,195,225,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
    for (let i = 0; i < 1500; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.9)' : 'rgba(190,210,235,0.35)'; g.fillRect(r() * S, r() * S, 1.5, 1.5); }
    noiseFill(g, S, S, 6, r);
    return c;
  }
  function pine(b, r, x, z, h, snowy) {
    b.add(G().cyl6, T(x, h * 0.1, z, 0, 0, 0, h * 0.06, h * 0.2, h * 0.06), 0x5a3a24);
    const tiers = 4;
    for (let k = 0; k < tiers; k++) {
      const t = k / tiers, y = h * (0.14 + t * 0.6), rad = h * (0.34 - t * 0.07), th = h * (0.38 - t * 0.04), ry = r() * TAU;
      b.add(cone8(), T(x, y + th / 2, z, 0, ry, 0, rad * 2, th, rad * 2), jit(0x2c5a44, r, 0.05));
      if (snowy) b.add(cone8(), T(x, y + th * 0.79 + 0.02, z, 0, ry, 0, rad * 0.98, th * 0.44, rad * 0.98), 0xf2f7fc);
    }
  }
  function peakGeo(r, snowLine) {
    const g = new THREE.ConeGeometry(0.5, 1, 11, 6);
    const p = g.attributes.position, ph = r() * TAU;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), k = 1 + 0.18 * Math.sin(3 * a + ph) + 0.1 * Math.sin(7 * a - ph * 2 + y * 4);
      if (y < 0.49) p.setXYZ(i, x * k, y, z * k);
    }
    g.computeVertexNormals();
    const ng = g.toNonIndexed(); g.dispose();
    const pn = ng.attributes.position, nn = ng.attributes.normal, col = new Float32Array(pn.count * 3), rock = lin(0x5a6880), rockD = lin(0x46526a), snow = lin(0xf2f6fb), snowS = lin(0xd6e2f0);
    for (let i = 0; i < pn.count; i += 3) {
      const y = (pn.getY(i) + pn.getY(i + 1) + pn.getY(i + 2)) / 3 + 0.5, ny = (nn.getY(i) + nn.getY(i + 1) + nn.getY(i + 2)) / 3;
      const v = r(), c = (y > snowLine - v * 0.25 || (ny > 0.55 && v < 0.6)) ? (v < 0.7 ? snow : snowS) : (v < 0.5 ? rock : rockD);
      for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
    }
    ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return ng;
  }
  function logCabin(X, x, z, yaw, w, dep, h) {
    const s = X.solid, P = placer(x, 0, z, yaw), BX = G().box;
    for (let y = 0.16, i = 0; y < h; y += 0.3, i++) {
      const c = i % 2 ? 0x7a4a2a : 0x6a3e22;
      P(s, G().cyl, 0, y, dep / 2, 0.32, w + 0.3, 0.32, c, 0, 0, Math.PI / 2); P(s, G().cyl, 0, y, -dep / 2, 0.32, w + 0.3, 0.32, c, 0, 0, Math.PI / 2);
      P(s, G().cyl, w / 2, y + 0.15, 0, 0.32, dep + 0.3, 0.32, c, Math.PI / 2); P(s, G().cyl, -w / 2, y + 0.15, 0, 0.32, dep + 0.3, 0.32, c, Math.PI / 2);
    }
    P(s, BX, 0, h / 2, 0, w - 0.1, h, dep - 0.1, 0x5a3420);
    P(s, prismGeo(), 0, h, 0, w + 1.0, 1.7, dep + 1.0, 0x4a2e1e);
    P(s, prismGeo(), 0, h + 0.14, 0, w + 1.1, 1.72, dep + 1.06, 0xf4f8fc);
    for (const wx of [-w * 0.28, w * 0.28]) {
      P(X.glow, BX, wx, h * 0.55, dep / 2 + 0.18, 0.9, 0.8, 0.04, 0xffb24e);
      P(s, BX, wx, h * 0.55, dep / 2 + 0.21, 0.07, 0.8, 0.05, 0x3a2414); P(s, BX, wx, h * 0.55, dep / 2 + 0.21, 0.9, 0.07, 0.05, 0x3a2414);
      P(s, BX, wx, h * 0.55 - 0.47, dep / 2 + 0.26, 1.1, 0.1, 0.18, 0xf4f8fc);
    }
    P(s, BX, 0, 0.95, dep / 2 + 0.17, 0.8, 1.7, 0.06, 0x8a4a2a);
    P(s, BX, w / 2 - 0.6, h + 1.4, -dep * 0.2, 0.6, 2.4, 0.6, 0x7a7a82); P(s, BX, w / 2 - 0.6, h + 2.62, -dep * 0.2, 0.7, 0.12, 0.7, 0xf4f8fc);
    return P.pt(w / 2 - 0.6, h + 2.7, -dep * 0.2);
  }
  function snowman(X, x, z, ry) {
    const s = X.solid, P = placer(x, 0, z, ry);
    P(s, G().sph, 0, 0.42, 0, 0.9, 0.84, 0.9, 0xf6f9fc); P(s, G().sph, 0, 1.05, 0, 0.64, 0.6, 0.64, 0xf6f9fc); P(s, G().sph, 0, 1.53, 0, 0.44, 0.42, 0.44, 0xf6f9fc);
    P(s, G().cone, 0, 1.53, 0.3, 0.08, 0.26, 0.08, 0xff8a2a, Math.PI / 2);
    for (const sx of [-1, 1]) { P(s, G().sph, sx * 0.09, 1.6, 0.19, 0.05, 0.05, 0.05, 0x1a1a22); P(s, G().cyl6, sx * 0.48, 1.12, 0, 0.04, 0.6, 0.04, 0x5a3a24, 0, 0, sx * 1.0); }
    P(s, G().cyl, 0, 1.3, 0, 0.5, 0.1, 0.5, 0xe0384e); P(s, G().cyl, 0, 1.78, 0, 0.36, 0.22, 0.36, 0x3d6bd0); P(s, G().sph, 0, 1.92, 0, 0.12, 0.12, 0.12, 0xffffff);
  }
  VENUE_BUILD.snow = function (X) {
    const r = X.r, s = X.solid, d = X.deco;
    addGround(X, snowCanvas(r), 6, 360, 0xeaf0f8, 0.9);
    // ụ tuyết quanh sân
    const SX = C.W + 3.0, SZ = C.L + 4.0;
    const bank = (x0, z0, x1, z1) => {
      const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.9);
      for (let i = 0; i <= n; i++) { const t = i / n, x = lerp(x0, x1, t), z = lerp(z0, z1, t), sc = 0.8 + r() * 0.6; sph(s, x + (r() - 0.5) * 0.3, 0.05, z + (r() - 0.5) * 0.3, 0.75 * sc, 0.42 * sc, 0.75 * sc, jit(0xf2f6fb, r, 0.03), G().ico); }
    };
    bank(-SX - 0.9, -SZ - 0.9, SX + 0.9, -SZ - 0.9); bank(-SX - 0.9, SZ + 0.9, -SX - 0.9, -SZ - 0.9); bank(SX + 0.9, SZ + 0.9, SX + 0.9, -SZ - 0.9);
    // núi tuyết xa
    const pb = new Batch();
    for (let i = 0; i < 13; i++) {
      const a = -Math.PI * 0.05 - (i / 12) * Math.PI * 0.9 + (r() - 0.5) * 0.08, R = 150 + r() * 40, h = 60 + r() * 55, w = 70 + r() * 50;
      const g = peakGeo(r, 0.5 + r() * 0.15); addVC(pb, g, T(Math.cos(a) * R, h / 2 - 6, Math.sin(a) * R, 0, r() * TAU, 0, w, h, w * 0.8)); g.dispose();
    }
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI * 0.1 - (i / 8) * Math.PI * 0.8, R = 85 + r() * 20, h = 26 + r() * 18, w = 50 + r() * 30;
      const g = peakGeo(r, 0.35); addVC(pb, g, T(Math.cos(a) * R, h / 2 - 4, Math.sin(a) * R, 0, r() * TAU, 0, w, h, w * 0.8)); g.dispose();
    }
    X.root.add(pb.build(M(0xffffff, { vertexColors: true, roughness: 0.9 }), false));
    // rừng thông
    const nf = qn(X, 150, 70);
    for (let i = 0; i < nf; i++) {
      let x, z; do { x = (r() - 0.5) * 130; z = -12 - r() * 75 + (r() < 0.35 ? 40 : 0); } while ((Math.abs(x) < 11 && z > -20) || (Math.abs(x) < 6 + (-z - 14) * 0.45 && z < -14 && z > -70));
      pine(d, r, x, z, 3.5 + r() * 4.5, r() < 0.85);
    }
    for (const [x, z, h] of [[-10.5, -14.5, 6.5], [-12.5, -12, 5.2], [11.2, -14, 6.8], [13, -9.5, 5.6], [12.2, 9.5, 6], [-11.8, 10.5, 5.8], [-15.5, -2, 6.4], [15.5, 3, 7], [8, -17, 5.8], [-7.5, -18.5, 6.6]]) pine(s, r, x, z, h, true);
    // cabin + khói
    const chim = logCabin(X, -13.2, -5.5, Math.PI / 2 + 0.2, 5.0, 4.0, 2.6);
    logCabin(X, 16, -19, -0.5, 4.2, 3.6, 2.4);
    const ns = 26, sg = new THREE.BufferGeometry(), sP = new Float32Array(ns * 3), sd = [];
    for (let i = 0; i < ns; i++) sd.push({ t: (i / ns) * 4, ph: r() * TAU });
    sg.setAttribute('position', new THREE.BufferAttribute(sP, 3).setUsage(THREE.DynamicDrawUsage));
    const smoke = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.4, map: softTex(), color: lin(0xd8dee6), transparent: true, opacity: 0.45, depthWrite: false }));
    smoke.frustumCulled = false; X.root.add(smoke);
    X.updaters.push((dt, t) => {
      for (let i = 0; i < ns; i++) { const o = sd[i]; o.t = (o.t + dt) % 4; const k = o.t / 4; sP.set([chim.x + Math.sin(o.t * 1.3 + o.ph) * 0.3 * k + k * 2.2 * gustOf(t), chim.y + o.t * 0.9, chim.z + Math.cos(o.t + o.ph) * 0.3 * k], i * 3); }
      sg.attributes.position.needsUpdate = true;
    });
    // đèn đường ấm
    const lamps = [];
    for (const [x, z] of [[-9.6, -12.4], [9.6, -12.4], [-9.6, 11], [9.6, 11]]) { cyl(s, x, 1.8, z, 0.06, 3.6, 0x2a2e3a); box(s, x, 3.7, z, 0.36, 0.42, 0.36, 0x2a2e3a); X.glow.add(G().box, T(x, 3.62, z, 0, 0, 0, 0.28, 0.3, 0.38), 0xffc268); lamps.push([x, 3.62, z, 0xffb050]); }
    glowPoints(X, lamps.concat([[chim.x, 1.6, chim.z, 0xffa040]]), 2.2, { opacity: 0.7 });
    snowman(X, -8.4, 9.6, 0.5); snowman(X, 9.2, -12.9, -0.3);
    // cáp treo
    const A = new THREE.Vector3(22, 0, -30), B = new THREE.Vector3(58, 40, -128), off = new THREE.Vector3(1.4, 0, 0);
    for (let i = 0; i <= 5; i++) { const p = A.clone().lerp(B, i / 5); box(d, p.x + 0.7, p.y + 3.5, p.z, 0.35, 7, 0.35, 0x4a5262); box(d, p.x + 0.7, p.y + 7, p.z, 2.4, 0.2, 0.3, 0x4a5262); }
    const cab = [A.x - 0.0, A.y + 6.9, A.z, B.x, B.y + 6.9, B.z, A.x + 1.4, A.y + 6.9, A.z, B.x + 1.4, B.y + 6.9, B.z];
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cab, 3));
    X.root.add(new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: lin(0x2a2e3a) })));
    const nch = qn(X, 14, 8), chB = new Batch();
    chB.add(G().cyl6, T(0, -0.6, 0, 0, 0, 0, 0.04, 1.2, 0.04), 0x2a2e3a); chB.add(G().box, T(0, -1.25, 0, 0, 0, 0, 1.0, 0.12, 0.5), 0xe0384e); chB.add(G().box, T(0, -1.0, -0.22, 0, 0, 0, 1.0, 0.45, 0.08), 0xe0384e);
    const chairs = new THREE.InstancedMesh(chB.build(null).geometry, M(0xffffff, { vertexColors: true, roughness: 0.6 }), nch);
    chairs.frustumCulled = false; X.root.add(chairs);
    const cm4 = new THREE.Matrix4(), cp = new THREE.Vector3(), cq = new THREE.Quaternion(), c1 = new THREE.Vector3(1, 1, 1);
    X.updaters.push((dt, t) => {
      for (let i = 0; i < nch; i++) {
        const up = i % 2 === 0, k = ((t * 0.012 + i / nch) % 1), kk = up ? k : 1 - k;
        cp.copy(A).lerp(B, kk); cp.y += 6.9; if (!up) cp.add(off);
        cm4.compose(cp, cq, c1); chairs.setMatrixAt(i, cm4);
      }
      chairs.instanceMatrix.needsUpdate = true;
    });
    const st = { riser: 0x6a4a34, seatA: 0x3d6bd0, seatB: 0xe0384e, rowH: 0.4, rowD: 0.78, rail: 0xdfe6ee };
    stand(X, Object.assign({ x: 8.0, z: -0.5, len: 14, rows: 3, axis: 'z', out: 1 }, st));
    stand(X, Object.assign({ x: -8.0, z: 2.0, len: 10, rows: 3, axis: 'z', out: -1 }, st));
    stand(X, { x: 0, z: -12.6, len: 11, rows: 2, axis: 'x', out: -1, rowH: 0, rowD: 0.8, standing: true, spacing: 0.7 });
    courtsideKit(X, 1); umpireChair(X, -C.NET_HALF - 0.9);
  };

  /* ---------- Trạm vũ trụ ---------- */
  function spaceSkyCanvas(r) {
    const W = 2048, H = 1024, c = makeCanvas(W, H), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#04051a'); gr.addColorStop(0.42, '#0d0f30'); gr.addColorStop(0.5, '#1c1748'); gr.addColorStop(0.58, '#0d0f30'); gr.addColorStop(1, '#03040f');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const neb = [['255,80,190', 0.08], ['90,140,255', 0.09], ['120,255,230', 0.05], ['190,110,255', 0.08]];
    for (let i = 0; i < 70; i++) {
      const x = r() * W, y = H * (0.3 + r() * 0.32) + Math.sin(x / W * TAU * 2) * 60, rr = 60 + r() * 220, n = neb[(r() * neb.length) | 0];
      const gg = g.createRadialGradient(x, y, 0, x, y, rr); gg.addColorStop(0, 'rgba(' + n[0] + ',' + n[1] + ')'); gg.addColorStop(1, 'rgba(' + n[0] + ',0)');
      g.fillStyle = gg; for (const o of [-W, 0, W]) g.fillRect(x - rr + o, y - rr, rr * 2, rr * 2);
    }
    for (let i = 0; i < 3800; i++) {
      const x = r() * W, y = r() * H, b = r(), s = b > 0.985 ? 2.2 : b > 0.9 ? 1.4 : 0.8;
      g.fillStyle = 'rgba(' + (b > 0.7 ? '255,255,255' : r() < 0.5 ? '190,210,255' : '255,225,200') + ',' + (0.35 + b * 0.65).toFixed(2) + ')';
      g.fillRect(x, y, s, s);
    }
    return c;
  }
  function planetCanvas(r) {
    const W = 512, H = 256, c = makeCanvas(W, H), g = c.getContext('2d');
    const bands = ['#f6c89a', '#eaa27a', '#f8dcb4', '#d98a6e', '#f4b892', '#fbe3c6', '#e39a82', '#f0c09c'];
    let y = 0; while (y < H) { const h = 8 + r() * 26; g.fillStyle = bands[(r() * bands.length) | 0]; g.fillRect(0, y, W, h + 1); y += h; }
    for (let i = 0; i < 40; i++) { g.strokeStyle = 'rgba(255,255,255,' + (0.05 + r() * 0.1).toFixed(2) + ')'; g.lineWidth = 1 + r() * 3; g.beginPath(); const yy = r() * H; for (let x = 0; x <= W; x += 16) g.lineTo(x, yy + Math.sin(x * 0.03 + i) * 3); g.stroke(); }
    g.fillStyle = 'rgba(200,90,80,0.55)'; g.beginPath(); g.ellipse(W * 0.62, H * 0.6, 26, 12, 0, 0, TAU); g.fill();
    return c;
  }
  function ringCanvas(r) {
    const W = 256, c = makeCanvas(W, 8), g = c.getContext('2d');
    for (let x = 0; x < W; x++) { const t = x / W; const a = (0.25 + 0.6 * Math.abs(Math.sin(t * 23 + Math.sin(t * 7) * 2))) * Math.sin(Math.PI * t) * (t > 0.55 && t < 0.6 ? 0.15 : 1); g.fillStyle = 'rgba(' + (230 - t * 40 | 0) + ',' + (210 - t * 30 | 0) + ',' + (255) + ',' + a.toFixed(3) + ')'; g.fillRect(x, 0, 1, 8); }
    return c;
  }
  VENUE_BUILD.space = function (X) {
    const r = X.r, s = X.solid, d = X.deco, gl = X.glow;
    const DR = 24;
    const floorT = tex(tileCanvas(r, '#30344f', '#1a1c2e', 4), { repeat: [DR * 2 / 2.4, DR * 2 / 2.4] });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(DR, 72), M(0xffffff, { map: floorT, roughness: 0.45, metalness: 0.2 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.01; floor.receiveShadow = true; floor.material.envMapIntensity = 0.9; floor.userData.keepEnv = true; X.root.add(floor);
    const rimG = new THREE.CylinderGeometry(DR + 0.2, DR - 2, 3, 72, 1, true);
    d.add(rimG, T(0, -1.52, 0), 0x2a2d48); rimG.dispose();
    // vòm kính + khung
    const domeR = DR - 0.2;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(domeR, 48, 20, 0, TAU, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: lin(0x6fb0ff), transparent: true, opacity: 0.045, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    dome.renderOrder = 1; X.root.add(dome);
    const nm = X.q === 'low' ? 10 : 16;
    for (let k = 0; k < nm; k++) { const tg = new THREE.TorusGeometry(domeR, 0.1, 5, 48, Math.PI); d.add(tg, T(0, 0, 0, 0, (k / nm) * Math.PI, 0), 0x9aa4c8); tg.dispose(); }
    for (const phi of [0.33, 0.68, 1.05]) { const tg = new THREE.TorusGeometry(domeR * Math.cos(phi), 0.08, 5, 72); d.add(tg, T(0, domeR * Math.sin(phi), 0, Math.PI / 2, 0, 0), 0x9aa4c8); tg.dispose(); }
    { const tg = new THREE.TorusGeometry(domeR - 0.05, 0.12, 5, 96); gl.add(tg, T(0, 0.12, 0, Math.PI / 2, 0, 0), 0x3fe8ff); gl.add(tg, T(0, 1.4, 0, Math.PI / 2, 0, 0, 1, 1, 0.6), 0xff4fd8); tg.dispose(); }
    { const tg = new THREE.TorusGeometry(15.5, 0.05, 4, 96); gl.add(tg, T(0, 0.012, 0, Math.PI / 2, 0, 0), 0x6a5cff); tg.dispose(); }
    // viền neon quanh vùng sân
    const SX = C.W + 3.0, SZ = C.L + 4.0;
    for (const sd of [-1, 1]) { gl.add(G().box, T(sd * (SX + 0.25), 0.03, 0, 0, 0, 0, 0.07, 0.04, 2 * SZ + 0.5), 0x3fe8ff); gl.add(G().box, T(0, 0.03, sd * (SZ + 0.25), 0, 0, 0, 2 * SX + 0.57, 0.04, 0.07), 0x3fe8ff); }
    // cánh trạm + tấm pin mặt trời bên ngoài vòm
    const panelT = new Batch();
    for (const sd of [-1, 1]) {
      box(d, sd * 46, -1.2, -24, 44, 0.5, 0.5, 0x6a7090, sd * 0.55);
      for (let i = 0; i < 4; i++) {
        const t = (i + 0.7) / 4.6;
        const px = sd * (DR + 4 + t * 38) , pz = -10 - t * 24;
        panelT.add(G().box, T(px, -1.0, pz, 0, -sd * 0.55, 0, 7, 0.12, 4.2), 0x2a4a9a);
        gl.add(G().box, T(px, -0.92, pz, 0, -sd * 0.55, 0, 7.05, 0.02, 0.06), 0x3fe8ff);
      }
    }
    const pm = panelT.build(M(0xffffff, { vertexColors: true, roughness: 0.25, metalness: 0.6, emissive: 0x0a1a40 }), false); X.root.add(pm);
    // hành tinh có vành + mặt trăng
    const pt = tex(planetCanvas(r));
    const planet = new THREE.Mesh(new THREE.SphereGeometry(30, 48, 32), M(0xffffff, { map: pt, roughness: 1, emissive: 0x3a2030, fog: false }));
    planet.material.fog = false; planet.position.set(-46, 2, -178); planet.rotation.set(0.3, 0, 0.35); X.root.add(planet);
    const ringG = new THREE.RingGeometry(40, 72, 96, 1);
    { const p = ringG.attributes.position, uv = ringG.attributes.uv; for (let i = 0; i < p.count; i++) { const l = Math.hypot(p.getX(i), p.getY(i)); uv.setXY(i, (l - 40) / 32, 0.5); } }
    const ring = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ map: tex(ringCanvas(r)), transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false, toneMapped: false, opacity: 0.85 }));
    ring.position.copy(planet.position); ring.rotation.set(-Math.PI / 2 + 0.32, 0.18, 0.35); X.root.add(ring);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(7, 32, 20), M(0xc8c4e0, { roughness: 1, emissive: 0x2a2840, fog: false }));
    moon.position.set(64, 20, -160); X.root.add(moon);
    // sao lấp lánh
    const stars = []; for (let i = 0; i < 220; i++) { const a = r() * TAU, el = -0.25 + r() * 1.1, R = 175; stars.push([Math.cos(a) * Math.cos(el) * R, Math.sin(el) * R, Math.sin(a) * Math.cos(el) * R, r() < 0.3 ? 0xbcd2ff : r() < 0.15 ? 0xffd2e8 : 0xffffff]); }
    const sp = glowPoints(X, stars, 1.5, { opacity: 0.95, noFog: true });
    const scol = sp.geometry.attributes.color, sbase = Float32Array.from(scol.array), sph2 = stars.map(() => r() * TAU);
    // sao băng
    const shc = makeCanvas(128, 8), shg = shc.getContext('2d'), sgr = shg.createLinearGradient(0, 0, 128, 0);
    sgr.addColorStop(0, 'rgba(255,255,255,0)'); sgr.addColorStop(0.85, 'rgba(200,230,255,0.8)'); sgr.addColorStop(1, 'rgba(255,255,255,1)');
    shg.fillStyle = sgr; shg.fillRect(0, 2, 128, 4);
    const shT = tex(shc), shooters = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(16, 0.35), new THREE.MeshBasicMaterial({ map: shT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));
      m.visible = false; m.frustumCulled = false; X.root.add(m); shooters.push({ m, t: -1 - i * 1.7, dir: new THREE.Vector3(), life: 1.1 });
    }
    // khán giả bay lơ lửng
    for (let row = 0; row < 3; row++) {
      const R = 12.6 + row * 1.5, y = 0.75 + row * 0.95, n = Math.floor((Math.PI * 0.72 * R) / 0.66);
      for (let i = 0; i < n; i++) { const a = -Math.PI * 0.14 - (i + 0.5) / n * Math.PI * 0.72, x = Math.cos(a) * R, z = Math.sin(a) * R - 1.2; X.seats.push({ x, y: y + (r() - 0.5) * 0.3, z, yaw: Math.atan2(-x, z * 0.45 - z), u: (Math.atan2(z, x) / TAU + 1) % 1, standing: false, bob: 0.1 + r() * 0.12 }); }
      for (const sd of [-1, 1]) { const xx = sd * (8.6 + row * 1.4), m = 22; for (let i = 0; i < m; i++) { const z = -2.5 + (i - m / 2) * 0.66 * (1 + row * 0.08) + 4; if (z > 9) continue; X.seats.push({ x: xx, y: y - 0.2 + (r() - 0.5) * 0.3, z, yaw: Math.atan2(-xx, z * 0.45 - z), u: (Math.atan2(z, xx) / TAU + 1) % 1, standing: false, bob: 0.1 + r() * 0.12 }); } }
    }
    // bảng hologram
    const hc = textBannerCanvas([{ text: 'PICKLE POP', bg: 'rgba(40,20,90,0.2)', fg: '#7ef0ff' }, { text: 'TRẠM SAO MAI', bg: 'rgba(90,20,90,0.2)', fg: '#ff9af0' }], 1024, 96);
    const holo = new THREE.Mesh(new THREE.PlaneGeometry(11, 1.05), new THREE.MeshBasicMaterial({ map: tex(hc), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }));
    holo.position.set(0, 5.2, -17.5); X.root.add(holo);
    gl.add(G().box, T(0, 4.55, -17.5, 0, 0, 0, 11.4, 0.05, 0.05), 0x3fe8ff); gl.add(G().box, T(0, 5.85, -17.5, 0, 0, 0, 11.4, 0.05, 0.05), 0xff4fd8);
    // máy chiếu, bàn điều khiển, chậu cây trong vỏ kính
    for (const sd of [-1, 1]) for (const z of [-7, 7]) {
      box(s, sd * 15.2, 0.5, z, 1.2, 1.0, 2.4, 0x3a3f60); box(s, sd * 15.0, 1.1, z, 1.0, 0.1, 2.2, 0x2a2d48, 0, 0, sd * 0.3);
      gl.add(G().box, T(sd * 14.98, 1.17, z, 0, 0, sd * 0.3, 0.8, 0.02, 1.9), sd > 0 ? 0x3fe8ff : 0xff6fd8);
    }
    for (const [x, z] of [[-11.5, -12.5], [11.5, -12.5], [-17, 1], [17, 1]]) {
      cyl(s, x, 0.25, z, 0.7, 0.5, 0xdfe4f2); gl.add(G().cyl, T(x, 0.52, z, 0, 0, 0, 1.36, 0.04, 1.36), 0x3fe8ff);
      canopyTree(X, x, z, { h: 2.4, r: 1.0, tr: 0.07, blobs: 12, greens: [0x5fd08a, 0x3fb87a, 0x7ee0a1, 0xb28dff], blobSize: 0.42 });
    }
    // đèn trần (trong vòm) dạng điểm sáng
    const lights = []; for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU, R = domeR * Math.cos(0.68); lights.push([Math.cos(a) * R, domeR * Math.sin(0.68) - 0.3, Math.sin(a) * R, k % 2 ? 0x9ef0ff : 0xffb0f0]); }
    glowPoints(X, lights, 1.6, { opacity: 0.8, noFog: true });
    courtsideKit(X, -1); umpireChair(X, C.NET_HALF + 0.9);
    X.updaters.push((dt, t) => {
      holo.position.y = 5.2 + Math.sin(t * 1.2) * 0.12; holo.material.opacity = 0.85 + 0.15 * Math.sin(t * 7.0) * Math.sin(t * 2.3);
      ring.rotation.z = 0.35 + t * 0.002; planet.rotation.y = t * 0.01;
      if ((X.frame & 1) === 0) { for (let i = 0; i < stars.length; i += 3) { const k = 0.55 + 0.45 * Math.sin(t * 2.2 + sph2[i]); scol.array[i * 3] = sbase[i * 3] * k; scol.array[i * 3 + 1] = sbase[i * 3 + 1] * k; scol.array[i * 3 + 2] = sbase[i * 3 + 2] * k; } scol.needsUpdate = true; }
      for (const o of shooters) {
        o.t += dt;
        if (o.t > o.life) { o.t = -(1.2 + Math.random() * 3); o.m.visible = false; }
        if (o.t >= 0 && !o.m.visible) {
          const sx = (Math.random() - 0.5) * 220, sz = -150 - Math.random() * 20, sy = 8 + Math.random() * 30, dx = Math.random() < 0.5 ? -1 : 1;
          o.m.position.set(sx, sy, sz); o.dir.set(dx, -0.35 - Math.random() * 0.3, 0).normalize(); o.m.rotation.set(0, 0, Math.atan2(o.dir.y, o.dir.x)); o.m.visible = true;
        }
        if (o.m.visible) { o.m.position.addScaledVector(o.dir, dt * 85); o.m.material.opacity = Math.sin(Math.PI * clamp(o.t / o.life, 0, 1)); }
      }
    });
  };

  /* ================= buildScene ================= */
  function buildScene(renderer, venueId, quality) {
    quality = qOf(quality || renderer.__ppQuality);
    const qc = QUALITY[quality];
    const id = LOOKS[venueId] ? venueId : 'gym';
    ANISO = Math.max(1, Math.min(qc.aniso, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 4));
    const look = LOOKS[id];
    const scene = new THREE.Scene();
    scene.name = 'pp-venue-' + id;
    const root = new THREE.Group(); root.name = 'venue'; scene.add(root);
    const env = envFor(renderer);
    if (env) scene.environment = env;
    const X = { id, look, scene, root, q: quality, qc, r: rng(hashStr(id)), solid: new Batch(), deco: new Batch(), glow: new Batch(), seats: [], updaters: [], frame: 0 };
    scene.fog = new THREE.Fog(lin(look.fog[0]), look.fog[1], look.fog[2]);
    addSky(X);
    addLights(X);
    buildCourt(X);
    const net = buildNet(X);
    VENUE_BUILD[id](X);
    const solid = X.solid.build(M(0xffffff, { vertexColors: true, roughness: 0.72 }), true);
    const deco = X.deco.build(M(0xffffff, { vertexColors: true, roughness: 0.82 }), false);
    const glow = X.glow.build(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), false);
    if (solid) root.add(solid);
    if (deco) { deco.receiveShadow = true; root.add(deco); }
    if (glow) { glow.receiveShadow = false; root.add(glow); }
    const crowd = buildCrowd(X);
    const ambient = buildAmbient(X);
    if (!env) X.hemi.intensity *= 1.6;
    scene.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.isMeshStandardMaterial && !o.userData.keepEnv) m.envMapIntensity = look.env;
      }
    });
    renderer.toneMappingExposure = look.exposure || 0.95;
    let time0 = null;
    const world = {
      scene, venueId: id, look, sun: X.sun, hemi: X.hemi, _renderer: renderer, surface: SURFACE[id],
      crowd: {
        cheer: (lv) => { if (crowd) crowd.cheer(lv); },
        wave: () => { if (crowd) crowd.wave(); },
      },
      net: { shake: (x, s) => net.shake(x, s) },
      focus: (p) => { if (X.focus) X.focus(p); },
      update(dt, time) {
        dt = clamp(+dt || 0, 0, 0.1);
        if (time === undefined) { time0 = (time0 || 0) + dt; time = time0; }
        X.frame++;
        net.update(dt, time);
        if (crowd) crowd.update(dt, time);
        if (ambient) ambient.update(dt, time);
        for (const u of X.updaters) u(dt, time);
      },
      _applyQuality(q) {
        const c = QUALITY[qOf(q)];
        X.sun.castShadow = c.shadow > 0;
        if (c.shadow > 0 && X.sun.shadow.mapSize.x !== c.shadow) {
          X.sun.shadow.mapSize.set(c.shadow, c.shadow);
          if (X.sun.shadow.map) { X.sun.shadow.map.dispose(); X.sun.shadow.map = null; }
        }
        if (crowd) crowd.setCount(c.crowd);
        if (ambient) ambient.setCount(c.ambient);
        scene.traverse((o) => { if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true; });
      },
      dispose() {
        WORLDS.delete(world);
        if (X.sun && X.sun.shadow && X.sun.shadow.map) { X.sun.shadow.map.dispose(); X.sun.shadow.map = null; }
        scene.environment = null;
        PP.disposeScene(scene);
      },
    };
    world._applyQuality(quality);
    WORLDS.add(world);
    world.update(0, 0);
    return world;
  }

  /* ================= Bóng ================= */
  function ballTextures() {
    const W = 512, H = 256;
    const a = makeCanvas(W, H), b = makeCanvas(W, H), g = a.getContext('2d'), h = b.getContext('2d');
    g.fillStyle = '#d9f23a'; g.fillRect(0, 0, W, H);
    h.fillStyle = '#ffffff'; h.fillRect(0, 0, W, H);
    // vệt đường may nhẹ
    g.strokeStyle = 'rgba(160,190,20,0.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    const N = 38;
    for (let i = 0; i < N; i++) {
      const y = 1 - ((i + 0.5) / N) * 2, lat = Math.asin(y), lon = (i * 2.399963) % TAU;
      const px = (lon / TAU) * W, py = (0.5 - lat / Math.PI) * H;
      const ry = (0.15 / Math.PI) * H, rx = Math.min(ry / Math.max(0.2, Math.cos(lat)), W * 0.2);
      for (const off of [-W, 0, W]) {
        g.fillStyle = '#9fb51c'; g.beginPath(); g.ellipse(px + off, py, rx * 1.12, ry * 1.12, 0, 0, TAU); g.fill();
        g.fillStyle = '#4d5a0c'; g.beginPath(); g.ellipse(px + off, py, rx, ry, 0, 0, TAU); g.fill();
        g.fillStyle = 'rgba(30,36,6,0.6)'; g.beginPath(); g.ellipse(px + off, py + ry * 0.15, rx * 0.7, ry * 0.7, 0, 0, TAU); g.fill();
        h.fillStyle = '#7a7a7a'; h.beginPath(); h.ellipse(px + off, py, rx * 1.12, ry * 1.12, 0, 0, TAU); h.fill();
        h.fillStyle = '#000000'; h.beginPath(); h.ellipse(px + off, py, rx, ry, 0, 0, TAU); h.fill();
      }
    }
    return { map: tex(a, { aniso: 4 }), bump: tex(b, { linear: true, aniso: 4 }) };
  }
  function trailEdgeTexture() {
    // lõi sáng + viền tối mảnh (tăng tương phản trên mọi màu sân) + mép mềm
    const c = makeCanvas(4, 64), g = c.getContext('2d'), img = g.createImageData(4, 64);
    for (let y = 0; y < 64; y++) {
      const d = Math.abs(y + 0.5 - 32) / 32; // 0 tâm .. 1 mép
      let rgb, a;
      if (d < 0.55) { rgb = 255; a = 1; }
      else if (d < 0.68) { const k = (d - 0.55) / 0.13; rgb = 255 * (1 - k); a = 1 - 0.45 * k; }
      else { const k = (d - 0.68) / 0.32; rgb = 0; a = 0.55 * (1 - k) * (1 - k); }
      for (let x = 0; x < 4; x++) { const i = (y * 4 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = rgb; img.data[i + 3] = Math.round(a * 255); }
    }
    g.putImageData(img, 0, 0);
    return tex(c, { linear: true, aniso: 1 });
  }
  const TRAIL_N = 24;
  class Ball {
    constructor(scene) {
      this.root = new THREE.Group(); this.root.name = 'ppBall';
      const t = ballTextures();
      this.mesh = new THREE.Mesh(new THREE.SphereGeometry(C.R, 32, 20), new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 1.4, roughness: 0.4, metalness: 0, emissive: lin(0xffffff), emissiveMap: t.map, emissiveIntensity: 0.38 }));
      this.mesh.castShadow = true; this.mesh.name = 'ball';
      this.root.add(this.mesh);
      this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: softTex(), color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
      this.blob.rotation.x = -Math.PI / 2; this.blob.renderOrder = 2;
      this.root.add(this.blob);
      const N = TRAIL_N;
      const g = new THREE.BufferGeometry();
      this._tp = new Float32Array(N * 2 * 3); this._tc = new Float32Array(N * 2 * 4);
      const uv = new Float32Array(N * 2 * 2), idx = [];
      for (let i = 0; i < N; i++) { uv.set([i / (N - 1), 0, i / (N - 1), 1], i * 4); if (i < N - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
      g.setAttribute('position', new THREE.BufferAttribute(this._tp, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(this._tc, 4).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx);
      this.trail = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: trailEdgeTexture(), vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }));
      this.trail.frustumCulled = false; this.trail.renderOrder = 5; this.trail.visible = false;
      this.root.add(this.trail);
      this._pool = []; for (let i = 0; i <= N; i++) this._pool.push(new THREE.Vector3());
      this._pts = [];
      this._color = lin(0xffffff); this._width = 1; this._fade = 0; this._fadeTarget = 1;
      this._lastVy = 0; this._axis = new THREE.Vector3(1, 0, 0); this._state = 'hidden';
      this.mesh.visible = this.blob.visible = false;
      if (scene) scene.add(this.root);
    }
    setTrailColor(hex, width) {
      this._color.copy(lin(hex === undefined || hex === null ? 0xffffff : hex));
      this._width = width || 1; this._fadeTarget = 1;
    }
    clearTrail() { this._pts.length = 0; this._fade = 0; this.trail.visible = false; }
    update(dt, pos, vel, state, camera, spin) {
      dt = dt || 0; state = state || (vel ? 'flight' : 'rest');
      const hidden = state === 'hidden' || !pos;
      this.mesh.visible = !hidden; this.blob.visible = !hidden;
      if (!hidden) {
        this.mesh.position.set(pos.x, pos.y, pos.z);
        const y = Math.max(0, pos.y - C.R);
        const s = 0.2 + y * 0.07;
        this.blob.position.set(pos.x, 0.012, pos.z); this.blob.scale.set(s, s, s);
        this.blob.material.opacity = 0.55 * clamp(1 - y / 4.5, 0.18, 1);
        if (vel) {
          const sp = Math.hypot(vel.x, vel.z);
          if (sp > 0.05) this._axis.set(vel.z, 0, -vel.x).normalize();
          let w = typeof spin === 'number' ? spin : Math.hypot(vel.x, vel.y, vel.z) / C.R * 0.04;
          w = clamp(w, -32, 32);
          if (Math.abs(w) < 4 && state === 'flight') w = (w < 0 ? -1 : 1) * 4;
          this.mesh.rotateOnWorldAxis(this._axis, w * dt);
        }
      }
      // vệt bay
      const flying = state === 'flight' && !hidden;
      if (flying) {
        if (vel && this._lastVy < -0.5 && vel.y > 0.2 && pos.y < 0.4) this._fadeTarget = 0.3;
        this._lastVy = vel ? vel.y : 0;
        const pts = this._pts;
        if (pts.length < 2) {
          if (!pts.length) pts.push(this._take().set(pos.x, pos.y, pos.z));
          pts.unshift(this._take().set(pos.x, pos.y, pos.z));
        } else {
          pts[0].set(pos.x, pos.y, pos.z);
          if (pts[0].distanceToSquared(pts[1]) > 0.0016) {
            pts.unshift(this._take().set(pos.x, pos.y, pos.z));
            if (pts.length > TRAIL_N) this._give(pts.pop());
          }
        }
        this._fade += (this._fadeTarget - this._fade) * (1 - Math.exp(-dt * (this._fadeTarget > this._fade ? 20 : 5)));
      } else {
        this._fade -= dt * 4; this._lastVy = 0;
        if (this._fade <= 0) { this._fade = 0; if (this._pts.length) { for (const p of this._pts) this._give(p); this._pts.length = 0; } }
      }
      this._buildTrail(camera);
      this._state = state;
    }
    _take() { return this._pool.pop() || new THREE.Vector3(); }
    _give(v) { this._pool.push(v); }
    _buildTrail(camera) {
      const pts = this._pts, n = pts.length;
      if (n < 2 || this._fade <= 0.002) { this.trail.visible = false; return; }
      this.trail.visible = true;
      const P = this._tp, Cc = this._tc, col = this._color, N = TRAIL_N;
      const tang = _v, side = _v2, view = _v3;
      for (let i = 0; i < N; i++) {
        const k = Math.min(i, n - 1), p = pts[k];
        const h = n > 1 ? Math.min(1, i / (n - 1)) : 1;
        const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
        tang.subVectors(a, b); if (tang.lengthSq() < 1e-10) tang.set(1, 0, 0);
        if (camera) view.subVectors(camera.position, p); else view.set(0, 1, 0);
        side.crossVectors(tang, view); if (side.lengthSq() < 1e-10) side.set(1, 0, 0);
        const w = (0.008 + 0.068 * (1 - h)) * this._width;
        side.normalize().multiplyScalar(w);
        P[i * 6] = p.x + side.x; P[i * 6 + 1] = p.y + side.y; P[i * 6 + 2] = p.z + side.z;
        P[i * 6 + 3] = p.x - side.x; P[i * 6 + 4] = p.y - side.y; P[i * 6 + 5] = p.z - side.z;
        const al = i >= n ? 0 : 0.85 * Math.pow(1 - h, 1.6) * this._fade;
        Cc[i * 8] = Cc[i * 8 + 4] = col.r; Cc[i * 8 + 1] = Cc[i * 8 + 5] = col.g; Cc[i * 8 + 2] = Cc[i * 8 + 6] = col.b;
        Cc[i * 8 + 3] = Cc[i * 8 + 7] = al;
      }
      this.trail.geometry.attributes.position.needsUpdate = true;
      this.trail.geometry.attributes.color.needsUpdate = true;
    }
    dispose() { this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map && !(o.material.map.userData && o.material.map.userData.shared)) o.material.map.dispose(); if (o.material.bumpMap) o.material.bumpMap.dispose(); o.material.dispose(); } }); if (this.root.parent) this.root.parent.remove(this.root); }
  }

  /* ================= Vòng canh thời điểm ================= */
  function fxMat(hex, o) { const m = new THREE.MeshBasicMaterial(Object.assign({ transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }, o || {})); m.color.copy(lin(hex)); return m; }
  function flatRing(ri, ro, mat, seg) { const m = new THREE.Mesh(new THREE.RingGeometry(ri, ro, seg || 64), mat); m.rotation.x = -Math.PI / 2; m.renderOrder = 6; return m; }
  class TimingRing {
    constructor(scene) {
      this.root = new THREE.Group(); this.root.name = 'ppTimingRing';
      this.shadow = flatRing(0.43, 0.57, fxMat(0x000000, { opacity: 0.22 }));
      this.target = flatRing(0.465, 0.53, fxMat(0xffffff, { opacity: 0.9 }));
      this.gold = flatRing(0.455, 0.5, fxMat(0xffc93c, { opacity: 0.95 }));
      this.fill = new THREE.Mesh(new THREE.CircleGeometry(0.46, 48), fxMat(0xfff3b0, { opacity: 0 })); this.fill.rotation.x = -Math.PI / 2; this.fill.renderOrder = 5;
      this.flashRing = flatRing(0.42, 0.5, fxMat(0xffe27a, { opacity: 0, blending: THREE.AdditiveBlending }));
      this.root.add(this.shadow, this.fill, this.target, this.gold, this.flashRing);
      this.root.position.y = 0.02; this.root.visible = false;
      this._a = 0; this._flash = 0; this._p = 1;
      if (scene) scene.add(this.root);
    }
    update(x, z, progress, dt) {
      dt = dt || 0.016;
      const on = progress !== null && progress !== undefined && isFinite(progress);
      this._a = clamp(this._a + (on ? dt * 10 : -dt * 6), 0, 1);
      if (this._flash > 0) this._flash = Math.max(0, this._flash - dt);
      this.root.visible = this._a > 0.001 || this._flash > 0;
      if (!this.root.visible) return;
      if (x !== undefined && x !== null && isFinite(x)) this.root.position.set(x, 0.02, z);
      if (on) this._p = clamp(progress, 0, 1);
      const p = this._p, s = 1 + 1.6 * p, a = this._a;
      this.gold.scale.set(s, s, 1);
      const near = 1 - clamp(p / 0.18, 0, 1);
      this.gold.material.opacity = 0.95 * a * (0.55 + 0.45 * (1 - p));
      this.target.material.opacity = 0.9 * a;
      this.target.material.color.copy(lin(0xffffff)).lerp(lin(0xffe27a), near * 0.8);
      this.shadow.material.opacity = 0.22 * a;
      const f = this._flash / 0.35;
      this.fill.material.opacity = 0.18 * near * a + 0.55 * f;
      const fs = 1 + (1 - f) * 0.9; this.flashRing.scale.set(fs, fs, 1); this.flashRing.material.opacity = f;
    }
    flash() { this._flash = 0.35; this.root.visible = true; }
    dispose() { disposeObj(this.root); }
  }

  class LandingMarker {
    constructor(scene) {
      this.root = new THREE.Group(); this.root.name = 'ppLanding';
      this.shadow = flatRing(0.15, 0.27, fxMat(0x000000, { opacity: 0.2 }), 40);
      this.ring = flatRing(0.18, 0.225, fxMat(0xffffff, { opacity: 0.95 }), 40);
      this.dot = new THREE.Mesh(new THREE.CircleGeometry(0.075, 28), fxMat(0xff4f7a, { opacity: 0.95 })); this.dot.rotation.x = -Math.PI / 2; this.dot.renderOrder = 7;
      this.root.add(this.shadow, this.ring, this.dot);
      this.root.position.y = 0.018; this.root.visible = false; this._a = 0; this._last = 0;
      if (scene) scene.add(this.root);
    }
    setColor(hex) { this.dot.material.color.copy(lin(hex)); }
    update(pos, time) {
      const dt = this._last ? clamp((time || 0) - this._last, 0, 0.1) : 0.016; this._last = time || 0;
      this._a = clamp(this._a + (pos ? dt * 8 : -dt * 6), 0, 1);
      this.root.visible = this._a > 0.001;
      if (!this.root.visible) return;
      if (pos) this.root.position.set(pos.x, 0.018, pos.z);
      const t = time || 0, s = 1 + 0.14 * Math.sin(t * 9);
      this.ring.scale.set(s, s, 1);
      const ds = 1 - 0.18 * Math.sin(t * 9 + 1);
      this.dot.scale.set(ds, ds, 1);
      this.ring.material.opacity = 0.95 * this._a; this.dot.material.opacity = 0.95 * this._a; this.shadow.material.opacity = 0.2 * this._a;
    }
    dispose() { disposeObj(this.root); }
  }

  class BoxHint {
    constructor(scene) {
      this.root = new THREE.Group(); this.root.name = 'ppBoxHint';
      this.fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fxMat(0xfff3a0, { opacity: 0 })); this.fill.rotation.x = -Math.PI / 2; this.fill.renderOrder = 4;
      this.edgeGeo = new THREE.BufferGeometry(); this.edgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 6 * 3), 3));
      this.edge = new THREE.Mesh(this.edgeGeo, fxMat(0xfff6c0, { opacity: 0 })); this.edge.renderOrder = 4; this.edge.frustumCulled = false;
      this.root.add(this.fill, this.edge); this.root.position.y = 0.012; this.root.visible = false;
      this._a = 0; this._key = ''; this._last = 0;
      if (scene) scene.add(this.root);
    }
    update(rect, time) {
      const dt = this._last ? clamp((time || 0) - this._last, 0, 0.1) : 0.016; this._last = time || 0;
      this._a = clamp(this._a + (rect ? dt * 5 : -dt * 5), 0, 1);
      this.root.visible = this._a > 0.001;
      if (!this.root.visible) return;
      if (rect) {
        const x0 = Math.min(rect.x0, rect.x1), x1 = Math.max(rect.x0, rect.x1), z0 = Math.min(rect.z0, rect.z1), z1 = Math.max(rect.z0, rect.z1);
        const key = [x0, x1, z0, z1].map((v) => v.toFixed(3)).join();
        if (key !== this._key) {
          this._key = key;
          this.fill.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2); this.fill.scale.set(x1 - x0, z1 - z0, 1);
          const w = 0.06, a = this.edgeGeo.attributes.position.array; let k = 0;
          const q = (ax, az, bx, bz) => { const v = [ax, 0.002, az, bx, 0.002, az, bx, 0.002, bz, ax, 0.002, az, bx, 0.002, bz, ax, 0.002, bz]; a.set(v, k); k += 18; };
          q(x0, z0, x1, z0 + w); q(x0, z1 - w, x1, z1); q(x0, z0, x0 + w, z1); q(x1 - w, z0, x1, z1);
          this.edgeGeo.attributes.position.needsUpdate = true;
        }
      }
      const pulse = 0.5 + 0.5 * Math.sin((time || 0) * 4.5);
      this.fill.material.opacity = (0.14 + 0.12 * pulse) * this._a;
      this.edge.material.opacity = (0.55 + 0.35 * pulse) * this._a;
    }
    dispose() { disposeObj(this.root); }
  }

  /* ================= Vòng tóe (pool) ================= */
  function ringGlowTexture() {
    const S = 128, c = makeCanvas(S, S), g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.05)'); gr.addColorStop(0.78, 'rgba(255,255,255,1)');
    gr.addColorStop(0.86, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    return tex(c, { aniso: 1 });
  }
  class Bursts {
    constructor(scene) {
      this.root = new THREE.Group(); this.root.name = 'ppBursts';
      const t = ringGlowTexture(), geo = new THREE.PlaneGeometry(2, 2);
      this.pool = [];
      for (let i = 0; i < 20; i++) {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
        const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: softTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
        m.visible = core.visible = false; m.renderOrder = core.renderOrder = 8;
        this.root.add(m, core);
        this.pool.push({ m, core, t: 0, life: 0.35, scale: 1, on: false });
      }
      this._next = 0;
      if (scene) scene.add(this.root);
    }
    spawn(x, y, z, colorHex, scale, life) {
      const b = this.pool[this._next]; this._next = (this._next + 1) % this.pool.length;
      b.on = true; b.t = 0; b.life = life || 0.35; b.scale = scale === undefined ? 1 : scale;
      b.m.position.set(x, y, z); b.core.position.set(x, y, z);
      const c = lin(colorHex === undefined ? 0xffffff : colorHex);
      b.m.material.color.copy(c); b.core.material.color.copy(c).lerp(lin(0xffffff), 0.5);
      b.m.visible = b.core.visible = true;
      return b;
    }
    update(dt, camera) {
      for (const b of this.pool) {
        if (!b.on) continue;
        b.t += dt; const k = b.t / b.life;
        if (k >= 1) { b.on = false; b.m.visible = b.core.visible = false; continue; }
        const e = 1 - Math.pow(1 - k, 3);
        const s = b.scale * (0.12 + 0.5 * e);
        b.m.scale.set(s, s, s); b.m.material.opacity = Math.pow(1 - k, 1.4);
        const cs = b.scale * (0.16 + 0.1 * e); b.core.scale.set(cs, cs, cs); b.core.material.opacity = Math.max(0, 1 - k * 2.2);
        if (camera) { b.m.quaternion.copy(camera.quaternion); b.core.quaternion.copy(camera.quaternion); }
      }
    }
    dispose() { disposeObj(this.root); }
  }

  /* ================= Hạt: confetti, bụi, vết nảy ================= */
  const DUST = { wood: { col: 0xf2dfc4, n: 1, size: 0.32, op: 0.35, grains: 0, mark: 0x5a3a1a, markOp: 0.12 },
    sand: { col: 0xf0d7a2, n: 3, size: 0.5, op: 0.7, grains: 12, gcol: [0xe8c98e, 0xf5e2b8, 0xd6b47a], mark: 0x9c7a48, markOp: 0.35 },
    hard: { col: 0xe9edf2, n: 1, size: 0.3, op: 0.32, grains: 0, mark: 0x10151c, markOp: 0.14 } };
  class Particles {
    constructor(scene) {
      this.root = new THREE.Group(); this.root.name = 'ppParticles';
      const CAP = 320;
      this.cap = CAP;
      const geo = new THREE.PlaneGeometry(1, 0.6);
      this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.45, metalness: 0.1, emissive: lin(0x222222) }), CAP);
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.count = 0;
      this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      this.root.add(this.mesh);
      this.p = []; for (let i = 0; i < CAP; i++) this.p.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, wx: 0, wy: 0, life: 0, t: 0, s: 0.06, g: 9, drag: 1.2 });
      this._n = 0; this._alive = 0;
      this.dusts = [];
      for (let i = 0; i < 16; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(), transparent: true, depthWrite: false, opacity: 0 }));
        sp.visible = false; sp.renderOrder = 4; this.root.add(sp); this.dusts.push({ sp, t: 0, life: 0.6, on: false, vx: 0, vz: 0, s0: 0.3, op: 0.4 });
      }
      this._dn = 0;
      this.marks = [];
      const mg = new THREE.CircleGeometry(0.09, 20);
      for (let i = 0; i < 8; i++) {
        const m = new THREE.Mesh(mg, fxMat(0x000000, { opacity: 0, toneMapped: true })); m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 3;
        this.root.add(m); this.marks.push({ m, t: 0, op: 0.2, on: false });
      }
      this._mn = 0;
      this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
      if (scene) scene.add(this.root);
    }
    _spawn(x, y, z, vx, vy, vz, color, size, life, g, drag) {
      const i = this._n; this._n = (this._n + 1) % this.cap;
      const o = this.p[i];
      Object.assign(o, { on: true, x, y, z, vx, vy, vz, rx: Math.random() * TAU, ry: Math.random() * TAU, wx: (Math.random() - 0.5) * 18, wy: (Math.random() - 0.5) * 18, life, t: 0, s: size, g, drag });
      this.mesh.setColorAt(i, lin(color));
      this.mesh.instanceColor.needsUpdate = true;
    }
    burst(x, y, z, opts) {
      opts = opts || {};
      const n = opts.count === undefined ? 18 : opts.count, cols = opts.colors || [0xff5d8f, 0xffd23f, 0x5ec8ff, 0x7ee0a1, 0xffffff, 0xb28dff];
      const sp = opts.speed === undefined ? 3.2 : opts.speed, g = opts.gravity === undefined ? 7 : opts.gravity, size = opts.size || 0.075;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, el = 0.25 + Math.random() * 1.1, v = sp * (0.45 + Math.random() * 0.75);
        this._spawn(x, y, z, Math.cos(a) * Math.cos(el) * v, Math.sin(el) * v * 1.1, Math.sin(a) * Math.cos(el) * v, cols[i % cols.length], size * (0.7 + Math.random() * 0.6), opts.life || (1.1 + Math.random() * 0.7), g, opts.drag === undefined ? 1.4 : opts.drag);
      }
      this.mesh.count = this.cap;
    }
    dust(x, z, surface) {
      const D = DUST[surface] || DUST.hard;
      for (let k = 0; k < D.n; k++) {
        const d = this.dusts[this._dn]; this._dn = (this._dn + 1) % this.dusts.length;
        d.on = true; d.t = 0; d.life = 0.55 + Math.random() * 0.25; d.s0 = D.size * (0.8 + Math.random() * 0.4); d.op = D.op;
        d.vx = (Math.random() - 0.5) * 0.6; d.vz = (Math.random() - 0.5) * 0.6;
        d.sp.position.set(x + (Math.random() - 0.5) * 0.1, 0.06, z + (Math.random() - 0.5) * 0.1);
        d.sp.material.color.copy(lin(D.col)); d.sp.visible = true;
      }
      for (let i = 0; i < D.grains; i++) {
        const a = Math.random() * TAU, v = 0.8 + Math.random() * 1.4;
        this._spawn(x, 0.03, z, Math.cos(a) * v * 0.6, 1.2 + Math.random() * 1.6, Math.sin(a) * v * 0.6, D.gcol[i % D.gcol.length], 0.025, 0.7, 9.8, 0.4);
      }
      if (D.grains) this.mesh.count = this.cap;
      const m = this.marks[this._mn]; this._mn = (this._mn + 1) % this.marks.length;
      m.on = true; m.t = 0; m.op = D.markOp; m.m.material.color.copy(lin(D.mark)); m.m.position.set(x, 0.011, z); m.m.visible = true;
    }
    update(dt) {
      let alive = 0;
      const M4 = this._m, Q = this._q, E = this._e, Pv = this._p, S = this._s;
      if (this.mesh.count > 0) {
        for (let i = 0; i < this.cap; i++) {
          const o = this.p[i];
          if (!o.on) { M4.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, M4); continue; }
          o.t += dt;
          if (o.t >= o.life) { o.on = false; M4.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, M4); continue; }
          alive++;
          const dr = Math.exp(-o.drag * dt);
          o.vx *= dr; o.vz *= dr; o.vy = o.vy * dr - o.g * dt;
          o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
          if (o.y < 0.01) { o.y = 0.01; o.vy *= -0.2; o.vx *= 0.5; o.vz *= 0.5; o.wx *= 0.6; o.wy *= 0.6; }
          o.rx += o.wx * dt; o.ry += o.wy * dt;
          const fade = clamp((o.life - o.t) / 0.25, 0, 1);
          E.set(o.rx, o.ry, 0); Q.setFromEuler(E); S.setScalar(o.s * fade);
          M4.compose(Pv.set(o.x, o.y, o.z), Q, S); this.mesh.setMatrixAt(i, M4);
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        if (!alive) this.mesh.count = 0;
      }
      for (const d of this.dusts) {
        if (!d.on) continue;
        d.t += dt; const k = d.t / d.life;
        if (k >= 1) { d.on = false; d.sp.visible = false; continue; }
        const s = d.s0 * (0.4 + 1.2 * (1 - Math.pow(1 - k, 2)));
        d.sp.scale.set(s, s * 0.75, 1); d.sp.position.y += dt * 0.25; d.sp.position.x += d.vx * dt; d.sp.position.z += d.vz * dt;
        d.sp.material.opacity = d.op * (1 - k);
      }
      for (const m of this.marks) {
        if (!m.on) continue;
        m.t += dt; if (m.t >= 1) { m.on = false; m.m.visible = false; continue; }
        m.m.material.opacity = m.op * (1 - m.t);
      }
    }
    dispose() { disposeObj(this.root); }
  }

  function disposeObj(root) {
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const k of ['map', 'alphaMap', 'bumpMap', 'emissiveMap']) if (m[k] && !(m[k].userData && m[k].userData.shared)) m[k].dispose();
        m.dispose();
      }
    });
    if (root.parent) root.parent.remove(root);
  }

  /* ================= ảnh xem trước các sân ================= */
  // Dựng tạm từng sân, vẽ vào render target (MSAA + siêu lấy mẫu x2), đọc điểm ảnh → canvas → dataURL JPEG; mỗi khung hình một sân.
  function thumbnails(renderer, ids, w, h) {
    w = Math.max(16, (w || 320) | 0); h = Math.max(16, (h || 180) | 0);
    ids = (ids && ids.length ? ids : Object.keys(LOOKS)).slice();
    const SS = 2, W2 = w * SS, H2 = h * SS, out = new Map();
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 16);
    return new Promise((resolve) => {
      let rt = null, px, big, bg, img, small, sg;
      const cam = new THREE.PerspectiveCamera(40, w / h, 0.1, 400);
      const clr = new THREE.Color();
      let i = 0;
      const step = () => {
        if (i >= ids.length) { if (rt) rt.dispose(); resolve(out); return; }
        const id = ids[i++];
        if (!LOOKS[id]) { raf(step); return; }
        const saved = { target: renderer.getRenderTarget(), exposure: renderer.toneMappingExposure, aniso: ANISO, alpha: renderer.getClearAlpha(), autoClear: renderer.autoClear, pr: renderer.getPixelRatio() };
        renderer.getClearColor(clr);
        let world = null;
        try {
          if (!rt) {
            // r147: tone mapping vẫn áp khi vẽ vào RT; texture sRGB → định dạng SRGB8_ALPHA8, phần cứng tự mã hoá sRGB khi ghi
            rt = new THREE.WebGLRenderTarget(W2, H2, { samples: renderer.capabilities.isWebGL2 ? 4 : 0 });
            rt.texture.encoding = THREE.sRGBEncoding;
            px = new Uint8Array(W2 * H2 * 4);
            big = makeCanvas(W2, H2); bg = big.getContext('2d'); img = bg.createImageData(W2, H2);
            small = makeCanvas(w, h); sg = small.getContext('2d'); sg.imageSmoothingQuality = 'high';
          }
          world = buildScene(renderer, id, renderer.__ppQuality || 'medium');
          world.update(1 / 60, 3.0);
          const tc = LOOKS[id].thumb || {};
          const p = tc.pos || [10.5, 7.4, 15.5], l = tc.look || [0, 0.3, -3.2];
          cam.position.set(p[0], p[1], p[2]); cam.lookAt(l[0], l[1], l[2]); cam.updateMatrixWorld();
          renderer.setRenderTarget(rt); renderer.autoClear = true; renderer.setClearColor(0x000000, 1);
          renderer.clear(); renderer.render(world.scene, cam);
          renderer.readRenderTargetPixels(rt, 0, 0, W2, H2, px);
          const row = W2 * 4, dst = img.data;
          for (let y = 0; y < H2; y++) dst.set(px.subarray((H2 - 1 - y) * row, (H2 - y) * row), y * row);
          for (let k = 3; k < dst.length; k += 4) dst[k] = 255;
          bg.putImageData(img, 0, 0);
          sg.drawImage(big, 0, 0, w, h);
          out.set(id, small.toDataURL('image/jpeg', 0.88));
        } catch (e) {
          if (typeof console !== 'undefined') console.warn('PP.World.thumbnails', id, e);
        } finally {
          renderer.setRenderTarget(saved.target);
          renderer.toneMappingExposure = saved.exposure; renderer.autoClear = saved.autoClear;
          renderer.setClearColor(clr, saved.alpha);
          if (renderer.getPixelRatio() !== saved.pr) renderer.setPixelRatio(saved.pr);
          ANISO = saved.aniso;
          if (world) world.dispose();
        }
        raf(step);
      };
      raf(step);
    });
  }

  /* ================= xuất API ================= */
  PP.World = {
    QUALITY, LOOKS, VENUE_IDS: Object.keys(LOOKS),
    createRenderer, applyQuality, buildScene,
    surfaceOf: (id) => SURFACE[id] || 'hard',
    thumbnails,
    Ball, TimingRing, LandingMarker, BoxHint, Bursts, Particles,
    lin,
  };

  /** Giải phóng toàn bộ geometry/material/texture của một scene (texture dùng chung được giữ lại) */
  PP.disposeScene = function (scene) {
    if (!scene) return;
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          for (const k of ['map', 'emissiveMap', 'alphaMap', 'bumpMap', 'normalMap', 'roughnessMap']) if (m[k] && !(m[k].userData && m[k].userData.shared)) m[k].dispose();
          m.dispose();
        }
      }
    });
  };
})(window.PP);
