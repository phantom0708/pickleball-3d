// PM2 – chạy Pickle Pop trên server Linux bằng Node (không cần Docker / sudo)
// Cloudflare Tunnel trỏ Public Hostname tới http://localhost:8095
const path = require('path');
module.exports = {
  apps: [{
    name: 'pickle-pop',
    cwd: path.join(__dirname, '..'),
    script: 'server/index.js',
    env: {
      NODE_ENV: 'production',
      PORT: '8095',
      HOST: '127.0.0.1',          // chỉ nghe nội bộ, ra internet qua cloudflared
      TRUST_PROXY: 'cloudflare',  // lấy IP thật từ CF-Connecting-IP
      ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '', // tùy chọn: thêm tên miền khác, cách nhau bởi dấu phẩy
    },
    max_memory_restart: '400M',
    kill_timeout: 6000,           // cho server thời gian báo client + lưu bảng xếp hạng
    time: true,
  }],
};
