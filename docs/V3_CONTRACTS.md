# Pickle Pop v3 – Thêm nhân vật, tùy chỉnh trang phục, thêm sân

Bổ sung cho `docs/V2_CONTRACTS.md` (vẫn còn hiệu lực). Nguyên tắc cũ giữ nguyên: thiết kế **gốc** của Pickle Pop, không sao chép game khác; classic script + THREE r147; không phá API v2.

## Dữ liệu mới (đã có sẵn trong `shared/config.js`)
- 9 nhân vật mới: `monkey, elephant, raccoon, deer, turtle, capybara, seal, lion, sloth` (tổng 18). Mỗi con có `body, accent, belly, paddle, ears` (= id loài), `unlock`.
- 5 sân mới: `hoian` (Phố Hội Đèn Lồng – đêm, đèn lồng, nhà vàng, sông), `terrace` (Ruộng Bậc Thang – núi, sương, ruộng lúa), `halong` (Vịnh Hạ Long – sân nổi trên mặt nước, núi đá vôi, thuyền buồm), `snow` (Đỉnh Tuyết – tuyết rơi, thông, núi), `space` (Trạm Vũ Trụ – mái vòm kính, sao, hành tinh). Tổng 10 sân.

## Đối tượng `look` (tùy chỉnh) – mọi trường đều tùy chọn
```js
look = {
  shirt:  '#rrggbb', shorts: '#rrggbb', accent: '#rrggbb', shoes: '#rrggbb', paddle: '#rrggbb',
  pattern:   'solid' | 'stripe' | 'dots' | 'split' | 'flame' | 'star' | 'wave' | 'check',  // họa tiết mặt vợt
  accessory: 'default' | 'none' | 'cap' | 'capBack' | 'visor' | 'band' | 'beanie' | 'bow' | 'shades' | 'crown' | 'flower' | 'headphones' | 'halo' | 'party',
  shirtStyle: 'tee' | 'tank' | 'jersey' | 'hoodie',
  number: 0..99
}
```
Thiếu trường → dùng mặc định của nhân vật (STYLE). `'default'` = phụ kiện riêng của nhân vật.

## C – `js/character.js`
- `PP.Character.build(def, { team, look })` – áp dụng `look`.
- `PP.Character.OPTIONS = { palette: [hex…≥16], patterns: [{id,name}], accessories: [{id,name,unlock?}], shirtStyles: [{id,name}] }` (tên tiếng Việt; `unlock` = số trận thắng cần, ví dụ crown 15, halo 25).
- `PP.Character.defaultLook(id)` → look đầy đủ (hex) của nhân vật.
- `PP.Character.portraits(defs, size, looks /* Map|obj id→look, tùy chọn */)` – như cũ + look.
- `PP.Character.createPreview(canvas)` → `{ set(def, look), setAnim('idle'|'ready'|'swing'|'celebrate'), resize(), dispose() }` – xem trước 3D xoay chậm (kéo chuột/ngón tay để xoay), dùng trong màn **Tủ đồ**. Tự chạy vòng lặp render riêng, dừng khi dispose.
- 9 loài mới đầy đủ đặc điểm (ví dụ: khỉ tai tròn + đuôi cong + mặt sáng màu; voi tai to + vòi; gấu mèo mặt nạ + đuôi sọc; nai gạc nhỏ + đốm; rùa mai trên lưng; chuột lang nước mõm vuông + quả cam trên đầu làm phụ kiện mặc định; hải cẩu không tai + râu + chân chèo; sư tử bờm; lười mắt quầng + móng). Mỗi con có STYLE + phụ kiện mặc định riêng.

## W – `js/world.js`
- 5 sân mới đầy đủ (bầu trời/sương/đèn/bề mặt/khán giả nếu hợp/hạt môi trường: đèn lồng bay & đom đóm, mây sương, sóng & chim, tuyết rơi, sao băng). `surfaceOf`: hoian `hard`, terrace `hard`, halong `wood`, snow `hard`, space `hard`.
- `PP.World.thumbnails(renderer, ids, w = 320, h = 180)` → `Promise<Map<id,dataURL>>`: ảnh xem trước từng sân từ góc đẹp (dùng chính renderer chính, render target, không làm hỏng trạng thái). Cho phép gọi tuần tự (một sân/khung) để không giật.

## S – `shared/protocol.js` + server
- `Protocol.cleanLook(obj)` → look hợp lệ (chỉ giữ trường đúng kiểu/enum, hex `/^#[0-9a-f]{6}$/i`, number 0..99) hoặc `{}`.
- `hello` và `set_profile` nhận thêm `look` (tùy chọn). Server lưu `client.look` (đã clean), trả trong `room_state.players[i].look` và `match_start.players[i].look`. Bot dùng look `{}` (hoặc ngẫu nhiên phụ kiện).
- Danh sách enum lấy từ một nơi chung: `shared/config.js` → `LOOK = { patterns:[], accessories:[], shirtStyles:[] }` (S thêm vào config; C dùng cùng id).

## G – (agent chính)
Màn **Tủ đồ** (chọn nhân vật + màu áo/quần/viền/giày/vợt, họa tiết vợt, phụ kiện, kiểu áo, số áo, xem trước 3D), lưu `Save.data.looks[charId]`, gửi `look` khi online, ảnh xem trước sân trong màn chọn sân & phòng chờ.
