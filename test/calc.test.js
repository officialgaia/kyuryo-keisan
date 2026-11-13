const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calc.js');

function base(over) {
  const s = C.defaultSettings();
  s.wages = [{ id: 'a', name: '通常', hourly: 1200 }, { id: 'b', name: '土日', hourly: 1300 }];
  s.transport = { mode: 'daily', monthly: 0, options: [{ id: 't1', name: '電車', amount: 500 }, { id: 't2', name: 'バス', amount: 700 }] };
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

test('深夜かつ8時間超の時間は時給の1.5倍', () => {
  // 14:00〜24:30 休憩90分（中ほど 18:15〜19:45）→ 実働9h。8hを超える 23:30〜24:30 は深夜かつ残業
  const r = C.calcShift(base(), { date: '2026-11-04', start: '14:00', end: '00:30', breakMin: 90, wageId: 'a' });
  assert.equal(r.workedMin, 540);
  assert.equal(r.otMin, 60);
  assert.equal(r.nightMin, 150);
  assert.equal(r.nightOtMin, 60);
  // 深夜だけ 1.5h は1.25倍、深夜かつ残業 1h は1.5倍（1200×1.5＝1800）
  assert.equal(r.pay.night, 450);
  assert.equal(r.pay.nightOvertime, 600);
  assert.equal(r.pay.total, 10800 + 450 + 600);
});

test('深夜かつ残業の割増率は変えられる', () => {
  const s = base({ nightOvertime: { rate: 0.6 } });
  const r = C.calcShift(s, { date: '2026-11-04', start: '14:00', end: '00:30', breakMin: 90, wageId: 'a' });
  assert.equal(r.pay.nightOvertime, 720);
});

test('8時間超（深夜でない）は1.25倍', () => {
  const r = C.calcShift(base(), { date: '2026-11-04', start: '08:00', end: '18:00', breakMin: 60, wageId: 'a' });
  assert.equal(r.otMin, 60);
  assert.equal(r.pay.total, 9 * 1200 + 300);
});

test('同じ日の2つ目のシフトは合算で8時間超を判定、交通費は1日1回', () => {
  const rows = C.calcShifts(base(), [
    { date: '2026-11-04', start: '08:00', end: '13:00', breakMin: 0, wageId: 'a' },
    { date: '2026-11-04', start: '14:00', end: '19:00', breakMin: 0, wageId: 'a' },
  ]);
  assert.equal(rows[1].result.otMin, 120);
  assert.equal(rows[0].transport + rows[1].transport, 500);
});

test('交通費を選べる（1日1回、その日の最初のシフトの交通費）', () => {
  const rows = C.calcShifts(base(), [
    { date: '2026-11-05', start: '10:00', end: '12:00', wageId: 'a', transportId: 't2' },
    { date: '2026-11-05', start: '14:00', end: '16:00', wageId: 'a', transportId: 't1' },
    { date: '2026-11-06', start: '10:00', end: '12:00', wageId: 'a', transportId: 't1', transport: 480 },
  ]);
  assert.deepEqual(rows.map((r) => r.transport), [700, 0, 480]);
  // 選んだ交通費が消えていたら最初の交通費
  assert.equal(C.transportOf(base(), { transportId: 'zzz' }), 500);
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
  const s = base({ transport: { mode: 'monthly', monthly: 8000, options: [{ id: 't1', name: '電車', amount: 500 }] } });
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
    settings: { wages: [{ from: '2026-01-01', hourly: 1200 }, { from: '2026-10-01', hourly: 1300 }], holiday: { addPerHour: 50 }, rounding: { unit: 15 }, transport: { mode: 'daily', daily: 480, monthly: 0 } },
    shifts: [
      { id: 'x', date: '2026-09-30', start: '10:00', end: '11:00', breakMin: 0, memo: 'a', transport: 300 },
      { id: 'y', date: '2026-10-01', start: '10:00', end: '11:00', breakMin: 0 },
    ],
  };
  const m = C.migrate(old);
  assert.deepEqual(m.settings.wages, [{ id: 'w1', name: '通常', hourly: 1300 }]);
  assert.equal(m.shifts[0].hourly, 1200);
  assert.equal(m.shifts[1].hourly, 1300);
  assert.equal(m.settings.holiday, undefined);
  assert.deepEqual(m.settings.transport.options, [{ id: 't1', name: '通常', amount: 480 }]);
  assert.equal(m.settings.transport.daily, undefined);
  assert.equal(m.shifts[0].transport, 300);
  assert.equal(m.shifts[1].transport, 480);
  assert.equal(m.settings.nightOvertime.rate, 0.5);
  // 新しい形のデータはそのまま
  const again = C.migrate(m);
  assert.deepEqual(again.settings.wages, m.settings.wages);
  assert.equal(again.shifts[0].hourly, 1200);
  assert.deepEqual(again.settings.transport.options, m.settings.transport.options);
  assert.equal(again.shifts[1].transport, 480);
});

test('今までに稼いだ額：シフトの途中なら働いた分だけ（分単位）', () => {
  const shifts = [
    { date: '2026-11-02', start: '17:00', end: '22:00', breakMin: 0, wageId: 'a' }, // 終わったシフト 6000
    { date: '2026-11-13', start: '17:00', end: '22:00', breakMin: 0, wageId: 'a' }, // 勤務中
    { date: '2026-11-20', start: '17:00', end: '22:00', breakMin: 0, wageId: 'a' }, // まだ先
  ];
  const e = C.earnedUntil(base(), shifts, '2026-11', '2026-11-13', 18 * 60 + 31);
  assert.equal(e.earned, 6000 + 91 * 20);
  assert.equal(e.workedMin, 300 + 91);
  assert.equal(e.current.shift.date, '2026-11-13');
  assert.equal(e.current.remainingMin, 209);
  assert.equal(e.next.shift.date, '2026-11-20');
  // シフトの前は0、終わったら全額
  assert.equal(C.earnedUntil(base(), shifts.slice(1, 2), '2026-11', '2026-11-13', 16 * 60 + 59).earned, 0);
  assert.equal(C.earnedUntil(base(), shifts.slice(1, 2), '2026-11', '2026-11-13', 23 * 60).earned, 6000);
});

test('今までに稼いだ額：休憩中は増えない', () => {
  // 10:00〜16:00 休憩60分（中ほど 12:30〜13:30）
  const sh = [{ date: '2026-11-13', start: '10:00', end: '16:00', breakMin: 60, wageId: 'a' }];
  assert.equal(C.earnedUntil(base(), sh, '2026-11', '2026-11-13', 12 * 60 + 30).earned, 3000);
  assert.equal(C.earnedUntil(base(), sh, '2026-11', '2026-11-13', 13 * 60 + 15).earned, 3000);
  assert.equal(C.earnedUntil(base(), sh, '2026-11', '2026-11-13', 13 * 60 + 45).earned, 3300);
});

test('今までに稼いだ額：深夜・深夜残業・日付またぎ', () => {
  // 14:00〜24:30 休憩90分 → 23:45 時点：実働495分、深夜だけ90分、深夜残業15分
  const sh = [{ date: '2026-11-13', start: '14:00', end: '00:30', breakMin: 90, wageId: 'a' }];
  assert.equal(C.earnedUntil(base(), sh, '2026-11', '2026-11-13', 23 * 60 + 45).earned, 9900 + 450 + 150);
  // 前日21:00〜翌2:00 のシフトを、翌日1:00 に見る → 240分、うち深夜180分
  const over = [{ date: '2026-11-12', start: '21:00', end: '02:00', breakMin: 0, wageId: 'a' }];
  assert.equal(C.earnedUntil(base(), over, '2026-11', '2026-11-13', 60).earned, 4800 + 900);
});
