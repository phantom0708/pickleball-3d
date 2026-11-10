/* Pickle Pop – hằng số & dữ liệu dùng chung (trình duyệt + Node) */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else { root.PP = root.PP || {}; Object.assign(root.PP, mod); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const APP_VERSION = '2.0.0';

  const C = {
    W: 3.05, L: 6.7, K: 2.13,
    NET_H: 0.86, NET_POST_H: 0.91, NET_HALF: 3.35,
    G: 9.8, R: 0.065, TIME_SCALE: 0.92, SIM_DT: 1 / 240,
    PLAYER_SPEED: 5.2, KITCHEN_FOOT: 0.1, // chân chạm vạch bếp cũng tính là trong bếp
    REACH: 1.25, SWEET: 0.55,
    SWING_TIME: 0.32, PERFECT_WINDOW: 0.14, SWING_COOLDOWN: 0.15,
    SERVE_X: 1.5, POINT_DELAY: 1.9, SERVE_TIMEOUT: 10,
    GRACE_ONLINE: 0.2, MAX_RALLY_SIM: 8,
    BOUND_X: 4.85, BOUND_BACK: 9.2, NET_GAP: 0.35,
    // v2: lực cản a = -DRAG_K·|v|·v, Magnus a = MAGNUS_K·spin·(ω̂ × v), spin tính bằng rad/s
    DRAG_K: 0.032, MAGNUS_K: 0.0025, SPIN_REF: 40,
    CONTACT_MAX_AHEAD: 0.6, ASSIST: 0.3, PERFECT_LEAD: 0.07,
    SERVE_Y: 0.55, SERVE_FWD: 0.45,
  };

  // depth: độ sâu điểm rơi tính từ lưới; apex: đỉnh quỹ đạo mong muốn (m) = apex + apexB * khoảng cách;
  // speed (chỉ smash): tốc độ ngang mong muốn; clear: khoảng hở tối thiểu qua lưới;
  // spin: rad/s (+ topspin, − backspin); vmax: giới hạn tốc độ server chấp nhận
  const SHOTS = {
    drive: { depth: 5.4, apex: 1.3, apexB: 0, apexUp: 0.45, clear: 0.15, spin: 45, power: 1.0, vmax: 30, charge: 0.32, color: '#9cc9ff' },
    dink:  { depth: 1.25, apex: 1.08, apexB: 0, clear: 0.06, spin: -30, power: 0.3, vmax: 12, charge: 0.08, color: '#8fe3c0' },
    drop:  { depth: 1.5, apex: 1.8, apexB: 0, clear: 0.25, spin: -80, power: 0.45, vmax: 15, charge: 0.1, color: '#7fdcc4' },
    lob:   { depth: 5.9, apex: 4.8, apexB: 0, clear: 0.6, spin: 15, power: 0.6, vmax: 20, charge: 0.15, color: '#ffd35c' },
    smash: { depth: 4.0, speed: 20, clear: 0.04, spin: 60, power: 1.4, vmax: 36, charge: 0.25, color: '#ff5d8f' },
  };
  // giao bóng tay dưới
  const SERVES = {
    drive: { depth: 4.6, apex: 2.15, spin: 0 },
    lob:   { depth: 5.8, apex: 3.0, spin: 10 },
    dink:  { depth: 3.4, apex: 1.9, spin: -15 },
  };
  const SERVE_VMAX = 20;
  const SERVE_COLOR = '#ffffff';

  const CHARACTERS = [
    { id: 'bunny',   name: 'Thỏ Mochi',       emoji: '🐰', body: 0xfff4f7, accent: 0xffb3c7, belly: 0xffffff, paddle: 0xff6f91, ears: 'long',    unlock: 0 },
    { id: 'bear',    name: 'Gấu Bơ',          emoji: '🐻', body: 0xc68a55, accent: 0x8a5a33, belly: 0xf0d2a8, paddle: 0x3fa7d6, ears: 'round',   unlock: 0 },
    { id: 'cat',     name: 'Mèo Mun',         emoji: '🐱', body: 0x3b3b48, accent: 0xff9fb8, belly: 0xe9e9f2, paddle: 0xf7c948, ears: 'tri',     unlock: 0 },
    { id: 'pig',     name: 'Heo Hồng',        emoji: '🐷', body: 0xffb6c6, accent: 0xff8aa5, belly: 0xffd3dd, paddle: 0x7bd389, ears: 'pig',     unlock: 0 },
    { id: 'frog',    name: 'Ếch Cốm',         emoji: '🐸', body: 0x7ccf5b, accent: 0x4fa83a, belly: 0xe6f7c6, paddle: 0xff8c42, ears: 'frog',    unlock: 0 },
    { id: 'penguin', name: 'Cánh Cụt Đá',     emoji: '🐧', body: 0x2f3a4f, accent: 0xffa630, belly: 0xffffff, paddle: 0x9b6dff, ears: 'penguin', unlock: 0 },
    { id: 'fox',     name: 'Cáo Lửa',         emoji: '🦊', body: 0xff8a3d, accent: 0x5a2e14, belly: 0xffffff, paddle: 0x2ec4b6, ears: 'fox',     unlock: 1 },
    { id: 'panda',   name: 'Gấu Trúc Tròn',   emoji: '🐼', body: 0xffffff, accent: 0x222222, belly: 0xffffff, paddle: 0xe63946, ears: 'panda',   unlock: 5 },
    { id: 'dino',    name: 'Khủng Long Xanh', emoji: '🦖', body: 0x5bc0a8, accent: 0xffd166, belly: 0xd8f3e9, paddle: 0xef476f, ears: 'dino',    unlock: 10 },
    // v3 – 9 nhân vật mới
    { id: 'monkey',   name: 'Khỉ Chuối',        emoji: '🐵', body: 0xb07a4f, accent: 0xffd23f, belly: 0xf6d7b0, paddle: 0xffd23f, ears: 'monkey',   unlock: 0 },
    { id: 'elephant', name: 'Voi Mây',          emoji: '🐘', body: 0xa9b4c8, accent: 0xff8fab, belly: 0xd8deea, paddle: 0x7bdff2, ears: 'elephant', unlock: 0 },
    { id: 'raccoon',  name: 'Gấu Mèo Mặt Nạ',   emoji: '🦝', body: 0x8d8f9c, accent: 0x5ad1a8, belly: 0xe9e9ef, paddle: 0xff7a59, ears: 'raccoon',  unlock: 0 },
    { id: 'deer',     name: 'Nai Sao',          emoji: '🦌', body: 0xd59a66, accent: 0x9ad06a, belly: 0xfbe6cc, paddle: 0xf4a261, ears: 'deer',     unlock: 3 },
    { id: 'turtle',   name: 'Rùa Lá',           emoji: '🐢', body: 0x8fd17a, accent: 0x3e8e5e, belly: 0xf3eab0, paddle: 0x48cae4, ears: 'turtle',   unlock: 7 },
    { id: 'capybara', name: 'Chuột Lang Nước',  emoji: '🦫', body: 0xb98a5e, accent: 0xff9f1c, belly: 0xd9b38c, paddle: 0x2ec4b6, ears: 'capybara', unlock: 15 },
    { id: 'seal',     name: 'Hải Cẩu Bọt',      emoji: '🦭', body: 0xc8d3dd, accent: 0x4cc9f0, belly: 0xf1f5f9, paddle: 0xff70a6, ears: 'seal',     unlock: 20 },
    { id: 'lion',     name: 'Sư Tử Nắng',       emoji: '🦁', body: 0xf2b84b, accent: 0xe76f51, belly: 0xfde8b8, paddle: 0xe63946, ears: 'lion',     unlock: 25 },
    { id: 'sloth',    name: 'Lười Thong Thả',   emoji: '🦥', body: 0xa58b74, accent: 0xb5e48c, belly: 0xe6d5c3, paddle: 0x9b5de5, ears: 'sloth',    unlock: 30 },
  ];

  const VENUES = [
    { id: 'gym',   name: 'Nhà thi đấu Hoa Mai', desc: 'Trong nhà · không gió', wind: 'none', strength: 0,
      sky: 0xf3e9da, ground: 0xc9935f, outer: 0x4f9a6c, court: 0x3b6fb6 },
    { id: 'beach', name: 'Bãi biển Gió Nam', desc: 'Gió biển thổi đều cả trận', wind: 'steady', strength: 0.6,
      sky: 0x9edcff, ground: 0xf0d9a0, outer: 0x45b08f, court: 0x2b86b0 },
    { id: 'roof',  name: 'Sân thượng Hoàng Hôn', desc: 'Gió giật, đổi mỗi pha bóng', wind: 'gust', strength: 0.9,
      sky: 0xffae86, ground: 0x6a6e80, outer: 0x3d8a78, court: 0x7a4fb5 },
    { id: 'park',  name: 'Công viên Lá Me', desc: 'Gió nhẹ thoảng qua tán cây', wind: 'gust', strength: 0.5,
      sky: 0xbfe8ff, ground: 0x7fbf5a, outer: 0x4f9a6c, court: 0x3f8f5f },
    { id: 'arena', name: 'Đấu trường Đêm', desc: 'Trong nhà · đèn sân khấu · không gió', wind: 'none', strength: 0,
      sky: 0x141a2e, ground: 0x2a2f45, outer: 0x1f3b5c, court: 0x2b5fb8 },
    // v3 – 5 sân mới
    { id: 'hoian',   name: 'Phố Hội Đèn Lồng', desc: 'Đêm phố cổ · gió nhẹ ven sông', wind: 'gust', strength: 0.3,
      sky: 0x1d1b3a, ground: 0x6b4b3a, outer: 0x9a3b3b, court: 0xc0563b },
    { id: 'terrace', name: 'Ruộng Bậc Thang', desc: 'Lưng chừng núi · gió giật mạnh', wind: 'gust', strength: 1.0,
      sky: 0xcfe9ff, ground: 0x7fb34a, outer: 0x5a9a3a, court: 0x3d8bbf },
    { id: 'halong',  name: 'Vịnh Hạ Long', desc: 'Sân nổi trên mặt vịnh · gió biển đều', wind: 'steady', strength: 0.7,
      sky: 0xa8e0f0, ground: 0x2f8fa8, outer: 0x8a6a4a, court: 0x2b7fb0 },
    { id: 'snow',    name: 'Đỉnh Tuyết Fansipan', desc: 'Tuyết rơi · gió lạnh thất thường', wind: 'gust', strength: 0.8,
      sky: 0xdfeefa, ground: 0xf4f8fc, outer: 0x9cc3de, court: 0x4a6fd0 },
    { id: 'space',   name: 'Trạm Vũ Trụ Sao Mai', desc: 'Mái vòm kính giữa các vì sao · không gió', wind: 'none', strength: 0,
      sky: 0x0b0d24, ground: 0x2a2d48, outer: 0x3a3f6a, court: 0x5b4bd6 },
  ];

  // home = độ sâu (tính từ lưới) khi chờ bóng sau khi đã vào thế
  const LEVELS = {
    rookie: { id: 'rookie', name: 'Tập sự',        speed: 3.3, react: 0.38, err: 2.0, reach: 1.0, perfect: 0.06, smash: 0.3,  home: 5.8, net: false, judge: 0.3,  drop: 0.1,  dink: 0.4, power: 0, aggro: 0, feet: 0 },
    pro:    { id: 'pro',    name: 'Chuyên nghiệp', speed: 4.3, react: 0.24, err: 1.4, reach: 1.12, perfect: 0.2, smash: 0.7,  home: 2.6, net: true,  judge: 0.75, drop: 0.6,  dink: 0.65, power: 0.25, aggro: 0.2, feet: 0.2 },
    ace:    { id: 'ace',    name: 'Cao thủ',       speed: 6.0, react: 0.06, err: 0.6, reach: 1.36, perfect: 0.75, smash: 0.98, home: 2.35, net: true,  judge: 0.99, drop: 0.85, dink: 0.8, power: 0.7, aggro: 0.75, feet: 0.6 },
  };


  // v3 – enum tùy chỉnh ngoại hình (look). Mảng id thuần (string) để kiểm tra/dùng chung;
  // tên tiếng Việt & điều kiện mở khóa do client (PP.Character.OPTIONS) quyết định.
  const LOOK = {
    patterns: ['solid', 'stripe', 'dots', 'split', 'flame', 'star', 'wave', 'check'],
    accessories: ['default', 'none', 'cap', 'capBack', 'visor', 'band', 'beanie', 'bow', 'shades', 'crown', 'flower', 'headphones', 'halo', 'party'],
    shirtStyles: ['tee', 'tank', 'jersey', 'hoodie'],
    colorKeys: ['shirt', 'shorts', 'accent', 'shoes', 'paddle'],
    numberMax: 99,
  };

  return { APP_VERSION, C, SHOTS, SERVES, SERVE_VMAX, SERVE_COLOR, CHARACTERS, VENUES, LEVELS, LOOK };
});
