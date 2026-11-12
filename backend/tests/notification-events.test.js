'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  notifyIncidentCancellation,
  notifyPendingIncidentCancellation
} = require('../src/notifications/notification-events');

test('incident cancellation writes booking and full-refund notifications through its transaction connection', async () => {
  const inserts = [];
  const connection = {
    async execute(sql, values) {
      assert.match(sql, /INSERT INTO notifications/);
      inserts.push(values);
    }
  };
  await notifyIncidentCancellation(connection, {
    id: '874',
    user_id: '25',
    booking_code: 'SPB-20261112-ABC123',
    slots: [{
      facility_name: 'Cơ sở A',
      court_name: 'Sân 1',
      service_date: '2026-11-12',
      starts_at: '06:00:00',
      ends_at: '07:00:00'
    }]
  }, '100000');

  assert.equal(inserts.length, 2);
  assert.equal(inserts[0][1], 'BOOKING_HOLD');
  assert.equal(inserts[0][2], 'Sân gặp sự cố, đơn SPB-20261112-ABC123 bị hủy');
  assert.match(inserts[0][3], /12\/11\/2026, 06:00–07:00/);
  assert.equal(inserts[1][1], 'PAYMENT');
  assert.equal(inserts[1][2], 'Hoàn 100% số đã trả: 100.000 đ');
  assert.match(inserts[1][3], /12\/11\/2026, 06:00–07:00/);
  for (const values of inserts) {
    assert.equal(values[0], '25');
    assert.equal(values[4], '874');
  }
});

test('pending incident cancellation writes only one booking notification through its transaction connection', async () => {
  const inserts = [];
  const connection = {
    async execute(sql, values) {
      assert.match(sql, /INSERT INTO notifications/);
      inserts.push(values);
    }
  };
  await notifyPendingIncidentCancellation(connection, {
    id: '875',
    user_id: '26',
    booking_code: 'SPB-20261112-ABC124',
    slots: []
  });

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][0], '26');
  assert.equal(inserts[0][1], 'BOOKING_HOLD');
  assert.equal(inserts[0][2], 'Đơn đã bị hủy do sự cố');
  assert.match(inserts[0][3], /Đơn đã bị hủy do sự cố/);
  assert.equal(inserts[0][4], '875');
});
