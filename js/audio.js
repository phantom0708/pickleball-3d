/* Pickle Pop v2 – âm thanh tổng hợp bằng WebAudio (không cần file âm thanh)
 * Tương thích ngược: hit(power), perfect(), bounce(), net(), whistle(), cheer(), click(), win(), lose(), unlock(), setMuted(), muted
 * Mới: hit(kind, quality, power), bounce(surface), cheer(level), ooh(), swoosh(), squeak(), ambience(on, venueId), setVolume(v)
 */
(function (PP) {
  'use strict';
  let ctx = null, master = null, sfx = null, amb = null, comp = null, noiseBuf = null, pinkBuf = null;
  let muted = false, volume = 0.8;
  let ambWanted = { on: false, venue: null }, ambNodes = null;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rnd = (a, b) => a + Math.random() * (b - a);

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
      master = ctx.createGain(); master.gain.value = muted ? 0 : volume * 0.7;
      sfx = ctx.createGain(); sfx.gain.value = 1;
      amb = ctx.createGain(); amb.gain.value = 0.0001;
      sfx.connect(comp); amb.connect(comp); comp.connect(master); master.connect(ctx.destination);
      const n = ctx.sampleRate * 2;
      noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      // noise hồng (tiếng đám đông/biển mềm hơn)
      pinkBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const p = pinkBuf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + w * 0.5362) * 0.11;
      }
      if (ambWanted.on) setTimeout(() => applyAmbience(), 0);
    }
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignore */ } }
    return ctx;
  }
  function live() { const c = ensure(); return c && !muted ? c : null; }

  function env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
  }
  function tone(freq, dur, type, vol, slide, delay, out) {
    const c = live(); if (!c) return;
    const t = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out || sfx); o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol, freq, type, opts) {
    const c = live(); if (!c) return;
    opts = opts || {};
    const t = c.currentTime + (opts.delay || 0);
    const s = c.createBufferSource(); s.buffer = opts.pink ? pinkBuf : noiseBuf; s.loop = true;
    s.playbackRate.value = opts.rate || 1;
    const f = c.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.setValueAtTime(freq, t); f.Q.value = opts.q || 1;
    if (opts.sweep) f.frequency.exponentialRampToValueAtTime(opts.sweep, t + dur * (opts.sweepAt || 1));
    const g = c.createGain();
    env(g, t, opts.attack || Math.min(0.05, dur / 3), vol, dur);
    s.connect(f); f.connect(g); g.connect(opts.out || sfx);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.1);
    return { s, f, g };
  }

  /* ---------- tiếng vợt: click 2–4 kHz + thân "póc" gỗ 500–800 Hz ---------- */
  const KIND_POWER = { drive: 1.0, dink: 0.3, drop: 0.45, lob: 0.6, smash: 1.4, serve: 0.7, volley: 0.6 };
  function paddle(kind, quality, power) {
    const c = live(); if (!c) return;
    const p = clamp(power, 0.15, 1.6);
    const t = c.currentTime;
    const dull = quality === 'early' || quality === 'late';
    // lớp 1: click ngắn ~8 ms
    const cs = c.createBufferSource(); cs.buffer = noiseBuf;
    const hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = (dull ? 2200 : 2600) + p * 900 + rnd(-150, 150); hp.Q.value = 1.4;
    const cg = c.createGain(); cg.gain.setValueAtTime(0.0001, t); cg.gain.exponentialRampToValueAtTime((dull ? 0.35 : 0.55) * (0.6 + p * 0.4), t + 0.001); cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.009);
    cs.connect(hp); hp.connect(cg); cg.connect(sfx); cs.start(t, Math.random()); cs.stop(t + 0.03);
    // lớp 2: thân rỗng "póc" ~70 ms, cao độ theo lực
    const f0 = (dull ? 470 : 520) + p * 220 + rnd(-20, 20);
    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(f0 * 1.25, t); o.frequency.exponentialRampToValueAtTime(f0, t + 0.012); o.frequency.exponentialRampToValueAtTime(f0 * 0.82, t + 0.075);
    const bp = c.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = dull ? 1400 : 2400;
    const og = c.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.42 * (0.55 + p * 0.45), t + 0.002); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
    o.connect(bp); bp.connect(og); og.connect(sfx); o.start(t); o.stop(t + 0.1);
    // hài bậc 2 làm tiếng nhựa "rỗng"
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.setValueAtTime(f0 * 2.37, t);
    const g2 = c.createGain(); g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.12 * p, t + 0.002); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    o2.connect(g2); g2.connect(sfx); o2.start(t); o2.stop(t + 0.06);
    noise(0.05, 0.12 * p, 900 + p * 300, 'bandpass', { q: 2 });
    if (kind === 'smash') { swoosh(1.2); tone(140, 0.12, 'sine', 0.25, 70); }
    if (quality === 'perfect') sparkle();
  }
  function sparkle() {
    tone(1250, 0.14, 'triangle', 0.16, 1900, 0.01);
    tone(1880, 0.18, 'triangle', 0.1, 2500, 0.06);
    tone(2640, 0.2, 'sine', 0.05, 3200, 0.1);
  }

  /* ---------- tiếng bóng nảy theo mặt sân ---------- */
  function bounce(surface) {
    const c = live(); if (!c) return;
    if (surface === 'sand') {
      tone(170, 0.09, 'sine', 0.24, 85);
      noise(0.12, 0.12, 700, 'lowpass', { q: 0.7 });
      noise(0.16, 0.05, 3200, 'highpass', { delay: 0.01 });
    } else if (surface === 'wood') {
      tone(880 + rnd(-30, 30), 0.05, 'triangle', 0.22, 520);
      tone(240, 0.07, 'sine', 0.18, 140);
      noise(0.03, 0.16, 1800, 'bandpass', { q: 2.5 });
    } else {
      tone(1050 + rnd(-40, 40), 0.04, 'triangle', 0.2, 620);
      tone(300, 0.05, 'sine', 0.12, 170);
      noise(0.025, 0.2, 2600, 'bandpass', { q: 2 });
    }
  }

  function swoosh(k) {
    const s = k || 1;
    noise(0.24, 0.16 * s, 500, 'bandpass', { q: 1.8, sweep: 2600, sweepAt: 0.55, attack: 0.09 });
  }
  function squeak() {
    const c = live(); if (!c) return;
    const t = c.currentTime, f = rnd(1700, 2500);
    const o = c.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * rnd(1.08, 1.2), t + 0.07); o.frequency.linearRampToValueAtTime(f * 0.95, t + 0.12);
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 55; lg.gain.value = 60; lfo.connect(lg); lg.connect(o.frequency);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 6;
    const g = c.createGain(); env(g, t, 0.01, 0.05, 0.11);
    o.connect(bp); bp.connect(g); g.connect(sfx);
    o.start(t); lfo.start(t); o.stop(t + 0.15); lfo.stop(t + 0.15);
  }
  function netSound() {
    noise(0.22, 0.26, 420, 'lowpass', { q: 0.8 });
    noise(0.14, 0.08, 1800, 'bandpass', { q: 3, delay: 0.02 });
    tone(110, 0.14, 'sine', 0.2, 70);
  }
  function whistle() {
    const c = live(); if (!c) return;
    const t = c.currentTime;
    for (const [f, d, at] of [[2350, 0.16, 0], [2350, 0.32, 0.2]]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 28; lg.gain.value = 90; lfo.connect(lg); lg.connect(o.frequency);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t + at); g.gain.exponentialRampToValueAtTime(0.09, t + at + 0.015); g.gain.setValueAtTime(0.09, t + at + d - 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + at + d);
      o.connect(g); g.connect(sfx); o.start(t + at); lfo.start(t + at); o.stop(t + at + d + 0.02); lfo.stop(t + at + d + 0.02);
      noise(d, 0.025, 2400, 'bandpass', { q: 4, delay: at });
    }
  }
  /* ---------- đám đông ---------- */
  function cheer(level) {
    const c = live(); if (!c) return;
    const lv = clamp(level === undefined ? 0.7 : +level, 0.05, 1);
    const dur = 1.2 + lv * 1.6;
    noise(dur, 0.11 + lv * 0.16, 1100, 'bandpass', { q: 0.6, pink: true, attack: 0.25 });
    noise(dur * 0.9, 0.06 + lv * 0.08, 2600, 'bandpass', { q: 0.8, attack: 0.2 });
    noise(dur * 0.8, 0.05 + lv * 0.06, 420, 'bandpass', { q: 0.8, pink: true, attack: 0.3 });
    // tiếng huýt/reo lẻ tẻ
    const n = Math.round(2 + lv * 6);
    for (let i = 0; i < n; i++) {
      const at = rnd(0.05, dur * 0.6), f = rnd(900, 1900);
      tone(f, rnd(0.15, 0.35), 'sine', 0.025 + lv * 0.02, f * rnd(1.15, 1.5), at);
    }
    for (let i = 0; i < Math.round(lv * 8); i++) noise(0.012, 0.08, 1500, 'bandpass', { delay: rnd(0.1, dur * 0.7), q: 1 }); // vỗ tay
  }
  function ooh() {
    const c = live(); if (!c) return;
    const t = c.currentTime, dur = 1.1;
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 450; f1.Q.value = 3;
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 850; f2.Q.value = 4;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const g2 = c.createGain(); g2.gain.value = 0.5;
    f1.connect(g); f2.connect(g2); g2.connect(g); g.connect(sfx);
    for (let i = 0; i < 9; i++) {
      const o = c.createOscillator(); o.type = 'sawtooth';
      const b = rnd(150, 290);
      o.frequency.setValueAtTime(b, t); o.frequency.linearRampToValueAtTime(b * 1.12, t + 0.35); o.frequency.linearRampToValueAtTime(b * 0.92, t + dur);
      const og = c.createGain(); og.gain.value = 0.06;
      o.connect(og); og.connect(f1); og.connect(f2); o.start(t + rnd(0, 0.06)); o.stop(t + dur + 0.05);
    }
    noise(dur, 0.05, 600, 'bandpass', { q: 1, pink: true, attack: 0.25 });
  }

  /* ---------- âm nền theo bối cảnh ---------- */
  const AMB = {
    gym:   { crowd: 0.16, crowdF: 800, sea: 0, wind: 0, hum: 0.012, birds: 0 },
    beach: { crowd: 0.08, crowdF: 900, sea: 0.22, wind: 0.05, hum: 0, birds: 0.2 },
    roof:  { crowd: 0.09, crowdF: 750, sea: 0, wind: 0.09, hum: 0.02, birds: 0 },
    park:  { crowd: 0.09, crowdF: 850, sea: 0, wind: 0.06, hum: 0, birds: 1 },
    arena: { crowd: 0.22, crowdF: 700, sea: 0, wind: 0, hum: 0.02, birds: 0 },
  };
  function loopNoise(buf, type, freq, q, gain, lfoRate, lfoDepth) {
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    s.connect(f); f.connect(g); g.connect(amb);
    let lfo = null;
    if (lfoRate) { lfo = ctx.createOscillator(); lfo.frequency.value = lfoRate; const lg = ctx.createGain(); lg.gain.value = gain * lfoDepth; lfo.connect(lg); lg.connect(g.gain); lfo.start(); }
    s.start(0, Math.random() * 1.5);
    return { s, lfo };
  }
  function stopAmbNodes() {
    if (!ambNodes) return;
    const nodes = ambNodes; ambNodes = null;
    const t = ctx.currentTime;
    amb.gain.cancelScheduledValues(t); amb.gain.setValueAtTime(amb.gain.value, t); amb.gain.linearRampToValueAtTime(0.0001, t + 0.6);
    setTimeout(() => { for (const n of nodes.list) { try { n.s.stop(); if (n.lfo) n.lfo.stop(); } catch (e) { /* đã dừng */ } } if (nodes.timer) clearInterval(nodes.timer); }, 700);
  }
  function applyAmbience() {
    if (!ctx) return;
    stopAmbNodes();
    if (!ambWanted.on) return;
    const cfg = AMB[ambWanted.venue] || AMB.gym;
    const list = [];
    if (cfg.crowd) {
      list.push(loopNoise(pinkBuf, 'bandpass', cfg.crowdF, 0.7, cfg.crowd, 0.13, 0.35));
      list.push(loopNoise(noiseBuf, 'bandpass', cfg.crowdF * 2.4, 1.2, cfg.crowd * 0.25, 0.21, 0.5));
    }
    if (cfg.sea) list.push(loopNoise(pinkBuf, 'lowpass', 520, 0.5, cfg.sea, 0.09, 0.85));
    if (cfg.wind) list.push(loopNoise(pinkBuf, 'bandpass', 380, 0.6, cfg.wind, 0.07, 0.8));
    if (cfg.hum) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 100;
      const g = ctx.createGain(); g.gain.value = cfg.hum; o.connect(g); g.connect(amb); o.start();
      list.push({ s: o, lfo: null });
    }
    let timer = null;
    if (cfg.birds) {
      timer = setInterval(() => {
        if (muted || !ambNodes || Math.random() > 0.35 * cfg.birds) return;
        const f = rnd(2600, 4200), n = 2 + ((Math.random() * 3) | 0);
        for (let i = 0; i < n; i++) tone(f * rnd(0.9, 1.1), 0.07, 'sine', 0.025, f * rnd(1.2, 1.5), i * 0.11, amb);
      }, 1400);
    }
    ambNodes = { list, timer };
    const t = ctx.currentTime;
    amb.gain.cancelScheduledValues(t); amb.gain.setValueAtTime(Math.max(0.0001, amb.gain.value), t); amb.gain.linearRampToValueAtTime(1, t + 1.2);
  }
  function ambience(on, venueId) {
    ambWanted = { on: !!on, venue: venueId || ambWanted.venue || 'gym' };
    if (ctx) applyAmbience();
  }

  function setMasterGain() {
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(muted ? 0 : volume * 0.7, t + 0.08);
  }

  PP.Audio = {
    unlock: ensure,
    /** hit(power) kiểu cũ, hoặc hit(kind, quality, power) */
    hit(a, b, c) {
      if (typeof a === 'number' || a === undefined || a === null) return paddle('drive', 'good', a || 1);
      const p = typeof c === 'number' ? c : (KIND_POWER[a] !== undefined ? KIND_POWER[a] : 0.8);
      paddle(a, b || 'good', p);
    },
    perfect: sparkle,
    bounce,
    net: netSound,
    whistle,
    cheer,
    ooh,
    swoosh,
    squeak,
    ambience,
    click() { tone(880, 0.04, 'triangle', 0.1); tone(1320, 0.03, 'sine', 0.04, null, 0.015); },
    win() { [523, 659, 784, 1047].forEach((f, i) => { tone(f, 0.24, 'triangle', 0.15, null, i * 0.12); tone(f * 2, 0.18, 'sine', 0.04, null, i * 0.12 + 0.01); }); },
    lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.32, 'triangle', 0.13, f * 0.97, i * 0.16)); },
    setMuted(m) { muted = !!m; setMasterGain(); },
    setVolume(v) { volume = clamp(+v || 0, 0, 1); setMasterGain(); },
    get muted() { return muted; },
    get volume() { return volume; },
  };
})(window.PP);
