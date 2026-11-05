/* 給料計算 — 画面まわり。計算は calc.js（window.Calc） */
(function () {
  'use strict';
  const C = window.Calc;
  const KEY = 'kyuryo-keisan:v1';
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

  // ---------- 保存 ----------
  function mergeSettings(s) {
    const d = C.defaultSettings();
    if (!s) return d;
    const out = Object.assign({}, d, s);
    ['night', 'overtime', 'holiday', 'transport', 'rounding'].forEach((k) => (out[k] = Object.assign({}, d[k], s[k] || {})));
    if (!Array.isArray(out.wages) || !out.wages.length) out.wages = d.wages;
    if (!Array.isArray(out.walls)) out.walls = d.walls;
    return out;
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        return { settings: mergeSettings(d.settings), shifts: Array.isArray(d.shifts) ? d.shifts : [], templates: Array.isArray(d.templates) ? d.templates : [] };
      }
    } catch (e) { /* 壊れていたら初期値 */ }
    return { settings: C.defaultSettings(), shifts: [], templates: [] };
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
  const man = (n) => (n / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + '万円';
  const hours = (min) => {
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}時間${m}分` : `${h}時間`;
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
    toastTimer = setTimeout(() => (t.hidden = true), 1800);
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- タブ ----------
  $$('.tab').forEach((b) => b.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.toggle('active', x === b));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'year') renderYear();
    if (b.dataset.tab === 'month') renderMonth();
    window.scrollTo(0, 0);
  }));

  // ---------- 月 ----------
  let curYM = C.closingMonthOf(state.settings, today());
  $('#prevMonth').addEventListener('click', () => { curYM = ymAdd(curYM, -1); renderMonth(); });
  $('#nextMonth').addEventListener('click', () => { curYM = ymAdd(curYM, 1); renderMonth(); });

  function renderMonth() {
    const sum = C.summarizePeriod(state.settings, state.shifts, curYM);
    const [y, m] = curYM.split('-').map(Number);
    const thisYear = Number(today().slice(0, 4));
    $('#monthTitle').textContent = (y === thisYear ? '' : y + '年') + m + '月分';
    $('#monthSub').textContent = md(sum.payDate) + ' 支給';
    const t = sum.sum;
    $('#sumTotal').textContent = yen(t.total);
    $('#sumSub').textContent = t.days ? `${t.days}日 ・ ${hours(t.workedMin)}` : 'シフトなし';

    const rows = [['基本給', t.base]];
    if (t.night) rows.push(['深夜手当', t.night]);
    if (t.overtime) rows.push(['残業手当', t.overtime]);
    if (t.holiday) rows.push(['休日手当', t.holiday]);
    rows.push(['交通費', t.transport]);
    $('#sumBreakdown').innerHTML = rows.map((r) => `<dt>${r[0]}</dt><dd>${yen(r[1])}</dd>`).join('') +
      `<dt class="total">合計</dt><dd class="total">${yen(t.total)}</dd>`;

    $('#shiftList').innerHTML = sum.rows.length
      ? sum.rows.map(({ shift: s, result: r }) => {
        const [, , d] = s.date.split('-').map(Number);
        const extra = r.nightMin || r.otMin || r.holiday;
        return `<li data-id="${esc(s.id)}">
          <span class="day">${d}<span class="w">${WEEK[C.dayOfWeek(s.date)]}</span></span>
          <span class="time">${esc(s.start)}–${esc(s.end)}${extra ? '<span class="dot" title="割増あり"></span>' : ''}</span>
          <span class="pay">${r.error ? '—' : yen(r.pay.total)}</span>
        </li>`;
      }).join('')
      : '<li class="empty">シフトはまだありません</li>';
  }
  $('#shiftList').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li) openSheet(li.dataset.id);
  });

  // ---------- シフト入力シート ----------
  const sheet = $('#sheet');
  const form = $('#shiftForm');
  let lastTimes = null; // 直前に保存した時刻（次の入力に使う）

  function openSheet(id) {
    form.reset();
    $('details', form).open = false;
    const s = id && state.shifts.find((x) => x.id === id);
    if (s) {
      form.sid.value = s.id;
      form.date.value = s.date;
      form.start.value = s.start;
      form.end.value = s.end;
      form.breakMin.value = s.breakMin || 0;
      form.breakStart.value = s.breakStart || '';
      form.holiday.value = s.holiday === true ? '1' : s.holiday === false ? '0' : '';
      form.transport.value = s.transport == null ? '' : s.transport;
      form.memo.value = s.memo || '';
      if (s.breakStart || s.holiday != null || s.transport != null || s.memo) $('details', form).open = true;
      $('#formTitle').textContent = 'シフトを編集';
      $('#deleteBtn').hidden = false;
    } else {
      form.sid.value = '';
      form.date.value = nextDate();
      if (lastTimes) { form.start.value = lastTimes.start; form.end.value = lastTimes.end; }
      form.breakMin.value = lastTimes ? lastTimes.breakMin : 0;
      $('#formTitle').textContent = 'シフトを追加';
      $('#deleteBtn').hidden = true;
    }
    renderTemplates();
    updatePreview();
    sheet.showModal();
  }
  function nextDate() {
    const p = C.periodFor(state.settings, curYM);
    const t = today();
    if (t >= p.from && t <= p.to && !state.shifts.some((s) => s.date === t)) return t;
    const inPeriod = state.shifts.filter((s) => s.date >= p.from && s.date <= p.to).map((s) => s.date).sort();
    if (inPeriod.length) {
      const n = C.addDays(inPeriod[inPeriod.length - 1], 1);
      if (n <= p.to) return n;
    }
    return t >= p.from && t <= p.to ? t : p.from;
  }
  function readForm() {
    const f = form;
    return {
      id: f.sid.value || uid(),
      date: f.date.value,
      start: f.start.value,
      end: f.end.value,
      breakMin: Number(f.breakMin.value) || 0,
      breakStart: f.breakStart.value || '',
      holiday: f.holiday.value === '' ? null : f.holiday.value === '1',
      transport: f.transport.value === '' ? null : Number(f.transport.value),
      memo: f.memo.value.trim(),
    };
  }
  function updatePreview() {
    const sh = readForm();
    const el = $('#preview');
    if (!sh.date || !sh.start || !sh.end) { el.innerHTML = ''; return; }
    const others = state.shifts.filter((x) => x.id !== sh.id && x.date === sh.date && (C.toMin(x.start) || 0) < (C.toMin(sh.start) || 0));
    const prior = C.calcShifts(state.settings, others).reduce((a, r) => a + r.result.workedMin, 0);
    const r = C.calcShift(state.settings, sh, prior);
    if (r.error) { el.textContent = r.error; return; }
    const parts = [hours(r.workedMin)];
    if (r.nightMin) parts.push(`深夜${hours(r.nightMin)}`);
    if (r.otMin) parts.push(`残業${hours(r.otMin)}`);
    if (r.holiday) parts.push('休日');
    // 労基法34条：6時間超は45分、8時間超は60分の休憩
    const span = r.workedMin + r.breakMin;
    let warn = '';
    if (span > 480 && r.breakMin < 60) warn = '8時間を超えるときは休憩60分以上が必要です';
    else if (span > 360 && r.breakMin < 45) warn = '6時間を超えるときは休憩45分以上が必要です';
    el.innerHTML = `<strong>${yen(r.pay.total)}</strong><span class="muted small">${esc(parts.join(' ・ '))}</span>${warn ? `<div class="warn">${esc(warn)}</div>` : ''}`;
  }
  form.addEventListener('input', updatePreview);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const sh = readForm();
    if (!sh.date || !sh.start || !sh.end) { toast('日付と時間を入れてください'); return; }
    const i = state.shifts.findIndex((x) => x.id === sh.id);
    if (i >= 0) state.shifts[i] = sh; else state.shifts.push(sh);
    lastTimes = { start: sh.start, end: sh.end, breakMin: sh.breakMin };
    save();
    curYM = C.closingMonthOf(state.settings, sh.date);
    sheet.close();
    renderMonth();
    toast(i >= 0 ? '保存しました' : '追加しました');
  });
  $('#closeSheet').addEventListener('click', () => sheet.close());
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); }); // 外側タップで閉じる
  $('#deleteBtn').addEventListener('click', () => {
    const id = form.sid.value;
    if (!id || !confirm('このシフトを削除しますか？')) return;
    state.shifts = state.shifts.filter((x) => x.id !== id);
    save(); sheet.close(); renderMonth(); toast('削除しました');
  });
  $('#openAdd').addEventListener('click', () => openSheet(null));

  // ---------- テンプレート ----------
  $('#saveTplBtn').addEventListener('click', () => {
    const sh = readForm();
    if (!sh.start || !sh.end) { toast('出勤・退勤を入れてください'); return; }
    const name = prompt('テンプレートの名前', `${sh.start}–${sh.end}`);
    if (!name) return;
    state.templates.push({ id: uid(), name: name.slice(0, 20), start: sh.start, end: sh.end, breakMin: sh.breakMin, breakStart: sh.breakStart });
    save(); renderTemplates(); toast('保存しました');
  });
  function renderTemplates() {
    $('#templates').innerHTML = state.templates.map((t) => `<button type="button" class="chip" data-tpl="${esc(t.id)}">${esc(t.name)}</button>`).join('');
    $('#tplList').innerHTML = state.templates.length
      ? state.templates.map((t) => `<li data-tpl="${esc(t.id)}"><span class="time" style="color:var(--text)">${esc(t.name)}</span><span class="muted small">${esc(t.start)}–${esc(t.end)}</span><button class="del" data-act="deltpl" aria-label="削除">×</button></li>`).join('')
      : '<li class="empty">シフト入力の「その他」から保存できます</li>';
  }
  $('#templates').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tpl]');
    const t = b && state.templates.find((x) => x.id === b.dataset.tpl);
    if (!t) return;
    form.start.value = t.start; form.end.value = t.end;
    form.breakMin.value = t.breakMin || 0; form.breakStart.value = t.breakStart || '';
    updatePreview();
  });
  $('#tplList').addEventListener('click', (e) => {
    if (!e.target.closest('[data-act=deltpl]')) return;
    const id = e.target.closest('li').dataset.tpl;
    state.templates = state.templates.filter((x) => x.id !== id);
    save(); renderTemplates();
  });

  // ---------- 年間 ----------
  let curYear = Number(C.payDateFor(state.settings, curYM).slice(0, 4));
  $('#prevYear').addEventListener('click', () => { curYear--; renderYear(); });
  $('#nextYear').addEventListener('click', () => { curYear++; renderYear(); });

  function renderYear() {
    const s = state.settings;
    const y = C.summarizeYear(s, state.shifts, curYear);
    $('#yearTitle').textContent = `${curYear}年`;
    $('#yearSalary').textContent = yen(y.salary);

    // 見込み：まだシフトが無い先の月を、入力済みの月の平均で埋める
    const t = today();
    const withData = y.months.filter((m) => m.sum.salary > 0);
    const avgSalary = withData.length ? withData.reduce((a, m) => a + m.sum.salary, 0) / withData.length : 0;
    const avgTrans = withData.length ? withData.reduce((a, m) => a + m.sum.transport, 0) / withData.length : 0;
    const emptyFuture = y.months.filter((m) => m.sum.salary === 0 && m.payDate > t).length;
    const projSalary = y.salary + avgSalary * emptyFuture;
    const projTotal = y.total + (avgSalary + avgTrans) * emptyFuture;
    $('#yearSub').textContent = y.salary ? `交通費を除く ・ このペースで年 約${man(projSalary)}` : '交通費を除く';

    $('#walls').innerHTML = (s.walls || []).length ? s.walls.map((w) => {
      const amt = Number(w.amount) || 0;
      const cur = w.includeTransport ? y.total : y.salary;
      const proj = w.includeTransport ? projTotal : projSalary;
      const pct = amt ? Math.min(100, (cur / amt) * 100) : 0;
      const over = cur > amt;
      let note = over ? `<b>${yen(cur - amt)}</b> 超えています` : `あと <b>${yen(amt - cur)}</b>`;
      if (!over && proj > amt) note += '（このペースだと超えそう）';
      return `<div class="wall">
        <div class="wall-head"><span>${esc(w.label)}</span><span class="muted">${man(amt)}</span></div>
        <div class="meter ${over ? 'over' : ''}"><span style="width:${pct}%"></span></div>
        <div class="small muted">${note}</div>
      </div>`;
    }).join('') : '<div class="wall muted small">設定から追加できます</div>';

    const months = y.months.map((m, i) => [i + 1, m]).filter(([, m]) => m.sum.total > 0);
    $('#yearMonths').innerHTML = months.length
      ? months.map(([i, m]) => `<dt>${i}月</dt><dd>${yen(m.sum.salary)}</dd>`).join('')
      : '<dt class="muted">まだありません</dt><dd></dd>';
  }

  // ---------- 設定 ----------
  const sf = $('#settingsForm');
  $('#closingDay').innerHTML = '<option value="0">末日</option>' + Array.from({ length: 30 }, (_, i) => `<option value="${i + 1}">${i + 1}日</option>`).join('');

  function fillSettings() {
    const s = state.settings;
    const set = (n, v) => { const el = sf.elements[n]; if (!el) return; if (el.type === 'checkbox') el.checked = !!v; else el.value = v; };
    set('night.enabled', s.night.enabled); set('night.start', s.night.start); set('night.end', s.night.end); set('night.ratePct', Math.round(s.night.rate * 100));
    set('overtime.enabled', s.overtime.enabled); set('overtime.thresholdHours', s.overtime.thresholdHours); set('overtime.ratePct', Math.round(s.overtime.rate * 100));
    set('holiday.addPerHour', s.holiday.addPerHour); set('holiday.weekendAuto', s.holiday.weekendAuto);
    set('transport.mode', s.transport.mode); set('transport.daily', s.transport.daily); set('transport.monthly', s.transport.monthly);
    set('closingDay', s.closingDay); set('payMonthOffset', s.payMonthOffset); set('payDay', s.payDay); set('rounding.unit', s.rounding.unit);
    renderWageRows(); renderWallRows();
  }
  function renderWageRows() {
    const rows = state.settings.wages.slice().sort((a, b) => (a.from < b.from ? -1 : 1));
    state.settings.wages = rows;
    if (rows.length === 1) {
      $('#wageRows').innerHTML = `<label class="row" data-i="0">時給（円）<input type="number" data-k="hourly" min="0" inputmode="numeric" value="${esc(rows[0].hourly)}"></label>`;
      return;
    }
    $('#wageRows').innerHTML = rows.map((w, i) => `<div class="row" data-i="${i}">
      <span class="pair">${i === 0 ? '<span>最初の時給</span>' : `<input type="date" data-k="from" value="${esc(w.from)}">から`}</span>
      <span class="pair"><input type="number" data-k="hourly" min="0" inputmode="numeric" value="${esc(w.hourly)}" style="width:70px">円
      ${i > 0 ? '<button type="button" class="del" data-act="delwage" aria-label="削除">×</button>' : ''}</span>
    </div>`).join('');
  }
  function renderWallRows() {
    $('#wallRows').innerHTML = state.settings.walls.map((w, i) => `<div class="row" data-i="${i}">
      <input type="text" data-k="label" value="${esc(w.label)}" style="text-align:left;flex:1;width:auto">
      <span class="pair"><input type="number" data-k="amount" min="0" step="10000" inputmode="numeric" value="${esc(w.amount)}" style="width:84px">円
      <button type="button" class="del" data-act="delwall" aria-label="削除">×</button></span>
    </div>`).join('') + '<p class="muted small" style="margin:0;padding:8px 16px 12px">金額は目安です。制度が変わったら直してください。</p>';
  }
  function readSettings() {
    const s = state.settings;
    const g = (n) => sf.elements[n];
    const num = (n, d) => { const v = Number(g(n).value); return g(n).value === '' || isNaN(v) ? d : v; };
    s.night = { enabled: g('night.enabled').checked, start: g('night.start').value || '22:00', end: g('night.end').value || '05:00', rate: num('night.ratePct', 25) / 100 };
    s.overtime = { enabled: g('overtime.enabled').checked, thresholdHours: num('overtime.thresholdHours', 8), rate: num('overtime.ratePct', 25) / 100 };
    s.holiday = { addPerHour: num('holiday.addPerHour', 0), weekendAuto: g('holiday.weekendAuto').checked };
    s.transport = { mode: g('transport.mode').value, daily: num('transport.daily', 0), monthly: num('transport.monthly', 0) };
    s.closingDay = num('closingDay', 0); s.payMonthOffset = num('payMonthOffset', 1); s.payDay = num('payDay', 25);
    s.rounding = { unit: num('rounding.unit', 1) };
    $$('#wageRows [data-i]').forEach((row) => {
      const w = s.wages[Number(row.dataset.i)];
      if (!w) return;
      const from = $('[data-k=from]', row);
      if (from && from.value) w.from = from.value;
      w.hourly = Number($('[data-k=hourly]', row).value) || 0;
    });
    $$('#wallRows [data-i]').forEach((row) => {
      const w = s.walls[Number(row.dataset.i)];
      if (!w) return;
      w.label = $('[data-k=label]', row).value;
      w.amount = Number($('[data-k=amount]', row).value) || 0;
    });
  }
  sf.addEventListener('change', (e) => {
    readSettings();
    if (e.target.dataset.k === 'from') renderWageRows();
    save();
  });
  sf.addEventListener('submit', (e) => e.preventDefault());
  $('#addWage').addEventListener('click', () => {
    readSettings();
    const last = state.settings.wages[state.settings.wages.length - 1];
    if (state.settings.wages.length === 1) last.from = '2000-01-01';
    state.settings.wages.push({ from: today(), hourly: last ? last.hourly : 1200 });
    save(); renderWageRows();
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
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $('#exportCsv').addEventListener('click', () => {
    const rows = C.calcShifts(state.settings, state.shifts);
    const head = ['日付', '曜日', '出勤', '退勤', '休憩(分)', '実働(分)', '深夜(分)', '残業(分)', '休日', '時給', '基本給', '深夜手当', '残業手当', '休日手当', '給与', '交通費', '締め月', 'メモ'];
    const q = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [head.join(',')].concat(rows.map(({ shift: s, result: r, transport }) => [
      s.date, WEEK[C.dayOfWeek(s.date)], s.start, s.end, r.breakMin, r.workedMin, r.nightMin, r.otMin, r.holiday ? '○' : '', r.wage,
      Math.round(r.pay.base), Math.round(r.pay.night), Math.round(r.pay.overtime), Math.round(r.pay.holiday), Math.round(r.pay.total), transport,
      C.closingMonthOf(state.settings, s.date), s.memo || '',
    ].map(q).join(',')));
    download(`kyuryo-${today()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv'); // BOM付きでExcelでも文字化けしない
  });
  $('#exportJson').addEventListener('click', () => {
    download(`kyuryo-backup-${today()}.json`, JSON.stringify(Object.assign({ app: 'kyuryo-keisan', version: 1 }, state), null, 2), 'application/json');
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
        state = { settings: mergeSettings(d.settings), shifts: d.shifts, templates: Array.isArray(d.templates) ? d.templates : [] };
        save(); fillSettings(); renderTemplates(); renderMonth(); toast('戻しました');
      } catch (err) { toast('このファイルは読み込めませんでした'); }
      e.target.value = '';
    };
    r.readAsText(f);
  });
  $('#resetAll').addEventListener('click', () => {
    if (!confirm('シフトと設定をすべて消します。よろしいですか？')) return;
    state = { settings: C.defaultSettings(), shifts: [], templates: [] };
    save(); fillSettings(); renderTemplates(); renderMonth(); toast('消しました');
  });

  // ---------- 起動 ----------
  fillSettings();
  renderTemplates();
  renderMonth();
})();
