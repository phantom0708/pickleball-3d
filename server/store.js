'use strict';
/* Lưu bảng xếp hạng vào file JSON (ghi atomic, gộp nhiều lần ghi) */
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'players.json');
    this.data = {};
    this.timer = null;
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(this.file)) this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {};
    } catch (e) {
      console.error('[store] không đọc được dữ liệu:', e.message);
      this.data = {};
    }
  }
  record(deviceId, name, won) {
    const r = this.data[deviceId] || { name, wins: 0, losses: 0 };
    r.name = name;
    if (won) r.wins++; else r.losses++;
    r.updated = Date.now();
    this.data[deviceId] = r;
    this.schedule();
  }
  rename(deviceId, name) {
    if (this.data[deviceId]) { this.data[deviceId].name = name; this.schedule(); }
  }
  top(n) {
    return Object.values(this.data)
      .filter((r) => r.wins > 0)
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
      .slice(0, n)
      .map((r) => ({ name: r.name, wins: r.wins, losses: r.losses }));
  }
  schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 2000);
  }
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[store] không ghi được dữ liệu:', e.message);
    }
  }
}

module.exports = { Store };
