/*
 * 給料計算ロジック（画面から独立。ブラウザでは window.Calc、Node では require で読み込める）
 *
 * 時刻は "HH:MM"、日付は "YYYY-MM-DD" の文字列で扱う。
 * 金額は円。端数は「期間の合計」で 1 円未満を四捨五入する。
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
      // 時給の改定履歴（適用開始日が新しいものが優先）
      wages: [{ from: '2026-01-01', hourly: 1200 }],
      night: { enabled: true, start: '22:00', end: '05:00', rate: 0.25 },
      overtime: { enabled: true, thresholdHours: 8, rate: 0.25 },
      // 土日・休日手当（1 時間あたりの上乗せ円）。weekendAuto で土日を自動で休日扱い
      holiday: { addPerHour: 0, weekendAuto: false },
      // 交通費 mode: 'daily'（出勤日ごと） | 'monthly'（期間ごとの定額） | 'none'
      transport: { mode: 'daily', daily: 0, monthly: 0 },
      // 打刻の丸め（分）。出勤は切り上げ、退勤は切り捨て。1 なら丸めなし
      rounding: { unit: 1 },
      // 締め日（0 = 末日締め）。支払月のずれ（0 = 当月払い, 1 = 翌月払い）と支給日
      closingDay: 0,
      payMonthOffset: 1,
      payDay: 25,
      // 年収の壁（目安。制度改正があるので画面から編集できる）
      walls: [
        { label: '扶養の目安（学生）', amount: 1500000, includeTransport: true },
        { label: '所得税がかかる目安', amount: 1780000, includeTransport: false },
      ],
    };
  }

  // ---------- 小物 ----------
  function toMin(hhmm) {
    if (!hhmm) return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }
  function minToHHMM(min) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return h + ':' + String(m).padStart(2, '0');
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
    return new Date(Date.UTC(y, m, 0)).getUTCDate(); // m は 1〜12
  }
  function shiftMonth(y, m, n) {
    const t = y * 12 + (m - 1) + n;
    return [Math.floor(t / 12), (t % 12) + 1];
  }

  // その日に有効な時給
  function wageFor(settings, date) {
    const list = (settings.wages || []).filter((w) => w.from && w.from <= date).sort((a, b) => (a.from < b.from ? 1 : -1));
    if (list.length) return Number(list[0].hourly) || 0;
    const all = (settings.wages || []).slice().sort((a, b) => (a.from < b.from ? -1 : 1));
    return all.length ? Number(all[0].hourly) || 0 : 0;
  }

  function isNightMinute(settings, minuteOfDay) {
    const n = settings.night;
    if (!n || !n.enabled) return false;
    const s = toMin(n.start);
    const e = toMin(n.end);
    if (s === null || e === null || s === e) return false;
    return s < e ? minuteOfDay >= s && minuteOfDay < e : minuteOfDay >= s || minuteOfDay < e;
  }

  function isHoliday(settings, shift) {
    if (shift.holiday === true || shift.holiday === false) return shift.holiday;
    if (settings.holiday && settings.holiday.weekendAuto) {
      const dow = dayOfWeek(shift.date);
      return dow === 0 || dow === 6;
    }
    return false;
  }

  /**
   * 1 シフト分の内訳を計算する。
   * priorWorkedMin: 同じ日の前のシフトで既に働いた分（8 時間超の判定を日単位にするため）
   */
  function calcShift(settings, shift, priorWorkedMin) {
    priorWorkedMin = priorWorkedMin || 0;
    const unit = Math.max(1, Number(settings.rounding && settings.rounding.unit) || 1);
    let start = toMin(shift.start);
    let end = toMin(shift.end);
    const empty = { workedMin: 0, nightMin: 0, otMin: 0, nightOtMin: 0, breakMin: 0, wage: 0, rate: 0, holiday: false, pay: { base: 0, night: 0, overtime: 0, holiday: 0, total: 0 }, error: null };
    if (start === null || end === null) return Object.assign(empty, { error: '時刻が正しくありません' });

    start = Math.ceil(start / unit) * unit;
    end = Math.floor(end / unit) * unit;
    if (end <= start) end += DAY; // 日付をまたぐシフト
    const span = end - start;
    if (span <= 0) return Object.assign(empty, { error: '勤務時間が 0 分です' });

    // 休憩区間。開始時刻が無いときはシフトの真ん中あたりに置く
    const breakMin = Math.min(Math.max(0, Number(shift.breakMin) || 0), span);
    let bs = toMin(shift.breakStart);
    if (bs === null) bs = start + Math.floor((span - breakMin) / 2);
    else if (bs < start) bs += DAY;
    bs = Math.min(Math.max(bs, start), end - breakMin);
    const be = bs + breakMin;

    const thr = settings.overtime && settings.overtime.enabled ? Number(settings.overtime.thresholdHours) * 60 : Infinity;
    let worked = 0, night = 0, ot = 0, nightOt = 0;
    for (let m = start; m < end; m++) {
      if (m >= bs && m < be) continue;
      worked++;
      const isOt = priorWorkedMin + worked > thr;
      const isNight = isNightMinute(settings, m % DAY);
      if (isOt && isNight) nightOt++;
      else if (isOt) ot++;
      else if (isNight) night++;
    }

    const wage = wageFor(settings, shift.date);
    const holiday = isHoliday(settings, shift);
    const add = holiday ? Number(settings.holiday && settings.holiday.addPerHour) || 0 : 0;
    const rate = wage + add; // 割増の基礎になる時給
    const nr = settings.night && settings.night.enabled ? Number(settings.night.rate) || 0 : 0;
    const or = settings.overtime && settings.overtime.enabled ? Number(settings.overtime.rate) || 0 : 0;

    const pay = {
      base: (wage * worked) / 60,
      holiday: (add * worked) / 60,
      night: (rate * nr * (night + nightOt)) / 60,
      overtime: (rate * or * (ot + nightOt)) / 60,
    };
    pay.total = pay.base + pay.holiday + pay.night + pay.overtime;

    return {
      workedMin: worked,
      nightMin: night + nightOt, // 深夜に働いた分（残業と重なる分も含む）
      otMin: ot + nightOt, // 残業した分（深夜と重なる分も含む）
      nightOtMin: nightOt,
      breakMin,
      wage,
      rate,
      holiday,
      pay,
      error: null,
    };
  }

  /** 複数シフトをまとめて計算（同じ日のシフトは残業判定を合算、交通費は 1 日 1 回） */
  function calcShifts(settings, shifts) {
    const sorted = shifts.slice().sort((a, b) => (a.date === b.date ? (toMin(a.start) || 0) - (toMin(b.start) || 0) : a.date < b.date ? -1 : 1));
    const workedByDate = {};
    const transportDone = {};
    const tmode = (settings.transport && settings.transport.mode) || 'none';
    return sorted.map((s) => {
      const r = calcShift(settings, s, workedByDate[s.date] || 0);
      workedByDate[s.date] = (workedByDate[s.date] || 0) + r.workedMin;
      let transport = 0;
      const override = s.transport === '' || s.transport === null || s.transport === undefined ? null : Number(s.transport);
      if (override !== null && !isNaN(override)) transport = override;
      else if (tmode === 'daily' && !transportDone[s.date]) transport = Number(settings.transport.daily) || 0;
      if (override !== null || tmode === 'daily') transportDone[s.date] = true;
      return { shift: s, result: r, transport };
    });
  }

  /** 締め日に合わせた期間。closingYM = 'YYYY-MM'（締めが来る月） */
  function periodFor(settings, closingYM) {
    const [y, m] = closingYM.split('-').map(Number);
    const cd = Number(settings.closingDay) || 0;
    if (cd <= 0 || cd >= 31) {
      return { from: fmtDate(new Date(Date.UTC(y, m - 1, 1))), to: fmtDate(new Date(Date.UTC(y, m - 1, daysInMonth(y, m)))) };
    }
    const [py, pm] = shiftMonth(y, m, -1);
    const prevClose = Math.min(cd, daysInMonth(py, pm));
    const from = addDays(fmtDate(new Date(Date.UTC(py, pm - 1, prevClose))), 1);
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
    const inPeriod = shifts.filter((s) => s.date >= p.from && s.date <= p.to);
    const rows = calcShifts(settings, inPeriod);
    const sum = { days: 0, workedMin: 0, nightMin: 0, otMin: 0, base: 0, holiday: 0, night: 0, overtime: 0, transport: 0 };
    const dates = new Set();
    rows.forEach(({ shift, result, transport }) => {
      if (result.error) return;
      dates.add(shift.date);
      sum.workedMin += result.workedMin;
      sum.nightMin += result.nightMin;
      sum.otMin += result.otMin;
      sum.base += result.pay.base;
      sum.holiday += result.pay.holiday;
      sum.night += result.pay.night;
      sum.overtime += result.pay.overtime;
      sum.transport += transport;
    });
    sum.days = dates.size;
    if (settings.transport && settings.transport.mode === 'monthly' && sum.days > 0) sum.transport += Number(settings.transport.monthly) || 0;
    // 端数処理は期間合計で 1 円未満四捨五入
    ['base', 'holiday', 'night', 'overtime', 'transport'].forEach((k) => (sum[k] = Math.round(sum[k])));
    sum.salary = sum.base + sum.holiday + sum.night + sum.overtime; // 交通費を除いた給与
    sum.total = sum.salary + sum.transport;
    return { closingYM, period: p, payDate: payDateFor(settings, closingYM), rows, sum };
  }

  /** 支給日ベースで 1 年分（1〜12 月支給分）の合計。年収の壁はふつう支給日で数える */
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

  return {
    defaultSettings,
    toMin,
    minToHHMM,
    addDays,
    dayOfWeek,
    wageFor,
    isNightMinute,
    calcShift,
    calcShifts,
    periodFor,
    closingMonthOf,
    payDateFor,
    summarizePeriod,
    summarizeYear,
  };
});
