# Đóng góp cho Pickle Pop

Cảm ơn bạn muốn cùng làm Pickle Pop! Mọi đóng góp đều quý: sửa lỗi, nhân vật, sân đấu, luật chơi, giao diện, dịch thuật, tài liệu.

## Bắt đầu nhanh

```bash
git clone https://github.com/<tài-khoản>/pickleball-3d.git
cd pickleball-3d/server
npm install
npm start          # mở http://localhost:8080
npm test           # luật + vật lý + online (~3 phút)
```

Chỉ sửa giao diện / chơi với bot: mở thẳng `index.html` trong trình duyệt là chạy (không cần build).

## Cấu trúc code (đọc trước khi sửa)

| Thư mục | Vai trò | Lưu ý |
|---|---|---|
| `shared/` | Luật (`match.js`), vật lý bóng (`physics.js`), bot (`ai.js`), giao thức online (`protocol.js`), dữ liệu (`config.js`) | Chạy **cả trình duyệt lẫn server**. Không dùng DOM/THREE. Vật lý phải **tất định**: chỉ dùng `+ − × ÷ Math.sqrt`, bước cố định |
| `js/` | Đồ họa (`world.js`), nhân vật (`character.js`), âm thanh, điều khiển, giao diện, vòng lặp game (`game.js`) | Classic script gắn vào `window.PP`, dùng Three.js r147 trong `vendor/` |
| `server/` | Server Node + WebSocket: phòng, ghép trận, trận có thẩm quyền, bảng xếp hạng | Server là trọng tài duy nhất khi chơi online |
| `tools/` | Trang xem thử nhân vật và sân (mở trực tiếp bằng trình duyệt) | |
| `docs/` | Thiết kế (`DESIGN_V1/V2.md`) và hợp đồng API giữa các module (`V2/V3_CONTRACTS.md`) | |

## Quy trình

1. Tạo issue mô tả lỗi/ý tưởng (hoặc nhận một issue có sẵn).
2. Fork repo, tạo nhánh: `git checkout -b sua-loi-luat-giao-bong`.
3. Sửa code + thêm test nếu đụng tới luật/vật lý (`server/test/`).
4. Chạy `cd server && npm test` – phải qua hết.
5. Tạo Pull Request, mô tả thay đổi và cách đã kiểm tra. GitHub Actions sẽ tự chạy test.

## Quy ước quan trọng

- **Luật chơi** bám theo luật USA Pickleball đang áp dụng tại Việt Nam (xem phần "Luật đã cài đặt" trong README). Sửa luật thì sửa trong `shared/match.js` và thêm test.
- **Đổi vật lý** (`shared/physics.js`): chạy lại `node server/test/gen-physics-fixture.js --write` để cập nhật dữ liệu kiểm tra tất định.
- **Đổi giao thức online** theo kiểu không tương thích: tăng `PROTOCOL_VERSION` trong `shared/protocol.js`.
- **Đổi cấu trúc HTML** mà `js/game.js` dùng: tăng `window.PP_HTML_REV` trong `index.html` và `HTML_REV` trong `game.js` (để trình duyệt còn giữ bản cũ được nhắc tải lại).
- **Nội dung gốc**: chỉ đóng góp hình ảnh/âm thanh/nhân vật do bạn tự làm hoặc có giấy phép phù hợp; không sao chép tài sản của game khác.
- Giao diện và chú thích code viết bằng **tiếng Việt**.

## Ý tưởng đang cần người làm

- Giao bóng kiểu thả (drop serve), bóng chạm người là lỗi, đổi sân giữa các ván
- Thêm ngôn ngữ (tiếng Anh)
- Thêm nhân vật, sân đấu, phụ kiện
- Chế độ giải đấu, phát lại pha bóng
- Kiểm tra trên nhiều điện thoại thật

Bằng việc gửi đóng góp, bạn đồng ý phát hành phần đóng góp theo giấy phép MIT của dự án.
