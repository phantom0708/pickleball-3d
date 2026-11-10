/* Pickle Pop – tiện ích giao diện (DOM) */
(function (PP) {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  function show(id) {
    $$('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== id));
  }
  function hideScreens() { $$('.screen').forEach((s) => s.classList.add('hidden')); }
  function visible(id) { const e = document.getElementById(id); return e && !e.classList.contains('hidden'); }

  let toastTimer = 0;
  function toast(text, ms) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 2600);
  }

  /** Nút chọn kiểu segmented. onPick(value) */
  function seg(el, value, onPick) {
    const btns = Array.from(el.querySelectorAll('button'));
    const set = (v) => btns.forEach((b) => b.classList.toggle('sel', b.dataset.v === String(v)));
    btns.forEach((b) => { b.onclick = () => { PP.Audio.click(); set(b.dataset.v); onPick(b.dataset.v); }; });
    set(value);
    return set;
  }

  function charGrid(el, selected, wins, onPick) {
    el.textContent = '';
    for (const c of PP.CHARACTERS) {
      const locked = wins < c.unlock;
      const b = document.createElement('button');
      b.className = 'char' + (c.id === selected ? ' sel' : '') + (locked ? ' locked' : '');
      b.title = c.name + (locked ? ' – thắng ' + c.unlock + ' trận để mở' : '');
      const em = avatarEl(c.id, 'em');
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = c.name;
      b.append(em, nm);
      if (locked) { const lk = document.createElement('span'); lk.className = 'lk'; lk.textContent = '🔒 Thắng ' + c.unlock + ' trận'; b.append(lk); }
      b.onclick = () => {
        if (locked) { toast('Thắng ' + c.unlock + ' trận để mở khóa ' + c.name); return; }
        PP.Audio.click();
        el.querySelectorAll('.char').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        onPick(c.id);
      };
      el.append(b);
    }
  }

  /** Ảnh chân dung render 3D (PP.Portraits) hoặc emoji dự phòng */
  function avatarEl(id, cls) {
    const url = PP.Portraits && PP.Portraits.get(id);
    if (url) { const img = document.createElement('img'); img.className = 'pic'; img.src = url; img.alt = ''; return img; }
    const em = document.createElement('span'); em.className = cls || 'em';
    const c = PP.CHARACTERS.find((x) => x.id === id);
    em.textContent = c ? c.emoji : '🙂';
    return em;
  }

  function venueList(el, selected, onPick) {
    el.textContent = '';
    for (const v of PP.VENUES) {
      const b = document.createElement('button');
      b.className = 'venue' + (v.id === selected ? ' sel' : '');
      const sw = document.createElement('span'); sw.className = 'sw';
      const th = PP.VenueThumbs && PP.VenueThumbs.get(v.id);
      if (th) sw.style.backgroundImage = `url(${th})`;
      else sw.style.background = `linear-gradient(135deg, #${v.sky.toString(16).padStart(6, '0')} 50%, #${v.court.toString(16).padStart(6, '0')} 50%)`;
      const tx = document.createElement('span');
      const n = document.createElement('b'); n.textContent = v.name;
      const d = document.createElement('small'); d.textContent = v.desc;
      tx.append(n, d);
      b.append(sw, tx);
      b.onclick = () => {
        PP.Audio.click();
        el.querySelectorAll('.venue').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        onPick(v.id);
      };
      el.append(b);
    }
  }

  function setMsg(text) {
    const m = $('#msg'); m.textContent = '';
    if (text) { const s = document.createElement('span'); s.textContent = text; m.append(s); }
  }
  let hintTimer = 0;
  function hint(text, ms) {
    const h = $('#hint'); h.textContent = '';
    const s = document.createElement('span'); s.textContent = text; h.append(s);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { h.textContent = ''; }, ms || 3000);
  }
  let callTimer = 0;
  function call(main, sub, kind) {
    const c = $('#call');
    $('#call-main').textContent = main;
    $('#call-sub').textContent = sub || '';
    c.className = 'show ' + (kind || '');
    clearTimeout(callTimer);
    callTimer = setTimeout(() => { c.className = ''; }, 1700);
  }
  function hideCall() { $('#call').className = ''; }
  function pop(text) {
    const p = $('#pop');
    p.textContent = text;
    p.classList.remove('show'); void p.offsetWidth; p.classList.add('show');
  }
  function banner(text) {
    const b = $('#banner');
    if (!text) { b.classList.add('hidden'); return; }
    b.textContent = text; b.classList.remove('hidden');
  }

  PP.UI = { $, $$, avatarEl, show, hideScreens, visible, toast, seg, charGrid, venueList, setMsg, hint, call, hideCall, pop, banner };
})(window.PP);
