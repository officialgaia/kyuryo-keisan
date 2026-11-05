/*
 * 給料計算ロジック（画面から独立。ブラウザでは window.Calc、Node では require で読み込める）
 *
 * 時刻は "HH:MM"、日付は "YYYY-MM-DD" の文字列。金額は円。
 * 端数は締め月の合計で 1 円未満を四捨五入する。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 1440;

  function defaultSettings() {
    return {
      // 名前付きの時給。シフトごとに選ぶ
      wages: [{ id: 'w1', name: '通常', hourly: 1200 }],
      night: { enabled: true, start: '22:00', end: '05:00', rate: 0.25 },
      overtime: { enabled: true, thresholdHours: 8, rate: 0.25 },
      // mode: 'daily'（出勤日ごと） | 'monthly'（定額） | 'none'
      transport: { mode: 'daily', daily: 0, monthly: 0 },
      closingDay: 0, // 0 = 末日締め
      payMonthOffset: 1, // 0 = 当月払い, 1 = 翌月払い
      payDay: 25,
      walls: [
        { label: '扶養の目安（学生）', amount: 1500000, includeTransport: true },
        { label: '所得税がかかる目安', amount: 1780000, includeTransport: false },
      ],
    };
  }

  // ---------- 小物 ----------
  function toMin(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }
  function parseDate(s) {
    const [y, mo, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, mo - 1, d));
  }
  function fmtDate(dt) {
    return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
  }
  function addDays(s, n) {
    const d = parseDate(s);
    d.setUTCDate(d.getUTCDate() + n);
    return fmtDate(d);
  }
  function dayOfWeek(s) {
    return parseDate(s).getUTCDay(); // 0=日 … 6=土
  }
  function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  function shiftMonth(y, m, n) {
    const t = y * 12 + (m - 1) + n;
    return [Math.floor(t / 12), (t % 12) + 1];
  }

  /** シフトの時給：保存時の時給 → 選んだ時給 → 最初の時給 */
  function wageOf(settings, shift) {
    if (shift.hourly != null && shift.hourly !== '' && !isNaN(Number(shift.hourly))) return Number(shift.hourly);
    const list = settings.wages || [];
    const w = list.find((x) => x.id === shift.wageId) || list[0];
    return w ? Number(w.hourly) || 0 : 0;
  }

  function isNightMinute(settings, minuteOfDay) {
    const n = settings.night;
    if (!n || !n.enabled) return false;
    const s = toMin(n.start);
    const e = toMin(n.end);
    if (s === null || e === null || s === e) return false;
    return s < e ? minuteOfDay >= s && minuteOfDay < e : minuteOfDay >= s || minuteOfDay < e;
  }

  /**
   * 1 シフト分の内訳。priorWorkedMin = 同じ日の前のシフトで働いた分（残業を日単位で判定するため）
   * 休憩はシフトの中ほどに置いて計算する（深夜にかかるかどうかに影響するため）
   */
  function calcShift(settings, shift, priorWorkedMin) {
    priorWorkedMin = priorWorkedMin || 0;
    let start = toMin(shift.start);
    let end = toMin(shift.end);
    const empty = { workedMin: 0, nightMin: 0, otMin: 0, breakMin: 0, wage: 0, pay: { base: 0, night: 0, overtime: 0, total: 0 } };
    if (start === null || end === null) return Object.assign(empty, { error: '時刻が正しくありません' });
    if (end <= start) end += DAY; // 日付をまたぐシフト
    const span = end - start;

    const breakMin = Math.min(Math.max(0, Number(shift.breakMin) || 0), span);
    const bs = start + Math.floor((span - breakMin) / 2);
    const be = bs + breakMin;

    const thr = settings.overtime && settings.overtime.enabled ? Number(settings.overtime.thresholdHours) * 60 : Infinity;
    let worked = 0, night = 0, ot = 0;
    for (let m = start; m < end; m++) {
      if (m >= bs && m < be) continue;
      worked++;
      if (priorWorkedMin + worked > thr) ot++;
      if (isNightMinute(settings, m % DAY)) night++;
    }

    const wage = wageOf(settings, shift);
    const nr = settings.night && settings.night.enabled ? Number(settings.night.rate) || 0 : 0;
    const or = settings.overtime && settings.overtime.enabled ? Number(settings.overtime.rate) || 0 : 0;
    // 深夜と残業が重なる時間は割増率を足し算（25%＋25%＝50%）
    const pay = { base: (wage * worked) / 60, night: (wage * nr * night) / 60, overtime: (wage * or * ot) / 60 };
    pay.total = pay.base + pay.night + pay.overtime;
    return { workedMin: worked, nightMin: night, otMin: ot, breakMin, wage, pay, error: null };
  }

  /** 複数シフト（同じ日は残業判定を合算、交通費は 1 日 1 回） */
  function calcShifts(settings, shifts) {
    const sorted = shifts.slice().sort((a, b) => (a.date === b.date ? (toMin(a.start) || 0) - (toMin(b.start) || 0) : a.date < b.date ? -1 : 1));
    const workedByDate = {};
    const daily = settings.transport && settings.transport.mode === 'daily' ? Number(settings.transport.daily) || 0 : 0;
    return sorted.map((s) => {
      const result = calcShift(settings, s, workedByDate[s.date] || 0);
      const first = !(s.date in workedByDate);
      workedByDate[s.date] = (workedByDate[s.date] || 0) + result.workedMin;
      return { shift: s, result, transport: first ? daily : 0 };
    });
  }

  /** 締め日に合わせた期間。closingYM = 'YYYY-MM' */
  function periodFor(settings, closingYM) {
    const [y, m] = closingYM.split('-').map(Number);
    const cd = Number(settings.closingDay) || 0;
    if (cd <= 0 || cd >= 31) {
      return { from: fmtDate(new Date(Date.UTC(y, m - 1, 1))), to: fmtDate(new Date(Date.UTC(y, m - 1, daysInMonth(y, m)))) };
    }
    const [py, pm] = shiftMonth(y, m, -1);
    const from = addDays(fmtDate(new Date(Date.UTC(py, pm - 1, Math.min(cd, daysInMonth(py, pm))))), 1);
    const to = fmtDate(new Date(Date.UTC(y, m - 1, Math.min(cd, daysInMonth(y, m)))));
    return { from, to };
  }

  /** ある日付がどの締め月に入るか */
  function closingMonthOf(settings, date) {
    const d = parseDate(date);
    let y = d.getUTCFullYear();
    let m = d.getUTCMonth() + 1;
    const cd = Number(settings.closingDay) || 0;
    if (cd > 0 && d.getUTCDate() > Math.min(cd, daysInMonth(y, m))) [y, m] = shiftMonth(y, m, 1);
    return y + '-' + String(m).padStart(2, '0');
  }

  function payDateFor(settings, closingYM) {
    const [y, m] = closingYM.split('-').map(Number);
    const [py, pm] = shiftMonth(y, m, Number(settings.payMonthOffset) || 0);
    const day = Math.min(Number(settings.payDay) || daysInMonth(py, pm), daysInMonth(py, pm));
    return fmtDate(new Date(Date.UTC(py, pm - 1, day)));
  }

  /** 締め月 1 か月分の集計 */
  function summarizePeriod(settings, shifts, closingYM) {
    const p = periodFor(settings, closingYM);
    const rows = calcShifts(settings, shifts.filter((s) => s.date >= p.from && s.date <= p.to));
    const sum = { days: 0, workedMin: 0, nightMin: 0, otMin: 0, base: 0, night: 0, overtime: 0, transport: 0 };
    const dates = new Set();
    rows.forEach(({ shift, result, transport }) => {
      if (result.error) return;
      dates.add(shift.date);
      sum.workedMin += result.workedMin;
      sum.nightMin += result.nightMin;
      sum.otMin += result.otMin;
      sum.base += result.pay.base;
      sum.night += result.pay.night;
      sum.overtime += result.pay.overtime;
      sum.transport += transport;
    });
    sum.days = dates.size;
    if (settings.transport && settings.transport.mode === 'monthly' && sum.days > 0) sum.transport += Number(settings.transport.monthly) || 0;
    ['base', 'night', 'overtime', 'transport'].forEach((k) => (sum[k] = Math.round(sum[k])));
    sum.salary = sum.base + sum.night + sum.overtime; // 交通費を除いた給与
    sum.total = sum.salary + sum.transport;
    return { closingYM, period: p, payDate: payDateFor(settings, closingYM), rows, sum };
  }

  /** 支給日ベースで 1 年分（1〜12 月支給分） */
  function summarizeYear(settings, shifts, year) {
    const offset = Number(settings.payMonthOffset) || 0;
    const months = [];
    for (let i = 1; i <= 12; i++) {
      const [cy, cm] = shiftMonth(year, i, -offset);
      months.push(summarizePeriod(settings, shifts, cy + '-' + String(cm).padStart(2, '0')));
    }
    const salary = months.reduce((a, m) => a + m.sum.salary, 0);
    const transport = months.reduce((a, m) => a + m.sum.transport, 0);
    return { year, months, salary, transport, total: salary + transport };
  }

  /**
   * 保存データを今の形にそろえる（前のバージョンのデータも読めるように）
   * 旧形式：wages = [{ from, hourly }]（改定履歴）、シフトに hourly なし
   */
  function migrate(data) {
    const d = defaultSettings();
    const src = (data && data.settings) || {};
    const settings = Object.assign({}, d, src);
    ['night', 'overtime', 'transport'].forEach((k) => (settings[k] = Object.assign({}, d[k], src[k] || {})));
    if (!Array.isArray(settings.walls)) settings.walls = d.walls;
    let shifts = data && Array.isArray(data.shifts) ? data.shifts.slice() : [];

    const old = Array.isArray(src.wages) && src.wages.some((w) => w && w.from && !w.id);
    if (old) {
      const hist = src.wages.filter((w) => w.from).sort((a, b) => (a.from < b.from ? -1 : 1));
      const at = (date) => {
        const ok = hist.filter((w) => w.from <= date);
        return Number((ok.length ? ok[ok.length - 1] : hist[0]).hourly) || 0;
      };
      settings.wages = [{ id: 'w1', name: '通常', hourly: Number(hist[hist.length - 1].hourly) || 0 }];
      shifts = shifts.map((s) => Object.assign({}, s, { wageId: 'w1', hourly: s.hourly != null ? s.hourly : at(s.date) }));
    } else if (!Array.isArray(settings.wages) || !settings.wages.length) {
      settings.wages = d.wages;
    }
    // 使わなくなった項目を落とす
    delete settings.holiday;
    delete settings.rounding;
    shifts = shifts.map((s) => ({ id: s.id, date: s.date, start: s.start, end: s.end, breakMin: Number(s.breakMin) || 0, wageId: s.wageId, hourly: s.hourly }));
    return { settings, shifts };
  }

  return {
    defaultSettings, toMin, addDays, dayOfWeek, wageOf, calcShift, calcShifts,
    periodFor, closingMonthOf, payDateFor, summarizePeriod, summarizeYear, migrate,
  };
});
