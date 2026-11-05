/* 給料計算 — 画面まわり。計算は calc.js（window.Calc） */
(function () {
  'use strict';
  const C = window.Calc;
  const KEY = 'kyuryo-keisan:v1';
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

  // ---------- 保存 ----------
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return C.migrate(JSON.parse(raw));
    } catch (e) { /* 壊れていたら初期値 */ }
    return C.migrate(null);
  }
  let state = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast('保存できませんでした'); }
  }

  // ---------- 小物 ----------
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const yen = (n) => '¥' + Math.round(n).toLocaleString('ja-JP');
  const man = (n) => (n / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + '万';
  const hours = (min) => { const h = Math.floor(min / 60), m = min % 60; return m ? `${h}時間${m}分` : `${h}時間`; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function ymAdd(ym, n) {
    const [y, m] = ym.split('-').map(Number);
    const t = y * 12 + (m - 1) + n;
    return Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0');
  }
  const md = (date) => { const [, m, d] = date.split('-').map(Number); return `${m}/${d}`; };
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 1600);
  }

  // ---------- タブ ----------
  $$('.tab').forEach((b) => b.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.toggle('active', x === b));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'pay') render();
    window.scrollTo(0, 0);
  }));

  // ---------- 給料 ----------
  let curYM = C.closingMonthOf(state.settings, today());
  $('#prev').addEventListener('click', () => { curYM = ymAdd(curYM, -1); render(); });
  $('#next').addEventListener('click', () => { curYM = ymAdd(curYM, 1); render(); });

  function render() {
    const s = state.settings;
    const sum = C.summarizePeriod(s, state.shifts, curYM);
    const [y, m] = curYM.split('-').map(Number);
    $('#monthTitle').textContent = (y === Number(today().slice(0, 4)) ? '' : y + '年') + m + '月分';
    const t = sum.sum;
    $('#total').textContent = yen(t.total);
    $('#totalSub').textContent = (t.days ? `${t.days}日・${hours(t.workedMin)}・` : '') + `${md(sum.payDate)}支給`;

    const rows = [['基本給', t.base]];
    if (t.night) rows.push(['深夜手当', t.night]);
    if (t.overtime) rows.push(['残業手当', t.overtime]);
    rows.push(['交通費', t.transport]);
    $('#breakdown').innerHTML = rows.map((r) => `<dt>${r[0]}</dt><dd>${yen(r[1])}</dd>`).join('');

    const showWage = s.wages.length > 1;
    $('#shiftList').innerHTML = sum.rows.length
      ? sum.rows.map(({ shift: sh, result: r }) => {
        const d = Number(sh.date.slice(8));
        const w = showWage ? s.wages.find((x) => x.id === sh.wageId) : null;
        return `<li data-id="${esc(sh.id)}">
          <span class="day">${d}<small>${WEEK[C.dayOfWeek(sh.date)]}</small></span>
          <span class="time">${esc(sh.start)}–${esc(sh.end)}${w ? `<small>${esc(w.name)}</small>` : ''}</span>
          <span class="pay">${r.error ? '—' : yen(r.pay.total)}</span>
        </li>`;
      }).join('')
      : '<li class="empty">シフトはまだありません</li>';

    // 今年（支給日ベース）と年収の壁
    const year = Number(sum.payDate.slice(0, 4));
    const ys = C.summarizeYear(s, state.shifts, year);
    $('#yearLabel').textContent = `${year}年の合計（支給日ベース）`;
    const walls = (s.walls || []).map((w) => {
      const amt = Number(w.amount) || 0;
      const cur = w.includeTransport ? ys.total : ys.salary;
      const over = cur > amt;
      const pct = amt ? Math.min(100, (cur / amt) * 100) : 0;
      return `<div class="wall">
        <div class="wall-head"><span>${esc(w.label)}（${man(amt)}）</span><span class="${over ? 'over-text' : 'muted'}">${over ? yen(cur - amt) + ' 超え' : 'あと ' + yen(amt - cur)}</span></div>
        <div class="meter ${over ? 'over' : ''}"><span style="width:${pct}%"></span></div>
      </div>`;
    }).join('');
    $('#yearBox').innerHTML = `<div class="wall"><div class="wall-head"><span>給与（交通費を除く）</span><span>${yen(ys.salary)}</span></div></div>` + walls;
  }
  $('#shiftList').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li) openSheet(li.dataset.id);
  });

  // ---------- シフト入力 ----------
  const sheet = $('#sheet');
  const form = $('#shiftForm');
  let last = null; // 直前に保存したシフト（次の入力の初期値）
  let pickedWage = null;

  function renderWagePick() {
    const ws = state.settings.wages;
    if (!ws.some((w) => w.id === pickedWage)) pickedWage = ws[0].id;
    $('#wagePick').innerHTML = ws.length > 1
      ? ws.map((w) => `<button type="button" data-w="${esc(w.id)}" class="${w.id === pickedWage ? 'on' : ''}">${esc(w.name)}<small>${Number(w.hourly).toLocaleString()}円</small></button>`).join('')
      : '';
  }
  $('#wagePick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-w]');
    if (!b) return;
    pickedWage = b.dataset.w;
    renderWagePick(); updatePreview();
  });

  function openSheet(id) {
    form.reset();
    const sh = id && state.shifts.find((x) => x.id === id);
    if (sh) {
      form.sid.value = sh.id;
      form.date.value = sh.date; form.start.value = sh.start; form.end.value = sh.end; form.breakMin.value = sh.breakMin || 0;
      pickedWage = sh.wageId;
      $('#formTitle').textContent = 'シフトを編集';
      $('#deleteBtn').hidden = false;
    } else {
      form.sid.value = '';
      form.date.value = nextDate();
      if (last) { form.start.value = last.start; form.end.value = last.end; form.breakMin.value = last.breakMin; }
      pickedWage = last ? last.wageId : null;
      $('#formTitle').textContent = 'シフトを追加';
      $('#deleteBtn').hidden = true;
    }
    renderWagePick();
    updatePreview();
    sheet.showModal();
  }
  function nextDate() {
    const p = C.periodFor(state.settings, curYM);
    const t = today();
    const used = state.shifts.filter((s) => s.date >= p.from && s.date <= p.to).map((s) => s.date).sort();
    if (t >= p.from && t <= p.to && !used.includes(t)) return t;
    if (used.length) {
      const n = C.addDays(used[used.length - 1], 1);
      if (n <= p.to) return n;
    }
    return t >= p.from && t <= p.to ? t : p.from;
  }
  function readForm() {
    const old = state.shifts.find((x) => x.id === form.sid.value);
    const w = state.settings.wages.find((x) => x.id === pickedWage) || state.settings.wages[0];
    // 時給を選び直していなければ、保存済みの時給をそのまま使う
    const hourly = old && old.wageId === w.id && old.hourly != null ? old.hourly : Number(w.hourly) || 0;
    return {
      id: form.sid.value || uid(),
      date: form.date.value, start: form.start.value, end: form.end.value,
      breakMin: Number(form.breakMin.value) || 0,
      wageId: w.id, hourly,
    };
  }
  function updatePreview() {
    const sh = readForm();
    const el = $('#preview');
    if (!sh.date || !sh.start || !sh.end) { el.innerHTML = ''; return; }
    const before = state.shifts.filter((x) => x.id !== sh.id && x.date === sh.date && (C.toMin(x.start) || 0) < (C.toMin(sh.start) || 0));
    const prior = C.calcShifts(state.settings, before).reduce((a, r) => a + r.result.workedMin, 0);
    const r = C.calcShift(state.settings, sh, prior);
    if (r.error) { el.textContent = r.error; return; }
    const span = r.workedMin + r.breakMin; // 労基法34条：6時間超は45分、8時間超は60分の休憩
    const warn = span > 480 && r.breakMin < 60 ? '8時間を超えるときは休憩60分以上が必要です'
      : span > 360 && r.breakMin < 45 ? '6時間を超えるときは休憩45分以上が必要です' : '';
    el.innerHTML = `<strong>${yen(r.pay.total)}</strong><span class="muted">${hours(r.workedMin)}</span>${warn ? `<div class="warn">${warn}</div>` : ''}`;
  }
  form.addEventListener('input', updatePreview);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const sh = readForm();
    if (!sh.date || !sh.start || !sh.end) { toast('日付と時間を入れてください'); return; }
    const i = state.shifts.findIndex((x) => x.id === sh.id);
    if (i >= 0) state.shifts[i] = sh; else state.shifts.push(sh);
    last = sh;
    save();
    curYM = C.closingMonthOf(state.settings, sh.date);
    sheet.close();
    render();
    toast(i >= 0 ? '保存しました' : '追加しました');
  });
  $('#closeSheet').addEventListener('click', () => sheet.close());
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });
  $('#deleteBtn').addEventListener('click', () => {
    if (!confirm('このシフトを削除しますか？')) return;
    state.shifts = state.shifts.filter((x) => x.id !== form.sid.value);
    save(); sheet.close(); render(); toast('削除しました');
  });
  $('#openAdd').addEventListener('click', () => openSheet(null));

  // ---------- 設定 ----------
  const sf = $('#settingsForm');
  $('#closingDay').innerHTML = '<option value="0">末日</option>' + Array.from({ length: 30 }, (_, i) => `<option value="${i + 1}">${i + 1}日</option>`).join('');

  function fillSettings() {
    const s = state.settings;
    const set = (n, v) => { const el = sf.elements[n]; if (el.type === 'checkbox') el.checked = !!v; else el.value = v; };
    set('transport.daily', s.transport.daily);
    set('night.enabled', s.night.enabled); set('night.start', s.night.start); set('night.end', s.night.end); set('night.ratePct', Math.round(s.night.rate * 100));
    set('overtime.enabled', s.overtime.enabled); set('overtime.thresholdHours', s.overtime.thresholdHours); set('overtime.ratePct', Math.round(s.overtime.rate * 100));
    set('transport.mode', s.transport.mode); set('transport.monthly', s.transport.monthly);
    set('closingDay', s.closingDay); set('payMonthOffset', s.payMonthOffset); set('payDay', s.payDay);
    renderWageRows(); renderWallRows();
  }
  function renderWageRows() {
    const ws = state.settings.wages;
    $('#wageRows').innerHTML = ws.map((w, i) => `<div class="row" data-i="${i}">
      <input type="text" class="name" data-k="name" value="${esc(w.name)}" maxlength="12" placeholder="名前">
      <span class="unit"><input type="number" data-k="hourly" min="0" inputmode="numeric" value="${esc(w.hourly)}">円</span>
      ${ws.length > 1 ? '<button type="button" class="del" data-act="delwage" aria-label="削除">×</button>' : ''}
    </div>`).join('');
  }
  function renderWallRows() {
    $('#wallRows').innerHTML = state.settings.walls.map((w, i) => `<div class="row" data-i="${i}">
      <input type="text" class="name" data-k="label" value="${esc(w.label)}">
      <span class="unit"><input type="number" data-k="amount" min="0" step="10000" inputmode="numeric" value="${esc(w.amount)}" style="width:86px">円</span>
      <button type="button" class="del" data-act="delwall" aria-label="削除">×</button>
    </div>`).join('');
  }
  function readSettings() {
    const s = state.settings;
    const g = (n) => sf.elements[n];
    const num = (n, d) => { const v = Number(g(n).value); return g(n).value === '' || isNaN(v) ? d : v; };
    s.night = { enabled: g('night.enabled').checked, start: g('night.start').value || '22:00', end: g('night.end').value || '05:00', rate: num('night.ratePct', 25) / 100 };
    s.overtime = { enabled: g('overtime.enabled').checked, thresholdHours: num('overtime.thresholdHours', 8), rate: num('overtime.ratePct', 25) / 100 };
    s.transport = { mode: g('transport.mode').value, daily: num('transport.daily', 0), monthly: num('transport.monthly', 0) };
    s.closingDay = num('closingDay', 0); s.payMonthOffset = num('payMonthOffset', 1); s.payDay = num('payDay', 25);
    $$('#wageRows [data-i]').forEach((row) => {
      const w = s.wages[Number(row.dataset.i)];
      w.name = $('[data-k=name]', row).value.trim() || '時給';
      w.hourly = Number($('[data-k=hourly]', row).value) || 0;
    });
    $$('#wallRows [data-i]').forEach((row) => {
      const w = s.walls[Number(row.dataset.i)];
      w.label = $('[data-k=label]', row).value;
      w.amount = Number($('[data-k=amount]', row).value) || 0;
    });
  }
  sf.addEventListener('change', () => { readSettings(); save(); });
  sf.addEventListener('submit', (e) => e.preventDefault());
  $('#addWage').addEventListener('click', () => {
    readSettings();
    const ws = state.settings.wages;
    ws.push({ id: uid(), name: `時給${ws.length + 1}`, hourly: ws[ws.length - 1].hourly });
    save(); renderWageRows();
    $('#wageRows .row:last-child [data-k=name]').select();
  });
  $('#wageRows').addEventListener('click', (e) => {
    if (!e.target.closest('[data-act=delwage]')) return;
    readSettings();
    state.settings.wages.splice(Number(e.target.closest('[data-i]').dataset.i), 1);
    save(); renderWageRows();
  });
  $('#addWall').addEventListener('click', () => {
    readSettings();
    state.settings.walls.push({ label: '新しい壁', amount: 1000000, includeTransport: false });
    save(); renderWallRows();
  });
  $('#wallRows').addEventListener('click', (e) => {
    if (!e.target.closest('[data-act=delwall]')) return;
    readSettings();
    state.settings.walls.splice(Number(e.target.closest('[data-i]').dataset.i), 1);
    save(); renderWallRows();
  });

  // ---------- データ ----------
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $('#exportCsv').addEventListener('click', () => {
    const rows = C.calcShifts(state.settings, state.shifts);
    const head = ['日付', '曜日', '出勤', '退勤', '休憩(分)', '実働(分)', '深夜(分)', '残業(分)', '時給名', '時給', '基本給', '深夜手当', '残業手当', '給与', '交通費'];
    const q = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [head.join(',')].concat(rows.map(({ shift: s, result: r, transport }) => {
      const w = state.settings.wages.find((x) => x.id === s.wageId);
      return [s.date, WEEK[C.dayOfWeek(s.date)], s.start, s.end, r.breakMin, r.workedMin, r.nightMin, r.otMin, w ? w.name : '', r.wage,
        Math.round(r.pay.base), Math.round(r.pay.night), Math.round(r.pay.overtime), Math.round(r.pay.total), transport].map(q).join(',');
    }));
    download(`kyuryo-${today()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv'); // BOM付きでExcelでも文字化けしない
  });
  $('#exportJson').addEventListener('click', () => {
    download(`kyuryo-backup-${today()}.json`, JSON.stringify(Object.assign({ app: 'kyuryo-keisan', version: 2 }, state), null, 2), 'application/json');
  });
  $('#importJson').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!Array.isArray(d.shifts)) throw new Error();
        if (!confirm(`シフト${d.shifts.length}件のバックアップで上書きしますか？`)) return;
        state = C.migrate(d);
        save(); fillSettings(); render(); toast('戻しました');
      } catch (err) { toast('このファイルは読み込めませんでした'); }
      e.target.value = '';
    };
    r.readAsText(f);
  });
  $('#resetAll').addEventListener('click', () => {
    if (!confirm('シフトと設定をすべて消します。よろしいですか？')) return;
    state = C.migrate(null);
    save(); fillSettings(); render(); toast('消しました');
  });

  fillSettings();
  render();
})();
