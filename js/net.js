/* Pickle Pop – kết nối online: WebSocket, đồng bộ đồng hồ, tự kết nối lại */
(function (PP) {
  'use strict';
  const BACKOFF = [0.5, 1, 2, 5, 10, 20, 30];

  class NetClient {
    constructor(h) {
      this.h = h;               // {onOpen, onMessage, onStatus}
      this.ws = null;
      this.want = false;
      this.tries = 0;
      this.offset = 0;          // serverTime ≈ performance.now()/1000 + offset
      this.samples = [];
      this.rtt = 0;
      this.lastMsg = 0;
      this.watch = false;       // bật khi đang trong trận để phát hiện socket chết
      this.timers = [];
      this.status = 'idle';
    }
    url() {
      const q = new URLSearchParams(location.search).get('server');
      if (q) return q;
      return (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws';
    }
    get open() { return this.ws && this.ws.readyState === 1; }
    connect() {
      if (this.want) return;
      this.want = true;
      this._open();
      this.timers.push(setInterval(() => this._pingCycle(), 10000));
      this.timers.push(setInterval(() => {
        if (this.watch && this.open && performance.now() - this.lastMsg > 10000) {
          try { this.ws.close(); } catch (e) { /* bỏ qua */ }
        }
      }, 2000));
    }
    _setStatus(s) { this.status = s; if (this.h.onStatus) this.h.onStatus(s); }
    _open() {
      this._setStatus(this.tries ? 'reconnecting' : 'connecting');
      let ws;
      try { ws = new WebSocket(this.url()); } catch (e) { this._retry(); return; }
      this.ws = ws;
      ws.onopen = () => {
        this.tries = 0;
        this.lastMsg = performance.now();
        this._setStatus('open');
        if (this.h.onOpen) this.h.onOpen();
        this._pingCycle(true);
      };
      ws.onmessage = (ev) => {
        this.lastMsg = performance.now();
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'pong') { this._pong(m); return; }
        if (this.h.onMessage) this.h.onMessage(m);
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        if (this.want) this._retry(); else this._setStatus('closed');
      };
      ws.onerror = () => { /* onclose sẽ xử lý */ };
    }
    _retry() {
      const d = BACKOFF[Math.min(this.tries, BACKOFF.length - 1)];
      this.tries++;
      this._setStatus('reconnecting');
      setTimeout(() => { if (this.want && !this.ws) this._open(); }, d * 1000);
    }
    _pingCycle(burst) {
      if (!this.open) return;
      const n = burst ? 5 : 1;
      for (let i = 0; i < n; i++) setTimeout(() => this.send({ t: 'ping', c: performance.now() }), i * 120);
    }
    _pong(m) {
      const now = performance.now();
      const rtt = (now - m.c) / 1000;
      const off = m.s + rtt / 2 - now / 1000;
      this.samples.push({ rtt, off });
      if (this.samples.length > 8) this.samples.shift();
      let best = this.samples[0];
      for (const s of this.samples) if (s.rtt < best.rtt) best = s;
      const first = this.samples.length === 1;
      this.offset = first ? best.off : this.offset + (best.off - this.offset) * 0.5;
      this.rtt = rtt;
      if (this.h.onPing) this.h.onPing(Math.round(rtt * 1000));
    }
    serverNow() { return performance.now() / 1000 + this.offset; }
    send(m) { if (this.open) { this.ws.send(JSON.stringify(m)); return true; } return false; }
    close() {
      this.want = false;
      for (const t of this.timers) clearInterval(t);
      this.timers = [];
      if (this.ws) { const w = this.ws; this.ws = null; try { w.close(); } catch (e) { /* bỏ qua */ } }
      this._setStatus('closed');
    }
  }

  PP.NetClient = NetClient;
})(window.PP);
