'use strict';
/* Pickle Pop – server: phục vụ file tĩnh + WebSocket (/ws) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Protocol } = require('../shared/protocol.js');
const { APP_VERSION } = require('../shared/config.js');
const { Lobby } = require('./rooms.js');
const { Store } = require('./store.js');

const ENV = process.env;
const PORT = +ENV.PORT || 8080;
const HOST = ENV.HOST || '127.0.0.1';
const PROD = ENV.NODE_ENV === 'production';
const TRUST_PROXY = ENV.TRUST_PROXY || '';
const ALLOWED_ORIGINS = (ENV.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const LAG_MS = +ENV.LAG_MS || 0;
const JITTER_MS = +ENV.JITTER_MS || 0;
const MAX_CONN_PER_IP = +ENV.MAX_CONN_PER_IP || 6;
const DATA_DIR = ENV.DATA_DIR || path.join(__dirname, 'data');
const ROOT = path.resolve(__dirname, '..');

const log = (...a) => console.log(new Date().toISOString(), ...a);
const T0 = process.hrtime.bigint();
const now = () => Number(process.hrtime.bigint() - T0) / 1e9;

/* ---------- file tĩnh ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const ALLOWED_TOP = new Set(['index.html', 'style.css']);
const ALLOWED_DIRS = new Set(['js', 'shared', 'vendor']);

// version theo nội dung file -> đổi mỗi lần sửa/deploy, phá cache Cloudflare/trình duyệt.
// Tự phát hiện file thay đổi (so mtime + kích thước, kiểm tra tối đa 1 lần/giây) nên KHÔNG cần khởi động lại server.
const ASSET_DIRS = ['js', 'shared', 'vendor'];
function assetFiles() {
  const out = [path.join(ROOT, 'index.html'), path.join(ROOT, 'style.css')];
  for (const d of ASSET_DIRS) {
    let names = [];
    try { names = fs.readdirSync(path.join(ROOT, d)).sort(); } catch (e) { /* thư mục không tồn tại */ }
    for (const f of names) if (f.endsWith('.js')) out.push(path.join(ROOT, d, f));
  }
  return out;
}
const assets = { key: '', version: '', html: '', checkedAt: 0 };
function refreshAssets() {
  const nowMs = Date.now();
  if (nowMs - assets.checkedAt < 1000 && assets.html) return assets;
  assets.checkedAt = nowMs;
  const files = assetFiles();
  const key = files.map((f) => { try { const st = fs.statSync(f); return st.mtimeMs + ':' + st.size; } catch (e) { return '-'; } }).join('|');
  if (key === assets.key) return assets;
  const h = crypto.createHash('sha1');
  for (const f of files) if (!f.endsWith('index.html')) { try { h.update(fs.readFileSync(f)); } catch (e) { /* bỏ qua */ } }
  assets.key = key;
  assets.version = APP_VERSION + '-' + h.digest('hex').slice(0, 8);
  assets.html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/__V__/g, assets.version);
  return assets;
}
refreshAssets();

function sendStatic(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400).end(); return; }
  if (rel === '/' || rel === '/index.html') {
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : refreshAssets().html);
    return;
  }
  rel = path.posix.normalize(rel).replace(/^\/+/, '');
  const parts = rel.split('/');
  const ok = (parts.length === 1 && ALLOWED_TOP.has(parts[0])) ||
    (parts.length === 2 && ALLOWED_DIRS.has(parts[0]) && /^[\w.-]+\.js$/.test(parts[1]));
  const file = path.join(ROOT, rel);
  if (!ok || !file.startsWith(ROOT + path.sep)) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    const immutable = url.searchParams.get('v') === refreshAssets().version;
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

const store = new Store(DATA_DIR);
const lobby = new Lobby({ store, now, log });

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(Object.assign({ ok: true, version: refreshAssets().version, protocol: Protocol.PROTOCOL_VERSION, uptime: Math.round(now()) }, lobby.stats())));
    return;
  }
  sendStatic(req, res, url);
});

/* ---------- WebSocket ---------- */
function isPrivateIp(ip) {
  ip = (ip || '').replace(/^::ffff:/, '');
  return ip === '::1' || /^127\./.test(ip) || /^10\./.test(ip) || /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^f[cd][0-9a-f]{2}:/i.test(ip);
}
function clientIp(req) {
  const remote = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (TRUST_PROXY === 'cloudflare' && isPrivateIp(remote)) {
    const h = req.headers['cf-connecting-ip'];
    if (typeof h === 'string' && h.length < 64) return h.trim();
  }
  return remote;
}
function originAllowed(origin, host) {
  if (!origin) return !PROD;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // cùng tên miền với trang đang truy cập (Cloudflare Tunnel giữ nguyên Host) -> hợp lệ
  try { if (host && new URL(origin).host === host) return true; } catch (e) { return false; }
  if (!PROD && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin)) return true;
  return false;
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
const perIp = new Map();

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const reject = (code, msg) => { socket.write(`HTTP/1.1 ${code} ${msg}\r\n\r\n`); socket.destroy(); };
  if (url.pathname !== '/ws') return reject(404, 'Not Found');
  if (!originAllowed(req.headers.origin, req.headers.host)) { log('ws reject origin', req.headers.origin); return reject(403, 'Forbidden'); }
  const ip = clientIp(req);
  if ((perIp.get(ip) || 0) >= MAX_CONN_PER_IP) return reject(429, 'Too Many Requests');
  wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, ip));
});

const conns = new Set();
function onConnection(ws, ip) {
  perIp.set(ip, (perIp.get(ip) || 0) + 1);
  const conn = {
    ip, client: null, alive: true, missed: 0,
    tokens: 60, lastRefill: Date.now(), dropped: 0, bad: 0, outAt: 0, inAt: 0,
    send(msg) {
      if (ws.readyState !== 1) return;
      const data = JSON.stringify(msg);
      if (LAG_MS || JITTER_MS) {
        // giữ đúng thứ tự như TCP thật: không cho tin sau tới trước tin trước
        const at = Math.max(conn.outAt, Date.now() + LAG_MS + Math.random() * JITTER_MS);
        conn.outAt = at;
        setTimeout(() => { if (ws.readyState === 1) ws.send(data); }, at - Date.now());
      } else ws.send(data);
    },
    close(code, reason) { try { ws.close(code, reason); } catch (e) { /* bỏ qua */ } },
  };
  conns.add(conn);
  ws.on('pong', () => { conn.alive = true; conn.missed = 0; });
  ws.on('message', (raw, isBinary) => {
    if (isBinary) { conn.bad++; return; }
    const t = Date.now();
    conn.tokens = Math.min(60, conn.tokens + (t - conn.lastRefill) * 0.06);
    conn.lastRefill = t;
    if (conn.tokens < 1) { if (++conn.dropped > 300) conn.close(4008, 'rate'); return; }
    conn.tokens -= 1;
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { m = null; }
    if (!Protocol.validate(m)) { if (++conn.bad > 50) conn.close(4002, 'bad data'); return; }
    const run = () => { try { lobby.onMessage(conn, m); } catch (e) { log('handler error', m.t, e.stack); } };
    if (LAG_MS || JITTER_MS) {
      const at = Math.max(conn.inAt, Date.now() + LAG_MS + Math.random() * JITTER_MS);
      conn.inAt = at;
      setTimeout(run, at - Date.now());
    } else run();
  });
  ws.on('close', () => {
    conns.delete(conn);
    const n = (perIp.get(ip) || 1) - 1;
    if (n <= 0) perIp.delete(ip); else perIp.set(ip, n);
    try { lobby.onClose(conn); } catch (e) { log('close error', e.stack); }
  });
  ws.on('error', () => {});
  conn.ws = ws;
}

// heartbeat: Cloudflare ngắt WebSocket im lặng sau ~100s
const heartbeat = setInterval(() => {
  for (const c of conns) {
    if (!c.alive) { if (++c.missed >= 2) { c.ws.terminate(); continue; } }
    c.alive = false;
    try { c.ws.ping(); } catch (e) { /* bỏ qua */ }
  }
}, 25000);

const loops = [
  setInterval(() => lobby.tick(), 1000 / 60),
  setInterval(() => lobby.broadcastStates(), 50),
  setInterval(() => lobby.housekeeping(), 5000),
  heartbeat,
];

server.listen(PORT, HOST, () => {
  log(`Pickle Pop ${assets.version} đang chạy tại http://${HOST}:${PORT} (${PROD ? 'production' : 'dev'})`);
  if (LAG_MS || JITTER_MS) log(`Giả lập độ trễ: ${LAG_MS}ms ± ${JITTER_MS}ms`);
});

let stopping = false;
function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  log('nhận', sig, '- đang tắt…');
  lobby.broadcastAll({ t: 'server_restart' });
  store.flush();
  for (const l of loops) clearInterval(l);
  server.close();
  setTimeout(() => {
    for (const c of conns) c.close(1012, 'restart');
    setTimeout(() => process.exit(0), 300);
  }, 300);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
