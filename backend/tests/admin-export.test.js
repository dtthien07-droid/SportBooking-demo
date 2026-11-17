'use strict';

const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const test = require('node:test');
const {
  assertExportRows,
  createBookingsExport,
  createUsersExport,
  escapeTextCell
} = require('../src/admin/bookings-export');

test('dashboard-export changes leave booking-export sheet output unchanged', async () => {
  const result = await createBookingsExport({
    bookings: [{
      id: '1',
      booking_code: 'SPB-20261118-000001',
      owner_full_name: 'Nguyen Van A',
      owner_phone: '+84900000000',
      owner_email: 'user@example.test',
      status: 'PENDING',
      total_amount: '100000',
      paid_amount: '0',
      refunded_amount: '0',
      created_at: '2026-11-16T03:00:00.000Z',
      cancelled_by: null,
      cancellation_reason: ''
    }],
    slotsByBookingId: new Map([['1', [{
      facility_name: 'Facility',
      court_name: 'Court',
      service_date: '2026-11-18',
      starts_at: '18:00:00',
      ends_at: '19:00:00'
    }]]]),
    now: new Date('2026-11-17T03:00:00.000Z')
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.buffer);
  const sheet = workbook.getWorksheet('Đơn đặt sân');
  assert.deepEqual(sheet.getRow(1).values.slice(1), [
    'Mã đơn', 'Khách hàng', 'SĐT', 'Email', 'Cơ sở', 'Sân', 'Ngày chơi',
    'Khung giờ', 'Trạng thái', 'Tổng tiền', 'Đã trả', 'Đã hoàn',
    'Thời điểm đặt', 'Người hủy', 'Lý do hủy'
  ]);
  assert.deepEqual(sheet.getRow(2).values.slice(1), [
    'SPB-20261118-000001',
    'Nguyen Van A',
    "'+84900000000",
    'user@example.test',
    'Facility',
    'Court',
    '18/11/2026',
    '18:00-19:00',
    'Chờ thanh toán',
    100000,
    0,
    0,
    '16/11/2026 10:00',
    '',
    ''
  ]);
});

test('booking export escapes every formula-leading text character', () => {
  for (const prefix of ['=', '+', '-', '@', '\t', '\r', '\n']) {
    assert.equal(escapeTextCell(`${prefix}value`), `'${prefix}value`);
  }
  assert.equal(escapeTextCell('SPB-20261114-000001'), 'SPB-20261114-000001');
  assert.equal(escapeTextCell(null), '');
});

test('shared report workbook escapes formula-leading user cells and never exports secrets', async () => {
  const prefixes = ['=', '+', '-', '@'];
  const users = prefixes.map((prefix, index) => ({
    id: String(index + 1),
    full_name: `${prefix}formula-${index}`,
    email: `user-${index}@example.test`,
    phone: '+84900000000',
    account_status: index % 2 ? 'ADMIN_LOCKED' : 'ACTIVE',
    created_at: '2026-11-15T00:00:00.000Z',
    password_hash: 'must-not-be-exported',
    session_token: 'must-not-be-exported'
  }));
  const result = await createUsersExport({
    users,
    summary: {
      total_users: 4,
      active_users: 2,
      locked_users: 2,
      new_users_this_month: 4
    },
    now: new Date('2026-11-15T01:53:00.000Z')
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.buffer);
  const sheet = workbook.getWorksheet('Người dùng');
  prefixes.forEach((prefix, index) => {
    assert.equal(sheet.getCell(index + 2, 2).value, `'${prefix}formula-${index}`);
  });
  for (const worksheet of workbook.worksheets) {
    worksheet.eachRow((row) => row.eachCell((cell) => {
      assert.notEqual(cell.value, 'must-not-be-exported');
      if (typeof cell.value === 'string') {
        assert.doesNotMatch(cell.value, /password_hash|session_token/i);
      }
    }));
  }
});

test('shared report exports reject sheets above 5000 data rows', () => {
  assert.throws(
    () => assertExportRows(Array.from({ length: 5001 }, () => ({}))),
    (error) => error.status === 400
      && error.message === 'Quá nhiều dòng, hãy lọc thu hẹp'
  );
});
