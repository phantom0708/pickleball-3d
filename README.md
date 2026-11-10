# Pickle Pop – Pickleball 3D

[![Test](../../actions/workflows/test.yml/badge.svg)](../../actions/workflows/test.yml) · Giấy phép [MIT](LICENSE) · [Đóng góp](CONTRIBUTING.md)

Game pickleball 3D dễ thương chạy trên trình duyệt: đấu với bot 3 cấp độ, đánh đôi cùng bot, chơi online 1v1 / 2v2, xem trực tiếp và bảng xếp hạng.

**18 nhân vật** (9 mở sẵn, còn lại mở khóa theo số trận thắng) · **Tủ đồ** tùy chỉnh màu áo/quần/viền/giày/vợt, kiểu áo, số áo, họa tiết vợt, 14 phụ kiện · **10 sân**: Nhà thi đấu Hoa Mai, Bãi biển Gió Nam, Sân thượng Hoàng Hôn, Công viên Lá Me, Đấu trường Đêm, Phố Hội Đèn Lồng, Ruộng Bậc Thang, Vịnh Hạ Long, Đỉnh Tuyết Fansipan, Trạm Vũ Trụ Sao Mai.

## Chạy nhanh

**Chỉ chơi với bot:** mở thẳng file `index.html` bằng trình duyệt (cần internet để tải Three.js và font).

**Có chơi online:**
```bash
cd server
npm install
npm start            # mở http://localhost:8080
npm run dev          # như trên nhưng giả lập độ trễ 100±30ms để thử online
npm test             # unit test + test tích hợp online (~3 phút)
```
Mở 2 tab → **Chơi online** → tab 1 tạo phòng → bấm *Sao chép link mời* → dán link vào tab 2.

Triển khai lên server Ubuntu với Cloudflare Tunnel (Docker hoặc Node + PM2): xem [deploy/DEPLOY.md](deploy/DEPLOY.md).

## Điều khiển

| Hành động | Bàn phím | Tay cầm | Điện thoại |
|---|---|---|---|
| Di chuyển | WASD / mũi tên | cần trái | joystick |
| Drive | J / Z | A | Drive |
| Dink | K / X | B | Dink |
| Drop | U / B | RB | Drop |
| Lob | L / C | Y | Lob |
| Smash | I / V / Space | X | Smash |
| Tạm dừng | Esc / P | Start | ⏸ |

Giữ hướng khi đánh để ngắm. Khi bóng bay tới, vòng vàng dưới chân thu nhỏ dần: bấm đúng lúc nó **khớp vòng trắng** để có cú **PERFECT** (bấm sớm thì bóng đi chéo sân, bấm muộn thì đi dọc biên).

**Xem thử đồ họa (v2):** `tools/character-preview.html` (9 nhân vật, các kiểu đánh) và `tools/world-preview.html?venue=gym|beach|roof|park|arena&quality=low|medium|high` (mở trực tiếp bằng trình duyệt).

## Luật đã cài đặt

Theo luật USA Pickleball đang được áp dụng phổ biến tại Việt Nam:

- **Tính điểm truyền thống (mặc định):** chỉ bên giao bóng mới ghi điểm. Chạm **5 / 7 / 11**, phải hơn 2 điểm. Đánh đôi: mỗi người giao một lượt, lượt giao đầu trận chỉ 1 người (**0-0-2**), đội giao ghi điểm thì người giao đổi ô, đọc tỉ số 3 số. Tùy chọn **Rally**: pha nào cũng có điểm nhưng điểm kết thúc ván chỉ ghi khi đang giao.
- **Giao bóng:** tay dưới, sau vạch cuối, chéo sân, phải qua vùng bếp (rơi vào vạch bếp là lỗi). Đứng ô phải khi điểm chẵn, ô trái khi lẻ. Có **10 giây** để giao. Bóng chạm lưới mà vẫn rơi đúng ô thì **vẫn chơi** (không có giao lại).
- **Luật 2 nảy:** cú giao và cú trả giao đều phải để bóng nảy.
- **Vùng bếp:** cấm vô-lê khi đứng trong bếp hoặc chạm vạch; cấm để **trớn** đưa người vào bếp sau cú vô-lê.
- **Đánh đôi:** chỉ người ở ô chéo được đỡ giao.
- **Mất pha:** bóng ra ngoài (chạm vạch là trong), vào lưới không qua, nảy 2 lần bên mình.
- Chưa mô phỏng: bóng chạm người, chạm lưới bằng người/vợt, giao kiểu thả (drop serve), đổi sân giữa các ván.

## Cấu trúc

```
index.html, style.css     giao diện
shared/                   dùng chung trình duyệt + Node (UMD)
  config.js               hằng số, nhân vật, sân, cấp độ bot
  physics.js              vật lý bóng tất định (bước cố định 1/240s), giải quỹ đạo cú đánh
  match.js                luật & tính điểm (đơn/đôi) – chạy offline trong trình duyệt và online trên server
  ai.js                   bot
  protocol.js             giao thức online + kiểm tra dữ liệu
js/                       chỉ chạy trên trình duyệt: world (3D), audio, input, net, ui, game
server/                   Node.js + ws: file tĩnh, phòng, ghép trận, trận có thẩm quyền, bảng xếp hạng
deploy/DEPLOY.md          hướng dẫn triển khai
docs/                     tài liệu thiết kế & hợp đồng API giữa các module
```

### Online hoạt động thế nào
- Bóng được mô tả bằng sự kiện *launch* (vị trí, vận tốc, thời điểm, gió). Mọi máy tự mô phỏng lại theo cùng bước cố định nên thấy cùng một đường bóng; mạng chỉ cần truyền các cú đánh.
- Người đánh quyết định cú đánh ngay trên máy mình (không trễ khi canh PERFECT). Server kiểm tra lại tầm với, thời điểm, tốc độ bóng và luật, sau đó phát cho mọi người. Server là trọng tài duy nhất, và có 200ms ân hạn trước khi chốt điểm để bù độ trễ cho người đỡ bóng.
- Đội B được lật góc nhìn để ai cũng thấy mình ở gần camera. Mất kết nối có 30 giây để quay lại; trong 2v2 bật bot thì bot sẽ thay người rời trận.

## Đóng góp

Dự án mã nguồn mở, mọi người đều có thể cùng sửa và phát triển. Đọc [CONTRIBUTING.md](CONTRIBUTING.md) để biết cách chạy, cấu trúc code và quy trình gửi Pull Request.

## Giấy phép

[MIT](LICENSE). Thư viện bên thứ ba: three.js (MIT) – xem [vendor/README.md](vendor/README.md).
