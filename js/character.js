/* Pickle Pop v2 – nhân vật thể thao (PP.Character)
 * Khung xương khớp thật + hoạt ảnh thủ tục + đồng bộ mặt vợt với điểm chạm bóng.
 * Chỉ phụ thuộc THREE (r147, bản global) và PP.CHARACTERS.
 * Hệ tọa độ cục bộ của nhân vật: +z là phía trước (mặt), tay phải ở phía -x, y hướng lên. */
(function () {
  'use strict';
  const PP = (window.PP = window.PP || {});
  const T = window.THREE;
  if (!T) return;

  // ------------------------------------------------------------------ kích thước (m)
  const HIP_STAND = 0.42;            // chiều cao hông khi đứng
  const HIP_JX = 0.09, HIP_JY = -0.035;
  const THIGH = 0.2, SHIN = 0.19, ANKLE = 0.055;
  const SH_X = 0.19, SH_Y = 0.31;    // vai, tính từ eo (gốc torso)
  const UPPER = 0.23, FORE = 0.22;   // cánh tay trên / cẳng tay
  const NECK_Y = 0.37, HEAD_UP = 0.34;
  const HR = [0.36, 0.32, 0.335];    // bán kính ellipsoid đầu
  const PAD_W = 0.25, PAD_H = 0.36, PAD_T = 0.014;
  const HANDLE = 0.16, GRIP_AT = 0.055, THROAT = 0.035;
  const FACE_C = HANDLE - GRIP_AT + THROAT + PAD_H / 2;   // điểm cầm → tâm mặt vợt
  const THROAT_P = HANDLE - GRIP_AT + 0.012;               // điểm cầm → cổ vợt
  const MAX_SHIFT = 0.45, MAX_DOWN = 0.22, MAX_UP = 0.14, MAX_STRETCH = 1.2;
  const CONTINENTAL = 30 * Math.PI / 180;
  const HOLD = 0.045;                // giữ tư thế chạm (s) – bù lệch 1 khung giữa game và hoạt ảnh
  const MAX_JUMP = 0.75;             // overhead: được bật nhảy

  // ------------------------------------------------------------------ bảng phong cách (riêng Pickle Pop)
  const STYLE = {
    bunny:   { shirt: 0x9ad7ff, shorts: 0x5468d9, accent: 0xff7aa2, shoes: 0xffffff, shoeAcc: 0xff7aa2, edge: 0x2d2a3e, eye: 0x2b1d33, blush: 0xff8fb1, inner: 0xffb8cb, acc: 'visor', num: 7, eyes: 'dot', nose: 0xff9ab4, tail: 'puff' },
    bear:    { shirt: 0xffd25e, shorts: 0x3b5bbf, accent: 0xff6b4a, shoes: 0x343844, shoeAcc: 0xffd25e, edge: 0x1f2a3a, eye: 0x24160e, blush: 0xff8a7a, inner: 0xf0d2a8, muzzle: 0xf3dcb8, acc: 'capBack', num: 3, eyes: 'dot', nose: 0x3a2418, tail: 'nub' },
    cat:     { shirt: 0xcbbcff, shorts: 0x2f2f3f, accent: 0xffd84d, shoes: 0xff9fb8, shoeAcc: 0xffffff, edge: 0x26262e, eye: 0x1b1b22, iris: 0xc6f06a, blush: 0xff8fb5, inner: 0xff9fb8, muzzle: 0xe9e9f2, acc: 'band', num: 9, eyes: 'iris', nose: 0xff8fb0, tail: 'cat', whiskers: true },
    pig:     { shirt: 0x7fd8c4, shorts: 0x6a58cf, accent: 0xff5c8a, shoes: 0xffffff, shoeAcc: 0x6a58cf, edge: 0x2c2840, eye: 0x2a1820, blush: 0xff7d9c, inner: 0xff8aa5, acc: 'bow', num: 5, eyes: 'dot', tail: 'curl' },
    frog:    { shirt: 0xfff07a, shorts: 0x2f9e8f, accent: 0xff8c42, shoes: 0xff8c42, shoeAcc: 0xffffff, edge: 0x24302a, eye: 0x1a2416, blush: 0xff9a8a, inner: 0xe6f7c6, acc: 'shades', num: 11, eyes: 'dot' },
    penguin: { shirt: 0xff6b6b, shorts: 0x23324a, accent: 0x5ad1ff, shoes: 0xffa630, shoeAcc: 0xffffff, edge: 0x1d2433, eye: 0x161a24, blush: 0xff8fa0, inner: 0xffffff, acc: 'beanie', num: 2, eyes: 'dot', tail: 'nub' },
    fox:     { shirt: 0xf6f1e4, shorts: 0x3d3b8e, accent: 0x2ec4b6, shoes: 0x3d3b8e, shoeAcc: 0x2ec4b6, edge: 0x1f2b33, eye: 0x24140c, blush: 0xff8a6a, inner: 0xfff3e6, muzzle: 0xffffff, acc: 'stripeBand', num: 8, eyes: 'dot', nose: 0x2a1a14, tail: 'fox' },
    panda:   { shirt: 0x86d95e, shorts: 0x26262b, accent: 0xe63946, shoes: 0xffffff, shoeAcc: 0xe63946, edge: 0x1e1e22, eye: 0x101014, blush: 0xffa0b4, inner: 0x2a2a30, muzzle: 0xffffff, limb: 0x2a2a30, acc: 'redBand', num: 1, eyes: 'ring', nose: 0x1a1a1e, tail: 'puff' },
    dino:    { shirt: 0xff9f45, shorts: 0x30507a, accent: 0xffd166, shoes: 0x30507a, shoeAcc: 0xffd166, edge: 0x223040, eye: 0x13221c, blush: 0xff9b8c, inner: 0xd8f3e9, muzzle: 0xd8f3e9, acc: 'spikeCap', num: 4, eyes: 'dot', tail: 'dino' },
    // v3
    monkey:   { shirt: 0x4ecdc4, shorts: 0x2b3a67, accent: 0xffd23f, shoes: 0xffffff, shoeAcc: 0xff6b35, edge: 0x2a2a3a, eye: 0x24160e, blush: 0xff8f7a, inner: 0xf6d7b0, muzzle: 0xf6d7b0, nose: 0x5a3a28, acc: 'banana', num: 6, eyes: 'dot', tail: 'monkey', shirtStyle: 'tank', pattern: 'split', eyeLift: 0.016 },
    elephant: { shirt: 0xffc8dd, shorts: 0x5e60ce, accent: 0xff8fab, shoes: 0x7bdff2, shoeAcc: 0xffffff, edge: 0x2c2f48, eye: 0x1d1f2e, blush: 0xff8fab, inner: 0xffb3c6, acc: 'party', num: 10, eyes: 'dot', tail: 'elephant', pattern: 'star' },
    raccoon:  { shirt: 0x5ad1a8, shorts: 0x34495e, accent: 0xf4f1de, shoes: 0x2d3142, shoeAcc: 0x5ad1a8, edge: 0x22252e, eye: 0x15151c, blush: 0xff9aa8, inner: 0xf0f0f4, muzzle: 0xf0f0f4, nose: 0x1e1e26, mask: 0x3a3b48, acc: 'headphones', num: 13, eyes: 'ring', tail: 'raccoon', shirtStyle: 'hoodie', pattern: 'check', eyeLift: 0.016 },
    deer:     { shirt: 0xb8e07a, shorts: 0x6b4226, accent: 0xff8fab, shoes: 0xfff7ea, shoeAcc: 0x6b4226, edge: 0x2e2620, eye: 0x2a1810, blush: 0xff9f8f, inner: 0xffd1c1, muzzle: 0xfbe6cc, nose: 0x3a2418, acc: 'flower', num: 12, eyes: 'lash', tail: 'deer', pattern: 'dots' },
    turtle:   { shirt: 0xffd166, shorts: 0x26547c, accent: 0xef476f, shoes: 0xffffff, shoeAcc: 0xef476f, edge: 0x1f2c2a, eye: 0x14241a, blush: 0xff9a8a, inner: 0xf3eab0, nose: 0x2a3a2a, shell: 0x3e8e5e, plate: 0x74c26f, acc: 'cap', num: 15, eyes: 'dot', tail: 'turtle', pattern: 'wave' },
    capybara: { shirt: 0x83c5be, shorts: 0x6d597a, accent: 0xff9f1c, shoes: 0xffffff, shoeAcc: 0xff9f1c, edge: 0x2a2630, eye: 0x20140c, blush: 0xff9a7a, inner: 0x8a6240, muzzle: 0xa47650, nose: 0x3a2618, acc: 'orange', num: 21, eyes: 'small', pattern: 'solid' },
    seal:     { shirt: 0xf1faff, shorts: 0x1d4e89, accent: 0x4cc9f0, shoes: 0xff70a6, shoeAcc: 0xffffff, edge: 0x1d2a3a, eye: 0x101826, blush: 0xff8fb1, inner: 0xffffff, muzzle: 0xffffff, nose: 0x22262e, acc: 'captain', num: 20, eyes: 'big', tail: 'seal', shirtStyle: 'jersey', pattern: 'stripe', whiskers: true, limb: 0xb4c2cf },
    lion:     { shirt: 0xe63946, shorts: 0x1d3557, accent: 0xffd166, shoes: 0xffffff, shoeAcc: 0xe63946, edge: 0x2a1e1a, eye: 0x24140a, blush: 0xff8f6a, inner: 0xfde8b8, muzzle: 0xfde8b8, nose: 0x6b3a2a, mane: 0xd9772b, acc: 'crown', num: 23, eyes: 'dot', tail: 'lion', shirtStyle: 'jersey', pattern: 'flame' },
    sloth:    { shirt: 0xb5e48c, shorts: 0x7b5ea7, accent: 0xffe066, shoes: 0xf7f7f7, shoeAcc: 0x7b5ea7, edge: 0x2a2420, eye: 0x1d140e, blush: 0xffa08a, inner: 0xe6d5c3, muzzle: 0xe6d5c3, nose: 0x3a2a20, patch: 0x5c4535, acc: 'leaf', num: 30, eyes: 'ring', lidBase: 0.78, tail: 'nub', shirtStyle: 'tee', pattern: 'wave', eyeLift: 0.04 },
  };
  const GENERIC = { shirt: 0xa0d8ff, shorts: 0x4a5fd0, accent: 0xffc24a, shoes: 0xffffff, shoeAcc: 0x4a5fd0, edge: 0x2a2a35, eye: 0x221a22, blush: 0xff9ab0, inner: 0xffd6de, acc: 'band', num: 0, eyes: 'dot', shirtStyle: 'tee', pattern: 'stripe' };

  // ------------------------------------------------------------------ tùy chỉnh (look) – id dùng chung với config.LOOK
  const PATTERNS = [
    { id: 'solid', name: 'Trơn' }, { id: 'stripe', name: 'Sọc chéo' }, { id: 'dots', name: 'Chấm bi' }, { id: 'split', name: 'Hai màu' },
    { id: 'flame', name: 'Ngọn lửa' }, { id: 'star', name: 'Ngôi sao' }, { id: 'wave', name: 'Sóng nước' }, { id: 'check', name: 'Ca rô' },
  ];
  const ACCESSORIES = [
    { id: 'default', name: 'Đặc trưng' }, { id: 'none', name: 'Không đội' }, { id: 'cap', name: 'Mũ lưỡi trai' }, { id: 'capBack', name: 'Mũ đội ngược' },
    { id: 'visor', name: 'Mũ nửa đầu' }, { id: 'band', name: 'Băng đô' }, { id: 'beanie', name: 'Mũ len' }, { id: 'bow', name: 'Nơ xinh' },
    { id: 'shades', name: 'Kính râm' }, { id: 'flower', name: 'Hoa cài' }, { id: 'headphones', name: 'Tai nghe' }, { id: 'party', name: 'Mũ tiệc', unlock: 5 },
    { id: 'crown', name: 'Vương miện', unlock: 15 }, { id: 'halo', name: 'Vầng hào quang', unlock: 25 },
  ];
  const SHIRT_STYLES = [{ id: 'tee', name: 'Áo thun' }, { id: 'tank', name: 'Áo ba lỗ' }, { id: 'jersey', name: 'Áo thi đấu' }, { id: 'hoodie', name: 'Áo hoodie' }];
  const PALETTE = ['#ffffff', '#2b2d42', '#8d99ae', '#ff4d6d', '#ff8fab', '#ff6b35', '#ff9f1c', '#ffd23f', '#b5e48c', '#52b788', '#2ec4b6', '#4cc9f0', '#3a86ff', '#5e60ce', '#9b5de5', '#f15bb5', '#8a5a33', '#f4e1c1', '#e63946', '#1d3557'];
  const PATTERN_IDS = PATTERNS.map((p) => p.id), ACC_IDS = ACCESSORIES.map((a) => a.id), STYLE_IDS = SHIRT_STYLES.map((s) => s.id);
  const HEX_RE = /^#?[0-9a-f]{6}$/i;
  function colorOf(v, d) {
    if (typeof v === 'number' && isFinite(v)) return v & 0xffffff;
    if (typeof v === 'string' && HEX_RE.test(v)) return parseInt(v.replace('#', ''), 16);
    return d;
  }
  const hexStr = (c) => '#' + ('000000' + (c >>> 0).toString(16)).slice(-6);
  function cdist(a, b) { const dr = (a >> 16 & 255) - (b >> 16 & 255), dg = (a >> 8 & 255) - (b >> 8 & 255), db = (a & 255) - (b & 255); return Math.sqrt(dr * dr + dg * dg + db * db) / 441.7; }
  /** Gộp STYLE của loài + look → bảng phong cách cuối (màu dạng số). */
  function resolveStyle(def, look) {
    const st = Object.assign({}, GENERIC, STYLE[def.id] || {});
    look = look || {};
    st.paddle = def.paddle == null ? 0xff6f91 : def.paddle;
    const custom = look.shoes != null || look.accent != null;
    st.shirt = colorOf(look.shirt, st.shirt); st.shorts = colorOf(look.shorts, st.shorts);
    st.accent = colorOf(look.accent, st.accent); st.shoes = colorOf(look.shoes, st.shoes); st.paddle = colorOf(look.paddle, st.paddle);
    if (custom) st.shoeAcc = cdist(st.accent, st.shoes) > 0.18 ? st.accent : (lum(st.shoes) > 0.55 ? 0x2b2d42 : 0xffffff);
    if (PATTERN_IDS.indexOf(look.pattern) >= 0) st.pattern = look.pattern;
    if (STYLE_IDS.indexOf(look.shirtStyle) >= 0) st.shirtStyle = look.shirtStyle;
    if (look.number != null && isFinite(+look.number)) st.num = clamp(Math.round(+look.number), 0, 99);
    if (look.accessory === 'none') st.acc = null;
    else if (ACC_IDS.indexOf(look.accessory) >= 2) st.acc = look.accessory;
    return st;
  }
  function defaultLook(id) {
    const def = (PP.CHARACTERS || []).find((d) => d.id === id) || { id };
    const st = resolveStyle(def, null);
    return { shirt: hexStr(st.shirt), shorts: hexStr(st.shorts), accent: hexStr(st.accent), shoes: hexStr(st.shoes), paddle: hexStr(st.paddle),
      pattern: st.pattern, accessory: 'default', shirtStyle: st.shirtStyle, number: st.num };
  }

  // ------------------------------------------------------------------ đệm tạm (không cấp phát mỗi khung)
  const V = () => new T.Vector3();
  const Q = () => new T.Quaternion();
  const UP = new T.Vector3(0, 1, 0), NEG_Y = new T.Vector3(0, -1, 0), ZAX = new T.Vector3(0, 0, 1), XAX = new T.Vector3(1, 0, 0);
  const _p = V(), _n = V(), _x = V(), _y = V(), _z = V(), _m4 = new T.Matrix4();
  const _D = V(), _k = V(), _ud = V(), _ld = V(), _qa = Q(), _qb = Q(), _qc = Q();
  const _Mt = new T.Matrix4(), _Mi = new T.Matrix4(), _Qt = Q(), _Qti = Q(), _Mh = new T.Matrix4();
  const _S = V(), _H = V(), _C = V(), _dir = V(), _pd = V(), _nn = V(), _off = V(), _tmp = V(), _tmp2 = V(), _J = V();
  const _hR = V(), _hL = V(), _qR = Q(), _foot = V(), _q2 = Q();
  const QFLIP = new T.Quaternion().setFromAxisAngle(UP, Math.PI);
  const QGRIP = new T.Quaternion().setFromAxisAngle(UP, CONTINENTAL), QGRIP_INV = QGRIP.clone().invert();
  const POLE_R = new T.Vector3(-0.5, -0.72, -0.48).normalize(), POLE_L = new T.Vector3(0.5, -0.72, -0.48).normalize();
  const POLE_LEG_R = new T.Vector3(-0.15, 0, 1).normalize(), POLE_LEG_L = new T.Vector3(0.15, 0, 1).normalize();

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const easeOut3 = (t) => { t = clamp(t, 0, 1); const u = 1 - t; return 1 - u * u * u; };
  const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

  // ------------------------------------------------------------------ cache tài nguyên dùng chung
  const geoCache = new Map(), matCache = new Map(), texCache = new Map();
  // r147: Color(hex) không tự đổi sRGB → linear; cùng quy ước với world.js (lin)
  const lin = (hex) => new T.Color(hex).convertSRGBToLinear();
  const ENV_INT = 0.8;
  function geo(key, make) { let g = geoCache.get(key); if (!g) { g = make(); geoCache.set(key, g); } return g; }
  function mat(color, o) {
    o = o || {};
    const key = [color, o.r == null ? 0.72 : o.r, o.m || 0, o.basic ? 1 : 0, o.op || 1, o.map ? o.map.uuid : '', o.side || 0, o.e || 0].join('|');
    let m = matCache.get(key);
    if (!m) {
      color = lin(color);
      if (o.basic) m = new T.MeshBasicMaterial({ color, transparent: !!o.op, opacity: o.op || 1, depthWrite: !o.op, map: o.map || null });
      else {
        m = new T.MeshStandardMaterial({ color, roughness: o.r == null ? 0.72 : o.r, metalness: o.m || 0, map: o.map || null, side: o.side || T.FrontSide });
        if (o.op) { m.transparent = true; m.opacity = o.op; m.depthWrite = false; }
        if (o.e) { m.emissive = color.clone(); m.emissiveIntensity = o.e; }
        m.envMapIntensity = ENV_INT;
      }
      matCache.set(key, m);
    }
    return m;
  }
  const sph = (d) => geo('sph' + d, () => new T.SphereGeometry(1, d, Math.max(6, Math.round(d * 0.7))));
  const caps = (r, l) => geo('cap' + r + ':' + l, () => new T.CapsuleGeometry(r, l, 6, 14));
  const cyl = (rt, rb, h, s) => geo('cyl' + rt + ':' + rb + ':' + h + ':' + (s || 16), () => new T.CylinderGeometry(rt, rb, h, s || 16));
  const cone = (r, h, s) => geo('cone' + r + ':' + h + ':' + (s || 14), () => new T.ConeGeometry(r, h, s || 14));
  const torus = (R, t, arc, rs, ts) => geo('tor' + R + ':' + t + ':' + (arc || 0) + ':' + (rs || 8) + ':' + (ts || 32), () => new T.TorusGeometry(R, t, rs || 8, ts || 32, arc || Math.PI * 2));

  /** Ống thon dần dọc theo đường cong (r0 → r1). */
  function taperTube(curve, segs, radial, r0, r1) {
    const g = new T.TubeGeometry(curve, segs, 1, radial, false);
    const p = g.attributes.position, P = new T.Vector3(), W = new T.Vector3();
    for (let i = 0; i <= segs; i++) {
      curve.getPointAt(i / segs, P);
      const r = lerp(r0, r1, i / segs);
      for (let j = 0; j <= radial; j++) { const k = i * (radial + 1) + j; W.fromBufferAttribute(p, k).sub(P).multiplyScalar(r).add(P); p.setXYZ(k, W.x, W.y, W.z); }
    }
    g.computeVertexNormals();
    return g;
  }
  /** Khối cầu "vuông hóa" (superellipsoid) bán kính 1: ex cho x/z, ey cho y (<1 → vuông hơn). */
  function superSphere(ex, ey) {
    const g = new T.SphereGeometry(1, 36, 22);
    const p = g.attributes.position;
    const f = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
    for (let i = 0; i < p.count; i++) p.setXYZ(i, f(p.getX(i), ex), f(p.getY(i), ey), f(p.getZ(i), ex));
    g.computeVertexNormals();
    return g;
  }
  function canvasTex(key, w, h, draw, repeatX, repeatY, post) {
    let t = texCache.get(key);
    if (t) return t;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.anisotropy = 4;
    if (repeatX || repeatY) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeatX || 1, repeatY || 1); }
    if (post) post(t);
    texCache.set(key, t);
    return t;
  }
  const hex = (c) => '#' + ('000000' + c.toString(16)).slice(-6);
  const lum = (c) => ((c >> 16 & 255) * 0.299 + (c >> 8 & 255) * 0.587 + (c & 255) * 0.114) / 255;
  function shade(c, f) { // f>0 sáng hơn, f<0 tối hơn
    let r = c >> 16 & 255, g = c >> 8 & 255, b = c & 255;
    if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; } else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
  }

  function mesh(g, m, parent, x, y, z, sx, sy, sz) {
    const o = new T.Mesh(g, m);
    o.position.set(x || 0, y || 0, z || 0);
    if (sx !== undefined) o.scale.set(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz);
    o.castShadow = true;
    parent.add(o);
    return o;
  }
  function group(parent, x, y, z) { const g = new T.Group(); g.position.set(x || 0, y || 0, z || 0); if (parent) parent.add(g); return g; }

  // ------------------------------------------------------------------ đặt chi tiết lên mặt cong của đầu
  function surfPoint(R, u, v, outP, outN) {
    const cv = Math.cos(v), sv = Math.sin(v);
    outP.set(R[0] * cv * Math.sin(u), R[1] * sv, R[2] * cv * Math.cos(u));
    outN.set(outP.x / (R[0] * R[0]), outP.y / (R[1] * R[1]), outP.z / (R[2] * R[2])).normalize();
  }
  function orient(obj, n, up) { // +z của obj → n, +y gần với up
    _z.copy(n);
    _x.crossVectors(up || UP, _z);
    if (_x.lengthSq() < 1e-6) _x.crossVectors(ZAX, _z);
    _x.normalize();
    _y.crossVectors(_z, _x);
    _m4.makeBasis(_x, _y, _z);
    obj.quaternion.setFromRotationMatrix(_m4);
  }
  /** onHeadSurface: đặt obj tại (u = góc ngang, v = góc ngẩng) trên ellipsoid R (tâm c), nhìn ra ngoài. */
  function placeOn(obj, R, c, u, v, lift, up) {
    surfPoint(R, u, v, _p, _n);
    obj.position.copy(_p).addScaledVector(_n, lift || 0);
    if (c) obj.position.add(c);
    orient(obj, _n, up);
    return obj;
  }

  // ------------------------------------------------------------------ hình học vợt
  function roundRect(w, h, rt, rb) {
    const s = new T.Shape(), x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2;
    s.moveTo(x0 + rb, y0); s.lineTo(x1 - rb, y0); s.quadraticCurveTo(x1, y0, x1, y0 + rb);
    s.lineTo(x1, y1 - rt); s.quadraticCurveTo(x1, y1, x1 - rt, y1);
    s.lineTo(x0 + rt, y1); s.quadraticCurveTo(x0, y1, x0, y1 - rt);
    s.lineTo(x0, y0 + rb); s.quadraticCurveTo(x0, y0, x0 + rb, y0);
    return s;
  }
  const paddleFaceGeo = () => geo('padFace', () => {
    const g = new T.ExtrudeGeometry(roundRect(PAD_W, PAD_H, 0.075, 0.04), { depth: PAD_T, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 10 });
    g.translate(0, 0, -PAD_T / 2);
    return g;
  });
  const paddleEdgeGeo = () => geo('padEdge', () => {
    const outer = roundRect(PAD_W + 0.016, PAD_H + 0.016, 0.083, 0.048);
    outer.holes.push(roundRect(PAD_W - 0.01, PAD_H - 0.01, 0.07, 0.035));
    const d = PAD_T + 0.01;
    const g = new T.ExtrudeGeometry(outer, { depth: d, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 10 });
    g.translate(0, 0, -d / 2);
    return g;
  });
  function starPath(g, cx, cy, R, r, n) {
    g.beginPath();
    for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, rr = i % 2 ? r : R; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    g.closePath();
  }
  function paddleTex(color, accent, pattern) {
    // màu phụ đủ tương phản với màu vợt
    const acc2 = cdist(color, accent) > 0.22 ? accent : shade(accent, lum(accent) > 0.5 ? -0.5 : 0.6);
    return canvasTex('pad:' + pattern + ':' + color + ':' + acc2, 160, 230, (g, w, h) => {
      const A = hex(acc2), light = lum(color) > 0.7;
      const gr = g.createLinearGradient(0, 0, w, h);
      gr.addColorStop(0, hex(shade(color, 0.25))); gr.addColorStop(1, hex(shade(color, -0.12)));
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      let logo = true;
      if (pattern === 'stripe') {
        g.save(); g.translate(w / 2, h / 2); g.rotate(-0.5);
        g.fillStyle = hex(shade(acc2, 0.1)); g.globalAlpha = 0.9; g.fillRect(-w, -18, w * 2, 22);
        g.fillStyle = light ? A : '#ffffff'; g.globalAlpha = 0.7; g.fillRect(-w, 10, w * 2, 6);
        g.restore(); g.globalAlpha = 1;
      } else if (pattern === 'dots') {
        g.fillStyle = A;
        for (let y = 0, r = 0; y < h + 20; y += 26, r++) for (let x = (r % 2) * 13; x < w + 20; x += 26) { g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); }
        logo = false;
      } else if (pattern === 'split') {
        g.fillStyle = A; g.beginPath(); g.moveTo(0, h * 0.62); g.lineTo(w, h * 0.38); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fill();
        g.strokeStyle = '#ffffff'; g.lineWidth = 7; g.beginPath(); g.moveTo(0, h * 0.62); g.lineTo(w, h * 0.38); g.stroke();
      } else if (pattern === 'flame') {
        const hot = shade(acc2, 0.45);
        for (const [col, sc] of [[A, 1], [hex(hot), 0.62]]) {
          g.fillStyle = col; g.beginPath(); g.moveTo(0, h);
          const n = 5;
          for (let i = 0; i < n; i++) {
            const x0 = (i / n) * w, x1 = ((i + 1) / n) * w, xm = (x0 + x1) / 2;
            const tip = h - h * sc * (0.5 + 0.28 * Math.sin(i * 2.3 + 1));
            g.quadraticCurveTo(x0, h - h * sc * 0.25, xm - 6, tip);
            g.quadraticCurveTo(xm + 4, h - h * sc * 0.3, x1, h - h * sc * 0.12);
          }
          g.lineTo(w, h); g.closePath(); g.fill();
        }
        logo = false;
      } else if (pattern === 'star') {
        g.fillStyle = A; starPath(g, w / 2, h * 0.42, 52, 22, 5); g.fill();
        g.lineWidth = 5; g.strokeStyle = '#ffffff'; g.stroke();
        g.fillStyle = light ? A : '#ffffff';
        [[28, 30, 11], [132, 52, 9], [30, 150, 8], [128, 170, 12]].forEach(([x, y, R]) => { starPath(g, x, y, R, R * 0.45, 5); g.fill(); });
      } else if (pattern === 'wave') {
        for (let k = 0; k < 6; k++) {
          const y0 = 18 + k * 40;
          g.fillStyle = k % 2 ? (light ? hex(shade(acc2, 0.5)) : '#ffffff') : A;
          g.beginPath(); g.moveTo(0, y0);
          for (let x = 0; x <= w; x += 8) g.lineTo(x, y0 + Math.sin(x / w * Math.PI * 3 + k) * 7);
          for (let x = w; x >= 0; x -= 8) g.lineTo(x, y0 + 14 + Math.sin(x / w * Math.PI * 3 + k) * 7);
          g.closePath(); g.fill();
        }
        logo = false;
      } else if (pattern === 'check') {
        g.fillStyle = A; const s = 23;
        for (let y = 0, r = 0; y < h; y += s, r++) for (let x = (r % 2) * s; x < w; x += s * 2) g.fillRect(x, y, s, s);
        logo = false;
      }
      if (logo) {
        g.fillStyle = light ? 'rgba(40,40,60,0.75)' : 'rgba(255,255,255,0.92)'; g.font = 'bold 34px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('PP', w / 2, h * 0.78);
      }
      g.strokeStyle = light ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.4)'; g.lineWidth = 3; g.strokeRect(10, 10, w - 20, h - 20);
    }, null, null, (t) => { t.repeat.set(1 / PAD_W, 1 / PAD_H); t.offset.set(0.5, 0.5); });
  }
  const gripTex = () => canvasTex('grip', 64, 64, (g, w, h) => {
    g.fillStyle = '#2b2b33'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#4a4a56'; g.lineWidth = 9;
    for (let i = -2; i < 4; i++) { g.beginPath(); g.moveTo(i * 24, h); g.lineTo(i * 24 + h, 0); g.stroke(); }
  }, 1, 3);

  function shirtTex(st) {
    const style = st.shirtStyle;
    return canvasTex('shirt:' + [st.shirt, st.accent, st.num, style].join(':'), 512, 256, (g, w, h) => {
      const S = hex(st.shirt), A = hex(st.accent);
      g.fillStyle = S; g.fillRect(0, 0, w, h);
      const accVis = cdist(st.shirt, st.accent) > 0.15 ? A : hex(shade(st.accent, lum(st.accent) > 0.5 ? -0.35 : 0.5));
      if (style === 'jersey') {
        // tấm hông màu nhấn + viền trắng, cổ chữ V phía trước
        for (const cx of [0.25, 0.75]) {
          g.fillStyle = accVis; g.fillRect(w * cx - 26, 0, 52, h);
          g.fillStyle = '#ffffff'; g.fillRect(w * cx - 30, 0, 5, h); g.fillRect(w * cx + 25, 0, 5, h);
        }
        g.fillStyle = accVis;
        for (const x0 of [0, w]) { g.beginPath(); g.moveTo(x0 - 70, 0); g.lineTo(x0 + 70, 0); g.lineTo(x0, h * 0.32); g.closePath(); g.fill(); }
        g.fillStyle = S;
        for (const x0 of [0, w]) { g.beginPath(); g.moveTo(x0 - 48, 0); g.lineTo(x0 + 48, 0); g.lineTo(x0, h * 0.22); g.closePath(); g.fill(); }
        g.fillStyle = accVis; g.fillRect(0, h * 0.93, w, h * 0.07);
      } else if (style === 'tank') {
        for (const cx of [0.25, 0.75]) { g.fillStyle = accVis; g.fillRect(w * cx - 9, 0, 18, h); }
        g.fillStyle = accVis; g.fillRect(0, h * 0.9, w, h * 0.05);
      } else if (style === 'hoodie') {
        // túi kangaroo phía trước (u = 0 ≡ 1)
        const P = hex(shade(st.shirt, -0.14));
        g.fillStyle = P;
        for (const x0 of [0, w]) { g.beginPath(); g.moveTo(x0 - 62, h * 0.95); g.lineTo(x0 - 50, h * 0.66); g.lineTo(x0 + 50, h * 0.66); g.lineTo(x0 + 62, h * 0.95); g.closePath(); g.fill(); }
        g.strokeStyle = accVis; g.lineWidth = 4;
        for (const x0 of [0, w]) { g.beginPath(); g.moveTo(x0 - 50, h * 0.66); g.lineTo(x0 + 50, h * 0.66); g.stroke(); }
        g.fillStyle = accVis; g.fillRect(0, h * 0.94, w, h * 0.06);
      } else {
        // áo thun: dải ngực màu nhấn
        g.fillStyle = accVis; g.fillRect(0, h * 0.30, w, h * 0.07);
        g.fillStyle = hex(shade(st.shirt, 0.45)); g.fillRect(0, h * 0.38, w, h * 0.025);
      }
      // số áo ở lưng (u = 0.5)
      const dark = lum(st.shirt) > 0.62;
      g.font = 'bold 92px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const ny = style === 'jersey' ? h * 0.52 : h * 0.6;
      g.lineWidth = 10; g.strokeStyle = accVis; g.strokeText(String(st.num), w * 0.5, ny);
      g.fillStyle = dark ? '#2c2c3a' : '#ffffff'; g.fillText(String(st.num), w * 0.5, ny);
      if (style === 'jersey') {
        g.font = 'bold 26px Arial, sans-serif'; g.lineWidth = 4; g.strokeText(String(st.num), w * 0.1, h * 0.44); g.fillText(String(st.num), w * 0.1, h * 0.44);
      } else if (style !== 'hoodie') {
        // huy hiệu nhỏ ngực trái (u ≈ 0.09)
        g.fillStyle = accVis; g.beginPath(); g.arc(w * 0.09, h * 0.52, 13, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(w * 0.09, h * 0.52, 6, 0, Math.PI * 2); g.fill();
      }
    });
  }
  function shellTex(st) {
    return canvasTex('shell:' + [st.shell, st.plate, st.num, st.accent].join(':'), 256, 256, (g, w, h) => {
      g.fillStyle = hex(st.shell); g.fillRect(0, 0, w, h);
      const s = 34, P = hex(st.plate);
      g.lineJoin = 'round';
      for (let r = -1; r < 6; r++) for (let c = -1; c < 6; c++) {
        const cx = w / 2 + (c - 2) * s * 1.5, cy = h / 2 + (r - 2) * s * 1.732 + (c % 2 ? s * 0.866 : 0);
        g.beginPath();
        for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; g.lineTo(cx + Math.cos(a) * s * 0.84, cy + Math.sin(a) * s * 0.84); }
        g.closePath(); g.fillStyle = P; g.fill();
        g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.arc(cx - 6, cy - 7, 7, 0, Math.PI * 2); g.fill();
      }
      g.font = 'bold 76px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 10; g.strokeStyle = hex(st.accent); g.strokeText(String(st.num), w / 2, h / 2 + 4);
      g.fillStyle = '#ffffff'; g.fillText(String(st.num), w / 2, h / 2 + 4);
    });
  }
  function shortsTex(st) {
    return canvasTex('shorts:' + st.shorts + ':' + st.accent, 256, 64, (g, w, h) => {
      g.fillStyle = hex(st.shorts); g.fillRect(0, 0, w, h);
      g.fillStyle = hex(st.accent);
      g.fillRect(w * 0.25 - 6, 0, 12, h); g.fillRect(w * 0.75 - 6, 0, 12, h);
      g.fillStyle = '#ffffff'; g.fillRect(w * 0.25 + 8, 0, 4, h); g.fillRect(w * 0.75 - 12, 0, 4, h);
    });
  }
  function stripeTex(a, b, rep) {
    return canvasTex('stripe:' + a + ':' + b + ':' + (rep || 14), 64, 16, (g, w, h) => {
      g.fillStyle = hex(a); g.fillRect(0, 0, w, h); g.fillStyle = hex(b); g.fillRect(0, 0, w / 2, h);
    }, rep || 14, 1);
  }
  const shirtGeo = () => geo('shirt', () => {
    const pts = [[0.0, -0.075], [0.15, -0.072], [0.2, -0.04], [0.214, 0.03], [0.214, 0.12], [0.2, 0.21], [0.172, 0.285], [0.13, 0.345], [0.075, 0.39], [0.0, 0.405]]
      .map((p) => new T.Vector2(p[0], p[1]));
    return new T.LatheGeometry(new T.SplineCurve(pts).getPoints(30), 40);
  });
  const shortsGeo = () => geo('shorts', () => {
    const pts = [[0.0, -0.15], [0.13, -0.15], [0.205, -0.13], [0.226, -0.07], [0.224, 0.0], [0.205, 0.035], [0.0, 0.04]].map((p) => new T.Vector2(p[0], p[1]));
    return new T.LatheGeometry(new T.SplineCurve(pts).getPoints(16), 36);
  });

  // ------------------------------------------------------------------ keypose (đơn vị: khung torso, trừ "ct" ở khung root)
  function padQuat(out, p, n) {
    _y.copy(p).normalize();
    _z.copy(n).addScaledVector(_y, -_y.dot(n));
    if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
    _z.normalize();
    _x.crossVectors(_y, _z);
    _m4.makeBasis(_x, _y, _z);
    return out.setFromRotationMatrix(_m4);
  }
  const v3 = (a) => new T.Vector3(a[0], a[1], a[2]);
  function armPose(h, p, n) { const q = padQuat(new T.Quaternion(), v3(p), v3(n)); return { h: v3(h), q }; }

  const POSE = {
    ready:   armPose([-0.13, 0.11, 0.27], [-0.3, 1, 0.12], [0.05, 0, 1]),
    idle:    armPose([-0.25, 0.0, 0.08], [-0.12, -0.7, 0.7], [-1, 0, 0.1]),
    serve:   armPose([-0.27, 0.03, -0.04], [-0.1, -0.85, -0.3], [0, -0.3, 1]),
    celeb:   armPose([-0.16, 0.72, 0.08], [-0.25, 1, 0.1], [0, 0, 1]),
    sad:     armPose([-0.23, -0.05, 0.06], [-0.05, -1, 0.25], [-1, 0, 0]),
  };
  const LPOSE = {
    idle: v3([0.25, 0.01, 0.05]), ready: v3([0.26, 0.12, 0.2]), hold: v3([0.025, 0.37, 0.355]),
    serve: v3([0.25, 0.08, 0.12]), celeb: v3([0.2, 0.7, 0.08]), sad: v3([0.23, -0.04, 0.05]),
  };
  function Z(o) {
    return {
      wu: Object.assign(armPose(o.wu.h, o.wu.p, o.wu.n), { coil: o.wu.coil || 0, crouch: o.wu.crouch || 0, lean: o.wu.lean || 0, l: o.wu.l ? v3(o.wu.l) : null }),
      ct: { hint: v3(o.ct.hint).normalize(), mix: o.ct.mix, n: v3(o.ct.n), coil: o.ct.coil || 0, crouch: o.ct.crouch || 0, lean: o.ct.lean || 0, l: o.ct.l ? v3(o.ct.l) : null },
      fo: Object.assign(armPose(o.fo.h, o.fo.p, o.fo.n), { coil: o.fo.coil || 0, crouch: o.fo.crouch || 0, lean: o.fo.lean || 0, l: o.fo.l ? v3(o.fo.l) : null }),
      def: v3(o.def), tip: o.tip || 0,
    };
  }
  const ZONES = {
    forehand: Z({
      wu: { h: [-0.38, 0.16, -0.14], p: [-0.55, 0.6, -0.55], n: [0.3, 0, 1], coil: -0.55, crouch: 0.04, lean: 0.04, l: [0.3, 0.22, 0.24] },
      ct: { hint: [-0.85, 0.22, 0.5], mix: 0.55, n: [0, 0.08, 1], coil: -0.05, lean: 0.1, l: [0.32, 0.2, 0.2] },
      fo: { h: [0.14, 0.4, 0.2], p: [0.45, 0.7, -0.45], n: [0.6, 0.2, 0.6], coil: 0.4, lean: 0.05, l: [0.22, 0.04, 0.12] },
      def: [-0.75, 0.9, 0.5],
    }),
    backhand: Z({
      wu: { h: [0.12, 0.17, 0.17], p: [0.7, 0.45, -0.35], n: [0, 0, 1], coil: 0.5, crouch: 0.04, lean: 0.05, l: null },
      ct: { hint: [0.8, 0.22, 0.55], mix: 0.55, n: [0, 0.08, 1], coil: 0.0, lean: 0.1, l: [0.3, 0.1, -0.02] },
      fo: { h: [-0.34, 0.36, 0.22], p: [-0.6, 0.65, 0.3], n: [-0.4, 0, 1], coil: -0.35, lean: 0.05, l: [0.3, 0.14, -0.1] },
      def: [0.55, 0.9, 0.55],
    }),
    overhead: Z({
      wu: { h: [-0.28, 0.56, -0.1], p: [-0.15, 0.7, -0.75], n: [0, 0.3, 1], coil: -0.45, lean: -0.15, l: [0.2, 0.62, 0.25] },
      ct: { hint: [-0.25, 0.9, 0.4], mix: 0.5, n: [0, -0.3, 1], coil: 0.0, lean: 0.08, l: [0.25, 0.3, 0.25] },
      fo: { h: [0.16, 0.02, 0.24], p: [0.35, -0.5, 0.6], n: [0, 0.6, 1], coil: 0.35, lean: 0.25, l: [0.25, 0.05, 0.0] },
      def: [-0.25, 1.75, 0.45], tip: 1,
    }),
    low: Z({
      wu: { h: [-0.27, 0.02, 0.14], p: [-0.25, -0.7, 0.35], n: [0, 0.6, 1], coil: -0.15, crouch: 0.12, lean: 0.18, l: [0.3, 0.15, 0.2] },
      ct: { hint: [-0.2, -0.6, 0.75], mix: 0.6, n: [0, 0.75, 1], coil: 0.0, crouch: 0.13, lean: 0.22, l: [0.3, 0.15, 0.22] },
      fo: { h: [-0.14, 0.17, 0.36], p: [-0.1, 0.3, 1], n: [0, 1, -0.2], coil: 0.12, crouch: 0.08, lean: 0.12, l: [0.3, 0.15, 0.2] },
      def: [-0.35, 0.3, 0.62],
    }),
    volley: Z({
      wu: { h: [-0.2, 0.17, 0.14], p: [-0.3, 1, -0.12], n: [0, 0, 1], coil: -0.12, crouch: 0.03, lean: 0.08, l: null },
      ct: { hint: [-0.3, 0.55, 0.75], mix: 0.55, n: [0, 0.1, 1], coil: 0.0, lean: 0.12, l: [0.26, 0.2, 0.22] },
      fo: { h: [-0.14, 0.18, 0.37], p: [-0.25, 0.85, 0.45], n: [0, -0.3, 1], coil: 0.05, lean: 0.1, l: [0.26, 0.2, 0.22] },
      def: [-0.4, 1.0, 0.65],
    }),
    serve: Z({
      wu: { h: [-0.3, -0.04, -0.24], p: [-0.1, -0.8, -0.55], n: [0, -0.5, 1], coil: -0.3, crouch: 0.06, lean: 0.08, l: [0.22, 0.42, 0.3] },
      ct: { hint: [-0.1, -0.85, 0.5], mix: 0.3, n: [0, 0.45, 1], coil: -0.05, lean: 0.12, l: [0.3, 0.3, 0.12] },
      fo: { h: [-0.02, 0.42, 0.33], p: [0.1, 0.85, 0.5], n: [0, -0.4, 1], coil: 0.2, lean: 0.05, l: [0.28, 0.15, 0.0] },
      def: [0.0, 0.55, 0.45],
    }),
  };

  // ------------------------------------------------------------------ IK 2 đoạn (giải tích) trong khung cha
  // Trả về hệ số kéo dãn (1 = bình thường). Đoạn nghỉ hướng -Y.
  function solve2(J, Tg, a, b, pole, qU, qL, maxStretch) {
    _D.subVectors(Tg, J);
    let d = _D.length();
    let s = 1;
    if (maxStretch > 1 && d > (a + b) * 0.995) s = Math.min(maxStretch, d / ((a + b) * 0.995));
    const A = a * s, B = b * s;
    d = clamp(d, Math.max(Math.abs(A - B) + 1e-3, 0.3 * (A + B)), (A + B) * 0.995);
    if (_D.lengthSq() < 1e-9) _D.set(0, -1, 0);
    _D.normalize();
    _k.crossVectors(_D, pole);
    if (_k.lengthSq() < 1e-6) _k.crossVectors(_D, XAX);
    _k.normalize();
    const al = Math.acos(clamp((A * A + d * d - B * B) / (2 * A * d), -1, 1));
    const be = Math.acos(clamp((A * A + B * B - d * d) / (2 * A * B), -1, 1));
    _ud.copy(_D).applyAxisAngle(_k, al);
    _ld.copy(_ud).applyAxisAngle(_k, -(Math.PI - be));
    qU.setFromUnitVectors(NEG_Y, _ud);
    _qa.setFromUnitVectors(NEG_Y, _ld);
    qL.copy(qU).invert().multiply(_qa);
    return s;
  }

  // ------------------------------------------------------------------ dựng nhân vật
  function build(def, opts) {
    def = def || (PP.CHARACTERS && PP.CHARACTERS[0]) || { id: 'bunny', body: 0xffffff, accent: 0xffb3c7, belly: 0xffffff, paddle: 0xff6f91, ears: 'long' };
    opts = opts || {};
    const id = def.id;
    const st = resolveStyle(def, opts.look);
    const kind = def.ears || 'round';
    const team = opts.team === 'A' ? 'A' : 'B';
    const baseYaw = team === 'A' ? Math.PI : 0;
    const fur = def.body, limbC = st.limb || fur;
    const sStyle = st.shirtStyle;

    const mFur = mat(fur, { r: 0.78 });
    const mLimb = mat(limbC, { r: 0.78 });
    const mInner = mat(st.inner, { r: 0.8 });
    const mBelly = mat(st.muzzle || def.belly || 0xffffff, { r: 0.8 });
    const mShirt = mat(0xffffff, { r: 0.82, map: shirtTex(st) });
    const mShirtPlain = mat(st.shirt, { r: 0.82 });
    const mShorts = mat(0xffffff, { r: 0.8, map: shortsTex(st) });
    const mShortsPlain = mat(st.shorts, { r: 0.8 });
    const mAcc = mat(st.accent, { r: 0.6 });
    const mShoe = mat(st.shoes, { r: 0.55 });
    const mShoeAcc = mat(st.shoeAcc, { r: 0.5 });
    const mWhite = mat(0xfafafa, { r: 0.6 });
    const mEye = mat(st.eye, { r: 0.22 });
    const mHi = mat(0xffffff, { basic: true });
    const mBlush = mat(st.blush, { r: 0.9, op: 0.55 });
    const mDark = mat(0x23202a, { r: 0.4 });
    const paddleColor = st.paddle;
    const mPadFace = mat(0xffffff, { r: 0.45, map: paddleTex(paddleColor, st.accent, st.pattern) });
    const mEdge = mat(st.edge, { r: 0.4 });
    const mGrip = mat(0xffffff, { r: 0.85, map: gripTex() });

    const root = new T.Group(); root.name = 'char:' + id;
    const hips = group(root, 0, HIP_STAND, 0); hips.rotation.order = 'YXZ';
    const torso = group(hips); torso.rotation.order = 'YXZ';
    const chest = group(torso);                     // nhóm co giãn (squash)
    const neck = group(chest, 0, NECK_Y, 0); neck.rotation.order = 'YXZ';
    const head = group(neck, 0, HEAD_UP, 0.01);     // tâm đầu

    // ---- thân: áo, quần, viền
    const shirt = mesh(shirtGeo(), mShirt, chest, 0, 0, 0, 1, 1, 0.88); shirt.receiveShadow = true;
    const collar = mesh(torus(0.085, 0.022, 0, 8, 28), mAcc, chest, 0, 0.375, 0); collar.rotation.x = Math.PI / 2; collar.scale.set(1, 0.9, 1);
    const hem = mesh(torus(0.205, 0.017, 0, 8, 40), mAcc, chest, 0, -0.045, 0); hem.rotation.x = Math.PI / 2; hem.scale.set(1, 0.88, 1);
    const shorts = mesh(shortsGeo(), mShorts, hips, 0, 0, 0, 1, 1, 0.9); shorts.receiveShadow = true;
    const belt = mesh(torus(0.214, 0.012, 0, 6, 40), mat(shade(st.shorts, -0.3), { r: 0.6 }), hips, 0, 0.025, 0); belt.rotation.x = Math.PI / 2; belt.scale.set(1, 0.9, 1);
    if (sStyle === 'hoodie') {
      // mũ trùm cuộn sau gáy + túi mũ trên lưng + dây rút
      const hood = mesh(torus(0.115, 0.05, Math.PI * 1.25, 10, 28), mShirtPlain, chest, 0, 0.37, -0.01);
      hood.rotation.set(-Math.PI / 2, 0, -Math.PI * 0.125); hood.scale.set(1.05, 1, 0.9);
      if (kind !== 'turtle') {
        const pouch = mesh(sph(24), mShirtPlain, chest, 0, 0.3, -0.155, 0.15, 0.11, 0.065); pouch.rotation.x = -0.35;
        mesh(torus(0.1, 0.012, 0, 6, 24), mAcc, chest, 0, 0.335, -0.2, 1.2, 0.75, 1).rotation.x = -0.35;
      }
      for (const s of [-1, 1]) {
        const dr = mesh(cyl(0.006, 0.006, 0.11, 6), mWhite, chest, s * 0.035, 0.305, 0.128); dr.rotation.x = -0.43;
        mesh(sph(8), mAcc, chest, s * 0.035, 0.252, 0.152, 0.014, 0.018, 0.014);
      }
    } else if (sStyle === 'jersey') {
      collar.scale.set(1.04, 0.95, 1.15);
    } else if (sStyle === 'tank') {
      collar.scale.set(1.12, 1, 1.25);
    }
    if (kind === 'turtle') {
      // mai rùa trên lưng – số áo in trên mai
      const shellG = geo('turtleShell', () => {
        const g = new T.SphereGeometry(1, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2);
        g.rotateX(-Math.PI / 2);
        const p = g.attributes.position, uv = g.attributes.uv;
        for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 - p.getX(i) * 0.5, 0.5 + p.getY(i) * 0.5);
        return g;
      });
      const sh = mesh(shellG, mat(0xffffff, { r: 0.55, map: shellTex(st) }), chest, 0, 0.17, -0.17, 0.25, 0.27, 0.15);
      sh.receiveShadow = true;
      const rim = mesh(torus(1, 0.1, 0, 10, 48), mat(def.belly || 0xf3eab0, { r: 0.7 }), chest, 0, 0.17, -0.17, 0.25, 0.27, 0.22);
      rim.scale.set(0.255, 0.275, 0.3);
    }

    // ---- đầu
    const skull = mesh(sph(48), mFur, head, 0, 0, 0, HR[0], HR[1], HR[2]); skull.receiveShadow = true;
    const face = buildFace(head, kind, st, def, { mFur, mInner, mBelly, mEye, mHi, mBlush, mDark, mAcc, mWhite });
    const accObj = buildAccessory(head, st.acc, st, id, { mAcc, mDark, mWhite, mFur });

    // ---- tay
    const clawM = kind === 'sloth' ? mat(0xf3ead8, { r: 0.45 }) : null;
    function makeArm(side) { // side: -1 phải, +1 trái
      const sh = group(torso, side * SH_X, SH_Y, 0);
      mesh(sph(20), sStyle === 'tank' ? mLimb : mShirt, sh, 0, 0, 0, 0.068, 0.064, 0.068);     // vai áo
      const up = group(sh);
      let sleeve = null, sleeveHem = null, foSleeve = null;
      if (sStyle === 'hoodie') {
        sleeve = mesh(cyl(0.064, 0.056, UPPER * 0.95, 16), mShirtPlain, up, 0, -UPPER * 0.47, 0);
      } else if (sStyle !== 'tank') {
        const L = sStyle === 'jersey' ? 0.1 : 0.085;
        sleeve = mesh(cyl(0.062, 0.056, L, 16), mShirt, up, 0, -L / 2 + 0.002, 0);
        sleeveHem = mesh(torus(0.056, sStyle === 'jersey' ? 0.013 : 0.011, 0, 6, 20), mAcc, up, 0, -L + 0.003, 0); sleeveHem.rotation.x = Math.PI / 2;
        if (sStyle === 'jersey') { const w2 = mesh(torus(0.058, 0.008, 0, 6, 20), mWhite, up, 0, -L + 0.026, 0); w2.rotation.x = Math.PI / 2; }
      }
      const upM = mesh(caps(0.046, UPPER - 0.03), mLimb, up, 0, -UPPER / 2, 0);
      const fo = group(up, 0, -UPPER, 0);
      const foM = mesh(caps(0.043, FORE - 0.03), mLimb, fo, 0, -FORE / 2, 0);
      const band = mesh(cyl(0.05, 0.05, 0.045, 16), mAcc, fo, 0, -FORE + 0.055, 0);
      if (sStyle === 'hoodie') {
        band.visible = false;
        foSleeve = group(fo);
        mesh(cyl(0.057, 0.052, FORE * 0.72, 16), mShirtPlain, foSleeve, 0, -FORE * 0.36, 0);
        const cuff = mesh(torus(0.05, 0.014, 0, 6, 20), mAcc, foSleeve, 0, -FORE * 0.72, 0); cuff.rotation.x = Math.PI / 2;
      }
      const hand = group(fo, 0, -FORE, 0);
      if (kind === 'seal') {
        const fl = mesh(sph(18), mLimb, hand, 0, -0.025, 0.008, 0.036, 0.085, 0.066); fl.rotation.x = 0.25;
      } else mesh(sph(18), mLimb, hand, 0, 0, 0, 0.055, 0.055, 0.055);
      if (clawM) {
        for (let j = -1; j <= 1; j++) {
          const c = mesh(cone(0.011, 0.07, 8), clawM, hand, j * 0.024, -0.05, 0.03 - Math.abs(j) * 0.008);
          c.rotation.set(Math.PI - 0.5, 0, j * 0.15);
        }
      }
      return { sh, up, fo, hand, upM, foM, band, sleeve, sleeveHem, foSleeve };
    }
    const armR = makeArm(-1), armL = makeArm(1);
    // vợt trong tay phải: hand → GRIP (continental 30°) → paddle (+Y dọc vợt, +Z pháp tuyến mặt)
    const grip = group(armR.hand); grip.quaternion.copy(QGRIP);
    const paddle = group(grip); paddle.userData.paddle = true;
    mesh(cyl(0.019, 0.017, HANDLE, 16), mGrip, paddle, 0, HANDLE / 2 - GRIP_AT, 0);
    mesh(cyl(0.025, 0.025, 0.014, 16), mEdge, paddle, 0, -GRIP_AT - 0.004, 0);
    const fist = mesh(torus(0.026, 0.021, 0, 8, 16), mLimb, paddle, 0, 0.0, 0); fist.rotation.x = Math.PI / 2;
    mesh(cyl(0.05, 0.02, THROAT + 0.02, 16), mEdge, paddle, 0, HANDLE - GRIP_AT + THROAT / 2, 0, 1, 1, 0.45);
    mesh(paddleFaceGeo(), [mPadFace, mat(shade(paddleColor, -0.25), { r: 0.5 })], paddle, 0, FACE_C, 0);
    mesh(paddleEdgeGeo(), mEdge, paddle, 0, FACE_C, 0);
    const faceMarker = group(paddle, 0, FACE_C, 0);

    // ---- chân
    function makeLeg(side) {
      const th = group(hips, side * HIP_JX, HIP_JY, 0);
      mesh(caps(0.074, THIGH - 0.06), mShortsPlain, th, 0, -THIGH / 2 + 0.01, 0);
      const sn = group(th, 0, -THIGH, 0);
      mesh(caps(0.052, SHIN - 0.04), mLimb, sn, 0, -SHIN / 2, 0);
      const ank = group(sn, 0, -SHIN, 0);
      mesh(cyl(0.056, 0.058, 0.045, 14), mWhite, ank, 0, 0.022, 0);       // tất
      const shoe = group(ank);
      mesh(sph(24), mShoe, shoe, 0, -0.01, 0.03, 0.074, 0.052, 0.118);
      mesh(cyl(1, 1, 1, 24), mWhite, shoe, 0, -0.045, 0.03, 0.08, 0.02, 0.125);
      const tongue = mesh(sph(14), mShoeAcc, shoe, 0, 0.02, 0.06, 0.04, 0.025, 0.05); tongue.rotation.x = -0.4;
      mesh(sph(14), mShoeAcc, shoe, side * 0.06, -0.012, 0.025, 0.018, 0.022, 0.07);
      return { th, sn, ank, shoe };
    }
    const legR = makeLeg(-1), legL = makeLeg(1);

    // ---- đuôi
    const tail = buildTail(hips, st.tail, kind, { mFur, mWhite, mBelly, mAcc, mInner, accent: def.accent, st });

    // ---- vòng highlight dưới chân
    const ringMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
    const ring = new T.Mesh(geo('hlRing', () => new T.RingGeometry(0.44, 0.52, 56)), ringMat);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.012; ring.visible = false; ring.renderOrder = 1;
    root.add(ring);
    const ringFill = new T.Mesh(geo('hlDisc', () => new T.CircleGeometry(0.44, 48)), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }));
    ringFill.rotation.x = -Math.PI / 2; ringFill.position.y = 0.011; ringFill.visible = false;
    root.add(ringFill);

    // ================================================================ trạng thái động
    let time = Math.random() * 10;
    let yawOff = 0, spinA = 0, phase = 0, locoAmp = 0, shufW = 0;
    const mv = new T.Vector2(0, 1);
    let lastMode = 'ready';
    let reactMode = null, reactT = 0, celebT = 0;
    let blinkT = 1 + Math.random() * 3, blinkP = -1;
    let earT = 2 + Math.random() * 3, earP = -1;
    let splitT = -1, lungeT = -1;
    const lungeDir = new T.Vector2();
    // tư thế nền (được làm mượt)
    const cur = {
      h: POSE.ready.h.clone(), q: POSE.ready.q.clone(), l: LPOSE.ready.clone(),
      hipsY: 0.38, stance: 0.16, stagger: 0, coil: 0, lean: 0.06, roll: 0, throatW: 1, headPitch: 0,
      leanV: 0, rollV: 0, mood: 0, sad: 0,
    };
    // lần xuất gần nhất (để vung từ tư thế hiện tại)
    const last = { h: cur.h.clone(), q: cur.q.clone(), l: cur.l.clone(), coil: 0, crouch: 0, lean: 0 };
    const sw = {
      active: false, z: ZONES.forehand, zone: 'forehand', t: 0, T: 0.3, cd: 0.09, tw: 0.2, hasC: false,
      C: V(), Cr: V(), contacted: false,
      sh: V(), sq: Q(), sl: V(), sCoil: 0, sCrouch: 0, sLean: 0, sLW: 0,
      ch: V(), cq: Q(), cl: V(), cCoil: 0, cCrouch: 0, cLean: 0, cOff: V(), off: V(), cRoll: 0, liveRoll: 0, stretch: 1,
      qWu: Q(),
    };
    const outS = { h: V(), q: Q(), l: V(), lThroat: 0, coil: 0, crouch: 0, lean: 0, roll: 0, offW: 0, stretchOk: false, w: 0 };
    let stretchR = 1;
    const faceDir = { du: 0, dv: 0 };

    function setArmStretch(arm, s) {
      arm.fo.position.y = -UPPER * s;
      arm.hand.position.y = -FORE * s;
      arm.upM.position.y = -UPPER * s / 2; arm.upM.scale.y = s;
      arm.foM.position.y = -FORE * s / 2; arm.foM.scale.y = s;
      arm.band.position.y = -FORE * s + 0.055;
      if (arm.foSleeve) arm.foSleeve.scale.y = s;
    }

    function torsoMatrices() {
      hips.updateMatrix(); torso.updateMatrix();
      _Mt.multiplyMatrices(hips.matrix, torso.matrix);
      _Mi.copy(_Mt).invert();
      _Qt.multiplyQuaternions(hips.quaternion, torso.quaternion);
      _Qti.copy(_Qt).invert();
    }
    function toRootLocal(w, out) { // thế giới → khung root (không scale, chỉ xoay y)
      const th = root.rotation.y, c = Math.cos(th), s = Math.sin(th);
      const dx = w.x - root.position.x, dz = w.z - root.position.z;
      return out.set(c * dx - s * dz, w.y, s * dx + c * dz);
    }

    // ---- tính tư thế chạm (khung root) cho khung hình hiện tại
    function contactTargets(shY) {
      const z = sw.z;
      if (sw.hasC) toRootLocal(sw.C, sw.Cr); else sw.Cr.copy(z.def);
      _S.set(-SH_X, shY, 0).applyMatrix4(_Mt);                 // vai phải (root)
      _dir.subVectors(sw.Cr, _S); const ds = _dir.length(); if (ds > 1e-5) _dir.multiplyScalar(1 / ds); else _dir.copy(ZAX);
      // bóng xa: duỗi thẳng tay + vợt thành một đường để với xa hơn
      const mix = lerp(z.ct.mix, 1, clamp((ds - 0.75) / 0.45, 0, 1));
      _pd.copy(z.ct.hint).multiplyScalar(1 - mix).addScaledVector(_dir, mix).normalize();
      _H.copy(sw.Cr).addScaledVector(_pd, -FACE_C);            // mục tiêu bàn tay (root)
      // dịch thân để bàn tay vừa tầm với
      _off.set(0, 0, 0);
      _D.subVectors(_H, _S); const d = _D.length();
      const rMax = (UPPER + FORE) * 0.97, rMin = 0.3;
      const want = clamp(d, rMin, rMax);
      if (d > 1e-5 && Math.abs(d - want) > 1e-5) {
        _off.copy(_D).multiplyScalar((d - want) / d);
        let hx = _off.x, hz = _off.z; const hl = Math.hypot(hx, hz);
        if (hl > MAX_SHIFT) { hx *= MAX_SHIFT / hl; hz *= MAX_SHIFT / hl; }
        const up = z.tip ? MAX_JUMP : MAX_UP;
        let vy = clamp(_off.y, -MAX_DOWN, up);
        // phần dọc bù cho phần ngang bị cắt
        const ex = _D.x - hx, ez = _D.z - hz, eh2 = ex * ex + ez * ez;
        if (eh2 < rMax * rMax && (d > rMax)) {
          const needV = Math.sqrt(rMax * rMax - eh2);
          const dy = _D.y;
          const vy2 = dy - Math.sign(dy || 1) * Math.min(Math.abs(dy), needV);
          vy = clamp(vy2, -MAX_DOWN, up);
        }
        _off.set(hx, vy, hz);
      }
      sw.off.copy(_off);
      // pháp tuyến mặt vợt mong muốn (root) → tư thế vợt
      _nn.copy(sw.z.ct.n);
      padQuat(_qc, _pd, _nn);
      return _qc; // khung root
    }

    // ---- đánh giá cú vung: ghi vào outS (khung torso cho tay)
    function evalSwing(dt) {
      const z = sw.z, s = sw.t, Tc = sw.T;
      outS.lThroat = 0; outS.offW = 0; outS.stretchOk = false; outS.roll = 0;
      if (s < sw.tw) {
        const a = sw.tw > 0 ? smooth(s / sw.tw) : 1;
        outS.h.lerpVectors(sw.sh, z.wu.h, a);
        outS.q.slerpQuaternions(sw.sq, z.wu.q, a);
        if (z.wu.l) { outS.l.lerpVectors(sw.sl, z.wu.l, a); outS.lThroat = sw.sLW * (1 - a); } else { outS.l.copy(sw.sl); outS.lThroat = lerp(sw.sLW, 1, a); }
        outS.coil = lerp(sw.sCoil, z.wu.coil, a); outS.crouch = lerp(sw.sCrouch, z.wu.crouch, a); outS.lean = lerp(sw.sLean, z.wu.lean, a);
        outS.offW = 0.45 * a; outS.mode = 1; outS.w = 0;
      } else if (!sw.contacted) {
        const w = sw.cd > 0 ? easeOut3((s - sw.tw) / sw.cd) : 1;
        outS.coil = lerp(z.wu.coil, z.ct.coil, w); outS.crouch = lerp(z.wu.crouch, z.ct.crouch, w); outS.lean = lerp(z.wu.lean, z.ct.lean, w);
        outS.offW = lerp(0.45, 1, w); outS.mode = 2; outS.w = w; outS.stretchOk = true;
        if (z.ct.l) { if (z.wu.l) outS.l.lerpVectors(z.wu.l, z.ct.l, w); else outS.l.copy(z.ct.l); outS.lThroat = z.wu.l ? 0 : 1 - w; } else { outS.l.copy(z.wu.l || LPOSE.ready); outS.lThroat = z.wu.l ? 0 : 1; }
        // h/q được tính sau khi biết thân (cần ma trận) – xem applySwingArms
      } else {
        const fT = 0.28, fa = fT * 0.45, ret = 0.2;
        const u = Math.max(0, s - Tc - HOLD);   // giữ tư thế chạm thêm một nhịp ngắn
        if (u < fa) {
          const f = smooth(u / fa);
          outS.h.lerpVectors(sw.ch, z.fo.h, f); outS.q.slerpQuaternions(sw.cq, z.fo.q, f);
          outS.l.lerpVectors(sw.cl, z.fo.l || LPOSE.ready, f);
          outS.coil = lerp(sw.cCoil, z.fo.coil, f); outS.crouch = lerp(sw.cCrouch, z.fo.crouch, f); outS.lean = lerp(sw.cLean, z.fo.lean, f);
          outS.roll = sw.cRoll * (1 - f);
          outS.offW = 1 - 0.35 * f; outS.mode = 3;
        } else {
          const r = smooth((u - fa) / (fT - fa + ret));
          outS.h.lerpVectors(z.fo.h, cur.h, r); outS.q.slerpQuaternions(z.fo.q, cur.q, r);
          _tmp.copy(z.fo.l || LPOSE.ready);
          outS.l.lerpVectors(_tmp, cur.l, r); outS.lThroat = cur.throatW * r;
          outS.coil = lerp(z.fo.coil, cur.coil, r); outS.crouch = lerp(z.fo.crouch, 0, r); outS.lean = lerp(z.fo.lean, cur.lean, r);
          outS.offW = 0.65 * (1 - r); outS.mode = 4;
          if (r >= 1) sw.active = false;
        }
      }
    }

    // ================================================================ update
    const EMPTY = { x: 0, z: 0, vx: 0, vz: 0, look: null, mode: 'ready', holdBall: false };
    function update(dt, s) {
      dt = clamp(dt || 0, 0, 0.1);
      s = s || EMPTY;
      time += dt;
      if (reactT > 0) { reactT -= dt; if (reactT <= 0) reactMode = null; }
      const mode = reactMode || s.mode || 'ready';
      if (mode !== lastMode) { if (mode === 'celebrate') celebT = 0; lastMode = mode; }
      const k = 1 - Math.exp(-dt * 10);

      // ---- vị trí + hướng
      root.position.set(s.x || 0, 0, s.z || 0);
      let yawT = 0;
      const look = s.look;
      if (look) {
        const dx = look.x - root.position.x, dz = look.z - root.position.z;
        const cb = Math.cos(baseYaw), sb = Math.sin(baseYaw);
        const lx = cb * dx - sb * dz, lz = sb * dx + cb * dz;
        if (lx * lx + lz * lz > 0.04) yawT = clamp(Math.atan2(lx, Math.max(lz, 0.25)), -0.5, 0.5);
      }
      if (mode === 'sad') yawT *= 0.3;
      yawOff = damp(yawOff, yawT, 7, dt);
      if (mode === 'celebrate') { celebT += dt; spinA = celebT < 0.85 ? smooth(celebT / 0.85) * Math.PI * 2 : 0; } else spinA = 0;
      root.rotation.y = baseYaw + yawOff + spinA;

      // ---- vận tốc cục bộ
      const vx = s.vx || 0, vz = s.vz || 0, speed = Math.hypot(vx, vz);
      const th = root.rotation.y, ct = Math.cos(th), sn = Math.sin(th);
      const lvx = ct * vx - sn * vz, lvz = sn * vx + ct * vz;
      locoAmp = damp(locoAmp, clamp((speed - 0.15) / 2.6, 0, 1), 10, dt);
      if (speed > 0.2) { mv.x = damp(mv.x, lvx / speed, 12, dt); mv.y = damp(mv.y, lvz / speed, 12, dt); const ml = Math.hypot(mv.x, mv.y) || 1; mv.x /= ml; mv.y /= ml; }
      shufW = damp(shufW, Math.abs(mv.x) > 0.6 && mode !== 'idle' ? 1 : 0, 8, dt);
      phase += dt * (7.5 + 1.9 * Math.min(speed, 6)) * (locoAmp > 0.02 ? 1 : 0);

      // ---- tư thế nền theo chế độ
      let P = POSE.ready, L = LPOSE.ready, hipsY = 0.375, stance = 0.165, stagger = 0.0, coil = 0, lean = 0.07, throatW = 1, headP = 0;
      if (mode === 'idle') { P = POSE.idle; L = LPOSE.idle; hipsY = 0.41; stance = 0.11; lean = 0; throatW = 0; }
      else if (mode === 'serve') { P = POSE.serve; L = s.holdBall ? LPOSE.hold : LPOSE.serve; hipsY = 0.395; stance = 0.15; stagger = 0.07; coil = -0.12; lean = 0.05; throatW = 0; }
      else if (mode === 'celebrate') { P = POSE.celeb; L = LPOSE.celeb; hipsY = 0.41; stance = 0.12; lean = -0.05; throatW = 0; headP = -0.2; }
      else if (mode === 'sad') { P = POSE.sad; L = LPOSE.sad; hipsY = 0.39; stance = 0.1; lean = 0.2; throatW = 0; headP = 0.2; }
      cur.h.lerp(P.h, k); cur.q.slerp(P.q, k); cur.l.lerp(L, k);
      cur.hipsY = lerp(cur.hipsY, hipsY, k); cur.stance = lerp(cur.stance, stance, k); cur.stagger = lerp(cur.stagger, stagger, k);
      cur.coil = lerp(cur.coil, coil, k); cur.lean = lerp(cur.lean, lean, k); cur.throatW = lerp(cur.throatW, throatW, k);
      cur.headPitch = lerp(cur.headPitch, headP, k * 0.7);
      cur.sad = lerp(cur.sad, mode === 'sad' ? 1 : 0, k * 0.6);
      cur.mood = mode === 'celebrate' ? 1 : 0;
      cur.leanV = damp(cur.leanV, clamp(0.05 * lvz, -0.2, 0.28), 8, dt);
      cur.rollV = damp(cur.rollV, clamp(-0.05 * lvx, -0.2, 0.2), 8, dt);

      // ---- cú vung
      let aH = cur.h, aQ = cur.q, aL = cur.l, aLW = cur.throatW, aCoil = cur.coil, aCrouch = 0, aLean = cur.lean, offW = 0, swingRoll = 0;
      let contactNow = false;
      if (sw.active) {
        // khung gọi swing() rồi update() ngay: thời điểm hiện tại = 0 (không cộng dt)
        if (sw.skip) sw.skip = false; else sw.t += dt;
        if (!sw.contacted && sw.t >= sw.T) { sw.t = sw.T; contactNow = true; }  // khóa đúng khung chạm
        evalSwing(dt);
        if (!sw.active) { /* vừa kết thúc */ }
        else {
          aCoil = outS.coil; aCrouch = outS.crouch; aLean = outS.lean; offW = outS.offW; swingRoll = outS.roll;
          aL = outS.l; aLW = outS.lThroat;
          if (outS.mode !== 2) { aH = outS.h; aQ = outS.q; }
        }
      }

      // ---- hông / thân
      let bob = 0, hop = 0, squash = 0, lungeW = 0;
      bob = 0.035 * locoAmp * Math.abs(Math.sin(phase));
      if (splitT >= 0) {
        splitT += dt;
        if (splitT < 0.1) hop = Math.sin(splitT / 0.1 * Math.PI / 2) * 0.07;
        else if (splitT < 0.26) { const q = Math.sin((splitT - 0.1) / 0.16 * Math.PI); squash = 0.12 * q; hop = -0.05 * q; }
        else splitT = -1;
      }
      if (mode === 'celebrate') hop += Math.abs(Math.sin(celebT * Math.PI / 0.5)) * 0.16;
      if (lungeT >= 0) {
        lungeT += dt;
        lungeW = lungeT < 0.3 ? smooth(lungeT / 0.16) : 1 - smooth((lungeT - 0.3) / 0.3);
        if (lungeT > 0.6) { lungeT = -1; lungeW = 0; }
      }
      const breathe = Math.sin(time * 2.4) * 0.012 * (1 - locoAmp);
      const sqY = 1 - squash + breathe, sqXZ = 1 + squash * 0.5 - breathe * 0.5;
      chest.scale.set(sqXZ, sqY, sqXZ);
      const shY = SH_Y * (1 - squash * 0.6);
      armR.sh.position.y = shY; armL.sh.position.y = shY;

      hips.position.set(lungeDir.x * 0.22 * lungeW, cur.hipsY - aCrouch + bob + hop - 0.11 * lungeW, lungeDir.y * 0.22 * lungeW);
      const totalCoil = aCoil;
      hips.rotation.set(0, totalCoil * 0.35, 0);
      let pitch = aLean + cur.leanV + lungeW * 0.45 * lungeDir.y + cur.sad * 0.05;
      let roll = cur.rollV - lungeW * 0.45 * lungeDir.x + swingRoll;
      // nghiêng về phía điểm chạm
      if (sw.active && outS.mode === 2) {
        if (sw.hasC) toRootLocal(sw.C, _tmp); else _tmp.copy(sw.z.def);
        sw.liveRoll = clamp(-_tmp.x * 0.12, -0.18, 0.18) * outS.w;
        roll += sw.liveRoll;
        pitch += clamp((_tmp.z - 0.35) * 0.12, -0.05, 0.15) * outS.w;
      }
      torso.rotation.set(clamp(pitch, -0.35, 0.6), totalCoil * 0.65, clamp(roll, -0.45, 0.45));
      torsoMatrices();

      // ---- tay phải (IK chạm hoặc theo tư thế)
      let stretchAllowed = 1;
      if (sw.active && (outS.mode === 1 || outS.mode === 2)) {
        const qRoot = contactTargets(shY);
        // dịch thân về phía bóng (khung root)
        hips.position.addScaledVector(sw.off, offW);
        torsoMatrices();
        if (outS.mode === 2) {
          // chuyển mục tiêu sang khung torso
          _hR.copy(_H).applyMatrix4(_Mi);
          _qR.multiplyQuaternions(_Qti, qRoot);
          // giữ liên tục mặt vợt (không lật cổ tay)
          _tmp.copy(ZAX).applyQuaternion(_qR); _tmp2.copy(ZAX).applyQuaternion(sw.z.wu.q);
          if (_tmp.dot(_tmp2) < 0) _qR.multiply(QFLIP);
          outS.h.lerpVectors(sw.z.wu.h, _hR, outS.w);
          outS.q.slerpQuaternions(sw.z.wu.q, _qR, outS.w);
          aH = outS.h; aQ = outS.q;
          stretchAllowed = 1 + (MAX_STRETCH - 1) * outS.w;
        }
      } else if (sw.active && sw.contacted && offW > 0) {
        hips.position.addScaledVector(sw.cOff, offW);
        torsoMatrices();
      }

      // tay phải chạy: lắc nhẹ
      _hR.copy(aH);
      if (!sw.active) {
        const swingAmt = (mode === 'idle' || mode === 'sad') ? 0.13 : 0.035;
        _hR.z += Math.sin(phase) * swingAmt * locoAmp * (mode === 'idle' ? -1 : 1);
        _hR.y += Math.cos(phase * 2) * 0.012 * locoAmp;
      }
      _J.set(-SH_X, shY, 0);
      stretchR = solve2(_J, _hR, UPPER, FORE, POLE_R, armR.up.quaternion, armR.fo.quaternion, stretchAllowed);
      setArmStretch(armR, stretchR);
      // cổ tay: qw = (qU qL)^-1 * Qpad * QGRIP^-1
      _qa.multiplyQuaternions(armR.up.quaternion, armR.fo.quaternion).invert();
      armR.hand.quaternion.copy(_qa).multiply(aQ).multiply(QGRIP_INV);

      // ---- tay trái
      _hL.copy(aL);
      if (aLW > 0.001) {
        // điểm cổ vợt trong khung torso
        _tmp.set(0, THROAT_P, 0).applyQuaternion(aQ).add(_hR);
        _tmp.x += 0.055; _tmp.y -= 0.01; _tmp.z += 0.01;
        _hL.lerp(_tmp, clamp(aLW, 0, 1));
      }
      if (!sw.active) _hL.z -= Math.sin(phase) * 0.14 * locoAmp;
      if (mode === 'celebrate') _hL.y += Math.sin(celebT * 9) * 0.03;
      _J.set(SH_X, shY, 0);
      solve2(_J, _hL, UPPER, FORE, POLE_L, armL.up.quaternion, armL.fo.quaternion, 1);

      // ---- lưu trạng thái chạm
      if (contactNow) {
        sw.contacted = true;
        sw.ch.copy(aH); sw.cq.copy(aQ); sw.cl.copy(_hL);
        sw.cCoil = aCoil; sw.cCrouch = aCrouch; sw.cLean = aLean; sw.cOff.copy(sw.off); sw.cRoll = sw.liveRoll;
      }
      last.h.copy(aH); last.q.copy(aQ); last.l.copy(_hL); last.coil = aCoil; last.crouch = aCrouch; last.lean = aLean; last.lw = 0;

      // ---- chân (IK, bàn chân bám sân)
      hips.updateMatrix();
      _Mh.copy(hips.matrix).invert();
      _qb.copy(hips.quaternion).invert();
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1, leg = i === 0 ? legR : legL;
        const ph = phase + (i === 0 ? 0 : Math.PI * (1 - 0.55 * shufW));
        const sw_ = Math.sin(ph), lift = Math.max(0, Math.cos(ph));
        let fx = side * cur.stance + mv.x * 0.17 * sw_ * locoAmp;
        let fz = (side > 0 ? cur.stagger : -cur.stagger * 0.6) + mv.y * 0.17 * sw_ * locoAmp;
        let fy = ANKLE + lift * 0.085 * locoAmp + Math.max(0, hop) * 0.9;
        // bước theo hướng dịch thân / lunge
        if (offW > 0) {
          const ox = sw.active && sw.contacted ? sw.cOff.x : sw.off.x, oz = sw.active && sw.contacted ? sw.cOff.z : sw.off.z;
          const leadSide = ox < 0 ? -1 : 1;                 // chân phía bóng bước nhiều hơn
          const f = side === leadSide ? 1.0 : 0.35;
          fx += ox * offW * f; fz += oz * offW * f;
        }
        if (lungeW > 0) {
          const leadSide = lungeDir.x < -0.2 ? -1 : lungeDir.x > 0.2 ? 1 : -1;
          const f = side === leadSide ? 0.62 : 0.12;
          fx += lungeDir.x * f * lungeW; fz += lungeDir.y * f * lungeW;
        }
        // bật nhảy / nhón: chân không với tới sân thì nhấc lên, gối hơi co
        const hipY = hips.position.y + HIP_JY, reachY = (THIGH + SHIN) * 0.93;
        if (hipY - fy > reachY) fy = hipY - reachY;
        _foot.set(fx, fy, fz).applyMatrix4(_Mh);
        _J.set(side * HIP_JX, HIP_JY, 0);
        solve2(_J, _foot, THIGH, SHIN, side < 0 ? POLE_LEG_R : POLE_LEG_L, leg.th.quaternion, leg.sn.quaternion, 1);
        // giày song song mặt sân, mũi hơi chĩa ra; nhấc mũi khi bước
        _q2.setFromAxisAngle(UP, side * -0.12);
        _qa.setFromAxisAngle(XAX, -lift * 0.35 * locoAmp);
        _q2.multiply(_qa);
        // shoe_local = (hipsQ thQ snQ)^-1 * qFoot
        _qc.multiplyQuaternions(hips.quaternion, leg.th.quaternion).multiply(leg.sn.quaternion).invert();
        leg.shoe.quaternion.copy(_qc).multiply(_q2);
      }

      // ---- đầu, mắt, tai
      let nYaw = 0, nPitch = cur.headPitch;
      let lookPt = null;
      if (sw.active && outS.mode <= 2) lookPt = sw.hasC ? sw.C : null;
      if (!lookPt && look) lookPt = look;
      if (lookPt) {
        toRootLocal(lookPt, _tmp);
        const hy = 1.1;
        const ang = Math.atan2(_tmp.x, Math.max(_tmp.z, 0.2)) - totalCoil;
        nYaw = clamp(ang * 0.6, -0.35, 0.35);
        const hd = Math.hypot(_tmp.x, _tmp.z);
        nPitch += clamp(-Math.atan2(_tmp.y - hy, Math.max(hd, 0.3)) * 0.45, -0.3, 0.3) * (1 - cur.sad);
        faceDir.du = damp(faceDir.du, clamp(ang - nYaw, -0.16, 0.16), 14, dt);
        faceDir.dv = damp(faceDir.dv, clamp(Math.atan2(_tmp.y - hy, Math.max(hd, 0.3)) * 0.6 + nPitch * 0.3, -0.1, 0.1), 14, dt);
      } else {
        faceDir.du = damp(faceDir.du, 0, 6, dt); faceDir.dv = damp(faceDir.dv, cur.sad * -0.08, 6, dt);
      }
      neck.rotation.set(nPitch - pitch * 0.4 + Math.sin(time * 2.4) * 0.015, nYaw, -roll * 0.3 + Math.sin(time * 1.3) * 0.02 * (1 - locoAmp));
      // chớp mắt
      blinkT -= dt;
      if (blinkT <= 0 && blinkP < 0) { blinkP = 0; blinkT = 2 + Math.random() * 3.5; }
      let lid = 1;
      if (blinkP >= 0) { blinkP += dt; lid = 1 - 0.88 * Math.sin(Math.min(1, blinkP / 0.12) * Math.PI); if (blinkP >= 0.12) blinkP = -1; }
      lid *= 1 - cur.sad * 0.42;
      face.update(faceDir.du, faceDir.dv, lid, cur.mood, cur.sad, time);
      // tai ve vẩy
      earT -= dt;
      if (earT <= 0 && earP < 0) { earP = 0; earT = 2.5 + Math.random() * 4; }
      let wig = 0;
      if (earP >= 0) { earP += dt; wig = Math.sin(earP * 28) * Math.exp(-earP * 5); if (earP > 0.7) earP = -1; }
      face.ears(wig, locoAmp * Math.sin(phase * 2) + hop * 2, cur.sad);
      if (tail) tail.update(time, locoAmp, phase, mode === 'celebrate');
      if (accObj) accObj.update(time);

      root.updateMatrixWorld(true);
    }

    // ================================================================ API
    function swing(o) {
      o = o || {};
      const zone = ZONES[o.zone] ? o.zone : 'forehand';
      sw.active = true; sw.zone = zone; sw.z = ZONES[zone];
      const Tc = Math.max(0.02, Math.min(1.5, +o.timeToContact || 0.25));
      sw.T = Tc; sw.cd = Math.min(0.09, Tc * 0.6); sw.tw = Tc - sw.cd; sw.t = 0;
      sw.hasC = !!o.contact; sw.contacted = false; sw.skip = true;
      if (o.contact) sw.C.set(o.contact.x, o.contact.y, o.contact.z);
      sw.sh.copy(last.h); sw.sq.copy(last.q); sw.sl.copy(last.l);
      sw.sCoil = last.coil; sw.sCrouch = last.crouch; sw.sLean = last.lean; sw.sLW = cur.throatW;
      sw.off.set(0, 0, 0); sw.liveRoll = 0;
    }
    function splitStep() { splitT = 0; }
    function lunge(dx, dz) {
      const th = root.rotation.y, c = Math.cos(th), s = Math.sin(th);
      let lx = c * (dx || 0) - s * (dz || 0), lz = s * (dx || 0) + c * (dz || 0);
      const l = Math.hypot(lx, lz);
      if (l < 1e-4) { lx = 0; lz = 1; } else { lx /= l; lz /= l; }
      lungeDir.set(lx, lz); lungeT = 0;
    }
    function react(kind) { if (kind === 'celebrate' || kind === 'sad') { reactMode = kind; reactT = 1.8; if (kind === 'celebrate') celebT = 0; lastMode = kind; } }
    function getPaddleFaceWorld(out) { out = out || new T.Vector3(); return out.setFromMatrixPosition(faceMarker.matrixWorld); }
    function getHandWorld(which, out) {
      out = out || new T.Vector3();
      if (which === 'L') { out.setFromMatrixPosition(armL.hand.matrixWorld); out.y += 0.088; return out; }
      return out.setFromMatrixPosition(armR.hand.matrixWorld);
    }
    function setHighlight(c) {
      if (c == null || c === false) { ring.visible = false; ringFill.visible = false; return; }
      ringMat.color.set(c).convertSRGBToLinear(); ringFill.material.color.copy(ringMat.color); ring.visible = true; ringFill.visible = true;
    }
    function dispose() {
      if (root.parent) root.parent.remove(root);
      ringMat.dispose(); ringFill.material.dispose();
    }

    update(0, { x: 0, z: 0, mode: 'ready' });
    return { root, update, swing, splitStep, lunge, react, getPaddleFaceWorld, getHandWorld, setHighlight, dispose, id, team };
  }

  // ------------------------------------------------------------------ khuôn mặt + đặc điểm loài
  function buildFace(head, kind, st, def, M) {
    const eyes = [], blushes = [], happy = [];
    let eyeR = HR, eyeC = null, eyeU = 0.29, eyeV = -0.04, eyeLift = st.eyeLift || 0.002;
    const earGroups = [];
    const frog = kind === 'frog';
    if (kind === 'dino' || kind === 'elephant') eyeV = 0.0;
    if (kind === 'capybara') { eyeU = 0.36; eyeV = 0.07; }
    if (kind === 'seal') { eyeU = 0.3; eyeV = -0.01; }
    if (kind === 'monkey') eyeU = 0.25;
    const lidBase = st.lidBase || 1;
    const furC = def.body;
    const bumps = [];
    if (frog) {
      for (const s of [-1, 1]) {
        const b = group(head); placeOn(b, HR, null, s * 0.4, 0.62, -0.03);
        const bm = mesh(sph(28), M.mFur, head, b.position.x, b.position.y, b.position.z, 0.125, 0.12, 0.12);
        bumps.push(bm.position.clone());
        head.remove(b);
      }
      eyeR = [0.125, 0.12, 0.12]; eyeU = 0.0; eyeV = 0.12;
    }
    // mặt nạ / mảng màu sau mắt
    if (kind === 'penguin') {
      for (const s of [-1, 1]) { const m = group(head); placeOn(m, HR, null, s * 0.19, -0.02, -0.035); mesh(sph(28), M.mWhite, m, 0, 0, 0, 0.15, 0.17, 0.06); }
      const chin = group(head); placeOn(chin, HR, null, 0, -0.32, -0.04); mesh(sph(24), M.mWhite, chin, 0, 0, 0, 0.17, 0.11, 0.06);
    }
    if (kind === 'panda') {
      for (const s of [-1, 1]) { const m = group(head); placeOn(m, HR, null, s * 0.3, -0.07, -0.012); const pm = mesh(sph(24), mat(0x2a2a30, { r: 0.75 }), m, 0, 0, 0, 0.088, 0.108, 0.03); pm.rotation.z = s * 0.55; }
    }
    if (kind === 'monkey') {   // mặt sáng hình trái tim
      for (const s of [-1, 1]) { const m = group(head); placeOn(m, HR, null, s * 0.17, 0.0, -0.05); mesh(sph(28), M.mBelly, m, 0, 0, 0, 0.16, 0.17, 0.07); }
    }
    if (kind === 'raccoon') {  // mặt nạ + lông mày trắng
      const mk = mat(st.mask || 0x3a3b48, { r: 0.8 });
      for (const s of [-1, 1]) {
        const m = group(head); placeOn(m, HR, null, s * 0.25, -0.05, -0.03); const pm = mesh(sph(24), mk, m, 0, 0, 0, 0.15, 0.085, 0.05); pm.rotation.z = s * 0.28;
        const b = group(head); placeOn(b, HR, null, s * 0.24, 0.15, -0.012); const bm = mesh(sph(16), M.mWhite, b, 0, 0, 0, 0.085, 0.034, 0.02); bm.rotation.z = -s * 0.15;
      }
      const br = group(head); placeOn(br, HR, null, 0, -0.04, -0.03); mesh(sph(16), mk, br, 0, 0, 0, 0.08, 0.05, 0.045);
    }
    if (kind === 'sloth') {    // mặt sáng + quầng mắt rủ xuống
      const fm = group(head); placeOn(fm, HR, null, 0, -0.1, -0.075); mesh(sph(32), M.mBelly, fm, 0, 0, 0, 0.27, 0.22, 0.1);
      const pk = mat(st.patch || 0x5c4535, { r: 0.8 });
      for (const s of [-1, 1]) { const m = group(head); placeOn(m, HR, null, s * 0.3, -0.09, 0.012); const pm = mesh(sph(24), pk, m, s * 0.012, -0.012, 0, 0.1, 0.058, 0.03); pm.rotation.z = s * 0.42; }
    }
    if (kind === 'deer' || kind === 'seal' || kind === 'turtle') {  // đốm
      const spotM = kind === 'deer' ? M.mWhite : mat(shade(furC, -0.16), { r: 0.8 });
      const spots = kind === 'deer' ? [[2.5, 0.35, 0.03], [2.85, 0.6, 0.026], [-2.6, 0.45, 0.03], [-2.95, 0.2, 0.024], [3.14, 0.05, 0.028], [1.9, 0.55, 0.022], [-1.95, 0.6, 0.022]]
        : kind === 'seal' ? [[0.6, 0.75, 0.03], [-0.9, 0.9, 0.024], [2.2, 0.5, 0.035], [-2.5, 0.3, 0.03], [3.0, 0.75, 0.026]]
          : [[0.0, 0.95, 0.05], [0.9, 0.7, 0.035], [-0.9, 0.7, 0.035], [2.6, 0.5, 0.04], [-2.6, 0.5, 0.04]];
      for (const [u, v, r] of spots) { const m = group(head); placeOn(m, HR, null, u, v, -0.004); mesh(sph(12), spotM, m, 0, 0, 0, r, r, 0.012).castShadow = false; }
    }
    // mắt
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const eg = new T.Group(); head.add(eg);
      const inner = group(eg);
      const ef = st.eyes === 'big' ? 1.22 : st.eyes === 'small' ? 0.72 : 1;
      if (st.eyes === 'iris') {
        mesh(sph(24), mat(st.iris, { r: 0.3 }), inner, 0, 0, 0, 0.056, 0.07, 0.024);
        mesh(sph(16), M.mEye, inner, 0, -0.002, 0.008, 0.027, 0.056, 0.024);
      } else if (st.eyes === 'ring') {
        mesh(sph(24), M.mWhite, inner, 0, 0, -0.002, 0.058, 0.07, 0.022);
        mesh(sph(24), M.mEye, inner, 0, -0.004, 0.004, 0.044, 0.056, 0.024);
      } else {
        mesh(sph(24), M.mEye, inner, 0, 0, 0, frog ? 0.045 : 0.05 * ef, frog ? 0.058 : 0.068 * ef, 0.026);
        if (st.eyes === 'lash') for (let j = 0; j < 2; j++) {
          const l = mesh(cyl(0.005, 0.004, 0.032, 5), M.mEye, inner, s * (0.04 + j * 0.012), 0.05 - j * 0.016, 0.004); l.rotation.z = -s * (0.75 + j * 0.45);
        }
      }
      mesh(sph(10), M.mHi, inner, -0.016 * ef, 0.024 * ef, 0.022, 0.017 * ef, 0.017 * ef, 0.012);
      mesh(sph(8), M.mHi, inner, 0.015 * ef, -0.019 * ef, 0.022, 0.008 * ef, 0.008 * ef, 0.006);
      if (st.eyes === 'big') mesh(sph(8), M.mHi, inner, 0.02, 0.03, 0.022, 0.007, 0.007, 0.005);
      inner.traverse((o) => { o.castShadow = false; });
      // mắt cười ^ ^
      const hp = mesh(torus(0.036 * (st.eyes === 'small' ? 0.8 : 1), 0.011, Math.PI, 6, 14), (st.eyes === 'ring' && kind !== 'panda') ? M.mWhite : M.mEye, eg, 0, -0.01, 0.012); hp.visible = false; hp.castShadow = false;
      eyes.push({ g: eg, inner, s, c: frog ? bumps[i] : null });
      happy.push(hp);
    }
    // má hồng
    for (const s of [-1, 1]) {
      const b = group(head); placeOn(b, HR, null, s * (frog ? 0.5 : 0.6), frog ? -0.18 : -0.24, 0.001);
      const bm = mesh(sph(20), M.mBlush, b, 0, 0, 0, 0.062, 0.04, 0.012); bm.castShadow = false; bm.renderOrder = 2;
      blushes.push(b);
    }
    // mũi / miệng / mõm
    const mouthG = new T.Group(); head.add(mouthG);
    let mouthSmile, mouthOpen;
    function addMouth(parent, x, y, z, r) {
      const g = group(parent, x, y, z);
      const w = st.whiskers || kind === 'bunny' || kind === 'cat';
      const smile = new T.Group(); g.add(smile);
      if (w) {
        for (const sx of [-1, 1]) { const a = mesh(torus(r * 0.55, 0.0075, Math.PI, 6, 12), M.mDark, smile, sx * r * 0.55, 0, 0); a.rotation.z = Math.PI; a.castShadow = false; }
      } else { const a = mesh(torus(r, 0.008, Math.PI, 6, 16), M.mDark, smile, 0, 0, 0); a.rotation.z = Math.PI; a.castShadow = false; }
      const open = group(g, 0, -r * 0.35, 0);
      const om = mesh(sph(16), mat(0x7a2433, { r: 0.6 }), open, 0, 0, 0, r * 1.1, r * 0.95, 0.012); om.castShadow = false;
      const tg = mesh(sph(12), mat(0xff7f96, { r: 0.6 }), open, 0, -r * 0.4, 0.004, r * 0.65, r * 0.4, 0.01); tg.castShadow = false;
      open.visible = false;
      mouthSmile = smile; mouthOpen = open;
      return g;
    }
    if (kind === 'pig') {
      const sn = group(head); placeOn(sn, HR, null, 0, -0.2, -0.015);
      const c = mesh(cyl(0.078, 0.082, 0.07, 24), mat(st.inner, { r: 0.65 }), sn, 0, 0, 0.02); c.rotation.x = Math.PI / 2; c.scale.set(1, 1, 0.78);
      for (const sx of [-1, 1]) { const n = mesh(sph(12), mat(0xd9577a, { r: 0.6 }), sn, sx * 0.026, 0, 0.056, 0.014, 0.022, 0.006); n.castShadow = false; }
      placeOn(mouthG, HR, null, 0, -0.42, 0.0); addMouth(mouthG, 0, 0, 0, 0.03);
    } else if (kind === 'penguin') {
      const bk = group(head); placeOn(bk, HR, null, 0, -0.17, -0.01);
      const up = mesh(cone(0.05, 0.11, 16), mat(0xffa630, { r: 0.45 }), bk, 0, 0.008, 0.05); up.rotation.x = Math.PI / 2; up.scale.set(1.25, 1, 0.75);
      placeOn(mouthG, HR, null, 0, -0.34, 0.0); addMouth(mouthG, 0, 0, 0, 0.022);
      mouthSmile.visible = false;
    } else if (kind === 'frog') {
      placeOn(mouthG, HR, null, 0, -0.2, 0.0);
      const g = group(mouthG); const a = mesh(torus(0.11, 0.009, Math.PI * 0.8, 6, 24), M.mDark, g, 0, 0.05, 0); a.rotation.z = Math.PI + Math.PI * 0.1; a.castShadow = false;
      mouthSmile = g;
      const open = group(mouthG, 0, -0.03, 0); const om = mesh(sph(16), mat(0x7a2433, { r: 0.6 }), open, 0, 0, 0, 0.07, 0.04, 0.012); om.castShadow = false; open.visible = false; mouthOpen = open;
      for (const sx of [-1, 1]) { const n = group(head); placeOn(n, HR, null, sx * 0.05, -0.06, 0.0); mesh(sph(8), M.mDark, n, 0, 0, 0, 0.01, 0.008, 0.005).castShadow = false; }
    } else if (kind === 'elephant') {
      // vòi cong, đầu vòi hồng
      const tg = group(head); placeOn(tg, HR, null, 0, -0.1, -0.03);
      const curve = new T.CatmullRomCurve3([new T.Vector3(0, 0.02, -0.04), new T.Vector3(0, -0.04, 0.06), new T.Vector3(0, -0.13, 0.11), new T.Vector3(0, -0.2, 0.15), new T.Vector3(0, -0.21, 0.21), new T.Vector3(0, -0.16, 0.25)]);
      mesh(geo('trunk', () => taperTube(curve, 28, 10, 0.072, 0.04)), M.mFur, tg, 0, 0, 0);
      const tipP = curve.getPoint(1), tipT = curve.getTangent(1);
      const tip = mesh(torus(0.033, 0.012, 0, 8, 18), M.mInner, tg, tipP.x, tipP.y, tipP.z);
      tip.quaternion.setFromUnitVectors(ZAX, tipT);
      for (let j = 1; j <= 3; j++) { const q = curve.getPoint(0.18 + j * 0.13); const rg = mesh(torus(0.06 - j * 0.006, 0.004, Math.PI, 5, 12), mat(shade(furC, -0.15), { r: 0.8 }), tg, q.x, q.y, q.z); rg.quaternion.setFromUnitVectors(ZAX, curve.getTangent(0.18 + j * 0.13)); rg.rotateZ(Math.PI * 0.0); rg.castShadow = false; }
      placeOn(mouthG, HR, null, 0.17, -0.36, 0.0); addMouth(mouthG, 0, 0, 0, 0.022);
    } else if (kind === 'capybara') {
      // mõm vuông to
      const mz = group(head); placeOn(mz, HR, null, 0, -0.25, -0.12);
      mesh(geo('squircle', () => superSphere(0.5, 0.75)), M.mBelly, mz, 0, 0, 0, 0.165, 0.118, 0.18);
      const nm = mat(st.nose || 0x3a2618, { r: 0.35 });
      mesh(geo('squircleN', () => superSphere(0.6, 0.8)), nm, mz, 0, 0.058, 0.142, 0.068, 0.03, 0.04).castShadow = false;
      for (const sx of [-1, 1]) mesh(sph(8), mat(0x1a120c, { r: 0.4 }), mz, sx * 0.03, 0.055, 0.18, 0.011, 0.009, 0.006).castShadow = false;
      addMouth(mz, 0, -0.025, 0.18, 0.028);
    } else if (kind === 'seal') {
      // đệm ria trắng + mũi đen
      const mz = group(head); placeOn(mz, HR, null, 0, -0.24, -0.03);
      for (const sx of [-1, 1]) mesh(sph(24), M.mBelly, mz, sx * 0.055, 0, 0.02, 0.07, 0.058, 0.055);
      const n = mesh(sph(16), mat(st.nose || 0x22262e, { r: 0.25 }), mz, 0, 0.05, 0.068, 0.034, 0.024, 0.022); n.castShadow = false;
      mesh(sph(8), M.mHi, mz, -0.01, 0.06, 0.088, 0.008, 0.005, 0.003).castShadow = false;
      for (const sx of [-1, 1]) for (let j = 0; j < 3; j++) mesh(sph(6), mat(shade(0xffffff, -0.35), { r: 0.6 }), mz, sx * (0.04 + j * 0.022), 0.005 - (j % 2) * 0.018, 0.072 - j * 0.006, 0.006, 0.006, 0.004).castShadow = false;
      addMouth(mz, 0, -0.05, 0.05, 0.022);
    } else if (st.muzzle) {
      const big = kind === 'dino';
      const mz = group(head); placeOn(mz, HR, null, 0, big ? -0.34 : -0.27, big ? -0.05 : -0.045);
      mesh(sph(28), M.mBelly, mz, 0, 0, 0, big ? 0.18 : (kind === 'cat' ? 0.1 : 0.135), big ? 0.1 : (kind === 'cat' ? 0.075 : 0.095), big ? 0.115 : 0.09);
      if (big) {
        for (const sx of [-1, 1]) mesh(sph(8), M.mDark, mz, sx * 0.045, 0.045, 0.11, 0.012, 0.009, 0.006).castShadow = false;
        addMouth(mz, 0, -0.01, 0.112, 0.05);
      } else {
        const nose = mesh(sph(16), mat(st.nose || 0x2a1a14, { r: 0.3 }), mz, 0, 0.035, kind === 'cat' ? 0.075 : 0.085, kind === 'cat' ? 0.022 : 0.034, kind === 'cat' ? 0.016 : 0.023, 0.02);
        nose.castShadow = false;
        mesh(sph(8), M.mHi, mz, -0.008, 0.045, kind === 'cat' ? 0.09 : 0.104, 0.007, 0.005, 0.003).castShadow = false;
        addMouth(mz, 0, -0.012, kind === 'cat' ? 0.075 : 0.085, 0.026);
      }
    } else {
      const ns = group(head); placeOn(ns, HR, null, 0, -0.17, 0.0);
      mesh(sph(14), mat(st.nose || 0x3a2a30, { r: 0.35 }), ns, 0, 0, 0, 0.024, 0.017, 0.012).castShadow = false;
      placeOn(mouthG, HR, null, 0, -0.27, 0.0); addMouth(mouthG, 0, 0, 0, 0.026);
    }
    if (st.whiskers) {
      const seal = kind === 'seal';
      for (const s of [-1, 1]) for (let j = 0; j < (seal ? 3 : 2); j++) {
        const wg = group(head); placeOn(wg, HR, null, s * (seal ? 0.3 : 0.42), (seal ? -0.22 : -0.2) - j * (seal ? 0.045 : 0.07), seal ? 0.03 : 0.0);
        const w = mesh(cyl(0.0035, 0.0035, seal ? 0.15 : 0.13, 5), seal ? mat(0xf4f4f4, { r: 0.5 }) : M.mWhite, wg, s * 0.05, 0, 0.0); w.rotation.z = Math.PI / 2 + s * (seal ? 0.15 - j * 0.15 : (j ? -0.15 : 0.12)); w.castShadow = false;
      }
    }

    // tai
    function earPivot(u, v, lift) { const g = group(head); surfPoint(HR, u, v, _p, _n); g.position.copy(_p).addScaledVector(_n, lift); return g; }
    if (kind === 'long') {
      for (const s of [-1, 1]) {
        const g = earPivot(s * 0.3, 1.02, -0.03); g.rotation.set(-0.12, 0, -s * 0.16);
        mesh(caps(0.06, 0.26), M.mFur, g, 0, 0.17, 0, 1, 1, 0.55);
        mesh(caps(0.036, 0.2), M.mInner, g, 0, 0.18, 0.026, 1, 1, 0.35).castShadow = false;
        earGroups.push({ g, s, bx: -0.12, bz: -s * 0.16, amp: 1 });
      }
    } else if (kind === 'round' || kind === 'panda') {
      const em = kind === 'panda' ? mat(0x2a2a30, { r: 0.75 }) : M.mFur;
      for (const s of [-1, 1]) {
        const g = earPivot(s * 0.64, 0.76, 0.0); g.rotation.set(0, 0, -s * 0.5);
        mesh(sph(24), em, g, 0, 0.03, 0, 0.1, 0.1, 0.06);
        if (kind === 'round') mesh(sph(18), M.mInner, g, 0, 0.03, 0.035, 0.062, 0.062, 0.03).castShadow = false;
        earGroups.push({ g, s, bx: 0, bz: -s * 0.5, amp: 0.35 });
      }
    } else if (kind === 'tri' || kind === 'fox' || kind === 'pig' || kind === 'raccoon') {
      for (const s of [-1, 1]) {
        const isFox = kind === 'fox' || kind === 'raccoon', isPig = kind === 'pig';
        const g = earPivot(s * (isPig ? 0.55 : 0.5), isPig ? 0.78 : 0.86, -0.02);
        const bx = isPig ? 0.55 : -0.05, bz = -s * (isPig ? 0.55 : 0.32);
        g.rotation.set(bx, 0, bz);
        const rac = kind === 'raccoon';
        const r = rac ? 0.1 : isFox ? 0.11 : isPig ? 0.08 : 0.098, h = rac ? 0.16 : isFox ? 0.22 : isPig ? 0.12 : 0.17;
        mesh(cone(r, h, 16), M.mFur, g, 0, h / 2, 0, 1, 1, 0.5);
        mesh(cone(r * 0.6, h * 0.72, 12), isFox ? M.mBelly : M.mInner, g, 0, h * 0.42, r * 0.22, 1, 1, 0.3).castShadow = false;
        if (isFox) mesh(cone(r * 0.42, h * 0.3, 12), mat(rac ? (st.mask || 0x3a3b48) : (def.accent || 0x5a2e14), { r: 0.75 }), g, 0, h * 0.86, 0, 1, 1, 0.55);
        earGroups.push({ g, s, bx, bz, amp: isPig ? 0.6 : 0.5 });
      }
    } else if (kind === 'monkey' || kind === 'elephant') {
      const el = kind === 'elephant';
      for (const s of [-1, 1]) {
        const g = earPivot(s * (el ? 1.28 : 1.42), el ? 0.12 : 0.1, -0.03); g.rotation.set(0, s * (el ? 0.8 : 0.85), 0);
        if (el) {
          mesh(sph(28), M.mFur, g, s * 0.15, -0.03, 0, 0.19, 0.23, 0.04);
          mesh(sph(24), M.mInner, g, s * 0.155, -0.035, 0.022, 0.14, 0.175, 0.022).castShadow = false;
        } else {
          mesh(sph(24), M.mFur, g, s * 0.04, 0, 0, 0.105, 0.11, 0.045);
          mesh(sph(18), M.mBelly, g, s * 0.042, 0, 0.026, 0.07, 0.074, 0.025).castShadow = false;
        }
        earGroups.push({ g, s, bx: 0, bz: 0, amp: el ? 0.35 : 0.3 });
      }
    } else if (kind === 'deer') {
      for (const s of [-1, 1]) {
        const g = earPivot(s * 1.0, 0.4, -0.03); g.rotation.set(0.1, 0, -s * 1.12);
        mesh(sph(20), M.mFur, g, 0, 0.1, 0, 0.066, 0.13, 0.036);
        mesh(sph(16), M.mInner, g, 0, 0.1, 0.022, 0.042, 0.095, 0.018).castShadow = false;
        earGroups.push({ g, s, bx: 0.1, bz: -s * 1.12, amp: 0.55 });
      }
      const am = mat(0xf2ddb3, { r: 0.6 });
      for (const s of [-1, 1]) {
        const b = earPivot(s * 0.38, 0.98, -0.03); b.rotation.set(-0.15, 0, -s * 0.32);
        mesh(cyl(0.017, 0.024, 0.15, 10), am, b, 0, 0.07, 0);
        mesh(sph(10), am, b, 0, 0.148, 0, 0.019, 0.019, 0.019);
        const br = group(b, 0, 0.085, 0); br.rotation.z = -s * 1.0;
        mesh(cyl(0.013, 0.016, 0.075, 8), am, br, 0, 0.035, 0);
        mesh(sph(10), am, br, 0, 0.073, 0, 0.015, 0.015, 0.015);
        const br2 = group(b, 0, 0.05, 0); br2.rotation.set(0.9, 0, s * 0.3);
        mesh(cyl(0.011, 0.014, 0.055, 8), am, br2, 0, 0.026, 0);
        mesh(sph(8), am, br2, 0, 0.054, 0, 0.012, 0.012, 0.012);
      }
    } else if (kind === 'capybara') {
      for (const s of [-1, 1]) {
        const g = earPivot(s * 0.78, 0.66, -0.01); g.rotation.set(0, s * 0.5, -s * 0.3);
        mesh(sph(16), M.mFur, g, 0, 0.02, 0, 0.055, 0.05, 0.035);
        mesh(sph(12), M.mInner, g, 0, 0.02, 0.02, 0.034, 0.03, 0.016).castShadow = false;
        earGroups.push({ g, s, bx: 0, bz: -s * 0.3, amp: 0.4 });
      }
    } else if (kind === 'lion') {
      // bờm: hai vòng búi lông quanh mặt + khối sau gáy
      const mm = mat(st.mane || 0xd9772b, { r: 0.92 }), mm2 = mat(shade(st.mane || 0xd9772b, -0.14), { r: 0.92 });
      const N = 14;
      for (let i = 0; i < N; i++) {
        const a = i / N * Math.PI * 2 + 0.11, ca = Math.cos(a), sa = Math.sin(a);
        const low = sa < -0.6;
        mesh(sph(16), mm, head, ca * 0.36, sa * 0.33 + 0.01, -0.07 - (low ? 0.05 : 0), low ? 0.085 : 0.115, low ? 0.085 : 0.115, 0.09);
        const b = a + Math.PI / N;
        mesh(sph(16), mm2, head, Math.cos(b) * 0.33, Math.sin(b) * 0.31 + 0.01, -0.16, 0.12, 0.12, 0.1);
      }
      mesh(sph(28), mm2, head, 0, 0.02, -0.12, 0.36, 0.34, 0.25);
      for (const s of [-1, 1]) {
        const g = earPivot(s * 0.6, 0.8, -0.0); g.rotation.set(0, 0, -s * 0.45);
        mesh(sph(18), M.mFur, g, 0, 0.03, 0, 0.085, 0.08, 0.05);
        mesh(sph(14), M.mInner, g, 0, 0.03, 0.03, 0.05, 0.048, 0.025).castShadow = false;
        earGroups.push({ g, s, bx: 0, bz: -s * 0.45, amp: 0.35 });
      }
    } else if (kind === 'dino') {
      const sp = mat(def.accent || 0xffd166, { r: 0.55 });
      const vs = [0.36, 0.08, -0.2];
      vs.forEach((v, j) => { const g = group(head); placeOn(g, HR, null, Math.PI, v, -0.01, UP); const c = mesh(cone(0.05 - j * 0.006, 0.11 - j * 0.01, 10), sp, g, 0, 0, 0.035); c.rotation.x = Math.PI / 2; });
    }

    function update(du, dv, lid, mood, sad, time) {
      for (let i = 0; i < 2; i++) {
        const e = eyes[i];
        if (e.c) placeOn(e.g, eyeR, e.c, du * 0.8, eyeV + dv, -0.002);
        else placeOn(e.g, eyeR, null, e.s * eyeU + du, eyeV + dv, eyeLift);
        e.inner.scale.y = Math.max(0.08, lid * lidBase);
        e.inner.rotation.z = -e.s * 0.22 * sad;
        e.inner.visible = mood < 0.5;
        happy[i].visible = mood >= 0.5;
      }
      if (mouthSmile) { mouthSmile.visible = mood < 0.5 && kind !== 'penguin'; mouthSmile.rotation.z = sad > 0.5 ? Math.PI : 0; }
      if (mouthOpen) mouthOpen.visible = mood >= 0.5;
    }
    function ears(wig, bounce, sad) {
      for (const e of earGroups) {
        e.g.rotation.x = e.bx + (sad * 0.5 + bounce * 0.06) * e.amp;
        e.g.rotation.z = e.bz + (wig * 0.22 * e.s + sad * -e.s * 0.3) * e.amp;
      }
    }
    return { update, ears };
  }

  // ------------------------------------------------------------------ phụ kiện đầu
  function band(head, m, vb, tube, map) {
    const R = HR[0] * Math.cos(vb) + tube * 0.25;
    const t = mesh(torus(R, tube, 0, 10, 48), map ? mat(0xffffff, { r: 0.6, map }) : m, head, 0, HR[1] * Math.sin(vb), 0);
    t.rotation.x = Math.PI / 2; t.scale.set(1, HR[2] / HR[0], 1.05);
    return t;
  }
  function dome(head, m, theta, scale, tilt) {
    const g = geo('dome' + theta, () => new T.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, theta));
    const d = mesh(g, m, head, 0, 0.012, 0, HR[0] * scale, HR[1] * scale, HR[2] * scale);
    d.rotation.x = tilt;
    return d;
  }
  function brim(head, m, back, vRim, len, tilt) {
    const g = geo('brim' + (back ? 'b' : 'f') + len, () => new T.CylinderGeometry(len, len, 0.016, 28, 1, false, back ? Math.PI / 2 : -Math.PI / 2, Math.PI));
    const y = HR[1] * Math.sin(vRim), zf = HR[2] * Math.cos(vRim);
    const b = mesh(g, m, head, 0, y, (back ? -1 : 1) * (zf - len * 0.45), 1.25, 1, 1);
    b.rotation.x = (back ? -1 : 1) * tilt;
    return b;
  }
  function buildAccessory(head, acc, st, id, M) {
    const mA = M.mAcc;
    if (acc === 'visor') {
      band(head, mA, 0.5, 0.026);
      brim(head, mA, false, 0.48, 0.2, 0.2);
    } else if (acc === 'capBack' || acc === 'spikeCap' || acc === 'cap') {
      const tilt = acc === 'capBack' ? 0.22 : -0.12;
      dome(head, mA, Math.PI * 0.36, 1.05, tilt);
      { const rimV = Math.PI / 2 - Math.PI * 0.36, R = HR[0] * 1.05 * Math.cos(rimV);
        const rb = mesh(torus(R, 0.014, 0, 8, 48), mat(shade(st.accent, -0.22), { r: 0.6 }), head, 0, 0.012, 0);
        const pg = new T.Group(); pg.rotation.x = tilt; head.add(pg); pg.add(rb);
        rb.position.set(0, HR[1] * 1.05 * Math.sin(rimV), 0); rb.rotation.x = Math.PI / 2; rb.scale.set(1, HR[2] / HR[0], 1); }
      mesh(sph(12), mat(shade(st.accent, -0.25), { r: 0.6 }), head, 0, HR[1] * 1.05 + 0.005, 0, 0.025, 0.018, 0.025);
      if (acc === 'capBack') {
        brim(head, mat(shade(st.accent, -0.15), { r: 0.6 }), true, 0.25, 0.19, 0.1);
        const strap = mesh(torus(0.06, 0.01, Math.PI, 6, 14), mat(shade(st.accent, -0.3), { r: 0.6 }), head, 0, HR[1] * 0.62, -HR[2] * 0.83 + 0.02); strap.rotation.x = -0.5;
      } else {
        brim(head, mat(shade(st.accent, -0.15), { r: 0.6 }), false, 0.6, 0.2, 0.22);
        if (acc === 'cap') { const g = group(head); placeOn(g, [HR[0] * 1.06, HR[1] * 1.06, HR[2] * 1.06], null, 0, 0.78, 0.0); mesh(sph(16), mWhiteOr(st), g, 0, 0, 0, 0.045, 0.045, 0.012); return null; }
        const sm = mat(0x5bc0a8, { r: 0.55 });
        [[0, 1.25], [0, 0.95], [0, 0.65]].forEach(([u, v], j) => { const g = group(head); placeOn(g, [HR[0] * 1.06, HR[1] * 1.06, HR[2] * 1.06], null, Math.PI + u, v - 0.1, -0.005, UP); const c = mesh(cone(0.04, 0.085 - j * 0.01, 10), sm, g, 0, 0, 0.03); c.rotation.x = Math.PI / 2; });
      }
    } else if (acc === 'band') {
      band(head, mA, 0.52, 0.03);
      const g = group(head); placeOn(g, HR, null, 0.85, 0.5, 0.025);
      mesh(sph(14), mA, g, 0, 0, 0, 0.045, 0.035, 0.03);
    } else if (acc === 'stripeBand') {
      band(head, mA, 0.5, 0.032, stripeTex(st.accent, 0xffffff));
    } else if (acc === 'redBand') {
      band(head, mA, 0.5, 0.03);
      const g = group(head); placeOn(g, HR, null, Math.PI, 0.45, 0.02);
      mesh(sph(14), mA, g, 0, 0, 0, 0.04, 0.035, 0.03);
      for (const s of [-1, 1]) { const t = mesh(caps(0.022, 0.1), mA, g, s * 0.035, -0.07, 0.01, 1, 1, 0.4); t.rotation.z = s * 0.45; }
    } else if (acc === 'bow') {
      const g = group(head); if (id === 'frog') placeOn(g, HR, null, 0.95, 0.32, 0.01); else placeOn(g, HR, null, 0.5, 0.78, 0.01);
      for (const s of [-1, 1]) { const l = mesh(cone(0.055, 0.1, 14), mA, g, s * 0.055, 0, 0, 1, 1, 0.5); l.rotation.z = s * Math.PI / 2; }
      mesh(sph(14), mat(shade(st.accent, -0.2), { r: 0.6 }), g, 0, 0, 0.005, 0.03, 0.03, 0.025);
    } else if (acc === 'shades') {
      const g = group(head); placeOn(g, HR, null, 0, 1.1, 0.035, ZAX); g.rotateX(0.15);
      const lens = mat(0x1d2230, { r: 0.08, m: 0.4 });
      for (const s of [-1, 1]) {
        const fr = mesh(sph(20), mA, g, s * 0.07, 0, -0.004, 0.068, 0.053, 0.016); fr.rotation.y = s * 0.28;
        const l = mesh(sph(20), lens, g, s * 0.07, 0, 0.004, 0.058, 0.044, 0.014); l.rotation.y = s * 0.28;
        mesh(sph(8), mat(0xffffff, { basic: true }), g, s * 0.07 - 0.02, 0.016, 0.018, 0.012, 0.008, 0.003).castShadow = false;
      }
      const br = mesh(cyl(0.008, 0.008, 0.05, 6), mA, g, 0, 0.01, 0.004); br.rotation.z = Math.PI / 2;
    } else if (acc === 'beanie') {
      const knit = canvasTex('knit:' + st.accent, 128, 32, (g, w, h) => {
        g.fillStyle = hex(st.accent); g.fillRect(0, 0, w, h);
        g.fillStyle = hex(shade(st.accent, -0.12)); for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 3, h);
      }, 6, 1);
      dome(head, mat(0xffffff, { r: 0.9, map: knit }), Math.PI * 0.4, 1.06, 0.0);
      const rimV = Math.PI / 2 - Math.PI * 0.4;
      const R = HR[0] * 1.06 * Math.cos(rimV);
      const t = mesh(torus(R, 0.035, 0, 10, 48), mat(0xffffff, { r: 0.85 }), head, 0, HR[1] * 1.06 * Math.sin(rimV) + 0.012, 0);
      t.rotation.x = Math.PI / 2; t.scale.set(1, HR[2] / HR[0], 1);
      mesh(sph(18), mat(0xffffff, { r: 0.95 }), head, 0, HR[1] * 1.06 + 0.05, 0, 0.07, 0.07, 0.07);
    }
    else if (acc === 'crown') {
      const gold = mat(0xffcc33, { r: 0.28, m: 0.6 });
      const g = group(head, 0, 0.295, -0.01); g.rotation.set(-0.1, 0, 0.14);
      mesh(geo('crownBand', () => new T.CylinderGeometry(0.135, 0.125, 0.065, 30, 1, true)), mat(0xffcc33, { r: 0.28, m: 0.6, side: T.DoubleSide }), g, 0, 0, 0);
      mesh(torus(0.127, 0.008, 0, 6, 32), gold, g, 0, -0.03, 0).rotation.x = Math.PI / 2;
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2, x = Math.sin(a) * 0.13, z = Math.cos(a) * 0.13;
        mesh(cone(0.034, 0.07, 8), gold, g, x, 0.065, z, 1, 1, 0.55).rotation.y = a;
        mesh(sph(10), gold, g, x * 1.0, 0.105, z * 1.0, 0.016, 0.016, 0.016);
        mesh(sph(12), mat(i % 2 ? st.accent : 0xff4d6d, { r: 0.15, m: 0.1 }), g, x * 1.04, 0.0, z * 1.04, 0.018, 0.018, 0.01).lookAt(x * 3, 0, z * 3);
      }
    } else if (acc === 'flower') {
      const g = group(head); if (id === 'frog') placeOn(g, HR, null, 0.98, 0.3, 0.012); else placeOn(g, HR, null, 0.72, 0.6, 0.012);
      const pc = cdist(st.accent, 0xffd23f) < 0.2 ? 0xff8fab : st.accent;
      const pm = mat(pc, { r: 0.55 }), pm2 = mat(shade(pc, 0.35), { r: 0.6 });
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * Math.PI * 2;
        const pt = mesh(sph(14), pm, g, Math.cos(a) * 0.045, Math.sin(a) * 0.045, 0.004, 0.042, 0.03, 0.014); pt.rotation.z = a;
        mesh(sph(10), pm2, g, Math.cos(a) * 0.04, Math.sin(a) * 0.04, 0.014, 0.02, 0.012, 0.006).rotation.z = a;
      }
      mesh(sph(14), mat(0xffd23f, { r: 0.5 }), g, 0, 0, 0.016, 0.025, 0.025, 0.016);
      const lm = mat(0x6cc04a, { r: 0.6 });
      for (const s of [-1, 1]) { const l = mesh(sph(10), lm, g, s * 0.07, -0.05, -0.004, 0.035, 0.016, 0.01); l.rotation.z = s * 0.7; }
    } else if (acc === 'headphones') {
      const dk = mat(0x2b2d42, { r: 0.4, m: 0.2 });
      const hb = mesh(torus(0.385, 0.017, Math.PI, 8, 40), dk, head, 0, 0.0, -0.02); hb.scale.set(1, 0.97, 1.4);
      const pad = mesh(torus(0.385, 0.022, Math.PI * 0.4, 8, 16), mA, head, 0, 0.0, -0.02); pad.rotation.z = Math.PI * 0.3; pad.scale.set(1, 0.97, 1.4);
      for (const s of [-1, 1]) {
        const cup = group(head, s * 0.375, -0.03, -0.02); cup.rotation.z = -s * Math.PI / 2;
        mesh(cyl(0.085, 0.085, 0.055, 24), mA, cup, 0, 0.0, 0);
        mesh(cyl(0.05, 0.05, 0.06, 20), mat(0xffffff, { r: 0.4 }), cup, 0, -0.004, 0);
        mesh(torus(0.07, 0.022, 0, 8, 24), dk, cup, 0, 0.03, 0).rotation.x = Math.PI / 2;
      }
    } else if (acc === 'halo') {
      const g = group(head, 0, HR[1] + 0.13, -0.02); g.rotation.x = 0.25;
      mesh(torus(0.16, 0.022, 0, 10, 40), mat(0xffe27a, { r: 0.3, m: 0.3, e: 0.7 }), g, 0, 0, 0).rotation.x = Math.PI / 2;
      g.traverse((o) => { o.castShadow = false; });
      const y0 = g.position.y;
      return { update(t) { g.position.y = y0 + Math.sin(t * 2.2) * 0.012; g.rotation.y = t * 0.6; } };
    } else if (acc === 'party') {
      const g = group(head, 0.09, HR[1] - 0.02, 0.0); g.rotation.set(0.05, 0, -0.32);
      mesh(cone(0.1, 0.25, 24), mat(0xffffff, { r: 0.65, map: stripeTex(st.accent, 0xffffff, 6) }), g, 0, 0.125, 0);
      mesh(torus(0.098, 0.016, 0, 8, 24), mat(shade(st.accent, -0.2), { r: 0.7 }), g, 0, 0.005, 0).rotation.x = Math.PI / 2;
      mesh(sph(14), mat(0xffd23f, { r: 0.85 }), g, 0, 0.26, 0, 0.036, 0.036, 0.036);
    } else if (acc === 'banana') {
      const g = group(head); placeOn(g, HR, null, 0.6, 0.66, 0.0); g.scale.setScalar(1.35); g.rotateZ(0.35);
      const curve = new T.CatmullRomCurve3([new T.Vector3(-0.085, 0.0, 0.0), new T.Vector3(-0.03, 0.04, 0.024), new T.Vector3(0.04, 0.04, 0.024), new T.Vector3(0.09, -0.005, 0.0)]);
      mesh(geo('banana', () => taperTube(curve, 20, 10, 0.024, 0.02)), mat(0xffd23f, { r: 0.5 }), g, 0, 0, 0);
      mesh(sph(10), mat(0x6b4a2a, { r: 0.6 }), g, -0.085, 0, 0, 0.016, 0.016, 0.016);
      mesh(cyl(0.008, 0.012, 0.03, 6), mat(0x8a6a3a, { r: 0.6 }), g, 0.1, -0.012, 0).rotation.z = 0.9;
    } else if (acc === 'orange') {
      const g = group(head, 0.0, HR[1] + 0.06, 0.0); g.rotation.z = -0.08;
      const om = mat(0xffffff, { r: 0.55, map: canvasTex('orangePeel', 64, 32, (c, w, h) => {
        c.fillStyle = '#ff9a1f'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(255,200,90,0.5)';
        for (let i = 0; i < 70; i++) { c.beginPath(); c.arc((i * 37) % w, (i * 23) % h, 0.9, 0, Math.PI * 2); c.fill(); }
      }) });
      mesh(sph(28), om, g, 0, 0, 0, 0.09, 0.08, 0.09);
      mesh(cyl(0.007, 0.009, 0.03, 6), mat(0x6b4a2a, { r: 0.6 }), g, 0, 0.088, 0);
      const lf = mesh(sph(12), mat(0x52b788, { r: 0.55 }), g, 0.035, 0.092, 0, 0.04, 0.008, 0.02); lf.rotation.z = 0.35;
    } else if (acc === 'captain') {
      const g = group(head, 0, 0.3, -0.015); g.rotation.set(-0.12, 0, 0.14);
      const wm = mat(0xffffff, { r: 0.6 });
      mesh(cyl(0.18, 0.17, 0.08, 30), wm, g, 0, 0, 0);
      mesh(cyl(0.2, 0.19, 0.03, 30), wm, g, 0, 0.05, 0);
      mesh(cyl(0.184, 0.176, 0.03, 30), mA, g, 0, -0.02, 0);
      mesh(geo('capBrim', () => new T.CylinderGeometry(0.14, 0.14, 0.014, 24, 1, false, -Math.PI / 2, Math.PI)), mat(0x1d2a4a, { r: 0.4 }), g, 0, -0.04, 0.12, 1.2, 1, 0.75).rotation.x = 0.2;
      mesh(sph(12), mat(0xffcc33, { r: 0.3, m: 0.6 }), g, 0, -0.01, 0.182, 0.022, 0.022, 0.01);
    } else if (acc === 'leaf') {
      const g = group(head, 0.02, HR[1] + 0.005, 0.01); g.rotation.set(0.15, 0.6, 0.18);
      const lm = mat(0x6cc04a, { r: 0.55 });
      mesh(sph(24), lm, g, 0, 0.012, -0.02, 0.12, 0.018, 0.21);
      mesh(cyl(0.006, 0.006, 0.36, 6), mat(0x3f8f3a, { r: 0.6 }), g, 0, 0.03, -0.02).rotation.x = Math.PI / 2;
      mesh(cyl(0.008, 0.008, 0.07, 6), mat(0x6b4a2a, { r: 0.6 }), g, 0, 0.03, 0.2).rotation.x = Math.PI / 2 + 0.4;
    }
    return null;
  }
  function mWhiteOr(st) { return mat(lum(st.accent) > 0.8 ? 0x2b2d42 : 0xffffff, { r: 0.6 }); }

  // ------------------------------------------------------------------ đuôi
  function buildTail(hips, type, kind, M) {
    if (!type) return null;
    const g = group(hips, 0, -0.04, -0.19);
    if (type === 'puff') mesh(sph(16), kind === 'panda' ? mat(0x2a2a30, { r: 0.8 }) : M.mWhite, g, 0, 0, 0, 0.06, 0.06, 0.06);
    else if (type === 'nub') mesh(sph(14), M.mFur, g, 0, 0, 0, 0.05, 0.045, 0.05);
    else if (type === 'curl') { const t = mesh(torus(0.03, 0.011, Math.PI * 1.6, 6, 16), M.mFur, g, 0, 0.02, -0.02); t.rotation.y = Math.PI / 2; }
    else if (type === 'cat') {
      const curve = new T.CatmullRomCurve3([new T.Vector3(0, 0, 0), new T.Vector3(0, 0.02, -0.12), new T.Vector3(0.02, 0.14, -0.2), new T.Vector3(0.05, 0.27, -0.16), new T.Vector3(0.09, 0.3, -0.1)]);
      mesh(geo('catTail', () => new T.TubeGeometry(curve, 24, 0.024, 8, false)), M.mFur, g, 0, 0, 0);
      mesh(sph(10), M.mFur, g, 0.09, 0.3, -0.1, 0.024, 0.024, 0.024);
    } else if (type === 'fox') {
      g.rotation.x = -0.75;
      mesh(sph(24), M.mFur, g, 0, 0, -0.17, 0.1, 0.1, 0.22);
      mesh(sph(18), M.mWhite, g, 0, 0, -0.35, 0.068, 0.068, 0.08);
    } else if (type === 'dino') {
      g.position.y = 0.0; g.rotation.x = -0.25;
      const tg = geo('dinoTail', () => new T.LatheGeometry(new T.SplineCurve([[0, 0], [0.1, 0.03], [0.105, 0.12], [0.07, 0.26], [0.03, 0.38], [0, 0.42]].map((q) => new T.Vector2(q[0], q[1]))).getPoints(20), 18));
      const tm = mesh(tg, M.mFur, g, 0, 0, 0.04, 1, 1, 0.85); tm.rotation.x = -Math.PI / 2 - 0.15;
      const sp = mat(M.accent ? 0xffd166 : 0xffd166, { r: 0.55 });
      [0.06, -0.06, -0.17].forEach((z, j) => { const c = mesh(cone(0.034 - j * 0.006, 0.08 - j * 0.012, 8), sp, g, 0, 0.07 - j * 0.025, z - 0.04); c.rotation.x = -0.25; });
    }
    else if (type === 'monkey') {
      const curve = new T.CatmullRomCurve3([new T.Vector3(0, 0, 0), new T.Vector3(0, -0.03, -0.12), new T.Vector3(0, 0.05, -0.24), new T.Vector3(0, 0.2, -0.27), new T.Vector3(0, 0.3, -0.2), new T.Vector3(0, 0.27, -0.12), new T.Vector3(0, 0.2, -0.14), new T.Vector3(0, 0.21, -0.2)]);
      mesh(geo('monkeyTail', () => taperTube(curve, 48, 8, 0.026, 0.017)), M.mFur, g, 0, 0, 0);
      mesh(sph(10), M.mFur, g, 0, 0.21, -0.2, 0.017, 0.017, 0.017);
    } else if (type === 'elephant' || type === 'lion') {
      const curve = new T.CatmullRomCurve3([new T.Vector3(0, 0, 0), new T.Vector3(0, -0.04, -0.1), new T.Vector3(0.0, -0.06, -0.2), new T.Vector3(0.02, 0.02, -0.3), new T.Vector3(0.03, 0.1, -0.33)]);
      const L = type === 'lion';
      mesh(geo('thinTail' + (L ? 'L' : ''), () => taperTube(L ? curve : new T.CatmullRomCurve3(curve.points.slice(0, 3)), 24, 8, 0.02, 0.012)), M.mFur, g, 0, 0, 0);
      const end = L ? curve.points[4] : curve.points[2];
      const tuftM = L ? mat(M.st.mane || 0xd9772b, { r: 0.92 }) : mat(0x6f7a90, { r: 0.9 });
      mesh(sph(14), tuftM, g, end.x, end.y + (L ? 0.03 : -0.02), end.z, L ? 0.05 : 0.026, L ? 0.065 : 0.04, L ? 0.05 : 0.026);
    } else if (type === 'raccoon') {
      g.position.z = -0.2; g.rotation.x = 0.55;
      const ringM = mat(M.st.mask || 0x3a3b48, { r: 0.85 });
      for (let i = 0; i < 6; i++) {
        const t = i / 5, r = 0.075 + Math.sin(t * Math.PI) * 0.03 - t * 0.025;
        mesh(sph(18), i % 2 ? ringM : M.mFur, g, 0, 0, -0.05 - i * 0.065, r, r, 0.05);
      }
      mesh(sph(14), ringM, g, 0, 0, -0.39, 0.05, 0.05, 0.05);
    } else if (type === 'deer') {
      g.position.z = -0.2; g.rotation.x = 0.9;
      mesh(sph(16), M.mFur, g, 0, 0, -0.03, 0.045, 0.03, 0.07);
      mesh(sph(14), M.mWhite, g, 0, -0.016, -0.035, 0.038, 0.02, 0.06);
    } else if (type === 'turtle') {
      g.position.set(0, -0.08, -0.21);
      const c = mesh(cone(0.04, 0.09, 12), M.mFur, g, 0, 0, -0.03); c.rotation.x = -Math.PI / 2 - 0.4;
    } else if (type === 'seal') {
      g.position.set(0, -0.1, -0.22); g.rotation.x = 0.2;
      mesh(sph(14), M.mFur, g, 0, 0, -0.03, 0.05, 0.04, 0.06);
      for (const s of [-1, 1]) { const f = mesh(sph(16), mat(shade(M.st.limb || 0xb4c2cf, -0.08), { r: 0.75 }), g, s * 0.05, -0.01, -0.09, 0.06, 0.016, 0.045); f.rotation.y = s * 0.55; }
    }
    return {
      update(time, amp, phase, happy) {
        g.rotation.y = Math.sin(time * (happy ? 14 : 3)) * (happy ? 0.45 : 0.14) + Math.sin(phase) * 0.2 * amp;
      },
    };
  }

  // ------------------------------------------------------------------ ảnh chân dung (renderer phụ)
  function lookFor(looks, id) {
    if (!looks) return null;
    if (typeof looks.get === 'function') return looks.get(id) || null;
    return looks[id] || null;
  }
  function portraits(defs, size, looks) {
    size = size || 192;
    defs = defs || PP.CHARACTERS || [];
    return new Promise((resolve) => {
      const map = new Map();
      let renderer;
      try {
        const canvas = document.createElement('canvas');
        renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      } catch (e) { resolve(map); return; }
      renderer.setPixelRatio(1);
      renderer.setSize(size, size, false);
      renderer.outputEncoding = T.sRGBEncoding;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.9;
      renderer.setClearColor(0x000000, 0);
      const scene = new T.Scene();
      let pm = null, envTex = null;
      if (T.RoomEnvironment) { pm = new T.PMREMGenerator(renderer); envTex = pm.fromScene(new T.RoomEnvironment(), 0.04).texture; scene.environment = envTex; }
      scene.add(new T.HemisphereLight(0xfff4e6, 0x8a7a6a, 0.55));
      const key = new T.DirectionalLight(0xffffff, 0.9); key.position.set(1.5, 3, 2.5); scene.add(key);
      const cam = new T.PerspectiveCamera(28, 1, 0.1, 30);
      const look = new T.Vector3(0.5, 1.2, 3);
      const box = new T.Box3(), dir = new T.Vector3(0.42, 0.16, 1).normalize();
      for (const def of defs) {
        try {
          const ch = build(def, { team: 'B', look: lookFor(looks, def.id) });
          scene.add(ch.root);
          for (let i = 0; i < 14; i++) ch.update(0.1, { x: 0, z: 0, vx: 0, vz: 0, look, mode: 'idle' });
          // khung bán thân 3/4: từ vai tới đỉnh tai/mũ (bỏ qua vợt)
          box.makeEmpty();
          ch.root.traverse((o) => { if (o.isMesh && o.visible && o.parent && !isPaddlePart(o)) box.expandByObject(o); });
          const top = Math.min(box.max.y, 2.2) + 0.03, bot = 0.62, h = top - bot, cy = (top + bot) / 2;
          const dist = (h / 2) / Math.tan(T.MathUtils.degToRad(cam.fov / 2)) * 1.06;
          cam.position.set(dir.x * dist, cy + dir.y * dist, dir.z * dist);
          cam.lookAt(0, cy, 0);
          renderer.render(scene, cam);
          map.set(def.id, renderer.domElement.toDataURL('image/png'));
          ch.dispose();
        } catch (e) { /* bỏ qua nhân vật lỗi */ }
      }
      if (envTex) envTex.dispose();
      if (pm) pm.dispose();
      renderer.dispose();
      if (renderer.forceContextLoss) renderer.forceContextLoss();
      resolve(map);
    });
  }
  function isPaddlePart(o) { for (let p = o; p; p = p.parent) if (p.userData && p.userData.paddle) return true; return false; }

  // ------------------------------------------------------------------ xem trước 3D (màn Tủ đồ)
  function createPreview(canvas) {
    let renderer;
    try {
      renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch (e) {
      return { set() {}, setAnim() {}, resize() {}, dispose() {} };
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    const scene = new T.Scene();
    let pm = null, envTex = null;
    if (T.RoomEnvironment) { pm = new T.PMREMGenerator(renderer); envTex = pm.fromScene(new T.RoomEnvironment(), 0.04).texture; scene.environment = envTex; }
    scene.add(new T.HemisphereLight(lin(0xfff6ea), lin(0xb59a80), 0.6));
    const key = new T.DirectionalLight(lin(0xfff1dc), 1.25);
    key.position.set(1.6, 3.4, 2.4); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -1.2, right: 1.2, top: 1.2, bottom: -1.2, near: 0.5, far: 8 });
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
    scene.add(key);
    const rim = new T.DirectionalLight(lin(0xd8ecff), 0.55); rim.position.set(-2, 2.2, -2.5); scene.add(rim);
    // nền: đĩa bóng mềm + nhận bóng đổ
    const discTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
      gr.addColorStop(0, 'rgba(40,30,50,0.32)'); gr.addColorStop(0.6, 'rgba(40,30,50,0.12)'); gr.addColorStop(1, 'rgba(40,30,50,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      return new T.CanvasTexture(c);
    })();
    const discGeo = new T.PlaneGeometry(1.5, 1.5), discMat = new T.MeshBasicMaterial({ map: discTex, transparent: true, depthWrite: false });
    const disc = new T.Mesh(discGeo, discMat); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.001; scene.add(disc);
    const catchGeo = new T.PlaneGeometry(3, 3), catchMat = new T.ShadowMaterial({ opacity: 0.16 });
    const catcher = new T.Mesh(catchGeo, catchMat); catcher.rotation.x = -Math.PI / 2; catcher.position.y = 0.002; catcher.receiveShadow = true; scene.add(catcher);
    const turn = new T.Group(); scene.add(turn);
    const cam = new T.PerspectiveCamera(30, 1, 0.1, 30);

    let ch = null, anim = 'idle', animT = 0, swingI = 0, angle = 0.35, vel = 0, drag = null, raf = 0, last = 0, dead = false;
    let cw = 0, chh = 0;
    const lookPt = new T.Vector3(0, 1.1, 3);
    const st = { x: 0, z: 0, vx: 0, vz: 0, look: lookPt, mode: 'idle', holdBall: false };
    const SW = ['forehand', 'backhand', 'volley', 'overhead', 'low'];

    function frame() {
      const w = cw || 1, h = chh || 1, aspect = w / h;
      cam.aspect = aspect;
      const tH = Math.tan(T.MathUtils.degToRad(cam.fov / 2));
      const needH = 1.02, needW = 0.74;
      const dist = Math.max(needH / tH, needW / (tH * aspect));
      cam.position.set(0, 1.05, dist);
      cam.lookAt(0, 0.88, 0);
      cam.updateProjectionMatrix();
    }
    function resize() {
      const w = Math.max(1, Math.round(canvas.clientWidth || canvas.width || 300));
      const h = Math.max(1, Math.round(canvas.clientHeight || canvas.height || 300));
      if (w === cw && h === chh) return;
      cw = w; chh = h;
      renderer.setSize(w, h, false);
      frame();
    }
    function set(def, look) {
      if (dead) return;
      if (ch) { ch.dispose(); ch = null; }
      ch = build(def, { team: 'B', look: look || null });
      turn.add(ch.root);
      animT = 0;
      for (let i = 0; i < 8; i++) ch.update(0.05, st);
    }
    function setAnim(a) {
      anim = (a === 'ready' || a === 'swing' || a === 'celebrate') ? a : 'idle';
      animT = 0; swingI = 0;
      if (ch && anim === 'celebrate') ch.react('celebrate');
    }
    function tick(now) {
      if (dead) return;
      raf = requestAnimationFrame(tick);
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016; last = now;
      resize();
      if (!drag) { vel = damp(vel, 0, 3, dt); angle += (0.45 + vel) * dt; }
      turn.rotation.y = angle;
      if (ch) {
        animT += dt;
        st.mode = anim === 'idle' ? 'idle' : anim === 'celebrate' ? 'celebrate' : 'ready';
        lookPt.set(Math.sin(now * 0.0006) * 0.9, 1.05 + Math.sin(now * 0.0011) * 0.15, 3);
        if (anim === 'swing' && animT > 1.25) { animT = 0; ch.swing({ zone: SW[swingI++ % SW.length], contact: null, timeToContact: 0.32 }); }
        if (anim === 'celebrate' && animT > 2.3) { animT = 0; ch.react('celebrate'); }
        ch.update(dt, st);
      }
      renderer.render(scene, cam);
    }
    function onDown(e) { drag = { x: e.clientX, id: e.pointerId, t: performance.now() }; vel = 0; try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* */ } }
    function onMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, now = performance.now(), dtm = Math.max(1, now - drag.t);
      angle += dx * 0.012; vel = clamp((dx * 0.012) / (dtm / 1000) - 0.45, -8, 8);
      drag.x = e.clientX; drag.t = now;
      e.preventDefault();
    }
    function onUp(e) { if (drag && e.pointerId === drag.id) { drag = null; try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* */ } } }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    const prevTouch = canvas.style.touchAction; canvas.style.touchAction = 'none';
    resize();
    raf = requestAnimationFrame(tick);

    function dispose() {
      if (dead) return;
      dead = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.style.touchAction = prevTouch;
      if (ch) { ch.dispose(); ch = null; }
      discGeo.dispose(); discMat.dispose(); discTex.dispose(); catchGeo.dispose(); catchMat.dispose();
      if (key.shadow.map) key.shadow.map.dispose();
      if (envTex) envTex.dispose();
      if (pm) pm.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
    }
    return { set, setAnim, resize() { cw = 0; resize(); }, dispose, get character() { return ch; } };
  }

  const OPTIONS = { palette: PALETTE.slice(), patterns: PATTERNS.map((p) => Object.assign({}, p)), accessories: ACCESSORIES.map((a) => Object.assign({}, a)), shirtStyles: SHIRT_STYLES.map((x) => Object.assign({}, x)) };
  PP.Character = { build, portraits, createPreview, defaultLook, OPTIONS, STYLE, ZONES: Object.keys(ZONES), FACE_REACH: UPPER + FORE + FACE_C };
})();
