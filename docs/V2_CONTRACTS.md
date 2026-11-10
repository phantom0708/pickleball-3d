# Pickle Pop v2 – Hợp đồng API giữa các module

Tài liệu gốc: `docs/DESIGN_V2.md`. File này chốt **tên hàm, tham số, quyền sở hữu file** để các phần làm song song ghép khớp nhau.
Mọi module trình duyệt là *classic script* gắn vào `window.PP`, dùng `THREE` toàn cục **r147**
(`https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js` và `.../examples/js/environments/RoomEnvironment.js` → `THREE.RoomEnvironment`).
Tọa độ: đơn vị mét; đội A ở nửa `z > 0` nhìn về `-z`; đội B ở `z < 0` nhìn về `+z`; lưới ở `z = 0`; `y` là chiều cao.

## Quyền sở hữu file
| Nhóm | File được sửa |
|---|---|
| **S – Shared/Server** | `shared/*.js`, `server/*.js`, `server/test/*` |
| **C – Character** | `js/character.js` (mới), `tools/character-preview.html` (mới) |
| **W – World** | `js/world.js`, `js/audio.js`, `tools/world-preview.html` (mới) |
| **G – Game/UI (agent chính)** | `index.html`, `style.css`, `js/game.js`, `js/ui.js`, `js/input.js`, `js/net.js` |

Không sửa file của nhóm khác. Cần thay đổi hợp đồng → ghi rõ trong báo cáo cuối.

---

## S – `shared/` (cũng chạy trên Node)

### config.js
- `PP.C` giữ nguyên các khóa cũ. Thêm: `C.DRAG_K` (~0.035), `C.CONTACT_MAX_AHEAD = 0.6`, `C.ASSIST = 0.3`, `C.PERFECT_LEAD = 0.07` (thời gian còn lại tới chạm lý tưởng lúc bấm).
- `SHOTS` thêm `drop`. Mỗi cú có `spin` (+ topspin, − backspin), `vmax`, `power`, `color` (hex trail: drive `#9cc9ff`, dink `#8fe3c0`, drop `#7fdcc4`, lob `#ffd35c`, smash `#ff5d8f`), cộng `SERVE_COLOR = '#ffffff'`.
- `VENUES`: `gym, beach, roof, park, arena` – chỉ `{id, name, desc, wind, strength}` (hình ảnh thuộc W). park: “Công viên Lá Me”, gió `gust` 0.5; arena: “Đấu trường Đêm”, không gió.
- `CHARACTERS` giữ 9 id: `bunny, bear, cat, pig, frog, penguin, fox, panda, dino` (+ `emoji` giữ lại làm dự phòng).

### physics.js (`PP.Physics`)
- Launch: `{id, by, team, from:{x,y,z}, v:{x,y,z}, spin, t0, wind:{x,z}, hits, serve, shot, perfect}` – **thêm `spin`** (số, rad/s quy ước của S). `BallSim` dùng drag + Magnus + nảy theo xoáy, bước cố định `SIM_DT`, chỉ `+ − × ÷ Math.sqrt`.
- `computeShot({team, type, ball:{x,y,z}, aim:{x,z}, quality, perfect, errBase, rng})` → `{type, from, v, spin}` (type có thể đổi: smash thấp → drive).
- `serveShot({team, type, pos:{x,z}, boxSign, aimX, errBase, rng})` → `{type, from, v, spin}`; `from = {x: pos.x, y: 0.55, z: pos.z + dir*0.45}` (giao tay dưới, dưới thắt lưng).
- `predictContact(launch, now, player:{x,z,team}, opts)` → `null` hoặc `{t, ball:{x,y,z}, simT, bounces, dist}`
  - `t` = thời điểm trận (giây) của điểm chạm sớm nhất trong `opts.maxAhead` (mặc định `C.CONTACT_MAX_AHEAD`) mà: bóng ở phía sân của `player.team`, khoảng cách ngang tới `(player.x, player.z)` ≤ `opts.reach` (mặc định `C.REACH + C.ASSIST`), `0.08 ≤ y ≤ (opts.maxY || 2.4)`, tôn trọng luật 2 nảy (`launch.hits <= 2` ⇒ phải đã nảy), chưa nảy lần 2; nếu `opts.avoidKitchenVolley` thì bỏ điểm volley khi `|player.z| < K`.
  - Ưu tiên điểm có khoảng cách nhỏ nhất trong cửa sổ “đang tới gần” (giống cũ: chạm khi bóng gần nhất).
- `strokeZone(team, px, pz, contact:{x,y,z}, opts:{volley, serve})` → `'forehand'|'backhand'|'overhead'|'low'|'volley'|'serve'`
  - serve → `'serve'`; `y > 1.6` → `'overhead'`; `y < 0.5` → `'low'`; volley gần lưới (`|pz| < 3.2` và chưa nảy) → `'volley'`; còn lại theo phía tay phải của người chơi (đội A tay phải là `+x`, đội B là `−x`): phải → `forehand`, trái → `backhand`.
- Giữ các hàm cũ: `stateAt, predict, firstBounce, simTimeOf, mulberry32, gauss, clamp, netHeightAt, speedOf`.

### match.js
- `tryHit` chấp nhận `shot: 'drop'`, kiểm tra `vmax` mới, `from` lệch ≤ 0.25m so với bóng (strict). Launch phát ra có `spin`.

### ai.js (`PP.BotBrain`)
- `tick(dt, now, match)` → hit | null (như cũ). Bot chỉ đánh **đúng tại `intent.t`**.
- Thuộc tính công khai **`brain.intent`**: `null` hoặc `{launchId, t, x, y, z, zone}` – điểm chạm dự kiến, được đặt ngay khi bot quyết định (≥ 0.25 s trước khi chạm khi có thể). Client dùng để chạy hoạt ảnh vung đúng lúc.
- `brain.swing` (bộ đếm) giữ nguyên.

### protocol.js
- `PROTOCOL_VERSION = 2`. `hit.shot` thêm `'drop'`.
- Tin mới **C→S** `swing {contactT, x, y, z, zone}`; server phát lại **S→C** `swing {matchId, id, contactT, x, y, z, zone}` cho người khác trong trận + khán giả. Bot trên server cũng phát `swing` khi có `intent` mới.

---

## C – `js/character.js` (`PP.Character`)
```js
const ch = PP.Character.build(def /* phần tử PP.CHARACTERS */, { team: 'A' | 'B' });
scene.add(ch.root);                    // root đặt ở chân
ch.update(dt, {
  x, z, vx, vz,                         // vị trí/vận tốc thế giới (root.position do update đặt)
  look: {x, y, z} | null,               // bóng – xoay mặt ±0.5 rad, mắt nhìn theo
  mode: 'ready' | 'idle' | 'serve' | 'celebrate' | 'sad',
  holdBall: boolean                     // tay trái cầm bóng (pha giao)
});
ch.swing({ zone, contact: {x,y,z} | null, timeToContact });  // windup → contact (IK) → follow; contact null = vung hụt
ch.splitStep();
ch.lunge(dx, dz);                       // hướng thế giới
ch.react('celebrate' | 'sad');
ch.getPaddleFaceWorld(outVec3);         // tâm mặt vợt (thế giới)
ch.getHandWorld('L' | 'R', outVec3);    // để vẽ bóng trong tay khi giao
ch.setHighlight(colorHex | null);       // vòng dưới chân người chơi “mình”
ch.dispose();
PP.Character.portraits(defs, size = 192) // → Promise<Map<id, dataURL>> (renderer phụ)
```
- Chiều cao ~1.45 m. Tầm với vai→tâm mặt vợt ~0.85 m. Khi `swing` có `contact`, tại đúng thời điểm chạm **tâm mặt vợt cách điểm chạm ≤ 0.12 m** (được phép dịch thân tối đa 0.45 m về phía bóng + nghiêng/nhón, chỉ hình ảnh).
- Không phụ thuộc file khác ngoài `THREE`, `PP.CHARACTERS`.

## W – `js/world.js`, `js/audio.js` (`PP.World`, `PP.Audio`)
```js
const renderer = PP.World.createRenderer(canvas, quality /* 'low'|'medium'|'high' */);
PP.World.applyQuality(renderer, quality);
const world = PP.World.buildScene(renderer, venueId, quality);
// world = { scene, update(dt, time), crowd: { cheer(level 0..1), wave() }, net: { shake(x, strength) }, dispose() }
// scene đã có đèn, scene.environment (RoomEnvironment PMREM), sân, lưới (dây giữa), bối cảnh, khán giả, hạt môi trường

const ball = new PP.World.Ball();       scene.add(ball.root);
ball.update(dt, pos, vel /* null nếu đứng yên */, state /* 'flight'|'held'|'rest'|'hidden' */, camera, spin);
ball.setTrailColor(hex); ball.clearTrail();
const ring = new PP.World.TimingRing();     ring.update(x, z, progress /* 0..1 hoặc null */, dt); ring.flash();
const land = new PP.World.LandingMarker();  land.update(pos /* {x,z}|null */, time);
const box  = new PP.World.BoxHint();        box.update(rect /* {x0,x1,z0,z1}|null */, time);
const bursts = new PP.World.Bursts();       bursts.spawn(x, y, z, colorHex, scale = 1, life = 0.35); bursts.update(dt, camera);
const fx = new PP.World.Particles();        fx.burst(x, y, z, {count, colors, speed, gravity}); fx.dust(x, z, surface); fx.update(dt);
PP.World.surfaceOf(venueId) // 'wood'|'sand'|'hard'
```
- `TimingRing`: vòng mục tiêu bán kính 0.5 m (trắng) + vòng vàng đóng lại: `scale = 1 + 1.6 * progress` (progress = 1 khi còn ≥ 0.6 s, 0 khi tới lúc lý tưởng).
- `PP.Audio` (giữ hàm cũ để tương thích) + mới: `hit(kind, quality /* 'perfect'|'good'|'early'|'late' */, power)`, `bounce(surface)`, `net()`, `whistle()`, `cheer(level)`, `ooh()`, `swoosh()`, `squeak()`, `ambience(on, venueId)`, `setVolume(0..1)`, `click()`, `win()`, `lose()`, `unlock()`, `setMuted(b)`.

## G – tích hợp (agent chính)
Camera, cơ chế canh thời điểm (dùng `predictContact`, `strokeZone`, `C.PERFECT_LEAD`), lên lịch `ch.swing`, gửi hit đúng `contact.t`, hit-stop/rung, chữ nổi, nhãn tên DOM, màn Cài đặt, ảnh chân dung, phím Drop (U / B / RB / nút cảm ứng).
