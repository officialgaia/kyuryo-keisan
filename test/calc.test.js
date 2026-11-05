const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calc.js');

function base(over) {
  const s = C.defaultSettings();
  s.wages = [{ id: 'a', name: '通常', hourly: 1200 }, { id: 'b', name: '土日', hourly: 1300 }];
  s.transport = { mode: 'daily', daily: 500, monthly: 0 };
  return Object.assign(s, over || {});
}

test('通常のシフト', () => {
  const r = C.calcShift(base(), { date: '2026-11-04', start: '10:00', end: '15:00', breakMin: 0, wageId: 'a' });
  assert.equal(r.workedMin, 300);
  assert.equal(r.pay.total, 6000);
});

test('休憩は勤務時間から引かれる', () => {
  const r = C.calcShift(base(), { date: '2026-11-04', start: '10:00', end: '16:00', breakMin: 45, wageId: 'a' });
  assert.equal(r.workedMin, 315);
  assert.equal(r.pay.total, 6300);
});

test('時給を選べる（wageId）', () => {
  const r = C.calcShift(base(), { date: '2026-11-07', start: '10:00', end: '12:00', breakMin: 0, wageId: 'b' });
  assert.equal(r.wage, 1300);
  assert.equal(r.pay.total, 2600);
});

test('保存時の時給（hourly）が優先され、設定を変えても過去のシフトは変わらない', () => {
  const s = base();
  const shift = { date: '2026-11-04', start: '10:00', end: '11:00', breakMin: 0, wageId: 'a', hourly: 1200 };
  s.wages[0].hourly = 1400;
  assert.equal(C.calcShift(s, shift).pay.total, 1200);
  // 選んだ時給が消えていたら最初の時給
  assert.equal(C.wageOf(s, { wageId: 'zzz' }), 1400);
});

test('深夜割増（22時〜5時は25%増し）', () => {
  const r = C.calcShift(base(), { date: '2026-11-04', start: '18:00', end: '23:00', breakMin: 0, wageId: 'a' });
  assert.equal(r.nightMin, 60);
  assert.equal(r.pay.total, 6000 + 300);
});

test('日付をまたぐシフト', () => {
  const r = C.calcShift(base(), { date: '2026-11-04', start: '21:00', end: '02:00', breakMin: 0, wageId: 'a' });
  assert.equal(r.workedMin, 300);
  assert.equal(r.nightMin, 240);
  assert.equal(r.pay.total, 6000 + 1200);
});

test('8時間超は25%増し、深夜と重なると50%増し', () => {
  // 14:00〜24:30 休憩90分（中ほど 18:15〜19:45）→ 実働9h。8hを超える 23:30〜24:30 は深夜かつ残業
  const r = C.calcShift(base(), { date: '2026-11-04', start: '14:00', end: '00:30', breakMin: 90, wageId: 'a' });
  assert.equal(r.workedMin, 540);
  assert.equal(r.otMin, 60);
  assert.equal(r.nightMin, 150);
  // 基本 9h×1200 / 深夜 2.5h×300 / 残業 1h×300
  assert.equal(r.pay.total, 10800 + 750 + 300);
});

test('同じ日の2つ目のシフトは合算で8時間超を判定、交通費は1日1回', () => {
  const rows = C.calcShifts(base(), [
    { date: '2026-11-04', start: '08:00', end: '13:00', breakMin: 0, wageId: 'a' },
    { date: '2026-11-04', start: '14:00', end: '19:00', breakMin: 0, wageId: 'a' },
  ]);
  assert.equal(rows[1].result.otMin, 120);
  assert.equal(rows[0].transport + rows[1].transport, 500);
});

test('締め日（15日締め）の期間と支給日', () => {
  const s = base({ closingDay: 15, payMonthOffset: 1, payDay: 25 });
  assert.deepEqual(C.periodFor(s, '2026-11'), { from: '2026-10-16', to: '2026-11-15' });
  assert.equal(C.closingMonthOf(s, '2026-11-16'), '2026-12');
  assert.equal(C.closingMonthOf(s, '2026-11-15'), '2026-11');
  assert.equal(C.payDateFor(s, '2026-11'), '2026-12-25');
  assert.deepEqual(C.periodFor(base(), '2026-02'), { from: '2026-02-01', to: '2026-02-28' });
});

test('月の集計（時給が違うシフトの合計、交通費は分けて集計）', () => {
  const m = C.summarizePeriod(base(), [
    { date: '2026-11-02', start: '10:00', end: '15:00', breakMin: 0, wageId: 'a' },
    { date: '2026-11-07', start: '10:00', end: '15:00', breakMin: 0, wageId: 'b' },
    { date: '2026-12-01', start: '10:00', end: '15:00', breakMin: 0, wageId: 'a' },
  ], '2026-11');
  assert.equal(m.sum.days, 2);
  assert.equal(m.sum.salary, 6000 + 6500);
  assert.equal(m.sum.transport, 1000);
  assert.equal(m.sum.total, 13500);
});

test('交通費を月額定額にする', () => {
  const s = base({ transport: { mode: 'monthly', daily: 0, monthly: 8000 } });
  assert.equal(C.summarizePeriod(s, [{ date: '2026-11-02', start: '10:00', end: '11:00', wageId: 'a' }], '2026-11').sum.transport, 8000);
  assert.equal(C.summarizePeriod(s, [], '2026-11').sum.transport, 0);
});

test('年間合計は支給日ベース', () => {
  const y = C.summarizeYear(base({ payMonthOffset: 1 }), [
    { date: '2025-12-10', start: '10:00', end: '11:00', wageId: 'a' },
    { date: '2026-12-10', start: '10:00', end: '11:00', wageId: 'a' },
  ], 2026);
  assert.equal(y.salary, 1200);
});

test('前のバージョンのデータを読み込める（時給の改定履歴 → 保存時の時給）', () => {
  const old = {
    settings: { wages: [{ from: '2026-01-01', hourly: 1200 }, { from: '2026-10-01', hourly: 1300 }], holiday: { addPerHour: 50 }, rounding: { unit: 15 } },
    shifts: [
      { id: 'x', date: '2026-09-30', start: '10:00', end: '11:00', breakMin: 0, memo: 'a' },
      { id: 'y', date: '2026-10-01', start: '10:00', end: '11:00', breakMin: 0 },
    ],
  };
  const m = C.migrate(old);
  assert.deepEqual(m.settings.wages, [{ id: 'w1', name: '通常', hourly: 1300 }]);
  assert.equal(m.shifts[0].hourly, 1200);
  assert.equal(m.shifts[1].hourly, 1300);
  assert.equal(m.settings.holiday, undefined);
  // 新しい形のデータはそのまま
  const again = C.migrate(m);
  assert.deepEqual(again.settings.wages, m.settings.wages);
  assert.equal(again.shifts[0].hourly, 1200);
});
