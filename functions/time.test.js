const test = require('node:test');
const assert = require('node:assert/strict');
const { digestWindow } = require('./time');

test('is due at 23:00 in Ho Chi Minh timezone', () => {
  const result = digestWindow(new Date('2026-07-05T16:00:00.000Z'), 'Asia/Ho_Chi_Minh', '23:00');
  assert.equal(result.due, true);
  assert.equal(result.localDate, '2026-07-05');
});

test('is not due outside the schedule window', () => {
  const result = digestWindow(new Date('2026-07-05T15:45:00.000Z'), 'Asia/Ho_Chi_Minh', '23:00');
  assert.equal(result.due, false);
});

test('invalid timezone does not crash the scheduler', () => {
  assert.deepEqual(digestWindow(new Date(), 'Mars/Olympus', '23:00'), { due: false, localDate: null });
});
