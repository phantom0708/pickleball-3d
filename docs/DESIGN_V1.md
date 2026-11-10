# Kế hoạch: Game Pickleball 3D trên trình duyệt ("Pickle Pop")

> Tài liệu này dành cho agent lập trình (Antigravity). Hãy làm **theo đúng thứ tự các phase** và kiểm tra tiêu chí "Xong khi" ở cuối mỗi phase trước khi sang phase sau.

## 0. Mục tiêu & phạm vi

Game pickleball 3D dễ thương, chạy ngay trên trình duyệt: đấu với bot 3 cấp độ, nhiều loại cú đánh, vòng tròn canh thời điểm để đánh "PERFECT", nhân vật thú dễ thương mở khóa theo số trận thắng, sân có gió.

**Thiết kế gốc:** toàn bộ tên gọi, nhân vật, sân và hình ảnh là của Pickle Pop.

**Có trong v1:** chơi với Bot (Tập sự / Chuyên nghiệp / Cao thủ), đánh đơn, luật pickleball đầy đủ, bàn phím + tay cầm + cảm ứng, 3 sân, 9 nhân vật (3 nhân vật khóa), âm thanh tổng hợp, lưu tiến trình bằng localStorage.

**Online (mục 15–16, phase 7–10):** tìm trận nhanh 1v1, tạo phòng bằng mã 4 ký tự + link mời, phòng chờ có chat, đánh đôi 2v2 (cho phép thêm bot vào chỗ trống), xem trực tiếp, bảng xếp hạng theo số trận thắng online. Server Node.js + WebSocket.

**Chưa làm:** tài khoản đăng nhập (online dùng biệt danh + mã thiết bị), emote.

## 1. Công nghệ & cấu trúc

- HTML + CSS + JavaScript thuần, **không cần build**, chạy được khi mở trực tiếp `index.html` (file://).
  → Dùng **script thường (classic script)**, KHÔNG dùng ES module (Chrome chặn module khi mở qua file://).
- Three.js **r128** từ CDN: `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js` (bản này có build UMD `THREE` toàn cục).
- Font: Google Fonts "Baloo 2" (có hỗ trợ tiếng Việt).
- Namespace toàn cục: `window.PP`.
- Toàn bộ chữ trên giao diện bằng **tiếng Việt**.

```
pickel ball/
├── index.html          # canvas, các màn hình menu, HUD, điều khiển cảm ứng
├── style.css
├── README.md           # cách chạy offline/online, phím, cách deploy
├── shared/             # CHẠY ĐƯỢC CẢ TRÌNH DUYỆT LẪN NODE (dạng UMD, xem dưới)
│   ├── config.js       # hằng số, nhân vật, sân, cấp độ bot
│   ├── physics.js      # stepBall, simulate, solveShot, computeShot (hàm thuần)
│   ├── match.js        # class Match: trạng thái pha, luật, tính điểm, đơn & đôi
│   ├── ai.js           # bot (planIntercept, chọn cú) – dùng offline và trên server
│   └── protocol.js     # tên message, PROTOCOL_VERSION, hàm kiểm tra dữ liệu
├── js/                 # chỉ chạy trên trình duyệt
│   ├── audio.js        # âm thanh tổng hợp WebAudio
│   ├── world.js        # dựng sân/trang trí + model nhân vật
│   ├── input.js        # bàn phím, tay cầm, cảm ứng
│   ├── net.js          # kết nối WebSocket, đồng bộ đồng hồ, nội suy
│   ├── ui.js           # màn hình, HUD
│   └── game.js         # vòng lặp; chế độ Offline (LocalHost) & Online (NetClient)
├── server/
│   ├── package.json    # phụ thuộc duy nhất: ws
│   ├── index.js        # HTTP phục vụ file tĩnh + WebSocket
│   ├── rooms.js        # phòng, hàng chờ ghép trận, chat, khán giả
│   ├── matchHost.js    # chạy Match có thẩm quyền, kiểm tra cú đánh
│   ├── store.js        # lưu bảng xếp hạng (data/players.json)
│   └── test/           # node:test cho shared/ và server
├── Dockerfile
├── docker-compose.yml  # app + cloudflared (Cloudflare Tunnel)
├── docker-compose.override.example.yml  # chỉ dùng test local (publish 127.0.0.1:8080)
├── .env.example        # TUNNEL_TOKEN=
├── .gitignore          # .env, server/data/, node_modules/
└── deploy/
    └── DEPLOY.md       # hướng dẫn triển khai Ubuntu + Cloudflare Tunnel
```
Thứ tự load script trên trình duyệt: three → shared/config → shared/physics → shared/match → shared/ai → shared/protocol → js/audio → world → input → net → ui → game.

**Mẫu UMD cho file trong `shared/`:**
```js
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else { root.PP = root.PP || {}; Object.assign(root.PP, mod); }
})(typeof self !== 'undefined' ? self : this, function () { /* ... */ return { Physics }; });
```
Trên Node dùng `require('../shared/physics.js')`.

**Nguyên tắc kiến trúc (bắt buộc ngay từ Phase 2):**
- `shared/` **không được** đụng tới DOM, THREE hay `Math.random` trực tiếp. Dùng PRNG có seed (mulberry32) được truyền vào. Hàm vật lý chỉ dùng `+ - * / Math.sqrt Math.abs Math.min Math.max` để kết quả **giống hệt nhau** trên mọi máy.
- Bóng được mô tả bằng **sự kiện phát bóng (launch)** `{launchId, from:{x,y,z}, v:{x,y,z}, t0, wind}`. Vị trí bóng ở mọi thời điểm = mô phỏng lại từ launch với **bước cố định 1/240 giây (thời gian mô phỏng)**. Nhờ vậy client và server tính ra cùng một đường bóng, mạng chỉ cần gửi các cú đánh.
- `Match` (luật + điểm) chạy ở: **LocalHost** trong trình duyệt khi chơi với bot, và **server** khi chơi online. Phần hiển thị chỉ đọc trạng thái và sự kiện từ Match, không chứa luật.

## 2. Hệ tọa độ & kích thước (đơn vị: mét)

- `x` = chiều ngang sân, `y` = chiều cao, `z` = chiều dọc sân. Lưới nằm ở `z = 0`.
- **Người chơi** ở nửa `z > 0` (gần camera), nhìn về `-z`. **Bot** ở nửa `z < 0`.
- Hằng số (`PP.C`):

| Tên | Giá trị | Ý nghĩa |
|---|---|---|
| W | 3.05 | nửa chiều rộng sân (sân 20ft) |
| L | 6.7 | nửa chiều dài sân (sân 44ft) |
| K | 2.13 | độ sâu kitchen (7ft) tính từ lưới |
| NET_H | 0.86 | chiều cao lưới ở giữa |
| NET_POST_H | 0.91 | chiều cao lưới ở cột |
| NET_HALF | 3.35 | nửa chiều rộng lưới |
| G | 9.8 | trọng lực |
| R | 0.065 | bán kính bóng (to hơn thực tế để dễ nhìn) |
| TIME_SCALE | 0.92 | hệ số làm chậm mô phỏng bóng |
| PLAYER_SPEED | 5.2 | m/s |
| REACH | 1.25 | tầm với (khoảng cách ngang tới bóng) |
| SWEET | 0.55 | bán kính "điểm ngọt" |
| SWING_TIME | 0.32 s | thời gian một cú vung |
| PERFECT_WINDOW | 0.14 s | trúng bóng trong khoảng này kể từ lúc bấm + trong SWEET thì tính PERFECT |
| SWING_COOLDOWN | 0.15 s | thời gian chờ sau khi vung trượt |

Chiều cao lưới tại x: `NET_H + (NET_POST_H - NET_H) * min(1,|x|/NET_HALF)^2`.

## 3. Dữ liệu (config.js)

### Nhân vật (bản gốc, dựng bằng khối hình cơ bản)
| id | Tên | Emoji (thẻ chọn) | Tai/đặc điểm | Mở khóa |
|---|---|---|---|---|
| bunny | Thỏ Mochi | 🐰 | tai dài | 0 |
| bear | Gấu Bơ | 🐻 | tai tròn | 0 |
| cat | Mèo Mun | 🐱 | tai tam giác | 0 |
| pig | Heo Hồng | 🐷 | mũi heo + tai nhỏ | 0 |
| frog | Ếch Cốm | 🐸 | mắt lồi trên đỉnh đầu | 0 |
| penguin | Cánh Cụt Đá | 🐧 | mỏ cam, thân tối bụng trắng | 0 |
| fox | Cáo Lửa | 🦊 | tai tam giác cam, mõm trắng, đuôi | 1 trận thắng |
| panda | Gấu Trúc Tròn | 🐼 | tai đen, mảng mắt đen | 5 trận thắng |
| dino | Khủng Long Xanh | 🦖 | gai lưng + đuôi | 10 trận thắng |

Mỗi nhân vật có: `body`, `accent`, `belly`, màu `paddle`, `ears`, `unlock`.

### Sân
| id | Tên | Gió | Bối cảnh |
|---|---|---|---|
| gym | Nhà thi đấu Hoa Mai | không có | tường, khán đài, nền gỗ |
| beach | Bãi biển Gió Nam | thổi đều, hướng ngang, cố định cả trận (0.6) | cát, biển, cây dừa, dù |
| roof | Sân thượng Hoàng Hôn | gió giật, đổi hướng/cường độ mỗi pha (0.9) | lan can, tòa nhà có cửa sổ sáng, dây đèn |

Gió = gia tốc (m/s²) tác dụng lên bóng, chủ yếu theo trục x. Hiển thị mũi tên + cường độ trên HUD.

### Cấp độ bot
| | speed | react (s) | err (m) | reach | perfect | smash | home z | lên lưới | judge |
|---|---|---|---|---|---|---|---|---|---|
| Tập sự | 3.4 | 0.38 | 1.1 | 1.05 | 0.08 | 0.3 | -5.8 | không | 0.3 |
| Chuyên nghiệp | 4.4 | 0.22 | 0.6 | 1.18 | 0.30 | 0.7 | -4.6 | có | 0.75 |
| Cao thủ | 5.3 | 0.12 | 0.3 | 1.28 | 0.55 | 0.95 | -3.0 | có | 0.95 |

`judge` = xác suất bot nhận ra bóng sẽ ra ngoài và để bóng đi.

## 4. Vật lý bóng

- Bước mô phỏng: **bước cố định 1/240 giây thời gian mô phỏng**, dùng accumulator (`simTime += dt_thực * TIME_SCALE`, chạy đủ số bước). Giới hạn dt ≤ 1/30. Không dùng bước biến thiên, nếu không client và server sẽ lệch nhau.
- Mỗi bước: cộng gió vào vx/vz, trừ G vào vy, cập nhật vị trí. Không có lực cản (để giải quỹ đạo bằng công thức).
- **Va lưới:** nếu bóng đi qua mặt z=0 (đổi dấu z) trong lúc |x| < NET_HALF và `y - R < chiều cao lưới(x)` → đặt bóng về phía cũ, `vz *= -0.15`, giảm vx, vy; phát sự kiện `net`.
- **Nảy:** nếu `y < R` và `vy < 0` → `y = R`, `vy = -vy * 0.62` (nếu lực va < 0.6 thì vy = 0), vx, vz *= 0.8; phát sự kiện `bounce {x,z}` nếu lực va > 0.3.
- **simulate(ball, maxT):** chạy thử cùng hàm bước (dt 1/90, tính cả gió) → trả về danh sách mẫu `{t,x,y,z,bounces}`, điểm nảy đầu tiên `first`, cờ `net`. Dừng khi chạm lưới, nảy lần 2 hoặc hết maxT. Dùng cho marker điểm rơi và AI.

### Giải quỹ đạo cú đánh `solveShot(from, to, T, clear)`
- `vx = (to.x-from.x)/T`, `vz = (to.z-from.z)/T`, `vy = (R - from.y + 0.5*G*T²)/T`.
- Tính thời điểm qua lưới `tn = -from.z/vz`; nếu độ cao lúc đó < chiều cao lưới + R + clear → `T *= 1.1`, lặp (tối đa 10 lần). Không bù gió (gió làm bóng lệch, đó là chủ đích).

### Các loại cú đánh
| Cú | Độ sâu mục tiêu (|z|) | T theo khoảng cách d | clear | Ghi chú |
|---|---|---|---|---|
| Drive | 5.3 | 0.3 + 0.05d | 0.12 | nhanh, thấp |
| Dink | 1.15 (rơi vào kitchen) | 0.7 + 0.06d | 0.10 | nhẹ, ngắn |
| Lob | 5.9 | 1.35 + 0.05d | 0.6 | cao, sâu |
| Smash | 4.2 | 0.2 + 0.035d | 0.04 | chỉ khi bóng cao ≥ 1.3m, nếu không thì thành Drive |

- **Ngắm:** `aim.x ∈ [-1,1]` → `tx = aim.x * 2.5`; `aim.z ∈ [-1,1]` → độ sâu += aim.z (dink: ×0.7), giới hạn [0.5, 7.2].
- **Sai số:** `err = errBase * (1 - quality)` (PERFECT → 0); cộng nhiễu Gauss vào tx, tz (tz ×1.1).
- **PERFECT:** T ×0.85 với drive/smash, ×0.93 với dink/lob (bóng nhanh hơn, chính xác tuyệt đối).
- **Đánh hỏng:** nếu không perfect, quality < 0.35 và xác suất 40% → clear = -0.35 (dễ vào lưới).
- `launch()` đặt vận tốc bóng, `bounces = 0`, `lastHitter = who`, `hits++`, chạy simulate để lưu `rally.landing`; nếu người chơi đánh → reset kế hoạch của bot (`react = level.react`, `plan = null`, `hitDone = false`).

## 5. Luật pickleball & tính điểm

Trạng thái một pha: `server`, `hits` (số lần chạm, giao bóng = 1), `lastHitter`, `bounces` (số lần nảy kể từ cú đánh cuối), `boxSign` (dấu x của ô nhận giao bóng), `landing`.

### Giao bóng
- Người giao đứng sau vạch cuối sân: điểm của người giao **chẵn → bên phải**, lẻ → bên trái. Bên phải của người chơi là `+x`, của bot là `-x`. Vị trí: x = ±1.5, |z| = L + 0.45.
- Người nhận đứng chéo góc: `x = -x của người giao`, |z| = L + 0.2. `boxSign = -sign(x người giao)`.
- Người chơi giao: bấm phím Drive/Dink/Lob (Smash = Drive), giữ trái/phải để ngắm trong ô. Mục tiêu: Drive sâu 5.3 (T = 0.5+0.045d), Lob 5.8 (T = 1.55), Dink 3.1 (T = 1.0+0.03d), clear 0.15, sai số người chơi 0.3m, bot = err×0.45.
- Lúc chờ giao: người giao chỉ trượt ngang trong nửa sân của mình; người nhận di chuyển tự do. Bot giao sau 1.0–1.7s (Drive 70%, Lob 20%, Dink 10%).
- Bóng hiển thị nhấp nhô trong tay người giao.

### Phân xử khi bóng nảy lần đầu sau mỗi cú đánh
1. Nảy bên phần sân của người đánh → lỗi của người đánh ("LỖI!").
2. Giao bóng (hits = 1): rơi trong kitchen hoặc trên vạch kitchen (|z| ≤ K + 0.025) → "GIAO VÀO KITCHEN"; ngoài sân hoặc sai ô chéo → "GIAO HỎNG".
3. Các cú khác: ngoài sân (|x| > W+R hoặc |z| > L+R) → "OUT". Bóng chạm vạch tính là trong.
4. Nảy lần 2 trên cùng phần sân → người đánh cuối được điểm.
5. Chạm lưới → lỗi của người đánh ("LƯỚI!").

### Lỗi khi đánh
- **Luật 2 nảy:** khi `hits ≤ 2` (đỡ giao bóng, và cú thứ 3 của người giao) bóng phải nảy trước khi đánh. Với người chơi: **không xử lỗi**, cú vung đơn giản là không chạm bóng, và hiện gợi ý một lần "Luật 2 nảy: chờ bóng nảy rồi mới đánh!". Bot thì không bao giờ vi phạm.
- **Kitchen:** đánh bóng chưa nảy (volley) khi đang đứng trong kitchen (|z| < K) → "LỖI KITCHEN".
- Không được đánh bóng khi bóng còn bên sân đối phương; không được đánh 2 lần liên tiếp.

### Tính điểm (chọn ở menu)
- **Rally (mặc định):** ai thắng pha thì được 1 điểm và giành quyền giao.
- **Truyền thống (side-out, đánh đơn):** chỉ người giao được ghi điểm; người nhận thắng pha → đổi giao (thêm " · ĐỔI GIAO" vào lời phân xử).
- Điểm đích: 11 / 15 / 21, phải hơn 2 điểm mới thắng.
- Sau mỗi điểm: dừng 1.9s để hiện lời phân xử, sau đó vào pha giao mới hoặc kết thúc trận.

## 6. Điều khiển & đánh bóng của người chơi

| Hành động | Bàn phím | Tay cầm | Cảm ứng |
|---|---|---|---|
| Di chuyển | WASD / phím mũi tên | cần trái | joystick ảo bên trái |
| Drive | J hoặc Z | A | nút Drive |
| Dink | K hoặc X | B | nút Dink |
| Lob | L hoặc C | Y | nút Lob |
| Smash | I, V hoặc Space | X | nút Smash |
| Tạm dừng | Esc / P | Start | nút ⏸ |

- **Giữ hướng khi đánh để ngắm:** trái/phải = hướng ngang, lên = sâu hơn, xuống = ngắn hơn. Không giữ hướng thì aim.x ngẫu nhiên ±0.35.
- Di chuyển có gia tốc mượt (`v = lerp(v, target, 1-exp(-14dt))`). Giới hạn: x ∈ [-W-1.8, W+1.8], z ∈ [0.35, L+2.5] (không được qua lưới).
- Chặn hành vi mặc định của phím mũi tên/Space; bỏ qua phím lặp; xóa phím đang giữ khi cửa sổ mất focus.

### Vung vợt (cơ chế canh thời điểm)
1. Bấm phím đánh (khi đang trong pha, không đang vung, hết cooldown) → bắt đầu vung, lưu loại cú, `lastD = ∞`.
2. Mỗi frame trong lúc vung: nếu được phép đánh, hợp lệ theo luật 2 nảy, `d = khoảng cách ngang tới bóng < REACH` và `0.05 < ball.y < 2.4` → **chạm bóng** khi: d < SWEET, hoặc d bắt đầu tăng (bóng đã qua điểm gần nhất), hoặc sắp hết thời gian vung.
3. Chất lượng: trong SWEET → 0.85; ngoài SWEET → `0.75 - (d-SWEET)/(REACH-SWEET)*0.5`. **PERFECT** = d < SWEET **và** thời gian vung ≤ PERFECT_WINDOW → quality 1, hiện chữ "PERFECT!" + vòng sáng xanh.
4. Vung trượt → cooldown 0.15s.

### Gợi ý hình ảnh
- **Vòng canh thời điểm:** vòng tròn trên mặt sân quanh chân người chơi, bán kính = khoảng cách ngang tới bóng (khi bóng đang bay về phía mình và còn cách < 3.2m). Màu trắng → vàng (trong tầm với) → **xanh lá** (trong SWEET và đánh hợp lệ). Bấm khi vòng chuyển xanh sẽ ra PERFECT.
- Một vòng mờ cố định bán kính SWEET quanh người chơi.
- **Marker điểm rơi:** vòng màu cam tại `rally.landing` khi bóng đang bay về phía người chơi và chưa nảy.
- Bóng có bóng đổ dạng đốm tròn (blob shadow) co giãn theo độ cao.

## 7. AI của bot

- Khi người chơi vừa đánh: chờ hết `react` (vẫn đi dần về vị trí chờ), sau đó gọi `planIntercept()` **một lần**:
  - simulate 4s. Nếu bóng sẽ chạm lưới → để bóng đi.
  - Nếu điểm nảy đầu sẽ ra ngoài (hoặc giao hỏng/vào kitchen) và `random < judge` → để bóng đi (`leave`).
  - `mustBounce = hits ≤ 2`. Chiều cao đánh tối đa = 2.15 nếu `random < smash`, ngược lại 1.45.
  - Duyệt từng mẫu bên sân bot (z < -0.3, trước lần nảy thứ 2): bỏ qua nếu (mustBounce hoặc mẫu nằm trong kitchen K+0.15) mà bóng chưa nảy; bỏ qua nếu y ngoài [0.15, maxH]; chọn mẫu đầu tiên mà `(khoảng cách - 0.35)/speed ≤ t / TIME_SCALE`.
  - Nếu không có mẫu nào: chọn mẫu sau lần nảy đầu (dự phòng), nếu không nữa thì về vị trí chờ.
- Di chuyển về điểm mục tiêu với tốc độ tối đa `speed` (làm mượt). Giới hạn trong nửa sân của bot.
- **Đánh:** khi đang có bóng tới, chưa đánh, không `leave`, đúng luật (phải nảy nếu mustBounce hoặc bot đang đứng trong kitchen), `d < reach`, 0.05 < y < 2.3, và (d < 0.45 hoặc d bắt đầu tăng).
- **Chọn cú:**
  - bóng cao > 1.35 và ngoài kitchen, `random < smash` → Smash
  - đỡ giao bóng / cú thứ 3 (hits ≤ 2) → Drive 80% / Lob 20%
  - bot đứng gần lưới (|z| < 3.6), bóng thấp < 0.95 → Dink 60%
  - người chơi đang ở lưới (z < 3.4) → Lob 30%
  - còn lại: Drive 60% / Dink 20% / Lob 20%
- **Ngắm:** về phía xa người chơi (`aim.x = ∓0.35..0.95`), trộn với hướng ngẫu nhiên theo `judge`. PERFECT với xác suất `perfect`, nếu không thì quality ngẫu nhiên 0.35–0.85, errBase = `err`.
- **Vị trí chờ sau khi đánh:** nếu cấp độ có lên lưới và hits ≥ 2 → z = `home`; ngược lại z = -(L-0.6). x đi theo bóng (`ball.x*0.4`, giới hạn ±1.5).

## 8. Đồ họa (world.js)

- Renderer: antialias, pixelRatio ≤ 2, bật shadow PCFSoft. Ánh sáng: Hemisphere 0.7 + Directional 0.9 tại (5,12,6) có đổ bóng (vùng ±10, map 2048).
- **Sân:** nền lớn 120×120 (màu theo sân); vùng ngoài sân (2W+5)×(2L+7); mặt sân 2W×2L; 2 kitchen màu nhạt hơn (mặt sân pha 18% trắng); vạch trắng rộng 5cm (vạch cuối, vạch biên, vạch kitchen, vạch giữa từ K đến L), mỗi lớp cao hơn chút để tránh z-fighting.
- **Lưới:** 2 cột trụ, mặt lưới là plane dùng texture canvas dạng ô lưới (trong suốt, DoubleSide), có dải băng trắng phía trên ở độ cao ~0.87.
- **Trang trí:** như bảng ở mục 3 (dùng hình khối đơn giản, ít polygon).
- **Nhân vật** `PP.buildCharacter(def)` → `{root, update(dt, speed, swingProgress)}`:
  - thân = hình cầu kéo giãn, bụng, đầu, mắt có điểm sáng, má hồng, tai/đặc điểm theo `ears`, 2 bàn chân, tay trái.
  - tay phải là một pivot giữ **vợt pickleball** (mặt vợt oval = cylinder dẹt, cán, viền tối; màu theo nhân vật). Model hướng mặt về +z ở hệ cục bộ; tay phải đặt ở local -x.
  - hoạt ảnh: nhún khi chạy (`|sin|`), nghiêng nhẹ; khi vung: pivot xoay y từ -1.1 → 1.5 kèm xoay thân, sau đó trở lại -0.2.
  - người chơi `root.rotation.y = π`, bot = 0.
- **Bóng:** cầu vàng chanh, có emissive nhẹ. Hiệu ứng: vòng trắng lan ra khi bóng nảy, vòng xanh khi PERFECT (tự mờ dần và xóa).
- **Camera:** ngang: vị trí (P.x*0.35, 6.4, 13.2), nhìn (P.x*0.15, 0.4, -1.8), fov 50. Dọc (màn hình đứng): (P.x*0.25, 10.5, 16.5), nhìn (0,0,-1), fov 62. Di chuyển mượt (`lerp 1-exp(-3dt)`). Ở menu: camera xoay chậm quanh sân.
- Khi bắt đầu trận mới: dispose geometry/material của scene cũ.

## 9. Âm thanh (audio.js)

WebAudio tổng hợp (không cần file âm thanh), chỉ khởi tạo sau lần tương tác đầu tiên:
`hit(power)` (tiếng "póc" sóng vuông + nhiễu ngắn), `perfect()` (ting cao), `bounce()`, `net()` (nhiễu trầm), `whistle()`, `cheer()` (nhiễu lọc dài khi người chơi được điểm), `click()` cho menu, `toggle()` để tắt/bật tiếng (lưu vào save).

## 10. Giao diện (index.html / style.css)

Phong cách: sặc sỡ, bo tròn, nút to, thẻ menu nền mờ (backdrop blur), font Baloo 2. Responsive cho cả điện thoại dọc.

Các màn hình (`.screen`, mỗi lúc chỉ hiện một màn):
1. **Màn chính:** logo "Pickle Pop", nút "Chơi với Bot", "Hướng dẫn", "Âm thanh: Bật/Tắt", thống kê thắng/thua.
2. **Chuẩn bị trận:** lưới thẻ nhân vật (emoji + tên, thẻ khóa ghi "🔒 Thắng N trận"), chọn cấp độ (3 nút), chọn sân (3 thẻ có mô tả gió), điểm đích 11/15/21, cách tính điểm Rally/Truyền thống, nút "Bắt đầu". Các lựa chọn được lưu lại.
3. **Hướng dẫn:** bảng phím, giải thích kitchen, luật 2 nảy, giao chéo, PERFECT, gió.
4. **Tạm dừng:** Tiếp tục / Chơi lại / Về menu.
5. **Kết thúc:** "CHIẾN THẮNG!" hoặc "THUA RỒI!", tỉ số, thông báo nhân vật mới mở khóa, nút "Đấu lại" / "Menu".

**HUD:** bảng điểm phía trên (avatar emoji + "Bạn" + điểm | "Chạm 11" + gió | điểm + tên bot), chấm báo ai đang giao; nút ⏸; lời phân xử lớn ở giữa (OUT / LƯỚI! / LỖI KITCHEN / GIAO HỎNG / GHI ĐIỂM! + dòng phụ "+1 cho bạn"/"Đổi giao bóng"), chữ bật lên (PERFECT!, SMASH!), dòng thông báo (ví dụ "Bạn giao bóng: Drive · Dink · Lob"), dòng gợi ý, chú thích phím ở dưới (chỉ trên máy tính).

**Cảm ứng:** chỉ hiện khi `pointer: coarse`/có touch: joystick trái (pointer events, bán kính 50px), 4 nút tròn bên phải, `touch-action: none`.

Bot dùng nhân vật ngẫu nhiên khác với nhân vật của người chơi.

## 11. Lưu tiến trình

localStorage key `pp-save`: `{wins, losses, char, level, venue, target, scoring, muted}`. Mọi lần đọc/ghi phải bọc try/catch (game vẫn chạy bình thường nếu localStorage bị chặn). Kết thúc trận: cộng thắng/thua, so ngưỡng `unlock` trước/sau để báo nhân vật mới.

## 12. Vòng lặp & trạng thái

`state ∈ menu | serve | rally | point | paused | over`

```
loop():
  dt = min(clock.getDelta(), 1/30); Input.poll()   // tay cầm
  nếu serve/rally/point: updatePlayer, updateBot, updateBall
     point: đếm ngược pointTimer → setupServe() hoặc gameOver()
  updateVisuals(dt); render
```
Tạm dừng: lưu `prevState`; khi tiếp tục thì gọi `clock.getDelta()` để bỏ khoảng thời gian đã dừng.

## 13. Các phase thực hiện

**Phase 1 – Khung & sân:** index.html, style.css, config.js, world.js (sân 3 bối cảnh + nhân vật), camera, resize. *Xong khi:* mở file thấy sân 3D và 2 nhân vật, không có lỗi console, hiển thị tốt cả màn hình ngang lẫn dọc.

**Phase 2 – Vật lý & đánh bóng:** `shared/physics.js` (stepBall, simulate, solveShot, computeShot theo mô hình launch), input bàn phím, vung vợt/PERFECT, vòng canh thời điểm, marker điểm rơi. *Xong khi:* đánh qua lại được với một bot đơn giản (tạm thời luôn trả bóng); test node cho thấy simulate từ cùng một launch luôn cho kết quả giống hệt nhau.

**Phase 3 – Luật & tính điểm:** `shared/match.js` (giao bóng, phân xử khi nảy, lưới, kitchen, luật 2 nảy, rally/side-out, kết thúc trận) chạy trong LocalHost; HUD + lời phân xử. *Xong khi:* chơi trọn một trận đến 11 với đúng luật thắng cách 2 điểm, và có unit test cho từng luật.

**Phase 4 – AI 3 cấp:** `shared/ai.js` (bot chỉ gửi ý định di chuyển/đánh giống một người chơi, để server dùng lại được). Gồm planIntercept, chọn cú, ngắm, để bóng ra ngoài đi, lên lưới. *Xong khi:* Tập sự dễ thắng, Cao thủ khó thắng rõ rệt.

**Phase 5 – Menu, lưu, mở khóa, âm thanh, gió:** toàn bộ màn hình ở mục 10, localStorage, WebAudio, gió theo sân.

**Phase 6 – Cảm ứng, tay cầm, hoàn thiện:** joystick + nút, Gamepad API, hiệu ứng, README.

## 14. Checklist kiểm thử thủ công

- [ ] Mở trực tiếp `index.html` (file://) trong Chrome, Safari: không có lỗi console.
- [ ] Giao bóng đúng bên theo điểm chẵn/lẻ, đúng ô chéo; giao vào kitchen/sai ô → lỗi.
- [ ] Đánh bóng chưa nảy khi đỡ giao bóng → vung trượt + gợi ý (không bị xử lỗi).
- [ ] Volley khi đứng trong kitchen → "LỖI KITCHEN".
- [ ] Bóng ra ngoài → OUT; vào lưới → LƯỚI!; bóng nảy 2 lần → điểm cho người đánh cuối.
- [ ] Side-out: người nhận thắng pha chỉ giành quyền giao, không được điểm.
- [ ] Thắng phải hơn 2 điểm (ví dụ 11–10 chưa kết thúc).
- [ ] Bấm khi vòng chuyển xanh → PERFECT, bóng nhanh và đi đúng hướng ngắm.
- [ ] Gió ở bãi biển/sân thượng làm bóng lệch rõ, nhất là cú Lob.
- [ ] Thắng 1 trận → mở khóa Cáo Lửa, tải lại trang vẫn còn.
- [ ] Điện thoại dọc: thấy toàn bộ sân, joystick/nút hoạt động, trang không bị cuộn.
- [ ] Tạm dừng/tiếp tục không làm bóng nhảy vị trí.
- [ ] Giữ FPS ổn định (~60) trên laptop thường.

---

## 15. Chơi online – kiến trúc

### 15.1 Mô hình đồng bộ: "người đánh quyết định, server phân xử"
Game cần canh thời điểm chính xác tới ~0.1s, nên không thể bắt người chơi chờ server xác nhận mới thấy cú đánh. Cách làm:

1. **Đường bóng tất định:** server gửi sự kiện `launch` (vị trí, vận tốc, thời điểm `t0` theo đồng hồ server, gió). Mỗi client tự mô phỏng bóng từ launch → hai máy thấy cùng một đường bóng.
2. **Vị trí người chơi do client gửi** (20 lần/giây). Server kiểm tra tốc độ ≤ PLAYER_SPEED × 1.15 và giới hạn sân; vượt quá thì kẹp lại và gửi vị trí sửa cho client.
3. **Cú đánh do client của người đánh quyết định:** client nhận thấy chạm bóng trên màn hình của mình (đúng cơ chế vung/PERFECT như offline), tự tính vận tốc bằng `computeShot` (sai số dùng PRNG của client) rồi gửi `hit {launchId, ballT, pos, from, v, shot, perfect}`. Ngay lập tức client hiển thị cú đánh (dự đoán phía client).
4. **Server kiểm tra** (mục 15.3). Hợp lệ → phát `launch` mới cho mọi người (t0 = ballT). Không hợp lệ → gửi `hit_rejected` và bóng tiếp tục theo đường cũ (client phải quay lại đường cũ).
5. **Server là trọng tài duy nhất:** chạy `Match` ở 60Hz, phát hiện nảy/out/lưới/nảy 2 lần từ chính đường bóng tất định đó và gửi `point`.

### 15.2 Đồng hồ & độ trễ
- **Đồng bộ đồng hồ:** khi vào, client gửi 5 lần `ping {c}` → `pong {c, s}`; lấy mẫu có RTT nhỏ nhất: `offset = s + RTT/2 - c`. Lặp lại mỗi 10 giây. `serverNow() = Date.now() + offset`.
- **Bóng phía đối thủ:** launch tới muộn RTT/2, nên client tua nhanh tới `serverNow() - t0`. Để bóng không giật, hiển thị = vị trí mô phỏng + một độ lệch hình ảnh giảm dần về 0 trong 150ms.
- **Người chơi đối phương:** đệm và nội suy, hiển thị trễ 100ms so với thời gian server.
- **Ân hạn khi phân xử (GRACE = 200ms):** khi đường bóng tạo ra một sự kiện kết thúc pha tại thời điểm `td` (nảy 2 lần, nảy đầu ra ngoài) mà người nhận vẫn còn có thể đánh, server **chờ tới `td + GRACE`** mới chốt điểm. Nếu trong lúc đó có `hit` hợp lệ với `ballT < td` → chấp nhận cú đánh, hủy sự kiện. Bóng vào lưới hoặc nảy bên sân người đánh thì chốt ngay.
- Trò chơi vẫn chơi được với RTT ≤ 250ms; trên 400ms hiện cảnh báo "Mạng chậm".

### 15.3 Server kiểm tra cú đánh (`matchHost.js`)
Từ chối nếu một trong các điều sau xảy ra:
- `launchId` không phải launch hiện tại, hoặc pha đã chốt điểm.
- Người gửi không có quyền đánh: cùng đội với người đánh cuối, hoặc bóng tại `ballT` đang ở bên sân kia.
- `ballT > serverNow + 50ms` hoặc `ballT < serverNow - 350ms`.
- `pos` lệch > 0.6m so với vị trí server đang giữ của người đó (đã ngoại suy tới ballT).
- Khoảng cách ngang từ `pos` tới bóng (server mô phỏng tại ballT) > REACH + 0.35, hoặc độ cao bóng ngoài [0.03, 2.5].
- `from` lệch > 0.15m so với vị trí bóng server tính được.
- `|v|` vượt mức tối đa của loại cú (Drive 22, Dink 12, Lob 16, Smash 28 m/s; sau khi tính perfect).
- Vi phạm luật 2 nảy → từ chối im lặng. **Volley trong kitchen thì không từ chối mà xử lỗi "LỖI KITCHEN"** (giống offline).

Giao bóng online: người giao gửi `hit` với `serve: true`; server kiểm tra người gửi đúng là người giao và `pos` đúng vị trí giao. Nếu người giao không giao trong 10s thì server tự giao một cú Drive.

### 15.4 Hệ tọa độ & góc nhìn
- Server luôn dùng tọa độ chuẩn: đội A ở `z > 0`, đội B ở `z < 0`.
- Client của đội B **lật góc nhìn**: khi hiển thị nhân `x, z` với `flip = -1`; khi gửi input/hit thì lật ngược lại. Việc lật chỉ làm ở lớp hiển thị/input (một hàm `toView`/`fromView`), không làm trong shared.
- Kết quả: ai cũng thấy mình ở phía gần camera.

### 15.5 Giao thức (JSON qua WebSocket, `shared/protocol.js`)
Mọi message đều có dạng `{t: "<loại>", ...}`. Khai báo `PROTOCOL_VERSION`; nếu khác phiên bản thì server trả lỗi `version` và client hiện "Vui lòng tải lại trang".

**Client → Server**
| t | dữ liệu | ghi chú |
|---|---|---|
| hello | deviceId, name, char, version | deviceId = UUID lưu localStorage |
| ping | c | |
| queue_join / queue_leave | mode: '1v1' \| '2v2' | |
| room_create | mode, settings | settings = {venue, target, scoring} |
| room_join | code | |
| room_leave | | |
| room_update | settings / team / fillBots | chỉ chủ phòng được sửa settings & fillBots |
| room_ready | ready | |
| room_start | | chủ phòng; mọi người phải sẵn sàng |
| chat | text | ≤ 120 ký tự, tối đa 1 tin/giây |
| input | seq, x, z, vx, vz, swing? | 20Hz, tọa độ chuẩn |
| hit | launchId, ballT, pos, from, v, shot, perfect, serve? | |
| rematch | | cả hai bấm thì đấu lại |
| list_live / spectate / spectate_leave | matchId | |
| leaderboard | | |

**Server → Client**
| t | dữ liệu |
|---|---|
| welcome | playerId, serverTime |
| pong | c, s |
| error | code, message (version, room_not_found, room_full, rate_limit, …) |
| queue_status | mode, waiting |
| room_state | code, mode, hostId, settings, players[{id,name,char,team,ready,connected,isBot}] |
| chat | from, name, text |
| match_start | matchId, seed, settings, players, yourTeam |
| serve_setup | rallyId, server, positions, wind, score |
| state | ts, players[{id,x,z,vx,vz,swing}] (20Hz) |
| launch | launchId, rallyId, by, from, v, t0, hits, serve |
| hit_rejected | launchId, reason |
| point | winner, call, score, server, sideOut |
| match_over | winnerTeam, score, stats |
| player_status | id, connected, graceSec |
| live_list | [{matchId, players, score, viewers}] |
| leaderboard | [{name, wins, losses}] (top 20) |

### 15.6 Phòng, ghép trận, khán giả
- **Mã phòng:** 4 ký tự từ bảng chữ không gây nhầm `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. **Link mời:** `https://<host>/?room=CODE`, mở link sẽ vào thẳng phòng (hỏi biệt danh nếu chưa có).
- Phòng 1v1 có 2 chỗ; phòng 2v2 có 4 chỗ chia đội A/B, người chơi tự chọn đội; chủ phòng bật "Thêm bot vào chỗ trống" (chọn cấp độ).
- **Tìm trận nhanh:** hàng chờ FIFO theo mode. Đủ người → tạo phòng và bắt đầu ngay với sân ngẫu nhiên, chạm 11, tính Rally.
- Phòng tự xóa sau 10 phút không hoạt động hoặc khi không còn ai.
- **Xem trực tiếp:** danh sách trận đang diễn ra; khán giả nhận `match_start` + trạng thái hiện tại + mọi sự kiện sau đó, chỉ được xem, góc nhìn của đội A, có hiện số người xem.
- **Mất kết nối:** trận tạm dừng, đếm ngược 30s. Kết nối lại bằng cùng deviceId → tiếp tục với cùng trạng thái (gửi lại match_start + serve_setup + score). Hết 30s → đối phương thắng (xử thua do bỏ cuộc). Trong phòng 2v2 có bot, người rời trận có thể được bot thay.

### 15.7 Đánh đôi 2v2 (luật)
- Dùng mặt sân như đánh đơn (pickleball đơn và đôi dùng cùng kích thước sân). Mỗi đội 2 người, người chơi giữ một nửa sân trái/phải lúc giao.
- v1 chỉ dùng **tính điểm Rally** cho 2v2: điểm của đội giao chẵn → người đứng bên phải giao; đội giao thắng điểm → hai người trong đội đổi bên cho nhau; đội nhận thắng → giành quyền giao.
- Áp dụng luật 2 nảy, kitchen như đánh đơn. Hai người cùng đội không được đánh liên tiếp ở cùng một cú (chỉ cần một người chạm là xong).
- Server tính `canHit` theo đội. Mỗi client làm nổi người chơi của mình bằng một vòng màu dưới chân và tên trên đầu. Camera vẫn đặt sau đội mình.
- `Match` phải nhận số người mỗi đội (1 hoặc 2) ngay từ khi viết ở Phase 3, để không phải viết lại.

### 15.8 Bảng xếp hạng & danh tính
- Không có đăng nhập. Danh tính = `deviceId` (UUID trong localStorage) + biệt danh 2–16 ký tự (lọc ký tự điều khiển, cắt khoảng trắng). Ghi rõ trên giao diện: xóa dữ liệu trình duyệt sẽ mất thành tích.
- `store.js` lưu `server/data/players.json` dạng `{deviceId: {name, wins, losses}}`, ghi file theo kiểu ghi file tạm rồi đổi tên (atomic) và gộp nhiều lần ghi trong 2s. Chỉ trận online giữa người thật mới được tính (trận có bot thì không).
- Top 20 theo số thắng; hiện trên màn hình Online.

### 15.9 Bảo mật & chống gian lận cơ bản
- Kiểm tra mọi message bằng hàm validate trong protocol.js (kiểu, phạm vi số, độ dài chuỗi); message sai → bỏ qua, quá nhiều lần → ngắt kết nối.
- Giới hạn 60 message/giây mỗi socket, payload tối đa 4KB.
- Hiển thị tên và chat bằng `textContent` (không bao giờ dùng innerHTML với dữ liệu người dùng).
- Server là bên duy nhất quyết định điểm, vị trí giao, gió (seed) và kết quả trận.

### 15.10 Server & triển khai
- Node.js ≥ 20, phụ thuộc duy nhất là `ws`. `server/index.js` vừa phục vụ file tĩnh của game (thư mục gốc dự án, chặn path traversal) vừa phục vụ WebSocket ở `/ws`. Cổng lấy từ `PORT` (mặc định 8080).
- Client kết nối tới `(location.protocol==='https:'?'wss':'ws') + '://' + location.host + '/ws'`; có thể ghi đè bằng `?server=` để test.
- **Chế độ offline vẫn chạy được khi mở file://**; nút "Online" sẽ báo "Hãy mở game qua server để chơi online" nếu `location.protocol === 'file:'`.
- Biến môi trường test `LAG_MS` (thêm độ trễ giả cho mọi message) và `JITTER_MS`.
- Chạy local: `cd server && npm install && npm start` rồi mở `http://localhost:8080`.
- Endpoint `GET /healthz` trả `{ok:true, rooms, matches, players, version}` để giám sát.

### 15.10b Triển khai: Ubuntu + Docker + Cloudflare Tunnel
Môi trường thật: **server Ubuntu (22.04/24.04) của người dùng, công khai ra internet bằng Cloudflare Tunnel**. Không mở cổng web nào trên server, không cần Nginx, không cần tự cài chứng chỉ HTTPS (Cloudflare lo HTTPS). Viết `deploy/DEPLOY.md` hướng dẫn từng bước bằng tiếng Việt, gồm các bước dưới đây.

**Sơ đồ:** người chơi ⇄ `https://game.<domain>` (Cloudflare) ⇄ tunnel ⇄ container `cloudflared` ⇄ mạng Docker nội bộ ⇄ container `app` (Node, cổng 8080). Cổng 8080 **không publish** ra host.

**Bước 1 – Chuẩn bị Ubuntu**
- Cài Docker Engine + Compose plugin từ repo chính thức của Docker (`docker-ce`, `docker-compose-plugin`), thêm user vào nhóm `docker`.
- Tường lửa `ufw`: `default deny incoming`, chỉ `allow OpenSSH`, rồi `enable`. Tunnel là kết nối đi ra (outbound) nên không cần mở thêm cổng nào.
- Clone repo vào `/opt/pickle-pop`.

**Bước 2 – Tạo tunnel (quản lý trên dashboard, dùng token)**
- Cloudflare dashboard → Zero Trust → Networks → Tunnels → Create tunnel (loại Cloudflared), đặt tên `pickle-pop`, chọn môi trường Docker, sao chép **token**.
- Thêm **Public Hostname**: `game.<domain>` → Service `HTTP` → URL `app:8080` (tên service Docker).
- Lưu token vào `/opt/pickle-pop/.env` dạng `TUNNEL_TOKEN=...` (file này bị gitignore, `chmod 600`).

**Bước 3 – Chạy**
- `docker compose up -d --build`, kiểm tra bằng `docker compose ps`, `docker compose logs -f app cloudflared`.
- Kiểm tra trạng thái tunnel trên dashboard phải là *Healthy*.

**`docker-compose.yml`:**
- service `app`: build từ `Dockerfile`, `restart: unless-stopped`, **không có `ports:`**, volume `./server/data:/app/server/data`, env: `NODE_ENV=production`, `PORT=8080`, `HOST=0.0.0.0` (bên trong container), `TRUST_PROXY=cloudflare`, `ALLOWED_ORIGINS=https://game.<domain>`.
- service `cloudflared`: image `cloudflare/cloudflared` (ghim phiên bản cụ thể), `command: tunnel --no-autoupdate run`, `environment: TUNNEL_TOKEN=${TUNNEL_TOKEN}`, `restart: unless-stopped`, `depends_on: app`.
- Chỉ cho test local: file `docker-compose.override.example.yml` publish `127.0.0.1:8080:8080`.

**`Dockerfile`:** node:20-alpine, chạy bằng user `node` (không phải root), `npm ci --omit=dev` trong `server/`, copy `index.html`, `style.css`, `js/`, `shared/`, `server/`; `HEALTHCHECK` gọi `http://127.0.0.1:8080/healthz`.

**Cấu hình Cloudflare (dashboard của domain):**
- Network → **WebSockets: On** (mặc định đã bật).
- Speed → Optimization: **tắt Rocket Loader**, vì nó đổi thứ tự chạy các file JS và làm game lỗi.
- SSL/TLS → Edge Certificates: bật **Always Use HTTPS**. Khi đó client tự dùng `wss://`.
- Caching → Cache Rules: *Bypass cache* cho `/ws*`, `/healthz` và HTML (`/`, `/index.html`). File JS/CSS gắn version trên URL (`?v=<version>`); `server/index.js` trả `Cache-Control: public, max-age=31536000, immutable` cho URL có `?v=`, `no-cache` cho HTML.
- Tùy chọn: Security → WAF rate limiting cho `/ws` (ví dụ 30 kết nối mới/phút/IP).

**Điều chỉnh code vì chạy sau Cloudflare Tunnel:**
- **Heartbeat:** Cloudflare ngắt WebSocket không hoạt động sau ~100 giây. Server gửi ws ping mỗi 25 giây và đóng socket không trả pong sau 2 lần. Client coi socket đã chết nếu không nhận được message nào trong 10 giây khi đang trong trận, rồi kết nối lại.
- **Tự kết nối lại:** backoff 0.5s → 1s → 2s → 5s (tối đa 30s), gửi `hello` với cùng deviceId → server ghép lại vào phòng/trận (cơ chế 30s ở 15.6). Kết nối có thể rớt khi Cloudflare bảo trì hoặc khi container cloudflared restart.
- **IP thật:** mọi kết nối tới `app` đều đi từ container cloudflared (IP thuộc mạng Docker nội bộ). Với `TRUST_PROXY=cloudflare`, **chỉ tin `CF-Connecting-IP` khi địa chỉ kết nối là IP nội bộ** (10/8, 172.16/12, 192.168/16, 127/8). Dùng IP này để giới hạn tần suất và tối đa 6 kết nối mỗi IP. Không có header hợp lệ thì dùng địa chỉ kết nối.
- **Kiểm tra Origin:** khi upgrade WebSocket, chỉ chấp nhận `Origin` nằm trong `ALLOWED_ORIGINS`. Khi dev, `http://localhost:8080` được thêm tự động nếu `NODE_ENV !== 'production'`.
- **Tắt máy êm:** khi nhận SIGTERM (`docker compose up -d` lúc cập nhật sẽ gửi), gửi `server_restart` cho client (hiện "Server đang cập nhật, đang kết nối lại…"), ghi store xuống đĩa, đóng socket, thoát trong ≤ 5 giây (`stop_grace_period: 10s`). Bản đầu chưa lưu trạng thái trận, nên trận đang chơi sẽ mất. DEPLOY.md khuyên deploy vào giờ vắng.
- Độ trễ của tunnel thường thêm 10–40ms, vẫn trong ngân sách 250ms ở 15.2.

**Vận hành (ghi trong DEPLOY.md):**
- Cập nhật: `cd /opt/pickle-pop && git pull && docker compose up -d --build`. Tăng `PROTOCOL_VERSION` mỗi khi đổi giao thức.
- Xem log: `docker compose logs -f --tail=200 app`. Docker giới hạn log (`logging: json-file, max-size 10m, max-file 3`).
- Sao lưu: `server/data/players.json` (ví dụ cron hằng ngày copy sang thư mục backup).
- Gỡ lỗi nhanh: tunnel *Down* → xem log cloudflared / kiểm tra token; trang 502 → `app` chưa chạy hoặc sai URL `app:8080` trong Public Hostname; vào được trang nhưng không chơi online được → kiểm tra WebSockets On, Origin, Rocket Loader.

**Kiểm thử sau khi deploy:**
- [ ] `curl https://game.<domain>/healthz` trả `ok:true`.
- [ ] `curl http://<IP-server>:8080` từ ngoài **không kết nối được** (cổng không mở).
- [ ] Hai thiết bị khác mạng (Wi-Fi + 4G) chơi trọn một trận online.
- [ ] Để tab ở phòng chờ 5 phút không thao tác → vẫn còn kết nối.
- [ ] `docker compose restart app` khi đang ở phòng → client tự kết nối lại và vào lại phòng.
- [ ] Sau khi deploy bản mới, tải lại trang nhận đúng JS mới (không dính cache).

### 15.11 Giao diện online (bổ sung vào mục 10)
- Màn chính có thêm nút **"Chơi online"** (lần đầu sẽ hỏi biệt danh).
- **Màn Online:** "Tìm trận 1v1", "Tìm trận 2v2", "Tạo phòng" (chọn 1v1/2v2), ô "Nhập mã phòng", danh sách **Đang diễn ra** (nút Xem + số người xem), **Bảng xếp hạng**, chỉ báo ping.
- **Phòng chờ:** mã phòng to + nút "Sao chép link mời", danh sách người chơi theo đội (trạng thái sẵn sàng, đang kết nối), cài đặt trận (chỉ chủ phòng sửa), bật/tắt thêm bot, khung chat, nút Sẵn sàng / Bắt đầu.
- **Đang tìm trận:** đồng hồ đếm thời gian chờ + nút Hủy.
- **Trong trận online:** HUD hiện tên thật, ping, biểu tượng mất kết nối + đếm ngược 30s. Tạm dừng chỉ mở menu (không dừng trận), trong đó có nút "Rời trận" (bị xử thua).
- **Kết thúc online:** nút "Đấu lại" (đợi đối thủ đồng ý) và "Về sảnh".

## 16. Phase online

**Phase 7 – Server nền tảng:** server/index.js (file tĩnh + ws), protocol + validate, hello/ping, đồng bộ đồng hồ, phòng (tạo/vào/rời/chat/sẵn sàng/bắt đầu), link mời. *Xong khi:* hai tab trình duyệt vào chung phòng bằng mã, chat được, đúng thông báo lỗi khi phòng đầy hoặc sai mã.

**Phase 8 – Trận 1v1 online:** matchHost chạy Match 60Hz, input 20Hz + nội suy, lật góc nhìn cho đội B, hit dự đoán phía client + server kiểm tra + hit_rejected, GRACE window, giao bóng online, point/match_over, đấu lại. *Xong khi:* chơi trọn một trận giữa 2 tab với `LAG_MS=100 JITTER_MS=30`, không có lần nào hai bên thấy kết quả điểm khác nhau.

**Phase 9 – Ghép trận, mất kết nối, khán giả, bảng xếp hạng:** hàng chờ, kết nối lại trong 30s / xử thua, danh sách trận đang diễn ra + chế độ xem, store.js + bảng xếp hạng. *Xong khi:* tắt mạng một tab rồi bật lại trong 30s thì trận tiếp tục được; tab thứ 3 xem được trận.

**Phase 10 – Đánh đôi 2v2:** Match cho 2 người/đội, xoay vòng giao bóng Rally, canHit theo đội, phòng 4 chỗ + chọn đội + bot lấp chỗ (server chạy shared/ai.js), hàng chờ 2v2. *Xong khi:* chơi được 2 người thật + 2 bot, và đủ 4 tab người thật.

**Phase 11 – Triển khai Ubuntu + Cloudflare Tunnel:** heartbeat, tự kết nối lại, CF-Connecting-IP, kiểm tra Origin, cache/version file tĩnh, graceful shutdown, /healthz, Dockerfile + docker-compose (app + cloudflared), `.env.example`, `deploy/DEPLOY.md`. *Xong khi:* đạt toàn bộ phần "Kiểm thử sau khi deploy" ở 15.10b trên domain thật.

> Gợi ý: nên làm phần heartbeat + tự kết nối lại ngay ở Phase 7–8, vì chạy local cũng cần.

## 17. Kiểm thử online

**Unit test (`node --test server/test`):**
- [ ] Tất định: cùng một launch → simulate trên Node và trong trình duyệt (xuất ra JSON từ một trang test) cho kết quả trùng tới 1e-9.
- [ ] Match: từng luật ở mục 5 (giao hỏng, kitchen, 2 nảy, out, lưới, side-out, thắng cách 2, xoay giao 2v2).
- [ ] Kiểm tra hit: từng điều kiện từ chối ở 15.3; hit có `ballT < td` trong khoảng GRACE thì được chấp nhận và hủy điểm.
- [ ] Validate protocol: chặn được message sai kiểu, quá dài, số NaN/Infinity.
- [ ] Mã phòng không trùng và không dùng ký tự dễ nhầm.

**Thử thủ công:**
- [ ] 2 tab, `LAG_MS=0` và `LAG_MS=150 JITTER_MS=50`: đánh PERFECT vẫn ra đúng cảm giác, bóng của đối thủ không giật mạnh.
- [ ] Hai máy thật trong cùng mạng LAN và qua internet (sau khi deploy https/wss).
- [ ] Link mời mở trên điện thoại vào thẳng phòng; chơi online bằng cảm ứng.
- [ ] Ngắt kết nối / kết nối lại / hết 30s → xử thua đúng; bảng xếp hạng cập nhật đúng.
- [ ] Chat có `<script>` hiển thị dưới dạng chữ thường.
- [ ] Gửi message rác/spam bằng console → server không sập, chỉ ngắt kết nối kẻ spam.
