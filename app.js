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
      if (raw) {
        const d = JSON.parse(raw);
        return { settings: mergeSettings(d.settings), shifts: Array.isArray(d.shifts) ? d.shifts : [], templates: Array.isArray(d.templates) ? d.templates : [] };
      }
    } catch (e) { /* 壊れていたら初期値 */ }
    return { settings: C.defaultSettings(), shifts: [], templates: [] };
  }
  function mergeSettings(s) {
    const d = C.defaultSettings();
    if (!s) return d;
    const out = Object.assign({}, d, s);
    ['night', 'overtime', 'holiday', 'transport', 'rounding'].forEach((k) => (out[k] = Object.assign({}, d[k], s[k] || {})));
    if (!Array.isArray(out.wages) || !out.wages.length) out.wages = d.wages;
    if (!Array.isArray(out.walls)) out.walls = d.walls;
    return out;
  }
  let state = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast('保存できませんでした（ブラウザの設定を確認してください）'); }
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
  const mdw = (date) => { const [, m, d] = date.split('-').map(Number); return `${m}/${d}(${WEEK[C.dayOfWeek(date)]})`; };
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2200);
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
    const s = state.settings;
    const sum = C.summarizePeriod(s, state.shifts, curYM);
    const [y, m] = curYM.split('-').map(Number);
    $('#monthTitle').textContent = `${y}年${m}月分`;
    $('#monthSub').textContent = `${mdw(sum.period.from)}〜${mdw(sum.period.to)}　支給日 ${mdw(sum.payDate)}`;
    const t = sum.sum;
    $('#sumTotal').textContent = yen(t.total);
    const rows = [
      ['勤務', `${t.days}日・${hours(t.workedMin)}`],
      ['基本給', yen(t.base)],
    ];
    if (t.night) rows.push([`深夜手当（${hours(t.nightMin)}）`, yen(t.night)]);
    if (t.overtime) rows.push([`残業手当（${hours(t.otMin)}）`, yen(t.overtime)]);
    if (t.holiday) rows.push(['休日手当', yen(t.holiday)]);
    rows.push(['sep']);
    rows.push(['給与（交通費を除く）', yen(t.salary)]);
    rows.push(['交通費', yen(t.transport)]);
    $('#sumBreakdown').innerHTML = rows.map((r) => (r[0] === 'sep' ? '<div class="sep"></div>' : `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`)).join('');

    const list = $('#shiftList');
    if (!sum.rows.length) {
      list.innerHTML = '<li class="empty">まだシフトがありません</li>';
    } else {
      list.innerHTML = sum.rows.map(({ shift, result: r, transport }) => {
        const dow = C.dayOfWeek(shift.date);
        const [, , d] = shift.date.split('-').map(Number);
        const badges = (r.nightMin ? '<span class="badge night">深夜</span>' : '') + (r.otMin ? '<span class="badge ot">残業</span>' : '') + (r.holiday ? '<span class="badge hol">休日</span>' : '');
        const sub = [hours(r.workedMin), shift.breakMin ? `休憩${shift.breakMin}分` : '', `時給${r.wage.toLocaleString()}円`, shift.memo || ''].filter(Boolean).join(' ・ ');
        return `<li data-id="${esc(shift.id)}">
          <div class="shift-date"><div class="d">${d}</div><div class="w ${dow === 6 ? 'sat' : dow === 0 ? 'sun' : ''}">${WEEK[dow]}</div></div>
          <div class="shift-main" data-act="edit"><div class="t">${esc(shift.start)}〜${esc(shift.end)}${badges}</div><div class="m">${r.error ? esc(r.error) : esc(sub)}</div></div>
          <div class="shift-pay">${yen(r.pay.total)}<div class="m">${transport ? '交通費' + yen(transport) : ''}</div></div>
          <button class="del" data-act="del" aria-label="削除">×</button>
        </li>`;
      }).join('');
    }
    renderTemplates();
  }

  $('#shiftList').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const id = li.dataset.id;
    if (act.dataset.act === 'del') {
      const sh = state.shifts.find((x) => x.id === id);
      if (sh && confirm(`${mdw(sh.date)} ${sh.start}〜${sh.end} を削除しますか？`)) {
        state.shifts = state.shifts.filter((x) => x.id !== id);
        save(); renderMonth(); toast('削除しました');
        if (form.sid.value === id) resetForm();
      }
    } else if (act.dataset.act === 'edit') {
      editShift(id);
    }
  });

  // ---------- シフト入力 ----------
  const form = $('#shiftForm');
  function resetForm(keepDate) {
    const date = keepDate ? form.date.value : defaultDate();
    form.reset();
    form.sid.value = '';
    form.date.value = date;
    form.breakMin.value = 0;
    $('#formTitle').textContent = 'シフトを追加';
    $('#saveBtn').textContent = '追加';
    $('#cancelEdit').hidden = true;
    updatePreview();
  }
  function defaultDate() {
    const p = C.periodFor(state.settings, curYM);
    const t = today();
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
  function editShift(id) {
    const s = state.shifts.find((x) => x.id === id);
    if (!s) return;
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
    $('#saveBtn').textContent = '保存';
    $('#cancelEdit').hidden = false;
    updatePreview();
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function updatePreview() {
    const sh = readForm();
    const el = $('#preview');
    if (!sh.date || !sh.start || !sh.end) { el.textContent = ''; return; }
    const others = state.shifts.filter((x) => x.id !== sh.id && x.date === sh.date && (C.toMin(x.start) || 0) < (C.toMin(sh.start) || 0));
    const prior = C.calcShifts(state.settings, others).reduce((a, r) => a + r.result.workedMin, 0);
    const r = C.calcShift(state.settings, sh, prior);
    if (r.error) { el.textContent = r.error; return; }
    const parts = [`実働 ${hours(r.workedMin)}`];
    if (r.nightMin) parts.push(`深夜 ${hours(r.nightMin)}`);
    if (r.otMin) parts.push(`残業 ${hours(r.otMin)}`);
    if (r.holiday) parts.push('休日');
    let warn = '';
    // 労基法34条：6時間超は45分、8時間超は60分の休憩が必要
    const span = r.workedMin + r.breakMin;
    if (span > 480 && r.breakMin < 60) warn = '（8時間を超える勤務は休憩60分以上が必要です）';
    else if (span > 360 && r.breakMin < 45) warn = '（6時間を超える勤務は休憩45分以上が必要です）';
    el.innerHTML = `<strong>${yen(r.pay.total)}</strong>　${esc(parts.join(' ・ '))}${warn ? '<br>' + esc(warn) : ''}`;
  }
  form.addEventListener('input', updatePreview);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const sh = readForm();
    if (!sh.date || !sh.start || !sh.end) return;
    const i = state.shifts.findIndex((x) => x.id === sh.id);
    if (i >= 0) state.shifts[i] = sh; else state.shifts.push(sh);
    save();
    const ym = C.closingMonthOf(state.settings, sh.date);
    toast(i >= 0 ? '保存しました' : '追加しました');
    if (ym !== curYM) curYM = ym;
    // 次の入力は翌日から
    const next = C.addDays(sh.date, 1);
    renderMonth();
    resetForm();
    if (i < 0) {
      form.date.value = next;
      form.start.value = sh.start; form.end.value = sh.end; form.breakMin.value = sh.breakMin;
      updatePreview();
    }
  });
  $('#cancelEdit').addEventListener('click', () => resetForm());

  // ---------- テンプレート ----------
  $('#saveTplBtn').addEventListener('click', () => {
    const sh = readForm();
    if (!sh.start || !sh.end) { toast('出勤・退勤を入れてください'); return; }
    const name = prompt('テンプレートの名前', `${sh.start}〜${sh.end}`);
    if (!name) return;
    state.templates.push({ id: uid(), name: name.slice(0, 20), start: sh.start, end: sh.end, breakMin: sh.breakMin, breakStart: sh.breakStart });
    save(); renderTemplates(); toast('テンプレートに保存しました');
  });
  function renderTemplates() {
    $('#templates').innerHTML = state.templates.map((t) => `<button type="button" class="chip" data-tpl="${esc(t.id)}">${esc(t.name)}</button>`).join('');
    $('#tplList').innerHTML = state.templates.length
      ? state.templates.map((t) => `<li data-tpl="${esc(t.id)}"><div class="shift-main"><div class="t">${esc(t.name)}</div><div class="m">${esc(t.start)}〜${esc(t.end)}${t.breakMin ? ' ・ 休憩' + t.breakMin + '分' : ''}</div></div><button class="del" data-act="deltpl" aria-label="削除">×</button></li>`).join('')
      : '<li class="empty">まだありません</li>';
  }
  $('#templates').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tpl]');
    if (!b) return;
    const t = state.templates.find((x) => x.id === b.dataset.tpl);
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
    $('#yearTitle').textContent = `${curYear}年（1〜12月支給分）`;
    $('#yearSalary').textContent = yen(y.salary);

    // 見込み：まだシフトが無い先の月を、入力済みの月の平均で埋める
    const t = today();
    const withData = y.months.filter((m) => m.sum.salary > 0);
    const avgSalary = withData.length ? withData.reduce((a, m) => a + m.sum.salary, 0) / withData.length : 0;
    const avgTrans = withData.length ? withData.reduce((a, m) => a + m.sum.transport, 0) / withData.length : 0;
    const emptyFuture = y.months.filter((m) => m.sum.salary === 0 && m.payDate > t).length;
    const projSalary = y.salary + avgSalary * emptyFuture;
    const projTotal = y.total + (avgSalary + avgTrans) * emptyFuture;
    $('#yearSub').textContent = `交通費 ${yen(y.transport)}　／　このペースだと年間 約${man(projSalary)}`;

    $('#walls').innerHTML = (s.walls || []).length ? s.walls.map((w) => {
      const amt = Number(w.amount) || 0;
      const cur = w.includeTransport ? y.total : y.salary;
      const proj = w.includeTransport ? projTotal : projSalary;
      const pct = amt ? Math.min(100, (cur / amt) * 100) : 0;
      const ppct = amt ? Math.min(100, (proj / amt) * 100) : 0;
      const left = amt - cur;
      const over = cur > amt;
      const projOver = !over && proj > amt;
      return `<div class="wall">
        <div class="wall-head"><span>${esc(w.label)}</span><span>${man(amt)}</span></div>
        <div class="meter ${over ? 'over' : ''}"><span class="proj" style="width:${ppct}%"></span><span style="width:${pct}%"></span></div>
        <div class="sub">${over ? `<b>${yen(-left)} 超えています</b>` : `あと <b>${yen(left)}</b>`}${w.includeTransport ? '（交通費込み）' : '（交通費を除く）'}${projOver ? '　⚠ このペースだと超えそう' : ''}</div>
      </div>`;
    }).join('') : '<p class="note">設定から追加できます。</p>';

    const max = Math.max(1, ...y.months.map((m) => m.sum.total));
    $('#yearBars').innerHTML = y.months.map((m, i) => {
      const h = (m.sum.total / max) * 100;
      const v = m.sum.total ? Math.round(m.sum.total / 1000) + 'k' : '';
      return `<div class="bar ${m.payDate > t ? 'future' : ''}" title="${i + 1}月支給 ${yen(m.sum.total)}"><div class="v">${v}</div><span style="height:${h}%"></span><small>${i + 1}</small></div>`;
    }).join('');
  }

  // ---------- 設定 ----------
  const sf = $('#settingsForm');
  const cd = $('#closingDay');
  cd.innerHTML = '<option value="0">末日</option>' + Array.from({ length: 30 }, (_, i) => `<option value="${i + 1}">${i + 1}日</option>`).join('');

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
    $('#wageRows').innerHTML = rows.map((w, i) => `<tr data-i="${i}">
      <td><input type="date" data-k="from" value="${esc(w.from)}"></td>
      <td><input type="number" data-k="hourly" min="0" inputmode="numeric" value="${esc(w.hourly)}"></td>
      <td>${rows.length > 1 ? '<button type="button" class="del" data-act="delwage" aria-label="削除">×</button>' : ''}</td></tr>`).join('');
  }
  function renderWallRows() {
    $('#wallRows').innerHTML = state.settings.walls.map((w, i) => `<tr data-i="${i}">
      <td><input type="text" data-k="label" value="${esc(w.label)}"></td>
      <td><input type="number" data-k="amount" min="0" step="10000" inputmode="numeric" value="${esc(w.amount)}"></td>
      <td><input type="checkbox" data-k="includeTransport" ${w.includeTransport ? 'checked' : ''}></td>
      <td><button type="button" class="del" data-act="delwall" aria-label="削除">×</button></td></tr>`).join('');
  }
  function readSettings() {
    const s = state.settings;
    const g = (n) => sf.elements[n];
    const num = (n, d) => { const v = Number(g(n).value); return isNaN(v) || g(n).value === '' ? d : v; };
    s.night = { enabled: g('night.enabled').checked, start: g('night.start').value || '22:00', end: g('night.end').value || '05:00', rate: num('night.ratePct', 25) / 100 };
    s.overtime = { enabled: g('overtime.enabled').checked, thresholdHours: num('overtime.thresholdHours', 8), rate: num('overtime.ratePct', 25) / 100 };
    s.holiday = { addPerHour: num('holiday.addPerHour', 0), weekendAuto: g('holiday.weekendAuto').checked };
    s.transport = { mode: g('transport.mode').value, daily: num('transport.daily', 0), monthly: num('transport.monthly', 0) };
    s.closingDay = num('closingDay', 0); s.payMonthOffset = num('payMonthOffset', 1); s.payDay = num('payDay', 25);
    s.rounding = { unit: num('rounding.unit', 1) };
    $$('#wageRows tr').forEach((tr) => {
      const w = s.wages[Number(tr.dataset.i)];
      if (!w) return;
      w.from = $('[data-k=from]', tr).value || w.from;
      w.hourly = Number($('[data-k=hourly]', tr).value) || 0;
    });
    $$('#wallRows tr').forEach((tr) => {
      const w = s.walls[Number(tr.dataset.i)];
      if (!w) return;
      w.label = $('[data-k=label]', tr).value;
      w.amount = Number($('[data-k=amount]', tr).value) || 0;
      w.includeTransport = $('[data-k=includeTransport]', tr).checked;
    });
  }
  sf.addEventListener('change', (e) => {
    readSettings();
    if (e.target.dataset.k === 'from') renderWageRows();
    save();
    toast('設定を保存しました');
  });
  sf.addEventListener('submit', (e) => e.preventDefault());
  $('#addWage').addEventListener('click', () => {
    readSettings();
    const last = state.settings.wages[state.settings.wages.length - 1];
    state.settings.wages.push({ from: today(), hourly: last ? last.hourly : 1200 });
    save(); renderWageRows();
  });
  $('#wageRows').addEventListener('click', (e) => {
    if (!e.target.closest('[data-act=delwage]')) return;
    readSettings();
    state.settings.wages.splice(Number(e.target.closest('tr').dataset.i), 1);
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
    state.settings.walls.splice(Number(e.target.closest('tr').dataset.i), 1);
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
        save(); fillSettings(); renderMonth(); toast('復元しました');
      } catch (err) { toast('このファイルは読み込めませんでした'); }
      e.target.value = '';
    };
    r.readAsText(f);
  });
  $('#resetAll').addEventListener('click', () => {
    if (!confirm('シフトと設定をすべて消します。よろしいですか？')) return;
    state = { settings: C.defaultSettings(), shifts: [], templates: [] };
    save(); fillSettings(); renderMonth(); resetForm(); toast('消しました');
  });

  // ---------- 起動 ----------
  fillSettings();
  renderMonth();
  resetForm();
})();
