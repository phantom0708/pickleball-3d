/* Pickle Pop – bàn phím, tay cầm, cảm ứng */
(function (PP) {
  'use strict';
  const keys = new Set();
  const joy = { x: 0, y: 0 };
  const pad = { x: 0, y: 0 };
  let padPrev = [];
  const handlers = { shot: null, shotDown: null, shotUp: null, pause: null };
  const down = (t) => { if (handlers.shotDown) handlers.shotDown(t); else if (handlers.shot) handlers.shot(t); };
  const up = (t) => { if (handlers.shotUp) handlers.shotUp(t); };

  const SHOT_KEYS = { KeyJ: 'drive', KeyZ: 'drive', KeyK: 'dink', KeyX: 'dink', KeyL: 'lob', KeyC: 'lob', KeyI: 'smash', KeyV: 'smash', Space: 'smash', KeyU: 'drop', KeyB: 'drop' };
  const BLOCK = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];

  function typing(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  window.addEventListener('keydown', (e) => {
    if (typing(e)) return;
    if (BLOCK.includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (SHOT_KEYS[e.code]) down(SHOT_KEYS[e.code]);
    if ((e.code === 'Escape' || e.code === 'KeyP') && handlers.pause) handlers.pause();
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); if (SHOT_KEYS[e.code]) up(SHOT_KEYS[e.code]); });
  window.addEventListener('blur', () => { keys.clear(); if (handlers.cancel) handlers.cancel(); });

  function axes() {
    let x = 0, y = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) x -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) x += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) y += 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) y -= 1;
    x += joy.x + pad.x; y += joy.y + pad.y;
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
  }

  function poll() {
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const g of gps) if (g && g.connected) { gp = g; break; }
    if (!gp) { pad.x = pad.y = 0; return; }
    const dz = (v) => (Math.abs(v) < 0.2 ? 0 : v);
    pad.x = dz(gp.axes[0] || 0); pad.y = -dz(gp.axes[1] || 0);
    const b = gp.buttons;
    if (b[14] && b[14].pressed) pad.x = -1;
    if (b[15] && b[15].pressed) pad.x = 1;
    if (b[12] && b[12].pressed) pad.y = 1;
    if (b[13] && b[13].pressed) pad.y = -1;
    const map = { 0: 'drive', 1: 'dink', 3: 'lob', 2: 'smash', 5: 'drop' };
    for (const i in map) {
      const p = b[i] && b[i].pressed;
      if (p && !padPrev[i]) down(map[i]);
      if (!p && padPrev[i]) up(map[i]);
      padPrev[i] = p;
    }
    const st = b[9] && b[9].pressed;
    if (st && !padPrev[9] && handlers.pause) handlers.pause();
    padPrev[9] = st;
  }

  function setupTouch() {
    const base = document.getElementById('joy'), knob = document.getElementById('joy-knob');
    if (!base) return;
    let id = null, cx = 0, cy = 0;
    const R = 50;
    function move(e) {
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const m = Math.hypot(dx, dy);
      if (m > R) { dx *= R / m; dy *= R / m; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      joy.x = dx / R; joy.y = -dy / R;
    }
    function end(e) {
      if (e.pointerId !== id) return;
      id = null; joy.x = joy.y = 0; knob.style.transform = '';
    }
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId; base.setPointerCapture(id);
      const r = base.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      move(e);
    });
    base.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
    document.querySelectorAll('[data-shot]').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.classList.add('down');
        try { btn.setPointerCapture(e.pointerId); } catch (er) { /* bỏ qua */ }
        down(btn.dataset.shot);
      });
      const rel = () => { if (!btn.classList.contains('down')) return; btn.classList.remove('down'); up(btn.dataset.shot); };
      btn.addEventListener('pointerup', rel); btn.addEventListener('pointercancel', rel); btn.addEventListener('lostpointercapture', rel);
    });
  }

  const isTouch = () => window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

  PP.Input = { axes, poll, setupTouch, isTouch, on(name, fn) { handlers[name] = fn; } };
})(window.PP);
