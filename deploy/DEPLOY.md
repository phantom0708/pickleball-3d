# Triển khai Pickle Pop: Ubuntu + Docker + Cloudflare Tunnel

```
Người chơi ⇄ https://game.<domain> (Cloudflare) ⇄ Tunnel ⇄ container cloudflared ⇄ container app :8080
```
Server **không mở cổng web nào** ra internet. Cloudflare lo HTTPS, tunnel là kết nối đi ra từ server.

Trong tài liệu này, thay `game.example.com` bằng tên miền thật của bạn.

---

## Bước 1 – Chuẩn bị Ubuntu (22.04 / 24.04)

```bash
# Docker Engine + Compose plugin (repo chính thức của Docker)
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER   # đăng xuất rồi đăng nhập lại để có hiệu lực

# Tường lửa: chỉ cho SSH (tunnel không cần mở cổng)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw enable
```

Đưa code lên server:
```bash
sudo mkdir -p /opt/pickle-pop && sudo chown $USER /opt/pickle-pop
git clone <repo-của-bạn> /opt/pickle-pop      # hoặc dùng scp/rsync thư mục dự án
cd /opt/pickle-pop
```

> **Lưu ý:** Docker tự thêm luật iptables cho cổng được publish và bỏ qua ufw. File `docker-compose.yml` **không publish cổng nào**, vì vậy đừng thêm `ports:` khi chạy thật.

## Bước 2 – Tạo Cloudflare Tunnel

1. Cloudflare dashboard → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**.
2. Chọn **Cloudflared**, đặt tên `pickle-pop`, ở bước cài đặt chọn **Docker** và **sao chép token** (chuỗi dài sau `--token`).
3. Tab **Public Hostname** → **Add a public hostname**:
   - Subdomain: `game`, Domain: tên miền của bạn
   - Service: **HTTP** – URL: **`app:8080`** (tên service trong docker-compose)
4. Lưu lại.

Tạo file `.env`:
```bash
cp .env.example .env
nano .env        # dán TUNNEL_TOKEN=... và ALLOWED_ORIGINS=https://game.example.com
chmod 600 .env
```

## Bước 3 – Cấu hình Cloudflare cho tên miền

| Mục | Cài đặt |
|---|---|
| **Network → WebSockets** | **On** (mặc định đã bật) |
| **Speed → Optimization → Rocket Loader** | **Off**. Bắt buộc tắt, nếu không game sẽ lỗi do sai thứ tự chạy script |
| **SSL/TLS → Edge Certificates → Always Use HTTPS** | On |
| **Caching → Cache Rules** | Tạo rule *Bypass cache* khi: URI Path bằng `/` **hoặc** `/index.html` **hoặc** bắt đầu bằng `/ws` **hoặc** bằng `/healthz` |
| Security → WAF → Rate limiting (tùy chọn) | Ví dụ: path `/ws`, 30 request/phút/IP |

Về cache: server tự gắn version (theo nội dung file) vào link JS/CSS (`?v=1.0.0-xxxxxxxx`) và trả header `immutable` cho các file này, còn HTML là `no-cache`. Nhờ vậy, mỗi lần deploy người chơi luôn nhận đúng bản mới.

## Bước 4 – Chạy

```bash
cd /opt/pickle-pop
docker compose up -d --build
docker compose ps                       # app phải "healthy", cloudflared "running"
docker compose logs -f --tail=100 app cloudflared
```
Trên dashboard, trạng thái tunnel phải là **Healthy**. Sau đó mở `https://game.example.com`.

## Kiểm tra sau khi deploy

- [ ] `curl https://game.example.com/healthz` trả `{"ok":true,...}`
- [ ] Từ máy khác: `curl -m 5 http://<IP-server>:8080` **không kết nối được** (cổng không mở)
- [ ] Hai thiết bị khác mạng (Wi-Fi + 4G) vào "Chơi online" → tạo phòng → gửi link mời → chơi trọn một trận
- [ ] Để tab ở phòng chờ 5 phút không thao tác → vẫn còn kết nối (heartbeat 25 giây)
- [ ] `docker compose restart app` khi đang ở phòng → game hiện "Server đang cập nhật…" rồi tự kết nối lại
- [ ] Deploy bản mới rồi tải lại trang → nhận đúng JS mới (xem `version` trong `/healthz`)

## Vận hành

**Cập nhật bản mới**
```bash
cd /opt/pickle-pop && git pull && docker compose up -d --build
```
Server sẽ báo cho người chơi, lưu bảng xếp hạng rồi mới tắt. **Các trận đang diễn ra sẽ bị hủy**, vì vậy nên cập nhật vào giờ vắng. Khi đổi giao thức mạng, hãy tăng `PROTOCOL_VERSION` trong `shared/protocol.js`; client cũ sẽ được nhắc tải lại trang.

**Xem log:** `docker compose logs -f --tail=200 app` (Docker giới hạn 3 file × 10MB).

**Sao lưu bảng xếp hạng** (dữ liệu nằm trong volume `pp-data`):
```bash
mkdir -p ~/pp-backup
docker compose cp app:/app/server/data/players.json ~/pp-backup/players-$(date +%F).json
# cron hằng ngày lúc 4h:
# 0 4 * * * cd /opt/pickle-pop && docker compose cp app:/app/server/data/players.json /home/<user>/pp-backup/players-$(date +\%F).json
```
Khôi phục: `docker compose cp ~/pp-backup/players-YYYY-MM-DD.json app:/app/server/data/players.json && docker compose restart app`

**Biến môi trường của app**

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | 8080 | cổng HTTP/WebSocket |
| `HOST` | 127.0.0.1 (trong Docker: 0.0.0.0) | địa chỉ lắng nghe |
| `ALLOWED_ORIGINS` | – | danh sách origin được kết nối WebSocket, cách nhau bằng dấu phẩy |
| `TRUST_PROXY` | – | `cloudflare`: đọc IP thật từ `CF-Connecting-IP` (chỉ khi kết nối đến từ IP nội bộ, tức container cloudflared) |
| `MAX_CONN_PER_IP` | 6 | số kết nối tối đa mỗi IP |
| `DATA_DIR` | server/data | nơi lưu `players.json` |
| `LAG_MS`, `JITTER_MS` | 0 | chỉ dùng khi test: giả lập độ trễ mạng |

## Gỡ lỗi nhanh

| Hiện tượng | Kiểm tra |
|---|---|
| Tunnel **Down** trên dashboard | `docker compose logs cloudflared`; token trong `.env` có đúng không |
| Trang báo **502 / Bad gateway** | `docker compose ps` xem app có chạy không; Public Hostname phải là `HTTP` + `app:8080` |
| Vào được trang nhưng "Chơi online" cứ "đang kết nối lại" | WebSockets đã On chưa; `ALLOWED_ORIGINS` phải khớp chính xác `https://game.example.com`; xem log app có dòng `ws reject origin` không |
| Game không chạy, màn hình trắng | Rocket Loader đã tắt chưa; xóa cache Cloudflare (Caching → Purge Everything) |
| Bị ngắt kết nối định kỳ | Xem log cloudflared; có thể do Cloudflare bảo trì, game sẽ tự kết nối lại |

---

## Cách 2: Node + PM2 (không cần Docker, không cần sudo)

Phù hợp khi server đã có Node ≥ 20 và PM2, còn Cloudflare Tunnel (cloudflared) đã chạy sẵn bằng token.

1. Khai báo server trong `~/.ssh/config` của máy bạn (ví dụ `Host my-server`).
2. Từ máy bạn chạy: `DEPLOY_HOST=my-server ./deploy/deploy-pm2.sh`
   Script đồng bộ code vào `~/apps/pickle-pop`, cài thư viện và chạy/reload app PM2 `pickle-pop` ở **127.0.0.1:8095** (xem `deploy/ecosystem.config.js`).
3. Lưu PM2 để tự chạy lại khi khởi động máy: `pm2 save` và `pm2 startup` (hoặc crontab `@reboot pm2 resurrect`).
4. Trên Cloudflare dashboard: Zero Trust → Networks → Tunnels → tunnel của server → **Public Hostname**: `HTTP` → `localhost:8095`.

- Bảng xếp hạng nằm ở `~/apps/pickle-pop/server/data/players.json` (không bị ghi đè khi deploy).
- Xem log: `ssh my-server 'pm2 logs pickle-pop --lines 100'` · Khởi động lại: `ssh my-server 'pm2 restart pickle-pop'`
- Server chấp nhận WebSocket từ cùng tên miền với trang, không cần đặt `ALLOWED_ORIGINS`. Muốn cho phép thêm tên miền khác:
  `ssh my-server 'cd ~/apps/pickle-pop && ALLOWED_ORIGINS=https://khac.example.com pm2 reload deploy/ecosystem.config.js --update-env && pm2 save'`
