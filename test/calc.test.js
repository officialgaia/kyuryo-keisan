const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calc.js');

function base(over) {
  const s = C.defaultSettings();
  s.wages = [{ from: '2000-01-01', hourly: 1200 }];
  s.transport = { mode: 'daily', daily: 500, monthly: 0 };
  return Object.assign(s, over || {});
}

test('通常のシフト（休憩なし）', () => {
  const r = C.calcShift(base(), { date: '2026-11-04', start: '10:00', end: '15:00', breakMin: 0 });
  assert.equal(r.workedMin, 300);
  assert.equal(r.pay.total, 6000);
});

test('休憩は勤務時間から引かれる', () => {
  const r = C.calcShift(base(), { date: '2026-11-04', start: '10:00', end: '16:00', breakMin: 45 });
  assert.equal(r.workedMin, 315);
  assert.equal(r.pay.total, 6300);
});

test('深夜割増（22時〜5時は25%増し）', () => {
  const r = C.calcShift(base(), { date: '2026-11-04', start: '18:00', end: '23:00', breakMin: 0 });
  assert.equal(r.nightMin, 60);
  // 5h×1200 + 1h×1200×0.25
  assert.equal(r.pay.total, 6000 + 300);
});

test('日付をまたぐシフト', () => {
  const r = C.calcShift(base(), { date: '2026-11-04', start: '21:00', end: '02:00', breakMin: 0 });
  assert.equal(r.workedMin, 300);
  assert.equal(r.nightMin, 240);
  assert.equal(r.pay.total, 6000 + 1200);
});

test('8時間を超えた分は25%増し、深夜と重なると50%増し', () => {
  // 14:00〜24:00、休憩60分を 17:00 から → 実働9h。8hを超える最後の1h(23:00-24:00)は深夜かつ残業
  const r = C.calcShift(base(), { date: '2026-11-04', start: '14:00', end: '00:00', breakMin: 60, breakStart: '17:00' });
  assert.equal(r.workedMin, 540);
  assert.equal(r.otMin, 60);
  assert.equal(r.nightMin, 120);
  assert.equal(r.nightOtMin, 60);
  // 基本 9h×1200=10800 / 深夜 2h×300=600 / 残業 1h×300=300
  assert.equal(r.pay.total, 10800 + 600 + 300);
});

test('同じ日の2つ目のシフトは合算で8時間超を判定', () => {
  const s = base();
  const rows = C.calcShifts(s, [
    { date: '2026-11-04', start: '08:00', end: '13:00', breakMin: 0 },
    { date: '2026-11-04', start: '14:00', end: '19:00', breakMin: 0 },
  ]);
  assert.equal(rows[1].result.otMin, 120);
  // 交通費は1日1回
  assert.equal(rows[0].transport + rows[1].transport, 500);
});

test('時給の改定履歴（適用開始日で切り替え）', () => {
  const s = base({ wages: [{ from: '2026-01-01', hourly: 1200 }, { from: '2026-10-01', hourly: 1300 }] });
  assert.equal(C.wageFor(s, '2026-09-30'), 1200);
  assert.equal(C.wageFor(s, '2026-10-01'), 1300);
});

test('土日手当（時給に上乗せ、割増の基礎にも入る）', () => {
  const s = base({ holiday: { addPerHour: 100, weekendAuto: true } });
  // 2026-11-07 は土曜
  const r = C.calcShift(s, { date: '2026-11-07', start: '21:00', end: '23:00', breakMin: 0 });
  assert.equal(r.holiday, true);
  // 2h×1300 + 1h×1300×0.25
  assert.equal(r.pay.total, 2600 + 325);
  // 手入力で休日でない扱いにもできる
  const r2 = C.calcShift(s, { date: '2026-11-07', start: '10:00', end: '11:00', breakMin: 0, holiday: false });
  assert.equal(r2.pay.total, 1200);
});

test('打刻の丸め（15分単位：出勤は切り上げ、退勤は切り捨て）', () => {
  const s = base({ rounding: { unit: 15 } });
  const r = C.calcShift(s, { date: '2026-11-04', start: '09:58', end: '15:07', breakMin: 0 });
  assert.equal(r.workedMin, 300);
});

test('締め日（15日締め）の期間と支給日', () => {
  const s = base({ closingDay: 15, payMonthOffset: 1, payDay: 25 });
  assert.deepEqual(C.periodFor(s, '2026-11'), { from: '2026-10-16', to: '2026-11-15' });
  assert.equal(C.closingMonthOf(s, '2026-11-16'), '2026-12');
  assert.equal(C.closingMonthOf(s, '2026-11-15'), '2026-11');
  assert.equal(C.payDateFor(s, '2026-11'), '2026-12-25');
  // 末日締め
  const e = base({ closingDay: 0 });
  assert.deepEqual(C.periodFor(e, '2026-02'), { from: '2026-02-01', to: '2026-02-28' });
});

test('月の集計（交通費は給与と分けて合計）', () => {
  const s = base();
  const shifts = [
    { date: '2026-11-02', start: '17:00', end: '22:00', breakMin: 0 },
    { date: '2026-11-03', start: '17:00', end: '22:00', breakMin: 0 },
    { date: '2026-12-01', start: '17:00', end: '22:00', breakMin: 0 },
  ];
  const m = C.summarizePeriod(s, shifts, '2026-11');
  assert.equal(m.sum.days, 2);
  assert.equal(m.sum.salary, 12000);
  assert.equal(m.sum.transport, 1000);
  assert.equal(m.sum.total, 13000);
});

test('年間合計は支給日ベース（翌月払いなら前年12月分が1月支給）', () => {
  const s = base({ payMonthOffset: 1 });
  const shifts = [
    { date: '2025-12-10', start: '10:00', end: '11:00', breakMin: 0 },
    { date: '2026-12-10', start: '10:00', end: '11:00', breakMin: 0 },
  ];
  const y = C.summarizeYear(s, shifts, 2026);
  assert.equal(y.salary, 1200); // 2025年12月分のみ（2026年12月分は2027年1月支給）
});

test('交通費を月額定額にする', () => {
  const s = base({ transport: { mode: 'monthly', daily: 0, monthly: 8000 } });
  const m = C.summarizePeriod(s, [{ date: '2026-11-02', start: '10:00', end: '11:00', breakMin: 0 }], '2026-11');
  assert.equal(m.sum.transport, 8000);
  const empty = C.summarizePeriod(s, [], '2026-11');
  assert.equal(empty.sum.transport, 0);
});
